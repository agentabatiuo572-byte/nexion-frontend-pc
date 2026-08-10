# B/C/D 探针与路由验收

- 验收日期：2026-08-09（Asia/Tokyo）
- 方法：`D:\nexion\页面业务逻辑通顺性验收方法.md` v1.3
- 锁定候选：UniApp `UniApp@f689bde6b9d3e96fc276460e56da96bd7b063c2f`
- 运行态：5173 / PID 12452；验收前工作树 115 项 dirty
- 裁决：**局部原缺陷已修，但 B/C/D 模块整体不通过，不可发布。**

## 验收结果

| 项目 | 原问题复核 | 对抗性复核 | 最终判定 |
|---|---|---|---|
| B 族 5 个空壳探针 | 空 HTML、无关 HTML、iframe 壳 15/15 被拒绝；5 个正向页面可见 | `spec6-entry-surface-runtime.mjs` 对同源 `console.error` 夹具错误返回 0；其余探针也会收集错误但不把错误纳入 PASS | **FAIL / P1**：原空壳缺陷关闭，但门禁仍可假绿 |
| C 族 3 个零覆盖探针 | 零/部分覆盖、缺 PNG、脚本崩溃、landing 不符、auth bypass 等 21/21 fail-closed | console error、pageerror、iframe 等负例全部正确判红 | **PASS** |
| D 族路由归一化 | 定向单测 5/5；显式未登录时 raw dot-segment 2 秒内跳 onboarding | 空 storage 使用默认已认证态时，`#/pages/entry-surfaces/../earn/earn` 10 秒白屏且 hash 不变 | **FAIL / P1 页面连续性**；原未登录越权项 PASS |

## 关键证据

- Root 全量门：`npm.cmd run verify` 退出 0，86.1 秒；探针安全 12/12、隔离 H5/local-mock 9/9。
- B 族完整负例矩阵：25 个组合中 1 个 false-pass，发生在 spec6 的 `console.error` 夹具。
- C 族负例矩阵：21/21 正确拒绝。
- D 族运行态：显式未登录通过；默认认证/空 storage 的 raw dot-segment 白屏。

原始证据：

- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\root\uniapp-verify-20260809.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\FINAL-REPORT.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\murphy\FINAL-REPORT.md`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\uni-b-probes-negative-r2.log`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\uni-c-coverage-negative.log`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\uni-traversal-runtime.log`
- `D:\workspace\bug-pic\acceptance\HANDOFF-selected-20260809\technical\uni-traversal-unauth-runtime.log`

## 解除条件

1. 五个 B 探针把同源 `console.error`、`pageerror` 和 failed request 纳入最终退出码，并增加目标页面语义身份断言。
2. 用同一 25 组合重新攻击，要求 0 false-pass。
3. 为默认认证态 raw dot-segment 增加 canonical redirect、catch-all 或可理解失败出口，并复核未登录与已登录两种状态。
