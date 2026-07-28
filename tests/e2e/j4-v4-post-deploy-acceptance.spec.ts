import { expect, test, type Page } from "@playwright/test";

const MAKER_USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const MAKER_PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const REVIEWER_USERNAME = process.env.J4_V4_REVIEWER_USERNAME?.trim() || "";
const REVIEWER_PASSWORD = process.env.J4_V4_REVIEWER_PASSWORD || "";
const PLAYBOOK_CODE = process.env.J4_V4_PLAYBOOK_CODE?.trim() || "";
const EXPECT_DEPLOYED = process.env.J4_V4_EXPECT_DEPLOYED === "1";
const RUN_DESTRUCTIVE = process.env.J4_V4_RUN_DESTRUCTIVE === "1";

test.describe("J4 V4 统一部署后首次用户与跨域调用链验收", () => {
  test.beforeEach(() => {
    test.skip(
      !EXPECT_DEPLOYED,
      "该脚本只验收已统一应用 20260727 J4 migration、后端源码和 PC 源码的运行态；禁止把旧 next start / 旧 boot jar 当成修后证据。",
    );
  });

  test("可见入口展示 V4 真调用范围，刷新与重新登录不降级", async ({ page }) => {
    const pageErrors: string[] = [];
    const failedResponses: string[] = [];
    collectBrowserFailures(page, pageErrors, failedResponses);

    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD);
    const sopResponse = await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    expect(sopResponse, "进入 J4 时必须读取真实 SOP 接口").not.toBeNull();
    if (!sopResponse) throw new Error("J4_SOP_RESPONSE_MISSING");
    const body = await sopResponse.json();

    expect(body?.data?.contractVersion ?? body?.contractVersion).toBe("J4_REAL_EXECUTION_V4");
    const actionOptions = body?.data?.actionOptions ?? body?.actionOptions ?? [];
    expect(
      new Set(actionOptions.map((item: { domain?: string }) => item.domain)),
      "运行态必须返回 J1/J2/C2/K1/I3/I5 六个真实动作域",
    ).toEqual(new Set(["J1", "J2", "C2", "K1", "I3", "I5"]));

    await expect(page.getByText(/实战先进入 A2 双人复核/)).toBeVisible();
    await expect(page.getByText(/J1\/J2\/C2\/K1\/I3\/I5/)).toBeVisible();
    await expect(page.getByRole("button", { name: "+ 新增剧本" })).toBeEnabled();

    await page.getByRole("button", { name: "+ 新增剧本" }).click();
    await expect(page.locator('[data-business-form="sop-authoring"]')).toBeVisible();
    for (const domain of ["J1", "J2", "C2", "K1", "I3", "I5"]) {
      await expect(page.locator('[data-business-form="sop-authoring"]').getByText(new RegExp(`\\b${domain}\\b`)).first()).toBeVisible();
    }
    await page.getByRole("button", { name: "取消", exact: true }).last().click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertJ4Healthy(page);
    await logoutFromVisibleControl(page);
    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    await assertJ4Healthy(page);

    expect(pageErrors, "页面不应出现未处理脚本错误").toEqual([]);
    expect(failedResponses, "J4/A2 主调用不应出现 5xx").toEqual([]);
  });

  test("专用夹具经 maker 提案、checker 执行后生成逐步追溯", async ({ page }) => {
    test.skip(
      !RUN_DESTRUCTIVE || !PLAYBOOK_CODE || !REVIEWER_USERNAME || !REVIEWER_PASSWORD,
      "破坏性终验需显式 J4_V4_RUN_DESTRUCTIVE=1、已演练专用剧本和不同 reviewer 账号；不得用生产对象或 maker 自批。",
    );
    expect(REVIEWER_USERNAME, "maker 与 checker 必须是不同账号").not.toBe(MAKER_USERNAME);

    const pageErrors: string[] = [];
    const failedResponses: string[] = [];
    collectBrowserFailures(page, pageErrors, failedResponses);

    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const playbook = page.getByTestId(`j4-playbook-${PLAYBOOK_CODE}`);
    await expect(playbook, "专用剧本必须存在且已演练就绪").toBeVisible();
    const submit = playbook.getByRole("button", { name: /提交应急复核|提交执行复核/ });
    await expect(submit).toBeEnabled();
    await submit.click();

    await page.locator('[data-proof="j4-trigger-context"]').fill("J4 V4 部署后专用隔离夹具跨域验收");
    const confirmations = page.locator('input[data-proof^="j4-step-confirm-"]');
    expect(await confirmations.count(), "专用剧本至少包含一个动作").toBeGreaterThan(0);
    for (let index = 0; index < await confirmations.count(); index += 1) {
      await confirmations.nth(index).check();
    }
    await fillOperationReason(page, "J4 V4 maker 提案验收，使用隔离夹具并预置域内恢复方案");

    const proposalResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && /\/api\/admin\/platform\/audit\/operations$/.test(new URL(response.url()).pathname),
    );
    await page.getByRole("button", { name: "确认提交" }).click();
    const proposalResponse = await proposalResponsePromise;
    expect(proposalResponse.status()).toBeLessThan(300);
    const proposal = await proposalResponse.json();
    const operationId = String(
      proposal?.data?.operationId
      ?? proposal?.data?.id
      ?? proposal?.operationId
      ?? proposal?.id
      ?? "",
    );
    expect(operationId, "A2 提案响应必须返回操作单编号").not.toBe("");
    await expect(page.getByText(/已提交 A2 双人复核/)).toBeVisible();

    await logoutFromVisibleControl(page);
    await loginFromVisibleEntry(page, REVIEWER_USERNAME, REVIEWER_PASSWORD);
    await openVisibleSidebarLink(page, "/platform/audit", /平台基础|A\s+平台/);
    const operationRow = page.locator("tbody tr")
      .filter({ hasText: operationId })
      .filter({ hasText: PLAYBOOK_CODE })
      .first();
    await expect(operationRow, "checker 必须能从 A2 可见队列找到 maker 提案").toBeVisible();
    await operationRow.getByRole("button", { name: "执行", exact: true }).click();
    await fillOperationReason(page, "J4 V4 checker 独立复核通过，核对夹具、动作顺序及恢复预案");
    const approvalResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`),
      { timeout: 120_000 },
    );
    await page.getByRole("button", { name: "确认提交" }).click();
    const approvalResponse = await approvalResponsePromise;
    expect(approvalResponse.status()).toBeLessThan(300);
    await expect(operationRow).toContainText(/已执行|已批准/, { timeout: 120_000 });

    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const executionRow = page.locator('[data-testid^="j4-execution-"]').filter({ hasText: PLAYBOOK_CODE }).first();
    await expect(executionRow, "A2 批准后 J4 必须返回服务端执行记录").toBeVisible({ timeout: 120_000 });
    await executionRow.getByRole("button", { name: "查看追溯" }).click();
    await expect(page.getByText("逐步执行结果")).toBeVisible();
    await expect(page.locator('[data-proof^="j4-trace-confirmation-"]').first()).toBeVisible();
    await expect(page.getByText(/状态 (failed|unknown)/i)).toHaveCount(0);

    expect(pageErrors, "maker/checker 全链不应出现未处理脚本错误").toEqual([]);
    expect(failedResponses, "maker/checker 全链不应出现 5xx").toEqual([]);
  });
});

async function loginFromVisibleEntry(page: Page, usernameValue: string, passwordValue: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await username.fill(usernameValue);
  await page.locator('input[autocomplete="current-password"]').fill(passwordValue);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function openVisibleSidebarLink(page: Page, path: string, label: RegExp) {
  const link = page.locator(`aside a[href="${path}"]`).first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: label }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link, `${path} 必须有当前角色可见的侧栏入口`).toBeVisible({ timeout: 10_000 });
  const responsePromise = path === "/emergency/sop"
    ? page.waitForResponse((response) =>
      response.request().method() === "GET"
      && /\/api\/admin\/emergency\/sop\/playbooks(?:\?|$)/.test(response.url()),
    ).catch(() => null)
    : Promise.resolve(null);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
  return responsePromise;
}

async function assertJ4Healthy(page: Page) {
  await expect(page.getByText(/\bJ4\b/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(
    /数据加载失败|J4_API_FAILED|BACKEND_UNAVAILABLE|Cannot read properties|ReferenceError|TypeError/i,
  );
  await expect(page.getByText(/实战先进入 A2 双人复核/)).toBeVisible();
}

async function fillOperationReason(page: Page, reason: string) {
  const reasonField = page.getByLabel(/操作理由/).last();
  await reasonField.fill(reason);
  await expect(page.getByRole("button", { name: "确认提交" })).toBeEnabled();
}

async function logoutFromVisibleControl(page: Page) {
  const logout = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await logout.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await logout.click();
    return;
  }
  const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
  await account.click();
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout).toBeVisible({ timeout: 8_000 });
  await menuLogout.click();
}

function collectBrowserFailures(page: Page, errors: string[], failedResponses: string[]) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().startsWith("Failed to load resource:")) {
      errors.push(message.text());
    }
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/") && response.status() >= 500) {
      failedResponses.push(`${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`);
    }
  });
}
