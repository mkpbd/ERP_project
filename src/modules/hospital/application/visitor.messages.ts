import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { VisitorPassProps } from '../domain/visitor-pass.js';

export interface VisitorPassView extends Omit<VisitorPassProps, 'issuedBy' | 'returnedBy'> {
  readonly issuedByName: string | null;
  readonly returnedByName: string | null;
  /** In force: not handed back, and the patient still in. */
  readonly valid: boolean;
}

/** A pass as printed: with the patient, the stay and where the patient lies. */
export interface VisitorPassCard extends VisitorPassView {
  readonly admissionNumber: string;
  readonly patientName: string;
  readonly uhid: number;
  readonly bedCode: string | null;
  readonly wardName: string | null;
}

export abstract class VisitorPassReadRepository {
  /** The admission's passes, newest first. */
  abstract list(admissionId: string): Promise<VisitorPassView[]>;
  abstract card(id: string): Promise<VisitorPassCard | null>;
}

export interface VisitorInput {
  readonly visitorName: string;
  readonly relation: string | null;
  readonly mobileNo: string | null;
}

export class IssueVisitorPassCommand extends Command<{ id: string; number: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly visitor: VisitorInput,
  ) {
    super();
  }
}

export class ReturnVisitorPassCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class ListVisitorPassesQuery extends Query<VisitorPassView[]> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}
