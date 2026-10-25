import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { AuthenticationError, ForbiddenError } from '../../../shared/domain/errors.js';
import { MENU_ACCESS_KEY, type AuthenticatedRequest } from '../../../shared/presentation/auth.decorators.js';
import { NavigationAccessService } from '../application/navigation-access.service.js';

/**
 * Global guard enforcing @MenuAccess(). Runs after AuthorizationGuard, so a
 * route can require both permissions and a usable page. A failed check
 * throws, so the request never passes unchecked.
 */
@Injectable()
export class MenuAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly navigation: NavigationAccessService,
    private readonly audit: AuditTrail,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const pages =
      this.reflector.getAllAndOverride<string[]>(MENU_ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? [];
    if (pages.length === 0) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = request.actor;
    if (!actor) throw new AuthenticationError('authentication_required', 'Authentication required');

    const decision = await this.navigation.checkPages(actor.userId, pages);
    if (decision.allowed) return true;

    await this.audit.record({
      action: 'authz.denied',
      actorUserId: actor.userId,
      resourceType: 'route',
      resourceId: `${request.method} ${request.route ? String((request.route as { path: string }).path) : request.path}`,
      outcome: 'denied',
      metadata: { pages, reason: decision.code },
    });
    throw new ForbiddenError(decision.code, decision.message);
  }
}
