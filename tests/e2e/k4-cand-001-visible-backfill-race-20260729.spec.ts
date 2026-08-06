import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Envelope<T> = { code?: number; message?: string; data: T };
type Account = { username: string; password: string; totpSecret?: string };
type Fixture = { accounts: Record<string, Account>; checker?: Account };
type Model = {
  version: number;
  rowVersion: number;
  state: string;
  weights: Record<string, number>;
  inputSources: Record<string, boolean>;
  scoreMappings: Record<string, number>;
  bandLowMax: number;
  bandHighMin: number;
  autoEscalateScore: number;
};
type Overview = { model: Model; draft: Model | null; recomputePending: number; totalUsers: number; modelHistory: Model[] };
type ScoreUser = {
  userNo: string;
  modelScore: number;
  effectiveScore: number;
  overridden: boolean;
  modelVersion: string;
  rowVersion: number;
};
type HttpEvidence = { operation: "publish" | "override" | "restore" | "recompute"; method: string; path: string; status: number; idempotencyKey?: string };

test.describe.configure({ mode: "serial", timeout: 360_000 });

test("K-CAND-001：两名运营员在可见 K4 回填窗口发布并人工覆盖后完整恢复", async ({ browser }) => {
  const config = readConfig();
  mkdirSync(config.evidenceDir, { recursive: true });
  const run = `K4-CAND-001-${Date.now().toString(36)}`;
  const rootContext = await browser.newContext({ baseURL: config.baseUrl });
  const checkerContext = await browser.newContext({ baseURL: config.baseUrl });
  const rootPage = await rootContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const expectedConsoleBoundaryErrors: string[] = [];
  const requestFailures: Array<{ url: string; failure: string | null }> = [];
  const http: HttpEvidence[] = [];
  let baseline: Overview | null = null;
  let beforeUser: ScoreUser | null = null;
  let backfillWindow: { observedAt: string; signal: "publish-200"; recomputePending: number; modelVersion: number } | null = null;
  let publishResponse: Response | null = null;
  let overrideResponse: Response | null = null;
  let overrideRetryResponse: Response | null = null;
  let finalOverview: Overview | null = null;
  let finalUser: ScoreUser | null = null;
  let cleanupComplete = false;

  const capture = (page: Page) => {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error" || /favicon|webpack-hmr/i.test(message.text())) return;
      if (/status of (401|409) \((Unauthorized|Conflict)\)/i.test(message.text())) {
        expectedConsoleBoundaryErrors.push(message.text());
        return;
      }
      consoleErrors.push(message.text());
    });
    page.on("requestfailed", (request) => {
      if (request.url().includes("/api/admin/risk/scoring")) {
        requestFailures.push({ url: request.url(), failure: request.failure()?.errorText ?? null });
      }
    });
    page.on("response", (response) => captureMutation(response, http));
  };
  capture(rootPage);
  capture(checkerPage);

  try {
    await login(rootPage, config.root);
    await login(checkerPage, config.checker);
    await assertAuthority(rootPage, "risk_k4_write");
    await assertAuthority(rootPage, "risk_k4_user_override");
    await assertAuthority(rootPage, "risk_k4_user_recompute");
    await assertAuthority(checkerPage, "risk_k4_user_override");
    await openK4FromSidebar(rootPage);
    await openK4FromSidebar(checkerPage);

    baseline = await readOverview(rootPage);
    expect(baseline.draft, "本轮只能从没有他人草稿的隔离基线开始").toBeNull();
    beforeUser = await readUser(rootPage, config.targetUserNo);
    expect(beforeUser.overridden, "隔离用户在本轮开始前不得存在人工覆盖").toBe(false);
    expect(beforeUser.effectiveScore).toBe(beforeUser.modelScore);
    await selectUserViaVisibleUi(checkerPage, config.targetUserNo);
    await expect(checkerPage.locator(".score-hero")).toContainText(config.targetUserNo);
    await rootPage.screenshot({ path: path.join(config.evidenceDir, "01-root-k4-baseline.png"), fullPage: true });
    await checkerPage.screenshot({ path: path.join(config.evidenceDir, "02-checker-k4-target-ready.png"), fullPage: true });

    await saveMinimalDifferenceThroughUi(rootPage, `${run} 保存最小模型差异`);
    const published = await publishModelThroughUi(rootPage, `${run} 发布并触发分片回填`);
    publishResponse = published;
    expect(published.status(), await published.text()).toBe(200);

    // The candidate server starts the asynchronous backfill after this successful publish.  The
    // current overview endpoint can report zero while that worker is still writing users, so the
    // browser-side synchronization point is the actual publish 200 rather than an unreliable
    // presentation counter.  The counter is retained as evidence for the owner to reconcile
    // against DB/outbox afterwards.
    backfillWindow = await capturePostPublishWindow(rootPage);
    await checkerPage.screenshot({ path: path.join(config.evidenceDir, "03-checker-before-override-in-backfill-window.png"), fullPage: true });
    const overrideScore = beforeUser.modelScore === 100 ? 99 : beforeUser.modelScore + 1;
    const firstOverride = await overrideThroughUi(checkerPage, overrideScore, `${run} 回填窗口人工覆盖`);
    overrideResponse = firstOverride;
    expect([200, 409], await firstOverride.text()).toContain(firstOverride.status());
    if (firstOverride.status() === 409) {
      // The stale view must fail closed, then a real operator refreshes the visible screen and retries only with
      // the server's latest row version.  A 5xx here would remain an unexpected hard failure.
      await checkerPage.reload();
      await openK4FromSidebar(checkerPage);
      await selectUserViaVisibleUi(checkerPage, config.targetUserNo);
      const retriedOverride = await overrideThroughUi(checkerPage, overrideScore, `${run} 回填冲突后刷新重试`);
      overrideRetryResponse = retriedOverride;
      expect(retriedOverride.status(), await retriedOverride.text()).toBe(200);
    }
    await expect(checkerPage.getByText(new RegExp(`用户 ${escapeRegExp(config.targetUserNo)} 的人工覆盖已生效`))).toBeVisible({ timeout: 30_000 });
    await checkerPage.screenshot({ path: path.join(config.evidenceDir, "04-checker-override-result.png"), fullPage: true });

    await waitForQueueDrain(rootPage);
    await restoreBaselineModelThroughUi(rootPage, baseline, `${run} 恢复基线模型`);
    await waitForQueueDrain(rootPage);
    await restoreUserThroughUi(rootPage, config.targetUserNo, `${run} 清理人工覆盖`);
    finalOverview = await readOverview(rootPage);
    finalUser = await readUser(rootPage, config.targetUserNo);
    expect(finalOverview.draft).toBeNull();
    expect(finalOverview.recomputePending).toBe(0);
    expect(sameModelConfig(finalOverview.model, baseline.model), "最终生效模型必须恢复为本轮基线配置").toBe(true);
    expect(finalUser.overridden).toBe(false);
    expect(finalUser.effectiveScore).toBe(finalUser.modelScore);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(requestFailures).toEqual([]);
    cleanupComplete = true;
  } finally {
    // Even an expected reproduction failure (for example HTTP 500) must leave the isolated user and model clean.
    let cleanupError: string | null = null;
    try {
      if (baseline) {
        await bestEffortUiCleanup(rootPage, config.targetUserNo, baseline, `${run} finally 恢复`);
        finalOverview = await readOverview(rootPage);
        finalUser = await readUser(rootPage, config.targetUserNo);
        cleanupComplete = finalOverview.draft === null
          && finalOverview.recomputePending === 0
          && sameModelConfig(finalOverview.model, baseline.model)
          && !finalUser.overridden
          && finalUser.effectiveScore === finalUser.modelScore;
      }
    } catch (error) {
      cleanupError = error instanceof Error ? error.stack ?? error.message : String(error);
    }
    writeFileSync(path.join(config.evidenceDir, "k4-cand-001-result.json"), JSON.stringify({
      run,
      targetUserNo: config.targetUserNo,
      baseline: baseline && {
        modelVersion: baseline.model.version,
        modelRowVersion: baseline.model.rowVersion,
        modelConfig: modelConfigForDbCheck(baseline.model),
      },
      targetBefore: beforeUser && userForDbCheck(beforeUser),
      backfillWindow,
      publish: publishResponse && { status: publishResponse.status(), url: publishResponse.url() },
      override: overrideResponse && { status: overrideResponse.status(), url: overrideResponse.url() },
      overrideRetry: overrideRetryResponse && { status: overrideRetryResponse.status(), url: overrideRetryResponse.url() },
      http,
      final: finalOverview && finalUser && {
        modelVersion: finalOverview.model.version,
        modelRowVersion: finalOverview.model.rowVersion,
        modelConfig: modelConfigForDbCheck(finalOverview.model),
        target: userForDbCheck(finalUser),
      },
      cleanupComplete,
      cleanupError,
      pageErrors,
      consoleErrors,
      expectedConsoleBoundaryErrors,
      requestFailures,
    }, null, 2));
    await rootContext.close();
    await checkerContext.close();
    if (cleanupError) throw new Error(`K-CAND-001 cleanup failed: ${cleanupError}`);
  }
});

