import { expect, test } from "@playwright/test";

function overview(initialized: boolean) {
  return {
    domain: "G4",
    product: "genesis",
    asset: "GENESIS_NODE",
    currentNexPrice: 1,
    stats: {
      totalSlots: initialized ? 1000 : 0,
      sold: 0,
      unitPrice: initialized ? 9999 : 0,
      unsold: initialized ? 1000 : 0,
      soldPct: 0,
      genesisAccrualUsd: 0,
      marketOn: true,
      todayBatch: "",
      secondary: { floor: 0, vol24h: 0, listed: 0, owners: 0, royaltyPct: 0 },
    },
    params: [],
    dividend: { dailyVolumeBase: 0, dividendPct: 0, poolToday: 0, perSlotPerDay: 0,
      floorPerNodePerDay: 0, payoutToday: 0, batchNo: "", batchStatus: "ready" },
    emissionGate: { configKey: "growth.phase.genesis_emissions_open", open: false, owner: "H1" },
    market: {
      enabled: true,
      configKey: "J.killswitch.genesis",
      linkedDomain: "J1",
      marketOpenState: "closed",
      configuredMarketOpenState: initialized ? "closed" : "open",
      marketOpenStateVersion: initialized ? 5 : 4,
      closedNoticeKey: "default",
      marketLastChange: initialized ? "series initialized" : "stale open",
      prerequisiteStatus: initialized ? "READY" : "GENESIS_SERIES_UNAVAILABLE",
      seriesSetupRequired: !initialized,
      seriesInitializationAvailable: !initialized,
      seriesRecoveryRequired: false,
    },
    geoBlocked: [],
    nodes: [],
    nodePage: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasPrev: false, hasNext: false },
    stateMachine: ["minted", "held", "listed", "sold"],
    coverage: { coverageRatio: 100, redlinePct: 100, redlineBreached: false, precheck: "B1" },
    tiers: [{ id: "t1", from: 0, to: 1000, priceUSDT: 9999 }],
    tiersVersion: 1,
    catalogAvailable: initialized,
    tradeAvailable: false,
    tradeBlockedReason: initialized ? "GENESIS_MARKET_CLOSED" : "GENESIS_SERIES_UNAVAILABLE",
    seriesSetupRequired: !initialized,
    seriesInitializationAvailable: !initialized,
    seriesRecoveryRequired: false,
    serverCanonical: true,
    sources: ["nx_genesis_series", "nx_genesis_tier"],
  };
}

function overviewWithoutSeries(hasFirstTier: boolean) {
  const value = overview(false);
  value.tiers = hasFirstTier ? [{ id: "t1", from: 0, to: 1000, priceUSDT: 9999 }] : [];
  value.tiersVersion = hasFirstTier ? 2 : 1;
  value.tradeBlockedReason = hasFirstTier ? "GENESIS_SERIES_UNAVAILABLE" : "GENESIS_TIERS_UNAVAILABLE";
  value.seriesInitializationAvailable = hasFirstTier;
  value.market.prerequisiteStatus = value.tradeBlockedReason;
  value.market.seriesInitializationAvailable = hasFirstTier;
  return value;
}

