import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  admissions,
  appointments,
  diagnosticTests,
  doctors,
  patients,
} from '../../../hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { generics, products } from '../../../pharmacy/infrastructure/persistence/pharmacy.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const decimal = (name: string) => numeric(name, { precision: 5, scale: 1, mode: 'number' });
// The same lists as the domain's (kept literal here so drizzle-kit loads this file on its own).
const RX_STATUSES = ['draft', 'signed', 'cancelled'] as const;
const PHRASE_KINDS = ['complaint', 'history', 'examination', 'diagnosis', 'advice', 'dose'] as const;
const NOTE_KINDS = ['round', 'consult', 'procedure', 'transfer', 'icu', 'handover'] as const;
const DELIVERY_MODES = ['normal', 'caesarean', 'assisted'] as const;
const SEXES = ['male', 'female', 'other'] as const;
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Document numbers of the clinical module: one counter per kind and year.
export const clinicalSequences = pgTable(
  'clinical_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old Rx.VisitHistory with its InitialData: a patient's visit to a doctor and what the doctor wrote. The vitals are
// taken by the doctor's assistant; the rest is the doctor's, signed when done.
export const prescriptions = pgTable(
  'clinical_prescriptions',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    /** The chamber appointment it was written for; null for a patient seen without one. */
    appointmentId: uuid('appointment_id').references(() => appointments.id, { onDelete: 'restrict' }),
    /** The patient's visits to this doctor, this one included (old VisitNo). */
    visitNo: smallint('visit_no').notNull(),
    visitOn: day('visit_on').notNull(),
    status: text('status', { enum: RX_STATUSES }).notNull(),
    weightKg: decimal('weight_kg'),
    heightCm: decimal('height_cm'),
    bpSystolic: smallint('bp_systolic'),
    bpDiastolic: smallint('bp_diastolic'),
    pulse: smallint('pulse'),
    temperatureF: decimal('temperature_f'),
    spo2: smallint('spo2'),
    vitalsBy: uuid('vitals_by').references(() => users.id, { onDelete: 'set null' }),
    vitalsAt: tz('vitals_at'),
    /** History of the present illness. */
    history: text('history'),
    pastHistory: text('past_history'),
    drugHistory: text('drug_history'),
    /** On examination. */
    examination: text('examination'),
    diagnosis: text('diagnosis'),
    treatmentPlan: text('treatment_plan'),
    /** Printed as special notes. */
    notes: text('notes'),
    followUpOn: day('follow_up_on'),
    followUpNote: text('follow_up_note'),
    referral: text('referral'),
    signedBy: uuid('signed_by').references(() => users.id, { onDelete: 'set null' }),
    signedAt: tz('signed_at'),
    cancelReason: text('cancel_reason'),
    openedBy: uuid('opened_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clinical_prescriptions_number_uq').on(t.number),
    uniqueIndex('clinical_prescriptions_appointment_uq')
      .on(t.appointmentId)
      .where(sql`${t.appointmentId} is not null and ${t.status} <> 'cancelled'`),
    index('clinical_prescriptions_patient_idx').on(t.patientId, t.visitOn),
    index('clinical_prescriptions_doctor_idx').on(t.doctorId, t.visitOn),
    check('clinical_prescriptions_follow_up_ck', sql`${t.followUpOn} is null or ${t.followUpOn} >= ${t.visitOn}`),
  ],
);

// Old Rx.PatientChiefComplain: the complaints and how long.
export const rxComplaints = pgTable(
  'clinical_rx_complaints',
  {
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    complaint: text('complaint').notNull(),
    duration: text('duration'),
  },
  (t) => [primaryKey({ columns: [t.prescriptionId, t.position] })],
);

// Old Rx.Drug: a medicine of the pharmacy (or written by name), its dose, how long and how many.
export const rxDrugs = pgTable(
  'clinical_rx_drugs',
  {
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    /** As printed: the product's name when written, or the name written by hand. */
    name: text('name').notNull(),
    dose: text('dose').notNull(),
    duration: text('duration'),
    qty: integer('qty'),
  },
  (t) => [
    primaryKey({ columns: [t.prescriptionId, t.position] }),
    check('clinical_rx_drugs_qty_ck', sql`${t.qty} is null or ${t.qty} > 0`),
  ],
);

// Old Rx.Investigation: tests advised (billed later at the diagnostic counter by the prescription's number).
export const rxTests = pgTable(
  'clinical_rx_tests',
  {
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    testId: uuid('test_id').references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    note: text('note'),
  },
  (t) => [primaryKey({ columns: [t.prescriptionId, t.position] })],
);

