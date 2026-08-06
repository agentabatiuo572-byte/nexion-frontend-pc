import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const evidenceRoot = process.env.K4_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-parallel-acceptance-20260722-192757/K4-scoring/evidence";
const MAKER_USERNAME = requiredEnv("K4_MAKER_USERNAME");
const MAKER_PASSWORD = requiredEnv("K4_MAKER_PASSWORD");
const MAKER_TOTP_SECRET = requiredEnv("K4_MAKER_TOTP_SECRET");
const PUBLISHER_USERNAME = requiredEnv("K4_PUBLISHER_USERNAME");
const PUBLISHER_PASSWORD = requiredEnv("K4_PUBLISHER_PASSWORD");
const PUBLISHER_TOTP_SECRET = requiredEnv("K4_PUBLISHER_TOTP_SECRET");
const CROSS_USERNAME = requiredEnv("K4_CROSS_USERNAME");
const CROSS_PASSWORD = requiredEnv("K4_CROSS_PASSWORD");
const CROSS_TOTP_SECRET = requiredEnv("K4_CROSS_TOTP_SECRET");
const DB_PASSWORD = requiredEnv("K4_DB_PASSWORD");
const DB_NAME = process.env.K4_DB_NAME ?? "nexion";
const MYSQL = process.env.K4_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const runId = Date.now().toString(36);
const reason = `K4终验${runId}真实浏览器闭环与清理`;
const MFA_SECRETS = new Map([
  [MAKER_USERNAME, MAKER_TOTP_SECRET],
  [PUBLISHER_USERNAME, PUBLISHER_TOTP_SECRET],
  [CROSS_USERNAME, CROSS_TOTP_SECRET],
]);
const MFA_COUNTERS = new Map<string, number>();

type Envelope<T> = { code: number; message?: string; data: T };
type Model = {
  version: number; rowVersion: number; state: string;
  weights: Record<string, number>; inputSources: Record<string, boolean>;
  scoreMappings: Record<string, number>; bandLowMax: number; bandHighMin: number;
  autoEscalateScore: number;
};
type Overview = {
  model: Model; draft: Model | null; dimensions: Array<{ dimKey: string; name: string }>;
  modelHistory: Model[]; recomputePending: number; totalUsers: number;
};
type ScoreUser = {
  userNo: string; modelScore: number; effectiveScore: number; overridden: boolean;
  modelVersion: string; rowVersion: number; contributions: unknown[];
  history: Array<{
    modelVersion: number; modelScore: number; effectiveScore: number; scoreState: string;
    contributions: unknown[]; reason: string; operator: string; createdAt: string;
  }>;
};

let cleanupBaseline: Model | null = null;
let cleanupUserNo = "";
let idempotencyBaseline = 0;

mkdirSync(evidenceRoot, { recursive: true });
test.use({ trace: "on", video: "on" });

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mysql(sql: string) {
  return execFileSync(MYSQL, ["-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  }).trim();
}

test.beforeAll(() => {
  idempotencyBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_admin_idempotency_record;"));
});

async function api<T>(response: APIResponse): Promise<T> {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), body.message ?? "HTTP status").toBeLessThan(400);
  expect(body.code, body.message ?? "API code").toBe(0);
  return body.data;
}

