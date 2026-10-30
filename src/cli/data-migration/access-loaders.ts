import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DbContext } from '../../database/drizzle-transaction-manager.js';
import { corporateClients } from '../../modules/hospital/infrastructure/persistence/hospital.schema.js';
import { outletUsers } from '../../modules/pharmacy/infrastructure/persistence/pharmacy.schema.js';
import {
  departmentStoreAccess,
  departmentUsers,
  issueStoreUsers,
} from '../../modules/supply-chain/infrastructure/persistence/supply-chain.schema.js';
import { noteRejection, type EtlContext, type Loader, type LoaderReport } from './etl.js';
import { NIL } from './loader-kit.js';

/** What a row of an old access list names: the old ids of its parts, by the kind of record each is. */
type Parts = Record<string, string>;

/**
 * Brings an old access list over: each row's parts are looked up by kind; a row whose parts all came over is written
 * (once: an existing grant is kept), else rejected with the first part missing.
 */
async function grant(
  context: EtlContext,
  report: LoaderReport,
  rows: readonly { id: string; parts: Parts }[],
  write: (ids: Record<string, string>) => Promise<boolean>,
): Promise<void> {
  for (const row of rows) {
    report.read += 1;
    const ids: Record<string, string> = {};
    let missing: string | null = null;
    for (const [kind, oldId] of Object.entries(row.parts)) {
      const id = oldId && oldId !== NIL ? await context.ids.get(kind, oldId) : null;
      if (!id) {
        missing = kind;
        break;
      }
      ids[kind] = id;
    }
    if (missing) {
      noteRejection(report, row.id, `${missing.replace(/-/g, '_')}_not_brought`);
      continue;
    }
    if (await write(ids)) report.written += 1;
    else report.kept += 1;
  }
}

/** Old Pharmacy.PharmacistDutyOutlets → who sells from and receives into each outlet. */
export function pharmacistOutletsLoader(db: DbContext): Loader {
  return {
    name: 'pharmacist-outlets',
    dependsOn: ['users', 'outlets'],
    async run(context, report) {
      const rows = await context.source.query<{ Id: string; UserId: string; OutletId: string }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([UserId] AS nvarchar(36)) AS [UserId],
          CAST([OutletId] AS nvarchar(36)) AS [OutletId] FROM [Pharmacy].[PharmacistDutyOutlets] WHERE [IsDeleted] = 0`,
      );
      await grant(
        context,
        report,
        rows.map((row) => ({ id: row.Id, parts: { user: row.UserId, outlet: row.OutletId } })),
        async (ids) =>
          (
            await db.db
              .insert(outletUsers)
              .values({ id: randomUUID(), outletId: ids['outlet']!, userId: ids['user']! })
              .onConflictDoNothing()
              .returning({ id: outletUsers.id })
          ).length > 0,
      );
    },
  };
}

/** Old SupplyChain.StoreDeptUserAccesses (a comma-separated list of departments per user) → who indents for which. */
export function storeDepartmentUsersLoader(db: DbContext): Loader {
  return {
    name: 'store-department-users',
    dependsOn: ['users', 'store-departments'],
    async run(context, report) {
      const rows = await context.source.query<{ Id: string; UserId: string; StoreDeptIds: string | null }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([UserId] AS nvarchar(36)) AS [UserId], [StoreDeptIds]
          FROM [SupplyChain].[StoreDeptUserAccesses] WHERE [IsDeleted] = 0`,
      );
      await grant(
        context,
        report,
        rows.flatMap((row) =>
          (row.StoreDeptIds ?? '')
            .split(/[,;\s]+/)
            .filter(Boolean)
            .map((department) => ({
              id: `${row.Id}/${department}`,
              parts: { user: row.UserId, 'store-department': department },
            })),
        ),
        async (ids) =>
          (
            await db.db
              .insert(departmentUsers)
              .values({ id: randomUUID(), departmentId: ids['store-department']!, userId: ids['user']! })
              .onConflictDoNothing()
              .returning({ id: departmentUsers.id })
          ).length > 0,
      );
    },
  };
}

