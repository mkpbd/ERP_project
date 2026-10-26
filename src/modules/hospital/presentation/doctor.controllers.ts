import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../shared/presentation/zod/common.schemas.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { HOSPITAL_RECORDS as R } from '../application/hospital.constants.js';

const name = (max = 150) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const fee = z.number().min(0).max(10_000_000).multipleOf(0.01);
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();

/** Create (nullable fields default to null, others to the defaults given), update (all optional) and response. */
function shapes<T extends z.ZodRawShape>(
  fields: T,
  nullable: (keyof T)[] = [],
  defaults: Partial<Record<keyof T, unknown>> = {},
) {
  const create = Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [
      key,
      nullable.includes(key)
        ? (schema as z.ZodNullable<z.ZodTypeAny>).default(null)
        : key in defaults
          ? (schema as z.ZodTypeAny).default(defaults[key])
          : schema,
    ]),
  ) as T;
  return { create: z.strictObject(create), update: updateSchema(fields), response: recordResponseShape(fields) };
}

const opd = { tag: 'opd', readPermission: 'opd:read', managePermission: 'opd:manage' } as const;

const speciality = shapes({ name: name(100) });
class CreateSpecialityDto extends createZodDto(speciality.create) {}
class UpdateSpecialityDto extends createZodDto(speciality.update) {}
class SpecialityFilterDto extends createZodDto(z.object({ q: search })) {}
class SpecialityResponseDto extends responseDto(speciality.response) {}

const doctor = shapes(
  {
    code: z.string().trim().min(1).max(20).nullable(),
    name: name(150),
    degrees: optionalText(500),
    specialityId: z.uuid().nullable(),
    phone: optionalText(30),
    roomNo: optionalText(20),
    isConsultant: z.boolean(),
    firstVisitFee: fee,
    newVisitFee: fee,
    followUpFee: fee,
    reportFee: fee,
    userId: z.uuid().nullable(),
    isActive: z.boolean(),
  },
  ['code', 'degrees', 'specialityId', 'phone', 'roomNo', 'userId'],
  { isConsultant: false, firstVisitFee: 0, newVisitFee: 0, followUpFee: 0, reportFee: 0, isActive: true },
);
class CreateDoctorDto extends createZodDto(doctor.create) {}
class UpdateDoctorDto extends createZodDto(doctor.update) {}
class DoctorFilterDto extends createZodDto(
  z.object({
    q: search,
    specialityId: z.uuid().optional(),
    isConsultant: flag,
    isActive: flag,
    userId: z.uuid().optional(),
  }),
) {}
class DoctorResponseDto extends responseDto(doctor.response) {}

const schedule = shapes(
  {
    doctorId: z.uuid(),
    dayOfWeek: z.int().min(0).max(6),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected a time such as 17:30'),
    slotMinutes: z.int().min(1).max(240),
    maxPatients: z.int().min(1).max(500),
    isActive: z.boolean(),
  },
  [],
  { isActive: true },
);
class CreateScheduleDto extends createZodDto(schedule.create) {}
class UpdateScheduleDto extends createZodDto(schedule.update) {}
class ScheduleFilterDto extends createZodDto(
  z.object({ doctorId: z.uuid().optional(), dayOfWeek: z.coerce.number().int().min(0).max(6).optional() }),
) {}
class ScheduleResponseDto extends responseDto(schedule.response) {}

const closure = shapes({ doctorId: z.uuid(), closedOn: z.iso.date(), reason: optionalText(200) }, ['reason']);
class CreateClosureDto extends createZodDto(closure.create) {}
class UpdateClosureDto extends createZodDto(closure.update) {}
class ClosureFilterDto extends createZodDto(
  z.object({ doctorId: z.uuid().optional(), from: z.iso.date().optional(), to: z.iso.date().optional() }),
) {}
class ClosureResponseDto extends responseDto(closure.response) {}

export const SpecialitiesController = createRecordController({
  ...opd,
  className: 'SpecialitiesController',
  path: 'hospital/specialities',
  type: R.speciality,
  label: 'speciality',
  create: CreateSpecialityDto,
  update: UpdateSpecialityDto,
  response: SpecialityResponseDto,
  filter: SpecialityFilterDto,
});

/** Old /marketing/doctors: consultants and referring doctors, with the fee per visit type. */
export const DoctorsController = createRecordController({
  ...opd,
  className: 'DoctorsController',
  path: 'hospital/doctors',
  type: R.doctor,
  label: 'doctor',
  create: CreateDoctorDto,
  update: UpdateDoctorDto,
  response: DoctorResponseDto,
  filter: DoctorFilterDto,
});

/** Old /opd/doctor-chamber-schedule: the weekday sittings. */
export const DoctorSchedulesController = createRecordController({
  ...opd,
  className: 'DoctorSchedulesController',
  path: 'hospital/doctor-schedules',
  type: R.doctorSchedule,
  label: 'doctor schedule',
  create: CreateScheduleDto,
  update: UpdateScheduleDto,
  response: ScheduleResponseDto,
  filter: ScheduleFilterDto,
});

export const DoctorClosuresController = createRecordController({
  ...opd,
  className: 'DoctorClosuresController',
  path: 'hospital/doctor-closures',
  type: R.doctorClosure,
  label: 'doctor closure',
  create: CreateClosureDto,
  update: UpdateClosureDto,
  response: ClosureResponseDto,
  filter: ClosureFilterDto,
});

export const DOCTOR_CONTROLLERS = [
  SpecialitiesController,
  DoctorsController,
  DoctorSchedulesController,
  DoctorClosuresController,
];
