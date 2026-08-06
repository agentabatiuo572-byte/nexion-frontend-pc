import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type Page } from "@playwright/test";
import {
  assertDedicatedLeafMenuContract,
  assertLocalFCandidate,
  currentFCaseNonce,
  currentFRunId,
  fAcceptanceIdempotencyKey,
  loadFDedicatedActors,
  loginFActor,
} from "./helpers/f-acceptance-harness";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type Ticket = {
  id?: string;
  operationId?: string;
  status?: string;
  sourceDomain?: string;
  obj?: string;
};
type Session = {
  roleCode?: string;
  authorities?: string[];
  effectiveMenus?: Array<string | { code?: string }>;
};
type ConfigOverview = { configValues?: Record<string, string> };
type F5ConfigOverview = {
  configValues?: {
    commissionAnomalySigma?: string;
    layerRatioAnomalyPct?: string;
  };
};
type F25Snapshot = {
  f2Cooldown: string;
  f3Spillover: string;
  f4LeaderboardMinUsd: string;
  f5Sigma: string;
  f5LayerRatio: string;
};
type ConfigPhysicalRow = {
  id: string;
  key: string;
  value: string;
  createdAt: string;
  updatedAt: string;
};
type F5PhysicalBaseline = {
  capturedAt: string;
  sigma: ConfigPhysicalRow | null;
  ratio: ConfigPhysicalRow | null;
  nonTargetFingerprint: string;
};
type A2Change = {
  module: "F2" | "F3" | "F4";
  key: string;
  value: string;
};

