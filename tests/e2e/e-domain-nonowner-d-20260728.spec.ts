import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; operationId?: string; status?: string };
type E3Overview = { config?: Record<string, string | number | null> };

const RUN_ID = process.env.E_NONOWNER_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR = process.env.E_NONOWNER_D_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/nonowner-D/final-adversarial`;
const A_FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const fixture = JSON.parse(readFileSync(A_FIXTURE_PATH, "utf8")) as {
  accounts: { d_checker: Account };
};
const FRONTEND_KEY = "E.device.capacity.subsidyDays";
const CANONICAL_KEY = "capacitySubsidyDays";

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("E-006: E3 可见入口提案使用 canonical 对象锁，直写/第二运营员冲突，独立 checker 执行后精确恢复", async ({ browser }) => {
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const result: Record<string, unknown> = { runId: RUN_ID, module: "E3", defect: "E-006" };
  let original = "";
  let changed = "";
  let changeOperationId = "";
  let restoreOperationId = "";
  let changeProposalBody: Record<string, unknown> | null = null;
  let changedApplied = false;

  try {
    await loginSuperadmin(maker);
    await login(checker, fixture.accounts.d_checker, "d_checker");
    original = await readSubsidyDays(maker);
    changed = String(Number(original) + 1);
    expect(Number.isSafeInteger(Number(original))).toBe(true);

    const created = await submitE3SubsidyFromVisiblePage(
      maker,
      changed,
      `${RUN_ID} E-006 canonical 对象锁前向验收并预置精确回滚`,
    );
    changeOperationId = created.operationId;
    changeProposalBody = created.body;
    result.changeOperationId = changeOperationId;
    expect((changeProposalBody.target as { id?: string } | undefined)?.id).toBe(CANONICAL_KEY);
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    const replay = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": created.idempotencyKey },
      data: changeProposalBody,
    });
    const replayBody = await envelope<Ticket>(replay);
    expect(replayBody.code).toBe(0);
    expect(ticketId(replayBody)).toBe(changeOperationId);

    const mismatch = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": created.idempotencyKey },
      data: { ...changeProposalBody, reason: `${RUN_ID} 同键异载荷必须拒绝` },
    });
    const mismatchBody = await envelope(mismatch);
    expect(mismatch.status() === 409 || mismatchBody.code === 409).toBe(true);

    const secondOperator = await checker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": `${RUN_ID}-e3-second-operator-${randomUUID()}` },
      data: {
        ...changeProposalBody,
        reason: `${RUN_ID} 第二运营员同 canonical 对象并发必须拒绝`,
      },
    });
    const secondOperatorBody = await envelope(secondOperator);
    expect(secondOperator.status() === 409 || secondOperatorBody.code === 409).toBe(true);
    expect(secondOperatorBody.message).toContain("OBJECT_ALREADY_PENDING");

    const directWrite = await maker.request.patch("/api/admin/devices/e3/config", {
      headers: { "Idempotency-Key": `${RUN_ID}-e3-direct-while-pending-${randomUUID()}` },
      data: {
        key: FRONTEND_KEY,
        value: changed,
        reason: `${RUN_ID} pending A2 期间同 canonical 键直写必须失败关闭`,
        operator: "server-authenticated",
      },
    });
    const directWriteBody = await envelope(directWrite);
    expect(directWrite.status() === 409 || directWriteBody.code === 409).toBe(true);
    expect(directWriteBody.message).toContain("OBJECT_LOCKED_BY_A2");
    expect(await readSubsidyDays(maker)).toBe(original);

    const selfApprove = await maker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-e3-self-approve-${randomUUID()}` },
        data: { reason: `${RUN_ID} maker 不得自批 E3 参数` },
      },
    );
    const selfApproveBody = await envelope(selfApprove);
    expect(selfApprove.status() === 403 || selfApproveBody.code === 403).toBe(true);

    await approveThroughA2(
      checker,
      changeOperationId,
      `${RUN_ID} checker 核对 E3 临时值、锁竞争与精确回滚后批准`,
    );
    expect(await readSubsidyDays(checker)).toBe(changed);
    changedApplied = true;
    await openE3FromSidebar(maker);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(subsidyRow(maker)).toContainText(`${changed} 天`);
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "02-approved-visible.png"), fullPage: true });

    const restored = await submitE3SubsidyFromVisiblePage(
      maker,
      original,
      `${RUN_ID} E-006 按验收前 canonical 快照精确恢复`,
    );
    restoreOperationId = restored.operationId;
    await approveThroughA2(
      checker,
      restoreOperationId,
      `${RUN_ID} checker 核对 E3 原始快照后批准精确恢复`,
    );
    expect(await readSubsidyDays(checker)).toBe(original);
    changedApplied = false;

    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(subsidyRow(maker)).toContainText(`${original} 天`);
    const audit = await checker.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    const events = await checker.request.get("/api/admin/platform/events/overview");
    expect(audit.status()).toBe(200);
    expect(events.status()).toBe(200);

    Object.assign(result, {
      targetId: CANONICAL_KEY,
      aliasAbsentFromLock: true,
      original,
      changed,
      restoreOperationId,
      idempotency: {
        sameKeySamePayload: replay.status(),
        sameOperationId: true,
        sameKeyDifferentPayload: mismatch.status(),
      },
      concurrency: {
        secondOperator: secondOperator.status(),
        directWriteWhilePending: directWrite.status(),
        makerSelfApprove: selfApprove.status(),
      },
      a2AuditStatus: audit.status(),
      a4OverviewStatus: events.status(),
      restoredExact: true,
    });
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "03-restored-visible.png"), fullPage: true });
  } finally {
    if (restoreOperationId && changedApplied) {
      await rejectIfPending(checker, restoreOperationId);
    }
    if (changeOperationId && !changedApplied) {
      await rejectIfPending(checker, changeOperationId);
    }
    if (changedApplied && original && changeProposalBody) {
      await rejectIfPending(checker, changeOperationId);
      await emergencyRestore(maker, checker, changeProposalBody, changed, original);
      expect(await readSubsidyDays(checker)).toBe(original);
    }
    writeFileSync(path.join(EVIDENCE_DIR, "e006-result.json"), JSON.stringify(result, null, 2));
    await makerContext.close();
    await checkerContext.close();
  }
});

