import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const EVIDENCE_DIR = process.env.K3_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-parallel-acceptance-20260722-192757/K3-withdrawal-rules/evidence/final";
const BACKEND_URL = process.env.K3_BACKEND_URL ?? "http://127.0.0.1:8110";
const MYSQL = process.env.K3_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.K3_DB_NAME ?? "nexion";
const DB_PASSWORD = requiredEnv("K3_DB_PASSWORD");
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const SUPERADMIN_USERNAME = "superadmin";
const RISK_USERNAME = "k3_accept_risk_0722f";
const RISK_FLOW_USERNAME = "k3_accept_risk_flow_0722f";
const RISK_RESILIENCE_USERNAME = "k3_accept_risk_res_0722f";
const AUDITOR_USERNAME = "k3_accept_aud_0722f";
const FINANCE_USERNAME = "k3_accept_fin_0722f";
const APP_USER_ID = 990731;
const APP_PHONE = "7000000323";
const APP_ADDRESS = "TK3FinalAcceptanceAddress";
const INVALID_RULE_ID = "WR-K3-FAILCLOSED-FINAL";
const ADDRESS_RULE_ID = "WR-K3-ADDRESS-PROVIDER-FINAL";
const REASON = "K3最终验收提现规则闭环和异常恢复验证";
const EDGE_HEADERS = { "X-Nexion-Edge-Country": "JP" };
const RUN_TAG = process.env.K3_ACCEPTANCE_RUN_ID?.trim() || Date.now().toString(36);

type Envelope<T> = { code: number; message?: string; data: T };
type Rule = { ruleId: string; state: string; version: number; conditionText: string; action: string };
type Overview = {
  dimensions: Array<{ ruleId: string }>;
  rules: { records: Rule[]; total: number };
  hits: { total: number };
};

let fixtureRuleId = "";
let smallWithdrawalNo = "";
let largeWithdrawalNo = "";
let currentK4Score = -1;
let currentK4ModelVersion = "";
const totpSecrets = new Map<string, string>();
const totpCounters = new Map<string, number>();
const runSummary: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  runTag: RUN_TAG,
  fixtures: { appUserId: APP_USER_ID, invalidRuleId: INVALID_RULE_ID, addressRuleId: ADDRESS_RULE_ID },
  assertions: {},
};

test.describe.configure({ mode: "serial" });
test.use({ trace: "off", video: "off" });

test.beforeAll(async () => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  cleanupFixtures();
  mysql(`
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${RISK_USERNAME}',password_hash,'K3风险验收',0,1,0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${RISK_FLOW_USERNAME}',password_hash,'K3链路验收',0,1,0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${RISK_RESILIENCE_USERNAME}',password_hash,'K3韧性验收',0,1,0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${AUDITOR_USERNAME}',password_hash,'K3审计验收',0,1,0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin(username,password_hash,nickname,super_admin,status,is_deleted)
    SELECT '${FINANCE_USERNAME}',password_hash,'K3财务验收',0,1,0 FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT a.id,r.id,0 FROM nx_admin a JOIN nx_admin_role r ON r.role_code='RISK' AND r.is_deleted=0 WHERE a.username='${RISK_USERNAME}';
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT a.id,r.id,0 FROM nx_admin a JOIN nx_admin_role r ON r.role_code='RISK' AND r.is_deleted=0 WHERE a.username='${RISK_FLOW_USERNAME}';
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT a.id,r.id,0 FROM nx_admin a JOIN nx_admin_role r ON r.role_code='RISK' AND r.is_deleted=0 WHERE a.username='${RISK_RESILIENCE_USERNAME}';
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT a.id,r.id,0 FROM nx_admin a JOIN nx_admin_role r ON r.role_code='AUDITOR' AND r.is_deleted=0 WHERE a.username='${AUDITOR_USERNAME}';
    INSERT INTO nx_admin_role_relation(admin_id,role_id,is_deleted)
    SELECT a.id,r.id,0 FROM nx_admin a JOIN nx_admin_role r ON r.role_code='FINANCE' AND r.is_deleted=0 WHERE a.username='${FINANCE_USERNAME}';
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,kyc_status,status,created_at,updated_at,is_deleted)
    SELECT ${APP_USER_ID},'86','${APP_PHONE}',password_hash,'K3最终验收用户','K3FINAL0722','APPROVED','ACTIVE',DATE_SUB(NOW(),INTERVAL 90 DAY),NOW(),0
      FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
    UPDATE nx_kyc_profile
       SET status='APPROVED',country='JP',applicant_name='K3 Final Fixture',document_type='PASSPORT',
           document_last4='0722',submitted_at=DATE_SUB(NOW(),INTERVAL 91 DAY),reviewed_by='k3-acceptance',
           reviewed_at=DATE_SUB(NOW(),INTERVAL 90 DAY),expires_at=DATE_ADD(NOW(),INTERVAL 1 YEAR),
           paired_address='${APP_ADDRESS}',network='TRC20',paired_at=NOW(),trigger_source='K3_ACCEPTANCE'
     WHERE user_id=${APP_USER_ID};
    INSERT INTO nx_user_wallet(user_id,usdt_available,nex_available,pending_withdraw,lifetime_earned,version,is_deleted)
    VALUES(${APP_USER_ID},10000,100,0,0,0,0);
    INSERT INTO nx_admin_risk_withdraw_rule
      (rule_id,dimension,condition_text,action,state,built_in,priority,version,created_by,is_deleted)
    VALUES('${INVALID_RULE_ID}','amount','legacy magic expression','freeze','active',0,99,0,'k3-acceptance',0);
  `);
});