const RUN_ID = currentFRunId();
const CASE_NONCE = currentFCaseNonce();
const EVIDENCE_DIR = process.env.F25_WRITE_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/f25-success-cleanup`;
const ACTORS = loadFDedicatedActors(RUN_ID);
const F_MAKER = ACTORS.fMaker;
const F25_CHECKER = ACTORS.f25Checker;
const CONFIG_KEYS = {
  F2: "F.cooldown",
  F3: "F.binary.spillover",
  F4: "F.leaderboard.minUsd",
  F5_SIGMA: "commission/anomaly-sigma",
  F5_RATIO: "commission/layer-ratio-anomaly-pct",
} as const;

test.beforeAll(() => {
  expect(process.env.F_WRITE_TOKEN, "F_WRITE_TOKEN=1 is required").toBe("1");
  expect(
    process.env.F_WRITE_BYPASS,
    "F_WRITE_BYPASS=false must be explicitly confirmed by the main controller",
  ).toBe("false");
  expect(process.env.F_DB_READ_TOKEN, "F_DB_READ_TOKEN=1 is required").toBe("1");
  expect(
    process.env.F_FIXTURE_SQL_CLEANUP_TOKEN,
    "F_FIXTURE_SQL_CLEANUP_TOKEN=1 is required for exact physical-absence recovery",
  ).toBe("1");
  assertLocalFCandidate();
  requireDatabaseGate();
  assertNoIdempotencyCollision();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F2-F5 专属 f25_checker 可见成功生命周期、A2 审批、DB/A4 与独立精确恢复", async ({ browser }) => {
  test.setTimeout(360_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const pendingOperationIds = new Set<string>();
  const a2OperationIds = new Set<string>();
  const f5OperationNos = new Set<string>();
  const result: Record<string, unknown> = {
    runId: RUN_ID,
    caseNonce: CASE_NONCE,
    actors: {
      maker: F_MAKER.username,
      f25Checker: F25_CHECKER.username,
      credentialMaterialPersisted: false,
    },
  };
  let snapshot: F25Snapshot | undefined;
  let f5PhysicalBaseline: F5PhysicalBaseline | undefined;
  let primaryError: Error | undefined;

  try {
    await loginFActor(maker, F_MAKER, "f25-success-maker");
    await loginFActor(checker, F25_CHECKER, "f25-success-checker");
    await assertMakerBoundary(maker);
    await assertF25Boundary(checker);

    snapshot = await readSnapshot(maker);
    f5PhysicalBaseline = captureF5PhysicalBaseline();
    assertSnapshotCanBeRestoredExactly(snapshot);
    assertDatabaseSnapshotBefore(snapshot, f5PhysicalBaseline);
    result.snapshot = snapshot;
    result.f5PhysicalBaseline = {
      capturedAt: f5PhysicalBaseline.capturedAt,
      sigmaAbsent: f5PhysicalBaseline.sigma === null,
      ratioAbsent: f5PhysicalBaseline.ratio === null,
      nonTargetFingerprint: f5PhysicalBaseline.nonTargetFingerprint,
    };

    const changes = buildTemporaryChanges(snapshot);
    result.temporaryChanges = changes;
    for (const change of changes) {
      const changedOperationId = await submitVisibleA2Change(
        maker,
        change,
        `${RUN_ID} ${change.module} 隔离环境临时变更并预置精确恢复`,
      );
      pendingOperationIds.add(changedOperationId);
      a2OperationIds.add(changedOperationId);
      await assertMakerCannotSelfApprove(maker, changedOperationId, change.module);
      await approveThroughVisibleA2(
        checker,
        changedOperationId,
        `${RUN_ID} f25_checker 核对 ${change.module} 临时值和恢复快照后批准`,
      );
      pendingOperationIds.delete(changedOperationId);
      expect(await readA2ConfigValue(checker, change), `${change.module} API temporary value`)
        .toBe(change.value);
      expect(readDatabaseConfig(change.key), `${change.module} DB temporary value`).toBe(change.value);

      const restore = {
        ...change,
        value: originalForChange(snapshot, change),
      };
      const restoreOperationId = await submitVisibleA2Change(
        maker,
        restore,
        `${RUN_ID} ${change.module} 按验收前快照精确恢复`,
      );
      pendingOperationIds.add(restoreOperationId);
      a2OperationIds.add(restoreOperationId);
      await approveThroughVisibleA2(
        checker,
        restoreOperationId,
        `${RUN_ID} f25_checker 核对 ${change.module} 原始快照后批准恢复`,
      );
      pendingOperationIds.delete(restoreOperationId);
      expect(await readA2ConfigValue(checker, change), `${change.module} API exact restore`)
        .toBe(restore.value);
      expect(readDatabaseConfig(change.key), `${change.module} DB exact restore`).toBe(restore.value);
    }

    const changedSigma = alternateSigma(snapshot.f5Sigma);
    const f5ChangeOperationNo = await submitVisibleF5AnomalyChange(
      checker,
      changedSigma,
      snapshot.f5LayerRatio,
      `${RUN_ID} F5 隔离环境临时异常阈值并预置精确恢复`,
    );
    f5OperationNos.add(f5ChangeOperationNo);
    expect((await readSnapshot(checker)).f5Sigma, "F5 API temporary sigma").toBe(changedSigma);
    expect(readDatabaseConfig(CONFIG_KEYS.F5_SIGMA), "F5 DB temporary sigma").toBe(changedSigma);

    const f5RestoreOperationNo = await submitVisibleF5AnomalyChange(
      checker,
      snapshot.f5Sigma,
      snapshot.f5LayerRatio,
      `${RUN_ID} F5 按验收前快照精确恢复异常阈值`,
    );
    f5OperationNos.add(f5RestoreOperationNo);
    expect((await readSnapshot(checker)).f5Sigma, "F5 API exact restore sigma").toBe(snapshot.f5Sigma);
    expect(readDatabaseConfig(CONFIG_KEYS.F5_SIGMA), "F5 DB exact restore sigma")
      .toBe(snapshot.f5Sigma);

    const database = databaseClosure([...a2OperationIds], [...f5OperationNos]);
    expect(database.a2Tickets).toHaveLength(a2OperationIds.size);
    expect(
      database.a2Tickets.every((row) => row[1] === "approved"),
      `all F2-F4 A2 tickets must be approved: ${JSON.stringify(database.a2Tickets)}`,
    ).toBe(true);
    expect(
      new Set(database.a2Tickets.map((row) => row[2])),
      "F2-F4 A2 tickets must retain canonical F domain",
    ).toEqual(new Set(["F"]));
    expect(
      new Set(database.a2Tickets.map((row) => row[3])),
      "F2-F4 A2 tickets must retain exact leaf config objects",
    ).toEqual(new Set([CONFIG_KEYS.F2, CONFIG_KEYS.F3, CONFIG_KEYS.F4]));
    expect(database.f5Operations).toHaveLength(f5OperationNos.size);
    expect(
      database.f5Operations.every((row) => row[1] === "SUCCESS" && row[2] === "ANOMALY_CONFIG"),
      `F5 operations must be successful anomaly-config writes: ${JSON.stringify(database.f5Operations)}`,
    ).toBe(true);
    for (const operationId of a2OperationIds) {
      expect(database.auditByOperation[operationId], `A2 audit ${operationId}`).toBeGreaterThan(0);
      expect(database.a2OutboxByOperation[operationId], `A2 operation outbox ${operationId}`).toBe(1);
    }
    for (const operationNo of f5OperationNos) {
      expect(database.f5AuditByOperation[operationNo], `F5 A2 audit ${operationNo}`).toBeGreaterThan(0);
      expect(database.f5OutboxByOperation[operationNo], `F5 A4/outbox ${operationNo}`).toBeGreaterThan(0);
    }
    result.a2OperationIds = [...a2OperationIds];
    result.f5OperationNos = [...f5OperationNos];
    result.databaseClosure = database;
    await checker.screenshot({
      path: path.join(EVIDENCE_DIR, "f25-final-restored.png"),
      fullPage: true,
    });
  } catch (error: unknown) {
    primaryError = asError(error);
    result.primaryError = primaryError.message;
  } finally {
    const terminalErrors: Error[] = [];
    await makerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    await checkerContext.close().catch((error: unknown) => terminalErrors.push(asError(error)));
    try {
      result.independentFinally = await independentCleanup(
        browser,
        snapshot,
        pendingOperationIds,
        f5PhysicalBaseline,
      );
    } catch (error: unknown) {
      terminalErrors.push(asError(error));
    }
    if (primaryError) terminalErrors.unshift(primaryError);
    try {
      writeFileSync(
        path.join(EVIDENCE_DIR, "f25-success-cleanup.json"),
        JSON.stringify(result, null, 2),
      );
    } catch (error: unknown) {
      terminalErrors.push(asError(error));
    }
    if (terminalErrors.length) {
      throw new AggregateError(terminalErrors, "F2-F5 success lifecycle or independent cleanup failed");
    }
  }
});

function buildTemporaryChanges(snapshot: F25Snapshot): A2Change[] {
  return [
    {
      module: "F2",
      key: CONFIG_KEYS.F2,
      value: alternateCooldown(snapshot.f2Cooldown),
    },
    {
      module: "F3",
      key: CONFIG_KEYS.F3,
      value: snapshot.f3Spillover === "已启用" ? "已关闭" : "已启用",
    },
    {
      module: "F4",
      key: CONFIG_KEYS.F4,
      value: String(Number(snapshot.f4LeaderboardMinUsd) + 1),
    },
  ];
}

function originalForChange(snapshot: F25Snapshot, change: A2Change) {
  if (change.module === "F2") return snapshot.f2Cooldown;
  if (change.module === "F3") return snapshot.f3Spillover;
  return snapshot.f4LeaderboardMinUsd;
}

async function submitVisibleA2Change(page: Page, change: A2Change, reason: string) {
  if (change.module === "F2") {
    await openLeaf(page, "/network/royalty");
    const cooldownCard = page.locator(".param").filter({ hasText: CONFIG_KEYS.F2 });
    await expect(cooldownCard, "visible F.cooldown parameter card").toBeVisible();
    await cooldownCard.getByRole("button", { name: "调整", exact: true }).click();
    const dialog = operationDialog(page);
    await dialog.getByLabel("目标新值").fill(change.value);
    return await submitDialogForTicket(page, dialog, reason, "F2");
  }
  if (change.module === "F3") {
    await openLeaf(page, "/network/binary");
    await page.getByRole("button", { name: "分配策略", exact: true }).click();
    const dialog = operationDialog(page);
    await dialog.getByRole("button", { name: change.value, exact: true }).click();
    return await submitDialogForTicket(page, dialog, reason, "F3");
  }
  await openLeaf(page, "/network/leadership-pool");
  await page.getByRole("button", { name: "榜单最小额", exact: true }).click();
  const dialog = operationDialog(page);
  await dialog.getByLabel("目标新值").fill(change.value);
  return await submitDialogForTicket(page, dialog, reason, "F4");
}

async function submitDialogForTicket(
  page: Page,
  dialog: ReturnType<typeof operationDialog>,
  reason: string,
  module: string,
) {
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const ticket = await success<Ticket>(await responsePromise, `${module} visible proposal`);
  const operationId = String(ticket.id ?? ticket.operationId ?? "");
  expect(operationId, `${module} operation id`).toMatch(/^(?:WO|OP)-/);
  await expect(dialog).toHaveCount(0);
  return operationId;
}

async function submitVisibleF5AnomalyChange(
  page: Page,
  sigma: string,
  ratio: string,
  reason: string,
) {
  await openLeaf(page, "/network/commissions");
  await page.getByRole("button", { name: "调整阈值", exact: true }).click();
  const dialog = operationDialog(page);
  await dialog.getByLabel("金额偏离 σ").fill(sigma);
  await dialog.getByLabel("层比例偏离 %").fill(ratio);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "PUT"
    && new URL(response.url()).pathname === "/api/admin/teams/commissions/anomaly-config");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const data = await success<{ operationNo?: string }>(
    await responsePromise,
    "F5 visible anomaly threshold change",
  );
  const operationNo = String(data.operationNo ?? "");
  expect(operationNo, "F5 operation number").not.toBe("");
  await expect(dialog).toHaveCount(0);
  return operationNo;
}

function operationDialog(page: Page) {
  return page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
}

async function openLeaf(page: Page, href: string) {
  const group = page.getByRole("button", { name: /分销与团队\s+F|F\s+分销与团队/ }).first();
  const link = page.locator(`a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
  await expect(page.locator("main")).toBeVisible();
}

