import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { admissions, diagnosticBills, patients } from '../../../hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
// The same lists as the domain's (kept literal here so drizzle-kit loads this file on its own).
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;
const SCREENS = ['negative', 'positive'] as const;
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Document numbers of the blood bank: one counter per kind and year.
export const bloodSequences = pgTable(
  'blood_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old TransfusionMedicine.BloodComponents: what a donation is split into, how long it keeps and what a unit costs a
// patient.
export const componentTypes = pgTable(
  'blood_component_types',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    /** Days a unit keeps from the day of donation. */
    shelfDays: smallint('shelf_days').notNull(),
    /** Which groups may receive it: by red cells (whole blood, packed cells), by plasma, or any. */
    compatibility: text('compatibility', { enum: ['red_cells', 'plasma', 'any'] }).notNull(),
    /** What a unit is charged to an admitted patient's stay. */
    rate: money('rate').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('blood_component_types_name_uq').on(sql`lower(${t.name})`),
    uniqueIndex('blood_component_types_code_uq').on(sql`upper(${t.code})`),
    check('blood_component_types_ck', sql`${t.shelfDays} between 1 and 3650 and ${t.rate} >= 0`),
  ],
);

// Old TransfusionMedicine.BloodDonors: who gives blood, their group and when they may give again.
export const donors = pgTable(
  'blood_donors',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    fullName: text('full_name').notNull(),
    sex: text('sex', { enum: ['male', 'female', 'other'] }).notNull(),
    dateOfBirth: day('date_of_birth').notNull(),
    bloodGroup: text('blood_group', { enum: BLOOD_GROUPS }).notNull(),
    mobileNo: text('mobile_no'),
    address: text('address'),
    lastDonatedOn: day('last_donated_on'),
    /** Not to give before this day (after a donation, or for good after a positive screen). */
    deferredUntil: day('deferred_until'),
    deferReason: text('defer_reason'),
    isActive: boolean('is_active').notNull().default(true),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('blood_donors_number_uq').on(t.number),
    index('blood_donors_name_idx').on(sql`lower(${t.fullName})`),
    index('blood_donors_mobile_idx').on(t.mobileNo),
  ],
);

// Old DonorContributionRecords, screened as in old SerologyRecords/Results: one bag given, screened, and split into units.
export const donations = pgTable(
  'blood_donations',
  {
    id: uuid('id').primaryKey(),
    bagNumber: text('bag_number').notNull(),
    donorId: uuid('donor_id')
      .notNull()
      .references(() => donors.id, { onDelete: 'restrict' }),
    donatedOn: day('donated_on').notNull(),
    donatedAt: tz('donated_at').notNull(),
    bloodGroup: text('blood_group', { enum: BLOOD_GROUPS }).notNull(),
    volumeMl: smallint('volume_ml').notNull(),
    status: text('status', { enum: ['collected', 'screened', 'discarded'] }).notNull(),
    hiv: text('hiv', { enum: SCREENS }),
    hbsag: text('hbsag', { enum: SCREENS }),
    hcv: text('hcv', { enum: SCREENS }),
    syphilis: text('syphilis', { enum: SCREENS }),
    malaria: text('malaria', { enum: SCREENS }),
    screenedBy: uuid('screened_by').references(() => users.id, { onDelete: 'set null' }),
    screenedAt: tz('screened_at'),
    discardReason: text('discard_reason'),
    collectedBy: uuid('collected_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('blood_donations_bag_uq').on(t.bagNumber),
    index('blood_donations_donor_idx').on(t.donorId),
    check('blood_donations_volume_ck', sql`${t.volumeMl} between 50 and 600`),
  ],
);

// New (the old system kept bags, not units): a unit of one component of a donation, until it is given to a patient, thrown away or
// out of date.
export const bloodUnits = pgTable(
  'blood_units',
  {
    id: uuid('id').primaryKey(),
    unitNumber: text('unit_number').notNull(),
    donationId: uuid('donation_id')
      .notNull()
      .references(() => donations.id, { onDelete: 'restrict' }),
    componentTypeId: uuid('component_type_id')
      .notNull()
      .references(() => componentTypes.id, { onDelete: 'restrict' }),
    bloodGroup: text('blood_group', { enum: BLOOD_GROUPS }).notNull(),
    preparedOn: day('prepared_on').notNull(),
    expiresOn: day('expires_on').notNull(),
    status: text('status', { enum: ['quarantine', 'available', 'reserved', 'issued', 'discarded'] }).notNull(),
    /** The request it is cross-matched and kept for. */
    requestId: uuid('request_id'),
    discardReason: text('discard_reason'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('blood_units_number_uq').on(t.unitNumber),
    uniqueIndex('blood_units_component_uq').on(t.donationId, t.componentTypeId),
    index('blood_units_stock_idx').on(t.status, t.bloodGroup, t.componentTypeId),
  ],
);

// Old CrossMatchingRecords' request side: a patient's need of units of a component, for a stay (charged to it) or on
// a diagnostic bill (paid there).
export const bloodRequests = pgTable(
  'blood_requests',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id').references(() => diagnosticBills.id, { onDelete: 'restrict' }),
    componentTypeId: uuid('component_type_id')
      .notNull()
      .references(() => componentTypes.id, { onDelete: 'restrict' }),
    units: smallint('units').notNull(),
    bloodGroup: text('blood_group', { enum: BLOOD_GROUPS }).notNull(),
    reason: text('reason'),
    requestedOn: day('requested_on').notNull(),
    status: text('status', { enum: ['open', 'fulfilled', 'cancelled'] }).notNull(),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('blood_requests_number_uq').on(t.number),
    index('blood_requests_patient_idx').on(t.patientId),
    check('blood_requests_units_ck', sql`${t.units} between 1 and 20`),
    check('blood_requests_payer_ck', sql`(${t.admissionId} is null) <> (${t.billId} is null)`),
  ],
);

// Old CrossMatchingRecords / Results / Values: a unit tried against the patient's sample.
export const crossmatches = pgTable(
  'blood_crossmatches',
  {
    id: uuid('id').primaryKey(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => bloodRequests.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => bloodUnits.id, { onDelete: 'restrict' }),
    result: text('result', { enum: ['compatible', 'incompatible'] }).notNull(),
    method: text('method'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    doneAt: tz('done_at').notNull(),
  },
  (t) => [index('blood_crossmatches_request_idx').on(t.requestId)],
);

// A unit given to a patient: charged to the stay when admitted (its voucher), paid on the diagnostic bill otherwise.
export const bloodIssues = pgTable(
  'blood_issues',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => bloodRequests.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id')
      .notNull()
      .references(() => bloodUnits.id, { onDelete: 'restrict' }),
    admissionId: uuid('admission_id').references(() => admissions.id, { onDelete: 'restrict' }),
    issuedOn: day('issued_on').notNull(),
    issuedAt: tz('issued_at').notNull(),
    /** Charged to the stay (0 on a diagnostic bill). */
    amount: money('amount').notNull(),
    voucherNumber: text('voucher_number'),
    issuedBy: uuid('issued_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('blood_issues_number_uq').on(t.number),
    uniqueIndex('blood_issues_unit_uq').on(t.unitId),
    index('blood_issues_admission_idx').on(t.admissionId),
  ],
);
