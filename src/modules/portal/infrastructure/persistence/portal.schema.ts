import { sql } from 'drizzle-orm';
import { index, pgTable, smallint, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { patients } from '../../../hospital/infrastructure/persistence/hospital.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// Old AnonymousUser / AnonymousUserVerification (OTPCode, OTPExpireTime, IsOTPMacthed): a one-time code sent to a
// patient's mobile or email. Only its keyed hash is kept.
export const otpChallenges = pgTable(
  'portal_otp_challenges',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    channel: text('channel', { enum: ['sms', 'email'] }).notNull(),
    /** Masked, as shown back to the patient. */
    sentTo: text('sent_to').notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: tz('expires_at').notNull(),
    /** Wrong codes tried. */
    attempts: smallint('attempts').notNull().default(0),
    consumedAt: tz('consumed_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [index('portal_otp_challenges_patient_idx').on(t.patientId, t.createdAt)],
);

// A patient signed in to the portal: their token is good until it expires or they sign out.
export const portalSessions = pgTable(
  'portal_sessions',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    challengeId: uuid('challenge_id')
      .notNull()
      .references(() => otpChallenges.id, { onDelete: 'cascade' }),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    createdAt: tz('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('portal_sessions_live_idx')
      .on(t.patientId)
      .where(sql`${t.revokedAt} is null`),
  ],
);
