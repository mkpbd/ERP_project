import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  BookAppointmentCommand,
  ChangeAppointmentCommand,
  GetAppointmentQuery,
  GetDoctorDayQuery,
  ListAppointmentsQuery,
} from '../application/appointment.messages.js';
import { APPOINTMENT_STATUSES, VISIT_TYPES } from '../domain/appointment.js';

const day = z.iso.date();
const version = z.int().min(1);

class BookAppointmentDto extends createZodDto(
  z.strictObject({
    doctorId: z.uuid(),
    appointmentDate: day,
    visitType: z.enum(VISIT_TYPES).default('new'),
    serial: z.int().min(1).max(500).nullable().default(null),
    patientId: z.uuid().nullable().default(null),
    patientName: z.string().trim().min(1).max(150).nullable().default(null),
    mobileNo: z.string().trim().min(1).max(20).nullable().default(null),
    referredById: z.uuid().nullable().default(null),
    remarks: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class AppointmentVersionDto extends createZodDto(z.strictObject({ version })) {}
class CancelAppointmentDto extends createZodDto(
  z.strictObject({ version, reason: z.string().trim().min(1).max(300) }),
) {}
class AttachPatientDto extends createZodDto(z.strictObject({ version, patientId: z.uuid() })) {}
class AppointmentListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    doctorId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  }),
) {}
class DoctorDayQueryDto extends createZodDto(z.object({ date: day })) {}

const appointmentShape = {
  id: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  roomNo: z.string().nullable(),
  appointmentDate: z.string(),
  serial: z.int(),
  slotTime: z.string(),
  visitType: z.enum(VISIT_TYPES),
  patientId: z.uuid().nullable(),
  uhid: z.int().nullable(),
  patientName: z.string(),
  mobileNo: z.string(),
  referredById: z.uuid().nullable(),
  referredByName: z.string().nullable(),
  fee: z.number(),
  status: z.enum(APPOINTMENT_STATUSES),
  statusReason: z.string().nullable(),
  remarks: z.string().nullable(),
  bookedBy: z.uuid().nullable(),
  createdAt: z.date(),
  version: z.int(),
};
class BookedAppointmentResponseDto extends responseDto({
  id: z.uuid(),
  serial: z.int(),
  slotTime: z.string(),
  fee: z.number(),
}) {}
class AppointmentResponseDto extends responseDto(appointmentShape) {}
class AppointmentPageResponseDto extends responseDto({
  items: z.array(z.object(appointmentShape)),
  ...pageMetaShape,
}) {}
class DoctorDayResponseDto extends responseDto({
  doctorId: z.uuid(),
  doctorName: z.string(),
  roomNo: z.string().nullable(),
  date: z.string(),
  sitting: z.object({ startTime: z.string(), slotMinutes: z.int(), maxPatients: z.int() }).nullable(),
  closed: z.object({ reason: z.string().nullable() }).nullable(),
  slots: z.array(z.object({ serial: z.int(), time: z.string(), appointment: z.object(appointmentShape).nullable() })),
  others: z.array(z.object(appointmentShape)),
}) {}

@ApiTags('opd')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class AppointmentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('doctors/:id/day')
  @RequirePermissions('opd:read')
  @ApiOperation({ summary: "A doctor's sitting on a day: every serial with its time, booked or free" })
  @ApiOkResponse({ type: DoctorDayResponseDto })
  doctorDay(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Query() query: DoctorDayQueryDto) {
    return this.queryBus.execute(new GetDoctorDayQuery(actor, params.id, query.date));
  }

  @Get('appointments')
  @RequirePermissions('opd:read')
  @ApiOkResponse({ type: AppointmentPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: AppointmentListQueryDto) {
    return this.queryBus.execute(new ListAppointmentsQuery(actor, query));
  }

  @Get('appointments/:id')
  @RequirePermissions('opd:read')
  @ApiOkResponse({ type: AppointmentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetAppointmentQuery(actor, params.id));
  }

  @Post('appointments')
  @RequirePermissions('opd:book')
  @ApiOperation({
    summary: 'Book a serial with a doctor (a registered patient, or a name and mobile); the first free serial if none',
  })
  @ApiCreatedResponse({ type: BookedAppointmentResponseDto })
  book(@CurrentUser() actor: Actor, @Body() dto: BookAppointmentDto) {
    return this.commandBus.execute(new BookAppointmentCommand(actor, dto));
  }

  @Post('appointments/:id/arrive')
  @RequirePermissions('opd:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The patient came, on the day (a registered patient)' })
  @ApiNoContentResponse()
  async arrive(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AppointmentVersionDto) {
    await this.commandBus.execute(new ChangeAppointmentCommand(actor, params.id, dto.version, { kind: 'arrive' }));
  }

  @Post('appointments/:id/no-show')
  @RequirePermissions('opd:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async noShow(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AppointmentVersionDto) {
    await this.commandBus.execute(new ChangeAppointmentCommand(actor, params.id, dto.version, { kind: 'no_show' }));
  }

  @Post('appointments/:id/cancel')
  @RequirePermissions('opd:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel with a reason; the serial is free again' })
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelAppointmentDto) {
    await this.commandBus.execute(
      new ChangeAppointmentCommand(actor, params.id, dto.version, { kind: 'cancel', reason: dto.reason }),
    );
  }

  @Post('appointments/:id/patient')
  @RequirePermissions('opd:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Attach the patient registered after booking' })
  @ApiNoContentResponse()
  async attach(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AttachPatientDto) {
    await this.commandBus.execute(
      new ChangeAppointmentCommand(actor, params.id, dto.version, { kind: 'attach', patientId: dto.patientId }),
    );
  }
}

export const APPOINTMENT_CONTROLLERS = [AppointmentsController];
