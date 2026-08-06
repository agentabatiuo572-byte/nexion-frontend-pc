import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const RUN_ID = process.env.H_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const CHECKER_FIXTURE_PATH = process.env.H_CHECKER_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/H.json`;
const EVIDENCE_DIR = process.env.H3_CAS_EVIDENCE_DIR?.trim();
const CONFIG_KEY = "promoBanner.countdownDays";

type Account = { username: string; password: string; totpSecret: string };
type AuditOverview = { events?: Array<Record<string, unknown>>; records?: Array<Record<string, unknown>> };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("H3 两名运营员基于同一旧值并发提交时只允许一个成功，随后精确恢复", async ({ browser, page }) => {
  const { maker, secondWriter: checker } = loadActors();
  await loginMfa(page, maker);
  const checkerContext = await browser.newContext();
  const checkerPage = await checkerContext.newPage();
  await loginMfa(checkerPage, checker);

  const before = await getH3(page);
  const oldValue = Number(before.promoBanner?.countdownDays);
  expect(Number.isInteger(oldValue) && oldValue >= 0 && oldValue <= 365).toBe(true);
  const valueA = oldValue >= 364 ? oldValue - 1 : oldValue + 1;
  const valueB = oldValue >= 363 ? oldValue - 2 : oldValue + 2;
  const body = (value: number, operator: string) => ({
    key: CONFIG_KEY,
    value: String(value),
    expectedValue: String(oldValue),
    reason: `${RUN_ID} H3 双运营员 CAS 对抗验收`,
    operator,
  });
  const attemptId = Date.now();
  const casKeyA = `${RUN_ID}-H3-CAS-A-${attemptId}`;
  const casKeyB = `${RUN_ID}-H3-CAS-B-${attemptId}`;
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    attemptId,
    casKeyA,
    casKeyB,
  };

  try {
    const [first, second] = await Promise.all([
      browserApi(page, "PATCH", `/api/admin/growth/quest-events/config/${CONFIG_KEY}`, body(valueA, maker.username), casKeyA),
      browserApi(checkerPage, "PATCH", `/api/admin/growth/quest-events/config/${CONFIG_KEY}`, body(valueB, checker.username), casKeyB),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 422]);
    const rejected = first.status === 422 ? first : second;
    expect(rejected.raw).toContain("QUEST_CONFIG_STALE");
    const winner = first.status === 200 ? valueA : valueB;
    evidence.cas = {
      firstStatus: first.status,
      secondStatus: second.status,
      winnerKey: first.status === 200 ? casKeyA : casKeyB,
      loserKey: first.status === 422 ? casKeyA : casKeyB,
      winnerValue: winner,
      loserResponseContainsStale: true,
    };
    persistEvidence(evidence);
    await expect.poll(async () => Number((await getH3(page)).promoBanner?.countdownDays)).toBe(winner);

    const audit = await getEnvelope<AuditOverview>(
      page,
      `/api/admin/platform/audit/overview?domain=H&object=${encodeURIComponent("countdownDays")}`,
    );
    expect(JSON.stringify(audit)).toContain(RUN_ID);
    const events = await page.request.get("/api/admin/platform/events/overview");
    expect(events.status(), "H-only maker must fail closed on cross-domain A4 raw endpoint").toBe(403);

    const unknownValue = winner >= 363 ? winner - 3 : winner + 3;
    const unknownKey = `${RUN_ID}-H3-UNKNOWN-${attemptId}`;
    const unknownBody = {
      key: CONFIG_KEY,
      value: String(unknownValue),
      expectedValue: String(winner),
      reason: `${RUN_ID} H3 结果未知后按服务端事实恢复`,
      operator: maker.username,
    };
    const carrierOutcome = await browserUnknown(
      page,
      `/api/admin/growth/quest-events/config/${CONFIG_KEY}`,
      unknownBody,
      unknownKey,
    );
    expect(["unknown", "200"]).toContain(carrierOutcome);
    await expect.poll(async () => Number((await getH3(page)).promoBanner?.countdownDays)).toBe(unknownValue);
    const replay = await browserApi(page, "PATCH", `/api/admin/growth/quest-events/config/${CONFIG_KEY}`, unknownBody, unknownKey);
    expect(replay.status, replay.raw).toBe(200);
    expect(Number((await getH3(page)).promoBanner?.countdownDays)).toBe(unknownValue);
    evidence.resultUnknown = {
      key: unknownKey,
      carrierOutcome,
      replayStatus: replay.status,
      finalValue: unknownValue,
    };
    persistEvidence(evidence);
  } finally {
    const current = Number((await getH3(page)).promoBanner?.countdownDays);
    if (current !== oldValue) {
      const restored = await browserApi(page, "PATCH", `/api/admin/growth/quest-events/config/${CONFIG_KEY}`, {
        key: CONFIG_KEY,
        value: String(oldValue),
        expectedValue: String(current),
        reason: `${RUN_ID} H3 CAS 验收结束恢复原值`,
        operator: maker.username,
      }, `${RUN_ID}-H3-CAS-RESTORE-${Date.now()}`);
      expect(restored.status, restored.raw).toBe(200);
    }
    await expect.poll(async () => Number((await getH3(page)).promoBanner?.countdownDays)).toBe(oldValue);
    evidence.restoredValue = oldValue;
    evidence.restored = true;
    persistEvidence(evidence);
    await checkerContext.close();
  }
});

function persistEvidence(evidence: Record<string, unknown>) {
  if (!EVIDENCE_DIR) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(join(EVIDENCE_DIR, "cas-runtime.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function loadActors(): { maker: Account; secondWriter: Account } {
  const fixture = JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as {
    accounts?: { maker?: Account; secondWriter?: Account };
  };
  const maker = fixture.accounts?.maker;
  const secondWriter = fixture.accounts?.secondWriter;
  if (!maker || !secondWriter) throw new Error("H maker and independent H3 secondWriter fixtures are required");
  return { maker, secondWriter };
}

async function loginMfa(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function getH3(page: Page) {
  return getEnvelope<Record<string, any>>(page, "/api/admin/growth/quest-events/tasks");
}

async function getEnvelope<T>(page: Page, apiPath: string) {
  const response = await page.request.get(apiPath);
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const payload = JSON.parse(raw) as { code?: number; data?: T };
  expect(payload.code, raw).toBe(0);
  return payload.data as T;
}

async function browserApi(
  page: Page,
  method: "PATCH",
  apiPath: string,
  body: Record<string, unknown>,
  idempotencyKey: string,
) {
  return page.evaluate(async ({ requestMethod, path, payload, key }) => {
    const response = await fetch(path, {
      method: requestMethod,
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: JSON.stringify(payload),
    });
    return { status: response.status, raw: await response.text() };
  }, { requestMethod: method, path: apiPath, payload: body, key: idempotencyKey });
}

async function browserUnknown(page: Page, apiPath: string, body: Record<string, unknown>, idempotencyKey: string) {
  return page.evaluate(async ({ path, payload, key }) => {
    const request = fetch(path, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify(payload),
    }).then((response) => String(response.status));
    return Promise.race([
      request,
      new Promise<string>((resolve) => setTimeout(() => resolve("unknown"), 1)),
    ]);
  }, { path: apiPath, payload: body, key: idempotencyKey });
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret);
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
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
