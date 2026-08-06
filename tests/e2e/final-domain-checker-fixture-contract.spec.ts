import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/**
 * FINAL_FIXTURE_ADMIN_WINDOW preflight contract.
 *
 * This test intentionally starts RED: it is a read-only assertion that the
 * RunID-scoped roles do not yet exist.  The companion UI-only provisioner is
 * permitted to create exactly these roles/accounts, then this test becomes the
 * immutable least-privilege contract for the later domain runs.
 */
const RUN_ID = process.env.FINAL_FIXTURE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_ATTEMPT = "R3";
const ROLE_PREFIX = `ACC_FINAL_${RUN_ID.replace(/[^A-Z0-9]/gi, "").slice(-14).toUpperCase()}_${FIXTURE_ATTEMPT}`;

export const FINAL_CHECKER_SPECS = [
  {
    key: "a6_reviewer",
    roleCode: `${ROLE_PREFIX}_A6_REVIEWER`,
    menuCodes: ["A2", "A6"],
    permissions: ["platform_a2_read", "platform_a2_operation_approve", "platform_a6_read", "platform_a6_write", "platform_a6_role_grants_update"],
    forbiddenPrefixes: ["device_", "network_", "service_m", "finance_", "user_", "content_", "risk_", "growth_"],
  },
  {
    key: "e3e6_checker",
    roleCode: `${ROLE_PREFIX}_E6_CHECKER`,
    menuCodes: ["A2", "E3", "E6"],
    permissions: ["platform_a2_read", "platform_a2_operation_approve", "device_e3_read", "device_e3_write", "device_e6_read", "device_e6_write"],
    forbiddenPrefixes: ["network_", "service_m", "finance_", "user_", "content_", "risk_", "growth_"],
  },
  {
    key: "f1_checker",
    roleCode: `${ROLE_PREFIX}_F1_CHECKER`,
    menuCodes: ["A2", "F1"],
    permissions: ["platform_a2_read", "platform_a2_operation_approve", "network_f1_read", "network_f1_write"],
    forbiddenPrefixes: ["device_", "service_m", "finance_", "user_", "content_", "risk_", "growth_"],
  },
  {
    key: "f25_checker",
    roleCode: `${ROLE_PREFIX}_F25_CHECKER`,
    menuCodes: ["A2", "F2", "F3", "F4", "F5"],
    permissions: [
      "platform_a2_read", "platform_a2_operation_approve",
      "network_f2_read", "network_f3_read", "network_f4_read", "network_f5_read",
      "network_f2_policy_amplify", "network_f2_royalty_rate", "network_f2_write",
      "network_f3_engine_pause", "network_f3_match_rate", "network_f3_write",
      "network_f4_leaderboard_control", "network_f4_pool_fund", "network_f4_write",
      "network_f5_commission_dispose", "network_f5_commission_reject", "network_f5_write",
    ],
    forbiddenPrefixes: ["device_", "service_m", "finance_", "user_", "content_", "risk_", "growth_", "network_f1_"],
  },
  {
    key: "m_checker",
    roleCode: `${ROLE_PREFIX}_M_CHECKER`,
    menuCodes: ["A2", "M1", "M2", "M3", "M4", "M5"],
    permissions: [
      "platform_a2_read",
      "service_m1_read", "service_m1_write", "service_m2_read", "service_m2_write",
      "service_m3_read", "service_m3_write", "service_m3_timeout_manage",
      "service_m4_read", "service_m4_write", "service_m5_read", "service_m5_write",
    ],
    forbiddenPrefixes: ["device_", "network_", "finance_", "user_", "content_", "risk_", "growth_"],
  },
  {
    key: "l3_checker",
    roleCode: `${ROLE_PREFIX}_L3_CHECKER`,
    menuCodes: ["A2", "L3"],
    permissions: ["platform_a2_read", "bi_l3_read", "bi_l5_task_approve"],
    forbiddenPrefixes: ["device_", "network_", "service_m", "finance_", "user_", "content_", "risk_", "growth_"],
  },
] as const;

