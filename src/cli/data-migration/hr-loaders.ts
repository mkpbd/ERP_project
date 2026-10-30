import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import {
  designations,
  hrDepartments,
  hrDivisions,
  hrSubDepartments,
  staffRecords,
} from '../../modules/hr/infrastructure/persistence/hr.schema.js';
import {
  leavePolicies,
  leavePolicyEntitlements,
  leaveRecords,
  leaveTypes,
  staffLeaveEntitlements,
  staffLeavePolicies,
} from '../../modules/hr/infrastructure/persistence/leave.schema.js';
import {
  pfLedgerEntries,
  salaryPolicies,
  salaryReviewCycles,
  staffSalaries,
} from '../../modules/payroll/infrastructure/persistence/payroll.schema.js';
import { dayBefore, text } from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import {
  leaveTypeCode,
  pfOpening,
  POLICY_COLUMNS,
  policyLeaveType,
  salaryRecord,
  staffRecord,
  withinYear,
  type LegacySalary,
  type LegacyStaff,
} from './hr-records.js';

const NIL = '00000000-0000-0000-0000-000000000000';
/** The sub-department staff go under when the old record named none. */
export const GENERAL_SUB_DEPARTMENT = 'General';

async function* pages<T extends Record<string, unknown>>(
  context: EtlContext,
  query: string,
  key: (row: T) => string,
): AsyncGenerator<T[]> {
  let after = NIL;
  for (;;) {
    const rows = await context.source.query<T>(query, { after, n: context.batchSize });
    if (rows.length === 0) return;
    yield rows;
    after = key(rows[rows.length - 1]!);
    if (rows.length < context.batchSize) return;
  }
}

async function isNew(context: EtlContext, report: LoaderReport, entity: string, id: string): Promise<boolean> {
  report.read += 1;
  if (await context.ids.has(entity, id)) {
    report.kept += 1;
    return false;
  }
  return true;
}

/**
 * A named record, optionally under a parent, matched by name (within the parent when names are unique per parent),
 * else made. The old HR tables have int ids, kept as text in the id map.
 */
function namedLoader(
  db: DbContext,
  spec: {
    name: string;
    entity: string;
    dependsOn?: { loader: string; entity: string };
    query: string;
    existing: () => Promise<{ id: string; name: string; parentId?: string | null }[]>;
    /** Names unique within the parent (true) or across the table (false). */
    perParent?: boolean;
    insert: (row: Record<string, unknown> & { id: string; name: string; parentId: string | null }) => Promise<void>;
  },
): Loader {
  return {
    name: spec.name,
    dependsOn: spec.dependsOn ? [spec.dependsOn.loader] : [],
    async run(context, report) {
      const key = (name: string, parentId: string | null | undefined) =>
        spec.perParent ? `${parentId ?? ''}|${name.toLowerCase()}` : name.toLowerCase();
      const existing = new Map((await spec.existing()).map((row) => [key(row.name, row.parentId), row.id]));
      const rows = await context.source.query<{ Id: number | string; Name: string | null; Parent?: number | null }>(
        spec.query,
      );
      for (const row of rows) {
        const oldId = String(row.Id);
        if (!(await isNew(context, report, spec.entity, oldId))) continue;
        let parentId: string | null = null;
        if (spec.dependsOn) {
          parentId =
            row.Parent === null || row.Parent === undefined
              ? null
              : await context.ids.get(spec.dependsOn.entity, String(row.Parent));
          if (!parentId) {
            noteRejection(report, oldId, 'parent_not_brought');
            continue;
          }
        }
        const name = text(row.Name, 100);
        if (!name) {
          noteRejection(report, oldId, 'no_name');
          continue;
        }
        let id = existing.get(key(name, parentId));
        if (!id) {
          id = randomUUID();
          await spec.insert({ ...row, id, name, parentId });
          existing.set(key(name, parentId), id);
          report.written += 1;
        }
        await context.ids.set(spec.entity, oldId, id);
      }
    },
  };
}

export function hrDivisionsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'hr-divisions',
    entity: 'hr-division',
    query: 'SELECT [Id], [Name] FROM [HR].[Divisions] ORDER BY [Id]',
    existing: () => db.db.select({ id: hrDivisions.id, name: hrDivisions.name }).from(hrDivisions),
    insert: async (row) => {
      await db.db.insert(hrDivisions).values({ id: row.id, name: row.name });
    },
  });
}

