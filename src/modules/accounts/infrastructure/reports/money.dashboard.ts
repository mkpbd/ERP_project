import { sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import { glRoles, voucherLines, vouchers } from '../persistence/accounts.schema.js';

/** Where every desk receives money (the hospital's, the pharmacy's and the canteen's alike). */
const RECEIPT_ROLES = ['cash_in_hand', 'card_receipts', 'mobile_wallet_receipts'];
const WAYS: Record<string, string> = {
  cash_in_hand: 'Cash',
  card_receipts: 'Card',
  mobile_wallet_receipts: 'Mobile wallet',
};

const receiptRoles = sql.join(
  RECEIPT_ROLES.map((role) => sql`${role}`),
  sql`, `,
);
/** The desks' voucher lines. */
const receipts = sql`${voucherLines} join ${vouchers} on ${vouchers.id} = ${voucherLines.voucherId}`;
/** On a receipt account (an account with two receipt roles still counts once). */
const onReceiptAccount = sql`exists (select 1 from ${glRoles} where ${glRoles.glAccountId} = ${voucherLines.glAccountId}
  and ${glRoles.role} in (${receiptRoles}))`;
const way = {
  label: 'Way paid',
  expr: sql`(select min(case ${glRoles.role} ${sql.join(
    Object.entries(WAYS).map(([role, label]) => sql`when ${role} then ${label}`),
    sql` `,
  )} end) from ${glRoles} where ${glRoles.glAccountId} = ${voucherLines.glAccountId} and ${glRoles.role} in (${receiptRoles}))`,
};
const desk = {
  label: 'Desk',
  expr: sql`initcap(replace(${vouchers.sourceModule}, '-', ' '))`,
};
const user = { label: 'Posted by', expr: sql`${vouchers.postedBy}`, users: true };

/**
 * Old management dashboard's collection (dbo.fnMgmtDashboardCollection): money taken in and paid back by every desk,
 * from the books: the desks' vouchers (hospital, pharmacy, canteen, …) on the cash, card and wallet accounts.
 * Journals entered by hand (bank deposits, expenses) are left out.
 */
export function moneyDashboard(context: DbContext): DashboardSection {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  const desks = () =>
    sql`${vouchers.sourceModule} is not null and ${vouchers.status} <> 'draft' and ${onReceiptAccount}`;
  return {
    key: 'money',
    title: 'Money',
    order: 0,
    permissions: ['dashboard:finance'],
    heads: [
      head({
        key: 'money.received',
        label: 'Collected',
        unit: 'money',
        hint: 'Taken in at the desks: bills, advances, sales, dues',
        from: receipts,
        day: () => sql`${vouchers.voucherDate}`,
        where: desks,
        value: sql`sum(${voucherLines.debit})`,
        dimensions: { desk, way, user },
      }),
      head({
        key: 'money.paid-back',
        label: 'Paid back',
        unit: 'money',
        hint: 'Refunds, advances returned, payments out at the desks',
        from: receipts,
        day: () => sql`${vouchers.voucherDate}`,
        where: desks,
        value: sql`sum(${voucherLines.credit})`,
        dimensions: { desk, way, user },
      }),
      head({
        key: 'money.net',
        label: 'Net collection',
        unit: 'money',
        from: receipts,
        day: () => sql`${vouchers.voucherDate}`,
        where: desks,
        value: sql`sum(${voucherLines.debit} - ${voucherLines.credit})`,
        dimensions: { desk, way, user },
      }),
    ],
  };
}
