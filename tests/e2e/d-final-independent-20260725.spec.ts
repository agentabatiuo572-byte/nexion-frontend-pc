import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = process.env.D_FINAL_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/20260725-d-final-independent";
const username = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const password = process.env.NEXION_E2E_PASSWORD;
const runId = process.env.D_FINAL_RUN_ID ?? `d-final-${Date.now()}`;
let cleanupVietQr: VietQrConfig | undefined;
let cleanupFx: FxQuote | undefined;

type Envelope<T> = { code: number; message: string; data: T };
type VietQrConfig = {
  toleranceVnd: number;
  graceMinutes: number;
  perTxLimitUsd: number;
  trc20Confirmations: number;
  erc20Confirmations: number;
  bep20Confirmations: number;
  rotationStrategy: string;
  version: number;
};
type FxQuote = {
  baseRateVndPerUsdt: number;
  buySpreadPct: number;
  lockWindowMinutes: number;
  quoteRateVndPerUsdt: number;
  version: number;
  history: Array<{ id: number; reason: string }>;
};
type D5Snapshot = {
  version: number;
  dailyLimitCount: number;
  balanceMaxRatio: number;
  networkFeeRatio: number;
  networkFeeMin: number;
  networkFeeMax: number;
  nexFeeOffsetRate: number;
};

function writeEvidence(name: string, value: unknown) {
  fs.writeFileSync(path.join(evidenceDir, name), JSON.stringify(value, null, 2));
}

