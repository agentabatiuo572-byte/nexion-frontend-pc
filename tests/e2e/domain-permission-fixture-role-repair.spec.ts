import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

const DOMAIN_ROLE_REPAIR = process.env.DOMAIN_ROLE_REPAIR;
const DOMAINS = "ABCDEFGHIJKLM".split("") as Domain[];
const ACCOUNT_KINDS = ["maker", "readonly", "nowrite", "nomenu"] as const;
type Domain = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I" | "J" | "K" | "L" | "M";
type AccountKind = (typeof ACCOUNT_KINDS)[number];
type DomainDefinition = {
  modules: string[];
  menuCodes?: string[];
  read: string[];
  maker: string[];
};
type FixtureAccount = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  authorities: string[];
  effectiveMenus: string[];
};
type DomainManifest = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  checker: { username: string; password: string; totpSecret: string };
  accounts: Record<AccountKind, FixtureAccount>;
  cleanup: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
};
type RolePlan = {
  key: string;
  domain: Domain | "CHECKER";
  kind: "read" | "maker" | "checker";
  roleCode: string;
  roleName: string;
  permissions: string[];
  menuCodes: string[];
  menuIds: number[];
  roleId?: number;
  ticketId?: string;
};
type Progress = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  roleCodeSuffix?: string;
  roles: Record<string, { roleId: number; ticketId?: string; approved?: boolean; grantFingerprint?: string }>;
  assignments: Record<string, { accountId: string; role: string; verified?: boolean }>;
};
type RepairConfig = {
  baseUrl: string;
  runId: string;
  restrictedRoot: string;
  fixtureDir: string;
  globalFixture: string;
  operator: string;
  operatorPassword: string;
};
type AccountRow = {
  id: string | number;
  username: string;
  role?: string;
  version: string | number;
  sessions?: string | number;
};
type SessionShape = { authorities: string[]; menuCodes: string[] };
type Envelope<T> = { code?: number; message?: string; data?: T };

const A_READ = modules("platform_", ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);
const B_READ = modules("overview_", ["B1", "B2", "B3", "B4", "B5"]);
const C_READ = modules("user_", ["C1", "C2", "C3", "C4", "C5", "C6"]);
const D_READ = modules("finance_", ["D1", "D2", "D3", "D4", "D5", "D6"]);
const E_READ = modules("device_", ["E1", "E2", "E3", "E4", "E5", "E6"]);
const F_READ = modules("network_", ["F1", "F2", "F3", "F4", "F5"]);
const G_READ = modules("finprod_", ["G1", "G2", "G3", "G4", "G7"]);
const H_READ = modules("growth_", ["H1", "H2", "H3", "H4", "H5", "H7", "H8"]);
const I_READ = modules("content_", ["I1", "I2", "I3", "I4", "I5", "I6"]);
const J_READ = modules("emergency_", ["J1", "J2", "J3", "J4"]);
const K_READ = modules("risk_", ["K1", "K2", "K3", "K4", "K5", "K6"]);
const L_READ = modules("bi_", ["L1", "L2", "L3", "L4", "L5", "L6"]);
const M_READ = modules("service_", ["M1", "M2", "M3", "M4", "M5"]);
const A2_MAKER = ["platform_a2_read", "platform_a2_proposal_create"];

