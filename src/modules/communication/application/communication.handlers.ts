import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import type { Actor } from '../../../shared/application/actor.js';
import { AccessControl } from '../../../shared/application/contracts/access-control.js';
import {
  PatientEngagement,
  type ChatMessage,
  type PatientChatSummary,
  type PublishedTip,
} from '../../../shared/application/contracts/patient-engagement.js';
import { PatientDirectory } from '../../../shared/application/contracts/patient-directory.js';
import { UserDirectory } from '../../../shared/application/contracts/user-directory.js';
import { Clock } from '../../../shared/application/ports/clock.js';
import { TransactionManager } from '../../../shared/application/ports/transaction-manager.js';
import { DomainError, NotFoundError } from '../../../shared/domain/errors.js';
import { assertMayAnswer, isPublished, NOTICE_RECIPIENTS, OPEN_CHATS, required } from '../domain/communication.js';
import {
  CHAT_ANSWER,
  CommunicationRepository,
  NOTICE_SEND,
  type ChatRow,
  type MessageRow,
  type NoticeView,
} from './communication.ports.js';

const TOPIC_MAX = 150;
const MESSAGE_MAX = 2000;

@Injectable()
export class CommunicationDesk {
  constructor(
    readonly access: AccessControl,
    readonly tx: TransactionManager,
    readonly clock: Clock,
    readonly store: CommunicationRepository,
    readonly patients: PatientDirectory,
    readonly users: UserDirectory,
  ) {}

  /** Messages with the names of who sent them: the patient's name, or the staff member's. */
  async named(chat: ChatRow, rows: readonly MessageRow[]): Promise<ChatMessage[]> {
    const patient = (await this.patients.find([chat.patientId])).get(chat.patientId);
    const staffIds = [...new Set(rows.flatMap((row) => (row.senderUserId ? [row.senderUserId] : [])))];
    const staff = new Map((staffIds.length ? await this.users.findSummaries(staffIds) : []).map((u) => [u.id, u]));
    return rows.map(({ senderUserId, ...row }) => ({
      ...row,
      senderName: senderUserId ? (staff.get(senderUserId)?.displayName ?? 'Staff') : (patient?.name ?? 'Patient'),
    }));
  }

  async post(chatId: string, sender: 'patient' | 'staff', senderUserId: string | null, text: string) {
    const id = randomUUID();
    const now = this.clock.now();
    await this.store.insertMessage({
      id,
      chatId,
      sender,
      senderUserId,
      text: required(text, MESSAGE_MAX, 'message'),
      sentAt: now,
    });
    // Whoever writes has read everything before it.
    await this.store.updateChat(chatId, {
      lastMessageAt: now,
      ...(sender === 'patient' ? { patientReadAt: now } : { staffReadAt: now }),
    });
    return { id };
  }
}

/** Patients' side: published tips and their own chats (the portal's routes call it). */
@Injectable()
export class CommunicationEngagement extends PatientEngagement {
  constructor(private readonly desk: CommunicationDesk) {
    super();
  }

  async publishedTips(category: string | null): Promise<PublishedTip[]> {
    const now = this.desk.clock.now();
    return (await this.desk.store.tips())
      .filter((tip) => isPublished(tip, now) && (category === null || tip.category === category))
      .sort((a, b) => Number(b.isPinned) - Number(a.isPinned) || a.displayOrder - b.displayOrder)
      .map(({ isActive: _a, publishFrom: _f, publishTo: _t, displayOrder: _o, ...tip }) => tip);
  }

  async chats(patientId: string): Promise<PatientChatSummary[]> {
    const rows = await this.desk.store.chats({ patientId });
    const unread = await this.desk.store.unread(
      rows.map((row) => row.id),
      'staff',
      new Map(rows.map((row) => [row.id, row.patientReadAt])),
    );
    return rows.map((row) => ({
      id: row.id,
      topic: row.topic,
      status: row.status,
      startedAt: row.startedAt,
      lastMessageAt: row.lastMessageAt,
      unread: unread.get(row.id) ?? 0,
    }));
  }

