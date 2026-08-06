import { createHash, createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

type Account = {
  accountId?: string;
  id?: string;
  username: string;
  password: string;
  totpSecret: string;
  role?: string;
  createdForRun?: boolean;
};

type AccountManifest = {
  runId?: string;
  createdForRun?: boolean;
  account?: Account;
  bootstrap?: Account;
  supportSupervisor?: Account;
  accounts?: {
    maker?: Account;
    superadmin?: Account;
    bootstrap?: Account;
    supportSupervisor?: Account;
    m_support_supervisor?: Account;
  };
  finalAccounts?: {
    m_support_supervisor?: Account;
  };
};

type Session = {
  username?: string;
  role?: string;
  authorities?: string[];
  menuCodes?: string[];
};

type SupportAgent = {
  adminId: number;
  name?: string;
  email?: string;
  position: string;
  serviceTypes: string[];
  tags: string[];
  maxConcurrent: number;
  enabled: boolean;
  transferable: boolean;
  busy: boolean;
  status?: string;
};

type SupportEnvelope = {
  code?: number;
  message?: string;
  data?: {
    agents?: SupportAgent[];
  };
};

type ProfileSnapshot = {
  runId: string;
  supportManifestSha256: string;
  supportAccountHash: string;
  capturedAt: string;
  profile: SupportAgent;
};

const RUN_ID = process.env.M_FINAL2_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const FINAL2_PC_BUILD_ID = process.env.M_FINAL2_EXPECTED_PC_BUILD_ID ?? "xNJR-cEeID2fPRwrRvOrb";
const FINAL2_BACKEND_JAR_SHA256 = (process.env.M_FINAL2_EXPECTED_BACKEND_JAR_SHA256
  ?? "B426C1ED9CFCE970F247D041A28DC7EDAFAC927C112AC0089755ACB70F954B3B").toUpperCase();
const ACTION = (process.env.M_FINAL2_SUPPORT_ACTION ?? "preflight").trim().toLowerCase();
const SUPPORT_MANIFEST_PATH = requiredRestrictedPath("M_FINAL2_SUPPORT_MANIFEST_PATH");
const BOOTSTRAP_MANIFEST_PATH = requiredRestrictedPath("M_FINAL2_BOOTSTRAP_MANIFEST_PATH");
const EVIDENCE_DIR = requiredRestrictedPath("M_FINAL2_SUPPORT_EVIDENCE_DIR");
const SNAPSHOT_PATH = path.join(EVIDENCE_DIR, "m-final2-support-supervisor-before.restricted.json");
const supportManifest = parseManifest(SUPPORT_MANIFEST_PATH);
const bootstrapManifest = parseManifest(BOOTSTRAP_MANIFEST_PATH);
const support = supportManifest.supportSupervisor
  ?? supportManifest.account
  ?? supportManifest.accounts?.supportSupervisor
  ?? supportManifest.accounts?.m_support_supervisor
  ?? supportManifest.finalAccounts?.m_support_supervisor;
const bootstrap = bootstrapManifest.bootstrap
  ?? bootstrapManifest.account
  ?? bootstrapManifest.accounts?.bootstrap
  ?? bootstrapManifest.accounts?.superadmin
  ?? bootstrapManifest.accounts?.maker;

test.describe.configure({ mode: "serial", timeout: 240_000 });

test.beforeAll(() => {
  expect(["preflight", "setup", "restore"]).toContain(ACTION);
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(process.env.M_FINAL2_MFA_BYPASS).toBe("false");
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(FINAL2_PC_BUILD_ID);
  const backendJarPath = process.env.M_FINAL2_BACKEND_JAR_PATH?.trim();
  expect(backendJarPath, "M_FINAL2_BACKEND_JAR_PATH is required").toBeTruthy();
  expect(sha256File(path.resolve(backendJarPath!))).toBe(FINAL2_BACKEND_JAR_SHA256);
  expect(supportManifest.runId).toBe(RUN_ID);
  expect(bootstrapManifest.runId).toBe(RUN_ID);
  expect(support, "dedicated SUPPORT account is required").toBeTruthy();
  expect(bootstrap, "bootstrap super account is required").toBeTruthy();
  expect(support!.username).not.toBe(bootstrap!.username);
  expect(String(support!.accountId ?? support!.id ?? ""), "SUPPORT account id is required").toMatch(/^\d+$/);
  expect(
    supportManifest.createdForRun === true || support!.createdForRun === true,
    "SUPPORT account must be dedicated to this Run ID; shared accounts may not be mutated",
  ).toBe(true);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("preflight: dedicated SUPPORT and bootstrap super both use real MFA; no profile write", async ({ browser }) => {
  test.skip(ACTION !== "preflight", "M_FINAL2_SUPPORT_ACTION is not preflight");
  const supportContext = await browser.newContext({ baseURL: BASE_URL });
  const supportPage = await supportContext.newPage();
  const supportSession = await loginWithRequiredMfa(supportPage, support!);
  expect(supportSession.username).toBe(support!.username);
  const supportRole = String(supportSession.role ?? support!.role ?? "");
  expect(supportRole.toLowerCase()).toBe("support");
  expect(supportSession.authorities).toEqual(expect.arrayContaining(["service_m1_read", "service_m5_read"]));
  await supportContext.close();

  const bootstrapContext = await browser.newContext({ baseURL: BASE_URL });
  const bootstrapPage = await bootstrapContext.newPage();
  const bootstrapSession = await loginWithRequiredMfa(bootstrapPage, bootstrap!);
  expect(bootstrapSession.username).toBe(bootstrap!.username);
  expect(["super", "superadmin"]).toContain(String(bootstrapSession.role ?? bootstrap!.role ?? "").toLowerCase());
  const before = await readSupportAgent(bootstrapPage.request, support!);
  assertRestorableFreshSupportBaseline(before);
  await bootstrapContext.close();

  writeSafeEvidence("m-final2-support-preflight-safe.json", {
    runId: RUN_ID,
    action: ACTION,
    businessWrites: 0,
    mfaBypass: false,
    supportAccountHash: hash16(support!.username),
    bootstrapAccountHash: hash16(bootstrap!.username),
    supportRole: "support",
    baseline: safeProfile(before),
  });
});

test("setup: bootstrap super uses visible M1 to assign the dedicated SUPPORT account as 客服主管", async ({ browser }) => {
  test.skip(ACTION !== "setup", "M_FINAL2_SUPPORT_ACTION is not setup");
  requireToken("M_PROFILE_BOOTSTRAP_TOKEN");

  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const session = await loginWithRequiredMfa(page, bootstrap!);
  expect(["super", "superadmin"]).toContain(String(session.role ?? bootstrap!.role ?? "").toLowerCase());
  const before = await readSupportAgent(page.request, support!);
  assertRestorableFreshSupportBaseline(before);
  const snapshot: ProfileSnapshot = {
    runId: RUN_ID,
    supportManifestSha256: sha256File(SUPPORT_MANIFEST_PATH),
    supportAccountHash: hash16(support!.username),
    capturedAt: new Date().toISOString(),
    profile: before,
  };
  writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

  const mutation = await assignSeatThroughVisibleM1(page, support!, "客服主管", `${RUN_ID}-M1设置客服主管`);
  const afterSeatAssignment = await readSupportAgent(page.request, support!);
  await configureProfileThroughVisibleM5(
    page,
    afterSeatAssignment,
    { ...before, position: "客服主管" },
    `${RUN_ID}-M5恢复坐席附属字段`,
  );
  const after = await readSupportAgent(page.request, support!);
  expectVisibleProfileEqual(after, { ...before, position: "客服主管" });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "m1-support-supervisor-after-setup.png"), fullPage: true });
  await context.close();

  const supportContext = await browser.newContext({ baseURL: BASE_URL });
  const supportPage = await supportContext.newPage();
  const supportSession = await loginWithRequiredMfa(supportPage, support!);
  const supportRole = String(supportSession.role ?? support!.role ?? "");
  expect(supportRole.toLowerCase()).toBe("support");
  expect(supportSession.authorities).toEqual(expect.arrayContaining(["service_m1_write", "service_m5_write"]));
  await openVisibleModule(supportPage, "/service/overview");
  await expect(supportPage.getByRole("button", { name: "分配坐席", exact: true })).toBeVisible();
  await openVisibleModule(supportPage, "/service/scripts");
  await expect(supportPage.getByText(/当前账号只有查看权限/)).toHaveCount(0);
  await supportPage.screenshot({ path: path.join(EVIDENCE_DIR, "m5-support-supervisor-write-gate.png"), fullPage: true });
  await supportContext.close();

  writeSafeEvidence("m-final2-support-setup-safe.json", {
    runId: RUN_ID,
    action: ACTION,
    mfaBypass: false,
    supportAccountHash: hash16(support!.username),
    before: safeProfile(before),
    after: safeProfile(after),
    request: mutation,
    snapshotSha256: sha256File(SNAPSHOT_PATH),
  });
});

