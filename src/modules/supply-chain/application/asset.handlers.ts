import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { LedgerPosting, type LedgerPostingLine } from '../../../shared/application/contracts/ledger-posting.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import {
  defaultStartDate,
  dueCharges,
  openingState,
  statusAfter,
  validTerms,
  type DepreciationTerms,
  type Frequency,
} from '../domain/depreciation.js';
import { paisa, taka } from '../domain/documents.js';
import { DepreciationRepository, type DepreciationRecord, type RunEntry } from '../domain/repositories.js';
import { PurchaseDesk } from './purchase.handlers.js';
import { PURCHASE_JOURNAL } from './stock.handlers.js';
import { SCM_ASSETS, SCM_READ } from './supply-chain.constants.js';

/** GL roles of depreciation (old AssetDepreciationSetting's two accounts). */
export const DEPRECIATION_EXPENSE_ROLE = 'depreciation_expense';
export const ACCUMULATED_DEPRECIATION_ROLE = 'accumulated_depreciation';

export interface AssetSummary {
  readonly id: string;
  readonly assetNo: string;
  readonly variantId: string;
  readonly itemName: string;
  readonly variantName: string;
  readonly status: string;
  readonly placeName: string | null;
  readonly mainStoreId: string | null;
  readonly subStoreId: string | null;
  readonly departmentId: string | null;
  readonly cost: number;
  readonly acquiredOn: string;
  readonly sourceNumber: string;
  readonly serialNo: string | null;
  readonly accumulated: number | null;
  readonly bookValue: number;
  readonly depreciationStatus: string | null;
}

export interface AssetView extends AssetSummary {
  readonly batchNo: string | null;
  readonly expiryDate: string | null;
  readonly supplierName: string | null;
  readonly note: string | null;
  readonly depreciation: DepreciationRecord | null;
  readonly charges: { runNumber: string; periodEnd: string; amount: number }[];
}

export interface AssetFilter extends PageRequest {
  readonly status?: string | undefined;
  readonly variantId?: string | undefined;
  readonly mainStoreId?: string | undefined;
  readonly subStoreId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly q?: string | undefined;
}

export interface RunPreview {
  readonly asOf: string;
  readonly assetCount: number;
  readonly total: number;
  readonly lines: { assetId: string; assetNo: string; periods: number; amount: number }[];
}

export interface RunSummary {
  readonly id: string;
  readonly number: string;
  readonly asOf: string;
  readonly status: string;
  readonly assetCount: number;
  readonly total: number;
  readonly voucherNumber: string | null;
  readonly reversalVoucherNumber: string | null;
}

export abstract class AssetReadRepository {
  abstract list(filter: AssetFilter): Promise<Page<AssetSummary>>;
  abstract get(id: string): Promise<AssetView | null>;
  abstract assetNumbers(ids: readonly string[]): Promise<Map<string, string>>;
  abstract runs(request: PageRequest): Promise<Page<RunSummary>>;
  abstract run(id: string): Promise<(RunSummary & { entries: (RunEntry & { assetNo: string })[] }) | null>;
  /** Edits what is written on the piece (serial number, note). */
  abstract describe(id: string, changes: { serialNo?: string | null; note?: string | null }): Promise<boolean>;
}

export interface ConfigureTerms {
  readonly frequency: Frequency;
  readonly lifeMonths: number;
  /** Either an amount (one asset) or a share of each piece's cost. */
  readonly residual: { amount: number } | { percent: number };
  /** Default: the 1st of the month after acquisition (old rule). */
  readonly startDate: string | null;
  /** Depreciation already charged before this system (old "Manual" opening; one asset only). */
  readonly opening: { accumulated: number; asOf: string } | null;
  /** Override the piece's cost (one asset only). */
  readonly cost: number | null;
}

export class ConfigureDepreciationCommand extends Command<{ configured: number }> {
  constructor(
    readonly actor: Actor,
    readonly assetIds: readonly string[],
    readonly terms: ConfigureTerms,
  ) {
    super();
  }
}

export class PreviewDepreciationQuery extends Query<RunPreview> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
  ) {
    super();
  }
}

export class PostDepreciationCommand extends Command<{
  id: string;
  number: string;
  total: number;
  voucherNumber: string | null;
}> {
  constructor(
    readonly actor: Actor,
    readonly asOf: string,
  ) {
    super();
  }
}

