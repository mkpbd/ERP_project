import { randomUUID } from 'node:crypto';
import { and, eq, gte, lte, or, sql } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { voucherNumber } from '../../modules/accounts/domain/voucher.js';
import {
  accountCategories,
  accountLevel4Heads,
  accountLevel5Heads,
  accountNatures,
  accountSubCategories,
  bankAccounts,
  coaDescriptions,
  costCenters,
  fiscalYears,
  glAccounts,
  glRoles,
  journalTypes,
  subLedgers,
  subLedgerTypes,
  voucherLines,
  vouchers,
  voucherSequences,
} from '../../modules/accounts/infrastructure/persistence/accounts.schema.js';
import {
  dayBefore,
  fiscalYearRecord,
  glAccountRecord,
  natureRecord,
  openingLines,
  text,
  type Balance,
  type LegacyGeneralLedger,
  type LegacyNature,
} from './account-records.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';

const NIL = '00000000-0000-0000-0000-000000000000';
/** A Guid column read as text (the driver gives Guids upper-cased; the id map ignores case). */
const guid = (column: string) => `CAST([${column}] AS nvarchar(36)) AS [${column}]`;
const oldId = (value: string | null | undefined) => (value && value !== NIL ? value : null);

/** The opening voucher's journal, made when the old journals had none of that short name. */
export const OPENING_JOURNAL = 'OB';
export const OPENING_SOURCE = 'data-migration';

/**
 * The posting roles the old system hard-coded (AppConstants *GLId) and the role each is here; the accounts they name
 * are given those roles when brought over.
 */
const OLD_ROLE_ACCOUNTS: Readonly<Record<string, string>> = {
  '5d525e24-31a9-444d-558d-08dc9d9989d2': 'ipd_receivable',
  'd90657af-d0d4-46fc-1841-08dcc0334220': 'ipd_advance',
  'bd52240a-d093-4f02-6ef4-08dc73f57d74': 'cash_in_hand',
  'a505f953-6808-4402-9fd2-08dcc67febc9': 'supplier_payable',
  '4a0bf756-3861-4910-288a-08dcbf94ffbd': 'store_inventory',
  'd2a75694-abab-4d70-288b-08dcbf94ffbd': 'pharmacy_inventory',
};

/** Pages of an old table in key order: the query takes @after (the last key read) and @n (the page size). */
async function* pages<T extends Record<string, unknown>>(
  context: EtlContext,
  query: string,
  key: (row: T) => string,
): AsyncGenerator<T[]> {
  let after = NIL;
  for (;;) {
    const rows = await context.source.query<T>(query, { after, n: context.batchSize });
    if (rows.length === 0) return;
    yield rows;
    after = key(rows[rows.length - 1]!);
    if (rows.length < context.batchSize) return;
  }
}

/** Skips a row brought over before (counting it kept); true when it still needs bringing. */
async function isNew(context: EtlContext, report: LoaderReport, entity: string, id: string): Promise<boolean> {
  report.read += 1;
  if (await context.ids.has(entity, id)) {
    report.kept += 1;
    return false;
  }
  return true;
}

