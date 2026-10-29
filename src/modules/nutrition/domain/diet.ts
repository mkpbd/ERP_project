import { ConflictError, DomainError } from '../../../shared/domain/errors.js';

export interface MealType {
  readonly id: string;
  readonly name: string;
  readonly servedAt: string;
  readonly isActive: boolean;
}

export interface DietPlan {
  readonly id: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface DietOrderRow {
  readonly id: string;
  readonly admissionId: string;
  readonly patientId: string;
  readonly planId: string | null;
  readonly nilByMouth: boolean;
  readonly remarks: string | null;
  readonly fromAt: Date;
  readonly toAt: Date | null;
  readonly orderedBy: string;
  readonly endedBy: string | null;
  readonly createdAt: Date;
}

export interface MealServiceRow {
  readonly id: string;
  readonly admissionId: string;
  readonly dietOrderId: string;
  readonly mealTypeId: string;
  readonly serviceDay: string;
  readonly status: 'served' | 'refused';
  readonly note: string | null;
  readonly servedBy: string;
  readonly servedAt: Date;
}

/** What the kitchen does for a patient at a meal. */
export type KitchenState = 'to_serve' | 'served' | 'refused' | 'nil_by_mouth' | 'no_order';

export function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

/** Old FoodPattern per meal type: one menu per meal, as written. */
export function checkedMenus(menus: readonly { mealTypeId: string; menu: string }[]) {
  const seen = new Set<string>();
  return menus.map((entry) => {
    if (seen.has(entry.mealTypeId)) throw new DomainError('duplicate_meal', 'Give each meal one menu');
    seen.add(entry.mealTypeId);
    const menu = text(entry.menu, 1000, 'menu');
    if (!menu) throw new DomainError('invalid_text', 'Give the menu');
    return { mealTypeId: entry.mealTypeId, menu };
  });
}

/** The diet order in force at a moment, of an admission's orders. */
export function inForce(orders: readonly DietOrderRow[], at: Date): DietOrderRow | null {
  return (
    orders.find(
      (order) => order.fromAt.getTime() <= at.getTime() && (order.toAt === null || at.getTime() < order.toAt.getTime()),
    ) ?? null
  );
}

/**
 * A new diet for the admission: a plan, or nothing by mouth (never both). It starts when the one in force ends; it
 * never starts before it.
 */
export function assertNewOrder(
  input: { planId: string | null; nilByMouth: boolean; fromAt: Date },
  current: DietOrderRow | null,
) {
  if (input.nilByMouth === (input.planId !== null)) {
    throw new DomainError('invalid_diet', 'Order a diet plan, or nothing by mouth');
  }
  if (current && input.fromAt.getTime() < current.fromAt.getTime()) {
    throw new ConflictError('diet_overlap', 'The new diet starts before the one in force');
  }
}

/** The kitchen's state for a patient at a meal. */
export function kitchenState(order: DietOrderRow | null, service: MealServiceRow | null): KitchenState {
  if (service) return service.status;
  if (!order) return 'no_order';
  return order.nilByMouth ? 'nil_by_mouth' : 'to_serve';
}
