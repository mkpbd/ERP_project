import { describe, expect, it } from 'vitest';
import { allocate, expiryDay, isAssetType } from '../../../src/cli/data-migration/stock-records.js';

describe('old stock', () => {
  it('reads expiry days however the old lots wrote them', () => {
    expect(
      [
        new Date('2027-03-31T00:00:00Z'),
        '2027-03-31',
        '2027-03-31T00:00:00',
        '31/03/2027',
        '31-03-27',
        '31-Mar-2027',
        '31 march 2027',
        '03/2027',
        'Mar-27',
        'Feb 2028',
      ].map(expiryDay),
    ).toEqual([
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2027-03-31',
      '2028-02-29',
    ]);
    expect(['31/02/2027', 'soon', '', null, 0].map(expiryDay)).toEqual([null, null, null, null, null]);
  });

  it('keeps what a product holds in its last-expiring lots when outs were counted without their lot', () => {
    expect(
      allocate([
        { lot: 'a', qty: 5, expiry: '2027-01-31' },
        { lot: 'b', qty: 4, expiry: '2028-01-31' },
        { lot: null, qty: -4, expiry: null },
      ]),
    ).toEqual({
      lots: [
        { lot: 'b', qty: 4, expiry: '2028-01-31' },
        { lot: 'a', qty: 1, expiry: '2027-01-31' },
      ],
      short: 0,
    });
    expect(allocate([{ lot: 'a', qty: 2.5, expiry: null }], 3)).toEqual({
      lots: [{ lot: 'a', qty: 2.5, expiry: null }],
      short: 0,
    });
    expect(
      allocate([
        { lot: 'a', qty: 1, expiry: null },
        { lot: null, qty: -3, expiry: null },
      ]),
    ).toEqual({
      lots: [],
      short: 2,
    });
  });

  it('knows asset item types by their account', () => {
    expect([isAssetType('Reusable items'), isAssetType('Fixed Asset - Equipment'), isAssetType('Consumables')]).toEqual(
      [true, true, false],
    );
  });
});