function readConfig() {
  const fixturePath = requiredEnv("K4_CHECKER_FIXTURE");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  const checkerKey = requiredEnv("K4_SECOND_ACCOUNT_KEY");
  const checker = checkerKey === "checker" ? fixture.checker : fixture.accounts[checkerKey];
  if (!checker) throw new Error(`fixture account ${checkerKey} is required`);
  return {
    baseUrl: requiredEnv("ADMIN_BASE_URL"),
    root: { username: requiredEnv("K4_ROOT_USERNAME"), password: requiredEnv("K4_ROOT_PASSWORD") },
    checker,
    targetUserNo: requiredEnv("K4_TARGET_USER_NO"),
    evidenceDir: requiredEnv("K4_CAND_001_EVIDENCE_DIR"),
  };
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the isolated K-CAND-001 run`);
  return value;
}

async function login(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  if (account.totpSecret) {
    const otp = page.getByLabel("一次性验证码");
    await expect(otp).toBeVisible({ timeout: 15_000 });
    await otp.fill(currentTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function openK4FromSidebar(page: Page) {
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
}

async function selectUserViaVisibleUi(page: Page, userNo: string) {
  const search = page.getByRole("combobox", { name: "搜索用户编号或用户名" });
  await search.fill(userNo);
  const listboxId = await search.getAttribute("aria-controls");
  expect(listboxId).toBeTruthy();
  const option = page.locator(`[id="${listboxId}"]`).getByRole("option").filter({ hasText: userNo }).first();
  await expect(option).toBeVisible({ timeout: 30_000 });
  await option.click();
  await expect(page.locator(".score-hero")).toContainText(userNo, { timeout: 30_000 });
}

async function saveMinimalDifferenceThroughUi(page: Page, reason: string) {
  const model = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first();
  const inputs = model.locator('.w-row input[type="number"]');
  const first = Number(await inputs.nth(0).inputValue());
  const second = Number(await inputs.nth(1).inputValue());
  const delta = first < 100 && second > 0 ? 1 : -1;
  await inputs.nth(0).fill(String(first + delta));
  await inputs.nth(1).fill(String(second - delta));
  await model.getByRole("button", { name: "保存模型草稿" }).click();
  const response = await confirmDialog(page, reason, (candidate) => candidate.request().method() === "PUT"
    && candidate.url().endsWith("/api/admin/risk/scoring/model/draft"));
  expect(response.status(), await response.text()).toBe(200);
  await expect(model.getByRole("button", { name: "发布模型草稿" })).toBeVisible({ timeout: 30_000 });
}

async function publishModelThroughUi(page: Page, reason: string) {
  const model = page.locator("section.l-card").filter({ hasText: "K4 评分模型" }).first();
  await model.getByRole("button", { name: "发布模型草稿" }).click();
  return confirmDialog(page, reason, (candidate) => candidate.request().method() === "POST"
    && candidate.url().endsWith("/api/admin/risk/scoring/model/publish"));
}

async function overrideThroughUi(page: Page, score: number, reason: string) {
  await page.getByRole("button", { name: "人工覆盖评分" }).click();
  const dialog = page.getByRole("dialog").last();
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="number"]').fill(String(score));
  return confirmDialog(page, reason, (candidate) => candidate.request().method() === "POST"
    && /\/api\/admin\/risk\/scoring\/users\/[^/]+\/override$/.test(new URL(candidate.url()).pathname), dialog);
}

async function restoreBaselineModelThroughUi(page: Page, baseline: Overview, reason: string) {
  const current = await readOverview(page);
  if (sameModelConfig(current.model, baseline.model) && current.draft === null) return;
  expect(current.draft, "发布后的模型不应遗留草稿").toBeNull();
  const history = page.locator("section.l-card").filter({ hasText: "模型版本历史" });
  const baselineRow = history.locator(".ktint").filter({ hasText: new RegExp(`v${baseline.model.version}.*archived`) }).first();
  await expect(baselineRow, "发布后的原基线必须可从历史版本恢复").toBeVisible({ timeout: 30_000 });
  await baselineRow.getByRole("button", { name: "恢复为草稿" }).click();
  const restore = await confirmDialog(page, reason, (candidate) => candidate.request().method() === "POST"
    && candidate.url().endsWith("/api/admin/risk/scoring/model/restore-draft"));
  expect(restore.status(), await restore.text()).toBe(200);
  const publish = await publishModelThroughUi(page, `${reason} 发布恢复草稿`);
  expect(publish.status(), await publish.text()).toBe(200);
}

async function restoreUserThroughUi(page: Page, userNo: string, reason: string) {
  const current = await readUser(page, userNo);
  if (!current.overridden) return;
  await selectUserViaVisibleUi(page, userNo);
  await page.getByRole("button", { name: "重算回模型分", exact: true }).click();
  const response = await confirmDialog(page, reason, (candidate) => candidate.request().method() === "POST"
    && /\/api\/admin\/risk\/scoring\/users\/[^/]+\/recompute$/.test(new URL(candidate.url()).pathname));
  expect(response.status(), await response.text()).toBe(200);
}

async function bestEffortUiCleanup(page: Page, userNo: string, baseline: Overview, reason: string) {
  await openK4FromSidebar(page);
  await waitForQueueDrain(page);
  const current = await readOverview(page);
  if (!sameModelConfig(current.model, baseline.model) || current.draft !== null) {
    await restoreBaselineModelThroughUi(page, baseline, reason);
    await waitForQueueDrain(page);
  }
  await restoreUserThroughUi(page, userNo, reason);
}

async function confirmDialog(page: Page, reason: string, matcher: (response: Response) => boolean, existing?: ReturnType<Page["getByRole"]>) {
  const dialog = existing ?? page.getByRole("dialog").last();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const textarea = dialog.locator("textarea");
  if (await textarea.count()) await textarea.fill(reason);
  const responsePromise = page.waitForResponse(matcher, { timeout: 30_000 });
  await dialog.getByRole("button", { name: /确认/ }).last().click();
  return responsePromise;
}

async function capturePostPublishWindow(page: Page) {
  const overview = await readOverview(page);
  return {
    observedAt: new Date().toISOString(),
    signal: "publish-200" as const,
    recomputePending: overview.recomputePending,
    modelVersion: overview.model.version,
  };
}

async function waitForQueueDrain(page: Page) {
  await expect.poll(async () => (await readOverview(page)).recomputePending, {
    timeout: 90_000,
    intervals: [250, 500, 1_000, 1_500],
  }).toBe(0);
}

async function readOverview(page: Page) {
  return ok<Overview>(await page.request.get("/api/admin/risk/scoring/overview?overridePageNum=1&overridePageSize=10"));
}

async function readUser(page: Page, userNo: string) {
  return ok<ScoreUser>(await page.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(userNo)}`));
}

