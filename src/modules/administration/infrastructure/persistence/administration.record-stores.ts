import type { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import type { RecordType } from '../../../../shared/application/records.js';
import { DrizzleRecordStore } from '../../../../shared/infrastructure/persistence/drizzle-record-store.js';
import {
  ADMIN_DEPARTMENT,
  DISCOUNT_CATEGORY,
  EDITOR_SHORTCUT,
  INVESTIGATION_ENTRY_PAGE_CONTROL,
  IPD_ADMISSION_PAGE_CONTROL,
  MASTERS_MANAGE_PERMISSION,
  PAYMENT_CHANNEL,
  PAYMENT_MODE,
  PRINTER,
  SERVE_TYPE,
  SERVICE_UNIT,
  TENANT,
  TENANTS_MANAGE_PERMISSION,
} from '../../application/record-types.js';
import {
  adminDepartments,
  discountCategories,
  editorShortcuts,
  investigationEntryPageControls,
  ipdAdmissionPageControls,
  paymentChannels,
  paymentModes,
  printers,
  serveTypes,
  serviceUnits,
  tenants,
} from './administration.schema.js';

const taken = (label: string) => ({
  code: `${label.replace(/ /g, '_')}_taken`,
  message: `This ${label} already exists`,
});

export function administrationRecordTypes(context: DbContext): RecordType[] {
  const masters = { readPermission: null, managePermission: MASTERS_MANAGE_PERMISSION };
  return [
    {
      name: ADMIN_DEPARTMENT,
      ...masters,
      store: new DrizzleRecordStore(context, adminDepartments, {
        name: ADMIN_DEPARTMENT,
        orderBy: [adminDepartments.name],
        unique: { admin_departments_name_uq: taken('department name') },
      }),
    },
    {
      name: SERVICE_UNIT,
      ...masters,
      store: new DrizzleRecordStore(context, serviceUnits, {
        name: SERVICE_UNIT,
        orderBy: [serviceUnits.name],
        filters: { departmentId: serviceUnits.departmentId },
        unique: { service_units_department_name_uq: taken('service unit name') },
        references: { service_units_department_id_admin_departments_id_fk: ADMIN_DEPARTMENT },
      }),
    },
    {
      name: SERVE_TYPE,
      ...masters,
      store: new DrizzleRecordStore(context, serveTypes, {
        name: SERVE_TYPE,
        orderBy: [serveTypes.name],
        unique: { serve_types_name_uq: taken('serve type name') },
      }),
    },
    {
      name: DISCOUNT_CATEGORY,
      ...masters,
      store: new DrizzleRecordStore(context, discountCategories, {
        name: DISCOUNT_CATEGORY,
        orderBy: [discountCategories.name],
        filters: { departmentId: discountCategories.departmentId },
        unique: { discount_categories_department_name_uq: taken('discount category name') },
        references: { discount_categories_department_id_admin_departments_id_fk: ADMIN_DEPARTMENT },
      }),
    },
    {
      name: PRINTER,
      ...masters,
      store: new DrizzleRecordStore(context, printers, { name: PRINTER, orderBy: [printers.name] }),
    },
    {
      name: PAYMENT_MODE,
      ...masters,
      store: new DrizzleRecordStore(context, paymentModes, {
        name: PAYMENT_MODE,
        orderBy: [paymentModes.name],
        unique: { payment_modes_name_uq: taken('payment mode name') },
      }),
    },
    {
      name: PAYMENT_CHANNEL,
      ...masters,
      store: new DrizzleRecordStore(context, paymentChannels, {
        name: PAYMENT_CHANNEL,
        orderBy: [paymentChannels.name],
        filters: { paymentModeId: paymentChannels.paymentModeId },
        unique: { payment_channels_mode_name_uq: taken('payment channel name') },
        references: { payment_channels_payment_mode_id_payment_modes_id_fk: PAYMENT_MODE },
      }),
    },
    {
      name: EDITOR_SHORTCUT,
      ...masters,
      store: new DrizzleRecordStore(context, editorShortcuts, {
        name: EDITOR_SHORTCUT,
        orderBy: [editorShortcuts.code],
        unique: { editor_shortcuts_code_uq: taken('shortcut code') },
      }),
    },
    {
      name: IPD_ADMISSION_PAGE_CONTROL,
      ...masters,
      store: new DrizzleRecordStore(context, ipdAdmissionPageControls, {
        name: IPD_ADMISSION_PAGE_CONTROL,
        orderBy: [ipdAdmissionPageControls.controlId],
        unique: { ipd_admission_page_controls_control_uq: taken('control') },
      }),
    },
    {
      name: INVESTIGATION_ENTRY_PAGE_CONTROL,
      ...masters,
      store: new DrizzleRecordStore(context, investigationEntryPageControls, {
        name: INVESTIGATION_ENTRY_PAGE_CONTROL,
        orderBy: [investigationEntryPageControls.controlId],
        unique: { investigation_entry_page_controls_control_uq: taken('control') },
      }),
    },
    {
      // Tenant name and address print on report headers, so every signed-in user may read them.
      name: TENANT,
      readPermission: null,
      managePermission: TENANTS_MANAGE_PERMISSION,
      store: new DrizzleRecordStore(context, tenants, {
        name: TENANT,
        orderBy: [tenants.name],
        references: { tenants_district_id_districts_id_fk: 'district' },
      }),
    },
  ];
}
