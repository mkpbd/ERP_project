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
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  BookHomeCollectionCommand,
  BookTestAppointmentCommand,
  ChangeHomeCollectionCommand,
  ChangeTestAppointmentCommand,
  GetHomeCollectionBoardQuery,
  GetHomeCollectionQuery,
  GetTestAppointmentBoardQuery,
  GetTestAppointmentQuery,
  GetWindowAvailabilityQuery,
  ListCollectorsQuery,
} from '../application/booking.messages.js';
import { HOSPITAL_RECORDS as R } from '../application/hospital.constants.js';
import {
  BOOKED_VIA,
  HOME_COLLECTION_STATUSES,
  MAX_BOOKING_TESTS,
  TEST_APPOINTMENT_STATUSES,
  WEEKDAYS,
} from '../domain/diagnostic-booking.js';
import { shapes } from './doctor.controllers.js';

const label = z.string().trim().min(1).max(60);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'A time of day as HH:MM');
const money = z.number().min(0).max(10_000_000).multipleOf(0.01);
const flag = z.enum(['true', 'false']).optional();
const day = z.iso.date();
const version = z.int().min(1);
const diag = { tag: 'diagnostics', readPermission: 'diag:read', managePermission: 'diag:manage' } as const;

const appointmentWindow = shapes(
  {
    label,
    startTime: time,
    /** Left out: the window has a start only. */
    endTime: time.nullable(),
    /** Bookings a day the window takes. */
    capacity: z.int().min(1).max(999),
    /** Null: tests of any department. */
    departmentId: z.uuid().nullable(),
    displayOrder: z.int().min(0).max(999),
    isActive: z.boolean(),
  },
  ['endTime', 'departmentId'],
  { capacity: 20, displayOrder: 0, isActive: true },
);
class CreateWindowDto extends createZodDto(appointmentWindow.create) {}
class UpdateWindowDto extends createZodDto(appointmentWindow.update) {}
class WindowFilterDto extends createZodDto(z.object({ isActive: flag, departmentId: z.uuid().optional() })) {}
class WindowResponseDto extends responseDto(appointmentWindow.response) {}

const area = shapes(
  {
    name: z.string().trim().min(1).max(100),
    /** What the visit costs on top of the tests. */
    charge: money,
    /** The smallest test total a visit is made for. */
    minimumOrder: money,
    /** Weekdays served; none: every day. */
    days: z.array(z.enum(WEEKDAYS)).max(7),
    isActive: z.boolean(),
  },
  [],
  { minimumOrder: 0, days: [], isActive: true },
);
class CreateAreaDto extends createZodDto(area.create) {}
class UpdateAreaDto extends createZodDto(area.update) {}
class AreaFilterDto extends createZodDto(
  z.object({ isActive: flag, q: z.string().trim().min(1).max(100).optional() }),
) {}
class AreaResponseDto extends responseDto(area.response) {}

const homeWindow = shapes({ label, displayOrder: z.int().min(0).max(999), isActive: z.boolean() }, [], {
  displayOrder: 0,
  isActive: true,
});
class CreateHomeWindowDto extends createZodDto(homeWindow.create) {}
class UpdateHomeWindowDto extends createZodDto(homeWindow.update) {}
class HomeWindowFilterDto extends createZodDto(z.object({ isActive: flag })) {}
class HomeWindowResponseDto extends responseDto(homeWindow.response) {}

/** Old Diag.TestAppointmentSlots: the windows tests are booked into, each with its daily capacity. */
export const TestAppointmentWindowsController = createRecordController({
  ...diag,
  className: 'TestAppointmentWindowsController',
  path: 'hospital/test-appointment-windows',
  type: R.testAppointmentWindow,
  label: 'test appointment window',
  create: CreateWindowDto,
  update: UpdateWindowDto,
  response: WindowResponseDto,
  filter: WindowFilterDto,
});

/** Old Diag.HomeCollectionServiceAreas: where collectors go, the visit's charge, the smallest order and the days. */
export const HomeCollectionAreasController = createRecordController({
  ...diag,
  className: 'HomeCollectionAreasController',
  path: 'hospital/home-collection-areas',
  type: R.homeCollectionArea,
  label: 'home collection area',
  create: CreateAreaDto,
  update: UpdateAreaDto,
  response: AreaResponseDto,
  filter: AreaFilterDto,
});

