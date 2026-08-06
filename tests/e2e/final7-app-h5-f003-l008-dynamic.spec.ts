import { expect, test, type Request, type Route } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

const REQUIRED_ENDPOINTS = [
  "/api/config/v-ranks",
  "/api/team/rank",
  "/api/config/commission/rates",
  "/api/team/binary",
  "/api/app/analytics/events",
] as const;

type RequiredEndpoint = typeof REQUIRED_ENDPOINTS[number];

type Runtime = {
  runId: string;
  h5BaseUrl: string;
  backendProxyOrigin: string;
  evidenceDir: string;
  otpSinkFile: string;
  countryCode: string;
  phone: string;
};

type AnalyticsObservation = {
  clientEventId: string;
  eventName: string;
  route: string;
  dwellMs: number | null;
};

function required(name: string): string {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function loopbackHttps(name: string, expectedPort: number): string {
  const value = new URL(required(name));
  if (value.protocol !== "https:" || !["127.0.0.1", "localhost"].includes(value.hostname)) {
    throw new Error(`${name} must be HTTPS loopback`);
  }
  if (Number(value.port || 443) !== expectedPort || value.pathname !== "/" || value.search || value.hash) {
    throw new Error(`${name} must use the frozen port ${expectedPort} without a path`);
  }
  return value.origin;
}

function assertRestrictedRoot(path: string): string {
  if (!isAbsolute(path)) throw new Error("APP_RESTRICTED_EVIDENCE_DIR must be absolute");
  const root = resolve(path);
  if (!root.replaceAll("/", "\\").toLowerCase().split("\\").includes(".restricted")) {
    throw new Error("APP_RESTRICTED_EVIDENCE_DIR must be beneath .restricted");
  }
  mkdirSync(root, { recursive: true });
  return root;
}

function resolveInsideRestrictedRoot(root: string, candidate: string): string {
  const absolute = resolve(candidate);
  const child = relative(root, absolute);
  if (!child || child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new Error("carrier evidence file must be inside APP_RESTRICTED_EVIDENCE_DIR");
  }
  return absolute;
}

function runtimeConfig(): Runtime {
  const evidenceDir = assertRestrictedRoot(required("APP_RESTRICTED_EVIDENCE_DIR"));
  const otpSinkFile = resolveInsideRestrictedRoot(evidenceDir, required("APP_OTP_SINK_FILE"));
  const countryCode = String(process.env.APP_TEST_COUNTRY_CODE || "+1").trim();
  const phone = required("APP_TEST_PHONE");
  if (!/^\+[0-9]{1,4}$/.test(countryCode) || !/^[0-9]{6,15}$/.test(phone)) {
    throw new Error("test phone identity is invalid");
  }
  return {
    runId: required("APP_RUN_ID"),
    h5BaseUrl: loopbackHttps("APP_H5_BASE_URL", 5176),
    backendProxyOrigin: loopbackHttps("APP_BACKEND_PROXY_ORIGIN", 18116),
    evidenceDir,
    otpSinkFile,
    countryCode,
    phone,
  };
}

function safePath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "invalid-url";
  }
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/bearer\s+[a-z0-9._~-]+/gi, "Bearer [redacted]")
    .replace(/("(?:access|refresh)?token"\s*:\s*")[^"]+/gi, "$1[redacted]")
    .replace(/\b\d{6}\b/g, "[six-digits-redacted]")
    .slice(0, 500);
}

function generatedPassword(): string {
  return `F7x${randomBytes(12).toString("hex")}9Q`;
}

async function readFreshOtp(runtime: Runtime, notBefore: number) {
  await expect.poll(() => {
    if (!existsSync(runtime.otpSinkFile)) return false;
    try {
      const row = JSON.parse(readFileSync(runtime.otpSinkFile, "utf8")) as Record<string, unknown>;
      return row.countryCode === runtime.countryCode
        && row.phone === runtime.phone
        && typeof row.receivedAt === "string"
        && Date.parse(row.receivedAt) >= notBefore - 2_000;
    } catch {
      return false;
    }
  }, { timeout: 20_000 }).toBe(true);
  const row = JSON.parse(readFileSync(runtime.otpSinkFile, "utf8")) as Record<string, unknown>;
  const code = String(row.code || "");
  const challengeNo = String(row.challengeNo || "");
  if (!/^[0-9]{6}$/.test(code) || !/^REG-[a-f0-9]{32}$/i.test(challengeNo)) {
    throw new Error("restricted OTP sink payload is invalid");
  }
  return { code, challengeNo };
}

