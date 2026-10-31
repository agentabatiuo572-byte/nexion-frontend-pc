import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const evidence = process.env.PAY1718_PC_EVIDENCE_DIR || "test-results/pay1718";
const constraints = { ratePct: { min: '0', max: '100', scale: 2 }, feeUsdt: { min: '0', max: '1000000', scale: 2 }, minTopupPrincipal: { min: '1', max: '1000000000', integer: true } };
const channels = [
  { paymentMethod: "HDPAY_BANK", configured: true, channelFeeRatePct: "1.25", channelFeeFixed: "0.50", networkConfirmFeeUsdt: "0", minTopupPrincipal: "10" },
  { paymentMethod: "CREGIS_USDT_BSC", configured: true, channelFeeRatePct: "0", channelFeeFixed: "0.10", networkConfirmFeeUsdt: "0.20", minTopupPrincipal: "1" },
  { paymentMethod: "CREGIS_USDT_ERC20", configured: true, channelFeeRatePct: "0.25", channelFeeFixed: "0.50", networkConfirmFeeUsdt: "2.00", minTopupPrincipal: "1" },
];
async function fixture(page: Page, options: { readOnly?: boolean; unknownPolicy?: boolean; unavailable?: boolean; afterDelivery?: boolean; missingConstraints?: boolean; unconfigured?: boolean } = {}) {
  let readOnly = options.readOnly ?? false;
  let policy = { version: 2, channels: structuredClone(channels).map(row => options.unconfigured ? { ...row, configured: false, channelFeeRatePct: null, channelFeeFixed: null, networkConfirmFeeUsdt: null } : row), constraints }, posts = 0;
  const writes: { body: unknown; key: string; path: string }[] = [], errors: string[] = [];
  let record = { intentNo: "PP-TEST-1", userId: "12", kind: "ORDER_PAY", paymentMethod: "HDPAY_BANK", status: "MANUAL_REVIEW", subtotalUsdt: "0.50", channelFeeUsdt: "0.01", networkConfirmFeeUsdt: "0", totalUsdt: "0.51", businessAmountUsdt: "0.504000", roundingAdjustmentUsdt: "-0.004000", fxRateVndPerUsdt: "25000.000000", amountVnd: "12750", feePolicyVersion: 1, version: 4, reason: "当前库存不足", createdAt: "2026-10-31T06:00:00Z", updatedAt: "2026-10-31T06:00:00Z", providerReference: "provider-original-1", providerActualFeeUsdt: null };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const failure = () => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, data: null }) });
    if (path === "/api/admin/auth/session" || path === "/api/admin/auth/activity") return ok({ tokenType: "Bearer", session: { adminId: readOnly ? 13 : 12, username: "fixture", operator: "验收管理员", role: "operator", authorities: readOnly ? ["finance_d1_read"] : ["finance_d1_read", "finance_d1_fx_manage", "finance_d1_bank_reconcile"], effectiveMenus: ["D", "D1"] } });
    if (path === "/api/admin/platform/business-calendar") return ok({ currentZoneId: "Asia/Shanghai", currentZoneLabel: "北京时间", currentOffset: "+08:00", unified: true, trackZones: {}, pending: null, history: [], options: [], earliestEffectiveDate: "2026-10-31" });
    if (path.endsWith("/reason-policy")) return ok({ minChars: 10, maxChars: 200, sourceKey: "admin.a2.reason_min_chars" });
    if (path === '/api/admin/finance/cregis/exceptions') return ok({ mode: 'PROVIDER', depositEnabled: false, depositCreditEnabled: false, provisionGate: { state: 'IDLE', version: 1, assignEnabled: false, creditEnabled: false, payoutEnabled: false }, pendingDeliveries: [], uncertainAddresses: [], heldDeposits: [], failedDeliveries: [], unattributed: [], providerMissing: [] });
    if (path === "/api/admin/finance/purchase-payment-policy") {
      if (options.unavailable) return failure();
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); writes.push({ body, key: request.headers()["idempotency-key"], path }); posts++;
        expect(body.expectedVersion).toBe(2); expect(body.reason.length).toBeGreaterThanOrEqual(10);
        policy = { version: 3, channels: policy.channels.map(row => { const patch = body.channels.find((item: { paymentMethod: string }) => item.paymentMethod === row.paymentMethod); return patch ? { ...patch, configured: true } : row; }), constraints };
        if (options.unknownPolicy && posts === 1) return failure();
      }
      return ok(options.missingConstraints ? { version: policy.version, channels: policy.channels } : policy);
    }
    if (path === "/api/admin/finance/purchase-payment-records") return options.unavailable ? failure() : ok({ items: [record], total: 1, pageNum: Number(url.searchParams.get("pageNum")), pageSize: 20 });
    if (path === "/api/admin/finance/purchase-payment-records/PP-TEST-1/revalidate-deliver") {
      const body = request.postDataJSON(); writes.push({ body, key: request.headers()["idempotency-key"], path });
      expect(body.expectedVersion).toBe(4); expect(body.reason.length).toBeGreaterThanOrEqual(10);
      record = { ...record, version: 5, reason: "库存仍不足，继续人工核查" }; return ok(record);
    }
    if (path === "/api/admin/finance/purchase-payment-records/PP-TEST-1") return ok(options.afterDelivery ? { ...record, fulfilmentStatus: "DELIVERED", receipt: { orderNo: "ORDER-1" }, reason: "新增重复到款待核查", providerActualFeeUsdt: "0.123456", arrivals: [{ txid: "0xproof-1", log_index: 3, amount: "0.510000", block_number: 130000000, block_hash: "0xblock-1", confirmations: 20, status: "CONFIRMED" }] } : record);
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: 404, data: null }) });
  });
  return { writes, errors, useReadOnlyIdentity: () => { readOnly = true; } };
}
const workspace = (page: Page) => page.getByRole("region", { name: "订单付款与手续费", exact: true });
async function openConfig(page: Page) { await page.goto("/finance/recon"); const region = workspace(page); await expect(region).toBeVisible(); await expect(region.getByRole("heading", { name: "付款手续费", exact: true })).toBeVisible(); return region; }
async function submitReason(page: Page) { const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill("依据支付商资金凭证和业务条件核验后操作"); await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); }
test.beforeAll(() => mkdir(evidence, { recursive: true }));

