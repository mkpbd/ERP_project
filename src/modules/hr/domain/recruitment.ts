import { DomainError } from '../../../shared/domain/errors.js';
import { detectFileType, DOCX_TYPE, isWordDocument, mediaType } from '../../../shared/domain/file-types.js';

export const MAX_CV_BYTES = 5 * 1024 * 1024;
/** Old JobCvs held one PDF and one Word copy; a few more leave room for a cover letter. */
export const MAX_CV_FILES = 5;
export const CV_TYPES = ['application/pdf', DOCX_TYPE] as const;
export type CvType = (typeof CV_TYPES)[number];

export interface CvFile {
  readonly contentType: CvType;
  readonly data: Uint8Array;
}

/** A CV must be a PDF or a Word .docx whose bytes match the declared Content-Type. */
export function validCvFile(declaredType: string, data: Uint8Array): CvFile {
  if (data.length === 0 || data.length > MAX_CV_BYTES) {
    throw new DomainError('invalid_file', `A CV must be 1 byte to ${MAX_CV_BYTES / 1024 / 1024} MiB`);
  }
  const declared = mediaType(declaredType);
  const detected =
    detectFileType(data) === 'application/pdf' ? 'application/pdf' : isWordDocument(data) ? DOCX_TYPE : null;
  if (detected === null || detected !== declared) {
    throw new DomainError('invalid_file', 'A CV must be a PDF or a Word .docx file and match its Content-Type');
  }
  return { contentType: detected, data };
}
