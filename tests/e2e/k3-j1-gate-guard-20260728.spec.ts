import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ADMIN_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ADMIN_PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const DB_NAME = requiredEnv("K3_DB_NAME");
const DB_PASSWORD = requiredEnv("K3_DB_PASSWORD");
const MYSQL = process.env.K3_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const EVIDENCE_DIR = process.env.K3_J1_GUARD_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/K/K3-j1-guard";
const CHILD_EVIDENCE_DIR = process.env.K3_EVIDENCE_DIR
  ?? path.join(EVIDENCE_DIR, "k3-live");
const CHILD_OUTPUT_DIR = process.env.K3_PLAYWRIGHT_OUTPUT_DIR
  ?? path.join(EVIDENCE_DIR, "playwright");
const ALLOW_PENDING_CAS = process.env.K3_J1_ALLOW_PENDING_CAS === "1";
const WITHDRAW_PREFIX = "emergency.killswitch.withdraw.";
const EXPECTED_KEYS = [
  "killswitch.withdraw",
  `${WITHDRAW_PREFIX}emergency`,
  `${WITHDRAW_PREFIX}lastChange`,
  `${WITHDRAW_PREFIX}auto-confirm.pending`,
  `${WITHDRAW_PREFIX}auto-confirm.incidentId`,
  `${WITHDRAW_PREFIX}auto-confirm.ruleId`,
  `${WITHDRAW_PREFIX}auto-confirm.signalValue`,
  `${WITHDRAW_PREFIX}auto-confirm.threshold`,
  `${WITHDRAW_PREFIX}auto-confirm.triggeredAt`,
  `${WITHDRAW_PREFIX}auto-confirm.dueAt`,
  `${WITHDRAW_PREFIX}auto-confirm.lastReminderAt`,
];

type SettingRow = {
  id: number;
  settingKey: string;
  settingValue: string;
  valueType: string;
  groupCode: string;
  remark: string | null;
  operator: string | null;
  createdAt: string;
  updatedAt: string;
  isDeleted: number;
};

test.describe.configure({ mode: "serial", timeout: 900_000 });
test.use({ trace: "off", video: "off" });

