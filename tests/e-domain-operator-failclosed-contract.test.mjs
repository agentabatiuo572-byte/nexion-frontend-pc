import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  operatorDeviceIdentifier,
  operatorDeviceName,
  operatorDeviceStatus,
  operatorDatacenterLabel,
  operatorE3OperationLabel,
  operatorE3Reason,
  operatorProductLabel,
  operatorTaskLabel,
  operatorSkuLabel,
} from "../lib/admin/e-operator-display.ts";

const e3Client = readFileSync(new URL("../lib/admin/e3-client.ts", import.meta.url), "utf8");
const e5Tab = readFileSync(new URL("../app/components/domain-views/e-tabs/e5-ops.tsx", import.meta.url), "utf8");
const e4Client = readFileSync(new URL("../lib/admin/e4-client.ts", import.meta.url), "utf8");
const e6Tab = readFileSync(new URL("../app/components/domain-views/e-tabs/e6-compute-config.tsx", import.meta.url), "utf8");
const backend = readFileSync(new URL("../../nexion-backend/src/main/java/ffdd/opsconsole/device/application/OpsDeviceService.java", import.meta.url), "utf8");

test("E3 and E5 redact internal fixture identifiers while preserving business-readable state", () => {
  assert.equal(operatorDeviceIdentifier("TRIAL-DEV-001"), "本地验收夹具");
  assert.equal(operatorDeviceName("H2 复审闭环设备", "DEV-TI-001"), "本地验收设备");
  assert.equal(operatorDeviceStatus("ACTIVE"), "运行中");
  assert.equal(operatorDeviceStatus("UNASSIGNED"), "未分配");
  assert.equal(operatorDatacenterLabel("UNASSIGNED"), "未分配");
  assert.equal(operatorProductLabel("device-trial-standard"), "验收设备规格");
  assert.equal(operatorTaskLabel("TIO-001"), "已关联任务");
  assert.equal(operatorE3OperationLabel("DEV-TI-TRADEIN"), "升级置换处理");
  assert.equal(operatorE3Reason("fixture TRIAL-DEV-001 ACTIVE"), "处理备注已记录；请在审计轨迹核验。");
  assert.match(e3Client, /operatorE3OperationLabel/);
  assert.match(e3Client, /operatorE3Reason/);
  assert.match(e5Tab, /operatorDeviceIdentifier\(d\.serial\)/);
  assert.match(e5Tab, /operatorDeviceStatus\(d\.rawStatus\)/);
  assert.match(e5Tab, /operatorTaskLabel\(d\.activeTaskNo\)/);
  assert.doesNotMatch(e5Tab, /\}\{d\.rawStatus\}/);
});

test("E4 never projects an order identifier into the SKU column", () => {
  assert.equal(operatorSkuLabel({ orderNo: "ORD-F1-R3-1", skuName: "ORD-F1-R3-1", skuId: "ORD-F1-R3-1", skuSource: "ORDER_ITEM" }), "商品信息待补");
  assert.equal(operatorSkuLabel({ orderNo: "ORD-100", skuName: "NexionBox Pro", skuId: "stellarbox-pro", skuSource: "ORDER_ITEM" }), "NexionBox Pro");
  assert.match(e4Client, /sku: operatorSkuLabel\(order\)/);
});

test("E6 treats a placeholder or non-package URL as unconfigured and offers no user download entry", () => {
  assert.match(backend, /isApprovedComputeDownloadUrl/);
  assert.match(backend, /sanitizeComputeDownloadUrl/);
  assert.match(backend, /baidu\.com/);
  assert.match(e6Tab, /未配置 · 当前无用户下载入口/);
  assert.doesNotMatch(e6Tab, /服务端已保存真实地址/);
  assert.doesNotMatch(e6Tab, /<a[^>]+href=\{downloadUrl\}/);
});
