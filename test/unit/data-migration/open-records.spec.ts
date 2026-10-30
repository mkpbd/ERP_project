import { describe, expect, it } from 'vitest';
import {
  advanceKind,
  bedHistory,
  isIntensive,
  netPaisa,
  wallInstant,
} from '../../../src/cli/data-migration/open-records.js';

const wall = (value: string) => new Date(`${value}Z`);

describe('open stays', () => {
  it('reads old wall-clock times in the organisation’s time zone', () => {
    expect(wallInstant(wall('2026-09-28T10:00:00'), 'Asia/Dhaka')).toEqual(new Date('2026-09-28T04:00:00Z'));
    expect(wallInstant(wall('2026-01-01T00:30:00'), 'UTC')).toEqual(new Date('2026-01-01T00:30:00Z'));
  });

  it('lays the old bed rows end to end, the last still in use', () => {
    const admitted = wall('2026-09-28T10:00:00');
    expect(
      bedHistory(
        [
          { bed: 'cabin', from: wall('2026-09-29T09:00:00'), to: null, order: 2 },
          // Released after the next began, and allocated before the admission was saved.
          { bed: 'icu', from: wall('2026-09-28T09:58:00'), to: wall('2026-09-29T11:00:00'), order: 1 },
          // A bed taken and given back at once.
          { bed: 'mistake', from: wall('2026-09-29T09:00:00'), to: wall('2026-09-29T09:00:00'), order: 3 },
        ],
        admitted,
      ),
    ).toEqual([
      { bed: 'icu', fromAt: wall('2026-09-28T09:58:00'), toAt: wall('2026-09-29T09:00:00') },
      { bed: 'cabin', fromAt: wall('2026-09-29T09:00:00'), toAt: null },
    ]);
    expect(bedHistory([{ bed: 'late', from: wall('2026-09-28T12:00:00'), to: null, order: 1 }], admitted)).toEqual([
      { bed: 'late', fromAt: admitted, toAt: null },
    ]);
  });

  it('reads advances, balances and intensive care beds', () => {
    expect([advanceKind(2), advanceKind(5), advanceKind('Refund'), advanceKind(0), advanceKind(null)]).toEqual([
      'advance',
      'refund',
      'refund',
      null,
      null,
    ]);
    expect([netPaisa(800, 300.004), netPaisa(null, 10)]).toEqual([50_000, -1_000]);
    expect(['ICU', 'Cabin', 'NICU bed', 'Picture ward'].map(isIntensive)).toEqual([true, false, true, false]);
  });
});
