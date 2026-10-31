import { sql, type SQLWrapper } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import {
  outlets,
  pharmacyLots,
  pharmacyMovements,
  pharmacyReceives,
  pharmacySales,
  saleReturns,
  wardIssues,
} from '../persistence/pharmacy.schema.js';

const outletOf = (column: SQLWrapper) => ({
  label: 'Outlet',
  expr: sql`(select ${outlets.name} from ${outlets} where ${outlets.id} = ${column})`,
});
const debtor = sql`case when ${pharmacySales.loyalMemberId} is not null then 'Loyal member'
  when ${pharmacySales.corporateClientId} is not null then 'Company'
  when ${pharmacySales.staffId} is not null then 'Staff' else 'None' end`;
/** Lots each outlet holds now, with what they cost. */
const holdings = sql`(select ${pharmacyMovements.outletId} as outlet_id, ${pharmacyMovements.lotId} as lot_id,
  sum(${pharmacyMovements.qty}) as qty, sum(${pharmacyMovements.qty} * ${pharmacyMovements.unitCost}) as value
  from ${pharmacyMovements} group by 1, 2 having sum(${pharmacyMovements.qty}) > 0) as held`;
const heldOutlet = {
  label: 'Outlet',
  expr: sql`(select ${outlets.name} from ${outlets} where ${outlets.id} = held.outlet_id)`,
};

/**
 * Old pharmacy dashboard: counter sales, discounts, returns, credit sales, ward medicine, purchases, the stock now
 * and what expires soon. Counter sales count when completed, on their sale day.
 */
export function pharmacyDashboard(context: DbContext): DashboardSection {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  const completed = sql`${pharmacySales.status} = 'completed'`;
  return {
    key: 'pharmacy',
    title: 'Pharmacy',
    order: 50,
    permissions: ['pharmacy:read'],
    heads: [
      head({
        key: 'pharmacy.sales',
        label: 'Counter sales',
        unit: 'count',
        from: sql`${pharmacySales}`,
        day: () => sql`${pharmacySales.soldOn}`,
        where: () => completed,
        value: sql`count(*)`,
        dimensions: {
          outlet: outletOf(pharmacySales.outletId),
          user: { label: 'Sold by', expr: sql`${pharmacySales.soldBy}`, users: true },
        },
      }),
      head({
        key: 'pharmacy.sold',
        label: 'Counter sales value',
        unit: 'money',
        hint: 'Net of discounts, before returns',
        from: sql`${pharmacySales}`,
        day: () => sql`${pharmacySales.soldOn}`,
        where: () => completed,
        value: sql`sum(${pharmacySales.total})`,
        dimensions: {
          outlet: outletOf(pharmacySales.outletId),
          user: { label: 'Sold by', expr: sql`${pharmacySales.soldBy}`, users: true },
          method: { label: 'Way paid', expr: sql`${pharmacySales.method}` },
        },
      }),
      head({
        key: 'pharmacy.discount',
        label: 'Counter discount',
        unit: 'money',
        from: sql`${pharmacySales}`,
        day: () => sql`${pharmacySales.soldOn}`,
        where: () => completed,
        value: sql`sum(${pharmacySales.discount})`,
        dimensions: { outlet: outletOf(pharmacySales.outletId) },
      }),
      head({
        key: 'pharmacy.returns',
        label: 'Returns',
        unit: 'money',
        hint: 'Refunded, in cash or off the due',
        from: sql`${saleReturns}`,
        day: () => sql`${saleReturns.returnedOn}`,
        value: sql`sum(${saleReturns.refund})`,
        dimensions: {
          outlet: outletOf(saleReturns.outletId),
          user: { label: 'Taken back by', expr: sql`${saleReturns.createdBy}`, users: true },
        },
      }),
      head({
        key: 'pharmacy.credit',
        label: 'Credit sales',
        unit: 'money',
        hint: 'Left due: members, companies and staff',
        from: sql`${pharmacySales}`,
        day: () => sql`${pharmacySales.soldOn}`,
        where: () => sql`${completed} and ${pharmacySales.due} > 0`,
        value: sql`sum(${pharmacySales.due})`,
        dimensions: { debtor: { label: 'Owed by', expr: debtor }, outlet: outletOf(pharmacySales.outletId) },
      }),
      head({
        key: 'pharmacy.ward',
        label: 'Ward medicine',
        unit: 'money',
        hint: 'Sent to admitted patients, less what came back',
        from: sql`${wardIssues}`,
        day: () => sql`${wardIssues.issuedOn}`,
        value: sql`sum(${wardIssues.total} - ${wardIssues.returned})`,
        dimensions: { outlet: outletOf(wardIssues.outletId) },
      }),
      head({
        key: 'pharmacy.purchased',
        label: 'Purchases received',
        unit: 'money',
        from: sql`${pharmacyReceives}`,
        day: () => sql`${pharmacyReceives.receivedOn}`,
        where: () => sql`${pharmacyReceives.status} = 'posted'`,
        value: sql`sum(${pharmacyReceives.total})`,
        dimensions: { outlet: outletOf(pharmacyReceives.outletId) },
      }),
      head({
        key: 'pharmacy.stock-value',
        label: 'Stock at cost now',
        unit: 'money',
        from: holdings,
        value: sql`sum(held.value)`,
        dimensions: { outlet: heldOutlet },
      }),
      head({
        key: 'pharmacy.expiring',
        label: 'Lots expiring in 90 days',
        unit: 'count',
        finance: false,
        hint: 'Held now, expiring from today to 90 days on',
        from: sql`${holdings} join ${pharmacyLots} on ${pharmacyLots.id} = held.lot_id`,
        where: (range) => sql`${pharmacyLots.expiryDate} between ${range.today}::date and ${range.today}::date + 90`,
        value: sql`count(*)`,
        dimensions: { outlet: heldOutlet },
      }),
    ],
  };
}
