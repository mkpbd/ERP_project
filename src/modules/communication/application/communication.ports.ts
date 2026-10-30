import type { ChatMessage, PublishedTip } from '../../../shared/application/contracts/patient-engagement.js';

/** Health tips: their contents. */
export const CONTENT_MANAGE = 'content:manage';
/** Sending notices to users and seeing what was sent. */
export const NOTICE_SEND = 'notice:send';
/** Answering patients' chats. */
export const CHAT_ANSWER = 'chat:answer';

export const COMMUNICATION_RECORDS = { healthTip: 'comm_health_tip' } as const;

export interface TipRow extends PublishedTip {
  readonly isActive: boolean;
  readonly publishFrom: Date | null;
  readonly publishTo: Date | null;
  readonly displayOrder: number;
}

export interface ChatRow {
  readonly id: string;
  readonly patientId: string;
  readonly topic: string;
  readonly status: 'open' | 'closed';
  readonly assignedTo: string | null;
  readonly startedAt: Date;
  readonly lastMessageAt: Date;
  readonly patientReadAt: Date | null;
  readonly staffReadAt: Date | null;
  readonly closedAt: Date | null;
}

export interface MessageRow extends Omit<ChatMessage, 'senderName'> {
  readonly senderUserId: string | null;
}

export interface NoticeView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly sentBy: string;
  readonly sentAt: Date;
  readonly readAt: Date | null;
}

export abstract class CommunicationRepository {
  abstract tips(): Promise<TipRow[]>;

  abstract insertNotice(
    notice: { id: string; title: string; body: string; sentBy: string; sentAt: Date },
    userIds: readonly string[],
  ): Promise<void>;
  abstract noticesOf(userId: string, unreadOnly: boolean): Promise<NoticeView[]>;
  abstract unreadCount(userId: string): Promise<number>;
  /** False when the user is not a recipient. */
  abstract markRead(noticeId: string, userId: string, at: Date): Promise<boolean>;
  abstract sentNotices(): Promise<(Omit<NoticeView, 'readAt'> & { recipients: number; read: number })[]>;

  abstract insertChat(chat: ChatRow): Promise<void>;
  abstract chatForUpdate(id: string): Promise<ChatRow | null>;
  abstract chat(id: string): Promise<ChatRow | null>;
  abstract chats(filter: { patientId?: string; status?: 'open' | 'closed'; assignedTo?: string }): Promise<ChatRow[]>;
  abstract updateChat(
    id: string,
    changes: Partial<Omit<ChatRow, 'id' | 'patientId'>> & { closedBy?: string | null },
  ): Promise<void>;
  abstract insertMessage(message: MessageRow & { chatId: string }): Promise<void>;
  abstract messages(chatId: string, after: Date | null): Promise<MessageRow[]>;
  /** Messages of a side (sent after the moment) per chat. */
  abstract unread(
    chatIds: readonly string[],
    sender: 'patient' | 'staff',
    reads: ReadonlyMap<string, Date | null>,
  ): Promise<Map<string, number>>;
}
