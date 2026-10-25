export abstract class PasswordHasher {
  abstract hash(plain: string): Promise<string>;
  abstract verify(hash: string, plain: string): Promise<boolean>;
  abstract needsRehash(hash: string): boolean;
  /**
   * Performs a verification against a fixed dummy hash so that requests for
   * unknown or locked accounts take as long as real password checks.
   */
  abstract simulateVerify(plain: string): Promise<void>;
}

export interface AccessTokenClaims {
  readonly userId: string;
  readonly sessionId: string;
}

export interface IssuedAccessToken {
  readonly token: string;
  readonly expiresAt: Date;
}

export abstract class AccessTokenService {
  abstract issue(claims: AccessTokenClaims): Promise<IssuedAccessToken>;
  /** Throws AuthenticationError when the token is malformed, expired or not ours. */
  abstract verify(token: string): Promise<AccessTokenClaims>;
}

export interface OpaqueToken {
  /** Returned to the client once; never stored. */
  readonly token: string;
  /** SHA-256 hex digest; the only form persisted. */
  readonly hash: string;
}

export abstract class OpaqueTokenGenerator {
  abstract generate(): OpaqueToken;
  abstract hash(token: string): string;
}

export interface AuthSettings {
  readonly registrationEnabled: boolean;
  readonly emailVerificationRequired: boolean;
  readonly lockout: { readonly maxFailedAttempts: number; readonly lockoutSeconds: number };
  readonly refreshTokenTtlSeconds: number;
  readonly passwordResetTokenTtlSeconds: number;
  readonly emailVerificationTokenTtlSeconds: number;
  readonly appPublicUrl: string;
}

export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');
