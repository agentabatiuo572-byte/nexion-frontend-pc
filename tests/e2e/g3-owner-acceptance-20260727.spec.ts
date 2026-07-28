import { expect, test, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = path.resolve(
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/evidence/G3-owner",
);

type G3Frame = {
  dayIndex: number;
  targetPrice: number;
  pumpProbability: number;
  volatilityPct: number;
};

type G3Snapshot = {
  currentPrice: number;
  activeDayIndex: number;
  weekPeakPrice: number;
  frames: G3Frame[];
  controls: Array<{
    key: string;
    value: string;
    rawValue?: string;
    cronExpression?: string;
    zone?: string;
  }>;
  overrides: {
    currentPrice: number;
    volatilityPct: number;
    oracle: string;
    deviationPct: number | null;
    costBasis: number | null;
    paused: boolean;
  };
  coverage: {
    coverageRatio: number;
    redlinePct: number;
    redlineBreached: boolean;
  };
  serverCanonical: boolean;
  sources: string[];
};

type ApiEnvelope<T> = { code: number; message?: string; data: T };

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  const parsed = new URL(BASE_URL);
  expect(["127.0.0.1", "localhost", "::1"]).toContain(parsed.hostname);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("G3 首次用户从侧边栏进入，理解行情、7 帧、历史与全部控制入口", async ({ page }) => {
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const badResponses: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("requestfailed", (request) => {
    requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) badResponses.push(`${response.request().method()} ${response.status()} ${response.url()}`);
  });

  await loginFromVisibleEntry(page);
  await openG3FromSidebar(page);

  const snapshot = await g3Snapshot(page);
  expect(snapshot.serverCanonical).toBe(true);
  expect(snapshot.frames).toHaveLength(7);
  expect(snapshot.frames.map((frame) => frame.dayIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  expect(snapshot.currentPrice).toBeGreaterThan(0);
  expect(snapshot.weekPeakPrice).toBeGreaterThan(0);
  expect(snapshot.sources).toEqual(expect.arrayContaining([
    expect.stringContaining("weekly_curve"),
    expect.stringContaining("nx_price_index"),
  ]));

  await expect(page.getByText("NEX 现价", { exact: true })).toBeVisible();
  await expect(page.getByText("排程进度", { exact: true })).toBeVisible();
  await expect(page.getByText("喂价源", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("引擎状态", { exact: true })).toBeVisible();
  await expect(page.getByText("周曲线关键帧(7 天 × 3 项 · 逐值权威)", { exact: true })).toBeVisible();
  await expect(page.getByText("行情走势", { exact: true })).toBeVisible();
  await expect(page.getByText("手动 override 层", { exact: true })).toBeVisible();
  await expect(page.getByText("价格 100% 服务端驱动", { exact: true })).toBeVisible();

  const frameRows = page.locator("table.dial-tbl tbody tr");
  await expect(frameRows).toHaveCount(7);
  for (let index = 0; index < 7; index += 1) {
    await expect(frameRows.nth(index).locator("td").first()).toContainText(`D${index + 1}`);
    await expect(frameRows.nth(index).locator("td")).toHaveCount(4);
  }

  const controlRows = page.locator(".l-card").filter({ hasText: "排程控制" }).locator(".p-row");
  await expect(controlRows).toHaveCount(3);
  await expect(controlRows.nth(0)).toContainText("自动按日推进");
  await expect(controlRows.nth(1)).toContainText("钉住某日(pin)");
  await expect(controlRows.nth(2)).toContainText("跑完循环 / 停末值(loop)");

  await inspectCurveDialog(page, snapshot);
  await inspectControlDialogs(page);
  await inspectOverrideDialogs(page, snapshot);
  await inspectPauseDialog(page, snapshot.overrides.paused);

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-g3-first-user-full-page.png"), fullPage: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "01-g3-first-user-snapshot.json"),
    JSON.stringify(snapshot, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "01-browser-diagnostics.json"),
    JSON.stringify({ consoleErrors, requestFailures, badResponses }, null, 2),
    "utf8",
  );

  expect(consoleErrors.filter((line) => !line.includes("401 (Unauthorized)"))).toEqual([]);
  expect(requestFailures.filter((line) => !line.includes("net::ERR_ABORTED"))).toEqual([]);
  expect(badResponses.filter((line) => !line.includes("401 http://127.0.0.1:3002/api/admin/auth/session"))).toEqual([]);
});

test("G3 墨菲技术探针：非当前帧不得覆盖应急价，服务端拒绝非法枚举和并发覆盖", async ({ page }) => {
  await loginFromVisibleEntry(page);
  await openG3FromSidebar(page);
  const baseline = await g3Snapshot(page);
  const inactiveDay = baseline.activeDayIndex === 0 ? 1 : 0;
  const originalVolatility = baseline.frames[inactiveDay].volatilityPct;
  const candidateVolatility = originalVolatility >= 19.99
    ? originalVolatility - 0.01
    : originalVolatility + 0.01;
  const observations: Record<string, unknown> = {
    baseline,
    inactiveDay,
    originalVolatility,
    candidateVolatility,
  };

  let afterInactiveEdit: G3Snapshot | null = null;
  try {
    await submitCurveCell(page, inactiveDay, 3, String(candidateVolatility), "G3验收探针-仅修改非当前帧波动并验证现价隔离");
    afterInactiveEdit = await g3Snapshot(page);
    observations.afterInactiveEdit = afterInactiveEdit;
  } finally {
    const current = await g3Snapshot(page);
    if (current.frames[inactiveDay]?.volatilityPct !== originalVolatility) {
      await submitCurveCell(page, inactiveDay, 3, String(originalVolatility), "G3验收回滚-恢复非当前帧波动原始值");
    }
    const afterFrameRestore = await g3Snapshot(page);
    if (Math.abs(afterFrameRestore.currentPrice - baseline.currentPrice) > 0.000000001) {
      await submitNumericOverride(page, "现价直写(应急)", String(baseline.currentPrice), "G3验收回滚-恢复测试前权威现价");
    }
  }

  const originalOracle = baseline.overrides.oracle;
  const originalPin = baseline.controls.find((control) => control.key === "pin")?.value ?? "未钉住";
  const originalLoop = baseline.controls.find((control) => control.key === "loop")?.value ?? "循环";
  // Idempotency records intentionally outlive a browser run. Reusing a fixed key
  // with a later baseline correctly returns 409 before domain validation, so every
  // independent invalid-input probe needs a run-unique key.
  const invalidKeyPrefix = `g3-owner-invalid-${Date.now()}`;
  const invalidResults: Record<string, unknown> = {};
  try {
    invalidResults.oracle = await rawApi(page, "PATCH", "/api/admin/market/nex/overrides/oracle", {
      value: "G3_INVALID_ORACLE",
      expectedValue: originalOracle,
      reason: "G3验收探针-非法喂价源必须由服务端拒绝",
      operator: "superadmin",
    }, `${invalidKeyPrefix}-oracle`);
  } finally {
    const now = await g3Snapshot(page);
    if (now.overrides.oracle !== originalOracle) {
      await rawApi(page, "PATCH", "/api/admin/market/nex/overrides/oracle", {
        value: originalOracle,
        expectedValue: now.overrides.oracle,
        reason: "G3验收回滚-恢复原始喂价源",
        operator: "superadmin",
      }, `${invalidKeyPrefix}-restore-oracle`);
    }
  }
  try {
    invalidResults.pin = await rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/pin", {
      value: "D9",
      expectedValue: originalPin,
      reason: "G3验收探针-非法钉帧必须由服务端拒绝",
      operator: "superadmin",
    }, `${invalidKeyPrefix}-pin`);
  } finally {
    const now = await g3Snapshot(page);
    const value = now.controls.find((control) => control.key === "pin")?.value;
    if (value !== originalPin) {
      await rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/pin", {
        value: originalPin,
        expectedValue: value,
        reason: "G3验收回滚-恢复原始钉帧",
        operator: "superadmin",
      }, `${invalidKeyPrefix}-restore-pin`);
    }
  }
  try {
    invalidResults.loop = await rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/loop", {
      value: "G3_INVALID_LOOP",
      expectedValue: originalLoop,
      reason: "G3验收探针-非法循环模式必须由服务端拒绝",
      operator: "superadmin",
    }, `${invalidKeyPrefix}-loop`);
  } finally {
    const now = await g3Snapshot(page);
    const value = now.controls.find((control) => control.key === "loop")?.value;
    if (value !== originalLoop) {
      await rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/loop", {
        value: originalLoop,
        expectedValue: value,
        reason: "G3验收回滚-恢复原始循环模式",
        operator: "superadmin",
      }, `${invalidKeyPrefix}-restore-loop`);
    }
  }
  observations.invalidResults = invalidResults;

  const raceKey = `g3-owner-race-${Date.now()}`;
  const raceBodyA = {
    value: originalPin === "D1" ? "D2" : "D1",
    expectedValue: originalPin,
    reason: "G3验收并发探针-A请求应与B请求发生版本冲突",
    operator: "superadmin",
  };
  const raceBodyB = {
    value: originalPin === "D2" ? "D4" : "D2",
    expectedValue: originalPin,
    reason: "G3验收并发探针-B请求应与A请求发生版本冲突",
    operator: "superadmin",
  };
  try {
    observations.concurrentResults = await Promise.all([
      rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/pin", raceBodyA, `${raceKey}-a`),
      rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/pin", raceBodyB, `${raceKey}-b`),
    ]);
  } finally {
    const now = await g3Snapshot(page);
    const value = now.controls.find((control) => control.key === "pin")?.value;
    if (value !== originalPin) {
      await rawApi(page, "PATCH", "/api/admin/market/nex/curve/controls/pin", {
        value: originalPin,
        expectedValue: value,
        reason: "G3验收回滚-恢复并发探针前钉帧",
        operator: "superadmin",
      }, `${raceKey}-restore`);
    }
  }

  const restored = await g3Snapshot(page);
  observations.restored = restored;
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "02-g3-murphy-probes.json"),
    JSON.stringify(observations, null, 2),
    "utf8",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("G3 NEX 行情引擎", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-g3-after-probe-rollback.png"), fullPage: true });

  expect(afterInactiveEdit?.currentPrice, "编辑非当前帧不得提前覆盖应急现价").toBe(baseline.currentPrice);
  for (const result of Object.values(invalidResults) as Array<{ status: number; payload: ApiEnvelope<unknown> }>) {
    expect(result.status).toBe(422);
    expect(result.payload.code).not.toBe(0);
  }
  const race = observations.concurrentResults as Array<{ status: number }>;
  expect(race.filter((result) => result.status === 409)).toHaveLength(1);
  expect(restored.currentPrice).toBe(baseline.currentPrice);
  expect(restored.frames[inactiveDay].volatilityPct).toBe(originalVolatility);
  expect(restored.overrides.oracle).toBe(originalOracle);
  expect(restored.controls.find((control) => control.key === "pin")?.value).toBe(originalPin);
  expect(restored.controls.find((control) => control.key === "loop")?.value).toBe(originalLoop);
});

