import { expect, test, type APIResponse, type Page } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Account = {
  username: string;
  password: string;
  totpSecret: string;
};

type Fixture = {
  runId: string;
  accounts: {
    maker: Account;
  };
};

type Envelope<T> = {
  code?: number;
  message?: string;
  data?: T;
};

type GeoOverview = {
  blocked: Array<{ cc: string }>;
  limited: Array<{ cc: string }>;
  countryOptions: Array<{ value: string }>;
};

type TamperOverview = {
  alertConfig: {
    threshold: number;
    feedK4: boolean;
  };
};

const RUN_ID = process.env.J_CHILD_RUN_ID?.trim() || "pc-full-acceptance-20260729-114336-J-D-child";
const FIXTURE_PATH = process.env.J_CHILD_FIXTURE_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const EVIDENCE_DIR = process.env.J23_CHILD_EVIDENCE_DIR?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/j23";
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const maker = fixture.accounts.maker;

if (!maker?.username || !maker.password || !maker.totpSecret) {
  throw new Error("J_CHILD_FIXTURE_PATH must contain maker username/password/totpSecret");
}
if (!path.resolve(EVIDENCE_DIR).toLowerCase().includes(`${path.sep}.restricted${path.sep}`)) {
  throw new Error("J23_CHILD_EVIDENCE_DIR must remain under bug-pic/.restricted");
}

mkdirSync(EVIDENCE_DIR, { recursive: true });
test.use({ trace: "off" });
test.describe.configure({ mode: "serial" });

test("J2 child：提交后响应丢失只能原 key 重放，CAS/载荷冲突失败关闭并恢复前镜像", async ({ page }) => {
  test.setTimeout(240_000);
  await loginVisible(page, maker);
  await openVisibleSidebar(page, "/emergency/geo-block", "黑名单（完全封禁）");

  const before = await geoOverview(page);
  const blockedBefore = countryCodes(before.blocked);
  const limitedBefore = countryCodes(before.limited);
  const probeCountry = before.countryOptions
    .map((item) => item.value.toUpperCase())
    .find((country) => !blockedBefore.includes(country) && !limitedBefore.includes(country));
  expect(probeCountry, "child 必须有一个当前 allowed 的国家作为可逆 J2 载具").toBeTruthy();
  const blockedProbe = sorted([...blockedBefore, probeCountry!]);
  const idempotencyKey = `${RUN_ID}-j2-unknown-${Date.now()}`;
  const reason = `${RUN_ID} J2 child unknown-result exact-once probe`;
  const body = {
    status: "blocked",
    countries: blockedProbe,
    expectedCountries: blockedBefore,
    triggerBasis: "安全事件",
    reason,
    operator: maker.username,
  };
  let upstream: ParsedResponse<GeoOverview> | null = null;

  try {
    let intercepted = false;
    await page.route("**/api/admin/emergency/geo-block/country-lists/blocked", async (route) => {
      if (intercepted || route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      intercepted = true;
      const committed = await route.fetch();
      upstream = await parsed(committed);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "X-Nexion-Upstream-Outcome": "unknown",
        },
        body: JSON.stringify({ code: 503, message: "UPSTREAM_RESPONSE_LOST_AFTER_COMMIT", data: null }),
      });
    });

    const uncertain = await browserPut(page, "/api/admin/emergency/geo-block/country-lists/blocked", idempotencyKey, body);
    await page.unroute("**/api/admin/emergency/geo-block/country-lists/blocked");
    expect(uncertain.status).toBe(503);
    expect(uncertain.outcome).toBe("unknown");
    expect(upstream, "route.fetch 必须先把 child 写入提交到真实后端").not.toBeNull();
    assertOk(upstream!);

    const replay = await apiPut<GeoOverview>(
      page,
      "/api/admin/emergency/geo-block/country-lists/blocked",
      idempotencyKey,
      body,
    );
    assertOk(replay);
    expect(countryCodes((await geoOverview(page)).blocked)).toEqual(blockedProbe);

    const payloadMismatch = await apiPut<GeoOverview>(
      page,
      "/api/admin/emergency/geo-block/country-lists/blocked",
      idempotencyKey,
      { ...body, reason: `${reason} payload-mismatch` },
    );
    assertBusinessFailure(payloadMismatch, 409, /IDEMPOTENCY.*MISMATCH|PAYLOAD.*MISMATCH/);

    const staleCas = await apiPut<GeoOverview>(
      page,
      "/api/admin/emergency/geo-block/country-lists/blocked",
      `${RUN_ID}-j2-stale-${Date.now()}`,
      {
        ...body,
        countries: blockedBefore,
        reason: `${RUN_ID} J2 stale CAS must fail closed`,
      },
    );
    assertBusinessFailure(staleCas, 409, /GEO_COUNTRY_LIST_CONFLICT/);
    expect(countryCodes((await geoOverview(page)).blocked)).toEqual(blockedProbe);

    writeEvidence("j2-unknown-cas-idempotency.json", {
      runId: RUN_ID,
      fixtureRunId: fixture.runId,
      probeCountry,
      before: { blocked: blockedBefore, limited: limitedBefore },
      committed: { blocked: blockedProbe },
      uncertainTransport: { status: uncertain.status, outcome: uncertain.outcome },
      idempotencyKeySha256: sha256(idempotencyKey),
      replay: { status: replay.status, code: replay.body.code ?? 0 },
      payloadMismatch: summary(payloadMismatch),
      staleCas: summary(staleCas),
    });
  } finally {
    await page.unroute("**/api/admin/emergency/geo-block/country-lists/blocked").catch(() => undefined);
    const current = countryCodes((await geoOverview(page)).blocked);
    if (!same(current, blockedBefore)) {
      expect(current, "发现非本载具并发漂移时禁止覆盖 child 权威状态").toEqual(blockedProbe);
      const restored = await apiPut<GeoOverview>(
        page,
        "/api/admin/emergency/geo-block/country-lists/blocked",
        `${RUN_ID}-j2-restore-${Date.now()}`,
        {
          status: "blocked",
          countries: blockedBefore,
          expectedCountries: current,
          triggerBasis: "",
          reason: `${RUN_ID} J2 child exact restore`,
          operator: maker.username,
        },
      );
      assertOk(restored);
    }
    const after = await geoOverview(page);
    expect(countryCodes(after.blocked)).toEqual(blockedBefore);
    expect(countryCodes(after.limited)).toEqual(limitedBefore);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "j2-restored.png"), fullPage: true });
  }
});

