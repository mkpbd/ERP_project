import type { EventBus } from '@nestjs/cqrs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ChangePasswordCommand,
  LoginCommand,
  RefreshTokensCommand,
  RegisterUserCommand,
} from '../../../../src/modules/identity/application/commands/auth.commands.js';
import { LoginHandler } from '../../../../src/modules/identity/application/handlers/login.handler.js';
import { ChangePasswordHandler } from '../../../../src/modules/identity/application/handlers/password.handlers.js';
import { RefreshTokensHandler } from '../../../../src/modules/identity/application/handlers/refresh-tokens.handler.js';
import { RegisterUserHandler } from '../../../../src/modules/identity/application/handlers/registration.handlers.js';
import { EmailVerificationService } from '../../../../src/modules/identity/application/services/email-verification.service.js';
import { SessionTokenService } from '../../../../src/modules/identity/application/services/session-token.service.js';
import { RefreshTokenReuseDetectedEvent, UserLockedOutEvent } from '../../../../src/modules/identity/domain/events.js';
import {
  type AppError,
  AuthenticationError,
  ConflictError,
  ForbiddenError,
} from '../../../../src/shared/domain/errors.js';
import {
  AUTH_SETTINGS_FOR_TESTS,
  FakeAccessTokens,
  FixedClock,
  InlineTransactionManager,
  InMemoryRefreshTokenRepository,
  InMemorySessionRepository,
  InMemoryUserRepository,
  makeUser,
  PlainPasswordHasher,
  RecordingAuditTrail,
  RecordingNotificationQueue,
  SequentialTokenGenerator,
} from '../../../support/fakes.js';

const client = { userAgent: 'vitest', ipAddress: '127.0.0.1' };
const PASSWORD = 'correct horse battery';

function setup(settings = AUTH_SETTINGS_FOR_TESTS) {
  const users = new InMemoryUserRepository();
  const sessions = new InMemorySessionRepository();
  const refreshTokens = new InMemoryRefreshTokenRepository();
  const opaque = new SequentialTokenGenerator();
  const hasher = new PlainPasswordHasher();
  const audit = new RecordingAuditTrail();
  const notifications = new RecordingNotificationQueue();
  const tx = new InlineTransactionManager();
  const clock = new FixedClock();
  const eventBus = { publish: vi.fn(), publishAll: vi.fn() } as unknown as EventBus & {
    publish: ReturnType<typeof vi.fn>;
    publishAll: ReturnType<typeof vi.fn>;
  };
  const sessionTokens = new SessionTokenService(sessions, refreshTokens, opaque, new FakeAccessTokens(), settings);
  const oneTimeTokens = {
    insert: vi.fn(),
    consume: vi.fn(),
    peek: vi.fn(),
    invalidateAllForUser: vi.fn(),
  };
  return {
    users,
    sessions,
    refreshTokens,
    hasher,
    audit,
    notifications,
    tx,
    clock,
    eventBus,
    opaque,
    sessionTokens,
    oneTimeTokens,
    login: new LoginHandler(users, hasher, sessionTokens, tx, audit, clock, eventBus, settings),
    refresh: new RefreshTokensHandler(
      users,
      sessions,
      refreshTokens,
      opaque,
      sessionTokens,
      tx,
      audit,
      clock,
      eventBus,
      settings,
    ),
  };
}

