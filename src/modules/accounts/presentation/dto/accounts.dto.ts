import { z } from 'zod';
import { recordResponseShape, responseDto, updateSchema } from '../../../../shared/presentation/zod/common.schemas.js';
import { createZodDto } from '../../../../shared/presentation/zod/zod-dto.js';

const day = z.iso.date();
const name = (max = 150) => z.string().trim().min(1).max(max);
const code = z.string().trim().min(1).max(30);
const optionalText = (max: number) => z.string().trim().max(max).nullable();
const optionalCode = code.nullable();
const ref = z.uuid();

/** Create (nullable fields default to null), update (all optional) and response shapes of a record. */
function shapes<T extends z.ZodRawShape>(fields: T, nullable: (keyof T)[] = []) {
  const create = Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [
      key,
      nullable.includes(key) ? (schema as z.ZodNullable<z.ZodTypeAny>).default(null) : schema,
    ]),
  ) as T;
  return { create: z.strictObject(create), update: updateSchema(fields), response: recordResponseShape(fields) };
}

const nature = shapes({
  code,
  name: name(),
  statement: z.enum(['balance_sheet', 'profit_and_loss']),
  normalBalance: z.enum(['debit', 'credit']),
});
export class CreateNatureDto extends createZodDto(nature.create) {}
export class UpdateNatureDto extends createZodDto(nature.update) {}
export class NatureResponseDto extends responseDto(nature.response) {}

const category = shapes({ natureId: ref, code, name: name() });
export class CreateCategoryDto extends createZodDto(category.create) {}
export class UpdateCategoryDto extends createZodDto(category.update) {}
export class CategoryFilterDto extends createZodDto(z.object({ natureId: ref.optional() })) {}
export class CategoryResponseDto extends responseDto(category.response) {}

const subCategory = shapes({ categoryId: ref, code: optionalCode, name: name() }, ['code']);
export class CreateSubCategoryDto extends createZodDto(subCategory.create) {}
export class UpdateSubCategoryDto extends createZodDto(subCategory.update) {}
export class SubCategoryFilterDto extends createZodDto(z.object({ categoryId: ref.optional() })) {}
export class SubCategoryResponseDto extends responseDto(subCategory.response) {}

const level4 = shapes({ subCategoryId: ref, code: optionalCode, name: name() }, ['code']);
export class CreateLevel4HeadDto extends createZodDto(level4.create) {}
export class UpdateLevel4HeadDto extends createZodDto(level4.update) {}
export class Level4HeadFilterDto extends createZodDto(z.object({ subCategoryId: ref.optional() })) {}
export class Level4HeadResponseDto extends responseDto(level4.response) {}

const level5 = shapes({ level4HeadId: ref, code: optionalCode, name: name() }, ['code']);
export class CreateLevel5HeadDto extends createZodDto(level5.create) {}
export class UpdateLevel5HeadDto extends createZodDto(level5.update) {}
export class Level5HeadFilterDto extends createZodDto(z.object({ level4HeadId: ref.optional() })) {}
export class Level5HeadResponseDto extends responseDto(level5.response) {}

const glFields = {
  level5HeadId: ref,
  code,
  name: name(200),
  kind: z.enum(['bank', 'cash', 'other']),
  coaDescriptionId: ref.nullable(),
  isControlAccount: z.boolean(),
  requiresCostCenter: z.boolean(),
  isRecurringCost: z.boolean(),
  billingHasDetails: z.boolean(),
  isActive: z.boolean(),
};
export class CreateGlAccountDto extends createZodDto(
  z.strictObject({
    ...glFields,
    kind: glFields.kind.default('other'),
    coaDescriptionId: glFields.coaDescriptionId.default(null),
    isControlAccount: z.boolean().default(false),
    requiresCostCenter: z.boolean().default(false),
    isRecurringCost: z.boolean().default(false),
    billingHasDetails: z.boolean().default(false),
    isActive: z.boolean().default(true),
  }),
) {}
export class UpdateGlAccountDto extends createZodDto(updateSchema(glFields)) {}
export class GlAccountFilterDto extends createZodDto(
  z.object({
    level5HeadId: ref.optional(),
    kind: glFields.kind.optional(),
    isActive: z.enum(['true', 'false']).optional(),
  }),
) {}
export class GlAccountResponseDto extends responseDto(recordResponseShape(glFields)) {}