test("E3 A2 结果未知保留弹窗，并对同载荷重试复用同一命令键且不触碰真实配置", async ({ page }) => {
  await loginSuperadmin(page);
  const original = await readSubsidyDays(page);
  const changed = String(Number(original) + 1);
  const keys: string[] = [];
  const bodies: string[] = [];

  await page.route("**/api/admin/platform/audit/operations", async (route) => {
    const request = route.request();
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/api/admin/platform/audit/operations") {
      await route.continue();
      return;
    }
    keys.push(request.headers()["idempotency-key"] ?? "");
    bodies.push(request.postData() ?? "");
    if (keys.length === 1) {
      await route.fulfill({
        status: 503,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: null }),
      });
    }
  });

  await openE3FromSidebar(page);
  await subsidyRow(page).getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("目标新值").fill(changed);
  await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} E3 未知结果同载荷同键重试`);
  for (const expectedStatus of [503, 200]) {
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/platform/audit/operations");
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    expect((await response).status()).toBe(expectedStatus);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText(/结果暂不确定/);
    await expect(dialog.getByRole("alert")).toContainText(/同一命令号/);
    await expect(dialog.getByRole("alert")).toContainText(/A2 审计/);
    await expect(dialog.getByLabel("目标新值")).toHaveValue(changed);
    await expect(dialog.getByLabel(/操作理由/)).toHaveValue(`${RUN_ID} E3 未知结果同载荷同键重试`);
  }
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(bodies[1]).toBe(bodies[0]);
  expect(await readSubsidyDays(page)).toBe(original);
  await page.unroute("**/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  writeFileSync(path.join(EVIDENCE_DIR, "e3-unknown-result.json"), JSON.stringify({
    runId: RUN_ID,
    attempts: 2,
    injectedStatuses: [503, 200],
    malformedSuccessCovered: true,
    samePayloadSameKey: true,
    dialogRetained: true,
    realWrite: false,
    originalPreserved: true,
  }, null, 2));
});

async function submitE3SubsidyFromVisiblePage(page: Page, value: string, reason: string) {
  await openE3FromSidebar(page);
  await subsidyRow(page).getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  const body = await envelope<Ticket>(response);
  expect(response.status()).toBe(200);
  expect(body.code).toBe(0);
  await expect(dialog).toHaveCount(0);
  return {
    operationId: ticketId(body),
    idempotencyKey: response.request().headers()["idempotency-key"] ?? "",
    body: JSON.parse(response.request().postData() ?? "{}") as Record<string, unknown>,
  };
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  const platform = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
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
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const approved = await response;
  const body = await envelope(approved);
  expect(approved.status()).toBe(200);
  expect(body.code).toBe(0);
  await expect(page.getByText(`${operationId} 已执行`, { exact: false })).toBeVisible();
}

async function rejectIfPending(page: Page, operationId: string) {
  if (!operationId) return;
  await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/reject`,
    {
      headers: { "Idempotency-Key": `${RUN_ID}-e3-finally-reject-${randomUUID()}` },
      data: { reason: `${RUN_ID} finally 清理未决 E3 工单` },
    },
  ).catch(() => undefined);
}

