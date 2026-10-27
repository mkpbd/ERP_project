# Step 9e — Hospital: admissions, beds and discharge

Status: **done** (2026-10-27). Previous: [step 9d](09d-hospital-services-corporate.md) · Next: [step 9f](09f-hospital-indoor-bill.md)
(the indoor bill).

This step moves patients only. The indoor bill comes in step 9f: bed days, IPD services, consultant visits, the
advance taken at admission, the final bill and the discharge payment.

## Where the old logic lives

CoxBazar:

* **Masters:** `Hospital.Floors`, `CabinTypes` and `Cabins`.
* **Admission:** `IPDPatientRecords` (`/hospital/patientadmission`, `AddEditPatientAdmissionPage.OnSubmit`).
* **Beds:** `IPDCabinAllocationRecords` (PAB / RAT / RAD / EC rows), with `/hospital/Cabin-Transfer`.
* **Doctors:** `AssignedDoctorRecords` (`/hospital/assigned-doctor-transfer`).
* **Cancellation:** `/hospital/admission-cancel`.
* **Prints:** `PrintIPDPatientAdmissionDocument`.
* **Dashboards and reports:** the cabin and patient-list dashboards, plus the Hospital rdlc reports
  (AdmittedAndDischargedPatientList, ConsultantWisePatientList, HospitalBedCabinAvgIncomeSummary,
  BedUtilizationStatement).

What changes from the old admission:

* **Patient registered before the bed was checked.** A failed admission left a new registration behind. Now
  admission needs a registered patient and does all its work in one transaction.
* **Beds claimed from the page's cached list.** Now the bed is locked and re-read before it is taken.
* **No guard against a second admission of the same patient.** Now there is one (409 `already_admitted`, and a
  unique index).
* **Every page rewrote the whole record.** A stale page once undid a discharge (fix script for admission 26007174).
  Now each change is its own step on the admission's current version.
* **No reason, emergency/elective or discharge type** was kept. A discharge was simply the final bill being saved.
* **Housekeeping status was never set.** A bed left now always goes to housekeeping until it is made ready.
* **Additional doctors** were a list in a text column with no history.
* **Reports filtered on the admission bed.** 1,191 of 4,679 patients had moved beds. Now they use the current or last
  bed.

## Masters (record endpoints, `ipd:read` to see, `ipd:manage` to change)

