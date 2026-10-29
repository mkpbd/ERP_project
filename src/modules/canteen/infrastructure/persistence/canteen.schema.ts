import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { staffRecords } from '../../../hr/infrastructure/persistence/hr.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import {
  itemVariants,
  storeDepartments,
} from '../../../supply-chain/infrastructure/persistence/supply-chain.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 12, scale: 2, mode: 'number' });
const qty = (name: string) => numeric(name, { precision: 12, scale: 3, mode: 'number' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
// The same lists as the domain's (kept literal here so drizzle-kit loads this file on its own).
const CUSTOMER_KINDS = ['walk_in', 'staff', 'member'] as const;

// Document numbers of the canteen: one counter per kind and year.
export const canteenSequences = pgTable(
  'canteen_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old Canteen.CanteenGroup: snacks, meals, drinks …
export const canteenGroups = pgTable(
  'canteen_groups',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('canteen_groups_name_uq').on(sql`lower(${t.name})`)],
);

// Old Canteen.Item: what the canteen sells, at the general and the staff rate, with VAT. A packaged item is a store
// item of the supply chain, used up from the outlet's store department when sold; cooked food is not.
export const canteenItems = pgTable(
  'canteen_items',
  {
    id: uuid('id').primaryKey(),
    code: text('code'),
    name: text('name').notNull(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => canteenGroups.id, { onDelete: 'restrict' }),
    unit: text('unit').notNull(),
    rate: money('rate').notNull(),
    staffRate: money('staff_rate').notNull(),
    vatPercent: numeric('vat_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
    stockVariantId: uuid('stock_variant_id').references(() => itemVariants.id, { onDelete: 'restrict' }),
    /** Store units used up per unit sold. */
    stockQty: qty('stock_qty').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('canteen_items_code_uq').on(sql`upper(${t.code})`),
    uniqueIndex('canteen_items_name_uq').on(sql`lower(${t.name})`),
    check('canteen_items_rates_ck', sql`${t.rate} >= 0 and ${t.staffRate} >= 0 and ${t.stockQty} > 0`),
    check('canteen_items_vat_ck', sql`${t.vatPercent} between 0 and 100`),
  ],
);

// Old Canteen.CanteenOutlet: a counter, and the store department its packaged goods come from.
export const canteenOutlets = pgTable(
  'canteen_outlets',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description'),
    storeDepartmentId: uuid('store_department_id').references(() => storeDepartments.id, { onDelete: 'restrict' }),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('canteen_outlets_name_uq').on(sql`lower(${t.name})`)],
);

// Old SalesmanDutyOutlet: who sells at an outlet.
export const canteenOutletUsers = pgTable(
  'canteen_outlet_users',
  {
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => canteenOutlets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.outletId, t.userId] })],
);

// Old LoyalMember: a regular customer who may eat on credit.
export const canteenMembers = pgTable(
  'canteen_members',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    mobileNo: text('mobile_no').notNull(),
    address: text('address'),
    reference: text('reference'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('canteen_members_mobile_uq').on(t.mobileNo)],
);

// Old SaleInvoice with SaleLedger: a sale at an outlet to a walk-in customer, a staff member (staff rates) or a member
// (who may leave a due).
export const canteenSales = pgTable(
  'canteen_sales',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => canteenOutlets.id, { onDelete: 'restrict' }),
    soldOn: day('sold_on').notNull(),
    soldAt: tz('sold_at').notNull(),
    customerKind: text('customer_kind', { enum: CUSTOMER_KINDS }).notNull(),
    staffId: uuid('staff_id').references(() => staffRecords.id, { onDelete: 'restrict' }),
    memberId: uuid('member_id').references(() => canteenMembers.id, { onDelete: 'restrict' }),
    customerName: text('customer_name'),
    gross: money('gross').notNull(),
    discount: money('discount').notNull(),
    vat: money('vat').notNull(),
    net: money('net').notNull(),
    paid: money('paid').notNull(),
    due: money('due').notNull(),
    status: text('status', { enum: ['billed', 'cancelled'] }).notNull(),
    cancelReason: text('cancel_reason'),
    /** The department consumption that used up its packaged goods; none when nothing was stocked or it was short. */
    consumptionNumber: text('consumption_number'),
    stockShort: boolean('stock_short').notNull().default(false),
    voucherNumber: text('voucher_number'),
    soldBy: uuid('sold_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: tz('cancelled_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('canteen_sales_number_uq').on(t.number),
    index('canteen_sales_day_idx').on(t.soldOn, t.outletId),
    index('canteen_sales_member_idx').on(t.memberId),
    check('canteen_sales_due_ck', sql`${t.due} = 0 or ${t.memberId} is not null`),
    check(
      'canteen_sales_customer_ck',
      sql`(${t.customerKind} = 'staff') = (${t.staffId} is not null) and (${t.customerKind} = 'member') = (${t.memberId} is not null)`,
    ),
    check(
      'canteen_sales_amounts_ck',
      sql`${t.discount} between 0 and ${t.gross} and ${t.net} = ${t.gross} - ${t.discount} + ${t.vat} and ${t.paid} + ${t.due} = ${t.net} and ${t.paid} >= 0 and ${t.due} >= 0`,
    ),
  ],
);

export const canteenSaleLines = pgTable(
  'canteen_sale_lines',
  {
    saleId: uuid('sale_id')
      .notNull()
      .references(() => canteenSales.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => canteenItems.id, { onDelete: 'restrict' }),
    qty: qty('qty').notNull(),
    rate: money('rate').notNull(),
    amount: money('amount').notNull(),
    vat: money('vat').notNull(),
  },
  (t) => [primaryKey({ columns: [t.saleId, t.position] }), check('canteen_sale_lines_qty_ck', sql`${t.qty} > 0`)],
);

// Old MemberDueCollectionInvoice / LoyalMemberLedger credit: money a member pays against their dues.
export const canteenCollections = pgTable(
  'canteen_collections',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => canteenMembers.id, { onDelete: 'restrict' }),
    receivedOn: day('received_on').notNull(),
    amount: money('amount').notNull(),
    note: text('note'),
    voucherNumber: text('voucher_number'),
    receivedBy: uuid('received_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('canteen_collections_number_uq').on(t.number),
    index('canteen_collections_member_idx').on(t.memberId),
    check('canteen_collections_amount_ck', sql`${t.amount} > 0`),
  ],
);