test("D1 unconfigured fees stay blank and explicit zero configures only the edited channel", async ({ page }) => {
  const state = await fixture(page, { unconfigured: true }), region = await openConfig(page);
  const bank = region.getByRole('row').filter({ hasText: '银行卡支付' }).first();
  const bsc = region.getByRole('row').filter({ hasText: 'USDT（BEP20）' }).first();
  await expect(region.getByText(/^未设置手续费，用户暂时不能用/)).toHaveCount(1);
  await expect(region.getByLabel('银行卡支付手续费比例')).toHaveValue('');
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveValue('');
  await expect(bank.getByText('当前未设置', { exact: true })).toHaveCount(2);
  await expect(bank.getByRole('cell', { name: '不收', exact: true })).toBeVisible();
  await expect(bank.getByText('当前 10.00', { exact: true })).toBeVisible();
  await region.getByLabel('银行卡支付手续费比例').fill('0');
  await expect(region.getByRole('button', { name: '保存修改' })).toBeDisabled();
  await region.getByLabel('银行卡支付每笔固定费').fill('0');
  await region.getByRole('button', { name: '保存修改' }).click(); await submitReason(page);
  await expect(region.getByText(/^已保存。新手续费只用于之后发起的付款/)).toBeVisible();
  await expect(bank.getByText(/^未设置手续费/)).toHaveCount(0);
  await region.getByRole('tab', { name: 'USDT', exact: true }).click();
  await expect(bsc.getByText('未设置手续费，用户暂时不能用 BEP20 付款')).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect((state.writes[0].body as { channels: unknown[] }).channels).toEqual([{ paymentMethod: 'HDPAY_BANK', channelFeeRatePct: '0', channelFeeFixed: '0', networkConfirmFeeUsdt: '0', minTopupPrincipal: '10' }]);
  expect(state.errors).toEqual([]); await region.screenshot({ path: `${evidence}/d1-unconfigured-explicit-zero.png` });
});

