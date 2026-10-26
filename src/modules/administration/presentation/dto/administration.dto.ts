import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';
import { LOGO_SLOTS } from '../../domain/tenant-logo.js';

const name = z.string().trim().min(1).max(100);
const label = z.string().trim().max(100);
const optionalLabel = z.string().trim().min(1).max(200).nullable();

// Departments, serve types, payment modes: just a name.
const namedFields = { name };
export class CreateNamedRecordDto extends createZodDto(z.strictObject(namedFields)) {}
export class UpdateNamedRecordDto extends createZodDto(updateSchema(namedFields)) {}
export class NamedRecordResponseDto extends responseDto(recordResponseShape({ name: z.string() })) {}

const serviceUnitFields = { departmentId: z.uuid(), name };
export class CreateServiceUnitDto extends createZodDto(z.strictObject(serviceUnitFields)) {}
export class UpdateServiceUnitDto extends createZodDto(updateSchema(serviceUnitFields)) {}
export class DepartmentFilterDto extends createZodDto(z.object({ departmentId: z.uuid().optional() })) {}
export class ServiceUnitResponseDto extends responseDto(
  recordResponseShape({ departmentId: z.uuid(), name: z.string() }),
) {}

const discountCategoryFields = { departmentId: z.uuid(), name, discountPercent: z.number().min(0).max(100) };
export class CreateDiscountCategoryDto extends createZodDto(z.strictObject(discountCategoryFields)) {}
export class UpdateDiscountCategoryDto extends createZodDto(updateSchema(discountCategoryFields)) {}
export class DiscountCategoryResponseDto extends responseDto(
  recordResponseShape({ departmentId: z.uuid(), name: z.string(), discountPercent: z.number() }),
) {}

const printerFields = { name, useArea: label, pageSize: z.string().trim().max(50) };
export class CreatePrinterDto extends createZodDto(
  z.strictObject({
    ...printerFields,
    useArea: printerFields.useArea.default(''),
    pageSize: printerFields.pageSize.default(''),
  }),
) {}
export class UpdatePrinterDto extends createZodDto(updateSchema(printerFields)) {}
export class PrinterResponseDto extends responseDto(
  recordResponseShape({ name: z.string(), useArea: z.string(), pageSize: z.string() }),
) {}

const paymentChannelFields = { paymentModeId: z.uuid(), name };
export class CreatePaymentChannelDto extends createZodDto(z.strictObject(paymentChannelFields)) {}
export class UpdatePaymentChannelDto extends createZodDto(updateSchema(paymentChannelFields)) {}
export class PaymentModeFilterDto extends createZodDto(z.object({ paymentModeId: z.uuid().optional() })) {}
export class PaymentChannelResponseDto extends responseDto(
  recordResponseShape({ paymentModeId: z.uuid(), name: z.string() }),
) {}

const editorShortcutFields = { code: z.string().trim().min(1).max(50), value: z.string().max(10_000) };
export class CreateEditorShortcutDto extends createZodDto(z.strictObject(editorShortcutFields)) {}
export class UpdateEditorShortcutDto extends createZodDto(updateSchema(editorShortcutFields)) {}
export class EditorShortcutResponseDto extends responseDto(
  recordResponseShape({ code: z.string(), value: z.string() }),
) {}

const controlId = z.string().trim().min(1).max(100);

const ipdControlFields = { controlId, isVisible: z.boolean() };
export class CreateIpdAdmissionPageControlDto extends createZodDto(
  z.strictObject({ ...ipdControlFields, isVisible: ipdControlFields.isVisible.default(true) }),
) {}
export class UpdateIpdAdmissionPageControlDto extends createZodDto(updateSchema(ipdControlFields)) {}
export class IpdAdmissionPageControlResponseDto extends responseDto(
  recordResponseShape({ controlId: z.string(), isVisible: z.boolean() }),
) {}

const investigationControlFields = { controlId, isGridOrListView: z.boolean(), isVisible: z.boolean() };
export class CreateInvestigationEntryPageControlDto extends createZodDto(
  z.strictObject({
    ...investigationControlFields,
    isGridOrListView: investigationControlFields.isGridOrListView.default(false),
    isVisible: investigationControlFields.isVisible.default(true),
  }),
) {}
export class UpdateInvestigationEntryPageControlDto extends createZodDto(updateSchema(investigationControlFields)) {}
export class InvestigationEntryPageControlResponseDto extends responseDto(
  recordResponseShape({ controlId: z.string(), isGridOrListView: z.boolean(), isVisible: z.boolean() }),
) {}

const tenantFields = {
  name,
  nameAlt: optionalLabel,
  shortName: z.string().trim().min(1).max(30).nullable(),
  address: z.string().trim().max(500),
  hotline: z.string().trim().min(1).max(50).nullable(),
  districtId: z.uuid().nullable(),
};
export class CreateTenantDto extends createZodDto(
  z.strictObject({
    ...tenantFields,
    nameAlt: tenantFields.nameAlt.default(null),
    shortName: tenantFields.shortName.default(null),
    address: tenantFields.address.default(''),
    hotline: tenantFields.hotline.default(null),
    districtId: tenantFields.districtId.default(null),
  }),
) {}
export class UpdateTenantDto extends createZodDto(updateSchema(tenantFields)) {}
export class TenantResponseDto extends responseDto(
  recordResponseShape({
    name: z.string(),
    nameAlt: z.string().nullable(),
    shortName: z.string().nullable(),
    address: z.string(),
    hotline: z.string().nullable(),
    districtId: z.uuid().nullable(),
  }),
) {}

export class TenantLogoParamDto extends createZodDto(z.strictObject({ id: z.uuid(), slot: z.enum(LOGO_SLOTS) })) {}

const money = z.number().min(0).max(1_000_000_000);
const generalSettingsFields = {
  jsPrintManagerUrl: z.url().max(500).nullable(),
  dailyFoodBillInWard: money,
  dailyFoodBillInOthers: money,
  visitingCardRate: money,
  vatRegistrationNo: z.string().trim().min(1).max(50).nullable(),
  ipdServiceChargePercent: z.number().min(0).max(100),
  autoInvestigationInvoiceAfterIndent: z.boolean(),
  autoAddTubeAndNeedle: z.boolean(),
  menuBackgroundColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/, 'Expected a hex colour such as #1a2b3c')
    .nullable(),
  sampleDispatchDelayMinutes: z.int().min(0).max(10_080),
  autoAppointmentSerial: z.boolean(),
  addTechnologistSignatureOnReport: z.boolean(),
  integratedAccountsEnabled: z.boolean(),
  stockEntryGrandTotalDisabled: z.boolean(),
  uhidPrefix: z
    .string()
    .regex(/^[A-Z]{1,6}$/, 'Expected 1 to 6 capital letters, such as FKH')
    .nullable(),
};
export class UpdateGeneralSettingsDto extends createZodDto(updateSchema(generalSettingsFields)) {}
export class GeneralSettingsResponseDto extends responseDto(generalSettingsFields) {}

const cssLength = z
  .string()
  .trim()
  .regex(/^$|^\d+(\.\d+)?(px|mm|cm|in|pt|em|rem|%)?$/, 'Expected a CSS length such as 10mm');
const editorMarginFields = { left: cssLength, right: cssLength, top: cssLength, bottom: cssLength };
export class UpdateEditorMarginsDto extends createZodDto(updateSchema(editorMarginFields)) {}
export class EditorMarginsResponseDto extends responseDto(editorMarginFields) {}
