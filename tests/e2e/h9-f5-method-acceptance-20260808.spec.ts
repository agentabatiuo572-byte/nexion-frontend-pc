import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, request as playwrightRequest, test, type APIResponse, type Browser, type Page } from "@playwright/test";
import { loginFActor, type FAcceptanceAccount } from "./helpers/f-acceptance-harness";

type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type HFixture = {
  runId?: string;
  accounts?: Record<string, FAcceptanceAccount | undefined>;
};
type H9Overview = {
  version: number;
  effectiveAt: string;
  values: {
    fleetDevices: number;
    onlineRatePct: number;
    onlineJitter: number;
    registeredUsersBase: number;
    registeredUsersMonthlyGrowthPct: number;
    registeredUsersAnchorAt: number;
    virtualUserCount: number;
    hashratePercentileTable: Array<{ tops: number; cumPct: number }>;
    effectiveAt?: number;
  };
};
type Ticket = { id?: string; operationId?: string; status?: string };
type CommissionRow = { id: string; version: number; status: string; userId: string };

const RUN_ID = process.env.HF_METHOD_RUN_ID ?? `H9-F5-UA-${Date.now()}`;
const EVIDENCE_DIR = process.env.HF_METHOD_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/hard-block-method-acceptance-20260808/${RUN_ID}`;
const H_FIXTURE_PATH = process.env.H_PERMISSION_FIXTURE_PATH
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/H.json";
const F_FIXTURE_PATH = process.env.F_PERMISSION_FIXTURE_PATH
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/F.json";
const F_ACTORS_PATH = process.env.F_DEDICATED_ACTORS_MANIFEST
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/F/final12-owner/fixtures/F-final12-r3-dedicated-actors.json";
const F5_MARKER = `${RUN_ID}-F5`;
const PRIOR_F5_ORPHAN_EVENT_IDS = (process.env.HF_F5_ORPHAN_EVENT_IDS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);
const PRIOR_F5_ORPHAN_IDEMPOTENCY_KEYS = (process.env.HF_F5_ORPHAN_IDEMPOTENCY_KEYS ?? "")
  .split(",").map((value) => value.trim()).filter(Boolean);

const hFixture = JSON.parse(readFileSync(H_FIXTURE_PATH, "utf8")) as HFixture;
const fFixture = JSON.parse(readFileSync(F_FIXTURE_PATH, "utf8")) as HFixture;
const fActors = JSON.parse(readFileSync(F_ACTORS_PATH, "utf8")) as {
  finalAccounts?: Record<string, FAcceptanceAccount | undefined>;
};
const hMakerSource = fixtureAccount(hFixture, "maker");
const fMakerSource = fixtureAccount(fFixture, "maker");
void fActors;

let hPrimary: FAcceptanceAccount;
let hSecondWriter: FAcceptanceAccount;
let hReadonlyActor: FAcceptanceAccount;
let hNoWriteActor: FAcceptanceAccount;
let hNoMenuActor: FAcceptanceAccount;
let fPrimary: FAcceptanceAccount;
let fSecondOperator: FAcceptanceAccount;
let fChecker: FAcceptanceAccount;
let fReadonlyActor: FAcceptanceAccount;
let fNoWriteActor: FAcceptanceAccount;
let fNoMenuActor: FAcceptanceAccount;
const clonedAdminUsernames: string[] = [];
const clonedRoleCodes: string[] = [];
const f5ProductFindings: string[] = [];
const f5CommandKeys = new Set<string>();

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(join(EVIDENCE_DIR, "H9"), { recursive: true });
  mkdirSync(join(EVIDENCE_DIR, "F5"), { recursive: true });
  requireDatabase();
  cleanupPriorF5AcceptanceOutboxes();
  cleanupPriorF5AcceptanceIdempotency();
  const suffix = RUN_ID.replaceAll(/[^A-Za-z0-9]/g, "").slice(-12).toLowerCase();
  const hReadRole = createRole(`HF_${suffix}_H_RO`, ["H9"], ["growth_h9_read"]);
  const hNoMenuRole = createRole(`HF_${suffix}_H_NM`, ["H1"], ["growth_h1_read"]);
  const fReadRole = createRole(`HF_${suffix}_F_RO`, ["F5"], ["network_f5_read"]);
  const fNoMenuRole = createRole(`HF_${suffix}_F_NM`, ["F2"], ["network_f2_read"]);
  const fOperatorRole = createRole(`HF_${suffix}_F_OP`, ["F5", "D4"], [
    "network_f5_read", "network_f5_commission_dispose", "platform_a2_proposal_create", "finance_d4_read",
  ]);
  const fCheckerRole = createRole(`HF_${suffix}_F_CK`, ["A2"], [
    "platform_a2_read", "platform_a2_operation_approve", "network_f5_commission_dispose",
  ]);
  hPrimary = cloneAdmin(hFixture, "maker", `h9sa1_${suffix}`, true, 1);
  hSecondWriter = cloneAdmin(hFixture, "maker", `h9sa2_${suffix}`, true, 1);
  hReadonlyActor = cloneAdmin(hFixture, "maker", `h9ro_${suffix}`, false, hReadRole);
  hNoWriteActor = cloneAdmin(hFixture, "maker", `h9nw_${suffix}`, false, hReadRole);
  hNoMenuActor = cloneAdmin(hFixture, "maker", `h9nm_${suffix}`, false, hNoMenuRole);
  fPrimary = cloneAdmin(fFixture, "maker", `f5op1_${suffix}`, false, fOperatorRole);
  fSecondOperator = cloneAdmin(fFixture, "maker", `f5op2_${suffix}`, false, fOperatorRole);
  fChecker = cloneAdmin(fFixture, "maker", `f5ck_${suffix}`, false, fCheckerRole);
  fReadonlyActor = cloneAdmin(fFixture, "maker", `f5ro_${suffix}`, false, fReadRole);
  fNoWriteActor = cloneAdmin(fFixture, "maker", `f5nw_${suffix}`, false, fReadRole);
  fNoMenuActor = cloneAdmin(fFixture, "maker", `f5nm_${suffix}`, false, fNoMenuRole);
});

test.afterAll(() => {
  cleanupClonedAdmins();
  cleanupClonedRoles();
});

test("H9：首次用户可见入口、真实整组保存、CAS/幂等、权限、失败恢复、用户侧投影与精确恢复", async ({ browser }) => {
  test.setTimeout(420_000);
  const evidence: Record<string, unknown> = { runId: RUN_ID, candidate: candidateIdentity() };
  const baseline = readH9Database();
  const createdContexts: Array<Awaited<ReturnType<Browser["newContext"]>>> = [];
  let temporaryVersion: number | undefined;
  let conflictCommandKey = "";
  const invalidCommandKey = `${RUN_ID}-h9-invalid`;
  let primaryError: Error | undefined;

  try {
    const makerContext = await browser.newContext();
    const secondContext = await browser.newContext();
    createdContexts.push(makerContext, secondContext);
    const maker = await makerContext.newPage();
    const second = await secondContext.newPage();
    await loginFActor(maker, hPrimary, `${RUN_ID}-h9-maker`);
    await loginFActor(second, hSecondWriter, `${RUN_ID}-h9-second`);

    await openH9(maker);
    await openH9(second);
    await expect(maker.getByText("对外公布数据", { exact: true }).first()).toBeVisible();
    await expect(maker.getByText(/这页的数会去哪/)).toBeVisible();
    await expect(maker.getByText(/本次提交基于配置版本/)).toHaveCount(0);
    await maker.screenshot({ path: join(EVIDENCE_DIR, "H9", "01-visible-entry.png"), fullPage: true });

    const before = await ok<H9Overview>(await maker.request.get("/api/admin/growth/public-stats"), "H9 baseline");
    expect(before.version).toBe(baseline.version);
    expect(h9EditableValues(before.values)).toEqual(h9EditableValues(baseline.values));
    const nextFleet = before.values.fleetDevices < 100_000_000
      ? before.values.fleetDevices + 1
      : before.values.fleetDevices - 1;

    const fleetInput = maker.getByLabel("对外公布的设备总数目标值");
    await fleetInput.fill(String(nextFleet));
    await expect(maker.getByRole("button", { name: "保存变更", exact: true })).toBeEnabled();
    await maker.screenshot({ path: join(EVIDENCE_DIR, "H9", "02-impact-preview.png"), fullPage: true });
    const reason = `${RUN_ID} H9 真实页面临时发布并预置精确恢复`;
    await maker.getByRole("button", { name: "保存变更", exact: true }).click();
    const dialog = operationDialog(maker);
    await dialog.getByText(/查看详情/).click();
    await expect(dialog.getByText(/本次改动\(1 项\)/)).toBeVisible();
    await expect(dialog.getByText(new RegExp(`v${before.version}`))).toBeVisible();
    await dialog.getByLabel(/操作理由/).fill(reason);
    const patchResponse = maker.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === "/api/admin/growth/public-stats");
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const savedResponse = await patchResponse;
    const saved = await ok<H9Overview>(savedResponse, "H9 visible save");
    const savedRequest = {
      idempotencyKey: await savedResponse.request().headerValue("Idempotency-Key"),
      body: savedResponse.request().postDataJSON(),
    };
    expect(saved.version).toBe(before.version + 1);
    expect(saved.values.fleetDevices).toBe(nextFleet);
    temporaryVersion = saved.version;
    await expect(maker.getByText(new RegExp(`生效版本 v${saved.version}`))).toBeVisible();
    await expect(fleetInput).toHaveValue(String(nextFleet));
    await maker.screenshot({ path: join(EVIDENCE_DIR, "H9", "03-visible-save-success.png"), fullPage: true });

    const publicRequest = await playwrightRequest.newContext({
      baseURL: "http://127.0.0.1:8110",
      extraHTTPHeaders: { "X-Nexion-Edge-Country": "JP" },
    });
    const publicResponse = await publicRequest.get("/api/config/platform");
    const publicPayload = await ok<Record<string, unknown>>(publicResponse, "H9 public projection");
    await publicRequest.dispose();
    const publicStats = (publicPayload.publicStats ?? publicPayload.h9PublicStats) as Record<string, unknown> | undefined;
    const publicValues = publicStats?.values as Record<string, unknown> | undefined;
    expect(publicStats, JSON.stringify(publicPayload)).toBeTruthy();
    expect(Number(publicValues?.fleetDevices)).toBe(nextFleet);
    evidence.userProjectionSaved = runH9VisibleUserProjection("saved", nextFleet);

    expect(savedRequest.idempotencyKey).toBeTruthy();
    const replay = await maker.request.patch("/api/admin/growth/public-stats", {
      headers: { "Idempotency-Key": String(savedRequest.idempotencyKey) },
      data: savedRequest.body,
    });
    const replayed = await ok<H9Overview>(replay, "H9 same-key replay");
    expect(replayed.version).toBe(saved.version);
    expect(replayed.values.fleetDevices).toBe(nextFleet);

    const staleInput = second.getByLabel("对外公布的设备总数目标值");
    await staleInput.fill(String(nextFleet + 1));
    await second.getByRole("button", { name: "保存变更", exact: true }).click();
    const staleDialog = operationDialog(second);
    await staleDialog.getByLabel(/操作理由/).fill(`${RUN_ID} H9 双操作者旧版本冲突验证`);
    const conflictPromise = second.waitForResponse((response) =>
      response.request().method() === "PATCH"
      && new URL(response.url()).pathname === "/api/admin/growth/public-stats");
    await staleDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const conflict = await conflictPromise;
    conflictCommandKey = await conflict.request().headerValue("Idempotency-Key") ?? "";
    expect(conflict.status()).toBe(409);
    expect(conflictCommandKey).toBeTruthy();
    await expect(second.getByText(/并发|刷新|409|版本/).last()).toBeVisible();
    expect(readH9Database().values.fleetDevices).toBe(nextFleet);
    await second.screenshot({ path: join(EVIDENCE_DIR, "H9", "04-cas-conflict.png"), fullPage: true });

    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByLabel("对外公布的设备总数目标值")).toHaveValue(String(nextFleet));
    await maker.getByLabel("对外公布的设备总数目标值").fill("100000001");
    await expect(maker.getByText(/超出合法范围/)).toBeVisible();
    await expect(maker.getByRole("button", { name: "保存变更", exact: true })).toBeDisabled();
    await maker.getByRole("button", { name: "放弃改动", exact: true }).click();

    const invalidBody = { ...h9EditableValues(saved.values), fleetDevices: -1, expectedVersion: saved.version,
      reason: `${RUN_ID} H9 服务端整组非法回滚验证`, operator: hPrimary.username };
    const invalid = await maker.request.patch("/api/admin/growth/public-stats", {
      headers: { "Idempotency-Key": invalidCommandKey }, data: invalidBody,
    });
    expect([400, 422]).toContain(invalid.status());
    expect(readH9Database().values.fleetDevices).toBe(nextFleet);

    await maker.getByLabel("对外公布的设备总数目标值").fill(String(nextFleet + 2));
    await maker.route("**/api/admin/growth/public-stats", async (route) => {
      if (route.request().method() === "PATCH") return route.abort("connectionfailed");
      return route.continue();
    });
    await maker.getByRole("button", { name: "保存变更", exact: true }).click();
    const unknownDialog = operationDialog(maker);
    await unknownDialog.getByLabel(/操作理由/).fill(`${RUN_ID} H9 断网未知结果恢复验证`);
    await unknownDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(maker.getByText(/保存失败|没有生效|原样重试/).last()).toBeVisible();
    expect(readH9Database().values.fleetDevices).toBe(nextFleet);
    await maker.unroute("**/api/admin/growth/public-stats");
    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker.getByLabel("对外公布的设备总数目标值")).toHaveValue(String(nextFleet));

    evidence.permissions = await exerciseH9Permissions(browser, saved, {
      hReadonly: hReadonlyActor, hNoWrite: hNoWriteActor, hNoMenu: hNoMenuActor,
    });

    const reloginContext = await browser.newContext();
    createdContexts.push(reloginContext);
    const relogin = await reloginContext.newPage();
    await loginFActor(relogin, hPrimary, `${RUN_ID}-h9-maker-relogin`);
    await openH9(relogin);
    await expect(relogin.getByLabel("对外公布的设备总数目标值")).toHaveValue(String(nextFleet));
    await relogin.screenshot({ path: join(EVIDENCE_DIR, "H9", "05-refresh-relogin.png"), fullPage: true });

    const closure = h9DatabaseClosure(RUN_ID, before.version, saved.version, String(savedRequest.idempotencyKey));
    expect(closure.savedAuditCount).toBeGreaterThanOrEqual(1);
    expect(closure.savedIdempotencyCount).toBe(1);
    expect(closure.savedOutboxCount).toBeGreaterThanOrEqual(1);
    evidence.before = before;
    evidence.saved = saved;
    evidence.request = savedRequest;
    evidence.publicProjection = publicStats;
    evidence.closureBeforeRestore = closure;
    evidence.savedMutationEvidence = h9MutationEvidence(String(savedRequest.idempotencyKey));
    expect((evidence.savedMutationEvidence as ReturnType<typeof h9MutationEvidence>).auditRows).toHaveLength(1);
    expect((evidence.savedMutationEvidence as ReturnType<typeof h9MutationEvidence>).idempotencyRows).toHaveLength(1);
    expect((evidence.savedMutationEvidence as ReturnType<typeof h9MutationEvidence>).outboxRows).toHaveLength(1);
    evidence.rejectionEvidence = h9RejectionEvidence([conflictCommandKey, invalidCommandKey]);
    const rejectionEvidence = evidence.rejectionEvidence as ReturnType<typeof h9RejectionEvidence>;
    expect(rejectionEvidence.idempotencyRows).toHaveLength(2);
    expect(rejectionEvidence.auditRows).toHaveLength(0);
    expect(rejectionEvidence.outboxRows).toHaveLength(0);
    expect(rejectionEvidence.configVersion).toBe(saved.version);
  } catch (cause) {
    primaryError = asError(cause);
  } finally {
    const cleanupErrors: Error[] = [];
    try {
      const latest = readH9Database();
      let restoreCommandKey = "";
      if (JSON.stringify(h9EditableValues(latest.values)) !== JSON.stringify(h9EditableValues(baseline.values))) {
        const cleanupContext = await browser.newContext();
        createdContexts.push(cleanupContext);
        const cleanup = await cleanupContext.newPage();
        await loginFActor(cleanup, hPrimary, `${RUN_ID}-h9-cleanup`);
        restoreCommandKey = `${RUN_ID}-h9-restore-${latest.version}`;
        const restore = await cleanup.request.patch("/api/admin/growth/public-stats", {
          headers: { "Idempotency-Key": restoreCommandKey },
          data: { ...h9EditableValues(baseline.values), expectedVersion: latest.version,
            reason: `${RUN_ID} H9 按验收前快照精确恢复`, operator: hPrimary.username },
        });
        await ok<H9Overview>(restore, "H9 exact restore");
      }
      const restored = readH9Database();
      expect(h9EditableValues(restored.values)).toEqual(h9EditableValues(baseline.values));
      if (temporaryVersion !== undefined) expect(restored.version).toBeGreaterThan(temporaryVersion);
      else expect(restored.version).toBe(baseline.version);
      evidence.restored = restored;
      evidence.userProjectionRestored = runH9VisibleUserProjection("restored", restored.values.fleetDevices);
      if (restoreCommandKey) {
        evidence.restoreMutationEvidence = h9MutationEvidence(restoreCommandKey);
        const restoreEvidence = evidence.restoreMutationEvidence as ReturnType<typeof h9MutationEvidence>;
        expect(restoreEvidence.auditRows).toHaveLength(1);
        expect(restoreEvidence.idempotencyRows).toHaveLength(1);
        expect(restoreEvidence.outboxRows).toHaveLength(1);
        expect(Number(restoreEvidence.auditRows[0]?.[7])).toBe(restored.version);
      }
    } catch (cause) {
      cleanupErrors.push(asError(cause));
    }
    for (const context of createdContexts) await context.close().catch(() => undefined);
    writeFileSync(join(EVIDENCE_DIR, "H9", "runtime-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (primaryError || cleanupErrors.length) {
      throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "H9 method acceptance failed or cleanup failed");
    }
  }
});

test("F5：真实冻结/解冻/提前解锁、A2、CAS/幂等、权限、D4/审计及清理", async ({ browser }) => {
  test.setTimeout(540_000);
  const evidence: Record<string, unknown> = { runId: RUN_ID, candidate: candidateIdentity() };
  const fixtures = setupF5Fixtures();
  f5ProductFindings.length = 0;
  f5CommandKeys.clear();
  const contexts: Array<Awaited<ReturnType<Browser["newContext"]>>> = [];
  let primaryError: Error | undefined;

  try {
    const makerContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const checkerContext = await browser.newContext();
    contexts.push(makerContext, secondContext, checkerContext);
    const maker = await makerContext.newPage();
    const second = await secondContext.newPage();
    const checker = await checkerContext.newPage();
    await loginFActor(maker, fPrimary, `${RUN_ID}-f5-maker`);
    await loginFActor(second, fSecondOperator, `${RUN_ID}-f5-second-operator`);
    await loginFActor(checker, fChecker, `${RUN_ID}-f5-superadmin-checker`);

    await openF5(maker, fixtures.userId);
    await openF5(second, fixtures.userId);
    await expect(maker.getByRole("main").getByText("F5 佣金事件审计", { exact: true })).toBeVisible();
    await expect(maker.getByText(/服务端游标 · 六类佣金真实账本/)).toBeVisible();
    await maker.screenshot({ path: join(EVIDENCE_DIR, "F5", "01-visible-entry.png"), fullPage: true });

    const before = f5DatabaseSnapshot(fixtures.ids);
    expect(before.events.every((row) => row[1] === "COOLING" && row[2] === "0")).toBe(true);
    expect(before.ledgerCount).toBe(fixtures.ids.length);

    await rowFor(maker, fixtures.invalid).getByRole("button", { name: "冻结", exact: true }).click();
    const invalidDialog = operationDialog(maker);
    await invalidDialog.getByLabel(/操作理由/).fill("短");
    await expect(invalidDialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
    await invalidDialog.getByRole("button", { name: "取消", exact: true }).click();
    expect(commissionState(fixtures.invalid)).toEqual({ status: "COOLING", version: 0, frozenFromStatus: "" });

    // 异常支路允许受控注入：A2 503 代表结果未知，弹窗必须保留输入与命令号；
    // 刷新后同一业务输入重试必须复用原 Idempotency-Key，不能铸新号诱发重复票据。
    const uncertainReason = `${RUN_ID} F5 A2 结果未知后保持原输入和命令号重试`;
    let uncertainCommandKey = "";
    await maker.route("**/api/admin/platform/audit/operations", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      uncertainCommandKey = await route.request().headerValue("Idempotency-Key") ?? "";
      rememberF5CommandKey(uncertainCommandKey);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "A2_UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
    });
    await rowFor(maker, fixtures.invalid).getByRole("button", { name: "冻结", exact: true }).click();
    const uncertainDialog = operationDialog(maker);
    await uncertainDialog.getByLabel(/操作理由/).fill(uncertainReason);
    await uncertainDialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(uncertainDialog.getByText(/A2 提案结果暂不确定/)).toBeVisible();
    await expect(uncertainDialog.getByText(/同一命令号/)).toBeVisible();
    await expect(uncertainDialog.getByLabel(/操作理由/)).toHaveValue(uncertainReason);
    expect(uncertainCommandKey).toMatch(/^f-config-/);
    await maker.unroute("**/api/admin/platform/audit/operations");
    await openF5(maker, fixtures.userId, true);
    const retryRequest = maker.waitForRequest((request) => request.method() === "POST"
      && new URL(request.url()).pathname === "/api/admin/platform/audit/operations");
    const recoveredTicket = await proposeF5Disposition(maker, fixtures.invalid, "冻结", uncertainReason);
    const recoveredRequest = await retryRequest;
    const recoveredCommandKey = await recoveredRequest.headerValue("Idempotency-Key") ?? "";
    expect(recoveredCommandKey).toBe(uncertainCommandKey);
    await rejectVisibleA2(checker, recoveredTicket, `${RUN_ID} F5 独立审批员驳回结果未知恢复提案`);
    expect(commissionState(fixtures.invalid)).toEqual({ status: "COOLING", version: 0, frozenFromStatus: "" });
    evidence.unknownOutcomeRecovery = {
      injectedStatus: 503,
      commandKeyStableAcrossReload: recoveredCommandKey === uncertainCommandKey,
      finalStatus: "COOLING",
      recoveredTicketStatus: "rejected",
    };

    const freezeTicket = await proposeF5Disposition(maker, fixtures.freeze, "冻结",
      `${RUN_ID} F5 冻结隔离佣金并核对零资金副作用`);
    const freezeApproval = await approveVisibleA2(checker, freezeTicket,
      `${RUN_ID} F5 独立审批员批准冻结`);
    const frozen = commissionState(fixtures.freeze);
    expect(frozen.status).toBe("FROZEN");
    expect(frozen.version).toBe(1);
    expect(frozen.frozenFromStatus).toBe("COOLING");
    expect(walletLedgerCount(fixtures.freeze)).toBe(1);

    const replayApproval = await checker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(freezeTicket)}/approve`, {
        headers: { "Idempotency-Key": freezeApproval.idempotencyKey },
        data: freezeApproval.body,
      });
    await ok(replayApproval, "F5 A2 same-key approval replay");
    expect(commissionState(fixtures.freeze).version).toBe(1);
    expect(commissionOperationCount(fixtures.freeze, "COOLING_TO_FROZEN")).toBe(1);

    await openF5(maker, fixtures.userId, true);
    await expect(rowFor(maker, fixtures.freeze).getByText("已冻结", { exact: true })).toBeVisible();
    const unfreezeTicket = await proposeF5Disposition(maker, fixtures.freeze, "解冻",
      `${RUN_ID} F5 解冻仅恢复冷却不绕过冷却期`);
    await approveVisibleA2(checker, unfreezeTicket, `${RUN_ID} F5 独立审批员批准解冻`);
    const unfrozen = commissionState(fixtures.freeze);
    expect(unfrozen.status).toBe("COOLING");
    expect(unfrozen.version).toBe(2);
    expect(unfrozen.frozenFromStatus).toBe("");
    expect(walletLedgerCount(fixtures.freeze)).toBe(1);

    const unlockTicket = await proposeF5Disposition(maker, fixtures.unlock, "提前解锁",
      `${RUN_ID} F5 提前解锁隔离佣金并验证账务一次性`);
    await approveVisibleA2(checker, unlockTicket, `${RUN_ID} F5 独立审批员批准提前解锁`);
    const unlocked = commissionState(fixtures.unlock);
    expect(unlocked.status).toBe("UNLOCKED");
    expect(unlocked.version).toBe(1);
    expect(walletLedgerCount(fixtures.unlock)).toBe(1);
    expect(commissionOperationCount(fixtures.unlock, "COOLING_TO_UNLOCKED")).toBe(1);

    const rejectedTicket = await proposeF5Disposition(maker, fixtures.reject, "提前解锁",
      `${RUN_ID} F5 提前解锁提案必须由独立审批员驳回`);
    await rejectVisibleA2(checker, rejectedTicket, `${RUN_ID} F5 独立审批员驳回提前解锁`);
    expect(commissionState(fixtures.reject)).toEqual({ status: "COOLING", version: 0, frozenFromStatus: "" });
    expect(walletLedgerCount(fixtures.reject)).toBe(1);

    // second 已在 maker 修改前读到 v0；maker 先冻结，second 再用旧快照提交提前解锁。
    const casWinnerTicket = await proposeF5Disposition(maker, fixtures.cas, "冻结",
      `${RUN_ID} F5 CAS 胜者先冻结`);
    await approveVisibleA2(checker, casWinnerTicket, `${RUN_ID} F5 CAS 胜者批准`);
    expect(commissionState(fixtures.cas).version).toBe(1);
    const staleTicket = await proposeF5Disposition(second, fixtures.cas, "提前解锁",
      `${RUN_ID} F5 CAS 败者以旧版本提交`);
    const conflict = await approveVisibleA2(checker, staleTicket,
      `${RUN_ID} F5 CAS 败者执行应冲突`, 409);
    expect(conflict.status).toBe(409);
    expect(commissionState(fixtures.cas).status).toBe("FROZEN");
    expect(commissionState(fixtures.cas).version).toBe(1);

    await openF5(maker, fixtures.userId, true);
    await expect(rowFor(maker, fixtures.unlock).getByText("已解锁可提", { exact: true })).toBeVisible();
    await maker.screenshot({ path: join(EVIDENCE_DIR, "F5", "02-state-results.png"), fullPage: true });

    const ledgerLink = rowFor(maker, fixtures.unlock).getByRole("link", { name: "D4", exact: true });
    await ledgerLink.click();
    await expect(maker).toHaveURL(/\/finance\/ledger\?bizNo=/);
    await expect(maker.getByText(/账本|流水/).first()).toBeVisible();
    const linkedBody = await maker.locator("main").innerText();
    evidence.d4LinkedView = { url: maker.url(), containsFixtureBizNo: linkedBody.includes(`F2-NETWORK-${fixtures.unlock}`), bodyExcerpt: linkedBody.slice(0, 1200) };
    if (!linkedBody.includes(`F2-NETWORK-${fixtures.unlock}`)) {
      f5ProductFindings.push(`F5_D4_LINK_EMPTY_OR_WRONG_BIZ_NO:${fixtures.unlock}`);
    }
    await maker.screenshot({ path: join(EVIDENCE_DIR, "F5", "03-d4-linked-view.png"), fullPage: true });

    evidence.permissions = await exerciseF5Permissions(browser, fixtures.freeze, {
      fReadonly: fReadonlyActor, fNoWrite: fNoWriteActor, fNoMenu: fNoMenuActor,
    });
    const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
    expect((await anonymous.get("/api/admin/teams/commissions")).status()).toBe(401);
    expect((await anonymous.patch(`/api/admin/teams/commissions/config/F.commission.${fixtures.freeze}.status`, {
      headers: { "Idempotency-Key": `${RUN_ID}-f5-anonymous` },
      data: { key: `F.commission.${fixtures.freeze}.status`, value: "frozen", expectedVersion: 2,
        reason: `${RUN_ID} 匿名必须拒绝`, operator: "anonymous" },
    })).status()).toBe(401);
    await anonymous.dispose();

    const reloginContext = await browser.newContext();
    contexts.push(reloginContext);
    const relogin = await reloginContext.newPage();
    await loginFActor(relogin, fPrimary, `${RUN_ID}-f5-maker-relogin`);
    await openF5(relogin, fixtures.userId);
    await expect(rowFor(relogin, fixtures.unlock).getByText("已解锁可提", { exact: true })).toBeVisible();
    await expect(rowFor(relogin, fixtures.freeze).getByText("冷却计提中", { exact: true })).toBeVisible();
    await relogin.screenshot({ path: join(EVIDENCE_DIR, "F5", "04-refresh-relogin.png"), fullPage: true });

    const closure = f5DatabaseClosure(fixtures.ids, [recoveredTicket, freezeTicket, unfreezeTicket, unlockTicket, rejectedTicket, casWinnerTicket, staleTicket]);
    evidence.fixtures = fixtures;
    evidence.before = before;
    evidence.closure = closure;
    evidence.productFindings = [...f5ProductFindings];
    expect(closure.operations.filter((row) => row[1] === "COOLING_TO_UNLOCKED")).toHaveLength(1);
    expect(closure.outboxRows).toHaveLength(1);
    expect(closure.outboxRows[0]?.slice(0, 2)).toEqual([`CM-${fixtures.unlock}`, "COMMISSION_UNLOCKED"]);
    expect(["PENDING", "PUBLISHED"]).toContain(closure.outboxRows[0]?.[2]);
    expect(closure.auditCount).toBeGreaterThanOrEqual(4);
    expect(f5ProductFindings, "F5 visible business blockers").toEqual([]);
  } catch (cause) {
    primaryError = asError(cause);
  } finally {
    const cleanupErrors: Error[] = [];
    try {
      const cleanup = cleanupF5Fixtures(fixtures.ids, [...f5CommandKeys]);
      expect(cleanup.events).toBe(0);
      expect(cleanup.ledgers).toBe(0);
      expect(cleanup.operations).toBe(0);
      expect(cleanup.outboxes).toBe(0);
      expect(cleanup.reserveRows).toBe(0);
      expect(cleanup.idempotencyRecords).toBe(0);
      evidence.cleanup = cleanup;
    } catch (cause) {
      cleanupErrors.push(asError(cause));
    }
    for (const context of contexts) await context.close().catch(() => undefined);
    writeFileSync(join(EVIDENCE_DIR, "F5", "runtime-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    if (primaryError || cleanupErrors.length) {
      throw new AggregateError([...(primaryError ? [primaryError] : []), ...cleanupErrors], "F5 method acceptance failed or cleanup failed");
    }
  }
});

