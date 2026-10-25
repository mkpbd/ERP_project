import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { ReportFormat } from '../../../shared/application/reports.js';

export interface ReportSummaryView {
  readonly key: string;
  readonly title: string;
  readonly group: string;
  readonly description: string;
  readonly formats: ReportFormat[];
}

export interface ReportDetailView extends ReportSummaryView {
  /** JSON Schema of the parameters, for building the filter form. */
  readonly parameters: Record<string, unknown>;
}

export interface RenderedReport {
  readonly fileName: string;
  readonly contentType: string;
  readonly data: Uint8Array;
}

export interface RoleReportsView {
  readonly roleId: string;
  readonly reportKeys: string[];
}

export class ListMyReportsQuery extends Query<ReportSummaryView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class ListAllReportsQuery extends Query<ReportSummaryView[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class GetReportQuery extends Query<ReportDetailView> {
  constructor(
    readonly actor: Actor,
    readonly key: string,
  ) {
    super();
  }
}

/** A command because each run is audited (who exported which data). */
export class RenderReportCommand extends Command<RenderedReport> {
  constructor(
    readonly actor: Actor,
    readonly key: string,
    readonly format: ReportFormat,
    readonly params: Record<string, unknown>,
  ) {
    super();
  }
}

export class GetRoleReportsQuery extends Query<RoleReportsView> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
  ) {
    super();
  }
}

export class SetRoleReportsCommand extends Command<RoleReportsView> {
  constructor(
    readonly actor: Actor,
    readonly roleId: string,
    readonly reportKeys: readonly string[],
  ) {
    super();
  }
}