async function loginFromVisibleEntry(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openG3FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /金融产品.*G|G.*金融产品/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const entry = page.locator('a[href="/finance-products/market"]').first();
  await expect(entry, "首次用户应能在侧边栏看到 G3 入口").toBeVisible({ timeout: 10_000 });
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/admin/market/nex/curve") && response.request().method() === "GET",
    ),
    entry.click(),
  ]);
  await expect(page).toHaveURL(/\/finance-products\/market(?:\?.*)?$/);
  await expect(page.getByText("G3 NEX 行情引擎", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
}

async function g3Snapshot(page: Page): Promise<G3Snapshot> {
  const response = await page.request.get("/api/admin/market/nex/curve");
  expect(response.status()).toBe(200);
  const payload = await response.json() as ApiEnvelope<G3Snapshot>;
  expect(payload.code).toBe(0);
  return payload.data;
}

async function inspectCurveDialog(page: Page, snapshot: G3Snapshot) {
  const row = page.locator("table.dial-tbl tbody tr").nth(snapshot.activeDayIndex);
  await row.locator("td").nth(1).click();
  const dialog = await visibleDialog(page);
  await expect(dialog).toContainText(`D${snapshot.activeDayIndex + 1} 目标价`);
  await expect(dialog).toContainText("周峰值价");
  await expect(dialog).toContainText("B1 备付金覆盖率");
  await expect(dialog.getByLabel("目标新值")).toBeVisible();
  await expect(dialog.locator("textarea")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await closeDialog(dialog);
}

async function inspectControlDialogs(page: Page) {
  const rows = page.locator(".l-card").filter({ hasText: "排程控制" }).locator(".p-row");
  for (let index = 0; index < 3; index += 1) {
    await rows.nth(index).getByRole("button", { name: "调整(立即执行)" }).click();
    const dialog = await visibleDialog(page);
    await expect(dialog).toContainText("行情排程控制");
    await expect(dialog.locator("textarea")).toBeVisible();
    if (index === 0) await expect(dialog.getByLabel("目标新值")).toBeVisible();
    if (index > 0) await expect(dialog.locator(".chip.tab, .chip").first()).toBeVisible();
    await closeDialog(dialog);
  }
}

async function inspectOverrideDialogs(page: Page, snapshot: G3Snapshot) {
  const card = page.locator(".l-card").filter({ hasText: "手动 override 层" });
  for (const rowName of ["现价直写(应急)", "做市波动幅度", "偏离告警阈值", "成本基准锚"]) {
    const row = card.locator(".p-row").filter({ hasText: rowName });
    await row.getByRole("button").click();
    const dialog = await visibleDialog(page);
    await expect(dialog.getByLabel("目标新值")).toBeVisible();
    await expect(dialog.locator("textarea")).toBeVisible();
    if (rowName === "现价直写(应急)") {
      await expect(dialog).toContainText("周峰值价");
      await expect(dialog).toContainText("B1 备付金覆盖率");
    }
    await closeDialog(dialog);
  }

  const oracleRow = card.locator(".p-row").filter({ hasText: "喂价源" });
  await oracleRow.getByRole("button", { name: "切换源(立即执行)" }).click();
  const oracleDialog = await visibleDialog(page);
  await expect(oracleDialog).toContainText("内部做市源 / 外部喂价源切换");
  await expect(oracleDialog.locator(".chip", { hasText: /内部做市|外部喂价/ })).toHaveCount(2);
  await expect(oracleDialog).toContainText(snapshot.overrides.oracle);
  await closeDialog(oracleDialog);
}

async function inspectPauseDialog(page: Page, paused: boolean) {
  const button = page.getByRole("button", {
    name: paused ? "恢复引擎(立即执行)" : "暂停引擎(立即执行)",
    exact: true,
  });
  await expect(button).toBeVisible();
  await button.click();
  const dialog = await visibleDialog(page);
  await expect(dialog).toContainText(paused ? "恢复后现价继续按曲线排程推进" : "暂停后现价冻结在最后值");
  await expect(dialog.locator("textarea")).toBeVisible();
  await closeDialog(dialog);
}

async function visibleDialog(page: Page) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible({ timeout: 8_000 });
  return dialog;
}

async function closeDialog(dialog: Locator) {
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function submitCurveCell(
  page: Page,
  dayIndex: number,
  cellIndex: number,
  value: string,
  reason: string,
) {
  const row = page.locator("table.dial-tbl tbody tr").nth(dayIndex);
  await row.locator("td").nth(cellIndex).click();
  const dialog = await visibleDialog(page);
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.locator("textarea").fill(reason);
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/admin/market/nex/curve") &&
      response.request().method() === "PUT",
    ),
    dialog.getByRole("button", { name: "确认提交" }).click(),
  ]);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function submitNumericOverride(page: Page, rowName: string, value: string, reason: string) {
  const card = page.locator(".l-card").filter({ hasText: "手动 override 层" });
  const row = card.locator(".p-row").filter({ hasText: rowName });
  await row.getByRole("button").click();
  const dialog = await visibleDialog(page);
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.locator("textarea").fill(reason);
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/admin/market/nex/overrides/currentPrice") &&
      response.request().method() === "PATCH",
    ),
    dialog.getByRole("button", { name: "确认提交" }).click(),
  ]);
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function rawApi(
  page: Page,
  method: "PATCH" | "POST" | "PUT",
  url: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  const response = await page.request.fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    data: body,
  });
  return {
    status: response.status(),
    payload: await response.json().catch(() => null),
  };
}
