import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),
    email: text('email').notNull(),
    username: text('username'),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status', { enum: ['active', 'deactivated'] }).notNull(),
    emailVerifiedAt: tz('email_verified_at'),
    failedLoginCount: integer('failed_login_count').notNull().default(0),
    lockedUntil: tz('locked_until'),
    lastLoginAt: tz('last_login_at'),
    passwordChangedAt: tz('password_changed_at').notNull(),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    /** Signing in stops from this moment (old UserExpireDateSetup); null: never. */
    expiresAt: tz('expires_at'),
    version: integer('version').notNull().default(1),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    uniqueIndex('users_username_uq').on(t.username),
    index('users_created_at_idx').on(t.createdAt),
    check('users_status_ck', sql`${t.status} in ('active', 'deactivated')`),
    check('users_email_lower_ck', sql`${t.email} = lower(${t.email})`),
    check('users_username_lower_ck', sql`${t.username} = lower(${t.username})`),
    check('users_failed_login_count_ck', sql`${t.failedLoginCount} >= 0`),
    check('users_version_ck', sql`${t.version} >= 1`),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: tz('created_at').notNull().defaultNow(),
    lastUsedAt: tz('last_used_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    revokedReason: text('revoked_reason'),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
  },
  (t) => [
    index('user_sessions_user_active_idx')
      .on(t.userId)
      .where(sql`${t.revokedAt} is null`),
    check('user_sessions_expiry_ck', sql`${t.expiresAt} > ${t.createdAt}`),
    check('user_sessions_user_agent_len_ck', sql`char_length(${t.userAgent}) <= 512`),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => userSessions.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
    replacedById: uuid('replaced_by_id').references((): AnyPgColumn => refreshTokens.id, { onDelete: 'set null' }),
  },
  (t) => [
    uniqueIndex('refresh_tokens_token_hash_uq').on(t.tokenHash),
    index('refresh_tokens_session_idx').on(t.sessionId),
    check('refresh_tokens_hash_format_ck', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
  },
  (t) => [
    uniqueIndex('password_reset_tokens_hash_uq').on(t.tokenHash),
    index('password_reset_tokens_user_idx').on(t.userId),
    check('password_reset_tokens_hash_format_ck', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
    expiresAt: tz('expires_at').notNull(),
    usedAt: tz('used_at'),
  },
  (t) => [
    uniqueIndex('email_verification_tokens_hash_uq').on(t.tokenHash),
    index('email_verification_tokens_user_idx').on(t.userId),
    check('email_verification_tokens_hash_format_ck', sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);
