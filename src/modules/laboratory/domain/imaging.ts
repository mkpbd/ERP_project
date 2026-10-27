import { ConflictError, DomainError } from '../../../shared/domain/errors.js';
import { text } from './lab.js';

export type StudyStatus = 'done' | 'signed' | 'delivered';
export const MAX_TEMPLATES = 30;

export interface ImagingTemplate {
  readonly name: string;
  readonly findings: string;
  readonly impression: string;
}

/** A test's report templates: names once, each with its wording. */
export function checkedTemplates(templates: readonly ImagingTemplate[]): ImagingTemplate[] {
  if (templates.length > MAX_TEMPLATES) {
    throw new DomainError('invalid_templates', `A test has at most ${MAX_TEMPLATES} templates`);
  }
  const seen = new Set<string>();
  return templates.map((template, index) => {
    const at = `Template ${index + 1}`;
    const name = text(template.name, 100, 'template name');
    const findings = text(template.findings, 8000, 'findings');
    const impression = text(template.impression, 2000, 'impression');
    if (!name || !findings || !impression) {
      throw new DomainError('invalid_templates', `${at}: give its name, findings and impression`);
    }
    if (seen.has(name.toLowerCase())) throw new DomainError('invalid_templates', `${at}: ${name} is there already`);
    seen.add(name.toLowerCase());
    return { name, findings, impression };
  });
}

/** Old UNP.GetNextAccessionNumber as a readable number: AC-yymmdd-0001, counted per day. */
export const accessionNumber = (on: string, serial: number) =>
  `AC-${on.slice(2, 4)}${on.slice(5, 7)}${on.slice(8, 10)}-${String(serial).padStart(4, '0')}`;

export interface StudyProps {
  id: string;
  accessionNumber: string;
  billId: string;
  line: number;
  testId: string;
  patientId: string;
  doneOn: string;
  doneAt: Date;
  doneBy: string | null;
  status: StudyStatus;
  findings: string | null;
  impression: string | null;
  radiologistId: string | null;
  signedBy: string | null;
  signedAt: Date | null;
  reportingFee: number;
  deliveredTo: string | null;
  deliveredBy: string | null;
  deliveredAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Old radiology report entry, finalisation and publishing (RadiologyReports; the worklist by accession number): an
 * imaging test done for a bill, its findings and impression written, signed by the radiologist (who reports it;
 * no second verifier) and handed over. A signature is taken back for a correction before the report is handed over.
 */
export class ImagingStudy {
  private constructor(private readonly props: StudyProps) {}

  static done(params: {
    id: string;
    accessionNumber: string;
    billId: string;
    line: number;
    testId: string;
    patientId: string;
    doneOn: string;
    by: string;
    at: Date;
  }): ImagingStudy {
    return new ImagingStudy({
      id: params.id,
      accessionNumber: params.accessionNumber,
      billId: params.billId,
      line: params.line,
      testId: params.testId,
      patientId: params.patientId,
      doneOn: params.doneOn,
      doneAt: params.at,
      doneBy: params.by,
      status: 'done',
      findings: null,
      impression: null,
      radiologistId: null,
      signedBy: null,
      signedAt: null,
      reportingFee: 0,
      deliveredTo: null,
      deliveredBy: null,
      deliveredAt: null,
      version: 1,
      createdAt: params.at,
      updatedAt: params.at,
    });
  }

  static restore(props: StudyProps): ImagingStudy {
    return new ImagingStudy({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get accessionNumber(): string {
    return this.props.accessionNumber;
  }
  get billId(): string {
    return this.props.billId;
  }
  get line(): number {
    return this.props.line;
  }
  get status(): StudyStatus {
    return this.props.status;
  }
  get radiologistId(): string | null {
    return this.props.radiologistId;
  }
  get reportingFee(): number {
    return this.props.reportingFee;
  }

  /** The report written or corrected before it is signed. */
  write(params: { findings: string | null; impression: string | null; radiologistId: string | null; at: Date }): void {
    if (this.props.status !== 'done')
      throw new DomainError('study_state', `A ${this.props.status} report is not changed`);
    this.props.findings = text(params.findings, 8000, 'findings');
    this.props.impression = text(params.impression, 2000, 'impression');
    this.props.radiologistId = params.radiologistId;
    this.touch(params.at);
  }

  /** Signed for the radiologist; the reporting fee credited to them is kept to take back on a correction. */
  sign(by: string, at: Date): void {
    if (this.props.status !== 'done')
      throw new DomainError('study_state', `A ${this.props.status} report is not signed`);
    if (!this.props.findings || !this.props.impression || !this.props.radiologistId) {
      throw new DomainError('report_incomplete', 'Write the findings and impression and name the radiologist first');
    }
    this.props.status = 'signed';
    this.props.signedBy = by;
    this.props.signedAt = at;
    this.touch(at);
  }

  feeCredited(amount: number): void {
    this.props.reportingFee = amount;
  }

  /** Back to written for a correction; returns the fee to take back. */
  unsign(at: Date): number {
    if (this.props.status !== 'signed')
      throw new DomainError('study_state', `A ${this.props.status} report is not reopened`);
    const fee = this.props.reportingFee;
    this.props.status = 'done';
    this.props.signedBy = null;
    this.props.signedAt = null;
    this.props.reportingFee = 0;
    this.touch(at);
    return fee;
  }

  deliver(to: string, by: string, at: Date): void {
    if (this.props.status !== 'signed')
      throw new DomainError('study_state', `A ${this.props.status} report is not handed over`);
    const whom = text(to, 150, 'who collected it');
    if (!whom) throw new DomainError('invalid_remarks', 'Say who collected the report');
    this.props.status = 'delivered';
    this.props.deliveredTo = whom;
    this.props.deliveredBy = by;
    this.props.deliveredAt = at;
    this.touch(at);
  }

  assertVersion(version: number): void {
    if (version !== this.props.version) {
      throw new ConflictError('stale_study', 'The study was changed by someone else; reload it');
    }
  }

  toSnapshot(): Readonly<StudyProps> {
    return { ...this.props };
  }

  private touch(at: Date): void {
    this.props.version += 1;
    this.props.updatedAt = at;
  }
}
