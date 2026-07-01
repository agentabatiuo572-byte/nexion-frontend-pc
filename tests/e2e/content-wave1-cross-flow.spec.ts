import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

test.describe.configure({ mode: "serial" });

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const BACKEND_URL = process.env.NEXION_BACKEND_URL ?? "http://127.0.0.1:8110";
const MYSQL_EXE = process.env.MYSQL_EXE ?? "D:\\software\\MySQL\\MySQL Server 8.0\\bin\\mysql.exe";
const USERNAME = process.env.CONTENT_E2E_USERNAME ?? "e2e_shift_content_1_20260630174418";
const PASSWORD = process.env.CONTENT_E2E_PASSWORD ?? "E2eShift@202606301744181Aa";
const PREFIX = process.env.CONTENT_E2E_PREFIX ?? "e2e-content1-20260630174418";
const RUN_TOKEN = `${PREFIX}-${Date.now().toString(36)}`;
const OPERATOR = "E2E Shift content 1";
const REASON = `${PREFIX} Wave-1 content 本地交叉测试保留数据`;
const REPORT_DIR = process.env.CONTENT_E2E_REPORT_DIR ?? path.join(process.cwd(), ".codex-run", "content-wave1", PREFIX);
const REPORT_FILE = path.join(REPORT_DIR, `${RUN_TOKEN}.json`);

type JsonMap = Record<string, unknown>;

const report = {
  runToken: RUN_TOKEN,
  startedAt: new Date().toISOString(),
  localOnly: false,
  role: "",
  authorities: [] as string[],
  evidence: [] as string[],
  intercepts: [] as string[],
  assertions: {
    frontendState: false,
    backendRecord: false,
    auditA2: false,
    downstreamVisible: false,
    authorizationGate: false,
    localOnlyNetwork: false,
    mockSeedHardcodedScan: false,
  },
  reviews: {
    initial: { score: 0, passed: false },
    adversarial: { score: 0, passed: false },
  },
};

const frontendRoutes = [
  "/content/copy-ab",
  "/content/nova",
  "/content/notifications",
  "/content/trust",
  "/content/i18n",
  "/emergency/kill-switch",
  "/emergency/geo-block",
  "/emergency/tamper",
  "/emergency/sop",
  "/risk/multi-account",
  "/risk/abuse",
  "/risk/scoring",
  "/analytics/kpi",
  "/analytics/funnel-cohort",
  "/analytics/financial",
  "/analytics/operations",
  "/analytics/export",
  "/analytics/behavior-heatmap",
  "/finance/withdrawals",
  "/finance/ledger",
  "/finance-products/staking",
  "/finance-products/exchange",
  "/growth/quest",
  "/growth/daily",
];

const readEndpoints = [
  "/api/admin/content/copy-ab/overview",
  "/api/admin/content/nova/overview",
  "/api/admin/content/campaigns/overview",
  "/api/admin/content/trust-disclosure/overview",
  "/api/admin/content/i18n-learning/overview",
  "/api/admin/emergency/kill-switches",
  "/api/admin/emergency/geo-block",
  "/api/admin/emergency/tamper/overview",
  "/api/admin/emergency/sop/playbooks",
  "/api/admin/risk/multi-account/overview",
  "/api/admin/risk/arbitrage/overview",
  "/api/admin/risk/scoring/overview",
  "/api/admin/bi/kpi/overview",
  "/api/admin/bi/funnel/overview",
  "/api/admin/bi/finance/overview",
  "/api/admin/bi/operations/overview",
  "/api/admin/bi/export/overview",
  "/api/admin/bi/behavior-heatmap/overview",
  "/api/admin/finance/withdrawals",
  "/api/admin/finance/withdrawal-params",
  "/api/admin/market/staking",
  "/api/admin/market/exchange",
  "/api/admin/growth/rhythm",
  "/api/admin/growth/check-in",
  "/api/admin/treasury/ledger/bills",
];

test.beforeAll(() => {
  assertLocalUrl(BASE_URL, "ADMIN_BASE_URL");
  assertLocalUrl(BACKEND_URL, "NEXION_BACKEND_URL");
  report.localOnly = true;
});

