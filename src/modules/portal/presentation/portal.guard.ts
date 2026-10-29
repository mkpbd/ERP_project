import { createParamDecorator, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { Clock } from '../../../shared/application/ports/clock.js';
import { AuthenticationError } from '../../../shared/domain/errors.js';
import { PortalRepository, PortalTokens, type PortalClaims } from '../application/portal.ports.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

type PortalRequest = Request & { patient?: PortalClaims };

/** A patient's portal token whose session is neither signed out nor expired; staff tokens are not accepted. */
@Injectable()
export class PortalGuard implements CanActivate {
  constructor(
    private readonly tokens: PortalTokens,
    private readonly portal: PortalRepository,
    private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PortalRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new AuthenticationError('authentication_required', 'Authentication required');
    const claims = await this.tokens.verify(token);
    if (!(await this.portal.isSessionLive(claims.sessionId, claims.patientId, this.clock.now()))) {
      throw new AuthenticationError('session_revoked', 'Session is no longer valid');
    }
    request.patient = claims;
    return true;
  }
}

/** The signed-in patient (set by PortalGuard). */
export const CurrentPatient = createParamDecorator((_data: unknown, context: ExecutionContext): PortalClaims => {
  const patient = context.switchToHttp().getRequest<PortalRequest>().patient;
  if (!patient) throw new AuthenticationError('authentication_required', 'Authentication required');
  return patient;
});
