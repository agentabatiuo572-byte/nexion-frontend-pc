import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { optionalNexionBackendRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const client = read("lib/admin/g4-invite-client.ts");
const view = read("app/components/domain-views/g-tabs/g4-invite-codes.tsx");
const proxy = read("app/api/admin/market/[...path]/route.ts");
/**
 * 🔴 后端仓根走**共用解析器**,不写死绝对路径(2026-08-17)。
 *   原来这三个文件硬编码 `D:/workspace/nexion-backend/…` —— 那是某一台机器的目录布局,后果两条:
 *   ① `NEXION_BACKEND_ROOT` 设了也不起作用(这齿根本不看它),仓根从此有两个真源;
 *   ② 任何别的机器上都是 ENOENT,而 ENOENT 恰好被 verify 的缺仓特征串命中 → 整齿被记成
 *      「环境缺件 SKIP」,连**只读本仓**的那 3 个 test 一起陪葬,看起来还很正常。
 *   现在:仓不在 → 只 skip 跨仓那一条(理由写进 skip 里,汇总看得见);
 *        仓在但文件没了 → 照旧报红(那是真差异,不是环境事实)。约定同 j1 / j2。
 */
const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const backendRoot = optionalNexionBackendRoot({ adminRoot });
const backendFile = (rel) => readFileSync(path.join(backendRoot, ...rel.split("/")), "utf8");

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

test("G4 invite state is server-enforced unused to used or void only", (t) => {
  // 本仓断言排在 skip 判据之前 —— 缺后端仓时它照样必须跑到(顺序变了,断言一字未改)。
  assert.match(view, /row\.status === "unused"\s*\?\s*<button[\s\S]*?>作废<\/button>/);
  if (backendRoot === null) {
    return t.skip("本机无 nexion-backend:仅跨仓断言跳过(设 NEXION_BACKEND_ROOT 或克隆到 ../nexion-backend)");
  }
  const backendMapper = backendFile("src/main/java/ffdd/opsconsole/market/mapper/GenesisCatalogMapper.java");
  const migration = backendFile("scripts/migrations/20260807_nexion_hard_blockers.sql");
  const backendService = backendFile("src/main/java/ffdd/opsconsole/market/application/GenesisCatalogService.java");
  assert.match(backendMapper, /SET status='used'[\s\S]*WHERE code=#\{code\} AND status='unused'/);
  assert.match(backendMapper, /SET status='void'[\s\S]*WHERE code=#\{code\} AND status='unused'/);
  assert.match(migration, /UNIQUE KEY uk_genesis_invite_redeemed_account\(redeemed_by\)/);
  assert.match(backendService, /GENESIS_INVITE_ACCOUNT_ALREADY_REDEEMED/);
  assert.match(backendService, /GENESIS_INVITE_STATE_CONFLICT/);
});

test("G4 invite UI renders localized terminal states", () => {
  assert.match(client, /unused:\s*"未使用"/);
  assert.match(client, /used:\s*"已使用"/);
  assert.match(client, /void:\s*"已作废"/);
  assert.match(view, /G4_INVITE_STATUS_LABEL\[row\.status\]/);
});
