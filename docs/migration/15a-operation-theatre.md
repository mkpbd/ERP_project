# Step 15a — Operation theatre

Status: **done** (2026-10-31). Previous: [step 14c](14c-rehearsal-1.md).

The first gap the page-by-page check of the old UI found (14c): the old system's operation theatre had no API here.

## Where the old logic lives

CoxBazar, as six islands that nothing linked:

| Old | What it did |
|---|---|
| `OTSchedules` (`/hospital/otschedule`, OT Management) | Patient, surgeon, anaesthetist, OT type and name, a **free-text status**, floor and room as strings no form filled in |
| `OTRoomBookingRequests` (`/hospital/otroom-booking-request`) | A schedule and a room asked for |
| `OTRoomBooks` (`/hospital/otroom-book/{room}`) | A calendar slot. See the faults below |
| `OTServices` + `OTServiceDetails` (`/hospital/addedit-otservice`, `…-extra`) | The charges: a service head, a doctor, rate and quantity per line. See the faults below |
| `OTInfoNurseStations` (+ details) | Surgeon, anaesthesia and the doctors, printed on the service sheet; not billed |
| `OTAssistantPayments` (+ details, `/ipd/ot-assistant-payment`) | A surgeon fee and payouts to assistants. See the faults below |
| `OTNotes` and the pre-op, post-op, confinement, baby and transfer notes | The OT Management tabs |
| `OTRooms`, `OTNames`, `OTTypes`, `AnaesthesiaTypes`, `SurgeryProcedures`, `OTTemplates` | The masters |

**Room bookings:**

* The clash check ran in the browser, on one room's loaded list. It missed a booking that fully contained another.
* The room was never checked against the request, and the same request could be booked twice.
* Saving went row by row.

**Charges:**

* The service charge used the head's rate, not the line's.
* Every OT line went into the **Consultation** head of the final bill.
* Vouchers were posted **gross**, outside the transaction.
* `IsConsultancyPaId` was never set, so **no doctor ever got a share of an OT line**.

**Assistant payments:** no link to the charges, no accounting, and no check that the parts added up.

**Statuses:**

* No status values or transitions existed. "Done" was a checkbox, and toggling it **wiped** the schedule's other
  fields.
* Cancel was commented out.

## What it is here

**One operation case per operation**, in the hospital module (an operation belongs to a stay):

```
requested ──schedule──▶ scheduled ──start──▶ in progress ──finish──▶ done
     │                     │  ▲ reschedule                            │
     └──────cancel─────────┴──┘ (with a reason)            note signed by the surgeon
```

**Asking for an operation** (`POST /hospital/ot-cases`):

* Only for an **admitted** patient, on a day from today.
* It names:
  * the operation and OT type;
  * the anaesthesia type;
  * the surgeon;
  * the anaesthetist;
  * up to ten others in the team (assistants, anaesthesia assistants);
  * the indication.
* Each doctor is named once, and the anaesthetist is not the surgeon.
* Numbered `OT-<year>-…`.
* What and who can be changed (`PUT …/:id`) until the operation is done.

**Scheduling** (`POST …/:id/schedule`):

* A room and a time, taken **under a lock on the room**.
* It is refused (`409 room_taken`, naming the operation in the way) when another operation scheduled or under way in
  the room overlaps it. Back-to-back is fine.
* Up to 24 hours, not in the past.
* Scheduling again moves it.

**Start and finish** (`…/start`, `…/finish`): the actual times (now when left out). An operation under way is
finished, not cancelled.

**Cancel** (`…/cancel`): with a reason, when not under way. The room is free again.

**Charges:**

* An operation's charges are **the stay's charges**: `POST /hospital/admissions/:id/charges` with `otCaseId`.
* Each line has its service, doctor and quantity.
* Each therefore comes on the final bill under **services**, with **the doctor's share** (the service's share percent),
  paid through the doctors' payments (9g).
* An operation of another stay, or a cancelled one, is refused (`invalid_ot_case`).
* **This replaces the old assistant payment:** an assistant's fee is a charge line with the assistant as its doctor.

**The operation note** (`PUT …/:id/note`):

