import { DomainError } from '../../../shared/domain/errors.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30})[a-z0-9]$/;

export class Email {
  private constructor(readonly value: string) {}

  static create(raw: string): Email {
    const normalized = raw.trim().toLowerCase();
    if (normalized.length > 254 || !EMAIL_PATTERN.test(normalized)) {
      throw new DomainError('invalid_email', 'Email address is not valid');
    }
    return new Email(normalized);
  }

  equals(other: Email): boolean {
    return this.value === other.value;
  }
}

export class Username {
  private constructor(readonly value: string) {}

  static create(raw: string): Username {
    const normalized = raw.trim().toLowerCase();
    if (!USERNAME_PATTERN.test(normalized)) {
      throw new DomainError(
        'invalid_username',
        'Username must be 3-32 characters of a-z, 0-9, ".", "_" or "-" and start and end with a letter or digit',
      );
    }
    return new Username(normalized);
  }

  /** Usernames never contain "@", so an identifier with "@" is always an email. */
  static looksLikeEmail(identifier: string): boolean {
    return identifier.includes('@');
  }
}

export class DisplayName {
  private constructor(readonly value: string) {}

  static create(raw: string): DisplayName {
    const normalized = raw.trim().replace(/\s+/g, ' ');
    if (normalized.length < 1 || normalized.length > 100) {
      throw new DomainError('invalid_display_name', 'Display name must be 1-100 characters');
    }
    return new DisplayName(normalized);
  }
}