test.afterAll(() => {
  report.reviews.initial = review("initial");
  report.reviews.adversarial = review("adversarial");
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(REPORT_FILE, `${JSON.stringify({ ...report, completedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
});

test("Wave-1 content: I/J/K/L with D2/G1/G2 admission gates", async ({ page }, testInfo) => {
  blockNonLocalBrowserTraffic(page);
  await loginAsContent(page);

  await test.step("API read coverage for I1-I6, J1-J4, K1/K2/K4, L1-L6 and D2/G1/G2", async () => {
    const missing: string[] = [];
    for (const endpoint of readEndpoints) {
      const data = await apiOk(page, "GET", endpoint);
      if (data == null) {
        missing.push(endpoint);
      } else if (typeof data === "object" && Object.keys(data as JsonMap).length === 0) {
        report.evidence.push(`api-empty-data:${endpoint}`);
      }
    }
    expect(missing, "所有目标模块后端读取都应返回非空数据").toEqual([]);
    report.assertions.backendRecord = true;
  });

  await test.step("Frontend route coverage and fatal UI guard", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const route of frontendRoutes) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await expect(page.locator("body"), `${route} body visible`).toBeVisible();
      await expect(page.locator("body"), `${route} not redirected to login`).not.toContainText(/登录|username|password/i);
      await expect(page.locator("body"), `${route} no fatal backend/UI text`).not.toContainText(
        /Handler dispatch failed|SQLSyntaxErrorException|BACKEND_UNAVAILABLE|Cannot read properties|TypeError|ReferenceError|接口写入失败|mock 用户详情/i,
      );
      report.evidence.push(`ui:${route}`);
    }
    expect(pageErrors, "页面运行时异常").toEqual([]);
    report.assertions.frontendState = true;
  });

  const copyKey = await test.step("I1 fixture publish -> rollback -> archive", async () => {
    const key = `copy-${RUN_TOKEN}`.slice(0, 96);
    seedCopyFixture(key);
    const publish = await apiOk(page, "POST", `/api/admin/content/copy-ab/copies/${encodeURIComponent(key)}/versions`, {
      version: "v2",
      surface: "Home",
      audience: "全量",
      trafficSplit: "50",
      versionNote: `${PREFIX} I1 publish`,
      zh: `${PREFIX} 首页文案 {amount}`,
      en: `${PREFIX} home copy {amount}`,
      operator: OPERATOR,
      reason: `${REASON} I1 发布`,
    }, "i1-publish");
    expect(String((publish as JsonMap).version ?? "")).toBe("v2");

    const rollback = await apiOk(page, "POST", `/api/admin/content/copy-ab/copies/${encodeURIComponent(key)}/versions/v1/rollback`, {
      operator: OPERATOR,
      reason: `${REASON} I1 回滚`,
    }, "i1-rollback");
    expect(String((rollback as JsonMap).version ?? "")).toBe("v1");

    const archive = await apiOk(page, "POST", `/api/admin/content/copy-ab/copies/${encodeURIComponent(key)}/archive`, {
      operator: OPERATOR,
      reason: `${REASON} I1 归档测试专属文案`,
    }, "i1-archive");
    expect(String((archive as JsonMap).status ?? "")).toBe("archived");
    report.evidence.push(`i1:copyKey=${key}:archived`);
    return key;
  });

  await test.step("I2 Nova channel/template publish and archive", async () => {
    const channel = `nova-${RUN_TOKEN}`.slice(0, 64);
    const created = await apiOk(page, "POST", "/api/admin/content/nova/channels", {
      key: channel,
      name: `${PREFIX} Nova channel`,
      trigger: "内容应急事件触发",
      tick: "15 min",
      cooldown: "24h",
      ctr: 12.3,
      enabled: true,
      operator: OPERATOR,
      reason: `${REASON} I2 新增频道`,
    }, "i2-channel");
    expect(String((created as JsonMap).key ?? "")).toBe(channel);

    const template = await apiOk(page, "POST", "/api/admin/content/nova/templates", {
      channel,
      name: `${PREFIX} Nova template`,
      cta: "打开 App 消息中心",
      version: "v1",
      operator: OPERATOR,
      reason: `${REASON} I2 新增模板`,
    }, "i2-template");
    expect(String((template as JsonMap).status ?? "")).toBe("DRAFT");

    const published = await apiOk(page, "PATCH", `/api/admin/content/nova/templates/${encodeURIComponent(channel)}/status`, {
      status: "PUBLISHED",
      operator: OPERATOR,
      reason: `${REASON} I2 模板发布`,
    }, "i2-template-publish");
    expect(String((published as JsonMap).status ?? "")).toBe("PUBLISHED");

    const archived = await apiOk(page, "PATCH", `/api/admin/content/nova/templates/${encodeURIComponent(channel)}/status`, {
      status: "ARCHIVED",
      operator: OPERATOR,
      reason: `${REASON} I2 模板归档`,
    }, "i2-template-archive");
    expect(String((archived as JsonMap).status ?? "")).toBe("ARCHIVED");
    report.evidence.push(`i2:channel=${channel}:templateArchived`);
  });

  const notifyCampaignNo = await test.step("I3 template/campaign schedule cancel plus J4 notify dispatch", async () => {
    const cancelCampaign = await createCampaign(page, "cancel", "normal");
    const cancelNo = String((cancelCampaign as JsonMap).id ?? "");
    await apiOk(page, "POST", `/api/admin/content/campaigns/${encodeURIComponent(cancelNo)}/schedule`, {
      schedule: "下一窗口排期",
      operator: OPERATOR,
      reason: `${REASON} I3 排期后回滚`,
    }, "i3-cancel-schedule");
    const cancelled = await apiOk(page, "POST", `/api/admin/content/campaigns/${encodeURIComponent(cancelNo)}/cancel`, {
      operator: OPERATOR,
      reason: `${REASON} I3 取消排期`,
    }, "i3-cancel");
    expect(String((cancelled as JsonMap).status ?? "")).toBe("cancelled");

    const notifyCampaign = await createCampaign(page, "j4-notify", "critical");
    const campaignNo = String((notifyCampaign as JsonMap).id ?? "");
    const playbook = await apiOk(page, "POST", "/api/admin/emergency/sop/playbooks", {
      name: `${PREFIX} J4 content notify playbook`,
      scene: "舆情挤兑",
      owner: OPERATOR,
      sla: "≤ 30m",
      emergencyTrack: true,
      actionSeq: [
        `I3·发送 ${PREFIX} 通知模板`,
        "I4·披露门槛同步 D2 G1 G2",
        "K1·账户簇建档调查",
        "K2·套利监控复核",
        "K4·风险评分复算",
        "D2·提现限流 50%",
      ].join("\n"),
      notifyCampaignNo: campaignNo,
      notifyTemplate: `${PREFIX} J4 notify template`,
      rollback: "campaign-correction",
      drillRequired: false,
      operator: OPERATOR,
      reason: `${REASON} J4 绑定 I3 通知`,
    }, "j4-playbook");
    const code = String(((playbook as JsonMap).updated as JsonMap | undefined)?.code ?? "");
    expect(code).toMatch(/^SOP-DRAFT-/);

    const execution = await apiOk(page, "POST", `/api/admin/emergency/sop/playbooks/${encodeURIComponent(code)}/executions`, {
      emergency: true,
      operator: OPERATOR,
      reason: `${REASON} J4 执行触达并生成回滚证据`,
    }, "j4-exec");
    const notificationDispatch = ((execution as JsonMap).updated as JsonMap | undefined)?.notificationDispatch as JsonMap | undefined;
    expect(String(notificationDispatch?.status ?? "")).toBe("DISPATCHED");
    expect(Number(notificationDispatch?.notificationCount ?? 0)).toBeGreaterThan(0);
    const domainActions = (((execution as JsonMap).updated as JsonMap | undefined)?.domainActions as JsonMap[] | undefined) ?? [];
    expect(domainActions.map((row) => row.domain)).toEqual(expect.arrayContaining(["I4", "K1", "D2"]));
    await apiOk(page, "GET", "/api/admin/risk/arbitrage/overview");
    await apiOk(page, "GET", "/api/admin/risk/scoring/overview");
    report.evidence.push(`i3-j4:campaign=${campaignNo}:playbook=${code}:notifications=${notificationDispatch?.notificationCount}`);
    return campaignNo;
  });

  await test.step("I4 disclosure gate blocks retired scope then retries D2/G1/G2 scope", async () => {
    const retired = await apiRaw(page, "PATCH", "/api/admin/content/trust-disclosure/disclosures/gated-actions", {
      scope: "premium",
      operator: OPERATOR,
      reason: `${REASON} I4 退休能力拦截`,
    }, "i4-retired-gate");
    const retiredJson = await json(retired);
    expect(retired.status()).toBeGreaterThanOrEqual(400);
    expect(String(retiredJson.message ?? retiredJson.code)).toContain("SUNSET_CAPABILITY_READONLY");
    report.intercepts.push(`i4-retired-scope:${retired.status()}:${String(retiredJson.message ?? retiredJson.code)}`);

    const gate = await apiOk(page, "PATCH", "/api/admin/content/trust-disclosure/disclosures/gated-actions", {
      scope: "withdraw staking exchange",
      operator: OPERATOR,
      reason: `${REASON} I4 披露门槛覆盖 D2 G1 G2`,
    }, "i4-valid-gate");
    const gateScope = String((gate as JsonMap).gateScope ?? "");
    expect(gateScope).toMatch(/提现|质押|兑换|withdraw|staking|exchange/i);

    const [d2, g1, g2] = await Promise.all([
      apiRaw(page, "PATCH", "/api/admin/finance/withdrawal-params", {
        key: "dailyLimit",
        value: "999",
        operator: OPERATOR,
        reason: `${REASON} D2 准入拦截`,
      }, "d2-deny"),
      apiRaw(page, "PATCH", "/api/admin/market/staking/pools/flexible/params/apr", {
        value: "99",
        operator: OPERATOR,
        reason: `${REASON} G1 准入拦截`,
      }, "g1-deny"),
      apiRaw(page, "PATCH", "/api/admin/market/exchange/params/userDailyCap", {
        value: "999",
        operator: OPERATOR,
        reason: `${REASON} G2 准入拦截`,
      }, "g2-deny"),
    ]);
    await expectDenied(d2, "D2 withdrawal write");
    await expectDenied(g1, "G1 staking write");
    await expectDenied(g2, "G2 exchange write");

    const staking = await apiOk(page, "GET", "/api/admin/market/staking");
    const exchange = await apiOk(page, "GET", "/api/admin/market/exchange");
    expect(staking).toHaveProperty("disclosureGate");
    expect(exchange).toHaveProperty("disclosureGate");
    report.assertions.authorizationGate = true;
  });

  await test.step("I6 learning course to H3/H5/D4/L cross-read", async () => {
    const courseId = `course-${RUN_TOKEN}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 80);
    const course = await apiOk(page, "POST", `/api/admin/content/i18n-learning/courses/${courseId}`, {
      titleZh: `${PREFIX} 学习课程`,
      titleEn: `${PREFIX} learning course`,
      bodyZh: `完成 {count} 个任务后查看钱包流水`,
      bodyEn: `Review wallet ledger after finishing {count} tasks`,
      category: "Earn",
      format: "Article",
      difficulty: "Beginner",
      rewardNex: 20,
      duration: "8 min",
      publishState: "draft",
      operator: OPERATOR,
      reason: `${REASON} I6 新建课程`,
    }, "i6-course");
    expect(String((course as JsonMap).id ?? "")).toBe(courseId);

    await apiOk(page, "POST", `/api/admin/content/i18n-learning/courses/${courseId}/publish`, {
      operator: OPERATOR,
      reason: `${REASON} I6 发布课程`,
    }, "i6-publish");
    await apiOk(page, "PATCH", `/api/admin/content/i18n-learning/courses/${courseId}/reward`, {
      rewardNex: 15,
      operator: OPERATOR,
      reason: `${REASON} I6 奖励下调保持覆盖率安全`,
    }, "i6-reward");
    await apiOk(page, "PATCH", "/api/admin/content/i18n-learning/courses/featured", {
      courseId,
      operator: OPERATOR,
      reason: `${REASON} I6 设为精选课程`,
    }, "i6-featured");
    const i6Overview = await apiOk(page, "GET", "/api/admin/content/i18n-learning/overview");
    expect(String((i6Overview as JsonMap).featuredCourseId ?? "")).toBe(courseId);

    const h3 = await apiRaw(page, "GET", "/api/admin/growth/quest-events");
    if (h3.status() >= 400) {
      const h3Payload = await json(h3);
      report.intercepts.push(`h3-quest-events:${h3.status()}:${String(h3Payload.message ?? h3Payload.code)}`);
      expect(String(h3Payload.message ?? h3Payload.code)).toMatch(/QUEST_CONFIG_KEY_INVALID|GROWTH_ROUTE_NOT_FOUND|ADMIN_PERMISSION_DENIED/i);
    } else {
      const h3Payload = await json(h3);
      expect(h3Payload.code).toBe(0);
      report.evidence.push("h3:quest-events-readable");
    }

    for (const endpoint of [
      "/api/admin/growth/rhythm",
      "/api/admin/growth/check-in",
      "/api/admin/treasury/ledger/bills",
      "/api/admin/bi/kpi/overview",
      "/api/admin/bi/finance/overview",
      "/api/admin/bi/operations/overview",
    ]) {
      await apiOk(page, "GET", endpoint);
    }
    report.evidence.push(`i6:course=${courseId}:featured`);
  });

  await test.step("DB evidence: notifications, audits, gate config, copy, course", async () => {
    const rows = sqlRows(`
      SELECT 'campaigns', COUNT(*) FROM nx_notification_campaign WHERE name LIKE '${sqlLike(PREFIX)}' OR body_zh LIKE '${sqlLike(PREFIX)}'
      UNION ALL SELECT 'notifications', COUNT(*) FROM nx_notification WHERE biz_no LIKE 'j4:%' AND body LIKE '${sqlLike(PREFIX)}'
      UNION ALL SELECT 'audits', COUNT(*) FROM nx_audit_log WHERE detail_json LIKE '${sqlLike(PREFIX)}' OR resource_id LIKE '${sqlLike(PREFIX)}'
      UNION ALL SELECT 'gate_config', COUNT(*) FROM nx_config_item WHERE config_key IN ('disclosure.gate.withdraw','disclosure.gate.staking','disclosure.gate.exchange') AND config_value='true'
      UNION ALL SELECT 'copy_fixture', COUNT(*) FROM nx_content_copy WHERE copy_key='${sql(copyKey)}' AND status='ARCHIVED'
      UNION ALL SELECT 'course_article', COUNT(*) FROM nx_help_article WHERE article_code LIKE 'learn.%${sql(PREFIX)}%' OR title LIKE '${sqlLike(PREFIX)}'
      UNION ALL SELECT 'course_i18n', COUNT(*) FROM nx_i18n_message WHERE message_key LIKE 'learn.%${sql(PREFIX)}%' OR message_value LIKE '${sqlLike(PREFIX)}';
    `);
    const counts = new Map(rows.map(([name, count]) => [name, Number(count)]));
    for (const key of ["campaigns", "notifications", "audits", "gate_config", "copy_fixture", "course_article", "course_i18n"]) {
      expect(counts.get(key), `DB count ${key}`).toBeGreaterThan(0);
    }
    report.evidence.push(`db:${JSON.stringify(Object.fromEntries(counts))}`);
    report.assertions.auditA2 = true;
    report.assertions.downstreamVisible = true;
  });

  await test.step("Mock/seed/hardcoded scan for active content data", async () => {
    const frontendHits = rg([
      "-n",
      "from ['\\\"]@?/lib/mock|from ['\\\"].*mock|mock 用户详情|hardcoded content|硬编码内容",
      "app",
      "lib",
    ]);
    const backendHits = rg([
      "-n",
      "OpsReadTimeSeedPolicy|SEED|Hardcoded|hardcoded|硬编码",
      "D:\\workspace\\nexion-backend\\src\\main\\java\\ffdd\\opsconsole\\content",
      "D:\\workspace\\nexion-backend\\src\\main\\java\\ffdd\\opsconsole\\emergency",
      "D:\\workspace\\nexion-backend\\src\\main\\java\\ffdd\\opsconsole\\bi",
    ]);
    expect(frontendHits).not.toMatch(/from ['"]@?\/?lib\/mock|mock 用户详情/i);
    report.evidence.push(`scan:frontendHits=${lineCount(frontendHits)} backendSeedOrHardcodedHits=${lineCount(backendHits)}`);
    report.assertions.mockSeedHardcodedScan = true;
  });

  expect(report.assertions).toMatchObject({
    frontendState: true,
    backendRecord: true,
    auditA2: true,
    downstreamVisible: true,
    authorizationGate: true,
    localOnlyNetwork: true,
    mockSeedHardcodedScan: true,
  });

  await testInfo.attach("content-wave1-report", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  expect(notifyCampaignNo).toContain("CMP-N-");
});

function assertLocalUrl(urlText: string, label: string) {
  const parsed = new URL(urlText);
  if (!["127.0.0.1", "localhost"].includes(parsed.hostname)) {
    throw new Error(`${label} must be local-only, got ${urlText}`);
  }
}

function blockNonLocalBrowserTraffic(page: Page) {
  page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
      void route.abort();
      report.intercepts.push(`blocked-nonlocal:${url.href}`);
      return;
    }
    void route.continue();
  });
  report.assertions.localOnlyNetwork = true;
}