/** Old SupplyChain.DeptStoreAcesses → which sub-store a user indents from for a department. */
export function departmentStoreAccessLoader(db: DbContext): Loader {
  return {
    name: 'department-store-access',
    dependsOn: ['users', 'store-departments', 'sub-stores'],
    async run(context, report) {
      const rows = await context.source.query<{ Id: string; DeptId: string; UserId: string; StoreId: string }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([DeptId] AS nvarchar(36)) AS [DeptId],
          CAST([UserId] AS nvarchar(36)) AS [UserId], CAST([StoreId] AS nvarchar(36)) AS [StoreId]
          FROM [SupplyChain].[DeptStoreAcesses] WHERE [IsDeleted] = 0`,
      );
      await grant(
        context,
        report,
        rows.map((row) => ({
          id: row.Id,
          parts: { user: row.UserId, 'store-department': row.DeptId, 'sub-store': row.StoreId },
        })),
        async (ids) =>
          (
            await db.db
              .insert(departmentStoreAccess)
              .values({
                id: randomUUID(),
                departmentId: ids['store-department']!,
                subStoreId: ids['sub-store']!,
                userId: ids['user']!,
              })
              .onConflictDoNothing()
              .returning({ id: departmentStoreAccess.id })
          ).length > 0,
      );
    },
  };
}

/** Old SupplyChain.IssueStoreAcesses → who issues from each sub-store. */
export function issueStoreUsersLoader(db: DbContext): Loader {
  return {
    name: 'issue-store-users',
    dependsOn: ['users', 'sub-stores'],
    async run(context, report) {
      const rows = await context.source.query<{ Id: string; UserId: string; StoreId: string }>(
        `SELECT CAST([Id] AS nvarchar(36)) AS [Id], CAST([UserId] AS nvarchar(36)) AS [UserId],
          CAST([StoreId] AS nvarchar(36)) AS [StoreId] FROM [SupplyChain].[IssueStoreAcesses] WHERE [IsDeleted] = 0`,
      );
      await grant(
        context,
        report,
        rows.map((row) => ({ id: row.Id, parts: { user: row.UserId, 'sub-store': row.StoreId } })),
        async (ids) =>
          (
            await db.db
              .insert(issueStoreUsers)
              .values({ id: randomUUID(), subStoreId: ids['sub-store']!, userId: ids['user']! })
              .onConflictDoNothing()
              .returning({ id: issueStoreUsers.id })
          ).length > 0,
      );
    },
  };
}

/**
 * Old corporate discounts were per test (Diag.DiscountGroups and their details, by percent or by amount); here a
 * client has one discount on its people's bills. A client whose group gives every test the same percent gets it;
 * any other (several percents, amounts) keeps none and is listed to set by hand. A discount set here is not changed.
 */
export function corporateDiscountsLoader(db: DbContext): Loader {
  return {
    name: 'corporate-discounts',
    dependsOn: ['corporate-clients'],
    async run(context, report) {
      const rows = await context.source.query<{
        ClientId: string;
        Name: string | null;
        Percent: number | null;
        Gross: number | null;
      }>(
        `SELECT CAST(c.[Id] AS nvarchar(36)) AS [ClientId], c.[Name], d.[DiscountInPercent] AS [Percent],
          d.[DiscountInGross] AS [Gross]
          FROM [Marketing].[CorporateClients] c
          JOIN [Diag].[DiscountGroupDetails] d ON d.[DiscountGroupId] = c.[DiscountGroupId] AND d.[IsDeleted] = 0
          WHERE c.[IsDeleted] = 0 AND c.[DiscountGroupId] <> @nil`,
        { nil: NIL },
      );
      const byClient = new Map<string, typeof rows>();
      for (const row of rows)
        byClient.set(row.ClientId.toLowerCase(), [...(byClient.get(row.ClientId.toLowerCase()) ?? []), row]);
      for (const [oldId, lines] of byClient) {
        report.read += 1;
        if (await context.ids.has('corporate-discount', oldId)) {
          report.kept += 1;
          continue;
        }
        const clientId = await context.ids.get('corporate-client', oldId);
        if (!clientId) {
          noteRejection(report, oldId, 'client_not_brought');
          continue;
        }
        const percents = [...new Set(lines.map((line) => Math.round(Number(line.Percent ?? 0) * 100) / 100))];
        const byAmount = lines.some((line) => Number(line.Gross ?? 0) > 0);
        const name = lines[0]!.Name ?? oldId;
        if (byAmount || percents.length !== 1 || percents[0]! <= 0 || percents[0]! > 100) {
          report.notes.push(
            `${name}: ${byAmount ? 'discounts by amount' : `${percents.length} different percents (${percents.slice(0, 5).join(', ')})`} per test in the old system; set its discount by hand`,
          );
          continue;
        }
        const updated = await db.db
          .update(corporateClients)
          .set({ discountPercent: percents[0]! })
          .where(and(eq(corporateClients.id, clientId), eq(corporateClients.discountPercent, 0)))
          .returning({ id: corporateClients.id });
        await context.ids.set('corporate-discount', oldId, clientId);
        if (updated.length) {
          report.written += 1;
          report.notes.push(`${name}: ${percents[0]}% on its people's bills`);
        } else {
          report.kept += 1;
        }
      }
    },
  };
}

export function accessLoaders(db: DbContext): Loader[] {
  return [
    pharmacistOutletsLoader(db),
    storeDepartmentUsersLoader(db),
    departmentStoreAccessLoader(db),
    issueStoreUsersLoader(db),
    corporateDiscountsLoader(db),
  ];
}
