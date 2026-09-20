import assert from "node:assert/strict";
import test from "node:test";

import {
  canAccessCrossDomainPath,
  requiredReadAuthority,
} from "../lib/admin/cross-domain-authority.ts";

const expected = {
  "/finance/pool": "finance_d3_read",
  "/overview/dual-ledger": "overview_b1_read",
  "/overview/risk-radar": "overview_b5_read",
  "/analytics/funnel-cohort": "bi_l2_read",
  "/growth/phase": "growth_h1_read",
  "/platform/events": "platform_a4_read",
  "/overview/funnel": "overview_b3_read",
  "/overview/liquidity": "overview_b2_read",
  "/finance/withdrawals": "finance_d2_read",
  "/risk/multi-account": "risk_k1_read",
  "/risk/abuse": "risk_k2_read",
  "/emergency/tamper": "emergency_j3_read",
  "/risk/scoring": "risk_k4_read",
  "/emergency/kill-switch": "emergency_j1_read",
};

test("跨域入口逐路径绑定目标域 read 权限", () => {
  for (const [path, authority] of Object.entries(expected)) {
    assert.equal(requiredReadAuthority(path), authority);
    assert.equal(canAccessCrossDomainPath(path, "auditor", [authority]), true);
    assert.equal(canAccessCrossDomainPath(path, "auditor", []), false);
  }
});

test("未知目标失败关闭，超级管理员显式放行", () => {
  assert.equal(requiredReadAuthority("/retired/legacy"), null);
  assert.equal(canAccessCrossDomainPath("/retired/legacy", "auditor", ["*"]), false);
  assert.equal(canAccessCrossDomainPath("/finance/pool", "superadmin", []), true);
  assert.equal(canAccessCrossDomainPath("/finance/pool", "super", []), true);
});

// 2026-09-20(BUG 181):后端下发的归因入口带查询串(B4 的 B3 是 `/overview/funnel?phase=ALL`)。
// 按整串精确查表会让带查询串的目标落空 → 判为「未知目标」→ 连 superadmin 都显示「目标域无权限」,
// 而同一个页面直接打开却正常。查询串不改变目标域,判定必须按 pathname 走。
test("带查询串/锚点的目标按 pathname 判定，与直接打开同一页面一致", () => {
  const cases = [
    ["/overview/funnel?phase=ALL", "overview_b3_read"],
    ["/overview/funnel?phase=P2&granularity=MONTH", "overview_b3_read"],
    ["/growth/phase#schedule", "growth_h1_read"],
    ["/finance/pool?from=2026-09-01", "finance_d3_read"],
  ];
  for (const [href, authority] of cases) {
    assert.equal(requiredReadAuthority(href), authority, href);
    // 超级管理员与持权角色都必须放行 —— 这正是缺陷报告的场景。
    assert.equal(canAccessCrossDomainPath(href, "superadmin", []), true, href);
    assert.equal(canAccessCrossDomainPath(href, "auditor", [authority]), true, href);
    // 无权限者仍然被挡:放宽的是「解析」,不是「授权」。
    assert.equal(canAccessCrossDomainPath(href, "auditor", []), false, href);
  }
  // 未知目标即便带查询串也必须失败关闭,不能因为剥了查询串就变成放行。
  assert.equal(requiredReadAuthority("/retired/legacy?phase=ALL"), null);
  assert.equal(canAccessCrossDomainPath("/retired/legacy?phase=ALL", "superadmin", ["*"]), false);
});
