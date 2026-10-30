import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LegacySource } from '../../src/cli/data-migration/etl.js';
import { legacyLoaders } from '../../src/cli/data-migration/legacy-loaders.js';
import { runEtl } from '../../src/cli/data-migration/runner.js';
import { DbContext } from '../../src/database/drizzle-transaction-manager.js';
import {
  accountNatures,
  glAccounts,
  glRoles,
  subLedgers,
} from '../../src/modules/accounts/infrastructure/persistence/accounts.schema.js';
import { etlRuns } from '../../src/modules/data-migration/infrastructure/persistence/data-migration.schema.js';
import { doctors, patients } from '../../src/modules/hospital/infrastructure/persistence/hospital.schema.js';
import { hrSubDepartments, staffRecords } from '../../src/modules/hr/infrastructure/persistence/hr.schema.js';
import {
  leavePolicyEntitlements,
  leaveRecords,
  staffLeaveEntitlements,
} from '../../src/modules/hr/infrastructure/persistence/leave.schema.js';
import { users } from '../../src/modules/identity/infrastructure/persistence/identity.schema.js';
import { pfLedgerEntries, staffSalaries } from '../../src/modules/payroll/infrastructure/persistence/payroll.schema.js';
import { TransactionManager } from '../../src/shared/application/ports/transaction-manager.js';
import { aspNetIdentityHash } from '../support/aspnet-hash.js';
import { ADMIN, bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let http: App;
const NIL = '00000000-0000-0000-0000-000000000000';
const DOCTOR = '6f1d2c3b-0000-4000-8000-000000000001';
const MEDICINE = '6f1d2c3b-0000-4000-8000-0000000000aa';
const registered = new Date('2026-02-01T00:00:00Z');

const tables = {
  roles: [
    { Id: 'r-doc', Name: 'Doctor' },
    { Id: 'r-front', Name: 'Receptionist' },
  ],
  users: [
    {
      Id: 'u-1',
      UserName: 'Rana',
      Email: null,
      PasswordHash: aspNetIdentityHash('Old-Passw0rd!'),
      FirstName: 'Rana',
      LastName: 'Ahmed',
      FullName: null,
      IsActive: true,
      IsDeleted: false,
      CreatedOn: new Date('2024-01-01T00:00:00Z'),
      DoctorId: NIL,
      StaffRecordId: 's-1',
    },
    {
      Id: 'u-2',
      UserName: 'nusrat',
      Email: 'Nusrat@Example.com',
      PasswordHash: aspNetIdentityHash('Doctor-Passw0rd!', 'v2'),
      FirstName: null,
      LastName: null,
      FullName: 'Dr. Nusrat Jahan',
      IsActive: true,
      IsDeleted: false,
      CreatedOn: null,
      DoctorId: DOCTOR,
      StaffRecordId: NIL,
    },
    {
      Id: 'u-3',
      UserName: null,
      Email: null,
      PasswordHash: null,
      FirstName: 'Ghost',
      LastName: null,
      FullName: null,
      IsActive: false,
      IsDeleted: true,
      CreatedOn: null,
      DoctorId: NIL,
      StaffRecordId: NIL,
    },
  ],
  userRoles: [
    { UserId: 'u-1', RoleId: 'r-front' },
    { UserId: 'u-2', RoleId: 'r-doc' },
    { UserId: 'u-3', RoleId: 'r-front' },
  ],
  specialities: [{ Id: MEDICINE, Name: 'Medicine' }],
  doctors: [
    {
      Id: DOCTOR,
      Name: 'Dr. Nusrat Jahan',
      DoctorCodeNo: 'D-101',
      PhoneFax: null,
      DoctorFieldOfSpecialityId: MEDICINE,
      OPDChamberVisitFeeMaiden: 1000,
      OPDChamberVisitFeeNew: 800,
      OPDChamberVisitFeeOld: 500,
      OPDChamberReportConsultancyFee: 300,
      IsDeleted: false,
    },
    {
      Id: '6f1d2c3b-0000-4000-8000-000000000002',
      Name: '  ',
      DoctorCodeNo: null,
      PhoneFax: null,
      DoctorFieldOfSpecialityId: null,
      OPDChamberVisitFeeMaiden: 0,
      OPDChamberVisitFeeNew: 0,
      OPDChamberVisitFeeOld: 0,
      OPDChamberReportConsultancyFee: 0,
      IsDeleted: false,
    },
  ],
  patients: [25000500, 26000010, 26000011, 26000012].map((uhid, index) => ({
    Id: `p-${uhid}`,
    UHID: uhid,
    Title: null,
    GivenName: null,
    Surname: null,
    FullName: ['Rahima Begum', 'Abdul Karim', 'Selim Reza', 'No Phone'][index],
    AgeYear: index === 2 ? '30' : null,
    AgeMonth: null,
    AgeDay: null,
    Dob: index === 2 ? null : new Date('1980-05-17T00:00:00Z'),
    Sex: index === 0 ? 'Female' : 'M',
    FatherName: null,
    MotherName: null,
    SpouseName: null,
    MaritalStatus: null,
    Profession: null,
    MobileNo: index === 3 ? null : `0171100000${index}`,
    Email: null,
    CareOf: null,
    HouseNo: null,
    RoadNo: null,
    Village: null,
    Po: null,
    ArearOrThana: null,
    District: null,
    Cpname: null,
    Cpmobile: null,
    Cpaddress: null,
    RelationWithPatient: null,
    BloodGroup: index === 0 ? 'O+ve' : null,
    NationalId: null,
    RegDate: registered,
    IsDeleted: false,
  })),
};

const CASH = 'bd52240a-d093-4f02-6ef4-08dc73f57d74';
const IPD_RECEIVABLE = '5d525e24-31a9-444d-558d-08dc9d9989d2';
const natures = [
  [1, 'Assets', 'Balance Sheet'],
  [2, 'Liabilities', 'Balance Sheet'],
  [3, 'Equity', 'Balance Sheet'],
  [4, 'Income', 'Profit and Loss Account'],
  [5, 'Expenses', 'Profit and Loss Account'],
] as const;
const gl = (Id: string, GLCodeNo: string | null, nature: number, extra: Record<string, unknown> = {}) => ({
  Id,
  Name: `Account ${GLCodeNo ?? Id}`,
  GLCodeNo,
  Level5HeadId: `h5-${nature}`,
  COADescriptionId: nature === 1 ? 'coa-1' : NIL,
  IsControlAccount: false,
  IsCostCenter: false,
  BankCashOth: 'Oth',
  IsActive: true,
  IsRecurringCost: false,
  IsBillingContainDetails: false,
  IsDeleted: false,
  ...extra,
});
const balance = (GeneralLedgerId: string, Debit: number, Credit: number, sub: string = NIL, cost: string = NIL) => ({
  GeneralLedgerId,
  SubLedgerId: sub,
  CostCenterId: cost,
  Debit,
  Credit,
});

/** The old books: a five-nature chart, a few accounts and their summed vouchers up to the cut-over. */
const books = {
  tables: {
    NatureOfAccounts: [
      ...natures.map(([Id, Name, Statement]) => ({ Id, Name, CodeNo: String(Id), Statement })),
      { Id: 9, Name: 'Miscellaneous', CodeNo: '9', Statement: null },
    ],
    Categories: natures.map(([n, name]) => ({ Id: `c-${n}`, Parent: n, Name: `${name} group`, CodeNo: `${n}0` })),
    SubCategories: natures.map(([n, name]) => ({ Id: `s-${n}`, Parent: `c-${n}`, Name: `${name} sub-group` })),
    Level4Heads: natures.map(([n, name]) => ({ Id: `h4-${n}`, Parent: `s-${n}`, Name: `${name} head` })),
    Level5Heads: natures.map(([n, name]) => ({ Id: `h5-${n}`, Parent: `h4-${n}`, Name: `${name} sub-head` })),
    COADescription: [{ Id: 'coa-1', Name: 'Current assets', CodeNo: 'CA' }],
    CostCenters: [{ Id: 'cc-1', Name: 'Ward', Description: 'General ward' }],
    Banks: [
      {
        Id: 'b-1',
        BankName: 'Sonali Bank',
        BranchAddress: "Cox's Bazar",
        ContactNo: null,
        AccountNo: '0011-22',
        Signatories: null,
      },
      { Id: 'b-2', BankName: 'Nameless', BranchAddress: null, ContactNo: null, AccountNo: null, Signatories: null },
    ],
    SubLedgerTypes: [
      { Id: 'slt-1', Name: 'IPD Patient' },
      { Id: 'slt-2', Name: 'Supplier' },
    ],
    JournalTypes: [
      { Id: 'jt-1', Name: 'Journal Voucher', ShortName: 'JV', Description: null },
      { Id: 'jt-2', Name: 'Receipt Voucher', ShortName: 'RV', Description: null },
    ],
    FiscalYears: [
      { Id: 'fy-1', FYear: 2025 },
      { Id: 'fy-2', FYear: 2026 },
    ],
  } as Record<string, Record<string, unknown>[]>,
  glAccounts: [
    gl(CASH, '1001', 1, { BankCashOth: 'Cash' }),
    gl(IPD_RECEIVABLE, '1002', 1, { IsControlAccount: true }),
    gl('gl-pay', '2001', 2, { IsControlAccount: true }),
    gl('gl-cap', '3001', 3),
    gl('gl-inc', '4001', 4),
    gl('gl-exp', '5001', 5, { IsCostCenter: true }),
    gl('gl-x', null, 5),
  ],
  subLedgers: [
    {
      Id: 'sl-1',
      SubLedgerTypeId: 'slt-1',
      InvoiceNo: 501,
      Name: 'Rahima Begum',
      Address: null,
      MobileNo: null,
      EmailAddress: null,
    },
    {
      Id: 'sl-2',
      SubLedgerTypeId: 'slt-2',
      InvoiceNo: 0,
      Name: 'ACME Pharma',
      Address: null,
      MobileNo: null,
      EmailAddress: null,
    },
  ],
  // Debits exceed credits by 0.01 (float rounding in the old sums); the account without a code nets to nothing.
  balances: [
    balance(CASH, 50_000, 20_000),
    balance(IPD_RECEIVABLE, 12_000, 2_000, 'sl-1'),
    balance('gl-pay', 1_000, 9_000, 'sl-2'),
    balance('gl-cap', 0, 40_000),
    balance('gl-inc', 0, 25_000),
    balance('gl-exp', 33_000.01, 0, NIL, 'cc-1'),
    balance('gl-x', 100, 100),
  ],
};

const staff = (Id: string, extra: Record<string, unknown>) => ({
  Id,
  EmployeeNo: null,
  EmployeeName: null,
  Sex: 'Male',
  JoiningDate: new Date('2020-03-01T00:00:00Z'),
  DivisionId: 1,
  DeptId: 10,
  SubDeptId: null,
  DesignationId: 1,
  JoiningDesignationId: null,
  BiometricEnrollmentNo: 0,
  IsSeparated: false,
  IsInActive: false,
  ResignationDate: null,
  LastModifiedOn: null,
  IsDeleted: false,
  ...extra,
});
const salary = (Id: string, EmployeeId: string) => ({
  Id,
  EmployeeId,
  BasicAmount: 18_000,
  HouseRentInPercentOfBasic: 9_000,
  MedicalAllownceInPercentOfBasic: 1_800,
  Conveyance: 1_200,
  OtherAllowance: 0,
  Others: 0,
  SpecialAllowance: 500,
  Pf: 1_800,
  Cpf: 1_800,
  TotalSalary: 30_000,
  OvertimePerHour: 150,
  FixedAmount: 0,
  IsPFDeductionOn: true,
  TaxableAmount: 0,
  GeneralSalaryPolicyId: 1,
  SalaryEvaluationDurationId: 1,
  IncrementType: 'Percentage(%)',
});

/** The old HR and payroll: structure, four staff records (two left out), a salary, leave and PF. */
const hr = {
  tables: {
    Divisions: [{ Id: 1, Name: 'Medical' }],
    Departments: [
      { Id: 10, Name: 'Nursing', Parent: 1 },
      { Id: 11, Name: 'Accounts', Parent: 1 },
      { Id: 12, Name: 'Orphan', Parent: 99 },
    ],
    SubDepartments: [{ Id: 100, Name: 'Ward nursing', Parent: 10 }],
    Designations: [
      { Id: 1, Name: 'Staff Nurse', JoiningSalaray: 20_000, IncrementAfterConfirmation: 1_000 },
      { Id: 2, Name: 'Accountant', JoiningSalaray: 25_000, IncrementAfterConfirmation: 0 },
    ],
    LeaveTypes: [
      { Id: 1, Name: 'Casual Leave', BanglaName: null },
      { Id: 2, Name: 'Medical Leave', BanglaName: null },
      { Id: 3, Name: 'Maternity Leave', BanglaName: null },
    ],
    GeneralSalaryPolicies: [
      {
        Id: 1,
        PolicyName: 'General',
        BasicInPercentOfTotalAmount: 60,
        HouseRentInPercentOfBasic: 50,
        MedicalInPercentOfBasic: 10,
        PfinPercentOfBasic: 10,
        CpfinPercentOfBasic: 10,
      },
    ],
    SalaryEvaluationDurations: [{ Id: 1, Name: 'Yearly' }],
    LeavePolicies: [
      {
        Id: 1,
        Year: 2027,
        Cl: 10,
        Ml: 112,
        MedicalLeave: 14,
        AnnualLeave: 0,
        FestivalLeave: 11,
        GovtLeave: 0,
        AbsentDeduction: true,
        LateConsiderAfterMins: 15,
        OnedaySalaryDeductionForLateInDays: 3,
      },
    ],
    IndividualEmployeeLeavePolices: [
      {
        Id: 'slp-1',
        StaffRecordId: 's-1',
        LeaveYear: 2027,
        LateConsiderAfterInMins: 30,
        OneDaySalaryDeductionOnTotalLateCount: 0,
        AbsentDeduction: false,
      },
    ],
    IndividualEmployeeLeaveEligibles: [{ PolicyId: 'slp-1', LeaveTypeId: 1, LeaveDay: 12 }],
    LeaveApplications: [
      {
        Id: 1,
        StaffRecordId: 's-1',
        LeaveTypeIds: 1,
        StartDate: new Date('2026-12-30T00:00:00Z'),
        EndDate: new Date('2027-01-02T00:00:00Z'),
        AppSubject: 'Family wedding',
      },
      {
        Id: 2,
        StaffRecordId: 's-1',
        LeaveTypeIds: 1,
        StartDate: new Date('2025-05-01T00:00:00Z'),
        EndDate: new Date('2025-05-02T00:00:00Z'),
        AppSubject: null,
      },
    ],
    PFLedgers: [
      { StaffRecordId: 's-1', Credit: 54_000, Debit: 4_000 },
      { StaffRecordId: 's-2', Credit: 1_000, Debit: 1_000 },
    ],
  } as Record<string, Record<string, unknown>[]>,
  staff: [
    staff('s-1', {
      EmployeeNo: 'e-001',
      EmployeeName: 'Nasrin Akter',
      Sex: 'Female',
      SubDeptId: 100,
      BloodGroup: 'A+ve',
      BiometricEnrollmentNo: 101,
    }),
    staff('s-2', {
      EmployeeNo: 'E-002',
      EmployeeName: 'Kamal Hossain',
      DeptId: 11,
      DesignationId: 2,
      BiometricEnrollmentNo: 101,
      IsSeparated: true,
      LastModifiedOn: new Date('2026-06-30T00:00:00Z'),
    }),
    staff('s-3', { EmployeeNo: 'E-003', EmployeeName: 'Removed', IsDeleted: true }),
    staff('s-4', { EmployeeName: 'No Number' }),
  ],
  salaries: [salary('sal-1', 's-1'), salary('sal-3', 's-3')],
};

/** The old database as the loaders query it: tables by name, pages by key. */
class FakeSource extends LegacySource {
  readonly queries: string[] = [];

  query<T extends Record<string, unknown>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    this.queries.push(sql);
    const page = <R extends Record<string, unknown>>(rows: R[], key: (row: R) => string | number) =>
      rows
        .filter((row) => key(row) > (params['after'] as string | number))
        .sort((a, b) => (key(a) < key(b) ? -1 : 1))
        .slice(0, params['n'] as number);
    let rows: Record<string, unknown>[];
    if (sql.includes('[Identity].[Roles]')) rows = tables.roles;
    else if (sql.includes('[Identity].[UserRoles]')) rows = tables.userRoles;
    else if (sql.includes('[Identity].[Users]') && sql.includes('[StaffRecordId] <>')) {
      rows = tables.users
        .filter((user) => user.StaffRecordId !== NIL)
        .map((user) => ({ Id: user.Id, StaffRecordId: user.StaffRecordId }));
    } else if (sql.includes('[HR].[StaffRecords]')) rows = page(hr.staff, (staff) => staff.Id);
    else if (sql.includes('[Payroll].[IndividualSalaries]')) rows = page(hr.salaries, (salary) => salary.Id);
    else if (/\[(HR|Payroll)\]\./.test(sql)) {
      const table = /\[(?:HR|Payroll)\]\.\[(\w+)\]/.exec(sql)![1]!;
      const found = hr.tables[table];
      if (!found) throw new Error(`Unexpected query: ${sql}`);
      rows = found;
    } else if (sql.includes('[Identity].[Users]') && sql.includes('[DoctorId] <>')) {
      rows = tables.users
        .filter((user) => user.DoctorId !== NIL)
        .map((user) => ({ Id: user.Id, DoctorId: user.DoctorId }));
    } else if (sql.includes('[Identity].[Users]')) rows = page(tables.users, (user) => user.Id);
    else if (sql.includes('[Marketing].[DoctorFieldOfSpecialities]')) rows = tables.specialities;
    else if (sql.includes('[Marketing].[Doctors]')) rows = page(tables.doctors, (doctor) => doctor.Id);
    else if (sql.includes('[Hospital].[RegRecords]')) rows = page(tables.patients, (patient) => patient.UHID);
    else if (sql.includes('[Account].[GeneralLedgers]')) rows = page(books.glAccounts, (account) => account.Id);
    else if (sql.includes('[Account].[SubLedgers]')) rows = page(books.subLedgers, (subLedger) => subLedger.Id);
    else if (sql.includes('[Account].[VoucherMasterDetails]')) rows = books.balances;
    else {
      const table = /\[Account\]\.\[(\w+)\]/.exec(sql)?.[1];
      const found = table ? books.tables[table] : undefined;
      if (!found) throw new Error(`Unexpected query: ${sql}`);
      rows = found;
    }
    return Promise.resolve(rows as T[]);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

const PEOPLE = ['roles', 'users', 'user-roles', 'specialities', 'doctors', 'patients'];
const etl = (dryRun: boolean, options: { only?: string[]; cutOver?: string } = {}) =>
  runEtl({
    db: t.app.get(DbContext),
    tx: t.app.get(TransactionManager),
    source: new FakeSource(),
    loaders: legacyLoaders(t.app.get(DbContext)),
    only: options.only ?? PEOPLE,
    dryRun,
    batchSize: 2,
    cutOver: options.cutOver ?? null,
  });
const counts = (run: Awaited<ReturnType<typeof etl>>) =>
  Object.fromEntries(run.reports.map((report) => [report.loader, [report.written, report.kept, report.rejected]]));
const signIn = (identifier: string, password: string) =>
  request(http).post('/api/v1/auth/login').set('X-Refresh-Token-Delivery', 'body').send({ identifier, password });

beforeAll(async () => {
  t = await createTestApp();
  http = t.app.getHttpServer();
});
afterAll(() => t.app.close());
beforeEach(async () => {
  await resetDatabase(t.app);
  await bootstrapAdmin(t.app);
});

describe('data migration', () => {
  it('rehearses, loads, re-runs safely, and lets old users sign in with their old passwords', async () => {
    const db = t.app.get(DbContext).db;

    // A dry run says what would happen and keeps nothing.
    const dry = await etl(true);
    expect(counts(dry)).toEqual({
      roles: [2, 0, 0],
      users: [2, 0, 1],
      'user-roles': [2, 0, 1],
      specialities: [1, 0, 0],
      doctors: [1, 0, 1],
      patients: [3, 0, 1],
    });
    expect(await db.select().from(patients)).toHaveLength(0);
    const [logged] = await db.select().from(etlRuns).where(eq(etlRuns.id, dry.runId));
    expect(logged).toMatchObject({ dryRun: true, status: 'done', written: 11, rejected: 4 });

    // The real run, then again: nothing twice.
    const real = await etl(false);
    expect(counts(real)).toEqual(counts(dry));
    const patientsReport = real.reports.find((report) => report.loader === 'patients')!;
    expect(patientsReport.reasons).toEqual({ no_mobile: { count: 1, examples: ['p-26000012'] } });
    const again = await etl(false);
    expect(again.reports.map((report) => report.written)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(again.reports.find((report) => report.loader === 'patients')!.kept).toBe(3);

    const loaded = await db
      .select({ uhid: patients.uhid, birthEstimated: patients.birthEstimated, bloodGroup: patients.bloodGroup })
      .from(patients);
    expect(loaded.sort((a, b) => a.uhid - b.uhid)).toEqual([
      { uhid: 25000500, birthEstimated: false, bloodGroup: 'O+' },
      { uhid: 26000010, birthEstimated: false, bloodGroup: null },
      { uhid: 26000011, birthEstimated: true, bloodGroup: null },
    ]);
    const [nusrat] = await db.select().from(users).where(eq(users.email, 'nusrat@example.com'));
    const [doctor] = await db.select().from(doctors).where(eq(doctors.code, 'D-101'));
    expect(doctor).toMatchObject({ userId: nusrat!.id, isConsultant: true, firstVisitFee: 1000, reportFee: 300 });

    // Old passwords work once, and are rehashed.
    const admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
    expect((await signIn('rana', 'wrong passphrase')).status).toBe(401);
    await signIn('rana', 'Old-Passw0rd!').expect(200);
    await signIn('nusrat@example.com', 'Doctor-Passw0rd!').expect(200);
    const [rana] = await db.select().from(users).where(eq(users.username, 'rana'));
    expect(rana!.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(rana!.email).toBe('rana@users.invalid');
    await signIn('rana', 'Old-Passw0rd!').expect(200);

    // Roles came over (without permissions) with their members.
    const roles = await request(http).get('/api/v1/roles').set(bearer(admin)).expect(200);
    expect(roles.body.map((role: { name: string }) => role.name)).toEqual(
      expect.arrayContaining(['doctor', 'receptionist']),
    );

    // New registrations number after the UHIDs brought over.
    const created = await request(http)
      .post('/api/v1/hospital/patients')
      .set(bearer(admin))
      .send({ fullName: 'New Patient', sex: 'male', dateOfBirth: '1990-01-01', mobileNo: '01911000000' })
      .expect(201);
    const fresh = await request(http)
      .get(`/api/v1/hospital/patients/${created.body.id}`)
      .set(bearer(admin))
      .expect(200);
    const year = new Date().getUTCFullYear() % 100;
    expect(fresh.body.uhid).toBe(year === 26 ? 26000012 : year * 1_000_000 + 1);
  });

  it('brings the chart over and opens the books with the old balances at the cut-over', async () => {
    const db = t.app.get(DbContext).db;
    const accounts = { only: ['opening-balances', 'bank-accounts'], cutOver: '2027-01-01' };

    const dry = await etl(true, accounts);
    expect(counts(dry)).toEqual({
      'account-natures': [5, 0, 1],
      'account-categories': [5, 0, 0],
      'account-sub-categories': [5, 0, 0],
      'account-level4-heads': [5, 0, 0],
      'account-level5-heads': [5, 0, 0],
      'coa-descriptions': [1, 0, 0],
      'gl-accounts': [6, 0, 1],
      'sub-ledger-types': [2, 0, 0],
      'sub-ledgers': [2, 0, 0],
      'cost-centers': [1, 0, 0],
      'fiscal-years': [2, 0, 0],
      'journal-types': [2, 0, 0],
      'opening-balances': [1, 0, 0],
      'bank-accounts': [1, 0, 1],
    });
    expect(await db.select().from(glAccounts)).toHaveLength(0);

    const real = await etl(false, accounts);
    expect(counts(real)).toEqual(counts(dry));
    const opening = real.reports.find((report) => report.loader === 'opening-balances')!;
    expect(opening.notes).toEqual(
      expect.arrayContaining([
        'Voucher OB-2026-00001 dated 2026-12-31: 6 lines, 6 accounts, debits = credits = 73000.01',
        'Old rounding of 0.01 put on the largest line of the short side',
      ]),
    );
    const natureRows = await db.select().from(accountNatures);
    expect(natureRows.map((row) => [row.name, row.statement, row.normalBalance]).sort()).toEqual([
      ['Assets', 'balance_sheet', 'debit'],
      ['Equity', 'balance_sheet', 'credit'],
      ['Expenses', 'profit_and_loss', 'debit'],
      ['Income', 'profit_and_loss', 'credit'],
      ['Liabilities', 'balance_sheet', 'credit'],
    ]);
    const [cashRole] = await db.select().from(glRoles).where(eq(glRoles.role, 'cash_in_hand'));
    const [cash] = await db.select().from(glAccounts).where(eq(glAccounts.code, '1001'));
    expect(cash).toMatchObject({ kind: 'cash', id: cashRole!.glAccountId });

    // Again: nothing twice. At another cut-over: refused, the books are open already.
    const again = await etl(false, accounts);
    expect(again.reports.every((report) => report.written === 0)).toBe(true);
    expect(again.reports.find((report) => report.loader === 'opening-balances')!.kept).toBe(1);
    const later = await etl(false, { ...accounts, cutOver: '2027-02-01' });
    expect(later.reports.find((report) => report.loader === 'opening-balances')!.reasons).toEqual({
      books_not_empty: { count: 1, examples: ['2027-02-01'] },
    });

    // The books here say what the old ones did.
    const admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
    const get = (path: string) => request(http).get(`/api/v1/accounts/${path}`).set(bearer(admin)).expect(200);
    const tb = await get('statements/trial-balance?from=2027-01-01&to=2027-01-31');
    expect(tb.body).toMatchObject({ balanced: true, totals: { closingDebit: 73_000.01, closingCredit: 73_000.01 } });
    const bs = await get('statements/balance-sheet?asOf=2026-12-31');
    expect(bs.body).toMatchObject({ totalDebit: 40_000, totalCredit: 40_000, profitToDate: -8_000.01, balanced: true });
    const [rahima] = await db.select().from(subLedgers).where(eq(subLedgers.name, 'Rahima Begum'));
    expect(rahima!.reference).toBe('501');
    const ledger = await get(`books/ledger?from=2027-01-01&to=2027-01-31&subLedgerId=${rahima!.id}`);
    expect(ledger.body).toMatchObject({ opening: 10_000, closing: 10_000 });
  });

  it('brings staff over with their salaries, this year’s leave and PF balances', async () => {
    const db = t.app.get(DbContext).db;
    const people = {
      only: ['staff-salaries', 'leave-policies', 'staff-leave-policies', 'leave-taken', 'pf-openings'],
      cutOver: '2027-01-01',
    };
    const dry = await etl(true, people);
    expect(counts(dry)).toEqual({
      users: [2, 0, 1],
      'hr-divisions': [1, 0, 0],
      'hr-departments': [2, 0, 1],
      'hr-sub-departments': [1, 0, 0],
      designations: [2, 0, 0],
      'leave-types': [3, 0, 0],
      staff: [2, 0, 2],
      'salary-policies': [1, 0, 0],
      'salary-review-cycles': [1, 0, 0],
      'staff-salaries': [1, 0, 1],
      'leave-policies': [1, 0, 0],
      'staff-leave-policies': [1, 0, 0],
      'leave-taken': [1, 0, 1],
      'pf-openings': [1, 0, 0],
    });
    expect(await db.select().from(staffRecords)).toHaveLength(0);

    const real = await etl(false, people);
    expect(counts(real)).toEqual(counts(dry));
    const report = (loader: string) => real.reports.find((entry) => entry.loader === loader)!;
    expect(report('staff').reasons).toEqual({
      deleted: { count: 1, examples: ['s-3'] },
      no_employee_no: { count: 1, examples: ['s-4'] },
    });
    expect(report('leave-types').notes).toEqual([
      'Casual Leave: code CL',
      'Medical Leave: code ML',
      'Maternity Leave: code ML2',
    ]);
    expect(report('leave-policies').notes).toEqual([
      '2027: 11 days of festival leave left out (no single leave type named so)',
    ]);

    const [rana] = await db.select().from(users).where(eq(users.username, 'rana'));
    const [nasrin] = await db.select().from(staffRecords).where(eq(staffRecords.employeeNo, 'E-001'));
    const [ward] = await db.select().from(hrSubDepartments).where(eq(hrSubDepartments.name, 'Ward nursing'));
    expect(nasrin).toMatchObject({
      fullName: 'Nasrin Akter',
      sex: 'female',
      bloodGroup: 'A+',
      biometricEnrollmentNo: 101,
      subDepartmentId: ward!.id,
      userId: rana!.id,
      status: 'active',
      serviceNature: 'Permanent',
    });
    const [kamal] = await db.select().from(staffRecords).where(eq(staffRecords.employeeNo, 'E-002'));
    const [general] = await db.select().from(hrSubDepartments).where(eq(hrSubDepartments.id, kamal!.subDepartmentId));
    expect(kamal).toMatchObject({ status: 'separated', separationDate: '2026-06-30', biometricEnrollmentNo: null });
    expect(general!.name).toBe('General');

    const [pay] = await db.select().from(staffSalaries).where(eq(staffSalaries.staffId, nasrin!.id));
    expect(pay).toMatchObject({
      gross: 30_000,
      basic: 18_000,
      houseRent: 9_000,
      pf: 1_800,
      incrementMethod: 'percentage',
    });
    expect(await db.select().from(leavePolicyEntitlements)).toHaveLength(3);
    expect(await db.select().from(staffLeaveEntitlements)).toEqual([
      expect.objectContaining({ staffId: nasrin!.id, year: 2027, days: 12 }),
    ]);
    expect(await db.select().from(leaveRecords)).toEqual([
      expect.objectContaining({ staffId: nasrin!.id, startDate: '2027-01-01', endDate: '2027-01-02', days: 2 }),
    ]);
    expect(await db.select().from(pfLedgerEntries)).toEqual([
      expect.objectContaining({ staffId: nasrin!.id, entryDate: '2026-12-31', type: 'opening', credit: 50_000 }),
    ]);

    const again = await etl(false, people);
    expect(again.reports.every((entry) => entry.written === 0)).toBe(true);
  });

  it('leaves the opening balances out without a cut-over day', async () => {
    const run = await etl(false, { only: ['opening-balances'] });
    const opening = run.reports.find((report) => report.loader === 'opening-balances')!;
    expect(opening).toMatchObject({
      written: 0,
      notes: ['No --cut-over day given: opening balances were not brought over'],
    });
  });
});

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}
