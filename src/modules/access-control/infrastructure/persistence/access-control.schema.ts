import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: tz('created_at').notNull().defaultNow(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('roles_name_uq').on(t.name),
    check('roles_name_format_ck', sql`${t.name} ~ '^[a-z][a-z0-9-]{1,63}$'`),
  ],
);

export const permissions = pgTable(
  'permissions',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull(),
    description: text('description').notNull().default(''),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('permissions_key_uq').on(t.key),
    check('permissions_key_format_ck', sql`${t.key} ~ '^[a-z][a-z-]*:[a-z][a-z-]*$'`),
  ],
);

// user_roles references identity.users: both modules live in one database, and
// the foreign key keeps assignments consistent when accounts are removed.
export const userRoles = pgTable(
  'user_roles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    assignedAt: tz('assigned_at').notNull().defaultNow(),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'user_roles_pk', columns: [t.userId, t.roleId] }),
    index('user_roles_role_idx').on(t.roleId),
  ],
);

export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permissionId: uuid('permission_id')
      .notNull()
      .references(() => permissions.id, { onDelete: 'cascade' }),
    grantedAt: tz('granted_at').notNull().defaultNow(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ name: 'role_permissions_pk', columns: [t.roleId, t.permissionId] }),
    index('role_permissions_permission_idx').on(t.permissionId),
  ],
);
