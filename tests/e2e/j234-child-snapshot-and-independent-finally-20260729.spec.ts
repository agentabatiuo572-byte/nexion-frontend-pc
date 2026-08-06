import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = {
  username: string;
  password: string;
  totpSecret: string;
};

type Fixture = {
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
  endpoints: Array<{
    key: string;
    source: "derived" | "explicit";
    countries: string[];
    configurable: boolean;
  }>;
  edge: {
    source: string;
  };
};

type TamperOverview = {
  alertConfig: {
    threshold: number;
    feedK4: boolean;
  };
};

type KillSwitchOverview = {
  activeGates: Array<{
    key: string;
    enabled: boolean;
    emergency: boolean;
  }>;
  coverage?: {
    coverageRatio?: number;
    redlinePct?: number;
  };
};

type RecoverySnapshot = {
  runId: string;
  capturedAt: string;
  geo: {
    blocked: string[];
    limited: string[];
    endpoints: Array<{
      key: string;
      source: "derived" | "explicit";
      countries: string[];
      configurable: boolean;
    }>;
    edgeSource: string;
  };
  tamper: {
    threshold: number;
    feedK4: boolean;
  };
  genesis: {
    enabled: boolean;
    emergency: boolean;
  };
};

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3303";
const RUN_ID = process.env.J_CHILD_RUN_ID?.trim()
  || "pc-full-acceptance-20260729-114336-J-D-child";
const MODE = process.env.J_RECOVERY_MODE?.trim().toUpperCase() || "LIST_ONLY";
const FIXTURE_PATH = process.env.J_CHILD_FIXTURE_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/J.json";
const SNAPSHOT_PATH = process.env.J_RECOVERY_SNAPSHOT_PATH?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/api-before.json";
const EVIDENCE_DIR = process.env.J_RECOVERY_EVIDENCE_DIR?.trim()
  || "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/J/child-j234-D-handoff/runtime/independent-finally";
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const maker = fixture.accounts.maker;

for (const [label, value] of [
  ["J_CHILD_FIXTURE_PATH", FIXTURE_PATH],
  ["J_RECOVERY_SNAPSHOT_PATH", SNAPSHOT_PATH],
  ["J_RECOVERY_EVIDENCE_DIR", EVIDENCE_DIR],
] as const) {
  expect(path.resolve(value).toLowerCase(), `${label} must remain under bug-pic/.restricted`)
    .toContain(`${path.sep}.restricted${path.sep}`);
}
if (!maker?.username || !maker.password || !maker.totpSecret) {
  throw new Error("J child maker fixture must contain username/password/totpSecret");
}

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("J2/J3/J4 child：独立前镜像与失败路径精确恢复载具", async ({ page }) => {
  test.skip(
    !["SNAPSHOT", "RESTORE", "RESTORE_NON_J4"].includes(MODE),
    "Carrier is inert until the serialized runner selects a mode.",
  );
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await loginVisible(page, maker);

  if (MODE === "SNAPSHOT") {
    const snapshot = await captureSnapshot(page);
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), "utf8");
    writeFileSync(path.join(EVIDENCE_DIR, "snapshot-summary.json"), JSON.stringify({
      runId: RUN_ID,
      capturedAt: snapshot.capturedAt,
      counts: {
        blocked: snapshot.geo.blocked.length,
        limited: snapshot.geo.limited.length,
        endpoints: snapshot.geo.endpoints.length,
      },
      edgeSource: snapshot.geo.edgeSource,
      tamper: snapshot.tamper,
      genesis: snapshot.genesis,
      containsCredentials: false,
    }, null, 2), "utf8");
    return;
  }

  expect(process.env.J_INDEPENDENT_FINALLY_TOKEN?.trim(),
    "J_INDEPENDENT_FINALLY_TOKEN is required and must remain process-only").toBeTruthy();
  const before = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as RecoverySnapshot;
  expect(before.runId).toBe(RUN_ID);
  const actions: Array<Record<string, unknown>> = [];

  await restoreGeo(page, before, actions);
  await restoreTamper(page, before, actions);
  if (MODE === "RESTORE") {
    await restoreGenesis(page, before, actions);
  }

  const after = await captureSnapshot(page);
  expect(after.geo).toEqual(before.geo);
  expect(after.tamper).toEqual(before.tamper);
  if (MODE === "RESTORE") {
    expect(after.genesis).toEqual(before.genesis);
  }
  const evidenceName = MODE === "RESTORE"
    ? "j234-independent-finally.json"
    : "j23-emergency-cleanup.json";
  writeFileSync(path.join(EVIDENCE_DIR, evidenceName), JSON.stringify({
    runId: RUN_ID,
    mode: MODE,
    restoredAt: new Date().toISOString(),
    actions,
    before: {
      geo: before.geo,
      tamper: before.tamper,
      genesis: before.genesis,
    },
    after: {
      geo: after.geo,
      tamper: after.tamper,
      genesis: after.genesis,
    },
    exactMatch: MODE === "RESTORE"
      ? true
      : {
        geo: true,
        tamper: true,
        genesisDeferredToSameExecutionRecovery: JSON.stringify(after.genesis) !== JSON.stringify(before.genesis),
      },
    immutableEvidenceDeleted: false,
    tokenPersisted: false,
  }, null, 2), "utf8");
});

