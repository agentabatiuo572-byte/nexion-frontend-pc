import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const backend = new URL("../../nexion-backend/", import.meta.url);
const readBackend = (path) => readFileSync(new URL(path, backend), "utf8");
const pc = new URL("../", import.meta.url);
const readPc = (path) => readFileSync(new URL(path, pc), "utf8");

test("D6 menu and all synchronized write permissions are durable RBAC data", () => {
  const migration = readBackend("scripts/migrations/20260725_high_fidelity_real_api_rbac.sql");
  const menuSeed = readBackend("scripts/rbac-classic-seed/01-menu-seed.sql");
  const roleSeed = readBackend("scripts/rbac-classic-seed/02-role-permission-seed.sql");
  const dPermissions = readBackend("scripts/rbac-classic-seed/D.sql");
  const klmPermissions = readBackend("scripts/rbac-classic-seed/KLM.sql");

  for (const source of [migration, menuSeed]) {
    assert.match(source, /'D6'[\s\S]*'汇率牌价'[\s\S]*'\/finance\/fx-rate'/);
  }

  for (const permission of [
    "finance_d1_bank_reconcile",
    "finance_d1_bank_account_manage",
    "finance_d1_bank_config_manage",
    "finance_d6_read",
    "finance_d6_manage",
  ]) {
    assert.match(migration, new RegExp(permission));
    assert.match(dPermissions, new RegExp(permission));
  }

  for (const permission of ["service_m3_timeout_manage", "risk_k6_target_manage"]) {
    assert.match(migration, new RegExp(permission));
    assert.match(klmPermissions, new RegExp(permission));
  }

  assert.match(migration, /menu_id[\s\S]*D6/);
  assert.match(migration, /FINANCE_LEAD[\s\S]*finance_d6_manage/);
  assert.match(migration, /SUPER_ADMIN[\s\S]*risk_k6_target_manage/);
  assert.match(roleSeed, /finance_d6_manage/);
  assert.match(roleSeed, /service_m3_timeout_manage/);
  assert.match(roleSeed, /risk_k6_target_manage/);
  assert.match(roleSeed, /permission_code NOT IN \('risk_k4_write','risk_k4_user_override','risk_k6_target_manage'\)/);
  assert.match(roleSeed, /permission_code <> 'service_m3_timeout_manage'/);
  for (const source of [migration, roleSeed]) {
    assert.match(
      source,
      /service_m3_timeout_manage','risk_k6_target_manage'[\s\S]*role_code <> 'SUPER_ADMIN'/,
    );
    assert.match(
      source,
      /finance_d6_manage[\s\S]*role_code NOT IN \('SUPER_ADMIN','FINANCE_LEAD'\)/,
    );
  }
});

test("safe visual alignment keeps the H8 name canonical and exposes the mono token", () => {
  assert.match(
    readPc("lib/nav/console-nav.ts"),
    /id: "H8", name: "新人礼与邀请奖励"/,
  );
  assert.match(readPc("app/globals.css"), /--mono:\s*var\(--font-jet-mono\)/);
});
