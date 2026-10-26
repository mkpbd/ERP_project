import { randomUUID } from 'node:crypto';
import { CommandBus } from '@nestjs/cqrs';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DbContext } from '../../src/database/drizzle-transaction-manager.js';
import {
  AssignUserRoleCommand,
  CreateRoleCommand,
  GrantRolePermissionsCommand,
} from '../../src/modules/access-control/application/commands/access-control.commands.js';
import { RegisterUserCommand } from '../../src/modules/identity/application/commands/auth.commands.js';
import { DeactivateUserCommand } from '../../src/modules/identity/application/commands/user.commands.js';
import {
  RefreshTokenRepository,
  SessionRepository,
  UserRepository,
} from '../../src/modules/identity/domain/repositories.js';
import { Session } from '../../src/modules/identity/domain/session.js';
import { AccessControl } from '../../src/shared/application/contracts/access-control.js';
import { TransactionManager } from '../../src/shared/application/ports/transaction-manager.js';
import { ConflictError } from '../../src/shared/domain/errors.js';
import { makeUser } from '../support/fakes.js';
import { bootstrapAdmin, createTestApp, resetDatabase, type TestApp } from '../support/test-app.js';

let t: TestApp;
let users: UserRepository;
let db: DbContext['db'];
let tx: TransactionManager;

beforeAll(async () => {
  t = await createTestApp();
  users = t.app.get(UserRepository);
  db = t.app.get(DbContext).db;
  tx = t.app.get(TransactionManager);
});
afterAll(() => t.app.close());
beforeEach(() => resetDatabase(t.app));

const now = new Date();
const newUser = (email: string) => makeUser({ id: randomUUID(), email, now });

