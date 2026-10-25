import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import {
  firstLevel,
  MAX_DOCUMENT_LINES,
  nextLevel,
  paisa,
  taka,
  validAmount,
  validPercent,
  validQuantity,
  validRemarks,
  type ApprovalLevel,
  type Decision,
} from './documents.js';

export type StudyStatus = 'draft' | 'pending' | 'approved' | 'rejected';

/** What a quote is for: a catalogue variant, or a product typed in (old ManualBrandName). */
export interface QuoteInput {
  readonly supplierId: string;
  readonly variantId: string | null;
  readonly manualName: string | null;
  readonly qty: number;
  readonly unitPrice: number;
  readonly vatPercent: number;
  readonly aitPercent: number;
}

export interface Quote extends QuoteInput {
  readonly id: string;
  readonly vat: number;
  readonly ait: number;
  readonly total: number;
  /** Still in the running; at the final approval the selected quotes are the winners. */
  readonly selected: boolean;
}

export interface StudyHeader {
  readonly studyDate: string;
  readonly requisitionId: string | null;
  readonly title: string;
  readonly note: string | null;
}

export interface StudyProps extends StudyHeader {
  id: string;
  number: string;
  status: StudyStatus;
  currentLevel: number | null;
  quotes: Quote[];
  decisions: Decision[];
  createdBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old CS detail arithmetic: VAT and AIT on the quoted price times quantity, each rounded to the paisa,
 * added to it. The old total itself was not rounded; here every amount is.
 */
export function quoteAmounts(quote: Pick<QuoteInput, 'qty' | 'unitPrice' | 'vatPercent' | 'aitPercent'>) {
  const base = paisa(quote.unitPrice * quote.qty);
  const share = (percent: number) => Math.round((base * percent) / 100);
  const vat = share(quote.vatPercent);
  const ait = share(quote.aitPercent);
  return { vat: taka(vat), ait: taka(ait), total: taka(base + vat + ait) };
}

function validQuotes(quotes: readonly (QuoteInput & { id: string })[]): Quote[] {
  if (quotes.length === 0 || quotes.length > MAX_DOCUMENT_LINES) {
    throw new DomainError('invalid_lines', `A comparative study has 1 to ${MAX_DOCUMENT_LINES} quotes`);
  }
  const seen = new Set<string>();
  return quotes.map((quote, index) => {
    const at = `Quote ${index + 1}`;
    const manualName = quote.manualName?.trim() || null;
    if ((quote.variantId === null) === (manualName === null)) {
      throw new DomainError('invalid_quote', `${at}: give either a catalogue item or a typed-in name`);
    }
    if (manualName && manualName.length > 200) {
      throw new DomainError('invalid_quote', `${at}: the name is at most 200 characters`);
    }
    const key = `${quote.supplierId}|${quote.variantId ?? manualName!.toUpperCase()}`;
    if (seen.has(key)) throw new DomainError('duplicate_line', `${at}: the supplier already quoted this item`);
    seen.add(key);
    validQuantity(quote.qty, at);
    validAmount(quote.unitPrice, at);
    validPercent(quote.vatPercent, at);
    validPercent(quote.aitPercent, at);
    return { ...quote, manualName, ...quoteAmounts(quote), selected: true };
  });
}

/**
 * Old ComparativeStudy: suppliers' quotes for the items, approved level by level by named staff (old
 * CSApprovalSettings). Each approver keeps the quotes still in the running; what is left at the final level
 * wins. The old CS was not linked to anything; here it may name the requisition it is for.
 */
export class ComparativeStudy {
  private constructor(private readonly props: StudyProps) {}

