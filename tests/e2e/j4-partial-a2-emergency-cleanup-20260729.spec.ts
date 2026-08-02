import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Account = {
  username: string;
  password: string;
  totpSecret: string;
};

type Fixture = {
  accounts: {
    maker: Account;
  };
  checker: Account;
};

type RecoveryState = {
  runId?: string;
  stage?: string;
  playbookCode?: string;
  operationId?: string;
};

type Envelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type A2Overview = {
  operationQueue?: Array<{
    id?: string;
    status?: string;
    obj?: string;
  }>;
  operationHistory?: Array<{
    id?: string;
    st?: string;
    note?: string;
  }>;
};

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3303";
const RUN_ID = process.env.J_CHILD_RUN_ID?.trim()
  || "pc-full-acceptance-20260729-114336-J-D-child";
const FIXTURE_PATH = process.env.J_CHILD_FIXTURE_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const STATE_PATH = process.env.J_RECOVERY_J4_STATE_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/j4-coverage-rejection.json";
const EVIDENCE_DIR = process.env.J_RECOVERY_EVIDENCE_DIR?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/emergency-cleanup";

for (const [label, value] of [
  ["J_CHILD_FIXTURE_PATH", FIXTURE_PATH],
  ["J_RECOVERY_J4_STATE_PATH", STATE_PATH],
  ["J_RECOVERY_EVIDENCE_DIR", EVIDENCE_DIR],
] as const) {
  expect(path.resolve(value).toLowerCase(), `${label} must remain under bug-pic/.restricted`)
    .toContain(`${path.sep}.restricted${path.sep}`);
}

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const checker = fixture.checker;
if (!checker?.username || !checker.password || !checker.totpSecret) {
  throw new Error("J child checker fixture must contain username/password/totpSecret");
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("J4 partial failure：checker 从可见 A2 精确驳回本轮 pending operation", async ({ page }) => {
  expect(process.env.J_INDEPENDENT_FINALLY_TOKEN?.trim(),
    "J_INDEPENDENT_FINALLY_TOKEN is required and must remain process-only").toBeTruthy();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as RecoveryState;
  expect(state.runId).toBe(RUN_ID);
  expect(state.stage, "This carrier only owns the pre-execution A2_PENDING state").toBe("A2_PENDING");
  expect(state.operationId, "A2_PENDING state must persist the exact operation ID").toMatch(/^(?:WO|OP)-/);
  expect(state.playbookCode, "A2_PENDING state must persist the exact playbook code").toBeTruthy();

  await loginVisible(page, checker);
  await openA2(page);
  const operationId = state.operationId!;
  const row = page.locator("tbody tr")
    .filter({ hasText: operationId })
    .filter({ hasText: state.playbookCode! })
    .first();
  await expect(row, "The exact J4 pending operation must remain visible to the independent checker").toBeVisible();
  // A2's visible pending-queue action is intentionally the short "取消" label.
  // Keep compatibility with the longer labels used by older renderers, but do
  // not fall back to an API or a hidden route when the control is absent.
  const reject = row.getByRole("button", { name: /^(驳回|取消执行|取消)$/ }).first();
  await expect(reject, "Pending J4 operation must expose a visible reject/cancel control").toBeEnabled();
  await reject.click();

  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} independent emergency cleanup rejects partial J4 proposal`);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${encodeURIComponent(operationId)}/reject`),
  );
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  await expectOk(response, "reject partial J4 A2 operation");

  const overviewResponse = await page.request.get(
    `/api/admin/platform/audit/overview?keyword=${encodeURIComponent(operationId)}`,
  );
  const overview = await dataOf<A2Overview>(overviewResponse, "read A2 after partial cleanup");
  const pending = (overview.operationQueue ?? []).find((item) =>
    item.id === operationId && (item.status ?? "pending") === "pending");
  expect(pending, "The J4 operation must no longer be pending").toBeUndefined();

  const nextState = {
    ...state,
    stage: "A2_REJECTED_CLEANUP",
    pendingTicketResolved: true,
    cleanedAt: new Date().toISOString(),
    cleanedBy: "INDEPENDENT_VISIBLE_A2",
    containsSecrets: false,
  };
  writeFileSync(STATE_PATH, JSON.stringify(nextState, null, 2), "utf8");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(path.join(EVIDENCE_DIR, "j4-partial-a2-cleanup.json"), JSON.stringify({
    runId: RUN_ID,
    operationId,
    playbookCode: state.playbookCode,
    beforeStage: "A2_PENDING",
    afterStage: nextState.stage,
    pendingAfter: false,
    visibleCarrier: true,
    immutableEvidenceDeleted: false,
    tokenPersisted: false,
  }, null, 2), "utf8");
});

async function openA2(page: Page) {
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!await link.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first().click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(page.getByRole("heading", { name: "审计 & 操作确认", exact: true })).toBeVisible();
}

async function expectOk(response: Response, label: string) {
  const raw = await response.text();
  expect(response.status(), `${label}: ${raw}`).toBeLessThan(300);
  const payload = JSON.parse(raw) as Envelope<unknown>;
  expect(payload.code ?? 0, `${label}: ${raw}`).toBe(0);
}

async function dataOf<T>(response: APIResponse, label: string) {
  const raw = await response.text();
  expect(response.status(), `${label}: ${raw}`).toBeLessThan(300);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, `${label}: ${raw}`).toBe(0);
  expect(payload.data, `${label}: ${raw}`).not.toBeUndefined();
  return payload.data!;
}

async function loginVisible(page: Page, account: Account) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    const shell = page.locator("aside");
    await shell.or(otp).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await shell.isVisible().catch(() => false)) {
      return;
    }
    await expect(otp).toBeVisible();
    await waitForFreshTotp(page);
    await otp.fill(currentTotp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as Envelope<unknown> | null;
    const hasAuthCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasAuthCookie)) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
      return;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`J4 partial cleanup MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error("J4 partial cleanup did not reach the authenticated shell");
}

async function waitForFreshTotp(page: Page) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
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
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
