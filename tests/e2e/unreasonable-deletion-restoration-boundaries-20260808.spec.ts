import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const MYSQL = process.env.NEXION_MYSQL_BIN ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const REDIS = process.env.NEXION_REDIS_CLI ?? "D:/software/Redis-8.6.1/redis-cli.exe";
const DB_PASSWORD = process.env.RESTORE_MYSQL_PASSWORD ?? "";
const REDIS_PASSWORD = process.env.RESTORE_REDIS_PASSWORD ?? "";
const ADMIN_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const RUN_TOKEN = (process.env.RESTORE_ACCEPTANCE_RUN_ID ?? `restore${Date.now()}`).replace(/[^a-zA-Z0-9]/g, "").slice(-12).toLowerCase();
const MARKER = `RESTORE-C3-${RUN_TOKEN}`;
const C3_USERNAME = "superadmin";
const EVIDENCE_DIR = process.env.RESTORE_BOUNDARY_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/unreasonable-deletion-restoration-20260808/${RUN_TOKEN}-boundaries`;
const usedTotpStep = new Map<string, number>();
const enrollmentSecrets = new Map<string, string>();

type Actor = {
  alias: "B2" | "B3" | "B4" | "B5" | "F5";
  username: string;
  roleCode: string;
  adminId: number;
  roleId: number;
  permission: string;
  extraPermissions?: readonly string[];
  parentMenu: "B" | "F";
  menu: string;
  path: string;
  endpoint: string;
  marker: string;
};

type ActorDefinition = Pick<Actor, "alias" | "permission" | "extraPermissions" | "parentMenu" | "menu" | "path" | "endpoint" | "marker">;

const DEFINITIONS: readonly ActorDefinition[] = [
  { alias: "B2", permission: "overview_b2_read", parentMenu: "B", menu: "B2", path: "/overview/liquidity", endpoint: "/api/admin/treasury/liquidity-history", marker: "b2-fund-flow-history" },
  { alias: "B3", permission: "overview_b3_read", parentMenu: "B", menu: "B3", path: "/overview/funnel", endpoint: "/api/admin/funnel", marker: "b5-daily-first-purchase-conversion" },
  { alias: "B4", permission: "overview_b4_read", parentMenu: "B", menu: "B4", path: "/overview/rhythm", endpoint: "/api/admin/treasury/growth-flow-history", marker: "b3-growth-outflow-ratio" },
  { alias: "B5", permission: "overview_b5_read", extraPermissions: ["overview_b5_triage"], parentMenu: "B", menu: "B5", path: "/overview/risk-radar", endpoint: "/api/admin/risk/radar", marker: "b1-withdraw-pressure-trend" },
  { alias: "F5", permission: "network_f5_read", parentMenu: "F", menu: "F5", path: "/network/commissions", endpoint: "/api/admin/teams/commissions", marker: "f5-commission-kind-card" },
];

const evidence: Record<string, unknown> = {
  runToken: RUN_TOKEN,
  startedAt: new Date().toISOString(),
  buildIdentity: {
    frontendBuildId: process.env.RESTORE_FRONTEND_BUILD_ID ?? "not-provided",
    backendArtifactSha256: process.env.RESTORE_BACKEND_BUILD_SHA256 ?? "not-provided",
  },
  sourceHashes: Object.fromEntries([
    "app/components/dashboard/restored-b-insights.tsx",
    "app/_console/overview/b-page-header.tsx",
    "app/_console/overview/liquidity/page.tsx",
    "app/_console/overview/funnel/page.tsx",
    "app/_console/overview/rhythm/page.tsx",
    "app/_console/overview/risk-radar/page.tsx",
    "lib/admin/b5-pressure-summary.ts",
    "lib/admin/b5-client.ts",
    "lib/admin/b5-radar-contract.ts",
    "lib/admin/b34-overview-contract.ts",
    "lib/admin/b-restoration-contract.ts",
    "lib/admin/c3-adjustment-contract.ts",
    "lib/admin/cross-domain-authority.ts",
    "lib/admin/strict-number.ts",
    "lib/admin/time-series-contract.ts",
    "lib/admin/user360-client.ts",
    "lib/admin/authoritative-page-contract.ts",
    "lib/admin/f-overview-contract.ts",
    "app/components/domain-views/f-tabs/f5-audit.tsx",
    "app/components/domain-views/c-tabs/c3-adjust.tsx",
    "../nexion-backend/target/classes/ffdd/opsconsole/team/application/F5CommissionService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/team/mapper/F5CommissionMapper.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/application/OpsTreasuryService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/bi/application/OpsFunnelService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/application/OpsRiskRadarService.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/mapper/B5RiskRadarMapper.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/risk/web/OpsRiskRadarController.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/facade/TreasuryCoverageSnapshot.class",
    "../nexion-backend/target/classes/ffdd/opsconsole/treasury/application/TreasuryCoverageFacadeAdapter.class",
  ].map((path) => [path, createHash("sha256").update(readFileSync(join(process.cwd(), path))).digest("hex")])),
  c3PageShrink: {},
  minimalRoles: [] as unknown[],
};
let actors: Actor[] = [];

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  if (!DB_PASSWORD || !REDIS_PASSWORD || !ADMIN_PASSWORD) {
    throw new Error("RESTORE_MYSQL_PASSWORD, RESTORE_REDIS_PASSWORD and ADMIN_E2E_PASSWORD are required");
  }
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  cleanupFixtures();
  setupC3Fixtures();
  actors = DEFINITIONS.map(createActor);
});

test.afterAll(() => {
  try {
    cleanupFixtures();
    evidence.cleanupVerified = fixtureCount() === 0;
  } finally {
    evidence.completedAt = new Date().toISOString();
    writeFileSync(join(EVIDENCE_DIR, "boundaries.json"), JSON.stringify(evidence, null, 2), "utf8");
  }
});

test("C3 从真实第 2 页收缩到第 1 页并重新读取", async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, C3_USERNAME);
  await page.goto("/users/assets", { waitUntil: "domcontentloaded" });
  const pager = page.locator('[data-list-label="待放行调整队列"]');
  await expect(pager).toContainText("筛选后 6 条");
  await expect(pager).toContainText("第 1 / 2 页");

  const pageTwoResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/users/asset-adjustments"
      && url.searchParams.get("status") === "PENDING_REVIEW"
      && url.searchParams.get("pageNum") === "2";
  });
  await page.getByLabel("待放行调整队列 下一页").click();
  expect((await pageTwoResponse).status()).toBe(200);
  await expect(pager).toContainText("第 2 / 2 页");
  await pager.screenshot({ path: join(EVIDENCE_DIR, "01-c3-real-page-2.png") });

  deleteC3Fixtures();
  const shrinkingResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/users/asset-adjustments"
      && url.searchParams.get("status") === "PENDING_REVIEW"
      && url.searchParams.get("pageNum") === "2";
  });
  const correctedResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === "GET"
      && url.pathname === "/api/admin/users/asset-adjustments"
      && url.searchParams.get("status") === "PENDING_REVIEW"
      && url.searchParams.get("pageNum") === "1";
  });
  await page.getByLabel("刷新待放行调整队列").click();
  expect((await shrinkingResponse).status()).toBe(200);
  expect((await correctedResponse).status()).toBe(200);
  await expect(pager).toContainText("筛选后 0 条");
  await expect(pager).toContainText("第 1 / 1 页");
  await pager.screenshot({ path: join(EVIDENCE_DIR, "02-c3-shrunk-page-1.png") });
  evidence.c3PageShrink = { initialTotal: 6, visitedPage: 2, reducedTotal: 0, correctedPage: 1, followupRead: true };
});

test("B2-B5 与 F5 最小权限角色只看自己的恢复区，其他接口返回 403", async ({ browser }) => {
  test.setTimeout(240_000);
  const results: unknown[] = [];
  for (const actor of actors) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, actor.username);
    const session = await currentSession(page);
    const expectedAuthorities = [actor.permission, ...(actor.extraPermissions ?? [])].sort();
    expect([...session.authorities].sort()).toEqual(expectedAuthorities);
    expect(new Set(session.menus)).toEqual(new Set([actor.parentMenu, actor.menu]));

    expect((await page.request.get(actor.endpoint)).status(), `${actor.alias} own endpoint`).toBe(200);
    const otherStatuses: Record<string, number> = {};
    for (const other of actors.filter((candidate) => candidate.alias !== actor.alias)) {
      const status = (await page.request.get(other.endpoint)).status();
      expect(status, `${actor.alias} must not read ${other.alias}`).toBe(403);
      otherStatuses[other.alias] = status;
    }

    const b5Injection = actor.alias === "B5" ? await injectB5AlertTargets(page) : null;
    await page.goto(actor.path, { waitUntil: "domcontentloaded" });
    const ownMarker = page.getByTestId(actor.marker).first();
    await expect(ownMarker).toBeVisible();
    if (actor.alias === "F5") {
      for (const href of ["/finance/ledger", "/overview/dual-ledger", "/analytics/operations", "/platform/audit", "/platform/events"]) {
        await expect(page.locator(`a[href^="${href}"]`), `F5-only must not expose ${href}`).toHaveCount(0);
      }
      await expect(page.getByText(/D4 账本无权限/)).toBeVisible();
      await expect(page.getByText(/B1 覆盖率 无权限/)).toBeVisible();
      await expect(page.getByText(/L4 运营分析 无权限/)).toBeVisible();
      await expect(page.getByText(/A2 审批审计 无权限/)).toBeVisible();
      await expect(page.getByText(/A4 事件中心 无权限/)).toBeVisible();
    }
    const forbiddenCrossLinks: Partial<Record<Actor["alias"], string[]>> = {
      B2: ["/overview/dual-ledger", "/finance/pool", "/overview/risk-radar"],
      B3: ["/analytics/funnel-cohort", "/growth/phase", "/platform/events"],
      B4: ["/growth/phase", "/overview/funnel", "/overview/dual-ledger", "/overview/liquidity"],
      B5: ["/emergency/kill-switch", "/finance/withdrawals", "/risk/multi-account", "/risk/abuse", "/emergency/tamper", "/risk/scoring", "/overview/dual-ledger"],
    };
    for (const href of forbiddenCrossLinks[actor.alias] ?? []) {
      await expect(page.locator(`a[href="${href}"]`), `${actor.alias}-only must not expose ${href}`).toHaveCount(0);
    }
    if (actor.alias === "B3") {
      const stageCount = await page.getByTestId("b3-stage").count();
      if (stageCount) {
        await expect(page.getByText("四级同用户漏斗")).toBeVisible();
        await expect(page.getByTestId("b3-stage")).toHaveCount(4);
      } else {
        await expect(page.locator("section.b3-unavailable")).toContainText("当前筛选范围没有可确认的注册用户");
      }
    }
    if (actor.alias === "B5") {
      await expect.poll(() => b5Injection!.hitCount(), { message: "B5 alert fixture must reach the browser response" }).toBeGreaterThan(0);
      await expect(page.getByRole("button", { name: /处置|核验/ })).toHaveCount(0);
      await expect(page.getByText("目标域无权限")).toHaveCount(5);
      const directTriage = await page.request.post("/api/admin/risk/radar/triage", {
        headers: { "Idempotency-Key": `boundary-b5-${RUN_TOKEN}` },
        data: { dimension: "bankrun", target: "/finance/withdrawals", operator: actor.username },
      });
      expect(directTriage.status(), "B5 triage authority alone must not write a target-domain jump audit").toBe(403);
    }
    await expandDomainMenu(page, actor.parentMenu);
    const primaryNavigation = page.getByRole("complementary").getByRole("navigation");
    await expect(primaryNavigation.locator(`a[href="${actor.path}"]`)).toBeVisible();
    for (const other of actors.filter((candidate) => candidate.alias !== actor.alias)) {
      await expect(primaryNavigation.locator(`a[href="${other.path}"]`)).toHaveCount(0);
    }
    await ownMarker.screenshot({ path: join(EVIDENCE_DIR, `03-${actor.alias.toLowerCase()}-minimal-permission.png`) });
    results.push({ alias: actor.alias, authorities: session.authorities, menus: session.menus, ownStatus: 200, otherStatuses, ownMarkerVisible: true });
    await page.request.post("/api/admin/auth/logout");
    await context.close();
  }
  evidence.minimalRoles = results;
});

test("B5 分诊角色只有在同时获得目标域 read 后才出现正向入口", async ({ browser }) => {
  test.setTimeout(120_000);
  const actor = actors.find((candidate) => candidate.alias === "B5")!;
  const targetPermissions = [
    "emergency_j1_read", "finance_d2_read", "risk_k1_read", "risk_k2_read",
    "emergency_j3_read", "risk_k4_read", "overview_b1_read",
  ];
  mysql(
    "INSERT INTO nx_admin_role_permission(role_id,permission_id,created_at,updated_at,is_deleted) "
      + `SELECT ${actor.roleId},id,NOW(),NOW(),0 FROM nx_admin_permission WHERE permission_code IN (${targetPermissions.map((value) => `'${sql(value)}'`).join(",")}) AND is_deleted=0;`,
  );
  clearPermissionCache(actor.adminId);
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, actor.username);
  const b5Injection = await injectB5AlertTargets(page);
  await page.goto(actor.path, { waitUntil: "domcontentloaded" });
  await expect.poll(() => b5Injection.hitCount(), { message: "B5 positive alert fixture must reach the browser response" }).toBeGreaterThan(0);
  await expect(page.locator('a[href="/emergency/kill-switch"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /处置|核验/ })).toHaveCount(5);
  await expect(page.getByTestId("b5-recent-alert-feed").locator("a")).toHaveCount(5);
  await page.getByTestId("b5-recent-alert-feed").screenshot({ path: join(EVIDENCE_DIR, "06-b5-target-authorities-positive.png") });
  evidence.b5TargetAuthorityGate = { withoutTargetRead: 0, withTargetRead: 5, alertLinks: 5 };
  await page.request.post("/api/admin/auth/logout");
  await context.close();
});

test("权限撤销立即 403，恢复并重登后 B2 能力重新出现", async ({ browser }) => {
  test.setTimeout(120_000);
  const actor = actors.find((candidate) => candidate.alias === "B2")!;
  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await login(firstPage, actor.username);
  expect((await firstPage.request.get(actor.endpoint)).status()).toBe(200);

  mysql(`UPDATE nx_admin_role_permission SET is_deleted=1,updated_at=NOW() WHERE role_id=${actor.roleId};`);
  clearPermissionCache(actor.adminId);
  expect((await firstPage.request.get(actor.endpoint)).status(), "撤权后当前会话不得继续读 B2").toBe(403);
  await firstPage.request.post("/api/admin/auth/logout");
  await first.close();

  mysql(`UPDATE nx_admin_role_permission SET is_deleted=0,updated_at=NOW() WHERE role_id=${actor.roleId};`);
  clearPermissionCache(actor.adminId);
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await login(secondPage, actor.username);
  expect((await secondPage.request.get(actor.endpoint)).status(), "恢复权限并重登后 B2 应恢复").toBe(200);
  await secondPage.goto(actor.path, { waitUntil: "domcontentloaded" });
  await expect(secondPage.getByTestId(actor.marker)).toBeVisible();
  await secondPage.getByTestId(actor.marker).screenshot({ path: join(EVIDENCE_DIR, "07-b2-permission-restored-after-relogin.png") });
  await secondPage.request.post("/api/admin/auth/logout");
  await second.close();
  evidence.permissionRefresh = { alias: "B2", before: 200, revokedSameSession: 403, restoredAfterRelogin: 200 };
});

async function injectB5AlertTargets(page: Page) {
  let hits = 0;
  // The live SSE sends the authoritative empty snapshot immediately after the
  // initial GET. Block it in this fixture-only boundary test so it cannot race
  // the injected alert rows and turn the permission assertion into a false
  // negative. Production behavior is exercised unmodified by the main run.
  await page.route("**/api/admin/risk/radar/stream", (route) => route.abort("blockedbyclient"));
  await page.route("**/api/admin/risk/radar", async (route) => {
    const response = await route.fetch();
    const payload = await response.json();
    const targets = [
      "/finance/withdrawals", "/risk/multi-account", "/risk/abuse", "/emergency/tamper", "/risk/scoring",
    ];
    payload.data.recentAlerts = targets.map((target, index) => ({
      signalNo: `BOUNDARY-${index + 1}`,
      level: ["P0", "P1", "P2", "P3", "P1"][index],
      message: `目标权限边界 ${index + 1}`,
      userId: index + 1,
      createdAt: `2026-08-08T12:00:0${index}`,
      target,
      handlingStatusAvailable: false,
    }));
    hits += 1;
    await route.fulfill({ response, json: payload });
  });
  return { hitCount: () => hits };
}

function setupC3Fixtures() {
  const existing = Number(mysql("SELECT COUNT(*) FROM nx_wallet_asset_adjustment WHERE status='PENDING_REVIEW' AND is_deleted=0;"));
  if (existing !== 0) throw new Error(`C3 deterministic boundary requires an empty pending queue, found ${existing}`);
  const userId = Number(mysql("SELECT id FROM nx_user WHERE is_deleted=0 ORDER BY id LIMIT 1;"));
  if (!Number.isSafeInteger(userId) || userId <= 0) throw new Error("C3 fixture requires one user");
  const values = Array.from({ length: 6 }, (_, index) => {
    const no = `${MARKER}-${index + 1}`;
    return `('${sql(no)}',${userId},'USDT','CREDIT',${index + 1},${index + 1},'SUPPORT_COMPENSATION','${sql(MARKER)} pagination fixture','${sql(MARKER)}-E${index + 1}','${sql(MARKER)}-K${index + 1}',NULL,'${sql(MARKER)}',NULL,'PENDING_REVIEW',NULL,NULL,NULL,NOW(),NOW(),0)`;
  });
  mysql("INSERT INTO nx_wallet_asset_adjustment(adjustment_no,user_id,asset,direction,amount,amount_usd,reason_code,reason,evidence_ref,idempotency_key,reversal_of,maker,checker,status,ledger_id,review_reason,reviewed_at,created_at,updated_at,is_deleted) VALUES " + values.join(",") + ";");
  expect(Number(mysql(`SELECT COUNT(*) FROM nx_wallet_asset_adjustment WHERE maker='${sql(MARKER)}' AND is_deleted=0;`))).toBe(6);
}

function createActor(definition: typeof DEFINITIONS[number]): Actor {
  const roleCode = `RESTORE_${definition.alias}_${RUN_TOKEN}`.toUpperCase();
  const username = `restore.${definition.alias.toLowerCase()}.${RUN_TOKEN}`;
  mysql(
    "INSERT INTO nx_admin_role(role_code,role_name,remark,status,created_at,updated_at,is_deleted) "
      + `VALUES('${sql(roleCode)}','${sql(roleCode)}','isolated restore acceptance',1,NOW(),NOW(),0); SET @role_id=LAST_INSERT_ID(); `
      + "INSERT INTO nx_admin_role_menu(role_id,menu_id,created_at,updated_at,is_deleted) "
      + `SELECT @role_id,id,NOW(),NOW(),0 FROM nx_admin_menu WHERE menu_code IN ('${sql(definition.parentMenu)}','${sql(definition.menu)}') AND is_deleted=0; `
      + "INSERT INTO nx_admin_role_permission(role_id,permission_id,created_at,updated_at,is_deleted) "
      + `SELECT @role_id,id,NOW(),NOW(),0 FROM nx_admin_permission WHERE permission_code IN (${[definition.permission, ...(definition.extraPermissions ?? [])].map((value) => `'${sql(value)}'`).join(",")}) AND is_deleted=0; `
      + "INSERT INTO nx_admin(username,password_hash,nickname,email,phone,super_admin,status,version,created_at,updated_at,is_deleted) "
      + `SELECT '${sql(username)}',password_hash,'${sql(definition.alias)} minimal restore',NULL,NULL,0,1,0,NOW(),NOW(),0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1; SET @admin_id=LAST_INSERT_ID(); `
      + "INSERT INTO nx_admin_account_state(admin_id,tfa_required,tfa_secret_encrypted,tfa_bound_at,last_login_at,tfa_reset_at,sessions_revoked_at,credential_delivery_status,created_at,updated_at,is_deleted) "
      + "VALUES(@admin_id,1,NULL,NULL,NULL,NULL,NULL,'ACTIVE',NOW(),NOW(),0); "
      + "INSERT INTO nx_admin_role_relation(admin_id,role_id,created_at,updated_at,is_deleted) VALUES(@admin_id,@role_id,NOW(),NOW(),0);",
  );
  const row = mysql(`SELECT a.id,r.id FROM nx_admin a JOIN nx_admin_role_relation rr ON rr.admin_id=a.id AND rr.is_deleted=0 JOIN nx_admin_role r ON r.id=rr.role_id AND r.is_deleted=0 WHERE a.username='${sql(username)}' AND r.role_code='${sql(roleCode)}';`).split("\t").map(Number);
  if (row.length !== 2 || row.some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error(`actor ${definition.alias} setup failed`);
  expect(Number(mysql(`SELECT COUNT(*) FROM nx_admin_role_permission WHERE role_id=${row[1]} AND is_deleted=0;`))).toBe(1 + (definition.extraPermissions?.length ?? 0));
  expect(Number(mysql(`SELECT COUNT(*) FROM nx_admin_role_menu WHERE role_id=${row[1]} AND is_deleted=0;`))).toBe(2);
  return { ...definition, username, roleCode, adminId: row[0], roleId: row[1] };
}

function deleteC3Fixtures() {
  mysql(`DELETE FROM nx_wallet_asset_adjustment WHERE maker='${sql(MARKER)}';`);
}

function cleanupFixtures() {
  deleteC3Fixtures();
  const usernames = DEFINITIONS.map((definition) => `restore.${definition.alias.toLowerCase()}.${RUN_TOKEN}`)
    .map((username) => `'${sql(username)}'`)
    .join(",");
  const roleCodes = DEFINITIONS.map((definition) => `'${sql(`RESTORE_${definition.alias}_${RUN_TOKEN}`.toUpperCase())}'`)
    .join(",");
  mysql(
    `DELETE rr FROM nx_admin_role_relation rr JOIN nx_admin a ON a.id=rr.admin_id WHERE a.username IN (${usernames}); `
      + `DELETE s FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username IN (${usernames}); `
      + `DELETE FROM nx_admin WHERE username IN (${usernames});`,
  );
  mysql(
    `DELETE rm FROM nx_admin_role_menu rm JOIN nx_admin_role r ON r.id=rm.role_id WHERE r.role_code IN (${roleCodes}); `
      + `DELETE rp FROM nx_admin_role_permission rp JOIN nx_admin_role r ON r.id=rp.role_id WHERE r.role_code IN (${roleCodes}); `
      + `DELETE FROM nx_admin_role WHERE role_code IN (${roleCodes});`,
  );
}

function fixtureCount() {
  const usernames = DEFINITIONS.map((definition) => `restore.${definition.alias.toLowerCase()}.${RUN_TOKEN}`)
    .map((username) => `'${sql(username)}'`)
    .join(",");
  const roleCodes = DEFINITIONS.map((definition) => `'${sql(`RESTORE_${definition.alias}_${RUN_TOKEN}`.toUpperCase())}'`)
    .join(",");
  return Number(mysql(
    `SELECT (SELECT COUNT(*) FROM nx_wallet_asset_adjustment WHERE maker='${sql(MARKER)}')`
      + `+(SELECT COUNT(*) FROM nx_admin WHERE username IN (${usernames}))`
      + `+(SELECT COUNT(*) FROM nx_admin_role WHERE role_code IN (${roleCodes}));`,
  ));
}

function mysql(statement: string) {
  return execFileSync(MYSQL, ["--default-character-set=utf8mb4", "-N", "-B", "-h", "127.0.0.1", "-uroot", "-D", "nexion", "-e", statement], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}

function clearPermissionCache(adminId: number) {
  execFileSync(REDIS, ["-h", "127.0.0.1", "DEL", `rbac:v2:admin:perms:${adminId}`], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, REDISCLI_AUTH: REDIS_PASSWORD },
  });
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

async function login(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByLabel("账号").fill(username);
  await page.getByLabel("密码").fill(ADMIN_PASSWORD);
  const loginResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const response = await loginResponse;
  expect(response.status()).toBe(200);
  const payload = await response.json().catch(() => null) as { data?: { mfa?: { manualKey?: string } } } | null;
  await expect(page.locator("aside").or(page.getByLabel("一次性验证码"))).toBeVisible();
  if (await page.locator("aside").isVisible().catch(() => false)) return;
  await expect(page.getByLabel("一次性验证码")).toBeVisible();
  const secret = enrollmentSecrets.get(username)
    ?? payload?.data?.mfa?.manualKey?.trim()
    ?? ((await page.locator("code").first().textContent().catch(() => "")) ?? "").trim();
  if (!secret) throw new Error(`${username} MFA enrollment did not expose a secret`);
  enrollmentSecrets.set(username, secret);
  await page.getByLabel("一次性验证码").fill(await freshTotp(secret, username));
  const verifyResponse = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入" }).click();
  expect((await verifyResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible();
}

async function currentSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json();
  expect(payload.code).toBe(0);
  const session = payload.data.session;
  return {
    authorities: [...session.authorities].sort() as string[],
    menus: [...new Set((session.menuCodes ?? session.effectiveMenus ?? []).map((value: string | { menuCode?: string }) => typeof value === "string" ? value : value.menuCode ?? "").filter(Boolean))].sort() as string[],
  };
}

async function expandDomainMenu(page: Page, parentMenu: "B" | "F") {
  const button = page.getByRole("button", { name: parentMenu === "B" ? /总览驾驶舱/ : /分销与团队/ });
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
}

async function freshTotp(secret: string, username: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (usedTotpStep.get(username) === step) {
    await new Promise((resolve) => setTimeout(resolve, (step + 1) * 30_000 - Date.now() + 500));
    step = Math.floor(Date.now() / 30_000);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
    step = Math.floor(Date.now() / 30_000);
  }
  usedTotpStep.set(username, step);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
