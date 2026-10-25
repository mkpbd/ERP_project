import { DomainError } from '../../../shared/domain/errors.js';

export const LOGO_SLOTS = ['primary', 'secondary'] as const;
export type LogoSlot = (typeof LOGO_SLOTS)[number];

export const LOGO_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type LogoContentType = (typeof LOGO_CONTENT_TYPES)[number];

export const MAX_LOGO_BYTES = 1024 * 1024;

export interface TenantLogo {
  readonly contentType: LogoContentType;
  readonly data: Uint8Array;
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

/** Identifies the image format from its leading bytes. SVG is deliberately not accepted (it can carry script). */
export function detectImageType(bytes: Uint8Array): LogoContentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  return null;
}

/** A logo whose bytes really are the declared image type and within the size limit. */
export function validLogo(declaredType: string, data: Uint8Array): TenantLogo {
  if (data.length === 0 || data.length > MAX_LOGO_BYTES) {
    throw new DomainError('invalid_logo', `A logo must be 1 byte to ${MAX_LOGO_BYTES / 1024} KiB`);
  }
  const detected = detectImageType(data);
  if (detected === null || detected !== declaredType.split(';')[0]!.trim().toLowerCase()) {
    throw new DomainError('invalid_logo', 'The file is not a PNG, JPEG or WebP image of the declared type');
  }
  return { contentType: detected, data };
}
