import { expect, test, type APIResponse, type Browser, type Page } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeK6DevicePage } from "../../lib/admin/k6-contract";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const BACKEND_URL = process.env.NEXION_BACKEND_URL ?? "http://127.0.0.1:8110";
const SOURCE_USERNAME = requiredEnv("K6_SOURCE_USERNAME");
const SOURCE_PASSWORD = requiredEnv("K6_SOURCE_PASSWORD");
const READONLY_USERNAME = requiredEnv("K6_READONLY_USERNAME");
const READONLY_PASSWORD = requiredEnv("K6_READONLY_PASSWORD");
const READONLY_TOTP_SECRET = requiredEnv("K6_READONLY_TOTP_SECRET");
const DB_PASSWORD = requiredEnv("K6_DB_PASSWORD");
const MYSQL = process.env.K6_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.K6_DB_NAME ?? "nexion";
const REDIS_PASSWORD = requiredEnv("K6_REDIS_PASSWORD");
const REDIS_CLI = process.env.K6_REDIS_CLI ?? "D:/software/Redis-8.6.1/redis-cli.exe";
const REDIS_DB = process.env.K6_REDIS_DB ?? "13";
const EVIDENCE_DIR = process.env.K6_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/final/K6/evidence";
const RESTRICTED_DIR = process.env.K6_RESTRICTED_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/restricted/k6";
const RUN = Date.now().toString(36).toLowerCase();
const APP_PHONE = `166${String(Date.now()).slice(-8)}`;
const APP_REFERRAL = `K6${RUN}`.slice(0, 32);
const APP_DEVICE_ID = `k6-device-${RUN}`;
const OPERATOR_USERNAME = `k6_operator_${RUN}`.slice(0, 64);
const ADMIN_USERNAME = `k6_admin_${RUN}`.slice(0, 64);
const ADMIN_ROLE_CODE = `ACC_K6_AD_${RUN}`.slice(0, 64).toUpperCase();
const OPERATOR_ROLE_CODE = `ACC_K6_OP_${RUN}`.slice(0, 64).toUpperCase();
const REASON = "K6验收：Janus策略与设备命令闭环复核";
const MFA_SECRETS = new Map<string, string>();
MFA_SECRETS.set(READONLY_USERNAME, READONLY_TOTP_SECRET);

type Envelope<T> = { code: number; message?: string; data: T };
type Strategy = { strategyId: string; name: string; status: string; version: number; lockVersion: number };
type Device = { sid: string; status: string; version: number; desiredStatus?: string; commandState?: string };

let appUserId = 50_000_000 + Number(String(Date.now()).slice(-7));
let sid = "";
let strategyId = "";
let appToken = "";
let tempAdminIds: string[] = [];
let tempRoleIds: string[] = [];
let ownsRunFixtures = false;
let auxiliaryRolePages: Page[] = [];
const extraStrategyIds: string[] = [];
const summary: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  chromium: true,
  mockMainFlow: false,
  statuses: [],
  strategyId: null,
  sid: null,
  appReportReplay: null,
  unknownOutcomeStableKey: null,
  auditCount: 0,
  outboxCount: 0,
  concurrentIdempotency: null,
  malformedFailClosed: null,
};

test.describe.configure({ mode: "serial", timeout: 360_000 });
test.use({ trace: "on", video: "on" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await mkdir(RESTRICTED_DIR, { recursive: true });
  sid = `J-${sha256(JSON.stringify(`${appUserId}:${APP_DEVICE_ID}`)).slice(0, 32).toUpperCase()}`;
  summary.sid = sid;
  const collisions = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin WHERE username IN ('${ADMIN_USERNAME}','${OPERATOR_USERNAME}')),',',
      (SELECT COUNT(*) FROM nx_admin_role WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}')),',',
      (SELECT COUNT(*) FROM nx_user
        WHERE id=${appUserId} OR phone='${APP_PHONE}' OR referral_code='${APP_REFERRAL}')
    );
  `).trim();
  if (collisions !== "0,0,0") throw new Error(`K6 fixture collision; no cleanup attempted: ${collisions}`);
  if (SOURCE_USERNAME === READONLY_USERNAME) {
    throw new Error("K6 source Owner and readonly verifier must be different run-scoped accounts");
  }
  const baseActors = Number(mysql(`
    SELECT COUNT(*) FROM nx_admin
     WHERE username IN ('${SOURCE_USERNAME}','${READONLY_USERNAME}')
       AND status=1 AND super_admin=0 AND is_deleted=0;
  `).trim());
  if (baseActors !== 2) throw new Error(`K6 source/readonly actors must both be active non-SUPER accounts: ${baseActors}`);
  mysql(`
    START TRANSACTION;
    INSERT INTO nx_admin_role(role_code,role_name,remark,status,is_deleted)
    VALUES ('${ADMIN_ROLE_CODE}','K6 Run Owner','${RUN} 独立高级操作员',1,0);
    INSERT INTO nx_admin_role(role_code,role_name,remark,status,is_deleted)
    VALUES ('${OPERATOR_ROLE_CODE}','K6 Run Operator','${RUN} 独立普通操作员',1,0);
    INSERT INTO nx_admin_role_permission(role_id,permission_id,is_deleted)
    SELECT role.id,permission.id,0
      FROM nx_admin_role role JOIN nx_admin_permission permission
        ON permission.permission_code IN ('risk_k6_read','risk_k6_write','risk_k6_senior','risk_k6_admin','risk_k6_target_manage')
     WHERE role.role_code='${ADMIN_ROLE_CODE}' AND role.is_deleted=0 AND permission.is_deleted=0;
    INSERT INTO nx_admin_role_permission(role_id,permission_id,is_deleted)
    SELECT role.id,permission.id,0
      FROM nx_admin_role role JOIN nx_admin_permission permission
        ON permission.permission_code IN ('risk_k6_read','risk_k6_write')
     WHERE role.role_code='${OPERATOR_ROLE_CODE}' AND role.is_deleted=0 AND permission.is_deleted=0;
    INSERT INTO nx_admin_role_menu(role_id,menu_id,is_deleted)
    SELECT role.id,menu.id,0 FROM nx_admin_role role JOIN nx_admin_menu menu
      ON menu.menu_code IN ('K','K6') AND menu.is_deleted=0
     WHERE role.role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND role.is_deleted=0;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${ADMIN_USERNAME}',password_hash,'K6独立Owner',0,1,0
      FROM nx_admin WHERE username='${SOURCE_USERNAME}' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${OPERATOR_USERNAME}',password_hash,'K6独立普通操作员',0,1,0
      FROM nx_admin WHERE username='${SOURCE_USERNAME}' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT admin.id,role.id,0 FROM nx_admin admin JOIN nx_admin_role role ON role.role_code='${ADMIN_ROLE_CODE}'
    WHERE admin.username='${ADMIN_USERNAME}';
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT admin.id,role.id,0 FROM nx_admin admin JOIN nx_admin_role role ON role.role_code='${OPERATOR_ROLE_CODE}'
    WHERE admin.username='${OPERATOR_USERNAME}';
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,status,is_deleted)
    SELECT ${appUserId},'86','${APP_PHONE}',password_hash,'K6 App验收用户','${APP_REFERRAL}','ACTIVE',0
    FROM nx_admin WHERE username='${SOURCE_USERNAME}' AND is_deleted=0 LIMIT 1;
    COMMIT;
  `);
  ownsRunFixtures = true;
  const fixtureCounts = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin WHERE username IN ('${ADMIN_USERNAME}','${OPERATOR_USERNAME}') AND super_admin=0 AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_admin_role WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND is_deleted=0)
    );
  `).trim().split(",").map(Number);
  if (fixtureCounts[0] !== 2 || fixtureCounts[1] !== 2) {
    throw new Error(`K6 run-scoped non-super fixtures invalid: accounts=${fixtureCounts[0]}, roles=${fixtureCounts[1]}`);
  }
  tempAdminIds = mysql(`
    SELECT GROUP_CONCAT(id ORDER BY id) FROM nx_admin
     WHERE username IN ('${ADMIN_USERNAME}','${OPERATOR_USERNAME}') AND is_deleted=0;
  `).trim().split(",").filter(Boolean);
  tempRoleIds = mysql(`
    SELECT GROUP_CONCAT(id ORDER BY id) FROM nx_admin_role
     WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND is_deleted=0;
  `).trim().split(",").filter(Boolean);
  if (tempAdminIds.length !== 2 || tempRoleIds.length !== 2) {
    throw new Error(`K6 run-scoped fixture ids missing: adminIds=${tempAdminIds.length}, roleIds=${tempRoleIds.length}`);
  }
  const persistedUserId = Number(mysql(`SELECT id FROM nx_user WHERE phone='${APP_PHONE}' AND is_deleted=0 LIMIT 1;`).trim());
  if (persistedUserId !== appUserId) throw new Error("K6 App 验收用户创建失败");
});

