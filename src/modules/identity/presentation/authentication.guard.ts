import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthenticationError } from '../../../shared/domain/errors.js';
import { IS_PUBLIC_KEY, type AuthenticatedRequest } from '../../../shared/presentation/auth.decorators.js';
import { RequestAuthenticator } from '../application/services/request-authenticator.js';

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/;

/** Global guard: every route requires a valid bearer token unless marked @Public(). */
@Injectable()
export class AuthenticationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authenticator: RequestAuthenticator,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = BEARER.exec(request.headers.authorization ?? '')?.[1];
    if (!token) throw new AuthenticationError('authentication_required', 'Authentication required');
    request.actor = await this.authenticator.authenticate(token);
    return true;
  }
}
