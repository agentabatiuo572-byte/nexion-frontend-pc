import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  evaluateModuleHealthSnapshot,
  isUnmarkedBusinessErrorText,
} from "./e2e/pc-module-health-contract.mjs";

const healthySnapshot = (overrides = {}) => ({
  text: "服务端权威数据已加载。这里展示当前模块的真实业务指标、筛选条件、处理入口与最近更新时间。".repeat(4),
  headingCount: 1,
  landmarkCount: 1,
  controlCount: 2,
  visibleLoadingCount: 0,
  alertTexts: [],
  semanticErrorScanComplete: true,
  terminalErrorMarkerCount: 0,
  unmarkedBusinessErrorTexts: [],
  ...overrides,
});

test("full-menu gate rejects A5-style handled business errors even when the page is non-empty", () => {
  const failures = evaluateModuleHealthSnapshot("A5", healthySnapshot({
    text: "平台参数寄存器 A5。平台参数服务返回异常，请稍后重试。".repeat(8),
  }));

  assert.ok(failures.some((failure) => failure.includes("fatal text")));
});

test("full-menu gate requires a completed semantic error scan and rejects unknown unmarked failures", () => {
  const missingScan = healthySnapshot();
  delete missingScan.semanticErrorScanComplete;
  assert.ok(evaluateModuleHealthSnapshot("A1", missingScan)
    .some((failure) => failure.includes("semantic error scan missing")));

  assert.ok(evaluateModuleHealthSnapshot("A1", healthySnapshot({
    text: "域 A · 总览 业务规则冲突，请联系管理员。".repeat(10),
    unmarkedBusinessErrorTexts: ["业务规则冲突，请联系管理员。"],
  })).some((failure) => failure.includes("unmarked business error")));

  assert.ok(evaluateModuleHealthSnapshot("A1", healthySnapshot({
    terminalErrorMarkerCount: 1,
  })).some((failure) => failure.includes("terminal error markers")));
});

test("semantic classifier rejects terminal failures without confusing operational guidance", () => {
  assert.equal(isUnmarkedBusinessErrorText("业务规则冲突，请联系管理员。"), true);
  assert.equal(isUnmarkedBusinessErrorText("负载策略暂不可用 · 请刷新重试"), true);
  assert.equal(
    isUnmarkedBusinessErrorText("服务返回的字段不符合约定，已停止展示。"),
    true,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("接口返回结果缺少必填字段，页面已停止展示。"),
    true,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("服务端权威页面数据不完整或不一致，页面已停止展示旧数据与写操作；请刷新重试。"),
    true,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("缺失源字段明确标为不可用，不推测数值。"),
    false,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("覆盖率不够时服务器拒绝提交；确认时仍要看当前值。"),
    false,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("接口失败时页面会停止展示旧值，等待重新读取。"),
    false,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("数据不可用时系统停止写入，避免误操作。"),
    false,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("数据读取失败时本页不会用零值代替。"),
    false,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("告警读取失败 · 网络连接失败或后台服务不可达 · 未展示缓存值"),
    true,
  );
  assert.equal(
    isUnmarkedBusinessErrorText("KPI 刷新未成功 · 当前仍显示上一次已校验快照，时间窗未切换。网络连接失败或后台服务不可达"),
    true,
  );
  assert.equal(isUnmarkedBusinessErrorText("资金流历史暂不可用：网络连接失败或后台服务不可达"), true);
  assert.equal(isUnmarkedBusinessErrorText("月新增入金暂不可用：网络连接失败或后台服务不可达"), true);
  assert.equal(isUnmarkedBusinessErrorText("趋势暂不可用：网络连接失败或后台服务不可达"), true);
  assert.equal(
    isUnmarkedBusinessErrorText("操作未完成,请刷新页面核对最新状态后重试;若仍未恢复请联系值班人员。"),
    true,
  );
});

test("centralized terminal read and protocol errors cannot bypass the semantic gate", () => {
  const errorMessageSource = fs.readFileSync(
    new URL("../lib/admin/error-messages.ts", import.meta.url),
    "utf8",
  );
  const registeredMessages = Array.from(
    errorMessageSource.matchAll(/:\s*"([^"\r\n]+)"/g),
    (match) => match[1],
  );
  const terminalMessages = registeredMessages.filter((message) =>
    /(?:已停止(?:展示|使用|报价|加载|写入|渲染)|页面已停止|停止展示|停止使用旧|关闭写操作|已隐藏|已清空|已冻结|已禁用|当前不展示|不会开放|冻结写操作|关闭.{0,30}(?:入口|导出|操作))/.test(message));

  assert.ok(terminalMessages.length >= 40, "terminal error corpus unexpectedly shrank");
  assert.deepEqual(
    terminalMessages.filter((message) => !isUnmarkedBusinessErrorText(message)),
    [],
  );
});

