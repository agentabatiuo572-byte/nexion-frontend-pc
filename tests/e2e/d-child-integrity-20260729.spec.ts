import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const RUN_ID = process.env.D_CHILD_RUN_ID ?? "pc-full-acceptance-20260729-114336-D";
const EVIDENCE_DIR = process.env.D_CHILD_INTEGRITY_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/integrity";
const DB_NAME = process.env.D_CHILD_DB_NAME ?? "nexion_acceptance_20260729_114336_d";
const DB_PASSWORD = requiredEnv("D_CHILD_DB_PASSWORD");
const MYSQL = process.env.D_CHILD_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const USERNAME = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const PASSWORD = requiredEnv("NEXION_E2E_PASSWORD");

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("D1–D6 请求、状态、A2、A4/outbox 与幂等记录在子库闭合", async ({ page }) => {
  await login(page);
  const auditVoucher = await page.request.get(
    "/api/admin/platform/audit/logs?keyword=PCRUN-D-RESERVE-114336&limit=200",
  );
  const auditWithdrawal = await page.request.get(
    "/api/admin/platform/audit/logs?keyword=PCRUN-D-WD-114336&limit=200",
  );
  const eventOverview = await page.request.get("/api/admin/platform/events/overview");
  expect(auditVoucher.status(), await auditVoucher.text()).toBe(200);
  expect(auditWithdrawal.status(), await auditWithdrawal.text()).toBe(200);
  expect(eventOverview.status(), await eventOverview.text()).toBe(200);

  const audits = jsonRows(`
    SELECT JSON_OBJECT(
      'id',id,'action',action,'resourceType',resource_type,'resourceId',resource_id,
      'actor',actor_username,'result',result,
      'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
    )
      FROM nx_audit_log
     WHERE id>=70703
       AND (
         action IN (
           'D1_VIETQR_CONFIG_REJECTED','VIETQR_CONFIG_UPDATED',
           'D2_WITHDRAWAL_REVIEW_DELAY','D3_TREASURY_RESERVE_INJECTION',
           'D5_WITHDRAWAL_LIMITS_REJECTED','D5_WITHDRAWAL_PARAM_CHANGED',
           'D6_FX_QUOTE_REJECTED','FX_QUOTE_UPDATED'
         )
         OR resource_id IN ('PCRUN-D-RESERVE-114336','PCRUN-D-WD-114336')
       )
     ORDER BY id;
  `);
  for (const action of [
    "D1_VIETQR_CONFIG_REJECTED",
    "VIETQR_CONFIG_UPDATED",
    "D2_WITHDRAWAL_REVIEW_DELAY",
    "D3_TREASURY_RESERVE_INJECTION",
    "D5_WITHDRAWAL_LIMITS_REJECTED",
    "D5_WITHDRAWAL_PARAM_CHANGED",
    "D6_FX_QUOTE_REJECTED",
    "FX_QUOTE_UPDATED",
  ]) {
    expect(audits.some((row) => row.action === action), `A2 action ${action}`).toBe(true);
  }

  const outbox = jsonRows(`
    SELECT JSON_OBJECT(
      'id',id,'eventType',event_type,'aggregateType',aggregate_type,
      'aggregateId',aggregate_id,'status',status,
      'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
    )
      FROM nx_event_outbox
     WHERE id>=9724
       AND (
         event_type IN (
           'admin.fx_quote_updated','withdraw.delayed',
           'admin.treasury_reserve_injected','admin.withdraw_limit_changed'
         )
         OR aggregate_id IN ('PCRUN-D-RESERVE-114336','PCRUN-D-WD-114336')
       )
     ORDER BY id;
  `);
  for (const eventType of [
    "admin.fx_quote_updated",
    "withdraw.delayed",
    "admin.treasury_reserve_injected",
    "admin.withdraw_limit_changed",
  ]) {
    expect(outbox.some((row) => row.eventType === eventType), `A4 event ${eventType}`).toBe(true);
  }
  expect(outbox.filter((row) =>
    row.eventType === "admin.treasury_reserve_injected"
    && row.aggregateId === "PCRUN-D-RESERVE-114336",
  )).toHaveLength(1);

  const reserve = jsonRows(`
    SELECT JSON_OBJECT(
      'reserveNo',reserve_no,'voucherNo',voucher_no,'direction',direction,
      'amountUsd',amount_usd,'idempotencyKey',idempotency_key,'status',status
    )
      FROM nx_treasury_reserve_ledger
     WHERE voucher_no='PCRUN-D-RESERVE-114336' AND is_deleted=0;
  `);
  expect(reserve).toHaveLength(1);
  expect(reserve[0]).toMatchObject({ direction: "IN", status: "CONFIRMED" });

  const withdrawal = jsonRows(`
    SELECT JSON_OBJECT(
      'withdrawalNo',withdrawal_no,'status',status,'version',d2_version,
      'riskScore',d2_k4_risk_score,'lifecycleOwner',d2_lifecycle_owner
    )
      FROM nx_withdrawal_order
     WHERE withdrawal_no='PCRUN-D-WD-114336' AND is_deleted=0;
  `);
  expect(withdrawal).toHaveLength(1);
  expect(withdrawal[0]).toMatchObject({ status: "EXTENDED_HOLD", version: 1, riskScore: 3 });

  const idempotency = jsonRows(`
    SELECT JSON_OBJECT(
      'scope',scope,'idempotencyKey',idempotency_key,'status',status,
      'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s')
    )
      FROM nx_admin_idempotency_record
     WHERE idempotency_key LIKE '${RUN_ID}%'
       AND is_deleted=0
     ORDER BY id;
  `);
  expect(idempotency.filter((row) => row.idempotencyKey === `${RUN_ID}-d3-coverage`)).toHaveLength(1);
  expect(idempotency.every((row) => row.status !== "PROCESSING")).toBe(true);

  writeFileSync(path.join(EVIDENCE_DIR, "d-domain-integrity.json"), `${JSON.stringify({
    runId: RUN_ID,
    api: {
      a2Voucher: auditVoucher.status(),
      a2Withdrawal: auditWithdrawal.status(),
      a4Overview: eventOverview.status(),
    },
    audits,
    outbox,
    reserve,
    withdrawal,
    idempotency,
  }, null, 2)}\n`, "utf8");
});

