import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pcRoot = new URL("../", import.meta.url);
const backendRoot = new URL("../../nexion-backend/", import.meta.url);
const appRoot = new URL("../../NX1.0/", import.meta.url);

async function source(root, path) {
  return readFile(new URL(path, root), "utf8");
}

test("F1 PC exposes all read and action routes through the strict BFF", async () => {
  const bff = await source(pcRoot, "app/api/admin/teams/[...path]/route.ts");
  for (const marker of [
    'parts[0] === "promotion-log"',
    'parts[0] === "reward-payouts"',
    'parts[3] === "override"',
    'parts[2] === "reissue" || parts[2] === "reverse"',
  ]) {
    assert.ok(bff.includes(marker), `missing BFF marker: ${marker}`);
  }
});

test("F1 page closes ladder, promotion and payout workflows without placeholders", async () => {
  const view = await source(pcRoot, "app/components/domain-views/f-tabs/f1-vrank.tsx");
  assert.match(view, /V-Rank 13 阶阶梯/);
  assert.match(view, /晋升流水/);
  assert.match(view, /人工晋升 \/ 回滚/);
  assert.match(view, /奖励派发流水/);
  assert.match(view, /重发/);
  assert.match(view, /冲正/);
  assert.doesNotMatch(view, /数据待晋升引擎接入/);
  for (const field of ["unilevelDepth", "peerBonusRate", "votes", "visible"]) {
    assert.match(view, new RegExp(`r\\.${field}`));
  }
});

test("F1 backend enforces one-step promotion, rich audit rows and A2 replay", async () => {
  const engine = await source(backendRoot, "src/main/java/ffdd/opsconsole/team/application/VRankPromotionEngine.java");
  const service = await source(backendRoot, "src/main/java/ffdd/opsconsole/team/application/OpsTeamService.java");
  const mapper = await source(backendRoot, "src/main/java/ffdd/opsconsole/team/mapper/TeamCommissionMapper.java");
  assert.match(engine, /newIndex = currentIndex \+ 1/);
  assert.match(service, /A2_CONFIRMATION_REQUIRED/);
  assert.match(service, /f_vrank_override/);
  assert.match(service, /f_reward_payout_action/);
  assert.match(service, /PAYOUT_REVERSE_STATE_INVALID/);
  assert.match(service, /VRANK_REWARD_PAYOUT_REISSUED/);
  assert.match(service, /VRANK_REWARD_PAYOUT_REVERSED/);
  for (const field of ["snapshot", "triggerEventId", "auditNo", "isManual"]) {
    assert.match(mapper, new RegExp(field));
  }
});

test("App remote mode reads V-Rank ladder and member progress from backend", async () => {
  const backend = await source(backendRoot, "src/main/java/ffdd/opsconsole/team/web/AppVRankController.java");
  const api = await source(appRoot, "src/api/v-rank-api.ts");
  const store = await source(appRoot, "src/store/v-rank.ts");
  const page = await source(appRoot, "src/pages/team/rank.vue");
  assert.match(backend, /\/api\/config\/v-ranks/);
  assert.match(backend, /\/api\/team\/rank/);
  assert.match(api, /V_RANK_RESPONSE_INVALID/);
  assert.match(store, /vRankApi\.ladder\(\)/);
  assert.match(store, /vRankApi\.current\(\)/);
  assert.match(store, /if \(remoteApiEnabled\) return;/);
  assert.match(page, /Local rank data is not used in remote mode/);
});
