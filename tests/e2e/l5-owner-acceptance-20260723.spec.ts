import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type APIResponse,
  type Download,
  type Locator,
  type Page,
} from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = path.resolve(
  process.env.L5_ACCEPTANCE_DIR
    ?? "D:/workspace/bug-pic/l-domain-parallel-acceptance-20260723-000935/L5-export-regulatory/evidence/independent-playwright",
);
const RUN_ID = Date.now();

const AGGREGATE_TYPES = ["KPI 序列", "漏斗序列", "财务聚合", "运营聚合"] as const;
const REGULATORY_TEMPLATES = ["AML_REPORT", "JURISDICTION_SPECIAL", "PAYOUT_REPORT"] as const;

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type RegulatoryOptions = {
  templates: { code: string; label: string }[];
  disclosures: {
    jurisdictionCode: string;
    jurisdictionName: string;
    disclosureVersion: string;
    chapterCount: number;
  }[];
};

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await login(page);
});

test("L5 首次用户从可见侧栏完成四类聚合、D4 七账单与四模板监管报告闭环", async ({ page, context }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const unexpectedMutationFailures: string[] = [];
  const intentionalSessionResetFailures: string[] = [];
  let intentionalSessionReset = false;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (intentionalSessionReset && message.text().includes("401 (Unauthorized)")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (intentionalSessionReset && response.status() >= 400) {
      intentionalSessionResetFailures.push(`${response.request().method()} ${response.status()} ${url.pathname}`);
    }
    const expectedAdversarial = url.pathname === "/api/admin/regulatory/report"
      && response.request().headers()["x-l5-negative"] === "true";
    if (response.request().method() !== "GET" && response.status() >= 400 && !expectedAdversarial) {
      unexpectedMutationFailures.push(`${response.request().method()} ${response.status()} ${url.pathname}`);
    }
  });

  await openFromSidebar(page);
  await expect(page.getByRole("heading", { name: "导出 & 监管报告" })).toBeVisible();
  await expect(page.getByText("数据出境统一管控面")).toBeVisible();
  await expect(page.getByRole("button", { name: "发起聚合快照" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "生成监管报告" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "导出七类账单明细" })).toBeEnabled();
  await expect(page.locator("body")).not.toContainText("会增加资金流出");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-l5-visible-entry.png"), fullPage: true });

  const optionsResponse = await context.request.get(`${BASE_URL}/api/admin/regulatory/options`);
  expect(optionsResponse.status()).toBe(200);
  const optionsEnvelope = await optionsResponse.json() as ApiEnvelope<RegulatoryOptions>;
  expect(optionsEnvelope.code).toBe(0);
  const options = optionsEnvelope.data!;
  expect(options.templates.map((item) => item.code).sort()).toEqual([...REGULATORY_TEMPLATES].sort());
  expect(options.disclosures.length).toBeGreaterThan(0);
  expect(options.disclosures.every((item) => item.chapterCount === 7)).toBe(true);
  const disclosure = options.disclosures[0];

  await rejectInvalidRegulatoryRequests(context.request, disclosure);
  await expect(page.locator("body")).not.toContainText(`99105-L5-NEG-${RUN_ID}`);

  const aggregateReportIds: string[] = [];
  for (const [index, exportType] of AGGREGATE_TYPES.entries()) {
    const ticket = `99105-L5-AGG-${index + 1}-${RUN_ID}`;
    await page.getByRole("button", { name: "发起聚合快照" }).click();
    const dialog = page.getByRole("dialog", { name: "发起聚合快照导出" });
    await dialog.getByLabel("导出类型").selectOption({ label: exportType });
    await dialog.getByLabel("时间范围").fill("2026-07 验收窗口");
    await dialog.getByLabel("聚合字段").fill("服务端权威聚合指标");
    await dialog.getByLabel("接收人 / 用途").fill("L5 首次用户验收");
    await dialog.getByLabel("业务依据 / 工单").fill(ticket);
    await dialog.getByRole("textbox", { name: /操作理由/ }).fill(`99105 L5验收${exportType}快照创建下载闭环`);
    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/bi/reports",
    );
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(200);
    const envelope = await createResponse.json() as ApiEnvelope<{ created: { reportId: string; status: string; containsPii: boolean } }>;
    expect(envelope.code).toBe(0);
    expect(envelope.data?.created.status).toBe("READY");
    expect(envelope.data?.created.containsPii).toBe(false);
    const reportId = envelope.data!.created.reportId;
    aggregateReportIds.push(reportId);
    const row = page.locator("table tbody tr").filter({ hasText: ticket }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("可下载")).toBeVisible();
    await downloadAndAssertCsv(page, row, reportId);
  }
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-four-aggregate-ready.png"), fullPage: true });

  const ledgerDownloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("button", { name: "导出七类账单明细" }).click();
  const ledgerDialog = page.getByRole("dialog", { name: "导出七类账单脱敏明细" });
  await expect(ledgerDialog.getByRole("button", { name: "确认提交" })).toBeDisabled();
  await ledgerDialog.getByRole("textbox", { name: /操作理由/ }).fill("99105 L5验收D4七类账单脱敏导出与审计闭环");
  await ledgerDialog.getByRole("button", { name: "确认提交" }).click();
  const ledgerDownload = await ledgerDownloadPromise;
  expect(ledgerDownload.suggestedFilename()).toMatch(/^d4-bills-.*\.csv$/i);
  await ledgerDownload.saveAs(path.join(EVIDENCE_DIR, "l5-d4-bills-masked.csv"));
  const ledgerCsv = await downloadText(ledgerDownload);
  expect(ledgerCsv).toContain("bill_id,user_masked,bill_type,subtype,asset,direction,amount,balance_after,status,ref,created_at");
  expect(ledgerCsv).not.toContain("nickname");
  expect(ledgerCsv).not.toContain("remark");

  const regulatoryReportIds: string[] = [];
  for (const [index, templateCode] of REGULATORY_TEMPLATES.entries()) {
    const ticket = `99105-L5-REG-${index + 1}-${RUN_ID}`;
    await page.getByRole("button", { name: "生成监管报告" }).click();
    const dialog = page.getByRole("dialog", { name: "生成监管报告" });
    await expect(dialog.getByText("会增加资金流出")).toHaveCount(0);
    await dialog.getByLabel("报告模板").selectOption(templateCode);
    await dialog.getByLabel("报告期间").fill("2026-07");
    await dialog.getByLabel("接收机构 / 用途").fill("L5 监管报送验收");
    await dialog.getByLabel("业务工单").fill(ticket);
    await dialog.getByRole("textbox", { name: /操作理由/ }).fill(`99105 L5验收${templateCode}监管报告闭环`);
    const createResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/regulatory/report",
    );
    await dialog.getByRole("button", { name: "确认提交" }).click();
    const createResponse = await createResponsePromise;
    expect(createResponse.status()).toBe(200);
    const envelope = await createResponse.json() as ApiEnvelope<{
      created: { reportId: string; status: string; containsPii: boolean; maskingPolicy: string };
      disclosure: { jurisdictionCode: string; disclosureVersion: string; chapterCount: number };
    }>;
    expect(envelope.code).toBe(0);
    expect(envelope.data?.created).toMatchObject({ status: "READY", containsPii: false, maskingPolicy: "MASKED" });
    expect(envelope.data?.disclosure).toMatchObject({
      jurisdictionCode: disclosure.jurisdictionCode,
      disclosureVersion: disclosure.disclosureVersion,
      chapterCount: 7,
    });
    const reportId = envelope.data!.created.reportId;
    regulatoryReportIds.push(reportId);
    const row = page.locator("table tbody tr").filter({ hasText: ticket }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByText("可下载")).toBeVisible();
    const csv = await downloadAndAssertCsv(page, row, reportId);
    expect(csv).toContain("aggregate_only_no_user_rows");
    expect(csv).toContain("I5");
    expect(csv).toContain("A2");
    expect(csv).toContain("J4");
    expect(csv).not.toMatch(/user_id|phone|passport/i);
    if (templateCode === "PAYOUT_REPORT") expect(csv).toContain("D4");
    if (templateCode === "AML_REPORT") expect(csv).toContain("L3");
    if (templateCode === "JURISDICTION_SPECIAL") expect(csv).toContain("L4");
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("统一导出审计台")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("七类账单明细", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("监管报告", { exact: false }).first()).toBeVisible();
  await expect(page.getByText(/I5 当前披露校验/).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-regulatory-and-audit-ready.png"), fullPage: true });

  expect(consoleErrors).toEqual([]);
  intentionalSessionReset = true;
  await context.clearCookies();
  await login(page);
  intentionalSessionReset = false;
  await openFromSidebar(page);
  const persistedId = regulatoryReportIds.at(-1)!;
  const persistedRow = page.locator("table tbody tr").filter({ hasText: persistedId }).first();
  await expect(persistedRow).toBeVisible({ timeout: 20_000 });
  await expect(persistedRow.getByText("可下载")).toBeVisible();
  await downloadAndAssertCsv(page, persistedRow, persistedId);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-relogin-persisted-download.png"), fullPage: true });

  expect(aggregateReportIds).toHaveLength(4);
  expect(regulatoryReportIds).toHaveLength(4);
  expect(intentionalSessionResetFailures).toEqual(["GET 401 /api/admin/auth/session"]);
  expect(unexpectedMutationFailures).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("L5 未登录请求失败关闭且不暴露受保护监管选项", async () => {
  const anonymous = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const options = await anonymous.get("/api/admin/regulatory/options");
    expect(options.status()).toBe(401);
    const payload = await options.json() as ApiEnvelope<unknown>;
    expect(payload.code).toBe(401);
    expect(payload.data).toBeNull();
  } finally {
    await anonymous.dispose();
  }
});

