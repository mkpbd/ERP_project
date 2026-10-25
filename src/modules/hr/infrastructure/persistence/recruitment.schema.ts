import { sql } from 'drizzle-orm';
import {
  check,
  customType,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { designations, hrDepartments } from './hr.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

export const JOB_APPLICATION_STATUSES = [
  'received',
  'shortlisted',
  'interviewed',
  'selected',
  'rejected',
  'withdrawn',
] as const;

// Old HR.JobCirculations (number and title); the post, dates and vacancies are new and optional.
export const jobCirculars = pgTable(
  'job_circulars',
  {
    id: uuid('id').primaryKey(),
    circularNo: text('circular_no').notNull(),
    title: text('title').notNull(),
    departmentId: uuid('department_id').references(() => hrDepartments.id, { onDelete: 'restrict' }),
    designationId: uuid('designation_id').references(() => designations.id, { onDelete: 'restrict' }),
    vacancies: integer('vacancies'),
    publishedOn: day('published_on'),
    closesOn: day('closes_on'),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('job_circulars_no_uq').on(sql`upper(${t.circularNo})`),
    check('job_circulars_no_len_ck', sql`char_length(${t.circularNo}) between 1 and 50`),
    check('job_circulars_title_len_ck', sql`char_length(${t.title}) between 1 and 200`),
    check('job_circulars_vacancies_ck', sql`${t.vacancies} is null or ${t.vacancies} between 1 and 10000`),
    check(
      'job_circulars_dates_ck',
      sql`${t.closesOn} is null or ${t.publishedOn} is null or ${t.closesOn} >= ${t.publishedOn}`,
    ),
  ],
);

// Old HR.JobCvs without the file columns (they live in job_application_files).
export const jobApplications = pgTable(
  'job_applications',
  {
    id: uuid('id').primaryKey(),
    circularId: uuid('circular_id')
      .notNull()
      .references(() => jobCirculars.id, { onDelete: 'restrict' }),
    appliedFor: text('applied_for'),
    applicantName: text('applicant_name').notNull(),
    // Nullable only for migrated rows; the API requires it.
    mobileNo: text('mobile_no'),
    email: text('email'),
    status: text('status', { enum: JOB_APPLICATION_STATUSES }).notNull().default('received'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    index('job_applications_circular_idx').on(t.circularId, t.status),
    uniqueIndex('job_applications_circular_mobile_uq').on(t.circularId, t.mobileNo),
    check('job_applications_name_len_ck', sql`char_length(${t.applicantName}) between 1 and 150`),
    check(
      'job_applications_status_ck',
      sql`${t.status} in ('received', 'shortlisted', 'interviewed', 'selected', 'rejected', 'withdrawn')`,
    ),
  ],
);

// Old JobCvs.CvinPdf / CvinWord: any number of CV files per application.
export const jobApplicationFiles = pgTable(
  'job_application_files',
  {
    id: uuid('id').primaryKey(),
    applicationId: uuid('application_id')
      .notNull()
      .references(() => jobApplications.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedAt: tz('uploaded_at').notNull().defaultNow(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('job_application_files_application_idx').on(t.applicationId),
    check(
      'job_application_files_type_ck',
      sql`${t.contentType} in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')`,
    ),
    check('job_application_files_size_ck', sql`octet_length(${t.data}) between 1 and 5242880`),
  ],
);
