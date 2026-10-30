import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { roles, userRoles } from '../../modules/access-control/infrastructure/persistence/access-control.schema.js';
import {
  doctors,
  hospitalSequences,
  patients,
  specialities,
} from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../modules/identity/infrastructure/persistence/identity.schema.js';
import { accountLoaders } from './account-loaders.js';
import { hrLoaders } from './hr-loaders.js';
import { stockLoaders } from './stock-loaders.js';
import { noteRejection, type EtlContext, type Loader } from './etl.js';
import {
  doctorRecord,
  patientRecord,
  roleName,
  userRecord,
  type LegacyDoctor,
  type LegacyPatient,
  type LegacyUser,
} from './legacy-records.js';

const NIL = '00000000-0000-0000-0000-000000000000';
/** The hospital's UHID counter (kind and serials per year), kept in step with the UHIDs brought over. */
const UHID_KIND = 'uhid';
const SERIALS_PER_YEAR = 1_000_000;

/** Pages of an old table in key order: the query takes @after (the last key read) and @n (the page size). */
async function* pages<T extends Record<string, unknown>>(
  context: EtlContext,
  query: string,
  key: (row: T) => string | number,
  start: string | number,
): AsyncGenerator<T[]> {
  let after = start;
  for (;;) {
    const rows = await context.source.query<T>(query, { after, n: context.batchSize });
    if (rows.length === 0) return;
    yield rows;
    after = key(rows[rows.length - 1]!);
    if (rows.length < context.batchSize) return;
  }
}

/** Old Identity.Roles → roles, by name (an existing role of the same name is used); permissions are granted anew. */
export function rolesLoader(db: DbContext): Loader {
  return {
    name: 'roles',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (await db.db.select({ id: roles.id, name: roles.name }).from(roles)).map((row) => [
          row.name.toLowerCase(),
          row.id,
        ]),
      );
      const rows = await context.source.query<{ Id: string; Name: string | null }>(
        'SELECT [Id], [Name] FROM [Identity].[Roles] ORDER BY [Name]',
      );
      for (const row of rows) {
        report.read += 1;
        if (await context.ids.has('role', row.Id)) {
          report.kept += 1;
          continue;
        }
        const name = roleName(row.Name);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = existing.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await db.db.insert(roles).values({
            id,
            name,
            description: `${row.Name?.trim() ?? name} (brought over from the old system)`.slice(0, 200),
          });
          existing.set(name.toLowerCase(), id);
          report.written += 1;
        } else {
          report.notes.push(`Role ${name} already existed and was used as it is`);
        }
        await context.ids.set('role', row.Id, id);
      }
      report.notes.push('Roles come over without permissions: grant them under Roles before people sign in');
    },
  };
}

/** Old Identity.Users → users: usernames kept, placeholder emails where none, old hashes checked at first sign-in. */
export function usersLoader(db: DbContext): Loader {
  return {
    name: 'users',
    dependsOn: [],
    async run(context, report) {
      const taken = await db.db.select({ email: users.email, username: users.username }).from(users);
      const emails = new Set(taken.map((row) => row.email));
      const usernames = new Set(taken.flatMap((row) => (row.username ? [row.username] : [])));
      const query = `SELECT TOP (@n) [Id], [UserName], [Email], [PasswordHash], [FirstName], [LastName], [FullName],
        [IsActive], [IsDeleted], [CreatedOn] FROM [Identity].[Users] WHERE [Id] > @after ORDER BY [Id]`;
      for await (const page of pages<LegacyUser & Record<string, unknown>>(context, query, (row) => row.Id, '')) {
        for (const row of page) {
          report.read += 1;
          if (await context.ids.has('user', row.Id)) {
            report.kept += 1;
            continue;
          }
          const result = userRecord(row);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          const user = result.value;
          if (emails.has(user.email)) {
            noteRejection(report, row.Id, 'email_taken');
            continue;
          }
          if (user.username && usernames.has(user.username)) {
            noteRejection(report, row.Id, 'username_taken');
            continue;
          }
          const id = randomUUID();
          await db.db.insert(users).values({
            id,
            email: user.email,
            username: user.username,
            displayName: user.displayName,
            passwordHash: user.passwordHash,
            status: user.active ? 'active' : 'deactivated',
            emailVerifiedAt: context.now,
            passwordChangedAt: context.now,
            createdAt: row.CreatedOn ?? context.now,
          });
          emails.add(user.email);
          if (user.username) usernames.add(user.username);
          if (user.placeholderEmail) report.notes.push(`${user.username} has no email: signs in by username`);
          await context.ids.set('user', row.Id, id);
          report.written += 1;
        }
      }
    },
  };
}

