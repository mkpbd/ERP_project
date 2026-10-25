import { z } from 'zod';
import {
  isoDate,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const text = (max: number) => z.string().trim().max(max).nullable();
const STATUSES = ['received', 'shortlisted', 'interviewed', 'selected', 'rejected', 'withdrawn'] as const;
const mobile = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 -]{5,19}$/, 'Expected a phone number (digits, spaces or dashes, optional leading +)');

const circularFields = {
  circularNo: z.string().trim().min(1).max(50),
  title: z.string().trim().min(1).max(200),
  departmentId: z.uuid().nullable(),
  designationId: z.uuid().nullable(),
  vacancies: z.int().min(1).max(10_000).nullable(),
  publishedOn: day.nullable(),
  closesOn: day.nullable(),
  description: text(4000),
};
const datesInOrder = (value: { publishedOn?: string | null; closesOn?: string | null }) =>
  !value.publishedOn || !value.closesOn || value.closesOn >= value.publishedOn;

export class CreateJobCircularDto extends createZodDto(
  z
    .strictObject({
      ...circularFields,
      departmentId: circularFields.departmentId.default(null),
      designationId: circularFields.designationId.default(null),
      vacancies: circularFields.vacancies.default(null),
      publishedOn: circularFields.publishedOn.default(null),
      closesOn: circularFields.closesOn.default(null),
      description: circularFields.description.default(null),
    })
    .refine(datesInOrder, { message: 'The closing date is before the publishing date', path: ['closesOn'] }),
) {}
export class UpdateJobCircularDto extends createZodDto(updateSchema(circularFields)) {}
export class JobCircularFilterDto extends createZodDto(
  z.object({
    departmentId: z.uuid().optional(),
    designationId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
export class JobCircularResponseDto extends responseDto(
  recordResponseShape({
    ...circularFields,
    publishedOn: z.string().nullable(),
    closesOn: z.string().nullable(),
    description: z.string().nullable(),
  }),
) {}

const applicationFields = {
  circularId: z.uuid(),
  appliedFor: text(200),
  applicantName: z.string().trim().min(1).max(150),
  mobileNo: mobile,
  email: z.email().max(254).nullable(),
  status: z.enum(STATUSES),
  remarks: text(1000),
};
export class CreateJobApplicationDto extends createZodDto(
  z.strictObject({
    ...applicationFields,
    appliedFor: applicationFields.appliedFor.default(null),
    email: applicationFields.email.default(null),
    status: applicationFields.status.default('received'),
    remarks: applicationFields.remarks.default(null),
  }),
) {}
export class UpdateJobApplicationDto extends createZodDto(updateSchema(applicationFields)) {}
export class JobApplicationFilterDto extends createZodDto(
  z.object({ circularId: z.uuid().optional(), status: z.enum(STATUSES).optional(), mobileNo: mobile.optional() }),
) {}
export class JobApplicationResponseDto extends responseDto(
  recordResponseShape({
    ...applicationFields,
    appliedFor: z.string().nullable(),
    mobileNo: z.string().nullable(),
    email: z.string().nullable(),
    remarks: z.string().nullable(),
  }),
) {}

export class ApplicationFileParamDto extends createZodDto(z.strictObject({ id: z.uuid(), fileId: z.uuid() })) {}
export class ApplicationFileQueryDto extends createZodDto(z.object({ fileName: z.string().trim().min(1).max(150) })) {}
export class ApplicationFileResponseDto extends responseDto({
  id: z.uuid(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.int(),
  uploadedAt: isoDate,
  uploadedBy: z.uuid().nullable(),
}) {}
