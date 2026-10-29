import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, isNull, sql } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { PortalRepository, type Challenge } from '../../application/portal.ports.js';
import { otpChallenges, portalSessions } from './portal.schema.js';

@Injectable()
export class DrizzlePortalRepository extends PortalRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async insertChallenge(challenge: Challenge): Promise<void> {
    await this.context.db.insert(otpChallenges).values(challenge);
  }

  async challengeForUpdate(id: string): Promise<Challenge | null> {
    const [row] = await this.context.db.select().from(otpChallenges).where(eq(otpChallenges.id, id)).for('update');
    return row ?? null;
  }

  recentChallenges(patientId: string, since: Date): Promise<Challenge[]> {
    return this.context.db
      .select()
      .from(otpChallenges)
      .where(and(eq(otpChallenges.patientId, patientId), gte(otpChallenges.createdAt, since)))
      .orderBy(desc(otpChallenges.createdAt));
  }

  async countFailure(id: string): Promise<void> {
    await this.context.db
      .update(otpChallenges)
      .set({ attempts: sql`${otpChallenges.attempts} + 1` })
      .where(eq(otpChallenges.id, id));
  }

  async consume(id: string, at: Date): Promise<void> {
    await this.context.db.update(otpChallenges).set({ consumedAt: at }).where(eq(otpChallenges.id, id));
  }

  async insertSession(session: { id: string; patientId: string; challengeId: string; expiresAt: Date }) {
    await this.context.db.insert(portalSessions).values(session);
  }

  async isSessionLive(id: string, patientId: string, at: Date): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: portalSessions.id })
      .from(portalSessions)
      .where(
        and(
          eq(portalSessions.id, id),
          eq(portalSessions.patientId, patientId),
          isNull(portalSessions.revokedAt),
          gt(portalSessions.expiresAt, at),
        ),
      );
    return !!row;
  }

  async revokeSession(id: string, at: Date): Promise<void> {
    await this.context.db
      .update(portalSessions)
      .set({ revokedAt: at })
      .where(and(eq(portalSessions.id, id), isNull(portalSessions.revokedAt)));
  }
}