/** Old Account.NatureOfAccounts (with MasterStatements) → account_natures, by code or name. */
export function accountNaturesLoader(db: DbContext): Loader {
  return {
    name: 'account-natures',
    dependsOn: [],
    async run(context, report) {
      const existing = await db.db
        .select({ id: accountNatures.id, code: accountNatures.code, name: accountNatures.name })
        .from(accountNatures);
      const byCode = new Map(existing.map((row) => [row.code.toUpperCase(), row.id]));
      const byName = new Map(existing.map((row) => [row.name.toLowerCase(), row.id]));
      const rows = await context.source.query<LegacyNature & Record<string, unknown>>(
        `SELECT n.[Id], n.[Name], n.[CodeNo], s.[Name] AS [Statement] FROM [Account].[NatureOfAccounts] n
         LEFT JOIN [Account].[MasterStatements] s ON s.[Id] = n.[MasterStatementId] ORDER BY n.[Id]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'account-nature', String(row.Id)))) continue;
        const result = natureRecord(row);
        if (!result.ok) {
          noteRejection(report, String(row.Id), result.reason);
          continue;
        }
        const nature = result.value;
        let id = byCode.get(nature.code.toUpperCase()) ?? byName.get(nature.name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await db.db.insert(accountNatures).values({ id, ...nature });
          byCode.set(nature.code.toUpperCase(), id);
          byName.set(nature.name.toLowerCase(), id);
          report.written += 1;
          report.notes.push(`${nature.name}: ${nature.statement.replace(/_/g, ' ')}, ${nature.normalBalance} balance`);
        }
        await context.ids.set('account-nature', String(row.Id), id);
      }
    },
  };
}

/**
 * A level of the chart under a parent (categories, sub-categories, level-4 and level-5 heads): matched by name within
 * the parent, else made.
 */
function chartLevelLoader(
  db: DbContext,
  spec: {
    name: string;
    entity: string;
    parentEntity: string;
    dependsOn: string;
    query: string;
    parentOf: (row: { Parent: string | number }) => string;
    existing: () => Promise<{ id: string; parentId: string; name: string; code: string | null }[]>;
    insert: (row: { id: string; parentId: string; name: string; code: string | null }) => Promise<void>;
    codes?: boolean;
  },
): Loader {
  return {
    name: spec.name,
    dependsOn: [spec.dependsOn],
    async run(context, report) {
      const existing = await spec.existing();
      const byName = new Map(existing.map((row) => [`${row.parentId}|${row.name.toLowerCase()}`, row.id]));
      const codes = new Set(existing.flatMap((row) => (row.code ? [row.code.toUpperCase()] : [])));
      const rows = await context.source.query<{
        Id: string;
        Parent: string | number;
        Name: string | null;
        CodeNo?: string | null;
      }>(spec.query);
      for (const row of rows) {
        if (!(await isNew(context, report, spec.entity, row.Id))) continue;
        const parentId = await context.ids.get(spec.parentEntity, spec.parentOf(row));
        if (!parentId) {
          noteRejection(report, row.Id, 'parent_not_brought');
          continue;
        }
        const name = text(row.Name, 150);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = byName.get(`${parentId}|${name.toLowerCase()}`);
        if (!id) {
          let code = text(row.CodeNo, 30);
          if (spec.codes && !code) {
            noteRejection(report, row.Id, 'no_code');
            continue;
          }
          if (code && codes.has(code.toUpperCase())) {
            if (spec.codes) {
              // Two old rows shared the code: the second gets the code with a number, so what is under it comes too.
              let n = 2;
              while (codes.has(`${code}-${n}`.toUpperCase())) n += 1;
              report.notes.push(`${name}: code ${code} is another's; coded ${code}-${n}`);
              code = `${code}-${n}`;
            } else {
              code = null;
            }
          }
          id = randomUUID();
          await spec.insert({ id, parentId, name, code });
          byName.set(`${parentId}|${name.toLowerCase()}`, id);
          if (code) codes.add(code.toUpperCase());
          report.written += 1;
        }
        await context.ids.set(spec.entity, row.Id, id);
      }
    },
  };
}

export function accountCategoriesLoader(db: DbContext): Loader {
  return chartLevelLoader(db, {
    name: 'account-categories',
    entity: 'account-category',
    parentEntity: 'account-nature',
    dependsOn: 'account-natures',
    query: `SELECT ${guid('Id')}, [NatueOfAccountId] AS [Parent], [Name], [CodeNo] FROM [Account].[Categories]
      ORDER BY [CodeNo]`,
    parentOf: (row) => String(row.Parent),
    codes: true,
    existing: () =>
      db.db
        .select({
          id: accountCategories.id,
          parentId: accountCategories.natureId,
          name: accountCategories.name,
          code: accountCategories.code,
        })
        .from(accountCategories),
    insert: async (row) => {
      await db.db
        .insert(accountCategories)
        .values({ id: row.id, natureId: row.parentId, name: row.name, code: row.code! });
    },
  });
}

