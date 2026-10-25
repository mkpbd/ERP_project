/**
 * File types the system accepts for uploads, recognised by their leading
 * bytes rather than the client's Content-Type. SVG and HTML are never
 * accepted: they can carry script.
 */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const DOCUMENT_TYPES = [...IMAGE_TYPES, 'application/pdf'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

export function detectFileType(bytes: Uint8Array): DocumentType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const type = detectFileType(bytes);
  return type !== null && (IMAGE_TYPES as readonly string[]).includes(type) ? (type as ImageType) : null;
}

/** The media type part of a Content-Type header, lower case (`image/png; charset=x` → `image/png`). */
export function mediaType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}