export function hrDepartmentsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'hr-departments',
    entity: 'hr-department',
    dependsOn: { loader: 'hr-divisions', entity: 'hr-division' },
    query: 'SELECT [Id], [Name], [DivId] AS [Parent] FROM [HR].[Departments] ORDER BY [Id]',
    existing: () => db.db.select({ id: hrDepartments.id, name: hrDepartments.name }).from(hrDepartments),
    insert: async (row) => {
      await db.db.insert(hrDepartments).values({ id: row.id, name: row.name, divisionId: row.parentId! });
    },
  });
}

export function hrSubDepartmentsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'hr-sub-departments',
    entity: 'hr-sub-department',
    dependsOn: { loader: 'hr-departments', entity: 'hr-department' },
    perParent: true,
    query: 'SELECT [Id], [Name], [DeptId] AS [Parent] FROM [HR].[SubDepartments] ORDER BY [Id]',
    existing: () =>
      db.db
        .select({ id: hrSubDepartments.id, name: hrSubDepartments.name, parentId: hrSubDepartments.departmentId })
        .from(hrSubDepartments),
    insert: async (row) => {
      await db.db.insert(hrSubDepartments).values({ id: row.id, name: row.name, departmentId: row.parentId! });
    },
  });
}

export function designationsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'designations',
    entity: 'designation',
    query: `SELECT [Id], [Name], [JoiningSalaray], [IncrementAfterConfirmation] FROM [HR].[Designations] ORDER BY [Id]`,
    existing: () => db.db.select({ id: designations.id, name: designations.name }).from(designations),
    insert: async (row) => {
      const money = (value: unknown) => Math.max(0, Math.round(Number(value ?? 0) * 100) / 100) || 0;
      await db.db.insert(designations).values({
        id: row.id,
        name: row.name,
        joiningSalary: money(row['JoiningSalaray']),
        incrementAfterConfirmation: money(row['IncrementAfterConfirmation']),
      });
    },
  });
}

export function salaryPoliciesLoader(db: DbContext): Loader {
  return {
    name: 'salary-policies',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (await db.db.select({ id: salaryPolicies.id, name: salaryPolicies.name }).from(salaryPolicies)).map((row) => [
          row.name.toLowerCase(),
          row.id,
        ]),
      );
      const rows = await context.source.query<{
        Id: number;
        PolicyName: string | null;
        BasicInPercentOfTotalAmount: number | null;
        HouseRentInPercentOfBasic: number | null;
        MedicalInPercentOfBasic: number | null;
        PfinPercentOfBasic: number | null;
        CpfinPercentOfBasic: number | null;
      }>(
        `SELECT [Id], [PolicyName], [BasicInPercentOfTotalAmount], [HouseRentInPercentOfBasic],
          [MedicalInPercentOfBasic], [PfinPercentOfBasic], [CpfinPercentOfBasic]
          FROM [Payroll].[GeneralSalaryPolicies] ORDER BY [Id]`,
      );
      const percent = (value: number | null) => Math.min(100, Math.max(0, Math.round((value ?? 0) * 100) / 100));
      for (const row of rows) {
        if (!(await isNew(context, report, 'salary-policy', String(row.Id)))) continue;
        const name = text(row.PolicyName, 100) ?? `Policy ${row.Id}`;
        let id = existing.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await db.db.insert(salaryPolicies).values({
            id,
            name,
            basicPercentOfGross: percent(row.BasicInPercentOfTotalAmount),
            houseRentPercentOfBasic: percent(row.HouseRentInPercentOfBasic),
            medicalPercentOfBasic: percent(row.MedicalInPercentOfBasic),
            pfPercentOfBasic: percent(row.PfinPercentOfBasic),
            cpfPercentOfBasic: percent(row.CpfinPercentOfBasic),
          });
          existing.set(name.toLowerCase(), id);
          report.written += 1;
        }
        await context.ids.set('salary-policy', String(row.Id), id);
      }
    },
  };
}

