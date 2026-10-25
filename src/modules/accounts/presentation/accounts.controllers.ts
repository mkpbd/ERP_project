import { Controller, Get } from '@nestjs/common';
import { QueryBus } from '@nestjs/cqrs';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Actor } from '../../../shared/application/actor.js';
import { CurrentUser, RequirePermissions } from '../../../shared/presentation/auth.decorators.js';
import { createRecordController } from '../../../shared/presentation/record-controller.js';
import { ACCOUNT_RECORDS as R } from '../application/accounts.constants.js';
import { GetChartOfAccountsQuery, type ChartOfAccounts } from '../application/chart.js';
import {
  AccountGroupMemberFilterDto,
  AccountGroupMemberResponseDto,
  AccountGroupResponseDto,
  BankAccountResponseDto,
  CategoryFilterDto,
  CategoryResponseDto,
  ChartOfAccountsResponseDto,
  CoaDescriptionResponseDto,
  CostCenterResponseDto,
  CreateAccountGroupDto,
  CreateAccountGroupMemberDto,
  CreateBankAccountDto,
  CreateCategoryDto,
  CreateCoaDescriptionDto,
  CreateCostCenterDto,
  CreateFiscalYearDto,
  CreateFsLineItemDto,
  CreateGlAccountDto,
  CreateGlItemDescriptionDto,
  CreateGlStatementMappingDto,
  CreateJournalTypeDto,
  CreateLevel4HeadDto,
  CreateLevel5HeadDto,
  CreateNatureDto,
  CreatePosTerminalDto,
  CreateStatementBroadHeadDto,
  CreateStatementSubHeadDto,
  CreateSubCategoryDto,
  CreateSubLedgerDto,
  CreateSubLedgerTypeDto,
  CreateVoucherTypeDto,
  FiscalYearResponseDto,
  FsLineItemResponseDto,
  GlAccountFilterDto,
  GlAccountResponseDto,
  GlItemDescriptionFilterDto,
  GlItemDescriptionResponseDto,
  GlStatementMappingFilterDto,
  GlStatementMappingResponseDto,
  JournalTypeResponseDto,
  Level4HeadFilterDto,
  Level4HeadResponseDto,
  Level5HeadFilterDto,
  Level5HeadResponseDto,
  NatureResponseDto,
  PosTerminalFilterDto,
  PosTerminalResponseDto,
  StatementBroadHeadResponseDto,
  StatementSubHeadFilterDto,
  StatementSubHeadResponseDto,
  SubCategoryFilterDto,
  SubCategoryResponseDto,
  SubLedgerFilterDto,
  SubLedgerResponseDto,
  SubLedgerTypeResponseDto,
  UpdateAccountGroupDto,
  UpdateAccountGroupMemberDto,
  UpdateBankAccountDto,
  UpdateCategoryDto,
  UpdateCoaDescriptionDto,
  UpdateCostCenterDto,
  UpdateFiscalYearDto,
  UpdateFsLineItemDto,
  UpdateGlAccountDto,
  UpdateGlItemDescriptionDto,
  UpdateGlStatementMappingDto,
  UpdateJournalTypeDto,
  UpdateLevel4HeadDto,
  UpdateLevel5HeadDto,
  UpdateNatureDto,
  UpdatePosTerminalDto,
  UpdateStatementBroadHeadDto,
  UpdateStatementSubHeadDto,
  UpdateSubCategoryDto,
  UpdateSubLedgerDto,
  UpdateSubLedgerTypeDto,
  UpdateVoucherTypeDto,
  VoucherTypeResponseDto,
  BookFilterDto,
  CreatePfDepositDto,
  UpdatePfDepositDto,
  PfDepositResponseDto,
  PfDepositFilterDto,
  CreatePfFixedDepositDto,
  UpdatePfFixedDepositDto,
  PfFixedDepositResponseDto,
  CreateTdsRuleDto,
  UpdateTdsRuleDto,
  TdsRuleResponseDto,
  TdsRuleFilterDto,
} from './dto/accounts.dto.js';

const accounts = { tag: 'accounts', readPermission: 'accounts:read', managePermission: 'accounts:manage' } as const;

export const NaturesController = createRecordController({
  ...accounts,
  className: 'NaturesController',
  path: 'accounts/natures',
  type: R.nature,
  label: 'nature of account',
  create: CreateNatureDto,
  update: UpdateNatureDto,
  response: NatureResponseDto,
  filter: BookFilterDto,
});

export const CategoriesController = createRecordController({
  ...accounts,
  className: 'CategoriesController',
  path: 'accounts/categories',
  type: R.category,
  label: 'account category',
  create: CreateCategoryDto,
  update: UpdateCategoryDto,
  response: CategoryResponseDto,
  filter: CategoryFilterDto,
});

