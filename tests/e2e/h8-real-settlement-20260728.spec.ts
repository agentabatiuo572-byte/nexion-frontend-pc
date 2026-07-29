import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type ApiEnvelope<T = unknown> = { code?: number; message?: string; data?: T };
type H8Overview = {
  pending: number;
  settled: number;
  recentSettlements: Array<{
    settlementNo: string;
    invitedUserId: number;
    inviterUserId: number;
    newcomerUsdt: number;
    newcomerNex: number;
    inviterNex: number;
    status: string;
  }>;
};

const RUN_ID = "pc-full-acceptance-20260728-151023";
const FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const EVIDENCE_DIR = process.env.H8_SETTLEMENT_EVIDENCE_DIR
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/h8-real-settlement`;
const EXISTING_OPERATION_ID = process.env.H8_EXISTING_OPERATION_ID?.trim() || "";
const invitedUserId = Number(process.env.H8_INVITED_USER_ID);
const inviterUserId = Number(process.env.H8_INVITER_USER_ID);
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  accounts: { d_checker: Account };
};

if (!Number.isSafeInteger(invitedUserId) || !Number.isSafeInteger(inviterUserId)) {
  throw new Error("H8_INVITED_USER_ID and H8_INVITER_USER_ID are required");
}

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("H8 隔离夹具经独立 maker/checker 真实结算并贯通钱包、D4、A2、A4", async ({ browser }) => {
  test.setTimeout(150_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const makerErrors = monitorErrors(makerPage);
  const checkerErrors = monitorErrors(checkerPage);

  try {
    await loginSuperadmin(makerPage);
    await openH8FromSidebar(makerPage);
    const before = await readH8(makerPage);
    const alreadySettled = before.recentSettlements.find((row) =>
      row.invitedUserId === invitedUserId && row.inviterUserId === inviterUserId);
    if (!alreadySettled) expect(before.pending).toBeGreaterThanOrEqual(1);

    const denied = await makerPage.request.post("/api/admin/growth/referral-rewards/settlements/run", {
      headers: { "Idempotency-Key": `${RUN_ID}-H8-DIRECT-DENIED` },
      data: {
        limit: 1,
        reason: `${RUN_ID} 直调不得绕过 A2 独立复核`,
        operator: "superadmin",
      },
    });
    const deniedBody = await denied.json() as ApiEnvelope;
    expect(denied.status()).toBe(409);
    expect(deniedBody.message).toContain("A2_CONFIRMATION_REQUIRED");

    let operationId = EXISTING_OPERATION_ID;
    if (!operationId && !alreadySettled) {
      await expect(makerPage.getByRole("button", { name: "执行真实结算", exact: true })).toBeEnabled();
      await makerPage.getByRole("button", { name: "执行真实结算", exact: true }).click();
      const proposalDialog = makerPage.getByRole("dialog").filter({ hasText: "执行邀请奖励真实结算" });
      await proposalDialog.getByLabel("目标新值").fill("1");
      await proposalDialog.getByLabel(/操作理由/).fill(
        `${RUN_ID} H8 maker 核对真实邀请关系、K1K2、H1 倍率、B1 覆盖及精确清理预案`,
      );
      const proposalResponse = makerPage.waitForResponse((response) =>
        response.request().method() === "POST"
        && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
      await proposalDialog.getByRole("button", { name: "确认提交", exact: true }).click();
      const proposal = await apiSuccess<Record<string, unknown>>(await proposalResponse, "H8 proposal");
      operationId = String(proposal.operationId ?? proposal.id ?? "");
    }
    expect(operationId).toMatch(/^(?:WO|OP)-/);
    await makerPage.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    await loginMfa(checkerPage, fixture.accounts.d_checker);
    if (!alreadySettled) {
      await approveThroughA2(
        checkerPage,
        operationId,
        `${RUN_ID} checker 独立核对 H8 夹具、资金覆盖、奖励快照与恢复清单后批准`,
      );
    }

    const after = await readH8(checkerPage);
    expect(after.settled).toBe(alreadySettled ? before.settled : before.settled + 1);
    const settlement = after.recentSettlements.find((row) =>
      row.invitedUserId === invitedUserId && row.inviterUserId === inviterUserId);
    expect(settlement).toBeTruthy();
    expect(settlement?.status).toBe("SETTLED");
    expect(Number(settlement?.newcomerUsdt)).toBeGreaterThan(0);
    expect(Number(settlement?.newcomerNex)).toBeGreaterThan(0);
    expect(Number(settlement?.inviterNex)).toBeGreaterThan(0);

    const ledger = await apiSuccess<{ records?: Array<Record<string, unknown>>; rows?: Array<Record<string, unknown>> }>(
      await checkerPage.request.get(
        `/api/admin/treasury/ledger/bills?keyword=${encodeURIComponent(settlement!.settlementNo)}&pageNum=1&pageSize=20`,
      ),
      "D4 referral ledger",
    );
    const ledgerRows = ledger.records ?? ledger.rows ?? [];
    expect(ledgerRows).toHaveLength(3);
    expect(new Set(ledgerRows.map((row) => String(row.asset)))).toEqual(new Set(["USDT", "NEX"]));

    const audit = await checkerPage.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(settlement!.settlementNo)}&limit=100`,
    );
    const events = await checkerPage.request.get("/api/admin/platform/events/overview");
    const a2Overview = await apiSuccess<{
      operationQueue?: Array<{ id?: string; status?: string }>;
      operationHistory?: Array<{ id?: string; st?: string }>;
    }>(
      await checkerPage.request.get("/api/admin/platform/audit/overview"),
      "A2 overview",
    );
    expect(audit.status()).toBe(200);
    expect(events.status()).toBe(200);
    const operation = (a2Overview.operationQueue ?? []).find((row) => row.id === operationId);
    const history = (a2Overview.operationHistory ?? []).find((row) => row.id === operationId);
    expect(operation?.status ?? history?.st).toBe("approved");

    await openH8FromSidebar(checkerPage);
    await checkerPage.reload({ waitUntil: "domcontentloaded" });
    await expect(checkerPage.getByText(settlement!.settlementNo, { exact: true })).toBeVisible();
    await checkerPage.screenshot({ path: path.join(EVIDENCE_DIR, "02-checker-settled.png"), fullPage: true });
    expect(makerErrors).toEqual([]);
    expect(checkerErrors).toEqual([]);

    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
      runId: RUN_ID,
      operationId,
      invitedUserId,
      inviterUserId,
      settlement,
      ledgerRows,
      directCallDenied: true,
      independentBrowserContexts: true,
      maker: "superadmin",
      checker: fixture.accounts.d_checker.username,
      a2AuditStatus: audit.status(),
      a4OverviewStatus: events.status(),
      pageErrors: 0,
    }, null, 2));
  } finally {
    await makerContext.close();
    await checkerContext.close();
  }
});

async function readH8(page: Page) {
  return apiSuccess<H8Overview>(
    await page.request.get("/api/admin/growth/referral-rewards"),
    "H8 overview",
  );
}

async function openH8FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /增长与运营节奏\s+H|H\s+增长与运营节奏/ }).first();
  const link = page.locator('aside a[href="/growth/referral-rewards"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/growth\/referral-rewards$/);
  await expect(page.getByText("新人礼与邀请人奖励", { exact: true }).last()).toBeVisible();
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('aside a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await platform.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await apiSuccess(await responsePromise, `approve ${operationId}`);
  await expect(page.getByText(`${operationId} 已执行`, { exact: false })).toBeVisible();
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill("superadmin");
  await page.locator('input[autocomplete="current-password"]').fill("Admin@123456");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function loginMfa(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function apiSuccess<T>(
  response: Pick<Response, "ok" | "status" | "json">,
  label: string,
): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

function monitorErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
