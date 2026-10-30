import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DbContext } from '../../../../database/drizzle-transaction-manager.js';
import {
  CommunicationRepository,
  type ChatRow,
  type MessageRow,
  type NoticeView,
  type TipRow,
} from '../../application/communication.ports.js';
import { chatMessages, chats, healthTips, noticeRecipients, notices } from './communication.schema.js';

const chatColumns = {
  id: chats.id,
  patientId: chats.patientId,
  topic: chats.topic,
  status: chats.status,
  assignedTo: chats.assignedTo,
  startedAt: chats.startedAt,
  lastMessageAt: chats.lastMessageAt,
  patientReadAt: chats.patientReadAt,
  staffReadAt: chats.staffReadAt,
  closedAt: chats.closedAt,
};

@Injectable()
export class DrizzleCommunicationRepository extends CommunicationRepository {
  constructor(private readonly context: DbContext) {
    super();
  }

  tips(): Promise<TipRow[]> {
    return this.context.db
      .select({
        id: healthTips.id,
        title: healthTips.title,
        titleBn: healthTips.titleBn,
        summary: healthTips.summary,
        summaryBn: healthTips.summaryBn,
        body: healthTips.body,
        bodyBn: healthTips.bodyBn,
        category: healthTips.category,
        imageUrl: healthTips.imageUrl,
        isPinned: healthTips.isPinned,
        isActive: healthTips.isActive,
        publishFrom: healthTips.publishFrom,
        publishTo: healthTips.publishTo,
        displayOrder: healthTips.displayOrder,
      })
      .from(healthTips)
      .where(eq(healthTips.isActive, true))
      .orderBy(asc(healthTips.displayOrder), desc(healthTips.createdAt));
  }

  async insertNotice(
    notice: { id: string; title: string; body: string; sentBy: string; sentAt: Date },
    userIds: readonly string[],
  ): Promise<void> {
    await this.context.db.insert(notices).values({ ...notice, recipients: userIds.length });
    await this.context.db
      .insert(noticeRecipients)
      .values(userIds.map((userId) => ({ noticeId: notice.id, userId, readAt: null })));
  }

  noticesOf(userId: string, unreadOnly: boolean): Promise<NoticeView[]> {
    return this.context.db
      .select({
        id: notices.id,
        title: notices.title,
        body: notices.body,
        sentBy: notices.sentBy,
        sentAt: notices.sentAt,
        readAt: noticeRecipients.readAt,
      })
      .from(noticeRecipients)
      .innerJoin(notices, eq(notices.id, noticeRecipients.noticeId))
      .where(
        unreadOnly
          ? and(eq(noticeRecipients.userId, userId), isNull(noticeRecipients.readAt))
          : eq(noticeRecipients.userId, userId),
      )
      .orderBy(desc(notices.sentAt))
      .limit(200);
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.context.db
      .select({ n: count() })
      .from(noticeRecipients)
      .where(and(eq(noticeRecipients.userId, userId), isNull(noticeRecipients.readAt)));
    return row?.n ?? 0;
  }

  async markRead(noticeId: string, userId: string, at: Date): Promise<boolean> {
    const [row] = await this.context.db
      .select({ readAt: noticeRecipients.readAt })
      .from(noticeRecipients)
      .where(and(eq(noticeRecipients.noticeId, noticeId), eq(noticeRecipients.userId, userId)));
    if (!row) return false;
    if (!row.readAt) {
      await this.context.db
        .update(noticeRecipients)
        .set({ readAt: at })
        .where(and(eq(noticeRecipients.noticeId, noticeId), eq(noticeRecipients.userId, userId)));
    }
    return true;
  }

  sentNotices() {
    return this.context.db
      .select({
        id: notices.id,
        title: notices.title,
        body: notices.body,
        sentBy: notices.sentBy,
        sentAt: notices.sentAt,
        recipients: notices.recipients,
        read: sql<number>`(select count(*) from ${noticeRecipients} where ${noticeRecipients.noticeId} = ${notices.id} and ${noticeRecipients.readAt} is not null)`.mapWith(
          Number,
        ),
      })
      .from(notices)
      .orderBy(desc(notices.sentAt))
      .limit(200);
  }

  async insertChat(chat: ChatRow): Promise<void> {
    await this.context.db.insert(chats).values(chat);
  }

  async chatForUpdate(id: string): Promise<ChatRow | null> {
    const [row] = await this.context.db.select(chatColumns).from(chats).where(eq(chats.id, id)).for('update');
    return row ?? null;
  }

  async chat(id: string): Promise<ChatRow | null> {
    const [row] = await this.context.db.select(chatColumns).from(chats).where(eq(chats.id, id));
    return row ?? null;
  }

  chats(filter: { patientId?: string; status?: 'open' | 'closed'; assignedTo?: string }): Promise<ChatRow[]> {
    const conditions: SQL[] = [];
    if (filter.patientId) conditions.push(eq(chats.patientId, filter.patientId));
    if (filter.status) conditions.push(eq(chats.status, filter.status));
    if (filter.assignedTo) conditions.push(eq(chats.assignedTo, filter.assignedTo));
    return this.context.db
      .select(chatColumns)
      .from(chats)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(chats.lastMessageAt))
      .limit(200);
  }

  async updateChat(
    id: string,
    changes: Partial<Omit<ChatRow, 'id' | 'patientId'>> & { closedBy?: string | null },
  ): Promise<void> {
    await this.context.db.update(chats).set(changes).where(eq(chats.id, id));
  }

  async insertMessage(message: MessageRow & { chatId: string }): Promise<void> {
    await this.context.db.insert(chatMessages).values(message);
  }

  messages(chatId: string, after: Date | null): Promise<MessageRow[]> {
    return this.context.db
      .select({
        id: chatMessages.id,
        sender: chatMessages.sender,
        senderUserId: chatMessages.senderUserId,
        text: chatMessages.text,
        sentAt: chatMessages.sentAt,
      })
      .from(chatMessages)
      .where(
        after ? and(eq(chatMessages.chatId, chatId), gt(chatMessages.sentAt, after)) : eq(chatMessages.chatId, chatId),
      )
      .orderBy(asc(chatMessages.sentAt))
      .limit(500);
  }

  async unread(
    chatIds: readonly string[],
    sender: 'patient' | 'staff',
    reads: ReadonlyMap<string, Date | null>,
  ): Promise<Map<string, number>> {
    if (chatIds.length === 0) return new Map();
    const rows = await this.context.db
      .select({ chatId: chatMessages.chatId, sentAt: chatMessages.sentAt })
      .from(chatMessages)
      .where(and(inArray(chatMessages.chatId, [...chatIds]), eq(chatMessages.sender, sender)));
    const counts = new Map<string, number>();
    for (const row of rows) {
      const readAt = reads.get(row.chatId) ?? null;
      if (!readAt || row.sentAt.getTime() > readAt.getTime()) counts.set(row.chatId, (counts.get(row.chatId) ?? 0) + 1);
    }
    return counts;
  }
}
