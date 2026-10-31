import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const evidence = process.env.PAY1718_PC_EVIDENCE_DIR || "test-results/pay1718";
const constraints = { ratePct: { min: '0', max: '100', scale: 2 }, feeUsdt: { min: '0', max: '1000000', scale: 2 }, minTopupPrincipal: { min: '1', max: '1000000000', integer: true } };
const channels = [
  { paymentMethod: "HDPAY_BANK", configured: true, channelFeeRatePct: "1.25", channelFeeFixed: "0.50", networkConfirmFeeUsdt: "0", minTopupPrincipal: "10" },
  { paymentMethod: "CREGIS_USDT_BSC", configured: true, channelFeeRatePct: "0", channelFeeFixed: "0.10", networkConfirmFeeUsdt: "0.20", minTopupPrincipal: "1" },
];
async function fixture(page: Page, options: { readOnly?: boolean; unknownPolicy?: boolean; unavailable?: boolean; afterDelivery?: boolean; missingConstraints?: boolean; unconfigured?: boolean } = {}) {
  let policy = { version: 2, channels: structuredClone(channels).map(row => options.unconfigured ? { ...row, configured: false, channelFeeRatePct: null, channelFeeFixed: null, networkConfirmFeeUsdt: null } : row), constraints }, posts = 0;
  const writes: { body: unknown; key: string; path: string }[] = [], errors: string[] = [];
  let record = { intentNo: "PP-TEST-1", userId: "12", kind: "ORDER_PAY", paymentMethod: "HDPAY_BANK", status: "MANUAL_REVIEW", subtotalUsdt: "0.50", channelFeeUsdt: "0.01", networkConfirmFeeUsdt: "0", totalUsdt: "0.51", businessAmountUsdt: "0.504000", roundingAdjustmentUsdt: "-0.004000", fxRateVndPerUsdt: "25000.000000", amountVnd: "12750", feePolicyVersion: 1, version: 4, reason: "当前库存不足", createdAt: "2026-10-31T06:00:00Z", updatedAt: "2026-10-31T06:00:00Z", providerReference: "provider-original-1", providerActualFeeUsdt: null };
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const failure = () => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, data: null }) });
    if (path === "/api/admin/auth/session" || path === "/api/admin/auth/activity") return ok({ tokenType: "Bearer", session: { adminId: 12, username: "fixture", operator: "验收管理员", role: "operator", authorities: options.readOnly ? ["finance_d1_read"] : ["finance_d1_read", "finance_d1_fx_manage", "finance_d1_bank_reconcile"], effectiveMenus: ["D", "D1"] } });
    if (path === "/api/admin/platform/business-calendar") return ok({ currentZoneId: "Asia/Shanghai", currentZoneLabel: "北京时间", currentOffset: "+08:00", unified: true, trackZones: {}, pending: null, history: [], options: [], earliestEffectiveDate: "2026-10-31" });
    if (path.endsWith("/reason-policy")) return ok({ minChars: 10, maxChars: 200, sourceKey: "admin.a2.reason_min_chars" });
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
  return { writes, errors };
}
const workspace = (page: Page) => page.getByRole("region", { name: "订单直付与费用", exact: true });
async function openConfig(page: Page) { await page.goto("/finance/recon"); const region = workspace(page); await expect(region).toBeVisible(); await region.locator("summary").click(); return region; }
async function submitReason(page: Page) { const dialog = page.getByRole("dialog").last(); await dialog.getByLabel(/操作理由/).fill("依据支付商资金凭证和业务条件核验后操作"); await expect(dialog.getByRole("button", { name: "确认提交", exact: true })).toBeEnabled(); await dialog.getByRole("button", { name: "确认提交", exact: true }).click(); }
test.beforeAll(() => mkdir(evidence, { recursive: true }));

test("D1 unconfigured fees stay blank and explicit zero configures only the edited channel", async ({ page }) => {
  const state = await fixture(page, { unconfigured: true }), region = await openConfig(page);
  const bank = region.getByRole('row').filter({ hasText: 'HDPay 银行直付' }).first();
  const bsc = region.getByRole('row').filter({ hasText: 'USDT-BSC 链上直付' }).first();
  await expect(region.getByText('费用未配置，直付暂不可用')).toHaveCount(2);
  await expect(region.getByLabel('HDPay 银行直付渠道费率')).toHaveValue('');
  await expect(region.getByLabel('HDPay 银行直付固定渠道费')).toHaveValue('');
  await expect(bank.getByText('生效值 —（未配置）', { exact: true })).toHaveCount(3);
  await expect(region.getByText('生效值 10.00 USD / USDT 本金')).toBeVisible();
  await region.getByLabel('HDPay 银行直付渠道费率').fill('0');
  await expect(region.getByRole('button', { name: '核对并保存费用规则' })).toBeDisabled();
  await region.getByLabel('HDPay 银行直付固定渠道费').fill('0');
  await region.getByRole('button', { name: '核对并保存费用规则' }).click(); await submitReason(page);
  await expect(region.locator('summary')).toContainText('v3');
  await expect(bank.getByText('费用未配置，直付暂不可用')).toHaveCount(0);
  await expect(bsc.getByText('费用未配置，直付暂不可用')).toBeVisible();
  expect(state.writes).toHaveLength(1);
  expect((state.writes[0].body as { channels: unknown[] }).channels).toEqual([{ paymentMethod: 'HDPAY_BANK', channelFeeRatePct: '0', channelFeeFixed: '0', networkConfirmFeeUsdt: '0', minTopupPrincipal: '10' }]);
  expect(state.errors).toEqual([]); await region.screenshot({ path: `${evidence}/d1-unconfigured-explicit-zero.png` });
});

