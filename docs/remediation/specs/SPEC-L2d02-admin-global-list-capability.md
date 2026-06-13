# SPEC-L2d02-admin-global-list-capability

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2d 列表能力全后台收口 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-003 |
| 关联规格卡 | - |

## 1. 背景与问题

`SPEC-L2d01` 已把列表分页原语、finance 四路由分页/豁免和 AD-04 runtime 证明落地,但本 spec 启动前 `INIT-003` 仍保持 open。原因是旧 runtime `listBaseline.pagination` 会被全局文本 `页/page/共 n` 污染,且 `admin-list-capability-audit --runtime` 只覆盖 finance 四路由,无法证明全后台列表能力已收口。

## 2. 目标与非目标

目标:

1. 运行时按“每张表所在 section”判断同 section 是否存在分页器或合法豁免,不再用页面全文正则当分页证据。
2. 全后台 AD shards 去重后输出真实 P1 缺口: 数据表无分页器且无合法豁免。
3. 对已存在的 legacy pager 识别为真实分页控件,同时保留 `data-list-pager` 标准控件计数,避免把旧实现误判为空。
4. 所有剩余 P1 表格要么接入分页,要么以业务语义说明是固定矩阵 / 参考目录 / 小样本账本并加合法 `PaginationExemption`。

非目标:

1. 不把 KPI 卡、热力条、只读说明卡误判为信息列表。
2. 不强行给固定权限矩阵、规则目录等不可扩张矩阵加翻页,但必须显式说明为何豁免。
3. 不用源码 grep 关闭台账;最终以 rerun AD runtime shard + global audit 为证据。

## 3. 验收断言

1. `node scripts/remediation-runtime-admin-shard.mjs AD-xx` 输出 `tables[].dataRows`、`tables[].hasLocalPager`、`tables[].localExemptions`、`listBaseline.tableIssues`。
2. `node scripts/admin-list-capability-global-audit.mjs` 对全后台去重路由输出 `blockerCount=0`、`warningCount=0`、`invalidExemptionCount=0`。
3. `node scripts/admin-list-capability-audit.mjs --runtime` 继续通过,不回退 finance RT-014。
4. `npm run verify` / `npm run build` 通过。
5. 浏览器至少抽查一个 legacy pager、一个标准 `DataListPager`、一个豁免表,确认控件/注记在实景可见且 console error=0。

## 4. 运行时口径

- 标准分页器: `[data-list-pager="true"]`。
- legacy 分页器: `.pager` / `.data-list-pager` / `[data-pagination-control="true"]` / `aria-label*="分页"`。
- 合法豁免: reason 长度 >= 8, `maxRows` > 0,且按 `kind` 限额:
  - `static-small`: <= 5 行
  - `sample-ledger`: <= 12 行
  - `reference-catalog`: <= 20 行
  - `fixed-matrix`: <= 24 行
- 每张表优先认同 section 内的分页器/豁免,防止一个页面顶部有分页就把全页表格都误放行。
- route 级豁免只在 `data-pagination-label` 精确匹配或包含该表 label / section title,且 `maxRows` 覆盖该表行数时生效。

## 5. 完成回执

- Runtime shard 全量复跑: `AD-01`~`AD-13` 共 66/66 routes captured, 0 error。
- `node scripts/admin-list-capability-global-audit.mjs`: PASS, `adminRoutesSeen=66`, `tableRoutes=38`, `blockerCount=0`, `warningCount=0`, `invalidExemptionCount=0`。
- `node scripts/admin-list-capability-audit.mjs --runtime`: PASS, `checkedRequired=8`, `unexemptedP1=0`。
- `npm run verify`: PASS, 144 checks / 0 failed,新增全域列表 runtime gate 已纳入 verify。
- `npm run build`: PASS。
- `INIT-003` ledger 已转 verified,剩余 open: `INIT-008`, `SD-004`。
