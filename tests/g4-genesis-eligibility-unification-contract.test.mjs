import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const pc = read(new URL("../app/components/domain-views/g-tabs/g4-admin-operations.tsx", import.meta.url));
const pcOverview = read(new URL("../app/components/domain-views/g-tabs/g4-genesis.tsx", import.meta.url));
const pcClient = read(new URL("../lib/admin/g4-client.ts", import.meta.url));
const pcRoute = read(new URL("../app/api/admin/market/[...path]/route.ts", import.meta.url));
const backend = read(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/market/application/OpsGenesisSimulationService.java", import.meta.url));
const backendOpsController = read(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/market/web/OpsNexMarketController.java", import.meta.url));
const backendAppController = read(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/market/web/AppGenesisController.java", import.meta.url));
const uniRoot = new URL("../../NX1.0-UniApp/", import.meta.url);
const prototypeRoot = new URL("../../NX1.0-Prototype/", import.meta.url);
const highFidelityAdmin = [
  "../../nexion-高保真/nexion-ops-console/app/components/domain-views/g-tabs/data.ts",
  "../../nexion-高保真/nexion-ops-console/app/components/domain-views/g-tabs/g4-genesis.tsx",
].map((path) => read(new URL(path, import.meta.url))).join("\n");

const runtimeFiles = (root) => [
  "src/api/genesis-api.ts",
  "src/store/genesis.ts",
  "src/composables/use-genesis-eligibility.ts",
  "src/components/genesis/eligibility-sheet.vue",
].map((path) => read(new URL(path, root))).join("\n");
const prototypeGenesisStore = read(new URL("src/store/genesis.ts", prototypeRoot));
const prototypeGenesisConfig = read(new URL("src/store/genesis-config.ts", prototypeRoot));

test("Genesis eligibility is configured by the three server-canonical admin keys", () => {
  for (const key of ["eligibility.enabled", "eligibility.maxPerUser", "eligibility.minAccountAgeDays"]) {
    assert.match(pc, new RegExp(key.replace(".", "\\.")));
    assert.match(backend, new RegExp(key.replace(".", "\\.")));
  }
  assert.doesNotMatch(pcOverview, /G4InviteCodes|g4-invite-codes/);
  assert.match(pc, /const expectedValue = configured == null \? "" : String\(configured\)/);
  assert.match(pc, /updateG4AdminOperationConfig[\s\S]*expectedValue/);
  assert.match(pcClient, /operations\/config\//);
  assert.match(pcClient, /expectedValue/);
  assert.match(pcRoute, /genesis\/operations\/config/);
  assert.doesNotMatch(pcRoute, /genesis\/invite-codes/);
  assert.doesNotMatch(backendOpsController, /genesis\/invite-codes/);
  assert.doesNotMatch(backendAppController, /genesis\/invite\/redeem/);
});

test("formal and 5174 frontends contain no legacy four-channel any-of rule", () => {
  const legacy = /FEAT-GEN08|hasGenesisInvite|appliesTo|minDepositUsdt|flagshipMin|vRankMin|inviteEnabled|perUserCap|any-of|四通道/;
  assert.doesNotMatch(runtimeFiles(uniRoot), legacy);
  assert.doesNotMatch(runtimeFiles(prototypeRoot), legacy);
  assert.match(prototypeGenesisStore, /soldSlots:\s*0/);
  assert.match(prototypeGenesisStore, /LEGACY_STORAGE_KEY = "nexgrid-genesis"/);
  assert.match(prototypeGenesisStore, /STORAGE_KEY = "nexgrid-genesis-v2"/);
  assert.match(prototypeGenesisStore, /removeStorageSync\(LEGACY_STORAGE_KEY\)/);
  assert.match(prototypeGenesisConfig, /GENESIS_TIERS_DEFAULT\.map/);
});

test("high-fidelity G4 mirrors only the three current server keys", () => {
  for (const key of ["enabled", "maxPerUser", "minAccountAgeDays"]) assert.match(highFidelityAdmin, new RegExp(`eligibility\\.${key}|key: "${key}"`));
  assert.doesNotMatch(highFidelityAdmin, /minDepositUsdt|flagshipMin|vRankMin|inviteEnabled|perUserCap|appliesTo|any-of/);
});