export function accountSubCategoriesLoader(db: DbContext): Loader {
  return chartLevelLoader(db, {
    name: 'account-sub-categories',
    entity: 'account-sub-category',
    parentEntity: 'account-category',
    dependsOn: 'account-categories',
    query: `SELECT ${guid('Id')}, CAST([CategoryId] AS nvarchar(36)) AS [Parent], [Name] FROM [Account].[SubCategories]`,
    parentOf: (row) => String(row.Parent),
    existing: () =>
      db.db
        .select({
          id: accountSubCategories.id,
          parentId: accountSubCategories.categoryId,
          name: accountSubCategories.name,
          code: accountSubCategories.code,
        })
        .from(accountSubCategories),
    insert: async (row) => {
      await db.db.insert(accountSubCategories).values({ id: row.id, categoryId: row.parentId, name: row.name });
    },
  });
}

export function accountLevel4HeadsLoader(db: DbContext): Loader {
  return chartLevelLoader(db, {
    name: 'account-level4-heads',
    entity: 'account-level4-head',
    parentEntity: 'account-sub-category',
    dependsOn: 'account-sub-categories',
    query: `SELECT ${guid('Id')}, CAST([SubCategoryId] AS nvarchar(36)) AS [Parent], [Name] FROM [Account].[Level4Heads]`,
    parentOf: (row) => String(row.Parent),
    existing: () =>
      db.db
        .select({
          id: accountLevel4Heads.id,
          parentId: accountLevel4Heads.subCategoryId,
          name: accountLevel4Heads.name,
          code: accountLevel4Heads.code,
        })
        .from(accountLevel4Heads),
    insert: async (row) => {
      await db.db.insert(accountLevel4Heads).values({ id: row.id, subCategoryId: row.parentId, name: row.name });
    },
  });
}

export function accountLevel5HeadsLoader(db: DbContext): Loader {
  return chartLevelLoader(db, {
    name: 'account-level5-heads',
    entity: 'account-level5-head',
    parentEntity: 'account-level4-head',
    dependsOn: 'account-level4-heads',
    query: `SELECT ${guid('Id')}, CAST([Level4HeadId] AS nvarchar(36)) AS [Parent], [Name] FROM [Account].[Level5Heads]`,
    parentOf: (row) => String(row.Parent),
    existing: () =>
      db.db
        .select({
          id: accountLevel5Heads.id,
          parentId: accountLevel5Heads.level4HeadId,
          name: accountLevel5Heads.name,
          code: accountLevel5Heads.code,
        })
        .from(accountLevel5Heads),
    insert: async (row) => {
      await db.db.insert(accountLevel5Heads).values({ id: row.id, level4HeadId: row.parentId, name: row.name });
    },
  });
}

/** A flat list of named records (cost centres, COA descriptions, sub-ledger types): matched by name, else made. */
function namedLoader(
  db: DbContext,
  spec: {
    name: string;
    entity: string;
    query: string;
    max: number;
    existing: () => Promise<{ id: string; name: string }[]>;
    insert: (row: { id: string; name: string; Description?: unknown; CodeNo?: unknown }) => Promise<void>;
  },
): Loader {
  return {
    name: spec.name,
    dependsOn: [],
    async run(context, report) {
      const byName = new Map((await spec.existing()).map((row) => [row.name.toLowerCase(), row.id]));
      const rows = await context.source.query<{ Id: string; Name: string | null }>(spec.query);
      for (const row of rows) {
        if (!(await isNew(context, report, spec.entity, row.Id))) continue;
        const name = text(row.Name, spec.max);
        if (!name) {
          noteRejection(report, row.Id, 'no_name');
          continue;
        }
        let id = byName.get(name.toLowerCase());
        if (!id) {
          id = randomUUID();
          await spec.insert({ ...row, id, name });
          byName.set(name.toLowerCase(), id);
          report.written += 1;
        }
        await context.ids.set(spec.entity, row.Id, id);
      }
    },
  };
}

export function coaDescriptionsLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'coa-descriptions',
    entity: 'coa-description',
    query: `SELECT ${guid('Id')}, [Name], [CodeNo] FROM [Account].[COADescription]`,
    max: 100,
    existing: () => db.db.select({ id: coaDescriptions.id, name: coaDescriptions.name }).from(coaDescriptions),
    insert: async (row) => {
      await db.db.insert(coaDescriptions).values({ id: row.id, name: row.name, code: text(row.CodeNo, 30) });
    },
  });
}