async function exerciseH9Permissions(
  browser: Browser,
  current: H9Overview,
  actors: { hReadonly: FAcceptanceAccount; hNoWrite: FAcceptanceAccount; hNoMenu: FAcceptanceAccount },
) {
  const result: Record<string, unknown> = {};
  for (const [name, actor] of Object.entries(actors)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginFActor(page, actor, `${RUN_ID}-h9-${name}`);
      const link = page.locator('aside a[href="/growth/public-stats"]');
      if (name === "hNoMenu") {
        await expect(link).toHaveCount(0);
        await page.goto("/growth/public-stats", { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("button", { name: "保存变更", exact: true })).toHaveCount(0);
        const read = await page.request.get("/api/admin/growth/public-stats");
        expect(read.status()).toBe(403);
        result[name] = { menu: false, readStatus: read.status() };
      } else {
        await openH9(page);
        await expect(page.getByLabel("对外公布的设备总数目标值")).toBeDisabled();
        await expect(page.getByRole("button", { name: "保存变更", exact: true })).toHaveCount(0);
        const denied = await page.request.patch("/api/admin/growth/public-stats", {
          headers: { "Idempotency-Key": `${RUN_ID}-h9-${name}-forbidden` },
          data: { ...current.values, expectedVersion: current.version,
            reason: `${RUN_ID} H9 无写权限必须拒绝`, operator: actor.username },
        });
        expect(denied.status()).toBe(403);
        result[name] = { menu: true, writeStatus: denied.status() };
      }
    } finally {
      await context.close();
    }
  }
  return result;
}

