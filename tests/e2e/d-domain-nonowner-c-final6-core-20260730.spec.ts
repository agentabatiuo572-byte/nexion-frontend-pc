import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  RUN_ID,
  browserApi,
  dAccount,
  finalAccount,
  login,
  logout,
  monitor,
  openD,
} from "./helpers/d-final6-review-harness";

const EVIDENCE_DIR = process.env.D_FINAL6_CORE_EVIDENCE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/D/nonowner-C-final6/core";

const modules = [
  { id: "D1", route: "/finance/recon", text: "银行转账（VietQR）对账", read: "/api/admin/finance/vietqr/overview?view=inflight&pageNum=1&pageSize=20" },
  { id: "D2", route: "/finance/withdrawals", text: "提现审核队列", read: "/api/admin/finance/withdrawals?pageNum=1&pageSize=10" },
  { id: "D3", route: "/finance/pool", text: "应付负债 · 9 类科目", read: "/api/admin/treasury/reserve" },
  { id: "D4", route: "/finance/ledger", text: "全平台账单流水", read: "/api/admin/bills?pageNum=1&pageSize=10" },
  { id: "D5", route: "/finance/params", text: "D5 自有四组参数", read: "/api/admin/withdraw/limits" },
  { id: "D6", route: "/finance/fx-rate", text: "当前牌价（现场派生）", read: "/api/admin/finance/fx-quote" },
] as const;

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("final75 只读交叉门禁：D1–D6 菜单/路由/接口可读，D 写接口仍为 403", async ({ page }) => {
  const signals = monitor(page);
  await login(page, finalAccount("final75_readonly"), "final75-d-cross-gate");
  const session = await page.request.get("/api/admin/auth/session");
  expect(session.status()).toBe(200);
  const sessionPayload = await session.json() as { data?: { session?: { authorities?: string[]; menuCodes?: string[] } } };
  const authorities = sessionPayload.data?.session?.authorities ?? [];
  for (const authority of ["finance_d1_read", "finance_d2_read", "finance_d3_read", "finance_d4_read", "finance_d5_read", "finance_d6_read"]) {
    expect(authorities).toContain(authority);
  }

  const reads: Record<string, number> = {};
  for (const module of modules) {
    await openAndSettleD(page, module.route, module.text);
    const response = await browserApi(page, "GET", module.read);
    expect(response.status, module.id).toBe(200);
    reads[module.id] = response.status;
  }
  const denied = await browserApi(page, "PATCH", "/api/admin/finance/fx-quote", {
    baseRateVndPerUsdt: 26001,
    buySpreadPct: 1.5,
    lockWindowMinutes: 30,
    expectedVersion: -1,
    reason: `${RUN_ID} final75 deny probe`,
    operator: "final75",
  });
  expect(denied.status).toBe(403);
  write("00-final75-d-cross-gate-signals.json", {
    reads,
    writeDenied: denied.status,
    requestFailures: summarizeRequestFailures(signals),
    consoleErrors: signals.consoleErrors,
  });
  const signalSummary = assertNoUnexpectedSignals(signals, "final75", {
    expectedConsoleErrors: [
      /(?:401.*\/api\/admin\/auth\/session|\/api\/admin\/auth\/session.*401)/i,
      /(?:403.*\/api\/admin\/finance\/fx-quote|\/api\/admin\/finance\/fx-quote.*403)/i,
    ],
  });
  await logout(page);
  write("00-final75-d-cross-gate.json", { reads, writeDenied: denied.status, signalSummary });
});

test("首次用户从登录和可见侧栏完整找到 D1–D6，五视图/九科目/七账本/刷新重登可理解", async ({ page }) => {
  const signals = monitor(page);
  await login(page, dAccount("maker"), "d-maker-first-user");

  await openAndSettleD(page, "/finance/recon", "银行转账（VietQR）对账");
  const views = [["matched", "已匹配"], ["orphan", "孤儿队列"], ["mismatch", "差额队列"], ["late", "迟到 / 补充回单"], ["inflight", "在途意向单"]] as const;
  for (const [view, label] of views) {
    const response = page.waitForResponse((candidate) =>
      candidate.url().includes("/api/admin/finance/vietqr/overview")
      && new URL(candidate.url()).searchParams.get("view") === view);
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await response).status(), view).toBe(200);
  }
  await expect(page.locator("body")).not.toContainText(/\bnx_[a-z0-9_]+\b/i);

  await openAndSettleD(page, "/finance/withdrawals", "提现审核队列");
  await expect(page.getByText("D5 日限", { exact: true })).toBeVisible();

  await openAndSettleD(page, "/finance/pool", "应付负债 · 9 类科目");
  await expect(page.locator("section.l-card").filter({ hasText: "应付负债 · 9 类科目" }).locator("tbody tr")).toHaveCount(9);

  await openAndSettleD(page, "/finance/ledger", "全平台账单流水");
  for (const label of ["充值", "提现", "收益", "佣金", "兑换", "退款", "奖励"]) {
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === "/api/admin/bills");
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await response).status(), label).toBe(200);
  }
  await expect(page.getByText(/服务端分页 · 精确七类/)).toBeVisible();

  await openAndSettleD(page, "/finance/params", "D5 自有四组参数");
  await expect(page.getByText("H1 Phase 派发（只读）", { exact: true })).toBeVisible();
  await openAndSettleD(page, "/finance/fx-rate", "当前牌价（现场派生）");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-d6-refresh.png"), fullPage: true });

  await logout(page);
  await login(page, dAccount("maker"), "d-maker-first-user-relogin");
  for (const module of modules) await openAndSettleD(page, module.route, module.text);
  const signalSummary = assertNoUnexpectedSignals(signals, "visible-entry", {
    expectedConsoleErrors: [
      /(?:401.*\/api\/admin\/auth\/session|\/api\/admin\/auth\/session.*401)/i,
      /(?:401.*\/api\/admin\/auth\/mfa\/verify|\/api\/admin\/auth\/mfa\/verify.*401)/i,
    ],
  });
  await logout(page);
  write("01-visible-entry-complete.json", {
    modules: modules.map((item) => item.id),
    d1Views: views.map(([view]) => view),
    d3LiabilityRows: 9,
    d4Categories: 7,
    refresh: "PASS",
    relogin: "PASS",
    signalSummary,
  });
});

