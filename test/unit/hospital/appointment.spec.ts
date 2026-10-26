import { describe, expect, it } from 'vitest';
import {
  Appointment,
  chooseSerial,
  feeFor,
  slotTime,
  weekdayOf,
} from '../../../src/modules/hospital/domain/appointment.js';

const sitting = { startTime: '17:00', slotMinutes: 15, maxPatients: 4 };
const now = new Date('2026-10-26T04:00:00Z');
const book = (extra: Partial<Parameters<typeof Appointment.book>[0]> = {}) =>
  Appointment.book({
    id: 'a',
    doctorId: 'd',
    appointmentDate: '2026-10-27',
    serial: 2,
    slotTime: '17:15',
    visitType: 'new',
    patientId: null,
    patientName: ' Abdul  Karim ',
    mobileNo: '01711000000',
    referredById: null,
    fee: 800,
    remarks: null,
    bookedBy: 'clerk',
    today: '2026-10-26',
    now,
    ...extra,
  });

describe('appointment slots', () => {
  it('gives each serial its time, the weekday of a date and the fee of a visit type', () => {
    expect([1, 2, 4].map((serial) => slotTime(sitting, serial))).toEqual(['17:00', '17:15', '17:45']);
    expect(slotTime({ startTime: '23:30', slotMinutes: 20, maxPatients: 5 }, 3)).toBe('00:10');
    expect(weekdayOf('2026-10-25')).toBe(0);
    expect(weekdayOf('2026-10-31')).toBe(6);
    const fees = { firstVisitFee: 1000, newVisitFee: 800, followUpFee: 500, reportFee: 300 };
    expect([feeFor(fees, 'first'), feeFor(fees, 'new'), feeFor(fees, 'follow_up'), feeFor(fees, 'report')]).toEqual([
      1000, 800, 500, 300,
    ]);
  });

  it('takes the serial asked for when free, else the first free one, never past the sitting', () => {
    const taken = new Set([1, 3]);
    expect(chooseSerial(sitting, taken, null)).toBe(2);
    expect(chooseSerial(sitting, taken, 4)).toBe(4);
    expect(() => chooseSerial(sitting, taken, 3)).toThrow(/Serial 3 is booked/);
    expect(() => chooseSerial(sitting, taken, 5)).toThrow(/from 1 to 4/);
    expect(() => chooseSerial(sitting, new Set([1, 2, 3, 4]), null)).toThrow(/All 4 serials/);
  });
});

describe('Appointment', () => {
  it('is booked for today or later with a cleaned name', () => {
    expect(book().toSnapshot()).toMatchObject({ patientName: 'Abdul Karim', status: 'booked', version: 1 });
    expect(() => book({ appointmentDate: '2026-10-25' })).toThrow(/day gone by/);
    expect(() => book({ patientName: ' ' })).toThrow(/name/);
  });

  it('arrives on its day once a registered patient is attached; a no-show only from its day', () => {
    const appointment = book();
    expect(() => appointment.arrive('2026-10-27', now)).toThrow(/Register the patient/);
    appointment.attach({ id: 'p', fullName: 'Abdul Karim Chowdhury', mobileNo: '01711000001' }, now);
    expect(() => appointment.arrive('2026-10-26', now)).toThrow(/on the day/);
    expect(() => appointment.noShow('2026-10-26', now)).toThrow(/on or after its day/);
    appointment.arrive('2026-10-27', now);
    expect(appointment.toSnapshot()).toMatchObject({
      patientId: 'p',
      patientName: 'Abdul Karim Chowdhury',
      mobileNo: '01711000001',
      status: 'arrived',
      version: 3,
    });
    expect(() => appointment.cancel('Changed mind', now)).toThrow(/arrived appointment cannot be cancelled/);
  });

  it('is cancelled with a reason and then changes no more', () => {
    const appointment = book();
    expect(() => appointment.cancel(' ', now)).toThrow(/reason/);
    appointment.cancel('Doctor on leave', now);
    expect(appointment.toSnapshot()).toMatchObject({ status: 'cancelled', statusReason: 'Doctor on leave' });
    expect(() => appointment.noShow('2026-10-28', now)).toThrow(/cancelled appointment/);
    expect(() => appointment.assertVersion(1)).toThrow(/changed by someone else/);
  });
});
