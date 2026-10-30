import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  CLIENT_WRITE_EXCEPTIONS,
  collectHighOpCandidates,
  collectActiveNavLeaves,
  collectClientWriteSymbols,
  evaluateManifestClaims,
  validateRuntimeEvidence,
  validateServiceDelegations,
  auditRepositoryReverseCoverage,
} from "../scripts/lib/ops-actions-reverse-coverage.mjs";

test("retired legacy stores are optional while primary sources and present-store writes stay audited", () => {
  // Small source fixtures live in the project's trash area and are never hard-deleted.
  const archive = join(process.cwd(), ".trash", "reverse-coverage-tests");
  mkdirSync(archive, { recursive: true });
  const fixture = ({ app = true, admin = true } = {}) => {
    const root = mkdtempSync(join(archive, "case-"));
    const write = (file, source) => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), source); };
    write("lib/nav/console-nav.ts", 'export const nav = [{id:"A1",path:"/platform/accounts",status:"flagship"}];');
    if (admin) {
      write("lib/admin/high-ops-registry.ts", "export const HIGH_OPS=[];");
      write("lib/admin/a1-client.ts", 'export function updateA1Status(){return request("/accounts/1",{method:"PATCH"});}');
    }
    if (app) write("app/_console/platform/accounts/page.tsx", "export function Accounts(){return <p>Accounts</p>;}");
    return { root, write };
  };
  const manifest = { activeLeafCoverage: { A1: ["read-a1"] }, rows: [{ id: "read-a1", status: "readonly", reason: "read-only fixture" }] };
  const normal = fixture();
  assert.deepEqual(auditRepositoryReverseCoverage({ root: normal.root, manifest }).problems, []);
  normal.write("lib/store/admin/a1.ts", 'export function retainedCaller(){updateA1Status();}');
  assert.match(auditRepositoryReverseCoverage({ root: normal.root, manifest }).problems.join("\n"), /updateA1Status/);
  for (const missing of [{ app: false }, { admin: false }]) {
    const broken = fixture(missing);
    assert.throws(() => auditRepositoryReverseCoverage({ root: broken.root, manifest }), { code: "ENOENT" });
  }
});

test("semantic POST queries use exact documented exceptions", () => {
  assert.deepEqual(Object.keys(CLIENT_WRITE_EXCEPTIONS).toSorted(), ["estimateI3Audience", "previewB5Thresholds"]);
  for (const reason of Object.values(CLIENT_WRITE_EXCEPTIONS)) assert.match(reason, /does not persist state/);
});

test("active navigation leaves are derived from nav source rather than domain letters", () => {
  const source = `
    export const CONSOLE_NAV = [{ code: "A", l2: [
      { id: "A1", label: "Accounts", path: "/platform/accounts", status: "flagship" },
      { id: "A5", label: "Params", path: "/platform/params-registry", status: "flagship" },
    ] }];
  `;
  assert.deepEqual(collectActiveNavLeaves(source), [
    { id: "A1", path: "/platform/accounts" },
    { id: "A5", path: "/platform/params-registry" },
  ]);
});

test("dynamic high-op extraction follows conditionals and local resolver return values", () => {
  const source = `
    function resolveFOp(key) {
      if (key.startsWith("F.commission.")) return "f_commission_status";
      if (key.startsWith("F.unilevel.")) return "f_unilevel_rule";
      return "f_ui_config";
    }
    const op = resolveFOp(key);
    findHighOp(op);
    findHighOp(editName ? "e1_sku_update" : "e1_sku_create");
  `;

  assert.deepEqual(
    [...collectHighOpCandidates(source)].toSorted(),
    ["e1_sku_create", "e1_sku_update", "f_commission_status", "f_ui_config", "f_unilevel_rule"],
  );
});

test("PC client write discovery is based on HTTP semantics, not a handwritten action list", () => {
  const source = `
    export async function updateA1Status() {
      return request("/accounts/1", { method: "PATCH" });
    }
    export const A_ACTIONS = {
      createA1Account: () => request("/accounts", { method: "POST" }),
      loadA1Accounts: () => request("/accounts", { method: "GET" }),
    };
  `;

  assert.deepEqual(
    [...collectClientWriteSymbols(source)].toSorted(),
    ["createA1Account", "updateA1Status"],
  );
});

