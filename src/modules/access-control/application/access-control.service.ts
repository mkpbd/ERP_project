import { Inject, Injectable } from '@nestjs/common';
import {
  AccessControl,
  type AccessRequirement,
  type AuthorizationProfile,
} from '../../../shared/application/contracts/access-control.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, ForbiddenError } from '../../../shared/domain/errors.js';
import { SUPER_ADMIN_ROLE } from '../domain/permission-catalog.js';
import { satisfies } from '../domain/policy.js';
import { RoleRepository, UserRoleRepository } from '../domain/repositories.js';
import { ACCESS_CONTROL_SETTINGS, AccessReadRepository, type AccessControlSettings } from './read-models.js';

export const SUPER_ADMIN_LOCK = 'access-control:super-admin';
const MAX_CACHED_PROFILES = 10_000;

/**
 * The single authorization decision point. Profiles are cached per process
 * for a short TTL and invalidated whenever assignments change.
 */
@Injectable()
export class AccessControlService extends AccessControl {
  private readonly cache = new Map<string, { profile: AuthorizationProfile; expiresAt: number }>();

  constructor(
    private readonly read: AccessReadRepository,
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly users: UserDirectory,
    private readonly tx: TransactionManager,
    private readonly clock: Clock,
    @Inject(ACCESS_CONTROL_SETTINGS) private readonly settings: AccessControlSettings,
  ) {
    super();
  }

  async getProfile(userId: string): Promise<AuthorizationProfile> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.profile;
    return this.loadProfile(userId);
  }

  async isAllowed(userId: string, requirement: AccessRequirement): Promise<boolean> {
    if (requirement.ownerId !== undefined && requirement.ownerId === userId) return true;
    return satisfies(await this.getProfile(userId), requirement);
  }

  async authorize(userId: string, requirement: AccessRequirement): Promise<void> {
    if (!(await this.isAllowed(userId, requirement))) throw new ForbiddenError();
  }

  /**
   * Uncached check used before changing assignments, so a revoked
   * administrator cannot act on a stale cached profile.
   */
  async requireFresh(userId: string, permissions: readonly string[]): Promise<AuthorizationProfile> {
    const profile = await this.loadProfile(userId);
    if (!satisfies(profile, { permissions })) throw new ForbiddenError();
    return profile;
  }

  async assertNotLastActiveSuperAdmin(userId: string): Promise<void> {
    await this.tx.lock(SUPER_ADMIN_LOCK);
    const holders = await this.userRoles.userIdsWithRole(SUPER_ADMIN_ROLE);
    if (!holders.includes(userId)) return;
    const others = await this.users.findSummaries(holders.filter((id) => id !== userId));
    if (!others.some((user) => user.isActive)) {
      throw new DomainError('last_super_admin', 'The last active super-admin cannot be removed or deactivated');
    }
  }

  async grantSuperAdmin(userId: string, grantedBy: string | null): Promise<void> {
    await this.tx.run(async () => {
      await this.tx.lock(SUPER_ADMIN_LOCK);
      const role = await this.roles.findByName(SUPER_ADMIN_ROLE);
      if (!role) throw new Error('The super-admin role is missing; the permission catalog has not been synchronized');
      await this.userRoles.assign(userId, role.id, grantedBy, this.clock.now());
    });
    this.invalidateUser(userId);
  }

  async hasActiveSuperAdmin(): Promise<boolean> {
    const holders = await this.userRoles.userIdsWithRole(SUPER_ADMIN_ROLE);
    const summaries = await this.users.findSummaries(holders);
    return summaries.some((user) => user.isActive);
  }

  async roleExists(roleId: string): Promise<boolean> {
    return (await this.roles.findById(roleId)) !== null;
  }

  usersWithRoles(roleIds: readonly string[]): Promise<string[]> {
    return roleIds.length === 0 ? Promise.resolve([]) : this.userRoles.userIdsWithRoleIds(roleIds);
  }

  invalidateUser(userId: string): void {
    this.cache.delete(userId);
  }

  invalidateAll(): void {
    this.cache.clear();
  }

  private async loadProfile(userId: string): Promise<AuthorizationProfile> {
    const loaded = await this.read.getProfile(userId);
    const profile: AuthorizationProfile = {
      roles: loaded.roles,
      roleIds: loaded.roleIds,
      permissions: new Set(loaded.permissions),
    };
    if (this.settings.profileCacheTtlSeconds > 0) {
      if (this.cache.size >= MAX_CACHED_PROFILES) {
        const oldest = this.cache.keys().next();
        if (!oldest.done) this.cache.delete(oldest.value);
      }
      this.cache.set(userId, { profile, expiresAt: Date.now() + this.settings.profileCacheTtlSeconds * 1000 });
    }
    return profile;
  }
}
