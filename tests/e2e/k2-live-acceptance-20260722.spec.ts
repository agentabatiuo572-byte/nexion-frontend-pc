import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.ADMIN_BASE_URL || "http://127.0.0.1:3002";
const BACKEND_URL = process.env.K2_BACKEND_URL || "http://127.0.0.1:8110";
const ADMIN_PASSWORD = process.env.NEXION_ADMIN_PASSWORD || "";
const ADMIN_USERNAME = process.env.K2_ADMIN_USERNAME || "superadmin";
const DB_PASSWORD = process.env.K2_DB_PASSWORD || "";
const DB_NAME = process.env.K2_DB_NAME || "nexion";
const USER_JWT_SECRET = process.env.K2_USER_JWT_SECRET || "nexion-development-secret-key-change-me-please";
const MYSQL_EXE = process.env.MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const EVIDENCE_DIR = process.env.K2_ACCEPTANCE_EVIDENCE_DIR
  || "D:/workspace/bug-pic/k-domain-acceptance-20260722/k2/initial";
const RUN_ID = process.env.K2_ACCEPTANCE_RUN_ID || `K2-${Date.now()}`;
const SUFFIX = RUN_ID.replace(/\D/g, "").slice(-7).padStart(7, "0");
const USER_ID = Number(`8${SUFFIX}`);
const NEGATIVE_USER_ID = USER_ID + 1;
const PENDING_USER_ID = USER_ID + 2;
const USER_NO = `U${String(USER_ID).padStart(8, "0")}`;
const CLUSTER_ID = `K2ACC${SUFFIX}`;
const H8_CLUSTER_ID = `K2H8${SUFFIX}`;
const clusterProjectionRowId = (prefix: "K2-H2-C" | "K2-GIFT-C", clusterId: string) =>
  `${prefix}${createHash("sha256").update(clusterId).digest("hex").slice(0, 40)}`;
const H2_PROJECTION_ROW_ID = clusterProjectionRowId("K2-H2-C", CLUSTER_ID);
const GIFT_PROJECTION_ROW_IDS = [
  clusterProjectionRowId("K2-GIFT-C", CLUSTER_ID),
  clusterProjectionRowId("K2-GIFT-C", H8_CLUSTER_ID),
];
const USER_SESSION_ID = `K2ACC-${SUFFIX}-USER-SESSION`;
let idempotencyBaseline = 0;
let ticketBaseline = 0;
const summary: any = { runId: RUN_ID, tests: [] };
const ROWS = {
  trial: `K2-ACC-${SUFFIX}-TRIAL`,
  permission: `K2-ACC-${SUFFIX}-PERM`,
  gift: `K2-ACC-${SUFFIX}-GIFT`,
  board: `K2-ACC-${SUFFIX}-BOARD`,
  tradein: `K2-E3-U${USER_ID}`,
};
const MFA_SECRETS = new Map<string, string>();
if (process.env.K2_ADMIN_TOTP_SECRET) MFA_SECRETS.set(ADMIN_USERNAME, process.env.K2_ADMIN_TOTP_SECRET);
const CHECKER_USERNAME = process.env.K2_CHECKER_USERNAME || "";
const CHECKER_PASSWORD = process.env.K2_CHECKER_PASSWORD || "";
if (CHECKER_USERNAME && process.env.K2_CHECKER_TOTP_SECRET) {
  MFA_SECRETS.set(CHECKER_USERNAME, process.env.K2_CHECKER_TOTP_SECRET);
}
const READONLY_USERNAME = process.env.K2_READONLY_USERNAME || "";
const READONLY_PASSWORD = process.env.K2_READONLY_PASSWORD || "";
const NOWRITE_USERNAME = process.env.K2_NOWRITE_USERNAME || "";
const NOWRITE_PASSWORD = process.env.K2_NOWRITE_PASSWORD || "";
const NOMENU_USERNAME = process.env.K2_NOMENU_USERNAME || "";
const NOMENU_PASSWORD = process.env.K2_NOMENU_PASSWORD || "";
const CROSS_DOMAIN_USERNAME = process.env.K2_CROSS_DOMAIN_USERNAME || "";
const CROSS_DOMAIN_PASSWORD = process.env.K2_CROSS_DOMAIN_PASSWORD || "";
for (const [username, secret] of [
  [READONLY_USERNAME, process.env.K2_READONLY_TOTP_SECRET],
  [NOWRITE_USERNAME, process.env.K2_NOWRITE_TOTP_SECRET],
  [NOMENU_USERNAME, process.env.K2_NOMENU_TOTP_SECRET],
  [CROSS_DOMAIN_USERNAME, process.env.K2_CROSS_DOMAIN_TOTP_SECRET],
] as const) {
  if (username && secret) MFA_SECRETS.set(username, secret);
}

if (!ADMIN_PASSWORD) throw new Error("NEXION_ADMIN_PASSWORD is required");
if (!DB_PASSWORD) throw new Error("K2_DB_PASSWORD is required");
for (const [name, value] of Object.entries({
  CHECKER_USERNAME,
  CHECKER_PASSWORD,
  READONLY_USERNAME,
  READONLY_PASSWORD,
  NOWRITE_USERNAME,
  NOWRITE_PASSWORD,
  NOMENU_USERNAME,
  NOMENU_PASSWORD,
  CROSS_DOMAIN_USERNAME,
  CROSS_DOMAIN_PASSWORD,
})) {
  if (!value) throw new Error(`${name} is required for K2 final acceptance`);
}
mkdirSync(EVIDENCE_DIR, { recursive: true });
test.use({ trace: "on", video: "on" });

