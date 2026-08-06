import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAKER_USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const MAKER_PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const MAKER_TOTP_SECRET = process.env.J4_V4_MAKER_TOTP_SECRET?.trim() || "";
const REVIEWER_USERNAME = process.env.J4_V4_REVIEWER_USERNAME?.trim() || "";
const REVIEWER_PASSWORD = process.env.J4_V4_REVIEWER_PASSWORD || "";
const REVIEWER_TOTP_SECRET = process.env.J4_V4_REVIEWER_TOTP_SECRET?.trim() || "";
const PLAYBOOK_CODE = process.env.J4_V4_PLAYBOOK_CODE?.trim() || "";
const RUN_ID = process.env.J4_V4_RUN_ID?.trim() || "pc-full-acceptance-20260728-151023";
const EXPECT_DEPLOYED = process.env.J4_V4_EXPECT_DEPLOYED === "1";
const RUN_DESTRUCTIVE = process.env.J4_V4_RUN_DESTRUCTIVE === "1";
const RUN_EMERGENCY_RECOVERY = process.env.J4_V4_RUN_EMERGENCY_RECOVERY === "1";
const EXPECT_COVERAGE_REJECTION = process.env.J4_V4_EXPECT_COVERAGE_REJECTION === "1";
const RETRY_ROLLBACK_EXECUTION_ID = process.env.J4_V4_RETRY_ROLLBACK_EXECUTION_ID?.trim() || "";
const RECOVERY_STATE_PATH = process.env.J4_V4_RECOVERY_STATE_PATH?.trim() || "";

