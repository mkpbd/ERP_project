import type { EventBus } from '@nestjs/cqrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AccessControlService,
  SUPER_ADMIN_LOCK,
} from '../../../src/modules/access-control/application/access-control.service.js';
import {
  AssignUserRoleCommand,
  CreateRoleCommand,
  RevokeUserRoleCommand,
} from '../../../src/modules/access-control/application/commands/access-control.commands.js';
import {
  AssignUserRoleHandler,
  RevokeUserRoleHandler,
} from '../../../src/modules/access-control/application/handlers/assignment.handlers.js';
import { CreateRoleHandler } from '../../../src/modules/access-control/application/handlers/role.handlers.js';
import { AccessReadRepository } from '../../../src/modules/access-control/application/read-models.js';
import { RoleRepository, UserRoleRepository } from '../../../src/modules/access-control/domain/repositories.js';
import { Role } from '../../../src/modules/access-control/domain/role.js';
import { UserDirectory, type UserSummary } from '../../../src/shared/application/contracts/user-directory.js';
import { DomainError, ForbiddenError } from '../../../src/shared/domain/errors.js';
import { FixedClock, InlineTransactionManager, RecordingAuditTrail } from '../../support/fakes.js';

const now = new Date('2026-01-01T00:00:00Z');
const actor = (userId: string) => ({ userId, sessionId: 'session' });

class FakeAccessRead extends AccessReadRepository {
  profiles = new Map<string, { roles: string[]; permissions: string[] }>();
  loads = 0;
  getProfile(userId: string) {
    this.loads++;
    const profile = this.profiles.get(userId) ?? { roles: [], permissions: [] };
    return Promise.resolve({ ...profile, roleIds: profile.roles });
  }
  listRoles = () => Promise.resolve([]);
  getRole = () => Promise.resolve(null);
  listPermissions = () => Promise.resolve([]);
  listUserRoles = () => Promise.resolve([]);
}

class FakeRoles extends RoleRepository {
  readonly rows = new Map<string, Role>();
  findById = (id: string) => Promise.resolve(this.rows.get(id) ?? null);
  findByIdForUpdate = (id: string) => this.findById(id);
  findByName = (name: string) => Promise.resolve([...this.rows.values()].find((role) => role.name === name) ?? null);
  insert = (role: Role) => {
    this.rows.set(role.id, role);
    return Promise.resolve();
  };
  update = () => Promise.resolve();
  delete = () => Promise.resolve();
  countAssignments = () => Promise.resolve(0);
}

class FakeUserRoles extends UserRoleRepository {
  readonly assignments = new Set<string>();
  constructor(private readonly roles: FakeRoles) {
    super();
  }
  assign = (userId: string, roleId: string) => {
    const key = `${userId}:${roleId}`;
    const created = !this.assignments.has(key);
    this.assignments.add(key);
    return Promise.resolve(created);
  };
  unassign = (userId: string, roleId: string) => Promise.resolve(this.assignments.delete(`${userId}:${roleId}`));
  userIdsWithRole = async (roleName: string) => {
    const role = await this.roles.findByName(roleName);
    return [...this.assignments].filter((key) => key.endsWith(`:${role?.id}`)).map((key) => key.split(':')[0]!);
  };
}

class FakeDirectory extends UserDirectory {
  readonly users = new Map<string, UserSummary>();
  findSummaries = (ids: readonly string[]) =>
    Promise.resolve(ids.flatMap((id) => (this.users.has(id) ? [this.users.get(id)!] : [])));
}

function setup(cacheTtl = 30) {
  const read = new FakeAccessRead();
  const roles = new FakeRoles();
  const userRoles = new FakeUserRoles(roles);
  const directory = new FakeDirectory();
  const tx = new InlineTransactionManager();
  const audit = new RecordingAuditTrail();
  const clock = new FixedClock(now);
  const service = new AccessControlService(read, roles, userRoles, directory, tx, clock, {
    profileCacheTtlSeconds: cacheTtl,
  });
  const eventBus = { publish: vi.fn(), publishAll: vi.fn() } as unknown as EventBus;
  const superAdmin = Role.restore({
    id: 'role-super',
    name: 'super-admin',
    description: '',
    isSystem: true,
    permissions: new Set(['users:read', 'permissions:assign', 'audit:read', 'roles:create']),
    createdAt: now,
    updatedAt: now,
  });
  roles.rows.set(superAdmin.id, superAdmin);
  const addUser = (id: string, active = true) =>
    directory.users.set(id, { id, email: `${id}@x.io`, displayName: id, isActive: active });
  return { read, roles, userRoles, directory, tx, audit, clock, service, eventBus, superAdmin, addUser };
}

