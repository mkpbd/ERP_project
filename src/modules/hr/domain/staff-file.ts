import { DomainError } from '../../../shared/domain/errors.js';
import { detectFileType, mediaType, type DocumentType } from '../../../shared/domain/file-types.js';

export const MAX_PHOTO_BYTES = 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_CATEGORIES = ['general', 'incharge-appointment'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export interface StoredFile {
  readonly contentType: DocumentType;
  readonly data: Uint8Array;
}

function sniff(declaredType: string, data: Uint8Array, max: number, allowed: readonly DocumentType[], what: string) {
  if (data.length === 0 || data.length > max) {
    throw new DomainError('invalid_file', `${what} must be 1 byte to ${max / 1024 / 1024} MiB`);
  }
  const detected = detectFileType(data);
  if (detected === null || !allowed.includes(detected) || detected !== mediaType(declaredType)) {
    throw new DomainError('invalid_file', `${what} must be ${allowed.join(', ')} and match its Content-Type`);
  }
  return { contentType: detected, data };
}

export function validPhoto(declaredType: string, data: Uint8Array): StoredFile {
  return sniff(declaredType, data, MAX_PHOTO_BYTES, ['image/png', 'image/jpeg', 'image/webp'], 'A photo');
}

export function validDocument(declaredType: string, data: Uint8Array): StoredFile {
  return sniff(
    declaredType,
    data,
    MAX_DOCUMENT_BYTES,
    ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'],
    'A document',
  );
}

/** A file name safe to store and to put in Content-Disposition: no path, no control or quote characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = [...base]
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f && !`"';`.includes(char);
    })
    .join('')
    .trim()
    .slice(0, 150);
  if (cleaned === '' || cleaned === '.' || cleaned === '..') {
    throw new DomainError('invalid_file_name', 'Give the file a name');
  }
  return cleaned;
}
