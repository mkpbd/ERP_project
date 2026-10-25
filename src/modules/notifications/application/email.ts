import type { EmailTemplate } from '../../../shared/application/ports/notification-queue.js';

export interface RenderedEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export abstract class EmailSender {
  abstract send(email: RenderedEmail): Promise<void>;
}

/** Plain-text rendering keeps templates free of HTML-injection concerns. */
export function renderEmail(to: string, content: EmailTemplate): RenderedEmail {
  switch (content.template) {
    case 'email-verification':
      return {
        to,
        subject: 'Verify your email address',
        text: `Hello ${content.displayName},\n\nConfirm your email address by opening this link:\n${content.verificationUrl}\n\nIf you did not create an account, ignore this message.`,
      };
    case 'password-reset':
      return {
        to,
        subject: 'Reset your password',
        text: `Hello ${content.displayName},\n\nReset your password by opening this link:\n${content.resetUrl}\n\nThe link expires soon and works once. If you did not request a reset, ignore this message; your password is unchanged.`,
      };
    case 'password-changed':
      return {
        to,
        subject: 'Your password was changed',
        text: `Hello ${content.displayName},\n\nYour password was just changed and your other sessions were signed out.\nIf this was not you, reset your password immediately and contact support.`,
      };
    case 'account-exists':
      return {
        to,
        subject: 'Sign-up attempt for your account',
        text: `Someone tried to register with this email address, which already has an account.\n\nSign in: ${content.loginUrl}\nForgot your password? ${content.resetUrl}\n\nIf this was not you, no action is needed.`,
      };
  }
}
