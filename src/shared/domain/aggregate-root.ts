export interface DomainEvent {
  readonly occurredAt: Date;
}

/**
 * Collects domain events raised while a use case mutates the aggregate.
 * Application handlers pull and publish them after the transaction commits.
 */
export abstract class AggregateRoot {
  #events: DomainEvent[] = [];

  protected raise(event: DomainEvent): void {
    this.#events.push(event);
  }

  pullDomainEvents(): DomainEvent[] {
    const events = this.#events;
    this.#events = [];
    return events;
  }
}
