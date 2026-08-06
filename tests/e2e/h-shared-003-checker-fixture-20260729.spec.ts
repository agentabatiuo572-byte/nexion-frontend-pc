import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Session = {
  session?: {
    roleCode?: string;
    authorities?: string[];
  };
};
type Ticket = {
  id?: string;
  operationId?: string;
  action?: string;
  obj?: string;
  status?: string;
};
type A2Overview = {
  operationQueue?: Ticket[];
  operationHistory?: Array<{ id?: string; st?: string }>;
};
type H8Overview = {
  version: number;
  rhythmMonth: number;
  rewardSnapshotHash: string;
};

const RUN_ID = process.env.H_SHARED_003_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_PATH = process.env.H_SHARED_003_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/H.json`;
const EVIDENCE_DIR = process.env.H_SHARED_003_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/H/child-final-GSg/shared-003-checker-fixture`;
const CROSS_DOMAIN_OPERATION_ID = process.env.H_SHARED_003_CROSS_DOMAIN_OPERATION_ID
  ?? "WO-260715202311092-100";
const UNKNOWN_OPERATION_ID = "WO-000000000000000-404";
const TARGET_AUTHORITY = "growth_h8_settle";
const COMMAND_SUFFIX = process.env.H_SHARED_003_COMMAND_SUFFIX ?? Date.now().toString(36);