test("missing ACTIVE series stays closed and can be initialized without auto-opening", async ({ page }) => {
  let initialized = false;
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { tokenType: "Bearer", session: {
      adminId: 1,
      username: "superadmin",
      operator: "superadmin",
      role: "superadmin",
      authorities: ["finprod_g4_read", "finprod_g4_write", "finprod_g4_market_toggle"],
      menuCodes: ["G", "G4"],
      effectiveMenus: ["G", "G4"],
      effectiveMenuNodes: [
        { menuCode: "G", menuName: "金融产品", routePath: "", parentCode: null, sortOrder: 7 },
        { menuCode: "G4", menuName: "Genesis 经济", routePath: "/finance-products/genesis", parentCode: "G", sortOrder: 4 },
      ],
      passwordChangeRequired: false,
    } } }),
  }));
  await page.route("**/api/admin/market/nex/genesis/operations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { config: {}, simulations: [], simulationScope: "ADMIN_ONLY",
      ledgerImpact: "NONE", includedInMarketStats: false } }),
  }));
  await page.route("**/api/admin/platform/audit/reason-policy", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: {
      minChars: 8,
      maxChars: 200,
      sourceKey: "admin.a2.reason_min_chars",
    } }),
  }));
  await page.route("**/api/admin/market/nex/genesis**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/series/initialize") && request.method() === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      initialized = true;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ code: 0, data: overview(true) }) });
    }
    if (pathname.endsWith("/nex/genesis") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ code: 0, data: overview(initialized) }) });
    }
    return route.fallback();
  });

  await page.goto("/finance-products/genesis");
  await expect(page.getByText("创世市场状态").first()).toBeVisible();
  await expect(page.getByText("暂未开放", { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/未找到有效 ACTIVE 系列/)).toBeVisible();
  await expect(page.getByRole("button", { name: "恢复市场开放" })).toBeDisabled();

  await page.getByRole("button", { name: "初始化并发布系列" }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("系列编码").fill("GENESIS-2026");
  await dialog.getByLabel("系列名称").fill("Genesis 2026");
  await expect(dialog.getByLabel("二级版税（基点，100 = 1%）")).toHaveCount(0);
  await expect(dialog.getByLabel("每日排放率（%）")).toHaveCount(0);
  await expect(dialog.getByLabel("排放基数公式")).toHaveCount(0);
  await dialog.getByLabel(/操作理由/).fill("initialize missing active series for bug 53");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();

  await expect(page.getByText(/G4 配置前置未就绪/)).toHaveCount(0);
  await expect(page.getByText("暂未开放", { exact: true }).first()).toBeVisible();
  expect(submitted).toMatchObject({
    seriesCode: "GENESIS-2026",
    name: "Genesis 2026",
  });
  expect(submitted).not.toHaveProperty("royaltyBps");
  expect(submitted).not.toHaveProperty("dailyEmissionRatePct");
  expect(submitted).not.toHaveProperty("dividendBaseFormula");
});

test("missing tiers offers a working first-tier path before series initialization", async ({ page }) => {
  let hasFirstTier = false;
  let submitted: Record<string, unknown> | undefined;
  await page.route("**/api/admin/auth/session", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { tokenType: "Bearer", session: {
      adminId: 1,
      username: "superadmin",
      operator: "superadmin",
      role: "superadmin",
      authorities: ["finprod_g4_read", "finprod_g4_write", "finprod_g4_price_write"],
      menuCodes: ["G", "G4"],
      effectiveMenus: ["G", "G4"],
      effectiveMenuNodes: [
        { menuCode: "G", menuName: "金融产品", routePath: "", parentCode: null, sortOrder: 7 },
        { menuCode: "G4", menuName: "Genesis 经济", routePath: "/finance-products/genesis", parentCode: "G", sortOrder: 4 },
      ],
      passwordChangeRequired: false,
    } } }),
  }));
  await page.route("**/api/admin/market/nex/genesis/operations", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { config: {}, simulations: [], simulationScope: "ADMIN_ONLY",
      ledgerImpact: "NONE", includedInMarketStats: false } }),
  }));
  await page.route("**/api/admin/platform/audit/reason-policy", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, data: { minChars: 8, maxChars: 200,
      sourceKey: "admin.a2.reason_min_chars" } }),
  }));
  await page.route("**/api/admin/market/nex/genesis**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/tiers") && request.method() === "POST") {
      submitted = request.postDataJSON() as Record<string, unknown>;
      hasFirstTier = true;
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ code: 0, data: overviewWithoutSeries(true) }) });
    }
    if (pathname.endsWith("/nex/genesis") && request.method() === "GET") {
      return route.fulfill({ status: 200, contentType: "application/json",
        body: JSON.stringify({ code: 0, data: overviewWithoutSeries(hasFirstTier) }) });
    }
    return route.fallback();
  });

  await page.goto("/finance-products/genesis");
  await expect(page.getByText(/未配置有效报价档位/)).toBeVisible();
  await expect(page.getByRole("button", { name: "初始化并发布系列" })).toHaveCount(0);
  await page.getByRole("button", { name: "创建首档报价", exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.getByLabel("截止(累计售出上界)").fill("1000");
  await dialog.getByLabel("单价(USDT)").fill("9999");
  await dialog.getByLabel(/操作理由/).fill("create first quote tier safely");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();

  await expect(page.getByText(/未找到有效 ACTIVE 系列/)).toBeVisible();
  await expect(page.getByRole("button", { name: "初始化并发布系列" })).toBeVisible();
  expect(submitted).toMatchObject({
    to: 1000,
    priceUSDT: 9999,
    expectedTiersVersion: 1,
  });
});
