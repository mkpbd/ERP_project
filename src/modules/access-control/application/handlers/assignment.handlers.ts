import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { UserDirectory } from '../../../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { UserRolesChangedEvent } from '../../domain/events.js';
import { PERMISSION_CATALOG, SUPER_ADMIN_ROLE } from '../../domain/permission-catalog.js';
import { assertCanDelegate } from '../../domain/policy.js';
import { PermissionRepository, RoleRepository, UserRoleRepository } from '../../domain/repositories.js';
import { AccessControlService, SUPER_ADMIN_LOCK } from '../access-control.service.js';
import {
  AssignUserRoleCommand,
  RevokeUserRoleCommand,
  SyncPermissionCatalogCommand,
} from '../commands/access-control.commands.js';

@CommandHandler(AssignUserRoleCommand)
export class AssignUserRoleHandler implements ICommandHandler<AssignUserRoleCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly users: UserDirectory,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, userId, roleId }: AssignUserRoleCommand): Promise<void> {
    const profile = await this.access.requireFresh(actor.userId, ['permissions:assign']);
    const role = await this.roles.findById(roleId);
    if (!role) throw new NotFoundError('role');
    // Assigning a role hands out every permission in it.
    assertCanDelegate(profile.permissions, role.permissions);
    if ((await this.users.findSummaries([userId])).length === 0) throw new NotFoundError('user');

    const now = this.clock.now();
    const assigned = await this.tx.run(async () => {
      if (role.name === SUPER_ADMIN_ROLE) await this.tx.lock(SUPER_ADMIN_LOCK);
      const created = await this.userRoles.assign(userId, roleId, actor.userId, now);
      if (created) {
        await this.audit.record({
          action: 'user.role_assigned',
          actorUserId: actor.userId,
          resourceType: 'user',
          resourceId: userId,
          metadata: { roleId, role: role.name },
        });
      }
      return created;
    });
    if (assigned) this.eventBus.publish(new UserRolesChangedEvent(userId, now));
  }
}

@CommandHandler(RevokeUserRoleCommand)
export class RevokeUserRoleHandler implements ICommandHandler<RevokeUserRoleCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly userRoles: UserRoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, userId, roleId }: RevokeUserRoleCommand): Promise<void> {
    const profile = await this.access.requireFresh(actor.userId, ['permissions:assign']);
    const role = await this.roles.findById(roleId);
    if (!role) throw new NotFoundError('role');
    // Only someone at least as privileged as the role may take it away.
    assertCanDelegate(profile.permissions, role.permissions);

    const now = this.clock.now();
    await this.tx.run(async () => {
      if (role.name === SUPER_ADMIN_ROLE) await this.access.assertNotLastActiveSuperAdmin(userId);
      if (!(await this.userRoles.unassign(userId, roleId))) throw new NotFoundError('role_assignment');
      await this.audit.record({
        action: 'user.role_revoked',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { roleId, role: role.name },
      });
    });
    this.eventBus.publish(new UserRolesChangedEvent(userId, now));
  }
}

@CommandHandler(SyncPermissionCatalogCommand)
export class SyncPermissionCatalogHandler implements ICommandHandler<SyncPermissionCatalogCommand> {
  constructor(
    private readonly permissions: PermissionRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
  ) {}

  /** Idempotent; safe to run concurrently from several instances. */
  async execute(): Promise<void> {
    await this.tx.run(async () => {
      await this.tx.lock('access-control:catalog');
      await this.permissions.syncCatalog(PERMISSION_CATALOG);
      await this.permissions.ensureSystemRole(
        SUPER_ADMIN_ROLE,
        'Full administrative access. Holds every catalog permission explicitly.',
        PERMISSION_CATALOG.map((permission) => permission.key),
      );
    });
    this.access.invalidateAll();
  }
}
