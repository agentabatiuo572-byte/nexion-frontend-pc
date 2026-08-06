/**
 * G4 阶梯档位定价 · 专属契约门(合并底账 ADMIN-MERGE-BASELINE-20260804 §二#1 恢复)。
 *
 * 为什么必须单独一道门:底账 §四实测,G4 是两线分叉最深的模块——拆文件时"文件在、tab 在,
 * 行级动作被静默削减",逐文件核对完全发现不了。这道门把「档位 CRUD 三动作 + fail-closed
 * 契约 + 稳定幂等」钉死成机器判据,再被削减时 verify 直接红,不再依赖人工逐动作比对。
 * 跨仓(nexion-backend 端点实现)断言不在本文件——缺仓机器上 import 期就会炸,拖死全 verify
 * (GEN10b parity 拆分教训);后端侧落地后另起 parity 测试。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
// 注释里出现判定式文本不得哄绿:先剥块注释与行注释再匹配。
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const client = strip(read("../lib/admin/g4-client.ts"));
const proxy = strip(read("../app/api/admin/market/[...path]/route.ts"));
const component = strip(read("../app/components/domain-views/g-tabs/g4-genesis.tsx"));
const manifest = read("../docs/ops-actions.manifest.json");

function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  const body = src.slice(a, b);
  assert.ok(body.length > from.length + 40, `抠出的实现只有 ${body.length} 字符,判据会空转`);
  return body;
}

test("① client 契约:G4Tier 类型 + tiers fail-closed 守卫 + 三个稳定幂等 mutation", () => {
  assert.match(client, /export interface G4Tier/, "运营会失去档位类型契约");
  assert.match(client, /tiers:\s*G4Tier\[\]\s*\|\s*null/, "overview 契约丢了 tiers 字段(null = 未下发/坏形)");
  const guard = grabBetween(client, "function normalizeTiers", "function normalizeOverview");
  assert.match(guard, /return null|reject\(/, "坏形档位必须整组 fail-closed,不许静默剔除单行");
  // 读侧必须镜像原型 tiersProblem 的区间不变量:只查字段级会让「显示取整、编辑拒存」互相矛盾,
  // 并对乱序/重叠档渲染假的「顺移」声明(skeptic P1-1)。
  assert.match(guard, /Number\.isInteger/, "档位边界与单价必须整数校验(小数价会显示取整、编辑拒存,三处契约打架)");
  assert.match(guard, /priceUSDT <= 0/, "单价必须大于 0");
  assert.match(guard, /from !== previousTo/, "区间连续性(本档起始 = 上档截止)必须读侧校验,乱序/重叠档禁渲染");
  assert.match(guard, /new Set/, "档位 id 必须唯一性校验(重复 id 撞 React key 与幂等 intent)");
  assert.match(guard, /previousTo < sold/, "末档总量 ≥ 已售 必须读侧校验");
  assert.match(guard, /console\.error/, "坏形必须留日志样本 —— 数据事故不许静默降级成「尚未下发」");
  for (const fn of ["createG4GenesisTier", "updateG4GenesisTier", "deleteG4GenesisTier"]) {
    // 带开括号钉死函数名边界:改名成 createG4GenesisTierX 这种「子串仍在」的削减形态必须红。
    assert.match(client, new RegExp(`export async function ${fn}\\(`), `档位动作 ${fn} 被削减(底账 §二#1 同型退化)`);
  }
  const tierFns = grabBetween(client, "export async function createG4GenesisTier", "export async function rerunG4GenesisDividendBatch");
  const overviewMutationCalls = tierFns.match(/g4OverviewMutation\(/g) ?? [];
  assert.ok(overviewMutationCalls.length >= 3, `三个档位动作必须全部走 g4OverviewMutation(稳定幂等键),实际 ${overviewMutationCalls.length} 处`);
  assert.match(tierFns, /\/nex\/genesis\/tiers/, "档位端点路径漂移");
  // 区间耦合结构必须整表 CAS:幂等键只防重复,防不了两运营基于旧档表并发互踩(skeptic P1-2)。
  const casCarries = tierFns.match(/expectedTiersVersion/g) ?? [];
  assert.ok(casCarries.length >= 6, `三个档位动作必须都带 expectedTiersVersion(签名+body 各一),实际 ${casCarries.length} 处`);
  assert.match(client, /tiersVersion:\s*Math\.max\(0,/, "overview 必须归一化 tiersVersion 供 CAS 回传");
  assert.doesNotMatch(client, /idempotencyPrefix/, "g4-client 禁用一次性幂等前缀:重试必须复用同号(stable-mutation 纪律)");
});

test("② 代理 allowlist:列表级与单档级两个端点均放行", () => {
  assert.match(proxy, /parts\.length === 3 && parts\[0\] === "nex" && parts\[1\] === "genesis" && parts\[2\] === "tiers"/, "档位列表端点未放行,新增档位会 404");
  assert.match(proxy, /parts\.length === 4 && parts\[0\] === "nex" && parts\[1\] === "genesis" && parts\[2\] === "tiers" &&\s*isNonEmpty\(parts\[3\]\)/, "单档端点未放行,编辑/删除会 404");
});

test("③ 组件:卡片存在 + fail-closed 不给入口 + 三动作接线 + 唯一档不渲染删档", () => {
  assert.match(component, /阶梯档位定价/, "档位卡标题被删,运营找不到入口");
  assert.match(component, /服务端尚未下发阶梯档位数据/, "tiers 缺席/坏形时必须有明确的未下发文案");
  // 增开入口必须收在 tiers 真值分支里:tiers 为 null 时不许出现任何 CRUD affordance。
  assert.match(component, /\{tiers && canPriceTiers && \(/, "增开档位按钮没有收进 tiers 真值 + 权限双条件");
  for (const fn of ["createG4GenesisTier", "updateG4GenesisTier", "deleteG4GenesisTier"]) {
    assert.match(component, new RegExp(`${fn}\\(`), `组件没有调用 ${fn} —— 按钮存在但动作是死的`);
  }
  assert.match(component, /finprod_g4_price_write/, "档位动作必须挂定价写权限");
  assert.match(component, /tiers\.length > 1\s*\?/, "唯一档必须不渲染删档入口(禁用态仍暗示可删,GEN11 纪律)");
  // 钉 gtint 的唯一形态(该短语在弹窗 detail 另有两处变体;钉最长的说明条,删它必红)。
  assert.match(component, /在锁购买按开锁档价结算不追溯/, "档位卡说明条丢了「在锁购买按开锁档价结算不追溯」关键口径(钱语义,削文案不许静默)");
  assert.match(component, /businessForm:\s*\{\s*kind:\s*"multi-field"/, "档位编辑必须走 multi-field 业务表单(截止/单价分字段,禁单框多值)");
});

test("③b 单价仲裁:tiers 在场时一级单价只读(主人拍板 2026-08-06)", () => {
  // 同页两扇写门改同一个钱数曾语义未定义(skeptic P2-3);拍板后:tiers 在场 → 档位卡是唯一调价入口。
  assert.match(component, /\{!tiers && allowed\(paramAuthority\(priceParam\.key\)\)/, "一级单价的调整入口必须收在 tiers 缺席分支(在场时只读)");
  assert.match(component, /param\.key === "price" && overview\.tiers/, "adjustParam 缺一级单价的函数级双保险");
  assert.match(component, /按阶梯派生/, "只读态必须向运营标明「按阶梯派生」,不能只是按钮消失");
});

test("④ 组件源码顺序:档位 handler 不落入 GEN10b grabBetween 锚窗", () => {
  // g4-market-open-state-contract 用 [const runMarketOpenState, const runRerunBatch) 切片;
  // 新 handler 插进这个窗口会让那道门的否定断言产生假红/假绿,这里把顺序钉死。
  const openStateAt = component.indexOf("const runMarketOpenState");
  const rerunAt = component.indexOf("const runRerunBatch");
  const editTierAt = component.indexOf("const editTier");
  assert.ok(openStateAt >= 0 && rerunAt >= 0 && editTierAt >= 0, "锚点缺失:handler 被改名或删除");
  assert.ok(editTierAt < openStateAt || editTierAt > rerunAt, "editTier 落进了 market-open-state 契约门的切片窗口");
});

test("⑤ 动作台账:OPS-G-13 行在且锚定全部三个 restActions", () => {
  const row = grabBetween(manifest, '"id": "OPS-G-13"', '"id": "OPS-G-09"');
  for (const anchor of ["createG4GenesisTier", "updateG4GenesisTier", "deleteG4GenesisTier"]) {
    // 引号内整词匹配:锚被改成 createG4GenesisTierRemoved 这种「子串仍在」形态必须红。
    assert.match(row, new RegExp(`"${anchor}"`), `OPS-G-13 缺 ${anchor} 锚,动作完整性门会失去对它的守护`);
  }
  assert.match(row, /"status": "built"/, "OPS-G-13 必须是 built(真落地),不许挂 pending 虚标");
});