async function restoreGeo(
  page: Page,
  before: RecoverySnapshot,
  actions: Array<Record<string, unknown>>,
) {
  let current = await geoOverview(page);
  const currentBlocked = countryCodes(current.blocked);
  if (!same(currentBlocked, before.geo.blocked)) {
    await putOk(page, "/api/admin/emergency/geo-block/country-lists/blocked", {
      status: "blocked",
      countries: before.geo.blocked,
      expectedCountries: currentBlocked,
      triggerBasis: "独立 finally",
      reason: `${RUN_ID} independent finally restore blocked`,
      operator: maker.username,
    }, `${RUN_ID}-independent-finally-j2-blocked-${Date.now()}`);
    actions.push({ target: "J2 blocked", from: currentBlocked, to: before.geo.blocked });
  }

  current = await geoOverview(page);
  const currentLimited = countryCodes(current.limited);
  if (!same(currentLimited, before.geo.limited)) {
    await putOk(page, "/api/admin/emergency/geo-block/country-lists/limited", {
      status: "limited",
      countries: before.geo.limited,
      expectedCountries: currentLimited,
      triggerBasis: "独立 finally",
      reason: `${RUN_ID} independent finally restore limited`,
      operator: maker.username,
    }, `${RUN_ID}-independent-finally-j2-limited-${Date.now()}`);
    actions.push({ target: "J2 limited", from: currentLimited, to: before.geo.limited });
  }

  current = await geoOverview(page);
  for (const baseline of before.geo.endpoints.filter((endpoint) => endpoint.configurable)) {
    const actual = current.endpoints.find((endpoint) => endpoint.key === baseline.key);
    expect(actual, `J2 endpoint ${baseline.key} must still exist`).toBeTruthy();
    if (actual!.source !== baseline.source || !same(sorted(actual!.countries), baseline.countries)) {
      await putOk(page, `/api/admin/emergency/geo-block/endpoints/${encodeURIComponent(baseline.key)}`, {
        mode: baseline.source,
        countries: baseline.countries,
        expectedMode: actual!.source,
        expectedCountries: sorted(actual!.countries),
        reason: `${RUN_ID} independent finally restore endpoint ${baseline.key}`,
        operator: maker.username,
      }, `${RUN_ID}-independent-finally-j2-endpoint-${safeKey(baseline.key)}-${Date.now()}`);
      actions.push({
        target: `J2 endpoint ${baseline.key}`,
        from: { source: actual!.source, countries: sorted(actual!.countries) },
        to: { source: baseline.source, countries: baseline.countries },
      });
      current = await geoOverview(page);
    }
  }

  if (current.edge.source !== before.geo.edgeSource) {
    await putOk(page, "/api/admin/emergency/geo-block/edge-judge", {
      source: before.geo.edgeSource,
      expectedSource: current.edge.source,
      reason: `${RUN_ID} independent finally restore edge source`,
      operator: maker.username,
    }, `${RUN_ID}-independent-finally-j2-edge-${Date.now()}`);
    actions.push({ target: "J2 edge", from: current.edge.source, to: before.geo.edgeSource });
  }
}

async function restoreTamper(
  page: Page,
  before: RecoverySnapshot,
  actions: Array<Record<string, unknown>>,
) {
  const current = (await tamperOverview(page)).alertConfig;
  if (current.threshold === before.tamper.threshold && current.feedK4 === before.tamper.feedK4) return;
  await putOk(page, "/api/admin/emergency/tamper/alert-config", {
    threshold: before.tamper.threshold,
    feedK4: before.tamper.feedK4,
    expectedThreshold: current.threshold,
    expectedFeedK4: current.feedK4,
    reason: `${RUN_ID} independent finally restore J3`,
    operator: maker.username,
  }, `${RUN_ID}-independent-finally-j3-${Date.now()}`);
  actions.push({ target: "J3 alert config", from: current, to: before.tamper });
}

