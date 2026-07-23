import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const c4 = readFileSync(new URL("../app/components/domain-views/c-tabs/c4-kyc.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/users/[...path]/route.ts", import.meta.url), "utf8");

test("C4 state changes are immediate, structured and protected by explicit RBAC", () => {
  for (const permission of [
    "user_c4_read",
    "user_c4_verify",
    "user_c4_revoke",
    "user_c4_trigger_review",
    "user_c4_export",
    "user_c4_network_write",
  ]) {
    assert.match(c4, new RegExp(permission));
  }
  assert.match(c4, /reasonCode/);
  assert.match(c4, /evidenceRef/);
  assert.match(c4, /expectedState/);
  assert.match(c4, /reasonLength < 8 \|\| reasonLength > 200/);
  assert.doesNotMatch(c4, /usePropose|c4_kyc_status_change/);
});

test("C4 review trigger creates or merges K5 without rewriting KYC status", () => {
  assert.match(client, /triggerUserKycReview/);
  assert.match(client, /\/trigger-review/);
  assert.match(route, /parts\[3\] === "trigger-review"/);
  assert.match(c4, /K5/);
  assert.match(c4, /不会改变当前实名状态/);
  assert.doesNotMatch(c4, /把该用户实名状态写为复审中/);
});

test("C4 detail and regulatory export survive refresh and expose downloadable L5 jobs", () => {
  assert.match(client, /fetchUserKycDetail/);
  assert.match(client, /fetchUserKycExports/);
  assert.match(client, /downloadUserKycExport/);
  assert.match(route, /parts\[1\] === "exports" && isNonEmpty\(parts\[2\]\) && parts\[3\] === "download"/);
  assert.match(c4, /最近导出任务/);
  assert.match(c4, /下载/);
  assert.doesNotMatch(c4, /nx_user|nx_kyc_profile|nx_config_item|nx_audit_log/);
});

test("C4 rejects malformed success payloads and clears stale authority data", () => {
  assert.match(client, /function requireC4Overview/);
  assert.match(client, /function requireC4LedgerRow/);
  assert.match(client, /function requireC4ExportJob/);
  assert.match(client, /C4_RESPONSE_INVALID/);
  assert.match(c4, /setOverview\(null\);\s*setDetail\(null\);\s*setExports\(\[\]\);/);
});

test("C4 presents operator-facing status and export scope without raw implementation codes", () => {
  assert.match(c4, /READY: "可下载"/);
  assert.match(c4, /MASKED_LEDGER" \? "全量脱敏台账"/);
  assert.match(c4, /展示用户编码、昵称与脱敏手机号/);
  assert.match(c4, /变更后立即生效并保留记录/);
  assert.doesNotMatch(c4, /变更写真实接口/);
});
