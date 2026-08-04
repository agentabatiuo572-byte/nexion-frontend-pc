// D2 批量提现 · 存量 3 点(2×P1 + 1×P2)固定靶
//   (a) P1 批量提交按已被前端筛选掉的行执行(运营看到 3 笔、实际提交 10 笔)
//   (b) P1 批量动作默认值不随权限归一(下拉里没这项、state 仍是它)
//   (c) P2 列表加载无请求竞态防护(旧响应盖掉新筛选结果)
// 共同根因:selected / batchAction / rows 从不随纯前端状态变化而收窄。
//
// 手法沿用 tests/wd02-network-confirm-fee-contract.test.mjs:源码 needle 抓「写没写」,
// Node 原生 type-strip 抽真源码跑抓「写了有没有被消费」—— 判定漂移正是 regex 抓不到的地方。
// 红测留痕:docs/changes/2026-08-04-d2-batch-redtest.md(逐条注入 → 只红对应用例 → cp 还原 → 复绿)。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const PAGE_FILE = "app/components/domain-views/d-tabs/d2-withdrawals.tsx";
const page = fs.readFileSync(path.join(process.cwd(), PAGE_FILE), "utf8");

// ───────────────────────── 源码 needle:接线面 ─────────────────────────

test("(a) 批量的四个出口(勾选禁用/已选笔数/按钮禁用/提交 ids)只有一处判定", () => {
  // 红测:把勾选框改回内联 actionCandidates(...).includes(batchAction) → FAIL(两套判定必然漂移)
  assert.match(page, /function batchSelectable\(row: D2Withdrawal, action: D2BatchAction \| ""\)/);
  assert.match(page, /function batchTargets\(visible: D2Withdrawal\[\], selectedIds: Set<string>, action: D2BatchAction \| ""\)/);
  assert.match(page, /const selectable = batchSelectable\(row, batchAction\);/);
  assert.match(page, /const submittableRows = useMemo\(\(\) => batchTargets\(visibleRows, selected, batchAction\)/);
  // 屏幕上的「已选 N 笔」「批量执行」禁用态必须读收窄后的集合,不许再读 selected.size
  assert.match(page, /已选 \{submittableRows\.length\} 笔/);
  assert.match(page, /disabled=\{!writesEnabled \|\| !batchAction \|\| submittableRows\.length === 0 \|\| !!submitting\}/);
  assert.doesNotMatch(page, /已选 \{selected\.size\} 笔/);
  assert.doesNotMatch(page, /const ids = Array\.from\(selected\)/);
  // 提交的 ids 与弹窗笔数同一个变量
  assert.match(page, /const ids = submittableRows\.map\(\(row\) => row\.withdrawalNo\);/);
  assert.match(page, /reviewD2WithdrawalsBatch\(action, ids,/);
});

test("(a) 纯前端筛选 / 动作变化时收窄选择", () => {
  // 红测:删掉这个 effect → 被筛掉的行仍留在 selected,清空筛选后悄悄复活成提交目标
  assert.match(page, /useEffect\(\(\) => \{\s*setSelected\(\(current\) => \{[\s\S]*?\}, \[visibleRows, batchAction\]\);/);
  // 收窄用的是同一处 batchTargets 判定,不是另抄一套
  assert.match(page, /const kept = batchTargets\(visibleRows, current, batchAction\)\.map\(\(row\) => row\.withdrawalNo\);/);
});

test("(b) 批量动作无默认值:初值为空 + 不自动选第一个可用项 + 空值不可提交", () => {
  // 红测:初值改回 "APPROVE" → FAIL(角色无该权限时下拉没这项、state 仍是它)
  assert.match(page, /useState<D2BatchAction \| "">\(""\)/);
  assert.doesNotMatch(page, /useState<[^>]*>\("APPROVE"\)/);
  // 红测:加一句「没权限就自动选第一个」→ FAIL(以为选的是 A、实际执行 B,与原缺陷同类)
  assert.doesNotMatch(page, /setBatchAction\([^)]*\[0\]/);
  assert.match(page, /<option value="">请先选择批量动作<\/option>/);
  assert.match(page, /if \(!action\) \{ toast\("请先选择批量动作/);
  // 下拉选项仍按权限过滤(既有纪律不许弱化)
  assert.match(page, /BATCH_ACTIONS\.filter\(\(action\) => hasAuthority\(ACTION_AUTHORITY\[action\]\)\)/);
});

test("(c) load 全程带单调递增请求号,三处状态提交都在闸后", () => {
  // 红测:删掉任一 guard → 对应行为用例 FAIL
  assert.match(page, /const requestSeq = useRef\(0\);/);
  assert.match(page, /const seq = \+\+requestSeq\.current;/);
  const load = grabDecl(page, "load");
  assert.match(load, /if \(seq !== requestSeq\.current\) return;\s*setRows\(nextRows\);/);
  assert.match(load, /if \(seq !== requestSeq\.current\) return;\s*setRows\(\{ total: 0/);
  assert.match(load, /if \(seq === requestSeq\.current\) setLoading\(false\);/);
  // AbortController 不需要:纯列表态,丢弃过期响应即可(不引第二套取消语义)
  assert.doesNotMatch(page, /AbortController/);
});

test("高敏批量纪律未被弱化:确认弹窗 + 必填理由 + 幂等 + 覆盖率门 + 失败态", () => {
  assert.match(page, /openActionConfirm\(\{/);
  assert.match(page, /reasonMin: 8,\s*reasonMax: 200,/);
  assert.match(page, /amplifies: batchAction === "APPROVE"/);
  assert.match(page, /coverage: d5 \? \{ coverageRatio: d5\.coverageRatio, redlinePct: d5\.redlinePct \} : undefined/);
  // 命令号落共享持久化 store(sessionStorage):刷新后重试仍是同一号,后端才能去重,
  // 不会把「结果未知后的重试」变成第二笔放行 / 第二笔退款。
  assert.match(page, /const pendingKeys = createPendingMutationStore\(\{/);
  assert.doesNotMatch(page, /pendingKeys = useRef/);
  assert.match(page, /const key = pendingKeys\.get\(scope\) \?\? operationKey\(scope\)/);
  assert.match(page, /pendingKeys\.remember\(scope, key\)/);
  assert.match(page, /pendingKeys\.forget\(scope\)/);
  // 指纹必须编码动作类型 + 目标单号,否则不同单 / 不同动作会撞 key。
  assert.match(page, /const reviewScope = \(withdrawalNo: string, action: D2ReviewAction\) => `review\\|\$\{withdrawalNo\}\\|\$\{action\}`/);
  assert.match(page, /const batchScope = \(action: D2BatchAction, ids: string\[\]\) => `batch\\|\$\{action\}\\|\$\{\[\.\.\.ids\]\.sort\(\)\.join\(","\)\}`/);
  assert.match(page, /finally \{ setSubmitting\(""\); \}/);
  // 运营可读中文:禁用原因 / 提交后果都用人话,不吐字段名与枚举值
  assert.match(page, /未选择批量动作时不能勾选、不能提交/);
  assert.match(page, /被筛选隐藏的、以及当前状态不能执行该动作的提现单已自动排除/);
});

// ─────────────── 行为固定靶:抽 d2-withdrawals.tsx 真源码跑 ───────────────

/**
 * 抽 `function x(` 或 `const x = async (` / `const x = (` 到花括号配平处(仅用于无 JSX 的纯逻辑块)。
 * 表达式体箭头(`const x = (a) => \`...\`;`,没有花括号)按语句末尾的 `;` 收口 —— 否则会一路吞到
 * 下一个函数的花括号里,抽出一坨语法错误的东西。
 */
function grabDecl(source, name) {
  const start = [`function ${name}(`, `const ${name} = async (`, `const ${name} = (`]
    .map((needle) => source.indexOf(needle))
    .find((index) => index >= 0);
  assert.ok(start !== undefined && start >= 0, `${PAGE_FILE} 里找不到 ${name}(被改名或删除?)`);
  // 体是块还是表达式,必须从**本声明的参数表右括号**往后看,不能满文件找第一个 `=>`
  // (函数声明后面随便哪个箭头函数都会被误认),也不能拿「第一个 { 」判断
  // (模板串的 `${...}` 也是花括号,`const x = (a) => \`p|${a}\`;` 会被截在 ${a} 的 } 上)。
  let parens = 0;
  let paramsEnd = -1;
  for (let p = source.indexOf("(", start); p < source.length; p++) {
    if (source[p] === "(") parens++;
    else if (source[p] === ")" && --parens === 0) { paramsEnd = p + 1; break; }
  }
  assert.ok(paramsEnd > 0, `${name} 参数表括号不配平`);
  const afterParams = source.slice(paramsEnd).trimStart();
  if (afterParams.startsWith("=>") && !afterParams.slice(2).trimStart().startsWith("{")) {
    let template = 0;
    for (let p = paramsEnd; p < source.length; p++) {
      if (source[p] === "`") template = template ? 0 : 1;
      else if (!template && source[p] === ";") return source.slice(start, p + 1);
    }
    assert.fail(`${name} 表达式体没有以 ; 收口`);
  }
  let depth = 0;
  let started = false;
  for (let p = source.indexOf("{", start); p < source.length; p++) {
    if (source[p] === "{") { depth++; started = true; }
    else if (source[p] === "}") { depth--; if (started && depth === 0) return source.slice(start, p + 1); }
  }
  assert.fail(`${name} 花括号不配平`);
}

async function loadExtracted() {
  const fns = [
    "actionCandidates", "routingPriority", "routingUnavailable", "batchSelectable", "batchTargets",
    "actionLabel", "reviewAtAfter", "actionBusinessForm", "businessInput", "operationKey", "batchScope",
    "load", "confirmBatch",
  ].map((name) => grabDecl(page, name)).join("\n");
  const bundle = `// auto-extracted from ${PAGE_FILE} by d2-batch contract test — DO NOT EDIT
type D2Withdrawal = any; type D2ReviewAction = any; type D2BatchAction = any;
type D2ReviewInput = any; type D2BatchResult = any;
type BusinessFormSpec = any; type BusinessFormValue = any;
const OPERATOR = () => "tester";
export const calls: any = { rows: [], d5: [], loading: [], writes: [], errors: [], toasts: [], opened: [], submitted: [], submitting: [], selectedCleared: 0 };
export const stubs: any = { fetchD2Withdrawals: async () => ({}), fetchD5WithdrawalParams: async () => ({}) };
// load 的闭包桩
let page = 1, status = "", keyword = "", minAmount = "", maxAmount = "", minRiskScore = "", ipSegment = "";
let sortBy = "createdAt", sortDirection = "desc", pageSize = 10;
const requestSeq = { current: 0 };
const fetchD2Withdrawals = (q: any) => stubs.fetchD2Withdrawals(q);
const fetchD5WithdrawalParams = () => stubs.fetchD5WithdrawalParams();
const setRows = (v: any) => calls.rows.push(v);
const setD5 = (v: any) => calls.d5.push(v);
const setSelected = () => { calls.selectedCleared += 1; };
const setLoading = (v: any) => calls.loading.push(v);
const setError = (v: any) => calls.errors.push(v);
const setWritesEnabled = (v: any) => calls.writes.push(v);
// confirmBatch 的闭包桩(selected 供红测注入版本使用)
let batchAction: any = "", submittableRows: any[] = [], selected = new Set<string>(), d5: any = null;
// 共享 store 的最小替身:只需 get/remember/forget 三个方法,不引 sessionStorage。
const pendingKeyCells = new Map<string, string>();
const pendingKeys = {
  get: (scope: string) => pendingKeyCells.get(scope),
  remember: (scope: string, key: string) => { pendingKeyCells.set(scope, key); },
  forget: (scope: string) => { pendingKeyCells.delete(scope); },
};
const setSubmitting = (v: any) => calls.submitting.push(v);
const toast = (s: any) => calls.toasts.push(s);
const openActionConfirm = (req: any) => calls.opened.push(req);
const reviewD2WithdrawalsBatch = async (action: any, ids: any, input: any, operator: any, key: any) => {
  calls.submitted.push({ action, ids: [...ids], input, operator, key });
  return { batchId: "B-1", accepted: ids, rejected: [], conflicts: [] };
};
export function setup(next: any = {}) {
  batchAction = next.batchAction ?? "";
  submittableRows = next.submittableRows ?? [];
  selected = next.selected ?? new Set();
  d5 = next.d5 ?? null;
  for (const key of ["rows", "d5", "loading", "writes", "errors", "toasts", "opened", "submitted", "submitting"]) calls[key].length = 0;
  calls.selectedCleared = 0;
  requestSeq.current = 0;
  pendingKeyCells.clear();
  stubs.fetchD2Withdrawals = async () => ({ total: 0, pageNum: 1, pageSize: 10, records: [] });
  stubs.fetchD5WithdrawalParams = async () => ({ coverageRatio: 120, redlinePct: 70 });
}
${fns}
export { batchSelectable, batchTargets, load, confirmBatch };
`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "d2-batch-extract-"));
  const file = path.join(dir, "extract.ts");
  fs.writeFileSync(file, bundle);
  return import(pathToFileURL(file).href);
}

const ext = await loadExtracted();

/** 最小提现行:只带这些判定真正读到的字段。 */
function row(withdrawalNo, overrides = {}) {
  return { withdrawalNo, status: "REVIEW_PENDING", riskScore: 10, routingPriority: "NORMAL", amount: 100, ...overrides };
}
const ids = (rows) => rows.map((r) => r.withdrawalNo);
const pageOf = (withdrawalNo) => ({ total: 1, pageNum: 1, pageSize: 10, records: [row(withdrawalNo)] });

test("① 固定靶:提交的 ids ⊆ 当前可见行 —— 被前端筛选隐藏的勾选行一律不提交", () => {
  const visible = [row("W1"), row("W2")];
  // selected 里混入两笔「上一次筛选下勾的、现在已被 ruleFilter 隐藏」的单
  const picked = new Set(["W1", "W2", "W-HIDDEN-1", "W-HIDDEN-2"]);
  const targets = ext.batchTargets(visible, picked, "APPROVE");
  assert.deepEqual(ids(targets), ["W1", "W2"]);
  const visibleIds = new Set(ids(visible));
  assert.ok(targets.every((r) => visibleIds.has(r.withdrawalNo)), "提交目标越出了可见行");
});

test("① 固定靶:可见 + 已勾但当前动作不可执行的行被排除(复用勾选框那一套判定)", () => {
  const frozen = row("W3", { status: "FROZEN" });                                  // APPROVE 不在候选动作里
  const noK4 = row("W4", { riskScore: null, routingPriority: "UNAVAILABLE" });      // K4 事实不可用禁放行
  const unchecked = row("W5");                                                     // 可见可执行但没勾
  const targets = ext.batchTargets([row("W1"), frozen, noK4, unchecked], new Set(["W1", "W3", "W4"]), "APPROVE");
  assert.deepEqual(ids(targets), ["W1"]);
  // 勾选框禁用态与提交面同源
  assert.equal(ext.batchSelectable(frozen, "APPROVE"), false);
  assert.equal(ext.batchSelectable(noK4, "APPROVE"), false);
  assert.equal(ext.batchSelectable(row("W1"), "APPROVE"), true);
  // FROZEN 行换成 UNFREEZE 语义不在批量集合里;换 FREEZE 动作则 REVIEW_PENDING 行可执行
  assert.equal(ext.batchSelectable(row("W1"), "FREEZE"), true);
});

test("② 固定靶:确认弹窗报的笔数 == 屏幕已选笔数 == 真正提交的笔数", async () => {
  const targets = [row("W1"), row("W2"), row("W3")];
  ext.setup({ batchAction: "APPROVE", submittableRows: targets, selected: new Set([...ids(targets), "W-HIDDEN-1", "W-HIDDEN-2"]), d5: { coverageRatio: 120, redlinePct: 70 } });
  ext.confirmBatch();
  assert.equal(ext.calls.opened.length, 1, "高敏批量必须走确认弹窗");
  const req = ext.calls.opened[0];
  const shown = Number(req.detail.match(/(\d+) 笔/)[1]);
  assert.equal(shown, targets.length, "弹窗笔数 ≠ 屏幕上的已选笔数");
  assert.equal(req.reasonMin, 8, "理由必填纪律被弱化");
  assert.equal(req.amplifies, true, "放行未挂 B1 覆盖率门");
  await req.run("批量放行理由八个字以上", undefined, { addressVerified: "true" });
  assert.equal(ext.calls.submitted.length, 1);
  assert.deepEqual(ext.calls.submitted[0].ids, ids(targets));
  assert.equal(ext.calls.submitted[0].ids.length, shown, "弹窗笔数 ≠ 实际提交笔数");
  assert.equal(ext.calls.submitted[0].input.reason, "批量放行理由八个字以上");
  assert.ok(ext.calls.submitted[0].key.startsWith("d2-batch-"), "幂等键缺失");
});

test("③ 固定靶:无权限(未显式选动作)时默认动作不是 APPROVE,且提交被禁用", async () => {
  // 初值为空 → 没有任何行可勾选 → submittableRows 为空 → 批量按钮 disabled
  assert.equal(ext.batchSelectable(row("W1"), ""), false);
  assert.deepEqual(ext.batchTargets([row("W1"), row("W2")], new Set(["W1", "W2"]), ""), []);
  // 即便有人绕过禁用态点下去,confirmBatch 也不许开弹窗、不许提交
  ext.setup({ batchAction: "", submittableRows: [row("W1")], selected: new Set(["W1"]) });
  ext.confirmBatch();
  assert.equal(ext.calls.opened.length, 0, "未选动作却开了确认弹窗");
  assert.equal(ext.calls.submitted.length, 0, "未选动作却提交了");
  assert.match(ext.calls.toasts[0], /请先选择批量动作/);
  // 选了动作但当前筛选下没有可执行行 → 同样不提交,并给运营可读的原因
  ext.setup({ batchAction: "APPROVE", submittableRows: [], selected: new Set(["W-HIDDEN-1"]) });
  ext.confirmBatch();
  assert.equal(ext.calls.opened.length, 0);
  assert.match(ext.calls.toasts[0], /没有可执行该动作的提现单/);
});

/** 并发两发 load:第一发慢(旧筛选),第二发立刻回(新筛选),旧响应最后才落地。 */
async function raceLoads() {
  ext.setup();
  let releaseStale = () => {};
  let hit = 0;
  ext.stubs.fetchD2Withdrawals = () => {
    hit += 1;
    return hit === 1 ? new Promise((resolve) => { releaseStale = () => resolve(pageOf("OLD")); }) : Promise.resolve(pageOf("NEW"));
  };
  const stale = ext.load();
  const fresh = ext.load();
  await fresh;
  releaseStale();
  await stale;
}

test("④ 固定靶:旧响应不覆盖新筛选结果(成功态)", async () => {
  await raceLoads();
  assert.deepEqual(ext.calls.rows.map((r) => r.records[0].withdrawalNo), ["NEW"], "过期响应盖掉了新筛选结果");
});

test("④ 固定靶:过期响应不许提前收 loading(新请求还在飞)", async () => {
  await raceLoads();
  assert.equal(ext.calls.loading.filter((v) => v === false).length, 1, "过期响应把加载态收成了「已加载完」");
});

test("④ 固定靶:旧响应报错不清空新筛选结果(失败态)", async () => {
  ext.setup();
  let failStale = () => {};
  let hit = 0;
  ext.stubs.fetchD2Withdrawals = () => {
    hit += 1;
    return hit === 1 ? new Promise((_resolve, reject) => { failStale = () => reject(new Error("旧请求超时")); }) : Promise.resolve(pageOf("NEW"));
  };
  const stale = ext.load();
  const fresh = ext.load();
  await fresh;
  failStale();
  await stale;
  assert.deepEqual(ext.calls.rows.map((r) => r.records.length), [1], "过期失败把新结果清空成了空列表");
  assert.deepEqual(ext.calls.errors.filter(Boolean), [], "过期失败弹出了误导性错误条");
});
