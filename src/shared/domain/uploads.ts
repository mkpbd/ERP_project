import { DomainError } from './errors.js';
import { detectFileType, mediaType, type DocumentType } from './file-types.js';

export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

export interface StoredFile {
  readonly contentType: DocumentType;
  readonly data: Uint8Array;
}

/** Checks an upload's size and that its bytes are one of the allowed types and match the declared Content-Type. */
export function checkedUpload(
  declaredType: string,
  data: Uint8Array,
  max: number,
  allowed: readonly DocumentType[],
  what: string,
): StoredFile {
  if (data.length === 0 || data.length > max) {
    throw new DomainError('invalid_file', `${what} must be 1 byte to ${max / 1024 / 1024} MiB`);
  }
  const detected = detectFileType(data);
  if (detected === null || !allowed.includes(detected) || detected !== mediaType(declaredType)) {
    throw new DomainError('invalid_file', `${what} must be ${allowed.join(', ')} and match its Content-Type`);
  }
  return { contentType: detected, data };
}

/** A PDF or image up to 5 MiB (supporting documents). */
export function validDocument(declaredType: string, data: Uint8Array): StoredFile {
  return checkedUpload(
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
