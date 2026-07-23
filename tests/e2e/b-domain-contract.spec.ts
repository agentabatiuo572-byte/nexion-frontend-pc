import { expect, test, type Page, type Route } from "@playwright/test";

type BDashboard = ReturnType<typeof dashboard>;

test.describe("B domain real-interface contract", () => {
  test.beforeEach(async ({ page }) => {
    await installAuthenticatedAdmin(page);
  });

  test("opens the command center when B5 child data is empty", async ({ page }) => {
    await routeBDomain(page, { current: dashboard({ omitRiskChildren: true }) });

    await page.goto("/");

    await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
    await expect(page.getByText("B 域指挥台加载失败")).toHaveCount(0);
    await expect(page.getByText("B5_REQUIRED_DATA_EMPTY")).toHaveCount(0);
  });

  test("shows backend warnings and refreshes shared B state after alert ack", async ({ page }) => {
    const state = { current: dashboard({ acked: false, coverageRatio: 95 }) };
    let ackCount = 0;
    await routeBDomain(page, {
      current: state.current,
      onAck: () => {
        ackCount += 1;
        state.current = dashboard({ acked: true, coverageRatio: 96 });
        return state.current;
      },
      getCurrent: () => state.current,
    });

    await page.goto("/overview/dual-ledger");

    await expect(page.getByText("B_CONFIG_SEEDED")).toBeVisible();
    await expect(page.getByText("95.0%").first()).toBeVisible();
    await expect(page.getByText(/覆盖差额 · \$5\.64M − \$5\.92M/)).toBeVisible();
    await page.getByRole("button", { name: /标记已处置/ }).click();
    await page.getByPlaceholder(/工单号|业务依据|影响面|回滚预案/).fill("E2E B-domain ack refresh");
    await page.getByRole("button", { name: /确认执行/ }).click();

    await expect(page.getByText(/已处置 ·/)).toBeVisible();
    await expect(page.getByText("96.0%").first()).toBeVisible();
    expect(ackCount).toBe(1);

    await page.getByRole("button", { name: /告警与待办/ }).click();
    await expect(page.getByText(/兑付覆盖率 96\.0%/)).toBeVisible();
  });
});

async function installAuthenticatedAdmin(page: Page) {
  const username = process.env.ADMIN_E2E_USERNAME;
  const password = process.env.ADMIN_E2E_PASSWORD;
  if (!username || !password) throw new Error("ADMIN_E2E_USERNAME and ADMIN_E2E_PASSWORD are required");

  await page.goto("/");
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  const loginResponse = page.waitForResponse(
    (response) => response.url().includes("/api/admin/auth/login") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect((await loginResponse).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible();
}

async function routeBDomain(
  page: Page,
  options: {
    current: BDashboard;
    getCurrent?: () => BDashboard;
    onAck?: () => BDashboard;
  },
) {
  await page.route("**/api/admin/treasury/b-domain", async (route) => {
    await fulfillDashboard(route, options.getCurrent?.() ?? options.current);
  });
  await page.route("**/api/admin/treasury/b-domain/alerts/coverage-redline/ack", async (route) => {
    expect(route.request().method()).toBe("POST");
    const body = route.request().postDataJSON() as { reason?: string; operator?: string };
    expect(body.reason).toContain("B-domain ack");
    expect(body.operator).toBeTruthy();
    await fulfillDashboard(route, options.onAck?.() ?? options.current);
  });
  await page.route("**/api/admin/treasury/net-exposure?window=*", async (route) => {
    const window = new URL(route.request().url()).searchParams.get("window") ?? "30d";
    const days = Number(window.slice(0, -1));
    const series = Array.from({ length: days }, (_, index) => ({
      date: `2026-06-${String((index % 30) + 1).padStart(2, "0")}`,
      reserveUsdt: 5_640_000,
      liabilitiesUsdt: 5_920_000 + index * 1_000,
      netExposureUsdt: -280_000 - index * 1_000,
      negative: true,
    }));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ code: 0, message: "success", data: { window, series, asOf: "2026-06-30T00:00:00Z" } }),
    });
  });
}

async function fulfillDashboard(route: Route, data: BDashboard) {
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ code: 0, message: "success", data }),
  });
}

