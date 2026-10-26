import { describe, expect, it } from 'vitest';
import {
  ageOn,
  birthFromAge,
  normalMobile,
  parseUhid,
  Patient,
  patientDetails,
  uhidOf,
  uhidLabel,
  type PatientInput,
} from '../../../src/modules/hospital/domain/patient.js';

const today = '2026-10-26';
const now = new Date('2026-10-26T04:00:00Z');
const input = (extra: Partial<PatientInput> = {}): PatientInput => ({
  title: 'Mr',
  fullName: '  Abdul   Karim ',
  sex: 'male',
  dateOfBirth: '1980-05-17',
  age: null,
  bloodGroup: 'B+',
  maritalStatus: 'married',
  religion: null,
  occupation: null,
  fatherName: null,
  motherName: null,
  spouseName: null,
  mobileNo: '+880 1711-000000',
  email: null,
  idType: null,
  idNo: null,
  careOf: null,
  houseNo: null,
  roadNo: null,
  village: null,
  postOffice: null,
  area: null,
  districtId: null,
  contactName: null,
  contactRelation: null,
  contactMobileNo: null,
  contactAddress: null,
  specialAlert: null,
  confidential: false,
  ...extra,
});

describe('UHID', () => {
  it('is the two-digit year and the serial, read back with or without a prefix', () => {
    expect(uhidOf(2026, 1)).toBe(26_000_001);
    expect(uhidOf(2031, 137_390)).toBe(31_137_390);
    expect(() => uhidOf(2026, 1_000_000)).toThrow(/No UHID is left/);
    expect(parseUhid('FKH26000001')).toBe(26_000_001);
    expect(parseUhid(' 26000001 ')).toBe(26_000_001);
    expect(parseUhid('Karim')).toBeNull();
    expect(parseUhid('01711000000')).toBeNull();
    expect(uhidLabel('FKH', 26_000_001)).toBe('FKH26000001');
    expect(uhidLabel('', 26_000_001)).toBe('26000001');
  });
});

describe('patient details', () => {
  it('normalises mobile numbers and refuses others', () => {
    expect(normalMobile('+880 1711-000000')).toBe('01711000000');
    expect(normalMobile('8801911000000')).toBe('01911000000');
    expect(() => normalMobile('abc')).toThrow(/not a Bangladesh mobile/);
    expect(() => normalMobile('01211000000')).toThrow(/not a Bangladesh mobile/);
  });

  it('gives the age in years, months and days, and a birth date from an age at month ends', () => {
    expect(ageOn('1980-05-17', today)).toEqual({ years: 46, months: 5, days: 9 });
    expect(ageOn('2026-09-30', today)).toEqual({ years: 0, months: 0, days: 26 });
    expect(ageOn('2025-10-27', today)).toEqual({ years: 0, months: 11, days: 29 });
    expect(birthFromAge({ years: 46, months: 5, days: 9 }, today)).toBe('1980-05-17');
    // 31 March less one month is the last of February.
    expect(birthFromAge({ years: 0, months: 1, days: 0 }, '2026-03-31')).toBe('2026-02-28');
    // Days over a month and months over a year carry, as the old page did.
    expect(birthFromAge({ years: 0, months: 14, days: 0 }, today)).toBe('2025-08-26');
  });

  it('takes a date of birth or an age, never both or neither, and cleans what was typed', () => {
    const details = patientDetails(input(), today);
    expect(details).toMatchObject({
      fullName: 'Abdul Karim',
      mobileNo: '01711000000',
      dateOfBirth: '1980-05-17',
      birthEstimated: false,
    });
    expect(patientDetails(input({ dateOfBirth: null, age: { years: 3, months: 0, days: 0 } }), today)).toMatchObject({
      dateOfBirth: '2023-10-26',
      birthEstimated: true,
    });
    expect(() => patientDetails(input({ age: { years: 3, months: 0, days: 0 } }), today)).toThrow(/either/);
    expect(() => patientDetails(input({ dateOfBirth: null }), today)).toThrow(/either/);
    expect(() => patientDetails(input({ dateOfBirth: '2026-10-27' }), today)).toThrow(/future/);
    expect(() => patientDetails(input({ dateOfBirth: '1890-01-01' }), today)).toThrow(/at most 130/);
    expect(() => patientDetails(input({ fullName: '   ' }), today)).toThrow(/name/);
  });

  it('checks ID documents: both parts, NID digits, the same number in any case', () => {
    expect(() => patientDetails(input({ idType: 'nid', idNo: null }), today)).toThrow(/both/);
    expect(() => patientDetails(input({ idType: 'nid', idNo: '12345' }), today)).toThrow(/10, 13 or 17/);
    expect(patientDetails(input({ idType: 'nid', idNo: '1234567890' }), today).idNo).toBe('1234567890');
    expect(patientDetails(input({ idType: 'passport', idNo: 'bx0123456' }), today).idNo).toBe('BX0123456');
    expect(() => patientDetails(input({ contactMobileNo: '12' }), today)).toThrow(/contact mobile/);
  });

  it("needs the patient's mobile or, for a newborn or an emergency, the contact person's", () => {
    expect(() => patientDetails(input({ mobileNo: null }), today)).toThrow(/mobile number or the contact/);
    expect(patientDetails(input({ mobileNo: null, contactMobileNo: '01811 000000' }), today)).toMatchObject({
      mobileNo: null,
      contactMobileNo: '01811000000',
    });
  });
});

describe('Patient', () => {
  const registered = () =>
    Patient.register({
      id: 'p',
      uhid: 26_000_001,
      details: patientDetails(input(), today),
      registeredOn: today,
      by: 'clerk',
      now,
    });

  it('is changed while active, taken out of use with a reason and back, never changed out of use', () => {
    const patient = registered();
    patient.change(patientDetails(input({ fullName: 'Abdul Karim Chowdhury' }), today), now);
    expect(patient.toSnapshot()).toMatchObject({ fullName: 'Abdul Karim Chowdhury', version: 2, uhid: 26_000_001 });
    expect(() => patient.deactivate(' ', now)).toThrow(/reason/);
    patient.deactivate('Registered twice, see UHID 26000002', now);
    expect(() => patient.change(patientDetails(input(), today), now)).toThrow(/inactive/);
    expect(() => patient.assertVersion(2)).toThrow(/changed by someone else/);
    patient.reactivate(now);
    expect(patient.toSnapshot()).toMatchObject({ isActive: true, inactiveReason: null, version: 4 });
    expect(() => patient.reactivate(now)).toThrow(/active already/);
  });
});
