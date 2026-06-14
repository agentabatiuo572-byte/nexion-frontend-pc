# SPEC-L3c03-feature-mapping-walkthroughs

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L3c Source C feature-mapping walkthrough gate |
| 端 | cross |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FM-004; FM-005; FM-008; FM-013; FM-016; RT-016 |
| 关联规格卡 | `SPEC-L3a02`; `SPEC-L3c02` |

## 1. 背景与问题

`SPEC-L3a02` 已关闭 `INIT-007` seed,证明 feature-mapping 矩阵存在且无 gap/blocker,但当时仍保留 `needs-task-walkthrough` 外溢项。`SPEC-L3c02` 又证明了 `FT-013`~`FT-015`,间接覆盖 `FM-009`~`FM-011` 的前台业务页走查。

剩余需要显式收口的是 Source C feature mapping 的五类任务:

- `FM-004`: top-up channels 与 KYC Express copy/status。
- `FM-005`: staking 前台开仓 + 后台 APY 调参。
- `FM-008`: unilevel 筛选与规则页。
- `FM-013`: 用户可见 copy 语言切换。
- `FM-016`: feature/module switch 从参数寄存器跳到 owner module,并证明前台对应模块可见/可操作。

本轮还抓到一个后台横向弹窗问题:`OperationConfirmModal` 只显示泛化摘要,业务 `detail` 被藏在折叠区,导致“停售档位”弹窗正文看起来像通用壳,没有直接暴露 `停售只停新锁` 这种业务影响。

## 2. 目标与非目标

目标:

1. 新增可重跑的 `scripts/feature-mapping-walkthrough-proof.mjs`,用真实浏览器控件证明剩余 Source C rows 的业务结果。
2. proof 必须验证弹窗内部业务语义和可操作组件,不能只验证弹窗出现。
3. 修复后台 `OperationConfirmModal` 横向问题,让业务 `detail` 在弹窗正文中可见。
4. 将 proof 接入 admin `npm run verify`。
5. 让 Source C operability audit 识别 task proof,并将 `feature-mapping.json` 收敛到 18/18 `provisionally-operable`。

非目标:

1. 不做真实 API 级后台 -> UniApp runtime 联动;当前原型仍按既定决策做功能点一一对应和可操作控制面证明。
2. 不宣称 L5 终验完成;`provisionally-operable` 仍保留 final L5 sweep 口径。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\feature-mapping-walkthrough-proof.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-feature-map-operability.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\design-kit.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\shards\feature-mapping-walkthrough-proof.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-walkthrough-runtime-evidence.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-operability-audit.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\feature-mapping-operability-audit.json`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\inventory\feature-mapping.json`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\task-walkthrough-matrix.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\wallet-topup.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\components\staking\vault-row.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\components\staking\stake-sheet.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\team\unilevel.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\language.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-PITFALLS.md`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-LEDGER.md`

## 4. 方案

- `FM-004`:真实选择 TRC20 top-up 通道,复制地址;进入 KYC Express,生成合规检查,复制地址,提交 payment sent,断言 exact amount/status/bill。
- `FM-005-FRONT`:真实点击 30d staking row,打开 stake sheet,填写金额并提交,断言 active position 和 stake bill。
- `FM-005-ADMIN`:后台 `/finance-products/staking` 点击 APY `调`,弹窗必须有目标新值/操作理由/确认执行,提交后写 `G.staking.apy.usdt30d` 与 audit,刷新仍显示 `13%`。
- `FM-008`:unilevel 页面真实切换 direct/extended filter,断言行类型;how 入口进入规则页。
- `FM-013`:语言页真实切到 zh,断言 locale store 后检查 top-up/staking/unilevel 三个业务页中文 copy。
- `FM-016-FRONT`:前台 staking 模块真实可见,30d row 可点击并打开业务 sheet。
- `FM-016`:从 `/platform/params-registry` 找 `G1 Staking` owner link 到 `/finance-products/staking`,点击 `停售`,弹窗必须直接显示 `停售只停新锁` 业务影响,填理由并确认后写 `G.staking.enabled.usdt30d=false` 与 audit,刷新显示 `已停售`。
- 横向弹窗修复:`OperatorBriefBlock` 将 caller 传入的业务 `detail` 提升为可见的 `业务规则` 行,不再只藏在 collapsed details 中。
- operability 生成器修复:把 `feature-mapping-walkthrough-proof.ndjson` 与 `uniapp-persona-walkthrough-proof.ndjson` 的 passed task proof 计入 Source C action evidence。

## 5. 同形全站扫描范围

- 弹窗同形:所有 `OperationConfirmModal` 调用都共享 `OperatorBriefBlock`;修复点在原语层,所以业务 detail 对全域操作确认弹窗生效。
- 任务式 proof 同形:operability audit 不再只认早期 `*-action-sample.ndjson`,也认 `*-proof.ndjson` 中通过的业务走查,避免已经 proof 的任务仍滞留在 `needs-task-walkthrough`。
- UniApp 关键控件同形:本轮补稳定业务 class,proof 一律从 DOM 控件触发并回源断言 storage/route/body。

## 6. 验收断言

1. `node scripts\feature-mapping-walkthrough-proof.mjs`: `status=passed`,7 个 FM step 全 pass。
2. `node scripts\remediation-feature-map-operability.mjs`: `needsTaskWalkthrough=0`, `provisionallyOperable=18`。
3. `node scripts\feature-mapping-closure-proof.mjs`: `needsWalkthrough=[]`。
4. `npm run verify` 必须包含 `feature-mapping-walkthrough` gate。
5. 后台 “停售” 弹窗正文必须可见 `停售只停新锁`,并能填写理由、确认、写参数/audit。

## 7. 拟新增哨兵

- `scripts/feature-mapping-walkthrough-proof.mjs`
- `scripts/verify.sh` 中新增 `Feature-mapping walkthrough gate(FM-004/005/008/013/016)`。
- `scripts/remediation-feature-map-operability.mjs` 识别 task proof 的证据计数。

---

## 完成回执

- `feature-mapping-walkthrough-proof`: PASS,7/7 step passed。
- `remediation-feature-map-operability`: PASS,18 mappings; gap=0; blockedByLedger=0; needsTaskWalkthrough=0; provisionallyOperable=18。
- `feature-mapping-closure-proof`: PASS,`needsWalkthrough=[]`。
- 台账更新:`RT-016` verified; Source C feature-mapping 剩余 walkthrough 清零。
