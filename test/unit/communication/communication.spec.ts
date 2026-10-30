import { describe, expect, it } from 'vitest';
import { assertMayAnswer, isPublished, required } from '../../../src/modules/communication/domain/communication.js';

const now = new Date('2026-10-30T06:00:00Z');
const hours = (n: number) => new Date(now.getTime() + n * 3_600_000);

describe('health tips', () => {
  it('show while active and within their window', () => {
    const tip = { isActive: true, publishFrom: null, publishTo: null };
    expect(isPublished(tip, now)).toBe(true);
    expect(isPublished({ ...tip, isActive: false }, now)).toBe(false);
    expect(isPublished({ ...tip, publishFrom: hours(1) }, now)).toBe(false);
    expect(isPublished({ ...tip, publishFrom: hours(-1), publishTo: hours(1) }, now)).toBe(true);
    expect(isPublished({ ...tip, publishTo: now }, now)).toBe(false);
  });
});

describe('chats', () => {
  it('are answered while open, by whoever has them or anyone when nobody does', () => {
    expect(() => assertMayAnswer({ status: 'open', assignedTo: null }, 'u1')).not.toThrow();
    expect(() => assertMayAnswer({ status: 'open', assignedTo: 'u1' }, 'u1')).not.toThrow();
    expect(() => assertMayAnswer({ status: 'open', assignedTo: 'u2' }, 'u1')).toThrow(
      expect.objectContaining({ code: 'not_your_chat' }),
    );
    expect(() => assertMayAnswer({ status: 'closed', assignedTo: 'u1' }, 'u1')).toThrow(/closed/);
  });

  it('carry text, within its length', () => {
    expect(required(' Hello ', 10, 'message')).toBe('Hello');
    expect(() => required('  ', 10, 'message')).toThrow(/Give the message/);
    expect(() => required('x'.repeat(11), 10, 'message')).toThrow(/at most 10/);
  });
});