export class ReverseDepreciationCommand extends Command<{ voucherNumber: string | null }> {
  constructor(
    readonly actor: Actor,
    readonly runId: string,
    readonly reason: string,
    readonly on: string,
  ) {
    super();
  }
}

export class DescribeAssetCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly changes: { serialNo?: string | null; note?: string | null },
  ) {
    super();
  }
}

export class ListAssetsQuery extends Query<Page<AssetSummary>> {
  constructor(
    readonly actor: Actor,
    readonly filter: AssetFilter,
  ) {
    super();
  }
}

export class GetAssetQuery extends Query<AssetView> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListRunsQuery extends Query<Page<RunSummary>> {
  constructor(
    readonly actor: Actor,
    readonly request: PageRequest,
  ) {
    super();
  }
}

export class GetRunQuery extends Query<RunSummary & { entries: (RunEntry & { assetNo: string })[] }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

const monthEnd = (date: string) => {
  const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

/** What the asset handlers share. */
@Injectable()
export class AssetDesk {
  constructor(
    readonly desk: PurchaseDesk,
    readonly depreciation: DepreciationRepository,
    readonly read: AssetReadRepository,
    readonly ledger: LedgerPosting,
  ) {}

  /** A run is up to a month end, not in a month still to come (old manual run rule). */
  assertAsOf(asOf: string): void {
    if (asOf !== monthEnd(asOf)) throw new DomainError('invalid_as_of', 'Depreciation runs up to the end of a month');
    const today = this.desk.clock.now().toISOString().slice(0, 10);
    if (asOf > monthEnd(today))
      throw new DomainError('invalid_as_of', 'Depreciation is not run for a month still to come');
  }

  /** Every profile's charges due by `asOf`, with the state it reaches. */
  async plan(asOf: string) {
    const due = await this.depreciation.due(asOf);
    return due
      .map((record) => {
        const charges = dueCharges(terms(record), record, asOf);
        const added = charges.reduce((sum, charge) => sum + paisa(charge.amount), 0);
        const accumulated = taka(paisa(record.accumulated) + added);
        return {
          record,
          charges,
          amount: taka(added),
          next: {
            ...record,
            periodsDone: record.periodsDone + charges.length,
            accumulated,
            lastPeriodEnd: charges.at(-1)?.periodEnd ?? record.lastPeriodEnd,
            status: statusAfter(terms(record), accumulated),
          } satisfies DepreciationRecord,
        };
      })
      .filter((line) => line.charges.length > 0);
  }

  voucherLines(total: number, narration: string, reverse = false): LedgerPostingLine[] {
    const expense = { account: { role: DEPRECIATION_EXPENSE_ROLE }, debit: total, credit: 0, narration };
    const accumulated = { account: { role: ACCUMULATED_DEPRECIATION_ROLE }, debit: 0, credit: total, narration };
    return reverse
      ? [
          { ...accumulated, debit: total, credit: 0 },
          { ...expense, debit: 0, credit: total },
        ]
      : [expense, accumulated];
  }
}

const terms = (record: DepreciationRecord): DepreciationTerms => ({
  frequency: record.frequency,
  lifeMonths: record.lifeMonths,
  cost: record.cost,
  residual: record.residual,
  startDate: record.startDate,
});

/**
 * Old ConfigureAssetDepreciationCommand: sets how pieces depreciate (straight line, the only method there was),
 * in bulk; one asset may also take a cost override and an opening balance. Pieces already charged are refused.
 */
@CommandHandler(ConfigureDepreciationCommand)
export class ConfigureDepreciationHandler implements ICommandHandler<ConfigureDepreciationCommand> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, assetIds, terms: input }: ConfigureDepreciationCommand) {
    const { desk } = this.assets;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    const ids = [...new Set(assetIds)];
    if (ids.length === 0 || ids.length > 1000) throw new DomainError('invalid_assets', 'Give 1 to 1000 assets');
    const single = ids.length === 1;
    if (!single && (input.cost !== null || input.opening !== null || 'amount' in input.residual)) {
      throw new DomainError(
        'single_asset_only',
        'A cost, residual amount or opening balance is set one asset at a time',
      );
    }
    return desk.tx.run(async () => {
      const assets = await this.assets.depreciation.assets(ids);
      const records = assets.map((asset): DepreciationRecord => {
        if (asset.charged) {
          throw new DomainError(
            'depreciation_started',
            `${asset.assetNo} is already depreciated; reverse its runs first`,
          );
        }
        if (asset.status !== 'in_stock' && asset.status !== 'out_for_service') {
          throw new DomainError('asset_state', `${asset.assetNo} is ${asset.status.replace('_', ' ')}`);
        }
        const cost = input.cost ?? asset.cost;
        const residual =
          'amount' in input.residual
            ? input.residual.amount
            : taka(Math.round((paisa(cost) * input.residual.percent) / 100));
        const set = validTerms({
          frequency: input.frequency,
          lifeMonths: input.lifeMonths,
          cost,
          residual,
          startDate: input.startDate ?? defaultStartDate(asset.acquiredOn),
        });
        const state = input.opening
          ? openingState(set, input.opening.accumulated, input.opening.asOf)
          : { periodsDone: 0, accumulated: 0 };
        return {
          assetId: asset.id,
          ...set,
          openingAccumulated: input.opening?.accumulated ?? 0,
          ...state,
          lastPeriodEnd: input.opening?.asOf ?? null,
          status: statusAfter(set, state.accumulated),
        };
      });
      await this.assets.depreciation.save(records, actor.userId);
      await desk.record('asset_depreciation', 'configured', actor, ids[0]!, { assets: records.length });
      return { configured: records.length };
    });
  }
}