/** Old Diag.HomeCollectionTimeSlots: the windows a collector can be asked for. */
export const HomeCollectionWindowsController = createRecordController({
  ...diag,
  className: 'HomeCollectionWindowsController',
  path: 'hospital/home-collection-windows',
  type: R.homeCollectionWindow,
  label: 'home collection window',
  create: CreateHomeWindowDto,
  update: UpdateHomeWindowDto,
  response: HomeWindowResponseDto,
  filter: HomeWindowFilterDto,
});

const patientShape = {
  /** A registered patient; or, until they register, their name and mobile number. */
  patientId: z.uuid().nullable().default(null),
  patientName: z.string().trim().max(150).nullable().default(null),
  mobileNo: z.string().trim().max(20).nullable().default(null),
};
const testIds = z.array(z.uuid()).min(1).max(MAX_BOOKING_TESTS);
class BookAppointmentDto extends createZodDto(
  z.strictObject({
    ...patientShape,
    appointmentDate: day,
    windowId: z.uuid(),
    testIds,
    remarks: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class BookHomeCollectionDto extends createZodDto(
  z.strictObject({
    ...patientShape,
    collectionDate: day,
    windowId: z.uuid(),
    areaId: z.uuid(),
    address: z.string().trim().min(1).max(300),
    landmark: z.string().trim().max(150).nullable().default(null),
    testIds,
    note: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class VersionDto extends createZodDto(z.strictObject({ version })) {}
class ReasonDto extends createZodDto(z.strictObject({ version, reason: z.string().trim().min(1).max(300) })) {}
class AttachDto extends createZodDto(z.strictObject({ version, patientId: z.uuid() })) {}
class AssignDto extends createZodDto(z.strictObject({ version, collectorId: z.uuid() })) {}
class CollectedDto extends createZodDto(
  z.strictObject({ version, note: z.string().trim().max(300).nullable().default(null) }),
) {}
class AvailabilityQueryDto extends createZodDto(z.object({ date: day, departmentId: z.uuid().optional() })) {}
const period = { from: day.optional(), to: day.optional(), patientId: z.uuid().optional() };
class AppointmentBoardQueryDto extends createZodDto(
  z.object({
    ...period,
    status: z.enum(TEST_APPOINTMENT_STATUSES).optional(),
    departmentId: z.uuid().optional(),
    windowId: z.uuid().optional(),
  }),
) {}
class CollectionBoardQueryDto extends createZodDto(
  z.object({
    ...period,
    status: z.enum(HOME_COLLECTION_STATUSES).optional(),
    areaId: z.uuid().optional(),
    /** `me`: the signed-in collector's own. */
    collectorId: z.union([z.uuid(), z.literal('me')]).optional(),
  }),
) {}

const bookedTest = z.object({ testId: z.uuid(), testName: z.string(), departmentName: z.string(), rate: z.number() });
const count = z.object({ key: z.string(), live: z.int(), cancelled: z.int() });
const appointmentShape = {
  id: z.uuid(),
  number: z.string(),
  appointmentDate: z.string(),
  windowId: z.uuid(),
  windowLabel: z.string(),
  startTime: z.string(),
  endTime: z.string().nullable(),
  serial: z.int(),
  patientId: z.uuid().nullable(),
  uhid: z.int().nullable(),
  patientName: z.string(),
  mobileNo: z.string(),
  tests: z.array(bookedTest),
  amount: z.number(),
  status: z.enum(TEST_APPOINTMENT_STATUSES),
  statusReason: z.string().nullable(),
  billId: z.uuid().nullable(),
  billNumber: z.string().nullable(),
  remarks: z.string().nullable(),
  bookedVia: z.enum(BOOKED_VIA),
  bookedByName: z.string().nullable(),
  createdAt: z.date(),
  version: z.int(),
};
const collectionShape = {
  id: z.uuid(),
  number: z.string(),
  collectionDate: z.string(),
  windowId: z.uuid(),
  windowLabel: z.string(),
  areaId: z.uuid(),
  areaName: z.string(),
  address: z.string(),
  landmark: z.string().nullable(),
  patientId: z.uuid().nullable(),
  uhid: z.int().nullable(),
  patientName: z.string(),
  mobileNo: z.string(),
  tests: z.array(bookedTest),
  amount: z.number(),
  charge: z.number(),
  total: z.number(),
  status: z.enum(HOME_COLLECTION_STATUSES),
  statusReason: z.string().nullable(),
  collectorId: z.uuid().nullable(),
  collectorName: z.string().nullable(),
  assignedAt: z.date().nullable(),
  collectedAt: z.date().nullable(),
  collectedByName: z.string().nullable(),
  collectionNote: z.string().nullable(),
  billId: z.uuid().nullable(),
  billNumber: z.string().nullable(),
  billDue: z.number().nullable(),
  patientNote: z.string().nullable(),
  bookedVia: z.enum(BOOKED_VIA),
  bookedByName: z.string().nullable(),
  createdAt: z.date(),
  version: z.int(),
};
class AvailabilityResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      startTime: z.string(),
      endTime: z.string().nullable(),
      departmentId: z.uuid().nullable(),
      departmentName: z.string().nullable(),
      capacity: z.int(),
      booked: z.int(),
      left: z.int(),
      over: z.boolean(),
    }),
  ),
}) {}
class CollectorsResponseDto extends responseDto({
  items: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
}) {}
class AppointmentBookedResponseDto extends responseDto({ id: z.uuid(), number: z.string(), serial: z.int() }) {}
class CollectionBookedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}
class AppointmentResponseDto extends responseDto(appointmentShape) {}
class CollectionResponseDto extends responseDto(collectionShape) {}
class AppointmentBoardResponseDto extends responseDto({
  items: z.array(z.object(appointmentShape)),
  summary: z.object({
    total: z.int(),
    booked: z.int(),
    billed: z.int(),
    noShow: z.int(),
    cancelled: z.int(),
    amount: z.number(),
    byDepartment: z.array(count),
    byTest: z.array(count),
    byWindow: z.array(count),
  }),
}) {}
class CollectionBoardResponseDto extends responseDto({
  items: z.array(z.object(collectionShape)),
  summary: z.object({
    total: z.int(),
    booked: z.int(),
    assigned: z.int(),
    collected: z.int(),
    cancelled: z.int(),
    unbilled: z.int(),
    amount: z.number(),
    byArea: z.array(count),
    byCollector: z.array(count),
    byWindow: z.array(count),
  }),
}) {}

