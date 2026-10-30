import { describe, expect, it } from 'vitest';
import {
  dayBefore,
  fiscalYearRecord,
  glAccountRecord,
  glKind,
  natureRecord,
  openingLines,
  type Balance,
} from '../../../src/cli/data-migration/account-records.js';

describe('the old chart', () => {
  it('reads a nature of account: its statement and normal balance', () => {
    const nature = (Name: string, Statement: string | null = null) =>
      natureRecord({ Id: 7, Name, CodeNo: null, Statement });
    expect(nature('Assets', 'Balance Sheet')).toEqual({
      ok: true,
      value: { code: 'N7', name: 'Assets', statement: 'balance_sheet', normalBalance: 'debit' },
    });
    expect(nature('Liabilities')).toMatchObject({ value: { statement: 'balance_sheet', normalBalance: 'credit' } });
    expect(nature("Owner's Equity")).toMatchObject({ value: { normalBalance: 'credit' } });
    expect(nature('Revenue')).toMatchObject({ value: { statement: 'profit_and_loss', normalBalance: 'credit' } });
    expect(nature('Expenditure', 'Profit & Loss')).toMatchObject({
      value: { statement: 'profit_and_loss', normalBalance: 'debit' },
    });
    expect(nature('Miscellaneous')).toEqual({ ok: false, reason: 'unknown_nature' });
    expect(nature('  ')).toEqual({ ok: false, reason: 'no_name' });
  });

  it('reads a general ledger account', () => {
    const row = {
      Id: 'g1',
      Name: ' Cash  in hand ',
      GLCodeNo: 'ca-101',
      Level5HeadId: 'h5',
      COADescriptionId: null,
      IsControlAccount: null,
      IsCostCenter: true,
      BankCashOth: 'Cash',
      IsActive: true,
      IsRecurringCost: false,
      IsBillingContainDetails: null,
      IsDeleted: false,
    };
    expect(glAccountRecord(row)).toEqual({
      ok: true,
      value: {
        code: 'CA-101',
        name: 'Cash in hand',
        kind: 'cash',
        isControlAccount: false,
        requiresCostCenter: true,
        isRecurringCost: false,
        billingHasDetails: false,
        isActive: true,
      },
    });
    expect(glAccountRecord({ ...row, IsDeleted: true })).toMatchObject({ value: { isActive: false } });
    expect(glAccountRecord({ ...row, GLCodeNo: ' ' })).toEqual({ ok: false, reason: 'no_code' });
    expect([glKind('Bank'), glKind('cash'), glKind('Oth'), glKind(null)]).toEqual(['bank', 'cash', 'other', 'other']);
  });

  it('makes calendar fiscal years, and finds the day before the cut-over', () => {
    expect(fiscalYearRecord(2026)).toEqual({
      ok: true,
      value: { label: '2026', startsOn: '2026-01-01', endsOn: '2026-12-31' },
    });
    expect(fiscalYearRecord(0)).toEqual({ ok: false, reason: 'invalid_year' });
    expect([dayBefore('2027-01-01'), dayBefore('2028-03-01')]).toEqual(['2026-12-31', '2028-02-29']);
  });
});

describe('opening balances', () => {
  const line = (glAccountId: string, debit: number, credit: number, subLedgerId: string | null = null): Balance => ({
    glAccountId,
    subLedgerId,
    costCenterId: null,
    debit,
    credit,
  });

  it('puts each balance on its side, per sub-ledger, leaving zero balances out', () => {
    const result = openingLines([
      line('cash', 500, 200),
      line('cash', 100, 0),
      line('receivable', 300, 0, 'patient-1'),
      line('receivable', 0, 100, 'patient-2'),
      line('settled', 50, 50),
      line('capital', 0, 600),
    ]);
    expect(result).toEqual({
      ok: true,
      total: 700,
      adjusted: 0,
      lines: [
        { glAccountId: 'cash', subLedgerId: null, costCenterId: null, debit: 400, credit: 0 },
        { glAccountId: 'receivable', subLedgerId: 'patient-1', costCenterId: null, debit: 300, credit: 0 },
        { glAccountId: 'receivable', subLedgerId: 'patient-2', costCenterId: null, debit: 0, credit: 100 },
        { glAccountId: 'capital', subLedgerId: null, costCenterId: null, debit: 0, credit: 600 },
      ],
    });
  });

  it('takes up old float rounding under a taka, and refuses books that do not balance', () => {
    const rounded = openingLines([line('cash', 1000.004, 0), line('capital', 0, 600), line('loan', 0, 399.99)]);
    expect(rounded).toMatchObject({ ok: true, adjusted: 0.01, total: 1000 });
    expect(rounded.ok && rounded.lines.find((entry) => entry.glAccountId === 'capital')).toMatchObject({
      credit: 600.01,
    });
    expect(openingLines([line('cash', 1000, 0), line('capital', 0, 998)])).toEqual({ ok: false, difference: 2 });
  });
});