const DOMAIN_DEFINITIONS: Record<Domain, DomainDefinition> = {
  A: {
    modules: ["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"],
    read: A_READ,
    maker: [
      ...A_READ,
      "platform_a1_account_2fa_reset", "platform_a1_account_disable",
      "platform_a1_account_password_reset", "platform_a1_account_role_change",
      "platform_a1_account_sessions_revoke", "platform_a1_rbac_grants_update",
      "platform_a1_write", "platform_a2_export", "platform_a2_proposal_create",
      "platform_a2_write", "platform_a3_write", "platform_a4_write",
      "platform_a6_role_grants_update", "platform_a6_write", "platform_a7_write",
    ],
  },
  B: {
    modules: ["B1", "B2", "B3", "B4", "B5"],
    read: B_READ,
    maker: [
      ...B_READ, ...A2_MAKER,
      "overview_b1_kill_switch_trigger", "overview_b1_redline_write",
      "overview_b1_runrisk_write", "overview_b1_write", "overview_b2_export",
      "overview_b2_write", "overview_b3_export", "overview_b3_view_write",
      "overview_b4_export", "overview_b4_jump", "overview_b5_subscribe",
      "overview_b5_threshold_write", "overview_b5_triage",
    ],
  },
  C: {
    modules: ["C1", "C2", "C3", "C4", "C5", "C6"],
    read: C_READ,
    maker: [
      ...C_READ, ...A2_MAKER,
      "user_c1_write", "user_c1hub_2fa_reset", "user_c1hub_account_freeze",
      "user_c1hub_account_unfreeze", "user_c1hub_compensation_grant",
      "user_c1hub_device_recycle", "user_c1hub_device_replace",
      "user_c1hub_earning_grant", "user_c1hub_earning_reverse",
      "user_c1hub_password_force_change", "user_c1hub_password_reset",
      "user_c1hub_read", "user_c1hub_session_revoke_all",
      "user_c1hub_session_revoke_one", "user_c1hub_write",
      "user_c2_account_freeze", "user_c2_account_unfreeze",
      "user_c2_blocklist_add", "user_c2_impersonate_start",
      "user_c2_impersonate_terminate", "user_c2_session_revoke_all",
      "user_c2_write", "user_c3_adjust_create", "user_c3_adjust_reverse",
      "user_c3_write", "user_c4_export", "user_c4_network_write",
      "user_c4_revoke", "user_c4_trigger_review", "user_c4_verify",
      "user_c5_2fa_disable", "user_c5_password_reset",
      "user_c5_session_revoke_all", "user_c5_session_revoke_one",
      "user_c5_unlock_long", "user_c5_unlock_short", "user_c5_write",
      "user_c6_write",
    ],
  },
  D: {
    modules: ["D1", "D2", "D3", "D4", "D5", "D6"],
    read: D_READ,
    maker: [
      ...D_READ, ...A2_MAKER,
      "finance_d1_bank_account_manage", "finance_d1_bank_config_manage",
      "finance_d1_bank_reconcile", "finance_d1_bin_lock",
      "finance_d1_bin_manual_lock", "finance_d1_bin_unlock",
      "finance_d1_channel_manage", "finance_d1_chargeback_refund",
      "finance_d1_config_manage", "finance_d1_psp_switch",
      "finance_d1_reconcile", "finance_d2_withdrawal_batch",
      "finance_d2_withdrawal_delay", "finance_d2_withdrawal_freeze",
      "finance_d2_withdrawal_refund", "finance_d2_withdrawal_reject",
      "finance_d2_withdrawal_unfreeze", "finance_d3_export",
      "finance_d3_injection_create", "finance_d3_write",
      "finance_d4_export", "finance_d4_user_read",
      "finance_d5_balance_max_write", "finance_d5_daily_limit_write",
      "finance_d5_fee_write", "finance_d6_manage",
    ],
  },
  E: {
    modules: ["E1", "E2", "E3", "E4", "E5", "E6"],
    read: E_READ,
    maker: [
      ...E_READ, ...A2_MAKER,
      "device_e1_generation_gate_force_lock", "device_e1_generation_gate_force_unlock",
      "device_e1_write", "device_e2_phone_tier_nex", "device_e2_phone_tier_usdt",
      "device_e2_write", "device_e3_degrade_late", "device_e3_promo_mult",
      "device_e3_salvage_pct", "device_e3_write", "device_e4_order_refund",
      "device_e4_write", "device_e5_datacenter_pause",
      "device_e5_device_force_activate", "device_e5_device_unbind",
      "device_e5_write", "device_e6_flag_toggle", "device_e6_write",
    ],
  },
  F: {
    modules: ["F1", "F2", "F3", "F4", "F5"],
    read: F_READ,
    maker: [
      ...F_READ, ...A2_MAKER,
      "network_f1_permanent_protection", "network_f1_promote_user",
      "network_f1_reward_reissue", "network_f1_reward_reverse", "network_f1_write",
      "network_f2_policy_amplify", "network_f2_royalty_rate", "network_f2_write",
      "network_f3_engine_pause", "network_f3_match_rate", "network_f3_write",
      "network_f4_leaderboard_control", "network_f4_pool_fund", "network_f4_write",
      "network_f5_commission_dispose", "network_f5_commission_reject", "network_f5_write",
    ],
  },
  G: {
    modules: ["G1", "G2", "G3", "G4", "G7"],
    read: G_READ,
    maker: [
      ...G_READ, ...A2_MAKER,
      "finprod_g1_apy_write", "finprod_g1_kill_toggle", "finprod_g1_min_write",
      "finprod_g1_penalty_write", "finprod_g1_write",
      "finprod_g2_cap_per_tx_write", "finprod_g2_cap_platform_write",
      "finprod_g2_cap_user_write", "finprod_g2_fee_rate_write",
      "finprod_g2_queue_cancel", "finprod_g2_swap_toggle", "finprod_g2_write",
      "finprod_g3_curve_pump_prob_write", "finprod_g3_curve_target_price_write",
      "finprod_g3_engine_pause_toggle", "finprod_g3_override_price_write",
      "finprod_g3_write", "finprod_g4_airdrop_lock_days_write",
      "finprod_g4_airdrop_pct_write", "finprod_g4_dividend_rate_write",
      "finprod_g4_emission_curve_write", "finprod_g4_market_toggle",
      "finprod_g4_price_write", "finprod_g4_royalty_write", "finprod_g4_write",
      "finprod_g7_apy_write", "finprod_g7_nurture_write", "finprod_g7_write",
    ],
  },
  H: {
    modules: ["H1", "H2", "H3", "H4", "H5", "H7", "H8"],
    read: H_READ,
    maker: [
      ...H_READ, ...A2_MAKER,
      "growth_h1_control_pin_write", "growth_h1_override_revoke", "growth_h1_write",
      "growth_h2_session_cancel", "growth_h2_session_charge", "growth_h2_write",
      "growth_h3_write", "growth_h4_wheel_pool_write", "growth_h4_write",
      "growth_h5_rule_write", "growth_h5_write", "growth_h7_write",
      "growth_h8_settle", "growth_h8_write",
    ],
  },
  I: {
    modules: ["I1", "I2", "I3", "I4", "I5", "I6"],
    menuCodes: ["I1", "I2", "I3", "MENU_CONTENT_I4", "MENU_CONTENT_I5", "I6"],
    read: I_READ,
    maker: [
      ...I_READ, ...A2_MAKER,
      "content_i1_copy_create", "content_i1_experiment_manage", "content_i1_write",
      "content_i2_write", "content_i3_cap_adjust", "content_i3_critical_send",
      "content_i3_write", "content_i4_publish_standard",
      "content_i4_trust_section_manage", "content_i4_write",
      "content_i5_disclosure_publish", "content_i5_gate_adjust", "content_i5_write",
      "content_i6_write",
    ],
  },
  J: {
    modules: ["J1", "J2", "J3", "J4"],
    read: J_READ,
    maker: [
      ...J_READ, ...A2_MAKER,
      "emergency_j1_gate_kill", "emergency_j1_gate_resume",
      "emergency_j1_batch_kill", "emergency_j1_write",
      "emergency_j2_country_manage", "emergency_j2_write",
      "emergency_j2_edge_source_manage", "emergency_j2_emergency_block",
      "emergency_j3_alert_config", "emergency_j3_export",
      "emergency_j4_write", "emergency_j4_playbook_execute",
    ],
  },
  K: {
    modules: ["K1", "K2", "K3", "K4", "K5", "K6"],
    read: K_READ,
    maker: [
      ...K_READ, ...A2_MAKER,
      "risk_k1_write", "risk_k1_cluster_freeze", "risk_k1_cluster_release",
      "risk_k1_cluster_cleared", "risk_k1_cluster_flag",
      "risk_k2_write", "risk_k2_row_freeze", "risk_k2_row_flag",
      "risk_k2_row_blockgift", "risk_k2_row_boardflag",
      "risk_k3_write", "risk_k3_rule_create", "risk_k3_rule_toggle",
      "risk_k3_rule_archive", "risk_k4_write", "risk_k4_user_override",
      "risk_k4_user_recompute", "risk_k5_write", "risk_k5_ticket_pass",
      "risk_k5_ticket_reject", "risk_k5_ticket_manual", "risk_k6_write",
      "risk_k6_senior", "risk_k6_target_manage",
    ],
  },
  L: {
    modules: ["L1", "L2", "L3", "L4", "L5", "L6"],
    read: L_READ,
    maker: [
      ...L_READ, ...A2_MAKER,
      "bi_l1_write", "bi_l2_write", "bi_l3_write", "bi_l3_export_detail",
      "bi_l4_write", "bi_l4_export_tree", "bi_l5_write",
      "bi_l5_regulatory_generate", "bi_l6_export",
    ],
  },
  M: {
    modules: ["M1", "M2", "M3", "M4", "M5"],
    read: M_READ,
    maker: [
      ...M_READ, ...A2_MAKER,
      "service_m1_write", "service_m2_write", "service_m3_timeout_manage",
      "service_m3_write", "service_m4_write", "service_m5_write",
    ],
  },
};

