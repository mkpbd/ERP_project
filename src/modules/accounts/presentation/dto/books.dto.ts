import { z } from 'zod';
import { responseDto } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const period = { from: day, to: day };

export class LedgerQueryDto extends createZodDto(
  z
    .object({ ...period, glAccountId: z.uuid().optional(), subLedgerId: z.uuid().optional() })
    .refine((value) => value.glAccountId !== undefined || value.subLedgerId !== undefined, {
      message: 'Give glAccountId, subLedgerId or both',
      path: ['glAccountId'],
    }),
) {}
export class CashBookQueryDto extends createZodDto(
  z.object({ ...period, kind: z.enum(['cash', 'bank']).default('cash') }),
) {}
export class PeriodQueryDto extends createZodDto(z.object(period)) {}
export class AsOfQueryDto extends createZodDto(z.object({ asOf: day })) {}

export class LedgerResponseDto extends responseDto({
  title: z.string(),
  opening: z.number(),
  rows: z.array(
    z.object({
      date: z.string(),
      voucherId: z.uuid(),
      voucherNumber: z.string(),
      narration: z.string().nullable(),
      contra: z.string(),
      debit: z.number(),
      credit: z.number(),
      balance: z.number(),
    }),
  ),
  totalDebit: z.number(),
  totalCredit: z.number(),
  closing: z.number(),
}) {}

export class DayBookResponseDto extends responseDto({
  id: z.uuid(),
  number: z.string(),
  voucherDate: z.string(),
  journal: z.string(),
  narration: z.string().nullable(),
  total: z.number(),
  lines: z.array(z.object({ code: z.string(), name: z.string(), debit: z.number(), credit: z.number() })),
}) {}

const amounts = {
  opening: z.number(),
  debit: z.number(),
  credit: z.number(),
  closingDebit: z.number(),
  closingCredit: z.number(),
};
export class TrialBalanceResponseDto extends responseDto({
  rows: z.array(z.object({ code: z.string(), name: z.string(), nature: z.string(), ...amounts })),
  totals: z.object(amounts),
  balanced: z.boolean(),
}) {}

const section = z.object({
  nature: z.string(),
  normalBalance: z.enum(['debit', 'credit']),
  total: z.number(),
  groups: z.array(
    z.object({
      title: z.string(),
      total: z.number(),
      accounts: z.array(z.object({ code: z.string(), name: z.string(), amount: z.number() })),
    }),
  ),
});
export class ProfitAndLossResponseDto extends responseDto({ sections: z.array(section), netProfit: z.number() }) {}
export class BalanceSheetResponseDto extends responseDto({
  debitSections: z.array(section),
  creditSections: z.array(section),
  profitToDate: z.number(),
  totalDebit: z.number(),
  totalCredit: z.number(),
  balanced: z.boolean(),
}) {}
const flow = z.array(z.object({ code: z.string(), name: z.string(), amount: z.number() }));
export class ReceiptsAndPaymentsResponseDto extends responseDto({
  opening: z.number(),
  receipts: flow,
  payments: flow,
  totalReceipts: z.number(),
  totalPayments: z.number(),
  closing: z.number(),
}) {}
