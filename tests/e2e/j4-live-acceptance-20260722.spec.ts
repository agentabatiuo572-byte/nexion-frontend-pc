import { expect, test, type APIResponse, type Browser, type Locator, type Page, type Response } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

test.describe.configure({ mode: "serial" });

const USERNAME = process.env.NEXION_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.NEXION_ADMIN_PASSWORD;
const RUN_ID = process.env.J4_RUN_ID || `J4-20260722-${Date.now()}`;
const REQUESTED_CAMPAIGN_NO = process.env.J4_I3_CAMPAIGN_NO;
const MYSQL_PASSWORD = process.env.NEXION_MYSQL_PASSWORD;
const MYSQL_EXE = process.env.NEXION_MYSQL_EXE
  || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const EVIDENCE_DIR = process.env.J4_EVIDENCE_DIR
  || "D:/workspace/bug-pic/j-domain-acceptance-20260722/j4/initial";

test.beforeAll(async () => {
  expect(PASSWORD, "NEXION_ADMIN_PASSWORD is required; credentials must not be stored in the test").toBeTruthy();
  expect(MYSQL_PASSWORD, "NEXION_MYSQL_PASSWORD is required for the isolated interruption fixture").toBeTruthy();
  await mkdir(EVIDENCE_DIR, { recursive: true });
});