test.afterEach(async ({ page }) => {
  for (const auxiliaryPage of auxiliaryRolePages) {
    await safeServerLogout(auxiliaryPage);
    await auxiliaryPage.context().close().catch(() => undefined);
  }
  auxiliaryRolePages = [];
  await safeServerLogout(page);
});

test.afterAll(async () => {
  try {
    if (ownsRunFixtures) {
      const cleanupErrors: string[] = [];
      const runCleanupPhase = <T>(name: string, action: () => T): T | undefined => {
        try {
          return action();
        } catch (error) {
          cleanupErrors.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
          return undefined;
        }
      };
      runCleanupPhase("business fixtures", cleanupBusinessFixtures);
      const redisCleanup = runCleanupPhase("Redis", cleanupRedis);
      if (redisCleanup) summary.redisCleanup = redisCleanup;
      runCleanupPhase("accounts", cleanupAccounts);
      runCleanupPhase("roles", cleanupRoles);
      const cleanupCounts = runCleanupPhase("residual verification", verifyCleanup);
      if (cleanupCounts) summary.cleanupCounts = cleanupCounts;
      summary.cleanupPhaseErrors = cleanupErrors;
      if (cleanupErrors.length > 0) {
        throw new Error(`K6 cleanup phases failed: ${cleanupErrors.join(" | ")}`);
      }
      summary.cleanup = "completed";
    } else {
      summary.cleanup = "not-owned-no-cleanup";
    }
    summary.finishedAt = new Date().toISOString();
  } catch (error) {
    summary.cleanup = error instanceof Error ? error.message : "cleanup failed";
    throw error;
  } finally {
    await writeFile(path.join(RESTRICTED_DIR, "k6-live-run-summary.json"), JSON.stringify(summary, null, 2), "utf8");
  }
});

test("首次用户以本 Run 独立非 SUPER Owner 从根路径登录并由真实侧栏进入 K6，四个工作区与十二态契约完整", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  const anonymous = await page.request.get(`${BASE_URL}/api/admin/janus/metadata`);
  expect(anonymous.status()).toBe(401);

  await loginFromRoot(page, ADMIN_USERNAME);
  await openK6FromSidebar(page);
  await expect(page.getByRole("navigation", { name: "C2 控制台模块" })).toBeVisible();
  for (const label of ["看板", "设备队列", "策略中心", "审计日志"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }

  const metadata = await envelope<{ statuses: string[]; transitions: Record<string, unknown> }>(
    await page.request.get("/api/admin/janus/metadata"),
  );
  expect(metadata.data.statuses).toEqual([
    "NEW", "OBSERVING", "RECOMMENDED", "HIT", "ACTIVATED", "ENV_FILTERED",
    "MANUAL_HOLD", "MANUAL_FORCED", "BLOCKED", "STALE", "RESET", "ERROR",
  ]);
  expect(Object.keys(metadata.data.transitions)).toHaveLength(12);
  summary.statuses = metadata.data.statuses;

  appToken = await loginApp(page);
  const firstReport = reportPayload(`k6-report-initial-${RUN}`, Date.now());
  const first = await appEnvelope<Device>(page, "POST", "/api/app/janus/reports", firstReport);
  // A live environment may already have an active strategy, so the initial
  // report can legitimately be promoted beyond the benign fallback. It must
  // still be one of the server-owned twelve states and never echo client ERROR.
  expect(metadata.data.statuses).toContain(first.data.status);
  expect(first.data.status).not.toBe("ERROR");
  expect(first.data.sid).toBe(sid);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("十二态服务端分布", { exact: true })).toBeVisible();
  await expect(page.getByText("设备总数").first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-root-sidebar-dashboard-12-states.png"), fullPage: true });
  expect(runtimeErrors).toEqual([]);
});

