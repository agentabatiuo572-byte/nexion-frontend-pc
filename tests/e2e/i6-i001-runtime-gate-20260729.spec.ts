import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
  authorities?: string[];
  effectiveMenus?: string[];
};

type PermissionFixture = {
  checker?: FixtureAccount;
  accounts?: {
    maker?: FixtureAccount;
  };
};

type ApiEnvelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type MessageView = {
  key?: string;
  version?: string;
  status?: string;
  zh?: string;
  en?: string;
  vi?: string;
};

type FetchResult = {
  status: number;
  payload: ApiEnvelope<MessageView>;
};

const FIXTURE_PATH = process.env.ADMIN_PERMISSION_FIXTURE;
if (!FIXTURE_PATH) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as PermissionFixture;
const makerAccount = fixture.accounts?.maker;
const checkerAccount = fixture.checker;
if (!makerAccount || !checkerAccount) {
  throw new Error("I-001 requires independent I maker and checker accounts");
}
if (!sameSet(checkerAccount.authorities ?? [], ["content_i6_read", "content_i6_write"])
  || !sameSet(checkerAccount.effectiveMenus ?? [], ["I", "I6"])) {
  throw new Error("I-001 checker must have only I6 read/write and I/I6 menus");
}

const DB_NAME = process.env.NEXION_ACCEPTANCE_DB || "nexion_acceptance_20260729_114336";
const DB_PASSWORD = process.env.NEXION_ACCEPTANCE_DB_PASSWORD;
if (!DB_PASSWORD) throw new Error("NEXION_ACCEPTANCE_DB_PASSWORD is required");
const MYSQL = process.env.NEXION_MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const EVIDENCE_ROOT = process.env.I001_EVIDENCE_ROOT
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final-nf0q/i001-runtime-gate";
const SAFE_EVIDENCE_PATH = path.join(EVIDENCE_ROOT, "i001-runtime-safe.json");
const TOTP_LEASE_DIRECTORY = process.env.I001_TOTP_LEASE_DIRECTORY
  || path.join(EVIDENCE_ROOT, ".coordination", "totp-step-leases");
const TOTP_STEP_MS = 30_000;
const TOTP_MAX_LEASE_ATTEMPTS = 3;

type TotpLease = {
  accountHash: string;
  step: number;
  leasePath: string;
};

type FreshTotp = {
  code: string;
  lease: TotpLease;
};

test.describe.configure({ timeout: 240_000 });

