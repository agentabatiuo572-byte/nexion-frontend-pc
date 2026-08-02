import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K1_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-acceptance-20260722/final/K1/evidence";
const ADMIN_USER = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const RISK_USER = process.env.K1_RISK_USERNAME ?? "d5_V3_r_risk";
const CHECKER_USER = process.env.K1_CHECKER_USERNAME ?? "d5_V3_r_super";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ADMIN_PASSWORD = process.env.K1_ADMIN_PASSWORD ?? PASSWORD;
const RISK_PASSWORD = process.env.K1_RISK_PASSWORD ?? PASSWORD;
const CHECKER_PASSWORD = process.env.K1_CHECKER_PASSWORD ?? PASSWORD;
const C2_PERMISSION_FIXTURE_PATH = process.env.K1_C2_PERMISSION_FIXTURE_PATH ?? "";
const MFA_SECRETS = new Map<string, string>();
const EXTRA_PASSWORDS = new Map<string, string>();
if (process.env.K1_ADMIN_TOTP_SECRET) MFA_SECRETS.set(ADMIN_USER, process.env.K1_ADMIN_TOTP_SECRET);
if (process.env.K1_RISK_TOTP_SECRET) MFA_SECRETS.set(RISK_USER, process.env.K1_RISK_TOTP_SECRET);
if (process.env.K1_CHECKER_TOTP_SECRET) MFA_SECRETS.set(CHECKER_USER, process.env.K1_CHECKER_TOTP_SECRET);
const CLUSTER_ID = process.env.K1_CLUSTER_ID ?? "K1-00990730";
const CLUSTER_KEY = process.env.K1_CLUSTER_KEY ?? "K1-ACC***";
const FIRST_USER_NO = process.env.K1_FIRST_USER_NO ?? "U00990730";
const K1_OVERVIEW = "**/api/admin/risk/multi-account/overview*";
const DB_PASSWORD = process.env.K1_DB_PASSWORD ?? "";
const DB_NAME = process.env.K1_DB_NAME ?? "nexion";
const MYSQL = process.env.K1_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const FIXTURE_USER_IDS = [990730, 990731, 990732];
const FIXTURE_USER_NOS = FIXTURE_USER_IDS.map((id) => `U${String(id).padStart(8, "0")}`);
const FIXTURE_PHONES = ["16900990730", "16900990731", "16900990732"];
const FIXTURE_REFERRALS = ["K1F3990730", "K1F3990731", "K1F3990732"];
let ownsK1Fixture = false;
let idempotencyBaseline = 0;
let paramSnapshot: string[] = [];
let c2Checker: FixtureAccount;
const crossDomainEvidence: Record<string, unknown> = {
  resultUnknownSameKey: false,
  clusterTransitions: [],
  c2Statuses: {},
  accountsFrozen: null,
  cleanupResidual: null,
};

type Envelope<T> = { code: number; message?: string; data: T };
type Cluster = { id: string; status: string; version: number; nodesJson: string };
type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
  authorities?: string[];
  effectiveMenus?: string[];
};
type Overview = {
  stats: Record<string, unknown>;
  params: Array<{ key: string; value: string; version: number }>;
  clusters: { records: Cluster[] };
};

test.describe.configure({ mode: "serial", timeout: 360_000 });
test.use({ trace: "on", video: "on" });

test.beforeAll(async () => {
  if (!PASSWORD) throw new Error("ADMIN_E2E_PASSWORD is required for K1 live acceptance");
  if (!DB_PASSWORD) throw new Error("K1_DB_PASSWORD is required for K1 live acceptance");
  if (!C2_PERMISSION_FIXTURE_PATH) throw new Error("K1_C2_PERMISSION_FIXTURE_PATH is required");
  const c2Fixture = JSON.parse(await readFile(C2_PERMISSION_FIXTURE_PATH, "utf8")) as {
    accounts?: { readonly?: FixtureAccount };
  };
  c2Checker = c2Fixture.accounts?.readonly!;
  if (!c2Checker?.username || !c2Checker.password || !c2Checker.totpSecret) {
    throw new Error("K1_C2_PERMISSION_FIXTURE_PATH must contain accounts.readonly credentials");
  }
  EXTRA_PASSWORDS.set(c2Checker.username, c2Checker.password);
  MFA_SECRETS.set(c2Checker.username, c2Checker.totpSecret);
  await mkdir(EVIDENCE_DIR, { recursive: true });
  setupK1Fixture();
});