  async startChat(patientId: string, topic: string, text: string) {
    const { desk } = this;
    const subject = required(topic, TOPIC_MAX, 'topic');
    return desk.tx.run(async () => {
      await desk.tx.lock(`comm:chats:${patientId}`);
      const open = await desk.store.chats({ patientId, status: 'open' });
      if (open.length >= OPEN_CHATS) {
        throw new DomainError('too_many_chats', `At most ${OPEN_CHATS} chats are open at once; close one first`);
      }
      const now = desk.clock.now();
      const id = randomUUID();
      await desk.store.insertChat({
        id,
        patientId,
        topic: subject,
        status: 'open',
        assignedTo: null,
        startedAt: now,
        lastMessageAt: now,
        patientReadAt: now,
        staffReadAt: null,
        closedAt: null,
      });
      await desk.post(id, 'patient', null, text);
      return { id };
    });
  }

  private async own(patientId: string, chatId: string): Promise<ChatRow> {
    const chat = await this.desk.store.chat(chatId);
    if (!chat || chat.patientId !== patientId) throw new NotFoundError('chat');
    return chat;
  }

  async messages(patientId: string, chatId: string, after: Date | null) {
    const chat = await this.own(patientId, chatId);
    const rows = await this.desk.store.messages(chatId, after);
    await this.desk.store.updateChat(chatId, { patientReadAt: this.desk.clock.now() });
    return this.desk.named(chat, rows);
  }

  async send(patientId: string, chatId: string, text: string) {
    const { desk } = this;
    return desk.tx.run(async () => {
      await this.own(patientId, chatId);
      const chat = (await desk.store.chatForUpdate(chatId))!;
      if (chat.status !== 'open') throw new DomainError('chat_closed', 'The chat is closed; start another');
      return desk.post(chatId, 'patient', null, text);
    });
  }
}

export interface NoticeInput {
  readonly title: string;
  readonly body: string;
  readonly userIds: string[];
  readonly roleIds: string[];
}

export class SendNoticeCommand extends Command<{ id: string; recipients: number }> {
  constructor(
    readonly actor: Actor,
    readonly input: NoticeInput,
  ) {
    super();
  }
}

export class ReadNoticeCommand extends Command<void> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
  ) {
    super();
  }
}

export class MyNoticesQuery extends Query<{ items: NoticeView[]; unread: number }> {
  constructor(
    readonly actor: Actor,
    readonly unreadOnly: boolean,
  ) {
    super();
  }
}

export class SentNoticesQuery extends Query<unknown[]> {
  constructor(readonly actor: Actor) {
    super();
  }
}

export class StaffChatsQuery extends Query<unknown[]> {
  constructor(
    readonly actor: Actor,
    readonly status: 'open' | 'closed' | undefined,
    readonly mine: boolean,
  ) {
    super();
  }
}

export class StaffChatMessagesQuery extends Query<ChatMessage[]> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly after: Date | null,
  ) {
    super();
  }
}

export class ChatActionCommand extends Command<{ id?: string }> {
  constructor(
    readonly actor: Actor,
    readonly id: string,
    readonly action: 'take' | 'reply' | 'close',
    readonly text: string | null,
  ) {
    super();
  }
}

/**
 * Old Notification / NotificationSentTo: a notice to users chosen by name and by role (active users, each once), each
 * keeping their own read mark.
 */
@CommandHandler(SendNoticeCommand)
export class SendNoticeHandler implements ICommandHandler<SendNoticeCommand> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, input }: SendNoticeCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [NOTICE_SEND] });
    const title = required(input.title, 150, 'title');
    const body = required(input.body, 4000, 'notice');
    const wanted = [...new Set([...input.userIds, ...(await desk.access.usersWithRoles(input.roleIds))])];
    const active = (wanted.length ? await desk.users.findSummaries(wanted) : []).filter((user) => user.isActive);
    if (active.length === 0) throw new DomainError('no_recipients', 'Nobody active would receive the notice');
    if (active.length > NOTICE_RECIPIENTS) {
      throw new DomainError('too_many_recipients', `A notice goes to at most ${NOTICE_RECIPIENTS} users`);
    }
    const id = randomUUID();
    await desk.tx.run(() =>
      desk.store.insertNotice(
        { id, title, body, sentBy: actor.userId, sentAt: desk.clock.now() },
        active.map((user) => user.id),
      ),
    );
    return { id, recipients: active.length };
  }
}