test("I-001 原子 CAS：双登录并发、幂等回放、结果未知与零副作用", async ({ browser }) => {
  const suffix = Date.now().toString(36);
  const casKey = `acceptance.i6.i001.cas.${suffix}`;
  const unknownKey = `acceptance.i6.i001.unknown.${suffix}`;
  const idempotencyPrefix = `i001-${suffix}`;
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const evidence: Record<string, unknown> = {
    runId: "pc-full-acceptance-20260729-114336",
    candidate: {
      pcBuild: "nf0qGeqytfzJ1e_lX9TMR",
      backendJarSha256Prefix: "D1D33E",
      mfaBypass: false,
    },
    messageKeyHashes: {
      cas: safeHash(casKey),
      unknown: safeHash(unknownKey),
    },
    actors: ["maker", "checker"],
  };

  try {
    await login(maker, makerAccount);
    await openI6(maker);
    await saveDraftFromVisibleForm(maker, casKey, "I-001 初始 CAS 草稿");
    await maker.screenshot({
      path: evidencePath("01-maker-visible-v1.png"),
      fullPage: true,
    });

    await login(checker, checkerAccount);
    await openI6(checker);
    await checker.screenshot({
      path: evidencePath("02-checker-visible-i6.png"),
      fullPage: true,
    });

    const casUrl = `/api/admin/content/i18n-learning/messages/${casKey}/draft`;
    const makerIdempotencyKey = `${idempotencyPrefix}-maker`;
    const checkerIdempotencyKey = `${idempotencyPrefix}-checker`;
    const makerBody = localizedBody(
      "I-001 运营员甲并发草稿",
      "I-001 concurrent draft from operator A",
      "Bản nháp đồng thời I-001 từ nhân viên A",
      "v1",
      makerAccount.username,
      "I-001 双连接原子 CAS 验收甲",
    );
    const checkerBody = localizedBody(
      "I-001 运营员乙并发草稿",
      "I-001 concurrent draft from operator B",
      "Bản nháp đồng thời I-001 từ nhân viên B",
      "v1",
      checkerAccount.username,
      "I-001 双连接原子 CAS 验收乙",
    );

    const barrier = concurrentReleaseBarrier();
    await maker.route(`**${casUrl}`, barrier.handler);
    await checker.route(`**${casUrl}`, barrier.handler);
    const [makerResult, checkerResult] = await Promise.all([
      browserFetch(maker, casUrl, makerIdempotencyKey, makerBody),
      browserFetch(checker, casUrl, checkerIdempotencyKey, checkerBody),
    ]);
    await maker.unroute(`**${casUrl}`, barrier.handler);
    await checker.unroute(`**${casUrl}`, barrier.handler);

    expect(barrier.arrivals(), "两个独立浏览器会话必须都抵达并发释放门").toBe(2);
    const results = [
      { actor: "maker", idempotencyKey: makerIdempotencyKey, body: makerBody, result: makerResult },
      { actor: "checker", idempotencyKey: checkerIdempotencyKey, body: checkerBody, result: checkerResult },
    ];
    expect(results.map((row) => row.result.status).sort((a, b) => a - b)).toEqual([200, 409]);
    const winner = results.find((row) => row.result.status === 200);
    const loser = results.find((row) => row.result.status === 409);
    expect(winner?.result.payload.data).toMatchObject({ version: "v2", status: "draft" });
    expect(loser?.result.payload.message).toBe("I18N_MESSAGE_VERSION_CONFLICT");
    if (!winner || !loser) throw new Error("I-001 winner/loser resolution failed");

    const beforeReplay = queryCasEvidence(
      casKey,
      idempotencyPrefix,
      winner.idempotencyKey,
      loser.idempotencyKey,
    );
    expect(beforeReplay.versionRows).toBe(2);
    expect(beforeReplay.versionShape).toBe("v1:DRAFT:1,v2:DRAFT:0");
    expect(beforeReplay.activeVersion).toBe("v2");
    expect(beforeReplay.auditTotal).toBe(2);
    expect(beforeReplay.winnerAudit).toBe(1);
    expect(beforeReplay.loserAudit).toBe(0);
    expect(beforeReplay.outboxCount).toBe(0);
    expect(beforeReplay.pendingTickets).toBe(0);
    expect(beforeReplay.objectLocks).toBe(0);
    expect(beforeReplay.idempotencyRows).toBe(2);

    const replay = await requestPatch(maker, checker, winner.actor, casUrl, winner.idempotencyKey, winner.body);
    expect(replay.status).toBe(200);
    expect(replay.payload).toEqual(winner.result.payload);
    const afterReplay = queryCasEvidence(
      casKey,
      idempotencyPrefix,
      winner.idempotencyKey,
      loser.idempotencyKey,
    );
    expect(afterReplay).toEqual(beforeReplay);

    evidence.concurrentCas = {
      barrierArrivals: barrier.arrivals(),
      statuses: results.map((row) => ({ actor: row.actor, status: row.result.status })),
      winner: { actor: winner.actor, version: winner.result.payload.data?.version },
      loser: { actor: loser.actor, message: loser.result.payload.message },
      databaseBeforeReplay: beforeReplay,
      sameKeyReplayStable: true,
    };

    await saveDraftFromVisibleForm(maker, unknownKey, "I-001 结果未知初始草稿");
    const unknownUrl = `/api/admin/content/i18n-learning/messages/${unknownKey}/draft`;
    const unknownIdempotencyKey = `${idempotencyPrefix}-unknown`;
    const unknownBody = localizedBody(
      "I-001 结果未知安全重试",
      "I-001 unknown outcome retry",
      "Thử lại kết quả không xác định I-001",
      "v1",
      makerAccount.username,
      "I-001 响应中断后同键安全重试",
    );
    let hiddenUpstreamStatus: number | undefined;
    const unknownHandler = async (route: Route) => {
      if (route.request().method() !== "PATCH"
        || route.request().headers()["idempotency-key"] !== unknownIdempotencyKey) {
        await route.continue();
        return;
      }
      const upstream = await route.fetch();
      hiddenUpstreamStatus = upstream.status();
      await route.abort("failed");
    };
    await maker.route(`**${unknownUrl}`, unknownHandler);
    const clientObserved = await maker.evaluate(async ({ url, key, body }) => {
      try {
        const response = await fetch(url, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
          },
          body: JSON.stringify(body),
        });
        return { resolved: true, status: response.status };
      } catch {
        return { resolved: false };
      }
    }, { url: unknownUrl, key: unknownIdempotencyKey, body: unknownBody });
    await maker.unroute(`**${unknownUrl}`, unknownHandler);
    expect(clientObserved.resolved, "客户端必须只观察到响应中断/结果未知").toBe(false);
    expect(hiddenUpstreamStatus, "服务端命令必须已成功提交后才中断响应").toBe(200);

    const unknownRetry = await browserFetch(maker, unknownUrl, unknownIdempotencyKey, unknownBody);
    expect(unknownRetry.status).toBe(200);
    expect(unknownRetry.payload.data).toMatchObject({ version: "v2", status: "draft" });
    const unknownReplay = await browserFetch(maker, unknownUrl, unknownIdempotencyKey, unknownBody);
    expect(unknownReplay).toEqual(unknownRetry);

    const unknownEvidence = queryUnknownEvidence(unknownKey, unknownIdempotencyKey);
    expect(unknownEvidence.versionRows).toBe(2);
    expect(unknownEvidence.versionShape).toBe("v1:DRAFT:1,v2:DRAFT:0");
    expect(unknownEvidence.auditForCommand).toBe(1);
    expect(unknownEvidence.outboxCount).toBe(0);
    expect(unknownEvidence.idempotencyRows).toBe(1);
    evidence.unknownOutcome = {
      clientObserved,
      hiddenUpstreamStatus,
      retryStatus: unknownRetry.status,
      retryVersion: unknownRetry.payload.data?.version,
      secondReplayStable: true,
      database: unknownEvidence,
    };

    await maker.screenshot({
      path: evidencePath("03-i001-gate-passed.png"),
      fullPage: true,
    });
  } finally {
    const cleanup = cleanupMutableFixtures([casKey, unknownKey], idempotencyPrefix);
    evidence.mutableFixtureCleanup = cleanup;
    evidence.generatedAt = new Date().toISOString();
    mkdirSync(EVIDENCE_ROOT, { recursive: true });
    writeFileSync(SAFE_EVIDENCE_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    await Promise.allSettled([makerContext.close(), checkerContext.close()]);
  }
});

