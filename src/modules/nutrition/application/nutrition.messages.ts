import { Command, Query } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import type { DietOrderRow, KitchenState, MealServiceRow } from '../domain/diet.js';

/** Seeing meals, diets, patients' diet orders and the kitchen's lists. */
export const DIET_READ = 'diet:read';
/** The dietitian: meal types, which meals each bed category gets, diet plans and their menus. */
export const DIET_MANAGE = 'diet:manage';
/** Doctors and nurses: ordering an admitted patient's diet, nothing by mouth, stopping it. */
export const DIET_ORDER = 'diet:order';
/** The kitchen: meals served or refused. */
export const DIET_SERVE = 'diet:serve';

export const NUTRITION_RECORDS = { mealType: 'nutrition_meal_type', dietPlan: 'nutrition_diet_plan' } as const;

/** The organisation's time zone, for meal times. */
export const NUTRITION_SETTINGS = Symbol('NUTRITION_SETTINGS');
export interface NutritionSettings {
  readonly timeZone: string;
}

export interface DietOrderView extends DietOrderRow {
  readonly planName: string | null;
  readonly orderedByName: string;
}

export interface KitchenRow {
  readonly admissionId: string;
  readonly admissionNumber: string;
  readonly patientName: string;
  readonly uhid: number;
  readonly wardName: string;
  readonly bedCode: string;
  readonly bedCategoryName: string;
  readonly planId: string | null;
  readonly planName: string | null;
  readonly menu: string | null;
  readonly remarks: string | null;
  readonly state: KitchenState;
  readonly service: MealServiceRow | null;
}

export interface KitchenList {
  readonly day: string;
  readonly mealType: { readonly id: string; readonly name: string; readonly servedAt: string };
  readonly rows: KitchenRow[];
  /** Plates per diet. */
  readonly totals: { readonly planName: string; readonly count: number }[];
}

export abstract class NutritionReadRepository {
  /** Bed category → the meals it gets. */
  abstract categoryMeals(): Promise<Map<string, string[]>>;
  abstract menus(planId: string): Promise<{ mealTypeId: string; menu: string }[]>;
  /** Menus of the plans for one meal. */
  abstract menusOfMeal(mealTypeId: string): Promise<Map<string, string>>;
  /** The admission's diet orders, newest first. */
  abstract orders(admissionId: string): Promise<DietOrderRow[]>;
  /** All diet orders of these admissions, newest first. */
  abstract ordersOf(admissionIds: readonly string[]): Promise<DietOrderRow[]>;
  abstract services(day: string, mealTypeId: string): Promise<MealServiceRow[]>;
}

export class SetCategoryMealsCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly bedCategoryId: string,
    readonly mealTypeIds: readonly string[],
  ) {
    super();
  }
}

export class SetMenusCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly planId: string,
    readonly menus: readonly { mealTypeId: string; menu: string }[],
  ) {
    super();
  }
}

export interface DietOrderInput {
  readonly planId: string | null;
  readonly nilByMouth: boolean;
  readonly remarks: string | null;
  /** Now when not given. */
  readonly fromAt: Date | null;
}

export class OrderDietCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
    readonly input: DietOrderInput,
  ) {
    super();
  }
}

export class StopDietCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}

export interface ServiceInput {
  readonly admissionId: string;
  readonly mealTypeId: string;
  readonly day: string;
  readonly status: 'served' | 'refused';
  readonly note: string | null;
}

export class RecordMealCommand extends Command<{ id: string }> {
  constructor(
    readonly actor: Actor,
    readonly input: ServiceInput,
  ) {
    super();
  }
}

export class CategoryMealsQuery extends Query<{ bedCategoryId: string; name: string; mealTypeIds: string[] }[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class MenusQuery extends Query<{ mealTypeId: string; menu: string }[]> {
  constructor(
    readonly actor: Actor,
    readonly planId: string,
  ) {
    super();
  }
}

export class DietOrdersQuery extends Query<DietOrderView[]> {
  constructor(
    readonly actor: Actor,
    readonly admissionId: string,
  ) {
    super();
  }
}

export class KitchenListQuery extends Query<KitchenList> {
  constructor(
    readonly actor: Actor,
    readonly day: string,
    readonly mealTypeId: string,
  ) {
    super();
  }
}