test("墨菲故障包：D1–D6 的 500/畸形 200/超时均清空旧权威态并可重试恢复", async ({ page }) => {
  const signals = monitor(page);
  await login(page, dAccount("maker"), "d-maker-faults");
  const results: Record<string, string> = {};

  await page.route("**/api/admin/finance/topup/overview*", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "D1_FAULT", data: null }),
  }));
  await openAndSettleD(page, "/finance/recon", /D1 已停止展示旧数据/);
  await expect(page.getByRole("button", { name: "重试读取", exact: true })).toBeVisible();
  await page.unroute("**/api/admin/finance/topup/overview*");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("银行转账（VietQR）对账", { exact: true })).toBeVisible();
  results.D1 = "500_FAIL_CLOSED_RECOVERED";

  await page.route("**/api/admin/finance/withdrawals?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }),
  }));
  await openAndSettleD(page, "/finance/withdrawals", /D2 数据加载失败/);
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^(放行|延迟|冻结|解冻|拒绝并退款|手动退款)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批量执行", exact: true })).toBeDisabled();
  await page.unroute("**/api/admin/finance/withdrawals?*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByRole("heading", { name: "提现审核队列", exact: true })).toBeVisible();
  results.D2 = "MALFORMED_200_FAIL_CLOSED_RECOVERED";

  await page.route("**/api/admin/treasury/forecast-config", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "D3_FAULT", data: null }),
  }));
  await openAndSettleD(page, "/finance/pool", /D3 数据异常/);
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
  await page.unroute("**/api/admin/treasury/forecast-config");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByText("应付负债 · 9 类科目", { exact: true })).toBeVisible();
  results.D3 = "500_FAIL_CLOSED_RECOVERED";

  await page.route("**/api/admin/bills?*", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: { records: "bad" } }),
  }));
  await openAndSettleD(page, "/finance/ledger", /资金账本已停止展示旧数据/);
  await expect(page.getByRole("button", { name: "重试", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "导出脱敏 CSV", exact: true })).toBeDisabled();
  await page.unroute("**/api/admin/bills?*");
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect(page.getByText("全平台账单流水", { exact: true })).toBeVisible();
  results.D4 = "MALFORMED_200_FAIL_CLOSED_RECOVERED";

  await page.route("**/api/admin/withdraw/limits", (route) => route.abort("timedout"));
  await openAndSettleD(page, "/finance/params", "D5 权威配置不可用");
  await expect(page.getByRole("button", { name: "重试获取权威快照", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "预览并提交", exact: true })).toHaveCount(0);
  const expectedRequestFailures = signals.requestFailures.filter((entry) => /\/api\/admin\/withdraw\/limits.*(?:ERR_TIMED_OUT|timed out)/i.test(entry));
  expect(expectedRequestFailures, "D5 timeout must be an explicitly observed injected request failure").not.toEqual([]);
  await page.unroute("**/api/admin/withdraw/limits");
  await page.getByRole("button", { name: "重试获取权威快照", exact: true }).click();
  await expect(page.getByText("D5 自有四组参数", { exact: true })).toBeVisible();
  results.D5 = "TIMEOUT_FAIL_CLOSED_RECOVERED";

  await page.route("**/api/admin/finance/fx-quote", (route) => route.fulfill({
    status: 500, contentType: "application/json", body: JSON.stringify({ code: 500, message: "D6_FAULT", data: null }),
  }));
  await openAndSettleD(page, "/finance/fx-rate", /汇率牌价尚未初始化或读取失败|服务返回的数据不完整|D6_FAULT|操作失败.*刷新页面后重试/);
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toHaveCount(0);
  await page.unroute("**/api/admin/finance/fx-quote");
  await page.getByRole("button", { name: "重试读取", exact: true }).click();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  await page.route("**/api/admin/finance/fx-quote", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { baseRateVndPerUsdt: "bad", buySpreadPct: null, lockWindowMinutes: -1, quoteRateVndPerUsdt: 0, version: "stale" } }),
  }));
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重试读取", exact: true })).toBeVisible();
  await page.unroute("**/api/admin/finance/fx-quote");
  const retryD6 = page.getByRole("button", { name: "重试读取", exact: true });
  if (await retryD6.isVisible({ timeout: 1_500 }).catch(() => false)) await retryD6.click();
  await expect(page.getByText("当前牌价（现场派生）", { exact: true })).toBeVisible();
  results.D6 = "500_AND_MALFORMED_200_FAIL_CLOSED_RECOVERED";

  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-faults-recovered.png"), fullPage: true });
  const signalSummary = assertNoUnexpectedSignals(signals, "faults", {
    expectedConsoleErrors: [
      /(?:401.*\/api\/admin\/auth\/session|\/api\/admin\/auth\/session.*401)/i,
      /(?:401.*\/api\/admin\/auth\/mfa\/verify|\/api\/admin\/auth\/mfa\/verify.*401)/i,
      /(?:(?:500|Internal Server Error).*\/api\/admin\/finance\/topup\/overview|\/api\/admin\/finance\/topup\/overview.*(?:500|Internal Server Error))/i,
      /(?:(?:500|Internal Server Error).*\/api\/admin\/treasury\/forecast-config|\/api\/admin\/treasury\/forecast-config.*(?:500|Internal Server Error))/i,
      /(?:(?:500|Internal Server Error).*\/api\/admin\/finance\/fx-quote|\/api\/admin\/finance\/fx-quote.*(?:500|Internal Server Error))/i,
      /(?:(?:ERR_TIMED_OUT|timed out).*\/api\/admin\/withdraw\/limits|\/api\/admin\/withdraw\/limits.*(?:ERR_TIMED_OUT|timed out))/i,
    ],
    expectedRequestFailures: [/\/api\/admin\/withdraw\/limits.*(?:ERR_TIMED_OUT|timed out)/i],
  });
  await logout(page);
  write("02-failclosed-pack.json", { results, expectedRequestFailures, signalSummary });
});