describe('migrations', () => {
  it('applied the reviewed migration set', async () => {
    const applied = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`);
    expect(applied.rows[0]).toEqual({ n: 30 });
    const tables = await db.execute(
      sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      'account_categories',
      'account_group_members',
      'account_groups',
      'account_level4_heads',
      'account_level5_heads',
      'account_natures',
      'account_sub_categories',
      'admin_departments',
      'allowance_payments',
      'asset_approval_levels',
      'asset_decisions',
      'asset_depreciation',
      'asset_discard_request_lines',
      'asset_discard_requests',
      'asset_locks',
      'asset_service_request_lines',
      'asset_service_requests',
      'attendance_punches',
      'audit_logs',
      'bank_accounts',
      'coa_descriptions',
      'comparative_studies',
      'comparative_study_approvals',
      'comparative_study_quotes',
      'cost_centers',
      'countries',
      'cs_approval_levels',
      'department_adjustment_lines',
      'department_adjustments',
      'department_consumption_lines',
      'department_consumptions',
      'department_incharges',
      'department_return_lines',
      'department_returns',
      'department_store_access',
      'depreciation_entries',
      'depreciation_runs',
      'designations',
      'discount_categories',
      'districts',
      'divisions',
      'duty_exchanges',
      'editor_shortcuts',
      'email_verification_tokens',
      'extra_duties',
      'festival_bonus_lines',
      'festival_bonuses',
      'festivals',
      'fiscal_years',
      'fixed_assets',
      'fs_line_items',
      'gate_passes',
      'gl_accounts',
      'gl_item_descriptions',
      'gl_roles',
      'gl_statement_mappings',
      'govt_holidays',
      'grn_faults',
      'hr_departments',
      'hr_divisions',
      'hr_sub_departments',
      'income_tax_deductions',
      'income_tax_years',
      'investigation_entry_page_controls',
      'ipd_admission_page_controls',
      'issue_store_users',
      'item_categories',
      'item_groups',
      'item_sub_categories',
      'item_sub_groups',
      'item_variants',
      'items',
      'job_application_files',
      'job_applications',
      'job_circulars',
      'journal_types',
      'leave_application_approvals',
      'leave_applications',
      'leave_approval_levels',
      'leave_delegates',
      'leave_encashments',
      'leave_policies',
      'leave_policy_entitlements',
      'leave_records',
      'leave_types',
      'main_stores',
      'manual_attendances',
      'menus',
      'outbox_messages',
      'password_reset_tokens',
      'payment_channels',
      'payment_modes',
      'permissions',
      'pf_deposits',
      'pf_fixed_deposits',
      'pf_ledger_entries',
      'pharmacy_brands',
      'pharmacy_discount_policy',
      'pharmacy_due_collection_lines',
      'pharmacy_due_collections',
      'pharmacy_formations',
      'pharmacy_generic_groups',
      'pharmacy_generics',
      'pharmacy_lots',
      'pharmacy_loyal_members',
      'pharmacy_manufacturers',
      'pharmacy_movements',
      'pharmacy_openings',
      'pharmacy_outlet_indent_lines',
      'pharmacy_outlet_indents',
      'pharmacy_outlet_users',
      'pharmacy_outlets',
      'pharmacy_package_units',
      'pharmacy_product_discounts',
      'pharmacy_products',
      'pharmacy_purchase_order_lines',
      'pharmacy_purchase_orders',
      'pharmacy_receive_lines',
      'pharmacy_receives',
      'pharmacy_reorder_levels',
      'pharmacy_sale_lines',
      'pharmacy_sales',
      'pharmacy_sequences',
      'pharmacy_strengths',
      'pharmacy_supplier_payment_lines',
      'pharmacy_supplier_payments',
      'pharmacy_supplier_return_lines',
      'pharmacy_supplier_return_settlements',
      'pharmacy_supplier_returns',
      'pharmacy_transfer_lines',
      'pharmacy_transfers',
      'pharmacy_units',
      'pos_terminals',
      'posting_schedules',
      'printers',
      'purchase_approval_levels',
      'purchase_order_lines',
      'purchase_orders',
      'purchase_requisition_approvals',
      'purchase_requisition_lines',
      'purchase_requisitions',
      'refresh_tokens',
      'role_group_restrictions',
      'role_menus',
      'role_permissions',
      'role_reports',
      'roles',
      'roster_duties',
      'salary_arrears',
      'salary_deductions',
      'salary_increments',
      'salary_overtimes',
      'salary_payments',
      'salary_policies',
      'salary_punishments',
      'salary_review_cycles',
      'salary_sheet_lines',
      'salary_sheets',
      'salary_stops',
      'scm_sequences',
      'scrap_sales',
      'serve_types',
      'service_units',
      'settings',
      'shift_types',
      'staff_days_off',
      'staff_documents',
      'staff_dues',
      'staff_education',
      'staff_emergency_contacts',
      'staff_festivals',
      'staff_leave_entitlements',
      'staff_leave_policies',
      'staff_photos',
      'staff_records',
      'staff_salaries',
      'statement_broad_heads',
      'statement_sub_heads',
      'stock_lots',
      'stock_movements',
      'stock_openings',
      'stock_receive_lines',
      'stock_receives',
      'stock_transfer_lines',
      'stock_transfers',
      'store_department_users',
      'store_departments',
      'store_indent_approval_levels',
      'store_indent_approvals',
      'store_indent_lines',
      'store_indents',
      'store_issue_lines',
      'store_issues',
      'store_request_lines',
      'store_requests',
      'sub_ledger_types',
      'sub_ledgers',
      'sub_stores',
      'supplier_return_lines',
      'supplier_returns',
      'supplier_types',
      'suppliers',
      'tds_rules',
      'tenant_logos',
      'tenants',
      'user_roles',
      'user_sessions',
      'users',
      'voucher_attachments',
      'voucher_lines',
      'voucher_sequences',
      'voucher_types',
      'vouchers',
    ]);
  });
});

describe('DrizzleUserRepository', () => {
  it('maps unique violations to conflicts', async () => {
    await users.insert(newUser('dup@example.com'));
    await expect(users.insert(newUser('dup@example.com'))).rejects.toMatchObject({ code: 'email_taken' });
  });

  it('enforces optimistic concurrency', async () => {
    const user = newUser('occ@example.com');
    await users.insert(user);
    const first = (await users.findById(user.id))!;
    const second = (await users.findById(user.id))!;
    first.recordSuccessfulSignIn(now);
    await users.update(first);
    second.recordSuccessfulSignIn(now);
    await expect(users.update(second)).rejects.toMatchObject({ code: 'concurrent_modification' });
  });
});

describe('database constraints are the final integrity boundary', () => {
  it.each([
    [
      'upper-case email',
      sql`insert into users (id, email, display_name, password_hash, status, password_changed_at) values (gen_random_uuid(), 'UPPER@example.com', 'x', 'h', 'active', now())`,
    ],
    [
      'unknown status',
      sql`insert into users (id, email, display_name, password_hash, status, password_changed_at) values (gen_random_uuid(), 'a@example.com', 'x', 'h', 'banned', now())`,
    ],
    ['malformed role name', sql`insert into roles (id, name) values (gen_random_uuid(), 'Bad Name')`],
    ['malformed permission key', sql`insert into permissions (id, key) values (gen_random_uuid(), 'nocolon')`],
    [
      'plaintext refresh token',
      sql`insert into refresh_tokens (id, session_id, token_hash, expires_at) values (gen_random_uuid(), gen_random_uuid(), 'plaintext', now())`,
    ],
  ])('rejects %s', async (_label, statement) => {
    await expect(db.execute(statement)).rejects.toThrow();
  });
});

describe('TransactionManager', () => {
  it('rolls back every write in the unit of work on failure', async () => {
    const user = newUser('rollback@example.com');
    await expect(
      tx.run(async () => {
        await users.insert(user);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await users.findById(user.id)).toBeNull();
  });

  it('joins nested units of work into the outer transaction', async () => {
    const outer = newUser('outer@example.com');
    const inner = newUser('inner@example.com');
    await expect(
      tx.run(async () => {
        await users.insert(outer);
        await tx.run(() => users.insert(inner));
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');
    expect(await users.findById(inner.id)).toBeNull();
  });

  it('serializes competing transactions on an advisory lock', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstHolding = new Promise<void>((resolve) => (releaseFirst = resolve));
    let firstLocked!: () => void;
    const locked = new Promise<void>((resolve) => (firstLocked = resolve));

    const first = tx.run(async () => {
      await tx.lock('test-resource');
      order.push('first:locked');
      firstLocked();
      await firstHolding;
      order.push('first:done');
    });
    await locked;
    const second = tx.run(async () => {
      await tx.lock('test-resource');
      order.push('second:locked');
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:locked', 'first:done', 'second:locked']);
  });
});

describe('refresh-token rotation under concurrency', () => {
  it('lets exactly one of two simultaneous consumers win; the other sees reuse', async () => {
    const user = newUser('race@example.com');
    await users.insert(user);
    const session = Session.open({
      id: randomUUID(),
      userId: user.id,
      now,
      ttlSeconds: 3600,
      userAgent: null,
      ipAddress: null,
    });
    await t.app.get(SessionRepository).insert(session);
    const tokens = t.app.get(RefreshTokenRepository);
    const hash = 'a'.repeat(64);
    await tokens.insert({
      id: randomUUID(),
      sessionId: session.id,
      tokenHash: hash,
      expiresAt: new Date(Date.now() + 60_000),
      now,
    });

    const results = await Promise.all([
      tx.run(() => tokens.consume(hash, new Date())),
      tx.run(() => tokens.consume(hash, new Date())),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['consumed', 'reused']);
  });
});

describe('super-admin protection under concurrency', () => {
  it('never lets two concurrent deactivations remove the last two active super-admins', async () => {
    const commands = t.app.get(CommandBus);
    const rootId = await bootstrapAdmin(t.app);
    const root = { userId: rootId, sessionId: randomUUID() };
    const a = newUser('admin-a@example.com');
    const b = newUser('admin-b@example.com');
    await users.insert(a);
    await users.insert(b);
    const superAdminRoleId = String(
      (await db.execute(sql`select id from roles where name = 'super-admin'`)).rows[0]!.id,
    );
    await commands.execute(new AssignUserRoleCommand(root, a.id, superAdminRoleId));
    await commands.execute(new AssignUserRoleCommand(root, b.id, superAdminRoleId));
    // Root steps out of the picture so only a and b remain as active super-admins.
    await commands.execute(new DeactivateUserCommand({ userId: a.id, sessionId: randomUUID() }, rootId));

    const outcomes = await Promise.allSettled([
      commands.execute(new DeactivateUserCommand({ userId: a.id, sessionId: randomUUID() }, b.id)),
      commands.execute(new DeactivateUserCommand({ userId: b.id, sessionId: randomUUID() }, a.id)),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'last_super_admin' });

    const active = await db.execute(sql`
      select count(*)::int as n from users u join user_roles ur on ur.user_id = u.id join roles r on r.id = ur.role_id
      where r.name = 'super-admin' and u.status = 'active'`);
    expect(active.rows[0]).toEqual({ n: 1 });
  });
});

describe('permission cache invalidation', () => {
  it('reflects role and grant changes immediately', async () => {
    const commands = t.app.get(CommandBus);
    const access = t.app.get(AccessControl);
    const rootId = await bootstrapAdmin(t.app);
    const root = { userId: rootId, sessionId: randomUUID() };
    const user = newUser('cache@example.com');
    await users.insert(user);

    expect(await access.isAllowed(user.id, { permissions: ['users:read'] })).toBe(false); // now cached
    const { id: roleId } = await commands.execute(new CreateRoleCommand(root, 'readers', '', ['users:read']));
    await commands.execute(new AssignUserRoleCommand(root, user.id, roleId));
    expect(await access.isAllowed(user.id, { permissions: ['users:read'] })).toBe(true);

    await commands.execute(new GrantRolePermissionsCommand(root, roleId, ['audit:read']));
    expect(await access.isAllowed(user.id, { permissions: ['audit:read'] })).toBe(true);
  });

  it('rejects duplicate role names as conflicts', async () => {
    const commands = t.app.get(CommandBus);
    const root = { userId: await bootstrapAdmin(t.app), sessionId: randomUUID() };
    await commands.execute(new CreateRoleCommand(root, 'dupe', '', []));
    await expect(commands.execute(new CreateRoleCommand(root, 'dupe', '', []))).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('transactional outbox', () => {
  it('delivers committed messages once and scrubs their payload', async () => {
    await t.app
      .get(CommandBus)
      .execute(new RegisterUserCommand('outbox@example.com', 'a long enough passphrase', 'Outbox', null));
    t.mail.clear();
    expect((await t.flushMail()).map((mail) => mail.to)).toEqual(['outbox@example.com']);
    expect((await t.flushMail()).length).toBe(1);
    const rows = await db.execute(sql`select status, payload from outbox_messages`);
    expect(rows.rows).toEqual([{ status: 'sent', payload: {} }]);
  });
});
