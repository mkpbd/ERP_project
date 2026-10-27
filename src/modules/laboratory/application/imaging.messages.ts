import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { ImagingTemplate, StudyStatus } from '../domain/imaging.js';

export interface StudyFilter extends PageRequest {
  readonly status?: StudyStatus | undefined;
  readonly billId?: string | undefined;
  readonly radiologistId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface StudySummary {
  readonly id: string;
  readonly accessionNumber: string;
  readonly billId: string;
  readonly line: number;
  readonly testId: string;
  readonly patientId: string;
  readonly doneOn: string;
  readonly doneAt: Date;
  readonly status: StudyStatus;
  readonly radiologistId: string | null;
  readonly version: number;
}

export interface StudyRecord extends StudySummary {
  readonly findings: string | null;
  readonly impression: string | null;
  readonly signedBy: string | null;
  readonly signedAt: Date | null;
  readonly reportingFee: number;
  readonly deliveredTo: string | null;
  readonly deliveredAt: Date | null;
}

export abstract class ImagingReadRepository {
  abstract studies(filter: StudyFilter): Promise<Page<StudySummary>>;
  abstract study(id: string): Promise<StudyRecord | null>;
}

export class SetImagingTemplatesCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
    readonly templates: readonly ImagingTemplate[],
  ) {
    super();
  }
}

export class GetImagingTemplatesQuery extends Query<ImagingTemplate[]> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
  ) {
    super();
  }
}

export class MarkStudyDoneCommand extends Command<{ id: string; accessionNumber: string }> {
  constructor(
    readonly actor: Actor,
    readonly billId: string,
    readonly line: number,
  ) {
    super();
  }
}

export type StudyChange =
  | {
      readonly kind: 'write';
      readonly findings: string | null;
      readonly impression: string | null;
      readonly radiologistId: string | null;
    }
  | { readonly kind: 'sign' }
  | { readonly kind: 'unsign' }
  | { readonly kind: 'deliver'; readonly to: string };

export class ChangeStudyCommand extends Command<{ reportingFee: number }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly version: number,
    readonly change: StudyChange,
  ) {
    super();
  }
}

export class ListStudiesQuery extends Query<unknown> {
  constructor(
    readonly actor: Actor,
    readonly filter: StudyFilter,
  ) {
    super();
  }
}

export class GetStudyQuery extends Query<unknown> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}
