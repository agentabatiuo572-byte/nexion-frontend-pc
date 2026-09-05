import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("E1 loads, proposes and proxies the server-owned App bundle ladder", async () => {
  const [client, view, catalog, route, registry] = await Promise.all([
    read("lib/admin/e1-client.ts"),
    read("app/components/domain-views/e-view.tsx"),
    read("app/components/domain-views/e-tabs/e1-catalog.tsx"),
    read("app/api/admin/e1/[...path]/route.ts"),
    read("lib/admin/high-ops-registry.ts"),
  ]);

  assert.match(client, /e1Request<unknown>\("\/bundle-discount"\)/);
  assert.match(client, /expectedVersion:\s*input\.version/);
  assert.match(client, /parseE1BundleDiscount/);
  assert.doesNotMatch(view, /updateE1BundleDiscount/);
  assert.match(view, /findHighOp\("e1_bundle_discount"\)/);
  assert.match(view, /await propose\(ctx\.toast,/);
  assert.match(registry, /op: "e1_bundle_discount"[\s\S]*expectedVersion: Number\(ctx\.expectedVersion\)/);
  assert.match(view, /next\.threeItemsPct\s*<\s*next\.twoItemsPct/);
  assert.match(catalog, /App 组合购阶梯折扣/);
  assert.match(catalog, /4 件及以上折扣/);
  assert.match(route, /\/api\/admin\/devices\/bundle-discount/);
});
