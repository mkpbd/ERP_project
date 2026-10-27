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
import { staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
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
    /** The company the patient's bills go to by default (old RegRecord.CompanyId). */
    corporateClientId: uuid('corporate_client_id').references((): AnyPgColumn => corporateClients.id, {
      onDelete: 'restrict',
    }),
    registeredOn: day('registered_on').notNull(),
    registeredBy: uuid('registered_by').references(() => users.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    inactiveReason: text('inactive_reason'),
    /** The record this duplicate was merged into (its bills, admissions and visits moved there). */
    mergedIntoId: uuid('merged_into_id').references((): AnyPgColumn => patients.id, { onDelete: 'restrict' }),
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
    /** The doctor's commission on tests they refer; null takes the test's (else the diagnostic policy's). */
    referralPercent: percent('referral_percent'),
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

// Old OPD.PatientRecordConsultancyFees / ConsultancyDetails (consultations) and PatientRecordOPDServices /
// ServiceDetails (OPD and emergency services): a bill of a registered patient, one line per doctor seen or service
// given, with the doctor's share worked out on each line. The due is the patient's, a corporate client's (old: the
// client's name in a ledger description only) or a staff member's (old EmployeeId with UHID 0).
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
    corporateClientId: uuid('corporate_client_id').references((): AnyPgColumn => corporateClients.id, {
      onDelete: 'restrict',
    }),
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
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
    index('hospital_opd_bills_corporate_idx').on(t.corporateClientId),
    index('hospital_opd_bills_staff_idx').on(t.staffId),
    check('hospital_opd_bills_payer_ck', sql`${t.corporateClientId} is null or ${t.staffId} is null`),
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
    /** A consultation's doctor, or the doctor who gave a service (old ServiceByDoctorId). */
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'restrict' }),
    /** Set on a consultation. */
    visitType: text('visit_type', { enum: VISIT_TYPES }),
    /** Set on a service. */
    serviceId: uuid('service_id').references((): AnyPgColumn => services.id, { onDelete: 'restrict' }),
    qty: smallint('qty').notNull().default(1),
    rate: money('rate').notNull(),
    /** qty × rate. */
    fee: money('fee').notNull(),
    sharePercent: percent('share_percent').notNull(),
    shareAmount: money('share_amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.position] }),
    index('hospital_opd_bill_lines_doctor_idx').on(t.doctorId),
    index('hospital_opd_bill_lines_service_idx').on(t.serviceId),
    check(
      'hospital_opd_bill_lines_kind_ck',
      sql`(${t.serviceId} is null and ${t.visitType} is not null and ${t.doctorId} is not null) or (${t.serviceId} is not null and ${t.visitType} is null)`,
    ),
    check(
      'hospital_opd_bill_lines_amounts_ck',
      sql`${t.qty} between 1 and 1000 and ${t.rate} >= 0 and ${t.fee} = round(${t.qty} * ${t.rate}, 2) and ${t.shareAmount} >= 0 and ${t.shareAmount} <= ${t.fee}`,
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
// 40 %, and never reversed) and the indoor doctor payments worked out in SPGetDoctorPayment: each doctor's share as
// it is earned and taken back, on an OPD bill or a final indoor bill.
export const doctorLedger = pgTable(
  'hospital_doctor_ledger',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    entryOn: day('entry_on').notNull(),
    kind: text('kind', { enum: ['share', 'reversal', 'payment'] }).notNull(),
    billId: uuid('bill_id').references(() => opdBills.id, { onDelete: 'restrict' }),
    ipdBillId: uuid('ipd_bill_id').references((): AnyPgColumn => ipdBills.id, { onDelete: 'restrict' }),
    diagnosticBillId: uuid('diagnostic_bill_id').references((): AnyPgColumn => diagnosticBills.id, {
      onDelete: 'restrict',
    }),
    documentNumber: text('document_number').notNull(),
    /** Earned (+) or taken back (−). */
    amount: money('amount').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('hospital_doctor_ledger_doctor_idx').on(t.doctorId, t.entryOn)],
);

// Old Hospital.SaveConsultancyPaymentRecords (InvoiceNo, ConsultantId, PayDate, Amount, DateFrom, DateTo, with a detail
// row per service paid; no page left in the web app, and never posted): what a doctor is paid of their shares.
export const doctorPayments = pgTable(
  'hospital_doctor_payments',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    paidOn: day('paid_on').notNull(),
    amount: money('amount').notNull(),
    method: text('method', { enum: ['cash', 'card', 'mobile'] }).notNull(),
    reference: text('reference'),
    note: text('note'),
    voucherNumber: text('voucher_number'),
    paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_doctor_payments_number_uq').on(t.number),
    index('hospital_doctor_payments_doctor_idx').on(t.doctorId, t.paidOn),
    check('hospital_doctor_payments_amount_ck', sql`${t.amount} > 0`),
  ],
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

// Old Hospital.ServiceGroups / ServiceSubGroups / ServiceSubSubGroups, as one tree.
export const serviceGroups = pgTable(
  'hospital_service_groups',
  {
    id: uuid('id').primaryKey(),
    parentId: uuid('parent_id').references((): AnyPgColumn => serviceGroups.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_service_groups_name_uq').on(sql`coalesce(${t.parentId}::text, '')`, sql`lower(${t.name})`),
    check('hospital_service_groups_name_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Hospital.ServiceExecutingHeads with their ServiceExecutingHeadRates row (one rate, stored as a float there):
// a service billed at the OPD (dressing, injection, nebulisation, ECG, a procedure) and, later, on the ward.
export const services = pgTable(
  'hospital_services',
  {
    id: uuid('id').primaryKey(),
    code: text('code'),
    name: text('name').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => serviceGroups.id, { onDelete: 'restrict' }),
    rate: money('rate').notNull(),
    /** The share of the doctor who gives the service (old: 40 % in the code); null = no doctor's share. */
    sharePercent: percent('share_percent'),
    isOpd: boolean('is_opd').notNull().default(true),
    isIpd: boolean('is_ipd').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_services_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('hospital_services_name_uq').on(t.groupId, sql`lower(${t.name})`),
    check('hospital_services_name_ck', sql`char_length(${t.name}) between 1 and 150`),
    check('hospital_services_rate_ck', sql`${t.rate} >= 0`),
    check('hospital_services_share_ck', sql`${t.sharePercent} is null or ${t.sharePercent} between 0 and 100`),
  ],
);

// Old Marketing.CorporateClients (IsCash / IsCredit, no limit): companies whose people are billed to them. A cash
// client pays at the counter; a credit client's bills are due from the company, up to its credit limit if it has one.
export const corporateClients = pgTable(
  'hospital_corporate_clients',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    contactPerson: text('contact_person'),
    contactNo: text('contact_no'),
    address: text('address'),
    payment: text('payment', { enum: ['cash', 'credit'] }).notNull(),
    creditLimit: money('credit_limit'),
    /** Taken off its people's bills. */
    discountPercent: percent('discount_percent').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_corporate_clients_name_uq').on(sql`lower(${t.name})`),
    check('hospital_corporate_clients_name_ck', sql`char_length(${t.name}) between 1 and 150`),
    check('hospital_corporate_clients_limit_ck', sql`${t.creditLimit} is null or ${t.creditLimit} >= 0`),
    check('hospital_corporate_clients_discount_ck', sql`${t.discountPercent} between 0 and 100`),
  ],
);

// Old Floors + HDepartments as places (the old system had no ward entity: a ward was floor, department and cabin
// type together).
export const wards = pgTable(
  'hospital_wards',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    floor: text('floor'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_wards_name_uq').on(sql`lower(${t.name})`),
    check('hospital_wards_name_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Hospital.CabinTypes (general ward, cabin, ICU, HDU, CCU, NICU …): the admission fee and the usual daily rate.
export const bedCategories = pgTable(
  'hospital_bed_categories',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    admissionFee: money('admission_fee').notNull().default(0),
    dailyRate: money('daily_rate').notNull().default(0),
    /** ICU, HDU, CCU, NICU …: a day moved out of one is charged at the bed moved to (step 9f). */
    isIntensive: boolean('is_intensive').notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_bed_categories_name_uq').on(sql`lower(${t.name})`),
    check('hospital_bed_categories_name_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('hospital_bed_categories_amounts_ck', sql`${t.admissionFee} >= 0 and ${t.dailyRate} >= 0`),
  ],
);

// Old Hospital.Cabins (Status 1 free, 2 occupied, 3 housekeeping — never set): one bed or cabin.
export const beds = pgTable(
  'hospital_beds',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    wardId: uuid('ward_id')
      .notNull()
      .references(() => wards.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => bedCategories.id, { onDelete: 'restrict' }),
    /** The bed's own daily rate (old Cabin.Rent); null takes the category's. */
    dailyRate: money('daily_rate'),
    /** Set by admissions, transfers and discharges; out of order and ready again by hand. */
    status: text('status', { enum: ['available', 'occupied', 'housekeeping', 'out_of_order'] })
      .notNull()
      .default('available'),
    displayOrder: smallint('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_beds_code_uq').on(sql`upper(${t.code})`),
    index('hospital_beds_ward_idx').on(t.wardId),
    check('hospital_beds_code_ck', sql`char_length(${t.code}) between 1 and 20`),
    check('hospital_beds_rate_ck', sql`${t.dailyRate} is null or ${t.dailyRate} >= 0`),
  ],
);

// Old Hospital.IPDPatientRecords: a stay in the hospital, from admission to discharge. The old record had no reason,
// no discharge type and no guard against a second admission of the same patient.
export const admissions = pgTable(
  'hospital_admissions',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    admittedAt: tz('admitted_at').notNull(),
    kind: text('kind', { enum: ['emergency', 'elective'] }).notNull(),
    reason: text('reason'),
    referredById: uuid('referred_by_id').references(() => doctors.id, { onDelete: 'restrict' }),
    corporateClientId: uuid('corporate_client_id').references(() => corporateClients.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
    /** The bed category's admission fee when admitted (billed in step 9f). */
    admissionFee: money('admission_fee').notNull(),
    status: text('status', { enum: ['admitted', 'discharged', 'cancelled'] }).notNull(),
    dischargedAt: tz('discharged_at'),
    dischargeType: text('discharge_type', { enum: ['normal', 'lama', 'referred', 'absconded', 'death'] }),
    dischargeNote: text('discharge_note'),
    cancelReason: text('cancel_reason'),
    admittedBy: uuid('admitted_by').references(() => users.id, { onDelete: 'set null' }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_admissions_number_uq').on(t.number),
    // One stay at a time per patient.
    uniqueIndex('hospital_admissions_active_uq')
      .on(t.patientId)
      .where(sql`${t.status} = 'admitted'`),
    index('hospital_admissions_admitted_idx').on(t.admittedAt),
    check('hospital_admissions_payer_ck', sql`${t.corporateClientId} is null or ${t.staffId} is null`),
    check(
      'hospital_admissions_discharge_ck',
      sql`(${t.status} = 'discharged') = (${t.dischargedAt} is not null and ${t.dischargeType} is not null)`,
    ),
  ],
);

// Old Hospital.IPDCabinAllocationRecords (PAB / RAT / RAD / EC rows): each bed an admission had, from when to when,
// at the rate of the time.
export const bedStays = pgTable(
  'hospital_bed_stays',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'cascade' }),
    bedId: uuid('bed_id')
      .notNull()
      .references(() => beds.id, { onDelete: 'restrict' }),
    fromAt: tz('from_at').notNull(),
    toAt: tz('to_at'),
    dailyRate: money('daily_rate').notNull(),
    reason: text('reason'),
    movedBy: uuid('moved_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    // A bed has one patient, a patient one bed.
    uniqueIndex('hospital_bed_stays_bed_uq')
      .on(t.bedId)
      .where(sql`${t.toAt} is null`),
    uniqueIndex('hospital_bed_stays_admission_uq')
      .on(t.admissionId)
      .where(sql`${t.toAt} is null`),
    index('hospital_bed_stays_admission_idx').on(t.admissionId),
    check('hospital_bed_stays_period_ck', sql`${t.toAt} is null or ${t.toAt} >= ${t.fromAt}`),
  ],
);

// Old AssignedDoctorId / AdditionalDoctorIds (a CSV) and AssignedDoctorRecords: who looks after the patient, and when.
export const admissionDoctors = pgTable(
  'hospital_admission_doctors',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'cascade' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    role: text('role', { enum: ['primary', 'additional'] }).notNull(),
    fromAt: tz('from_at').notNull(),
    toAt: tz('to_at'),
  },
  (t) => [
    uniqueIndex('hospital_admission_doctors_primary_uq')
      .on(t.admissionId)
      .where(sql`${t.role} = 'primary' and ${t.toAt} is null`),
    uniqueIndex('hospital_admission_doctors_current_uq')
      .on(t.admissionId, t.doctorId)
      .where(sql`${t.toAt} is null`),
    index('hospital_admission_doctors_doctor_idx').on(t.doctorId),
  ],
);

// Indoor billing rules in one row (the old system had the round fee as 330 in the code and the service charge in the
// app settings, and no discount limit).
export const ipdPolicy = pgTable(
  'hospital_ipd_policy',
  {
    id: smallint('id').primaryKey(),
    /** Old Round Fee (NursingCare head): charged for every bed night. */
    roundFeePerNight: money('round_fee_per_night').notNull(),
    /** Old IPDServiceCharge: on the admission fee, bed nights and round fee. */
    serviceChargePercent: percent('service_charge_percent').notNull(),
    /** The discount a counter may give on a final bill without ipd:discount, as a share of the bill. */
    counterDiscountPercent: percent('counter_discount_percent').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('hospital_ipd_policy_single_ck', sql`${t.id} = 1`),
    check(
      'hospital_ipd_policy_amounts_ck',
      sql`${t.roundFeePerNight} >= 0 and ${t.serviceChargePercent} between 0 and 100 and ${t.counterDiscountPercent} between 0 and 100`,
    ),
  ],
);

// Old Hospital.IPDServiceRecords and IPDConsultantServices (a consultant visit was a service head with the doctor
// picked beside it): what is given to an admitted patient during the stay, at the service's rate of the day.
export const ipdCharges = pgTable(
  'hospital_ipd_charges',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'restrict' }),
    /** The doctor who gave it (a consultant's visit, a procedure); needed when it carries a share. */
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'restrict' }),
    chargedOn: day('charged_on').notNull(),
    qty: smallint('qty').notNull(),
    rate: money('rate').notNull(),
    amount: money('amount').notNull(),
    sharePercent: percent('share_percent').notNull(),
    note: text('note'),
    status: text('status', { enum: ['active', 'cancelled'] }).notNull(),
    cancelReason: text('cancel_reason'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: tz('cancelled_at'),
    chargedBy: uuid('charged_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('hospital_ipd_charges_admission_idx').on(t.admissionId),
    index('hospital_ipd_charges_doctor_idx').on(t.doctorId),
    check(
      'hospital_ipd_charges_amounts_ck',
      sql`${t.qty} between 1 and 1000 and ${t.rate} >= 0 and ${t.amount} = round(${t.qty} * ${t.rate}, 2) and ${t.sharePercent} between 0 and 100`,
    ),
  ],
);

