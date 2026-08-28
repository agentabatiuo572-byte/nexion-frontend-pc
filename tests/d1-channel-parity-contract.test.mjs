import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(
  new URL("../app/components/domain-views/d-tabs/d1-recon.tsx", import.meta.url),
  "utf8",
);
const client = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const mediaClient = readFileSync(new URL("../lib/admin/media-client.ts", import.meta.url), "utf8");
const designKit = readFileSync(
  new URL("../app/components/domain-views/design-kit.tsx", import.meta.url),
  "utf8",
);
const pendingStore = readFileSync(new URL("../lib/admin/pending-mutation-store.ts", import.meta.url), "utf8");
const proxy = readFileSync(
  new URL("../app/api/admin/finance/[...path]/route.ts", import.meta.url),
  "utf8",
);
const sentinel = readFileSync(
  new URL("../scripts/channel-parity-sentinel.mjs", import.meta.url),
  "utf8",
);

test("D1 renders the five real deposit rails and the card/bank single-transaction caps", () => {
  assert.match(component, /单笔上限/);
  assert.match(component, /maxAmountValue/);
  assert.match(component, /perTxLimitUsd/);
  assert.match(component, /updateD1TopupChannelMax/);
  assert.doesNotMatch(component, /lib\/mock\//);
});

test("D1 card cap is a real compare-and-set backend command", () => {
  assert.match(client, /maxAmountValue/);
  assert.match(client, /expectedValue/);
  assert.match(client, /\/max-amount/);
  assert.match(client, /d1-channel-max/);
  assert.match(proxy, /"max-amount"/);
});

test("D1 amount responses fail closed and uncertain command keys survive refresh", () => {
  assert.match(client, /minAmountValue <= 0/);
  assert.match(client, /maxAmountValue <= 0/);
  assert.match(client, /d1UsdDisplay/);
  // 持久化实现已抽到共享 store(lib/admin/pending-mutation-store.ts),存储键与语义不变。
  assert.match(client, /storageKey: "nexgrid-admin-d1-uncertain-commands-v1"/);
  assert.match(client, /createPendingMutationStore<PersistedPendingMutation>/);
  assert.match(pendingStore, /window\.sessionStorage/);
  assert.doesNotMatch(pendingStore, /window\.localStorage/);
  assert.match(client, /pendingMutations\.remember\(/);
  assert.match(client, /pendingMutations\.forget\(/);
  assert.match(client, /listD1PendingTopupCommands/);
  assert.match(client, /retryD1PendingTopupCommand/);
  assert.match(component, /核对后使用原请求号重试/);
  assert.doesNotMatch(client, /mutationFingerprintHash/);
  assert.doesNotMatch(client, /window\.localStorage/);
  assert.match(component, /min: kind === "fee" \? 0 : 0\.01/);
});

test("cross-repository parity gate reads real PC, backend and App sources only", () => {
  assert.match(sentinel, /resolveNexionAppRoot/);
  assert.match(sentinel, /resolveNexionBackendRoot/);
  assert.match(sentinel, /OpsFinanceService\.java/);
  assert.match(sentinel, /TopupCardLifecycleService\.java/);
  assert.match(sentinel, /MAX_CARD_DEPOSIT_USDT/);
  assert.doesNotMatch(sentinel, /lib[\\/]mock/);
});

test("VietQR receipt evidence uses its finance-only binary-safe upload boundary", () => {
  assert.match(component, /uploadPurpose: "vietqr-receipt"/);
  assert.match(designKit, /uploadD1VietQrReceiptEvidence/);
  assert.match(mediaClient, /\/api\/admin\/finance\/vietqr\/receipt-evidence/);
  assert.match(proxy, /"receipt-evidence"/);
  assert.match(proxy, /request\.arrayBuffer\(\)/);
});

test("bank write acceptance is not mislabeled when only the overview readback fails", () => {
  assert.match(component, /操作已被服务端受理，但最新列表回读失败/);
  assert.match(component, /不要重复提交/);
  assert.doesNotMatch(component, /throw readbackError/);
  assert.match(client, /"UNKNOWN"/);
  assert.match(component, /历史账户信息缺失/);
});
