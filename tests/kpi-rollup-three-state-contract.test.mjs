import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

/**
 * zentao #208:运营总览里同一批 KPI 在同一屏给出两个互相矛盾的结论 ——
 * 八项 KPI 验收墙「达标 0 / 未达 4 / 暂不可计算 4」,而 L 域速览「达标 0 / 未达 8」。
 *
 * 根因不是文案,是**两处各写了一套算式**:验收墙用 `pass === false`,L 域速览用
 * `length - passed`(把「没有分母、暂不可计算」的 null 算进了未达标)。
 * 两边都不会因为对方改口径而变红,所以缺陷一路绿灯发布。
 *
 * 本用例钉住「同一口径只有一个实现」:汇总必须来自共用函数,两处都不得再手写算式。
 */

test("KPI 三态汇总只有一个实现,且 null 不计入未达标", async () => {
  const helper = await read("lib/admin/dashboard-number.ts");
  assert.match(helper, /export function rollupKpiPassState\(/, "汇总函数必须存在");
  assert.match(helper, /kpi\.pass === true/, "达标必须判 === true(不能用真值判断)");
  assert.match(helper, /kpi\.pass === false/, "未达标必须判 === false");
  assert.match(helper, /kpi\.pass === null/, "暂不可计算必须单独一态");
  // null 既不是达标也不是未达标:任何「总数减达标」形态的兜底都会把它算进未达。
  // (只匹配代码形态 —— 注释里讨论这条判据时会出现同样的字面量。)
  assert.doesNotMatch(helper, /\.length\s*-\s*\w*[Pp]assed\s*\)/, "不得再用「总数减达标」倒推未达标");
});

test("验收墙与 L 域速览共用同一个汇总函数", async () => {
  const wall = await read("app/components/dashboard/kpi-wall.tsx");
  const page = await read("app/_console/page.tsx");

  for (const [name, source] of [["八项 KPI 验收墙", wall], ["运营总览 L 域速览", page]]) {
    assert.match(source, /rollupKpiPassState\(/, `${name}必须用共用汇总函数`);
    // 手写算式就是缺陷本体:任何一处重新手写,两处又会各自漂移。
    assert.doesNotMatch(source, /kpis?\.filter\(\(k(pi)?\) => k(pi)?\.pass === false\)\.length/,
      `${name}不得再手写未达标计数`);
    assert.doesNotMatch(source, /kpis?\.filter\(\(k(pi)?\) => k(pi)?\.pass === null\)\.length/,
      `${name}不得再手写暂不可计算计数`);
    assert.doesNotMatch(source, /\.length\s*-\s*\w*[Pp]assed\s*[;,)}]/, `${name}不得用总数减达标倒推未达标`);
  }

  // L 域速览必须把「暂不可计算」渲染出来,否则口径虽对、运营仍看不到这一态。
  assert.match(page, /暂不可计算 \$\{kpiRollup\.unknown\}/, "L 域速览必须展示暂不可计算数量");
});
