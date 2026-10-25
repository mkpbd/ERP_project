import type { INestApplication } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { sql } from 'drizzle-orm';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap/configure-app.js';
import { loadConfig, type AppConfig } from '../../src/config/configuration.js';
import { DbContext } from '../../src/database/drizzle-transaction-manager.js';
import { SyncPermissionCatalogCommand } from '../../src/modules/access-control/application/commands/access-control.commands.js';
import { BootstrapAdministratorCommand } from '../../src/modules/identity/application/commands/user.commands.js';
import { EmailSender } from '../../src/modules/notifications/application/email.js';
import type { InMemoryEmailSender } from '../../src/modules/notifications/infrastructure/email-senders.js';
import { OutboxDispatcher } from '../../src/modules/notifications/infrastructure/outbox.js';

export interface TestApp {
  readonly app: NestExpressApplication;
  readonly config: AppConfig;
  /** Delivers pending outbox messages and returns everything sent so far. */
  readonly flushMail: () => Promise<InMemoryEmailSender['sent']>;
  readonly mail: InMemoryEmailSender;
}

export async function createTestApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const config = loadConfig({ ...process.env, ...overrides });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(config)] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, bufferLogs: true });
  configureApp(app, config);
  await app.init();
  const mail = app.get<EmailSender, InMemoryEmailSender>(EmailSender);
  const dispatcher = app.get(OutboxDispatcher);
  return {
    app,
    config,
    mail,
    flushMail: async () => {
      await dispatcher.dispatchPending();
      return mail.sent;
    },
  };
}

/** Empties every table except the permission catalog, then re-syncs the catalog and super-admin role. */
export async function resetDatabase(app: INestApplication): Promise<void> {
  await app.get(DbContext).db.execute(sql`
    truncate table audit_logs,
      stock_transfer_lines, stock_transfers, store_issue_lines, store_issues, store_request_lines, store_requests,
      store_indent_approvals, store_indent_lines, store_indents, store_indent_approval_levels,
      stock_movements, stock_receive_lines, stock_receives, stock_openings, stock_lots, grn_faults,
      purchase_order_lines, purchase_orders, comparative_study_approvals, comparative_study_quotes,
      comparative_studies, cs_approval_levels, purchase_requisition_approvals, purchase_requisition_lines,
      purchase_requisitions, purchase_approval_levels, scm_sequences,
      department_store_access, issue_store_users, store_department_users, role_group_restrictions, item_variants,
      items, item_sub_groups, item_groups, item_sub_categories, item_categories, suppliers, supplier_types,
      sub_stores, main_stores, store_departments, outbox_messages, refresh_tokens, user_sessions, password_reset_tokens,
      email_verification_tokens, role_reports, role_menus, menus,
      voucher_attachments, voucher_lines, voucher_sequences, vouchers, gl_roles, posting_schedules,
      pos_terminals, bank_accounts, gl_statement_mappings, statement_sub_heads, statement_broad_heads,
      account_group_members, account_groups, gl_item_descriptions, gl_accounts, account_level5_heads,
      account_level4_heads, account_sub_categories, account_categories, account_natures, coa_descriptions,
      pf_deposits, pf_fixed_deposits, tds_rules,
      fs_line_items, fiscal_years, journal_types, voucher_types, cost_centers, sub_ledgers, sub_ledger_types,
      income_tax_deductions, income_tax_years,
      festival_bonus_lines, festival_bonuses, leave_encashments, pf_ledger_entries, staff_dues,
      salary_sheet_lines, salary_sheets, salary_overtimes, salary_deductions, salary_punishments, salary_arrears,
      allowance_payments, salary_payments, salary_stops,
      salary_increments, staff_salaries, salary_review_cycles, salary_policies,
      job_application_files, job_applications, job_circulars,
      attendance_punches, manual_attendances, roster_duties, staff_days_off, duty_exchanges, extra_duties, shift_types,
      leave_application_approvals, leave_applications, leave_records, leave_delegates, leave_approval_levels,
      staff_leave_entitlements, staff_leave_policies, leave_policy_entitlements, leave_policies, leave_types,
      department_incharges, staff_documents, staff_photos, staff_festivals, staff_emergency_contacts,
      staff_education, staff_records, govt_holidays, festivals, designations, hr_sub_departments,
      hr_departments, hr_divisions, user_roles, role_permissions, roles, users,
      settings, tenant_logos, tenants, investigation_entry_page_controls, ipd_admission_page_controls,
      editor_shortcuts, payment_channels, payment_modes, printers, discount_categories, serve_types,
      service_units, admin_departments, districts, divisions, countries
      restart identity cascade
  `);
  await app.get(CommandBus).execute(new SyncPermissionCatalogCommand());
}

export const ADMIN = { email: 'root@example.com', password: 'Super-Account-Passw0rd!' };

export async function bootstrapAdmin(app: INestApplication): Promise<string> {
  const result = await app
    .get(CommandBus)
    .execute(new BootstrapAdministratorCommand(ADMIN.email, ADMIN.password, 'Root'));
  if (!result.userId) throw new Error('Admin bootstrap did not create a user');
  return result.userId;
}

/** Extracts the token from a link of the form ...#token=<token>. */
export function tokenFromMail(text: string): string {
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`No token link in mail:\n${text}`);
  return match[1];
}
