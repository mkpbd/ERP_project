import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  ChangeOrderCommand,
  GetChartQuery,
  GetSummaryQuery,
  ListOrdersQuery,
  RecordDoseCommand,
  SignSummaryCommand,
  StartOrderCommand,
  WriteSummaryCommand,
} from '../application/treatment.messages.js';
import { ROUTES, SCHEDULES } from '../domain/treatment.js';

const version = z.int().min(1);
const moment = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const note = (max: number) => z.string().max(max).nullable().default(null);
const STATUSES = ['active', 'held', 'stopped'] as const;

class AdmissionParamDto extends createZodDto(z.object({ admissionId: z.uuid() })) {}
class OrderDto extends createZodDto(
  z.strictObject({
    productId: z.uuid().nullable().default(null),
    drugName: note(200),
    dose: z.string().max(200),
    route: z.enum(ROUTES),
    schedule: z.enum(SCHEDULES),
    times: z.array(z.string().max(5)).max(12).default([]),
    intervalHours: z.int().nullable().default(null),
    startAt: moment.nullable().default(null),
    note: note(500),
    doctorId: z.uuid().nullable().default(null),
  }),
) {}
class HoldDto extends createZodDto(z.strictObject({ version, reason: z.string().max(300) })) {}
class ResumeDto extends createZodDto(z.strictObject({ version })) {}
class DoseDto extends createZodDto(
  z.strictObject({
    dueAt: moment.nullable().default(null),
    outcome: z.enum(['given', 'missed']),
    givenAt: moment.nullable().default(null),
    reason: note(300),
  }),
) {}
class OrderQueryDto extends createZodDto(z.object({ status: z.enum(STATUSES).optional() })) {}
class ChartQueryDto extends createZodDto(z.object({ day: z.iso.date().optional() })) {}
class SummaryDto extends createZodDto(
  z.strictObject({
    version: version.nullable().default(null),
    doctorId: z.uuid().nullable().default(null),
    diagnosis: note(1000),
    course: note(8000),
    conditionOnDischarge: note(500),
    treatment: z
      .array(
        z.strictObject({
          productId: z.uuid().nullable().default(null),
          name: z.string().max(200),
          dose: z.string().max(300),
          duration: note(100),
        }),
      )
      .max(40)
      .default([]),
    diet: note(1000),
    advice: note(2000),
    followUpOn: z.iso.date().nullable().default(null),
    followUpNote: note(300),
  }),
) {}

const eventShape = z.object({
  event: z.enum(['start', 'hold', 'resume', 'stop']),
  at: z.date(),
  note: z.string().nullable(),
  by: z.uuid(),
  byName: z.string(),
});
const orderShape = {
  id: z.uuid(),
  admissionId: z.uuid(),
  patientId: z.uuid(),
  productId: z.uuid().nullable(),
  drugName: z.string(),
  dose: z.string(),
  route: z.enum(ROUTES),
  schedule: z.enum(SCHEDULES),
  times: z.array(z.string()),
  intervalHours: z.int().nullable(),
  startAt: z.date(),
  note: z.string().nullable(),
  status: z.enum(STATUSES),
  doctorId: z.uuid(),
  doctorName: z.string(),
  orderedBy: z.uuid(),
  events: z.array(eventShape),
  version: z.int(),
  updatedAt: z.date(),
};
const doseShape = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  admissionId: z.uuid(),
  dueAt: z.date().nullable(),
  outcome: z.enum(['given', 'missed']),
  givenAt: z.date().nullable(),
  reason: z.string().nullable(),
  recordedBy: z.uuid(),
  createdAt: z.date(),
});

class IdResponseDto extends responseDto({ id: z.uuid() }) {}
class VersionResponseDto extends responseDto({ version: z.int() }) {}
class OrderListResponseDto extends responseDto({ items: z.array(z.object(orderShape)) }) {}
class ChartResponseDto extends responseDto({
  day: z.string(),
  admission: z.object({ id: z.uuid(), number: z.string(), patientName: z.string(), status: z.string() }),
  orders: z.array(
    z.object({
      ...orderShape,
      slots: z.array(
        z.object({
          dueAt: z.date(),
          state: z.enum(['given', 'missed', 'due', 'overdue']),
          record: doseShape.nullable(),
        }),
      ),
      doses: z.array(doseShape),
    }),
  ),
}) {}
class SummaryResponseDto extends responseDto({
  id: z.uuid(),
  admissionId: z.uuid(),
  patientId: z.uuid(),
  doctorId: z.uuid(),
  doctorName: z.string(),
  diagnosis: z.string().nullable(),
  course: z.string().nullable(),
  conditionOnDischarge: z.string().nullable(),
  treatment: z.array(
    z.object({ productId: z.uuid().nullable(), name: z.string(), dose: z.string(), duration: z.string().nullable() }),
  ),
  diet: z.string().nullable(),
  advice: z.string().nullable(),
  followUpOn: z.string().nullable(),
  followUpNote: z.string().nullable(),
  status: z.enum(['draft', 'signed']),
  signedBy: z.uuid().nullable(),
  signedAt: z.date().nullable(),
  writtenBy: z.uuid(),
  version: z.int(),
  createdAt: z.date(),
  updatedAt: z.date(),
}) {}

