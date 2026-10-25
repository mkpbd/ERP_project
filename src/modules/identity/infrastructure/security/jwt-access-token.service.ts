import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { errors as joseErrors, jwtVerify, SignJWT, type JWTHeaderParameters } from 'jose';
import { APP_CONFIG } from '../../../../config/config.module.js';
import type { AppConfig } from '../../../../config/configuration.js';
import { AuthenticationError } from '../../../../shared/domain/errors.js';
import { AccessTokenService, type AccessTokenClaims, type IssuedAccessToken } from '../../application/ports.js';

const ALGORITHM = 'HS256';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Short-lived HS256 access tokens. Every configured key verifies, the first
 * one signs, and the `kid` header selects the key — this enables rotation.
 */
@Injectable()
export class JwtAccessTokenService extends AccessTokenService {
  private readonly keys: Map<string, Uint8Array>;
  private readonly signingKid: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    const encoder = new TextEncoder();
    this.keys = new Map(config.jwt.signingKeys.map((key) => [key.kid, encoder.encode(key.secret)]));
    const first = config.jwt.signingKeys[0];
    if (!first) throw new Error('At least one JWT signing key is required');
    this.signingKid = first.kid;
  }

  async issue(claims: AccessTokenClaims): Promise<IssuedAccessToken> {
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + this.config.jwt.accessTokenTtlSeconds;
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM, kid: this.signingKid, typ: 'at+jwt' })
      .setSubject(claims.userId)
      .setIssuer(this.config.jwt.issuer)
      .setAudience(this.config.jwt.audience)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .setJti(randomUUID())
      .sign(this.signingKey());
    return { token, expiresAt: new Date(expiresAt * 1000) };
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    try {
      const { payload } = await jwtVerify(token, (header: JWTHeaderParameters) => this.verificationKey(header), {
        algorithms: [ALGORITHM],
        issuer: this.config.jwt.issuer,
        audience: this.config.jwt.audience,
        typ: 'at+jwt',
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
        clockTolerance: 5,
      });
      const { sub, sid } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || !UUID_PATTERN.test(sub) || !UUID_PATTERN.test(sid)) {
        throw new AuthenticationError('invalid_token', 'Access token is invalid');
      }
      return { userId: sub, sessionId: sid };
    } catch (error) {
      if (error instanceof AuthenticationError) throw error;
      if (error instanceof joseErrors.JWTExpired) {
        throw new AuthenticationError('token_expired', 'Access token has expired');
      }
      throw new AuthenticationError('invalid_token', 'Access token is invalid');
    }
  }

  private signingKey(): Uint8Array {
    const key = this.keys.get(this.signingKid);
    if (!key) throw new Error('Signing key missing');
    return key;
  }

  private verificationKey(header: JWTHeaderParameters): Uint8Array {
    const key = header.kid ? this.keys.get(header.kid) : undefined;
    if (!key) throw new AuthenticationError('invalid_token', 'Access token is invalid');
    return key;
  }
}