async function exerciseF5Permissions(
  browser: Browser,
  eventId: string,
  actors: { fReadonly: FAcceptanceAccount; fNoWrite: FAcceptanceAccount; fNoMenu: FAcceptanceAccount },
) {
  const result: Record<string, unknown> = {};
  for (const [name, actor] of Object.entries(actors)) {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await loginFActor(page, actor, `${RUN_ID}-f5-${name}`);
      const link = page.locator('aside a[href="/network/commissions"]');
      if (name === "fNoMenu") {
        await expect(link).toHaveCount(0);
        await page.goto("/network/commissions", { waitUntil: "domcontentloaded" });
        const read = await page.request.get("/api/admin/teams/commissions");
        expect(read.status()).toBe(403);
        result[name] = { menu: false, readStatus: read.status() };
      } else {
        await openF5(page);
        await expect(page.getByRole("button", { name: /冻结|提前解锁|解冻/ })).toHaveCount(0);
        const denied = await page.request.patch(`/api/admin/teams/commissions/config/F.commission.${eventId}.status`, {
          headers: { "Idempotency-Key": `${RUN_ID}-f5-${name}-forbidden` },
          data: { key: `F.commission.${eventId}.status`, value: "frozen", expectedVersion: 2,
            reason: `${RUN_ID} F5 无处置权限必须拒绝`, operator: actor.username },
        });
        expect(denied.status()).toBe(403);
        result[name] = { menu: true, writeStatus: denied.status() };
      }
    } finally {
      await context.close();
    }
  }
  return result;
}