test.describe("J4 V4 统一部署后首次用户与跨域调用链验收", () => {
  test.describe.configure({ mode: "serial" });
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

    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);

    // The production console may hydrate this route from a legitimate RSC
    // cache, so the visible contract is the stable browser-level assertion.
    // The route is still entered only through the authenticated sidebar.
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
    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    await assertJ4Healthy(page);

    expect(pageErrors, "页面不应出现未处理脚本错误").toEqual([]);
    expect(failedResponses, "J4/A2 主调用不应出现 5xx").toEqual([]);
  });

  test("专用夹具经 maker 提案、checker 执行后生成逐步追溯", async ({ page }) => {
    test.skip(
      !RUN_DESTRUCTIVE || !REVIEWER_USERNAME || !REVIEWER_PASSWORD,
      "破坏性终验需显式 J4_V4_RUN_DESTRUCTIVE=1 和不同 reviewer 账号；未传剧本编号时会创建本轮专用可逆剧本，不得用生产对象或 maker 自批。",
    );
    expect(REVIEWER_USERNAME, "maker 与 checker 必须是不同账号").not.toBe(MAKER_USERNAME);

    const pageErrors: string[] = [];
    const failedResponses: string[] = [];
    collectBrowserFailures(page, pageErrors, failedResponses);

    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const playbookCode = PLAYBOOK_CODE || await createReadyGenesisPlaybook(page);
    writeRecoveryState({ stage: "PLAYBOOK_READY", playbookCode });
    const playbook = page.getByTestId(`j4-playbook-${playbookCode}`);
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
    writeRecoveryState({ stage: "A2_PENDING", playbookCode, operationId });
    await expect(page.getByText(/已提交 A2 双人复核/)).toBeVisible();

    await logoutFromVisibleControl(page);
    await loginFromVisibleEntry(page, REVIEWER_USERNAME, REVIEWER_PASSWORD, REVIEWER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/platform/audit", /平台基础|A\s+平台/);
    const operationRow = page.locator("tbody tr")
      .filter({ hasText: operationId })
      .filter({ hasText: playbookCode })
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
    writeRecoveryState({ stage: "A2_EXECUTED", playbookCode, operationId });
    await expect(operationRow).toContainText(/已执行|已批准/, { timeout: 120_000 });

    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const executionRow = page.locator('[data-testid^="j4-execution-"]').filter({ hasText: playbookCode }).first();
    await expect(executionRow, "A2 批准后 J4 必须返回服务端执行记录").toBeVisible({ timeout: 120_000 });
    const executionTestId = await executionRow.getAttribute("data-testid");
    expect(executionTestId).toMatch(/^j4-execution-/);
    const executionId = executionTestId!.replace(/^j4-execution-/, "");
    writeRecoveryState({ stage: "EXECUTION_VISIBLE", playbookCode, operationId, executionId });
    await executionRow.getByRole("button", { name: "查看追溯" }).click();
    await expect(page.getByText("逐步执行结果")).toBeVisible();
    await expect(page.locator('[data-proof^="j4-trace-confirmation-"]').first()).toBeVisible();
    await expect(page.getByText(/状态 (failed|unknown)/i)).toHaveCount(0);
    await page.getByRole("button", { name: "关闭", exact: true }).click();

    await logoutFromVisibleControl(page);
    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const restoredExecution = page.locator('[data-testid^="j4-execution-"]').filter({ hasText: playbookCode }).first();
    const rollbackResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith("/rollback"),
      { timeout: 120_000 },
    );
    await restoredExecution.getByRole("button", { name: "回滚", exact: true }).click();
    await fillOperationReason(page, "J4 V4 maker 在验收后精确恢复 Genesis，保留追溯记录");
    await page.getByRole("button", { name: "确认提交" }).click();
    const rollbackResponse = await rollbackResponsePromise;
    if (EXPECT_COVERAGE_REJECTION) {
      const rollbackPayload = await rollbackResponse.json().catch(() => ({}));
      expect(rollbackResponse.status(), JSON.stringify(rollbackPayload)).toBe(422);
      expect(rollbackPayload?.message, JSON.stringify(rollbackPayload)).toBe("COVERAGE_BELOW_REDLINE");
      const rejectedExecutionTestId = await restoredExecution.getAttribute("data-testid");
      expect(rejectedExecutionTestId).toMatch(/^j4-execution-/);
      const rejectedExecutionId = rejectedExecutionTestId!.replace(/^j4-execution-/, "");
      writeRecoveryState({
        stage: "ROLLBACK_REJECTED",
        playbookCode,
        operationId,
        executionId: rejectedExecutionId,
        rejection: "COVERAGE_BELOW_REDLINE",
        restored: false,
      });
      console.log(`J4_COVERAGE_REJECTED_EXECUTION=${rejectedExecutionId}`);

      const rejectedKillSwitches = await page.request.get("/api/admin/emergency/kill-switches");
      expect(rejectedKillSwitches.status()).toBe(200);
      const rejectedPayload = await rejectedKillSwitches.json();
      const rejectedGenesis = (rejectedPayload?.data?.activeGates ?? rejectedPayload?.activeGates ?? [])
        .find((gate: { key?: string }) => gate.key === "genesis");
      expect(rejectedGenesis?.enabled, "B1 红线拒绝后 Genesis 必须保持关闭").toBe(false);
      expect(rejectedGenesis?.emergency, "B1 红线拒绝后 J4 所有权状态必须保持应急态").toBe(true);
      expect(pageErrors, "B1 业务拒绝不应产生页面脚本错误").toEqual([]);
      expect(failedResponses, "B1 业务拒绝不得被冒泡为 5xx").toEqual([]);
      return;
    }
    expect(rollbackResponse.status()).toBeLessThan(300);
    await expect(restoredExecution).toContainText("已回滚可逆动作");

    const killSwitches = await page.request.get("/api/admin/emergency/kill-switches");
    expect(killSwitches.status()).toBe(200);
    const killPayload = await killSwitches.json();
    const genesis = (killPayload?.data?.activeGates ?? killPayload?.activeGates ?? [])
      .find((gate: { key?: string }) => gate.key === "genesis");
    expect(genesis?.enabled, "maker/checker 执行后必须精确恢复 Genesis").toBe(true);
    writeRecoveryState({
      stage: "ROLLED_BACK",
      playbookCode,
      operationId,
      executionId,
      restored: true,
    });

    expect(pageErrors, "maker/checker 全链不应出现未处理脚本错误").toEqual([]);
    expect(failedResponses, "maker/checker 全链不应出现 5xx").toEqual([]);
  });

  test("B1 达标后重试同一 J4 执行并精确回滚 Genesis", async ({ page }) => {
    test.skip(
      !RUN_DESTRUCTIVE || !RETRY_ROLLBACK_EXECUTION_ID,
      "只在已生成 COVERAGE_BELOW_REDLINE 证据并持有全局与资金锁时重试同一 execution",
    );
    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);
    await openVisibleSidebarLink(page, "/emergency/sop", /紧急与合规控制|J\s+紧急/);
    const execution = page.getByTestId(`j4-execution-${RETRY_ROLLBACK_EXECUTION_ID}`);
    await expect(execution, "必须重试刚被 B1 红线拒绝且仍由 J4 持有的同一 execution").toBeVisible();
    writeRecoveryState({
      stage: "RETRYING_ROLLBACK",
      executionId: RETRY_ROLLBACK_EXECUTION_ID,
      restored: false,
    });

    const rollbackResponsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname.endsWith(
        `/executions/${encodeURIComponent(RETRY_ROLLBACK_EXECUTION_ID)}/rollback`,
      ),
      { timeout: 120_000 },
    );
    await execution.getByRole("button", { name: "回滚", exact: true }).click();
    await fillOperationReason(page, "B1 临时隔离 reserve 达标后重试同一 J4 回滚，精确恢复 Genesis");
    await page.getByRole("button", { name: "确认提交" }).click();
    const rollbackResponse = await rollbackResponsePromise;
    const rollbackPayload = await rollbackResponse.json().catch(() => ({}));
    if (EXPECT_COVERAGE_REJECTION) {
      expect(rollbackResponse.status(), JSON.stringify(rollbackPayload)).toBe(422);
      expect(rollbackPayload?.message, JSON.stringify(rollbackPayload)).toBe("COVERAGE_BELOW_REDLINE");
      const rejectedKillSwitches = await page.request.get("/api/admin/emergency/kill-switches");
      expect(rejectedKillSwitches.status()).toBe(200);
      const rejectedPayload = await rejectedKillSwitches.json();
      const rejectedGenesis = (rejectedPayload?.data?.activeGates ?? rejectedPayload?.activeGates ?? [])
        .find((gate: { key?: string }) => gate.key === "genesis");
      expect(rejectedGenesis?.enabled, "B1 红线拒绝后 Genesis 必须保持关闭").toBe(false);
      expect(rejectedGenesis?.emergency, "B1 红线拒绝后 ownership 应急态必须保留").toBe(true);
      writeRecoveryState({
        stage: "ROLLBACK_REJECTED",
        executionId: RETRY_ROLLBACK_EXECUTION_ID,
        rejection: "COVERAGE_BELOW_REDLINE",
        restored: false,
      });
      console.log(`J4_COVERAGE_REJECTED_EXECUTION=${RETRY_ROLLBACK_EXECUTION_ID}`);
      return;
    }
    expect(rollbackResponse.status(), JSON.stringify(rollbackPayload)).toBeLessThan(300);
    expect(rollbackPayload?.code ?? 0, JSON.stringify(rollbackPayload)).toBe(0);
    await expect(execution).toContainText("已回滚可逆动作");

    const killSwitches = await page.request.get("/api/admin/emergency/kill-switches");
    expect(killSwitches.status()).toBe(200);
    const killPayload = await killSwitches.json();
    const genesis = (killPayload?.data?.activeGates ?? killPayload?.activeGates ?? [])
      .find((gate: { key?: string }) => gate.key === "genesis");
    expect(genesis?.enabled, "达标重试后 Genesis 必须开启").toBe(true);
    expect(genesis?.emergency, "达标重试后不得残留 emergency 标记").toBe(false);
    writeRecoveryState({
      stage: "ROLLED_BACK",
      executionId: RETRY_ROLLBACK_EXECUTION_ID,
      restored: true,
    });
  });

  test("回滚异常后以 J1 真值为准紧急恢复 Genesis", async ({ page }) => {
    test.skip(!RUN_EMERGENCY_RECOVERY, "只在 J4 回滚异常且持有全局锁时显式启用");
    await loginFromVisibleEntry(page, MAKER_USERNAME, MAKER_PASSWORD, MAKER_TOTP_SECRET);

    const beforeResponse = await page.request.get("/api/admin/emergency/kill-switches");
    expect(beforeResponse.status()).toBe(200);
    const beforePayload = await beforeResponse.json();
    const beforeGenesis = (beforePayload?.data?.activeGates ?? beforePayload?.activeGates ?? [])
      .find((gate: { key?: string }) => gate.key === "genesis");
    expect(beforeGenesis, "J1 必须返回 Genesis 当前真值").toBeTruthy();

    if (beforeGenesis.enabled !== true) {
      const coverage = beforePayload?.data?.coverage ?? beforePayload?.coverage;
      expect(Number(coverage?.coverageRatio), "临时 reserve IN 必须先使 B1 覆盖率达到恢复红线")
        .toBeGreaterThanOrEqual(Number(coverage?.redlinePct));
      const recoveryResponse = await page.request.put("/api/admin/emergency/kill-switches/genesis", {
        headers: { "Idempotency-Key": `${RUN_ID}-j4-emergency-genesis-recovery-v2` },
        data: {
          enabled: "enabled",
          operator: `${RUN_ID} j_maker`,
          reason: "J4 回滚接口异常后按隔离验收基线紧急恢复 Genesis",
        },
      });
      const recoveryPayload = await recoveryResponse.json().catch(() => ({}));
      expect(recoveryResponse.status(), JSON.stringify(recoveryPayload)).toBeLessThan(300);
      expect(recoveryPayload?.code ?? 0, JSON.stringify(recoveryPayload)).toBe(0);
    }

    const afterResponse = await page.request.get("/api/admin/emergency/kill-switches");
    expect(afterResponse.status()).toBe(200);
    const afterPayload = await afterResponse.json();
    const afterGenesis = (afterPayload?.data?.activeGates ?? afterPayload?.activeGates ?? [])
      .find((gate: { key?: string }) => gate.key === "genesis");
    expect(afterGenesis?.enabled, "紧急恢复后 Genesis 必须重新开启").toBe(true);
    expect(afterGenesis?.emergency, "紧急恢复后不得残留 emergency 标记").toBe(false);
  });
});

