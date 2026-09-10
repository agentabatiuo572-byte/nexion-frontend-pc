import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldStartM3ConversationRecovery } from "../lib/admin/m-conversation-recovery-gate.ts";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("M3 unavailable snapshot starts only the read recovery channel", () => {
  // The same state that renders M3 unavailable and disables all writes must
  // still start the read-only reconnect/reconcile loop.
  assert.equal(shouldStartM3ConversationRecovery({ hasM3ReadAuthority: true, hasMContentSnapshot: true, isMContentLoading: false }), true);
  assert.equal(shouldStartM3ConversationRecovery({ hasM3ReadAuthority: false, hasMContentSnapshot: true, isMContentLoading: false }), false);
  assert.equal(shouldStartM3ConversationRecovery({ hasM3ReadAuthority: true, hasMContentSnapshot: false, isMContentLoading: false }), false);
  assert.equal(shouldStartM3ConversationRecovery({ hasM3ReadAuthority: true, hasMContentSnapshot: true, isMContentLoading: true }), false);
});

test("M3 wires recovery separately from the fail-closed write guard", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(view, /shouldStartM3ConversationRecovery/);
  assert.match(view, /enabled:\s*m3RecoveryEnabled/);
  assert.match(view, /conversationsAvailable:\s*true/);
  assert.match(sessions, /!canWriteM3 \|\| !conversationsAvailable/);
});
