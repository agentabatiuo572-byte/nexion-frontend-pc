import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveVisibleDomains,
  menuCodesFromAuthorities,
  canAccessResolvedPath,
  findByPath,
} from "../lib/nav/console-nav.ts";
import { normalizeEffectiveMenuNodes, normalizeEffectiveMenus, normalizeSessionRole } from "../lib/admin/session-role.ts";
import { completeInteractiveLogin } from "../lib/admin/login-completion.ts";
import { buildRoleMetadataPayload, buildRoleStatusPayload, mutateThenReloadOverview, normalizeProposalTicket } from "../lib/admin/platform-contracts.ts";

test("backend menu grants override the static role fallback", () => {
  const domains = resolveVisibleDomains({
    role: "config",
    menuCodes: ["A", "A6", "A8"],
    authorities: [],
  });

  assert.deepEqual(domains.map((domain) => domain.code), ["A"]);
  assert.deepEqual(domains[0].l2.map((item) => item.id), ["A6", "A8"]);
});

test("an explicit empty backend grant set grants no console pages", () => {
  assert.deepEqual(
    resolveVisibleDomains({ role: "superadmin", menuCodes: [], authorities: [] }),
    [],
  );
});

test("route guard denies ungranted pages and nested URLs inside a known domain", () => {
  const domains = resolveVisibleDomains({ role: "custom", menuCodes: ["A6"] });
  assert.equal(canAccessResolvedPath(domains, "/platform/roles"), true);
  assert.equal(canAccessResolvedPath(domains, "/platform/roles/42"), true);
  assert.equal(canAccessResolvedPath(domains, "/platform/menus"), false);
  assert.equal(canAccessResolvedPath(domains, "/platform"), false);
});

test("authorities align config and auditor navigation when menu grants are absent", () => {
  assert.deepEqual(
    menuCodesFromAuthorities([
      "platform_a6_read",
      "platform_a8_read",
      "device_e1_read",
    ]),
    ["A6", "A8", "E1"],
  );

  const domains = resolveVisibleDomains({
    role: "auditor",
    authorities: ["platform_a6_read", "analytics_l5_read"],
  });
  assert.deepEqual(domains.flatMap((domain) => domain.l2.map((item) => item.id)), ["A6", "L5"]);
});

test("custom role codes survive session normalization", () => {
  assert.equal(normalizeSessionRole("PARTNER_REVIEWER"), "PARTNER_REVIEWER");
  assert.equal(normalizeSessionRole("CONFIG_ADMIN"), "config");
  assert.equal(normalizeSessionRole(undefined), "auditor");
});

test("login wire consumes backend effectiveMenus and preserves explicit empty grants", () => {
  assert.deepEqual(normalizeEffectiveMenus({ effectiveMenus: ["A6", " A8 ", "MENU_CONTENT_I4", "MENU_CONTENT_I5"] }), ["A6", "A8", "I4", "I5"]);
  assert.deepEqual(normalizeEffectiveMenus({ effectiveMenus: [] }), []);
  assert.deepEqual(normalizeEffectiveMenus({ effectiveMenus: ["MENU_RISK", "MENU_RISK_K6"] }), ["K", "K6"]);
  assert.deepEqual(normalizeEffectiveMenus({ menuCodes: ["L5"] }), ["L5"]);
  assert.equal(normalizeEffectiveMenus({}), undefined);
  assert.equal(normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [{ menuCode: "I7", menuName: "教程中心", routePath: "/content/learn", parentCode: "I", sortOrder: null }],
  })?.[0].sortOrder, null);
  assert.deepEqual(normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "MENU_CONTENT_I4", menuName: "信任中心 CMS", routePath: "/content/trust", parentCode: "I", sortOrder: 4 },
      { menuCode: "MENU_CONTENT_I5", menuName: "风险披露版本", routePath: "/content/disclosures", parentCode: "I", sortOrder: 5 },
    ],
  })?.map((node) => node.menuCode), ["I4", "I5"]);
});