test("D1 actual form enforces integer topup minimum, HDPay zero network fee, Cregis A2-only minimum and authoritative readback", async ({ page }) => {
  const state = await fixture(page), region = await openConfig(page);
  await expect(region).toContainText("不受其锁定影响"); await expect(region.getByText("生效值 10.00 USD / USDT 本金")).toBeVisible();
  await expect(region.getByLabel("HDPay 银行直付网络确认费")).toHaveAttribute("readonly");
  await expect(region.getByLabel("USDT-BSC 链上直付最低充值本金")).toHaveAttribute("readonly");
  const minimum = region.getByLabel("HDPay 银行直付最低充值本金");
  for (const value of ["0", "0.5", "10.5"]) { await minimum.fill(value); await expect(region.getByRole("button", { name: "核对并保存费用规则" })).toBeDisabled(); }
  await minimum.fill("11"); await region.getByRole("button", { name: "核对并保存费用规则" }).click(); await submitReason(page);
  await expect(region.locator("summary")).toContainText("v3"); await expect(region.getByText("生效值 11.00 USD / USDT 本金")).toBeVisible();
  expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([]); await region.screenshot({ path: `${evidence}/d1-fees-integer-minimum.png` });
});
test("D1 unknown save survives reload and recovers through exact same request and key", async ({ page }) => {
  const state = await fixture(page, { unknownPolicy: true }); let region = await openConfig(page);
  await region.getByLabel("HDPay 银行直付最低充值本金").fill("11"); await region.getByRole("button", { name: "核对并保存费用规则" }).click(); await submitReason(page);
  await expect(page.getByRole("dialog").last()).toContainText("结果未确认"); await page.getByRole("dialog").last().getByRole("button", { name: "取消", exact: true }).click();
  await page.reload(); region = workspace(page); await expect(region.getByRole("button", { name: "使用原请求重试" })).toBeVisible();
  await region.getByRole("button", { name: "使用原请求重试" }).click(); await expect(region.getByRole("button", { name: "使用原请求重试" })).toHaveCount(0);
  expect(state.writes).toHaveLength(2); expect(state.writes[0]).toEqual(state.writes[1]); expect(state.errors).toEqual([]);
});
test("D1 manual revalidation requires reason/CAS and preserves manual-review outcome without wallet credit or invented success", async ({ page }) => {
  const state = await fixture(page); await page.goto("/finance/recon"); const region = workspace(page);
  await region.getByRole("button", { name: "查看详情", exact: true }).click();
  const detail = page.getByRole("dialog").first(); await expect(detail).toContainText("支付商实际费用"); await expect(detail).toContainText("尚未提供");
  await expect(detail).toContainText("0.504000 USDT"); await expect(detail).toContainText("-0.004000 USDT");
  await expect(detail).toContainText("1 USDT = 25000.000000 VND"); await expect(detail).toContainText("12,750 VND");
  await detail.getByRole("button", { name: "重新核验并尝试交付", exact: true }).click(); await submitReason(page);
  await expect(detail).toContainText("尚未确认业务交付完成"); await expect(detail).toContainText("库存仍不足");
  expect(state.writes).toHaveLength(1); expect(state.writes[0].path).toMatch(/revalidate-deliver$/); expect(state.errors).toEqual([]);
  await detail.screenshot({ path: `${evidence}/d1-manual-revalidation-review.png` });
});
test("D1 read-only and unavailable states expose no write or fabricated empty list", async ({ page }) => {
  const state = await fixture(page, { readOnly: true, unavailable: true }); const region = await openConfig(page);
  await expect(region.getByRole("button", { name: "核对并保存费用规则" })).toHaveCount(0);
  await expect(region.getByRole("alert")).toHaveCount(2); await expect(region.getByRole("table", { name: "订单付款记录", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
});
test("D1 business timezone and previously delivered business remain explicit after extra-arrival exception", async ({ page }) => {
  const state = await fixture(page, { afterDelivery: true }); await page.goto("/finance/recon");
  await workspace(page).getByRole("button", { name: "查看详情", exact: true }).click(); const detail = page.getByRole("dialog");
  await expect(detail).toContainText("2026-10-31 14:00"); await expect(detail).toContainText("显示时区");
  await expect(detail).toContainText("原业务已交付，资金异常待核查");
  await expect(detail.getByRole("button", { name: "重新核验并尝试交付", exact: true })).toBeDisabled();
  await expect(detail.getByRole("table", { name: "链上到款凭证" })).toContainText("0xproof-1");
  await expect(detail).toContainText("0.123456 USDT"); expect(state.writes).toHaveLength(0); expect(state.errors).toEqual([]);
  await detail.screenshot({ path: `${evidence}/d1-delivered-extra-arrival.png` });
});
test("D1 missing server constraints is read-only even with write authority", async ({ page }) => {
  const state = await fixture(page, { missingConstraints: true }); const region = await openConfig(page);
  await expect(region.getByText("服务端尚未提供完整调整范围，当前仅可查看。")).toBeVisible();
  await expect(region.getByLabel("HDPay 银行直付最低充值本金")).toHaveAttribute("readonly");
  await expect(region.getByRole("button", { name: "核对并保存费用规则" })).toBeDisabled(); expect(state.writes).toHaveLength(0);
});