async function login(page: Page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openFromSidebar(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/export"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/export$/);
  await expect(page.getByText("累计导出任务")).toBeVisible({ timeout: 20_000 });
}

async function rejectInvalidRegulatoryRequests(
  api: APIRequestContext,
  disclosure: RegulatoryOptions["disclosures"][number],
) {
  const baseBody = {
    templateCode: "AML_REPORT",
    period: "2026-07",
    jurisdictionCode: disclosure.jurisdictionCode,
    disclosureVersion: disclosure.disclosureVersion,
    recipient: "L5 验收",
    ticket: `99105-L5-NEG-${RUN_ID}`,
    reason: "99105 L5监管报告负向验收",
  };
  const shortReason = await api.post(`${BASE_URL}/api/admin/regulatory/report`, {
    headers: { "Idempotency-Key": `99105-l5-short-${RUN_ID}`, "x-l5-negative": "true" },
    data: { ...baseBody, reason: "short" },
  });
  await expectBusinessCode(shortReason, 422, "REGULATORY_REASON_LENGTH_INVALID");

  const staleVersion = await api.post(`${BASE_URL}/api/admin/regulatory/report`, {
    headers: { "Idempotency-Key": `99105-l5-stale-${RUN_ID}`, "x-l5-negative": "true" },
    data: { ...baseBody, disclosureVersion: `${disclosure.disclosureVersion}-STALE` },
  });
  await expectBusinessCode(staleVersion, 422, "I5_CURRENT_DISCLOSURE_NOT_FOUND");
}

async function expectBusinessCode(response: APIResponse, code: number, message: string) {
  expect([200, code]).toContain(response.status());
  const payload = await response.json() as ApiEnvelope<unknown>;
  expect(payload.code).toBe(code);
  expect(payload.message).toBe(message);
}

async function downloadAndAssertCsv(page: Page, row: Locator, reportId: string) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  const tokenResponsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/admin/bi/exports/${reportId}/download-token`,
  );
  await row.getByRole("button", { name: "下载", exact: true }).click();
  expect((await tokenResponsePromise).status()).toBe(200);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.csv$/i);
  await download.saveAs(path.join(EVIDENCE_DIR, `${reportId.toLowerCase()}.csv`));
  const csv = await downloadText(download);
  expect(csv.length).toBeGreaterThan(20);
  return csv;
}

async function downloadText(download: Download) {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
