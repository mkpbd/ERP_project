export interface UserSummary {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

/**
 * Read-only view of user accounts published by the identity module for other
 * modules. Other modules never read the identity tables directly.
 */
export abstract class UserDirectory {
  abstract findSummaries(userIds: readonly string[]): Promise<UserSummary[]>;
}