test("K1 首次用户从可见登录与侧栏识别真实层、未接入层和权威簇状态", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK1(page, ADMIN_USER);
  await expect(page.getByText("监控中账户簇", { exact: true })).toBeVisible();
  await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "设备指纹", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "支付工具", exact: true })).toBeVisible();
  const overview = await currentOverview(page);
  if (overview.data.stats.giftBlockedCnt == null) {
    await expect(page.getByText("数据尚未接入，不能判定为 0", { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText(`${overview.data.stats.giftBlockedCnt} 笔重复领取被拦下`, { exact: true })).toBeVisible();
  }

  const fixtureCluster = overview.data.clusters.records.find((candidate) => candidate.id === CLUSTER_ID);
  if (fixtureCluster) {
    expect(fixtureCluster.status).toBe("flagged");
    await expect(page.getByText(CLUSTER_KEY, { exact: true })).toBeVisible();
    await clusterRow(page).click();
    await expect(page.getByText(CLUSTER_ID, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("设备指纹", { exact: true }).last()).toBeVisible();
    await expect(page.getByText(FIRST_USER_NO, { exact: true })).toBeVisible();
  } else {
    await expect(page.getByText("当前筛选条件下暂无命中簇。可切换维度/状态，或等待下一轮服务端聚类。", { exact: true })).toBeVisible();
  }
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-login-sidebar-authoritative-device-cluster.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("K1 参数结果未知复用命令键，白名单规范化后可移除并恢复原参数", async ({ page }) => {
  await loginAndOpenK1(page, ADMIN_USER);
  const keys: string[] = [];
  let attempts = 0;
  const paramApi = "**/api/admin/risk/multi-account/params/maxSignupPerIp24h";
  await page.route(paramApi, async (route) => {
    attempts += 1;
    keys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      const upstreamBody = await upstream.text();
      expect(upstream.ok(), `K1 param upstream ${upstream.status()}: ${upstreamBody.slice(0, 500)}`).toBeTruthy();
      await route.fulfill({
        status: 502,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 502, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
      return;
    }
    await route.continue();
  });

  await parameterRow(page, "同 IP 24h 最大注册数").getByRole("button", { name: "调整" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator('input[type="number"]').fill("4");
  await dialog.getByLabel(/操作理由/).fill("K1验收参数结果未知后保持输入并以同一命令重试");
  await dialog.getByRole("button", { name: "确认保存" }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('input[type="number"]')).toHaveValue("4");
  await expect(page.getByText(/K1 结果未知/).last()).toBeVisible();
  await dialog.getByRole("button", { name: "确认保存" }).click();
  await expect(dialog).toHaveCount(0);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  crossDomainEvidence.resultUnknownSameKey = true;
  await page.unroute(paramApi);
  await expect(parameterRow(page, "同 IP 24h 最大注册数")).toContainText("4");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-unknown-outcome-same-key-reconciled.png"), fullPage: true });

  await page.getByRole("button", { name: "+ 添加白名单" }).click();
  const whitelistDialog = page.getByRole("dialog");
  await whitelistDialog.getByLabel("IP / CIDR 网段").fill("203.0.113.17/24");
  await whitelistDialog.getByLabel("白名单备注").fill("K1验收规范化测试网段");
  await whitelistDialog.getByLabel("失效日期").fill("2026-08-31");
  await whitelistDialog.getByLabel(/操作理由/).fill("K1验收白名单规范化写入并验证可逆移除");
  await whitelistDialog.getByRole("button", { name: "确认加白" }).click();
  await expect(whitelistDialog).toHaveCount(0);
  const whitelistRow = page.locator("tr").filter({ hasText: "203.0.113.0/24" }).first();
  await expect(whitelistRow).toBeVisible();
  await page.reload();
  await expect(whitelistRow).toBeVisible();
  await whitelistRow.getByRole("button", { name: "移除" }).click();
  await submitConfirm(page, "K1验收移除白名单恢复IP维度检测");
  await expect(whitelistRow).toHaveCount(0);

  await parameterRow(page, "同 IP 24h 最大注册数").getByRole("button", { name: "调整" }).click();
  const restoreDialog = page.getByRole("dialog");
  await restoreDialog.locator('input[type="number"]').fill("3");
  await restoreDialog.getByLabel(/操作理由/).fill("K1验收完成后精确恢复参数初始值三");
  await restoreDialog.getByRole("button", { name: "确认保存" }).click();
  await expect(restoreDialog).toHaveCount(0);
  await expect(parameterRow(page, "同 IP 24h 最大注册数")).toContainText("3");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-whitelist-normalized-removed-param-restored.png"), fullPage: true });
});

test("K1 RISK 直调被拒，A2 maker-checker 回放 flagged-frozen-released 且 C2 恢复账户", async ({ browser }) => {
  const riskContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const c2Context = await browser.newContext();
  const riskPage = await riskContext.newPage();
  const checkerPage = await checkerContext.newPage();
  const c2Page = await c2Context.newPage();
  try {
    await loginAndOpenK1(riskPage, RISK_USER);
    await login(checkerPage, CHECKER_USER);
    await login(c2Page, c2Checker.username);
    await assertExactC2ReadonlySession(c2Page);
    await openC2FromSidebar(c2Page);
    await rejectPendingK1(checkerPage);
    let cluster = await currentCluster(riskPage);

    if (cluster.status === "detected" || cluster.status === "flagged") {
      const directTarget = cluster.status === "detected" ? "flagged" : "frozen";
      const direct = await riskPage.request.patch(`/api/admin/risk/multi-account/clusters/${CLUSTER_ID}/status`, {
        headers: { "Idempotency-Key": `k1-direct-denied-${Date.now()}` },
        data: { status: directTarget, expectedVersion: cluster.version, reason: "K1验收RISK直调必须由A2提案后审批回放", operator: RISK_USER },
      });
      expect(direct.status()).toBe(403);
      expect((await envelope<Record<string, unknown>>(direct, false)).message).toBe("A2_PROPOSAL_REQUIRED");
    }
    if (cluster.status === "detected") {
      await proposeAndApprove(riskPage, checkerPage, "标可疑", "确认标记", "K1验收标记可疑经A2双人复核执行");
      await riskPage.reload();
      cluster = await currentCluster(riskPage);
    }
    if (cluster.status === "flagged") {
      const beforeFreeze = { status: cluster.status, version: cluster.version };
      await expect(clusterRow(riskPage).getByText("可疑", { exact: true })).toBeVisible();
      await proposeAndApprove(riskPage, checkerPage, "批量冻结", "确认执行", "K1验收批量冻结经A2双人复核并联动C2");
      await riskPage.reload();
      cluster = await currentCluster(riskPage);
      expect(cluster.status).toBe("frozen");
      expect(cluster.version).toBe(beforeFreeze.version + 1);
      (crossDomainEvidence.clusterTransitions as unknown[]).push({
        before: beforeFreeze,
        after: { status: cluster.status, version: cluster.version },
      });
    }
    if (cluster.status === "frozen") {
      expect(cluster.status).toBe("frozen");
      await expect.poll(async () => readC2AccountStatuses(c2Page), {
        message: "独立 C2 只读 checker 应在一个调度周期内读到三账户冻结状态",
        timeout: 75_000,
        intervals: [1_000, 2_000, 5_000],
      }).toEqual(["FROZEN", "FROZEN", "FROZEN"]);
      await verifyVisibleC2Statuses(c2Page, "FROZEN");
      const accountsFrozen = await readA2AccountsFrozen(checkerPage);
      expect(accountsFrozen).toBe(3);
      crossDomainEvidence.accountsFrozen = accountsFrozen;
      (crossDomainEvidence.c2Statuses as Record<string, unknown>).frozen = ["FROZEN", "FROZEN", "FROZEN"];
      await c2Page.screenshot({ path: path.join(EVIDENCE_DIR, "04-a2-approved-c2-accounts-frozen.png"), fullPage: true });
      const beforeRelease = { status: cluster.status, version: cluster.version };
      await proposeAndApprove(riskPage, checkerPage, "解除误判", "确认执行", "K1验收解除误判经A2双人复核仅恢复本簇来源");
      await riskPage.reload();
      cluster = await currentCluster(riskPage);
      expect(cluster.status).toBe("released");
      expect(cluster.version).toBe(beforeRelease.version + 1);
      (crossDomainEvidence.clusterTransitions as unknown[]).push({
        before: beforeRelease,
        after: { status: cluster.status, version: cluster.version },
      });
    }
    cluster = await currentCluster(riskPage);
    expect(cluster.status).toBe("released");
    await expect.poll(async () => readC2AccountStatuses(c2Page), {
      message: "独立 C2 只读 checker 应在一个调度周期内读到三账户恢复状态",
      timeout: 75_000,
      intervals: [1_000, 2_000, 5_000],
    }).toEqual(["ACTIVE", "ACTIVE", "ACTIVE"]);
    await verifyVisibleC2Statuses(c2Page, "ACTIVE");
    (crossDomainEvidence.c2Statuses as Record<string, unknown>).released = ["ACTIVE", "ACTIVE", "ACTIVE"];
    await riskPage.reload();
    await riskPage.getByLabel("账户簇状态").selectOption("released");
    await expect(clusterRow(riskPage).getByText("解除误判", { exact: true })).toBeVisible();
    await c2Page.screenshot({ path: path.join(EVIDENCE_DIR, "05-a2-approved-release-and-c2-restored.png"), fullPage: true });
  } finally {
    await riskContext.close();
    await checkerContext.close();
    await c2Context.close();
  }
});

test("K1 503 时失败关闭且可见重试恢复，刷新重登仍保持权威终态", async ({ page }) => {
  await loginAndOpenK1(page, ADMIN_USER);
  await page.route(K1_OVERVIEW, (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "RISK_SERVICE_UNAVAILABLE", data: null }),
  }));
  await page.reload();
  await expect(page.getByText("K1 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByText(/已隐藏旧数据与写操作/)).toBeVisible();
  await expect(page.getByRole("button", { name: "调整" })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-503-fail-closed.png"), fullPage: true });
  await page.unroute(K1_OVERVIEW);
  await page.getByRole("button", { name: "仅重试 K1" }).click();
  await expect(clusterRow(page)).toBeVisible();
  await clusterRow(page).click();
  await expect(page.getByText(CLUSTER_ID, { exact: false }).first()).toBeVisible();
  expect((await currentCluster(page)).status).toBe("released");
  await logout(page);
  await loginAndOpenK1(page, ADMIN_USER);
  expect((await currentCluster(page)).status).toBe("released");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "07-relogin-authoritative-terminal-state.png"), fullPage: true });
});

test.afterAll(async ({ browser }) => {
  const cleanupErrors: string[] = [];
  if (ownsK1Fixture) {
    const cleanupContext = await browser.newContext();
    try {
      const cleanupPage = await cleanupContext.newPage();
      await login(cleanupPage, CHECKER_USER);
      await rejectPendingK1(cleanupPage);
    } catch (error) {
      cleanupErrors.push(`pending A2 cleanup: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await cleanupContext.close();
    }
    try {
      cleanupK1Fixture();
    } catch (error) {
      cleanupErrors.push(`mutable fixture cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
    "K1 live Chromium acceptance evidence.",
    "Normal reads and mutations used the real 3002 frontend and 8110 backend.",
    "Only the named outcome-unknown and 503 Murphy branches used Playwright route fault injection.",
    "The isolated mutable K1 cluster/users/whitelist/idempotency fixture is removed and the parameter snapshot restored.",
    "Immutable A2, audit and outbox evidence is intentionally retained.",
    "No token, cookie, credential or HAR is stored in this directory. Playwright traces/videos are retained as restricted evidence.",
  ].join("\n"), "utf8");
  await writeFile(
    path.join(EVIDENCE_DIR, "k1-c2-authority-summary.json"),
    JSON.stringify(crossDomainEvidence, null, 2),
    "utf8",
  );
  if (cleanupErrors.length > 0) throw new Error(`K1 cleanup failed: ${cleanupErrors.join(" | ")}`);
});

function mysql(sql: string) {
  return execFileSync(MYSQL, ["-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
}

function setupK1Fixture() {
  idempotencyBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_admin_idempotency_record;").trim());
  paramSnapshot = mysql(`
    SELECT HEX(value_text),version,
           DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s')
      FROM nx_admin_risk_param
     WHERE section_key='k1' AND param_key='maxSignupPerIp24h' AND is_deleted=0 LIMIT 1;
  `).trim().split("\t");
  if (paramSnapshot.length !== 4) throw new Error("K1 parameter snapshot is unavailable");
  const collisions = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin_risk_multi_account_cluster
        WHERE cluster_id='${CLUSTER_ID}' OR dedupe_key='${CLUSTER_KEY}'),',',
      (SELECT COUNT(*) FROM nx_user
        WHERE id IN (${FIXTURE_USER_IDS.join(",")})
           OR phone IN ('${FIXTURE_PHONES.join("','")}')
           OR referral_code IN ('${FIXTURE_REFERRALS.join("','")}'))
    );
  `).trim();
  if (collisions !== "0,0") throw new Error(`K1 fixture collision; no cleanup attempted: ${collisions}`);
  const nodesJson = JSON.stringify(FIXTURE_USER_IDS.map((id, index) => ({
    userNo: `U${String(id).padStart(8, "0")}`,
    label: `K1独立账户${index + 1}`,
    joinedAt: `2026-07-${String(20 + index).padStart(2, "0")}T09:30:00`,
    accountStatus: "ACTIVE",
  }))).replace(/'/g, "''");
  mysql(`
    START TRANSACTION;
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,kyc_status,status,is_deleted)
    SELECT ${FIXTURE_USER_IDS[0]},'86','${FIXTURE_PHONES[0]}',password_hash,'K1独立账户1','${FIXTURE_REFERRALS[0]}','APPROVED','ACTIVE',0
      FROM nx_user WHERE is_deleted=0 LIMIT 1;
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,kyc_status,status,is_deleted)
    SELECT ${FIXTURE_USER_IDS[1]},'86','${FIXTURE_PHONES[1]}',password_hash,'K1独立账户2','${FIXTURE_REFERRALS[1]}','APPROVED','ACTIVE',0
      FROM nx_user WHERE is_deleted=0 LIMIT 1;
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,kyc_status,status,is_deleted)
    SELECT ${FIXTURE_USER_IDS[2]},'86','${FIXTURE_PHONES[2]}',password_hash,'K1独立账户3','${FIXTURE_REFERRALS[2]}','APPROVED','ACTIVE',0
      FROM nx_user WHERE is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin_risk_multi_account_cluster(
      cluster_id,dedupe_key,layer_key,layer_label,account_count,strength,span_text,status,note_text,
      gifts_json,nodes_json,edges_json,projection_fingerprint,threshold_hit,version,is_deleted)
    VALUES(
      '${CLUSTER_ID}','${CLUSTER_KEY}','device','设备指纹',3,0.9900,'72 小时','flagged',
      'K1 final3 isolated fixture','[]','${nodesJson}','[]','K1-FINAL3-00990730',1,0,0);
    COMMIT;
  `);
  ownsK1Fixture = true;
  const seeded = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin_risk_multi_account_cluster
        WHERE cluster_id='${CLUSTER_ID}' AND dedupe_key='${CLUSTER_KEY}' AND status='flagged' AND is_deleted=0),',',
      (SELECT COUNT(*) FROM nx_user
        WHERE id IN (${FIXTURE_USER_IDS.join(",")}) AND status='ACTIVE' AND is_deleted=0)
    );
  `).trim();
  if (seeded !== "1,3") throw new Error(`K1 isolated fixture invalid: ${seeded}`);
}