async function approveThroughVisibleA2(page: Page, operationId: string, reason: string) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr")
    .filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) })
    .first();
  await expect(row, `f25_checker visible A2 row ${operationId}`).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = operationDialog(page);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await success(await responsePromise, `approve ${operationId}`);
  await expect(row).toHaveCount(0);
}

async function assertMakerCannotSelfApprove(page: Page, operationId: string, module: string) {
  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
    {
      headers: {
        "Idempotency-Key": caseIdempotencyKey(`${module}-maker-self-approve-${operationId}`),
      },
      data: { reason: `${RUN_ID} maker 不得自批 ${module}` },
    },
  );
  const body = await envelope(response);
  expect(
    response.status() === 403 || body.code === 403,
    `${module} maker self approval must be 403: ${JSON.stringify(body)}`,
  ).toBe(true);
}

async function readSnapshot(page: Page): Promise<F25Snapshot> {
  const [f2, f3, f4, f5] = await Promise.all([
    success<ConfigOverview>(await page.request.get("/api/admin/teams/rates"), "F2 snapshot"),
    success<ConfigOverview>(await page.request.get("/api/admin/teams/binary"), "F3 snapshot"),
    success<ConfigOverview>(await page.request.get("/api/admin/teams/leadership-pool"), "F4 snapshot"),
    success<F5ConfigOverview>(await page.request.get("/api/admin/teams/commissions"), "F5 snapshot"),
  ]);
  return {
    f2Cooldown: f2.configValues?.[CONFIG_KEYS.F2] ?? "",
    f3Spillover: f3.configValues?.[CONFIG_KEYS.F3] ?? "",
    f4LeaderboardMinUsd: f4.configValues?.[CONFIG_KEYS.F4] ?? "",
    f5Sigma: f5.configValues?.commissionAnomalySigma ?? "",
    f5LayerRatio: f5.configValues?.layerRatioAnomalyPct ?? "",
  };
}