/**
 * Old test appointment dashboard and setup (step 15f): tests booked for a day in a window, from the desk or the
 * portal; billed on the day with `testAppointmentId` on the diagnostic bill. Slip: report hospital.test-appointment-slip.
 */
@ApiTags('diagnostics')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class TestAppointmentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('test-appointment-availability')
  @RequirePermissions('diag:read')
  @ApiOperation({ summary: 'The windows of a day with their places taken and left' })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  async availability(@CurrentUser() actor: Actor, @Query() query: AvailabilityQueryDto) {
    return {
      items: await this.queryBus.execute(new GetWindowAvailabilityQuery(actor, query.date, query.departmentId ?? null)),
    };
  }

  @Get('test-appointments')
  @RequirePermissions('diag:read')
  @ApiOperation({ summary: 'The bookings of the days (today when left out; a month at most), with their counts' })
  @ApiOkResponse({ type: AppointmentBoardResponseDto })
  board(@CurrentUser() actor: Actor, @Query() query: AppointmentBoardQueryDto) {
    return this.queryBus.execute(new GetTestAppointmentBoardQuery(actor, query));
  }

  @Get('test-appointments/:id')
  @RequirePermissions('diag:read')
  @ApiOkResponse({ type: AppointmentResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetTestAppointmentQuery(actor, params.id));
  }

  @Post('test-appointments')
  @RequirePermissions('diag:book')
  @ApiOperation({ summary: 'Book tests for a day in a window: a serial within its capacity, the tests quoted' })
  @ApiCreatedResponse({ type: AppointmentBookedResponseDto })
  book(@CurrentUser() actor: Actor, @Body() dto: BookAppointmentDto) {
    const { patientId, patientName, mobileNo, ...request } = dto;
    return this.commandBus.execute(
      new BookTestAppointmentCommand(actor, { patientId, patientName, mobileNo }, request),
    );
  }

  @Post('test-appointments/:id/no-show')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async noShow(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: VersionDto) {
    await this.commandBus.execute(new ChangeTestAppointmentCommand(actor, params.id, dto.version, { kind: 'no_show' }));
  }

  @Post('test-appointments/:id/cancel')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ReasonDto) {
    await this.commandBus.execute(
      new ChangeTestAppointmentCommand(actor, params.id, dto.version, { kind: 'cancel', reason: dto.reason }),
    );
  }

  @Post('test-appointments/:id/patient')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The patient registered after booking' })
  @ApiNoContentResponse()
  async attach(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AttachDto) {
    await this.commandBus.execute(
      new ChangeTestAppointmentCommand(actor, params.id, dto.version, { kind: 'attach', patientId: dto.patientId }),
    );
  }
}

