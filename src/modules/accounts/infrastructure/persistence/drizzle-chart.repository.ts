import { Injectable } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ChartReadRepository, type ChartOfAccounts } from '../../application/chart.js';
import {
  accountCategories,
  accountLevel4Heads,
  accountLevel5Heads,
  accountNatures,
  accountSubCategories,
  glAccounts,
} from './accounts.schema.js';

/** Groups rows by a parent id, keeping their order. */
function byParent<T>(rows: T[], parent: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(parent(row), [...(groups.get(parent(row)) ?? []), row]);
  return groups;
}

@Injectable()
export class DrizzleChartReadRepository extends ChartReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async chart(): Promise<ChartOfAccounts> {
    const db = this.context.db;
    const [natures, categories, subCategories, level4, level5, accounts] = await Promise.all([
      db.select().from(accountNatures).orderBy(asc(accountNatures.code)),
      db.select().from(accountCategories).orderBy(asc(accountCategories.code)),
      db.select().from(accountSubCategories).orderBy(asc(accountSubCategories.code), asc(accountSubCategories.name)),
      db.select().from(accountLevel4Heads).orderBy(asc(accountLevel4Heads.code), asc(accountLevel4Heads.name)),
      db.select().from(accountLevel5Heads).orderBy(asc(accountLevel5Heads.code), asc(accountLevel5Heads.name)),
      db.select().from(glAccounts).orderBy(asc(glAccounts.code)),
    ]);
    const accountsBy = byParent(accounts, (row) => row.level5HeadId);
    const level5By = byParent(level5, (row) => row.level4HeadId);
    const level4By = byParent(level4, (row) => row.subCategoryId);
    const subBy = byParent(subCategories, (row) => row.categoryId);
    const categoriesBy = byParent(categories, (row) => row.natureId);
    const node = <T>(row: { id: string; code: string | null; name: string }, children: T[]) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      children,
    });
    return {
      natures: natures.map((nature) => ({
        id: nature.id,
        code: nature.code,
        name: nature.name,
        statement: nature.statement,
        normalBalance: nature.normalBalance,
        children: (categoriesBy.get(nature.id) ?? []).map((category) =>
          node(
            category,
            (subBy.get(category.id) ?? []).map((sub) =>
              node(
                sub,
                (level4By.get(sub.id) ?? []).map((head4) =>
                  node(
                    head4,
                    (level5By.get(head4.id) ?? []).map((head5) =>
                      node(
                        head5,
                        (accountsBy.get(head5.id) ?? []).map((account) => ({
                          id: account.id,
                          code: account.code,
                          name: account.name,
                          kind: account.kind,
                          isActive: account.isActive,
                        })),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      })),
    };
  }
}