describe('LoginHandler', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await ctx.users.insert(makeUser({ email: 'jane@example.com', password: PASSWORD }));
  });

  it('issues an access token, a refresh token and a session', async () => {
    const tokens = await ctx.login.execute(new LoginCommand('JANE@example.com', PASSWORD, client));
    expect(tokens.accessToken).toContain(tokens.sessionId);
    expect(tokens.refreshToken).toBe('opaque-token-1');
    expect(ctx.sessions.rows.get(tokens.sessionId)?.isActive(ctx.clock.now())).toBe(true);
    expect(ctx.audit.actions()).toContain('auth.login:success');
  });

  it('answers unknown accounts and wrong passwords identically, spending hash time on both', async () => {
    const unknown = await ctx.login
      .execute(new LoginCommand('nobody@example.com', PASSWORD, client))
      .catch((e: unknown) => e);
    const wrong = await ctx.login
      .execute(new LoginCommand('jane@example.com', 'wrong password!!', client))
      .catch((e: unknown) => e);
    expect(unknown).toBeInstanceOf(AuthenticationError);
    expect(wrong).toBeInstanceOf(AuthenticationError);
    expect((unknown as AppError).code).toBe((wrong as AppError).code);
    expect((unknown as AppError).message).toBe((wrong as AppError).message);
    expect(ctx.hasher.simulatedVerifications).toBe(1);
  });

  it('locks the account after repeated failures and then rejects even the right password', async () => {
    for (let i = 0; i < 3; i++) {
      await expect(ctx.login.execute(new LoginCommand('jane@example.com', 'wrong password!!', client))).rejects.toThrow(
        AuthenticationError,
      );
    }
    expect(ctx.eventBus.publishAll).toHaveBeenLastCalledWith([expect.any(UserLockedOutEvent)]);
    await expect(ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client))).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
    ctx.clock.advance(601);
    await expect(ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client))).resolves.toBeDefined();
  });

  it('requires a verified email when configured', async () => {
    await ctx.users.insert(
      makeUser({
        id: '22222222-2222-4222-8222-222222222222',
        email: 'new@example.com',
        password: PASSWORD,
        verified: false,
      }),
    );
    await expect(ctx.login.execute(new LoginCommand('new@example.com', PASSWORD, client))).rejects.toMatchObject({
      code: 'email_not_verified',
    });
  });

  it('treats malformed identifiers as unknown accounts', async () => {
    await expect(ctx.login.execute(new LoginCommand('??', PASSWORD, client))).rejects.toMatchObject({
      code: 'invalid_credentials',
    });
  });
});

describe('RefreshTokensHandler', () => {
  it('rotates the refresh token and rejects the old one afterwards as reuse, revoking the session', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ password: PASSWORD }));
    const first = await ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client));

    const second = await ctx.refresh.execute(new RefreshTokensCommand(first.refreshToken, client));
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect(second.sessionId).toBe(first.sessionId);

    await expect(ctx.refresh.execute(new RefreshTokensCommand(first.refreshToken, client))).rejects.toMatchObject({
      code: 'invalid_refresh_token',
    });
    expect(ctx.sessions.rows.get(first.sessionId)?.isActive(ctx.clock.now())).toBe(false);
    expect(ctx.eventBus.publish).toHaveBeenCalledWith(expect.any(RefreshTokenReuseDetectedEvent));
    expect(ctx.audit.actions()).toContain('auth.refresh_token_reuse:denied');

    // The legitimately rotated token dies with the family.
    await expect(ctx.refresh.execute(new RefreshTokensCommand(second.refreshToken, client))).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('rejects unknown and expired tokens', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ password: PASSWORD }));
    await expect(ctx.refresh.execute(new RefreshTokensCommand('never-issued', client))).rejects.toThrow(
      AuthenticationError,
    );

    const tokens = await ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client));
    ctx.clock.advance(AUTH_SETTINGS_FOR_TESTS.refreshTokenTtlSeconds + 1);
    await expect(ctx.refresh.execute(new RefreshTokensCommand(tokens.refreshToken, client))).rejects.toThrow(
      AuthenticationError,
    );
  });

  it('refuses refresh for a deactivated account and revokes its session', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ password: PASSWORD }));
    const tokens = await ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client));
    const user = (await ctx.users.findById('11111111-1111-4111-8111-111111111111'))!;
    user.deactivate(ctx.clock.now());
    await ctx.users.update(user);

    await expect(ctx.refresh.execute(new RefreshTokensCommand(tokens.refreshToken, client))).rejects.toThrow(
      AuthenticationError,
    );
    expect(ctx.sessions.rows.get(tokens.sessionId)?.toSnapshot().revokedReason).toBe('account_inactive');
  });
});

