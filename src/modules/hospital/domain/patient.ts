import { ConflictError, DomainError } from '../../../shared/domain/errors.js';

export const SEXES = ['male', 'female', 'other'] as const;
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
export const MARITAL_STATUSES = ['single', 'married', 'widowed', 'divorced', 'separated'] as const;
/** Old IDType: NID, PPNo, DLN, BRN. */
export const ID_TYPES = ['nid', 'passport', 'driving_licence', 'birth_certificate'] as const;

export type Sex = (typeof SEXES)[number];
export type BloodGroup = (typeof BLOOD_GROUPS)[number];
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];
export type IdType = (typeof ID_TYPES)[number];

/** The oldest a patient can be, to catch a date of birth typed in the wrong century. */
export const MAX_AGE_YEARS = 130;
const SERIALS_PER_YEAR = 1_000_000;

/**
 * Old UHID: a two-digit year then the year's serial, e.g. 26000001 (the old ids looked like 26137390). The serial
 * restarts each year; numbers never repeat because the year is part of them.
 */
export function uhidOf(year: number, serial: number): number {
  if (serial < 1 || serial >= SERIALS_PER_YEAR) {
    throw new DomainError('uhid_exhausted', `No UHID is left for ${year}`);
  }
  return (year % 100) * SERIALS_PER_YEAR + serial;
}

/** A UHID as printed: the organization's prefix (old InvPrefix, e.g. FKH) and the number. */
export const uhidLabel = (prefix: string, uhid: number) => `${prefix}${uhid}`;

/** A UHID as typed, with or without a prefix (the old cards printed FKH26000001). */
export function parseUhid(value: string): number | null {
  const digits = value.trim().replace(/^[A-Za-z]+[-\s]?/, '');
  return /^\d{7,8}$/.test(digits) ? Number(digits) : null;
}

/** A Bangladesh mobile number as 01XXXXXXXXX: spaces and dashes dropped, +880 or 880 turned into 0. */
export function normalMobile(value: string, what = 'mobile number'): string {
  const digits = value.replace(/[\s-]/g, '').replace(/^\+?880/, '0');
  if (!/^01[3-9]\d{8}$/.test(digits)) {
    throw new DomainError('invalid_mobile', `The ${what} is not a Bangladesh mobile number (01XXXXXXXXX)`);
  }
  return digits;
}

/** Collapsed spaces, null when empty, at most `max` characters. */
export function text(value: string | null | undefined, max: number, what: string): string | null {
  const cleaned = value?.replace(/\s+/g, ' ').trim() ?? '';
  if (cleaned.length === 0) return null;
  if (cleaned.length > max) throw new DomainError('invalid_text', `The ${what} is longer than ${max} characters`);
  return cleaned;
}

export interface Age {
  readonly years: number;
  readonly months: number;
  readonly days: number;
}

