import { describe, expect, it, vi } from 'vitest';
import { DashboardDesk } from '../../../src/modules/reporting/application/dashboard.handlers.js';
import type { AccessControl } from '../../../src/shared/application/contracts/access-control.js';
import type { UserDirectory } from '../../../src/shared/application/contracts/user-directory.js';
import { DashboardRegistry, type DashboardHead } from '../../../src/shared/application/dashboards.js';
import type { Clock } from '../../../src/shared/application/ports/clock.js';

const head = (key: string, extra: Partial<DashboardHead> = {}): DashboardHead => ({
  key,
  label: key,
  unit: 'count',
  finance: false,
  dimensions: [{ key: 'day', label: 'Day' }],
  total: () => Promise.resolve(1),
  breakdown: () => Promise.resolve([]),
  ...extra,
});

describe('DashboardRegistry', () => {
  it("keeps each section's heads under its key, split by day first unless they stand as of now", () => {
    const registry = new DashboardRegistry();
    registry.register({ key: 'b', title: 'B', order: 2, permissions: ['b:read'], heads: [head('b.one')] });
    registry.register({
      key: 'a',
      title: 'A',
      order: 1,
      permissions: ['a:read'],
      heads: [head('a.now', { current: true, dimensions: [{ key: 'ward', label: 'Ward' }] })],
    });
    expect(registry.all().map((section) => section.key)).toEqual(['a', 'b']);
    expect(registry.head('b.one')?.section.key).toBe('b');
    expect(() =>
      registry.register({ key: 'c', title: 'C', order: 3, permissions: [], heads: [head('b.two')] }),
    ).toThrow(/not of c/);
    expect(() =>
      registry.register({
        key: 'd',
        title: 'D',
        order: 4,
        permissions: [],
        heads: [head('d.one', { dimensions: [{ key: 'ward', label: 'Ward' }] })],
      }),
    ).toThrow(/by day first/);
    expect(() => registry.register({ key: 'b', title: 'B', order: 2, permissions: [], heads: [] })).toThrow(/twice/);
  });
});

describe('DashboardDesk', () => {
  function desk(now = new Date('2026-04-10T20:00:00Z'), permissions: string[] = []) {
    const registry = new DashboardRegistry();
    registry.register({
      key: 'pharmacy',
      title: 'Pharmacy',
      order: 1,
      permissions: ['pharmacy:read'],
      heads: [head('pharmacy.sales'), head('pharmacy.sold', { unit: 'money', finance: true })],
    });
    registry.register({
      key: 'staff',
      title: 'Staff',
      order: 2,
      permissions: ['hr:read'],
      heads: [head('staff.joined')],
    });
    const clock = { now: vi.fn(() => now) } as unknown as Clock;
    const access = { getProfile: () => Promise.resolve({ roles: [], roleIds: [], permissions: new Set(permissions) }) };
    const users = { findSummaries: () => Promise.resolve([]) } as unknown as UserDirectory;
    return {
      desk: new DashboardDesk(registry, access as unknown as AccessControl, clock, { timeZone: 'Asia/Dhaka' }, users),
      clock,
    };
  }

  it("takes today in the organisation's time zone, and the same number of days before", () => {
    const { desk: dashboards } = desk();
    // 20:00 UTC is the next morning in Dhaka.
    expect(dashboards.range(undefined, undefined)).toMatchObject({ from: '2026-04-11', to: '2026-04-11' });
    const range = dashboards.range('2026-03-01', '2026-03-31');
    expect(dashboards.previous(range)).toMatchObject({ from: '2026-01-29', to: '2026-02-28' });
    expect(() => dashboards.range('2026-04-02', '2026-04-01')).toThrow(/after the end/);
    expect(() => dashboards.range('2025-03-31', '2026-04-01')).toThrow(/at most 366 days/);
    expect(dashboards.range('2025-04-01', '2026-04-01').from).toBe('2025-04-01');
  });

  it('shows the sections whose permissions the user holds, and money only with dashboard:finance', async () => {
    const counter = await desk(undefined, ['pharmacy:read']).desk.visible('u');
    expect(counter.map((entry) => entry.heads.map((one) => one.key))).toEqual([['pharmacy.sales']]);
    const books = await desk(undefined, ['pharmacy:read', 'hr:read', 'dashboard:finance']).desk.visible('u');
    expect(books.map((entry) => entry.heads.map((one) => one.key))).toEqual([
      ['pharmacy.sales', 'pharmacy.sold'],
      ['staff.joined'],
    ]);
  });

  it('keeps a figure for a minute, and not a failure', async () => {
    const { desk: dashboards, clock } = desk();
    const work = vi.fn(() => Promise.resolve(5));
    await dashboards.cached('k', work);
    await dashboards.cached('k', work);
    expect(work).toHaveBeenCalledTimes(1);
    vi.mocked(clock.now).mockReturnValue(new Date('2026-04-10T20:01:01Z'));
    await dashboards.cached('k', work);
    expect(work).toHaveBeenCalledTimes(2);
    const failing = vi.fn(() => Promise.reject(new Error('down')));
    await expect(dashboards.cached('f', failing)).rejects.toThrow('down');
    await expect(dashboards.cached('f', failing)).rejects.toThrow('down');
    expect(failing).toHaveBeenCalledTimes(2);
  });
});