test("restore: bootstrap super uses visible M1 and exact snapshot to remove the temporary supervisor profile", async ({ browser }) => {
  test.skip(ACTION !== "restore", "M_FINAL2_SUPPORT_ACTION is not restore");
  requireToken("M_PROFILE_RESTORE_TOKEN");
  expect(existsSync(SNAPSHOT_PATH), "setup snapshot is required before restore").toBe(true);
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ProfileSnapshot;
  expect(snapshot.runId).toBe(RUN_ID);
  expect(snapshot.supportManifestSha256).toBe(sha256File(SUPPORT_MANIFEST_PATH));
  expect(snapshot.supportAccountHash).toBe(hash16(support!.username));
  assertRestorableFreshSupportBaseline(snapshot.profile);

  const context = await browser.newContext({ baseURL: BASE_URL });
  const page = await context.newPage();
  const session = await loginWithRequiredMfa(page, bootstrap!);
  expect(["super", "superadmin"]).toContain(String(session.role ?? bootstrap!.role ?? "").toLowerCase());
  const beforeRestore = await readSupportAgent(page.request, support!);
  expect(beforeRestore.position).toBe("客服主管");
  const mutation = await assignSeatThroughVisibleM1(
    page,
    support!,
    snapshot.profile.position,
    `${RUN_ID}-M1恢复客服坐席`,
  );
  const afterSeatRestore = await readSupportAgent(page.request, support!);
  await configureProfileThroughVisibleM5(
    page,
    afterSeatRestore,
    snapshot.profile,
    `${RUN_ID}-M5精确恢复坐席附属字段`,
  );
  const restored = await readSupportAgent(page.request, support!);
  expectVisibleProfileEqual(restored, snapshot.profile);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "m1-support-supervisor-restored.png"), fullPage: true });
  await context.close();

  const supportContext = await browser.newContext({ baseURL: BASE_URL });
  const supportPage = await supportContext.newPage();
  const supportSession = await loginWithRequiredMfa(supportPage, support!);
  const supportRole = String(supportSession.role ?? support!.role ?? "");
  expect(supportRole.toLowerCase()).toBe("support");
  await openVisibleModule(supportPage, "/service/scripts");
  await expect(supportPage.getByText(/当前账号只有查看权限/)).toBeVisible();
  await supportContext.close();

  writeSafeEvidence("m-final2-support-restore-safe.json", {
    runId: RUN_ID,
    action: ACTION,
    mfaBypass: false,
    supportAccountHash: hash16(support!.username),
    beforeRestore: safeProfile(beforeRestore),
    restored: safeProfile(restored),
    exactVisibleRestore: true,
    request: mutation,
  });
});

