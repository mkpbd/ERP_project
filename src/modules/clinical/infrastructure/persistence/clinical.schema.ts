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
const NOTE_KINDS = ['round', 'consult', 'procedure', 'transfer', 'icu', 'handover', 'pre_op', 'post_op'] as const;
const DELIVERY_MODES = ['normal', 'caesarean', 'assisted'] as const;
const SEXES = ['male', 'female', 'other'] as const;
const ROUTES = ['oral', 'iv', 'im', 'sc', 'topical', 'inhaled', 'rectal', 'other'] as const;
const SCHEDULES = ['times', 'interval', 'once', 'prn'] as const;
const ORDER_STATUSES = ['active', 'held', 'stopped'] as const;
const ORDER_EVENTS = ['start', 'hold', 'resume', 'stop'] as const;
const DOSE_OUTCOMES = ['given', 'missed'] as const;
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

// Old Hospital.RxIpdTreatment with TreatmentDoseTiming / TreatmentDoseTimingDetail: a medicine ordered for an admitted
// patient, its dose, route and when it is due (set times each day, every so many hours, once, or when needed).
export const treatmentOrders = pgTable(
  'clinical_treatment_orders',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    /** A medicine, or nursing care (old NonMedicationOrder): then drug_name is the order and dose how it is done. */
    kind: text('kind', { enum: ['medicine', 'care'] })
      .notNull()
      .default('medicine'),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'restrict' }),
    drugName: text('drug_name').notNull(),
    dose: text('dose'),
    route: text('route', { enum: ROUTES }),
    schedule: text('schedule', { enum: SCHEDULES }).notNull(),
    /** Set times of day (HH:MM, the organisation's time) for a `times` schedule. */
    times: text('times').array().notNull(),
    /** Hours between doses for an `interval` schedule. */
    intervalHours: smallint('interval_hours'),
    startAt: tz('start_at').notNull(),
    note: text('note'),
    status: text('status', { enum: ORDER_STATUSES }).notNull(),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    orderedBy: uuid('ordered_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    index('clinical_treatment_orders_admission_idx').on(t.admissionId, t.status),
    check(
      'clinical_treatment_orders_kind_ck',
      sql`(${t.kind} = 'care' and ${t.route} is null and ${t.productId} is null) or (${t.kind} = 'medicine' and ${t.dose} is not null and ${t.route} is not null)`,
    ),
    check(
      'clinical_treatment_orders_schedule_ck',
      sql`(${t.schedule} = 'interval') = (${t.intervalHours} is not null) and (${t.schedule} = 'times') = (cardinality(${t.times}) > 0)`,
    ),
  ],
);