* Incision, findings, procedure done, specimen sent, post-operative orders. Line breaks are kept.
* Written once the operation has started, until it is signed.
* **Signed** (`…/note/sign`) by **the surgeon's own user account only** (`403 not_the_surgeon`), once it is done and
  the procedure is written.

**Pre- and post-operative notes** are EMR notes: the new kinds `pre_op` and `post_op` on
`POST /clinical/admissions/:id/notes`. Each names the doctor, as rounds do.

**Reading:**

* `GET /hospital/ot-board?day=` gives each active room's operations that day, and the operations waiting for a room
  (asked for on or before that day).
* `GET /hospital/ot-cases` lists operations, filtered by status, period, room, surgeon or stay.
* `GET …/:id` gives the operation with its team, note and charges (total of the active ones).

**Masters** (record endpoints; `ot:read` to see, `ot:manage` to change):

* `/hospital/ot-rooms`;
* `/hospital/operations`;
* `/hospital/ot-types`;
* `/hospital/anaesthesia-types`;
* `/hospital/surgery-procedures` (written steps to copy into a note).

**Prints:**

* `hospital.ot-register` (period, room; PDF and Excel);
* `hospital.ot-note` (marked "Not signed yet" until signed);
* `hospital.ot-consent` (the consent to operation and anaesthesia to sign; not for a cancelled operation).

## Permissions

| Permission | What |
|---|---|
| `ot:read` | The board, operations, notes, masters |
| `ot:request` | Asking for an operation; changing what and who before it is done |
| `ot:schedule` | Room and time, start, finish, cancel |
| `ot:note` | The operation note (signing: the surgeon only) |
| `ot:manage` | The masters |

Charges for an operation need `ipd:bill`, as any charge does.

## Decisions ("next" without answers: the recommendation to start with the OT)

1. **The OT is part of the hospital module.** An operation belongs to a stay, and its charges are the stay's.
2. **One case links what the old six tables did not:** request, schedule, room, times, team and note.
3. **Charges are the stay's charges, with doctors' shares.** This replaces the old OT service and assistant payment.
   The old service charge on OT lines is not kept: here the service charge is on the admission fee, beds and round fee
   only (9f).
4. **The nurse station's OT info is not kept as a record of its own.** It repeated the case's team.
5. **Pre-/post-operative notes are EMR notes.** Confinement and baby notes are the EMR's birth records (11b).
6. **No hard-coded department.** The old gynae branch's `DeptId = 2` is gone.

## Not done here

* **OT note templates.** The old `OTTemplates` had copy-in text. The surgery procedures library takes their place;
  bringing old templates over is a data migration step.
* **The old OT records.** Bringing old operations and notes into the history is a data migration step.
* **Screens.** The Angular screens for the OT come with the OT's turn in the UI steps.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
* Migration `0059_operation_theatre`: seven tables and `hospital_ipd_charges.ot_case_id`.
* The operation note and consent prints were checked by screenshots of their HTML.
* `npm test`: 440 tests passed. New: `test/unit/hospital/ot-case.spec.ts` covers:
  * the team;
  * slots (order, in the past, over a day, moved);
  * start, finish, note and sign in order;
  * no cancelling under way;
  * a stale version.
* `npm run test:int`: 16 tests passed (migration count 60).
* `npm run test:e2e`: 166 tests passed. New: `test/e2e/hospital-ot.e2e-spec.ts` covers:
  * **Asking:** two operations asked for, an invalid team and a past day refused.
  * **Scheduling:** both wait on the board; a clash in OT-1 refused (409), the other put in OT-2.
  * **Under way:** started, not cancellable, the note written.
  * **Charges:** surgeon and assistant fees charged with their shares, and on the stay's account; another stay's
    operation refused.
  * **Signing:** finished; signing refused for a user who is not the surgeon, allowed for the surgeon; the note then
    closed.
  * **Changes:** a stale change refused.
  * **Cancelling:** the other cancelled; the board updated.
  * **Prints:** register, note and consent print (consent refused when cancelled).
  * **Permissions:** checked.
  * **EMR:** pre- and post-operative notes naming their doctors.
* Dev server restarted; readiness 200.