function dashboard({
  acked = false,
  coverageRatio = 95,
  omitRiskChildren = false,
}: {
  acked?: boolean;
  coverageRatio?: number;
  omitRiskChildren?: boolean;
} = {}) {
  const riskChildren = omitRiskChildren
    ? {
        gates: [
          { nm: "D2 提现放行", dom: "withdraw", on: true, state: "on", configKey: "emergency.kill.withdrawal" },
          { nm: "G1 质押新增", dom: "staking", on: true, state: "on", configKey: "emergency.kill.staking" },
          { nm: "G4 Genesis", dom: "genesis", on: true, state: "on", configKey: "emergency.kill.genesis" },
          { nm: "G2 兑换", dom: "exchange", on: true, state: "on", configKey: "emergency.kill.exchange" },
          { nm: "H2 试用转正", dom: "trial", on: true, state: "on", configKey: "emergency.kill.trial" },
        ],
        feed: [],
        pressureSeries: [],
        rules: [],
        severity: [],
        volume: [],
      }
    : {
        gates: [
          { nm: "D2 提现放行", dom: "withdraw", on: true, state: "on", configKey: "emergency.kill.withdrawal" },
          { nm: "G1 质押新增", dom: "staking", on: true, state: "on", configKey: "emergency.kill.staking" },
          { nm: "G4 Genesis", dom: "genesis", on: true, state: "on", configKey: "emergency.kill.genesis" },
          { nm: "G2 兑换", dom: "exchange", on: true, state: "on", configKey: "emergency.kill.exchange" },
          { nm: "H2 试用转正", dom: "trial", on: true, state: "on", configKey: "emergency.kill.trial" },
        ],
        feed: [{ sev: "p2", t: "K3 命中提现规则 · 待运营确认", m: "2m", href: "/overview/risk-radar" }],
        pressureSeries: [12, 15, 18, 21, 24, 20, 19, 17],
        rules: [{ nm: "K5 大额 KYC hold", ct: 3, sev: "p2", dom: "K5" }],
        severity: [{ nm: "P2", count: 3, c: "--admin-cat-2" }],
        volume: [{ label: "今日", count: 6 }],
      };

  return {
    generatedAt: "2026-06-29T10:00:00Z",
    sources: ["treasury.b.e2e"],
    warnings: [{ key: "treasury.b.seed", code: "B_CONFIG_SEEDED", message: "E2E warning must render" }],
    alerts: { coverageRedlineAcked: acked, sources: ["treasury.b.alert.coverage-redline.ack"] },
    dualLedger: {
      snapshot: {
        reserveUsd: 5_640_000,
        liabilitiesUsd: 5_920_000,
        coverageRatio,
        redlinePct: 70,
        healthyPct: 110,
        runRiskPct: 8,
        netFlow24hUsd: -86_000,
        queueBacklogCount: 14,
        queueBacklogUsd: 380_000,
        avgRiskScore: 42,
        coverageSeries: [118, 116, 112, 108, 103, 99, coverageRatio - 1, coverageRatio],
      },
      accounts: [
        { key: "withdrawal", label: "提现应付", amount: 3_800_000, source: "D2" },
        { key: "reward", label: "奖励应付", amount: 1_320_000, source: "F/H" },
      ],
      prev: {
        reserveUsd: 5_800_000,
        netFlow24hUsd: -64_000,
        queueBacklogCount: 9,
        avgRiskScore: 38,
      },
    },
    liquidity: {
      coverage: {},
      liabilities: [
        { nm: "提现应付", pc: 64, amount: 3_800_000, cat: "--admin-cat-1", source: "D2" },
        { nm: "奖励应付", pc: 22, amount: 1_320_000, cat: "--admin-cat-2", source: "F/H" },
      ],
      runway: [
        { day: "D+1", valueWan: 46 },
        { day: "D+2", valueWan: 38 },
      ],
      runwayTotalWan: 84,
      flow: [
        { label: "W1", valueWan: -12 },
        { label: "W2", valueWan: 18 },
      ],
    },
    funnel: {
      stages: [
        { key: "register", nm: "注册", ct: 1200, lc: "L1", conv: null, color: "var(--brand)", label: "注册", count: 1200, prevCount: 1180 },
        { key: "first_buy", nm: "首购", ct: 420, lc: "L3", conv: "35%", color: "var(--brand)", label: "首购", count: 420, prevCount: 390 },
      ],
      transitions: [{ nm: "注册到首购", from: "注册", to: "首购", v: "35%", flow: "L1→L3", note: "正常", noteKind: "up" }],
      cohort: [1200, 900, 650, 420],
      channels: [{ nm: "自然流量", pc: 62, catVar: "--admin-cat-1", q: "organic" }],
      daily: [34, 36, 35, 37],
      dailyTarget: 40,
      overallConversionPct: 35,
    },
    rhythm: {
      h1: { currentPhase: "P3", currentPhaseName: "放大", currentMonth: 6, totalMonths: 12, phaseProgressPct: 50 },
      phaseNodes: [{ code: "P3", name: "放大", intensity: 72 }],
      inflowWan: [18, 22, 25, 23],
      budget: [{ nm: "增长", pc: 46, varName: "--admin-cat-3" }],
      ratio: [0.8, 0.9, 1.1, 1.0],
      healthyRatio: 1.2,
      currentRatio: 1.0,
      suggestion: "保持节奏",
    },
    riskRadar: {
      ...riskChildren,
      trippedGateCount: 0,
      pressureTightPct: 24,
      currentPressurePct: 17,
      flaggedAccounts: 3,
      bankRunRatio: 6.7,
      bankRunYellowPct: 20,
      bankRunRedlinePct: 40,
    },
  };
}
