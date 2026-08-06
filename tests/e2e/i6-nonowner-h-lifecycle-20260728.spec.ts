import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
};

type ApiEnvelope<T> = {
  code: number;
  message?: string;
  data: T;
};

type MessageView = {
  key: string;
  zh: string;
  en: string;
  vi: string;
  version: string;
  status: string;
};

type AppBundle = {
  locale: string;
  messages: Record<string, string>;
  serverCanonical: boolean;
};

const DB_NAME = process.env.NEXION_ACCEPTANCE_DB || "nexion_acceptance_20260728_151023";
const DB_PASSWORD = process.env.NEXION_ACCEPTANCE_DB_PASSWORD;
if (!DB_PASSWORD) throw new Error("NEXION_ACCEPTANCE_DB_PASSWORD is required");
const MYSQL = process.env.NEXION_MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const BACKEND_BASE_URL = process.env.NEXION_BACKEND_BASE_URL || "http://127.0.0.1:8110";
const LOCAL_EDGE_COUNTRY_HEADER = "X-Nexion-Edge-Country";
const LOCAL_EDGE_COUNTRY = "JP";
const EVIDENCE_ROOT = process.env.I6_REVIEW_H_EVIDENCE_ROOT
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/I/review-H/I6-lifecycle";

test("I6 可见入口贯通草稿、幂等、CAS、发布、App、归档与回滚", async ({ page }) => {
  const suffix = Date.now().toString(36);
  const messageKey = `acceptance.i6.owner_r114336_${suffix}`;
  const idempotencyPrefix = `i6-owner-life-${suffix}`;
  const operator = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
  const v1 = {
    zh: "I6 非 Owner 生命周期初始中文",
    en: "Initial lifecycle copy from I6 non-owner",
    vi: "Bản dịch vòng đời ban đầu từ I6 non-owner",
  };
  const v2 = {
    zh: "I6 非 Owner 生命周期第二版中文",
    en: "Second lifecycle copy from I6 non-owner",
    vi: "Bản dịch vòng đời thứ hai từ I6 non-owner",
  };
  const v3 = {
    zh: "I6 非 Owner 生命周期第三版中文",
    en: "Third lifecycle copy from I6 non-owner",
    vi: "Bản dịch vòng đời thứ ba từ I6 non-owner",
  };
  const evidence: Record<string, unknown> = {
    runId: "pc-full-acceptance-20260729-114336",
    module: "I6",
    reviewer: "I-owner",
    messageKey,
  };

  try {
    await login(page, {
      username: operator,
      password: process.env.ADMIN_E2E_PASSWORD || "Admin@123456",
      totpSecret: process.env.ADMIN_E2E_TOTP_SECRET || "",
    });
    await openI6(page);
    await saveDraftFromVisibleForm(page, messageKey, v1);
    await page.screenshot({
      path: evidencePath(`${suffix}-01-visible-v1-draft.png`),
      fullPage: true,
    });

    const draftV2Body = localizedBody(v2, "v1", operator, "I6 非 Owner 草稿 v2 幂等与 CAS 验收");
    const draftV2 = await command<MessageView>(
      page,
      "PATCH",
      `/api/admin/content/i18n-learning/messages/${messageKey}/draft`,
      `${idempotencyPrefix}-draft-v2`,
      draftV2Body,
      200,
    );
    expect(draftV2.data.version).toBe("v2");
    expect(draftV2.data.status).toBe("draft");

    const replayV2 = await command<MessageView>(
      page,
      "PATCH",
      `/api/admin/content/i18n-learning/messages/${messageKey}/draft`,
      `${idempotencyPrefix}-draft-v2`,
      draftV2Body,
      200,
    );
    expect(replayV2).toEqual(draftV2);

    const sameKeyDifferentPayload = await command<MessageView>(
      page,
      "PATCH",
      `/api/admin/content/i18n-learning/messages/${messageKey}/draft`,
      `${idempotencyPrefix}-draft-v2`,
      localizedBody(
        { ...v2, zh: "同一幂等键的不同载荷必须被拒绝" },
        "v1",
        operator,
        "I6 非 Owner 同键异载荷失败关闭",
      ),
      409,
    );
    const staleVersion = await command<MessageView>(
      page,
      "PATCH",
      `/api/admin/content/i18n-learning/messages/${messageKey}/draft`,
      `${idempotencyPrefix}-stale-v1`,
      localizedBody(v3, "v1", operator, "I6 非 Owner 旧版本 CAS 必须失败关闭"),
      409,
    );
    evidence.idempotencyAndCas = {
      firstVersion: draftV2.data.version,
      replayVersion: replayV2.data.version,
      sameKeyDifferentPayload: sameKeyDifferentPayload.message,
      staleVersion: staleVersion.message,
    };

    const publishedV2 = await command<MessageView>(
      page,
      "POST",
      `/api/admin/content/i18n-learning/messages/${messageKey}/publish`,
      `${idempotencyPrefix}-publish-v2`,
      localizedBody(v2, "v2", operator, "I6 非 Owner 发布 v2 并验证 App 消费"),
      200,
    );
    expect(publishedV2.data).toMatchObject({ version: "v2", status: "published" });
    await expectAppValue(page, messageKey, v2.zh);

    const draftV3 = await command<MessageView>(
      page,
      "PATCH",
      `/api/admin/content/i18n-learning/messages/${messageKey}/draft`,
      `${idempotencyPrefix}-draft-v3`,
      localizedBody(v3, "v2", operator, "I6 非 Owner 从已发布 v2 创建 v3 草稿"),
      200,
    );
    expect(draftV3.data).toMatchObject({ version: "v3", status: "draft" });
    const publishedV3 = await command<MessageView>(
      page,
      "POST",
      `/api/admin/content/i18n-learning/messages/${messageKey}/publish`,
      `${idempotencyPrefix}-publish-v3`,
      localizedBody(v3, "v3", operator, "I6 非 Owner 发布 v3 并验证 App 切换"),
      200,
    );
    expect(publishedV3.data).toMatchObject({ version: "v3", status: "published" });
    await expectAppValue(page, messageKey, v3.zh);

    const archivedV3 = await command<MessageView>(
      page,
      "DELETE",
      `/api/admin/content/i18n-learning/messages/${messageKey}`,
      `${idempotencyPrefix}-archive-v3`,
      versionBody("v3", operator, "I6 非 Owner 归档 v3 并验证 App 下线"),
      200,
    );
    expect(archivedV3.data).toMatchObject({ version: "v3", status: "archived" });
    await expectAppValue(page, messageKey, undefined);

    const rolledBack = await command<MessageView>(
      page,
      "POST",
      `/api/admin/content/i18n-learning/messages/${messageKey}/versions/v2/rollback`,
      `${idempotencyPrefix}-rollback-v2`,
      versionBody("v3", operator, "I6 非 Owner 从已归档 v3 回滚到 v2"),
      200,
    );
    expect(rolledBack.data).toMatchObject({
      version: "v4",
      status: "published",
      zh: v2.zh,
      en: v2.en,
      vi: v2.vi,
    });
    await expectAppValue(page, messageKey, v2.zh);

    const archivedV4 = await command<MessageView>(
      page,
      "DELETE",
      `/api/admin/content/i18n-learning/messages/${messageKey}`,
      `${idempotencyPrefix}-archive-v4`,
      versionBody("v4", operator, "I6 非 Owner 归档回滚生成的 v4 并恢复隔离状态"),
      200,
    );
    expect(archivedV4.data).toMatchObject({ version: "v4", status: "archived" });
    await expectAppValue(page, messageKey, undefined);

    const versions = await command<MessageView[]>(
      page,
      "GET",
      `/api/admin/content/i18n-learning/messages/${messageKey}/versions`,
      undefined,
      undefined,
      200,
    );
    expect(versions.data.map((row) => `${row.version}:${row.status}`)).toEqual([
      "v4:archived",
      "v3:archived",
      "v2:archived",
    ]);

    const dbEvidence = queryFixtureEvidence(messageKey);
    expect(dbEvidence.messageRows).toBe(3);
    expect(dbEvidence.activeVersions).toBe(3);
    expect(dbEvidence.allVersions).toBe(4);
    expect(dbEvidence.deletedVersions).toBe(1);
    expect(dbEvidence.auditCount).toBeGreaterThanOrEqual(8);
    expect(dbEvidence.auditActors).toContain(operator);
    expect(dbEvidence.outboxCount).toBe(5);
    expect(dbEvidence.pendingTickets).toBe(0);
    expect(dbEvidence.objectLocks).toBe(0);
    evidence.lifecycle = {
      publishedV2: publishedV2.data,
      publishedV3: publishedV3.data,
      archivedV3: archivedV3.data,
      rolledBack: rolledBack.data,
      archivedV4: archivedV4.data,
      visibleVersions: versions.data,
      database: dbEvidence,
    };
    writeFileSync(
      evidencePath(`${suffix}-i6-lifecycle-evidence.json`),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  } finally {
    cleanupMutableFixture(messageKey, idempotencyPrefix);
  }
});

async function command<T>(
  page: Page,
  method: "GET" | "PATCH" | "POST" | "DELETE",
  url: string,
  idempotencyKey: string | undefined,
  data: unknown,
  expectedStatus: number,
) {
  const options = {
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
    data,
  };
  let response: APIResponse;
  if (method === "GET") response = await page.request.get(url, options);
  else if (method === "PATCH") response = await page.request.patch(url, options);
  else if (method === "POST") response = await page.request.post(url, options);
  else response = await page.request.delete(url, options);
  const payload = await response.json() as ApiEnvelope<T>;
  expect(response.status(), `${method} ${url}: ${JSON.stringify(payload)}`).toBe(expectedStatus);
  return payload;
}

async function expectAppValue(page: Page, messageKey: string, expected: string | undefined) {
  const response = await page.request.get(`${BACKEND_BASE_URL}/api/content/i18n?locale=zh-CN`, {
    headers: localTrustedEdgeHeaders(),
  });
  const payload = await response.json() as ApiEnvelope<AppBundle>;
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  expect(payload.code).toBe(0);
  expect(payload.data.serverCanonical).toBe(true);
  if (expected === undefined) {
    expect(payload.data.messages).not.toHaveProperty(messageKey);
  } else {
    expect(payload.data.messages[messageKey]).toBe(expected);
  }
}

function localTrustedEdgeHeaders(): Record<string, string> {
  const backend = new URL(BACKEND_BASE_URL);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(backend.hostname)) {
    throw new Error("I6 acceptance geo carrier may only inject trusted edge metadata on loopback");
  }
  return { [LOCAL_EDGE_COUNTRY_HEADER]: LOCAL_EDGE_COUNTRY };
}