  static draft(params: {
    id: string;
    number: string;
    header: StudyHeader;
    quotes: readonly (QuoteInput & { id: string })[];
    createdBy: string;
    now: Date;
  }): ComparativeStudy {
    return new ComparativeStudy({
      id: params.id,
      number: params.number,
      ...validHeader(params.header),
      status: 'draft',
      currentLevel: null,
      quotes: validQuotes(params.quotes),
      decisions: [],
      createdBy: params.createdBy,
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: StudyProps): ComparativeStudy {
    return new ComparativeStudy({ ...props, quotes: [...props.quotes], decisions: [...props.decisions] });
  }

  get id(): string {
    return this.props.id;
  }
  get status(): StudyStatus {
    return this.props.status;
  }
  get currentLevel(): number | null {
    return this.props.currentLevel;
  }
  get requisitionId(): string | null {
    return this.props.requisitionId;
  }
  get quotes(): readonly Quote[] {
    return this.props.quotes;
  }

  edit(changes: { header?: Partial<StudyHeader>; quotes?: readonly (QuoteInput & { id: string })[] }, now: Date): void {
    this.assertStatus(['draft'], 'edited');
    Object.assign(this.props, validHeader({ ...this.props, ...changes.header }));
    if (changes.quotes) this.props.quotes = validQuotes(changes.quotes);
    this.touch(now);
  }

  submit(levels: readonly ApprovalLevel[], now: Date): void {
    this.assertStatus(['draft'], 'submitted');
    this.props.currentLevel = firstLevel(levels, 'comparative studies').order;
    this.props.status = 'pending';
    this.touch(now);
  }

  /** Keeps `keep` (ids of quotes still selected) in the running; the others drop out. */
  approve(params: {
    level: ApprovalLevel;
    levels: readonly ApprovalLevel[];
    keep: readonly string[];
    by: string;
    remarks: string | null;
    now: Date;
  }): void {
    this.assertDecidable(params.level);
    const keep = new Set(params.keep);
    for (const id of keep) {
      if (!this.props.quotes.some((quote) => quote.id === id && quote.selected)) {
        throw new DomainError('invalid_quote', 'Only quotes still in the running can be kept');
      }
    }
    if (keep.size === 0) throw new DomainError('nothing_selected', 'Keep at least one quote, or reject the study');
    this.props.quotes = this.props.quotes.map((quote) => ({ ...quote, selected: keep.has(quote.id) }));
    this.props.decisions.push(
      decision(params.level, 'approved', params.by, validRemarks(params.remarks, false), params.now),
    );
    const next = nextLevel(params.levels, params.level);
    this.props.currentLevel = next?.order ?? null;
    if (!next) this.props.status = 'approved';
    this.touch(params.now);
  }

  reject(params: { level: ApprovalLevel; by: string; remarks: string; now: Date }): void {
    this.assertDecidable(params.level);
    this.props.decisions.push(
      decision(params.level, 'rejected', params.by, validRemarks(params.remarks, true), params.now),
    );
    this.props.status = 'rejected';
    this.props.currentLevel = null;
    this.touch(params.now);
  }

  /** The winning quotes of an approved study. */
  winners(): Quote[] {
    return this.props.status === 'approved' ? this.props.quotes.filter((quote) => quote.selected) : [];
  }

  assertDeletable(): void {
    this.assertStatus(['draft'], 'deleted');
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_comparative_study', 'The study was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<StudyProps> {
    return { ...this.props, quotes: [...this.props.quotes], decisions: [...this.props.decisions] };
  }

  private assertDecidable(level: ApprovalLevel): void {
    this.assertStatus(['pending'], 'decided');
    if (level.order !== this.props.currentLevel) {
      throw new DomainError('wrong_level', 'The study is waiting for another approval level');
    }
  }

  private assertStatus(allowed: readonly StudyStatus[], action: string): void {
    if (!allowed.includes(this.props.status)) {
      throw new DomainError('comparative_study_state', `A ${this.props.status} study cannot be ${action}`);
    }
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

function validHeader(header: StudyHeader): StudyHeader {
  const title = header.title.trim();
  if (title.length === 0 || title.length > 200) {
    throw new DomainError('invalid_title', 'Give the study a title (1-200 characters)');
  }
  return { ...header, title };
}

function decision(
  level: ApprovalLevel,
  value: Decision['decision'],
  by: string,
  remarks: string | null,
  now: Date,
): Decision {
  return { levelOrder: level.order, levelName: level.name, decision: value, decidedBy: by, decidedAt: now, remarks };
}
