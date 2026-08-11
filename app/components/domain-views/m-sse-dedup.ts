export type MMessageIdentity = {
  id?: number;
  ts: number;
  text: string;
};

export type MMessageEventIdentity = {
  messageId?: number;
  ts: number;
  body: string;
};

/** Persistent ids are authoritative; timestamp/body is compatibility-only for legacy events. */
export function containsConversationMessage(
  messages: readonly MMessageIdentity[],
  event: MMessageEventIdentity,
): boolean {
  return event.messageId != null
    ? messages.some((message) => message.id === event.messageId)
    : messages.some((message) => message.ts === event.ts && message.text === event.body);
}
