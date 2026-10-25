import { DomainError } from '../../../shared/domain/errors.js';

/** Old GeneralSalaryPolicies: how a gross salary is split. The conveyance cap was a hard-coded 2,500. */
export interface SalaryPolicyTerms {
  readonly basicPercentOfGross: number;
  readonly houseRentPercentOfBasic: number;
  readonly medicalPercentOfBasic: number;
  readonly pfPercentOfBasic: number;
  readonly cpfPercentOfBasic: number;
  readonly conveyanceCap: number;
}

export interface SalaryBreakdown {
  readonly gross: number;
  readonly basic: number;
  readonly houseRent: number;
  readonly medical: number;
  readonly conveyance: number;
  /** The part of the remainder above the conveyance cap. */
  readonly otherAllowance: number;
  readonly pf: number;
  readonly cpf: number;
}

export const MAX_GROSS = 10_000_000;

/** Whole taka, halves away from zero (the old Math.Round(…, MidpointRounding.AwayFromZero)). */
export const roundTaka = (amount: number): number => Math.sign(amount) * Math.round(Math.abs(amount));
const paisa = (amount: number): number => Math.round(amount * 100) / 100;

/**
 * The old salary screen's split: basic is a share of gross, house rent and medical are shares of basic,
 * the remainder is conveyance up to the cap and other allowance above it. Components are whole taka;
 * any paisa in the gross end up in conveyance, so the parts always add up to the gross.
 */
export function splitGross(gross: number, terms: SalaryPolicyTerms, pfEnabled: boolean): SalaryBreakdown {
  if (!(gross > 0) || gross > MAX_GROSS) {
    throw new DomainError('invalid_salary', `The gross salary must be more than 0 and at most ${MAX_GROSS}`);
  }
  const basic = roundTaka((gross * terms.basicPercentOfGross) / 100);
  const houseRent = roundTaka((basic * terms.houseRentPercentOfBasic) / 100);
  const medical = roundTaka((basic * terms.medicalPercentOfBasic) / 100);
  const remainder = paisa(gross - basic - houseRent - medical);
  if (remainder < 0) {
    throw new DomainError(
      'invalid_salary',
      "The policy's basic, house rent and medical shares add up to more than the gross salary",
    );
  }
  const conveyance = Math.min(remainder, terms.conveyanceCap);
  return {
    gross: paisa(gross),
    basic,
    houseRent,
    medical,
    conveyance,
    otherAllowance: paisa(remainder - conveyance),
    pf: pfEnabled ? roundTaka((basic * terms.pfPercentOfBasic) / 100) : 0,
    cpf: pfEnabled ? roundTaka((basic * terms.cpfPercentOfBasic) / 100) : 0,
  };
}

/** Old IncrementTypes by name: "Percentage(%)", "Fixed", "Individual". */
export const INCREMENT_METHODS = ['percentage', 'fixed', 'individual'] as const;
export type IncrementMethod = (typeof INCREMENT_METHODS)[number];

export interface SalarySettings {
  readonly policyId: string;
  readonly pfEnabled: boolean;
  readonly specialAllowance: number;
  /** Old IndividualSalaries.Others. */
  readonly otherFixed: number;
  readonly overtimeRatePerHour: number;
  readonly taxableAmount: number;
  readonly incrementMethod: IncrementMethod;
  /** Percentage of basic + house rent + medical (the old procedure used a fixed 10). */
  readonly incrementPercent: number;
  /** Amount for the fixed method (old FixedAmount). */
  readonly fixedIncrement: number;
  readonly reviewCycleId: string | null;
}

/** Everything that an increment changes, kept with the increment so it can be undone exactly. */
export interface SalarySnapshot extends SalaryBreakdown {
  readonly policyId: string;
}

export interface StaffSalaryProps extends SalaryBreakdown, SalarySettings {
  staffId: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

function validSettings(settings: SalarySettings): SalarySettings {
  const amounts = {
    specialAllowance: settings.specialAllowance,
    otherFixed: settings.otherFixed,
    overtimeRatePerHour: settings.overtimeRatePerHour,
    taxableAmount: settings.taxableAmount,
    fixedIncrement: settings.fixedIncrement,
  };
  for (const [name, value] of Object.entries(amounts)) {
    if (!(value >= 0) || value > MAX_GROSS)
      throw new DomainError('invalid_salary', `${name} must be 0 to ${MAX_GROSS}`);
  }
  if (!(settings.incrementPercent >= 0 && settings.incrementPercent <= 100)) {
    throw new DomainError('invalid_salary', 'The increment percentage must be 0 to 100');
  }
  return settings;
}

/** A staff member's current salary structure (old Payroll.IndividualSalaries, one per person). */
export class StaffSalary {
  private constructor(private readonly props: StaffSalaryProps) {}