export function costCentersLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'cost-centers',
    entity: 'cost-center',
    query: `SELECT ${guid('Id')}, [Name], [Description] FROM [Account].[CostCenters]`,
    max: 100,
    existing: () => db.db.select({ id: costCenters.id, name: costCenters.name }).from(costCenters),
    insert: async (row) => {
      await db.db.insert(costCenters).values({ id: row.id, name: row.name, description: text(row.Description, 500) });
    },
  });
}

export function subLedgerTypesLoader(db: DbContext): Loader {
  return namedLoader(db, {
    name: 'sub-ledger-types',
    entity: 'sub-ledger-type',
    query: `SELECT ${guid('Id')}, [Name] FROM [Account].[SubLedgerTypes]`,
    max: 100,
    existing: () => db.db.select({ id: subLedgerTypes.id, name: subLedgerTypes.name }).from(subLedgerTypes),
    insert: async (row) => {
      await db.db.insert(subLedgerTypes).values({ id: row.id, name: row.name });
    },
  });
}

/**
 * Old Account.GeneralLedgers → gl_accounts, by code (an existing account of the code is used). The accounts the old
 * system hard-coded for postings get the posting role each is here.
 */
export function glAccountsLoader(db: DbContext): Loader {
  return {
    name: 'gl-accounts',
    dependsOn: ['account-level5-heads', 'coa-descriptions'],
    async run(context, report) {
      const byCode = new Map(
        (await db.db.select({ id: glAccounts.id, code: glAccounts.code }).from(glAccounts)).map((row) => [
          row.code.toUpperCase(),
          row.id,
        ]),
      );
      const query = `SELECT TOP (@n) ${guid('Id')}, [Name], [GLCodeNo], ${guid('Level5HeadId')},
        ${guid('COADescriptionId')}, [IsControlAccount], [IsCostCenter], [BankCashOth], [IsActive], [IsRecurringCost],
        [IsBillingContainDetails], [IsDeleted]
        FROM [Account].[GeneralLedgers] WHERE [Id] > @after ORDER BY [Id]`;
      for await (const page of pages<LegacyGeneralLedger & Record<string, unknown>>(context, query, (row) => row.Id)) {
        for (const row of page) {
          if (!(await isNew(context, report, 'gl-account', row.Id))) continue;
          // An old account without a code is given one from its old id, to be recoded here.
          const coded = text(row.GLCodeNo, 30) ? row : { ...row, GLCodeNo: `OLD-${row.Id.slice(0, 8).toUpperCase()}` };
          if (coded !== row) {
            report.notes.push(`${text(row.Name, 100) ?? row.Id}: no code in the old system; coded ${coded.GLCodeNo}`);
          }
          const result = glAccountRecord(coded);
          if (!result.ok) {
            noteRejection(report, row.Id, result.reason);
            continue;
          }
          const account = result.value;
          const level5HeadId = await context.ids.get('account-level5-head', row.Level5HeadId);
          if (!level5HeadId) {
            noteRejection(report, row.Id, 'head_not_brought');
            continue;
          }
          let id = byCode.get(account.code);
          if (id) {
            report.notes.push(`Account ${account.code} already existed and was used as it is`);
          } else {
            id = randomUUID();
            const description = oldId(row.COADescriptionId);
            await db.db.insert(glAccounts).values({
              id,
              level5HeadId,
              ...account,
              coaDescriptionId: description ? await context.ids.get('coa-description', description) : null,
            });
            byCode.set(account.code, id);
            report.written += 1;
          }
          await context.ids.set('gl-account', row.Id, id);
          const role = OLD_ROLE_ACCOUNTS[row.Id.toLowerCase()];
          if (role) {
            const set = await db.db
              .insert(glRoles)
              .values({ id: randomUUID(), role, glAccountId: id, description: 'Set from the old system' })
              .onConflictDoNothing({ target: glRoles.role })
              .returning({ id: glRoles.id });
            report.notes.push(
              set.length
                ? `Posting role ${role} → ${account.code}`
                : `Posting role ${role} was already set; ${account.code} left out of it`,
            );
          }
        }
      }
      report.notes.push('Set the other posting roles before anything posts');
    },
  };
}

