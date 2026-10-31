import { describe, expect, it } from 'vitest';
import { newReport, noteRejection, plan, type Loader } from '../../../src/cli/data-migration/etl.js';
import {
  birth,
  bloodGroup,
  doctorRecord,
  maritalStatus,
  mobile,
  patientRecord,
  roleName,
  sex,
  userRecord,
  type LegacyPatient,
} from '../../../src/cli/data-migration/legacy-records.js';
import { verifyAspNetIdentityHash } from '../../../src/modules/identity/infrastructure/security/aspnet-identity-hash.js';
import { Argon2PasswordHasher } from '../../../src/modules/identity/infrastructure/security/argon2-password-hasher.js';
import { aspNetIdentityHash } from '../../support/aspnet-hash.js';

const registered = new Date('2026-03-15T00:00:00Z');
const patient = (extra: Partial<LegacyPatient> = {}): LegacyPatient => ({
  Id: 'p1',
  UHID: 26000123,
  Title: 'Mr.',
  GivenName: 'Abdul',
  Surname: 'Karim',
  FullName: null,
  AgeYear: '45',
  AgeMonth: '0',
  AgeDay: '0',
  Dob: null,
  Sex: 'Male',
  FatherName: null,
  MotherName: null,
  SpouseName: null,
  MaritalStatus: 'Married',
  Profession: 'Business',
  MobileNo: '+880 1711-000000',
  Email: ' Karim@Example.COM ',
  CareOf: null,
  HouseNo: '12',
  RoadNo: null,
  Village: null,
  Po: 'Cox’s Bazar',
  ArearOrThana: 'Sadar',
  District: "Cox's Bazar",
  Cpname: null,
  Cpmobile: null,
  Cpaddress: null,
  RelationWithPatient: null,
  BloodGroup: 'b(+ve)',
  NationalId: '1234 5678 90',
  RegDate: registered,
  IsDeleted: false,
  ...extra,
});

describe('old values', () => {
  it('reads mobiles, sexes, blood groups and marital states however they were written', () => {
    expect(mobile('+880 1711-000000')).toBe('01711000000');
    expect(mobile('1811000000')).toBe('01811000000');
    expect(mobile('02-123456')).toBeNull();
    // As the old records wrote them: Bangla digits, a number among words, the first of two.
    expect([
      mobile('০১৭১১-০০০০০০'),
      mobile('Father: 01911 000000'),
      mobile('01711000000 / 01811000000'),
      mobile('N/A'),
      mobile('01'),
    ]).toEqual(['01711000000', '01911000000', '01711000000', null, null]);
    expect([sex('M'), sex('Female'), sex('TG'), sex('?')]).toEqual(['male', 'female', 'other', null]);
    expect([bloodGroup('O-ve'), bloodGroup('ab positive'), bloodGroup('A'), bloodGroup('B (+)')]).toEqual([
      'O-',
      'AB+',
      null,
      'B+',
    ]);
    expect([roleName('Front Desk'), roleName('Super Admin!'), roleName('2nd Shift'), roleName('  ')]).toEqual([
      'front-desk',
      'super-admin',
      'role-2nd-shift',
      null,
    ]);
    expect([maritalStatus('Unmarried'), maritalStatus('widow'), maritalStatus('')]).toEqual([
      'single',
      'widowed',
      null,
    ]);
  });

  it('takes the birth day, or works it out from the age on the day registered', () => {
    expect(birth(new Date('1980-05-17T00:00:00Z'), { years: 0, months: 0, days: 0 }, registered)).toEqual({
      dateOfBirth: '1980-05-17',
      estimated: false,
    });
    expect(birth(null, { years: '45', months: '2', days: '' }, registered)).toEqual({
      dateOfBirth: '1981-01-15',
      estimated: true,
    });
    expect(birth(new Date('0001-01-01T00:00:00Z'), { years: 0, months: 0, days: 10 }, registered)?.dateOfBirth).toBe(
      '2026-03-05',
    );
    expect(birth(null, { years: null, months: null, days: null }, registered)).toBeNull();
  });
});

