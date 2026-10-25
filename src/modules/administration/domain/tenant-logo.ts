import { DomainError } from '../../../shared/domain/errors.js';
import { detectImageType, IMAGE_TYPES, mediaType, type ImageType } from '../../../shared/domain/file-types.js';

export const LOGO_SLOTS = ['primary', 'secondary'] as const;
export type LogoSlot = (typeof LOGO_SLOTS)[number];

export const LOGO_CONTENT_TYPES = IMAGE_TYPES;
export type LogoContentType = ImageType;

export const MAX_LOGO_BYTES = 1024 * 1024;

export interface TenantLogo {
  readonly contentType: LogoContentType;
  readonly data: Uint8Array;
}

export { detectImageType };

/** A logo whose bytes really are the declared image type and within the size limit. */
export function validLogo(declaredType: string, data: Uint8Array): TenantLogo {
  if (data.length === 0 || data.length > MAX_LOGO_BYTES) {
    throw new DomainError('invalid_logo', `A logo must be 1 byte to ${MAX_LOGO_BYTES / 1024} KiB`);
  }
  const detected = detectImageType(data);
  if (detected === null || detected !== mediaType(declaredType)) {
    throw new DomainError('invalid_logo', 'The file is not a PNG, JPEG or WebP image of the declared type');
  }
  return { contentType: detected, data };
}