async function clickTeamTab(page: import("@playwright/test").Page) {
  const tabs = page.locator(".nx-tab");
  await expect(tabs).toHaveCount(5);
  await tabs.nth(3).click();
  await expect(page.locator(".nx-team-rank-link")).toBeVisible();
}

async function clickMeTab(page: import("@playwright/test").Page) {
  const tabs = page.locator(".nx-tab");
  await expect(tabs).toHaveCount(5);
  await tabs.nth(4).click();
  await expect(page.getByText(/sign out/i).last()).toBeVisible();
}

async function visibleLogin(page: import("@playwright/test").Page, runtime: Runtime, password: string) {
  const introSignIn = page.locator(".cta-secondary");
  if (await introSignIn.isVisible().catch(() => false)) await introSignIn.click();
  await expect(page.locator(".lg-phone__in")).toBeVisible();
  await page.locator(".lg-phone__in").fill(runtime.phone);
  await page.locator(".lg-field--flex").fill(password);
  await page.locator(".lg-cta").click();
  await expect(page.locator(".nx-chassis")).toBeVisible({ timeout: 30_000 });
}

function abortFirst(page: import("@playwright/test").Page, path: string, controlled: WeakSet<Request>) {
  let used = false;
  const handler = async (route: Route) => {
    if (!used && safePath(route.request().url()) === path) {
      used = true;
      controlled.add(route.request());
      await route.abort("connectionfailed");
      return;
    }
    await route.continue();
  };
  return {
    install: () => page.route(`**${path}`, handler),
    remove: () => page.unroute(`**${path}`, handler),
    used: () => used,
  };
}

test.use({
  ignoreHTTPSErrors: true,
  viewport: { width: 430, height: 932 },
});

