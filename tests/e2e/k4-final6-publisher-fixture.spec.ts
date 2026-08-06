import { createHash, createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Creates exactly one normal-MFA SUPER_ADMIN for the K4 publisher-only
 * boundary.  It intentionally uses visible A1/A6 screens and never touches a
 * K business endpoint or table.  Credentials are read only from the existing
 * restricted Final6 A fixture and are never written to console output.
 */
const RUN_ID = "pc-full-acceptance-20260729-114336";
const LOCK = "K4_FIXTURE_FINAL6_20260801T1500JST";
const EVIDENCE_DIR = `D:/workspace/bug-pic/.restricted/${RUN_ID}/K/final6-k4-publisher-fixture`;
const MANIFEST_PATH = `${EVIDENCE_DIR}/k4-publisher.restricted.json`;
const SAFE_PATH = `${EVIDENCE_DIR}/k4-publisher-safe.json`;
const LOCK_PATH = `${EVIDENCE_DIR}/K4_PUBLISHER_FIXTURE_LOCK.json`;
const CREATOR_MANIFEST = `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/final6-owner/fixture/final6-a002-manifest.json`;
const BASE_URL = "http://127.0.0.1:3002";
const EXPECTED_BUILD = "njacAG-OYV84-mfOdWA9v";
const EXPECTED_JAR = "93A9B39EB8C3F1F9C425D34F6D68ECBCEEF87744794A0F7D684C14F0307AF92C";
const consumed = new Map<string, string>();

type Credentials = { username: string; password: string; totpSecret: string };
type Session = { username?: string; roleCode?: string; authorities?: string[]; menuCodes?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> };
type Envelope<T> = { code?: number; data?: T; message?: string };

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("K4 Final6: visible A1/A6 provisions one normal-MFA SUPER_ADMIN publisher", async ({ page, browser }) => {
  expect(process.env.K4_PUBLISHER_FIXTURE_SETUP).toBe("1");
  expect(process.env.K4_PUBLISHER_FIXTURE_LOCK).toBe(LOCK);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await acquireLock();

  const candidate = await verifyCandidate();
  const safe: Record<string, unknown> = {
    runId: RUN_ID, lock: LOCK, startedAt: new Date().toISOString(),
    candidate, source: "visible A1/A6; no K business write", cleanupState: "not-created",
  };
  let creator: Credentials | undefined;
  let created: { id: string; username: string } | undefined;
  try {
    creator = await loginAnyFinal6Super(page);
    await assertSuperK4Authority(page, creator.username);
    await nav(page, "角色管理 A6", /\/platform\/roles$/);
    await expect(page.getByText("超级管理员", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);

    const nonce = randomBytes(6).toString("hex");
    const username = `ffix.k4.publisher.${nonce}`.slice(0, 32);
    created = await createSuperUi(page, username, `K4发布者 ${nonce}`);
    const temporaryPassword = await takeTemporaryPassword(page);
    const finalPassword = `Nx!K4Pub${randomBytes(18).toString("base64url")}Aa`;
    const context = await browser.newContext();
    let publisher: Credentials;
    try {
      const publisherPage = await context.newPage();
      const totpSecret = await activateMfa(publisherPage, username, temporaryPassword, finalPassword);
      await assertSuperK4Authority(publisherPage, username);
      await nav(publisherPage, "角色管理 A6", /\/platform\/roles$/);
      await expect(publisherPage.getByText("超级管理员", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
      await logout(publisherPage);
      publisher = { username, password: finalPassword, totpSecret };
    } finally {
      await context.close();
    }

    const manifest = {
      sensitive: true, doNotUpload: true, runId: RUN_ID, lock: LOCK, generatedAt: new Date().toISOString(),
      candidate, allowedConsumers: ["root", "K Owner"], purpose: "K4 publisher-only; backend requires SUPER_ADMIN plus risk_k4_write",
      publisher: { accountId: created.id, ...publisher },
      cleanupPlan: [
        "after K4 closure, use an independent SUPER_ADMIN through visible A1",
        "revoke publisher sessions, disable account, reset MFA, unassign the SUPER_ADMIN role, then delete or soft-delete the run-scoped account",
        "read back A1 account state, sessions=0, MFA=false, no active role relation and no run-scoped pending A2/object lock/idempotency residue",
      ],
    };
    await atomicJson(MANIFEST_PATH, manifest);
    safe.cleanupState = "retained-for-root-and-k-owner";
    safe.publisher = { accountId: created.id, usernameSha256: sha(username), roleCode: "SUPER_ADMIN", mfa: true, riskK4Write: true };
    safe.manifestSha256 = sha(JSON.stringify(manifest));
    safe.finishedAt = new Date().toISOString();
  } catch (error) {
    safe.error = error instanceof Error ? error.message : String(error);
    if (created && creator) {
      safe.cleanupState = await disablePartialUi(page, creator, created.username);
    }
    throw error;
  } finally {
    await atomicJson(SAFE_PATH, safe);
  }
});

async function acquireLock() {
  try {
    await writeFile(LOCK_PATH, JSON.stringify({ lock: LOCK, owner: "L->K repair", acquiredAt: new Date().toISOString() }, null, 2), { flag: "wx" });
  } catch {
    // A launcher interruption may occur after the lock is safely acquired but
    // before any A1 write.  Only that exact owner/token may resume; any other
    // lock is fail-closed.
    const existing = JSON.parse(await readFile(LOCK_PATH, "utf8")) as { lock?: string; owner?: string };
    if (existing.lock !== LOCK || existing.owner !== "L->K repair") throw new Error("K4_PUBLISHER_FIXTURE_LOCK_ALREADY_HELD");
  }
}

async function verifyCandidate() {
  const build = (await readFile("D:/workspace/nexion-ops-console/.next/BUILD_ID", "utf8")).trim();
  expect(build).toBe(EXPECTED_BUILD);
  const hash = await sha256File("D:/workspace/nexion-backend/target/nexion-backend-0.0.1-SNAPSHOT.jar");
  expect(hash).toBe(EXPECTED_JAR);
  return { buildId: build, backendJarSha256: hash, pcPort: 3002, backendPort: 8110 };
}

async function sha256File(file: string) { return createHash("sha256").update(await readFile(file)).digest("hex").toUpperCase(); }
function sha(value: string) { return createHash("sha256").update(value).digest("hex").toUpperCase(); }
async function atomicJson(file: string, value: unknown) { const temp = `${file}.${process.pid}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }

async function loginAnyFinal6Super(page: Page) {
  const source = JSON.parse(await readFile(CREATOR_MANIFEST, "utf8")) as { actors?: Record<string, Credentials> };
  for (const item of Object.values(source.actors ?? {})) {
    if (!item?.username || !item?.password || !item?.totpSecret) continue;
    if (await login(page, item).catch(() => false)) return item;
  }
  throw new Error("FINAL6_A_CREATOR_UNAVAILABLE");
}

async function login(page: Page, credential: Credentials) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(credential.username);
  await page.locator('input[autocomplete="current-password"]').fill(credential.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 3_000 }).catch(() => false)) await verifyTotp(page, credential.totpSecret);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return true;
}

async function verifyTotp(page: Page, secret: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining <= 4_000) await page.waitForTimeout(remaining + 750);
    let code = totp(secret); while (code === consumed.get(secret)) { await page.waitForTimeout(1_100); code = totp(secret); }
    consumed.set(secret, code);
    await page.getByLabel("一次性验证码").fill(code);
    const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    if ((await response).status() === 200) return;
  }
  throw new Error("MFA_VERIFY_FAILED");
}

async function activateMfa(page: Page, username: string, temporaryPassword: string, finalPassword: string) {
  await page.goto(BASE_URL); await page.locator('input[autocomplete="username"]').fill(username); await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const secret = ((await page.locator("code").first().textContent()) ?? "").trim(); expect(secret).not.toBe("");
  await verifyTotp(page, secret);
  await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill(finalPassword); await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click(); await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return secret;
}

async function createSuperUi(page: Page, username: string, displayName: string) {
  await expect(page.getByRole("button", { name: "+ 新建账号", exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click(); const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username); await dialog.getByPlaceholder("姓名,如:张三").fill(displayName);
  await dialog.getByText("超级管理员", { exact: true }).click(); await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} K4 publisher-only normal-MFA SUPER_ADMIN fixture`);
  const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/admin/platform/accounts"));
  await dialog.getByRole("button", { name: "确认创建账号", exact: true }).click(); const confirmation = page.getByRole("dialog").last();
  await confirmation.getByLabel(/操作理由/).fill(`${RUN_ID} K4 publisher-only normal-MFA SUPER_ADMIN fixture`); await confirmation.getByRole("button", { name: "确认提交", exact: true }).click();
  const body = await ok<{ id?: string | number }>(await response); expect(body.id).toBeTruthy(); return { id: String(body.id), username };
}

async function takeTemporaryPassword(page: Page) { const dialog = page.getByRole("dialog").last(); await expect(dialog.getByText("临时密码", { exact: true })).toBeVisible(); const value = ((await dialog.locator(".mono").last().textContent()) ?? "").trim(); expect(value).not.toBe(""); await dialog.getByText("关闭", { exact: true }).click(); return value; }
async function assertSuperK4Authority(page: Page, username: string) {
  const data = await ok<{ session?: Session }>(await page.request.get("/api/admin/auth/session")); const session = data.session ?? {};
  expect(session.username).toBe(username); expect(session.roleCode).toBe("SUPER_ADMIN"); expect(session.authorities ?? []).toContain("risk_k4_write");
  const menus = (session.menuCodes ?? session.effectiveMenus?.map((x) => typeof x === "string" ? x : x.menuCode ?? "") ?? []); expect(menus).toContain("A1"); expect(menus).toContain("A6"); expect(menus).toContain("K4");
}
async function nav(page: Page, name: string, target: RegExp) { const link = page.locator("aside").getByRole("link", { name, exact: true }); if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click(); await link.click(); await expect(page).toHaveURL(target); }
async function logout(page: Page) { const account = page.locator('header button[aria-haspopup="menu"]').first(); await account.click(); await page.getByRole("button", { name: "退出登录", exact: true }).last().click(); await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 10_000 }); }
async function disablePartialUi(page: Page, creator: Credentials, username: string) { try { await login(page, creator); await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/); const row = page.locator("tbody tr").filter({ hasText: username }); if (!await row.count()) return "partial-account-not-found"; const disable = row.getByRole("button", { name: "禁用", exact: true }); if (await disable.count()) { await disable.click(); const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} failed K4 publisher fixture cleanup`); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); } return "partial-account-disabled"; } catch { return "partial-account-cleanup-manual-required"; } }
async function ok<T>(response: { ok(): boolean; json(): Promise<unknown> }) { const body = await response.json() as Envelope<T>; expect(response.ok(), JSON.stringify(body)).toBeTruthy(); expect(body.code).toBe(0); return body.data as T; }
function totp(secret: string) { const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase(); let bits = ""; for (const c of raw) bits += alphabet.indexOf(c).toString(2).padStart(5, "0"); const bytes: number[] = []; for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2)); const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000))); const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15; return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0"); }