// Old Hospital.FinalBills, FinalBillSummarys (one row per head) and FinalBillLedgers: the bill made at discharge,
// with every line it was made of. One bill in force per admission; a cancelled one stays for the record.
export const ipdBills = pgTable(
  'hospital_ipd_bills',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    billedOn: day('billed_on').notNull(),
    corporateClientId: uuid('corporate_client_id').references(() => corporateClients.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
    nights: smallint('nights').notNull(),
    gross: money('gross').notNull(),
    serviceCharge: money('service_charge').notNull(),
    discount: money('discount').notNull(),
    discountReason: text('discount_reason'),
    net: money('net').notNull(),
    /** The advance held, taken against the bill. */
    deposit: money('deposit').notNull(),
    /** Paid when the bill was made. */
    paid: money('paid').notNull(),
    /** Collected later against the due. */
    collected: money('collected').notNull().default(0),
    status: text('status', { enum: ['billed', 'cancelled'] }).notNull(),
    cancelReason: text('cancel_reason'),
    cancelledOn: day('cancelled_on'),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    cancelVoucherNumber: text('cancel_voucher_number'),
    billedBy: uuid('billed_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_ipd_bills_number_uq').on(t.number),
    uniqueIndex('hospital_ipd_bills_admission_uq')
      .on(t.admissionId)
      .where(sql`${t.status} = 'billed'`),
    index('hospital_ipd_bills_patient_idx').on(t.patientId),
    index('hospital_ipd_bills_billed_idx').on(t.billedOn),
    index('hospital_ipd_bills_corporate_idx').on(t.corporateClientId),
    check('hospital_ipd_bills_payer_ck', sql`${t.corporateClientId} is null or ${t.staffId} is null`),
    check(
      'hospital_ipd_bills_amounts_ck',
      sql`${t.discount} >= 0 and ${t.discount} <= ${t.gross} + ${t.serviceCharge} and ${t.net} = ${t.gross} + ${t.serviceCharge} - ${t.discount} and ${t.deposit} >= 0 and ${t.paid} >= 0 and ${t.collected} >= 0 and ${t.deposit} + ${t.paid} + ${t.collected} <= ${t.net}`,
    ),
  ],
);