async function login(page: Page, username: string, password: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByLabel("账号")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const mfa = page.getByRole("heading", { name: "双因素身份验证" });
  await Promise.race([
    page.locator("aside").first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    mfa.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
  ]);
  if (await mfa.isVisible().catch(() => false)) {
    const displayed = (await page.locator("code").textContent({ timeout: 2_000 }).catch(() => null))?.trim();
    if (displayed) MFA_SECRETS.set(username, displayed);
    const secret = displayed || MFA_SECRETS.get(username);
    if (!secret) throw new Error(`K4_TOTP_SECRET_UNAVAILABLE_${username}`);
    let counter = Math.floor(Date.now() / 30_000);
    const prior = MFA_COUNTERS.get(username);
    if (prior != null && counter <= prior) {
      const waitMs = 30_000 - (Date.now() % 30_000) + 500;
      await page.waitForTimeout(waitMs);
      counter = Math.floor(Date.now() / 30_000);
    }
    MFA_COUNTERS.set(username, counter);
    await page.getByLabel("一次性验证码").fill(totp(secret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel("账号")).toBeVisible({ timeout: 20_000 });
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("K4_TOTP_SECRET_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function openK4(page: Page) {
  const link = page.locator('aside a[href="/risk/scoring"]').first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.locator('button[aria-controls="nav-group-K"]');
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/scoring/);
  await expect(page.getByText("K4 评分模型", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/K4 数据加载中|K4 读取失败|K4 数据不可用/)).toHaveCount(0);
}

async function openSidebarPath(page: Page, href: string, groupPattern: RegExp) {
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    const group = page.getByRole("button", { name: groupPattern }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link, `${href} 必须由当前角色的可见侧栏进入`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
}

async function overview(page: Page) {
  return api<Overview>(await page.request.get("/api/admin/risk/scoring/overview?overridePageNum=1&overridePageSize=50"));
}

async function scoreUser(page: Page, userNo: string) {
  return api<ScoreUser>(await page.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(userNo)}`));
}

async function confirm(page: Page, text: string, responseMatcher: (response: Response) => boolean) {
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await dialog.locator("textarea").fill(text);
  const responsePromise = page.waitForResponse(responseMatcher);
  await dialog.getByRole("button", { name: /^确认/ }).last().click();
  const response = await responsePromise;
  expect(response.status()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 30_000 });
  return response;
}

function sameModelConfig(left: Model, right: Model) {
  expect(left.weights).toEqual(right.weights);
  expect(left.inputSources).toEqual(right.inputSources);
  expect(left.scoreMappings).toEqual(right.scoreMappings);
  expect(left.bandLowMax).toBe(right.bandLowMax);
  expect(left.bandHighMin).toBe(right.bandHighMin);
  expect(left.autoEscalateScore).toBe(right.autoEscalateScore);
}

function modelConfigSignature(model: Model) {
  return canonicalJson({
    weights: model.weights,
    inputSources: model.inputSources,
    scoreMappings: model.scoreMappings,
    bandLowMax: model.bandLowMax,
    bandHighMin: model.bandHighMin,
    autoEscalateScore: model.autoEscalateScore,
  });
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

test.afterAll(async ({ browser }) => {
  const cleanupErrors: string[] = [];
  if (cleanupBaseline) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await login(page, PUBLISHER_USERNAME, PUBLISHER_PASSWORD);
      let current = await overview(page);
      if (current.draft || modelConfigSignature(current.model) !== modelConfigSignature(cleanupBaseline)) {
        const expectedVersion = current.draft?.rowVersion ?? current.model.rowVersion;
        const restored = await page.request.post("/api/admin/risk/scoring/model/restore-draft", {
          headers: { "Idempotency-Key": `k4-${runId}-cleanup-restore` },
          data: {
            modelVersion: cleanupBaseline.version,
            expectedVersion,
            reason: `${reason} RED/PASS清理恢复基线草稿`,
          },
        });
        if (restored.status() >= 400) throw new Error(`restore baseline failed ${restored.status()}: ${await restored.text()}`);
        current = await overview(page);
        if (!current.draft) throw new Error("K4 cleanup baseline draft missing");
        const published = await page.request.post("/api/admin/risk/scoring/model/publish", {
          headers: { "Idempotency-Key": `k4-${runId}-cleanup-publish` },
          data: {
            expectedVersion: current.draft.rowVersion,
            reason: `${reason} RED/PASS清理发布基线模型`,
          },
        });
        if (published.status() >= 400) throw new Error(`publish baseline failed ${published.status()}: ${await published.text()}`);
      }
      if (cleanupUserNo) {
        await logout(page);
        await login(page, MAKER_USERNAME, MAKER_PASSWORD);
        const user = await scoreUser(page, cleanupUserNo);
        if (user.overridden) {
          const recomputed = await page.request.post(`/api/admin/risk/scoring/users/${cleanupUserNo}/recompute`, {
            headers: { "Idempotency-Key": `k4-${runId}-cleanup-user` },
            data: {
              expectedVersion: user.rowVersion,
              reason: `${reason} RED/PASS清理人工覆盖`,
            },
          });
          if (recomputed.status() >= 400) throw new Error(`recompute cleanup failed ${recomputed.status()}: ${await recomputed.text()}`);
        }
      }
      const verified = await overview(page);
      if (verified.draft || modelConfigSignature(verified.model) !== modelConfigSignature(cleanupBaseline)) {
        throw new Error("K4 cleanup did not restore the active model and remove the draft");
      }
      if (cleanupUserNo && (await scoreUser(page, cleanupUserNo)).overridden) {
        throw new Error("K4 cleanup did not remove the user override");
      }
    } catch (error) {
      cleanupErrors.push(error instanceof Error ? error.message : String(error));
    } finally {
      await context.close();
    }
  }
  try {
    mysql(`
      DELETE FROM nx_admin_idempotency_record
       WHERE id>${idempotencyBaseline}
         AND scope LIKE 'K4_%';
    `);
    if (cleanupBaseline) {
      const residual = mysql(`
        SELECT CONCAT(
          (SELECT COUNT(*) FROM nx_admin_risk_score_model WHERE state='draft' AND is_deleted=0),',',
          (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE id>${idempotencyBaseline} AND scope LIKE 'K4_%')
        );
      `);
      if (residual !== "0,0") throw new Error(`K4 cleanup residuals ${residual}`);
    }
  } catch (error) {
    cleanupErrors.push(error instanceof Error ? error.message : String(error));
  }
  if (cleanupErrors.length > 0) throw new Error(`K4 cleanup failed: ${cleanupErrors.join(" | ")}`);
});

test("K4 first-user model, explainability, resilience, downstream and cleanup", async ({ page, playwright }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const expectedAuthBoundaryErrors: string[] = [];
  const mutations: Array<{ method: string; path: string; status: number }> = [];
  const serverErrors: Array<{ method: string; path: string; status: number }> = [];
  const forbiddenResponses: Array<{ actor: string; method: string; path: string; status: number }> = [];
  const accountAlertRequests: Array<{ actor: string; method: string; path: string }> = [];
  let currentActor = "maker";
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/status of 401 \(Unauthorized\)/i.test(message.text())) {
      expectedAuthBoundaryErrors.push(message.text());
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/admin/users/account-actions/alerts") {
      accountAlertRequests.push({ actor: currentActor, method: request.method(), path: url.pathname });
    }
  });
  page.on("response", (response) => {
    if (response.status() === 403) {
      forbiddenResponses.push({
        actor: currentActor,
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
    if (response.status() >= 500) {
      serverErrors.push({
        method: response.request().method(),
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
    if (response.url().includes("/api/admin/risk/scoring") && response.request().method() !== "GET") {
      mutations.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
    }
  });

  await login(page, MAKER_USERNAME, MAKER_PASSWORD);
  await openK4(page);
  await page.screenshot({ path: path.join(evidenceRoot, "01-k4-visible-entry.png"), fullPage: true });

  const baseline = await overview(page);
  cleanupBaseline = baseline.model;
  expect(baseline.draft, "预置草稿可能属于他人，终验不得覆盖").toBeNull();
  expect(baseline.dimensions).toHaveLength(6);
  const modelSection = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first();
  await expect(modelSection.locator('.w-row input[type="range"]')).toHaveCount(6);
  await modelSection.getByText(/子分映射版本快照/).click();
  await expect(modelSection.locator("details label.ktint input")).toHaveCount(24);
  await expect(page.getByText(/中风险起始分/).first()).toBeVisible();
  await expect(page.getByText(/高风险下限/).first()).toBeVisible();
  await expect(page.getByText(/自动升级线/).first()).toBeVisible();

  const highBandInput = modelSection.getByRole("spinbutton", { name: /^高风险下限 ·/ });
  const escalationInput = modelSection.getByRole("spinbutton", { name: /^自动升级线 ·/ });
  if (baseline.model.autoEscalateScore < 100) {
    await highBandInput.fill(String(baseline.model.autoEscalateScore + 1));
  } else {
    await escalationInput.fill(String(Math.max(0, baseline.model.bandHighMin - 1)));
  }
  await expect(modelSection.getByText("自动升级线不能低于高风险下限；请先调整这两个阈值。")).toBeVisible();
  await expect(modelSection.getByRole("button", { name: "保存模型草稿" })).toBeDisabled();
  await highBandInput.fill(String(baseline.model.bandHighMin));
  await escalationInput.fill(String(baseline.model.autoEscalateScore));
  await expect(modelSection.getByText("自动升级线不能低于高风险下限；请先调整这两个阈值。")).toHaveCount(0);

  const weightInputs = modelSection.locator('.w-row input[type="number"]');
  const first = Number(await weightInputs.nth(0).inputValue());
  const second = Number(await weightInputs.nth(1).inputValue());
  const delta = first < 100 && second > 0 ? 1 : -1;
  await weightInputs.nth(0).fill(String(first + delta));
  await weightInputs.nth(1).fill(String(second - delta));
  const largeAmount = modelSection.getByRole("spinbutton", { name: "大额单笔阈值（USD）", exact: true });
  await largeAmount.fill(String(Number(await largeAmount.inputValue()) + 1));
  await modelSection.getByRole("button", { name: "保存模型草稿" }).click();

  const draftRequestPromise = page.waitForRequest((request) =>
    request.method() === "PUT" && request.url().endsWith("/api/admin/risk/scoring/model/draft"));
  await confirm(page, `${reason}保存差异草稿`, (response) =>
    response.request().method() === "PUT" && response.url().endsWith("/api/admin/risk/scoring/model/draft"));
  const draftRequest = await draftRequestPromise;
  const saved = await overview(page);
  expect(saved.draft).not.toBeNull();
  expect(saved.draft!.weights).not.toEqual(baseline.model.weights);

  // Same key/same payload replays; same key/different payload fails closed.
  const savedHeaders = draftRequest.headers();
  const savedBody = draftRequest.postDataJSON();
  const replay = await page.request.put("/api/admin/risk/scoring/model/draft", {
    headers: { "Idempotency-Key": savedHeaders["idempotency-key"] }, data: savedBody,
  });
  expect(replay.status()).toBeLessThan(400);
  const mismatch = await page.request.put("/api/admin/risk/scoring/model/draft", {
    headers: { "Idempotency-Key": savedHeaders["idempotency-key"] },
    data: { ...savedBody, reason: `${reason}不同载荷必须拒绝` },
  });
  expect(mismatch.status()).toBe(409);

  const stale = await page.request.put("/api/admin/risk/scoring/model/draft", {
    headers: { "Idempotency-Key": `k4-stale-${runId}` },
    data: { ...savedBody, expectedVersion: baseline.model.rowVersion, reason: `${reason}陈旧CAS必须拒绝` },
  });
  expect(stale.status()).toBe(409);

  await expect(modelSection.getByRole("button", { name: "发布模型草稿" })).toHaveCount(0);
  await logout(page);
  currentActor = "publisher";
  await login(page, PUBLISHER_USERNAME, PUBLISHER_PASSWORD);
  const publisherSession = await api<{ session?: { roleCode?: string } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  expect(publisherSession.session?.roleCode).toBe("SUPER_ADMIN");
  await openK4(page);
  await modelSection.getByRole("button", { name: "发布模型草稿" }).click();
  await confirm(page, `${reason}发布差异模型`, (response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/admin/risk/scoring/model/publish"));
  let published = await overview(page);
  expect(published.model.version).toBeGreaterThan(baseline.model.version);
  await expect.poll(async () => {
    published = await overview(page);
    return published.recomputePending;
  }, { timeout: 30_000, intervals: [1_000] }).toBe(0);
  await page.screenshot({ path: path.join(evidenceRoot, "02-model-published-sharded-green.png"), fullPage: true });

  const historySection = page.locator("section.l-card").filter({ hasText: "模型版本历史" });
  const baselineHistory = historySection.locator(".ktint").filter({ hasText: new RegExp(`v${baseline.model.version}.*archived`) }).first();
  await expect(baselineHistory).toBeVisible();
  await baselineHistory.getByRole("button", { name: "恢复为草稿" }).click();
  await confirm(page, `${reason}恢复基线历史快照`, (response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/admin/risk/scoring/model/restore-draft"));
  await modelSection.getByRole("button", { name: "发布模型草稿" }).click();
  await confirm(page, `${reason}发布基线清理模型`, (response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/admin/risk/scoring/model/publish"));
  let restored = await overview(page);
  await expect.poll(async () => {
    restored = await overview(page);
    return restored.recomputePending;
  }, { timeout: 30_000, intervals: [1_000] }).toBe(0);
  sameModelConfig(restored.model, baseline.model);
  expect(restored.draft).toBeNull();
  expect(restored.recomputePending).toBe(0);

  await logout(page);
  currentActor = "maker";
  await login(page, MAKER_USERNAME, MAKER_PASSWORD);
  await openK4(page);
  const options = await api<Array<{ userNo: string }>>(await page.request.get("/api/admin/risk/scoring/users?keyword=U&limit=8"));
  let target: ScoreUser | null = null;
  for (const option of options) {
    const candidate = await scoreUser(page, option.userNo);
    if (!candidate.overridden) { target = candidate; break; }
  }
  expect(target, "需找到未被覆盖的真实用户以保证可逆清理").not.toBeNull();
  cleanupUserNo = target!.userNo;
  expect(target!.contributions).toHaveLength(6);

  const search = page.getByPlaceholder("搜索用户编号 / 用户名 / 手机号");
  await search.fill(target!.userNo);
  const listboxId = await search.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  const userResponse = page.waitForResponse((response) =>
    response.request().method() === "GET"
    && response.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}`));
  await page.locator(`[id="${listboxId}"]`).getByRole("option").filter({ hasText: target!.userNo }).first().click();
  await userResponse;
  await expect(page).toHaveURL(/\/risk\/scoring/);
  await expect(page.locator(".score-hero")).toContainText(target!.userNo);
  const overrideScore = target!.modelScore === 35 ? 36 : 35;
  await page.getByRole("button", { name: "人工覆盖评分" }).click();
  const overrideDialog = page.getByRole("dialog").last();
  await overrideDialog.locator('input[type="number"]').fill(String(overrideScore));
  const overrideRequestPromise = page.waitForRequest((request) =>
    request.method() === "POST"
    && request.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}/override`));
  await confirm(page, `${reason}人工覆盖后立即回归`, (response) =>
    response.request().method() === "POST" && response.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}/override`));
  const overrideRequest = await overrideRequestPromise;
  const overridden = await scoreUser(page, target!.userNo);
  expect(overridden.overridden).toBe(true);
  expect(overridden.effectiveScore).toBe(overrideScore);
  expect(overridden.history.some((row) =>
    row.effectiveScore === overrideScore
    && row.scoreState === "manually-overridden"
    && row.reason === `${reason}人工覆盖后立即回归`)).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "03-user-override-explainability.png"), fullPage: true });

  const overrideHeaders = overrideRequest.headers();
  const overrideBody = overrideRequest.postDataJSON();
  const overrideReplay = await page.request.post(`/api/admin/risk/scoring/users/${target!.userNo}/override`, {
    headers: { "Idempotency-Key": overrideHeaders["idempotency-key"] }, data: overrideBody,
  });
  expect(overrideReplay.status()).toBeLessThan(400);
  const overrideMismatch = await page.request.post(`/api/admin/risk/scoring/users/${target!.userNo}/override`, {
    headers: { "Idempotency-Key": overrideHeaders["idempotency-key"] },
    data: { ...overrideBody, score: overrideScore === 35 ? 34 : 35 },
  });
  expect(overrideMismatch.status()).toBe(409);

  await page.getByRole("button", { name: "重算回模型分", exact: true }).click();
  await confirm(page, `${reason}清理人工覆盖回归模型`, (response) =>
    response.request().method() === "POST" && response.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}/recompute`));
  const recomputed = await scoreUser(page, target!.userNo);
  expect(recomputed.overridden).toBe(false);
  expect(recomputed.effectiveScore).toBe(recomputed.modelScore);
  expect(recomputed.contributions).toHaveLength(6);
  expect(recomputed.history[0]?.scoreState).toBe("model-scored");
  expect(recomputed.history[0]?.effectiveScore).toBe(recomputed.modelScore);
  expect(recomputed.history[0]?.contributions).toHaveLength(6);

  const staleOverride = await page.request.post(`/api/admin/risk/scoring/users/${target!.userNo}/override`, {
    headers: { "Idempotency-Key": `k4-user-stale-${runId}` },
    data: { score: overrideScore, expectedVersion: target!.rowVersion, reason: `${reason}用户陈旧CAS必须拒绝` },
  });
  expect(staleOverride.status()).toBe(409);
  const tooLarge = await page.request.post("/api/admin/risk/scoring/users/recompute", {
    headers: { "Idempotency-Key": `k4-batch-large-${runId}` },
    data: {
      userNos: Array.from({ length: 1001 }, (_, index) => `K4_FAKE_${index}`),
      expectedModelVersion: restored.model.version,
      reason: `${reason}超千人必须失败关闭`,
    },
  });
  expect(tooLarge.status()).toBe(422);

  await logout(page);
  currentActor = "cross";
  await login(page, CROSS_USERNAME, CROSS_PASSWORD);
  await openSidebarPath(page, "/finance/withdrawals", /资金.*D|D.*资金/);
  await expect(page.getByText("高优先队列", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("按当前生效 K4 模型动态路由", { exact: true })).toBeVisible();
  const emptyWithdrawalQueue = page.getByText("暂无提现记录", { exact: true });
  if (await emptyWithdrawalQueue.isVisible().catch(() => false)) {
    await expect(emptyWithdrawalQueue).toBeVisible();
  } else {
    await expect(page.getByText(/K4 \d+|K4 风险评分不可用/).first()).toBeVisible();
    await expect(page.getByText(/K3 /).first()).toBeVisible();
  }
  await page.screenshot({ path: path.join(evidenceRoot, "04-d2-k3-k4-joint-read.png"), fullPage: true });
  await openSidebarPath(page, "/overview/risk-radar", /驾驶舱.*B|B.*驾驶舱|总览/);
  await expect(page.getByText("风险雷达", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const bDomain = await api<Record<string, any>>(await page.request.get("/api/admin/treasury/b-domain"));
  expect(bDomain.riskRadar.k4ScoringAvailable).toBe(true);
  expect(String(bDomain.riskRadar.k4ModelVersion)).toMatch(/^k4-v\d+$/);
  expect(bDomain.riskRadar.sources).toContain("nx_admin_risk_score_user:current-model");
  expect(bDomain.riskRadar.sources).toContain("nx_risk_signal:TAMPER_DETECTED");
  await page.screenshot({ path: path.join(evidenceRoot, "05-b5-k4-j3-joint-read.png"), fullPage: true });

  const anonymous = await playwright.request.newContext({ baseURL: "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/risk/scoring/overview")).status()).toBe(401);
  await anonymous.dispose();

  await logout(page);
  currentActor = "maker";
  await login(page, MAKER_USERNAME, MAKER_PASSWORD);
  await openK4(page);
  const afterRelogin = await overview(page);
  sameModelConfig(afterRelogin.model, baseline.model);
  expect(afterRelogin.draft).toBeNull();
  expect((await scoreUser(page, target!.userNo)).overridden).toBe(false);
  await page.screenshot({ path: path.join(evidenceRoot, "06-relogin-clean-state.png"), fullPage: true });

  await page.route("**/api/admin/risk/scoring/overview?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        code: 0,
        message: "OK",
        data: {
          ...afterRelogin,
          model: {
            ...afterRelogin.model,
            bandHighMin: 90,
            autoEscalateScore: 85,
          },
        },
      }),
    });
  });
  await page.reload();
  await expect(page.getByText(/K4 读取失败/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "保存模型草稿" })).toHaveCount(0);
  await page.screenshot({ path: path.join(evidenceRoot, "07-invalid-authoritative-model-fails-closed.png"), fullPage: true });
  await page.unroute("**/api/admin/risk/scoring/overview?**");
  await page.reload();
  await expect(page.getByText("K4 评分模型", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/K4 数据加载中|K4 读取失败|K4 数据不可用/)).toHaveCount(0);

  expect(pageErrors).toEqual([]);
  expect(serverErrors).toEqual([]);
  expect(forbiddenResponses).toEqual([]);
  expect(accountAlertRequests.filter((request) => request.actor === "cross")).toEqual([]);
  expect(consoleErrors.filter((message) => !/favicon|webpack-hmr/i.test(message))).toEqual([]);
  expect(mutations.every((row) => row.status < 400 || row.status === 409 || row.status === 422)).toBe(true);
  writeFileSync(path.join(evidenceRoot, "k4-live-summary.json"), JSON.stringify({
    runId,
    baselineModelVersion: baseline.model.version,
    finalModelVersion: afterRelogin.model.version,
    userNo: target!.userNo,
    dimensions: baseline.dimensions.length,
    mappingCount: Object.keys(baseline.model.scoreMappings).length,
    restoredConfig: true,
    draftClean: afterRelogin.draft === null,
    overrideClean: !(await scoreUser(page, target!.userNo)).overridden,
    recomputePending: afterRelogin.recomputePending,
    failureModes: [
      "anonymous-401",
      "model-cas-409",
      "score-cas-409",
      "idempotency-mismatch-409",
      "batch-cap-422",
      "escalation-below-high-disabled",
      "invalid-authoritative-model-fail-closed",
    ],
    mutations,
    serverErrors,
    forbiddenResponses,
    accountAlertRequests,
    pageErrors,
    consoleErrors,
    expectedAuthBoundary401s: expectedAuthBoundaryErrors.length,
  }, null, 2));
});