test("D1 actual form enforces integer topup minimum, HDPay zero network fee, Cregis A2-only minimum and authoritative readback", async ({ page }) => {
  const state = await fixture(page), region = await openConfig(page);
  await expect(region).toContainText("不需要支付密码"); const bank = region.getByRole("row").filter({ hasText: "银行卡支付" }).first(); await expect(bank.getByText("当前 10.00", { exact: true })).toBeVisible();
  await expect(region.getByLabel("银行卡支付网络费")).toHaveCount(0); await expect(bank.getByRole("cell", { name: "不收", exact: true })).toBeVisible();
  await region.getByRole('tab', { name: 'USDT', exact: true }).click();
  await expect(region.getByLabel("USDT（BEP20）最低充值金额")).toHaveAttribute("readonly");
  await region.getByRole('tab', { name: '银行卡', exact: true }).click();
  const minimum = region.getByLabel("银行卡支付最低充值金额");
  for (const value of ["0", "0.5", "10.5"]) { await minimum.fill(value); await expect(region.getByRole("button", { name: "保存修改" })).toBeDisabled(); }
  await minimum.fill("11"); await region.getByRole("button", { name: "保存修改" }).click(); await submitReason(page);
  await expect(region.getByText(/^已保存。/)).toBeVisible(); await expect(bank.getByText("当前 11.00", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([]); await region.screenshot({ path: `${evidence}/d1-fees-integer-minimum.png` });
});
test("D1 unknown save survives reload and recovers through exact same request and key", async ({ page }) => {
  const state = await fixture(page, { unknownPolicy: true }); let region = await openConfig(page);
  await region.getByLabel("银行卡支付最低充值金额").fill("11"); await region.getByRole("button", { name: "保存修改" }).click(); await submitReason(page);
  await expect(page.getByRole("dialog").last()).toContainText("结果未确认"); await page.getByRole("dialog").last().getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole('tab', { name: '银行卡充值', exact: true }).click();
  await expect(page.getByRole('status', { name: 'D1 待处理提醒', exact: true })).toContainText('订单付款有 1 次操作结果待核对');
  await page.getByRole('button', { name: '返回订单付款', exact: true }).click();
  await page.reload(); region = workspace(page); await expect(region.getByRole("button", { name: "再提交一次（不会重复执行）" })).toBeVisible();
  await region.getByRole("button", { name: "再提交一次（不会重复执行）" }).click(); await expect(region.getByRole("button", { name: "再提交一次（不会重复执行）" })).toHaveCount(0);
  await expect(page.getByRole('status', { name: 'D1 待处理提醒', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(2); expect(state.writes[0]).toEqual(state.writes[1]); expect(state.errors).toEqual([]);
});
test("D1 manual revalidation requires reason/CAS and preserves manual-review outcome without wallet credit or invented success", async ({ page }) => {
  const state = await fixture(page); await page.goto("/finance/recon"); const region = workspace(page);
  await region.getByRole("button", { name: "查看详情", exact: true }).click();
  const detail = page.getByRole("dialog").first(); await expect(detail).toContainText("通道实际成本"); await expect(detail).toContainText("尚未提供");
  await expect(detail).toContainText("0.504000"); await expect(detail).toContainText("-0.004000");
  await expect(detail).toContainText("1 USDT = 25000.000000 VND"); await expect(detail).toContainText("12,750 VND");
  await detail.getByRole("button", { name: "重新核对到账", exact: true }).click(); await submitReason(page);
  await expect(detail).toContainText("业务还没完成"); await expect(detail).toContainText("库存仍不足");
  expect(state.writes).toHaveLength(1); expect(state.writes[0].path).toMatch(/revalidate-deliver$/); expect(state.errors).toEqual([]);
  await detail.screenshot({ path: `${evidence}/d1-manual-revalidation-review.png` });
});
test("D1 read-only and unavailable states expose no write or fabricated empty list", async ({ page }) => {
  const state = await fixture(page, { readOnly: true, unavailable: true }); const region = await openConfig(page);
  await expect(region.getByRole("button", { name: "保存修改" })).toHaveCount(0);
  await expect(region.getByRole("alert")).toHaveCount(2); await expect(region.getByRole("table", { name: "付款记录", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
});
test("D1 business timezone and previously delivered business remain explicit after extra-arrival exception", async ({ page }) => {
  const state = await fixture(page, { afterDelivery: true }); await page.goto("/finance/recon");
  await workspace(page).getByRole("button", { name: "查看详情", exact: true }).click(); const detail = page.getByRole("dialog");
  await expect(detail).toContainText("2026-10-31 14:00"); await expect(detail).toContainText("创建 / 更新时间");
  await expect(detail).toContainText("业务已完成，但资金有异常需要核查");
  await expect(detail.getByRole("button", { name: "重新核对到账", exact: true })).toBeDisabled();
  await expect(detail.getByRole("table", { name: "链上到账" })).toContainText("0xproof-1");
  await expect(detail).toContainText("0.123456"); expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
  await detail.screenshot({ path: `${evidence}/d1-delivered-extra-arrival.png` });
});
test("D1 missing server constraints is read-only even with write authority", async ({ page }) => {
  const state = await fixture(page, { missingConstraints: true }); const region = await openConfig(page);
  await expect(region.getByText("暂时拿不到可填范围，只能查看，不能修改。")).toBeVisible();
  await expect(region.getByLabel("银行卡支付最低充值金额")).toHaveAttribute("readonly");
  await expect(region.getByRole("button", { name: "保存修改" })).toBeDisabled(); expect(state.writes).toHaveLength(0);
});

test("D1 channel and business tabs preserve distinct drafts and submit only the changed channels", async ({ page }) => {
  const state = await fixture(page), region = await openConfig(page);
  const fees = region.getByRole('table', { name: '付款手续费', exact: true });
  await expect(fees.getByRole('row')).toHaveCount(2);
  await expect(region.getByText('钱包余额', { exact: true })).toBeVisible();
  await region.getByLabel('银行卡支付每笔固定费').fill('0.75');
  await region.getByRole('tab', { name: 'USDT', exact: true }).click();
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveCount(0);
  await region.getByLabel('USDT（BEP20）每笔固定费').fill('0.35');
  await region.getByRole('tab', { name: 'ERC20', exact: true }).click();
  await expect(region.getByLabel('USDT（ERC20）每笔固定费')).toHaveValue('0.50');
  await expect(region.getByLabel('USDT（ERC20）最低充值金额')).toHaveAttribute('readonly');
  await expect(region.getByLabel('USDT（BEP20）每笔固定费')).toHaveCount(0);
  await region.getByRole('tab', { name: 'BEP20', exact: true }).click();
  await expect(region.getByLabel('USDT（BEP20）每笔固定费')).toHaveValue('0.35');
  await region.getByLabel('付款状态', { exact: true }).selectOption('MANUAL_REVIEW');
  await page.getByRole('tab', { name: '银行卡充值', exact: true }).click();
  await expect(region).toBeHidden();
  await expect(page.getByRole('status', { name: 'D1 待处理提醒', exact: true })).toContainText('订单付款有 2 个渠道尚未保存');
  await expect(page.getByText('银行卡支付订单', { exact: true })).toBeVisible();
  await expect(page.getByText('USDT 资金状态（BEP20 / ERC20）', { exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'USDT 充值', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回订单付款', exact: true })).toBeVisible();
  await expect(page.getByText('银行卡支付订单', { exact: true })).toBeHidden();
  await expect(page.getByText('USDT 资金状态（BEP20 / ERC20）', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '订单付款', exact: true }).click();
  await expect(region.getByLabel('USDT（BEP20）每笔固定费')).toHaveValue('0.35');
  await expect(region.getByLabel('付款状态', { exact: true })).toHaveValue('MANUAL_REVIEW');
  await region.getByRole('tab', { name: '银行卡', exact: true }).click();
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveValue('0.75');
  await expect(region.getByText(/^待保存：/)).toContainText('银行卡支付、USDT（BEP20）');
  const history = region.getByRole('link', { name: '修改历史', exact: true });
  await expect(history).toHaveClass('l-btn sm');
  await expect(history).toHaveAttribute('href', '/platform/audit?domain=D');
  expect(await history.evaluate(element => getComputedStyle(element).display)).toBe('inline-flex');
  expect(await history.evaluate(element => getComputedStyle(element).borderTopStyle)).toBe('solid');
  await region.screenshot({ path: `${evidence}/d1-grouped-fees-desktop.png` });
  await region.getByRole('button', { name: '保存修改', exact: true }).click();
  await submitReason(page);
  await expect(region.getByText(/^已保存。/)).toBeVisible();
  await expect(page.getByRole('status', { name: 'D1 待处理提醒', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect((state.writes[0].body as { channels: unknown[] }).channels).toEqual([
    { ...channels[0], configured: undefined, channelFeeFixed: '0.75' },
    { ...channels[1], configured: undefined, channelFeeFixed: '0.35' },
  ].map(({ configured, ...row }) => row));
  await page.setViewportSize({ width: 760, height: 900 });
  await region.getByRole('tab', { name: 'USDT', exact: true }).click();
  await region.getByRole('tab', { name: 'ERC20', exact: true }).click();
  await expect(region.getByLabel('USDT（ERC20）每笔固定费')).toHaveValue('0.50');
  await expect(history).toBeVisible();
  await region.screenshot({ path: `${evidence}/d1-grouped-fees-narrow.png` });
  expect(state.errors).toEqual([]);
});

test("D1 read authority keeps every channel read-only after switching", async ({ page }) => {
  const state = await fixture(page, { readOnly: true }), region = await openConfig(page);
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveAttribute('readonly');
  await region.getByRole('tab', { name: 'USDT', exact: true }).click();
  await expect(region.getByLabel('USDT（BEP20）每笔固定费')).toHaveAttribute('readonly');
  await region.getByRole('tab', { name: 'ERC20', exact: true }).click();
  await expect(region.getByLabel('USDT（ERC20）网络费')).toHaveAttribute('readonly');
  await expect(region.getByRole('button', { name: '保存修改', exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
});

test("D1 bank unknown and unsaved fee summaries stay visible across sections and clear on identity change", async ({ page }) => {
  await page.addInitScript(() => {
    const commandKey = 'bank-pending-fixture', createdAt = Date.now();
    sessionStorage.setItem('nexion-admin-command-owner', '12');
    sessionStorage.setItem('nexgrid-admin-d1-uncertain-commands-v1', JSON.stringify({ [commandKey]: { commandKey, fingerprint: 'bank-pending-fixture', createdAt, expiresAt: createdAt + 86400000, base: 'finance', path: '/vietqr/orders/VQR-TEST20/manual-credit', method: 'POST', body: JSON.stringify({ expectedVersion: 2, reason: '合成银行未知结果保留原命令核查' }) }, 'cregis-pending-fixture': { commandKey: 'cregis-pending-fixture', fingerprint: 'cregis-pending-fixture', createdAt, expiresAt: createdAt + 86400000, base: 'finance', path: '/cregis/reconciliation/run?network=ERC20', method: 'POST', body: JSON.stringify({ reason: '合成USDT未知结果保留原命令核查' }) } }));
  });
  const state = await fixture(page), region = await openConfig(page);
  const summary = page.getByRole('status', { name: 'D1 待处理提醒', exact: true });
  await expect(summary).toContainText('充值操作有 1 次结果待核对');
  await expect(summary).toContainText('USDT 充值有 1 次操作结果待核对');
  await page.getByRole('button', { name: '返回 USDT 充值', exact: true }).click();
  await expect(page.getByText('USDT 资金状态（BEP20 / ERC20）', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '订单付款', exact: true }).click();
  await region.getByLabel('银行卡支付每笔固定费').fill('0.75');
  await page.getByRole('button', { name: '返回银行卡充值', exact: true }).click();
  await expect(summary).toContainText('订单付款有 1 个渠道尚未保存');
  await expect(page.getByText('bank-pending-fixture', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回订单付款', exact: true }).click();
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveValue('0.75');
  state.useReadOnlyIdentity();
  const changedSession = page.waitForResponse(response => response.url().endsWith('/api/admin/auth/session'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await changedSession;
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveAttribute('readonly');
  await expect(region.getByLabel('银行卡支付每笔固定费')).toHaveValue('0.50');
  await expect(summary).toHaveCount(0);
  expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
});