test("补偿后储备净额、配置、账号、幂等与对象锁回到基线，immutable 证据保留", async ({ page }) => {
  await login(page);
  const coverageResponse = await page.request.get("/api/admin/treasury/dual-ledger");
  const d1Response = await page.request.get("/api/admin/finance/vietqr/overview?view=inflight&pageNum=1&pageSize=20");
  const d5Response = await page.request.get("/api/admin/withdraw/limits");
  const d6Response = await page.request.get("/api/admin/finance/fx-quote");
  for (const response of [coverageResponse, d1Response, d5Response, d6Response]) {
    expect(response.status(), await response.text()).toBe(200);
  }
  const coverage = (await coverageResponse.json() as {
    data: { snapshot: { reserveUsd: number; liabilitiesUsd: number; coverageRatio: number; redlinePct: number } };
  }).data.snapshot;
  const d1 = (await d1Response.json() as { data: { config: Record<string, unknown> } }).data.config;
  const d5 = (await d5Response.json() as { data: Record<string, unknown> }).data;
  const d6 = (await d6Response.json() as { data: Record<string, unknown> }).data;
  const baselineCoverage = JSON.parse(readFileSync(
    "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/write/d3-coverage-lifecycle.json",
    "utf8",
  )) as { before: Record<string, unknown> };
  const baselineD5 = JSON.parse(readFileSync(
    "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/write/d5-healthy-lifecycle.json",
    "utf8",
  )) as { original: Record<string, unknown> };
  const baselineD1D6 = JSON.parse(readFileSync(
    "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/child-pc-full-acceptance-20260729-114336-D/owner/final-independent/02-mutation-result.json",
    "utf8",
  )) as { d1: { originalTolerance: number }; d6: { original: Record<string, unknown> } };

  expect(coverage.reserveUsd).toBe(baselineCoverage.before.reserveUsd);
  expect(coverage.coverageRatio).toBe(baselineCoverage.before.coverageRatio);
  expect(coverage.redlinePct).toBe(baselineCoverage.before.redlinePct);
  expect(d1.toleranceVnd).toBe(baselineD1D6.d1.originalTolerance);
  for (const key of [
    "dailyLimitCount", "balanceMaxRatio", "networkFeeRatio",
    "networkFeeMin", "networkFeeMax", "nexFeeOffsetRate",
  ]) {
    expect(d5[key], `D5 ${key}`).toBe(baselineD5.original[key]);
  }
  for (const key of ["baseRateVndPerUsdt", "buySpreadPct", "lockWindowMinutes"]) {
    expect(d6[key], `D6 ${key}`).toBe(baselineD1D6.d6.original[key]);
  }

  const cleanup = jsonRows(`
    SELECT JSON_OBJECT(
      'reserveRows',(SELECT COUNT(*) FROM nx_treasury_reserve_ledger WHERE voucher_no LIKE 'PCRUN-D-RESERVE%'),
      'reserveIn',(SELECT COALESCE(SUM(amount_usd),0) FROM nx_treasury_reserve_ledger WHERE voucher_no LIKE 'PCRUN-D-RESERVE%' AND direction='IN' AND is_deleted=0),
      'reserveOut',(SELECT COALESCE(SUM(amount_usd),0) FROM nx_treasury_reserve_ledger WHERE voucher_no LIKE 'PCRUN-D-RESERVE%' AND direction='OUT' AND is_deleted=0),
      'runIdempotency',(SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE 'pc-full-acceptance-20260729-114336-D%'),
      'runWithdrawal',(SELECT COUNT(*) FROM nx_withdrawal_order WHERE withdrawal_no='PCRUN-D-WD-114336'),
      'appUser',(SELECT COUNT(*) FROM nx_user WHERE id=990729114),
      'appSession',(SELECT COUNT(*) FROM nx_user_session WHERE user_id=990729114),
      'k4Projection',(SELECT COUNT(*) FROM nx_admin_risk_score_user WHERE user_no='U990729114'),
      'objectLocks',(SELECT COUNT(*) FROM nx_audit_object_lock WHERE target_id IN ('PCRUN-D-WD-114336','PCRUN-D-RESERVE-114336') AND is_deleted=0),
      'immutableD3Audit',(SELECT COUNT(*) FROM nx_audit_log WHERE action='D3_TREASURY_RESERVE_INJECTION' AND resource_id='PCRUN-D-RESERVE-114336'),
      'immutableD3Outbox',(SELECT COUNT(*) FROM nx_event_outbox WHERE event_type='admin.treasury_reserve_injected' AND aggregate_id='PCRUN-D-RESERVE-114336'),
      'immutableD2Audit',(SELECT COUNT(*) FROM nx_audit_log WHERE action='D2_WITHDRAWAL_REVIEW_DELAY' AND resource_id='PCRUN-D-WD-114336'),
      'immutableD2Outbox',(SELECT COUNT(*) FROM nx_event_outbox WHERE event_type='withdraw.delayed' AND aggregate_id='PCRUN-D-WD-114336')
    );
  `)[0];
  expect(cleanup.reserveRows).toBe(2);
  expect(cleanup.reserveIn).toBe(cleanup.reserveOut);
  for (const key of [
    "runIdempotency", "runWithdrawal", "appUser", "appSession", "k4Projection", "objectLocks",
  ]) {
    expect(cleanup[key], key).toBe(0);
  }
  expect(Number(cleanup.immutableD3Audit)).toBeGreaterThanOrEqual(1);
  expect(Number(cleanup.immutableD3Outbox)).toBeGreaterThanOrEqual(1);
  expect(Number(cleanup.immutableD2Audit)).toBeGreaterThanOrEqual(1);
  expect(Number(cleanup.immutableD2Outbox)).toBeGreaterThanOrEqual(1);

  writeFileSync(path.join(EVIDENCE_DIR, "d-domain-cleanup-prestop.json"), `${JSON.stringify({
    runId: RUN_ID,
    coverage,
    baselineCoverage: baselineCoverage.before,
    d1,
    d5,
    d6,
    cleanup,
  }, null, 2)}\n`, "utf8");
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible();
}

function jsonRows(sql: string): Array<Record<string, unknown>> {
  const output = mysql(sql).trim();
  if (!output) return [];
  return output.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
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
