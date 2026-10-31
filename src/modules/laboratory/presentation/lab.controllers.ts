import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put, Query } from '@nestjs/common';
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
  ChangeResultCommand,
  ChangeSampleCommand,
  CollectSampleCommand,
  FindOrderQuery,
  GetResultQuery,
  GetSampleQuery,
  GetTestFormQuery,
  GetTestParametersQuery,
  ListResultsQuery,
  ListSamplesQuery,
  SearchLabTestsQuery,
  SetTestFormCommand,
  SetTestParametersCommand,
} from '../application/lab.messages.js';
import { MAX_ANTIBIOTICS, MAX_NARRATIVE, MAX_ORGANISMS, REPORT_FORMS, SENSITIVITIES } from '../domain/culture.js';

const version = z.int().min(1);
const day = z.iso.date();
const measure = z.number().min(-1_000_000_000).max(1_000_000_000);
const SAMPLE_STATUSES = ['collected', 'received', 'rejected'] as const;
const RESULT_STATUSES = ['pending', 'entered', 'verified', 'delivered', 'rejected'] as const;

const rangeShape = {
  /** Null: either sex. */
  sex: z.enum(['male', 'female']).nullable(),
  minAgeDays: z.int().min(0).max(60_000),
  maxAgeDays: z.int().min(0).max(60_000).nullable(),
  low: measure.nullable(),
  high: measure.nullable(),
  normalText: z.string().trim().max(100).nullable(),
};
const parameterShape = {
  name: z.string().trim().min(1).max(100),
  unit: z.string().trim().max(30).nullable(),
  method: z.string().trim().max(100).nullable(),
  kind: z.enum(['numeric', 'text']),
  decimals: z.int().min(0).max(4),
};
class TestParametersDto extends createZodDto(
  z.strictObject({
    parameters: z
      .array(
        z.strictObject({
          ...parameterShape,
          unit: parameterShape.unit.default(null),
          method: parameterShape.method.default(null),
          kind: parameterShape.kind.default('numeric'),
          decimals: parameterShape.decimals.default(0),
          ranges: z
            .array(
              z.strictObject({
                ...rangeShape,
                sex: rangeShape.sex.default(null),
                minAgeDays: rangeShape.minAgeDays.default(0),
                maxAgeDays: rangeShape.maxAgeDays.default(null),
                low: rangeShape.low.default(null),
                high: rangeShape.high.default(null),
                normalText: rangeShape.normalText.default(null),
              }),
            )
            .max(20)
            .default([]),
        }),
      )
      .min(1)
      .max(60),
  }),
) {}
class TestParametersResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), ...parameterShape, ranges: z.array(z.object(rangeShape)) })),
}) {}
class TestParamDto extends createZodDto(z.object({ testId: z.uuid() })) {}
class CollectDto extends createZodDto(z.strictObject({ billId: z.uuid(), departmentId: z.uuid() })) {}
class VersionDto extends createZodDto(z.strictObject({ version })) {}
class RejectDto extends createZodDto(z.strictObject({ version, reason: z.string().trim().min(1).max(300) })) {}
class DeliverDto extends createZodDto(z.strictObject({ version, to: z.string().trim().min(1).max(150) })) {}
class EnterDto extends createZodDto(
  z.strictObject({
    version,
    values: z
      .array(z.strictObject({ parameterId: z.uuid(), value: z.string().trim().max(200).nullable() }))
      .min(1)
      .max(60),
    comment: z.string().trim().max(1000).nullable().default(null),
  }),
) {}
const comment = z.string().trim().max(1000).nullable().default(null);
const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);
class TestFormDto extends createZodDto(z.strictObject({ form: z.enum(REPORT_FORMS) })) {}
class TestFormResponseDto extends responseDto({ form: z.enum(REPORT_FORMS) }) {}
class TestSearchDto extends createZodDto(z.object({ q: z.string().trim().min(1).max(100) })) {}
class TestSearchResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), name: z.string(), form: z.enum(REPORT_FORMS) })),
}) {}
class OrderNumberDto extends createZodDto(z.object({ number: z.string().trim().min(1).max(40) })) {}
class CollectableOrderResponseDto extends responseDto({
  billId: z.uuid(),
  billNumber: z.string(),
  billedAt: z.date(),
  patientName: z.string(),
  uhid: z.int(),
  sex: z.string(),
  dateOfBirth: z.string(),
  departments: z.array(
    z.object({
      departmentId: z.uuid(),
      departmentName: z.string(),
      tests: z.array(z.object({ line: z.int(), testName: z.string(), inWork: z.boolean() })),
    }),
  ),
}) {}
class EnterCultureDto extends createZodDto(
  z.strictObject({
    version,
    analyzer: optionalText(100),
    pusCells: optionalText(50),
    epithelialCells: optionalText(50),
    rbc: optionalText(50),
    microscopyNote: optionalText(500),
    growth: z.boolean(),
    growthTypeId: z.uuid().nullable().default(null),
    /** The organisms isolated, in order (the antibiogram's results follow it). */
    organismIds: z.array(z.uuid()).max(MAX_ORGANISMS).default([]),
    colonyCount: optionalText(100),
    incubation: optionalText(100),
    media: optionalText(200),
    message: optionalText(1000),
    sensitivity: z
      .array(
        z.strictObject({
          antibioticId: z.uuid(),
          zone: optionalText(20),
          results: z.array(z.enum(SENSITIVITIES).nullable()).max(MAX_ORGANISMS),
        }),
      )
      .max(MAX_ANTIBIOTICS)
      .default([]),
    comment,
  }),
) {}
class EnterTextDto extends createZodDto(
  z.strictObject({ version, narrative: z.string().max(MAX_NARRATIVE), comment }),
) {}
class SampleListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(SAMPLE_STATUSES).optional(),
    departmentId: z.uuid().optional(),
    billId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}
class ResultListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(RESULT_STATUSES).optional(),
    sampleId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}

const orderRef = {
  billNumber: z.string().nullable(),
  patientName: z.string().nullable(),
  uhid: z.int().nullable(),
  departmentName: z.string().nullable(),
};
const sampleShape = {
  id: z.uuid(),
  labNumber: z.string(),
  billId: z.uuid(),
  departmentId: z.uuid(),
  patientId: z.uuid(),
  collectedOn: z.string(),
  collectedAt: z.date(),
  status: z.enum(SAMPLE_STATUSES),
  tests: z.int(),
  verified: z.int(),
  version: z.int(),
  ...orderRef,
};
const resultShape = {
  id: z.uuid(),
  sampleId: z.uuid(),
  labNumber: z.string(),
  billId: z.uuid(),
  line: z.int(),
  testId: z.uuid(),
  testName: z.string().nullable(),
  status: z.enum(RESULT_STATUSES),
  collectedAt: z.date(),
  version: z.int(),
  ...orderRef,
};
const valueShape = {
  parameterId: z.uuid().nullable(),
  name: z.string(),
  unit: z.string().nullable(),
  method: z.string().nullable(),
  value: z.string().nullable(),
  numeric: z.number().nullable(),
  low: z.number().nullable(),
  high: z.number().nullable(),
  normalText: z.string().nullable(),
  flag: z.enum(['low', 'high']).nullable(),
};
const recordShape = {
  ...resultShape,
  comment: z.string().nullable(),
  enteredBy: z.uuid().nullable(),
  enteredAt: z.date().nullable(),
  verifiedBy: z.uuid().nullable(),
  verifiedAt: z.date().nullable(),
  deliveredTo: z.string().nullable(),
  deliveredAt: z.date().nullable(),
  reagents: z.enum(['used', 'short']).nullable(),
  form: z.enum(REPORT_FORMS).nullable(),
  values: z.array(z.object(valueShape)),
  culture: z
    .object({
      analyzer: z.string().nullable(),
      pusCells: z.string().nullable(),
      epithelialCells: z.string().nullable(),
      rbc: z.string().nullable(),
      microscopyNote: z.string().nullable(),
      growth: z.boolean(),
      growthTypeId: z.uuid().nullable(),
      growthType: z.string().nullable(),
      organisms: z.array(z.object({ organismId: z.uuid().nullable(), name: z.string() })),
      colonyCount: z.string().nullable(),
      incubation: z.string().nullable(),
      media: z.string().nullable(),
      message: z.string().nullable(),
      sensitivity: z.array(
        z.object({
          antibioticId: z.uuid().nullable(),
          antibiotic: z.string(),
          zone: z.string().nullable(),
          results: z.array(z.enum(SENSITIVITIES).nullable()),
        }),
      ),
    })
    .nullable(),
  narrative: z.string().nullable(),
};
class CollectedResponseDto extends responseDto({ id: z.uuid(), labNumber: z.string(), tests: z.int() }) {}
class SampleChangedResponseDto extends responseDto({ results: z.int() }) {}
class SamplePageResponseDto extends responseDto({ items: z.array(z.object(sampleShape)), ...pageMetaShape }) {}
class SampleResponseDto extends responseDto({
  ...sampleShape,
  rejectReason: z.string().nullable(),
  results: z.array(z.object(recordShape)),
}) {}
class ResultPageResponseDto extends responseDto({ items: z.array(z.object(resultShape)), ...pageMetaShape }) {}
class ResultResponseDto extends responseDto({
  ...recordShape,
  /** The form to enter it in: the one it was entered in, else the test's. */
  form: z.enum(REPORT_FORMS),
  template: z.array(
    z.object({
      parameterId: z.uuid(),
      name: z.string(),
      unit: z.string().nullable(),
      kind: z.enum(['numeric', 'text']),
      low: z.number().nullable(),
      high: z.number().nullable(),
      normalText: z.string().nullable(),
    }),
  ),
}) {}

