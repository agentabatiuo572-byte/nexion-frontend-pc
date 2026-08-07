import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveNexionAppRoot,
  resolveNexionBackendRoot,
} from "./lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const BACKEND_ROOT = resolveNexionBackendRoot({ adminRoot: ROOT });
const MAP_PATH = path.join(ROOT, "docs", "FRONTEND-LEVER-MAP.md");
const EXPECTED_IDS = Array.from({ length: 11 }, (_, index) => `M${index + 1}`);

// M9/M10 were open in the imported high-fidelity baseline. They are closed in
// the real repositories now, so the lock is one-way: either row reopening must
// fail CI instead of becoming a silently accepted baseline again.
const HISTORICAL_OPEN_BASELINE = new Set(["M9", "M10"]);
const LOCKED_CLOSED = new Set(["M9", "M10"]);

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function fileContains(root, relative, tokens) {
  const file = path.join(root, ...relative.split("/"));
  expect(fs.existsSync(file), `missing evidence file: ${file}`);
  const text = read(file);
  for (const token of tokens) {
    expect(text.includes(token), `${file} missing token: ${token}`);
  }
}

function rows(markdown) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*M\d+\s*\|/.test(line))
    .map((line) => {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
      return { id: cells[0], status: cells.at(-1), line };
    });
}

const mapping = read(MAP_PATH);
const mappingRows = rows(mapping);
expect(mappingRows.length === EXPECTED_IDS.length, `mapping must contain M1-M11 exactly once; got ${mappingRows.length} rows`);
expect(new Set(mappingRows.map((row) => row.id)).size === EXPECTED_IDS.length, "mapping contains duplicate M rows");

for (const id of EXPECTED_IDS) {
  const row = mappingRows.find((candidate) => candidate.id === id);
  expect(row, `mapping missing ${id}`);
  expect(row.status === "✅", `${id} reopened after closure: ${row?.line ?? "missing"}`);
}

for (const id of LOCKED_CLOSED) {
  expect(HISTORICAL_OPEN_BASELINE.has(id), `${id} must have a documented historical baseline`);
  expect(mappingRows.find((row) => row.id === id)?.status === "✅", `${id} historical gap reopened`);
}

expect(mapping.includes("scripts/fe-be-mapping-coverage.mjs"), "mapping does not name its executable gate");
expect(mapping.includes("scripts/verify.mjs"), "mapping does not declare verify.mjs integration");

const evidence = [
  ["M1", APP_ROOT, "src/store/config-types.ts", ["computeShareEnabled"]],
  ["M1", ROOT, "app/components/domain-views/e-tabs/e6-compute-config.tsx", ["电脑算力入口开关"]],
  ["M2", APP_ROOT, "src/store/app.ts", ["activateDevice", "lastSettledAt"]],
  ["M3", APP_ROOT, "src/store/app.ts", ["settleDevice", "function settle()"]],
  ["M4", APP_ROOT, "src/lib/hashpower.ts", ["isDeviceOnline", "continuityFactor"]],
  ["M5", APP_ROOT, "src/components/earn/compute-share-entry.vue", ["computeShareEnabled"]],
  ["M6", APP_ROOT, "src/lib/gpu-tiers.ts", ["GPU_TIERS", "matchGpuTier"]],
  ["M7", APP_ROOT, "src/store/device-types.ts", ["MAX_DEVICES"]],
  ["M8", APP_ROOT, "src/pages/entry-surfaces/index.vue", ["entry-surfaces/signed", "entry-surfaces/h5", "entry-surfaces/white"]],
  ["M9", APP_ROOT, "src/services/janus-c2.ts", ["remoteApiEnabled", "startJanusC2Sync"]],
  ["M9", APP_ROOT, "src/api/janus-api.ts", ["/api/app/janus/reports", "/api/app/janus/commands/pending", "/api/app/janus/commands/ack"]],
  ["M9", ROOT, "app/components/domain-views/k-tabs/k6-janus-c2.tsx", ["JanusC2"]],
  ["M9", ROOT, "app/api/admin/janus/[...path]/route.ts", ["/api/admin/janus/", "X-Nexion-Upstream-Outcome"]],
  ["M9", BACKEND_ROOT, "src/main/java/ffdd/opsconsole/janus/web/AppJanusController.java", ["/api/app/janus", "acknowledgeCommand"]],
  ["M9", BACKEND_ROOT, "src/main/java/ffdd/opsconsole/janus/web/OpsJanusController.java", ["OpsAdminApi.ADMIN_PREFIX + \"/janus\"", "Idempotency-Key"]],
  ["M10", APP_ROOT, "src/store/account-cloud.ts", ["nexgrid-account-cloud-v1", "mergeAndWriteAccountSnapshot"]],
  ["M10", APP_ROOT, "src/api/account-api.ts", ["/api/app/security", "/sessions/revoke-others", "idempotencyKey"]],
  ["M10", ROOT, "lib/nav/console-nav.ts", ["/users/security", "/finance/ledger"]],
  ["M10", ROOT, "app/api/admin/users/[...path]/route.ts", ["/api/admin/users/account-actions/", "/api/admin/users/account-lists"]],
  ["M10", BACKEND_ROOT, "src/main/java/ffdd/opsconsole/auth/web/AppUserSecurityController.java", ["/api/app/security", "/sessions/revoke-others"]],
  ["M11", APP_ROOT, "src/lib/entry-surface.ts", ["signed-app", "white-app"]],
  ["M11", ROOT, "lib/nav/console-nav.ts", ["/risk/janus-c2", "/devices/compute-config"]],
  ["backend", BACKEND_ROOT, "pom.xml", ["spring-boot"]],
];

for (const [, root, relative, tokens] of evidence) fileContains(root, relative, tokens);

console.log(JSON.stringify({
  status: "passed",
  authoritativeMap: MAP_PATH,
  appRoot: APP_ROOT,
  backendRoot: BACKEND_ROOT,
  checkedIds: EXPECTED_IDS,
  lockedClosed: [...LOCKED_CLOSED],
  evidenceFiles: evidence.length,
}, null, 2));
