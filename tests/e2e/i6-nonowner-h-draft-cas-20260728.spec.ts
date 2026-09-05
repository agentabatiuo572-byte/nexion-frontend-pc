import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
  role?: string;
  authorities?: string[];
  effectiveMenus?: string[];
};

type PermissionFixture = {
  accounts?: {
    d_checker?: FixtureAccount;
  };
  checker?: FixtureAccount;
};

const FIXTURE_PATH = process.env.ADMIN_PERMISSION_FIXTURE;
if (!FIXTURE_PATH) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as PermissionFixture;
const checkerAccount = fixture.checker ?? fixture.accounts?.d_checker;
if (!checkerAccount) throw new Error("I6 CAS requires an independent checker account");
const expectedCheckerAuthorities = ["content_i6_read", "content_i6_write"];
const expectedCheckerMenus = ["I", "I6"];
if (
  !sameSet(checkerAccount.authorities ?? [], expectedCheckerAuthorities)
  || !sameSet(checkerAccount.effectiveMenus ?? [], expectedCheckerMenus)
) {
  throw new Error("I6 CAS checker fixture must contain only I6 read/write and I/I6 menus");
}
const DB_NAME = process.env.NEXION_ACCEPTANCE_DB || "nexion_acceptance_20260728_151023";
const DB_PASSWORD = process.env.NEXION_ACCEPTANCE_DB_PASSWORD;
if (!DB_PASSWORD) throw new Error("NEXION_ACCEPTANCE_DB_PASSWORD is required");
const MYSQL = process.env.NEXION_MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const SAFE_EVIDENCE_PATH = process.env.I6_CAS_SAFE_EVIDENCE
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/i6-checker-fixture/cas-safe.json";

test.use({ trace: "off", screenshot: "off", video: "off" });
test.describe.configure({ timeout: 180_000 });

test("I6 两名运营员同时编辑同一草稿时只能一方通过 CAS", async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const messageKey = `acceptance.i6.review_h_r151023_${suffix}`;
  const idempotencyPrefix = `i6-review-h-${suffix}`;
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  let safeEvidence: Record<string, unknown> | undefined;

  try {
    await login(maker, {
      username: process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin",
      password: (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()),
      totpSecret: process.env.ADMIN_E2E_TOTP_SECRET || "",
    });
    await openI6(maker);
    await saveDraftFromVisibleForm(maker, messageKey);

    await login(checker, checkerAccount);
    await openI6(checker);

    const makerBody = localizedBody(
      "运营员甲并发草稿",
      "Concurrent draft from operator A",
      "Bản nháp đồng thời từ nhân viên A",
      "v1",
      "superadmin",
      "I6 非 Owner 双运营员并发 CAS 验收甲",
    );
    const checkerBody = localizedBody(
      "运营员乙并发草稿",
      "Concurrent draft from operator B",
      "Bản nháp đồng thời từ nhân viên B",
      "v1",
      checkerAccount.username,
      "I6 非 Owner 双运营员并发 CAS 验收乙",
    );

    const [makerResponse, checkerResponse] = await Promise.all([
      maker.request.patch(`/api/admin/content/i18n-learning/messages/${messageKey}/draft`, {
        headers: { "Idempotency-Key": `${idempotencyPrefix}-maker` },
        data: makerBody,
      }),
      checker.request.patch(`/api/admin/content/i18n-learning/messages/${messageKey}/draft`, {
        headers: { "Idempotency-Key": `${idempotencyPrefix}-checker` },
        data: checkerBody,
      }),
    ]);
    const statuses = [makerResponse.status(), checkerResponse.status()].sort((a, b) => a - b);
    const bodies = [await makerResponse.json(), await checkerResponse.json()] as Array<{
      code?: number;
      message?: string;
      data?: { version?: string; status?: string };
    }>;
    safeEvidence = {
      runId: "pc-full-acceptance-20260729-114336",
      messageKeyHash: createHmac("sha256", "i6-cas-evidence").update(messageKey).digest("hex").slice(0, 12),
      statuses,
      results: bodies.map((body) => ({
        code: body.code,
        message: body.message,
        version: body.data?.version,
        status: body.data?.status,
      })),
      generatedAt: new Date().toISOString(),
    };
    test.info().attach("i6-draft-cas-result", {
      body: JSON.stringify(safeEvidence, null, 2),
      contentType: "application/json",
    });

    expect(statuses, "相同 v1 快照下的两个草稿更新只能一个提交成功").toEqual([200, 409]);
  } finally {
    cleanupMutableFixture(messageKey, idempotencyPrefix);
    if (safeEvidence) {
      safeEvidence.mutableFixtureCleanup = {
        messageRows: 0,
        versionRows: 0,
        idempotencyRows: 0,
      };
      mkdirSync(path.dirname(SAFE_EVIDENCE_PATH), { recursive: true });
      writeFileSync(SAFE_EVIDENCE_PATH, `${JSON.stringify(safeEvidence, null, 2)}\n`, "utf8");
    }
    await Promise.all([makerContext.close(), checkerContext.close()]);
  }
});

