import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { commandForM1Retry, createM1PendingCommand } from "../lib/admin/m1-pending-command.ts";

const candidateModal = readFileSync(new URL("../app/components/domain-views/m-tabs/m1-overview.tsx", import.meta.url), "utf8");
const candidateAst = ts.createSourceFile("m1-overview.tsx", candidateModal, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const candidateComponent = candidateAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LoadConfigModal");
assert.ok(candidateComponent, "LoadConfigModal must exist");
const candidateCallbacks = new Map();
const visitCandidate = (node) => {
  if (ts.isFunctionDeclaration(node) && ["save", "rebalance"].includes(node.name?.text ?? "")) candidateCallbacks.set(node.name.text, node);
  ts.forEachChild(node, visitCandidate);
};
visitCandidate(candidateComponent);
assert.equal(candidateCallbacks.size, 2, "current modal must retain both callbacks");

function makeLoadProps(version, busy, agentVersion, total, util, enabled = true) {
  return {
    loadCfg: { version, autoBalance: false, defaultCap: 8, burstCap: 12, warnPct: 80, quietHourBalance: false, overflowQueue: "standby" },
    rows: [{ id: "2", name: "M5 agent", cap: 4, busy, enabled, total, util, agent: { version: agentVersion } }],
  };
}

function executeCandidateCallback(kind, props, draft, refs, setParam) {
  const callback = candidateCallbacks.get(kind);
  const callbackJs = ts.transpileModule(callback.getText(candidateAst), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const factory = new Function("reasonOk", "saving", "reason", "loadCfg", "rows", "autoBalance", "quietHour", "defaultCap", "burstCap", "warnPct", "overflow", "caps", "busyMap", "clamp", "ctx", "setSaving", "setWriteOutcomeUnknown", "setNoChangeMessage", "onClose", "pendingCommandRef", "editBaselineRef", "commandInFlightRef", "commandForM1Retry", "createM1PendingCommand", callbackJs + "; return " + kind + ";");
  const callbackFn = factory(
    true, null, draft.reason, props.loadCfg, props.rows,
    draft.autoBalance, draft.quietHour, draft.defaultCap, draft.burstCap, draft.warnPct, draft.overflow, draft.caps, draft.busyMap,
    (value, lo, hi) => String(Math.max(lo, Math.min(hi, Math.round(Number(value) || 0)))),
    { setParam, toast() {} }, () => {}, () => {}, () => {}, () => {},
    refs.pending, refs.baseline, refs.inFlight, commandForM1Retry, createM1PendingCommand,
  );
  return callbackFn();
}

function makeRefs(initial) {
  return { pending: { current: null }, baseline: { current: initial }, inFlight: { current: false } };
}

const draft = { reason: "M1 retry fixture reason", autoBalance: false, quietHour: false, defaultCap: "8", burstCap: "12", warnPct: "80", overflow: "standby", caps: { "2": "5" }, busyMap: { "2": false } };

test("current save callback fixes its command before await and retries the frozen bytes after catch-reload", async () => {
  const initial = makeLoadProps(7, false, 11, 2, 50);
  const refs = makeRefs(initial);
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  const first = executeCandidateCallback("save", initial, draft, refs, async () => waiting);
  await Promise.resolve();
  assert.ok(refs.pending.current, "pending command is stored before transport settles");
  assert.equal(refs.inFlight.current, true, "input guard is live while transport awaits");
  release(false);
  await first;
  assert.equal(refs.inFlight.current, false);
  const firstCommand = refs.pending.current;
  const attempts = [];
  const reloaded = makeLoadProps(8, true, 12, 2, 50);
  await executeCandidateCallback("save", reloaded, draft, refs, async (key, value, meta) => { attempts.push({ key, value, meta }); return false; });
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].value, firstCommand.value);
  assert.equal(attempts[0].meta.reason, firstCommand.reason);
  assert.equal(attempts[0].meta.commandKey, firstCommand.key);
  assert.doesNotMatch(attempts[0].value, /"busy":false/, "a newer M5 busy state is not folded into the frozen draft");
});

