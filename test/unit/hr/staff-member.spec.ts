import { describe, expect, it } from 'vitest';
import { safeFileName, validDocument, validPhoto } from '../../../src/modules/hr/domain/staff-file.js';
import {
  assertSubDepartmentOf,
  isCalendarDate,
  StaffMember,
  validEducation,
  validEmergencyContacts,
  type StaffProfile,
} from '../../../src/modules/hr/domain/staff-member.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const now = new Date('2026-10-25T00:00:00Z');
const PDF = new TextEncoder().encode('%PDF-1.7 minimal');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function profile(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    employeeNo: 'EMP-001',
    fullName: '  Rahima Akter ',
    firstName: '',
    middleName: null,
    lastName: null,
    fatherName: null,
    motherName: null,
    dateOfBirth: '1990-05-01',
    sex: 'female',
    maritalStatus: null,
    religion: null,
    bloodGroup: 'O+',
    nationalityCountryId: null,
    nationalityOther: null,
    nationalIdOrPassport: null,
    tinNo: null,
    mobileNo: '01700000000',
    officialMobileNo: null,
    email: ' Rahima@Example.com ',
    guardianContact: null,
    presentAddress: null,
    permanentAddress: null,
    divisionId: null,
    departmentId: 'dept',
    subDepartmentId: 'sub',
    designationId: 'desig',
    joiningDesignationId: null,
    joiningDate: '2020-01-15',
    probationEndDate: null,
    confirmationDate: '2020-07-15',
    employeeCategory: null,
    jobLocation: null,
    serviceNature: 'Permanent',
    salaryStatus: 'Regular',
    paymentMode: null,
    bankAccountNo: null,
    biometricEnrollmentNo: 1001,
    isHeadOfDepartment: false,
    workingTime: null,
    intervalTime: null,
    weeklyHoliday: null,
    shiftAndRelay: null,
    changeGroupDescription: null,
    nursingCouncilNo: null,
    medicalCouncilNo: null,
    remarks: null,
    userId: null,
    ...overrides,
  };
}

const hire = (overrides: Partial<StaffProfile> = {}) =>
  StaffMember.hire({ id: 's1', profile: profile(overrides), now });

describe('StaffMember', () => {
  it('normalizes text on hire and starts active', () => {
    const snapshot = hire().toSnapshot();
    expect(snapshot).toMatchObject({
      fullName: 'Rahima Akter',
      firstName: null,
      email: 'rahima@example.com',
      status: 'active',
      version: 1,
    });
  });

  it('validates identity and dates', () => {
    expect(() => hire({ employeeNo: 'bad no!' })).toThrow(/Employee number/);
    expect(() => hire({ joiningDate: '2026-02-30' })).toThrow(/Joining date/);
    expect(() => hire({ dateOfBirth: '2021-01-01' })).toThrow(/before the joining date/);
    expect(() => hire({ confirmationDate: '2019-12-31' })).toThrow(/Confirmation date/);
    expect(() => hire({ email: 'nope' })).toThrow(/email/);
    expect(() => hire({ serviceNature: '  ' })).toThrow(DomainError);
  });

  it('moves between active and inactive with a reason', () => {
    const staff = hire();
    staff.deactivate(' On long leave ', now);
    expect(staff.toSnapshot()).toMatchObject({ status: 'inactive', statusReason: 'On long leave', version: 2 });
    expect(() => staff.deactivate('again', now)).toThrow(/Already inactive/);
    staff.activate(now);
    expect(staff.toSnapshot()).toMatchObject({ status: 'active', statusReason: null });
    expect(() => staff.deactivate('', now)).toThrow(/reason/);
  });

  it('makes separation final', () => {
    const staff = hire();
    expect(() => staff.separate('2019-01-01', 'Resigned', now)).toThrow(/before the joining date/);
    staff.separate('2026-09-30', 'Resigned', now);
    expect(staff.toSnapshot()).toMatchObject({ status: 'separated', separationDate: '2026-09-30' });
    expect(() => staff.activate(now)).toThrow(/separated/);
    expect(() => staff.update({ mobileNo: '018' }, now)).toThrow(/separated/);
  });

  it('applies partial updates and re-checks the rules', () => {
    const staff = hire();
    staff.update({ mobileNo: ' 01800000000 ', remarks: '' }, now);
    expect(staff.toSnapshot()).toMatchObject({ mobileNo: '01800000000', remarks: null, fullName: 'Rahima Akter' });
    expect(() => staff.update({ joiningDate: '2021-01-01' }, now)).toThrow(/Confirmation date/);
  });

  it('checks that the sub-department belongs to the department', () => {
    expect(() => assertSubDepartmentOf({ departmentId: 'a', name: 'ICU' }, 'a')).not.toThrow();
    expect(() => assertSubDepartmentOf({ departmentId: 'b', name: 'ICU' }, 'a')).toThrow(/'ICU' belongs to another/);
  });

  it('knows real calendar dates', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2025-02-29')).toBe(false);
    expect(isCalendarDate('2025-1-01')).toBe(false);
  });
});

describe('staff lists', () => {
  it('validates education and emergency contacts', () => {
    expect(
      validEducation([{ examName: ' SSC ', passingYear: 2005, subject: null, result: 'A', board: 'Dhaka' }], 2026),
    ).toEqual([{ examName: 'SSC', passingYear: 2005, subject: null, result: 'A', board: 'Dhaka' }]);
    expect(() =>
      validEducation([{ examName: 'HSC', passingYear: 2099, subject: null, result: null, board: null }], 2026),
    ).toThrow(/Passing year/);
    expect(() => validEmergencyContacts([{ name: 'Karim', contact: ' ', relation: null }])).toThrow(/required/);
  });
});

describe('staff files', () => {
  it('accepts photos and documents only when the bytes match the type', () => {
    expect(validPhoto('image/png', PNG).contentType).toBe('image/png');
    expect(() => validPhoto('application/pdf', PDF)).toThrow(/A photo must be/);
    expect(validDocument('application/pdf', PDF).contentType).toBe('application/pdf');
    expect(() => validDocument('image/png', PDF)).toThrow(/match its Content-Type/);
    expect(() => validDocument('text/html', new TextEncoder().encode('<script>'))).toThrow(DomainError);
  });

  it('cleans file names', () => {
    expect(safeFileName('C:\\fakepath\\appointment "letter".pdf')).toBe('appointment letter.pdf');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(() => safeFileName('  ')).toThrow(/name/);
  });
});
