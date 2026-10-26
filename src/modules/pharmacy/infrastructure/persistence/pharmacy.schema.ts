import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
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
import { glAccounts, vouchers } from '../../../accounts/infrastructure/persistence/accounts.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { suppliers } from '../../../supply-chain/infrastructure/persistence/supply-chain.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const day = (name: string) => date(name, { mode: 'string' });
const money = (name: string) => numeric(name, { precision: 14, scale: 2, mode: 'number' });
const percent = (name: string) => numeric(name, { precision: 5, scale: 2, mode: 'number' });
const unitCost = (name: string) => numeric(name, { precision: 16, scale: 4, mode: 'number' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const nameLength = (table: string, column: SQLWrapper, max = 150) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and ${sql.raw(String(max))}`);
/** A plain named master: unique name ignoring case. */
const named = <E extends Record<string, ReturnType<typeof text>>>(table: string, max: number, extra = {} as E) =>
  pgTable(table, { id: uuid('id').primaryKey(), name: text('name').notNull(), ...extra, ...timestamps }, (t) => [
    uniqueIndex(`${table}_name_uq`).on(sql`upper(${t.name})`),
    nameLength(table, t.name, max),
  ]);

// Old Pharmacy.Groups: therapeutic groups of generics (antibiotic, antacid…).
export const genericGroups = named('pharmacy_generic_groups', 100, { info: text('info') });

// Old Pharmacy.Generics: the active ingredient (paracetamol), under a group.
export const generics = pgTable(
  'pharmacy_generics',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    groupId: uuid('group_id').references(() => genericGroups.id, { onDelete: 'restrict' }),
    info: text('info'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_generics_name_uq').on(sql`upper(${t.name})`),
    index('pharmacy_generics_group_idx').on(t.groupId),
    nameLength('pharmacy_generics', t.name, 200),
  ],
);

// Old Pharmacy.Formations: tablet, syrup, injection…, with the short form printed after the brand (Tab., Syp.).
export const formations = named('pharmacy_formations', 60, { shortName: text('short_name') });

// Old Pharmacy.Strengths: 500 mg, 5 mg/5 ml…
export const strengths = named('pharmacy_strengths', 60);

// Old Pharmacy.Units and PackageUnits: what one is sold by (pcs, bottle) and what it is bought in (box, strip).
export const units = named('pharmacy_units', 30);
export const packageUnits = named('pharmacy_package_units', 30);

// Old Pharmacy.Manufacturers.
export const manufacturers = named('pharmacy_manufacturers', 150);

// Old Pharmacy.BrandNames: a manufacturer's brand (Napa). The old SubCategoryId is not ported.
export const brands = pgTable(
  'pharmacy_brands',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    manufacturerId: uuid('manufacturer_id')
      .notNull()
      .references(() => manufacturers.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_brands_name_uq').on(t.manufacturerId, sql`upper(${t.name})`),
    nameLength('pharmacy_brands', t.name, 150),
  ],
);

// Old Pharmacy.BrandExtensions: what is stocked and sold — a brand in a formation and strength (Napa Tab. 500 mg),
// its generic, the unit it is sold by, the pack it is bought in and how many units a pack holds, prices and
// barcode. The old free-text Unit / PkgUnit become the unit masters; TurnOver is not ported.
export const products = pgTable(
  'pharmacy_products',
  {
    id: uuid('id').primaryKey(),
    brandId: uuid('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'restrict' }),
    genericId: uuid('generic_id')
      .notNull()
      .references(() => generics.id, { onDelete: 'restrict' }),
    formationId: uuid('formation_id')
      .notNull()
      .references(() => formations.id, { onDelete: 'restrict' }),
    strengthId: uuid('strength_id').references(() => strengths.id, { onDelete: 'restrict' }),
    unitId: uuid('unit_id').references(() => units.id, { onDelete: 'restrict' }),
    packageUnitId: uuid('package_unit_id').references(() => packageUnits.id, { onDelete: 'restrict' }),
    unitsPerPack: integer('units_per_pack').notNull().default(1),
    purchasePrice: money('purchase_price').notNull().default(0),
    salePrice: money('sale_price').notNull().default(0),
    barcode: text('barcode'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_products_uq').on(
      t.brandId,
      t.formationId,
      sql`coalesce(${t.strengthId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    uniqueIndex('pharmacy_products_barcode_uq')
      .on(t.barcode)
      .where(sql`${t.barcode} is not null`),
    index('pharmacy_products_generic_idx').on(t.genericId),
    check(
      'pharmacy_products_amounts_ck',
      sql`${t.purchasePrice} >= 0 and ${t.salePrice} >= 0 and ${t.unitsPerPack} between 1 and 10000`,
    ),
    check('pharmacy_products_barcode_ck', sql`${t.barcode} is null or char_length(${t.barcode}) between 1 and 64`),
  ],
);

// Old Pharmacy.MedicineOutlets: the pharmacy counters and stores (outdoor, indoor, central store).
export const outlets = pgTable(
  'pharmacy_outlets',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    code: text('code'),
    description: text('description'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_outlets_name_uq').on(sql`upper(${t.name})`),
    uniqueIndex('pharmacy_outlets_code_uq')
      .on(sql`upper(${t.code})`)
      .where(sql`${t.code} is not null`),
    nameLength('pharmacy_outlets', t.name, 100),
  ],
);

// Old Pharmacy.PharmacistDutyOutlets: who works at (sells from, receives into) an outlet.
export const outletUsers = pgTable(
  'pharmacy_outlet_users',
  {
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_outlet_users_uq').on(t.outletId, t.userId),
    index('pharmacy_outlet_users_user_idx').on(t.userId),
  ],
);

// Old Pharmacy.ROLRecords (an int outlet id): the reorder level of a product at an outlet.
export const reorderLevels = pgTable(
  'pharmacy_reorder_levels',
  {
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_reorder_levels_uq').on(t.outletId, t.productId),
    index('pharmacy_reorder_levels_product_idx').on(t.productId),
    check('pharmacy_reorder_levels_level_ck', sql`${t.level} between 0 and 10000000`),
  ],
);

// Document numbers per kind and year (PO-2026-00001).
export const pharmacySequences = pgTable(
  'pharmacy_sequences',
  {
    kind: text('kind').notNull(),
    year: smallint('year').notNull(),
    last: integer('last').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.year] })],
);

