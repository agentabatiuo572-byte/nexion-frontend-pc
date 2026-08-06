import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  resolveNexionAppRoot,
  resolveNexionBackendRoot,
} from "../scripts/lib/nexion-workspace-paths.mjs";

const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = resolveNexionAppRoot({ adminRoot });
const backendRoot = resolveNexionBackendRoot({ adminRoot });
const readWorkspaceFile = (root, relative) => readFileSync(path.join(root, ...relative.split("/")), "utf8");

const view = readFileSync(new URL("../app/components/domain-views/j-tabs/j2-geoblock.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/j-client.ts", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const alertClient = readFileSync(new URL("../lib/admin/ops-dashboard-client.ts", import.meta.url), "utf8");
const notificationBell = readFileSync(new URL("../app/components/shell/notification-bell.tsx", import.meta.url), "utf8");
const jView = readFileSync(new URL("../app/components/domain-views/j-view.tsx", import.meta.url), "utf8");
const errorMessages = readFileSync(new URL("../lib/admin/error-messages.ts", import.meta.url), "utf8");
const liveAcceptance = readFileSync(
  new URL("./e2e/j2-live-acceptance-20260722.spec.ts", import.meta.url),
  "utf8",
);
const geoRouteRegistry = readWorkspaceFile(
  backendRoot,
  "src/main/java/ffdd/opsconsole/emergency/application/GeoProtectedRouteRegistry.java",
);
const geoPolicyTests = readWorkspaceFile(
  backendRoot,
  "src/test/java/ffdd/opsconsole/emergency/application/GeoBlockPolicyServiceTest.java",
);
const appGeoErrors = readWorkspaceFile(appRoot, "src/api/geo-policy-error.ts");
const appGeoErrorTests = readWorkspaceFile(appRoot, "src/api/geo-policy-error.test.ts");
const appUserSurfaces = [
  "src/pages/login/login.vue",
  "src/pages/register/register.vue",
  "src/pages/me/wallet-withdraw.vue",
  "src/pages/me/wallet-exchange.vue",
  "src/pages/me/wallet-repurchase.vue",
  "src/pages/me/trial.vue",
  "src/pages/staking/staking.vue",
  "src/pages/genesis/genesis.vue",
  "src/pages/genesis/marketplace.vue",
  "src/pages/daily/daily.vue",
  "src/pages/events/events.vue",
].map((relative) => readWorkspaceFile(appRoot, relative));

test("J2 writes execute the dedicated backend APIs instead of the A2 proposal queue", () => {
  assert.doesNotMatch(view, /usePropose|\bpropose\s*\(/);
  assert.match(view, /actions\.replaceJ2CountryList/);
  assert.match(view, /actions\.emergencyBlockJ2/);
});

test("J2 confirmation awaits the write and reload before reporting completion", () => {
  assert.match(view, /const runBackend = async/);
  assert.match(view, /await task/);
  assert.match(view, /await actions\.reloadJEmergency\(\)/);
});

test("J2 uses server-provided structured country and edge-source options", () => {
  assert.match(view, /data\.countryOptions/);
  assert.match(view, /data\.edge\.sources/);
  assert.match(view, /inputKind:\s*"multi-select"/);
  assert.match(view, /searchable:\s*true/);
  assert.doesNotMatch(view, /edit:\s*\{\s*kind:\s*"text"/);
  assert.match(designKit, /"multi-select"/);
  assert.match(designKit, /搜索国家代码或名称/);
  assert.match(view, /showDiff:\s*true/);
  assert.match(designKit, /新增：/);
  assert.match(designKit, /移除：/);
});

test("J2 action rendering follows the authenticated permission set", () => {
  assert.match(view, /emergency_j2_country_manage/);
  assert.match(view, /emergency_j2_write/);
  assert.match(view, /emergency_j2_edge_source_manage/);
  assert.match(view, /emergency_j2_emergency_block/);
});

test("J2 client sends atomic state direction and expected-snapshot fields required by the server contract", () => {
  assert.match(client, /updateJ2Country: \(countryCode, status, expectedStatus, triggerBasis, reason, commandKey\)/);
  assert.match(client, /\{ status, expectedStatus, triggerBasis \}/);
  assert.match(client, /replaceJ2CountryList: \(status, countries, expectedCountries, triggerBasis, reason, commandKey\)/);
  assert.match(client, /country-lists\/\$\{encodeURIComponent\(status\)\}/);
  assert.match(client, /expectedCountries/);
  assert.match(client, /updateJ2Endpoint: \(endpointKey, mode, countries, expectedMode, expectedCountries, reason, commandKey\)/);
  assert.match(client, /updateJ2EdgeJudge: \(source, expectedSource, reason, commandKey\)/);
  assert.match(client, /emergencyBlockJ2: \(countries, triggerBasis, reason, commandKey\)/);
});

test("J2 edge switching only exposes healthy alternatives and renders measured health state", () => {
  assert.match(view, /edgeSwitchCandidates.*source\.healthy/);
  assert.match(view, /data\.edge\.healthStatus/);
  assert.match(view, /stale.*已过期/);
  assert.match(view, /healthTone/);
  assert.match(view, /暂无满足最近 5 分钟 20 个可信样本门槛的备用判定源/);
  assert.match(view, /edgeFallbackAvailable\s*=\s*edgeSourceKnown\s*&&\s*data\.edge\.healthy/);
  assert.match(view, /旧源继续兜底 5 分钟/);
  assert.match(view, /当前源不可用，不具备回退能力/);
});

test("J2 treats an unregistered current edge source as a blocking fault without exposing its raw key", () => {
  assert.match(client, /sourceKnown:\s*requiredBool\(edge\.sourceKnown/);
  assert.match(view, /edgeSourceKnown\s*=\s*data\.edge\.sourceKnown/);
  assert.match(view, /判定源未登记/);
  assert.match(view, /healthTone.*danger/s);
  assert.doesNotMatch(view, /edgeSourceLabels\[edgeSource\]\s*\?\?\s*edgeSource/);
});

test("J2 outbox events are polled into the superadmin notification bell", () => {
  assert.match(alertClient, /fetch\("\/api\/admin\/emergency\/geo-block\/alerts"/);
  assert.match(alertClient, /useJ2GeoAlerts/);
  assert.match(notificationBell, /session\?\.role === "superadmin"/);
  assert.match(notificationBell, /useJ2GeoAlerts\(isSuperAdmin\)/);
  assert.match(alertClient, /\/emergency\/geo-block/);
});

test("J2 endpoint editor hides irrelevant countries and rejects an unchanged snapshot", () => {
  assert.match(view, /visibleWhen:\s*\{\s*key:\s*"mode",\s*equals:\s*"explicit"\s*\}/);
  assert.match(view, /封锁范围没有发生变化，本次未提交/);
  assert.match(designKit, /field\.visibleWhen/);
});

test("J2 tables expose truthful empty states", () => {
  assert.match(view, /当前没有已登记的功能入口/);
  assert.match(view, /今天暂无地区封锁拦截记录/);
  assert.match(designKit, /当前没有可选项/);
  assert.doesNotMatch(designKit, /无可选项\(先在 E1 上架 SKU\)/);
});

test("J2 uncertain writes reuse one command key and reload authoritative state before guiding retry", () => {
  assert.match(client, /isEmergencyOutcomeUncertain/);
  assert.match(view, /执行结果待确认/);
  assert.match(view, /await actions\.reloadJEmergency\(\)/);
  assert.match(view, /const commandKey = createJ2CommandKey/);
  assert.match(client, /"Idempotency-Key": commandKey/);
});

test("J2 emergency block only offers countries that can still be added", () => {
  assert.match(view, /emergencyCandidates\s*=\s*countryOptions\.filter/);
  assert.match(view, /!blockedCodes\.has\(country\)/);
  assert.match(view, /options:\s*emergencyCandidates/);
  assert.match(view, /disabled=\{emergencyCandidates\.length === 0\}/);
  assert.match(view, /所有国家和地区均已封禁，当前没有可新增候选/);
});

test("J2 removal warnings explain restored access and funding impact", () => {
  assert.match(view, /解除全局封禁/);
  assert.match(view, /解除全局受限/);
  assert.match(view, /不会清除功能入口的单独封锁/);
  assert.match(view, /最终可用能力以入口策略及其他业务闸为准/);
  assert.match(view, /移除只解除本名单/);
});

test("J2 disables an empty limited-list flow and renders endpoint countries in operator language", () => {
  assert.match(view, /limitedCandidates/);
  assert.match(view, /limitedEditDisabled/);
  assert.match(view, /暂无可加入受限名单的国家，请先解除全局封禁/);
  assert.match(view, /countryNames\[code\].*（.*\{code\}.*）/s);
});

test("J2 operator view hides endpoint paths and technical domain codes", () => {
  assert.doesNotMatch(view, /\{entry\.ep\}/);
  assert.doesNotMatch(view, /\{entry\.domain\}/);
  assert.match(view, /formatGeoChangeValue/);
  assert.match(view, /geoChangeObjectLabel/);
});

test("J pages explain authorization and service load failures", () => {
  assert.match(jView, /\{contentError\}/);
  assert.match(errorMessages, /ADMIN_AUTH_REQUIRED/);
  assert.match(errorMessages, /ADMIN_PERMISSION_DENIED/);
  assert.match(errorMessages, /EMERGENCY_ROUTE_NOT_FOUND/);
  assert.match(errorMessages, /EMERGENCY_BACKEND_UNAVAILABLE/);
  assert.match(errorMessages, /EMERGENCY_API_503/);
  assert.match(client, /useAdminAuth\.getState\(\)\.signOut\(\)/);
});

test("J2 limited-region enforcement covers the real App funds and reward mutation routes", () => {
  for (const route of [
    "/api/stakes",
    "/api/repurchase",
    "/api/trial",
    "/api/quests",
    "/api/events",
    "/api/points",
    "/api/earnings/milestones/evaluate",
    "/api/vouchers",
  ]) {
    assert.match(geoRouteRegistry, new RegExp(route.replaceAll("/", "\\/")));
  }
  for (const route of [
    "/api/stakes/STK-1/claim",
    "/api/repurchase/orders/RPS-1/early-withdraw",
    "/api/trial/start",
    "/api/quests/DAILY-1/claim",
    "/api/events/EVENT-1/spin",
    "/api/points/sign-in",
    "/api/vouchers/VCH-1/claim",
  ]) {
    assert.match(geoPolicyTests, new RegExp(route.replaceAll("/", "\\/")));
  }
  assert.match(geoPolicyTests, /\/api\/events\/EVENT-1\/join"\)\.blocked\(\)\)\.isFalse/);
  assert.match(geoPolicyTests, /\/api\/trial\/cancel"\)\.blocked\(\)\)\.isFalse/);
});

test("J2 App surfaces translate policy failures without leaking GEO technical codes", () => {
  for (const code of [
    "GEO_BLOCKED",
    "GEO_LIMITED",
    "GEO_ENDPOINT_BLOCKED",
    "GEO_COUNTRY_UNRESOLVED",
    "GEO_EDGE_TRUST_REQUIRED",
  ]) {
    assert.match(appGeoErrors, new RegExp(code));
    assert.match(appGeoErrorTests, new RegExp(code));
  }
  for (const surface of appUserSurfaces) {
    assert.match(surface, /geoPolicyUserMessage/);
  }
  assert.doesNotMatch(
    appUserSurfaces.join("\n"),
    /toast\.(?:error|info)\([^;\n]*instanceof Error \? (?:error|cause)\.message/,
  );
});

test("J2 acceptance cleanup follows A1 latest-version CAS and clears MFA, role, status and sessions", () => {
  assert.match(liveAcceptance, /async function mutateAccountWithLatestVersion/);
  assert.match(liveAcceptance, /GET", "\/api\/admin\/platform\/accounts\/overview"/);
  assert.match(liveAcceptance, /expectedVersion:\s*String\(account\.version/);
  for (const suffix of ["reset-2fa", "role", "status", "sessions/revoke"]) {
    assert.match(liveAcceptance, new RegExp(`mutateAccountWithLatestVersion[\\s\\S]{0,240}"${suffix.replace("/", "\\/")}"`));
  }
  assert.doesNotMatch(
    liveAcceptance,
    /apiSend\(page,\s*"PATCH",\s*`\/api\/admin\/platform\/accounts\/\$\{(?:accountId|checkerAccountId|account\.id)\}\/(?:status|role)`/,
  );
});

test("J2 acceptance accounts log in with the server-issued one-time password", () => {
  assert.match(liveAcceptance, /temporaryPassword/);
  assert.match(liveAcceptance, /loginCredentialsFromVisibleEntry\(\s*checkerPage,\s*checkerUsername,\s*checkerTemporaryPassword,/);
  assert.match(liveAcceptance, /loginCredentialsFromVisibleEntry\(\s*readerPage,\s*username,\s*readerTemporaryPassword,/);
  assert.doesNotMatch(liveAcceptance, /loginCredentialsFromVisibleEntry\(\s*checkerPage,\s*checkerUsername,\s*checkerInitialPassword,/);
});
