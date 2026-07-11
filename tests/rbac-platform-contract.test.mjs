import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveVisibleDomains,
  menuCodesFromAuthorities,
  canAccessResolvedPath,
} from "../lib/nav/console-nav.ts";
import { normalizeEffectiveMenus, normalizeSessionRole } from "../lib/admin/session-role.ts";
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
  assert.deepEqual(normalizeEffectiveMenus({ effectiveMenus: ["A6", " A8 "] }), ["A6", "A8"]);
  assert.deepEqual(normalizeEffectiveMenus({ effectiveMenus: [] }), []);
  assert.deepEqual(normalizeEffectiveMenus({ menuCodes: ["L5"] }), ["L5"]);
  assert.equal(normalizeEffectiveMenus({}), undefined);
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
