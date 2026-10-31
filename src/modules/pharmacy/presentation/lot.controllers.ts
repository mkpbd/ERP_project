import { Body, Controller, Param, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiCreatedResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { IdParamDto, responseDto } from '../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../shared/presentation/zod/zod-dto.js';
import { CorrectLotCommand } from '../application/lot.handlers.js';

class CorrectLotDto extends createZodDto(
  z.strictObject({
    batchNo: z.string().trim().max(50).nullable(),
    expiryDate: z.iso.date(),
    saleRate: z.number().min(0).max(10_000_000).multipleOf(0.01),
    reason: z.string().trim().min(1).max(300),
    /** The day the units move to the corrected lot. */
    correctedOn: z.iso.date(),
  }),
) {}
class LotCorrectedResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  toLotId: z.uuid(),
  units: z.int(),
}) {}

/** Old Update Product In Stock (step 15g): a lot entered with the wrong batch, expiry or sale rate. */
@ApiTags('pharmacy-stock')
@ApiBearerAuth()
@Controller({ path: 'pharmacy', version: '1' })
export class LotsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post('lots/:id/correct')
  @RequirePermissions('pharmacy:manage')
  @ApiOperation({
    summary: "Move a lot's units in stock, at every outlet, to the lot as it should have been (batch, expiry, rate)",
  })
  @ApiCreatedResponse({ type: LotCorrectedResponseDto })
  correct(@CurrentUser() actor: Actor, @Param() params: IdParamDto, @Body() dto: CorrectLotDto) {
    const { reason, correctedOn, ...wanted } = dto;
    return this.commandBus.execute(new CorrectLotCommand(actor, params.id, wanted, reason, correctedOn));
  }
}
