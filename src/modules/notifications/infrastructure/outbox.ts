import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { and, asc, eq, lte, sql } from 'drizzle-orm';
import { APP_CONFIG } from '../../../config/config.module.js';
import type { AppConfig } from '../../../config/configuration.js';
import { DbContext } from '../../../database/drizzle-transaction-manager.js';
import { NotificationQueue, type EmailNotification } from '../../../shared/application/ports/notification-queue.js';
import { EmailSender, renderEmail } from '../application/email.js';
import { outboxMessages } from './persistence/outbox.schema.js';

const EMAIL_MESSAGE = 'email';
const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;

/** Writes notifications into the outbox table inside the caller's transaction. */
@Injectable()
export class OutboxNotificationQueue extends NotificationQueue {
  constructor(private readonly context: DbContext) {
    super();
  }

  async enqueueEmail(notification: EmailNotification): Promise<void> {
    await this.context.db.insert(outboxMessages).values({
      id: randomUUID(),
      type: EMAIL_MESSAGE,
      payload: { to: notification.to, content: notification.content },
    });
  }
}

/**
 * Delivers committed outbox messages with at-least-once semantics.
 * `FOR UPDATE SKIP LOCKED` lets several instances poll without double-sending a row.
 */
@Injectable()
export class OutboxDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly context: DbContext,
    private readonly sender: EmailSender,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    const interval = this.config.mail.outboxPollIntervalMs;
    if (interval <= 0) return;
    this.timer = setInterval(() => {
      void this.dispatchPending().catch((error: unknown) =>
        this.logger.error({ err: error }, 'Outbox dispatch failed'),
      );
    }, interval);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running?.catch(() => undefined);
  }

  /** Processes one batch. Returns the number of messages delivered. Exposed for tests and scripts. */
  dispatchPending(): Promise<number> {
    this.running ??= this.processBatch().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private processBatch(): Promise<number> {
    return this.context.runInTransaction(async () => {
      // Compare against the database clock: available_at defaults to now() with
      // microsecond precision, which a millisecond JS Date could undershoot.
      const batch = await this.context.db
        .select()
        .from(outboxMessages)
        .where(and(eq(outboxMessages.status, 'pending'), lte(outboxMessages.availableAt, sql`now()`)))
        .orderBy(asc(outboxMessages.availableAt))
        .limit(BATCH_SIZE)
        .for('update', { skipLocked: true });

      let delivered = 0;
      for (const message of batch) {
        try {
          if (message.type !== EMAIL_MESSAGE) throw new Error(`Unsupported outbox message type: ${message.type}`);
          const payload = message.payload as unknown as EmailNotification;
          await this.sender.send(renderEmail(payload.to, payload.content));
          // The payload can contain single-use links; drop it once delivered.
          await this.context.db
            .update(outboxMessages)
            .set({
              status: 'sent',
              processedAt: new Date(),
              payload: {},
              attempts: message.attempts + 1,
              lastError: null,
            })
            .where(eq(outboxMessages.id, message.id));
          delivered++;
        } catch (error) {
          const attempts = message.attempts + 1;
          const failed = attempts >= MAX_ATTEMPTS;
          await this.context.db
            .update(outboxMessages)
            .set({
              attempts,
              status: failed ? 'failed' : 'pending',
              payload: failed ? {} : message.payload,
              lastError: error instanceof Error ? error.message.slice(0, 500) : 'unknown error',
              // Exponential backoff: 2, 4, 8, 16 seconds.
              availableAt: new Date(Date.now() + 2 ** attempts * 1000),
            })
            .where(eq(outboxMessages.id, message.id));
          this.logger.warn({ messageId: message.id, attempts, failed }, 'Outbox delivery failed');
        }
      }
      return delivered;
    });
  }
}
