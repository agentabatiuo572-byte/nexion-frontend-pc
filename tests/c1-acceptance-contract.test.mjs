import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const search = readFileSync(new URL("../app/components/domain-views/c-tabs/c1-search.tsx", import.meta.url), "utf8");
const detail = readFileSync(new URL("../app/_console/users/search/[id]/page.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");

test("C1 preserves safe search context and disables stale rows while loading", () => {
  assert.match(search, /window\.history\.replaceState/);
  assert.match(search, /returnTo/);
  assert.match(search, /loading \? undefined : \(\) => openProfile/);
  assert.match(search, /C1_RAW_PHONE_SEARCH_FORBIDDEN/);
  assert.match(search, /为保护用户隐私，不支持按原始手机号检索；请使用脱敏手机号或手机号哈希/);
});

test("C1 exposes all PRD search dimensions and 20-200 page sizes", () => {
  for (const field of ["tier", "vRank", "referralCode", "depositMin", "depositMax", "usdtMin", "usdtMax", "nexMin", "nexMax", "riskBand", "joinedFrom", "joinedTo"]) {
    assert.match(search, new RegExp(field));
    assert.match(client, new RegExp(field));
  }
  assert.match(search, /pageSizeOptions=\{\[20, 50, 100, 200\]\}/);
});

test("C1 is read-only outside the explicitly approved payment and nickname actions", () => {
  assert.doesNotMatch(detail, /usePropose|findHighOp|doFreeze|c2_account_freeze|c2_session_revoke_all|c2_impersonate_start|c5_password_reset/);
  assert.match(detail, /pathname: "\/users\/actions"/);
  assert.match(detail, /pathname: "\/users\/security"/);
  assert.match(detail, /reasonMax=\{200\}/);
  assert.match(detail, /本卡片数据读取失败，其他画像卡片不受影响/);
  assert.match(detail, /刷新页面重试/);
});

test("C1 export is a direct masked CSV with a retry-stable idempotency key", () => {
  assert.match(search, /exportUserProfilesCsv/);
  assert.match(search, /exportKeyRef/);
  assert.match(search, /exportingRef\.current/);
  assert.match(search, /exportCooldownUntilRef/);
  assert.match(search, /Date\.now\(\) \+ 1_000/);
  assert.doesNotMatch(search, /openConfirm\(\{[\s\S]*导出用户名单/);
  assert.match(client, /\.csv/);
  assert.match(client, /exportKey/);
});

test("C1 renders unavailable when the current K4 score authority is absent", () => {
  assert.match(detail, /riskAuthorityReady/);
  assert.match(detail, /risk\?\.sourceStatus === "READY"/);
  assert.match(detail, /风险评分不可用/);
  assert.doesNotMatch(detail, /summary\.riskScore \?\? profile\?\.riskScore/);
});
