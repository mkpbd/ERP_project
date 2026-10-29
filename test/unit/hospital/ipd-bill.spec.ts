import { describe, expect, it } from 'vitest';
import {
  bedNights,
  billLines,
  chargeOf,
  IpdBill,
  type StayDays,
} from '../../../src/modules/hospital/domain/ipd-bill.js';
import type { BillPayer } from '../../../src/modules/hospital/domain/opd-bill.js';

const ward = (fromOn: string, toOn: string | null): StayDays => ({
  bedId: 'w1',
  bedCode: 'W-1',
  fromOn,
  toOn,
  rate: 1000,
  intensive: false,
});
const cabin = (fromOn: string, toOn: string | null): StayDays => ({
  bedId: 'c1',
  bedCode: 'C-1',
  fromOn,
  toOn,
  rate: 3000,
  intensive: false,
});
const icu = (fromOn: string, toOn: string | null): StayDays => ({
  bedId: 'i1',
  bedCode: 'ICU-1',
  fromOn,
  toOn,
  rate: 8000,
  intensive: true,
});

const visit = chargeOf({
  id: 'v',
  serviceId: 'round',
  serviceName: 'Consultant visit',
  doctorId: 'nusrat',
  chargedOn: '2026-10-21',
  qty: 2,
  rate: 1000,
  sharePercent: 50,
});

const make = (
  overrides: Partial<{
    discount: number;
    discountReason: string | null;
    mayDiscountMore: boolean;
    deposit: number;
    payment: { method: 'cash'; amount: number } | null;
    payer: BillPayer;
  }> = {},
) =>
  IpdBill.create({
    id: 'b',
    number: 'IB-2026-00001',
    admissionId: 'a',
    patientId: 'p',
    billedOn: '2026-10-23',
    payer: overrides.payer ?? { kind: 'patient' },
    nights: 3,
    lines: billLines({
      nights: bedNights([ward('2026-10-20', null)], '2026-10-23'),
      admissionFee: 500,
      roundFeePerNight: 330,
      serviceChargePercent: 10,
      charges: [visit],
    }),
    discount: overrides.discount ?? 0,
    discountReason: overrides.discountReason ?? null,
    discountLimitPercent: 10,
    mayDiscountMore: overrides.mayDiscountMore ?? false,
    deposit: overrides.deposit ?? 0,
    payment: overrides.payment ?? null,
    by: 'cashier',
    now: new Date('2026-10-23T08:00:00Z'),
  });

describe('bedNights', () => {
  it('counts every day up to the bill day as a night, and none for a same-day stay', () => {
    expect(bedNights([ward('2026-10-20', null)], '2026-10-23')).toEqual([
      { bedId: 'w1', bedCode: 'W-1', fromOn: '2026-10-20', toOn: '2026-10-23', nights: 3, rate: 1000 },
    ]);
    expect(bedNights([ward('2026-10-23', null)], '2026-10-23')).toEqual([]);
    expect(bedNights([], '2026-10-23')).toEqual([]);
  });

  it('charges a day with two beds at the dearer one', () => {
    const runs = bedNights([ward('2026-10-20', '2026-10-21'), cabin('2026-10-21', null)], '2026-10-24');
    expect(runs.map(({ bedCode, fromOn, nights }) => [bedCode, fromOn, nights])).toEqual([
      ['W-1', '2026-10-20', 1],
      ['C-1', '2026-10-21', 3],
    ]);
    // Moved down from the cabin: the move day is still the cabin's.
    const down = bedNights([cabin('2026-10-20', '2026-10-21'), ward('2026-10-21', null)], '2026-10-23');
    expect(down.map(({ bedCode, nights }) => [bedCode, nights])).toEqual([
      ['C-1', 2],
      ['W-1', 1],
    ]);
  });

  it('charges the day moved out of intensive care at the bed moved to', () => {
    const runs = bedNights([icu('2026-10-20', '2026-10-22'), ward('2026-10-22', null)], '2026-10-24');
    expect(runs.map(({ bedCode, fromOn, toOn, nights }) => [bedCode, fromOn, toOn, nights])).toEqual([
      ['ICU-1', '2026-10-20', '2026-10-22', 2],
      ['W-1', '2026-10-22', '2026-10-24', 2],
    ]);
    // Into intensive care: the dearest bed of the day as usual.
    const into = bedNights([ward('2026-10-20', '2026-10-21'), icu('2026-10-21', null)], '2026-10-22');
    expect(into.map(({ bedCode, nights }) => [bedCode, nights])).toEqual([
      ['W-1', 1],
      ['ICU-1', 1],
    ]);
  });
});