// Old RxIpdTreatment's event rows (TreatmentId, EventName, Note): started, held, resumed, stopped.
export const orderEvents = pgTable(
  'clinical_order_events',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => treatmentOrders.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    event: text('event', { enum: ORDER_EVENTS }).notNull(),
    at: tz('at').notNull(),
    note: text('note'),
    by: uuid('by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.position] })],
);

// Old AppliedMedicationDose: a due dose given (or missed, with why) by the nurse; a when-needed dose when given.
export const doseRecords = pgTable(
  'clinical_dose_records',
  {
    id: uuid('id').primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => treatmentOrders.id, { onDelete: 'restrict' }),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    /** The due time it answers; null for a when-needed dose. */
    dueAt: tz('due_at'),
    outcome: text('outcome', { enum: DOSE_OUTCOMES }).notNull(),
    /** When given (null when missed). */
    givenAt: tz('given_at'),
    reason: text('reason'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('clinical_dose_records_due_uq')
      .on(t.orderId, t.dueAt)
      .where(sql`${t.dueAt} is not null`),
    index('clinical_dose_records_admission_idx').on(t.admissionId, t.createdAt),
    check('clinical_dose_records_outcome_ck', sql`(${t.outcome} = 'given') = (${t.givenAt} is not null)`),
  ],
);

// Old TreatmentOnDischarge, DietOnDischarge and AdvicesOnTreatment, with the discharge certificate: the doctor's summary
// of the stay and what follows it.
export const dischargeSummaries = pgTable(
  'clinical_discharge_summaries',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    diagnosis: text('diagnosis'),
    /** The course in hospital: findings, procedures, response. */
    course: text('course'),
    conditionOnDischarge: text('condition_on_discharge'),
    treatment: jsonb('treatment')
      .$type<{ productId: string | null; name: string; dose: string; duration: string | null }[]>()
      .notNull(),
    diet: text('diet'),
    advice: text('advice'),
    followUpOn: day('follow_up_on'),
    followUpNote: text('follow_up_note'),
    doctorId: uuid('doctor_id')
      .notNull()
      .references(() => doctors.id, { onDelete: 'restrict' }),
    status: text('status', { enum: ['draft', 'signed'] }).notNull(),
    signedBy: uuid('signed_by').references(() => users.id, { onDelete: 'set null' }),
    signedAt: tz('signed_at'),
    writtenBy: uuid('written_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex('clinical_discharge_summaries_admission_uq').on(t.admissionId)],
);

export const HISTORY_KINDS = ['prescription', 'lab-report', 'imaging-report', 'discharge-summary', 'note'] as const;

// The old system's clinical records, brought over at the cut-over (step 13f): read-only, as they were written there.
// Lab reports keep their results as values (below), so a patient's results can be followed over time.
export const historyRecords = pgTable(
  'clinical_history_records',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    kind: text('kind', { enum: HISTORY_KINDS }).notNull(),
    title: text('title').notNull(),
    number: text('number'),
    recordedOn: day('recorded_on').notNull(),
    author: text('author'),
    body: text('body').notNull(),
    /** Shown to the patient (reports finalised in the old system, prescriptions, discharge certificates). */
    shared: boolean('shared').notNull(),
    /** The old table and row it came from. */
    source: text('source').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('clinical_history_records_source_uq').on(t.source),
    index('clinical_history_records_patient_idx').on(t.patientId, t.recordedOn),
    check(
      'clinical_history_records_kind_ck',
      sql`${t.kind} in ('prescription', 'lab-report', 'imaging-report', 'discharge-summary', 'note')`,
    ),
    check('clinical_history_records_title_ck', sql`char_length(${t.title}) between 1 and 200`),
    check('clinical_history_records_body_ck', sql`char_length(${t.body}) <= 200000`),
  ],
);

export const historyValues = pgTable(
  'clinical_history_values',
  {
    recordId: uuid('record_id')
      .notNull()
      .references(() => historyRecords.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    test: text('test').notNull(),
    result: text('result').notNull(),
    unit: text('unit'),
    reference: text('reference'),
  },
  (t) => [
    primaryKey({ columns: [t.recordId, t.position] }),
    index('clinical_history_values_test_idx').on(sql`lower(${t.test})`),
    check('clinical_history_values_test_ck', sql`char_length(${t.test}) between 1 and 200`),
  ],
);

// Old Hospital.FollowUpSheetSchedules: the observation rounds of the wards' day (morning, noon, evening, night), each a
// window of local time; a night round's end is the next morning.
export const observationRounds = pgTable(
  'clinical_observation_rounds',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('clinical_observation_rounds_name_uq').on(sql`lower(${t.name})`),
    check(
      'clinical_observation_rounds_times_ck',
      sql`${t.startTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.endTime} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and ${t.startTime} <> ${t.endTime}`,
    ),
  ],
);

// Old Hospital.FollowUpData (a dynamic form per round): an admitted patient's vital signs and observations as taken by
// a nurse, with the round they answer.
export const observations = pgTable(
  'clinical_observations',
  {
    id: uuid('id').primaryKey(),
    admissionId: uuid('admission_id')
      .notNull()
      .references(() => admissions.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    takenAt: tz('taken_at').notNull(),
    /** The round of that day the observation answers (the one whose window holds it, unless named). */
    roundId: uuid('round_id').references(() => observationRounds.id, { onDelete: 'set null' }),
    roundOn: day('round_on'),
    temperatureF: decimal('temperature_f'),
    pulse: smallint('pulse'),
    respRate: smallint('resp_rate'),
    systolic: smallint('systolic'),
    diastolic: smallint('diastolic'),
    spo2: smallint('spo2'),
    painScore: smallint('pain_score'),
    bloodSugar: decimal('blood_sugar'),
    intakeMl: integer('intake_ml'),
    outputMl: integer('output_ml'),
    consciousness: text('consciousness', { enum: ['alert', 'voice', 'pain', 'unresponsive'] }),
    note: text('note'),
    recordedBy: uuid('recorded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Entered in error: kept, struck through, with why. */
    struckAt: tz('struck_at'),
    struckBy: uuid('struck_by').references(() => users.id, { onDelete: 'set null' }),
    struckReason: text('struck_reason'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('clinical_observations_admission_idx').on(t.admissionId, t.takenAt),
    index('clinical_observations_round_idx').on(t.roundOn, t.roundId),
    check('clinical_observations_round_ck', sql`(${t.roundId} is null) = (${t.roundOn} is null)`),
    check('clinical_observations_struck_ck', sql`(${t.struckAt} is null) = (${t.struckReason} is null)`),
  ],
);