async function login(page: Page, account: FixtureAccount) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await username.fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await Promise.race([
      otp.waitFor({ state: "visible", timeout: 10_000 }),
      shell.waitFor({ state: "visible", timeout: 10_000 }),
    ]);
    if (await shell.isVisible().catch(() => false)) return;
    if (!account.totpSecret) throw new Error(`TOTP secret is required for ${account.username}`);
    const code = await freshTotp(account.totpSecret);
    const verified = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await otp.fill(code);
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verified;
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (response.status() === 200) {
      await expect(shell).toBeVisible({ timeout: 20_000 });
      return;
    }
    failures.push(`${response.status()}:${payload?.message ?? "UNKNOWN"}`);
    if (payload?.message !== "ADMIN_MFA_CODE_REPLAYED") break;
  }
  throw new Error(`MFA login failed: ${failures.join(",")}`);
}

async function openI6(page: Page) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  if (await group.isVisible({ timeout: 5_000 }).catch(() => false)) await group.click();
  const link = page.locator('a[href="/content/i18n"]').first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/content\/i18n(?:\?.*)?$/);
  await expect(page.getByText("I6 数据加载中...")).toHaveCount(0, { timeout: 20_000 });
}

async function saveDraftFromVisibleForm(
  page: Page,
  messageKey: string,
  copy: { zh: string; en: string; vi: string },
) {
  await page.getByRole("button", { name: "新增词条", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const form = dialog.locator('[data-business-form="localized-copy"]');
  await expect(form).toBeVisible();
  await form.locator('input[type="text"]').first().fill(messageKey);
  await form.locator("textarea").nth(0).fill(copy.zh);
  await form.locator("textarea").nth(1).fill(copy.en);
  await form.locator("textarea").nth(2).fill(copy.vi);
  await dialog.getByLabel(/操作理由\(必填/).fill("I6 非 Owner 从可见入口创建隔离生命周期草稿");
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && response.url().includes(`/api/admin/content/i18n-learning/messages/${messageKey}/draft`),
  );
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const response = await saved;
  const payload = await response.json();
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  expect(payload?.data).toMatchObject({ version: "v1", status: "draft" });
  await expect(dialog).toBeHidden();
}

function localizedBody(
  copy: { zh: string; en: string; vi: string },
  expectedVersion: string,
  operator: string,
  reason: string,
) {
  return { ...copy, expectedVersion, operator, reason };
}

function versionBody(expectedVersion: string, operator: string, reason: string) {
  return { expectedVersion, operator, reason };
}

function queryFixtureEvidence(messageKey: string) {
  const escapedKey = sql(messageKey);
  const row = mysql(`
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_i18n_message_version
        WHERE message_key='${escapedKey}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_i18n_message_version
        WHERE message_key='${escapedKey}' AND is_deleted=1),
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${escapedKey}' AND is_deleted=0),
      (SELECT COALESCE(GROUP_CONCAT(DISTINCT actor_username ORDER BY actor_username SEPARATOR ','), '')
        FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${escapedKey}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_event_outbox
        WHERE aggregate_type='I18N_MESSAGE' AND aggregate_id='${escapedKey}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_operation_ticket
        WHERE object_text LIKE CONCAT('%', '${escapedKey}', '%')
          AND status='pending' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_id='${escapedKey}' AND is_deleted=0);
  `).split("\t");
  if (row.length !== 9) throw new Error(`Unexpected I6 DB evidence: ${row.join("\\t")}`);
  return {
    messageRows: Number(row[0]),
    activeVersions: Number(row[1]),
    allVersions: Number(row[2]),
    deletedVersions: Number(row[3]),
    auditCount: Number(row[4]),
    auditActors: row[5],
    outboxCount: Number(row[6]),
    pendingTickets: Number(row[7]),
    objectLocks: Number(row[8]),
  };
}

function cleanupMutableFixture(messageKey: string, idempotencyPrefix: string) {
  const escapedKey = sql(messageKey);
  const escapedPrefix = sql(idempotencyPrefix);
  const result = mysql(`
    DELETE FROM nx_i18n_message_version WHERE message_key='${escapedKey}';
    DELETE FROM nx_i18n_message WHERE message_key='${escapedKey}';
    DELETE FROM nx_admin_idempotency_record
      WHERE scope LIKE 'I6\\\\_I18N\\\\_%:${escapedKey}%'
         OR idempotency_key LIKE '${escapedPrefix}%';
    DO SLEEP(2);
    DELETE FROM nx_i18n_message_version WHERE message_key='${escapedKey}';
    DELETE FROM nx_i18n_message WHERE message_key='${escapedKey}';
    DELETE FROM nx_admin_idempotency_record
      WHERE scope LIKE 'I6\\\\_I18N\\\\_%:${escapedKey}%'
         OR idempotency_key LIKE '${escapedPrefix}%';
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key='${escapedKey}'),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE scope LIKE 'I6\\\\_I18N\\\\_%:${escapedKey}%'
           OR idempotency_key LIKE '${escapedPrefix}%'),
      (SELECT COUNT(*) FROM nx_audit_operation_ticket
        WHERE object_text LIKE CONCAT('%', '${escapedKey}', '%')
          AND status='pending' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_id='${escapedKey}' AND is_deleted=0);
  `);
  if (result !== "0\t0\t0\t0\t0") {
    throw new Error(`I6 mutable fixture cleanup failed: ${result}`);
  }
}

function mysql(statement: string) {
  return execFileSync(MYSQL, [
    "-h", "127.0.0.1",
    "-uroot",
    "-N", "-B",
    "-D", DB_NAME,
    "-e", statement,
  ], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  }).trim().split(/\r?\n/).at(-1) || "";
}

function evidencePath(fileName: string) {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  return path.join(EVIDENCE_ROOT, fileName);
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret, step);
}

function currentTotp(secret: string, step: number) {
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
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