describe('billLines', () => {
  it('bills the admission fee, the bed nights and round fee with the service charge, and the charges with shares', () => {
    const lines = billLines({
      nights: bedNights([ward('2026-10-20', null)], '2026-10-23'),
      admissionFee: 500,
      roundFeePerNight: 330,
      serviceChargePercent: 10,
      charges: [visit],
    });
    expect(
      lines.map(({ head, qty, rate, amount, serviceCharge, shareAmount }) => [
        head,
        qty,
        rate,
        amount,
        serviceCharge,
        shareAmount,
      ]),
    ).toEqual([
      ['admission', 1, 500, 500, 50, 0],
      ['bed', 3, 1000, 3000, 300, 0],
      ['round', 3, 330, 990, 99, 0],
      ['service', 2, 1000, 2000, 0, 1000],
    ]);
    // No round fee when no night was spent.
    expect(
      billLines({ nights: [], admissionFee: 0, roundFeePerNight: 330, serviceChargePercent: 0, charges: [] }),
    ).toEqual([]);
  });

  it("bills an admitted patient's tests with the service charge", () => {
    const lines = billLines({
      nights: [],
      admissionFee: 0,
      roundFeePerNight: 0,
      serviceChargePercent: 10,
      charges: [],
      investigations: [{ billId: 'd', number: 'DB-2026-00001', billedOn: '2026-10-21', amount: 1250 }],
    });
    expect(lines).toEqual([
      expect.objectContaining({
        head: 'investigation',
        description: 'Tests DB-2026-00001',
        amount: 1250,
        serviceCharge: 125,
      }),
    ]);
  });

  it('bills blood issued to the stay at its rate, without the service charge', () => {
    const lines = billLines({
      nights: [],
      admissionFee: 0,
      roundFeePerNight: 0,
      serviceChargePercent: 10,
      charges: [],
      blood: [
        {
          issueId: 'i',
          number: 'BI-2026-00001',
          issuedOn: '2026-10-21',
          description: 'Packed red cells BB-2026-00001/PC',
          amount: 1500,
        },
      ],
    });
    expect(lines).toEqual([
      expect.objectContaining({
        head: 'blood',
        description: 'Packed red cells BB-2026-00001/PC (BI-2026-00001)',
        amount: 1500,
        serviceCharge: 0,
      }),
    ]);
  });

  it('needs the doctor of a charge that carries a share', () => {
    expect(() =>
      chargeOf({
        id: 'x',
        serviceId: 's',
        serviceName: 'Dressing',
        doctorId: null,
        chargedOn: '2026-10-21',
        qty: 1,
        rate: 200,
        sharePercent: 20,
      }),
    ).toThrow(expect.objectContaining({ code: 'doctor_needed' }));
    expect(() => chargeOf({ ...visit, qty: 0 })).toThrow(expect.objectContaining({ code: 'invalid_quantity' }));
  });
});

describe('IpdBill', () => {
  it('takes the advance held against the bill and leaves the rest due', () => {
    const bill = make({ deposit: 5000, payment: { method: 'cash', amount: 1000 } });
    expect(bill.toSnapshot()).toMatchObject({ gross: 6490, serviceCharge: 449, net: 6939, deposit: 5000, paid: 1000 });
    expect(bill.due).toBe(939);
    expect(bill.share).toBe(1000);
    expect(bill.income).toEqual({
      admission: 500,
      bed: 3000,
      round: 990,
      service: 2000,
      medicine: 0,
      investigation: 0,
      blood: 0,
      serviceCharge: 449,
    });
  });

  it('refuses more advance than the bill, overpayment and a part payment by a cash client', () => {
    expect(() => make({ deposit: 7000 })).toThrow(expect.objectContaining({ code: 'over_advance' }));
    expect(() => make({ deposit: 6000, payment: { method: 'cash', amount: 1000 } })).toThrow(
      expect.objectContaining({ code: 'overpayment' }),
    );
    expect(() =>
      make({ payer: { kind: 'corporate', clientId: 'acme', cash: true }, payment: { method: 'cash', amount: 100 } }),
    ).toThrow(expect.objectContaining({ code: 'payment_needed' }));
  });

  it('holds the counter to its discount limit and wants a reason', () => {
    expect(() => make({ discount: 500 })).toThrow(expect.objectContaining({ code: 'invalid_discount' }));
    expect(() => make({ discount: 800, discountReason: 'Poor' })).toThrow(
      expect.objectContaining({ code: 'discount_limit' }),
    );
    expect(make({ discount: 693.9, discountReason: 'Poor' }).toSnapshot().net).toBe(6245.1);
    expect(make({ discount: 2000, discountReason: 'Poor', mayDiscountMore: true }).toSnapshot().net).toBe(4939);
  });

  it('collects dues and is cancelled on its day, later only by a manager, with the money held again', () => {
    const bill = make({ deposit: 5000 });
    expect(() => bill.collect(2000, '2026-10-23', new Date())).toThrow(
      expect.objectContaining({ code: 'overpayment' }),
    );
    bill.collect(939, '2026-10-24', new Date());
    expect(bill.due).toBe(1000);
    expect(() =>
      bill.cancel({ reason: 'Late', on: '2026-10-24', by: 'cashier', mayCancelLater: false, now: new Date() }),
    ).toThrow(expect.objectContaining({ code: 'cancel_later' }));
    expect(
      bill.cancel({ reason: 'Charges missed', on: '2026-10-24', by: 'manager', mayCancelLater: true, now: new Date() }),
    ).toEqual({ held: 5939, dueCleared: 1000 });
    expect(bill.status).toBe('cancelled');
    expect(() => bill.collect(10, '2026-10-24', new Date())).toThrow(expect.objectContaining({ code: 'bill_state' }));
    expect(() => bill.assertVersion(1)).toThrow(expect.objectContaining({ code: 'stale_bill' }));
  });
});