test("管理员从可见策略中心创建、真实预演发布，App 再上报后收到命令并 ACK", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginFromRoot(page, ADMIN_USERNAME);
  await openK6FromSidebar(page);
  await page.getByRole("button", { name: /策略中心/ }).click();
  await expect(page.getByText("多策略管理", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /新建策略/ }).click();
  const editor = page.getByRole("dialog", { name: "新建策略" });
  await editor.locator("#st-tpl").selectOption("manual_pilot");
  await editor.locator("#st-name").fill(`K6闭环策略-${RUN}`);
  await editor.locator("#st-desc").fill("真实App上报、服务端判定、命令下发与确认闭环");
  // The approved remote-target catalogue may legitimately be empty. Use a
  // non-remote server-owned action for the always-runnable acceptance chain;
  // exact remote-target consumption is covered by the K6 contract tests.
  await editor.locator("#st-action").selectOption("MANUAL_HOLD");
  await editor.locator("#st-prio").fill("1000");
  const official = editor.locator("button").filter({ hasText: /^官网$/ }).first();
  if (!((await official.getAttribute("class")) ?? "").includes("active")) await official.click();
  await editor.getByLabel("每日最大命中数").fill("20");
  await editor.getByLabel("要求最近上报分钟内").fill("30");
  await editor.locator("#st-rollout").fill("100");
  const createdResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && /\/api\/admin\/janus\/strategies$/.test(new URL(response.url()).pathname));
  await editor.getByRole("button", { name: "创建策略" }).click();
  const createdHttpResponse = await createdResponse;
  const created = await envelope<Strategy>(createdHttpResponse);
  expect(created.data.status).toBe("draft");
  strategyId = created.data.strategyId;
  summary.strategyId = strategyId;
  await expect(page.locator(".k6-strat-card").filter({ hasText: created.data.name })).toContainText("草稿");

  const concurrentKey = `k6-e2e-${RUN}-concurrent`;
  const concurrentBody = {
    ...(createdHttpResponse.request().postDataJSON() as Record<string, unknown>),
    name: `K6闭环策略-${RUN}-并发`,
    description: "相同幂等键并发创建只能产生一个服务端事实",
  };
  const [concurrentA, concurrentB] = await Promise.all([
    page.request.post("/api/admin/janus/strategies", {
      headers: { "Idempotency-Key": concurrentKey }, data: concurrentBody,
    }),
    page.request.post("/api/admin/janus/strategies", {
      headers: { "Idempotency-Key": concurrentKey }, data: concurrentBody,
    }),
  ]);
  const concurrentResponses = [concurrentA, concurrentB];
  const concurrentStatuses = concurrentResponses.map((response) => response.status()).sort((a, b) => a - b);
  expect(concurrentStatuses[0]).toBe(200);
  expect([200, 409]).toContain(concurrentStatuses[1]);
  for (const response of concurrentResponses.filter((item) => item.status() === 409)) {
    expect((await response.json()).message).toBe("IDEMPOTENCY_IN_PROGRESS");
  }
  const concurrentWinner = await envelope<Strategy>(concurrentResponses.find((response) => response.status() === 200)!);
  extraStrategyIds.push(concurrentWinner.data.strategyId);
  const concurrentRetry = await envelope<Strategy>(await page.request.post("/api/admin/janus/strategies", {
    headers: { "Idempotency-Key": concurrentKey }, data: concurrentBody,
  }));
  expect(concurrentRetry.data.strategyId).toBe(concurrentWinner.data.strategyId);
  const concurrentConflict = await page.request.post("/api/admin/janus/strategies", {
    headers: { "Idempotency-Key": concurrentKey },
    data: { ...concurrentBody, description: "同键不同载荷必须拒绝" },
  });
  expect(concurrentConflict.status()).toBe(409);
  expect((await concurrentConflict.json()).message).toBe("IDEMPOTENCY_CONFLICT");
  const concurrentCounts = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_janus_command WHERE idempotency_key='${concurrentKey}'),',',
      (SELECT COUNT(*) FROM nx_janus_strategy WHERE strategy_id='${concurrentWinner.data.strategyId}')
    );
  `).trim().split(",").map(Number);
  expect(concurrentCounts).toEqual([1, 1]);
  summary.concurrentIdempotency = { statuses: concurrentStatuses, retry: "same-result", conflict: 409, facts: concurrentCounts };

  const card = strategyCard(page, strategyId, created.data.name);
  const dryRunResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().includes(`/api/admin/janus/strategies/${strategyId}/dry-run`));
  await card.getByRole("button", { name: "发布", exact: true }).click();
  const dryRun = await dryRunResponse;
  const dryRunPayload = await dryRun.json() as { code?: number; message?: string };
  expect(dryRun.status(), dryRunPayload.message).toBe(200);
  expect(dryRunPayload.code, dryRunPayload.message).toBe(0);
  const publishDialog = page.getByRole("dialog", { name: new RegExp(`发布策略 ${escapeRegExp(created.data.name)}`) });
  await expect(publishDialog.getByText("预计命中", { exact: true })).toBeVisible();
  await expect(publishDialog.getByText("…")).toHaveCount(0, { timeout: 15_000 });
  await publishDialog.locator("#pub-note").fill(`${REASON}首次发布`);
  await publishDialog.getByRole("button", { name: "确认发布" }).click();
  await expect(publishDialog).toHaveCount(0);
  await expect(strategyCard(page, strategyId, created.data.name)).toContainText("生效");

  const secondPayload = reportPayload(`k6-report-hit-${RUN}`, Date.now());
  const second = await appEnvelope<Device>(page, "POST", "/api/app/janus/reports", secondPayload);
  expect(second.data.status).toBe("MANUAL_HOLD");
  const replay = await appEnvelope<Device>(page, "POST", "/api/app/janus/reports", secondPayload);
  expect(replay.data.sid).toBe(second.data.sid);
  summary.appReportReplay = "same-payload-acked";

  const conflictPayload = { ...secondPayload, channel: "test" };
  const replayConflict = await appRaw(page, "POST", "/api/app/janus/reports", conflictPayload);
  expect(replayConflict.status()).toBe(409);
  expect((await replayConflict.json()).message).toBe("JANUS_REPORT_REPLAY_CONFLICT");
  const invalid = await appRaw(page, "POST", "/api/app/janus/reports", { reportId: `invalid-${RUN}` });
  expect(invalid.status()).toBe(422);
  const invalidPlatformReportId = `k6-report-platform-${RUN}`;
  const invalidPlatform = await appRaw(page, "POST", "/api/app/janus/reports", {
    ...reportPayload(invalidPlatformReportId, Date.now()),
    platform: "future-os",
  });
  expect(invalidPlatform.status()).toBe(422);
  expect((await invalidPlatform.json()).message).toBe("PLATFORM_INVALID");
  expect(Number(mysql(`SELECT COUNT(*) FROM nx_janus_evaluation WHERE sid='${sid}' AND report_id='${invalidPlatformReportId}';`).trim())).toBe(0);

  const pending = await appEnvelope<Record<string, unknown>>(page, "GET",
    `/api/app/janus/commands/pending?deviceId=${encodeURIComponent(APP_DEVICE_ID)}`);
  expect(pending.data.hasCommand).toBe(true);
  expect(pending.data.desiredStatus).toBe("MANUAL_HOLD");
  expect(pending.data.remoteUrlKey).toBeUndefined();
  const revision = Number(pending.data.revision);
  expect(revision).toBeGreaterThan(0);
  const ack = await appEnvelope<Record<string, unknown>>(page, "POST", "/api/app/janus/commands/ack", {
    deviceId: APP_DEVICE_ID,
    revision,
    success: true,
    appliedStatus: "MANUAL_HOLD",
    message: "K6 acceptance applied",
  });
  expect(ack.data.state).toBe("ACKED");
  const ackReplay = await appEnvelope<Record<string, unknown>>(page, "POST", "/api/app/janus/commands/ack", {
    deviceId: APP_DEVICE_ID,
    revision,
    success: true,
    appliedStatus: "MANUAL_HOLD",
    message: "K6 acceptance retry",
  });
  expect(ackReplay.data.state).toBe("ACKED");

  const queueContract = await envelope<unknown>(
    await page.request.get(`/api/admin/janus/devices?q=${encodeURIComponent(sid)}&pageNum=1&pageSize=200`),
  );
  expect(() => normalizeK6DevicePage(queueContract.data), "真实设备队列响应必须满足前端严格契约").not.toThrow();
  const queueAllContract = await envelope<unknown>(
    await page.request.get("/api/admin/janus/devices?pageNum=1&pageSize=200"),
  );
  expect(() => normalizeK6DevicePage(queueAllContract.data), "完整真实设备队列响应必须满足前端严格契约").not.toThrow();
  await page.getByRole("button", { name: /设备队列/ }).click();
  await expect(page.getByText(sid, { exact: true })).toBeVisible();
  await page.getByText(sid, { exact: true }).click();
  const detail = page.getByRole("dialog", { name: `设备详情 ${sid}` });
  await expect(detail).toContainText("人工挂起");
  await expect(detail).toContainText(strategyId);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-strategy-report-command-app-ack.png"), fullPage: true });
  await detail.getByRole("button", { name: "关闭" }).click();
  expect(runtimeErrors).toEqual([]);
});

test("权限、高风险门禁、409/422 与 503 失败关闭均由真实链路拒绝且可恢复", async ({ page, browser }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginFromRoot(page, ADMIN_USERNAME);
  await openK6FromSidebar(page);
  await page.getByRole("button", { name: /设备队列/ }).click();
  const current = await envelope<{ records: Device[] }>(await page.request.get(`/api/admin/janus/devices?q=${sid}`));
  const device = current.data.records.find((row) => row.sid === sid);
  expect(device).toBeTruthy();

  const missingRemote = await page.request.post(`/api/admin/janus/devices/${sid}/status`, {
    headers: { "Idempotency-Key": `k6-e2e-${RUN}-remote-required` },
    data: {
      targetStatus: "MANUAL_FORCED", reasonCategory: "现场演示需要", reasonText: `${REASON}缺少远程地址`,
      effectiveTiming: "immediate", confirmationMode: "strong_single", expectedDeviceVersion: device!.version,
    },
  });
  expect(missingRemote.status()).toBe(409);
  expect((await missingRemote.json()).message).toBe("REMOTE_TARGET_REQUIRED");
  const stale = await page.request.post(`/api/admin/janus/devices/${sid}/status`, {
    headers: { "Idempotency-Key": `k6-e2e-${RUN}-stale` },
    data: {
      targetStatus: "OBSERVING", reasonCategory: "复核环境信号", reasonText: `${REASON}并发旧版本`,
      effectiveTiming: "immediate", confirmationMode: "standard",
      expectedDeviceVersion: Math.max(0, device!.version - 1),
    },
  });
  expect(stale.status()).toBe(409);

  const appOnAdmin = await page.request.get(`${BACKEND_URL}/api/admin/janus/metadata`, {
    headers: { Authorization: `Bearer ${appToken}` },
  });
  expect(appOnAdmin.status()).toBe(403);

  const auditorPage = await loginRole(browser, READONLY_USERNAME);
  await openK6FromSidebar(auditorPage);
  await auditorPage.getByRole("button", { name: /策略中心/ }).click();
  await expect(auditorPage.getByText("只读身份", { exact: true })).toBeVisible();
  await expect(auditorPage.getByRole("button", { name: /新建策略/ })).toHaveCount(0);
  const auditorWrite = await auditorPage.request.post("/api/admin/janus/strategies", {
    headers: { "Idempotency-Key": `k6-e2e-${RUN}-auditor` }, data: {},
  });
  expect(auditorWrite.status()).toBe(403);
  await safeServerLogout(auditorPage);
  await auditorPage.context().close();

  const operatorPage = await loginRole(browser, OPERATOR_USERNAME);
  await openK6FromSidebar(operatorPage);
  await operatorPage.getByRole("button", { name: /策略中心/ }).click();
  await expect(operatorPage.getByText("只读身份", { exact: true })).toBeVisible();
  await expect(operatorPage.getByRole("button", { name: /新建策略/ })).toHaveCount(0);
  const operatorSession = await envelope<{ session: { authorities: string[] } }>(
    await operatorPage.request.get("/api/admin/auth/session"),
  );
  expect(operatorSession.data.session.authorities).toContain("risk_k6_write");
  expect(operatorSession.data.session.authorities).not.toContain("risk_k6_senior");
  expect(operatorSession.data.session.authorities).not.toContain("risk_k6_admin");
  const strategy = await fetchStrategy(operatorPage, strategyId);
  const operatorPublish = await operatorPage.request.post(`/api/admin/janus/strategies/${strategyId}/publish`, {
    headers: { "Idempotency-Key": `k6-e2e-${RUN}-operator-publish` },
    data: { expectedVersion: strategy.lockVersion, reason: REASON, dryRunId: "not-owned", configHash: "0".repeat(64) },
  });
  expect(operatorPublish.status()).toBe(403);
  await safeServerLogout(operatorPage);
  await operatorPage.context().close();

  await page.route("**/api/admin/janus/devices**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, message: "JANUS_BACKEND_UNAVAILABLE", data: null }) });
    } else await route.continue();
  });
  await page.getByRole("button", { name: /看板/ }).click();
  await page.getByRole("button", { name: /设备队列/ }).click();
  await expect(page.getByText(/设备队列读取失败，数据未更新/)).toBeVisible();
  await expect(page.getByText(sid, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-rbac-503-fail-closed.png"), fullPage: true });
  await page.unroute("**/api/admin/janus/devices**");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText(sid, { exact: true })).toBeVisible();

  await page.route("**/api/admin/janus/devices**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "ok", data: { records: [{ sid, status: "FUTURE_STATE" }] } }),
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: /看板/ }).click();
  await page.getByRole("button", { name: /设备队列/ }).click();
  await expect(page.getByText(/设备队列读取失败，数据未更新/)).toBeVisible();
  await expect(page.getByText(sid, { exact: true })).toHaveCount(0);
  summary.malformedFailClosed = true;
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03b-malformed-fail-closed.png"), fullPage: true });
  await page.unroute("**/api/admin/janus/devices**");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText(sid, { exact: true })).toBeVisible();
  expect(runtimeErrors).toEqual([]);
});

test("结果未知同键重试、暂停再发布、回滚、复制删除、归档、审计导出与重登形成闭环", async ({ page }) => {
  const runtimeErrors = collectRuntimeErrors(page);
  await loginFromRoot(page, ADMIN_USERNAME);
  await openK6FromSidebar(page);
  await page.getByRole("button", { name: /策略中心/ }).click();
  const strategy = await fetchStrategy(page, strategyId);
  const card = strategyCard(page, strategyId, strategy.name);
  let pauseAttempts = 0;
  const commandKeys: string[] = [];
  await page.route(`**/api/admin/janus/strategies/${strategyId}/pause`, async (route) => {
    pauseAttempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (pauseAttempts === 1) {
      const upstream = await route.fetch();
      expect(upstream.ok()).toBeTruthy();
      await route.fulfill({ status: 200, contentType: "application/json", body: "{broken-success" });
      return;
    }
    await route.continue();
  });
  await card.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(page.locator(".k6-empty.k6-error")).toContainText(/结果未知|响应|请求号/);
  await card.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(card).toContainText("暂停");
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  summary.unknownOutcomeStableKey = true;
  await page.unroute(`**/api/admin/janus/strategies/${strategyId}/pause`);

  await card.getByRole("button", { name: "发布", exact: true }).click();
  let publishDialog = page.getByRole("dialog", { name: new RegExp(`发布策略 ${escapeRegExp(strategy.name)}`) });
  await expect(publishDialog.getByText("…")).toHaveCount(0, { timeout: 15_000 });
  await publishDialog.locator("#pub-note").fill(`${REASON}暂停后再次发布`);
  await publishDialog.getByRole("button", { name: "确认发布" }).click();
  await expect(publishDialog).toHaveCount(0);

  await card.getByRole("button", { name: /版本/ }).click();
  const versions = page.getByRole("dialog", { name: new RegExp(`版本历史 ${escapeRegExp(strategy.name)}`) });
  const rollbackButton = versions.getByRole("button", { name: "回滚到此", exact: true }).first();
  await expect(rollbackButton).toBeVisible();
  await rollbackButton.click();
  await versions.locator("#rb-reason").fill(`${REASON}回滚验证`);
  await versions.getByRole("button", { name: "确认回滚" }).click();
  await expect(versions).toHaveCount(0);

  await card.getByRole("button", { name: "复制", exact: true }).click();
  const copy = page.locator(".k6-strat-card").filter({ hasText: `${strategy.name}(副本)` });
  await expect(copy).toContainText("草稿");
  await copy.getByRole("button", { name: "删除草稿", exact: true }).click();
  await copy.getByRole("button", { name: /确认删除草稿策略/ }).click();
  await expect(copy).toHaveCount(0);

  await card.getByRole("button", { name: "暂停", exact: true }).click();
  await expect(card.getByRole("button", { name: "归档", exact: true })).toBeVisible();
  await card.getByRole("button", { name: "归档", exact: true }).click();
  await expect(card).toContainText("归档");

  await page.getByRole("button", { name: /审计日志/ }).click();
  await expect(page.getByText("关键动作记录", { exact: true })).toBeVisible();
  await page.getByLabel("搜索审计记录").fill(strategy.name);
  await expect(page.getByText(/发布策略|暂停策略|回滚策略|归档策略/).first()).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 CSV/ }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  const downloaded = await download.createReadStream();
  let csv = "";
  for await (const chunk of downloaded) csv += chunk.toString("utf8");
  expect(csv).toContain("操作人");
  expect(csv).toContain(strategy.name);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-lifecycle-audit-localized-export.png"), fullPage: true });

  await page.context().clearCookies();
  await loginFromRoot(page, ADMIN_USERNAME);
  await openK6FromSidebar(page);
  await page.getByRole("button", { name: /策略中心/ }).click();
  await expect(strategyCard(page, strategyId, strategy.name)).toContainText("归档");
  const counts = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_audit_log WHERE resource_id IN ('${strategyId}','${sid}') AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_id IN ('${strategyId}','${sid}') AND is_deleted=0)
    );
  `).trim().split(",").map(Number);
  expect(counts[0]).toBeGreaterThanOrEqual(5);
  expect(counts[1]).toBeGreaterThanOrEqual(5);
  summary.auditCount = counts[0];
  summary.outboxCount = counts[1];
  expect(runtimeErrors).toEqual([]);
});

