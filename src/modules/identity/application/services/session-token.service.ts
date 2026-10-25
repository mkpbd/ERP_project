import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { RefreshTokenRepository, SessionRepository } from '../../domain/repositories.js';
import { Session } from '../../domain/session.js';
import type { ClientInfo } from '../commands/auth.commands.js';
import {
  AccessTokenService,
  AUTH_SETTINGS,
  OpaqueTokenGenerator,
  type AuthSettings,
  type IssuedAccessToken,
} from '../ports.js';

export interface IssuedRefreshToken {
  readonly id: string;
  readonly token: string;
  readonly expiresAt: Date;
}

/** Opens sessions and issues/rotates the tokens that belong to them. */
@Injectable()
export class SessionTokenService {
  constructor(
    private readonly sessions: SessionRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly accessTokens: AccessTokenService,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  /** Must run inside a transaction. */
  async openSession(
    userId: string,
    client: ClientInfo,
    now: Date,
  ): Promise<{ sessionId: string; refresh: IssuedRefreshToken }> {
    const session = Session.open({
      id: randomUUID(),
      userId,
      now,
      ttlSeconds: this.settings.refreshTokenTtlSeconds,
      userAgent: client.userAgent,
      ipAddress: client.ipAddress,
    });
    await this.sessions.insert(session);
    const refresh = await this.createRefreshToken(session.id, now);
    return { sessionId: session.id, refresh };
  }

  /** Replaces a consumed refresh token and slides the session expiry. Must run inside a transaction. */
  async rotate(sessionId: string, consumedTokenId: string, now: Date): Promise<IssuedRefreshToken> {
    const refresh = await this.createRefreshToken(sessionId, now);
    await this.refreshTokens.linkReplacement(consumedTokenId, refresh.id);
    await this.sessions.extend(sessionId, now, refresh.expiresAt);
    return refresh;
  }

  issueAccessToken(userId: string, sessionId: string): Promise<IssuedAccessToken> {
    return this.accessTokens.issue({ userId, sessionId });
  }

  private async createRefreshToken(sessionId: string, now: Date): Promise<IssuedRefreshToken> {
    const generated = this.opaqueTokens.generate();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + this.settings.refreshTokenTtlSeconds * 1000);
    await this.refreshTokens.insert({ id, sessionId, tokenHash: generated.hash, expiresAt, now });
    return { id, token: generated.token, expiresAt };
  }
}