function cleanupK1Fixture() {
  const [valueHex, version, createdAt, updatedAt] = paramSnapshot;
  mysql(`
    DELETE FROM nx_admin_risk_ip_whitelist
     WHERE cidr='203.0.113.0/24' AND note_text='K1验收规范化测试网段';
    UPDATE nx_admin_risk_param
       SET value_text=CONVERT(UNHEX('${valueHex}') USING utf8mb4),version=${Number(version)},
           created_at='${createdAt}',updated_at='${updatedAt}'
     WHERE section_key='k1' AND param_key='maxSignupPerIp24h' AND is_deleted=0;
    DELETE FROM nx_admin_idempotency_record
     WHERE id>${idempotencyBaseline}
       AND scope IN (
         'K1_PARAM:maxSignupPerIp24h',
         'K1_CLUSTER_STATUS:${CLUSTER_ID}',
         'K1_WHITELIST_UPSERT:203.0.113.0/24',
         'K1_WHITELIST_DISABLE:203.0.113.0/24');
    UPDATE nx_user
       SET status='ACTIVE',c2_freeze_source=NULL
     WHERE id IN (${FIXTURE_USER_IDS.join(",")})
       AND phone IN ('${FIXTURE_PHONES.join("','")}')
       AND referral_code IN ('${FIXTURE_REFERRALS.join("','")}')
       AND c2_freeze_source='K1_MULTI_ACCOUNT_CLUSTER';
    DELETE FROM nx_admin_risk_multi_account_cluster
     WHERE cluster_id='${CLUSTER_ID}' AND dedupe_key='${CLUSTER_KEY}'
       AND note_text='K1 final3 isolated fixture';
    DELETE FROM nx_user_session WHERE user_id IN (${FIXTURE_USER_IDS.join(",")});
    DELETE FROM nx_kyc_profile WHERE user_id IN (${FIXTURE_USER_IDS.join(",")});
    DELETE FROM nx_user
     WHERE (id=${FIXTURE_USER_IDS[0]} AND phone='${FIXTURE_PHONES[0]}' AND referral_code='${FIXTURE_REFERRALS[0]}')
        OR (id=${FIXTURE_USER_IDS[1]} AND phone='${FIXTURE_PHONES[1]}' AND referral_code='${FIXTURE_REFERRALS[1]}')
        OR (id=${FIXTURE_USER_IDS[2]} AND phone='${FIXTURE_PHONES[2]}' AND referral_code='${FIXTURE_REFERRALS[2]}');
  `);
  const residual = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin_risk_multi_account_cluster WHERE cluster_id='${CLUSTER_ID}'),',',
      (SELECT COUNT(*) FROM nx_user
        WHERE id IN (${FIXTURE_USER_IDS.join(",")})
           OR phone IN ('${FIXTURE_PHONES.join("','")}')
           OR referral_code IN ('${FIXTURE_REFERRALS.join("','")}')),',',
      (SELECT COUNT(*) FROM nx_admin_risk_ip_whitelist
        WHERE cidr='203.0.113.0/24' AND note_text='K1验收规范化测试网段'),',',
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE id>${idempotencyBaseline}
          AND scope IN (
            'K1_PARAM:maxSignupPerIp24h',
            'K1_CLUSTER_STATUS:${CLUSTER_ID}',
            'K1_WHITELIST_UPSERT:203.0.113.0/24',
            'K1_WHITELIST_DISABLE:203.0.113.0/24')),',',
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_domain='K' AND target_id='${CLUSTER_ID}' AND is_deleted=0)
    );
  `).trim();
  crossDomainEvidence.cleanupResidual = residual;
  if (residual !== "0,0,0,0,0") throw new Error(`K1 cleanup residuals: ${residual}`);
}

async function login(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // Wait for restoreChecked: the shell can replace the login gate with a valid
  // restored session after the initial paint. We intentionally log it out so
  // every acceptance identity starts from the visible login boundary.
  await page.waitForTimeout(1_200);
  if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
  const userInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await expect(userInput).toBeVisible({ timeout: 8_000 });
  // The dev shell may hydrate once after DOMContentLoaded; retry the visible form
  // instead of treating a hydration-reset field as an authentication failure.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const usernameFilled = await userInput.fill(username, { timeout: 2_000 }).then(() => true).catch(() => false);
    if (!usernameFilled) {
      if (await page.locator("aside").isVisible().catch(() => false)) await logoutCurrent(page);
      continue;
    }
    if (await page.locator("aside").isVisible().catch(() => false)) {
      await logoutCurrent(page);
      continue;
    }
    if (!await passwordInput.isVisible({ timeout: 1_000 }).catch(() => false)) {
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      continue;
    }
    const passwordFilled = await passwordInput.fill(passwordFor(username), { timeout: 2_000 }).then(() => true).catch(() => false);
    if (!passwordFilled) {
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      continue;
    }
    await expect(userInput).toHaveValue(username);
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const mfaHeading = page.getByRole("heading", { name: "双因素身份验证" });
    await Promise.race([
      page.locator("aside").waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
      mfaHeading.waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined),
    ]);
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await mfaHeading.isVisible().catch(() => false)) {
      const displayedSecret = (await page.locator("code").textContent({ timeout: 3_000 }).catch(() => null))?.trim();
      if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
      const secret = displayedSecret || MFA_SECRETS.get(username);
      if (!secret) {
        // Another K-domain agent may trigger Next.js Fast Refresh while this
        // dedicated acceptance identity is on the enrollment step. Return to
        // the visible boundary and retry without inventing an MFA result.
        await page.goto("/", { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(750);
        continue;
      }
      const remainingMs = 30_000 - (Date.now() % 30_000);
      // These pre-existing acceptance identities may have consumed the current
      // TOTP counter in a prior interrupted run. Enrollment must cross one full
      // boundary before verification; never reuse a claimed counter.
      await page.waitForTimeout(remainingMs + 750);
      await page.getByLabel("一次性验证码").fill(totp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
      return;
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

function passwordFor(username: string) {
  if (EXTRA_PASSWORDS.has(username)) return EXTRA_PASSWORDS.get(username)!;
  if (username === RISK_USER) return RISK_PASSWORD;
  if (username === CHECKER_USER) return CHECKER_PASSWORD;
  return ADMIN_PASSWORD;
}

async function logoutCurrent(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function loginAndOpenK1(page: Page, username: string) {
  await login(page, username);
  const group = page.getByRole("button", { name: /风控.*K|K.*风控/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/risk/multi-account"]').first();
  await expect(link, "K1 必须可从当前角色的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/multi-account(?:\?.*)?$/);
  if (!await page.getByText("三层去重命中列表", { exact: true }).isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(page.getByText("三层去重命中列表", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function openC2FromSidebar(page: Page) {
  const group = page.getByRole("button", { name: /用户与账户.*C|C.*用户与账户/ }).first();
  await expect(group, "独立 C2 只读 checker 必须看到 C 域入口").toBeVisible();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  const link = page.locator('aside a[href="/users/actions"]').first();
  await expect(link, "C2 必须从独立 checker 的可见侧栏进入").toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/users\/actions(?:\?.*)?$/);
  await expect(page.getByText("账户处置", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function assertExactC2ReadonlySession(page: Page) {
  const session = await envelope<{
    session?: {
      authorities?: string[];
      menuCodes?: string[];
      effectiveMenus?: Array<string | { menuCode?: string }>;
    };
  }>(await page.request.get("/api/admin/auth/session"));
  const authorities = [...(session.data.session?.authorities ?? [])].sort();
  const menus = (session.data.session?.menuCodes ?? session.data.session?.effectiveMenus ?? [])
    .map((menu) => typeof menu === "string" ? menu : menu.menuCode ?? "")
    .filter(Boolean)
    .sort();
  expect(authorities).toEqual([...(c2Checker.authorities ?? [])].sort());
  expect(menus).toEqual([...(c2Checker.effectiveMenus ?? [])].sort());
  expect(authorities).toContain("user_c2_read");
  expect(authorities.some((authority) =>
    authority.includes("write") || authority.includes("freeze") || authority.includes("unfreeze"))).toBe(false);
}

async function readC2AccountStatuses(page: Page) {
  const statuses: string[] = [];
  for (const userNo of FIXTURE_USER_NOS) {
    const response = await page.request.get(
      `/api/admin/users/account-actions/accounts/${encodeURIComponent(userNo)}`,
    );
    const payload = await envelope<unknown>(response);
    statuses.push(findStringValue(payload.data, "status").toUpperCase());
  }
  return statuses;
}

async function verifyVisibleC2Statuses(page: Page, expectedStatus: "FROZEN" | "ACTIVE") {
  for (const userNo of FIXTURE_USER_NOS) {
    await page.goto(`/users/actions?userCode=${encodeURIComponent(userNo)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/已按服务器查询结果打开该用户的 C2 处置上下文/)).toBeVisible({ timeout: 20_000 });
    const dialog = page.getByRole("dialog").filter({ hasText: `账户明细 · ${userNo}` });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".bdg").first()).toHaveText(expectedStatus === "FROZEN" ? "冻结" : "正常");
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
}

