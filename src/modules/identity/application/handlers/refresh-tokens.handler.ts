import { Inject } from '@nestjs/common';
import { CommandHandler, EventBus, type ICommandHandler } from '@nestjs/cqrs';
import { AuditTrail } from '../../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../../shared/application/ports/transaction-manager.js';
import { AuthenticationError } from '../../../../shared/domain/errors.js';
import { RefreshTokenReuseDetectedEvent } from '../../domain/events.js';
import { RefreshTokenRepository, SessionRepository, UserRepository } from '../../domain/repositories.js';
import { RefreshTokensCommand, type AuthTokens } from '../commands/auth.commands.js';
import { AUTH_SETTINGS, OpaqueTokenGenerator, type AuthSettings } from '../ports.js';
import { SessionTokenService, type IssuedRefreshToken } from '../services/session-token.service.js';

type Outcome =
  | { kind: 'rotated'; userId: string; sessionId: string; refresh: IssuedRefreshToken }
  | { kind: 'reuse'; userId: string | null; sessionId: string }
  | { kind: 'invalid' };

@CommandHandler(RefreshTokensCommand)
export class RefreshTokensHandler implements ICommandHandler<RefreshTokensCommand> {
  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly sessionTokens: SessionTokenService,
    private readonly tx: TransactionManager,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
    private readonly eventBus: EventBus,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  async execute(command: RefreshTokensCommand): Promise<AuthTokens> {
    const now = this.clock.now();
    const tokenHash = this.opaqueTokens.hash(command.refreshToken);

    // The outcome is returned rather than thrown so that reuse revocation commits.
    const outcome = await this.tx.run(async (): Promise<Outcome> => {
      const consumption = await this.refreshTokens.consume(tokenHash, now);
      if (consumption.status === 'unknown') return { kind: 'invalid' };

      if (consumption.status === 'reused') {
        // A rotated token was presented again: assume theft and kill the whole family.
        const session = await this.sessions.findById(consumption.sessionId);
        await this.sessions.revoke(consumption.sessionId, 'refresh_token_reuse', now);
        await this.audit.record({
          action: 'auth.refresh_token_reuse',
          actorUserId: session?.userId ?? null,
          resourceType: 'session',
          resourceId: consumption.sessionId,
          outcome: 'denied',
        });
        return { kind: 'reuse', userId: session?.userId ?? null, sessionId: consumption.sessionId };
      }

      const session = await this.sessions.findById(consumption.sessionId);
      if (!session || !session.isActive(now) || consumption.expiresAt <= now) return { kind: 'invalid' };

      const user = await this.users.findById(session.userId);
      if (!user || user.signInBlock(this.settings.emailVerificationRequired, now)) {
        await this.sessions.revoke(session.id, 'account_inactive', now);
        return { kind: 'invalid' };
      }

      const refresh = await this.sessionTokens.rotate(session.id, consumption.tokenId, now);
      return { kind: 'rotated', userId: user.id, sessionId: session.id, refresh };
    });

    if (outcome.kind === 'reuse' && outcome.userId) {
      this.eventBus.publish(new RefreshTokenReuseDetectedEvent(outcome.userId, outcome.sessionId, now));
    }
    if (outcome.kind !== 'rotated') {
      throw new AuthenticationError('invalid_refresh_token', 'Refresh token is invalid or expired');
    }

    const access = await this.sessionTokens.issueAccessToken(outcome.userId, outcome.sessionId);
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: outcome.refresh.token,
      refreshTokenExpiresAt: outcome.refresh.expiresAt,
      sessionId: outcome.sessionId,
    };
  }
}
