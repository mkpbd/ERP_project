# Step 10e — Lab reagents: what each test uses up

Status: **done** (2026-10-28). Previous: [step 10d](10d-radiology.md) · Next: step 10f (transfusion medicine).

What this step adds:

* Each test (lab or imaging) gets a list of the store items it uses up: reagents, tubes, films.
* They are used up from the lab's **store department** in the supply chain the first time the result is verified or
  the report signed.
* A store holding too little never holds the report back. The use is kept as **short**, to be entered by hand.

## Where the old logic lives

CoxBazar:

* **Reagent setup and use.**
  * `ReAgentManagement.TestAndRegAgentMappings`: test → reagent and quantity, with automatic consumption.
  * `ReAgentManagement.ReAgentManualUses`: use entered by hand.
  * Pages: `Server.Client\Pages\ReAgentManagement\`.
* **Films.** `SupplyChain.XrayFilmTestMappings`, with `/supplychain/test-consumption-mapping` (films and other
  items per imaging test).

## Decisions (step 10d's open questions; "next" without answers, so the recommendations)

1. **Step 10e is split.** Reagents are here; transfusion medicine is step 10f.
2. **A list per test, used up when reported.** It is used up when the result is verified or the imaging report signed,
   and only once: a result verified again after a correction uses nothing more. Extra use and spoilage are entered as
   a department consumption in the supply chain, as before (`POST /scm/department-consumptions`).
3. **The stock is the supply chain's department stock.** There is no new store.
   * Each diagnostic department is mapped to a store department (`lab/stock-departments`).
   * The lab uses up stock only through a new contract, **`DepartmentStock`**, published by the supply chain. It gives
     items by id, departments by id, and consumption.
   * A use is an ordinary department consumption (`DC-` number), first expiring first.

Other decisions:

* **Short stock does not block.** When the store holds too little, nothing is taken; the use is kept with no
  consumption, and the result or study shows `reagents: 'short'`. The consumption number drawn for it stays unused.
* **Nothing set, nothing used.** A test with no list, or a department with no store, uses nothing (`reagents: null`).
* **What can be listed.** Only active store items, never fixed assets, each once, with a quantity above 0 (up to
  30 items).

## API (`/api/v1/lab`)

| Endpoint | Who | What |
|---|---|---|
| `GET` / `PUT tests/:testId/reagents` | `lab:read` / `lab:manage` | The whole list: store item (`variantId`) and quantity per test, with names and units |
| `GET` / `PUT stock-departments` | `lab:read` / `lab:manage` | The whole list: diagnostic department → store department |

Results (`GET results/:id`, samples) and imaging studies show `reagents`: `used`, `short` or null.

## Report

**`laboratory.reagent-usage`** (period): per store item, the tests that used it, the quantity used up and the
quantity short. PDF and Excel.

## Not ported here

* **Reagent lots per test and machine.**
* **Reagent quality control.**
* **Manual use pages of the lab.** The supply chain's department consumption is used.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean. The laboratory module uses up
  stock only through `DepartmentStock`.
* Migration `0047_lab_reagents`: 3 tables, and the reagents state of results and studies
* `npm test`: 351 passed. The new `test/unit/laboratory/reagent-use.spec.ts` covers:
  * nothing used without a list or a store;
  * consumption on the organisation's day with the use kept;
  * short kept without a consumption.
* `npm run test:int`: 16 passed (migration count 48, new tables)
* `npm run test:e2e`: 139 passed. The new `test/e2e/lab-reagents.e2e-spec.ts` covers:
  * **Setup:**
    * a lab store department issued two kits and ten tubes;
    * an unknown item refused on a test's list;
    * the list read back with names and units.
  * **Using up:**
    * a CBC verified before the store is mapped uses nothing;
    * mapped, a verified CBC takes a kit and a tube;
    * a correction verified again takes nothing more;
    * the next takes the last kit;
    * the third is verified all the same, marked short, with stock unchanged.
  * **Records:** the usage sheet (3 tests, 2 used, 1 short) and the two department consumptions.
* Dev server restarted; readiness 200