function mysql(sql: string) {
  const result = spawnSync(MYSQL_EXE, ["-uroot", "-D", DB_NAME, "--batch", "--raw", "--skip-column-names", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  });
  if (result.status !== 0) throw new Error(`MYSQL_FAILED: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function waitForMysqlCountAtLeast(sql: string, minimum: number, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  let count = Number(mysql(sql));
  while (count < minimum && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    count = Number(mysql(sql));
  }
  return count;
}

function fixtureTradeins(userId: number, status: string, prefix: string) {
  return [1, 2, 3].map((index) => `(
    '${prefix}-${index}',${userId},${userId * 10 + index},'${prefix}-DEV-${index}',1,'StellarBox S1','S1',2,'StellarBox Pro','PRO',
    0,1.000000,100,300,0,75,225,'${status}','${RUN_ID}','k2-accept',NOW(),NOW(),'${prefix}-IDEM-${index}',
    10,10,75,225,'${prefix}-ORDER-${index}',${userId * 100 + index},${status === "COMPLETED" ? "NOW()" : "NULL"},NOW(),NOW(),0
  )`).join(",");
}

function setupFixtures() {
  idempotencyBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_admin_idempotency_record;"));
  ticketBaseline = Number(mysql("SELECT COALESCE(MAX(id),0) FROM nx_audit_operation_ticket;"));
  cleanupFixtures();
  mysql(`
    INSERT INTO nx_user (id,country_code,phone,password_hash,nickname,referral_code,sponsor_user_id,kyc_status,user_level,v_rank,status,language,created_at,updated_at,is_deleted)
    VALUES
      (${USER_ID},'+84','90${SUFFIX}','K2_ACCEPTANCE_ONLY','K2验收邀请人','K2${SUFFIX}A',NULL,'VERIFIED','L1','V0','ACTIVE','zh-CN',NOW(),NOW(),0),
      (${NEGATIVE_USER_ID},'+84','91${SUFFIX}','K2_ACCEPTANCE_ONLY','K2验收待奖励新人','K2${SUFFIX}B',${USER_ID},'VERIFIED','L1','V0','ACTIVE','zh-CN',NOW(),NOW(),0),
      (${PENDING_USER_ID},'+84','92${SUFFIX}','K2_ACCEPTANCE_ONLY','K2验收反事实用户','K2${SUFFIX}C',${NEGATIVE_USER_ID},'VERIFIED','L1','V0','ACTIVE','zh-CN',NOW(),NOW(),0);
    INSERT INTO nx_admin_risk_multi_account_cluster
      (cluster_id,dedupe_key,layer_key,layer_label,account_count,strength,span_text,status,note_text,gifts_json,nodes_json,edges_json,projection_fingerprint,threshold_hit,version,created_at,updated_at,is_deleted)
    VALUES
      ('${CLUSTER_ID}','${RUN_ID}','device','设备指纹',1,0.9900,'K2验收','flagged','${RUN_ID}','[]','[{"userNo":"${USER_NO}","label":"K2验收用户"}]','[]','${RUN_ID}',1,0,NOW(),NOW(),0),
      ('${H8_CLUSTER_ID}','${RUN_ID}-H8','device','设备指纹',2,0.9700,'K2-H8验收','flagged','${RUN_ID}','[]','[{"userNo":"U${String(NEGATIVE_USER_ID).padStart(8, "0")}","label":"K2验收邀请人"},{"userNo":"U${String(PENDING_USER_ID).padStart(8, "0")}","label":"K2验收受邀人"}]','[]','${RUN_ID}-H8',1,0,NOW(),NOW(),0);
    INSERT INTO nx_admin_risk_arbitrage_row
      (row_id,view_key,cluster_id,cell1,cell2,cell3,cell4,cell5,cell6,level_value,actions_csv,disposition,version,created_at,updated_at,is_deleted)
    VALUES
      ('${ROWS.trial}','trial','${CLUSTER_ID}','${CLUSTER_ID}','4 次','1 个账户','$45 USDT',NULL,NULL,3,'flag,freeze',NULL,0,NOW(),NOW(),0),
      ('${ROWS.permission}','trial',NULL,'${USER_NO}','3 次','1 个账户','$20 USDT',NULL,NULL,2,'flag',NULL,0,NOW(),NOW(),0),
      ('${ROWS.gift}','gift','${H8_CLUSTER_ID}','${H8_CLUSTER_ID}','同一实体','3 笔 / 0 拦','$15 USDT','注册→领礼→离开',NULL,3,'blockgift,freeze',NULL,0,NOW(),NOW(),0),
      ('${ROWS.board}','board','${CLUSTER_ID}','${USER_NO}','$120 USDT','8x 基线','24 人','${CLUSTER_ID}',NULL,3,'boardflag,freeze',NULL,0,NOW(),NOW(),0);
    INSERT INTO nx_tradein_application
      (tradein_no,user_id,source_device_id,source_instance_no,source_product_id,source_product_name,source_product_tier,target_product_id,target_product_name,target_product_tier,months_owned,current_efficiency,source_price_usdt,target_price_usdt,salvage_value_usdt,tradein_discount_usdt,net_upgrade_cost_usdt,status,review_note,reviewer,submitted_at,reviewed_at,idempotency_key,cumulative_output_usdt,output_ratio_pct,credit_rate_pct,wallet_debit_usdt,target_order_no,target_device_id,completed_at,created_at,updated_at,is_deleted)
    VALUES ${fixtureTradeins(USER_ID, "COMPLETED", `K2ACC-${SUFFIX}-POS`)},${fixtureTradeins(NEGATIVE_USER_ID, "COMPLETED", `K2ACC-${SUFFIX}-NEG`)},${fixtureTradeins(PENDING_USER_ID, "PENDING", `K2ACC-${SUFFIX}-PEND`)};
    INSERT INTO nx_commission_event (user_id,commission_type,source_user_id,source_user_name,layer_no,order_no,order_amount_usd,amount_usdt,amount_nex,currency,status,remark,created_at,updated_at,is_deleted)
    VALUES (${USER_ID},'REFERRAL',NULL,'K2 fixture',1,'K2ACC-${SUFFIX}-COMM-POS',100,12,0,'USDT','PAID','${RUN_ID}',NOW(),NOW(),0),
           (${NEGATIVE_USER_ID},'REFERRAL',NULL,'K2 negative',1,'K2ACC-${SUFFIX}-COMM-NEG',100,-12,0,'USDT','PAID','${RUN_ID}',NOW(),NOW(),0);
    INSERT INTO nx_wallet_ledger (user_id,biz_no,biz_type,asset,direction,amount,balance_after,status,remark,created_at,updated_at,is_deleted)
    VALUES (${USER_ID},'K2ACC-${SUFFIX}-GIFT-POS','WELCOME_GIFT','USDT','IN',5,5,'POSTED','${RUN_ID}',NOW(),NOW(),0),
           (${NEGATIVE_USER_ID},'K2ACC-${SUFFIX}-GIFT-OUT','WELCOME_GIFT','USDT','OUT',5,0,'POSTED','${RUN_ID}',NOW(),NOW(),0),
           (${PENDING_USER_ID},'K2ACC-${SUFFIX}-GIFT-PEND','WELCOME_GIFT','USDT','IN',5,5,'POSTED','${RUN_ID}',NOW(),NOW(),0);
    INSERT INTO nx_user_session
      (user_id,refresh_token_id,session_chain_id,device_name,client_ip,expires_at,last_active_at,created_at,updated_at,is_deleted)
    VALUES (${USER_ID},'${USER_SESSION_ID}','${USER_SESSION_ID}','K2 acceptance browser','127.0.0.1',DATE_ADD(NOW(),INTERVAL 1 DAY),NOW(),NOW(),NOW(),0);
  `);
}

function cleanupFixtures() {
  mysql(`
    DELETE FROM nx_admin_risk_arbitrage_row
     WHERE row_id IN ('${ROWS.trial}','${ROWS.permission}','${ROWS.gift}','${ROWS.board}','${ROWS.tradein}',
                      'K2-E3-U${NEGATIVE_USER_ID}','K2-E3-U${PENDING_USER_ID}','K2-H2-U${USER_ID}',
                      '${H2_PROJECTION_ROW_ID}','${GIFT_PROJECTION_ROW_IDS[0]}','${GIFT_PROJECTION_ROW_IDS[1]}')
        OR row_id LIKE 'K2-LB-%-U${USER_ID}'
        OR row_id LIKE 'K2-LB-%-U${NEGATIVE_USER_ID}'
        OR row_id LIKE 'K2-LB-%-U${PENDING_USER_ID}';
    DELETE FROM nx_risk_k2_leaderboard_snapshot WHERE user_id IN (${USER_ID},${NEGATIVE_USER_ID},${PENDING_USER_ID});
    DELETE FROM nx_commission_event WHERE order_no LIKE 'K2ACC-${SUFFIX}-%';
    DELETE FROM nx_wallet_ledger WHERE biz_no LIKE 'K2ACC-${SUFFIX}-%';
    DELETE FROM nx_tradein_application WHERE tradein_no LIKE 'K2ACC-${SUFFIX}-%';
    DELETE FROM nx_trial_claim WHERE user_id=${USER_ID};
    DELETE FROM nx_user_session WHERE refresh_token_id='${USER_SESSION_ID}';
    DELETE FROM nx_risk_signal WHERE user_id IN (${USER_ID},${NEGATIVE_USER_ID},${PENDING_USER_ID});
    DELETE FROM nx_kyc_profile WHERE user_id IN (${USER_ID},${NEGATIVE_USER_ID},${PENDING_USER_ID});
    DELETE FROM nx_admin_risk_multi_account_cluster WHERE cluster_id IN ('${CLUSTER_ID}','${H8_CLUSTER_ID}');
    DELETE FROM nx_user WHERE id IN (${USER_ID},${NEGATIVE_USER_ID},${PENDING_USER_ID});
    DELETE FROM nx_admin_idempotency_record
     WHERE id>${idempotencyBaseline}
       AND (
         idempotency_key LIKE 'k2-${SUFFIX}-%'
         OR idempotency_key LIKE '${RUN_ID}%'
       );
  `);
}

async function rejectPendingK2(browser: import("@playwright/test").Browser) {
  const operationIds = mysql(`
    SELECT operation_id
      FROM nx_audit_operation_ticket
     WHERE id>${ticketBaseline}
       AND source_domain='K'
       AND operator_name='${ADMIN_USERNAME}'
       AND status='pending'
       AND is_deleted=0
     ORDER BY id;
  `).split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (operationIds.length === 0) return;
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, CHECKER_USERNAME, CHECKER_PASSWORD);
    for (const operationId of operationIds) {
      const rejected = await api(page, "POST", `/api/admin/platform/audit/operations/${operationId}/reject`, {
        reason: `${RUN_ID} RED或中断清理未执行提案`,
        operator: CHECKER_USERNAME,
      }, `${RUN_ID}-CLEANUP-${operationId}`);
      expect(rejected.status, rejected.raw).toBe(200);
    }
  } finally {
    await context.close();
  }
}

function verifyK2Cleanup() {
  const residual = mysql(`
    SELECT CONCAT(
      (SELECT COUNT(*) FROM nx_admin_risk_arbitrage_row
        WHERE row_id IN ('${ROWS.trial}','${ROWS.permission}','${ROWS.gift}','${ROWS.board}','${ROWS.tradein}',
                         'K2-E3-U${NEGATIVE_USER_ID}','K2-E3-U${PENDING_USER_ID}','K2-H2-U${USER_ID}',
                         '${H2_PROJECTION_ROW_ID}','${GIFT_PROJECTION_ROW_IDS[0]}','${GIFT_PROJECTION_ROW_IDS[1]}')
           OR row_id LIKE 'K2-LB-%-U${USER_ID}'
           OR row_id LIKE 'K2-LB-%-U${NEGATIVE_USER_ID}'
           OR row_id LIKE 'K2-LB-%-U${PENDING_USER_ID}'),',',
      (SELECT COUNT(*) FROM nx_user WHERE id IN (${USER_ID},${NEGATIVE_USER_ID},${PENDING_USER_ID})),',',
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE id>${idempotencyBaseline}
          AND (idempotency_key LIKE 'k2-${SUFFIX}-%' OR idempotency_key LIKE '${RUN_ID}%')),',',
      (SELECT COUNT(*) FROM nx_audit_object_lock l
        JOIN nx_audit_operation_ticket t ON t.operation_id=l.ticket_id
       WHERE t.id>${ticketBaseline} AND t.source_domain='K' AND t.operator_name='${ADMIN_USERNAME}'
         AND l.is_deleted=0)
    );
  `);
  expect(residual).toBe("0,0,0,0");
  summary.cleanup = { mutableResidual: residual, immutableAuditOutboxRetained: true };
}

function userJwt() {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: String(USER_ID),
    subjectType: "USER",
    username: USER_NO,
    authorities: [],
    sessionId: USER_SESSION_ID,
    iat: now,
    exp: now + 3600,
  });
  const signature = createHmac("sha256", USER_JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${signature}`;
}

