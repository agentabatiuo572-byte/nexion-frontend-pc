import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type Envelope<T> = { code: number; message: string; data: T };

const RUN_ID = process.env.D_CHILD_RUN_ID ?? "pc-full-acceptance-20260729-114336-D";
const BACKEND_URL = process.env.D_CHILD_BACKEND_URL ?? "http://127.0.0.1:18120";
const EVIDENCE_DIR = process.env.D_CHILD_APP_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/app-contract";
const DB_NAME = process.env.D_CHILD_DB_NAME ?? "nexion_acceptance_20260729_114336_d";
const DB_PASSWORD = requiredEnv("D_CHILD_DB_PASSWORD");
const MYSQL = process.env.D_CHILD_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const APP_PHONE = process.env.D_CHILD_APP_PHONE ?? "90729114336";
const APP_PASSWORD = requiredEnv("D_CHILD_APP_PASSWORD");
const APP_USER_ID = 990729114;
const APP_ADDRESS = "TDRUN114336ADDRESS";

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("App 消费 D1/D5/D6 且 C/K/J 失败关闭：闸关闭时不建单、不动钱包、幂等稳定", async ({ request }) => {
  const anonymous = await request.get(`${BACKEND_URL}/api/withdrawals/policy`, {
    headers: { "X-Nexion-Edge-Country": "JP" },
  });
  expect(anonymous.status()).toBe(401);

  const login = await request.post(`${BACKEND_URL}/auth/users/login`, {
    headers: { "X-Nexion-Edge-Country": "JP" },
    data: { countryCode: "+86", phone: APP_PHONE, password: APP_PASSWORD },
  });
  expect(login.status(), await login.text()).toBe(200);
  const loginPayload = await login.json() as Envelope<{ accessToken: string }>;
  expect(loginPayload.code).toBe(0);
  expect(loginPayload.data.accessToken).toBeTruthy();
  const headers = {
    Authorization: `Bearer ${loginPayload.data.accessToken}`,
    "X-Nexion-Edge-Country": "JP",
  };

  const [paymentConfig, fxQuote, policy] = await Promise.all([
    request.get(`${BACKEND_URL}/api/app/payments/config`, { headers }),
    request.get(`${BACKEND_URL}/api/app/payments/fx-quote?fiat=VND&asset=USDT`, { headers }),
    request.get(`${BACKEND_URL}/api/withdrawals/policy`, { headers }),
  ]);
  expect(paymentConfig.status(), await paymentConfig.text()).toBe(200);
  expect(fxQuote.status(), await fxQuote.text()).toBe(200);
  expect(policy.status(), await policy.text()).toBe(200);
  const paymentPayload = await paymentConfig.json() as Envelope<Record<string, unknown>>;
  const fxPayload = await fxQuote.json() as Envelope<Record<string, unknown>>;
  const policyPayload = await policy.json() as Envelope<Record<string, unknown>>;
  expect(paymentPayload.code).toBe(0);
  expect(fxPayload.code).toBe(0);
  expect(policyPayload.code).toBe(0);
  expect(policyPayload.data.withdrawalEnabled).toBe(false);
  expect(policyPayload.data.gateSource).toBe("J1");
  expect(policyPayload.data.source).toBe("D5+H1");
  expect(Number(policyPayload.data.minAmount)).toBeGreaterThan(0);

  const before = walletAndOrders();
  const key = `${RUN_ID}-app-withdraw-gate`;
  const body = { amount: 20, chain: "USDT-TRC20", address: APP_ADDRESS };
  const blocked = await request.post(`${BACKEND_URL}/api/withdrawals`, {
    headers: { ...headers, "Idempotency-Key": key },
    data: body,
  });
  expect(blocked.status(), await blocked.text()).toBe(409);
  const blockedPayload = await blocked.json() as Envelope<unknown>;
  expect(blockedPayload.message).toBe("WITHDRAWAL_KILL_SWITCH_DISABLED");

  const replay = await request.post(`${BACKEND_URL}/api/withdrawals`, {
    headers: { ...headers, "Idempotency-Key": key },
    data: body,
  });
  expect(replay.status(), await replay.text()).toBe(409);
  expect(await replay.json()).toEqual(blockedPayload);

  const conflict = await request.post(`${BACKEND_URL}/api/withdrawals`, {
    headers: { ...headers, "Idempotency-Key": key },
    data: { ...body, amount: 21 },
  });
  expect(conflict.status(), await conflict.text()).toBe(409);
  const after = walletAndOrders();
  expect(after).toEqual(before);

  const j1 = mysql("SELECT setting_value FROM nx_emergency_control_setting WHERE setting_key='killswitch.withdraw' LIMIT 1;").trim();
  expect(j1).toBe("disabled");
  const cFacts = mysql(`
    SELECT status
      FROM nx_user WHERE id=${APP_USER_ID} AND is_deleted=0;
    SELECT CONCAT(status,'|',network,'|',address)
      FROM nx_user_payout_address WHERE user_id=${APP_USER_ID} AND is_deleted=0;
  `).trim().split(/\r?\n/);
  expect(cFacts[0]).toBe("ACTIVE");
  expect(cFacts[1]).toBe(`ACTIVE|TRC20|${APP_ADDRESS}`);

  writeFileSync(path.join(EVIDENCE_DIR, "app-d-c-k-j-contract.json"), `${JSON.stringify({
    runId: RUN_ID,
    anonymousPolicyStatus: anonymous.status(),
    appLoginStatus: login.status(),
    reads: {
      d1PaymentConfig: paymentConfig.status(),
      d6FxQuote: fxQuote.status(),
      d5Policy: policy.status(),
      withdrawalEnabled: policyPayload.data.withdrawalEnabled,
      gateSource: policyPayload.data.gateSource,
      source: policyPayload.data.source,
    },
    cFacts,
    j1,
    submit: {
      first: blocked.status(),
      message: blockedPayload.message,
      replay: replay.status(),
      keyConflict: conflict.status(),
      walletAndOrdersUnchanged: after === before,
    },
    before,
    after,
  }, null, 2)}\n`, "utf8");
});

function walletAndOrders() {
  return mysql(`
    SELECT CONCAT(usdt_available,'|',nex_available,'|',pending_withdraw,'|',version)
      FROM nx_user_wallet WHERE user_id=${APP_USER_ID} AND is_deleted=0;
    SELECT COUNT(*) FROM nx_withdrawal_order WHERE user_id=${APP_USER_ID} AND is_deleted=0;
  `).trim();
}

function mysql(sql: string) {
  return execFileSync(
    MYSQL,
    [
      "--default-character-set=utf8mb4",
      "--host=127.0.0.1",
      "--user=root",
      "--batch",
      "--skip-column-names",
      `--database=${DB_NAME}`,
      `--execute=${sql}`,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
    },
  );
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