export const ipdBillLines = pgTable(
  'hospital_ipd_bill_lines',
  {
    billId: uuid('bill_id')
      .notNull()
      .references(() => ipdBills.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    head: text('head', { enum: ['admission', 'bed', 'round', 'service', 'medicine', 'investigation'] }).notNull(),
    description: text('description').notNull(),
    bedId: uuid('bed_id').references(() => beds.id, { onDelete: 'restrict' }),
    chargeId: uuid('charge_id').references(() => ipdCharges.id, { onDelete: 'restrict' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'restrict' }),
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'restrict' }),
    fromOn: day('from_on'),
    toOn: day('to_on'),
    qty: smallint('qty').notNull(),
    rate: money('rate').notNull(),
    amount: money('amount').notNull(),
    serviceCharge: money('service_charge').notNull(),
    shareAmount: money('share_amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.position] }),
    index('hospital_ipd_bill_lines_doctor_idx').on(t.doctorId),
    check(
      'hospital_ipd_bill_lines_amounts_ck',
      sql`${t.qty} >= 0 and ${t.rate} >= 0 and ${t.amount} >= 0 and ${t.serviceCharge} >= 0 and ${t.shareAmount} >= 0 and ${t.shareAmount} <= ${t.amount}`,
    ),
  ],
);