test("J3 child：配置写入未知结果原 key 重放，CAS/载荷冲突失败关闭并恢复前镜像", async ({ page }) => {
  test.setTimeout(240_000);
  await loginVisible(page, maker);
  await openVisibleSidebar(page, "/emergency/tamper", "篡改防御监控");

  const before = await tamperOverview(page);
  const configBefore = before.alertConfig;
  const probeThreshold = configBefore.threshold >= 100 ? configBefore.threshold - 1 : configBefore.threshold + 1;
  const idempotencyKey = `${RUN_ID}-j3-unknown-${Date.now()}`;
  const reason = `${RUN_ID} J3 child unknown-result exact-once probe`;
  const body = {
    threshold: probeThreshold,
    feedK4: configBefore.feedK4,
    expectedThreshold: configBefore.threshold,
    expectedFeedK4: configBefore.feedK4,
    reason,
    operator: maker.username,
  };
  let upstream: ParsedResponse<TamperOverview> | null = null;

  try {
    let intercepted = false;
    await page.route("**/api/admin/emergency/tamper/alert-config", async (route) => {
      if (intercepted || route.request().method() !== "PUT") {
        await route.continue();
        return;
      }
      intercepted = true;
      const committed = await route.fetch();
      upstream = await parsed(committed);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        headers: {
          "X-Nexion-Upstream-Outcome": "unknown",
        },
        body: JSON.stringify({ code: 503, message: "UPSTREAM_RESPONSE_LOST_AFTER_COMMIT", data: null }),
      });
    });

    const uncertain = await browserPut(page, "/api/admin/emergency/tamper/alert-config", idempotencyKey, body);
    await page.unroute("**/api/admin/emergency/tamper/alert-config");
    expect(uncertain.status).toBe(503);
    expect(uncertain.outcome).toBe("unknown");
    expect(upstream, "route.fetch 必须先把 child 写入提交到真实后端").not.toBeNull();
    assertOk(upstream!);

    const replay = await apiPut<TamperOverview>(
      page,
      "/api/admin/emergency/tamper/alert-config",
      idempotencyKey,
      body,
    );
    assertOk(replay);
    expect((await tamperOverview(page)).alertConfig).toMatchObject({
      threshold: probeThreshold,
      feedK4: configBefore.feedK4,
    });

    const payloadMismatch = await apiPut<TamperOverview>(
      page,
      "/api/admin/emergency/tamper/alert-config",
      idempotencyKey,
      { ...body, reason: `${reason} payload-mismatch` },
    );
    assertBusinessFailure(payloadMismatch, 409, /IDEMPOTENCY.*MISMATCH|PAYLOAD.*MISMATCH/);

    const staleCas = await apiPut<TamperOverview>(
      page,
      "/api/admin/emergency/tamper/alert-config",
      `${RUN_ID}-j3-stale-${Date.now()}`,
      {
        ...body,
        threshold: configBefore.threshold,
        reason: `${RUN_ID} J3 stale CAS must fail closed`,
      },
    );
    assertBusinessFailure(staleCas, 409, /TAMPER_ALERT_CONFIG_CONFLICT/);
    expect((await tamperOverview(page)).alertConfig.threshold).toBe(probeThreshold);

    writeEvidence("j3-unknown-cas-idempotency.json", {
      runId: RUN_ID,
      fixtureRunId: fixture.runId,
      before: configBefore,
      committed: { threshold: probeThreshold, feedK4: configBefore.feedK4 },
      uncertainTransport: { status: uncertain.status, outcome: uncertain.outcome },
      idempotencyKeySha256: sha256(idempotencyKey),
      replay: { status: replay.status, code: replay.body.code ?? 0 },
      payloadMismatch: summary(payloadMismatch),
      staleCas: summary(staleCas),
    });
  } finally {
    await page.unroute("**/api/admin/emergency/tamper/alert-config").catch(() => undefined);
    const current = (await tamperOverview(page)).alertConfig;
    if (current.threshold !== configBefore.threshold || current.feedK4 !== configBefore.feedK4) {
      expect(current, "发现非本载具并发漂移时禁止覆盖 child 权威状态").toEqual({
        ...current,
        threshold: probeThreshold,
        feedK4: configBefore.feedK4,
      });
      const restored = await apiPut<TamperOverview>(
        page,
        "/api/admin/emergency/tamper/alert-config",
        `${RUN_ID}-j3-restore-${Date.now()}`,
        {
          threshold: configBefore.threshold,
          feedK4: configBefore.feedK4,
          expectedThreshold: current.threshold,
          expectedFeedK4: current.feedK4,
          reason: `${RUN_ID} J3 child exact restore`,
          operator: maker.username,
        },
      );
      assertOk(restored);
    }
    expect((await tamperOverview(page)).alertConfig).toMatchObject(configBefore);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "j3-restored.png"), fullPage: true });
  }
});

