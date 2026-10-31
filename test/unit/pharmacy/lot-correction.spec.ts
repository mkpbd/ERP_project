import { describe, expect, it } from 'vitest';
import { correctLot } from '../../../src/modules/pharmacy/domain/lot-correction.js';

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (caught) {
    return (caught as { code?: string }).code ?? null;
  }
  return null;
};

const lot = { batchNo: 'B-12', expiryDate: '2027-06-30', saleRate: 12.5 };

describe('a lot correction', () => {
  it('changes the batch, the expiry or the sale rate, for a reason', () => {
    expect(correctLot(lot, { ...lot, expiryDate: '2027-12-31' }, ' Typed  wrong ')).toEqual({
      batchNo: 'B-12',
      expiryDate: '2027-12-31',
      saleRate: 12.5,
      reason: 'Typed wrong',
    });
    expect(correctLot(lot, { ...lot, batchNo: '  ' }, 'No batch on the strip').batchNo).toBeNull();
    expect(codeOf(() => correctLot(lot, { ...lot, batchNo: 'b-12' }, 'case only'))).toBe('lot_unchanged');
    expect(codeOf(() => correctLot(lot, { ...lot, saleRate: 13 }, '   '))).toBe('invalid_remarks');
    expect(codeOf(() => correctLot(lot, { ...lot, saleRate: -1 }, 'Wrong rate'))).toBe('invalid_rate');
  });
});
