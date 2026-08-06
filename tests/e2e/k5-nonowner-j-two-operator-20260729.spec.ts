import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const ROOT_TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim() || "";
const REVIEW_USER_NO = process.env.K5_REVIEW_USER_NO?.trim() || "";
const REVIEW_USER_ID = process.env.K5_REVIEW_USER_ID?.trim() || "";
const EXPECTED_BASELINE = process.env.K5_REVIEW_BASELINE_STATUS?.trim().toLowerCase() || "";
const CHECKER_FIXTURE = process.env.K5_CHECKER_FIXTURE
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/A/permission-fixtures.json";
const SECOND_ACCOUNT_KEY = process.env.K5_SECOND_ACCOUNT_KEY ?? "checker";
const EVIDENCE_DIR = process.env.K5_TWO_OPERATOR_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/K/review-J/k5-two-operator";
const RUN = `K5-J-2OP-${Date.now()}`;

type Envelope<T> = { code?: number; message?: string; data: T };
type CheckerFixture = {
  checker?: { username: string; password: string; totpSecret: string };
  accounts?: Record<string, { username: string; password: string; totpSecret: string }>;
};
type Ticket = { id: string; user: string; st: string; version: number };
type Overview = { tickets: { records: Ticket[] } };

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("K5 两名真实运营员竞争同一裁决，只有一个终态生效并恢复 C4 基线", async ({ browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  expect(process.env.K_INDEPENDENT_FINALLY_TOKEN?.trim(),
    "K_INDEPENDENT_FINALLY_TOKEN is required for the K5 failure-path recovery carrier").toBeTruthy();
  expect(REVIEW_USER_NO, "K5_REVIEW_USER_NO must be a dedicated non-owner fixture").not.toBe("");
  expect(REVIEW_USER_ID, "K5_REVIEW_USER_ID must match the dedicated fixture").not.toBe("");
  expect(["verified", "rejected"], "K5_REVIEW_BASELINE_STATUS must be verified or rejected")
    .toContain(EXPECTED_BASELINE);
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
  let rootLoggedIn = false;
  let activeTicket: Ticket | null = null;
  let baseline = "";

  try {
    await login(rootPage, {
      username: ROOT_USERNAME,
      password: ROOT_PASSWORD,
      totpSecret: ROOT_TOTP_SECRET || undefined,
    });
    rootLoggedIn = true;
    await login(checkerPage, checker!);
    for (const authority of ["risk_k5_ticket_manual", "risk_k5_ticket_pass", "risk_k5_ticket_reject"]) {
      await assertAuthority(rootPage, authority);
      await assertAuthority(checkerPage, authority);
    }
    baseline = await c4Status(rootPage);
    expect(baseline, "K5 dedicated fixture baseline drifted").toBe(EXPECTED_BASELINE);

    const created = await ok<{ manualResult: { ticketId: string } }>(
      await rootPage.request.post("/api/admin/risk/kyc-review/tickets/manual", {
        headers: { "Idempotency-Key": `${RUN}-CREATE` },
        data: { userNo: REVIEW_USER_NO, reason: `${RUN} 创建双运营员竞争工单` },
      }),
    );
    const ticket = await ticketById(rootPage, created.manualResult.ticketId);
    activeTicket = ticket;
    expect(ticket.user).toBe(REVIEW_USER_NO);
    expect(ticket.st).toBe("in-review");

    const [rootDecision, checkerDecision] = await Promise.all([
      decide(rootPage, ticket, "passed", `${RUN} root 通过竞争`, `${RUN}-ROOT`),
      decide(checkerPage, ticket, "rejected", `${RUN} checker 驳回竞争`, `${RUN}-CHECKER`),
    ]);
    expect([rootDecision.status(), checkerDecision.status()].sort()).toEqual([200, 409]);

    const terminal = await ticketById(rootPage, ticket.id);
    activeTicket = terminal;
    const winningOperator = rootDecision.status() === 200 ? ROOT_USERNAME : checker!.username;
    const winningState = rootDecision.status() === 200 ? "passed" : "rejected";
    expect(terminal.st).toBe(winningState);
    const expectedC4 = winningState === "passed" ? "verified" : "rejected";
    expect(await c4Status(rootPage)).toBe(expectedC4);

    const restoreTicket = await restoreBaseline(rootPage, baseline, `${RUN}-NORMAL-RESTORE`);
    activeTicket = restoreTicket;
    expect(await c4Status(rootPage)).toBe(baseline);

    writeFileSync(path.join(EVIDENCE_DIR, "k5-two-operator-result.json"), JSON.stringify({
      run: RUN,
      ticketId: ticket.id,
      statuses: {
        root: rootDecision.status(),
        checker: checkerDecision.status(),
      },
      winningOperator,
      winningState,
      restoreTicketId: restoreTicket.id,
      baselineC4: baseline,
      finalC4: baseline,
    }, null, 2));
  } finally {
    if (rootLoggedIn) {
      const openTickets = await ticketsForUser(rootPage, REVIEW_USER_NO)
        .then((tickets) => tickets.filter((ticket) => ticket.st === "in-review"));
      for (const openTicket of openTickets) {
        const recovered = await decide(
          rootPage,
          openTicket,
          baseline === "rejected" ? "rejected" : "passed",
          `${RUN} independent finally close open ticket`,
          `${RUN}-FINALLY-CLOSE-${openTicket.id}`,
        );
        expect(recovered.status(), await recovered.text()).toBe(200);
        activeTicket = await ticketById(rootPage, openTicket.id);
      }
      const current = await c4Status(rootPage);
      if (baseline && current !== baseline) {
        activeTicket = await restoreBaseline(rootPage, baseline, `${RUN}-INDEPENDENT-FINALLY`);
      }
      if (baseline) expect(await c4Status(rootPage), "K5 finally must restore exact C4 baseline").toBe(baseline);
      if (activeTicket) {
        expect((await ticketById(rootPage, activeTicket.id)).st, "K5 finally must not leave an open ticket")
          .not.toBe("in-review");
      }
      expect((await ticketsForUser(rootPage, REVIEW_USER_NO)).filter((ticket) => ticket.st === "in-review"),
        "K5 finally must close every Run-dedicated open ticket").toEqual([]);
      writeFileSync(path.join(EVIDENCE_DIR, "k5-independent-finally.json"), JSON.stringify({
        run: RUN,
        baseline,
        finalC4: baseline ? await c4Status(rootPage) : "not-captured",
        activeTicketId: activeTicket?.id ?? null,
        activeTicketState: activeTicket?.st ?? null,
        tokenPersisted: false,
      }, null, 2));
    }
    await rootContext.close();
    await checkerContext.close();
  }
});

async function restoreBaseline(page: Page, baseline: string, keyPrefix: string) {
  const restoreCreated = await ok<{ manualResult: { ticketId: string } }>(
    await page.request.post("/api/admin/risk/kyc-review/tickets/manual", {
      headers: { "Idempotency-Key": `${keyPrefix}-CREATE` },
      data: { userNo: REVIEW_USER_NO, reason: `${RUN} restore exact C4 baseline ${baseline}` },
    }),
  );
  const restoreTicket = await ticketById(page, restoreCreated.manualResult.ticketId);
  const restoreResponse = await decide(
    page,
    restoreTicket,
    baseline === "rejected" ? "rejected" : "passed",
    `${RUN} restore C4 ${baseline} baseline`,
    `${keyPrefix}-DECIDE`,
  );
  expect(restoreResponse.status(), await restoreResponse.text()).toBe(200);
  return ticketById(page, restoreTicket.id);
}

function decide(
  page: Page,
  ticket: Ticket,
  decision: "passed" | "rejected",
  reason: string,
  commandKey: string,
) {
  return page.request.post(`/api/admin/risk/kyc-review/tickets/${encodeURIComponent(ticket.id)}/decision`, {
    headers: { "Idempotency-Key": commandKey },
    data: {
      decision,
      expectedVersion: ticket.version,
      reasonCode: decision === "rejected" ? "KYC_MATERIAL_INVALID" : undefined,
      reason,
    },
  });
}

async function ticketById(page: Page, ticketId: string) {
  const overview = await ok<Overview>(
    await page.request.get("/api/admin/risk/kyc-review/overview?ticketPageNum=1&ticketPageSize=50"),
  );
  const ticket = overview.tickets.records.find((candidate) => candidate.id === ticketId);
  expect(ticket, `K5 ticket ${ticketId}`).toBeTruthy();
  return ticket!;
}

async function ticketsForUser(page: Page, userNo: string) {
  const overview = await ok<Overview>(
    await page.request.get("/api/admin/risk/kyc-review/overview?ticketPageNum=1&ticketPageSize=100"),
  );
  return overview.tickets.records.filter((candidate) => candidate.user === userNo);
}

async function c4Status(page: Page) {
  const value = await ok<{ status: string }>(
    await page.request.get(`/api/admin/users/kyc/users/${REVIEW_USER_ID}`),
  );
  return value.status;
}

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
  const session = await ok<{ session?: { authorities?: string[] } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  expect(session.session?.authorities ?? []).toContain(authority);
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
