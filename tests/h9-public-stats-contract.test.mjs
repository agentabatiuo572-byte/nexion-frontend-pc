/**
 * H9「对外公布数据」契约测试 —— 三件事,全部行为级(不是子串):
 *
 * 1. 分位表值域**与前端等价**(规格 FEAT-HOME02b ③:tops ≥ 下限且严格升序、cumPct ∈ [0,100]
 *    且单调不减、至少 H9_BAND_MIN 档)。等价是双向的:
 *      非法表两边都拒 —— 删掉后台任何一条校验(如 cumPct > 100 那行,红测 RT16 的原形)即红;
 *      合法表两边都收 —— 后台自造更严限制(曾经的 tops > 0、最多 8 档)同样即红。
 *    前端权威 = Nexion-uniapp/src/lib/network-rank.ts 的 isValidPercentileTable,直接跨仓加载
 *    真模块跑,不手抄第二份判据。
 * 2. 用户端不得再保留 H9 落盘种子/硬编码回退；真实 platform-config 响应缺失或非法即不可用。
 * 3. 错误文案两条:growth 代理层的闭集机器码(GROWTH_BACKEND_UNAVAILABLE / GROWTH_ROUTE_NOT_FOUND,
 *    本机后端不可达是这页最可能的读失败)必须翻成运营可读中文而非「请检查输入内容」兜底;
 *    占位卡拼接 h9PlaceholderCopy 恒出**恰好一个**句号(字典整句自带「。」,直拼就是双句号)。
 *
 * 本测试与 scripts/h9-public-stats-parity.mjs 一样硬读兄弟仓 Nexion-uniapp(缺仓即红,
 * 与该门同一环境依赖等级)。
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  H9_BAND_MIN,
  H9_BAND_TOPS_MIN,
  h9BandRowErrors,
  h9DraftNumber,
  h9PlaceholderCopy,
} from "../lib/admin/h9-validation.ts";
import { formatAdminApiError } from "../lib/admin/error-messages.ts";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_ROOT = resolveNexionAppRoot({ adminRoot: ROOT });
const { isValidPercentileTable } = await import(
  pathToFileURL(path.join(APP_ROOT, "src", "lib", "network-rank.ts")).href
);

/** 后台侧整表判定 —— 与面板 allValid 的分位表部分同构:逐行零红字 + 档数达标。 */
function adminAccepts(table) {
  const drafts = table.map((band) => ({ tops: String(band.tops), cumPct: String(band.cumPct) }));
  return h9BandRowErrors(drafts).every((error) => !error) && drafts.length >= H9_BAND_MIN;
}

// ── 1. 行为等价 ──────────────────────────────────────────────────────────
// 每条 fixture 单独立案(合取项逐个隔离):删掉哪条校验,就有对应的那条红,不会互相掩护。
const MUST_REJECT = [
  ["cumPct 超 100", [{ tops: 5, cumPct: 20 }, { tops: 20, cumPct: 101 }]],
  ["cumPct 为负", [{ tops: 5, cumPct: -1 }, { tops: 20, cumPct: 50 }]],
  ["cumPct 递减", [{ tops: 5, cumPct: 60 }, { tops: 20, cumPct: 55 }]],
  ["tops 相等(非严格升序)", [{ tops: 5, cumPct: 20 }, { tops: 5, cumPct: 50 }]],
  ["tops 递减", [{ tops: 20, cumPct: 20 }, { tops: 5, cumPct: 50 }]],
  ["tops 低于下限", [{ tops: H9_BAND_TOPS_MIN - 1, cumPct: 20 }, { tops: 20, cumPct: 50 }]],
  ["只有 1 档(少于下限)", [{ tops: 5, cumPct: 20 }]],
  ["空表", []],
];
const MUST_ACCEPT = [
  ["落盘的 4 档旧形状", [
    { tops: 5, cumPct: 20 }, { tops: 20, cumPct: 55 }, { tops: 60, cumPct: 82 }, { tops: 150, cumPct: 96 },
  ]],
  // 曾被后台自造的两条限制锁死的合法形状 —— 等价测试的「禁加严」方向。
  ["9 档合法表(曾被 H9_BAND_MAX=8 锁死)", Array.from({ length: 9 }, (_, i) => ({ tops: i * 10 + H9_BAND_TOPS_MIN, cumPct: 10 + i * 10 }))],
  ["首档 tops 恰在下限(曾被 tops > 0 锁死)", [{ tops: H9_BAND_TOPS_MIN, cumPct: 10 }, { tops: 20, cumPct: 50 }]],
  ["cumPct 相邻持平(单调不减允许相等)", [{ tops: 5, cumPct: 40 }, { tops: 20, cumPct: 40 }, { tops: 60, cumPct: 80 }]],
  ["cumPct 顶到 100 整", [{ tops: 5, cumPct: 20 }, { tops: 20, cumPct: 100 }]],
  ["小数 tops 与小数 cumPct", [{ tops: 0.5, cumPct: 12.5 }, { tops: 20.25, cumPct: 55.5 }]],
];