test("actual terminal UI branches remain bound to the semantic gate", () => {
  const actualTerminalBranches = [
    ["../app/_console/users/search/[id]/page.tsx", "用户标识缺失，已停止加载"],
    ["../app/components/domain-views/d-tabs/d6-fx.tsx", "写入结果未确认，已停止展示旧牌价"],
    ["../app/components/domain-views/d-tabs/d4-ledger.tsx", "资金账本已停止展示旧数据"],
    ["../app/components/domain-views/d-tabs/d1-recon.tsx", "D1 已停止展示旧数据"],
    ["../app/components/domain-views/d-tabs/d5-params.tsx", "旧值已清空，全部写操作保持冻结。"],
    ["../app/components/domain-views/a-tabs/a2-audit.tsx", "审计中心读取失败，旧数据已清空，所有操作均已停用"],
    ["../app/components/domain-views/j-tabs/j1-killswitch.tsx", "当前无法确认业务闸状态"],
    ["../app/components/domain-views/j-tabs/j2-geoblock.tsx", "当前无法确认地区封锁状态"],
    ["../app/components/domain-views/k-tabs/k1-multiaccount.tsx", "已隐藏旧数据与写操作，避免误处置"],
    ["../app/components/domain-views/k-tabs/k2-arbitrage.tsx", "已隐藏旧数据与写操作，避免误处置"],
    ["../app/components/domain-views/m-tabs/m1-overview.tsx", "系统已停止使用空名册推断权限,请刷新后重试。"],
    ["../app/components/domain-views/m-tabs/m1-overview.tsx", "坐席数据暂不可用,当前不会开放坐席与负载调整。"],
    ["../app/components/domain-views/l-tabs/l5-export.tsx", "能力边界加载失败，已按最小权限关闭解密导出。"],
    ["../app/components/domain-views/k-tabs/k3-rules.tsx", "K3 权威数据不可用，已禁用模拟"],
    ["../app/components/domain-views/k-tabs/k6/queue.tsx", "设备队列读取失败，数据未更新。"],
    ["../app/components/domain-views/k-tabs/k6/strategy-center.tsx", "策略列表读取失败，数据未更新。"],
    ["../app/components/domain-views/k-tabs/k6/audit-log.tsx", "审计记录读取失败，数据未更新。"],
    ["../app/components/domain-views/k-tabs/k6/dashboard.tsx", "看板读取失败，未显示旧数据且数据未更新。"],
    ["../app/components/domain-views/k-tabs/k6/device-detail.tsx", "详情加载失败，未展示队列摘要代替详情。"],
    ["../app/components/domain-views/a-tabs/a1-accounts.tsx", "权限差异预览不可用，改角色已停用"],
    ["../app/components/domain-views/a-tabs/a1-accounts.tsx", "后端刷新失败:"],
    ["../app/components/domain-views/a-tabs/a6-roles.tsx", "角色目录加载失败，当前数据不可确认。"],
    ["../app/components/domain-views/a-tabs/a7-menus.tsx", "菜单目录加载失败，当前数据不可确认。"],
    ["../app/components/domain-views/a-tabs/a8-permissions.tsx", "角色授权读取失败,矩阵不可信。"],
    ["../app/components/domain-views/e-tabs/e2-tasks.tsx", "E2 数据读取失败，当前空值不代表真实业务为零"],
    ["../app/components/domain-views/e-tabs/e5-ops.tsx", "设备库存读取异常:"],
    ["../app/components/domain-views/e-tabs/e6-compute-config.tsx", "E6 配置读取失败:"],
    ["../app/components/domain-views/e-view.tsx", "详情读取失败:"],
    ["../app/components/domain-views/g-tabs/g4-admin-operations.tsx", "刷新失败，以下为上次成功快照"],
    ["../app/components/domain-views/k-tabs/k4-scoring.tsx", "K4 读取失败"],
    ["../app/components/domain-views/k-tabs/k4-scoring.tsx", "告警读取失败"],
    ["../app/components/domain-views/m-tabs/m2-tickets.tsx", "工单数据暂时无法同步,当前不展示空队列,也不会开放写操作。"],
    ["../app/components/domain-views/m-tabs/m3-sessions.tsx", "会话数据暂时无法同步,当前不会把空列表当作真实结果,写操作也已关闭。"],
    ["../app/components/domain-views/m-tabs/m4-kb-sla.tsx", "知识库后端当前不可用,页面已停止写入,避免显示未落库的成功状态。"],
    ["../app/components/domain-views/m-tabs/m5-scripts.tsx", "话术与模板后端当前不可用，页面已进入只读保护；恢复同步后才能修改。"],
    ["../app/components/domain-views/l-tabs/l1-kpi.tsx", "L1 权威响应协议校验失败"],
    ["../app/components/domain-views/l-tabs/l1-kpi.tsx", "KPI 刷新未成功"],
    ["../app/components/dashboard/restored-b-insights.tsx", "资金流历史暂不可用："],
    ["../app/components/dashboard/restored-b-insights.tsx", "月新增入金暂不可用："],
    ["../app/components/dashboard/restored-b-insights.tsx", "趋势暂不可用："],
  ];

  for (const [relativePath, terminalText] of actualTerminalBranches) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.ok(source.includes(terminalText), `actual terminal branch missing: ${relativePath}`);
    assert.equal(isUnmarkedBusinessErrorText(terminalText), true, `terminal branch bypassed classifier: ${relativePath}`);
  }
});

