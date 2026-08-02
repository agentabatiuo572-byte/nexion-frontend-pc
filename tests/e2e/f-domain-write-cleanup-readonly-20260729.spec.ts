import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type SessionPayload = {
  session?: {
    username?: string;
    roleCode?: string;
    authorities?: string[];
    effectiveMenus?: Array<string | { code?: string }>;
  };
};
type A2Ticket = {
  id?: string;
  status?: string;
  obj?: string;
  operator?: string;
  sourceDomain?: string;
};
type A2Overview = {
  operationQueue?: A2Ticket[];
  operationHistory?: Array<{ id?: string; st?: string; note?: string }>;
};
type F1Overview = { configValues?: Record<string, string> };

const OPERATION_ID = process.env.F_CLEANUP_OPERATION_ID?.trim() || "";
const EXPECTED_PRIZE = process.env.F_EXPECTED_PRIZE_NAME ?? "Nexion V-Rank";
const EVIDENCE_DIR = process.env.F_CLEANUP_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/F/final-ODaNTve/write-owner/f1-maker-checker/cleanup-readonly";
const A_FIXTURE_PATH = process.env.F_CHECKER_FIXTURE_PATH
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/A/domain-permission-fixtures/A.json";
const fixture = JSON.parse(readFileSync(A_FIXTURE_PATH, "utf8")) as {
  checker?: Account;
  accounts?: { checker?: Account; d_checker?: Account };
};
const checkerAccount = fixture.checker ?? fixture.accounts?.checker ?? fixture.accounts?.d_checker;

test.beforeAll(() => {
  expect(OPERATION_ID, "F_CLEANUP_OPERATION_ID is required").toMatch(/^(?:WO|OP)-/);
  expect(checkerAccount, "independent checker fixture is required").toBeTruthy();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F1 failed write probe cleanup is exact and checker visibility failure is preserved", async ({ browser }) => {
  const checkerContext = await browser.newContext();
  const superContext = await browser.newContext();
  const checker = await checkerContext.newPage();
  const superadmin = await superContext.newPage();
  try {
    await login(checker, checkerAccount!, "checker");
    await loginSuperadmin(superadmin);

    const checkerSession = await ok<SessionPayload>(
      await checker.request.get("/api/admin/auth/session"),
      "checker session",
    );
    const checkerOverview = await ok<A2Overview>(
      await checker.request.get("/api/admin/platform/audit/overview?object=F.prize.name"),
      "checker A2 overview",
    );
    const superOverview = await ok<A2Overview>(
      await superadmin.request.get("/api/admin/platform/audit/overview?object=F.prize.name"),
      "super A2 overview",
    );
    const f1 = await ok<F1Overview>(
      await superadmin.request.get("/api/admin/teams/ranks"),
      "F1 overview",
    );
    const audit = await ok<unknown[]>(
      await superadmin.request.get(
        `/api/admin/platform/audit/logs?object=${encodeURIComponent(OPERATION_ID)}&limit=200`,
      ),
      "A2 audit logs",
    );

    const checkerRows = checkerOverview.operationQueue ?? [];
    const superRows = superOverview.operationQueue ?? [];
    const target = superRows.find((row) => row.id === OPERATION_ID);
    expect(target, "superadmin must see the failed probe operation").toBeTruthy();
    expect(target?.status, "cleanup must leave the probe terminally rejected").toBe("rejected");
    expect(checkerRows.some((row) => row.id === OPERATION_ID), "checker visibility defect must remain reproducible")
      .toBe(false);
    expect(f1.configValues?.["F.prize.name"], "F1 mutable fixture must stay at the exact pre-write value")
      .toBe(EXPECTED_PRIZE);

    const authorities = checkerSession.session?.authorities ?? [];
    const menus = (checkerSession.session?.effectiveMenus ?? []).map((item) =>
      typeof item === "string" ? item : item.code ?? "");
    const evidence = {
      operationId: OPERATION_ID,
      cleanup: {
        terminalStatus: target?.status,
        mutableValueRestoredExact: f1.configValues?.["F.prize.name"] === EXPECTED_PRIZE,
        a2AuditRows: audit.length,
      },
      checker: {
        roleCode: checkerSession.session?.roleCode ?? null,
        hasA2Read: authorities.includes("platform_a2_read"),
        hasA2Approve: authorities.includes("platform_a2_operation_approve"),
        hasA2Menu: menus.some((code) => code === "A2"),
        seesOperation: checkerRows.some((row) => row.id === OPERATION_ID),
      },
      superadmin: {
        seesOperation: true,
        operationStatus: target?.status,
        object: target?.obj ?? null,
      },
    };
    writeFileSync(path.join(EVIDENCE_DIR, "cleanup-readonly.json"), JSON.stringify(evidence, null, 2));
    const platformGroup = checker.getByRole("button", { name: /平台基础\s+A|A\s+平台基础/ }).first();
    const a2Link = checker.locator('a[href="/platform/audit"]').first();
    if (!(await a2Link.isVisible().catch(() => false))) await platformGroup.click();
    await a2Link.click();
    await expect(checker).toHaveURL(/\/platform\/audit$/);
    await checker.reload({ waitUntil: "domcontentloaded" });
    await expect(checker.locator("tbody tr").filter({ hasText: OPERATION_ID })).toHaveCount(0);
    await checker.screenshot({ path: path.join(EVIDENCE_DIR, "checker-a2-filtered.png"), fullPage: true });
  } finally {
    await checkerContext.close();
    await superContext.close();
  }
});

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(process.env.ADMIN_E2E_USERNAME ?? "superadmin");
  await page.locator('input[autocomplete="current-password"]').fill(process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function login(page: Page, account: Account, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    if (await otp.isVisible().catch(() => false)) {
      await otp.fill(await freshTotp(key, account.totpSecret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true).catch(() => false)) return;
  }
  throw new Error(`${key} login failed`);
}

async function ok<T>(response: APIResponse, label: string) {
  const body = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(body)}`).toBe(200);
  expect(body.code, `${label}: ${JSON.stringify(body)}`).toBe(0);
  return body.data as T;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
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
