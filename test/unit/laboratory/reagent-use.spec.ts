import { describe, expect, it } from 'vitest';
import { ReagentUser } from '../../../src/modules/laboratory/application/reagent-use.js';
import type { ReagentRepository, ReagentUse } from '../../../src/modules/laboratory/domain/repositories.js';
import type { DepartmentStock } from '../../../src/shared/application/contracts/department-stock.js';

function setUp(options: { recipe: boolean; store: boolean; enough: boolean }) {
  const uses: ReagentUse[] = [];
  const consumed: unknown[] = [];
  const reagents = {
    recipe: () => Promise.resolve(options.recipe ? [{ variantId: 'kit', qty: 1 }] : []),
    storeOf: () => Promise.resolve(options.store ? 'lab-store' : null),
    addUses: (rows: readonly ReagentUse[]) => {
      uses.push(...rows);
      return Promise.resolve();
    },
  } as unknown as ReagentRepository;
  const stock = {
    consume: (params: unknown) => {
      consumed.push(params);
      return Promise.resolve(options.enough ? { number: 'DC-2026-00001' } : null);
    },
  } as unknown as DepartmentStock;
  const user = new ReagentUser(
    reagents,
    stock,
    { now: () => new Date('2026-10-28T20:00:00Z') },
    {
      timeZone: 'Asia/Dhaka',
    },
  );
  const use = () =>
    user.useUp({
      sourceKind: 'result',
      sourceId: 'r',
      testId: 'cbc',
      diagnosticDepartmentId: 'pathology',
      reference: 'CBC of DB-2026-00001',
      by: 'doctor',
    });
  return { use, uses, consumed };
}

describe('ReagentUser', () => {
  it('uses up nothing when the test has no recipe or its department no store', async () => {
    for (const options of [
      { recipe: false, store: true, enough: true },
      { recipe: true, store: false, enough: true },
    ]) {
      const { use, uses, consumed } = setUp(options);
      expect(await use()).toBeNull();
      expect([uses.length, consumed.length]).toEqual([0, 0]);
    }
  });

  it("consumes the recipe on the organisation's day and keeps the use, short when the store has too little", async () => {
    const enough = setUp({ recipe: true, store: true, enough: true });
    expect(await enough.use()).toBe('used');
    expect(enough.consumed[0]).toMatchObject({
      departmentId: 'lab-store',
      on: '2026-10-29',
      note: 'Used for CBC of DB-2026-00001',
    });
    expect(enough.uses).toEqual([
      expect.objectContaining({ variantId: 'kit', qty: 1, consumptionNumber: 'DC-2026-00001' }),
    ]);
    const short = setUp({ recipe: true, store: true, enough: false });
    expect(await short.use()).toBe('short');
    expect(short.uses).toEqual([expect.objectContaining({ consumptionNumber: null })]);
  });
});
