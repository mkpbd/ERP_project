import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LegacySource } from '../../src/cli/data-migration/etl.js';
import { legacyLoaders } from '../../src/cli/data-migration/legacy-loaders.js';
import { runReconciliation } from '../../src/cli/data-migration/reconcile.js';
import { runEtl } from '../../src/cli/data-migration/runner.js';
import { DbContext } from '../../src/database/drizzle-transaction-manager.js';
import {
  accountNatures,
  glAccounts,
  glRoles,
  subLedgers,
} from '../../src/modules/accounts/infrastructure/persistence/accounts.schema.js';
import { canteenOutlets, canteenSales } from '../../src/modules/canteen/infrastructure/persistence/canteen.schema.js';
import { etlRuns } from '../../src/modules/data-migration/infrastructure/persistence/data-migration.schema.js';
import {
  admissions,
  beds,
  bedStays,
  corporateClients,
  doctorLedger,
  doctors,
  ipdPayments,
  patients,
} from '../../src/modules/hospital/infrastructure/persistence/hospital.schema.js';
import { hrSubDepartments, staffRecords } from '../../src/modules/hr/infrastructure/persistence/hr.schema.js';
import {
  leavePolicyEntitlements,
  leaveRecords,
  staffLeaveEntitlements,
} from '../../src/modules/hr/infrastructure/persistence/leave.schema.js';
import { users } from '../../src/modules/identity/infrastructure/persistence/identity.schema.js';
import {
  pfLedgerEntries,
  staffDues,
  staffSalaries,
} from '../../src/modules/payroll/infrastructure/persistence/payroll.schema.js';
import {
  outletUsers,
  pharmacyMovements,
  products,
} from '../../src/modules/pharmacy/infrastructure/persistence/pharmacy.schema.js';
import {
  departmentStoreAccess,
  departmentUsers,
  issueStoreUsers,
  items,
  stockLots,
  stockMovements,
  suppliers,
} from '../../src/modules/supply-chain/infrastructure/persistence/supply-chain.schema.js';
import { PatientDocumentRegistry } from '../../src/shared/application/patient-documents.js';
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
const PHARMACY_INVENTORY = 'd2a75694-abab-4d70-288b-08dcbf94ffbd';
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
    ConsultantGlobalLedgers: [{ ConsultantId: DOCTOR, Debit: 1_000, Credit: 6_000 }],
    LoyalMembers: [
      { Id: 'lm-1', Name: 'Habib', MobileNo: '01711999999', Address: null, ReferranceName: null, IsDeleted: false },
      { Id: 'lm-2', Name: 'No Phone', MobileNo: null, Address: null, ReferranceName: null, IsDeleted: false },
    ],
    LoyalMemberLedgers: [{ LoyalMemberId: 'lm-1', Debit: 1_500, Credit: 500 }],
  } as Record<string, Record<string, unknown>[]>,
  glAccounts: [
    gl(CASH, '1001', 1, { BankCashOth: 'Cash' }),
    gl(IPD_RECEIVABLE, '1002', 1, { IsControlAccount: true }),
    gl('gl-pay', '2001', 2, { IsControlAccount: true }),
    gl('gl-cap', '3001', 3),
    gl('gl-inc', '4001', 4),
    gl('gl-exp', '5001', 5, { IsCostCenter: true }),
    gl('gl-x', null, 5),
    gl(PHARMACY_INVENTORY, '1003', 1, { Name: 'Medicine inventory' }),
    gl('gl-consumable', '1004', 1, { Name: 'Consumable stores' }),
    gl('gl-reusable', '1005', 1, { Name: 'Reusable items' }),
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
    balance('gl-cap', 0, 41_500),
    balance(PHARMACY_INVENTORY, 1_000, 0),
    balance('gl-consumable', 500, 0),
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
    StaffGlobalLedgers: [{ StaffRecordId: 's-1', Debit: 800, Credit: 300 }],
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

const product = (Id: string, BrandId: string) => ({
  Id,
  BarCode: '8941100500019',
  BrandId,
  GenericId: 'g-1',
  FormationId: 'f-1',
  StrengthId: 'st-1',
  Unit: 'pcs',
  PurchasePrice: 1,
  SalePrice: 1.2,
  PkgUnit: 'Box',
  QtyPerBox: 100,
  IsActive: true,
  IsDeleted: false,
});
const variant = (Id: string, BrandId: string, Name: string, PurchasePrice: number) => ({
  Id,
  BrandId,
  Name,
  PurchasePrice,
  SalePrice: 0,
  ROL: 5,
  CodeOrPartNo: null,
  IsExpireDateRequired: false,
  AlternateName: null,
  SpecSizeOrColor: null,
  IsDeleted: false,
});

/** The old pharmacy and stores: catalogues, a supplier, and the stock when the old system was frozen. */
const stock = {
  tables: {
    'Pharmacy.Groups': [{ Id: 'pg-1', Name: 'Analgesic', Info: null }],
    'Pharmacy.Generics': [
      { Id: 'g-1', Name: 'Paracetamol', Parent: 'pg-1', Info: null },
      { Id: 'g-2', Name: 'Omeprazole', Parent: NIL, Info: null },
    ],
    'Pharmacy.Formations': [{ Id: 'f-1', Name: 'Tablet', ShortFormation: 'Tab.' }],
    'Pharmacy.Strengths': [{ Id: 'st-1', Name: '500 mg' }],
    'Pharmacy.Manufacturers': [{ Id: 'm-1', Name: 'Beximco' }],
    'Pharmacy.BrandNames': [
      { Id: 'b-1', Name: 'Napa', Parent: 'm-1' },
      { Id: 'b-2', Name: 'Seclo', Parent: 'm-gone' },
    ],
    'Pharmacy.MedicineOutlets': [{ Id: 'o-1', Name: 'Outdoor pharmacy', Description: null, CodeNo: 'OP1' }],
    'Pharmacy.Stocks': [
      {
        ProductId: 'p-1',
        OutletId: 'o-1',
        LotId: 'pl-1',
        AvailableStock: 1_000,
        PurchaseRate: 1,
        SaleRate: 1.2,
        BatchNo: 'B1',
        ExpireDate: new Date('2028-06-30T00:00:00Z'),
      },
      {
        ProductId: 'p-1',
        OutletId: 'o-1',
        LotId: 'pl-0',
        AvailableStock: 400,
        PurchaseRate: 1,
        SaleRate: 1.2,
        BatchNo: 'B0',
        ExpireDate: new Date('2026-06-30T00:00:00Z'),
      },
      {
        ProductId: 'p-gone',
        OutletId: 'o-1',
        LotId: null,
        AvailableStock: 5,
        PurchaseRate: 1,
        SaleRate: 1,
        BatchNo: null,
        ExpireDate: new Date('2028-01-31T00:00:00Z'),
      },
    ],
    'SupplyChain.MainStores': [{ Id: 'ms-1', Name: 'Central store', Description: null }],
    'SupplyChain.Stores': [{ Id: 'ss-1', Name: 'Ward store', Description: null, Parent: 'ms-1' }],
    'SupplyChain.StoreDepts': [{ Id: 'sd-1', Name: 'Ward 1' }],
    'SupplyChain.ParentCategories': [{ Id: 'pc-1', Name: 'General' }],
    'SupplyChain.SubCategories': [{ Id: 'sc-1', Name: 'Stationery', Parent: 'pc-1' }],
    'SupplyChain.Groups': [{ Id: 'ig-1', Name: 'Office' }],
    'SupplyChain.SubGroups': [{ Id: 'isg-1', Name: 'Paper and furniture', Parent: 'ig-1' }],
    'SupplyChain.BrandNames': [
      {
        Id: 'i-1',
        Name: 'A4 paper',
        SubGroupId: 'isg-1',
        SubCategoryId: 'sc-1',
        Unit: 'ream',
        ItemTypeId: 'gl-consumable',
        IsDeleted: false,
      },
      {
        Id: 'i-2',
        Name: 'Wheel chair',
        SubGroupId: 'isg-1',
        SubCategoryId: 'sc-1',
        Unit: null,
        ItemTypeId: 'gl-reusable',
        IsDeleted: false,
      },
    ],
    'SupplyChain.SupplierTypes': [{ Id: 'stp-1', Name: 'Local' }],
    'SupplyChain.Suppliers': [
      {
        Id: 'sup-1',
        TypeId: 'stp-1',
        Name: 'ACME Pharma',
        Address: 'Chattogram',
        ContactNo: '01811000000',
        IsEnlisted: true,
        EnlistmentDate: new Date('0001-01-01T00:00:00Z'),
        ExpireDate: new Date('2027-12-31T00:00:00Z'),
        VatInPercent: 5,
        TaxInPercent: 3,
        IsManufacturer: false,
        GLId: 'gl-pay',
        IsDeleted: false,
      },
    ],
    'SupplyChain.LotRecords': [{ Id: 'lot-1', BatchNo: 'L1', ExpireDate: '31/12/2028' }],
    'SupplyChain.StockReceiveDetails': [{ BrandExtensionId: 'v-1', PurchaseRate: 250 }],
    'Pharmacy.PharmacistDutyOutlets': [
      { Id: 'pdo-1', UserId: 'u-1', OutletId: 'o-1' },
      { Id: 'pdo-2', UserId: 'u-3', OutletId: 'o-1' },
    ],
    'SupplyChain.StoreDeptUserAccesses': [{ Id: 'sdu-1', UserId: 'u-2', StoreDeptIds: 'sd-1, sd-gone' }],
    'SupplyChain.DeptStoreAcesses': [{ Id: 'dsa-1', DeptId: 'sd-1', UserId: 'u-2', StoreId: 'ss-1' }],
    'SupplyChain.IssueStoreAcesses': [{ Id: 'isa-1', UserId: 'u-1', StoreId: 'ss-1' }],
  } as Record<string, Record<string, unknown>[]>,
  products: [product('p-1', 'b-1'), product('p-2', 'b-1'), product('p-3', 'b-2')],
  variants: [variant('v-1', 'i-1', 'Double A 80 gsm', 400), variant('v-2', 'i-2', 'Standard', 9_000)],
  // The old current-stock procedure per store: lots in, transfers out without their lot.
  storeStock: {
    'ms-1': [
      { Id: 'v-1', LotRecordId: 'lot-1', CurStock: 3, PurchasePrice: 400 },
      { Id: 'v-1', LotRecordId: NIL, CurStock: -1, PurchasePrice: 400 },
      { Id: 'v-2', LotRecordId: NIL, CurStock: 2, PurchasePrice: 9_000 },
    ],
    'ss-1': [{ Id: 'v-1', LotRecordId: NIL, CurStock: -2, PurchasePrice: 400 }],
  } as Record<string, Record<string, unknown>[]>,
};

const cabin = (Id: string, CabinNo: string, Rent: number, CabinTypeId: string) => ({
  Id,
  CabinNo,
  Rent,
  CabinTypeId,
  FloorId: 'fl-3',
  HDepartmentId: 'hd-1',
  IsActive: true,
  IsDeleted: false,
  DisplayOrder: 1,
});
const wall = (value: string) => new Date(`${value}Z`);
const admittedPatient = (Id: string, UHID: number) => ({
  Id,
  UHID,
  InvoiceNo: 26_001_234,
  AdmissionDateTime: wall('2026-09-28T10:00:00'),
  RefdDoctorId: NIL,
  AssignedDoctorId: DOCTOR,
  CorporateClientId: 'cc-1',
  AdmissionFee: 1_000,
  Remarks: 'Fever',
});

/** The old wards and the patients still admitted when the old system stopped (old times are Dhaka wall-clock). */
const open: Record<string, Record<string, unknown>[]> = {
  'Hospital.CabinTypes': [
    { Id: 'ct-1', Name: 'Cabin', AdmissionFee: 1_000 },
    { Id: 'ct-2', Name: 'ICU', AdmissionFee: 2_000 },
  ],
  'Hospital.Floors': [{ Id: 'fl-3', Name: '3rd floor' }],
  'Hospital.HDepartments': [{ Id: 'hd-1', Name: 'Medicine' }],
  'Hospital.Cabins': [cabin('cb-1', 'c-301', 2_000, 'ct-1'), cabin('icu-1', 'ICU-1', 5_000, 'ct-2')],
  'Marketing.CorporateClients': [
    {
      Id: 'cc-1',
      Name: 'Grameenphone',
      Address: null,
      ContactPerson: null,
      ContactNumber: null,
      IsCredit: true,
      IsDeleted: false,
    },
    {
      Id: 'cc-2',
      Name: 'Robi',
      Address: null,
      ContactPerson: null,
      ContactNumber: null,
      IsCredit: false,
      IsDeleted: false,
    },
  ],
  'Hospital.IPDPatientRecords': [
    admittedPatient('ip-1', 26000010),
    admittedPatient('ip-2', 26000011),
    admittedPatient('ip-3', 99999999),
  ],
  'Hospital.IPDCabinAllocationRecords': [
    {
      PatientId: 'ip-1',
      CabinId: 'icu-1',
      AllocationDateTime: wall('2026-09-28T10:00:00'),
      ReleaseDateTime: wall('2026-09-29T09:00:00'),
      AllocationOrder: 1,
    },
    {
      PatientId: 'ip-1',
      CabinId: 'cb-1',
      AllocationDateTime: wall('2026-09-29T09:00:00'),
      ReleaseDateTime: null,
      AllocationOrder: 2,
    },
    {
      PatientId: 'ip-2',
      CabinId: 'cb-gone',
      AllocationDateTime: wall('2026-09-28T10:00:00'),
      ReleaseDateTime: null,
      AllocationOrder: 1,
    },
  ],
  'Hospital.AdvancePayments': [
    { PatientId: 'ip-1', PayDate: wall('2026-09-28T00:00:00'), Amount: 10_000, TransactionType: 2 },
    { PatientId: 'ip-1', PayDate: wall('2026-09-30T00:00:00'), Amount: 2_000, TransactionType: 5 },
  ],
  'Hospital.IPDServiceRecords': [{ PatientId: 'ip-1', Services: 3, Amount: 4_500, Charge: 500 }],
  'Hospital.DischargeCertificate': [
    {
      Id: 'dc-1',
      EditorText: '<p><b>Diagnosis:</b> Dengue fever</p><p>Discharged in good health.</p>',
      DischargeCertificateDate: wall('2025-05-05T00:00:00'),
      UHID: 26000010,
      InvoiceNo: 25_001,
    },
  ],
};

/** The old clinical records of one patient: two lab reports (one not delivered), an X-ray, an Rx visit, a note. */
const history = {
  tables: {
    'Diag.PathologyReports': [
      {
        Id: 'pr-1',
        LabNo: 501,
        ReportDate: wall('2025-03-01T00:00:00'),
        PreparedDate: null,
        CreatedOn: null,
        AnyComments: null,
        DeliveryOn: wall('2025-03-02T00:00:00'),
        ReportVerifierId: NIL,
        UHID: 26000010,
        InvoiceNo: 9_001,
      },
      {
        Id: 'pr-2',
        LabNo: 502,
        ReportDate: wall('2025-06-01T00:00:00'),
        PreparedDate: null,
        CreatedOn: null,
        AnyComments: 'Repeat after a month',
        DeliveryOn: null,
        ReportVerifierId: NIL,
        UHID: 26000010,
        InvoiceNo: 9_003,
      },
      { Id: 'pr-3', LabNo: 503, ReportDate: wall('2025-06-02T00:00:00'), UHID: null, ReportVerifierId: NIL },
    ],
    'Diag.RadiologyReports': [
      {
        Id: 'rr-1',
        InvoiceNo: 9_002,
        ReportDateTime: wall('2025-04-01T10:00:00'),
        CreatedOn: null,
        ReportContent: '<p>Chest X-ray&nbsp;PA view</p><p>No active lesion &amp; no effusion.</p>',
        FinalizedByDoctorId: '6f1d2c3b-0000-4000-8000-0000000000dd',
        TestName: 'X-ray chest',
        UHID: 26000010,
      },
    ],
    'Diag.PathologyDescriptiveReports': [],
    'Rx.VisitHistories': [
      {
        Id: 'rx-1',
        RxNo: 7_001,
        VisitDate: wall('2025-02-10T00:00:00'),
        FollowUpDate: wall('2025-02-24T00:00:00'),
        Notes: null,
        UHID: 26000010,
      },
    ],
    'EMR.ConsultancyVisitNotes': [
      { Id: 'cn-1', Note: 'Seen. Stable.', On: wall('2025-05-02T00:00:00'), UHID: 26000010, InvoiceNo: 25_001 },
    ],
    'EMR.ProcedureNotes': [],
  } as Record<string, Record<string, unknown>[]>,
  // Child rows read for a page of parents (OPENJSON(@ids)).
  children: {
    'Diag.PathologyReportDetails': [
      {
        ParentId: 'pr-1',
        TestName: 'CBC',
        TestTitle: 'Hemoglobin',
        TestResult: '11.2',
        ResultUnit: 'g/dL',
        NormalResult: '12 - 16',
      },
      {
        ParentId: 'pr-1',
        TestName: 'CBC',
        TestTitle: 'WBC',
        TestResult: 'Normal',
        ResultUnit: null,
        NormalResult: null,
      },
      {
        ParentId: 'pr-1',
        TestName: 'CBC',
        TestTitle: 'Differential',
        TestResult: '',
        ResultUnit: null,
        NormalResult: null,
      },
      {
        ParentId: 'pr-2',
        TestName: 'CBC',
        TestTitle: 'Hemoglobin',
        TestResult: '12.8',
        ResultUnit: 'g/dL',
        NormalResult: '12 - 16',
      },
    ],
    'Rx.PatientChiefComplains': [{ ParentId: 'rx-1', Complain: 'Fever', ComplainManual: null, Duration: '3 days' }],
    'Rx.PatientClinicalimpressions': [{ ParentId: 'rx-1', ImpressionTitle: 'Viral fever', Remarks: null }],
    'Rx.Drugs': [{ ParentId: 'rx-1', Name: 'Napa', Dosage: '1+1+1', Duration: '5 days' }],
    'Rx.Investigations': [{ ParentId: 'rx-1', Name: 'CBC' }],
    'Rx.AdviceToPatients': [{ ParentId: 'rx-1', Advice: 'Plenty of fluids' }],
  } as Record<string, Record<string, unknown>[]>,
};

/** What the old system's own totals say at the cut-over (the reconciliation's queries; the books are summed above). */
const oldFigures: Record<string, number> = {
  'count:user': 3,
  'count:doctor': 2,
  'count:patient': 4,
  'count:staff': 3,
  'count:gl-account': 10,
  'count:supplier': 1,
  'count:product': 3,
  'count:item-variant': 2,
  'pharmacy-units': 1_000,
  admitted: 3,
  advances: 8_000,
  'doctor-payables': 5_000,
  'staff-dues': 500,
  'canteen-dues': 1_000,
  pf: 50_000,
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
    const clinical = /\[(Diag|Rx|EMR)\]\.\[(\w+)\]/.exec(sql);
    const reconciling = /\/\* reconcile:([\w:-]+) \*\//.exec(sql)?.[1];
    if (reconciling === 'books') rows = books.balances;
    else if (sql.includes('[Diag].[DiscountGroupDetails]')) {
      // Each client's discount group, test by test: one percent for Grameenphone, two for Robi.
      rows = [
        { ClientId: 'cc-1', Name: 'Grameenphone', Percent: 10, Gross: 0 },
        { ClientId: 'cc-1', Name: 'Grameenphone', Percent: 10, Gross: 0 },
        { ClientId: 'cc-2', Name: 'Robi', Percent: 10, Gross: 0 },
        { ClientId: 'cc-2', Name: 'Robi', Percent: 15, Gross: 0 },
      ];
    } else if (reconciling) rows = [{ n: oldFigures[reconciling] ?? 0 }];
    else if (clinical && sql.includes('OPENJSON(@ids)')) {
      const ids = (JSON.parse(params['ids'] as string) as string[]).map((id) => id.toLowerCase());
      rows = (history.children[`${clinical[1]}.${clinical[2]}`] ?? []).filter((row) =>
        ids.includes(String(row['ParentId']).toLowerCase()),
      );
    } else if (clinical) {
      const found = history.tables[`${clinical[1]}.${clinical[2]}`];
      if (!found) throw new Error(`Unexpected query: ${sql}`);
      rows = page(found, (row) => String(row['Id']));
    } else if (sql.includes('[Identity].[Roles]')) rows = tables.roles;
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
    else if (/\[(Hospital|Marketing)\]\.\[(\w+)\]/.test(sql)) {
      const [, schema, table] = /\[(Hospital|Marketing)\]\.\[(\w+)\]/.exec(sql)!;
      const found = open[`${schema}.${table}`];
      if (!found) throw new Error(`Unexpected query: ${sql}`);
      rows = found;
    } else if (sql.includes('[Account].[GeneralLedgers]')) rows = page(books.glAccounts, (account) => account.Id);
    else if (sql.includes('[Account].[SubLedgers]') && sql.includes('[SupplierId] <>')) {
      rows = [{ Id: 'sl-2', SupplierId: 'sup-1' }];
    } else if (sql.includes('EXEC [SupplyChain].[SpGetBrandExtensionCurrentStockBySubStore]')) {
      rows = stock.storeStock[params['store'] as string] ?? [];
    } else if (sql.includes('[SupplyChain].[BrandExtensions]')) rows = page(stock.variants, (variant) => variant.Id);
    else if (sql.includes('[Pharmacy].[BrandExtensions]')) rows = page(stock.products, (product) => product.Id);
    else if (/\[(Pharmacy|SupplyChain)\]\.\[(\w+)\]/.test(sql)) {
      const [, schema, table] = /\[(Pharmacy|SupplyChain)\]\.\[(\w+)\]/.exec(sql)!;
      const found = stock.tables[`${schema}.${table}`];
      if (!found) throw new Error(`Unexpected query: ${sql}`);
      rows = found;
    } else if (sql.includes('[Account].[SubLedgers]')) rows = page(books.subLedgers, (subLedger) => subLedger.Id);
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
      'gl-accounts': [9, 0, 1],
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
        'Voucher OB-2026-00001 dated 2026-12-31: 8 lines, 8 accounts, debits = credits = 74500.01',
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
    expect(tb.body).toMatchObject({ balanced: true, totals: { closingDebit: 74_500.01, closingCredit: 74_500.01 } });
    const bs = await get('statements/balance-sheet?asOf=2026-12-31');
    expect(bs.body).toMatchObject({ totalDebit: 41_500, totalCredit: 41_500, profitToDate: -8_000.01, balanced: true });
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

  it('brings catalogues and suppliers over, and opens each store with the frozen old stock', async () => {
    const db = t.app.get(DbContext).db;
    const stores = {
      only: ['pharmacy-opening-stock', 'store-opening-stock', 'suppliers', 'store-departments', 'generics'],
      cutOver: '2027-01-01',
    };
    const dry = await etl(true, stores);
    expect(await db.select().from(products)).toHaveLength(0);
    const real = await etl(false, stores);
    expect(counts(real)).toEqual(counts(dry));
    const report = (loader: string) => real.reports.find((entry) => entry.loader === loader)!;
    expect(counts(real)).toMatchObject({
      generics: [2, 0, 0],
      brands: [1, 0, 1],
      products: [1, 0, 1],
      outlets: [1, 0, 0],
      items: [2, 0, 0],
      'item-variants': [2, 0, 0],
      suppliers: [1, 0, 0],
      'store-departments': [1, 0, 0],
      'pharmacy-opening-stock': [1, 0, 0],
      'store-opening-stock': [1, 0, 0],
    });
    expect(report('products').notes).toEqual([
      'p-2: the same brand, formation and strength as another product; merged',
    ]);
    expect(report('pharmacy-opening-stock').notes).toEqual([
      '1 product(s) with stock at outlet o-1 were not brought over',
      'OP-2026-00001: 1 lines',
      '1 expired lot(s) worth 400.00 left out',
      'Stock worth 1000.00 equals account 1003 in the books',
    ]);
    expect(report('store-opening-stock').notes).toEqual([
      'OS-2026-00001: 1 lines',
      '1 asset item(s) with stock left out: register them as assets',
      '1 item(s) were below zero in the old stock and hold nothing',
      'Stock worth 500.00 equals account 1004 in the books',
    ]);

    const [napa] = await db.select().from(products);
    expect(napa).toMatchObject({ unitsPerPack: 100, salePrice: 1.2, barcode: '8941100500019' });
    expect(await db.select().from(pharmacyMovements)).toEqual([
      expect.objectContaining({ productId: napa!.id, qty: 1_000, unitCost: 1, kind: 'opening', movedOn: '2026-12-31' }),
    ]);
    const [movement] = await db.select().from(stockMovements);
    const [lot] = await db.select().from(stockLots).where(eq(stockLots.id, movement!.lotId));
    expect(movement).toMatchObject({ qty: 2, unitCost: 250, kind: 'opening', subStoreId: null });
    expect(lot).toMatchObject({ batchNo: 'L1', expiryDate: '2028-12-31' });
    const [chair] = await db.select().from(items).where(eq(items.name, 'Wheel chair'));
    expect(chair).toMatchObject({ isAsset: true, unit: 'pcs' });

    const [acme] = await db.select().from(suppliers);
    const [ledger] = await db.select().from(subLedgers).where(eq(subLedgers.name, 'ACME Pharma'));
    const [payable] = await db.select().from(glAccounts).where(eq(glAccounts.code, '2001'));
    expect(acme).toMatchObject({
      subLedgerId: ledger!.id,
      glAccountId: payable!.id,
      enlistedOn: null,
      enlistmentExpiresOn: '2027-12-31',
      vatPercent: 5,
    });

    const again = await etl(false, stores);
    expect(again.reports.every((entry) => entry.written === 0)).toBe(true);
  });

  it('keeps admitted patients in their beds, and opens doctors’, staff and members’ balances', async () => {
    const db = t.app.get(DbContext).db;
    await db.insert(canteenOutlets).values({ id: randomUUID(), name: 'Main canteen' });
    const openings = {
      only: ['open-admissions', 'doctor-payables', 'staff-dues', 'canteen-dues'],
      cutOver: '2026-10-01',
    };
    const dry = await etl(true, openings);
    expect(await db.select().from(admissions)).toHaveLength(0);
    const real = await etl(false, openings);
    expect(counts(real)).toEqual(counts(dry));
    expect(counts(real)).toMatchObject({
      'corporate-clients': [2, 0, 0],
      'bed-categories': [2, 0, 0],
      beds: [2, 0, 0],
      'open-admissions': [1, 0, 2],
      'doctor-payables': [1, 0, 0],
      'staff-dues': [1, 0, 0],
      'canteen-members': [1, 0, 1],
      'canteen-dues': [1, 0, 0],
    });
    const report = (loader: string) => real.reports.find((entry) => entry.loader === loader)!;
    expect(report('open-admissions').reasons).toEqual({
      bed_not_brought: { count: 1, examples: ['ip-2'] },
      patient_not_brought: { count: 1, examples: ['ip-3'] },
    });
    expect(report('beds').notes).toEqual(['Ward Medicine (3rd floor)']);

    // The stay, as if it had been here: admitted 10:00 Dhaka time, an ICU night, then a cabin.
    const [admission] = await db.select().from(admissions);
    expect(admission).toMatchObject({
      number: 'IP-2026-00001',
      admittedAt: new Date('2026-09-28T04:00:00Z'),
      admissionFee: 1_000,
      status: 'admitted',
      reason: 'Old admission 26001234: Fever',
    });
    const stays = await db
      .select({ code: beds.code, toAt: bedStays.toAt, rate: bedStays.dailyRate, status: beds.status })
      .from(bedStays)
      .innerJoin(beds, eq(beds.id, bedStays.bedId))
      .orderBy(bedStays.fromAt);
    expect(stays).toEqual([
      { code: 'ICU-1', toAt: new Date('2026-09-29T03:00:00Z'), rate: 5_000, status: 'available' },
      { code: 'C-301', toAt: null, rate: 2_000, status: 'occupied' },
    ]);
    const payments = await db.select().from(ipdPayments).orderBy(ipdPayments.paidOn);
    expect(payments.map((payment) => [payment.kind, payment.number, payment.amount, payment.voucherNumber])).toEqual([
      ['advance', 'AR-2026-00001', 10_000, null],
      ['refund', 'AF-2026-00001', 2_000, null],
    ]);

    // Billed here at discharge like any stay: the admission fee, the beds, the old services; the advance held.
    const admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
    const account = await request(http)
      .get(`/api/v1/hospital/admissions/${admission!.id}/account`)
      .set(bearer(admin))
      .expect(200);
    expect(account.body.held).toBe(8_000);
    expect(account.body.lines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ head: 'admission', amount: 1_000 }),
        expect.objectContaining({ head: 'bed', description: 'Bed ICU-1', qty: 1, rate: 5_000 }),
        expect.objectContaining({ head: 'bed', description: 'Bed C-301', rate: 2_000 }),
        expect.objectContaining({ head: 'service', description: 'Charges in the old system', amount: 5_000 }),
      ]),
    );

    const [owed] = await db.select().from(doctorLedger);
    expect(owed).toMatchObject({
      kind: 'share',
      amount: 5_000,
      entryOn: '2026-09-30',
      documentNumber: 'OPENING-2026-10-01',
    });
    expect(await db.select().from(staffDues)).toEqual([expect.objectContaining({ debit: 500, credit: 0 })]);
    const [due] = await db.select().from(canteenSales);
    expect(due).toMatchObject({ customerKind: 'member', net: 1_000, due: 1_000, paid: 0, number: 'CS-2026-00001' });

    const again = await etl(false, openings);
    expect(again.reports.every((entry) => entry.written === 0)).toBe(true);
  });

  it('brings the clinical history over to read, follow and show the patient', async () => {
    const histories = {
      only: [
        'lab-history',
        'pathology-text-history',
        'imaging-history',
        'prescription-history',
        'discharge-history',
        'note-history',
      ],
    };
    const real = await etl(false, histories);
    expect(counts(real)).toMatchObject({
      'lab-history': [2, 0, 1],
      'pathology-text-history': [0, 0, 0],
      'imaging-history': [1, 0, 0],
      'prescription-history': [1, 0, 0],
      'discharge-history': [1, 0, 0],
      'note-history': [1, 0, 0],
    });
    expect(real.reports.find((entry) => entry.loader === 'lab-history')!.reasons).toEqual({
      no_patient: { count: 1, examples: ['pr-3'] },
    });

    const db = t.app.get(DbContext).db;
    const [karim] = await db.select().from(patients).where(eq(patients.uhid, 26000010));
    const admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
    const get = (path: string) => request(http).get(`/api/v1/clinical/${path}`).set(bearer(admin)).expect(200);
    const list = (await get(`patients/${karim!.id}/history`)).body.items as {
      id: string;
      kind: string;
      title: string;
    }[];
    expect(list.map((entry) => entry.title)).toEqual([
      'Laboratory report: CBC',
      'Discharge certificate',
      'Consultant visit note',
      'Imaging report: X-ray chest',
      'Laboratory report: CBC',
      'Prescription',
    ]);
    const find = async (kind: string) => (await get(`history/${list.find((entry) => entry.kind === kind)!.id}`)).body;
    expect((await find('prescription')).body).toBe(
      [
        'Complaints:',
        '  Fever — 3 days',
        '',
        'Clinical impression:',
        '  Viral fever',
        '',
        'Rx:',
        '  1. Napa — 1+1+1 — 5 days',
        '',
        'Investigations:',
        '  CBC',
        '',
        'Advice:',
        '  Plenty of fluids',
        '',
        'Follow up on 2025-02-24',
      ].join('\n'),
    );
    expect(await find('imaging-report')).toMatchObject({
      number: 'Invoice 9002',
      recordedOn: '2025-04-01',
      body: 'Chest X-ray PA view\nNo active lesion & no effusion.',
      shared: true,
    });
    expect((await find('discharge-summary')).body).toBe('Diagnosis: Dengue fever\nDischarged in good health.');

    // Results followed over time; values kept as they were (the empty heading row dropped).
    const trend = (await get(`patients/${karim!.id}/history/trend?test=hemoglobin`)).body.items;
    expect(trend.map((point: { recordedOn: string; value: number }) => [point.recordedOn, point.value])).toEqual([
      ['2025-03-01', 11.2],
      ['2025-06-01', 12.8],
    ]);
    const first = (await get(`history/${trend[0].recordId}`)).body;
    expect(first.values).toEqual([
      { test: 'Hemoglobin', result: '11.2', unit: 'g/dL', reference: '12 - 16' },
      { test: 'WBC', result: 'Normal', unit: null, reference: null },
    ]);

    // The patient sees what was finalised there (not the undelivered report, not the note); it prints.
    const shared = (await t.app.get(PatientDocumentRegistry).list(karim!.id)).filter((doc) =>
      doc.ref.startsWith('history:'),
    );
    expect(shared.map((doc) => doc.title).sort()).toEqual([
      'Discharge certificate (old system)',
      'Imaging report: X-ray chest (old system)',
      'Laboratory report: CBC (old system)',
      'Prescription (old system)',
    ]);
    await request(http)
      .post('/api/v1/reports/clinical.history-record/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: shared[0]!.params })
      .expect(200);

    const again = await etl(false, histories);
    expect(again.reports.every((entry) => entry.written === 0)).toBe(true);
  });

  it('reconciles the cut-over side by side and prints it to sign', async () => {
    const db = t.app.get(DbContext).db;
    await db.insert(canteenOutlets).values({ id: randomUUID(), name: 'Main canteen' });
    const cutOver = '2026-10-01';
    await etl(false, {
      only: [
        'opening-balances',
        'pharmacy-opening-stock',
        'store-opening-stock',
        'open-admissions',
        'doctor-payables',
        'staff-dues',
        'canteen-dues',
        'pf-openings',
        'suppliers',
      ],
      cutOver,
    });
    const { runId, result } = await runReconciliation({ db: t.app.get(DbContext), source: new FakeSource(), cutOver });
    const status = Object.fromEntries(result.checks.map((check) => [`${check.area}: ${check.item}`, check.status]));
    expect(status).toEqual({
      // Left out by the loaders (each reported there): explained, not failed.
      'Records: Users': 'check',
      'Records: Doctors': 'check',
      'Records: Patients': 'check',
      'Records: Staff': 'check',
      'Records: GL accounts': 'check',
      'Records: Suppliers': 'ok',
      'Records: Pharmacy products': 'check',
      'Records: Store items': 'ok',
      'Records: Lab reports': 'ok',
      'Records: Prescriptions': 'ok',
      // The old books' 0.01 float rounding, taken up on the opening.
      'Books: Trial balance, debit side': 'check',
      'Stock: Pharmacy units in date': 'ok',
      'Stock: Pharmacy stock value against its account': 'ok',
      'Stock: Store stock value against account 1004': 'ok',
      'Admitted patients: Patients in their beds': 'check',
      'Admitted patients: Advances held': 'ok',
      'Dues: Owed to doctors': 'ok',
      'Dues: Owed by staff': 'ok',
      'Dues: Owed by canteen members': 'ok',
      'Dues: PF held for staff': 'ok',
    });
    expect(result.verdict).toBe('go-with-notes');
    expect(result.checks.find((check) => check.item === 'Trial balance, debit side')).toMatchObject({
      old: 74_500.01,
      new: 74_500.01,
      note: '1 account(s) differ by 0.01 in all: 3001 (old float rounding, taken up on the opening)',
    });

    const admin = (await signIn(ADMIN.email, ADMIN.password).expect(200)).body.accessToken as string;
    const runs = await request(http).get('/api/v1/data-migration/runs').set(bearer(admin)).expect(200);
    expect(runs.body.items[0]).toMatchObject({ id: runId, loaders: ['reconcile'], status: 'done', rejected: 0 });
    const run = await request(http).get(`/api/v1/data-migration/runs/${runId}`).set(bearer(admin)).expect(200);
    expect(run.body.report).toMatchObject({ kind: 'reconciliation', cutOver, verdict: 'go-with-notes' });
    await request(http)
      .post('/api/v1/reports/data-migration.reconciliation/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { runId } })
      .expect(200);
    // A loader run is not a reconciliation to print.
    const loaderRun = runs.body.items.find((item: { loaders: string[] }) => !item.loaders.includes('reconcile'));
    const refused = await request(http)
      .post('/api/v1/reports/data-migration.reconciliation/render')
      .set(bearer(admin))
      .send({ format: 'pdf', params: { runId: loaderRun.id } });
    expect(refused.body.code).toBe('not_a_reconciliation');
  });

  it('gives users their outlets and stores again, and corporate clients their discount', async () => {
    const access = {
      only: [
        'pharmacist-outlets',
        'store-department-users',
        'department-store-access',
        'issue-store-users',
        'corporate-discounts',
      ],
    };
    const real = await etl(false, access);
    expect(counts(real)).toMatchObject({
      'pharmacist-outlets': [1, 0, 1],
      'store-department-users': [1, 0, 1],
      'department-store-access': [1, 0, 0],
      'issue-store-users': [1, 0, 0],
      'corporate-discounts': [1, 0, 0],
    });
    const report = (loader: string) => real.reports.find((entry) => entry.loader === loader)!;
    expect(report('pharmacist-outlets').reasons).toEqual({ user_not_brought: { count: 1, examples: ['pdo-2'] } });
    expect(report('store-department-users').reasons).toEqual({
      store_department_not_brought: { count: 1, examples: ['sdu-1/sd-gone'] },
    });
    expect(report('corporate-discounts').notes).toEqual([
      "Grameenphone: 10% on its people's bills",
      'Robi: 2 different percents (10, 15) per test in the old system; set its discount by hand',
    ]);

    const db = t.app.get(DbContext).db;
    const [rana] = await db.select().from(users).where(eq(users.username, 'rana'));
    const [nusrat] = await db.select().from(users).where(eq(users.username, 'nusrat'));
    expect(await db.select({ userId: outletUsers.userId }).from(outletUsers)).toEqual([{ userId: rana!.id }]);
    expect(await db.select({ userId: departmentUsers.userId }).from(departmentUsers)).toEqual([{ userId: nusrat!.id }]);
    expect(await db.select({ userId: departmentStoreAccess.userId }).from(departmentStoreAccess)).toEqual([
      { userId: nusrat!.id },
    ]);
    expect(await db.select({ userId: issueStoreUsers.userId }).from(issueStoreUsers)).toEqual([{ userId: rana!.id }]);
    const clients = await db
      .select({ name: corporateClients.name, discount: corporateClients.discountPercent })
      .from(corporateClients)
      .orderBy(corporateClients.name);
    expect(clients).toEqual([
      { name: 'Grameenphone', discount: 10 },
      { name: 'Robi', discount: 0 },
    ]);

    const again = await etl(false, access);
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
