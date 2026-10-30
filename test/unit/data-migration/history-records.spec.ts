import { describe, expect, it } from 'vitest';
import { plainText, prescriptionText } from '../../../src/cli/data-migration/history-records.js';

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
});