async function loginFromRoot(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  // locator.isVisible({ timeout }) does not wait. Require the anonymous session
  // bootstrap to finish before entering credentials, otherwise a fast 401 can
  // race the first render and silently skip the whole login step.
  await expect(usernameInput).toBeVisible({ timeout: 8_000 });
  // The production shell can paint the login form before React hydration.
  // Wait for hydration to settle so it cannot replace already-filled inputs.
  await page.waitForTimeout(750);
  await usernameInput.fill(username);
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  const password = passwordFor(username);
  await passwordInput.fill(password);
  await expect(usernameInput).toHaveValue(username);
  await expect(passwordInput).toHaveValue(password);
  const loginResponse = page.waitForResponse((response) => response.url().endsWith("/api/admin/auth/login"));
  await page.getByRole("button", { name: /^(继续|登录)$/ }).click();
  const loggedIn = await loginResponse;
  expect(loggedIn.status(), "账号密码登录必须成功").toBe(200);
  const mfaHeading = page.getByRole("heading", { name: "双因素身份验证" });
  await expect(mfaHeading).toBeVisible({ timeout: 5_000 });
  const secretCode = page.locator("code");
  const displayedSecret = await secretCode.isVisible().catch(() => false)
    ? (await secretCode.innerText()).trim()
    : "";
  if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
  const secret = displayedSecret || MFA_SECRETS.get(username);
  if (!secret) throw new Error(`K6_MFA_SECRET_NOT_AVAILABLE_${username}`);
  const remainingMs = 30_000 - (Date.now() % 30_000);
  await page.waitForTimeout(remainingMs + 500);
  const otpInput = page.getByRole("textbox", { name: "一次性验证码" });
  await expect(otpInput).toBeVisible({ timeout: 5_000 });
  await otpInput.fill(totpCode(secret));
  const verification = page.waitForResponse((response) => response.url().endsWith("/api/admin/auth/mfa/verify"));
  await page.getByRole("button", { name: "验证并进入" }).click();
  const verified = await verification;
  // Navigation can evict the CDP response body before Playwright reads it;
  // the status plus the authenticated session read below are authoritative.
  expect(verified.status()).toBe(200);
  await page.waitForTimeout(1_500);
  const persistedSession = await page.request.get("/api/admin/auth/session");
  expect(persistedSession.status(), "MFA 后服务端会话 cookie 必须立即可用").toBe(200);
  const persistedPayload = await persistedSession.json() as { code?: number; data?: { session?: { username?: string } } };
  expect(persistedPayload.code).toBe(0);
  expect(persistedPayload.data?.session?.username).toBe(username);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await assertRunScopedSession(page, username);
  return page;
}