async function proposeF5Disposition(page: Page, eventId: string, action: "冻结" | "提前解锁" | "解冻", reason: string) {
  const row = rowFor(page, eventId);
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: action, exact: true }).click();
  const dialog = operationDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/platform/audit/operations");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const proposalResponse = await responsePromise;
  rememberF5CommandKey(await proposalResponse.request().headerValue("Idempotency-Key"));
  const ticket = await ok<Ticket>(proposalResponse, `F5 ${action} proposal`);
  const operationId = String(ticket.id ?? ticket.operationId ?? "");
  expect(operationId).toMatch(/^(?:WO|OP)-/);
  if (await dialog.getByText(/A2 提案结果暂不确定/).isVisible().catch(() => false)) {
    f5ProductFindings.push(`F5_FALSE_OUTCOME_UNKNOWN_ON_HTTP_200:${operationId}`);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  } else {
    await expect(dialog).toBeHidden();
  }
  return operationId;
}

async function approveVisibleA2(page: Page, operationId: string, reason: string, expectedStatus = 200) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "执行", exact: true }) }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const dialog = operationDialog(page);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  const body = response.request().postDataJSON();
  const idempotencyKey = await response.request().headerValue("Idempotency-Key") ?? "";
  rememberF5CommandKey(idempotencyKey);
  if (expectedStatus === 200) {
    await ok(response, `approve ${operationId}`);
    if (await dialog.getByText(/A2 提案结果暂不确定/).isVisible().catch(() => false)) {
      f5ProductFindings.push(`F5_FALSE_OUTCOME_UNKNOWN_ON_HTTP_200_APPROVAL:${operationId}`);
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    }
  } else {
    await expect(page.getByText(/冲突|版本|刷新|409/).last()).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  }
  return { status: response.status(), body, idempotencyKey };
}

