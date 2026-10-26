import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  customType,
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
  type AnyPgColumn,
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
const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const VISIT_TYPES = ['first', 'new', 'follow_up', 'report'] as const;
const APPOINTMENT_STATUSES = ['booked', 'arrived', 'no_show', 'cancelled'] as const;
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

// Old Marketing.DoctorFieldOfSpecialities.
export const specialities = pgTable(
  'hospital_specialities',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_specialities_name_uq').on(sql`lower(${t.name})`),
    check('hospital_specialities_name_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Marketing.Doctors: consultants who see patients here and doctors who refer them (one table, as before). The
// old six free-text degree lines are one text; the old chamber and self-chamber fee pairs are one fee per visit type
// (the old page fell back from one to the other anyway). A doctor may be tied to a login (old Users.DoctorId).
export const doctors = pgTable(
  'hospital_doctors',
  {
    id: uuid('id').primaryKey(),
    code: text('code'),
    name: text('name').notNull(),
    degrees: text('degrees'),
    specialityId: uuid('speciality_id').references(() => specialities.id, { onDelete: 'restrict' }),
    phone: text('phone'),
    roomNo: text('room_no'),
    /** Sees patients in a chamber here (old IsChamberPractitioner); others only refer. */
    isConsultant: boolean('is_consultant').notNull().default(false),
    /** Old OPDChamberVisitFeeMaiden / New / Old and OPDChamberReportConsultancyFee. */
    firstVisitFee: money('first_visit_fee').notNull().default(0),
    newVisitFee: money('new_visit_fee').notNull().default(0),
    followUpFee: money('follow_up_fee').notNull().default(0),
    reportFee: money('report_fee').notNull().default(0),
    /** The doctor's share of their fees; null takes the OPD policy's default. */
    sharePercent: percent('share_percent'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_doctors_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('hospital_doctors_user_uq').on(t.userId),
    index('hospital_doctors_name_idx').on(sql`lower(${t.name})`),
    check('hospital_doctors_share_ck', sql`${t.sharePercent} is null or ${t.sharePercent} between 0 and 100`),
    check('hospital_doctors_name_ck', sql`char_length(${t.name}) between 1 and 150`),
    check(
      'hospital_doctors_fees_ck',
      sql`${t.firstVisitFee} >= 0 and ${t.newVisitFee} >= 0 and ${t.followUpFee} >= 0 and ${t.reportFee} >= 0`,
    ),
  ],
);

// Old OPD.DoctorChamberSchedules (and the single weekly ChamberPractionerSettings before it): one sitting per doctor
// and weekday — the first patient's time, minutes per patient and how many are seen.
export const doctorSchedules = pgTable(
  'hospital_doctor_schedules',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    /** 0 = Sunday … 6 = Saturday. */
    dayOfWeek: smallint('day_of_week').notNull(),
    startTime: text('start_time').notNull(),
    slotMinutes: smallint('slot_minutes').notNull(),
    maxPatients: smallint('max_patients').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_doctor_schedules_day_uq').on(t.doctorId, t.dayOfWeek),
    check('hospital_doctor_schedules_day_ck', sql`${t.dayOfWeek} between 0 and 6`),
    check('hospital_doctor_schedules_time_ck', sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check('hospital_doctor_schedules_slot_ck', sql`${t.slotMinutes} between 1 and 240`),
    check('hospital_doctor_schedules_max_ck', sql`${t.maxPatients} between 1 and 500`),
  ],
);

// Old ChamberPractionerRoutines (IsChamberOpen = false) and the schedule's IsClosed / ClosedReason: days a doctor
// does not sit.
export const doctorClosures = pgTable(
  'hospital_doctor_closures',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    closedOn: day('closed_on').notNull(),
    reason: text('reason'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('hospital_doctor_closures_day_uq').on(t.doctorId, t.closedOn)],
);

// Old OPD.DoctorAppointments: a serial with a doctor on a day. A patient not registered yet is booked by name and
// mobile (the old UHID 0) and attached when registered. The old status strings Booked → Invoiced → Vital →
// Prescribed become booked → arrived (billing and the Rx steps keep their own records).
export const appointments = pgTable(
  'hospital_appointments',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    appointmentDate: day('appointment_date').notNull(),
    serial: smallint('serial').notNull(),
    slotTime: text('slot_time').notNull(),
    visitType: text('visit_type', { enum: VISIT_TYPES }).notNull(),
    patientId: uuid('patient_id').references(() => patients.id, { onDelete: 'restrict' }),
    patientName: text('patient_name').notNull(),
    mobileNo: text('mobile_no').notNull(),
    referredById: uuid('referred_by_id').references(() => doctors.id, { onDelete: 'restrict' }),
    /** The doctor's fee for the visit type when booked (what the counter quotes). */
    fee: money('fee').notNull(),
    status: text('status', { enum: APPOINTMENT_STATUSES }).notNull(),
    statusReason: text('status_reason'),
    /** The consultation bill it was billed on (once). */
    billId: uuid('bill_id').references((): AnyPgColumn => opdBills.id, { onDelete: 'restrict' }),
    remarks: text('remarks'),
    bookedBy: uuid('booked_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One booking per serial; a cancelled booking frees its serial.
    uniqueIndex('hospital_appointments_serial_uq')
      .on(t.doctorId, t.appointmentDate, t.serial)
      .where(sql`${t.status} <> 'cancelled'`),
    index('hospital_appointments_date_idx').on(t.appointmentDate),
    index('hospital_appointments_patient_idx').on(t.patientId),
    check('hospital_appointments_serial_ck', sql`${t.serial} between 1 and 500`),
    check('hospital_appointments_mobile_ck', sql`${t.mobileNo} ~ '^01[3-9][0-9]{8}$'`),
    check('hospital_appointments_fee_ck', sql`${t.fee} >= 0`),
  ],
);

// OPD rules in one row (the old page had none: the visit type was picked by hand, the doctor's share was 40 % in the
// code and any discount was allowed).
export const opdPolicy = pgTable(
  'hospital_opd_policy',
  {
    id: smallint('id').primaryKey(),
    /** A visit to the same doctor within these days is a follow-up. */
    followUpDays: smallint('follow_up_days').notNull(),
    /** The doctor's share of a fee when the doctor has none of their own. */
    defaultSharePercent: percent('default_share_percent').notNull(),
    /** The discount a counter may give without opd:discount, as a share of the bill. */
    counterDiscountPercent: percent('counter_discount_percent').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('hospital_opd_policy_single_ck', sql`${t.id} = 1`),
    check('hospital_opd_policy_days_ck', sql`${t.followUpDays} between 0 and 365`),
    check(
      'hospital_opd_policy_percent_ck',
      sql`${t.defaultSharePercent} between 0 and 100 and ${t.counterDiscountPercent} between 0 and 100`,
    ),
  ],
);

// Old OPD.PatientRecordConsultancyFees (header) and ConsultancyDetails (lines): a consultation bill of a registered
// patient, one line per doctor seen, with the doctor's share worked out on each line.
export const opdBills = pgTable(
  'hospital_opd_bills',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    appointmentId: uuid('appointment_id').references((): AnyPgColumn => appointments.id, { onDelete: 'restrict' }),
    billedOn: day('billed_on').notNull(),
    referredById: uuid('referred_by_id').references(() => doctors.id, { onDelete: 'restrict' }),
    gross: money('gross').notNull(),
    discount: money('discount').notNull(),
    discountReason: text('discount_reason'),
    net: money('net').notNull(),
    /** Paid at billing. */
    paid: money('paid').notNull(),
    /** Collected later against the due. */
    collected: money('collected').notNull().default(0),
    status: text('status', { enum: ['billed', 'cancelled'] }).notNull(),
    cancelReason: text('cancel_reason'),
    cancelledOn: day('cancelled_on'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    refunded: money('refunded').notNull().default(0),
    voucherNumber: text('voucher_number'),
    cancelVoucherNumber: text('cancel_voucher_number'),
    billedBy: uuid('billed_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_opd_bills_number_uq').on(t.number),
    uniqueIndex('hospital_opd_bills_appointment_uq').on(t.appointmentId),
    index('hospital_opd_bills_patient_idx').on(t.patientId),
    index('hospital_opd_bills_billed_idx').on(t.billedOn),
    check(
      'hospital_opd_bills_amounts_ck',
      sql`${t.discount} >= 0 and ${t.discount} <= ${t.gross} and ${t.net} = ${t.gross} - ${t.discount} and ${t.paid} >= 0 and ${t.collected} >= 0 and ${t.paid} + ${t.collected} <= ${t.net}`,
    ),
  ],
);

export const opdBillLines = pgTable(
  'hospital_opd_bill_lines',
  {
    billId: uuid('bill_id')
      .notNull()
      .references(() => opdBills.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    visitType: text('visit_type', { enum: VISIT_TYPES }).notNull(),
    fee: money('fee').notNull(),
    sharePercent: percent('share_percent').notNull(),
    shareAmount: money('share_amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.position] }),
    index('hospital_opd_bill_lines_doctor_idx').on(t.doctorId),
    check(
      'hospital_opd_bill_lines_amounts_ck',
      sql`${t.fee} >= 0 and ${t.shareAmount} >= 0 and ${t.shareAmount} <= ${t.fee}`,
    ),
  ],
);

// Old OPDConsultancyLedger payment rows (Payment, DueCollection, Refund): money in and out of a bill, by method.
export const opdPayments = pgTable(
  'hospital_opd_payments',
  {
    id: uuid('id').primaryKey(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => opdBills.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['payment', 'collection', 'refund'] }).notNull(),
    /** Receipt number of a collection. */
    number: text('number'),
    method: text('method', { enum: ['cash', 'card', 'mobile'] }).notNull(),
    reference: text('reference'),
    amount: money('amount').notNull(),
    paidOn: day('paid_on').notNull(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('hospital_opd_payments_bill_idx').on(t.billId),
    index('hospital_opd_payments_paid_idx').on(t.paidOn),
    check('hospital_opd_payments_amount_ck', sql`${t.amount} > 0`),
  ],
);

// Old Account.ConsultantGlobalLedgers for OPD (written against the bill line id instead of the doctor, at a hard-coded
// 40 %, and never reversed): each doctor's share as it is earned and taken back.
export const doctorLedger = pgTable(
  'hospital_doctor_ledger',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    entryOn: day('entry_on').notNull(),
    kind: text('kind', { enum: ['share', 'reversal'] }).notNull(),
    billId: uuid('bill_id').references(() => opdBills.id, { onDelete: 'restrict' }),
    documentNumber: text('document_number').notNull(),
    /** Earned (+) or taken back (−). */
    amount: money('amount').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('hospital_doctor_ledger_doctor_idx').on(t.doctorId, t.entryOn)],
);

// Old Admin.UHIDUsesRecords: each time a UHID is used by a service (the visit log behind the UHID dashboard).
export const uhidUses = pgTable(
  'hospital_uhid_uses',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    usedOn: day('used_on').notNull(),
    service: text('service').notNull(),
    documentNumber: text('document_number').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('hospital_uhid_uses_patient_idx').on(t.patientId, t.usedOn)],
);
