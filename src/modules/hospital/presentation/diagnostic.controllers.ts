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
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import {
  IdParamDto,
  pageMetaShape,
  paginationShape,
  responseDto,
} from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  CancelDiagnosticTestsCommand,
  CollectDiagnosticDueCommand,
  CreateDiagnosticBillCommand,
  GetDiagnosticBillQuery,
  GetDiagnosticPolicyQuery,
  GetPackageTestsQuery,
  ListDiagnosticBillsQuery,
  SetDiagnosticPolicyCommand,
  SetPackageTestsCommand,
} from '../application/diagnostic.messages.js';
import { HOSPITAL_RECORDS as R } from '../application/hospital.constants.js';
import { PAYMENT_METHODS } from '../domain/opd-bill.js';
import { shapes } from './doctor.controllers.js';

const name = (max = 150) => z.string().trim().min(1).max(max);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);
const percent = z.number().min(0).max(100).multipleOf(0.01);
const flag = z.enum(['true', 'false']).optional();
const search = z.string().trim().min(1).max(100).optional();
const version = z.int().min(1);
const day = z.iso.date();
const KINDS = ['lab', 'imaging', 'other'] as const;
const STATUSES = ['billed', 'cancelled'] as const;

const diag = { tag: 'diagnostics', readPermission: 'diag:read', managePermission: 'diag:manage' } as const;

const department = shapes({ name: name(100), kind: z.enum(KINDS) }, [], { kind: 'lab' });
class CreateDepartmentDto extends createZodDto(department.create) {}
class UpdateDepartmentDto extends createZodDto(department.update) {}
class DepartmentFilterDto extends createZodDto(z.object({ q: search, kind: z.enum(KINDS).optional() })) {}
class DepartmentResponseDto extends responseDto(department.response) {}

const test = shapes(
  {
    code: z.string().trim().min(1).max(20).nullable(),
    name: name(150),
    shortName: optionalText(40),
    departmentId: z.uuid(),
    specimen: optionalText(60),
    roomNo: optionalText(20),
    rate: money,
    /** Hours from billing to the report; null: no report to deliver (a tube, a procedure). */
    reportHours: z.int().min(0).max(2000).nullable(),
    discountAllowed: z.boolean(),
    /** The referring doctor's commission; null takes the diagnostic policy's. */
    referralPercent: percent.nullable(),
    isActive: z.boolean(),
  },
  ['code', 'shortName', 'specimen', 'roomNo', 'reportHours', 'referralPercent'],
  { discountAllowed: true, isActive: true },
);
class CreateTestDto extends createZodDto(test.create) {}
class UpdateTestDto extends createZodDto(test.update) {}
class TestFilterDto extends createZodDto(z.object({ q: search, departmentId: z.uuid().optional(), isActive: flag })) {}
class TestResponseDto extends responseDto(test.response) {}

const pack = shapes({ name: name(150), isActive: z.boolean() }, [], { isActive: true });
class CreatePackageDto extends createZodDto(pack.create) {}
class UpdatePackageDto extends createZodDto(pack.update) {}
class PackageFilterDto extends createZodDto(z.object({ q: search, isActive: flag })) {}
class PackageResponseDto extends responseDto(pack.response) {}

/** Old Diag.ParentGroup: the department a test is done in. */
export const DiagnosticDepartmentsController = createRecordController({
  ...diag,
  className: 'DiagnosticDepartmentsController',
  path: 'hospital/diagnostic-departments',
  type: R.diagnosticDepartment,
  label: 'diagnostic department',
  create: CreateDepartmentDto,
  update: UpdateDepartmentDto,
  response: DepartmentResponseDto,
  filter: DepartmentFilterDto,
});

/** Old Diag.TestItems: the tests sold, with their rate, report time and whether they may be discounted. */
export const DiagnosticTestsController = createRecordController({
  ...diag,
  className: 'DiagnosticTestsController',
  path: 'hospital/diagnostic-tests',
  type: R.diagnosticTest,
  label: 'diagnostic test',
  create: CreateTestDto,
  update: UpdateTestDto,
  response: TestResponseDto,
  filter: TestFilterDto,
});

