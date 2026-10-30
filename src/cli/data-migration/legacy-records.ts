/** What one row became: a record to write, or why it was left out. */
export type Transformed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export const accept = <T>(value: T): Transformed<T> => ({ ok: true, value });
export const reject = <T>(reason: string): Transformed<T> => ({ ok: false, reason });

/** Imported password hashes carry this prefix (verified as ASP.NET Identity hashes, then rehashed at sign-in). */
export const LEGACY_HASH_PREFIX = 'aspnet-identity$';

/** A column's value as text: strings, numbers and booleans as written; anything else (null, objects) as ''. */
const asText = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';

const clean = (value: unknown, max = 300): string | null => {
  const text = asText(value).replace(/\s+/g, ' ').trim();
  return text === '' ? null : text.slice(0, max);
};

const isoDay = (value: Date) => value.toISOString().slice(0, 10);

/** 01XXXXXXXXX from the many ways the old records wrote a mobile; null when it is not one. */
export function mobile(value: unknown): string | null {
  const digits = asText(value)
    .replace(/[^\d+]/g, '')
    .replace(/^\+?880/, '0')
    .replace(/^(1[3-9]\d{8})$/, '0$1');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

export function sex(value: unknown): 'male' | 'female' | 'other' | null {
  const text = asText(value).trim().toLowerCase();
  if (['m', 'male', 'man', 'boy'].includes(text)) return 'male';
  if (['f', 'female', 'woman', 'girl'].includes(text)) return 'female';
  if (['o', 'other', 'others', 'third gender', 'tg'].includes(text)) return 'other';
  return null;
}

/** "A+", "A (+ve)", "a positive" → A+. */
export function bloodGroup(value: unknown): 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | null {
  const text = asText(value)
    .toUpperCase()
    .replace(/\s|\(|\)/g, '');
  const match = /^(AB|A|B|O)(\+|-|\+VE|-VE|POSITIVE|NEGATIVE|POS|NEG)$/.exec(text);
  if (!match) return null;
  const negative = match[2]!.startsWith('-') || match[2]!.startsWith('NEG');
  return `${match[1]}${negative ? '-' : '+'}` as 'A+';
}

export function maritalStatus(value: unknown) {
  const text = asText(value).trim().toLowerCase();
  if (text.startsWith('unmarried') || text === 'single') return 'single' as const;
  if (text.startsWith('married')) return 'married' as const;
  if (text.startsWith('widow')) return 'widowed' as const;
  if (text.startsWith('divorce')) return 'divorced' as const;
  if (text.startsWith('separate')) return 'separated' as const;
  return null;
}

/** The birth day, or one worked out from the age written on the day registered (then marked estimated). */
export function birth(
  dob: Date | null,
  age: { years: unknown; months: unknown; days: unknown },
  registeredOn: Date,
): { dateOfBirth: string; estimated: boolean } | null {
  if (dob && dob.getUTCFullYear() > 1890 && dob.getTime() <= registeredOn.getTime()) {
    return { dateOfBirth: isoDay(dob), estimated: false };
  }
  const part = (value: unknown) => {
    const number = Number.parseInt(asText(value), 10);
    return Number.isFinite(number) && number >= 0 ? number : 0;
  };
  const [years, months, days] = [part(age.years), part(age.months), part(age.days)];
  if (years + months + days === 0 || years > 130) return null;
  const date = new Date(registeredOn);
  date.setUTCFullYear(date.getUTCFullYear() - years);
  date.setUTCMonth(date.getUTCMonth() - months);
  date.setUTCDate(date.getUTCDate() - days);
  return { dateOfBirth: isoDay(date), estimated: true };
}

export interface LegacyPatient {
  Id: string;
  UHID: number | string;
  Title: string | null;
  GivenName: string | null;
  Surname: string | null;
  FullName: string | null;
  AgeYear: string | null;
  AgeMonth: string | null;
  AgeDay: string | null;
  Dob: Date | null;
  Sex: string | null;
  FatherName: string | null;
  MotherName: string | null;
  SpouseName: string | null;
  MaritalStatus: string | null;
  Profession: string | null;
  MobileNo: string | null;
  Email: string | null;
  CareOf: string | null;
  HouseNo: string | null;
  RoadNo: string | null;
  Village: string | null;
  Po: string | null;
  ArearOrThana: string | null;
  District: string | null;
  Cpname: string | null;
  Cpmobile: string | null;
  Cpaddress: string | null;
  RelationWithPatient: string | null;
  BloodGroup: string | null;
  NationalId: string | null;
  RegDate: Date;
  IsDeleted: boolean | null;
}

/** Old Hospital.RegRecords → hospital_patients (the UHID kept). */
export function patientRecord(row: LegacyPatient) {
  const uhid = Number(row.UHID);
  if (!Number.isSafeInteger(uhid) || uhid <= 0) return reject<never>('invalid_uhid');
  const fullName = clean(row.FullName, 150) ?? clean([row.GivenName, row.Surname].filter(Boolean).join(' '), 150);
  if (!fullName) return reject<never>('no_name');
  const patientSex = sex(row.Sex);
  if (!patientSex) return reject<never>('unknown_sex');
  const born = birth(row.Dob, { years: row.AgeYear, months: row.AgeMonth, days: row.AgeDay }, row.RegDate);
  if (!born) return reject<never>('no_birth_or_age');
  const own = mobile(row.MobileNo);
  const contact = mobile(row.Cpmobile);
  if (!own && !contact) return reject<never>('no_mobile');
  const email = clean(row.Email, 150)?.toLowerCase() ?? null;
  const nid = clean(row.NationalId, 30)?.replace(/\D/g, '') ?? '';
  const area = [clean(row.ArearOrThana), clean(row.District)].filter(Boolean).join(', ');
  return accept({
    uhid,
    title: clean(row.Title, 20),
    fullName,
    sex: patientSex,
    dateOfBirth: born.dateOfBirth,
    birthEstimated: born.estimated,
    bloodGroup: bloodGroup(row.BloodGroup),
    maritalStatus: maritalStatus(row.MaritalStatus),
    occupation: clean(row.Profession, 100),
    fatherName: clean(row.FatherName, 150),
    motherName: clean(row.MotherName, 150),
    spouseName: clean(row.SpouseName, 150),
    mobileNo: own,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null,
    idType: /^(\d{10}|\d{13}|\d{17})$/.test(nid) ? ('nid' as const) : null,
    idNo: /^(\d{10}|\d{13}|\d{17})$/.test(nid) ? nid : null,
    careOf: clean(row.CareOf, 150),
    houseNo: clean(row.HouseNo, 50),
    roadNo: clean(row.RoadNo, 50),
    village: clean(row.Village, 100),
    postOffice: clean(row.Po, 100),
    area: area === '' ? null : area.slice(0, 150),
    contactName: clean(row.Cpname, 150),
    contactRelation: clean(row.RelationWithPatient, 50),
    contactMobileNo: contact,
    contactAddress: clean(row.Cpaddress, 300),
    registeredOn: isoDay(row.RegDate),
    isActive: !row.IsDeleted,
    inactiveReason: row.IsDeleted ? 'Deleted in the old system' : null,
  });
}

export interface LegacyUser {
  Id: string;
  UserName: string | null;
  Email: string | null;
  PasswordHash: string | null;
  FirstName: string | null;
  LastName: string | null;
  FullName: string | null;
  IsActive: boolean | null;
  IsDeleted: boolean | null;
  CreatedOn: Date | null;
}

/** Old Identity.Users → users: the username kept, a placeholder email when there was none, the old hash prefixed. */
export function userRecord(row: LegacyUser): Transformed<{
  email: string;
  username: string | null;
  displayName: string;
  passwordHash: string;
  active: boolean;
  placeholderEmail: boolean;
}> {
  const username =
    clean(row.UserName, 64)
      ?.toLowerCase()
      .replace(/[^a-z0-9._-]/g, '') || null;
  const given = clean(row.Email, 254)?.toLowerCase() ?? null;
  const validEmail = given && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(given) ? given : null;
  if (!validEmail && !username) return reject<never>('no_email_or_username');
  const displayName =
    clean(row.FullName, 100) ?? clean([row.FirstName, row.LastName].filter(Boolean).join(' '), 100) ?? username!;
  return accept({
    email: validEmail ?? `${username}@users.invalid`,
    username,
    displayName,
    // No hash (or an unreadable one) never matches: the user resets their password.
    passwordHash: `${LEGACY_HASH_PREFIX}${clean(row.PasswordHash, 1000) ?? ''}`,
    active: row.IsActive !== false && !row.IsDeleted,
    placeholderEmail: !validEmail,
  });
}

export interface LegacyDoctor {
  Id: string;
  Name: string | null;
  DoctorCodeNo: string | null;
  PhoneFax: string | null;
  DoctorFieldOfSpecialityId: string | null;
  OPDChamberVisitFeeMaiden: number | null;
  OPDChamberVisitFeeNew: number | null;
  OPDChamberVisitFeeOld: number | null;
  OPDChamberReportConsultancyFee: number | null;
  IsDeleted: boolean | null;
}

const fee = (value: number | null) => (value && value > 0 ? Math.round(value * 100) / 100 : 0);

/** Old Marketing.Doctors → hospital_doctors: chamber fees kept; one with any chamber fee sees patients here. */
export function doctorRecord(row: LegacyDoctor) {
  const name = clean(row.Name, 150);
  if (!name) return reject<never>('no_name');
  const fees = {
    firstVisitFee: fee(row.OPDChamberVisitFeeMaiden),
    newVisitFee: fee(row.OPDChamberVisitFeeNew),
    followUpFee: fee(row.OPDChamberVisitFeeOld),
    reportFee: fee(row.OPDChamberReportConsultancyFee),
  };
  return accept({
    name,
    code: clean(row.DoctorCodeNo, 20)?.toUpperCase() ?? null,
    phone: clean(row.PhoneFax, 50),
    ...fees,
    isConsultant: Object.values(fees).some((value) => value > 0),
    isActive: !row.IsDeleted,
  });
}

/** A role's name as roles are named here (lower-case words joined by hyphens): "Front Desk" → front-desk. */
export function roleName(value: unknown): string | null {
  const slug = asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 58);
  if (slug === '') return null;
  return /^[a-z]/.test(slug) && slug.length >= 2 ? slug : `role-${slug}`;
}