async function rejectVisibleA2(page: Page, operationId: string, reason: string) {
  const group = page.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
  const link = page.locator('a[href="/platform/audit"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId })
    .filter({ has: page.getByRole("button", { name: "取消", exact: true }) }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "取消", exact: true }).click();
  const dialog = operationDialog(page);
  await dialog.getByLabel(/操作理由/).fill(reason);
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname.endsWith(`/operations/${operationId}/reject`));
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await responsePromise;
  rememberF5CommandKey(await response.request().headerValue("Idempotency-Key"));
  await ok(response, `reject ${operationId}`);
  if (await dialog.getByText(/A2 提案结果暂不确定/).isVisible().catch(() => false)) {
    f5ProductFindings.push(`F5_FALSE_OUTCOME_UNKNOWN_ON_HTTP_200_REJECTION:${operationId}`);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  } else {
    await expect(dialog).toBeHidden();
  }
}

async function openH9(page: Page) {
  const group = page.getByRole("button", { name: /增长与运营节奏/ }).first();
  const link = page.locator('aside a[href="/growth/public-stats"]');
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/growth\/public-stats$/);
  await expect(page.getByText("对外公布数据", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function openF5(page: Page, userId?: string, reload = false) {
  if (reload) {
    await page.reload({ waitUntil: "domcontentloaded" });
  } else {
    const group = page.getByRole("button", { name: /分销与团队\s+F|F\s+分销与团队|分销与团队/ }).first();
    const link = page.locator('aside a[href="/network/commissions"]');
    if (!(await link.isVisible().catch(() => false))) await group.click();
    await expect(link).toBeVisible();
    await link.click();
  }
  await expect(page).toHaveURL(/\/network\/commissions$/);
  await expect(page.getByText("佣金流水", { exact: true })).toBeVisible({ timeout: 20_000 });
  if (userId) {
    await page.getByLabel("用户 ID").fill(userId);
    const response = page.waitForResponse((item) =>
      item.request().method() === "GET"
      && new URL(item.url()).pathname === "/api/admin/teams/commissions"
      && new URL(item.url()).searchParams.get("userId") === userId);
    await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
    await ok(await response, "F5 user filter");
  }
}

function rowFor(page: Page, eventId: string) {
  return page.locator("tbody tr").filter({ hasText: `CM-${eventId}` }).first();
}

function operationDialog(page: Page) {
  return page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) }).last();
}

function createRole(roleCode: string, menuCodes: string[], permissionCodes: string[]) {
  cleanupClonedRole(roleCode);
  mysqlExec(
    "INSERT INTO nx_admin_role(role_code,role_name,remark,status,created_at,updated_at,is_deleted) "
    + `VALUES('${sql(roleCode)}','${sql(roleCode)}','${sql(RUN_ID)} isolated acceptance role',1,NOW(),NOW(),0);`
    + "SET @hf_role_id=LAST_INSERT_ID();"
    + (menuCodes.length
      ? "INSERT INTO nx_admin_role_menu(role_id,menu_id,created_at,updated_at,is_deleted) "
        + `SELECT @hf_role_id,id,NOW(),NOW(),0 FROM nx_admin_menu WHERE menu_code IN (${menuCodes.map((code) => `'${sql(code)}'`).join(",")}) AND is_deleted=0;`
      : "")
    + (permissionCodes.length
      ? "INSERT INTO nx_admin_role_permission(role_id,permission_id,created_at,updated_at,is_deleted) "
        + `SELECT @hf_role_id,id,NOW(),NOW(),0 FROM nx_admin_permission WHERE permission_code IN (${permissionCodes.map((code) => `'${sql(code)}'`).join(",")}) AND is_deleted=0;`
      : "")
    ,
  );
  const roleId = mysqlNumber(`SELECT id FROM nx_admin_role WHERE role_code='${sql(roleCode)}' AND is_deleted=0 LIMIT 1`);
  if (!Number.isSafeInteger(roleId) || roleId <= 0) throw new Error(`create role ${roleCode} failed`);
  clonedRoleCodes.push(roleCode);
  return roleId;
}