async function loginRole(browser: Browser, username: string) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  auxiliaryRolePages.push(page);
  return loginFromRoot(page, username);
}

function passwordFor(username: string) {
  if (username === READONLY_USERNAME) return READONLY_PASSWORD;
  if (username === ADMIN_USERNAME || username === OPERATOR_USERNAME) return SOURCE_PASSWORD;
  throw new Error(`No run-scoped K6 credential is configured for ${username}`);
}

async function assertRunScopedSession(page: Page, username: string) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await envelope<{
    session: { username: string; role: string; authorities: string[] };
  }>(response);
  const session = payload.data.session;
  expect(session.username).toBe(username);
  expect(session.role).not.toBe("superadmin");
  if (username === ADMIN_USERNAME) {
    for (const authority of [
      "risk_k6_read", "risk_k6_write", "risk_k6_senior", "risk_k6_admin", "risk_k6_target_manage",
    ]) {
      expect(session.authorities).toContain(authority);
    }
  } else if (username === OPERATOR_USERNAME) {
    expect(session.authorities).toContain("risk_k6_read");
    expect(session.authorities).toContain("risk_k6_write");
    expect(session.authorities).not.toContain("risk_k6_senior");
    expect(session.authorities).not.toContain("risk_k6_admin");
  } else {
    expect(session.authorities).toContain("risk_k6_read");
    expect(session.authorities.some((authority) =>
      authority.startsWith("risk_k6_") && authority !== "risk_k6_read")).toBe(false);
  }
}