async function produceTrialCycles(page: Page) {
  const headers = {
    Authorization: `Bearer ${userJwt()}`,
    "Content-Type": "application/json",
    // J2 only accepts country metadata from the configured trusted edge source.
    // Send both allow-listed source headers so this real producer walk-through remains
    // valid while operations transition between the Nexion gateway and Cloudflare.
    "X-Nexion-Edge-Country": "JP",
    "CF-IPCountry": "JP",
  };
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const started = await page.request.post(`${BACKEND_URL}/api/trial/start`, {
      headers: { ...headers, "Idempotency-Key": `k2-${SUFFIX}-trial-start-${cycle}` },
      data: { deviceName: `K2 acceptance trial ${cycle}` },
    });
    expect(started.status(), await started.text()).toBe(200);
    const cancelled = await page.request.post(`${BACKEND_URL}/api/trial/cancel`, {
      headers: { ...headers, "Idempotency-Key": `k2-${SUFFIX}-trial-cancel-${cycle}` },
      data: { reason: "explicit" },
    });
    expect(cancelled.status(), await cancelled.text()).toBe(200);
    if (cycle < 3) {
      mysql(`UPDATE nx_trial_claim SET cooldown_until=DATE_SUB(NOW(),INTERVAL 1 SECOND) WHERE user_id=${USER_ID};`);
    }
  }
  const authoritativeStarts = Number(mysql(`
    SELECT COUNT(*) FROM nx_event_outbox
     WHERE event_name='trial.started'
       AND is_server_authoritative=1
       AND schema_registered=1
       AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.user_id'))='${USER_ID}';
  `));
  expect(authoritativeStarts).toBe(3);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function login(page: Page, username = ADMIN_USERNAME, password = ADMIN_PASSWORD, changedPassword?: string) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle");
  const account = page.getByRole("textbox", { name: "账号", exact: true });
  const passwordBox = page.getByRole("textbox", { name: "密码", exact: true });
  await account.fill(username);
  await passwordBox.fill(password);
  await expect(account).toHaveValue(username);
  await expect(passwordBox).toHaveValue(password);
  const loginButton = page.getByRole("button", { name: /登录|继续/ });
  const submitLogin = async () => {
    const responsePromise = page.waitForResponse((response) =>
      response.url().endsWith("/api/admin/auth/login") && response.request().method() === "POST");
    await loginButton.click();
    return responsePromise;
  };
  let loginResponse = await submitLogin();
  if (loginResponse.status() === 503) {
    // The shared acceptance environment can briefly close its proxy while another
    // domain relinquishes the port. Exercise the user's explicit retry once, while
    // keeping every credential/authentication failure terminal.
    await page.waitForTimeout(500);
    loginResponse = await submitLogin();
  }
  expect(loginResponse.status()).toBeLessThan(500);
  for (let step = 0; step < 40; step += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) return;
    if (await page.getByRole("heading", { name: "双因素身份验证" }).isVisible().catch(() => false)) {
      const secretCode = page.locator("code");
      const displayedSecret = await secretCode.isVisible().catch(() => false)
        ? (await secretCode.textContent())?.trim()
        : undefined;
      if (displayedSecret) MFA_SECRETS.set(username, displayedSecret);
      const secret = displayedSecret || MFA_SECRETS.get(username);
      if (!secret) throw new Error(`MFA_SECRET_NOT_AVAILABLE_${username}`);
      const remainingMs = 30_000 - (Date.now() % 30_000);
      await page.waitForTimeout(remainingMs + 500);
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      const otpBox = page.getByLabel("一次性验证码");
      if (!await otpBox.isVisible().catch(() => false)) continue;
      await otpBox.fill(totp(secret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible().catch(() => false)) {
      if (!changedPassword) throw new Error(`PASSWORD_CHANGE_REQUIRED_${username}`);
      const newPassword = page.getByLabel("新密码", { exact: true });
      // Auth can finish redirecting while the prior step heading is still briefly visible.
      // Enter this branch only when the real form control is interactable.
      if (!await newPassword.isVisible().catch(() => false)) {
        await page.waitForTimeout(250);
        continue;
      }
      try {
        if (await newPassword.inputValue() !== changedPassword) {
          await newPassword.fill(changedPassword);
        }
      } catch (error) {
        // The successful password-change redirect may detach this React form while
        // Playwright is re-resolving the input. Treat only the visible app shell as
        // success; otherwise keep the original failure observable.
        if (await page.locator("aside").isVisible().catch(() => false)) return;
        throw error;
      }
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      const confirmPassword = page.getByLabel("确认新密码", { exact: true });
      if (!await confirmPassword.isVisible().catch(() => false)) {
        await page.waitForTimeout(250);
        continue;
      }
      try {
        if (await confirmPassword.inputValue() !== changedPassword) {
          await confirmPassword.fill(changedPassword);
        }
      } catch (error) {
        if (await page.locator("aside").isVisible().catch(() => false)) return;
        throw error;
      }
      if (await page.locator("aside").isVisible().catch(() => false)) return;
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click().catch(async (error) => {
        if (!await page.locator("aside").isVisible().catch(() => false)) throw error;
      });
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openK2(page: Page) {
  const link = page.locator('a[href="/risk/abuse"]').first();
  if (!await link.isVisible().catch(() => false)) await page.getByRole("button", { name: /风控与反作弊/ }).first().click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/risk\/abuse$/);
  await expect(page.getByRole("heading", { name: "套利 & 刷量检测", exact: true })).toBeVisible({ timeout: 20_000 });
}

async function openSidebarModule(page: Page, groupName: string, href: string) {
  const link = page.locator(`a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    await page.getByRole("button", { name: new RegExp(groupName) }).first().click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`), fullPage: true });
}

