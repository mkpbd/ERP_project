import { ConflictError, DomainError } from '../../../shared/domain/errors.js';

export type RxStatus = 'draft' | 'signed' | 'cancelled';
export const PHRASE_KINDS = ['complaint', 'history', 'examination', 'diagnosis', 'advice', 'dose'] as const;
export type PhraseKind = (typeof PHRASE_KINDS)[number];

/** Text trimmed and kept within its length; empty becomes null. */
export function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

function required(value: string | null | undefined, max: number, what: string): string {
  const kept = text(value, max, what);
  if (!kept) throw new DomainError('invalid_text', `Give the ${what}`);
  return kept;
}

export interface Vitals {
  weightKg: number | null;
  heightCm: number | null;
  bpSystolic: number | null;
  bpDiastolic: number | null;
  pulse: number | null;
  temperatureF: number | null;
  spo2: number | null;
}

const LIMITS: Record<keyof Vitals, [number, number, string]> = {
  weightKg: [0.5, 400, 'weight'],
  heightCm: [20, 260, 'height'],
  bpSystolic: [40, 300, 'systolic pressure'],
  bpDiastolic: [20, 200, 'diastolic pressure'],
  pulse: [20, 250, 'pulse'],
  temperatureF: [86, 113, 'temperature'],
  spo2: [40, 100, 'SpO2'],
};

/** Vitals in plausible ranges; blood pressure both or neither, systolic above diastolic. */
export function checkedVitals(vitals: Vitals): Vitals {
  for (const [key, [low, high, what]] of Object.entries(LIMITS) as [keyof Vitals, [number, number, string]][]) {
    const value = vitals[key];
    if (value !== null && (!Number.isFinite(value) || value < low || value > high)) {
      throw new DomainError('invalid_vitals', `The ${what} is ${low} to ${high}`);
    }
  }
  if ((vitals.bpSystolic === null) !== (vitals.bpDiastolic === null)) {
    throw new DomainError('invalid_vitals', 'Give both blood pressures or neither');
  }
  if (vitals.bpSystolic !== null && vitals.bpSystolic <= vitals.bpDiastolic!) {
    throw new DomainError('invalid_vitals', 'The systolic pressure is above the diastolic');
  }
  return { ...vitals };
}

/** Body mass index to one decimal, when weight and height are known. */
export function bmi(vitals: Pick<Vitals, 'weightKg' | 'heightCm'>): number | null {
  if (vitals.weightKg === null || vitals.heightCm === null) return null;
  const metres = vitals.heightCm / 100;
  return Math.round((vitals.weightKg / (metres * metres)) * 10) / 10;
}

export interface Complaint {
  complaint: string;
  duration: string | null;
}
export interface DrugLine {
  productId: string | null;
  name: string;
  dose: string;
  duration: string | null;
  qty: number | null;
}
export interface TestLine {
  testId: string | null;
  name: string;
  note: string | null;
}

export interface RxContent {
  complaints: Complaint[];
  history: string | null;
  pastHistory: string | null;
  drugHistory: string | null;
  examination: string | null;
  diagnosis: string | null;
  treatmentPlan: string | null;
  notes: string | null;
  followUpOn: string | null;
  followUpNote: string | null;
  referral: string | null;
  drugs: DrugLine[];
  tests: TestLine[];
  advices: string[];
}

export function checkedDrugs(drugs: readonly DrugLine[]): DrugLine[] {
  if (drugs.length > 40) throw new DomainError('too_many_lines', 'A prescription has at most 40 medicines');
  return drugs.map((drug) => {
    if (drug.qty !== null && (!Number.isInteger(drug.qty) || drug.qty < 1 || drug.qty > 10_000)) {
      throw new DomainError('invalid_quantity', 'A quantity is a whole number from 1');
    }
    return {
      productId: drug.productId,
      name: required(drug.name, 200, 'medicine'),
      dose: required(drug.dose, 300, 'dose'),
      duration: text(drug.duration, 100, 'duration'),
      qty: drug.qty,
    };
  });
}

export function checkedTests(tests: readonly TestLine[]): TestLine[] {
  if (tests.length > 60) throw new DomainError('too_many_lines', 'A prescription has at most 60 tests');
  const seen = new Set<string>();
  return tests.map((test) => {
    const name = required(test.name, 200, 'test');
    const key = test.testId ?? name.toLowerCase();
    if (seen.has(key)) throw new DomainError('duplicate_test', `${name} is written twice`);
    seen.add(key);
    return { testId: test.testId, name, note: text(test.note, 200, 'test note') };
  });
}

export function checkedAdvices(advices: readonly string[]): string[] {
  if (advices.length > 40) throw new DomainError('too_many_lines', 'A prescription has at most 40 advices');
  return advices.map((advice) => required(advice, 500, 'advice'));
}

/** What the doctor wrote, checked against the visit's day. */
export function checkedContent(content: RxContent, visitOn: string): RxContent {
  if (content.complaints.length > 20) throw new DomainError('too_many_lines', 'At most 20 complaints');
  if (content.followUpOn !== null && content.followUpOn < visitOn) {
    throw new DomainError('invalid_date', 'The follow-up is after the visit');
  }
  return {
    complaints: content.complaints.map((entry) => ({
      complaint: required(entry.complaint, 200, 'complaint'),
      duration: text(entry.duration, 50, 'duration'),
    })),
    history: text(content.history, 4000, 'history'),
    pastHistory: text(content.pastHistory, 2000, 'past history'),
    drugHistory: text(content.drugHistory, 2000, 'drug history'),
    examination: text(content.examination, 4000, 'examination'),
    diagnosis: text(content.diagnosis, 1000, 'diagnosis'),
    treatmentPlan: text(content.treatmentPlan, 2000, 'treatment plan'),
    notes: text(content.notes, 2000, 'notes'),
    followUpOn: content.followUpOn,
    followUpNote: text(content.followUpNote, 300, 'follow-up note'),
    referral: text(content.referral, 500, 'referral'),
    drugs: checkedDrugs(content.drugs),
    tests: checkedTests(content.tests),
    advices: checkedAdvices(content.advices),
  };
}