/** Old Account.Banks → bank_accounts, by bank and account number. The old banks had no account: link each here. */
export function bankAccountsLoader(db: DbContext): Loader {
  return {
    name: 'bank-accounts',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (
          await db.db
            .select({ id: bankAccounts.id, bank: bankAccounts.bankName, no: bankAccounts.accountNo })
            .from(bankAccounts)
        ).map((row) => [`${row.bank.toLowerCase()}|${row.no}`, row.id]),
      );
      const rows = await context.source.query<{
        Id: string;
        BankName: string | null;
        BranchAddress: string | null;
        ContactNo: string | null;
        AccountNo: string | null;
        Signatories: string | null;
      }>(`SELECT ${guid('Id')}, [BankName], [BranchAddress], [ContactNo], [AccountNo], [Signatories]
        FROM [Account].[Banks]`);
      for (const row of rows) {
        if (!(await isNew(context, report, 'bank-account', row.Id))) continue;
        const bankName = text(row.BankName, 100);
        const accountNo = text(row.AccountNo, 50);
        if (!bankName || !accountNo) {
          noteRejection(report, row.Id, bankName ? 'no_account_no' : 'no_bank_name');
          continue;
        }
        const key = `${bankName.toLowerCase()}|${accountNo}`;
        let id = existing.get(key);
        if (!id) {
          id = randomUUID();
          await db.db.insert(bankAccounts).values({
            id,
            bankName,
            accountNo,
            branch: text(row.BranchAddress, 200),
            contactNo: text(row.ContactNo, 50),
            signatories: text(row.Signatories, 500),
          });
          existing.set(key, id);
          report.written += 1;
        }
        await context.ids.set('bank-account', row.Id, id);
      }
      if (report.written) report.notes.push('Link each bank account to its GL account');
    },
  };
}

/** Old Account.SubLedgers → sub_ledgers (parties under control accounts), with their type. */
export function subLedgersLoader(db: DbContext): Loader {
  return {
    name: 'sub-ledgers',
    dependsOn: ['sub-ledger-types'],
    async run(context, report) {
      const query = `SELECT TOP (@n) ${guid('Id')}, ${guid('SubLedgerTypeId')}, [InvoiceNo], [Name], [Address],
        [MobileNo], [EmailAddress] FROM [Account].[SubLedgers] WHERE [Id] > @after ORDER BY [Id]`;
      type Row = {
        Id: string;
        SubLedgerTypeId: string;
        InvoiceNo: number | string | null;
        Name: string | null;
        Address: string | null;
        MobileNo: string | null;
        EmailAddress: string | null;
      };
      for await (const page of pages<Row>(context, query, (row) => row.Id)) {
        const values: (typeof subLedgers.$inferInsert)[] = [];
        for (const row of page) {
          if (!(await isNew(context, report, 'sub-ledger', row.Id))) continue;
          const typeId = await context.ids.get('sub-ledger-type', row.SubLedgerTypeId);
          if (!typeId) {
            noteRejection(report, row.Id, 'type_not_brought');
            continue;
          }
          const name = text(row.Name, 200);
          if (!name) {
            noteRejection(report, row.Id, 'no_name');
            continue;
          }
          const id = randomUUID();
          const invoice = Number(row.InvoiceNo ?? 0);
          values.push({
            id,
            typeId,
            name,
            address: text(row.Address, 300),
            mobileNo: text(row.MobileNo, 30),
            email: text(row.EmailAddress, 150)?.toLowerCase() ?? null,
            reference: invoice > 0 ? String(invoice) : null,
          });
          await context.ids.set('sub-ledger', row.Id, id);
        }
        if (values.length) await db.db.insert(subLedgers).values(values);
        report.written += values.length;
      }
    },
  };
}

