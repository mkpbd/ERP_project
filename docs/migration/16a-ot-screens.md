# Step 16a — Operation theatre screens (Angular)

Status: **done** (2026-10-31). Previous: [step 15a](15a-operation-theatre.md) (its API).

The first screens of the HealthCare modules in the Angular frontend (`D:\Pratices\ERP_Frontend`,
`mkpbd/ERP_frontend`, commit `82610c7`). As agreed, each module's screens come with (or right after) its API:
the 16x steps are the screens, done between the 15x API steps.

## Old → new

| Old page (CoxBazar, Blazor) | New screen | Route |
|---|---|---|
| OT Management, schedule tab; OT room booking calendar | **OT board**: one day, room by room, and the operations waiting for a room | `/ot` |
| OT schedule list | **Operations**: by status, period and room; OT register print | `/ot/cases` |
| OT room booking request; OT schedule edit; OT note tabs; OT service sheet | **Operation**: who and what, room and time, start and finish, the operation note and signing, charges, note and consent prints | `/ot/cases/:id` |
| OT rooms, OT names, OT types, anaesthesia types, surgery procedures | **OT setup**: one tab per master | `/ot/setup` |

## The screens

**OT board** (`ot:read`):

* A day picker with previous / next / today.
* Each active room with its operations (time, status, operation, patient, surgeon).
* The operations waiting for a room, each with **Schedule** (`ot:schedule`).
* **Request operation** (`ot:request`, and `ipd:read` and `opd:read` to choose the stay and the doctors).

**Requesting** (a dialog):

* The admitted patient is found by name, UHID or admission number.
* Then the day, the operation, OT and anaesthesia types, the surgeon, the anaesthetist, up to ten others in the
  team (assistant or anaesthesia assistant) and the indication.
* The same dialog changes what and who until the operation is done.

**Scheduling** (a dialog): room, day, from and to. An end at or before the start is the next day. A clash
comes back from the API (`room_taken`, naming the operation in the way) and is shown in the dialog.

**An operation's page:**

* Actions by status and permission:
  * schedule or move;
  * start and finish, now or at a time given;
  * cancel with a reason;
  * change.
* **The note** (`ot:note`):
  * written once the operation has started;
  * signed after it is done, once the procedure is written and saved;
  * the backend lets only the surgeon's own user sign (`not_the_surgeon` is shown as an error);
  * signed, it is read only.
* **Charges** (`ipd:bill`):
  * a service of the stay with its doctor, the team listed first;
  * a service that carries a doctor's share asks for the doctor;
  * a charge is cancelled with a reason;
  * the total of the active ones.
* **Prints:** the operation note and the consent are downloaded as PDFs.

**Every change sends the version the page read.** A change made meanwhile by someone else is refused (409); the
page then reloads.

**OT setup** (`ot:read` to see, `ot:manage` to add, edit and delete): rooms (name, floor, description, active),
operations (name, active), OT types, anaesthesia types, surgery procedures (title, area, steps).

## Shared pieces (for the screens to come)

* `shared/components/option-picker.ts`: a searchable select for long lists (doctors, services, patients). It
  filters the given options or, with `(lookup)`, lets the caller search the server. The form value is the id.
* `core/services/report-download.service.ts`: runs a report (`POST /reports/:key/render`) and saves the file.
  The 403 of a report not granted to the user's roles is named as such.
* `permissions.ts` gains `opd:read`, `ipd:read`, `ipd:bill` and the `ot:*` keys. The sidebar gains a **Hospital**
  section.

## Backend change

`GET /hospital/admissions` takes `q`: the patient's name, the UHID or the admission number. The request dialog
needs it to find the admitted patient; the inpatient screens will use it too.

## Decisions

1. **UI steps are numbered 16x** and done with or right after their module's API.
2. **The admitted patient is searched on the server** (`q` on admissions), not picked from a loaded list: a
   hospital can have more admitted patients than one page.
3. **The request needs `ipd:read` and `opd:read` too**, to choose the stay and the doctors; the button shows only
   with all three.
4. **Prints download the PDF** rather than opening a tab: a tab opened after an asynchronous call is blocked by
   browsers.

## Verification

* Backend: `npm run typecheck`, lint and the IPD e2e spec (admissions found by name and by number, none for an
  unknown name).
* Frontend `npm run check` (typecheck, lint, architecture, format, unit tests, build): clean. 62 unit tests,
  new:
  * `ot.models.spec.ts`: the day helpers;
  * `ot-board.store.spec.ts`: the board by day;
  * `ot-case.store.spec.ts`: the steps each status and permission allow, the version sent, a reload after a
    change and after a conflict, a charge naming the operation.
* Frontend e2e (Playwright, mocked API): 23 passed. New: `e2e/ot.spec.ts`:
  * request (validation, then patient, operation, surgeon);
  * a room clash shown, the other room taken;
  * start, the note, a charge that needs its doctor, finish, sign, the note read only after;
  * a print;
  * cancel with a reason;
  * the list;
  * an OT room added;
  * no accessibility violations on the board (axe).
* The board, request dialog, operation page and setup were looked at in screenshots.
