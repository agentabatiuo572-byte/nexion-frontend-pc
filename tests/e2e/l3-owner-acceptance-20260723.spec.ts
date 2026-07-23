import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim();
const PASSWORD = process.env.ADMIN_E2E_PASSWORD;
const EVIDENCE_DIR = process.env.L3_EVIDENCE_DIR?.trim();

test.beforeEach(async ({ page }) => {
  if (!USERNAME || !PASSWORD) throw new Error("ADMIN_E2E_USERNAME and ADMIN_E2E_PASSWORD are required");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
});

test("L3 first-user entry exposes all four PRD financial report views", async ({ page }) => {
  const financeResponses = Promise.all([
    waitForGet(page, "/api/admin/bi/finance/overview"),
    waitForGet(page, "/api/admin/bi/finance/revenue"),
    waitForGet(page, "/api/admin/bi/finance/redemption"),
    waitForGet(page, "/api/admin/treasury/coverage"),
    waitForGet(page, "/api/admin/treasury/liabilities"),
    waitForGet(page, "/api/admin/treasury/maturity-forecast", "7d"),
    waitForGet(page, "/api/admin/treasury/maturity-forecast", "30d"),
  ]);
  await openL3FromSidebar(page);
  const [overviewResponse, revenueResponse, redemptionResponse, ...authoritativeResponses] = await financeResponses;
  for (const response of [overviewResponse, revenueResponse, redemptionResponse, ...authoritativeResponses]) {
    expect(response.status(), new URL(response.url()).pathname).toBe(200);
  }
  await expect(page.getByRole("heading", { name: "财务报表" })).toBeVisible();

  const payload = await overviewResponse.json() as { data?: { financeLive?: unknown } };
  const revenuePayload = await revenueResponse.json() as { data?: { serverAuthoritative?: boolean; streams?: unknown[] } };
  const redemptionPayload = await redemptionResponse.json() as { data?: { serverAuthoritative?: boolean; source?: string } };
  const maturity7Payload = await authoritativeResponses[2].json() as { data?: { daily?: unknown[] } };
  const maturity30Payload = await authoritativeResponses[3].json() as { data?: { daily?: unknown[] } };
  expect(revenuePayload.data?.serverAuthoritative).toBe(true);
  expect(revenuePayload.data?.streams).toHaveLength(4);
  expect(redemptionPayload.data?.serverAuthoritative).toBe(true);
  expect(redemptionPayload.data?.source).toBe("提现订单状态机");
  expect(maturity7Payload.data?.daily).toHaveLength(7);
  expect(maturity30Payload.data?.daily).toHaveLength(30);
  await saveEvidence("page.png", page, { fullPage: true });
  await saveJson("finance-live.json", {
    financeLive: payload.data?.financeLive ?? null,
    revenueServerAuthoritative: revenuePayload.data?.serverAuthoritative,
    revenueStreamCount: revenuePayload.data?.streams?.length,
    redemptionServerAuthoritative: redemptionPayload.data?.serverAuthoritative,
    maturity7DayCount: maturity7Payload.data?.daily?.length,
    maturity30DayCount: maturity30Payload.data?.daily?.length,
  });

  for (const heading of ["收入结构报表", "兑付报表", "净敞口报表", "负债到期报表"]) {
    await expect(page.getByText(heading, { exact: true }), `missing PRD primary view: ${heading}`).toBeVisible();
  }
  await expect(page.getByText(/部分周期统计尚未接入/)).toHaveCount(0);
  await page.getByRole("button", { name: "未来 30 天", exact: true }).click();
  await expect(page.getByRole("button", { name: "未来 30 天", exact: true })).toHaveClass(/sel/);
});

test("L3 preserves the eight canonical D3 liability categories without collapsing them", async ({ page }) => {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === "GET"
      && new URL(response.url()).pathname === "/api/admin/bi/finance/overview",
  );
  await openL3FromSidebar(page);
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { financeLive?: { accounts?: Array<{ key?: string; amount?: number }> } };
  };

  const canonicalLabels = [
    "可提余额",
    "USDT staking 本金",
    "staking 应付利息",
    "Genesis 排放承诺",
    "NEX v2 未来兑付",
    "待提现 queue",
    "佣金冷却未解锁",
    "锁仓本息其他",
  ];
  const visibleRows: string[] = [];
  for (const label of canonicalLabels) {
    const row = page.getByRole("main").getByText(label, { exact: true });
    await expect(row, `missing canonical liability: ${label}`).toBeVisible();
    visibleRows.push(label);
  }
  await expect(page.getByRole("main").getByText("其他负债", { exact: true })).toHaveCount(0);
  await saveJson("liability-mapping.json", {
    rawAccounts: payload.data?.financeLive?.accounts ?? [],
    visibleRows,
  });
});