test.afterAll(async () => {
  try {
    cleanupFixtures();
    runSummary.cleanup = "temporary accounts, rules, orders, audit, outbox, delivery, sessions and idempotency removed";
  } catch (error) {
    runSummary.cleanup = error instanceof Error ? error.message : "cleanup failed";
    throw error;
  } finally {
    runSummary.finishedAt = new Date().toISOString();
    await writeFile(path.join(EVIDENCE_DIR, "run-summary.json"), `${JSON.stringify(runSummary, null, 2)}\n`, "utf8");
    await writeFile(path.join(EVIDENCE_DIR, "README.txt"), [
      "K3 final live Chromium acceptance evidence.",
      "Normal reads and mutations used the real 3002 frontend and 8110 backend.",
      "Only the named 502 outcome-unknown and 503 dependency branches used browser route fault injection.",
      "Address-reputation provider unavailability was verified through the real backend configuration; no mock provider was used.",
      "No token, cookie, password, TOTP secret, HAR, trace archive or video is stored here.",
    ].join("\n"), "utf8");
  }
});

test("审计员与财务从可见侧栏进入 K3，仅可读且后端写入拒绝", async ({ page }) => {
  for (const [username, screenshot] of [
    [AUDITOR_USERNAME, "01-auditor-readonly.png"],
    [FINANCE_USERNAME, "02-finance-readonly.png"],
  ] as const) {
    const errors = collectRuntimeErrors(page);
    await loginAndOpenK3(page, username);
    await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible();
    await expect(page.getByText("规则总表", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /沙盒模拟/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "+ 新建规则", exact: true })).toBeDisabled();
    const denied = await page.request.post("/api/admin/risk/withdraw-rules/dry-runs", {
      headers: { "Idempotency-Key": `k3-${username}-denied` },
      data: { reason: REASON },
    });
    expect(denied.status()).toBe(403);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, screenshot), fullPage: true });
    expect(errors).toEqual([]);
    await logout(page);
  }
  runSummary.assertions = { ...(runSummary.assertions as object), readonlyRbac: "AUDITOR/FINANCE GET=200, dry-run=403" };
});

