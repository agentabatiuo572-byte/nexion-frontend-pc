import { createHmac, randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext, type Page, type Response } from "@playwright/test";

const EVIDENCE_DIR = process.env.A6_A8_EVIDENCE_DIR || "D:/workspace/bug-pic/a6-a8-reacceptance-20260718/main";
const SUPER_USERNAME = process.env.ADMIN_E2E_USERNAME || "superadmin";
const SUPER_PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const STALE_ROLE_CODE = process.env.A6_A8_STALE_ROLE_CODE?.trim() || "";
const STALE_MENU_CODES = (process.env.A6_A8_STALE_MENU_CODES || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const STALE_ACCOUNT_IDS = (process.env.A6_A8_STALE_ACCOUNT_IDS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const RUN_TOKEN = Date.now().toString(36).toUpperCase();
const ROLE_CODE = `RT${RUN_TOKEN}`.slice(0, 63);
const MENU_CODE = `ZRT${RUN_TOKEN}`.slice(0, 63);
const CHILD_MENU_CODE = `CRT${RUN_TOKEN}`.slice(0, 63);
const CONCURRENT_MENU_CODE = `YRT${RUN_TOKEN}`.slice(0, 63);
const LINKED_USERNAME = `rbac_link_${RUN_TOKEN.toLowerCase()}`.slice(0, 63);
const AUDITOR_USERNAME = `rbac_audit_${RUN_TOKEN.toLowerCase()}`.slice(0, 63);
const CHECKER_USERNAME = `rbac_check_${RUN_TOKEN.toLowerCase()}`.slice(0, 63);
const LINKED_INITIAL_PASSWORD = temporaryPassword("LinkedInit");
const LINKED_NEW_PASSWORD = temporaryPassword("LinkedReady");
const AUDITOR_INITIAL_PASSWORD = temporaryPassword("AuditInit");
const AUDITOR_NEW_PASSWORD = temporaryPassword("AuditReady");
const CHECKER_INITIAL_PASSWORD = temporaryPassword("CheckerInit");
const CHECKER_NEW_PASSWORD = temporaryPassword("CheckerReady");
const REASON = `A6A7A8复验${RUN_TOKEN}验证真实闭环与失败恢复`;

type ApiEnvelope<T = unknown> = { code: number; message?: string; data?: T };

test("A6/A7/A8 real linked flow: grants, A2 replay, idempotency, readonly and recovery", async ({ page, browser }) => {
  assertLocalTarget();
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const pageErrors: string[] = [];
  const evidence: Record<string, unknown> = {
    runToken: RUN_TOKEN,
    roleCode: ROLE_CODE,
    menuCode: MENU_CODE,
    linkedUsername: LINKED_USERNAME,
    auditorUsername: AUDITOR_USERNAME,
    checkerUsername: CHECKER_USERNAME,
    startedAt: new Date().toISOString(),
  };
  let roleId: number | null = null;
  let menuId: number | null = null;
  let childMenuId: number | null = null;
  let concurrentMenuId: number | null = null;
  let parentDisableIdempotencyKey = "";
  let linkedAccountId: string | null = null;
  let accountId: string | null = null;
  let checkerAccountId: string | null = null;
  let checkerContext: BrowserContext | null = null;
  let checkerPage: Page | null = null;
  page.on("pageerror", (error) => pageErrors.push(error.message));

  try {
    const anonymousStatuses = await Promise.all([
      page.request.get("/api/admin/platform/roles/overview"),
      page.request.get("/api/admin/platform/menus/overview"),
      page.request.get("/api/admin/platform/permissions?pageNum=1&pageSize=20"),
    ]);
    expect(anonymousStatuses.map((response) => response.status())).toEqual([401, 401, 401]);
    evidence.unauthenticatedRead = [401, 401, 401];
    await loginThroughUi(page, SUPER_USERNAME, SUPER_PASSWORD);

    const createChecker = await page.request.post("/api/admin/platform/accounts", {
      headers: { "Idempotency-Key": `a1-checker-create-${RUN_TOKEN}` },
      data: {
        username: CHECKER_USERNAME,
        displayName: `A6A7A8独立复核员${RUN_TOKEN}`,
        email: `${CHECKER_USERNAME}@example.test`,
        role: "super",
        deliver: "handoff",
        initialPassword: CHECKER_INITIAL_PASSWORD,
        reason: `${REASON}创建独立maker-checker复核账号`,
        operator: SUPER_USERNAME,
      },
    });
    const checker = await apiSuccess<Record<string, unknown>>(createChecker);
    checkerAccountId = String(checker.id);
    const checkerIssuedPassword = String(checker.temporaryPassword ?? "");
    expect(checkerAccountId).toMatch(/^\d+$/);
    expect(checkerIssuedPassword).not.toBe("");
    expect(checkerIssuedPassword).not.toBe(CHECKER_INITIAL_PASSWORD);
    checkerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    checkerPage = await checkerContext.newPage();
    await loginThroughUi(checkerPage, CHECKER_USERNAME, checkerIssuedPassword, CHECKER_NEW_PASSWORD);
    evidence.checkerAccountId = checkerAccountId;
    evidence.makerChecker = { maker: SUPER_USERNAME, checker: CHECKER_USERNAME, distinct: true };
    if (STALE_ROLE_CODE) {
      evidence.staleRecovery = await recoverStaleRole(page, checkerPage, STALE_ROLE_CODE);
    }
    if (STALE_MENU_CODES.length > 0) {
      evidence.staleMenuRecovery = await recoverStaleMenus(page, STALE_MENU_CODES);
    }
    if (STALE_ACCOUNT_IDS.length > 0) {
      evidence.staleAccountRecovery = await recoverStaleAccounts(page, STALE_ACCOUNT_IDS);
    }

    await test.step("A6 creates an empty role and rejects unknown grants atomically", async () => {
      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible();
      await page.getByRole("button", { name: "+ 新建角色", exact: true }).click();
      await page.getByPlaceholder("如 CONTENT_EDITOR").fill(ROLE_CODE);
      await page.getByPlaceholder("如 内容编辑员").fill(`复验临时角色 ${RUN_TOKEN}`);
      await page.getByPlaceholder("职责说明").fill("只用于A6A7A8真实链路复验，结束后删除");
      await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();

      const response = await confirmAndCapture(page, REASON, (candidate) =>
        candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/platform/roles"));
      const body = await expectApiSuccess<Record<string, unknown>>(response, "A6 create role");
      roleId = Number(body.id);
      expect(Number.isSafeInteger(roleId) && roleId > 0).toBeTruthy();
      evidence.a6Create = { roleId, response: body };

      await expect(page.getByText(ROLE_CODE, { exact: true }).first()).toBeVisible();
      const detailBefore = await apiSuccess<Record<string, unknown>>(await page.request.get(`/api/admin/platform/roles/${roleId}`));
      expect(detailBefore.permissionCodes).toEqual([]);
      expect(detailBefore.menuIds).toEqual([]);

      const invalid = await page.request.put(`/api/admin/platform/roles/${roleId}/grants`, {
        headers: { "Idempotency-Key": `a6-invalid-${RUN_TOKEN}` },
        data: {
          permissionCodes: ["NOT_A_REAL_PERMISSION"],
          menuIds: [999_999_999],
          reason: REASON,
          operator: SUPER_USERNAME,
        },
      });
      const invalidBody = await invalid.json() as ApiEnvelope;
      expect(invalid.status()).toBe(422);
      expect(invalidBody.message).toBe("ROLE_GRANTS_UNKNOWN_PERMISSION_OR_MENU");
      const detailAfter = await apiSuccess<Record<string, unknown>>(await page.request.get(`/api/admin/platform/roles/${roleId}`));
      expect(detailAfter.permissionCodes).toEqual([]);
      expect(detailAfter.menuIds).toEqual([]);
      evidence.a6InvalidGrant = { status: invalid.status(), message: invalidBody.message, zeroSideEffect: true };
      await page.screenshot({ path: `${EVIDENCE_DIR}/01-a6-role-created.png`, fullPage: true });
    });

    await test.step("A7 creates the menu node with true idempotency and keeps it for the A6 link", async () => {
      await navigatePlatform(page, "菜单管理 A7", /\/platform\/menus$/);
      await expect(page.getByRole("heading", { name: "菜单管理" })).toBeVisible();
      await page.getByRole("button", { name: "+ 新建顶级菜单", exact: true }).click();
      await page.getByPlaceholder("如 A9 或 CUSTOM_X").fill(MENU_CODE);
      await page.getByPlaceholder("如 角色管理").fill(`复验菜单 ${RUN_TOKEN}`);
      await page.getByPlaceholder("/platform/xxx").fill(`/acceptance/${RUN_TOKEN.toLowerCase()}`);
      await page.getByPlaceholder("shield-check").fill("shield-check");
      await page.locator('input[type="number"]').fill("9999");
      await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();

      const requestPromise = page.waitForRequest((candidate) =>
        candidate.method() === "POST" && candidate.url().endsWith("/api/admin/platform/menus"));
      const responsePromise = page.waitForResponse((candidate) =>
        candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/platform/menus"));
      await confirmDialog(page, `${REASON}创建临时菜单`);
      const [request, response] = await Promise.all([requestPromise, responsePromise]);
      const created = await expectApiSuccess<Record<string, unknown>>(response, "A7 create menu");
      menuId = Number(created.id);
      expect(Number.isSafeInteger(menuId) && menuId > 0).toBeTruthy();
      const idempotencyKey = request.headers()["idempotency-key"];
      const originalBody = request.postDataJSON();
      expect(idempotencyKey).toBeTruthy();
      await expect(page.getByText(MENU_CODE, { exact: true })).toBeVisible();

      const replay = await page.request.post("/api/admin/platform/menus", {
        headers: { "Idempotency-Key": idempotencyKey },
        data: originalBody,
      });
      const replayData = await apiSuccess<Record<string, unknown>>(replay);
      expect(Number(replayData.id)).toBe(menuId);
      const mismatch = await page.request.post("/api/admin/platform/menus", {
        headers: { "Idempotency-Key": idempotencyKey },
        data: { ...originalBody, menuName: `不应覆盖 ${RUN_TOKEN}` },
      });
      const mismatchBody = await mismatch.json() as ApiEnvelope;
      expect(mismatch.status()).toBe(409);
      expect(mismatchBody.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");
      const overview = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/menus/overview"));
      expect(countMenuCode(overview.tree, MENU_CODE)).toBe(1);

      await menuRowByCode(page, MENU_CODE).getByRole("button", { name: "+ 子级", exact: true }).click();
      await page.getByPlaceholder("如 A9 或 CUSTOM_X").fill(CHILD_MENU_CODE);
      await page.getByPlaceholder("如 角色管理").fill(`约束子菜单 ${RUN_TOKEN}`);
      await page.getByPlaceholder("/platform/xxx").fill(`/acceptance/${RUN_TOKEN.toLowerCase()}/child`);
      await page.getByPlaceholder("shield-check").fill("shield-check");
      await page.getByRole("button", { name: "提交（需确认）", exact: true }).click();
      const childResponse = await confirmAndCapture(page, `${REASON}创建启用子菜单验证父子约束`, (candidate) =>
        candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/platform/menus"));
      const child = await expectApiSuccess<Record<string, unknown>>(childResponse, "A7 visible child create");
      childMenuId = Number(child.id);
      expect(childMenuId).toBeGreaterThan(0);

      await menuRowByCode(page, MENU_CODE).getByRole("button", { name: "编辑", exact: true }).click();
      const parentDrawer = page.getByRole("dialog").filter({ has: page.getByText(MENU_CODE, { exact: true }) });
      await parentDrawer.locator("select").selectOption("0");
      await parentDrawer.getByRole("button", { name: "保存（需确认）", exact: true }).click();
      const blockedParentDisable = await confirmRejectedThroughUi(
        page,
        `${REASON}验证启用子菜单阻止父菜单停用`,
        (candidate) => candidate.request().method() === "PATCH"
          && candidate.url().endsWith(`/api/admin/platform/menus/${menuId}`),
        "MENU_NODE_HAS_ACTIVE_CHILDREN",
        "该菜单仍有启用中的子菜单，请先停用或迁移启用中的子菜单。",
        `${EVIDENCE_DIR}/04a-a7-visible-parent-disable-rejected.png`,
      );
      parentDisableIdempotencyKey = blockedParentDisable.idempotencyKey;
      await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();
      const treeAfterBlockedDisable = await apiSuccess<Record<string, unknown>>(
        await page.request.get("/api/admin/platform/menus/overview"));
      expect(findMenuStatus(treeAfterBlockedDisable.tree, MENU_CODE)).toBe(1);

      const parentRow = menuRowByCode(page, MENU_CODE);
      const expand = parentRow.getByRole("button", { name: "展开", exact: true });
      if (await expand.isVisible().catch(() => false)) await expand.click();
      await menuRowByCode(page, CHILD_MENU_CODE).getByRole("button", { name: "删除", exact: true }).click();
      const childDeleteResponse = await confirmAndCapture(page, `${REASON}清理父子约束临时子菜单`, (candidate) =>
        candidate.request().method() === "DELETE"
          && candidate.url().endsWith(`/api/admin/platform/menus/${childMenuId}`));
      await expectApiSuccess(childDeleteResponse, "A7 visible child cleanup");
      childMenuId = null;

      const shortReason = await page.request.delete(`/api/admin/platform/menus/${menuId}`, {
        headers: { "Idempotency-Key": `a7-short-${RUN_TOKEN}` },
        data: {
          expectedVersion: findMenuVersion(
            (await apiSuccess<Record<string, unknown>>(
              await page.request.get("/api/admin/platform/menus/overview"))).tree,
            MENU_CODE,
          ),
          reason: "short",
          operator: SUPER_USERNAME,
        },
      });
      const shortBody = await shortReason.json() as ApiEnvelope;
      expect(shortReason.status()).toBe(422);
      expect(shortBody.message).toBe("REASON_LENGTH_INVALID");
      expect(countMenuCode((await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/menus/overview"))).tree, MENU_CODE)).toBe(1);

      const concurrentKey = `a7-concurrent-${RUN_TOKEN}`;
      const concurrentBody = {
        menuCode: CONCURRENT_MENU_CODE,
        menuName: `并发幂等复验 ${RUN_TOKEN}`,
        routePath: `/acceptance/concurrent-${RUN_TOKEN.toLowerCase()}`,
        icon: "shield-check",
        sortOrder: 9998,
        status: 1,
        reason: `${REASON}并发创建幂等菜单`,
        operator: SUPER_USERNAME,
      };
      const concurrentResponses = await Promise.all([
        page.request.post("/api/admin/platform/menus", { headers: { "Idempotency-Key": concurrentKey }, data: concurrentBody }),
        page.request.post("/api/admin/platform/menus", { headers: { "Idempotency-Key": concurrentKey }, data: concurrentBody }),
      ]);
      for (const response of concurrentResponses) {
        expect([200, 409]).toContain(response.status());
        if (response.status() === 409) {
          const body = await response.json() as ApiEnvelope;
          expect(body.message).toBe("IDEMPOTENCY_REQUEST_IN_PROGRESS");
        }
      }
      const settledReplay = await apiSuccess<Record<string, unknown>>(await page.request.post("/api/admin/platform/menus", {
        headers: { "Idempotency-Key": concurrentKey },
        data: concurrentBody,
      }));
      concurrentMenuId = Number(settledReplay.id);
      expect(Number.isSafeInteger(concurrentMenuId) && concurrentMenuId > 0).toBeTruthy();
      expect(countMenuCode((await apiSuccess<Record<string, unknown>>(
        await page.request.get("/api/admin/platform/menus/overview"))).tree, CONCURRENT_MENU_CODE)).toBe(1);
      evidence.a7 = {
        menuId,
        idempotencyKey,
        replaySameId: true,
        payloadMismatchRejected: mismatchBody.message,
        shortReasonRejected: shortBody.message,
        concurrentSameKeyStatuses: concurrentResponses.map((response) => response.status()),
        concurrentReplayId: concurrentMenuId,
        activeChildBlocksParentDisable: blockedParentDisable.body.message,
        activeChildBlockedByVisibleControls: true,
      };
      await page.screenshot({ path: `${EVIDENCE_DIR}/04-a7-idempotent-create.png`, fullPage: true });
    });

    await test.step("A6 links the real A7 menu and A8 permission, then A2 applies both atomically", async () => {
      const menuOverview = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/menus/overview"));
      const a6MenuId = findMenuId(menuOverview.tree, "A6");
      expect(a6MenuId).toBeGreaterThan(0);
      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await page.getByText(ROLE_CODE, { exact: true }).first().click();
      await expect(page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true })).toBeEnabled();
      await page.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
      const grantCheckbox = page.locator('label[title="platform_a6_read"] input[type="checkbox"]');
      const menuCheckbox = page.getByText(MENU_CODE, { exact: true })
        .locator("xpath=ancestor::div[contains(@class,'row')][1]")
        .locator('input[type="checkbox"]');
      const a6MenuCheckbox = page.getByText("菜单授权（可见性）", { exact: false })
        .locator("xpath=parent::div")
        .getByText("A6", { exact: true })
        .locator("xpath=ancestor::div[contains(@class,'row')][1]")
        .locator('input[type="checkbox"]');
      await expect(grantCheckbox).toBeVisible();
      await expect(menuCheckbox).toBeVisible();
      await expect(a6MenuCheckbox).toBeVisible();
      await grantCheckbox.check();
      await menuCheckbox.check();
      await a6MenuCheckbox.check();
      await page.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();

      const response = await confirmAndCapture(page, `${REASON}提交A6菜单权限联合授权`, (candidate) =>
        candidate.request().method() === "PUT" && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}/grants`));
      const ticket = await expectApiSuccess<Record<string, unknown>>(response, "A6 linked grant proposal");
      const operationId = ticketId(ticket);
      evidence.a6GrantProposal = { operationId, ticket, menuId };

      const beforeApproval = await apiSuccess<Record<string, unknown>>(await page.request.get(`/api/admin/platform/roles/${roleId}`));
      expect(beforeApproval.permissionCodes).toEqual([]);
      expect(beforeApproval.menuIds).toEqual([]);

      await approveThroughA2(checkerPage!, operationId, `${REASON}确认执行A6联合授权`);
      const afterApproval = await apiSuccess<Record<string, unknown>>(await page.request.get(`/api/admin/platform/roles/${roleId}`));
      expect(afterApproval.permissionCodes).toEqual(["platform_a6_read"]);
      expect((afterApproval.menuIds as number[]).sort((a, b) => a - b)).toEqual([a6MenuId, menuId!].sort((a, b) => a - b));

      await navigatePlatform(page, "菜单管理 A7", /\/platform\/menus$/);
      await menuRowByCode(page, MENU_CODE).getByRole("button", { name: "编辑", exact: true }).click();
      const boundDrawer = page.getByRole("dialog").filter({ has: page.getByText(MENU_CODE, { exact: true }) });
      await boundDrawer.locator("select").selectOption("0");
      await boundDrawer.getByRole("button", { name: "保存（需确认）", exact: true }).click();
      const blockedRoleMenuDisable = await confirmRejectedThroughUi(
        page,
        `${REASON}验证角色授权阻止菜单停用`,
        (candidate) => candidate.request().method() === "PATCH"
          && candidate.url().endsWith(`/api/admin/platform/menus/${menuId}`),
        "MENU_NODE_HAS_ROLE_BINDINGS",
        "该菜单仍被角色使用，请先在角色管理中解除菜单授权。",
        `${EVIDENCE_DIR}/04b-a7-visible-role-bound-disable-rejected.png`,
      );
      await page.getByRole("dialog").getByRole("button", { name: "关闭", exact: true }).click();

      await menuRowByCode(page, MENU_CODE).getByRole("button", { name: "删除", exact: true }).click();
      const blockedRoleMenuDelete = await confirmRejectedThroughUi(
        page,
        `${REASON}验证角色授权阻止菜单删除`,
        (candidate) => candidate.request().method() === "DELETE"
          && candidate.url().endsWith(`/api/admin/platform/menus/${menuId}`),
        "MENU_NODE_HAS_ROLE_BINDINGS",
        "该菜单仍被角色使用，请先在角色管理中解除菜单授权。",
        `${EVIDENCE_DIR}/04c-a7-visible-role-bound-delete-rejected.png`,
      );
      const afterBlockedA7Mutations = await apiSuccess<Record<string, unknown>>(
        await page.request.get(`/api/admin/platform/roles/${roleId}`));
      expect(afterBlockedA7Mutations.menuIds).toEqual(afterApproval.menuIds);

      const rejectionLogs = await apiSuccess<Array<Record<string, unknown>>>(await page.request.get(
        `/api/admin/platform/audit/logs?action=A7_MENU_MUTATION_REJECTED&object=${MENU_CODE}&limit=20`));
      const runRejections = rejectionLogs.filter((log) => String(log.detailJson).includes(RUN_TOKEN));
      expect(runRejections).toHaveLength(3);
      expect(runRejections.every((log) => log.result === "REJECTED" && log.riskLevel === "HIGH")).toBe(true);
      expect(runRejections.map((log) => String(log.detailJson))).toEqual(expect.arrayContaining([
        expect.stringContaining(parentDisableIdempotencyKey),
        expect.stringContaining(blockedRoleMenuDisable.idempotencyKey),
        expect.stringContaining(blockedRoleMenuDelete.idempotencyKey),
      ]));
      evidence.a7RelationshipGuards = {
        disable: blockedRoleMenuDisable.body.message,
        delete: blockedRoleMenuDelete.body.message,
        roleMenusUnchanged: true,
        visibleControlEvidence: true,
        rejectedAuditCount: runRejections.length,
      };

      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await page.getByText(ROLE_CODE, { exact: true }).first().click();
      await expect(page.getByText("1 个权限码", { exact: true })).toBeVisible();
      await expect(page.getByText("2 个菜单", { exact: true })).toBeVisible();
      await page.reload();
      await page.getByText(ROLE_CODE, { exact: true }).first().click();
      await expect(page.getByText("1 个权限码", { exact: true })).toBeVisible();
      await expect(page.getByText("2 个菜单", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE_DIR}/02-a6-a7-a8-linked-after-a2.png`, fullPage: true });
    });

    await test.step("the linked custom role survives a real account login and cache-backed authorization", async () => {
      const createLinked = await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `a1-linked-create-${RUN_TOKEN}` },
        data: {
          username: LINKED_USERNAME,
          displayName: `A6A7A8联动账号${RUN_TOKEN}`,
          email: `${LINKED_USERNAME}@example.test`,
          role: ROLE_CODE.toLowerCase(),
          deliver: "handoff",
          initialPassword: LINKED_INITIAL_PASSWORD,
          reason: `${REASON}创建联动角色账号`,
          operator: SUPER_USERNAME,
        },
      });
      const linked = await apiSuccess<Record<string, unknown>>(createLinked);
      linkedAccountId = String(linked.id);
      const linkedIssuedPassword = String(linked.temporaryPassword ?? "");
      expect(linkedAccountId).toMatch(/^\d+$/);
      expect(linkedIssuedPassword).not.toBe("");
      expect(linkedIssuedPassword).not.toBe(LINKED_INITIAL_PASSWORD);

      await page.request.post("/api/admin/auth/logout");
      await loginThroughUi(page, LINKED_USERNAME, linkedIssuedPassword, LINKED_NEW_PASSWORD);
      const linkedSession = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/auth/session"));
      const session = linkedSession.session as Record<string, unknown>;
      expect(session.authorities).toEqual(["platform_a6_read"]);
      expect(session.effectiveMenus).toEqual(expect.arrayContaining(["A6", MENU_CODE]));

      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await expect(page.getByRole("heading", { name: "角色管理" })).toBeVisible();
      await expect(page.getByText("只读", { exact: true })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "目录加载失败" })).toHaveCount(0);
      await expect(page.getByText(MENU_CODE, { exact: true })).toHaveCount(0);
      expect((await page.request.get("/api/admin/platform/roles/overview")).status()).toBe(200);
      expect((await page.request.get("/api/admin/platform/menus/overview")).status()).toBe(403);
      expect((await page.request.get("/api/admin/platform/permissions?pageNum=1&pageSize=20")).status()).toBe(403);
      await page.screenshot({ path: `${EVIDENCE_DIR}/03-linked-role-account.png`, fullPage: true });

      await page.request.post("/api/admin/auth/logout");
      await loginThroughUi(page, SUPER_USERNAME, SUPER_PASSWORD);
      await mutateTemporaryAccount(page, linkedAccountId, "PATCH", "status", {
        status: "disabled",
        reason: `${REASON}停用联动临时账号`,
        operator: SUPER_USERNAME,
      }, `a1-linked-disable-${RUN_TOKEN}`);
      await mutateTemporaryAccount(page, linkedAccountId, "POST", "sessions/revoke", {
        reason: `${REASON}撤销联动临时账号会话`,
        operator: SUPER_USERNAME,
      }, `a1-linked-revoke-${RUN_TOKEN}`);
      evidence.linkedAccount = {
        id: linkedAccountId,
        permission: "platform_a6_read",
        menus: ["A6", MENU_CODE],
        undeployedMenuFilteredByRouteAllowlist: true,
      };
    });

    await test.step("A8 shows mapped truth, handles page overflow and recovers from a real UI failure state", async () => {
      await navigatePlatform(page, "权限字典 A8", /\/platform\/permissions$/);
      await expect(page.getByRole("heading", { name: "权限字典" })).toBeVisible();
      const baseline = await apiSuccess<Record<string, unknown>>(await page.request.get(
        "/api/admin/platform/permissions?pageNum=1&pageSize=20"));
      const permissionTotal = Number(baseline.total);
      expect(permissionTotal).toBeGreaterThan(0);
      await expect(page.getByText(`共 ${permissionTotal} 条`, { exact: true })).toBeVisible();

      await page.getByLabel("权限搜索").fill("platform_a6_read");
      await expect(page.getByText("platform_a6_read", { exact: true })).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE_DIR}/06-a8-search.png`, fullPage: true });

      await page.route("**/api/admin/platform/permissions?**", (route) => route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "PLATFORM_BACKEND_UNAVAILABLE", data: null }),
      }));
      await page.getByLabel("权限搜索").fill("forced_failure");
      const failureAlert = page.getByRole("alert").filter({ hasText: "权限目录加载失败，当前没有可确认的数据。" });
      await expect(failureAlert).toBeVisible();
      await expect(page.getByText("platform_a6_read", { exact: true })).toHaveCount(0);
      await expect(failureAlert.getByRole("button", { name: "重试", exact: true })).toBeVisible();
      await page.screenshot({ path: `${EVIDENCE_DIR}/07-a8-fail-closed.png`, fullPage: true });
      await page.unrouteAll({ behavior: "wait" });
      await failureAlert.getByRole("button", { name: "重试", exact: true }).click();
      await expect(page.getByText("无匹配权限", { exact: true })).toBeVisible();

      const resetResponse = page.waitForResponse((candidate) =>
        candidate.request().method() === "GET"
        && candidate.url().includes("/api/admin/platform/permissions?")
        && !candidate.url().includes("keyword="));
      await page.getByLabel("权限搜索").fill("");
      await resetResponse;
      const unmappedResponse = page.waitForResponse((candidate) =>
        candidate.request().method() === "GET"
        && candidate.url().includes("domain=UNMAPPED"));
      await page.getByRole("button", { name: "未归类", exact: true }).click();
      const unmapped = await expectApiSuccess<Record<string, unknown>>(
        await unmappedResponse,
        "A8 unmapped permissions",
      );
      const unmappedTotal = Number(unmapped.total);
      const unmappedRecords = unmapped.records as Array<Record<string, unknown>>;
      expect(unmappedTotal).toBeGreaterThanOrEqual(0);
      expect(unmappedRecords.every((record) => record.menuCodePath === "未归类")).toBe(true);
      if (unmappedTotal === 0) {
        await expect(page.getByText("无匹配权限", { exact: true })).toBeVisible();
      } else {
        await expect(page.getByText(String(unmappedRecords[0].permissionCode), { exact: true })).toBeVisible();
      }

      const overflow = await apiSuccess<Record<string, unknown>>(await page.request.get(
        "/api/admin/platform/permissions?pageNum=2147483647&pageSize=50"));
      expect(overflow.records).toEqual([]);

      await page.getByRole("button", { name: "全部", exact: true }).first().click();
      await page.getByLabel("权限搜索").fill("platform_a6_read");
      await expect(page.getByText("platform_a6_read", { exact: true })).toBeVisible();
      evidence.a8 = {
        total: permissionTotal,
        unmapped: unmappedTotal,
        unmappedServerTruthMatched: true,
        overflowRecords: 0,
        failureRecovery: true,
      };
    });

    await test.step("a real AUDITOR account can read A6/A7/A8 but receives no mutation controls", async () => {
      const accountOverview = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/accounts/overview"));
      const roles = accountOverview.roles as Array<Record<string, unknown>>;
      const auditRole = roles.find((item) => String(item.key).toLowerCase() === "audit")
        ?? roles.find((item) => String(item.name).includes("审计"));
      expect(auditRole).toBeTruthy();

      const createAccount = await page.request.post("/api/admin/platform/accounts", {
        headers: { "Idempotency-Key": `a1-audit-create-${RUN_TOKEN}` },
        data: {
          username: AUDITOR_USERNAME,
          displayName: `A6A7A8复验审计员${RUN_TOKEN}`,
          email: `${AUDITOR_USERNAME}@example.test`,
          role: String(auditRole!.key),
          deliver: "handoff",
          initialPassword: AUDITOR_INITIAL_PASSWORD,
          reason: `${REASON}创建只读审计账号`,
          operator: SUPER_USERNAME,
        },
      });
      const account = await apiSuccess<Record<string, unknown>>(createAccount);
      accountId = String(account.id);
      const auditorIssuedPassword = String(account.temporaryPassword ?? "");
      expect(accountId).toMatch(/^\d+$/);
      expect(auditorIssuedPassword).not.toBe("");
      expect(auditorIssuedPassword).not.toBe(AUDITOR_INITIAL_PASSWORD);
      evidence.auditorAccountId = accountId;

      await page.request.post("/api/admin/auth/logout");
      await loginThroughUi(page, AUDITOR_USERNAME, auditorIssuedPassword, AUDITOR_NEW_PASSWORD);

      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await expect(page.getByText("只读", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "+ 新建角色", exact: true })).toHaveCount(0);
      await navigatePlatform(page, "菜单管理 A7", /\/platform\/menus$/);
      await expect(page.getByText("只读", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "+ 新建顶级菜单", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "编辑", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "删除", exact: true })).toHaveCount(0);
      await navigatePlatform(page, "权限字典 A8", /\/platform\/permissions$/);
      await expect(page.getByRole("heading", { name: "权限字典" })).toBeVisible();
      await expect(page.getByLabel("权限搜索")).toBeEnabled();

      const readonlyA6 = await page.request.get("/api/admin/platform/roles/overview");
      const readonlyA7 = await page.request.get("/api/admin/platform/menus/overview");
      const readonlyA8 = await page.request.get("/api/admin/platform/permissions?pageNum=1&pageSize=20");
      expect(readonlyA6.status()).toBe(200);
      expect(readonlyA7.status()).toBe(200);
      expect(readonlyA8.status()).toBe(200);
      const forbiddenA6 = await page.request.post("/api/admin/platform/roles", {
        headers: { "Idempotency-Key": `auditor-forbidden-a6-${RUN_TOKEN}` },
        data: { roleCode: `NO${RUN_TOKEN}`, roleName: "不得创建", status: 1, reason: REASON, operator: AUDITOR_USERNAME },
      });
      const forbiddenA7 = await page.request.post("/api/admin/platform/menus", {
        headers: { "Idempotency-Key": `auditor-forbidden-a7-${RUN_TOKEN}` },
        data: { menuCode: `N${RUN_TOKEN}`, menuName: "不得创建", reason: REASON, operator: AUDITOR_USERNAME },
      });
      expect(forbiddenA6.status()).toBe(403);
      expect(forbiddenA7.status()).toBe(403);
      const a8TotalBefore = Number((await apiSuccess<Record<string, unknown>>(readonlyA8)).total);
      const a8WriteStatuses: Record<string, number> = {};
      for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
        const response = await page.request.fetch("/api/admin/platform/permissions", { method, data: {} });
        a8WriteStatuses[method] = response.status();
        expect([403, 404, 405]).toContain(response.status());
      }
      const a8TotalAfter = Number((await apiSuccess<Record<string, unknown>>(
        await page.request.get("/api/admin/platform/permissions?pageNum=1&pageSize=20"))).total);
      expect(a8TotalAfter).toBe(a8TotalBefore);
      evidence.a8WriteMatrix = { statuses: a8WriteStatuses, totalBefore: a8TotalBefore, totalAfter: a8TotalAfter };
      await page.screenshot({ path: `${EVIDENCE_DIR}/08-auditor-readonly.png`, fullPage: true });

      await page.request.post("/api/admin/auth/logout");
      await loginThroughUi(page, SUPER_USERNAME, SUPER_PASSWORD);
      await mutateTemporaryAccount(page, accountId, "PATCH", "status", {
        status: "disabled",
        reason: `${REASON}结束后停用临时审计账号`,
        operator: SUPER_USERNAME,
      }, `a1-audit-disable-${RUN_TOKEN}`);
      await mutateTemporaryAccount(page, accountId, "POST", "sessions/revoke", {
        reason: `${REASON}结束后撤销临时审计会话`,
        operator: SUPER_USERNAME,
      }, `a1-audit-revoke-${RUN_TOKEN}`);
      evidence.auditorReadonly = true;
    });

    await test.step("cleanup removes account credentials and relations before role and menu teardown", async () => {
      const linkedCleanup = await sanitizeTemporaryAccount(page, linkedAccountId!, LINKED_NEW_PASSWORD, "linked");
      const auditorCleanup = await sanitizeTemporaryAccount(page, accountId!, AUDITOR_NEW_PASSWORD, "auditor");
      evidence.accountCleanup = { linked: linkedCleanup, auditor: auditorCleanup };
      linkedAccountId = null;
      accountId = null;

      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await page.getByText(ROLE_CODE, { exact: true }).first().click();
      await page.getByRole("button", { name: "删除角色", exact: true }).click();
      const roleDeleteResponse = await confirmAndCapture(page, `${REASON}提交删除临时角色`, (candidate) =>
        candidate.request().method() === "DELETE" && candidate.url().endsWith(`/api/admin/platform/roles/${roleId}`));
      const roleDeleteTicket = await expectApiSuccess<Record<string, unknown>>(roleDeleteResponse, "A6 delete proposal");
      const roleDeleteOperationId = ticketId(roleDeleteTicket);
      evidence.a6DeleteProposal = { operationId: roleDeleteOperationId, ticket: roleDeleteTicket };
      await approveThroughA2(checkerPage!, roleDeleteOperationId, `${REASON}确认删除临时角色`);
      roleId = null;
      await navigatePlatform(page, "角色管理 A6", /\/platform\/roles$/);
      await page.reload();
      await expect(page.getByText(ROLE_CODE, { exact: true })).toHaveCount(0);

      await navigatePlatform(page, "菜单管理 A7", /\/platform\/menus$/);
      const menuRow = page.getByText(MENU_CODE, { exact: true }).locator("xpath=ancestor::div[contains(@class,'row')][1]");
      await menuRow.getByRole("button", { name: "删除", exact: true }).click();
      const menuDeleteResponse = await confirmAndCapture(page, `${REASON}删除临时菜单`, (candidate) =>
        candidate.request().method() === "DELETE" && candidate.url().endsWith(`/api/admin/platform/menus/${menuId}`));
      await expectApiSuccess(menuDeleteResponse, "A7 delete menu");
      menuId = null;
      await expect(page.getByText(MENU_CODE, { exact: true })).toHaveCount(0);
      const concurrentMenuOverview = await apiSuccess<Record<string, unknown>>(
        await page.request.get("/api/admin/platform/menus/overview"));
      await apiSuccess(await page.request.delete(`/api/admin/platform/menus/${concurrentMenuId}`, {
        headers: { "Idempotency-Key": `cleanup-concurrent-menu-${RUN_TOKEN}` },
        data: {
          expectedVersion: findMenuVersion(concurrentMenuOverview.tree, CONCURRENT_MENU_CODE),
          reason: `${REASON}清理并发幂等临时菜单`,
          operator: SUPER_USERNAME,
        },
      }));
      concurrentMenuId = null;

      await checkerContext?.close();
      checkerContext = null;
      checkerPage = null;
      const checkerCleanup = await sanitizeTemporaryAccount(
        page,
        checkerAccountId!,
        CHECKER_NEW_PASSWORD,
        "checker",
      );
      evidence.checkerCleanup = checkerCleanup;
      checkerAccountId = null;

      await page.reload();
      await expect(page.getByText(MENU_CODE, { exact: true })).toHaveCount(0);
      await expect(page.getByText(CONCURRENT_MENU_CODE, { exact: true })).toHaveCount(0);

      const finalRoles = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/roles/overview"));
      const finalMenus = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/menus/overview"));
      const finalAudit = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/audit/overview"));
      expect((finalRoles.roles as Array<Record<string, unknown>>).some((role) => role.roleCode === ROLE_CODE)).toBe(false);
      expect(countMenuCode(finalMenus.tree, MENU_CODE)).toBe(0);
      expect(countMenuCode(finalMenus.tree, CONCURRENT_MENU_CODE)).toBe(0);
      expect((finalAudit.operationQueue as Array<Record<string, unknown>>)
        .some((ticket) => ticket.status === "pending" && String(ticket.obj).includes(ROLE_CODE))).toBe(false);
      evidence.cleanupVerified = {
        activeRoles: 0,
        activeMenus: 0,
        pendingTickets: 0,
        testAccounts: 3,
        accountState: "disabled/unassigned/tfa=false/sessions=0/login=403",
      };
      await page.screenshot({ path: `${EVIDENCE_DIR}/09-clean-state.png`, fullPage: true });
    });

    expect(pageErrors).toEqual([]);
    evidence.pageErrors = pageErrors;
    evidence.completedAt = new Date().toISOString();
    evidence.status = "passed";
  } finally {
    evidence.pageErrors = pageErrors;
    let cleanupError: unknown;
    try {
      if (evidence.status === "passed") {
        const logout = await page.request.post("/api/admin/auth/logout");
        expect(logout.ok(), `final logout: HTTP ${logout.status()}`).toBeTruthy();
        const afterLogout = await page.request.get("/api/admin/platform/roles/overview");
        expect(afterLogout.status()).toBe(401);
      } else {
        await cleanup(page, {
          roleId,
          menuIds: [childMenuId, menuId, concurrentMenuId].flatMap((id) => id ? [id] : []),
          checkerPage,
          checkerAccount: checkerAccountId
            ? { id: checkerAccountId, password: CHECKER_NEW_PASSWORD, label: "checker" }
            : null,
          accounts: [
            linkedAccountId ? { id: linkedAccountId, password: LINKED_NEW_PASSWORD, label: "linked" } : null,
            accountId ? { id: accountId, password: AUDITOR_NEW_PASSWORD, label: "auditor" } : null,
          ].flatMap((account) => account ? [account] : []),
        });
      }
      evidence.cleanup = "completed";
    } catch (error) {
      cleanupError = error;
      evidence.cleanup = error instanceof Error ? error.message : String(error);
    }
    await checkerContext?.close().catch(() => undefined);
    await writeFile(`${EVIDENCE_DIR}/runtime-evidence.json`, JSON.stringify(evidence, null, 2), "utf8");
    if (cleanupError) throw cleanupError;
  }
});

async function loginThroughUi(page: Page, username: string, password: string, changedPassword?: string) {
  await page.goto("/");
  const platformButton = page.getByRole("button", { name: /平台基础.*A|A.*平台基础/ });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await usernameInput.fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    const responsePromise = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/login"));
    await page.getByRole("button", { name: "继续", exact: true }).click();
    const loginResponse = await responsePromise;
    expect(loginResponse.ok(), `login ${username}: HTTP ${loginResponse.status()}`).toBeTruthy();
  }

  for (let step = 0; step < 20; step++) {
    if (await platformButton.isVisible({ timeout: 1_000 }).catch(() => false)) return;
    if (await page.getByRole("heading", { name: "双因素身份验证" }).isVisible({ timeout: 1_500 }).catch(() => false)) {
      const manualKey = (await page.locator("code").textContent())?.trim();
      if (!manualKey) throw new Error(`MFA_VERIFY_SECRET_NOT_AVAILABLE_FOR_${username}`);
      await page.getByLabel("一次性验证码").fill(totp(manualKey));
      const responsePromise = page.waitForResponse((candidate) =>
        candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/mfa/verify"));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      const verified = await expectApiSuccess<Record<string, unknown>>(await responsePromise, `MFA verify ${username}`);
      const verifiedSession = verified.session as Record<string, unknown>;
      if (verifiedSession.passwordChangeRequired) {
        await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
      } else {
        await expect(platformButton).toBeVisible({ timeout: 20_000 });
      }
      continue;
    }
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible({ timeout: 1_500 }).catch(() => false)) {
      if (!changedPassword) throw new Error(`PASSWORD_CHANGE_REQUIRED_FOR_${username}`);
      await page.getByLabel("新密码", { exact: true }).fill(changedPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(changedPassword);
      const responsePromise = page.waitForResponse((candidate) =>
        candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/password/change"));
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      const passwordChangeResponse = await responsePromise;
      expect(passwordChangeResponse.ok(), `password change ${username}: HTTP ${passwordChangeResponse.status()}`).toBeTruthy();
      await expect(platformButton).toBeVisible({ timeout: 20_000 });
      continue;
    }
    await page.waitForTimeout(250);
  }
  await expect(platformButton).toBeVisible({ timeout: 20_000 });
}

async function navigatePlatform(page: Page, linkName: string, path: RegExp) {
  const sidebar = page.locator("aside");
  const platformButton = sidebar.getByRole("button", { name: /平台基础.*A|A.*平台基础/ });
  const link = sidebar.getByRole("link", { name: linkName, exact: true });
  if (!await link.isVisible().catch(() => false)) {
    await platformButton.click();
    await expect(link).toBeVisible();
  }
  await link.click();
  await expect(page).toHaveURL(path);
}

async function confirmDialog(page: Page, reason: string) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
}

async function confirmAndCapture(page: Page, reason: string, predicate: (response: Response) => boolean) {
  const responsePromise = page.waitForResponse(predicate);
  await confirmDialog(page, reason);
  const response = await responsePromise;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  return response;
}

async function confirmRejectedThroughUi(
  page: Page,
  reason: string,
  predicate: (response: Response) => boolean,
  expectedCode: string,
  expectedChineseMessage: string,
  screenshotPath: string,
) {
  const responsePromise = page.waitForResponse(predicate);
  await confirmDialog(page, reason);
  const response = await responsePromise;
  const body = await response.json() as ApiEnvelope;
  expect(response.status()).toBe(409);
  expect(body.message).toBe(expectedCode);
  const localizedMessage = page.getByRole("alert")
    .filter({ hasText: expectedChineseMessage })
    .first();
  await expect(localizedMessage).toBeVisible();
  const confirmation = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(confirmation.getByLabel(/操作理由/)).toHaveValue(reason);
  await page.evaluate(async () => {
    const finiteAnimations = document.getAnimations().filter((animation) => {
      const iterations = animation.effect?.getTiming().iterations;
      return iterations !== Infinity && animation.playState !== "finished";
    });
    await Promise.allSettled(finiteAnimations.map((animation) => animation.finished));
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  await confirmation.screenshot({ path: screenshotPath.replace(/\.png$/i, "-dialog.png") });
  await localizedMessage.screenshot({ path: screenshotPath.replace(/\.png$/i, "-message.png") });
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).toHaveCount(0);
  return {
    body,
    idempotencyKey: response.request().headers()["idempotency-key"] || "",
  };
}

async function approveThroughA2(page: Page, operationId: string, reason: string) {
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  // The checker can already be on A2 from an earlier approval. A same-route
  // sidebar click does not remount the page, so explicitly refresh server truth.
  await page.reload();
  await expect(page.getByRole("heading", { name: "审计 & 操作确认" })).toBeVisible();
  const row = page.locator("tbody tr").filter({ hasText: operationId });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && candidate.url().endsWith(`/api/admin/platform/audit/operations/${operationId}/approve`));
  await confirmDialog(page, reason);
  await expectApiSuccess(await responsePromise, `A2 approve ${operationId}`);
  await expect(page.getByText(`${operationId} 已执行`, { exact: false })).toBeVisible();
}

async function expectApiSuccess<T = unknown>(response: Response, label: string): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `${label}: HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function apiSuccess<T = unknown>(response: { ok(): boolean; status(): number; json(): Promise<unknown> }): Promise<T> {
  const body = await response.json() as ApiEnvelope<T>;
  expect(response.ok(), `HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
  expect(body.code, JSON.stringify(body)).toBe(0);
  return body.data as T;
}

function ticketId(ticket: Record<string, unknown>) {
  const id = String(ticket.operationId ?? ticket.id ?? "");
  expect(id).toMatch(/^(?:WO|OP)-/);
  return id;
}

function menuRowByCode(page: Page, menuCode: string) {
  return page.getByText(menuCode, { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'row')][1]");
}

function countMenuCode(rawTree: unknown, expected: string): number {
  const nodes = Array.isArray(rawTree) ? rawTree : [];
  let count = 0;
  for (const raw of nodes) {
    const branch = raw as Record<string, unknown>;
    const node = branch.node as Record<string, unknown> | undefined;
    if (node?.menuCode === expected) count++;
    count += countMenuCode(branch.children, expected);
  }
  return count;
}

function findMenuId(rawTree: unknown, expected: string): number {
  const nodes = Array.isArray(rawTree) ? rawTree : [];
  for (const raw of nodes) {
    const branch = raw as Record<string, unknown>;
    const node = branch.node as Record<string, unknown> | undefined;
    if (node?.menuCode === expected) return Number(node.id);
    const nested = findMenuId(branch.children, expected);
    if (nested > 0) return nested;
  }
  return 0;
}

function findMenuStatus(rawTree: unknown, expected: string): number | null {
  const nodes = Array.isArray(rawTree) ? rawTree : [];
  for (const raw of nodes) {
    const branch = raw as Record<string, unknown>;
    const node = branch.node as Record<string, unknown> | undefined;
    if (node?.menuCode === expected) return Number(node.status);
    const nested = findMenuStatus(branch.children, expected);
    if (nested !== null) return nested;
  }
  return null;
}

function findMenuVersion(rawTree: unknown, expectedCode: string): string {
  const node = findMenuNode(rawTree, (candidate) => candidate.menuCode === expectedCode);
  const version = String(node?.version ?? "");
  expect(version, `menu ${expectedCode} must expose a CAS version`).not.toBe("");
  return version;
}

function findMenuVersionById(rawTree: unknown, expectedId: number): string | null {
  const node = findMenuNode(rawTree, (candidate) => Number(candidate.id) === expectedId);
  if (!node) return null;
  const version = String(node.version ?? "");
  expect(version, `menu ${expectedId} must expose a CAS version`).not.toBe("");
  return version;
}

function findMenuNode(
  rawTree: unknown,
  predicate: (node: Record<string, unknown>) => boolean,
): Record<string, unknown> | null {
  const nodes = Array.isArray(rawTree) ? rawTree : [];
  for (const raw of nodes) {
    const branch = raw as Record<string, unknown>;
    const node = branch.node as Record<string, unknown> | undefined;
    if (node && predicate(node)) return node;
    const nested = findMenuNode(branch.children, predicate);
    if (nested) return nested;
  }
  return null;
}

async function getTemporaryAccount(page: Page, accountId: string) {
  const overview = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"));
  const account = (overview.operators as Array<Record<string, unknown>>)
    .find((operator) => String(operator.id) === accountId);
  expect(account, `temporary account ${accountId} must exist`).toBeTruthy();
  return account!;
}

async function mutateTemporaryAccount(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
  idempotencyKey: string,
) {
  const current = await getTemporaryAccount(page, accountId);
  const expectedVersion = String(current.version ?? "");
  expect(expectedVersion, `account ${accountId} must expose a CAS version`).not.toBe("");
  return apiSuccess(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...data, expectedVersion },
  }));
}

async function sanitizeTemporaryAccount(
  page: Page,
  accountId: string,
  currentPassword: string | null,
  label: string,
) {
  const beforeOverview = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"));
  const before = (beforeOverview.operators as Array<Record<string, unknown>>)
    .find((operator) => String(operator.id) === accountId);
  expect(before, `temporary account ${accountId} must exist for auditable cleanup`).toBeTruthy();

  if (before!.tfa === true) {
    await mutateTemporaryAccount(page, accountId, "POST", "reset-2fa", {
      reason: `${REASON}清除临时账号双因素密钥`,
      operator: SUPER_USERNAME,
    }, `a1-clean-${label}-mfa-${RUN_TOKEN}`);
  }
  let current = await getTemporaryAccount(page, accountId);
  if (current.role !== "unassigned") {
    await mutateTemporaryAccount(page, accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${REASON}解除临时账号角色关系`,
      operator: SUPER_USERNAME,
    }, `a1-clean-${label}-role-${RUN_TOKEN}`);
  }
  current = await getTemporaryAccount(page, accountId);
  if (current.status !== "disabled") {
    await mutateTemporaryAccount(page, accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${REASON}停用临时验收账号`,
      operator: SUPER_USERNAME,
    }, `a1-clean-${label}-status-${RUN_TOKEN}`);
  }
  current = await getTemporaryAccount(page, accountId);
  if (Number(current.sessions) > 0) {
    await mutateTemporaryAccount(page, accountId, "POST", "sessions/revoke", {
      reason: `${REASON}撤销临时账号全部会话`,
      operator: SUPER_USERNAME,
    }, `a1-clean-${label}-sessions-${RUN_TOKEN}`);
  }

  const afterOverview = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/accounts/overview"));
  const after = (afterOverview.operators as Array<Record<string, unknown>>)
    .find((operator) => String(operator.id) === accountId);
  expect(after).toMatchObject({ role: "unassigned", tfa: false, status: "disabled", sessions: 0 });
  let loginStatus: number | "not-replayed" = "not-replayed";
  if (currentPassword) {
    const disabledLogin = await page.request.post("/api/admin/auth/login", {
      data: { username: String(after!.username), password: currentPassword },
    });
    const disabledBody = await disabledLogin.json() as ApiEnvelope;
    expect([401, 403]).toContain(disabledLogin.status());
    expect(["ADMIN_CREDENTIAL_INVALID", "ADMIN_DISABLED"]).toContain(disabledBody.message);
    loginStatus = disabledLogin.status();
  }
  return {
    id: accountId,
    role: after!.role,
    tfa: after!.tfa,
    status: after!.status,
    sessions: after!.sessions,
    loginStatus,
  };
}

async function recoverStaleRole(page: Page, checkerPage: Page, roleCode: string) {
  const before = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/roles/overview"));
  const stale = (before.roles as Array<Record<string, unknown>>)
    .find((role) => String(role.roleCode) === roleCode);
  if (!stale) return { roleCode, existed: false, recovered: true };

  const audit = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/audit/overview"));
  const pending = (audit.operationQueue as Array<Record<string, unknown>>)
    .filter((ticket) => ticket.status === "pending" && String(ticket.obj) === roleCode);
  if (pending.length === 0) {
    const response = await page.request.delete(`/api/admin/platform/roles/${stale.id}`, {
      headers: { "Idempotency-Key": `stale-role-delete-${roleCode}-${RUN_TOKEN}` },
      data: { reason: `${REASON}清理上轮中断角色${roleCode}`, operator: SUPER_USERNAME },
    });
    pending.push(await apiSuccess<Record<string, unknown>>(response));
  }
  for (const ticket of pending) {
    const operationId = ticketId(ticket);
    await apiSuccess(await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${operationId}/approve`,
      {
        headers: { "Idempotency-Key": `stale-role-approve-${operationId}-${RUN_TOKEN}` },
        data: { reason: `${REASON}独立复核清理上轮中断角色${roleCode}` },
      },
    ));
  }
  const after = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/roles/overview"));
  expect((after.roles as Array<Record<string, unknown>>)
    .some((role) => String(role.roleCode) === roleCode)).toBe(false);
  return { roleCode, existed: true, pendingTickets: pending.map(ticketId), recovered: true };
}

async function recoverStaleMenus(page: Page, menuCodes: string[]) {
  const results: Array<Record<string, unknown>> = [];
  // Acceptance interruptions can leave a parent/child pair. Delete the supplied
  // codes in reverse creation order so children are removed before parents.
  for (const menuCode of [...menuCodes].reverse()) {
    const overview = await apiSuccess<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/menus/overview"));
    const node = findMenuNode(overview.tree, (candidate) => candidate.menuCode === menuCode);
    if (!node) {
      results.push({ menuCode, existed: false, recovered: true });
      continue;
    }
    const menuId = Number(node.id);
    await apiSuccess(await page.request.delete(`/api/admin/platform/menus/${menuId}`, {
      headers: { "Idempotency-Key": `stale-menu-delete-${menuId}-${RUN_TOKEN}` },
      data: {
        expectedVersion: String(node.version),
        reason: `${REASON}清理上轮中断菜单${menuCode}`,
        operator: SUPER_USERNAME,
      },
    }));
    const after = await apiSuccess<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/menus/overview"));
    expect(countMenuCode(after.tree, menuCode)).toBe(0);
    results.push({ menuCode, id: menuId, existed: true, recovered: true });
  }
  return results;
}

async function recoverStaleAccounts(page: Page, accountIds: string[]) {
  const results: Array<Record<string, unknown>> = [];
  for (const accountId of accountIds) {
    const overview = await apiSuccess<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/accounts/overview"));
    const account = (overview.operators as Array<Record<string, unknown>>)
      .find((operator) => String(operator.id) === accountId);
    if (!account) {
      results.push({ accountId, existed: false, recovered: true });
      continue;
    }
    const cleanupResult = await sanitizeTemporaryAccount(page, accountId, null, `stale-${accountId}`);
    results.push({ accountId, username: account.username, existed: true, recovered: true, cleanupResult });
  }
  return results;
}

async function cleanup(page: Page, ids: {
  roleId: number | null;
  menuIds: number[];
  checkerPage: Page | null;
  checkerAccount: { id: string; password: string; label: string } | null;
  accounts: Array<{ id: string; password: string; label: string }>;
}) {
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.request.post("/api/admin/auth/logout").catch(() => null);
  const login = await page.request.post("/api/admin/auth/login", {
    data: { username: SUPER_USERNAME, password: SUPER_PASSWORD },
  });
  const loginData = await apiSuccess<Record<string, unknown>>(login);
  expect(loginData.session).toBeTruthy();

  try {

  // Recover IDs from the authoritative tree as well: a request can commit before
  // the test receives/assigns its response, which must not leave acceptance data behind.
  const cleanupMenuOverview = await apiSuccess<Record<string, unknown>>(
    await page.request.get("/api/admin/platform/menus/overview"));
  const menuIds = new Set(ids.menuIds);
  for (const menuCode of [CHILD_MENU_CODE, MENU_CODE, CONCURRENT_MENU_CODE]) {
    const discoveredId = findMenuId(cleanupMenuOverview.tree, menuCode);
    if (discoveredId > 0) menuIds.add(discoveredId);
  }

  for (const account of ids.accounts) {
    await sanitizeTemporaryAccount(page, account.id, account.password, account.label);
  }

  if (ids.roleId) {
    const audit = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/audit/overview"));
    const pending = (audit.operationQueue as Array<Record<string, unknown>>)
      .filter((ticket) => ticket.status === "pending" && String(ticket.obj).includes(ROLE_CODE));
    for (const ticket of pending) {
      await apiSuccess(await (ids.checkerPage ?? page).request.post(`/api/admin/platform/audit/operations/${ticket.id}/reject`, {
        headers: { "Idempotency-Key": `cleanup-reject-${ticket.id}-${RUN_TOKEN}` },
        data: { reason: `${REASON}异常清理前取消未完成工单` },
      }));
    }
    const response = await page.request.delete(`/api/admin/platform/roles/${ids.roleId}`, {
      headers: { "Idempotency-Key": `cleanup-role-${RUN_TOKEN}` },
      data: { reason: `${REASON}异常清理临时角色`, operator: SUPER_USERNAME },
    });
    const deleteTicket = await apiSuccess<Record<string, unknown>>(response);
    const operationId = ticketId(deleteTicket);
    await apiSuccess(await (ids.checkerPage ?? page).request.post(`/api/admin/platform/audit/operations/${operationId}/approve`, {
      headers: { "Idempotency-Key": `cleanup-role-approve-${RUN_TOKEN}` },
      data: { reason: `${REASON}确认异常清理临时角色` },
    }));
  }
  for (const menuId of menuIds) {
    const currentMenus = await apiSuccess<Record<string, unknown>>(
      await page.request.get("/api/admin/platform/menus/overview"));
    const expectedVersion = findMenuVersionById(currentMenus.tree, menuId);
    if (!expectedVersion) continue;
    await apiSuccess(await page.request.delete(`/api/admin/platform/menus/${menuId}`, {
      headers: { "Idempotency-Key": `cleanup-menu-${menuId}-${RUN_TOKEN}` },
      data: {
        expectedVersion,
        reason: `${REASON}异常清理临时菜单`,
        operator: SUPER_USERNAME,
      },
    }));
  }
  if (ids.checkerAccount) {
    await sanitizeTemporaryAccount(
      page,
      ids.checkerAccount.id,
      ids.checkerAccount.password,
      ids.checkerAccount.label,
    );
  }
  const finalRoles = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/roles/overview"));
  const finalMenus = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/menus/overview"));
  const finalAudit = await apiSuccess<Record<string, unknown>>(await page.request.get("/api/admin/platform/audit/overview"));
  expect((finalRoles.roles as Array<Record<string, unknown>>).some((role) => role.roleCode === ROLE_CODE)).toBe(false);
  expect(countMenuCode(finalMenus.tree, MENU_CODE)).toBe(0);
  expect(countMenuCode(finalMenus.tree, CONCURRENT_MENU_CODE)).toBe(0);
  expect((finalAudit.operationQueue as Array<Record<string, unknown>>)
    .some((ticket) => ticket.status === "pending" && String(ticket.obj).includes(ROLE_CODE))).toBe(false);
  } finally {
    const logout = await page.request.post("/api/admin/auth/logout");
    expect(logout.ok(), `cleanup logout: HTTP ${logout.status()}`).toBeTruthy();
    const afterLogout = await page.request.get("/api/admin/platform/roles/overview");
    expect(afterLogout.status()).toBe(401);
  }
}

function assertLocalTarget() {
  const target = new URL(process.env.ADMIN_BASE_URL || "http://127.0.0.1:3002");
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) {
    throw new Error(`A6/A7/A8 live acceptance mutates data and only permits local targets: ${target.origin}`);
  }
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED_FOR_LOCAL_ACCEPTANCE`);
  return value;
}

function temporaryPassword(prefix: string) {
  return `${prefix}!9Aa${randomBytes(18).toString("base64url")}`;
}

function totp(secret: string) {
  const counter = Math.floor(Date.now() / 30_000);
  const counterBytes = Buffer.alloc(8);
  counterBytes.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counterBytes).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, "0");
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
