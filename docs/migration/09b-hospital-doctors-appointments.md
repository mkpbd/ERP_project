# Step 9b — Hospital: doctors, chamber schedules and appointments

Status: **done** (2026-10-26). Previous: [step 9a](09a-hospital-patient-registration.md) · Next: step 9c (OPD
consultation billing, the doctor's share and collections).

The OPD part of step 9 is in two pieces. This step has the doctors, schedules and appointment books, with no money.
Step 9c bills the consultation.

## Where the old logic lives

CoxBazar:

* **Doctors:** `Domain/Entities/Marketing/Doctor.cs` (`Marketing.Doctors`), `DoctorFieldOfSpecialities`, `VWDoctors`.
* **Schedules:** `OPD.DoctorChamberSchedules` (from 2026-09-20), with `ChamberPractionerSettings` before it, and
  `ChamberPractionerRoutines`.
* **Appointments:** `OPD.DoctorAppointments` with `AddEditDoctorAppointmentCommand`, the `RxAppointmentStatus` enum,
  `OPD.PatientVisitTypes` and the `SlotReservationService`.
* **Pages:** `/marketing/doctors`, `/opd/doctor-appointment`, `/opd/doctor-board`, `/opd/doctor-chamber-schedule`.
* **Print:** `PrintPatientAppointmentDocument`.

What changes from the old system:

* **One doctor table**, as before, for consultants and the doctors who refer patients. The flag `isConsultant`
  (old `IsChamberPractitioner`) marks who sees patients here.
* **Degrees** are one text. The old record had six free-text lines.
* **One fee per visit type.** The old record had a chamber fee and a self-chamber fee for each visit type. An old
  binding bug filled the wrong one, so the page fell back from one to the other anyway.
* **Serials:**
  * The old page held slots in memory per server and checked serials in the handler, then again with unique indexes
    added after duplicates were found on 2026-09-21.
  * Now a serial is taken under a **lock on the doctor's day**. A partial unique index stays as the last guard.
  * A cancelled booking frees its serial.
* **Statuses:** the old strings Booked → Invoiced → Vital → Prescribed become booked → arrived (plus no-show and
  cancelled). Billing (9c) and the Rx steps (step 11) keep their own records.
* **SMS:** the old page sent an SMS before knowing the save worked. No message is sent here; see the open question.

## Masters (record endpoints, `opd:read` to see, `opd:manage` to change)

| Path | What |
|---|---|
| `/hospital/specialities` | Specialities (old DoctorFieldOfSpecialities) |
| `/hospital/doctors` | Code (unique, any case), name, degrees, speciality, phone, room, `isConsultant`, fees for `first` / `new` / `follow_up` / `report` visits, the login tied to the doctor (old `Users.DoctorId`, one doctor per login), active. Filters: speciality, consultant, active, user; `q` searches name, code and degrees. |
| `/hospital/doctor-schedules` | One sitting per doctor and weekday (0 = Sunday): first patient's time (`HH:MM`), minutes per patient (1–240), how many patients (1–500), active |
| `/hospital/doctor-closures` | Days a doctor does not sit, with a reason |

## Appointments (`/api/v1/hospital`)

* **Booking:** `POST appointments` (`opd:book`).
  * The doctor must be **active and a consultant**.
  * The doctor must sit that weekday and not be off that day (422 `doctor_off`, naming the reason).
  * The date must be today or later.
  * Give a registered patient (their name and mobile are taken; a patient without a mobile is booked on their
    contact's), or a name and mobile for someone not registered yet (the old UHID 0).
  * The serial asked for, or the first free one, within the sitting:
    * 409 `serial_taken`;
    * 422 `invalid_serial` or `fully_booked`.
  * The time is the first patient's time plus (serial − 1) slots.
  * The fee is the doctor's for the visit type at booking, quoted to the patient.
* **Changes:** `POST appointments/:id/arrive` | `no-show` | `cancel` | `patient`, each with the version (409
  `stale_appointment`), and only from booked (422 `appointment_state`).
  * Arrive needs a registered patient (422 `patient_not_registered`) on the appointment's day.
  * No-show is only from the appointment's day.
  * Cancel needs a reason.
  * `patient` attaches the patient registered after booking.
* **Views:**
  * `GET appointments`: doctor, patient, from, to, status; paged.
  * `GET appointments/:id`: with the doctor, room, referring doctor and UHID.
  * `GET doctors/:id/day?date=`: the doctor board. The sitting and whether the doctor is off, then every serial with
    its time and booking, and any bookings outside the sitting (made before it was changed).

## Reports

* `hospital.doctor-appointments`: a doctor's bookings on a day by serial (time, UHID, patient, referring doctor,
  mobile, visit, fee, status), for the chamber door. PDF and Excel.
* `hospital.appointment-slip`: the slip on an 80 mm roll, with the doctor, room, date, serial in large print, the
  time, patient, UHID, visit and fee.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean
* Migration `0036_hospital_doctors_appointments`: 5 tables
* `npm test`: 311 passed. The new `test/unit/hospital/appointment.spec.ts` covers:
  * slot times, including past midnight;
  * weekdays;
  * fees by visit type;
  * serial choice: asked for, taken, out of range, first free, fully booked;
  * booking dates and names;
  * arrival needing a patient and the day;
  * no-show only from the day;
  * cancellation with a reason;
  * versions.
* `npm run test:int`: 16 passed (migration count 37, new tables)
* `npm run test:e2e`: 121 passed. The new `test/e2e/hospital-appointments.e2e-spec.ts` covers:
  * **Masters:**
    * masters refused to a clerk;
    * doctor code taken in another case;
    * a second sitting on a weekday refused;
    * consultants filtered.
  * **Refused bookings:**
    * a day off with its reason;
    * a weekday without a sitting;
    * a referring doctor;
    * a day gone by.
  * **Booking:**
    * booking refused without `opd:book`;
    * serials 1 and 3 at 17:00 and 17:30 with the new and follow-up fees;
    * 3 taken;
    * the first free serial;
    * fully booked;
    * a booking without a patient.
  * **Cancel and race:** serial 2 cancelled, then two counters racing for it: one gets it.
  * **Board and views:** the doctor board; the view with room and referring doctor.
  * **Arrival:** a walk-in today refused arrival until registered and attached, then arrived and no longer
    cancellable.
  * **No-show:** marked today; refused for tomorrow.
  * **Registered patient:** a booking takes the patient's name and mobile.
  * **List:** filters work.
  * **Reports:** both PDFs and the Excel.
* Doctor appointments and slip checked visually (Bangla names)
* Dev server restarted; readiness 200
