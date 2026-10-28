import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { displayAdminError, formatAdminApiError } from "../lib/admin/error-messages.ts";
import { operationConfirmErrorMessage } from "../lib/admin/operation-confirm-error.ts";

const root = path.resolve(import.meta.dirname, "..");
const nodeRequire = createRequire(import.meta.url);

async function fixture(paused, canFund = true, rejectPayout = false, facts = {}) {
  const cache = new Map();
  let directRender = false, selectedPeriod = "week";
  const responseData = {
    domain: "F4", metrics: [], quotaRows: [], ambassadorBands: [], podium: [], voteWeights: [{ v: "V3", votes: 1 }],
    config: {}, commissionPolicy: {}, guardrails: [], sources: ["nx_team_member"],
    configValues: { "F.leaderboard.paused": paused ? "on" : "off" },
    leaderboardPeriodStatus: "active", leaderboardParticipantCount: 21,
    settlementConfigStatus: "READY",
    ...facts,
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", "module", output)((name) => {
      if (name === "react") return { ...React, useState: value => directRender ? [selectedPeriod, next => { selectedPeriod = next; }] : React.useState(value) };
      if (name.endsWith("auth-session")) return { isAdminAuthFailure: () => false, resetAdminSession: () => assert.fail("unexpected auth mutation") };
      if (name.endsWith("error-messages")) return {
        guardedFetch: async (url, options) => {
          if (url === "/api/admin/platform/audit/operations") {
            assert.equal(rejectPayout, true);
            assert.equal(options.method, "POST");
            assert.equal(JSON.parse(options.body).command.op, "f4_leaderboard_period_payout");
            return new Response(JSON.stringify({ code: 409, message: "F4_LEADERBOARD_PAUSED", data: null }), { status: 409 });
          }
          assert.equal(url, "/api/admin/teams/leadership-pool");
          assert.ok(!options.method || options.method === "GET");
          return new Response(JSON.stringify({ code: 0, data: responseData }), { status: 200 });
        },
        rawFetch: () => assert.fail("no API writes in fixture"), formatAdminApiError, displayAdminError,
      };
      if (!name.startsWith("@/") && !name.startsWith(".")) return nodeRequire(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      assert.ok(resolved, `missing dependency: ${name}`);
      return load(resolved);
    }, module.exports, module);
    return module.exports;
  }
  const overview = await load(path.join(root, "lib/admin/f1-client.ts")).fetchF4LeadershipPoolOverview();
  const ctx = {
    f4Overview: overview, can: (scope) => scope !== "network_f4_pool_fund" || canFund,
    f4AmbassadorPolicy: null, f4Loading: false, f4Error: null,
    openActionConfirm: () => {}, proposeF4LeaderboardPayout: async () => {},
  };
  const F4Ops = load(path.join(root, "app/components/domain-views/f-tabs/f4-ops.tsx")).F4Ops;
  return { ctx, library: (rel) => load(path.join(root, rel)),
    tree: () => { directRender = true; try { return F4Ops({ ctx }); } finally { directRender = false; } }, html: () => renderToStaticMarkup(React.createElement(F4Ops, { ctx })) };
}

function text(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join("");
  return text(node.props?.children);
}
function buttons(node, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { node.forEach((child) => buttons(child, found)); return found; }
  if (node.type === "button" && text(node) === "发放总榜奖励") found.push(node);
  buttons(node.props?.children, found);
  return found;
}

test("hardware quota names and adjustment titles use UVEL without changing raw identities or quotas", async () => {
  for (const [rawName, label] of [["NexGridBox Pro", "UVELBox Pro"], ["NEXGRIDRack P1", "UVELRack P1"], ["StellarBox S1", "UVELBox S1"], ["UVELRack P2", "UVELRack P2"]]) {
    const f = await fixture(false, true, false, {
      quotaRows: [{ id: 12, quotaCode: "HW-PRO", productNo: "stellarbox-pro", name: rawName, current: 2, cap: 200 }],
    });
    assert.ok(f.html().includes(label));
    assert.doesNotMatch(f.html(), /NexGrid|NEXGRID|StellarBox/);
    let action;
    f.ctx.openActionConfirm = value => { action = value; };
    const adjust = matching(f.tree(), node => node.type === "button" && text(node) === "调额度")[0];
    adjust.props.onClick();
    assert.equal(action.name, `${label} 月额度调整`);
    assert.equal(action.paramKey, "F.quota.tier.HW-PRO.monthlyQuota");
    assert.equal(action.expectedVersion, 200);
    assert.equal(action.edit.current, "200");
    assert.equal(f.ctx.f4Overview.quotaRows[0].name, rawName);
    assert.equal(f.ctx.f4Overview.quotaRows[0].productNo, "stellarbox-pro");
    assert.equal(f.ctx.f4Overview.quotaRows[0].current, 2);
  }
});

