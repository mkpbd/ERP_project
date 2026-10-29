# Step 11d — Nutrition: diets, the kitchen list, meals served

Status: **done** (2026-10-30). Previous: [step 11c](11c-treatment-orders.md) · Next: step 11e (patient portal
sign-in).

What this step adds, in a new `nutrition` module:

* **Meal types** with the time each goes out (breakfast, lunch, snacks, dinner …), and the **meals each bed
  category gets**.
* **Diet plans** (normal, diabetic, soft, liquid …) with a **menu per meal**, written as text.
* **Each admitted patient's diet.** It is a plan or **nothing by mouth**, with remarks for the kitchen (allergies,
  texture). It runs from when ordered until changed or stopped.
* **The kitchen list of a meal**, by ward and bed. For each patient it shows the diet, menu and remarks, and whether
  the meal is to serve, served, refused, nothing by mouth, or no diet ordered. Plates per diet are added up.
* **Meals served or refused**, recorded by the kitchen.

## Where the old logic lives

CoxBazar:

* **Meals and diets:**
  * `Nutrition.MealType` (Name, OrderValue);
  * `CabinTypeAndMealMapping` (cabin type → meal);
  * `FoodPatternGroup` (the diet);
  * `FoodPattern` (group + meal) with `FoodPatternDetail` (canteen `Item` and quantity).
* **Patients' diets:** `Canteen.IPDFoodIndent`. Admission, cabin, canteen outlet, food pattern group, quantity, remarks,
  `IsContinue`, `StoppedDate`.
* **Meals served:** `FoodDeliverable` (indent, meal, pattern group, status, reviewed by) with `FoodDeliverableDetail`
  (items).

## Decisions (step 11c's open questions; "next" without answers, so the recommendations)

1. **Scope:**
   * meal types;
   * diet plans with a menu per meal;
   * a diet order per admission (start, change, stop; nothing by mouth);
   * the kitchen list per meal;
   * meals marked served or refused.
2. **Menus are text per meal** ("2 ruti, 1 egg, tea"). The canteen's items come with step 12, and menus may link to
   them then.
3. **Food is not billed.** Meals stay inside the bed rate, as now.
4. **Meals per bed category** decide who is on a meal's list.
5. **Permissions:**
   * `diet:read`;
   * `diet:manage`, for the dietitian;
   * `diet:order`, for doctors and nurses;
   * `diet:serve`, for the kitchen.

Other decisions:

* **One diet in force per admission.**
  * A new order ends the current one at its start, and never starts before the current one (`diet_overlap`).
  * An order starts now, or at a set time up to 2 days ahead, not before the admission day.
  * Stopping ends the current order now.
  * The history stays, so past meals still find the diet that was in force.
* **Which diet a meal gets.** The diet in force at the meal's time on that day, in the organisation's time zone.
* **The kitchen list** covers patients admitted now, in beds whose category gets the meal, ordered by ward and bed.
  Patients already discharged are not listed for past days.
* **Recording a meal:**
  * once per patient, meal and day (`meal_recorded`);
  * from 2 hours before its time (`not_yet`);
  * only for a meal the bed category gets (`meal_not_given`);
  * only with a diet in force that is not nothing by mouth (`nothing_to_serve`).
* **The `InpatientRegister` contract** gains:
  * `inpatients()`: patients admitted now, with bed, ward and bed category;
  * `bedCategories()`.

  The nutrition module reads the hospital only through these.
* **Time-zone helpers** (`zonedInstant`, `dayBounds`, `nextDay`) moved to `src/shared/domain/zoned-time.ts`.
  Clinical (step 11c) and nutrition both use them.

## API (`/api/v1/nutrition`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `POST` / `PATCH` `meal-types`, `diet-plans` | `diet:read` / `diet:manage` | Meals (name, time served) and diets |
| `GET category-meals`, `PUT category-meals/:bedCategoryId` | `diet:read` / `diet:manage` | The meals each bed category gets (whole list) |
| `GET` / `PUT` `diet-plans/:id/menus` | `diet:read` / `diet:manage` | A diet's menu per meal (whole list) |
| `GET` / `POST` `admissions/:id/diet-orders` | `diet:read` / `diet:order` | The diet history; a new diet (`planId`, or `nilByMouth`; `remarks`, `fromAt`) |
| `POST admissions/:id/diet-orders/stop` | `diet:order` | No diet from now |
| `GET kitchen?day=&mealTypeId=` | `diet:read` | The meal's list with plates per diet |
| `POST meal-services` | `diet:serve` | `admissionId`, `mealTypeId`, `day`, `status` served/refused, `note` |

## Report

**`nutrition.kitchen-list`** (`day`, `mealTypeId`), PDF and Excel. It shows:

* plates per diet;
* each patient by ward and bed, with diet, menu, remarks and state. Nothing by mouth is in bold.

## Not ported here

* **Canteen items and quantities in menus** (`FoodPatternDetail`, `FoodDeliverableDetail`): written menus until the
  canteen (step 12).
* **Canteen outlets on diet orders, and priority.**
* **Diet charges.**
* **Read and last-viewed flags** on indents (`IsRead`, `LastViewedMealOrder`): the kitchen list shows the current
  state.
* **Diet restrictions on discharge** (fluid, protein, calories). The discharge summary's diet is text (step 11c).

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The nutrition module reads admissions, beds and bed categories only through `InpatientRegister`.
* Migration `0052_nutrition`: 6 tables.
* `npm test`: 386 passed. New: `test/unit/nutrition/diet.spec.ts` covers:
  * menus (one per meal, text required);
  * a plan or nothing by mouth;
  * no overlap with the diet in force;
  * the diet in force at a moment;
  * the kitchen states.
* `npm run test:int`: 16 passed (migration count 53, new tables).
* `npm run test:e2e`: 148 passed. New: `test/e2e/nutrition.e2e-spec.ts` covers:
  * **Setup:**
    * meals per bed category (`diet:manage` only);
    * a duplicate menu refused;
    * menus;
    * the category meals view.
  * **Diet orders:**
    * the kitchen may not order;
    * a plan with nothing by mouth refused;
    * normal from midnight, then nothing by mouth;
    * an earlier start refused (overlap);
    * diabetic with remarks;
    * the history.
  * **Kitchen list:** early tea lists general beds only; the patient on the normal diet at midnight shows the menu;
    the patient with no diet shows "no order"; plates counted.
  * **Recording meals:**
    * a nurse may not record;
    * served;
    * twice refused;
    * no diet;
    * a meal the cabin does not get;
    * a future day not yet;
    * the list shows served.
  * **Lunch list:** bed order, the diabetic menu with remarks, nothing by mouth, plates.
  * **Stop:** stopped, then stopping again refused.
  * **Report:** Excel and PDF.
* Dev server restarted; readiness 200.
