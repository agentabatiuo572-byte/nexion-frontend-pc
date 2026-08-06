import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ROOT_TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() || "";
const REVIEW_USER_NO = process.env.K4_REVIEW_USER_NO?.trim() || "";
const CHECKER_FIXTURE = process.env.K4_CHECKER_FIXTURE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/A/permission-fixtures.json";
const SECOND_ACCOUNT_KEY = process.env.K4_SECOND_ACCOUNT_KEY ?? "checker";
const EVIDENCE_DIR = process.env.K4_TWO_OPERATOR_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/K/review-J/k4-two-operator";
const RUN = `K4-J-2OP-${Date.now()}`;

type Envelope<T> = { code?: number; message?: string; data: T };
type ScoreUser = {
  userNo: string;
  modelScore: number;
  effectiveScore: number;
  overridden: boolean;
  rowVersion: number;
  history: Array<{ operator: string; reason: string; scoreState: string }>;
};
type CheckerFixture = {
  checker?: { username: string; password: string; totpSecret: string };
  accounts?: Record<string, { username: string; password: string; totpSecret: string }>;
};

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("K4 两名真实运营员同版本竞争仅一人成功，事件落地后精确恢复", async ({ browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(REVIEW_USER_NO, "K4_REVIEW_USER_NO must name the dedicated non-owner fixture").not.toBe("");
  const checkerFixture = JSON.parse(readFileSync(CHECKER_FIXTURE, "utf8")) as CheckerFixture;
  const checker = checkerFixture.accounts?.[SECOND_ACCOUNT_KEY]
    ?? (SECOND_ACCOUNT_KEY === "checker" ? checkerFixture.checker : undefined);
  expect(checker, `second operator ${SECOND_ACCOUNT_KEY}`).toBeTruthy();
  expect(checker!.username).not.toBe(ROOT_USERNAME);
  const rootContext = await browser.newContext({ baseURL: BASE_URL });
  const checkerContext = await browser.newContext({ baseURL: BASE_URL });
  const rootPage = await rootContext.newPage();
  const checkerPage = await checkerContext.newPage();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  let selectedUserNo = "";
  let cleanupComplete = false;

  try {
    await login(rootPage, {
      username: ROOT_USERNAME,
      password: ROOT_PASSWORD,
      totpSecret: ROOT_TOTP_SECRET || undefined,
    });
    await login(checkerPage, checker!);
    const rootOperator = await assertAuthority(rootPage, "risk_k4_user_override");
    await assertAuthority(rootPage, "risk_k4_user_recompute");
    const checkerOperator = await assertAuthority(checkerPage, "risk_k4_user_override");

    const before = await ok<ScoreUser>(
      await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(REVIEW_USER_NO)}`),
    );
    expect(before.overridden, "专属 K4 reviewer fixture 启动前不得有人工覆盖").toBe(false);
    selectedUserNo = before.userNo;

    const scoreA = before.modelScore === 100 ? 99 : before.modelScore + 1;
    const scoreB = scoreA === 100 ? 98 : scoreA + 1;
    const rootReason = `${RUN} root CAS`;
    const checkerReason = `${RUN} checker CAS`;
    const [rootResponse, checkerResponse] = await Promise.all([
      rootPage.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, {
        headers: { "Idempotency-Key": `${RUN}-ROOT` },
        data: { score: scoreA, expectedVersion: before.rowVersion, reason: rootReason },
      }),
      checkerPage.request.post(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/override`, {
        headers: { "Idempotency-Key": `${RUN}-CHECKER` },
        data: { score: scoreB, expectedVersion: before.rowVersion, reason: checkerReason },
      }),
    ]);
    expect([rootResponse.status(), checkerResponse.status()].sort()).toEqual([200, 409]);

    let afterCompetition = await ok<ScoreUser>(
      await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}`),
    );
    expect(afterCompetition.overridden).toBe(true);
    expect(afterCompetition.rowVersion).toBeGreaterThan(before!.rowVersion);
    const winningReason = rootResponse.status() === 200 ? rootReason : checkerReason;
    const winningOperator = rootResponse.status() === 200 ? rootOperator : checkerOperator;
    await expect.poll(async () => {
      afterCompetition = await ok<ScoreUser>(
        await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}`),
      );
      const winnerVisible = afterCompetition.history.some((row) =>
        row.reason === winningReason
        && row.operator === winningOperator
        && row.scoreState === "manually-overridden");
      writeFileSync(path.join(EVIDENCE_DIR, "k4-two-operator-winner-read.json"), JSON.stringify({
        run: RUN,
        statuses: { root: rootResponse.status(), checker: checkerResponse.status() },
        winningReason,
        winningOperator,
        winnerVisible,
        history: afterCompetition.history.map(({ reason, operator, scoreState }) => ({
          reason,
          operator,
          scoreState,
          reasonMatches: reason === winningReason,
          operatorMatches: operator === winningOperator,
          stateMatches: scoreState === "manually-overridden",
        })),
      }, null, 2));
      return winnerVisible;
    }, {
      message: "唯一 winner 的 K4 history 必须在权威读模型中可见",
      timeout: 10_000,
    }).toBe(true);

    const cleanup = await rootPage.request.post(
      `/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}/recompute`,
      {
        headers: { "Idempotency-Key": `${RUN}-RECOMPUTE` },
        data: {
          expectedVersion: afterCompetition.rowVersion,
          reason: `${RUN} 精确恢复模型分`,
        },
      },
    );
    expect(cleanup.status(), await cleanup.text()).toBe(200);
    const restored = await ok<ScoreUser>(
      await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(before.userNo)}`),
    );
    expect(restored.overridden).toBe(false);
    expect(restored.effectiveScore).toBe(restored.modelScore);
    cleanupComplete = true;

    writeFileSync(path.join(EVIDENCE_DIR, "k4-two-operator-result.json"), JSON.stringify({
      run: RUN,
      userNo: before.userNo,
      startingVersion: before.rowVersion,
      statuses: {
        root: rootResponse.status(),
        checker: checkerResponse.status(),
      },
      winningOperator,
      restoredVersion: restored.rowVersion,
      restored: !restored.overridden && restored.effectiveScore === restored.modelScore,
    }, null, 2));
  } finally {
    if (selectedUserNo && !cleanupComplete) {
      const current = await ok<ScoreUser>(
        await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(selectedUserNo)}`),
      );
      if (current.overridden) {
        const recovered = await rootPage.request.post(
          `/api/admin/risk/scoring/users/${encodeURIComponent(selectedUserNo)}/recompute`,
          {
            headers: { "Idempotency-Key": `${RUN}-FINALLY-RECOMPUTE` },
            data: {
              expectedVersion: current.rowVersion,
              reason: `${RUN} 失败路径精确恢复模型分`,
            },
          },
        );
        expect(recovered.status(), await recovered.text()).toBe(200);
      }
      const restored = await ok<ScoreUser>(
        await rootPage.request.get(`/api/admin/risk/scoring/users/${encodeURIComponent(selectedUserNo)}`),
      );
      expect(restored.overridden).toBe(false);
      expect(restored.effectiveScore).toBe(restored.modelScore);
    }
    await rootContext.close();
    await checkerContext.close();
  }
});

async function ok<T>(response: APIResponse): Promise<T> {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data;
}

async function login(
  page: Page,
  account: { username: string; password: string; totpSecret?: string },
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
    expect(account.totpSecret, `TOTP secret is required for ${account.username}`).toBeTruthy();
    const remaining = 30_000 - (Date.now() % 30_000);
    if (remaining < 5_000) await page.waitForTimeout(remaining + 500);
    await otp.fill(currentTotp(account.totpSecret!));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verification;
    expect(verified.status(), await verified.text()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function assertAuthority(page: Page, authority: string) {
  const session = await ok<{ session?: { username?: string; authorities?: string[] } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  expect(session.session?.authorities ?? []).toContain(authority);
  expect(session.session?.username, "认证会话必须返回服务端 canonical username").toBeTruthy();
  return session.session!.username!;
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
