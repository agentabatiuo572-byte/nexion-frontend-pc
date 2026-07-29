import { createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type DownloadCopy = {
  url: string;
  zhTitle: string;
  zhGuide: string;
  enTitle: string;
  enGuide: string;
};
type AdminE6 = { download: DownloadCopy };
type PublicPlatform = { computerCompute: { download: DownloadCopy } };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const MARKER = " [E6-NONOWNER-D]";
const A_FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const E6_MAKER_FIXTURE_PATH = process.env.E6_MAKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/e6-maker-fixture.json`;
const EVIDENCE_DIR = process.env.E6_NONOWNER_D_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/nonowner-D/e6-terminal`;
const checkerFixture = JSON.parse(readFileSync(A_FIXTURE_PATH, "utf8")) as {
  accounts: { d_checker: Account };
};

const DOWNLOAD_KEYS = {
  zhTitle: "E.compute.download.zhTitle",
  zhGuide: "E.compute.download.zhGuide",
  enTitle: "E.compute.download.enTitle",
  enGuide: "E.compute.download.enGuide",
} as const;

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("E6 独立 maker、双 checker CAS、幂等、A2/A4 与 App 公共配置投影后精确恢复", async ({ browser }) => {
  const makerFixture = JSON.parse(readFileSync(E6_MAKER_FIXTURE_PATH, "utf8")) as {
    account: Account;
  };
  const makerContext = await browser.newContext();
  const checkerAContext = await browser.newContext();
  const checkerBContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checkerA = await checkerAContext.newPage();
  const checkerB = await checkerBContext.newPage();
  let original: DownloadCopy | null = null;
  let changed: DownloadCopy | null = null;
  let changeOperationId = "";
  let restoreOperationId = "";
  let changedApplied = false;
  const result: Record<string, unknown> = {
    runId: RUN_ID,
    module: "E6",
    independentMakerAndCheckers: true,
  };

  try {
    await loginMfa(maker, makerFixture.account, "e6_maker");
    await loginMfa(checkerA, checkerFixture.accounts.d_checker, "d_checker");
    await loginSuperadmin(checkerB);

    original = (await readAdminE6(checkerB)).download;
    expect(original.zhGuide).not.toContain(MARKER);
    changed = { ...original, zhGuide: `${original.zhGuide}${MARKER}` };

    const commandKey = `${RUN_ID}-e6-change-${randomUUID()}`;
    const proposalBody = buildProposalBody(
      makerFixture.account.username,
      changed,
      `${RUN_ID} E6 非Owner双checker CAS前向并预置精确恢复`,
    );
    const created = await postProposal(maker, commandKey, proposalBody);
    changeOperationId = operationId(created.body);
    result.changeOperationId = changeOperationId;

    const replay = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": commandKey },
      data: proposalBody,
    });
    const replayBody = await envelope<Record<string, unknown>>(replay);
    expect(replay.status()).toBe(200);
    expect(operationId(replayBody)).toBe(changeOperationId);

    const mismatch = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": commandKey },
      data: { ...proposalBody, reason: `${proposalBody.reason}（同键异载荷必须拒绝）` },
    });
    expect(mismatch.status()).toBe(409);

    const [checkerAResponse, checkerBResponse] = await Promise.all([
      approve(checkerA, changeOperationId, `${RUN_ID}-e6-checker-a-${randomUUID()}`, "A checker 并发批准"),
      approve(checkerB, changeOperationId, `${RUN_ID}-e6-checker-b-${randomUUID()}`, "superadmin checker 并发批准"),
    ]);
    const raceStatuses = [checkerAResponse.status(), checkerBResponse.status()].sort((a, b) => a - b);
    expect(raceStatuses).toEqual([200, 409]);
    const winningChecker = checkerAResponse.status() === 200
      ? checkerFixture.accounts.d_checker.username
      : "superadmin";
    result.checkerRace = { statuses: raceStatuses, winningChecker };

    expect((await readAdminE6(checkerB)).download.zhGuide).toBe(changed.zhGuide);
    changedApplied = true;
    await openE6FromSidebar(checkerB);
    await expect(checkerB.getByText(changed.zhGuide, { exact: true })).toBeVisible();
    const publicChanged = await readPublicPlatform(checkerB);
    expect(publicChanged.computerCompute.download.zhGuide).toBe(changed.zhGuide);
    await checkerB.screenshot({ path: path.join(EVIDENCE_DIR, "01-e6-pc-and-public-projection-changed.png"), fullPage: true });

    const restoreKey = `${RUN_ID}-e6-restore-${randomUUID()}`;
    const restoreBody = buildProposalBody(
      makerFixture.account.username,
      original,
      `${RUN_ID} E6 非Owner按运行前公共配置快照精确恢复`,
    );
    const restoreCreated = await postProposal(maker, restoreKey, restoreBody);
    restoreOperationId = operationId(restoreCreated.body);
    result.restoreOperationId = restoreOperationId;
    const restoredResponse = await approve(
      checkerA,
      restoreOperationId,
      `${RUN_ID}-e6-restore-approve-${randomUUID()}`,
      "独立 checker 核对原快照后批准恢复",
    );
    expect(restoredResponse.status()).toBe(200);

    expect((await readAdminE6(checkerB)).download).toEqual(original);
    changedApplied = false;
    const publicRestored = await readPublicPlatform(checkerB);
    expect(publicRestored.computerCompute.download).toEqual(original);
    await checkerB.reload({ waitUntil: "domcontentloaded" });
    await expect(checkerB.getByText(original.zhGuide, { exact: true })).toBeVisible();
    await expect(checkerB.getByText(changed.zhGuide, { exact: true })).toHaveCount(0);

    const audit = await checkerB.request.get(
      `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(changeOperationId)}&limit=200`,
    );
    const events = await checkerB.request.get("/api/admin/platform/events/overview");
    expect(audit.status()).toBe(200);
    expect(events.status()).toBe(200);
    result.idempotency = {
      sameKeySamePayload: 200,
      sameOperationId: true,
      sameKeyDifferentPayload: 409,
    };
    result.pcAndAppPublicProjection = { changed: true, restored: true };
    result.a2AuditStatus = audit.status();
    result.a4OverviewStatus = events.status();
    result.restoredExact = true;
    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(result, null, 2));
  } finally {
    if (changedApplied && original) {
      const emergencyBody = buildProposalBody(
        makerFixture.account.username,
        original,
        `${RUN_ID} E6 finally 安全恢复`,
      );
      const emergency = await postProposal(
        maker,
        `${RUN_ID}-e6-finally-${randomUUID()}`,
        emergencyBody,
      ).catch(() => null);
      if (emergency) {
        await approve(
          checkerA,
          operationId(emergency.body),
          `${RUN_ID}-e6-finally-approve-${randomUUID()}`,
          "finally 独立恢复",
        ).catch(() => undefined);
      }
    }
    if (!result.restoredExact) {
      writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify(result, null, 2));
    }
    await makerContext.close();
    await checkerAContext.close();
    await checkerBContext.close();
  }
});

