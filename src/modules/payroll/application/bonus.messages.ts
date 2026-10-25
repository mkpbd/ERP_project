import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { LeaveEncashmentLine } from '../domain/repositories.js';
import type { FestivalBonusSheet } from './read-models.js';

/** Works the bonus sheet out now, without saving. */
export class PreviewFestivalBonusQuery extends Query<FestivalBonusSheet> {
  constructor(
    readonly actor: Actor,
    readonly bonusId: string,
  ) {
    super();
  }
}

/** The saved bonus sheet (empty lines and null status when not approved). */
export class GetFestivalBonusSheetQuery extends Query<FestivalBonusSheet> {
  constructor(
    readonly actor: Actor,
    readonly bonusId: string,
  ) {
    super();
  }
}

export type FestivalBonusAction = 'approve' | 'commit' | 'reverse';

export class ActOnFestivalBonusCommand extends Command<{ lines: number; amount: number }> {
  constructor(
    readonly actor: Actor,
    readonly bonusId: string,
    readonly action: FestivalBonusAction,
  ) {
    super();
  }
}

export interface LeaveEncashmentView {
  readonly payYear: number;
  readonly payMonth: number;
  readonly lines: LeaveEncashmentLine[];
}

export class PreviewLeaveEncashmentQuery extends Query<LeaveEncashmentView> {
  constructor(
    readonly actor: Actor,
    readonly payYear: number,
    readonly payMonth: number,
    readonly yearlyLeaveDays: number,
  ) {
    super();
  }
}

export class GetLeaveEncashmentQuery extends Query<LeaveEncashmentView> {
  constructor(
    readonly actor: Actor,
    readonly payYear: number,
    readonly payMonth: number,
  ) {
    super();
  }
}

export class ApproveLeaveEncashmentCommand extends Command<{ lines: number; amount: number }> {
  constructor(
    readonly actor: Actor,
    readonly payYear: number,
    readonly payMonth: number,
    readonly yearlyLeaveDays: number,
  ) {
    super();
  }
}

export class RemoveLeaveEncashmentCommand extends Command<{ removed: number }> {
  constructor(
    readonly actor: Actor,
    readonly payYear: number,
    readonly payMonth: number,
  ) {
    super();
  }
}