export const SubCategoriesController = createRecordController({
  ...accounts,
  className: 'SubCategoriesController',
  path: 'accounts/sub-categories',
  type: R.subCategory,
  label: 'account sub-category',
  create: CreateSubCategoryDto,
  update: UpdateSubCategoryDto,
  response: SubCategoryResponseDto,
  filter: SubCategoryFilterDto,
});

export const Level4HeadsController = createRecordController({
  ...accounts,
  className: 'Level4HeadsController',
  path: 'accounts/level4-heads',
  type: R.level4Head,
  label: 'level-4 head',
  create: CreateLevel4HeadDto,
  update: UpdateLevel4HeadDto,
  response: Level4HeadResponseDto,
  filter: Level4HeadFilterDto,
});

export const Level5HeadsController = createRecordController({
  ...accounts,
  className: 'Level5HeadsController',
  path: 'accounts/level5-heads',
  type: R.level5Head,
  label: 'level-5 head',
  create: CreateLevel5HeadDto,
  update: UpdateLevel5HeadDto,
  response: Level5HeadResponseDto,
  filter: Level5HeadFilterDto,
});

export const GlAccountsController = createRecordController({
  ...accounts,
  className: 'GlAccountsController',
  path: 'accounts/gl-accounts',
  type: R.glAccount,
  label: 'GL account',
  create: CreateGlAccountDto,
  update: UpdateGlAccountDto,
  response: GlAccountResponseDto,
  filter: GlAccountFilterDto,
});

export const CoaDescriptionsController = createRecordController({
  ...accounts,
  className: 'CoaDescriptionsController',
  path: 'accounts/coa-descriptions',
  type: R.coaDescription,
  label: 'COA description',
  create: CreateCoaDescriptionDto,
  update: UpdateCoaDescriptionDto,
  response: CoaDescriptionResponseDto,
});

export const FsLineItemsController = createRecordController({
  ...accounts,
  className: 'FsLineItemsController',
  path: 'accounts/fs-line-items',
  type: R.fsLineItem,
  label: 'financial statement line item',
  create: CreateFsLineItemDto,
  update: UpdateFsLineItemDto,
  response: FsLineItemResponseDto,
});

export const GlItemDescriptionsController = createRecordController({
  ...accounts,
  className: 'GlItemDescriptionsController',
  path: 'accounts/gl-item-descriptions',
  type: R.glItemDescription,
  label: 'GL item description',
  create: CreateGlItemDescriptionDto,
  update: UpdateGlItemDescriptionDto,
  response: GlItemDescriptionResponseDto,
  filter: GlItemDescriptionFilterDto,
});

export const AccountGroupsController = createRecordController({
  ...accounts,
  className: 'AccountGroupsController',
  path: 'accounts/account-groups',
  type: R.accountGroup,
  label: 'account group',
  create: CreateAccountGroupDto,
  update: UpdateAccountGroupDto,
  response: AccountGroupResponseDto,
});

export const AccountGroupMembersController = createRecordController({
  ...accounts,
  className: 'AccountGroupMembersController',
  path: 'accounts/account-group-members',
  type: R.accountGroupMember,
  label: 'account group member',
  create: CreateAccountGroupMemberDto,
  update: UpdateAccountGroupMemberDto,
  response: AccountGroupMemberResponseDto,
  filter: AccountGroupMemberFilterDto,
});

export const StatementBroadHeadsController = createRecordController({
  ...accounts,
  className: 'StatementBroadHeadsController',
  path: 'accounts/statement-broad-heads',
  type: R.statementBroadHead,
  label: 'statement broad head',
  create: CreateStatementBroadHeadDto,
  update: UpdateStatementBroadHeadDto,
  response: StatementBroadHeadResponseDto,
});

export const StatementSubHeadsController = createRecordController({
  ...accounts,
  className: 'StatementSubHeadsController',
  path: 'accounts/statement-sub-heads',
  type: R.statementSubHead,
  label: 'statement sub-head',
  create: CreateStatementSubHeadDto,
  update: UpdateStatementSubHeadDto,
  response: StatementSubHeadResponseDto,
  filter: StatementSubHeadFilterDto,
});

export const GlStatementMappingsController = createRecordController({
  ...accounts,
  className: 'GlStatementMappingsController',
  path: 'accounts/gl-statement-mappings',
  type: R.glStatementMapping,
  label: 'GL statement mapping',
  create: CreateGlStatementMappingDto,
  update: UpdateGlStatementMappingDto,
  response: GlStatementMappingResponseDto,
  filter: GlStatementMappingFilterDto,
});

export const FiscalYearsController = createRecordController({
  ...accounts,
  className: 'FiscalYearsController',
  path: 'accounts/fiscal-years',
  type: R.fiscalYear,
  label: 'fiscal year',
  create: CreateFiscalYearDto,
  update: UpdateFiscalYearDto,
  response: FiscalYearResponseDto,
});

