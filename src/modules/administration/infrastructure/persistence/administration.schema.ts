import { sql, type SQLWrapper } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';
import { districts } from '../../../location/infrastructure/persistence/location.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });
const nameLength = (table: string, column: SQLWrapper) =>
  check(`${table}_name_len_ck`, sql`char_length(${column}) between 1 and 100`);

// Old API: Admin.Departments — billing/service departments, not HR departments.
export const adminDepartments = pgTable(
  'admin_departments',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('admin_departments_name_uq').on(sql`lower(${t.name})`), nameLength('admin_departments', t.name)],
);

// Old API: Admin.ServiceUnits.
export const serviceUnits = pgTable(
  'service_units',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => adminDepartments.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('service_units_department_name_uq').on(t.departmentId, sql`lower(${t.name})`),
    index('service_units_department_idx').on(t.departmentId),
    nameLength('service_units', t.name),
  ],
);

// Old API: Admin.ServeTypes (int ids).
export const serveTypes = pgTable(
  'serve_types',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('serve_types_name_uq').on(sql`lower(${t.name})`), nameLength('serve_types', t.name)],
);

// Old API: Admin.DiscountCategories. DiscountInParcent (float) → discount_percent numeric(5,2).
export const discountCategories = pgTable(
  'discount_categories',
  {
    id: uuid('id').primaryKey(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => adminDepartments.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    discountPercent: numeric('discount_percent', { precision: 5, scale: 2, mode: 'number' }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('discount_categories_department_name_uq').on(t.departmentId, sql`lower(${t.name})`),
    index('discount_categories_department_idx').on(t.departmentId),
    nameLength('discount_categories', t.name),
    check('discount_categories_percent_ck', sql`${t.discountPercent} between 0 and 100`),
  ],
);

// Old API: Admin.Printers.
export const printers = pgTable(
  'printers',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    useArea: text('use_area').notNull().default(''),
    pageSize: text('page_size').notNull().default(''),
    ...timestamps,
  },
  (t) => [nameLength('printers', t.name)],
);

// Old API: Admin.PaymentModes (int ids; no admin API existed, rows were maintained in the database).
export const paymentModes = pgTable(
  'payment_modes',
  { id: uuid('id').primaryKey(), name: text('name').notNull(), ...timestamps },
  (t) => [uniqueIndex('payment_modes_name_uq').on(sql`lower(${t.name})`), nameLength('payment_modes', t.name)],
);

// Old API: Admin.PaymentChannels (int ids).
export const paymentChannels = pgTable(
  'payment_channels',
  {
    id: uuid('id').primaryKey(),
    paymentModeId: uuid('payment_mode_id')
      .notNull()
      .references(() => paymentModes.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('payment_channels_mode_name_uq').on(t.paymentModeId, sql`lower(${t.name})`),
    index('payment_channels_mode_idx').on(t.paymentModeId),
    nameLength('payment_channels', t.name),
  ],
);

// Old API: Admin.EditorShorkeys — text snippets for the report editor.
export const editorShortcuts = pgTable(
  'editor_shortcuts',
  {
    id: uuid('id').primaryKey(),
    code: text('code').notNull(),
    value: text('value').notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('editor_shortcuts_code_uq').on(sql`lower(${t.code})`),
    check('editor_shortcuts_code_len_ck', sql`char_length(${t.code}) between 1 and 50`),
  ],
);

// Old API: Admin.IPDAdmissionpageControls — which fields the IPD admission page shows.
export const ipdAdmissionPageControls = pgTable(
  'ipd_admission_page_controls',
  {
    id: uuid('id').primaryKey(),
    controlId: text('control_id').notNull(),
    isVisible: boolean('is_visible').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('ipd_admission_page_controls_control_uq').on(t.controlId)],
);

// Old API: Admin.InvestigationEntryPageControls (int ids).
export const investigationEntryPageControls = pgTable(
  'investigation_entry_page_controls',
  {
    id: uuid('id').primaryKey(),
    controlId: text('control_id').notNull(),
    isGridOrListView: boolean('is_grid_or_list_view').notNull().default(false),
    isVisible: boolean('is_visible').notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex('investigation_entry_page_controls_control_uq').on(t.controlId)],
);

// Old API: Admin.Tenants (int ids). Name2 → name_alt, HotLine → hotline, BranchId (a District) → district_id.
// Logos moved to tenant_logos.
export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    nameAlt: text('name_alt'),
    shortName: text('short_name'),
    address: text('address').notNull().default(''),
    hotline: text('hotline'),
    districtId: uuid('district_id').references(() => districts.id, { onDelete: 'restrict' }),
    ...timestamps,
  },
  (t) => [nameLength('tenants', t.name), index('tenants_district_idx').on(t.districtId)],
);

export const tenantLogos = pgTable(
  'tenant_logos',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slot: text('slot', { enum: ['primary', 'secondary'] }).notNull(),
    contentType: text('content_type').notNull(),
    data: bytea('data').notNull(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'tenant_logos_pk', columns: [t.tenantId, t.slot] }),
    check('tenant_logos_slot_ck', sql`${t.slot} in ('primary', 'secondary')`),
    check('tenant_logos_type_ck', sql`${t.contentType} in ('image/png', 'image/jpeg', 'image/webp')`),
    check('tenant_logos_size_ck', sql`octet_length(${t.data}) between 1 and 1048576`),
  ],
);

// Old API: SuperAdmin.AppSettings (a single row) and Admin.EditorMargins (a single row).
export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});