test("paused F4 disables manual payout despite active period status and explains maintenance", async () => {
  const f = await fixture(true);
  const [button] = buttons(f.tree());
  assert.ok(button, "authorized payout remains discoverable");
  assert.equal(button.props.disabled, true);
  assert.match(f.html(), /排行榜已暂停.*奖励暂停发放/);
});

test("a legacy pause hides live ranks and values instead of claiming a frozen podium", async () => {
  const f = await fixture(true, true, false, {
    leaderboardPoolLabel: "$987654", leaderboardParticipantCount: 765432,
    podium: [{ rank: 1, memberUserId: 77, userId: "U00000077", gmvLabel: "$900", tip: "本期 GV", className: "r-1" }],
  });
  assert.equal(f.ctx.f4Overview.leaderboardSnapshotState, "UNAVAILABLE");
  assert.equal(f.ctx.f4Overview.leaderboardDataAvailable, false);
  const html = f.html();
  assert.match(html, /暂停时的榜单数据未确认/);
  assert.doesNotMatch(html, /U00000077|987654|765,432/);
});

test("a factual frozen projection shows its recorded ranks and time, while live ignores stale pause metadata", async () => {
  const facts = {
    leaderboardSnapshotState: "FROZEN", leaderboardDataAvailable: true,
    leaderboardSnapshotId: "pause-fixture", leaderboardSnapshotAt: "2026-10-08T12:30:00Z",
    leaderboardPoolLabel: "$900", podium: [{ rank: 1, memberUserId: 77, userId: "U00000077", gmvLabel: "$900", tip: "冻结时 · 本期 GV", className: "r-1" }],
  };
  facts.leaderboardPeriods = { ...periodFacts(), week: { ...periodFacts().week, snapshotAt: facts.leaderboardSnapshotAt, podium: facts.podium } };
  const f = await fixture(true, true, false, facts);
  assert.match(f.html(), /U00000077/);
  assert.match(f.html(), /2026-10-08T12:30:00Z/);
  assert.doesNotMatch(f.html(), /暂停时的榜单数据未确认/);
  const live = await fixture(false, true, false, { ...facts, leaderboardDataAvailable: false });
  assert.match(live.html(), /U00000077/);
});

test("unpaused authorized manual payout retains the allTime proposal and permissions", async () => {
  const f = await fixture(false);
  const [button] = buttons(f.tree());
  assert.notEqual(button.props.disabled, true);
  let confirm, call;
  f.ctx.openActionConfirm = (spec) => { confirm = spec; };
  f.ctx.proposeF4LeaderboardPayout = async (...args) => { call = args; };
  buttons(f.tree())[0].props.onClick();
  await confirm.run("fixture ordinary reason");
  assert.deepEqual(call, ["allTime", "fixture ordinary reason"]);
  assert.equal(buttons((await fixture(false, false)).tree()).length, 0);
});

test("frozen metadata cannot confirm missing or malformed podium and count facts", async () => {
  const good = { leaderboardSnapshotState: "FROZEN", leaderboardDataAvailable: true,
    leaderboardSnapshotId: "pause-fixture", leaderboardSnapshotAt: "2026-10-08T12:30:00Z",
    leaderboardPoolLabel: "$900", leaderboardParticipantCount: 1,
    podium: [{ rank: 1, memberUserId: 77, userId: "U00000077", gmvLabel: "$900", tip: "冻结时 · 本期 GV", className: "r-1" }] };
  good.leaderboardPeriods = { ...periodFacts(), week: { ...periodFacts().week, snapshotAt: good.leaderboardSnapshotAt, podium: good.podium, participantCount: 1, topN: 1 } };
  for (const bad of [
    { leaderboardParticipantCount: undefined }, { leaderboardParticipantCount: "0" },
    { leaderboardParticipantCount: -1 }, { leaderboardPoolLabel: null },
    { podium: [{ ...good.podium[0], rank: undefined }] },
    { podium: [{ ...good.podium[0], rank: 0 }] }, { podium: [{ ...good.podium[0], memberUserId: "77" }] },
  ]) {
    const f = await fixture(true, true, false, { ...good, ...bad });
    assert.equal(f.ctx.f4Overview.leaderboardDataAvailable, false);
    assert.match(f.html(), /暂停时的榜单数据未确认/);
    assert.doesNotMatch(f.html(), /U00000077|\$900/);
  }
  await assert.rejects(fixture(true, true, false, { ...good, podium: undefined }), /F4_OVERVIEW_RESPONSE_INVALID:podium/);
  const empty = await fixture(true, true, false, { ...good, leaderboardParticipantCount: 0,
    leaderboardPoolLabel: "$0", podium: [], leaderboardPeriods: { week: { ...good.leaderboardPeriods.week, poolUsd: 0, participantCount: 0, topN: 0, podium: [] } } });
  assert.equal(empty.ctx.f4Overview.leaderboardDataAvailable, true);
  assert.match(empty.html(), /暂停时参赛人数.*0/);
});