// Old Hospital.AdvancePayments (Payment / Refund rows keyed by GUID, no receipt number) and the FinalBillLedgers
// payment and due collection rows: money in and out of an admission's account, each with its receipt number.
export const ipdPayments = pgTable(
  'hospital_ipd_payments',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    /** The bill a payment or collection was made against. */
    billId: uuid('bill_id').references(() => ipdBills.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['advance', 'refund', 'payment', 'collection'] }).notNull(),
    number: text('number').notNull(),
    method: text('method', { enum: ['cash', 'card', 'mobile'] }).notNull(),
    reference: text('reference'),
    amount: money('amount').notNull(),
    paidOn: day('paid_on').notNull(),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_ipd_payments_number_uq').on(t.number),
    index('hospital_ipd_payments_admission_idx').on(t.admissionId),
    index('hospital_ipd_payments_paid_idx').on(t.paidOn),
    check('hospital_ipd_payments_amount_ck', sql`${t.amount} > 0`),
  ],
);

// Old Diag.ParentGroup (Pathology, Radiology …) as the department a test is done in.
export const diagnosticDepartments = pgTable(
  'hospital_diagnostic_departments',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['lab', 'imaging', 'other'] }).notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_diagnostic_departments_name_uq').on(sql`lower(${t.name})`),
    check('hospital_diagnostic_departments_name_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Diag.TestItems (one rate for OPD and indoor; IsDiscountAllow; report day and hours): a test sold at the counter.
export const diagnosticTests = pgTable(
  'hospital_diagnostic_tests',
  {
    id: uuid('id').primaryKey(),
    code: text('code'),
    name: text('name').notNull(),
    shortName: text('short_name'),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => diagnosticDepartments.id, { onDelete: 'restrict' }),
    /** Blood, urine, swab … (old Specimen). */
    specimen: text('specimen'),
    /** Where the patient goes for it (old TestGroups.MovementRoomNo). */
    roomNo: text('room_no'),
    rate: money('rate').notNull(),
    /** Hours from billing to the report (old DayNeededForReportDelivery and DeliveryTimeOnReportDay); null: none. */
    reportHours: smallint('report_hours'),
    /** Old IsDiscountAllow: tubes and government-rate tests are never discounted. */
    discountAllowed: boolean('discount_allowed').notNull().default(true),
    /** The referring doctor's commission; null takes the diagnostic policy's. */
    referralPercent: percent('referral_percent'),
    /** The reporting doctor's fee (old TestWiseReportingFees): a share of the rate, or an amount when set. */
    reportingFeePercent: percent('reporting_fee_percent'),
    reportingFeeAmount: money('reporting_fee_amount'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check(
      'hospital_diagnostic_tests_reporting_ck',
      sql`(${t.reportingFeePercent} is null or ${t.reportingFeePercent} between 0 and 100) and (${t.reportingFeeAmount} is null or ${t.reportingFeeAmount} >= 0)`,
    ),
    uniqueIndex('hospital_diagnostic_tests_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('hospital_diagnostic_tests_name_uq').on(t.departmentId, sql`lower(${t.name})`),
    check('hospital_diagnostic_tests_name_ck', sql`char_length(${t.name}) between 1 and 150`),
    check('hospital_diagnostic_tests_rate_ck', sql`${t.rate} >= 0`),
    check('hospital_diagnostic_tests_hours_ck', sql`${t.reportHours} is null or ${t.reportHours} between 0 and 2000`),
    check(
      'hospital_diagnostic_tests_referral_ck',
      sql`${t.referralPercent} is null or ${t.referralPercent} between 0 and 100`,
    ),
  ],
);

// Old Diag.OPDPackages / OPDPackageTestItems (PackageRage = the rate inside the package): tests sold together.
export const diagnosticPackages = pgTable(
  'hospital_diagnostic_packages',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_diagnostic_packages_name_uq').on(sql`lower(${t.name})`),
    check('hospital_diagnostic_packages_name_ck', sql`char_length(${t.name}) between 1 and 150`),
  ],
);

export const diagnosticPackageTests = pgTable(
  'hospital_diagnostic_package_tests',
  {
    packageId: uuid('package_id')
      .notNull()
      .references(() => diagnosticPackages.id, { onDelete: 'cascade' }),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    /** The test's rate inside the package. */
    rate: money('rate').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.packageId, t.testId] }),
    check('hospital_diagnostic_package_tests_rate_ck', sql`${t.rate} >= 0`),
  ],
);

