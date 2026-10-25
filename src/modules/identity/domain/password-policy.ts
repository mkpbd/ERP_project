import { DomainError } from '../../../shared/domain/errors.js';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/**
 * Length-based policy in line with NIST SP 800-63B: no composition rules,
 * but long minimum length and rejection of passwords that echo the account.
 */
export function assertAcceptablePassword(password: string, context: { email: string; username?: string | null }): void {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    throw new DomainError(
      'weak_password',
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters`,
    );
  }
  const lowered = password.toLowerCase();
  const localPart = context.email.split('@')[0] ?? '';
  const echoes = [context.email, localPart, context.username ?? ''].filter((value) => value.length >= 4);
  if (echoes.some((value) => lowered.includes(value.toLowerCase()))) {
    throw new DomainError('weak_password', 'Password must not contain your email address or username');
  }
  if (new Set(password).size < 4) {
    throw new DomainError('weak_password', 'Password is too repetitive');
  }
}