test("J1 精确快照保护下真实开放提现闸、执行 K3 并完整恢复", async ({ page }) => {
  expect(ALLOW_PENDING_CAS, "必须由主智能体在隔离库和全局锁内显式授权 pending CAS").toBe(true);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  mkdirSync(CHILD_EVIDENCE_DIR, { recursive: true });
  mkdirSync(CHILD_OUTPUT_DIR, { recursive: true });

  const before = readWithdrawRows();
  expect(before.map((row) => row.settingKey).sort()).toEqual([...EXPECTED_KEYS].sort());
  const byKey = new Map(before.map((row) => [row.settingKey, row]));
  expect(byKey.get("killswitch.withdraw")?.settingValue).toBe("disabled");
  expect(byKey.get(`${WITHDRAW_PREFIX}emergency`)?.settingValue).toBe("true");
  expect(byKey.get(`${WITHDRAW_PREFIX}auto-confirm.pending`)?.settingValue).toBe("true");
  assertAutoConfirmWindowIsNotNear(byKey.get(`${WITHDRAW_PREFIX}auto-confirm.dueAt`)!.settingValue);

  const enableKey = `k3-j1-enable-${randomUUID()}`;
  const blockedKey = `k3-j1-coverage-blocked-${randomUUID()}`;
  const disableKey = `k3-j1-disable-${randomUUID()}`;
  const reserveFixtureId = randomUUID().replaceAll("-", "");
  const reserveNo = `RSV-K3-ACC-${reserveFixtureId}`;
  const voucherNo = `K3-ACC-${reserveFixtureId}`;
  let enableApplied = false;
  let reserveFixtureApplied = false;
  let childResult: ReturnType<typeof spawnSync> | undefined;
  let primaryError: unknown;
  const restoreErrors: string[] = [];

  writeFileSync(path.join(EVIDENCE_DIR, "j1-before.json"), `${JSON.stringify(before, null, 2)}\n`, "utf8");
  await login(page);
  const coverageBefore = await readDualLedger(page);
  writeFileSync(
    path.join(EVIDENCE_DIR, "b1-coverage-before.json"),
    `${JSON.stringify(coverageBefore, null, 2)}\n`,
    "utf8",
  );

  try {
    const pending = byKey.get(`${WITHDRAW_PREFIX}auto-confirm.pending`)!;
    const changed = Number(mysql(`
      UPDATE nx_emergency_control_setting
         SET setting_value='false',
             operator='k3-acceptance-gate-guard',
             updated_at=NOW()
       WHERE id=${pending.id}
         AND setting_key='${WITHDRAW_PREFIX}auto-confirm.pending'
         AND setting_value='true'
         AND updated_at=${sqlValue(pending.updatedAt)};
      SELECT ROW_COUNT();
    `).split(/\r?\n/).filter(Boolean).at(-1));
    expect(changed, "pending CAS 必须只命中锁内快照的一行").toBe(1);

    if (coverageBefore.coverageRatio < coverageBefore.redlinePct) {
      const blocked = await page.request.put("/api/admin/emergency/kill-switches/withdraw", {
        headers: { "Idempotency-Key": blockedKey },
        data: {
          enabled: "enabled",
          reason: "K3 验收先证明 B1 红线下恢复提现闸必须失败关闭",
          operator: "ignored",
        },
      });
      expect(blocked.status(), await blocked.text()).toBe(422);
      expect(await blocked.json()).toMatchObject({ code: 422, message: "COVERAGE_BELOW_REDLINE" });
      await assertJ1Api(page, { enabled: false, emergency: true, pending: false });

      const requiredReserve = Math.max(
        1,
        coverageBefore.liabilitiesUsd * (coverageBefore.redlinePct + 5) / 100 - coverageBefore.reserveUsd,
      );
      const fixtureAmount = Math.ceil(requiredReserve * 100) / 100;
      const inserted = Number(mysql(`
        INSERT INTO nx_treasury_reserve_ledger (
          reserve_no, voucher_no, direction, amount_usd, reason, operator,
          idempotency_key, status, created_at, updated_at, is_deleted
        ) VALUES (
          ${sqlValue(reserveNo)}, ${sqlValue(voucherNo)}, 'IN', ${fixtureAmount},
          'K3 isolated acceptance coverage fixture', 'k3-acceptance-gate-guard',
          ${sqlValue(reserveNo)}, 'CONFIRMED', NOW(), NOW(), 0
        );
        SELECT ROW_COUNT();
      `).split(/\r?\n/).filter(Boolean).at(-1));
      expect(inserted, "B1 覆盖率隔离夹具必须只新增一行").toBe(1);
      reserveFixtureApplied = true;
      const coverageWithFixture = await readDualLedger(page);
      expect(coverageWithFixture.coverageRatio).toBeGreaterThanOrEqual(coverageWithFixture.redlinePct);
      writeFileSync(
        path.join(EVIDENCE_DIR, "b1-coverage-with-fixture.json"),
        `${JSON.stringify(coverageWithFixture, null, 2)}\n`,
        "utf8",
      );
    }

    const enabled = await page.request.put("/api/admin/emergency/kill-switches/withdraw", {
      headers: { "Idempotency-Key": enableKey },
      data: {
        enabled: "enabled",
        reason: "K3 隔离验收临时开放提现闸，完成后立即按快照恢复",
        operator: "ignored",
      },
    });
    expect(enabled.status(), await enabled.text()).toBe(200);
    enableApplied = true;
    await assertJ1Api(page, { enabled: true, emergency: false, pending: false });

    childResult = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      [
        "playwright",
        "test",
        "tests/e2e/k3-final-acceptance-20260722.spec.ts",
        "--workers=1",
        "--reporter=line",
        `--output=${CHILD_OUTPUT_DIR}`,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          K3_DB_NAME: DB_NAME,
          K3_DB_PASSWORD: DB_PASSWORD,
          K3_EVIDENCE_DIR: CHILD_EVIDENCE_DIR,
          K3_ACCEPTANCE_RUN_ID: process.env.K3_ACCEPTANCE_RUN_ID ?? "pc-full-acceptance-20260728-151023-final",
        },
        shell: process.platform === "win32",
        timeout: 780_000,
      },
    );
    writeFileSync(path.join(EVIDENCE_DIR, "k3-child-output.txt"), [
      `status=${childResult.status}`,
      `signal=${childResult.signal ?? ""}`,
      childResult.stdout ?? "",
      childResult.stderr ?? "",
    ].join("\n"), "utf8");
    expect(childResult.error?.message ?? "", "K3 子进程不得发生载具错误").toBe("");
    expect(childResult.status, String(childResult.stderr || childResult.stdout || "")).toBe(0);
  } catch (error) {
    primaryError = error;
  } finally {
    if (enableApplied) {
      try {
        const disabled = await page.request.put("/api/admin/emergency/kill-switches/withdraw", {
          headers: { "Idempotency-Key": disableKey },
          data: {
            enabled: "disabled",
            reason: "K3 隔离验收结束，立即关闭提现闸并恢复原自动触发快照",
            triggerBasis: "安全事件",
            operator: "ignored",
          },
        });
        expect(disabled.status(), await disabled.text()).toBe(200);
      } catch (error) {
        restoreErrors.push(`REAL_API_DISABLE_FAILED:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (reserveFixtureApplied) {
      try {
        mysql(`
          DELETE FROM nx_treasury_reserve_ledger
           WHERE reserve_no=${sqlValue(reserveNo)}
             AND voucher_no=${sqlValue(voucherNo)}
             AND idempotency_key=${sqlValue(reserveNo)}
             AND operator='k3-acceptance-gate-guard';
        `);
        expect(Number(mysql(`
          SELECT COUNT(*) FROM nx_treasury_reserve_ledger
           WHERE reserve_no=${sqlValue(reserveNo)}
              OR voucher_no=${sqlValue(voucherNo)}
              OR idempotency_key=${sqlValue(reserveNo)};
        `))).toBe(0);
      } catch (error) {
        restoreErrors.push(`B1_COVERAGE_FIXTURE_CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      restoreMutableRows(before);
    } catch (error) {
      restoreErrors.push(`DB_SNAPSHOT_RESTORE_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      mysql(`
        DELETE FROM nx_admin_idempotency_record
         WHERE idempotency_key IN (${sqlValue(blockedKey)},${sqlValue(enableKey)},${sqlValue(disableKey)});
      `);
    } catch (error) {
      restoreErrors.push(`J1_IDEMPOTENCY_CLEANUP_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      assertRestoredRows(before);
      await assertJ1Api(page, { enabled: false, emergency: true, pending: true }, byKey);
      await assertCoverageRestored(page, coverageBefore);
    } catch (error) {
      restoreErrors.push(`J1_RESTORE_ASSERTION_FAILED:${error instanceof Error ? error.message : String(error)}`);
    }
  }

  writeFileSync(path.join(EVIDENCE_DIR, "j1-after.json"), `${JSON.stringify(readWithdrawRows(), null, 2)}\n`, "utf8");
  if (restoreErrors.length > 0) throw new Error(restoreErrors.join("\n"));
  if (primaryError) throw primaryError;
});

async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(ADMIN_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function assertJ1Api(
  page: Page,
  expected: { enabled: boolean; emergency: boolean; pending: boolean },
  baseline?: Map<string, SettingRow>,
) {
  const response = await page.request.get("/api/admin/emergency/kill-switches");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as {
    code: number;
    data: {
      activeGates: Array<{ key: string; enabled: boolean; emergency: boolean; lastChange: string }>;
      autoConfirmations: Array<{
        key: string;
        incidentId: string;
        ruleId: string;
        signalValue: string;
        threshold: string;
        triggeredAt: string;
        dueAt: string;
      }>;
    };
  };
  expect(payload.code).toBe(0);
  const gate = payload.data.activeGates.find((candidate) => candidate.key === "withdraw");
  expect(gate).toMatchObject({ enabled: expected.enabled, emergency: expected.emergency });
  const confirmation = payload.data.autoConfirmations.find((candidate) => candidate.key === "withdraw");
  expect(Boolean(confirmation)).toBe(expected.pending);
  if (baseline && confirmation) {
    expect(confirmation).toMatchObject({
      incidentId: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.incidentId`)?.settingValue,
      ruleId: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.ruleId`)?.settingValue,
      signalValue: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.signalValue`)?.settingValue,
      threshold: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.threshold`)?.settingValue,
      triggeredAt: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.triggeredAt`)?.settingValue,
      dueAt: baseline.get(`${WITHDRAW_PREFIX}auto-confirm.dueAt`)?.settingValue,
    });
    expect(gate?.lastChange).toBe(baseline.get(`${WITHDRAW_PREFIX}lastChange`)?.settingValue);
  }
}

type DualLedgerSnapshot = {
  reserveUsd: number;
  liabilitiesUsd: number;
  coverageRatio: number;
  redlinePct: number;
};

async function readDualLedger(page: Page): Promise<DualLedgerSnapshot> {
  const response = await page.request.get("/api/admin/treasury/dual-ledger");
  expect(response.status(), await response.text()).toBe(200);
  const payload = await response.json() as {
    code: number;
    data: { snapshot: Record<string, unknown> };
  };
  expect(payload.code).toBe(0);
  const snapshot = payload.data.snapshot;
  return {
    reserveUsd: finiteNumber(snapshot.reserveUsd, "reserveUsd"),
    liabilitiesUsd: finiteNumber(snapshot.liabilitiesUsd, "liabilitiesUsd"),
    coverageRatio: finiteNumber(snapshot.coverageRatio, "coverageRatio"),
    redlinePct: finiteNumber(snapshot.redlinePct, "redlinePct"),
  };
}

async function assertCoverageRestored(page: Page, before: DualLedgerSnapshot) {
  const after = await readDualLedger(page);
  expect(after.reserveUsd).toBe(before.reserveUsd);
  expect(after.liabilitiesUsd).toBe(before.liabilitiesUsd);
  expect(after.coverageRatio).toBe(before.coverageRatio);
  expect(after.redlinePct).toBe(before.redlinePct);
}

function finiteNumber(value: unknown, label: string) {
  const parsed = Number(value);
  expect(Number.isFinite(parsed), `${label} must be finite`).toBe(true);
  return parsed;
}

function readWithdrawRows(): SettingRow[] {
  const raw = mysql(`
    SELECT JSON_OBJECT(
      'id',id,
      'settingKey',setting_key,
      'settingValue',setting_value,
      'valueType',value_type,
      'groupCode',group_code,
      'remark',remark,
      'operator',operator,
      'createdAt',DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s'),
      'updatedAt',DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s'),
      'isDeleted',is_deleted
    )
      FROM nx_emergency_control_setting
     WHERE setting_key='killswitch.withdraw'
        OR setting_key LIKE '${WITHDRAW_PREFIX}%'
     ORDER BY setting_key;
  `);
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as SettingRow);
}

function restoreMutableRows(before: SettingRow[]) {
  const mutableKeys = new Set([
    "killswitch.withdraw",
    `${WITHDRAW_PREFIX}emergency`,
    `${WITHDRAW_PREFIX}lastChange`,
    `${WITHDRAW_PREFIX}auto-confirm.pending`,
  ]);
  const rows = before.filter((row) => mutableKeys.has(row.settingKey));
  mysql(`
    START TRANSACTION;
    ${rows.map((row) => `
      UPDATE nx_emergency_control_setting
         SET setting_value=${sqlValue(row.settingValue)},
             value_type=${sqlValue(row.valueType)},
             group_code=${sqlValue(row.groupCode)},
             remark=${sqlValue(row.remark)},
             operator=${sqlValue(row.operator)},
             created_at=${sqlValue(row.createdAt)},
             updated_at=${sqlValue(row.updatedAt)},
             is_deleted=${row.isDeleted}
       WHERE id=${row.id} AND setting_key=${sqlValue(row.settingKey)};
    `).join("\n")}
    COMMIT;
  `);
}

function assertRestoredRows(before: SettingRow[]) {
  const after = readWithdrawRows();
  const beforeByKey = new Map(before.map((row) => [row.settingKey, row]));
  const afterByKey = new Map(after.map((row) => [row.settingKey, row]));
  expect([...afterByKey.keys()].sort()).toEqual([...beforeByKey.keys()].sort());
  for (const [key, expected] of beforeByKey) {
    if (key === `${WITHDRAW_PREFIX}auto-confirm.lastReminderAt`) continue;
    expect(afterByKey.get(key), `J1 row ${key} must match its pre-run snapshot`).toEqual(expected);
  }
  const idempotencyResidue = Number(mysql(`
    SELECT COUNT(*) FROM nx_admin_idempotency_record
     WHERE idempotency_key LIKE 'k3-j1-coverage-blocked-%'
        OR idempotency_key LIKE 'k3-j1-enable-%'
        OR idempotency_key LIKE 'k3-j1-disable-%';
  `));
  expect(idempotencyResidue).toBe(0);
}

function assertAutoConfirmWindowIsNotNear(dueAt: string) {
  const normalized = dueAt.replace(/(\.\d{3})\d+$/, "$1");
  const dueAtMs = Date.parse(normalized);
  expect(Number.isFinite(dueAtMs), `invalid J1 auto-confirm dueAt ${dueAt}`).toBe(true);
  const remainingMs = dueAtMs - Date.now();
  expect(
    remainingMs <= 0 || remainingMs > 15 * 60_000,
    `J1 auto-confirm window is too near (${Math.ceil(remainingMs / 1000)}s)`,
  ).toBe(true);
}

function mysql(sql: string) {
  const result = spawnSync(
    MYSQL,
    ["--default-character-set=utf8mb4", "-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql],
    {
      encoding: "utf8",
      env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
    },
  );
  if (result.status !== 0) throw new Error(`MYSQL_FAILED:${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sqlValue(value: string | null) {
  if (value == null) return "NULL";
  return `CONVERT(0x${Buffer.from(value, "utf8").toString("hex")} USING utf8mb4)`;
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