@ApiTags('laboratory')
@ApiBearerAuth()
@Controller({ path: 'lab', version: '1' })
export class LabController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('tests/:testId/parameters')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: TestParametersResponseDto })
  async parameters(@CurrentUser() actor: Actor, @Param() params: TestParamDto) {
    return { items: await this.queryBus.execute(new GetTestParametersQuery(actor, params.testId)) };
  }

  @Put('tests/:testId/parameters')
  @RequirePermissions('lab:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "A lab test's parameters (the whole list), each with its unit, method and normal ranges" })
  @ApiNoContentResponse()
  async setParameters(@CurrentUser() actor: Actor, @Param() params: TestParamDto, @Body() dto: TestParametersDto) {
    await this.commandBus.execute(new SetTestParametersCommand(actor, params.testId, dto.parameters));
  }

  @Get('tests')
  @RequirePermissions('lab:read')
  @ApiOperation({ summary: 'Lab tests by name or code (up to 20), with how each is reported' })
  @ApiOkResponse({ type: TestSearchResponseDto })
  async tests(@CurrentUser() actor: Actor, @Query() query: TestSearchDto) {
    return { items: await this.queryBus.execute(new SearchLabTestsQuery(actor, query.q)) };
  }

  @Get('orders/:number')
  @RequirePermissions('lab:read')
  @ApiOperation({ summary: "A bill by its number, with each lab department's tests and whether each is in work" })
  @ApiOkResponse({ type: CollectableOrderResponseDto })
  order(@CurrentUser() actor: Actor, @Param() params: OrderNumberDto) {
    return this.queryBus.execute(new FindOrderQuery(actor, params.number));
  }

  @Get('tests/:testId/form')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: TestFormResponseDto })
  form(@CurrentUser() actor: Actor, @Param() params: TestParamDto) {
    return this.queryBus.execute(new GetTestFormQuery(actor, params.testId));
  }

  @Put('tests/:testId/form')
  @RequirePermissions('lab:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'How a lab test is reported: values against its parameters, a culture with its antibiogram, or written text',
  })
  @ApiNoContentResponse()
  async setForm(@CurrentUser() actor: Actor, @Param() params: TestParamDto, @Body() dto: TestFormDto) {
    await this.commandBus.execute(new SetTestFormCommand(actor, params.testId, dto.form));
  }

  @Get('samples')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: SamplePageResponseDto })
  samples(@CurrentUser() actor: Actor, @Query() query: SampleListQueryDto) {
    return this.queryBus.execute(new ListSamplesQuery(actor, query));
  }

  @Get('samples/:id')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: SampleResponseDto })
  sample(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetSampleQuery(actor, params.id));
  }

  @Post('samples')
  @RequirePermissions('lab:collect')
  @ApiOperation({ summary: "Collect a sample for a bill's tests of one lab department, with a lab number of the day" })
  @ApiCreatedResponse({ type: CollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Body() dto: CollectDto) {
    return this.commandBus.execute(new CollectSampleCommand(actor, dto.billId, dto.departmentId));
  }

  @Post('samples/:id/receive')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ type: SampleChangedResponseDto })
  receive(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    return this.commandBus.execute(new ChangeSampleCommand(actor, params.id, dto.version, { kind: 'receive' }));
  }

  @Post('samples/:id/reject')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a sample (its tests are collected again), with a reason' })
  @ApiOkResponse({ type: SampleChangedResponseDto })
  reject(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: RejectDto) {
    return this.commandBus.execute(
      new ChangeSampleCommand(actor, params.id, dto.version, { kind: 'reject', reason: dto.reason }),
    );
  }

  @Post('samples/:id/deliver')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Hand over the sample's verified reports (held while the patient owes, unless lab:manage)" })
  @ApiOkResponse({ type: SampleChangedResponseDto })
  deliver(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: DeliverDto) {
    return this.commandBus.execute(
      new ChangeSampleCommand(actor, params.id, dto.version, { kind: 'deliver', to: dto.to }),
    );
  }

  @Get('results')
  @RequirePermissions('lab:read')
  @ApiOperation({ summary: 'The worklist: results by state' })
  @ApiOkResponse({ type: ResultPageResponseDto })
  results(@CurrentUser() actor: Actor, @Query() query: ResultListQueryDto) {
    return this.queryBus.execute(new ListResultsQuery(actor, query));
  }

  @Get('results/:id')
  @RequirePermissions('lab:read')
  @ApiOperation({ summary: "A result with the test's parameters and the patient's ranges to enter against" })
  @ApiOkResponse({ type: ResultResponseDto })
  result(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetResultQuery(actor, params.id));
  }

  @Put('results/:id')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enter or correct the values (before verification); out-of-range numbers are flagged' })
  @ApiNoContentResponse()
  async enter(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EnterDto) {
    await this.commandBus.execute(
      new ChangeResultCommand(actor, params.id, dto.version, {
        kind: 'enter',
        values: dto.values,
        comment: dto.comment,
      }),
    );
  }

  @Put('results/:id/culture')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Enter or correct a culture (microscopy, growth, organisms, antibiogram) before verification',
  })
  @ApiNoContentResponse()
  async enterCulture(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EnterCultureDto) {
    const { version: seen, comment: remark, ...culture } = dto;
    await this.commandBus.execute(
      new ChangeResultCommand(actor, params.id, seen, { kind: 'enter-culture', culture, comment: remark }),
    );
  }

  @Put('results/:id/text')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Enter or correct a written report (histopathology, cytology …) before verification' })
  @ApiNoContentResponse()
  async enterText(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: EnterTextDto) {
    await this.commandBus.execute(
      new ChangeResultCommand(actor, params.id, dto.version, {
        kind: 'enter-text',
        narrative: dto.narrative,
        comment: dto.comment,
      }),
    );
  }

  @Post('results/:id/verify')
  @RequirePermissions('lab:verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Verify a result entered by someone else' })
  @ApiNoContentResponse()
  async verify(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ChangeResultCommand(actor, params.id, dto.version, { kind: 'verify' }));
  }

  @Post('results/:id/unverify')
  @RequirePermissions('lab:verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Take a verification back for a correction (not once handed over)' })
  @ApiNoContentResponse()
  async unverify(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ChangeResultCommand(actor, params.id, dto.version, { kind: 'unverify' }));
  }
}