export const EMPTY_CONTENT: RxContent = {
  complaints: [],
  history: null,
  pastHistory: null,
  drugHistory: null,
  examination: null,
  diagnosis: null,
  treatmentPlan: null,
  notes: null,
  followUpOn: null,
  followUpNote: null,
  referral: null,
  drugs: [],
  tests: [],
  advices: [],
};

const NO_VITALS: Vitals = {
  weightKg: null,
  heightCm: null,
  bpSystolic: null,
  bpDiastolic: null,
  pulse: null,
  temperatureF: null,
  spo2: null,
};

export interface PrescriptionProps extends Vitals, RxContent {
  id: string;
  number: string;
  patientId: string;
  doctorId: string;
  appointmentId: string | null;
  visitNo: number;
  visitOn: string;
  status: RxStatus;
  vitalsBy: string | null;
  vitalsAt: Date | null;
  signedBy: string | null;
  signedAt: Date | null;
  cancelReason: string | null;
  openedBy: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old Rx.VisitHistory with InitialData, drugs, investigations and advice: the doctor's prescription for one visit.
 * The assistant takes the vitals while it is a draft; the doctor writes it and signs it. A signed prescription is
 * changed only by reopening it on the visit's day; a draft never signed may be cancelled (the patient left).
 */
export class Prescription {
  private constructor(private readonly props: PrescriptionProps) {}

  static open(params: {
    id: string;
    number: string;
    patientId: string;
    doctorId: string;
    appointmentId: string | null;
    visitNo: number;
    visitOn: string;
    by: string;
    at: Date;
  }): Prescription {
    return new Prescription({
      ...NO_VITALS,
      ...EMPTY_CONTENT,
      id: params.id,
      number: params.number,
      patientId: params.patientId,
      doctorId: params.doctorId,
      appointmentId: params.appointmentId,
      visitNo: params.visitNo,
      visitOn: params.visitOn,
      status: 'draft',
      vitalsBy: null,
      vitalsAt: null,
      signedBy: null,
      signedAt: null,
      cancelReason: null,
      openedBy: params.by,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: PrescriptionProps): Prescription {
    return new Prescription({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get number(): string {
    return this.props.number;
  }
  get doctorId(): string {
    return this.props.doctorId;
  }
  get patientId(): string {
    return this.props.patientId;
  }
  get status(): RxStatus {
    return this.props.status;
  }
  get visitOn(): string {
    return this.props.visitOn;
  }

  recordVitals(vitals: Vitals, by: string, at: Date): void {
    this.assertDraft();
    Object.assign(this.props, checkedVitals(vitals));
    this.props.vitalsBy = by;
    this.props.vitalsAt = at;
    this.touch(at);
  }

  write(content: RxContent, at: Date): void {
    this.assertDraft();
    Object.assign(this.props, checkedContent(content, this.props.visitOn));
    this.touch(at);
  }

  /** Signed with something prescribed: a diagnosis, a medicine, a test or an advice. */
  sign(by: string, at: Date): void {
    this.assertDraft();
    const { diagnosis, drugs, tests, advices } = this.props;
    if (!diagnosis && drugs.length === 0 && tests.length === 0 && advices.length === 0) {
      throw new DomainError('nothing_prescribed', 'Write a diagnosis, a medicine, a test or an advice first');
    }
    this.props.status = 'signed';
    this.props.signedBy = by;
    this.props.signedAt = at;
    this.touch(at);
  }

  /** Back to a draft for a correction, on the visit's day only (the last signing is kept until signed again). */
  reopen(today: string, at: Date): void {
    if (this.props.status !== 'signed') throw new DomainError('rx_state', `The prescription is ${this.props.status}`);
    if (today !== this.props.visitOn) {
      throw new DomainError('rx_locked', 'A prescription is corrected on the day of the visit only; write a new one');
    }
    this.props.status = 'draft';
    this.touch(at);
  }

  /** A draft never signed: the patient left without seeing the doctor. */
  cancel(reason: string | null, at: Date): void {
    this.assertDraft();
    if (this.props.signedAt !== null) {
      throw new DomainError('rx_state', 'A prescription signed once is corrected, not cancelled');
    }
    this.props.status = 'cancelled';
    this.props.cancelReason = text(reason, 300, 'reason');
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_prescription', 'The prescription was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<PrescriptionProps> {
    return { ...this.props };
  }

  private assertDraft(): void {
    if (this.props.status !== 'draft') throw new DomainError('rx_state', `The prescription is ${this.props.status}`);
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}

export interface TemplateProps {
  id: string;
  doctorId: string;
  name: string;
  diagnosis: string | null;
  drugs: DrugLine[];
  tests: TestLine[];
  advices: string[];
  version: number;
}

/** A doctor's set of medicines, tests and advice (old DigitalRx presets), checked like a prescription's. */
export function checkedTemplate(input: Omit<TemplateProps, 'id' | 'doctorId' | 'version'>) {
  const drugs = checkedDrugs(input.drugs);
  const tests = checkedTests(input.tests);
  const advices = checkedAdvices(input.advices);
  if (drugs.length + tests.length + advices.length === 0) {
    throw new DomainError('empty_template', 'A template holds a medicine, a test or an advice');
  }
  return {
    name: required(input.name, 100, 'template name'),
    diagnosis: text(input.diagnosis, 1000, 'diagnosis'),
    drugs,
    tests,
    advices,
  };
}
