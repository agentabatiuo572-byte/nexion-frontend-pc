import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportFlag = process.argv.indexOf("--report");
const reportPath = path.resolve(reportFlag >= 0 ? process.argv[reportFlag + 1] : path.join(process.env.DIRECT_REFERRAL_EVIDENCE_DIR || path.join(root, ".runtime/direct-referral"), "report.json"));
const dir = path.dirname(reportPath);
fs.mkdirSync(dir, { recursive: true });
const report = { capability: "runtime", source: { repo: root, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), diffSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD"], { cwd: root })).digest("hex"), diffScope: "tracked diff only; outer workflow snapshot includes untracked implementation", transport: "explicit Playwright HTTP fixture; real Next.js frontend; no real wallet or database claims" }, startedAt: new Date().toISOString(), steps: [], requests: [], screenshots: [], pageErrors: [], consoleErrors: [] };
const check = (id, evidence) => report.steps.push({ id, status: "passed", evidence });
const copy = value => structuredClone(value);
const disabled = () => ({ enabled: false, totalRatePct: 0, usdtSharePct: 50, coolingDays: 0 });
let policy = { source: "server", serverCanonical: true, sourceEnvironment: "SANDBOX", runId: "direct-referral-runtime", configured: false, policyVersion: 0, effectiveAt: null, nexUsdtPrice: 0.01, purchase: disabled(), deviceEarning: disabled() };
let policyError = false, slowPolicy = false, readonly = false, reviewer = false, coverage = 150, emptyLegacy = true, legacyError = false;
const proposals = [], histories = [];
const common = () => ({ commissionPolicy: {}, guardrails: [], configValues: {}, sources: ["server"], coverage: { coverageRatio: coverage, redlinePct: 100 } });
const kinds = ["network", "binary", "peer", "cultivation", "leadership", "genesis", "direct_purchase", "direct_device_earning"];
const statusNames = { cooling: "冷却计提中", unlocked: "已解锁可提", withdrawn: "已提现", reversed: "已撤销", frozen: "已冻结", rejected: "已拒绝", recovery_pending: "待追回" };
const money = (usdt = 0, nex = 0, count = 0) => ({ usdt, nex, count });
const moneyLabel = m => `USDT ${m.usdt.toFixed(2)} · NEX ${m.nex.toFixed(2)}`;
const group = { settlementNo: "DR-FIXTURE-1", sourceRef: "ORDER-FIXTURE-1", sourceDeviceId: "DEVICE-FIXTURE-1", policyVersion: 1, basisUsdt: 1000, nexUsdtPrice: 0.01, amountUSDT: 60, amountNEX: 4000, recoveryPendingUSDT: 0, recoveryPendingNEX: 0, reversalRecorded: false };
const event = (id, kind, currency, amount, extra = {}) => ({ commissionId: `CM-${id}`, eventId: id, userId: 91, user: "U00000091", sourceUserId: 92, kind, currency, amount, layer: 1, settledAt: "2026-10-05 12:30:45", status: "cooling", coolingDaysLeft: 1, cooldownPercent: 0, cooldownLabel: "冷却计提", state: "计提", auditKey: `F.commission.CM-${id}.status`, version: 1, ledgerBizNo: `LEDGER-${id}`, ...extra });
const allEvents = [event(105, "direct_purchase", "USDT", 60, group), event(104, "direct_purchase", "NEX", 4000, group), event(103, "direct_device_earning", "USDT", 0.3, { ...group, settlementNo: "DR-FIXTURE-2", sourceRef: "EARNING-FIXTURE-2", amountUSDT: 0.3, amountNEX: 20 }), event(102, "direct_device_earning", "NEX", 20, { ...group, settlementNo: "DR-FIXTURE-2", sourceRef: "EARNING-FIXTURE-2", amountUSDT: 0.3, amountNEX: 20 }), event(101, "network", "USDT", 10)];
function f5(url) {
  const events = allEvents.filter(e => !url.searchParams.get("kind") || e.kind === url.searchParams.get("kind"));
  const total = money(events.filter(e => e.currency === "USDT").reduce((n, e) => n + e.amount, 0), events.filter(e => e.currency === "NEX").reduce((n, e) => n + e.amount, 0), events.length);
  return { domain: "F5", ...common(), summary: { monthlyCommissionSpend: total, monthlyCommissionSpendLabel: moneyLabel(total), coolingBalance: total, coolingBalanceLabel: moneyLabel(total), withdrawableThisMonth: money(), withdrawableThisMonthLabel: moneyLabel(money()), frozenCount: 0 }, commissionKinds: kinds.map(key => { const rows = events.filter(e => e.kind === key); const amounts = money(rows.filter(e => e.currency === "USDT").reduce((n, e) => n + e.amount, 0), rows.filter(e => e.currency === "NEX").reduce((n, e) => n + e.amount, 0), rows.length); return { key, code: key, label: key, amounts, amountLabel: moneyLabel(amounts), count: rows.length, countLabel: `${rows.length} 笔`, className: "k-network" }; }), commissionFilters: [{ key: "all", label: "全部" }, ...Object.entries(statusNames).map(([key, label]) => ({ key, label }))], commissionEvents: events, statusDistribution: Object.entries(statusNames).map(([key, name]) => ({ name, color: "var(--warning)", count: key === "cooling" ? events.length : 0 })), recentAuditFeed: [], pagination: { mode: "server-cursor", defaultWindow: "全量游标", defaultPageSize: 20, pageSize: 20, maxPageSize: 100, requestCursor: "", nextCursor: "", total: events.length }, nextCursor: "", total: events.length, anomalies: [], coolingPolicy: [], activeSuspensions: [], operationHistory: [] };
}
const a2 = () => ({ stats: { pendingTickets: proposals.filter(p => p.status === "pending").length, fundTickets: 1, sosTickets: 0, todayAuditEvents: histories.length, weeklyApproved: histories.length, weeklyRejected: 0, weeklyExpired: 0, weeklyWithdrawn: 0 }, operationQueue: proposals, operationHistory: histories, mechanismParams: [{ key: "ttl", name: "理由最短长度", value: "8 字", sub: "操作理由", locked: false }], confirmCategories: [], recentLogs: [] });
async function install(context) {
  await context.route("**/api/admin/**", async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method();
    let body;
    try { body = req.postDataJSON(); } catch { body = undefined; }
    const request = { path: p, method, body, idempotencyKey: req.headers()["idempotency-key"] };
    report.requests.push(request);
    const ok = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const error = (status, message) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status, message, data: null }) });
    if (p.endsWith("/auth/session")) return ok({ tokenType: "Bearer", session: { adminId: reviewer ? 9002 : 9001, username: reviewer ? "direct_reviewer" : "direct_fixture", operator: reviewer ? "隔离审批人" : "隔离验收", role: readonly ? "auditor" : "superadmin", authorities: readonly ? ["network_f2_read", "network_f5_read"] : ["network_f1_read", "network_f2_read", "network_f2_royalty_rate", "network_f2_policy_amplify", "network_f3_read", "network_f4_read", "network_f5_read", "network_f5_write", "network_f5_commission_dispose", "network_f5_commission_reject", "platform_a2_read", "platform_a2_operation_approve"] } });
    if (p.endsWith("/teams/direct-referral-policy")) {
      if (slowPolicy) await new Promise(resolve => setTimeout(resolve, 800));
      return policyError ? error(503, "TEAMS_BACKEND_UNAVAILABLE") : ok(policy);
    }
    if (p.endsWith("/teams/rates")) return legacyError ? error(503, "TEAMS_BACKEND_UNAVAILABLE") : ok({ domain: "F2", ...common(), metrics: [], unilevelRates: emptyLegacy ? [] : Array.from({ length: 7 }, (_, i) => ({ level: `L${i + 1}`, usdtPct: 7 - i, nexReward: i + 1 })), rateTiers: [], policyParams: [{ id: "cool", key: "F.cooldown", name: "其他奖励冷却", value: emptyLegacy ? "" : "30", defaultValue: "30", unit: "天", amplifies: true }], configValues: emptyLegacy ? {} : { "F.cooldown": "30", "F.partner.tiers": '{"standard":0,"verified":5000,"premium":50000,"diamond":500000}' } });
    if (p.endsWith("/teams/commissions")) return ok(f5(url));
    if (p.endsWith("/platform/audit/reason-policy")) return ok({ minChars: 8, maxChars: 200, sourceKey: "admin.a2.reason_min_chars" });
    if (p.endsWith("/platform/audit/overview")) return ok(a2());
    if (p.endsWith("/platform/audit/operations") && method === "POST") {
      assert.ok(request.idempotencyKey, "proposal carries an idempotency key");
      assert.ok(body.reason.length >= 8);
      if (body.command.op === "f_direct_referral_policy") {
        assert.equal(body.obj, "current", "canonical A2 object matches the server descriptor");
        assert.equal(body.sourceDomain, "F2");
        assert.deepEqual(body.target, { domain: "F", type: "direct_referral_policy", id: "current" });
        if (body.command.params.expectedVersion !== policy.policyVersion) return error(409, "DIRECT_REFERRAL_VERSION_CONFLICT");
      }
      const ticket = { id: `A2-DR-${proposals.length + 1}`, ...body, beforeValue: body.beforeValue, afterValue: body.afterValue, ts: "10-05 12:00", mine: false, status: "pending" };
      proposals.push(ticket); return ok(ticket);
    }
    if (p.endsWith("/approve") && p.includes("/platform/audit/operations/")) {
      assert.ok(request.idempotencyKey); const ticket = proposals.find(t => p.includes(t.id)); assert.ok(ticket);
      const params = ticket.command.params; assert.equal(params.expectedVersion, policy.policyVersion);
      policy = { ...policy, configured: true, policyVersion: policy.policyVersion + 1, effectiveAt: new Date().toISOString(), purchase: copy(params.purchase), deviceEarning: copy(params.deviceEarning) };
      ticket.status = "approved"; histories.push({ id: ticket.id, action: ticket.action, st: "approved", chain: "隔离审批", t: "10-05 12:00", note: body.reason }); return ok(ticket);
    }
    if (p.endsWith("/teams/ranks")) return ok({ domain: "F1", ...common(), vrankRows: Array.from({ length: 13 }, (_, i) => ({ v: `V${i}`, label: `等级 ${i}`, pop: 0, rewards: [] })), rewards: {}, voucherOptions: [], voucherLabels: {}, skuOptions: [], skuLabels: {}, leadership: { ranks: [] } });
    if (p.endsWith("/teams/binary")) return ok({ domain: "F3", ...common(), metrics: [], formula: {}, settlements: [], dailyCap: {}, config: {}, maxTrackGmv: 0, participantCount: 0, blockedCount: 0, monthlyMatchedUsd: 0, autoPlacement7dCount: 0, dailyMatchUsd: 0 });
    if (p.endsWith("/teams/leadership-pool")) return ok({ domain: "F4", ...common(), metrics: [], quotaRows: [], ambassadorBands: [], podium: [], voteWeights: [{ v: "V3", votes: 1 }], config: {} });
    if (p.endsWith("/promotion-log") || p.endsWith("/reward-payouts")) return ok({ items: [], total: 0, nextCursor: "", limit: 100 });
    return ok({});
  });
}
let app, browser;
const probe = http.createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
report.source.url = `http://127.0.0.1:${port}`;
const log = fs.createWriteStream(path.join(dir, "next-runtime.log"));
try {
  app = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, windowsHide: true, env: { ...process.env, NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || ".next", NEXION_BACKEND_URL: "http://127.0.0.1:1" }, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.pipe(log); app.stderr.pipe(log);
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Next startup timeout")), 120000); const listen = data => { if (data.toString().includes("Ready")) { clearTimeout(timer); resolve(); } }; app.stdout.on("data", listen); app.on("exit", code => { clearTimeout(timer); reject(new Error(`Next exited ${code}`)); }); });
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "zh-CN", timezoneId: "Asia/Tokyo" });
  await install(context);
  const page = await context.newPage();
  page.on("pageerror", e => report.pageErrors.push(e.message));
  page.on("console", m => { if (m.type() === "error") report.consoleErrors.push(m.text()); });
  const shot = async name => { const file = path.join(dir, `${name}.png`); await page.screenshot({ path: file, fullPage: true }); report.screenshots.push(file); return file; };
  const open = route => page.goto(report.source.url + route, { waitUntil: "domcontentloaded", timeout: 120000 });
  slowPolicy = true;
  await open("/network/royalty");
  await expect(page.getByLabel("直属分成配置加载中")).toBeVisible();
  await expect(page.getByText("未配置，尚未启用。", { exact: false })).toBeVisible();
  check("F2-loading-empty", [await shot("f2-empty"), "disabled canonical placeholder was read over fixture HTTP"]);
  const historyPane = page.locator("section.pane").filter({ hasText: "历史网络版税" });
  await expect(historyPane).toContainText("暂无历史 L1–L7 费率数据");
  await expect(historyPane.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "配置权益门槛", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "配置冷却期", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "配置权益门槛", exact: true }).click();
  const emptyPartnerDialog = page.getByRole("dialog");
  for (const label of ["Standard", "Verified", "Premium", "Diamond"]) await expect(emptyPartnerDialog.getByLabel(label + " 门槛(USD)", { exact: false })).toHaveValue("");
  await emptyPartnerDialog.getByLabel(/操作理由/).fill("验证未配置门槛不误提交零值");
  await expect(emptyPartnerDialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await emptyPartnerDialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "配置冷却期", exact: false }).click();
  const emptyCoolingDialog = page.getByRole("dialog");
  await expect(emptyCoolingDialog.getByLabel("目标新值", { exact: false })).toHaveValue("");
  await emptyCoolingDialog.getByLabel(/操作理由/).fill("验证未配置冷却不误提交零天");
  await expect(emptyCoolingDialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await emptyCoolingDialog.getByLabel("目标新值", { exact: false }).fill("0");
  await expect(emptyCoolingDialog.getByRole("button", { name: "确认提交", exact: true })).toBeEnabled();
  await emptyCoolingDialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(proposals.length, 0);
  check("F2-legacy-empty-independent", [await shot("f2-history-empty"), "empty seven-layer history renders as empty; independent configuration is available with blank values, no fabricated thresholds or cooling period; cancelled without mutation"]);
  legacyError = true; await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "历史网络版税快照加载失败" })).toBeVisible();
  await expect(page.getByLabel("直属购买分成启用状态")).toBeEnabled();
  legacyError = false; emptyLegacy = false; await page.reload();
  await expect(historyPane.locator(".casc-row")).toHaveCount(7);
  await expect(historyPane.locator(".casc-row").first()).toContainText("7% USDT");
  await expect(historyPane.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "调整权益门槛", exact: true })).toBeVisible();
  await page.reload(); await expect(historyPane.locator(".casc-row")).toHaveCount(7);
  check("F2-legacy-readonly-isolated", [await shot("f2-history-readonly"), "real contract field names usdtPct/nexReward render all seven rows after reload; L1 is read from snapshot rather than fixed 10%; no historical write controls; legacy read failure leaves direct form usable"]);
  slowPolicy = false; policyError = true;
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "草稿已保留" })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  policyError = false; await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByLabel("直属购买分成启用状态")).toBeEnabled();
  check("F2-error-retry", ["503 clears authority and disables submission; explicit retry recovers"]);
  const fill = async () => {
    for (const [label, rate, cooling] of [["直属购买分成", "10", "7"], ["直属设备收益分成", "5", "2"]]) {
      await page.getByLabel(label + "启用状态", { exact: true }).selectOption("enabled");
      await page.getByLabel(label + "总分成比例 (%)", { exact: true }).fill(rate);
      await page.getByLabel(label + "USDT 占比 (%)", { exact: true }).fill("60");
      await page.getByLabel(label + "冷却天数", { exact: true }).fill(cooling);
    }
  };
  await fill();
  await page.getByLabel("直属购买分成启用状态", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("直属购买分成总分成比例 (%)", { exact: true })).toBeFocused();
  await page.getByLabel("直属购买分成USDT 占比 (%)", { exact: true }).fill("100");
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  await page.getByLabel("直属购买分成USDT 占比 (%)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "提交审批", exact: true }).focus(); await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("USDT 60% / NEX 40%");
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "提交审批", exact: true }).focus(); await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await expect(page.getByLabel("直属购买分成总分成比例 (%)", { exact: true })).toHaveValue("10");
  assert.equal(proposals.length, 0);
  check("F2-validation-cancel", ["100% single-currency split blocked; cancel made zero requests and preserved both drafts"]);
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("短理由");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill("隔离环境验证直属两类整组配置");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).focus(); await page.keyboard.press("Enter");
  await expect(page.getByText("已提交 A2 待审批；当前生效配置尚未改变。", { exact: false })).toBeVisible();
  assert.equal(policy.policyVersion, 0); assert.equal(proposals.length, 1);
  assert.equal(proposals[0].command.op, "f_direct_referral_policy");
  assert.deepEqual(proposals[0].target, { domain: "F", type: "direct_referral_policy", id: "current" });
  assert.equal(proposals[0].command.params.purchase.usdtSharePct, 60);
  assert.equal(proposals[0].command.params.deviceEarning.totalRatePct, 5);
  assert.deepEqual(Object.keys(proposals[0].command.params).sort(), ["deviceEarning", "expectedVersion", "purchase"]);
  check("F2-one-atomic-proposal", [await shot("f2-pending"), "canonical A2 object, target and sourceDomain match the server; one durable-key proposal includes both rules and expectedVersion 0; policy remains 0 until approved"]);
  check("F2-keyboard-accessibility", ["Tab moved from labeled switch to labeled number input; Enter opened and submitted confirmation; Escape and Cancel closed without mutation; all critical controls resolved by accessible label"]);
  reviewer = true; await open("/platform/audit");
  const ticket = page.locator("tr").filter({ hasText: "A2-DR-1" });
  await ticket.getByRole("button", { name: "执行", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("核对两币与整组版本后批准隔离验收");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect.poll(() => policy.policyVersion).toBe(1);
  await open("/network/royalty");
  await expect(page.getByText("当前版本 1", { exact: false })).toBeVisible();
  assert.ok(Number.isFinite(Date.parse(policy.effectiveAt)));
  await expect(page.getByText(`生效于 ${new Date(policy.effectiveAt).toLocaleString("zh-CN", { timeZone: "Asia/Tokyo" })}`, { exact: false })).toBeVisible();
  await expect(page.getByLabel("直属设备收益分成总分成比例 (%)", { exact: true })).toHaveValue("5");
  await page.reload();
  await expect(page.getByLabel("直属购买分成总分成比例 (%)", { exact: true })).toHaveValue("10");
  check("F2-approved-readback-persistence", [await shot("f2-approved-reload"), "actual A2 page confirmation changed fixture policy; GET + browser reload retains version 1 and both rules"]);
  await page.getByLabel("直属购买分成总分成比例 (%)", { exact: true }).fill("11");
  policy = { ...policy, policyVersion: 2 };
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("配置版本已变化，当前草稿未覆盖。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("直属购买分成总分成比例 (%)", { exact: true })).toHaveValue("11");
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "放弃草稿并重载", exact: true }).click();
  check("F2-version-conflict", ["new server version preserves conflicting draft, blocks submit, explicit discard reloads"]);
  coverage = 90; await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.getByLabel("直属购买分成总分成比例 (%)", { exact: true }).fill("11");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  dialog = page.getByRole("dialog"); await dialog.getByLabel(/操作理由/).fill("验证低覆盖率阻止放大分成");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByLabel("直属购买分成启用状态", { exact: true }).selectOption("disabled");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  dialog = page.getByRole("dialog"); await dialog.getByLabel(/操作理由/).fill("验证低覆盖率允许停用分成");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  check("F2-B1-direction", ["90% coverage blocks amplification but permits disabling one rule"]);
  readonly = true; await page.reload();
  await expect(page.getByLabel("直属购买分成启用状态")).toBeDisabled();
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toHaveCount(0);
  check("F2-readonly", [await shot("f2-readonly"), "read-only session shows values without editable controls"]);
  readonly = false; coverage = 150; await open("/network/commissions");
  await expect(page.getByRole("region", { name: "八类佣金支出与状态分布" })).toBeVisible();
  assert.equal(await page.getByLabel("佣金类型").locator("option").count(), 9);
  await expect(page.getByTestId("f5-commission-kind-card").filter({ hasText: "直属购买分成" })).toBeVisible();
  await expect(page.getByTestId("f5-commission-kind-card").filter({ hasText: "直属设备收益分成" })).toBeVisible();
  const directRow = page.locator("tr").filter({ hasText: "CM-105" });
  await directRow.getByText("来源详情", { exact: true }).click();
  await expect(directRow).toContainText("60 USDT + 4000 NEX");
  await shot("f5-direct-group");
  await expect(directRow.getByRole("checkbox")).toBeDisabled();
  await expect(directRow.getByRole("button", { name: "提前解锁", exact: true })).toHaveCount(0);
  await page.getByLabel("佣金类型").selectOption("direct_device_earning");
  await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
  await expect(page.locator("tr").filter({ hasText: "CM-103" })).toBeVisible();
  await page.getByLabel("佣金类型").selectOption("network"); await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
  await expect(page.locator("tr").filter({ hasText: "CM-101" })).toBeVisible();
  check("F5-new-groups-and-history", [await shot("f5-history"), "eight filters, two direct kinds, group snapshot, legacy history, direct cooling cannot be unlocked early or reissued"]);
  for (const [route, text] of [["/network/v-rank", "V-Rank"], ["/network/binary", "双轨"], ["/network/leadership-pool", "领导"]]) {
    await open(route); await expect(page).toHaveURL(report.source.url + route); await expect(page.locator("body")).toContainText(text); check(`preserved-${route}`, [await shot(route.split("/").pop()), "existing route remains rendered and reachable"]);
  }
  assert.deepEqual(report.pageErrors, []);
  report.expectedConsoleErrors = report.consoleErrors.filter(message => message.includes("503 (Service Unavailable)"));
  assert.deepEqual(report.consoleErrors.filter(message => !message.includes("503 (Service Unavailable)")), []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = error.stack || String(error); process.exitCode = 1;
} finally {
  await browser?.close();
  if (app?.pid) { if (process.platform === "win32") { try { execFileSync("taskkill", ["/pid", String(app.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }); } catch {} } else app.kill("SIGTERM"); }
  log.end(); report.completedAt = new Date().toISOString(); fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, report: reportPath, steps: report.steps.length, error: report.error?.split("\n").slice(0, 3) }));
}
