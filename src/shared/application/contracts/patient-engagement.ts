export interface PublishedTip {
  readonly id: string;
  readonly title: string;
  readonly titleBn: string | null;
  readonly summary: string | null;
  readonly summaryBn: string | null;
  readonly body: string;
  readonly bodyBn: string | null;
  readonly category: string | null;
  readonly imageUrl: string | null;
  readonly isPinned: boolean;
}

export interface PatientChatSummary {
  readonly id: string;
  readonly topic: string;
  readonly status: 'open' | 'closed';
  readonly startedAt: Date;
  readonly lastMessageAt: Date;
  /** Staff messages the patient has not read. */
  readonly unread: number;
}

export interface ChatMessage {
  readonly id: string;
  readonly sender: 'patient' | 'staff';
  readonly senderName: string;
  readonly text: string;
  readonly sentAt: Date;
}

/**
 * Health tips and live chat as the patient portal offers them, published by the communication module so that the
 * portal never reads its tables. Every call is for the signed-in patient; a chat of another patient is not found.
 */
export abstract class PatientEngagement {
  /** Tips in their publishing window, pinned first. */
  abstract publishedTips(category: string | null): Promise<PublishedTip[]>;
  abstract chats(patientId: string): Promise<PatientChatSummary[]>;
  abstract startChat(patientId: string, topic: string, text: string): Promise<{ id: string }>;
  /** Messages after the moment given (all when null), oldest first; the patient has then read the staff's. */
  abstract messages(patientId: string, chatId: string, after: Date | null): Promise<ChatMessage[]>;
  abstract send(patientId: string, chatId: string, text: string): Promise<{ id: string }>;
}