function cloneAdmin(
  fixture: HFixture,
  sourceKey: string,
  username: string,
  superAdmin: boolean,
  roleId: number,
) {
  const source = fixture.accounts?.[sourceKey] as (FAcceptanceAccount & { accountId?: string | number }) | undefined;
  const sourceId = Number(source?.accountId);
  if (!source || !Number.isSafeInteger(sourceId) || sourceId <= 0) {
    throw new Error(`${sourceKey} source admin id missing`);
  }
  cleanupClonedAdmin(username);
  mysqlExec(
    "INSERT INTO nx_admin(username,password_hash,nickname,email,phone,super_admin,status,version,created_at,updated_at,is_deleted) "
    + `SELECT '${sql(username)}',password_hash,'${sql(username)}',NULL,NULL,${superAdmin ? 1 : 0},1,0,NOW(),NOW(),0 FROM nx_admin WHERE id=${sourceId} AND status=1 AND is_deleted=0;`
    + "SET @hf_admin_id=LAST_INSERT_ID();"
    + "INSERT INTO nx_admin_account_state(admin_id,tfa_required,tfa_secret_encrypted,tfa_bound_at,last_login_at,tfa_reset_at,sessions_revoked_at,credential_delivery_status,created_at,updated_at,is_deleted) "
    + `SELECT @hf_admin_id,tfa_required,tfa_secret_encrypted,tfa_bound_at,NULL,tfa_reset_at,NULL,'ACTIVE',NOW(),NOW(),0 FROM nx_admin_account_state WHERE admin_id=${sourceId} AND is_deleted=0;`
    + "INSERT INTO nx_admin_role_relation(admin_id,role_id,created_at,updated_at,is_deleted) "
    + `VALUES(@hf_admin_id,${Number(roleId)},NOW(),NOW(),0);`
    ,
  );
  const createdId = mysqlNumber(`SELECT id FROM nx_admin WHERE username='${sql(username)}' AND is_deleted=0 LIMIT 1`);
  if (!Number.isSafeInteger(createdId) || createdId <= 0) throw new Error(`clone admin ${username} failed`);
  clonedAdminUsernames.push(username);
  return { username, password: source.password, totpSecret: source.totpSecret };
}

function cleanupClonedAdmins() {
  for (const username of [...clonedAdminUsernames].reverse()) cleanupClonedAdmin(username);
  clonedAdminUsernames.length = 0;
}

function cleanupClonedRoles() {
  for (const roleCode of [...clonedRoleCodes].reverse()) cleanupClonedRole(roleCode);
  clonedRoleCodes.length = 0;
}

function cleanupClonedRole(roleCode: string) {
  mysqlExec(
    `SET @hf_role_id=(SELECT id FROM nx_admin_role WHERE role_code='${sql(roleCode)}' LIMIT 1);`
    + "DELETE FROM nx_admin_role_menu WHERE role_id=@hf_role_id;"
    + "DELETE FROM nx_admin_role_permission WHERE role_id=@hf_role_id;"
    + "DELETE FROM nx_admin_role WHERE id=@hf_role_id;",
  );
}

function cleanupClonedAdmin(username: string) {
  mysqlExec(
    `SET @hf_admin_id=(SELECT id FROM nx_admin WHERE username='${sql(username)}' LIMIT 1);`
    + "DELETE FROM nx_admin_role_relation WHERE admin_id=@hf_admin_id;"
    + "DELETE FROM nx_admin_account_state WHERE admin_id=@hf_admin_id;"
    + "DELETE FROM nx_admin WHERE id=@hf_admin_id;",
  );
}

function setupF5Fixtures() {
  cleanupF5ByMarker();
  const userId = mysqlRows("SELECT id FROM nx_user WHERE is_deleted=0 ORDER BY id LIMIT 1;")[0]?.[0];
  if (!userId) throw new Error("F5 acceptance requires one active user");
  const rows = [
    ["freeze", "1.110000"], ["unlock", "2.220000"], ["reject", "2.770000"],
    ["cas", "3.330000"], ["invalid", "4.440000"],
  ];
  for (const [label, amount] of rows) {
    const eventId = mysqlRows(
      "INSERT INTO nx_commission_event "
      + "(user_id,commission_type,source_user_id,source_user_name,layer_no,order_no,order_amount_usd,amount_usdt,amount_nex,currency,status,unlock_at,remark,version,frozen_from_status,is_deleted) VALUES "
      + `(${Number(userId)},'network',${Number(userId)},'${sql(F5_MARKER)}',1,'${sql(F5_MARKER)}-${label}',10.000000,${amount},0,'USDT','COOLING',DATE_ADD(NOW(),INTERVAL 30 DAY),'${sql(F5_MARKER)}-${label}',0,NULL,0);`
      + "SELECT LAST_INSERT_ID();",
    )[0]?.[0];
    if (!eventId) throw new Error(`F5 fixture ${label} insert failed`);
    const balance = mysqlRows(`SELECT COALESCE((SELECT balance_after FROM nx_wallet_ledger WHERE user_id=${Number(userId)} AND asset='USDT' AND is_deleted=0 ORDER BY created_at DESC,id DESC LIMIT 1),0)+${amount};`)[0]?.[0] ?? amount;
    mysqlExec(
      "INSERT INTO nx_wallet_ledger(user_id,biz_no,biz_type,asset,direction,amount,balance_after,status,remark,is_deleted) VALUES "
      + `(${Number(userId)},'F2-NETWORK-${eventId}','TEAM_COMMISSION','USDT','IN',${amount},${balance},'PENDING','${sql(F5_MARKER)}-${label}',0);`,
    );
  }
  mysqlExec(
    "INSERT INTO nx_treasury_reserve_ledger "
    + "(reserve_no,voucher_no,direction,amount_usd,reason,operator,idempotency_key,status,is_deleted) VALUES "
    + `('RSV-${sql(RUN_ID)}','VCH-${sql(RUN_ID)}','IN',1000000.000000,'${sql(F5_MARKER)} isolated B1 acceptance reserve','acceptance-harness','${sql(RUN_ID)}-f5-b1-reserve','CONFIRMED',0);`,
  );
  const ids = mysqlRows(`SELECT id,remark FROM nx_commission_event WHERE remark LIKE '${sql(F5_MARKER)}-%' AND is_deleted=0 ORDER BY id;`);
  const byLabel = Object.fromEntries(ids.map(([id, remark]) => [remark.slice(`${F5_MARKER}-`.length), id]));
  for (const label of ["freeze", "unlock", "reject", "cas", "invalid"]) {
    if (!byLabel[label]) throw new Error(`F5 fixture missing ${label}`);
  }
  return { userId, ids: ids.map(([id]) => id), freeze: byLabel.freeze, unlock: byLabel.unlock,
    reject: byLabel.reject, cas: byLabel.cas, invalid: byLabel.invalid };
}

