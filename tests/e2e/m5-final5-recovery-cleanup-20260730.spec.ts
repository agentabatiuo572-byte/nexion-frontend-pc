import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = {
  accountId?: string;
  id?: string;
  username: string;
  password: string;
  totpSecret: string;
};

type Manifest = {
  account?: Account;
  supportSupervisor?: Account;
  accounts?: { supportSupervisor?: Account; m_support_supervisor?: Account };
  finalAccounts?: { m_support_supervisor?: Account };
};

type Envelope<T> = { code?: number; data?: T; message?: string };
type Content = { id: string; status: string; text?: string };
type Versions = { messageKey: string; status: string; version: string };
type Conversation = { conversationNo: string; status: string; version: number; lastMessage?: string };

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const PREFIX = requiredEnv("M5_RECOVERY_PREFIX");
const SUPPORT = accountFrom(requiredEnv("M5_SUPPORT_MANIFEST_PATH"));
const ROOT = accountFrom(requiredEnv("M5_RECOVERY_ROOT_MANIFEST_PATH"));
const EVIDENCE_DIR = path.resolve(requiredEnv("M5_RECOVERY_EVIDENCE_DIR"));
const RESULT_PATH = path.join(EVIDENCE_DIR, "m5-final5-recovery-result.restricted.json");
const usedTotpSteps = new Map<string, number>();

