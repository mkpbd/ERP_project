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
  ChangeStudyCommand,
  GetImagingTemplatesQuery,
  GetStudyQuery,
  ListStudiesQuery,
  MarkStudyDoneCommand,
  SetImagingTemplatesCommand,
} from '../application/imaging.messages.js';

const version = z.int().min(1);
const day = z.iso.date();
const STATUSES = ['done', 'signed', 'delivered'] as const;
const templateShape = {
  name: z.string().trim().min(1).max(100),
  findings: z.string().trim().min(1).max(8000),
  impression: z.string().trim().min(1).max(2000),
};

class ImagingTestParamDto extends createZodDto(z.object({ testId: z.uuid() })) {}
class ImagingTemplatesDto extends createZodDto(
  z.strictObject({ templates: z.array(z.strictObject(templateShape)).max(30) }),
) {}
class ImagingTemplatesResponseDto extends responseDto({ items: z.array(z.object(templateShape)) }) {}
class ImagingDoneDto extends createZodDto(z.strictObject({ billId: z.uuid(), line: z.int().min(1) })) {}
class ImagingWriteDto extends createZodDto(
  z.strictObject({
    version,
    findings: z.string().trim().max(8000).nullable(),
    impression: z.string().trim().max(2000).nullable(),
    radiologistId: z.uuid().nullable(),
  }),
) {}
class ImagingVersionDto extends createZodDto(z.strictObject({ version })) {}
class ImagingDeliverDto extends createZodDto(z.strictObject({ version, to: z.string().trim().min(1).max(150) })) {}
class ImagingStudyListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    status: z.enum(STATUSES).optional(),
    billId: z.uuid().optional(),
    radiologistId: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
  }),
) {}

const summaryShape = {
  id: z.uuid(),
  accessionNumber: z.string(),
  billId: z.uuid(),
  line: z.int(),
  testId: z.uuid(),
  patientId: z.uuid(),
  doneOn: z.string(),
  doneAt: z.date(),
  status: z.enum(STATUSES),
  radiologistId: z.uuid().nullable(),
  radiologistName: z.string().nullable(),
  billNumber: z.string().nullable(),
  patientName: z.string().nullable(),
  uhid: z.int().nullable(),
  testName: z.string().nullable(),
  departmentName: z.string().nullable(),
  version: z.int(),
};
class ImagingDoneResponseDto extends responseDto({ id: z.uuid(), accessionNumber: z.string() }) {}
class ImagingStudyChangedResponseDto extends responseDto({ reportingFee: z.number() }) {}
class ImagingStudyPageResponseDto extends responseDto({ items: z.array(z.object(summaryShape)), ...pageMetaShape }) {}
class ImagingStudyResponseDto extends responseDto({
  ...summaryShape,
  findings: z.string().nullable(),
  impression: z.string().nullable(),
  signedBy: z.uuid().nullable(),
  signedAt: z.date().nullable(),
  reportingFee: z.number(),
  deliveredTo: z.string().nullable(),
  deliveredAt: z.date().nullable(),
  templates: z.array(z.object(templateShape)),
}) {}

@ApiTags('laboratory')
@ApiBearerAuth()
@Controller({ path: 'lab', version: '1' })
export class ImagingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('tests/:testId/imaging-templates')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: ImagingTemplatesResponseDto })
  async templates(@CurrentUser() actor: Actor, @Param() params: ImagingTestParamDto) {
    return { items: await this.queryBus.execute(new GetImagingTemplatesQuery(actor, params.testId)) };
  }

  @Put('tests/:testId/imaging-templates')
  @RequirePermissions('lab:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "An imaging test's report templates (the whole list): name, findings and impression" })
  @ApiNoContentResponse()
  async setTemplates(
    @CurrentUser() actor: Actor,
    @Param() params: ImagingTestParamDto,
    @Body() dto: ImagingTemplatesDto,
  ) {
    await this.commandBus.execute(new SetImagingTemplatesCommand(actor, params.testId, dto.templates));
  }

  @Get('imaging-studies')
  @RequirePermissions('lab:read')
  @ApiOkResponse({ type: ImagingStudyPageResponseDto })
  studies(@CurrentUser() actor: Actor, @Query() query: ImagingStudyListQueryDto) {
    return this.queryBus.execute(new ListStudiesQuery(actor, query));
  }

  @Get('imaging-studies/:id')
  @RequirePermissions('lab:read')
  @ApiOperation({ summary: "A study with its report and the test's templates to write from" })
  @ApiOkResponse({ type: ImagingStudyResponseDto })
  study(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetStudyQuery(actor, params.id));
  }

  @Post('imaging-studies')
  @RequirePermissions('lab:result')
  @ApiOperation({ summary: "Mark a bill's imaging test done, with an accession number of the day" })
  @ApiCreatedResponse({ type: ImagingDoneResponseDto })
  done(@CurrentUser() actor: Actor, @Body() dto: ImagingDoneDto) {
    return this.commandBus.execute(new MarkStudyDoneCommand(actor, dto.billId, dto.line));
  }

  @Put('imaging-studies/:id/report')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Write or correct the findings, impression and radiologist (before signing)' })
  @ApiNoContentResponse()
  async write(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ImagingWriteDto) {
    const { version: studyVersion, ...report } = dto;
    await this.commandBus.execute(new ChangeStudyCommand(actor, params.id, studyVersion, { kind: 'write', ...report }));
  }

  @Post('imaging-studies/:id/sign')
  @RequirePermissions('lab:verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign the report for the radiologist, crediting their reporting fee' })
  @ApiOkResponse({ type: ImagingStudyChangedResponseDto })
  sign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ImagingVersionDto) {
    return this.commandBus.execute(new ChangeStudyCommand(actor, params.id, dto.version, { kind: 'sign' }));
  }

  @Post('imaging-studies/:id/unsign')
  @RequirePermissions('lab:verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Take a signature back for a correction (the fee comes back off; not once handed over)' })
  @ApiOkResponse({ type: ImagingStudyChangedResponseDto })
  unsign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ImagingVersionDto) {
    return this.commandBus.execute(new ChangeStudyCommand(actor, params.id, dto.version, { kind: 'unsign' }));
  }

  @Post('imaging-studies/:id/deliver')
  @RequirePermissions('lab:result')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hand the signed report over (held while the patient owes, unless lab:manage)' })
  @ApiOkResponse({ type: ImagingStudyChangedResponseDto })
  deliver(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ImagingDeliverDto) {
    return this.commandBus.execute(
      new ChangeStudyCommand(actor, params.id, dto.version, { kind: 'deliver', to: dto.to }),
    );
  }
}