// Old Pharmacy.LotRecords and the lot columns of Stocks: one lot per product, batch, expiry and sale rate (the old
// stock row was keyed by product, expiry and outlet only, so a second receive of the same expiry kept the first
// receive's rates).
export const pharmacyLots = pgTable(
  'pharmacy_lots',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    batchNo: text('batch_no'),
    expiryDate: day('expiry_date').notNull(),
    /** What one unit of this lot sells for (the MRP printed on it). */
    saleRate: money('sale_rate').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pharmacy_lots_uq').on(t.productId, sql`coalesce(upper(${t.batchNo}), '')`, t.expiryDate, t.saleRate),
    index('pharmacy_lots_expiry_idx').on(t.expiryDate),
    check('pharmacy_lots_sale_rate_ck', sql`${t.saleRate} >= 0`),
  ],
);

export const PHARMACY_MOVEMENT_KINDS = ['opening', 'receive', 'supplier_return', 'replacement'] as const;

// Every unit in or out of an outlet, by lot, with its unit cost; stock is the sum (old Stocks.AvailableStock and
// StockFlows, written by separate commits).
export const pharmacyMovements = pgTable(
  'pharmacy_movements',
  {
    id: uuid('id').primaryKey(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitCost: unitCost('unit_cost').notNull(),
    movedOn: day('moved_on').notNull(),
    kind: text('kind', { enum: PHARMACY_MOVEMENT_KINDS }).notNull(),
    documentId: uuid('document_id').notNull(),
    documentNumber: text('document_number').notNull(),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('pharmacy_movements_outlet_idx').on(t.outletId, t.productId, t.movedOn),
    index('pharmacy_movements_lot_idx').on(t.lotId),
    index('pharmacy_movements_document_idx').on(t.documentId),
    check('pharmacy_movements_qty_ck', sql`${t.qty} <> 0 and ${t.unitCost} >= 0`),
    check('pharmacy_movements_kind_ck', sql`${t.kind} in ('opening', 'receive', 'supplier_return', 'replacement')`),
  ],
);

// Opening stock entered per outlet (old: typed straight into Stocks).
export const pharmacyOpenings = pgTable(
  'pharmacy_openings',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    openedOn: day('opened_on').notNull(),
    note: text('note'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('pharmacy_openings_number_uq').on(t.number)],
);

// Old Pharmacy.PurchaseOrders / PurchaseOrderDetails (status text per order and line).
export const pharmacyOrders = pgTable(
  'pharmacy_purchase_orders',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    orderDate: day('order_date').notNull(),
    note: text('note'),
    status: text('status', { enum: ['open', 'partly_received', 'received', 'closed', 'cancelled'] }).notNull(),
    closeReason: text('close_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_purchase_orders_number_uq').on(t.number),
    index('pharmacy_purchase_orders_supplier_idx').on(t.supplierId, t.status),
    check(
      'pharmacy_purchase_orders_status_ck',
      sql`${t.status} in ('open', 'partly_received', 'received', 'closed', 'cancelled')`,
    ),
  ],
);

