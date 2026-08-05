/**
 * G4 创世市场状态开关契约(规格 FEAT-GEN10b)—— node --test 直跑。
 *
 * 🔴 为什么必须单独一道门:GEN11 邀请码有专属契约测试,GEN10b **一条都没有**
 *   (2026-08-05 完整性 critic)。仅有的 `ops-actions` 台账只能守「这个动作存在、
 *   有确认有理由」,守不住本规格的具体条款 —— 而前一版正是用 `inputKind:"text"`
 *   自由输入文案变体溜过去的,靠独立验收才抓到。同型复发时没有门会拦。
 *
 * 守的不变量:
 *   ① 两个方向都要理由(异常4 明写「恢复不豁免」)—— 不是只有关闭要填。
 *   ② 文案变体必须是**白名单下拉**,不接受自由文本(规格 ③),且选项与前端白名单等价。
 *   ③ 契约类型里字段名 = `marketOpenState`(两端统一,与熔断端点 market-status 不撞音)。
 *   ④ 熔断与市场状态是**两个独立动作**,不许合并成一个开关。
 *   ⑤ 页面必须展示「当前状态 + 最近一次变更」两件(规格 ②/⑤;J1/J2/A3 同款成例)。
 *
 * 结构断言一律跑在**剥注释后**的源码上 —— 注释里出现判定式文本不得哄绿。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
/** 行首 // 与块注释一起剥 —— 只剥「整行就是注释」的,不碰 url 里的 //。 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CLIENT = "lib/admin/g4-client.ts";
const VIEW = "app/components/domain-views/g-tabs/g4-genesis.tsx";

/** 取两个稳定锚点之间的原文;锚点消失 = 实现被改名/删除,直接炸,不静默放行。 */
function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  return src.slice(a, b);
}

test("③ 契约字段名 = marketOpenState,旧名 openState 在代码面绝迹", () => {
  const client = strip(read(CLIENT));
  assert.match(client, /marketOpenState\s*:\s*"open"\s*\|\s*"closed"/,
    "G4Market 里找不到 marketOpenState 类型声明");
  assert.equal((client.match(/\bopenState\b/g) || []).length, 0,
    "旧字段名 openState 仍在后台代码面 —— 改名只做了一半,接线时必串档");
  // 前端同名(跨仓 parity 的后台侧半边;uniapp 侧的 ⑧ 门守另一半)
  const uni = readFileSync(new URL("../../Nexion-uniapp/src/store/genesis-config.ts", import.meta.url), "utf8");
  assert.match(uni, /marketOpenState\s*:\s*"open"\s*\|\s*"closed"/,
    "前端字段名与后台不一致 —— fail-open 会让『已关市场』表现成『照常可买』");
});

test("④ 熔断与市场状态是两个独立 mutation,不许合并", () => {
  const client = strip(read(CLIENT));
  assert.match(client, /updateG4GenesisMarketStatus/, "熔断 mutation 不见了");
  assert.match(client, /updateG4GenesisMarketOpenState/, "市场状态 mutation 不见了");
  // 两个端点必须不同 —— 同名异义正是 P0-2 的根因
  assert.match(client, /"\/nex\/genesis\/market-status"/);
  assert.match(client, /"\/nex\/genesis\/market-open-state"/);
});

test("② 文案变体是白名单下拉,不是自由文本", () => {
  const view = strip(read(VIEW));
  const block = grabBetween(view, "noticeKey", "reasonMax");
  assert.match(block, /inputKind:\s*"select"/,
    "变体键必须是 select —— 上一版用 text 自由输入,运营以为切了维护中、用户看到的却是暂未开放");
  assert.doesNotMatch(block, /inputKind:\s*"text"/, "出现了自由文本输入");
  // 选项集必须与前端白名单逐项等价(键 parity ≠ 值 parity)
  const opts = [...(block.match(/options:\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const uni = readFileSync(new URL("../../Nexion-uniapp/src/store/genesis-config.ts", import.meta.url), "utf8");
  const white = [...(uni.match(/GENESIS_CLOSED_NOTICE_KEYS\s*=\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(opts.length >= 3, `后台选项集解析异常(实测 ${opts.length} 项)—— 判据失效必炸,不许静默放行`);
  assert.deepEqual(opts, white,
    `后台下拉与前端白名单不等价:admin=${opts.join("/")} vs uniapp=${white.join("/")} —— 前端不认的键会静默回退 default,运营看不出异常`);
});

test("① 两个方向都要理由(恢复不豁免)", () => {
  const view = strip(read(VIEW));
  const block = grabBetween(view, "runMarketOpenState", "G4AdminOperations");
  // 动作声明里必须有 reasonMax(= 走理由必填的确认流),且没有按方向跳过的分支
  assert.match(block, /reasonMax:\s*\d+/, "没有理由上限 = 没走理由必填的确认流");
  assert.doesNotMatch(block, /next\s*===\s*"open"\s*\?\s*undefined/,
    "恢复方向被豁免了理由 —— 规格异常4 明写两个方向都要");
});

test("⑤ 页面展示当前状态 + 最近一次变更", () => {
  const view = strip(read(VIEW));
  assert.match(view, /market\.lastChange/,
    "缺「最近一次变更」展示 —— 规格 ②/⑤ 点名要两件;J1/J2/A3 等同类闸都实现了,G4 不该是孤例");
  const client = strip(read(CLIENT));
  assert.match(client, /lastChange\s*:\s*string/, "G4Market 契约里没有 lastChange 字段");
});