test("a confirmation opened before pause propagates 409 as human failure, never execution success", async () => {
  const f = await fixture(false, true, true);
  let confirm, succeeded = false;
  const toasts = [];
  f.ctx.openActionConfirm = (spec) => { confirm = spec; };
  buttons(f.tree())[0].props.onClick();
  f.ctx.f4Overview.configValues["F.leaderboard.paused"] = "on";
  f.ctx.f4Overview.leaderboardPaused = true;
  const { createA2OperationProposal } = f.library("lib/admin/a2-client.ts");
  const { proposeOrExecute } = f.library("lib/admin/propose-or-execute.ts");
  f.ctx.proposeF4LeaderboardPayout = async (period, reason) => proposeOrExecute({
    principal: { name: "fixture.operator", role: "SUPER_ADMIN" },
    createProposal: createA2OperationProposal, toast: (message) => toasts.push(message),
  }, {
    action: "派发总榜奖池", obj: period, before: "待派发", after: "按对应周期真实佣金榜及奖池配置原子派发",
    type: "fund", amplifies: true, gate: { roles: [] }, gateLabel: "门槛者", reason,
    sourceDomain: "F4", commandKey: "fixture-paused-command",
    command: { domain: "F", op: "f4_leaderboard_period_payout", params: { period } },
    target: { domain: "F", type: "leaderboard_settlement", id: period },
  });
  try { await confirm.run("fixture stale confirmation"); succeeded = true; }
  catch (error) {
    const shown = operationConfirmErrorMessage(error);
    assert.equal(shown, "排行榜已暂停，未执行派奖；恢复后请重新确认。");
    assert.doesNotMatch(shown, /已执行|已派发|F4_LEADERBOARD_PAUSED/);
  }
  assert.equal(succeeded, false);
  assert.equal(toasts.length, 1);
  assert.match(toasts[0], /提交失败：排行榜已暂停，未执行派奖/);
  assert.doesNotMatch(toasts[0], /已写入|已执行|已派发/);
  assert.equal(buttons(f.tree())[0].props.disabled, true);
});

function periodFacts() {
  return Object.fromEntries(["today", "week", "month", "all"].map((period, index) => [period, {
    poolUsd: [10, 1000, 30, 40][index], participantCount: index + 1, topN: index + 1,
    timezone: "Asia/Shanghai", snapshotAt: "2026-10-16T07:00:00Z",
    fromInclusive: null, toExclusive: null,
    podium: [{ rank: 1, memberUserId: 700 + index, userId: `U${700 + index}`,
      gmvLabel: `$${195 + index}.80`, tip: "本期已解锁 USDT 佣金", className: "r-1" }],
  }]));
}
function matching(node, predicate, found = []) {
  if (!node || typeof node !== "object") return found;
  if (Array.isArray(node)) { node.forEach(child => matching(child, predicate, found)); return found; }
  if (predicate(node)) found.push(node);
  matching(node.props?.children, predicate, found);
  return found;
}
test("four period controls use canonical commissions and keep weekly disposal out of other periods", async () => {
  const f = await fixture(false, true, false, { leaderboardPeriods: periodFacts(),
    leaderboardPoolLabel: "$999999", leaderboardParticipantCount: 888,
    podium: [{ rank: 1, memberUserId: 88, userId: "OLD_GV", gmvLabel: "$999999", tip: "本期 GV", className: "r-1" }] });
  for (const [index, label] of ["今日", "本周", "本月", "总榜"].entries()) {
    const button = matching(f.tree(), node => node.type === "button" && text(node) === label)[0];
    assert.ok(button, `period selector ${label}`); button.props.onClick();
    const tree = f.tree();
    assert.match(text(tree), new RegExp(`U${700 + index}`));
    assert.doesNotMatch(text(tree), /OLD_GV|999999/);
    assert.match(text(tree), /Asia\/Shanghai/);
    const dispose = matching(tree, node => node.type === "button" && text(node) === "取消资格");
    assert.equal(dispose.length, index === 1 ? 1 : 0);
  }
});
test("missing or invalid canonical period cannot expose legacy GV as a ranking", async () => {
  for (const leaderboardPeriods of [undefined, { week: { ...periodFacts().week, timezone: "UTC" } },
    { week: { ...periodFacts().week, participantCount: -1 } }]) {
    const f = await fixture(false, true, false, { leaderboardPeriods,
      podium: [{ rank: 1, memberUserId: 88, userId: "OLD_GV", gmvLabel: "$999999", tip: "本期 GV", className: "r-1" }] });
    assert.doesNotMatch(f.html(), /OLD_GV|999999/);
    assert.match(f.html(), /榜单暂时无法显示/);
  }
});