const coaDescription = shapes({ code: optionalCode, name: name(100) }, ['code']);
export class CreateCoaDescriptionDto extends createZodDto(coaDescription.create) {}
export class UpdateCoaDescriptionDto extends createZodDto(coaDescription.update) {}
export class CoaDescriptionResponseDto extends responseDto(coaDescription.response) {}

const fsLineItem = shapes({ code: optionalCode, name: name(100) }, ['code']);
export class CreateFsLineItemDto extends createZodDto(fsLineItem.create) {}
export class UpdateFsLineItemDto extends createZodDto(fsLineItem.update) {}
export class FsLineItemResponseDto extends responseDto(fsLineItem.response) {}

const glItem = shapes(
  {
    subCategoryId: ref,
    fsLineItemId: ref.nullable(),
    coaDescriptionId: ref.nullable(),
    code: optionalCode,
    name: name(250),
  },
  ['fsLineItemId', 'coaDescriptionId', 'code'],
);
export class CreateGlItemDescriptionDto extends createZodDto(glItem.create) {}
export class UpdateGlItemDescriptionDto extends createZodDto(glItem.update) {}
export class GlItemDescriptionFilterDto extends createZodDto(z.object({ subCategoryId: ref.optional() })) {}
export class GlItemDescriptionResponseDto extends responseDto(glItem.response) {}

const group = shapes({ name: name() });
export class CreateAccountGroupDto extends createZodDto(group.create) {}
export class UpdateAccountGroupDto extends createZodDto(group.update) {}
export class AccountGroupResponseDto extends responseDto(group.response) {}

const member = shapes({ groupId: ref, glAccountId: ref });
export class CreateAccountGroupMemberDto extends createZodDto(member.create) {}
export class UpdateAccountGroupMemberDto extends createZodDto(member.update) {}
export class AccountGroupMemberFilterDto extends createZodDto(
  z.object({ groupId: ref.optional(), glAccountId: ref.optional() }),
) {}
export class AccountGroupMemberResponseDto extends responseDto(member.response) {}

const broadHead = shapes({ name: name() });
export class CreateStatementBroadHeadDto extends createZodDto(broadHead.create) {}
export class UpdateStatementBroadHeadDto extends createZodDto(broadHead.update) {}
export class StatementBroadHeadResponseDto extends responseDto(broadHead.response) {}

const subHead = shapes({ broadHeadId: ref, name: name() });
export class CreateStatementSubHeadDto extends createZodDto(subHead.create) {}
export class UpdateStatementSubHeadDto extends createZodDto(subHead.update) {}
export class StatementSubHeadFilterDto extends createZodDto(z.object({ broadHeadId: ref.optional() })) {}
export class StatementSubHeadResponseDto extends responseDto(subHead.response) {}

const mapping = shapes({ glAccountId: ref, subHeadId: ref });
export class CreateGlStatementMappingDto extends createZodDto(mapping.create) {}
export class UpdateGlStatementMappingDto extends createZodDto(mapping.update) {}
export class GlStatementMappingFilterDto extends createZodDto(
  z.object({ glAccountId: ref.optional(), subHeadId: ref.optional() }),
) {}
export class GlStatementMappingResponseDto extends responseDto(mapping.response) {}