function assertSnapshotCanBeRestoredExactly(snapshot: F25Snapshot) {
  expect(snapshot.f2Cooldown).toBe(String(Number(snapshot.f2Cooldown)));
  expect(Number(snapshot.f2Cooldown)).toBeGreaterThanOrEqual(0);
  expect(Number(snapshot.f2Cooldown)).toBeLessThanOrEqual(90);
  expect(snapshot.f3Spillover).toMatch(/^(?:已启用|已关闭)$/);
  expect(snapshot.f4LeaderboardMinUsd).toBe(String(Number(snapshot.f4LeaderboardMinUsd)));
  expect(Number(snapshot.f4LeaderboardMinUsd)).toBeGreaterThanOrEqual(0);
  expect(snapshot.f5Sigma).toBe(String(Number(snapshot.f5Sigma)));
  expect(Number(snapshot.f5Sigma)).toBeGreaterThanOrEqual(2);
  expect(Number(snapshot.f5Sigma)).toBeLessThanOrEqual(5);
  expect(snapshot.f5LayerRatio).toBe(String(Number(snapshot.f5LayerRatio)));
  expect(Number(snapshot.f5LayerRatio)).toBeGreaterThanOrEqual(10);
  expect(Number(snapshot.f5LayerRatio)).toBeLessThanOrEqual(50);
}

function assertDatabaseSnapshotBefore(
  snapshot: F25Snapshot,
  baseline: F5PhysicalBaseline,
) {
  expect(readDatabaseConfig(CONFIG_KEYS.F2), "F2 API/DB snapshot").toBe(snapshot.f2Cooldown);
  expect(readDatabaseConfig(CONFIG_KEYS.F3), "F3 API/DB snapshot").toBe(snapshot.f3Spillover);
  expect(readDatabaseConfig(CONFIG_KEYS.F4), "F4 API/DB snapshot").toBe(snapshot.f4LeaderboardMinUsd);
  assertF5PhysicalOrDefault(
    baseline.sigma,
    snapshot.f5Sigma,
    "3",
    "F5 sigma API/DB-or-default snapshot",
  );
  assertF5PhysicalOrDefault(
    baseline.ratio,
    snapshot.f5LayerRatio,
    "20",
    "F5 ratio API/DB-or-default snapshot",
  );
}

function assertF5PhysicalOrDefault(
  row: ConfigPhysicalRow | null,
  apiValue: string,
  defaultValue: string,
  label: string,
) {
  if (row) {
    expect(row.value, label).toBe(apiValue);
    return;
  }
  expect(apiValue, `${label}: physical row absent must resolve to service default`).toBe(defaultValue);
}

function captureF5PhysicalBaseline(): F5PhysicalBaseline {
  const capturedAt = mysqlRows(
    "SELECT DATE_FORMAT(NOW(6),'%Y-%m-%d %H:%i:%s.%f');",
  )[0]?.[0] ?? "";
  expect(capturedAt, "database baseline timestamp").toMatch(
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
  );
  return {
    capturedAt,
    sigma: readPhysicalConfig(CONFIG_KEYS.F5_SIGMA),
    ratio: readPhysicalConfig(CONFIG_KEYS.F5_RATIO),
    nonTargetFingerprint: nonTargetConfigFingerprint(),
  };
}

function readPhysicalConfig(key: string): ConfigPhysicalRow | null {
  const rows = mysqlRows(
    "SELECT id,config_key,config_value,"
      + "DATE_FORMAT(created_at,'%Y-%m-%d %H:%i:%s.%f'),"
      + "DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i:%s.%f') "
      + `FROM nx_config_item WHERE config_key='${sqlText(key)}' AND is_deleted=0 ORDER BY id;`,
  );
  expect(rows, `physical config key must be unique: ${key}`).toHaveLength(
    rows.length === 0 ? 0 : 1,
  );
  if (!rows.length) return null;
  return {
    id: rows[0][0],
    key: rows[0][1],
    value: rows[0][2],
    createdAt: rows[0][3],
    updatedAt: rows[0][4],
  };
}

