import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const pc = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const backend = (path) => readFileSync(resolve(process.cwd(), "..", "nexion-backend", path), "utf8");
const app = (path) => readFileSync(resolve(process.cwd(), "..", "NX1.0", path), "utf8");

test("I1 后台投放位置由 App 可见组件真实消费，而不是只停留在管理页", () => {
  const controller = backend("src/main/java/ffdd/opsconsole/content/web/AppCopyExperimentController.java");
  const mapper = backend("src/main/java/ffdd/opsconsole/content/mapper/ContentExperimentRuntimeMapper.java");
  const component = app("src/components/home/conversion-banner.vue");
  const api = app("src/api/content-copy-api.ts");

  assert.match(controller, /@GetMapping\("\/positions\/\{positionKey\}"\)/);
  assert.match(mapper, /c\.copy_position = p\.position_key/);
  assert.match(mapper, /LIMIT 2/);
  assert.match(component, /MANAGED_POSITION = "home\.conversion-banner"/);
  assert.match(component, /managedCopy\.refresh\(MANAGED_POSITION\)/);
  assert.match(component, /refreshCanonicalOrders\(true\)/);
  assert.match(component, /managedCopyText\.value/);
  assert.match(component, /data-copy-version/);
  assert.match(api, /\/api\/content\/positions\//);
});

test("I1 实验曝光使用服务端分桶，订单转化只提交服务端订单号并由后端复核", () => {
  const service = backend("src/main/java/ffdd/opsconsole/content/application/AppCopyExperimentService.java");
  const mapper = backend("src/main/java/ffdd/opsconsole/content/mapper/ContentExperimentRuntimeMapper.java");
  const orderProjection = app("src/store/order-canonical.ts");
  const copyStore = app("src/store/content-copy.ts");

  assert.match(service, /stableBucket\(experiment\.experimentId\(\), userId\)/);
  assert.match(service, /markExposedIfFirst/);
  assert.match(mapper, /JOIN nx_order o/);
  assert.match(mapper, /UPPER\(COALESCE\(o\.payment_status/);
  assert.match(orderProjection, /reportOrderConversions/);
  assert.match(copyStore, /contentCopyApi\.convert\(experimentId, orderNo\)/);
  assert.doesNotMatch(copyStore, /conversion.*(?:true|amount|price)/i);
});

test("I1 所有高风险内容写操作均由后端拒绝缺失或过期快照", () => {
  const dtoDraft = backend("src/main/java/ffdd/opsconsole/content/dto/CopyDraftSaveRequest.java");
  const dtoPublish = backend("src/main/java/ffdd/opsconsole/content/dto/CopyVersionPublishRequest.java");
  const service = backend("src/main/java/ffdd/opsconsole/content/application/OpsCopyAbService.java");
  const client = pc("lib/admin/i-client.ts");

  assert.match(dtoDraft, /Long expectedRevision/);
  assert.match(dtoPublish, /Long expectedRevision/);
  assert.match(service, /COPY_REVISION_CONFLICT/);
  assert.match(service, /COPY_FRAMEWORK_VALUE_CONFLICT/);
  assert.match(service, /findFrameworkParamForUpdate/);
  assert.match(client, /expectedVersion, expectedRevision/);
  assert.match(client, /value, expectedValue/);
});
