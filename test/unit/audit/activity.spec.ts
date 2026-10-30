import { describe, expect, it } from 'vitest';
import { period } from '../../../src/modules/audit/application/activity.queries.js';

describe('a period of the log', () => {
  it("runs from the first day's start to the next day after the last, in the organisation's time", () => {
    expect(period('2026-10-01', '2026-10-30', 'Asia/Dhaka').map((at) => at.toISOString())).toEqual([
      '2026-09-30T18:00:00.000Z',
      '2026-10-30T18:00:00.000Z',
    ]);
  });

  it('is in order and at most a year', () => {
    expect(() => period('2026-10-02', '2026-10-01', 'Asia/Dhaka')).toThrow(/after the end/);
    expect(() => period('2024-01-01', '2026-01-01', 'Asia/Dhaka')).toThrow(/at most 366 days/);
    expect(() => period('2025-10-30', '2026-10-30', 'Asia/Dhaka')).not.toThrow();
  });
});