function buildProposalBody(operator: string, values: DownloadCopy, reason: string) {
  const commandValues = {
    [DOWNLOAD_KEYS.zhTitle]: values.zhTitle,
    [DOWNLOAD_KEYS.zhGuide]: values.zhGuide,
    [DOWNLOAD_KEYS.enTitle]: values.enTitle,
    [DOWNLOAD_KEYS.enGuide]: values.enGuide,
  };
  return {
    action: "编辑下载页双语文案",
    obj: Object.keys(commandValues).sort().join(","),
    beforeValue: "批量配置变更前",
    afterValue: "批量配置待审批",
    operator,
    operatorRole: "财务",
    type: "param",
    amplifies: false,
    sos: false,
    roleGate: "门槛者",
    reason,
    sourceDomain: "E6",
    command: {
      domain: "E",
      op: "e6_compute_config_batch",
      params: { values: commandValues },
    },
    targets: Object.keys(commandValues)
      .sort()
      .map((id) => ({ domain: "E", type: "e6_compute_config", id })),
  };
}

async function postProposal(page: Page, commandKey: string, body: Record<string, unknown>) {
  const response = await page.request.post("/api/admin/platform/audit/operations", {
    headers: { "Idempotency-Key": commandKey },
    data: body,
  });
  const responseBody = await envelope<Record<string, unknown>>(response);
  expect(response.status(), JSON.stringify(responseBody)).toBe(200);
  expect(responseBody.code).toBe(0);
  return { response, body: responseBody };
}

