import { createHash, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { finalAccount } from "./helpers/d-final6-review-harness";

const TOKEN = required("E_FINAL7_XDOM_NEGATIVE_TOKEN");
const RUN_ID = required("E_FINAL7_RUN_ID");
const OPERATION_ID = required("E_FINAL7_OPERATION_ID");
const BUILD_ID = required("E_FINAL7_BUILD_ID");
const JAR_SHA256 = required("E_FINAL7_JAR_SHA256").toUpperCase();
const JAR_PATH = required("E_FINAL7_JAR_PATH");
const E_MANIFEST = required("E_FINAL7_PERMISSION_MANIFEST");
const E_MANIFEST_SHA256 = required("E_FINAL7_PERMISSION_MANIFEST_SHA256").toUpperCase();
const CROSS_MANIFEST = required("E_FINAL7_CROSS_MANIFEST");
const CROSS_MANIFEST_SHA256 = required("E_FINAL7_CROSS_MANIFEST_SHA256").toUpperCase();
const EVIDENCE_DIR = required("E_FINAL7_XDOM_EVIDENCE_DIR");
const DB_NAME = required("E_FINAL7_DB_NAME");
const DB_PASSWORD = required("E_FINAL7_DB_PASSWORD");
const MYSQL = process.env.E_FINAL7_MYSQL ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const checker = finalAccount("e3e6_checker");

type CrossManifest = {
  runId?: string;
  pendingOperation?: {
    operationId?: string;
    expectedInitialStatus?: string;
    expectedECheckerApproveStatus?: number;
    businessDomain?: string;
    roleId?: number;
    roleCode?: string;
  };
  pendingRole?: { permissionCodes?: string[]; menuCodes?: string[] };
};

type Snapshot = {
  operationId: string;
  status: string;
  decisionReason: string | null;
  decidedAt: string | null;
  roleCode: string;
  rolePermissionCodes: string[];
  roleMenuCodes: string[];
  objectLocks: number;
};

test.use({ trace: "on", screenshot: "only-on-failure", video: "off" });
test.describe.configure({ mode: "serial", timeout: 180_000 });

test("Final7 E checker enters visible A2 then performs the one authorized API permission probe without mutation", async ({ page }) => {
  expect(TOKEN).toBe("E_FINAL7_XDOM_API_NEGATIVE");
  expect(RUN_ID).toBe("pc-full-acceptance-20260729-114336");
  expect(OPERATION_ID).toBe("WO-260801171303781-0");
  expect(fileSha256(E_MANIFEST)).toBe(E_MANIFEST_SHA256);
  expect(fileSha256(CROSS_MANIFEST)).toBe(CROSS_MANIFEST_SHA256);
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim()).toBe(BUILD_ID);
  expect(fileSha256(JAR_PATH)).toBe(JAR_SHA256);

  const cross = JSON.parse(readFileSync(CROSS_MANIFEST, "utf8")) as CrossManifest;
  expect(cross.runId).toBe(RUN_ID);
  expect(cross.pendingOperation).toMatchObject({
    operationId: OPERATION_ID,
    expectedInitialStatus: "pending",
    expectedECheckerApproveStatus: 403,
    businessDomain: "A6",
  });
  expect(cross.pendingRole?.permissionCodes).toEqual(["platform_a8_read"]);
  expect(cross.pendingRole?.menuCodes).toEqual(["A", "A8"]);
  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const before = databaseSnapshot(cross);
  expect(before.status).toBe("pending");
  expect(before.decisionReason).toBeNull();
  expect(before.decidedAt).toBeNull();
  expect(before.rolePermissionCodes).toEqual([]);
  expect(before.roleMenuCodes).toEqual([]);
  expect(before.objectLocks).toBe(1);

  await loginStable(page);
  await assertECheckerSession(page);
  await openVisibleA2(page);
  const row = page.locator("tbody tr").filter({ has: page.getByText(OPERATION_ID, { exact: true }) });
  await expect(row).toHaveCount(0);
  await expect(page.getByText(/当前筛选条件下没有高敏操作/)).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-a2-cross-domain-hidden.png"), fullPage: true });

  const response = await page.request.post(`/api/admin/platform/audit/operations/${OPERATION_ID}/approve`, {
    headers: { "Idempotency-Key": `${RUN_ID}-E_FINAL7_XDOM_API_NEGATIVE-${OPERATION_ID}` },
    data: {
      reason: `${RUN_ID} Final7 E checker API cross-domain A6 approval must fail closed`,
      operator: checker.username,
    },
  });
  const body = await response.json().catch(() => ({})) as { code?: number; message?: string };
  expect(response.status()).toBe(403);
  expect(body.code).toBe(403);
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-after-api-403.png"), fullPage: true });

  const after = databaseSnapshot(cross);
  expect(after).toEqual(before);
  writeFileSync(path.join(EVIDENCE_DIR, "safe-summary.json"), `${JSON.stringify({
    runId: RUN_ID,
    candidate: { buildId: BUILD_ID, jarSha256: JAR_SHA256 },
    manifests: { e: E_MANIFEST_SHA256, cross: CROSS_MANIFEST_SHA256 },
    operationId: OPERATION_ID,
    actor: { username: checker.username, roleCode: checker.roleCode },
    tracks: { visibleA2: "CROSS_DOMAIN_ROW_HIDDEN", apiPermission: "EXPECTED_403" },
    request: { method: "POST", action: "approve", attempts: 1, idempotencyKeyReused: false },
    response: { httpStatus: response.status(), code: body.code, message: body.message ?? null },
    before,
    after,
    unchanged: true,
    forbiddenActions: { reject: 0, cancel: 0, eBusinessWrites: 0 },
  }, null, 2)}\n`);
});

