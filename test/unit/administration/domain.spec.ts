import { describe, expect, it } from 'vitest';
import {
  effectiveSettings,
  GENERAL_SETTINGS_DEFAULTS,
} from '../../../src/modules/administration/application/settings.js';
import { detectImageType, MAX_LOGO_BYTES, validLogo } from '../../../src/modules/administration/domain/tenant-logo.js';
import { DomainError } from '../../../src/shared/domain/errors.js';

const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

describe('tenant logos', () => {
  it('detects PNG, JPEG and WebP by their bytes', () => {
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(jpeg)).toBe('image/jpeg');
    expect(detectImageType(webp)).toBe('image/webp');
    expect(detectImageType(svg)).toBeNull();
  });

  it('accepts a logo only when the bytes match the declared type', () => {
    expect(validLogo('image/png; charset=binary', png).contentType).toBe('image/png');
    expect(() => validLogo('image/jpeg', png)).toThrow(DomainError);
    expect(() => validLogo('image/svg+xml', svg)).toThrow(/not a PNG, JPEG or WebP/);
  });

  it('enforces the size limit', () => {
    expect(() => validLogo('image/png', new Uint8Array(0))).toThrow(DomainError);
    const tooBig = new Uint8Array(MAX_LOGO_BYTES + 1);
    tooBig.set(png);
    expect(() => validLogo('image/png', tooBig)).toThrow(/KiB/);
  });
});

describe('settings documents', () => {
  it('overlays stored values on the defaults and drops unknown fields', () => {
    const effective = effectiveSettings('general', { visitingCardRate: 50, retiredField: true });
    expect(effective).toEqual({ ...GENERAL_SETTINGS_DEFAULTS, visitingCardRate: 50 });
  });

  it('returns the defaults when nothing was saved', () => {
    expect(effectiveSettings('editor-margins', null)).toEqual({ left: '', right: '', top: '', bottom: '' });
    expect(() => effectiveSettings('nope', null)).toThrow(/Unknown settings/);
  });
});
