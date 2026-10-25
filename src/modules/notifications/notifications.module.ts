import { Global, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module.js';
import type { AppConfig } from '../../config/configuration.js';
import { NotificationQueue } from '../../shared/application/ports/notification-queue.js';
import { EmailSender } from './application/email.js';
import { FileEmailSender, InMemoryEmailSender, SmtpEmailSender } from './infrastructure/email-senders.js';
import { OutboxDispatcher, OutboxNotificationQueue } from './infrastructure/outbox.js';

function createEmailSender(config: AppConfig): EmailSender {
  switch (config.mail.transport) {
    case 'smtp':
      if (!config.mail.smtpUrl) throw new Error('SMTP_URL is required for the smtp mail transport');
      return new SmtpEmailSender(config.mail.smtpUrl, config.mail.from);
    case 'file':
      return new FileEmailSender(config.mail.fileDir, config.mail.from);
    case 'memory':
      return new InMemoryEmailSender();
  }
}

@Global()
@Module({
  providers: [
    { provide: EmailSender, inject: [APP_CONFIG], useFactory: createEmailSender },
    { provide: NotificationQueue, useClass: OutboxNotificationQueue },
    OutboxDispatcher,
  ],
  exports: [NotificationQueue],
})
export class NotificationsModule {}