/**
 * Old home sample collection (step 15f): a collector sent to an address; billed with `homeCollectionId` on the
 * diagnostic bill (the visit's charge as the policy's service). A collector (diag:collect) sees and records their
 * own; run sheet: report hospital.home-collection-sheet.
 */
@ApiTags('diagnostics')
@ApiBearerAuth()
@Controller({ path: 'hospital', version: '1' })
export class HomeCollectionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('home-collectors')
  @RequirePermissions('diag:book')
  @ApiOperation({ summary: 'The active users who take samples at homes (diag:collect)' })
  @ApiOkResponse({ type: CollectorsResponseDto })
  async collectors(@CurrentUser() actor: Actor) {
    return { items: await this.queryBus.execute(new ListCollectorsQuery(actor)) };
  }

  @Get('home-collections')
  @ApiOperation({ summary: 'The home collections of the days (diag:read; a collector with diag:collect: their own)' })
  @ApiOkResponse({ type: CollectionBoardResponseDto })
  board(@CurrentUser() actor: Actor, @Query() query: CollectionBoardQueryDto) {
    return this.queryBus.execute(new GetHomeCollectionBoardQuery(actor, query));
  }

  @Get('home-collections/:id')
  @ApiOperation({ summary: 'A home collection (diag:read, or its collector)' })
  @ApiOkResponse({ type: CollectionResponseDto })
  get(@CurrentUser() actor: Actor, @Param() params: IdParamDto) {
    return this.queryBus.execute(new GetHomeCollectionQuery(actor, params.id));
  }

  @Post('home-collections')
  @RequirePermissions('diag:book')
  @ApiOperation({ summary: "A collector asked to an address: the area's day, charge and smallest order apply" })
  @ApiCreatedResponse({ type: CollectionBookedResponseDto })
  book(@CurrentUser() actor: Actor, @Body() dto: BookHomeCollectionDto) {
    const { patientId, patientName, mobileNo, ...request } = dto;
    return this.commandBus.execute(new BookHomeCollectionCommand(actor, { patientId, patientName, mobileNo }, request));
  }

  @Post('home-collections/:id/assign')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Give it a collector (a user with diag:collect), or another instead' })
  @ApiNoContentResponse()
  async assign(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AssignDto) {
    await this.commandBus.execute(
      new ChangeHomeCollectionCommand(actor, params.id, dto.version, { kind: 'assign', collectorId: dto.collectorId }),
    );
  }

  @Post('home-collections/:id/collected')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The samples taken at the address (its collector with diag:collect, or the desk)' })
  @ApiNoContentResponse()
  async collected(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CollectedDto) {
    await this.commandBus.execute(
      new ChangeHomeCollectionCommand(actor, params.id, dto.version, { kind: 'collected', note: dto.note }),
    );
  }

  @Post('home-collections/:id/cancel')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancel(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: ReasonDto) {
    await this.commandBus.execute(
      new ChangeHomeCollectionCommand(actor, params.id, dto.version, { kind: 'cancel', reason: dto.reason }),
    );
  }

  @Post('home-collections/:id/patient')
  @RequirePermissions('diag:book')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'The patient registered after booking' })
  @ApiNoContentResponse()
  async attach(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: AttachDto) {
    await this.commandBus.execute(
      new ChangeHomeCollectionCommand(actor, params.id, dto.version, { kind: 'attach', patientId: dto.patientId }),
    );
  }
}

export const BOOKING_CONTROLLERS = [
  TestAppointmentWindowsController,
  HomeCollectionAreasController,
  HomeCollectionWindowsController,
  TestAppointmentsController,
  HomeCollectionsController,
];