export const JournalTypesController = createRecordController({
  ...accounts,
  className: 'JournalTypesController',
  path: 'accounts/journal-types',
  type: R.journalType,
  label: 'journal type',
  create: CreateJournalTypeDto,
  update: UpdateJournalTypeDto,
  response: JournalTypeResponseDto,
  filter: BookFilterDto,
});

export const VoucherTypesController = createRecordController({
  ...accounts,
  className: 'VoucherTypesController',
  path: 'accounts/voucher-types',
  type: R.voucherType,
  label: 'voucher type',
  create: CreateVoucherTypeDto,
  update: UpdateVoucherTypeDto,
  response: VoucherTypeResponseDto,
});

export const CostCentersController = createRecordController({
  ...accounts,
  className: 'CostCentersController',
  path: 'accounts/cost-centers',
  type: R.costCenter,
  label: 'cost center',
  create: CreateCostCenterDto,
  update: UpdateCostCenterDto,
  response: CostCenterResponseDto,
});

export const BankAccountsController = createRecordController({
  ...accounts,
  className: 'BankAccountsController',
  path: 'accounts/bank-accounts',
  type: R.bankAccount,
  label: 'bank account',
  create: CreateBankAccountDto,
  update: UpdateBankAccountDto,
  response: BankAccountResponseDto,
});

export const PosTerminalsController = createRecordController({
  ...accounts,
  className: 'PosTerminalsController',
  path: 'accounts/pos-terminals',
  type: R.posTerminal,
  label: 'POS terminal',
  create: CreatePosTerminalDto,
  update: UpdatePosTerminalDto,
  response: PosTerminalResponseDto,
  filter: PosTerminalFilterDto,
});

export const SubLedgerTypesController = createRecordController({
  ...accounts,
  className: 'SubLedgerTypesController',
  path: 'accounts/sub-ledger-types',
  type: R.subLedgerType,
  label: 'sub-ledger type',
  create: CreateSubLedgerTypeDto,
  update: UpdateSubLedgerTypeDto,
  response: SubLedgerTypeResponseDto,
});

export const SubLedgersController = createRecordController({
  ...accounts,
  className: 'SubLedgersController',
  path: 'accounts/sub-ledgers',
  type: R.subLedger,
  label: 'sub-ledger',
  create: CreateSubLedgerDto,
  update: UpdateSubLedgerDto,
  response: SubLedgerResponseDto,
  filter: SubLedgerFilterDto,
});

export const PfDepositsController = createRecordController({
  ...accounts,
  className: 'PfDepositsController',
  path: 'accounts/pf-deposits',
  type: R.pfDeposit,
  label: 'PF deposit',
  create: CreatePfDepositDto,
  update: UpdatePfDepositDto,
  response: PfDepositResponseDto,
  filter: PfDepositFilterDto,
});

export const PfFixedDepositsController = createRecordController({
  ...accounts,
  className: 'PfFixedDepositsController',
  path: 'accounts/pf-fixed-deposits',
  type: R.pfFixedDeposit,
  label: 'PF fixed deposit',
  create: CreatePfFixedDepositDto,
  update: UpdatePfFixedDepositDto,
  response: PfFixedDepositResponseDto,
});

export const TdsRulesController = createRecordController({
  ...accounts,
  className: 'TdsRulesController',
  path: 'accounts/tds-rules',
  type: R.tdsRule,
  label: 'TDS rule',
  create: CreateTdsRuleDto,
  update: UpdateTdsRuleDto,
  response: TdsRuleResponseDto,
  filter: TdsRuleFilterDto,
});

@ApiTags('accounts')
@ApiBearerAuth()
@Controller({ path: 'accounts/chart', version: '1' })
export class ChartOfAccountsController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @RequirePermissions('accounts:read')
  @ApiOperation({ summary: 'The whole chart of accounts as a tree' })
  @ApiOkResponse({ type: ChartOfAccountsResponseDto })
  chart(@CurrentUser() actor: Actor): Promise<ChartOfAccounts> {
    return this.queryBus.execute(new GetChartOfAccountsQuery(actor));
  }
}

export const ACCOUNTS_RECORD_CONTROLLERS = [
  NaturesController,
  CategoriesController,
  SubCategoriesController,
  Level4HeadsController,
  Level5HeadsController,
  GlAccountsController,
  CoaDescriptionsController,
  FsLineItemsController,
  GlItemDescriptionsController,
  AccountGroupsController,
  AccountGroupMembersController,
  StatementBroadHeadsController,
  StatementSubHeadsController,
  GlStatementMappingsController,
  FiscalYearsController,
  JournalTypesController,
  VoucherTypesController,
  CostCentersController,
  BankAccountsController,
  PosTerminalsController,
  SubLedgerTypesController,
  SubLedgersController,
  PfDepositsController,
  PfFixedDepositsController,
  TdsRulesController,
];
