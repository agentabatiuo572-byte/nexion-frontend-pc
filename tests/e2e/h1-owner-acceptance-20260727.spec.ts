import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const RUN_ID = `H1-OWNER-${Date.now()}`;

test.describe.configure({ mode: "serial" });

test("H1 首次用户可从左侧入口发现并理解完整节奏操作台", async ({ page }) => {
  await login(page);
  const group = page.getByRole("button", { name: /增长与运营节奏/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/growth/phase"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/growth\/phase$/);

  await expect(page.getByText("节奏骨架", { exact: true })).toBeVisible();
  await expect(page.getByText(/当前运营月 \/ 阶段/)).toBeVisible();
  await expect(page.getByText(/备付金红线核验/)).toBeVisible();
  await expect(page.getByRole("button", { name: "改总时长" })).toBeVisible();
  await expect(page.getByRole("button", { name: "设定位置" })).toBeVisible();
  await expect(page.getByRole("button", { name: /沙盒预览/ })).toBeVisible();
  await expect(page.locator(".l-h .ttl").filter({ hasText: /逐月旋钮矩阵\(\d+ 月 x 8 项\)/ })).toBeVisible();
  await expect(page.getByText("Phase 切换控制", { exact: true })).toBeVisible();
  await expect(page.getByText("Phase 效果归因", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /去 B4 节奏看板/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/Premium|NEXv2|NEX v2|NaN|Infinity|undefined/);

  await page.getByRole("button", { name: /沙盒预览/ }).click();
  const previewModal = page.locator('[role="dialog"]:visible');
  await expect(previewModal).toBeVisible();
  await previewModal.getByText(/查看详情/).click();
  await expect(previewModal.getByText(/沙盒预览会重新读取后端 H1 读模型,不写配置/)).toBeVisible();
  await previewModal.getByRole("button", { name: "运行预览" }).click();
  await expect(page.getByText(/H1 沙盒预览已按后端数据刷新/)).toBeVisible();
});

test("H1 权威读模型与 B4/D5/F3/G7 保持同一快照，App 匿名边界失败关闭", async ({ page }) => {
  await login(page);
  const h1 = await okJson(page.request, "/api/admin/growth/phases");
  const currentMonth = Number(h1.rhythm.currentMonth);
  const row = (h1.monthlyDials as Array<Record<string, any>>).find((item) => Number(item.month) === currentMonth);
  expect(row).toBeTruthy();
  const currentRow = row!;
  expect(Object.keys(currentRow.dials)).toEqual(expect.arrayContaining([
    "newUserBonusMultiplier",
    "inviteRewardMultiplier",
    "reinvestMultiplier",
    "withdrawPenaltyFeeRate",
    "withdrawCooldownDays",
    "binaryDailyCap",
    "questBonusMultiplier",
    "complianceHoldEnabled",
  ]));

  const b4 = await okJson(page.request, "/api/admin/phase/overview");
  expect(Number(b4.rhythm.currentMonth)).toBe(currentMonth);
  expect(String(b4.rhythm.currentPhase)).toBe(String(h1.rhythm.currentPhase));
  expect(b4.dials).toHaveLength(8);

  const d5 = await okJson(page.request, "/api/admin/withdraw/limits");
  expect(Number(d5.currentMonth)).toBe(currentMonth);
  expect(Number(d5.cooldownDays)).toBe(Number(currentRow.dials.withdrawCooldownDays));
  expect(Number(d5.penaltyFeeRate) * 100).toBeCloseTo(Number(currentRow.dials.withdrawPenaltyFeeRate), 8);

  const f3 = await okJson(page.request, "/api/admin/teams/binary");
  const f3CapLabel = String(f3.dailyCap?.currentLabel ?? "");
  expect(parseUsdLabel(f3CapLabel)).toBe(Number(currentRow.dials.binaryDailyCap));

  const appPhaseAnonymous = await page.request.get("http://127.0.0.1:8110/api/product/phase");
  expect(appPhaseAnonymous.status()).toBe(401);

  await page.goto("/network/binary");
  await expect(page.locator("body")).toContainText("H1");
  await expect(page.locator('[data-proof="f3-cap-h1"]')).toHaveText(f3CapLabel);

  await page.goto("/finance-products/repurchase");
  await expect(page.locator("body")).toContainText("H1");
});

test("H1 节奏位置真实写入、刷新可见、A2/A4 留痕并可回退", async ({ page }) => {
  await login(page);
  await page.goto("/growth/phase");
  const before = await okJson(page.request, "/api/admin/growth/rhythm");
  const oldProgress = Number(before.phaseProgressPct);
  const nextProgress = oldProgress >= 100 ? oldProgress - 1 : oldProgress + 1;

  try {
    await setProgressFromUi(page, nextProgress, `${RUN_ID} 校准阶段进度并验证刷新回退闭环`);
    await expect.poll(async () => Number((await okJson(page.request, "/api/admin/growth/rhythm")).phaseProgressPct)).toBe(nextProgress);
    await page.reload();
    await expect(page.getByText(new RegExp(`阶段进度 ${nextProgress}%`))).toBeVisible();

    const audit = await okJson(page.request, `/api/admin/platform/audit/overview?domain=H&object=${encodeURIComponent("H1.rhythm.phaseProgressPct")}`);
    expect(JSON.stringify(audit)).toContain(RUN_ID);
    const events = await okJson(page.request, "/api/admin/platform/events/overview");
    expect(JSON.stringify(events)).toContain("admin.growth_config_changed");
  } finally {
    const current = await okJson(page.request, "/api/admin/growth/rhythm");
    if (Number(current.phaseProgressPct) !== oldProgress) {
      await setProgressFromUi(page, oldProgress, `${RUN_ID} 验收结束恢复原阶段进度值并核对刷新`);
    }
    await expect.poll(async () => Number((await okJson(page.request, "/api/admin/growth/rhythm")).phaseProgressPct)).toBe(oldProgress);
    await page.reload();
    await expect(page.getByText(new RegExp(`阶段进度 ${oldProgress}%`))).toBeVisible();
  }
});

test("H1 墨菲探针覆盖未认证、未知路由、缺少幂等、理由越界和冲突重放", async ({ page, baseURL }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/growth/phases")).status()).toBe(401);
  expect((await anonymous.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    data: { key: "phaseProgressPct", value: "50", reason: `${RUN_ID} 未认证写入必须拒绝`, operator: "unknown" },
    headers: { "Idempotency-Key": `${RUN_ID}-anonymous` },
  })).status()).toBe(401);
  expect((await anonymous.get("/api/admin/growth/not-allowed")).status()).toBe(404);
  await anonymous.dispose();

  await login(page);
  const current = await okJson(page.request, "/api/admin/growth/rhythm");
  const body = {
    key: "phaseProgressPct",
    value: String(current.phaseProgressPct),
    reason: `${RUN_ID} 墨菲重放同值不产生第二次副作用`,
    operator: "superadmin",
  };
  const noKey = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", { data: body });
  expect(noKey.status()).toBe(422);
  expect((await noKey.json()).message).toContain("IDEMPOTENCY_KEY_REQUIRED");

  const shortReason = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    data: { ...body, reason: "短" },
    headers: { "Idempotency-Key": `${RUN_ID}-short` },
  });
  expect(shortReason.status()).toBe(422);
  expect((await shortReason.json()).message).toContain("REASON_REQUIRED");

  const replayKey = `${RUN_ID}-replay`;
  const first = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    data: body,
    headers: { "Idempotency-Key": replayKey },
  });
  expect(first.status()).toBe(200);
  const second = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    data: body,
    headers: { "Idempotency-Key": replayKey },
  });
  expect(second.status()).toBe(200);
  expect(await second.json()).toEqual(await first.json());

  const conflict = await page.request.patch("/api/admin/growth/rhythm/phaseProgressPct", {
    data: { ...body, value: String(Number(current.phaseProgressPct) === 100 ? 99 : Number(current.phaseProgressPct) + 1) },
    headers: { "Idempotency-Key": replayKey },
  });
  expect(conflict.status()).toBe(409);
  expect((await conflict.json()).message).toContain("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function okJson(request: APIRequestContext, path: string) {
  const response = await request.get(path);
  expect(response.status(), `${path} should succeed`).toBe(200);
  const json = await response.json();
  expect(json.code, `${path} should return code=0`).toBe(0);
  return json.data as Record<string, any>;
}

async function setProgressFromUi(page: Page, progress: number, reason: string) {
  await page.getByRole("button", { name: "设定位置" }).click();
  const modal = page.getByRole("dialog");
  await expect(modal).toBeVisible();
  await modal.getByLabel("本阶段进度(%)").fill(String(progress));
  await modal.locator("textarea").fill(reason);
  await modal.getByRole("button", { name: "确认提交" }).click();
  await expect(modal).toBeHidden();
}

function parseUsdLabel(value: string) {
  const normalized = value.trim().replace(/^\$/, "").replace(/,/g, "").toLowerCase();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)([km])?$/);
  if (!match) return Number.NaN;
  const multiplier = match[2] === "k" ? 1_000 : match[2] === "m" ? 1_000_000 : 1;
  return Number(match[1]) * multiplier;
}
