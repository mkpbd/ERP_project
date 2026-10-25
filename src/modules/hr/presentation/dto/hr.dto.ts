import { z } from 'zod';
import {
  isoDate,
  pageMetaShape,
  paginationShape,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';
import { DOCUMENT_CATEGORIES } from '../../domain/staff-file.js';
import { BLOOD_GROUPS, SEXES } from '../../domain/staff-member.js';

const name = z.string().trim().min(1).max(100);
const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const money = z.number().min(0).max(100_000_000);

// ---- masters

const divisionFields = { name };
export class CreateHrDivisionDto extends createZodDto(z.strictObject(divisionFields)) {}
export class UpdateHrDivisionDto extends createZodDto(updateSchema(divisionFields)) {}
export class HrDivisionResponseDto extends responseDto(recordResponseShape({ name: z.string() })) {}

const departmentFields = { divisionId: z.uuid(), name };
export class CreateHrDepartmentDto extends createZodDto(z.strictObject(departmentFields)) {}
export class UpdateHrDepartmentDto extends createZodDto(updateSchema(departmentFields)) {}
export class DivisionFilterDto extends createZodDto(z.object({ divisionId: z.uuid().optional() })) {}
export class HrDepartmentResponseDto extends responseDto(
  recordResponseShape({ divisionId: z.uuid(), name: z.string() }),
) {}

const subDepartmentFields = { departmentId: z.uuid(), name };
export class CreateHrSubDepartmentDto extends createZodDto(z.strictObject(subDepartmentFields)) {}
export class UpdateHrSubDepartmentDto extends createZodDto(updateSchema(subDepartmentFields)) {}
export class HrDepartmentFilterDto extends createZodDto(z.object({ departmentId: z.uuid().optional() })) {}
export class HrSubDepartmentResponseDto extends responseDto(
  recordResponseShape({ departmentId: z.uuid(), name: z.string() }),
) {}

const designationFields = { name, joiningSalary: money, incrementAfterConfirmation: money };
export class CreateDesignationDto extends createZodDto(
  z.strictObject({
    ...designationFields,
    joiningSalary: money.default(0),
    incrementAfterConfirmation: money.default(0),
  }),
) {}
export class UpdateDesignationDto extends createZodDto(updateSchema(designationFields)) {}
export class DesignationResponseDto extends responseDto(
  recordResponseShape({ name: z.string(), joiningSalary: z.number(), incrementAfterConfirmation: z.number() }),
) {}

const festivalFields = { name };
export class CreateFestivalDto extends createZodDto(z.strictObject(festivalFields)) {}
export class UpdateFestivalDto extends createZodDto(updateSchema(festivalFields)) {}
export class FestivalResponseDto extends responseDto(recordResponseShape({ name: z.string() })) {}

const holidayFields = {
  holidayDate: day,
  name: z.string().trim().min(1).max(200),
  category: text(100),
  description: text(500),
};
export class CreateGovtHolidayDto extends createZodDto(
  z.strictObject({
    ...holidayFields,
    category: holidayFields.category.default(null),
    description: holidayFields.description.default(null),
  }),
) {}
export class UpdateGovtHolidayDto extends createZodDto(updateSchema(holidayFields)) {}
export class GovtHolidayFilterDto extends createZodDto(z.object({ from: day.optional(), to: day.optional() })) {}
export class GovtHolidayResponseDto extends responseDto(
  recordResponseShape({
    holidayDate: z.string(),
    name: z.string(),
    category: z.string().nullable(),
    description: z.string().nullable(),
  }),
) {}

const inchargeFields = {
  departmentId: z.uuid(),
  staffId: z.uuid(),
  appointmentDate: day,
  appointmentRemarks: text(500),
  releaseDate: day.nullable(),
  releaseRemarks: text(500),
};
export class CreateDepartmentInchargeDto extends createZodDto(
  z.strictObject({
    ...inchargeFields,
    appointmentRemarks: inchargeFields.appointmentRemarks.default(null),
    releaseDate: inchargeFields.releaseDate.default(null),
    releaseRemarks: inchargeFields.releaseRemarks.default(null),
  }),
) {}
export class UpdateDepartmentInchargeDto extends createZodDto(updateSchema(inchargeFields)) {}
export class DepartmentInchargeFilterDto extends createZodDto(
  z.object({ departmentId: z.uuid().optional(), staffId: z.uuid().optional() }),
) {}
export class DepartmentInchargeResponseDto extends responseDto(
  recordResponseShape({
    departmentId: z.uuid(),
    staffId: z.uuid(),
    appointmentDate: z.string(),
    appointmentRemarks: z.string().nullable(),
    releaseDate: z.string().nullable(),
    releaseRemarks: z.string().nullable(),
  }),
) {}

// ---- staff

const profileFields = {
  employeeNo: z.string().trim().min(1).max(30),
  fullName: z.string().trim().min(1).max(150),
  firstName: text(60),
  middleName: text(60),
  lastName: text(60),
  fatherName: text(150),
  motherName: text(150),
  dateOfBirth: day.nullable(),
  sex: z.enum(SEXES).nullable(),
  maritalStatus: text(30),
  religion: text(30),
  bloodGroup: z.enum(BLOOD_GROUPS).nullable(),
  nationalityCountryId: z.uuid().nullable(),
  nationalityOther: text(100),
  nationalIdOrPassport: text(50),
  tinNo: text(30),
  mobileNo: text(30),
  officialMobileNo: text(30),
  email: z.email().max(254).nullable(),
  guardianContact: text(50),
  presentAddress: text(500),
  permanentAddress: text(500),
  divisionId: z.uuid().nullable(),
  departmentId: z.uuid(),
  subDepartmentId: z.uuid(),
  designationId: z.uuid(),
  joiningDesignationId: z.uuid().nullable(),
  joiningDate: day,
  probationEndDate: day.nullable(),
  confirmationDate: day.nullable(),
  employeeCategory: z.int().min(0).max(32_767).nullable(),
  jobLocation: text(100),
  serviceNature: z.string().trim().min(1).max(50),
  salaryStatus: z.string().trim().min(1).max(50),
  paymentMode: text(50),
  bankAccountNo: text(50),
  biometricEnrollmentNo: z.int().min(0).max(2_147_483_647).nullable(),
  isHeadOfDepartment: z.boolean(),
  workingTime: text(100),
  intervalTime: text(100),
  weeklyHoliday: text(100),
  shiftAndRelay: text(100),
  changeGroupDescription: text(500),
  nursingCouncilNo: text(30),
  medicalCouncilNo: text(30),
  remarks: text(1000),
  userId: z.uuid().nullable(),
};

/** Required on hire: identity, placement and terms. Everything else defaults to empty. */
const REQUIRED = [
  'employeeNo',
  'fullName',
  'departmentId',
  'subDepartmentId',
  'designationId',
  'joiningDate',
  'serviceNature',
  'salaryStatus',
] as const;

const hireShape = Object.fromEntries(
  Object.entries(profileFields).map(([key, schema]) => [
    key,
    (REQUIRED as readonly string[]).includes(key)
      ? schema
      : key === 'isHeadOfDepartment'
        ? z.boolean().default(false)
        : (schema as z.ZodNullable<z.ZodType>).default(null),
  ]),
) as unknown as typeof profileFields;

export class HireStaffDto extends createZodDto(z.strictObject(hireShape)) {}
export class UpdateStaffDto extends createZodDto(updateSchema(profileFields)) {}

export class StaffListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    search: z.string().trim().min(1).max(100).optional(),
    status: z.enum(['active', 'inactive', 'separated']).optional(),
    departmentId: z.uuid().optional(),
    designationId: z.uuid().optional(),
    joinedFrom: day.optional(),
    joinedTo: day.optional(),
  }),
) {}