export const pharmacyOrderLines = pgTable(
  'pharmacy_purchase_order_lines',
  {
    orderId: uuid('order_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    receivedQty: integer('received_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.position] }),
    foreignKey({
      name: 'pharmacy_purchase_order_lines_fk',
      columns: [t.orderId],
      foreignColumns: [pharmacyOrders.id],
    }).onDelete('cascade'),
    uniqueIndex('pharmacy_purchase_order_lines_product_uq').on(t.orderId, t.productId),
    check('pharmacy_purchase_order_lines_qty_ck', sql`${t.qty} > 0 and ${t.receivedQty} between 0 and ${t.qty}`),
  ],
);

// Old Pharmacy.StockReceives / StockReceiveDetails / RceivePurchOrders.
export const pharmacyReceives = pgTable(
  'pharmacy_receives',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id').references(() => pharmacyOrders.id, { onDelete: 'restrict' }),
    receivedOn: day('received_on').notNull(),
    supplierInvoiceNo: text('supplier_invoice_no'),
    supplierInvoiceDate: day('supplier_invoice_date'),
    challanNo: text('challan_no'),
    remarks: text('remarks'),
    status: text('status', { enum: ['draft', 'posted'] }).notNull(),
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    vat: money('vat').notNull(),
    total: money('total').notNull(),
    voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    postedBy: uuid('posted_by').references(() => users.id, { onDelete: 'set null' }),
    postedAt: tz('posted_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_receives_number_uq').on(t.number),
    uniqueIndex('pharmacy_receives_invoice_uq')
      .on(t.supplierId, sql`upper(${t.supplierInvoiceNo})`)
      .where(sql`${t.supplierInvoiceNo} is not null`),
    index('pharmacy_receives_date_idx').on(t.receivedOn),
    check('pharmacy_receives_status_ck', sql`${t.status} in ('draft', 'posted')`),
  ],
);

export const pharmacyReceiveLines = pgTable(
  'pharmacy_receive_lines',
  {
    receiveId: uuid('receive_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id').references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    /** Free units the supplier adds; they go into stock and share the line cost. */
    bonusQty: integer('bonus_qty').notNull().default(0),
    purchaseRate: unitCost('purchase_rate').notNull(),
    saleRate: money('sale_rate').notNull(),
    discountPercent: percent('discount_percent').notNull(),
    vatPercent: percent('vat_percent').notNull(),
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    vat: money('vat').notNull(),
    total: money('total').notNull(),
    batchNo: text('batch_no'),
    expiryDate: day('expiry_date').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.receiveId, t.position] }),
    foreignKey({
      name: 'pharmacy_receive_lines_fk',
      columns: [t.receiveId],
      foreignColumns: [pharmacyReceives.id],
    }).onDelete('cascade'),
    index('pharmacy_receive_lines_product_idx').on(t.productId),
    check('pharmacy_receive_lines_qty_ck', sql`${t.qty} > 0 and ${t.bonusQty} >= 0`),
  ],
);

