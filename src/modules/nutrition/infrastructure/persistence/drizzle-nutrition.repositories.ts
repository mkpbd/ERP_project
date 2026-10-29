import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import { ConflictError } from '../../../../shared/domain/errors.js';
import { uniqueViolationConstraint } from '../../../../shared/infrastructure/persistence/pg-errors.js';
import { NutritionReadRepository } from '../../application/nutrition.messages.js';
import type { DietOrderRow, DietPlan, MealServiceRow, MealType } from '../../domain/diet.js';
import { NutritionRepository } from '../../domain/repositories.js';
import { categoryMeals, dietOrders, dietPlans, mealServices, mealTypes, planMenus } from './nutrition.schema.js';

@Injectable()
export class DrizzleNutritionRepository extends NutritionRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  mealTypes(): Promise<MealType[]> {
    return this.context.db
      .select({ id: mealTypes.id, name: mealTypes.name, servedAt: mealTypes.servedAt, isActive: mealTypes.isActive })
      .from(mealTypes)
      .orderBy(asc(mealTypes.servedAt));
  }

  async plans(ids: readonly string[]): Promise<Map<string, DietPlan>> {
    if (ids.length === 0) return new Map();
    const rows = await this.context.db
      .select({ id: dietPlans.id, name: dietPlans.name, isActive: dietPlans.isActive })
      .from(dietPlans)
      .where(inArray(dietPlans.id, [...new Set(ids)]));
    return new Map(rows.map((row) => [row.id, row]));
  }

  async setCategoryMeals(bedCategoryId: string, mealTypeIds: readonly string[]): Promise<void> {
    await this.context.db.delete(categoryMeals).where(eq(categoryMeals.bedCategoryId, bedCategoryId));
    if (mealTypeIds.length) {
      await this.context.db
        .insert(categoryMeals)
        .values(mealTypeIds.map((mealTypeId) => ({ bedCategoryId, mealTypeId })));
    }
  }

  async setMenus(planId: string, menus: readonly { mealTypeId: string; menu: string }[]): Promise<void> {
    await this.context.db.delete(planMenus).where(eq(planMenus.planId, planId));
    if (menus.length) await this.context.db.insert(planMenus).values(menus.map((entry) => ({ ...entry, planId })));
  }

  async currentOrderForUpdate(admissionId: string): Promise<DietOrderRow | null> {
    const [row] = await this.context.db
      .select()
      .from(dietOrders)
      .where(and(eq(dietOrders.admissionId, admissionId), isNull(dietOrders.toAt)))
      .for('update');
    return row ?? null;
  }

  async endOrder(id: string, at: Date, by: string): Promise<void> {
    await this.context.db.update(dietOrders).set({ toAt: at, endedBy: by }).where(eq(dietOrders.id, id));
  }

  async insertOrder(order: DietOrderRow): Promise<void> {
    await this.context.db.insert(dietOrders).values(order);
  }

  async insertService(service: MealServiceRow): Promise<void> {
    try {
      await this.context.db.insert(mealServices).values(service);
    } catch (error) {
      if (uniqueViolationConstraint(error) === 'nutrition_meal_services_uq') {
        throw new ConflictError('meal_recorded', 'This meal is recorded for the patient already');
      }
      throw error;
    }
  }
}

@Injectable()
export class DrizzleNutritionReadRepository extends NutritionReadRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  async categoryMeals(): Promise<Map<string, string[]>> {
    const rows = await this.context.db.select().from(categoryMeals);
    const map = new Map<string, string[]>();
    for (const row of rows) map.set(row.bedCategoryId, [...(map.get(row.bedCategoryId) ?? []), row.mealTypeId]);
    return map;
  }

  menus(planId: string): Promise<{ mealTypeId: string; menu: string }[]> {
    return this.context.db
      .select({ mealTypeId: planMenus.mealTypeId, menu: planMenus.menu })
      .from(planMenus)
      .innerJoin(mealTypes, eq(mealTypes.id, planMenus.mealTypeId))
      .where(eq(planMenus.planId, planId))
      .orderBy(asc(mealTypes.servedAt));
  }

  async menusOfMeal(mealTypeId: string): Promise<Map<string, string>> {
    const rows = await this.context.db
      .select({ planId: planMenus.planId, menu: planMenus.menu })
      .from(planMenus)
      .where(eq(planMenus.mealTypeId, mealTypeId));
    return new Map(rows.map((row) => [row.planId, row.menu]));
  }

  orders(admissionId: string): Promise<DietOrderRow[]> {
    return this.context.db
      .select()
      .from(dietOrders)
      .where(eq(dietOrders.admissionId, admissionId))
      .orderBy(desc(dietOrders.fromAt), desc(dietOrders.createdAt));
  }

  async ordersOf(admissionIds: readonly string[]): Promise<DietOrderRow[]> {
    if (admissionIds.length === 0) return [];
    return this.context.db
      .select()
      .from(dietOrders)
      .where(inArray(dietOrders.admissionId, [...admissionIds]))
      .orderBy(desc(dietOrders.fromAt), desc(dietOrders.createdAt));
  }

  services(day: string, mealTypeId: string): Promise<MealServiceRow[]> {
    return this.context.db
      .select()
      .from(mealServices)
      .where(and(eq(mealServices.serviceDay, day), eq(mealServices.mealTypeId, mealTypeId)));
  }
}