const toDate = (isoDay: string) => new Date(`${isoDay}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** Age in completed years, months and days on a date. */
export function ageOn(dateOfBirth: string, on: string): Age {
  const birth = toDate(dateOfBirth);
  const at = toDate(on);
  let years = at.getUTCFullYear() - birth.getUTCFullYear();
  let months = at.getUTCMonth() - birth.getUTCMonth();
  let days = at.getUTCDate() - birth.getUTCDate();
  if (days < 0) {
    months -= 1;
    // Days of the month before `on`.
    days += new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years, months, days };
}

/**
 * Old AgeYear / AgeMonth / AgeDay typed at the counter: the date of birth they give on a date (marked estimated).
 * Days over a month and months over a year are carried, as the old page did.
 */
export function birthFromAge(age: Age, on: string): string {
  for (const [value, what] of [
    [age.years, 'years'],
    [age.months, 'months'],
    [age.days, 'days'],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 10_000) {
      throw new DomainError('invalid_age', `The age in ${what} is a whole number`);
    }
  }
  const at = toDate(on);
  let year = at.getUTCFullYear() - age.years;
  let month = at.getUTCMonth() - age.months;
  year += Math.floor(month / 12);
  month = ((month % 12) + 12) % 12;
  // 31 March less a month is the last of February, not 3 March.
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const date = new Date(Date.UTC(year, month, Math.min(at.getUTCDate(), lastDay)));
  date.setUTCDate(date.getUTCDate() - age.days);
  return toDay(date);
}

function validBirth(dateOfBirth: string, today: string): string {
  if (dateOfBirth > today) throw new DomainError('invalid_birth_date', 'The date of birth is in the future');
  if (ageOn(dateOfBirth, today).years > MAX_AGE_YEARS) {
    throw new DomainError('invalid_birth_date', `A patient is at most ${MAX_AGE_YEARS} years old`);
  }
  return dateOfBirth;
}

export interface PatientDetails {
  title: string | null;
  fullName: string;
  sex: Sex;
  dateOfBirth: string;
  birthEstimated: boolean;
  bloodGroup: BloodGroup | null;
  maritalStatus: MaritalStatus | null;
  religion: string | null;
  occupation: string | null;
  fatherName: string | null;
  motherName: string | null;
  spouseName: string | null;
  /** Null for a newborn or an emergency patient without one: then the contact person's mobile is needed. */
  mobileNo: string | null;
  email: string | null;
  idType: IdType | null;
  idNo: string | null;
  careOf: string | null;
  houseNo: string | null;
  roadNo: string | null;
  village: string | null;
  postOffice: string | null;
  area: string | null;
  districtId: string | null;
  contactName: string | null;
  contactRelation: string | null;
  contactMobileNo: string | null;
  contactAddress: string | null;
  specialAlert: string | null;
  confidential: boolean;
}

/** What the counter sends: a date of birth, or an age to work one out from. */
export type PatientInput = Omit<PatientDetails, 'dateOfBirth' | 'birthEstimated'> & {
  dateOfBirth: string | null;
  age: Age | null;
};

/** Cleans and checks what was typed (the old page title-cased and kept anything; here the server checks). */
export function patientDetails(input: PatientInput, today: string): PatientDetails {
  if ((input.dateOfBirth === null) === (input.age === null)) {
    throw new DomainError('invalid_birth_date', 'Give either the date of birth or the age');
  }
  const dateOfBirth = validBirth(input.dateOfBirth ?? birthFromAge(input.age!, today), today);
  const fullName = text(input.fullName, 150, 'name');
  if (!fullName) throw new DomainError('invalid_name', "Give the patient's name");
  // Upper case, so a passport number typed either way is the same document.
  const idNo = text(input.idNo, 40, 'ID number')?.toUpperCase() ?? null;
  if ((input.idType === null) !== (idNo === null)) {
    throw new DomainError('invalid_id_document', 'Give both the kind of ID and its number, or neither');
  }
  if (input.idType === 'nid' && idNo !== null && !/^(\d{10}|\d{13}|\d{17})$/.test(idNo)) {
    throw new DomainError('invalid_id_document', 'A national ID number has 10, 13 or 17 digits');
  }
  const contactMobileNo = input.contactMobileNo ? normalMobile(input.contactMobileNo, 'contact mobile number') : null;
  const mobileNo = input.mobileNo ? normalMobile(input.mobileNo) : null;
  if (mobileNo === null && contactMobileNo === null) {
    throw new DomainError('mobile_needed', "Give the patient's mobile number or the contact person's");
  }
  return {
    title: text(input.title, 20, 'title'),
    fullName,
    sex: input.sex,
    dateOfBirth,
    birthEstimated: input.dateOfBirth === null,
    bloodGroup: input.bloodGroup,
    maritalStatus: input.maritalStatus,
    religion: text(input.religion, 50, 'religion'),
    occupation: text(input.occupation, 100, 'occupation'),
    fatherName: text(input.fatherName, 150, "father's name"),
    motherName: text(input.motherName, 150, "mother's name"),
    spouseName: text(input.spouseName, 150, "spouse's name"),
    mobileNo,
    email: text(input.email, 254, 'email')?.toLowerCase() ?? null,
    idType: input.idType,
    idNo,
    careOf: text(input.careOf, 150, 'care of'),
    houseNo: text(input.houseNo, 50, 'house number'),
    roadNo: text(input.roadNo, 50, 'road number'),
    village: text(input.village, 100, 'village'),
    postOffice: text(input.postOffice, 100, 'post office'),
    area: text(input.area, 100, 'area or thana'),
    districtId: input.districtId,
    contactName: text(input.contactName, 150, "contact person's name"),
    contactRelation: text(input.contactRelation, 50, 'relation'),
    contactMobileNo,
    contactAddress: text(input.contactAddress, 300, "contact person's address"),
    specialAlert: text(input.specialAlert, 300, 'special alert'),
    confidential: input.confidential,
  };
}

export interface PatientProps extends PatientDetails {
  id: string;
  uhid: number;
  registeredOn: string;
  registeredBy: string | null;
  isActive: boolean;
  inactiveReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/** Old Hospital.RegRecords: one row per person, the UHID they keep for every visit. */
export class Patient {
  private constructor(private readonly props: PatientProps) {}

  static register(params: {
    id: string;
    uhid: number;
    details: PatientDetails;
    registeredOn: string;
    by: string;
    now: Date;
  }): Patient {
    return new Patient({
      ...params.details,
      id: params.id,
      uhid: params.uhid,
      registeredOn: params.registeredOn,
      registeredBy: params.by,
      isActive: true,
      inactiveReason: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: PatientProps): Patient {
    return new Patient({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get uhid(): number {
    return this.props.uhid;
  }
  get isActive(): boolean {
    return this.props.isActive;
  }

  /** The details replaced as a whole; an inactive record is not changed. */
  change(details: PatientDetails, now: Date): void {
    this.assertActive('changed');
    Object.assign(this.props, details);
    this.touch(now);
  }

  /** No longer in use: registered twice, or a record made by mistake. The UHID is never given again. */
  deactivate(reason: string, now: Date): void {
    this.assertActive('deactivated');
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.isActive = false;
    this.props.inactiveReason = why;
    this.touch(now);
  }

  reactivate(now: Date): void {
    if (this.props.isActive) throw new DomainError('patient_state', 'The patient is active already');
    this.props.isActive = true;
    this.props.inactiveReason = null;
    this.touch(now);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_patient', 'The patient was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<PatientProps> {
    return { ...this.props };
  }

  private assertActive(action: string): void {
    if (!this.props.isActive) throw new DomainError('patient_state', `An inactive patient cannot be ${action}`);
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}