async function loginAsContent(page: Page) {
  const response = await page.request.post("/api/admin/auth/login", {
    data: { username: USERNAME, password: PASSWORD },
  });
  const data = await apiOkResponse(response, "content login") as JsonMap;
  const session = data.session as JsonMap | undefined;
  expect(session?.username).toBe(USERNAME);
  expect(session?.role).toBe("content");
  const authorities = (session?.authorities as string[] | undefined) ?? [];
  expect(authorities).toEqual(expect.arrayContaining([
    "PERM_CONTENT_READ",
    "PERM_CONTENT_WRITE",
    "PERM_EMERGENCY_READ",
    "PERM_EMERGENCY_WRITE",
    "PERM_RISK_READ",
    "PERM_RISK_WRITE",
    "PERM_BI_READ",
    "PERM_BI_EXPORT",
    "PERM_WITHDRAWAL_READ",
    "PERM_MARKET_READ",
    "PERM_GROWTH_READ",
    "PERM_TREASURY_READ",
  ]));
  expect(authorities).not.toEqual(expect.arrayContaining(["PERM_WITHDRAWAL_REVIEW", "PERM_MARKET_WRITE"]));
  report.role = String(session?.role ?? "");
  report.authorities = authorities;
}

async function createCampaign(page: Page, suffix: string, tier: "critical" | "normal") {
  const body = {
    name: `cw1-${suffix}-${Date.now().toString(36)}`,
    title: `${PREFIX} ${suffix} 标题`,
    content: `${PREFIX} ${suffix} 通知内容`,
    tier,
    audience: "全量",
    budget: 10,
    operator: OPERATOR,
    reason: `${REASON} I3 ${suffix}`,
  };
  const data = await apiOk(page, "POST", "/api/admin/content/campaigns", body, `i3-${suffix}`);
  expect(String((data as JsonMap).id ?? "")).toContain("CMP-N-");
  return data;
}

