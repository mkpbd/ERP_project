import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { AuthenticationError, ForbiddenError } from '../../../shared/domain/errors.js';
import {
  REQUIRED_PERMISSIONS_KEY,
  REQUIRED_ROLES_KEY,
  type AuthenticatedRequest,
} from '../../../shared/presentation/auth.decorators.js';

/**
 * Global guard enforcing @RequirePermissions() and @Roles(). Runs after
 * AuthenticationGuard. Resource-level rules (ownership) are enforced again
 * inside the use cases, which never trust the route check alone.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessControl: AccessControl,
    private readonly audit: AuditTrail,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const permissions = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS_KEY, targets) ?? [];
    const roles = this.reflector.getAllAndMerge<string[]>(REQUIRED_ROLES_KEY, targets) ?? [];
    if (permissions.length === 0 && roles.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;
    if (!actor) throw new AuthenticationError('authentication_required', 'Authentication required');

    if (await this.accessControl.isAllowed(actor.userId, { permissions, roles })) return true;

    await this.audit.record({
      action: 'authz.denied',
      actorUserId: actor.userId,
      resourceType: 'route',
      resourceId: `${request.method} ${request.route ? String((request.route as { path: string }).path) : request.path}`,
      outcome: 'denied',
      metadata: { permissions, roles },
    });
    throw new ForbiddenError();
  }
}
