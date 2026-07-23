import { expect, test, type APIResponse, type Page, type Request, type Response } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const evidenceRoot = process.env.K4_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-parallel-acceptance-20260722-192757/K4-scoring/evidence";
const username = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const runId = Date.now().toString(36);
const reason = `K4终验${runId}真实浏览器闭环与清理`;

function password() {
  const value = process.env.NEXION_E2E_PASSWORD;
  if (!value) throw new Error("NEXION_E2E_PASSWORD is required");
  return value;
}

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

mkdirSync(evidenceRoot, { recursive: true });
test.use({ trace: "off" });

async function api<T>(response: APIResponse): Promise<T> {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), body.message ?? "HTTP status").toBeLessThan(400);
  expect(body.code, body.message ?? "API code").toBe(0);
  return body.data;
}

async function login(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("账号")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(password());
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside").first()).toBeVisible({ timeout: 30_000 });
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

test("K4 first-user model, explainability, resilience, downstream and cleanup", async ({ page, playwright }) => {
  test.setTimeout(300_000);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const expectedAuthBoundaryErrors: string[] = [];
  const mutations: Array<{ method: string; path: string; status: number }> = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (/status of 401 \(Unauthorized\)/i.test(message.text())) {
      expectedAuthBoundaryErrors.push(message.text());
      return;
    }
    consoleErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/risk/scoring") && response.request().method() !== "GET") {
      mutations.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
    }
  });

  await login(page);
  await openK4(page);
  await page.screenshot({ path: path.join(evidenceRoot, "01-k4-visible-entry.png"), fullPage: true });

  const baseline = await overview(page);
  expect(baseline.draft, "预置草稿可能属于他人，终验不得覆盖").toBeNull();
  expect(baseline.dimensions).toHaveLength(6);
  const modelSection = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first();
  await expect(modelSection.locator('.w-row input[type="range"]')).toHaveCount(6);
  await modelSection.getByText(/子分映射版本快照/).click();
  await expect(modelSection.locator("details label.ktint input")).toHaveCount(24);
  await expect(page.getByText(/中风险起始分/).first()).toBeVisible();
  await expect(page.getByText(/高风险下限/).first()).toBeVisible();
  await expect(page.getByText(/自动升级线/).first()).toBeVisible();

  const weightInputs = modelSection.locator('.w-row input[type="number"]');
  const first = Number(await weightInputs.nth(0).inputValue());
  const second = Number(await weightInputs.nth(1).inputValue());
  const delta = first < 100 && second > 0 ? 1 : -1;
  await weightInputs.nth(0).fill(String(first + delta));
  await weightInputs.nth(1).fill(String(second - delta));
  const largeAmount = modelSection.locator("label.ktint").filter({ hasText: "大额单笔阈值" }).locator("input");
  await largeAmount.fill(String(Number(await largeAmount.inputValue()) + 1));
  await modelSection.getByRole("button", { name: "保存模型草稿" }).click();

  let draftRequest: Request | null = null;
  page.once("request", (request) => {
    if (request.method() === "PUT" && request.url().endsWith("/api/admin/risk/scoring/model/draft")) draftRequest = request;
  });
  await confirm(page, `${reason}保存差异草稿`, (response) =>
    response.request().method() === "PUT" && response.url().endsWith("/api/admin/risk/scoring/model/draft"));
  const saved = await overview(page);
  expect(saved.draft).not.toBeNull();
  expect(saved.draft!.weights).not.toEqual(baseline.model.weights);

  // Same key/same payload replays; same key/different payload fails closed.
  expect(draftRequest).not.toBeNull();
  const savedHeaders = draftRequest!.headers();
  const savedBody = draftRequest!.postDataJSON();
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

  await modelSection.getByRole("button", { name: "发布模型草稿" }).click();
  await confirm(page, `${reason}发布差异模型`, (response) =>
    response.request().method() === "POST" && response.url().endsWith("/api/admin/risk/scoring/model/publish"));
  let published = await overview(page);
  expect(published.model.version).toBeGreaterThan(baseline.model.version);

  for (let attempt = 0; attempt < 30 && published.recomputePending > 0; attempt += 1) {
    await page.waitForTimeout(1_000);
    published = await overview(page);
  }
  expect(published.recomputePending).toBe(0);
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
  for (let attempt = 0; attempt < 30 && restored.recomputePending > 0; attempt += 1) {
    await page.waitForTimeout(1_000);
    restored = await overview(page);
  }
  sameModelConfig(restored.model, baseline.model);
  expect(restored.draft).toBeNull();
  expect(restored.recomputePending).toBe(0);

  const options = await api<Array<{ userNo: string }>>(await page.request.get("/api/admin/risk/scoring/users?keyword=U&limit=8"));
  let target: ScoreUser | null = null;
  for (const option of options) {
    const candidate = await scoreUser(page, option.userNo);
    if (!candidate.overridden) { target = candidate; break; }
  }
  expect(target, "需找到未被覆盖的真实用户以保证可逆清理").not.toBeNull();
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
  let overrideRequest: Request | null = null;
  page.once("request", (request) => {
    if (request.method() === "POST" && request.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}/override`)) overrideRequest = request;
  });
  await confirm(page, `${reason}人工覆盖后立即回归`, (response) =>
    response.request().method() === "POST" && response.url().includes(`/api/admin/risk/scoring/users/${target!.userNo}/override`));
  const overridden = await scoreUser(page, target!.userNo);
  expect(overridden.overridden).toBe(true);
  expect(overridden.effectiveScore).toBe(overrideScore);
  expect(overridden.history.some((row) =>
    row.effectiveScore === overrideScore
    && row.scoreState === "manually-overridden"
    && row.reason === `${reason}人工覆盖后立即回归`)).toBe(true);
  await page.screenshot({ path: path.join(evidenceRoot, "03-user-override-explainability.png"), fullPage: true });

  const overrideHeaders = overrideRequest!.headers();
  const overrideBody = overrideRequest!.postDataJSON();
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

  await page.goto("/finance/withdrawals");
  await expect(page.getByText(/K4 风险分/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/K3/).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceRoot, "04-d2-k3-k4-joint-read.png"), fullPage: true });
  await page.goto("/overview/risk-radar");
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

  await page.context().clearCookies();
  await login(page);
  await openK4(page);
  const afterRelogin = await overview(page);
  sameModelConfig(afterRelogin.model, baseline.model);
  expect(afterRelogin.draft).toBeNull();
  expect((await scoreUser(page, target!.userNo)).overridden).toBe(false);
  await page.screenshot({ path: path.join(evidenceRoot, "06-relogin-clean-state.png"), fullPage: true });

  expect(pageErrors).toEqual([]);
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
    failureModes: ["anonymous-401", "model-cas-409", "score-cas-409", "idempotency-mismatch-409", "batch-cap-422"],
    mutations,
    pageErrors,
    consoleErrors,
    expectedAuthBoundary401s: expectedAuthBoundaryErrors.length,
  }, null, 2));
});
