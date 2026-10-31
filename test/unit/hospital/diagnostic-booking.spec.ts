import { describe, expect, it } from 'vitest';
import {
  assertBookableDay,
  chooseWindowSerial,
  HomeCollection,
  quoteTotal,
  servesOn,
  TestAppointment,
  windowOver,
} from '../../../src/modules/hospital/domain/diagnostic-booking.js';

const codeOf = (run: () => unknown) => {
  try {
    run();
  } catch (caught) {
    return (caught as { code?: string }).code ?? (caught as Error).message;
  }
  return null;
};

const now = new Date('2026-10-31T04:00:00Z');
const today = '2026-10-31'; // a Saturday
const walkIn = { patientId: null, patientName: ' Abdul  Karim ', mobileNo: '01711000000' };
const karim = { id: 'p1', fullName: 'Abdul Karim', mobileNo: '01711000000' };
const tests = [
  { testId: 't1', rate: 400.5 },
  { testId: 't2', rate: 199.75 },
];

const appointment = (appointmentDate = today) =>
  TestAppointment.book({
    id: 'a1',
    number: 'TA-2026-00001',
    patient: walkIn,
    appointmentDate,
    window: { id: 'w1', label: 'Morning', startTime: '08:00', endTime: '10:00' },
    serial: 1,
    tests,
    remarks: null,
    bookedVia: 'desk',
    bookedBy: 'u1',
    today,
    now,
  });

const area = { id: 'z1', name: 'Kolatoli', charge: 200, minimumOrder: 500, days: ['saturday', 'sunday'] as const };
const collection = (overrides: Partial<Parameters<typeof HomeCollection.book>[0]> = {}) =>
  HomeCollection.book({
    id: 'h1',
    number: 'HC-2026-00001',
    patient: walkIn,
    area: { ...area, days: [...area.days] },
    address: 'House 12, Road 3',
    landmark: null,
    collectionDate: today,
    window: { id: 'hw1', label: '08:00 AM - 10:00 AM' },
    tests,
    patientNote: null,
    bookedVia: 'portal',
    bookedBy: null,
    today,
    now,
    ...overrides,
  });

describe('diagnostic bookings', () => {
  it('books from today up to 60 days ahead, with 1 to 20 different tests', () => {
    expect(codeOf(() => assertBookableDay('2026-10-30', today))).toBe('invalid_date');
    expect(codeOf(() => assertBookableDay('2026-12-30', today))).toBeNull();
    expect(codeOf(() => assertBookableDay('2026-12-31', today))).toBe('invalid_date');
    expect(quoteTotal(tests)).toBe(600.25);
    expect(codeOf(() => quoteTotal([]))).toBe('invalid_lines');
    expect(codeOf(() => quoteTotal([tests[0]!, tests[0]!]))).toBe('duplicate_test');
  });

  it('gives the first place free within the capacity, and knows when a window is over', () => {
    expect(chooseWindowSerial(3, new Set([1, 3]))).toBe(2);
    expect(codeOf(() => chooseWindowSerial(2, new Set([1, 2])))).toBe('fully_booked');
    expect(windowOver({ startTime: '08:00', endTime: '10:00' }, '09:59')).toBe(false);
    expect(windowOver({ startTime: '08:00', endTime: '10:00' }, '10:00')).toBe(true);
    expect(windowOver({ startTime: '08:00', endTime: null }, '08:00')).toBe(true);
  });

  it('serves an area on its days, or every day when none are listed', () => {
    expect(servesOn(['saturday'], today)).toBe(true);
    expect(servesOn(['monday'], today)).toBe(false);
    expect(servesOn([], today)).toBe(true);
  });

  it('bills a test appointment once, on its day, to its patient', () => {
    const booked = appointment();
    expect(booked.toSnapshot()).toMatchObject({ patientName: 'Abdul Karim', amount: 600.25, status: 'booked' });
    expect(codeOf(() => appointment('2026-11-01').billed('b1', karim, today, now))).toBe('invalid_date');
    booked.billed('b1', karim, today, now);
    expect(booked.toSnapshot()).toMatchObject({ status: 'billed', billId: 'b1', patientId: 'p1', version: 2 });
    expect(codeOf(() => booked.cancel('changed mind', now))).toBe('booking_state');

    const other = appointment();
    other.attach({ id: 'p2', fullName: 'Rahima Begum', mobileNo: '01811000000' }, now);
    expect(codeOf(() => other.billed('b2', karim, today, now))).toBe('booking_patient_mismatch');
    expect(codeOf(() => appointment('2026-11-01').noShow(today, now))).toBe('invalid_date');
    expect(codeOf(() => other.cancel('  ', now))).toBe('invalid_remarks');
    expect(codeOf(() => other.assertVersion(1))).toBe('stale_booking');
  });

  it("books a home collection on the area's days, from its smallest order, with an address", () => {
    expect(codeOf(() => collection({ collectionDate: '2026-11-02' }))).toBe('area_closed');
    expect(codeOf(() => collection({ tests: [{ testId: 't1', rate: 300 }] }))).toBe('below_minimum');
    expect(() => collection({ tests: [{ testId: 't1', rate: 300 }] })).toThrow(/starts at 500.00 \(200.00 short\)/);
    expect(codeOf(() => collection({ address: '   ' }))).toBe('invalid_address');
    expect(collection().toSnapshot()).toMatchObject({ amount: 600.25, charge: 200, status: 'booked' });
  });

  it('is given a collector, collected, billed once; not cancelled once billed or collected', () => {
    const visit = collection();
    expect(codeOf(() => visit.collected('c1', null, now))).toBe('booking_state');
    visit.assign('c1', now);
    visit.assign('c2', now);
    expect(visit.collectorId).toBe('c2');
    visit.billed('b1', karim, now);
    expect(codeOf(() => visit.billed('b2', karim, now))).toBe('booking_billed');
    expect(codeOf(() => visit.cancel('not home', now))).toBe('booking_billed');
    visit.collected('c2', 'Fasting since 10 pm', now);
    expect(visit.toSnapshot()).toMatchObject({
      status: 'collected',
      collectedBy: 'c2',
      collectionNote: 'Fasting since 10 pm',
      patientId: 'p1',
    });
    expect(codeOf(() => visit.assign('c1', now))).toBe('booking_state');

    const called = collection();
    called.cancel('Not at home', now);
    expect(codeOf(() => called.billed('b3', karim, now))).toBe('booking_state');
  });
});
