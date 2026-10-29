export type EmailTemplate =
  | { readonly template: 'email-verification'; readonly verificationUrl: string; readonly displayName: string }
  | { readonly template: 'password-reset'; readonly resetUrl: string; readonly displayName: string }
  | { readonly template: 'password-changed'; readonly displayName: string }
  | { readonly template: 'account-exists'; readonly loginUrl: string; readonly resetUrl: string }
  | { readonly template: 'portal-otp'; readonly code: string; readonly minutes: number; readonly patientName: string };

export interface EmailNotification {
  readonly to: string;
  readonly content: EmailTemplate;
}

/**
 * Durable, transactional notification queue (transactional outbox).
 * Enqueued messages are delivered only if the surrounding transaction commits.
 */
export abstract class NotificationQueue {
  abstract enqueueEmail(notification: EmailNotification): Promise<void>;
}