// Old Pharmacy.SupplierPaymentRecords: one payment to a supplier, over one or more receives.
export const supplierPayments = pgTable(
  'pharmacy_supplier_payments',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    paidOn: day('paid_on').notNull(),
    method: text('method', { enum: ['cash', 'bank'] }).notNull(),
    /** The bank account paid from (method bank). */
    bankAccountId: uuid('bank_account_id').references(() => glAccounts.id, { onDelete: 'restrict' }),
    reference: text('reference'),
    remarks: text('remarks'),
    total: money('total').notNull(),
    voucherId: uuid('voucher_id').references(() => vouchers.id, { onDelete: 'set null' }),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pharmacy_supplier_payments_number_uq').on(t.number),
    index('pharmacy_supplier_payments_supplier_idx').on(t.supplierId, t.paidOn),
    check('pharmacy_supplier_payments_method_ck', sql`${t.method} in ('cash', 'bank')`),
    check(
      'pharmacy_supplier_payments_bank_ck',
      sql`(${t.method} = 'bank') = (${t.bankAccountId} is not null) and ${t.total} > 0`,
    ),
  ],
);

// Old SupplierPaymentRecordDetails: what a payment paid of each receive.
export const supplierPaymentLines = pgTable(
  'pharmacy_supplier_payment_lines',
  {
    paymentId: uuid('payment_id').notNull(),
    receiveId: uuid('receive_id')
      .notNull()
      .references(() => pharmacyReceives.id, { onDelete: 'restrict' }),
    /** Due before this payment. */
    dueBefore: money('due_before').notNull(),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.paymentId, t.receiveId] }),
    foreignKey({
      name: 'pharmacy_supplier_payment_lines_fk',
      columns: [t.paymentId],
      foreignColumns: [supplierPayments.id],
    }).onDelete('cascade'),
    index('pharmacy_supplier_payment_lines_receive_idx').on(t.receiveId),
    check('pharmacy_supplier_payment_lines_amount_ck', sql`${t.amount} > 0 and ${t.amount} <= ${t.dueBefore}`),
  ],
);

// Old Pharmacy.SupplierReturnIndents / Details: medicines sent back to a supplier from an outlet, and what the
// supplier sends in their place.
export const supplierReturns = pgTable(
  'pharmacy_supplier_returns',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id, { onDelete: 'restrict' }),
    returnDate: day('return_date').notNull(),
    reason: text('reason').notNull(),
    status: text('status', { enum: ['draft', 'sent', 'partly_settled', 'settled', 'closed'] }).notNull(),
    /** Purchase value of what was sent (frozen when sent). */
    value: money('value').notNull(),
    /** Value of the replacements received so far. */
    settledValue: money('settled_value').notNull(),
    sentVoucherNumber: text('sent_voucher_number'),
    closeReason: text('close_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_supplier_returns_number_uq').on(t.number),
    index('pharmacy_supplier_returns_supplier_idx').on(t.supplierId, t.status),
    check(
      'pharmacy_supplier_returns_status_ck',
      sql`${t.status} in ('draft', 'sent', 'partly_settled', 'settled', 'closed')`,
    ),
    check('pharmacy_supplier_returns_value_ck', sql`${t.settledValue} between 0 and ${t.value}`),
  ],
);

export const supplierReturnLines = pgTable(
  'pharmacy_supplier_return_lines',
  {
    returnId: uuid('return_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    /** The lot's cost at the outlet, frozen when sent. */
    unitCost: unitCost('unit_cost'),
    value: money('value'),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.position] }),
    foreignKey({
      name: 'pharmacy_supplier_return_lines_fk',
      columns: [t.returnId],
      foreignColumns: [supplierReturns.id],
    }).onDelete('cascade'),
    uniqueIndex('pharmacy_supplier_return_lines_lot_uq').on(t.returnId, t.lotId),
    check('pharmacy_supplier_return_lines_qty_ck', sql`${t.qty} > 0`),
  ],
);

// Replacements received against a supplier return (old ReceiveSupplierReturnCommand, status 18 lines).
export const supplierReturnSettlements = pgTable(
  'pharmacy_supplier_return_settlements',
  {
    id: uuid('id').primaryKey(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => supplierReturns.id, { onDelete: 'cascade' }),
    settledOn: day('settled_on').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    purchaseRate: unitCost('purchase_rate').notNull(),
    value: money('value').notNull(),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('pharmacy_supplier_return_settlements_return_idx').on(t.returnId),
    check('pharmacy_supplier_return_settlements_ck', sql`${t.qty} > 0 and ${t.value} >= 0`),
  ],
);