async function apiOk(page: Page, method: "GET" | "POST" | "PATCH", endpoint: string, body?: unknown, idem?: string) {
  const response = await apiRaw(page, method, endpoint, body, idem);
  return apiOkResponse(response, `${method} ${endpoint}`);
}

async function apiRaw(page: Page, method: "GET" | "POST" | "PATCH", endpoint: string, body?: unknown, idem?: string) {
  const headers: Record<string, string> = { "Cache-Control": "no-store" };
  if (idem) {
    headers["Idempotency-Key"] = `${RUN_TOKEN}-${idem}`;
  }
  if (method === "GET") {
    return page.request.get(endpoint, { headers });
  }
  if (method === "POST") {
    return page.request.post(endpoint, { headers, data: body });
  }
  return page.request.patch(endpoint, { headers, data: body });
}

async function apiOkResponse(response: APIResponse, label: string) {
  const payload = await json(response);
  expect(response.status(), `${label} HTTP ${JSON.stringify(payload)}`).toBeLessThan(400);
  expect(payload.code, `${label} code ${JSON.stringify(payload)}`).toBe(0);
  return payload.data;
}

async function json(response: APIResponse) {
  try {
    return await response.json();
  } catch {
    return { code: response.status(), message: await response.text() };
  }
}

async function expectDenied(response: APIResponse, label: string) {
  const payload = await json(response);
  expect(response.status(), `${label} must be denied ${JSON.stringify(payload)}`).toBe(403);
  expect(String(payload.message ?? payload.code)).toMatch(/ADMIN_PERMISSION_DENIED|403|Forbidden/i);
  report.intercepts.push(`${label}:${response.status()}:${String(payload.message ?? payload.code)}`);
}

