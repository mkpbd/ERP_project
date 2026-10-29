import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { CommandHandler, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import {
  InpatientRegister,
  type ChargeableAdmission,
} from '../../../shared/application/contracts/inpatient-register.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { AuditTrail } from '../../../shared/application/ports/audit-trail.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { zonedInstant } from '../../../shared/domain/zoned-time.js';
import {
  assertNewOrder,
  checkedMenus,
  inForce,
  kitchenState,
  text,
  type DietOrderRow,
  type MealType,
} from '../domain/diet.js';
import { NutritionRepository } from '../domain/repositories.js';
import {
  CategoryMealsQuery,
  DIET_MANAGE,
  DIET_ORDER,
  DIET_READ,
  DIET_SERVE,
  DietOrdersQuery,
  KitchenListQuery,
  MenusQuery,
  NUTRITION_SETTINGS,
  NutritionReadRepository,
  OrderDietCommand,
  RecordMealCommand,
  SetCategoryMealsCommand,
  SetMenusCommand,
  StopDietCommand,
  type KitchenList,
  type NutritionSettings,
} from './nutrition.messages.js';

const HOUR = 3_600_000;
/** A meal is served (or refused) from this many hours before its time. */
const EARLY_HOURS = 2;
/** A diet may be ordered to start this many days ahead. */
const AHEAD_DAYS = 2;

@Injectable()
export class Kitchen {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly audit: AuditTrail,
    readonly clock: Clock,
    readonly nutrition: NutritionRepository,
    readonly read: NutritionReadRepository,
    readonly inpatients: InpatientRegister,
    readonly users: UserDirectory,
    @Inject(NUTRITION_SETTINGS) readonly settings: NutritionSettings,
  ) {}

  dayOf(at: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.settings.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(at);
  }

  /** When the meal goes out on that day. */
  mealAt(day: string, meal: MealType): Date {
    return zonedInstant(day, meal.servedAt, this.settings.timeZone);
  }

  async meal(id: string): Promise<MealType> {
    const meal = (await this.nutrition.mealTypes()).find((entry) => entry.id === id);
    if (!meal) throw new NotFoundError('meal_type');
    return meal;
  }

  async admitted(admissionId: string): Promise<ChargeableAdmission> {
    const [admission] = await this.inpatients.find([admissionId]);
    if (!admission) throw new NotFoundError('admission');
    if (admission.status !== 'admitted') {
      throw new DomainError('admission_state', `Admission ${admission.number} is ${admission.status}`);
    }
    return admission;
  }
}

/** Old CabinTypeAndMealMapping: the meals a bed category gets (the whole list). */
@CommandHandler(SetCategoryMealsCommand)
export class SetCategoryMealsHandler implements ICommandHandler<SetCategoryMealsCommand> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, bedCategoryId, mealTypeIds }: SetCategoryMealsCommand): Promise<void> {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_MANAGE] });
    if (!(await kitchen.inpatients.bedCategories()).some((entry) => entry.id === bedCategoryId)) {
      throw new NotFoundError('bed_category');
    }
    const meals = new Set((await kitchen.nutrition.mealTypes()).map((meal) => meal.id));
    if (mealTypeIds.some((id) => !meals.has(id))) throw new NotFoundError('meal_type');
    await kitchen.tx.run(() => kitchen.nutrition.setCategoryMeals(bedCategoryId, [...new Set(mealTypeIds)]));
  }
}

/** Old FoodPattern / FoodPatternDetail: the plan's menu for each meal (the whole list). */
@CommandHandler(SetMenusCommand)
export class SetMenusHandler implements ICommandHandler<SetMenusCommand> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, planId, menus }: SetMenusCommand): Promise<void> {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_MANAGE] });
    if (!(await kitchen.nutrition.plans([planId])).has(planId)) throw new NotFoundError('diet_plan');
    const checked = checkedMenus(menus);
    const meals = new Set((await kitchen.nutrition.mealTypes()).map((meal) => meal.id));
    if (checked.some((entry) => !meals.has(entry.mealTypeId))) throw new NotFoundError('meal_type');
    await kitchen.tx.run(() => kitchen.nutrition.setMenus(planId, checked));
  }
}

/**
 * Old IPDFoodIndent: an admitted patient's diet (a plan, or nothing by mouth) with remarks for the kitchen. It ends the
 * diet in force when it starts.
 */
