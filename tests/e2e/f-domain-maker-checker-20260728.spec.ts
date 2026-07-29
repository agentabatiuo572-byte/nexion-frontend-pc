import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; operationId?: string; status?: string };
type F1Overview = { configValues?: Record<string, string> };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR = `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/maker-checker`;
const F_FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/permission-fixtures.json`,
  "utf8",
)) as { accounts: { f_maker: Account } };
const A_FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`,
  "utf8",
)) as { accounts: { d_checker: Account } };
const CHANGED_VALUE = "Nexion V-Rank [R151023]";
const EXISTING_CHANGE_OPERATION_ID =
  process.env.F_EXISTING_CHANGE_OPERATION_ID?.trim() || "";

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F1 独立 maker/checker、对象锁、幂等、CAS、精确恢复", async ({ browser }) => {
  test.setTimeout(180_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const superContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const superadmin = await superContext.newPage();
  const result: Record<string, unknown> = { runId: RUN_ID };
  let original = "";
  let changedApplied = false;
  let changeOperationId = "";

  try {
    await login(maker, F_FIXTURE.accounts.f_maker, "f_maker");
    await login(checker, A_FIXTURE.accounts.d_checker, "d_checker");
    await loginSuperadmin(superadmin);
    original = await readPrizeName(superadmin);
    expect(original).not.toBe("");
    expect(original).not.toBe(CHANGED_VALUE);
    result.original = original;

    changeOperationId = EXISTING_CHANGE_OPERATION_ID || await submitPrizeThroughF1(
        maker,
        CHANGED_VALUE,
        `${RUN_ID} F1 maker 临时修改展示文案并预置精确回滚`,
      );
    result.changeOperationId = changeOperationId;
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "01-maker-pending.png"), fullPage: true });

    const selfApprove = await maker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-self-approve` },
        data: { reason: `${RUN_ID} maker 不得自批` },
      },
    );
    const selfApproveBody = await envelope(selfApprove);
    expect(selfApprove.status() === 403 || selfApproveBody.code === 403).toBe(true);
    result.selfApprove = { http: selfApprove.status(), code: selfApproveBody.code };

    const duplicate = await superadmin.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": `${RUN_ID}-f-other-operator-duplicate` },
      data: proposal("F.prize.name", original, CHANGED_VALUE,
        `${RUN_ID} 第二运营员同对象并发冲突负向验收`),
    });
    const duplicateBody = await envelope(duplicate);
    expect(duplicateBody.code).toBe(409);
    result.concurrentObjectLock = { http: duplicate.status(), code: duplicateBody.code, message: duplicateBody.message };

    await approveThroughA2(
      checker,
      changeOperationId,
      `${RUN_ID} checker 核对 F1 临时文案、影响范围和回滚预案后批准`,
    );
    expect(await readPrizeName(checker)).toBe(CHANGED_VALUE);
    changedApplied = true;
    await openF1FromSidebar(maker);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByText(CHANGED_VALUE, { exact: true }).first()).toBeVisible();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "02-approved-visible.png"), fullPage: true });

    const restoreOperationId = await submitPrizeThroughF1(
      maker,
      original,
      `${RUN_ID} F1 maker 按验收前快照精确恢复展示文案`,
    );
    result.restoreOperationId = restoreOperationId;
    await approveThroughA2(
      checker,
      restoreOperationId,
      `${RUN_ID} checker 核对原始快照后批准精确恢复`,
    );
    expect(await readPrizeName(checker)).toBe(original);
    changedApplied = false;

    const idemKey = `${RUN_ID}-f-proposal-idempotency`;
    const noopBody = proposal(
      "F.prize.name",
      original,
      original,
      `${RUN_ID} F1 幂等与终态竞争无副作用验收`,
    );
    const first = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: noopBody,
    });
    const firstBody = await envelope<Ticket>(first);
    expect(firstBody.code).toBe(0);
    const noopOperationId = ticketId(firstBody);
    const retry = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: noopBody,
    });
    const retryBody = await envelope<Ticket>(retry);
    expect(retryBody.code).toBe(0);
    expect(ticketId(retryBody)).toBe(noopOperationId);

    const mismatch = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": idemKey },
      data: { ...noopBody, reason: `${RUN_ID} 同键异载荷必须拒绝` },
    });
    const mismatchBody = await envelope(mismatch);
    expect(mismatchBody.code).toBe(409);

    const [approveRace, rejectRace] = await Promise.all([
      checker.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(noopOperationId)}/approve`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-f-cas-approve` },
          data: { reason: `${RUN_ID} checker CAS 批准竞争` },
        },
      ),
      superadmin.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(noopOperationId)}/reject`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-f-cas-reject` },
          data: { reason: `${RUN_ID} second checker CAS 驳回竞争` },
        },
      ),
    ]);
    const approveRaceBody = await envelope(approveRace);
    const rejectRaceBody = await envelope(rejectRace);
    const raceCodes = [approveRaceBody.code, rejectRaceBody.code].sort((a, b) => Number(a) - Number(b));
    expect(raceCodes).toEqual([0, 409]);
    expect(await readPrizeName(checker)).toBe(original);
    result.idempotency = {
      key: idemKey,
      operationId: noopOperationId,
      retrySameOperation: true,
      mismatchCode: mismatchBody.code,
    };
    result.casRace = {
      approve: { http: approveRace.status(), code: approveRaceBody.code },
      reject: { http: rejectRace.status(), code: rejectRaceBody.code },
      exactlyOneTerminalWinner: true,
    };

    const audit = await checker.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    const events = await checker.request.get("/api/admin/platform/events/overview");
    expect(audit.status()).toBe(200);
    expect(events.status()).toBe(200);
    result.auditStatus = audit.status();
    result.eventOverviewStatus = events.status();
    result.restoredExact = true;
    await openF1FromSidebar(maker);
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByText(original, { exact: true }).first()).toBeVisible();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "03-restored.png"), fullPage: true });
  } finally {
    if (changedApplied && original) {
      const recovery = await maker.request.post("/api/admin/platform/audit/operations", {
        headers: { "Idempotency-Key": `${RUN_ID}-f-emergency-restore` },
        data: proposal(
          "F.prize.name",
          CHANGED_VALUE,
          original,
          `${RUN_ID} finally 恢复 F1 展示文案`,
        ),
      });
      const recoveryBody = await envelope<Ticket>(recovery);
      if (recoveryBody.code === 0) {
        const recoveryId = ticketId(recoveryBody);
        const approved = await checker.request.post(
          `/api/admin/platform/audit/operations/${encodeURIComponent(recoveryId)}/approve`,
          {
            headers: { "Idempotency-Key": `${RUN_ID}-f-emergency-restore-approve` },
            data: { reason: `${RUN_ID} finally checker 精确恢复` },
          },
        );
        expect((await envelope(approved)).code).toBe(0);
      }
    }
    if (!changedApplied && changeOperationId) {
      const pending = await checker.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(changeOperationId)}/reject`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-f-pending-finally-${Date.now()}` },
          data: { reason: `${RUN_ID} finally 清理未执行的 F1 验收提案` },
        },
      );
      const pendingBody = await envelope(pending);
      if (pendingBody.code !== 0 && pendingBody.code !== 409) {
        throw new Error(`F pending cleanup failed: ${JSON.stringify(pendingBody)}`);
      }
    }
    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(result, null, 2));
    await makerContext.close();
    await checkerContext.close();
    await superContext.close();
  }
});

async function submitPrizeThroughF1(page: Page, value: string, reason: string) {
  await openF1FromSidebar(page);
  await page.getByRole("button", { name: /修改奖品名|配置奖品名/ }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await success<Ticket>(await responsePromise, "submit F1 proposal");
  await expect(dialog).toHaveCount(0);
  return String(body.id ?? body.operationId ?? "");
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr")
    .filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) })
    .first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await success(await responsePromise, `approve ${operationId}`);
  await expect(row).toHaveCount(0);
}

async function readPrizeName(page: Page) {
  const overview = await success<F1Overview>(
    await page.request.get("/api/admin/teams/ranks"),
    "read F1 overview",
  );
  return overview.configValues?.["F.prize.name"] ?? "";
}

async function openF1FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /分销与团队\s+F|F\s+分销与团队/ }).first();
  const link = page.locator('a[href="/network/v-rank"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/network\/v-rank$/);
  await expect(page.getByRole("heading", { name: "V-Rank 晋升", exact: true })).toBeVisible();
}

function proposal(key: string, before: string, after: string, reason: string) {
  return {
    action: `网络 UI 开关/文案配置 · ${key}`,
    obj: key,
    beforeValue: before,
    afterValue: after,
    operator: "server-authenticated",
    operatorRole: "增长",
    type: "param",
    amplifies: false,
    sos: false,
    roleGate: "门槛者",
    reason,
    sourceDomain: key.startsWith("F.binary.") || key.startsWith("F3.")
      ? "F3"
      : key.startsWith("F.pool.") || key.startsWith("F.quota.")
        || key.startsWith("F.ambassador.") || key.startsWith("F.leaderboard.")
        ? "F4"
        : key.startsWith("F.unilevel.") || key.startsWith("F.promo.")
          || key.startsWith("F.peer.") || key.startsWith("F.influence.")
          || key.startsWith("F.royalty.") || key === "F.cooldown"
          ? "F2"
          : "F1",
    command: { domain: "F", op: "f_ui_config", params: { key, value: after } },
    target: { domain: "F", type: "ui_config", id: key },
  };
}

function ticketId(body: Envelope<Ticket>) {
  const id = String(body.data?.id ?? body.data?.operationId ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(
    process.env.ADMIN_E2E_USERNAME ?? "superadmin",
  );
  await page.locator('input[autocomplete="current-password"]').fill(
    process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456",
  );
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, account: Account, key: string) {
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

async function success<T>(response: APIResponse | { status(): number; json(): Promise<unknown> }, label: string) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function envelope<T = unknown>(response: APIResponse) {
  return await response.json() as Envelope<T>;
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
