import { expect, test, type Page, type Route } from "@playwright/test";

type Actor = {
  username: string;
  role: string;
  roleCode: string;
  authorities: string[];
};

type SessionMode = "anonymous" | "healthy" | "slow" | "malformed" | "unavailable";

const actors: Actor[] = [
  { username: "c-maker", role: "acc_c_maker", roleCode: "ACC_C_MAKER", authorities: ["user_c1_read", "user_c2_read", "user_c3_read", "user_c4_read", "user_c5_read", "user_c6_read"] },
  { username: "superadmin", role: "superadmin", roleCode: "SUPER_ADMIN", authorities: ["user_c1_read", "user_c2_read", "user_c3_read", "user_c4_read", "user_c5_read", "user_c6_read"] },
  { username: "c-readonly", role: "acc_c_readonly", roleCode: "ACC_C_READONLY", authorities: ["user_c1_read", "user_c2_read", "user_c3_read", "user_c4_read", "user_c5_read", "user_c6_read"] },
];

test.describe.configure({ mode: "serial", timeout: 120_000 });

for (const actor of actors) {
  test(`${actor.username}: normal MFA, slow bootstrap, refresh, fail-closed and 401 remain deterministic`, async ({ page }) => {
    const carrier = await installAuthCarrier(page, actor);

    await page.goto("/users/search", { waitUntil: "domcontentloaded" });
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();

    await page.locator('input[autocomplete="username"]').fill(actor.username);
    await page.locator('input[autocomplete="current-password"]').fill("not-sent-to-a-real-backend");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    await expect(page.getByLabel("一次性验证码")).toBeVisible();

    carrier.holdHealthySession();
    await page.getByLabel("一次性验证码").fill("123456");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    await carrier.waitForPendingSession();
    await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);
    carrier.releaseSession();
    await expect(page.locator("aside")).toBeVisible();
    await expect(page).toHaveURL(/\/users\/search$/);

    carrier.holdHealthySession();
    await page.reload({ waitUntil: "domcontentloaded" });
    await carrier.waitForPendingSession();
    await expect(page.getByText("正在验证登录状态…", { exact: true })).toBeVisible();
    await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);
    expect(carrier.pendingSessionRequests()).toBe(1);
    carrier.releaseSession();
    await expect(page.locator("aside")).toBeVisible();

    carrier.setMode("malformed");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("登录状态校验失败", { exact: true })).toBeVisible();
    await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);
    await expect(page.locator("aside")).toHaveCount(0);

    carrier.setMode("healthy");
    await page.getByRole("button", { name: "重新校验", exact: true }).click();
    await expect(page.locator("aside")).toBeVisible();

    carrier.setMode("unavailable");
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("登录状态校验失败", { exact: true })).toBeVisible();
    await expect(page.locator('input[autocomplete="username"]')).toHaveCount(0);

    carrier.setMode("anonymous");
    await page.getByRole("button", { name: "重新校验", exact: true }).click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);

    await completeMfaLogin(page, carrier, actor);
    await expect(page.locator("aside")).toBeVisible();
    await page.locator('header button[aria-haspopup="menu"]').click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    await expect(page.locator("aside")).toHaveCount(0);

    await completeMfaLogin(page, carrier, actor);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page).toHaveURL(/\/users\/search$/);
  });
}

async function completeMfaLogin(
  page: Page,
  carrier: { setMode(next: SessionMode): void },
  actor: Actor,
) {
  await page.locator('input[autocomplete="username"]').fill(actor.username);
  await page.locator('input[autocomplete="current-password"]').fill("not-sent-to-a-real-backend");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.getByLabel("一次性验证码")).toBeVisible();
  carrier.setMode("healthy");
  await page.getByLabel("一次性验证码").fill("123456");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
}

async function installAuthCarrier(page: Page, actor: Actor) {
  let mode: SessionMode = "anonymous";
  let pending = 0;
  let release: (() => void) | null = null;
  let started: (() => void) | null = null;
  let startedPromise = new Promise<void>((resolve) => { started = resolve; });

  const wireSession = {
    adminId: actor.username === "superadmin" ? 1 : actor.username === "c-maker" ? 2 : 3,
    username: actor.username,
    operator: actor.username,
    role: actor.role,
    roleCode: actor.roleCode,
    authorities: actor.authorities,
    effectiveMenus: ["C", "C1", "C2", "C3", "C4", "C5", "C6"],
    effectiveMenuNodes: [
      { menuCode: "C", menuName: "用户与账户", routePath: "", parentCode: null, sortOrder: 3 },
      { menuCode: "C1", menuName: "检索 & 画像", routePath: "/users/search", parentCode: "C", sortOrder: 1 },
      { menuCode: "C2", menuName: "账户操作", routePath: "/users/actions", parentCode: "C", sortOrder: 2 },
      { menuCode: "C3", menuName: "余额 & 资产调整", routePath: "/users/assets", parentCode: "C", sortOrder: 3 },
      { menuCode: "C4", menuName: "KYC 合规台账", routePath: "/users/kyc", parentCode: "C", sortOrder: 4 },
      { menuCode: "C5", menuName: "安全 & 会话", routePath: "/users/security", parentCode: "C", sortOrder: 5 },
      { menuCode: "C6", menuName: "注册/登录风控", routePath: "/users/reg-risk", parentCode: "C", sortOrder: 6 },
    ],
    passwordChangeRequired: false,
  };

  await page.route("**/api/admin/auth/login", (route) => json(route, 200, {
    code: 0,
    message: "success",
    data: { mfa: { challengeId: `challenge-${actor.username}`, mode: "VERIFY", expiresInSeconds: 300 } },
  }));
  await page.route("**/api/admin/auth/mfa/verify", (route) => {
    return json(route, 200, { code: 0, message: "success", data: { tokenType: "Bearer", session: wireSession } });
  });
  await page.route("**/api/admin/auth/logout", (route) => {
    mode = "anonymous";
    return json(route, 200, { code: 0, message: "success", data: null });
  });
  await page.route("**/api/admin/auth/session", async (route) => {
    if (mode === "anonymous") return json(route, 401, { code: 401, message: "ADMIN_SESSION_MISSING", data: null });
    if (mode === "malformed") return json(route, 200, { code: 0, message: "success", data: {} });
    if (mode === "unavailable") return json(route, 503, { code: 503, message: "ADMIN_SESSION_UNAVAILABLE", data: null });
    if (mode === "slow") {
      pending += 1;
      started?.();
      await new Promise<void>((resolve) => { release = resolve; });
      pending -= 1;
    }
    return json(route, 200, { code: 0, message: "success", data: { tokenType: "Bearer", session: wireSession } });
  });
  await page.route("**/api/admin/users/**", (route) => json(route, 200, { code: 0, message: "success", data: { total: 0, records: [] } }));

  return {
    setMode(next: SessionMode) { mode = next; },
    holdHealthySession() {
      mode = "slow";
      startedPromise = new Promise<void>((resolve) => { started = resolve; });
      release = null;
    },
    async waitForPendingSession() {
      await startedPromise;
      await expect.poll(() => pending).toBe(1);
    },
    pendingSessionRequests() { return pending; },
    releaseSession() {
      mode = "healthy";
      const resume = release;
      release = null;
      resume?.();
    },
  };
}

async function json(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}
