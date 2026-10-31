import { randomUUID } from 'node:crypto';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { ConflictError, DomainError, NotFoundError } from '../../../../shared/domain/errors.js';
import { assertAcceptablePassword } from '../../domain/password-policy.js';
import { SessionRepository, UserRepository } from '../../domain/repositories.js';
import { User } from '../../domain/user.js';
import { DisplayName, Email, Username } from '../../domain/value-objects.js';
import {
  ActivateUserCommand,
  BootstrapAdministratorCommand,
  CreateUserCommand,
  DeactivateUserCommand,
  SetUserExpiryCommand,
  UpdateUserCommand,
} from '../commands/user.commands.js';
import { PasswordHasher } from '../ports.js';

@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateUserCommand): Promise<{ id: string }> {
    await this.accessControl.authorize(command.actor.userId, { permissions: ['users:create'] });
    const email = Email.create(command.email);
    const username = command.username ? Username.create(command.username) : null;
    const displayName = DisplayName.create(command.displayName);
    assertAcceptablePassword(command.password, { email: email.value, username: username?.value ?? null });

    if (await this.users.findByEmail(email.value)) {
      throw new ConflictError('email_taken', 'A user with this email already exists');
    }
    if (username && (await this.users.findByUsername(username.value))) {
      throw new ConflictError('username_taken', 'Username is already taken');
    }

    const user = User.register({
      id: randomUUID(),
      email,
      username,
      displayName,
      passwordHash: await this.hasher.hash(command.password),
      emailVerified: true,
      now: this.clock.now(),
    });
    await this.tx.run(async () => {
      await this.users.insert(user);
      await this.audit.record({
        action: 'user.created',
        actorUserId: command.actor.userId,
        resourceType: 'user',
        resourceId: user.id,
      });
    });
    this.eventBus.publishAll(user.pullDomainEvents());
    return { id: user.id };
  }
}

@CommandHandler(UpdateUserCommand)
export class UpdateUserHandler implements ICommandHandler<UpdateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, userId, displayName }: UpdateUserCommand): Promise<void> {
    // Users may edit their own profile; editing anyone else needs users:update.
    await this.accessControl.authorize(actor.userId, { permissions: ['users:update'], ownerId: userId });
    const name = DisplayName.create(displayName);
    await this.tx.run(async () => {
      const user = await this.users.findByIdForUpdate(userId);
      if (!user) throw new NotFoundError('user');
      user.rename(name, this.clock.now());
      await this.users.update(user);
      await this.audit.record({
        action: 'user.updated',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { fields: ['displayName'] },
      });
    });
  }
}

@CommandHandler(DeactivateUserCommand)
export class DeactivateUserHandler implements ICommandHandler<DeactivateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, userId }: DeactivateUserCommand): Promise<void> {
    await this.accessControl.authorize(actor.userId, { permissions: ['users:deactivate'] });
    if (actor.userId === userId) {
      throw new DomainError('cannot_deactivate_self', 'You cannot deactivate your own account');
    }
    const now = this.clock.now();
    const events = await this.tx.run(async () => {
      const user = await this.users.findByIdForUpdate(userId);
      if (!user) throw new NotFoundError('user');
      await this.accessControl.assertNotLastActiveSuperAdmin(userId);
      user.deactivate(now);
      await this.users.update(user);
      const revoked = await this.sessions.revokeAllForUser(userId, 'user_deactivated', now);
      await this.audit.record({
        action: 'user.deactivated',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { sessionsRevoked: revoked },
      });
      return user.pullDomainEvents();
    });
    this.accessControl.invalidateUser(userId);
    this.eventBus.publishAll(events);
  }
}

/**
 * Old UserExpireDateSetup: a temporary account (a locum, a trainee) signs in until its expiry; from then it is refused
 * like a deactivated one and its sessions end at their next refresh (or at once when the moment is past). Not one's
 * own account, and never the last active super-admin.
 */
@CommandHandler(SetUserExpiryCommand)
export class SetUserExpiryHandler implements ICommandHandler<SetUserExpiryCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, userId, expiresAt }: SetUserExpiryCommand): Promise<void> {
    await this.accessControl.authorize(actor.userId, { permissions: ['users:deactivate'] });
    if (actor.userId === userId) {
      throw new DomainError('cannot_expire_self', 'You cannot set an expiry on your own account');
    }
    const now = this.clock.now();
    await this.tx.run(async () => {
      const user = await this.users.findByIdForUpdate(userId);
      if (!user) throw new NotFoundError('user');
      if (expiresAt) await this.accessControl.assertNotLastActiveSuperAdmin(userId);
      user.setExpiry(expiresAt, now);
      await this.users.update(user);
      const revoked = user.isExpired(now) ? await this.sessions.revokeAllForUser(userId, 'account_inactive', now) : 0;
      await this.audit.record({
        action: 'user.expiry_set',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { expiresAt: expiresAt?.toISOString() ?? null, sessionsRevoked: revoked },
      });
    });
    this.accessControl.invalidateUser(userId);
  }
}

@CommandHandler(ActivateUserCommand)
export class ActivateUserHandler implements ICommandHandler<ActivateUserCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
  ) {}

  async execute({ actor, userId }: ActivateUserCommand): Promise<void> {
    await this.accessControl.authorize(actor.userId, { permissions: ['users:deactivate'] });
    const events = await this.tx.run(async () => {
      const user = await this.users.findByIdForUpdate(userId);
      if (!user) throw new NotFoundError('user');
      user.activate(this.clock.now());
      await this.users.update(user);
      await this.audit.record({
        action: 'user.activated',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
      });
      return user.pullDomainEvents();
    });
    this.eventBus.publishAll(events);
  }
}

/**
 * Idempotently provisions the first super-admin. Does nothing once any active
 * super-admin exists, so it is safe to run on every deployment.
 */
@CommandHandler(BootstrapAdministratorCommand)
export class BootstrapAdministratorHandler implements ICommandHandler<BootstrapAdministratorCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly hasher: PasswordHasher,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute(command: BootstrapAdministratorCommand): Promise<{ created: boolean; userId: string | null }> {
    const email = Email.create(command.email);
    const displayName = DisplayName.create(command.displayName);
    const now = this.clock.now();

    return this.tx.run(async () => {
      await this.tx.lock('identity:bootstrap-administrator');
      if (await this.accessControl.hasActiveSuperAdmin()) return { created: false, userId: null };

      const existing = await this.users.findByEmail(email.value);
      let userId: string;
      if (existing) {
        // Existing credentials are kept; the account is only promoted.
        const user = await this.users.findByIdForUpdate(existing.id);
        if (!user) throw new NotFoundError('user');
        if (!user.isActive) user.activate(now);
        user.verifyEmail(now);
        await this.users.update(user);
        userId = user.id;
      } else {
        assertAcceptablePassword(command.password, { email: email.value });
        const user = User.register({
          id: randomUUID(),
          email,
          username: null,
          displayName,
          passwordHash: await this.hasher.hash(command.password),
          emailVerified: true,
          now,
        });
        await this.users.insert(user);
        userId = user.id;
      }
      await this.accessControl.grantSuperAdmin(userId, null);
      await this.audit.record({
        action: 'admin.bootstrapped',
        actorUserId: null,
        resourceType: 'user',
        resourceId: userId,
        metadata: { promotedExistingUser: existing !== null },
      });
      return { created: true, userId };
    });
  }
}