test("J4 J1 genesis execution survives stale replay, rolls back, and preserves unrelated gates", async ({ page }) => {
  const playbookName = `${RUN_ID}-J1-genesis-${Date.now()}`;
  const before = await j1SnapshotAfterVisibleLogin(page);
  expect(before.genesis).toBe(true);
  const unrelatedBefore = { withdraw: before.withdraw, exchange: before.exchange };
  await openJ4FromVisibleMenu(page);

  const createResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/admin/emergency/sop/playbooks"));
  await page.getByRole("button", { name: "+ 新增剧本", exact: true }).click();
  const authoring = page.getByRole("dialog", { name: "新增应急剧本" });
  await authoring.getByLabel("剧本名称", { exact: true }).fill(playbookName);
  await fieldSelect(authoring, "触发场景").selectOption({ label: "监管点名" });
  await fieldSelect(authoring, "责任角色").selectOption({ label: "超管" });
  await authoring.getByLabel("响应时限（分钟）", { exact: true }).fill("15");
  await authoring.locator('[data-proof="sop-action-option-select"]').getByRole("button", { name: /J1.*Genesis|Genesis.*J1/ }).click();
  await authoring.locator('[data-proof="sop-rollback-template-select"] button').first().click();
  await authoring.getByLabel(/操作理由/).fill(`${RUN_ID} 创建J1 Genesis可逆止血剧本`);
  await authoring.getByRole("button", { name: "确认提交" }).click();
  const created = await apiPayload(await createResponse);
  const code = String((created.data?.updated as Record<string, unknown> | undefined)?.code ?? "");
  expect(code).toMatch(/^SOP-/);
  const card = page.getByTestId(`j4-playbook-${code}`);
  await expect(card.getByText(playbookName, { exact: true })).toBeVisible();

  const drillResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().includes(`/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/drills`));
  await card.getByRole("button", { name: "演练", exact: true }).click();
  const drillDialog = page.getByRole("dialog", { name: new RegExp(`启动演练 · ${code}`) });
  await drillDialog.getByLabel(/操作理由/).fill(`${RUN_ID} Genesis止血动作真实依赖预检`);
  await drillDialog.getByRole("button", { name: "确认提交" }).click();
  expect((await drillResponse).ok()).toBeTruthy();
  await expect(card.getByText("演练就绪", { exact: true })).toBeVisible();

  let requestSnapshot: { url: string; key: string; body: string } | undefined;
  const executeResponse = page.waitForResponse((response) => {
    const request = response.request();
    const matches = request.method() === "POST"
      && response.url().includes(`/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/executions`)
      && !response.url().endsWith("/rollback");
    if (matches) requestSnapshot = {
      url: response.url(),
      key: request.headers()["idempotency-key"] || "",
      body: request.postData() || "",
    };
    return matches;
  });
  await card.getByRole("button", { name: "应急执行", exact: true }).click();
  const executeDialog = page.getByRole("dialog", { name: new RegExp(`执行应急剧本 · ${code}`) });
  await fieldSelect(executeDialog, "触发依据").selectOption({ label: "监管点名" });
  await executeDialog.locator('[data-proof="j4-trigger-context"]').fill(`${RUN_ID} Genesis监管止血后执行中断恢复与回滚`);
  await executeDialog.locator('[data-proof="j4-step-confirm-1"]').check();
  await executeDialog.getByLabel(/操作理由/).fill(`${RUN_ID} 执行Genesis关停并保留回滚快照`);
  await executeDialog.getByRole("button", { name: "确认提交" }).click();
  const executedResponse = await executeResponse;
  expect(executedResponse.ok()).toBeTruthy();
  const executed = await apiPayload(executedResponse);
  const execution = executed.data?.updated as Record<string, unknown> | undefined;
  const executionId = String(execution?.executionId ?? "");
  expect(executionId).toBeTruthy();
  expect(requestSnapshot?.key).toBeTruthy();
  expect((await readJ1(page)).genesis).toBe(false);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-j1-genesis-disabled-by-j4.png"), fullPage: true });

  // Fault injection models a crash after the J1 side effect but before J4 persisted
  // the terminal step/audit. The same public command must reconcile ownership instead
  // of issuing the Genesis side effect twice.
  mysqlExec(`UPDATE nx_emergency_sop_execution
    SET step_status_json=JSON_ARRAY('running'),
        notification_json=JSON_SET(notification_json, '$.auditStatus', 'PENDING'),
        domain_action_json=JSON_SET(domain_action_json, '$[0].status', 'RUNNING'),
        updated_at=DATE_SUB(NOW(), INTERVAL 3 MINUTE)
    WHERE execution_id='${sql(executionId)}' AND is_deleted=0`);
  const replay = await page.request.post(requestSnapshot!.url, {
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestSnapshot!.key },
    data: JSON.parse(requestSnapshot!.body),
  });
  expect(replay.status()).toBe(200);
  const replayPayload = await apiPayload(replay);
  const replayUpdated = replayPayload.data?.updated as Record<string, unknown> | undefined;
  expect(replayUpdated).toMatchObject({ executionId, idempotentReplay: true, reconciled: true });
  expect(mysqlScalar(`SELECT JSON_UNQUOTE(JSON_EXTRACT(step_status_json,'$[0]')) FROM nx_emergency_sop_execution WHERE execution_id='${sql(executionId)}'`)).toBe("done");
  expect((await readJ1(page)).genesis).toBe(false);

  await page.reload();
  const row = page.getByTestId(`j4-execution-${executionId}`);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "查看追溯" }).click();
  const trace = page.getByRole("dialog", { name: `执行追溯 · ${executionId}` });
  await expect(trace.getByText(/状态 DONE/)).toBeVisible();
  await expect(trace.getByText(/审计状态 AUDITED/)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-stale-reconciled-without-duplicate-side-effect.png"), fullPage: true });
  await trace.getByRole("button", { name: "关闭" }).click();

  const rollbackResponse = page.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith(`/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/rollback`));
  await row.getByRole("button", { name: "回滚", exact: true }).click();
  const rollbackDialog = page.getByRole("dialog", { name: `回滚剧本执行 · ${executionId}` });
  await rollbackDialog.getByLabel(/操作理由/).fill(`${RUN_ID} 根因解除后恢复Genesis并清理验收状态`);
  await rollbackDialog.getByRole("button", { name: "确认提交" }).click();
  expect((await rollbackResponse).ok()).toBeTruthy();
  expect((await readJ1(page)).genesis).toBe(true);
  await page.reload();
  await expect(page.getByTestId(`j4-execution-${executionId}`).getByText("已回滚可逆动作", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "07-j1-rollback-complete.png"), fullPage: true });

  await logout(page);
  const after = await j1SnapshotAfterVisibleLogin(page);
  expect(after).toMatchObject({ genesis: true, ...unrelatedBefore });
  await openJ4FromVisibleMenu(page);
  await expect(page.getByTestId(`j4-execution-${executionId}`)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "08-j1-relogin-persistence-and-clean-state.png"), fullPage: true });
  await writeFile(path.join(EVIDENCE_DIR, "j1-result.json"), JSON.stringify({
    runId: RUN_ID,
    playbookCode: code,
    executionId,
    staleReplayReconciled: true,
    rollbackStatus: "ROLLED_BACK",
    finalGates: after,
    unrelatedBefore,
  }, null, 2), "utf8");
});

