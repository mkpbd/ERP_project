import { sql, type SQLWrapper } from 'drizzle-orm';
import {
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
import { countries } from '../../../location/infrastructure/persistence/location.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const nameLength = (table: string, column: SQLWrapper) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and 100`);
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });

// ---- Organization structure (old HR.Divisions / Departments / SubDepartments / Designations, int ids)

export const hrDivisions = pgTable(
  'hr_divisions',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('hr_divisions_name_uq').on(sql`lower(${t.name})`), nameLength('hr_divisions', t.name)],
);

export const hrDepartments = pgTable(
  'hr_departments',
  {
    id: uuid('id').primaryKey(),
    divisionId: uuid('division_id')
      .notNull()
      .references(() => hrDivisions.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('hr_departments_name_uq').on(sql`lower(${t.name})`),
    index('hr_departments_division_idx').on(t.divisionId),
    nameLength('hr_departments', t.name),
  ],
);

export const hrSubDepartments = pgTable(
  'hr_sub_departments',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('hr_sub_departments_department_name_uq').on(t.departmentId, sql`lower(${t.name})`),
    index('hr_sub_departments_department_idx').on(t.departmentId),
    nameLength('hr_sub_departments', t.name),
  ],
);

export const designations = pgTable(
  'designations',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    joiningSalary: money('joining_salary').notNull().default(0),
    incrementAfterConfirmation: money('increment_after_confirmation').notNull().default(0),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('designations_name_uq').on(sql`lower(${t.name})`),
    nameLength('designations', t.name),
    check('designations_money_ck', sql`${t.joiningSalary} >= 0 and ${t.incrementAfterConfirmation} >= 0`),
  ],
);

// ---- Calendar (old HR.Festivals, HR.GovtHolidays)

export const festivals = pgTable(
  'festivals',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('festivals_name_uq').on(sql`lower(${t.name})`), nameLength('festivals', t.name)],
);

export const govtHolidays = pgTable(
  'govt_holidays',
  {
    id: uuid('id').primaryKey(),
    holidayDate: day('holiday_date').notNull(),
    name: text('name').notNull(),
    category: text('category'),
    description: text('description'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('govt_holidays_date_name_uq').on(t.holidayDate, sql`lower(${t.name})`),
    check('govt_holidays_name_len_ck', sql`char_length(${t.name}) between 1 and 200`),
  ],
);

// ---- Staff (old HR.StaffRecords and its child tables)

export const staffRecords = pgTable(
  'staff_records',
  {
    id: uuid('id').primaryKey(),
    employeeNo: text('employee_no').notNull(),
    fullName: text('full_name').notNull(),
    firstName: text('first_name'),
    middleName: text('middle_name'),
    lastName: text('last_name'),
    fatherName: text('father_name'),
    motherName: text('mother_name'),
    dateOfBirth: day('date_of_birth'),
    sex: text('sex', { enum: ['male', 'female', 'other'] }),
    maritalStatus: text('marital_status'),
    religion: text('religion'),
    bloodGroup: text('blood_group', { enum: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }),
    nationalityCountryId: uuid('nationality_country_id').references(() => countries.id, { onDelete: 'restrict' }),
    nationalityOther: text('nationality_other'),
    nationalIdOrPassport: text('national_id_or_passport'),
    tinNo: text('tin_no'),
    mobileNo: text('mobile_no'),
    officialMobileNo: text('official_mobile_no'),
    email: text('email'),
    guardianContact: text('guardian_contact'),
    presentAddress: text('present_address'),
    permanentAddress: text('permanent_address'),
    divisionId: uuid('division_id').references(() => hrDivisions.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    subDepartmentId: uuid('sub_department_id')
      .notNull()
      .references(() => hrSubDepartments.id, { onDelete: 'restrict' }),
    designationId: uuid('designation_id')
      .notNull()
      .references(() => designations.id, { onDelete: 'restrict' }),
    joiningDesignationId: uuid('joining_designation_id').references(() => designations.id, { onDelete: 'restrict' }),
    joiningDate: day('joining_date').notNull(),
    probationEndDate: day('probation_end_date'),
    confirmationDate: day('confirmation_date'),
    employeeCategory: smallint('employee_category'),
    jobLocation: text('job_location'),
    serviceNature: text('service_nature').notNull(),
    salaryStatus: text('salary_status').notNull(),
    paymentMode: text('payment_mode'),
    bankAccountNo: text('bank_account_no'),
    biometricEnrollmentNo: integer('biometric_enrollment_no'),
    isHeadOfDepartment: boolean('is_head_of_department').notNull().default(false),
    workingTime: text('working_time'),
    intervalTime: text('interval_time'),
    weeklyHoliday: text('weekly_holiday'),
    shiftAndRelay: text('shift_and_relay'),
    changeGroupDescription: text('change_group_description'),
    nursingCouncilNo: text('nursing_council_no'),
    medicalCouncilNo: text('medical_council_no'),
    remarks: text('remarks'),
    status: text('status', { enum: ['active', 'inactive', 'separated'] })
      .notNull()
      .default('active'),
    statusReason: text('status_reason'),
    separationDate: day('separation_date'),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull().default(1),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('staff_records_employee_no_uq').on(sql`upper(${t.employeeNo})`),
    uniqueIndex('staff_records_biometric_uq').on(t.biometricEnrollmentNo),
    uniqueIndex('staff_records_user_uq').on(t.userId),
    index('staff_records_department_idx').on(t.departmentId),
    index('staff_records_designation_idx').on(t.designationId),
    index('staff_records_status_idx').on(t.status),
    index('staff_records_joining_date_idx').on(t.joiningDate),
    check('staff_records_status_ck', sql`${t.status} in ('active', 'inactive', 'separated')`),
    check('staff_records_separation_ck', sql`(${t.status} = 'separated') = (${t.separationDate} is not null)`),
    check('staff_records_full_name_len_ck', sql`char_length(${t.fullName}) between 1 and 150`),
    check('staff_records_employee_no_len_ck', sql`char_length(${t.employeeNo}) between 1 and 30`),
  ],
);

export const staffEducation = pgTable(
  'staff_education',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    examName: text('exam_name').notNull(),
    passingYear: smallint('passing_year'),
    subject: text('subject'),
    result: text('result'),
    board: text('board'),
  },
  (t) => [uniqueIndex('staff_education_staff_position_uq').on(t.staffId, t.position)],
);

export const staffEmergencyContacts = pgTable(
  'staff_emergency_contacts',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    name: text('name').notNull(),
    contact: text('contact').notNull(),
    relation: text('relation'),
  },
  (t) => [uniqueIndex('staff_emergency_contacts_staff_position_uq').on(t.staffId, t.position)],
);