function concurrentReleaseBarrier() {
  let arrivalCount = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler = async (route: Route) => {
    arrivalCount += 1;
    if (arrivalCount === 2) release();
    await released;
    await route.continue();
  };
  return {
    handler,
    arrivals: () => arrivalCount,
  };
}

async function browserFetch(
  page: Page,
  url: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<FetchResult> {
  return page.evaluate(async ({ requestUrl, key, payload }) => {
    const response = await fetch(requestUrl, {
      method: "PATCH",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });
    return {
      status: response.status,
      payload: await response.json(),
    };
  }, { requestUrl: url, key: idempotencyKey, payload: body });
}

async function requestPatch(
  maker: Page,
  checker: Page,
  actor: string,
  url: string,
  idempotencyKey: string,
  body: Record<string, unknown>,
): Promise<FetchResult> {
  const page = actor === "maker" ? maker : checker;
  const response = await page.request.patch(url, {
    headers: { "Idempotency-Key": idempotencyKey },
    data: body,
  });
  return {
    status: response.status(),
    payload: await response.json() as ApiEnvelope<MessageView>,
  };
}

async function login(page: Page, account: FixtureAccount) {
  const failures: string[] = [];
  let replayRetries = 0;
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
    expect(account.totpSecret, "MFA account must provide a TOTP secret").not.toBe("");
    await expect(otp).toBeVisible({ timeout: 3_000 });
    await expect(otp).toBeEditable({ timeout: 3_000 });
    const totp = await freshTotp(account.username, account.totpSecret);
    await page.waitForTimeout(250);
    const verifyButton = page.getByRole("button", { name: "验证并进入", exact: true });
    let otpAccepted = false;
    for (let fillAttempt = 0; fillAttempt < 2; fillAttempt += 1) {
      await otp.focus();
      await otp.clear();
      await otp.pressSequentially(totp.code, { delay: 60 });
      await page.waitForTimeout(250);
      try {
        await expect(otp).toHaveValue(totp.code, { timeout: 1_000 });
        await expect(verifyButton).toBeEnabled({ timeout: 1_000 });
        await page.waitForTimeout(100);
        await expect(otp).toHaveValue(totp.code, { timeout: 1_000 });
        await expect(verifyButton).toBeEnabled({ timeout: 1_000 });
        otpAccepted = true;
        break;
      } catch {
        if (fillAttempt === 0) await page.waitForTimeout(150);
      }
    }
    if (!otpAccepted) throw new Error("MFA_OTP_HYDRATION_UNSTABLE");
    await expect(otp).toBeVisible();
    await expect(verifyButton).toBeVisible();
    await expect(verifyButton).toBeEnabled();
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify", { timeout: 20_000 });
    await verifyButton.click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (response.status() === 200) {
      recordTotpStepResult(totp.lease, "accepted");
      await expect(shell).toBeVisible({ timeout: 20_000 });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      return;
    }
    failures.push(`${response.status()}:${payload?.message ?? "UNKNOWN"}`);
    if (response.status() !== 401 || payload?.message !== "ADMIN_MFA_CODE_REPLAYED") break;
    recordTotpStepResult(totp.lease, "replayed");
    if (replayRetries >= 1) break;
    replayRetries += 1;
  }
  throw new Error(`MFA verification failed without bypass: ${failures.join(",")}`);
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

async function saveDraftFromVisibleForm(page: Page, messageKey: string, label: string) {
  await page.getByRole("button", { name: "新增词条", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const form = dialog.locator('[data-business-form="localized-copy"]');
  await expect(form).toBeVisible();
  await form.locator('input[type="text"]').first().fill(messageKey);
  await form.locator("textarea").nth(0).fill(`${label} 中文`);
  await form.locator("textarea").nth(1).fill(`${label} English`);
  await form.locator("textarea").nth(2).fill(`${label} Tiếng Việt`);
  await dialog.getByLabel(/操作理由\(必填/).fill(`${label}，隔离夹具`);
  const saved = page.waitForResponse((response) =>
    response.request().method() === "PATCH"
    && response.url().includes(`/api/admin/content/i18n-learning/messages/${messageKey}/draft`));
  await dialog.getByRole("button", { name: "确认提交" }).click();
  const response = await saved;
  const payload = await response.json();
  expect(response.status(), JSON.stringify(payload)).toBe(200);
  expect(payload?.data).toMatchObject({ version: "v1", status: "draft" });
  await expect(dialog).toBeHidden();
}

function localizedBody(
  zh: string,
  en: string,
  vi: string,
  expectedVersion: string,
  operator: string,
  reason: string,
) {
  return { zh, en, vi, expectedVersion, operator, reason };
}

function queryCasEvidence(
  messageKey: string,
  idempotencyPrefix: string,
  winnerIdempotencyKey: string,
  loserIdempotencyKey: string,
) {
  const key = sql(messageKey);
  const prefix = sql(idempotencyPrefix);
  const winner = sql(winnerIdempotencyKey);
  const loser = sql(loserIdempotencyKey);
  const row = mysql(`
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key='${key}'),
      (SELECT COALESCE(GROUP_CONCAT(CONCAT('v',version_no,':',status,':',is_deleted)
        ORDER BY version_no SEPARATOR ','), '') FROM nx_i18n_message_version WHERE message_key='${key}'),
      (SELECT COALESCE(CONCAT('v',MAX(version_no)), '') FROM nx_i18n_message_version
        WHERE message_key='${key}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${key}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${key}' AND is_deleted=0
          AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey'))='${winner}'),
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${key}' AND is_deleted=0
          AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey'))='${loser}'),
      (SELECT COUNT(*) FROM nx_event_outbox
        WHERE aggregate_type='I18N_MESSAGE' AND aggregate_id='${key}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_operation_ticket
        WHERE object_text LIKE CONCAT('%','${key}','%') AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_id='${key}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE idempotency_key LIKE '${prefix}%' AND is_deleted=0);
  `).split("\t");
  if (row.length !== 10) throw new Error(`Unexpected I-001 DB evidence width: ${row.length}`);
  return {
    versionRows: Number(row[0]),
    versionShape: row[1],
    activeVersion: row[2],
    auditTotal: Number(row[3]),
    winnerAudit: Number(row[4]),
    loserAudit: Number(row[5]),
    outboxCount: Number(row[6]),
    pendingTickets: Number(row[7]),
    objectLocks: Number(row[8]),
    idempotencyRows: Number(row[9]),
  };
}

function queryUnknownEvidence(messageKey: string, idempotencyKey: string) {
  const key = sql(messageKey);
  const idem = sql(idempotencyKey);
  const row = mysql(`
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key='${key}'),
      (SELECT COALESCE(GROUP_CONCAT(CONCAT('v',version_no,':',status,':',is_deleted)
        ORDER BY version_no SEPARATOR ','), '') FROM nx_i18n_message_version WHERE message_key='${key}'),
      (SELECT COUNT(*) FROM nx_audit_log
        WHERE resource_type='I18N_MESSAGE' AND resource_id='${key}' AND is_deleted=0
          AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey'))='${idem}'),
      (SELECT COUNT(*) FROM nx_event_outbox
        WHERE aggregate_type='I18N_MESSAGE' AND aggregate_id='${key}' AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE idempotency_key='${idem}' AND is_deleted=0);
  `).split("\t");
  if (row.length !== 5) throw new Error(`Unexpected I-001 unknown DB evidence width: ${row.length}`);
  return {
    versionRows: Number(row[0]),
    versionShape: row[1],
    auditForCommand: Number(row[2]),
    outboxCount: Number(row[3]),
    idempotencyRows: Number(row[4]),
  };
}

function cleanupMutableFixtures(messageKeys: string[], idempotencyPrefix: string) {
  const keys = messageKeys.map((value) => `'${sql(value)}'`).join(",");
  const prefix = sql(idempotencyPrefix);
  const row = mysql(`
    DELETE FROM nx_i18n_message WHERE message_key IN (${keys});
    DELETE FROM nx_i18n_message_version WHERE message_key IN (${keys});
    DELETE FROM nx_admin_idempotency_record
      WHERE idempotency_key LIKE '${prefix}%'
         OR scope IN (${messageKeys.map((value) => `'I6_I18N_DRAFT:${sql(value).toUpperCase()}'`).join(",")});
    SELECT
      (SELECT COUNT(*) FROM nx_i18n_message WHERE message_key IN (${keys})),
      (SELECT COUNT(*) FROM nx_i18n_message_version WHERE message_key IN (${keys})),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record
        WHERE idempotency_key LIKE '${prefix}%'
           OR scope IN (${messageKeys.map((value) => `'I6_I18N_DRAFT:${sql(value).toUpperCase()}'`).join(",")})),
      (SELECT COUNT(*) FROM nx_audit_operation_ticket
        WHERE object_text LIKE CONCAT('%','${sql(idempotencyPrefix)}','%') AND is_deleted=0),
      (SELECT COUNT(*) FROM nx_audit_object_lock
        WHERE target_id IN (${keys}) AND is_deleted=0);
  `).split("\t");
  if (row.length !== 5 || row.some((value) => value !== "0")) {
    throw new Error(`I-001 mutable fixture cleanup failed: ${row.join("\\t")}`);
  }
  return {
    messageRows: Number(row[0]),
    versionRows: Number(row[1]),
    idempotencyRows: Number(row[2]),
    pendingTickets: Number(row[3]),
    objectLocks: Number(row[4]),
  };
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

function safeHash(value: string) {
  return createHmac("sha256", "i001-safe-evidence").update(value).digest("hex").slice(0, 16);
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

function sameSet(left: string[], right: string[]) {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

async function freshTotp(accountId: string, secret: string): Promise<FreshTotp> {
  for (let leaseAttempt = 0; leaseAttempt < TOTP_MAX_LEASE_ATTEMPTS; leaseAttempt += 1) {
    const now = Date.now();
    const step = Math.floor(now / TOTP_STEP_MS);
    const remaining = 30 - (Math.floor(now / 1_000) % 30);
    if (remaining <= 3) {
      await waitForTotpStep(step + 1);
      continue;
    }
    const lease = tryAcquireTotpStepLease(accountId, step);
    if (lease) return { code: currentTotp(secret, step), lease };
    await waitForTotpStep(step + 1);
  }
  throw new Error("TOTP_STEP_LEASE_UNAVAILABLE");
}

function tryAcquireTotpStepLease(accountId: string, step: number): TotpLease | null {
  const accountHash = createHmac("sha256", "i001-totp-lease").update(accountId).digest("hex").slice(0, 24);
  const leasePath = path.join(TOTP_LEASE_DIRECTORY, `${accountHash}.${step}.lease`);
  mkdirSync(TOTP_LEASE_DIRECTORY, { recursive: true });
  try {
    // The filename/data contain only a one-way account hash and TOTP step, never a secret or code.
    writeFileSync(leasePath, JSON.stringify({ schema: 1, step, acquiredAt: Date.now() }), { flag: "wx" });
    return { accountHash, step, leasePath };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
    throw error;
  }
}

function recordTotpStepResult(lease: TotpLease, outcome: "accepted" | "replayed") {
  const resultPath = `${lease.leasePath}.${outcome}`;
  try {
    writeFileSync(resultPath, JSON.stringify({ schema: 1, step: lease.step, outcome, recordedAt: Date.now() }), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function waitForTotpStep(nextStep: number) {
  const delay = Math.max(0, (nextStep * TOTP_STEP_MS) - Date.now() + 500);
  await new Promise((resolve) => setTimeout(resolve, delay));
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
