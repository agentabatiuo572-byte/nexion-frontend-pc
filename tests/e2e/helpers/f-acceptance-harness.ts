import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../../lib/nav/console-nav";

export type FAcceptanceAccount = {
  username: string;
  password: string;
  totpSecret: string;
};

type FinalActor = Partial<FAcceptanceAccount> & {
  roleCode?: string;
};

type FPermissionFixture = {
  runId?: string;
  accounts?: {
    maker?: FAcceptanceAccount;
    f_maker?: FAcceptanceAccount;
  };
};

type DedicatedActorsManifest = {
  runId?: string;
  candidate?: {
    buildId?: string;
    jarSha256?: string;
  };
  finalAccounts?: {
    a6_reviewer?: FinalActor;
    f1_checker?: FinalActor;
    f25_checker?: FinalActor;
  };
};

export type FDedicatedActors = {
  fMaker: FAcceptanceAccount;
  fChecker: FAcceptanceAccount;
  f25Checker: FAcceptanceAccount;
  a6Reviewer: FAcceptanceAccount;
  fCheckerRoleCode: string;
  f25CheckerRoleCode: string;
  a6ReviewerRoleCode: string;
  manifestPath: string;
};

export function currentFRunId() {
  return process.env.F_WRITE_RUN_ID
    ?? process.env.F_ACCEPTANCE_RUN_ID
    ?? "pc-full-acceptance-20260729-114336";
}

export function currentFCaseNonce() {
  const configured = process.env.F_ACCEPTANCE_CASE_NONCE?.trim();
  const nonce = configured || randomBytes(8).toString("hex");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,31}$/.test(nonce)) {
    throw new Error("F_ACCEPTANCE_CASE_NONCE must be 8-32 URL-safe characters");
  }
  return nonce;
}

export function fAcceptanceIdempotencyKey(
  runId: string,
  caseNonce: string,
  suffix: string,
) {
  const key = `${runId}-${caseNonce}-${suffix}`;
  if (key.length > 128) {
    throw new Error(`F acceptance idempotency key exceeds 128 characters: ${key.length}`);
  }
  return key;
}

export function currentFFixturePath(runId = currentFRunId()) {
  return process.env.F_PERMISSION_FIXTURE_PATH
    ?? process.env.F_F_FIXTURE_PATH
    ?? `D:/workspace/bug-pic/.restricted/${runId}/A/domain-permission-fixtures/F.json`;
}

export function loadFMaker(runId = currentFRunId()): FAcceptanceAccount {
  const fixturePath = currentFFixturePath(runId);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as FPermissionFixture;
  if (fixture.runId !== runId) {
    throw new Error(`F fixture Run ID mismatch: expected=${runId}, actual=${fixture.runId ?? "missing"}`);
  }
  return requireAccount(
    fixture.accounts?.maker ?? fixture.accounts?.f_maker,
    `F maker in ${fixturePath}`,
  );
}