/** Old Identity.UserRoles → user_roles, for users and roles both brought over. */
export function userRolesLoader(db: DbContext): Loader {
  return {
    name: 'user-roles',
    dependsOn: ['users', 'roles'],
    async run(context, report) {
      const rows = await context.source.query<{ UserId: string; RoleId: string }>(
        'SELECT [UserId], [RoleId] FROM [Identity].[UserRoles]',
      );
      for (const row of rows) {
        report.read += 1;
        const userId = await context.ids.get('user', row.UserId);
        const roleId = await context.ids.get('role', row.RoleId);
        if (!userId || !roleId) {
          noteRejection(report, `${row.UserId}/${row.RoleId}`, userId ? 'role_not_brought' : 'user_not_brought');
          continue;
        }
        const inserted = await db.db
          .insert(userRoles)
          .values({ userId, roleId, assignedAt: context.now })
          .onConflictDoNothing()
          .returning({ userId: userRoles.userId });
        if (inserted.length) report.written += 1;
        else report.kept += 1;
      }
    },
  };
}

/** Old Marketing.DoctorFieldOfSpecialities → hospital_specialities, by name. */
export function specialitiesLoader(db: DbContext): Loader {
  return {
    name: 'specialities',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (await db.db.select({ id: specialities.id, name: specialities.name }).from(specialities)).map((row) => [
          row.name.toLowerCase(),
          row.id,
        ]),
      );
      const rows = await context.source.query<{ Id: string; Name: string | null }>(
        'SELECT [Id], [Name] FROM [Marketing].[DoctorFieldOfSpecialities]',
      );
      for (const row of rows) {
        report.read += 1;
        if (await context.ids.has('speciality', row.Id)) {
          report.kept += 1;
          continue;
        }
        const name = row.Name?.replace(/\s+/g, ' ').trim().slice(0, 100);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = existing.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await db.db.insert(specialities).values({ id, name });
          existing.set(name.toLowerCase(), id);
          report.written += 1;
        }
        await context.ids.set('speciality', row.Id, id);
      }
    },
  };
}

/** Old Marketing.Doctors → hospital_doctors, with their speciality and the user account that was theirs. */
export function doctorsLoader(db: DbContext): Loader {
  return {
    name: 'doctors',
    dependsOn: ['specialities', 'users'],
    async run(context, report) {
      const codes = new Set(
        (await db.db.select({ code: doctors.code }).from(doctors)).flatMap((row) => (row.code ? [row.code] : [])),
      );
      const accounts = new Map<string, string>();
      for (const row of await context.source.query<{ Id: string; DoctorId: string }>(
        `SELECT [Id], CAST([DoctorId] AS nvarchar(36)) AS [DoctorId] FROM [Identity].[Users] WHERE [DoctorId] <> @nil`,
        { nil: NIL },
      )) {
        const userId = await context.ids.get('user', row.Id);
        if (userId && !accounts.has(row.DoctorId.toLowerCase())) accounts.set(row.DoctorId.toLowerCase(), userId);
      }
      const query = `SELECT TOP (@n) CAST([Id] AS nvarchar(36)) AS [Id], [Name], [DoctorCodeNo], [PhoneFax],
        CAST([DoctorFieldOfSpecialityId] AS nvarchar(36)) AS [DoctorFieldOfSpecialityId], [OPDChamberVisitFeeMaiden],
        [OPDChamberVisitFeeNew], [OPDChamberVisitFeeOld], [OPDChamberReportConsultancyFee], [IsDeleted]
        FROM [Marketing].[Doctors] WHERE [Id] > @after ORDER BY [Id]`;
      for await (const page of pages<LegacyDoctor & Record<string, unknown>>(context, query, (row) => row.Id, NIL)) {
        for (const row of page) {
          report.read += 1;
          if (await context.ids.has('doctor', row.Id)) {
            report.kept += 1;
            continue;
          }
          const result = doctorRecord(row);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          const doctor = result.value;
          let code = doctor.code;
          if (code && codes.has(code)) {
            report.notes.push(`Doctor ${doctor.name}: code ${code} is another doctor's; left without a code`);
            code = null;
          }
          const id = randomUUID();
          await db.db.insert(doctors).values({
            id,
            name: doctor.name,
            code,
            phone: doctor.phone,
            specialityId: row.DoctorFieldOfSpecialityId
              ? await context.ids.get('speciality', row.DoctorFieldOfSpecialityId)
              : null,
            isConsultant: doctor.isConsultant,
            firstVisitFee: doctor.firstVisitFee,
            newVisitFee: doctor.newVisitFee,
            followUpFee: doctor.followUpFee,
            reportFee: doctor.reportFee,
            userId: accounts.get(row.Id.toLowerCase()) ?? null,
            isActive: doctor.isActive,
          });
          if (code) codes.add(code);
          await context.ids.set('doctor', row.Id, id);
          report.written += 1;
        }
      }
    },
  };
}

