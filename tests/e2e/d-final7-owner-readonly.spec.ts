import { expect, test } from "@playwright/test";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const evidenceDir = process.env.D_FINAL7_EVIDENCE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/final11-owner/carrier-repair";
const restrictedEvidenceRoot = path.resolve("D:/workspace/bug-pic/.restricted");
const fixturePath = process.env.D_FINAL7_FIXTURE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/D.json";

type FixtureAccount = { username: string; password: string; totpSecret?: string };
type DFixture = { accounts: Record<string, FixtureAccount> };
type AuthStage = { stage: "credential" | "mfa"; status: number };

const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as DFixture;
const ownerReadonly = fixture.accounts.readonly ?? fixture.accounts.d_readonly;
if (!ownerReadonly?.username || !ownerReadonly.password) {
  throw new Error("D_FINAL11_READONLY_FIXTURE_CREDENTIAL_REQUIRED");
}

const TOTP_STEP_MS = 30_000;
const TOTP_BOUNDARY_BUFFER_MS = 3_000;
const TOTP_FRESH_TIMEOUT_MS = 35_000;
const MFA_CHALLENGE_TIMEOUT_MS = 15_000;
const MFA_RESPONSE_TIMEOUT_MS = 20_000;
const MAX_MFA_REPLAY_RETRIES = 2;
const usedTotpSteps = new Map<string, number>();

const modules = [
  { id: "D1", route: "/finance/recon", title: "银行转账（VietQR）对账", api: "/api/admin/finance/vietqr/overview?view=inflight&pageNum=1&pageSize=20" },
  { id: "D2", route: "/finance/withdrawals", title: "提现审核队列", api: "/api/admin/finance/withdrawals?pageNum=1&pageSize=10" },
  { id: "D3", route: "/finance/pool", title: "应付负债 · 9 类科目", api: "/api/admin/treasury/reserve" },
  { id: "D4", route: "/finance/ledger", title: "全平台账单流水", api: "/api/admin/bills?pageNum=1&pageSize=10" },
  { id: "D5", route: "/finance/params", title: "D5 自有四组参数", api: "/api/admin/withdraw/limits" },
  { id: "D6", route: "/finance/fx-rate", title: "当前牌价（现场派生）", api: "/api/admin/finance/fx-quote" },
] as const;

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.use({ trace: "off", video: "off", screenshot: "off" });
test.beforeAll(() => {
  assertRestrictedRunPath(evidenceDir, "D evidence");
  mkdirSync(evidenceDir, { recursive: true });
});
test.beforeEach(async ({}, testInfo) => {
  assertRestrictedRunPath(testInfo.outputDir, "D Playwright output");
});
test.afterEach(async ({}, testInfo) => {
  assertNoSensitiveJsonOrLogs(evidenceDir, ownerReadonly);
  assertNoSensitiveJsonOrLogs(testInfo.outputDir, ownerReadonly);
});

