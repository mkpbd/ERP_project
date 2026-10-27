import { ConflictError, DomainError, ForbiddenError } from '../../../shared/domain/errors.js';

export const MAX_PARAMETERS = 60;
export type SampleStatus = 'collected' | 'received' | 'rejected';
export type ResultStatus = 'pending' | 'entered' | 'verified' | 'delivered' | 'rejected';
export type Sex = 'male' | 'female';

/** Trimmed text, null when empty; too long is refused. */
export function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

export interface ParameterRange {
  readonly sex: Sex | null;
  readonly minAgeDays: number;
  readonly maxAgeDays: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly normalText: string | null;
}

export interface Parameter {
  readonly id: string;
  readonly name: string;
  readonly unit: string | null;
  readonly method: string | null;
  readonly kind: 'numeric' | 'text';
  readonly decimals: number;
  readonly ranges: readonly ParameterRange[];
}

/** A test's parameters as given: names unique, numeric ranges from low to high, ages from younger to older. */
export function checkedTemplate(parameters: readonly Omit<Parameter, 'id'>[]): Omit<Parameter, 'id'>[] {
  if (parameters.length === 0 || parameters.length > MAX_PARAMETERS) {
    throw new DomainError('invalid_parameters', `A test has 1 to ${MAX_PARAMETERS} parameters`);
  }
  const seen = new Set<string>();
  return parameters.map((parameter, index) => {
    const at = `Parameter ${index + 1}`;
    const name = text(parameter.name, 100, 'parameter name');
    if (!name) throw new DomainError('invalid_parameters', `${at}: give its name`);
    if (seen.has(name.toLowerCase())) throw new DomainError('invalid_parameters', `${at}: ${name} is there already`);
    seen.add(name.toLowerCase());
    if (!Number.isInteger(parameter.decimals) || parameter.decimals < 0 || parameter.decimals > 4) {
      throw new DomainError('invalid_parameters', `${at}: 0 to 4 decimals`);
    }
    for (const range of parameter.ranges) {
      if (range.maxAgeDays !== null && range.maxAgeDays < range.minAgeDays) {
        throw new DomainError('invalid_parameters', `${at}: an age range ends before it starts`);
      }
      if (range.low !== null && range.high !== null && range.low > range.high) {
        throw new DomainError('invalid_parameters', `${at}: a range's low is above its high`);
      }
      if (parameter.kind === 'text' && (range.low !== null || range.high !== null)) {
        throw new DomainError('invalid_parameters', `${at}: a text result has no low and high`);
      }
    }
    return {
      ...parameter,
      name,
      unit: text(parameter.unit, 30, 'unit'),
      method: text(parameter.method, 100, 'method'),
    };
  });
}

/** The range for a patient: one for their sex before one for either, the first whose ages hold them. */
export function rangeFor(parameter: Parameter, sex: string, ageDays: number): ParameterRange | null {
  const fits = (range: ParameterRange) =>
    ageDays >= range.minAgeDays && (range.maxAgeDays === null || ageDays <= range.maxAgeDays);
  return (
    parameter.ranges.find((range) => range.sex === sex && fits(range)) ??
    parameter.ranges.find((range) => range.sex === null && fits(range)) ??
    null
  );
}

export interface ResultValue {
  readonly parameterId: string | null;
  readonly name: string;
  readonly unit: string | null;
  readonly method: string | null;
  readonly value: string | null;
  readonly numeric: number | null;
  readonly low: number | null;
  readonly high: number | null;
  readonly normalText: string | null;
  readonly flag: 'low' | 'high' | null;
}

/**
 * The values entered against the template, each with the range of the patient's sex and age and a flag when a number
 * falls outside it (old: ranges kept by age in AgeVariantNormalValue, the flag left to whoever read the report).
 */
export function resultValues(
  parameters: readonly Parameter[],
  entered: readonly { parameterId: string; value: string | null }[],
  patient: { sex: string; ageDays: number },
): ResultValue[] {
  const known = new Set(parameters.map((parameter) => parameter.id));
  for (const entry of entered) {
    if (!known.has(entry.parameterId))
      throw new DomainError('invalid_values', 'A value is for a parameter not on the test');
  }
  return parameters.map((parameter) => {
    const value = text(entered.find((entry) => entry.parameterId === parameter.id)?.value, 200, parameter.name);
    const range = rangeFor(parameter, patient.sex, patient.ageDays);
    let numeric: number | null = null;
    if (parameter.kind === 'numeric' && value !== null) {
      numeric = Number(value);
      if (!Number.isFinite(numeric)) throw new DomainError('invalid_values', `${parameter.name} is a number`);
    }
    const flag =
      numeric === null || !range
        ? null
        : range.low !== null && numeric < range.low
          ? 'low'
          : range.high !== null && numeric > range.high
            ? 'high'
            : null;
    return {
      parameterId: parameter.id,
      name: parameter.name,
      unit: parameter.unit,
      method: parameter.method,
      value: numeric === null ? value : numeric.toFixed(parameter.decimals),
      numeric,
      low: range?.low ?? null,
      high: range?.high ?? null,
      normalText: range?.normalText ?? null,
      flag,
    };
  });
}

export interface SampleProps {
  id: string;
  labNumber: string;
  billId: string;
  departmentId: string;
  patientId: string;
  collectedOn: string;
  collectedAt: Date;
  collectedBy: string | null;
  status: SampleStatus;
  receivedAt: Date | null;
  receivedBy: string | null;
  rejectReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old sample collection and lab acknowledgement (SampleCollectionRecords, SampleStatus): what is taken from the
 * patient for one bill's tests of one lab department. The lab takes it in, or rejects it (haemolysed, too little …)
 * and the tests are collected again.
 */
export class LabSample {
  private constructor(private readonly props: SampleProps) {}