async function assertECheckerSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: { session?: { roleCode?: string; authorities?: string[]; effectiveMenus?: Array<string | { code?: string }> } } };
  const session = payload.data?.session;
  expect(session?.roleCode).toBe(checker.roleCode);
  expect(session?.authorities ?? []).toEqual(expect.arrayContaining([
    "platform_a2_read", "platform_a2_operation_approve", "device_e3_read", "device_e3_write", "device_e6_read", "device_e6_write",
  ]));
  const menus = (session?.effectiveMenus ?? []).map((item) => typeof item === "string" ? item : item.code ?? "");
  expect(menus).toEqual(expect.arrayContaining(["A2", "E3", "E6"]));
}

async function loginStable(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  const password = page.locator('input[autocomplete="current-password"]');
  await expect(username).toBeVisible({ timeout: 20_000 });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await username.fill(checker.username);
    await password.fill(checker.password);
    await expect(username).toHaveValue(checker.username);
    await expect(password).toHaveValue(checker.password);
    await page.waitForTimeout(300);
    if (await username.inputValue() !== checker.username || await password.inputValue() !== checker.password) continue;
    const responsePending = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/api/admin/auth/login",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "继续", exact: true }).click();
    const response = await responsePending.catch(() => null);
    if (!response) continue;
    const body = await response.json().catch(() => ({})) as { code?: number };
    expect(response.status()).toBe(200);
    expect(body.code).toBe(0);
    break;
  }
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 20_000 });
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await page.waitForTimeout((remaining + 1) * 1_000);
  await otp.fill(currentTotp(checker.totpSecret));
  const verifyPending = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST" && new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const verify = await verifyPending;
  expect(verify.status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

async function openVisibleA2(page: Page) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('aside a[href="/platform/audit"]').first();
  if (!await link.isVisible().catch(() => false)) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await expect(page.getByRole("heading", { name: "审计 & 操作确认", exact: true })).toBeVisible();
}

function databaseSnapshot(cross: CrossManifest): Snapshot {
  const roleId = Number(cross.pendingOperation?.roleId);
  const roleCode = sqlString(String(cross.pendingOperation?.roleCode ?? ""));
  const operationId = sqlString(OPERATION_ID);
  const rows = mysql(`
    SELECT JSON_OBJECT(
      'operationId', t.operation_id,
      'status', t.status,
      'decisionReason', t.decision_reason,
      'decidedAt', IF(t.decided_at IS NULL, NULL, DATE_FORMAT(t.decided_at, '%Y-%m-%dT%H:%i:%s')),
      'roleCode', r.role_code,
      'rolePermissionCodes', COALESCE((SELECT JSON_ARRAYAGG(p.permission_code) FROM nx_admin_role_permission rp JOIN nx_admin_permission p ON p.id=rp.permission_id WHERE rp.role_id=r.id), JSON_ARRAY()),
      'roleMenuCodes', COALESCE((SELECT JSON_ARRAYAGG(m.menu_code) FROM nx_admin_role_menu rm JOIN nx_admin_menu m ON m.id=rm.menu_id WHERE rm.role_id=r.id), JSON_ARRAY()),
      'objectLocks', (SELECT COUNT(*) FROM nx_audit_object_lock l WHERE l.ticket_id=t.operation_id AND l.is_deleted=0)
    )
    FROM nx_audit_operation_ticket t
    JOIN nx_admin_role r ON r.id=${roleId} AND r.role_code='${roleCode}'
    WHERE t.operation_id='${operationId}' AND t.is_deleted=0;
  `);
  expect(rows).toHaveLength(1);
  const snapshot = JSON.parse(rows[0]) as Snapshot;
  snapshot.rolePermissionCodes = [...snapshot.rolePermissionCodes].sort();
  snapshot.roleMenuCodes = [...snapshot.roleMenuCodes].sort();
  return snapshot;
}

function mysql(sql: string) {
  return execFileSync(MYSQL, [
    "--default-character-set=utf8mb4", "--host=127.0.0.1", "--user=root", "--batch", "--skip-column-names",
    `--database=${DB_NAME}`, `--execute=${sql}`,
  ], { encoding: "utf8", windowsHide: true, env: { ...process.env, MYSQL_PWD: DB_PASSWORD } })
    .trim().split(/\r?\n/).filter(Boolean);
}

function fileSha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function sqlString(value: string) {
  if (!/^[A-Z0-9_.-]+$/i.test(value)) throw new Error("UNSAFE_SQL_IDENTIFIER_VALUE");
  return value;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