| Path | What |
|---|---|
| `/hospital/wards` | Name (unique), floor, active (the old floor and department as a place) |
| `/hospital/bed-categories` | Name, **admission fee**, **daily rate**, `isIntensive` (ICU, HDU, CCU, NICU …) |
| `/hospital/beds` | Code (unique, any case), ward, category, its own **daily rate** (else the category's), display order, active. The status (available, occupied, housekeeping, out of order) is not written here. |

## Admissions (`/api/v1/hospital`, `IP-<year>-<serial>`)

### Admitting (`POST admissions`, `ipd:admit`)

* A registered, active patient with **no open admission**. This is checked under a lock on the patient (409
  `already_admitted`).
* A **free bed**: active and available, taken under a lock (409 `bed_unavailable`).
* The **consultant**: active and seeing patients here.
* The doctors who also see the patient: up to 10, active.
* Emergency or elective, the reason for admission, and a referring doctor.
* **Who pays:** the patient's own **corporate client** unless another, `null` or a staff member is given. An active
  client or active staff only.
* At admission:
  * the bed category's **admission fee** is kept for the bill;
  * the stay starts at the bed's rate;
  * the bed becomes occupied;
  * the UHID's use is logged (`ipd_admission`).

### Changes (each with the admission's `version`; 409 `stale_admission`; only while admitted, else 422 `admission_state`)

* **`POST admissions/:id/transfer`:** to another free bed, **with a reason**.
  * The stay closes at that moment and a new one opens at the new bed's rate.
  * The bed left goes to **housekeeping**.
* **`POST admissions/:id/consultant`:** another consultant takes over.
  * The old primary row closes.
  * If the new consultant was an additional doctor, that row closes too.
* **`POST admissions/:id/additional-doctors`:** the whole list of doctors who also see the patient.
  * Rows close for doctors removed and open for doctors added.
  * The consultant cannot also be in it.
* **`POST admissions/:id/discharge`:** the discharge type is one of:
  * **normal**;
  * **LAMA** (left against medical advice);
  * **referred**;
  * **absconded**;
  * **death**.

  Any type but normal needs a note. The stay and the doctors' rows close, and the bed goes to housekeeping. Billing
  clearance before discharge comes with step 9f.
* **`POST admissions/:id/cancel`** (`ipd:manage`): an admission made by mistake, with a reason. The bed goes to
  housekeeping.

### Beds

**`POST beds/:id/status`** sets a bed:

* `available` (made ready after housekeeping, `ipd:admit`);
* `out_of_order` (`ipd:manage`).

A bed with a patient is refused (409 `bed_occupied`).

### Views

* **`GET admissions`** filters by status, patient, doctor, ward (of the current or last bed) and admission days in
  the organisation's time zone. Paged.
* **`GET admissions/:id`** includes every bed stay (bed, ward, category, from, to, rate, reason) and every doctor row
  (doctor, role, from, to).
* **`GET bed-board`:** every bed by ward, its status and who is in it (admission, patient, since when, consultant),
  with counts by status.

## Patient's corporate client (from step 9d)

Patients gain `corporateClientId`: the company their bills go to by default. It must be an active client.

* **OPD bills:** when `corporateClientId` is left out, the bill goes to the patient's client. `null` makes the patient
  pay.
* **Admissions:** the same rule.

## Reports

* `hospital.admission-form`: the form the patient or guardian signs. It shows:
  * admission number and time;
  * UHID with prefix and the patient;
  * the bed, the consultant and the doctors who also see the patient;
  * the referring doctor, who pays, and the reason;
  * the **consent** (to treatment, to the charges, to sharing medical information), with signatures.
* `hospital.inpatient-census`: every bed by ward now, with status, patient, since when, nights so far and the
  consultant, and counts by status. PDF and Excel.
* `hospital.admission-register`: admissions over a period, with the current or last bed and ward, consultant,
  discharge time, how it ended, nights and status. Filtered by doctor. PDF and Excel.
* `hospital.bed-occupancy`: per bed category over a period, the beds, bed-nights, nights used and occupancy %.
  * **A stay uses the nights from its first day to its last day; the last day is not a night, and a same-day stay
    uses none.** This is how the old bills counted, verified against final bills on 2026-08-17.
  * A stay still open runs to today.
  * Cancelled admissions do not count.

## Not ported here

These are left out:

* **Bed rent packages and their rules** (`BedRentPackages`, `CabinDiscounts`, `CabinChargeRule` grace hours,
  `ManualCabinDays`). These are billing and come with step 9f.
* **"Keep the old cabin too" (EC) and extra cabins charged on top.** These also come with step 9f, if wanted.
* **Inter-department transfers.** Wards replace departments as places.
* **Nurse station and pharmacy clearance before discharge.** This comes with step 9f and the pharmacy's indoor
  patients (step 8i).
* **Discharge certificates and death records.** These come with the EMR step.
* **SMS to doctors on admission.** This comes with an SMS gateway.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0039_hospital_admissions`: 6 tables and the patient's corporate client
* `npm test`: 322 passed. The new `test/unit/hospital/admission.spec.ts` covers:
  * admission to a bed under a consultant with an additional doctor;
  * a transfer refused without a reason or to the same bed, then stays closed and opened at their rates;
  * a consultant change closing the additional row of the new consultant;
  * the additional list refusing the consultant;
  * discharge needing a note for LAMA and closing everything;
  * no change after discharge;
  * cancellation with a reason;
  * versions.
* `npm run test:int`: 16 passed (migration count 40, new tables)
* `npm run test:e2e`: 126 passed. The new `test/e2e/hospital-ipd.e2e-spec.ts` covers:
  * **Masters:** refused to the officer.
  * **Admitting:**
    * `IP-` numbering;
    * a second admission of the patient, a taken bed and a doctor who does not see patients all refused;
    * the patient's corporate client used, and another patient paying themselves;
    * the bed's own rate kept.
  * **Bed board:** the counts.
  * **Moving beds:**
    * an ICU transfer leaving the bed in housekeeping;
    * another patient refused it until it is made ready;
    * out of order refused to the officer, and refused on an occupied bed.
  * **Doctors:** a consultant change and additional doctors, with their full history.
  * **Discharge:** LAMA refused without a note, then discharged; the ICU bed in housekeeping.
  * **Cancellation:** refused to the officer, done by a manager.
  * **Readmission:** the patient admitted again.
  * **Reports:** the admission form PDF, the census, the register, and occupancy with no nights used on the day.

  `test/e2e/hospital-services.e2e-spec.ts` now also checks a patient's company billed by default, and the patient
  paying when the counter says so.
* Admission form, census, register and occupancy checked visually (Bangla names)
* Dev server restarted; readiness 200