/** Old Account.JournalTypes → journal_types (main book), by short name. */
export function journalTypesLoader(db: DbContext): Loader {
  return {
    name: 'journal-types',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (await db.db.select({ id: journalTypes.id, shortName: journalTypes.shortName }).from(journalTypes)).map(
          (row) => [row.shortName.toUpperCase(), row.id],
        ),
      );
      const rows = await context.source.query<{
        Id: string;
        Name: string | null;
        ShortName: string | null;
        Description: string | null;
      }>(`SELECT ${guid('Id')}, [Name], [ShortName], [Description] FROM [Account].[JournalTypes]`);
      for (const row of rows) {
        if (!(await isNew(context, report, 'journal-type', row.Id))) continue;
        const shortName = text(row.ShortName, 10)?.toUpperCase().replace(/\s/g, '');
        const name = text(row.Name, 100);
        if (!shortName || !name) {
          noteRejection(report, row.Id, shortName ? 'no_name' : 'no_short_name');
          continue;
        }
        let id = existing.get(shortName);
        if (!id) {
          id = randomUUID();
          await db.db
            .insert(journalTypes)
            .values({ id, shortName, name, description: text(row.Description, 500), book: 'main' });
          existing.set(shortName, id);
          report.written += 1;
        }
        await context.ids.set('journal-type', row.Id, id);
      }
    },
  };
}

/** Old Account.FiscalYears (calendar years) → fiscal_years, open; close the past ones here once checked. */
export function fiscalYearsLoader(db: DbContext): Loader {
  return {
    name: 'fiscal-years',
    dependsOn: [],
    async run(context, report) {
      const existing = new Map(
        (await db.db.select({ id: fiscalYears.id, startsOn: fiscalYears.startsOn }).from(fiscalYears)).map((row) => [
          row.startsOn,
          row.id,
        ]),
      );
      const rows = await context.source.query<{ Id: string; FYear: number }>(
        `SELECT ${guid('Id')}, [FYear] FROM [Account].[FiscalYears] ORDER BY [FYear]`,
      );
      for (const row of rows) {
        if (!(await isNew(context, report, 'fiscal-year', row.Id))) continue;
        const result = fiscalYearRecord(row.FYear);
        if (!result.ok) {
          noteRejection(report, row.Id, result.reason);
          continue;
        }
        const year = result.value;
        let id = existing.get(year.startsOn);
        if (!id) {
          // A year overlapping one set up here differently (say July to June) cannot be added.
          const [overlap] = await db.db
            .select({ id: fiscalYears.id })
            .from(fiscalYears)
            .where(and(lte(fiscalYears.startsOn, year.endsOn), gte(fiscalYears.endsOn, year.startsOn)));
          if (overlap) {
            noteRejection(report, row.Id, 'overlaps_a_fiscal_year');
            continue;
          }
          id = randomUUID();
          await db.db.insert(fiscalYears).values({ id, ...year });
          existing.set(year.startsOn, id);
          report.written += 1;
        }
        await context.ids.set('fiscal-year', row.Id, id);
      }
    },
  };
}

/**
 * The old books' balances the day before the cut-over → one posted opening voucher (journal OB): every account's
 * all-time balance (this system's statements, like the old ones, count profit from the beginning), split by
 * sub-ledger on control accounts and by cost centre where one is required. Refused, writing nothing, when the old
 * books do not balance, an account with a balance was not brought over, or this system already has postings by then.
 * Written books are checked against the old balances, account by account, before the loader commits.
 */
