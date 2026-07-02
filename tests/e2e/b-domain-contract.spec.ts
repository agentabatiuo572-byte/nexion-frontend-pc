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
  const session = {
    tokenType: "Bearer",
    session: {
      adminId: 9001,
      username: "e2e_b_domain_admin",
      operator: "E2E B Domain Admin",
      role: "superadmin",
      authorities: ["*"],
    },
  };
  await page.addInitScript((auth) => {
    window.localStorage.setItem(
      "nexion-admin-auth-v2",
      JSON.stringify({
        state: {
          isAuthenticated: true,
          operator: auth.session.operator,
          role: auth.session.role,
          tokenType: auth.tokenType,
          session: auth.session,
        },
        version: 2,
      }),
    );
  }, session);
  await page.route("**/api/admin/auth/session", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: session }) });
  });
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
    ? { gates: [], feed: [], pressureSeries: [], rules: [], severity: [], volume: [] }
    : {
        gates: [
          { nm: "D2 提现放行", dom: "D2", on: true, state: "on", configKey: "emergency.kill.withdrawal" },
          { nm: "G4 分红派发", dom: "G4", on: true, state: "on", configKey: "emergency.kill.genesis" },
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
    },
  };
}
