import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { NotificationQueue } from '../../../../shared/application/ports/notification-queue.js';
import { EmailVerificationTokenRepository } from '../../domain/repositories.js';
import type { User } from '../../domain/user.js';
import { AUTH_SETTINGS, OpaqueTokenGenerator, type AuthSettings } from '../ports.js';

@Injectable()
export class EmailVerificationService {
  constructor(
    private readonly tokens: EmailVerificationTokenRepository,
    private readonly opaqueTokens: OpaqueTokenGenerator,
    private readonly notifications: NotificationQueue,
    @Inject(AUTH_SETTINGS) private readonly settings: AuthSettings,
  ) {}

  /** Replaces any outstanding verification token and queues the email. Must run inside a transaction. */
  async issue(user: User, now: Date): Promise<void> {
    const generated = this.opaqueTokens.generate();
    await this.tokens.invalidateAllForUser(user.id, now);
    await this.tokens.insert({
      id: randomUUID(),
      userId: user.id,
      tokenHash: generated.hash,
      expiresAt: new Date(now.getTime() + this.settings.emailVerificationTokenTtlSeconds * 1000),
      now,
    });
    // The token travels in the URL fragment, which browsers never send to servers or proxies.
    await this.notifications.enqueueEmail({
      to: user.email,
      content: {
        template: 'email-verification',
        displayName: user.displayName,
        verificationUrl: `${this.settings.appPublicUrl}/verify-email#token=${generated.token}`,
      },
    });
  }
}
