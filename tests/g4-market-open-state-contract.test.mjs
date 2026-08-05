/**
 * G4 创世市场状态开关契约(规格 FEAT-GEN10b)—— node --test 直跑。
 *
 * 🔴 为什么必须单独一道门:GEN11 邀请码有专属契约测试,GEN10b **一条都没有**
 *   (2026-08-05 完整性 critic)。仅有的 `ops-actions` 台账只能守「这个动作存在、
 *   有确认有理由」,守不住本规格的具体条款 —— 而前一版正是用 `inputKind:"text"`
 *   自由输入文案变体溜过去的,靠独立验收才抓到。同型复发时没有门会拦。
 *
 * 🔴 本文件**只守后台侧**,跨仓 parity 在 `g4-market-open-state-parity.test.mjs`。
 *   拆开的理由见那个文件抬头:跨仓断言在缺兄弟仓的机器上必须能**整齿跳过并进台账**,
 *   而后台侧这几条在任何机器上都该跑(2026-08-05 独立验收 P0)。
 *
 * 守的不变量:
 *   ① 两个方向都要理由(异常4 明写「恢复不豁免」)—— 不是只有关闭要填。
 *   ② 文案变体必须是**白名单下拉**,不接受自由文本(规格 ③)。
 *   ③ 字段名 = `marketOpenState`;旧名 `openState` 在 G4 **消费面**绝迹。
 *   ④ 熔断与市场状态是**两个独立动作**,不许合并成一个开关。
 *   ⑤ 页面必须展示「当前状态 + 最近一次变更」**两件**(规格 ②/⑤;J1/J2/A3 同款成例)。
 *
 * 结构断言一律跑在**剥注释后**的源码上 —— 注释里出现判定式文本不得哄绿。
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), "utf8");
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

/** 递归收 .ts/.tsx —— 消费面是**开放集合**,只列文件名等于给新消费者留后门。 */
function walk(rel, out = []) {
  for (const name of readdirSync(path.join(ROOT, rel))) {
    const childRel = path.join(rel, name);
    if (statSync(path.join(ROOT, childRel)).isDirectory()) walk(childRel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(childRel);
  }
  return out;
}

test("③ 契约字段名 = marketOpenState,旧名 openState 在 G4 消费面绝迹", () => {
  const client = strip(read(CLIENT));
  assert.match(client, /marketOpenState\s*:\s*"open"\s*\|\s*"closed"/,
    "G4Market 里找不到 marketOpenState 类型声明");

  // 🔴 判据方向:验「**旧名全域还剩几处**」(强判据)而不是「新名在不在」(弱判据,
  //   改一处就成立)。上一版只查 g4-client.ts 一个文件 —— 那是**定义面**;
  //   残留真正会伤人的地方是**消费面**(view / registry / mock),而消费面是开放集合,
  //   所以扫目录树不列文件名(2026-08-05 独立验收 P2)。
  const files = ["lib/admin", "app/components/domain-views/g-tabs"].flatMap((d) => walk(d));
  assert.ok(files.length >= 10,
    `扫描范围解析异常(实测 ${files.length} 个文件)—— 候选为空/缩集必须判失败,不许静默放行`);
  const residue = files.filter((rel) => /\bopenState\b/.test(strip(read(rel))));
  assert.deepEqual(residue, [],
    `旧字段名 openState 仍在 G4 消费面(${residue.join(", ")})—— 改名只做了一半,接线时必串档`);
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
  const opts = [...(block.match(/options:\s*\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(opts.length >= 3, `后台选项集解析异常(实测 ${opts.length} 项)—— 判据失效必炸,不许静默放行`);
});

test("① 两个方向都要理由(恢复不豁免)", () => {
  const view = strip(read(VIEW));
  // 🔴 锚点收窄到 handler 自身。上一版锚到 `G4AdminOperations`,实测跨约 100 行、
  //   把 runRerunBatch 与整段 f-stats JSX 都圈了进来 —— 区间内**别的动作**的 reasonMax
  //   就能满足判据,且 JSX 一重排锚点就失效(2026-08-05 独立验收 P2)。
  const block = grabBetween(view, "const runMarketOpenState", "const runRerunBatch");
  const m = block.match(/reasonMax:\s*(\d+)/);
  assert.ok(m, "没有理由上限 = 没走理由必填的确认流");
  assert.ok(Number(m[1]) > 0,
    `reasonMax 必须是正整数(实测 ${m[1]})—— 0 等于没有理由框,而 \\d+ 连 0 都算过`);
  // 🔴 否定断言不许只挡**上一版那个字面量**(`next === "open" ? undefined`):
  //   那等于只挡住已经修过的那一种写法,`next === "closed" ? 200 : 0` 照样过。
  //   改成挡住**任何按方向分叉喂给理由字段**的形态(2026-08-05 独立验收 P1)。
  assert.doesNotMatch(block, /reason[A-Za-z]*:\s*[^,\n]*\bnext\s*===/,
    "理由相关字段按方向分叉 —— 规格异常4 明写两个方向都要理由");
  assert.doesNotMatch(block, /next\s*===\s*"(open|closed)"\s*\?\s*undefined/,
    "某个字段被按方向豁免成 undefined");
});

test("⑤ 页面展示当前状态 + 最近一次变更", () => {
  const view = strip(read(VIEW));
  // 🔴 门名说「两件」就必须断言两件。上一版只断言了 lastChange —— 把当前状态那一格
  //   整段删掉该测仍全绿(2026-08-05 独立验收 P1)。当前状态那格的身份 = 它的标题串:
  //   handler 里的 `marketOpenState` 判断删不掉(runMarketOpenState 还在用它),
  //   所以只查字段名验不出「展示面还在不在」。
  assert.match(view, /创世市场状态/,
    "缺「当前状态」那一格 —— 运营看不到市场现在是开还是关,只能靠点开动作猜");
  assert.match(view, /暂未开放/, "当前状态格没有关闭态的可读中文");
  assert.match(view, /market\.lastChange/,
    "缺「最近一次变更」展示 —— 规格 ②/⑤ 点名要两件;J1/J2/A3 等同类闸都实现了,G4 不该是孤例");
  const client = strip(read(CLIENT));
  assert.match(client, /lastChange\s*:\s*string/, "G4Market 契约里没有 lastChange 字段");
});