function nonTargetConfigFingerprint() {
  const acceptanceTargetKeys = [
    databaseConfigKey(CONFIG_KEYS.F2),
    databaseConfigKey(CONFIG_KEYS.F3),
    databaseConfigKey(CONFIG_KEYS.F4),
    CONFIG_KEYS.F5_SIGMA,
    CONFIG_KEYS.F5_RATIO,
  ];
  const rows = mysqlRows(
    "SELECT id,config_key,config_value,value_type,config_group,visibility,"
      + "COALESCE(remark,''),status,is_deleted FROM nx_config_item "
      + "WHERE (config_key LIKE 'team.ui.F.%' OR config_key LIKE 'commission/%') "
      + `AND config_key NOT IN (${sqlList(acceptanceTargetKeys)}) ORDER BY id;`,
  );
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function assertDatabaseConfigValues(snapshot: F25Snapshot) {
  expect(readDatabaseConfig(CONFIG_KEYS.F2), "F2 API/DB restored value").toBe(snapshot.f2Cooldown);
  expect(readDatabaseConfig(CONFIG_KEYS.F3), "F3 API/DB restored value").toBe(snapshot.f3Spillover);
  expect(readDatabaseConfig(CONFIG_KEYS.F4), "F4 API/DB restored value")
    .toBe(snapshot.f4LeaderboardMinUsd);
  const sigma = readPhysicalConfig(CONFIG_KEYS.F5_SIGMA);
  const ratio = readPhysicalConfig(CONFIG_KEYS.F5_RATIO);
  if (sigma) expect(sigma.value, "F5 sigma physical restored value").toBe(snapshot.f5Sigma);
  if (ratio) expect(ratio.value, "F5 ratio physical restored value").toBe(snapshot.f5LayerRatio);
}

function restoreF5PhysicalBaseline(
  snapshot: F25Snapshot,
  baseline: F5PhysicalBaseline,
) {
  const removed: ConfigPhysicalRow[] = [];
  const targets = [
    { key: CONFIG_KEYS.F5_SIGMA, value: snapshot.f5Sigma, before: baseline.sigma },
    { key: CONFIG_KEYS.F5_RATIO, value: snapshot.f5LayerRatio, before: baseline.ratio },
  ];
  for (const target of targets) {
    const current = readPhysicalConfig(target.key);
    if (target.before) {
      expect(current, `pre-existing physical config must remain present: ${target.key}`)
        .not.toBeNull();
      expect(current?.id, `${target.key} physical identity`).toBe(target.before.id);
      expect(current?.value, `${target.key} physical restored value`).toBe(target.value);
      expect(current?.createdAt, `${target.key} physical creation identity`)
        .toBe(target.before.createdAt);
      continue;
    }
    if (!current) continue;
    expect(current.value, `${target.key} fixture value before physical recovery`).toBe(target.value);
    expect(current.id, `${target.key} fixture row id`).toMatch(/^\d+$/);
    expect(current.createdAt, `${target.key} fixture created timestamp`).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
    );
    expect(current.updatedAt, `${target.key} fixture updated timestamp`).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{6}$/,
    );
    expect(
      current.createdAt >= baseline.capturedAt,
      `${target.key} fixture row must have been created after baseline ${baseline.capturedAt}`,
    ).toBe(true);
    const affected = mysqlNumber(
      "DELETE FROM nx_config_item WHERE "
        + `id=${current.id} `
        + `AND config_key='${sqlText(current.key)}' `
        + `AND config_value='${sqlText(current.value)}' `
        + `AND created_at='${sqlText(current.createdAt)}' `
        + `AND updated_at='${sqlText(current.updatedAt)}' `
        + "AND is_deleted=0; SELECT ROW_COUNT();",
    );
    expect(affected, `exact fixture SQL cleanup must remove one row: ${target.key}`).toBe(1);
    expect(readPhysicalConfig(target.key), `${target.key} physical absence restored`).toBeNull();
    removed.push(current);
  }
  const afterFingerprint = nonTargetConfigFingerprint();
  expect(afterFingerprint, "non-target config fingerprint must remain unchanged")
    .toBe(baseline.nonTargetFingerprint);
  return {
    authorized: true,
    reason: "restore physical absence after reversible acceptance fixture write",
    removed,
    afterPhysicalAbsent: {
      sigma: baseline.sigma === null
        ? readPhysicalConfig(CONFIG_KEYS.F5_SIGMA) === null
        : false,
      ratio: baseline.ratio === null
        ? readPhysicalConfig(CONFIG_KEYS.F5_RATIO) === null
        : false,
    },
    apiDefaultsRestored: baseline.sigma === null
      && baseline.ratio === null
      && snapshot.f5Sigma === "3"
      && snapshot.f5LayerRatio === "20",
    nonTargetFingerprintBefore: baseline.nonTargetFingerprint,
    nonTargetFingerprintAfter: afterFingerprint,
    nonTargetFingerprintUnchanged: true,
    immutableAuditOutboxAndCommissionOperationsRetained: true,
  };
}

function assertDatabaseConfigValuesAfterPhysicalRecovery(
  snapshot: F25Snapshot,
  baseline: F5PhysicalBaseline,
) {
  expect(readDatabaseConfig(CONFIG_KEYS.F2), "F2 DB exact restore").toBe(snapshot.f2Cooldown);
  expect(readDatabaseConfig(CONFIG_KEYS.F3), "F3 DB exact restore").toBe(snapshot.f3Spillover);
  expect(readDatabaseConfig(CONFIG_KEYS.F4), "F4 DB exact restore")
    .toBe(snapshot.f4LeaderboardMinUsd);
  assertF5PhysicalOrDefault(
    readPhysicalConfig(CONFIG_KEYS.F5_SIGMA),
    snapshot.f5Sigma,
    "3",
    "F5 sigma physical baseline recovery",
  );
  assertF5PhysicalOrDefault(
    readPhysicalConfig(CONFIG_KEYS.F5_RATIO),
    snapshot.f5LayerRatio,
    "20",
    "F5 ratio physical baseline recovery",
  );
  if (baseline.sigma === null) {
    expect(readPhysicalConfig(CONFIG_KEYS.F5_SIGMA), "F5 sigma must return to physical absence")
      .toBeNull();
  }
  if (baseline.ratio === null) {
    expect(readPhysicalConfig(CONFIG_KEYS.F5_RATIO), "F5 ratio must return to physical absence")
      .toBeNull();
  }
}

