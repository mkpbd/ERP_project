import { describe, expect, it } from 'vitest';
import { priceSale, stockToUse, type CanteenItem } from '../../../src/modules/canteen/domain/sale.js';

const item = (id: string, extra: Partial<CanteenItem> = {}): CanteenItem => ({
  id,
  name: id,
  unit: 'pcs',
  rate: 100,
  staffRate: 80,
  vatPercent: 0,
  stockVariantId: null,
  stockQty: 1,
  isActive: true,
  ...extra,
});
const items = new Map([
  ['tea', item('tea', { rate: 20, staffRate: 15 })],
  ['juice', item('juice', { rate: 50, staffRate: 45, vatPercent: 5, stockVariantId: 'v-juice' })],
  ['cake', item('cake', { stockVariantId: 'v-cake', stockQty: 0.5 })],
  ['old', item('old', { isActive: false })],
]);

describe('pricing a sale', () => {
  it('charges general or staff rates with VAT, less the discount', () => {
    const walkIn = priceSale({
      customerKind: 'walk_in',
      lines: [
        { itemId: 'tea', qty: 2 },
        { itemId: 'juice', qty: 1 },
      ],
      items,
      discount: 10,
      paid: 200,
    });
    expect(walkIn).toMatchObject({ gross: 90, vat: 2.5, discount: 10, net: 82.5, paid: 82.5, due: 0 });
    const staff = priceSale({
      customerKind: 'staff',
      lines: [{ itemId: 'tea', qty: 2 }],
      items,
      discount: 0,
      paid: 30,
    });
    expect(staff).toMatchObject({ gross: 30, net: 30, due: 0 });
  });

  it('lets only a member leave a due', () => {
    expect(() =>
      priceSale({ customerKind: 'walk_in', lines: [{ itemId: 'tea', qty: 1 }], items, discount: 0, paid: 10 }),
    ).toThrow(expect.objectContaining({ code: 'due_not_allowed' }));
    expect(
      priceSale({ customerKind: 'member', lines: [{ itemId: 'tea', qty: 1 }], items, discount: 0, paid: 5 }),
    ).toMatchObject({ net: 20, paid: 5, due: 15 });
  });

  it('refuses items not sold, odd quantities and too large a discount', () => {
    const sale = (lines: { itemId: string; qty: number }[], discount = 0) =>
      priceSale({ customerKind: 'walk_in', lines, items, discount, paid: 1000 });
    expect(() => sale([{ itemId: 'old', qty: 1 }])).toThrow(/not sold/);
    expect(() => sale([{ itemId: 'nope', qty: 1 }])).toThrow(/not on the menu/);
    expect(() => sale([{ itemId: 'tea', qty: 0.0001 }])).toThrow(/3 decimals/);
    expect(sale([{ itemId: 'tea', qty: 1.005 }]).gross).toBe(20.1);
    expect(() => sale([{ itemId: 'tea', qty: 1 }], 25)).toThrow(/discount/);
    expect(() => sale([])).toThrow(/1 to 50 lines/);
  });
});

describe('stock used up', () => {
  it('adds up the store units of packaged items; cooked food uses none', () => {
    const { lines } = priceSale({
      customerKind: 'walk_in',
      lines: [
        { itemId: 'juice', qty: 2 },
        { itemId: 'tea', qty: 3 },
        { itemId: 'cake', qty: 3 },
        { itemId: 'juice', qty: 1 },
      ],
      items,
      discount: 0,
      paid: 10_000,
    });
    expect(stockToUse(lines, items)).toEqual([
      { variantId: 'v-juice', qty: 3 },
      { variantId: 'v-cake', qty: 1.5 },
    ]);
  });
});