  static create(params: {
    staffId: string;
    gross: number;
    settings: SalarySettings;
    terms: SalaryPolicyTerms;
    now: Date;
  }): StaffSalary {
    const settings = validSettings(params.settings);
    return new StaffSalary({
      staffId: params.staffId,
      ...settings,
      ...splitGross(params.gross, params.terms, settings.pfEnabled),
      version: 1,
      createdAt: params.now,
      updatedAt: params.now,
    });
  }

  static restore(props: StaffSalaryProps): StaffSalary {
    return new StaffSalary({ ...props });
  }

  get staffId(): string {
    return this.props.staffId;
  }
  get version(): number {
    return this.props.version;
  }
  get policyId(): string {
    return this.props.policyId;
  }
  get gross(): number {
    return this.props.gross;
  }

  /** Changes settings and/or gross; the split is worked out again with the (possibly new) policy. */
  revise(changes: { gross?: number; settings?: Partial<SalarySettings> }, terms: SalaryPolicyTerms, now: Date): void {
    const settings = validSettings({ ...this.settings(), ...changes.settings });
    Object.assign(this.props, settings, splitGross(changes.gross ?? this.props.gross, terms, settings.pfEnabled));
    this.touch(now);
  }

  /** The increment this person's method gives, or null when it has to be entered (individual). */
  incrementDue(): number | null {
    switch (this.props.incrementMethod) {
      case 'percentage':
        return roundTaka(
          ((this.props.basic + this.props.houseRent + this.props.medical) * this.props.incrementPercent) / 100,
        );
      case 'fixed':
        return this.props.fixedIncrement;
      case 'individual':
        return null;
    }
  }

  /** Raises the gross by `amount` and splits it again; returns the state before, for undoing. */
  increase(amount: number, terms: SalaryPolicyTerms, now: Date): SalarySnapshot {
    if (!(amount > 0)) throw new DomainError('invalid_increment', 'The increment must be more than 0');
    const before = this.snapshot();
    this.revise({ gross: this.props.gross + amount }, terms, now);
    return before;
  }

  /** Puts back the salary an increment started from. */
  undo(before: SalarySnapshot, now: Date): void {
    Object.assign(this.props, before);
    this.touch(now);
  }

  snapshot(): SalarySnapshot {
    const { gross, basic, houseRent, medical, conveyance, otherAllowance, pf, cpf, policyId } = this.props;
    return { gross, basic, houseRent, medical, conveyance, otherAllowance, pf, cpf, policyId };
  }

  toSnapshot(): Readonly<StaffSalaryProps> {
    return { ...this.props };
  }

  private settings(): SalarySettings {
    const { policyId, pfEnabled, specialAllowance, otherFixed, overtimeRatePerHour, taxableAmount } = this.props;
    const { incrementMethod, incrementPercent, fixedIncrement, reviewCycleId } = this.props;
    return {
      policyId,
      pfEnabled,
      specialAllowance,
      otherFixed,
      overtimeRatePerHour,
      taxableAmount,
      incrementMethod,
      incrementPercent,
      fixedIncrement,
      reviewCycleId,
    };
  }

  private touch(now: Date): void {
    this.props.version += 1;
    this.props.updatedAt = now;
  }
}

/** The month before a pay month. */
export function previousMonth(year: number, month: number): { year: number; month: number } {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * Old spGetEligibleEmployeeListForIncrement: an increment paid in a month is due to people whose joining
 * anniversary fell in the month before (at least one full year of service).
 */
export function isIncrementDue(joiningDate: string, year: number, month: number): boolean {
  const due = previousMonth(year, month);
  const joinedYear = Number(joiningDate.slice(0, 4));
  const joinedMonth = Number(joiningDate.slice(5, 7));
  return joinedMonth === due.month && joinedYear < due.year;
}

/**
 * Arrear for the days of the anniversary month from the joining day on: the increment divided by the days
 * of the month before the pay month, times the days from the joining day to the end of the joining month.
 */
export function incrementArrear(amount: number, joiningDate: string, year: number, month: number): number {
  const due = previousMonth(year, month);
  const joinedYear = Number(joiningDate.slice(0, 4));
  const joinedMonth = Number(joiningDate.slice(5, 7));
  const joinedDay = Number(joiningDate.slice(8, 10));
  const days = daysInMonth(joinedYear, joinedMonth) - joinedDay + 1;
  return paisa((amount / daysInMonth(due.year, due.month)) * days);
}

export type IncrementStatus = 'pending' | 'committed';

export interface SalaryIncrementProps {
  id: string;
  staffId: string;
  year: number;
  month: number;
  method: IncrementMethod;
  amount: number;
  arrear: number;
  before: SalarySnapshot;
  /** The salary's version right after this increment; undoing needs it unchanged since. */
  salaryVersion: number;
  status: IncrementStatus;
  createdBy: string;
  createdAt: Date;
  committedBy: string | null;
  committedAt: Date | null;
}

export function assertPayPeriod(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new DomainError('invalid_pay_period', 'Give a year 2000-2100 and a month 1-12');
  }
}
