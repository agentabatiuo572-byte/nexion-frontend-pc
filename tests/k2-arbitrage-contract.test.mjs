import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("../app/components/domain-views/k-tabs/k2-arbitrage.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/k-client.ts", import.meta.url), "utf8");
const kView = readFileSync(new URL("../app/components/domain-views/k-view.tsx", import.meta.url), "utf8");
const highOps = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");
const a2Client = readFileSync(new URL("../lib/admin/a2-client.ts", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const f4Ops = readFileSync(new URL("../app/components/domain-views/f-tabs/f4-ops.tsx", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const liveAcceptance = readFileSync(new URL("./e2e/k2-live-acceptance-20260722.spec.ts", import.meta.url), "utf8");
const f5TriggerRepair = readFileSync(
  new URL("../../nexion-backend/scripts/migrations/20260728_f5_commission_trigger_collation.sql", import.meta.url),
  "utf8",
);
const riskService = readFileSync(
  new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/risk/application/OpsRiskService.java", import.meta.url),
  "utf8",
);

test("K2 fails closed on stale data and only reloads its own overview", () => {
  const body = component.slice(component.indexOf("export function K2Arbitrage"));
  assert.match(body, /if \(ctx\.contentError\)/);
  assert.ok(body.indexOf("if (ctx.contentError)") < body.lastIndexOf("return ("));
  assert.match(client, /fetchK2ArbitrageOverview/);
  assert.match(kView, /tab === "K2"[\s\S]*fetchK2ArbitrageOverview/);
});

test("K2 rejects malformed successful overview payloads instead of normalizing them to an empty state", () => {
  assert.match(client, /K2_RESPONSE_INVALID/);
  assert.match(client, /requiredK2Record\(raw,\s*"arbitrage"\)/);
  assert.match(client, /data\.serverCanonical !== true/);
  assert.match(client, /data\.domain !== "K2"/);
  assert.match(client, /K2_STAT_KEYS/);
  assert.match(client, /K2_PARAM_KEYS/);
  assert.match(client, /validateK2ParamValue/);
  assert.match(client, /requiredK2Array\(data\.stats,\s*"arbitrage\.stats"\)/);
  assert.match(client, /requiredK2Array\(data\.views,\s*"arbitrage\.views"\)/);
  assert.match(client, /requiredK2StringArray\(data\.sources,\s*"arbitrage\.sources"\)/);
  assert.match(errorMessages, /K2_RESPONSE_INVALID/);
  assert.match(errorMessages, /旧数据与写操作已隐藏/);
  assert.match(riskService, /canonicalK2Stats\(rows\)/);
  assert.match(riskService, /response\.put\("serverCanonical", true\)/);
  assert.match(riskService, /response\.put\("domain", "K2"\)/);
});

test("K2 exact permissions guard every visible write action", () => {
  assert.match(component, /useAdminAuth/);
  assert.match(component, /risk_k2_write/);
  assert.match(component, /risk_k2_row_flag/);
  assert.match(component, /risk_k2_row_freeze/);
  assert.match(component, /risk_k2_row_blockgift/);
  assert.match(component, /risk_k2_row_boardflag/);
  assert.match(component, /未知动作/);
});

test("K2 direct preventive actions and K1-linked freeze use the correct lifecycle", () => {
  assert.match(component, /executeK2Action\(r\.rowId, "flag"/);
  assert.match(component, /executeK2Action\(r\.rowId, "blockgift"/);
  assert.match(component, /executeK2Action\(r\.rowId, "boardflag"/);
  assert.match(component, /proposeK2Freeze/);
  assert.match(highOps, /k2_row_freeze[\s\S]*clusterExpectedVersion/);
});

test("K2 keeps confirmation open, preserves uncertain command keys, and separates refresh failures", () => {
  assert.doesNotMatch(component, /void runAction/);
  assert.doesNotMatch(component, /void propose\(/);
  assert.match(component, /commandAttempt/);
  assert.match(component, /K1OutcomeUncertainError/);
  assert.match(component, /A2OutcomeUncertainError/);
  assert.match(component, /已写入，但 K2 最新数据回读失败/);
  assert.match(client, /updateK2Param:[\s\S]*commandKey/);
  assert.match(client, /RISK_RESPONSE_BODY_MISSING[\s\S]*K1OutcomeUncertainError/);
  assert.match(a2Client, /!result[\s\S]*A2OutcomeUncertainError\("A2_RESPONSE_UNREADABLE"/);
  assert.match(client, /executeK2Action:[\s\S]*expectedVersion/);
});

test("K2 removes retired holding gates and declares exact OTP boundaries", () => {
  assert.doesNotMatch(component, /minHoldingMonths|最小持仓月份|没满最短持有月|残值 \$0/);
  assert.match(component, /高频下架置换/);
  assert.match(component, /礼金\/返佣叠加/);
  assert.match(component, /min: 30, max: 300/);
  assert.match(component, /min: 1, max: 10/);
  assert.match(component, /min: 60, max: 900, step: 60/);
  assert.match(component, /captchaGate\.alwaysScenes/);
  assert.match(component, /captchaGate\.afterSends/);
  assert.match(riskService, /auth\.risk\.captcha_always_scenes/);
  assert.match(riskService, /auth\.risk\.captcha_after_sends/);
  assert.match(component, /只影响后续发送/);
  assert.match(component, /已签发验证码/);
  assert.match(component, /updateK2Param\(p\.key, nextValue, p\.version/);
  assert.match(component, /updateK2Param\(definition\.key, backendValue, param\.version/);
  assert.match(client, /withReason\(\{ value, expectedVersion \}, reason\)/);
  assert.match(designKit, /\(numeric - base\) \/ spec\.step/);
  assert.match(designKit, /catch \(error\)[\s\S]*operationConfirmErrorMessage\(error\)/);
});

test("K2 headers have one owner and unknown row actions do not default to another action", () => {
  assert.match(component, /current\?\.head/);
  assert.match(component, /action === "boardflag"/);
  assert.doesNotMatch(component, /: <button[^\n]*boardFlag\(r\)/);
});

test("F4 keeps the K2 hit count visible when historical F4 dispositions exist", () => {
  assert.match(f4Ops, /data\.leaderboardFraudHitCount}\s*账户\$\{lbDq \? " · 含已处置" : ""}/);
  assert.doesNotMatch(f4Ops, /lbDq\s*\?\s*"已处置"\s*:\s*`\$\{data\.leaderboardFraudHitCount}\s*账户`/);
});

test("K2 renders canonical backend disposition codes as business labels", () => {
  assert.match(component, /K2_DISPOSITION_LABELS/);
  assert.match(component, /account_flagged:\s*"已标记套利"/);
  assert.match(component, /gift_blocked:\s*"新人礼已拦截"/);
  assert.match(component, /leaderboard_flagged:\s*"已标记刷榜"/);
  assert.match(component, /cluster_frozen:\s*"已联动 K1 冻结"/);
  assert.match(component, /K2_DISPOSITION_LABELS\[disposed\]\s*\?\?\s*"已处置"/);
  assert.doesNotMatch(component, />\{disposed\}</);
});

test("K2 live acceptance always targets the explicitly selected isolated database", () => {
  assert.match(liveAcceptance, /const DB_NAME = process\.env\.K2_DB_NAME \|\| "nexion";/);
  assert.match(liveAcceptance, /\["-uroot", "-D", DB_NAME,/);
  assert.doesNotMatch(liveAcceptance, /\["-uroot", "-D", "nexion",/);
});

test("K2 temporary accounts follow the server credential contract and leave no privilege residue", () => {
  assert.match(liveAcceptance, /created\.data\?\.temporaryPassword/);
  assert.match(liveAcceptance, /await login\(browserPage, username, issuedPassword, password\)/);
  assert.match(liveAcceptance, /\/reset-2fa/);
  assert.match(liveAcceptance, /\/sessions\/revoke/);
  assert.match(liveAcceptance, /expectedVersion: String\(current\.version\)/);
  assert.match(liveAcceptance, /role: "unassigned", status: "disabled", tfa: false, sessions: 0/);
});

test("K2 commission fixtures remain insertable across the F5 legacy collation boundary", () => {
  assert.match(f5TriggerRepair, /ALTER TABLE nx_commission_operation[\s\S]*utf8mb4_0900_ai_ci/);
  assert.match(f5TriggerRepair, /ALTER TABLE nx_commission_user_suspension[\s\S]*utf8mb4_0900_ai_ci/);
  assert.match(f5TriggerRepair, /DROP TRIGGER IF EXISTS trg_nx_commission_event_suspension/);
  assert.match(
    f5TriggerRepair,
    /s\.kind = LOWER\(NEW\.commission_type\) COLLATE utf8mb4_0900_ai_ci/,
  );
});
