import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { NotificationQueue } from '../../../../shared/application/ports/notification-queue.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { AppError, AuthenticationError, DomainError } from '../../../../shared/domain/errors.js';
import { assertAcceptablePassword } from '../../domain/password-policy.js';
import { PasswordResetTokenRepository, SessionRepository, UserRepository } from '../../domain/repositories.js';
import { Email } from '../../domain/value-objects.js';
import { ChangePasswordCommand, RequestPasswordResetCommand, ResetPasswordCommand } from '../commands/auth.commands.js';
import { AUTH_SETTINGS, OpaqueTokenGenerator, PasswordHasher, type AuthSettings } from '../ports.js';

export const invalidTokenError = (): AppError =>
  new AppError('validation', 'invalid_token', 'The token is invalid or has expired');

@CommandHandler(ChangePasswordCommand)
export class ChangePasswordHandler implements ICommandHandler<ChangePasswordCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly resetTokens: PasswordResetTokenRepository,
    private readonly hasher: PasswordHasher,
    private readonly notifications: NotificationQueue,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, currentPassword, newPassword }: ChangePasswordCommand): Promise<void> {
    const user = await this.users.findById(actor.userId);
    if (!user) throw new AuthenticationError();

    if (!(await this.hasher.verify(user.passwordHash, currentPassword))) {
      await this.audit.record({
        action: 'auth.password_change',
        actorUserId: user.id,
        resourceType: 'user',
        resourceId: user.id,
        outcome: 'failure',
        metadata: { reason: 'invalid_current_password' },
      });
      throw new DomainError('invalid_current_password', 'Current password is incorrect');
    }
    if (currentPassword === newPassword) {
      throw new DomainError('password_unchanged', 'New password must differ from the current password');
    }
    assertAcceptablePassword(newPassword, { email: user.email, username: user.username });
    const passwordHash = await this.hasher.hash(newPassword);
    const now = this.clock.now();

    const events = await this.tx.run(async () => {
      const locked = await this.users.findByIdForUpdate(user.id);
      if (!locked) throw new AuthenticationError();
      locked.changePassword(passwordHash, now);
      await this.users.update(locked);
      // Every other device must sign in again with the new password.
      const revoked = await this.sessions.revokeAllForUser(locked.id, 'password_changed', now, {
        exceptSessionId: actor.sessionId,
      });
      await this.resetTokens.invalidateAllForUser(locked.id, now);
      await this.notifications.enqueueEmail({
        to: locked.email,
        content: { template: 'password-changed', displayName: locked.displayName },
      });
      await this.audit.record({
        action: 'auth.password_change',
        actorUserId: locked.id,
        resourceType: 'user',
        resourceId: locked.id,
        metadata: { sessionsRevoked: revoked },
      });
      return locked.pullDomainEvents();
    });
    this.eventBus.publishAll(events);
  }
}

@CommandHandler(RequestPasswordResetCommand)
export class RequestPasswordResetHandler implements ICommandHandler<RequestPasswordResetCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly resetTokens: PasswordResetTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly notifications: NotificationQueue,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  /** Always completes silently so callers cannot learn which emails have accounts. */
  async execute({ email }: RequestPasswordResetCommand): Promise<void> {
    let normalized: string;
    try {
      normalized = Email.create(email).value;
    } catch {
      return;
    }
    const user = await this.users.findByEmail(normalized);
    if (!user?.isActive) return;

    const now = this.clock.now();
    const generated = this.opaqueTokens.generate();
    await this.tx.run(async () => {
      await this.resetTokens.invalidateAllForUser(user.id, now);
      await this.resetTokens.insert({
        id: randomUUID(),
        userId: user.id,
        tokenHash: generated.hash,
        expiresAt: new Date(now.getTime() + this.settings.passwordResetTokenTtlSeconds * 1000),
        now,
      });
      await this.notifications.enqueueEmail({
        to: user.email,
        content: {
          template: 'password-reset',
          displayName: user.displayName,
          resetUrl: `${this.settings.appPublicUrl}/reset-password#token=${generated.token}`,
        },
      });
      await this.audit.record({
        action: 'auth.password_reset_requested',
        actorUserId: null,
        resourceType: 'user',
        resourceId: user.id,
      });
    });
  }
}

@CommandHandler(ResetPasswordCommand)
export class ResetPasswordHandler implements ICommandHandler<ResetPasswordCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly resetTokens: PasswordResetTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly hasher: PasswordHasher,
    private readonly notifications: NotificationQueue,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ token, newPassword }: ResetPasswordCommand): Promise<void> {
    const now = this.clock.now();
    const tokenHash = this.opaqueTokens.hash(token);

    // Validate and hash before opening the transaction; argon2 is deliberately slow.
    const userId = await this.resetTokens.peek(tokenHash, now);
    const user = userId ? await this.users.findById(userId) : null;
    if (!user?.isActive) throw invalidTokenError();
    assertAcceptablePassword(newPassword, { email: user.email, username: user.username });
    const passwordHash = await this.hasher.hash(newPassword);

    const events = await this.tx.run(async () => {
      // consume() is the atomic single-use check; a concurrent reset loses here.
      if ((await this.resetTokens.consume(tokenHash, now)) !== user.id) throw invalidTokenError();
      const locked = await this.users.findByIdForUpdate(user.id);
      if (!locked?.isActive) throw invalidTokenError();
      locked.changePassword(passwordHash, now);
      // Receiving the reset email proves control of the address.
      locked.verifyEmail(now);
      await this.users.update(locked);
      await this.resetTokens.invalidateAllForUser(locked.id, now);
      const revoked = await this.sessions.revokeAllForUser(locked.id, 'password_reset', now);
      await this.notifications.enqueueEmail({
        to: locked.email,
        content: { template: 'password-changed', displayName: locked.displayName },
      });
      await this.audit.record({
        action: 'auth.password_reset',
        actorUserId: locked.id,
        resourceType: 'user',
        resourceId: locked.id,
        metadata: { sessionsRevoked: revoked },
      });
      return locked.pullDomainEvents();
    });
    this.eventBus.publishAll(events);
  }
}