async function readA2ConfigValue(page: Page, change: A2Change) {
  const endpoint = change.module === "F2"
    ? "/api/admin/teams/rates"
    : change.module === "F3"
      ? "/api/admin/teams/binary"
      : "/api/admin/teams/leadership-pool";
  const overview = await success<ConfigOverview>(
    await page.request.get(endpoint),
    `${change.module} config read`,
  );
  return overview.configValues?.[change.key] ?? "";
}

function alternateSigma(original: string) {
  const value = Number(original);
  return String(value < 5 ? value + 0.5 : value - 0.5);
}

function alternateCooldown(original: string) {
  const value = Number(original);
  return String(value < 90 ? value + 1 : value - 1);
}

async function assertMakerBoundary(page: Page) {
  const data = await session(page);
  const authorities = data.authorities ?? [];
  expect(authorityDomains(authorities), "F maker must remain F-only").toEqual(["F"]);
  expect(authorities).toEqual(expect.arrayContaining([
    "network_f2_read",
    "network_f3_read",
    "network_f4_read",
    "network_f5_read",
  ]));
}

async function assertF25Boundary(page: Page) {
  const data = await session(page);
  const authorities = data.authorities ?? [];
  expect(data.roleCode, "dedicated F2-F5 checker role").toBe(ACTORS.f25CheckerRoleCode);
  await assertDedicatedLeafMenuContract(page, data.effectiveMenus ?? [], "f25-checker");
  expect(authorities).toEqual(expect.arrayContaining([
    "platform_a2_read",
    "platform_a2_operation_approve",
    "network_f2_read",
    "network_f3_read",
    "network_f4_read",
    "network_f5_read",
    "network_f2_policy_amplify",
    "network_f3_match_rate",
    "network_f4_write",
    "network_f5_write",
  ]));
  expect(authorities.some((code) => code.startsWith("network_f1_")), "F2-F5 checker must exclude F1")
    .toBe(false);
  expect(authorityDomains(authorities), "F2-F5 checker must remain F-only").toEqual(["F"]);
}

async function session(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await response.json() as Envelope<{ session?: Session }>;
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.code, JSON.stringify(body)).toBe(0);
  return body.data?.session ?? {};
}

function authorityDomains(authorities: string[]) {
  const domains = new Set<string>();
  for (const authority of authorities) {
    const match = authority.match(/^(?:network_)?([a-m])(?:\d+)?_/i);
    if (match) domains.add(match[1].toUpperCase());
  }
  return [...domains].sort();
}

