export type M3ReplyDraft = { conversationNo: string | null; body: string };

export function m3DerivedSelected<T extends { id: string }>(selectedId: string, filtered: readonly T[]): T | null {
  return filtered.find((conversation) => conversation.id === selectedId) ?? filtered[0] ?? null;
}

export function m3VisibleReplyBody(draft: M3ReplyDraft, selectedNo: string | undefined): string {
  return selectedNo && draft.conversationNo === selectedNo ? draft.body : "";
}

export function m3ApplyReplyInput(conversationNo: string, body: string): M3ReplyDraft {
  return { conversationNo, body };
}

export function m3ReplySubmission(draft: M3ReplyDraft, selectedNo: string | undefined): { recipient: string; body: string } | null {
  const body = m3VisibleReplyBody(draft, selectedNo).trim();
  return selectedNo && body ? { recipient: selectedNo, body } : null;
}

export function m3ClearDeliveredDraft(draft: M3ReplyDraft, conversationNo: string, body: string): M3ReplyDraft {
  return draft.conversationNo === conversationNo && draft.body.trim() === body
    ? { ...draft, body: "" }
    : draft;
}
