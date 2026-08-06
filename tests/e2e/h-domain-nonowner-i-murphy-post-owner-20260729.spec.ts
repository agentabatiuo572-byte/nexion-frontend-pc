import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string; roleCode?: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type OwnerResult = {
  operationId: string;
  invitedUserId: number;
  inviterUserId: number;
  settlement?: {
    settlementNo?: string;
    status?: string;
  };
};
type ChildResources = {
  backendPid: number;
  backendPort?: number;
  database?: string;
};
type PcResources = {
  pcPid: number;
  pcPort?: number;
};
type Final15RuntimeLock = {
  candidate?: string;
  pc?: { buildId?: string; main?: { baseUrl?: string; pid?: number; backendUrl?: string } };
  backend?: { jarSha256?: string; main?: { pid?: number; database?: string } };
};
type Session = {
  session?: {
    roleCode?: string;
    authorities?: string[];
  };
};
type H8Overview = {
  recentSettlements?: Array<{
    settlementNo?: string;
    invitedUserId?: number;
    inviterUserId?: number;
    status?: string;
  }>;
};
type A2Overview = {
  operationQueue?: Array<{ id?: string; status?: string }>;
  operationHistory?: Array<{ id?: string; st?: string }>;
};

const RUN_ID = process.env.H_NONOWNER_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_PATH = process.env.H_NONOWNER_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/H.json`;
const OWNER_RESULT_PATH = process.env.H_NONOWNER_OWNER_RESULT_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/child-final-GSg/h8-final2-b1/result.json`;
const CHILD_RESOURCES_PATH = process.env.H_NONOWNER_CHILD_RESOURCES_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/child-final-GSg/child-resources.json`;
const PC_RESOURCES_PATH = process.env.H_NONOWNER_PC_RESOURCES_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/child-final-GSg/pc-resources.json`;
const UNKNOWN_OPERATION_ID = "WO-000000000000000-404";
const TARGET_AUTHORITY = "growth_h8_settle";
const FINAL15_MAIN = process.env.H_NONOWNER_FINAL15_MAIN === "1";

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  checker?: Account & { h8DecisionAuthority?: string };
};
const checker = fixture.checker;

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(process.env.H_NONOWNER_I_MURPHY_REVIEW, "H_NONOWNER_I_MURPHY_REVIEW=1 is required").toBe("1");
  const lease = process.env.H_NONOWNER_LEASE_TOKEN?.trim() ?? "";
  expect(
    lease.length >= 8 && lease !== "<main-controller-issued-token>",
    "main-controller H non-Owner lease is required after H Owner completes",
  ).toBe(true);
  expect(checker).toBeTruthy();
  // Fixture metadata can predate a role repair. The authenticated session below
  // is the authority: it must prove the exact H8-only decision grant live.
});

