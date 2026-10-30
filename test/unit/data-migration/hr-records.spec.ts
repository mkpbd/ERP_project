import { describe, expect, it } from 'vitest';
import {
  incrementMethod,
  leaveTypeCode,
  pfOpening,
  POLICY_COLUMNS,
  policyLeaveType,
  salaryRecord,
  staffRecord,
  withinYear,
  type LegacySalary,
  type LegacyStaff,
} from '../../../src/cli/data-migration/hr-records.js';

const day = (value: string) => new Date(`${value}T00:00:00Z`);
const staff = (extra: Partial<LegacyStaff> = {}): LegacyStaff =>
  ({
    Id: 's1',
    EmployeeNo: ' e-101 ',
    EmployeeName: null,
    FirstName: 'Nasrin',
    MiddleName: null,
    LastName: 'Akter',
    Sex: 'F',
    BloodGroup: 'o(-ve)',
    MobileNo: '+8801711000000',
    JoiningDate: day('2020-03-01'),
    DateofBirth: day('0001-01-01'),
    BiometricEnrollmentNo: 0,
    ServiceNature: null,
    SalaryStatus: 'Regular',
    IsSeparated: false,
    IsInActive: false,
    ResignationDate: null,
    LastModifiedOn: day('2026-06-30'),
    IsDeleted: false,
    ...extra,
  }) as LegacyStaff;

describe('old staff', () => {
  it('makes a staff record, or says why not', () => {
    expect(staffRecord(staff())).toMatchObject({
      ok: true,
      value: {
        employeeNo: 'E-101',
        fullName: 'Nasrin Akter',
        sex: 'female',
        bloodGroup: 'O-',
        mobileNo: '01711000000',
        joiningDate: '2020-03-01',
        dateOfBirth: null,
        biometricEnrollmentNo: null,
        serviceNature: 'Permanent',
        status: 'active',
        separationDate: null,
      },
    });
    expect(staffRecord(staff({ IsDeleted: true }))).toEqual({ ok: false, reason: 'deleted' });
    expect(staffRecord(staff({ EmployeeNo: '' }))).toEqual({ ok: false, reason: 'no_employee_no' });
    expect(staffRecord(staff({ JoiningDate: null }))).toEqual({ ok: false, reason: 'no_joining_date' });
  });

  it('keeps who left, and when, or says the day was not recorded', () => {
    expect(staffRecord(staff({ IsSeparated: true, ResignationDate: day('2025-12-31') }))).toMatchObject({
      value: { status: 'separated', separationDate: '2025-12-31', statusReason: null },
    });
    expect(staffRecord(staff({ IsSeparated: true }))).toMatchObject({
      value: {
        status: 'separated',
        separationDate: '2026-06-30',
        statusReason: expect.stringMatching(/no separation day/),
      },
    });
    expect(staffRecord(staff({ IsInActive: true, InActiveReasons: 'Long leave' }))).toMatchObject({
      value: { status: 'inactive', statusReason: 'Long leave' },
    });
  });

  it('makes codes for leave types', () => {
    const taken = new Set<string>();
    const codes = ['Casual Leave', 'Medical Leave', 'Maternity Leave', 'Leave', 'Earned leave without pay'].map(
      (name) => {
        const code = leaveTypeCode(name, taken);
        taken.add(code);
        return code;
      },
    );
    expect(codes).toEqual(['CL', 'ML', 'ML2', 'LEAVE', 'ELWP']);
  });
});

describe('old pay and leave', () => {
  const pay = (extra: Partial<LegacySalary> = {}): LegacySalary => ({
    EmployeeId: 's1',
    BasicAmount: 18_000,
    HouseRentInPercentOfBasic: 9_000,
    MedicalAllownceInPercentOfBasic: 1_800,
    Conveyance: 1_200,
    OtherAllowance: 0,
    Others: null,
    SpecialAllowance: null,
    Pf: 1_800,
    Cpf: 1_800,
    TotalSalary: null,
    OvertimePerHour: null,
    FixedAmount: 500,
    IsPFDeductionOn: false,
    TaxableAmount: 0,
    IncrementType: 'Fixed',
    ...extra,
  });

  it('takes the salary as it was, the gross from its parts when the total was not kept', () => {
    expect(salaryRecord(pay())).toEqual({
      ok: true,
      value: expect.objectContaining({
        gross: 30_000,
        houseRent: 9_000,
        pf: 0,
        cpf: 0,
        pfEnabled: false,
        incrementMethod: 'fixed',
        fixedIncrement: 500,
      }),
    });
    expect(salaryRecord(pay({ TotalSalary: 31_000, IsPFDeductionOn: true }))).toMatchObject({
      value: { gross: 31_000, pf: 1_800 },
    });
    expect(
      salaryRecord(
        pay({ BasicAmount: 0, HouseRentInPercentOfBasic: 0, MedicalAllownceInPercentOfBasic: 0, Conveyance: 0 }),
      ),
    ).toEqual({
      ok: false,
      reason: 'no_salary',
    });
    expect([incrementMethod('Percentage(%)'), incrementMethod('Fixed'), incrementMethod(null)]).toEqual([
      'percentage',
      'fixed',
      'individual',
    ]);
  });

  it('finds the leave type of each old policy column by name, only when one fits', () => {
    const types = [
      { id: 'cl', name: 'Casual Leave' },
      { id: 'sick', name: 'Sick Leave' },
      { id: 'med', name: 'Medical Leave' },
    ];
    const column = (name: string) => POLICY_COLUMNS.find((entry) => entry.column === name)!;
    expect(policyLeaveType(column('Cl'), types)).toBe('cl');
    expect(policyLeaveType(column('MedicalLeave'), types)).toBeNull();
    expect(policyLeaveType(column('FestivalLeave'), types)).toBeNull();
  });

  it('keeps the days of a leave within the year, and PF balances on their side', () => {
    expect(withinYear(day('2026-12-30'), day('2027-01-02'), 2027)).toEqual({
      startDate: '2027-01-01',
      endDate: '2027-01-02',
    });
    expect(withinYear(day('2025-05-01'), day('2025-05-02'), 2027)).toBeNull();
    expect([pfOpening(54_000, 4_000), pfOpening(100, 250.5), pfOpening(10, 10)]).toEqual([
      { credit: 50_000, debit: 0 },
      { credit: 0, debit: 150.5 },
      null,
    ]);
  });
});
