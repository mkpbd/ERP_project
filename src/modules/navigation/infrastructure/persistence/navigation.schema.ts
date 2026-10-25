import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { roles } from '../../../access-control/infrastructure/persistence/access-control.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Old API: Admin.ProjectMenus. Ids keep their GUIDs; ParentId = Guid.Empty becomes null.
export const menus = pgTable(
  'menus',
  {
    id: uuid('id').primaryKey(),
    // A parent with sub-menus cannot be deleted; the API asks for them to be moved first.
    parentId: uuid('parent_id').references((): AnyPgColumn => menus.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    path: text('path'),
    displayOrder: integer('display_order').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    icon: text('icon'),
    landingPageIconUrl: text('landing_page_icon_url'),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('menus_parent_idx').on(t.parentId),
    index('menus_path_idx').on(t.path),
    check('menus_not_own_parent_ck', sql`${t.parentId} <> ${t.id}`),
    check('menus_name_len_ck', sql`char_length(${t.name}) between 1 and 100`),
    check('menus_path_format_ck', sql`${t.path} = lower(${t.path}) and ${t.path} like '/_%'`),
    check('menus_display_order_ck', sql`${t.displayOrder} >= 0`),
  ],
);

// Old API: Menu.MenuPermissions (IsPermissionGranted was never read; a row is the grant).
export const roleMenus = pgTable(
  'role_menus',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    menuId: uuid('menu_id')
      .notNull()
      .references(() => menus.id, { onDelete: 'cascade' }),
    grantedAt: tz('granted_at').notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'role_menus_pk', columns: [t.roleId, t.menuId] }),
    index('role_menus_menu_idx').on(t.menuId),
  ],
);
