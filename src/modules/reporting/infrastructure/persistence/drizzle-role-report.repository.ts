import { Injectable } from '@nestjs/common';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { RoleReportRepository } from '../../domain/repositories.js';
import { roleReports } from './reporting.schema.js';

@Injectable()
export class DrizzleRoleReportRepository extends RoleReportRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async keysForRoles(roleIds: readonly string[]): Promise<string[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.context.db
      .selectDistinct({ key: roleReports.reportKey })
      .from(roleReports)
      .where(inArray(roleReports.roleId, [...roleIds]));
    return rows.map((row) => row.key);
  }

  async replace(roleId: string, reportKeys: readonly string[], grantedBy: string, now: Date): Promise<void> {
    await this.context.db
      .delete(roleReports)
      .where(
        reportKeys.length > 0
          ? and(eq(roleReports.roleId, roleId), notInArray(roleReports.reportKey, [...reportKeys]))
          : eq(roleReports.roleId, roleId),
      );
    if (reportKeys.length === 0) return;
    await this.context.db
      .insert(roleReports)
      .values(reportKeys.map((reportKey) => ({ roleId, reportKey, grantedBy, grantedAt: now })))
      .onConflictDoNothing();
  }
}