@CommandHandler(OrderDietCommand)
export class OrderDietHandler implements ICommandHandler<OrderDietCommand> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, admissionId, input }: OrderDietCommand) {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_ORDER] });
    const admission = await kitchen.admitted(admissionId);
    if (input.planId) {
      const plan = (await kitchen.nutrition.plans([input.planId])).get(input.planId);
      if (!plan) throw new NotFoundError('diet_plan');
      if (!plan.isActive) throw new DomainError('plan_inactive', `${plan.name} is not served`);
    }
    const now = kitchen.clock.now();
    const fromAt = input.fromAt ?? now;
    if (fromAt.getTime() > now.getTime() + AHEAD_DAYS * 24 * HOUR) {
      throw new DomainError('invalid_time', `A diet starts within ${AHEAD_DAYS} days`);
    }
    if (kitchen.dayOf(fromAt) < admission.admittedOn) {
      throw new DomainError('invalid_time', 'A diet does not start before the admission');
    }
    const remarks = text(input.remarks, 500, 'remarks');
    return kitchen.tx.run(async () => {
      const current = await kitchen.nutrition.currentOrderForUpdate(admissionId);
      assertNewOrder({ ...input, fromAt }, current);
      if (current) await kitchen.nutrition.endOrder(current.id, fromAt, actor.userId);
      const order: DietOrderRow = {
        id: randomUUID(),
        admissionId,
        patientId: admission.patientId,
        planId: input.planId,
        nilByMouth: input.nilByMouth,
        remarks,
        fromAt,
        toAt: null,
        orderedBy: actor.userId,
        endedBy: null,
        createdAt: now,
      };
      await kitchen.nutrition.insertOrder(order);
      return { id: order.id };
    });
  }
}

/** Old StoppedDate: no diet from now (the patient leaves, or eats from home). */
@CommandHandler(StopDietCommand)
export class StopDietHandler implements ICommandHandler<StopDietCommand> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, admissionId }: StopDietCommand): Promise<void> {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_ORDER] });
    await kitchen.tx.run(async () => {
      const current = await kitchen.nutrition.currentOrderForUpdate(admissionId);
      if (!current) throw new DomainError('no_diet', 'No diet is ordered');
      const now = kitchen.clock.now();
      await kitchen.nutrition.endOrder(current.id, current.fromAt > now ? current.fromAt : now, actor.userId);
    });
  }
}

/**
 * Old FoodDeliverable: a meal taken to the patient, or refused, once per meal and day, from two hours before its time;
 * only for a diet in force at the meal (not nothing by mouth) and a meal the bed category gets.
 */
@CommandHandler(RecordMealCommand)
export class RecordMealHandler implements ICommandHandler<RecordMealCommand> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, input }: RecordMealCommand) {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_SERVE] });
    const meal = await kitchen.meal(input.mealTypeId);
    const patient = (await kitchen.inpatients.inpatients()).find((entry) => entry.id === input.admissionId);
    if (!patient) throw new DomainError('admission_state', 'The patient is not admitted');
    const gets = (await kitchen.read.categoryMeals()).get(patient.bedCategoryId) ?? [];
    if (!gets.includes(meal.id)) {
      throw new DomainError('meal_not_given', `${patient.bedCategoryName} beds do not get ${meal.name}`);
    }
    const now = kitchen.clock.now();
    const at = kitchen.mealAt(input.day, meal);
    if (at.getTime() - EARLY_HOURS * HOUR > now.getTime()) {
      throw new DomainError('not_yet', `${meal.name} of ${input.day} is not served yet`);
    }
    const order = inForce(await kitchen.read.orders(input.admissionId), at);
    if (!order || order.nilByMouth) {
      throw new DomainError('nothing_to_serve', order ? 'The patient is nothing by mouth' : 'No diet is ordered');
    }
    const id = randomUUID();
    await kitchen.nutrition.insertService({
      id,
      admissionId: input.admissionId,
      dietOrderId: order.id,
      mealTypeId: meal.id,
      serviceDay: input.day,
      status: input.status,
      note: text(input.note, 300, 'note'),
      servedBy: actor.userId,
      servedAt: now,
    });
    return { id };
  }
}

@QueryHandler(CategoryMealsQuery)
export class CategoryMealsHandler implements IQueryHandler<CategoryMealsQuery> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor }: CategoryMealsQuery) {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_READ] });
    const meals = await kitchen.read.categoryMeals();
    return (await kitchen.inpatients.bedCategories()).map((category) => ({
      bedCategoryId: category.id,
      name: category.name,
      mealTypeIds: meals.get(category.id) ?? [],
    }));
  }
}

