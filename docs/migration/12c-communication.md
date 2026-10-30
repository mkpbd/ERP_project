# Step 12c — Communication: health tips, notices, live chat

Status: **done** (2026-10-30). Previous: [step 12b](12b-marketing.md) · Next: step 12d (activity log).

What this step adds, in a new `communication` module:

* **Health tips.** Written in English (and Bangla) with a category, an image, pinned or not, an order and a
  publishing window. The patient portal shows the ones being published to anyone.
* **Notices to staff.** One notice goes to users chosen by name and by role. Each recipient keeps their own read
  mark and sees how many are unread; the sender sees how many were read.
* **Live chat** between a patient signed in to the portal and the hospital's staff.
  * Staff take a chat (over), answer and close it.
  * Each side sees what it has not read yet.
  * New messages are fetched by polling.

## Where the old logic lives

CoxBazar, `Others` (`src/Core/Domain/Entities/Others/`):

* `HealthTip`: title, summary and body in English and Bangla, category, image, pinned, order, publish from / to.
* `Notification` / `NotificationSentTo` (read per user) and `Message` (one user's message, read).
* `LiveChatConversation`: UHID, patient, topic, status, assigned agent, unread counts, closed by / on.
* `LiveChatMessage`: sender type and name, text, seen by patient / agent.

## Decisions (step 12b's open questions; "next" without answers, so the recommendations)

1. **Health tips** are kept by staff (`content:manage`). They are shown on the portal without signing in:
   `GET /portal/health-tips`, pinned first, then by order.
2. **Notices replace the old Notification and Message.**
   * A notice goes to the users named plus the users holding the roles named. Only active users are included, each
     once, at most 2,000.
   * Reading one's own notices needs no permission.
3. **Live chat** is between portal patients and staff (`chat:answer`). New messages are fetched by polling
   (`?after=`); there is no websocket server.
4. **Permissions:** `content:manage`, `notice:send`, `chat:answer`.

Other decisions:

* **The portal side goes through a contract.** The communication module publishes **`PatientEngagement`**:
  published tips, and the patient's own chats (start, list, messages, send). The portal module's routes call it.
  Communication never sees the portal's sessions, and the portal never reads communication's tables.
* **Recipients by role** come from a new **`AccessControl.usersWithRoles`**.
* **A tip is shown** while active and within its window. The start is inclusive, the end exclusive, and either may
  be open. The window must end after it starts. Images are https only.
* **Chat rules.**
  * **Patients:**
    * keep at most **3 chats open**, each started with its first message;
    * write only in an open chat of their own (`chat_closed`);
    * get not-found for another patient's chat.
  * **Staff:**
    * replying to a chat nobody has makes it theirs;
    * another's chat is taken over first (`not_your_chat`);
    * only whoever has it closes it.
  * **Read marks.** Each side has a read mark: writing, or fetching the messages, marks everything before it read.
    Another agent fetching a chat that isn't theirs leaves its read mark alone. The unread counts are the other
    side's messages after it.
  * **Size:** a topic is up to 150 characters, a message up to 2,000.
* **Sender names.** A chat message shows the patient's name or the staff member's display name.

## API

`/api/v1/communication` (staff):

| Endpoint | Who | What |
|---|---|---|
| `GET` / `POST` / `PATCH` `health-tips` | `content:manage` | Tips: title, titleBn, summary(Bn), body(Bn), category, imageUrl, isPinned, displayOrder, publishFrom, publishTo |
| `POST notices`, `GET notices/sent` | `notice:send` | Send to `userIds` and `roleIds`; what was sent, to how many, read by how many |
| `GET notices/mine?unread=`, `POST notices/:id/read` | any signed-in user | One's notices and unread count; mark one read |
| `GET chats?status=&mine=`, `GET chats/:id/messages?after=` | `chat:answer` | Chats with patient and unread; messages |
| `POST chats/:id/take`, `POST chats/:id/messages`, `POST chats/:id/close` | `chat:answer` | Take (over), reply, close |

`/api/v1/portal` (patients):

| Endpoint | Who | What |
|---|---|---|
| `GET health-tips?category=` | anyone | Tips being published |
| `GET chats`, `POST chats` | the patient's token | Their chats with unread; start one (`topic`, `text`) |
| `GET chats/:id/messages?after=`, `POST chats/:id/messages` | the patient's token | Messages (then read); write |

## Not ported here

* **Images uploaded for tips.** A tip links to an https image.
* **Push or websocket delivery** of chat messages and notices. Clients poll.
* **The old per-user Message.** A notice to one user does the same.

## Verification

* `npm run typecheck`, `npm run lint`, `npm run format:check`, architecture test: clean.
  * The portal's chat routes go through the buses to `PatientEngagement`.
* Migration `0056_communication`: 5 tables.
* `npm test`: 402 passed. New: `test/unit/communication/communication.spec.ts` covers:
  * the tips' window;
  * who may answer a chat;
  * text limits.

  Also: `usersWithRoles` in the access-control fakes.
* `npm run test:int`: 16 passed (migration count 57, new tables).
* `npm run test:e2e`: 154 passed. New: `test/e2e/communication.e2e-spec.ts` covers:
  * **Tips:**
    * a pinned tip first;
    * a future and an inactive tip hidden;
    * an http image refused;
    * only `content:manage` keeps them;
    * the category filter, without signing in.
  * **Notices:**
    * a notice to a role and a user in it, counted once;
    * a role with nobody refused;
    * unread then read;
    * a non-recipient's read refused;
    * the sent list with read counts.
  * **Chat:**
    * a patient starts one;
    * agents see it unread;
    * one agent answers and has it, the other must take it over;
    * the patient reads both answers with names;
    * another patient can't see or write in it;
    * a staff token is refused on the portal;
    * three open at most;
    * close by the agent who has it, after which writing is refused.
* Dev server restarted; readiness 200.
