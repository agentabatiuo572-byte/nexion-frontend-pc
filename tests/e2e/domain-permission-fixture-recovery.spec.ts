import { createHmac, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

/**
 * Explicitly enabled, recoverable fixture lifecycle for a single acceptance run.
 * It intentionally has no credential, Run ID, or historical-path defaults.
 */
const ROLES = ["maker", "readonly", "nowrite", "nomenu"] as const;
const EXISTING_DOMAINS = ["A", "B", "C", "D", "E"] as const;
const REBUILD_DOMAINS = ["F", "G", "H", "I", "J", "K", "L", "M"] as const;
const DOMAINS = [...EXISTING_DOMAINS, ...REBUILD_DOMAINS] as const;
type RoleKey = (typeof ROLES)[number];
type Domain = (typeof DOMAINS)[number];

type Account = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  authorities: string[];
  effectiveMenus: string[];
};
type Checker = Pick<Account, "username" | "password" | "totpSecret">;
type RetiredAccount = Pick<AccountRow, "id" | "username">;
type Manifest = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  status?: "ready";
  checker: Checker;
  accounts: Record<RoleKey, Account>;
  cleanup: Array<{ accountId: string; username: string; role: string; action: string }>;
};
type RecoveryProgress = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  accounts: Partial<Record<Domain, Partial<Record<RoleKey, Account>>>>;
};
type AccountRow = {
  id: string | number;
  username: string;
  status: string;
  version: string | number;
  role?: string;
  sessions?: string | number;
  tfa?: boolean;
};

test.describe.configure({ mode: "serial", timeout: 600_000 });

test("显式启用时：续跑 A-E、CAS 退役 F maker，顺序建全 G-M 并一次性 ready", async ({ page }) => {
  test.skip(process.env.DOMAIN_PERMISSION_FIXTURE_RECOVERY !== "1", "set DOMAIN_PERMISSION_FIXTURE_RECOVERY=1 to permit fixture writes");
  const config = readConfig();
  const continuation = await loadContinuation(config);
  const progress = await loadRecoveryProgress(config);

  await login(page, config.baseUrl, config.operator, config.operatorPassword);
  const retired = await retireFmaker(page, config, continuation.retiredFmaker);
  await assertRetiredAuthenticationBarrier(page, continuation.retiredFmaker);
  await login(page, config.baseUrl, config.operator, config.operatorPassword);

  const manifests = { ...continuation.existing } as Partial<Record<Domain, Manifest>>;
  for (const domain of REBUILD_DOMAINS) {
    manifests[domain] = await rebuildDomain(page, config, domain, continuation.checker, continuation.roleTemplates, progress);
  }
  const ready = await persistReadySet(config, manifests as Record<Domain, Manifest>, retired);
  expect(Object.values(ready).flatMap((manifest) => Object.values(manifest.accounts))).toHaveLength(52);
});

