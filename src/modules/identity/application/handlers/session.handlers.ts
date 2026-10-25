import { CommandHandler, type ICommandHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { NotFoundError } from '../../../../shared/domain/errors.js';
import { SessionRepository, UserRepository } from '../../domain/repositories.js';
import { LogoutAllCommand, LogoutCommand, RevokeSessionCommand } from '../commands/auth.commands.js';
import { RevokeUserSessionsCommand } from '../commands/user.commands.js';

@CommandHandler(LogoutCommand)
export class LogoutHandler implements ICommandHandler<LogoutCommand> {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor }: LogoutCommand): Promise<void> {
    await this.tx.run(async () => {
      await this.sessions.revoke(actor.sessionId, 'logout', this.clock.now());
      await this.audit.record({
        action: 'auth.logout',
        actorUserId: actor.userId,
        resourceType: 'session',
        resourceId: actor.sessionId,
      });
    });
  }
}

@CommandHandler(LogoutAllCommand)
export class LogoutAllHandler implements ICommandHandler<LogoutAllCommand> {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor }: LogoutAllCommand): Promise<void> {
    await this.tx.run(async () => {
      const revoked = await this.sessions.revokeAllForUser(actor.userId, 'logout_all', this.clock.now());
      await this.audit.record({
        action: 'auth.logout_all',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: actor.userId,
        metadata: { revoked },
      });
    });
  }
}

@CommandHandler(RevokeSessionCommand)
export class RevokeSessionHandler implements ICommandHandler<RevokeSessionCommand> {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, sessionId }: RevokeSessionCommand): Promise<void> {
    await this.tx.run(async () => {
      const session = await this.sessions.findById(sessionId);
      // Another user's session is reported as missing so its existence is not disclosed.
      if (!session?.belongsTo(actor.userId)) throw new NotFoundError('session');
      await this.sessions.revoke(sessionId, 'revoked_by_user', this.clock.now());
      await this.audit.record({
        action: 'session.revoked',
        actorUserId: actor.userId,
        resourceType: 'session',
        resourceId: sessionId,
      });
    });
  }
}

@CommandHandler(RevokeUserSessionsCommand)
export class RevokeUserSessionsHandler implements ICommandHandler<RevokeUserSessionsCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly accessControl: AccessControl,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  async execute({ actor, userId }: RevokeUserSessionsCommand): Promise<{ revoked: number }> {
    await this.accessControl.authorize(actor.userId, { permissions: ['sessions:revoke'] });
    return this.tx.run(async () => {
      if (!(await this.users.findById(userId))) throw new NotFoundError('user');
      const revoked = await this.sessions.revokeAllForUser(userId, 'revoked_by_admin', this.clock.now());
      await this.audit.record({
        action: 'user.sessions_revoked',
        actorUserId: actor.userId,
        resourceType: 'user',
        resourceId: userId,
        metadata: { revoked },
      });
      return { revoked };
    });
  }
}
