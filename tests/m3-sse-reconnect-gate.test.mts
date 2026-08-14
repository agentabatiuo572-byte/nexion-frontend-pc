import test from "node:test";
import assert from "node:assert/strict";
import {
  ConversationReconnectGate,
  isTerminalConversationStreamStatus,
} from "../lib/admin/conversation-stream-recovery.ts";
import { containsConversationMessage } from "../app/components/domain-views/m-sse-dedup.ts";

type Event = { messageId: number; ts: number; body: string };

test("reconnect buffers live events until the authoritative list/detail snapshot is applied", async () => {
  const gate = new ConversationReconnectGate<Event>();
  const delivered: Event[] = [];
  const reconnect = gate.begin();

  await gate.accept({ messageId: 42, ts: 2, body: "arrived while snapshot loaded" }, (event) => { delivered.push(event); });
  assert.equal(delivered.length, 0, "the UI must not claim or consume a live stream before reconciliation");

  assert.equal(await gate.complete(reconnect, (event) => { delivered.push(event); }), true);
  assert.deepEqual(delivered.map((event) => event.messageId), [42]);
});

test("snapshot message ids make a buffered replay idempotent", async () => {
  const gate = new ConversationReconnectGate<Event>();
  const reconnect = gate.begin();
  const snapshot = [{ id: 42, ts: 1, text: "arrived while disconnected" }];
  const appended: Event[] = [];

  await gate.accept({ messageId: 42, ts: 2, body: "arrived while disconnected" }, (event) => { appended.push(event); });
  await gate.complete(reconnect, (event) => {
    if (!containsConversationMessage(snapshot, event)) appended.push(event);
  });

  assert.deepEqual(appended, []);
});

test("page cleanup invalidates an in-flight snapshot and drops queued events", async () => {
  const gate = new ConversationReconnectGate<Event>();
  const reconnect = gate.begin();
  const delivered: Event[] = [];
  await gate.accept({ messageId: 9, ts: 9, body: "late" }, (event) => { delivered.push(event); });

  gate.cancel();

  assert.equal(await gate.complete(reconnect, (event) => { delivered.push(event); }), false);
  assert.deepEqual(delivered, []);
});

test("queue overflow fails the connection so a fresh snapshot can recover without dropping silently", async () => {
  const gate = new ConversationReconnectGate<Event>(1);
  gate.begin();
  assert.equal(await gate.accept({ messageId: 1, ts: 1, body: "first" }, () => undefined), true);
  assert.equal(await gate.accept({ messageId: 2, ts: 2, body: "overflow" }, () => undefined), false);
});

test("ready-state events remain ordered while an authoritative refresh is in flight", async () => {
  const gate = new ConversationReconnectGate<Event>();
  const order: string[] = [];
  let releaseRefresh!: () => void;
  const refresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });

  const status = gate.accept({ messageId: 1, ts: 1, body: "status" }, async () => {
    order.push("status:start");
    await refresh;
    order.push("status:end");
  });
  const message = gate.accept({ messageId: 2, ts: 2, body: "message" }, () => {
    order.push("message");
  });

  await Promise.resolve();
  assert.deepEqual(order, ["status:start"]);
  releaseRefresh();
  await Promise.all([status, message]);
  assert.deepEqual(order, ["status:start", "status:end", "message"]);
});

test("disconnect cancellation prevents an old connection snapshot from committing", async () => {
  const gate = new ConversationReconnectGate<Event>();
  const connection = new AbortController();
  let releaseSnapshot!: () => void;
  const snapshot = new Promise<void>((resolve) => { releaseSnapshot = resolve; });
  const applied: string[] = [];

  const delivery = gate.accept({ messageId: 1, ts: 1, body: "status" }, async () => {
    await snapshot;
    if (!connection.signal.aborted) applied.push("old snapshot");
  });

  connection.abort();
  gate.cancel();
  releaseSnapshot();
  await delivery;

  assert.deepEqual(applied, []);
});

test("401 and 403 are terminal stream authorization outcomes", () => {
  assert.equal(isTerminalConversationStreamStatus(401), true);
  assert.equal(isTerminalConversationStreamStatus(403), true);
  assert.equal(isTerminalConversationStreamStatus(204), false);
  assert.equal(isTerminalConversationStreamStatus(503), false);
});
