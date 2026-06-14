# SPEC-L2d01-admin-list-pagination

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2d 列表能力标准化 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-003, RT-014 |
| 关联规格卡 | - |

## 1. 背景与问题

主人指出后台信息列表普遍无分页/部分无筛选。Source A 已实锤 `/finance-products/genesis`, `/finance-products/staking`, `/finance/ledger`, `/finance/withdrawals` 表格无 pagination, 且初始台账保留全站 list baseline 缺口。

## 2. 目标与非目标

目标: 建统一列表能力原语, 对所有运营数据列表提供分页、每页条数、总数、筛选、搜索、排序、空态; 小静态列表必须显式豁免并说明原因。

非目标: 不一次性重做所有表格视觉; 不把 KPI 卡片误判为列表; 不为 5 行以下明确静态配置表强行分页。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\design-kit.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\d-tabs\d4-ledger.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\d-tabs\d2-withdrawals.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\g-tabs\g1-staking.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\g-tabs\g4-genesis.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\(console)\finance\withdrawals\page.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\(console)\finance\params\page.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-admin-shard.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\admin-list-capability-audit.mjs` (新建)

## 4. 方案

1. 在 design-kit 新增 `DataListPager` / `DataTableShell` 或等价轻量原语: page, pageSize, total, search, filters, sort, empty state。
2. Finance 四个实锤路由优先接入分页; 每页默认 10, 支持 10/20/50; 总数与筛选后数量分开显示。
3. 表格数据量小且确为静态配置表时加 `paginationExempt` 注记, 注记包含原因和最大行数。
4. runtime admin shard 的 `listBaseline.pagination` 识别新原语和豁免注记, 缺失继续记 `list-capability`。
5. 所有分页切换必须不改变筛选条件, 空态必须保留清筛选入口。

## 5. 同形全站扫描范围

- `rg -n "<table|className=\\\".*tbl|\\.map\\(.*<tr|grid.*row|paginationExempt|DataTableShell|DataListPager" D:\WORKS\PLAN\Nexion-admin-prototype\app`
- `node scripts\remediation-runtime-admin-shard.mjs AD-04` 复核 finance routes。
- 全站列表基线脚本跑所有 AD shards, 缺分页/筛选/搜索/排序/空态都输出。

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build` 通过。
2. `node scripts\remediation-runtime-admin-shard.mjs AD-04` 后 `/finance-products/genesis`, `/finance-products/staking`, `/finance/ledger`, `/finance/withdrawals` 的 `listBaseline.pagination=true` 或有合法 `paginationExempt`。
3. 新增 `node scripts\admin-list-capability-audit.mjs` 通过, 输出 0 个未豁免 P1 list-capability。
4. Playwright 实景: 在 finance ledger/withdrawals 改 pageSize、翻页、筛选, 总数与显示行数同步, 空态无错位。

## 7. 拟新增哨兵

- `admin-list-capability-audit.mjs` 作为 verify gate。
- `remediation-runtime-admin-shard.mjs` 增加豁免合法性检查: 无 reason 或 maxRows 的 exempt 失败。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `npm run build` PASS。
  - `npm run verify` PASS：137 checks / 0 failed，已包含 `admin-list-capability-audit.mjs` 静态 gate。
  - `node scripts\remediation-runtime-admin-shard.mjs AD-04` PASS：12 routes captured / 0 errors。
  - `node scripts\admin-list-capability-audit.mjs --runtime` PASS：`unexemptedP1=0`。
  - Browser 实景：`/finance/ledger` 默认 10 条/页，切 5 条/页后可到第 2 页；筛选 `充值` 后显示 2 / 总数 9 且回到第 1 页。`/finance/withdrawals` 默认 10 条/页，切 5 条/页后可到第 2 页；筛选 `大额` 后显示 3 / 总数 8 且回到第 1 页。当前 admin 页 console error=0。
- 同形扫描结果：
  - `rg -n -F "<table" app\components\domain-views app\components\archetypes app\components\kit` 确认 finance 四路为手写表格，不是 `ListArchetype` 统一实例。
  - 通用 `ListArchetype` 已接入 `DataListPager` / `PaginationExemption`，后续 registry 型列表默认继承分页能力。
  - G1/G4 小静态配置/只读样例表按规格使用 `PaginationExemption`，均带 reason + maxRows。
- 哨兵：
  - 新增 `scripts\admin-list-capability-audit.mjs`，默认静态 gate 已接入 `scripts\verify.sh`；`--runtime` 模式校验 AD-04 四条目标路由。
  - `scripts\remediation-runtime-admin-shard.mjs` 已识别 `data-list-pager` 与合法 `data-pagination-exempt`，并输出 `paginationPagerCount` / `paginationExemptions`。
- PR：
  - 本地整改批次，未创建远程 PR。
- 台账更新：
  - `RT-014` 转 `verified`，sentinel 绑定 build / verify / AD-04 / runtime strict gate。
  - `INIT-003` 保持 `open`：本次已落 List 原语与 finance 四路证明，但全站剩余手写表格仍需后续域批次逐步分页或显式豁免。
