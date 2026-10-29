import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { errors as joseErrors, jwtVerify, SignJWT, type JWTHeaderParameters } from 'jose';
import { APP_CONFIG } from '../../../../config/config.module.js';
import type { AppConfig } from '../../../../config/configuration.js';
import { AuthenticationError } from '../../../../shared/domain/errors.js';
import { OtpHasher, PortalTokens, SmsSender, type PortalClaims } from '../../application/portal.ports.js';
import { mask, OTP_DIGITS } from '../../domain/otp.js';

const ALGORITHM = 'HS256';
const TYPE = 'portal+jwt';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A key of its own per purpose, derived from each configured JWT secret (staff tokens never verify here). */
function derive(secret: string, purpose: string): Uint8Array {
  return createHmac('sha256', secret).update(purpose).digest();
}

/**
 * Patients' tokens: HS256 with keys derived for the portal, their own `typ` and audience, the patient as subject and
 * the portal session as `sid`. Every configured key verifies (rotation); the first signs.
 */
@Injectable()
export class JwtPortalTokens extends PortalTokens {
  private readonly keys: Map<string, Uint8Array>;
  private readonly signingKid: string;
  private readonly audience: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.keys = new Map(config.jwt.signingKeys.map((key) => [key.kid, derive(key.secret, 'patient-portal-token')]));
    const first = config.jwt.signingKeys[0];
    if (!first) throw new Error('At least one JWT signing key is required');
    this.signingKid = first.kid;
    this.audience = `${config.jwt.audience}:portal`;
  }

  issue(claims: PortalClaims, expiresAt: Date): Promise<string> {
    return new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.signingKid, typ: TYPE })
      .setSubject(claims.patientId)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.keys.get(this.signingKid)!);
  }

  async verify(token: string): Promise<PortalClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        (header: JWTHeaderParameters) => {
          const key = header.kid ? this.keys.get(header.kid) : undefined;
          if (!key) throw new AuthenticationError('invalid_token', 'Access token is invalid');
          return key;
        },
        {
          algorithms: [ALGORITHM],
          issuer: this.config.jwt.issuer,
          audience: this.audience,
          typ: TYPE,
          requiredClaims: ['sub', 'sid', 'exp', 'iat'],
          clockTolerance: 5,
        },
      );
      const { sub, sid } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || !UUID_PATTERN.test(sub) || !UUID_PATTERN.test(sid)) {
        throw new AuthenticationError('invalid_token', 'Access token is invalid');
      }
      return { patientId: sub, sessionId: sid };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      if (error instanceof joseErrors.JWTExpired)
        throw new AuthenticationError('token_expired', 'Access token has expired');
      throw new AuthenticationError('invalid_token', 'Access token is invalid');
    }
  }
}

/** HMAC-SHA256 of the challenge and code under a key derived for the purpose. */
@Injectable()
export class HmacOtpHasher extends OtpHasher {
  private readonly key: Uint8Array;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super();
    const first = config.jwt.signingKeys[0];
    if (!first) throw new Error('At least one JWT signing key is required');
    this.key = derive(first.secret, 'patient-portal-otp');
  }

  newCode(): string {
    return String(randomInt(0, 10 ** OTP_DIGITS)).padStart(OTP_DIGITS, '0');
  }

  hash(challengeId: string, code: string): string {
    return createHmac('sha256', this.key).update(`${challengeId}:${code}`).digest('hex');
  }

  matches(challengeId: string, code: string, hash: string): boolean {
    const given = Buffer.from(this.hash(challengeId, code), 'hex');
    const kept = Buffer.from(hash, 'hex');
    return given.length === kept.length && timingSafeEqual(given, kept);
  }
}

/**
 * No SMS gateway is set up yet. Outside production the message is logged and kept (the last 50) for development and
 * tests; in production nothing is logged but that a message could not be sent.
 */
@Injectable()
export class LogSmsSender extends SmsSender {
  private readonly logger = new Logger('SmsSender');
  readonly sent: { to: string; text: string }[] = [];

  constructor(private readonly isProduction: boolean) {
    super();
  }

  send(to: string, text: string): Promise<void> {
    if (this.isProduction) {
      this.logger.warn(`No SMS gateway is configured; a message to ${mask(to)} was not sent`);
      return Promise.resolve();
    }
    this.sent.push({ to, text });
    if (this.sent.length > 50) this.sent.shift();
    this.logger.log(`SMS to ${mask(to)}: ${text}`);
    return Promise.resolve();
  }
}
