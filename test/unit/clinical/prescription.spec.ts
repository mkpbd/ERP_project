import { describe, expect, it } from 'vitest';
import {
  bmi,
  checkedContent,
  checkedTemplate,
  checkedVitals,
  EMPTY_CONTENT,
  Prescription,
  type Vitals,
} from '../../../src/modules/clinical/domain/prescription.js';
import { ageText } from '../../../src/modules/clinical/infrastructure/reports/rx.reports.js';

const at = new Date('2026-10-30T04:00:00Z');
const none: Vitals = {
  weightKg: null,
  heightCm: null,
  bpSystolic: null,
  bpDiastolic: null,
  pulse: null,
  temperatureF: null,
  spo2: null,
};
const napa = { productId: 'p1', name: 'Tab. Napa 500 mg', dose: '1+1+1 after meal', duration: '5 days', qty: 15 };

function open() {
  return Prescription.open({
    id: 'rx',
    number: 'RX-2026-00001',
    patientId: 'p',
    doctorId: 'd',
    appointmentId: null,
    visitNo: 1,
    visitOn: '2026-10-30',
    by: 'assistant',
    at,
  });
}

describe('vitals', () => {
  it('takes plausible values, both pressures with systolic above diastolic', () => {
    expect(checkedVitals({ ...none, bpSystolic: 120, bpDiastolic: 80, spo2: 98 })).toMatchObject({ bpSystolic: 120 });
    expect(() => checkedVitals({ ...none, spo2: 101 })).toThrow(/SpO2 is 40 to 100/);
    expect(() => checkedVitals({ ...none, bpSystolic: 120 })).toThrow(/both blood pressures/);
    expect(() => checkedVitals({ ...none, bpSystolic: 80, bpDiastolic: 90 })).toThrow(/above the diastolic/);
  });

  it('works out the BMI from weight and height', () => {
    expect(bmi({ weightKg: 70, heightCm: 175 })).toBe(22.9);
    expect(bmi({ weightKg: 70, heightCm: null })).toBeNull();
  });
});

describe('what the doctor writes', () => {
  it('trims text, needs a name and dose per medicine and a follow-up after the visit', () => {
    const content = checkedContent(
      {
        ...EMPTY_CONTENT,
        complaints: [{ complaint: ' Fever ', duration: '3 days' }],
        diagnosis: '  ',
        drugs: [napa],
        advices: ['Drink plenty of water'],
      },
      '2026-10-30',
    );
    expect(content).toMatchObject({ complaints: [{ complaint: 'Fever' }], diagnosis: null });
    expect(() => checkedContent({ ...EMPTY_CONTENT, drugs: [{ ...napa, dose: ' ' }] }, '2026-10-30')).toThrow(
      /Give the dose/,
    );
    expect(() => checkedContent({ ...EMPTY_CONTENT, followUpOn: '2026-10-29' }, '2026-10-30')).toThrow(
      /follow-up is after/,
    );
    expect(() =>
      checkedContent(
        {
          ...EMPTY_CONTENT,
          tests: [
            { testId: 't', name: 'CBC', note: null },
            { testId: 't', name: 'CBC', note: 'fasting' },
          ],
        },
        '2026-10-30',
      ),
    ).toThrow(/written twice/);
  });

  it('keeps a template only with something in it', () => {
    expect(() => checkedTemplate({ name: 'Fever', diagnosis: null, drugs: [], tests: [], advices: [] })).toThrow(
      /holds a medicine/,
    );
    expect(checkedTemplate({ name: ' Fever ', diagnosis: null, drugs: [napa], tests: [], advices: [] }).name).toBe(
      'Fever',
    );
  });
});

describe('a prescription', () => {
  it('is signed with something prescribed, then no longer changed', () => {
    const rx = open();
    rx.recordVitals({ ...none, pulse: 88 }, 'assistant', at);
    expect(() => rx.sign('doctor', at)).toThrow(/Write a diagnosis/);
    rx.write({ ...EMPTY_CONTENT, diagnosis: 'Viral fever', drugs: [napa] }, at);
    rx.sign('doctor', at);
    expect(rx.toSnapshot()).toMatchObject({ status: 'signed', pulse: 88, signedBy: 'doctor', version: 4 });
    expect(() => rx.write(EMPTY_CONTENT, at)).toThrow(/is signed/);
    expect(() => rx.recordVitals(none, 'assistant', at)).toThrow(/is signed/);
  });

  it("is reopened on the visit's day only, and once signed is never cancelled", () => {
    const rx = open();
    rx.write({ ...EMPTY_CONTENT, advices: ['Rest'] }, at);
    rx.sign('doctor', at);
    expect(() => rx.reopen('2026-10-31', at)).toThrow(/day of the visit only/);
    rx.reopen('2026-10-30', at);
    expect(rx.status).toBe('draft');
    expect(() => rx.cancel('Left', at)).toThrow(/corrected, not cancelled/);

    const left = open();
    left.cancel('Left before the doctor saw him', at);
    expect(left.toSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'Left before the doctor saw him' });
  });

  it('turns stale versions away', () => {
    expect(() => open().assertVersion(2)).toThrow(expect.objectContaining({ code: 'stale_prescription' }));
  });
});

describe('age on the prescription', () => {
  it('is years from one year, months and days below, days for the newborn', () => {
    expect(ageText('1990-11-15', '2026-10-30')).toBe('35 Y');
    expect(ageText('2026-03-18', '2026-10-30')).toBe('7 M 12 D');
    expect(ageText('2026-10-21', '2026-10-30')).toBe('9 D');
  });
});
