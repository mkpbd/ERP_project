import { Injectable } from '@nestjs/common';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { EmailVerificationTokenRepository, PasswordResetTokenRepository } from '../../domain/repositories.js';
import { emailVerificationTokens, passwordResetTokens } from './identity.schema.js';

// Both token tables share one column layout; the reset table's type describes either.
type OneTimeTokenTable = typeof passwordResetTokens;

class OneTimeTokenStore {
  constructor(
    private readonly context: DbContext,
    private readonly table: OneTimeTokenTable,
  ) {}

  async insert(token: { id: string; userId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void> {
    await this.context.db.insert(this.table).values({
      id: token.id,
      userId: token.userId,
      tokenHash: token.tokenHash,
      expiresAt: token.expiresAt,
      createdAt: token.now,
    });
  }

  async consume(tokenHash: string, now: Date): Promise<string | null> {
    const [row] = await this.context.db
      .update(this.table)
      .set({ usedAt: now })
      .where(and(eq(this.table.tokenHash, tokenHash), isNull(this.table.usedAt), gt(this.table.expiresAt, now)))
      .returning({ userId: this.table.userId });
    return row?.userId ?? null;
  }

  async peek(tokenHash: string, now: Date): Promise<string | null> {
    const [row] = await this.context.db
      .select({ userId: this.table.userId })
      .from(this.table)
      .where(and(eq(this.table.tokenHash, tokenHash), isNull(this.table.usedAt), gt(this.table.expiresAt, now)))
      .limit(1);
    return row?.userId ?? null;
  }

  async invalidateAllForUser(userId: string, now: Date): Promise<void> {
    await this.context.db
      .update(this.table)
      .set({ usedAt: now })
      .where(and(eq(this.table.userId, userId), isNull(this.table.usedAt)));
  }
}

@Injectable()
export class DrizzlePasswordResetTokenRepository extends PasswordResetTokenRepository {
  private readonly store: OneTimeTokenStore;

  constructor(context: DbContext) {
    super();
    this.store = new OneTimeTokenStore(context, passwordResetTokens);
  }

  insert(token: Parameters<OneTimeTokenStore['insert']>[0]): Promise<void> {
    return this.store.insert(token);
  }
  consume(tokenHash: string, now: Date): Promise<string | null> {
    return this.store.consume(tokenHash, now);
  }
  peek(tokenHash: string, now: Date): Promise<string | null> {
    return this.store.peek(tokenHash, now);
  }
  invalidateAllForUser(userId: string, now: Date): Promise<void> {
    return this.store.invalidateAllForUser(userId, now);
  }
}

@Injectable()
export class DrizzleEmailVerificationTokenRepository extends EmailVerificationTokenRepository {
  private readonly store: OneTimeTokenStore;

  constructor(context: DbContext) {
    super();
    this.store = new OneTimeTokenStore(context, emailVerificationTokens as unknown as OneTimeTokenTable);
  }

  insert(token: Parameters<OneTimeTokenStore['insert']>[0]): Promise<void> {
    return this.store.insert(token);
  }
  consume(tokenHash: string, now: Date): Promise<string | null> {
    return this.store.consume(tokenHash, now);
  }
  peek(tokenHash: string, now: Date): Promise<string | null> {
    return this.store.peek(tokenHash, now);
  }
  invalidateAllForUser(userId: string, now: Date): Promise<void> {
    return this.store.invalidateAllForUser(userId, now);
  }
}