export function salaryReviewCyclesLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'salary-review-cycles',
    entity: 'salary-review-cycle',
    query: 'SELECT [Id], [Name] FROM [Payroll].[SalaryEvaluationDurations] ORDER BY [Id]',
    existing: () => db.db.select({ id: salaryReviewCycles.id, name: salaryReviewCycles.name }).from(salaryReviewCycles),
    insert: async (row) => {
      await db.db.insert(salaryReviewCycles).values({ id: row.id, name: row.name });
    },
  });
}

/** Old HR.LeaveTypes → leave_types, by name; codes made from the names (Casual Leave → CL). */
export function leaveTypesLoader(db: DbContext): Loader {
  return {
    name: 'leave-types',
    dependsOn: [],
    async run(context, report) {
      const existing = await db.db
        .select({ id: leaveTypes.id, name: leaveTypes.name, code: leaveTypes.code })
        .from(leaveTypes);
      const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row.id]));
      const codes = new Set(existing.map((row) => row.code.toUpperCase()));
      const rows = await context.source.query<{ Id: number; Name: string | null; BanglaName: string | null }>(
        'SELECT [Id], [Name], [BanglaName] FROM [HR].[LeaveTypes] ORDER BY [Id]',
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'leave-type', String(row.Id)))) continue;
        const name = text(row.Name, 100);
        if (!name) {
          noteRejection(report, String(row.Id), 'no_name');
          continue;
        }
        let id = byName.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          const code = leaveTypeCode(name, codes);
          await db.db.insert(leaveTypes).values({ id, code, name, nameBn: text(row.BanglaName, 100) });
          byName.set(name.toLowerCase(), id);
          codes.add(code);
          report.written += 1;
          report.notes.push(`${name}: code ${code}`);
        }
        await context.ids.set('leave-type', String(row.Id), id);
      }
    },
  };
}

/**
 * Old HR.StaffRecords → staff_records, in their department, sub-department (or the department's "General" one when
 * the old record named none) and designation, linked to the user account that was theirs (Users.StaffRecordId).
 */
