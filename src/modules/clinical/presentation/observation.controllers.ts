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
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  recordResponseShape,
  responseDto,
  updateSchema,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { CLINICAL_RECORDS } from '../application/emr.messages.js';
import {
  ListObservationsQuery,
  ObservationBoardQuery,
  RecordObservationCommand,
  StrikeObservationCommand,
} from '../application/observation.messages.js';
import { CONSCIOUSNESS } from '../domain/observation.js';

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time of day as HH:MM');
const roundFields = { name: z.string().trim().min(1).max(60), startTime: time, endTime: time, isActive: z.boolean() };
class CreateRoundDto extends createZodDto(z.strictObject({ ...roundFields, isActive: z.boolean().default(true) })) {}
class UpdateRoundDto extends createZodDto(updateSchema(roundFields)) {}
class RoundFilterDto extends createZodDto(z.object({ isActive: z.enum(['true', 'false']).optional() })) {}
class RoundResponseDto extends responseDto(recordResponseShape(roundFields)) {}

/** Old Follow Up Sheet Schedule: the wards' observation rounds (morning, noon, evening, night). */
export const ObservationRoundsController = createRecordController({
  tag: 'clinical',
  readPermission: 'emr:read',
  managePermission: 'rx:manage',
  className: 'ObservationRoundsController',
  path: 'clinical/observation-rounds',
  type: CLINICAL_RECORDS.observationRound,
  label: 'observation round',
  create: CreateRoundDto,
  update: UpdateRoundDto,
  response: RoundResponseDto,
  filter: RoundFilterDto,
});

const reading = (schema: z.ZodNumber) => schema.nullable().default(null);
class ObservationDto extends createZodDto(
  z.strictObject({
    /** Left out: now. Up to a day ago. */
    takenAt: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value))
      .nullable()
      .default(null),
    temperatureF: reading(z.number()),
    pulse: reading(z.number()),
    respRate: reading(z.number()),
    systolic: reading(z.number()),
    diastolic: reading(z.number()),
    spo2: reading(z.number()),
    painScore: reading(z.number()),
    bloodSugar: reading(z.number()),
    intakeMl: reading(z.number()),
    outputMl: reading(z.number()),
    consciousness: z.enum(CONSCIOUSNESS).nullable().default(null),
    note: z.string().max(1000).nullable().default(null),
  }),
) {}
class StrikeDto extends createZodDto(z.strictObject({ reason: z.string().max(300) })) {}
class AdmissionParamDto extends createZodDto(z.object({ admissionId: z.uuid() })) {}
class PeriodQueryDto extends createZodDto(z.object({ from: z.iso.date().optional(), to: z.iso.date().optional() })) {}
class BoardQueryDto extends createZodDto(z.object({ day: z.iso.date().optional() })) {}

const FLAGS = [
  'fever',
  'hypothermia',
  'tachycardia',
  'bradycardia',
  'tachypnoea',
  'bradypnoea',
  'low_spo2',
  'hypotension',
  'hypertension',
  'hypoglycaemia',
  'hyperglycaemia',
  'not_alert',
] as const;
const ROUND_STATES = ['done', 'due', 'missed', 'upcoming'] as const;
const vitalsShape = {
  temperatureF: z.number().nullable(),
  pulse: z.int().nullable(),
  respRate: z.int().nullable(),
  systolic: z.int().nullable(),
  diastolic: z.int().nullable(),
  spo2: z.int().nullable(),
  painScore: z.int().nullable(),
  bloodSugar: z.number().nullable(),
  intakeMl: z.int().nullable(),
  outputMl: z.int().nullable(),
  consciousness: z.enum(CONSCIOUSNESS).nullable(),
};
class RecordedResponseDto extends responseDto({ id: z.uuid(), flags: z.array(z.enum(FLAGS)) }) {}
class ObservationListResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      admissionId: z.uuid(),
      patientId: z.uuid(),
      takenAt: z.date(),
      roundId: z.uuid().nullable(),
      roundOn: z.string().nullable(),
      roundName: z.string().nullable(),
      ...vitalsShape,
      note: z.string().nullable(),
      recordedByName: z.string(),
      struckAt: z.date().nullable(),
      struckByName: z.string().nullable(),
      struckReason: z.string().nullable(),
      flags: z.array(z.enum(FLAGS)),
      createdAt: z.date(),
    }),
  ),
}) {}
class BoardResponseDto extends responseDto({
  day: z.string(),
  rounds: z.array(z.object({ id: z.uuid(), name: z.string(), startTime: z.string(), endTime: z.string() })),
  patients: z.array(
    z.object({
      admissionId: z.uuid(),
      admissionNumber: z.string(),
      patientName: z.string(),
      uhid: z.int(),
      wardName: z.string(),
      bedCode: z.string(),
      rounds: z.array(z.enum(ROUND_STATES).nullable()),
      lastAt: z.date().nullable(),
      lastFlags: z.array(z.enum(FLAGS)),
    }),
  ),
}) {}

/**
 * The inpatient observation (follow-up) sheet (step 15c): vital signs taken at the wards' rounds, flagged when a nurse
 * should tell the doctor, and the board of rounds done, due and missed.
 */
@ApiTags('clinical')
@ApiBearerAuth()
@Controller({ path: 'clinical', version: '1' })
export class ObservationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('observation-board')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: 'Admitted patients by ward and bed: each round of the day done, due, missed or to come' })
  @ApiOkResponse({ type: BoardResponseDto })
  board(@CurrentUser() actor: Actor, @Query() query: BoardQueryDto) {
    return this.queryBus.execute(new ObservationBoardQuery(actor, query.day ?? null));
  }

  @Get('admissions/:admissionId/observations')
  @RequirePermissions('emr:read')
  @ApiOperation({ summary: 'The observation sheet of a period (today when not given), struck entries shown' })
  @ApiOkResponse({ type: ObservationListResponseDto })
  async list(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Query() query: PeriodQueryDto) {
    return {
      items: await this.queryBus.execute(
        new ListObservationsQuery(actor, params.admissionId, query.from ?? null, query.to ?? null),
      ),
    };
  }

  @Post('admissions/:admissionId/observations')
  @RequirePermissions('emr:write')
  @ApiOperation({ summary: "Vital signs and observations taken now or up to a day ago; the round is the time's" })
  @ApiCreatedResponse({ type: RecordedResponseDto })
  record(@CurrentUser() actor: Actor, @Param() params: AdmissionParamDto, @Body() dto: ObservationDto) {
    const { takenAt, ...observation } = dto;
    return this.commandBus.execute(new RecordObservationCommand(actor, params.admissionId, observation, takenAt));
  }

  @Post('observations/:id/strike')
  @RequirePermissions('emr:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'An observation entered in error: struck through with the reason, kept' })
  @ApiNoContentResponse()
  async strike(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: StrikeDto) {
    await this.commandBus.execute(new StrikeObservationCommand(actor, params.id, dto.reason));
  }
}

export const OBSERVATION_CONTROLLERS = [ObservationRoundsController, ObservationController];