@CommandHandler(ReadNoticeCommand)
export class ReadNoticeHandler implements ICommandHandler<ReadNoticeCommand> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, id }: ReadNoticeCommand): Promise<void> {
    if (!(await this.desk.store.markRead(id, actor.userId, this.desk.clock.now()))) throw new NotFoundError('notice');
  }
}

/** One's own notices (no permission needed): newest first, with the unread count. */
@QueryHandler(MyNoticesQuery)
export class MyNoticesHandler implements IQueryHandler<MyNoticesQuery> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, unreadOnly }: MyNoticesQuery) {
    return {
      items: await this.desk.store.noticesOf(actor.userId, unreadOnly),
      unread: await this.desk.store.unreadCount(actor.userId),
    };
  }
}

@QueryHandler(SentNoticesQuery)
export class SentNoticesHandler implements IQueryHandler<SentNoticesQuery> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor }: SentNoticesQuery) {
    await this.desk.access.authorize(actor.userId, { permissions: [NOTICE_SEND] });
    return this.desk.store.sentNotices();
  }
}

/** Old LiveChat agent list: chats by state (or the actor's own), with the patient and messages not read. */
@QueryHandler(StaffChatsQuery)
export class StaffChatsHandler implements IQueryHandler<StaffChatsQuery> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, status, mine }: StaffChatsQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CHAT_ANSWER] });
    const rows = await desk.store.chats({
      ...(status ? { status } : {}),
      ...(mine ? { assignedTo: actor.userId } : {}),
    });
    const patients = await desk.patients.find(rows.map((row) => row.patientId));
    const unread = await desk.store.unread(
      rows.map((row) => row.id),
      'patient',
      new Map(rows.map((row) => [row.id, row.staffReadAt])),
    );
    return rows.map(({ patientReadAt: _p, staffReadAt: _s, ...row }) => ({
      ...row,
      patientName: patients.get(row.patientId)?.name ?? '',
      uhid: patients.get(row.patientId)?.uhid ?? null,
      unread: unread.get(row.id) ?? 0,
    }));
  }
}

@QueryHandler(StaffChatMessagesQuery)
export class StaffChatMessagesHandler implements IQueryHandler<StaffChatMessagesQuery> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, id, after }: StaffChatMessagesQuery) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CHAT_ANSWER] });
    const chat = await desk.store.chat(id);
    if (!chat) throw new NotFoundError('chat');
    const rows = await desk.store.messages(id, after);
    if (!chat.assignedTo || chat.assignedTo === actor.userId) {
      await desk.store.updateChat(id, { staffReadAt: desk.clock.now() });
    }
    return desk.named(chat, rows);
  }
}

/**
 * A staff member takes a chat (over), replies (an unassigned chat becomes theirs; another's is taken over first) or
 * closes theirs.
 */
@CommandHandler(ChatActionCommand)
export class ChatActionHandler implements ICommandHandler<ChatActionCommand> {
  constructor(private readonly desk: CommunicationDesk) {}

  async execute({ actor, id, action, text }: ChatActionCommand) {
    const { desk } = this;
    await desk.access.authorize(actor.userId, { permissions: [CHAT_ANSWER] });
    return desk.tx.run(async () => {
      const chat = await desk.store.chatForUpdate(id);
      if (!chat) throw new NotFoundError('chat');
      if (action === 'take') {
        if (chat.status !== 'open') throw new DomainError('chat_closed', 'The chat is closed');
        await desk.store.updateChat(id, { assignedTo: actor.userId });
        return {};
      }
      assertMayAnswer(chat, actor.userId);
      if (!chat.assignedTo) await desk.store.updateChat(id, { assignedTo: actor.userId });
      if (action === 'reply') return desk.post(id, 'staff', actor.userId, text ?? '');
      await desk.store.updateChat(id, { status: 'closed', closedAt: desk.clock.now(), closedBy: actor.userId });
      return {};
    });
  }
}

export const COMMUNICATION_HANDLERS = [
  CommunicationDesk,
  SendNoticeHandler,
  ReadNoticeHandler,
  MyNoticesHandler,
  SentNoticesHandler,
  StaffChatsHandler,
  StaffChatMessagesHandler,
  ChatActionHandler,
];