function writeRecoveryState(patch: Record<string, unknown>) {
  if (!RECOVERY_STATE_PATH) return;
  const resolved = path.resolve(RECOVERY_STATE_PATH);
  expect(resolved.toLowerCase(), "J4 recovery state must remain under bug-pic/.restricted")
    .toContain(`${path.sep}.restricted${path.sep}`);
  mkdirSync(path.dirname(resolved), { recursive: true });
  let current: Record<string, unknown> = {};
  if (existsSync(resolved)) {
    current = JSON.parse(readFileSync(resolved, "utf8")) as Record<string, unknown>;
    if (current.runId && current.runId !== RUN_ID) {
      throw new Error("J4 recovery state belongs to a different Run ID");
    }
  }
  writeFileSync(resolved, JSON.stringify({
    ...current,
    ...patch,
    runId: RUN_ID,
    updatedAt: new Date().toISOString(),
    containsSecrets: false,
  }, null, 2), "utf8");
}

async function createReadyGenesisPlaybook(page: Page) {
  const before = await page.request.get("/api/admin/emergency/kill-switches");
  expect(before.status()).toBe(200);
  const beforePayload = await before.json();
  const genesis = (beforePayload?.data?.activeGates ?? beforePayload?.activeGates ?? [])
    .find((gate: { key?: string }) => gate.key === "genesis");
  expect(genesis?.enabled, "专用 maker/checker 验收要求 Genesis 初始为开启").toBe(true);

  const createResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/emergency/sop/playbooks",
  );
  await page.getByRole("button", { name: "+ 新增剧本", exact: true }).click();
  const authoring = page.getByRole("dialog", { name: "新增应急剧本" });
  await authoring.getByLabel("剧本名称", { exact: true }).fill(`${RUN_ID}-J4-V4-${Date.now()}-Genesis可逆验收`);
  await authoring.getByText("触发场景", { exact: true }).locator("..").getByRole("combobox").selectOption({ label: "监管点名" });
  await authoring.getByText("责任角色", { exact: true }).locator("..").getByRole("combobox").selectOption({ label: "超管" });
  await authoring.getByLabel("响应时限（分钟）", { exact: true }).fill("15");
  await authoring.locator('[data-proof="sop-action-option-select"]')
    .getByRole("button", { name: /J1.*Genesis|Genesis.*J1/ }).click();
  await authoring.locator('[data-proof="sop-rollback-template-select"] button').first().click();
  await authoring.getByLabel(/操作理由/).fill("J4 V4 创建本轮隔离 Genesis 可逆 maker/checker 验收剧本");
  await authoring.getByRole("button", { name: "确认提交" }).click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBeLessThan(300);
  const created = await createResponse.json();
  const code = String(created?.data?.updated?.code ?? created?.data?.code ?? "");
  expect(code).toMatch(/^SOP-CUSTOM-\d+$/);
  expect(Number(code.slice("SOP-CUSTOM-".length)), "不得复用已软删除的 SOP-CUSTOM-3..9").toBeGreaterThan(9);
  writeRecoveryState({ stage: "PLAYBOOK_CREATED", playbookCode: code });

  const card = page.getByTestId(`j4-playbook-${code}`);
  await expect(card).toBeVisible();
  const drillResponsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/playbooks/${encodeURIComponent(code)}/drills`),
  );
  await card.getByRole("button", { name: "演练", exact: true }).click();
  const drillDialog = page.getByRole("dialog", { name: new RegExp(`启动演练 · ${code}`) });
  await drillDialog.getByLabel(/操作理由/).fill("J4 V4 maker 执行真实依赖预检");
  await drillDialog.getByRole("button", { name: "确认提交" }).click();
  const drillResponse = await drillResponsePromise;
  expect(drillResponse.status()).toBeLessThan(300);
  await expect(card.getByText("演练就绪", { exact: true })).toBeVisible();
  writeRecoveryState({ stage: "PLAYBOOK_READY", playbookCode: code });
  return code;
}

async function loginFromVisibleEntry(
  page: Page,
  usernameValue: string,
  passwordValue: string,
  totpSecret = "",
) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    if (await shell.isVisible({ timeout: 2_000 }).catch(() => false)) return;
    const username = page.locator('input[autocomplete="username"]');
    const usernameVisible = await username.waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true).catch(() => false);
    if (!usernameVisible) {
      const authenticatedShell = await shell.waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true).catch(() => false);
      if (authenticatedShell) return;
      throw new Error(`${usernameValue} login entry and authenticated shell are both unavailable`);
    }
    await username.fill(usernameValue);
    await page.locator('input[autocomplete="current-password"]').fill(passwordValue);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    // Match the actual user-visible authentication contract: a successful
    // login replaces the form with the console shell or the MFA prompt. A
    // response event/body can be consumed by Chromium during that transition.
    if (await shell.isVisible({ timeout: 8_000 }).catch(() => false)) return;

    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    if (!(await otp.isVisible().catch(() => false))) {
      if (await shell.isVisible({ timeout: 5_000 }).catch(() => false)) return;
      const visibleError = await page.getByRole("alert").first().textContent().catch(() => null);
      failures.push(`login did not reach MFA or shell${visibleError ? `: ${visibleError}` : ""}`);
      await page.context().clearCookies();
      continue;
    }
    expect(totpSecret, `${usernameValue} 启用了 MFA，必须提供对应 TOTP secret`).not.toBe("");
    await otp.fill(await freshTotp(usernameValue, totpSecret));
    const verificationPromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verification = await verificationPromise;
    const payload = await verification.json().catch(() => ({})) as { code?: number; message?: string };
    const hasAuthCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (verification.status() === 200 && (payload.code === 0 || hasAuthCookie)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      const session = await page.request.get("/api/admin/auth/session");
      const shellReady = await shell.waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true).catch(() => false);
      if (session.status() === 200 && shellReady) return;
      failures.push(`MFA returned success but session/shell was unavailable status=${session.status()}`);
    } else {
      failures.push(`MFA HTTP ${verification.status()} code=${payload.code ?? "none"} message=${payload.message ?? "none"}`);
    }
    await page.context().clearCookies();
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  throw new Error(`${usernameValue} login failed: ${failures.join(" | ")}`);
}

async function openVisibleSidebarLink(page: Page, path: string, label: RegExp) {
  const link = page.locator(`aside a[href="${path}"]`).first();
  if (!(await link.isVisible({ timeout: 2_000 }).catch(() => false))) {
    const group = page.locator("aside button").filter({ hasText: label }).first();
    if (await group.isVisible({ timeout: 2_000 }).catch(() => false)) await group.click();
  }
  await expect(link, `${path} 必须有当前角色可见的侧栏入口`).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
}

async function assertJ4Healthy(page: Page) {
  await expect(page.getByText(/\bJ4\b/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("body")).not.toContainText(
    /数据加载失败|J4_API_FAILED|BACKEND_UNAVAILABLE|Cannot read properties|ReferenceError|TypeError/i,
  );
  await expect(page.getByText(/实战先进入 A2 确认队列/)).toBeVisible();
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

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
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
