import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const pcRoot = process.cwd();
const backendRoot = "D:/workspace/nexion-backend";
const appRoot = "D:/workspace/NX1.0";
const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

test("G3 PC sends curve/value CAS baselines and mirrors B1 direction gates", () => {
  const client = read(pcRoot, "lib/admin/g3-client.ts");
  const view = read(pcRoot, "app/components/domain-views/g-tabs/g3-market.tsx");
  assert.match(client, /expectedFrames/);
  assert.match(client, /createStableMutationExecutor/);
  assert.match(client, /g3OverviewMutation/);
  assert.match(client, /\{ value, expectedValue, reason, operator \}/);
  assert.doesNotMatch(client, /idempotencyPrefix/);
  assert.match(view, /coverage: amp \? coverageSnapshot : undefined/);
  assert.match(view, /amplifiesWhen: "increase"/);
  assert.match(view, /String\(paused\)/);
  assert.match(view, /只保存未来排程参数，不改写当前现价/);
  assert.match(view, /B1 备付金覆盖率/);
});

test("G3 backend validates enums, locks expected state and keeps curve edits isolated", () => {
  const service = read(backendRoot, "src/main/java/ffdd/opsconsole/market/application/OpsNexMarketService.java");
  const curveMethod = service.slice(
    service.indexOf("public ApiResult<Map<String, Object>> updateWeeklyCurve"),
    service.indexOf("public ApiResult<Map<String, Object>> updateControl"),
  );
  assert.match(service, /activeValueForUpdate/);
  assert.match(service, /G3_STATE_CONFLICT/);
  assert.match(service, /G3_PIN_INVALID/);
  assert.match(service, /G3_LOOP_INVALID/);
  assert.match(service, /G3_ORACLE_INVALID/);
  assert.match(service, /before && !parsed/);
  assert.doesNotMatch(curveMethod, /applyFrame\(/);
  assert.match(curveMethod, /currentPriceUnchangedUntilAdvance/);
});

test("App NEX market and wallet read the public G3 canonical snapshot", () => {
  const api = read(appRoot, "src/api/market-api.ts");
  const store = read(appRoot, "src/store/market.ts");
  const marketPage = read(appRoot, "src/pages/market/market.vue");
  const walletPage = read(appRoot, "src/pages/me/wallet-nex.vue");
  assert.match(api, /\/api\/config\/market\/nex/);
  assert.match(api, /serverCanonical !== true/);
  assert.match(store, /marketApi\.fetch\(\)/);
  assert.match(store, /if \(remoteApiEnabled\)/);
  assert.match(marketPage, /useMarket/);
  assert.match(walletPage, /market\.costBasis/);
});
