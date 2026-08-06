import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

type Actor = { accountId?: string; username: string; password: string; totpSecret: string };
type Manifest = { runId?: string; account?: Actor; supportSupervisor?: Actor };

const BASE_URL = process.env.M_FINAL10_DIAGNOSTIC_BASE_URL ?? "http://127.0.0.1:3002";
const FIXTURE_PATH = requiredPath("M_FINAL10_DIAGNOSTIC_FIXTURE_PATH");
const EVIDENCE_DIR = requiredPath("M_FINAL10_DIAGNOSTIC_EVIDENCE_DIR");
const manifest = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Manifest;
const actor = manifest.account ?? manifest.supportSupervisor;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(actor).toBeTruthy();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("same-cookie direct API and two fresh visible M1 contexts diagnose support-agent cancellation", async ({ browser }) => {
  const contexts = [];
  for (const label of ["first", "fresh-context"] as const) {
    contexts.push(await diagnose(browser, label));
  }
  writeFileSync(path.join(EVIDENCE_DIR, "support-agents-diagnostic.safe.json"), `${JSON.stringify({
    runId: manifest.runId,
    actorHash: hash16(actor!.username),
    contexts,
  }, null, 2)}\n`);
});

async function diagnose(browser: Browser, label: string) {
  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  await login(page, actor!);

  const directStarted = Date.now();
  const direct = await page.request.get("/api/admin/content/support-agents", { timeout: 60_000 });
  const directElapsedMs = Date.now() - directStarted;
  const directRaw = await direct.text();
  const directJson = JSON.parse(directRaw) as { code?: unknown; data?: { agents?: Array<{ adminId?: number; position?: string; enabled?: boolean; transferable?: boolean }> } };
  const expectedAdminId = Number(actor!.accountId ?? 0);
  const own = directJson.data?.agents?.find((row) => row.adminId === expectedAdminId);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  const requests: Array<Record<string, unknown>> = [];
  const requestIndex = new Map<string, Record<string, unknown>>();
  cdp.on("Network.requestWillBeSent", (event) => {
    if (new URL(event.request.url).pathname !== "/api/admin/content/support-agents") return;
    const row = {
      requestId: event.requestId,
      initiatorType: event.initiator.type,
      resourceType: event.type,
      startedMonotonic: event.timestamp,
    };
    requests.push(row);
    requestIndex.set(event.requestId, row);
  });
  cdp.on("Network.responseReceived", (event) => {
    const row = requestIndex.get(event.requestId);
    if (!row) return;
    row.status = event.response.status;
    row.responseMonotonic = event.timestamp;
  });
  cdp.on("Network.loadingFinished", (event) => {
    const row = requestIndex.get(event.requestId);
    if (!row) return;
    row.finishedMonotonic = event.timestamp;
    row.encodedDataLength = event.encodedDataLength;
  });
  cdp.on("Network.loadingFailed", (event) => {
    const row = requestIndex.get(event.requestId);
    if (!row) return;
    row.failedMonotonic = event.timestamp;
    row.errorText = event.errorText;
    row.canceled = event.canceled ?? false;
    row.blockedReason = event.blockedReason ?? null;
  });

  await openVisibleM1(page);
  await page.waitForTimeout(30_000);
  const adjust = page.getByRole("button", { name: "调整负载", exact: true });
  const result = {
    label,
    direct: {
      status: direct.status(),
      elapsedMs: directElapsedMs,
      codeType: typeof directJson.code,
      code: directJson.code,
      agentsCount: directJson.data?.agents?.length ?? -1,
      ownProfile: own ? {
        position: own.position,
        enabled: own.enabled,
        transferable: own.transferable,
      } : null,
    },
    visibleM1: {
      observedMs: 30_000,
      requests,
      adjustVisible: await adjust.isVisible(),
      adjustEnabled: await adjust.isEnabled(),
      adjustTitle: await adjust.getAttribute("title"),
      partialWarning: await page.getByText(/部分信息暂未同步/).allTextContents(),
    },
  };
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${label}-after-30s.png`), fullPage: true });
  await context.close();
  return result;
}

async function openVisibleM1(page: Page) {
  const link = page.locator('aside a[href="/service/overview"]');
  if (!await link.isVisible().catch(() => false)) {
    await page.locator("aside").getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/service\/overview$/);
  await expect(page.getByRole("heading", { name: "客服总览", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function login(page: Page, account: Actor) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 20_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

let lastTotpStep = -1;
async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 800));
  }
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 4_000) await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function requiredPath(name: string) {
  const value = process.env[name]?.trim();
  if (!value || !/bug-pic[\\/]\.restricted[\\/]/i.test(value)) throw new Error(`${name}_RESTRICTED_PATH_REQUIRED`);
  return path.resolve(value);
}

function hash16(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16).toUpperCase();
}
