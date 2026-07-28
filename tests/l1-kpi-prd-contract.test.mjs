import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("L1 client exposes parameterized overview, drilldown and trend contracts", async () => {
  const source = await readFile(new URL("lib/admin/l-client.ts", root), "utf8");
  assert.match(source, /apiRequest<unknown>\(`\/kpi\?\$\{l1Query\(input\)\.toString\(\)\}`\)/);
  assert.match(source, /`\/kpi\/\$\{encodeURIComponent\(String\(kpiId\)\)\}\/drilldown\?/);
  assert.match(source, /`\/kpi\/trend\?\$\{query\.toString\(\)\}`/);
});

test("L1 page keeps eight-card unavailable values null-safe and performs server refresh", async () => {
  const source = await readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8");
  assert.match(source, /item\.available === false \|\| item\.value == null \? "na"/);
  assert.match(source, /"不可计算"/);
  assert.match(source, /fetchL1Kpi\(/);
  assert.match(source, /fetchL1KpiDrilldown\(/);
  assert.match(source, /fetchL1KpiTrend\(/);
  assert.match(source, /刷新 KPI/);
  assert.match(source, /const attention = red \+ unavailable/);
  assert.match(source, /\{attention\} \/ \{KPIS\.length\}/);
  assert.match(source, /validateL1Dashboard\(next\)/);
  assert.match(source, /setDrillKpi\(checkedDrilldown\.selected as Kpi\)/);
  assert.match(source, /setDrillTrend\(checkedTrend\.values as number\[\]\)/);
  assert.match(source, /当前仍显示上一次已校验快照，时间窗未切换/);
});

test("L1 rejects incomplete or malformed eight-KPI responses and misaligned trends", async () => {
  const source = await readFile(
    new URL("app/components/domain-views/l-tabs/l1-kpi-contract.ts", root),
    "utf8",
  );
  assert.match(source, /data\.kpis\.length !== KPI_IDS\.length/);
  assert.match(source, /L1_KPI_ID_SEQUENCE_INVALID/);
  assert.match(source, /row\.available[\s\S]*row\.value !== null/);
  assert.match(source, /data\.values\.length !== 0 && data\.values\.length !== data\.labels\.length/);
});

test("L1 canonical producers publish registration, referral and F2 commission events", async () => {
  const backend = new URL("../nexion-backend/", root);
  const registration = await readFile(
    new URL("src/main/java/ffdd/opsconsole/auth/application/AppUserRegistrationService.java", backend),
    "utf8",
  );
  const unilevel = await readFile(
    new URL("src/main/java/ffdd/opsconsole/team/application/UnilevelCommissionService.java", backend),
    "utf8",
  );
  const tradein = await readFile(
    new URL("src/main/java/ffdd/opsconsole/device/application/AppTradeinService.java", backend),
    "utf8",
  );
  const migration = await readFile(
    new URL("scripts/migrations/20260727_l1_kpi_event_chain_closure.sql", backend),
    "utf8",
  );
  const mapper = await readFile(
    new URL("src/main/java/ffdd/opsconsole/bi/mapper/BiReportMapper.java", backend),
    "utf8",
  );
  const analytics = await readFile(
    new URL("src/main/java/ffdd/opsconsole/bi/domain/L1KpiAnalytics.java", backend),
    "utf8",
  );
  assert.match(registration, /"auth\.register_completed"/);
  assert.match(registration, /"referral\.bound"/);
  assert.doesNotMatch(registration, /"user\.registration\.completed"/);
  assert.match(unilevel, /"commission\.paid"/);
  assert.match(unilevel, /"sourceUserId", buyerUserId/);
  assert.match(tradein, /"checkout\.completed"/);
  assert.match(tradein, /"device\.purchase_completed"/);
  assert.match(migration, /'referral\.bound'/);
  assert.match(migration, /'device\.first_yield_received'/);
  assert.match(migration, /'nova\.push_clicked'/);
  assert.match(mapper, /\$\.user_id[\s\S]*?\$\.userId[\s\S]*?\$\.anon_id[\s\S]*?\$\.anonId[\s\S]*?AS actorId/);
  assert.match(mapper, /\$\.source_user_id[\s\S]*?\$\.sourceUserId[\s\S]*?AS sourceActorId/);
  assert.match(analytics, /directReferralCommissionRate/);
  assert.match(analytics, /commissionKind\(\)\.equalsIgnoreCase\("network"\)/);
  assert.match(analytics, /referrals\.get\(event\.sourceActor\(\)\)/);
  assert.match(analytics, /event\.at\(\)\.isAfter\(referral\.at\(\)\)/);
});

test("L1 aggregate export is direct and no longer opens an unnecessary confirmation", async () => {
  const source = await readFile(new URL("app/components/domain-views/l-tabs/l1-kpi.tsx", root), "utf8");
  assert.doesNotMatch(source, /from "@\/lib\/store\/ui"/);
  assert.match(source, /KPI 序列已导出 · 已记审计/);
});
