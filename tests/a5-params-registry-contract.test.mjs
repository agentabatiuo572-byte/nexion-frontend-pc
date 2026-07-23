import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { normalizeA5Overview } from "../lib/admin/a5-contract.ts";

const validOverview = () => ({
  rows: [
    {
      canonicalKey: "feature.ops.maintenanceBanner",
      displayName: "维护公告横幅",
      description: "后台全局维护提示",
      domain: "A",
      domainLabel: "平台基础",
      ownerCode: "A3",
      ownerLabel: "A3 系统配置",
      ownerRoute: "/platform/config",
      currentValue: "off",
      valueType: "STRING",
      unit: "",
      source: "nx_config_item",
      sourceStatus: "READY",
      updatedAt: "2026-07-18T10:00:00",
      operationConfirm: true,
      serverCanonical: true,
    },
    {
      canonicalKey: "emergency.gate.exchange",
      displayName: "兑换闸",
      description: "J1 功能闸",
      domain: "J",
      domainLabel: "紧急合规",
      ownerCode: "J1",
      ownerLabel: "J1 功能闸",
      ownerRoute: "/emergency/kill-switch",
      currentValue: "disabled",
      valueType: "ENUM",
      unit: "",
      source: "J1",
      sourceStatus: "READY",
      updatedAt: "2026-07-18T10:01:00",
      operationConfirm: true,
      serverCanonical: true,
    },
  ],
  stats: { registeredCount: 2, domainCount: 2, highSensitivityCount: 2, sourceCount: 2 },
  sources: [
    { key: "config", label: "配置中心", status: "READY", rowCount: 1, detail: "服务端有效配置" },
    { key: "emergency", label: "应急控制", status: "READY", rowCount: 1, detail: "J1/J2 实时状态" },
  ],
  observedAt: "2026-07-18T10:02:00",
});

test("A5 accepts a consistent server-canonical multi-domain registry", () => {
  const overview = normalizeA5Overview(validOverview());
  assert.equal(overview.rows.length, 2);
  assert.equal(overview.rows[0].currentValue, "off");
  assert.equal(overview.rows[1].ownerRoute, "/emergency/kill-switch");
});

test("A5 rejects duplicate keys and inconsistent summary counts", () => {
  const duplicate = validOverview();
  duplicate.rows[1] = { ...duplicate.rows[1], canonicalKey: duplicate.rows[0].canonicalKey };
  assert.throws(() => normalizeA5Overview(duplicate), /A5_DATA_INTEGRITY_ERROR:rows\.duplicateKey/);

  const inconsistent = validOverview();
  inconsistent.stats.registeredCount = 88;
  assert.throws(() => normalizeA5Overview(inconsistent), /A5_DATA_INTEGRITY_ERROR:stats\.registeredCount/);
});

test("A5 keeps owner routing server-defined and exposes distinct recovery states", async () => {
  const page = await readFile(new URL("../app/_console/platform/params-registry/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/_console/platform/params-registry/params-registry-client.tsx", import.meta.url), "utf8");
  const api = await readFile(new URL("../lib/admin/a5-client.ts", import.meta.url), "utf8");
  const proxy = await readFile(new URL("../app/api/admin/platform/[...path]/route.ts", import.meta.url), "utf8");

  assert.match(proxy, /params-registry/);
  assert.match(api, /\/params-registry/);
  assert.match(api, /AbortController/);
  assert.match(api, /A5_REQUEST_TIMEOUT_MS/);
  assert.doesNotMatch(page + client, /function ownerFor|\/config\/overview/);
  assert.match(client, /currentValue/);
  assert.match(client, /没有查看平台参数寄存器的权限/);
  assert.match(client, /登录已失效/);
  assert.match(client, /数据一致性校验未通过/);
  assert.match(client, /平台参数服务返回异常/);
  assert.match(client, /重新加载/);
});
