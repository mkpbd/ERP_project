import { checkedUpload, type StoredFile } from '../../../shared/domain/uploads.js';

export { MAX_DOCUMENT_BYTES, safeFileName, validDocument, type StoredFile } from '../../../shared/domain/uploads.js';

export const MAX_PHOTO_BYTES = 1024 * 1024;
export const DOCUMENT_CATEGORIES = ['general', 'incharge-appointment'] as const;
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export function validPhoto(declaredType: string, data: Uint8Array): StoredFile {
  return checkedUpload(declaredType, data, MAX_PHOTO_BYTES, ['image/png', 'image/jpeg', 'image/webp'], 'A photo');
}
