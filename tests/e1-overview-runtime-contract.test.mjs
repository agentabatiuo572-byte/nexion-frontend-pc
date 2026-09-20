import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectE1SkuPage,
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
  productType: "SHARE",
  inventoryMode: "FINITE",
  stock: "10",
  // 发布门三件套是行级合规的一部分(fromSku 一直要求它们),夹具必须显式给全。
  trialEligible: false,
  publishBlocked: false,
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

test("E1 runtime contract accepts canonical server products with finite stock", () => {
  const serverSku = {
    ...validSku,
    tier: "Entry",
    productType: "SERVER",
    inventoryMode: "FINITE",
    stock: "0",
  };
  assert.deepEqual(parseE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [serverSku],
  }).records, [serverSku]);
});

test("E1 runtime contract accepts unlimited Share stock only with an explicit null stock", () => {
  const unlimitedShare = {
    ...validSku,
    productType: "SHARE",
    inventoryMode: "UNLIMITED",
    stock: null,
  };
  assert.deepEqual(parseE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [unlimitedShare],
  }).records, [unlimitedShare]);

  // UNLIMITED 只允许 SHARE:不合规的行被具名挑出,而不是让整页读取失败。
  for (const productType of ["DEVICE", "SERVER"]) {
    const { valid, invalid } = inspectE1SkuPage({
      total: 1,
      pageNum: 1,
      pageSize: 100,
      records: [{ ...unlimitedShare, productType }],
    });
    assert.deepEqual(valid, []);
    assert.equal(invalid.length, 1);
    assert.equal(invalid[0].skuId, "owner-sku");
    assert.ok(invalid[0].invalidFields.includes("inventoryMode.stock"));
  }
});

test("E1 runtime contract names the fields of a finite row without one canonical stock value", () => {
  for (const stock of [undefined, null, "", "01", "-1", "2147483648"]) {
    const { valid, invalid } = inspectE1SkuPage({
      total: 1,
      pageNum: 1,
      pageSize: 100,
      records: [{ ...validSku, stock }],
    });
    assert.deepEqual(valid, []);
    assert.deepEqual(invalid.map((row) => row.invalidFields), [["stock"]]);
  }
});

test("E1 runtime contract keeps the valid rows of a page whose other rows are malformed", () => {
  // 这是本缺陷的核心判据:一行历史取值不得让整份目录变空。
  const broken = { ...validSku, skuId: "legacy-box", productType: "BOX", inventoryMode: "FINITE", stock: "5" };
  const { valid, invalid } = inspectE1SkuPage({
    total: 2,
    pageNum: 1,
    pageSize: 100,
    records: [validSku, broken],
  });
  assert.deepEqual(valid.map((row) => row.skuId), ["owner-sku"]);
  assert.deepEqual(invalid, [{ skuId: "legacy-box", name: "Owner SKU", invalidFields: ["productType"] }]);
});

test("E1 runtime contract rejects a malformed 200 that omits records", () => {
  assert.throws(
    () => parseE1SkuPage({ total: 0, pageNum: 1, pageSize: 100 }),
    /E1_SKU_PAGE_INVALID/,
  );
});

test("E1 runtime contract names incomplete SKU identity and unsafe numbers", () => {
  const { invalid } = inspectE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [{ ...validSku, skuId: "", name: "", price: -1 }],
  });
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].skuId, "(缺少 skuId)");
  assert.equal(invalid[0].name, "(缺少名称)");
  assert.deepEqual(invalid[0].invalidFields, ["skuId", "name", "price"]);
});

test("E1 runtime contract names legacy rows that omit explicit inventory semantics", () => {
  const { productType: _productType, inventoryMode: _inventoryMode, ...legacySku } = validSku;
  const { valid, invalid } = inspectE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [legacySku],
  });
  assert.deepEqual(valid, []);
  assert.deepEqual(invalid[0].invalidFields, ["productType", "inventoryMode"]);
});

test("E1 runtime contract keeps rows whose backend never declared a publish-gate verdict", () => {
  // 发布门结论是后加字段:早于该提交的后端构建不返回它。旧后端上必须照常出目录 ——
  // 把「未声明」判成行级错误会让整份目录再次变空,正是本缺陷。
  const { publishBlocked: _blocked, ...undeclared } = validSku;
  const { valid, invalid } = inspectE1SkuPage({
    total: 1,
    pageNum: 1,
    pageSize: 100,
    records: [undeclared],
  });
  assert.deepEqual(valid, [undeclared]);
  assert.deepEqual(invalid, []);

  // 但一旦声明了就必须自洽:结论为「未挡」却带原因、或结论为「挡」却没有合法原因,都算行级错误。
  for (const inconsistent of [
    { ...validSku, publishBlocked: false, publishBlockReason: "PRODUCT_TEST_IDENTIFIER" },
    { ...validSku, publishBlocked: true, publishBlockReason: null },
    { ...validSku, publishBlocked: true, publishBlockReason: "PRODUCT_UNKNOWN_REASON" },
  ]) {
    const { valid: rows, invalid: bad } = inspectE1SkuPage({
      total: 1, pageNum: 1, pageSize: 100, records: [inconsistent],
    });
    assert.deepEqual(rows, []);
    assert.deepEqual(bad[0].invalidFields, ["publishBlockReason"]);
  }
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
