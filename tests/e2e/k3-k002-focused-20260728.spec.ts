import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const RUN_ID = process.env.K3_ACCEPTANCE_RUN_ID?.trim() || "pc-full-acceptance-20260728-151023";
const BUILD_ID = process.env.K3_EXPECTED_BUILD_ID?.trim() || "FL6den7TMkSYQjxGFfpkR";
const EVIDENCE_DIR = process.env.K3_EVIDENCE_DIR?.trim()
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/K/candidate-${BUILD_ID}/K3-k002-focused`;
const MYSQL = process.env.K3_MYSQL?.trim() || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = requiredEnv("K3_DB_NAME");
const DB_PASSWORD = requiredEnv("K3_DB_PASSWORD");
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const DRY_RUN_API = "**/api/admin/risk/withdraw-rules/dry-runs";
const REASON = "K3 K-002 畸形成功响应失败关闭及同键恢复验收";

type Envelope<T> = { code: number; message?: string; data: T };
type DryRunResult = {
  batchNo: string;
  status: string;
  sampleWindowDays: number;
  evaluatedWithdrawals: number;
  activeRules: number;
  hitCount: number;
  routeCounts: unknown[];
};

let commandKey = "";
let batchNo = "";
const summary: Record<string, unknown> = {
  runId: RUN_ID,
  buildId: BUILD_ID,
  startedAt: new Date().toISOString(),
  scope: "K-002 K3 malformed HTTP 200 -> outcome unknown -> same-key real retry",
  prohibitedScope: {
    j1: "not touched",
    funds: "not touched",
    userAssets: "not touched",
  },
};

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test.afterAll(async () => {
  let cleanupError: string | null = null;
  try {
    if (commandKey) {
      mysql(`
        DELETE FROM nx_admin_idempotency_record
         WHERE scope='K3_RULE_DRY_RUN'
           AND idempotency_key='${sqlValue(commandKey)}';
      `);
    }
    if (batchNo) {
      mysql(`
        DELETE FROM nx_audit_log
         WHERE action='K3_WITHDRAW_RULE_DRY_RUN_COMPLETED'
           AND resource_type='WITHDRAW_RULE_DRY_RUN'
           AND resource_id='${sqlValue(batchNo)}';
      `);
    }
    const [idempotencyResidue, auditResidue] = mysql(`
      SELECT COUNT(*) FROM nx_admin_idempotency_record
       WHERE scope='K3_RULE_DRY_RUN'
         ${commandKey ? `AND idempotency_key='${sqlValue(commandKey)}'` : "AND 1=0"};
      SELECT COUNT(*) FROM nx_audit_log
       WHERE action='K3_WITHDRAW_RULE_DRY_RUN_COMPLETED'
         AND resource_type='WITHDRAW_RULE_DRY_RUN'
         ${batchNo ? `AND resource_id='${sqlValue(batchNo)}'` : "AND 1=0"};
    `).trim().split(/\r?\n/).map(Number);
    summary.cleanup = {
      idempotencyResidue,
      auditResidue,
      exactScopeOnly: true,
    };
    if (idempotencyResidue !== 0 || auditResidue !== 0) {
      throw new Error(`K3_K002_CLEANUP_RESIDUE idempotency=${idempotencyResidue} audit=${auditResidue}`);
    }
  } catch (error) {
    cleanupError = error instanceof Error ? error.message : String(error);
    summary.cleanup = { error: cleanupError };
  } finally {
    summary.finishedAt = new Date().toISOString();
    await writeFile(path.join(EVIDENCE_DIR, "run-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
      "K-002 focused final-candidate acceptance evidence.",
      "The first dry-run response alone was browser-injected as malformed HTTP 200.",
      "The second attempt used the same idempotency key and reached the real backend.",
      "Only the exact K3 dry-run idempotency and audit rows were removed.",
      "No trace, video, HAR, auth state, password, token, cookie, or raw idempotency key is stored here.",
    ].join("\n"), "utf8");
  }
  if (cleanupError) throw new Error(cleanupError);
});

test("K-002: 畸形 200 保持未知态，原操作同键重试后真实成功", async ({ page }) => {
  const runtime = collectRuntimeSignals(page);
  await loginAndOpenK3(page);

  const commandKeys: string[] = [];
  let attempts = 0;
  await page.route(DRY_RUN_API, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    attempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: {} }),
      });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "沙盒模拟（不写生产）", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(REASON);
  await dialog.getByRole("button", { name: "开始模拟", exact: true }).click();

  const unknownAlert = page.getByRole("alert")
    .filter({ hasText: "结果暂不确定，请使用原操作重试" });
  await expect(dialog).toBeVisible();
  await expect(unknownAlert).toBeVisible();
  expect(commandKeys).toHaveLength(1);
  expect(commandKeys[0]).toBeTruthy();

  const realResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/risk/withdraw-rules/dry-runs";
  });
  await dialog.getByRole("button", { name: "开始模拟", exact: true }).click();
  const realResponse = await realResponsePromise;
  const payload = await realResponse.json() as Envelope<DryRunResult>;

  expect(realResponse.status(), JSON.stringify(payload)).toBe(200);
  expect(payload.code, payload.message).toBe(0);
  expect(payload.data?.batchNo).toMatch(/^K3-DRY-/);
  expect(payload.data?.status).toBe("COMPLETED");
  expect(payload.data?.sampleWindowDays).toBeGreaterThan(0);
  expect(payload.data?.evaluatedWithdrawals).toBeGreaterThanOrEqual(0);
  expect(payload.data?.activeRules).toBeGreaterThanOrEqual(0);
  expect(payload.data?.hitCount).toBeGreaterThanOrEqual(0);
  expect(Array.isArray(payload.data?.routeCounts)).toBeTruthy();

  await expect(dialog).toHaveCount(0);
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBeTruthy();
  expect(commandKeys[1] === commandKeys[0]).toBeTruthy();
  await expect(unknownAlert).toHaveCount(0);

  commandKey = commandKeys[0];
  batchNo = payload.data.batchNo;
  const resultCard = page.locator("section").filter({ hasText: "最近一次沙盒模拟" }).first();
  await expect(resultCard).toBeVisible();
  await expect(resultCard).toContainText("已完成");
  await expect(resultCard).toContainText(batchNo);
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "k3-k002-same-key-real-retry-success.png"),
    fullPage: true,
  });
  await page.unroute(DRY_RUN_API);

  expect(runtime.pageErrors).toEqual([]);
  expect(runtime.consoleErrors).toEqual([]);
  expect(runtime.unexpected5xx).toEqual([]);
  expect(runtime.disallowedWrites).toEqual([]);

  summary.result = {
    malformed200FailClosed: true,
    dialogStayedOpen: true,
    persistentUnknownAlert: true,
    sameKeyRetry: true,
    realRetryHttp: realResponse.status(),
    realRetryStatus: payload.data.status,
    batchNo,
    commandKeySha256: createHash("sha256").update(commandKey).digest("hex"),
    unknownAlertClearedAfterSuccess: true,
    dryRunCardVisible: true,
    attempts,
  };
});

async function loginAndOpenK3(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  const password = page.locator('input[autocomplete="current-password"]');
  await expect(username).toBeVisible();
  await username.fill("superadmin");
  await password.fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    throw new Error("K3_K002_SUPERADMIN_MFA_REQUIRES_EXISTING_OWNER_ASSISTANCE");
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });

  const link = page.locator('aside a[href="/risk/withdrawal-rules"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link, "K3 必须从 superadmin 的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/withdrawal-rules(?:\?.*)?$/);
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible({ timeout: 20_000 });
}

function collectRuntimeSignals(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const unexpected5xx: string[] = [];
  const disallowedWrites: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error"
      && !/favicon|Failed to load resource.*401 \(Unauthorized\)/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      unexpected5xx.push(`${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
  page.on("request", (request) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) return;
    const pathname = new URL(request.url()).pathname;
    if (pathname !== "/api/admin/auth/login"
      && pathname !== "/api/admin/risk/withdraw-rules/dry-runs") {
      disallowedWrites.push(`${request.method()} ${pathname}`);
    }
  });
  return { pageErrors, consoleErrors, unexpected5xx, disallowedWrites };
}

function mysql(sql: string) {
  return execFileSync(MYSQL, [
    "--default-character-set=utf8mb4",
    "-uroot",
    "-D",
    DB_NAME,
    "-N",
    "-B",
    "-e",
    sql,
  ], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
}

function sqlValue(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("K3_K002_SQL_VALUE_REJECTED");
  return value;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for K-002 acceptance`);
  return value;
}