export function loadFDedicatedActors(runId = currentFRunId()): FDedicatedActors {
  const manifestPath = process.env.F_DEDICATED_ACTORS_MANIFEST?.trim() ?? "";
  if (!manifestPath) {
    throw new Error("F_DEDICATED_ACTORS_MANIFEST is required");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as DedicatedActorsManifest;
  if (manifest.runId && manifest.runId !== runId) {
    throw new Error(`F actor manifest Run ID mismatch: expected=${runId}, actual=${manifest.runId ?? "missing"}`);
  }

  const a6Binding = manifest.finalAccounts?.a6_reviewer;
  const checkerBinding = manifest.finalAccounts?.f1_checker;
  const f25CheckerBinding = manifest.finalAccounts?.f25_checker;
  const fMaker = loadFMaker(runId);
  const fChecker = requireAccount(checkerBinding, "finalAccounts.f1_checker");
  const f25Checker = requireAccount(f25CheckerBinding, "finalAccounts.f25_checker");
  const a6Reviewer = requireAccount(a6Binding, "finalAccounts.a6_reviewer");
  if (new Set([fMaker.username, fChecker.username, f25Checker.username, a6Reviewer.username]).size !== 4) {
    throw new Error("F maker, F1 checker, F2-F5 checker, and A6 reviewer must be four distinct accounts");
  }

  return {
    fMaker,
    fChecker,
    f25Checker,
    a6Reviewer,
    fCheckerRoleCode: requiredText(
      checkerBinding?.roleCode,
      "finalAccounts.f1_checker.roleCode",
    ),
    f25CheckerRoleCode: requiredText(
      f25CheckerBinding?.roleCode,
      "finalAccounts.f25_checker.roleCode",
    ),
    a6ReviewerRoleCode: requiredText(
      a6Binding?.roleCode,
      "finalAccounts.a6_reviewer.roleCode",
    ),
    manifestPath,
  };
}

export function assertLocalFCandidate() {
  const expectedBuildId = requiredText(process.env.F_EXPECTED_BUILD_ID, "F_EXPECTED_BUILD_ID");
  const expectedJarSha = requiredText(
    process.env.F_EXPECTED_JAR_SHA256,
    "F_EXPECTED_JAR_SHA256",
  ).toUpperCase();
  const buildIdPath = process.env.F_PC_BUILD_ID_PATH
    ?? "D:/workspace/nexion-ops-console/.next/BUILD_ID";
  const jarPath = process.env.F_BACKEND_JAR_PATH
    ?? "D:/workspace/nexion-backend/target/nexion-backend-0.0.1-SNAPSHOT.jar";
  if (!existsSync(buildIdPath)) throw new Error(`PC BUILD_ID not found: ${buildIdPath}`);
  if (!existsSync(jarPath)) throw new Error(`backend JAR not found: ${jarPath}`);
  const actualBuildId = readFileSync(buildIdPath, "utf8").trim();
  const actualJarSha = createHash("sha256")
    .update(readFileSync(jarPath))
    .digest("hex")
    .toUpperCase();
  if (actualBuildId !== expectedBuildId) {
    throw new Error(`PC BUILD_ID drift: expected=${expectedBuildId}, actual=${actualBuildId}`);
  }
  if (actualJarSha !== expectedJarSha) {
    throw new Error(`backend JAR SHA-256 drift: expected=${expectedJarSha}, actual=${actualJarSha}`);
  }
  return {
    buildId: actualBuildId,
    jarSha256: actualJarSha,
    buildIdPath,
    jarPath,
  };
}

export async function assertDedicatedLeafMenuContract(
  page: Page,
  sessionMenuCodes: Array<string | { code?: string }>,
  profile: "a6-reviewer" | "f1-checker" | "f25-checker",
) {
  const expected = profile === "a6-reviewer"
    ? { codes: ["A2", "A6"], paths: ["/platform/audit", "/platform/roles"], parents: ["A"] }
    : profile === "f1-checker"
      ? { codes: ["A2", "F1"], paths: ["/platform/audit", "/network/v-rank"], parents: ["A", "F"] }
      : {
          codes: ["A2", "F2", "F3", "F4", "F5"],
          paths: [
            "/platform/audit",
            "/network/royalty",
            "/network/binary",
            "/network/leadership-pool",
            "/network/commissions",
          ],
          parents: ["A", "F"],
        };
  const actualCodes = sessionMenuCodes
    .map((item) => typeof item === "string" ? item : item.code ?? "")
    .filter(Boolean)
    .sort();
  expect(
    actualCodes,
    `${profile} session must contain leaf menu codes only; parent domains are PC-derived`,
  ).toEqual([...expected.codes].sort());

  const sidebar = page.locator("aside").filter({ has: page.locator("nav") }).first();
  await expect(sidebar).toBeVisible();
  const allLeafPaths = CONSOLE_NAV.flatMap((domain) => domain.l2.map((leaf) => leaf.path));
  const leafUnion = new Set<string>();
  for (const parent of expected.parents) {
    const name = parent === "A"
      ? /平台基础.*A|A.*平台基础/
      : /分销与团队.*F|F.*分销与团队/;
    const group = sidebar.getByRole("button", { name }).first();
    await expect(
      group,
      `${profile} derived ${parent} parent group`,
    ).toBeVisible();
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    const expandedList = sidebar.locator(`#nav-group-${parent}`);
    await expect(expandedList, `${profile} derived ${parent} expanded leaf container`).toBeVisible();
    const expectedForParent = expected.paths
      .filter((leafPath) => parent === "A" ? leafPath.startsWith("/platform/") : leafPath.startsWith("/network/"))
      .sort();
    for (const leafPath of expectedForParent) {
      await expect(
        sidebar.locator(`a[href="${leafPath}"]`),
        `${profile} derived ${parent} leaf ${leafPath}`,
      ).toBeVisible();
    }
    const visibleForParent = await expandedList.locator("a[href]").evaluateAll(
      (links, knownPaths) => links
        .filter((link) => {
          const href = link.getAttribute("href") ?? "";
          const style = window.getComputedStyle(link);
          return knownPaths.includes(href)
            && style.display !== "none"
            && style.visibility !== "hidden";
        })
        .map((link) => link.getAttribute("href") ?? "")
        .sort(),
      allLeafPaths,
    );
    expect(
      visibleForParent,
      `${profile} derived ${parent} group must expose only its allowed leaves`,
    ).toEqual(expectedForParent);
    visibleForParent.forEach((leafPath) => leafUnion.add(leafPath));
  }
  expect(
    [...leafUnion].sort(),
    `${profile} sidebar parent traversal must expose its complete effective leaf set`,
  ).toEqual([...expected.paths].sort());
}

export async function loginFActor(
  page: Page,
  account: FAcceptanceAccount,
  actorKey: string,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const appShell = page.locator("aside");
    if (await appShell.isVisible({ timeout: 2_000 }).catch(() => false)) return;

    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const passwordResponse = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/login", {
      timeout: 20_000,
    }).catch(() => null);
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const loginResponse = await passwordResponse;
    // The login shell can finish hydrating between fill and click and replace
    // both controlled inputs. In that carrier-only race no request is emitted;
    // consume the timeout and let the existing bounded retry refill the form.
    if (!loginResponse) {
      continue;
    }
    if (loginResponse.status() !== 200) {
      continue;
    }

    const otp = page.getByLabel("一次性验证码");
    await expect(
      otp,
      `${actorKey} must complete the real MFA challenge; password-only login is forbidden`,
    ).toBeVisible({ timeout: 10_000 });
    const first = await submitMfa(page, otp, account.totpSecret, actorKey);
    const final = first.accepted
      ? first
      : await submitMfa(page, otp, account.totpSecret, actorKey, first.step);
    if (final.accepted) {
      await expect(appShell).toBeVisible({ timeout: 20_000 });
      return;
    }
  }
  throw new Error(`${actorKey} MFA login failed after three attempts`);
}

