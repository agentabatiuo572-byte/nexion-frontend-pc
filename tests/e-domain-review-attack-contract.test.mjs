import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  operatorDeviceIdentifier,
  operatorDeviceName,
  operatorDeviceStatus,
  operatorE3OperationLabel,
  operatorE3Reason,
  operatorProductLabel,
  operatorSkuLabel,
  operatorTaskLabel,
} from "../lib/admin/e-operator-display.ts";

const backend = readFileSync(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/device/application/OpsDeviceService.java", import.meta.url), "utf8");
const orderView = readFileSync(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/device/domain/DeviceOrderView.java", import.meta.url), "utf8");
const orderMapper = readFileSync(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/device/mapper/DeviceCatalogMapper.java", import.meta.url), "utf8");
const e4Client = readFileSync(new URL("../lib/admin/e4-client.ts", import.meta.url), "utf8");
const e5Tab = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");

test("review attack probes reject every order-number or SKU-id variant as a SKU display name", () => {
  const orderNo = "ORD-F1-R3-1";
  const attacks = [
    "ORD-F1-R3-1", "ord-f1-r3-1", "ORD_F1_R3_1", "ord f1 r3 1", "oRd.f1/r3:1",
    "ORDER-12345", "order_id_12345", "ORDERID12345", "orderId-12345", "ORD12345",
    "SKU-12345", "sku_id_12345", "SKUID12345", "stellarbox-pro", "PRODUCT-9",
  ];
  for (const attack of attacks) {
    assert.equal(operatorSkuLabel({ orderNo, skuName: attack, skuId: attack, skuSource: "ORDER_ITEM" }), "商品信息待补", attack);
  }
  assert.equal(operatorSkuLabel({ orderNo, skuName: "NexionBox Pro", skuId: "stellarbox-pro", skuSource: "ORDER_ITEM" }), "NexionBox Pro");
  assert.equal(operatorSkuLabel({ orderNo, skuName: "NexionBox Pro", skuId: "stellarbox-pro", skuSource: "UNTRUSTED" }), "商品信息待补");
  assert.match(e4Client, /skuSource/);
  assert.match(orderView, /String skuSource/);
  assert.match(orderMapper, /AS skuSource/);
  assert.doesNotMatch(orderMapper, /p\.name, o\.order_no/);
});

test("review attack probes do not allow case, separator, prefix, or embedded internal markers onto E3/E5", () => {
  const attacks = [
    "TRIAL-DEV-1", "trial_dev_1", "xTRIALDEV1", "prod-DEV/TI-1", "E3ACC-9",
    "e3_acc_9", "nodeTIO9", "device-trial-standard", "DEVICE trial standard", "internal-fixture",
    "qa_test_device", "TEST-DEVICE-7", "dev--ti--1", "TrIaL.Dev.7",
  ];
  for (const attack of attacks) {
    assert.notEqual(operatorDeviceIdentifier(attack), attack, attack);
    assert.notEqual(operatorDeviceName(attack, "NX-001"), attack, attack);
    assert.notEqual(operatorProductLabel(attack), attack, attack);
    assert.notEqual(operatorTaskLabel(attack), attack, attack);
    assert.notEqual(operatorE3OperationLabel(attack), attack, attack);
    assert.notEqual(operatorE3Reason(`state=${attack}`), `state=${attack}`, attack);
  }
  for (const status of ["ACTIVE", "active", "RUNNING_INTERNAL", "STATE__QA", "???"]) {
    assert.doesNotMatch(operatorDeviceStatus(status), /ACTIVE|RUNNING_INTERNAL|STATE__QA|\?\?\?/i, status);
  }
  assert.match(e5Tab, /operatorTaskLabel\(d\.activeTaskNo\)/);
  assert.doesNotMatch(e5Tab, /\}\{d\.rawStatus\}/);
});

test("E5 product-tier child text uses the same fail-closed display policy", () => {
  const attacks = [
    "trial-dev-tier", "TrIaL_Dev_Tier", "pro/DEV-TI/1", "tier.e3_acc.9",
    "catalog-INTERNAL-fixture", "qa--test--tier", "SKU_ID_12345",
  ];
  for (const attack of attacks) {
    assert.notEqual(operatorProductLabel(attack), attack, attack);
  }
  assert.equal(operatorProductLabel("NexionBox Pro Tier"), "NexionBox Pro Tier");
  assert.match(e5Tab, /const displaySkuSub = skuSub \? operatorProductLabel\(skuSub\) : ""/);
  assert.match(e5Tab, /\{displaySkuSub\}/);
  assert.doesNotMatch(e5Tab, /\{skuSub\}/);
});

test("review attack probes fail E6 closed without a server controlled HTTPS target and prohibit redirect URLs", () => {
  assert.match(backend, /DOWNLOAD_ALLOWED_TARGETS_CONFIG_KEY/);
  assert.match(backend, /configuredDownloadTargets/);
  assert.match(backend, /isAllowedComputeDownloadTarget/);
  assert.match(backend, /followRedirects\(HttpClient\.Redirect\.NEVER\)/);
  assert.match(backend, /COMPUTE_URL_REDIRECT_FORBIDDEN/);
  assert.match(backend, /COMPUTE_URL_HOST_NOT_ALLOWED/);
});