async function independentCleanup(
  browser: Browser,
  snapshot: F25Snapshot | undefined,
  pendingOperationIds: Set<string>,
  f5PhysicalBaseline: F5PhysicalBaseline | undefined,
) {
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const errors: Error[] = [];
  const cleanup: Record<string, unknown> = {
    independentContexts: true,
    pendingAtEntry: [...pendingOperationIds],
  };
  try {
    await loginFActor(maker, F_MAKER, "f25-finally-maker");
    await loginFActor(checker, F25_CHECKER, "f25-finally-checker");
    for (const operationId of [...pendingOperationIds]) {
      try {
        const decision = await decideByApi(
          checker,
          operationId,
          "reject",
          caseIdempotencyKey(`f25-finally-reject-${operationId}`),
          `${RUN_ID} f25 independent finally 清理未终态 ticket`,
        );
        if (decision.body.code !== 0 && decision.body.code !== 409) {
          throw new Error(`F25 pending cleanup failed ${operationId}: ${JSON.stringify(decision.body)}`);
        }
        pendingOperationIds.delete(operationId);
      } catch (error: unknown) {
        errors.push(asError(error));
      }
    }

    if (snapshot) {
      const restores: A2Change[] = [
        { module: "F2", key: CONFIG_KEYS.F2, value: snapshot.f2Cooldown },
        { module: "F3", key: CONFIG_KEYS.F3, value: snapshot.f3Spillover },
        { module: "F4", key: CONFIG_KEYS.F4, value: snapshot.f4LeaderboardMinUsd },
      ];
      const cleanupRestores: string[] = [];
      for (const restore of restores) {
        try {
          const current = await readA2ConfigValue(maker, restore);
          if (current === restore.value) continue;
          const proposalResponse = await maker.request.post("/api/admin/platform/audit/operations", {
            headers: {
              "Idempotency-Key": caseIdempotencyKey(`f25-finally-restore-${restore.module}`),
            },
            data: proposal(
              restore.key,
              current,
              restore.value,
              `${RUN_ID} ${restore.module} independent finally 按快照精确恢复`,
            ),
          });
          const proposalBody = await envelope<Ticket>(proposalResponse);
          expect(proposalBody.code, JSON.stringify(proposalBody)).toBe(0);
          const operationId = String(proposalBody.data?.id ?? proposalBody.data?.operationId ?? "");
          expect(operationId).toMatch(/^(?:WO|OP)-/);
          const approved = await decideByApi(
            checker,
            operationId,
            "approve",
            caseIdempotencyKey(`f25-finally-approve-${restore.module}`),
            `${RUN_ID} f25_checker 核对 independent finally 精确恢复`,
          );
          expect(approved.body.code, JSON.stringify(approved.body)).toBe(0);
          cleanupRestores.push(operationId);
        } catch (error: unknown) {
          errors.push(asError(error));
        }
      }

      try {
        const currentF5 = await readSnapshot(checker);
        if (
          currentF5.f5Sigma !== snapshot.f5Sigma
          || currentF5.f5LayerRatio !== snapshot.f5LayerRatio
        ) {
          const response = await checker.request.put(
            "/api/admin/teams/commissions/anomaly-config",
            {
              headers: {
                "Idempotency-Key": caseIdempotencyKey("f25-finally-f5-restore"),
              },
              data: {
                commissionAnomalySigma: Number(snapshot.f5Sigma),
                layerRatioAnomalyPct: Number(snapshot.f5LayerRatio),
                reason: `${RUN_ID} F5 independent finally 按快照精确恢复`,
                operator: "server-authenticated",
              },
            },
          );
          await success(response, "F5 independent finally restore");
          cleanup.f5Restored = true;
        }
      } catch (error: unknown) {
        errors.push(asError(error));
      }
      try {
        expect(await readSnapshot(maker), "F2-F5 API exact restore before fixture recovery")
          .toEqual(snapshot);
        assertDatabaseConfigValues(snapshot);
        if (!f5PhysicalBaseline) {
          throw new Error("F5 physical baseline missing after snapshot acquisition");
        }
        cleanup.fixtureSqlCleanup = restoreF5PhysicalBaseline(snapshot, f5PhysicalBaseline);
        expect(await readSnapshot(maker), "F2-F5 API exact restore after fixture recovery")
          .toEqual(snapshot);
        assertDatabaseConfigValuesAfterPhysicalRecovery(snapshot, f5PhysicalBaseline);
        cleanup.exactSnapshotRestored = true;
      } catch (error: unknown) {
        errors.push(asError(error));
      }
      cleanup.restoreOperationIds = cleanupRestores;
    } else {
      cleanup.restoreSkipped = "snapshot was never acquired; no successful write was authorized";
    }
    try {
      expect(pendingOperationIds.size, "no pending F2-F5 ticket may escape finally").toBe(0);
    } catch (error: unknown) {
      errors.push(asError(error));
    }
    try {
      await assertMakerBoundary(maker);
      await assertF25Boundary(checker);
      cleanup.independentActorBoundaryValidated = true;
    } catch (error: unknown) {
      errors.push(asError(error));
    }
    cleanup.pendingAtExit = [...pendingOperationIds];
  } catch (error: unknown) {
    errors.push(asError(error));
  } finally {
    await makerContext.close().catch((error: unknown) => errors.push(asError(error)));
    await checkerContext.close().catch((error: unknown) => errors.push(asError(error)));
  }
  if (errors.length) throw new AggregateError(errors, "independent F2-F5 cleanup failed");
  return cleanup;
}

function proposal(key: string, before: string, after: string, reason: string) {
  const sourceDomain = key.startsWith("F.binary.") ? "F3"
    : key.startsWith("F.leaderboard.") ? "F4"
      : "F2";
  return {
    action: `网络 UI 开关/文案配置 · ${key}`,
    obj: key,
    beforeValue: before,
    afterValue: after,
    operator: "server-authenticated",
    operatorRole: "增长",
    type: "param",
    amplifies: false,
    sos: false,
    roleGate: "门槛者",
    reason,
    sourceDomain,
    command: { domain: "F", op: "f_ui_config", params: { key, value: after } },
    target: { domain: "F", type: "ui_config", id: key },
  };
}

async function decideByApi(
  page: Page,
  operationId: string,
  decision: "approve" | "reject",
  idempotencyKey: string,
  reason: string,
) {
  const response = await page.request.post(
    `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/${decision}`,
    {
      headers: { "Idempotency-Key": idempotencyKey },
      data: { reason },
    },
  );
  return { response, body: await envelope(response) };
}

