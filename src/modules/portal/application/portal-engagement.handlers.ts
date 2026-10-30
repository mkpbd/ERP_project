import { Command, CommandHandler, Query, QueryHandler, type ICommandHandler, type IQueryHandler } from '@nestjs/cqrs';
import {
  PatientEngagement,
  type ChatMessage,
  type PatientChatSummary,
  type PublishedTip,
} from '../../../shared/application/contracts/patient-engagement.js';
import type { PortalClaims } from './portal.ports.js';

export class PortalTipsQuery extends Query<PublishedTip[]> {
  constructor(readonly category: string | null) {
    super();
  }
}

export class PortalChatsQuery extends Query<PatientChatSummary[]> {
  constructor(readonly patient: PortalClaims) {
    super();
  }
}

export class PortalChatMessagesQuery extends Query<ChatMessage[]> {
  constructor(
    readonly patient: PortalClaims,
    readonly chatId: string,
    readonly after: Date | null,
  ) {
    super();
  }
}

export class PortalStartChatCommand extends Command<{ id: string }> {
  constructor(
    readonly patient: PortalClaims,
    readonly topic: string,
    readonly text: string,
  ) {
    super();
  }
}

export class PortalSendChatCommand extends Command<{ id: string }> {
  constructor(
    readonly patient: PortalClaims,
    readonly chatId: string,
    readonly text: string,
  ) {
    super();
  }
}

/** Health tips being published (no sign-in), through PatientEngagement. */
@QueryHandler(PortalTipsQuery)
export class PortalTipsHandler implements IQueryHandler<PortalTipsQuery> {
  constructor(private readonly engagement: PatientEngagement) {}

  execute({ category }: PortalTipsQuery) {
    return this.engagement.publishedTips(category);
  }
}

/** The signed-in patient's chats with the hospital (old LiveChat), through PatientEngagement. */
@QueryHandler(PortalChatsQuery)
export class PortalChatsHandler implements IQueryHandler<PortalChatsQuery> {
  constructor(private readonly engagement: PatientEngagement) {}

  execute({ patient }: PortalChatsQuery) {
    return this.engagement.chats(patient.patientId);
  }
}

@QueryHandler(PortalChatMessagesQuery)
export class PortalChatMessagesHandler implements IQueryHandler<PortalChatMessagesQuery> {
  constructor(private readonly engagement: PatientEngagement) {}

  execute({ patient, chatId, after }: PortalChatMessagesQuery) {
    return this.engagement.messages(patient.patientId, chatId, after);
  }
}

@CommandHandler(PortalStartChatCommand)
export class PortalStartChatHandler implements ICommandHandler<PortalStartChatCommand> {
  constructor(private readonly engagement: PatientEngagement) {}

  execute({ patient, topic, text }: PortalStartChatCommand) {
    return this.engagement.startChat(patient.patientId, topic, text);
  }
}

@CommandHandler(PortalSendChatCommand)
export class PortalSendChatHandler implements ICommandHandler<PortalSendChatCommand> {
  constructor(private readonly engagement: PatientEngagement) {}

  execute({ patient, chatId, text }: PortalSendChatCommand) {
    return this.engagement.send(patient.patientId, chatId, text);
  }
}

export const PORTAL_ENGAGEMENT_HANDLERS = [
  PortalTipsHandler,
  PortalChatsHandler,
  PortalChatMessagesHandler,
  PortalStartChatHandler,
  PortalSendChatHandler,
];