const CHECKER_ONLY = [
  "platform_a2_operation_approve",
  "user_c3_adjust_approve",
  "finance_d2_withdrawal_approve",
  "network_f4_ambassador_approve",
  "bi_l5_task_approve",
  "bi_l5_decrypt_export",
  "device_e6_write",
];
const CHECKER_REQUIRED_MUTATIONS = ["platform_a6_role_grants_update"];
const lastTotpStepBySecretHash = new Map<string, number>();

// This harness must fill one-time passwords and TOTP values.  Never let a
// retained Playwright artifact serialize those sensitive form inputs.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial", timeout: 1_500_000 });

test("显式修复 A-M 域专属最小角色并重签会话快照", async ({ page, browser }) => {
  test.skip(DOMAIN_ROLE_REPAIR !== "1", "set DOMAIN_ROLE_REPAIR=1 to permit run-scoped role repair");
  const config = await readConfig();
  const state = await loadState(config);
  const menuMap = await loginOperatorAndLoadMenus(page, config);
  const plans = buildPlans(config, menuMap, state.progress);

  // Fail closed before any approval: no domain fixture may retain the old
  // global super/cross-domain role while this migration is incomplete.
  await quarantineDomainAccounts(page, config, state);
  await validatePlanPermissions(page, plans);

  for (const plan of plans) {
    await ensureRoleAndGrant(page, config, state.progress, plan);
  }

  // Bootstrap the independent checker once: the existing checker is a
  // different account from the proposal creator. It may approve only its own
  // exact checker-role grant while still carrying the old role, then is
  // immediately demoted before any domain grant is approved.
  const checkerPlan = plans.find((plan) => plan.kind === "checker")!;
  await bootstrapIndependentChecker(page, browser, config, state, checkerPlan);
  await approveGrantPlans(
    browser,
    config,
    state.checker,
    state.progress,
    plans.filter((plan) => plan.kind !== "checker"),
  );
  await loginOperator(page, config);
  for (const plan of plans) await verifyRole(page, plan);

  for (const domain of DOMAINS) {
    const manifest = state.manifests[domain];
    for (const kind of ACCOUNT_KINDS) {
      const account = manifest.accounts[kind];
      const role = kind === "maker"
        ? plans.find((plan) => plan.key === `${domain}.maker`)!
        : kind === "nomenu"
          ? { roleCode: "unassigned", permissions: [], menuCodes: [] }
          : plans.find((plan) => plan.key === `${domain}.read`)!;
      await assignAccountRole(page, config, state.progress, `${domain}.${kind}`, account.accountId, role.roleCode.toLowerCase());
    }
  }
  for (const domain of DOMAINS) {
    const manifest = state.manifests[domain];
    for (const kind of ACCOUNT_KINDS) {
      const account = manifest.accounts[kind];
      const expected = kind === "maker"
        ? plans.find((plan) => plan.key === `${domain}.maker`)!
        : kind === "nomenu"
          ? { roleCode: "unassigned", permissions: [], menuCodes: [] }
          : plans.find((plan) => plan.key === `${domain}.read`)!;
      const session = await loginAndSnapshot(browser, config.baseUrl, account, expected.permissions, expected.menuCodes);
      account.role = expected.roleCode.toLowerCase();
      account.authorities = session.authorities;
      account.effectiveMenus = session.menuCodes;
      state.progress.assignments[`${domain}.${kind}`].verified = true;
      await atomicJson(state.manifestFiles[domain], manifest);
      await persistProgress(config, state.progress);
    }
  }
  const checkerSession = await loginAndSnapshot(
    browser,
    config.baseUrl,
    state.checker,
    checkerPlan.permissions,
    checkerPlan.menuCodes,
  );
  state.progress.assignments["CHECKER.checker"].verified = true;
  await persistProgress(config, state.progress);

  await extendCleanupManifest(config, state, plans);
  await atomicJson(path.join(config.fixtureDir, "safe-role-summary.json"), {
    runId: config.runId,
    generatedAt: new Date().toISOString(),
    roles: plans.map((plan) => ({
      key: plan.key,
      roleId: plan.roleId,
      roleCode: plan.roleCode,
      permissionCount: plan.permissions.length,
      menuCodes: plan.menuCodes,
      approvedTicket: plan.ticketId ?? "PREVIOUSLY_APPROVED",
    })),
    accounts: DOMAINS.flatMap((domain) => ACCOUNT_KINDS.map((kind) => ({
      domain,
      kind,
      accountId: state.manifests[domain].accounts[kind].accountId,
      role: state.manifests[domain].accounts[kind].role,
      authorityCount: state.manifests[domain].accounts[kind].authorities.length,
      menuCount: state.manifests[domain].accounts[kind].effectiveMenus.length,
    }))),
    checker: {
      accountId: state.checker.accountId,
      role: checkerPlan.roleCode.toLowerCase(),
      authorityCount: checkerSession.authorities.length,
      menuCount: checkerSession.menuCodes.length,
    },
  });

  const expectedAssignments = [
    ...DOMAINS.flatMap((domain) => ACCOUNT_KINDS.map((kind) => `${domain}.${kind}`)),
    "CHECKER.checker",
  ];
  expect(expectedAssignments.every((key) => state.progress.assignments[key]?.verified)).toBe(true);
  expect(plans.every((plan) => plan.roleId && plan.permissions.length > 0 && plan.menuIds.length > 0)).toBe(true);
});