test("classic database menu aliases render the split I4 and I5 pages", () => {
  const menuCodes = normalizeEffectiveMenus({ effectiveMenus: ["I", "MENU_CONTENT_I4", "MENU_CONTENT_I5"] });
  const menuNodes = normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "I", menuName: "内容与合规 CMS", routePath: "", parentCode: null, sortOrder: 9 },
      { menuCode: "MENU_CONTENT_I4", menuName: "信任中心 CMS", routePath: "/content/trust", parentCode: "I", sortOrder: 4 },
      { menuCode: "MENU_CONTENT_I5", menuName: "风险披露版本", routePath: "/content/disclosures", parentCode: "I", sortOrder: 5 },
    ],
  });
  const content = resolveVisibleDomains({ role: "superadmin", menuCodes, menuNodes }).find((domain) => domain.code === "I");

  assert.deepEqual(content?.l2.map((item) => [item.id, item.name, item.path]), [
    ["I4", "信任中心 CMS", "/content/trust"],
    ["I5", "风险披露版本", "/content/disclosures"],
  ]);
});

test("a stale K6 alias row cannot overwrite the canonical K6 menu metadata", () => {
  const menuCodes = normalizeEffectiveMenus({ effectiveMenus: ["K", "K6", "MENU_RISK_K6"] });
  const menuNodes = normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "K", menuName: "风控与反作弊", routePath: "/risk", parentCode: null, sortOrder: 10 },
      { menuCode: "K6", menuName: "Janus C2 控制台", routePath: "/risk/janus-c2", parentCode: "K", sortOrder: 6 },
      { menuCode: "MENU_RISK_K6", menuName: "Janus C2 控制台", routePath: "/risk/janus-c2", parentCode: null, sortOrder: 2006 },
    ],
  });
  const risk = resolveVisibleDomains({ role: "superadmin", menuCodes, menuNodes })
    .find((domain) => domain.code === "K");

  assert.equal(risk?.l2.some((item) => item.id === "K6"), true);
});

test("a complete K6 alias row repairs incomplete canonical metadata", () => {
  const menuCodes = normalizeEffectiveMenus({ effectiveMenus: ["K", "K6", "MENU_RISK_K6"] });
  const menuNodes = normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "K", menuName: "风控与反作弊", routePath: "/risk", parentCode: null, sortOrder: 10 },
      { menuCode: "K6", menuName: "Janus C2 控制台", routePath: null, parentCode: null, sortOrder: null },
      { menuCode: "MENU_RISK_K6", menuName: "Janus C2 控制台", routePath: "/risk/janus-c2", parentCode: "MENU_RISK", sortOrder: 6 },
    ],
  });
  const risk = resolveVisibleDomains({ role: "superadmin", menuCodes, menuNodes })
    .find((domain) => domain.code === "K");

  assert.equal(risk?.l2.some((item) => item.id === "K6"), true);
});

test("K6 visibility ignores a more complete alias with a stale route", () => {
  const menuCodes = normalizeEffectiveMenus({ effectiveMenus: ["K", "K6", "MENU_RISK_K6"] });
  const menuNodes = normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "K", menuName: "风控与反作弊", routePath: "/risk", parentCode: null, sortOrder: 10 },
      { menuCode: "K6", menuName: "Janus C2 控制台", routePath: "/risk/janus-c2", parentCode: "K", sortOrder: null },
      { menuCode: "MENU_RISK_K6", menuName: "旧 Janus 页面", routePath: "/risk/old-janus", parentCode: "MENU_RISK", sortOrder: 6 },
    ],
  });
  const risk = resolveVisibleDomains({ role: "superadmin", menuCodes, menuNodes })
    .find((domain) => domain.code === "K");

  assert.equal(risk?.l2.find((item) => item.id === "K6")?.path, "/risk/janus-c2");
});

