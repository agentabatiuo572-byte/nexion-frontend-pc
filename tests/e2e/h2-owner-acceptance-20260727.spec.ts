import { expect, request as playwrightRequest, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { loginHMaker } from "./h-owner-mfa";

const RUN_ID = `H2-OWNER-${Date.now()}`;
const EVIDENCE_DIR = process.env.H2_EVIDENCE_DIR
  || "D:/workspace/bug-pic/pc-full-20260726/H2/initial";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => fs.mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("H2 首次用户可从可见入口找到并理解试用、奖励、状态与处置范围", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("401 (Unauthorized)")) {
      consoleErrors.push(message.text());
    }
  });

  await login(page);
  await openH2FromSidebar(page);

  await expect(page.getByText("Model A", { exact: true })).toBeVisible();
  await expect(page.getByText("试用参数 · 只影响新开", { exact: true })).toBeVisible();
  await expect(page.getByText("试用参数 · 实时生效", { exact: true })).toBeVisible();
  await expect(page.getByText("四道前置闸", { exact: true })).toBeVisible();
  await expect(page.getByText("7 态会话状态机", { exact: true })).toBeVisible();
  await expect(page.getByText("会话监控", { exact: true })).toBeVisible();

  const model = await okJson(page.request, "/api/admin/growth/trials");
  const params = model.params as Array<Record<string, unknown>>;
  expect(params).toHaveLength(19);
  expect(new Set(params.map((param) => String(param.key))).size).toBe(19);
  expect(params.find((param) => param.key === "chargeFailRate")?.cur).toBe("•••(server only)");
  expect(params.find((param) => param.key === "phaseOpen")?.cur).toBeTruthy();
  expect(params.find((param) => param.key === "trialOffsetCapUSD")?.cur).toBeTruthy();
  expect(model.states).toHaveLength(7);
  expect(model.gates).toHaveLength(4);

  const phaseRow = page.locator(".p-row").filter({ hasText: "当前阶段是否开放" }).first();
  const productRow = page.locator(".p-row").filter({ hasText: "试用产品" }).first();
  await expect(phaseRow.getByRole("button", { name: "只读" })).toBeDisabled();
  await expect(productRow.getByRole("button", { name: "只读" })).toBeDisabled();

  const offsetCap = String(params.find((param) => param.key === "trialOffsetCapUSD")?.cur);
  const offsetStat = page.locator(".f-stat").filter({ hasText: "抵扣上限" });
  await expect(offsetStat).toContainText(`$${offsetCap}`);
  await expect(page.locator("body")).not.toContainText(/NaN|Infinity|undefined|chargeFailRate\s*[:=]\s*0\./);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-h2-visible-entry-and-canonical-model.png"), fullPage: true });

  fs.writeFileSync(path.join(EVIDENCE_DIR, "01-visible-model.json"), JSON.stringify({
    runId: RUN_ID,
    url: page.url(),
    paramKeys: params.map((param) => param.key),
    stateKeys: (model.states as Array<Record<string, unknown>>).map((state) => state.key),
    gates: model.gates,
    sessions: model.sessions,
    serverOnlyFields: model.serverOnlyFields,
    sources: model.sources,
    pageErrors,
    consoleErrors,
  }, null, 2));
  expect(pageErrors).toEqual([]);
  expect(consoleErrors).toEqual([]);
});

test("H2 试用收益抵扣上限可见修改、刷新保留、重登保留并恢复原值", async ({ page }) => {
  await login(page);
  await openH2FromSidebar(page);
  const before = await okJson(page.request, "/api/admin/growth/trials");
  const beforeParams = before.params as Array<Record<string, unknown>>;
  const original = Number(beforeParams.find((param) => param.key === "trialOffsetCapUSD")?.cur);
  expect(Number.isFinite(original)).toBe(true);
  const next = original >= 999_999 ? original - 1 : original + 1;
  let changed = false;

  try {
    const row = page.locator(".p-row").filter({ hasText: "试用收益抵扣上限" }).first();
    await expect(row).toBeVisible();
    const response = await updateParamFromUi(
      page,
      row,
      String(next),
      `${RUN_ID} 首次用户修改试用收益抵扣上限并验证刷新重登`,
      "trialOffsetCapUSD",
    );
    expect(response.status()).toBe(200);
    changed = true;
    await expect(row).toContainText(String(next));
    await page.reload();
    await expect(page.locator(".p-row").filter({ hasText: "试用收益抵扣上限" }).first()).toContainText(String(next));
    await expect(page.locator(".f-stat").filter({ hasText: "抵扣上限" })).toContainText(`$${next}`);
    await logout(page);
    await login(page);
    await openH2FromSidebar(page);
    await expect(page.locator(".p-row").filter({ hasText: "试用收益抵扣上限" }).first()).toContainText(String(next));
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-offset-cap-persists-after-relogin.png"), fullPage: true });
  } finally {
    if (changed) {
      await login(page).catch(() => undefined);
      if (!page.url().endsWith("/growth/trial")) await openH2FromSidebar(page).catch(() => undefined);
      const row = page.locator(".p-row").filter({ hasText: "试用收益抵扣上限" }).first();
      const restored = await updateParamFromUi(
        page,
        row,
        String(original),
        `${RUN_ID} 验收结束恢复试用收益抵扣上限原值`,
        "trialOffsetCapUSD",
      );
      expect(restored.status()).toBe(200);
      await page.reload();
      await expect(page.locator(".p-row").filter({ hasText: "试用收益抵扣上限" }).first()).toContainText(String(original));
    }
  }
});

