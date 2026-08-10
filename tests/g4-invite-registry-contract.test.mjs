import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const client = read("lib/admin/g4-invite-client.ts");
const view = read("app/components/domain-views/g-tabs/g4-invite-codes.tsx");
const proxy = read("app/api/admin/market/[...path]/route.ts");
const backendService = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/market/application/GenesisCatalogService.java",
  "utf8",
);
const backendMapper = readFileSync(
  "D:/workspace/nexion-backend/src/main/java/ffdd/opsconsole/market/mapper/GenesisCatalogMapper.java",
  "utf8",
);
const migration = readFileSync(
  "D:/workspace/nexion-backend/scripts/migrations/20260807_nexion_hard_blockers.sql",
  "utf8",
);

test("G4 invite registry uses only the authenticated real API", () => {
  assert.match(client, /g4Request\("\/nex\/genesis\/invite-codes"\)/);
  assert.match(client, /method:\s*"POST"/);
  assert.match(client, /\/nex\/genesis\/invite-codes\/\$\{encodeURIComponent\(code\)\}\/void/);
  assert.match(client, /"Idempotency-Key"/);
  assert.doesNotMatch(client + view, /localStorage|sessionStorage|nexion-admin-g4-invite-codes/);
  assert.match(proxy, /nex\/genesis\/invite-codes/);
});

test("G4 invite writes validate batch, note and mandatory void reason", () => {
  assert.match(client, /count<1\|\|count>G4_INVITE_MAX_BATCH/);
  assert.match(client, /note\.trim\(\)\.length>G4_INVITE_NOTE_MAX/);
  assert.match(client, /trimmed\.length<G4_INVITE_REASON_MIN\|\|trimmed\.length>G4_INVITE_REASON_MAX/);
  assert.match(view, /reasonMax:\s*G4_INVITE_REASON_MAX/);
});

test("G4 invite state is server-enforced unused to used or void only", () => {
  assert.match(backendMapper, /SET status='used'[\s\S]*WHERE code=#\{code\} AND status='unused'/);
  assert.match(backendMapper, /SET status='void'[\s\S]*WHERE code=#\{code\} AND status='unused'/);
  assert.match(migration, /UNIQUE KEY uk_genesis_invite_redeemed_account\(redeemed_by\)/);
  assert.match(backendService, /GENESIS_INVITE_ACCOUNT_ALREADY_REDEEMED/);
  assert.match(backendService, /GENESIS_INVITE_STATE_CONFLICT/);
  assert.match(view, /row\.status === "unused"\s*\?\s*<button[\s\S]*?>作废<\/button>/);
});

test("G4 invite UI renders localized terminal states", () => {
  assert.match(client, /unused:\s*"未使用"/);
  assert.match(client, /used:\s*"已使用"/);
  assert.match(client, /void:\s*"已作废"/);
  assert.match(view, /G4_INVITE_STATUS_LABEL\[row\.status\]/);
});
