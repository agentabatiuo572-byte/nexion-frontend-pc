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

async function render(criteria) {
  const raw = {
    domain: "F4", metrics: [], quotaRows: [{ id: 1, quotaCode: "PRO", productNo: "P-REAL", name: "Pro", current: 2, cap: 10, ...criteria }],
    ambassadorBands: [], podium: [], voteWeights: [{ v: "V3", votes: 1 }], config: {},
    configValues: {}, commissionPolicy: {}, guardrails: [], sources: ["nx_team_hardware_quota_tier"],
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
  for (const legacy of [{}, { directRefs: 8, monthVolumeUsd: 725, unlockMode: "ALL" }]) {
    const text = await render(legacy);
    assert.match(text, /SKU P-REAL · 资格条件暂不可用/);
    assert.doesNotMatch(text, /无额外资格门槛/);
  }
});

test("known ALL and EITHER criteria preserve six-decimal monetary thresholds", async () => {
  for (const [mode, conjunction] of [["ALL", "且"], ["EITHER", "或"]]) {
    const text = await render({ directRefs: "8", monthVolumeUsd: "725.123456", monthVolumeUsdText: "725.123456", unlockMode: mode });
    assert.ok(text.includes(`有效直推 ≥ 8 ${conjunction} 团队业绩 ≥ $725.123456`), text);
    assert.doesNotMatch(text, /资格条件暂不可用/);
  }
});

test("explicit known zero criteria retain the no-extra-threshold message", async () => {
  assert.match(await render({ directRefs: 0, monthVolumeUsd: 0, monthVolumeUsdText: "0.000000", unlockMode: "ALL" }), /无额外资格门槛/);
});

test("the maximum DECIMAL(18,6) value survives JSON parsing without rounding", async () => {
  const text = await render({ directRefs: 8, monthVolumeUsd: 999999999999.999999,
    monthVolumeUsdText: "999999999999.999999", unlockMode: "ALL" });
  assert.ok(text.includes("团队业绩 ≥ $999,999,999,999.999999"), text);
  assert.doesNotMatch(text, /团队业绩 ≥ \$1,000,000,000,000/);
});

test("invalid and partial criteria cannot become an easier or invented rule", async () => {
  for (const invalid of [
    { directRefs: null }, { directRefs: -1 }, { directRefs: 1.5 }, { unlockMode: "future" },
    ...[null, "", "Infinity", "-1", "1e3", "1,000.00", "1000000000000.000001", "0.0000001", true]
      .map((monthVolumeUsdText) => ({ monthVolumeUsdText })),
  ]) {
    const text = await render({ directRefs: 8, monthVolumeUsd: 725, monthVolumeUsdText: "725.000000", unlockMode: "ALL", ...invalid });
    assert.match(text, /资格条件暂不可用/);
    assert.doesNotMatch(text, /无额外资格门槛|有效直推 ≥|团队业绩 ≥/);
  }
});

test("the smallest nonzero quota threshold remains visible without numeric conversion", async () => {
  assert.match(await render({ directRefs: 0, monthVolumeUsd: 0.000001, monthVolumeUsdText: "0.000001", unlockMode: "ALL" }),
    /团队业绩 ≥ \$0\.000001/);
});
