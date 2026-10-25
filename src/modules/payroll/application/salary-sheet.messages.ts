import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { SalarySheetStatus } from '../domain/salary-sheet.js';
import type { SalarySheetLine } from '../domain/repositories.js';

export interface SalarySheetView {
  readonly year: number;
  readonly month: number;
  /** null: not approved yet (a preview). */
  readonly status: SalarySheetStatus | null;
  readonly approvedAt: Date | null;
  readonly committedAt: Date | null;
  readonly lines: SalarySheetLine[];
}

/** Works the month's sheet out from the current salaries and inputs, without saving anything. */
export class PreviewSalarySheetQuery extends Query<SalarySheetView> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
    readonly departmentId?: string,
  ) {
    super();
  }
}

/** The approved sheet as saved. */
export class GetSalarySheetQuery extends Query<SalarySheetView> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
    readonly departmentId?: string,
  ) {
    super();
  }
}

export class ApproveSalarySheetCommand extends Command<{ lines: number; netPayable: number }> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

export class CommitSalarySheetCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
  ) {
    super();
  }
}

/** Without a staff id: the actor's own payslip. */
export class GetPayslipQuery extends Query<SalarySheetLine> {
  constructor(
    readonly actor: Actor,
    readonly year: number,
    readonly month: number,
    readonly staffId?: string,
  ) {
    super();
  }
}