export function staffLoader(db: DbContext): Loader {
  return {
    name: 'staff',
    dependsOn: ['hr-sub-departments', 'designations', 'users'],
    async run(context, report) {
      const taken = await db.db
        .select({
          no: staffRecords.employeeNo,
          biometric: staffRecords.biometricEnrollmentNo,
          userId: staffRecords.userId,
        })
        .from(staffRecords);
      const numbers = new Set(taken.map((row) => row.no.toUpperCase()));
      const biometrics = new Set(taken.flatMap((row) => (row.biometric ? [row.biometric] : [])));
      const linked = new Set(taken.flatMap((row) => (row.userId ? [row.userId] : [])));
      const accounts = new Map<string, string>();
      for (const row of await context.source.query<{ Id: string; StaffRecordId: string }>(
        `SELECT [Id], CAST([StaffRecordId] AS nvarchar(36)) AS [StaffRecordId] FROM [Identity].[Users]
         WHERE [StaffRecordId] <> @nil`,
        { nil: NIL },
      )) {
        const userId = await context.ids.get('user', row.Id);
        if (userId && !accounts.has(row.StaffRecordId.toLowerCase()))
          accounts.set(row.StaffRecordId.toLowerCase(), userId);
      }
      const general = new Map<string, string>();
      const generalOf = async (departmentId: string) => {
        let id = general.get(departmentId);
        if (id) return id;
        const [found] = await db.db
          .select({ id: hrSubDepartments.id })
          .from(hrSubDepartments)
          .where(
            and(
              eq(hrSubDepartments.departmentId, departmentId),
              sql`lower(${hrSubDepartments.name}) = ${GENERAL_SUB_DEPARTMENT.toLowerCase()}`,
            ),
          );
        id = found?.id ?? randomUUID();
        if (!found) await db.db.insert(hrSubDepartments).values({ id, departmentId, name: GENERAL_SUB_DEPARTMENT });
        general.set(departmentId, id);
        return id;
      };
      const query = `SELECT TOP (@n) CAST([Id] AS nvarchar(36)) AS [Id], [EmployeeNo], [EmployeeName], [FirstName],
        [MiddleName], [LastName], [FatherName], [MotherName], [DateofBirth], [Sex], [MaritalStatus], [Religion],
        [BloodGroup], [NationalityOther], [NationIdorPpno], [TINNo], [MobileNo], [OfficialMobileNo], [EmailId],
        [GuardianContact], [PresentAddress], [PermanentAddress], [JoiningDate], [ProvableConfirmationdate],
        [Confirmationdate], [EmployeeCategory], [EmployeeJobLocation], [ServiceNature], [SalaryStatus], [PaymentMode],
        [BankAccountNo], [BiometricEnrollmentNo], [IsHoD], [WorkingTime], [TimeofInterval], [WeeklyHoliday],
        [ShiftAndRelay], [DescriptionOfChangeGroup], [BNMC], [BMDC], [Remarks], [IsSeparated], [IsInActive],
        [InActiveReasons], [ResignationDate], [LastModifiedOn], [IsDeleted], [DivisionId], [DeptId], [SubDeptId],
        [DesignationId], [JoiningDesignationId]
        FROM [HR].[StaffRecords] WHERE [Id] > @after ORDER BY [Id]`;
      type Row = LegacyStaff & {
        DivisionId: number | null;
        DeptId: number;
        SubDeptId: number | null;
        DesignationId: number;
        JoiningDesignationId: number | null;
      };
      for await (const page of pages<Row & Record<string, unknown>>(context, query, (row) => row.Id)) {
        for (const row of page) {
          if (!(await isNew(context, report, 'staff', row.Id))) continue;
          const result = staffRecord(row);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          const staff = result.value;
          if (numbers.has(staff.employeeNo)) {
            noteRejection(report, row.Id, 'employee_no_taken');
            continue;
          }
          const departmentId = await context.ids.get('hr-department', String(row.DeptId));
          const designationId = await context.ids.get('designation', String(row.DesignationId));
          if (!departmentId || !designationId) {
            noteRejection(report, row.Id, departmentId ? 'designation_not_brought' : 'department_not_brought');
            continue;
          }
          const subDepartmentId =
            (row.SubDeptId ? await context.ids.get('hr-sub-department', String(row.SubDeptId)) : null) ??
            (await generalOf(departmentId));
          let biometric = staff.biometricEnrollmentNo;
          if (biometric && biometrics.has(biometric)) {
            report.notes.push(`${staff.employeeNo}: biometric no. ${biometric} is another person's; left out`);
            biometric = null;
          }
          let userId = accounts.get(row.Id.toLowerCase()) ?? null;
          if (userId && linked.has(userId)) userId = null;
          const id = randomUUID();
          await db.db.insert(staffRecords).values({
            ...staff,
            id,
            biometricEnrollmentNo: biometric,
            divisionId: row.DivisionId ? await context.ids.get('hr-division', String(row.DivisionId)) : null,
            departmentId,
            subDepartmentId,
            designationId,
            joiningDesignationId: row.JoiningDesignationId
              ? await context.ids.get('designation', String(row.JoiningDesignationId))
              : null,
            userId,
          });
          numbers.add(staff.employeeNo);
          if (biometric) biometrics.add(biometric);
          if (userId) linked.add(userId);
          await context.ids.set('staff', row.Id, id);
          report.written += 1;
        }
      }
      if (general.size)
        report.notes.push(
          `Staff without a sub-department went under "${GENERAL_SUB_DEPARTMENT}" (${general.size} departments)`,
        );
    },
  };
}

