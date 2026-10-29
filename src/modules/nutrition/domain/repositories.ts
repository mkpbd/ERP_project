import type { DietOrderRow, DietPlan, MealServiceRow, MealType } from './diet.js';

export abstract class NutritionRepository {
  abstract mealTypes(): Promise<MealType[]>;
  abstract plans(ids: readonly string[]): Promise<Map<string, DietPlan>>;
  /** Replaces the meals the bed category gets. */
  abstract setCategoryMeals(bedCategoryId: string, mealTypeIds: readonly string[]): Promise<void>;
  /** Replaces the plan's menus. */
  abstract setMenus(planId: string, menus: readonly { mealTypeId: string; menu: string }[]): Promise<void>;
  /** The admission's diet order not ended, locked. */
  abstract currentOrderForUpdate(admissionId: string): Promise<DietOrderRow | null>;
  abstract endOrder(id: string, at: Date, by: string): Promise<void>;
  abstract insertOrder(order: DietOrderRow): Promise<void>;
  /** A meal served or refused; the same meal twice is a conflict. */
  abstract insertService(service: MealServiceRow): Promise<void>;
}
