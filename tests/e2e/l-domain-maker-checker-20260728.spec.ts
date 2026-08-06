import { createHash, createHmac, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type OwnerAccount = FixtureAccount & { authorities?: string[]; effectiveMenus?: string[] };
type LFixture = { accounts: { maker: OwnerAccount } };
type CheckerPairFixture = {
  accounts?: { checkerA?: FixtureAccount; checkerB?: FixtureAccount };
  finalAccounts?: {
    checkerA?: FixtureAccount;
    checkerB?: FixtureAccount;
    l3_checker_a?: FixtureAccount;
    l3_checker_b?: FixtureAccount;
  };
  checkers?: FixtureAccount[];
};
type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type L3RuntimeEvidence = {
  runId: string;
  reportId?: string;
  idempotencyKey?: string;
  maker: string;
  checkerA: string;
  checkerB: string;
  statuses: Record<string, number>;
  sessionProfiles?: Record<string, { authorities: string[]; menuCodes: string[]; visibleLeafPaths: string[] }>;
  candidate: {
    pcBuildId: string;
    pcPid: number;
    liveBuildAssetStatus?: number;
    backendJarSha256: string;
    backendPid: number;
  };
  cleanup: {
    reportId?: string;
    minioObject?: string;
    idempotency: Array<{ scope: string; key: string }>;
  };
  outcome: { status: "RUNNING" | "PASSED" | "FAILED"; startedAt: string; finishedAt?: string; error?: string };
};

const RUN_ID = process.env.L_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const CHECKER_PAIR_PATH = process.env.L_CHECKER_PAIR_PATH ?? process.env.L_SECOND_CHECKER_PATH;
const L_FIXTURE_PATH = process.env.L_PERMISSION_FIXTURE_PATH;
const EXPECTED_PC_BUILD_ID = process.env.L_FINAL_EXPECTED_PC_BUILD_ID ?? "";
const EXPECTED_PC_PID = Number(process.env.L_FINAL_EXPECTED_PC_PID ?? "0");
const BACKEND_JAR_PATH = process.env.L_FINAL_BACKEND_JAR_PATH ?? "";
const EXPECTED_BACKEND_JAR_SHA = (process.env.L_FINAL_EXPECTED_BACKEND_JAR_SHA256 ?? "").toUpperCase();
const EXPECTED_BACKEND_PID = Number(process.env.L_FINAL_EXPECTED_BACKEND_PID ?? "0");
const EXPECTED_WRITE_TOKEN = process.env.L_FINAL_EXPECTED_WRITE_TOKEN ?? "";
const EVIDENCE_DIR = process.env.L_MAKER_CHECKER_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/L/maker-checker`;

if (!L_FIXTURE_PATH) throw new Error("L_PERMISSION_FIXTURE_PATH is required");
if (!CHECKER_PAIR_PATH) throw new Error("L_CHECKER_PAIR_PATH is required");
if (!EXPECTED_WRITE_TOKEN) throw new Error("L_FINAL_EXPECTED_WRITE_TOKEN is required");
if (!EXPECTED_PC_BUILD_ID) throw new Error("L_FINAL_EXPECTED_PC_BUILD_ID is required");
if (!Number.isSafeInteger(EXPECTED_PC_PID) || EXPECTED_PC_PID < 1) {
  throw new Error("L_FINAL_EXPECTED_PC_PID must be a positive integer");
}
if (!BACKEND_JAR_PATH) throw new Error("L_FINAL_BACKEND_JAR_PATH is required");
if (!/^[0-9A-F]{64}$/.test(EXPECTED_BACKEND_JAR_SHA)) {
  throw new Error("L_FINAL_EXPECTED_BACKEND_JAR_SHA256 must be a SHA-256");
}
if (!Number.isSafeInteger(EXPECTED_BACKEND_PID) || EXPECTED_BACKEND_PID < 1) {
  throw new Error("L_FINAL_EXPECTED_BACKEND_PID must be a positive integer");
}
const fixture = JSON.parse(readFileSync(L_FIXTURE_PATH, "utf8")) as LFixture;
const owner = fixture.accounts.maker;
const { checkerA, checkerB } = loadCheckerPair();
const EXACT_CHECKER_AUTHORITIES = [
  "bi_l3_read",
  "bi_l5_task_approve",
  "platform_a2_read",
].sort();
const EXACT_CHECKER_MENU_CODES = ["A2", "L3"];
const EXACT_CHECKER_LEAF_PATHS = ["/analytics/financial", "/platform/audit"].sort();
const EXACT_OWNER_LEAF_PATHS = [
  "/analytics/behavior-heatmap",
  "/analytics/export",
  "/analytics/financial",
  "/analytics/funnel-cohort",
  "/analytics/kpi",
  "/analytics/operations",
].sort();

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("L3 敏感明细由 L Owner 发起、同键幂等/异载荷冲突，并由两个独立 Checker 竞争批准", async ({ page, browser }) => {
  expect(["127.0.0.1", "localhost", "::1"]).toContain(new URL(BASE_URL).hostname);
  expect(new URL(BASE_URL).port || "80").toBe("3002");
  expect(process.env.L_FINAL_WRITE_TOKEN).toBe(EXPECTED_WRITE_TOKEN);
  expect(process.env.L_FINAL_MFA_BYPASS).toBe("false");
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(EXPECTED_PC_BUILD_ID);
  expect(sha256File(BACKEND_JAR_PATH)).toBe(EXPECTED_BACKEND_JAR_SHA);
  expect(() => process.kill(EXPECTED_PC_PID, 0), "锁定的 PC 进程必须存活").not.toThrow();
  expect(() => process.kill(EXPECTED_BACKEND_PID, 0), "锁定的后端进程必须存活").not.toThrow();
  expect(checkerA.username, "Checker A 必须与 maker 不同").not.toBe(owner.username);
  expect(checkerB.username, "Checker B 必须与 maker 不同").not.toBe(owner.username);
  expect(checkerB.username, "两个 Checker 必须是不同账号").not.toBe(checkerA.username);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const idempotencyKey = `l-maker-${RUN_ID}-${randomUUID()}`;
  const runtimeEvidence: L3RuntimeEvidence = {
    runId: RUN_ID,
    idempotencyKey,
    maker: owner.username,
    checkerA: checkerA.username,
    checkerB: checkerB.username,
    statuses: {},
    sessionProfiles: {},
    candidate: {
      pcBuildId: EXPECTED_PC_BUILD_ID,
      pcPid: EXPECTED_PC_PID,
      backendJarSha256: EXPECTED_BACKEND_JAR_SHA,
      backendPid: EXPECTED_BACKEND_PID,
    },
    cleanup: { idempotency: [{ scope: "L_BI_REPORT_CREATE", key: idempotencyKey }] },
    outcome: { status: "RUNNING", startedAt: new Date().toISOString() },
  };
  persistL3Runtime(runtimeEvidence);
  try {
    await loginWithMfa(page, owner);
    const liveBuild = await page.request.get(`/_next/static/${EXPECTED_PC_BUILD_ID}/_buildManifest.js`);
    runtimeEvidence.candidate.liveBuildAssetStatus = liveBuild.status();
    persistL3Runtime(runtimeEvidence);
    expect(liveBuild.status(), "3002 必须服务锁定的 final2 Next build asset").toBe(200);
    await openL3FromSidebar(page);
    const makerSession = await currentSession(page);
    expect(owner.authorities, "L Owner fixture 必须声明精确 authorities").toBeTruthy();
    expect(makerSession.authorities).toEqual([...owner.authorities!].sort());
    expect(owner.effectiveMenus, "L Owner fixture 必须声明精确 effectiveMenus").toBeTruthy();
    expect(makerSession.menuCodes).toEqual([...owner.effectiveMenus!].sort());
    expect(makerSession.authorities).toEqual(expect.arrayContaining([
      "bi_l3_read",
      "bi_l3_write",
      "bi_l3_export_detail",
    ]));
    expect(makerSession.authorities).not.toContain("bi_l5_task_approve");
    const makerVisibleLeafPaths = await visibleConsoleLeafPaths(page);
    expect(makerVisibleLeafPaths, "L Owner 侧栏必须只显示 L1-L6 叶链接").toEqual(EXACT_OWNER_LEAF_PATHS);
    runtimeEvidence.sessionProfiles!.maker = {
      ...makerSession,
      visibleLeafPaths: makerVisibleLeafPaths,
    };
    persistL3Runtime(runtimeEvidence);
    const body = {
      exportType: "财务资金明细",
      timeRange: "2026-07-01/2026-07-31",
      fields: "交易时间,用户编码（脱敏）,业务编号,账单类型,资产,方向,金额,余额,状态",
      piiLevel: "HIGH_PII",
      maskPolicy: "MASKED",
      recipient: "L 域验收 maker-checker",
      ticket: `L-MAKER-CHECKER-${RUN_ID}`,
      reason: "L 域高风险敏感明细独立 maker checker 与 CAS 验收",
      operator: owner.username,
    };
    const created = await page.request.post("/api/admin/bi/reports", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: body,
    });
    const createdData = await okEnvelope<{
      created: { reportId: string; status: string; containsPii: boolean; maskingPolicy: string };
    }>(created);
    const reportId = createdData.created.reportId;
    runtimeEvidence.reportId = reportId;
    runtimeEvidence.statuses.create = created.status();
    runtimeEvidence.cleanup.reportId = reportId;
    runtimeEvidence.cleanup.minioObject = `bi-reports/${reportId.toLowerCase()}.csv`;
    persistL3Runtime(runtimeEvidence);
    expect(createdData.created).toMatchObject({
      status: "PENDING_CONFIRM",
      containsPii: true,
      maskingPolicy: "MASKED",
    });

    const replay = await page.request.post("/api/admin/bi/reports", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: body,
    });
    const replayData = await okEnvelope<{ created: { reportId: string; status: string } }>(replay);
    runtimeEvidence.statuses.replay = replay.status();
    expect(replayData.created.reportId).toBe(reportId);
    expect(replayData.created.status).toBe("PENDING_CONFIRM");

    const conflict = await page.request.post("/api/admin/bi/reports", {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { ...body, recipient: "同键异载荷不得执行" },
    });
    runtimeEvidence.statuses.sameKeyDifferentPayload = conflict.status();
    expect(conflict.status()).toBe(409);

    const makerSelfApproveKey = `l-maker-cannot-approve-${randomUUID()}`;
    runtimeEvidence.cleanup.idempotency.push({
      scope: "L_BI_REPORT_ACTION_APPROVE",
      key: makerSelfApproveKey,
    });
    persistL3Runtime(runtimeEvidence);
    const makerCannotApprove = await page.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
      headers: { "Idempotency-Key": makerSelfApproveKey },
      data: {
        includeSensitive: true,
        includeDecrypted: false,
        reason: "maker 不得自批敏感明细",
        operator: owner.username,
      },
    });
    runtimeEvidence.statuses.makerSelfApprove = makerCannotApprove.status();
    expect(makerCannotApprove.status()).toBe(403);

    const checkerAContext = await browser.newContext({ baseURL: BASE_URL });
    const checkerBContext = await browser.newContext({ baseURL: BASE_URL });
    const checkerAPage = await checkerAContext.newPage();
    const checkerBPage = await checkerBContext.newPage();
    try {
      await loginWithMfa(checkerBPage, checkerB);
      await loginWithMfa(checkerAPage, checkerA);
      for (const [label, reviewerPage] of [["checkerA", checkerAPage], ["checkerB", checkerBPage]] as const) {
        const session = await currentSession(reviewerPage);
        expect(session.authorities, `${label} 必须是精确 L3 checker 权限`).toEqual(EXACT_CHECKER_AUTHORITIES);
        expect(session.menuCodes, `${label} 必须只持有 A2/L3 叶菜单`).toEqual(EXACT_CHECKER_MENU_CODES);
        const visibleLeafPaths = await collectCheckerLeafPaths(reviewerPage);
        expect(visibleLeafPaths, `${label} 侧栏必须只显示 A2/L3 叶链接`).toEqual(EXACT_CHECKER_LEAF_PATHS);
        runtimeEvidence.sessionProfiles![label] = { ...session, visibleLeafPaths };
        persistL3Runtime(runtimeEvidence);
      }
      const approveBody = {
        includeSensitive: true,
        includeDecrypted: false,
        reason: "两个独立 checker 竞争批准，CAS 只允许一个成功",
      };
      const checkerAKey = `l-checker-a-${randomUUID()}`;
      const checkerBKey = `l-checker-b-${randomUUID()}`;
      runtimeEvidence.cleanup.idempotency.push(
        { scope: "L_BI_REPORT_ACTION_APPROVE", key: checkerAKey },
        { scope: "L_BI_REPORT_ACTION_APPROVE", key: checkerBKey },
      );
      persistL3Runtime(runtimeEvidence);
      const [checkerApprove, rootApprove] = await Promise.all([
        checkerAPage.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
          headers: { "Idempotency-Key": checkerAKey },
          data: { ...approveBody, operator: checkerA.username },
        }),
        checkerBPage.request.post(`/api/admin/bi/reports/${reportId}/approve`, {
          headers: { "Idempotency-Key": checkerBKey },
          data: { ...approveBody, operator: checkerB.username },
        }),
      ]);
      runtimeEvidence.statuses.checkerAApprove = checkerApprove.status();
      runtimeEvidence.statuses.checkerBApprove = rootApprove.status();
      const statuses = [checkerApprove.status(), rootApprove.status()].sort((left, right) => left - right);
      expect(statuses).toEqual([200, 409]);
    } finally {
      await checkerAContext.close();
      await checkerBContext.close();
    }

    const token = await page.request.get(`/api/admin/bi/exports/${reportId}/download-token`);
    const tokenData = await okEnvelope<{ downloadToken: string; expiresAt: string }>(token);
    expect(tokenData.downloadToken).not.toBe("");
    expect(Date.parse(tokenData.expiresAt)).toBeGreaterThan(Date.now());
    const downloaded = await page.request.get(
      `/api/admin/bi/exports/${reportId}/download?token=${encodeURIComponent(tokenData.downloadToken)}`,
    );
    runtimeEvidence.statuses.download = downloaded.status();
    expect(downloaded.status()).toBe(200);
    expect(downloaded.headers()["content-type"]).toContain("text/csv");
    const csv = await downloaded.text();
    expect(csv).toContain("用户编码（脱敏）");
    expect(csv).not.toMatch(/passport|phone|email/i);
    writeFileSync(path.join(EVIDENCE_DIR, `${reportId.toLowerCase()}-masked.csv`), csv, "utf8");
    runtimeEvidence.outcome.status = "PASSED";
  } catch (error) {
    runtimeEvidence.outcome.status = "FAILED";
    runtimeEvidence.outcome.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    runtimeEvidence.outcome.finishedAt = new Date().toISOString();
    persistL3Runtime(runtimeEvidence);
  }
});

function persistL3Runtime(value: L3RuntimeEvidence) {
  writeFileSync(path.join(EVIDENCE_DIR, "runtime-evidence.json"), JSON.stringify(value, null, 2), "utf8");
}

function sha256File(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

async function openL3FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /数据与分析 BI/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator('aside a[href="/analytics/financial"]').first();
  await expect(link, "L3 必须从可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/financial(?:\?.*)?$/);
  await expect(page.getByText(/财务报表/).first()).toBeVisible({ timeout: 30_000 });
}

function loadCheckerPair(): { checkerA: FixtureAccount; checkerB: FixtureAccount } {
  const parsed = JSON.parse(readFileSync(CHECKER_PAIR_PATH!, "utf8")) as CheckerPairFixture;
  const checkerA = parsed.accounts?.checkerA
    ?? parsed.finalAccounts?.checkerA
    ?? parsed.finalAccounts?.l3_checker_a
    ?? parsed.checkers?.[0];
  const checkerB = parsed.accounts?.checkerB
    ?? parsed.finalAccounts?.checkerB
    ?? parsed.finalAccounts?.l3_checker_b
    ?? parsed.checkers?.[1];
  for (const [label, account] of [["checkerA", checkerA], ["checkerB", checkerB]] as const) {
    if (!account?.username || !account.password || !account.totpSecret) {
      throw new Error(`L_CHECKER_PAIR_PATH must contain ${label} username, password and totpSecret`);
    }
  }
  return { checkerA: checkerA!, checkerB: checkerB! };
}

async function loginWithMfa(page: Page, account: FixtureAccount) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const aside = page.locator("aside");
  await expect.poll(async () => (await otp.isVisible()) || (await aside.isVisible()), {
    timeout: 10_000,
    message: "登录后必须进入 MFA 挑战或已认证控制台",
  }).toBe(true);
  if (await aside.isVisible()) return;
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(aside).toBeVisible({ timeout: 30_000 });
}

async function currentSession(page: Page) {
  const data = await okEnvelope<{
    session?: {
      authorities?: string[];
      menuCodes?: string[];
      effectiveMenus?: Array<string | { menuCode?: string }>;
    };
  }>(
    await page.request.get("/api/admin/auth/session"),
  );
  const effectiveMenus = data.session?.menuCodes ?? data.session?.effectiveMenus ?? [];
  const menuCodes = effectiveMenus
    .map((menu) => typeof menu === "string" ? menu : menu.menuCode ?? "")
    .filter(Boolean)
    .sort();
  return {
    authorities: [...(data.session?.authorities ?? [])].sort(),
    menuCodes,
  };
}

async function visibleConsoleLeafPaths(page: Page) {
  const paths = await page.locator('aside a[href^="/"]').evaluateAll((links) =>
    links
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => /^\/(?:platform|overview|users|finance|devices|network|finance-products|growth|content|emergency|risk|analytics|service)\//.test(href)),
  );
  return [...new Set(paths)].sort();
}

async function collectCheckerLeafPaths(page: Page) {
  const paths = new Set<string>();
  for (const groupName of [/平台基础/, /数据与分析 BI/]) {
    const group = page.getByRole("button", { name: groupName }).first();
    await expect(group, "checker 授权域必须出现在可见侧栏").toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    for (const leafPath of await visibleConsoleLeafPaths(page)) paths.add(leafPath);
  }
  return [...paths].sort();
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

const lastTotpStepBySecret = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previousStep = lastTotpStepBySecret.get(secret) ?? -1;
  if (step <= previousStep) {
    await new Promise((resolve) => setTimeout(resolve, ((previousStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStepBySecret.set(secret, step);
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