@QueryHandler(PreviewDepreciationQuery)
export class PreviewDepreciationHandler implements IQueryHandler<PreviewDepreciationQuery> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, asOf }: PreviewDepreciationQuery): Promise<RunPreview> {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    this.assets.assertAsOf(asOf);
    const plan = await this.assets.plan(asOf);
    const numbers = await this.assets.read.assetNumbers(plan.map((line) => line.record.assetId));
    return {
      asOf,
      assetCount: plan.length,
      total: taka(plan.reduce((sum, line) => sum + paisa(line.amount), 0)),
      lines: plan.map((line) => ({
        assetId: line.record.assetId,
        assetNo: numbers.get(line.record.assetId) ?? '',
        periods: line.charges.length,
        amount: line.amount,
      })),
    };
  }
}

/**
 * Old PostAssetDepreciationCommand: every charge due up to a month end, one entry per piece per period (a period
 * is charged once), and one journal voucher, depreciation expense against accumulated depreciation (old: only
 * when integrated accounts were on, best effort after the run).
 */
@CommandHandler(PostDepreciationCommand)
export class PostDepreciationHandler implements ICommandHandler<PostDepreciationCommand> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, asOf }: PostDepreciationCommand) {
    const { desk, depreciation, ledger } = this.assets;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    this.assets.assertAsOf(asOf);
    return desk.tx.run(async () => {
      await desk.tx.lock('scm:depreciation');
      const plan = await this.assets.plan(asOf);
      if (plan.length === 0) throw new DomainError('nothing_due', `No depreciation is due up to ${asOf}`);
      const total = taka(plan.reduce((sum, line) => sum + paisa(line.amount), 0));
      const id = randomUUID();
      const number = await desk.number('DP', asOf);
      const voucher =
        total > 0
          ? await ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: asOf,
              narration: `Depreciation ${number} up to ${asOf}`,
              source: { module: 'scm', reference: id },
              lines: this.assets.voucherLines(total, `Depreciation up to ${asOf}`),
              postedBy: actor.userId,
            })
          : null;
      await depreciation.insertRun(
        {
          id,
          number,
          asOf,
          status: 'posted',
          assetCount: plan.length,
          total,
          voucherId: voucher?.voucherId ?? null,
          voucherNumber: voucher?.number ?? null,
          postedBy: actor.userId,
        },
        plan.flatMap((line) =>
          line.charges.map((charge) => ({
            assetId: line.record.assetId,
            periodIndex: charge.index,
            periodEnd: charge.periodEnd,
            amount: charge.amount,
            departmentId: line.record.departmentId,
          })),
        ),
      );
      await depreciation.save(
        plan.map((line) => line.next),
        actor.userId,
      );
      await desk.record('depreciation_run', 'posted', actor, id, { number, total, assets: plan.length });
      return { id, number, total, voucherNumber: voucher?.number ?? null };
    });
  }
}

/**
 * Old ReverseAssetDepreciationCommand, last in first out: only the latest run still posted is reversed; its
 * periods become due again and a reversing voucher is posted on the reversal date.
 */
