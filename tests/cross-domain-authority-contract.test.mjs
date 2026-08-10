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
