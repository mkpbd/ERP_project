import {
  AccessControl,
  type AccessRequirement,
  type AuthorizationProfile,
} from '../../src/shared/application/contracts/access-control.js';
import { AuditTrail, type AuditEntry } from '../../src/shared/application/ports/audit-trail.js';
import { Clock } from '../../src/shared/application/ports/clock.js';
import { NotificationQueue, type EmailNotification } from '../../src/shared/application/ports/notification-queue.js';
import { TransactionManager } from '../../src/shared/application/ports/transaction-manager.js';
import { ForbiddenError } from '../../src/shared/domain/errors.js';
import {
  AccessTokenService,
  OpaqueTokenGenerator,
  PasswordHasher,
  type AccessTokenClaims,
  type AuthSettings,
  type IssuedAccessToken,
  type OpaqueToken,
} from '../../src/modules/identity/application/ports.js';
import {
  RefreshTokenRepository,
  SessionRepository,
  UserRepository,
  type RefreshTokenConsumption,
} from '../../src/modules/identity/domain/repositories.js';
import { Session, type SessionRevocationReason } from '../../src/modules/identity/domain/session.js';
import { User } from '../../src/modules/identity/domain/user.js';
import { DisplayName, Email } from '../../src/modules/identity/domain/value-objects.js';

export class FixedClock extends Clock {
  constructor(public current = new Date('2026-01-01T00:00:00Z')) {
    super();
  }
  now(): Date {
    return new Date(this.current);
  }
  advance(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

/** Runs work inline; records lock names. Rollback is not simulated. */
export class InlineTransactionManager extends TransactionManager {
  readonly locks: string[] = [];
  run<T>(work: () => Promise<T>): Promise<T> {
    return work();
  }
  lock(resource: string): Promise<void> {
    this.locks.push(resource);
    return Promise.resolve();
  }
}

export class RecordingAuditTrail extends AuditTrail {
  readonly entries: AuditEntry[] = [];
  record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
    return Promise.resolve();
  }
  actions(): string[] {
    return this.entries.map((entry) => `${entry.action}:${entry.outcome ?? 'success'}`);
  }
}

export class RecordingNotificationQueue extends NotificationQueue {
  readonly emails: EmailNotification[] = [];
  enqueueEmail(notification: EmailNotification): Promise<void> {
    this.emails.push(notification);
    return Promise.resolve();
  }
}

/** Deterministic, fast stand-in for argon2: "hash:<plain>". */
export class PlainPasswordHasher extends PasswordHasher {
  simulatedVerifications = 0;
  hash(plain: string): Promise<string> {
    return Promise.resolve(`hash:${plain}`);
  }
  verify(hash: string, plain: string): Promise<boolean> {
    return Promise.resolve(hash === `hash:${plain}`);
  }
  needsRehash(): boolean {
    return false;
  }
  simulateVerify(): Promise<void> {
    this.simulatedVerifications++;
    return Promise.resolve();
  }
}

export class SequentialTokenGenerator extends OpaqueTokenGenerator {
  private counter = 0;
  generate(): OpaqueToken {
    const token = `opaque-token-${++this.counter}`;
    return { token, hash: this.hash(token) };
  }
  hash(token: string): string {
    return `h(${token})`;
  }
}

export class FakeAccessTokens extends AccessTokenService {
  issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    return Promise.resolve({
      token: `at.${claims.userId}.${claims.sessionId}`,
      expiresAt: new Date(Date.now() + 900_000),
    });
  }
  verify(token: string): Promise<AccessTokenClaims> {
    const [, userId = '', sessionId = ''] = token.split('.');
    return Promise.resolve({ userId, sessionId });
  }
}

export class InMemoryUserRepository extends UserRepository {
  readonly rows = new Map<string, User>();
  findById(id: string): Promise<User | null> {
    const user = this.rows.get(id);
    return Promise.resolve(user ? User.restore({ ...user.toSnapshot() }) : null);
  }
  findByIdForUpdate(id: string): Promise<User | null> {
    return this.findById(id);
  }
  findByEmail(email: string): Promise<User | null> {
    const user = [...this.rows.values()].find((candidate) => candidate.email === email);
    return user ? this.findById(user.id) : Promise.resolve(null);
  }
  findByUsername(username: string): Promise<User | null> {
    const user = [...this.rows.values()].find((candidate) => candidate.username === username);
    return user ? this.findById(user.id) : Promise.resolve(null);
  }
  insert(user: User): Promise<void> {
    this.rows.set(user.id, User.restore({ ...user.toSnapshot() }));
    return Promise.resolve();
  }
  update(user: User): Promise<void> {
    this.rows.set(user.id, User.restore({ ...user.toSnapshot(), version: user.version + 1 }));
    user.markPersisted();
    return Promise.resolve();
  }
}

