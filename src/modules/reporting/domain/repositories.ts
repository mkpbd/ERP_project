export abstract class RoleReportRepository {
  abstract keysForRoles(roleIds: readonly string[]): Promise<string[]>;
  /** Makes the role hold exactly `reportKeys`. */
  abstract replace(roleId: string, reportKeys: readonly string[], grantedBy: string, now: Date): Promise<void>;
}
