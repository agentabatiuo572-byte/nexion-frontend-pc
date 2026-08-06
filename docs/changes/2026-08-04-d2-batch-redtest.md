# 2026-08-04 D2 批量提现存量 3 点(2×P1 + 1×P2)· 红测留痕

范围:`app/components/domain-views/d-tabs/d2-withdrawals.tsx`;用例在
`tests/d2-batch-narrowing-contract.test.mjs`(源码 needle + Node 原生 type-strip 抽真源码跑的行为固定靶)。

**共同根因**:`selected` / `batchAction` / `rows` 从不随任何**纯前端**状态变化而收窄或清理。

## 修了什么

| 条目 | 症状 | 修法 |
|---|---|---|
| (a) P1 | `visibleRows` 前端筛掉的行仍在 `selected` 里,`confirmBatch` 直接提交 `Array.from(selected)` → 运营看到 3 笔、实际提交 10 笔 | 抽出 `batchSelectable` / `batchTargets` 两个模块级判定,勾选框禁用态、已选笔数、按钮禁用、弹窗笔数、提交 ids **五个出口共用同一处判定**;筛选/动作变化时 effect 同步收窄 `selected` |
| (b) P1 | `batchAction` 默认写死 `"APPROVE"`,下拉按权限过滤但无归一 → 角色无该权限时下拉里没这项、state 仍是它 | 初值置空 + 显式空选项「请先选择批量动作」+ 未选中时不可勾选/不可提交/`confirmBatch` 直接 return。**没有**自动选第一个可用项 |
| (c) P2 | `load()` 无请求序号,旧响应可盖掉新筛选结果 | `requestSeq` 单调递增计数器,成功/失败/loading 三处提交各自过闸。**不引 AbortController**(纯列表态,丢弃过期响应即可) |

**判定复用是硬要求**:(a) 的修法直接复用原 L332 那条 `selectable` 判定(现 `batchSelectable`),不另写一套 ——
两套判定必然漂移,而漂移的表现正是「屏幕上禁用了、提交里仍在」。

**既有纪律零弱化**:确认弹窗 / 理由 ≥8 字 / `amplifies` B1 覆盖率门 / `pendingKeys` 幂等键 / `finally setSubmitting("")`
失败态全部保留,并在 `tests/d2-batch-narrowing-contract.test.mjs` 单列一条用例盯着。
弹窗里报的笔数与 `run` 提交的是**同一个 `ids` 变量**(行为用例三方等值断言:屏幕已选 == 弹窗笔数 == 实际提交)。

## 红测(逐条注入破坏 → 只红对应用例 → cp 还原 → 复绿)

还原方式:`cp` 备份到 scratchpad `d2-withdrawals.tsx.bak`(29761 bytes),**未用 `git checkout`**(本仓有并发未提交内容)。
每次注入都回读磁盘自证已落盘(且确认注入串已消失);还原后与备份逐字节一致。
台架脚本:scratchpad `d2-redtest.mjs`(目标文件是 CRLF,多行锚点统一折算 `\r\n` —— 用 `\n` 锚点会静默 0 命中,
首轮 R5/R7/R8/R10 就是这么假绿的,已在台架里焊了「命中数 ≠ 1 即 SKIP 并置非零退出」)。

| # | 注入(破坏一个合取项) | 红掉的用例 | 结果 |
|---|---|---|---|
| R1 | `batchTargets` 丢 `batchSelectable(row, action)` 合取项 | ①(可见+已勾但不可执行的行被排除)、③(空动作时无行可提交) | 红 ✓ fail=2 |
| R2 | `batchTargets` 丢 `selectedIds.has(...)` 合取项 | ①(未勾选的可执行行混进来) | 红 ✓ fail=1 |
| R3 | 弹窗笔数改读 `selected.size`(与提交面脱钩) | ②(弹窗 5 笔 vs 屏幕 3 笔) | 红 ✓ fail=1 |
| R4 | 提交 ids 回退成 `Array.from(selected)`(**原缺陷本体**) | (a) needle、②、③ | 红 ✓ fail=3 |
| R5 | 删掉「未选动作不提交」守卫 | (b) needle、③(空动作却开了弹窗) | 红 ✓ fail=2 |
| R6 | 批量动作初值改回 `"APPROVE"` | (b) needle | 红 ✓ fail=1 |
| R7 | 删 `load` 成功分支过期闸 | (c) needle、④成功态(旧响应盖掉新结果) | 红 ✓ fail=2 |
| R8 | 删 `load` 失败分支过期闸 | (c) needle、④失败态(旧超时清空新结果) | 红 ✓ fail=2 |
| R9 | 删 loading 过期闸 | (c) needle、④(过期响应提前收 loading) | 红 ✓ fail=2 |
| R10 | 收窄 effect 整段删除 | (a)「筛选/动作变化时收窄选择」needle | 红 ✓ fail=1 |

**关于多红的用例**:R1/R4 额外红掉 ③ 不是噪声 —— ③ 的性质(未选动作 ⇒ 无任何行可提交、
提交面里不许出现隐藏行)本来就建立在被破坏的那个合取项上,判定塌了它必然跟着塌。
R7/R8/R9 额外红掉 (c) needle 同理:needle 与行为固定靶是互补的两道门,一个改动同时穿两道是预期。

**已知边界(不自欺)**:R6(初值)与 R10(React effect)只有 source needle 红,没有行为红 ——
React 初始 state 与 `useEffect` 要真跑得起 React 运行时,本仓 `node --test` 没这套装置。
资金安全不靠它们兜:真正决定「提交什么」的是 `submittableRows` → `ids` 这条派生链,
它是**行为**红测覆盖的(R3/R4)。effect 只负责「清空筛选后旧选择不悄悄复活」这层 UX 一致性。

## 收尾门

`npx tsc --noEmit` → 0 错;`node --test tests/d2-*.mjs tests/wd02-*.mjs` → 33/33 绿;
`scripts/a2-audit-coverage-sentinel.mjs`(D2 放行覆盖率门 + 幂等锚)与 `scripts/admin-list-capability-audit.mjs`
(D2 服务端分页锚)均 `failureCount: 0`。
