import { describe, expect, it } from 'vitest';
import { OtCase } from '../../../src/modules/hospital/domain/ot-case.js';

const now = new Date('2026-10-31T06:00:00Z');
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);
const clinical = {
  operationId: 'op',
  otTypeId: null,
  anaesthesiaTypeId: null,
  surgeonId: 'surgeon',
  anaesthetistId: 'anaesthetist',
  indication: '  Obstructed   labour ',
  team: [{ doctorId: 'assistant', role: 'assistant' as const }],
};
const requested = () =>
  OtCase.request({
    ...clinical,
    id: 'c1',
    number: 'OT-2026-00001',
    admissionId: 'a1',
    patientId: 'p1',
    requestedFor: '2026-10-31',
    by: 'u1',
    at: now,
  });
const error = (run: () => void) => {
  try {
    run();
  } catch (caught) {
    return (caught as { code?: string }).code;
  }
  return null;
};

describe('an operation', () => {
  it('is asked for with a team in which each doctor is named once', () => {
    expect(requested().toSnapshot()).toMatchObject({
      status: 'requested',
      indication: 'Obstructed labour',
      version: 1,
    });
    const twice = { ...clinical, team: [{ doctorId: 'surgeon', role: 'assistant' as const }] };
    expect(
      error(() =>
        OtCase.request({
          ...twice,
          id: 'c',
          number: 'n',
          admissionId: 'a',
          patientId: 'p',
          requestedFor: 'd',
          by: 'u',
          at: now,
        }),
      ),
    ).toBe('invalid_team');
    expect(
      error(() =>
        OtCase.request({
          ...clinical,
          anaesthetistId: 'surgeon',
          id: 'c',
          number: 'n',
          admissionId: 'a',
          patientId: 'p',
          requestedFor: 'd',
          by: 'u',
          at: now,
        }),
      ),
    ).toBe('invalid_team');
  });

  it('is given a room and a time ahead, for at most a day, and moved while scheduled', () => {
    const otCase = requested();
    expect(error(() => otCase.schedule('r1', hours(2), hours(1), now))).toBe('invalid_slot');
    expect(error(() => otCase.schedule('r1', hours(-3), hours(-1), now))).toBe('invalid_slot');
    expect(error(() => otCase.schedule('r1', hours(1), hours(26), now))).toBe('invalid_slot');
    otCase.schedule('r1', hours(1), hours(3), now);
    otCase.schedule('r2', hours(4), hours(5), now);
    expect(otCase.toSnapshot()).toMatchObject({ status: 'scheduled', otRoomId: 'r2', version: 3 });
  });

  it('is started, done and signed in order, and its note is written only once it has started', () => {
    const otCase = requested();
    const note = {
      incision: 'Midline',
      findings: 'Line one\r\nLine two',
      procedureDone: null,
      specimen: null,
      postOpOrders: null,
    };
    expect(error(() => otCase.writeNote(note, now))).toBe('ot_not_started');
    expect(error(() => otCase.start(now, now))).toBe('ot_not_scheduled');
    otCase.schedule('r1', hours(1), hours(3), now);
    otCase.start(now, now);
    expect(error(() => otCase.cancel('No longer needed', now))).toBe('ot_under_way');
    otCase.writeNote(note, now);
    expect(otCase.toSnapshot().findings).toBe('Line one\nLine two');
    expect(error(() => otCase.finish(hours(-1), now))).toBe('invalid_time');
    otCase.finish(now, now);
    expect(error(() => otCase.signNote('u1', now))).toBe('note_incomplete');
    otCase.writeNote({ ...note, procedureDone: 'Done as planned.' }, now);
    otCase.signNote('u1', now);
    expect(error(() => otCase.writeNote(note, now))).toBe('note_signed');
    expect(error(() => otCase.change(clinical, now))).toBe('ot_closed');
    expect(error(() => otCase.assertVersion(1))).toBe('stale_ot_case');
  });

  it('is cancelled with a reason, before it is under way', () => {
    const otCase = requested();
    expect(error(() => otCase.cancel('  ', now))).toBe('invalid_remarks');
    otCase.cancel('Delivered normally', now);
    expect(otCase.toSnapshot()).toMatchObject({ status: 'cancelled', cancelReason: 'Delivered normally' });
    expect(error(() => otCase.schedule('r1', hours(1), hours(2), now))).toBe('ot_not_schedulable');
  });
});