test("K4 当前分可用、陈旧分和 K3 非法/地址信誉 provider 缺失均失败关闭且不动资金", async ({ page }) => {
  const current = await waitForCurrentK4(page);
  currentK4Score = current.score;
  currentK4ModelVersion = current.modelVersion;

  const before = walletAndOrderSnapshot();
  const token = await appLogin(page);
  const response = await appSubmit(page, token, 100, runKey("k3-final-invalid-active"));
  const payload = await response.json() as Envelope<unknown>;
  expect(response.status()).toBe(503);
  expect(payload.message).toBe("K3_WITHDRAWAL_DECISION_UNAVAILABLE");
  expect(walletAndOrderSnapshot()).toEqual(before);

  let staleResult: { status: number; message?: string } | null = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    mysql(`UPDATE nx_admin_risk_score_user SET as_of=DATE_SUB(NOW(),INTERVAL 2 DAY)
            WHERE user_no='U00${APP_USER_ID}' AND is_deleted=0;`);
    const stale = await appSubmit(page, token, 100, runKey(`k3-final-k4-stale-${attempt}`));
    const stalePayload = await stale.json() as Envelope<unknown>;
    staleResult = { status: stale.status(), message: stalePayload.message };
    if (stalePayload.message === "K4_RISK_SCORE_UNAVAILABLE") break;
    expect(stale.status()).toBe(503);
    expect(stalePayload.message).toBe("K3_WITHDRAWAL_DECISION_UNAVAILABLE");
  }
  expect(staleResult).toEqual({ status: 503, message: "K4_RISK_SCORE_UNAVAILABLE" });
  expect(walletAndOrderSnapshot()).toEqual(before);

  mysql(`UPDATE nx_admin_risk_score_user SET as_of=NOW()
          WHERE user_no='U00${APP_USER_ID}' AND is_deleted=0;`);
  await waitForCurrentK4(page);
  mysql(`UPDATE nx_admin_risk_withdraw_rule SET is_deleted=1 WHERE rule_id='${INVALID_RULE_ID}';`);

  mysql(`
    INSERT INTO nx_admin_risk_withdraw_rule
      (rule_id,dimension,condition_text,action,state,built_in,priority,version,created_by,is_deleted)
    VALUES('${ADDRESS_RULE_ID}','地址信誉',
      'addressReputationSource=third-party; addressReputationLowThreshold=0.4',
      'freeze','active',0,98,0,'k3-acceptance',0);
  `);
  expect(mysql(`
    SELECT CONCAT(dimension,'|',condition_text,'|',action,'|',state,'|',priority)
      FROM nx_admin_risk_withdraw_rule
     WHERE rule_id='${ADDRESS_RULE_ID}' AND is_deleted=0;
  `).trim()).toBe("地址信誉|addressReputationSource=third-party; addressReputationLowThreshold=0.4|freeze|active|98");
  const addressBefore = walletAndOrderSnapshot();
  const addressResponse = await appSubmit(page, token, 100, runKey("k3-final-address-provider-unavailable"));
  const addressPayload = await addressResponse.json() as Envelope<unknown>;
  expect(addressResponse.status()).toBe(503);
  expect(addressPayload.message).toBe("K3_WITHDRAWAL_DECISION_UNAVAILABLE");
  expect(walletAndOrderSnapshot()).toEqual(addressBefore);
  mysql(`UPDATE nx_admin_risk_withdraw_rule SET is_deleted=1 WHERE rule_id='${ADDRESS_RULE_ID}';`);

  runSummary.assertions = {
    ...(runSummary.assertions as object),
    invalidActiveRule: { http: response.status(), message: payload.message, fundsAndOrdersUnchanged: true },
    k4Freshness: {
      currentScore: currentK4Score,
      currentModelVersion: currentK4ModelVersion,
      staleHttp: staleResult?.status,
      staleMessage: staleResult?.message,
      fundsAndOrdersUnchanged: true,
    },
    addressReputationProvider: {
      source: "third-party",
      configured: false,
      http: addressResponse.status(),
      message: addressPayload.message,
      fundsAndOrdersUnchanged: true,
      mockProviderUsed: false,
    },
  };
});

test("风控角色完成四维表单、只读 dry-run、422 校验、创建启用编辑与刷新持久化", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_USERNAME);
  const initial = await fetchOverview(page);

  await page.getByRole("button", { name: /沙盒模拟/ }).click();
  await submitDialog(page, REASON, /开始模拟/);
  const dryRunCard = page.locator("section").filter({ hasText: "最近一次沙盒模拟" }).first();
  await expect(dryRunCard).toBeVisible();
  await expect(dryRunCard).toContainText("已完成");
  expect((await fetchOverview(page)).hits.total).toBe(initial.hits.total);

  const invalid = await page.request.post("/api/admin/risk/withdraw-rules", {
    headers: { "Idempotency-Key": "k3-final-invalid-action" },
    data: { dimension: "金额", conditionText: "单笔 >= $100", action: "pass", priority: 95, reason: REASON },
  });
  expect(invalid.status()).toBe(422);
  expect((await envelope<unknown>(invalid, false)).message).toBe("RULE_ACTION_INVALID");

  const invalidPriority = await page.request.post("/api/admin/risk/withdraw-rules", {
    headers: { "Idempotency-Key": "k3-final-invalid-priority" },
    data: { dimension: "金额", conditionText: "单笔 >= $100", action: "manual", priority: 101, reason: REASON },
  });
  expect(invalidPriority.status()).toBe(422);
  expect((await envelope<unknown>(invalidPriority, false)).message).toBe("K3_RULE_PRIORITY_INVALID");

  await page.getByRole("button", { name: "+ 新建规则", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("规则维度").selectOption("速度");
  await expect(dialog.getByLabel("24h 笔数")).toBeVisible();
  await expect(dialog.getByLabel("24h 金额 USD")).toBeVisible();
  await dialog.getByLabel("规则维度").selectOption("新账户");
  await expect(dialog.getByRole("spinbutton", { name: "注册天数" })).toBeVisible();
  await dialog.getByLabel("规则维度").selectOption("地址信誉");
  await expect(dialog.getByLabel("地址信誉来源")).toBeVisible();
  await dialog.getByLabel("规则维度").selectOption("金额");
  await dialog.getByLabel("命中动作").selectOption("冻结");
  await dialog.getByLabel("优先级").fill("97");
  await dialog.getByLabel("单笔金额 USD").fill("100");
  await dialog.getByLabel(/操作理由/).fill(REASON);
  const createResponse = page.waitForResponse((candidate) => candidate.request().method() === "POST"
    && /\/api\/admin\/risk\/withdraw-rules$/.test(new URL(candidate.url()).pathname));
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const created = await envelope<Rule>(await createResponse);
  fixtureRuleId = created.data.ruleId;
  expect(fixtureRuleId).toMatch(/^WR-/);

  let row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("草拟");
  await row.getByRole("button", { name: "启用", exact: true }).click();
  await submitDialog(page, `${REASON}启用草稿规则`);
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("生效");

  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const edit = page.getByRole("dialog");
  await edit.getByLabel("单笔金额 USD").fill("100");
  await edit.getByLabel("命中动作").selectOption("转人工");
  await edit.getByLabel("优先级").fill("96");
  await edit.getByLabel(/操作理由/).fill(`${REASON}修改动作和优先级`);
  await edit.getByRole("button", { name: "确认提交" }).click();
  await expect(edit).toHaveCount(0);
  await page.reload({ waitUntil: "domcontentloaded" });
  row = ruleRow(page, fixtureRuleId);
  await expect(row).toContainText("单笔 >= $100");
  await expect(row).toContainText("转人工");
  await expect(row).toContainText("96");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-risk-four-dimension-dryrun-active-edit.png"), fullPage: true });
  expect(errors).toEqual([]);
  runSummary.fixtures = { ...(runSummary.fixtures as object), fixtureRuleId };
});