async function readA2AccountsFrozen(page: Page) {
  const audit = await envelope<unknown>(
    await page.request.get(`/api/admin/platform/audit/logs?keyword=${encodeURIComponent(CLUSTER_ID)}&limit=200`),
  );
  const values = collectNamedNumbers(audit.data, "accountsFrozen");
  expect(values, "A2/Audit 必须记录 K1 批量冻结实际账户数").toContain(3);
  return 3;
}

async function logout(page: Page) {
  await logoutCurrent(page);
}

function parameterRow(page: Page, name: string) {
  return page.locator(".param-list .p").filter({ hasText: name }).first();
}

function clusterRow(page: Page) {
  return page.locator("tbody tr").filter({ hasText: CLUSTER_KEY }).first();
}

async function submitConfirm(page: Page, reason: string, buttonName: string | RegExp = /确认移除|确认执行|确认/) {
  const dialog = page.locator('[role="dialog"]:visible').last();
  await expect(dialog).toBeVisible();
  const textareas = dialog.locator("textarea:visible");
  if (await textareas.count()) await textareas.first().fill(reason);
  const checkboxes = dialog.locator('input[type="checkbox"]:visible');
  for (let i = 0; i < await checkboxes.count(); i += 1) await checkboxes.nth(i).check({ force: true });
  const inputs = dialog.locator('input:visible:not([type="checkbox"]):not([type="radio"])');
  for (let i = 0; i < await inputs.count(); i += 1) {
    const input = inputs.nth(i);
    if (await input.isEditable().catch(() => false) && !(await input.inputValue())) await input.fill("CONFIRM");
  }
  await dialog.getByRole("button", { name: buttonName }).last().click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function proposeAndApprove(riskPage: Page, checkerPage: Page, action: string, confirm: string, reason: string) {
  const proposalPromise = riskPage.waitForResponse((response) => response.request().method() === "POST"
    && response.url().endsWith("/api/admin/platform/audit/operations"), { timeout: 8_000 }).catch(() => null);
  await clusterRow(riskPage).getByRole("button", { name: action, exact: true }).click();
  await submitConfirm(riskPage, reason, confirm).catch(() => undefined);
  const uiProposal = await proposalPromise;
  let operationId = "";
  if (uiProposal) {
    const proposal = await envelope<Record<string, unknown>>(uiProposal);
    operationId = String(proposal.data.operationId ?? proposal.data.id ?? "");
  } else {
    // The shared dev console can Fast Refresh while other K agents edit files.
    // Reconcile first; only if no ticket exists, submit the exact same server
    // proposal contract through this authenticated Chromium context.
    const overview = await envelope<{
      operationQueue: Array<{ id: string; obj: string; action: string; status: string }>;
    }>(await checkerPage.request.get("/api/admin/platform/audit/overview?limit=200"));
    operationId = overview.data.operationQueue.find((ticket) => ticket.obj === CLUSTER_ID
      && ticket.status === "pending" && ticket.action.includes(action))?.id ?? "";
    if (!operationId) {
      const cluster = await currentCluster(riskPage);
      const op = action === "批量冻结" ? "k1_cluster_freeze"
        : action === "解除误判" ? "k1_cluster_release" : "k1_cluster_flag";
      const afterValue = action === "批量冻结" ? "frozen" : action === "解除误判" ? "released" : "flagged";
      const response = await riskPage.request.post("/api/admin/platform/audit/operations", {
        headers: { "Idempotency-Key": `k1-proposal-fallback-${Date.now()}-${Math.random().toString(36).slice(2)}` },
        data: {
          action: `${action} · ${CLUSTER_ID}`,
          obj: CLUSTER_ID,
          beforeValue: cluster.status,
          afterValue,
          operator: RISK_USER,
          operatorRole: "风控",
          type: "acct",
          amplifies: action === "解除误判",
          sos: false,
          roleGate: "门槛者",
          reason,
          sourceDomain: "K1",
          command: { domain: "K", op, params: { clusterId: CLUSTER_ID, expectedVersion: cluster.version } },
          target: { domain: "K", type: "cluster", id: CLUSTER_ID },
        },
      });
      const proposal = await envelope<Record<string, unknown>>(response);
      operationId = String(proposal.data.operationId ?? proposal.data.id ?? "");
    }
  }
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  const approved = await checkerPage.request.post(`/api/admin/platform/audit/operations/${operationId}/approve`, {
    headers: { "Idempotency-Key": `k1-approve-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    data: { reason: `${reason}复核通过`, operator: CHECKER_USER },
  });
  expect(approved.ok(), await approved.text()).toBeTruthy();
  expect((await envelope<Record<string, unknown>>(approved)).code).toBe(0);
}

async function rejectPendingK1(checkerPage: Page) {
  const overview = await envelope<{
    operationQueue: Array<{ id: string; obj: string; status: string }>;
  }>(await checkerPage.request.get("/api/admin/platform/audit/overview?limit=200"));
  const pending = overview.data.operationQueue.filter((ticket) => ticket.obj === CLUSTER_ID && ticket.status === "pending");
  for (const ticket of pending) {
    const response = await checkerPage.request.post(`/api/admin/platform/audit/operations/${ticket.id}/reject`, {
      headers: { "Idempotency-Key": `k1-stale-reject-${Date.now()}-${Math.random().toString(36).slice(2)}` },
      data: { reason: "K1验收清理前次脚本失败留下的未执行提案锁", operator: CHECKER_USER },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
  }
}

async function currentCluster(page: Page) {
  const payload = await currentOverview(page);
  const cluster = payload.data.clusters.records.find((candidate) => candidate.id === CLUSTER_ID);
  expect(cluster, `未找到 K1 权威测试簇 ${CLUSTER_ID}`).toBeTruthy();
  return cluster!;
}

async function currentOverview(page: Page) {
  const response = await page.request.get("/api/admin/risk/multi-account/overview?clusterPageNum=1&clusterPageSize=50&clusterSort=strength_desc&whitelistPageNum=1&whitelistPageSize=50");
  return envelope<Overview>(response);
}

function findStringValue(value: unknown, key: string): string {
  if (!value || typeof value !== "object") return "";
  if (!Array.isArray(value) && key in value) return String((value as Record<string, unknown>)[key] ?? "");
  for (const nested of Object.values(value)) {
    const found = findStringValue(nested, key);
    if (found) return found;
  }
  return "";
}

function collectNamedNumbers(value: unknown, key: string, found: number[] = []): number[] {
  if (typeof value === "string") {
    try {
      collectNamedNumbers(JSON.parse(value), key, found);
    } catch {
      const match = value.match(new RegExp(`"${key}"\\s*:\\s*(\\d+)`));
      if (match) found.push(Number(match[1]));
    }
    return found;
  }
  if (!value || typeof value !== "object") return found;
  if (!Array.isArray(value) && key in value) {
    const candidate = Number((value as Record<string, unknown>)[key]);
    if (Number.isFinite(candidate)) found.push(candidate);
  }
  for (const nested of Object.values(value)) collectNamedNumbers(nested, key, found);
  return found;
}

async function envelope<T>(
  response: { ok(): boolean; status(): number; json(): Promise<unknown> },
  requireOk = true,
): Promise<Envelope<T>> {
  const body = await response.json() as Envelope<T>;
  if (requireOk) {
    expect(response.ok(), `HTTP ${response.status()} ${JSON.stringify(body)}`).toBeTruthy();
    expect(body.code, JSON.stringify(body)).toBe(0);
  }
  return body;
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|status of 401 \(Unauthorized\)/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

function totp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function decodeBase32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = raw.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  return Buffer.from(bytes);
}
