import { describe, expect, it } from 'vitest';
import { WardIndent, WardIssue } from '../../../src/modules/pharmacy/domain/ward.js';
import { billLines } from '../../../src/modules/hospital/domain/ipd-bill.js';

const now = new Date('2026-10-27T08:00:00Z');

const indent = () =>
  WardIndent.raise({
    id: 'n',
    number: 'WN-2026-00001',
    outletId: 'o',
    admissionId: 'a',
    requestedOn: '2026-10-27',
    note: ' Night dose ',
    lines: [
      { productId: 'napa', qty: 10 },
      { productId: 'ceftron', qty: 2 },
    ],
    by: 'nurse',
    now,
  });

const issue = () =>
  WardIssue.make({
    id: 'i',
    number: 'WI-2026-00001',
    outletId: 'o',
    admissionId: 'a',
    indentId: 'n',
    issuedOn: '2026-10-27',
    parts: [
      { productId: 'napa', lotId: 'l1', qty: 10, saleRate: 1.2, unitCost: 0.8, discountPercent: 0 },
      { productId: 'ceftron', lotId: 'l2', qty: 3, saleRate: 250, unitCost: 180, discountPercent: 5 },
    ],
    by: 'pharmacist',
    now,
  });

describe('WardIndent', () => {
  it('is raised once per product and answered by an issue or cancelled with a reason', () => {
    expect(indent().toSnapshot()).toMatchObject({ status: 'open', note: 'Night dose', version: 1 });
    expect(() =>
      WardIndent.raise({
        id: 'x',
        number: 'WN-2026-00002',
        outletId: 'o',
        admissionId: 'a',
        requestedOn: '2026-10-27',
        note: null,
        lines: [
          { productId: 'napa', qty: 1 },
          { productId: 'napa', qty: 2 },
        ],
        by: 'nurse',
        now,
      }),
    ).toThrow(expect.objectContaining({ code: 'duplicate_line' }));
    const answered = indent();
    answered.issued('i', 'pharmacist', now);
    expect(answered.toSnapshot()).toMatchObject({ status: 'issued', issueId: 'i', version: 2 });
    expect(() => answered.cancel('Late', 'nurse', now)).toThrow(expect.objectContaining({ code: 'indent_state' }));
    const dropped = indent();
    expect(() => dropped.cancel(' ', 'nurse', now)).toThrow(/reason/);
    dropped.cancel('Patient vomiting, oral stopped', 'nurse', now);
    expect(dropped.toSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'Patient vomiting, oral stopped' });
    expect(() => dropped.assertVersion(1)).toThrow(expect.objectContaining({ code: 'stale_indent' }));
  });
});

describe('WardIssue', () => {
  it('charges each lot part at its sale rate less the indoor discount', () => {
    const sent = issue();
    // 10 × 1.20 = 12.00; 3 × 250 = 750.00 less 5 % = 712.50.
    expect(sent.toSnapshot()).toMatchObject({ amount: 762, discount: 37.5, total: 724.5, cost: 548, returned: 0 });
    expect(sent.charged).toBe(724.5);
  });

  it('takes back unused units at what they were charged, never more than sent', () => {
    const sent = issue();
    const first = sent.giveBack([{ line: 2, qty: 1 }], now);
    expect(first).toMatchObject({ amount: 250, discount: 12.5, total: 237.5, cost: 180 });
    expect(() => sent.giveBack([{ line: 2, qty: 3 }], now)).toThrow(expect.objectContaining({ code: 'over_return' }));
    expect(() => sent.giveBack([{ line: 3, qty: 1 }], now)).toThrow(expect.objectContaining({ code: 'invalid_line' }));
    sent.giveBack([{ line: 2, qty: 2 }], now);
    expect(sent.charged).toBe(12);
    expect(sent.lines.map((line) => line.returnedQty)).toEqual([0, 3]);
    expect(() => sent.assertVersion(1)).toThrow(expect.objectContaining({ code: 'stale_issue' }));
  });

  it('reaches the indoor bill as a medicine line without service charge', () => {
    const lines = billLines({
      nights: [],
      admissionFee: 0,
      roundFeePerNight: 0,
      serviceChargePercent: 10,
      charges: [],
      medicine: [
        { issueId: 'i', number: 'WI-2026-00001', issuedOn: '2026-10-27', outletName: 'Indoor', amount: 724.5 },
      ],
    });
    expect(lines).toEqual([
      expect.objectContaining({
        head: 'medicine',
        description: 'Medicine WI-2026-00001 (Indoor)',
        amount: 724.5,
        serviceCharge: 0,
        shareAmount: 0,
      }),
    ]);
  });
});
