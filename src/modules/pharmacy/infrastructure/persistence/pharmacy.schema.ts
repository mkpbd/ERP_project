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

export const PHARMACY_MOVEMENT_KINDS = [
  'opening',
  'receive',
  'supplier_return',
  'replacement',
  'transfer_out',
  'transfer_in',
  'sale',
  'sale_cancel',
  'sale_return',
  'count_adjustment',
] as const;

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
    check(
      'pharmacy_movements_kind_ck',
      sql`${t.kind} in ('opening', 'receive', 'supplier_return', 'replacement', 'transfer_out', 'transfer_in', 'sale', 'sale_cancel', 'sale_return', 'count_adjustment')`,
    ),
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

// Old Pharmacy.OutletIndents / OutletIndetDetails: an outlet asks another (usually the central store) for stock.
export const outletIndents = pgTable(
  'pharmacy_outlet_indents',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    /** The outlet that needs the stock (old FromOutletId). */
    requestingOutletId: uuid('requesting_outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    /** The outlet asked to send it (old ToOutletId). */
    supplyingOutletId: uuid('supplying_outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    indentDate: day('indent_date').notNull(),
    urgent: boolean('urgent').notNull().default(false),
    note: text('note'),
    status: text('status', {
      enum: ['open', 'partly_transferred', 'transferred', 'closed', 'cancelled'],
    }).notNull(),
    closeReason: text('close_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_outlet_indents_number_uq').on(t.number),
    index('pharmacy_outlet_indents_supplying_idx').on(t.supplyingOutletId, t.status),
    check(
      'pharmacy_outlet_indents_status_ck',
      sql`${t.status} in ('open', 'partly_transferred', 'transferred', 'closed', 'cancelled')`,
    ),
    check('pharmacy_outlet_indents_outlets_ck', sql`${t.requestingOutletId} <> ${t.supplyingOutletId}`),
  ],
);

export const outletIndentLines = pgTable(
  'pharmacy_outlet_indent_lines',
  {
    indentId: uuid('indent_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    transferredQty: integer('transferred_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.indentId, t.position] }),
    foreignKey({
      name: 'pharmacy_outlet_indent_lines_fk',
      columns: [t.indentId],
      foreignColumns: [outletIndents.id],
    }).onDelete('cascade'),
    uniqueIndex('pharmacy_outlet_indent_lines_product_uq').on(t.indentId, t.productId),
    check('pharmacy_outlet_indent_lines_qty_ck', sql`${t.qty} > 0 and ${t.transferredQty} between 0 and ${t.qty}`),
  ],
);

// Old Pharmacy.StockTransfers / StockTransferDetails and the accept side (a receive of type OutletRequisition):
// stock sent from one outlet to another, in transit until the receiving outlet accepts it.
export const outletTransfers = pgTable(
  'pharmacy_transfers',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    indentId: uuid('indent_id').references(() => outletIndents.id, { onDelete: 'restrict' }),
    fromOutletId: uuid('from_outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    toOutletId: uuid('to_outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    transferDate: day('transfer_date').notNull(),
    note: text('note'),
    status: text('status', { enum: ['in_transit', 'accepted', 'rejected'] }).notNull(),
    decidedOn: day('decided_on'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    rejectReason: text('reject_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_transfers_number_uq').on(t.number),
    index('pharmacy_transfers_to_idx').on(t.toOutletId, t.status),
    index('pharmacy_transfers_indent_idx').on(t.indentId),
    check('pharmacy_transfers_status_ck', sql`${t.status} in ('in_transit', 'accepted', 'rejected')`),
    check('pharmacy_transfers_outlets_ck', sql`${t.fromOutletId} <> ${t.toOutletId}`),
  ],
);

export const outletTransferLines = pgTable(
  'pharmacy_transfer_lines',
  {
    transferId: uuid('transfer_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    unitCost: unitCost('unit_cost').notNull(),
    /** Sent back by the receiving outlet. */
    rejected: boolean('rejected').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.transferId, t.position] }),
    foreignKey({
      name: 'pharmacy_transfer_lines_fk',
      columns: [t.transferId],
      foreignColumns: [outletTransfers.id],
    }).onDelete('cascade'),
    check('pharmacy_transfer_lines_qty_ck', sql`${t.qty} > 0 and ${t.unitCost} >= 0`),
  ],
);

