import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
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
import type { Page } from '../../../shared/application/pagination.js';
import { ValidationError } from '../../../shared/domain/errors.js';
import { DOCUMENT_TYPES, IMAGE_TYPES } from '../../../shared/domain/file-types.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { IdParamDto } from '../../../shared/presentation/zod/common.schemas.js';
import {
  DEPARTMENT_INCHARGE,
  DESIGNATION,
  FESTIVAL,
  GOVT_HOLIDAY,
  HR_DEPARTMENT,
  HR_DIVISION,
  HR_SUB_DEPARTMENT,
} from '../application/hr.constants.js';
import type { StaffDetailView, StaffSummaryView } from '../application/read-models.js';
import {
  ActivateStaffCommand,
  AddStaffDocumentCommand,
  DeactivateStaffCommand,
  GetMyStaffRecordQuery,
  GetStaffDocumentQuery,
  GetStaffPhotoQuery,
  GetStaffQuery,
  HireStaffCommand,
  ListStaffQuery,
  RemoveStaffDocumentCommand,
  RemoveStaffPhotoCommand,
  ReplaceStaffEducationCommand,
  ReplaceStaffEmergencyContactsCommand,
  ReplaceStaffFestivalsCommand,
  SeparateStaffCommand,
  SetStaffPhotoCommand,
  UpdateStaffCommand,
} from '../application/staff.messages.js';
import {
  CreateDepartmentInchargeDto,
  CreateDesignationDto,
  CreatedIdResponseDto,
  CreateFestivalDto,
  CreateGovtHolidayDto,
  CreateHrDepartmentDto,
  CreateHrDivisionDto,
  CreateHrSubDepartmentDto,
  DeactivateStaffDto,
  DepartmentInchargeFilterDto,
  DepartmentInchargeResponseDto,
  DesignationResponseDto,
  DivisionFilterDto,
  FestivalResponseDto,
  GovtHolidayFilterDto,
  GovtHolidayResponseDto,
  HireStaffDto,
  HrDepartmentFilterDto,
  HrDepartmentResponseDto,
  HrDivisionResponseDto,
  HrSubDepartmentResponseDto,
  ReplaceEducationDto,
  ReplaceEmergencyContactsDto,
  ReplaceFestivalsDto,
  SeparateStaffDto,
  StaffDetailResponseDto,
  StaffDocumentParamDto,
  StaffDocumentQueryDto,
  StaffListQueryDto,
  StaffPageResponseDto,
  UpdateDepartmentInchargeDto,
  UpdateDesignationDto,
  UpdateFestivalDto,
  UpdateGovtHolidayDto,
  UpdateHrDepartmentDto,
  UpdateHrDivisionDto,
  UpdateHrSubDepartmentDto,
  UpdateStaffDto,
} from './dto/hr.dto.js';

const masters = { tag: 'hr', managePermission: 'hr-masters:manage' } as const;

export const HrDivisionsController = createRecordController({
  ...masters,
  className: 'HrDivisionsController',
  path: 'hr/divisions',
  type: HR_DIVISION,
  label: 'HR division',
  create: CreateHrDivisionDto,
  update: UpdateHrDivisionDto,
  response: HrDivisionResponseDto,
});

export const HrDepartmentsController = createRecordController({
  ...masters,
  className: 'HrDepartmentsController',
  path: 'hr/departments',
  type: HR_DEPARTMENT,
  label: 'HR department',
  create: CreateHrDepartmentDto,
  update: UpdateHrDepartmentDto,
  response: HrDepartmentResponseDto,
  filter: DivisionFilterDto,
});

export const HrSubDepartmentsController = createRecordController({
  ...masters,
  className: 'HrSubDepartmentsController',
  path: 'hr/sub-departments',
  type: HR_SUB_DEPARTMENT,
  label: 'HR sub-department',
  create: CreateHrSubDepartmentDto,
  update: UpdateHrSubDepartmentDto,
  response: HrSubDepartmentResponseDto,
  filter: HrDepartmentFilterDto,
});

