import { DomainError } from '../../../shared/domain/errors.js';

/** A patient keeps at most this many chats open at once. */
export const OPEN_CHATS = 3;
/** A notice goes to at most this many users. */
export const NOTICE_RECIPIENTS = 2000;

export function text(value: string | null | undefined, max: number, what: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed.length > max) throw new DomainError('invalid_text', `The ${what} is at most ${max} characters`);
  return trimmed === '' ? null : trimmed;
}

export function required(value: string | null | undefined, max: number, what: string): string {
  const kept = text(value, max, what);
  if (!kept) throw new DomainError('invalid_text', `Give the ${what}`);
  return kept;
}

/** A tip shows from its start (if any) until its end (if any), while active. */
export function isPublished(
  tip: { isActive: boolean; publishFrom: Date | null; publishTo: Date | null },
  now: Date,
): boolean {
  return (
    tip.isActive &&
    (tip.publishFrom === null || tip.publishFrom.getTime() <= now.getTime()) &&
    (tip.publishTo === null || now.getTime() < tip.publishTo.getTime())
  );
}

export interface ChatState {
  readonly status: 'open' | 'closed';
  readonly assignedTo: string | null;
}

/** A staff member answers an open chat that is theirs or nobody's (taking it); another's is taken over first. */
export function assertMayAnswer(chat: ChatState, userId: string): void {
  if (chat.status !== 'open') throw new DomainError('chat_closed', 'The chat is closed');
  if (chat.assignedTo && chat.assignedTo !== userId) {
    throw new DomainError('not_your_chat', 'Another staff member has this chat; take it over first');
  }
}
