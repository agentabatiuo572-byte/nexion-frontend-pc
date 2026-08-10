import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const readWorkspace = (path) => readFileSync(new URL(`../${path}`, root), "utf8");
const appRoot = resolveNexionAppRoot({ adminRoot: path.resolve(import.meta.dirname, "..") });
const readApp = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

test("K6 is registered and rendered as a first-class K domain page", () => {
  const nav = read("lib/nav/console-nav.ts");
  const view = read("app/components/domain-views/k-view.tsx");
  assert.match(nav, /id:\s*"K6"[\s\S]*path:\s*"\/risk\/janus-c2"/);
  assert.match(view, /K6JanusC2/);
  assert.match(view, /tab === "K6"/);
});

test("K6 login carrier waits for anonymous and MFA UI instead of using non-waiting isVisible timeouts", () => {
  const carrier = read("tests/e2e/k6-live-acceptance-20260722.spec.ts");

  assert.doesNotMatch(carrier, /(?:usernameInput|mfaHeading)\.isVisible\(\{\s*timeout:/);
  assert.match(carrier, /await expect\(usernameInput\)\.toBeVisible\(\{\s*timeout:\s*8_000\s*\}\)/);
  assert.match(carrier, /await expect\(mfaHeading\)\.toBeVisible\(\{\s*timeout:\s*5_000\s*\}\)/);
});

test("K6 reads and writes through the authenticated Janus proxy", () => {
  const client = read("lib/admin/k6-client.ts");
  const proxy = read("app/api/admin/janus/[...path]/route.ts");
  assert.match(client, /\/api\/admin\/janus/);
  assert.match(client, /devices/);
  assert.match(client, /strategies/);
  assert.match(client, /audit/);
  assert.match(proxy, /ADMIN_AUTH_REQUIRED/);
  assert.match(proxy, /export|exports/);
  assert.match(proxy, /DELETE/);
});

test("K6 application-state reconciliation is an authorized write followed by read-only polling", () => {
  const client = read("lib/admin/k6-client.ts");
  const proxy = read("app/api/admin/janus/[...path]/route.ts");
  const detail = read("app/components/domain-views/k-tabs/k6/device-detail.tsx");
  assert.match(client, /requestK6TakeoverApplied[\s\S]*applied:refresh[\s\S]*method:\s*"POST"/);
  assert.match(client, /reconcileK6Takeover[\s\S]*requestK6TakeoverApplied[\s\S]*fetchK6TakeoverApplied/);
  assert.match(proxy, /applied:refresh/);
  assert.match(detail, /operator\.role !== "viewer"[\s\S]*查询应用态/);
});

test("K6 maps writer, senior operator and administrator authorities exactly", () => {
  const operator = read("app/components/domain-views/k-tabs/k6/use-operator.ts");
  assert.match(operator, /role === "superadmin" \|\| authorities\.includes\("risk_k6_admin"\)[\s\S]*return "admin"/);
  assert.match(operator, /authorities\.includes\("risk_k6_senior"\)[\s\S]*return "senior_operator"/);
  assert.match(operator, /authorities\.includes\("risk_k6_write"\)[\s\S]*return "operator"/);
  assert.doesNotMatch(operator, /authorities\.includes\("risk_k6_write"\)\) return "senior_operator"/);
});

test("K6 strategy action switches keep the submitted remote target contract consistent", () => {
  const editor = read("app/components/domain-views/k-tabs/k6/strategy-editor.tsx");
  assert.match(editor, /fetchK6RemoteTargets/);
  assert.match(editor, /remoteTargetVersion/);
  assert.match(editor, /remoteTargetCatalogVersion/);
  assert.doesNotMatch(editor, /REMOTE_URL_KEYS|["']default["']/);
  assert.match(editor, /return \{ type \};/);
  assert.match(editor, /onChange=\{\(e\) => patch\(\{ action: actionForType\(s\.action, e\.target\.value as StrategyActionType\) \}\)\}/);
  assert.doesNotMatch(editor, /onChange=\{\(e\) => patch\(\{ action: \{ \.\.\.s\.action, type:/);
});

test("K6 approved target catalog is the only runtime source and carries an exact immutable binding", () => {
  const client = read("lib/admin/k6-client.ts");
  const editor = read("app/components/domain-views/k-tabs/k6/strategy-editor.tsx");
  const manual = read("app/components/domain-views/k-tabs/k6/manual-override-modal.tsx");
  const store = read("lib/store/admin/janus-c2-store.ts");
  const types = read("lib/admin/janus-c2/types.ts");
  const contract = read("lib/admin/k6-contract.ts");
  for (const source of [client, editor, manual, store, types, contract]) {
    assert.match(source, /remoteTargetVersion/);
    assert.match(source, /remoteTargetCatalogVersion/);
  }
  assert.match(manual, /fetchK6RemoteTargets/);
  assert.match(manual, /尚无可用批准目标/);
  assert.doesNotMatch(editor + manual + store, /REMOTE_URL_KEYS|["']default["']/);
  assert.match(client, /expectedCatalogVersion/);
  const detail = read("app/components/domain-views/k-tabs/k6/device-detail.tsx");
  const dashboard = read("app/components/domain-views/k-tabs/k6/dashboard.tsx");
  const labels = read("lib/admin/janus-c2/labels.ts");
  assert.match(detail, /remoteTargetBindingLabel\([\s\S]*remoteTargetVersion[\s\S]*remoteTargetCatalogVersion/);
  assert.match(dashboard, /remoteTargetBindingLabel\([\s\S]*remoteTargetVersion[\s\S]*remoteTargetCatalogVersion/);
  assert.match(labels, /目标 v\$\{targetVersion\} · 目录 v\$\{catalogVersion\}/);
});

test("K6 validates every authoritative response and rejects unknown enums instead of inventing defaults", async () => {
  const client = read("lib/admin/k6-client.ts");
  const errors = read("lib/admin/error-messages.ts");
  assert.match(client, /normalizeK6Device/);
  assert.match(client, /normalizeK6Strategy/);
  assert.match(client, /normalizeK6Dashboard/);
  assert.match(client, /normalizeK6ExportFile/);
  assert.doesNotMatch(client, /appOpenCount:\s*0,[\s\S]*\.\.\.maturity/);
  assert.doesNotMatch(client, /versions:\s*Array\.isArray/);
  assert.match(client, /payload\.code\s*!==\s*0/);
  assert.match(client, /Object\.prototype\.hasOwnProperty\.call\(payload,\s*"data"\)/);
  assert.match(client, /readInvalidResponseError/);
  assert.match(client, /formatAdminApiError\("K6_RESPONSE_INVALID"/);
  assert.doesNotMatch(client, /JANUS_API_INVALID_RESPONSE_/);
  assert.match(errors, /K6_RESPONSE_INVALID:[\s\S]*K6 服务返回的数据格式异常/);

  const contract = await import(new URL("../lib/admin/k6-contract.ts", import.meta.url));
  assert.equal(contract.K6_DEVICE_STATUSES.length, 12);
  const validDevice = {
    sid: "SID-1", deviceId: "D-1", firstSeenAt: 1, lastSeenAt: 2, installAt: 1, installDays: 0,
    inviteCode: null, channel: "official", cohortId: null, status: "OBSERVING", desiredStatus: null,
    commandState: null, statusSource: "system", activated: false, remoteUrlKey: null,
    maturityScore: 10, recommendationScore: 20, environmentRiskScore: 0, priorityScore: 30,
    ua: null, platform: "Android", model: "Pixel", osName: "Android", browser: "WebView",
    maturity: { appOpenCount: 1, sessionCount: 1, repeatStreakDays: 0, foregroundDurationSeconds: 10,
      benchmarkViewed: false, optimizeDone: false, marketViewed: false, walletViewed: false },
    environment: { environmentRiskScore: 0, riskReasons: [], isHeadless: false, automationSignalCount: 0,
      fpBlocklistHit: false, screenAnomaly: false, timezoneMismatch: false, languageMismatch: false },
    hitStrategy: null, hitStrategyVersion: null, latestDecision: {}, latestSession: {}, manualOverride: {},
    lastOperatorId: null, lastOperationReason: null, activationKind: null, tags: [], version: 0,
  };
  const normalized = contract.normalizeK6Device(validDevice);
  assert.equal(normalized.status, "OBSERVING");
  assert.equal(normalized.latestDecision, undefined);
  const noActiveDecision = {
    decidedAt: 2,
    action: "BENIGN",
    ruleResults: { passed: false, trace: ["NO_ACTIVE_STRATEGY_MATCH"] },
  };
  assert.deepEqual(
    contract.normalizeK6Device({ ...validDevice, latestDecision: noActiveDecision }).latestDecision.ruleResults,
    [{ label: "无生效策略命中", passed: false, detail: "保持观察" }],
  );
  for (const ruleResults of [
    { passed: false, trace: [], passedLeaves: 0 },
    { passed: false, trace: [], totalLeaves: 0 },
    { passed: false, trace: [], passedLeaves: -1, totalLeaves: 1 },
    { passed: true, trace: [], passedLeaves: 2, totalLeaves: 1 },
  ]) {
    assert.throws(
      () => contract.normalizeK6Device({ ...validDevice, latestDecision: { ...noActiveDecision, ruleResults } }),
      /K6_RESPONSE_INVALID:janus\.device\.latestDecision\.ruleResults/,
    );
  }
  assert.equal(contract.normalizeK6Device({ ...validDevice, priorityScore: -80 }).priorityScore, -80);
  for (const platform of ["iOS", "Android", "windows", "mac", "linux", "unknown"]) {
    assert.equal(contract.normalizeK6Device({ ...validDevice, platform }).platform, platform);
  }
  assert.throws(() => contract.normalizeK6Device({ ...validDevice, platform: "future-os" }), /K6_RESPONSE_INVALID:janus\.device\.platform/);
  assert.throws(() => contract.normalizeK6Device({ ...validDevice, platform: "x".repeat(65) }), /K6_RESPONSE_INVALID:janus\.device\.platform/);
  assert.throws(() => contract.normalizeK6Device({ ...validDevice, status: "UNKNOWN" }), /K6_RESPONSE_INVALID/);
  assert.throws(() => contract.normalizeK6Device({ ...validDevice, maturity: {} }), /K6_RESPONSE_INVALID/);
  const draft = {
    strategyId: "draft_1", name: "规则测试", description: "", status: "draft", version: 1, priority: 10, owner: "ops",
    scope: {}, action: { type: "BENIGN" }, safeguards: {}, rollout: { percent: 100 }, versions: [], createdAt: 1, lockVersion: 0,
    ruleTree: { mode: "ALL", rules: [{ field: "inviteCode", op: "in", value: ["A", "B"], label: "邀请码属于 A 或 B" }] },
  };
  assert.deepEqual(contract.strategyDraftIssues(draft), []);
  assert.match(contract.strategyDraftIssues({ ...draft, ruleTree: { mode: "ALL", rules: [{ field: "inviteCode", op: "in", value: [""], label: "空值" }] } }).join(";"), /规则树/);
  assert.match(contract.strategyDraftIssues({ ...draft, ruleTree: { mode: "WEIGHTED_SCORE", threshold: 10, rules: [{ ...draft.ruleTree.rules[0] }] } }).join(";"), /规则树/);
});

test("K6 five tabs load and fail independently without rendering zero-value conclusions", () => {
  const shell = read("app/components/domain-views/k-tabs/k6-janus-c2.tsx");
  const store = read("lib/store/admin/janus-c2-store.ts");
  const dashboard = read("app/components/domain-views/k-tabs/k6/dashboard.tsx");
  const queue = read("app/components/domain-views/k-tabs/k6/queue.tsx");
  const strategy = read("app/components/domain-views/k-tabs/k6/strategy-center.tsx");
  const audit = read("app/components/domain-views/k-tabs/k6/audit-log.tsx");
  const targets = read("app/components/domain-views/k-tabs/k6/remote-target-manager.tsx");
  for (const loader of ["loadDashboard", "loadDevices", "loadStrategies", "loadAudit"]) {
    assert.match(shell + store, new RegExp(loader));
  }
  assert.doesNotMatch(store, /Promise\.all\(\[\s*fetchAllK6Devices/);
  assert.doesNotMatch(shell, /hydrate/);
  for (const source of [dashboard, queue, strategy, audit]) {
    assert.match(source, /=== "loading"/);
    assert.match(source, /=== "error"/);
    assert.match(source, /重试/);
  }
  assert.match(shell, /id:\s*"targets"[\s\S]*批准目标/);
  assert.match(shell, /K6RemoteTargetManager/);
  assert.match(targets, /fetchK6RemoteTargets/);
  assert.match(targets, /risk_k6_target_manage/);
  assert.match(targets, /新增不可变版本/);
  assert.match(targets, /停用只会取消/);
  assert.doesNotMatch(targets, /lib\/mock|useJanusC2Store|localStorage|persist\s*\(/);
  assert.match(dashboard, /暂无设备样本/);
  assert.doesNotMatch(dashboard, /computeHealth/);
});

test("K6 approved targets use strict real API contracts, stable idempotency and CAS", () => {
  const client = read("lib/admin/k6-client.ts");
  const contract = read("lib/admin/k6-remote-target-contract.ts");
  const proxy = read("app/api/admin/janus/[...path]/route.ts");
  const targetUi = read("app/components/domain-views/k-tabs/k6/remote-target-manager.tsx");
  assert.match(client, /fetchK6RemoteTargets/);
  assert.match(client, /createK6RemoteTargetVersion/);
  assert.match(client, /disableK6RemoteTarget/);
  assert.match(client, /expectedLatestVersion/);
  assert.match(client, /expectedVersion/);
  assert.match(client, /expectedCatalogVersion/);
  assert.match(contract, /normalizeK6RemoteTargets/);
  assert.match(contract, /https:/);
  assert.match(targetUi, /K6OutcomeUncertainError/);
  assert.match(targetUi, /最新数据回读失败/);
  assert.match(targetUi, /pendingCommandCount/);
  assert.match(targetUi, /允许来源/);
  assert.match(proxy, /readOnly = new Set\(\[[\s\S]*"remote-targets"/);
  assert.match(proxy, /joined === "remote-targets"/);
  assert.match(proxy, /remote-targets\\\/\[A-Za-z0-9_.:-\][\s\S]*\\\/disable/);
});

test("K6 writes preserve a stable key for unknown outcomes and do not conflate committed writes with refresh failures", () => {
  const client = read("lib/admin/k6-client.ts");
  const proxy = read("app/api/admin/janus/[...path]/route.ts");
  const store = read("lib/store/admin/janus-c2-store.ts");
  assert.match(client, /class K6OutcomeUncertainError/);
  assert.match(client, /pendingWriteKeys/);
  assert.match(client, /writeFingerprint/);
  assert.match(client, /throw new K6OutcomeUncertainError/);
  assert.match(client, /response\.headers\.get\("X-Nexion-Upstream-Outcome"\) === "unknown"/);
  assert.match(client, /K6OutcomeUncertainError\(stableCommandKey, "上游结果未知"\)/);
  assert.match(proxy, /upstream\.headers\.get\("X-Nexion-Upstream-Outcome"\)/);
  assert.match(proxy, /"X-Nexion-Upstream-Outcome": "unknown"/);
  assert.match(client, /normalize[\s\S]*K6OutcomeUncertainError/);
  assert.match(store, /K6OutcomeUncertainError/);
  assert.doesNotMatch(store, /await get\(\)\.hydrate\(\)/);
});

test("K6 device detail is authoritative and strategy controls cover scope safeguards rollout and real dry-run", () => {
  const detail = read("app/components/domain-views/k-tabs/k6/device-detail.tsx");
  const manualOverride = read("app/components/domain-views/k-tabs/k6/manual-override-modal.tsx");
  const editor = read("app/components/domain-views/k-tabs/k6/strategy-editor.tsx");
  const publish = read("app/components/domain-views/k-tabs/k6/publish-confirm.tsx");
  assert.match(detail, /fetchK6Device/);
  assert.match(detail, /详情加载失败/);
  assert.doesNotMatch(detail, /decisionTrace\(/);
  assert.match(detail, /onApplied=\{setDetail\}/);
  assert.match(editor, /scope[\s\S]*cohortIds/);
  assert.match(editor, /rollout[\s\S]*cohortIds/);
  assert.match(editor, /strategyDraftIssues/);
  assert.doesNotMatch(editor, /dryRunStrategy/);
  assert.doesNotMatch(editor, /这里配置 (?:scope\.cohortIds|rollout\.cohortIds)/);
  assert.match(publish, /runK6DryRun/);
  assert.match(publish, /后端真实预演/);
  assert.match(manualOverride, /reasonLength >= 8 && reasonLength <= 500/);
  assert.match(manualOverride, /maxLength=\{500\}/);
  assert.match(manualOverride, /8–500 字/);
});

test("K6 visible status, audit and export values are localized and strictly shaped", async () => {
  const labels = read("lib/admin/janus-c2/labels.ts");
  const audit = read("app/components/domain-views/k-tabs/k6/audit-log.tsx");
  const strategy = read("app/components/domain-views/k-tabs/k6/strategy-center.tsx");
  const client = read("lib/admin/k6-client.ts");
  assert.match(labels, /AUDIT_ACTION_LABEL/);
  assert.match(audit, /auditActionLabel/);
  assert.doesNotMatch(audit, /<span className="k6-audit-action">\{a\.action\}<\/span>/);
  assert.match(client, /normalizeK6ExportFile/);
  assert.match(client, /"health" \| "audit" \| "funnel"/);
  assert.match(audit, /auditSnapshotText/);
  assert.doesNotMatch(audit, /KEY_LABEL|其他变更|未知策略动作/);
  assert.match(strategy, /s\.status === "draft"[\s\S]*删除草稿/);
  assert.doesNotMatch(strategy, /s\.status === "draft" \|\| s\.status === "archived"/);
  assert.match(strategy, /已发布或归档记录保留，不可删除/);
  assert.match(strategy, /aria-label=\{`确认删除草稿策略/);

  const presenter = await import(new URL("../lib/admin/k6-audit-presenter.ts", import.meta.url));
  const snapshot = {
    strategyId: "maturity_recommend", templateKey: "maturity_recommend", lockVersion: 7,
    createdAt: 1720000000000, publishedAt: 1720000001234, versions: [{ configHash: "secret" }],
    healthConfig: { maxHitRate: 20 }, configHash: "hash", requestHash: "request-hash",
    name: "成熟度建议", status: "active", version: 2, priority: 100, owner: "ops",
    scope: { channels: ["official"], inviteCodes: ["INV-A"], cohortIds: ["正式人群"] },
    action: { type: "RECOMMEND" }, safeguards: { maxDailyRecommendations: 30 },
    rollout: { percent: 50, cohortIds: ["灰度人群"] },
  };
  const text = presenter.auditSnapshotText(snapshot);
  assert.match(text, /名称 成熟度建议/);
  assert.match(text, /策略状态 生效中/);
  assert.match(text, /命中动作 进入建议下发/);
  assert.match(text, /官网/);
  for (const leak of ["maturity_recommend", "strategyId", "templateKey", "lockVersion", "createdAt", "publishedAt", "versions", "healthConfig", "configHash", "requestHash", "secret"]) {
    assert.doesNotMatch(text, new RegExp(leak));
  }
  const unknown = presenter.auditSnapshotText({
    action: "FUTURE_ACTION",
    hidden: "raw",
    environment: { riskReasons: ["ENGINEERING_RISK_CODE"] },
    latestDecision: { blockedReason: "INTERNAL_BLOCK_CODE" },
  });
  assert.equal(unknown, "—");
  assert.match(presenter.auditSnapshotText({ platform: "windows" }), /设备平台 Windows/);
  const exported = JSON.stringify(presenter.auditExportRows([{ auditId: "1", actorId: "ops", action: "K6_STRATEGY_CREATED", targetType: "strategy", targetId: "maturity_recommend", beforeSnapshot: null, afterSnapshot: snapshot, sourceContext: snapshot, createdAt: 1720000000000, requestId: "request-secret" }]));
  assert.match(exported, /创建策略/);
  assert.match(exported, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  assert.match(exported, /对象名称/);
  assert.match(exported, /成熟度建议/);
  assert.match(exported, /追踪号/);
  assert.match(exported, /request-secret/);
  for (const leak of ["maturity_recommend", "sourceContext", "configHash", "templateKey", "ENGINEERING_RISK_CODE", "INTERNAL_BLOCK_CODE"]) assert.doesNotMatch(exported, new RegExp(leak));
});

test("K6 production page has no mock or browser-persistence source of truth", () => {
  const files = [
    "app/components/domain-views/k-tabs/k6-janus-c2.tsx",
    "app/components/domain-views/k-tabs/k6/dashboard.tsx",
    "app/components/domain-views/k-tabs/k6/queue.tsx",
    "app/components/domain-views/k-tabs/k6/strategy-center.tsx",
    "app/components/domain-views/k-tabs/k6/audit-log.tsx",
    "app/components/domain-views/k-tabs/k6/remote-target-manager.tsx",
    "lib/store/admin/janus-c2-store.ts",
  ].map(read).join("\n");
  assert.doesNotMatch(files, /lib\/mock\/admin\/janus-c2/);
  assert.doesNotMatch(files, /localStorage|persist\s*\(/);
  assert.match(files, /loadDashboard|loadDevices|loadStrategies|loadAudit/);
});

test("K6 retries writes with one stable idempotency key and exports both health and funnel", () => {
  const client = read("lib/admin/k6-client.ts");
  const dashboard = read("app/components/domain-views/k-tabs/k6/dashboard.tsx");
  assert.match(client, /headers\.set\("Idempotency-Key", stableCommandKey\)/);
  assert.match(client, /response = await guardedFetch\(`\$\{BASE\}\$\{path\}`, options\);[\s\S]*catch[\s\S]*response = await guardedFetch\(`\$\{BASE\}\$\{path\}`, options\)/);
  assert.match(client, /"health" \| "audit" \| "funnel"/);
  assert.match(dashboard, /exportReport\("funnel", "csv"\)/);
});

test("K6 CSV exports neutralize formulas hidden behind whitespace and control characters", () => {
  const files = [
    "app/components/domain-views/k-tabs/k6/dashboard.tsx",
    "app/components/domain-views/k-tabs/k6/audit-log.tsx",
  ].map(read).join("\n");
  assert.equal((files.match(/\^\[\\s\\u0000-\\u001f\]\*\[=\+\\-@\]/g) ?? []).length, 2);
});

test("K6 current App consumes report, pending command and ACK through one exact approved-target contract", () => {
  const api = readApp("src/api/janus-api.ts");
  const coordinator = readApp("src/services/janus-c2.ts");
  const runtime = readApp("src/services/janus-runtime.ts");
  const app = readApp("src/App.vue");
  const combined = `${api}\n${coordinator}\n${runtime}`;

  for (const endpoint of [
    "/api/app/janus/reports",
    "/api/app/janus/commands/pending",
    "/api/app/janus/commands/ack",
  ]) assert.match(api, new RegExp(endpoint.replaceAll("/", "\\/")));
  for (const field of [
    "remoteUrlKey",
    "remoteTargetVersion",
    "remoteTargetCatalogVersion",
    "remoteTargetUrl",
  ]) assert.match(combined, new RegExp(field));
  assert.match(api, /REMOTE_STATUSES\.has\(desiredStatus\) \? bindingCount !== 4 : bindingCount !== 0/);
  assert.match(runtime, /parsed\.protocol !== "https:"/);
  assert.match(coordinator, /nexgrid-janus-pending-report-v2/);
  assert.match(coordinator, /nexgrid-janus-pending-ack-v2/);
  assert.match(coordinator, /scope:\s*\(\) => String\(sessionVault\.read\(\)\?\.user\.userId/);
  assert.match(app, /startJanusC2Sync\(\)/);
  assert.match(app, /stopJanusC2Sync\(\)/);
  assert.doesNotMatch(combined, /remoteUrlKey\s*===\s*["'](?:default|backup|promo)["']/);
});

test("K6 App command consumption revalidates the immutable target and returns its canonical HTTPS URL", () => {
  const service = readWorkspace(
    "nexion-backend/src/main/java/ffdd/opsconsole/janus/application/OpsJanusService.java",
  );
  const tests = readWorkspace(
    "nexion-backend/src/test/java/ffdd/opsconsole/janus/application/OpsJanusServiceTest.java",
  );
  assert.match(service, /pendingCommand[\s\S]*resolveRemoteTarget\(remoteKey,\s*remoteVersion,\s*remoteCatalogVersion\)/);
  assert.match(service, /response\.put\("remoteTargetUrl",\s*target\.url\(\)\)/);
  assert.match(service, /JANUS_REMOTE_TARGET_UNAVAILABLE/);
  assert.match(service, /JANUS_REMOTE_TARGET_UNEXPECTED/);
  assert.match(tests, /pendingRemoteCommandCarriesTheExactRevalidatedApprovedUrl/);
  assert.match(tests, /pendingRemoteCommandFailsClosedWhenTheExactTargetCannotBeConsumed/);
});
