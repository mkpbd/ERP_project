import { Controller, Get, Query } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import {
  GetBalanceSheetQuery,
  GetDayBookQuery,
  GetLedgerQuery,
  GetProfitAndLossQuery,
  GetReceiptsAndPaymentsQuery,
  GetTrialBalanceQuery,
} from '../application/statements.js';
import {
  AsOfQueryDto,
  BalanceSheetResponseDto,
  CashBookQueryDto,
  DayBookResponseDto,
  LedgerQueryDto,
  LedgerResponseDto,
  PeriodQueryDto,
  ProfitAndLossResponseDto,
  ReceiptsAndPaymentsResponseDto,
  TrialBalanceResponseDto,
} from './dto/books.dto.js';

@ApiTags('accounts-books')
@ApiBearerAuth()
@Controller({ path: 'accounts', version: '1' })
export class BooksController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get('books/ledger')
  @RequirePermissions('accounts:read')
  @ApiOperation({ summary: 'An account or sub-ledger statement with opening and running balance (debit positive)' })
  @ApiOkResponse({ type: LedgerResponseDto })
  ledger(@CurrentUser() actor: Actor, @Query() query: LedgerQueryDto) {
    const scope = query.subLedgerId
      ? { subLedgerId: query.subLedgerId, glAccountId: query.glAccountId }
      : { glAccountId: query.glAccountId! };
    return this.queryBus.execute(new GetLedgerQuery(actor, query.from, query.to, scope));
  }

  @Get('books/cash')
  @RequirePermissions('accounts:read')
  @ApiOperation({ summary: 'Cash book or bank book: all cash (or bank) accounts together' })
  @ApiOkResponse({ type: LedgerResponseDto })
  cash(@CurrentUser() actor: Actor, @Query() query: CashBookQueryDto) {
    return this.queryBus.execute(new GetLedgerQuery(actor, query.from, query.to, { kind: query.kind }));
  }

  @Get('books/day-book')
  @RequirePermissions('accounts:read')
  @ApiOperation({ summary: 'Posted vouchers of a period with their lines' })
  @ApiOkResponse({ type: DayBookResponseDto, isArray: true })
  dayBook(@CurrentUser() actor: Actor, @Query() query: PeriodQueryDto) {
    return this.queryBus.execute(new GetDayBookQuery(actor, query.from, query.to));
  }

  @Get('statements/trial-balance')
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: TrialBalanceResponseDto })
  trialBalance(@CurrentUser() actor: Actor, @Query() query: PeriodQueryDto) {
    return this.queryBus.execute(new GetTrialBalanceQuery(actor, query.from, query.to));
  }

  @Get('statements/profit-and-loss')
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: ProfitAndLossResponseDto })
  profitAndLoss(@CurrentUser() actor: Actor, @Query() query: PeriodQueryDto) {
    return this.queryBus.execute(new GetProfitAndLossQuery(actor, query.from, query.to));
  }

  @Get('statements/balance-sheet')
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: BalanceSheetResponseDto })
  balanceSheet(@CurrentUser() actor: Actor, @Query() query: AsOfQueryDto) {
    return this.queryBus.execute(new GetBalanceSheetQuery(actor, query.asOf));
  }

  @Get('statements/receipts-and-payments')
  @RequirePermissions('accounts:read')
  @ApiOkResponse({ type: ReceiptsAndPaymentsResponseDto })
  receiptsAndPayments(@CurrentUser() actor: Actor, @Query() query: PeriodQueryDto) {
    return this.queryBus.execute(new GetReceiptsAndPaymentsQuery(actor, query.from, query.to));
  }
}