test("L3 current snapshot is exactly linked to the authoritative B1 and D3 reads", async ({ page }) => {
  const l3 = await getData(page, "/api/admin/bi/finance/overview") as {
    financeLive?: {
      snapshot?: Record<string, unknown>;
      accounts?: Array<{ key?: string; amount?: number }>;
      maturity7d?: Array<{ day?: string; withdrawUsd?: number; interestUsd?: number; genesisUsd?: number }>;
    };
  };
  const coverage = await getData(page, "/api/admin/treasury/dual-ledger") as {
    snapshot?: Record<string, unknown>;
  };
  const liabilities = await getData(page, "/api/admin/treasury/liabilities?breakdown=true") as {
    breakdown?: Array<{ category?: string; amountUsdt?: number }>;
  };
  const maturity = await getData(page, "/api/admin/treasury/maturity-forecast?window=7d") as {
    daily?: Array<{
      date?: string;
      withdrawDueUsdt?: number;
      interestDueUsdt?: number;
      genesisDividendUsdt?: number;
    }>;
  };
  const maturity30 = await getData(page, "/api/admin/treasury/maturity-forecast?window=30d") as {
    daily?: Array<{ date?: string }>;
  };

  const snapshot = l3.financeLive?.snapshot ?? {};
  const authoritativeSnapshot = coverage.snapshot ?? {};
  for (const field of ["reserveUsd", "liabilitiesUsd", "coverageRatio", "redlinePct"]) {
    expect(Number(snapshot[field]), `B1 mismatch: ${field}`).toBe(Number(authoritativeSnapshot[field]));
  }

  const l3Accounts = l3.financeLive?.accounts ?? [];
  const directAccounts = liabilities.breakdown ?? [];
  expect(l3Accounts.map((row) => [row.key, Number(row.amount)])).toEqual(
    directAccounts.map((row) => [row.category, Number(row.amountUsdt)]),
  );

  const l3Maturity = l3.financeLive?.maturity7d ?? [];
  const directMaturity = maturity.daily ?? [];
  expect(l3Maturity.map((row) => [row.day, Number(row.withdrawUsd), Number(row.interestUsd), Number(row.genesisUsd)])).toEqual(
    directMaturity.map((row) => [
      row.date,
      Number(row.withdrawDueUsdt),
      Number(row.interestDueUsdt),
      Number(row.genesisDividendUsdt),
    ]),
  );
  expect(maturity30.daily).toHaveLength(30);

  await saveJson("cross-domain-b1-d3-link.json", {
    coverageFieldsEqual: true,
    liabilityCategoriesEqual: true,
    maturity7dEqual: true,
    liabilityCategoryCount: directAccounts.length,
    maturityDayCount: directMaturity.length,
    maturity30DayCount: maturity30.daily?.length ?? 0,
  });
});

test("L3 PRD coverage dependency is available at its canonical read endpoint", async ({ page }) => {
  const response = await page.request.get("/api/admin/treasury/coverage");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: Record<string, unknown> };
  expect(payload.data).toEqual(expect.objectContaining({
    reserveTotalUsdt: expect.anything(),
    liabilityTotalUsdt: expect.anything(),
    coverageRatio: expect.anything(),
    netExposureUsdt: expect.anything(),
    redLine: expect.anything(),
    yellowLine: expect.anything(),
  }));
});

test("L3 period and cohort controls issue real server-side report queries", async ({ page }) => {
  await openL3FromSidebar(page);
  for (const [label, period] of [["日", "day"], ["周", "week"], ["月", "month"], ["季", "quarter"]] as const) {
    const responsePromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === "/api/admin/bi/finance/revenue" && url.searchParams.get("period") === period;
    });
    await page.getByRole("button", { name: label, exact: true }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect(page.getByText("收入结构报表", { exact: true })).toBeVisible();
  }

  const customResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/admin/bi/finance/revenue"
      && url.searchParams.get("period") === "custom"
      && Boolean(url.searchParams.get("from"))
      && Boolean(url.searchParams.get("to"));
  });
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  expect((await customResponse).status()).toBe(200);
  await expect(page.getByLabel("自定义开始日期")).toBeVisible();

  const appliedCustomResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/admin/bi/finance/revenue"
      && url.searchParams.get("period") === "custom"
      && url.searchParams.get("from") === "2026-07-01"
      && url.searchParams.get("to") === "2026-07-15";
  });
  await page.getByLabel("自定义开始日期").fill("2026-07-01");
  await page.getByLabel("自定义结束日期").fill("2026-07-15");
  await page.getByRole("button", { name: "应用日期", exact: true }).click();
  expect((await appliedCustomResponse).status()).toBe(200);

  const cohortResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/admin/bi/finance/redemption" && url.searchParams.get("cohort") === "2026-07";
  });
  await page.getByLabel("用户 cohort").fill("2026-07");
  expect((await cohortResponse).status()).toBe(200);
  await expect(page.getByText("兑付报表", { exact: true })).toBeVisible();
});

async function openL3FromSidebar(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/financial"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/financial$/);
}

async function saveEvidence(name: string, page: Page, options: { fullPage: boolean }) {
  if (!EVIDENCE_DIR) return;
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), ...options });
}

async function saveJson(name: string, value: unknown) {
  if (!EVIDENCE_DIR) return;
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await writeFile(path.join(EVIDENCE_DIR, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function getData(page: Page, url: string) {
  const response = await page.request.get(url);
  expect(response.status(), `${url} status`).toBe(200);
  const payload = await response.json() as { data?: unknown };
  return payload.data;
}

function waitForGet(page: Page, pathname: string, window?: string) {
  return page.waitForResponse((response) => {
    if (response.request().method() !== "GET") return false;
    const url = new URL(response.url());
    return url.pathname === pathname && (!window || url.searchParams.get("window") === window);
  });
}
