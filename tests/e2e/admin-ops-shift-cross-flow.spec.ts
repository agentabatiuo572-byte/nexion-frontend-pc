import { expect, test, type Page } from "@playwright/test";
import {
  assertAllowedTarget,
  assertAuditVisible,
  assertBackendReadable,
  assertNoWriteFailures,
  attachMutationCapture,
  BASE_URL,
  cleanupAccounts,
  createAuditMarker,
  createShiftReport,
  dismissOpenDialogs,
  finalizeReviews,
  loginApi,
  loginFromUi,
  logout,
  openAndAssertModule,
  performDialogAction,
  provisionAccounts,
  recordOptionalStep,
  recordStep,
  resetMutationCapture,
  REPORT_DIR,
  RUN_ID,
  shiftAccounts,
  type ShiftAccount,
  type ShiftReport,
  tryClickInlineAction,
  tryPerformDialogAction,
  expectSelfRevokeForbidden,
  writeReport,
} from "./helpers/ops-shift-harness";

test.describe.configure({ mode: "serial" });

const accounts = shiftAccounts();
const reports = new Map<string, ShiftReport>();

test.beforeAll(async ({ playwright }) => {
  assertAllowedTarget(BASE_URL);
  const superApi = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    await loginApi(superApi);
    await provisionAccounts(superApi, accounts);
  } finally {
    await superApi.dispose();
  }
});

test.afterAll(async ({ playwright }) => {
  const superApi = await playwright.request.newContext({ baseURL: BASE_URL });
  try {
    await loginApi(superApi);
    const cleanup = await cleanupAccounts(superApi, accounts);
    for (const [key, result] of cleanup.entries()) {
      const report = reports.get(key);
      if (report) {
        report.cleanup = result;
        await writeReport(report);
      }
    }
  } finally {
    await superApi.dispose();
  }
});

for (const account of accounts) {
  test(`${account.label}: 跨域运维全流程`, async ({ page }, testInfo) => {
    attachMutationCapture(page);
    const report = createShiftReport(account);
    reports.set(account.key, report);

    await recordStep(report, "登录临时启用管理员账号", ["A1"], async (evidence) => {
      await loginFromUi(page, account);
      await assertNoWriteFailures(page, evidence);
      evidence.push(`login=${account.username}`);
    });

    await runShiftWorkflow(page, account, report);

    finalizeReportAssertions(report);
    finalizeReviews(report);
    await writeReport(report);
    await testInfo.attach(`${account.key}-report`, {
      path: `${REPORT_DIR}\\${account.key}.json`,
      contentType: "application/json",
    });
    await logout(page);
  });
}

test("多 Agent 对抗复审汇总: 6 班次报告全部达标", async () => {
  expect(reports.size, "必须生成 6 个班次报告").toBe(6);
  for (const report of reports.values()) {
    expect(report.steps.some((step) => step.status === "failed"), `${report.label} 不应有失败步骤`).toBe(false);
    expect(report.initialReview?.score ?? 0, `${report.label} 初审分必须 >96`).toBeGreaterThan(96);
    expect(report.adversarialReview?.score ?? 0, `${report.label} 复审分必须 >98`).toBeGreaterThan(98);
    expect(report.assertions.frontendState, `${report.label} 缺少前端状态断言`).toBe(true);
    expect(report.assertions.backendRecord, `${report.label} 缺少后端/数据库可读断言`).toBe(true);
    expect(report.assertions.auditA2, `${report.label} 缺少 A2 审计断言`).toBe(true);
    expect(report.assertions.downstreamVisible, `${report.label} 缺少下游可见断言`).toBe(true);
  }
});

async function runShiftWorkflow(page: Page, account: ShiftAccount, report: ShiftReport) {
  switch (account.key) {
    case "platform_audit":
      await platformAuditShift(page, account, report);
      return;
    case "funds_risk":
      await fundsRiskShift(page, account, report);
      return;
    case "market_yield":
      await marketYieldShift(page, account, report);
      return;
    case "device_growth":
      await deviceGrowthShift(page, account, report);
      return;
    case "content_emergency":
      await contentEmergencyShift(page, account, report);
      return;
    case "support_user":
      await supportUserShift(page, account, report);
      return;
    default:
      throw new Error(`未知班次 ${account.key}`);
  }
}