const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  accounts?: { maker?: Account };
  checker?: Account & {
    h8DecisionAuthority?: string;
    h8DecisionRoleId?: number;
    h8DecisionPermissionId?: number;
  };
};
const maker = fixture.accounts?.maker;
const checker = fixture.checker;

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(process.env.H_SHARED_003_FIXTURE_REPAIR, "H_SHARED_003_FIXTURE_REPAIR=1 is required").toBe("1");
  expect(maker).toBeTruthy();
  expect(checker).toBeTruthy();
  expect(maker?.username).not.toBe(checker?.username);
  expect(checker?.h8DecisionAuthority).toBe(TARGET_AUTHORITY);
  expect(checker?.h8DecisionRoleId).toBe(4240);
  expect(checker?.h8DecisionPermissionId).toBe(3867);
  expect(CROSS_DOMAIN_OPERATION_ID).toMatch(/^WO-/);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("SHARED-003 H8 checker fixture is least-privilege, scoped, and stable after refresh/relogin", async ({ browser }) => {
  test.setTimeout(240_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const makerPage = await makerContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const browserErrors: string[] = [];
  const expectedNetworkConsoleErrors: string[] = [];
  for (const page of [makerPage, checkerPage]) {
    page.on("pageerror", (error) => browserErrors.push(`pageerror:${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      if (/^Failed to load resource: the server responded with a status of (?:401|403) \((?:Unauthorized|Forbidden)\)$/
        .test(message.text())) {
        expectedNetworkConsoleErrors.push(message.text());
        return;
      }
      browserErrors.push(`console:${message.text()}`);
    });
  }

  let operationId = "";
  let rejected = false;
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    fixtureRoleId: checker?.h8DecisionRoleId,
    fixturePermissionId: checker?.h8DecisionPermissionId,
    targetAuthority: TARGET_AUTHORITY,
    crossDomainOperationId: CROSS_DOMAIN_OPERATION_ID,
    productBusinessWrites: 0,
  };

  try {
    await loginMfa(makerPage, maker!, "h-maker");
    const makerSession = await currentSession(makerPage);
    expect(makerSession.authorities).toEqual(expect.arrayContaining([
      "growth_h8_read",
      "growth_h8_settle",
      "platform_a2_proposal_create",
    ]));
    expect(makerSession.authorities).not.toContain("platform_a2_operation_approve");

    const h8 = await success<H8Overview>(
      await makerPage.request.get("/api/admin/growth/referral-rewards"),
      "H8 overview",
    );
    expect(h8.version).toBeGreaterThanOrEqual(0);
    expect(h8.rhythmMonth).toBeGreaterThanOrEqual(1);
    expect(h8.rewardSnapshotHash).toMatch(/^[a-f0-9]{64}$/i);

    const proposal = await success<Ticket>(
      await makerPage.request.post("/api/admin/platform/audit/operations", {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-stale-proposal-${COMMAND_SUFFIX}` },
        data: {
          action: "执行邀请奖励真实结算",
          obj: "待结算邀请批次",
          beforeValue: `H8 v${h8.version}`,
          afterValue: "SHARED-003 仅核验决策范围，不执行结算",
          operator: maker!.username,
          operatorRole: "H acceptance maker",
          type: "fund",
          amplifies: true,
          sos: false,
          roleGate: "门槛者",
          reason: `${RUN_ID} SHARED-003 H8 checker 最小权限范围核验`,
          sourceDomain: "H8",
          command: {
            domain: "H",
            op: "h8_referral_settlement",
            params: {
              limit: 1,
              expectedH8Version: h8.version + 10_000,
              expectedRhythmMonth: h8.rhythmMonth,
              rewardSnapshotHash: h8.rewardSnapshotHash,
            },
          },
          target: { domain: "H", type: "referral_settlement_batch", id: "pending" },
        },
      }),
      "stale H8 proposal",
    );
    operationId = String(proposal.id ?? proposal.operationId ?? "");
    expect(operationId).toMatch(/^WO-/);

    const makerSelfApprove = await makerPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-maker-self-approve-${COMMAND_SUFFIX}` },
        data: { reason: `${RUN_ID} maker 自批必须拒绝` },
      },
    );
    const makerSelfApproveBody = await payload(makerSelfApprove);
    expect(makerSelfApprove.status() === 403 || makerSelfApproveBody.code === 403).toBe(true);

    await loginMfa(checkerPage, checker!, "h-checker-initial");
    const initial = await currentSession(checkerPage);
    expect(initial.roleCode).toBe("ACC_CHECKER_114336");
    expect(initial.authorities).toEqual(expect.arrayContaining([
      "growth_h8_read",
      TARGET_AUTHORITY,
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));
    const hMutations = initial.authorities
      .filter((code) => code.startsWith("growth_h") && !code.endsWith("_read"))
      .sort();
    expect(hMutations).toEqual([TARGET_AUTHORITY]);

    const crossDomain = await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(CROSS_DOMAIN_OPERATION_ID)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-cross-domain-${COMMAND_SUFFIX}` },
        data: { reason: `${RUN_ID} H checker 越域决策必须拒绝` },
      },
    );
    const crossDomainBody = await payload(crossDomain);
    expect(crossDomain.status() === 403 || crossDomainBody.code === 403).toBe(true);

    const unknown = await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${UNKNOWN_OPERATION_ID}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-unknown-${COMMAND_SUFFIX}` },
        data: { reason: `${RUN_ID} H checker 未知 ID 必须失败关闭` },
      },
    );
    const unknownBody = await payload(unknown);
    expect(unknown.status() === 403 || unknownBody.code === 403).toBe(true);

    const scopedOverview = await success<A2Overview>(
      await checkerPage.request.get("/api/admin/platform/audit/overview"),
      "H-scoped A2 overview",
    );
    expect(scopedOverview.operationQueue?.some((row) => row.id === operationId)).toBe(true);

    await openA2(checkerPage);
    const row = checkerPage.locator("tbody tr").filter({ hasText: operationId }).first();
    await expect(row).toBeVisible();
    await row.click();
    const drawer = checkerPage.getByRole("dialog").filter({ hasText: `高敏动作 · ${operationId}` });
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText("执行邀请奖励真实结算");
    await checkerPage.screenshot({
      path: path.join(EVIDENCE_DIR, "01-h-scope-list-detail.png"),
      fullPage: true,
    });
    await drawer.getByRole("button", { name: /关闭/ }).click().catch(async () => {
      await checkerPage.keyboard.press("Escape");
    });

    const staleDecision = await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-stale-decision-${COMMAND_SUFFIX}` },
        data: { reason: `${RUN_ID} H checker 仅验证决策范围后触发快照保护` },
      },
    );
    const staleDecisionBody = await payload(staleDecision);
    expect(staleDecision.status()).not.toBe(403);
    expect(staleDecisionBody.code).toBe(409);
    expect(staleDecisionBody.message).toBe("H8_REWARD_SNAPSHOT_CHANGED_REPROPOSE");

    const pendingAfterStale = await success<A2Overview>(
      await checkerPage.request.get("/api/admin/platform/audit/overview"),
      "H-scoped A2 overview after stale decision",
    );
    expect(pendingAfterStale.operationQueue?.find((row) => row.id === operationId)?.status).toBe("pending");

    await checkerPage.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await currentSession(checkerPage);
    expect(hash(afterRefresh.authorities)).toBe(hash(initial.authorities));

    const logout = await checkerPage.request.post("/api/admin/auth/logout");
    expect(logout.ok()).toBe(true);
    expect((await checkerPage.request.get("/api/admin/auth/session")).status()).toBe(401);
    await loginMfa(checkerPage, checker!, "h-checker-relogin");
    const afterRelogin = await currentSession(checkerPage);
    expect(hash(afterRelogin.authorities)).toBe(hash(initial.authorities));
    expect(afterRelogin.authorities
      .filter((code) => code.startsWith("growth_h") && !code.endsWith("_read"))
      .sort()).toEqual([TARGET_AUTHORITY]);
    await openA2(checkerPage);
    await expect(checkerPage.locator("tbody tr").filter({ hasText: operationId }).first()).toBeVisible();
    await checkerPage.screenshot({
      path: path.join(EVIDENCE_DIR, "02-refresh-relogin-stable.png"),
      fullPage: true,
    });

    const reject = await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/reject`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-cleanup-reject-${COMMAND_SUFFIX}` },
        data: { reason: `${RUN_ID} SHARED-003 夹具验证完成，取消陈旧快照提案` },
      },
    );
    await success<Ticket>(reject, "fixture cleanup reject");
    rejected = true;

    evidence.operationId = operationId;
    evidence.fixture = {
      roleCode: initial.roleCode,
      permissionCount: initial.authorities.length,
      authorityHash: hash(initial.authorities),
      hBusinessMutations: hMutations,
      noOtherHMutation: hMutations.length === 1,
    };
    evidence.scope = {
      makerSelfApprove: responseEvidence(makerSelfApprove, makerSelfApproveBody),
      crossDomain: responseEvidence(crossDomain, crossDomainBody),
      unknownOperation: responseEvidence(unknown, unknownBody),
      sameDomainListed: true,
      sameDomainDetailVisible: true,
      staleDecision: responseEvidence(staleDecision, staleDecisionBody),
      ticketStayedPendingAfterFailedReplay: true,
    };
    evidence.session = {
      refreshStable: hash(afterRefresh.authorities) === hash(initial.authorities),
      reloginStable: hash(afterRelogin.authorities) === hash(initial.authorities),
    };
    evidence.cleanup = { proposalRejected: true, targetBusinessWriteCount: 0 };
    evidence.browserErrors = browserErrors;
    evidence.expectedNetworkConsoleErrors = {
      count: expectedNetworkConsoleErrors.length,
      reason: "login/session probes, deliberate 403 authorization negatives, and explicit logout",
    };
    expect(browserErrors).toEqual([]);
    evidence.status = "passed";
    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(evidence, null, 2));
  } finally {
    if (operationId && !rejected) {
      await loginMfa(checkerPage, checker!, "h-checker-cleanup").catch(() => undefined);
      await checkerPage.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/reject`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-h-shared-003-cleanup-finally-${COMMAND_SUFFIX}` },
          data: { reason: `${RUN_ID} SHARED-003 失败路径清理陈旧快照提案` },
        },
      ).catch(() => undefined);
    }
    if (!evidence.status) {
      evidence.status = "failed";
      evidence.browserErrors = browserErrors;
      writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(evidence, null, 2));
    }
    await makerContext.close();
    await checkerContext.close();
  }
});

function responseEvidence(response: APIResponse, body: Envelope) {
  return { http: response.status(), code: body.code, message: body.message };
}

function hash(values: string[]) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
}

async function currentSession(page: Page) {
  const value = await success<Session>(await page.request.get("/api/admin/auth/session"), "current session");
  return {
    roleCode: value.session?.roleCode ?? "",
    authorities: value.session?.authorities ?? [],
  };
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