// Diagnostic rules in one row (old: discount categories with a maximum each, commission groups per media).
export const diagnosticPolicy = pgTable(
  'hospital_diagnostic_policy',
  {
    id: smallint('id').primaryKey(),
    /** The discount a counter may give without diag:discount, as a share of what may be discounted. */
    counterDiscountPercent: percent('counter_discount_percent').notNull(),
    /** The referring doctor's commission when neither the doctor nor the test has one. */
    defaultReferralPercent: percent('default_referral_percent').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('hospital_diagnostic_policy_single_ck', sql`${t.id} = 1`),
    check(
      'hospital_diagnostic_policy_percent_ck',
      sql`${t.counterDiscountPercent} between 0 and 100 and ${t.defaultReferralPercent} between 0 and 100`,
    ),
  ],
);

// Old Diag.InvestigationInvoices with their details and ledger (the due never stored, always worked out): tests billed
// to a registered patient, each with when its report is due, and the commission of the doctor who referred them.
export const diagnosticBills = pgTable(
  'hospital_diagnostic_bills',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    billedOn: day('billed_on').notNull(),
    billedAt: tz('billed_at').notNull(),
    referredById: uuid('referred_by_id').references(() => doctors.id, { onDelete: 'restrict' }),
    corporateClientId: uuid('corporate_client_id').references(() => corporateClients.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
    /** Tests of an admitted patient: charged to the stay, paid with its final bill (old IPDPatientRecordId). */
    admissionId: uuid('admission_id').references((): AnyPgColumn => admissions.id, { onDelete: 'restrict' }),
    gross: money('gross').notNull(),
    discount: money('discount').notNull(),
    discountReason: text('discount_reason'),
    net: money('net').notNull(),
    /** What the cancelled tests were worth after their part of the discount. */
    cancelled: money('cancelled').notNull().default(0),
    paid: money('paid').notNull(),
    collected: money('collected').notNull().default(0),
    refunded: money('refunded').notNull().default(0),
    status: text('status', { enum: ['billed', 'cancelled'] }).notNull(),
    voucherNumber: text('voucher_number'),
    billedBy: uuid('billed_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('hospital_diagnostic_bills_number_uq').on(t.number),
    index('hospital_diagnostic_bills_patient_idx').on(t.patientId),
    index('hospital_diagnostic_bills_billed_idx').on(t.billedOn),
    index('hospital_diagnostic_bills_corporate_idx').on(t.corporateClientId),
    index('hospital_diagnostic_bills_referrer_idx').on(t.referredById),
    index('hospital_diagnostic_bills_admission_idx').on(t.admissionId),
    check(
      'hospital_diagnostic_bills_indoor_ck',
      sql`${t.admissionId} is null or (${t.corporateClientId} is null and ${t.staffId} is null and ${t.discount} = 0 and ${t.paid} = 0)`,
    ),
    check('hospital_diagnostic_bills_payer_ck', sql`${t.corporateClientId} is null or ${t.staffId} is null`),
    check(
      'hospital_diagnostic_bills_amounts_ck',
      sql`${t.discount} >= 0 and ${t.discount} <= ${t.gross} and ${t.net} = ${t.gross} - ${t.discount} and ${t.cancelled} between 0 and ${t.net} and ${t.paid} >= 0 and ${t.collected} >= 0 and ${t.refunded} >= 0 and ${t.paid} + ${t.collected} - ${t.refunded} <= ${t.net} - ${t.cancelled}`,
    ),
  ],
);

export const diagnosticBillLines = pgTable(
  'hospital_diagnostic_bill_lines',
  {
    billId: uuid('bill_id')
      .notNull()
      .references(() => diagnosticBills.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    /** The package it was sold in, if any. */
    packageId: uuid('package_id').references(() => diagnosticPackages.id, { onDelete: 'restrict' }),
    rate: money('rate').notNull(),
    discountAllowed: boolean('discount_allowed').notNull(),
    /** Its part of the bill's discount. */
    discount: money('discount').notNull(),
    referralPercent: percent('referral_percent').notNull(),
    referralAmount: money('referral_amount').notNull(),
    /** When the report is due (old ProbableReportDeliveryDateTime); null: no report. */
    reportDueAt: tz('report_due_at'),
    status: text('status', { enum: ['billed', 'cancelled'] }).notNull(),
    cancelledOn: day('cancelled_on'),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    primaryKey({ columns: [t.billId, t.position] }),
    index('hospital_diagnostic_bill_lines_test_idx').on(t.testId),
    check(
      'hospital_diagnostic_bill_lines_amounts_ck',
      sql`${t.rate} >= 0 and ${t.discount} between 0 and ${t.rate} and ${t.referralAmount} between 0 and ${t.rate}`,
    ),
  ],
);

// Old InvestigationInvoiceLedgers payment rows (Payment, DueCollection, Refund): money in and out of a diagnostic bill.
export const diagnosticPayments = pgTable(
  'hospital_diagnostic_payments',
  {
    id: uuid('id').primaryKey(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => diagnosticBills.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: ['payment', 'collection', 'refund'] }).notNull(),
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
    index('hospital_diagnostic_payments_bill_idx').on(t.billId),
    index('hospital_diagnostic_payments_paid_idx').on(t.paidOn),
    check('hospital_diagnostic_payments_amount_ck', sql`${t.amount} > 0`),
  ],
);
