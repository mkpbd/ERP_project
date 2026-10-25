export interface AuthorizationProfile {
  readonly roles: readonly string[];
  /** Ids of the same roles, for modules that key their own grants by role (e.g. menus). */
  readonly roleIds: readonly string[];
  readonly permissions: ReadonlySet<string>;
}

export interface AccessRequirement {
  readonly permissions?: readonly string[];
  readonly roles?: readonly string[];
  /** `all` (default) requires every permission; `any` requires at least one. */
  readonly mode?: 'all' | 'any';
  /**
   * When set, the actor is allowed if they own the resource, even without the
   * listed permissions (e.g. a user reading their own profile).
   */
  readonly ownerId?: string;
}

/**
 * Authorization contract published by the access-control module. All
 * permission decisions go through this single policy evaluation point.
 */
export abstract class AccessControl {
  abstract getProfile(userId: string): Promise<AuthorizationProfile>;

  abstract isAllowed(userId: string, requirement: AccessRequirement): Promise<boolean>;

  /** Throws ForbiddenError when the requirement is not met. */
  abstract authorize(userId: string, requirement: AccessRequirement): Promise<void>;

  /**
   * Throws when removing `userId` from active duty would leave no active
   * super-admin. Must be called inside a transaction; it takes the
   * super-admin lock so concurrent removals are serialized.
   */
  abstract assertNotLastActiveSuperAdmin(userId: string): Promise<void>;

  /** Idempotently grants the super-admin role. Used by administrator bootstrap. */
  abstract grantSuperAdmin(userId: string, grantedBy: string | null): Promise<void>;

  abstract hasActiveSuperAdmin(): Promise<boolean>;

  abstract roleExists(roleId: string): Promise<boolean>;

  abstract invalidateUser(userId: string): void;
}
