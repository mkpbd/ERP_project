import { DomainError } from '../../../shared/domain/errors.js';

export type PfEntryType = 'opening' | 'contribution' | 'interest' | 'withdrawal' | 'settlement' | 'adjustment';

/** Everything on one person's PF account. */
export interface PfMovements {
  readonly staffId: string;
  /** PF deducted on committed salary sheets, dated the last day of the pay month. */
  readonly deductions: readonly { readonly date: string; readonly amount: number }[];
  readonly entries: readonly {
    readonly date: string;
    readonly type: PfEntryType;
    readonly credit: number;
    readonly debit: number;
  }[];
}

export interface PfYear {
  readonly year: number;
  readonly own: number;
  readonly employer: number;
  readonly interest: number;
  readonly withdrawn: number;
}

/** What the fund holds for a person at a date. */
export interface PfPosition {
  readonly opening: number;
  /** Salary sheet deductions and contribution entries. */
  readonly own: number;
  /** The employer's match on the person's own contributions (not on the opening balance). */
  readonly employer: number;
  readonly interest: number;
  readonly adjustments: number;
  readonly withdrawn: number;
  readonly settled: number;
  readonly balance: number;
  readonly years: PfYear[];
}

const paisa = (amount: number) => Math.round(amount * 100);
const taka = (paisa: number) => paisa / 100;

/** The person's PF position on `asOf` (inclusive), with the employer matching `matchPercent` of own PF. */
export function pfPosition(movements: PfMovements, asOf: string, matchPercent: number): PfPosition {
  const years = new Map<number, { own: number; employer: number; interest: number; withdrawn: number }>();
  const year = (date: string) => {
    const key = Number(date.slice(0, 4));
    const entry = years.get(key) ?? { own: 0, employer: 0, interest: 0, withdrawn: 0 };
    years.set(key, entry);
    return entry;
  };
  const totals = { opening: 0, own: 0, interest: 0, adjustments: 0, withdrawn: 0, settled: 0 };
  const addOwn = (date: string, amount: number) => {
    totals.own += amount;
    year(date).own += amount;
  };
  for (const deduction of movements.deductions) {
    if (deduction.date <= asOf) addOwn(deduction.date, paisa(deduction.amount));
  }
  for (const entry of movements.entries) {
    if (entry.date > asOf) continue;
    const net = paisa(entry.credit) - paisa(entry.debit);
    switch (entry.type) {
      case 'opening':
        totals.opening += net;
        break;
      case 'contribution':
        addOwn(entry.date, net);
        break;
      case 'interest':
        totals.interest += net;
        year(entry.date).interest += net;
        break;
      case 'adjustment':
        totals.adjustments += net;
        break;
      case 'withdrawal':
        totals.withdrawn -= net;
        year(entry.date).withdrawn -= net;
        break;
      case 'settlement':
        totals.settled -= net;
        break;
    }
  }
  const match = (own: number) => Math.round((own * matchPercent) / 100);
  const employer = [...years.values()].reduce((sum, entry) => sum + match(entry.own), 0);
  const balance =
    totals.opening + totals.own + employer + totals.interest + totals.adjustments - totals.withdrawn - totals.settled;
  return {
    opening: taka(totals.opening),
    own: taka(totals.own),
    employer: taka(employer),
    interest: taka(totals.interest),
    adjustments: taka(totals.adjustments),
    withdrawn: taka(totals.withdrawn),
    settled: taka(totals.settled),
    balance: taka(balance),
    years: [...years.entries()]
      .sort(([a], [b]) => a - b)
      .map(([key, entry]) => ({
        year: key,
        own: taka(entry.own),
        employer: taka(match(entry.own)),
        interest: taka(entry.interest),
        withdrawn: taka(entry.withdrawn),
      })),
  };
}

/**
 * Shares `total` among the members in proportion to their balances, to the paisa: each gets the floor of
 * their exact share and the paisa left over go to the largest remainders (earlier members first on ties).
 * Members with nothing in the fund get nothing.
 */
export function allocateInterest(
  total: number,
  members: readonly { readonly staffId: string; readonly balance: number }[],
): { staffId: string; amount: number }[] {
  const eligible = members
    .map((member) => ({ staffId: member.staffId, weight: BigInt(paisa(member.balance)) }))
    .filter((member) => member.weight > 0n);
  if (eligible.length === 0) throw new DomainError('no_pf_balance', 'Nobody has a PF balance to earn interest on');
  const pot = BigInt(paisa(total));
  const base = eligible.reduce((sum, member) => sum + member.weight, 0n);
  const shares = eligible.map((member, index) => ({
    staffId: member.staffId,
    index,
    paisa: (pot * member.weight) / base,
    remainder: (pot * member.weight) % base,
  }));
  let left = pot - shares.reduce((sum, share) => sum + share.paisa, 0n);
  const byRemainder = [...shares].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const share of byRemainder) {
    if (left === 0n) break;
    share.paisa += 1n;
    left -= 1n;
  }
  return shares.map((share) => ({ staffId: share.staffId, amount: taka(Number(share.paisa)) }));
}