describe('AccessControlService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.read.profiles.set('alice', { roles: ['auditor'], permissions: ['users:read'] });
  });

  it('allows owners and holders, denies everyone else', async () => {
    expect(await ctx.service.isAllowed('alice', { permissions: ['users:read'] })).toBe(true);
    expect(await ctx.service.isAllowed('bob', { permissions: ['users:read'] })).toBe(false);
    expect(await ctx.service.isAllowed('bob', { permissions: ['users:read'], ownerId: 'bob' })).toBe(true);
    await expect(ctx.service.authorize('bob', { permissions: ['users:read'] })).rejects.toThrow(ForbiddenError);
  });

  it('caches profiles and reloads after invalidation', async () => {
    await ctx.service.getProfile('alice');
    await ctx.service.getProfile('alice');
    expect(ctx.read.loads).toBe(1);

    ctx.read.profiles.set('alice', { roles: [], permissions: [] });
    ctx.service.invalidateUser('alice');
    expect(await ctx.service.isAllowed('alice', { permissions: ['users:read'] })).toBe(false);
    expect(ctx.read.loads).toBe(2);
  });

  it('bypasses the cache for requireFresh', async () => {
    await ctx.service.getProfile('alice');
    ctx.read.profiles.set('alice', { roles: [], permissions: [] });
    await expect(ctx.service.requireFresh('alice', ['users:read'])).rejects.toThrow(ForbiddenError);
  });

  it('protects the last active super-admin under a lock', async () => {
    ctx.addUser('root');
    ctx.addUser('backup', false);
    await ctx.userRoles.assign('root', 'role-super');
    await ctx.userRoles.assign('backup', 'role-super');

    await expect(ctx.service.assertNotLastActiveSuperAdmin('root')).rejects.toThrow(DomainError);
    expect(ctx.tx.locks).toContain(SUPER_ADMIN_LOCK);

    ctx.addUser('backup', true);
    await expect(ctx.service.assertNotLastActiveSuperAdmin('root')).resolves.toBeUndefined();
    await expect(ctx.service.assertNotLastActiveSuperAdmin('nobody')).resolves.toBeUndefined();
  });
});

describe('privilege escalation prevention', () => {
  it('rejects assigning a role that carries permissions the actor lacks', async () => {
    const ctx = setup();
    ctx.addUser('delegator');
    ctx.read.profiles.set('delegator', { roles: ['delegator'], permissions: ['permissions:assign'] });
    const handler = new AssignUserRoleHandler(
      ctx.roles,
      ctx.userRoles,
      ctx.directory,
      ctx.service,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
    );

    await expect(
      handler.execute(new AssignUserRoleCommand(actor('delegator'), 'delegator', 'role-super')),
    ).rejects.toMatchObject({
      code: 'privilege_escalation',
    });
    expect(ctx.userRoles.assignments.size).toBe(0);
  });

  it('allows assignment when the actor holds every permission of the role', async () => {
    const ctx = setup();
    ctx.addUser('root');
    ctx.addUser('jane');
    ctx.read.profiles.set('root', { roles: ['super-admin'], permissions: [...ctx.superAdmin.permissions] });
    const handler = new AssignUserRoleHandler(
      ctx.roles,
      ctx.userRoles,
      ctx.directory,
      ctx.service,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
    );
    await handler.execute(new AssignUserRoleCommand(actor('root'), 'jane', 'role-super'));
    expect(ctx.userRoles.assignments.has('jane:role-super')).toBe(true);
    expect(ctx.audit.actions()).toEqual(['user.role_assigned:success']);
  });

  it('refuses to strip the super-admin role from the last active holder', async () => {
    const ctx = setup();
    ctx.addUser('root');
    ctx.read.profiles.set('root', { roles: ['super-admin'], permissions: [...ctx.superAdmin.permissions] });
    await ctx.userRoles.assign('root', 'role-super');
    const handler = new RevokeUserRoleHandler(
      ctx.roles,
      ctx.userRoles,
      ctx.service,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
    );
    await expect(handler.execute(new RevokeUserRoleCommand(actor('root'), 'root', 'role-super'))).rejects.toMatchObject(
      {
        code: 'last_super_admin',
      },
    );
    expect(ctx.userRoles.assignments.has('root:role-super')).toBe(true);
  });

  it('rejects creating a role with permissions the creator lacks', async () => {
    const ctx = setup();
    ctx.read.profiles.set('mgr', { roles: [], permissions: ['roles:create', 'permissions:assign', 'users:read'] });
    const handler = new CreateRoleHandler(ctx.roles, ctx.service, ctx.tx, ctx.audit, ctx.clock);
    await expect(
      handler.execute(new CreateRoleCommand(actor('mgr'), 'sneaky', '', ['users:read', 'audit:read'])),
    ).rejects.toMatchObject({ code: 'privilege_escalation' });
    await expect(
      handler.execute(new CreateRoleCommand(actor('mgr'), 'readers', '', ['users:read'])),
    ).resolves.toMatchObject({
      id: expect.any(String),
    });
  });
});
