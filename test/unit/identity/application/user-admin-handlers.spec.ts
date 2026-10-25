import type { EventBus } from '@nestjs/cqrs';
import { describe, expect, it, vi } from 'vitest';
import {
  BootstrapAdministratorCommand,
  DeactivateUserCommand,
  UpdateUserCommand,
} from '../../../../src/modules/identity/application/commands/user.commands.js';
import {
  BootstrapAdministratorHandler,
  DeactivateUserHandler,
  UpdateUserHandler,
} from '../../../../src/modules/identity/application/handlers/user-admin.handlers.js';
import { DomainError, ForbiddenError, NotFoundError } from '../../../../src/shared/domain/errors.js';
import {
  FixedClock,
  InlineTransactionManager,
  InMemorySessionRepository,
  InMemoryUserRepository,
  makeUser,
  PlainPasswordHasher,
  RecordingAuditTrail,
  StubAccessControl,
} from '../../../support/fakes.js';

const ADMIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JANE = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const actor = (userId: string) => ({ userId, sessionId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' });

function setup() {
  const users = new InMemoryUserRepository();
  const access = new StubAccessControl();
  const eventBus = { publish: vi.fn(), publishAll: vi.fn() } as unknown as EventBus;
  return {
    users,
    access,
    sessions: new InMemorySessionRepository(),
    tx: new InlineTransactionManager(),
    audit: new RecordingAuditTrail(),
    clock: new FixedClock(),
    eventBus,
  };
}

describe('UpdateUserHandler (resource-level authorization)', () => {
  it('lets users edit themselves but not others without users:update', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ id: JANE }));
    await ctx.users.insert(makeUser({ id: OTHER, email: 'other@example.com' }));
    const handler = new UpdateUserHandler(ctx.users, ctx.access, ctx.tx, ctx.audit, ctx.clock);

    await handler.execute(new UpdateUserCommand(actor(JANE), JANE, 'Jane Renamed'));
    expect((await ctx.users.findById(JANE))?.displayName).toBe('Jane Renamed');

    await expect(handler.execute(new UpdateUserCommand(actor(JANE), OTHER, 'Hijacked'))).rejects.toThrow(
      ForbiddenError,
    );
    expect((await ctx.users.findById(OTHER))?.displayName).toBe('Jane');

    ctx.access.grant(ADMIN, 'users:update');
    await handler.execute(new UpdateUserCommand(actor(ADMIN), OTHER, 'Fixed by admin'));
    expect(ctx.audit.entries.at(-1)).toMatchObject({ action: 'user.updated', actorUserId: ADMIN, resourceId: OTHER });
  });
});

describe('DeactivateUserHandler', () => {
  it('requires users:deactivate, forbids self-deactivation and revokes sessions', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ id: JANE }));
    const handler = new DeactivateUserHandler(
      ctx.users,
      ctx.sessions,
      ctx.access,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
    );
    const revokeAll = vi.spyOn(ctx.sessions, 'revokeAllForUser');
    const lastAdminCheck = vi.spyOn(ctx.access, 'assertNotLastActiveSuperAdmin');

    await expect(handler.execute(new DeactivateUserCommand(actor(ADMIN), JANE))).rejects.toThrow(ForbiddenError);
    ctx.access.grant(ADMIN, 'users:deactivate');
    await expect(handler.execute(new DeactivateUserCommand(actor(ADMIN), ADMIN))).rejects.toThrow(DomainError);
    await expect(handler.execute(new DeactivateUserCommand(actor(ADMIN), OTHER))).rejects.toThrow(NotFoundError);

    await handler.execute(new DeactivateUserCommand(actor(ADMIN), JANE));
    expect((await ctx.users.findById(JANE))?.isActive).toBe(false);
    expect(revokeAll).toHaveBeenCalledWith(JANE, 'user_deactivated', expect.any(Date));
    expect(lastAdminCheck).toHaveBeenCalledWith(JANE);
    expect(ctx.access.invalidated).toContain(JANE);
  });
});

describe('BootstrapAdministratorHandler', () => {
  it('is idempotent and serialized by a lock', async () => {
    const ctx = setup();
    const handler = new BootstrapAdministratorHandler(
      ctx.users,
      new PlainPasswordHasher(),
      ctx.access,
      ctx.tx,
      ctx.audit,
      ctx.clock,
    );

    const first = await handler.execute(
      new BootstrapAdministratorCommand('root@example.com', 'a long enough passphrase', 'Root'),
    );
    expect(first.created).toBe(true);
    expect(ctx.access.superAdmins.has(first.userId!)).toBe(true);
    expect(ctx.tx.locks).toContain('identity:bootstrap-administrator');

    const second = await handler.execute(
      new BootstrapAdministratorCommand('other@example.com', 'a long enough passphrase', 'Other'),
    );
    expect(second).toEqual({ created: false, userId: null });
    expect(ctx.users.rows.size).toBe(1);
  });

  it('promotes an existing account without replacing its password', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ id: JANE, verified: false, password: 'original password' }));
    const handler = new BootstrapAdministratorHandler(
      ctx.users,
      new PlainPasswordHasher(),
      ctx.access,
      ctx.tx,
      ctx.audit,
      ctx.clock,
    );
    const result = await handler.execute(
      new BootstrapAdministratorCommand('jane@example.com', 'ignored passphrase!', 'Jane'),
    );
    expect(result.userId).toBe(JANE);
    const user = await ctx.users.findById(JANE);
    expect(user?.passwordHash).toBe('hash:original password');
    expect(user?.isEmailVerified).toBe(true);
  });
});
