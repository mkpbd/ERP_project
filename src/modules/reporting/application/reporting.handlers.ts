import { Inject } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { z } from 'zod';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { OrganizationProfile } from '../../../shared/application/contracts/organization-profile.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import {
  formatsOf,
  ReportRegistry,
  type ReportDefinition,
  type ReportFormat,
} from '../../../shared/application/reports.js';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/domain/errors.js';
import { RoleReportRepository } from '../domain/repositories.js';
import { REPORTING_SETTINGS, ReportRenderer, type ReportingSettings } from './ports.js';
import { ReportAccessService } from './report-access.service.js';
import {
  GetReportQuery,
  GetRoleReportsQuery,
  ListAllReportsQuery,
  ListMyReportsQuery,
  RenderReportCommand,
  SetRoleReportsCommand,
  type RenderedReport,
  type ReportDetailView,
  type ReportSummaryView,
  type RoleReportsView,
} from './reporting.messages.js';

const summary = (report: ReportDefinition): ReportSummaryView => ({
  key: report.key,
  title: report.title,
  group: report.group,
  description: report.description,
  formats: formatsOf(report),
});

const EXTENSIONS: Record<ReportFormat, string> = { pdf: 'pdf', xlsx: 'xlsx' };

/** `stock-summary-2026-10-25.pdf`: ASCII only, safe in Content-Disposition. */
export function reportFileName(title: string, generatedAt: Date, timeZone: string, format: ReportFormat): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'report';
  const day = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    generatedAt,
  );
  return `${slug}-${day}.${EXTENSIONS[format]}`;
}

@QueryHandler(ListMyReportsQuery)
export class ListMyReportsHandler implements IQueryHandler<ListMyReportsQuery> {
  constructor(private readonly reports: ReportAccessService) {}

  async execute({ actor }: ListMyReportsQuery): Promise<ReportSummaryView[]> {
    return (await this.reports.visibleTo(actor.userId)).map(summary);
  }
}

@QueryHandler(ListAllReportsQuery)
export class ListAllReportsHandler implements IQueryHandler<ListAllReportsQuery> {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor }: ListAllReportsQuery): Promise<ReportSummaryView[]> {
    await this.access.authorize(actor.userId, { permissions: ['reports:read'] });
    return this.registry.all().map(summary);
  }
}

@QueryHandler(GetReportQuery)
export class GetReportHandler implements IQueryHandler<GetReportQuery> {
  constructor(private readonly reports: ReportAccessService) {}

  async execute({ actor, key }: GetReportQuery): Promise<ReportDetailView> {
    const report = await this.reports.requireRunnable(actor.userId, key);
    const { $schema: _ignored, ...parameters } = z.toJSONSchema(report.params, { io: 'input', unrepresentable: 'any' });
    return { ...summary(report), parameters };
  }
}

@CommandHandler(RenderReportCommand)
export class RenderReportHandler implements ICommandHandler<RenderReportCommand> {
  constructor(
    private readonly reports: ReportAccessService,
    private readonly renderer: ReportRenderer,
    private readonly organization: OrganizationProfile,
    private readonly users: UserDirectory,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    @Inject(REPORTING_SETTINGS) private readonly settings: ReportingSettings,
  ) {}

  async execute({ actor, key, format, params }: RenderReportCommand): Promise<RenderedReport> {
    const definition = await this.reports.requireRunnable(actor.userId, key);
    const formats = formatsOf(definition);
    if (!formats.includes(format)) {
      throw new DomainError('report_format_unsupported', `This report is available as: ${formats.join(', ')}`);
    }
    const parsed = definition.params.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid report parameters',
        parsed.error.issues.map((issue) => ({
          path: ['body', 'params', ...issue.path.map(String)].join('.'),
          message: issue.message,
        })),
      );
    }

    const [header, users] = await Promise.all([
      this.organization.reportHeader(),
      this.users.findSummaries([actor.userId]),
    ]);
    const context = {
      actor,
      header,
      generatedAt: this.clock.now(),
      printedBy: users[0]?.displayName ?? '',
      timeZone: this.settings.timeZone,
    };
    const data = await definition.load(parsed.data, context);
    const filters = definition.describe?.(parsed.data, data) ?? '';
    const file = await this.renderer.render({ definition, data, context, format, filters });

    await this.audit.record({
      action: 'report.rendered',
      actorUserId: actor.userId,
      resourceType: 'report',
      resourceId: key,
      metadata: { format },
    });
    return { fileName: reportFileName(definition.title, context.generatedAt, context.timeZone, format), ...file };
  }
}

@QueryHandler(GetRoleReportsQuery)
export class GetRoleReportsHandler implements IQueryHandler<GetRoleReportsQuery> {
  constructor(
    private readonly grants: RoleReportRepository,
    private readonly access: AccessControl,
  ) {}

  async execute({ actor, roleId }: GetRoleReportsQuery): Promise<RoleReportsView> {
    await this.access.authorize(actor.userId, { permissions: ['reports:read'] });
    if (!(await this.access.roleExists(roleId))) throw new NotFoundError('role');
    return { roleId, reportKeys: (await this.grants.keysForRoles([roleId])).sort() };
  }
}

@CommandHandler(SetRoleReportsCommand)
export class SetRoleReportsHandler implements ICommandHandler<SetRoleReportsCommand> {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly reports: ReportAccessService,
    private readonly grants: RoleReportRepository,
    private readonly access: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, roleId, reportKeys }: SetRoleReportsCommand): Promise<RoleReportsView> {
    const caller = await this.reports.runnableFresh(actor.userId);
    await this.access.authorize(actor.userId, { permissions: ['reports:assign'] });
    if (reportKeys.some((key) => !this.registry.get(key))) throw new NotFoundError('report');
    const desired = [...new Set(reportKeys)].sort();

    await this.tx.run(async () => {
      if (!(await this.access.roleExists(roleId))) throw new NotFoundError('role');
      const current = new Set(await this.grants.keysForRoles([roleId]));
      const added = desired.filter((key) => !current.has(key));
      // Grants for reports that no longer exist in code are dropped without a delegation check.
      const removed = [...current].filter((key) => !desired.includes(key) && this.registry.get(key)).sort();
      if (!caller.accessAll && [...added, ...removed].some((key) => !caller.keys.has(key))) {
        throw new ForbiddenError('privilege_escalation', 'You can only grant or remove reports you can run yourself');
      }
      await this.grants.replace(roleId, desired, actor.userId, this.clock.now());
      if (added.length > 0 || removed.length > 0) {
        await this.audit.record({
          action: 'role.reports_changed',
          actorUserId: actor.userId,
          resourceType: 'role',
          resourceId: roleId,
          metadata: { added, removed },
        });
      }
    });
    return { roleId, reportKeys: desired };
  }
}
