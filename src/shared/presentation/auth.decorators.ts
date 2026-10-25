import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Actor } from '../application/actor.js';
import { AuthenticationError } from '../domain/errors.js';

export const IS_PUBLIC_KEY = 'auth:public';
export const REQUIRED_PERMISSIONS_KEY = 'auth:permissions';
export const REQUIRED_ROLES_KEY = 'auth:roles';
export const AUTH_RATE_LIMIT_KEY = 'auth:rate-limit';
export const MENU_ACCESS_KEY = 'auth:menu-access';

export type PermissionName = `${string}:${string}`;

export interface AuthenticatedRequest extends Request {
  actor?: Actor;
}

/** Opts a route out of authentication. Every other route requires a valid session. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Requires every listed permission. Checked by AuthorizationGuard before the handler runs. */
export const RequirePermissions = (...permissions: PermissionName[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);

/** Requires at least one of the listed roles. Prefer permissions; roles are coarse-grained. */
export const Roles = (...roles: string[]): MethodDecorator & ClassDecorator => SetMetadata(REQUIRED_ROLES_KEY, roles);

/**
 * Page-level access: the route answers only when the caller can use one of the listed frontend pages
 * (an active menu with that path that one of their roles holds). Checked by MenuAccessGuard after
 * AuthorizationGuard. A method-level list replaces the class-level one.
 */
export const MenuAccess = (...pages: string[]): MethodDecorator & ClassDecorator => SetMetadata(MENU_ACCESS_KEY, pages);

/** Applies the stricter authentication rate limit (credential guessing, token abuse). */
export const AuthRateLimit = (): MethodDecorator & ClassDecorator => SetMetadata(AUTH_RATE_LIMIT_KEY, true);

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext): Actor => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.actor) throw new AuthenticationError('authentication_required', 'Authentication required');
  return request.actor;
});
