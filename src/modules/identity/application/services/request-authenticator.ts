import { Injectable } from '@nestjs/common';
import type { Actor } from '../../../../shared/application/actor.js';
import { Clock } from '../../../../shared/application/ports/clock.js';
import { AuthenticationError } from '../../../../shared/domain/errors.js';
import { AccessTokenService } from '../ports.js';
import { UserReadRepository } from '../read-models.js';

/**
 * Resolves a bearer token to an actor. Beyond the signature it checks the
 * session server-side, so logout, revocation and deactivation take effect
 * immediately instead of when the access token expires.
 */
@Injectable()
export class RequestAuthenticator {
  constructor(
    private readonly accessTokens: AccessTokenService,
    private readonly read: UserReadRepository,
    private readonly clock: Clock,
  ) {}

  async authenticate(bearerToken: string): Promise<Actor> {
    const claims = await this.accessTokens.verify(bearerToken);
    if (!(await this.read.isSessionActive(claims.sessionId, claims.userId, this.clock.now()))) {
      throw new AuthenticationError('session_revoked', 'Session is no longer valid');
    }
    return { userId: claims.userId, sessionId: claims.sessionId };
  }
}