async function safeServerLogout(page: Page) {
  await page.request.post("/api/admin/auth/logout").catch(() => null);
  await page.context().clearCookies().catch(() => undefined);
}

async function openK6FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /(风控与反作弊\s+K|K\s+风控与反作弊)/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/risk/janus-c2"]').first();
  await expect(link, "K6 必须从真实侧栏可达").toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(/\/risk\/janus-c2(?:\?.*)?$/, { timeout: 20_000 });
}

async function loginApp(page: Page) {
  const response = await page.request.post(`${BACKEND_URL}/auth/users/login`, {
    headers: { "X-Nexion-Edge-Country": "JP", "CF-IPCountry": "JP" },
    data: { countryCode: "86", phone: APP_PHONE, password: SOURCE_PASSWORD },
  });
  const result = await envelope<{ accessToken: string }>(response);
  expect(result.data.accessToken).toBeTruthy();
  return result.data.accessToken;
}

function reportPayload(reportId: string, reportedAt: number) {
  return {
    reportId,
    deviceId: APP_DEVICE_ID,
    reportedAt,
    firstSeenAt: reportedAt - 3 * 86_400_000,
    installAt: reportedAt - 3 * 86_400_000,
    inviteCode: null,
    channel: "official",
    cohortId: null,
    reportedStatus: "ERROR",
    activated: false,
    ua: "K6 acceptance Chromium",
    platform: "android",
    model: "K6 Acceptance Device",
    osName: "Android 15",
    browser: "Chrome",
    maturityScore: 0,
    recommendationScore: 0,
    environmentRiskScore: 0,
    priorityScore: 0,
    maturity: {
      appOpenCount: 8, sessionCount: 4, foregroundDurationSeconds: 900, repeatStreakDays: 3,
      benchmarkViewed: true, optimizeDone: true, marketViewed: true, walletViewed: true,
    },
    environment: {
      isHeadless: false, automationSignalCount: 0, fpBlocklistHit: false,
      screenAnomaly: false, timezoneMismatch: false, languageMismatch: false,
    },
    hitStrategy: null,
    hitStrategyVersion: null,
    latestDecision: null,
    latestSession: {
      sessionId: `session-${reportId}`,
      startedAt: reportedAt - 60_000,
      lastSeenAt: reportedAt,
      foregroundDurationSeconds: 900,
    },
    tags: [],
  };
}

