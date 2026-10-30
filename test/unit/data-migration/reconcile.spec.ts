import { describe, expect, it } from 'vitest';
import { compare, verdict } from '../../../src/cli/data-migration/reconcile.js';

describe('the cut-over reconciliation', () => {
  it('agrees to the paisa, asks for an explanation, or fails where nothing may differ', () => {
    expect(compare('Dues', 'Owed to doctors', 5_000.004, 5_000)).toMatchObject({ status: 'ok', note: null });
    expect(compare('Records', 'Patients', 4, 3)).toMatchObject({
      status: 'check',
      note: 'See the loader reports for what was left out',
    });
    expect(compare('Books', 'Cash', 10, 9, { strict: true, note: 'Re-run the opening' })).toMatchObject({
      status: 'fail',
      note: 'Re-run the opening',
    });
    expect(compare('Stock', 'Store', null, 5).status).toBe('check');
  });

  it('goes live only when nothing fails', () => {
    const line = (status: 'ok' | 'check' | 'fail') => ({ area: 'A', item: 'B', old: 1, new: 1, status, note: null });
    expect(verdict([line('ok'), line('ok')])).toBe('go');
    expect(verdict([line('ok'), line('check')])).toBe('go-with-notes');
    expect(verdict([line('check'), line('fail')])).toBe('no-go');
  });
});