export const FINAL75_READONLY_ROLE_CODE = `${ROLE_PREFIX}_75_READONLY`;

type Envelope<T> = { code?: number; data?: T; message?: string };
type Role = { id: number; roleCode: string };
type RoleDetail = { permissionCodes?: string[]; menuIds?: number[] };
type MenuNode = { node?: { id?: number; menuCode?: string }; children?: MenuNode[] };

test.describe.configure({ mode: "serial", timeout: 60_000 });

test("FINAL fixture contract is RED until exact RunID roles are provisioned", async ({ page }) => {
  const username = required("ADMIN_E2E_USERNAME");
  const password = required("ADMIN_E2E_PASSWORD");
  await loginUi(page, username, password, process.env.ADMIN_E2E_TOTP_SECRET?.trim());

  const roles = await ok<{ roles: Role[] }>(await page.request.get("/api/admin/platform/roles/overview"));
  const menus = await ok<{ tree: MenuNode[] }>(await page.request.get("/api/admin/platform/menus/overview"));
  const menuIds = flatten(menus.tree).reduce<Record<string, number>>((all, node) => {
    if (node.node?.menuCode && Number.isSafeInteger(node.node.id)) all[node.node.menuCode] = node.node.id!;
    return all;
  }, {});

  // Before provisioning this assertion deliberately fails with the missing
  // exact role code. It prevents an old/generic checker from silently passing.
  for (const spec of FINAL_CHECKER_SPECS) {
    const role = roles.roles.find((candidate) => candidate.roleCode === spec.roleCode);
    expect(role, `${spec.key} must be a new RunID role; generic checker reuse is forbidden`).toBeTruthy();
    const detail = await ok<RoleDetail>(await page.request.get(`/api/admin/platform/roles/${role!.id}`));
    expect(new Set(detail.permissionCodes ?? [])).toEqual(new Set(spec.permissions));
    expect(new Set(detail.menuIds ?? [])).toEqual(new Set(spec.menuCodes.map((code) => menuIds[code])));
    expect((detail.permissionCodes ?? []).some((permission) =>
      spec.forbiddenPrefixes.some((prefix) => permission.startsWith(prefix)),
    )).toBe(false);
  }
});

async function loginUi(page: Page, username: string, password: string, totpSecret?: string) {
  await page.goto("/");
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await usernameInput.fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "继续", exact: true }).click();
  }
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 5_000 }).catch(() => false)) {
    if (!totpSecret) throw new Error("ADMIN_E2E_TOTP_SECRET_REQUIRED_FOR_MFA_FIXTURE_ACCOUNT");
    for (let attempt = 0; attempt < 3 && await otp.isVisible().catch(() => false); attempt += 1) {
      await otp.fill(totp(totpSecret));
      const verification = page.waitForResponse((response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify",
      );
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      const response = await verification;
      if (response.status() === 200) break;
      await page.waitForTimeout(1_100);
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

function totp(secret: string) {
  const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("INVALID_TOTP_SECRET");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(bits.match(/.{1,8}/g)?.filter((part) => part.length === 8).map((part) => Number.parseInt(part, 2)) ?? []);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  message.writeUInt32BE(counter >>> 0, 4);
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}

async function ok<T>(response: { ok(): boolean; status(): number; json(): Promise<unknown> }): Promise<T> {
  const envelope = await response.json() as Envelope<T>;
  expect(response.ok(), `HTTP ${response.status()} ${JSON.stringify(envelope)}`).toBeTruthy();
  expect(envelope.code, JSON.stringify(envelope)).toBe(0);
  return envelope.data as T;
}

function flatten(nodes: MenuNode[]): MenuNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED_FOR_FINAL_FIXTURE_CONTRACT`);
  return value;
}
