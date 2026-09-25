import type { CurrentUser, Message, User } from '@/src/types';

function matches(id: unknown, user: User) {
  return id != null && String(id) === String(user.id);
}

export function belongsToConversation(message: Message, me: CurrentUser, other: User) {
  return (matches(message.senderId, me) && matches(message.receiverId, other)) ||
    (matches(message.senderId, other) && matches(message.receiverId, me));
}

export function parseMessage(body: string): Message | null {
  try {
    const message = JSON.parse(body);
    if (!message || message.id == null || typeof message.content !== 'string' ||
        typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp)) ||
        message.senderId == null || message.receiverId == null) return null;
    return message;
  } catch {
    return null;
  }
}

export function mergeMessages(history: Message[], live: Message[]) {
  const messages = new Map(history.map(message => [String(message.id), message]));
  for (const message of live) messages.set(String(message.id), message);
  return [...messages.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
