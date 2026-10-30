import { text } from './account-records.js';
import { accept, bloodGroup, mobile, reject, sex } from './legacy-records.js';

const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const amount = (value: unknown) => {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : 0;
};

/**
 * A leave type's code from its name (Casual Leave → CL), made unique among `taken` with a number when it must be
 * (ML, ML2). Codes are a letter and up to nine letters, digits or hyphens.
 */
export function leaveTypeCode(name: string, taken: ReadonlySet<string>): string {
  const words = name.match(/[A-Za-z]+/g) ?? [];
  const initials = words.map((word) => word[0]!.toUpperCase()).join('');
  const base = (initials.length >= 2 ? initials : (words[0] ?? 'LT').toUpperCase()).slice(0, 8);
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) {
    if (!taken.has(`${base}${n}`)) return `${base}${n}`;
  }
}

export interface LegacyStaff {
  readonly Id: string;
  readonly EmployeeNo: string | null;
  readonly EmployeeName: string | null;
  readonly FirstName: string | null;
  readonly MiddleName: string | null;
  readonly LastName: string | null;
  readonly FatherName: string | null;
  readonly MotherName: string | null;
  readonly DateofBirth: Date | null;
  readonly Sex: string | null;
  readonly MaritalStatus: string | null;
  readonly Religion: string | null;
  readonly BloodGroup: string | null;
  readonly NationalityOther: string | null;
  readonly NationIdorPpno: string | null;
  readonly TINNo: string | null;
  readonly MobileNo: string | null;
  readonly OfficialMobileNo: string | null;
  readonly EmailId: string | null;
  readonly GuardianContact: string | null;
  readonly PresentAddress: string | null;
  readonly PermanentAddress: string | null;
  readonly JoiningDate: Date | null;
  readonly ProvableConfirmationdate: Date | null;
  readonly Confirmationdate: Date | null;
  readonly EmployeeCategory: number | null;
  readonly EmployeeJobLocation: string | null;
  readonly ServiceNature: string | null;
  readonly SalaryStatus: string | null;
  readonly PaymentMode: string | null;
  readonly BankAccountNo: string | null;
  readonly BiometricEnrollmentNo: number | null;
  readonly IsHoD: boolean | null;
  readonly WorkingTime: string | null;
  readonly TimeofInterval: string | null;
  readonly WeeklyHoliday: string | null;
  readonly ShiftAndRelay: string | null;
  readonly DescriptionOfChangeGroup: string | null;
  readonly BNMC: string | null;
  readonly BMDC: string | null;
  readonly Remarks: string | null;
  readonly IsSeparated: boolean | null;
  readonly IsInActive: boolean | null;
  readonly InActiveReasons: string | null;
  readonly ResignationDate: Date | null;
  readonly LastModifiedOn: Date | null;
  readonly IsDeleted: boolean | null;
}

/**
 * Old HR.StaffRecords → staff_records (the structure and designation are looked up by the loader). Separated staff
 * keep their resignation day (or, when none was recorded, the day their record last changed, said in the reason);
 * deleted records are left out.
 */
export function staffRecord(row: LegacyStaff) {
  if (row.IsDeleted) return reject<never>('deleted');
  const employeeNo = text(row.EmployeeNo, 30)?.toUpperCase();
  if (!employeeNo) return reject<never>('no_employee_no');
  const fullName =
    text(row.EmployeeName, 150) ?? text([row.FirstName, row.MiddleName, row.LastName].filter(Boolean).join(' '), 150);
  if (!fullName) return reject<never>('no_name');
  if (!row.JoiningDate) return reject<never>('no_joining_date');
  const separated = row.IsSeparated === true;
  const separationDay = row.ResignationDate ?? row.LastModifiedOn ?? row.JoiningDate;
  const day = (value: Date | null) => (value ? isoDay(value) : null);
  const value = {
    employeeNo,
    fullName,
    firstName: text(row.FirstName, 100),
    middleName: text(row.MiddleName, 100),
    lastName: text(row.LastName, 100),
    fatherName: text(row.FatherName, 150),
    motherName: text(row.MotherName, 150),
    dateOfBirth: day(row.DateofBirth && row.DateofBirth.getUTCFullYear() > 1900 ? row.DateofBirth : null),
    sex: sex(row.Sex),
    maritalStatus: text(row.MaritalStatus, 30),
    religion: text(row.Religion, 50),
    bloodGroup: bloodGroup(row.BloodGroup),
    nationalityOther: text(row.NationalityOther, 100),
    nationalIdOrPassport: text(row.NationIdorPpno, 30),
    tinNo: text(row.TINNo, 30),
    mobileNo: mobile(row.MobileNo) ?? text(row.MobileNo, 30),
    officialMobileNo: mobile(row.OfficialMobileNo) ?? text(row.OfficialMobileNo, 30),
    email: text(row.EmailId, 150)?.toLowerCase() ?? null,
    guardianContact: text(row.GuardianContact, 200),
    presentAddress: text(row.PresentAddress, 300),
    permanentAddress: text(row.PermanentAddress, 300),
    joiningDate: isoDay(row.JoiningDate),
    probationEndDate: day(row.ProvableConfirmationdate),
    confirmationDate: day(row.Confirmationdate),
    employeeCategory:
      row.EmployeeCategory !== null && row.EmployeeCategory >= 0 && row.EmployeeCategory <= 32_767
        ? row.EmployeeCategory
        : null,
    jobLocation: text(row.EmployeeJobLocation, 100),
    serviceNature: text(row.ServiceNature, 50) ?? 'Permanent',
    salaryStatus: text(row.SalaryStatus, 50) ?? 'Regular',
    paymentMode: text(row.PaymentMode, 50),
    bankAccountNo: text(row.BankAccountNo, 50),
    biometricEnrollmentNo:
      row.BiometricEnrollmentNo && row.BiometricEnrollmentNo > 0 ? row.BiometricEnrollmentNo : null,
    isHeadOfDepartment: row.IsHoD === true,
    workingTime: text(row.WorkingTime, 100),
    intervalTime: text(row.TimeofInterval, 100),
    weeklyHoliday: text(row.WeeklyHoliday, 100),
    shiftAndRelay: text(row.ShiftAndRelay, 100),
    changeGroupDescription: text(row.DescriptionOfChangeGroup, 300),
    nursingCouncilNo: text(row.BNMC, 50),
    medicalCouncilNo: text(row.BMDC, 50),
    remarks: text(row.Remarks, 500),
    status: separated ? ('separated' as const) : row.IsInActive ? ('inactive' as const) : ('active' as const),
    statusReason: separated
      ? row.ResignationDate
        ? null
        : 'The old system had no separation day; the day the record last changed is used'
      : row.IsInActive
        ? text(row.InActiveReasons, 300)
        : null,
    separationDate: separated ? isoDay(separationDay) : null,
  };
  return accept(value);
}