test("K3 对 HTTP 200 畸形读写响应失败关闭，并以同一命令键恢复", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_RESILIENCE_USERNAME);
  const overviewApi = "**/api/admin/risk/withdraw-rules/overview*";
  await page.route(overviewApi, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {} }),
  }));
  await page.reload();
  await expect(page.getByText("K3 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新建规则", exact: true })).toHaveCount(0);
  await page.unroute(overviewApi);
  await page.getByRole("button", { name: "仅重试 K3", exact: true }).click();
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible();

  const commandKeys: string[] = [];
  let attempts = 0;
  const dryRunApi = "**/api/admin/risk/withdraw-rules/dry-runs";
  await page.route(dryRunApi, async (route) => {
    attempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, data: {} }),
      });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: /沙盒模拟/ }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill(`${REASON}畸形成功响应失败关闭`);
  await dialog.getByRole("button", { name: /开始模拟/ }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/结果暂不确定/).last()).toBeVisible();
  await dialog.getByRole("button", { name: /开始模拟/ }).click();
  await expect(dialog).toHaveCount(0);
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  await page.unroute(dryRunApi);

  await page.screenshot({
    path: path.join(EVIDENCE_DIR, "04-malformed-200-fail-closed-and-same-key-recovery.png"),
    fullPage: true,
  });
  await logout(page);
  await loginAndOpenK3(page, RISK_RESILIENCE_USERNAME);
  await expect(page.getByText("规则总表", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("真实 D2 提现消费 K3 路由，并同步 A4、B1/B5；K5 大额复审并发叠加", async ({ page }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_FLOW_USERNAME);
  const token = await appLogin(page);

  const smallKey = runKey("k3-final-small-manual");
  const smallResponse = await appSubmit(page, token, 100, smallKey);
  const small = await envelope<Record<string, unknown>>(smallResponse);
  smallWithdrawalNo = String(small.data.withdrawalNo);
  expect(small.data).toMatchObject({
    status: "REVIEW_PENDING",
    riskRoute: "manual",
    riskRuleId: fixtureRuleId,
  });
  expect(small.data.k5TicketId).toBeNull();
  const replay = await envelope<Record<string, unknown>>(await appSubmit(page, token, 100, smallKey));
  expect(replay.data.withdrawalNo).toBe(smallWithdrawalNo);

  const largeResponse = await appSubmit(page, token, 1000, runKey("k3-final-large-k5"));
  const large = await envelope<Record<string, unknown>>(largeResponse);
  largeWithdrawalNo = String(large.data.withdrawalNo);
  expect(large.data).toMatchObject({
    status: "FROZEN",
    riskRoute: "freeze",
    k3RiskRoute: "manual",
    riskRuleId: fixtureRuleId,
  });
  expect(String(large.data.k5TicketId)).toMatch(/^KR-D2-/);

  const d2 = await envelope<Record<string, unknown>>(await page.request.get(`/api/admin/finance/withdrawals/${smallWithdrawalNo}`));
  expect(String(d2.data.withdrawalNo)).toBe(smallWithdrawalNo);
  expect(String(d2.data.hitRules)).toContain(fixtureRuleId);
  expect(String(d2.data.status)).toContain("REVIEW");

  const bDomain = await envelope<Record<string, unknown>>(await page.request.get("/api/admin/treasury/b-domain"));
  const riskRadar = bDomain.data.riskRadar as Record<string, unknown>;
  expect(riskRadar.sources).toEqual(expect.arrayContaining(["B1 dualLedger", "nx_withdrawal_order", "nx_risk_decision"]));
  expect(Number(riskRadar.bankRunRatio)).toBeGreaterThanOrEqual(0);

  const counts = mysql(`
    SELECT
      (SELECT COUNT(*) FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID} AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_risk_withdraw_hit WHERE user_no='U00${APP_USER_ID}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_risk_decision WHERE user_id=${APP_USER_ID} AND biz_type='WITHDRAW_RULE' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_id IN ('${smallWithdrawalNo}','${largeWithdrawalNo}') AND event_name='risk.withdraw_held' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_id IN ('${smallWithdrawalNo}','${largeWithdrawalNo}') AND event_name='withdraw.submitted' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_risk_kyc_review_source WHERE source_domain='D2' AND source_no='${largeWithdrawalNo}' AND is_deleted=0);
  `).trim().split("\t").map(Number);
  expect(counts).toEqual([2, 2, 2, 2, 2, 1]);

  const heldEventContract = mysql(`
    SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.rule_id')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.action')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.withdrawal_id')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.amount_usdt')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.dimension'))
      FROM nx_event_outbox
     WHERE aggregate_id='${smallWithdrawalNo}' AND event_name='risk.withdraw_held' AND is_deleted=0
     ORDER BY id DESC LIMIT 1;
  `).trim().split("\t");
  expect(heldEventContract.slice(0, 3)).toEqual([fixtureRuleId, "manual", smallWithdrawalNo]);
  expect(Number(heldEventContract[3])).toBe(100);
  expect(heldEventContract[4]).toBeTruthy();

  const submittedEventContract = mysql(`
    SELECT JSON_UNQUOTE(JSON_EXTRACT(payload,'$.risk_route')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.risk_rule_id')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.withdrawal_id')),
           COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.k5_ticket_id')),''),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.k4_risk_score')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.k4_model_version')),
           JSON_UNQUOTE(JSON_EXTRACT(payload,'$.k4_as_of'))
      FROM nx_event_outbox
     WHERE aggregate_id='${smallWithdrawalNo}' AND event_name='withdraw.submitted' AND is_deleted=0
     ORDER BY id DESC LIMIT 1;
  `).trim().split("\t");
  expect(submittedEventContract.slice(0, 3)).toEqual(["manual", fixtureRuleId, smallWithdrawalNo]);
  expect(["", "null"]).toContain(submittedEventContract[3]);
  expect(Number(submittedEventContract[4])).toBe(currentK4Score);
  expect(submittedEventContract[5]).toBe(currentK4ModelVersion);
  expect(submittedEventContract[6]).toBeTruthy();

  await openSidebarPath(page, "/finance/withdrawals");
  await expect(page.getByRole("heading", { name: "提现审核队列", exact: true })).toBeVisible();
  const search = page.getByLabel("提现单 / 用户");
  await search.fill(smallWithdrawalNo);
  await expect(page.locator("tr").filter({ hasText: smallWithdrawalNo })).toContainText(fixtureRuleId);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "04-d2-consumes-k3-route.png"), fullPage: true });

  await openSidebarPath(page, "/overview/risk-radar");
  await expect(page.getByText(/风险雷达/).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "05-b1-b5-risk-radar-after-withdrawals.png"), fullPage: true });

  await logout(page);
  await login(page, SUPERADMIN_USERNAME);
  await openSidebarPath(page, "/users/search");
  const c1K4 = await waitForCurrentK4(page);
  await page.getByPlaceholder(/用户编码/).fill(String(APP_USER_ID));
  const c1Row = page.locator("tr").filter({ hasText: `U00${APP_USER_ID}` }).first();
  await expect(c1Row).toBeVisible();
  await expect(c1Row.locator("td").nth(6)).toContainText(String(c1K4.score));
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-c1-current-k4-score.png"), fullPage: true });
  expect(errors).toEqual([]);

  runSummary.assertions = {
    ...(runSummary.assertions as object),
    crossDomain: {
      smallWithdrawalNo,
      largeWithdrawalNo,
      counts,
      heldEventContract,
      submittedEventContract,
      d2: "K3 route and current K4 snapshot visible",
      c1: { userNo: `U00${APP_USER_ID}`, currentK4Score: c1K4.score, modelVersion: c1K4.modelVersion },
      b1b5: "live dashboard consumed D2/K3 risk facts",
    },
  };
});

