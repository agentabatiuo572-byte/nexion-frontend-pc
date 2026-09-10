import assert from "node:assert/strict";
import test from "node:test";
import { clearPendingCommandRecords } from "../lib/admin/pending-mutation-store.ts";

const snapshot = { eventId: "reload-h3-event", retryCount: 4, deliveryStatus: "DEAD", deliveryAttemptCount: 7 };

test("A4 redrive retains the exact command through a module reload and clears only after a receipt", async () => {
  const previousWindow = globalThis.window;
  const rows = new Map();
  globalThis.window = { sessionStorage: { getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key), get length() { return rows.size; }, key: index => [...rows.keys()][index] ?? null } };
  clearPendingCommandRecords();
  try {
    let issued = 0;
    const sent = [];
    const mint = () => `reload-key-${++issued}`;
    const lost = async command => { sent.push(command); throw new Error("response lost"); };
    const first = await import("../lib/admin/a4-redrive-command.ts?before-reload");
    await assert.rejects(first.runH3DeadOutboxRedriveCommand({ current: null }, snapshot, "audit reason", mint, lost));
    const reloaded = await import("../lib/admin/a4-redrive-command.ts?after-reload");
    await assert.rejects(reloaded.runH3DeadOutboxRedriveCommand({ current: null }, snapshot, "audit reason", mint, lost));
    assert.deepEqual(sent[1], sent[0], "a new React ref and module must preserve the original HTTP key and body");
    const acknowledged = await reloaded.runH3DeadOutboxRedriveCommand({ current: null }, snapshot, "audit reason", mint, async command => command);
    assert.deepEqual(acknowledged, sent[0]);
    await assert.rejects(reloaded.runH3DeadOutboxRedriveCommand({ current: null }, snapshot, "audit reason", mint, lost));
    assert.notEqual(sent[2].commandKey, sent[0].commandKey, "a completed command must not be replayed for a new operation");
    await assert.rejects(reloaded.runH3DeadOutboxRedriveCommand({ current: null }, snapshot, "different audit reason", mint, lost));
    assert.notEqual(sent[3].commandKey, sent[2].commandKey);
    await assert.rejects(reloaded.runH3DeadOutboxRedriveCommand({ current: null }, { ...snapshot, deliveryAttemptCount: 8 }, "different audit reason", mint, lost));
    assert.notEqual(sent[4].commandKey, sent[3].commandKey);
  } finally {
    clearPendingCommandRecords();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
