export type SessionRevocationReason =
  | 'logout'
  | 'logout_all'
  | 'revoked_by_user'
  | 'revoked_by_admin'
  | 'password_changed'
  | 'password_reset'
  | 'user_deactivated'
  | 'refresh_token_reuse'
  | 'account_inactive';

export interface SessionProps {
  id: string;
  userId: string;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  revokedReason: SessionRevocationReason | null;
  userAgent: string | null;
  ipAddress: string | null;
}

const MAX_USER_AGENT_LENGTH = 512;

/** A signed-in device. Its refresh tokens form one rotation family. */
export class Session {
  private constructor(private readonly props: SessionProps) {}

  static open(params: {
    id: string;
    userId: string;
    now: Date;
    ttlSeconds: number;
    userAgent: string | null;
    ipAddress: string | null;
  }): Session {
    return new Session({
      id: params.id,
      userId: params.userId,
      createdAt: params.now,
      lastUsedAt: params.now,
      expiresAt: new Date(params.now.getTime() + params.ttlSeconds * 1000),
      revokedAt: null,
      revokedReason: null,
      userAgent: params.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
      ipAddress: params.ipAddress,
    });
  }

  static restore(props: SessionProps): Session {
    return new Session({ ...props });
  }

  get id(): string {
    return this.props.id;
  }
  get userId(): string {
    return this.props.userId;
  }
  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  isActive(now: Date): boolean {
    return this.props.revokedAt === null && this.props.expiresAt > now;
  }

  belongsTo(userId: string): boolean {
    return this.props.userId === userId;
  }

  toSnapshot(): Readonly<SessionProps> {
    return { ...this.props };
  }
}
