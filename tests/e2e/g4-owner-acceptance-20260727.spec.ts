import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const BACKEND = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
// Direct loopback public-route checks model the trusted edge, not an App client.
const TRUSTED_EDGE_HEADERS = { "X-Nexion-Edge-Country": "JP", "CF-IPCountry": "JP" };
const EVIDENCE_DIR = path.resolve(
  "D:/workspace/nexion-ops-console/docs/验收报告/PC管理端全面测试-20260726/G4-evidence",
);

type Envelope<T> = { code: number; message?: string; data: T };
type GenesisOverview = {
  stats: {
    totalSlots: number;
    sold: number;
    unitPrice: number;
    unsold: number;
    marketOn: boolean;
    todayBatch: string;
    secondary: { royaltyPct: number; listed: number; owners: number };
  };
  dividend: { dividendPct: number; batchNo: string; batchStatus: string };
  params: Array<{ key: string; value: number | string }>;
  emissionGate: { open: boolean; owner: string; configKey: string };
  market: { enabled: boolean; linkedDomain: string; configKey: string };
  nodes: unknown[];
  nodePage: { total: number; page: number; pageSize: number };
  serverCanonical: boolean;
  sources: string[];
};
type Operations = {
  config: Record<string, string | null>;
  simulations: Array<{
    id: number;
    simulationNo: string;
    recordType: string;
    status: string;
    quantity: number | string;
    unitPrice: number | string;
  }>;
  simulationScope: string;
  ledgerImpact: string;
  includedInMarketStats: boolean;
};

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("G4 首次用户从侧栏完成真实虚拟成交、刷新、归档与重新登录复核", async ({ page }) => {
  const diagnostics = { pageErrors: [] as string[], consoleErrors: [] as string[], serverErrors: [] as string[] };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      diagnostics.serverErrors.push(`${response.request().method()} ${response.status()} ${response.url()}`);
    }
  });

  await login(page);
  await openG4FromSidebar(page);
  const overview = await readOverview(page);
  const operationsBefore = await readOperations(page);

  expect(overview.serverCanonical).toBe(true);
  expect(overview.stats.totalSlots).toBeGreaterThan(0);
  expect(overview.stats.sold).toBe(overview.nodePage.total);
  expect(overview.stats.unsold).toBe(overview.stats.totalSlots - overview.stats.sold);
  expect(overview.emissionGate).toMatchObject({
    owner: "H1",
    configKey: "growth.phase.genesis_emissions_open",
  });
  expect(overview.market.linkedDomain).toContain("J1");
  expect(overview.sources).toEqual(expect.arrayContaining([
    "nx_genesis_series",
    "nx_genesis_holding",
    "nx_genesis_order",
    "nx_config_item:growth.phase.genesis_emissions_open",
    "B1 coverage facade",
  ]));
  expect(operationsBefore).toMatchObject({
    simulationScope: "ADMIN_ONLY",
    ledgerImpact: "NONE",
    includedInMarketStats: false,
  });

  for (const text of [
    "资格门与预售",
    "虚拟成交演练",
    "节点经济参数",
    "一二级市场",
    "排放派发监控",
    "节点持有台账",
    "持有、排放、二级成交全部以服务器为准",
  ]) {
    await expect(page.getByText(text, { exact: false }).first()).toBeVisible();
  }
  await expect(page.getByRole("link", { name: /地域封锁/ })).toHaveAttribute("href", "/emergency/geo-block");
  await expect(page.locator("body")).toContainText("H1 权威");
  await expect(page.locator("body")).toContainText("J1");

  const eligibilityCard = page.locator(".param-grid .p").filter({ hasText: "资格门启用" });
  await eligibilityCard.getByRole("button", { name: "调整" }).click();
  let dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toContainText("G4 运营配置");
  await expect(dialog).toContainText("配置保存在服务端，不产生用户资产或市场成交");
  await expect(dialog.locator("textarea")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();

  const runId = `G4OWNER-${Date.now()}`;
  const quantity = "2";
  const unitPrice = "123.45";
  const simulationCard = page.locator(".l-card").filter({ hasText: "虚拟成交演练" });
  await simulationCard.locator("select").selectOption("BUY");
  await simulationCard.locator('input[placeholder="数量"]').fill(quantity);
  await simulationCard.locator('input[placeholder="单价"]').fill(unitPrice);
  await simulationCard.getByRole("button", { name: "创建虚拟成交" }).click();
  dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toContainText("SIMULATED");
  await expect(dialog).toContainText("不写钱包、账本、真实成交或市场统计");
  await dialog.locator("textarea").fill(`${runId} 首次用户创建管理端隔离演练记录`);
  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/admin/market/nex/genesis/operations/simulations")
      && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(200);
  await expect(dialog).toBeHidden();

  const created = (await readOperations(page)).simulations.find((row) =>
    Number(row.quantity) === Number(quantity) && Number(row.unitPrice) === Number(unitPrice),
  );
  expect(created, "真实服务端应保存本次 ADMIN_ONLY 演练记录").toBeTruthy();
  await expect(page.getByText(created!.simulationNo, { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-created-simulation.png"), fullPage: true });

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("虚拟成交演练", { exact: true })).toBeVisible();
  await expect(page.getByText(created!.simulationNo, { exact: true })).toBeVisible();

  const row = page.locator("tbody tr").filter({ hasText: created!.simulationNo });
  await row.getByRole("button", { name: "归档" }).click();
  dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toContainText("仅归档管理端 SIMULATED 记录");
  await dialog.locator("textarea").fill(`${runId} 演练验证完成后归档隔离记录`);
  const archiveResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/api/admin/market/nex/genesis/operations/simulations/${created!.id}`)
      && response.request().method() === "DELETE",
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const archiveResponse = await archiveResponsePromise;
  expect(archiveResponse.status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(page.getByText(created!.simulationNo, { exact: true })).toBeHidden();

  await page.context().clearCookies();
  await login(page);
  await openG4FromSidebar(page);
  await expect(page.getByText(created!.simulationNo, { exact: true })).toBeHidden();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-relogin-archive-persisted.png"), fullPage: true });

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "browser-diagnostics.json"),
    JSON.stringify(diagnostics, null, 2),
    "utf8",
  );
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors.filter((line) => !line.includes("401 (Unauthorized)"))).toEqual([]);
  expect(diagnostics.serverErrors).toEqual([]);
});

test("G4 墨菲探针覆盖认证、幂等冲突、非法输入、H1 关阀与 App 单源", async ({ page }) => {
  await login(page);
  await openG4FromSidebar(page);
  const baseline = await readOverview(page);
  const operationsBefore = await readOperations(page);
  const runId = `G4MURPHY-${Date.now()}`;
  const evidence: Record<string, unknown> = { baseline, operationsBefore };

  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  const anonymousRead = await anonymous.get("/api/admin/market/nex/genesis");
  const anonymousWrite = await anonymous.post("/api/admin/market/nex/genesis/operations/simulations", {
    data: { side: "BUY", quantity: 1, unitPrice: 1, reason: `${runId} 未登录写入应拒绝`, operator: USERNAME },
  });
  evidence.anonymous = { read: anonymousRead.status(), write: anonymousWrite.status() };
  expect(anonymousRead.status()).toBe(401);
  expect(anonymousWrite.status()).toBe(401);
  await anonymous.dispose();

  const missingKey = await raw(page, "POST", "/api/admin/market/nex/genesis/operations/simulations", {
    side: "BUY",
    quantity: 1,
    unitPrice: 1,
    reason: `${runId} 缺失幂等键必须失败关闭`,
    operator: USERNAME,
  });
  evidence.missingKey = missingKey;
  expect(missingKey.status).toBe(422);
  expect(String(missingKey.body?.message)).toContain("IDEMPOTENCY_KEY_REQUIRED");

  const invalidAmount = await raw(page, "POST", "/api/admin/market/nex/genesis/operations/simulations", {
    side: "BUY",
    quantity: 0,
    unitPrice: 1,
    reason: `${runId} 非法数量必须失败关闭`,
    operator: USERNAME,
  }, `${runId}-invalid-amount`);
  evidence.invalidAmount = invalidAmount;
  expect(invalidAmount.status).toBe(422);

  const invalidParam = await raw(page, "PATCH", "/api/admin/market/nex/genesis/params/__unknown__", {
    value: "1",
    reason: `${runId} 非法参数键必须失败关闭`,
    operator: USERNAME,
  }, `${runId}-invalid-param`);
  evidence.invalidParam = invalidParam;
  expect(invalidParam.status).toBe(422);

  const batch = baseline.dividend.batchNo || new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const closedRerun = await raw(page, "POST", `/api/admin/market/nex/genesis/dividend-batches/${batch}/rerun`, {
    value: "rerun",
    reason: `${runId} H1关阀时重跑必须失败关闭`,
    operator: USERNAME,
    decisionRef: `${runId}-FIN`,
  }, `${runId}-closed-rerun`);
  evidence.closedRerun = closedRerun;
  expect(baseline.emissionGate.open).toBe(false);
  expect(closedRerun.status).toBe(409);
  expect(String(closedRerun.body?.message)).toContain("G4_GENESIS_EMISSION_GATE_CLOSED");
  await expect(page.getByRole("button", { name: /重跑今日批次/ })).toBeDisabled();

  const replayKey = `${runId}-replay`;
  const replayBody = {
    side: "SELL",
    quantity: 3,
    unitPrice: 321.09,
    reason: `${runId} 同键同载荷仅创建一条`,
    operator: USERNAME,
  };
  const first = await raw(page, "POST", "/api/admin/market/nex/genesis/operations/simulations", replayBody, replayKey);
  const replay = await raw(page, "POST", "/api/admin/market/nex/genesis/operations/simulations", replayBody, replayKey);
  const conflict = await raw(page, "POST", "/api/admin/market/nex/genesis/operations/simulations", {
    ...replayBody,
    unitPrice: 321.10,
  }, replayKey);
  evidence.idempotency = { first, replay, conflict };
  expect(first.status).toBe(200);
  expect(replay.status).toBe(200);
  expect(first.body?.data?.simulationNo).toBe(replay.body?.data?.simulationNo);
  expect(conflict.status).toBe(409);

  const createdNo = String(first.body?.data?.simulationNo);
  const operationsAfterReplay = await readOperations(page);
  expect(operationsAfterReplay.simulations.filter((row) => row.simulationNo === createdNo)).toHaveLength(1);
  const created = operationsAfterReplay.simulations.find((row) => row.simulationNo === createdNo);
  expect(created).toBeTruthy();
  const archiveKey = `${runId}-archive`;
  const archiveBody = { value: "ARCHIVED", reason: `${runId} 幂等探针完成后归档`, operator: USERNAME };
  const archiveFirst = await raw(
    page,
    "DELETE",
    `/api/admin/market/nex/genesis/operations/simulations/${created!.id}`,
    archiveBody,
    archiveKey,
  );
  const archiveReplay = await raw(
    page,
    "DELETE",
    `/api/admin/market/nex/genesis/operations/simulations/${created!.id}`,
    archiveBody,
    archiveKey,
  );
  evidence.archive = { archiveFirst, archiveReplay };
  expect(archiveFirst.status).toBe(200);
  expect(archiveReplay.status).toBe(200);

  const backend = await playwrightRequest.newContext({ baseURL: BACKEND, extraHTTPHeaders: TRUSTED_EDGE_HEADERS });
  const appStateResponse = await backend.get("/api/genesis/state");
  const appState = await appStateResponse.json() as Envelope<Record<string, any>>;
  const anonymousAccount = await backend.get("/api/genesis/account");
  const anonymousAccountBody = await anonymousAccount.json();
  evidence.app = {
    stateStatus: appStateResponse.status(),
    state: appState,
    anonymousAccountStatus: anonymousAccount.status(),
    anonymousAccount: anonymousAccountBody,
  };
  expect(appStateResponse.status()).toBe(200);
  expect(appState.code).toBe(0);
  expect(appState.data.serverCanonical).toBe(true);
  expect(appState.data.series.totalSupply).toBe(baseline.stats.totalSlots);
  expect(Number(appState.data.series.priceUsdt)).toBe(baseline.stats.unitPrice);
  expect(Number(appState.data.series.royaltyPct)).toBe(baseline.stats.secondary.royaltyPct);
  expect(Number(appState.data.emission.dailyRatePct)).toBe(
    Number(baseline.params.find((row) => row.key === "dividend")?.value),
  );
  expect(appState.data.market.enabled).toBe(baseline.market.enabled);
  expect(appState.data.emission.open).toBe(baseline.emissionGate.open);
  expect(anonymousAccountBody.code).not.toBe(0);
  await backend.dispose();

  const restored = await readOverview(page);
  const operationsRestored = await readOperations(page);
  evidence.restored = { restored, operationsRestored };
  expect(restored.stats).toEqual(baseline.stats);
  expect(restored.dividend).toEqual(baseline.dividend);
  expect(operationsRestored.simulations.some((row) => row.simulationNo === createdNo)).toBe(false);

  fs.writeFileSync(
    path.join(EVIDENCE_DIR, "murphy-probes.json"),
    JSON.stringify(evidence, null, 2),
    "utf8",
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("G4 Genesis 经济", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-murphy-restored.png"), fullPage: true });
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openG4FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /金融产品\s+G|G\s+金融产品/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const entry = page.locator('a[href="/finance-products/genesis"]').first();
  await expect(entry, "首次用户必须能从可见侧栏找到 G4 Genesis").toBeVisible();
  await Promise.all([
    page.waitForResponse((response) =>
      response.url().includes("/api/admin/market/nex/genesis") && response.request().method() === "GET",
    ),
    entry.click(),
  ]);
  await expect(page).toHaveURL(/\/finance-products\/genesis$/);
  await expect(page.getByText("G4 Genesis 经济", { exact: false }).first()).toBeVisible();
}

async function readOverview(page: Page) {
  const response = await page.request.get("/api/admin/market/nex/genesis?page=1&pageSize=10");
  expect(response.status()).toBe(200);
  const payload = await response.json() as Envelope<GenesisOverview>;
  expect(payload.code).toBe(0);
  return payload.data;
}

async function readOperations(page: Page) {
  const response = await page.request.get("/api/admin/market/nex/genesis/operations");
  expect(response.status()).toBe(200);
  const payload = await response.json() as Envelope<Operations>;
  expect(payload.code).toBe(0);
  return payload.data;
}

async function raw(
  page: Page,
  method: "PATCH" | "POST" | "DELETE",
  url: string,
  data: Record<string, unknown>,
  idempotencyKey?: string,
) {
  const response = await page.request.fetch(url, {
    method,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    data,
  });
  return {
    status: response.status(),
    body: await response.json().catch(() => null) as any,
  };
}