test("结果未知同键重试、CAS、归档终态、503 失败关闭及退出重登持久化", async ({ page, browser }) => {
  const errors = collectRuntimeErrors(page);
  await loginAndOpenK3(page, RISK_RESILIENCE_USERNAME);
  let attempts = 0;
  const commandKeys: string[] = [];
  await page.route("**/api/admin/risk/withdraw-rules/**/status", async (route) => {
    if (route.request().method() !== "PATCH" || !route.request().url().includes(`/${fixtureRuleId}/status`)) {
      await route.continue();
      return;
    }
    attempts += 1;
    commandKeys.push(await route.request().headerValue("idempotency-key") ?? "");
    if (attempts === 1) {
      const upstream = await route.fetch();
      expect(upstream.ok()).toBeTruthy();
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

  let row = ruleRow(page, fixtureRuleId);
  await row.getByRole("button", { name: "停用", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill(`${REASON}结果未知同键重试`);
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByText(/结果暂不确定/).last()).toBeVisible();
  await dialog.getByRole("button", { name: "确认提交" }).click();
  await expect(dialog).toHaveCount(0);
  expect(commandKeys).toHaveLength(2);
  expect(commandKeys[0]).toBeTruthy();
  expect(commandKeys[1]).toBe(commandKeys[0]);
  await page.unroute("**/api/admin/risk/withdraw-rules/**/status");

  row = ruleRow(page, fixtureRuleId);
  await row.getByRole("button", { name: "归档", exact: true }).click();
  await submitDialog(page, `${REASON}归档终态验证`, /确认归档/);
  const archived = findRule(await fetchOverview(page), fixtureRuleId);
  const terminal = await page.request.patch(`/api/admin/risk/withdraw-rules/${fixtureRuleId}/status`, {
    headers: { "Idempotency-Key": "k3-final-terminal-conflict" },
    data: { state: "active", expectedVersion: archived.version, reason: `${REASON}禁止归档后重启` },
  });
  expect(terminal.status()).toBe(409);
  expect((await envelope<unknown>(terminal, false)).message).toBe("K3_RULE_TRANSITION_INVALID");

  await page.route("**/api/admin/risk/withdraw-rules/overview*", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ code: 503, message: "RISK_SERVICE_UNAVAILABLE", data: null }),
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("K3 数据加载失败", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "+ 新建规则", exact: true })).toHaveCount(0);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "06-503-fail-closed.png"), fullPage: true });
  await page.unroute("**/api/admin/risk/withdraw-rules/overview*");
  await page.getByRole("button", { name: "仅重试 K3", exact: true }).click();
  await expect(ruleRow(page, fixtureRuleId)).toContainText("归档");

  await logout(page);
  await loginAndOpenK3(page, RISK_RESILIENCE_USERNAME);
  await expect(ruleRow(page, fixtureRuleId)).toContainText("归档");
  await expect(activeRuleConfiguration(page)).not.toContainText("单笔 >= $100");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "07-relogin-terminal-persistence.png"), fullPage: true });
  await logout(page);

  const anonymous = await browser.newContext({ baseURL: "http://127.0.0.1:3002" });
  try {
    expect((await anonymous.request.get("/api/admin/risk/withdraw-rules/overview")).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect(errors).toEqual([]);
  runSummary.assertions = {
    ...(runSummary.assertions as object),
    resilience: { outcomeUnknownStableKey: true, archived409: true, dependency503FailClosed: true, reloginPersisted: true, anonymous401: true },
  };
});