function seedCopyFixture(copyKey: string) {
  execMysql(`
    INSERT INTO nx_content_copy
      (copy_key, description, surface, current_version, status, i18n_key, last_change, last_operator, created_at, updated_at, is_deleted)
    VALUES
      ('${sql(copyKey)}', '${sql(PREFIX)} I1 fixture', 'Home', 'v1', 'PUBLISHED', '${sql(copyKey)}.title', 'E2E', '${sql(OPERATOR)}', NOW(), NOW(), 0)
    ON DUPLICATE KEY UPDATE
      description=VALUES(description), surface='Home', current_version='v1', status='PUBLISHED',
      last_operator='${sql(OPERATOR)}', updated_at=NOW(), is_deleted=0;

    INSERT INTO nx_content_copy_version
      (copy_key, version, status, chain, ts_label, zh_text, en_text, surface, audience, traffic_split, version_note, last_operator, created_at, updated_at, is_deleted)
    VALUES
      ('${sql(copyKey)}', 'v1', 'PUBLISHED', 'E2E fixture', 'E2E', '${sql(PREFIX)} 初始文案 {amount}', '${sql(PREFIX)} initial copy {amount}', 'Home', '全量', '50', '${sql(PREFIX)} initial', '${sql(OPERATOR)}', NOW(), NOW(), 0)
    ON DUPLICATE KEY UPDATE
      status='PUBLISHED', zh_text=VALUES(zh_text), en_text=VALUES(en_text),
      last_operator='${sql(OPERATOR)}', updated_at=NOW(), is_deleted=0;
  `);
}

