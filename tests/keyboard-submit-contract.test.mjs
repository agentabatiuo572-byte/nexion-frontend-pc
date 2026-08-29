import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { shouldSendOnEnter } from "../lib/keyboard-submit.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("single-line Enter sends while Shift+Enter, IME composition and repeats do not", () => {
  assert.equal(shouldSendOnEnter({ key: "Enter" }), true);
  assert.equal(shouldSendOnEnter({ key: "Enter", ctrlKey: true }), true);
  assert.equal(shouldSendOnEnter({ key: "Enter", metaKey: true }), true);
  assert.equal(shouldSendOnEnter({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", nativeEvent: { isComposing: true } }), false);
  assert.equal(shouldSendOnEnter({ key: "Enter", repeat: true }), false);
  assert.equal(shouldSendOnEnter({ key: "a" }), false);
});

test("PC login keeps native form submission for every authentication stage", () => {
  const login = read("app/components/shell/login-gate.tsx");
  assert.match(login, /<form[\s\S]*onSubmit=/);
  assert.match(login, /type="submit"/);
  assert.match(login, /role="alert" aria-live="polite"/);
  assert.equal((login.match(/submissionInFlight\.current/g) ?? []).length >= 6, true, "all three login stages need a synchronous submit lock");
});

test("persistent session dock preserves the M3 production authority and single-flight gates", () => {
  const dock = read("app/components/domain-views/m-view.tsx");
  assert.doesNotMatch(dock, /acceptanceMode|support-acceptance-sandbox/i,
    "M3 必须只保留开发/生产共用的服务端权威链，退役 Sandbox 模式不得回潮");
  assert.match(dock, /canWriteM3 && conversationsAvailable/);
  assert.match(dock, /sendInFlight\.current/);
  assert.match(dock, /commandKey: `m3:reply:/);
  assert.match(dock, /aria-label="发送会话回复"/);
  assert.match(dock, /disabled=\{!canWrite \|\| sending\}/, "Dock must freeze the draft while an acknowledged send is in flight");
});

test("all PC support composers use Enter to send and Shift+Enter to add a line", () => {
  for (const path of [
    "app/components/domain-views/m-tabs/m2-tickets.tsx",
    "app/components/domain-views/m-tabs/m3-sessions.tsx",
    "app/components/domain-views/m-view.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /shouldSendOnEnter\(e\)/, `${path} must use the shared Enter policy`);
    assert.match(source, /e\.preventDefault\(\)/, `${path} must suppress the newline only when sending`);
    assert.match(source, /Enter[^\n]*发送[^\n]*Shift\+Enter[^\n]*换行/, `${path} must explain the keyboard behavior`);
    assert.match(source, /aria-label=\{`回复(?:工单|会话)/, `${path} must expose a stable accessible name`);
  }
});