/** Old Payroll.IndividualSalaries → staff_salaries, for staff brought over (one salary each). */
export function staffSalariesLoader(db: DbContext): Loader {
  return {
    name: 'staff-salaries',
    dependsOn: ['staff', 'salary-policies', 'salary-review-cycles'],
    async run(context, report) {
      const query = `SELECT TOP (@n) CAST(s.[Id] AS nvarchar(36)) AS [Id], CAST(s.[EmployeeId] AS nvarchar(36)) AS [EmployeeId],
        s.[BasicAmount], s.[HouseRentInPercentOfBasic], s.[MedicalAllownceInPercentOfBasic], s.[Conveyance],
        s.[OtherAllowance], s.[Others], s.[SpecialAllowance], s.[Pf], s.[Cpf], s.[TotalSalary], s.[OvertimePerHour],
        s.[FixedAmount], s.[IsPFDeductionOn], s.[TaxableAmount], s.[GeneralSalaryPolicyId], s.[SalaryEvaluationDurationId],
        t.[Name] AS [IncrementType]
        FROM [Payroll].[IndividualSalaries] s LEFT JOIN [Payroll].[IncrementTypes] t ON t.[Id] = s.[IncermentTypeId]
        WHERE s.[IsDeleted] = 0 AND s.[Id] > @after ORDER BY s.[Id]`;
      type Row = LegacySalary & {
        Id: string;
        GeneralSalaryPolicyId: number;
        SalaryEvaluationDurationId: number | null;
      };
      const paid = new Set(
        (await db.db.select({ staffId: staffSalaries.staffId }).from(staffSalaries)).map((row) => row.staffId),
      );
      for await (const page of pages<Row & Record<string, unknown>>(context, query, (row) => row.Id)) {
        for (const row of page) {
          if (!(await isNew(context, report, 'staff-salary', row.Id))) continue;
          const staffId = await context.ids.get('staff', row.EmployeeId);
          if (!staffId) {
            noteRejection(report, row.Id, 'staff_not_brought');
            continue;
          }
          if (paid.has(staffId)) {
            noteRejection(report, row.Id, 'salary_already_set');
            continue;
          }
          const policyId = await context.ids.get('salary-policy', String(row.GeneralSalaryPolicyId));
          if (!policyId) {
            noteRejection(report, row.Id, 'policy_not_brought');
            continue;
          }
          const result = salaryRecord(row);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          await db.db.insert(staffSalaries).values({
            staffId,
            policyId,
            ...result.value,
            reviewCycleId: row.SalaryEvaluationDurationId
              ? await context.ids.get('salary-review-cycle', String(row.SalaryEvaluationDurationId))
              : null,
          });
          paid.add(staffId);
          await context.ids.set('staff-salary', row.Id, staffId);
          report.written += 1;
        }
      }
    },
  };
}

