import { createHash, createHmac } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixturePath = process.env.B_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("B_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
  accounts: Record<string, { username: string; password: string; totpSecret: string }>;
};
const evidencePath = process.env.B_SESSION_EVIDENCE_PATH;
const screenshotPath = process.env.B_SESSION_SCREENSHOT_PATH;

test("B cache is partitioned when maker switches to same-boolean readonly session", async ({ page }) => {
  await login(page, fixture.accounts.maker);
  await openB1(page);
  await expect(page.getByText("双账本对照")).toBeVisible();
  const maker = await session(page);
  // authEpoch starts at 0 in a fresh browser context and changes on sign-in,
  // sign-out, then the next identity sign-in: maker=1, readonly=3.
  const makerFingerprint = sessionFingerprint(maker, 1);
  await logout(page);

  let intercepted = 0;
  let firstRequestNetwork: { method: string; url: string } | undefined;
  let releaseFirst: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => { releaseFirst = resolve; });
  let requestStarted: (() => void) | undefined;
  const requestStartedPromise = new Promise<void>((resolve) => { requestStarted = resolve; });
  await page.route("**/api/admin/treasury/b-domain*", async (route) => {
    intercepted += 1;
    if (intercepted === 1) {
      firstRequestNetwork = { method: route.request().method(), url: route.request().url() };
      requestStarted?.();
    }
    // Shell and routed-page chunks can each issue the same authorized read.
    // Hold all of them: allowing request #2 would render fresh readonly data
    // and falsely look like a cross-session cache leak.
    await firstRequest;
    await route.continue();
  });

  await login(page, fixture.accounts.readonly);
  await openB1(page);
  await requestStartedPromise;
  const preRelease = {
    // B1 owns its loading state; shell notification text is optional and can
    // mount later. The page-level state is the authoritative user-visible cue.
    syncing: await page.getByText(/B1 双账本(?:加载|同步)中/, { exact: false }).count() > 0,
    ledgerVisible: await page.getByText("双账本对照").count() > 0,
    coverageVisible: await page.getByText(/兑付覆盖率\s*0\.0%/).count() > 0,
  };
  const readonlyBeforeRelease = await session(page);
  const readonlyFingerprint = sessionFingerprint(readonlyBeforeRelease, 3);
  if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
  const preResult = {
    maker: makerFingerprint,
    readonly: readonlyFingerprint,
    sessionKeyChanged: makerFingerprint.sessionKeySha256 !== readonlyFingerprint.sessionKeySha256,
    intercepted,
    firstRequestNetwork,
    visibleStateBeforeRelease: { hasData: preRelease.ledgerVisible, loading: preRelease.syncing, coverageVisible: preRelease.coverageVisible },
  };
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(preResult, null, 2));
  try {
    expect(preRelease.syncing).toBe(true);
    expect(preRelease.ledgerVisible).toBe(false);
    expect(preRelease.coverageVisible).toBe(false);
  } finally {
    releaseFirst?.();
  }
  await expect(page.getByText("双账本对照")).toBeVisible();
  const readonly = await session(page);
  const readonlyFinalFingerprint = sessionFingerprint(readonly, 3);
  const result = {
    maker: makerFingerprint,
    readonly: readonlyFinalFingerprint,
    identityChanged: makerFingerprint.adminId !== readonlyFinalFingerprint.adminId,
    sessionKeyChanged: makerFingerprint.sessionKeySha256 !== readonlyFinalFingerprint.sessionKeySha256,
    intercepted,
    firstRequestNetwork,
    visibleStateBeforeRelease: { hasData: preRelease.ledgerVisible, loading: preRelease.syncing, coverageVisible: preRelease.coverageVisible },
    visibleStateAfterRelease: { hasData: true, loading: false },
  };
  expect(result.identityChanged).toBe(true);
  expect(intercepted).toBeGreaterThanOrEqual(1);
  if (evidencePath) writeFileSync(evidencePath, JSON.stringify(result, null, 2));
});

async function openB1(page: Page) {
  const group = page.getByRole("button", { name: /总览驾驶舱/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await page.locator('aside a[href="/overview/dual-ledger"]').click();
  await expect(page.getByRole("heading", { name: "双账本总览" })).toBeVisible();
}

async function login(page: Page, account: { username: string; password: string; totpSecret: string }) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/admin/auth/login"
    && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  if (!(await shell.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 15_000 });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await otp.fill(await freshTotp(account.totpSecret));
      const verification = page.waitForResponse((response) =>
        new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"
        && response.request().method() === "POST");
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      if ((await verification).status() === 200) break;
      if (attempt === 1) throw new Error("B fixture MFA verification failed");
    }
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function session(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/admin/auth/session");
    const payload = await response.json() as { data?: { session?: Record<string, unknown> } };
    return payload.data?.session ?? {};
  });
}

function sessionFingerprint(session: Record<string, unknown>, authEpoch: number) {
  const adminId = String(session.adminId ?? session.id ?? "");
  const username = typeof session.username === "string" ? session.username : "";
  const authorities = Array.isArray(session.authorities) ? session.authorities.map(String).sort() : [];
  const menus = Array.isArray(session.effectiveMenus)
    ? session.effectiveMenus.map(String).map((menu) => menu.trim().toUpperCase()).filter(Boolean).sort()
    : Array.isArray(session.menuCodes)
      ? session.menuCodes.map(String).map((menu) => menu.trim().toUpperCase()).filter(Boolean).sort()
    : [];
  const rawKey = `${authEpoch}|${adminId}|${authorities.join(",")}|${menus.join(",")}`;
  return {
    adminId,
    username,
    authEpoch,
    authorityCount: authorities.length,
    menuCount: menus.length,
    sessionKeySha256: createHash("sha256").update(rawKey).digest("hex"),
  };
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  const currentStep = Math.floor(Date.now() / 30_000);
  const lastStep = lastTotpStep.get(secret) ?? -1;
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  if (currentStep <= lastStep || millisecondsRemaining <= 5_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), {
      timeout: 35_000,
      intervals: [250],
    }).toBeGreaterThan(currentStep <= lastStep ? lastStep : currentStep);
  }
  const step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(secret, step);
  return totp(secret);
}

function totp(secret: string) {
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
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}