function modules(prefix: string, moduleCodes: string[]) {
  return moduleCodes.map((moduleCode) => `${prefix}${moduleCode.toLowerCase()}_read`);
}

async function readConfig(): Promise<RepairConfig> {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be explicitly provided`);
    return value;
  };
  const baseUrl = required("DOMAIN_ROLE_REPAIR_BASE_URL");
  const parsed = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("fixture role repair only permits a loopback admin endpoint");
  }
  const restrictedRoot = path.resolve(required("DOMAIN_ROLE_REPAIR_RESTRICTED_ROOT"));
  if (!/bug-pic[\\/]\.restricted/i.test(restrictedRoot)) {
    throw new Error("DOMAIN_ROLE_REPAIR_RESTRICTED_ROOT must be under bug-pic/.restricted");
  }
  const allowedBase = await realpath(path.resolve("D:/workspace/bug-pic/.restricted"));
  const canonicalRoot = await realpath(restrictedRoot);
  const relative = path.relative(allowedBase, canonicalRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("fixture role repair requires a child Run directory under the canonical bug-pic/.restricted root");
  }
  const runId = required("DOMAIN_ROLE_REPAIR_RUN_ID");
  return {
    baseUrl,
    runId,
    restrictedRoot: canonicalRoot,
    fixtureDir: path.join(canonicalRoot, "A", "domain-permission-fixtures"),
    globalFixture: path.join(canonicalRoot, "A", "permission-fixtures", "permission-fixtures.json"),
    operator: required("DOMAIN_ROLE_REPAIR_OPERATOR"),
    operatorPassword: required("DOMAIN_ROLE_REPAIR_OPERATOR_PASSWORD"),
  };
}

async function loadState(config: RepairConfig) {
  const manifests = {} as Record<Domain, DomainManifest>;
  const manifestFiles = {} as Record<Domain, string>;
  const identities = new Set<string>();
  for (const domain of DOMAINS) {
    const file = path.join(config.fixtureDir, `${domain}.json`);
    const manifest = JSON.parse(await readFile(file, "utf8")) as DomainManifest;
    if (manifest.runId !== config.runId) throw new Error(`${domain}.json belongs to another run`);
    for (const kind of ACCOUNT_KINDS) {
      const account = manifest.accounts?.[kind];
      if (!account?.accountId || !account.username || !account.password || !account.totpSecret) {
        throw new Error(`${domain}.${kind} fixture is incomplete`);
      }
      for (const identity of [account.accountId, account.username.trim().toLowerCase()]) {
        if (identities.has(identity)) throw new Error(`duplicate fixture identity ${domain}.${kind}`);
        identities.add(identity);
      }
    }
    manifests[domain] = manifest;
    manifestFiles[domain] = file;
  }
  const global = JSON.parse(await readFile(config.globalFixture, "utf8")) as {
    runId?: string;
    checker?: { id?: string | number; username?: string; password?: string; totpSecret?: string };
  };
  if (
    global.runId !== config.runId
    || !global.checker?.id
    || !global.checker.username
    || !global.checker.password
    || !global.checker.totpSecret
  ) {
    throw new Error("same-run global checker fixture is required");
  }
  if (
    global.checker.username.trim().toLowerCase() === config.operator.trim().toLowerCase()
    || identities.has(String(global.checker.id))
    || identities.has(global.checker.username.trim().toLowerCase())
  ) {
    throw new Error("operator, checker, and all domain fixture accounts must be distinct");
  }
  const progressFile = path.join(config.fixtureDir, "role-repair-progress.json");
  let progress: Progress;
  try {
    progress = JSON.parse(await readFile(progressFile, "utf8")) as Progress;
    if (progress.runId !== config.runId) throw new Error("role repair progress belongs to another run");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    progress = { sensitive: true, doNotUpload: true, runId: config.runId, roles: {}, assignments: {} };
  }
  if (!progress.roleCodeSuffix) {
    progress.roleCodeSuffix = Object.keys(progress.roles).length > 0
      ? config.runId.match(/(\d{6})$/)?.[1] ?? "LEGACY"
      : createHash("sha256").update(config.runId).digest("hex").slice(0, 10).toUpperCase();
    await persistProgress(config, progress);
  }
  return {
    manifests,
    manifestFiles,
    progress,
    checker: {
      accountId: String(global.checker.id),
      username: global.checker.username,
      password: global.checker.password,
      totpSecret: global.checker.totpSecret,
    },
  };
}

async function loginOperatorAndLoadMenus(page: Page, config: RepairConfig) {
  await loginOperator(page, config);
  const overview = await ok<{ tree: unknown[] }>(await page.request.get("/api/admin/platform/menus/overview"));
  return flattenMenus(overview.tree).reduce<Record<string, number>>((result, row) => {
    if (typeof row.menuCode === "string" && typeof row.id === "number") result[row.menuCode] = row.id;
    return result;
  }, {});
}

function buildPlans(config: RepairConfig, menuMap: Record<string, number>, progress: Progress): RolePlan[] {
  const suffix = progress.roleCodeSuffix
    ?? createHash("sha256").update(config.runId).digest("hex").slice(0, 10).toUpperCase();
  const plans: RolePlan[] = [];
  const allRead: string[] = [];
  const allMenus: string[] = [];
  for (const domain of DOMAINS) {
    const definition = DOMAIN_DEFINITIONS[domain];
    const menuCodes = [domain, ...(definition.menuCodes ?? definition.modules)];
    for (const code of menuCodes) {
      if (!menuMap[code]) throw new Error(`active menu ${code} is missing`);
    }
    const read = unique(definition.read);
    const maker = unique(definition.maker);
    for (const permission of CHECKER_ONLY) {
      expect(maker, `${domain} maker must not contain checker-only ${permission}`).not.toContain(permission);
    }
    plans.push({
      key: `${domain}.read`,
      domain,
      kind: "read",
      roleCode: `ACC_${domain}_RO_${suffix}`,
      roleName: `${config.runId} ${domain} 域精确只读`,
      permissions: read,
      menuCodes,
      menuIds: menuCodes.map((code) => menuMap[code]),
    });
    plans.push({
      key: `${domain}.maker`,
      domain,
      kind: "maker",
      roleCode: `ACC_${domain}_MK_${suffix}`,
      roleName: `${config.runId} ${domain} 域 maker`,
      permissions: maker,
      menuCodes,
      menuIds: menuCodes.map((code) => menuMap[code]),
    });
    allRead.push(...read);
    allMenus.push(...menuCodes);
  }
  plans.push({
    key: "CHECKER.checker",
    domain: "CHECKER",
    kind: "checker",
    roleCode: `ACC_CHECKER_${suffix}`,
    roleName: `${config.runId} 独立复核员`,
    permissions: unique([...allRead, ...CHECKER_ONLY, ...CHECKER_REQUIRED_MUTATIONS]),
    menuCodes: unique(allMenus),
    menuIds: unique(allMenus).map((code) => menuMap[code]),
  });
  return plans;
}

async function validatePlanPermissions(page: Page, plans: RolePlan[]) {
  const active = new Set<string>();
  let pageNum = 1;
  let total = Number.POSITIVE_INFINITY;
  while (active.size < total) {
    const result = await ok<{ total: number; records: Array<{ permissionCode?: string }> }>(
      await page.request.get(`/api/admin/platform/permissions?pageNum=${pageNum}&pageSize=100`),
    );
    total = result.total;
    for (const record of result.records) {
      if (record.permissionCode) active.add(record.permissionCode);
    }
    if (result.records.length === 0) break;
    pageNum += 1;
  }
  expect(active.size, "permission dictionary pagination must be complete").toBe(total);
  for (const plan of plans) {
    const unknown = plan.permissions.filter((permission) => !active.has(permission));
    expect(unknown, `${plan.key} contains unknown permissions`).toEqual([]);
  }
}

async function quarantineDomainAccounts(
  page: Page,
  config: RepairConfig,
  state: Awaited<ReturnType<typeof loadState>>,
) {
  const failures: string[] = [];
  for (const domain of DOMAINS) {
    for (const kind of ACCOUNT_KINDS) {
      const account = state.manifests[domain].accounts[kind];
      try {
        await assignAccountRole(
          page,
          config,
          state.progress,
          `${domain}.${kind}`,
          account.accountId,
          "unassigned",
        );
      } catch (error) {
        failures.push(`${domain}.${kind}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  for (const domain of DOMAINS) {
    for (const kind of ACCOUNT_KINDS) {
      const account = state.manifests[domain].accounts[kind];
      try {
        const current = await accountById(page, account.accountId);
        if ((current.role ?? "").toLowerCase() !== "unassigned" || Number(current.sessions ?? 0) !== 0) {
          failures.push(`${domain}.${kind}: role=${current.role ?? "missing"},sessions=${current.sessions ?? "missing"}`);
        }
      } catch (error) {
        failures.push(`${domain}.${kind}: verify ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(`fail-closed quarantine incomplete; no role may be approved:\n${failures.join("\n")}`);
  }
  const quarantinedDomainAssignments = DOMAINS.flatMap((domain) =>
    ACCOUNT_KINDS.map((kind) => state.progress.assignments[`${domain}.${kind}`]));
  expect(quarantinedDomainAssignments).toHaveLength(52);
  expect(quarantinedDomainAssignments.every((assignment) =>
    assignment?.role === "unassigned")).toBe(true);
}

async function bootstrapIndependentChecker(
  operatorPage: Page,
  browser: Browser,
  config: RepairConfig,
  state: Awaited<ReturnType<typeof loadState>>,
  checkerPlan: RolePlan,
) {
  let restricted = false;
  try {
    if (!state.progress.roles[checkerPlan.key]?.approved) {
      await assignAccountRole(
        operatorPage,
        config,
        state.progress,
        "CHECKER.bootstrap",
        state.checker.accountId,
        "super",
      );
      await approveGrantPlans(browser, config, state.checker, state.progress, [checkerPlan]);
    }
    await verifyRole(operatorPage, checkerPlan);
    await assignAccountRole(
      operatorPage,
      config,
      state.progress,
      "CHECKER.checker",
      state.checker.accountId,
      checkerPlan.roleCode.toLowerCase(),
    );
    await loginAndSnapshot(
      browser,
      config.baseUrl,
      state.checker,
      checkerPlan.permissions,
      checkerPlan.menuCodes,
    );
    restricted = true;
  } finally {
    if (!restricted) {
      try {
        await assignAccountRole(
          operatorPage,
          config,
          state.progress,
          "CHECKER.failclosed",
          state.checker.accountId,
          "unassigned",
        );
        const current = await accountById(operatorPage, state.checker.accountId);
        if ((current.role ?? "").toLowerCase() !== "unassigned" || Number(current.sessions ?? 0) !== 0) {
          throw new Error(`checker fail-closed verification failed: role=${current.role},sessions=${current.sessions}`);
        }
      } catch (cleanupError) {
        throw new Error(`checker bootstrap failed and fail-closed cleanup also failed: ${
          cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
        }`);
      }
    }
  }
}

async function ensureRoleAndGrant(
  page: Page,
  config: RepairConfig,
  progress: Progress,
  plan: RolePlan,
) {
  const overview = await ok<{
    roles: Array<{
      id: number;
      roleCode: string;
      roleName?: string;
      remark?: string;
      builtin?: boolean;
      adminCount?: number;
    }>;
  }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const existing = overview.roles.find((role) => role.roleCode === plan.roleCode);
  if (existing && (
    existing.roleName !== plan.roleName
    || !existing.remark?.includes(config.runId)
    || existing.builtin === true
  )) {
    throw new Error(`${plan.key} roleCode collision with a foreign or builtin role`);
  }
  const role = existing ?? await ok<{ id: number; roleCode: string }>(
    await page.request.post("/api/admin/platform/roles", {
      headers: { "Idempotency-Key": `${config.runId}:${plan.key}:role:create` },
      data: {
        roleCode: plan.roleCode,
        roleName: plan.roleName,
        remark: `${config.runId} isolated acceptance role; cleanup after signed report`,
        status: 1,
        reason: `${config.runId} create isolated ${plan.key} acceptance role`,
        operator: config.operator,
      },
    }),
  );
  plan.roleId = Number(role.id);
  progress.roles[plan.key] = { ...(progress.roles[plan.key] ?? {}), roleId: plan.roleId };
  await persistProgress(config, progress);
  await recordRoleCleanup(config, plan);

  const detail = await ok<{
    roleCode?: string;
    roleName?: string;
    remark?: string;
    builtin?: boolean;
    permissionCodes?: string[];
    menuIds?: number[];
  }>(
    await page.request.get(`/api/admin/platform/roles/${plan.roleId}`),
  );
  if (
    detail.roleCode !== plan.roleCode
    || detail.roleName !== plan.roleName
    || !detail.remark?.includes(config.runId)
    || detail.builtin === true
  ) {
    throw new Error(`${plan.key} persisted role identity does not belong to this Run`);
  }
  if (sameSet(detail.permissionCodes ?? [], plan.permissions)
      && sameSet((detail.menuIds ?? []).map(String), plan.menuIds.map(String))) {
    progress.roles[plan.key].approved = true;
    await persistProgress(config, progress);
    return;
  }
  const persistedGrant = progress.roles[plan.key];
  if (persistedGrant.ticketId && persistedGrant.approved !== true && plan.key !== "CHECKER.checker") {
    // These A-M tickets were created by this Run before the checker role was
    // repaired. Reuse the still-pending locked operation instead of creating a
    // second proposal for the same A6 target.
    plan.ticketId = persistedGrant.ticketId;
    return;
  }
  const grantFingerprint = createHash("sha256")
    .update(JSON.stringify({
      permissionCodes: [...plan.permissions].sort(),
      menuIds: [...plan.menuIds].sort((left, right) => left - right),
    }))
    .digest("hex")
    .slice(0, 16);
  const ticket = await ok<Record<string, unknown>>(
    await page.request.put(`/api/admin/platform/roles/${plan.roleId}/grants`, {
      headers: { "Idempotency-Key": `${config.runId}:${plan.key}:grants:${grantFingerprint}` },
      data: {
        permissionCodes: plan.permissions,
        menuIds: plan.menuIds,
        reason: `${config.runId} exact grants for ${plan.key}`,
        operator: config.operator,
      },
    }),
  );
  plan.ticketId = String(ticket.operationId ?? ticket.id ?? "");
  expect(plan.ticketId).toMatch(/^(?:WO|OP)-/);
  progress.roles[plan.key].ticketId = plan.ticketId;
  progress.roles[plan.key].approved = false;
  progress.roles[plan.key].grantFingerprint = grantFingerprint;
  await persistProgress(config, progress);
}

async function approveGrantPlans(
  browser: Browser,
  config: RepairConfig,
  checker: { username: string; password: string; totpSecret: string },
  progress: Progress,
  plans: RolePlan[],
) {
  const pending = plans.filter((plan) => !progress.roles[plan.key]?.approved);
  if (pending.length === 0) return;
  const context = await browser.newContext({ baseURL: config.baseUrl });
  const page = await context.newPage();
  try {
    await loginWithMfa(page, config.baseUrl, checker);
    for (const plan of pending) {
      const ticketId = plan.ticketId ?? progress.roles[plan.key]?.ticketId;
      if (!ticketId) throw new Error(`${plan.key} has no grant ticket`);
      const approvalFingerprint = createHash("sha256").update(ticketId).digest("hex").slice(0, 16);
      const response = await page.request.post(`/api/admin/platform/audit/operations/${ticketId}/approve`, {
        headers: { "Idempotency-Key": `${config.runId}:${plan.key}:approve:${approvalFingerprint}` },
        data: { reason: `${config.runId} independent checker approves exact ${plan.key} grants` },
      });
      const raw = await response.text();
      if (response.status() >= 400) throw new Error(`${plan.key} approval ${response.status()}: ${raw}`);
      const payload = JSON.parse(raw) as Envelope<unknown>;
      if ((payload.code ?? 0) !== 0) throw new Error(`${plan.key} approval failed: ${raw}`);
      progress.roles[plan.key].approved = true;
      await persistProgress(config, progress);
    }
  } finally {
    await context.close();
  }
}

async function verifyRole(page: Page, plan: RolePlan) {
  const roleId = plan.roleId;
  if (!roleId) throw new Error(`${plan.key} role ID missing`);
  const detail = await ok<{ permissionCodes?: string[]; menuIds?: number[] }>(
    await page.request.get(`/api/admin/platform/roles/${roleId}`),
  );
  expect(sameSet(detail.permissionCodes ?? [], plan.permissions), `${plan.key} permission exact set`).toBe(true);
  expect(sameSet((detail.menuIds ?? []).map(String), plan.menuIds.map(String)), `${plan.key} menu exact set`).toBe(true);
}

async function assignAccountRole(
  page: Page,
  config: RepairConfig,
  progress: Progress,
  key: string,
  accountId: string,
  desiredRole: string,
) {
  let current = await accountById(page, accountId);
  if (
    desiredRole.toLowerCase() === "super"
    && (current.role ?? "").toLowerCase() !== "super"
    && Number(current.sessions ?? 0) > 0
  ) {
    await ok(await page.request.post(`/api/admin/platform/accounts/${accountId}/sessions/revoke`, {
      headers: { "Idempotency-Key": `${config.runId}:${key}:pre-elevation-revoke:v${current.version}` },
      data: {
        operator: config.operator,
        reason: `${config.runId} revoke lower-privilege sessions before temporary checker elevation`,
        expectedVersion: String(current.version),
      },
    }));
    current = await accountById(page, accountId);
  }
  if ((current.role ?? "").toLowerCase() !== desiredRole.toLowerCase()) {
    await ok(await page.request.patch(`/api/admin/platform/accounts/${accountId}/role`, {
      headers: { "Idempotency-Key": `${config.runId}:${key}:role:${desiredRole}:v${current.version}` },
      data: {
        role: desiredRole,
        operator: config.operator,
        reason: `${config.runId} replace global fixture role with exact ${key} role`,
        expectedVersion: String(current.version),
      },
    }));
  }
  const afterRole = await accountById(page, accountId);
  if (Number(afterRole.sessions ?? 0) > 0) {
    await ok(await page.request.post(`/api/admin/platform/accounts/${accountId}/sessions/revoke`, {
      headers: { "Idempotency-Key": `${config.runId}:${key}:revoke:v${afterRole.version}` },
      data: {
        operator: config.operator,
        reason: `${config.runId} force clean login after exact role assignment`,
        expectedVersion: String(afterRole.version),
      },
    }));
  }
  progress.assignments[key] = { accountId, role: desiredRole, verified: false };
  await persistProgress(config, progress);
}

async function accountById(page: Page, accountId: string) {
  const overview = await ok<{ operators: AccountRow[] }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  const current = overview.operators.find((account) => String(account.id) === accountId);
  if (!current) throw new Error(`account ${accountId} is missing`);
  return current;
}

async function loginOperator(page: Page, config: RepairConfig) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(config.operator);
  await page.locator('input[autocomplete="current-password"]').fill(config.operatorPassword);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginWithMfa(
  page: Page,
  baseUrl: string,
  account: { username: string; password: string; totpSecret: string },
) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  const consoleShell = page.locator("aside");
  let cookieState = {
    cookiePresent: false,
    setCookiePresent: false,
    installed: false,
    cookieDomains: [] as string[],
    requestForwardedProto: "none",
    requestOrigin: "unknown",
    responseOrigin: "unknown",
  };
  let accessTokenExposed = false;
  let authState: "console" | "mfa" | null = null;
  const authDeadline = Date.now() + 15_000;
  while (Date.now() < authDeadline && authState === null) {
    if (await consoleShell.isVisible().catch(() => false)) authState = "console";
    else if (await otp.isVisible().catch(() => false)) authState = "mfa";
    else await page.waitForTimeout(200);
  }
  if (authState === null) {
    throw new Error("MFA_LOGIN_STATE_NOT_REACHED");
  }
  if (authState === "mfa") {
    await freshTotpWindow(account.totpSecret);
    await otp.fill(currentTotp(account.totpSecret));
    const responsePromise = page.waitForResponse((response) =>
      response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verification = await responsePromise;
    const payload = await verification.json().catch(() => null) as Envelope<{
      session?: unknown;
      accessToken?: unknown;
    }> | null;
    accessTokenExposed = typeof payload?.data?.accessToken === "string";
    const explicitEnvelopeFailure = typeof payload?.code === "number" && payload.code !== 0;
    if (!verification.ok() || explicitEnvelopeFailure) {
      throw new Error(
        `MFA_VERIFY_FAILED status=${verification.status()} code=${payload?.code ?? "unknown"} message=${payload?.message ?? "unknown"}`,
      );
    }
    // The browser session endpoint is the authority.  A successful verify may
    // trigger a document transition before Playwright can retain its JSON body,
    // so do not turn an unreadable 200 body into a false failure.
    cookieState = await ensureAdminCookieFromVerifyResponse(page, baseUrl, verification);
  }
  let browserSession = {
    status: 0,
    code: "unknown" as number | string,
    sessionPresent: false,
  };
  const sessionDeadline = Date.now() + 15_000;
  while (Date.now() < sessionDeadline) {
    browserSession = await page.evaluate(async () => {
      const response = await fetch("/api/admin/auth/session", { cache: "no-store" });
      const payload = await response.json().catch(() => null) as Envelope<{ session?: unknown }> | null;
      return {
        status: response.status,
        code: payload?.code ?? "unknown",
        sessionPresent: Boolean(payload?.data?.session),
      };
    }).catch(() => ({ status: 0, code: "navigation", sessionPresent: false }));
    if (browserSession.status < 400 && browserSession.code === 0 && browserSession.sessionPresent) break;
    await page.waitForTimeout(250);
  }
  if (browserSession.status >= 400 || browserSession.code !== 0 || !browserSession.sessionPresent) {
    throw new Error(
      `MFA_VERIFY_SESSION_NOT_ESTABLISHED status=${browserSession.status} code=${browserSession.code} accessTokenExposed=${accessTokenExposed} requestForwardedProto=${cookieState.requestForwardedProto} requestOrigin=${cookieState.requestOrigin} responseOrigin=${cookieState.responseOrigin} cookiePresent=${cookieState.cookiePresent} setCookiePresent=${cookieState.setCookiePresent} installed=${cookieState.installed} cookieDomains=${cookieState.cookieDomains.join("|") || "none"}`,
    );
  }
  if (!await consoleShell.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await expect(consoleShell).toBeVisible({ timeout: 30_000 });
}

async function ensureAdminCookieFromVerifyResponse(
  page: Page,
  baseUrl: string,
  verification: Pick<Response, "allHeaders">,
) {
  const cookieName = "nexion_admin_token";
  const requestHeaders = await (verification as Response).request().allHeaders();
  const requestOrigin = await page.evaluate(() => window.location.origin);
  const responseOrigin = new URL((verification as Response).url()).origin;
  const metadata = {
    requestForwardedProto: requestHeaders["x-forwarded-proto"] ?? "none",
    requestOrigin,
    responseOrigin,
  };
  const existing = (await page.context().cookies()).filter((cookie) => cookie.name === cookieName);
  if (existing.length > 0) {
    return {
      cookiePresent: true,
      setCookiePresent: true,
      installed: false,
      cookieDomains: existing.map((cookie) => cookie.domain),
      ...metadata,
    };
  }
  const setCookie = (await verification.allHeaders())["set-cookie"] ?? "";
  const match = setCookie.match(new RegExp(`(?:^|,\\s*)${cookieName}=([^;]+)`));
  if (!match?.[1]) {
    return { cookiePresent: false, setCookiePresent: false, installed: false, cookieDomains: [], ...metadata };
  }
  const parsed = new URL(baseUrl);
  await page.context().addCookies([{
    name: cookieName,
    value: match[1],
    domain: parsed.hostname,
    path: "/",
    httpOnly: true,
    secure: parsed.protocol === "https:",
    sameSite: "Strict",
  }]);
  return {
    cookiePresent: false,
    setCookiePresent: true,
    installed: true,
    cookieDomains: [parsed.hostname],
    ...metadata,
  };
}

async function loginAndSnapshot(
  browser: Browser,
  baseUrl: string,
  account: FixtureAccount | { username: string; password: string; totpSecret: string },
  expectedPermissions: string[],
  expectedMenuCodes: string[],
): Promise<SessionShape> {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await loginWithMfa(page, baseUrl, account);
    const data = await ok<{
      session?: {
        authorities?: string[];
        menuCodes?: string[];
        effectiveMenus?: Array<string | { menuCode?: string }>;
      };
    }>(await page.request.get("/api/admin/auth/session"));
    const session = {
      authorities: data.session?.authorities ?? [],
      menuCodes: data.session?.menuCodes
        ?? (data.session?.effectiveMenus ?? []).map((menu) =>
          typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean),
    };
    expect(sameSet(session.authorities, expectedPermissions), "exact session authorities").toBe(true);
    expect(sameSet(session.menuCodes, expectedMenuCodes), "exact session menus").toBe(true);
    return session;
  } finally {
    await context.close();
  }
}

async function extendCleanupManifest(
  config: RepairConfig,
  state: Awaited<ReturnType<typeof loadState>>,
  plans: RolePlan[],
) {
  const file = path.join(config.fixtureDir, "cleanup-manifest.json");
  const cleanup = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  cleanup.roles = plans.map((plan) => ({
    roleId: plan.roleId,
    roleCode: plan.roleCode,
    action: "after all run accounts are disabled/unassigned, delete through A6 proposal and independent approval",
  }));
  cleanup.checker = {
    accountId: state.checker.accountId,
    action: "revoke sessions, reset 2FA, role=unassigned, disable after all non-owner reviews",
  };
  await atomicJson(file, cleanup);
  for (const domain of DOMAINS) {
    state.manifests[domain].roles = plans
      .filter((plan) => plan.domain === domain)
      .map((plan) => ({
        roleId: plan.roleId,
        roleCode: plan.roleCode,
        permissionCodes: plan.permissions,
        menuIds: plan.menuIds,
        grantTicketId: plan.ticketId ?? "PREVIOUSLY_APPROVED",
      }));
    await atomicJson(state.manifestFiles[domain], state.manifests[domain]);
  }
}

async function recordRoleCleanup(config: RepairConfig, plan: RolePlan) {
  const file = path.join(config.fixtureDir, "cleanup-manifest.json");
  const cleanup = JSON.parse(await readFile(file, "utf8")) as {
    [key: string]: unknown;
    roles?: Array<Record<string, unknown>>;
  };
  const roles = cleanup.roles ?? [];
  const row = {
    roleId: plan.roleId,
    roleCode: plan.roleCode,
    action: "after all run accounts are disabled/unassigned, delete through A6 proposal and independent approval",
  };
  const index = roles.findIndex((role) => role.roleCode === plan.roleCode);
  if (index >= 0) roles[index] = row;
  else roles.push(row);
  cleanup.roles = roles;
  await atomicJson(file, cleanup);
}

async function persistProgress(config: RepairConfig, progress: Progress) {
  await atomicJson(path.join(config.fixtureDir, "role-repair-progress.json"), progress);
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

function flattenMenus(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const wrapper = entry as Record<string, unknown>;
    const node = wrapper.node && typeof wrapper.node === "object" && !Array.isArray(wrapper.node)
      ? wrapper.node as Record<string, unknown>
      : wrapper;
    return [node, ...flattenMenus(wrapper.children ?? node.children)];
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sameSet(left: string[], right: string[]) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function ok<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as Envelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

async function freshTotpWindow(secret: string) {
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  const secretHash = createHash("sha256").update(secret).digest("hex");
  let step = Math.floor(Date.now() / 30_000);
  const lastStep = lastTotpStepBySecretHash.get(secretHash);
  if (lastStep !== undefined && step <= lastStep) {
    const waitMs = ((lastStep + 1) * 30_000) - Date.now() + 500;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    step = Math.floor(Date.now() / 30_000);
  }
  lastTotpStepBySecretHash.set(secretHash, step);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
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
