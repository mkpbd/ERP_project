/** Digits in a code. */
export const OTP_DIGITS = 6;
/** Minutes a code is good for. */
export const OTP_MINUTES = 5;
/** Wrong codes allowed on one challenge. */
export const OTP_ATTEMPTS = 5;
/** Seconds before another code is sent to the same patient. */
export const OTP_RESEND_SECONDS = 60;
/** Codes sent to a patient in an hour at most. */
export const OTP_PER_HOUR = 5;
/** Wrong codes in this many minutes lock the patient out of new codes for as long. */
export const LOCKOUT_MINUTES = 15;
export const LOCKOUT_FAILURES = 10;
/** Minutes a portal sign-in lasts (no refresh). */
export const SESSION_MINUTES = 30;

/** A Bangladeshi mobile as 11 digits (01XXXXXXXXX), from +880 / 880 / spaced forms; null when it is not one. */
export function normalizeMobile(value: string): string | null {
  const digits = value.replace(/[\s()-]/g, '').replace(/^\+?880/, '0');
  return /^01[3-9]\d{8}$/.test(digits) ? digits : null;
}

export function normalizeEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

/** 017*****000 or a***@example.com: enough to recognise, not to read. */
export function mask(contact: string): string {
  const mobile = normalizeMobile(contact);
  if (mobile) return `${mobile.slice(0, 3)}*****${mobile.slice(-3)}`;
  const [name = '', domain = ''] = contact.trim().split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

export type Channel = 'sms' | 'email';

/**
 * Where a code goes: the contact given, when it is the patient's mobile (or their contact's) or their email. Null when
 * it is neither — the caller answers the same way, so a stranger learns nothing.
 */
export function channelFor(
  contact: string,
  patient: { mobiles: readonly string[]; email: string | null },
): { channel: Channel; to: string } | null {
  const mobile = normalizeMobile(contact);
  if (mobile && patient.mobiles.some((entry) => normalizeMobile(entry) === mobile)) {
    return { channel: 'sms', to: mobile };
  }
  const email = normalizeEmail(contact);
  if (email && patient.email && normalizeEmail(patient.email) === email) return { channel: 'email', to: email };
  return null;
}