test("unmarked terminal renderers expose a structural error marker", () => {
  const markedBranches = [
    ["../app/components/domain-views/m-tabs/m4-kb-sla.tsx", /data-module-health-state="error"[^>]*>知识库后端当前不可用/],
    ["../app/components/domain-views/m-tabs/m5-scripts.tsx", /data-module-health-state="error"[^>]*>话术与模板后端当前不可用/],
    ["../app/components/domain-views/l-tabs/l1-kpi.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,100}<b>L1 权威响应协议校验失败/],
    ["../app/components/domain-views/a-tabs/a2-audit.tsx", /data-module-health-state=\{loadError \? "error" : undefined\}[\s\S]{0,200}审计中心读取失败/],
    ["../app/components/domain-views/d-tabs/d5-params.tsx", /data-module-health-state="error">[\s\S]{0,160}D5 权威配置不可用/],
    ["../app/components/domain-views/j-tabs/j1-killswitch.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,160}当前无法确认业务闸状态/],
    ["../app/components/domain-views/j-tabs/j2-geoblock.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,160}当前无法确认地区封锁状态/],
    ["../app/components/domain-views/k-tabs/k1-multiaccount.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,160}K1 数据加载失败/],
    ["../app/components/domain-views/k-tabs/k2-arbitrage.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,160}K2 数据加载失败/],
    ["../app/components/domain-views/k-tabs/k4-scoring.tsx", /data-module-health-state="error"[^>]*>告警读取失败/],
    ["../app/components/domain-views/k-tabs/k6/queue.tsx", /data-module-health-state="error"[^>]*>设备队列读取失败/],
    ["../app/components/domain-views/k-tabs/k6/strategy-center.tsx", /data-module-health-state="error"[^>]*>策略列表读取失败/],
    ["../app/components/domain-views/k-tabs/k6/audit-log.tsx", /data-module-health-state="error"[^>]*>审计记录读取失败/],
    ["../app/components/domain-views/k-tabs/k6/dashboard.tsx", /data-module-health-state="error"[^>]*>看板读取失败/],
    ["../app/components/domain-views/k-tabs/k6/device-detail.tsx", /data-module-health-state=\{detailStatus === "error" \? "error" : undefined\}[\s\S]{0,220}详情加载失败/],
    ["../app/components/domain-views/a-tabs/a1-accounts.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,80}后端刷新失败/],
    ["../app/components/domain-views/g-tabs/g4-admin-operations.tsx", /data-module-health-state="error"[^>]*>刷新失败，以下为上次成功快照/],
    ["../app/components/domain-views/e-view.tsx", /data-module-health-state="error"[^>]*>详情读取失败:/],
    ["../app/components/domain-views/l-tabs/l1-kpi.tsx", /data-module-health-state="error"[^>]*>[\s\S]{0,100}<b>KPI 刷新未成功/],
    ["../app/components/dashboard/restored-b-insights.tsx", /<Notice healthState="error">\{`资金流历史暂不可用：/],
    ["../app/components/dashboard/restored-b-insights.tsx", /<Notice healthState="error">\{`月新增入金暂不可用：/],
    ["../app/components/dashboard/restored-b-insights.tsx", /<Notice healthState="error">\{`趋势暂不可用：/],
    ["../app/components/domain-views/e-tabs/e5-ops.tsx", /healthError\s*&&\s*<tr><td[^>]*data-module-health-state="error"[^>]*>\{healthError\}/],
  ];

  for (const [relativePath, markerPattern] of markedBranches) {
    const source = fs.readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, markerPattern, `structural error marker missing: ${relativePath}`);
  }
});

test("full-menu gate rejects thin shells, persistent loading and unapproved role alerts", () => {
  assert.ok(evaluateModuleHealthSnapshot("A1", healthySnapshot({
    text: "平台基础 A1",
    landmarkCount: 0,
    controlCount: 0,
  })).some((failure) => failure.includes("substantive content")));

  assert.ok(evaluateModuleHealthSnapshot("L5", healthySnapshot({
    visibleLoadingCount: 1,
  })).some((failure) => failure.includes("persistent loading")));

  assert.ok(evaluateModuleHealthSnapshot("K4", healthySnapshot({
    alertTexts: ["model.weights 数据不完整"],
  })).some((failure) => failure.includes("role=alert")));
});

test("full-menu gate preserves explicit truthful B3 and J1 operational alerts", () => {
  assert.deepEqual(evaluateModuleHealthSnapshot("B3", healthySnapshot({
    alertTexts: ["当前漏斗不可安全计算当前筛选范围没有可确认的注册用户，转化率不可计算；请检查 A4 注册事件或调整筛选条件。"],
  })), []);

  assert.deepEqual(evaluateModuleHealthSnapshot("J1", healthySnapshot({
    alertTexts: ["1 项自动关停结论已逾期未补录 —— 闸已止血,但处置理由仍空缺;逾期事项不会自行消失,请值班人员立即补录,或上报值班主管接手。· 提现闸(截止 2026-07-20 06:05)"],
  })), []);
});

test("full-menu gate rejects prefix and suffix injection around approved alerts", () => {
  const b3 = "当前漏斗不可安全计算当前筛选范围没有可确认的注册用户，转化率不可计算；请检查 A4 注册事件或调整筛选条件。";
  const j1 = "1 项自动关停结论已逾期未补录 —— 闸已止血,但处置理由仍空缺;逾期事项不会自行消失,请值班人员立即补录,或上报值班主管接手。· 提现闸(截止 2026-07-20 06:05)";

  for (const [moduleId, alert] of [["B3", b3], ["J1", j1]]) {
    assert.ok(evaluateModuleHealthSnapshot(moduleId, healthySnapshot({
      alertTexts: [`未批准告警前缀；${alert}`],
    })).some((failure) => failure.includes("role=alert")));
    assert.ok(evaluateModuleHealthSnapshot(moduleId, healthySnapshot({
      alertTexts: [`${alert}；任意错误后缀`],
    })).some((failure) => failure.includes("role=alert")));
  }
});

test("full-menu gate allows only the exact structured F4 settlement HOLD alert", () => {
  const exact = "提前结算已暂停 · 领导奖池结算配置不可用：奖池比例 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置";
  const allConcreteItems = "提前结算已暂停 · 领导奖池结算配置不可用：配置版本、奖池比例、月度 cap、解锁等级、结算周期 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置";

  assert.deepEqual(evaluateModuleHealthSnapshot("F4", healthySnapshot({ alertTexts: [exact] })), []);
  assert.deepEqual(evaluateModuleHealthSnapshot("F4", healthySnapshot({ alertTexts: [allConcreteItems] })), []);

  for (const alert of [
    `未批准告警前缀；${exact}`,
    `${exact}；任意错误后缀`,
    "领导奖池结算配置不可用：奖池比例 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置",
    "提前结算已暂停 · 领导奖池结算配置不可用：权威配置 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置",
    "提前结算已暂停 · 领导奖池结算配置不可用：奖池比例、奖池比例 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置",
    "提前结算已暂停 · 领导奖池结算配置不可用：结算周期、配置版本 缺失或格式错误。配置入口就在本卡片下方，请依次补齐后重新读取配置。重新读取配置",
    "提前结算已暂停 · 领导奖池结算配置不可用：奖池比例 缺失或格式错误。请联系管理员。重新读取配置",
  ]) {
    assert.ok(evaluateModuleHealthSnapshot("F4", healthySnapshot({ alertTexts: [alert] }))
      .some((failure) => failure.includes("role=alert")), `F4 alert must stay rejected: ${alert}`);
  }

  assert.ok(evaluateModuleHealthSnapshot("F3", healthySnapshot({ alertTexts: [exact] }))
    .some((failure) => failure.includes("role=alert")), "F4 HOLD allowlist must not apply to other modules");
  assert.ok(evaluateModuleHealthSnapshot("F4", healthySnapshot({
    text: "平台参数服务返回异常，请稍后重试。".repeat(20),
    alertTexts: [exact],
  })).some((failure) => failure.includes("fatal text")), "F4 alert allowlist must not bypass fatal text");
  assert.ok(evaluateModuleHealthSnapshot("F4", healthySnapshot({
    alertTexts: [exact],
    unmarkedBusinessErrorTexts: ["业务规则冲突，请联系管理员。"],
  })).some((failure) => failure.includes("unmarked business error")), "F4 alert allowlist must not bypass unmarked errors");
});

test("full-menu gate does not confuse K6 fail-closed guidance with a live failure", () => {
  assert.deepEqual(evaluateModuleHealthSnapshot("K6", healthySnapshot({
    text: "策略健康度由服务端给出。读取失败时本页不会用零值或浏览器计算结果代替。".repeat(8),
  })), []);
});

test("checked-in 75-page producer binds build identity and records first, reload, back and relogin with trace", () => {
  const source = fs.readFileSync(new URL("./e2e/pc-all-modules-final-acceptance.spec.ts", import.meta.url), "utf8");
  const inAppProducer = fs.readFileSync(
    new URL("../scripts/run-pc-75-inapp-browser-evidence.mjs", import.meta.url),
    "utf8",
  );
  assert.match(source, /test\.use\(\{[\s\S]*trace:\s*"on"/);
  assert.match(source, /backPass:\s*string\[\]/);
  assert.match(source, /await\s+page\.goBack\(/);
  assert.match(source, /expect\(evidence\.backPass\)\.toEqual\(MODULES\.map/);
  assert.match(source, /buildId:\s*process\.env\.PC_FINAL_BUILD_ID/);
  assert.match(inAppProducer, /entryMethod:\s*"visible-sidebar"/);
  assert.match(inAppProducer, /await\s+tab\.reload\(\)/);
  assert.match(inAppProducer, /await\s+tab\.back\(\)/);
  assert.match(inAppProducer, /if\s*\(await\s+tab\.url\(\)\s*!==/);
  assert.match(inAppProducer, /journal-live\.json/);
  assert.match(inAppProducer, /buildId/);
});

test("checked-in final producer captures all 75 modules across five visual stages and reports 75x4 health", () => {
  const source = fs.readFileSync(new URL("./e2e/pc-all-modules-final-acceptance.spec.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /REMAINING_DEVELOPMENT_EVIDENCE_IDS/);
  assert.match(source, /const VISUAL_EVIDENCE_STAGES = \[[\s\S]*"00-visible-sidebar-entry"[\s\S]*"01-settled-page"[\s\S]*"02-after-refresh"[\s\S]*"03-after-browser-back"[\s\S]*"04-after-relogin"[\s\S]*\] as const;/);
  assert.match(source, /const EXPECTED_VISUAL_EVIDENCE_COUNT = MODULES\.length \* VISUAL_EVIDENCE_STAGES\.length;/);
  assert.match(source, /expect\(stepLog[\s\S]*\)\.toHaveLength\(EXPECTED_VISUAL_EVIDENCE_COUNT\)/);
  assert.match(source, /expectedScreenshotCount:\s*EXPECTED_VISUAL_EVIDENCE_COUNT/);
  assert.match(source, /expectedHealthyChecks:\s*MODULES\.length \* 4/);
  assert.match(source, /actualHealthyChecks:\s*evidence\.firstPass\.length[\s\S]*evidence\.refreshed\.length[\s\S]*evidence\.backPass\.length[\s\S]*evidence\.reloginPass\.length/);
  assert.match(source, /assertFreshEvidenceDirectory\(EVIDENCE_DIR\)/);
  assert.match(source, /fs\.readdirSync\(evidenceDir\)/);
});
