import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { districts } from '../../../location/infrastructure/persistence/location.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
// The same lists as the domain's (kept literal here so drizzle-kit loads this file on its own).
const SEXES = ['male', 'female', 'other'] as const;
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const MARITAL_STATUSES = ['single', 'married', 'widowed', 'divorced', 'separated'] as const;
const ID_TYPES = ['nid', 'passport', 'driving_licence', 'birth_certificate'] as const;
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

// Old Admin.InvoiceGenerators as used for UHIDs (spGetNextInvoiceNo with the patient registration service unit): one
// counter per kind and year, incremented under the row lock of an upsert.
export const hospitalSequences = pgTable(
  'hospital_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old Hospital.RegRecords. Lookups the old row copied as text (sex, blood group, marital status) are fixed lists
// here; the address keeps the old free-text parts with the district as a reference. The old patient-app columns
// (plain-text password, OTP) come with the patient portal of step 11.
export const patients = pgTable(
  'hospital_patients',
  {
    id: uuid('id').primaryKey(),
    uhid: bigint('uhid', { mode: 'number' }).notNull(),
    title: text('title'),
    fullName: text('full_name').notNull(),
    sex: text('sex', { enum: SEXES }).notNull(),
    dateOfBirth: day('date_of_birth').notNull(),
    /** Worked out from an age typed at the counter. */
    birthEstimated: boolean('birth_estimated').notNull().default(false),
    bloodGroup: text('blood_group', { enum: BLOOD_GROUPS }),
    maritalStatus: text('marital_status', { enum: MARITAL_STATUSES }),
    religion: text('religion'),
    occupation: text('occupation'),
    fatherName: text('father_name'),
    motherName: text('mother_name'),
    spouseName: text('spouse_name'),
    /** Null when the patient has none (a newborn, an emergency); the contact's mobile is then required. */
    mobileNo: text('mobile_no'),
    email: text('email'),
    idType: text('id_type', { enum: ID_TYPES }),
    idNo: text('id_no'),
    careOf: text('care_of'),
    houseNo: text('house_no'),
    roadNo: text('road_no'),
    village: text('village'),
    postOffice: text('post_office'),
    area: text('area'),
    districtId: uuid('district_id').references(() => districts.id, { onDelete: 'restrict' }),
    /** The old "CP" columns: whom to call. */
    contactName: text('contact_name'),
    contactRelation: text('contact_relation'),
    contactMobileNo: text('contact_mobile_no'),
    contactAddress: text('contact_address'),
    specialAlert: text('special_alert'),
    confidential: boolean('confidential').notNull().default(false),
    registeredOn: day('registered_on').notNull(),
    registeredBy: uuid('registered_by').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    inactiveReason: text('inactive_reason'),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_patients_uhid_uq').on(t.uhid),
    index('hospital_patients_mobile_idx').on(t.mobileNo),
    index('hospital_patients_contact_mobile_idx').on(t.contactMobileNo),
    index('hospital_patients_name_idx').on(sql`lower(${t.fullName})`),
    index('hospital_patients_registered_idx').on(t.registeredOn),
    // One active record per ID document; a deactivated duplicate may keep it.
    uniqueIndex('hospital_patients_id_document_uq')
      .on(t.idType, t.idNo)
      .where(sql`${t.isActive} and ${t.idNo} is not null`),
    check('hospital_patients_uhid_ck', sql`${t.uhid} > 0`),
    check('hospital_patients_mobile_ck', sql`${t.mobileNo} is null or ${t.mobileNo} ~ '^01[3-9][0-9]{8}$'`),
    check('hospital_patients_phone_ck', sql`${t.mobileNo} is not null or ${t.contactMobileNo} is not null`),
    check('hospital_patients_name_ck', sql`char_length(${t.fullName}) between 1 and 150`),
    check('hospital_patients_id_ck', sql`(${t.idType} is null) = (${t.idNo} is null)`),
    check('hospital_patients_inactive_ck', sql`${t.isActive} or ${t.inactiveReason} is not null`),
  ],
);

// Old Hospital.MemberPictures (keyed by UHID, jpg only).
export const patientPhotos = pgTable(
  'hospital_patient_photos',
  {
    patientId: uuid('patient_id')
      .primaryKey()
      .references(() => patients.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('hospital_patient_photos_type_ck', sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp')`),
    check('hospital_patient_photos_size_ck', sql`octet_length(${t.data}) between 1 and 1048576`),
  ],
);
