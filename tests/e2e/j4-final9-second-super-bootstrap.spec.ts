import { createHmac, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const runId = "pc-full-acceptance-20260729-114336";
const artifactRoot = "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/final9/bootstrap";
const usernames = ["acc_j4_super1_114336_0801", "acc_j4_super2_114336_0801"];
const reason = `${runId} J4 independent-super bootstrap; fixture preparation only`;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test("J Final9 creates two normal-MFA independent super-admin fixture actors from visible A1", async ({ browser, page }) => {
  expect(process.env.J4_BYPASS_BOOTSTRAP_TOKEN).toBeTruthy();
  mkdirSync(artifactRoot, { recursive: true });
  await loginBypass(page);
  const accounts: Array<{ username: string; password: string; totpSecret: string }> = [];
  for (const username of usernames) {
    const temporary = await createSuper(page, username);
    const context = await browser.newContext();
    const actor = await context.newPage();
    try {
      accounts.push(await enrollNormalMfa(actor, username, temporary));
    } finally {
      await context.close();
    }
  }
  writeFileSync(`${artifactRoot}/temporary-super-credentials.restricted.json`, `${JSON.stringify({ runId, accounts }, null, 2)}\n`, "utf8");
  writeFileSync(`${artifactRoot}/bootstrap-summary.json`, `${JSON.stringify({ runId, accounts: accounts.map(({ username }) => ({ username, normalMfa: true })), bypassOnlyForNamedSuperadmin: true, containsSecrets: false, status: "passed" }, null, 2)}\n`, "utf8");
});

async function loginBypass(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号", { exact: true }).fill("superadmin");
  await page.getByLabel("密码", { exact: true }).fill((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()));
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function createSuper(page: Page, username: string) {
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.locator("select.pager-size").selectOption("50");
  const existing = page.locator("tbody tr").filter({ hasText: username }).first();
  expect(await existing.count(), `${username} must not pre-exist in this isolated Final9 bootstrap`).toBe(0);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await dialog.getByPlaceholder("姓名,如:张三").fill(`J4 Independent Super ${username.slice(-4)}`);
  await dialog.getByText("超级管理员", { exact: true }).click();
  await dialog.getByLabel(/操作理由/).fill(reason);
  const response = page.waitForResponse((value) => value.request().method() === "POST" && new URL(value.url()).pathname === "/api/admin/platform/accounts");
  await dialog.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirm = page.getByRole("dialog").last();
  await confirm.getByLabel(/操作理由/).fill(reason);
  await confirm.getByRole("button", { name: "确认提交", exact: true }).click();
  const created = await response;
  const payload = await created.json() as { code?: number };
  expect(created.status(), JSON.stringify(payload)).toBe(200);
  expect(payload.code, JSON.stringify(payload)).toBe(0);
  const credential = page.getByRole("dialog").last();
  await expect(credential.getByText("临时密码", { exact: true })).toBeVisible();
  const temporary = (await credential.locator(".mono").last().textContent())?.trim() ?? "";
  expect(temporary).not.toBe("");
  await credential.getByText("关闭", { exact: true }).click();
  return temporary;
}

async function enrollNormalMfa(page: Page, username: string, temporary: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号", { exact: true }).fill(username);
  await page.getByLabel("密码", { exact: true }).fill(temporary);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码", { exact: true });
  await expect(otp).toBeVisible({ timeout: 30_000 });
  const totpSecret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(totpSecret).not.toBe("");
  await otp.fill(totp(totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible({ timeout: 30_000 });
  const password = `Nx!J4S${randomBytes(16).toString("base64url")}Aa9`;
  await page.getByLabel("新密码", { exact: true }).fill(password);
  await page.getByLabel("确认新密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return { username, password, totpSecret };
}

async function nav(page: Page, name: string, url: RegExp) {
  const link = page.locator("aside").getByRole("link", { name, exact: true }).first();
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first().click();
  await link.click();
  await expect(page).toHaveURL(url);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const raw = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of raw) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
