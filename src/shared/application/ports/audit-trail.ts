export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEntry {
  readonly action: string;
  readonly actorUserId: string | null;
  readonly resourceType: string;
  readonly resourceId?: string | null;
  readonly outcome?: AuditOutcome;
  /** Must never contain passwords, tokens or other secrets. */
  readonly metadata?: Record<string, string | number | boolean | null | string[]>;
}

/**
 * Records security-relevant changes. Writes join the caller's transaction so
 * that an audit record exists if and only if the change committed.
 */
export abstract class AuditTrail {
  abstract record(entry: AuditEntry): Promise<void>;
}