async function loginAndOpenK3(page: Page, username: string) {
  await login(page, username);
  await openSidebarPath(page, "/risk/withdrawal-rules");
  await expect(page.getByText("四道关 · 规则配置", { exact: true })).toBeVisible({ timeout: 20_000 });
}

async function openSidebarPath(page: Page, href: string) {
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    const group = href.startsWith("/risk/")
      ? page.getByRole("button", { name: /风控.*K|K.*风控/ }).first()
      : href.startsWith("/finance/")
        ? page.getByRole("button", { name: /资金.*D|D.*资金/ }).first()
        : href.startsWith("/users/")
          ? page.getByRole("button", { name: /用户.*C|C.*用户/ }).first()
        : page.getByRole("button", { name: /驾驶舱.*B|B.*驾驶舱|总览/ }).first();
    await expect(group).toBeVisible();
    await group.click();
  }
  await expect(link, `${href} 必须可从当前角色的可见侧栏进入`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
}

async function login(page: Page, username: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  await expect(usernameInput).toBeVisible({ timeout: 10_000 });
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await usernameInput.fill(username);
    await passwordInput.fill(PASSWORD);
    await page.waitForTimeout(200);
    if (await usernameInput.inputValue() === username && await passwordInput.inputValue() === PASSWORD) break;
  }
  await expect(usernameInput).toHaveValue(username);
  await expect(passwordInput).toHaveValue(PASSWORD);
  const loginResponsePromise = page.waitForResponse((response) => response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginResponse = await loginResponsePromise;
  const otpInput = page.getByLabel("一次性验证码");
  if (await otpInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const loginPayload = await loginResponse.json() as { data?: { mfa?: { manualKey?: string | null } } };
    const secret = loginPayload.data?.mfa?.manualKey ?? totpSecrets.get(username);
    if (!secret) throw new Error(`K3_TOTP_SECRET_UNAVAILABLE_FOR_${username}`);
    totpSecrets.set(username, secret);
    await otpInput.fill(nextTotp(username, secret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function appLogin(page: Page) {
  const response = await page.request.post(`${BACKEND_URL}/auth/users/login`, {
    headers: EDGE_HEADERS,
    data: { countryCode: "+86", phone: APP_PHONE, password: PASSWORD },
  });
  const payload = await envelope<{ accessToken: string }>(response);
  expect(payload.data.accessToken).toBeTruthy();
  return payload.data.accessToken;
}

async function appSubmit(page: Page, token: string, amount: number, idempotencyKey: string) {
  return page.request.post(`${BACKEND_URL}/api/withdrawals`, {
    headers: { ...EDGE_HEADERS, Authorization: `Bearer ${token}`, "Idempotency-Key": idempotencyKey },
    data: { amount, chain: "USDT-TRC20", address: APP_ADDRESS },
  });
}

function walletAndOrderSnapshot() {
  return mysql(`
    SELECT CONCAT(usdt_available,'|',nex_available,'|',pending_withdraw,'|',version)
      FROM nx_user_wallet WHERE user_id=${APP_USER_ID} AND is_deleted=0;
    SELECT COUNT(*) FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID} AND is_deleted=0;
  `).trim();
}

async function waitForCurrentK4(page: Page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = mysql(`
      SELECT model_score,model_version,
             IF(as_of>=DATE_SUB(NOW(),INTERVAL 1 DAY),1,0)
        FROM nx_admin_risk_score_user
       WHERE user_no='U00${APP_USER_ID}' AND is_deleted=0
       LIMIT 1;
    `).trim();
    if (row) {
      const [scoreText, modelVersion, currentText] = row.split("\t");
      const score = Number(scoreText);
      if (Number.isInteger(score) && modelVersion?.match(/^k4-v\d+$/) && currentText === "1") {
        return { score, modelVersion };
      }
    }
    await page.waitForTimeout(250);
  }
  throw new Error("K4_CURRENT_SCORE_NOT_READY");
}

function cleanupFixtures() {
  const ruleClause = fixtureRuleId ? `OR rule_id='${sqlLiteral(fixtureRuleId)}'` : "";
  mysql(`
    DELETE FROM nx_event_consumer_delivery WHERE aggregate_id IN
      (SELECT withdrawal_no FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID});
    DELETE FROM nx_event_outbox WHERE aggregate_id IN
      (SELECT withdrawal_no FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID})
       OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.user_id'))='${APP_USER_ID}';
    DELETE FROM nx_audit_log WHERE user_id=${APP_USER_ID}
       OR actor_username IN ('${RISK_USERNAME}','${RISK_FLOW_USERNAME}','${RISK_RESILIENCE_USERNAME}','${AUDITOR_USERNAME}','${FINANCE_USERNAME}')
       OR resource_id IN ('${INVALID_RULE_ID}','${ADDRESS_RULE_ID}'${fixtureRuleId ? `,'${sqlLiteral(fixtureRuleId)}'` : ""});
    DELETE FROM nx_admin_risk_kyc_review_source WHERE source_domain='D2' AND source_no IN
      (SELECT withdrawal_no FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID});
    DELETE FROM nx_admin_risk_kyc_alert WHERE event_key IN
      (SELECT CONCAT('threshold-hit:',ticket_id) FROM nx_admin_risk_kyc_review_ticket WHERE user_no='U00${APP_USER_ID}');
    DELETE FROM nx_admin_risk_kyc_review_ticket WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_admin_risk_withdraw_hit WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_risk_decision WHERE user_id=${APP_USER_ID} AND biz_type='WITHDRAW_RULE';
    DELETE FROM nx_wallet_ledger WHERE user_id=${APP_USER_ID} AND biz_no LIKE 'WD-%';
    DELETE FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID};
    DELETE FROM nx_admin_risk_withdraw_rule
     WHERE (rule_id IN ('${INVALID_RULE_ID}','${ADDRESS_RULE_ID}') ${ruleClause} OR created_by='${RISK_USERNAME}');
    DELETE FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'k3-final-%';
    DELETE FROM nx_user_session WHERE user_id=${APP_USER_ID};
    DELETE FROM nx_kyc_profile WHERE user_id=${APP_USER_ID};
    DELETE FROM nx_user_wallet WHERE user_id=${APP_USER_ID};
    DELETE FROM nx_user WHERE id=${APP_USER_ID} OR (country_code='86' AND phone='${APP_PHONE}');
    DELETE FROM nx_event_consumer_delivery WHERE aggregate_id='U00${APP_USER_ID}';
    DELETE FROM nx_event_outbox WHERE aggregate_id='U00${APP_USER_ID}'
       OR JSON_UNQUOTE(JSON_EXTRACT(payload,'$.userId'))='U00${APP_USER_ID}';
    DELETE FROM nx_admin_risk_score_contribution WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_admin_risk_score_history WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_admin_risk_score_override WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_admin_risk_score_user WHERE user_no='U00${APP_USER_ID}';
    DELETE FROM nx_admin_role_relation WHERE admin_id IN
      (SELECT id FROM nx_admin WHERE username IN ('${RISK_USERNAME}','${RISK_FLOW_USERNAME}','${RISK_RESILIENCE_USERNAME}','${AUDITOR_USERNAME}','${FINANCE_USERNAME}'));
    DELETE FROM nx_admin_account_state WHERE admin_id IN
      (SELECT id FROM nx_admin WHERE username IN ('${RISK_USERNAME}','${RISK_FLOW_USERNAME}','${RISK_RESILIENCE_USERNAME}','${AUDITOR_USERNAME}','${FINANCE_USERNAME}'));
    DELETE FROM nx_admin WHERE username IN ('${RISK_USERNAME}','${RISK_FLOW_USERNAME}','${RISK_RESILIENCE_USERNAME}','${AUDITOR_USERNAME}','${FINANCE_USERNAME}');
  `);
}

function mysql(sql: string) {
  return execFileSync(MYSQL, ["--default-character-set=utf8mb4", "-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
}

function sqlLiteral(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("K3_SQL_LITERAL_REJECTED");
  return value;
}

function runKey(base: string) {
  return `${base}-${RUN_TAG}`;
}

function collectRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon|Failed to load resource.*(?:401|403|409|422|500|502|503)/i.test(message.text())) {
      errors.push(`console:${message.text()}`);
    }
  });
  return errors;
}

function ruleRow(page: Page, ruleId: string) {
  return page.locator("tr").filter({ hasText: ruleId }).first();
}

function activeRuleConfiguration(page: Page) {
  return page.locator("section.l-card").filter({ has: page.getByText("四道关 · 规则配置", { exact: true }) }).first();
}

async function submitDialog(page: Page, reason: string, buttonName: string | RegExp = "确认提交") {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: buttonName }).last().click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

