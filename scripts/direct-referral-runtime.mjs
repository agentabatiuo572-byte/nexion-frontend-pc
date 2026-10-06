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
const report = { capability: "runtime", source: { repo: root, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), diffSha256: createHash("sha256").update(execFileSync("git", ["diff", "HEAD"], { cwd: root, maxBuffer: 16 * 1024 * 1024 })).digest("hex"), diffScope: "tracked diff only; outer workflow snapshot includes untracked implementation", transport: "explicit Playwright HTTP fixture; real Next.js frontend; no real wallet or database claims" }, startedAt: new Date().toISOString(), steps: [], requests: [], screenshots: [], pageErrors: [], consoleErrors: [] };
const check = (id, evidence) => report.steps.push({ id, status: "passed", evidence });
const copy = value => structuredClone(value);
const disabled = () => ({ enabled: false, totalRatePct: 0, usdtSharePct: 50, coolingDays: 0 });
let policy = { schemaVersion: 2, policySchemaVersion: 1, purchaseSplitConfigured: false, settlementMode: "DIRECT_ONLY_V1", sevenLayerEnabled: false, cutoverAt: null, sevenLayerRevision: 1, sevenLayerReference: { revision: 1, baseRatePct: null, coolingDays: null, legacyNexPerUsd: null }, source: "server", serverCanonical: true, sourceEnvironment: "SANDBOX", runId: "direct-referral-runtime", configured: false, policyVersion: 0, effectiveAt: null, nexUsdtPrice: 0.01, purchaseSplit: { enabled: false, usdtSharePct: 50 }, deviceEarning: disabled() };
let policyError = false, slowPolicy = false, readonly = false, reviewer = false, coverage = 150, emptyLegacy = true, legacyError = false;
let releaseInitialPolicy;
const initialPolicyGate = new Promise(resolve => { releaseInitialPolicy = resolve; });
const proposals = [], histories = [];
const common = () => ({ commissionPolicy: {}, guardrails: [], configValues: {}, sources: ["server"], coverage: { coverageRatio: coverage, redlinePct: 100 } });
const kinds = ["network", "binary", "peer", "cultivation", "leadership", "genesis", "direct_purchase", "direct_device_earning"];
const statusNames = { cooling: "冷却计提中", unlocked: "已解锁可提", withdrawn: "已提现", reversed: "已撤销", frozen: "已冻结", rejected: "已拒绝", recovery_pending: "待追回" };
const money = (usdt = 0, nex = 0, count = 0) => ({ usdt, nex, count });
const moneyLabel = m => `USDT ${m.usdt.toFixed(2)} · NEX ${m.nex.toFixed(2)}`;
const group = { settlementNo: "DR-FIXTURE-1", sourceRef: "ORDER-FIXTURE-1", sourceDeviceId: "DEVICE-FIXTURE-1", policyVersion: 1, basisUsdt: 1000, nexUsdtPrice: 0.01, amountUSDT: 60, amountNEX: 4000, recoveryPendingUSDT: 0, recoveryPendingNEX: 0, reversalRecorded: false };
const event = (id, kind, currency, amount, extra = {}) => ({ commissionId: `CM-${id}`, eventId: id, userId: 91, user: "U00000091", sourceUserId: 92, kind, currency, amount, layer: 1, settledAt: "2026-10-05 12:30:45", status: "cooling", coolingDaysLeft: 1, cooldownPercent: 0, cooldownLabel: "冷却计提", state: "计提", auditKey: `F.commission.CM-${id}.status`, version: 1, ledgerBizNo: `LEDGER-${id}`, ...extra });
const allEvents = [event(105, "direct_purchase", "USDT", 60, group), event(104, "direct_purchase", "NEX", 4000, group), event(103, "direct_device_earning", "USDT", 0.3, { ...group, settlementNo: "DR-FIXTURE-2", sourceRef: "EARNING-FIXTURE-2", amountUSDT: 0.3, amountNEX: 20 }), event(102, "direct_device_earning", "NEX", 20, { ...group, settlementNo: "DR-FIXTURE-2", sourceRef: "EARNING-FIXTURE-2", amountUSDT: 0.3, amountNEX: 20 }), event(101, "network", "USDT", 10, { layer: 2, sourceRef: "ORDER-NETWORK-1", settlementNo: "SEVEN-NETWORK-1" })];
const exportRows = filters => allEvents.filter(e => ["kind", "currency", "status"].every(key => !filters[key] || e[key] === filters[key]));
const csv = filters => "\uFEFF" + [["commissionId", "eventId", "user", "kind", "currency", "amount", "sourceUser", "layer", "status", "settledAt", "sourceRef", "settlementNo"], ...exportRows(filters).map(e => [e.commissionId, String(e.eventId), "U***0091", e.kind, e.currency, String(e.amount), "U***0092", String(e.layer), e.status, e.settledAt, e.sourceRef || "", e.settlementNo || ""])].map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(",")).join("\r\n") + "\r\n";

