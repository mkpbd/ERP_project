import type { DomainEvent } from '../../../shared/domain/aggregate-root.js';

export class UserRegisteredEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly occurredAt: Date,
  ) {}
}

export class UserPasswordChangedEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly occurredAt: Date,
  ) {}
}

export class UserDeactivatedEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly occurredAt: Date,
  ) {}
}

export class UserActivatedEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly occurredAt: Date,
  ) {}
}

export class UserLockedOutEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly lockedUntil: Date,
    readonly occurredAt: Date,
  ) {}
}

export class RefreshTokenReuseDetectedEvent implements DomainEvent {
  constructor(
    readonly userId: string,
    readonly sessionId: string,
    readonly occurredAt: Date,
  ) {}
}
