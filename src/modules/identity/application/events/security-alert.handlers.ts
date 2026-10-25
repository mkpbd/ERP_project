import { Logger } from '@nestjs/common';
import { EventsHandler, type IEventHandler } from '@nestjs/cqrs';
import { RefreshTokenReuseDetectedEvent, UserLockedOutEvent } from '../../domain/events.js';

/**
 * Surfaces security events to operations as structured warnings so that log
 * based alerting can pick them up. Durable records live in the audit log.
 */
@EventsHandler(UserLockedOutEvent, RefreshTokenReuseDetectedEvent)
export class SecurityAlertHandler implements IEventHandler<UserLockedOutEvent | RefreshTokenReuseDetectedEvent> {
  private readonly logger = new Logger('SecurityAlert');

  handle(event: UserLockedOutEvent | RefreshTokenReuseDetectedEvent): void {
    if (event instanceof UserLockedOutEvent) {
      this.logger.warn({
        event: 'user_locked_out',
        userId: event.userId,
        lockedUntil: event.lockedUntil.toISOString(),
      });
    } else {
      this.logger.warn({ event: 'refresh_token_reuse', userId: event.userId, sessionId: event.sessionId });
    }
  }
}