async function api(page: Page, method: string, url: string, data?: unknown, commandKey = `k2-${randomUUID()}`) {
  const response = await page.request.fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": commandKey },
    data,
  });
  const raw = await response.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch { /* raw evidence retained by caller */ }
  return { status: response.status(), raw, data: json?.data ?? json, commandKey };
}

async function confirmVisibleAction(page: Page, buttonName: RegExp, reason: string, responsePattern: RegExp) {
  await page.getByRole("button", { name: buttonName }).click();
  const dialog = page.locator('[role="dialog"]:visible').last();
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) => responsePattern.test(response.url()) && response.request().method() !== "GET");
  await dialog.getByRole("button", { name: /确认/ }).last().click();
  const response = await responsePromise;
  expect(response.status(), await response.text()).toBeLessThan(400);
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  return response;
}

async function createChecker(page: Page, browserPage: Page, purpose: "grant" | "freeze") {
  if (CHECKER_USERNAME && CHECKER_PASSWORD) {
    await login(browserPage, CHECKER_USERNAME, CHECKER_PASSWORD);
    return { username: CHECKER_USERNAME, password: CHECKER_PASSWORD, accountId: "" };
  }
  const username = `k2c${SUFFIX}${purpose}`;
  const initialPassword = `K2Checker@${SUFFIX}${purpose}aA!`;
  const password = `K2Checker@${SUFFIX}${purpose}bB!`;
  const created = await api(page, "POST", "/api/admin/platform/accounts", {
    username, displayName: `K2 Checker ${SUFFIX}`, email: `${username}@nexion.invalid`, role: "super", deliver: "handoff",
    initialPassword, reason: `${RUN_ID} 创建K2A2确认账号`, operator: "superadmin",
  });
  expect(created.status, created.raw).toBeLessThan(400);
  const accountId = String(created.data?.id ?? created.data?.accountId ?? "");
  const issuedPassword = String(created.data?.temporaryPassword ?? "");
  expect(issuedPassword, "A1 必须返回服务端生成的一次性密码").not.toBe("");
  try {
    await login(browserPage, username, issuedPassword, password);
  } catch (error) {
    // Account creation precedes the independent browser login. If the browser
    // path fails, close the privilege immediately instead of leaking an active
    // checker that the caller never received an id for.
    await cleanupAccount(page, accountId, `${RUN_ID} createChecker失败清理`);
    throw error;
  }
  return { username, password, accountId };
}

