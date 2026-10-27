import { describe, expect, it } from 'vitest';
import { accessionNumber, checkedTemplates, ImagingStudy } from '../../../src/modules/laboratory/domain/imaging.js';

const at = new Date('2026-10-28T05:00:00Z');
const study = () =>
  ImagingStudy.done({
    id: 's',
    accessionNumber: accessionNumber('2026-10-28', 3),
    billId: 'b',
    line: 1,
    testId: 'xray',
    patientId: 'p',
    doneOn: '2026-10-28',
    by: 'tech',
    at,
  });

describe('imaging templates', () => {
  it('needs a name, findings and impression, each name once', () => {
    expect(checkedTemplates([{ name: ' Normal chest ', findings: 'Clear lungs.', impression: 'Normal.' }])).toEqual([
      { name: 'Normal chest', findings: 'Clear lungs.', impression: 'Normal.' },
    ]);
    expect(() => checkedTemplates([{ name: 'Normal', findings: ' ', impression: 'Normal.' }])).toThrow(
      expect.objectContaining({ code: 'invalid_templates' }),
    );
    expect(() =>
      checkedTemplates([
        { name: 'Normal', findings: 'a', impression: 'b' },
        { name: 'normal', findings: 'c', impression: 'd' },
      ]),
    ).toThrow(/there already/);
  });
});

describe('ImagingStudy', () => {
  it('is written, signed with the fee kept, reopened for a correction and handed over', () => {
    const done = study();
    expect(done.accessionNumber).toBe('AC-261028-0003');
    expect(() => done.sign('doctor', at)).toThrow(expect.objectContaining({ code: 'report_incomplete' }));
    done.write({ findings: ' Clear lungs. ', impression: 'Normal chest.', radiologistId: 'rad', at });
    done.sign('doctor', at);
    done.feeCredited(150);
    expect(done.toSnapshot()).toMatchObject({ status: 'signed', findings: 'Clear lungs.', reportingFee: 150 });
    expect(() => done.write({ findings: 'x', impression: 'y', radiologistId: 'rad', at })).toThrow(
      expect.objectContaining({ code: 'study_state' }),
    );
    expect(done.unsign(at)).toBe(150);
    expect(done.toSnapshot()).toMatchObject({ status: 'done', reportingFee: 0, signedBy: null });
    expect(() => done.deliver('Patient', 'tech', at)).toThrow(expect.objectContaining({ code: 'study_state' }));
    done.sign('doctor', at);
    expect(() => done.deliver(' ', 'tech', at)).toThrow(/who collected/);
    done.deliver('Patient', 'tech', at);
    expect(() => done.unsign(at)).toThrow(expect.objectContaining({ code: 'study_state' }));
    expect(() => done.assertVersion(1)).toThrow(expect.objectContaining({ code: 'stale_study' }));
  });
});