async function assignSeatThroughVisibleM1(
  page: Page,
  account: Account,
  targetPosition: string,
  reason: string,
) {
  await openVisibleModule(page, "/service/overview");
  await page.getByRole("button", { name: "分配坐席", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "分配客服坐席" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("搜索客服管理员").fill(account.accountId ?? account.id ?? account.username);
  const candidate = dialog.locator('[data-proof="m1-seat-admin-option"]').first();
  await expect(candidate, "dedicated SUPPORT account must be visible in M1").toBeVisible();
  await candidate.click();
  const seatLabel = dialog.getByText(targetPosition, { exact: true }).first();
  await expect(seatLabel, `target seat ${targetPosition} must be visible`).toBeVisible();
  await seatLabel.click();
  await dialog.getByLabel(/分配理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname.endsWith(`/support-agents/${account.accountId ?? account.id}/seat-assignment`),
  );
  await dialog.locator('[data-proof="m1-seat-role-save"]').click();
  const response = await responsePromise;
  const responseText = await response.text();
  expect(response.status(), responseText.slice(0, 500)).toBe(200);
  await expect(dialog).toBeHidden();
  return {
    status: response.status(),
    idempotencyKeyHash: hash16(response.request().headers()["idempotency-key"] ?? ""),
  };
}

async function readSupportAgent(request: APIRequestContext, account: Account) {
  const response = await request.get("/api/admin/content/support-agents");
  const text = await response.text();
  expect(response.status(), text.slice(0, 500)).toBe(200);
  const payload = JSON.parse(text) as SupportEnvelope;
  expect(payload.code ?? 0).toBe(0);
  const expectedId = Number(account.accountId ?? account.id);
  const row = payload.data?.agents?.find((agent) => agent.adminId === expectedId);
  expect(row, `SUPPORT account ${expectedId} must be listed by M1`).toBeTruthy();
  return {
    ...row!,
    serviceTypes: Array.isArray(row!.serviceTypes) ? row!.serviceTypes : [],
    tags: Array.isArray(row!.tags) ? row!.tags : [],
  };
}

async function configureProfileThroughVisibleM5(
  page: Page,
  current: SupportAgent,
  expected: SupportAgent,
  reason: string,
) {
  await openVisibleModule(page, "/service/scripts");
  const card = page.locator(".card").filter({ has: page.getByText("客服岗位与专属客服", { exact: true }) }).first();
  await expect(card).toBeVisible();
  let name = card.getByText(current.name ?? expected.name ?? "", { exact: true }).first();
  for (let attempt = 0; attempt < 30 && !await name.isVisible().catch(() => false); attempt += 1) {
    const next = card.getByRole("button", { name: "下一页", exact: true });
    if (await next.isDisabled().catch(() => true)) break;
    await next.click();
    await page.waitForTimeout(100);
    name = card.getByText(current.name ?? expected.name ?? "", { exact: true }).first();
  }
  await expect(name, "dedicated SUPPORT account must be visible in the M5 agent list").toBeVisible();
  const row = name.locator("xpath=ancestor::div[.//button[contains(normalize-space(.),'配置岗位')]][1]");
  await row.getByRole("button", { name: /配置岗位/ }).click();
  const dialog = page.getByRole("dialog", { name: "配置客服岗位" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("接派单上限").fill(String(expected.maxConcurrent));
  const serviceSection = dialog.getByText("服务类型", { exact: true }).locator("..");
  for (const [label, type] of [["普通客服", "support"], ["专属客服服务", "advisor"]] as const) {
    const button = serviceSection.getByRole("button", { name: label, exact: true });
    if (await button.isDisabled().catch(() => false)) {
      expect(expected.serviceTypes).not.toContain(type);
      continue;
    }
    const selected = (await button.getAttribute("class") ?? "").split(/\s+/).includes("sel");
    if (selected !== expected.serviceTypes.includes(type)) await button.click();
  }

  const tagSection = dialog.getByText("岗位标签", { exact: true }).locator("..");
  const tagButtons = tagSection.getByRole("button");
  const visibleTags = new Set<string>();
  for (let index = 0; index < await tagButtons.count(); index += 1) {
    const button = tagButtons.nth(index);
    const tag = (await button.innerText()).trim();
    visibleTags.add(tag);
    const selected = (await button.getAttribute("class") ?? "").split(/\s+/).includes("sel");
    if (selected !== expected.tags.includes(tag)) await button.click();
  }
  for (const tag of expected.tags) {
    expect(visibleTags, `M5 must expose restorable tag ${tag}`).toContain(tag);
  }

  for (const [label, value] of [
    ["启用客服", expected.enabled],
    ["允许被转交", expected.transferable],
    ["暂停接派单", expected.busy],
  ] as const) {
    const toggle = dialog.locator("label").filter({ hasText: label }).getByRole("switch");
    expect(await toggle.getAttribute("aria-checked")).toBe(String(value));
  }

  await dialog.getByLabel(/变更理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && new URL(response.url()).pathname.endsWith(`/support-agents/${expected.adminId}/profile`),
  );
  await dialog.getByRole("button", { name: /^保存$/ }).click();
  const response = await responsePromise;
  const responseText = await response.text();
  expect(response.status(), responseText.slice(0, 500)).toBe(200);
  await expect(dialog).toBeHidden();
}

function assertRestorableFreshSupportBaseline(profile: SupportAgent) {
  expect(profile.position, "dedicated SUPPORT baseline must be the reversible general seat").toBe("通用客服");
  expect([...profile.serviceTypes].sort()).toEqual(["support"]);
  expect(profile.enabled).toBe(true);
  expect(profile.transferable).toBe(true);
  expect(profile.maxConcurrent).toBeGreaterThan(0);
}

function expectVisibleProfileEqual(actual: SupportAgent, expected: SupportAgent) {
  expect({
    position: actual.position,
    serviceTypes: [...actual.serviceTypes].sort(),
    tags: [...actual.tags].sort(),
    maxConcurrent: actual.maxConcurrent,
    enabled: actual.enabled,
    transferable: actual.transferable,
    busy: actual.busy,
    status: actual.status,
  }).toEqual({
    position: expected.position,
    serviceTypes: [...expected.serviceTypes].sort(),
    tags: [...expected.tags].sort(),
    maxConcurrent: expected.maxConcurrent,
    enabled: expected.enabled,
    transferable: expected.transferable,
    busy: expected.busy,
    status: expected.status,
  });
}

async function openVisibleModule(page: Page, href: "/service/overview" | "/service/scripts") {
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL((url) => url.pathname === href);
}

async function loginWithRequiredMfa(page: Page, account: Account): Promise<Session> {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login",
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await loginResponse).status()).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp, `${account.username} must complete real MFA`).toBeVisible({ timeout: 20_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  const verifyResponse = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify",
  );
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verifyResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  const sessionResponse = await page.request.get("/api/admin/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const payload = await sessionResponse.json() as { code?: number; data?: { session?: Session } };
  expect(payload.code ?? 0).toBe(0);
  expect(payload.data?.session).toBeTruthy();
  return payload.data!.session!;
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

function parseManifest(file: string) {
  return JSON.parse(readFileSync(file, "utf8")) as AccountManifest;
}

function requiredRestrictedPath(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  const resolved = path.resolve(value);
  if (!/bug-pic[\\/]\.restricted[\\/]/i.test(resolved)) throw new Error(`${name}_MUST_BE_RESTRICTED`);
  return resolved;
}

function requireToken(name: string) {
  const controlToken = process.env.M_PROFILE_CONTROL_TOKEN?.trim();
  expect(controlToken, "M_PROFILE_CONTROL_TOKEN must contain the main-agent-issued profile token").toBeTruthy();
  expect(process.env[name]?.trim(), `${name} must match the exact main-agent-issued profile token`).toBe(controlToken);
}

function safeProfile(profile: SupportAgent) {
  return {
    position: profile.position,
    serviceTypes: [...profile.serviceTypes].sort(),
    tags: [...profile.tags].sort(),
    maxConcurrent: profile.maxConcurrent,
    enabled: profile.enabled,
    transferable: profile.transferable,
    busy: profile.busy,
    status: profile.status,
  };
}

function writeSafeEvidence(name: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function hash16(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 16).toUpperCase();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