export class InMemorySessionRepository extends SessionRepository {
  readonly rows = new Map<string, Session>();
  insert(session: Session): Promise<void> {
    this.rows.set(session.id, session);
    return Promise.resolve();
  }
  findById(id: string): Promise<Session | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }
  revoke(id: string, reason: SessionRevocationReason, now: Date): Promise<boolean> {
    const session = this.rows.get(id);
    if (!session || session.toSnapshot().revokedAt) return Promise.resolve(false);
    this.rows.set(id, Session.restore({ ...session.toSnapshot(), revokedAt: now, revokedReason: reason }));
    return Promise.resolve(true);
  }
  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    let count = 0;
    for (const session of [...this.rows.values()]) {
      if (
        session.userId === userId &&
        session.id !== options.exceptSessionId &&
        (await this.revoke(session.id, reason, now))
      ) {
        count++;
      }
    }
    return count;
  }
  extend(id: string, now: Date, expiresAt: Date): Promise<void> {
    const session = this.rows.get(id);
    if (session) this.rows.set(id, Session.restore({ ...session.toSnapshot(), lastUsedAt: now, expiresAt }));
    return Promise.resolve();
  }
}

export class InMemoryRefreshTokenRepository extends RefreshTokenRepository {
  readonly rows = new Map<
    string,
    { id: string; sessionId: string; expiresAt: Date; usedAt: Date | null; replacedById: string | null }
  >();
  insert(token: { id: string; sessionId: string; tokenHash: string; expiresAt: Date }): Promise<void> {
    this.rows.set(token.tokenHash, { ...token, usedAt: null, replacedById: null });
    return Promise.resolve();
  }
  consume(tokenHash: string, now: Date): Promise<RefreshTokenConsumption> {
    const row = this.rows.get(tokenHash);
    if (!row) return Promise.resolve({ status: 'unknown' });
    if (row.usedAt) return Promise.resolve({ status: 'reused', sessionId: row.sessionId });
    row.usedAt = now;
    return Promise.resolve({ status: 'consumed', tokenId: row.id, sessionId: row.sessionId, expiresAt: row.expiresAt });
  }
  linkReplacement(tokenId: string, replacedById: string): Promise<void> {
    for (const row of this.rows.values()) if (row.id === tokenId) row.replacedById = replacedById;
    return Promise.resolve();
  }
}

/** Permission table per user; ownerId is honoured like the real service. */
export class StubAccessControl extends AccessControl {
  readonly grants = new Map<string, Set<string>>();
  superAdmins = new Set<string>();
  invalidated: string[] = [];

  grant(userId: string, ...permissions: string[]): void {
    this.grants.set(userId, new Set([...(this.grants.get(userId) ?? []), ...permissions]));
  }
  getProfile(userId: string): Promise<AuthorizationProfile> {
    return Promise.resolve({ roles: [], roleIds: [], permissions: this.grants.get(userId) ?? new Set() });
  }
  async isAllowed(userId: string, requirement: AccessRequirement): Promise<boolean> {
    if (requirement.ownerId === userId) return true;
    const granted = (await this.getProfile(userId)).permissions;
    return (requirement.permissions ?? []).every((permission) => granted.has(permission));
  }
  async authorize(userId: string, requirement: AccessRequirement): Promise<void> {
    if (!(await this.isAllowed(userId, requirement))) throw new ForbiddenError();
  }
  assertNotLastActiveSuperAdmin(): Promise<void> {
    return Promise.resolve();
  }
  grantSuperAdmin(userId: string): Promise<void> {
    this.superAdmins.add(userId);
    return Promise.resolve();
  }
  hasActiveSuperAdmin(): Promise<boolean> {
    return Promise.resolve(this.superAdmins.size > 0);
  }
  roleExists(): Promise<boolean> {
    return Promise.resolve(true);
  }
  usersWithRoles(): Promise<string[]> {
    return Promise.resolve([]);
  }
  usersWithPermission(permission: string): Promise<string[]> {
    return Promise.resolve([...this.grants].filter(([, granted]) => granted.has(permission)).map(([id]) => id));
  }
  invalidateUser(userId: string): void {
    this.invalidated.push(userId);
  }
}

export const AUTH_SETTINGS_FOR_TESTS: AuthSettings = {
  registrationEnabled: true,
  emailVerificationRequired: true,
  lockout: { maxFailedAttempts: 3, lockoutSeconds: 600 },
  refreshTokenTtlSeconds: 3600,
  passwordResetTokenTtlSeconds: 1800,
  emailVerificationTokenTtlSeconds: 86_400,
  appPublicUrl: 'https://app.example.com',
};

export function makeUser(
  overrides: Partial<{ id: string; email: string; password: string; verified: boolean; now: Date }> = {},
): User {
  return User.register({
    id: overrides.id ?? '11111111-1111-4111-8111-111111111111',
    email: Email.create(overrides.email ?? 'jane@example.com'),
    username: null,
    displayName: DisplayName.create('Jane'),
    passwordHash: `hash:${overrides.password ?? 'correct horse battery'}`,
    emailVerified: overrides.verified ?? true,
    now: overrides.now ?? new Date('2026-01-01T00:00:00Z'),
  });
}
