import { ConflictError, DomainError } from '../../../shared/domain/errors.js';

export const MAX_VOUCHER_LINES = 500;
export const MAX_LINE_AMOUNT = 1_000_000_000;

export interface VoucherLine {
  readonly glAccountId: string;
  readonly debit: number;
  readonly credit: number;
  readonly narration: string | null;
  readonly costCenterId: string | null;
  readonly subLedgerId: string | null;
  readonly chequeNo: string | null;
  readonly chequeDate: string | null;
}

/** What posting needs to know about an account. */
export interface PostableAccount {
  readonly id: string;
  readonly code: string;
  readonly isActive: boolean;
  readonly isControlAccount: boolean;
  readonly requiresCostCenter: boolean;
  readonly book: Book;
}

/** The organization's books, or the provident fund trust's (old PFBook). */
export type Book = 'main' | 'pf';

/** The book a voucher is kept in (its journal type's) and the accounts its lines use. */
export interface Chart {
  readonly book: Book;
  readonly accounts: ReadonlyMap<string, PostableAccount>;
}

export interface VoucherHeader {
  readonly journalTypeId: string;
  readonly voucherDate: string;
  readonly documentDate: string | null;
  readonly narration: string | null;
  readonly paidTo: string | null;
  readonly mode: string | null;
  readonly serviceUnitId: string | null;
}

/** Where an integrated voucher came from (old VoucherMaster.ReferenceId: the HIS invoice). */
export interface VoucherSource {
  readonly module: string;
  readonly reference: string;
}

export type VoucherStatus = 'draft' | 'posted' | 'reversed';

export interface VoucherProps extends VoucherHeader {
  id: string;
  number: string | null;
  fiscalYearId: string | null;
  status: VoucherStatus;
  source: VoucherSource | null;
  reversalOfId: string | null;
  lines: VoucherLine[];
  createdBy: string | null;
  postedBy: string | null;
  postedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const cents = (amount: number) => Math.round(amount * 100);
const validAmount = (amount: number) =>
  amount >= 0 && amount <= MAX_LINE_AMOUNT && Math.abs(cents(amount) - amount * 100) < 1e-6;

/**
 * The double-entry rules the old voucher screen never checked: at least two lines, each a debit or a
 * credit (not both), amounts with at most two decimals, debits equal to credits, active accounts, a cost
 * centre where the account needs one and a sub-ledger on control accounts.
 */
export function validLines(lines: readonly VoucherLine[], chart: Chart): VoucherLine[] {
  if (lines.length < 2 || lines.length > MAX_VOUCHER_LINES) {
    throw new DomainError('invalid_voucher', `A voucher has 2 to ${MAX_VOUCHER_LINES} lines`);
  }
  let debit = 0;
  let credit = 0;
  lines.forEach((line, index) => {
    const at = `Line ${index + 1}`;
    if (![line.debit, line.credit].every(validAmount)) {
      throw new DomainError('invalid_voucher', `${at}: amounts are 0 to ${MAX_LINE_AMOUNT} with at most 2 decimals`);
    }
    if (line.debit > 0 === line.credit > 0) {
      throw new DomainError('invalid_voucher', `${at}: enter either a debit or a credit`);
    }
    const account = chart.accounts.get(line.glAccountId);
    if (!account) throw new DomainError('invalid_voucher', `${at}: unknown account`);
    if (account.book !== chart.book) {
      throw new DomainError('invalid_voucher', `${at}: account ${account.code} belongs to the ${account.book} book`);
    }
    if (!account.isActive) throw new DomainError('invalid_voucher', `${at}: account ${account.code} is inactive`);
    if (account.requiresCostCenter && !line.costCenterId) {
      throw new DomainError('invalid_voucher', `${at}: account ${account.code} needs a cost centre`);
    }
    if (account.isControlAccount && !line.subLedgerId) {
      throw new DomainError(
        'invalid_voucher',
        `${at}: account ${account.code} is a control account; choose a sub-ledger`,
      );
    }
    debit += cents(line.debit);
    credit += cents(line.credit);
  });
  if (debit !== credit) {
    throw new DomainError(
      'unbalanced_voucher',
      `Debits (${(debit / 100).toFixed(2)}) and credits (${(credit / 100).toFixed(2)}) must be equal`,
    );
  }
  return [...lines];
}

export const voucherTotal = (lines: readonly VoucherLine[]) =>
  lines.reduce((sum, line) => sum + cents(line.debit), 0) / 100;

/** A journal voucher: a draft can be edited or deleted; posting gives it a number; posted ones are reversed. */
export class Voucher {
  private constructor(private readonly props: VoucherProps) {}