test("I 非 Owner 墨菲复审：H8 结算不可重复、A2 失败关闭、刷新重登与跨域证据稳定", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const ownerResult = bindOwnerResult();
  const resources = bindHChild();
  const crossDomainOperationId = process.env.H_NONOWNER_CROSS_DOMAIN_OPERATION_ID?.trim() ?? "";
  expect(crossDomainOperationId, "a current pending non-H operation ID is required").toMatch(/^WO-/);
  expect(crossDomainOperationId).not.toBe(ownerResult.operationId);

  const context = await browser.newContext();
  const page = await context.newPage();
  const unexpectedBrowserErrors: string[] = [];
  const expectedNetworkConsoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const successfulResponses = new Set<string>();
  const abortedAuditedRequests: string[] = [];
  page.on("pageerror", (error) => unexpectedBrowserErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/^Failed to load resource: the server responded with a status of (?:401|403|409) /
      .test(message.text())) {
      expectedNetworkConsoleErrors.push(message.text());
      return;
    }
    unexpectedBrowserErrors.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (response.status() === 200 && (pathname.startsWith("/api/admin/growth/")
      || pathname.startsWith("/api/admin/platform/audit"))) {
      successfulResponses.add(`${response.request().method()} ${pathname}`);
    }
  });
  page.on("requestfailed", (request) => {
    const pathname = new URL(request.url()).pathname;
    const failure = request.failure()?.errorText ?? "unknown";
    // A2 navigation and explicit reload can cancel its superseded GET. Treat
    // that as covered only if the same method/path has a real 200 response.
    if (request.method() === "GET" && failure === "net::ERR_ABORTED") {
      abortedAuditedRequests.push(`${request.method()} ${pathname}`);
      return;
    }
    if (pathname.startsWith("/api/admin/growth/")
      || pathname.startsWith("/api/admin/platform/audit")) {
      requestFailures.push(`${request.method()} ${pathname} ${failure}`);
    }
  });

  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    ownerOperationId: ownerResult.operationId,
    settlementNo: ownerResult.settlement?.settlementNo,
    child: resources,
    mutationIntent: "none; all POST probes are forbidden, terminal, or replay-gated",
  };
  let firstTraceStarted = false;
  let secondTraceStarted = false;
  try {
    await loginMfa(page, checker!, "h-nonowner-checker-initial");
    const initial = await currentSession(page);
    expect(initial.roleCode).toBe(checker?.roleCode ?? "ACC_CHECKER_114336");
    expect(initial.authorities).toEqual(expect.arrayContaining([
      "growth_h8_read",
      TARGET_AUTHORITY,
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));
    expect(hMutations(initial.authorities)).toEqual([TARGET_AUTHORITY]);

    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    firstTraceStarted = true;
    await openH8(page);
    const h8 = await success<H8Overview>(
      await page.request.get("/api/admin/growth/referral-rewards"),
      "H8 post-owner overview",
    );
    const matchingSettlements = (h8.recentSettlements ?? []).filter((row) =>
      Number(row.invitedUserId) === Number(ownerResult.invitedUserId)
      && Number(row.inviterUserId) === Number(ownerResult.inviterUserId));
    expect(matchingSettlements).toHaveLength(1);
    expect(matchingSettlements[0]?.settlementNo).toBe(ownerResult.settlement?.settlementNo);
    expect(matchingSettlements[0]?.status).toBe("SETTLED");

    const directReplay = await page.request.post(
      "/api/admin/growth/referral-rewards/settlements/run",
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-nonowner-direct-replay-${Date.now()}` },
        data: {
          limit: 1,
          reason: `${RUN_ID} I 非 Owner 验证 H8 不可绕过 A2 重复结算`,
        },
      },
    );
    const directReplayBody = await payload(directReplay);
    expect(directReplayBody.code).toBe(409);
    expect(directReplayBody.message).toContain("A2_CONFIRMATION_REQUIRED");

    const terminalApprove = await page.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(ownerResult.operationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-nonowner-terminal-${Date.now()}` },
        data: { reason: `${RUN_ID} I 非 Owner 验证已结算 operation 不可再次执行` },
      },
    );
    const terminalApproveBody = await payload(terminalApprove);
    expect(terminalApproveBody.code).toBe(409);
    expect(terminalApproveBody.message).toBe("A2_OPERATION_ALREADY_TERMINAL");

    const crossDomain = await page.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(crossDomainOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-nonowner-cross-domain-${Date.now()}` },
        data: { reason: `${RUN_ID} I 非 Owner 验证 H checker 越域失败关闭` },
      },
    );
    const crossDomainBody = await payload(crossDomain);
    expect(crossDomain.status() === 403 || crossDomainBody.code === 403).toBe(true);

    const unknown = await page.request.post(
      `/api/admin/platform/audit/operations/${UNKNOWN_OPERATION_ID}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-nonowner-unknown-${Date.now()}` },
        data: { reason: `${RUN_ID} I 非 Owner 验证未知 operation 失败关闭` },
      },
    );
    const unknownBody = await payload(unknown);
    expect(unknown.status() === 403 || unknownBody.code === 403).toBe(true);

    const a2 = await success<A2Overview>(
      await page.request.get("/api/admin/platform/audit/overview"),
      "H-scoped A2 overview",
    );
    successfulResponses.add("GET /api/admin/platform/audit/overview");
    const ownerTicket = (a2.operationQueue ?? []).find((row) => row.id === ownerResult.operationId);
    const ownerHistory = (a2.operationHistory ?? []).find((row) => row.id === ownerResult.operationId);
    expect(ownerTicket?.status ?? ownerHistory?.st).toBe("approved");

    await openA2(page);
    const row = page.locator("tbody tr").filter({ hasText: ownerResult.operationId }).first();
    await expect(row).toBeVisible();
    await row.click();
    const drawer = page.getByRole("dialog").filter({ hasText: ownerResult.operationId });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("执行邀请奖励真实结算");
    await expect(drawer).toContainText(/终态\s*已执行/);
    await expect(drawer.getByRole("button", { name: "执行", exact: true })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath("01-h-nonowner-terminal-detail.png"), fullPage: true });

    await context.tracing.stop({ path: testInfo.outputPath("01-h-nonowner-post-owner.zip") });
    firstTraceStarted = false;
    const beforeLogoutHash = hash(initial.authorities);
    const logout = await page.request.post("/api/admin/auth/logout");
    expect(logout.ok()).toBe(true);
    expect((await page.request.get("/api/admin/auth/session")).status()).toBe(401);

    await loginMfa(page, checker!, "h-nonowner-checker-relogin");
    const afterRelogin = await currentSession(page);
    expect(hash(afterRelogin.authorities)).toBe(beforeLogoutHash);
    expect(hMutations(afterRelogin.authorities)).toEqual([TARGET_AUTHORITY]);
    await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    secondTraceStarted = true;
    await openH8(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await currentSession(page);
    expect(hash(afterRefresh.authorities)).toBe(beforeLogoutHash);
    const afterRefreshH8 = await success<H8Overview>(
      await page.request.get("/api/admin/growth/referral-rewards"),
      "H8 after refresh/relogin",
    );
    const afterRefreshMatches = (afterRefreshH8.recentSettlements ?? []).filter((row) =>
      Number(row.invitedUserId) === Number(ownerResult.invitedUserId)
      && Number(row.inviterUserId) === Number(ownerResult.inviterUserId));
    expect(afterRefreshMatches).toHaveLength(1);
    expect(afterRefreshMatches[0]?.settlementNo).toBe(ownerResult.settlement?.settlementNo);
    await page.screenshot({ path: testInfo.outputPath("02-h-nonowner-refresh-relogin.png"), fullPage: true });
    await context.tracing.stop({ path: testInfo.outputPath("02-h-nonowner-refresh-relogin.zip") });
    secondTraceStarted = false;

    expect(unexpectedBrowserErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    const uncoveredAborts = abortedAuditedRequests.filter((entry) => !successfulResponses.has(entry));
    expect(uncoveredAborts, "every aborted audited request needs a same-method/path 200").toEqual([]);
    evidence.ownerSettlement = {
      exactPairCount: matchingSettlements.length,
      exactPairCountAfterRefresh: afterRefreshMatches.length,
      status: matchingSettlements[0]?.status,
    };
    evidence.murphy = {
      directReplay: responseEvidence(directReplay, directReplayBody),
      terminalApprove: responseEvidence(terminalApprove, terminalApproveBody),
      crossDomain: responseEvidence(crossDomain, crossDomainBody),
      unknownOperation: responseEvidence(unknown, unknownBody),
    };
    evidence.session = {
      authorityHash: beforeLogoutHash,
      refreshStable: hash(afterRefresh.authorities) === beforeLogoutHash,
      reloginStable: hash(afterRelogin.authorities) === beforeLogoutHash,
      hBusinessMutations: hMutations(afterRelogin.authorities),
    };
    evidence.diagnostics = {
      unexpectedBrowserErrors,
      requestFailures,
      abortedAuditedRequests,
      successfulResponses: [...successfulResponses].sort(),
      expectedNetworkConsoleErrorCount: expectedNetworkConsoleErrors.length,
    };
    evidence.status = "passed";
  } catch (error) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (firstTraceStarted) {
      await context.tracing.stop({ path: testInfo.outputPath("failure-first-phase.zip") })
        .catch(() => undefined);
    }
    if (secondTraceStarted) {
      await context.tracing.stop({ path: testInfo.outputPath("failure-second-phase.zip") })
        .catch(() => undefined);
    }
    await page.request.post("/api/admin/auth/logout").catch(() => undefined);
    evidence.completedAt = new Date().toISOString();
    evidence.finally = {
      logoutAttempted: true,
      businessCleanupRequired: false,
      reason: "all probes fail before mutation or target an already terminal operation",
    };
    await testInfo.attach("h-domain-nonowner-i-murphy-evidence.json", {
      body: Buffer.from(JSON.stringify(evidence, null, 2)),
      contentType: "application/json",
    });
    await context.close();
  }
});

function bindOwnerResult() {
  const result = JSON.parse(readFileSync(OWNER_RESULT_PATH, "utf8")) as OwnerResult;
  expect(result.operationId).toMatch(/^WO-/);
  expect(Number.isSafeInteger(Number(result.invitedUserId))).toBe(true);
  expect(Number.isSafeInteger(Number(result.inviterUserId))).toBe(true);
  expect(result.settlement?.settlementNo).toMatch(/^REF-/);
  expect(result.settlement?.status).toBe("SETTLED");
  return result;
}

function bindHChild() {
  const backend = JSON.parse(readFileSync(CHILD_RESOURCES_PATH, "utf8")) as ChildResources;
  const pc = JSON.parse(readFileSync(PC_RESOURCES_PATH, "utf8")) as PcResources;
  const adminUrl = new URL(process.env.ADMIN_BASE_URL ?? "");
  const backendUrl = new URL(process.env.NEXION_BACKEND_URL ?? "");
  const expectedDatabase = process.env.H_NONOWNER_CHILD_DATABASE?.trim() ?? "";
  const expectedChildDatabase = FINAL15_MAIN
    ? "nexion_acceptance_20260729_114336"
    : "nexion_acceptance_20260729_114336_irreversible";
  expect(expectedDatabase, "H non-Owner database binding").toBe(expectedChildDatabase);
  expect(["127.0.0.1", "localhost"]).toContain(adminUrl.hostname);
  expect(["127.0.0.1", "localhost"]).toContain(backendUrl.hostname);
  const expectedPcPort = FINAL15_MAIN ? 3002 : pc.pcPort ?? 3302;
  const expectedBackendPort = FINAL15_MAIN ? 8110 : backend.backendPort ?? 18110;
  expect(Number(adminUrl.port)).toBe(expectedPcPort);
  expect(Number(backendUrl.port)).toBe(expectedBackendPort);
  if (!FINAL15_MAIN) expect(Number(backendUrl.port), "H child must not use shared backend 8110").not.toBe(8110);
  if (backend.database) expect(backend.database).toBe(expectedDatabase);
  if (FINAL15_MAIN) bindFinal15Main(pc, backend, expectedDatabase);
  return {
    backendPid: backend.backendPid,
    backendPort: expectedBackendPort,
    pcPid: pc.pcPid,
    pcPort: expectedPcPort,
    database: expectedDatabase,
  };
}

function bindFinal15Main(pc: PcResources, backend: ChildResources, database: string) {
  const lockPath = process.env.H_NONOWNER_RUNTIME_LOCK_PATH?.trim();
  expect(lockPath, "Final15 main review requires runtime lock path").toBeTruthy();
  const lock = JSON.parse(readFileSync(lockPath!, "utf8")) as Final15RuntimeLock;
  expect(lock.candidate).toBe("Final15");
  expect(new URL(lock.pc?.main?.baseUrl ?? "").port).toBe("3002");
  expect(lock.pc?.main?.pid).toBe(pc.pcPid);
  expect(lock.backend?.main?.pid).toBe(backend.backendPid);
  expect(lock.backend?.main?.database).toBe(database);
  expect(lock.pc?.buildId).toMatch(/^\S+$/);
  expect(lock.backend?.jarSha256).toMatch(/^[A-F0-9]{64}$/);
}

function hMutations(authorities: string[]) {
  return authorities
    .filter((code) => code.startsWith("growth_h") && !code.endsWith("_read"))
    .sort();
}

function hash(values: string[]) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
}

function responseEvidence(response: APIResponse, body: Envelope) {
  return { http: response.status(), code: body.code, message: body.message };
}

async function currentSession(page: Page) {
  const value = await success<Session>(await page.request.get("/api/admin/auth/session"), "current session");
  return {
    roleCode: value.session?.roleCode ?? "",
    authorities: value.session?.authorities ?? [],
  };
}

async function openH8(page: Page) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", { name: /增长与运营节奏.*H|H.*增长与运营节奏/ }).first();
  const link = sidebar.locator('a[href="/growth/referral-rewards"]').first();
  if (!(await link.isVisible().catch(() => false))) {
    await group.click();
    await expect(link).toBeVisible();
  }
  await link.click();
  await expect(page).toHaveURL(/\/growth\/referral-rewards$/);
  await expect(page.getByText("新人礼与邀请人奖励", { exact: true }).last()).toBeVisible();
}

async function openA2(page: Page) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first();
  const link = sidebar.getByRole("link", { name: "审计 & 操作确认 A2", exact: true }).first();
  if (!(await link.isVisible().catch(() => false))) {
    await group.click();
    await expect(link).toBeVisible();
  }
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(page.getByRole("heading", { name: "审计 & 操作确认" })).toBeVisible();
}

async function loginMfa(page: Page, account: Account, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    if (await otp.isVisible().catch(() => false)) {
      await otp.fill(await freshTotp(key, account.totpSecret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true).catch(() => false)) return;
  }
  throw new Error(`${key} login failed`);
}

async function success<T>(response: APIResponse, label: string) {
  const body = await payload(response) as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function payload(response: APIResponse) {
  return await response.json() as Envelope;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
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
