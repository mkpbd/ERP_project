import { describe, expect, it } from 'vitest';
import {
  cultureText,
  plainText,
  prescriptionText,
  sensitivity,
  sheetText,
} from '../../../src/cli/data-migration/history-records.js';

describe('old clinical records', () => {
  it('reads the old editors’ HTML as text', () => {
    expect(plainText('<p><b>Impression:</b>&nbsp;Normal study</p><p>No&nbsp;&nbsp;effusion &amp; no mass.</p>')).toBe(
      'Impression: Normal study\nNo effusion & no mass.',
    );
    expect(plainText('<ul><li>One</li><li>Two</li></ul><br><br><br><div>Three &#176;C &#x3bc;g</div>')).toBe(
      '• One\n• Two\n\nThree °C μg',
    );
    expect(plainText('<table><tr><td>Hb</td><td>11</td></tr></table>')).toBe('Hb\t11');
    expect(plainText('<style>p{color:red}</style>Plain text, kept')).toBe('Plain text, kept');
    expect([plainText(null), plainText(42)]).toEqual(['', '']);
  });

  it('writes an old Rx visit out as the prescription read', () => {
    expect(
      prescriptionText({
        complaints: [{ complaint: 'Cough', duration: null }],
        impressions: [],
        drugs: [
          { name: 'Napa', dosage: '1+1+1', duration: null },
          { name: 'Fexo', dosage: null, duration: '7 days' },
        ],
        tests: [],
        advice: [],
        notes: 'Review with X-ray',
        followUpOn: null,
      }),
    ).toBe('Complaints:\n  Cough\n\nRx:\n  1. Napa — 1+1+1\n  2. Fexo — 7 days\n\nNotes: Review with X-ray');
  });

  it('writes out a culture: no growth, or what grew and how it was grown', () => {
    expect(
      cultureText(
        {
          growthType: 'No growth',
          organisms: [null, null, null],
          message: 'after 48 hours',
          colonyCount: null,
          incubation: ' ',
          media: null,
        },
        null,
      ),
    ).toBe('Culture: No growth\nafter 48 hours');
    expect(
      cultureText(null, { analyzer: null, pusCells: '2-3', epithelialCells: 'Few', rbc: null, note: 'Clear' }),
    ).toBe('Microscopy: Pus cells 2-3 · Epithelial cells Few\nClear');
    expect(cultureText(null, null)).toBe('');
  });

  it('reads a sensitivity row against the organisms isolated', () => {
    expect(sensitivity('Amikacin', '18', ['S', null, 'R'], ['E. coli', null, 'Proteus'])).toEqual({
      test: 'Amikacin',
      result: 'E. coli: S · Proteus: R',
      unit: null,
      reference: 'Zone 18',
    });
    expect(sensitivity('Amikacin', null, ['S'], [null])).toMatchObject({ result: 'S', reference: null });
    expect(sensitivity('Amikacin', '18', [null, ' '], ['E. coli'])).toBeNull();
    expect(sensitivity(null, null, ['S'], ['E. coli'])).toBeNull();
  });

  it('writes out a handover sheet form, or reads it as text when it is not JSON', () => {
    expect(sheetText('{"pulse":88,"lines":[{"site":"Left arm"}],"catheter":false,"note":""}')).toBe(
      'Pulse: 88\nLines 1 › Site: Left arm',
    );
    expect(sheetText('<p>Stable night</p>')).toBe('Stable night');
    expect(sheetText(null)).toBe('');
  });
});
