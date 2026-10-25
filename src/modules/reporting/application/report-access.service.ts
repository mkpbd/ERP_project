import { Injectable } from '@nestjs/common';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { ReportRegistry, type ReportDefinition } from '../../../shared/application/reports.js';
import { ForbiddenError, NotFoundError } from '../../../shared/domain/errors.js';
import { RoleReportRepository } from '../domain/repositories.js';
import { REPORTS_ACCESS_ALL } from './ports.js';

export interface RunnableReports {
  readonly accessAll: boolean;
  readonly keys: ReadonlySet<string>;
}

/** Who may run which report: role grants (old ReportPermissions) or reports:access-all. */
@Injectable()
export class ReportAccessService {
  constructor(
    private readonly registry: ReportRegistry,
    private readonly grants: RoleReportRepository,
    private readonly access: AccessControl,
  ) {}

  async runnable(userId: string): Promise<RunnableReports> {
    const profile = await this.access.getProfile(userId);
    return {
      accessAll: profile.permissions.has(REPORTS_ACCESS_ALL),
      keys: new Set(await this.grants.keysForRoles(profile.roleIds)),
    };
  }

  /** Uncached profile: used before handing reports to roles. */
  async runnableFresh(userId: string): Promise<RunnableReports> {
    this.access.invalidateUser(userId);
    return this.runnable(userId);
  }

  async visibleTo(userId: string): Promise<ReportDefinition[]> {
    const runnable = await this.runnable(userId);
    return this.registry.all().filter((report) => runnable.accessAll || runnable.keys.has(report.key));
  }

  /** The report, if it exists and the user may run it. Unknown and forbidden reports look the same. */
  async requireRunnable(userId: string, key: string): Promise<ReportDefinition> {
    const definition = this.registry.get(key);
    const runnable = await this.runnable(userId);
    if (!definition) throw new NotFoundError('report');
    if (!runnable.accessAll && !runnable.keys.has(key)) {
      throw new ForbiddenError('report_not_granted', 'Your roles do not have this report');
    }
    return definition;
  }
}
