import { sql } from 'drizzle-orm';
import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { DashboardSection } from '../../../../shared/application/dashboards.js';
import { sqlHead } from '../../../../shared/infrastructure/persistence/dashboard-heads.js';
import { canteenOutlets, canteenSales } from '../persistence/canteen.schema.js';

const outlet = {
  label: 'Outlet',
  expr: sql`(select ${canteenOutlets.name} from ${canteenOutlets} where ${canteenOutlets.id} = ${canteenSales.outletId})`,
};
const customer = { label: 'Customer', expr: sql`${canteenSales.customerKind}` };

/** Old canteen dashboard: sales, their value and what was left on credit, on the sale day. */
export function canteenDashboard(context: DbContext): DashboardSection {
  const head = (spec: Parameters<typeof sqlHead>[1]) => sqlHead(context, spec);
  const billed = sql`${canteenSales.status} = 'billed'`;
  return {
    key: 'canteen',
    title: 'Canteen',
    order: 60,
    permissions: ['canteen:read'],
    heads: [
      head({
        key: 'canteen.sales',
        label: 'Canteen sales',
        unit: 'count',
        from: sql`${canteenSales}`,
        day: () => sql`${canteenSales.soldOn}`,
        where: () => billed,
        value: sql`count(*)`,
        dimensions: { outlet, customer, user: { label: 'Sold by', expr: sql`${canteenSales.soldBy}`, users: true } },
      }),
      head({
        key: 'canteen.sold',
        label: 'Canteen sales value',
        unit: 'money',
        from: sql`${canteenSales}`,
        day: () => sql`${canteenSales.soldOn}`,
        where: () => billed,
        value: sql`sum(${canteenSales.net})`,
        dimensions: { outlet, customer, user: { label: 'Sold by', expr: sql`${canteenSales.soldBy}`, users: true } },
      }),
      head({
        key: 'canteen.credit',
        label: 'Canteen credit',
        unit: 'money',
        hint: 'Left due by members and staff',
        from: sql`${canteenSales}`,
        day: () => sql`${canteenSales.soldOn}`,
        where: () => sql`${billed} and ${canteenSales.due} > 0`,
        value: sql`sum(${canteenSales.due})`,
        dimensions: { customer, outlet },
      }),
    ],
  };
}