type BrowserSignals = ReturnType<typeof monitor>;
type SignalExpectation = {
  expectedConsoleErrors?: RegExp[];
  expectedRequestFailures?: RegExp[];
};

function assertNoUnexpectedSignals(
  signals: BrowserSignals,
  label: string,
  expectation: SignalExpectation = {},
) {
  const expectedConsoleErrors = expectation.expectedConsoleErrors ?? [];
  const expectedRequestFailures = expectation.expectedRequestFailures ?? [];
  const unexpectedConsoleErrors = signals.consoleErrors.filter((entry) =>
    !expectedConsoleErrors.some((pattern) => pattern.test(entry)));
  const navigationWaivers = signals.requestFailureEvents.flatMap((failure) => {
    if (failure.failure !== "net::ERR_ABORTED") return [];
    const replacement = signals.responseEvents.find((response) =>
      response.sequence > failure.sequence
      && response.method === failure.method
      && normalizedAcceptancePath(response.url) === normalizedAcceptancePath(failure.url)
      && response.status === 200);
    return replacement ? [{ failure, replacement }] : [];
  });
  const unexpectedRequestFailures = signals.requestFailureEvents
    .filter((failure) => !expectedRequestFailures.some((pattern) =>
      pattern.test(`${failure.method} ${failure.url} ${failure.failure}`)))
    .filter((failure) => !navigationWaivers.some((waiver) => waiver.failure === failure))
    .map((failure) => `${failure.method} ${failure.url} ${failure.failure}`);
  expect(signals.pageErrors, `${label}: pageerror`).toEqual([]);
  expect(unexpectedConsoleErrors, `${label}: unexpected console errors`).toEqual([]);
  expect(unexpectedRequestFailures, `${label}: unexpected request failures`).toEqual([]);
  return {
    pageErrors: signals.pageErrors,
    consoleErrors: signals.consoleErrors,
    requestFailures: signals.requestFailures,
    navigationWaivers,
    unexpectedConsoleErrors,
    unexpectedRequestFailures,
  };
}

function normalizedAcceptancePath(rawUrl: string) {
  const url = new URL(rawUrl);
  if (url.searchParams.has("_rsc")) return `${url.origin}${url.pathname}`;
  return `${url.origin}${url.pathname}${url.search}`;
}

function summarizeRequestFailures(signals: BrowserSignals) {
  return signals.requestFailureEvents.map((failure) => ({
    ...failure,
    laterSameUrl200: signals.responseEvents.some((response) =>
      response.sequence > failure.sequence
      && response.url === failure.url
      && response.status === 200),
  }));
}

function write(name: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE_DIR, name), `${JSON.stringify({ runId: RUN_ID, ...value as object }, null, 2)}\n`, "utf8");
}

async function openAndSettleD(page: Parameters<typeof openD>[0], route: string, visible: string | RegExp) {
  await openD(page, route, visible);
  await page.waitForLoadState("networkidle", { timeout: 20_000 });
}