export function openingBalancesLoader(db: DbContext): Loader {
  return {
    name: 'opening-balances',
    dependsOn: ['gl-accounts', 'sub-ledgers', 'cost-centers', 'fiscal-years', 'journal-types'],
    async run(context, report) {
      if (!context.cutOver) {
        report.notes.push('No --cut-over day given: opening balances were not brought over');
        return;
      }
      const cutOver = context.cutOver;
      const on = dayBefore(cutOver);
      if (await context.ids.has('opening-balance', cutOver)) {
        report.kept += 1;
        return;
      }
      const [earlier] = await db.db
        .select({ number: vouchers.number })
        .from(vouchers)
        .where(
          or(
            and(lte(vouchers.voucherDate, on), sql`${vouchers.status} <> 'draft'`),
            eq(vouchers.sourceModule, OPENING_SOURCE),
          ),
        )
        .limit(1);
      if (earlier) {
        noteRejection(report, cutOver, 'books_not_empty');
        report.notes.push(
          `Voucher ${earlier.number} is an opening already or dated on or before ${on}: balances would count twice`,
        );
        return;
      }
      const [year] = await db.db
        .select({ id: fiscalYears.id, label: fiscalYears.label, isClosed: fiscalYears.isClosed })
        .from(fiscalYears)
        .where(and(lte(fiscalYears.startsOn, on), gte(fiscalYears.endsOn, on)));
      if (!year || year.isClosed) {
        noteRejection(report, cutOver, year ? 'fiscal_year_closed' : 'no_fiscal_year');
        report.notes.push(`Set up an open fiscal year covering ${on} first`);
        return;
      }

      const rows = await context.source.query<{
        GeneralLedgerId: string;
        SubLedgerId: string | null;
        CostCenterId: string | null;
        Debit: number | null;
        Credit: number | null;
      }>(
        `SELECT CAST(d.[GeneralLedgerId] AS nvarchar(36)) AS [GeneralLedgerId],
           CAST(d.[SubLedgerId] AS nvarchar(36)) AS [SubLedgerId], CAST(d.[CostCenterId] AS nvarchar(36)) AS [CostCenterId],
           SUM(CAST(d.[Debit] AS decimal(19, 4))) AS [Debit], SUM(CAST(d.[Credit] AS decimal(19, 4))) AS [Credit]
         FROM [Account].[VoucherMasterDetails] d
         JOIN [Account].[VoucherMasters] m ON m.[Id] = d.[VoucherMasterId]
         WHERE m.[IsDeleted] = 0 AND d.[IsDeleted] = 0 AND m.[VoucherDate] < @cutOver
         GROUP BY d.[GeneralLedgerId], d.[SubLedgerId], d.[CostCenterId]`,
        { cutOver },
      );
      const accounts = new Map(
        (
          await db.db
            .select({
              id: glAccounts.id,
              code: glAccounts.code,
              isControlAccount: glAccounts.isControlAccount,
              requiresCostCenter: glAccounts.requiresCostCenter,
            })
            .from(glAccounts)
        ).map((row) => [row.id, row]),
      );
      const balances: Balance[] = [];
      const missing = new Set<string>();
      let looseSubLedgers = 0;
      for (const row of rows) {
        report.read += 1;
        const debit = Number(row.Debit ?? 0);
        const credit = Number(row.Credit ?? 0);
        const glAccountId = await context.ids.get('gl-account', row.GeneralLedgerId);
        const account = glAccountId ? accounts.get(glAccountId) : undefined;
        if (!account) {
          if (Math.round(debit * 100) !== Math.round(credit * 100)) missing.add(row.GeneralLedgerId);
          continue;
        }
        const subLedger = oldId(row.SubLedgerId);
        const subLedgerId =
          account.isControlAccount && subLedger ? await context.ids.get('sub-ledger', subLedger) : null;
        if (account.isControlAccount && subLedger && !subLedgerId) looseSubLedgers += 1;
        const costCenter = oldId(row.CostCenterId);
        const costCenterId =
          account.requiresCostCenter && costCenter ? await context.ids.get('cost-center', costCenter) : null;
        balances.push({ glAccountId: account.id, subLedgerId, costCenterId, debit, credit });
      }
      if (missing.size) {
        for (const id of missing) noteRejection(report, id, 'account_not_brought');
        report.notes.push('Accounts with a balance were not brought over: nothing was written');
        return;
      }
      const opening = openingLines(balances);
      if (!opening.ok) {
        noteRejection(report, cutOver, 'books_do_not_balance');
        report.notes.push(`The old books' debits exceed their credits by ${opening.difference} on ${on}`);
        return;
      }
      if (opening.lines.length === 0) {
        report.notes.push(`The old books had no balances on ${on}`);
        return;
      }
      if (opening.lines.length > 30_000) {
        noteRejection(report, cutOver, 'too_many_lines');
        return;
      }

      let journal = (
        await db.db
          .select({ id: journalTypes.id, shortName: journalTypes.shortName })
          .from(journalTypes)
          .where(sql`upper(${journalTypes.shortName}) = ${OPENING_JOURNAL}`)
      )[0];
      if (!journal) {
        journal = { id: randomUUID(), shortName: OPENING_JOURNAL };
        await db.db.insert(journalTypes).values({
          ...journal,
          name: 'Opening balances',
          description: 'Balances brought over from the old system',
          book: 'main',
        });
      }
      const [sequence] = await db.db
        .insert(voucherSequences)
        .values({ journalTypeId: journal.id, fiscalYearId: year.id, last: 1 })
        .onConflictDoUpdate({
          target: [voucherSequences.journalTypeId, voucherSequences.fiscalYearId],
          set: { last: sql`${voucherSequences.last} + 1` },
        })
        .returning({ last: voucherSequences.last });
      const id = randomUUID();
      const number = voucherNumber(journal.shortName, year.label, sequence!.last);
      await db.db.insert(vouchers).values({
        id,
        number,
        journalTypeId: journal.id,
        fiscalYearId: year.id,
        voucherDate: on,
        documentDate: on,
        narration: `Opening balances brought over from the old system (books up to ${on})`,
        status: 'posted',
        sourceModule: OPENING_SOURCE,
        sourceReference: `opening:${cutOver}`,
        total: opening.total,
        postedAt: context.now,
      });
      for (let start = 0; start < opening.lines.length; start += 1000) {
        await db.db.insert(voucherLines).values(
          opening.lines.slice(start, start + 1000).map((line, index) => ({
            voucherId: id,
            position: start + index + 1,
            ...line,
            narration: 'Opening balance',
          })),
        );
      }

      // The books here must now say what the old ones said, account by account.
      const expected = new Map<string, number>();
      for (const line of opening.lines) {
        expected.set(
          line.glAccountId,
          (expected.get(line.glAccountId) ?? 0) + Math.round(line.debit * 100) - Math.round(line.credit * 100),
        );
      }
      const written = await db.db
        .select({
          glAccountId: voucherLines.glAccountId,
          net: sql<number>`round(sum(${voucherLines.debit} - ${voucherLines.credit}) * 100)`.mapWith(Number),
        })
        .from(voucherLines)
        .innerJoin(vouchers, eq(vouchers.id, voucherLines.voucherId))
        .where(and(lte(vouchers.voucherDate, on), sql`${vouchers.status} <> 'draft'`))
        .groupBy(voucherLines.glAccountId);
      const differences = written.filter((row) => row.net !== (expected.get(row.glAccountId) ?? 0));
      if (differences.length || written.length !== expected.size) {
        throw new Error(`Opening balances do not match the old books on ${differences.length} account(s)`);
      }

      await context.ids.set('opening-balance', cutOver, id);
      report.written += 1;
      report.notes.push(
        `Voucher ${number} dated ${on}: ${opening.lines.length} lines, ${expected.size} accounts, debits = credits = ${opening.total.toFixed(2)}`,
      );
      if (opening.adjusted)
        report.notes.push(`Old rounding of ${opening.adjusted.toFixed(2)} put on the largest line of the short side`);
      if (looseSubLedgers)
        report.notes.push(`${looseSubLedgers} balance(s) on sub-ledgers not brought over kept on their account only`);
      report.notes.push('Checked: every account balance here equals the old books on that day');
    },
  };
}

export function accountLoaders(db: DbContext): Loader[] {
  return [
    accountNaturesLoader(db),
    accountCategoriesLoader(db),
    accountSubCategoriesLoader(db),
    accountLevel4HeadsLoader(db),
    accountLevel5HeadsLoader(db),
    coaDescriptionsLoader(db),
    glAccountsLoader(db),
    costCentersLoader(db),
    bankAccountsLoader(db),
    subLedgerTypesLoader(db),
    subLedgersLoader(db),
    journalTypesLoader(db),
    fiscalYearsLoader(db),
    openingBalancesLoader(db),
  ];
}