@QueryHandler(MenusQuery)
export class MenusHandler implements IQueryHandler<MenusQuery> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, planId }: MenusQuery) {
    await this.kitchen.access.authorize(actor.userId, { permissions: [DIET_READ] });
    if (!(await this.kitchen.nutrition.plans([planId])).has(planId)) throw new NotFoundError('diet_plan');
    return this.kitchen.read.menus(planId);
  }
}

@QueryHandler(DietOrdersQuery)
export class DietOrdersHandler implements IQueryHandler<DietOrdersQuery> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, admissionId }: DietOrdersQuery) {
    const { kitchen } = this;
    await kitchen.access.authorize(actor.userId, { permissions: [DIET_READ] });
    const orders = await kitchen.read.orders(admissionId);
    const plans = await kitchen.nutrition.plans(orders.flatMap((order) => (order.planId ? [order.planId] : [])));
    const userIds = [...new Set(orders.map((order) => order.orderedBy))];
    const users = new Map((userIds.length ? await kitchen.users.findSummaries(userIds) : []).map((u) => [u.id, u]));
    return orders.map((order) => ({
      ...order,
      planName: order.planId ? (plans.get(order.planId)?.name ?? null) : null,
      orderedByName: users.get(order.orderedBy)?.displayName ?? '',
    }));
  }
}

/** The kitchen's list of a meal: every patient in a bed that gets it, with their diet, menu and what was done. */
@QueryHandler(KitchenListQuery)
export class KitchenListHandler implements IQueryHandler<KitchenListQuery> {
  constructor(private readonly kitchen: Kitchen) {}

  async execute({ actor, day, mealTypeId }: KitchenListQuery) {
    await this.kitchen.access.authorize(actor.userId, { permissions: [DIET_READ] });
    return kitchenList(this.kitchen, day, mealTypeId);
  }
}

export async function kitchenList(kitchen: Kitchen, day: string, mealTypeId: string): Promise<KitchenList> {
  const meal = await kitchen.meal(mealTypeId);
  const at = kitchen.mealAt(day, meal);
  const gets = await kitchen.read.categoryMeals();
  const patients = (await kitchen.inpatients.inpatients()).filter((entry) =>
    (gets.get(entry.bedCategoryId) ?? []).includes(meal.id),
  );
  const orders = await kitchen.read.ordersOf(patients.map((entry) => entry.id));
  const services = new Map(
    (await kitchen.read.services(day, meal.id)).map((service) => [service.admissionId, service]),
  );
  const menus = await kitchen.read.menusOfMeal(meal.id);
  const plans = await kitchen.nutrition.plans(orders.flatMap((order) => (order.planId ? [order.planId] : [])));
  const rows = patients.map((patient) => {
    const order = inForce(
      orders.filter((entry) => entry.admissionId === patient.id),
      at,
    );
    const service = services.get(patient.id) ?? null;
    const planId = order?.planId ?? null;
    return {
      admissionId: patient.id,
      admissionNumber: patient.number,
      patientName: patient.patientName,
      uhid: patient.uhid,
      wardName: patient.wardName,
      bedCode: patient.bedCode,
      bedCategoryName: patient.bedCategoryName,
      planId,
      planName: planId ? (plans.get(planId)?.name ?? null) : null,
      menu: planId ? (menus.get(planId) ?? null) : null,
      remarks: order?.remarks ?? null,
      state: kitchenState(order, service),
      service,
    };
  });
  const counts = new Map<string, number>();
  for (const row of rows)
    if (row.planName && row.state !== 'nil_by_mouth') counts.set(row.planName, (counts.get(row.planName) ?? 0) + 1);
  return {
    day,
    mealType: { id: meal.id, name: meal.name, servedAt: meal.servedAt },
    rows,
    totals: [...counts.entries()]
      .map(([planName, count]) => ({ planName, count }))
      .sort((a, b) => a.planName.localeCompare(b.planName)),
  };
}

export const NUTRITION_HANDLERS = [
  Kitchen,
  SetCategoryMealsHandler,
  SetMenusHandler,
  OrderDietHandler,
  StopDietHandler,
  RecordMealHandler,
  CategoryMealsHandler,
  MenusHandler,
  DietOrdersHandler,
  KitchenListHandler,
];
