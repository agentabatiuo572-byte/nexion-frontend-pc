export interface EnterKeyLikeEvent {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  nativeEvent?: { isComposing?: boolean };
}

/**
 * Chat composers use Enter as the primary send key.
 * Shift+Enter remains available for a newline, while IME composition and
 * key-repeat are ignored so one physical confirmation cannot submit twice.
 */
export function shouldSendOnEnter(event: EnterKeyLikeEvent): boolean {
  return event.key === "Enter"
    && !event.shiftKey
    && !event.altKey
    && !event.repeat
    && !event.isComposing
    && !event.nativeEvent?.isComposing;
}