export const DesignationsController = createRecordController({
  ...masters,
  className: 'DesignationsController',
  path: 'hr/designations',
  type: DESIGNATION,
  label: 'designation',
  create: CreateDesignationDto,
  update: UpdateDesignationDto,
  response: DesignationResponseDto,
});

export const FestivalsController = createRecordController({
  ...masters,
  className: 'FestivalsController',
  path: 'hr/festivals',
  type: FESTIVAL,
  label: 'festival',
  create: CreateFestivalDto,
  update: UpdateFestivalDto,
  response: FestivalResponseDto,
});

export const GovtHolidaysController = createRecordController({
  ...masters,
  className: 'GovtHolidaysController',
  path: 'hr/govt-holidays',
  type: GOVT_HOLIDAY,
  label: 'government holiday',
  create: CreateGovtHolidayDto,
  update: UpdateGovtHolidayDto,
  response: GovtHolidayResponseDto,
  filter: GovtHolidayFilterDto,
});

export const DepartmentInchargesController = createRecordController({
  tag: 'hr',
  managePermission: 'hr:manage',
  className: 'DepartmentInchargesController',
  path: 'hr/department-incharges',
  type: DEPARTMENT_INCHARGE,
  label: 'department incharge',
  create: CreateDepartmentInchargeDto,
  update: UpdateDepartmentInchargeDto,
  response: DepartmentInchargeResponseDto,
  filter: DepartmentInchargeFilterDto,
});

function bytes(body: unknown, accepted: readonly string[]): Buffer {
  if (!Buffer.isBuffer(body)) {
    throw new ValidationError(`Send the file bytes with Content-Type ${accepted.join(', ')}`);
  }
  return body;
}

