import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Account = { username: string; password: string; totpSecret: string };
type Fixture = { accounts?: { maker?: Account } };

const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const account = (JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture).accounts?.maker;
if (!account) throw new Error("I maker account is required");

const EVIDENCE_ROOT = process.env.I_FAULT_EVIDENCE_ROOT
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final-nf0q/fault-closure";

const MODULES = [
  {
    id: "I1",
    path: "/content/copy-ab",
    endpoint: "/api/admin/content/copy-ab/overview",
    recoveredText: "文案池(a)",
    malformed: { stats: {}, copies: "malformed" },
  },
  {
    id: "I2",
    path: "/content/nova",
    endpoint: "/api/admin/content/nova/overview",
    recoveredText: "Nova Cadence",
    malformed: { stats: {}, templates: "malformed" },
  },
  {
    id: "I3",
    path: "/content/notifications",
    endpoint: "/api/admin/content/campaigns/overview",
    recoveredText: "本月 campaign",
    malformed: { stats: {}, audienceCatalog: { phases: "malformed" } },
  },
  {
    id: "I4",
    path: "/content/trust",
    endpoint: "/api/admin/content/trust-disclosure/overview",
    recoveredText: "受管信任版块",
    malformed: { stats: {}, trustSectionVersions: [{ fields: "malformed" }] },
  },
  {
    id: "I5",
    path: "/content/disclosures",
    endpoint: "/api/admin/content/trust-disclosure/overview",
    recoveredText: "法域配置(I5)",
    malformed: { stats: {}, trustSectionVersions: [{ fields: "malformed" }] },
  },
  {
    id: "I6",
    path: "/content/i18n",
    endpoint: "/api/admin/content/i18n-learning/overview",
    recoveredText: "受管词条",
    malformed: { stats: {}, messages: [{ placeholders: "malformed" }] },
  },
] as const;

test.describe.configure({ timeout: 300_000 });

test("I1-I6 401/404/500/超时/畸形 200 均失败关闭并恢复真实数据", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const evidence: Record<string, unknown> = {
    runId: "pc-full-acceptance-20260729-114336",
    candidate: "nf0qGeqytfzJ1e_lX9TMR/D1D33E",
    actorHash: safeHash(account.username),
    modules: {},
  };

  const anonymous = await page.request.get("/api/admin/content/copy-ab/overview");
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.text()).not.toMatch(/copies|experiments|templates|campaigns/i);

  await login(page, account);
  pageErrors.length = 0;
  for (const module of MODULES) {
    const rows: Array<Record<string, unknown>> = [];
    await openModule(page, module.path, module.recoveredText);

    await page.route(`**${module.endpoint}`, (route) => route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: `${module.id}_ACCEPTANCE_FAILURE`, data: null }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectFailureClosed(page, module.id, false);
    await page.unroute(`**${module.endpoint}`);
    await recover(page, module.recoveredText);
    rows.push({ branch: "500", closed: true, recovered: true });

    await page.route(`**${module.endpoint}`, (route) => route.abort("timedout"));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectFailureClosed(page, module.id, false);
    await page.unroute(`**${module.endpoint}`);
    await recover(page, module.recoveredText);
    rows.push({ branch: "timeout", closed: true, recovered: true });

    await page.route(`**${module.endpoint}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "OK", data: module.malformed }),
    }));
    await page.reload({ waitUntil: "domcontentloaded" });
    await expectFailureClosed(page, module.id, true);
    await page.unroute(`**${module.endpoint}`);
    await recover(page, module.recoveredText);
    rows.push({ branch: "malformed200", closed: true, recovered: true });

    (evidence.modules as Record<string, unknown>)[module.id] = rows;
    await page.screenshot({ path: evidencePath(`${module.id}-recovered.png`), fullPage: true });
  }

  const missing = await page.request.get("/api/admin/content/__acceptance_missing_endpoint__");
  expect(missing.status()).toBe(404);
  expect(await missing.text()).not.toMatch(/copies|experiments|templates|campaigns/i);
  expect(pageErrors, `fault closure pageerrors: ${pageErrors.join("\n")}`).toEqual([]);

  evidence.auth = { anonymousRead: 401, authenticatedUnknownRoute: 404 };
  evidence.pageErrors = 0;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeFileSync(path.join(EVIDENCE_ROOT, "fault-closure-safe.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});

async function expectFailureClosed(page: Page, moduleId: string, malformed: boolean) {
  await expect(page.getByText("I 域数据加载失败", { exact: false })).toBeVisible();
  const detail = malformed
    ? `${moduleId} 返回数据格式异常，请刷新重试`
    : `${moduleId} 数据加载失败，请刷新重试`;
  await expect(page.getByText(detail, { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
  await expect(page.locator(".idom table")).toHaveCount(0);
  await expect(
    page.locator(".idom").getByRole("button", { name: /新增|编辑|发布|保存|下架|归档|删除|启动|停止|采纳/ }),
  ).toHaveCount(0);
}

async function recover(page: Page, recoveredText: string) {
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByText("I 域数据加载失败", { exact: false })).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(recoveredText, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function openModule(page: Page, href: string, visibleText: string) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
  await expect(page.getByText(visibleText, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, target: Account) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await username.fill(target.username);
    await page.locator('input[autocomplete="current-password"]').fill(target.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const shell = page.locator("aside");
    const otp = page.getByLabel("一次性验证码");
    await Promise.race([
      shell.waitFor({ state: "visible", timeout: 10_000 }),
      otp.waitFor({ state: "visible", timeout: 10_000 }),
    ]);
    if (await shell.isVisible().catch(() => false)) return;
    const code = await freshTotp(target.totpSecret);
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await otp.fill(code);
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
  throw new Error(`MFA login failed: ${failures.join(",")}`);
}

function evidencePath(fileName: string) {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  return path.join(EVIDENCE_ROOT, fileName);
}

function safeHash(value: string) {
  return createHmac("sha256", "i-domain-fault-safe-evidence").update(value).digest("hex").slice(0, 16);
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
