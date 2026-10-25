import { randomUUID } from 'node:crypto';
import { Inject } from '@nestjs/common';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { NotificationQueue } from '../../../../shared/application/ports/notification-queue.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { ConflictError, ForbiddenError } from '../../../../shared/domain/errors.js';
import { assertAcceptablePassword } from '../../domain/password-policy.js';
import { EmailVerificationTokenRepository, UserRepository } from '../../domain/repositories.js';
import { User } from '../../domain/user.js';
import { DisplayName, Email, Username } from '../../domain/value-objects.js';
import { RegisterUserCommand, ResendEmailVerificationCommand, VerifyEmailCommand } from '../commands/auth.commands.js';
import { AUTH_SETTINGS, OpaqueTokenGenerator, PasswordHasher, type AuthSettings } from '../ports.js';
import { EmailVerificationService } from '../services/email-verification.service.js';
import { invalidTokenError } from './password.handlers.js';

@CommandHandler(RegisterUserCommand)
export class RegisterUserHandler implements ICommandHandler<RegisterUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly verification: EmailVerificationService,
    private readonly notifications: NotificationQueue,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  /**
   * Completes the same way whether or not the email is already registered;
   * the owner of an existing account is notified by email instead.
   */
  async execute(command: RegisterUserCommand): Promise<void> {
    if (!this.settings.registrationEnabled) {
      throw new ForbiddenError('registration_disabled', 'Self-registration is disabled');
    }
    const email = Email.create(command.email);
    const username = command.username ? Username.create(command.username) : null;
    const displayName = DisplayName.create(command.displayName);
    assertAcceptablePassword(command.password, { email: email.value, username: username?.value ?? null });

    // Hash first so both outcomes below cost the same time.
    const passwordHash = await this.hasher.hash(command.password);

    if (username && (await this.users.findByUsername(username.value))) {
      throw new ConflictError('username_taken', 'Username is already taken');
    }
    if (await this.users.findByEmail(email.value)) {
      await this.notifyExistingAccount(email.value);
      return;
    }

    const now = this.clock.now();
    const user = User.register({
      id: randomUUID(),
      email,
      username,
      displayName,
      passwordHash,
      emailVerified: !this.settings.emailVerificationRequired,
      now,
    });
    try {
      await this.tx.run(async () => {
        await this.users.insert(user);
        if (this.settings.emailVerificationRequired) await this.verification.issue(user, now);
        await this.audit.record({
          action: 'user.registered',
          actorUserId: user.id,
          resourceType: 'user',
          resourceId: user.id,
        });
      });
    } catch (error) {
      // Lost a race with a concurrent registration of the same email.
      if (error instanceof ConflictError && error.code === 'email_taken') {
        await this.notifyExistingAccount(email.value);
        return;
      }
      throw error;
    }
    this.eventBus.publishAll(user.pullDomainEvents());
  }

  private notifyExistingAccount(email: string): Promise<void> {
    return this.notifications.enqueueEmail({
      to: email,
      content: {
        template: 'account-exists',
        loginUrl: `${this.settings.appPublicUrl}/login`,
        resetUrl: `${this.settings.appPublicUrl}/forgot-password`,
      },
    });
  }
}

@CommandHandler(VerifyEmailCommand)
export class VerifyEmailHandler implements ICommandHandler<VerifyEmailCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly tokens: EmailVerificationTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ token }: VerifyEmailCommand): Promise<void> {
    const now = this.clock.now();
    await this.tx.run(async () => {
      const userId = await this.tokens.consume(this.opaqueTokens.hash(token), now);
      const user = userId ? await this.users.findByIdForUpdate(userId) : null;
      if (!user) throw invalidTokenError();
      user.verifyEmail(now);
      await this.users.update(user);
      await this.audit.record({
        action: 'auth.email_verified',
        actorUserId: user.id,
        resourceType: 'user',
        resourceId: user.id,
      });
    });
  }
}

@CommandHandler(ResendEmailVerificationCommand)
export class ResendEmailVerificationHandler implements ICommandHandler<ResendEmailVerificationCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly verification: EmailVerificationService,
    private readonly tx: TransactionManager,
    private readonly clock: Clock,
  ) {}

  /** Always completes silently so callers cannot learn which emails have accounts. */
  async execute({ email }: ResendEmailVerificationCommand): Promise<void> {
    let normalized: string;
    try {
      normalized = Email.create(email).value;
    } catch {
      return;
    }
    const user = await this.users.findByEmail(normalized);
    if (!user?.isActive || user.isEmailVerified) return;
    const now = this.clock.now();
    await this.tx.run(() => this.verification.issue(user, now));
  }
}
