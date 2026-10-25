import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { RolePermissionsChangedEvent, UserRolesChangedEvent } from '../../domain/events.js';
import { AccessControlService } from '../access-control.service.js';

/**
 * Drops cached authorization profiles when assignments change. The cache is
 * per process; see docs/architecture.md for multi-instance considerations.
 */
@EventsHandler(UserRolesChangedEvent, RolePermissionsChangedEvent)
export class PermissionCacheInvalidationHandler implements IEventHandler<
  UserRolesChangedEvent | RolePermissionsChangedEvent
> {
  constructor(private readonly access: AccessControlService) {}

  handle(event: UserRolesChangedEvent | RolePermissionsChangedEvent): void {
    if (event instanceof UserRolesChangedEvent) {
      this.access.invalidateUser(event.userId);
    } else {
      // Any number of users may hold the role.
      this.access.invalidateAll();
    }
  }
}