type ParsedResponse<T> = {
  status: number;
  body: Envelope<T>;
  raw: string;
};

async function loginVisible(page: Page, account: Account) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    const shell = page.locator("aside");
    await shell.or(otp).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await shell.isVisible().catch(() => false)) {
      return;
    }
    await expect(otp).toBeVisible();
    await waitForFreshTotp(page);
    await otp.fill(totp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as { code?: number; message?: string } | null;
    const hasAuthCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasAuthCookie)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
      return;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`J child MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error("J child login did not reach the authenticated shell");
}

async function openVisibleSidebar(page: Page, href: string, visibleText: string) {
  const link = page.locator(`a[href="${href}"]`).first();
  if (!await link.isVisible({ timeout: 2_000 }).catch(() => false)) {
    const group = page.locator('button[aria-controls="nav-group-J"]');
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
  await expect(page.getByText(visibleText, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
}

async function geoOverview(page: Page) {
  const response = await page.request.get("/api/admin/emergency/geo-block");
  const value = await parsed<GeoOverview>(response);
  assertOk(value);
  return value.body.data!;
}

async function tamperOverview(page: Page) {
  const response = await page.request.get("/api/admin/emergency/tamper/overview?window=24h&accountPage=1&accountPageSize=5");
  const value = await parsed<TamperOverview>(response);
  assertOk(value);
  return value.body.data!;
}

async function apiPut<T>(page: Page, url: string, idempotencyKey: string, data: unknown) {
  return parsed<T>(await page.request.put(url, {
    headers: { "Idempotency-Key": idempotencyKey },
    data,
  }));
}

async function parsed<T>(response: APIResponse): Promise<ParsedResponse<T>> {
  const raw = await response.text();
  let body: Envelope<T> = {};
  try {
    body = raw ? JSON.parse(raw) as Envelope<T> : {};
  } catch {
    // The caller's assertion emits the sanitized raw response.
  }
  return { status: response.status(), body, raw };
}

function assertOk<T>(response: ParsedResponse<T>) {
  expect(response.status, response.raw).toBeLessThan(300);
  expect(response.body.code ?? 0, response.raw).toBe(0);
  expect(response.body.data, response.raw).toBeTruthy();
}

function assertBusinessFailure<T>(response: ParsedResponse<T>, code: number, message: RegExp) {
  expect([response.status, response.body.code], response.raw).toContain(code);
  expect(response.body.message ?? "", response.raw).toMatch(message);
}

async function browserPut(page: Page, url: string, idempotencyKey: string, body: unknown) {
  return page.evaluate(async ({ requestUrl, key, requestBody }) => {
    const response = await fetch(requestUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(requestBody),
    });
    return {
      status: response.status,
      outcome: response.headers.get("X-Nexion-Upstream-Outcome"),
      body: await response.text(),
    };
  }, { requestUrl: url, key: idempotencyKey, requestBody: body });
}

function countryCodes(rows: Array<{ cc: string }>) {
  return sorted(rows.map((row) => row.cc.toUpperCase()));
}

function sorted(values: string[]) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function same(left: string[], right: string[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function summary<T>(response: ParsedResponse<T>) {
  return {
    status: response.status,
    code: response.body.code,
    message: response.body.message,
  };
}

function writeEvidence(name: string, value: unknown) {
  writeFileSync(path.join(EVIDENCE_DIR, name), JSON.stringify(value, null, 2));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function waitForFreshTotp(page: Page) {
  const remainingMs = 30_000 - (Date.now() % 30_000);
  if (remainingMs <= 3_000) await page.waitForTimeout(remainingMs + 500);
}

function totp(secret: string) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function decodeBase32(raw: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = raw.replace(/[^A-Z2-7]/gi, "").toUpperCase();
  let bits = "";
  for (const char of normalized) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("INVALID_BASE32_SECRET");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}
