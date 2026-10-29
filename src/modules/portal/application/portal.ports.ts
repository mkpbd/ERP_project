import type { Channel } from '../domain/otp.js';

export interface PortalClaims {
  readonly patientId: string;
  readonly sessionId: string;
}

/** Patients' sign-in tokens: never accepted where staff tokens are, nor the other way round. */
export abstract class PortalTokens {
  abstract issue(claims: PortalClaims, expiresAt: Date): Promise<string>;
  /** Throws AuthenticationError when the token is malformed, expired or not a portal token. */
  abstract verify(token: string): Promise<PortalClaims>;
}

/** One-time codes and their keyed hashes (a stolen table does not give the codes away). */
export abstract class OtpHasher {
  /** A new random code of OTP_DIGITS digits. */
  abstract newCode(): string;
  abstract hash(challengeId: string, code: string): string;
  /** Constant time. */
  abstract matches(challengeId: string, code: string, hash: string): boolean;
}

export abstract class SmsSender {
  abstract send(to: string, text: string): Promise<void>;
}

export interface Challenge {
  readonly id: string;
  readonly patientId: string;
  readonly channel: Channel;
  readonly sentTo: string;
  readonly codeHash: string;
  readonly expiresAt: Date;
  readonly attempts: number;
  readonly consumedAt: Date | null;
  readonly createdAt: Date;
}

export abstract class PortalRepository {
  abstract insertChallenge(challenge: Challenge): Promise<void>;
  abstract challengeForUpdate(id: string): Promise<Challenge | null>;
  /** The patient's challenges created since then, newest first. */
  abstract recentChallenges(patientId: string, since: Date): Promise<Challenge[]>;
  abstract countFailure(id: string): Promise<void>;
  abstract consume(id: string, at: Date): Promise<void>;
  abstract insertSession(session: {
    id: string;
    patientId: string;
    challengeId: string;
    expiresAt: Date;
  }): Promise<void>;
  /** Whether the session is neither signed out nor expired. */
  abstract isSessionLive(id: string, patientId: string, at: Date): Promise<boolean>;
  abstract revokeSession(id: string, at: Date): Promise<void>;
}