const fiscalFields = { label: z.string().trim().min(1).max(20), startsOn: day, endsOn: day, isClosed: z.boolean() };
export class CreateFiscalYearDto extends createZodDto(
  z
    .strictObject({ ...fiscalFields, isClosed: z.boolean().default(false) })
    .refine((value) => value.endsOn > value.startsOn, { message: 'The end is not after the start', path: ['endsOn'] }),
) {}
export class UpdateFiscalYearDto extends createZodDto(updateSchema(fiscalFields)) {}
export class FiscalYearResponseDto extends responseDto(
  recordResponseShape({ ...fiscalFields, startsOn: z.string(), endsOn: z.string() }),
) {}

const journalType = shapes(
  { shortName: z.string().trim().min(1).max(10), name: name(100), description: optionalText(500) },
  ['description'],
);
export class CreateJournalTypeDto extends createZodDto(journalType.create) {}
export class UpdateJournalTypeDto extends createZodDto(journalType.update) {}
export class JournalTypeResponseDto extends responseDto(journalType.response) {}

const voucherType = shapes({ code, title: name(100) });
export class CreateVoucherTypeDto extends createZodDto(voucherType.create) {}
export class UpdateVoucherTypeDto extends createZodDto(voucherType.update) {}
export class VoucherTypeResponseDto extends responseDto(voucherType.response) {}

const costCenter = shapes({ name: name(100), description: optionalText(500) }, ['description']);
export class CreateCostCenterDto extends createZodDto(costCenter.create) {}
export class UpdateCostCenterDto extends createZodDto(costCenter.update) {}
export class CostCenterResponseDto extends responseDto(costCenter.response) {}

const bank = shapes(
  {
    bankName: name(100),
    branch: optionalText(100),
    contactNo: optionalText(50),
    accountNo: z.string().trim().min(1).max(50),
    signatories: optionalText(200),
    glAccountId: ref.nullable(),
  },
  ['branch', 'contactNo', 'signatories', 'glAccountId'],
);
export class CreateBankAccountDto extends createZodDto(bank.create) {}
export class UpdateBankAccountDto extends createZodDto(bank.update) {}
export class BankAccountResponseDto extends responseDto(bank.response) {}

const terminal = shapes({ name: name(100), bankAccountId: ref });
export class CreatePosTerminalDto extends createZodDto(terminal.create) {}
export class UpdatePosTerminalDto extends createZodDto(terminal.update) {}
export class PosTerminalFilterDto extends createZodDto(z.object({ bankAccountId: ref.optional() })) {}
export class PosTerminalResponseDto extends responseDto(terminal.response) {}

const subLedgerType = shapes({ name: name(100) });
export class CreateSubLedgerTypeDto extends createZodDto(subLedgerType.create) {}
export class UpdateSubLedgerTypeDto extends createZodDto(subLedgerType.update) {}
export class SubLedgerTypeResponseDto extends responseDto(subLedgerType.response) {}

const subLedger = shapes(
  {
    typeId: ref,
    name: name(200),
    address: optionalText(300),
    mobileNo: optionalText(30),
    email: z.email().max(254).nullable(),
    reference: optionalText(100),
  },
  ['address', 'mobileNo', 'email', 'reference'],
);
export class CreateSubLedgerDto extends createZodDto(subLedger.create) {}
export class UpdateSubLedgerDto extends createZodDto(subLedger.update) {}
export class SubLedgerFilterDto extends createZodDto(z.object({ typeId: ref.optional() })) {}
export class SubLedgerResponseDto extends responseDto(subLedger.response) {}

const treeAccount = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  kind: z.string(),
  isActive: z.boolean(),
});
const head = <T extends z.ZodTypeAny>(children: T) =>
  z.object({ id: z.uuid(), code: z.string().nullable(), name: z.string(), children: z.array(children) });
export class ChartOfAccountsResponseDto extends responseDto({
  natures: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      name: z.string(),
      statement: z.string(),
      normalBalance: z.string(),
      children: z.array(head(head(head(head(treeAccount))))),
    }),
  ),
}) {}
