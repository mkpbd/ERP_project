import { Inject } from '@nestjs/common';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { AuthenticationError } from '../../../../shared/domain/errors.js';
import { UserRepository } from '../../domain/repositories.js';
import type { User } from '../../domain/user.js';
import { Email, Username } from '../../domain/value-objects.js';
import { LoginCommand, type AuthTokens } from '../commands/auth.commands.js';
import { AUTH_SETTINGS, PasswordHasher, type AuthSettings } from '../ports.js';
import { SessionTokenService } from '../services/session-token.service.js';

@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessionTokens: SessionTokenService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  async execute(command: LoginCommand): Promise<AuthTokens> {
    const now = this.clock.now();
    const user = await this.findByIdentifier(command.identifier);

    // Unknown and locked accounts get the same response and timing as a wrong password.
    if (!user || user.isLocked(now)) {
      await this.hasher.simulateVerify(command.password);
      await this.recordFailure(user, user ? 'locked' : 'unknown_account');
      throw new AuthenticationError();
    }

    if (!(await this.hasher.verify(user.passwordHash, command.password))) {
      await this.registerWrongPassword(user.id, now);
      throw new AuthenticationError();
    }

    // The password was correct, so revealing the account state no longer aids enumeration.
    const block = user.signInBlock(this.settings.emailVerificationRequired, now);
    if (block === 'deactivated') {
      await this.recordFailure(user, 'deactivated');
      throw new AuthenticationError('account_disabled', 'This account has been deactivated');
    }
    if (block === 'expired') {
      await this.recordFailure(user, 'expired');
      throw new AuthenticationError('account_expired', 'This account has expired');
    }
    if (block === 'email_not_verified') {
      await this.recordFailure(user, 'email_not_verified');
      throw new AuthenticationError('email_not_verified', 'Verify your email address before signing in');
    }
    // Extension point: no second factor is implemented yet, so accounts flagged for MFA cannot sign in.
    if (user.mfaEnabled) {
      throw new AuthenticationError('mfa_required', 'Multi-factor authentication is required');
    }

    const upgradedHash = this.hasher.needsRehash(user.passwordHash) ? await this.hasher.hash(command.password) : null;

    const opened = await this.tx.run(async () => {
      const current = await this.users.findByIdForUpdate(user.id);
      // Re-check under the row lock: the account may have changed since the password check.
      if (!current || current.isLocked(now) || current.signInBlock(this.settings.emailVerificationRequired, now)) {
        throw new AuthenticationError();
      }
      current.recordSuccessfulSignIn(now);
      if (upgradedHash) current.upgradePasswordHash(upgradedHash, now);
      await this.users.update(current);
      const session = await this.sessionTokens.openSession(current.id, command.client, now);
      await this.audit.record({
        action: 'auth.login',
        actorUserId: current.id,
        resourceType: 'session',
        resourceId: session.sessionId,
      });
      return session;
    });

    const access = await this.sessionTokens.issueAccessToken(user.id, opened.sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: opened.refresh.token,
      refreshTokenExpiresAt: opened.refresh.expiresAt,
      sessionId: opened.sessionId,
    };
  }

  private findByIdentifier(identifier: string): Promise<User | null> {
    try {
      return Username.looksLikeEmail(identifier)
        ? this.users.findByEmail(Email.create(identifier).value)
        : this.users.findByUsername(Username.create(identifier).value);
    } catch {
      // A malformed identifier cannot match an account.
      return Promise.resolve(null);
    }
  }

  private async registerWrongPassword(userId: string, now: Date): Promise<void> {
    const events = await this.tx.run(async () => {
      const locked = await this.users.findByIdForUpdate(userId);
      if (!locked) return [];
      locked.recordFailedSignIn(now, this.settings.lockout);
      await this.users.update(locked);
      await this.audit.record({
        action: 'auth.login',
        actorUserId: locked.id,
        resourceType: 'user',
        resourceId: locked.id,
        outcome: 'failure',
        metadata: { reason: 'invalid_password', locked: locked.isLocked(now) },
      });
      return locked.pullDomainEvents();
    });
    this.eventBus.publishAll(events);
  }

  private recordFailure(user: User | null, reason: string): Promise<void> {
    return this.audit.record({
      action: 'auth.login',
      actorUserId: user?.id ?? null,
      resourceType: 'user',
      resourceId: user?.id ?? null,
      outcome: 'failure',
      metadata: { reason },
    });
  }
}