export const staffFestivals = pgTable(
  'staff_festivals',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    festivalId: uuid('festival_id')
      .notNull()
      .references(() => festivals.id, { onDelete: 'restrict' }),
  },
  (t) => [
    primaryKey({ name: 'staff_festivals_pk', columns: [t.staffId, t.festivalId] }),
    index('staff_festivals_festival_idx').on(t.festivalId),
  ],
);

export const staffPhotos = pgTable(
  'staff_photos',
  {
    staffId: uuid('staff_id')
      .primaryKey()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    check('staff_photos_type_ck', sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp')`),
    check('staff_photos_size_ck', sql`octet_length(${t.data}) between 1 and 1048576`),
  ],
);

// Old HR.AttachedDocs and HR.DeptInchargeDocs.
export const staffDocuments = pgTable(
  'staff_documents',
  {
    id: uuid('id').primaryKey(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffRecords.id, { onDelete: 'cascade' }),
    category: text('category', { enum: ['general', 'incharge-appointment'] })
      .notNull()
      .default('general'),
    fileName: text('file_name').notNull(),
    contentType: text('content_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    data: bytea('data').notNull(),
    uploadedAt: tz('uploaded_at').notNull().defaultNow(),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('staff_documents_staff_idx').on(t.staffId),
    check(
      'staff_documents_type_ck',
      sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp', 'application/pdf')`,
    ),
    check(
      'staff_documents_size_ck',
      sql`${t.sizeBytes} = octet_length(${t.data}) and ${t.sizeBytes} between 1 and 5242880`,
    ),
    check('staff_documents_category_ck', sql`${t.category} in ('general', 'incharge-appointment')`),
  ],
);

// Old HR.DeptIncharges: who is (or was) in charge of a department.
export const departmentIncharges = pgTable(
  'department_incharges',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => hrDepartments.id, { onDelete: 'restrict' }),
    staffId: uuid('staff_id')
      .notNull()
      .references((): AnyPgColumn => staffRecords.id, { onDelete: 'restrict' }),
    appointmentDate: day('appointment_date').notNull(),
    appointmentRemarks: text('appointment_remarks'),
    releaseDate: day('release_date'),
    releaseRemarks: text('release_remarks'),
    ...timestamps,
  },
  (t) => [
    index('department_incharges_department_idx').on(t.departmentId),
    index('department_incharges_staff_idx').on(t.staffId),
    check('department_incharges_dates_ck', sql`${t.releaseDate} is null or ${t.releaseDate} >= ${t.appointmentDate}`),
  ],
);