// Old Pharmacy.ProductDiscountPolicies: the pharmacy-wide default discount (one row).
export const discountPolicy = pgTable(
  'pharmacy_discount_policy',
  {
    id: smallint('id').primaryKey(),
    allowedByDefault: boolean('allowed_by_default').notNull(),
    /** Over the counter (OPD). */
    opdPercent: percent('opd_percent').notNull(),
    /** Indoor patients; null = the same as over the counter. */
    ipdPercent: percent('ipd_percent'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('pharmacy_discount_policy_one_ck', sql`${t.id} = 1`),
    check(
      'pharmacy_discount_policy_percent_ck',
      sql`${t.opdPercent} between 0 and 100 and (${t.ipdPercent} is null or ${t.ipdPercent} between 0 and 100)`,
    ),
  ],
);

// Old Pharmacy.ProductDiscountSettings: a product's own discount rule.
export const productDiscounts = pgTable(
  'pharmacy_product_discounts',
  {
    id: uuid('id').primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    isAllowed: boolean('is_allowed').notNull(),
    /** Null = the policy's percent. */
    opdPercent: percent('opd_percent'),
    /** Null = the same as over the counter. */
    ipdPercent: percent('ipd_percent'),
    remarks: text('remarks'),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_product_discounts_product_uq').on(t.productId),
    check(
      'pharmacy_product_discounts_percent_ck',
      sql`(${t.opdPercent} is null or ${t.opdPercent} between 0 and 100) and (${t.ipdPercent} is null or ${t.ipdPercent} between 0 and 100)`,
    ),
  ],
);

// Old Pharmacy.PLoyalMembers: regular customers who may buy on credit.
export const loyalMembers = pgTable(
  'pharmacy_loyal_members',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    contactNo: text('contact_no').notNull(),
    referenceName: text('reference_name'),
    remarks: text('remarks'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_loyal_members_contact_uq').on(t.contactNo),
    nameLength('pharmacy_loyal_members', t.name, 150),
  ],
);

// Old Pharmacy.Invoices (ServeType OPD) / InvoiceDetails / InvoiceLedgers: a sale over the counter.
export const pharmacySales = pgTable(
  'pharmacy_sales',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    soldOn: day('sold_on').notNull(),
    customerName: text('customer_name'),
    mobileNo: text('mobile_no'),
    loyalMemberId: uuid('loyal_member_id').references(() => loyalMembers.id, { onDelete: 'restrict' }),
    /** Gross: units × sale rate. */
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    total: money('total').notNull(),
    method: text('method', { enum: ['cash', 'card', 'mobile'] }).notNull(),
    reference: text('reference'),
    /** What the customer handed over (cash may exceed the total; the rest is change). */
    tendered: money('tendered').notNull(),
    paid: money('paid').notNull(),
    due: money('due').notNull(),
    /** Collected later against the due. */
    collected: money('collected').notNull().default(0),
    /** Value refunded by returns (step 8f). */
    returned: money('returned').notNull().default(0),
    /** The part of the refunds that took the due down instead of being paid back. */
    dueReturned: money('due_returned').notNull().default(0),
    cost: money('cost').notNull(),
    status: text('status', { enum: ['completed', 'cancelled'] }).notNull(),
    cancelReason: text('cancel_reason'),
    cancelledOn: day('cancelled_on'),
    voucherNumber: text('voucher_number'),
    cancelVoucherNumber: text('cancel_voucher_number'),
    soldBy: uuid('sold_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledBy: uuid('cancelled_by').references(() => users.id, { onDelete: 'set null' }),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_sales_number_uq').on(t.number),
    index('pharmacy_sales_outlet_idx').on(t.outletId, t.soldOn),
    index('pharmacy_sales_member_idx').on(t.loyalMemberId),
    check('pharmacy_sales_status_ck', sql`${t.status} in ('completed', 'cancelled')`),
    check('pharmacy_sales_method_ck', sql`${t.method} in ('cash', 'card', 'mobile')`),
    check(
      'pharmacy_sales_amounts_ck',
      sql`${t.total} = ${t.amount} - ${t.discount} and ${t.paid} + ${t.due} = ${t.total} and ${t.collected} + ${t.dueReturned} between 0 and ${t.due} and ${t.returned} between 0 and ${t.total}`,
    ),
    check('pharmacy_sales_due_member_ck', sql`${t.due} = 0 or ${t.loyalMemberId} is not null`),
  ],
);