async function restoreGenesis(
  page: Page,
  before: RecoverySnapshot,
  actions: Array<Record<string, unknown>>,
) {
  const currentOverview = await killSwitchOverview(page);
  const current = genesisFrom(currentOverview);
  if (current.enabled === before.genesis.enabled && current.emergency === before.genesis.emergency) return;

  expect(process.env.B1_COVERAGE_LOCK?.trim(),
    "B1_COVERAGE_LOCK is required for independent J1/J4 recovery").toBeTruthy();
  if (before.genesis.enabled) {
    expect(Number(currentOverview.coverage?.coverageRatio),
      "B1 coverage must be at or above redline before enabling Genesis")
      .toBeGreaterThanOrEqual(Number(currentOverview.coverage?.redlinePct));
  }
  await putOk(page, "/api/admin/emergency/kill-switches/genesis", {
    enabled: before.genesis.enabled ? "enabled" : "disabled",
    operator: maker.username,
    reason: `${RUN_ID} independent finally restore Genesis`,
  }, `${RUN_ID}-independent-finally-genesis-${Date.now()}`);
  actions.push({ target: "J1/J4 Genesis", from: current, to: before.genesis });
}

async function captureSnapshot(page: Page): Promise<RecoverySnapshot> {
  const geo = await geoOverview(page);
  const tamper = await tamperOverview(page);
  const killSwitch = await killSwitchOverview(page);
  return {
    runId: RUN_ID,
    capturedAt: new Date().toISOString(),
    geo: {
      blocked: countryCodes(geo.blocked),
      limited: countryCodes(geo.limited),
      endpoints: geo.endpoints
        .map((endpoint) => ({
          key: endpoint.key,
          source: endpoint.source,
          countries: sorted(endpoint.countries),
          configurable: endpoint.configurable,
        }))
        .sort((left, right) => left.key.localeCompare(right.key)),
      edgeSource: geo.edge.source,
    },
    tamper: {
      threshold: tamper.alertConfig.threshold,
      feedK4: tamper.alertConfig.feedK4,
    },
    genesis: genesisFrom(killSwitch),
  };
}

async function geoOverview(page: Page) {
  return getOk<GeoOverview>(await page.request.get("/api/admin/emergency/geo-block"));
}

async function tamperOverview(page: Page) {
  return getOk<TamperOverview>(
    await page.request.get("/api/admin/emergency/tamper/overview?window=24h&accountPage=1&accountPageSize=5"),
  );
}

async function killSwitchOverview(page: Page) {
  return getOk<KillSwitchOverview>(await page.request.get("/api/admin/emergency/kill-switches"));
}

function genesisFrom(overview: KillSwitchOverview) {
  const genesis = overview.activeGates.find((gate) => gate.key === "genesis");
  expect(genesis, "J1 must return the Genesis gate").toBeTruthy();
  return {
    enabled: Boolean(genesis!.enabled),
    emergency: Boolean(genesis!.emergency),
  };
}

async function putOk(page: Page, url: string, data: unknown, idempotencyKey: string) {
  const response = await page.request.put(url, {
    headers: { "Idempotency-Key": idempotencyKey },
    data,
  });
  await getOk(response);
}

async function getOk<T>(response: APIResponse): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(300);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  expect(payload.data, raw).not.toBeUndefined();
  return payload.data!;
}

async function loginVisible(page: Page, account: Account) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
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
    await otp.fill(currentTotp(account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as Envelope<unknown> | null;
    const hasAuthCookie = (await page.context().cookies())
      .some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasAuthCookie)) {
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
      return;
    }
    if (attempt === 0 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.context().clearCookies();
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`J independent recovery MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error("J independent recovery did not reach the authenticated shell");
}

async function waitForFreshTotp(page: Page) {
  const remaining = 30_000 - (Date.now() % 30_000);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function countryCodes(values: Array<{ cc: string }>) {
  return sorted(values.map((value) => value.cc.toUpperCase()));
}

function sorted(values: string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function same(left: string[], right: string[]) {
  return JSON.stringify(sorted(left)) === JSON.stringify(sorted(right));
}

function safeKey(value: string) {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}