test("Final7 D1-D6: 首次用户从登录页经可见侧栏访问、刷新并退出重登", async ({ page }) => {
  const errors: string[] = [];
  const network = observeNetworkFailures(page);
  const authStages: AuthStage[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  authStages.push(...await visibleLogin(page));

  const visited: Array<{ id: string; status: number }> = [];
  const group = page.getByRole("button", { name: /资金与财务\s+D|D\s+资金与财务/ }).first();
  await expect(group).toBeVisible();
  await group.click();
  for (const item of modules) {
    const link = page.locator(`aside a[href="${item.route}"]`).first();
    await expect(link, `${item.id} visible sidebar entry`).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${item.route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
    await expect(page.getByText(item.title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    const response = await page.request.get(item.api);
    expect(response.status(), `${item.id} canonical read`).toBe(200);
    visited.push({ id: item.id, status: response.status() });
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "01-visible-sidebar-refresh.png"), fullPage: true });
  const logoutDiagnostic = await observeLogoutRequest(page);
  try {
    await visibleLogout(page);
  } finally {
    await logoutDiagnostic.write(path.join(evidenceDir, "04-logout-network-diagnostic.json"));
  }
  authStages.push(...await visibleLogin(page));
  await expect(page.getByRole("button", { name: /资金与财务\s+D|D\s+资金与财务/ }).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "02-relogin-shell.png"), fullPage: true });
  expect(authStages.filter((entry) => entry.stage === "mfa" && entry.status === 200)).toHaveLength(2);
  const failures = network.unexpectedFailures();
  writeFileSync(path.join(evidenceDir, "01-visible-sidebar-refresh.json"), JSON.stringify({ visited, authStages, errors, failures }, null, 2));
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("D carrier records an aborted API read even when its query includes _rsc", async ({ page }) => {
  const network = observeNetworkFailures(page);
  await visibleLogin(page);
  const apiProbe = "/api/admin/finance/fx-quote?_rsc=probe";
  await page.route(apiProbe, async (route) => route.abort("failed"));
  try {
    const outcome = await page.evaluate(async (endpoint) => {
      try {
        await fetch(endpoint);
        return "unexpected-response";
      } catch {
        return "aborted";
      }
    }, apiProbe);
    expect(outcome).toBe("aborted");
    await expect.poll(
      () => network.unexpectedFailures().some((entry) => entry.includes(apiProbe)),
      { timeout: 5_000 },
    ).toBe(true);
    const failures = network.unexpectedFailures();
    expect(
      failures.some((entry) => entry.includes(apiProbe)),
      "D_FINAL11_API_ABORT_MUST_REMAIN_VISIBLE",
    ).toBe(true);
    writeFileSync(path.join(evidenceDir, "03-api-rsc-abort-probe.json"), JSON.stringify({ apiProbe, outcome, failures }, null, 2));
  } finally {
    await page.unroute(apiProbe);
    await visibleLogout(page);
  }
});

test("D carrier keeps a same-path _rsc abort visible when its only 200 is historical", async ({ page }) => {
  const network = observeNetworkFailures(page);
  await visibleLogin(page);
  const historicalPath = "/finance/fx-rate?_rsc=historical";
  const historicalStatus = await page.evaluate(async (endpoint) => (await fetch(endpoint)).status, historicalPath);
  expect(historicalStatus).toBe(200);

  const abortedPath = "/finance/fx-rate?_rsc=probe-after-history";
  await page.route(abortedPath, async (route) => route.abort("aborted"));
  try {
    const outcome = await page.evaluate(async (endpoint) => {
      try {
        await fetch(endpoint);
        return "unexpected-response";
      } catch {
        return "aborted";
      }
    }, abortedPath);
    expect(outcome).toBe("aborted");
    await expect.poll(
      () => network.unexpectedFailures().some((entry) => entry.includes(abortedPath)),
      { timeout: 5_000 },
    ).toBe(true);
    const failures = network.unexpectedFailures();
    expect(
      failures.some((entry) => entry.includes(abortedPath)),
      "D_FINAL11_HISTORICAL_200_MUST_NOT_HIDE_ABORT",
    ).toBe(true);
    writeFileSync(path.join(evidenceDir, "05-historical-200-abort-probe.json"), JSON.stringify({
      historicalStatus,
      outcome,
      failures,
    }, null, 2));
  } finally {
    await page.unroute(abortedPath);
  }
});

test("D Final11 restricted readonly reaches D1-D6 before the shared logout HOLD", async ({ page }) => {
  const errors: string[] = [];
  const network = observeNetworkFailures(page);
  page.on("pageerror", (error) => errors.push(error.message));
  const authStages = await visibleLogin(page);
  const visited: Array<{ id: string; status: number }> = [];
  const group = page.getByRole("button", { name: /资金与财务\s+D|D\s+资金与财务/ }).first();
  await expect(group).toBeVisible();
  await group.click();
  for (const item of modules) {
    const link = page.locator(`aside a[href="${item.route}"]`).first();
    await expect(link, `${item.id} visible sidebar entry`).toBeVisible();
    await link.click();
    await expect(page.getByText(item.title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    const response = await page.request.get(item.api);
    expect(response.status(), `${item.id} canonical read`).toBe(200);
    visited.push({ id: item.id, status: response.status() });
  }
  const failures = network.unexpectedFailures();
  writeFileSync(path.join(evidenceDir, "06-readonly-before-shared-logout-hold.json"), JSON.stringify({
    visited,
    authStages,
    errors,
    failures,
    sharedLogout: "HOLD_OUTSIDE_THIS_READONLY_CASE",
  }, null, 2));
  expect(errors).toEqual([]);
  expect(failures).toEqual([]);
});

test("D carrier keeps an abort visible when its replacement started before failure", async ({ page }) => {
  const network = observeNetworkFailures(page);
  await visibleLogin(page);
  const abortedPath = "/finance/fx-rate?_rsc=abort-before-early-replacement";
  const replacementPath = "/finance/fx-rate?_rsc=early-replacement";
  let markReplacementStarted!: () => void;
  let markAbortCompleted!: () => void;
  const replacementStarted = new Promise<void>((resolve) => { markReplacementStarted = resolve; });
  const abortCompleted = new Promise<void>((resolve) => { markAbortCompleted = resolve; });
  await page.route(/\/finance\/fx-rate\?_rsc=(?:abort-before-early-replacement|early-replacement)$/, async (route) => {
    if (route.request().url().includes("abort-before-early-replacement")) {
      await replacementStarted;
      await route.abort("aborted");
      markAbortCompleted();
      return;
    }
    markReplacementStarted();
    await abortCompleted;
    await new Promise((resolve) => setTimeout(resolve, 100));
    await route.fulfill({ status: 200, contentType: "text/plain", body: "replacement" });
  });
  try {
    const outcome = await page.evaluate(async ({ aborted, replacement }) => {
      const abortedFetch = fetch(aborted).then(() => "unexpected-response").catch(() => "aborted");
      await new Promise((resolve) => setTimeout(resolve, 25));
      const replacementStatus = fetch(replacement).then((response) => response.status);
      return { aborted: await abortedFetch, replacementStatus: await replacementStatus };
    }, { aborted: abortedPath, replacement: replacementPath });
    expect(outcome).toEqual({ aborted: "aborted", replacementStatus: 200 });
    await expect.poll(
      () => network.unexpectedFailures().some((entry) => entry.includes(abortedPath)),
      { timeout: 5_000 },
    ).toBe(true);
    const failures = network.unexpectedFailures();
    expect(
      failures.some((entry) => entry.includes(abortedPath)),
      "D_FINAL11_EARLY_REPLACEMENT_MUST_NOT_HIDE_ABORT",
    ).toBe(true);
    writeFileSync(path.join(evidenceDir, "07-early-replacement-abort-probe.json"), JSON.stringify({
      outcome,
      failures,
    }, null, 2));
  } finally {
    await page.unroute(/\/finance\/fx-rate\?_rsc=(?:abort-before-early-replacement|early-replacement)$/);
  }
});

async function visibleLogin(page: import("@playwright/test").Page, account: FixtureAccount = ownerReadonly) {
  const authStages: AuthStage[] = [];
  for (let attempt = 0; attempt <= MAX_MFA_REPLAY_RETRIES; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 1_000 }).catch(() => false)) return authStages;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const credential = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/login")
      && response.request().method() === "POST",
      { timeout: MFA_RESPONSE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const credentialResponse = await credential;
    authStages.push({ stage: "credential", status: credentialResponse.status() });
    expect(credentialResponse.status(), "credential").toBe(200);

    const otp = page.getByLabel("一次性验证码");
    const mfaRequired = await otp.waitFor({ state: "visible", timeout: MFA_CHALLENGE_TIMEOUT_MS })
      .then(() => true)
      .catch(() => false);
    if (!mfaRequired) {
      if (account.totpSecret?.trim()) throw new Error("D_FINAL11_MFA_CHALLENGE_TIMEOUT");
      await expect(page.locator("aside")).toBeVisible({ timeout: MFA_RESPONSE_TIMEOUT_MS });
      return authStages;
    }
    if (!account.totpSecret?.trim()) {
      throw new Error("D_FINAL11_MFA_SECRET_REQUIRED: MFA_REQUIRED_WITHOUT_TOTP_SECRET");
    }

    const code = await freshTotp(account.username, account.totpSecret);
    await otp.fill(code);
    const verification = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/mfa/verify")
      && response.request().method() === "POST",
      { timeout: MFA_RESPONSE_TIMEOUT_MS },
    );
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { code?: unknown; message?: unknown } | null;
    const mfaReason = `${payload?.code ?? ""} ${payload?.message ?? ""}`;
    authStages.push({ stage: "mfa", status: response.status() });
    if (response.status() === 401 && /MFA_CODE_REPLAYED/i.test(mfaReason) && attempt < MAX_MFA_REPLAY_RETRIES) continue;
    expect(response.status(), "MFA verify").toBe(200);
    await expect(page.locator("aside")).toBeVisible({ timeout: MFA_RESPONSE_TIMEOUT_MS });
    return authStages;
  }
  throw new Error("D_FINAL11_MFA_REPLAY_RETRIES_EXHAUSTED");
}

async function freshTotp(accountKey: string, secret: string) {
  const deadline = Date.now() + TOTP_FRESH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const now = Date.now();
    const step = Math.floor(now / TOTP_STEP_MS);
    const remaining = TOTP_STEP_MS - (now % TOTP_STEP_MS);
    const previous = usedTotpSteps.get(accountKey) ?? -1;
    if (step > previous && remaining > TOTP_BOUNDARY_BUFFER_MS) {
      usedTotpSteps.set(accountKey, step);
      return currentTotp(secret, step);
    }
    const untilNextStep = TOTP_STEP_MS - (now % TOTP_STEP_MS) + 250;
    const remainingBudget = deadline - now;
    await new Promise((resolve) => setTimeout(resolve, Math.min(untilNextStep, remainingBudget)));
  }
  throw new Error("D_FINAL11_TOTP_FRESH_TIMEOUT");
}