async function approve(page: Page, operation: string, commandKey: string, reason: string) {
  return await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operation)}/approve`,
    {
      headers: { "Idempotency-Key": commandKey },
      data: { reason: `${RUN_ID} ${reason}` },
    },
  );
}

async function readAdminE6(page: Page) {
  const response = await page.request.get("/api/admin/devices/compute-config");
  const body = await envelope<AdminE6>(response);
  expect(response.status()).toBe(200);
  expect(body.code).toBe(0);
  return body.data!;
}

async function readPublicPlatform(page: Page) {
  const response = await page.request.get("http://127.0.0.1:8110/api/config/platform");
  const body = await envelope<PublicPlatform>(response);
  expect(response.status()).toBe(200);
  expect(body.code).toBe(0);
  return body.data!;
}

async function openE6FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
  const link = page.locator('a[href="/devices/compute-config"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/devices\/compute-config$/);
  await expect(page.getByText("客户端下载配置", { exact: true }).first()).toBeVisible();
}

async function loginSuperadmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await shellVisible(page, 2_000)) {
    await expectSessionUsername(page, "superadmin");
    return;
  }
  await page.locator('input[autocomplete="username"]').fill("superadmin");
  await page.locator('input[autocomplete="current-password"]').fill("Admin@123456");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  await expectSessionUsername(page, "superadmin");
}

async function loginMfa(page: Page, account: Account, key: string) {
  // J-AUTO-003: skip the possibly already accepted counter from fixture setup.
  // Each failed verification is retried only after clearing its challenge cookies.
  lastTotpStep.set(key, Math.floor(Date.now() / 30_000));
  let lastStatus = 0;
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0) await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await shellVisible(page, 2_000)) {
      await expectSessionUsername(page, account.username);
      return;
    }
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const passwordRequest = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const passwordResponse = await passwordRequest;
    const passwordBody = await envelope(passwordResponse);
    expect(passwordBody?.code).toBe(0);
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 15_000 });
    await otp.fill(await freshTotp(key, account.totpSecret));
    const verify = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verify;
    const body = await envelope(response);
    lastStatus = response.status();
    lastCode = body?.code;
    if (response.status() === 200) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      if (await shellVisible(page, 20_000)) {
        await expectSessionUsername(page, account.username);
        return;
      }
    }
  }
  throw new Error(`${key} login failed status=${lastStatus} code=${lastCode ?? "none"}`);
}

async function expectSessionUsername(page: Page, username: string) {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await envelope<{ session?: { username?: string } }>(response);
  expect(response.status()).toBe(200);
  expect(body.data?.session?.username).toBe(username);
}

async function shellVisible(page: Page, timeout: number) {
  return await page.locator("aside")
    .waitFor({ state: "visible", timeout })
    .then(() => true)
    .catch(() => false);
}

function operationId(body: Envelope<Record<string, unknown>>) {
  const id = String(body.data?.operationId ?? body.data?.id ?? "");
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
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
  return currentTotp(secret, step);
}

function currentTotp(secret: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