function cleanupF5Fixtures(ids: string[], commandKeys: string[] = []) {
  const list = ids.length ? ids.map((id) => Number(id)).join(",") : "0";
  const exactKeys = [...new Set(commandKeys.map((value) => value.trim()).filter(Boolean))];
  if (exactKeys.some((value) => value.length > 255)) throw new Error("F5 idempotency key exceeds the schema boundary");
  const keyList = exactKeys.map((value) => `'${sql(value)}'`).join(",") || "''";
  mysqlExec("SET FOREIGN_KEY_CHECKS=0;"
    + `DELETE FROM nx_commission_operation WHERE source_commission_id IN (${list}) OR result_commission_id IN (${list}) OR reason LIKE '${sql(RUN_ID)}%';`
    + `DELETE FROM nx_wallet_ledger WHERE remark LIKE '${sql(F5_MARKER)}-%' OR biz_no IN (${ids.map((id) => `'F2-NETWORK-${Number(id)}'`).join(",") || "''"});`
    + `DELETE FROM nx_event_outbox WHERE (aggregate_type='COMMISSION' AND aggregate_id IN (${ids.map((id) => `'CM-${Number(id)}'`).join(",") || "''"})) OR CAST(payload AS CHAR) LIKE '%${sql(RUN_ID)}%';`
    + `DELETE FROM nx_commission_event WHERE id IN (${list}) AND remark LIKE '${sql(F5_MARKER)}-%';`
    + `DELETE FROM nx_audit_log WHERE CAST(detail_json AS CHAR) LIKE '%${sql(RUN_ID)}%' OR actor_username LIKE '${sql(RUN_ID)}%';`
    + `DELETE FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '${sql(RUN_ID)}%' OR idempotency_key IN (${keyList});`
    + `DELETE FROM nx_audit_operation_ticket WHERE (reason LIKE '${sql(RUN_ID)}%' OR object_text LIKE '%${sql(F5_MARKER)}%');`
    + `DELETE FROM nx_treasury_reserve_ledger WHERE idempotency_key='${sql(RUN_ID)}-f5-b1-reserve' OR reason='${sql(F5_MARKER)} isolated B1 acceptance reserve';`
    + "SET FOREIGN_KEY_CHECKS=1;");
  return {
    events: mysqlNumber(`SELECT COUNT(*) FROM nx_commission_event WHERE id IN (${list}) AND remark LIKE '${sql(F5_MARKER)}-%';`),
    ledgers: mysqlNumber(`SELECT COUNT(*) FROM nx_wallet_ledger WHERE remark LIKE '${sql(F5_MARKER)}-%';`),
    operations: mysqlNumber(`SELECT COUNT(*) FROM nx_commission_operation WHERE source_commission_id IN (${list}) OR result_commission_id IN (${list});`),
    outboxes: mysqlNumber(`SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_type='COMMISSION' AND aggregate_id IN (${ids.map((id) => `'CM-${Number(id)}'`).join(",") || "''"});`),
    reserveRows: mysqlNumber(`SELECT COUNT(*) FROM nx_treasury_reserve_ledger WHERE idempotency_key='${sql(RUN_ID)}-f5-b1-reserve';`),
    idempotencyRecords: mysqlNumber(`SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '${sql(RUN_ID)}%' OR idempotency_key IN (${keyList});`),
  };
}

function cleanupF5ByMarker() {
  const ids = mysqlRows(`SELECT id FROM nx_commission_event WHERE remark LIKE '${sql(F5_MARKER)}-%';`).map(([id]) => id);
  cleanupF5Fixtures(ids);
}

function cleanupPriorF5AcceptanceOutboxes() {
  if (!PRIOR_F5_ORPHAN_EVENT_IDS.length) return;
  if (PRIOR_F5_ORPHAN_EVENT_IDS.some((id) => !/^[1-9]\d*$/.test(id))) {
    throw new Error("HF_F5_ORPHAN_EVENT_IDS contains an unsafe event id");
  }
  const aggregateIds = PRIOR_F5_ORPHAN_EVENT_IDS.map((id) => `'CM-${Number(id)}'`).join(",");
  mysqlExec(`DELETE FROM nx_event_outbox WHERE aggregate_type='COMMISSION' AND event_type='COMMISSION_UNLOCKED' AND aggregate_id IN (${aggregateIds});`);
  const remaining = mysqlNumber(`SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_type='COMMISSION' AND event_type='COMMISSION_UNLOCKED' AND aggregate_id IN (${aggregateIds});`);
  if (remaining !== 0) throw new Error("prior F5 acceptance outbox cleanup failed");
}

function cleanupPriorF5AcceptanceIdempotency() {
  if (!PRIOR_F5_ORPHAN_IDEMPOTENCY_KEYS.length) return;
  if (PRIOR_F5_ORPHAN_IDEMPOTENCY_KEYS.some((key) => !/^(?:f-config|a2-(?:approve|reject)-WO)-[A-Za-z0-9-]+$/.test(key))) {
    throw new Error("HF_F5_ORPHAN_IDEMPOTENCY_KEYS contains an unsafe key");
  }
  const keys = PRIOR_F5_ORPHAN_IDEMPOTENCY_KEYS.map((key) => `'${sql(key)}'`).join(",");
  mysqlExec(`DELETE FROM nx_admin_idempotency_record WHERE idempotency_key IN (${keys});`);
  const remaining = mysqlNumber(`SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key IN (${keys});`);
  if (remaining !== 0) throw new Error("prior F5 acceptance idempotency cleanup failed");
}

function rememberF5CommandKey(value: string | null | undefined) {
  const key = value?.trim();
  if (key) f5CommandKeys.add(key);
}

function f5DatabaseSnapshot(ids: string[]) {
  const list = ids.map(Number).join(",");
  return {
    events: mysqlRows(`SELECT id,status,version,COALESCE(frozen_from_status,'') FROM nx_commission_event WHERE id IN (${list}) ORDER BY id;`),
    ledgerCount: mysqlNumber(`SELECT COUNT(*) FROM nx_wallet_ledger WHERE remark LIKE '${sql(F5_MARKER)}-%' AND is_deleted=0;`),
  };
}

function commissionState(eventId: string) {
  const row = mysqlRows(`SELECT status,version,COALESCE(frozen_from_status,'') FROM nx_commission_event WHERE id=${Number(eventId)} AND is_deleted=0;`)[0];
  if (!row) throw new Error(`commission ${eventId} missing`);
  return { status: row[0], version: Number(row[1]), frozenFromStatus: row[2] ?? "" };
}

function walletLedgerCount(eventId: string) {
  return mysqlNumber(`SELECT COUNT(*) FROM nx_wallet_ledger WHERE biz_no='F2-NETWORK-${Number(eventId)}' AND is_deleted=0;`);
}

function commissionOperationCount(eventId: string, type: string) {
  return mysqlNumber(`SELECT COUNT(*) FROM nx_commission_operation WHERE source_commission_id=${Number(eventId)} AND operation_type='${sql(type)}';`);
}

function f5DatabaseClosure(ids: string[], tickets: string[]) {
  const list = ids.map(Number).join(",");
  return {
    events: mysqlRows(`SELECT id,status,version,COALESCE(frozen_from_status,'') FROM nx_commission_event WHERE id IN (${list}) ORDER BY id;`),
    operations: mysqlRows(`SELECT source_commission_id,operation_type,expected_version,status FROM nx_commission_operation WHERE source_commission_id IN (${list}) ORDER BY id;`),
    auditCount: mysqlNumber(`SELECT COUNT(*) FROM nx_audit_log WHERE resource_id IN (${ids.map((id) => `'nx_commission_event:${Number(id)}'`).join(",")}) OR CAST(detail_json AS CHAR) LIKE '%${sql(RUN_ID)}%';`),
    outboxRows: mysqlRows(`SELECT aggregate_id,event_type,status FROM nx_event_outbox WHERE aggregate_type='COMMISSION' AND aggregate_id IN (${ids.map((id) => `'CM-${Number(id)}'`).join(",")}) ORDER BY aggregate_id,event_type;`),
    tickets: mysqlRows(`SELECT operation_id,status FROM nx_audit_operation_ticket WHERE operation_id IN (${tickets.map((id) => `'${sql(id)}'`).join(",")}) ORDER BY operation_id;`),
  };
}

