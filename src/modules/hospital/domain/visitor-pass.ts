import { DomainError } from '../../../shared/domain/errors.js';
import { text } from './patient.js';

export const VISITOR_PASS_STATUSES = ['active', 'returned'] as const;
export type VisitorPassStatus = (typeof VISITOR_PASS_STATUSES)[number];

export interface VisitorPassProps {
  id: string;
  number: string;
  admissionId: string;
  visitorName: string;
  relation: string | null;
  mobileNo: string | null;
  status: VisitorPassStatus;
  issuedAt: Date;
  issuedBy: string | null;
  returnedAt: Date | null;
  returnedBy: string | null;
}

/**
 * Old Visiting Card: a pass for an admitted patient's attendant, good while the patient is in. A pass is handed back
 * (lost or no longer needed) so that another can be issued within the limit; a discharge ends them all.
 */
export class VisitorPass {
  private constructor(private readonly props: VisitorPassProps) {}

  static issue(params: {
    id: string;
    number: string;
    admissionId: string;
    visitorName: string;
    relation: string | null;
    mobileNo: string | null;
    by: string;
    at: Date;
  }): VisitorPass {
    const visitorName = text(params.visitorName, 150, 'visitor name');
    if (!visitorName) throw new DomainError('invalid_text', "Give the visitor's name");
    const mobileNo = text(params.mobileNo, 20, 'mobile number');
    if (mobileNo && !/^\+?[0-9][0-9 -]{5,18}$/.test(mobileNo)) {
      throw new DomainError('invalid_mobile', 'The mobile number has digits only');
    }
    return new VisitorPass({
      id: params.id,
      number: params.number,
      admissionId: params.admissionId,
      visitorName,
      relation: text(params.relation, 50, 'relation'),
      mobileNo,
      status: 'active',
      issuedAt: params.at,
      issuedBy: params.by,
      returnedAt: null,
      returnedBy: null,
    });
  }

  static restore(props: VisitorPassProps): VisitorPass {
    return new VisitorPass({ ...props });
  }

  get admissionId(): string {
    return this.props.admissionId;
  }

  handBack(by: string, at: Date): void {
    if (this.props.status !== 'active') throw new DomainError('pass_state', 'The pass was handed back already');
    this.props.status = 'returned';
    this.props.returnedAt = at;
    this.props.returnedBy = by;
  }

  toSnapshot(): Readonly<VisitorPassProps> {
    return { ...this.props };
  }
}