async function submitMfa(
  page: Page,
  otp: ReturnType<Page["getByLabel"]>,
  secret: string,
  actorKey: string,
  afterStep = -1,
) {
  const totp = await freshTotp(actorKey, secret, afterStep);
  await otp.fill(totp.code);
  const verification = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const response = await verification;
  const body = await response.json().catch(() => null) as { code?: number } | null;
  const hasCookie = (await page.context().cookies())
    .some((cookie) => cookie.name === "nexion_admin_token");
  return {
    accepted: response.status() === 200 && (body?.code === 0 || hasCookie),
    status: response.status(),
    code: body?.code,
    step: totp.step,
  };
}

function requireAccount(
  account: Partial<FAcceptanceAccount> | undefined,
  label: string,
): FAcceptanceAccount {
  if (!account?.username?.trim() || !account.password || !account.totpSecret?.trim()) {
    throw new Error(`${label} must include username, password, and totpSecret`);
  }
  return {
    username: account.username,
    password: account.password,
    totpSecret: account.totpSecret,
  };
}

function requiredText(value: string | undefined, label: string) {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(
  actorKey: string,
  secret: string,
  afterStep = -1,
) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = Math.max(lastTotpStep.get(actorKey) ?? -1, afterStep);
  if (step <= previous) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(actorKey, step);
  return { code: currentTotp(secret), step };
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
