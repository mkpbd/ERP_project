import { randomUUID } from 'node:crypto';
import { and, eq, inArray, like, lte, sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import {
  glAccounts,
  glRoles,
  voucherLines,
  vouchers,
} from '../../modules/accounts/infrastructure/persistence/accounts.schema.js';
import { canteenSales } from '../../modules/canteen/infrastructure/persistence/canteen.schema.js';
import { etlIdMap, etlRuns } from '../../modules/data-migration/infrastructure/persistence/data-migration.schema.js';
import {
  admissions,
  doctorLedger,
  ipdPayments,
} from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { pfLedgerEntries, staffDues } from '../../modules/payroll/infrastructure/persistence/payroll.schema.js';
import { pharmacyMovements } from '../../modules/pharmacy/infrastructure/persistence/pharmacy.schema.js';
import {
  items,
  itemVariants,
  stockMovements,
} from '../../modules/supply-chain/infrastructure/persistence/supply-chain.schema.js';
import { dayBefore } from './account-records.js';
import type { LegacySource } from './etl.js';

export type CheckStatus = 'ok' | 'check' | 'fail';

/** One line of the reconciliation: what the old system says, what this one says. */
export interface Check {
  readonly area: string;
  readonly item: string;
  readonly old: number | null;
  readonly new: number | null;
  readonly status: CheckStatus;
  readonly note: string | null;
}

export interface Reconciliation {
  readonly kind: 'reconciliation';
  readonly cutOver: string;
  readonly verdict: 'go' | 'go-with-notes' | 'no-go';
  readonly checks: Check[];
}

const paisa = (value: number) => Math.round(value * 100);

/**
 * Old and new side by side: equal is ok; a difference is to be checked (records the loaders reported left out), or,
 * where nothing may differ (the books), a failure.
 */
export function compare(
  area: string,
  item: string,
  old: number | null,
  now: number | null,
  options: { strict?: boolean; note?: string } = {},
): Check {
  const same = old !== null && now !== null && paisa(old) === paisa(now);
  return {
    area,
    item,
    old,
    new: now,
    status: same ? 'ok' : options.strict ? 'fail' : 'check',
    note: same ? null : (options.note ?? 'See the loader reports for what was left out'),
  };
}

export function verdict(checks: readonly Check[]): Reconciliation['verdict'] {
  if (checks.some((check) => check.status === 'fail')) return 'no-go';
  return checks.some((check) => check.status === 'check') ? 'go-with-notes' : 'go';
}

/** Each reconciliation query is marked, so a rehearsal's log can be read back query by query. */
const marked = (key: string, query: string) => `/* reconcile:${key} */ ${query}`;

async function oldNumber(source: LegacySource, key: string, query: string, params: Record<string, unknown> = {}) {
  const [row] = await source.query<{ n: number | null }>(marked(key, query), params);
  return Number(row?.n ?? 0);
}

async function mapped(db: DbContext, entity: string): Promise<number> {
  const [row] = await db.db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(etlIdMap)
    .where(eq(etlIdMap.entity, entity));
  return row?.n ?? 0;
}

/** Balances (debit positive) of accounts here up to a day, posted vouchers only. */
async function balances(db: DbContext, accountIds: readonly string[], on: string): Promise<Map<string, number>> {
  if (accountIds.length === 0) return new Map();
  const rows = await db.db
    .select({
      account: voucherLines.glAccountId,
      net: sql<number>`coalesce(sum(${voucherLines.debit} - ${voucherLines.credit}), 0)`.mapWith(Number),
    })
    .from(voucherLines)
    .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
    .where(
      and(
        inArray(voucherLines.glAccountId, [...accountIds]),
        lte(vouchers.voucherDate, on),
        sql`${vouchers.status} <> 'draft'`,
      ),
    )
    .groupBy(voucherLines.glAccountId);
  return new Map(rows.map((row) => [row.account, row.net]));
}

/** The old books' trial balance against the books here on the day before the cut-over, account by account. */
async function books(db: DbContext, source: LegacySource, cutOver: string, on: string): Promise<Check[]> {
  const old = await source.query<{ GeneralLedgerId: string; Debit: number | null; Credit: number | null }>(
    marked(
      'books',
      `SELECT CAST(d.[GeneralLedgerId] AS nvarchar(36)) AS [GeneralLedgerId],
        SUM(CAST(d.[Debit] AS decimal(19, 4))) AS [Debit], SUM(CAST(d.[Credit] AS decimal(19, 4))) AS [Credit]
        FROM [Account].[VoucherMasterDetails] d JOIN [Account].[VoucherMasters] m ON m.[Id] = d.[VoucherMasterId]
        WHERE m.[IsDeleted] = 0 AND d.[IsDeleted] = 0 AND m.[VoucherDate] < @cutOver GROUP BY d.[GeneralLedgerId]`,
    ),
    { cutOver },
  );
  const accounts = new Map(
    (
      await db.db
        .select({ oldId: etlIdMap.oldId, newId: etlIdMap.newId })
        .from(etlIdMap)
        .where(eq(etlIdMap.entity, 'gl-account'))
    ).map((row) => [row.oldId, row.newId]),
  );
  const expected = new Map<string, number>();
  let unmapped = 0;
  let oldDebit = 0;
  for (const row of old) {
    const net = paisa(Number(row.Debit ?? 0)) - paisa(Number(row.Credit ?? 0));
    if (net === 0) continue;
    if (net > 0) oldDebit += net;
    const account = accounts.get(row.GeneralLedgerId.toLowerCase());
    if (!account) {
      unmapped += net;
      continue;
    }
    expected.set(account, (expected.get(account) ?? 0) + net);
  }
  const here = await balances(db, [...new Set([...expected.keys()])], on);
  const codes = new Map(
    expected.size
      ? (
          await db.db
            .select({ id: glAccounts.id, code: glAccounts.code })
            .from(glAccounts)
            .where(inArray(glAccounts.id, [...expected.keys()]))
        ).map((row) => [row.id, row.code])
      : [],
  );
  const differing = [...expected].filter(([account, net]) => paisa(here.get(account) ?? 0) !== net);
  const off = differing.reduce((sum, [account, net]) => sum + Math.abs(paisa(here.get(account) ?? 0) - net), 0);
  const newDebit = [...here.values()].reduce((sum, net) => sum + Math.max(paisa(net), 0), 0);
  const checks: Check[] = [
    {
      area: 'Books',
      item: 'Trial balance, debit side',
      old: oldDebit / 100,
      new: newDebit / 100,
      status:
        differing.length === 0 && oldDebit === newDebit
          ? 'ok'
          : off >= 100 || (oldDebit !== newDebit && off === 0)
            ? 'fail'
            : 'check',
      note:
        differing.length === 0
          ? null
          : `${differing.length} account(s) differ by ${(off / 100).toFixed(2)} in all: ${differing
              .slice(0, 10)
              .map(([account]) => codes.get(account) ?? account)
              .join(', ')}${off < 100 ? ' (old float rounding, taken up on the opening)' : ''}`,
    },
  ];
  if (unmapped) {
    checks.push({
      area: 'Books',
      item: 'Balances on accounts not brought over',
      old: unmapped / 100,
      new: null,
      status: 'fail',
      note: 'Bring the accounts over, then the opening balances',
    });
  }
  return checks;
}

/** Runs the reconciliation of a cut-over: counts, books, stock, admitted patients and dues. */
export async function reconcile(db: DbContext, source: LegacySource, cutOver: string): Promise<Reconciliation> {
  const on = dayBefore(cutOver);
  const checks: Check[] = [];
  const counts: [string, string, string][] = [
    ['Users', 'user', 'SELECT COUNT(*) AS [n] FROM [Identity].[Users]'],
    ['Doctors', 'doctor', 'SELECT COUNT(*) AS [n] FROM [Marketing].[Doctors]'],
    ['Patients', 'patient', 'SELECT COUNT(*) AS [n] FROM [Hospital].[RegRecords]'],
    ['Staff', 'staff', 'SELECT COUNT(*) AS [n] FROM [HR].[StaffRecords] WHERE [IsDeleted] = 0'],
    ['GL accounts', 'gl-account', 'SELECT COUNT(*) AS [n] FROM [Account].[GeneralLedgers]'],
    ['Suppliers', 'supplier', 'SELECT COUNT(*) AS [n] FROM [SupplyChain].[Suppliers]'],
    ['Pharmacy products', 'product', 'SELECT COUNT(*) AS [n] FROM [Pharmacy].[BrandExtensions]'],
    ['Store items', 'item-variant', 'SELECT COUNT(*) AS [n] FROM [SupplyChain].[BrandExtensions]'],
    ['Lab reports', 'lab-history', 'SELECT COUNT(*) AS [n] FROM [Diag].[PathologyReports] WHERE [IsDeleted] = 0'],
    [
      'Prescriptions',
      'prescription-history',
      'SELECT COUNT(*) AS [n] FROM [Rx].[VisitHistories] WHERE [IsDeleted] = 0',
    ],
  ];
  for (const [item, entity, query] of counts) {
    checks.push(compare('Records', item, await oldNumber(source, `count:${entity}`, query), await mapped(db, entity)));
  }

  checks.push(...(await books(db, source, cutOver, on)));

  // Stock: what the old pharmacy held (live lots) against the opening here, and stock against its accounts.
  const [pharmacy] = await db.db
    .select({
      units: sql<number>`coalesce(sum(${pharmacyMovements.qty}), 0)`.mapWith(Number),
      value: sql<number>`coalesce(sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost}), 0)`.mapWith(Number),
    })
    .from(pharmacyMovements)
    .where(lte(pharmacyMovements.movedOn, on));
  checks.push(
    compare(
      'Stock',
      'Pharmacy units in date',
      await oldNumber(
        source,
        'pharmacy-units',
        `SELECT SUM([AvailableStock]) AS [n] FROM [Pharmacy].[Stocks]
          WHERE [IsDeleted] = 0 AND [AvailableStock] > 0 AND [ExpireDate] >= @cutOver`,
        { cutOver },
      ),
      pharmacy?.units ?? 0,
      { note: 'Old rows below zero were netted per product; part units rounded' },
    ),
  );
  const [pharmacyRole] = await db.db.select().from(glRoles).where(eq(glRoles.role, 'pharmacy_inventory'));
  if (pharmacyRole) {
    const book = (await balances(db, [pharmacyRole.glAccountId], on)).get(pharmacyRole.glAccountId) ?? 0;
    checks.push(
      compare('Stock', 'Pharmacy stock value against its account', book, pharmacy?.value ?? 0, {
        note: 'An adjustment voucher clears it: the old books were not always posted from stock',
      }),
    );
  }
  const stores = await db.db
    .select({
      account: items.typeGlAccountId,
      code: glAccounts.code,
      value: sql<number>`coalesce(sum(${stockMovements.qty} * ${stockMovements.unitCost}), 0)`.mapWith(Number),
    })
    .from(stockMovements)
    .innerJoin(itemVariants, eq(itemVariants.id, stockMovements.variantId))
    .innerJoin(items, eq(items.id, itemVariants.itemId))
    .leftJoin(glAccounts, eq(glAccounts.id, items.typeGlAccountId))
    .where(lte(stockMovements.movedOn, on))
    .groupBy(items.typeGlAccountId, glAccounts.code);
  const storeBooks = await balances(
    db,
    stores.flatMap((row) => (row.account ? [row.account] : [])),
    on,
  );
  for (const row of stores) {
    checks.push(
      compare(
        'Stock',
        `Store stock value against account ${row.code ?? '(none)'}`,
        row.account ? (storeBooks.get(row.account) ?? 0) : null,
        row.value,
        { note: 'An adjustment voucher clears it: the old books were not always posted from stock' },
      ),
    );
  }

  // Patients in their beds, and what they had paid in advance.
  const admitted = `FROM [Hospital].[IPDPatientRecords] p WHERE p.[IsDeleted] = 0 AND p.[Status] = 'Admitted'
    AND p.[AdmissionDateTime] < @cutOver`;
  const brought = await db.db.select({ id: etlIdMap.newId }).from(etlIdMap).where(eq(etlIdMap.entity, 'admission'));
  const [open] = brought.length
    ? await db.db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(admissions)
        .where(
          and(
            inArray(
              admissions.id,
              brought.map((row) => row.id),
            ),
            eq(admissions.status, 'admitted'),
          ),
        )
    : [{ n: 0 }];
  checks.push(
    compare(
      'Admitted patients',
      'Patients in their beds',
      await oldNumber(source, 'admitted', `SELECT COUNT(*) AS [n] ${admitted}`, { cutOver }),
      open?.n ?? 0,
    ),
  );
  const [held] = brought.length
    ? await db.db
        .select({
          n: sql<number>`coalesce(sum(case when ${ipdPayments.kind} = 'advance' then ${ipdPayments.amount} else -${ipdPayments.amount} end), 0)`.mapWith(
            Number,
          ),
        })
        .from(ipdPayments)
        .where(
          and(
            inArray(
              ipdPayments.admissionId,
              brought.map((row) => row.id),
            ),
            inArray(ipdPayments.kind, ['advance', 'refund']),
          ),
        )
    : [{ n: 0 }];
  checks.push(
    compare(
      'Admitted patients',
      'Advances held',
      await oldNumber(
        source,
        'advances',
        `SELECT SUM(CASE a.[TransactionType] WHEN 2 THEN a.[Amount] WHEN 5 THEN -a.[Amount] ELSE 0 END) AS [n]
          FROM [Hospital].[AdvancePayments] a JOIN [Hospital].[IPDPatientRecords] p ON p.[Id] = a.[IPDPatientId]
          WHERE a.[IsDeleted] = 0 AND a.[PayDate] < @cutOver AND p.[IsDeleted] = 0 AND p.[Status] = 'Admitted'
          AND p.[AdmissionDateTime] < @cutOver`,
        { cutOver },
      ),
      held?.n ?? 0,
    ),
  );

  // Balances carried as openings.
  const [doctors] = await db.db
    .select({ n: sql<number>`coalesce(sum(${doctorLedger.amount}), 0)`.mapWith(Number) })
    .from(doctorLedger)
    .where(like(doctorLedger.documentNumber, 'OPENING-%'));
  checks.push(
    compare(
      'Dues',
      'Owed to doctors',
      await oldNumber(
        source,
        'doctor-payables',
        `SELECT SUM(CAST([Credit] AS decimal(19, 4)) - CAST([Debit] AS decimal(19, 4))) AS [n]
          FROM [Account].[ConsultantGlobalLedgers] WHERE [IsDeleted] = 0 AND [TranDate] < @cutOver`,
        { cutOver },
      ),
      doctors?.n ?? 0,
    ),
  );
  const [staff] = await db.db
    .select({ n: sql<number>`coalesce(sum(${staffDues.debit} - ${staffDues.credit}), 0)`.mapWith(Number) })
    .from(staffDues)
    .where(like(staffDues.reference, 'OPENING-%'));
  checks.push(
    compare(
      'Dues',
      'Owed by staff',
      await oldNumber(
        source,
        'staff-dues',
        `SELECT SUM(CAST([Debit] AS decimal(19, 4)) - CAST([Credit] AS decimal(19, 4))) AS [n]
          FROM [Payroll].[StaffGlobalLedgers] WHERE [IsDeleted] = 0 AND [CreatedOn] < @cutOver`,
        { cutOver },
      ),
      staff?.n ?? 0,
    ),
  );
  const [canteen] = await db.db
    .select({ n: sql<number>`coalesce(sum(${canteenSales.due}), 0)`.mapWith(Number) })
    .from(canteenSales)
    .where(eq(canteenSales.customerName, 'Due in the old system'));
  checks.push(
    compare(
      'Dues',
      'Owed by canteen members',
      await oldNumber(
        source,
        'canteen-dues',
        `SELECT SUM(CASE WHEN [n] > 0 THEN [n] ELSE 0 END) AS [n] FROM (
           SELECT SUM(CAST([Debit] AS decimal(19, 4)) - CAST([Credit] AS decimal(19, 4))) AS [n]
           FROM [Account].[LoyalMemberLedgers] WHERE [IsDeleted] = 0 AND ISNULL([Invdate], [CreatedOn]) < @cutOver
           GROUP BY [LoyalMemberId]) m`,
        { cutOver },
      ),
      canteen?.n ?? 0,
    ),
  );
  const [pf] = await db.db
    .select({ n: sql<number>`coalesce(sum(${pfLedgerEntries.credit} - ${pfLedgerEntries.debit}), 0)`.mapWith(Number) })
    .from(pfLedgerEntries)
    .where(eq(pfLedgerEntries.type, 'opening'));
  checks.push(
    compare(
      'Dues',
      'PF held for staff',
      await oldNumber(
        source,
        'pf',
        `SELECT SUM(CAST([Credit] AS decimal(19, 4)) - CAST([Debit] AS decimal(19, 4))) AS [n]
          FROM [Payroll].[PFLedgers] WHERE [IsDeleted] = 0 AND [TranDate] < @cutOver`,
        { cutOver },
      ),
      pf?.n ?? 0,
    ),
  );

  return { kind: 'reconciliation', cutOver, verdict: verdict(checks), checks };
}

/** Reconciles and logs the result in etl_runs (loaders: reconcile), to be printed and signed in the app. */
export async function runReconciliation(params: {
  db: DbContext;
  source: LegacySource;
  cutOver: string;
  now?: Date;
}): Promise<{ runId: string; result: Reconciliation }> {
  const runId = randomUUID();
  const startedAt = params.now ?? new Date();
  const result = await reconcile(params.db, params.source, params.cutOver);
  await params.db.db.insert(etlRuns).values({
    id: runId,
    startedAt,
    finishedAt: new Date(),
    dryRun: false,
    loaders: ['reconcile'],
    status: 'done',
    rejected: result.checks.filter((check) => check.status === 'fail').length,
    report: result,
  });
  return { runId, result };
}
