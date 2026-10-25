import type { SessionRevocationReason, Session } from './session.js';
import type { User } from './user.js';

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  /** Locks the row until the surrounding transaction ends. */
  abstract findByIdForUpdate(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findByUsername(username: string): Promise<User | null>;
  /** Throws ConflictError (email_taken / username_taken) on unique violations. */
  abstract insert(user: User): Promise<void>;
  /** Optimistic concurrency: throws ConflictError if the row changed since it was read. */
  abstract update(user: User): Promise<void>;
}

export abstract class SessionRepository {
  abstract insert(session: Session): Promise<void>;
  abstract findById(id: string): Promise<Session | null>;
  abstract revoke(id: string, reason: SessionRevocationReason, now: Date): Promise<boolean>;
  abstract revokeAllForUser(
    userId: string,
    reason: SessionRevocationReason,
    now: Date,
    options?: { exceptSessionId?: string },
  ): Promise<number>;
  abstract extend(id: string, now: Date, expiresAt: Date): Promise<void>;
}

export type RefreshTokenConsumption =
  | { readonly status: 'consumed'; readonly tokenId: string; readonly sessionId: string; readonly expiresAt: Date }
  | { readonly status: 'reused'; readonly sessionId: string }
  | { readonly status: 'unknown' };

export abstract class RefreshTokenRepository {
  abstract insert(token: {
    id: string;
    sessionId: string;
    tokenHash: string;
    expiresAt: Date;
    now: Date;
  }): Promise<void>;
  /**
   * Atomically marks the token as used. A token that was already used reports
   * `reused`, which signals theft of the token family.
   */
  abstract consume(tokenHash: string, now: Date): Promise<RefreshTokenConsumption>;
  abstract linkReplacement(tokenId: string, replacedById: string): Promise<void>;
}

/** Single-use, expiring token bound to one user (password reset, email verification). */
export abstract class OneTimeTokenRepository {
  abstract insert(token: { id: string; userId: string; tokenHash: string; expiresAt: Date; now: Date }): Promise<void>;
  /** Returns the owning user id if the token was valid and is now consumed, otherwise null. */
  abstract consume(tokenHash: string, now: Date): Promise<string | null>;
  /** Returns the owning user id of a currently valid token without consuming it. */
  abstract peek(tokenHash: string, now: Date): Promise<string | null>;
  abstract invalidateAllForUser(userId: string, now: Date): Promise<void>;
}

export abstract class PasswordResetTokenRepository extends OneTimeTokenRepository {}

export abstract class EmailVerificationTokenRepository extends OneTimeTokenRepository {}