function currentTotp(secret: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("D_FINAL11_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

type RequestStartSignal = {
  sequence: number;
  observedAtMs: number;
  frame: import("@playwright/test").Frame | null;
};
type FailedRequestSignal = {
  request: import("@playwright/test").Request;
  startedSequence: number;
  startedAtMs: number;
  failedSequence: number;
  failedAtMs: number;
  frame: import("@playwright/test").Frame | null;
};
type ResponseSignal = {
  request: import("@playwright/test").Request;
  method: string;
  url: string;
  status: number;
  resourceType: string;
  startedSequence: number;
  receivedSequence: number;
  receivedAtMs: number;
  frame: import("@playwright/test").Frame | null;
};

function observeNetworkFailures(page: import("@playwright/test").Page) {
  let sequence = 0;
  const requestStarts = new WeakMap<import("@playwright/test").Request, RequestStartSignal>();
  const failedRequests: FailedRequestSignal[] = [];
  const responses: ResponseSignal[] = [];
  page.on("request", (request) => requestStarts.set(request, {
    sequence: ++sequence,
    observedAtMs: Date.now(),
    frame: request.frame(),
  }));
  page.on("requestfailed", (request) => {
    const start = requestStarts.get(request) ?? {
      sequence: ++sequence,
      observedAtMs: Date.now(),
      frame: request.frame(),
    };
    failedRequests.push({
      request,
      startedSequence: start.sequence,
      startedAtMs: start.observedAtMs,
      failedSequence: ++sequence,
      failedAtMs: Date.now(),
      frame: start.frame,
    });
  });
  page.on("response", (response) => {
    const request = response.request();
    const start = requestStarts.get(request) ?? {
      sequence: ++sequence,
      observedAtMs: Date.now(),
      frame: request.frame(),
    };
    responses.push({
      request,
      method: request.method(),
      url: response.url(),
      status: response.status(),
      resourceType: request.resourceType(),
      startedSequence: start.sequence,
      receivedSequence: ++sequence,
      receivedAtMs: Date.now(),
      frame: start.frame,
    });
  });
  return {
    unexpectedFailures: () => failedRequests
      .filter((failure) => !isExpectedNavigationAbort(failure, responses))
      .map(({ request }) => `${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`),
  };
}

function isExpectedNavigationAbort(
  failure: FailedRequestSignal,
  responses: readonly ResponseSignal[],
) {
  const request = failure.request;
  if (request.failure()?.errorText !== "net::ERR_ABORTED") return false;
  if (request.method() !== "GET") return false;
  const url = new URL(request.url());
  if (url.pathname.startsWith("/api/")) return false;
  if (!url.searchParams.has("_rsc") && request.resourceType() !== "document") return false;
  const requestPath = navigationPath(request.url());
  const replacementWindowMs = 5_000;
  const successfulReplacement = responses.some((response) => (
    response.request !== request
    && response.method === "GET"
    && response.status === 200
    && (new URL(response.url).searchParams.has("_rsc") || response.resourceType === "document")
    && navigationPath(response.url) === requestPath
    && response.frame === failure.frame
        && response.startedSequence > failure.failedSequence
    && response.receivedSequence > failure.failedSequence
    && response.receivedAtMs >= failure.failedAtMs
    && response.receivedAtMs - failure.failedAtMs <= replacementWindowMs
  ));
  return successfulReplacement;
}

function navigationPath(rawUrl: string) {
  const url = new URL(rawUrl);
  return `${url.origin}${url.pathname}`;
}

async function visibleLogout(page: import("@playwright/test").Page) {
  const logoutResponse = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/admin/auth/logout"
    && response.request().method() === "POST"
  ), { timeout: MFA_RESPONSE_TIMEOUT_MS });
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 1_500 }).catch(() => false)) await direct.click();
  else {
    const menu = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await menu.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  const response = await logoutResponse;
  expect(response.status(), "logout").toBe(200);
  await within(response.text(), MFA_RESPONSE_TIMEOUT_MS, "D_FINAL11_LOGOUT_BODY_TIMEOUT");
  const session = await page.request.get("/api/admin/auth/session");
  expect(session.status(), "logout must invalidate the browser session").toBe(401);
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

type LogoutNetworkDiagnostic = {
  requestId: string;
  method: string;
  resourceType: string;
  initiatorType: string;
  responseStatus?: number;
  loadingFinished?: boolean;
  loadingFailed?: string;
  timing?: { requestTime: number; receiveHeadersEnd: number };
};

async function observeLogoutRequest(page: import("@playwright/test").Page) {
  const client = await page.context().newCDPSession(page);
  const requests = new Map<string, LogoutNetworkDiagnostic>();
  await client.send("Network.enable");
  client.on("Network.requestWillBeSent", (event) => {
    if (new URL(event.request.url).pathname !== "/api/admin/auth/logout") return;
    requests.set(event.requestId, {
      requestId: event.requestId,
      method: event.request.method,
      resourceType: event.type ?? "Other",
      initiatorType: event.initiator.type ?? "other",
    });
  });
  client.on("Network.responseReceived", (event) => {
    const request = requests.get(event.requestId);
    if (!request) return;
    request.responseStatus = event.response.status;
    if (event.response.timing) {
      request.timing = {
        requestTime: event.response.timing.requestTime,
        receiveHeadersEnd: event.response.timing.receiveHeadersEnd,
      };
    }
  });
  client.on("Network.loadingFinished", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.loadingFinished = true;
  });
  client.on("Network.loadingFailed", (event) => {
    const request = requests.get(event.requestId);
    if (request) request.loadingFailed = event.errorText;
  });
  return {
    write: async (target: string) => {
      writeFileSync(target, JSON.stringify({ requests: [...requests.values()] }, null, 2));
      await client.detach().catch(() => undefined);
    },
  };
}