describe('records brought over', () => {
  it('makes a patient of a registration, or says why not', () => {
    const made = patientRecord(patient());
    expect(made).toMatchObject({
      ok: true,
      value: {
        uhid: 26000123,
        fullName: 'Abdul Karim',
        sex: 'male',
        dateOfBirth: '1981-03-15',
        birthEstimated: true,
        bloodGroup: 'B+',
        maritalStatus: 'married',
        mobileNo: '01711000000',
        email: 'karim@example.com',
        idType: 'nid',
        idNo: '1234567890',
        area: "Sadar, Cox's Bazar",
        registeredOn: '2026-03-15',
        isActive: true,
      },
    });
    expect(patientRecord(patient({ MobileNo: null, Cpmobile: '01911000000' }))).toMatchObject({
      ok: true,
      value: { mobileNo: null, contactMobileNo: '01911000000' },
    });
    expect(patientRecord(patient({ MobileNo: 'none' }))).toEqual({ ok: false, reason: 'no_mobile' });
    expect(patientRecord(patient({ Sex: '' }))).toEqual({ ok: false, reason: 'unknown_sex' });
    expect(patientRecord(patient({ GivenName: null, Surname: null }))).toEqual({ ok: false, reason: 'no_name' });
    expect(patientRecord(patient({ IsDeleted: true }))).toMatchObject({ value: { isActive: false } });
  });

  it('makes a user of an account, keeping the old hash behind its prefix', () => {
    const row = {
      Id: 'u1',
      UserName: 'Rana.Ahmed',
      Email: null,
      PasswordHash: 'AQAAAA',
      FirstName: 'Rana',
      LastName: 'Ahmed',
      FullName: null,
      IsActive: true,
      IsDeleted: false,
      CreatedOn: null,
    };
    expect(userRecord(row)).toEqual({
      ok: true,
      value: {
        email: 'rana.ahmed@users.invalid',
        username: 'rana.ahmed',
        displayName: 'Rana Ahmed',
        passwordHash: 'aspnet-identity$AQAAAA',
        active: true,
        placeholderEmail: true,
      },
    });
    expect(userRecord({ ...row, UserName: null })).toEqual({ ok: false, reason: 'no_email_or_username' });
  });

  it('makes a doctor, a consultant when they had chamber fees', () => {
    const base = {
      Id: 'd1',
      Name: ' Dr.  Nusrat Jahan ',
      DoctorCodeNo: 'd-101',
      PhoneFax: null,
      DoctorFieldOfSpecialityId: null,
      OPDChamberVisitFeeMaiden: 1000,
      OPDChamberVisitFeeNew: 800,
      OPDChamberVisitFeeOld: 0,
      OPDChamberReportConsultancyFee: null,
      IsDeleted: false,
    };
    expect(doctorRecord(base)).toMatchObject({
      ok: true,
      value: { name: 'Dr. Nusrat Jahan', code: 'D-101', firstVisitFee: 1000, followUpFee: 0, isConsultant: true },
    });
    expect(doctorRecord({ ...base, OPDChamberVisitFeeMaiden: 0, OPDChamberVisitFeeNew: 0 })).toMatchObject({
      value: { isConsultant: false },
    });
  });
});

describe('old passwords', () => {
  it('verify against ASP.NET Identity v3 and v2 hashes, and nothing else', async () => {
    for (const format of ['v3-sha256', 'v3-sha512', 'v2'] as const) {
      const hash = aspNetIdentityHash('Old-Passw0rd!', format);
      expect(await verifyAspNetIdentityHash(hash, 'Old-Passw0rd!')).toBe(true);
      expect(await verifyAspNetIdentityHash(hash, 'old-passw0rd!')).toBe(false);
    }
    expect(await verifyAspNetIdentityHash('', 'x')).toBe(false);
    expect(await verifyAspNetIdentityHash('AgAAAA==', 'x')).toBe(false);
  });

  it('are taken by the password hasher and always rehashed', async () => {
    const hasher = new Argon2PasswordHasher();
    const stored = `aspnet-identity$${aspNetIdentityHash('Old-Passw0rd!')}`;
    expect(await hasher.verify(stored, 'Old-Passw0rd!')).toBe(true);
    expect(await hasher.verify('aspnet-identity$', 'anything')).toBe(false);
    expect(hasher.needsRehash(stored)).toBe(true);
  });
});

describe('the run', () => {
  it('orders loaders after what they depend on, and counts rejections with examples', () => {
    const loader = (name: string, dependsOn: string[] = []): Loader => ({
      name,
      dependsOn,
      run: () => Promise.resolve(),
    });
    const all = [
      loader('doctors', ['specialities', 'users']),
      loader('users'),
      loader('specialities'),
      loader('patients'),
    ];
    expect(plan(all, ['doctors']).map((entry) => entry.name)).toEqual(['specialities', 'users', 'doctors']);
    expect(plan(all, null).map((entry) => entry.name)).toEqual(['specialities', 'users', 'doctors', 'patients']);
    expect(() => plan(all, ['nurses'])).toThrow(/Unknown loader nurses/);
    const report = newReport('patients');
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) noteRejection(report, id, 'no_mobile');
    expect(report).toMatchObject({
      rejected: 6,
      reasons: { no_mobile: { count: 6, examples: ['a', 'b', 'c', 'd', 'e'] } },
    });
  });
});
