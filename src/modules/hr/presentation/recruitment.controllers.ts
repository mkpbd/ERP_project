import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import { JOB_APPLICATION, JOB_CIRCULAR } from '../application/hr.constants.js';
import {
  AddApplicationFileCommand,
  GetApplicationFileQuery,
  ListApplicationFilesQuery,
  RemoveApplicationFileCommand,
} from '../application/recruitment.messages.js';
import { CV_TYPES } from '../domain/recruitment.js';
import type { CvFileInfo } from '../domain/repositories.js';
import {
  ApplicationFileParamDto,
  ApplicationFileQueryDto,
  ApplicationFileResponseDto,
  CreateJobApplicationDto,
  CreateJobCircularDto,
  JobApplicationFilterDto,
  JobApplicationResponseDto,
  JobCircularFilterDto,
  JobCircularResponseDto,
  UpdateJobApplicationDto,
  UpdateJobCircularDto,
} from './dto/recruitment.dto.js';
import { CreatedIdResponseDto } from './dto/hr.dto.js';

const recruitment = {
  tag: 'hr-recruitment',
  readPermission: 'recruitment:read',
  managePermission: 'recruitment:manage',
} as const;

export const JobCircularsController = createRecordController({
  ...recruitment,
  className: 'JobCircularsController',
  path: 'hr/recruitment/circulars',
  type: JOB_CIRCULAR,
  label: 'job circular',
  create: CreateJobCircularDto,
  update: UpdateJobCircularDto,
  response: JobCircularResponseDto,
  filter: JobCircularFilterDto,
});

export const JobApplicationsController = createRecordController({
  ...recruitment,
  className: 'JobApplicationsController',
  path: 'hr/recruitment/applications',
  type: JOB_APPLICATION,
  label: 'job application',
  create: CreateJobApplicationDto,
  update: UpdateJobApplicationDto,
  response: JobApplicationResponseDto,
  filter: JobApplicationFilterDto,
});

@ApiTags('hr-recruitment')
@ApiBearerAuth()
@Controller({ path: 'hr/recruitment/applications/:id/files', version: '1' })
export class JobApplicationFilesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('recruitment:read')
  @ApiOkResponse({ type: ApplicationFileResponseDto, isArray: true })
  list(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<CvFileInfo[]> {
    return this.queryBus.execute(new ListApplicationFilesQuery(actor, params.id));
  }

  @Post()
  @RequirePermissions('recruitment:manage')
  @ApiOperation({ summary: 'Attach a CV as the raw body (PDF or Word .docx, up to 5 MiB; up to 5 files)' })
  @ApiConsumes(...CV_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: CreatedIdResponseDto })
  add(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: ApplicationFileQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    if (!Buffer.isBuffer(body))
      throw new ValidationError(`Send the file bytes with Content-Type ${CV_TYPES.join(', ')}`);
    return this.commandBus.execute(
      new AddApplicationFileCommand(actor, params.id, query.fileName, contentType ?? '', body),
    );
  }

  @Get(':fileId')
  @RequirePermissions('recruitment:read')
  @ApiProduces(...CV_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async download(@CurrentUser() actor: Actor, @Param() params: ApplicationFileParamDto): Promise<StreamableFile> {
    const file = await this.queryBus.execute(new GetApplicationFileQuery(actor, params.id, params.fileId));
    return new StreamableFile(file.data, {
      type: file.contentType,
      // The stored name is cleaned of quotes and control characters; encode it for non-ASCII names.
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    });
  }

  @Delete(':fileId')
  @RequirePermissions('recruitment:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async remove(@CurrentUser() actor: Actor, @Param() params: ApplicationFileParamDto): Promise<void> {
    await this.commandBus.execute(new RemoveApplicationFileCommand(actor, params.id, params.fileId));
  }
}