test("interactive login reloads the document after storing the new session", () => {
  const calls = [];
  const auth = { tokenType: "Bearer", session: { adminId: 1, username: "superadmin" } };

  completeInteractiveLogin(
    (result) => calls.push(["signIn", result]),
    auth,
    () => calls.push(["reload"]),
  );

  assert.deepEqual(calls, [["signIn", auth], ["reload"]]);
});

test("legacy I7 grants resolve to the merged I6 page", () => {
  const domains = resolveVisibleDomains({ role: "content", menuCodes: ["I", "I7"] });
  const content = domains.find((domain) => domain.code === "I");

  assert.deepEqual(content?.l2.map((item) => [item.id, item.path]), [["I6", "/content/i18n"]]);
  assert.equal(findByPath("/content/learn"), null);
  assert.equal(canAccessResolvedPath(domains, "/content/learn"), false);
  assert.equal(canAccessResolvedPath(domains, "/content/i18n"), true);
});

test("A7 effective menu metadata controls labels and ordering without allowing unregistered routes", () => {
  const menuNodes = normalizeEffectiveMenuNodes({
    effectiveMenuNodes: [
      { menuCode: "I7", menuName: "教程配置", routePath: "/content/learn", parentCode: "I", sortOrder: 1 },
      { menuCode: "I1", menuName: "文案实验", routePath: "/content/copy-ab", parentCode: "I", sortOrder: 2 },
      { menuCode: "UNKNOWN", menuName: "未部署页面", routePath: "/unknown", parentCode: "I", sortOrder: 0 },
    ],
  });
  const domains = resolveVisibleDomains({ role: "content", menuCodes: ["I", "I1", "I7", "UNKNOWN"], menuNodes });
  const content = domains.find((domain) => domain.code === "I");

  assert.deepEqual(content?.l2.map((item) => [item.id, item.name, item.path]), [
    ["I6", "i18n 文案与课程", "/content/i18n"],
    ["I1", "文案实验", "/content/copy-ab"],
  ]);
});

test("legacy I7 metadata is accepted only as the registered I6 compatibility alias", () => {
  assert.deepEqual(resolveVisibleDomains({ role: "content", menuCodes: ["I7"], menuNodes: [] }), []);
  const domains = resolveVisibleDomains({
    role: "content",
    menuCodes: ["I7"],
    menuNodes: [{ menuCode: "I7", menuName: "教程中心", routePath: "/external", parentCode: "I", sortOrder: 1 }],
  });
  assert.equal(domains[0]?.l2[0]?.path, "/content/i18n");
});

test("A7 mutations reload the authoritative overview instead of normalizing node/void", async () => {
  const calls = [];
  const overview = { tree: [{ id: 1 }], domainCount: 1, pageCount: 0, activeCount: 1 };
  const result = await mutateThenReloadOverview(
    async () => { calls.push("mutate"); return { id: 1 }; },
    async () => { calls.push("reload"); return overview; },
  );

  assert.deepEqual(calls, ["mutate", "reload"]);
  assert.equal(result, overview);
});

test("A6 direct high-risk endpoints are modeled as proposal tickets, not applied details", () => {
  assert.deepEqual(normalizeProposalTicket({
    id: "A2-42",
    action: "A6_ROLE_GRANTS_CHANGED",
    status: "pending",
    roleGate: "TWO_PERSON",
    amplifies: true,
  }), {
    id: "A2-42",
    action: "A6_ROLE_GRANTS_CHANGED",
    status: "pending",
    roleGate: "TWO_PERSON",
    amplifies: true,
  });
  assert.equal(normalizeProposalTicket({ id: "", status: "pending" }), null);
});

test("A6 metadata save and status approval use disjoint payloads", () => {
  assert.deepEqual(buildRoleMetadataPayload(" 风控复核 ", " 仅看告警 "), {
    roleName: "风控复核",
    remark: "仅看告警",
  });
  assert.deepEqual(buildRoleStatusPayload(1), { status: 1 });
  assert.deepEqual(buildRoleStatusPayload(0), { status: 0 });
  assert.throws(() => buildRoleStatusPayload(2), /A6_ROLE_STATUS_INVALID/);
});