function f5(url) {
  const events = exportRows(Object.fromEntries(url.searchParams));
  const pendingCalculations = [{ id: "DR-WAIT-1", settlementNo: "DR-WAIT-1", kind: "direct_purchase", layer: 1, sourceRef: "ORDER-WAIT-1", sourceUserName: "U00000092", basisUsdt: 1000, amountUSDT: 0, amountNEX: 0, nexUsdtPrice: null, status: "waiting_calculation", unlockAt: "2026-10-10T00:00:00Z", ts: "2026-10-06 12:00:00" }].filter(row => !url.searchParams.get("kind") || row.kind === url.searchParams.get("kind"));
  const total = money(events.filter(e => e.currency === "USDT").reduce((n, e) => n + e.amount, 0), events.filter(e => e.currency === "NEX").reduce((n, e) => n + e.amount, 0), events.length);
  return { domain: "F5", ...common(), pendingCalculations, pendingCalculationCount: pendingCalculations.length, summary: { monthlyCommissionSpend: total, monthlyCommissionSpendLabel: moneyLabel(total), coolingBalance: total, coolingBalanceLabel: moneyLabel(total), withdrawableThisMonth: money(), withdrawableThisMonthLabel: moneyLabel(money()), frozenCount: 0 }, commissionKinds: kinds.map(key => { const rows = events.filter(e => e.kind === key); const amounts = money(rows.filter(e => e.currency === "USDT").reduce((n, e) => n + e.amount, 0), rows.filter(e => e.currency === "NEX").reduce((n, e) => n + e.amount, 0), rows.length); return { key, code: key, label: key, amounts, amountLabel: moneyLabel(amounts), count: rows.length, countLabel: `${rows.length} 笔`, className: "k-network" }; }), commissionFilters: [{ key: "all", label: "全部" }, ...Object.entries(statusNames).map(([key, label]) => ({ key, label }))], commissionEvents: events, statusDistribution: Object.entries(statusNames).map(([key, name]) => ({ name, color: "var(--warning)", count: key === "cooling" ? events.length : 0 })), recentAuditFeed: [], pagination: { mode: "server-cursor", defaultWindow: "全量游标", defaultPageSize: 20, pageSize: 20, maxPageSize: 100, requestCursor: "", nextCursor: "", total: events.length }, nextCursor: "", total: events.length, anomalies: [], coolingPolicy: [], activeSuspensions: [], operationHistory: [] };
}
const a2 = () => ({ stats: { pendingTickets: proposals.filter(p => p.status === "pending").length, fundTickets: 1, sosTickets: 0, todayAuditEvents: histories.length, weeklyApproved: histories.length, weeklyRejected: 0, weeklyExpired: 0, weeklyWithdrawn: 0 }, operationQueue: proposals, operationHistory: histories, mechanismParams: [{ key: "ttl", name: "理由最短长度", value: "8 字", sub: "操作理由", locked: false }], confirmCategories: [], recentLogs: [] });
async function install(context) {
  await context.route("**/api/admin/**", async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname, method = req.method();
    let body;
    try { body = req.postDataJSON(); } catch { body = undefined; }
    const request = { path: p, method, body, query: Object.fromEntries(url.searchParams), idempotencyKey: req.headers()["idempotency-key"] };
    report.requests.push(request);
    const ok = data => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const error = (status, message) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status, message, data: null }) });
    if (p.endsWith("/auth/session")) return ok({ tokenType: "Bearer", session: { adminId: reviewer ? 9002 : 9001, username: reviewer ? "direct_reviewer" : "direct_fixture", operator: reviewer ? "隔离审批人" : "隔离验收", role: readonly ? "auditor" : "superadmin", authorities: readonly ? ["network_f2_read", "network_f5_read"] : ["network_f1_read", "network_f2_read", "network_f2_royalty_rate", "network_f2_policy_amplify", "network_f3_read", "network_f4_read", "network_f5_read", "network_f5_write", "network_f5_commission_dispose", "network_f5_commission_reject", "platform_a2_read", "platform_a2_operation_approve"] } });
    if (p.endsWith("/teams/direct-referral-policy")) {
      if (slowPolicy) await initialPolicyGate;
      assert.equal(url.searchParams.get("schemaVersion"), "2");
      return policyError ? error(503, "TEAMS_BACKEND_UNAVAILABLE") : ok(policy);
    }
    if (p.endsWith("/teams/rates")) return legacyError ? error(503, "TEAMS_BACKEND_UNAVAILABLE") : ok({ domain: "F2", ...common(), sevenLayerRevision: policy.sevenLayerRevision, metrics: [], unilevelRates: emptyLegacy ? [] : Array.from({ length: 7 }, (_, i) => ({ level: `L${i + 1}`, usdtPct: i === 0 ? 10 : 7 - i, nexReward: i + 1 })), rateTiers: [], policyParams: [{ id: "cool", key: "F.cooldown", name: "其他奖励冷却", value: emptyLegacy ? "" : "30", defaultValue: "30", unit: "天", amplifies: true }], configValues: emptyLegacy ? {} : { "F.cooldown": "30", "F.partner.tiers": '{"standard":0,"verified":5000,"premium":50000,"diamond":500000}' } });
    if (p.endsWith("/teams/commissions/export")) {
      assert.ok(request.idempotencyKey); assert.ok(body.reason.length >= 8);
      const content = Buffer.from(csv(body), "utf8");
      return route.fulfill({ status: 200, headers: { "Content-Type": "text/csv;charset=UTF-8", "Content-Disposition": 'attachment; filename="f5-commissions-fixture.csv"', "X-Export-Id": "F5-FIXTURE", "X-Export-Row-Count": String(exportRows(body).length), "X-Export-Byte-Size": String(content.length), "X-Export-Sha256": createHash("sha256").update(content).digest("hex"), "X-Export-Redacted": "true" }, body: content });
    }
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
        assert.equal(body.command.params.schemaVersion, 2);
        if (body.command.params.expectedSevenLayerRevision !== policy.sevenLayerRevision) return error(409, "SEVEN_LAYER_REVISION_CONFLICT");
        if (body.command.params.expectedVersion !== policy.policyVersion) return error(409, "DIRECT_REFERRAL_VERSION_CONFLICT");
      }
      const ticket = { id: `A2-DR-${proposals.length + 1}`, ...body, beforeValue: body.beforeValue, afterValue: body.afterValue, ts: "10-05 12:00", mine: false, status: "pending" };
      proposals.push(ticket); return ok(ticket);
    }
    if (p.endsWith("/approve") && p.includes("/platform/audit/operations/")) {
      assert.ok(request.idempotencyKey); const ticket = proposals.find(t => p.includes(t.id)); assert.ok(ticket);
      const params = ticket.command.params; assert.equal(params.expectedVersion, policy.policyVersion);
      policy = { ...policy, configured: true, policySchemaVersion: 2, purchaseSplitConfigured: true, policyVersion: policy.policyVersion + 1, effectiveAt: new Date().toISOString(), purchaseSplit: copy(params.purchaseSplit), deviceEarning: copy(params.deviceEarning) };
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
  const paneShot = async (name, locator) => { const file = path.join(dir, `${name}.png`); await locator.screenshot({ path: file }); report.screenshots.push(file); return file; };
  const open = route => page.goto(report.source.url + route, { waitUntil: "domcontentloaded", timeout: 120000 });
  const measureRhythm = () => page.evaluate(() => {
    const blocks = [...document.querySelectorAll(".f2-layout > *")].map(el => el.getBoundingClientRect());
    const fieldGaps = [...document.querySelectorAll(".f2-policy-rows")].flatMap(el => {
      const parts = [...el.children].map(child => child.getBoundingClientRect());
      return parts.slice(1).map((part, i) => part.top - parts[i].bottom);
    });
    const roles = { ".ph-ttl": 16, ".f2-policy-fields legend": 14, ".f2-policy-fields label": 13, ".f2-policy-fields input, .f2-policy-fields select": 13, ".f2-help, .psub, .pk, .fbtn, .f-foot, .tier .nm .req": 12, ".f2-rule-params .pv": 16, ".casc-row": 13 };
    const fonts = Object.entries(roles).flatMap(([selector, expected]) => [...document.querySelectorAll(`.f2-layout :is(${selector})`)].filter(el => el.getBoundingClientRect().height > 0).map(el => ({ role: selector, expected, actual: Number.parseFloat(getComputedStyle(el).fontSize) })));
    return { gaps: blocks.slice(1).map((block, i) => block.top - blocks[i].bottom), fieldGaps, fonts };
  });
  const assertRhythm = (rhythm, width) => {
    assert.ok(rhythm.gaps.length > 0, "F2 major sections are present");
    for (const gap of rhythm.gaps) assert.ok(gap >= 19.5, `F2 panels touch: ${gap}px at ${width}`);
    for (const gap of rhythm.fieldGaps) assert.ok(gap >= 11.5, `F2 field paragraphs touch: ${gap}px`);
    for (const font of rhythm.fonts) assert.equal(font.actual, font.expected, `F2 ${font.role} typography at ${width}`);
  };
  report.rhythmStates = [];
  const checkRhythmState = async state => {
    const rhythm = await measureRhythm();
    assertRhythm(rhythm, page.viewportSize().width);
    report.rhythmStates.push({ state, ...rhythm });
  };

  slowPolicy = true;
  await open("/network/royalty");
  await expect(page.getByLabel("直属分成配置加载中")).toBeVisible({ timeout: 60000 });
  await checkRhythmState("loading");
  releaseInitialPolicy();
  await expect(page.getByText("未配置，尚未启用。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("直属购买奖励拆分启用状态")).toBeDisabled();
  check("F2-cutover-not-active", [await shot("f2-before-cutover"), "v2 reads current DIRECT_ONLY_V1 generation; policy is read-only until explicit cutover"]);
  const sevenPane = page.locator("section.pane").filter({ has: page.locator(".ph-ttl", { hasText: "七层购买奖励" }) });
  await expect(sevenPane).toContainText("当前尚未配置");
  await checkRhythmState("empty");
  await expect(sevenPane.locator(".rate-bar")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "配置权益门槛", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "配置冷却期", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "配置权益门槛", exact: true }).click();
  let dialog = page.getByRole("dialog");
  for (const label of ["Standard", "Verified", "Premium", "Diamond"]) await expect(dialog.getByLabel(label + " 门槛(USD)", { exact: false })).toHaveValue("");
  await dialog.getByLabel(/操作理由/).fill("验证未配置门槛不误提交零值");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  assert.equal(proposals.length, 0);
  await page.getByRole("button", { name: "查看权益详情", exact: true }).click();
  for (const [index, name] of ["Standard", "Verified", "Premium", "Diamond"].entries()) {
    await page.getByLabel("查看权益档", { exact: true }).selectOption(String(index));
    await expect(page.locator("#royalty-partner-details")).toContainText(name);
    await expect(page.locator("#royalty-partner-details")).toContainText("未配置");
  }
  await page.getByRole("button", { name: "收起权益详情", exact: true }).click();
  assert.equal(proposals.length, 0, "browsing all four benefit tiers does not mutate policy");
  check("F2-empty-independent", [await shot("f2-empty"), "empty seven-layer configuration is explicit; independent complete thresholds remain editable with no fabricated defaults"]);
  policy = { ...policy, settlementMode: "SEVEN_V2", sevenLayerEnabled: true, cutoverAt: "2026-10-06T00:00:00Z", sevenLayerReference: { revision: 1, baseRatePct: 10, coolingDays: 30, legacyNexPerUsd: 2 } };
  emptyLegacy = false; slowPolicy = false; await page.reload();
  await expect(sevenPane.locator(".casc-row")).toHaveCount(7);
  await expect(sevenPane.getByRole("columnheader", { name: "购买基础费率" })).toBeVisible();
  await expect(sevenPane.locator(".casc-row").first().locator(".casc-rate strong")).toHaveText("10%");
  await expect(sevenPane.locator(".casc-row").nth(1).getByRole("button", { name: /调整/ })).toBeVisible();
  await expect(page.getByLabel("直属购买奖励拆分总分成比例 (%)", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("直属购买奖励拆分冷却天数", { exact: true })).toHaveCount(0);
  assert.doesNotMatch(await page.locator("body").innerText(), /Nexion|NexGrid/i);
  const order = await page.locator(".ph-ttl").allTextContents();
  assert.ok(order.indexOf("七层购买奖励") < order.indexOf("直属拆分与设备收益"));
  check("F2-seven-layer-current", [await shot("f2-seven-current"), "seven layers retain writes; L1 has one fixed base budget and readonly reference; DOM follows approved UVEL design order"]);
  await page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true }).fill("61");
  await page.getByRole("button", { name: "提交审批", exact: true }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: /执行摘要/ }).click();
  await expect(dialog).toContainText("当前占位 USDT 50% / NEX 50%，尚未生效");
  await expect(dialog).toContainText("保存的拆分 USDT 61% / NEX 39%，停用期间不生效");
  check("F2-disabled-share-confirmation", [await paneShot("f2-disabled-share-confirmation", dialog), "disabled draft still exposes the exact stored 61/39 and previous placeholder 50/50 before A2 submission"]);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  legacyError = true; await page.reload();
  await expect(page.getByRole("alert").filter({ hasText: "七层购买奖励与独立参数加载失败" })).toBeVisible();
  await expect(page.getByLabel("直属购买奖励拆分启用状态")).toBeEnabled();
  await checkRhythmState("seven-layer-error");
  legacyError = false; await page.reload();
  policyError = true; await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "草稿已保留" })).toBeVisible();
  await checkRhythmState("policy-error");
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  policyError = false; await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByLabel("直属购买奖励拆分启用状态")).toBeEnabled();
  check("F2-error-retry", ["each independent API failure is visible; retries preserve draft; unknown policy disables L1 old NEX mutation"]);
  const fill = async () => {
    for (const label of ["直属购买奖励拆分", "直属设备收益分成"]) {
      await page.getByLabel(label + "启用状态", { exact: true }).selectOption("enabled");
      await page.getByLabel(label + "USDT 占比 (%)", { exact: true }).fill("60");
    }
    await page.getByLabel("直属设备收益分成总分成比例 (%)", { exact: true }).fill("5");
    await page.getByLabel("直属设备收益分成冷却天数", { exact: true }).fill("2");
  };
  await fill();
  await page.getByLabel("直属购买奖励拆分启用状态", { exact: true }).focus(); await page.keyboard.press("Tab");
  await expect(page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true })).toBeFocused();
  await page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true }).fill("100");
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  await page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true }).fill("60");
  await page.getByRole("button", { name: "提交审批", exact: true }).focus(); await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("USDT 60% / NEX 40%");
  await expect(dialog).toContainText("替代旧 L1 额外 NEX");
  await paneShot("f2-confirm", dialog);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  await expect(page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true })).toHaveValue("60");
  assert.equal(proposals.length, 0);
  check("F2-validation-cancel", ["single-currency split blocked; Escape/Cancel preserve the two drafts and submit no request"]);
  await page.getByRole("button", { name: "提交审批", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("短理由");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill("隔离环境验证七层与直属整组政策");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByText("已提交 A2 待审批；当前生效配置尚未改变。", { exact: false })).toBeVisible();
  assert.equal(policy.policyVersion, 0); assert.equal(proposals.length, 1);
  assert.equal(proposals[0].command.params.purchaseSplit.usdtSharePct, 60);
  assert.deepEqual(Object.keys(proposals[0].command.params).sort(), ["deviceEarning", "expectedSevenLayerRevision", "expectedVersion", "purchaseSplit", "schemaVersion"].sort());
  assert.equal(proposals[0].command.params.expectedSevenLayerRevision, 1);
  check("F2-one-atomic-proposal", [await shot("f2-pending"), "one schema v2 A2 proposal binds expectedVersion=0 and expectedSevenLayerRevision=1; contains no second purchase rate/cooling"]);
  check("F2-keyboard-accessibility", ["Tab from purchase switch to share number; Enter confirms; Escape cancels; all controls resolve by accessible label"]);
  reviewer = true; await open("/platform/audit");
  const ticket = page.locator("tr").filter({ hasText: "A2-DR-1" });
  await ticket.getByRole("button", { name: "执行", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("核对双版本和两币后批准隔离演练");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect.poll(() => policy.policyVersion).toBe(1);
  await open("/network/royalty"); await page.reload();
  await expect(page.getByText("当前版本 1", { exact: false })).toBeVisible();
  await expect(page.getByLabel("直属设备收益分成总分成比例 (%)", { exact: true })).toHaveValue("5");
  await expect(sevenPane.locator(".casc-row").first().getByRole("button", { name: /NEX/ })).toHaveCount(0);
  await expect(sevenPane.locator(".casc-row").nth(1).getByRole("button", { name: /NEX/ })).toBeVisible();
  check("F2-approved-readback-persistence", [await shot("f2-approved"), await paneShot("f2-approved-split", page.getByRole("region", { name: "直属分成配置" })), "real A2 UI changed only fixture policy; GET + reload retains both rules; effective split makes old L1 NEX readonly while L2-L7 remain editable"]);
  await page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true }).fill("65");
  policy = { ...policy, sevenLayerRevision: 2, sevenLayerReference: { ...policy.sevenLayerReference, revision: 2 } };
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("政策或七层引用版本已变化", { exact: false })).toBeVisible();
  await expect(page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true })).toHaveValue("65");
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "放弃草稿并重载", exact: true }).click();
  check("F2-seven-revision-conflict", ["a seven-layer-only change invalidates old preview and preserves the dirty draft even though policyVersion did not change"]);
  await page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true }).fill("65");
  await page.getByRole("button", { name: "提交审批", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("验证确认期间政策变更仍阻止旧预览");
  policy = { ...policy, policyVersion: 2 };
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(dialog).toContainText("原预览已失效");
  await expect(dialog.getByLabel(/操作理由/)).toHaveValue("验证确认期间政策变更仍阻止旧预览");
  assert.equal(proposals.length, 1);
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃草稿并重载", exact: true }).click();
  check("F2-late-version-conflict", ["policy changes while confirmation is open; submit re-GET rejects before A2 POST and preserves reason + draft"]);
  coverage = 90; await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await page.getByLabel("直属购买奖励拆分启用状态", { exact: true }).selectOption("disabled");
  await page.getByRole("button", { name: "提交审批", exact: true }).click(); dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("恢复 L1 全额 USDT");
  await expect(dialog).toContainText("现金占比增加 40 个百分点");
  await dialog.getByLabel(/操作理由/).fill("验证关闭拆分恢复现金仍需覆盖率");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "放弃草稿并重载", exact: true }).click();
  await page.getByLabel("直属设备收益分成启用状态", { exact: true }).selectOption("disabled");
  await page.getByRole("button", { name: "提交审批", exact: true }).click(); dialog = page.getByRole("dialog");
  await dialog.getByLabel(/操作理由/).fill("验证设备分成真实收缩允许提交");
  await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  check("F2-B1-direction", ["90% coverage blocks closing purchase split and restoring full cash; stopping only device reward is a true contraction and stays operable"]);
  readonly = true; await page.reload();
  await expect(page.getByLabel("直属购买奖励拆分启用状态")).toBeDisabled();
  await expect(page.getByRole("button", { name: "提交审批", exact: true })).toHaveCount(0);
  check("F2-readonly", [await shot("f2-readonly"), "read-only session has no money-policy write controls"]);
  readonly = false; coverage = 150; await open("/network/commissions");
  await expect(page.getByRole("region", { name: "八类佣金支出与状态分布" })).toBeVisible();
  report.auditSectionGaps = [];
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect.poll(() => page.locator("aside").first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width <= 640 ? 64 : 252);
    const gaps = await page.locator(".f-section-stack").evaluate(el => {
      const blocks = [...el.children].map(child => child.getBoundingClientRect());
      return blocks.slice(1).map((block, i) => block.top - blocks[i].bottom);
    });
    assert.ok(gaps.length >= 6, "All F5 major sections are present");
    for (const gap of gaps) assert.ok(gap >= (width <= 600 ? 20 : 24) - 0.5, `F5 panels touch at ${width}: ${gap}px`);
    const fonts = await page.evaluate(() => {
      const roles = { ".pane-h .ph-ttl": 16, ".filter-bar input, .filter-bar select": 14, '.fbtn, [aria-label="待计算奖励"] > p': 12 };
      return Object.entries(roles).flatMap(([selector, expected]) => [...document.querySelectorAll(`.f-section-stack :is(${selector})`)].map(el => ({ role: selector, expected, actual: Number.parseFloat(getComputedStyle(el).fontSize) })));
    });
    for (const font of fonts) assert.equal(font.actual, font.expected, `F5 ${font.role} typography at ${width}`);
    const headings = await page.locator(".f-section-stack .pane-h > *").evaluateAll(els => els.map(el => {
      const rect = el.getBoundingClientRect(), parent = el.parentElement.getBoundingClientRect();
      return { text: el.textContent, x: rect.x, right: rect.right, parentRight: parent.right, overflow: el.scrollWidth > el.clientWidth + 1 };
    }));
    for (const heading of headings) assert.ok(!heading.overflow && heading.x >= -1 && heading.right <= Math.min(width, heading.parentRight) + 1, `F5 heading clips at ${width}: ${heading.text}`);
    report.auditSectionGaps.push({ width, gaps, fonts, headings });
  }
  const pending = page.getByRole("region", { name: "待计算奖励" });
  await expect(pending).toContainText("ORDER-WAIT-1");
  await expect(pending).toContainText("USDT 待计算 · NEX 待计算");
  await expect(pending.getByRole("button")).toHaveCount(0);
  await paneShot("f5-pending", pending);
  assert.doesNotMatch(await page.locator("body").innerText(), /Nexion|NexGrid/i);
  assert.equal(await page.getByLabel("佣金类型").locator("option").count(), 9);
  await expect(page.getByTestId("f5-commission-kind-card").filter({ hasText: "网络购买奖励" })).toBeVisible();
  const directRow = page.locator("tr").filter({ hasText: "CM-105" });
  await directRow.getByText("来源详情", { exact: true }).click();
  await expect(directRow).toContainText("60 USDT + 4000 NEX");
  await expect(directRow.getByRole("checkbox")).toBeDisabled();
  await expect(directRow.getByRole("button", { name: "提前解锁", exact: true })).toHaveCount(0);
  await page.getByLabel("佣金类型").selectOption("direct_device_earning"); await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
  await expect(page.locator("tr").filter({ hasText: "CM-103" })).toBeVisible();
  await expect(pending).toContainText("暂无待计算奖励");
  await page.getByLabel("佣金类型").selectOption("network"); await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
  await expect(page.locator("tr").filter({ hasText: "CM-101" })).toContainText("L2");
  check("F5-new-groups-and-current-network", [await shot("f5-current-network"), "eight kinds preserved; network is current L2 purchase; waiting groups have no CM ids or money actions and disappear under unrelated server kind filter"]);

  const networkRow = page.locator("tr").filter({ hasText: "CM-101" });
  await networkRow.getByText("来源详情", { exact: true }).click();
  await expect(networkRow).toContainText("SEVEN-NETWORK-1");
  await expect(networkRow).toContainText("只作用于当前账项币种");
  const monthFilter = page.getByLabel("用户群", { exact: true });
  await expect(monthFilter).toHaveAttribute("type", "month");
  await monthFilter.fill("2026-10");
  const monthRequest = page.waitForRequest(req => req.url().includes("/teams/commissions?") && new URL(req.url()).searchParams.get("cohort") === "2026-10");
  await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
  await monthRequest;
  check("F5-native-month-filter", ["real browser selects October 2026 in native month control; API receives cohort=2026-10"]);
  await monthFilter.fill("");
  for (const filters of [{}, { kind: "direct_purchase", currency: "NEX", status: "cooling" }]) {
    await page.getByLabel("佣金类型").selectOption(filters.kind || "");
    await page.getByLabel("全部币种", { exact: true }).selectOption(filters.currency || "");
    await page.getByLabel("佣金状态", { exact: true }).selectOption(filters.status || "");
    await page.getByRole("button", { name: "服务端筛选", exact: true }).click();
    await page.getByRole("button", { name: "导出筛选全量 CSV", exact: true }).click(); dialog = page.getByRole("dialog");
    await dialog.getByLabel(/操作理由/).fill("逐行核对两币来源层级状态与当前筛选");
    const downloading = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    const download = await downloading, file = path.join(dir, filters.kind ? "filtered.csv" : "all.csv");
    await download.saveAs(file);
    const content = fs.readFileSync(file, "utf8");
    assert.equal(content, csv(filters), "every downloaded field matches authoritative fixture rows, including both currencies, source, group, layer and status");
    check(filters.kind ? "F5-CSV-filtered-rows" : "F5-CSV-all-rows", [file, `compared all ${exportRows(filters).length} rows exactly; no waiting groups fabricated as 0-money events`]);
  }
  await open("/network/royalty");
  await page.evaluate(() => localStorage.setItem("nexion-admin-theme-v1", JSON.stringify({ state: { mode: "light" }, version: 1 })));
  await page.reload(); await expect(page.locator("html")).not.toHaveAttribute("data-theme", "dark");
  await expect(page.getByLabel("直属设备收益分成总分成比例 (%)", { exact: true })).toBeVisible();
  await shot("f2-light");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.locator("aside").first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(64);
  await expect(page.getByLabel("直属购买奖励拆分USDT 占比 (%)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("直属设备收益分成冷却天数", { exact: true })).toBeVisible();
  await paneShot("f2-narrow", page.getByRole("region", { name: "直属分成配置" }));
  await page.setViewportSize({ width: 1440, height: 1100 });
  check("F2-theme-narrow", ["actual persisted light mode hydrates after reload; both split panels remain accessible at 390px", ...report.screenshots.slice(-2)]);
  report.layouts = [];
  for (const theme of ["dark", "light"]) {
    await page.evaluate(mode => localStorage.setItem("nexion-admin-theme-v1", JSON.stringify({ state: { mode }, version: 1 })), theme);
    await page.reload();
    await expect(page.getByLabel("直属设备收益分成总分成比例 (%)", { exact: true })).toBeVisible();
    for (const width of [2560, 1920, 1440, 1100, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      // The shell animates its sidebar for 200ms after a breakpoint change.
      await expect.poll(() => page.locator("aside").first().evaluate(el => Math.round(el.getBoundingClientRect().width))).toBe(width <= 640 ? 64 : 168);
      await page.locator("main").evaluate(el => { el.scrollTop = 0; });
      const layout = await page.evaluate(() => {
        const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
        const rows = [...document.querySelectorAll(".casc-row")].map(row => ({ bounds: rect(row), cells: [...row.children].map(cell => ({ ...rect(cell), overflow: cell.scrollWidth > cell.clientWidth + 1 })) }));
        const panels = [...document.querySelectorAll('.f2-rule-params .param, [aria-label="直属分成配置"] fieldset, .f2-top .pane')].map(el => ({ ...rect(el), overflow: el.scrollWidth > el.clientWidth + 1 }));
        const header = document.querySelector("header");
        const headerContent = [...header.querySelectorAll("a,button,nav,span")].filter(el => el.getBoundingClientRect().height > 0 && el.textContent?.trim()).map(rect);
        const titles = [...document.querySelectorAll(".f2-direct-policy .pane-h > *, .f2-top .pane-h > *")].map(el => ({ ...rect(el), overflow: el.scrollWidth > el.clientWidth + 1 }));
        const parameters = [...document.querySelectorAll(".f2-rule-params .param")].map(rect);
        const fieldRows = [...document.querySelectorAll(".f2-policy-row")].map(el => ({ bounds: rect(el), label: rect(el.firstElementChild), control: rect(el.querySelector("input,select")) }));
        const bottomCards = [...document.querySelectorAll(".f2-top > .pane")].map(rect);
        const actions = rect(document.querySelector(".f2-policy-actions"));
        const lastAction = rect(document.querySelector(".f2-policy-actions > :last-child"));
        return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, bars: [...document.querySelectorAll(".rate-bar")].map(rect), rows, panels, header: rect(header), headerContent, titles, parameters, fieldRows, bottomCards, actions, lastAction };
      });
      const screenshot = await shot(`f2-layout-${theme}-${width}`);
      const rhythm = await measureRhythm();
      assertRhythm(rhythm, width);
      report.layouts.push({ theme, width, ...layout, rhythm, screenshot });
      assert.ok(layout.pageWidth <= width + 1, `F2 page overflows at ${theme}/${width}`);
      assert.equal(layout.rows.length, 7);
      assert.equal(layout.bars.length, 7);
      for (const bar of layout.bars) assert.ok(bar.width <= 100 && bar.height <= 4, `Layer bar dominates at ${width}`);
      for (const row of layout.rows) for (const [index, cell] of row.cells.entries()) {
        assert.ok(!cell.overflow && cell.x >= row.bounds.x - 1 && cell.right <= row.bounds.right + 1, `Layer cell is squeezed at ${width}`);
        for (const other of row.cells.slice(index + 1)) assert.ok(Math.min(cell.right, other.right) - Math.max(cell.x, other.x) <= 1 || Math.min(cell.bottom, other.bottom) - Math.max(cell.y, other.y) <= 1, `Layer cells overlap at ${width}`);
      }
      for (const panel of layout.panels) assert.ok(!panel.overflow && panel.x >= -1 && panel.right <= width + 1, `F2 section overflows at ${width}`);
      for (const item of layout.headerContent) assert.ok(item.y >= layout.header.y - 1 && item.bottom <= layout.header.bottom + 1 && item.right <= width + 1, `Header wraps or clips at ${width}`);
      for (const title of layout.titles) assert.ok(!title.overflow && title.right <= width + 1, `F2 section title clips at ${width}`);
      if (width > 850) {
        assert.equal(layout.parameters.length, 6);
        assert.ok(Math.abs(layout.parameters[0].y - layout.parameters[2].y) < 1 && layout.parameters[3].y > layout.parameters[0].bottom, "reference design: six parameters form 3x2 outlined cells");
        for (const row of layout.rows) assert.ok(row.bounds.height <= 54, "reference design: compact layer rows");
        for (const row of layout.fieldRows) assert.ok(row.control.x >= row.label.right + 10 && row.control.right <= row.bounds.right + 1, "reference design: label left, control right");
        assert.ok(Math.abs(layout.bottomCards[0].width - layout.bottomCards[1].width) < 1 && Math.abs(layout.bottomCards[0].y - layout.bottomCards[1].y) < 1, "reference design: equal bottom cards");
        assert.ok(Math.abs(layout.lastAction.right - layout.actions.right) < 1, "reference design: actions align right");
      }
      // Content scrolls inside main; fullPage alone captures only the shell viewport.
      const scroll = await page.locator("main").evaluate(el => ({ max: el.scrollHeight - el.clientHeight, step: el.clientHeight - 80 }));
      for (let top = scroll.step; top < scroll.max + scroll.step; top += scroll.step) {
        const target = Math.min(top, scroll.max);
        await page.locator("main").evaluate((el, value) => { el.scrollTop = value; }, target);
        await expect.poll(() => page.locator("main").evaluate(el => Math.round(el.scrollTop))).toBe(Math.round(target));
        await shot(`f2-layout-${theme}-${width}-scroll-${Math.round(target)}`);
      }
    }
  }
  await page.getByRole("button", { name: "查看历史设置", exact: true }).click();
  await expect(page.locator(".f2-legacy")).toHaveAttribute("open", "");
  await expect(page.locator(".f2-legacy p")).toBeVisible();
  await shot("f2-legacy-expanded");
  await page.locator(".f2-legacy summary").click();
  await expect(page.locator(".f2-legacy")).not.toHaveAttribute("open", "");
  await page.locator(".f2-legacy summary").click();
  await expect(page.locator(".f2-legacy p")).toBeVisible();
  check("F2-whole-page-layout", ["seven widths including1100 reference in both themes: seven compact rows, thin bars, 3x2 outlined parameters, left-label/right-control fields, equal bottom cards and right-aligned actions; 20px section gaps and12px row gaps; titles/legends/body/help/values16/14/13/12/16px; all error/loading states and legacy disclosure checked", ...report.layouts.map(item => item.screenshot)]);
  await page.setViewportSize({ width: 1440, height: 1100 });
  for (const [route, text] of [["/network/v-rank", "V-Rank"], ["/network/binary", "双轨"], ["/network/leadership-pool", "领导"]]) {
    await open(route); await expect(page).toHaveURL(report.source.url + route); await expect(page.locator("body")).toContainText(text); check(`preserved-${route}`, [await shot(route.split("/").pop()), "existing independent team route remains rendered"]);
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
