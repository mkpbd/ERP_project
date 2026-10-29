import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  ApiAcceptedResponse,
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { z } from 'zod';
import { AuthRateLimit, Public } from '../../../shared/presentation/auth.decorators.js';
import { responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import {
  EndSessionCommand,
  PortalDocumentsQuery,
  PortalProfileQuery,
  PrintDocumentQuery,
  RequestOtpCommand,
  StartSessionCommand,
} from '../application/portal.handlers.js';
import type { PortalClaims } from '../application/portal.ports.js';
import { CurrentPatient, PortalGuard } from './portal.guard.js';

class PortalOtpRequestDto extends createZodDto(
  z.strictObject({
    uhid: z.int().min(1).max(9_999_999_999),
    /** The patient's mobile (or their contact's) or email, as registered. */
    contact: z.string().trim().min(5).max(100),
  }),
) {}
class PortalSessionDto extends createZodDto(
  z.strictObject({ challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }),
) {}
class PortalDocumentParamDto extends createZodDto(z.object({ ref: z.string().regex(/^[a-z-]+:[0-9a-f-]{36}$/) })) {}

class PortalOtpResponseDto extends responseDto({ challengeId: z.uuid(), sentTo: z.string(), expiresAt: z.date() }) {}
class PortalSessionResponseDto extends responseDto({
  accessToken: z.string(),
  expiresAt: z.date(),
  patient: z.object({ name: z.string(), uhid: z.int() }),
}) {}
class PortalProfileResponseDto extends responseDto({
  name: z.string(),
  uhid: z.int(),
  sex: z.string(),
  dateOfBirth: z.string(),
  bloodGroup: z.string().nullable(),
}) {}
class PortalDocumentsResponseDto extends responseDto({
  items: z.array(
    z.object({
      ref: z.string(),
      kind: z.string(),
      title: z.string(),
      number: z.string(),
      on: z.string(),
      available: z.boolean(),
      heldReason: z.string().nullable(),
    }),
  ),
}) {}

/**
 * The patient portal (old AnonymousUser OTP flow): a patient signs in with their UHID and a code sent to their mobile
 * or email, and reads their own documents. Public to the staff sign-in; the patient's own token guards the rest.
 */
@ApiTags('portal')
@Public()
@Controller({ path: 'portal', version: '1' })
export class PortalController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post('otp')
  @AuthRateLimit()
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary:
      'Send a sign-in code to the mobile or email given, when it is the patient’s; the answer is the same either way',
  })
  @ApiAcceptedResponse({ type: PortalOtpResponseDto })
  otp(@Body() dto: PortalOtpRequestDto) {
    return this.commandBus.execute(new RequestOtpCommand(dto.uhid, dto.contact));
  }

  @Post('session')
  @AuthRateLimit()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with the code: a 30-minute patient token' })
  @ApiOkResponse({ type: PortalSessionResponseDto })
  session(@Body() dto: PortalSessionDto) {
    return this.commandBus.execute(new StartSessionCommand(dto.challengeId, dto.code));
  }

  @Post('logout')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiNoContentResponse()
  async logout(@CurrentPatient() patient: PortalClaims) {
    await this.commandBus.execute(new EndSessionCommand(patient));
  }

  @Get('me')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiOkResponse({ type: PortalProfileResponseDto })
  me(@CurrentPatient() patient: PortalClaims) {
    return this.queryBus.execute(new PortalProfileQuery(patient));
  }

  @Get('documents')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The patient’s reports, prescriptions, discharge summaries and receipts, newest first' })
  @ApiOkResponse({ type: PortalDocumentsResponseDto })
  async documents(@CurrentPatient() patient: PortalClaims) {
    return { items: await this.queryBus.execute(new PortalDocumentsQuery(patient)) };
  }

  @Get('documents/:ref/pdf')
  @UseGuards(PortalGuard)
  @ApiBearerAuth()
  @ApiProduces('application/pdf')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  async print(
    @CurrentPatient() patient: PortalClaims,
    @Param() params: PortalDocumentParamDto,
  ): Promise<StreamableFile> {
    const file = await this.queryBus.execute(new PrintDocumentQuery(patient, params.ref));
    return new StreamableFile(file.data, {
      type: file.contentType,
      disposition: `inline; filename="${file.fileName}"`,
      length: file.data.length,
    });
  }
}
