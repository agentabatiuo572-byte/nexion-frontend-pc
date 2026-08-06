/**
 * K1 簇收益释放参数(SPEC-7)· 专属契约门(合并底账 ADMIN-MERGE-BASELINE-20260804 §二#5 恢复)。
 *
 * 为什么必须单独一道门:①这组参数曾整卡丢失("只剩整簇冻结"),存量 k1-multiaccount 契约测试
 * 顶层硬读 nexion-backend,在缺仓机器上 import 期即炸、被 verify 按环境缺件跳过——等于对本仓
 * 回归零防护;本文件只读本仓,任何机器都真跑。②原型侧该卡的弹窗没走统一确认封装,是底账 §四
 * 点名的"文字搜索假阴性"三形态之一——判据必须锚行为(下拉/校验/幂等),不锚文件名。
 * 跨仓断言(后端 release-params 端点)不在本文件,理由同 GEN10b parity 拆分。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const client = strip(read("../lib/admin/k-client.ts"));
const component = strip(read("../app/components/domain-views/k-tabs/k1-multiaccount.tsx"));
const manifest = read("../docs/ops-actions.manifest.json");

const RELEASE_KEYS = [
  "freePhoneSlotsPerCluster",
  "duplicateAccountPendingFrom",
  "duplicateAccountFreezeFrom",
  "pendingReleaseHours",
  "appAttestationReleaseHours",
  "releaseMode",
  "freeSlotRequiresBinding",
];

function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  const body = src.slice(a, b);
  assert.ok(body.length > from.length + 40, `抠出的实现只有 ${body.length} 字符,判据会空转`);
  return body;
}

test("① client 键集:七个释放参数一个不少,范围限值单源可供弹窗共用", () => {
  const keysBlock = grabBetween(client, "K1_RELEASE_PARAM_KEYS = [", "] as const");
  for (const key of RELEASE_KEYS) {
    assert.match(keysBlock, new RegExp(`"${key}"`), `释放参数键集丢了 ${key}(七参数逐个恢复,漏一个就是底账 §二#5 复发)`);
  }
  const keyCount = (keysBlock.match(/"/g) ?? []).length / 2;
  assert.equal(keyCount, RELEASE_KEYS.length, `键集应恰为 ${RELEASE_KEYS.length} 个,实际 ${keyCount} 个(多出的键会让精确集合校验拒掉合法响应)`);
  assert.match(client, /export const K1_RELEASE_PARAM_LIMITS/, "范围限值必须从 k-client 导出,读校验与编辑弹窗共用一份,禁两处漂移");
  for (const key of RELEASE_KEYS.slice(0, 5)) {
    assert.match(client, new RegExp(`${key}:\\s*\\{\\s*min:`), `${key} 缺范围限值,编辑弹窗会失去数值围栏`);
  }
});

test("② client 契约:缺席向后兼容,在场精确集合 + 逐键值校验,枚举/开关白名单", () => {
  assert.match(client, /releaseParams:\s*KRiskParam\[\]/, "overview 契约丢了 releaseParams 字段");
  const normalizeBlock = grabBetween(client, "const releaseParams = data.releaseParams == null", "const clusters = requiredK1Page");
  assert.match(normalizeBlock, /== null \? \[\]/, "老后端缺席 releaseParams 必须落 [](fail-closed 到卡片),不许整页抛错");
  assert.match(normalizeBlock, /K1_RELEASE_PARAM_KEYS\.some\(\(key\) => !releaseKeys\.has\(key\)\)/, "在场时必须七键精确集合,缺键/未知键都要抛 K1_RESPONSE_INVALID");
  assert.match(normalizeBlock, /validateK1ReleaseParamValue/, "在场时必须逐键值校验,坏值不许渲染给运营");
  const validator = grabBetween(client, "export function validateK1ReleaseParamValue", "function validateK1ParamValue");
  assert.match(validator, /K1_RELEASE_MODE_VALUES/, "释放模式必须按白名单校验,不许接受自由文本");
  assert.match(validator, /"true" \|\| value === "false"/, "开关参数必须二值校验");
  assert.match(client, /updateK1ReleaseParam:.*\/multi-account\/release-params\//, "释放参数 mutation 缺失或端点漂移");
  assert.match(client, /return \{ serverCanonical: true, domain: "K1", stats, params, releaseParams, clusters, whitelist, sources \}/, "normalizeK1 返回体没挂 releaseParams —— 校验了但页面拿不到");
});

test("③ 组件:卡片 + fail-closed + 运营可读标签 + 可枚举值下拉禁自由输入", () => {
  assert.match(component, /data-proof="k1-risk-release-params"/, "释放参数卡的 data-proof 锚被删");
  assert.match(component, /服务端尚未下发收益释放参数/, "releaseParams 缺席时必须有明确的未下发文案且不给编辑入口");
  assert.match(component, /在线证明或人工放行/, "释放模式丢了运营可读中文标签(页面禁裸工程串)");
  assert.match(component, /仅人工放行/, "manual_only 丢了中文标签");
  assert.match(component, /不随时间自动放行/, "落地规则丢了「审核中不随时间自动放行」关键口径(SPEC-7 的灵魂句,削文案不许静默)");
  assert.match(component, /仅生成冻结建议/, "冻结线语义已拍板为「建议」(2026-08-06):达线不自动锁收益,削掉这句会退回语义分叉");
  const modal = grabBetween(component, "releaseDraft && (() => {", "whitelistDraft && (() => {");
  assert.match(modal, /<select/, "枚举/开关参数必须下拉可选");
  assert.doesNotMatch(modal, /type="text"/, "释放参数弹窗禁自由文本输入(打错一个工程串就是静默配置事故)");
  // 单源两面钉:①渲染选项必须从白名单展开;②弹窗块禁出现手抄的工程串字面量
  // (仅断言「K1_RELEASE_MODE_VALUES 出现过」会被 valueOk 校验用途哄绿 —— 红测抓出的形态)。
  assert.match(modal, /isMode \? \[\.\.\.K1_RELEASE_MODE_VALUES\]/, "下拉选项集合必须从 k-client 白名单展开,不许在组件里另抄一份");
  assert.doesNotMatch(modal, /"attest_or_manual"/, "弹窗块出现手抄的释放模式工程串(脱离白名单单源)");
  assert.match(modal, /length >= 8/, "操作理由必须保持 8 字下限");
  assert.match(component, /release-param:\$\{/, "命令号必须走共享 pending store 且 scope 含参数键(刷新复用同号,不重复入账)");
  assert.match(component, /adjReleaseParam\(p\)/, "调整按钮没接到释放参数编辑动作");
  assert.match(component, /\{canWrite && <button[^>]+onClick=\{\(\) => adjReleaseParam\(p\)\}/, "释放参数调整必须挂 risk_k1_write 权限门");
});

test("④ 簇详情收益影响:状态 → 收益桶结论 + 引用当前参数值", () => {
  assert.match(component, /data-proof="k1-cluster-earning-impact"/, "收益影响提示条被删,运营看不到簇状态与收益桶的对应关系");
  const impact = grabBetween(component, "const CLUSTER_EARNING_IMPACT", "export function K1HeaderActions");
  for (const label of ["正常槽内可提", "审核中", "锁定奖励", "恢复正常", "正常释放"]) {
    assert.match(impact, new RegExp(label), `收益影响缺「${label}」档结论`);
  }
  assert.match(component, /freePhoneSlotsPerCluster/, "收益影响没有引用当前释放参数(展示与参数脱钩会误导处置)");
});

test("⑤ 动作台账 + 硬编码禁区", () => {
  const row = grabBetween(manifest, '"id": "OPS-K-01d"', '"id": "OPS-K-01c"');
  assert.match(row, /"restAction": "updateK1ReleaseParam"/, "OPS-K-01d 锚漂移");
  assert.match(row, /"status": "built"/, "OPS-K-01d 必须 built 真落地");
  // 建议冻结线等口径一律服务端下发,组件源码禁出现 0.7 / 70% 字面量(存量 K1 契约的同款禁区,
  // 该测试在缺仓机器不运行,这里补一道真跑的)。
  assert.doesNotMatch(component, /(?:0\.7|70%)[^0-9]/, "K1 组件出现阈值硬编码字面量");
});
