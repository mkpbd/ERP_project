import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, discountPercent, lineDiscount } from '../../../src/modules/pharmacy/domain/discount.js';
import { receivableRole } from '../../../src/modules/pharmacy/application/sale.handlers.js';
import { allocateCollection, PharmacySale, type SalePart } from '../../../src/modules/pharmacy/domain/sale.js';

const now = new Date('2026-04-10T08:00:00Z');

describe('discount rules', () => {
  const policy = { allowedByDefault: true, opdPercent: 5, ipdPercent: 3 };

  it('takes the product rule, else the policy, and indoor follows over the counter unless set', () => {
    expect(discountPercent(policy, null, 'opd')).toBe(5);
    expect(discountPercent(policy, null, 'ipd')).toBe(3);
    expect(discountPercent({ ...policy, ipdPercent: null }, null, 'ipd')).toBe(5);
    expect(discountPercent(policy, { isAllowed: false, opdPercent: 10, ipdPercent: null }, 'opd')).toBe(0);
    expect(discountPercent(policy, { isAllowed: true, opdPercent: 10, ipdPercent: null }, 'ipd')).toBe(10);
    expect(discountPercent(policy, { isAllowed: true, opdPercent: null, ipdPercent: null }, 'ipd')).toBe(3);
    expect(discountPercent(policy, { isAllowed: true, opdPercent: 10, ipdPercent: 2 }, 'ipd')).toBe(2);
    expect(discountPercent({ ...policy, allowedByDefault: false }, null, 'opd')).toBe(0);
    expect(DEFAULT_POLICY.opdPercent).toBe(5);
  });

  it('rounds each line to the paisa, half away from zero', () => {
    expect(lineDiscount(72, 5)).toBe(3.6);
    expect(lineDiscount(0.5, 5)).toBe(0.03);
    expect(lineDiscount(10.1, 2.5)).toBe(0.25);
  });
});

describe('PharmacySale', () => {
  const parts: SalePart[] = [
    { productId: 'napa', lotId: 'b', qty: 60, saleRate: 1.2, unitCost: 0.85, discountPercent: 5 },
    { productId: 'seclo', lotId: 's', qty: 2, saleRate: 6, unitCost: 4, discountPercent: 0 },
  ];
  const make = (extra: Partial<Parameters<typeof PharmacySale.make>[0]> = {}) =>
    PharmacySale.make({
      id: 'x',
      number: 'SI-2026-00001',
      outletId: 'o',
      soldOn: '2026-04-10',
      customerName: null,
      mobileNo: null,
      loyalMemberId: null,
      parts,
      method: 'cash',
      reference: null,
      tendered: 100,
      soldBy: 'u',
      now,
      ...extra,
    });

  it('totals the lines, gives change for cash and keeps the cost', () => {
    const sale = make();
    expect([sale.total, sale.paid, sale.change, sale.due, sale.cost]).toEqual([80.4, 80.4, 19.6, 0, 59]);
    expect(sale.lines.map((line) => [line.amount, line.discount, line.total])).toEqual([
      [72, 3.6, 68.4],
      [12, 0, 12],
    ]);
  });

  it('leaves a due only for one debtor and takes no card payment above the total', () => {
    expect(() => make({ tendered: 50 })).toThrow(/Only a loyal member, a company on credit or a staff member/);
    expect(make({ tendered: 50, loyalMemberId: 'm' }).due).toBe(30.4);
    expect(make({ tendered: 0, corporateClientId: 'c' }).debtor).toEqual({ kind: 'corporate', id: 'c' });
    expect(make({ tendered: 0, staffId: 's' }).debtor).toEqual({ kind: 'staff', id: 's' });
    expect(make({ corporateClientId: 'c' }).due).toBe(0);
    expect(make().debtor).toBeNull();
    expect(() => make({ tendered: 0, loyalMemberId: 'm', staffId: 's' })).toThrow(/owed by one/);
    expect(() => make({ corporateClientId: 'c', staffId: 's' })).toThrow(/owed by one/);
    expect(() => make({ method: 'card' })).toThrow(/Only cash/);
    expect(() => make({ parts: [] })).toThrow(/sells something/);
  });

  it('lets the seller undo only their own sale, dated its own day, within a day', () => {
    const sale = make();
    expect(sale.isOwnSameDay('u', '2026-04-10', new Date('2026-04-11T07:59:00Z'))).toBe(true);
    expect(sale.isOwnSameDay('u', '2026-04-10', new Date('2026-04-11T08:01:00Z'))).toBe(false);
    expect(sale.isOwnSameDay('u', '2026-04-11', now)).toBe(false);
    expect(sale.isOwnSameDay('someone else', '2026-04-10', now)).toBe(false);
    expect([sale.amount, sale.discount]).toEqual([84, 3.6]);
  });

  it('is cancelled once, with a reason, not before it was made', () => {
    const sale = make();
    expect(() => sale.cancel({ reason: ' ', on: '2026-04-10', by: 'u', now })).toThrow(/Give a reason/);
    expect(() => sale.cancel({ reason: 'x', on: '2026-04-09', by: 'u', now })).toThrow(/before it was made/);
    sale.cancel({ reason: 'Wrong patient', on: '2026-04-10', by: 'u', now });
    expect(() => sale.cancel({ reason: 'x', on: '2026-04-10', by: 'u', now })).toThrow(/cancelled already/);
  });
});

describe('receivableRole', () => {
  it('books a due where its debtor owes it', () => {
    expect(receivableRole({ kind: 'member', id: 'm' })).toBe('pharmacy_receivable');
    expect(receivableRole({ kind: 'corporate', id: 'c' })).toBe('corporate_receivable');
    expect(receivableRole({ kind: 'staff', id: 's' })).toBe('staff_receivable');
  });
});

describe('allocateCollection', () => {
  const dues = [
    { saleId: 'b', soldOn: '2026-04-11', number: 'SI-2', due: 5.7, collected: 0 },
    { saleId: 'a', soldOn: '2026-04-10', number: 'SI-1', due: 6.4, collected: 0 },
    { saleId: 'c', soldOn: '2026-04-09', number: 'SI-0', due: 3, collected: 3 },
  ];

  it('pays the oldest sale first, never above what is due', () => {
    expect(allocateCollection(8, dues)).toEqual([
      { saleId: 'a', amount: 6.4 },
      { saleId: 'b', amount: 1.6 },
    ]);
    expect(() => allocateCollection(12.11, dues)).toThrow(/Only 12.10 is due/);
    expect(() => allocateCollection(0, dues)).toThrow(/more than 0/);
    expect(() => allocateCollection(1.005, dues)).toThrow(/taka and paisa/);
  });
});
