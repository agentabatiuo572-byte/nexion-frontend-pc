import { createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Browser, type Page } from "@playwright/test";

const SUPERADMIN = {
  username: process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin",
  password: (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()),
};
const FIXTURE_PATH = process.env.A_PERMISSION_FIXTURE_PATH;
const EVIDENCE_DIR = process.env.B_EVIDENCE_DIR;
const RUN_TOKEN = "pc-full-acceptance-20260728-151023";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  checker?: FixtureAccount;
  accounts?: { d_checker?: FixtureAccount };
};

test("B2 双运营员 CAS、幂等回放、异载荷拒绝并恢复原配置", async ({ browser }) => {
  if (!FIXTURE_PATH) throw new Error("A_PERMISSION_FIXTURE_PATH is required");
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as PermissionFixture;
  const checkerAccount = resolveChecker(fixture);

  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  try {
    await Promise.all([
      login(maker, SUPERADMIN),
      login(checker, checkerAccount),
    ]);
    await assertForecastWriteAuthority(checker, checkerAccount.username);

    const baselineResponse = await maker.request.get("/api/admin/treasury/forecast-config");
    const baseline = await apiEvidence(baselineResponse);
    expect(baseline.status).toBe(200);
    const initialVersion = Number(baseline.body?.data?.version);
    expect(Number.isSafeInteger(initialVersion)).toBe(true);
    const original = candidateConfig(baseline.body?.data);
    const changed = { ...original, trialStressEnabled: !original.trialStressEnabled };

    const makerKey = `b2-cas-maker-${RUN_TOKEN}`;
    const checkerKey = `b2-cas-checker-${RUN_TOKEN}`;
    const makerBody = {
      ...changed,
      expectedVersion: initialVersion,
      reason: "B2 CAS maker acceptance forward change",
      operator: SUPERADMIN.username,
    };
    const checkerBody = {
      ...changed,
      expectedVersion: initialVersion,
      reason: "B2 CAS checker acceptance competing change",
      operator: checkerAccount.username,
    };

    const [makerResponse, checkerResponse] = await Promise.all([
      maker.request.put("/api/admin/treasury/forecast-config", {
        headers: keyed(makerKey),
        data: makerBody,
      }),
      checker.request.put("/api/admin/treasury/forecast-config", {
        headers: keyed(checkerKey),
        data: checkerBody,
      }),
    ]);
    const makerResult = await apiEvidence(makerResponse);
    const checkerResult = await apiEvidence(checkerResponse);
    expect([makerResult.status, checkerResult.status].sort()).toEqual([200, 409]);

    const winner = makerResult.status === 200
      ? { page: maker, key: makerKey, body: makerBody, result: makerResult, actor: SUPERADMIN.username }
      : { page: checker, key: checkerKey, body: checkerBody, result: checkerResult, actor: checkerAccount.username };
    const loser = makerResult.status === 409 ? makerResult : checkerResult;
    expect(loser.body?.message).toBe("D3_FORECAST_CONFIG_VERSION_CONFLICT");

    const replay = await apiEvidence(await winner.page.request.put(
      "/api/admin/treasury/forecast-config",
      { headers: keyed(winner.key), data: winner.body },
    ));
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(winner.result.body);

    const mismatch = await apiEvidence(await winner.page.request.put(
      "/api/admin/treasury/forecast-config",
      {
        headers: keyed(winner.key),
        data: { ...winner.body, reason: `${winner.body.reason} changed payload` },
      },
    ));
    expect(mismatch.status).toBe(409);
    expect(mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

    const afterForward = await apiEvidence(await maker.request.get("/api/admin/treasury/forecast-config"));
    expect(afterForward.status).toBe(200);
    expect(Number(afterForward.body?.data?.version)).toBe(initialVersion + 1);
    expect(candidateConfig(afterForward.body?.data)).toEqual(changed);

    const restoreKey = `b2-cas-restore-${RUN_TOKEN}`;
    const restore = await apiEvidence(await maker.request.put(
      "/api/admin/treasury/forecast-config",
      {
        headers: keyed(restoreKey),
        data: {
          ...original,
          expectedVersion: initialVersion + 1,
          reason: "B2 CAS acceptance exact restoration",
          operator: SUPERADMIN.username,
        },
      },
    ));
    expect(restore.status).toBe(200);
    expect(Number(restore.body?.data?.version)).toBe(initialVersion + 2);

    const finalState = await apiEvidence(await maker.request.get("/api/admin/treasury/forecast-config"));
    expect(finalState.status).toBe(200);
    expect(Number(finalState.body?.data?.version)).toBe(initialVersion + 2);
    expect(candidateConfig(finalState.body?.data)).toEqual(original);

    const evidence = {
      initialVersion,
      original,
      changed,
      concurrent: {
        maker: makerResult,
        checker: checkerResult,
        winnerActor: winner.actor,
      },
      replay,
      mismatch,
      afterForward,
      restore,
      finalState,
      keys: { makerKey, checkerKey, restoreKey },
    };
    if (EVIDENCE_DIR) {
      await mkdir(EVIDENCE_DIR, { recursive: true });
      await writeFile(
        path.join(EVIDENCE_DIR, "b2-live-cas.json"),
        `${JSON.stringify(evidence, null, 2)}\n`,
        "utf8",
      );
    }
  } finally {
    await Promise.all([makerContext.close(), checkerContext.close()]);
  }
});

function resolveChecker(fixture: PermissionFixture): FixtureAccount {
  const checker = fixture.checker ?? fixture.accounts?.d_checker;
  if (!checker?.username || !checker.password || !checker.totpSecret) {
    throw new Error("permission fixture is missing a complete top-level checker or legacy accounts.d_checker");
  }
  if (checker.username === SUPERADMIN.username) {
    throw new Error("checker must be a distinct operator; refusing same-superadmin CAS coverage");
  }
  return checker;
}

async function assertForecastWriteAuthority(page: Page, username: string) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status(), `${username} session`).toBe(200);
  const body = await response.json() as {
    data?: { session?: { authorities?: string[] } };
  };
  const authorities = body.data?.session?.authorities ?? [];
  expect(
    authorities.some((authority) => authority === "finance_d3_write" || authority === "overview_b2_write"),
    `${username} forecast-config write authority`,
  ).toBe(true);
}

function candidateConfig(data: Record<string, any>) {
  const candidate = data?.pendingConfig ?? data;
  return {
    reserveCategories: candidate.reserveCategories,
    liabilityCategories: candidate.liabilityCategories,
    forecastWindow: candidate.forecastWindow,
    genesisIncluded: candidate.genesisIncluded,
    includeFarLiabilities: candidate.includeFarLiabilities,
    stakingInterestMode: candidate.stakingInterestMode,
    trialStressEnabled: candidate.trialStressEnabled,
  };
}

function keyed(idempotencyKey: string) {
  return {
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey,
  };
}

async function apiEvidence(response: APIResponse) {
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status(), body };
}

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret?: string },
) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();

  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 20_000 }),
    otp.waitFor({ state: "visible", timeout: 20_000 }),
  ]);
  if (await shell.isVisible()) return;
  if (!account.totpSecret) throw new Error("TOTP secret is required for this account");
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(shell).toBeVisible({ timeout: 30_000 });
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

async function freshTotp(secret: string) {
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  await new Promise((resolve) => setTimeout(resolve, millisecondsRemaining + 250));
  return currentTotp(secret);
}