function readConfig() {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be explicitly provided; this recovery harness has no historical defaults`);
    return value;
  };
  const baseUrl = required("DOMAIN_PERMISSION_FIXTURE_BASE_URL");
  const parsed = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("fixture recovery only permits a loopback admin endpoint");
  }
  const restrictedRoot = path.resolve(required("DOMAIN_PERMISSION_FIXTURE_RESTRICTED_ROOT"));
  if (!/bug-pic[\\/]\.restricted/i.test(restrictedRoot)) {
    throw new Error("DOMAIN_PERMISSION_FIXTURE_RESTRICTED_ROOT must be under bug-pic/.restricted");
  }
  return {
    baseUrl,
    runId: required("DOMAIN_PERMISSION_FIXTURE_RUN_ID"),
    restrictedRoot,
    operator: required("DOMAIN_PERMISSION_FIXTURE_OPERATOR"),
    operatorPassword: required("DOMAIN_PERMISSION_FIXTURE_OPERATOR_PASSWORD"),
    finalPassword: required("DOMAIN_PERMISSION_FIXTURE_ACCOUNT_PASSWORD"),
    evidenceDir: path.resolve(required("DOMAIN_PERMISSION_FIXTURE_EVIDENCE_DIR")),
  };
}

async function loadContinuation(config: ReturnType<typeof readConfig>) {
  const directory = path.join(config.restrictedRoot, "A", "domain-permission-fixtures");
  const global = JSON.parse(await readFile(
    path.join(config.restrictedRoot, "A", "permission-fixtures", "permission-fixtures.json"), "utf8",
  )) as { runId?: string; checker?: Checker; accounts?: Partial<Record<RoleKey, Account>> };
  if (global.runId !== config.runId || !global.checker?.username || !global.checker.password || !global.checker.totpSecret) {
    throw new Error("global checker must exist in the same Run before continuing domain fixtures");
  }
  const roleTemplates = {} as Record<RoleKey, string>;
  for (const role of ROLES) {
    const template = global.accounts?.[role];
    assertAccount(template, `global.${role} template`);
    roleTemplates[role] = template.role;
  }

  const existing = {} as Record<Domain, Manifest>;
  for (const domain of EXISTING_DOMAINS) {
    const raw = JSON.parse(await readFile(path.join(directory, `${domain}.json`), "utf8")) as Partial<Manifest>;
    if (raw.runId !== config.runId || !raw.accounts) throw new Error(`${domain}.json is not from the requested run`);
    for (const key of ROLES) assertAccount(raw.accounts[key], `${domain}.${key}`);
    existing[domain] = {
      sensitive: true,
      doNotUpload: true,
      runId: config.runId,
      checker: raw.checker ?? global.checker,
      accounts: raw.accounts as Record<RoleKey, Account>,
      cleanup: raw.cleanup ?? [],
    };
  }
  const cleanup = JSON.parse(await readFile(path.join(directory, "cleanup-manifest.json"), "utf8")) as {
    runId?: string;
    accounts?: Array<{ domain?: string; type?: string; accountId?: string | number; username?: string }>;
  };
  const maker = cleanup.accounts?.find((account) => account.domain === "F" && account.type === "maker");
  if (cleanup.runId !== config.runId || !maker?.accountId || !maker.username) {
    throw new Error("cleanup manifest must contain the existing F maker identity; F.json is intentionally not required");
  }
  return {
    existing,
    checker: global.checker,
    roleTemplates,
    retiredFmaker: { id: maker.accountId, username: maker.username },
  };
}

async function retireFmaker(page: Page, config: ReturnType<typeof readConfig>, maker: RetiredAccount) {
  const accountId = String(maker.id);
  const initial = await accountById(page, accountId);
  const reason = `${config.runId} recovery: retire compromised F maker before rebuild`;
  if (initial.status.toLowerCase() !== "disabled") {
    throw new Error("F maker must already be disabled by the separately recorded A-002 CAS probe; recovery refuses to repeat a status mutation");
  }

  // The interrupted first setup assigned the maker template's effective super role.
  // A1 correctly forbids force-logout against any super target, so remove that dormant
  // privilege first with the same fresh-version contract used by the product.
  if (initial.role?.toLowerCase() === "super") {
    const demote = await accountMutation(page, accountId, "PATCH", "role", {
      role: "unassigned",
      operator: config.operator,
      reason,
      expectedVersion: String(initial.version),
    }, "f-maker-demote");
    expect(demote.status).toBe(200);
    expect((await accountById(page, accountId)).role).toBe("unassigned");
  }

  let current = await accountById(page, accountId);
  if (Number(current.sessions) > 0) {
    const revokeVersion = String(current.version);
    const revoke = await accountMutation(page, accountId, "POST", "sessions/revoke", {
      operator: config.operator,
      reason,
      expectedVersion: revokeVersion,
    }, `${config.runId}:f-maker-revoke:v${revokeVersion}`);
    expect(revoke.status).toBe(200);
    current = await accountById(page, accountId);
  }

  if (current.tfa) {
    const resetVersion = String(current.version);
    const reset = await accountMutation(page, accountId, "POST", "reset-2fa", {
      operator: config.operator,
      reason,
      expectedVersion: resetVersion,
    }, `${config.runId}:f-maker-reset-2fa:v${resetVersion}`);
    expect(reset.status).toBe(200);
  }
  return { accountId, username: maker.username, initialVersion: initial.version, finalVersion: (await accountById(page, accountId)).version };
}

async function rebuildDomain(
  page: Page,
  config: ReturnType<typeof readConfig>,
  domain: (typeof REBUILD_DOMAINS)[number],
  checker: Checker,
  roleTemplates: Record<RoleKey, string>,
  progress: RecoveryProgress,
): Promise<Manifest> {
  const accounts = { ...(progress.accounts[domain] ?? {}) } as Partial<Record<RoleKey, Account>>;
  for (const roleKey of ROLES) {
    if (accounts[roleKey]) {
      assertAccount(accounts[roleKey], `${domain}.${roleKey} recovery progress`);
      continue;
    }
    // The activation step intentionally changes the browser session to the new account;
    // restore the declared operator before every subsequent A1 creation.
    await login(page, config.baseUrl, config.operator, config.operatorPassword);
    const nonce = randomBytes(6).toString("hex");
    const username = `acc_${domain.toLowerCase()}_${roleKey}_${nonce}`.slice(0, 32);
    const created = await envelope<{ id: string | number; temporaryPassword?: string }>(await page.request.post("/api/admin/platform/accounts", {
      headers: { "Idempotency-Key": `${config.runId}:${domain}:${roleKey}:create:${nonce}` },
      data: {
        username,
        displayName: `${config.runId} ${domain} ${roleKey} recovery fixture`,
        email: `${domain.toLowerCase()}.${roleKey}.${nonce}@nexion.invalid`,
        role: roleTemplates[roleKey],
        operator: config.operator,
        reason: `${config.runId} recovery rebuild ${domain}.${roleKey}`,
      },
    }));
    if (!created.temporaryPassword) throw new Error(`${domain}.${roleKey} creation returned no one-time password`);
    accounts[roleKey] = await activateAndSnapshot(page, config, String(created.id), username, created.temporaryPassword, roleTemplates[roleKey]);
    progress.accounts[domain] = { ...(progress.accounts[domain] ?? {}), [roleKey]: accounts[roleKey] };
    await persistRecoveryProgress(config, progress);
  }
  for (const roleKey of ROLES) assertAccount(accounts[roleKey], `${domain}.${roleKey} recovery completion`);
  const completeAccounts = accounts as Record<RoleKey, Account>;
  return {
    sensitive: true,
    doNotUpload: true,
    runId: config.runId,
    checker,
    accounts: completeAccounts,
    cleanup: Object.values(completeAccounts).map((account) => ({
      accountId: account.accountId,
      username: account.username,
      role: account.role,
      action: "fresh CAS: disable, revoke sessions, reset 2FA; then verify login denial",
    })),
  };
}

async function loadRecoveryProgress(config: ReturnType<typeof readConfig>): Promise<RecoveryProgress> {
  const file = path.join(config.restrictedRoot, "A", "domain-permission-fixtures", "recovery-progress.json");
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as RecoveryProgress;
    if (parsed.runId !== config.runId || !parsed.accounts) throw new Error("recovery progress belongs to another run");
    for (const [domain, accounts] of Object.entries(parsed.accounts)) {
      if (!DOMAINS.includes(domain as Domain)) throw new Error(`unknown recovery progress domain ${domain}`);
      for (const [role, account] of Object.entries(accounts ?? {})) {
        if (!ROLES.includes(role as RoleKey)) throw new Error(`unknown recovery progress role ${domain}.${role}`);
        assertAccount(account, `${domain}.${role} recovery progress`);
      }
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { sensitive: true, doNotUpload: true, runId: config.runId, accounts: {} };
  }
}

async function persistRecoveryProgress(config: ReturnType<typeof readConfig>, progress: RecoveryProgress) {
  const directory = path.join(config.restrictedRoot, "A", "domain-permission-fixtures");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "recovery-progress.json"), `${JSON.stringify(progress, null, 2)}\n`, "utf8");
}

async function activateAndSnapshot(
  page: Page,
  config: ReturnType<typeof readConfig>,
  accountId: string,
  username: string,
  temporaryPassword: string,
  role: string,
) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginPayload = await (await loginResponse).json() as { data?: { mfa?: { manualKey?: string } } };
  const secret = loginPayload.data?.mfa?.manualKey?.trim();
  if (!secret) throw new Error(`${username} did not receive an enrollment TOTP secret`);

  let passwordChanged = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await page.locator("aside").isVisible().catch(() => false)) break;
    const passwordHeading = page.getByRole("heading", { name: "首次登录修改密码" });
    if (!passwordChanged && await passwordHeading.isVisible().catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(config.finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(config.finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      passwordChanged = true;
    }
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible().catch(() => false)) {
      const code = await freshTotp(secret);
      if (await page.locator("aside").isVisible().catch(() => false)) break;
      if (!(await otp.isVisible().catch(() => false))) continue;
      await otp.fill(code);
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    await page.waitForTimeout(250);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  expect(passwordChanged, `${username} must complete its first-login password change`).toBe(true);

  const session = await envelope<{ session?: { authorities?: string[]; effectiveMenus?: Array<string | { menuCode?: string }> } }>(
    await page.request.get("/api/admin/auth/session"),
  );
  return {
    accountId,
    username,
    password: config.finalPassword,
    totpSecret: secret,
    role,
    authorities: session.session?.authorities ?? [],
    effectiveMenus: (session.session?.effectiveMenus ?? []).map((menu) => typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean),
  };
}

async function persistReadySet(
  config: ReturnType<typeof readConfig>,
  manifests: Record<Domain, Manifest>,
  retired: Record<string, unknown>,
) {
  const directory = path.join(config.restrictedRoot, "A", "domain-permission-fixtures");
  const ready = {} as Record<Domain, Manifest>;
  for (const domain of DOMAINS) {
    ready[domain] = { ...manifests[domain], status: "ready" };
    for (const role of ROLES) assertAccount(manifests[domain].accounts[role], `${domain}.${role}`);
    if (!manifests[domain].checker.username || !manifests[domain].checker.password || !manifests[domain].checker.totpSecret) {
      throw new Error(`${domain} lacks the original global checker; refusing partial ready state`);
    }
  }
  await mkdir(directory, { recursive: true });
  for (const domain of DOMAINS) {
    await writeFile(path.join(directory, `${domain}.json`), `${JSON.stringify(ready[domain], null, 2)}\n`, "utf8");
  }
  await writeFile(path.join(directory, "cleanup-manifest.json"), `${JSON.stringify({
    sensitive: true,
    doNotUpload: true,
    runId: config.runId,
    retired,
    accounts: DOMAINS.flatMap((domain) => ROLES.map((role) => ({ domain, type: role, ...pickCleanup(ready[domain].accounts[role]) }))),
    restoreOrder: ["fresh account version", "disable", "revoke sessions", "reset 2FA", "assert login denied"],
  }, null, 2)}\n`, "utf8");
  await mkdir(config.evidenceDir, { recursive: true });
  await writeFile(path.join(config.evidenceDir, "fixture-recovery-ready.json"), `${JSON.stringify({ runId: config.runId, domains: DOMAINS, retired }, null, 2)}\n`, "utf8");
  return ready;
}

async function assertRetiredAuthenticationBarrier(page: Page, maker: RetiredAccount) {
  // The cleanup manifest deliberately has no retired password or TOTP secret.  Do not invent
  // either credential: a disabled account with all sessions revoked is the server-side login barrier.
  const current = await accountById(page, String(maker.id));
  expect(current.status.toLowerCase(), "retired maker status").toBe("disabled");
  expect(Number(current.sessions), "retired maker must not retain active sessions").toBe(0);
}

async function accountById(page: Page, accountId: string) {
  const overview = await envelope<{ operators: AccountRow[] }>(await page.request.get("/api/admin/platform/accounts/overview"));
  const found = overview.operators.find((account) => String(account.id) === accountId);
  expect(found, `account ${accountId} must remain addressable for a fresh CAS version`).toBeTruthy();
  return found!;
}

async function accountMutation(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: "status" | "role" | "sessions/revoke" | "reset-2fa",
  data: Record<string, string>,
  key: string,
) {
  const response = await page.request.fetch(`/api/admin/platform/accounts/${encodeURIComponent(accountId)}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": key },
    data,
  });
  return { status: response.status(), body: await response.text() };
}

