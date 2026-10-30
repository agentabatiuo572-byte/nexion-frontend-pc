import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const nodeRequire = createRequire(import.meta.url);

test("F4 preserves applicant source names across statuses without changing source fields", async () => {
  for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
    const application = { id: 5, userId: 60723153027, applicantName: "NexGrid 1058", region: "NexGrid district", city: "Venue", currentRank: "V5", requestedBudgetUsd: 3000, status };
    const before = structuredClone(application);
    const text = await render({}, { ambassadorApplications: [application] });
    assert.ok(text.includes("#5 · NexGrid 1058 · NexGrid district/Venue"), text);
    assert.ok(text.includes(`V5 · $3,000 · ${({PENDING:"待审核",APPROVED:"已通过",REJECTED:"已驳回"})[status]}`), text);
    assert.deepEqual(application, before);
  }
  assert.ok((await render({}, { ambassadorApplications: [{ id: 6, applicantName: "Nguyễn An", status: "PENDING" }] })).includes("Nguyễn An"));
});

function loadRuntime(responseData) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const output = ts.transpileModule(readFileSync(filename, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function("require", "exports", "module", output)((name) => {
      if (name.endsWith("auth-session")) return { isAdminAuthFailure: () => false, resetAdminSession: () => assert.fail("unexpected auth mutation") };
      if (name.endsWith("error-messages")) return {
        guardedFetch: async (url, options) => {
          assert.equal(url, "/api/admin/teams/leadership-pool");
          assert.ok(!options.method || options.method === "GET");
          return new Response(JSON.stringify({ code: 0, data: responseData }), { status: 200 });
        },
        rawFetch: () => assert.fail("no writes in a read-model test"),
        formatAdminApiError: (_, fallback) => fallback,
      };
      if (!name.startsWith("@/") && !name.startsWith(".")) return nodeRequire(name);
      const base = name.startsWith("@/") ? path.join(root, name.slice(2)) : path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => existsSync(candidate));
      assert.ok(resolved, `local dependency missing: ${name}`);
      return load(resolved);
    }, module.exports, module);
    return module.exports;
  }
  return {
    client: load(path.join(root, "lib/admin/f1-client.ts")),
    F4Ops: load(path.join(root, "app/components/domain-views/f-tabs/f4-ops.tsx" )).F4Ops,
  };
}

async function render(criteria, pool = {}) {
  const raw = {
    domain: "F4", metrics: [], quotaRows: [{ id: 1, quotaCode: "PRO", productNo: "P-REAL", name: "Pro", current: 2, cap: 10, ...criteria }],
    ambassadorBands: [], podium: [], voteWeights: [{ v: "V3", votes: 1 }], config: {},
    configValues: {}, commissionPolicy: {}, guardrails: [], sources: ["nx_team_hardware_quota_tier"],
    ...pool,
  };
  const { client, F4Ops } = loadRuntime(raw);
  const overview = await client.fetchF4LeadershipPoolOverview();
  const html = renderToStaticMarkup(React.createElement(F4Ops, { ctx: {
    f4Overview: overview, can: () => false, f4AmbassadorPolicy: null,
    f4Loading: false, f4Error: null,
  } }));
  return html.replace(/<[^>]*>/g, "").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
}

test("missing quota criteria are unavailable, never zero-threshold authority", async () => {
  for (const legacy of [{}, { directRefs: 8, monthComputePoints: 725, unlockMode: "ALL" }]) {
    const text = await render(legacy);
    assert.match(text, /商品编号 P-REAL · 资格条件暂时无法显示/);
    assert.doesNotMatch(text, /无额外条件/);
  }
});

test("known ALL and EITHER criteria show whole team compute points", async () => {
  for (const [mode, conjunction] of [["ALL", "且"], ["EITHER", "或"]]) {
    const text = await render({ directRefs: "8", monthComputePoints: 7250, monthComputePointsText: "7250", unlockMode: mode });
    assert.ok(text.includes(`有效直接邀请 ≥ 8 ${conjunction} 本月团队算力点 ≥ 7,250`), text);
    assert.doesNotMatch(text, /资格条件暂时无法显示|\$/);
  }
});

test("explicit known zero criteria retain the no-extra-threshold message", async () => {
  assert.match(await render({ directRefs: 0, monthComputePoints: 0, monthComputePointsText: "0", unlockMode: "ALL" }), /无额外条件/);
});

test("large point thresholds survive JSON parsing without rounding", async () => {
  const text = await render({ directRefs: 8, monthComputePoints: 999999999999999999,
    monthComputePointsText: "999999999999999999", unlockMode: "ALL" });
  assert.ok(text.includes("本月团队算力点 ≥ 999,999,999,999,999,999"), text);
});

test("invalid and partial criteria cannot become an easier or invented rule", async () => {
  for (const invalid of [
    { directRefs: null }, { directRefs: -1 }, { directRefs: 1.5 }, { unlockMode: "future" },
    ...[null, "", "Infinity", "-1", "1e3", "1,000", "725.5", "0.000000", "1000000000000000000", true]
      .map((monthComputePointsText) => ({ monthComputePointsText })),
  ]) {
    const text = await render({ directRefs: 8, monthComputePoints: 725, monthComputePointsText: "725", unlockMode: "ALL", ...invalid });
    assert.match(text, /资格条件暂时无法显示/);
    assert.doesNotMatch(text, /无额外条件|有效直接邀请 ≥|团队算力点 ≥/);
  }
});

test("the smallest nonzero quota threshold remains visible", async () => {
  assert.match(await render({ directRefs: 0, monthComputePoints: 1, monthComputePointsText: "1", unlockMode: "ALL" }),
    /本月团队算力点 ≥ 1/);
});

test("F4 renders one configured planned settlement time with an explicit business timezone", async () => {
  const text = await render({}, { settlementConfigStatus: "READY", nextSettlementAt: "2026-10-18T23:59:00Z" });
  assert.match(text, /下次计划结算：2026\/10\/19 07:59（北京时间）/);
  assert.doesNotMatch(text, /快照 →|周一 00:00 UTC 派发/);
});

test("F4 never reuses legacy windows or an unavailable plan as a payout promise", async () => {
  const legacy = { settlementWindow: "周日 23:59 UTC", settlementDispatchWindow: "周一 00:00 UTC" };
  for (const plan of [
    { settlementConfigStatus: "READY" },
    { settlementConfigStatus: "READY", nextSettlementAt: "invalid" },
    { settlementConfigStatus: "HOLD", nextSettlementAt: "2026-10-18T23:59:00Z" },
  ]) {
    const text = await render({}, { ...legacy, ...plan });
    assert.match(text, /自动结算时间未知/);
    assert.doesNotMatch(text, /下次计划结算|周日 23:59|周一 00:00|快照 →/);
  }
});
