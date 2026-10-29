# Step 11e — Patient portal: one-time code sign-in, the patient's own documents

Status: **done** (2026-10-30). Previous: [step 11d](11d-nutrition.md) · Next: [step 12a](12a-canteen.md).

What this step adds, in a new `portal` module:

* **Sign-in with a one-time code.**
  * A patient (or whoever has their contact) gives their UHID and their mobile, their contact's mobile, or their email,
    exactly as registered.
  * A 6-digit code is sent there.
  * The code gives a **30-minute patient token**: its own kind, never taken for a staff token.
* **The patient's own documents:**
  * lab reports and imaging reports;
  * signed prescriptions and discharge summaries;
  * consultation and diagnostic receipts, and final indoor bills.

  They are listed newest first and printed as PDF. A report on a bill the patient still owes on is **held**, as at
  the lab counter.

## Where the old logic lives

CoxBazar:

* `AnonymousUser` (MobileNo, EMailId, UHID, IsMobileRequest / IsEmailRequest).
* `AnonymousUserVerification` (OTPCode, OTPExpireTime, IsOTPMacthed), tied to one investigation invoice. The code
  unlocked that invoice's reports.

## Decisions (step 11d's open questions; "next" without answers, so the recommendations)

1. **Scope.** UHID + mobile/email + one-time code. Then the patient's own documents only, read-only: lab and imaging
   reports, signed prescriptions and discharge summaries, receipts and bills. Not tied to one invoice as before.
2. **Delivery.**
   * **Email** goes through the existing outbox (template `portal-otp`).
   * **SMS:** no gateway is chosen yet. A `SmsSender` port has a logging adapter. Outside production it logs the
     message and keeps the last 50 (for development and tests). In production it logs only that a message to a
     masked number could not be sent; it never logs the code.
   * **Open:** which SMS gateway, and its credentials. Until then, patients without an email get no code in
     production.
3. **Code rules:**
   * 6 digits, valid for 5 minutes, 5 wrong codes kill the challenge.
   * A new code is sent at most every 60 seconds and 5 times an hour.
   * 10 wrong codes in 15 minutes stop new codes for 15 minutes.
   * Codes are kept only as HMAC-SHA256 hashes, bound to their challenge, under a key derived from the JWT secret.
     They are compared in constant time.
4. **Held reports.** A lab or imaging report of a bill the patient pays and still owes on is listed with the reason
   and refused for printing (`document_held`) until paid. Corporate, staff and indoor bills are not held, as at the
   counter (step 10c).
5. **The patient token.**
   * HS256 with a key **derived** from each JWT secret for the portal, `typ: portal+jwt`, audience `<audience>:portal`.
     The subject is the patient and `sid` is the portal session.
   * It lasts 30 minutes with no refresh. It is checked against the session on every call; signing out ends it.
   * Staff tokens fail the portal's checks, and portal tokens fail the staff checks (different key, type and
     audience).

Other decisions:

* **Nothing leaks to a stranger.**
  * The code request always answers `202` with a challenge id, a masked destination and an expiry. This holds for an
    unknown UHID, a contact that is not the patient's, a patient locked out, or a code sent less than a minute ago.
  * The mask is of the contact as normalised, so letter case gives nothing away.
  * A wrong or expired code, a used challenge or a made-up challenge all answer `invalid_code` (401).
* **Contacts match however written:** mobiles as `+880 1711-000000`, `8801711000000` or `01711000000`; emails in any
  case.
* **Documents** come from a new **`PatientDocumentRegistry`** (shared kernel). Each owning module registers a source:
  * hospital: receipts and final indoor bills;
  * laboratory: lab and imaging reports, through a new `DiagnosticOrders.ofPatient`;
  * clinical: prescriptions and discharge summaries.

  A document is printed **only if it is in the signed-in patient's own list**. Another patient's document is
  `404`.
* **Printing** goes through a new **`DocumentPrinter`** contract, published by the reporting module (now
  `@Global`). It renders a registered report as PDF without staff report grants. Only the portal uses it, and only
  for documents it has already checked.
* **The patient is looked up** through a new `PatientDirectory.contactsByUhid`.
* **Auditing.** Every code sent, wrong code, sign-in and document printed is audited (no staff actor), never with the
  code.
* **Rate limiting.** The code and sign-in endpoints use the stricter auth rate limit.

## API (`/api/v1/portal`)

| Endpoint | Who | What |
|---|---|---|
| `POST otp` | anyone (auth rate limit) | `uhid`, `contact` → `202` `{ challengeId, sentTo, expiresAt }` |
| `POST session` | anyone (auth rate limit) | `challengeId`, `code` → `{ accessToken, expiresAt, patient: { name, uhid } }` |
| `POST logout` | the patient's token | Ends the session |
| `GET me` | the patient's token | Name, UHID, sex, date of birth, blood group |
| `GET documents` | the patient's token | `ref`, kind, title, number, day, `available`, `heldReason` |
| `GET documents/:ref/pdf` | the patient's token | The PDF; `document_held` (403) when held, `404` when not theirs |

## Not ported here

* **A real SMS gateway.** It is open (see decision 2).
* **Patient self-registration or appointment booking from the portal.**
* **Downloads of documents not yet printable** (an unsigned prescription, an unverified result). They are not
  listed.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The portal reads patients, documents and printing only through `PatientDirectory`, `PatientDocumentRegistry` and
    `DocumentPrinter`.
  * Its domain uses no Node crypto; codes are made and hashed in infrastructure.
* Migration `0053_portal`: 2 tables.
* `npm test`: 392 passed. New: `test/unit/portal/portal.spec.ts` covers:
  * codes are 6 digits;
  * contacts match the patient's own mobile or email however written, and nothing else;
  * masking;
  * keyed hashes bound to their challenge;
  * a patient token is refused by the staff verifier and a staff token by the portal's;
  * expiry.
* `npm run test:int`: 16 passed (migration count 54, new tables).
* `npm run test:e2e`: 150 passed. New: `test/e2e/portal.e2e-spec.ts` covers:
  * **Sign-in by SMS:**
    * the same answer and no message for an unknown UHID or a contact not the patient's;
    * a code by SMS to a mobile written with +880;
    * no second code within a minute;
    * a wrong code refused, a made-up challenge refused;
    * signed in, after which the code works only once.
  * **Tokens:** a staff token refused by the portal; the patient token refused by a staff endpoint.
  * **Documents:**
    * the receipt and a held lab report (nothing of another patient's);
    * the receipt printed;
    * the held report refused;
    * another patient's receipt not found;
    * paid, after which the report prints.
  * **Sign-out:** the session is revoked.
  * **Sign-in by email:** five wrong codes end the challenge, and the right code is refused after that.
* Dev server restarted; readiness 200.