/** Old Diag.OPDPackages: tests sold together; their tests are set on `:id/tests`. */
export const DiagnosticPackagesController = createRecordController({
  ...diag,
  className: 'DiagnosticPackagesController',
  path: 'hospital/diagnostic-packages',
  type: R.diagnosticPackage,
  label: 'diagnostic package',
  create: CreatePackageDto,
  update: UpdatePackageDto,
  response: PackageResponseDto,
  filter: PackageFilterDto,
});

const policyShape = { counterDiscountPercent: percent, defaultReferralPercent: percent };
class DiagnosticPolicyDto extends createZodDto(z.strictObject(policyShape)) {}
class DiagnosticPolicyResponseDto extends responseDto(policyShape) {}
class PackageTestsDto extends createZodDto(
  z.strictObject({
    tests: z
      .array(z.strictObject({ testId: z.uuid(), rate: money }))
      .min(1)
      .max(60),
  }),
) {}
class PackageTestsResponseDto extends responseDto({
  packageId: z.uuid(),
  name: z.string(),
  isActive: z.boolean(),
  tests: z.array(z.object({ testId: z.uuid(), testName: z.string(), listRate: z.number(), rate: z.number() })),
  total: z.number(),
}) {}
const moneyShape = {
  amount: money,
  method: z.enum(PAYMENT_METHODS).default('cash'),
  reference: z.string().trim().max(100).nullable().default(null),
};
class CreateDiagnosticBillDto extends createZodDto(
  z
    .strictObject({
      patientId: z.uuid(),
      referredById: z.uuid().nullable().default(null),
      /** Left out: the patient's own corporate client, if any; null: the patient pays. */
      corporateClientId: z.uuid().nullable().optional(),
      staffId: z.uuid().nullable().default(null),
      testIds: z.array(z.uuid()).max(60).default([]),
      packageIds: z.array(z.uuid()).max(10).default([]),
      discount: money.nullable().default(null),
      discountReason: z.string().trim().max(200).nullable().default(null),
      payment: z.strictObject(moneyShape).nullable().default(null),
    })
    .refine((bill) => bill.testIds.length + bill.packageIds.length > 0, { message: 'Bill a test or a package' }),
) {}
class CollectDiagnosticDueDto extends createZodDto(z.strictObject({ version, ...moneyShape })) {}
class CancelDiagnosticTestsDto extends createZodDto(
  z.strictObject({
    version,
    /** Lines (1-based) to cancel; left out: every test still billed. */
    lines: z.array(z.int().min(1)).min(1).max(60).nullable().default(null),
    reason: z.string().trim().min(1).max(300),
    refundMethod: z.enum(PAYMENT_METHODS).default('cash'),
  }),
) {}
class DiagnosticBillListQueryDto extends createZodDto(
  z.object({
    ...paginationShape,
    patientId: z.uuid().optional(),
    referredById: z.uuid().optional(),
    from: day.optional(),
    to: day.optional(),
    status: z.enum(STATUSES).optional(),
    withDue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    corporateClientId: z.uuid().optional(),
  }),
) {}

const summaryShape = {
  id: z.uuid(),
  number: z.string(),
  billedOn: z.string(),
  patientId: z.uuid(),
  uhid: z.int(),
  patientName: z.string(),
  referredByName: z.string().nullable(),
  gross: z.number(),
  discount: z.number(),
  net: z.number(),
  cancelled: z.number(),
  paid: z.number(),
  collected: z.number(),
  refunded: z.number(),
  due: z.number(),
  status: z.enum(STATUSES),
  corporateClientId: z.uuid().nullable(),
  corporateClientName: z.string().nullable(),
  staffId: z.uuid().nullable(),
  version: z.int(),
};
class DiagnosticBillCreatedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  net: z.number(),
  due: z.number(),
}) {}
class DiagnosticCollectedResponseDto extends responseDto({ number: z.string(), due: z.number() }) {}
class DiagnosticCancelledResponseDto extends responseDto({ refunded: z.number(), due: z.number() }) {}
class DiagnosticBillPageResponseDto extends responseDto({
  items: z.array(z.object(summaryShape)),
  ...pageMetaShape,
}) {}
class DiagnosticBillResponseDto extends responseDto({
  ...summaryShape,
  billedAt: z.date(),
  sex: z.string(),
  dateOfBirth: z.string(),
  mobileNo: z.string().nullable(),
  referredById: z.uuid().nullable(),
  discountReason: z.string().nullable(),
  voucherNumber: z.string().nullable(),
  billedBy: z.uuid().nullable(),
  lines: z.array(
    z.object({
      line: z.int(),
      testId: z.uuid(),
      testName: z.string(),
      departmentName: z.string(),
      roomNo: z.string().nullable(),
      specimen: z.string().nullable(),
      packageName: z.string().nullable(),
      rate: z.number(),
      discount: z.number(),
      referralAmount: z.number(),
      reportDueAt: z.date().nullable(),
      status: z.enum(STATUSES),
      cancelledOn: z.string().nullable(),
      cancelReason: z.string().nullable(),
    }),
  ),
  payments: z.array(
    z.object({
      kind: z.enum(['payment', 'collection', 'refund']),
      number: z.string().nullable(),
      method: z.enum(PAYMENT_METHODS),
      reference: z.string().nullable(),
      amount: z.number(),
      paidOn: z.string(),
    }),
  ),
}) {}