async function login(page: Page) {
  if (!password) throw new Error("NEXION_E2E_PASSWORD is required");
  await page.goto("/");
  const account = page.getByLabel(/用户名|账号/);
  if (await account.isVisible().catch(() => false)) {
    await account.fill(username);
    await page.getByLabel(/密码/).fill(password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
  }
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

async function openFinanceEntry(page: Page, linkName: string, expectedPath: RegExp) {
  const link = page.getByRole("link", { name: new RegExp(linkName) });
  if (!(await link.isVisible().catch(() => false))) {
    const group = page.getByRole("button", { name: /资金与财务/ });
    await expect(group, "D domain must be discoverable from the visible sidebar").toBeVisible();
    await group.click();
  }
  await expect(link, `${linkName} must be visible in the D domain sidebar`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(expectedPath);
}

async function openD1(page: Page) {
  await openFinanceEntry(page, "充值对账中心", /\/finance\/recon$/);
  await expect(page.getByText("银行转账（VietQR）对账", { exact: true })).toBeVisible();
  await expect(page.getByText("在途意向单", { exact: true })).toBeVisible();
}

async function openD3(page: Page) {
  await openFinanceEntry(page, "资金池水位仪表盘", /\/finance\/pool$/);
  await expect(page.getByText("应付负债 · 9 类科目", { exact: true })).toBeVisible();
}

async function openD2(page: Page) {
  await openFinanceEntry(page, "提现审核队列", /\/finance\/withdrawals$/);
  await expect(page.getByRole("heading", { name: "提现审核队列", exact: true })).toBeVisible();
  await expect(page.getByText(/D2 数据加载失败/)).toHaveCount(0);
}

async function openD4(page: Page) {
  await openFinanceEntry(page, "账本/账单审计", /\/finance\/ledger$/);
  await expect(page.getByText("全平台账单流水", { exact: true })).toBeVisible();
  await expect(page.getByText(/资金账本已停止展示旧数据/)).toHaveCount(0);
}

async function openD5(page: Page) {
  await openFinanceEntry(page, "提现参数配置", /\/finance\/params$/);
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await expect(page.getByText("H1 Phase 派发（只读）", { exact: true })).toBeVisible();
}

async function openD6(page: Page) {
  await openFinanceEntry(page, "汇率牌价", /\/finance\/fx-rate$/);
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
}

async function getD5(page: Page) {
  const response = await page.request.get("/api/admin/withdraw/limits");
  expect(response.status()).toBe(200);
  return (await response.json() as Envelope<D5Snapshot>).data;
}

async function getVietQr(page: Page, view = "inflight") {
  const response = await page.request.get(`/api/admin/finance/vietqr/overview?view=${view}&pageNum=1&pageSize=20`);
  expect(response.status()).toBe(200);
  return (await response.json() as Envelope<{ config: VietQrConfig }>).data;
}

function vietQrUpdateBody(config: VietQrConfig, patch: Partial<VietQrConfig>, reason: string) {
  return {
    toleranceVnd: patch.toleranceVnd ?? config.toleranceVnd,
    graceMinutes: patch.graceMinutes ?? config.graceMinutes,
    perTxLimitUsd: patch.perTxLimitUsd ?? config.perTxLimitUsd,
    trc20Confirmations: patch.trc20Confirmations ?? config.trc20Confirmations,
    erc20Confirmations: patch.erc20Confirmations ?? config.erc20Confirmations,
    bep20Confirmations: patch.bep20Confirmations ?? config.bep20Confirmations,
    rotationStrategy: patch.rotationStrategy ?? config.rotationStrategy,
    expectedVersion: config.version,
    reason,
    operator: username,
  };
}

async function getFx(page: Page) {
  const response = await page.request.get("/api/admin/finance/fx-quote");
  expect(response.status()).toBe(200);
  return (await response.json() as Envelope<FxQuote>).data;
}

function fxUpdateBody(config: FxQuote, patch: Partial<FxQuote>, reason: string) {
  return {
    baseRateVndPerUsdt: patch.baseRateVndPerUsdt ?? config.baseRateVndPerUsdt,
    buySpreadPct: patch.buySpreadPct ?? config.buySpreadPct,
    lockWindowMinutes: patch.lockWindowMinutes ?? config.lockWindowMinutes,
    expectedVersion: config.version,
    reason,
    operator: username,
  };
}

async function logout(page: Page) {
  const accountMenu = page.getByRole("button", { name: /superadmin|Super Admin|总管理员/i }).last();
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));
test.afterEach(async ({ page }, testInfo) => {
  const cleanup: Record<string, unknown> = { test: testInfo.title, status: testInfo.status };
  if (cleanupVietQr) {
    const target = cleanupVietQr;
    const current = await getVietQr(page);
    if (
      current.config.toleranceVnd !== target.toleranceVnd
      || current.config.graceMinutes !== target.graceMinutes
      || current.config.perTxLimitUsd !== target.perTxLimitUsd
      || current.config.trc20Confirmations !== target.trc20Confirmations
      || current.config.erc20Confirmations !== target.erc20Confirmations
      || current.config.bep20Confirmations !== target.bep20Confirmations
      || current.config.rotationStrategy !== target.rotationStrategy
    ) {
      const restored = await page.request.patch("/api/admin/finance/vietqr/config", {
        headers: { "Idempotency-Key": `${runId}-aftereach-d1-restore` },
        data: vietQrUpdateBody(current.config, target, `${runId} afterEach 精确恢复 D1 原始配置`),
      });
      expect(restored.status()).toBe(200);
      cleanup.d1EmergencyRestore = true;
    }
    cleanupVietQr = undefined;
  }
  if (cleanupFx) {
    const target = cleanupFx;
    const current = await getFx(page);
    if (
      current.baseRateVndPerUsdt !== target.baseRateVndPerUsdt
      || current.buySpreadPct !== target.buySpreadPct
      || current.lockWindowMinutes !== target.lockWindowMinutes
    ) {
      const restored = await page.request.patch("/api/admin/finance/fx-quote", {
        headers: { "Idempotency-Key": `${runId}-aftereach-d6-restore` },
        data: fxUpdateBody(current, target, `${runId} afterEach 精确恢复 D6 原始配置`),
      });
      expect(restored.status()).toBe(200);
      cleanup.d6EmergencyRestore = true;
    }
    cleanupFx = undefined;
  }
  if (cleanup.d1EmergencyRestore || cleanup.d6EmergencyRestore) {
    writeEvidence(`cleanup-${testInfo.retry}-${Date.now()}.json`, cleanup);
  }
});

test("D1 五视图与 D3 九类科目可从可见入口发现，且只展示运营语言", async ({ page }) => {
  const responses: Array<{ url: string; status: number }> = [];
  page.on("response", (response) => {
    if (/\/api\/admin\/(finance|treasury)\//.test(response.url())) {
      responses.push({ url: response.url(), status: response.status() });
    }
  });

  await login(page);
  await openD1(page);

  const bankViews = [
    ["matched", "已匹配"],
    ["orphan", "孤儿队列"],
    ["mismatch", "差额队列"],
    ["late", "迟到 / 补充回单"],
    ["inflight", "在途意向单"],
  ] as const;
  const viewResults: Array<{ view: string; status: number; empty: boolean }> = [];
  for (const [view, label] of bankViews) {
    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().includes("/api/admin/finance/vietqr/overview")) return false;
      return new URL(response.url()).searchParams.get("view") === view;
    });
    await page.getByRole("button", { name: label, exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveClass(/sel/);
    viewResults.push({
      view,
      status: response.status(),
      empty: await page.getByText("当前视图暂无银行轨记录", { exact: true }).isVisible().catch(() => false),
    });
  }

  const d1Body = await page.locator("body").innerText();
  expect(d1Body).toContain("五视图");
  expect(d1Body).toContain("挂账与 D3 第 9 科目同源");
  expect(d1Body).not.toMatch(/\bnx_[a-z0-9_]+\b/i);
  expect(d1Body).not.toMatch(/\b(VIETQR|FX)_[A-Z0-9_]+\b/);
  await page.screenshot({ path: path.join(evidenceDir, "01-d1-five-views.png"), fullPage: true });

  await openD3(page);
  const liabilityCard = page.locator("section.l-card").filter({ hasText: "应付负债 · 9 类科目" }).first();
  await expect(liabilityCard.locator("tbody tr")).toHaveCount(9);
  await expect(liabilityCard).toContainText("VietQR");
  const d3Body = await page.locator("body").innerText();
  expect(d3Body).not.toMatch(/\bnx_[a-z0-9_. ]+\b/i);
  expect(d3Body).toContain("固定 9 类服务端科目 · 银行轨挂账入科目 #9");
  await page.screenshot({ path: path.join(evidenceDir, "02-d3-nine-liabilities.png"), fullPage: true });

  writeEvidence("01-d1-d3-result.json", {
    runId,
    viewResults,
    liabilityRows: await liabilityCard.locator("tbody tr").count(),
    sourceIdentifiersHidden: !/\bnx_[a-z0-9_. ]+\b/i.test(d3Body),
    responses,
  });
});

test("D2、D4、D5 从可见侧栏读取权威事实，D5 放大方向在红线下失败关闭", async ({ page, request }) => {
  expect((await request.get("/api/admin/finance/withdrawals")).status()).toBe(401);
  expect((await request.get("/api/admin/bills")).status()).toBe(401);
  expect((await request.get("/api/admin/withdraw/limits")).status()).toBe(401);

  const responses: Array<{ method: string; status: number; path: string }> = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith("/api/admin/")) {
      responses.push({ method: response.request().method(), status: response.status(), path: url.pathname });
    }
  });

  await login(page);
  await openD2(page);
  await expect(page.getByText("D5 日限", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "07-d2-authoritative-queue.png"), fullPage: true });

  await openD4(page);
  for (const label of ["充值", "提现", "收益", "佣金", "兑换", "退款", "奖励"]) {
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname === "/api/admin/bills");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
  }
  await expect(page.getByText("服务端分页 · 精确七类", { exact: false })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "08-d4-seven-ledgers.png"), fullPage: true });

  await openD5(page);
  const original = await getD5(page);
  expect(original.balanceMaxRatio).toBeLessThan(1);
  const targetRatio = Math.round((original.balanceMaxRatio + 0.01) * 100) / 100;
  const targetPct = targetRatio * 100;
  const balanceRow = page.locator(".p-row").filter({ hasText: "余额可提上限" }).first();
  await balanceRow.getByLabel("余额可提上限目标值").fill(String(targetPct));
  await balanceRow.getByRole("button", { name: "预览并提交", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill(`${runId} D5 放大余额可提上限红线失败关闭验证`);
  await expect(dialog).toContainText(/覆盖率低于红线|低于红线/);
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  const writeResponse = await page.request.put("/api/admin/withdraw/limits", {
    headers: { "Idempotency-Key": `${runId}-d5-redline-reject` },
    data: {
      balanceMaxRatio: targetRatio,
      expectedVersion: original.version,
      reason: `${runId} D5 服务端红线失败关闭验证`,
      operator: username,
    },
  });
  expect(writeResponse.status()).toBe(422);
  const unchanged = await getD5(page);
  expect(unchanged.version).toBe(original.version);
  expect(unchanged.balanceMaxRatio).toBe(original.balanceMaxRatio);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  await expect(balanceRow.getByLabel("余额可提上限目标值")).toHaveValue(String(original.balanceMaxRatio * 100));

  await logout(page);
  await login(page);
  await openD5(page);
  const final = await getD5(page);
  expect(final.balanceMaxRatio).toBe(original.balanceMaxRatio);
  await page.screenshot({ path: path.join(evidenceDir, "09-d5-relogin-restored.png"), fullPage: true });
  writeEvidence("04-d2-d4-d5-result.json", {
    runId,
    anonymous: { d2: 401, d4: 401, d5: 401 },
    d4Categories: 7,
    d5: {
      originalRatio: original.balanceMaxRatio,
      attemptedRatio: targetRatio,
      amplificationStatus: writeResponse.status(),
      finalRatio: final.balanceMaxRatio,
      unchanged: true,
    },
    responses,
  });
});

