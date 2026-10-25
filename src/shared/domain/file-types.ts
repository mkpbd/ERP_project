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

export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

function contains(bytes: Uint8Array, needle: readonly number[]): boolean {
  outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/**
 * A Word .docx: a ZIP holding `[Content_Types].xml` and `word/document.xml` (entry names are
 * stored in plain text). Macro-carrying packages (`vbaProject.bin`) and the old binary .doc are refused.
 */
export function isWordDocument(bytes: Uint8Array): boolean {
  return (
    startsWith(bytes, [0x50, 0x4b, 0x03, 0x04]) &&
    contains(bytes, ascii('[Content_Types].xml')) &&
    contains(bytes, ascii('word/document.xml')) &&
    !contains(bytes, ascii('vbaProject.bin'))
  );
}

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const type = detectFileType(bytes);
  return type !== null && (IMAGE_TYPES as readonly string[]).includes(type) ? (type as ImageType) : null;
}

/** The media type part of a Content-Type header, lower case (`image/png; charset=x` → `image/png`). */
export function mediaType(contentType: string): string {
  return contentType.split(';')[0]!.trim().toLowerCase();
}