async function assertAuthority(page: Page, authority: string) {
  const session = await ok<{ session?: { authorities?: string[] } }>(await page.request.get("/api/admin/auth/session"));
  expect(session.session?.authorities ?? []).toContain(authority);
}

async function ok<T>(response: APIResponse): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const envelope = JSON.parse(raw) as Envelope<T>;
  expect(envelope.code ?? 0, raw).toBe(0);
  return envelope.data;
}

function captureMutation(response: Response, evidence: HttpEvidence[]) {
  const pathname = new URL(response.url()).pathname;
  const operation = pathname.endsWith("/model/publish") ? "publish"
    : pathname.endsWith("/model/restore-draft") ? "restore"
      : pathname.endsWith("/recompute") ? "recompute"
        : pathname.endsWith("/override") ? "override" : null;
  if (!operation) return;
  evidence.push({
    operation,
    method: response.request().method(),
    path: pathname,
    status: response.status(),
    idempotencyKey: response.request().headers()["idempotency-key"],
  });
}

function sameModelConfig(left: Model, right: Model) {
  return JSON.stringify(modelConfigForDbCheck(left)) === JSON.stringify(modelConfigForDbCheck(right));
}

function modelConfigForDbCheck(model: Model) {
  return {
    weights: model.weights,
    inputSources: model.inputSources,
    scoreMappings: model.scoreMappings,
    bandLowMax: model.bandLowMax,
    bandHighMin: model.bandHighMin,
    autoEscalateScore: model.autoEscalateScore,
  };
}

function userForDbCheck(user: ScoreUser) {
  return {
    userNo: user.userNo,
    modelScore: user.modelScore,
    effectiveScore: user.effectiveScore,
    overridden: user.overridden,
    modelVersion: user.modelVersion,
    rowVersion: user.rowVersion,
  };
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
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
