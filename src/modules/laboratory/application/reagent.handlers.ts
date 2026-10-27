import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { DepartmentStock } from '../../../shared/application/contracts/department-stock.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { ReagentRepository } from '../domain/repositories.js';
import { LabDesk } from './lab.handlers.js';
import { LAB_MANAGE, LAB_READ } from './lab.messages.js';

export const MAX_REAGENTS = 30;

export class SetTestReagentsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
    readonly lines: readonly { readonly variantId: string; readonly qty: number }[],
  ) {
    super();
  }
}

export class GetTestReagentsQuery extends Query<
  { variantId: string; name: string | null; unit: string | null; qty: number }[]
> {
  constructor(
    readonly actor: Actor,
    readonly testId: string,
  ) {
    super();
  }
}

export class SetStockDepartmentsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly pairs: readonly { readonly diagnosticDepartmentId: string; readonly storeDepartmentId: string }[],
  ) {
    super();
  }
}

export class GetStockDepartmentsQuery extends Query<
  {
    diagnosticDepartmentId: string;
    diagnosticDepartmentName: string | null;
    storeDepartmentId: string;
    storeDepartmentName: string | null;
  }[]
> {
  constructor(readonly actor: Actor) {
    super();
  }
}

/** Old ReAgentManagement setup (TestAndRegAgentMappings) and XrayFilmTestMappings: each test's reagents and films. */
@Injectable()
export class ReagentDesk {
  constructor(
    readonly lab: LabDesk,
    readonly reagents: ReagentRepository,
    readonly stock: DepartmentStock,
  ) {}
}

@CommandHandler(SetTestReagentsCommand)
export class SetTestReagentsHandler implements ICommandHandler<SetTestReagentsCommand> {
  constructor(private readonly desk: ReagentDesk) {}

  async execute({ actor, testId, lines }: SetTestReagentsCommand): Promise<void> {
    const { lab, reagents, stock } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_MANAGE] });
    if (lines.length > MAX_REAGENTS)
      throw new DomainError('invalid_lines', `A test uses at most ${MAX_REAGENTS} items`);
    if (new Set(lines.map((line) => line.variantId)).size !== lines.length) {
      throw new DomainError('duplicate_line', 'An item is listed twice');
    }
    for (const line of lines) {
      if (!(line.qty > 0)) throw new DomainError('invalid_quantity', 'A quantity is more than nothing');
    }
    const test = (await lab.orders.tests([testId])).get(testId);
    if (!test) throw new NotFoundError('diagnostic_test');
    const found = await stock.items(lines.map((line) => line.variantId));
    for (const line of lines) {
      const item = found.get(line.variantId);
      if (!item) throw new NotFoundError('item');
      if (!item.isActive) throw new DomainError('inactive_item', `${item.name} is not in use`);
      if (item.isAsset) throw new DomainError('asset_item', `${item.name} is a fixed asset, not used up`);
    }
    await lab.tx.run(async () => {
      await reagents.setRecipe(testId, lines);
      await lab.record('test_reagents', 'set', actor, testId, { items: lines.length });
    });
  }
}

@QueryHandler(GetTestReagentsQuery)
export class GetTestReagentsHandler implements IQueryHandler<GetTestReagentsQuery> {
  constructor(private readonly desk: ReagentDesk) {}

  async execute({ actor, testId }: GetTestReagentsQuery) {
    const { lab, reagents, stock } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const recipe = await reagents.recipe(testId);
    const items = await stock.items(recipe.map((line) => line.variantId));
    return recipe.map((line) => ({
      ...line,
      name: items.get(line.variantId)?.name ?? null,
      unit: items.get(line.variantId)?.unit ?? null,
    }));
  }
}

/** The whole list: which store department each diagnostic department's tests use up stock from. */
@CommandHandler(SetStockDepartmentsCommand)
export class SetStockDepartmentsHandler implements ICommandHandler<SetStockDepartmentsCommand> {
  constructor(private readonly desk: ReagentDesk) {}

  async execute({ actor, pairs }: SetStockDepartmentsCommand): Promise<void> {
    const { lab, reagents, stock } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_MANAGE] });
    if (new Set(pairs.map((pair) => pair.diagnosticDepartmentId)).size !== pairs.length) {
      throw new DomainError('duplicate_line', 'A diagnostic department is listed twice');
    }
    const diagnostic = await lab.orders.departments(pairs.map((pair) => pair.diagnosticDepartmentId));
    const stores = await stock.departments(pairs.map((pair) => pair.storeDepartmentId));
    for (const pair of pairs) {
      if (!diagnostic.has(pair.diagnosticDepartmentId)) throw new NotFoundError('diagnostic_department');
      if (!stores.has(pair.storeDepartmentId)) throw new NotFoundError('store_department');
    }
    await lab.tx.run(async () => {
      await reagents.setStockDepartments(pairs);
      await lab.record('stock_departments', 'set', actor, randomUUID(), { pairs: pairs.length });
    });
  }
}

@QueryHandler(GetStockDepartmentsQuery)
export class GetStockDepartmentsHandler implements IQueryHandler<GetStockDepartmentsQuery> {
  constructor(private readonly desk: ReagentDesk) {}

  async execute({ actor }: GetStockDepartmentsQuery) {
    const { lab, reagents, stock } = this.desk;
    await lab.access.authorize(actor.userId, { permissions: [LAB_READ] });
    const pairs = await reagents.stockDepartments();
    const diagnostic = await lab.orders.departments(pairs.map((pair) => pair.diagnosticDepartmentId));
    const stores = await stock.departments(pairs.map((pair) => pair.storeDepartmentId));
    return pairs.map((pair) => ({
      ...pair,
      diagnosticDepartmentName: diagnostic.get(pair.diagnosticDepartmentId)?.name ?? null,
      storeDepartmentName: stores.get(pair.storeDepartmentId)?.name ?? null,
    }));
  }
}

export const REAGENT_HANDLERS = [
  ReagentDesk,
  SetTestReagentsHandler,
  GetTestReagentsHandler,
  SetStockDepartmentsHandler,
  GetStockDepartmentsHandler,
];