/** Old IncrementTypes by name: "Percentage(%)", "Fixed", "Individual". */
export function incrementMethod(name: unknown): 'percentage' | 'fixed' | 'individual' {
  const words = text(name, 50)?.toLowerCase() ?? '';
  return words.startsWith('percent') ? 'percentage' : words.startsWith('fixed') ? 'fixed' : 'individual';
}

export interface LegacySalary {
  readonly EmployeeId: string;
  readonly BasicAmount: number | null;
  readonly HouseRentInPercentOfBasic: number | null;
  readonly MedicalAllownceInPercentOfBasic: number | null;
  readonly Conveyance: number | null;
  readonly OtherAllowance: number | null;
  readonly Others: number | null;
  readonly SpecialAllowance: number | null;
  readonly Pf: number | null;
  readonly Cpf: number | null;
  readonly TotalSalary: number | null;
  readonly OvertimePerHour: number | null;
  readonly FixedAmount: number | null;
  readonly IsPFDeductionOn: boolean | null;
  readonly TaxableAmount: number | null;
  readonly IncrementType: string | null;
}

/**
 * Old Payroll.IndividualSalaries → staff_salaries, amounts as they were (the old "percent" columns of house rent and
 * medical held amounts). The gross is the old total, or the sum of the parts when it was not kept.
 */
export function salaryRecord(row: LegacySalary) {
  const parts = {
    basic: amount(row.BasicAmount),
    houseRent: amount(row.HouseRentInPercentOfBasic),
    medical: amount(row.MedicalAllownceInPercentOfBasic),
    conveyance: amount(row.Conveyance),
    otherAllowance: amount(row.OtherAllowance),
  };
  const gross =
    amount(row.TotalSalary) || Math.round(Object.values(parts).reduce((sum, part) => sum + part * 100, 0)) / 100;
  if (gross <= 0) return reject<never>('no_salary');
  const pfEnabled = row.IsPFDeductionOn === true;
  return accept({
    gross,
    ...parts,
    pf: pfEnabled ? amount(row.Pf) : 0,
    cpf: pfEnabled ? amount(row.Cpf) : 0,
    pfEnabled,
    specialAllowance: amount(row.SpecialAllowance),
    otherFixed: amount(row.Others),
    overtimeRatePerHour: amount(row.OvertimePerHour),
    taxableAmount: amount(row.TaxableAmount),
    incrementMethod: incrementMethod(row.IncrementType),
    fixedIncrement: amount(row.FixedAmount),
  });
}

/** Old HR.LeavePolicies' day columns and the leave type each is, found by the type's name. */
export const POLICY_COLUMNS = [
  { column: 'Cl', label: 'casual leave', name: /casual/i },
  { column: 'Ml', label: 'maternity leave', name: /maternity/i },
  { column: 'MedicalLeave', label: 'medical leave', name: /medical|sick/i },
  { column: 'AnnualLeave', label: 'annual leave', name: /annual|earned/i },
  { column: 'FestivalLeave', label: 'festival leave', name: /festival/i },
  { column: 'GovtLeave', label: 'government holidays', name: /govt|government|public/i },
] as const;

/** The leave type a policy column is, among the types brought over (by name); null when none or several match. */
export function policyLeaveType(
  column: (typeof POLICY_COLUMNS)[number],
  types: readonly { id: string; name: string }[],
): string | null {
  const matches = types.filter((type) => column.name.test(type.name));
  return matches.length === 1 ? matches[0]!.id : null;
}

/** A leave's days within one calendar year (leave records may not cross a year); null when none fall in it. */
export function withinYear(start: Date, end: Date, year: number): { startDate: string; endDate: string } | null {
  const from = isoDay(start) < `${year}-01-01` ? `${year}-01-01` : isoDay(start);
  const to = isoDay(end) > `${year}-12-31` ? `${year}-12-31` : isoDay(end);
  return from <= to ? { startDate: from, endDate: to } : null;
}

/** A PF balance as an opening entry: what the fund owes the person is a credit; null when nothing is owed either way. */
export function pfOpening(credit: number, debit: number): { credit: number; debit: number } | null {
  const net = Math.round(credit * 100) - Math.round(debit * 100);
  if (net === 0) return null;
  return net > 0 ? { credit: net / 100, debit: 0 } : { credit: 0, debit: -net / 100 };
}