@ApiTags('clinical')
@ApiBearerAuth()
@Controller({ path: 'clinical', version: '1' })
export class TreatmentController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('admissions/:admissionId/orders')
  @RequirePermissions('emr:read')
  @ApiOkResponse({ type: OrderListResponseDto })
  async orders(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Query() query: OrderQueryDto) {
    return { items: await this.queryBus.execute(new ListOrdersQuery(actor, params.admissionId, query.status)) };
  }

  @Post('admissions/:admissionId/orders')
  @RequirePermissions('emr:order')
  @ApiOperation({
    summary: 'A medicine with dose and route: at set times each day, every N hours, once, or when needed (prn)',
  })
  @ApiCreatedResponse({ type: IdResponseDto })
  order(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: OrderDto) {
    return this.commandBus.execute(new StartOrderCommand(actor, params.admissionId, dto));
  }

  @Post('orders/:id/hold')
  @RequirePermissions('emr:order')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VersionResponseDto })
  hold(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: HoldDto) {
    return this.commandBus.execute(new ChangeOrderCommand(actor, params.id, dto.version, 'hold', dto.reason));
  }

  @Post('orders/:id/resume')
  @RequirePermissions('emr:order')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VersionResponseDto })
  resume(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ResumeDto) {
    return this.commandBus.execute(new ChangeOrderCommand(actor, params.id, dto.version, 'resume', null));
  }

  @Post('orders/:id/stop')
  @RequirePermissions('emr:order')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VersionResponseDto })
  stop(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: HoldDto) {
    return this.commandBus.execute(new ChangeOrderCommand(actor, params.id, dto.version, 'stop', dto.reason));
  }

  @Get('admissions/:admissionId/chart')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: "The medication chart of a day (today when not given): due doses' states, prn doses" })
  @ApiOkResponse({ type: ChartResponseDto })
  chart(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Query() query: ChartQueryDto) {
    return this.queryBus.execute(new GetChartQuery(actor, params.admissionId, query.day ?? null));
  }

  @Post('orders/:id/doses')
  @RequirePermissions('emr:write')
  @ApiOperation({ summary: 'A due dose given or missed (with why); a prn dose when given' })
  @ApiCreatedResponse({ type: IdResponseDto })
  dose(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DoseDto) {
    return this.commandBus.execute(new RecordDoseCommand(actor, params.id, dto));
  }

  @Get('admissions/:admissionId/discharge-summary')
  @RequirePermissions('emr:read')
  @ApiOkResponse({ type: SummaryResponseDto })
  summary(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto) {
    return this.queryBus.execute(new GetSummaryQuery(actor, params.admissionId));
  }

  @Put('admissions/:admissionId/discharge-summary')
  @RequirePermissions('emr:order')
  @ApiOperation({ summary: 'The draft (version null for the first): diagnosis, course, treatment, diet, advice' })
  @ApiOkResponse({ type: VersionResponseDto })
  writeSummary(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: SummaryDto) {
    const { version: summaryVersion, doctorId, ...content } = dto;
    return this.commandBus.execute(
      new WriteSummaryCommand(actor, params.admissionId, summaryVersion, doctorId, content),
    );
  }

  @Post('admissions/:admissionId/discharge-summary/sign')
  @RequirePermissions('emr:order')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: VersionResponseDto })
  sign(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: ResumeDto) {
    return this.commandBus.execute(new SignSummaryCommand(actor, params.admissionId, dto.version, 'sign'));
  }

  @Post('admissions/:admissionId/discharge-summary/reopen')
  @RequirePermissions('emr:order')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Back to a draft while the patient is in' })
  @ApiOkResponse({ type: VersionResponseDto })
  reopen(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: ResumeDto) {
    return this.commandBus.execute(new SignSummaryCommand(actor, params.admissionId, dto.version, 'reopen'));
  }
}
