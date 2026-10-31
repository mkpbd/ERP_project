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
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import {
  diagnosticBills,
  diagnosticDepartments,
  diagnosticTests,
  doctors,
  patients,
} from '../../../hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import {
  itemVariants,
  storeDepartments,
} from '../../../supply-chain/infrastructure/persistence/supply-chain.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const measure = (name: string) => numeric(name, { precision: 14, scale: 4, mode: 'number' });
// The same lists as the domain's (kept literal here so drizzle-kit loads this file on its own).
const SAMPLE_STATUSES = ['collected', 'received', 'rejected'] as const;
const RESULT_STATUSES = ['pending', 'entered', 'verified', 'delivered', 'rejected'] as const;
const REPORT_FORMS = ['values', 'culture', 'descriptive'] as const;
const SENSITIVITIES = ['S', 'I', 'R'] as const;

// Old Admin.InvoiceGenerators for lab numbers (SPGetNextLabNo): one counter per day.
export const labSequences = pgTable('lab_sequences', {
  day: day('day').primaryKey(),
  last: integer('last').notNull(),
});

// Old Diag.ReportParameters: what a test's report is made of, in order (old: a parameter row per test with its unit
// and method).
export const labParameters = pgTable(
  'lab_parameters',
  {
    id: uuid('id').primaryKey(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    position: smallint('position').notNull(),
    name: text('name').notNull(),
    unit: text('unit'),
    method: text('method'),
    kind: text('kind', { enum: ['numeric', 'text'] }).notNull(),
    /** Decimals shown for a numeric result. */
    decimals: smallint('decimals').notNull().default(0),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_parameters_position_uq').on(t.testId, t.position),
    check('lab_parameters_name_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('lab_parameters_decimals_ck', sql`${t.decimals} between 0 and 4`),
  ],
);

// Old Diag.AgeVariantNormalValue: the normal range of a parameter by sex and age (null sex: either).
export const labParameterRanges = pgTable(
  'lab_parameter_ranges',
  {
    id: uuid('id').primaryKey(),
    parameterId: uuid('parameter_id')
      .notNull()
      .references(() => labParameters.id, { onDelete: 'cascade' }),
    sex: text('sex', { enum: ['male', 'female'] }),
    minAgeDays: integer('min_age_days').notNull().default(0),
    maxAgeDays: integer('max_age_days'),
    low: measure('low'),
    high: measure('high'),
    /** What a normal text result reads (Negative, Non-reactive …), or how the range is printed. */
    normalText: text('normal_text'),
  },
  (t) => [
    index('lab_parameter_ranges_parameter_idx').on(t.parameterId),
    check(
      'lab_parameter_ranges_age_ck',
      sql`${t.minAgeDays} >= 0 and (${t.maxAgeDays} is null or ${t.maxAgeDays} >= ${t.minAgeDays})`,
    ),
    check('lab_parameter_ranges_values_ck', sql`${t.low} is null or ${t.high} is null or ${t.low} <= ${t.high}`),
  ],
);

// Old Diag.SampleCollectionRecords (a lab number per sample tube): what is taken from the patient for one bill's tests
// of one lab department, with its lab number.
export const labSamples = pgTable(
  'lab_samples',
  {
    id: uuid('id').primaryKey(),
    labNumber: text('lab_number').notNull(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => diagnosticBills.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => diagnosticDepartments.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    collectedOn: day('collected_on').notNull(),
    collectedAt: tz('collected_at').notNull(),
    collectedBy: uuid('collected_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: SAMPLE_STATUSES }).notNull(),
    receivedAt: tz('received_at'),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    rejectReason: text('reject_reason'),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_samples_number_uq').on(t.labNumber),
    index('lab_samples_bill_idx').on(t.billId),
    index('lab_samples_collected_idx').on(t.collectedOn, t.departmentId),
  ],
);

// Old Diag.PathologyReports / PathologyReportDetails with ReportVerifiers: one test's result on a sample, entered,
// verified by someone else, and handed over.
export const labResults = pgTable(
  'lab_results',
  {
    id: uuid('id').primaryKey(),
    sampleId: uuid('sample_id')
      .notNull()
      .references(() => labSamples.id, { onDelete: 'restrict' }),
    billId: uuid('bill_id')
      .notNull()
      .references(() => diagnosticBills.id, { onDelete: 'restrict' }),
    /** The diagnostic bill's line. */
    line: smallint('line').notNull(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    status: text('status', { enum: RESULT_STATUSES }).notNull(),
    comment: text('comment'),
    enteredBy: uuid('entered_by').references(() => users.id, { onDelete: 'set null' }),
    enteredAt: tz('entered_at'),
    verifiedBy: uuid('verified_by').references(() => users.id, { onDelete: 'set null' }),
    verifiedAt: tz('verified_at'),
    deliveredTo: text('delivered_to'),
    deliveredBy: uuid('delivered_by').references(() => users.id, { onDelete: 'set null' }),
    deliveredAt: tz('delivered_at'),
    /** Reagents used up when verified (short: the lab's store held too little). */
    reagents: text('reagents', { enum: ['used', 'short'] }),
    /** How it was entered: values, a culture (lab_culture_reports) or a written report (narrative); null while pending. */
    form: text('form', { enum: REPORT_FORMS }),
    narrative: text('narrative'),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('lab_results_narrative_ck', sql`(${t.narrative} is null) = (${t.form} is distinct from 'descriptive')`),
    // A bill's test is worked on once at a time (a rejected sample's test is collected again).
    uniqueIndex('lab_results_line_uq')
      .on(t.billId, t.line)
      .where(sql`${t.status} <> 'rejected'`),
    index('lab_results_sample_idx').on(t.sampleId),
    index('lab_results_status_idx').on(t.status),
  ],
);

// The values of a result, each with its parameter's name, unit and range as they were when entered (so a template
// changed later does not change a report already made).
export const labResultValues = pgTable(
  'lab_result_values',
  {
    resultId: uuid('result_id')
      .notNull()
      .references(() => labResults.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    parameterId: uuid('parameter_id').references(() => labParameters.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    unit: text('unit'),
    method: text('method'),
    value: text('value'),
    numeric: measure('numeric'),
    low: measure('low'),
    high: measure('high'),
    normalText: text('normal_text'),
    flag: text('flag', { enum: ['low', 'high'] }),
  },
  (t) => [primaryKey({ columns: [t.resultId, t.position] })],
);

// How a lab test is reported when not by values against its parameters (no row: values).
export const labTestForms = pgTable(
  'lab_test_forms',
  {
    testId: uuid('test_id')
      .primaryKey()
      .references(() => diagnosticTests.id, { onDelete: 'cascade' }),
    form: text('form', { enum: REPORT_FORMS }).notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [check('lab_test_forms_form_ck', sql`${t.form} <> 'values'`)],
);

const nameLength = (table: string, column: AnyPgColumn, max: number) =>
  check(`${table}_name_ck`, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);

// Old Diag.CSAntibiotics: the antibiotics of the antibiogram.
export const labAntibiotics = pgTable(
  'lab_antibiotics',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    /** Its class (Penicillins, Cephalosporins …), to order the antibiogram by. */
    groupName: text('group_name'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lab_antibiotics_name_uq').on(t.name), nameLength('lab_antibiotics', t.name, 100)],
);

// Old Diag.MicroBioBacterias: the organisms a culture isolates.
export const labOrganisms = pgTable(
  'lab_organisms',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lab_organisms_name_uq').on(t.name), nameLength('lab_organisms', t.name, 150)],
);

// Old Diag.CSGrowthTypes: how a culture grew (heavy growth, scanty growth, no growth after 48 hours …).
export const labGrowthTypes = pgTable(
  'lab_growth_types',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('lab_growth_types_name_uq').on(t.name), nameLength('lab_growth_types', t.name, 100)],
);

// Old Diag.CSMessases: the usual closing remarks of a culture report, to pick from.
export const labCultureMessages = pgTable(
  'lab_culture_messages',
  {
    id: uuid('id').primaryKey(),
    text: text('text').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_culture_messages_text_uq').on(t.text),
    check('lab_culture_messages_text_ck', sql`char_length(${t.text}) between 1 and 500`),
  ],
);

// Old Diag.PathologyTemplates: the usual wording of a written report (histopathology, cytology …) to start from.
export const labReportTemplates = pgTable(
  'lab_report_templates',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    body: text('body').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_report_templates_name_uq').on(t.name),
    nameLength('lab_report_templates', t.name, 150),
    check('lab_report_templates_body_ck', sql`char_length(${t.body}) between 1 and 20000`),
  ],
);

// A culture result (old CSOthersValues and CSNoGrowthResults): the microscopy and how the culture grew, with names
// copied from the masters.
export const labCultureReports = pgTable('lab_culture_reports', {
  resultId: uuid('result_id')
    .primaryKey()
    .references(() => labResults.id, { onDelete: 'cascade' }),
  analyzer: text('analyzer'),
  pusCells: text('pus_cells'),
  epithelialCells: text('epithelial_cells'),
  rbc: text('rbc'),
  microscopyNote: text('microscopy_note'),
  growth: boolean('growth').notNull(),
  growthTypeId: uuid('growth_type_id').references(() => labGrowthTypes.id, { onDelete: 'set null' }),
  growthType: text('growth_type'),
  colonyCount: text('colony_count'),
  incubation: text('incubation'),
  media: text('media'),
  message: text('message'),
});

// The organisms a culture isolated (old organisms A, B and C), in order.
export const labCultureOrganisms = pgTable(
  'lab_culture_organisms',
  {
    resultId: uuid('result_id')
      .notNull()
      .references(() => labResults.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    organismId: uuid('organism_id').references(() => labOrganisms.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.resultId, t.position] }),
    check('lab_culture_organisms_position_ck', sql`${t.position} between 1 and 3`),
    index('lab_culture_organisms_organism_idx').on(t.organismId),
  ],
);

// The antibiogram (old CSGrowths): each antibiotic's result against the organisms 1, 2 and 3.
export const labCultureSensitivities = pgTable(
  'lab_culture_sensitivities',
  {
    resultId: uuid('result_id')
      .notNull()
      .references(() => labResults.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    antibioticId: uuid('antibiotic_id').references(() => labAntibiotics.id, { onDelete: 'set null' }),
    antibiotic: text('antibiotic').notNull(),
    zone: text('zone'),
    result1: text('result_1', { enum: SENSITIVITIES }),
    result2: text('result_2', { enum: SENSITIVITIES }),
    result3: text('result_3', { enum: SENSITIVITIES }),
  },
  (t) => [
    primaryKey({ columns: [t.resultId, t.position] }),
    index('lab_culture_sensitivities_antibiotic_idx').on(t.antibioticId),
    check('lab_culture_sensitivities_results_ck', sql`coalesce(${t.result1}, ${t.result2}, ${t.result3}) is not null`),
  ],
);

// Old UNP.GetNextAccessionNumber: one counter per day for the imaging studies' accession numbers.
export const imagingSequences = pgTable('lab_imaging_sequences', {
  day: day('day').primaryKey(),
  last: integer('last').notNull(),
});

// Old Diag.RadiologyTemplates: the usual wording of an imaging report (a normal chest, a normal abdomen …) to start
// from.
export const imagingTemplates = pgTable(
  'lab_imaging_templates',
  {
    id: uuid('id').primaryKey(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    position: smallint('position').notNull(),
    name: text('name').notNull(),
    findings: text('findings').notNull(),
    impression: text('impression').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_imaging_templates_position_uq').on(t.testId, t.position),
    check('lab_imaging_templates_name_ck', sql`char_length(${t.name}) between 1 and 100`),
  ],
);

// Old Diag.RadiologyReports with the detail's AccessionNumber: an imaging test done for a bill, its report written,
// signed by the radiologist (who earns the reporting fee) and handed over.
export const imagingStudies = pgTable(
  'lab_imaging_studies',
  {
    id: uuid('id').primaryKey(),
    accessionNumber: text('accession_number').notNull(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => diagnosticBills.id, { onDelete: 'restrict' }),
    line: smallint('line').notNull(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'restrict' }),
    doneOn: day('done_on').notNull(),
    doneAt: tz('done_at').notNull(),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['done', 'signed', 'delivered'] }).notNull(),
    findings: text('findings'),
    impression: text('impression'),
    /** The radiologist (a doctor of the hospital) the report is signed for. */
    radiologistId: uuid('radiologist_id').references(() => doctors.id, { onDelete: 'restrict' }),
    signedBy: uuid('signed_by').references(() => users.id, { onDelete: 'set null' }),
    signedAt: tz('signed_at'),
    /** The reporting fee credited to the radiologist when signed. */
    reportingFee: numeric('reporting_fee', { precision: 12, scale: 2, mode: 'number' }).notNull().default(0),
    deliveredTo: text('delivered_to'),
    deliveredBy: uuid('delivered_by').references(() => users.id, { onDelete: 'set null' }),
    deliveredAt: tz('delivered_at'),
    /** Films and reagents used up when signed (short: the store held too little). */
    reagents: text('reagents', { enum: ['used', 'short'] }),
    version: integer('version').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('lab_imaging_studies_accession_uq').on(t.accessionNumber),
    uniqueIndex('lab_imaging_studies_line_uq').on(t.billId, t.line),
    index('lab_imaging_studies_done_idx').on(t.doneOn, t.status),
  ],
);

// Which store department's stock a diagnostic department uses up (old ReAgentManagement: the lab's own store).
export const labStockDepartments = pgTable('lab_stock_departments', {
  diagnosticDepartmentId: uuid('diagnostic_department_id')
    .primaryKey()
    .references(() => diagnosticDepartments.id, { onDelete: 'cascade' }),
  storeDepartmentId: uuid('store_department_id')
    .notNull()
    .references(() => storeDepartments.id, { onDelete: 'restrict' }),
});

// Old ReAgentManagement.TestAndRegAgentMappings and SupplyChain.XrayFilmTestMappings: what one test uses up.
export const labTestReagents = pgTable(
  'lab_test_reagents',
  {
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 12, scale: 3, mode: 'number' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.testId, t.variantId] }), check('lab_test_reagents_qty_ck', sql`${t.qty} > 0`)],
);

// What a verified result or a signed imaging report used up, with the department consumption that took it (none:
// the department held too little, to be entered by hand).
export const labReagentUses = pgTable(
  'lab_reagent_uses',
  {
    id: uuid('id').primaryKey(),
    sourceKind: text('source_kind', { enum: ['result', 'study'] }).notNull(),
    sourceId: uuid('source_id').notNull(),
    testId: uuid('test_id')
      .notNull()
      .references(() => diagnosticTests.id, { onDelete: 'restrict' }),
    storeDepartmentId: uuid('store_department_id')
      .notNull()
      .references(() => storeDepartments.id, { onDelete: 'restrict' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => itemVariants.id, { onDelete: 'restrict' }),
    qty: numeric('qty', { precision: 12, scale: 3, mode: 'number' }).notNull(),
    usedOn: day('used_on').notNull(),
    consumptionNumber: text('consumption_number'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('lab_reagent_uses_source_idx').on(t.sourceKind, t.sourceId),
    index('lab_reagent_uses_used_idx').on(t.usedOn),
  ],
);
