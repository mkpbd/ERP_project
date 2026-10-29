import { describe, expect, it } from 'vitest';
import {
  addDays,
  assertMayDonate,
  BloodRequest,
  BloodUnit,
  compatible,
  Donation,
} from '../../../src/modules/blood-bank/domain/blood.js';

const at = new Date('2026-10-30T03:00:00Z');
const clear = {
  hiv: 'negative',
  hbsag: 'negative',
  hcv: 'negative',
  syphilis: 'negative',
  malaria: 'negative',
} as const;

function donation(group: 'A+' | 'O-' = 'A+') {
  return Donation.collect({
    id: 'd1',
    bagNumber: 'BB-26-0001',
    donorId: 'donor',
    donatedOn: '2026-10-30',
    bloodGroup: group,
    volumeMl: 450,
    by: 'u1',
    at,
  });
}

function unit(given = donation(), shelfDays = 35) {
  return BloodUnit.prepare({
    id: 'u1',
    unitNumber: 'BB-26-0001/PC',
    donation: given,
    componentTypeId: 'pc',
    shelfDays,
    on: '2026-10-30',
    at,
  });
}

describe('blood compatibility', () => {
  it('gives red cells by the patient: O to all, AB takes all, Rh-negative patients only Rh-negative cells', () => {
    expect(compatible('O-', 'AB+', 'red_cells')).toBe(true);
    expect(compatible('O+', 'A+', 'red_cells')).toBe(true);
    expect(compatible('A+', 'AB+', 'red_cells')).toBe(true);
    expect(compatible('A+', 'B+', 'red_cells')).toBe(false);
    expect(compatible('AB+', 'O+', 'red_cells')).toBe(false);
    expect(compatible('O+', 'O-', 'red_cells')).toBe(false);
    expect(compatible('A-', 'A+', 'red_cells')).toBe(true);
  });

  it('gives plasma the other way round, and anything for components that need no match', () => {
    expect(compatible('AB+', 'O+', 'plasma')).toBe(true);
    expect(compatible('A+', 'O-', 'plasma')).toBe(true);
    expect(compatible('O+', 'A+', 'plasma')).toBe(false);
    expect(compatible('B+', 'A+', 'any')).toBe(true);
  });
});

describe('donors and donations', () => {
  it('lets a donor give when active and no longer deferred', () => {
    const donor = { isActive: true, deferredUntil: '2027-01-28', deferReason: null };
    expect(() => assertMayDonate(donor, '2026-12-01')).toThrow(/from 2027-01-28/);
    expect(() => assertMayDonate(donor, '2027-01-28')).not.toThrow();
    expect(() => assertMayDonate({ ...donor, isActive: false }, '2027-02-01')).toThrow(/not active/);
  });

  it('takes 50 to 600 ml', () => {
    expect(() =>
      Donation.collect({
        id: 'd',
        bagNumber: 'b',
        donorId: 'x',
        donatedOn: '2026-10-30',
        bloodGroup: 'A+',
        volumeMl: 700,
        by: 'u',
        at,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_volume' }));
  });

  it('is screened once; a reactive screen throws it away', () => {
    const clean = donation();
    expect(clean.screen(clear, 'u2', at)).toEqual([]);
    expect(clean.status).toBe('screened');
    expect(() => clean.screen(clear, 'u2', at)).toThrow(/not screened again/);

    const reactive = donation();
    expect(reactive.screen({ ...clear, hbsag: 'positive', malaria: 'positive' }, 'u2', at)).toEqual([
      'hbsag',
      'malaria',
    ]);
    expect(reactive.status).toBe('discarded');
    expect(reactive.toSnapshot().discardReason).toBe('Reactive: hbsag, malaria');
    expect(() => unit(reactive)).toThrow(/not split/);
  });
});

describe('blood units', () => {
  it('waits in quarantine until the donation is screened clear, and keeps from the day of donation', () => {
    const fresh = unit();
    expect(fresh.status).toBe('quarantine');
    expect(fresh.toSnapshot().expiresOn).toBe(addDays('2026-10-30', 35));
    expect(() => fresh.reserve('r1', '2026-10-30', at)).toThrow(/is quarantine/);
    fresh.release(at);
    expect(fresh.status).toBe('available');

    const screened = donation();
    screened.screen(clear, 'u2', at);
    expect(unit(screened).status).toBe('available');
  });

  it('is kept for one request and given only to it, never out of date', () => {
    const screened = donation();
    screened.screen(clear, 'u2', at);
    const kept = unit(screened, 5);
    expect(() => kept.issue('r1', '2026-10-31', at)).toThrow(/not cross-matched/);
    kept.reserve('r1', '2026-10-31', at);
    expect(() => kept.issue('r2', '2026-10-31', at)).toThrow(/not cross-matched/);
    expect(() => kept.issue('r1', '2026-11-05', at)).toThrow(/expired on 2026-11-04/);
    kept.issue('r1', '2026-11-04', at);
    expect(kept.status).toBe('issued');
    expect(() => kept.discard('broken', at)).toThrow(/issued unit/);
  });

  it('goes back to the stock when the request is cancelled; discarding needs a reason', () => {
    const screened = donation();
    screened.screen(clear, 'u2', at);
    const kept = unit(screened);
    kept.reserve('r1', '2026-10-30', at);
    kept.unreserve(at);
    expect(kept.status).toBe('available');
    expect(kept.requestId).toBeNull();
    expect(() => kept.discard('  ', at)).toThrow(/Give a reason/);
    kept.discard('Bag leaked', at);
    expect(kept.status).toBe('discarded');
  });
});

describe('blood requests', () => {
  const base = {
    id: 'r1',
    number: 'BR-26-0001',
    patientId: 'p1',
    componentTypeId: 'pc',
    bloodGroup: 'B+' as const,
    requestedOn: '2026-10-30',
    requestedBy: 'u1',
    reason: null,
    at,
  };

  it('is for a stay or on a diagnostic bill, never both or neither', () => {
    expect(() => BloodRequest.open({ ...base, admissionId: null, billId: null, units: 1 })).toThrow(/stay or on/);
    expect(() => BloodRequest.open({ ...base, admissionId: 'a', billId: 'b', units: 1 })).toThrow(/stay or on/);
    expect(() => BloodRequest.open({ ...base, admissionId: 'a', billId: null, units: 0 })).toThrow(/1 to 20/);
  });

  it('is fulfilled when every unit is given, and then not cancelled', () => {
    const request = BloodRequest.open({ ...base, admissionId: 'a', billId: null, units: 2 });
    request.issued(1, at);
    expect(request.status).toBe('open');
    request.issued(2, at);
    expect(request.status).toBe('fulfilled');
    expect(() => request.cancel(at)).toThrow(/is fulfilled/);
  });
});
