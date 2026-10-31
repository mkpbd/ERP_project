import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { UserDirectory, type UserSummary } from '../../../../shared/application/contracts/user-directory.js';
import { offsetOf, toPage, type Page } from '../../../../shared/application/pagination.js';
import { escapeLike } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import {
  UserReadRepository,
  type SessionView,
  type UserListFilter,
  type UserView,
} from '../../application/read-models.js';
import { users, userSessions } from './identity.schema.js';

const userView = {
  id: users.id,
  email: users.email,
  username: users.username,
  displayName: users.displayName,
  status: users.status,
  emailVerifiedAt: users.emailVerifiedAt,
  lastLoginAt: users.lastLoginAt,
  expiresAt: users.expiresAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

const sortColumns = {
  createdAt: users.createdAt,
  email: users.email,
  displayName: users.displayName,
} as const;

type UserViewRow = { [K in keyof typeof userView]: (typeof users.$inferSelect)[K] };

const toView = ({ emailVerifiedAt, ...row }: UserViewRow): UserView => ({
  ...row,
  emailVerified: emailVerifiedAt !== null,
});

@Injectable()
export class DrizzleUserReadRepository extends UserReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async getView(userId: string): Promise<UserView | null> {
    const [row] = await this.context.db.select(userView).from(users).where(eq(users.id, userId)).limit(1);
    return row ? toView(row) : null;
  }

  async list(filter: UserListFilter): Promise<Page<UserView>> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(users.status, filter.status));
    if (filter.search) {
      const pattern = `%${escapeLike(filter.search)}%`;
      const match = or(ilike(users.email, pattern), ilike(users.displayName, pattern), ilike(users.username, pattern));
      if (match) conditions.push(match);
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const direction = filter.order === 'asc' ? asc : desc;

    const [rows, totals] = await Promise.all([
      this.context.db
        .select(userView)
        .from(users)
        .where(where)
        // id as tie-breaker keeps pagination stable across pages.
        .orderBy(direction(sortColumns[filter.sort]), direction(users.id))
        .limit(filter.pageSize)
        .offset(offsetOf(filter)),
      this.context.db.select({ total: count() }).from(users).where(where),
    ]);
    return toPage(rows.map(toView), totals[0]?.total ?? 0, filter);
  }

  listActiveSessions(userId: string, now: Date): Promise<Omit<SessionView, 'current'>[]> {
    return this.context.db
      .select({
        id: userSessions.id,
        createdAt: userSessions.createdAt,
        lastUsedAt: userSessions.lastUsedAt,
        expiresAt: userSessions.expiresAt,
        userAgent: userSessions.userAgent,
        ipAddress: userSessions.ipAddress,
      })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt), gt(userSessions.expiresAt, now)))
      .orderBy(desc(userSessions.lastUsedAt));
  }

  async isSessionActive(sessionId: string, userId: string, now: Date): Promise<boolean> {
    const [row] = await this.context.db
      .select({ id: userSessions.id })
      .from(userSessions)
      .innerJoin(users, eq(users.id, userSessions.userId))
      .where(
        and(
          eq(userSessions.id, sessionId),
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
          eq(users.status, 'active'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }
}

/** Implementation of the cross-module UserDirectory contract. */
@Injectable()
export class DrizzleUserDirectory extends UserDirectory {
  constructor(private readonly context: DbContext) {
    super();
  }

  async findSummaries(userIds: readonly string[]): Promise<UserSummary[]> {
    if (userIds.length === 0) return [];
    const rows = await this.context.db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        expiresAt: users.expiresAt,
      })
      .from(users)
      .where(inArray(users.id, [...userIds]));
    const now = new Date();
    // An account past its expiry is no longer active anywhere else either.
    return rows.map(({ status, expiresAt, ...row }) => ({
      ...row,
      isActive: status === 'active' && (expiresAt === null || expiresAt > now),
    }));
  }
}