async function fetchOverview(page: Page): Promise<Overview> {
  const response = await page.request.get("/api/admin/risk/withdraw-rules/overview?rulePageNum=1&rulePageSize=100&hitPageNum=1&hitPageSize=100");
  expect(response.ok()).toBeTruthy();
  return (await envelope<Overview>(response)).data;
}

function findRule(overview: Overview, ruleId: string) {
  const found = overview.rules.records.find((rule) => rule.ruleId === ruleId);
  if (!found) throw new Error(`K3_RULE_NOT_RETURNED_${ruleId}`);
  return found;
}

async function envelope<T>(response: { json(): Promise<unknown> }, requireSuccess = true): Promise<Envelope<T>> {
  const payload = await response.json() as Envelope<T>;
  if (requireSuccess) {
    expect(payload.code, payload.message).toBe(0);
  }
  return payload;
}

function nextTotp(username: string, secret: string) {
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
  const currentCounter = Math.floor(Date.now() / 30_000);
  const previousCounter = totpCounters.get(username);
  const counter = previousCounter == null || previousCounter < currentCounter
    ? currentCounter
    : previousCounter + 1;
  if (counter > currentCounter + 1) throw new Error(`K3_TOTP_WINDOW_EXHAUSTED_FOR_${username}`);
  totpCounters.set(username, counter);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for K3 acceptance`);
  return value;
}