/** Old HR.LeavePolicies (a year each, fixed day columns) → leave_policies with an entitlement per leave type. */
export function leavePoliciesLoader(db: DbContext): Loader {
  return {
    name: 'leave-policies',
    dependsOn: ['leave-types'],
    async run(context, report) {
      const types = await db.db.select({ id: leaveTypes.id, name: leaveTypes.name }).from(leaveTypes);
      const years = new Set(
        (await db.db.select({ year: leavePolicies.year }).from(leavePolicies)).map((row) => row.year),
      );
      const rows = await context.source.query<Record<string, number | boolean | null> & { Id: number; Year: number }>(
        `SELECT [Id], [Year], [Cl], [Ml], [MedicalLeave], [AnnualLeave], [FestivalLeave], [GovtLeave], [AbsentDeduction],
          [LateConsiderAfterMins], [OnedaySalaryDeductionForLateInDays]
          FROM [HR].[LeavePolicies] WHERE [IsDeleted] = 0 ORDER BY [Year]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'leave-policy', String(row.Id)))) continue;
        if (row.Year < 2000 || row.Year > 2100) {
          noteRejection(report, String(row.Id), 'invalid_year');
          continue;
        }
        if (years.has(row.Year)) {
          noteRejection(report, String(row.Id), 'year_has_a_policy');
          continue;
        }
        const small = (value: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(value ?? 0))));
        await db.db.insert(leavePolicies).values({
          year: row.Year,
          lateGraceMinutes: small(row['LateConsiderAfterMins'], 32_767),
          lateCountPerDeduction: small(row['OnedaySalaryDeductionForLateInDays'], 32_767),
          absentDeduction: row['AbsentDeduction'] === true,
        });
        const entitlements: (typeof leavePolicyEntitlements.$inferInsert)[] = [];
        for (const column of POLICY_COLUMNS) {
          const days = small(row[column.column], 366);
          if (days === 0) continue;
          const leaveTypeId = policyLeaveType(column, types);
          if (!leaveTypeId) {
            report.notes.push(`${row.Year}: ${days} days of ${column.label} left out (no single leave type named so)`);
            continue;
          }
          entitlements.push({ year: row.Year, leaveTypeId, days });
        }
        if (entitlements.length) await db.db.insert(leavePolicyEntitlements).values(entitlements);
        years.add(row.Year);
        // Policies are keyed by year, not an id: the map only marks the old row as brought over.
        await context.ids.set('leave-policy', String(row.Id), randomUUID());
        report.written += 1;
      }
    },
  };
}

/** Old HR.IndividualEmployeeLeavePolices + Eligibles → a person's own policy for a year. */
export function staffLeavePoliciesLoader(db: DbContext): Loader {
  return {
    name: 'staff-leave-policies',
    dependsOn: ['staff', 'leave-types'],
    async run(context, report) {
      const rows = await context.source.query<{
        Id: string;
        StaffRecordId: string;
        LeaveYear: number;
        LateConsiderAfterInMins: number | null;
        OneDaySalaryDeductionOnTotalLateCount: number | null;
        AbsentDeduction: boolean | null;
      }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([StaffRecordId] AS nvarchar(36)) AS [StaffRecordId], [LeaveYear],
          [LateConsiderAfterInMins], [OneDaySalaryDeductionOnTotalLateCount], [AbsentDeduction]
          FROM [HR].[IndividualEmployeeLeavePolices] WHERE [IsDeleted] = 0`,
      );
      const days = new Map<string, { LeaveTypeId: number; LeaveDay: number }[]>();
      for (const row of await context.source.query<{ PolicyId: string; LeaveTypeId: number; LeaveDay: number }>(
        `SELECT CAST([IndividualEmployeeLeavePolicyId] AS nvarchar(36)) AS [PolicyId], [LeaveTypeId], [LeaveDay]
          FROM [HR].[IndividualEmployeeLeaveEligibles] WHERE [IsDeleted] = 0`,
      )) {
        const key = row.PolicyId.toLowerCase();
        days.set(key, [...(days.get(key) ?? []), row]);
      }
      const small = (value: unknown, max: number) => Math.min(max, Math.max(0, Math.round(Number(value ?? 0))));
      for (const row of rows) {
        if (!(await isNew(context, report, 'staff-leave-policy', row.Id))) continue;
        const staffId = await context.ids.get('staff', row.StaffRecordId);
        if (!staffId) {
          noteRejection(report, row.Id, 'staff_not_brought');
          continue;
        }
        if (row.LeaveYear < 2000 || row.LeaveYear > 2100) {
          noteRejection(report, row.Id, 'invalid_year');
          continue;
        }
        const inserted = await db.db
          .insert(staffLeavePolicies)
          .values({
            staffId,
            year: row.LeaveYear,
            lateGraceMinutes: small(row.LateConsiderAfterInMins, 32_767),
            lateCountPerDeduction: small(row.OneDaySalaryDeductionOnTotalLateCount, 32_767),
            absentDeduction: row.AbsentDeduction === true,
          })
          .onConflictDoNothing()
          .returning({ staffId: staffLeavePolicies.staffId });
        if (!inserted.length) {
          noteRejection(report, row.Id, 'year_has_a_policy');
          continue;
        }
        const entitlements = new Map<string, number>();
        for (const entry of days.get(row.Id.toLowerCase()) ?? []) {
          const leaveTypeId = await context.ids.get('leave-type', String(entry.LeaveTypeId));
          if (leaveTypeId) entitlements.set(leaveTypeId, small(entry.LeaveDay, 366));
        }
        if (entitlements.size) {
          await db.db.insert(staffLeaveEntitlements).values(
            [...entitlements].map(([leaveTypeId, value]) => ({
              staffId,
              year: row.LeaveYear,
              leaveTypeId,
              days: value,
            })),
          );
        }
        await context.ids.set('staff-leave-policy', row.Id, staffId);
        report.written += 1;
      }
    },
  };
}

/**
 * The leave already taken (or approved) in the cut-over year, so this year's balances carry on: the old approved
 * applications of that year → leave_records with their type. Earlier years' leave stays in the old database.
 */
