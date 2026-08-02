import { createHmac, createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = {
  accountId?: string;
  username: string;
  password: string;
  totpSecret: string;
  authorities?: string[];
  effectiveMenus?: string[];
};

type OwnerFixture = {
  runId?: string;
  account?: Account;
  maker?: Account;
  accounts?: { maker?: Account };
};

type CheckerManifest = {
  runId?: string;
  account?: Account;
  checker?: Account;
  accounts?: { checker?: Account; m_checker?: Account };
  finalAccounts?: { m_checker?: Account };
};

type SessionEnvelope = {
  code?: number;
  message?: string;
  data?: {
    session?: {
      username?: string;
      authorities?: string[];
      effectiveMenus?: string[];
    };
  };
};

type LoadConfigEnvelope = {
  code?: number;
  data?: {
    loadConfig?: Record<string, unknown> & { version?: number };
    agentState?: Record<string, { cap: number; busy: boolean }>;
  };
};

type SessionTemplateEnvelope = {
  code?: number;
  data?: {
    categories?: Array<{ type?: string; enabled?: boolean }>;
  };
};

const RUN_ID = process.env.M_FINAL2_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const FINAL2_PC_BUILD_ID = process.env.M_FINAL2_EXPECTED_PC_BUILD_ID ?? "xNJR-cEeID2fPRwrRvOrb";
const FINAL2_PC_BUILD_ID_PATH = path.resolve(process.env.M_FINAL2_PC_BUILD_ID_PATH?.trim() || ".next/BUILD_ID");
const FINAL2_BACKEND_JAR_SHA256 = (process.env.M_FINAL2_EXPECTED_BACKEND_JAR_SHA256
  ?? "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B").toUpperCase();
const FINAL2_PC_PID = Number(process.env.M_FINAL2_PC_PID ?? 0);
const FINAL2_BACKEND_PID = Number(process.env.M_FINAL2_BACKEND_PID ?? 0);
const OWNER_FIXTURE_PATH = requiredRestrictedPath("M_FINAL2_OWNER_FIXTURE_PATH");
const CHECKER_MANIFEST_PATH = requiredRestrictedPath("M_FINAL2_CHECKER_MANIFEST_PATH");
const EVIDENCE_DIR = requiredRestrictedPath("M_FINAL2_GATE_EVIDENCE_DIR");
const ownerFixture = JSON.parse(readFileSync(OWNER_FIXTURE_PATH, "utf8")) as OwnerFixture;
const checkerManifest = JSON.parse(readFileSync(CHECKER_MANIFEST_PATH, "utf8")) as CheckerManifest;
const maker = ownerFixture.account ?? ownerFixture.maker ?? ownerFixture.accounts?.maker;
const checker = checkerManifest.account
  ?? checkerManifest.checker
  ?? checkerManifest.accounts?.checker
  ?? checkerManifest.accounts?.m_checker
  ?? checkerManifest.finalAccounts?.m_checker;

const MAKER_AUTHORITIES = [
  "platform_a2_read",
  "service_m2_read", "service_m2_write",
  "service_m3_read", "service_m3_write",
  "service_m4_read", "service_m4_write",
].sort();
const MAKER_SESSION_MENU_LEAVES = ["A2", "M2", "M3", "M4"].sort();
const CHECKER_AUTHORITIES = [
  "platform_a2_read",
  "service_m1_read", "service_m1_write",
  "service_m2_read", "service_m2_write",
  "service_m3_read", "service_m3_write", "service_m3_timeout_manage",
  "service_m4_read", "service_m4_write",
  "service_m5_read", "service_m5_write",
].sort();
const CHECKER_SESSION_MENU_LEAVES = ["A2", "M1", "M2", "M3", "M4", "M5"].sort();
const M_MODULES = [
  { code: "M1", href: "/service/overview", api: "/api/admin/content/tickets/load-config" },
  { code: "M2", href: "/service/tickets", api: "/api/admin/content/tickets?page=1&size=20" },
  { code: "M3", href: "/service/sessions", api: "/api/admin/content/conversations?page=1&size=20" },
  { code: "M4", href: "/service/kb-sla", api: "/api/admin/content/knowledge/overview" },
  { code: "M5", href: "/service/scripts", api: "/api/admin/content/session-templates/overview" },
] as const;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(() => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(process.env.M_FINAL2_MFA_BYPASS).toBe("false");
  expect(new URL(BASE_URL).port || "80").toBe("3002");
  expect(FINAL2_PC_PID, "M_FINAL2_PC_PID is required").toBeGreaterThan(0);
  expect(FINAL2_BACKEND_PID, "M_FINAL2_BACKEND_PID is required").toBeGreaterThan(0);
  expect(() => process.kill(FINAL2_PC_PID, 0), "declared final2 PC process must be alive").not.toThrow();
  expect(() => process.kill(FINAL2_BACKEND_PID, 0), "declared final2 backend process must be alive").not.toThrow();
  expect(readFileSync(FINAL2_PC_BUILD_ID_PATH, "utf8").trim()).toBe(FINAL2_PC_BUILD_ID);
  const backendJarPath = process.env.M_FINAL2_BACKEND_JAR_PATH?.trim();
  expect(backendJarPath, "M_FINAL2_BACKEND_JAR_PATH is required").toBeTruthy();
  expect(sha256File(path.resolve(backendJarPath!))).toBe(FINAL2_BACKEND_JAR_SHA256);
  expect(ownerFixture.runId).toBe(RUN_ID);
  expect(checkerManifest.runId).toBe(RUN_ID);
  expect(maker, "M maker account is required").toBeTruthy();
  expect(checker, "M-only checker account is required").toBeTruthy();
  expect(checker!.username).not.toBe(maker!.username);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("final2 gate: maker 与 M-only checker 均经过真实 MFA，checker 权限/菜单精确且跨域失败关闭", async ({ browser }) => {
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    ownerFixtureSha256: sha256File(OWNER_FIXTURE_PATH),
    checkerManifestSha256: sha256File(CHECKER_MANIFEST_PATH),
    startedAt: new Date().toISOString(),
    mfaBypass: false,
    businessWrites: 0,
    runtime: {
      pcPid: FINAL2_PC_PID,
      backendPid: FINAL2_BACKEND_PID,
      pcPort: Number(new URL(BASE_URL).port),
      backendPort: 8110,
    },
  };

  for (const [label, account] of [["maker", maker!], ["checker", checker!]] as const) {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const session = await loginWithRequiredMfa(page, account);
    if (label === "maker") {
      const liveBuild = await page.request.get(`/_next/static/${FINAL2_PC_BUILD_ID}/_buildManifest.js`);
      expect(liveBuild.status(), "3002 must serve the locked final2 Next build asset").toBe(200);
      evidence.runtime = {
        ...(evidence.runtime as Record<string, unknown>),
        liveBuildAssetStatus: liveBuild.status(),
      };
    }
    const authorities = [...(session.authorities ?? [])].sort();
    const menus = [...(session.effectiveMenus ?? [])].sort();
    expect(account.username).toBe(session.username);
    const expectedAuthorities = label === "maker" ? MAKER_AUTHORITIES : CHECKER_AUTHORITIES;
    const expectedMenus = label === "maker" ? MAKER_SESSION_MENU_LEAVES : CHECKER_SESSION_MENU_LEAVES;
    expect(authorities, `${label} authorities must be exact`).toEqual(expectedAuthorities);
    expect(menus, `${label} effectiveMenus must be exact leaves`).toEqual(expectedMenus);

    if (label === "checker") {
      const allowedAudit = await page.request.get("/api/admin/platform/audit/logs?limit=1");
      expect(allowedAudit.status(), "M-only checker may read A2 evidence").toBe(200);
      const forbiddenPlatform = await page.request.get("/api/admin/platform/accounts/overview");
      expect(forbiddenPlatform.status()).toBe(403);
      const forbiddenDevice = await page.request.get("/api/admin/devices/overview");
      expect(forbiddenDevice.status()).toBe(403);

      const loadResponse = await page.request.get("/api/admin/content/tickets/load-config");
      expect(loadResponse.status()).toBe(200);
      const loadPayload = await loadResponse.json() as LoadConfigEnvelope;
      expect(loadPayload.code ?? 0).toBe(0);
      expect(loadPayload.data?.loadConfig).toBeTruthy();
      const managedM1Probe = await page.request.patch("/api/admin/content/tickets/load-config", {
        headers: { "Idempotency-Key": `${RUN_ID}-M-CHECKER-M1-BUSINESS-GATE` },
        data: {
          ...loadPayload.data!.loadConfig,
          agentState: loadPayload.data!.agentState ?? {},
          expectedVersion: loadPayload.data!.loadConfig!.version,
          reason: `${RUN_ID}-M-only checker不得越过M1客服主管业务门`,
        },
      });
      expect(managedM1Probe.status(), "M-only checker has service_m1_write but is not SUPPORT supervisor").toBe(403);

      const templateResponse = await page.request.get("/api/admin/content/session-templates/overview");
      expect(templateResponse.status()).toBe(200);
      const templatePayload = await templateResponse.json() as SessionTemplateEnvelope;
      expect(templatePayload.code ?? 0).toBe(0);
      const category = templatePayload.data?.categories?.find((row) => row.type === "advisor");
      expect(category).toBeTruthy();
      const managedM5Probe = await page.request.patch("/api/admin/content/session-templates/categories/advisor", {
        headers: { "Idempotency-Key": `${RUN_ID}-M-CHECKER-M5-BUSINESS-GATE` },
        data: {
          enabled: category!.enabled,
          expectedEnabled: category!.enabled,
          reason: `${RUN_ID}-M-only checker不得越过M5客服主管业务门`,
        },
      });
      expect(managedM5Probe.status(), "M-only checker has service_m5_write but is not SUPPORT supervisor").toBe(403);
      evidence.checkerBusinessGate = {
        managedM1Status: managedM1Probe.status(),
        managedM5Status: managedM5Probe.status(),
        successfulWrites: 0,
      };
    } else {
      expect((await page.request.get("/api/admin/platform/audit/logs?limit=1")).status()).toBe(200);
      expect((await page.request.get("/api/admin/platform/accounts/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/devices/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/content/tickets/load-config")).status()).toBe(403);
      expect((await page.request.get("/api/admin/content/session-templates/overview")).status()).toBe(403);
    }

    const visibleModules = label === "maker"
      ? M_MODULES.filter((module) => ["M2", "M3", "M4"].includes(module.code))
      : M_MODULES;
    await openVisibleMModules(page, visibleModules);
    const readStatuses: Record<string, number> = {};
    for (const module of visibleModules) {
      const response = await page.request.get(module.api);
      readStatuses[module.code] = response.status();
      expect(response.status(), `${label} ${module.code} authority read`).toBe(200);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await logout(page);
    const relogin = await loginWithRequiredMfa(page, account);
    expect([...(relogin.authorities ?? [])].sort()).toEqual(authorities);
    expect([...(relogin.effectiveMenus ?? [])].sort()).toEqual(menus);
    expect(pageErrors).toEqual([]);
    evidence[label] = {
      accountHash: sha256(account.username),
      authorityCount: authorities.length,
      menuCodes: menus,
      reads: readStatuses,
      reloginStable: true,
      pageErrors,
    };
    await context.close();
  }

  evidence.finishedAt = new Date().toISOString();
  writeFileSync(
    path.join(EVIDENCE_DIR, "m-final2-owner-gate-safe.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
    "utf8",
  );
});

async function loginWithRequiredMfa(page: Page, account: Account) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);

  const otp = page.getByLabel("一次性验证码");
  await expect(otp, `${account.username} must not bypass MFA`).toBeVisible({ timeout: 20_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  const verification = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verification).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });

  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as SessionEnvelope;
  expect(payload.code ?? 0).toBe(0);
  expect(payload.data?.session).toBeTruthy();
  return payload.data!.session!;
}

async function openVisibleMModules(page: Page, modules: ReadonlyArray<(typeof M_MODULES)[number]>) {
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  for (const module of modules) {
    const link = page.locator(`aside a[href="${module.href}"]`).first();
    if (!await link.isVisible().catch(() => false)) {
      await expect(group).toBeVisible();
      await group.click();
    }
    await expect(link, `${module.code} must be visible from sidebar`).toBeVisible();
    await link.click();
    await expect(page).toHaveURL((url) => url.pathname === module.href);
  }
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 800));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
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
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function requiredRestrictedPath(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  const resolved = path.resolve(value);
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(resolved)) {
    throw new Error(`${name}_MUST_BE_RESTRICTED`);
  }
  return resolved;
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16).toUpperCase();
}