test("D1 与 D6 的真实写入具备中文 CAS 指引、幂等防重、审计历史和重登持久化", async ({ page }) => {
  await login(page);
  await openD1(page);

  const originalVietQr = await getVietQr(page);
  cleanupVietQr = originalVietQr.config;
  const tolerance = originalVietQr.config.toleranceVnd;
  const changedTolerance = tolerance >= 5_000 ? tolerance - 1 : tolerance + 1;
  const toleranceRow = page.locator(".p-row").filter({ hasText: "金额容差" }).first();
  await toleranceRow.getByRole("button", { name: "调整", exact: true }).click();
  const d1Dialog = page.getByRole("dialog");
  await expect(d1Dialog).toContainText(`当前 ${tolerance}`);

  const d1AdvanceKey = `${runId}-d1-advance`;
  const advance = await page.request.patch("/api/admin/finance/vietqr/config", {
    headers: { "Idempotency-Key": d1AdvanceKey },
    data: vietQrUpdateBody(originalVietQr.config, { toleranceVnd: changedTolerance }, `${runId} 制造真实并发版本用于复审`),
  });
  expect(advance.status()).toBe(200);

  await d1Dialog.getByLabel("目标新值").fill(String(tolerance));
  await d1Dialog.locator("textarea").fill(`${runId} 验证旧版本不会覆盖新配置`);
  const staleResponse = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/admin/finance/vietqr/config"));
  await d1Dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await staleResponse).status()).toBe(409);
  await expect(
    page.getByRole("alert").filter({ hasText: "VietQR 参数已被其他操作员修改，本次未覆盖" }),
  ).toBeVisible();
  await expect(page.getByText(/银行轨操作结果未确认，已停止展示旧数据/)).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "03-d1-cas-chinese-guidance.png"), fullPage: true });

  const currentVietQr = await getVietQr(page);
  const d1Restore = await page.request.patch("/api/admin/finance/vietqr/config", {
    headers: { "Idempotency-Key": `${runId}-d1-restore` },
    data: vietQrUpdateBody(currentVietQr.config, { toleranceVnd: tolerance }, `${runId} 精确恢复 D1 原始容差`),
  });
  expect(d1Restore.status()).toBe(200);
  await d1Dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.reload();
  await expect(page.getByText("银行转账（VietQR）对账", { exact: true })).toBeVisible();
  await expect(toleranceRow.locator(".v")).toContainText(tolerance.toLocaleString("en-US"));

  await openD6(page);
  const originalFx = await getFx(page);
  cleanupFx = originalFx;
  const changedBase = originalFx.baseRateVndPerUsdt >= 34_990
    ? originalFx.baseRateVndPerUsdt - 10
    : originalFx.baseRateVndPerUsdt + 10;
  const baseRow = page.locator(".p-row").filter({ hasText: "基准价" }).first();
  await baseRow.getByRole("button", { name: "调整", exact: true }).click();
  const d6Dialog = page.getByRole("dialog");
  await d6Dialog.getByLabel("目标新值").fill(String(changedBase));
  const uiReason = `${runId} 首次用户通过页面调整牌价`;
  await d6Dialog.locator("textarea").fill(uiReason);
  const uiWrite = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/admin/finance/fx-quote"));
  await d6Dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const uiWriteResponse = await uiWrite;
  expect(uiWriteResponse.status()).toBe(200);
  const uiFx = (await uiWriteResponse.json() as Envelope<FxQuote>).data;
  await expect(baseRow.locator(".v")).toContainText(changedBase.toLocaleString("en-US"));
  await expect(page.getByText(uiReason, { exact: true })).toBeVisible();

  const restoreReason = `${runId} 精确恢复 D6 原始牌价`;
  const restoreKey = `${runId}-d6-restore-replay`;
  const restoreBody = fxUpdateBody(uiFx, {
    baseRateVndPerUsdt: originalFx.baseRateVndPerUsdt,
    buySpreadPct: originalFx.buySpreadPct,
    lockWindowMinutes: originalFx.lockWindowMinutes,
  }, restoreReason);
  const restoreFirst = await page.request.patch("/api/admin/finance/fx-quote", {
    headers: { "Idempotency-Key": restoreKey },
    data: restoreBody,
  });
  expect(restoreFirst.status()).toBe(200);
  const restoreFirstFx = (await restoreFirst.json() as Envelope<FxQuote>).data;
  const restoreReplay = await page.request.patch("/api/admin/finance/fx-quote", {
    headers: { "Idempotency-Key": restoreKey },
    data: restoreBody,
  });
  expect(restoreReplay.status()).toBe(200);
  const restoreReplayFx = (await restoreReplay.json() as Envelope<FxQuote>).data;
  expect(restoreReplayFx.version).toBe(restoreFirstFx.version);
  expect(restoreReplayFx.history.length).toBe(restoreFirstFx.history.length);

  // The visible page still holds the earlier UI version. A second visible write
  // must therefore fail closed instead of overwriting the restored server state.
  await baseRow.getByRole("button", { name: "调整", exact: true }).click();
  const staleD6Dialog = page.getByRole("dialog");
  const staleD6Target = changedBase >= 34_990 ? changedBase - 10 : changedBase + 10;
  await staleD6Dialog.getByLabel("目标新值").fill(String(staleD6Target));
  await staleD6Dialog.locator("textarea").fill(`${runId} 验证 D6 旧版本安全失败`);
  const d6Stale = page.waitForResponse((response) =>
    response.request().method() === "PATCH" && response.url().includes("/api/admin/finance/fx-quote"));
  await staleD6Dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  expect((await d6Stale).status()).toBe(409);
  await expect(
    page.getByRole("alert").filter({ hasText: "汇率牌价已被其他操作员修改，本次未覆盖" }),
  ).toBeVisible();
  await expect(page.getByText(/写入结果未确认，已停止展示旧牌价/)).toBeVisible();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, "04-d6-idempotency-cas-fail-closed.png"), fullPage: true });

  await staleD6Dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  await expect(baseRow.locator(".v")).toContainText(originalFx.baseRateVndPerUsdt.toLocaleString("en-US"));
  await expect(page.getByText(restoreReason, { exact: true })).toBeVisible();

  await logout(page);
  await login(page);
  await openD6(page);
  await expect(baseRow.locator(".v")).toContainText(originalFx.baseRateVndPerUsdt.toLocaleString("en-US"));
  await expect(page.getByText(restoreReason, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "05-d6-relogin-restored.png"), fullPage: true });

  const finalVietQr = await getVietQr(page);
  const finalFx = await getFx(page);
  expect(finalVietQr.config.toleranceVnd).toBe(tolerance);
  expect(finalFx.baseRateVndPerUsdt).toBe(originalFx.baseRateVndPerUsdt);
  expect(finalFx.buySpreadPct).toBe(originalFx.buySpreadPct);
  expect(finalFx.lockWindowMinutes).toBe(originalFx.lockWindowMinutes);
  cleanupVietQr = undefined;
  cleanupFx = undefined;
  writeEvidence("02-mutation-result.json", {
    runId,
    d1: {
      originalTolerance: tolerance,
      staleWriteStatus: 409,
      finalTolerance: finalVietQr.config.toleranceVnd,
    },
    d6: {
      original: originalFx,
      uiVersion: uiFx.version,
      restoredVersion: restoreFirstFx.version,
      replayVersion: restoreReplayFx.version,
      replayHistoryCount: restoreReplayFx.history.length,
      staleWriteStatus: 409,
      final: finalFx,
    },
  });
});

test("D6 匿名访问被拒绝，读取异常时隐藏旧数据并给出恢复入口", async ({ page, request }) => {
  const anonymousBff = await request.get("/api/admin/finance/fx-quote");
  expect(anonymousBff.status()).toBe(401);
  const anonymousBackend = await request.get("http://127.0.0.1:8110/api/admin/finance/fx-quote");
  expect(anonymousBackend.status()).toBe(401);

  await login(page);
  await openD6(page);
  await page.route("**/api/admin/finance/fx-quote", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "FX_QUOTE_CONFIG_UNAVAILABLE", data: null }),
    });
  });
  await page.reload();
  await expect(page.getByText(/汇率牌价尚未初始化或读取失败/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重试读取", exact: true })).toBeVisible();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceDir, "06-d6-read-failure-fail-closed.png"), fullPage: true });

  await page.unroute("**/api/admin/finance/fx-quote");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  writeEvidence("03-security-fail-closed-result.json", {
    runId,
    anonymousBffStatus: anonymousBff.status(),
    anonymousBackendStatus: anonymousBackend.status(),
    injectedFailure: "FX_QUOTE_CONFIG_UNAVAILABLE",
    recovered: true,
  });
});
