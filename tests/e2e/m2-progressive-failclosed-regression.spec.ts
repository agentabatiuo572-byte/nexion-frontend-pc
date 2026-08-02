import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page, type Route } from "@playwright/test";

type Actor = { username: string; password: string; totpSecret: string };

const BASE_URL = process.env.M_PROGRESS_BASE_URL ?? "http://127.0.0.1:3002";
const FIXTURE_PATH = process.env.M_PROGRESS_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.M_PROGRESS_EVIDENCE_DIR;
const fixture = FIXTURE_PATH
  ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      checker?: Actor;
      account?: Actor;
      accounts?: { checker?: Actor; m_checker?: Actor };
    }
  : null;
const ACTOR = fixture?.checker ?? fixture?.account ?? fixture?.accounts?.checker ?? fixture?.accounts?.m_checker;

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(() => {
  const url = new URL(BASE_URL);
  expect(["127.0.0.1", "localhost", "::1"]).toContain(url.hostname);
  expect(ACTOR, "M_PROGRESS_FIXTURE_PATH must provide a normal-MFA M actor").toBeTruthy();
  expect(EVIDENCE_DIR, "M_PROGRESS_EVIDENCE_DIR is required").toMatch(/bug-pic[\\/]\.restricted[\\/]/i);
  mkdirSync(EVIDENCE_DIR!, { recursive: true });
});

test("M2 exposes its own fail-closed state before an unrelated M request settles", async ({ page }) => {
  await login(page, ACTOR!);
  await openVisibleM2(page);

  for (const status of [401, 403, 500]) {
    await faultWhileSiblingIsSlow(page, {
      label: `status-${status}`,
      fulfill: (route) => route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify({ code: status, message: `M2_${status}` }),
      }),
    });
  }

  await faultWhileSiblingIsSlow(page, {
    label: "malformed-200",
    fulfill: (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, data: { malformed: true } }),
    }),
  });
});

test("M2 timeout and slow detail stay non-writable and cannot reveal the prior snapshot", async ({ page }) => {
  await login(page, ACTOR!);
  await openVisibleM2(page);

  await heldRequestFailsClosed(page, {
    pattern: "**/api/admin/content/tickets?*",
    matches: (route) => new URL(route.request().url()).pathname === "/api/admin/content/tickets",
    label: "root-timeout",
  });

  await heldRequestFailsClosed(page, {
    pattern: "**/api/admin/content/tickets/*",
    matches: (route) => /^\/api\/admin\/content\/tickets\/[^/]+$/.test(new URL(route.request().url()).pathname),
    label: "slow-detail",
  });
});

async function faultWhileSiblingIsSlow(
  page: Page,
  input: { label: string; fulfill: (route: Route) => Promise<unknown> },
) {
  let releaseSibling!: () => void;
  const heldSibling = new Promise<void>((resolve) => { releaseSibling = resolve; });
  let siblingSeen!: () => void;
  const sawSibling = new Promise<void>((resolve) => { siblingSeen = resolve; });
  let ticketSeen!: () => void;
  const sawTicket = new Promise<void>((resolve) => { ticketSeen = resolve; });
  const siblingHandler = async (route: Route) => {
    siblingSeen();
    await heldSibling;
    await route.continue();
  };
  const ticketHandler = async (route: Route) => {
    if (new URL(route.request().url()).pathname !== "/api/admin/content/tickets") {
      await route.continue();
      return;
    }
    ticketSeen();
    await input.fulfill(route);
  };
  await page.route("**/api/admin/content/session-templates/overview", siblingHandler);
  await page.route("**/api/admin/content/tickets?*", ticketHandler);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await Promise.all([sawSibling, sawTicket]);
    await assertM2FailedClosed(page, 3_000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR!, `${input.label}.png`), fullPage: true });
  } finally {
    releaseSibling();
    await page.unroute("**/api/admin/content/tickets?*", ticketHandler);
    await page.unroute("**/api/admin/content/session-templates/overview", siblingHandler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "工单台", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function heldRequestFailsClosed(
  page: Page,
  input: { pattern: string; matches: (route: Route) => boolean; label: string },
) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  let intercepted!: () => void;
  const seen = new Promise<void>((resolve) => { intercepted = resolve; });
  const handler = async (route: Route) => {
    if (!input.matches(route)) {
      await route.continue();
      return;
    }
    intercepted();
    await held;
    await route.abort("timedout").catch(() => undefined);
  };
  await page.route(input.pattern, handler);
  try {
    await page.reload({ waitUntil: "domcontentloaded" });
    await seen;
    await assertM2FailedClosed(page, 12_000);
    await page.screenshot({ path: path.join(EVIDENCE_DIR!, `${input.label}.png`), fullPage: true });
  } finally {
    release();
    await page.unroute(input.pattern, handler);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "工单台", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function assertM2FailedClosed(page: Page, timeout: number) {
  await expect(page.getByText(/工单数据暂时无法同步/)).toBeVisible({ timeout });
  await expect(page.locator('[data-proof="support-ticket-create"]')).toHaveCount(0);
  await expect(page.locator('[data-proof="support-ticket-reply-save"]')).toHaveCount(0);
}

async function openVisibleM2(page: Page) {
  const link = page.locator('aside a[href="/service/tickets"]');
  if (!await link.isVisible().catch(() => false)) {
    await page.locator("aside").getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/service\/tickets$/);
  await expect(page.getByRole("heading", { name: "工单台", exact: true })).toBeVisible({ timeout: 30_000 });
}

async function login(page: Page, actor: Actor) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(actor.username);
  await page.locator('input[autocomplete="current-password"]').fill(actor.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 3_000) await page.waitForTimeout(remaining + 500);
  await otp.fill(totp(actor.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) => Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
