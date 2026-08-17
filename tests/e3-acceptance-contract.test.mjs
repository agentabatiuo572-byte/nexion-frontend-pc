import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalE3ConfigTargetId, findHighOp } from "../lib/admin/high-ops-registry.ts";
import { optionalNexionBackendRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const e3 = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-lifecycle.tsx", import.meta.url), "utf8");
const eView = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const eTypes = readFileSync(new URL("../app/components/domain-views/e-tabs/types.ts", import.meta.url), "utf8");
const manual = readFileSync(new URL("../app/components/domain-views/e-tabs/e3-manual.tsx", import.meta.url), "utf8");
const designKit = readFileSync(new URL("../app/components/domain-views/design-kit.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../lib/admin/e3-client.ts", import.meta.url), "utf8");
const l4 = readFileSync(new URL("../app/components/domain-views/l-tabs/l4-live-data.ts", import.meta.url), "utf8");
// 🔴 跨仓读取必须惰性:写成模块顶层常量时,本机没有 nexion-backend 会让**整个文件**
// 加载即抛 ENOENT —— 于是这里那些只读本仓文件、跟后端毫无关系的断言(尤其
// 「不得露出已退役的促销控件」)在开发机上一条都跑不了。2026-08-06 那批原型对齐
// 正是这样把退役控件原样加了回来而全程没有一道门吭声。
// 规则:一个文件里既有本地断言又有跨仓断言时,跨仓那条自己 skip,不许拖垮本地的。
//
// 🔴 但「自己 skip」必须是 node:test 的 **skip + 理由**,不是 try/catch 里 console.log 一行
// 就当过了(2026-08-17)。原来的写法有两处塌陷:
//   ① 仓根写死成相对路径 `../../nexion-backend`,`NEXION_BACKEND_ROOT` 设了也不看 —— 仓根有了二源;
//   ② `catch { return null }` 把**所有**失败都咽了:仓在而文件被改名 / 被删,同样静默降级成
//      「通过」,而这条断言守的正是后端直写路径的 A2 对象锁 —— 它哑掉没有任何人会知道。
// 现在:仓不在 → t.skip(带理由,verify 汇总里数得出来);仓在而文件读不到 → 抛错报红。
const backendRoot = optionalNexionBackendRoot({
  adminRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
});
const readBackendE3 = () =>
  readFileSync(path.join(backendRoot, "src/main/java/ffdd/opsconsole/device/application/OpsDeviceService.java"), "utf8");

test("E3 treats every FEAT-DEV02 trade-in control as required server-canonical data", () => {
  for (const key of [
    "E.tradein.eligibility",
    "E.tradein.enabled",
    "E.tradein.ladder.cut1",
    "E.tradein.ladder.credit5",
    "E.tradein.requireHigherPrice",
    "E.tradein.maxDevicesPerOrder",
  ]) {
    assert.match(e3, new RegExp(`REQUIRED_E3_KEYS[\\s\\S]*${key.replaceAll(".", "\\.")}`));
  }
  assert.match(e3, /E3 配置不完整/);
  assert.match(client, /tradeinLadderCredit5: "E\.tradein\.ladder\.credit5"/);
});

test("E3 does not expose retired promotion controls as if they changed canonical quotes", () => {
  for (const staleLabel of ["置换活动倍率", "置换弹窗节奏", "库存软上限告警"]) {
    assert.doesNotMatch(e3, new RegExp(staleLabel));
    assert.doesNotMatch(manual, new RegExp(staleLabel));
  }
  assert.doesNotMatch(e3, /E\.tradein\.promo/);
  assert.doesNotMatch(e3, /E\.tradein\.inventorySoftMax/);
});

test("E3 scalar and grouped editors reject no-op and invalid boundary input", () => {
  assert.match(e3, /disallowCurrent: true/);
  assert.match(e3, /current: pE\(key\)/);
  assert.match(e3, /requireAnyChange: true/);
  assert.match(designKit, /requireAnyChange\?: boolean/);
  assert.match(designKit, /至少一个字段须发生变化/);
  assert.match(e3, /min\?: number; max\?: number; step\?: number/);
});

test("E3 write controls require the exact device_e3_write authority", () => {
  assert.match(eView, /authorities\.includes\("device_e3_write"\)/);
  assert.match(eTypes, /canWriteE3: boolean/);
  assert.match(e3, /ctx\.canWriteE3[\s\S]*?<button className=\{`adj/);
});

test("E3 D4 failure trace is a real filtered navigation", () => {
  assert.match(e3, /href="\/finance\/ledger\?keyword=tradein&status=FAILED"/);
  assert.doesNotMatch(e3, /打开 D4 bill · 跳转失败 tx 详情/);
});

test("L4 exposes real E3 configuration and trade-in result facts", () => {
  assert.match(l4, /e3ConfigChanges/);
  assert.match(l4, /tradeinApplications/);
  assert.match(l4, /completedTradeins/);
});

test("E3 A2 object locks use the same canonical key as backend direct-write checks", (t) => {
  const scalar = findHighOp("e3_config");
  const batch = findHighOp("e3_config_batch");
  assert.ok(scalar);
  assert.ok(batch);

  const frontendKey = "E.device.capacity.subsidyDays";
  const canonicalKey = "capacitySubsidyDays";
  assert.equal(canonicalE3ConfigTargetId(frontendKey), canonicalKey);
  assert.equal(scalar.buildTarget({ key: frontendKey }).id, canonicalKey);
  assert.deepEqual(
    batch.buildTargets?.({
      values: {
        "E.tradein.ladder.cut1": "24",
        [frontendKey]: "31",
      },
    }).map((target) => target.id),
    [canonicalKey, "tradeinLadderCut1"],
  );
  assert.equal(
    batch.buildTarget({ values: { [frontendKey]: "31" } }).id,
    canonicalKey,
  );

  // 本仓断言排在 skip 判据之前 —— 缺后端仓时它照样必须跑到(顺序变了,断言一字未改)。
  for (const target of [
    scalar.buildTarget({ key: frontendKey }),
    ...(batch.buildTargets?.({ values: { [frontendKey]: "31" } }) ?? []),
  ]) {
    assert.doesNotMatch(target.id, /^E\.(?:device|tradein|release)\./);
  }

  if (backendRoot === null) {
    return t.skip("本机无 nexion-backend:仅跨仓断言跳过(设 NEXION_BACKEND_ROOT 或克隆到 ../nexion-backend)");
  }
  assert.match(
    readBackendE3(),
    /key = normalizeE3Key\(request\.key\(\)\);[\s\S]*countActiveByTarget\("E", "device_e3_config", key\)[\s\S]*ApiResult\.fail\(409, "OBJECT_LOCKED_BY_A2"\)/,
  );
});

test("E3 operator copy stays in business language and does not expose implementation details", () => {
  for (const source of [e3, manual]) {
    assert.doesNotMatch(source, /server-canonical/i);
    assert.doesNotMatch(source, /nx_user_device/);
    assert.doesNotMatch(source, /\/api\/admin\//);
  }
  assert.match(e3, /当前在网设备平均使用时长/);
  assert.match(e3, /升级置换运行记录/);
  assert.match(e3, /所有步骤一起完成，失败时不会留下半成品/);
});