/** Old Hospital.RegRecords → hospital_patients (UHIDs kept); the UHID counters are moved past the ones brought over. */
export function patientsLoader(db: DbContext): Loader {
  return {
    name: 'patients',
    dependsOn: [],
    async run(context, report) {
      const uhids = new Set((await db.db.select({ uhid: patients.uhid }).from(patients)).map((row) => row.uhid));
      const documents = new Set(
        (await db.db.select({ idNo: patients.idNo }).from(patients)).flatMap((row) => (row.idNo ? [row.idNo] : [])),
      );
      const highest = new Map<number, number>();
      const query = `SELECT TOP (@n) CAST([Id] AS nvarchar(36)) AS [Id], [UHID], [Title], [GivenName], [Surname],
        [FullName], [AgeYear], [AgeMonth], [AgeDay], [Dob], [Sex], [FatherName], [MotherName], [SpouseName],
        [MaritalStatus], [Profession], [MobileNo], [Email], [CareOf], [HouseNo], [RoadNo], [Village], [Po],
        [ArearOrThana], [District], [Cpname], [Cpmobile], [Cpaddress], [RelationWithPatient], [BloodGroup],
        [NationalId], [RegDate], [IsDeleted]
        FROM [Hospital].[RegRecords] WHERE [UHID] > @after ORDER BY [UHID]`;
      for await (const page of pages<LegacyPatient & Record<string, unknown>>(
        context,
        query,
        (row) => Number(row.UHID),
        0,
      )) {
        const values: (typeof patients.$inferInsert)[] = [];
        for (const row of page) {
          report.read += 1;
          if (await context.ids.has('patient', row.Id)) {
            report.kept += 1;
            continue;
          }
          const result = patientRecord(row);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          const patient = result.value;
          if (uhids.has(patient.uhid)) {
            noteRejection(report, row.Id, 'uhid_taken');
            continue;
          }
          const id = randomUUID();
          const document =
            patient.idNo && patient.isActive && documents.has(patient.idNo)
              ? { idType: null, idNo: null }
              : { idType: patient.idType, idNo: patient.idNo };
          if (document.idNo === null && patient.idNo)
            report.notes.push(`UHID ${patient.uhid}: NID shared with another patient; left out`);
          values.push({ ...patient, ...document, id, version: 1 });
          uhids.add(patient.uhid);
          if (document.idNo) documents.add(document.idNo);
          const year = 2000 + Math.floor(patient.uhid / SERIALS_PER_YEAR);
          const serial = patient.uhid % SERIALS_PER_YEAR;
          if (patient.uhid >= SERIALS_PER_YEAR) highest.set(year, Math.max(highest.get(year) ?? 0, serial));
          await context.ids.set('patient', row.Id, id);
        }
        if (values.length) await db.db.insert(patients).values(values);
        report.written += values.length;
      }
      for (const [year, last] of highest) {
        if (year > 2099) continue;
        await db.db
          .insert(hospitalSequences)
          .values({ kind: UHID_KIND, year, last })
          .onConflictDoUpdate({
            target: [hospitalSequences.kind, hospitalSequences.year],
            set: { last: sql`greatest(${hospitalSequences.last}, ${last})` },
          });
      }
      if (highest.size)
        report.notes.push(`UHID counters moved past the UHIDs brought over (${[...highest.keys()].sort().join(', ')})`);
    },
  };
}

export function legacyLoaders(db: DbContext): Loader[] {
  return [
    rolesLoader(db),
    usersLoader(db),
    userRolesLoader(db),
    specialitiesLoader(db),
    doctorsLoader(db),
    patientsLoader(db),
    ...accountLoaders(db),
    ...hrLoaders(db),
    ...stockLoaders(db),
  ];
}