@ApiTags('hr')
@ApiBearerAuth()
@Controller({ path: 'hr/staff', version: '1' })
export class StaffController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @RequirePermissions('hr:read')
  @ApiOperation({ summary: 'Search staff (name, employee no or mobile), filter by status, department, joining date' })
  @ApiOkResponse({ type: StaffPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: StaffListQueryDto): Promise<Page<StaffSummaryView>> {
    return this.queryBus.execute(new ListStaffQuery(actor, query));
  }

  @Post()
  @RequirePermissions('hr:manage')
  @ApiOperation({ summary: 'Add a staff record (status starts as active)' })
  @ApiCreatedResponse({ type: StaffDetailResponseDto })
  async hire(@CurrentUser() actor: Actor, @Body() dto: HireStaffDto): Promise<StaffDetailView> {
    const { id } = await this.commandBus.execute(new HireStaffCommand(actor, dto));
    return this.queryBus.execute(new GetStaffQuery(actor, id));
  }

  // Declared before ':id' so the literal segment wins.
  @Get('me')
  @ApiOperation({ summary: 'Your own staff record (when your user account is linked to one)' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  mine(@CurrentUser() actor: Actor): Promise<StaffDetailView> {
    return this.queryBus.execute(new GetMyStaffRecordQuery(actor));
  }

  @Get(':id')
  @ApiOperation({ summary: 'A staff record. Requires hr:read unless it is your own.' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<StaffDetailView> {
    return this.queryBus.execute(new GetStaffQuery(actor, params.id));
  }

  @Patch(':id')
  @RequirePermissions('hr:manage')
  @ApiOperation({ summary: 'Edit the fields sent. Separated staff cannot be edited.' })
  @ApiOkResponse({ type: StaffDetailResponseDto })
  async update(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: UpdateStaffDto,
  ): Promise<StaffDetailView> {
    await this.commandBus.execute(new UpdateStaffCommand(actor, params.id, dto));
    return this.queryBus.execute(new GetStaffQuery(actor, params.id));
  }

  @Post(':id/deactivate')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async deactivate(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: DeactivateStaffDto,
  ): Promise<void> {
    await this.commandBus.execute(new DeactivateStaffCommand(actor, params.id, dto.reason));
  }

  @Post(':id/activate')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async activate(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new ActivateStaffCommand(actor, params.id));
  }

  @Post(':id/separate')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Record resignation/termination. Final: the record becomes read-only history.' })
  @ApiNoContentResponse()
  async separate(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: SeparateStaffDto,
  ): Promise<void> {
    await this.commandBus.execute(new SeparateStaffCommand(actor, params.id, dto.separationDate, dto.reason));
  }

  @Put(':id/education')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Replace the education list (in the order given)' })
  @ApiNoContentResponse()
  async education(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: ReplaceEducationDto,
  ): Promise<void> {
    await this.commandBus.execute(new ReplaceStaffEducationCommand(actor, params.id, dto.entries));
  }

  @Put(':id/emergency-contacts')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Replace the emergency contacts (in the order given)' })
  @ApiNoContentResponse()
  async emergencyContacts(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: ReplaceEmergencyContactsDto,
  ): Promise<void> {
    await this.commandBus.execute(new ReplaceStaffEmergencyContactsCommand(actor, params.id, dto.entries));
  }

  @Put(':id/festivals')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Replace the festivals the staff member observes (festival bonus)' })
  @ApiNoContentResponse()
  async festivals(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Body() dto: ReplaceFestivalsDto,
  ): Promise<void> {
    await this.commandBus.execute(new ReplaceStaffFestivalsCommand(actor, params.id, dto.festivalIds));
  }

  @Get(':id/photo')
  @ApiOperation({ summary: 'The staff photo. Requires hr:read unless it is your own.' })
  @ApiProduces(...IMAGE_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async photo(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<StreamableFile> {
    const photo = await this.queryBus.execute(new GetStaffPhotoQuery(actor, params.id));
    return new StreamableFile(photo.data, { type: photo.contentType, disposition: 'inline' });
  }

  @Put(':id/photo')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Upload the photo as the raw body (PNG, JPEG or WebP, up to 1 MiB)' })
  @ApiConsumes(...IMAGE_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiNoContentResponse()
  async setPhoto(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<void> {
    const data = bytes(body, IMAGE_TYPES);
    await this.commandBus.execute(new SetStaffPhotoCommand(actor, params.id, contentType ?? '', data));
  }

  @Delete(':id/photo')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removePhoto(@CurrentUser() actor: Actor, @Param() params: IdParamDto): Promise<void> {
    await this.commandBus.execute(new RemoveStaffPhotoCommand(actor, params.id));
  }

  @Post(':id/documents')
  @RequirePermissions('hr:manage')
  @ApiOperation({ summary: 'Attach a document as the raw body (PDF, PNG, JPEG or WebP, up to 5 MiB)' })
  @ApiConsumes(...DOCUMENT_TYPES)
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: CreatedIdResponseDto })
  addDocument(
    @CurrentUser() actor: Actor,
    @Param() params: IdParamDto,
    @Query() query: StaffDocumentQueryDto,
    @Headers('content-type') contentType: string | undefined,
    @Body() body: unknown,
  ): Promise<{ id: string }> {
    const data = bytes(body, DOCUMENT_TYPES);
    return this.commandBus.execute(
      new AddStaffDocumentCommand(actor, params.id, query.category, query.fileName, contentType ?? '', data),
    );
  }

  @Get(':id/documents/:documentId')
  @ApiOperation({ summary: 'Download a document. Requires hr:read unless it is your own.' })
  @ApiProduces(...DOCUMENT_TYPES)
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async document(@CurrentUser() actor: Actor, @Param() params: StaffDocumentParamDto): Promise<StreamableFile> {
    const document = await this.queryBus.execute(new GetStaffDocumentQuery(actor, params.id, params.documentId));
    return new StreamableFile(document.data, {
      type: document.contentType,
      // The stored name is cleaned of quotes and control characters; encode it for non-ASCII names.
      disposition: `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
    });
  }

  @Delete(':id/documents/:documentId')
  @RequirePermissions('hr:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async removeDocument(@CurrentUser() actor: Actor, @Param() params: StaffDocumentParamDto): Promise<void> {
    await this.commandBus.execute(new RemoveStaffDocumentCommand(actor, params.id, params.documentId));
  }
}