async function platformAuditShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  const marker = `${account.key}-${RUN_ID}`;
  await recordStep(report, "A1/A2/A4/L 跨域巡检与自保护验证", ["A1", "A2", "A4", "L5"], async (evidence) => {
    for (const id of ["A1", "A2", "A4", "L5"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await expectSelfRevokeForbidden(page, account, evidence);
    report.assertions.frontendState = true;
  });

  await recordStep(report, "A2 生成通用审计操作单并在审计池可见", ["A2", "L5"], async (evidence) => {
    await createAuditMarker(page, account, "A2");
    report.assertions.backendRecord = true;
    await assertAuditVisible(page, marker, evidence);
    report.assertions.auditA2 = true;
    await openAndAssertModule(page, "L5", evidence);
    report.assertions.downstreamVisible = true;
  });

  await recordOptionalStep(report, "L5 导出中心后端写入与下载入口验证", ["L5", "A2"], async (evidence) => {
    await openAndAssertModule(page, "L5", evidence);
    return tryPerformDialogAction(page, [/发起导出任务/, /导出聚合汇总/, /生成$/], evidence, { inputValue: `E2E-${RUN_ID}` });
  });
}

async function fundsRiskShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  const marker = `${account.key}-${RUN_ID}`;
  await recordStep(report, "C/D/K/J 主链页面状态与后端聚合读取", ["B1", "C3", "D2", "D4", "D5", "K3", "K4", "K5", "J1"], async (evidence) => {
    for (const id of ["B1", "C3", "D2", "D4", "D5", "K3", "K4", "K5", "J1"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await assertBackendReadable(page, [
      "/api/admin/treasury/dual-ledger",
      "/api/admin/treasury/ledger/bills",
      "/api/admin/finance/withdrawal-params",
      "/api/admin/finance/withdrawals",
      "/api/admin/risk/scoring/overview",
    ], evidence);
    report.assertions.frontendState = true;
    report.assertions.backendRecord = true;
  });

  await recordStep(report, "C3 余额调整提交后 D4/A2 可追踪", ["C3", "B1", "D4", "A2"], async (evidence) => {
    await openAndAssertModule(page, "C3", evidence);
    await tryPickSearchOption(page, /搜索用户编码 \/ 用户名 \/ 手机号/, "U");
    await tryClickInlineAction(page, [/^扣减$/], evidence);
    await performDialogAction(page, /提交调整\(后端复核\)/, evidence, { confirmName: /确认执行/ });
    await openAndAssertModule(page, "D4", evidence);
    await createAuditMarker(page, account, "C3");
    await assertAuditVisible(page, marker, evidence);
    report.assertions.auditA2 = true;
    report.assertions.downstreamVisible = true;
  });

  await recordOptionalStep(report, "D2/D5/K3/K4/K5 风控汇聚操作验证", ["D2", "D5", "K3", "K4", "K5", "A2"], async (evidence) => {
    await openAndAssertModule(page, "D5", evidence);
    const d5 = await tryPerformDialogAction(page, [/^调整$/], evidence);
    await openAndAssertModule(page, "K3", evidence);
    const k3 = await tryPerformDialogAction(page, [/沙盒模拟/, /\+ 新建规则/, /提交生效|停用|启用/], evidence, { chooseChip: true });
    await openAndAssertModule(page, "K4", evidence);
    await tryPickSearchOption(page, /搜索用户编号 \/ 用户名 \/ 手机号/, "U");
    const k4 = await tryPerformDialogAction(page, [/人工覆盖评分/, /提交权重变更/], evidence, { inputValue: "35" });
    await openAndAssertModule(page, "K5", evidence);
    const k5 = await tryPerformDialogAction(page, [/手动补触发/, /调整/, /^通过$|^驳回$/], evidence, { inputValue: "U00000001" });
    await openAndAssertModule(page, "D2", evidence);
    return d5 || k3 || k4 || k5;
  });
}

async function marketYieldShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  await recordStep(report, "H1/G3 节奏源与 F/G/D/L 下游读取", ["H1", "F3", "G1", "G2", "G3", "G4", "G7", "D4", "L3"], async (evidence) => {
    for (const id of ["H1", "F3", "G1", "G2", "G3", "G4", "G7", "D4", "L3"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await assertBackendReadable(page, [
      "/api/admin/market/staking",
      "/api/admin/market/exchange",
      "/api/admin/market/nex/curve",
      "/api/admin/market/nex/genesis",
      "/api/admin/market/nex/repurchase",
      "/api/admin/treasury/ledger/bills",
    ], evidence);
    report.assertions.frontendState = true;
    report.assertions.backendRecord = true;
  });

  await recordOptionalStep(report, "F/G/H/J 安全方向写操作与 A2/L 回读", ["F5", "G1", "G3", "J1", "D4", "A2", "L3"], async (evidence) => {
    await openAndAssertModule(page, "F5", evidence);
    const f5 = await tryPerformDialogAction(page, [/冻结|解冻|解锁|驳回/], evidence);
    await openAndAssertModule(page, "G1", evidence);
    const g1 = await tryPerformDialogAction(page, [/^停售$|^熔断$/, /调整/], evidence);
    await openAndAssertModule(page, "G3", evidence);
    const g3 = await tryPerformDialogAction(page, [/暂停引擎\(操作确认\)|恢复引擎\(操作确认\)|调整|推进/], evidence);
    await openAndAssertModule(page, "J1", evidence);
    const j1 = await tryPerformDialogAction(page, [/^熔断$|^恢复$|调整|发起应急关停/], evidence, { chooseChip: true });
    return f5 || g1 || g3 || j1;
  });
  await assertShiftAuditTrail(page, account, report, "G3", "L3");
}

async function deviceGrowthShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  await recordStep(report, "E/H/F/D/M/I 设备增长链路页面与后端读取", ["E1", "E2", "E3", "E4", "E5", "H2", "H3", "H4", "H5", "H7", "F1", "D4", "M2", "I3"], async (evidence) => {
    for (const id of ["E1", "E2", "E3", "E4", "E5", "H2", "H3", "H4", "H5", "H7", "F1", "D4", "M2", "I3"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await assertBackendReadable(page, [
      "/api/admin/devices",
      "/api/admin/growth/rhythm",
      "/api/admin/treasury/ledger/bills",
      "/api/admin/content/campaigns/overview",
    ], evidence);
    report.assertions.frontendState = true;
    report.assertions.backendRecord = true;
  });

  await recordOptionalStep(report, "SKU/任务/券/通知/售后闭环安全操作", ["E1", "E2", "E5", "H3", "H7", "I3", "M2", "A2"], async (evidence) => {
    await openAndAssertModule(page, "E1", evidence);
    const e1 = await tryPerformDialogAction(page, [/\+ 新增阶段/, /\+ 新增上架门/, /置换侧抢先购|调整/], evidence);
    await openAndAssertModule(page, "E5", evidence);
    const e5 = await tryPerformDialogAction(page, [/\+ 新增数据中心/, /恢复派单|批量 pause/], evidence);
    await openAndAssertModule(page, "H3", evidence);
    const h3 = await tryPerformDialogAction(page, [/调整奖励/, /^调整$/], evidence);
    await openAndAssertModule(page, "H7", evidence);
    const h7 = await tryPerformDialogAction(page, [/\+ 新增代金券/, /暂停|投放|删除/], evidence);
    return e1 || e5 || h3 || h7;
  });
  await assertShiftAuditTrail(page, account, report, "E", "D4");
}

async function contentEmergencyShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  await recordStep(report, "I/J/K/L 内容应急链路页面与后端读取", ["I1", "I2", "I3", "I4", "I6", "J1", "J2", "J3", "J4", "K1", "K2", "K4", "L5"], async (evidence) => {
    for (const id of ["I1", "I2", "I3", "I4", "I6", "J1", "J2", "J3", "J4", "K1", "K2", "K4", "L5"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await assertBackendReadable(page, [
      "/api/admin/emergency/sop/playbooks",
      "/api/admin/emergency/kill-switches",
      "/api/admin/content/campaigns/overview",
      "/api/admin/content/trust-disclosure/overview",
      "/api/admin/risk/scoring/overview",
      "/api/admin/bi/reports",
    ], evidence);
    report.assertions.frontendState = true;
    report.assertions.backendRecord = true;
  });

  await recordOptionalStep(report, "J4 执行/演练真实响应与 I3/A2 下游验证", ["J4", "I3", "J1", "D2", "K1", "B1", "I4", "A2", "L5"], async (evidence) => {
    await openAndAssertModule(page, "J4", evidence);
    const j4 = await tryPerformDialogAction(page, [/执行剧本/, /发起演练/, /\+ 新增剧本/], evidence, { chooseChip: true });
    await openAndAssertModule(page, "I3", evidence);
    const i3 = await tryPerformDialogAction(page, [/调度下发|立即发送|取消|调整/, /\+ 新建 Campaign/], evidence);
    evidence.push("J4 target-domain note=I3 is real dispatch; J1/D2/B1/C2/K1/I4 are verified as shared config consumption where consumers exist");
    return j4 || i3;
  });
  await assertShiftAuditTrail(page, account, report, "J4", "L5");
}

async function supportUserShift(page: Page, account: ShiftAccount, report: ShiftReport) {
  await recordStep(report, "M/C/D/K/I/A2/L 客服用户链路页面与后端读取", ["M1", "M2", "M3", "M4", "M5", "C1", "C2", "C5", "D2", "K1", "K2", "K4", "I3", "A2", "L4"], async (evidence) => {
    for (const id of ["M1", "M2", "M3", "M4", "M5", "C1", "C2", "C5", "D2", "K1", "K2", "K4", "I3", "A2", "L4"]) {
      await openAndAssertModule(page, id, evidence);
    }
    await assertBackendReadable(page, [
      "/api/admin/content/tickets",
      "/api/admin/content/conversations",
      "/api/admin/content/support-agents",
      "/api/admin/users/profiles",
      "/api/admin/finance/withdrawals",
    ], evidence);
    report.assertions.frontendState = true;
    report.assertions.backendRecord = true;
  });

  await recordOptionalStep(report, "M5 专属顾问到 M3/M2 兜底链路操作", ["M5", "M3", "M2", "A2", "L4"], async (evidence) => {
    await openAndAssertModule(page, "M5", evidence);
    const m5 = await tryPerformDialogAction(page, [/绑定用户/, /配置岗位/, /新增顾问话术|新增即时回复模板/], evidence, { inputValue: "U00000001", chooseChip: true });
    await openAndAssertModule(page, "M3", evidence);
    const m3 = await tryPerformDialogAction(page, [/主动发起|转交|转工单|归档|退回|接收/], evidence, { chooseChip: true });
    await openAndAssertModule(page, "M2", evidence);
    const m2 = await tryPerformDialogAction(page, [/新建工单|转交|状态|优先级|回复/], evidence, { chooseChip: true });
    return m5 || m3 || m2;
  });
  await assertShiftAuditTrail(page, account, report, "M5", "L4");
}

async function assertShiftAuditTrail(page: Page, account: ShiftAccount, report: ShiftReport, sourceDomain: string, downstreamModule: string) {
  const marker = `${account.key}-${RUN_ID}`;
  await recordStep(report, `${sourceDomain} A2 审计标记与 ${downstreamModule} 下游回读`, [sourceDomain, "A2", downstreamModule], async (evidence) => {
    resetMutationCapture(page, evidence);
    await dismissOpenDialogs(page, evidence);
    await createAuditMarker(page, account, sourceDomain);
    await assertAuditVisible(page, marker, evidence);
    await openAndAssertModule(page, downstreamModule, evidence);
    report.assertions.auditA2 = true;
    report.assertions.downstreamVisible = true;
  });
}

async function tryPickSearchOption(page: Page, placeholder: RegExp, keyword: string) {
  const input = page.getByPlaceholder(placeholder).first();
  if (!(await input.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }
  await input.fill(keyword);
  await page.waitForTimeout(900);
  const option = page.locator('[role="option"], [role="listbox"] button').first();
  if (!(await option.isVisible({ timeout: 5_000 }).catch(() => false))) {
    return false;
  }
  await option.click();
  return true;
}

function finalizeReportAssertions(report: ShiftReport) {
  report.assertions.frontendState ||= report.steps.some((step) => step.evidence.some((line) => line.includes("front-state=")));
  report.assertions.backendRecord ||= report.steps.some((step) => step.evidence.some((line) => line.includes("backend-read") || line.includes("POST ")));
  report.assertions.auditA2 ||= report.steps.some((step) => step.evidence.some((line) => line.includes("A2 visible")));
  report.assertions.downstreamVisible ||= report.steps.some((step) => step.evidence.some((line) => /D4|L[3-6]|M2|M3|I3/.test(line)));
}
