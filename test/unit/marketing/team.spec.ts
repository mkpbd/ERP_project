import { describe, expect, it } from 'vitest';
import { checkedPerson, monthBounds, performance } from '../../../src/modules/marketing/domain/team.js';

const base = { name: 'Rafiq', code: null, phone: null, zoneId: null };
const manager = { kind: 'manager' as const, isActive: true, name: 'Kamal' };
const officer = { kind: 'officer' as const, isActive: true, name: 'Rafiq' };

describe('the team', () => {
  it('has officers under a manager and agents under an officer; managers under nobody', () => {
    expect(() => checkedPerson({ ...base, kind: 'manager' }, manager)).toThrow(/under nobody/);
    expect(() => checkedPerson({ ...base, kind: 'officer' }, null)).toThrow(/under a manager/);
    expect(() => checkedPerson({ ...base, kind: 'agent' }, manager)).toThrow(/An agent works under an officer/);
    expect(() => checkedPerson({ ...base, kind: 'agent' }, { ...officer, isActive: false })).toThrow(/not active/);
    expect(checkedPerson({ ...base, kind: 'agent', code: ' A-1 ' }, officer)).toMatchObject({ code: 'A-1' });
    expect(() => checkedPerson({ ...base, kind: 'agent', zoneId: 'z' }, officer)).toThrow(/Only an officer/);
  });

  it('works out a month', () => {
    expect(monthBounds(2028, 2)).toEqual(['2028-02-01', '2028-02-29']);
    expect(monthBounds(2026, 12)).toEqual(['2026-12-01', '2026-12-31']);
  });
});

describe('performance', () => {
  it('adds up each officer’s doctors against their target, and everything against the gross', () => {
    const result = performance({
      officers: [
        { id: 'o1', name: 'Rafiq', managerName: 'Kamal', zoneName: 'North' },
        { id: 'o2', name: 'Mitu', managerName: 'Kamal', zoneName: null },
      ],
      links: new Map([
        ['d1', 'o1'],
        ['d2', 'o1'],
        ['d3', 'o2'],
      ]),
      referred: [
        { doctorId: 'd1', opd: 1000, diagnostic: 2500, indoor: 0 },
        { doctorId: 'd2', opd: 0, diagnostic: 500, indoor: 10_000 },
        { doctorId: 'd9', opd: 300, diagnostic: 0, indoor: 0 },
      ],
      targets: new Map<string | null, number>([
        ['o1', 20_000],
        [null, 50_000],
      ]),
    });
    expect(result.rows).toEqual([
      expect.objectContaining({
        officerId: 'o1',
        doctors: 2,
        opd: 1000,
        diagnostic: 3000,
        indoor: 10_000,
        achieved: 14_000,
        target: 20_000,
        percent: 70,
      }),
      expect.objectContaining({ officerId: 'o2', doctors: 1, achieved: 0, target: null, percent: null }),
    ]);
    expect(result).toMatchObject({ total: 14_300, unassigned: 300, grossTarget: 50_000, grossPercent: 28.6 });
  });
});