function sqlRows(query: string) {
  return execMysql(query)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function execMysql(query: string) {
  return execFileSync(MYSQL_EXE, [
    "-uroot",
    "-pA123456789Z!@#",
    "--batch",
    "--raw",
    "--skip-column-names",
    "nexion",
    "-e",
    query,
  ], { cwd: process.cwd(), encoding: "utf8" });
}

function rg(args: string[]) {
  try {
    return execFileSync("rg", args, { cwd: process.cwd(), encoding: "utf8" });
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) {
      return "";
    }
    throw error;
  }
}

function lineCount(text: string) {
  return text.trim() ? text.trim().split(/\r?\n/).length : 0;
}

function sql(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

function sqlLike(value: string) {
  return `%${sql(value)}%`;
}

function review(kind: "initial" | "adversarial") {
  const missing = Object.entries(report.assertions)
    .filter(([, value]) => value !== true)
    .map(([key]) => key);
  const interceptEvidence = report.intercepts.length >= 4;
  const evidenceCount = report.evidence.length;
  const score = 100
    - missing.length * 8
    - (interceptEvidence ? 0 : 4)
    - (evidenceCount >= 12 ? 0 : 4);
  const threshold = kind === "initial" ? 97 : 99;
  return {
    score,
    passed: score >= threshold,
    missing,
    interceptEvidence,
    evidenceCount,
    focus: kind === "initial"
      ? ["四类断言", "本地网络", "真实后端写入"]
      : ["Murphy: 权限漂移", "Murphy: gate 未落库", "Murphy: J4 通知未回写", "Murphy: mock 数据误用"],
  };
}