test("Final7 App H5 first-user F1/F3/L6 dynamic closure", async ({ page }) => {
  const runtime = runtimeConfig();
  const password = generatedPassword();
  const endpointCounts = new Map<RequiredEndpoint, number>(REQUIRED_ENDPOINTS.map((path) => [path, 0]));
  const endpointStatuses = new Map<RequiredEndpoint, number[]>();
  const analytics: AnalyticsObservation[] = [];
  const pageErrors: string[] = [];
  const unexpectedConsole: string[] = [];
  const unexpectedRequestFailures: string[] = [];
  const unexpectedHttpFailures: Array<{ path: string; status: number }> = [];
  const controlledAbortRequests = new WeakSet<Request>();
  let userId: number | null = null;

  page.on("pageerror", (error) => pageErrors.push(sanitizeMessage(error.message)));
  page.on("console", (message) => {
    if (message.type() === "error") unexpectedConsole.push(sanitizeMessage(message.text()));
  });
  page.on("requestfailed", (request) => {
    if (!controlledAbortRequests.has(request)) unexpectedRequestFailures.push(safePath(request.url()));
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) {
      expect(url.origin).toBe(runtime.backendProxyOrigin);
    }
    if (REQUIRED_ENDPOINTS.includes(url.pathname as RequiredEndpoint)) {
      const path = url.pathname as RequiredEndpoint;
      endpointCounts.set(path, (endpointCounts.get(path) || 0) + 1);
    }
    if (url.pathname === "/api/app/analytics/events") {
      try {
        const body = request.postDataJSON() as Record<string, unknown>;
        analytics.push({
          clientEventId: String(body.clientEventId || ""),
          eventName: String(body.eventName || ""),
          route: String(body.route || ""),
          dwellMs: Number.isSafeInteger(body.dwellMs) ? Number(body.dwellMs) : null,
        });
      } catch {
        analytics.push({ clientEventId: "invalid", eventName: "invalid", route: "invalid", dwellMs: null });
      }
    }
  });
  page.on("response", async (response) => {
    const path = safePath(response.url());
    if (REQUIRED_ENDPOINTS.includes(path as RequiredEndpoint)) {
      const statuses = endpointStatuses.get(path as RequiredEndpoint) || [];
      statuses.push(response.status());
      endpointStatuses.set(path as RequiredEndpoint, statuses);
    }
    if (response.status() >= 400) unexpectedHttpFailures.push({ path, status: response.status() });
    if (path === "/auth/users/register" && response.status() === 200) {
      try {
        const body = await response.json() as { data?: { user?: { userId?: unknown } } };
        const value = Number(body.data?.user?.userId);
        if (Number.isSafeInteger(value) && value > 0) userId = value;
      } catch {
        // The visible success page remains the primary registration assertion.
      }
    }
  });

  const screenshot = (name: string) => page.screenshot({
    path: resolveInsideRestrictedRoot(runtime.evidenceDir, resolve(runtime.evidenceDir, name)),
    fullPage: true,
  });

  let challengeNo = "";
  const unknownResult = { analyticsRequestAborted: false, visibleNavigationContinued: false };
  const failClosed = { f1: false, f3: false, f1Recovered: false, f3Recovered: false };
  const lifecycle = { refreshRelogin: false, logoutRelogin: false };

  try {
    await page.goto(runtime.h5BaseUrl);
    await expect(page.locator(".cta-primary")).toBeVisible();
    await screenshot("01-visible-intro.png");
    await page.locator(".cta-primary").click();
    await expect(page.locator(".rg-phone__in")).toBeVisible();
    await page.locator(".rg-phone__in").fill(runtime.phone);
    const otpRequestedAt = Date.now();
    await page.locator(".rg-cta").click();
    await expect(page.locator(".rg-otp__in")).toHaveCount(6);

    const otp = await readFreshOtp(runtime, otpRequestedAt);
    challengeNo = otp.challengeNo;
    for (const [index, digit] of [...otp.code].entries()) {
      await page.locator(".rg-otp__in").nth(index).fill(digit);
    }
    await expect(page.locator('input.rg-field[type="password"]')).toHaveCount(2);
    await page.locator('input.rg-field[type="password"]').nth(0).fill(password);
    await page.locator('input.rg-field[type="password"]').nth(1).fill(password);
    await page.locator(".rg-cta").click();

    await expect(page.locator(".rs-title")).toBeVisible({ timeout: 30_000 });
    await screenshot("02-registration-success.png");
    await page.locator(".rs-continue").click();
    await expect(page.locator(".est-go")).toBeVisible();
    await expect(page.locator(".est-go")).toHaveAttribute("aria-disabled", "false", { timeout: 5_000 });
    await page.locator(".est-go").click();
    await page.locator(".cn-go--glow").click();
    await expect(page.locator(".cn-go--on")).toBeVisible({ timeout: 20_000 });
    await page.locator(".cn-go--on").click();
    await expect(page.locator(".nx-chassis")).toBeVisible({ timeout: 20_000 });

    await clickTeamTab(page);
    await expect.poll(() => REQUIRED_ENDPOINTS.slice(0, 4).every((path) => (endpointCounts.get(path) || 0) > 0), {
      timeout: 20_000,
    }).toBe(true);
    await screenshot("03-team-canonical-ready.png");

    await page.locator(".nx-team-rank-link").click();
    await expect(page.getByText(/V-Rank is temporarily unavailable/)).toHaveCount(0);
    await page.locator(".nx-nav-side").first().click();
    await page.locator(".nx-team-binary-link").click();
    await expect(page.getByText(/Balance Match is temporarily unavailable/)).toHaveCount(0);

    const unknownAbort = abortFirst(page, "/api/app/analytics/events", controlledAbortRequests);
    await unknownAbort.install();
    await page.locator(".nx-nav-side").first().click();
    await expect(page.locator(".nx-team-rank-link")).toBeVisible();
    await expect.poll(unknownAbort.used, { timeout: 10_000 }).toBe(true);
    unknownResult.analyticsRequestAborted = true;
    unknownResult.visibleNavigationContinued = true;
    await unknownAbort.remove();

    const idempotency = analytics.some((first, index) => analytics.slice(index + 1).some((second) => (
      first.clientEventId.length === 32
      && first.clientEventId === second.clientEventId
      && first.eventName === "app.page_viewed"
      && second.eventName === "app.page_viewed"
      && first.route === second.route
      && first.dwellMs === 0
      && Number(second.dwellMs) >= 0
    )));
    expect(idempotency).toBe(true);

    await page.reload({ waitUntil: "domcontentloaded" });
    await visibleLogin(page, runtime, password);
    lifecycle.refreshRelogin = true;

    const f1Abort = abortFirst(page, "/api/team/rank", controlledAbortRequests);
    const f3Abort = abortFirst(page, "/api/team/binary", controlledAbortRequests);
    await f1Abort.install();
    await f3Abort.install();
    await clickTeamTab(page);
    await expect.poll(() => f1Abort.used() && f3Abort.used(), { timeout: 15_000 }).toBe(true);
    await page.locator(".nx-team-rank-link").click();
    await expect(page.getByText("V-Rank is temporarily unavailable. Local rank data is not used in remote mode.")).toBeVisible();
    failClosed.f1 = true;
    await f1Abort.remove();
    await page.getByText("Retry", { exact: true }).click();
    await expect(page.getByText(/V-Rank is temporarily unavailable/)).toHaveCount(0, { timeout: 15_000 });
    failClosed.f1Recovered = true;
    await page.locator(".nx-nav-side").first().click();
    await page.locator(".nx-team-binary-link").click();
    await expect(page.getByText("Balance Match is temporarily unavailable. Local track or commission data is not used in remote mode.")).toBeVisible();
    failClosed.f3 = true;
    await f3Abort.remove();
    await page.getByText("Retry", { exact: true }).click();
    await expect(page.getByText(/Balance Match is temporarily unavailable/)).toHaveCount(0, { timeout: 15_000 });
    failClosed.f3Recovered = true;
    await screenshot("04-fail-closed-recovered.png");

    await page.locator(".nx-nav-side").first().click();
    await clickMeTab(page);
    await page.getByText(/sign out/i).last().click();
    await expect(page.locator(".nx-modal")).toBeVisible();
    await page.locator(".nx-btn--danger").click();
    await visibleLogin(page, runtime, password);
    lifecycle.logoutRelogin = true;
    await screenshot("05-visible-relogin.png");

    await expect.poll(() => (endpointCounts.get("/api/app/analytics/events") || 0) > 0, { timeout: 10_000 }).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(unexpectedConsole).toEqual([]);
    expect(unexpectedRequestFailures).toEqual([]);
    expect(unexpectedHttpFailures).toEqual([]);

    const result = {
      runId: runtime.runId,
      status: "PASS",
      candidate: {
        h5Origin: runtime.h5BaseUrl,
        backendProxyOrigin: runtime.backendProxyOrigin,
      },
      endpoints: Object.fromEntries(REQUIRED_ENDPOINTS.map((path) => [path, {
        requests: endpointCounts.get(path) || 0,
        statuses: endpointStatuses.get(path) || [],
      }])),
      idempotency: { l6PageViewIdentityReusedForDwellBackfill: idempotency },
      unknownResult,
      failClosed,
      lifecycle,
      diagnostics: {
        pageErrors: pageErrors.length,
        unexpectedConsoleErrors: unexpectedConsole.length,
        unexpectedRequestFailures: unexpectedRequestFailures.length,
        unexpectedHttpFailures: unexpectedHttpFailures.length,
      },
    };
    writeFileSync(resolveInsideRestrictedRoot(runtime.evidenceDir, resolve(runtime.evidenceDir, "safe-result.json")), `${JSON.stringify(result, null, 2)}\n`, "utf8");

    const cleanupManifest = {
      runId: runtime.runId,
      identity: { countryCode: runtime.countryCode, phone: runtime.phone, userId, challengeNo },
      mutableTargets: [
        "nx_user_session rows for the exact userId",
        "nx_user_wallet and nx_user_security rows for the exact userId",
        "mutable App/team/analytics rows for the exact userId",
        "nx_user_registration_otp row for the exact challengeNo + countryCode + phone",
        "nx_user row for the exact userId + countryCode + phone",
      ],
      preserve: ["immutable audit facts", "immutable outbox facts"],
      requiredSentinel: "all listed mutable rows are zero after cleanup; immutable audit/outbox boundaries remain queryable",
    };
    writeFileSync(resolveInsideRestrictedRoot(runtime.evidenceDir, resolve(runtime.evidenceDir, "cleanup-manifest-private.json")), `${JSON.stringify(cleanupManifest, null, 2)}\n`, "utf8");
  } finally {
    rmSync(runtime.otpSinkFile, { force: true });
  }
});