async function login(page: Page, account: FixtureAccount) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await username.fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await Promise.race([
      otp.waitFor({ state: "visible", timeout: 10_000 }),
      shell.waitFor({ state: "visible", timeout: 10_000 }),
    ]);
    if (await shell.isVisible().catch(() => false)) return;
    expect(account.totpSecret, "MFA account must provide a TOTP secret").not.toBe("");
    const totpCode = await freshTotp(account.totpSecret);
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await otp.fill(totpCode);
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (response.status() === 200) {
      await expect(shell).toBeVisible({ timeout: 20_000 });
      return;
    }
    failures.push(`${response.status()}:${payload?.message ?? "UNKNOWN"}`);
    if (payload?.message !== "ADMIN_MFA_CODE_REPLAYED") break;
  }
  throw new Error(`MFA verification failed without bypass: ${failures.join(",")}`);
}

async function openI6(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/content/i18n"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/content\/i18n(?:\?.*)?$/);
  await expect(page.getByText("I6 数据加载中...")).toHaveCount(0, { timeout: 20_000 });
}

async function saveDraftFromVisibleForm(page: Page, messageKey: string) {
  await page.getByRole("button", { name: "新增词条", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const form = dialog.locator('[data-business-form="localized-copy"]');
  await expect(form).toBeVisible();
  await form.locator('input[type="text"]').first().fill(messageKey);
  await form.locator("textarea").nth(0).fill("I6 非 Owner 初始中文草稿");
  await form.locator("textarea").nth(1).fill("Initial English draft for I6 non-owner");
  await form.locator("textarea").nth(2).fill("Bản nháp tiếng Việt ban đầu cho I6");
  await dialog.getByLabel(/操作理由\(必填/).fill("I6 非 Owner 创建隔离草稿用于双运营员并发验收");
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && response.url().includes(`/api/admin/content/i18n-learning/messages/${messageKey}/draft`),
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  expect((await saved).status()).toBe(200);
  await expect(dialog).toBeHidden();
}

function localizedBody(
  zh: string,
  en: string,
  vi: string,
  expectedVersion: string,
  operator: string,
  reason: string,
) {
  return { zh, en, vi, expectedVersion, operator, reason };
}

function cleanupMutableFixture(messageKey: string, idempotencyPrefix: string) {
  const escapedKey = sql(messageKey);
  const escapedPrefix = sql(idempotencyPrefix);
  mysql(`
    DELETE FROM nx_i18n_message_version WHERE message_key='${escapedKey}';
    DELETE FROM nx_i18n_message WHERE message_key='${escapedKey}';
    DELETE FROM nx_admin_idempotency_record
      WHERE scope='I6_I18N_DRAFT:${escapedKey}'
         OR idempotency_key LIKE '${escapedPrefix}%';
    DO SLEEP(2);
    DELETE FROM nx_i18n_message_version WHERE message_key='${escapedKey}';
    DELETE FROM nx_i18n_message WHERE message_key='${escapedKey}';
    DELETE FROM nx_admin_idempotency_record
      WHERE scope='I6_I18N_DRAFT:${escapedKey}'
         OR idempotency_key LIKE '${escapedPrefix}%';
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
         WHERE scope='I6_I18N_DRAFT:${escapedKey}'
            OR idempotency_key LIKE '${escapedPrefix}%');
  `);
}

function mysql(statement: string) {
  const output = execFileSync(MYSQL, [
    "-h", "127.0.0.1",
    "-uroot",
    `--password=${DB_PASSWORD}`,
    "-N", "-B",
    "-D", DB_NAME,
    "-e", statement,
  ], { encoding: "utf8" }).trim();
  const lastLine = output.split(/\r?\n/).at(-1);
  if (lastLine !== "0\t0\t0") {
    throw new Error(`I6 mutable fixture cleanup failed: ${lastLine}`);
  }
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function sameSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
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
