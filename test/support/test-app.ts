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
      clinical_notes, clinical_note_templates, clinical_death_records, clinical_birth_records,
      clinical_rx_advices, clinical_rx_tests, clinical_rx_drugs, clinical_rx_complaints, clinical_prescriptions,
      clinical_rx_templates, clinical_phrases, clinical_sequences,
      blood_issues, blood_crossmatches, blood_requests, blood_units, blood_donations, blood_donors,
      blood_component_types, blood_sequences,
      pharmacy_ward_return_lines, pharmacy_ward_returns, pharmacy_ward_issue_lines, pharmacy_ward_issues,
      pharmacy_ward_indent_lines, pharmacy_ward_indents,
      lab_reagent_uses, lab_test_reagents, lab_stock_departments,
      lab_imaging_studies, lab_imaging_templates, lab_imaging_sequences,
      lab_result_values, lab_results, lab_samples, lab_parameter_ranges, lab_parameters, lab_sequences,
      hospital_diagnostic_payments, hospital_diagnostic_bill_lines, hospital_diagnostic_bills,
      hospital_diagnostic_package_tests, hospital_diagnostic_packages, hospital_diagnostic_tests,
      hospital_diagnostic_departments, hospital_diagnostic_policy,
      hospital_ipd_payments, hospital_ipd_bill_lines, hospital_ipd_bills, hospital_ipd_charges, hospital_ipd_policy,
      hospital_bed_stays, hospital_admission_doctors, hospital_admissions, hospital_beds, hospital_bed_categories,
      hospital_wards, hospital_uhid_uses, hospital_doctor_payments, hospital_doctor_ledger, hospital_opd_payments, hospital_opd_bill_lines, hospital_opd_bills,
      hospital_opd_policy, hospital_corporate_clients, hospital_services, hospital_service_groups, hospital_appointments, hospital_doctor_closures, hospital_doctor_schedules, hospital_doctors, hospital_specialities,
      hospital_patient_photos, hospital_patients, hospital_sequences,
      pharmacy_stock_count_lines, pharmacy_stock_counts,
      pharmacy_sale_return_lines, pharmacy_sale_returns, pharmacy_return_policies,
      pharmacy_due_collection_lines, pharmacy_due_collections, pharmacy_sale_lines, pharmacy_sales,
      pharmacy_loyal_members, pharmacy_product_discounts, pharmacy_discount_policy,
      pharmacy_transfer_lines, pharmacy_transfers, pharmacy_outlet_indent_lines, pharmacy_outlet_indents,
      pharmacy_supplier_return_settlements, pharmacy_supplier_return_lines, pharmacy_supplier_returns,
      pharmacy_supplier_payment_lines, pharmacy_supplier_payments,
      pharmacy_movements, pharmacy_receive_lines, pharmacy_receives, pharmacy_purchase_order_lines,
      pharmacy_purchase_orders, pharmacy_openings, pharmacy_lots, pharmacy_sequences,
      pharmacy_reorder_levels, pharmacy_outlet_users, pharmacy_outlets, pharmacy_products, pharmacy_brands,
      pharmacy_manufacturers, pharmacy_package_units, pharmacy_units, pharmacy_strengths, pharmacy_formations,
      pharmacy_generics, pharmacy_generic_groups,
      asset_locks, asset_decisions, asset_service_request_lines, asset_service_requests, asset_discard_request_lines,
      asset_discard_requests, scrap_sales, asset_approval_levels,
      depreciation_entries, depreciation_runs, asset_depreciation, fixed_assets,
      supplier_return_lines, supplier_returns, gate_passes, department_adjustment_lines, department_adjustments,
      department_return_lines, department_returns, department_consumption_lines, department_consumptions,
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