  static draft(params: {
    id: string;
    header: VoucherHeader;
    lines: readonly VoucherLine[];
    chart: Chart;
    source: VoucherSource | null;
    createdBy: string | null;
    now: Date;
  }): Voucher {
    return new Voucher({
      id: params.id,
      ...params.header,
      number: null,
      fiscalYearId: null,
      status: 'draft',
      source: params.source,
      reversalOfId: null,
      lines: validLines(params.lines, params.chart),
      createdBy: params.createdBy,
      postedBy: null,
      postedAt: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: VoucherProps): Voucher {
    return new Voucher({ ...props, lines: [...props.lines] });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): VoucherStatus {
    return this.props.status;
  }
  get version(): number {
    return this.props.version;
  }
  get voucherDate(): string {
    return this.props.voucherDate;
  }
  get journalTypeId(): string {
    return this.props.journalTypeId;
  }
  get lines(): readonly VoucherLine[] {
    return this.props.lines;
  }

  edit(changes: { header?: Partial<VoucherHeader>; lines?: readonly VoucherLine[] }, chart: Chart, now: Date): void {
    this.assertDraft('edited');
    Object.assign(this.props, changes.header);
    if (changes.lines) this.props.lines = validLines(changes.lines, chart);
    this.touch(now);
  }

  /** The accounts are checked again: one may have been deactivated since the draft was saved. */
  post(params: { number: string; fiscalYearId: string; chart: Chart; by: string | null; now: Date }): void {
    this.assertDraft('posted');
    validLines(this.props.lines, params.chart);
    this.props.status = 'posted';
    this.props.number = params.number;
    this.props.fiscalYearId = params.fiscalYearId;
    this.props.postedBy = params.by;
    this.props.postedAt = params.now;
    this.touch(params.now);
  }

  /** A draft reversing this posted voucher: the same lines with debit and credit swapped. */
  reversal(params: { id: string; voucherDate: string; narration: string; by: string; now: Date }): Voucher {
    if (this.props.status !== 'posted') {
      throw new DomainError('voucher_state', `A ${this.props.status} voucher cannot be reversed`);
    }
    const reversal = new Voucher({
      ...this.props,
      id: params.id,
      voucherDate: params.voucherDate,
      documentDate: null,
      narration: params.narration,
      number: null,
      fiscalYearId: null,
      status: 'draft',
      reversalOfId: this.props.id,
      lines: this.props.lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit })),
      createdBy: params.by,
      postedBy: null,
      postedAt: null,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
    this.props.status = 'reversed';
    this.touch(params.now);
    return reversal;
  }

  assertDeletable(): void {
    this.assertDraft('deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_voucher', 'The voucher was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<VoucherProps> {
    return { ...this.props, lines: [...this.props.lines] };
  }

  private assertDraft(action: string): void {
    if (this.props.status !== 'draft') {
      throw new DomainError('voucher_state', `A ${this.props.status} voucher cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

/** Old numbering was typed by the screens; now `<journal>-<fiscal year>-<serial>`, e.g. JV-2025-2026-00001. */
export const voucherNumber = (journalShortName: string, fiscalYearLabel: string, serial: number) =>
  `${journalShortName.toUpperCase()}-${fiscalYearLabel}-${String(serial).padStart(5, '0')}`;
