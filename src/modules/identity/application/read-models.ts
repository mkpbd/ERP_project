import type { Page, PageRequest } from '../../../shared/application/pagination.js';
import type { UserStatus } from '../domain/user.js';

export interface UserView {
  readonly id: string;
  readonly email: string;
  readonly username: string | null;
  readonly displayName: string;
  readonly status: UserStatus;
  readonly emailVerified: boolean;
  readonly lastLoginAt: Date | null;
  /** Signing in stops from this moment; null: never. */
  readonly expiresAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CurrentUserView extends UserView {
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
}

export interface SessionView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date;
  readonly expiresAt: Date;
  readonly userAgent: string | null;
  readonly ipAddress: string | null;
  readonly current: boolean;
}

export interface UserListFilter extends PageRequest {
  readonly search?: string;
  readonly status?: UserStatus;
  readonly sort: 'createdAt' | 'email' | 'displayName';
  readonly order: 'asc' | 'desc';
}

/** Query-side projections; never returns password or token hashes. */
export abstract class UserReadRepository {
  abstract getView(userId: string): Promise<UserView | null>;
  abstract list(filter: UserListFilter): Promise<Page<UserView>>;
  abstract listActiveSessions(userId: string, now: Date): Promise<Omit<SessionView, 'current'>[]>;
  /** True when the session is unrevoked, unexpired and belongs to an active user. */
  abstract isSessionActive(sessionId: string, userId: string, now: Date): Promise<boolean>;
}