test("J4 I3-only execution is visible, idempotent, irreversible, refresh-safe and relogin-safe", async ({ page }) => {
  const playbookName = `${RUN_ID}-I3-only`;
  const runtimeErrors: string[] = [];
  const network: Array<{ method: string; url: string; status: number }> = [];
  page.on("pageerror", (error) => runtimeErrors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(`console:${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.url().includes("/api/admin/")) {
      network.push({ method: response.request().method(), url: response.url(), status: response.status() });
    }
  });

  try {
    await loginAndOpenJ4(page);
    const campaignNo = REQUESTED_CAMPAIGN_NO || await createScheduledI3Fixture(page);
    if (!REQUESTED_CAMPAIGN_NO) {
      await page.reload();
      await expect(page.getByRole("heading", { name: "监管点名应急 SOP", exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("button", { name: "+ 新增剧本", exact: true })).toBeVisible({ timeout: 20_000 });
    }
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-login-menu-j4.png"), fullPage: true });

    const createResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/admin/emergency/sop/playbooks"));
    await page.getByRole("button", { name: "+ 新增剧本", exact: true }).click();
    const authoring = page.getByRole("dialog", { name: "新增应急剧本" });
    await authoring.getByLabel("剧本名称", { exact: true }).fill(playbookName);
    await fieldSelect(authoring, "触发场景").selectOption({ label: "监管点名" });
    await fieldSelect(authoring, "责任角色").selectOption({ label: "超管" });
    await authoring.getByLabel("响应时限（分钟）", { exact: true }).fill("15");
    await authoring.getByPlaceholder("搜索通知标题 / 编号 / 优先级 / 受众").fill(campaignNo);
    await authoring.getByRole("button", { name: new RegExp(campaignNo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).click();
    const actionPicker = authoring.locator('[data-proof="sop-action-option-select"]');
    await actionPicker.getByRole("button", { name: /I3.*发送通知模板|发送通知模板.*I3/ }).click();
    await authoring.locator('[data-proof="sop-rollback-template-select"] button').first().click();
    await authoring.getByLabel(/操作理由/).fill(`${RUN_ID} 创建I3-only应急通知剧本`);
    await authoring.getByRole("button", { name: "确认提交" }).click();
    const created = await apiPayload(await createResponse);
    const code = String((created.data?.updated as Record<string, unknown> | undefined)?.code ?? "");
    expect(code).toMatch(/^SOP-/);
    const card = page.getByTestId(`j4-playbook-${code}`);
    await expect(card.getByText(playbookName, { exact: true })).toBeVisible();

    const drillResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().includes(`/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/drills`));
    await card.getByRole("button", { name: "演练", exact: true }).click();
    const drillDialog = page.getByRole("dialog", { name: new RegExp(`启动演练 · ${code}`) });
    await drillDialog.getByLabel(/操作理由/).fill(`${RUN_ID} I3-only动作与排期活动预检`);
    await drillDialog.getByRole("button", { name: "确认提交" }).click();
    expect((await drillResponse).ok()).toBeTruthy();
    await expect(card.getByText("演练就绪", { exact: true })).toBeVisible();

    let executionRequest: { url: string; key: string; body: string } | undefined;
    const executeResponse = page.waitForResponse((response) => {
      const request = response.request();
      const matches = request.method() === "POST"
        && response.url().includes(`/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/executions`)
        && !response.url().endsWith("/rollback");
      if (matches) {
        executionRequest = {
          url: response.url(),
          key: request.headers()["idempotency-key"] || "",
          body: request.postData() || "",
        };
      }
      return matches;
    });
    await card.getByRole("button", { name: "应急执行", exact: true }).click();
    const executeDialog = page.getByRole("dialog", { name: new RegExp(`执行应急剧本 · ${code}`) });
    await fieldSelect(executeDialog, "触发依据").selectOption({ label: "监管点名" });
    await executeDialog.getByText("触发上下文（8–500 字）").locator("..").getByRole("textbox").fill(`${RUN_ID} 监管通知I3-only真实下发闭环`);
    await executeDialog.locator('[data-proof="j4-step-confirm-1"]').check();
    await executeDialog.getByLabel(/操作理由/).fill(`${RUN_ID} 执行I3-only并核对不可逆通知事实`);
    await executeDialog.getByRole("button", { name: "确认提交" }).click();
    const executedResponse = await executeResponse;
    expect(executedResponse.ok()).toBeTruthy();
    const executed = await apiPayload(executedResponse);
    const execution = executed.data?.updated as Record<string, unknown> | undefined;
    const executionId = String(execution?.executionId ?? "");
    expect(executionId).toBeTruthy();
    expect((execution?.notificationDispatch as Record<string, unknown> | undefined)?.status).toBe("DISPATCHED");
    expect(Number((execution?.notificationDispatch as Record<string, unknown> | undefined)?.notificationCount ?? -1)).toBeGreaterThan(0);
    expect(executionRequest?.key).toBeTruthy();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-i3-only-dispatched.png"), fullPage: true });

    const replay = await page.request.post(executionRequest!.url, {
      headers: { "Content-Type": "application/json", "Idempotency-Key": executionRequest!.key },
      data: JSON.parse(executionRequest!.body),
    });
    expect(replay.status()).toBe(200);
    const replayPayload = await apiPayload(replay);
    expect(String((replayPayload.data?.updated as Record<string, unknown> | undefined)?.executionId ?? "")).toBe(executionId);

    await page.reload();
    await expect(page.getByTestId(`j4-execution-${executionId}`)).toBeVisible();
    await page.getByTestId(`j4-execution-${executionId}`).getByRole("button", { name: "查看追溯" }).click();
    const trace = page.getByRole("dialog", { name: `执行追溯 · ${executionId}` });
    await expect(trace.getByText(/通知状态 DISPATCHED/)).toBeVisible();
    await expect(trace.getByText(/下发数 [1-9]\d*/)).toBeVisible();
    await expect(trace.getByText("回滚事实", { exact: true })).toBeVisible();
    await expect(page.getByTestId(`j4-execution-${executionId}`).getByRole("button", { name: "回滚" })).toHaveCount(0);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-i3-trace-no-rollback.png"), fullPage: true });
    await trace.getByRole("button", { name: "关闭" }).click();

    await logout(page);
    await loginAndOpenJ4(page);
    await expect(page.getByTestId(`j4-execution-${executionId}`)).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-i3-persists-after-relogin.png"), fullPage: true });
    expect(runtimeErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);

    await writeFile(path.join(EVIDENCE_DIR, "i3-result.json"), JSON.stringify({
      runId: RUN_ID,
      campaignNo,
      playbookName,
      playbookCode: code,
      executionId,
      notificationStatus: (execution?.notificationDispatch as Record<string, unknown> | undefined)?.status,
      notificationCount: (execution?.notificationDispatch as Record<string, unknown> | undefined)?.notificationCount,
      idempotencyKeyReused: true,
    }, null, 2), "utf8");
  } finally {
    await writeFile(path.join(EVIDENCE_DIR, "network.json"), JSON.stringify(network, null, 2), "utf8").catch(() => undefined);
    await writeFile(path.join(EVIDENCE_DIR, "runtime-errors.json"), JSON.stringify(runtimeErrors, null, 2), "utf8").catch(() => undefined);
  }
});

test("J4 permission matrix enforces menu, page, button, API and refreshed role grants", async ({ page, browser }) => {
  await loginAndOpenJ4(page);
  const j1Card = page.locator('[data-testid^="j4-playbook-"]').filter({ hasText: `${RUN_ID}-J1-genesis-` }).first();
  await expect(j1Card, "本轮 J1 剧本必须作为权限矩阵的真实就绪目标").toBeVisible();
  const playbookCode = (await j1Card.getAttribute("data-testid"))?.replace("j4-playbook-", "") ?? "";
  expect(playbookCode).toMatch(/^SOP-/);

  const suffix = `${Date.now()}`.slice(-9);
  const temporaryPassword = (label: string, changed = false) => `J4${label}${suffix}${changed ? "B" : "A"}@9z`;
  const checkerUsername = `j4c${suffix}`;
  const checkerInitialPassword = temporaryPassword("Checker");
  const checkerPassword = temporaryPassword("Checker", true);
  let checkerAccountId = "";
  let checkerContext: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  let checkerPage: Page | null = null;
  const profiles: Array<{
    label: string;
    roleCode: string;
    roleId: string;
    username: string;
    accountId: string;
    initialPassword: string;
    changedPassword: string;
    mfaSecret: string;
    permissions: string[];
    menuIds: number[];
    context: Awaited<ReturnType<Browser["newContext"]>> | null;
    page: Page | null;
  }> = [];

  try {
    const checkerAccount = await apiSend(page, "POST", "/api/admin/platform/accounts", {
      username: checkerUsername,
      displayName: `J4 Checker ${suffix}`,
      email: `${checkerUsername}@nexion.invalid`,
      role: "super",
      deliver: "handoff",
      initialPassword: checkerInitialPassword,
      reason: `${RUN_ID} 创建J4权限矩阵双人复核账号`,
      operator: USERNAME,
    });
    expect(checkerAccount.status, checkerAccount.raw).toBeLessThan(400);
    checkerAccountId = String(checkerAccount.data?.id ?? checkerAccount.data?.accountId ?? "");
    expect(checkerAccountId).not.toBe("");
    checkerContext = await browser.newContext({ viewport: { width: 1680, height: 950 } });
    checkerPage = await checkerContext.newPage();
    await loginCredentialsFromVisibleEntry(checkerPage, checkerUsername, checkerInitialPassword, checkerPassword);

    const menus = await apiSend(page, "GET", "/api/admin/platform/menus/overview");
    expect(menus.status, menus.raw).toBeLessThan(400);
    const flattened: Array<{ id: number; menuCode: string }> = [];
    const visit = (nodes: any[]) => nodes.forEach((item) => {
      flattened.push(item.node);
      visit(item.children ?? []);
    });
    visit(menus.data?.tree ?? []);
    const j4MenuIds = flattened.filter((item) => item.menuCode === "J" || item.menuCode === "J4").map((item) => item.id);
    expect(j4MenuIds).toHaveLength(2);

    const definitions = [
      { label: "readonly", permissions: ["emergency_j4_read"], menuIds: j4MenuIds },
      { label: "menu_no_write", permissions: ["emergency_j4_read"], menuIds: j4MenuIds },
      { label: "writer_no_target", permissions: ["emergency_j4_read", "emergency_j4_write", "emergency_j4_playbook_execute"], menuIds: j4MenuIds },
      { label: "writer_target", permissions: ["emergency_j4_read", "emergency_j4_write", "emergency_j4_playbook_execute", "emergency_j1_gate_kill"], menuIds: j4MenuIds },
      { label: "no_menu", permissions: [], menuIds: [] },
    ];

    for (const [index, definition] of definitions.entries()) {
      const roleCode = `J4_${definition.label.toUpperCase()}_${suffix}`.slice(0, 48);
      const username = `j4${index}${suffix}`;
      const initialPassword = temporaryPassword(`P${index}`);
      const changedPassword = temporaryPassword(`P${index}`, true);
      const role = await apiSend(page, "POST", "/api/admin/platform/roles", {
        roleCode,
        roleName: `J4 ${definition.label} ${suffix}`,
        remark: "J4 验收临时角色，完成后删除",
        status: 1,
        reason: `${RUN_ID} 创建J4 ${definition.label}临时角色`,
        operator: USERNAME,
      });
      expect(role.status, role.raw).toBeLessThan(400);
      const profile = {
        ...definition,
        roleCode,
        roleId: String(role.data?.id ?? ""),
        username,
        accountId: "",
        initialPassword,
        changedPassword,
        mfaSecret: "",
        context: null,
        page: null,
      };
      expect(profile.roleId).not.toBe("");
      profiles.push(profile);

      if (definition.permissions.length || definition.menuIds.length) {
        const grants = await apiSend(page, "PUT", `/api/admin/platform/roles/${profile.roleId}/grants`, {
          permissionCodes: definition.permissions,
          menuIds: definition.menuIds,
          reason: `${RUN_ID} 绑定J4 ${definition.label}权限矩阵`,
          operator: USERNAME,
        });
        expect(grants.status, grants.raw).toBeLessThan(400);
        await decideAuditTicket(checkerPage, auditTicketId(grants.data), "approve", `${RUN_ID} 复核J4 ${definition.label}授权`, checkerUsername);
      }

      const account = await apiSend(page, "POST", "/api/admin/platform/accounts", {
        username,
        displayName: `J4 ${definition.label} ${suffix}`,
        email: `${username}@nexion.invalid`,
        role: roleCode,
        deliver: "handoff",
        initialPassword,
        reason: `${RUN_ID} 创建J4 ${definition.label}临时账号`,
        operator: USERNAME,
      });
      expect(account.status, account.raw).toBeLessThan(400);
      profile.accountId = String(account.data?.id ?? account.data?.accountId ?? "");
      expect(profile.accountId).not.toBe("");
    }

    for (const profile of profiles) {
      profile.context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
      profile.page = await profile.context.newPage();
      profile.mfaSecret = await loginCredentialsFromVisibleEntry(profile.page, profile.username, profile.initialPassword, profile.changedPassword) ?? "";
      if (profile.label === "no_menu") {
        await expect(profile.page.locator('a[href="/emergency/sop"]')).toHaveCount(0);
        await profile.page.goto("/emergency/sop");
        await expect(profile.page).toHaveURL(/\/$/, { timeout: 20_000 });
        await expect(profile.page.getByRole("heading", { name: "监管点名应急 SOP" })).toHaveCount(0);
        await profile.page.screenshot({ path: path.join(EVIDENCE_DIR, "13-no-menu-direct-route-denied.png"), fullPage: true });
        continue;
      }

      await openJ4FromVisibleMenu(profile.page);
      const targetCard = profile.page.getByTestId(`j4-playbook-${playbookCode}`);
      await expect(targetCard).toBeVisible();
      const executeButton = targetCard.getByRole("button", { name: /应急执行|执行/, exact: true });
      if (profile.label === "readonly" || profile.label === "menu_no_write") {
        await expect(profile.page.getByRole("button", { name: "+ 新增剧本", exact: true })).toHaveCount(0);
        await expect(targetCard.getByRole("button", { name: /编辑|演练/, exact: true })).toHaveCount(0);
        await expect(executeButton).toBeDisabled();
        await expect(executeButton).toHaveAttribute("title", "缺少 J4 执行权限");
        const writeProbe = await apiSend(profile.page, "POST", "/api/admin/emergency/sop/playbooks", {
          name: `${RUN_ID} 越权探针`,
          reason: `${RUN_ID} 只读角色越权探针不得执行`,
          operator: profile.username,
        });
        expect(writeProbe.status, writeProbe.raw).toBe(403);
        if (profile.label === "readonly") {
          await profile.page.screenshot({ path: path.join(EVIDENCE_DIR, "09-readonly-menu-page-buttons-api.png"), fullPage: true });
        }
        continue;
      }

      if (profile.label === "writer_no_target") {
        await expect(profile.page.getByRole("button", { name: "+ 新增剧本", exact: true })).toBeVisible();
        await expect(targetCard.getByRole("button", { name: "编辑", exact: true })).toBeVisible();
        await expect(executeButton).toBeDisabled();
        await expect(executeButton).toHaveAttribute("title", "缺少对应处置权限");
        const targetProbe = await apiSend(profile.page, "POST", `/api/admin/emergency/sop/playbooks/${playbookCode}/executions`, {
          emergency: true,
          reason: `${RUN_ID} 缺少J1目标权限探针不得执行`,
          operator: profile.username,
          triggerBasis: "监管点名",
          triggerContext: `${RUN_ID} 缺少目标权限的服务端对抗性探针`,
          stepConfirmations: [{ step: 1, domain: "J1", ref: "GENESIS", confirmed: true }],
        });
        expect(targetProbe.status, targetProbe.raw).toBe(403);
        expect(targetProbe.raw).toContain("J4_TARGET_AUTHORITY_REQUIRED");
        await profile.page.screenshot({ path: path.join(EVIDENCE_DIR, "10-writer-no-target-ui-and-api-denied.png"), fullPage: true });
        continue;
      }

      await expect(executeButton).toBeEnabled();
      await expect(executeButton).not.toHaveAttribute("title", /缺少/);
      await profile.page.screenshot({ path: path.join(EVIDENCE_DIR, "11-writer-with-target-enabled.png"), fullPage: true });
    }

    const writerTarget = profiles.find((item) => item.label === "writer_target")!;
    const removedGrants = await apiSend(page, "PUT", `/api/admin/platform/roles/${writerTarget.roleId}/grants`, {
      permissionCodes: [],
      menuIds: [],
      reason: `${RUN_ID} 撤销J4权限验证缓存即时失效`,
      operator: USERNAME,
    });
    expect(removedGrants.status, removedGrants.raw).toBeLessThan(400);
    await decideAuditTicket(checkerPage, auditTicketId(removedGrants.data), "approve", `${RUN_ID} 复核J4权限撤销与缓存刷新`, checkerUsername);
    await writerTarget.page!.reload();
    await expect(writerTarget.page!).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(writerTarget.page!.locator('a[href="/emergency/sop"]')).toHaveCount(0);
    await writerTarget.context!.close();
    writerTarget.context = await browser.newContext({ viewport: { width: 1680, height: 950 } });
    writerTarget.page = await writerTarget.context.newPage();
    await loginCredentialsFromVisibleEntry(writerTarget.page, writerTarget.username, writerTarget.changedPassword, undefined, writerTarget.mfaSecret);
    await expect(writerTarget.page.locator('a[href="/emergency/sop"]')).toHaveCount(0);
    await writerTarget.page.goto("/emergency/sop");
    await expect(writerTarget.page).toHaveURL(/\/$/, { timeout: 20_000 });
    await writerTarget.page.screenshot({ path: path.join(EVIDENCE_DIR, "12-role-revocation-refresh-and-relogin.png"), fullPage: true });

    await writeFile(path.join(EVIDENCE_DIR, "permission-matrix.json"), JSON.stringify({
      runId: RUN_ID,
      playbookCode,
      rows: [
        { role: "SUPER", menu: true, read: true, write: true, targetAuthority: true, result: "PASS" },
        { role: "READ_ONLY", menu: true, read: true, write: false, apiWrite: 403, result: "PASS" },
        { role: "J4_MENU_NO_WRITE", menu: true, read: true, write: false, result: "PASS" },
        { role: "J4_WRITE_NO_TARGET", menu: true, write: true, executeButton: "disabled", apiExecute: 403, result: "PASS" },
        { role: "J4_WRITE_WITH_TARGET", menu: true, executeButton: "enabled", result: "PASS" },
        { role: "NO_J4_MENU", menu: false, directRoute: "redirected", result: "PASS" },
        { role: "REVOKED_CACHE_REFRESH", refresh: "redirected", relogin: "redirected", result: "PASS" },
      ],
    }, null, 2), "utf8");
  } finally {
    for (const profile of profiles) {
      await profile.context?.close().catch(() => undefined);
      profile.context = null;
      profile.page = null;
      if (profile.accountId) {
        await apiSend(page, "PATCH", `/api/admin/platform/accounts/${profile.accountId}/status`, {
          status: "disabled", reason: `${RUN_ID} 清理J4 ${profile.label}临时账号`, operator: USERNAME,
        }).catch(() => undefined);
        await apiSend(page, "POST", `/api/admin/platform/accounts/${profile.accountId}/sessions/revoke`, {
          reason: `${RUN_ID} 撤销J4 ${profile.label}临时会话`, operator: USERNAME,
        }).catch(() => undefined);
        await apiSend(page, "PATCH", `/api/admin/platform/accounts/${profile.accountId}/role`, {
          role: "unassigned", reason: `${RUN_ID} 解除J4 ${profile.label}临时角色`, operator: USERNAME,
        }).catch(() => undefined);
      }
      if (profile.roleId) {
        const removed = await apiSend(page, "DELETE", `/api/admin/platform/roles/${profile.roleId}`, {
          reason: `${RUN_ID} 清理J4 ${profile.label}临时角色`, operator: USERNAME,
        }).catch(() => null);
        if (removed && removed.status < 400 && checkerPage) {
          await decideAuditTicket(checkerPage, auditTicketId(removed.data), "approve", `${RUN_ID} 复核删除J4 ${profile.label}临时角色`, checkerUsername).catch(() => undefined);
        }
      }
    }
    await checkerContext?.close().catch(() => undefined);
    checkerContext = null;
    checkerPage = null;
    if (checkerAccountId) {
      await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/status`, {
        status: "disabled", reason: `${RUN_ID} 停用J4双人复核临时账号`, operator: USERNAME,
      }).catch(() => undefined);
      await apiSend(page, "PATCH", `/api/admin/platform/accounts/${checkerAccountId}/role`, {
        role: "unassigned", reason: `${RUN_ID} 解除J4双人复核临时账号角色`, operator: USERNAME,
      }).catch(() => undefined);
    }
  }
});