export const pharmacySaleLines = pgTable(
  'pharmacy_sale_lines',
  {
    saleId: uuid('sale_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    saleRate: money('sale_rate').notNull(),
    unitCost: unitCost('unit_cost').notNull(),
    amount: money('amount').notNull(),
    discountPercent: percent('discount_percent').notNull(),
    discount: money('discount').notNull(),
    total: money('total').notNull(),
    /** Units given back by returns. */
    returnedQty: integer('returned_qty').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.saleId, t.position] }),
    foreignKey({ name: 'pharmacy_sale_lines_fk', columns: [t.saleId], foreignColumns: [pharmacySales.id] }).onDelete(
      'cascade',
    ),
    index('pharmacy_sale_lines_product_idx').on(t.productId),
    check('pharmacy_sale_lines_qty_ck', sql`${t.qty} > 0 and ${t.returnedQty} between 0 and ${t.qty}`),
  ],
);

// Old PLoyalMemberLedger "due collection": money a loyal member pays against dues, oldest invoice first.
export const dueCollections = pgTable(
  'pharmacy_due_collections',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    loyalMemberId: uuid('loyal_member_id')
      .notNull()
      .references(() => loyalMembers.id, { onDelete: 'restrict' }),
    collectedOn: day('collected_on').notNull(),
    method: text('method', { enum: ['cash', 'card', 'mobile'] }).notNull(),
    reference: text('reference'),
    amount: money('amount').notNull(),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pharmacy_due_collections_number_uq').on(t.number),
    index('pharmacy_due_collections_member_idx').on(t.loyalMemberId),
    check('pharmacy_due_collections_amount_ck', sql`${t.amount} > 0`),
  ],
);

export const dueCollectionLines = pgTable(
  'pharmacy_due_collection_lines',
  {
    collectionId: uuid('collection_id').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => pharmacySales.id, { onDelete: 'restrict' }),
    amount: money('amount').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.collectionId, t.saleId] }),
    foreignKey({
      name: 'pharmacy_due_collection_lines_fk',
      columns: [t.collectionId],
      foreignColumns: [dueCollections.id],
    }).onDelete('cascade'),
    check('pharmacy_due_collection_lines_amount_ck', sql`${t.amount} > 0`),
  ],
);

// Old Pharmacy.PharmacyReturnPolicies (19-10-2026): how many days after a sale medicines may come back, per channel.
export const returnPolicies = pgTable(
  'pharmacy_return_policies',
  {
    channel: text('channel', { enum: ['opd', 'ipd'] }).primaryKey(),
    isEnabled: boolean('is_enabled').notNull(),
    days: smallint('days').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('pharmacy_return_policies_channel_ck', sql`${t.channel} in ('opd', 'ipd')`),
    check('pharmacy_return_policies_days_ck', sql`${t.days} between 0 and 365`),
  ],
);

// Old ProcessOpdProductReturn (a return invoice with ServeType OPD return): medicines a customer brings back.
export const saleReturns = pgTable(
  'pharmacy_sale_returns',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => pharmacySales.id, { onDelete: 'restrict' }),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    returnedOn: day('returned_on').notNull(),
    reason: text('reason'),
    /** Gross: units × sale rate. */
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    /** What the customer gets back: amount less the discount given back. */
    refund: money('refund').notNull(),
    /** The part of the refund that took the sale's due down. */
    dueReduced: money('due_reduced').notNull(),
    /** Paid back by the sale's own method (column kept from the first version, when it was always cash). */
    paidBack: money('cash_refund').notNull(),
    cost: money('cost').notNull(),
    /** The part of the cost written off: units given back damaged or expired, not put back into stock. */
    damagedCost: money('damaged_cost').notNull().default(0),
    voucherNumber: text('voucher_number'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pharmacy_sale_returns_number_uq').on(t.number),
    index('pharmacy_sale_returns_sale_idx').on(t.saleId),
    check(
      'pharmacy_sale_returns_amounts_ck',
      sql`${t.refund} = ${t.amount} - ${t.discount} and ${t.refund} = ${t.dueReduced} + ${t.paidBack}`,
    ),
  ],
);