describe('ChangePasswordHandler', () => {
  it('verifies the current password and revokes all other sessions', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ password: PASSWORD }));
    const current = await ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client));
    const other = await ctx.login.execute(new LoginCommand('jane@example.com', PASSWORD, client));
    const handler = new ChangePasswordHandler(
      ctx.users,
      ctx.sessions,
      ctx.oneTimeTokens,
      ctx.hasher,
      ctx.notifications,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
    );
    const actor = { userId: '11111111-1111-4111-8111-111111111111', sessionId: current.sessionId };

    await expect(
      handler.execute(new ChangePasswordCommand(actor, 'not my password', 'a brand new passphrase')),
    ).rejects.toMatchObject({
      code: 'invalid_current_password',
    });

    await handler.execute(new ChangePasswordCommand(actor, PASSWORD, 'a brand new passphrase'));
    expect(ctx.sessions.rows.get(current.sessionId)?.isActive(ctx.clock.now())).toBe(true);
    expect(ctx.sessions.rows.get(other.sessionId)?.isActive(ctx.clock.now())).toBe(false);
    expect(ctx.notifications.emails.at(-1)?.content.template).toBe('password-changed');
    expect(ctx.oneTimeTokens.invalidateAllForUser).toHaveBeenCalled();
  });
});

describe('RegisterUserHandler', () => {
  function registerHandler(ctx: ReturnType<typeof setup>, settings = AUTH_SETTINGS_FOR_TESTS) {
    const verification = new EmailVerificationService(ctx.oneTimeTokens, ctx.opaque, ctx.notifications, settings);
    return new RegisterUserHandler(
      ctx.users,
      ctx.hasher,
      verification,
      ctx.notifications,
      ctx.tx,
      ctx.audit,
      ctx.clock,
      ctx.eventBus,
      settings,
    );
  }

  it('creates an unverified user and emails a verification link carrying the token in the fragment', async () => {
    const ctx = setup();
    await registerHandler(ctx).execute(
      new RegisterUserCommand('New@Example.com', 'a long enough passphrase', 'New', null),
    );
    const user = await ctx.users.findByEmail('new@example.com');
    expect(user?.isEmailVerified).toBe(false);
    const email = ctx.notifications.emails[0]!;
    expect(email.content).toMatchObject({ template: 'email-verification' });
    expect(email.content.template === 'email-verification' && email.content.verificationUrl).toMatch(
      /\/verify-email#token=/,
    );
  });

  it('does not reveal existing emails: completes normally and notifies the owner instead', async () => {
    const ctx = setup();
    await ctx.users.insert(makeUser({ email: 'jane@example.com' }));
    await expect(
      registerHandler(ctx).execute(
        new RegisterUserCommand('jane@example.com', 'a long enough passphrase', 'Imposter', null),
      ),
    ).resolves.toBeUndefined();
    expect(ctx.users.rows.size).toBe(1);
    expect(ctx.notifications.emails[0]?.content.template).toBe('account-exists');
  });

  it('reports taken usernames and honours the registration switch', async () => {
    const ctx = setup();
    await registerHandler(ctx).execute(
      new RegisterUserCommand('a@example.com', 'a long enough passphrase', 'A', 'taken'),
    );
    await expect(
      registerHandler(ctx).execute(new RegisterUserCommand('b@example.com', 'a long enough passphrase', 'B', 'TAKEN')),
    ).rejects.toThrow(ConflictError);

    const closed = registerHandler(ctx, { ...AUTH_SETTINGS_FOR_TESTS, registrationEnabled: false });
    await expect(
      closed.execute(new RegisterUserCommand('c@example.com', 'a long enough passphrase', 'C', null)),
    ).rejects.toThrow(ForbiddenError);
  });
});
