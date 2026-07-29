import assert from "node:assert/strict";
import test from "node:test";
import {
  parseE1GenerationGateData,
  parseE1SkuPage,
} from "../lib/admin/e1-overview-contract.ts";

const validSku = {
  skuId: "owner-sku",
  name: "Owner SKU",
  tier: "Share",
  status: "on",
  price: 199,
  dailyEarn: 0.06,
  dailyEarnNex: 10,
  stock: "10",
};

const validGates = {
  domain: "E1",
  phaseOrder: ["1"],
  phases: [{ p: "1", label: "种子期", meta: "M1", skus: "Owner SKU", sortOrder: 10, status: "active" }],
  platformMonth: 1,
  phaseCurrent: "1",
  releases: [{
    id: "owner-sku",
    name: "Owner SKU",
    releaseMonth: 1,
    phase: "1",
    eligibility: true,
    phaseOffset: 0,
    forceUnlock: false,
    effectiveReleaseMonth: 1,
    status: "active",
  }],
  configValues: {},
  allowedFields: ["releaseMonth"],
  sources: ["nx_admin_device_generation_gate"],
};

test("E1 runtime contract accepts one complete canonical catalog page", () => {
  assert.deepEqual(parseE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [validSku],
  }).records, [validSku]);
});

test("E1 runtime contract rejects a malformed 200 that omits records", () => {
  assert.throws(
    () => parseE1SkuPage({ total: 0, pageNum: 1, pageSize: 100 }),
    /E1_SKU_PAGE_INVALID/,
  );
});

test("E1 runtime contract rejects incomplete SKU identity and unsafe numbers", () => {
  assert.throws(
    () => parseE1SkuPage({
      total: 1,
      pageNum: 1,
      pageSize: 100,
      records: [{ ...validSku, skuId: "", price: -1 }],
    }),
    /E1_SKU_PAGE_INVALID/,
  );
});

test("E1 runtime contract accepts a complete generation-gate snapshot", () => {
  assert.deepEqual(parseE1GenerationGateData(validGates), validGates);
});

test("E1 runtime contract rejects missing phase and source arrays", () => {
  assert.throws(
    () => parseE1GenerationGateData({ ...validGates, phaseOrder: undefined, sources: undefined }),
    /E1_GENERATION_GATE_INVALID/,
  );
});