async function appRaw(page: Page, method: "GET" | "POST", endpoint: string, data?: unknown) {
  return page.request.fetch(`${BACKEND_URL}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${appToken}`,
      "X-Nexion-Edge-Country": "JP",
      "CF-IPCountry": "JP",
    },
    data,
  });
}

async function appEnvelope<T>(page: Page, method: "GET" | "POST", endpoint: string, data?: unknown) {
  return envelope<T>(await appRaw(page, method, endpoint, data));
}

type JsonResponse = Pick<APIResponse, "json" | "status" | "url">;

async function envelope<T>(response: JsonResponse): Promise<Envelope<T>> {
  const payload = await response.json() as Envelope<T>;
  expect(response.status(), payload.message ?? response.url()).toBeGreaterThanOrEqual(200);
  expect(response.status(), payload.message ?? response.url()).toBeLessThan(300);
  expect(payload.code, payload.message ?? response.url()).toBe(0);
  return payload;
}

async function fetchStrategy(page: Page, id: string) {
  return (await envelope<Strategy>(await page.request.get(`/api/admin/janus/strategies/${id}`))).data;
}

function strategyCard(page: Page, id: string, name: string) {
  void id;
  return page.locator(".k6-strat-card").filter({ hasText: name }).filter({ hasNotText: `${name}(副本)` }).first();
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource.*(?:401|403|409|422|503)/i.test(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });
  return errors;
}

