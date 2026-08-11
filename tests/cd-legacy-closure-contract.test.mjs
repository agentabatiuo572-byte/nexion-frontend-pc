import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const FRONTEND = "D:/workspace/nexion-ops-console";
const BACKEND = "D:/workspace/nexion-backend";
const readFront = (file) => readFileSync(path.join(FRONTEND, file), "utf8");
const readBack = (file) => readFileSync(path.join(BACKEND, file), "utf8");

test("C-02a exposes a user-scoped replace/recycle command and verifies device ownership", () => {
  const controller = readBack("src/main/java/ffdd/opsconsole/device/web/OpsDeviceController.java");
  const service = readBack("src/main/java/ffdd/opsconsole/device/application/OpsDeviceService.java");
  const client = readFront("lib/admin/user360-client.ts");
  const page = readFront("app/_console/users/search/[id]/page.tsx");
  assert.match(controller, /users\/\{userId\}\/tradein\/\{operation\}/);
  assert.match(controller, /user_c2_write/);
  assert.match(service, /C2_DEVICE_USER_MISMATCH/);
  assert.match(client, /executeUserDeviceTradein/);
  assert.match(page, /设备置换|设备回收/);
});

test("D-15 sensitive treasury exports require a stable command id and reason and write A2 audit", () => {
  const page = readFront("app/components/domain-views/d-tabs/d3-treasury.tsx");
  const client = readFront("lib/admin/d-client.ts");
  const controller = readBack("src/main/java/ffdd/opsconsole/treasury/web/OpsTreasuryController.java");
  const service = readBack("src/main/java/ffdd/opsconsole/treasury/application/OpsTreasuryService.java");
  assert.match(page, /openConfirm\(\{[\s\S]*?敏感导出[\s\S]*?reason: true/);
  assert.match(client, /Idempotency-Key/);
  assert.match(controller, /@PostMapping\(value = "\/reconciliation\/export"/);
  assert.doesNotMatch(controller, /@GetMapping\(value = "\/reconciliation\/export"/);
  assert.doesNotMatch(controller, /@GetMapping\(value = "\/liabilities\/export"/);
  assert.match(controller, /@GetMapping\(value = "\/b2\/liabilities\/export"[\s\S]*?overview_b2_export/);
  assert.match(service, /D3_SENSITIVE_EXPORT_A2_AUDITED/);
});

test("D-19 consumes small amount and payout SLA parameters in withdrawal creation", () => {
  const app = readBack("src/main/java/ffdd/opsconsole/finance/application/AppWithdrawalService.java");
  const ops = readBack("src/main/java/ffdd/opsconsole/finance/application/OpsFinanceService.java");
  assert.match(app, /smallAmountEligible/);
  assert.match(app, /payoutDueAt/);
  assert.doesNotMatch(ops, /D5_EXECUTOR_HOLD/);
});

test("D-21 finance BFF forwards the VietQR receipt collection", () => {
  const proxy = readFront("app/api/admin/finance/[...path]/route.ts");
  assert.match(proxy, /\["overview", "accounts", "config", "receipts"\]/);
});

test("D-22 local sandbox persists isolated payout orders and signed replay-safe callbacks", () => {
  const service = readBack("src/main/java/ffdd/opsconsole/finance/application/PayoutVndSandboxService.java");
  const mapper = readBack("src/main/java/ffdd/opsconsole/finance/mapper/PayoutVndSandboxMapper.java");
  const properties = readBack("src/main/java/ffdd/opsconsole/finance/application/PayoutVndProviderProperties.java");
  const controller = readBack("src/main/java/ffdd/opsconsole/finance/web/OpsPayoutVndController.java");
  assert.match(properties, /DISABLED[\s\S]*LOCAL_SANDBOX[\s\S]*PROVIDER/);
  assert.match(service, /source", "mock"/);
  assert.match(service, /PAYOUT_VND_PROVIDER_UNAVAILABLE/);
  assert.match(service, /PAYOUT_VND_CALLBACK_SIGNATURE_INVALID/);
  assert.match(mapper, /nx_payout_vnd_sandbox_order/);
  assert.match(mapper, /nx_payout_vnd_sandbox_ledger/);
  assert.match(controller, /\/sandbox\/orders/);
  assert.match(controller, /\/sandbox\/callbacks/);
});
