# Step 13a — Data migration: the framework, users, doctors, patients

Status: **done** (2026-10-30). Previous: [step 12d](12d-activity-log.md) · Next: step 13b (accounts and opening
balances).

Step 13 moves the old system's data into this one. It is split:

| Part | Scope |
|---|---|
| **13a** (this step) | The tool, and users, roles, specialities, doctors and patients |
| 13b | Accounts and opening balances |
| 13c | HR |
| 13d | Catalogues, suppliers and opening stock |
| 13e | Open documents and dues |
| 13f | Clinical history |
| 13g | Rehearsal, reconciliation and the go-live runbook |

## The tool

```
ETL_SOURCE_URL="Server=<host>;Database=<db>;User Id=<read-only login>;Password=…;Encrypt=true" \
  npm run etl -- [--dry-run] [--only=users,patients] [--batch=2000]
```

* **Source.** It reads the old SQL Server database (`mssql`) with a **read-only** login.
  * The connection string comes only from `ETL_SOURCE_URL`. It is never printed, logged or stored. Keep it out of
    `.env` files that are committed.
* **Loaders and their order.**
  * Each kind of record has a loader: `roles`, `users`, `user-roles`, `specialities`, `doctors`, `patients`.
  * A loader runs after the loaders it depends on (asking for `doctors` brings `specialities` and `users`).
* **Reading in pages.** Old tables are read a page at a time in key order (`--batch`, default 2,000).
* **Safe re-runs** through **`etl_id_map`** (kind, old id → new id).
  * A record already brought over is **kept**, not written again, so a run may be repeated or carried on after a
    failure.
  * A real run commits loader by loader.
* **Dry run** (`--dry-run`).
  * Everything runs in **one transaction that is rolled back**, so the database's own checks are applied too.
  * It prints, per loader, what was read, written, kept and rejected, with the reasons and example old ids.
* **Run log.** Every run (dry or real) is logged in **`etl_runs`**: loaders, totals, the full report and any error.
* **Where the code lives.**
  * The tool is under `src/cli/data-migration/`, like the seeding CLI: it writes many modules' tables directly.
  * Only its two tables' schema is under `src/modules/data-migration/`, where drizzle-kit reads schemas.

## What comes over in this step

| Old | New | How |
|---|---|---|
| `Identity.Roles` | `roles` | Named as roles are named here (`Front Desk` → `front-desk`, old name in the description); an existing role of the same name is used. **No permissions**: grant them before people sign in |
| `Identity.Users` | `users` | See the user rules below |
| `Identity.UserRoles` | `user_roles` | For users and roles both brought over |
| `Marketing.DoctorFieldOfSpecialities` | `hospital_specialities` | By name (an existing one is used) |
| `Marketing.Doctors` | `hospital_doctors` | See the doctor rules below |
| `Hospital.RegRecords` | `hospital_patients` | See the patient rules below |

**Users:**

* Usernames are kept (lower-cased). A user without an email gets `<username>@users.invalid` and signs in by
  username.
* Accounts count as verified.
* Old password hashes are kept as `aspnet-identity$<hash>`.
* Deleted or inactive accounts come over deactivated.

**Doctors:**

* Chamber fees: first visit, new, follow-up, report.
* A doctor with any chamber fee sees patients here (consultant).
* Each keeps their speciality and the user account that was theirs (`Users.DoctorId`).
* A code another doctor already has is left out (noted).

**Patients:**

* **UHIDs are kept.** The UHID counter of each year is moved past the highest UHID brought over, so new
  registrations never collide.
* Name: the full name, or the given name and surname.
* Sex, blood group and marital status are read however they were written.
* **Birth day:** the date of birth, or one worked out from the age on the registration day (marked estimated).
* Mobiles are normalised (`+880 1711-000000` → `01711000000`).
* A valid 10/13/17-digit NID becomes the ID document. When another patient has it already, it is left out (noted).
* The thana and district become the area.
* Deleted registrations come over inactive.

**Rejected rows** (reported, never written):

* patients with no name, unknown sex, no birth day or age, an invalid or taken UHID, or **no mobile** of their own
  or their contact's;
* users with neither email nor username, or one already taken;
* doctors without a name;
* user-role pairs whose user or role was not brought over.

## Old passwords

* **Which hashes.** ASP.NET Core Identity hashes are verified as they were made:
  * **v3** (`0x01` header with PRF SHA-1/256/512, iteration count and salt length);
  * **v2** (`0x00`: PBKDF2-SHA1, 1,000 iterations).

  The prefix routes them in the password hasher. A missing or unreadable hash never matches: that user resets their
  password.
* **Rehash.** Such a hash always "needs rehashing". The first successful sign-in replaces it with argon2id, through
  the existing upgrade in the sign-in.

## Decisions (step 12d's open questions; "next" without answers, so the recommendations, except the source)

1. **The source database and its connection were not given.** The tool takes them from `ETL_SOURCE_URL`, to be set
   by whoever runs it. The SQL Server connections of this workspace were not reachable this session.
2. **What comes over.**
   * Masters, opening balances at the cut-over date, open documents and the clinical history: the parts of 13a–13f.
   * **Old transaction history stays in the old database**, kept read-only.
3. **A Node CLI** with an id map, dry run and per-run report, as above.
4. **Old password hashes are imported and checked at the first sign-in**, then upgraded.
5. **Cut-over:** a rehearsal on a copy first; freeze, final run, reconciliation, switch (step 13g).

Other decisions:

* **Records changed in the old system after they were brought over are not updated by a re-run.** The final run is
  made after the old system is frozen (step 13g), on a fresh database or one loaded only by rehearsals of the same
  data.
* **Old ids are matched without regard to case** (SQL Server GUIDs and ids are case-insensitive).

## Not done here

* **The other kinds of records** (13b–13f).
* **Per-patient city and district lookups** (district ids). The old free-text district is kept in the area.
* **Doctors' professional identities and workplaces, IPD ward visit fees, self-chamber fees.**

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0057_data_migration`: `etl_id_map`, `etl_runs`. New dependency: `mssql` (production audit clean).
* `npm test`: 412 passed. New: `test/unit/data-migration/legacy-records.spec.ts` covers:
  * **Old values:**
    * mobiles, sexes, blood groups, marital states, role names;
    * birth from the date or the age.
  * **Records:**
    * a patient made or rejected, with reasons;
    * a user with a placeholder email and the prefixed hash;
    * doctors as consultants by their fees.
  * **Old passwords:** v3 (SHA-256, SHA-512) and v2 hashes verified, wrong passwords and unreadable hashes refused,
    always rehashed.
  * **The run:** loaders ordered by their dependencies; rejections counted with examples.
* `npm run test:int`: 16 passed (migration count 58, new tables).
* `npm run test:e2e`: 156 passed. New: `test/e2e/data-migration.e2e-spec.ts` covers:
  * **Dry run:** counts per loader with rejections, nothing kept, the run logged.
  * **Real run:** the same counts.
  * **Re-run:** nothing written twice.
  * **Patients:** UHIDs, estimated births, blood groups.
  * **Doctors:** linked to their user account, with fees.
  * **Old passwords:**
    * a wrong password refused;
    * a v3 and a v2 hash sign in;
    * the hash is replaced by argon2id, and the next sign-in still works.
  * **Roles:** brought over.
  * **New registrations:** numbered after the UHIDs brought over.
  * **Paging:** exercised with pages of two.
  * The dry run also caught a role-name rule the old names broke; role names are now made into the form roles take
    here.
* Dev server restarted; readiness 200.