async function loginAndOpenJ4(page: Page) {
  await loginCredentialsFromVisibleEntry(page, USERNAME, PASSWORD!);
  const group = page.getByRole("button", { name: /紧急与合规控制\s*J|J\s*紧急与合规控制/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/emergency/sop"]').first();
  await expect(link, "J4 must be discoverable from the visible sidebar").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/sop$/);
  await expect(page.getByRole("heading", { name: "监管点名应急 SOP", exact: true })).toBeVisible({ timeout: 20_000 });
}

async function loginCredentialsFromVisibleEntry(
  page: Page,
  username: string,
  password: string,
  changedPassword?: string,
  knownMfaSecret?: string,
): Promise<string | undefined> {
  let enrolledMfaSecret = knownMfaSecret;
  await page.goto("/");
  await expect(page.getByLabel(/用户名|账号/).first()).toBeVisible();
  await page.getByLabel(/用户名|账号/).first().fill(username);
  await page.getByLabel(/密码/).first().fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).first().click();
  let transientLoginRetries = 0;
  for (let step = 0; step < 30; step += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return enrolledMfaSecret;
    if (await page.getByRole("heading", { name: "双因素身份验证" }).isVisible().catch(() => false)) {
      const displayedSecret = (await page.locator("code").textContent({ timeout: 1_000 }).catch(() => null))?.trim();
      const secret = displayedSecret || enrolledMfaSecret;
      if (!secret) throw new Error(`MFA_SECRET_NOT_AVAILABLE_FOR_${username}`);
      enrolledMfaSecret = secret;
      await verifyMfaWithSingleBoundaryRetry(page, secret, username);
      continue;
    }
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`PASSWORD_CHANGE_REQUIRED_FOR_${username}`);
      await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
      try {
        await page.getByRole("button", { name: "确认修改并进入", exact: true }).click({ timeout: 5_000 });
      } catch (error) {
        if (!await page.locator("aside").isVisible().catch(() => false)) throw error;
        return enrolledMfaSecret;
      }
      continue;
    }
    const retryButton = page.getByRole("button", { name: /登录|继续/ }).first();
    const transientAlert = page.getByRole("alert").filter({ hasText: /操作失败|暂时不可用|稍后重试/ });
    if (transientLoginRetries < 2
      && await retryButton.isVisible().catch(() => false)
      && await transientAlert.isVisible().catch(() => false)) {
      transientLoginRetries += 1;
      await page.waitForTimeout(500);
      await retryButton.click();
      continue;
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  return enrolledMfaSecret;
}

