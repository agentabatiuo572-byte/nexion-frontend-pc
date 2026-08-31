import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const appRoot = resolveNexionAppRoot({ adminRoot: path.resolve(import.meta.dirname, "..") });
const source = (relative) => readFile(path.join(appRoot, relative), "utf8");

test("F003: the authority App checkout consumes F snapshots from NX1.0 and fails closed", async () => {
  const [runtime, transport, authApi, sessionVault, appShell, loginPage, mePage, rankApi, commissionApi, rankStore, commissionStore, binaryPage] = await Promise.all([
    source("src/api/runtime.ts"),
    source("src/api/api-client.ts"),
    source("src/api/auth-api.ts"),
    source("src/api/session-vault.ts"),
    source("src/App.vue"),
    source("src/pages/login/login.vue"),
    source("src/pages/me/me.vue"),
    source("src/api/v-rank-api.ts"),
    source("src/api/commission-config-api.ts"),
    source("src/store/v-rank.ts"),
    source("src/store/commission.ts"),
    source("src/pages/team/binary.vue"),
  ]);

  assert.match(runtime, /createRuntimeSessionVault/);
  assert.match(runtime, /createVRankApi/);
  assert.match(runtime, /createCommissionConfigApi/);
  assert.match(transport, /headers\.Authorization/);
  assert.doesNotMatch(transport, /getStorageSync\([^)]*(token|access)/i);
  assert.match(transport, /status !== 401 && code !== 401/);
  assert.match(transport, /vault\.clearIfUnchanged/);
  assert.match(authApi, /\/auth\/users\/login/);
  assert.match(authApi, /vault\.saveIfUnchanged/);
  assert.doesNotMatch(authApi, /setStorageSync\([^)]*(token|access|refresh)/i);
  assert.match(sessionVault, /in-memory vault/);
  assert.match(sessionVault, /createRuntimeSessionVault\(\): SessionVault \{\s*return createSessionVault\(\);\s*\}/);
  assert.match(loginPage, /authApi\.login/);
  assert.match(loginPage, /finishSignIn\(\{ accountId: authenticatedAccountId\(result\.user\)/);
  assert.match(loginPage, /authApi\.discardSessionIfCurrent\(result\.vaultRevision\)/);
  assert.match(appShell, /remoteApiEnabled/);
  assert.match(appShell, /\/pages\/login\/login/);
  assert.match(mePage, /authApi\.logout/);
  assert.match(mePage, /app\.bindAccount\("default"\)/);
  assert.match(mePage, /rebindAccountScopedStores\("default"\)/);
  assert.match(rankApi, /\/api\/config\/v-ranks/);
  assert.match(rankApi, /\/api\/team\/rank/);
  assert.match(rankApi, /V_RANK_RESPONSE_INVALID/);
  assert.match(commissionApi, /\/api\/config\/commission\/rates/);
  assert.match(commissionApi, /\/api\/team\/binary/);
  assert.match(commissionApi, /CanonicalBinaryState/);
  assert.match(rankStore, /vRankApi\.ladder\(\)/);
  assert.match(rankStore, /vRankApi\.current\(\)/);
  assert.match(rankStore, /clearRemoteFacts\(\)/);
  assert.match(commissionStore, /refreshCanonicalBinary/);
  assert.match(commissionStore, /binarySnapshot\.value = null/);
  assert.match(commissionStore, /events\.value = \[\]/);
  assert.match(binaryPage, /commission\.binarySnapshot\?\.trackA/);
  assert.match(binaryPage, /remoteApiEnabled && \(commission\.binaryStatus !== 'ready' \|\| network\.remoteStatus !== 'ready'\)/);
  assert.match(binaryPage, /!remoteApiEnabled \|\| \(commission\.binaryStatus === 'ready' && network\.remoteStatus === 'ready'\)/);
});
