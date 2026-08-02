import { createHash, createHmac } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const FINAL_MANIFEST = process.env.FINAL_FIXTURE_MANIFEST_PATH;

test.describe.configure({ mode: "serial", timeout: 150_000 });

/**
 * Read-only, visible-A1 proof that no Run-scoped fixture account is enabled.
 * No admin endpoint is called directly and this test intentionally has no
 * mutating control path.  The JSON plus screenshot are restricted evidence.
 */
test("A1 visible sentinel: no unexpected ffix account is active", async ({ page }, testInfo) => {
  const fixtureConfig = await finalFixtureConfig();
  const allowedFinalAccounts = fixtureConfig.allowedFinalAccounts;
  await loginForVisibleA1(page, fixtureConfig.bootstrap);
  const link = page.locator("aside").getByRole("link", { name: "运营账号 & RBAC A1", exact: true });
  if (!await link.isVisible().catch(() => false)) await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  await link.click();
  await expect(page).toHaveURL(/\/platform\/rbac$/);
  await page.locator("select.pager-size").selectOption("50");

  const observed: Array<{ username: string; text: string; active: boolean }> = [];
  for (let index = 0; index < 20; index += 1) {
    for (const row of await page.locator("tbody tr").all()) {
      const text = (await row.innerText()).replace(/\s+/g, " ").trim();
      const username = text.match(/ffix\.[A-Za-z0-9._-]+/)?.[0];
      // Column 4 is the authoritative visible state.  The last action column
      // deliberately renders an "启用" button for disabled accounts, so row
      // text cannot be used as a status predicate.
      const status = (await row.locator("td").nth(3).innerText()).trim();
      if (username) observed.push({ username, text, active: status === "启用" });
    }
    const next = page.locator("button.pager-btn").last();
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(100);
  }

  const unexpectedActive = observed.filter((item) => item.active && !allowedFinalAccounts.has(item.username));
  const payload = JSON.stringify({
    runId: "pc-full-acceptance-20260729-114336",
    source: "visible A1 rows only",
    checkedAt: new Date().toISOString(),
    observed,
    activeCount: observed.filter((item) => item.active).length,
    allowedFinalAccounts: [...allowedFinalAccounts].sort(),
    unexpectedActive,
    loginMode: fixtureConfig.bootstrap ? "restricted-bootstrap-mfa" : "admin-env",
  }, null, 2);
  const sha256 = createHash("sha256").update(payload).digest("hex");
  await writeFile(testInfo.outputPath("ffix-active-sentinel.json"), `${payload}\nsha256=${sha256}\n`, "utf8");
  await page.screenshot({ path: testInfo.outputPath("ffix-active-sentinel.png"), fullPage: true });
  expect(unexpectedActive, "A1 可见列表中不得有未列入restricted final manifest的启用 ffix账号").toEqual([]);
});

type BootstrapFixture = { username: string; password: string; totpSecret: string; required?: boolean };

async function finalFixtureConfig() {
  if (!FINAL_MANIFEST) return { allowedFinalAccounts: new Set<string>(), bootstrap: null as BootstrapFixture | null };
  const manifest = JSON.parse(await readFile(FINAL_MANIFEST, "utf8")) as {
    sensitive?: boolean; doNotUpload?: boolean; finalAccounts?: Record<string, { username?: string }>;
    bootstrapCleanup?: BootstrapFixture;
  };
  expect(manifest.sensitive).toBe(true); expect(manifest.doNotUpload).toBe(true);
  expect(manifest.bootstrapCleanup?.required).toBe(true);
  expect(manifest.bootstrapCleanup?.username).toBeTruthy();
  expect(manifest.bootstrapCleanup?.password).toBeTruthy();
  expect(manifest.bootstrapCleanup?.totpSecret).toBeTruthy();
  return {
    allowedFinalAccounts: new Set(Object.values(manifest.finalAccounts ?? {}).map((account) => account.username ?? "").filter(Boolean)),
    bootstrap: manifest.bootstrapCleanup!,
  };
}

async function loginForVisibleA1(page: import("@playwright/test").Page, bootstrap: BootstrapFixture | null) {
  const username = bootstrap?.username ?? required("ADMIN_E2E_USERNAME");
  const password = bootstrap?.password ?? required("ADMIN_E2E_PASSWORD");
  await page.goto("/");
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: "继续", exact: true }).click();
  const otp = page.getByLabel("一次性验证码");
  if (bootstrap) {
    await otp.waitFor({ state: "visible", timeout: 15_000 });
    let previous = "";
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let code = totp(bootstrap.totpSecret);
      while (code === previous) { await page.waitForTimeout(1_100); code = totp(bootstrap.totpSecret); }
      previous = code;
      await otp.fill(code);
      const response = page.waitForResponse((candidate) => candidate.request().method() === "POST" && candidate.url().endsWith("/api/admin/auth/mfa/verify"));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      if ((await response).status() === 200) break;
      await otp.waitFor({ state: "visible", timeout: 10_000 });
    }
  } else {
    await otp.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret.replace(/[^A-Z2-7]/gi, "").toUpperCase()) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(); const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
