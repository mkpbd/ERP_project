import { describe, expect, it } from 'vitest';
import {
  assertNewOrder,
  checkedMenus,
  inForce,
  kitchenState,
  type DietOrderRow,
  type MealServiceRow,
} from '../../../src/modules/nutrition/domain/diet.js';

const at = (h: number) => new Date(Date.UTC(2026, 9, 30, h));
const order = (extra: Partial<DietOrderRow>): DietOrderRow => ({
  id: 'o1',
  admissionId: 'a',
  patientId: 'p',
  planId: 'normal',
  nilByMouth: false,
  remarks: null,
  fromAt: at(2),
  toAt: null,
  orderedBy: 'u',
  endedBy: null,
  createdAt: at(2),
  ...extra,
});

describe('menus', () => {
  it('gives each meal one written menu', () => {
    expect(checkedMenus([{ mealTypeId: 'b', menu: ' 2 ruti, 1 egg ' }])).toEqual([
      { mealTypeId: 'b', menu: '2 ruti, 1 egg' },
    ]);
    expect(() =>
      checkedMenus([
        { mealTypeId: 'b', menu: 'x' },
        { mealTypeId: 'b', menu: 'y' },
      ]),
    ).toThrow(/one menu/);
    expect(() => checkedMenus([{ mealTypeId: 'b', menu: ' ' }])).toThrow(/Give the menu/);
  });
});

describe('diet orders', () => {
  it('are a plan or nothing by mouth, starting no earlier than the one in force', () => {
    expect(() => assertNewOrder({ planId: null, nilByMouth: false, fromAt: at(5) }, null)).toThrow(
      /diet plan, or nothing/,
    );
    expect(() => assertNewOrder({ planId: 'soft', nilByMouth: true, fromAt: at(5) }, null)).toThrow(
      /diet plan, or nothing/,
    );
    expect(() => assertNewOrder({ planId: 'soft', nilByMouth: false, fromAt: at(1) }, order({}))).toThrow(
      expect.objectContaining({ code: 'diet_overlap' }),
    );
    expect(() => assertNewOrder({ planId: null, nilByMouth: true, fromAt: at(5) }, order({}))).not.toThrow();
  });

  it('are in force from their start until ended', () => {
    const orders = [order({ id: 'o2', planId: 'soft', fromAt: at(8) }), order({ toAt: at(8) })];
    expect(inForce(orders, at(1))).toBeNull();
    expect(inForce(orders, at(7))?.id).toBe('o1');
    expect(inForce(orders, at(8))?.id).toBe('o2');
  });
});

describe('the kitchen', () => {
  it('serves a diet in force, never nothing by mouth, and shows what was done', () => {
    const served = { status: 'refused' } as MealServiceRow;
    expect(kitchenState(null, null)).toBe('no_order');
    expect(kitchenState(order({ planId: null, nilByMouth: true }), null)).toBe('nil_by_mouth');
    expect(kitchenState(order({}), null)).toBe('to_serve');
    expect(kitchenState(order({}), served)).toBe('refused');
  });
});