test("H2 读取失败安全关闭且给首次用户明确重试出口", async ({ page }) => {
  await login(page);
  await openH2FromSidebar(page);
  await page.route("**/api/admin/growth/trials", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: 500, message: "H2_ACCEPTANCE_INJECTED_READ_FAILURE" }),
      });
    } else {
      await route.continue();
    }
  });
  await page.reload();
  await expect(page.getByText("H2 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /重试|重新加载/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /调整|强制取消|强制扣款|auto-push 急停/ })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-read-failure-safe-retry.png"), fullPage: true });
  await page.unroute("**/api/admin/growth/trials");
  await page.getByRole("button", { name: /重试|重新加载/ }).click();
  await expect(page.getByText("会话监控", { exact: true })).toBeVisible();
});

test("H2 墨菲探针覆盖未认证、缺幂等、短理由、未知参数与同键冲突", async ({ page, baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/growth/trials")).status()).toBe(401);
  expect((await anonymous.patch("/api/admin/growth/trials/params/trialDays", {
    data: { key: "trialDays", value: "3", reason: `${RUN_ID} 匿名越权必须拒绝`, operator: "unknown" },
    headers: { "Idempotency-Key": `${RUN_ID}-anonymous` },
  })).status()).toBe(401);
  await anonymous.dispose();

  await login(page);
  const model = await okJson(page.request, "/api/admin/growth/trials");
  const trialDays = String((model.params as Array<Record<string, unknown>>)
    .find((param) => param.key === "trialDays")?.cur);
  const body = {
    key: "trialDays",
    value: trialDays,
    reason: `${RUN_ID} 墨菲同值重放仅返回同一结果且不产生重复副作用`,
    operator: "superadmin",
  };
  const noKey = await page.request.patch("/api/admin/growth/trials/params/trialDays", { data: body });
  expect(noKey.status()).toBe(422);
  expect((await noKey.json()).message).toContain("IDEMPOTENCY_KEY_REQUIRED");

  const shortReason = await page.request.patch("/api/admin/growth/trials/params/trialDays", {
    data: { ...body, reason: "短" },
    headers: { "Idempotency-Key": `${RUN_ID}-short` },
  });
  expect(shortReason.status()).toBe(422);
  expect((await shortReason.json()).message).toContain("REASON_REQUIRED");

  const unknown = await page.request.patch("/api/admin/growth/trials/params/notAParam", {
    data: { ...body, key: "notAParam" },
    headers: { "Idempotency-Key": `${RUN_ID}-unknown` },
  });
  expect(unknown.status()).toBe(422);

  const replayKey = `${RUN_ID}-replay`;
  const first = await page.request.patch("/api/admin/growth/trials/params/trialDays", {
    data: body,
    headers: { "Idempotency-Key": replayKey },
  });
  expect(first.status()).toBe(200);
  const replay = await page.request.patch("/api/admin/growth/trials/params/trialDays", {
    data: body,
    headers: { "Idempotency-Key": replayKey },
  });
  expect(replay.status()).toBe(200);
  expect(await replay.json()).toEqual(await first.json());

  const conflict = await page.request.patch("/api/admin/growth/trials/params/trialDays", {
    data: { ...body, value: String(Number(trialDays) === 90 ? 89 : Number(trialDays) + 1) },
    headers: { "Idempotency-Key": replayKey },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).message).toContain("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
});

async function login(page: Page) {
  await loginHMaker(page);
}

async function logout(page: Page) {
  const account = page.locator('button[aria-haspopup="menu"]');
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel(/用户名|账号/).first()).toBeVisible();
}

async function openH2FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /增长与运营节奏/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/growth/trial"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/growth\/trial$/);
  await expect(page.getByText(/H2 数据加载中/)).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("H2 数据加载失败", { exact: true })).toHaveCount(0);
}

async function okJson(request: APIRequestContext, requestPath: string) {
  const response = await request.get(requestPath);
  expect(response.status(), `${requestPath} should succeed`).toBe(200);
  const json = await response.json();
  expect(json.code, `${requestPath} should return code=0`).toBe(0);
  return json.data as Record<string, any>;
}

async function updateParamFromUi(
  page: Page,
  row: Locator,
  value: string,
  reason: string,
  key: string,
) {
  await row.getByRole("button", { name: "调整" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("目标新值").fill(value);
  await dialog.locator("textarea").fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
      && response.url().endsWith(`/api/admin/growth/trials/params/${key}`));
  await dialog.getByRole("button", { name: "确认提交" }).click();
  return responsePromise;
}
