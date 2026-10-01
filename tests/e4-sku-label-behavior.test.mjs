import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { operatorSkuLabel, operatorProductLabel, operatorUserName } from "../lib/admin/e-operator-display.ts";
import { parseE4OrderPage } from "../lib/admin/e456-overview-contract.ts";

const observedOrder = {
  orderNo: "ORD-382", userNo: "U00000382", skuId: "cloud-share×1", skuName: "Cloud Share×1",
  skuSource: "ORDER_ITEM", amount: 19.9, state: "activated", dcLocation: "Cloud-Global", ageText: "9分钟",
};

const unsafeAggregateItems = [
  ["550e8400-e29b-41d4-a716-446655440000", "550e8400 e29b 41d4 a716 446655440000"],
  ["deadbeef-cafe-abcd-beef-deadbeefcafe", "deadbeef cafe abcd beef deadbeefcafe"],
  ["1234", "12 34"],
  ["SKU-382", "SKU 382"],
  ["ORD-382", "ord 382"],
];
const unsafeAggregates = unsafeAggregateItems.flatMap(([skuId, skuName]) => [
  { skuId: `${skuId}×1 + cloud-share×1`, skuName: `${skuName}×1 + Cloud Share×1` },
  { skuId: `cloud-share×1 + ${skuId}×1`, skuName: `Cloud Share×1 + ${skuName}×1` },
]);
const foreignSkuMachineNames = [
  "550e8400 e29b 41d4 a716 446655440000", "550e8400 e29b 41d4 a716 446655440000×1",
  "deadbeef cafe abcd beef deadbeefcafe×1", "550e8400 e29b 41d4 a716 446655440000×１",
  "12 34", "12 34×1", "１２ ３４×１",
];
const foreignSkuAggregates = [
  { skuId: "abc×1 + cloud-share×1", skuName: "550e8400 e29b 41d4 a716 446655440000×1 + Cloud Share×1" },
  { skuId: "abc×1 + cloud-share×1", skuName: "12 34×1 + Cloud Share×1" },
  { skuId: "550e8400-e29b-41d4-a716-446655440000×１ + cloud-share×１",
    skuName: "550e8400 e29b 41d4 a716 446655440000×１ + Cloud Share×１" },
  { skuId: "550e8400-e29b-41d4-a716-446655440000×² + cloud-share×²",
    skuName: "550e8400 e29b 41d4 a716 446655440000×² + Cloud Share×²" },
];

for (const source of ["ORDER_ITEM", "PRODUCT_CATALOG"]) {
  test(`E4 preserves a readable quantity label from ${source} despite compact SKU equality`, () => {
    assert.equal(operatorSkuLabel({ ...observedOrder, skuSource: source }), "Cloud Share×1");
    assert.equal(operatorSkuLabel({ ...observedOrder, skuSource: source, skuId: "cloud-share", skuName: "Cloud Share" }), "Cloud Share");
  });
}

test("E4 distinguishes a readable catalog name from its compact SKU even without quantity syntax", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuName: "Cloud Share", skuId: "cloud-share" }), "Cloud Share");
});

test("E4 preserves multiple catalog item quantities without replacing them with identifiers", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-share×2 + nexionbox-pro×1",
    skuName: "Cloud Share×2 + NexionBox Pro×1" }), "Cloud Share×2 + NexionBox Pro×1");
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-share×12 + nexionbox-pro×25",
    skuName: "Cloud Share×12 + NexionBox Pro×25" }), "Cloud Share×12 + NexionBox Pro×25");
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-share×１ + nexionbox-pro×２",
    skuName: "Cloud Share×１ + NexionBox Pro×２" }), "Cloud Share×１ + NexionBox Pro×２");
});

test("E4 refuses an entire aggregate when any member is an internal identifier", () => {
  for (const aggregate of unsafeAggregates) {
    assert.equal(operatorSkuLabel({ ...observedOrder, ...aggregate }), "商品信息待补", aggregate.skuName);
  }
});

test("E4 refuses explicit numeric or UUID members even when their SKU identity differs", () => {
  for (const skuName of foreignSkuMachineNames) {
    assert.equal(operatorSkuLabel({ ...observedOrder, skuName }), "商品信息待补", skuName);
  }
  for (const aggregate of foreignSkuAggregates) {
    assert.equal(operatorSkuLabel({ ...observedOrder, ...aggregate }), "商品信息待补", aggregate.skuName);
  }
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "nexionbox-4090×12", skuName: "NexionBox 4090×12" }), "NexionBox 4090×12");
});

test("E4 refuses mismatched aggregate members rather than pairing missing names with other SKUs", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-share×1 + nexionbox-pro×1" }), "商品信息待补");
  assert.equal(operatorSkuLabel({ ...observedOrder, skuName: "Cloud Share×1 + NexionBox Pro×1" }), "商品信息待补");
});

test("E4 keeps a plus inside a product name separate from quantity-suffixed aggregate boundaries", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-storage×1", skuName: "Cloud Share + Storage×1" }), "Cloud Share + Storage×1");
  const skuName = "Cloud Share + Storage×1 + NexionBox Pro×1";
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "cloud-storage×1 + nexionbox-pro×1", skuName }), skuName);
});

