import { describe, expect, it } from 'vitest';
import { OpdBill, suggestedVisit } from '../../../src/modules/hospital/domain/opd-bill.js';

const now = new Date('2026-10-26T04:00:00Z');
const bill = (extra: Partial<Parameters<typeof OpdBill.create>[0]> = {}) =>
  OpdBill.create({
    id: 'b',
    number: 'OC-2026-00001',
    patientId: 'p',
    appointmentId: null,
    billedOn: '2026-10-26',
    referredById: null,
    lines: [
      { doctorId: 'nusrat', visitType: 'new', fee: 800, sharePercent: 40 },
      { doctorId: 'kamal', visitType: 'follow_up', fee: 333.33, sharePercent: 33.33 },
    ],
    discount: 0,
    discountReason: null,
    discountLimitPercent: 10,
    mayDiscountMore: false,
    payment: { method: 'cash', reference: null, amount: 500 },
    by: 'cashier',
    now,
    ...extra,
  });

describe('visit suggestion', () => {
  it('is a follow-up within the days after the last visit, else new', () => {
    expect(suggestedVisit(null, '2026-10-26', 30)).toBe('new');
    expect(suggestedVisit('2026-09-26', '2026-10-26', 30)).toBe('follow_up');
    expect(suggestedVisit('2026-09-25', '2026-10-26', 30)).toBe('new');
    expect(suggestedVisit('2026-10-26', '2026-10-26', 0)).toBe('follow_up');
  });
});

describe('OpdBill', () => {
  it("adds up the fees, works out each doctor's share to the paisa and leaves the rest due", () => {
    const created = bill();
    expect(created.lines.map((line) => line.shareAmount)).toEqual([320, 111.1]);
    expect(created.share).toBe(431.1);
    expect(created.toSnapshot()).toMatchObject({ gross: 1133.33, net: 1133.33, paid: 500 });
    expect(created.due).toBe(633.33);
    expect(created.newPayments).toEqual([
      { kind: 'payment', number: null, method: 'cash', reference: null, amount: 500, paidOn: '2026-10-26' },
    ]);
  });

  it('limits the counter discount, needs its reason and never takes more than is due', () => {
    expect(() => bill({ discount: 113.33, discountReason: 'Staff' })).not.toThrow();
    expect(() => bill({ discount: 113.34, discountReason: 'Staff' })).toThrow(
      /above 10 % \(113.33\) needs opd:discount/,
    );
    expect(() => bill({ discount: 500, discountReason: 'Poor patient', mayDiscountMore: true })).not.toThrow();
    expect(() => bill({ discount: 50 })).toThrow(/reason for the discount/);
    expect(() => bill({ discount: 2000, discountReason: 'x', mayDiscountMore: true })).toThrow(/more than the bill/);
    expect(() => bill({ payment: { method: 'card', reference: 'VISA', amount: 1133.34 } })).toThrow(/too much/);
    expect(() => bill({ lines: [] })).toThrow(/1 to 10/);
  });

  it('collects dues up to what is left, not before the bill', () => {
    const created = bill();
    const at = { number: 'OR-2026-00001', method: 'card' as const, reference: null, now };
    expect(() => created.collect({ ...at, amount: 633.34, on: '2026-10-27' })).toThrow(/Only 633.33 is due/);
    expect(() => created.collect({ ...at, amount: 100, on: '2026-10-25' })).toThrow(/before the bill/);
    created.collect({ ...at, amount: 133.33, on: '2026-10-27' });
    expect(created.due).toBe(500);
    expect(created.toSnapshot()).toMatchObject({ collected: 133.33, version: 2 });
  });

  it('is cancelled on its day by the counter, later only by a manager, paying back by how it was paid', () => {
    const created = bill();
    created.collect({
      number: 'OR-2026-00001',
      method: 'card',
      reference: null,
      amount: 133.33,
      on: '2026-10-26',
      now,
    });
    created.paymentsSaved();
    expect(() => created.cancel({ reason: ' ', on: '2026-10-26', by: 'cashier', mayCancelLater: false, now })).toThrow(
      /reason/,
    );
    expect(() =>
      created.cancel({ reason: 'Wrong doctor', on: '2026-10-27', by: 'cashier', mayCancelLater: false, now }),
    ).toThrow(/Only a manager/);
    const { refunds, dueCleared } = created.cancel({
      reason: 'Wrong doctor',
      on: '2026-10-27',
      by: 'manager',
      mayCancelLater: true,
      now,
    });
    expect([...refunds]).toEqual([
      ['cash', 500],
      ['card', 133.33],
    ]);
    expect(dueCleared).toBe(500);
    expect(created.toSnapshot()).toMatchObject({ status: 'cancelled', refunded: 633.33, cancelledOn: '2026-10-27' });
    expect(created.newPayments.map((payment) => [payment.kind, payment.method, payment.amount])).toEqual([
      ['refund', 'cash', 500],
      ['refund', 'card', 133.33],
    ]);
    expect(() =>
      created.collect({ number: 'x', method: 'cash', reference: null, amount: 1, on: '2026-10-27', now }),
    ).toThrow(/cancelled bill/);
  });
});