async function emergencyRestore(
  maker: Page,
  checker: Page,
  originalProposal: Record<string, unknown>,
  before: string,
  after: string,
) {
  const command = originalProposal.command as { domain?: string; op?: string; params?: Record<string, unknown> };
  const restoreBody = {
    ...originalProposal,
    beforeValue: before,
    afterValue: after,
    reason: `${RUN_ID} finally 按原始快照恢复 E3`,
    command: {
      ...command,
      params: { ...(command?.params ?? {}), key: FRONTEND_KEY, value: after },
    },
    target: { domain: "E", type: "device_e3_config", id: CANONICAL_KEY },
  };
  const created = await maker.request.post("/api/admin/platform/audit/operations", {
    headers: { "Idempotency-Key": `${RUN_ID}-e3-finally-restore-${randomUUID()}` },
    data: restoreBody,
  });
  const body = await envelope<Ticket>(created);
  expect(body.code).toBe(0);
  const operationId = ticketId(body);
  const approved = await checker.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
    {
      headers: { "Idempotency-Key": `${RUN_ID}-e3-finally-approve-${randomUUID()}` },
      data: { reason: `${RUN_ID} checker 批准 finally 精确恢复` },
    },
  );
  const approvedBody = await envelope(approved);
  expect(approvedBody.code).toBe(0);
}

async function readSubsidyDays(page: Page) {
  const response = await page.request.get("/api/admin/devices/e3/overview");
  const body = await envelope<E3Overview>(response);
  expect(response.status()).toBe(200);
  expect(body.code).toBe(0);
  const value = String(body.data?.config?.[CANONICAL_KEY] ?? "");
  expect(value).toMatch(/^\d+$/);
  return value;
}

async function openE3FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  const link = page.locator('a[href="/devices/trade-in"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/trade-in$/);
  await expect(page.getByText("任务产能曲线", { exact: true })).toBeVisible();
}

function subsidyRow(page: Page) {
  return page.locator(".pkv").filter({ hasText: "新机任务补贴天数" }).first();
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await shellVisible(page, 2_000)) return;
  await page.locator('input[autocomplete="username"]').fill(
    process.env.ADMIN_E2E_USERNAME ?? "superadmin",
  );
  await page.locator('input[autocomplete="current-password"]').fill(
    process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456",
  );
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first())
    .toBeVisible({ timeout: 30_000 });
}

async function login(page: Page, account: Account, accountKey: string) {
  let lastStatus = 0;
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await shellVisible(page, 2_000)) return;
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await username.fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const passwordResponse = await loginResponse;
    const passwordBody = await passwordResponse.json().catch(() => null) as Envelope | null;
    expect(passwordBody?.code).toBe(0);
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 10_000 });
    await otp.fill(await freshTotp(accountKey, account.totpSecret));
    const verifyResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verifyResponse;
    const verifiedBody = await verified.json().catch(() => null) as Envelope | null;
    lastStatus = verified.status();
    lastCode = verifiedBody?.code;
    if (verified.status() === 200) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
    }
    if (await shellVisible(page, 30_000)) return;
  }
  throw new Error(`${accountKey} login failed status=${lastStatus} code=${lastCode ?? "none"}`);
}

async function shellVisible(page: Page, timeout: number) {
  return await page.getByText("运营总览", { exact: true }).first()
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

function ticketId(body: Envelope<Ticket>) {
  const id = String(body.data?.id ?? body.data?.operationId ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function envelope<T = unknown>(response: APIResponse | Response) {
  return await response.json().catch(() => null) as Envelope<T>;
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