// Old Rx.AdviceToPatient.
export const rxAdvices = pgTable(
  'clinical_rx_advices',
  {
    prescriptionId: uuid('prescription_id')
      .notNull()
      .references(() => prescriptions.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    advice: text('advice').notNull(),
  },
  (t) => [primaryKey({ columns: [t.prescriptionId, t.position] })],
);

// Old Rx.ChiefComplain, PresentHistory, PastHistory, OtherFinding, Clinicalimpression, Advice (per doctor, CPId) and
// RxGenericDosage / RxCPDosage: what a doctor picks instead of typing. No doctor: shared by all.
export const phrases = pgTable(
  'clinical_phrases',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: PHRASE_KINDS }).notNull(),
    text: text('text').notNull(),
    /** Typed to pick it. */
    shortKey: text('short_key'),
    /** A dose for this generic only. */
    genericId: uuid('generic_id').references(() => generics.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clinical_phrases_text_uq').on(
      sql`coalesce(${t.doctorId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      t.kind,
      sql`coalesce(${t.genericId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.text})`,
    ),
    index('clinical_phrases_kind_idx').on(t.kind, t.doctorId),
    check('clinical_phrases_generic_ck', sql`${t.genericId} is null or ${t.kind} = 'dose'`),
  ],
);

// Old DigitalRx presets / templates: a doctor's set of medicines, tests and advice put on a prescription at once.
export const rxTemplates = pgTable(
  'clinical_rx_templates',
  {
    id: uuid('id').primaryKey(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    diagnosis: text('diagnosis'),
    drugs: jsonb('drugs')
      .$type<{ productId: string | null; name: string; dose: string; duration: string | null; qty: number | null }[]>()
      .notNull(),
    tests: jsonb('tests').$type<{ testId: string | null; name: string; note: string | null }[]>().notNull(),
    advices: jsonb('advices').$type<string[]>().notNull(),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('clinical_rx_templates_name_uq').on(t.doctorId, sql`lower(${t.name})`)],
);

// Old EMR ConsultancyVisitNote, DoctorVisitPlan, ProcedureNote, TransferNotesEMR, ICUCourse and
// NurseToNursePatientHandOverRecord: what the doctors and nurses write about an admitted patient, one kind of note
// each.
export const clinicalNotes = pgTable(
  'clinical_notes',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: NOTE_KINDS }).notNull(),
    /** The doctor who saw the patient (a round or a consultation; anyone's other notes may name one). */
    doctorId: uuid('doctor_id').references(() => doctors.id, { onDelete: 'restrict' }),
    /** When it happened (written then or later). */
    notedAt: tz('noted_at').notNull(),
    note: text('note').notNull(),
    /** A handover: the nurse taking over, and when they acknowledged it. */
    handedTo: uuid('handed_to').references(() => users.id, { onDelete: 'restrict' }),
    acknowledgedAt: tz('acknowledged_at'),
    writtenBy: uuid('written_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    index('clinical_notes_admission_idx').on(t.admissionId, t.notedAt),
    index('clinical_notes_handover_idx')
      .on(t.handedTo)
      .where(sql`${t.acknowledgedAt} is null`),
    check('clinical_notes_handover_ck', sql`(${t.kind} = 'handover') = (${t.handedTo} is not null)`),
  ],
);

// Old OTTemplate and the special order forms (endoscopy, ERCP, colonoscopy …): a note's starting text.
export const noteTemplates = pgTable(
  'clinical_note_templates',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    kind: text('kind', { enum: NOTE_KINDS }).notNull(),
    body: text('body').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('clinical_note_templates_name_uq').on(sql`lower(${t.name})`)],
);

// Old EMR DeathRecord (with its detail and common data): an admitted patient's death, certified by a doctor.
export const deathRecords = pgTable(
  'clinical_death_records',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    diedAt: tz('died_at').notNull(),
    /** The immediate cause, what led to it, and other significant conditions. */
    cause: text('cause').notNull(),
    antecedentCause: text('antecedent_cause'),
    otherConditions: text('other_conditions'),
    deceasedNid: text('deceased_nid'),
    guardianName: text('guardian_name'),
    guardianNid: text('guardian_nid'),
    guardianRelation: text('guardian_relation'),
    familyContactNo: text('family_contact_no'),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    voidedAt: tz('voided_at'),
    voidReason: text('void_reason'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clinical_death_records_number_uq').on(t.number),
    uniqueIndex('clinical_death_records_admission_uq')
      .on(t.admissionId)
      .where(sql`${t.voidedAt} is null`),
  ],
);

// Old EMR BirthCertificate: a child born to an admitted mother.
export const birthRecords = pgTable(
  'clinical_birth_records',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    /** The mother's admission. */
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    motherId: uuid('mother_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    childName: text('child_name'),
    childSex: text('child_sex', { enum: SEXES }).notNull(),
    bornAt: tz('born_at').notNull(),
    deliveryMode: text('delivery_mode', { enum: DELIVERY_MODES }).notNull(),
    birthWeightKg: numeric('birth_weight_kg', { precision: 4, scale: 2, mode: 'number' }).notNull(),
    fatherName: text('father_name'),
    grandfatherName: text('grandfather_name'),
    religion: text('religion'),
    fatherPresentAddress: text('father_present_address'),
    fatherPermanentAddress: text('father_permanent_address'),
    comments: text('comments'),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    voidedAt: tz('voided_at'),
    voidReason: text('void_reason'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clinical_birth_records_number_uq').on(t.number),
    index('clinical_birth_records_admission_idx').on(t.admissionId),
    check('clinical_birth_records_weight_ck', sql`${t.birthWeightKg} > 0 and ${t.birthWeightKg} < 10`),
  ],
);
