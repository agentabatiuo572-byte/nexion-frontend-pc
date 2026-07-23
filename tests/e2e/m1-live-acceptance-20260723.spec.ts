import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ADMIN_USER = process.env.M1_ADMIN_USERNAME ?? "d5_V3_r_super";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const EVIDENCE_DIR = process.env.M1_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/m-domain-acceptance-20260723/restricted/m1/initial-red";
const PREFIX = process.env.M1_FIXTURE_PREFIX ?? "M1-20260723";
const LOAD_API = "**/api/admin/content/tickets/load-config";
const MFA_SECRETS = new Map<string, string>();

type Envelope<T> = { code: number; message?: string; data: T };
type LoadView = {
  loadConfig: {
    autoBalance: boolean;
    defaultCap: number;
    burstCap: number;
    warnPct: number;
    quietHourBalance: boolean;
    overflowQueue: string;
  };
  agentState: Record<string, { cap: number; busy: boolean }>;
};

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error("ADMIN_E2E_PASSWORD is required for M1 live acceptance");
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("M1 结果未知保留表单并以同一幂等键安全重试", async ({ page }) => {
  await loginAndOpenM1(page);
  await expect(page.getByText("SLA 监控", { exact: true })).toBeVisible();
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-entry-m1-overview.png"), fullPage: true });

  const queueLinks = [
    "/service/tickets?scope=active",
    "/service/tickets?scope=active&status=pending_user",
    "/service/sessions?seg=active",
    "/service/sessions?seg=unread",
  ];
  for (const href of queueLinks) {
    const card = page.locator(`a[href="${href}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator(".tnum")).toHaveText(/^\d+$/);
    await card.click();
    const target = new URL(href, BASE_URL);
    await expect(page).toHaveURL((url) => url.pathname === target.pathname && url.search === target.search);
    await openVisibleM1Link(page);
  }

  const baseline = await envelope<LoadView>(await page.request.get("/api/admin/content/tickets/load-config"));
  const original = baseline.data.loadConfig;
  const nextDefaultCap = original.defaultCap >= 40 ? original.defaultCap - 1 : original.defaultCap + 1;
  const reason = `${PREFIX}-结果未知同键重试验证`;
  const keys: string[] = [];
  let attempts = 0;

  await page.route(LOAD_API, async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    attempts += 1;
    keys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      const upstreamText = await upstream.text();
      expect(upstream.ok(), `M1 load upstream ${upstream.status()}: ${upstreamText.slice(0, 500)}`).toBeTruthy();
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  });

  try {
    await page.getByRole("button", { name: "调整负载", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "坐席负载调度" });
    await expect(dialog).toBeVisible();
    const capInput = dialog.getByLabel("默认负载上限(人均)");
    await expect(capInput).toHaveValue(String(original.defaultCap));
    await capInput.fill(String(nextDefaultCap));
    await dialog.getByLabel(/变更理由/).fill(reason);
    await dialog.getByRole("button", { name: "保存", exact: true }).click();

    await expect(dialog, "结果未知时必须保留表单，不能先报成功并关闭").toBeVisible();
    await expect(dialog.getByText(/结果未知/)).toBeVisible();
    await expect(capInput).toHaveValue(String(nextDefaultCap));
    await expect(dialog.getByLabel(/变更理由/)).toHaveValue(reason);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-unknown-outcome-form-preserved.png"), fullPage: true });

    const replay = page.waitForResponse((response) => response.request().method() === "PATCH"
      && new URL(response.url()).pathname === "/api/admin/content/tickets/load-config");
    await dialog.getByRole("button", { name: /使用同一命令重试/ }).click();
    const replayResponse = await replay;
    expect(replayResponse.ok(), await replayResponse.text()).toBeTruthy();
    await expect(dialog).toBeHidden();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);

    const updated = await envelope<LoadView>(await page.request.get("/api/admin/content/tickets/load-config"));
    expect(updated.data.loadConfig.defaultCap).toBe(nextDefaultCap);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-same-key-replay-refresh.png"), fullPage: true });
  } finally {
    await page.unroute(LOAD_API).catch(() => undefined);
    const restore = await page.request.patch("/api/admin/content/tickets/load-config", {
      headers: { "Idempotency-Key": `${PREFIX}-cleanup-${Date.now()}` },
      data: {
        ...original,
        agentState: baseline.data.agentState,
        reason: `${PREFIX}-恢复原负载配置`,
      },
    });
    expect(restore.ok(), `M1 cleanup ${restore.status()}: ${await restore.text()}`).toBeTruthy();
  }

  const siblingApi = "**/api/admin/content/session-templates/overview";
  await page.route(siblingApi, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "M1_ACCEPTANCE_SIBLING_UNAVAILABLE" }),
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(/部分信息暂未同步/)).toBeVisible();
  await expect(page.getByText("SLA 监控", { exact: true })).toBeVisible();
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-sibling-failure-isolated.png"), fullPage: true });
  await page.unroute(siblingApi);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();

  const m5Link = page.locator('a[href="/service/scripts"]').first();
  const mGroup = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  if (!await m5Link.isVisible().catch(() => false)) await mGroup.click();
  await expect(m5Link).toBeVisible();
  await m5Link.click();
  await expect(page).toHaveURL(/\/service\/scripts$/);
  await expect(page.getByText("客服岗位与专属客服", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-cross-m5-seat-source.png"), fullPage: true });

  await logoutCurrent(page);
  await loginAndOpenM1(page);
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-relogin-readback.png"), fullPage: true });
  await logoutCurrent(page);
});

async function envelope<T>(response: APIResponse): Promise<Envelope<T>> {
  const text = await response.text();
  expect(response.ok(), `${response.status()} ${response.url()} ${text.slice(0, 500)}`).toBeTruthy();
  const payload = JSON.parse(text) as Envelope<T>;
  expect(payload.code).toBe(0);
  return payload;
}

async function loginAndOpenM1(page: Page) {
  await login(page, ADMIN_USER);
  await openVisibleM1Link(page);
}

async function openVisibleM1Link(page: Page) {
  const link = page.locator('a[href="/service/overview"]').first();
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  if (!await link.isVisible().catch(() => false) && await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  await expect(link, "M1 必须可从当前角色的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/service\/overview(?:\?.*)?$/);
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, username: string) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1_200);
  if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
  const userInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(userInput).toBeVisible({ timeout: 8_000 });
  await userInput.fill(username);
  await passwordInput.fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const mfaHeading = page.getByRole("heading", { name: "双因素身份验证" });
  await Promise.race([
    page.locator("aside").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    mfaHeading.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await page.locator("aside").isVisible().catch(() => false)) return;
  await expect(mfaHeading).toBeVisible();
  const secretCode = page.locator("code");
  const displayedSecret = await secretCode.count() > 0 ? (await secretCode.first().textContent())?.trim() : undefined;
  if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
  const secret = displayedSecret || MFA_SECRETS.get(username);
  if (!secret) throw new Error(`MFA secret unavailable for ${username}`);
  const remainingMs = 30_000 - (Date.now() % 30_000);
  await page.waitForTimeout(remainingMs + 750);
  await page.getByLabel("一次性验证码").fill(totp(secret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logoutCurrent(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

function totp(secret: string, at = Date.now()) {
  const key = decodeBase32(secret);
  const counter = Math.floor(at / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function decodeBase32(value: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of normalized) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
