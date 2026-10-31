import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, UseGuards } from '@nestjs/common';
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
import { AuthRateLimit, Public } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  PortalBookAppointmentCommand,
  PortalBookHomeCollectionCommand,
  PortalBookingsQuery,
  PortalCancelBookingCommand,
  PortalHomeCollectionOfferQuery,
  PortalPreparationsQuery,
  PortalTestCatalogueQuery,
  PortalWindowsQuery,
} from '../application/portal-booking.handlers.js';
import type { PortalClaims } from '../application/portal.ports.js';
import { CurrentPatient, PortalGuard } from './portal.guard.js';

const day = z.iso.date();
const testIds = z.array(z.uuid()).min(1).max(20);
class CatalogueQueryDto extends createZodDto(z.object({ q: z.string().trim().min(1).max(100).optional() })) {}
class WindowsQueryDto extends createZodDto(z.object({ date: day, departmentId: z.uuid().optional() })) {}
class BookAppointmentDto extends createZodDto(
  z.strictObject({
    appointmentDate: day,
    windowId: z.uuid(),
    testIds,
    remarks: z.string().trim().max(300).nullable().default(null),
  }),
) {}
class BookHomeCollectionDto extends createZodDto(
  z.strictObject({
    collectionDate: day,
    windowId: z.uuid(),
    areaId: z.uuid(),
    address: z.string().trim().min(1).max(300),
    landmark: z.string().trim().max(150).nullable().default(null),
    testIds,
    note: z.string().trim().max(300).nullable().default(null),
  }),
) {}

const bookedTest = z.object({ testId: z.uuid(), testName: z.string(), departmentName: z.string(), rate: z.number() });
class CatalogueResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      rate: z.number(),
      departmentId: z.uuid(),
      departmentName: z.string(),
      departmentKind: z.enum(['lab', 'imaging']),
    }),
  ),
}) {}
class WindowsResponseDto extends responseDto({
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
class OfferResponseDto extends responseDto({
  areas: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      charge: z.number(),
      minimumOrder: z.number(),
      days: z.array(z.string()),
    }),
  ),
  windows: z.array(z.object({ id: z.uuid(), label: z.string() })),
}) {}
class PreparationsResponseDto extends responseDto({
  items: z.array(
    z.object({
      id: z.uuid(),
      departmentId: z.uuid().nullable(),
      departmentName: z.string().nullable(),
      testId: z.uuid().nullable(),
      testName: z.string().nullable(),
      title: z.string(),
      titleBn: z.string().nullable(),
      instructions: z.string().nullable(),
      instructionsBn: z.string().nullable(),
      videoUrl: z.string().nullable(),
    }),
  ),
}) {}
class BookingsResponseDto extends responseDto({
  appointments: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      appointmentDate: z.string(),
      windowLabel: z.string(),
      startTime: z.string(),
      endTime: z.string().nullable(),
      serial: z.int(),
      tests: z.array(bookedTest),
      amount: z.number(),
      status: z.enum(['booked', 'billed', 'no_show', 'cancelled']),
      statusReason: z.string().nullable(),
    }),
  ),
  homeCollections: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      collectionDate: z.string(),
      windowLabel: z.string(),
      areaName: z.string(),
      address: z.string(),
      landmark: z.string().nullable(),
      tests: z.array(bookedTest),
      amount: z.number(),
      charge: z.number(),
      status: z.enum(['booked', 'assigned', 'collected', 'cancelled']),
      statusReason: z.string().nullable(),
    }),
  ),
}) {}
class AppointmentBookedResponseDto extends responseDto({ id: z.uuid(), number: z.string(), serial: z.int() }) {}
class CollectionBookedResponseDto extends responseDto({ id: z.uuid(), number: z.string() }) {}

/**
 * Test appointments and home collections on the portal (step 15f; old: the patients' mobile app). The tests, windows
 * and areas need no sign-in; booking, the patient's own bookings and cancelling them do (at most 3 waiting of each).
 */
@ApiTags('portal')
@Public()
@Controller({ path: 'portal', version: '1' })
export class PortalBookingController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('tests')
  @ApiOperation({ summary: 'The tests a patient may book, with their rates' })
  @ApiOkResponse({ type: CatalogueResponseDto })
  async tests(@Query() query: CatalogueQueryDto) {
    return { items: await this.queryBus.execute(new PortalTestCatalogueQuery(query.q ?? null)) };
  }

  @Get('test-appointment-windows')
  @ApiOperation({ summary: "A day's windows (for a department: its own and any department's), with places left" })
  @ApiOkResponse({ type: WindowsResponseDto })
  async windows(@Query() query: WindowsQueryDto) {
    return { items: await this.queryBus.execute(new PortalWindowsQuery(query.date, query.departmentId ?? null)) };
  }

  @Get('home-collection-offer')
  @ApiOperation({ summary: 'The areas served (charge, smallest order, days) and the windows offered' })
  @ApiOkResponse({ type: OfferResponseDto })
  offer() {
    return this.queryBus.execute(new PortalHomeCollectionOfferQuery());
  }

  @Get('test-preparations')
  @ApiOperation({ summary: 'What to do before a test, in English and Bangla, with a video link' })
  @ApiOkResponse({ type: PreparationsResponseDto })
  async preparations() {
    return { items: await this.queryBus.execute(new PortalPreparationsQuery()) };
  }

  @Get('bookings')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "The patient's own test appointments and home collections, newest first" })
  @ApiOkResponse({ type: BookingsResponseDto })
  bookings(@CurrentPatient() patient: PortalClaims) {
    return this.queryBus.execute(new PortalBookingsQuery(patient));
  }

  @Post('test-appointments')
  @UseGuards(PortalGuard)
  @AuthRateLimit()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Book tests for a day in a window (paid when billed on the day)' })
  @ApiCreatedResponse({ type: AppointmentBookedResponseDto })
  bookAppointment(@CurrentPatient() patient: PortalClaims, @Body() dto: BookAppointmentDto) {
    return this.commandBus.execute(new PortalBookAppointmentCommand(patient, dto));
  }

  @Post('test-appointments/:id/cancel')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancelAppointment(@CurrentPatient() patient: PortalClaims, @Param() params: IdParamDto) {
    await this.commandBus.execute(new PortalCancelBookingCommand(patient, 'appointment', params.id));
  }

  @Post('home-collections')
  @UseGuards(PortalGuard)
  @AuthRateLimit()
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ask for a collector at an address: the area sets the charge, smallest order and days' })
  @ApiCreatedResponse({ type: CollectionBookedResponseDto })
  bookHomeCollection(@CurrentPatient() patient: PortalClaims, @Body() dto: BookHomeCollectionDto) {
    return this.commandBus.execute(new PortalBookHomeCollectionCommand(patient, dto));
  }

  @Post('home-collections/:id/cancel')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async cancelHomeCollection(@CurrentPatient() patient: PortalClaims, @Param() params: IdParamDto) {
    await this.commandBus.execute(new PortalCancelBookingCommand(patient, 'home_collection', params.id));
  }
}