test.use({ trace: "on-first-retry", video: "off", screenshot: "only-on-failure" });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(process.env.M5_CATEGORY_LOCK).toBe(`${process.env.M_FINAL2_RUN_ID}:M5C`);
  expect(process.env.M5_POLICY_LOCK).toBe(`${process.env.M_FINAL2_RUN_ID}:M5P`);
  expect(process.env.I6_LOCK).toBe(`${process.env.M_FINAL2_RUN_ID}:I6`);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("recover every active M5/I6 object left by an interrupted Final5 carrier", async ({ browser }) => {
  const result: {
    prefix: string;
    scripts: Content[];
    templates: Content[];
    mirrors: Versions[];
    conversations: Conversation[];
    errors: string[];
  } = { prefix: PREFIX, scripts: [], templates: [], mirrors: [], conversations: [], errors: [] };

  const support = await browser.newContext({ baseURL: BASE_URL });
  const supportPage = await support.newPage();
  try {
    await login(supportPage, SUPPORT);
    result.scripts = await listContent(supportPage, "scripts");
    result.templates = await listContent(supportPage, "reply-templates");
    for (const row of [...result.scripts, ...result.templates]) {
      if (row.status.toLowerCase() === "archived") continue;
      const kind = result.scripts.some((item) => item.id === row.id) ? "scripts" : "reply-templates";
      const archived = await ok<Content>(await supportPage.request.patch(
        `/api/admin/content/session-templates/${kind}/${encodeURIComponent(row.id)}/status`,
        {
          headers: { "Idempotency-Key": `${PREFIX}-RECOVERY-${kind}-${row.id}-${Date.now()}` },
          data: {
            status: "archived",
            expectedStatus: row.status,
            reason: `${PREFIX}-中断载具精确恢复归档`,
            operator: SUPPORT.username,
          },
        },
      ));
      expect(archived.status).toBe("archived");
    }
    result.scripts = await listContent(supportPage, "scripts");
    result.templates = await listContent(supportPage, "reply-templates");
    expect(result.scripts.every((row) => row.status.toLowerCase() === "archived")).toBe(true);
    expect(result.templates.every((row) => row.status.toLowerCase() === "archived")).toBe(true);
    result.conversations = await listConversations(supportPage);
    for (const row of result.conversations) {
      let current = row;
      if (current.status === "OPEN") {
        current = await ok<Conversation>(await supportPage.request.patch(
          `/api/admin/content/conversations/${encodeURIComponent(current.conversationNo)}/status`,
          {
            headers: { "Idempotency-Key": `${PREFIX}-RECOVERY-M3-RESOLVE-${current.conversationNo}-${Date.now()}` },
            data: {
              status: "RESOLVED",
              expectedStatus: current.status,
              expectedVersion: current.version,
              reason: `${PREFIX}-中断载具精确解决会话`,
              operator: SUPPORT.username,
            },
          },
        ));
      }
      if (current.status === "RESOLVED") {
        current = await ok<Conversation>(await supportPage.request.patch(
          `/api/admin/content/conversations/${encodeURIComponent(current.conversationNo)}/archive`,
          {
            headers: { "Idempotency-Key": `${PREFIX}-RECOVERY-M3-ARCHIVE-${current.conversationNo}-${Date.now()}` },
            data: {
              archived: true,
              expectedStatus: current.status,
              expectedVersion: current.version,
              reason: `${PREFIX}-中断载具精确归档会话`,
              operator: SUPPORT.username,
            },
          },
        ));
      }
      expect(current.status).toBe("CLOSED");
    }
    result.conversations = await listConversations(supportPage);
    expect(result.conversations.every((row) => row.status === "CLOSED")).toBe(true);
  } catch (error) {
    result.errors.push(`M5:${String(error)}`);
  } finally {
    await logout(supportPage).catch(() => undefined);
    await support.close().catch(() => undefined);
  }

  const root = await browser.newContext({ baseURL: BASE_URL });
  const rootPage = await root.newPage();
  try {
    await login(rootPage, ROOT);
    for (const row of [...result.scripts, ...result.templates]) {
      const kind = result.scripts.some((item) => item.id === row.id) ? "script" : "template";
      const key = `conversation.${kind}.${row.id.toLowerCase()}`;
      const versions = await ok<Versions[]>(
        await rootPage.request.get(`/api/admin/content/i18n-learning/messages/${encodeURIComponent(key)}/versions`),
      );
      const latest = versions[0];
      if (!latest) continue;
      if (latest.status.toLowerCase() !== "archived") {
        await ok<Versions>(await rootPage.request.delete(
          `/api/admin/content/i18n-learning/messages/${encodeURIComponent(key)}`,
          {
            headers: { "Idempotency-Key": `${PREFIX}-RECOVERY-I6-${kind}-${row.id}-${Date.now()}` },
            data: {
              expectedVersion: latest.version,
              reason: `${PREFIX}-中断载具精确恢复多语镜像`,
              operator: ROOT.username,
            },
          },
        ));
      }
      const after = await ok<Versions[]>(
        await rootPage.request.get(`/api/admin/content/i18n-learning/messages/${encodeURIComponent(key)}/versions`),
      );
      expect(after[0]?.status).toBe("archived");
      result.mirrors.push(...after.filter((item) => item.messageKey === key));
    }
  } catch (error) {
    result.errors.push(`I6:${String(error)}`);
  } finally {
    await logout(rootPage).catch(() => undefined);
    await root.close().catch(() => undefined);
  }

  writeFileSync(RESULT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  expect(result.errors).toEqual([]);
});

async function listContent(page: Page, kind: "scripts" | "reply-templates") {
  const data = await ok<{ records?: Content[] }>(await page.request.get(
    `/api/admin/content/session-templates/${kind}?pageNum=1&pageSize=100&keyword=${encodeURIComponent(PREFIX)}`,
  ));
  return (data.records ?? []).filter((row) => String(row.text ?? "").includes(PREFIX));
}

async function listConversations(page: Page) {
  const data = await ok<{ records?: Conversation[] }>(await page.request.get(
    `/api/admin/content/conversations?pageNum=1&pageSize=100&keyword=${encodeURIComponent(PREFIX)}`,
  ));
  return (data.records ?? []).filter((row) => String(row.lastMessage ?? "").includes(PREFIX));
}

async function login(page: Page, account: Account) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await waitForLoginHydration(page);
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 20_000 });
  await otp.fill(await freshTotp(account.username, account.totpSecret));
  const mfaResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await mfaResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function waitForLoginHydration(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector("form");
    return form
      ? Object.keys(form).some((key) => key.startsWith("__reactProps$"))
      : false;
  }, undefined, { timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  if (!await account.isVisible().catch(() => false)) return;
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function ok<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

function accountFrom(manifestPath: string) {
  expect(/bug-pic[\\/]\.restricted[\\/]/i.test(manifestPath)).toBe(true);
  const manifest = JSON.parse(readFileSync(path.resolve(manifestPath), "utf8")) as Manifest;
  const account = manifest.supportSupervisor
    ?? manifest.account
    ?? manifest.accounts?.supportSupervisor
    ?? manifest.accounts?.m_support_supervisor
    ?? manifest.finalAccounts?.m_support_supervisor;
  if (!account?.username || !account.password || !account.totpSecret) {
    throw new Error(`restricted account manifest is incomplete: ${manifestPath}`);
  }
  return account;
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function freshTotp(username: string, secret: string) {
  const previousStep = usedTotpSteps.get(username);
  let currentStep = Math.floor(Date.now() / 30_000);
  if (previousStep !== undefined && currentStep <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 1_000));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  currentStep = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(username, currentStep);
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