function databaseClosure(a2OperationIds: string[], f5OperationNos: string[]) {
  const a2List = sqlList(a2OperationIds);
  const f5List = sqlList(f5OperationNos);
  return {
    a2Tickets: mysqlRows(
      `SELECT operation_id,status,source_domain,object_text FROM nx_audit_operation_ticket `
        + `WHERE is_deleted=0 AND operation_id IN (${a2List}) ORDER BY operation_id;`,
    ),
    auditByOperation: Object.fromEntries(a2OperationIds.map((operationId) => [
      operationId,
      mysqlNumber(
        "SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND ("
          + `COALESCE(resource_id,'')='${sqlText(operationId)}' `
          + `OR COALESCE(biz_no,'')='${sqlText(operationId)}' `
          + `OR CAST(detail_json AS CHAR) LIKE '%${sqlText(operationId)}%');`,
      ),
    ])),
    a2OutboxByOperation: Object.fromEntries(a2OperationIds.map((operationId) => [
      operationId,
      mysqlNumber(
        `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 `
          + `AND (CAST(payload AS CHAR) LIKE '%${sqlText(operationId)}%' `
          + `OR COALESCE(aggregate_id,'')='${sqlText(operationId)}');`,
      ),
    ])),
    f5Operations: mysqlRows(
      `SELECT operation_no,status,operation_type FROM nx_commission_operation `
        + `WHERE operation_no IN (${f5List}) ORDER BY operation_no;`,
    ),
    f5AuditByOperation: Object.fromEntries(f5OperationNos.map((operationNo) => [
      operationNo,
      mysqlNumber(
        "SELECT COUNT(*) FROM nx_audit_log WHERE is_deleted=0 AND ("
          + `COALESCE(resource_id,'')='${sqlText(operationNo)}' `
          + `OR COALESCE(biz_no,'')='${sqlText(operationNo)}' `
          + `OR CAST(detail_json AS CHAR) LIKE '%${sqlText(operationNo)}%');`,
      ),
    ])),
    f5OutboxByOperation: Object.fromEntries(f5OperationNos.map((operationNo) => [
      operationNo,
      mysqlNumber(
        `SELECT COUNT(*) FROM nx_event_outbox WHERE is_deleted=0 `
          + `AND (CAST(payload AS CHAR) LIKE '%${sqlText(operationNo)}%' `
          + `OR COALESCE(aggregate_id,'')='${sqlText(operationNo)}');`,
      ),
    ])),
  };
}

function readDatabaseConfig(key: string) {
  const databaseKey = databaseConfigKey(key);
  const rows = mysqlRows(
    `SELECT config_value FROM nx_config_item WHERE config_key='${sqlText(databaseKey)}' `
      + "AND is_deleted=0 ORDER BY id DESC LIMIT 1;",
  );
  expect(rows, `DB config row must pre-exist for exact restore: ${databaseKey}`).toHaveLength(1);
  return rows[0][0];
}

function databaseConfigKey(key: string) {
  return key.startsWith("F.") ? `team.ui.${key}` : key;
}

function requireDatabaseGate() {
  const executable = mysqlExecutable();
  if (!existsSync(executable)) throw new Error(`MySQL client not found: ${executable}`);
  const database = mysqlDatabase();
  if (!/^[A-Za-z0-9_]+$/.test(database)) {
    throw new Error(`unsafe F_ACCEPTANCE_MYSQL_DATABASE: ${database}`);
  }
  if (!(process.env.F_ACCEPTANCE_MYSQL_PASSWORD ?? "")) {
    throw new Error("F_ACCEPTANCE_MYSQL_PASSWORD is required");
  }
}

function caseIdempotencyKey(suffix: string) {
  return fAcceptanceIdempotencyKey(RUN_ID, CASE_NONCE, suffix);
}

function assertNoIdempotencyCollision() {
  const prefix = `${RUN_ID}-${CASE_NONCE}-`;
  const collisions = mysqlNumber(
    "SELECT COUNT(*) FROM nx_admin_idempotency_record "
      + `WHERE idempotency_key LIKE '${sqlText(prefix)}%';`,
  );
  expect(
    collisions,
    `F2-F5 idempotency collision preflight must be zero for ${prefix}`,
  ).toBe(0);
}

function mysqlRows(query: string) {
  const result = spawnSync(mysqlExecutable(), [
    "--host", process.env.F_ACCEPTANCE_MYSQL_HOST ?? "127.0.0.1",
    "--port", process.env.F_ACCEPTANCE_MYSQL_PORT ?? "3306",
    "--user", process.env.F_ACCEPTANCE_MYSQL_USER ?? "root",
    "--default-character-set=utf8mb4",
    "--batch",
    "--raw",
    "--skip-column-names",
    "--execute", query,
    mysqlDatabase(),
  ], {
    encoding: "utf8",
    env: {
      ...process.env,
      MYSQL_PWD: process.env.F_ACCEPTANCE_MYSQL_PASSWORD ?? "",
    },
  });
  if (result.status !== 0) {
    throw new Error(`MySQL read failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  }
  const text = result.stdout.trim();
  return text ? text.split(/\r?\n/).map((row) => row.split("\t")) : [];
}

function mysqlNumber(query: string) {
  const value = Number(mysqlRows(query)[0]?.[0] ?? "");
  if (!Number.isFinite(value)) throw new Error(`MySQL numeric result invalid: ${value}`);
  return value;
}

function mysqlExecutable() {
  return process.env.F_ACCEPTANCE_MYSQL_EXE
    ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
}

function mysqlDatabase() {
  return process.env.F_ACCEPTANCE_MYSQL_DATABASE
    ?? "nexion_acceptance_20260729_114336";
}

function sqlList(values: string[]) {
  return values.length ? values.map((value) => `'${sqlText(value)}'`).join(",") : "''";
}

function sqlText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("%", "\\%");
}

function asError(error: unknown) {
  return error instanceof Error ? error : new Error(String(error));
}

async function success<T>(
  response: APIResponse | { status(): number; json(): Promise<unknown> },
  label: string,
) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

async function envelope<T = unknown>(response: APIResponse) {
  return await response.json() as Envelope<T>;
}