async function cleanupAccount(page: Page, accountId: string, reason: string) {
  if (!accountId) return;
  let current = await accountById(page, accountId);
  if (current.tfa === true) {
    const reset = await api(page, "POST", `/api/admin/platform/accounts/${accountId}/reset-2fa`, {
      expectedVersion: String(current.version), reason: `${reason} · 清除MFA`, operator: "superadmin",
    });
    expect(reset.status, reset.raw).toBeLessThan(400);
  }
  current = await accountById(page, accountId);
  if (current.role !== "unassigned") {
    const unassigned = await api(page, "PATCH", `/api/admin/platform/accounts/${accountId}/role`, {
      role: "unassigned", expectedVersion: String(current.version), reason, operator: "superadmin",
    });
    expect(unassigned.status, unassigned.raw).toBeLessThan(400);
  }
  current = await accountById(page, accountId);
  if (current.status !== "disabled") {
    const disabled = await api(page, "PATCH", `/api/admin/platform/accounts/${accountId}/status`, {
      status: "disabled", expectedVersion: String(current.version), reason, operator: "superadmin",
    });
    expect(disabled.status, disabled.raw).toBeLessThan(400);
  }
  current = await accountById(page, accountId);
  if (Number(current.sessions) > 0) {
    const revoked = await api(page, "POST", `/api/admin/platform/accounts/${accountId}/sessions/revoke`, {
      expectedVersion: String(current.version), reason: `${reason} · 撤销会话`, operator: "superadmin",
    });
    expect(revoked.status, revoked.raw).toBeLessThan(400);
  }
  current = await accountById(page, accountId);
  expect({
    role: current.role,
    status: current.status,
    tfa: current.tfa,
    sessions: Number(current.sessions),
  }).toEqual({ role: "unassigned", status: "disabled", tfa: false, sessions: 0 });
}