@CommandHandler(ReverseDepreciationCommand)
export class ReverseDepreciationHandler implements ICommandHandler<ReverseDepreciationCommand> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, runId, reason, on }: ReverseDepreciationCommand) {
    const { desk, depreciation, ledger } = this.assets;
    await desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    const text = reason.trim();
    if (text.length === 0 || text.length > 500)
      throw new DomainError('invalid_remarks', 'Give a reason (1-500 characters)');
    return desk.tx.run(async () => {
      await desk.tx.lock('scm:depreciation');
      const latest = await depreciation.latestPosted();
      if (!latest || latest.id !== runId) {
        throw new DomainError('not_latest_run', 'Only the most recent posted run can be reversed');
      }
      if (on < latest.asOf) throw new DomainError('invalid_date', 'A run is not reversed before its date');
      const entries = await depreciation.entries(runId);
      const profiles = new Map(
        (await depreciation.profiles(entries.map((entry) => entry.assetId))).map((record) => [record.assetId, record]),
      );
      const restored = [...profiles.values()].map((record): DepreciationRecord => {
        const own = entries.filter((entry) => entry.assetId === record.assetId);
        const accumulated = taka(paisa(record.accumulated) - own.reduce((sum, entry) => sum + paisa(entry.amount), 0));
        const periodsDone = Math.min(...own.map((entry) => entry.periodIndex));
        return {
          ...record,
          periodsDone,
          accumulated,
          lastPeriodEnd: null,
          status: record.status === 'disposed' ? 'disposed' : 'active',
        };
      });
      const voucher =
        latest.total > 0
          ? await ledger.post({
              journal: PURCHASE_JOURNAL,
              voucherDate: on,
              narration: `Reversal of depreciation ${latest.number}: ${text}`,
              source: { module: 'scm', reference: runId },
              lines: this.assets.voucherLines(latest.total, `Reversal of ${latest.number}`, true),
              postedBy: actor.userId,
            })
          : null;
      await depreciation.markReversed(runId, {
        by: actor.userId,
        at: desk.clock.now(),
        reason: text,
        voucher: voucher && { id: voucher.voucherId, number: voucher.number },
      });
      await depreciation.save(restored, actor.userId);
      await desk.record('depreciation_run', 'reversed', actor, runId, { reason: text });
      return { voucherNumber: voucher?.number ?? null };
    });
  }
}

@CommandHandler(DescribeAssetCommand)
export class DescribeAssetHandler implements ICommandHandler<DescribeAssetCommand> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, id, changes }: DescribeAssetCommand): Promise<void> {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_ASSETS] });
    if (!(await this.assets.read.describe(id, changes))) throw new NotFoundError('fixed_asset');
    await this.assets.desk.record('fixed_asset', 'described', actor, id);
  }
}

@QueryHandler(ListAssetsQuery)
export class ListAssetsHandler implements IQueryHandler<ListAssetsQuery> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, filter }: ListAssetsQuery): Promise<Page<AssetSummary>> {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.assets.read.list(filter);
  }
}

@QueryHandler(GetAssetQuery)
export class GetAssetHandler implements IQueryHandler<GetAssetQuery> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, id }: GetAssetQuery): Promise<AssetView> {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const asset = await this.assets.read.get(id);
    if (!asset) throw new NotFoundError('fixed_asset');
    return asset;
  }
}

@QueryHandler(ListRunsQuery)
export class ListRunsHandler implements IQueryHandler<ListRunsQuery> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, request }: ListRunsQuery): Promise<Page<RunSummary>> {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    return this.assets.read.runs(request);
  }
}

@QueryHandler(GetRunQuery)
export class GetRunHandler implements IQueryHandler<GetRunQuery> {
  constructor(private readonly assets: AssetDesk) {}

  async execute({ actor, id }: GetRunQuery) {
    await this.assets.desk.access.authorize(actor.userId, { permissions: [SCM_READ] });
    const run = await this.assets.read.run(id);
    if (!run) throw new NotFoundError('depreciation_run');
    return run;
  }
}

export const ASSET_HANDLERS = [
  AssetDesk,
  ConfigureDepreciationHandler,
  PreviewDepreciationHandler,
  PostDepreciationHandler,
  ReverseDepreciationHandler,
  DescribeAssetHandler,
  ListAssetsHandler,
  GetAssetHandler,
  ListRunsHandler,
  GetRunHandler,
];
