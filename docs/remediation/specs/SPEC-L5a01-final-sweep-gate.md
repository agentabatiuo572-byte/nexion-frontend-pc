# SPEC-L5a01-final-sweep-gate

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L5 final sweep / one-command objective closure |
| 端 | cross |
| 模型层级 | spec=T0; 实现=T0 |
| 关联缺陷 id | all verified/closed ledger rows; Source A/B/C/D/E final closure |
| 关联规格卡 | `docs/remediation/MASTER-PLAN.md` L5 12 条终验判据 |

## 1. 背景与问题

L2/L3 specs 已把后台弹窗、列表能力、前台参考源、UniApp 路由迁移、persona 任务、feature-mapping walkthrough 和支持后台逐项清零。但 MASTER-PLAN 的 L5 仍缺一个可重跑的总闸,会导致三类风险:

1. 三端 verify 分散运行,容易把某端漏跑。
2. runtime shards、ledger、feature mapping、弹窗契约、列表契约、i18n、口径镜像各自为政,没有一份客观终验报告。
3. Windows PowerShell 调 WSL bash 时,`node`/`curl` 工具链可能错端,造成假失败或 HTTP probe 假跳过。

## 2. 目标与非目标

目标:

1. 新增 `scripts/l5-final-sweep.mjs`,一键运行三端 verify 并汇总 MASTER-PLAN L5 12 条机器判据。
2. 新增 `scripts/canon-sentinel.mjs` + `docs/remediation/canon-numbers.json`,锁定 staking、Genesis、设备生命周期、商品、提现等核心数字三端同源。
3. 给 Next/UniApp/Admin verify 增加 Windows/WSL toolchain fallback,避免 `node`/`curl` 误判。
4. UniApp verify 增加 i18n mirror gate,把 en/zh key 镜像作为常驻质量门。

非目标:

1. 不改变既有业务口径;canon JSON 只固化当前已验证口径。
2. 不新增真实 API 级后台控制前台运行时;继续按 MASTER-PLAN 决策做功能点一一对应与可操作控制面证明。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\l5-final-sweep.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\canon-sentinel.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\canon-numbers.json`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-final-sweep-report.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-final-sweep-report.json`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-*.log`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`
- `D:\WORKS\PLAN\Nexion-prototype\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-uniapp\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-uniapp\scripts\i18n-key-mirror.mjs`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-LEDGER.md`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-PITFALLS.md`

## 4. 方案

- `l5-final-sweep.mjs --run-verifiers` 先跑:
  - Admin: `npm run verify`
  - Next reference: `bash scripts/verify.sh all`
  - UniApp: `bash scripts/verify.sh`
- 再跑内部 gate:
  - `ledger-validate`
  - `remediation-feature-map-audit`
  - `remediation-feature-map-operability`
  - `feature-mapping-closure-proof`
  - `admin-modal-contract-audit`
  - `admin-list-capability-global-audit`
  - `uniapp-port-coverage-audit`
  - `sku-field-mirror`
  - `canon-sentinel`
- 汇总 L5 12 条:
  1. 三端 verify 全绿。
  2. UniApp route migration + persona flows 全绿。
  3. FT/AT task walkthrough 全 verified。
  4. runtime route/action blockers 为 0。
  5. modal contract + business-specific controls 为 0 blocker。
  6. ledger P0/P1/P2/P3 open 为 0。
  7. feature mapping gap/blocker/walkthrough debt 为 0。
  8. canon + field mirror drift 为 0。
  9. i18n/language/meta gates 全绿。
  10. meta leak 0 hit。
  11. 全路由 console/runtime error 为 0。
  12. verified/closed ledger rows 均绑定 sentinel。
- 报告尾部输出非计分的 Post-L5 Owner Review Gate:先生成 L5 报告,再运行 `npm run verify:owner-review`,由 readiness gate 校验最新 L5 timestamp、最终验收包、PRD dry-run/apply-check 与主人确认门禁。该 gate 不参与 L5 12 条 pass/fail,避免 L5 与 owner-review readiness 互相等待。
- Windows `.cmd` 子进程使用 `cmd.exe /d /s /c` 启动,日志记录 stdout/stderr/spawn-error。
- action sample 判定允许 `sampled/captured/passed` 的有效 proof 状态,但仍严卡 `no-observable-change`、`fake-write`、`business-incomplete-modal`、`modal-blocked`、blocked/incomplete businessAssessment。

## 5. 同形全站扫描范围

- 全三端 verify 不再分散手跑;L5 总闸统一读取三端结果和运行日志。
- 全 route/action shard 统一聚合,包含 Admin `AD-*`、Next `NEXT-FR-*`、UniApp `UNI-FR-*`。
- 全 verified/closed ledger rows 统一检查 `sentinel` 字段,防止缺陷关闭但没有防回归机制。
- 全核心数字口径通过 canon sentinel 从三端源码抽取,避免单端改数字。

## 6. 验收断言

1. `node --check scripts\l5-final-sweep.mjs` 0 syntax error。
2. `node scripts\canon-sentinel.mjs`: `status=passed`,86 checks,0 failure。
3. `bash ..\Nexion-prototype\scripts\verify.sh all`: 230 passed,0 failed。
4. `bash ..\Nexion-uniapp\scripts\verify.sh`: 16 pass,0 fail,包含 `uniapp i18n mirror PASS: 3779 keys`。
5. `node scripts\l5-final-sweep.mjs --run-verifiers`: 12/12 checks passed; Admin 66 / Next 80 / UniApp 81 route counts; runtimeBad=0; actionBad=0。

## 7. 拟新增哨兵

- `scripts/l5-final-sweep.mjs`: L5 12 条终验总闸。
- `scripts/canon-sentinel.mjs`: staking/genesis/device/product/withdrawal 核心数字三端口径哨兵。
- Admin `scripts/verify.sh`: canon-sentinel 常驻 gate。
- UniApp `scripts/i18n-key-mirror.mjs` + `scripts/verify.sh`: i18n key mirror 常驻 gate。
- Next/UniApp/Admin `verify.sh`: Windows/WSL `node`/`curl.exe` fallback。

---

## 完成回执

- `node --check scripts\l5-final-sweep.mjs`: PASS。
- `node scripts\canon-sentinel.mjs`: PASS,86 checks,0 failure。
- `npm run verify`(Admin): PASS,148 checks,0 failed。
- `bash scripts/verify.sh all`(Next): PASS,230 passed,0 failed。
- `bash scripts/verify.sh`(UniApp): PASS,16 pass,0 fail。
- `node scripts\l5-final-sweep.mjs --run-verifiers`: PASS,12/12 checks passed; routeCounts Admin 66 / Next 80 / UniApp 81; runtimeBad=0; actionBad=0。
- 报告:`docs/audit/l5-final-sweep-report.md` + `docs/audit/l5-final-sweep-report.json`。
- Post-L5 readiness:`npm run verify:owner-review`: PASS,7/7 checks passed;报告 `docs/audit/owner-review-readiness-report.md` + `.json`。