async function verifyMfaWithSingleBoundaryRetry(page: Page, secret: string, username: string) {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  // MFA challenges are one-shot. Never submit near a TOTP boundary and never
  // retry an already-consumed challenge; a new login must issue a new challenge.
  if (remainingMs <= 12_000) await page.waitForTimeout(remainingMs + 750);
  for (let attempt = 0; attempt < 1; attempt += 1) {
    const code = totp(secret);
    await page.getByLabel("一次性验证码").fill(code);
    const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
      && response.url().endsWith("/api/admin/auth/mfa/verify"));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await responsePromise;
    // A successful MFA response immediately replaces the login tree and can race
    // Chromium's response-body retention; the HTTP status plus visible shell is authoritative.
    const raw = await response.text().catch(() => "");
    let body: any = null;
    try { body = JSON.parse(raw); } catch { /* keep raw for diagnostic */ }
    if (response.ok() && (body?.code === undefined || body.code === 0)) {
      return;
    }
    throw new Error(`MFA_VERIFY_FAILED_FOR_${username}: HTTP ${response.status()} ${raw}`);
  }
}

function totp(secret: string) {
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function decodeBase32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = raw.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

async function apiSend(page: Page, method: string, url: string, body?: unknown) {
  const response = await page.request.fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `j4-accept-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    data: body,
  });
  const raw = await response.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* keep raw evidence */ }
  return { status: response.status(), raw, data: json?.data ?? json };
}

function auditTicketId(data: any) {
  const operationId = String(data?.operationId ?? data?.id ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  return operationId;
}

async function decideAuditTicket(
  page: Page,
  operationId: string,
  decision: "approve" | "reject",
  reason: string,
  operator = USERNAME,
) {
  const response = await apiSend(page, "POST", `/api/admin/platform/audit/operations/${operationId}/${decision}`, { reason, operator });
  expect(response.status, response.raw).toBeLessThan(400);
  return response;
}

async function createScheduledI3Fixture(page: Page) {
  const token = `j4acc-final-${Date.now()}`;
  const created = await apiSend(page, "POST", "/api/admin/content/campaigns", {
    name: `J4ACC-I3-${token}`,
    titleZh: "J4 最终复验监管通知",
    titleVi: "Thong bao kiem thu J4 cuoi cung",
    titleEn: "J4 final acceptance notice",
    bodyZh: `${RUN_ID} 监管点名应急 SOP 最终复验通知。`,
    bodyVi: `${RUN_ID} thong bao kiem thu quy trinh ung pho J4.`,
    bodyEn: `${RUN_ID} J4 emergency SOP final acceptance notice.`,
    kind: "system",
    ctaHref: "",
    ctaLabel: "",
    tier: "critical",
    audienceTarget: { phaseMin: "P1", phaseMax: "P6", language: "all", registrationDaysMin: 0 },
    budget: 0,
    reason: `${RUN_ID} 创建I3最终复验隔离活动`,
    operator: USERNAME,
  });
  expect(created.status, created.raw).toBeLessThan(400);
  const updated = (created.data?.updated ?? created.data) as Record<string, unknown> | undefined;
  const campaignNo = String(updated?.id ?? updated?.campaignNo ?? "");
  const revision = Number(updated?.revision ?? 0);
  expect(campaignNo).toMatch(/^CMP-N-/);
  expect(revision).toBeGreaterThanOrEqual(0);
  const schedule = localDateTime(new Date(Date.now() + 2 * 60 * 60 * 1000));
  const scheduled = await apiSend(page, "POST", `/api/admin/content/campaigns/${encodeURIComponent(campaignNo)}/schedule`, {
    schedule,
    expectedRevision: revision,
    reason: `${RUN_ID} 排期I3最终复验隔离活动`,
    operator: USERNAME,
  });
  expect(scheduled.status, scheduled.raw).toBeLessThan(400);
  await writeFile(path.join(EVIDENCE_DIR, "i3-fixture.json"), JSON.stringify({ campaignNo, schedule, revision, token }, null, 2), "utf8");
  return campaignNo;
}

function localDateTime(value: Date) {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}

async function openJ4FromVisibleMenu(page: Page) {
  const group = page.getByRole("button", { name: /紧急与合规控制\s*J|J\s*紧急与合规控制/ }).first();
  const link = page.locator('a[href="/emergency/sop"]').first();
  if (!(await link.isVisible().catch(() => false)) && await group.isVisible().catch(() => false)) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/sop$/);
  await expect(page.getByRole("heading", { name: "监管点名应急 SOP", exact: true })).toBeVisible({ timeout: 20_000 });
}

async function j1SnapshotAfterVisibleLogin(page: Page) {
  await loginCredentialsFromVisibleEntry(page, USERNAME, PASSWORD!);
  return readJ1(page);
}

async function readJ1(page: Page) {
  const response = await page.request.get("/api/admin/emergency/kill-switches");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data: { activeGates: Array<{ key: string; enabled: boolean }> } };
  return Object.fromEntries(payload.data.activeGates.map((gate) => [gate.key, gate.enabled])) as Record<string, boolean>;
}

async function logout(page: Page) {
  const accountMenu = page.getByRole("button", { name: /superadmin|Super Admin|总管理员/i }).last();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.getByLabel(/用户名|账号/).first()).toBeVisible({ timeout: 15_000 });
}

function fieldSelect(scope: Locator, label: string) {
  return scope.locator("label").filter({ hasText: label }).locator("select").first();
}

async function apiPayload(response: APIResponse | Response) {
  const payload = await response.json() as { code: number; message?: string; data?: Record<string, unknown> };
  expect(payload.code, JSON.stringify(payload)).toBe(0);
  return payload;
}

function mysqlExec(statement: string) {
  execFileSync(MYSQL_EXE, ["-h127.0.0.1", "-uroot", "--default-character-set=utf8mb4", "-N", "-B", "nexion", "-e", statement], {
    env: { ...process.env, MYSQL_PWD: MYSQL_PASSWORD! },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function mysqlScalar(statement: string) {
  return execFileSync(MYSQL_EXE, ["-h127.0.0.1", "-uroot", "--default-character-set=utf8mb4", "-N", "-B", "nexion", "-e", statement], {
    env: { ...process.env, MYSQL_PWD: MYSQL_PASSWORD! },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sql(value: string) {
  return value.replaceAll("'", "''");
}
