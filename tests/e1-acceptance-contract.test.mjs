import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { releaseMonthPresentation } from "../app/components/domain-views/e-tabs/data.ts";

const view = readFileSync(new URL("../app/components/domain-views/e-view.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../app/components/domain-views/e-tabs/e1-catalog.tsx", import.meta.url), "utf8");
const domainCss = readFileSync(new URL("../app/components/domain-views/e-domain.css", import.meta.url), "utf8");
const registry = readFileSync(new URL("../lib/admin/high-ops-registry.ts", import.meta.url), "utf8");

test("E-domain confirmations await A2 and preserve one command key across retries", () => {
  assert.doesNotMatch(view, /void propose\(/);
  assert.match(view, /commandKey:\s*spec\.commandKey\s*\?\?\s*mc\?\.commandKey/);
  assert.match(view, /completionCopy="提交后进入 A2 待确认队列/);
  assert.doesNotMatch(view, /finally\s*\{\s*setActionConfirm\(null\)/);
});

test("E1 SKU editor blocks no-op edits and constrains stock to a non-negative integer", () => {
  assert.match(view, /skuFormChanged/);
  assert.match(view, /type="number"[^\n]*min=\{0\}[^\n]*step=\{1\}/);
  assert.match(view, /库存必须是非负整数/);
});

test("E1 exposes retry paths for read and media failures", () => {
  assert.match(catalog, /重新加载 E1 数据/);
  assert.match(catalog, /重新加载媒体/);
});

test("E1 catalog supports keyword, status and tier filtering with an explicit empty result", () => {
  assert.match(catalog, /const \[skuQuery, setSkuQuery\] = useState\(""\)/);
  assert.match(catalog, /const \[skuStatus, setSkuStatus\] = useState\("all"\)/);
  assert.match(catalog, /const \[skuTier, setSkuTier\] = useState\("all"\)/);
  assert.match(catalog, /const filteredSkus = useMemo\(/);
  assert.match(catalog, /aria-label="搜索 SKU"/);
  assert.match(catalog, /aria-label="SKU 状态筛选"/);
  assert.match(catalog, /aria-label="SKU 档位筛选"/);
  assert.match(catalog, /没有符合筛选条件的 SKU/);
  assert.match(catalog, /filteredSkus\.map\(/);
});

test("E1 release schedule keeps its seven visible cells on a seven-column grid", () => {
  assert.match(domainCss, /\.edom \.genrel-table\s*\{[^}]*grid-template-columns:\s*minmax\(180px,\s*1\.2fr\)\s+120px\s+120px\s+110px\s+100px\s+110px\s+minmax\(260px,\s*1\.1fr\)/s);
  assert.match(domainCss, /\.edom \.genrel-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(catalog, /<div className="genrel-scroll">\s*<div className="genrel-table">/);
});

test("E1 release schedule presents the effective month as the primary date", () => {
  assert.deepEqual(releaseMonthPresentation(5, 1), {
    effectiveLabel: "M6",
    adjustmentLabel: "基准 M5 · 延后 1M",
  });
  assert.deepEqual(releaseMonthPresentation(5, -2), {
    effectiveLabel: "M3",
    adjustmentLabel: "基准 M5 · 提前 2M",
  });
  assert.deepEqual(releaseMonthPresentation(5, 0), {
    effectiveLabel: "M5",
    adjustmentLabel: "按原计划",
  });
  assert.match(catalog, /releaseMonthPresentation\(g\.releaseMonth, offset\)/);
  assert.match(catalog, /releasePresentation\.effectiveLabel/);
  assert.match(catalog, /releasePresentation\.adjustmentLabel/);
});

test("E1 blocks every off-SKU whose backend-authoritative release state is not open", () => {
  assert.match(catalog, /const listingBlocked = st !== "on" && !open/);
  assert.match(catalog, /disabled=\{listingBlocked\}/);
  assert.doesNotMatch(catalog, /disabled=\{st !== "on" && !!releaseState && !releaseState\.unlocked\}/);
});

test("E1 current product vocabulary and open-without-phase semantics are enforced", () => {
  assert.doesNotMatch(view, /编辑前代际门/);
  assert.match(catalog, /无需阶段/);
  assert.doesNotMatch(catalog, /设为当前/);
  assert.match(catalog, /当前阶段<\/b> 只读跟随 H1/);
  assert.doesNotMatch(registry.slice(registry.indexOf('op: "e1_gate_create"'), registry.indexOf('// E2 收益')), /换代门槛|discount/);
  assert.doesNotMatch(registry, /op: "e1_phase_current"/);
});

test("E1 A2 SKU replay uses the backend canonical field names", () => {
  assert.match(registry, /dailyEarnNex:\s*dailyEarnNEX/);
  assert.match(registry, /unlockPhase:\s*unlock/);
  assert.match(registry, /params:\s*canonicalE1SkuParams\(ctx\)/);
});

test("E1 early-access promotional discount does not claim B1 cash-outflow gating", () => {
  assert.match(catalog, /name: "置换侧抢先购 调整", op: "early-access", amplify: false/);
  assert.match(registry, /op: "e1_early_access_update"[\s\S]*targetType: "device_release_early_access"/);
});

test("E1 hides every mutation entry point from read-only identities", () => {
  assert.match(view, /authorities\.includes\("device_e1_write"\)/);
  assert.match(view, /tab === "E1" \? \(canWriteE1 \?/);
  assert.match(catalog, /const canWrite = ctx\.canWriteE1/);
  assert.match(catalog, /canWrite \? <button[^\n]*>\+ 新增阶段<\/button>/);
  assert.match(catalog, /canWrite \? <button[^\n]*>\+ 新增上架门<\/button>/);
  assert.match(catalog, /canWrite \? <button[^\n]*>改价 \/ 编辑<\/button>/);
  assert.match(catalog, /canWrite && \(unlocked \?/);
  assert.match(catalog, /canWrite \? <button className="danger"[^\n]*>移除<\/button>/);
});

test("E1 consumes the E5 frontend display name and preserves stale SKU datacenter values", () => {
  assert.match(view, /const value = dc\.displayName\.trim\(\)/);
  assert.match(view, /if \(datacenter\) return current/);
  assert.match(view, /历史值\(当前不可选\)/);
  assert.match(view, /if \(!skuDatacenterSet\.has\(datacenter\) && !editName\)/);
  assert.doesNotMatch(view, /setForm\(\{ \.\.\.form, datacenter: skuDatacenterDefault \}\)/);
  assert.doesNotMatch(view, /const value = dc\.regionLabel\.trim\(\)/);
});

test("E5 force activation is not mislabeled as a funds-amplifying proposal", () => {
  assert.match(view, /amplifies: !!def\.amplifies/);
  assert.doesNotMatch(view, /highOp = mc\.deviceAction === "force-activate"[\s\S]{0,500}amplifies: true/);
});