  static collect(
    params: Omit<
      SampleProps,
      'status' | 'receivedAt' | 'receivedBy' | 'rejectReason' | 'version' | 'createdAt' | 'updatedAt'
    >,
  ): LabSample {
    return new LabSample({
      ...params,
      status: 'collected',
      receivedAt: null,
      receivedBy: null,
      rejectReason: null,
      version: 1,
      createdAt: params.collectedAt,
      updatedAt: params.collectedAt,
    });
  }

  static restore(props: SampleProps): LabSample {
    return new LabSample({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get labNumber(): string {
    return this.props.labNumber;
  }
  get billId(): string {
    return this.props.billId;
  }
  get status(): SampleStatus {
    return this.props.status;
  }

  receive(by: string, at: Date): void {
    if (this.props.status !== 'collected') {
      throw new DomainError('sample_state', `The sample is ${this.props.status}`);
    }
    this.props.status = 'received';
    this.props.receivedAt = at;
    this.props.receivedBy = by;
    this.touch(at);
  }

  reject(reason: string, at: Date): void {
    if (this.props.status === 'rejected') throw new DomainError('sample_state', 'The sample is rejected already');
    const why = text(reason, 300, 'reason');
    if (!why) throw new DomainError('invalid_remarks', 'Give a reason');
    this.props.status = 'rejected';
    this.props.rejectReason = why;
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_sample', 'The sample was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<SampleProps> {
    return { ...this.props };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export interface ResultProps {
  id: string;
  sampleId: string;
  billId: string;
  line: number;
  testId: string;
  status: ResultStatus;
  comment: string | null;
  enteredBy: string | null;
  enteredAt: Date | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  deliveredTo: string | null;
  deliveredBy: string | null;
  deliveredAt: Date | null;
  values: ResultValue[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old pathology result entry and finalisation (PathologyReports with ReportVerifiers): a test's values entered by the
 * lab, verified by someone else (a pathologist), printed only then, and handed over. A verified result is corrected by
 * taking the verification back first.
 */
export class LabResult {
  private constructor(private readonly props: ResultProps) {}

  static pending(params: {
    id: string;
    sampleId: string;
    billId: string;
    line: number;
    testId: string;
    at: Date;
  }): LabResult {
    return new LabResult({
      ...params,
      status: 'pending',
      comment: null,
      enteredBy: null,
      enteredAt: null,
      verifiedBy: null,
      verifiedAt: null,
      deliveredTo: null,
      deliveredBy: null,
      deliveredAt: null,
      values: [],
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: ResultProps): LabResult {
    return new LabResult({ ...props, values: [...props.values] });
  }

  get id(): string {
    return this.props.id;
  }
  get sampleId(): string {
    return this.props.sampleId;
  }
  get status(): ResultStatus {
    return this.props.status;
  }

  /** The values (all of a numeric test's numbers), entered or corrected before verification. */
  enter(values: readonly ResultValue[], comment: string | null, by: string, at: Date): void {
    if (this.props.status !== 'pending' && this.props.status !== 'entered') {
      throw new DomainError('result_state', `A ${this.props.status} result is not entered again`);
    }
    if (values.every((value) => value.value === null)) {
      throw new DomainError('invalid_values', 'Enter the result');
    }
    this.props.values = [...values];
    this.props.comment = text(comment, 1000, 'comment');
    this.props.status = 'entered';
    this.props.enteredBy = by;
    this.props.enteredAt = at;
    this.touch(at);
  }

  /** Someone other than who entered it verifies it. */
  verify(by: string, at: Date): void {
    if (this.props.status !== 'entered')
      throw new DomainError('result_state', `A ${this.props.status} result is not verified`);
    if (this.props.enteredBy === by) {
      throw new ForbiddenError('same_person', 'A result is verified by someone other than who entered it');
    }
    this.props.status = 'verified';
    this.props.verifiedBy = by;
    this.props.verifiedAt = at;
    this.touch(at);
  }

  /** Back to entered for a correction (not once handed over). */
  unverify(at: Date): void {
    if (this.props.status !== 'verified')
      throw new DomainError('result_state', `A ${this.props.status} result is not reopened`);
    this.props.status = 'entered';
    this.props.verifiedBy = null;
    this.props.verifiedAt = null;
    this.touch(at);
  }

  deliver(to: string, by: string, at: Date): void {
    if (this.props.status !== 'verified')
      throw new DomainError('result_state', `A ${this.props.status} result is not handed over`);
    const whom = text(to, 150, 'who collected it');
    if (!whom) throw new DomainError('invalid_remarks', 'Say who collected the report');
    this.props.status = 'delivered';
    this.props.deliveredTo = whom;
    this.props.deliveredBy = by;
    this.props.deliveredAt = at;
    this.touch(at);
  }

  /** The sample was rejected: this test is collected again on a new sample. */
  reject(at: Date): void {
    if (this.props.status === 'verified' || this.props.status === 'delivered') {
      throw new DomainError('result_state', 'A verified result stays; take the verification back first');
    }
    this.props.status = 'rejected';
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_result', 'The result was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<ResultProps> {
    return { ...this.props, values: [...this.props.values] };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

/** Old SPGetNextLabNo as a readable number: LB-yymmdd-0001, counted per day. */
export const labNumber = (on: string, serial: number) =>
  `LB-${on.slice(2, 4)}${on.slice(5, 7)}${on.slice(8, 10)}-${String(serial).padStart(4, '0')}`;

/** Whole days from birth to a day. */
export const ageInDays = (dateOfBirth: string, on: string) =>
  Math.floor((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${dateOfBirth}T00:00:00Z`)) / 86_400_000);