async function accountById(page: Page, accountId: string) {
  const overview = await api(page, "GET", "/api/admin/platform/accounts/overview");
  expect(overview.status, overview.raw).toBe(200);
  const current = overview.data?.operators?.find((candidate: any) => String(candidate.id) === accountId);
  expect(current, `K2 temporary account ${accountId} must exist during cleanup`).toBeTruthy();
  return current;
}

test.describe.serial("K2 套利与刷量检测独立验收", () => {
  test.describe.configure({ timeout: 360_000 });

  test.beforeAll(() => setupFixtures());
  test.afterAll(async ({ browser }) => {
    const cleanupErrors: string[] = [];
    try {
      await rejectPendingK2(browser);
    } catch (error) {
      cleanupErrors.push(`pending A2 cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      cleanupFixtures();
    } catch (error) {
      cleanupErrors.push(`mutable fixture cleanup: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      verifyK2Cleanup();
    } catch (error) {
      cleanupErrors.push(`residual verification: ${error instanceof Error ? error.message : String(error)}`);
    }
    summary.cleanupErrors = cleanupErrors;
    writeFileSync(path.join(EVIDENCE_DIR, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8");
    if (cleanupErrors.length > 0) throw new Error(`K2 cleanup failed: ${cleanupErrors.join(" | ")}`);
  });
  test.afterEach(async ({ page }, testInfo: TestInfo) => {
    summary.tests.push({ title: testInfo.title, status: testInfo.status, errors: testInfo.errors.map((item) => item.message) });
    writeFileSync(path.join(EVIDENCE_DIR, "run-summary.json"), JSON.stringify(summary, null, 2), "utf8");
    if (testInfo.status !== testInfo.expectedStatus) await shot(page, `failure-${testInfo.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]+/g, "-")}`);
  });

  test("从可见登录与侧栏进入，四类真实视图及E3正反事实可理解", async ({ page }) => {
    await produceTrialCycles(page);
    await login(page);
    await openK2(page);
    await expect(page.locator("main")).toContainText("高频下架置换与礼金/返佣叠加证据");
    await expect(page.locator("main")).not.toContainText("最小持仓月份");
    const views = [
      ["试用循环", CLUSTER_ID], ["换新套利", USER_NO], ["新人礼刷取", H8_CLUSTER_ID], ["排行榜刷榜", USER_NO],
    ];
    for (let index = 0; index < views.length; index += 1) {
      const [name, marker] = views[index];
      await page.getByRole("button", { name, exact: true }).click();
      const row = page.locator("main table tbody tr").filter({ hasText: marker }).first();
      await expect(row).toBeVisible();
      const headerCount = await page.locator("main table thead th").count();
      const cellCount = await row.locator("td").count();
      expect(cellCount, `${name} 表头与事实列必须一一对齐`).toBe(headerCount);
      await shot(page, `01-view-${index + 1}`);
    }
    const overview = await api(page, "GET", "/api/admin/risk/arbitrage/overview");
    expect(overview.status, overview.raw).toBe(200);
    const tradeinRows = overview.data.views.find((view: any) => view.key === "tradein").rows;
    const e3Projection = tradeinRows.find((row: any) => row.rowId === ROWS.tradein);
    expect(e3Projection?.cells.some((cell: string) => cell.includes("1 笔返佣 / 1 笔礼金"))).toBe(true);
    expect(e3Projection?.level).toBe(3);
    expect(tradeinRows.some((row: any) => row.rowId === `K2-E3-U${NEGATIVE_USER_ID}`)).toBe(false);
    expect(tradeinRows.some((row: any) => row.rowId === `K2-E3-U${PENDING_USER_ID}`)).toBe(false);
    const blockedRestart = await page.request.post(`${BACKEND_URL}/api/trial/start`, {
      headers: {
        Authorization: `Bearer ${userJwt()}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `k2-${SUFFIX}-trial-blocked`,
        "X-Nexion-Edge-Country": "JP",
        "CF-IPCountry": "JP",
      },
      data: { deviceName: "K2 acceptance blocked restart" },
    });
    expect(blockedRestart.status()).toBe(409);
    const blockedBody = await blockedRestart.json();
    expect(blockedBody.code).toBe(409);
    expect(blockedBody.message).toBe("TRIAL_CYCLE_RISK_BLOCKED");
    await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(8);
  });

  test("预置最小权限角色覆盖菜单、读写、幂等重放与陈旧版本CAS", async ({ page, browser }) => {
    await login(page);
    await openK2(page);
    const commandKey = `k2-perm-${randomUUID()}`;
    const body = { expectedVersion: 0, reason: `${RUN_ID} maker精确标记幂等验证` };
    const first = await api(page, "POST", `/api/admin/risk/arbitrage/rows/${ROWS.permission}/mark`, body, commandKey);
    const replay = await api(page, "POST", `/api/admin/risk/arbitrage/rows/${ROWS.permission}/mark`, body, commandKey);
    const stale = await api(page, "POST", `/api/admin/risk/arbitrage/rows/${ROWS.permission}/mark`, body);
    expect(first.status, first.raw).toBe(200);
    expect(replay.status, replay.raw).toBe(200);
    expect(stale.status, stale.raw).toBe(409);

    const readonlyContext = await browser.newContext();
    const readonlyPage = await readonlyContext.newPage();
    try {
      await login(readonlyPage, READONLY_USERNAME, READONLY_PASSWORD);
      await openK2(readonlyPage);
      await expect(readonlyPage.locator("main table tbody tr").filter({ hasText: USER_NO }).first()).toBeVisible();
      await expect(readonlyPage.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
      await expect(readonlyPage.getByRole("button", { name: /标记套利|拦截新人礼|标记刷榜|联动 K1 冻结/ })).toHaveCount(0);
      const forbidden = await api(readonlyPage, "POST", `/api/admin/risk/arbitrage/rows/${ROWS.gift}/block-gift`, {
        expectedVersion: 0,
        reason: `${RUN_ID} readonly越权探针不得执行`,
      });
      expect(forbidden.status, forbidden.raw).toBe(403);
      await shot(readonlyPage, "02-readonly-permission");
    } finally {
      await readonlyContext.close();
    }

    const nowriteContext = await browser.newContext();
    const nowritePage = await nowriteContext.newPage();
    try {
      await login(nowritePage, NOWRITE_USERNAME, NOWRITE_PASSWORD);
      await openK2(nowritePage);
      const forbiddenParam = await api(nowritePage, "PATCH", "/api/admin/risk/arbitrage/params/otpGate.resendSeconds", {
        value: "61",
        expectedVersion: 0,
        reason: `${RUN_ID} nowrite越权参数探针不得执行`,
      });
      expect(forbiddenParam.status, forbiddenParam.raw).toBe(403);
    } finally {
      await nowriteContext.close();
    }

    const noMenuContext = await browser.newContext();
    const noMenuPage = await noMenuContext.newPage();
    try {
      await login(noMenuPage, NOMENU_USERNAME, NOMENU_PASSWORD);
      await expect(noMenuPage.locator('aside a[href="/risk/abuse"]')).toHaveCount(0);
      const forbiddenRead = await api(noMenuPage, "GET", "/api/admin/risk/arbitrage/overview");
      expect(forbiddenRead.status, forbiddenRead.raw).toBe(403);
    } finally {
      await noMenuContext.close();
    }
  });

  test("三类直接预防动作与K1关联冻结经A2独立审批完整落地", async ({ page, browser }) => {
    await login(page); await openK2(page);
    await page.getByRole("button", { name: "换新套利", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: USER_NO }).getByRole("button", { name: "标记套利" }).click();
    let dialog = page.locator('[role="dialog"]:visible').last();
    await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} 标记真实COMPLETED置换套利`);
    await dialog.getByRole("button", { name: /确认标记|确认提交/ }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "新人礼刷取", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: H8_CLUSTER_ID }).getByRole("button", { name: "拦截新人礼" }).click();
    dialog = page.locator('[role="dialog"]:visible').last();
    await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} 拦截后续新人礼不追溯资产`);
    await dialog.getByRole("button", { name: /确认拦截|确认提交/ }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "排行榜刷榜", exact: true }).click();
    await page.locator("tbody tr").filter({ hasText: USER_NO }).getByRole("button", { name: "标记刷榜" }).click();
    dialog = page.locator('[role="dialog"]:visible').last();
    await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} 仅产刷榜信号由F域处置`);
    await dialog.getByRole("button", { name: /确认标记|确认提交/ }).click();
    await expect(dialog).toBeHidden();

    const checkerContext = await browser.newContext();
    const checkerPage = await checkerContext.newPage();
    let checkerId = "";
    try {
      const checker = await createChecker(page, checkerPage, "freeze"); checkerId = checker.accountId;
      await page.getByRole("button", { name: "试用循环", exact: true }).click();
      const trialRow = page.locator("tbody tr").filter({ hasText: CLUSTER_ID }).first();
      await trialRow.getByRole("button", { name: "联动 K1 冻结" }).click();
      dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} K1关联冻结A2确认`);
      const proposalPromise = page.waitForResponse((response) => response.url().endsWith("/api/admin/platform/audit/operations") && response.request().method() === "POST");
      await dialog.getByRole("button", { name: /确认提交/ }).click();
      const proposal = await proposalPromise;
      const proposalBody = await proposal.json();
      const operationId = String(proposalBody.data?.operationId ?? proposalBody.data?.id);
      const approved = await api(checkerPage, "POST", `/api/admin/platform/audit/operations/${operationId}/approve`, { reason: `${RUN_ID} checker批准K1关联冻结`, operator: checker.username });
      expect(approved.status, approved.raw).toBeLessThan(400);
      await page.reload();
      await expect(page.getByText("闭环怎么判", { exact: true })).toBeVisible();
      await expect(page.locator("tbody tr").filter({ hasText: CLUSTER_ID }).first()).toContainText("已联动 K1 冻结");
      expect(mysql(`SELECT CONCAT(status,'|',version) FROM nx_admin_risk_multi_account_cluster WHERE cluster_id='${CLUSTER_ID}';`)).toBe("frozen|1");
      expect(mysql(`SELECT CONCAT(status,'|',c2_freeze_source) FROM nx_user WHERE id=${USER_ID};`)).toBe("FROZEN|K1_MULTI_ACCOUNT_CLUSTER");
      await shot(page, "03-actions-and-a2-freeze");
    } finally {
      await checkerContext.close();
      if (checkerId) await cleanupAccount(page, checkerId, `${RUN_ID} 清理K2冻结复核账号`);
    }
  });

  test("H2真实事件、H8拦截与F4d信号消费形成跨域闭环且不越权处置", async ({ page }) => {
    await login(page, CROSS_DOMAIN_USERNAME, CROSS_DOMAIN_PASSWORD);
    const signalTypes = mysql(`SELECT GROUP_CONCAT(DISTINCT signal_type ORDER BY signal_type) FROM nx_risk_signal WHERE user_id=${USER_ID} AND is_deleted=0 AND signal_type LIKE 'risk.%';`);
    expect(signalTypes).toContain("risk.trial_cycle_detected");
    expect(signalTypes).toContain("risk.arbitrage_suspected");
    expect(signalTypes).toContain("risk.leaderboard_velocity_flagged");
    const crossDomainOutboxCount = await waitForMysqlCountAtLeast(
      `SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_type='RISK_ARBITRAGE_ROW' AND aggregate_id IN ('${ROWS.tradein}','${ROWS.gift}','${ROWS.board}','${H2_PROJECTION_ROW_ID}') AND event_name IN ('risk.arbitrage_suspected','risk.trial_cycle_detected','risk.leaderboard_velocity_flagged') AND schema_registered=1 AND is_server_authoritative=1;`,
      4,
    );
    expect(crossDomainOutboxCount).toBeGreaterThanOrEqual(4);

    const h8 = await api(page, "GET", "/api/admin/growth/referral-rewards");
    expect(h8.status, h8.raw).toBe(200);
    expect(Number(h8.data.blockedByK2)).toBeGreaterThanOrEqual(1);
    await openSidebarModule(page, "增长与运营节奏", "/growth/referral-rewards");
    await expect(page.getByText("风控暂缓", { exact: true }).locator("..")).toContainText(/[1-9]\d*/);
    await shot(page, "04-cross-domain-h8-blocked");

    const f4 = await api(page, "GET", "/api/admin/teams/leadership-pool");
    expect(f4.status, f4.raw).toBe(200);
    expect(Number(f4.data.leaderboardFraudHitCount)).toBeGreaterThanOrEqual(1);
    expect(Number(mysql(`SELECT COUNT(*) FROM nx_team_leaderboard_action WHERE member_user_id=${USER_ID} AND is_deleted=0;`))).toBe(0);
    await openSidebarModule(page, "分销与团队", "/network/leadership-pool");
    await expect(page.getByText("刷榜命中 · K2", { exact: true }).locator("..")).toContainText(/[1-9]\d* 账户/);
    await shot(page, "05-cross-domain-f4-signal-only");
  });

  test("OTP参数可逆写入、刷新重登、幂等重放、CAS和审计后恢复", async ({ page }) => {
    await login(page); await openK2(page);
    const before = await api(page, "GET", "/api/admin/risk/arbitrage/overview");
    const param = before.data.params.find((item: any) => item.key === "otpGate.resendSeconds");
    const original = Number(param.value);
    const next = original === 300 ? 299 : original + 1;
    let changed = false;
    try {
      const card = page.getByText("验证码重发冷却", { exact: true }).locator("..");
      await card.getByRole("button", { name: "调整", exact: true }).click();
      let dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByRole("spinbutton", { name: "目标新值" }).fill(String(next));
      await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} OTP冷却可逆验收写入`);
      const responsePromise = page.waitForResponse((response) => response.url().includes("/arbitrage/params/otpGate.resendSeconds") && response.request().method() === "PATCH");
      await dialog.getByRole("button", { name: "确认提交" }).click();
      const response = await responsePromise;
      expect(response.status(), await response.text()).toBe(200);
      changed = true;
      const idem = response.request().headers()["idempotency-key"];
      const body = response.request().postDataJSON();
      const replay = await api(page, "PATCH", "/api/admin/risk/arbitrage/params/otpGate.resendSeconds", body, idem);
      const stale = await api(page, "PATCH", "/api/admin/risk/arbitrage/params/otpGate.resendSeconds", body);
      expect(replay.status, replay.raw).toBe(200);
      expect(stale.status, stale.raw).toBe(409);
      await page.reload(); await expect(page.getByText("闭环怎么判", { exact: true })).toBeVisible();
      await expect(page.getByText("验证码重发冷却", { exact: true }).locator("..")).toContainText(String(next));
      await page.locator('header button[aria-haspopup="menu"]').last().click();
      await page.getByRole("button", { name: "退出登录", exact: true }).click();
      await login(page); await openK2(page);
      await expect(page.getByText("验证码重发冷却", { exact: true }).locator("..")).toContainText(String(next));
      await shot(page, "04-otp-refresh-relogin");
      const restoreCard = page.getByText("验证码重发冷却", { exact: true }).locator("..");
      await restoreCard.getByRole("button", { name: "调整", exact: true }).click();
      dialog = page.locator('[role="dialog"]:visible').last();
      await dialog.getByRole("spinbutton", { name: "目标新值" }).fill(String(original));
      await dialog.getByLabel(/操作理由/).fill(`${RUN_ID} OTP冷却恢复原值`);
      await dialog.getByRole("button", { name: "确认提交" }).click();
      await expect(dialog).toBeHidden(); changed = false;
      await expect(restoreCard).toContainText(String(original));
    } finally {
      if (changed) {
        if (!await page.locator("aside").isVisible().catch(() => false)) await login(page);
        const current = await api(page, "GET", "/api/admin/risk/arbitrage/overview");
        const currentParam = current.data.params.find((item: any) => item.key === "otpGate.resendSeconds");
        const restored = await api(page, "PATCH", "/api/admin/risk/arbitrage/params/otpGate.resendSeconds", { value: String(original), expectedVersion: currentParam.version, reason: `${RUN_ID} finally恢复OTP冷却` });
        expect(restored.status, restored.raw).toBe(200);
      }
    }
  });

  test("503时失败关闭，恢复后仅重试K2，退出返回仍受门禁保护", async ({ page }) => {
    await login(page);
    await page.route("**/api/admin/risk/arbitrage/overview", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, message: "K2_ACCEPTANCE_INJECTED" }) }));
    await openK2(page).catch(() => undefined);
    await expect(page.getByText("K2 数据加载失败", { exact: true })).toBeVisible();
    await expect(page.getByText(/已隐藏旧数据与写操作/)).toBeVisible();
    await expect(page.getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
    await shot(page, "05-503-fail-closed");
    await page.unroute("**/api/admin/risk/arbitrage/overview");
    await page.getByRole("button", { name: "仅重试 K2", exact: true }).click();
    await expect(page.getByText("闭环怎么判", { exact: true })).toBeVisible();
    await page.locator('header button[aria-haspopup="menu"]').last().click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "运营控制台登录" })).toBeVisible();
    await shot(page, "06-auth-gate");
  });
});
