import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import {
  canteenMembers,
  canteenOutlets,
  canteenSales,
  canteenSequences,
} from '../../modules/canteen/infrastructure/persistence/canteen.schema.js';
import {
  admissionDoctors,
  admissions,
  bedCategories,
  beds,
  bedStays,
  corporateClients,
  doctorLedger,
  hospitalSequences,
  ipdCharges,
  ipdPayments,
  patients,
  serviceGroups,
  services,
  wards,
} from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { staffDues } from '../../modules/payroll/infrastructure/persistence/payroll.schema.js';
import { dayBefore, text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import { mobile } from './legacy-records.js';
import { isNew, namedLoader, NIL } from './loader-kit.js';
import { advanceKind, bedHistory, isIntensive, netPaisa, wallInstant } from './open-records.js';

/** The service the charges given in the old system before the cut-over are billed under. */
export const BROUGHT_OVER_GROUP = 'Brought over';
export const BROUGHT_OVER_SERVICE = 'Charges in the old system';
const BROUGHT_OVER_CODE = 'OLD-IPD';

const serial = (kind: string, year: number, last: number) => `${kind}-${year}-${String(last).padStart(5, '0')}`;
const oldId = (value: string | null | undefined) => (value && value !== NIL ? value : null);

async function nextNumber(
  db: DbContext,
  table: typeof hospitalSequences | typeof canteenSequences,
  kind: string,
  on: string,
): Promise<string> {
  const year = Number(on.slice(0, 4));
  const [row] = await db.db
    .insert(table)
    .values({ kind, year, last: 1 })
    .onConflictDoUpdate({ target: [table.kind, table.year], set: { last: sql`${table.last} + 1` } })
    .returning({ last: table.last });
  return serial(kind, year, row!.last);
}

function needsCutOver(context: EtlContext, report: LoaderReport, what: string): string | null {
  if (!context.cutOver) report.notes.push(`No --cut-over day given: ${what} not brought over`);
  return context.cutOver;
}

// ---- Masters an admission needs

/** Old Marketing.CorporateClients → corporate clients (a credit client's bills are due from the company). */
export function corporateClientsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'corporate-clients',
    entity: 'corporate-client',
    max: 150,
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [Address], [ContactPerson], [ContactNumber], [IsCredit],
      [IsDeleted] FROM [Marketing].[CorporateClients]`,
    existing: () => db.db.select({ id: corporateClients.id, name: corporateClients.name }).from(corporateClients),
    insert: async (row) => {
      await db.db.insert(corporateClients).values({
        id: row.id,
        name: row.name,
        address: text(row['Address'], 300),
        contactPerson: text(row['ContactPerson'], 150),
        contactNo: text(row['ContactNumber'], 50),
        payment: row['IsCredit'] === true ? 'credit' : 'cash',
        isActive: row['IsDeleted'] !== true,
      });
    },
  });
}

/** Old Hospital.CabinTypes → bed categories, with the admission fee (the old daily rates were on each cabin). */
export function bedCategoriesLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'bed-categories',
    entity: 'bed-category',
    query: `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [CabinType] AS [Name], [AdmissionFee] FROM [Hospital].[CabinTypes]`,
    existing: () => db.db.select({ id: bedCategories.id, name: bedCategories.name }).from(bedCategories),
    insert: async (row) => {
      await db.db.insert(bedCategories).values({
        id: row.id,
        name: row.name,
        admissionFee: Math.max(0, Number(row['AdmissionFee'] ?? 0)),
        isIntensive: isIntensive(row.name),
      });
    },
  });
}

/**
 * Old Hospital.Cabins → beds, in a ward for each floor and department the old cabins were on (the old system had no
 * ward: "Medicine (3rd floor)"). Each keeps its own daily rate.
 */
export function bedsLoader(db: DbContext): Loader {
  return {
    name: 'beds',
    dependsOn: ['bed-categories'],
    async run(context, report) {
      const floors = new Map(
        (
          await context.source.query<{ Id: string; Name: string | null }>(
            'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Hospital].[Floors]',
          )
        ).map((row) => [row.Id.toLowerCase(), text(row.Name, 40)]),
      );
      const departments = new Map(
        (
          await context.source.query<{ Id: string; Name: string | null }>(
            'SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name] FROM [Hospital].[HDepartments]',
          )
        ).map((row) => [row.Id.toLowerCase(), text(row.Name, 55)]),
      );
      const wardIds = new Map(
        (await db.db.select({ id: wards.id, name: wards.name }).from(wards)).map((row) => [
          row.name.toLowerCase(),
          row.id,
        ]),
      );
      const codes = new Map(
        (await db.db.select({ id: beds.id, code: beds.code }).from(beds)).map((row) => [
          row.code.toUpperCase(),
          row.id,
        ]),
      );
      const rows = await context.source.query<{
        Id: string;
        CabinNo: string | null;
        Rent: number | null;
        CabinTypeId: string;
        FloorId: string | null;
        HDepartmentId: string | null;
        IsActive: boolean | null;
        IsDeleted: boolean | null;
        DisplayOrder: number | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [CabinNo], [Rent], CAST([CabinTypeId] AS nvarchar(36)) AS [CabinTypeId],
          CAST([FloorId] AS nvarchar(36)) AS [FloorId], CAST([HDepartmentId] AS nvarchar(36)) AS [HDepartmentId],
          [IsActive], [IsDeleted], [DisplayOrder] FROM [Hospital].[Cabins] ORDER BY [DisplayOrder], [CabinNo]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'bed', row.Id))) continue;
        const code = text(row.CabinNo, 20)?.toUpperCase();
        const categoryId = await context.ids.get('bed-category', row.CabinTypeId);
        if (!code || !categoryId) {
          noteRejection(report, row.Id, code ? 'category_not_brought' : 'no_code');
          continue;
        }
        let id = codes.get(code);
        if (!id) {
          const floor = floors.get(row.FloorId?.toLowerCase() ?? '') ?? null;
          const department = departments.get(row.HDepartmentId?.toLowerCase() ?? '') ?? null;
          const wardName = department && floor ? `${department} (${floor})` : (department ?? floor ?? 'General ward');
          let wardId = wardIds.get(wardName.toLowerCase());
          if (!wardId) {
            wardId = randomUUID();
            await db.db.insert(wards).values({ id: wardId, name: wardName, floor });
            wardIds.set(wardName.toLowerCase(), wardId);
            report.notes.push(`Ward ${wardName}`);
          }
          id = randomUUID();
          await db.db.insert(beds).values({
            id,
            code,
            wardId,
            categoryId,
            dailyRate: Number(row.Rent ?? 0) > 0 ? Math.round(Number(row.Rent) * 100) / 100 : null,
            displayOrder: Math.min(32_767, Math.max(0, Number(row.DisplayOrder ?? 0))),
            isActive: row.IsActive !== false && row.IsDeleted !== true,
          });
          codes.set(code, id);
          report.written += 1;
        }
        await context.ids.set('bed', row.Id, id);
      }
    },
  };
}

/** The service brought-over charges are billed under (a group and a service of their own, made once). */
async function broughtOverService(db: DbContext): Promise<string> {
  const [existing] = await db.db
    .select({ id: services.id })
    .from(services)
    .where(sql`upper(${services.code}) = ${BROUGHT_OVER_CODE}`);
  if (existing) return existing.id;
  let [group] = await db.db
    .select({ id: serviceGroups.id })
    .from(serviceGroups)
    .where(
      and(isNull(serviceGroups.parentId), sql`lower(${serviceGroups.name}) = ${BROUGHT_OVER_GROUP.toLowerCase()}`),
    );
  if (!group) {
    group = { id: randomUUID() };
    await db.db.insert(serviceGroups).values({ id: group.id, name: BROUGHT_OVER_GROUP });
  }
  const id = randomUUID();
  await db.db.insert(services).values({
    id,
    code: BROUGHT_OVER_CODE,
    name: BROUGHT_OVER_SERVICE,
    groupId: group.id,
    rate: 0,
    isOpd: false,
    isIpd: true,
    isActive: false,
  });
  return id;
}

/**
 * Patients still admitted in the old system at the cut-over → open admissions here, to be billed and discharged
 * here:
 * - the stay from its old admission time, with its bed history (old IPDCabinAllocationRecords) at each bed's rate;
 * - the consultant, referring doctor and corporate client;
 * - the admission fee kept for the bill;
 * - the advances and refunds (old AdvancePayments), already in the books (13b), so without vouchers;
 * - the services given before the cut-over (old IPDServiceRecords, never posted to the old books) as one charge,
 *   billed at discharge.
 * The final bill here charges every bed night, the round fee and the service charge, as for any stay.
 */
export function openAdmissionsLoader(db: DbContext): Loader {
  return {
    name: 'open-admissions',
    dependsOn: ['patients', 'doctors', 'beds', 'corporate-clients', 'opening-balances'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report, 'admitted patients were');
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const admitted = `[Hospital].[IPDPatientRecords] p WHERE p.[IsDeleted] = 0 AND p.[Status] = 'Admitted'
        AND p.[AdmissionDateTime] < @cutOver`;
      const rows = await context.source.query<{
        Id: string;
        UHID: number;
        InvoiceNo: number | null;
        AdmissionDateTime: Date;
        RefdDoctorId: string | null;
        AssignedDoctorId: string | null;
        CorporateClientId: string | null;
        AdmissionFee: number | null;
        Remarks: string | null;
      }>(
        `SELECT CAST(p.[Id] AS nvarchar(36)) AS [Id], p.[UHID], p.[InvoiceNo], p.[AdmissionDateTime],
          CAST(p.[RefdDoctorId] AS nvarchar(36)) AS [RefdDoctorId], CAST(p.[AssignedDoctorId] AS nvarchar(36)) AS [AssignedDoctorId],
          CAST(p.[CorporateClientId] AS nvarchar(36)) AS [CorporateClientId], p.[AdmissionFee], p.[Remarks]
          FROM ${admitted} ORDER BY p.[AdmissionDateTime]`,
        { cutOver },
      );
      const group = <T extends { PatientId: string }>(list: T[]) => {
        const map = new Map<string, T[]>();
        for (const item of list)
          map.set(item.PatientId.toLowerCase(), [...(map.get(item.PatientId.toLowerCase()) ?? []), item]);
        return map;
      };
      const allocations = group(
        await context.source.query<{
          PatientId: string;
          CabinId: string;
          AllocationDateTime: Date;
          ReleaseDateTime: Date | null;
          AllocationOrder: number | null;
        }>(
          `SELECT CAST(a.[PatientId] AS nvarchar(36)) AS [PatientId], CAST(a.[CabinId] AS nvarchar(36)) AS [CabinId],
            a.[AllocationDateTime], a.[ReleaseDateTime], a.[AllocationOrder]
            FROM [Hospital].[IPDCabinAllocationRecords] a JOIN ${admitted.replace('p WHERE', 'p ON p.[Id] = a.[PatientId] WHERE')}
            AND a.[IsDeleted] = 0 AND a.[IsOccupiedByPatient] = 1`,
          { cutOver },
        ),
      );
      const advances = group(
        await context.source.query<{
          PatientId: string;
          PayDate: Date | null;
          Amount: number | null;
          TransactionType: number | string | null;
        }>(
          `SELECT CAST(a.[IPDPatientId] AS nvarchar(36)) AS [PatientId], a.[PayDate], a.[Amount], a.[TransactionType]
            FROM [Hospital].[AdvancePayments] a JOIN ${admitted.replace('p WHERE', 'p ON p.[Id] = a.[IPDPatientId] WHERE')}
            AND a.[IsDeleted] = 0 AND a.[PayDate] < @cutOver ORDER BY a.[PayDate]`,
          { cutOver },
        ),
      );
      const given = group(
        await context.source.query<{
          PatientId: string;
          Services: number;
          Amount: number | null;
          Charge: number | null;
        }>(
          `SELECT CAST(s.[IPDPatientId] AS nvarchar(36)) AS [PatientId], COUNT(*) AS [Services],
            SUM(CAST(s.[Amount] AS decimal(19, 4))) AS [Amount], SUM(CAST(s.[ServiceCharge] AS decimal(19, 4))) AS [Charge]
            FROM [Hospital].[IPDServiceRecords] s JOIN ${admitted.replace('p WHERE', 'p ON p.[Id] = s.[IPDPatientId] WHERE')}
            AND s.[IsDeleted] = 0 AND s.[ServiceDatetime] < @cutOver GROUP BY s.[IPDPatientId]`,
          { cutOver },
        ),
      );
      const uhids = new Map(
        rows.length
          ? (
              await db.db
                .select({ id: patients.id, uhid: patients.uhid })
                .from(patients)
                .where(
                  inArray(
                    patients.uhid,
                    rows.map((row) => Number(row.UHID)),
                  ),
                )
            ).map((row) => [row.uhid, row.id])
          : [],
      );
      const busy = new Set(
        (await db.db.select({ bedId: bedStays.bedId }).from(bedStays).where(isNull(bedStays.toAt))).map(
          (row) => row.bedId,
        ),
      );
      const service = rows.length ? await broughtOverService(db) : null;
      let held = 0;
      for (const row of rows) {
        if (!(await isNew(context, report, 'admission', row.Id))) continue;
        const patientId = uhids.get(Number(row.UHID));
        if (!patientId) {
          noteRejection(report, row.Id, 'patient_not_brought');
          continue;
        }
        const [open] = await db.db
          .select({ number: admissions.number })
          .from(admissions)
          .where(and(eq(admissions.patientId, patientId), eq(admissions.status, 'admitted')));
        if (open) {
          noteRejection(report, row.Id, 'already_admitted');
          continue;
        }
        const admittedAt = wallInstant(row.AdmissionDateTime, context.timeZone);
        const stays: { bedId: string; fromAt: Date; toAt: Date | null; rate: number }[] = [];
        let missingBed = false;
        for (const stay of bedHistory(
          (allocations.get(row.Id.toLowerCase()) ?? []).map((allocation) => ({
            bed: allocation.CabinId,
            from: wallInstant(allocation.AllocationDateTime, context.timeZone),
            to: allocation.ReleaseDateTime ? wallInstant(allocation.ReleaseDateTime, context.timeZone) : null,
            order: Number(allocation.AllocationOrder ?? 1),
          })),
          admittedAt,
        )) {
          const bedId = await context.ids.get('bed', stay.bed);
          if (!bedId) {
            missingBed = true;
            break;
          }
          const [bed] = await db.db
            .select({ rate: sql<number>`coalesce(${beds.dailyRate}, ${bedCategories.dailyRate})`.mapWith(Number) })
            .from(beds)
            .innerJoin(bedCategories, eq(bedCategories.id, beds.categoryId))
            .where(eq(beds.id, bedId));
          stays.push({ bedId, fromAt: stay.fromAt, toAt: stay.toAt, rate: bed!.rate });
        }
        const current = stays.at(-1);
        if (missingBed || !current) {
          noteRejection(report, row.Id, missingBed ? 'bed_not_brought' : 'no_bed');
          continue;
        }
        if (busy.has(current.bedId)) {
          noteRejection(report, row.Id, 'bed_taken');
          continue;
        }
        const doctorId = oldId(row.AssignedDoctorId) ? await context.ids.get('doctor', row.AssignedDoctorId!) : null;
        const referredById = oldId(row.RefdDoctorId) ? await context.ids.get('doctor', row.RefdDoctorId!) : null;
        const corporateClientId = oldId(row.CorporateClientId)
          ? await context.ids.get('corporate-client', row.CorporateClientId!)
          : null;
        const id = randomUUID();
        const admittedOn = admittedAt.toISOString().slice(0, 10);
        const number = await nextNumber(db, hospitalSequences, 'IP', admittedOn);
        const remarks = text(row.Remarks, 300);
        await db.db.insert(admissions).values({
          id,
          number,
          patientId,
          admittedAt,
          kind: 'elective',
          reason: `Old admission ${row.InvoiceNo ?? ''}`.trim() + (remarks ? `: ${remarks}` : ''),
          referredById,
          corporateClientId,
          admissionFee: Math.max(0, Number(row.AdmissionFee ?? 0)),
          status: 'admitted',
          version: 1,
        });
        await db.db.insert(bedStays).values(
          stays.map((stay) => ({
            id: randomUUID(),
            admissionId: id,
            bedId: stay.bedId,
            fromAt: stay.fromAt,
            toAt: stay.toAt,
            dailyRate: stay.rate,
            reason: 'Brought over from the old system',
          })),
        );
        await db.db.update(beds).set({ status: 'occupied' }).where(eq(beds.id, current.bedId));
        busy.add(current.bedId);
        if (doctorId) {
          await db.db
            .insert(admissionDoctors)
            .values({ id: randomUUID(), admissionId: id, doctorId, role: 'primary', fromAt: admittedAt });
        } else {
          report.notes.push(`${number}: no consultant brought over; assign one`);
        }
        for (const advance of advances.get(row.Id.toLowerCase()) ?? []) {
          const kind = advanceKind(advance.TransactionType);
          const amount = Math.round(Number(advance.Amount ?? 0) * 100) / 100;
          if (!kind || amount <= 0 || !advance.PayDate) continue;
          const paidOn = advance.PayDate.toISOString().slice(0, 10);
          await db.db.insert(ipdPayments).values({
            id: randomUUID(),
            admissionId: id,
            kind,
            number: await nextNumber(db, hospitalSequences, kind === 'advance' ? 'AR' : 'AF', paidOn),
            method: 'cash',
            reference: 'Old system',
            amount,
            paidOn,
          });
          held += kind === 'advance' ? Math.round(amount * 100) : -Math.round(amount * 100);
        }
        const services = given.get(row.Id.toLowerCase())?.[0];
        const amount = services
          ? Math.round((Number(services.Amount ?? 0) + Number(services.Charge ?? 0)) * 100) / 100
          : 0;
        if (services && amount > 0) {
          await db.db.insert(ipdCharges).values({
            id: randomUUID(),
            admissionId: id,
            serviceId: service!,
            chargedOn: on,
            qty: 1,
            rate: amount,
            amount,
            sharePercent: 0,
            note: `${services.Services} service(s) given in the old system before ${cutOver}`,
            status: 'active',
          });
        }
        await context.ids.set('admission', row.Id, id);
        report.written += 1;
      }
      if (report.written) {
        report.notes.push(`Advances held for the admissions brought over: ${(held / 100).toFixed(2)}`);
        report.notes.push(
          'Consultant visits before the cut-over carry no doctor share here: their shares are in the doctors’ payables',
        );
      }
    },
  };
}

/** Each doctor's balance in the old consultant ledger (old ConsultantGlobalLedgers) → an opening entry in theirs. */
export function doctorPayablesLoader(db: DbContext): Loader {
  return {
    name: 'doctor-payables',
    dependsOn: ['doctors'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report, 'doctors’ payables were');
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const rows = await context.source.query<{ ConsultantId: string; Debit: number | null; Credit: number | null }>(
        `SELECT CAST([ConsultantId] AS nvarchar(36)) AS [ConsultantId], SUM(CAST([Debit] AS decimal(19, 4))) AS [Debit],
          SUM(CAST([Credit] AS decimal(19, 4))) AS [Credit] FROM [Account].[ConsultantGlobalLedgers]
          WHERE [IsDeleted] = 0 AND [TranDate] < @cutOver GROUP BY [ConsultantId]`,
        { cutOver },
      );
      let total = 0;
      for (const row of rows) {
        const key = `${row.ConsultantId}:${cutOver}`;
        if (!(await isNew(context, report, 'doctor-payable', key))) continue;
        // What the hospital owes the doctor: earned (credit) less paid (debit).
        const owed = -netPaisa(row.Debit, row.Credit);
        if (owed === 0) continue;
        const doctorId = await context.ids.get('doctor', row.ConsultantId);
        if (!doctorId) {
          noteRejection(report, row.ConsultantId, 'doctor_not_brought');
          continue;
        }
        const id = randomUUID();
        await db.db.insert(doctorLedger).values({
          id,
          doctorId,
          entryOn: on,
          kind: owed > 0 ? 'share' : 'reversal',
          documentNumber: `OPENING-${cutOver}`,
          amount: owed / 100,
        });
        total += owed;
        await context.ids.set('doctor-payable', key, id);
        report.written += 1;
      }
      if (report.written) report.notes.push(`Owed to doctors on ${on}: ${(total / 100).toFixed(2)}`);
    },
  };
}

/** What staff owed service units in the old ledger (old Payroll.StaffGlobalLedgers) → one opening due each. */
export function staffDuesLoader(db: DbContext): Loader {
  return {
    name: 'staff-dues',
    dependsOn: ['staff'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report, 'staff dues were');
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const rows = await context.source.query<{ StaffRecordId: string; Debit: number | null; Credit: number | null }>(
        `SELECT CAST([StaffRecordId] AS nvarchar(36)) AS [StaffRecordId], SUM(CAST([Debit] AS decimal(19, 4))) AS [Debit],
          SUM(CAST([Credit] AS decimal(19, 4))) AS [Credit] FROM [Payroll].[StaffGlobalLedgers]
          WHERE [IsDeleted] = 0 AND [CreatedOn] < @cutOver GROUP BY [StaffRecordId]`,
        { cutOver },
      );
      for (const row of rows) {
        const key = `${row.StaffRecordId}:${cutOver}`;
        if (!(await isNew(context, report, 'staff-due', key))) continue;
        const owed = netPaisa(row.Debit, row.Credit);
        if (owed === 0) continue;
        const staffId = await context.ids.get('staff', row.StaffRecordId);
        if (!staffId) {
          noteRejection(report, row.StaffRecordId, 'staff_not_brought');
          continue;
        }
        const id = randomUUID();
        await db.db.insert(staffDues).values({
          id,
          staffId,
          entryDate: on,
          particulars: `Balance in the old system on ${on}`,
          debit: owed > 0 ? owed / 100 : 0,
          credit: owed < 0 ? -owed / 100 : 0,
          reference: `OPENING-${cutOver}`,
        });
        await context.ids.set('staff-due', key, id);
        report.written += 1;
      }
    },
  };
}

/** Old Account.LoyalMembers → canteen members, by mobile number. */
export function canteenMembersLoader(db: DbContext): Loader {
  return {
    name: 'canteen-members',
    dependsOn: [],
    async run(context, report) {
      const byMobile = new Map(
        (await db.db.select({ id: canteenMembers.id, mobileNo: canteenMembers.mobileNo }).from(canteenMembers)).map(
          (row) => [row.mobileNo, row.id],
        ),
      );
      const rows = await context.source.query<{
        Id: string;
        Name: string | null;
        MobileNo: string | null;
        Address: string | null;
        ReferranceName: string | null;
        IsDeleted: boolean | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], [Name], [MobileNo], [Address], [ReferranceName], [IsDeleted]
          FROM [Account].[LoyalMembers]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'canteen-member', row.Id))) continue;
        const name = text(row.Name, 150);
        const mobileNo = mobile(row.MobileNo);
        if (!name || !mobileNo) {
          noteRejection(report, row.Id, name ? 'no_mobile' : 'no_name');
          continue;
        }
        let id = byMobile.get(mobileNo);
        if (!id) {
          id = randomUUID();
          await db.db.insert(canteenMembers).values({
            id,
            name,
            mobileNo,
            address: text(row.Address, 300),
            reference: text(row.ReferranceName, 150),
            isActive: row.IsDeleted !== true,
          });
          byMobile.set(mobileNo, id);
          report.written += 1;
        } else {
          report.notes.push(`${name}: a member with mobile ${mobileNo} already; the same member`);
        }
        await context.ids.set('canteen-member', row.Id, id);
      }
    },
  };
}

/**
 * Each canteen member's due in the old ledger (old Account.LoyalMemberLedgers) → an opening due here: a sale of no
 * items at the first canteen outlet, owed in full, so the member's dues and collections carry on.
 */
export function canteenDuesLoader(db: DbContext): Loader {
  return {
    name: 'canteen-dues',
    dependsOn: ['canteen-members'],
    async run(context, report) {
      const cutOver = needsCutOver(context, report, 'canteen members’ dues were');
      if (!cutOver) return;
      const on = dayBefore(cutOver);
      const rows = await context.source.query<{ LoyalMemberId: string; Debit: number | null; Credit: number | null }>(
        `SELECT CAST([LoyalMemberId] AS nvarchar(36)) AS [LoyalMemberId], SUM(CAST([Debit] AS decimal(19, 4))) AS [Debit],
          SUM(CAST([Credit] AS decimal(19, 4))) AS [Credit] FROM [Account].[LoyalMemberLedgers]
          WHERE [IsDeleted] = 0 AND ISNULL([Invdate], [CreatedOn]) < @cutOver GROUP BY [LoyalMemberId]`,
        { cutOver },
      );
      const [outlet] = await db.db
        .select({ id: canteenOutlets.id, name: canteenOutlets.name })
        .from(canteenOutlets)
        .orderBy(asc(canteenOutlets.name))
        .limit(1);
      for (const row of rows) {
        const key = `${row.LoyalMemberId}:${cutOver}`;
        if (!(await isNew(context, report, 'canteen-due', key))) continue;
        const due = netPaisa(row.Debit, row.Credit);
        if (due <= 0) {
          if (due < 0) report.notes.push(`${row.LoyalMemberId}: paid ${(-due / 100).toFixed(2)} ahead; left out`);
          continue;
        }
        const memberId = await context.ids.get('canteen-member', row.LoyalMemberId);
        if (!memberId || !outlet) {
          noteRejection(report, row.LoyalMemberId, memberId ? 'no_canteen_outlet' : 'member_not_brought');
          continue;
        }
        const id = randomUUID();
        const amount = due / 100;
        await db.db.insert(canteenSales).values({
          id,
          number: await nextNumber(db, canteenSequences, 'CS', on),
          outletId: outlet.id,
          soldOn: on,
          soldAt: new Date(`${on}T00:00:00Z`),
          customerKind: 'member',
          memberId,
          customerName: 'Due in the old system',
          gross: amount,
          discount: 0,
          vat: 0,
          net: amount,
          paid: 0,
          due: amount,
          status: 'billed',
          version: 1,
        });
        await context.ids.set('canteen-due', key, id);
        report.written += 1;
      }
      if (report.rejected && !outlet)
        report.notes.push('Set up a canteen outlet first: opening dues go on a sale there');
    },
  };
}

export function openLoaders(db: DbContext): Loader[] {
  return [
    corporateClientsLoader(db),
    bedCategoriesLoader(db),
    bedsLoader(db),
    openAdmissionsLoader(db),
    doctorPayablesLoader(db),
    staffDuesLoader(db),
    canteenMembersLoader(db),
    canteenDuesLoader(db),
  ];
}