test("E4 preserves readable Han names when their SKU differs only in formatting", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "云-算力×1", skuName: "云算力×1" }), "云算力×1");
});

for (const [skuId, skuName] of [
  ["1234", "12 34"],
  ["550e8400-e29b-41d4-a716-446655440000", "550e8400 e29b 41d4 a716 446655440000"],
  ["deadbeef-cafe-abcd-beef-deadbeefcafe", "deadbeef cafe abcd beef deadbeefcafe"],
]) {
  test(`E4 rejects a machine SKU formatted with spaces: ${skuId}`, () => {
    assert.equal(operatorSkuLabel({ ...observedOrder, skuId, skuName }), "商品信息待补");
  });
}

test("E4 still rejects machine identifiers, order references, fixtures, untrusted names and placeholders", () => {
  for (const skuName of [
    "cloud-share×1", "Cloud-Share×1", "CloudShare×1", "ＣｌｏｕｄＳｈａｒｅ×1",
    "ORD-382", "ord 382", "ＯＲＤ-382", "ORDER-9", "SKU 382", "productId-382",
    "TRIAL-DEV×1", "Cloud Share QA_TEST×1", "Cloud Share INTERNAL×1",
    "", "   ", "—", "???", "Cloud Share<script>×1", "Cloud Share\n×1", "Cloud Share\t×1",
    "Cloud Share×1\u200b", "Cloud Share".repeat(20),
  ]) {
    assert.equal(operatorSkuLabel({ ...observedOrder, skuName }), "商品信息待补", skuName);
  }
  assert.equal(operatorSkuLabel({ ...observedOrder, skuId: "Cloud Share×1" }), "商品信息待补", "raw SKU must not become its own display label");
  for (const skuSource of [undefined, null, "", "UNAVAILABLE", "UNTRUSTED"]) {
    assert.equal(operatorSkuLabel({ ...observedOrder, skuSource }), "商品信息待补");
  }
});

test("E4 trims outer whitespace while preserving the existing name-length boundary", () => {
  assert.equal(operatorSkuLabel({ ...observedOrder, skuName: "  Cloud Share×1  ", skuSource: " order_item " }), "Cloud Share×1");
  const longestName = `Cloud ${"A".repeat(74)}`;
  assert.equal(operatorSkuLabel({ ...observedOrder, skuName: longestName }), longestName);
  assert.equal(operatorSkuLabel({ ...observedOrder, skuName: `${longestName}A` }), "商品信息待补");
});

test("quantity display does not relax product or user-name character rules", () => {
  assert.equal(operatorProductLabel("Cloud Share×1"), "商品信息待补");
  assert.equal(operatorUserName("Cloud Share×1"), "用户资料待核验");
});

test("the real E4 list and detail clients preserve the observed SKU and unrelated order fields", async () => {
  const requests = [];
  let responseOrder = observedOrder;
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/admin/e4-client.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "exports", "module", compiled)((name) => {
    if (name === "@/lib/admin/e-operator-display") return { operatorSkuLabel };
    if (name === "@/lib/admin/e456-overview-contract") return { parseE4OrderPage };
    if (name === "@/lib/admin/error-messages") return {
      formatAdminApiError: (_, fallback) => fallback,
      guardedFetch: async (url, options) => {
        requests.push(url);
        assert.ok(!options.method || options.method === "GET", "read-model regression must never write");
        assert.equal(options.cache, "no-store");
        const data = url.includes("?")
          ? { total: 1, pageNum: 1, pageSize: 10, records: [responseOrder] }
          : { order: responseOrder, quantity: 1, history: [], funding: [], refundChannels: [] };
        return new Response(JSON.stringify({ code: 0, data }), { status: 200 });
      },
    };
    assert.fail(`Unexpected production dependency: ${name}`);
  }, module.exports, module);
  const page = await module.exports.fetchE4OrderPage();
  const detail = await module.exports.fetchE4OrderDetail(observedOrder.orderNo);
  const expected = { id: "ORD-382", user: "U00000382", sku: "Cloud Share×1", amt: 19.9,
    state: "activated", dc: "Cloud-Global", age: "9分钟" };
  assert.deepEqual(page.records, [expected]);
  assert.deepEqual(detail.order, expected);
  assert.equal(detail.quantity, 1);
  assert.deepEqual(requests, ["/api/admin/devices/orders?pageNum=1&pageSize=10", "/api/admin/devices/orders/ORD-382"]);
  for (const rejectedOrder of [{ skuId: "1234", skuName: "12 34" },
    { skuId: "550e8400-e29b-41d4-a716-446655440000", skuName: "550e8400 e29b 41d4 a716 446655440000" },
    ...unsafeAggregates, ...foreignSkuMachineNames.map((skuName) => ({ skuName })), ...foreignSkuAggregates]) {
    responseOrder = { ...observedOrder, ...rejectedOrder };
    const rejectedPage = await module.exports.fetchE4OrderPage();
    const rejectedDetail = await module.exports.fetchE4OrderDetail(observedOrder.orderNo);
    assert.deepEqual(rejectedPage.records, [{ ...expected, sku: "商品信息待补" }]);
    assert.deepEqual(rejectedDetail.order, { ...expected, sku: "商品信息待补" });
  }
});