function readH9Database() {
  const rows = mysqlRows("SELECT config_key,config_value FROM nx_config_item WHERE config_key IN ('growth.public_stats.values','growth.public_stats.version') AND is_deleted=0 ORDER BY config_key;");
  const map = Object.fromEntries(rows);
  if (!map["growth.public_stats.values"] || !map["growth.public_stats.version"]) throw new Error("H9 database aggregate missing");
  const values = JSON.parse(map["growth.public_stats.values"]) as H9Overview["values"];
  return { version: Number(map["growth.public_stats.version"]), values };
}

function h9EditableValues(values: H9Overview["values"]) {
  const { effectiveAt: _effectiveAt, ...editable } = values;
  return editable;
}

function h9DatabaseClosure(runId: string, beforeVersion: number, savedVersion: number, idempotencyKey: string) {
  return {
    beforeVersion,
    savedVersion,
    savedAuditCount: mysqlNumber(`SELECT COUNT(*) FROM nx_audit_log WHERE CAST(detail_json AS CHAR) LIKE '%${sql(runId)}%';`),
    savedIdempotencyCount: mysqlNumber(`SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE scope='GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS' AND idempotency_key LIKE 'h9-public-stats-%' AND JSON_EXTRACT(response_json,'$.data.version')=${savedVersion};`),
    savedOutboxCount: mysqlNumber(`SELECT COUNT(*) FROM nx_event_outbox WHERE aggregate_type='GROWTH_COMMAND' AND aggregate_id='H9:PUBLIC_STATS' AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.idempotency_key'))='${sql(idempotencyKey)}';`),
  };
}

function h9MutationEvidence(idempotencyKey: string) {
  const key = sql(idempotencyKey);
  return {
    auditRows: mysqlRows(
      "SELECT action,actor_username,result,risk_level,"
      + "JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.reason')),"
      + "JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.before.fleetDevices')),"
      + "JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.after.fleetDevices')),"
      + "JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.newVersion')),"
      + "JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey')),DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s') "
      + "FROM nx_audit_log WHERE action='GROWTH_H9_PUBLIC_STATS_UPDATED' AND resource_type='GROWTH_PUBLIC_STATS' "
      + `AND resource_id='H9' AND JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey'))='${key}' ORDER BY id;`,
    ),
    idempotencyRows: mysqlRows(
      "SELECT scope,idempotency_key,JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.code')),"
      + "JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.data.version')) FROM nx_admin_idempotency_record "
      + `WHERE scope='GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS' AND idempotency_key='${key}' ORDER BY id;`,
    ),
    outboxRows: mysqlRows(
      "SELECT aggregate_id,event_type,status,JSON_UNQUOTE(JSON_EXTRACT(payload,'$.idempotency_key')) "
      + "FROM nx_event_outbox WHERE aggregate_type='GROWTH_COMMAND' AND aggregate_id='H9:PUBLIC_STATS' "
      + `AND JSON_UNQUOTE(JSON_EXTRACT(payload,'$.idempotency_key'))='${key}' ORDER BY id;`,
    ),
  };
}

function h9RejectionEvidence(commandKeys: string[]) {
  const keys = [...new Set(commandKeys.map((value) => value.trim()).filter(Boolean))];
  if (keys.length !== commandKeys.length) throw new Error("H9 rejection command key missing or duplicated");
  const keyList = keys.map((value) => `'${sql(value)}'`).join(",");
  return {
    auditPolicy: "H9 required audit is success-only; deterministic 409/422 responses persist idempotency outcome but create no mutation audit or outbox.",
    idempotencyRows: mysqlRows(
      "SELECT idempotency_key,JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.code')),"
      + "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(response_json,'$.data.version')),'') FROM nx_admin_idempotency_record "
      + `WHERE scope='GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS' AND idempotency_key IN (${keyList}) ORDER BY idempotency_key;`,
    ),
    auditRows: mysqlRows(
      "SELECT action,result,JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey')) FROM nx_audit_log "
      + `WHERE JSON_UNQUOTE(JSON_EXTRACT(detail_json,'$.idempotencyKey')) IN (${keyList}) ORDER BY id;`,
    ),
    outboxRows: mysqlRows(
      "SELECT aggregate_id,event_type,status,JSON_UNQUOTE(JSON_EXTRACT(payload,'$.idempotency_key')) FROM nx_event_outbox "
      + `WHERE JSON_UNQUOTE(JSON_EXTRACT(payload,'$.idempotency_key')) IN (${keyList}) ORDER BY id;`,
    ),
    configVersion: readH9Database().version,
  };
}

function candidateIdentity() {
  return {
    pcBuildId: readFileSync("D:/workspace/nexion-ops-console/.next/BUILD_ID", "utf8").trim(),
    backendJarSha256: process.env.HF_BACKEND_JAR_SHA256 ?? "DE75C184243D20F50605D68CCC40605D251FD6D9B94F8B0071C899E777AAFD89",
  };
}

function runH9VisibleUserProjection(stage: string, expectedFleet: number) {
  const outputDir = join(EVIDENCE_DIR, "H9", `user-${stage}`);
  mkdirSync(outputDir, { recursive: true });
  const result = spawnSync(process.execPath, [
    "D:/workspace/NX1.0-UniApp/scripts/h9-visible-user-method-acceptance-20260808.mjs",
  ], {
    cwd: "D:/workspace/NX1.0-UniApp",
    env: {
      ...process.env,
      H9_VISIBLE_EVIDENCE_DIR: outputDir,
      H9_EXPECTED_FLEET: String(expectedFleet),
    },
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`H9 ${stage} user projection failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(readFileSync(join(outputDir, "entry-probe.json"), "utf8"));
}

async function ok<T = unknown>(response: APIResponse | { status(): number; text(): Promise<string> }, label: string) {
  const raw = await response.text();
  expect(response.status(), `${label}: ${raw}`).toBe(200);
  const envelope = JSON.parse(raw) as Envelope<T>;
  expect(envelope.code, `${label}: ${raw}`).toBe(0);
  return envelope.data as T;
}

function fixtureAccount(fixture: HFixture, key: string) {
  return account(fixture.accounts?.[key], key);
}

function account(value: Partial<FAcceptanceAccount> | undefined, label: string): FAcceptanceAccount {
  if (!value?.username?.trim() || !value.password || !value.totpSecret?.trim()) throw new Error(`${label} account fixture incomplete`);
  return { username: value.username, password: value.password, totpSecret: value.totpSecret };
}

function requireDatabase() {
  if (!process.env.HF_MYSQL_PASSWORD) throw new Error("HF_MYSQL_PASSWORD is required");
  if (!/^[A-Za-z0-9_]+$/.test(mysqlDatabase())) throw new Error("HF_MYSQL_DATABASE is unsafe");
}

function mysqlExec(query: string) {
  mysqlRows(query);
}

function mysqlNumber(query: string) {
  const value = Number(mysqlRows(query)[0]?.[0] ?? "");
  if (!Number.isFinite(value)) throw new Error(`MySQL numeric result invalid: ${value}`);
  return value;
}

function mysqlRows(query: string) {
  const result = spawnSync(process.env.HF_MYSQL_EXE ?? "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe", [
    "--host", "127.0.0.1", "--port", "3306", "--user", "root",
    "--default-character-set=utf8mb4", "--batch", "--raw", "--skip-column-names",
    "--execute", query, mysqlDatabase(),
  ], { encoding: "utf8", env: { ...process.env, MYSQL_PWD: process.env.HF_MYSQL_PASSWORD ?? "" } });
  if (result.status !== 0) throw new Error(`MySQL command failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  const output = result.stdout.trim();
  return output ? output.split(/\r?\n/).map((line) => line.split("\t")) : [];
}

function mysqlDatabase() {
  return process.env.HF_MYSQL_DATABASE ?? "nexion_acceptance_20260729_114336";
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''").replaceAll("%", "\\%");
}

function asError(value: unknown) {
  return value instanceof Error ? value : new Error(String(value));
}
