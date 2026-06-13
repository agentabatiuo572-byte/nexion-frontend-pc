# SPEC-L3a02-feature-mapping-closure

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L3a 功能点一一对应 / feature-mapping seed closure |
| 端 | cross |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-007 |

## 1. 背景与问题

`INIT-007` 是启动时 seed P0：没有完整的前端功能点 ↔ 后台管理面的 feature mapping。后续 L0/L1 已生成 `docs/remediation/inventory/feature-mapping.json`，Source C existence audit 显示 18 行全部存在且无 frontend/admin ref gap，operability audit 显示 gap=0、blocked-by-ledger=0，但仍有 8 行需要 persona/task walkthrough。

因此本 spec 的目标不是宣称 L3a 终态 100% 已完成，而是关闭“没有完整矩阵”这个 seed 缺陷，并把剩余 walkthrough 明确外溢到任务矩阵/后续 spec，避免隐藏未证明闭环。

## 2. 目标与非目标

目标:

- `feature-mapping.json` 18 行全部脱离 `needs-audit` seed 状态，写入 `provisionally-operable` 或 `needs-task-walkthrough`。
- Source C existence audit 证明 missing frontend/admin refs 均为 0。
- Source C operability audit 证明 gap=0、blocked-by-ledger=0。
- 所有 `needs-task-walkthrough` FM 行必须在 `task-walkthrough-matrix.md` 的后续队列中显式列出。
- `INIT-007` 转为 `verified`，sentinel 绑定 feature-mapping closure proof。

非目标:

- 不在本 spec 内完成 `FM-004/FM-005/FM-008/FM-009/FM-010/FM-011/FM-013/FM-016` 的 persona walkthrough。
- 不宣称 L5 feature-mapping 100% ✅；终态仍需后续 walkthrough / UniApp batch / feature switch proof。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\inventory\feature-mapping.json`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-audit.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-operability-audit.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\task-walkthrough-matrix.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\feature-mapping-closure-proof.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-closure-evidence.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`

## 4. 方案

1. 复跑/读取 Source C feature mapping existence + operability audit。
2. 将 mapping inventory row status 同步为 operability 状态，并写入对应 evidence。
3. 在任务矩阵显式列出所有 `needs-task-walkthrough` FM 行，作为后续 owner selection 的输入。
4. 新增 closure proof：检查 18 行完整、0 gap、0 blocked-by-ledger、无 `needs-audit` 残留、needs walkthrough 全部在任务矩阵可见。
5. 将 `INIT-007` 从 seed P0 “no full mapping exists” 升级为 verified；后续 walkthrough 不再混在该 seed 缺陷里。

## 5. 验收断言（机器可测）

1. `node scripts/remediation-feature-map-audit.mjs` 输出 `Rows with existence gaps=0`、`Missing frontend refs=0`、`Missing admin refs=0`。
2. `node scripts/remediation-feature-map-operability.mjs` 输出 `Gaps=0`、`Blocked by unclosed ledger=0`。
3. `node scripts/feature-mapping-closure-proof.mjs` 通过：
   - mapping rows = 18。
   - row status 不含 `needs-audit`。
   - `needs-task-walkthrough` FM 行全部出现在 `task-walkthrough-matrix.md` 后续队列。
   - no open P0/P1 feature-mapping blocker remains except this seed before ledger update。
4. `node scripts/ledger-validate.mjs` 通过。
5. `npm run verify` 通过。

## 6. 拟新增哨兵

- `scripts/feature-mapping-closure-proof.mjs`

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `node scripts/remediation-feature-map-audit.mjs` PASS: mappings=18, gaps=0, missingFrontendRefs=0, missingAdminRefs=0。
  - `node scripts/remediation-feature-map-operability.mjs` PASS: mappings=18, gap=0, blockedByLedger=0, needsTaskWalkthrough=0, provisionallyOperable=18（后续由 `SPEC-L3c02` + `SPEC-L3c03` 收口）。
  - `node scripts/feature-mapping-closure-proof.mjs` PASS: mappingRows=18, 无 `needs-audit` 残留, `needsWalkthrough=[]`。
- 剩余 walkthrough：
  - 当前为 0。原 `FM-004`, `FM-005`, `FM-008`, `FM-009`, `FM-010`, `FM-011`, `FM-013`, `FM-016` 已由 `SPEC-L3c02` / `SPEC-L3c03` runtime proof 收口,不再隐藏在 `INIT-007` seed 缺陷中。
- 哨兵：
  - `scripts/feature-mapping-closure-proof.mjs`
  - `docs/audit/feature-mapping-closure-evidence.md`
- PR：本地整改批次, 未创建远端 PR。
- 台账更新：`INIT-007` 已转 `verified`。