test("分位表:非法表两边都拒(删掉任何一条后台校验即红)", () => {
  for (const [label, table] of MUST_REJECT) {
    assert.equal(isValidPercentileTable(table), false, `前端应拒:${label}(前端权威变了?同步规格与本测试)`);
    assert.equal(adminAccepts(table), false, `后台漏拒:${label} —— 运营能存进前端判非法的表,首页名次格退化成占位`);
  }
});

test("分位表:合法表两边都收(后台自造更严限制即红)", () => {
  for (const [label, table] of MUST_ACCEPT) {
    assert.equal(isValidPercentileTable(table), true, `前端应收:${label}(前端权威变了?同步规格与本测试)`);
    assert.equal(adminAccepts(table), true, `后台加严:${label} —— 一张合法的表会把整页锁成不可保存`);
  }
});

test("分位表:逐格等价扫一遍(同一 fixture 集上两侧 verdict 全等)", () => {
  for (const [label, table] of [...MUST_REJECT, ...MUST_ACCEPT]) {
    assert.equal(adminAccepts(table), isValidPercentileTable(table), `等价破裂:${label}`);
  }
});

test("用户端不再保留 H9 落盘种子或硬编码回退", () => {
  const mock = fs.readFileSync(path.join(APP_ROOT, "src", "mock", "platform-config.ts"), "utf8");
  const parser = fs.readFileSync(path.join(APP_ROOT, "src", "api", "platform-config-api.ts"), "utf8");
  assert.doesNotMatch(mock, /hashratePercentileTable\s*:/, "H9 分位表不得从 mock/落盘种子恢复");
  assert.match(parser, /!Array\.isArray\(values\.hashratePercentileTable\)/);
  assert.match(parser, /H9_PUBLIC_STATS_RESPONSE_INVALID/);
});

test("h9DraftNumber:空串与非数字给 NaN,不让 Number(\"\")===0 把空输入当 0", () => {
  assert.ok(Number.isNaN(h9DraftNumber("")));
  assert.ok(Number.isNaN(h9DraftNumber("  ")));
  assert.ok(Number.isNaN(h9DraftNumber("1e3")));
  assert.equal(h9DraftNumber(" 42.5 "), 42.5);
});

// ── 2. 错误文案 ──────────────────────────────────────────────────────────
const GENERIC_INPUT_FALLBACK = "操作未完成,请刷新页面核对最新状态后重试;若仍未恢复请联系值班人员。";

test("growth 代理闭集机器码翻成运营可读中文,不落「请检查输入内容」兜底(只读失败没有输入可检查)", () => {
  for (const code of ["GROWTH_BACKEND_UNAVAILABLE", "GROWTH_ROUTE_NOT_FOUND"]) {
    const copy = formatAdminApiError(code, "H9_DATA_LOAD_FAILED");
    assert.notEqual(copy, GENERIC_INPUT_FALLBACK, `${code} 落进了机器码通用兜底`);
    assert.notEqual(copy, code, `${code} 原样漏出成英文码`);
    assert.doesNotMatch(copy, /[A-Z]{2,}/, `${code} 的文案里还带着英文机器码`);
    assert.match(copy, /值班人员/, `${code} 的文案没给「联系值班人员」的下一步`);
  }
  // 对照:未知机器码仍走通用兜底 —— 本修没有把兜底本身改掉。
  assert.equal(formatAdminApiError("SOME_UNKNOWN_CODE_XYZ", "H9_DATA_LOAD_FAILED"), GENERIC_INPUT_FALLBACK);
});

test("占位卡拼接恒出恰好一个句号(字典整句 / 无句号透传串 / 空值三态)", () => {
  const dictionarySentence = formatAdminApiError("GROWTH_BACKEND_UNAVAILABLE", "H9_DATA_LOAD_FAILED");
  assert.match(dictionarySentence, /。$/, "字典整句应以句号收尾(前提变了就更新拼接策略)");
  for (const [label, input] of [
    ["字典整句", dictionarySentence],
    ["H9_DATA_LOAD_FAILED 整句", formatAdminApiError(null, "H9_DATA_LOAD_FAILED")],
    ["无句号英文透传", "Failed to fetch"],
    ["空值回落", null],
  ]) {
    const copy = h9PlaceholderCopy(input);
    assert.ok(!copy.includes("。。"), `${label}:拼出了双句号「。。」——「${copy}」`);
    assert.match(copy, /。为免拿旧值当真值/, `${label}:错误句与固定尾句之间不是恰好一个句号 ——「${copy}」`);
  }
});