async function within<T>(promise: Promise<T>, timeoutMs: number, timeoutCode: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(timeoutCode)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function assertRestrictedRunPath(rawPath: string, label: string) {
  const resolved = path.resolve(rawPath);
  const relative = path.relative(restrictedEvidenceRoot, resolved);
  if (!path.isAbsolute(rawPath) || relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`D_FINAL11_RESTRICTED_PATH_REQUIRED: ${label}`);
  }
}

function assertNoSensitiveJsonOrLogs(root: string, account: FixtureAccount) {
  if (!existsSync(root)) return;
  const prohibitedValues = [account.password, account.totpSecret]
    .filter((value): value is string => Boolean(value?.trim()));
  for (const file of filesUnder(root)) {
    if (!/\.(?:json|log|txt)$/i.test(file)) continue;
    const content = readFileSync(file, "utf8");
    const containsSensitiveValue = prohibitedValues.some((value) => content.includes(value));
    const containsSensitiveField = /"(?:password|totpSecret|authorization|token|cookie)"\s*:/i.test(content);
    const containsOtpCode = /"(?:otp|code)"\s*:\s*"\d{6}"/i.test(content);
    if (containsSensitiveValue || containsSensitiveField || containsOtpCode) {
      throw new Error(`D_FINAL11_SENSITIVE_EVIDENCE: ${path.basename(file)}`);
    }
  }
}

function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const candidate = path.join(root, entry);
    return statSync(candidate).isDirectory() ? filesUnder(candidate) : [candidate];
  });
}