function mysql(sql: string) {
  return execFileSync(MYSQL, ["-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
}

function redis(args: string[]) {
  return execFileSync(REDIS_CLI, ["-h", "127.0.0.1", "-p", "6379", "-n", REDIS_DB, "--raw", ...args], {
    encoding: "utf8",
    env: { ...process.env, REDISCLI_AUTH: REDIS_PASSWORD },
  }).trim();
}

function cleanupRedis() {
  const adminIds = new Set(tempAdminIds);
  const exactKeys = new Set<string>();
  for (const adminId of adminIds) {
    const indexKey = `ops:admin:sessions:${adminId}`;
    for (const sessionId of redis(["SMEMBERS", indexKey]).split(/\r?\n/).filter(Boolean)) {
      exactKeys.add(`ops:admin:session:${sessionId}`);
    }
    exactKeys.add(indexKey);
    exactKeys.add(`rbac:v2:admin:perms:${adminId}`);
    for (const key of redis(["--scan", "--pattern", `ops:admin:mfa-used-counter:${adminId}:*`])
      .split(/\r?\n/).filter(Boolean)) {
      exactKeys.add(key);
    }
  }
  for (const username of [ADMIN_USERNAME, OPERATOR_USERNAME]) {
    const hash = sha256(username.trim().toLowerCase());
    for (const window of ["short", "daily", "lock"]) {
      exactKeys.add(`ops:admin:login-guard:${window}:${hash}`);
    }
  }
  for (const challengeKey of redis(["--scan", "--pattern", "ops:admin:mfa-challenge:*"])
    .split(/\r?\n/).filter(Boolean)) {
    const challengeAdminId = redis(["HGET", challengeKey, "adminId"]);
    if (adminIds.has(challengeAdminId)) exactKeys.add(challengeKey);
  }
  if (exactKeys.size > 0) redis(["DEL", ...exactKeys]);

  const residualKeys = new Set<string>();
  for (const adminId of adminIds) {
    for (const key of [
      `ops:admin:sessions:${adminId}`,
      `rbac:v2:admin:perms:${adminId}`,
      ...redis(["--scan", "--pattern", `ops:admin:mfa-used-counter:${adminId}:*`])
        .split(/\r?\n/).filter(Boolean),
    ]) {
      if (redis(["EXISTS", key]) !== "0") residualKeys.add(key);
    }
  }
  for (const challengeKey of redis(["--scan", "--pattern", "ops:admin:mfa-challenge:*"])
    .split(/\r?\n/).filter(Boolean)) {
    if (adminIds.has(redis(["HGET", challengeKey, "adminId"]))) residualKeys.add(challengeKey);
  }
  if (residualKeys.size > 0) {
    throw new Error(`K6 Redis cleanup incomplete for run-scoped admin ids: ${residualKeys.size}`);
  }
  return { adminIds: adminIds.size, deletedExactKeys: exactKeys.size, residualKeys: 0 };
}

function cleanupBusinessFixtures() {
  const allStrategyIds = [strategyId, ...extraStrategyIds].filter(Boolean)
    .map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const commandTargetIds = [sid, strategyId, ...extraStrategyIds].filter(Boolean)
    .map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const commandTargetFilter = commandTargetIds ? `OR target_id IN (${commandTargetIds})` : "";
  const targetIdFilter = commandTargetIds ? `IN (${commandTargetIds})` : `='__none__'`;
  const strategyIdFilter = allStrategyIds ? `IN (${allStrategyIds})` : `='__none__'`;
  mysql(`
    DELETE FROM nx_janus_command
     WHERE (idempotency_key LIKE 'k6-e2e-${RUN}-%' ${commandTargetFilter});
    DELETE FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'k6-e2e-${RUN}-%';
    DELETE FROM nx_admin_operation_mutex
     WHERE lock_key LIKE 'K6:${RUN}:%' OR lock_key ${targetIdFilter};
    DELETE FROM nx_audit_object_lock
     WHERE target_domain='K' AND target_id ${targetIdFilter};
    DELETE FROM nx_janus_daily_quota WHERE strategy_id ${strategyIdFilter};
    DELETE FROM nx_janus_dry_run WHERE strategy_id ${strategyIdFilter};
    DELETE FROM nx_janus_strategy_version WHERE strategy_id ${strategyIdFilter};
    DELETE FROM nx_janus_evaluation WHERE sid='${sid || "__none__"}';
    DELETE FROM nx_janus_device WHERE sid='${sid || "__none__"}';
    DELETE FROM nx_janus_strategy WHERE strategy_id ${strategyIdFilter} OR name LIKE 'K6闭环策略-${RUN}%';
  `);
}

function cleanupAccounts() {
  const adminUsernames = [ADMIN_USERNAME, OPERATOR_USERNAME];
  const quotedAdminUsernames = adminUsernames.map((username) => `'${username.replace(/'/g, "''")}'`).join(",");
  mysql(`
    DELETE FROM nx_user_session WHERE user_id IN (
      SELECT id FROM nx_user
       WHERE id=${appUserId} AND phone='${APP_PHONE}' AND referral_code='${APP_REFERRAL}');
    DELETE FROM nx_user_payout_address WHERE user_id IN (
      SELECT id FROM nx_user
       WHERE id=${appUserId} AND phone='${APP_PHONE}' AND referral_code='${APP_REFERRAL}');
    DELETE FROM nx_user
     WHERE id=${appUserId} AND phone='${APP_PHONE}' AND referral_code='${APP_REFERRAL}';
    DELETE FROM nx_admin_role_relation WHERE admin_id IN (
      SELECT id FROM nx_admin
       WHERE username IN (${quotedAdminUsernames}) AND nickname IN ('K6独立Owner','K6独立普通操作员'));
    DELETE FROM nx_admin_account_state WHERE admin_id IN (
      SELECT id FROM nx_admin
       WHERE username IN (${quotedAdminUsernames}) AND nickname IN ('K6独立Owner','K6独立普通操作员'));
    DELETE FROM nx_admin
     WHERE username IN (${quotedAdminUsernames}) AND nickname IN ('K6独立Owner','K6独立普通操作员');
  `);
}

function cleanupRoles() {
  mysql(`
    DELETE FROM nx_admin_role_menu
     WHERE role_id IN (SELECT id FROM nx_admin_role
       WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND remark LIKE '${RUN} %');
    DELETE FROM nx_admin_role_permission
     WHERE role_id IN (SELECT id FROM nx_admin_role
       WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND remark LIKE '${RUN} %');
    DELETE FROM nx_admin_role
     WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}') AND remark LIKE '${RUN} %';
  `);
}

function verifyCleanup() {
  const allStrategyIds = [strategyId, ...extraStrategyIds].filter(Boolean)
    .map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const strategyIdFilter = allStrategyIds ? `IN (${allStrategyIds})` : `='__none__'`;
  const commandTargetIds = [sid, strategyId, ...extraStrategyIds].filter(Boolean)
    .map((id) => `'${id.replace(/'/g, "''")}'`).join(",");
  const commandTargetFilter = commandTargetIds ? `OR target_id IN (${commandTargetIds})` : "";
  const targetIdFilter = commandTargetIds ? `IN (${commandTargetIds})` : `='__none__'`;
  const adminIdFilter = tempAdminIds.length > 0 ? `IN (${tempAdminIds.join(",")})` : `=-1`;
  const roleIdFilter = tempRoleIds.length > 0 ? `IN (${tempRoleIds.join(",")})` : `=-1`;
  const raw = mysql(`
    SELECT CONCAT_WS(',',
      (SELECT COUNT(*) FROM nx_janus_command
        WHERE (idempotency_key LIKE 'k6-e2e-${RUN}-%' ${commandTargetFilter})),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'k6-e2e-${RUN}-%'),
      (SELECT COUNT(*) FROM nx_admin_operation_mutex
        WHERE lock_key LIKE 'K6:${RUN}:%' OR lock_key ${targetIdFilter}),
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_domain='K' AND target_id ${targetIdFilter}),
      (SELECT COUNT(*) FROM nx_janus_daily_quota WHERE strategy_id ${strategyIdFilter}),
      (SELECT COUNT(*) FROM nx_janus_dry_run WHERE strategy_id ${strategyIdFilter}),
      (SELECT COUNT(*) FROM nx_janus_strategy_version WHERE strategy_id ${strategyIdFilter}),
      (SELECT COUNT(*) FROM nx_janus_evaluation WHERE sid='${sid || "__none__"}'),
      (SELECT COUNT(*) FROM nx_janus_device WHERE sid='${sid || "__none__"}'),
      (SELECT COUNT(*) FROM nx_janus_strategy WHERE strategy_id ${strategyIdFilter} OR name LIKE 'K6闭环策略-${RUN}%'),
      (SELECT COUNT(*) FROM nx_user_session WHERE user_id IN (SELECT id FROM nx_user WHERE phone='${APP_PHONE}')),
      (SELECT COUNT(*) FROM nx_user_payout_address WHERE user_id=${appUserId || 0}),
      (SELECT COUNT(*) FROM nx_user WHERE phone='${APP_PHONE}' OR referral_code='${APP_REFERRAL}'),
      (SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id ${adminIdFilter}),
      (SELECT COUNT(*) FROM nx_admin_account_state WHERE admin_id ${adminIdFilter}),
      (SELECT COUNT(*) FROM nx_admin WHERE username IN ('${ADMIN_USERNAME}','${OPERATOR_USERNAME}')),
      (SELECT COUNT(*) FROM nx_admin_role_menu WHERE role_id ${roleIdFilter}),
      (SELECT COUNT(*) FROM nx_admin_role_permission WHERE role_id ${roleIdFilter}),
      (SELECT COUNT(*) FROM nx_admin_role WHERE role_code IN ('${ADMIN_ROLE_CODE}','${OPERATOR_ROLE_CODE}'))
    );
  `).trim();
  const labels = [
    "commands", "idempotency", "mutexes", "objectLocks",
    "quotas", "dryRuns", "versions", "evaluations", "devices", "strategies",
    "userSessions", "payoutAddresses", "users", "adminRelations", "adminStates", "admins",
    "roleMenus", "rolePermissions", "roles",
  ];
  const values = raw.split(",").map(Number);
  const counts = Object.fromEntries(labels.map((label, index) => [label, values[index] ?? Number.NaN]));
  if (values.length !== labels.length || values.some((value) => value !== 0)) {
    throw new Error(`K6 mutable fixture cleanup incomplete: ${JSON.stringify(counts)}`);
  }
  return counts;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function totpCode(secret: string, now = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replace(/\s+/g, "").toUpperCase()) {
    const value = alphabet.indexOf(character);
    if (value < 0) throw new Error("K6 MFA 密钥格式异常");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = ((digest[offset]! & 0x7f) << 24)
    | ((digest[offset + 1]! & 0xff) << 16)
    | ((digest[offset + 2]! & 0xff) << 8)
    | (digest[offset + 3]! & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for K6 live acceptance`);
  return value;
}