async function envelope<T>(response: APIResponse) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as { code?: number; data?: T };
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

async function login(page: Page, baseUrl: string, username: string, password: string) {
  // Never infer the active operator from a visible shell: the previous step may
  // have authenticated a newly created fixture. Always establish the declared
  // operator session explicitly before privileged A1 work.
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 30_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

const totpSteps = new Map<string, number>();
async function freshTotp(secret: string) {
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  const current = Math.floor(Date.now() / 30_000);
  const previous = totpSteps.get(normalized) ?? -1;
  if (current <= previous || 30_000 - (Date.now() % 30_000) <= 4_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000, intervals: [250] })
      .toBeGreaterThan(Math.max(current, previous));
  }
  const step = Math.floor(Date.now() / 30_000);
  totpSteps.set(normalized, step); // keyed by secret: different accounts never share a 30-second lock.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...normalized].map((character) => {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
    return index.toString(2).padStart(5, "0");
  }).join("");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function assertAccount(account: Account | undefined, label: string): asserts account is Account {
  if (!account?.accountId || !account.username || !account.password || !account.totpSecret || !account.role) {
    throw new Error(`${label} is incomplete; refusing ready state`);
  }
}

function pickCleanup(account: Account) {
  return { accountId: account.accountId, username: account.username, role: account.role };
}