export class DeactivateStaffDto extends createZodDto(z.strictObject({ reason: z.string().trim().min(1).max(500) })) {}
export class SeparateStaffDto extends createZodDto(
  z.strictObject({ separationDate: day, reason: z.string().trim().min(1).max(500) }),
) {}

const educationEntry = z.strictObject({
  examName: z.string().trim().min(1).max(100),
  passingYear: z.int().min(1900).max(2200).nullable().default(null),
  subject: text(100).default(null),
  result: text(30).default(null),
  board: text(150).default(null),
});
export class ReplaceEducationDto extends createZodDto(z.strictObject({ entries: z.array(educationEntry).max(30) })) {}

const contactEntry = z.strictObject({
  name: z.string().trim().min(1).max(150),
  contact: z.string().trim().min(1).max(50),
  relation: text(50).default(null),
});
export class ReplaceEmergencyContactsDto extends createZodDto(
  z.strictObject({ entries: z.array(contactEntry).max(10) }),
) {}

export class ReplaceFestivalsDto extends createZodDto(z.strictObject({ festivalIds: z.array(z.uuid()).max(50) })) {}

export class StaffDocumentQueryDto extends createZodDto(
  z.object({
    fileName: z.string().trim().min(1).max(150),
    category: z.enum(DOCUMENT_CATEGORIES).default('general'),
  }),
) {}
export class StaffDocumentParamDto extends createZodDto(z.strictObject({ id: z.uuid(), documentId: z.uuid() })) {}

const summaryShape = {
  id: z.uuid(),
  employeeNo: z.string(),
  fullName: z.string(),
  departmentId: z.uuid(),
  departmentName: z.string(),
  subDepartmentName: z.string(),
  designationId: z.uuid(),
  designationName: z.string(),
  mobileNo: z.string().nullable(),
  joiningDate: z.string(),
  status: z.enum(['active', 'inactive', 'separated']),
};
export class StaffSummaryResponseDto extends responseDto(summaryShape) {}
export class StaffPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}

export class StaffDetailResponseDto extends responseDto({
  ...profileFields,
  id: z.uuid(),
  email: z.string().nullable(),
  status: z.enum(['active', 'inactive', 'separated']),
  statusReason: z.string().nullable(),
  separationDate: z.string().nullable(),
  departmentName: z.string(),
  subDepartmentName: z.string(),
  designationName: z.string(),
  hasPhoto: z.boolean(),
  education: z.array(
    z.object({
      examName: z.string(),
      passingYear: z.int().nullable(),
      subject: z.string().nullable(),
      result: z.string().nullable(),
      board: z.string().nullable(),
    }),
  ),
  emergencyContacts: z.array(z.object({ name: z.string(), contact: z.string(), relation: z.string().nullable() })),
  festivalIds: z.array(z.uuid()),
  documents: z.array(
    z.object({
      id: z.uuid(),
      category: z.enum(DOCUMENT_CATEGORIES),
      fileName: z.string(),
      contentType: z.string(),
      sizeBytes: z.int(),
      uploadedAt: isoDate,
    }),
  ),
  createdAt: isoDate,
  updatedAt: isoDate,
}) {}

export class CreatedIdResponseDto extends responseDto({ id: z.uuid() }) {}
