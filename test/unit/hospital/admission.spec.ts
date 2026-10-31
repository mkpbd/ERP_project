import { describe, expect, it } from 'vitest';
import { Admission } from '../../../src/modules/hospital/domain/admission.js';

const at = (hour: number) => new Date(Date.UTC(2026, 9, 27, hour));
const admit = () =>
  Admission.admit({
    id: 'a',
    number: 'IP-2026-00001',
    patientId: 'p',
    kind: 'emergency',
    reason: '  Chest pain ',
    referredById: null,
    corporateClientId: null,
    staffId: null,
    admissionFee: 500,
    bed: { id: 'w1', dailyRate: 1200 },
    doctorId: 'nusrat',
    additionalDoctorIds: ['kamal'],
    by: 'officer',
    at: at(2),
  });

describe('Admission', () => {
  it('is admitted to a bed under a consultant, with the doctors who also see the patient', () => {
    const admission = admit();
    expect(admission.currentBedId).toBe('w1');
    expect(admission.primaryDoctorId).toBe('nusrat');
    expect(admission.toSnapshot()).toMatchObject({
      reason: 'Chest pain',
      status: 'admitted',
      stays: [{ bedId: 'w1', fromAt: at(2), toAt: null, dailyRate: 1200 }],
      doctors: [
        { doctorId: 'nusrat', role: 'primary', toAt: null },
        { doctorId: 'kamal', role: 'additional', toAt: null },
      ],
    });
  });

  it('moves between beds with a reason, keeping each stay from when to when at its rate', () => {
    const admission = admit();
    expect(() => admission.transfer({ id: 'icu1', dailyRate: 6000 }, ' ', 'officer', at(5))).toThrow(/reason/);
    expect(() => admission.transfer({ id: 'w1', dailyRate: 1200 }, 'Worse', 'officer', at(5))).toThrow(/already/);
    expect(admission.transfer({ id: 'icu1', dailyRate: 6000 }, 'Needs ventilation', 'officer', at(5))).toBe('w1');
    expect(admission.toSnapshot().stays.map((stay) => [stay.bedId, stay.toAt, stay.dailyRate])).toEqual([
      ['w1', at(5), 1200],
      ['icu1', null, 6000],
    ]);
    expect(admission.currentBedId).toBe('icu1');
  });

  it('changes the consultant and the additional doctors with their history', () => {
    const admission = admit();
    expect(() => admission.changeConsultant('nusrat', at(3))).toThrow(/consultant already/);
    // Kamal takes over: his additional row closes, a primary row opens.
    admission.changeConsultant('kamal', at(3));
    expect(admission.primaryDoctorId).toBe('kamal');
    expect(() => admission.setAdditional(['kamal'], at(4))).toThrow(/not also an additional/);
    admission.setAdditional(['nusrat', 'rahim'], at(4));
    const open = admission.toSnapshot().doctors.filter((doctor) => doctor.toAt === null);
    expect(open.map((doctor) => [doctor.doctorId, doctor.role])).toEqual([
      ['kamal', 'primary'],
      ['nusrat', 'additional'],
      ['rahim', 'additional'],
    ]);
    expect(admission.toSnapshot().doctors).toHaveLength(5);
  });

  it('is discharged (a note for all but normal) or cancelled, then changes no more', () => {
    const admission = admit();
    expect(() => admission.discharge({ type: 'lama', note: null, by: 'officer', at: at(9) })).toThrow(/Say why/);
    expect(admission.discharge({ type: 'lama', note: 'Family took him home', by: 'officer', at: at(9) })).toBe('w1');
    expect(admission.toSnapshot()).toMatchObject({
      status: 'discharged',
      dischargeType: 'lama',
      dischargedAt: at(9),
      closedBy: 'officer',
    });
    expect(admission.toSnapshot().stays.every((stay) => stay.toAt !== null)).toBe(true);
    expect(admission.toSnapshot().doctors.every((doctor) => doctor.toAt !== null)).toBe(true);
    expect(() => admission.transfer({ id: 'w2', dailyRate: 1 }, 'x', 'officer', at(10))).toThrow(
      /discharged admission/,
    );
    const mistaken = admit();
    expect(() => mistaken.cancel(' ', 'manager', at(3))).toThrow(/reason/);
    mistaken.cancel('Wrong patient', 'manager', at(3));
    expect(mistaken.toSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'Wrong patient' });
    expect(() => mistaken.assertVersion(1)).toThrow(/changed by someone else/);
  });

  it('is put right while the patient is in: what changed is told, a client and staff are not both payers', () => {
    const admission = admit();
    const same = {
      kind: 'emergency' as const,
      reason: 'Chest pain',
      referredById: null,
      corporateClientId: null,
      staffId: null,
    };
    expect(() => admission.correct(same, at(3))).toThrow(/Nothing was changed/);
    expect(() => admission.correct({ ...same, corporateClientId: 'acme', staffId: 's' }, at(3))).toThrow(/not both/);
    expect(admission.payerDiffers({ corporateClientId: 'acme', staffId: null })).toBe(true);
    expect(admission.correct({ ...same, kind: 'elective', referredById: 'dr-x' }, at(3))).toEqual([
      'kind',
      'referredById',
    ]);
    admission.discharge({ type: 'normal', note: null, by: 'officer', at: at(9) });
    expect(() => admission.correct(same, at(10))).toThrow(/discharged admission cannot be corrected/);
  });

  it('is reopened after a discharge into a bed from now, under the consultant it had', () => {
    const admission = admit();
    expect(() => admission.reopen({ id: 'w1', dailyRate: 1200 }, 'Mistake', 'manager', at(4))).toThrow(
      /admitted admission is not reopened/,
    );
    admission.discharge({ type: 'lama', note: 'Left', by: 'officer', at: at(9) });
    expect(() => admission.reopen({ id: 'w1', dailyRate: 1200 }, ' ', 'manager', at(10))).toThrow(/reason/);
    admission.reopen({ id: 'w3', dailyRate: 900 }, 'Wrong patient discharged', 'manager', at(10));
    const snapshot = admission.toSnapshot();
    expect(snapshot).toMatchObject({
      status: 'admitted',
      dischargedAt: null,
      dischargeType: null,
      dischargeNote: null,
    });
    expect(admission.currentBedId).toBe('w3');
    expect(snapshot.stays.at(-1)).toMatchObject({ fromAt: at(10), reason: 'Reopened: Wrong patient discharged' });
    // The time out of hospital is no stay.
    expect(snapshot.stays.at(-2)?.toAt).toEqual(at(9));
    expect(admission.primaryDoctorId).toBe('nusrat');
  });
});