test("each active write point must have exactly one manifest claim", () => {
  const manifest = {
    activeLeafCoverage: { A1: ["OPS-A-01", "OPS-A-02"] },
    rows: [
      { id: "OPS-A-01", restActions: ["updateA1Status"] },
      { id: "OPS-A-02", restAction: "updateA1Status" },
    ],
  };

  const duplicate = evaluateManifestClaims({
    manifest,
    writePoints: [{ leaf: "A1", action: "updateA1Status", file: "a1.tsx", line: 7, kind: "client" }],
  });
  assert.match(duplicate.problems.join("\n"), /exactly one.*found 2/i);

  manifest.rows[1].restAction = "createA1Account";
  const unclaimed = evaluateManifestClaims({
    manifest,
    writePoints: [{ leaf: "A1", action: "deleteA1Account", file: "a1.tsx", line: 9, kind: "client" }],
  });
  assert.match(unclaimed.problems.join("\n"), /exactly one.*found 0/i);

  const covered = evaluateManifestClaims({
    manifest,
    writePoints: [{ leaf: "A1", action: "updateA1Status", file: "a1.tsx", line: 7, kind: "client" }],
  });
  assert.deepEqual(covered.problems, []);
});

test("service-delegation evidence checks controller call and service method without changing status", () => {
  const files = new Map([
    ["backend/AdminController.java", "class AdminController { Result update() { return accountService.updateStatus(); } }"],
    ["backend/AccountService.java", "class AccountService { public Result updateStatus() { return Result.ok(); } }"],
  ]);
  const manifest = {
    rows: [{
      id: "OPS-A-01",
      status: "pending",
      serviceDelegations: [{
        controllerFile: "backend/AdminController.java",
        controllerCall: "accountService.updateStatus(",
        serviceFile: "backend/AccountService.java",
        serviceMethod: "updateStatus",
      }],
    }],
  };

  assert.deepEqual(validateServiceDelegations(manifest, (file) => files.get(file)), []);
  manifest.rows[0].serviceDelegations[0].serviceMethod = "missingMethod";
  assert.match(validateServiceDelegations(manifest, (file) => files.get(file)).join("\n"), /missingMethod/);
});

test("typed runtime evidence requires a real file plus positive and negative regex oracles", () => {
  const files = new Map([
    ["pc/app/runtime.tsx", "startCanonicalRuntime();\n// production path"],
    ["backend/RuntimeService.java", "class RuntimeService { void consumeCanonicalConfig() {} }"],
  ]);
  const manifest = {
    rows: [{
      id: "OPS-E-18",
      status: "built",
      runtimeEvidence: [{
        type: "pc-runtime",
        file: "app/runtime.tsx",
        positivePatterns: ["startCanonicalRuntime\\(\\)"],
        negativePatterns: ["MOCK_ONLY", "TODO"],
      }, {
        type: "backend-runtime",
        file: "RuntimeService.java",
        positivePatterns: ["consumeCanonicalConfig"],
        negativePatterns: ["throw new UnsupportedOperationException"],
      }],
    }],
  };

  assert.deepEqual(validateRuntimeEvidence(manifest, (type, file) => files.get(`${type === "pc-runtime" ? "pc" : "backend"}/${file}`)), []);

  manifest.rows[0].runtimeEvidence[0].positivePatterns = ["missingCall"];
  assert.match(validateRuntimeEvidence(manifest, (type, file) => files.get(`${type === "pc-runtime" ? "pc" : "backend"}/${file}`)).join("\n"), /positive pattern.*missingCall/i);

  manifest.rows[0].runtimeEvidence[0].positivePatterns = ["startCanonicalRuntime"];
  manifest.rows[0].runtimeEvidence[0].negativePatterns = ["production path"];
  assert.match(validateRuntimeEvidence(manifest, (type, file) => files.get(`${type === "pc-runtime" ? "pc" : "backend"}/${file}`)).join("\n"), /negative pattern.*production path/i);
});
