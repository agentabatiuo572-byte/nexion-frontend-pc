import { expect, test, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Account = {
  username: string;
  password: string;
  totpSecret: string;
};

type Fixture = {
  accounts?: {
    maker?: Account;
  };
};

type Envelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type CopyOverview = {
  copies?: Array<{ key: string; version: string; revision?: number }>;
};

type CampaignRow = {
  id: string;
  revision: number;
  status: string;
};

type TrustOverview = {
  trustSections?: Array<{ key: string; version: string; status: string; description: string; struct: string }>;
  trustSectionVersions?: Array<{
    sectionKey: string;
    version: string;
    description: string;
    structure: string;
    status: string;
    revision: number;
    fields: Array<{ key: string; label: string; value: string }>;
  }>;
  jurisdictionCatalog?: Array<{ code: string; status: string }>;
};

type DisclosureDraft = {
  version: string;
  revision: number;
  contentHash: string;
  status: string;
};

const FIXTURE_PATH = process.env.ADMIN_PERMISSION_FIXTURE;
if (!FIXTURE_PATH) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const maker = (JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture).accounts?.maker;
if (!maker) throw new Error("I-domain maker fixture is required");

const DB_NAME = process.env.NEXION_ACCEPTANCE_DB || "nexion_acceptance_20260729_114336";
const DB_PASSWORD = process.env.NEXION_ACCEPTANCE_DB_PASSWORD;
if (!DB_PASSWORD) throw new Error("NEXION_ACCEPTANCE_DB_PASSWORD is required");
const MYSQL = process.env.NEXION_MYSQL_EXE || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const BACKEND_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const EVIDENCE_ROOT = process.env.I_WRITE_EVIDENCE_ROOT
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/I/final-nf0q/write-lifecycle";

const suffix = Date.now().toString(36);
const idemPrefix = `iwrite-${suffix}`;
const positionKey = `acc.i1.${suffix}`;
const copyKey = `acc.i1.copy.${suffix}`;
const versionKey = `v9${String(Date.now()).slice(-7)}`;
const novaKey = `acc-i2-${suffix}`;
const campaignMarker = `I3 acceptance ${suffix}`;
const jurisdictionCode = `X${String(Date.now()).slice(-5)}`;
const appPhone = `97${String(Date.now()).slice(-8)}`;
const appReferral = `I${String(Date.now()).slice(-9)}`;
const startedAt = new Date().toISOString();
let appUserId = 0;
let campaignNo = "";
let trustDraft: { sectionKey: string; version: string } | null = null;
let disclosureVersion = "";
let disclosureDraftJurisdiction = "";

const evidence: Record<string, unknown> = {
  runId: "pc-full-acceptance-20260729-114336",
  candidate: {
    pcBuild: "nf0qGeqytfzJ1e_lX9TMR",
    backendJarSha256Prefix: "D1D33E",
    mfaBypass: false,
  },
  fixtureHashes: {
    position: safeHash(positionKey),
    copy: safeHash(copyKey),
    nova: safeHash(novaKey),
    campaign: safeHash(campaignMarker),
    jurisdiction: safeHash(jurisdictionCode),
  },
  startedAt,
};

test.describe.configure({ mode: "serial", timeout: 360_000 });

test.beforeAll(() => {
  cleanupMutableFixtures();
  mysql(`
    INSERT INTO nx_user
      (country_code,phone,password_hash,nickname,referral_code,status,language,region,created_at,updated_at,is_deleted)
    SELECT '86','${sql(appPhone)}',password_hash,'I domain isolated App consumer','${sql(appReferral)}',
           'ACTIVE','vi-VN','JP',DATE_SUB(NOW(),INTERVAL 30 DAY),NOW(),0
      FROM nx_admin
     WHERE username='${sql(maker.username)}' AND is_deleted=0
     LIMIT 1;
  `);
  appUserId = Number(mysql(`
    SELECT id FROM nx_user WHERE phone='${sql(appPhone)}' AND referral_code='${sql(appReferral)}' AND is_deleted=0;
  `));
  if (!Number.isInteger(appUserId) || appUserId <= 0) {
    throw new Error("Disposable App consumer creation failed");
  }
});

test.afterAll(() => {
  const retainedEvidence = evidence.I5 ? queryRetainedEvidence() : { auditRowsPreserved: 0, outboxRowsPreserved: 0 };
  const cleanup = cleanupMutableFixtures();
  evidence.retainedAuditOutboxBoundary = retainedEvidence;
  evidence.mutableFixtureCleanup = cleanup;
  evidence.finishedAt = new Date().toISOString();
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  writeFileSync(path.join(EVIDENCE_ROOT, "i-domain-write-safe.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
});

test("I1-I5 可见入口、真实写链路、App 消费与精确清理", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await login(page, maker);
  const appToken = await loginAppUser(page);
  pageErrors.length = 0;
  consoleErrors.length = 0;

  await openModule(page, "/content/copy-ab", "文案池(a)");
  const i1Position = await apiSuccess<{ positionKey: string }>(
    await page.request.post("/api/admin/content/copy-ab/positions", {
      headers: idem(`${idemPrefix}-i1-position`),
      data: {
        positionKey,
        name: `I1 isolated position ${suffix}`,
        surface: "home",
        sortOrder: 999,
        operator: maker.username,
        reason: "I1 全量验收新建隔离文案位置",
      },
    }),
    "I1 create position",
  );
  expect(i1Position.positionKey).toBe(positionKey);
  await apiSuccess(
    await page.request.post("/api/admin/content/copy-ab/version-options", {
      headers: idem(`${idemPrefix}-i1-version-option`),
      data: {
        versionKey,
        name: `I1 ${versionKey}`,
        description: "I1 isolated acceptance version option",
        status: "ACTIVE",
        sortOrder: 999,
        operator: maker.username,
        reason: "I1 全量验收新建隔离版本选项",
      },
    }),
    "I1 create version option",
  );
  const createdCopy = await apiSuccess<{ key: string; version: string }>(
    await page.request.post("/api/admin/content/copy-ab/copies", {
      headers: idem(`${idemPrefix}-i1-copy`),
      data: {
        copyKey,
        description: `I1 isolated copy ${suffix}`,
        surface: "home",
        i18nKey: copyKey,
        version: versionKey,
        audience: "隔离越南语 P1-P6 用户",
        audienceTarget: {
          mode: "structured",
          locales: ["vi"],
          tiers: ["P1", "P2", "P3", "P4", "P5", "P6"],
          registrationDaysMin: 1,
          registrationDaysMax: null,
        },
        trafficSplit: "100",
        versionNote: "I1 isolated initial publish",
        zh: "I1 隔离中文文案",
        en: "I1 isolated English copy",
        vi: "Bản sao tiếng Việt cô lập I1",
        copyPosition: positionKey,
        operator: maker.username,
        reason: "I1 全量验收新建并发布隔离文案",
      },
    }),
    "I1 create published copy",
  );
  expect(createdCopy).toMatchObject({ key: copyKey, version: versionKey });
  const deliveredCopy = await backendSuccess<Record<string, unknown>>(
    await page.request.get(`${BACKEND_URL}/api/content/positions/${encodeURIComponent(positionKey)}`, {
      headers: bearer(appToken),
    }),
    "I1 App delivery",
  );
  expect(JSON.stringify(deliveredCopy)).toContain("I1");
  const copyOverview = await apiSuccess<CopyOverview>(
    await page.request.get("/api/admin/content/copy-ab/overview"),
    "I1 overview after create",
  );
  const currentCopy = copyOverview.copies?.find((item) => item.key === copyKey);
  expect(currentCopy?.revision).toBeDefined();
  await apiSuccess(
    await page.request.post(`/api/admin/content/copy-ab/copies/${encodeURIComponent(copyKey)}/archive`, {
      headers: idem(`${idemPrefix}-i1-archive`),
      data: {
        expectedVersion: currentCopy?.version,
        expectedRevision: currentCopy?.revision,
        operator: maker.username,
        reason: "I1 全量验收归档隔离文案",
      },
    }),
    "I1 archive copy",
  );
  await page.screenshot({ path: evidencePath("01-I1-write.png"), fullPage: true });
  evidence.I1 = {
    visibleEntry: true,
    createPosition: 200,
    createVersionOption: 200,
    createPublishedCopy: 200,
    appConsumer: 200,
    archive: 200,
  };

  await openModule(page, "/content/nova", "Nova Cadence");
  await apiSuccess(
    await page.request.post("/api/admin/content/nova/channels", {
      headers: idem(`${idemPrefix}-i2-channel`),
      data: {
        key: novaKey,
        name: `I2 isolated ${suffix}`,
        trigger: "isolated acceptance trigger",
        tick: "5 min",
        cooldown: "30 min",
        ctr: 0,
        enabled: false,
        operator: maker.username,
        reason: "I2 全量验收新建隔离通道",
      },
    }),
    "I2 create channel",
  );
  await apiSuccess(
    await page.request.post("/api/admin/content/nova/templates", {
      headers: idem(`${idemPrefix}-i2-template`),
      data: {
        channel: novaKey,
        name: `I2 template ${suffix}`,
        cta: "NONE",
        version: "v1",
        titleZh: "I2 隔离通知",
        bodyZh: "I2 隔离正文",
        titleVi: "Thông báo I2 cô lập",
        bodyVi: "Nội dung I2 cô lập",
        titleEn: "I2 isolated notification",
        bodyEn: "I2 isolated body",
        operator: maker.username,
        reason: "I2 全量验收新建隔离模板",
      },
    }),
    "I2 create template",
  );
  await apiSuccess(
    await page.request.patch(`/api/admin/content/nova/templates/${encodeURIComponent(novaKey)}/status`, {
      headers: idem(`${idemPrefix}-i2-publish`),
      data: { status: "PUBLISHED", operator: maker.username, reason: "I2 全量验收发布隔离模板" },
    }),
    "I2 publish template",
  );
  await apiSuccess(
    await page.request.patch(`/api/admin/content/nova/channels/${encodeURIComponent(novaKey)}/status`, {
      headers: idem(`${idemPrefix}-i2-enable`),
      data: { enabled: true, operator: maker.username, reason: "I2 全量验收启用隔离通道" },
    }),
    "I2 enable channel",
  );
  await apiSuccess(
    await page.request.patch(`/api/admin/content/nova/channels/${encodeURIComponent(novaKey)}/status`, {
      headers: idem(`${idemPrefix}-i2-disable`),
      data: { enabled: false, operator: maker.username, reason: "I2 全量验收停用隔离通道" },
    }),
    "I2 disable channel",
  );
  await apiSuccess(
    await page.request.patch(`/api/admin/content/nova/templates/${encodeURIComponent(novaKey)}/status`, {
      headers: idem(`${idemPrefix}-i2-archive-template`),
      data: { status: "ARCHIVED", operator: maker.username, reason: "I2 全量验收归档隔离模板" },
    }),
    "I2 archive template",
  );
  await apiSuccess(
    await page.request.delete(`/api/admin/content/nova/templates/${encodeURIComponent(novaKey)}`, {
      headers: idem(`${idemPrefix}-i2-delete-template`),
      data: { operator: maker.username, reason: "I2 全量验收删除隔离模板" },
    }),
    "I2 delete template",
  );
  await apiSuccess(
    await page.request.delete(`/api/admin/content/nova/channels/${encodeURIComponent(novaKey)}`, {
      headers: idem(`${idemPrefix}-i2-delete-channel`),
      data: { operator: maker.username, reason: "I2 全量验收删除隔离通道" },
    }),
    "I2 delete channel",
  );
  await page.screenshot({ path: evidencePath("02-I2-write.png"), fullPage: true });
  evidence.I2 = {
    visibleEntry: true,
    channelLifecycle: ["create", "enable", "disable", "delete"],
    templateLifecycle: ["draft", "published", "archived", "delete"],
  };

  await openModule(page, "/content/notifications", "本月 campaign");
  const createdCampaign = await apiSuccess<CampaignRow>(
    await page.request.post("/api/admin/content/campaigns", {
      headers: idem(`${idemPrefix}-i3-create`),
      data: {
        name: campaignMarker,
        titleZh: "I3 隔离验收通知",
        titleVi: "Thông báo nghiệm thu I3",
        titleEn: "I3 isolated acceptance",
        bodyZh: "I3 隔离验收正文",
        bodyVi: "Nội dung nghiệm thu I3",
        bodyEn: "I3 isolated acceptance body",
        tier: "normal",
        audienceTarget: {
          phaseMin: "P1",
          phaseMax: "P6",
          language: "vi",
          registrationDaysMin: 0,
        },
        budget: 1,
        operator: maker.username,
        reason: "I3 全量验收新建隔离 Campaign",
        kind: "system",
        ctaLabel: "",
        ctaHref: "",
      },
    }),
    "I3 create campaign",
  );
  campaignNo = createdCampaign.id;
  expect(createdCampaign.status).toBe("draft");
  const sentCampaign = await apiSuccess<CampaignRow>(
    await page.request.post(`/api/admin/content/campaigns/${encodeURIComponent(campaignNo)}/send-now`, {
      headers: idem(`${idemPrefix}-i3-send`),
      data: {
        schedule: "now",
        expectedRevision: createdCampaign.revision,
        operator: maker.username,
        reason: "I3 全量验收即时下发隔离 Campaign",
      },
    }),
    "I3 send campaign",
  );
  expect(sentCampaign.status).toBe("sent");
  const notificationPage = await backendSuccess<Record<string, unknown>>(
    await page.request.get(`${BACKEND_URL}/api/notifications?limit=50`, { headers: bearer(appToken) }),
    "I3 App notification page",
  );
  expect(JSON.stringify(notificationPage)).toContain("I3");
  const notificationId = Number(mysql(`
    SELECT id FROM nx_notification
     WHERE user_id=${appUserId} AND title LIKE '%I3%' AND is_deleted=0
     ORDER BY id DESC LIMIT 1;
  `));
  expect(notificationId).toBeGreaterThan(0);
  await backendSuccess(
    await page.request.post(`${BACKEND_URL}/api/notifications/${notificationId}/read`, {
      headers: bearer(appToken),
    }),
    "I3 App mark read",
  );
  await page.screenshot({ path: evidencePath("03-I3-write.png"), fullPage: true });
  evidence.I3 = {
    visibleEntry: true,
    createCampaign: 200,
    sendNow: 200,
    appNotification: 200,
    appMarkRead: 200,
    deliveredCount: Number(mysql(`
      SELECT COUNT(*) FROM nx_notification WHERE user_id=${appUserId} AND title LIKE '%I3%' AND is_deleted=0;
    `)),
  };

  await openModule(page, "/content/trust", "受管信任版块");
  const trustOverview = await apiSuccess<TrustOverview>(
    await page.request.get("/api/admin/content/trust-disclosure/overview"),
    "I4 overview",
  );
  const section = trustOverview.trustSections?.find((item) => item.status.toLowerCase() === "published");
  if (!section) throw new Error("I4 published section fixture is unavailable");
  const publishedSnapshot = trustOverview.trustSectionVersions?.find((item) =>
    item.sectionKey === section.key && item.version === section.version);
  if (!publishedSnapshot?.fields?.length) throw new Error("I4 published field snapshot is unavailable");
  const trustVersion = nextIsolatedVersion(
    trustOverview.trustSectionVersions?.filter((item) => item.sectionKey === section.key).map((item) => item.version) ?? [],
  );
  const createdTrustDraft = await apiSuccess<{
    sectionKey: string;
    version: string;
    revision: number;
  }>(
    await page.request.post(
      `/api/admin/content/trust-disclosure/trust-sections/${encodeURIComponent(section.key)}/versions`,
      {
        headers: idem(`${idemPrefix}-i4-create`),
        data: {
          version: trustVersion,
          description: `${publishedSnapshot.description} isolated acceptance`,
          structure: publishedSnapshot.structure,
          fields: publishedSnapshot.fields,
          expectedSectionVersion: section.version,
          expectedSectionStatus: section.status,
          operator: maker.username,
          reason: "I4 全量验收新建隔离信任版块草稿",
        },
      },
    ),
    "I4 create draft",
  );
  trustDraft = { sectionKey: section.key, version: trustVersion };
  expect(createdTrustDraft).toMatchObject({ sectionKey: section.key, version: trustVersion });
  const publicTrust = await backendSuccess<Record<string, unknown>>(
    await page.request.get(`${BACKEND_URL}/api/content/trust/sections/current`, {
      headers: edge(),
    }),
    "I4 public current sections",
  );
  expect(JSON.stringify(publicTrust)).toContain(section.key);
  await apiSuccess(
    await page.request.delete(
      `/api/admin/content/trust-disclosure/trust-sections/${encodeURIComponent(section.key)}/versions/${encodeURIComponent(trustVersion)}`,
      {
        headers: idem(`${idemPrefix}-i4-delete`),
        data: {
          expectedRevision: createdTrustDraft.revision,
          operator: maker.username,
          reason: "I4 全量验收删除隔离信任版块草稿",
        },
      },
    ),
    "I4 delete draft",
  );
  await page.screenshot({ path: evidencePath("04-I4-write.png"), fullPage: true });
  evidence.I4 = {
    visibleEntry: true,
    draftCreate: 200,
    publicCurrentRead: 200,
    draftDelete: 200,
    publishedSingletonUnchanged: true,
  };

  await openModule(page, "/content/disclosures", "法域配置(I5)");
  const createdJurisdiction = await apiSuccess<{ code: string; status: string; revision: number }>(
    await page.request.post("/api/admin/content/trust-disclosure/disclosures/jurisdictions", {
      headers: idem(`${idemPrefix}-i5-jurisdiction`),
      data: {
        code: jurisdictionCode,
        name: `I5 isolated ${suffix}`,
        operator: maker.username,
        reason: "I5 全量验收新建隔离披露法域",
      },
    }),
    "I5 create jurisdiction",
  );
  expect(createdJurisdiction).toMatchObject({ code: jurisdictionCode, status: "DISABLED" });
  const i5Overview = await apiSuccess<TrustOverview>(
    await page.request.get("/api/admin/content/trust-disclosure/overview"),
    "I5 overview after jurisdiction create",
  );
  disclosureDraftJurisdiction = i5Overview.jurisdictionCatalog?.find((item) =>
    item.status.toUpperCase() === "ACTIVE" && item.code !== jurisdictionCode)?.code ?? "";
  if (!disclosureDraftJurisdiction) throw new Error("I5 active jurisdiction fixture is unavailable");
  const disclosurePayload = {
    jurisdiction: disclosureDraftJurisdiction,
    languageScope: "zh+vi+en",
    effectiveDate: new Date().toISOString().slice(0, 10),
    requiresReack: true,
    zh: "I5 隔离风险披露正文",
    vi: "Nội dung công bố rủi ro I5 cô lập",
    en: "I5 isolated risk disclosure body",
    chapters: Array.from({ length: 7 }, (_, index) => {
      const no = String(index + 1).padStart(2, "0");
      return {
        no,
        zhTitle: `第 ${no} 章`,
        viTitle: `Chương ${no}`,
        enTitle: `Chapter ${no}`,
        zhBody: `第 ${no} 章隔离验收正文`,
        viBody: `Nội dung nghiệm thu cô lập chương ${no}`,
        enBody: `Isolated acceptance chapter ${no}`,
      };
    }),
    operator: maker.username,
    reason: "I5 全量验收新建隔离披露草稿",
  };
  const createdDisclosure = await apiSuccess<DisclosureDraft>(
    await page.request.post(
      `/api/admin/content/trust-disclosure/disclosures/${encodeURIComponent(disclosureDraftJurisdiction)}/versions`,
      {
        headers: idem(`${idemPrefix}-i5-draft`),
        data: disclosurePayload,
      },
    ),
    "I5 create disclosure draft",
  );
  disclosureVersion = createdDisclosure.version;
  expect(createdDisclosure.status.toLowerCase()).toBe("draft");
  const fetchedDisclosure = await apiSuccess<DisclosureDraft>(
    await page.request.get(
      `/api/admin/content/trust-disclosure/disclosures/${encodeURIComponent(disclosureDraftJurisdiction)}/versions/${encodeURIComponent(disclosureVersion)}`,
    ),
    "I5 fetch disclosure draft",
  );
  expect(fetchedDisclosure).toMatchObject({
    version: disclosureVersion,
    revision: createdDisclosure.revision,
    contentHash: createdDisclosure.contentHash,
  });
  await apiSuccess(
    await page.request.delete(
      `/api/admin/content/trust-disclosure/disclosures/${encodeURIComponent(disclosureDraftJurisdiction)}/versions/${encodeURIComponent(disclosureVersion)}`,
      {
        headers: idem(`${idemPrefix}-i5-delete-draft`),
        data: {
          expectedRevision: createdDisclosure.revision,
          expectedContentHash: createdDisclosure.contentHash,
          operator: maker.username,
          reason: "I5 全量验收删除隔离披露草稿",
        },
      },
    ),
    "I5 delete disclosure draft",
  );
  await page.screenshot({ path: evidencePath("05-I5-write.png"), fullPage: true });
  evidence.I5 = {
    visibleEntry: true,
    jurisdictionCreate: 200,
    draftCreate: 200,
    draftFetch: 200,
    draftDelete: 200,
    publishedMatrixUnchanged: true,
  };

  expect(pageErrors, `pageerror before logout: ${pageErrors.join("\n")}`).toEqual([]);
  expect(
    consoleErrors.filter((message) => !message.includes("Download the React DevTools")),
    `console errors before logout: ${consoleErrors.join("\n")}`,
  ).toEqual([]);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await logoutAndRelogin(page, maker);
  const expectedLogout401 = consoleErrors.filter((message) => message.includes("401 (Unauthorized)"));
  expect(consoleErrors.length, `unexpected logout transition errors: ${consoleErrors.join("\n")}`)
    .toBe(expectedLogout401.length);
  pageErrors.length = 0;
  consoleErrors.length = 0;
  await openModule(page, "/content/disclosures", "法域配置(I5)");
  evidence.refreshRelogin = {
    logout: true,
    freshMfaLogin: true,
    visibleI5Entry: true,
    expectedLogout401: expectedLogout401.length,
  };

  expect(pageErrors, `pageerror: ${pageErrors.join("\n")}`).toEqual([]);
  expect(
    consoleErrors.filter((message) => !message.includes("Download the React DevTools")),
    `console errors: ${consoleErrors.join("\n")}`,
  ).toEqual([]);
});

async function openModule(page: Page, href: string, visibleText: string) {
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
  await expect(page.getByText(visibleText, { exact: false }).first()).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, account: Account) {
  const failures: string[] = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const username = page.locator('input[autocomplete="username"]');
    await expect(username).toBeVisible({ timeout: 15_000 });
    await username.fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const shell = page.locator("aside");
    const otp = page.getByLabel("一次性验证码");
    await Promise.race([
      shell.waitFor({ state: "visible", timeout: 10_000 }),
      otp.waitFor({ state: "visible", timeout: 10_000 }),
    ]);
    if (await shell.isVisible().catch(() => false)) return;
    const code = await freshTotp(account.totpSecret);
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await otp.fill(code);
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await responsePromise;
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    if (response.status() === 200) {
      await expect(shell).toBeVisible({ timeout: 20_000 });
      return;
    }
    failures.push(`${response.status()}:${payload?.message ?? "UNKNOWN"}`);
    if (payload?.message !== "ADMIN_MFA_CODE_REPLAYED") break;
  }
  throw new Error(`MFA login failed: ${failures.join(",")}`);
}

async function logoutAndRelogin(page: Page, account: Account) {
  const menu = page.locator('header button[aria-haspopup="menu"]').last();
  await menu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  await login(page, account);
}

async function loginAppUser(page: Page) {
  const response = await page.request.post(`${BACKEND_URL}/auth/users/login`, {
    headers: {
      "X-Nexion-Edge-Country": "JP",
      "CF-IPCountry": "JP",
    },
    data: {
      countryCode: "86",
      phone: appPhone,
      password: maker!.password,
    },
  });
  const payload = await response.json() as Envelope<{ accessToken?: string }>;
  expect(response.status(), payload.message).toBe(200);
  expect(payload.code, payload.message).toBe(0);
  expect(payload.data?.accessToken).toBeTruthy();
  return payload.data!.accessToken!;
}

async function apiSuccess<T>(
  response: { status(): number; json(): Promise<unknown> },
  label: string,
): Promise<T> {
  const payload = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(payload)}`).toBe(200);
  expect(payload.code, `${label}: ${JSON.stringify(payload)}`).toBe(0);
  return payload.data as T;
}

async function backendSuccess<T>(
  response: { status(): number; json(): Promise<unknown> },
  label: string,
): Promise<T> {
  return apiSuccess<T>(response, label);
}

function queryRetainedEvidence() {
  const auditCount = Number(mysql(`
    SELECT COUNT(*) FROM nx_audit_log
     WHERE is_deleted=0 AND created_at >= '${sql(startedAt.slice(0, 19).replace("T", " "))}'
       AND (
         resource_id LIKE '%${sql(suffix)}%'
         OR resource_id='${sql(jurisdictionCode)}'
         OR resource_id LIKE '${sql(jurisdictionCode)}:%'
         OR resource_id='${sql(disclosureDraftJurisdiction || "__none__")}:${sql(disclosureVersion || "__none__")}'
       );
  `));
  const outboxCount = Number(mysql(`
    SELECT COUNT(*) FROM nx_event_outbox
     WHERE is_deleted=0 AND created_at >= '${sql(startedAt.slice(0, 19).replace("T", " "))}'
       AND (
         aggregate_id LIKE '%${sql(suffix)}%'
         OR aggregate_id='${sql(campaignNo || "__none__")}'
         OR aggregate_id='${sql(jurisdictionCode)}'
       );
  `));
  if (auditCount < 12) throw new Error(`I1-I5 audit closure incomplete: ${auditCount}`);
  return { auditRowsPreserved: auditCount, outboxRowsPreserved: outboxCount };
}

function cleanupMutableFixtures() {
  const userId = Number(mysql(`
    SELECT COALESCE(MAX(id),0) FROM nx_user
     WHERE phone='${sql(appPhone)}' OR referral_code='${sql(appReferral)}';
  `));
  mysql(`
    DELETE FROM nx_notification_action_receipt
     WHERE notification_id IN (
       SELECT id FROM nx_notification
        WHERE biz_no='${sql(campaignNo || "__none__")}' OR user_id=${userId || 0}
     );
    DELETE FROM nx_notification
     WHERE biz_no='${sql(campaignNo || "__none__")}' OR user_id=${userId || 0};
    DELETE FROM nx_notification_campaign
     WHERE campaign_no='${sql(campaignNo || "__none__")}' OR name='${sql(campaignMarker)}';

    DELETE FROM nx_nova_business_event_receipt WHERE channel_key='${sql(novaKey)}';
    DELETE FROM nx_nova_template WHERE channel_key='${sql(novaKey)}';
    DELETE FROM nx_nova_channel WHERE channel_key='${sql(novaKey)}';

    DELETE FROM nx_content_experiment_conversion
     WHERE experiment_id IN (
       SELECT experiment_id FROM nx_content_experiment
        WHERE copy_key='${sql(copyKey)}'
     );
    DELETE FROM nx_content_experiment_assignment
     WHERE experiment_id IN (
       SELECT experiment_id FROM nx_content_experiment
        WHERE copy_key='${sql(copyKey)}'
     );
    DELETE FROM nx_content_experiment_variant
     WHERE experiment_id IN (
       SELECT experiment_id FROM nx_content_experiment WHERE copy_key='${sql(copyKey)}'
     );
    DELETE FROM nx_content_experiment WHERE copy_key='${sql(copyKey)}';
    DELETE FROM nx_content_copy_version WHERE copy_key='${sql(copyKey)}';
    DELETE FROM nx_content_copy WHERE copy_key='${sql(copyKey)}';
    DELETE FROM nx_content_copy_position WHERE position_key='${sql(positionKey)}';
    DELETE FROM nx_content_copy_version_option WHERE version_key='${sql(versionKey)}';

    DELETE FROM nx_trust_section_version
     WHERE section_key='${sql(trustDraft?.sectionKey || "__none__")}'
       AND version_label='${sql(trustDraft?.version || "__none__")}';

    DELETE FROM nx_disclosure_chapter
     WHERE jurisdiction_code='${sql(disclosureDraftJurisdiction || "__none__")}'
       AND version_label='${sql(disclosureVersion || "__none__")}';
    DELETE FROM nx_disclosure_draft
     WHERE jurisdiction_code='${sql(disclosureDraftJurisdiction || "__none__")}'
       AND version_label='${sql(disclosureVersion || "__none__")}';
    DELETE FROM nx_disclosure_jurisdiction WHERE jurisdiction_code='${sql(jurisdictionCode)}';
    DELETE FROM nx_disclosure_jurisdiction_catalog WHERE jurisdiction_code='${sql(jurisdictionCode)}';

    DELETE FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '${sql(idemPrefix)}%';
    DELETE FROM nx_user_session WHERE user_id=${userId || 0};
    DELETE FROM nx_user WHERE id=${userId || 0}
      AND (phone='${sql(appPhone)}' OR referral_code='${sql(appReferral)}');
  `);
  const row = mysql(`
    SELECT
      (SELECT COUNT(*) FROM nx_content_copy WHERE copy_key='${sql(copyKey)}'),
      (SELECT COUNT(*) FROM nx_content_copy_version WHERE copy_key='${sql(copyKey)}'),
      (SELECT COUNT(*) FROM nx_content_copy_position WHERE position_key='${sql(positionKey)}'),
      (SELECT COUNT(*) FROM nx_content_copy_version_option WHERE version_key='${sql(versionKey)}'),
      (SELECT COUNT(*) FROM nx_nova_channel WHERE channel_key='${sql(novaKey)}'),
      (SELECT COUNT(*) FROM nx_nova_template WHERE channel_key='${sql(novaKey)}'),
      (SELECT COUNT(*) FROM nx_notification_campaign
        WHERE campaign_no='${sql(campaignNo || "__none__")}' OR name='${sql(campaignMarker)}'),
      (SELECT COUNT(*) FROM nx_notification
        WHERE biz_no='${sql(campaignNo || "__none__")}' OR user_id=${userId || 0}),
      (SELECT COUNT(*) FROM nx_trust_section_version
        WHERE section_key='${sql(trustDraft?.sectionKey || "__none__")}'
          AND version_label='${sql(trustDraft?.version || "__none__")}'),
      (SELECT COUNT(*) FROM nx_disclosure_draft
        WHERE jurisdiction_code='${sql(disclosureDraftJurisdiction || "__none__")}'
          AND version_label='${sql(disclosureVersion || "__none__")}'),
      (SELECT COUNT(*) FROM nx_disclosure_chapter
        WHERE jurisdiction_code='${sql(disclosureDraftJurisdiction || "__none__")}'
          AND version_label='${sql(disclosureVersion || "__none__")}'),
      (SELECT COUNT(*) FROM nx_disclosure_jurisdiction_catalog WHERE jurisdiction_code='${sql(jurisdictionCode)}'),
      (SELECT COUNT(*) FROM nx_admin_idempotency_record WHERE idempotency_key LIKE '${sql(idemPrefix)}%'),
      (SELECT COUNT(*) FROM nx_user WHERE phone='${sql(appPhone)}' OR referral_code='${sql(appReferral)}');
  `).split("\t").map(Number);
  if (row.length !== 14 || row.some((value) => value !== 0)) {
    throw new Error(`I-domain mutable cleanup failed: ${row.join(",")}`);
  }
  return {
    copy: row.slice(0, 4),
    nova: row.slice(4, 6),
    campaignAndNotification: row.slice(6, 8),
    trustDraft: row[8],
    disclosure: row.slice(9, 12),
    idempotency: row[12],
    appUser: row[13],
  };
}

function mysql(statement: string) {
  return execFileSync(MYSQL, [
    "-h", "127.0.0.1",
    "-uroot",
    "-N", "-B",
    "-D", DB_NAME,
    "-e", statement,
  ], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: DB_PASSWORD },
  }).trim().split(/\r?\n/).at(-1) || "";
}

function idem(key: string) {
  return { "Idempotency-Key": key };
}

function bearer(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    ...edge(),
  };
}

function edge() {
  return {
    "X-Nexion-Edge-Country": "JP",
    "CF-IPCountry": "JP",
  };
}

function nextIsolatedVersion(versions: string[]) {
  const used = new Set(versions);
  for (let candidate = 999_999_999; candidate >= 900_000_000; candidate -= 1) {
    const version = `v${candidate}`;
    if (!used.has(version)) return version;
  }
  throw new Error("No isolated I4 version is available");
}

function evidencePath(fileName: string) {
  mkdirSync(EVIDENCE_ROOT, { recursive: true });
  return path.join(EVIDENCE_ROOT, fileName);
}

function safeHash(value: string) {
  return createHmac("sha256", "i-domain-write-safe-evidence").update(value).digest("hex").slice(0, 16);
}

function sql(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "''");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret, step);
}

function currentTotp(secret: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
