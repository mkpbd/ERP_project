import type { DomainEvent } from '../../../shared/domain/aggregate-root.js';

export class RolePermissionsChangedEvent implements DomainEvent {
  constructor(
    readonly roleId: string,
    readonly occurredAt: Date,
  ) {}
}

export class UserRolesChangedEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly occurredAt: Date,
  ) {}
}
