import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T> = { code?: number; message?: string; data?: T };
type AccountOverview = {
  operators?: Array<{
    id?: string;
    username?: string;
    role?: string;
    status?: string;
    tfa?: boolean;
    sessions?: number;
  }>;
};

const RUN_ID = process.env.F_WRITE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_PATH = process.env.F_A_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/A.json`;
const EVIDENCE_DIR = process.env.F_SHARED_003_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/reviewer-carrier-diagnostic`;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  accounts?: { maker?: Account };
};

test.use({ trace: "off", video: "off", screenshot: "off" });

test("read-only A1 diagnostic lists current unrestricted reviewer candidates without credentials", async ({ page }) => {
  const maker = fixture.accounts?.maker;
  expect(maker, "A maker fixture is required").toBeTruthy();
  await loginMfa(page, maker!);
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  const body = await response.json() as Envelope<AccountOverview>;
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.code, JSON.stringify(body)).toBe(0);
  const candidates = (body.data?.operators ?? [])
    .filter((operator) => /SUPER|AUDIT|超级|审计/i.test(operator.role ?? ""))
    .map((operator) => ({
      id: operator.id,
      username: operator.username,
      role: operator.role,
      status: operator.status,
      tfa: operator.tfa,
      sessions: operator.sessions,
    }))
    .sort((left, right) => (left.username ?? "").localeCompare(right.username ?? ""));
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, "a1-unrestricted-reviewer-candidates.safe.json"),
    JSON.stringify({
      runId: RUN_ID,
      productBusinessWrites: 0,
      totalOperators: body.data?.operators?.length ?? 0,
      roleCounts: Object.entries(
        (body.data?.operators ?? []).reduce<Record<string, number>>((counts, operator) => {
          const role = operator.role ?? "__MISSING__";
          counts[role] = (counts[role] ?? 0) + 1;
          return counts;
        }, {}),
      ).sort(([left], [right]) => left.localeCompare(right)),
      candidates,
    }, null, 2),
  );
  expect(body.data?.operators?.length).toBeGreaterThan(0);
});

test("read-only candidate login confirms effective reviewer role without persisting credentials", async ({ page }) => {
  const username = process.env.F_A6_REVIEWER_USERNAME ?? "";
  const password = process.env.F_A6_REVIEWER_PASSWORD ?? "";
  expect(username, "candidate username is required").not.toBe("");
  expect(password, "candidate password is required").not.toBe("");
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const sidebar = page.locator("aside");
  await Promise.race([
    otp.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
    sidebar.waitFor({ state: "visible", timeout: 15_000 }).catch(() => undefined),
  ]);
  expect(await otp.isVisible().catch(() => false), "candidate unexpectedly requires MFA").toBe(false);
  await expect(sidebar).toBeVisible({ timeout: 15_000 });
  const response = await page.request.get("/api/admin/auth/session");
  const body = await response.json() as Envelope<{
    session?: { roleCode?: string; authorities?: string[]; effectiveMenus?: unknown[] };
  }>;
  expect(response.status(), JSON.stringify(body)).toBe(200);
  expect(body.code, JSON.stringify(body)).toBe(0);
  const roleCode = body.data?.session?.roleCode ?? "";
  const authorities = body.data?.session?.authorities ?? [];
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    path.join(EVIDENCE_DIR, "a1-reviewer-candidate-session.safe.json"),
    JSON.stringify({
      runId: RUN_ID,
      productBusinessWrites: 0,
      username,
      roleCode,
      authorityCount: authorities.length,
      hasA2Read: authorities.includes("platform_a2_read"),
      hasA2Approve: authorities.includes("platform_a2_operation_approve"),
      hasA6Read: authorities.includes("platform_a6_read"),
      effectiveMenuCount: body.data?.session?.effectiveMenus?.length ?? 0,
    }, null, 2),
  );
  expect(roleCode).toBe("SUPER_ADMIN");
  expect(authorities).toEqual(expect.arrayContaining([
    "platform_a2_read",
    "platform_a2_operation_approve",
    "platform_a6_read",
  ]));
});

async function loginMfa(page: Page, account: Account) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  await otp.fill(currentTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
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
  const offset = digest[digest.length - 1] & 0xf;
  const code = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, "0");
}