test("current rebalance callback keeps its original workload snapshot and parent baseline after catch-reload", async () => {
  const initial = makeLoadProps(7, false, 11, 2, 50);
  const refs = makeRefs(initial);
  await executeCandidateCallback("rebalance", initial, draft, refs, async () => false);
  const firstCommand = refs.pending.current;
  const reloaded = makeLoadProps(8, true, 12, 3, 75);
  const attempts = [];
  await executeCandidateCallback("rebalance", reloaded, draft, refs, async (key, value, meta) => { attempts.push({ key, value, meta }); return false; });
  assert.equal(attempts[0].value, firstCommand.value);
  assert.equal(attempts[0].meta.commandKey, firstCommand.key);
  assert.match(firstCommand.value, /"total":2/);
  assert.doesNotMatch(attempts[0].value, /"total":3/);
  const view = readFileSync(new URL("../app/components/domain-views/m-view.tsx", import.meta.url), "utf8");
  assert.match(view, /rebalanceLoad\(parseRows<Record<string, unknown>>\(value\), data\.loadConfig\.version/);
});

test("unknown result permits cancel and a reopened modal uses the fresh baseline", async () => {
  const initial = makeLoadProps(7, false, 11, 2, 50);
  const oldRefs = makeRefs(initial);
  await executeCandidateCallback("save", initial, draft, oldRefs, async () => false);
  assert.ok(oldRefs.pending.current);
  // Closing discards this modal's refs; reopening begins from the authoritative post-reload version.
  const reloaded = makeLoadProps(8, true, 12, 3, 75);
  const reopenedRefs = makeRefs(reloaded);
  const attempts = [];
  await executeCandidateCallback("save", reloaded, draft, reopenedRefs, async (key, value, meta) => { attempts.push({ key, value, meta }); return false; });
  assert.match(attempts[0].value, /"expectedVersion":8/);
  assert.notEqual(attempts[0].meta.commandKey, oldRefs.pending.current.key);
  assert.match(candidateModal, /onClose=\{\(\) => \{ if \(!commandInFlightRef\.current\) onClose\(\); \}\}/);
  assert.match(candidateModal, /onClick=\{\(\) => \{ if \(!commandInFlightRef\.current\) onClose\(\); \}\} disabled=\{Boolean\(saving\)\}/);
});
test("unknown M1 command blocks a different action; close/reopen intentionally starts a fresh command", () => {
  const first = createM1PendingCommand("config", '{"expectedVersion":7}', "M1 坐席负载调度", "M1 retry fixture reason", "fixture-1");
  assert.equal(commandForM1Retry(first, "rebalance", () => createM1PendingCommand("rebalance", "[]", "M1 坐席负载手动均衡", "M1 retry fixture reason", "fixture-2")), null);
  const reopened = commandForM1Retry(null, "config", () => createM1PendingCommand("config", '{"expectedVersion":8}', "M1 坐席负载调度", "M1 retry fixture reason", "fixture-3"));
  assert.notEqual(reopened?.key, first.key);
});

test("disabled M5 profile is visibly unavailable and its availability switch cannot be written", () => {
  assert.match(candidateModal, /r\.enabled \? \(busyMap\[r\.id\] \? "暂停接派单" : "接派单中"\) : "未启用"/);
  assert.match(candidateModal, /aria-disabled=\{!r\.enabled \|\| inputsLocked\}/);
  assert.match(candidateModal, /pointerEvents: r\.enabled && !inputsLocked \? undefined : "none"/);
  assert.match(candidateModal, /on=\{r\.enabled && !busyMap\[r\.id\]\}/);
  assert.match(candidateModal, /if \(r\.enabled && !commandInFlightRef\.current && !writeOutcomeUnknown\)/);
});