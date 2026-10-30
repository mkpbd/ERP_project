import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { patients } from '../../../hospital/infrastructure/persistence/hospital.schema.js';
import { users } from '../../../identity/infrastructure/persistence/identity.schema.js';

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const timestamps = {
  createdAt: tz('created_at').notNull().defaultNow(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
};

// Old Others.HealthTip: advice published to patients, in English and Bangla, within a publishing window.
export const healthTips = pgTable(
  'comm_health_tips',
  {
    id: uuid('id').primaryKey(),
    title: text('title').notNull(),
    titleBn: text('title_bn'),
    summary: text('summary'),
    summaryBn: text('summary_bn'),
    body: text('body').notNull(),
    bodyBn: text('body_bn'),
    category: text('category'),
    imageUrl: text('image_url'),
    isPinned: boolean('is_pinned').notNull().default(false),
    displayOrder: smallint('display_order').notNull().default(0),
    publishFrom: tz('publish_from'),
    publishTo: tz('publish_to'),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index('comm_health_tips_category_idx').on(t.category),
    check(
      'comm_health_tips_window_ck',
      sql`${t.publishFrom} is null or ${t.publishTo} is null or ${t.publishFrom} < ${t.publishTo}`,
    ),
    check('comm_health_tips_image_ck', sql`${t.imageUrl} is null or ${t.imageUrl} ~ '^https://'`),
  ],
);

// Old Others.Notification / NotificationSentTo and Message: a notice sent to users, each with their own read mark.
export const notices = pgTable('comm_notices', {
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  sentBy: uuid('sent_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  sentAt: tz('sent_at').notNull(),
  recipients: integer('recipients').notNull(),
});

export const noticeRecipients = pgTable(
  'comm_notice_recipients',
  {
    noticeId: uuid('notice_id')
      .notNull()
      .references(() => notices.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: tz('read_at'),
  },
  (t) => [
    primaryKey({ columns: [t.noticeId, t.userId] }),
    index('comm_notice_recipients_unread_idx')
      .on(t.userId)
      .where(sql`${t.readAt} is null`),
  ],
);

// Old Others.LiveChatConversation: a patient's chat with the hospital, taken by a staff member.
export const chats = pgTable(
  'comm_chats',
  {
    id: uuid('id').primaryKey(),
    patientId: uuid('patient_id')
      .notNull()
      .references(() => patients.id, { onDelete: 'cascade' }),
    topic: text('topic').notNull(),
    status: text('status', { enum: ['open', 'closed'] }).notNull(),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    startedAt: tz('started_at').notNull(),
    lastMessageAt: tz('last_message_at').notNull(),
    /** Up to when each side has read the other's messages. */
    patientReadAt: tz('patient_read_at'),
    staffReadAt: tz('staff_read_at'),
    closedAt: tz('closed_at'),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('comm_chats_patient_idx').on(t.patientId, t.status),
    index('comm_chats_status_idx').on(t.status, t.lastMessageAt),
  ],
);

// Old Others.LiveChatMessage.
export const chatMessages = pgTable(
  'comm_chat_messages',
  {
    id: uuid('id').primaryKey(),
    chatId: uuid('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    sender: text('sender', { enum: ['patient', 'staff'] }).notNull(),
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    sentAt: tz('sent_at').notNull(),
  },
  (t) => [
    index('comm_chat_messages_chat_idx').on(t.chatId, t.sentAt),
    check('comm_chat_messages_sender_ck', sql`(${t.sender} = 'staff') = (${t.senderUserId} is not null)`),
  ],
);