@ApiTags('diagnostics')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class DiagnosticBillsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('diagnostic-policy')
  @RequirePermissions('diag:read')
  @ApiOkResponse({ type: DiagnosticPolicyResponseDto })
  policy(@CurrentUser() actor: Actor) {
    return this.queryBus.execute(new GetDiagnosticPolicyQuery(actor));
  }

  @Put('diagnostic-policy')
  @RequirePermissions('diag:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The counter's discount limit and the default referral commission" })
  @ApiNoContentResponse()
  async setPolicy(@CurrentUser() actor: Actor, @Body() dto: DiagnosticPolicyDto) {
    await this.commandBus.execute(new SetDiagnosticPolicyCommand(actor, dto));
  }

  @Get('diagnostic-packages/:id/tests')
  @RequirePermissions('diag:read')
  @ApiOkResponse({ type: PackageTestsResponseDto })
  packageTests(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetPackageTestsQuery(actor, params.id));
  }

  @Put('diagnostic-packages/:id/tests')
  @RequirePermissions('diag:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "The package's tests (the whole list), each at its rate inside the package" })
  @ApiNoContentResponse()
  async setPackageTests(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: PackageTestsDto) {
    await this.commandBus.execute(new SetPackageTestsCommand(actor, params.id, dto.tests));
  }

  @Get('diagnostic-bills')
  @RequirePermissions('diag:read')
  @ApiOkResponse({ type: DiagnosticBillPageResponseDto })
  list(@CurrentUser() actor: Actor, @Query() query: DiagnosticBillListQueryDto) {
    return this.queryBus.execute(new ListDiagnosticBillsQuery(actor, query));
  }

  @Get('diagnostic-bills/:id')
  @RequirePermissions('diag:read')
  @ApiOkResponse({ type: DiagnosticBillResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetDiagnosticBillQuery(actor, params.id));
  }

  @Post('diagnostic-bills')
  @RequirePermissions('diag:bill')
  @ApiOperation({
    summary: "Bill tests and packages to a registered patient, with the referring doctor's commission (posted)",
  })
  @ApiCreatedResponse({ type: DiagnosticBillCreatedResponseDto })
  create(@CurrentUser() actor: Actor, @Body() dto: CreateDiagnosticBillDto) {
    return this.commandBus.execute(new CreateDiagnosticBillCommand(actor, dto));
  }

  @Post('diagnostic-bills/:id/collections')
  @RequirePermissions('diag:bill')
  @ApiCreatedResponse({ type: DiagnosticCollectedResponseDto })
  collect(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CollectDiagnosticDueDto) {
    const { version: billVersion, ...money } = dto;
    return this.commandBus.execute(new CollectDiagnosticDueCommand(actor, params.id, billVersion, money));
  }

  @Post('diagnostic-bills/:id/cancel')
  @RequirePermissions('diag:bill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Cancel named tests or all (the bill's day; later needs diag:manage): off the due first, the rest back",
  })
  @ApiOkResponse({ type: DiagnosticCancelledResponseDto })
  cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CancelDiagnosticTestsDto) {
    return this.commandBus.execute(
      new CancelDiagnosticTestsCommand(actor, params.id, dto.version, dto.lines, dto.reason, dto.refundMethod),
    );
  }
}

export const DIAGNOSTIC_CONTROLLERS = [
  DiagnosticDepartmentsController,
  DiagnosticTestsController,
  DiagnosticPackagesController,
  DiagnosticBillsController,
];
