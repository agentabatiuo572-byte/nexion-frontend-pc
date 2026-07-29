import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = { id?: string; operationId?: string; status?: string };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const A_FIXTURE = JSON.parse(readFileSync(
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`,
  "utf8",
)) as { accounts: { d_maker: Account; d_checker: Account } };
const EVIDENCE_DIR =
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/cross-authority`;

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("D 域 maker 不得凭 A2 proposal_create 越权创建 F 配置提案", async ({ browser }) => {
  test.setTimeout(120_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const observer = await observerContext.newPage();
  let leakedOperationId = "";

  try {
    await loginSuperadmin(observer);
    const ranks = await success<{ configValues?: Record<string, string> }>(
      await observer.request.get("/api/admin/teams/ranks"),
      "read F1",
    );
    const original = ranks.configValues?.["F.prize.name"] ?? "";
    expect(original).not.toBe("");

    await login(maker, A_FIXTURE.accounts.d_maker, "d_maker");
    const response = await maker.request.post("/api/admin/platform/audit/operations", {
      headers: { "Idempotency-Key": `${RUN_ID}-f-cross-authority` },
      data: proposal("F.prize.name", original, `${RUN_ID} 跨域权限负向验收，不得创建`),
    });
    const body = await envelope<Ticket>(response);
    leakedOperationId = String(body.data?.id ?? body.data?.operationId ?? "");

    writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
      runId: RUN_ID,
      operator: A_FIXTURE.accounts.d_maker.username,
      operatorDomain: "D",
      targetDomain: "F",
      httpStatus: response.status(),
      code: body.code,
      message: body.message,
      leakedOperationId,
    }, null, 2));

    expect(
      response.status() === 403 || body.code === 403,
      `cross-domain F proposal must be forbidden: ${JSON.stringify(body)}`,
    ).toBe(true);
  } finally {
    if (leakedOperationId) {
      await login(checker, A_FIXTURE.accounts.d_checker, "d_checker");
      const rejected = await checker.request.post(
        `/api/admin/platform/audit/operations/${encodeURIComponent(leakedOperationId)}/reject`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-f-cross-authority-cleanup` },
          data: { reason: `${RUN_ID} 清理跨域越权负向验收产生的待审票` },
        },
      );
      const body = await envelope(rejected);
      expect(body.code, `cleanup ${JSON.stringify(body)}`).toBe(0);
    }
    await makerContext.close();
    await checkerContext.close();
    await observerContext.close();
  }
});

function proposal(key: string, value: string, reason: string) {
  return {
    action: "F 域跨域权限负向验收",
    obj: key,
    beforeValue: value,
    afterValue: value,
    operator: "ignored-server-authenticated",
    operatorRole: "finance",
    type: "param",
    amplifies: false,
    sos: false,
    roleGate: "门槛者",
    reason,
    sourceDomain: "F",
    command: { domain: "F", op: "f_ui_config", params: { key, value } },
    target: { domain: "F", type: "ui_config", id: key },
  };
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

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await page.locator('input[autocomplete="username"]').fill(
    process.env.ADMIN_E2E_USERNAME ?? "superadmin",
  );
  await page.locator('input[autocomplete="current-password"]').fill(
    process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456",
  );
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function success<T>(response: APIResponse, label: string) {
  const body = await envelope<T>(response);
  expect(response.ok(), `${label}: ${JSON.stringify(body)}`).toBe(true);
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
