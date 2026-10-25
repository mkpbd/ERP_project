import { Injectable } from '@nestjs/common';
import { and, eq, isNull, ne, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { RefreshTokenRepository, SessionRepository, type RefreshTokenConsumption } from '../../domain/repositories.js';
import { Session, type SessionRevocationReason } from '../../domain/session.js';
import { refreshTokens, userSessions } from './identity.schema.js';

@Injectable()
export class DrizzleSessionRepository extends SessionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(session: Session): Promise<void> {
    await this.context.db.insert(userSessions).values({ ...session.toSnapshot() });
  }

  async findById(id: string): Promise<Session | null> {
    const [row] = await this.context.db.select().from(userSessions).where(eq(userSessions.id, id)).limit(1);
    return row ? Session.restore({ ...row, revokedReason: row.revokedReason as SessionRevocationReason | null }) : null;
  }

  async revoke(id: string, reason: SessionRevocationReason, now: Date): Promise<boolean> {
    const revoked = await this.context.db
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(userSessions.id, id), isNull(userSessions.revokedAt)))
      .returning({ id: userSessions.id });
    return revoked.length > 0;
  }

  async revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options: { exceptSessionId?: string } = {},
  ): Promise<number> {
    const conditions: SQL[] = [eq(userSessions.userId, userId), isNull(userSessions.revokedAt)];
    if (options.exceptSessionId) conditions.push(ne(userSessions.id, options.exceptSessionId));
    const revoked = await this.context.db
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(...conditions))
      .returning({ id: userSessions.id });
    return revoked.length;
  }

  async extend(id: string, now: Date, expiresAt: Date): Promise<void> {
    await this.context.db.update(userSessions).set({ lastUsedAt: now, expiresAt }).where(eq(userSessions.id, id));
  }
}

@Injectable()
export class DrizzleRefreshTokenRepository extends RefreshTokenRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insert(token: { id: string; sessionId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void> {
    await this.context.db.insert(refreshTokens).values({
      id: token.id,
      sessionId: token.sessionId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      createdAt: token.now,
    });
  }

  async consume(tokenHash: string, now: Date): Promise<RefreshTokenConsumption> {
    // Conditional update: concurrent consumers serialize on the row lock and
    // only the first one sees used_at IS NULL.
    const [consumed] = await this.context.db
      .update(refreshTokens)
      .set({ usedAt: now })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.usedAt)))
      .returning({ id: refreshTokens.id, sessionId: refreshTokens.sessionId, expiresAt: refreshTokens.expiresAt });
    if (consumed) {
      return { status: 'consumed', tokenId: consumed.id, sessionId: consumed.sessionId, expiresAt: consumed.expiresAt };
    }
    const [existing] = await this.context.db
      .select({ sessionId: refreshTokens.sessionId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    return existing ? { status: 'reused', sessionId: existing.sessionId } : { status: 'unknown' };
  }

  async linkReplacement(tokenId: string, replacedById: string): Promise<void> {
    await this.context.db.update(refreshTokens).set({ replacedById }).where(eq(refreshTokens.id, tokenId));
  }
}
