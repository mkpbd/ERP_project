import { describe, expect, it } from 'vitest';
import {
  checkedCulture,
  checkedNarrative,
  type CultureReport,
} from '../../../src/modules/laboratory/domain/culture.js';
import { LabResult } from '../../../src/modules/laboratory/domain/lab.js';

const at = new Date('2026-10-31T06:00:00Z');
const blank: CultureReport = {
  analyzer: null,
  pusCells: ' 8-10 ',
  epithelialCells: null,
  rbc: null,
  microscopyNote: null,
  growth: true,
  growthTypeId: 'g',
  growthType: 'Heavy growth',
  organisms: [
    { organismId: 'o1', name: 'Escherichia coli' },
    { organismId: 'o2', name: 'Klebsiella pneumoniae' },
  ],
  colonyCount: '>10^5 CFU/ml',
  incubation: '48 hours at 37 °C',
  media: 'Blood agar, MacConkey agar',
  message: null,
  sensitivity: [
    { antibioticId: 'a1', antibiotic: 'Ciprofloxacin', zone: '22', results: ['S', 'R'] },
    { antibioticId: 'a2', antibiotic: 'Meropenem', zone: null, results: [null, null] },
  ],
};
const error = (run: () => unknown) => {
  try {
    run();
  } catch (caught) {
    return (caught as { code?: string; message: string }).message;
  }
  return null;
};

describe('a culture report', () => {
  it('keeps one result per organism and leaves untested antibiotics out', () => {
    const culture = checkedCulture(blank);
    expect(culture.pusCells).toBe('8-10');
    expect(culture.sensitivity).toEqual([
      { antibioticId: 'a1', antibiotic: 'Ciprofloxacin', zone: '22', results: ['S', 'R'] },
    ]);
  });

  it('names one to three organisms on a growth, none and no antibiogram on no growth', () => {
    expect(error(() => checkedCulture({ ...blank, organisms: [], sensitivity: [] }))).toMatch(/1 to 3 organisms/);
    expect(
      error(() =>
        checkedCulture({ ...blank, organisms: [blank.organisms[0]!, { organismId: 'x', name: 'escherichia COLI' }] }),
      ),
    ).toMatch(/named twice/);
    expect(error(() => checkedCulture({ ...blank, growth: false }))).toMatch(/No growth has no organisms/);
    expect(checkedCulture({ ...blank, growth: false, organisms: [], sensitivity: [] }).growth).toBe(false);
  });

  it('refuses an antibiotic twice, a result not S, I or R, and results not matching the organisms', () => {
    const row = blank.sensitivity[0]!;
    expect(
      error(() => checkedCulture({ ...blank, sensitivity: [row, { ...row, antibiotic: 'ciprofloxacin' }] })),
    ).toMatch(/twice/);
    expect(error(() => checkedCulture({ ...blank, sensitivity: [{ ...row, results: ['S', 'X' as 'S'] }] }))).toMatch(
      /S, I or R/,
    );
    expect(error(() => checkedCulture({ ...blank, sensitivity: [{ ...row, results: ['S'] }] }))).toMatch(
      /one result per organism/,
    );
  });
});

describe('a written report', () => {
  it('keeps its line breaks and drops trailing spaces', () => {
    expect(checkedNarrative('  GROSS:  \r\nTwo grey-white pieces.\r\n\r\nMICROSCOPY: benign.  ')).toBe(
      'GROSS:\nTwo grey-white pieces.\n\nMICROSCOPY: benign.',
    );
    expect(error(() => checkedNarrative(' \n '))).toMatch(/Write the report/);
  });
});

describe('a result entered in another form', () => {
  it('replaces what was entered before, and is verified as any result', () => {
    const result = LabResult.pending({ id: 'r', sampleId: 's', billId: 'b', line: 1, testId: 't', at });
    result.enterCulture(checkedCulture(blank), null, 'tech', at);
    expect(result.toSnapshot()).toMatchObject({ form: 'culture', narrative: null, status: 'entered' });
    result.enterNarrative('Benign.', 'Seen by two', 'tech', at);
    expect(result.toSnapshot()).toMatchObject({ form: 'descriptive', culture: null, narrative: 'Benign.' });
    result.verify('pathologist', at);
    expect(error(() => result.enterNarrative('Changed', null, 'tech', at))).toMatch(/not entered again/);
  });
});
