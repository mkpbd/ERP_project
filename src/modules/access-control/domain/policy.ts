import { ForbiddenError } from '../../../shared/domain/errors.js';

export interface GrantedAccess {
  readonly roles: readonly string[];
  readonly permissions: ReadonlySet<string>;
}

export interface Requirement {
  readonly permissions?: readonly string[];
  readonly roles?: readonly string[];
  readonly mode?: 'all' | 'any';
}

/**
 * Central policy evaluation. Access comes only from explicitly granted
 * permissions; there is no wildcard or implicit super-admin bypass.
 */
export function satisfies(granted: GrantedAccess, requirement: Requirement): boolean {
  const roles = requirement.roles ?? [];
  if (roles.length > 0 && !roles.some((role) => granted.roles.includes(role))) return false;

  const permissions = requirement.permissions ?? [];
  if (permissions.length === 0) return true;
  return requirement.mode === 'any'
    ? permissions.some((permission) => granted.permissions.has(permission))
    : permissions.every((permission) => granted.permissions.has(permission));
}

/**
 * Privilege-escalation guard: an actor may only hand out (or take away)
 * permissions they hold themselves.
 */
export function assertCanDelegate(actorPermissions: ReadonlySet<string>, permissions: Iterable<string>): void {
  const missing = [...permissions].filter((permission) => !actorPermissions.has(permission));
  if (missing.length > 0) {
    throw new ForbiddenError(
      'privilege_escalation',
      `You cannot delegate permissions you do not hold: ${missing.sort().join(', ')}`,
    );
  }
}
