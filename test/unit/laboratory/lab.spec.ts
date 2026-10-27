import { describe, expect, it } from 'vitest';
import {
  ageInDays,
  checkedTemplate,
  labNumber,
  LabResult,
  LabSample,
  rangeFor,
  resultValues,
  type Parameter,
} from '../../../src/modules/laboratory/domain/lab.js';

const at = new Date('2026-10-28T03:00:00Z');
const hb: Parameter = {
  id: 'hb',
  name: 'Haemoglobin',
  unit: 'g/dL',
  method: null,
  kind: 'numeric',
  decimals: 1,
  ranges: [
    { sex: 'male', minAgeDays: 6570, maxAgeDays: null, low: 13, high: 17, normalText: null },
    { sex: 'female', minAgeDays: 6570, maxAgeDays: null, low: 12, high: 15, normalText: null },
    { sex: null, minAgeDays: 0, maxAgeDays: 6569, low: 11, high: 14, normalText: null },
  ],
};
const hbsag: Parameter = {
  id: 'hbsag',
  name: 'HBsAg',
  unit: null,
  method: 'ICT',
  kind: 'text',
  decimals: 0,
  ranges: [{ sex: null, minAgeDays: 0, maxAgeDays: null, low: null, high: null, normalText: 'Negative' }],
};

describe('lab templates and values', () => {
  it('checks a template: names once, ranges low to high, no numbers on a text result', () => {
    expect(() => checkedTemplate([])).toThrow(expect.objectContaining({ code: 'invalid_parameters' }));
    expect(() => checkedTemplate([{ ...hb }, { ...hb, name: ' haemoglobin ' }])).toThrow(/there already/);
    expect(() => checkedTemplate([{ ...hb, ranges: [{ ...hb.ranges[0]!, low: 18, high: 17 }] }])).toThrow(
      /low is above/,
    );
    expect(() => checkedTemplate([{ ...hbsag, ranges: [{ ...hbsag.ranges[0]!, low: 1 }] }])).toThrow(/text result/);
    expect(checkedTemplate([{ ...hb, unit: '  ' }])[0]).toMatchObject({ name: 'Haemoglobin', unit: null });
  });

  it("takes the range of the patient's sex and age before one for either", () => {
    expect(rangeFor(hb, 'female', 9000)).toMatchObject({ low: 12, high: 15 });
    expect(rangeFor(hb, 'male', 9000)).toMatchObject({ low: 13, high: 17 });
    expect(rangeFor(hb, 'male', 3000)).toMatchObject({ low: 11, high: 14 });
    expect(ageInDays('1990-01-01', '1990-01-31')).toBe(30);
  });

  it('flags numbers outside the range, keeps text, and refuses what is not a number', () => {
    const values = resultValues(
      [hb, hbsag],
      [
        { parameterId: 'hb', value: '10.24' },
        { parameterId: 'hbsag', value: 'Negative' },
      ],
      { sex: 'female', ageDays: 9000 },
    );
    expect(values).toEqual([
      expect.objectContaining({ value: '10.2', numeric: 10.24, low: 12, high: 15, flag: 'low' }),
      expect.objectContaining({ value: 'Negative', numeric: null, normalText: 'Negative', flag: null }),
    ]);
    expect(() => resultValues([hb], [{ parameterId: 'hb', value: 'ten' }], { sex: 'male', ageDays: 9000 })).toThrow(
      /is a number/,
    );
    expect(() => resultValues([hb], [{ parameterId: 'x', value: '1' }], { sex: 'male', ageDays: 9000 })).toThrow(
      /not on the test/,
    );
  });
});

describe('LabSample and LabResult', () => {
  it('numbers samples by the day and takes them in or rejects them once', () => {
    expect(labNumber('2026-10-28', 7)).toBe('LB-261028-0007');
    const sample = LabSample.collect({
      id: 's',
      labNumber: 'LB-261028-0001',
      billId: 'b',
      departmentId: 'd',
      patientId: 'p',
      collectedOn: '2026-10-28',
      collectedAt: at,
      collectedBy: 'nurse',
    });
    sample.receive('tech', at);
    expect(() => sample.receive('tech', at)).toThrow(expect.objectContaining({ code: 'sample_state' }));
    expect(() => sample.reject(' ', at)).toThrow(/reason/);
    sample.reject('Haemolysed', at);
    expect(sample.toSnapshot()).toMatchObject({ status: 'rejected', rejectReason: 'Haemolysed', version: 3 });
  });

  it('is entered, verified by someone else, reopened for a correction and handed over', () => {
    const result = LabResult.pending({ id: 'r', sampleId: 's', billId: 'b', line: 1, testId: 't', at });
    const values = resultValues([hb], [{ parameterId: 'hb', value: '13.5' }], { sex: 'male', ageDays: 9000 });
    expect(() => result.verify('doctor', at)).toThrow(expect.objectContaining({ code: 'result_state' }));
    expect(() => result.enter(resultValues([hb], [], { sex: 'male', ageDays: 9000 }), null, 'tech', at)).toThrow(
      /Enter the result/,
    );
    result.enter(values, 'Repeat advised', 'tech', at);
    expect(() => result.verify('tech', at)).toThrow(expect.objectContaining({ code: 'same_person' }));
    result.verify('doctor', at);
    expect(() => result.enter(values, null, 'tech', at)).toThrow(expect.objectContaining({ code: 'result_state' }));
    expect(() => result.reject(at)).toThrow(/verified result stays/);
    result.unverify(at);
    result.enter(values, null, 'tech', at);
    result.verify('doctor', at);
    expect(() => result.deliver(' ', 'tech', at)).toThrow(/who collected/);
    result.deliver('Patient himself', 'tech', at);
    expect(result.toSnapshot()).toMatchObject({ status: 'delivered', deliveredTo: 'Patient himself', comment: null });
    expect(() => result.unverify(at)).toThrow(expect.objectContaining({ code: 'result_state' }));
  });
});