export const saleReturnLines = pgTable(
  'pharmacy_sale_return_lines',
  {
    returnId: uuid('return_id').notNull(),
    position: smallint('position').notNull(),
    /** The sale line given back (its position on the sale). */
    saleLine: smallint('sale_line').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    qty: integer('qty').notNull(),
    saleRate: money('sale_rate').notNull(),
    amount: money('amount').notNull(),
    discount: money('discount').notNull(),
    refund: money('refund').notNull(),
    unitCost: unitCost('unit_cost').notNull(),
    /** Damaged or expired: written off instead of put back into stock. */
    damaged: boolean('damaged').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.returnId, t.position] }),
    foreignKey({
      name: 'pharmacy_sale_return_lines_fk',
      columns: [t.returnId],
      foreignColumns: [saleReturns.id],
    }).onDelete('cascade'),
    check('pharmacy_sale_return_lines_qty_ck', sql`${t.qty} > 0`),
  ],
);

// Old Pharmacy.StockAudits / StockAuditDetails / AuditedStocks: an outlet's stock counted lot by lot as of a date, and
// the deviations applied in one go.
export const stockCounts = pgTable(
  'pharmacy_stock_counts',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    outletId: uuid('outlet_id')
      .notNull()
      .references(() => outlets.id, { onDelete: 'restrict' }),
    /** The stock counted is the stock at the end of this day. */
    countDate: day('count_date').notNull(),
    note: text('note'),
    status: text('status', { enum: ['counting', 'applied', 'cancelled'] }).notNull(),
    shortageValue: money('shortage_value').notNull().default(0),
    excessValue: money('excess_value').notNull().default(0),
    voucherNumber: text('voucher_number'),
    cancelReason: text('cancel_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    appliedBy: uuid('applied_by').references(() => users.id, { onDelete: 'set null' }),
    appliedAt: tz('applied_at'),
    version: integer('version').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('pharmacy_stock_counts_number_uq').on(t.number),
    index('pharmacy_stock_counts_outlet_idx').on(t.outletId, t.countDate),
    check('pharmacy_stock_counts_status_ck', sql`${t.status} in ('counting', 'applied', 'cancelled')`),
  ],
);

export const stockCountLines = pgTable(
  'pharmacy_stock_count_lines',
  {
    countId: uuid('count_id').notNull(),
    position: smallint('position').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => pharmacyLots.id, { onDelete: 'restrict' }),
    /** What the ledger held as of the count date when the count was opened (or when the lot was added). */
    systemQty: integer('system_qty').notNull(),
    countedQty: integer('counted_qty'),
    /** What a unit of the lot costs at the outlet (or the cost given for a lot the outlet never held). */
    unitCost: unitCost('unit_cost').notNull(),
    note: text('note'),
    /** Set when applied: the ledger as of the count date then, and the units moved to match the count. */
    appliedSystemQty: integer('applied_system_qty'),
    adjustedQty: integer('adjusted_qty'),
  },
  (t) => [
    primaryKey({ columns: [t.countId, t.position] }),
    foreignKey({
      name: 'pharmacy_stock_count_lines_fk',
      columns: [t.countId],
      foreignColumns: [stockCounts.id],
    }).onDelete('cascade'),
    uniqueIndex('pharmacy_stock_count_lines_lot_uq').on(t.countId, t.lotId),
    check(
      'pharmacy_stock_count_lines_qty_ck',
      sql`${t.systemQty} >= 0 and (${t.countedQty} is null or ${t.countedQty} >= 0) and ${t.unitCost} >= 0`,
    ),
  ],
);
