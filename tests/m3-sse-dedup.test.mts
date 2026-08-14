import test from "node:test";
import assert from "node:assert/strict";
import { containsConversationMessage } from "../app/components/domain-views/m-sse-dedup.ts";

test("authoritative reload followed by the same SSE message does not append a duplicate", () => {
  const reloaded = [{ id: 77, ts: 1_723_344_000_000, text: "hello" }];

  assert.equal(containsConversationMessage(reloaded, {
    messageId: 77,
    ts: 1_723_344_000_999,
    body: "hello",
  }), true);
});

test("different persistent ids are not collapsed even when timestamp and body match", () => {
  const reloaded = [{ id: 77, ts: 1_723_344_000_000, text: "hello" }];

  assert.equal(containsConversationMessage(reloaded, {
    messageId: 78,
    ts: 1_723_344_000_000,
    body: "hello",
  }), false);
});

test("legacy events without messageId retain timestamp and body fallback", () => {
  const reloaded = [{ ts: 1_723_344_000_000, text: "legacy" }];

  assert.equal(containsConversationMessage(reloaded, {
    ts: 1_723_344_000_000,
    body: "legacy",
  }), true);
});

test("two equal-body persisted events keep both ids and replay neither after reload", () => {
  const events = [
    { messageId: 78, ts: 2, body: "hello" },
    { messageId: 77, ts: 1, body: "hello" },
  ];
  const live: Array<{ id?: number; ts: number; text: string }> = [];
  for (const event of events) {
    if (!containsConversationMessage(live, event)) {
      live.push({ id: event.messageId, ts: event.ts, text: event.body });
    }
  }
  assert.deepEqual(live.map((message) => message.id), [78, 77]);

  const reloaded = [
    { id: 77, ts: 1, text: "hello" },
    { id: 78, ts: 2, text: "hello" },
  ];
  assert.equal(events.filter((event) => !containsConversationMessage(reloaded, event)).length, 0);
});
