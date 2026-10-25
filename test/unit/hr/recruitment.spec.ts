import { describe, expect, it } from 'vitest';
import { MAX_CV_BYTES, validCvFile } from '../../../src/modules/hr/domain/recruitment.js';
import { DOCX_TYPE, isWordDocument } from '../../../src/shared/domain/file-types.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const zip = (...names: string[]) =>
  new Uint8Array(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), ...names.map((name) => Buffer.from(name))]));
const docx = zip('[Content_Types].xml', '_rels/.rels', 'word/document.xml');
const pdf = new Uint8Array(Buffer.from('%PDF-1.7\n%âãÏÓ\n'));

describe('CV files', () => {
  it('recognises a Word .docx by its package entries', () => {
    expect(isWordDocument(docx)).toBe(true);
    expect(isWordDocument(zip('[Content_Types].xml', 'xl/workbook.xml'))).toBe(false);
    expect(isWordDocument(zip('[Content_Types].xml', 'word/document.xml', 'word/vbaProject.bin'))).toBe(false);
    // Old binary .doc (OLE compound file) is refused.
    expect(isWordDocument(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(false);
  });

  it('accepts PDF and .docx whose bytes match the declared type', () => {
    expect(validCvFile('application/pdf', pdf).contentType).toBe('application/pdf');
    expect(validCvFile(`${DOCX_TYPE}; charset=binary`, docx).contentType).toBe(DOCX_TYPE);
    expect(() => validCvFile('application/pdf', docx)).toThrow(/match its Content-Type/);
    expect(() => validCvFile('image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toThrow(
      DomainError,
    );
    expect(() => validCvFile('application/pdf', new Uint8Array(0))).toThrow(/1 byte to 5 MiB/);
    expect(() => validCvFile('application/pdf', new Uint8Array(MAX_CV_BYTES + 1))).toThrow(/1 byte to 5 MiB/);
  });
});