export function leaveTakenLoader(db: DbContext): Loader {
  return {
    name: 'leave-taken',
    dependsOn: ['staff', 'leave-types'],
    async run(context, report) {
      if (!context.cutOver) {
        report.notes.push("No --cut-over day given: this year's leave taken was not brought over");
        return;
      }
      const year = Number(context.cutOver.slice(0, 4));
      const rows = await context.source.query<{
        Id: number;
        StaffRecordId: string;
        LeaveTypeIds: number;
        StartDate: Date;
        EndDate: Date;
        AppSubject: string | null;
      }>(
        `SELECT [Id], CAST([StaffRecordId] AS nvarchar(36)) AS [StaffRecordId], [LeaveTypeIds], [StartDate], [EndDate],
          [AppSubject] FROM [HR].[LeaveApplications]
          WHERE [IsDeleted] = 0 AND [LeaveApprovalStatus] = 'Approved' AND [StartDate] <= @yearEnd AND [EndDate] >= @yearStart
          ORDER BY [Id]`,
        { yearStart: `${year}-01-01`, yearEnd: `${year}-12-31` },
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'leave-taken', String(row.Id)))) continue;
        const staffId = await context.ids.get('staff', row.StaffRecordId);
        const leaveTypeId = await context.ids.get('leave-type', String(row.LeaveTypeIds));
        if (!staffId || !leaveTypeId) {
          noteRejection(report, String(row.Id), staffId ? 'leave_type_not_brought' : 'staff_not_brought');
          continue;
        }
        const period = withinYear(row.StartDate, row.EndDate, year);
        if (!period) {
          noteRejection(report, String(row.Id), 'not_in_the_year');
          continue;
        }
        const id = randomUUID();
        await db.db.insert(leaveRecords).values({
          id,
          staffId,
          leaveTypeId,
          ...period,
          purpose: text(row.AppSubject, 300),
          remarks: 'Approved in the old system',
        });
        await context.ids.set('leave-taken', String(row.Id), id);
        report.written += 1;
      }
    },
  };
}

/** Each person's PF balance in the old ledger the day before the cut-over → one opening entry. */
export function pfOpeningsLoader(db: DbContext): Loader {
  return {
    name: 'pf-openings',
    dependsOn: ['staff'],
    async run(context, report) {
      if (!context.cutOver) {
        report.notes.push('No --cut-over day given: PF balances were not brought over');
        return;
      }
      const on = dayBefore(context.cutOver);
      const rows = await context.source.query<{ StaffRecordId: string; Credit: number | null; Debit: number | null }>(
        `SELECT CAST([StaffRecordId] AS nvarchar(36)) AS [StaffRecordId],
          SUM(CAST([Credit] AS decimal(19, 4))) AS [Credit], SUM(CAST([Debit] AS decimal(19, 4))) AS [Debit]
          FROM [Payroll].[PFLedgers] WHERE [IsDeleted] = 0 AND [TranDate] < @cutOver GROUP BY [StaffRecordId]`,
        { cutOver: context.cutOver },
      );
      let total = 0;
      for (const row of rows) {
        const key = `${row.StaffRecordId}:${context.cutOver}`;
        if (!(await isNew(context, report, 'pf-opening', key))) continue;
        const opening = pfOpening(Number(row.Credit ?? 0), Number(row.Debit ?? 0));
        if (!opening) continue;
        const staffId = await context.ids.get('staff', row.StaffRecordId);
        if (!staffId) {
          noteRejection(report, row.StaffRecordId, 'staff_not_brought');
          continue;
        }
        const id = randomUUID();
        await db.db.insert(pfLedgerEntries).values({
          id,
          staffId,
          entryDate: on,
          type: 'opening',
          ...opening,
          remarks: `PF balance in the old system on ${on}`,
        });
        total += Math.round(opening.credit * 100) - Math.round(opening.debit * 100);
        if (opening.debit)
          report.notes.push(`${row.StaffRecordId}: the old PF ledger was overdrawn by ${opening.debit}`);
        await context.ids.set('pf-opening', key, id);
        report.written += 1;
      }
      if (report.written) report.notes.push(`PF balances brought over on ${on}: ${(total / 100).toFixed(2)} in all`);
    },
  };
}

export function hrLoaders(db: DbContext): Loader[] {
  return [
    hrDivisionsLoader(db),
    hrDepartmentsLoader(db),
    hrSubDepartmentsLoader(db),
    designationsLoader(db),
    leaveTypesLoader(db),
    staffLoader(db),
    salaryPoliciesLoader(db),
    salaryReviewCyclesLoader(db),
    staffSalariesLoader(db),
    leavePoliciesLoader(db),
    staffLeavePoliciesLoader(db),
    leaveTakenLoader(db),
    pfOpeningsLoader(db),
  ];
}
