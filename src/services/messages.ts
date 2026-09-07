import type { Message, User } from '@/src/types';

function matches(id: unknown, email: unknown, user: User) {
  return (id != null && String(id) === String(user.id)) ||
    (typeof email === 'string' && email.length > 0 && email === user.email);
}

export function belongsToConversation(message: Message, me: User, other: User) {
  return (matches(message.senderId, message.senderEmail, me) && matches(message.receiverId, message.receiverEmail, other)) ||
    (matches(message.senderId, message.senderEmail, other) && matches(message.receiverId, message.receiverEmail, me));
}

export function parseMessage(body: string): Message | null {
  try {
    const message = JSON.parse(body);
    if (!message || message.id == null || typeof message.content !== 'string' ||
        typeof message.timestamp !== 'string' || !Number.isFinite(Date.parse(message.timestamp)) ||
        (message.senderId == null && typeof message.senderEmail !== 'string') ||
        (message.receiverId == null && typeof message.receiverEmail !== 'string')) return null;
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
