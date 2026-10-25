import { randomUUID } from 'node:crypto';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { ConflictError, NotFoundError } from '../../../../shared/domain/errors.js';
import { RolePermissionsChangedEvent } from '../../domain/events.js';
import { assertCanDelegate } from '../../domain/policy.js';
import { RoleRepository } from '../../domain/repositories.js';
import { Role } from '../../domain/role.js';
import { AccessControlService } from '../access-control.service.js';
import {
  CreateRoleCommand,
  DeleteRoleCommand,
  GrantRolePermissionsCommand,
  RevokeRolePermissionCommand,
  UpdateRoleCommand,
} from '../commands/access-control.commands.js';

@CommandHandler(CreateRoleCommand)
export class CreateRoleHandler implements ICommandHandler<CreateRoleCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, name, description, permissions }: CreateRoleCommand): Promise<{ id: string }> {
    const required = permissions.length > 0 ? ['roles:create', 'permissions:assign'] : ['roles:create'];
    const profile = await this.access.requireFresh(actor.userId, required);
    assertCanDelegate(profile.permissions, permissions);
    const role = Role.create({ id: randomUUID(), name, description, permissions, now: this.clock.now() });
    await this.tx.run(async () => {
      await this.roles.insert(role, actor.userId);
      await this.audit.record({
        action: 'role.created',
        actorUserId: actor.userId,
        resourceType: 'role',
        resourceId: role.id,
        metadata: { name: role.name, permissions: [...role.permissions].sort() },
      });
    });
    return { id: role.id };
  }
}

@CommandHandler(UpdateRoleCommand)
export class UpdateRoleHandler implements ICommandHandler<UpdateRoleCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, roleId, changes }: UpdateRoleCommand): Promise<void> {
    await this.access.requireFresh(actor.userId, ['roles:update']);
    await this.tx.run(async () => {
      const role = await this.roles.findByIdForUpdate(roleId);
      if (!role) throw new NotFoundError('role');
      role.update(changes, this.clock.now());
      await this.roles.update(role, actor.userId);
      await this.audit.record({
        action: 'role.updated',
        actorUserId: actor.userId,
        resourceType: 'role',
        resourceId: roleId,
        metadata: { fields: Object.keys(changes) },
      });
    });
    // Role names appear in cached profiles.
    this.access.invalidateAll();
  }
}

@CommandHandler(DeleteRoleCommand)
export class DeleteRoleHandler implements ICommandHandler<DeleteRoleCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, roleId }: DeleteRoleCommand): Promise<void> {
    const profile = await this.access.requireFresh(actor.userId, ['roles:delete']);
    await this.tx.run(async () => {
      const role = await this.roles.findByIdForUpdate(roleId);
      if (!role) throw new NotFoundError('role');
      role.assertDeletable();
      assertCanDelegate(profile.permissions, role.permissions);
      if ((await this.roles.countAssignments(roleId)) > 0) {
        throw new ConflictError('role_in_use', 'Unassign this role from all users before deleting it');
      }
      await this.roles.delete(roleId);
      await this.audit.record({
        action: 'role.deleted',
        actorUserId: actor.userId,
        resourceType: 'role',
        resourceId: roleId,
        metadata: { name: role.name },
      });
    });
    this.eventBus.publish(new RolePermissionsChangedEvent(roleId, this.clock.now()));
  }
}

@CommandHandler(GrantRolePermissionsCommand)
export class GrantRolePermissionsHandler implements ICommandHandler<GrantRolePermissionsCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, roleId, permissions }: GrantRolePermissionsCommand): Promise<{ granted: string[] }> {
    const profile = await this.access.requireFresh(actor.userId, ['permissions:assign']);
    assertCanDelegate(profile.permissions, permissions);
    const { granted, events } = await this.tx.run(async () => {
      const role = await this.roles.findByIdForUpdate(roleId);
      if (!role) throw new NotFoundError('role');
      const added = role.grant(permissions, this.clock.now());
      if (added.length > 0) {
        await this.roles.update(role, actor.userId);
        await this.audit.record({
          action: 'role.permissions_granted',
          actorUserId: actor.userId,
          resourceType: 'role',
          resourceId: roleId,
          metadata: { permissions: added },
        });
      }
      return { granted: added, events: role.pullDomainEvents() };
    });
    this.eventBus.publishAll(events);
    return { granted };
  }
}

@CommandHandler(RevokeRolePermissionCommand)
export class RevokeRolePermissionHandler implements ICommandHandler<RevokeRolePermissionCommand> {
  constructor(
    private readonly roles: RoleRepository,
    private readonly access: AccessControlService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, roleId, permission }: RevokeRolePermissionCommand): Promise<void> {
    const profile = await this.access.requireFresh(actor.userId, ['permissions:assign']);
    assertCanDelegate(profile.permissions, [permission]);
    const events = await this.tx.run(async () => {
      const role = await this.roles.findByIdForUpdate(roleId);
      if (!role) throw new NotFoundError('role');
      if (!role.revoke(permission, this.clock.now())) throw new NotFoundError('role_permission');
      await this.roles.update(role, actor.userId);
      await this.audit.record({
        action: 'role.permission_revoked',
        actorUserId: actor.userId,
        resourceType: 'role',
        resourceId: roleId,
        metadata: { permission },
      });
      return role.pullDomainEvents();
    });
    this.eventBus.publishAll(events);
  }
}
