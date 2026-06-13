# SPEC-L3c01-uniapp-full-route-batch-audit

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L3c UniApp 全量迁移收口 gate |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-008 |
| 关联规格卡 | - |

## 1. 背景与问题

`INIT-008` 是 MASTER-PLAN seed:UniApp 是前端交付主体,不能只声明“全量迁移完成”,必须用批量审计证明 Next 参考源路由已映射到 UniApp pages,且迁移过程中修过的交互断点没有回退成死控件、空跳或无响应。

历史证据已证明 UniApp H5 有 81 个唯一路由能渲染,但关闭 seed 还缺一个可重跑 gate:静态路由映射、`pages.json` / `.vue` 文件存在、runtime shard、front action sampler 必须一次性绑定。

## 2. 目标与非目标

目标:

1. 建立 `INIT-008` 常驻 gate,校验 Next 80 路由全部有 UniApp H5 映射。
2. 校验 UniApp `src/pages.json` 每条 page 都有对应 `.vue` 文件。
3. 校验 `UNI-FR-01`~`UNI-FR-10` runtime evidence 覆盖所有 UniApp pages,且全部 captured / routeMatch。
4. 校验 `UNI-FR-01`~`UNI-FR-10` action sampler 无 `error`、`click-target-missing`、`hash-only-no-content`、`no-observable-change` 阻断分类。
5. 修正 UniApp `verify.sh` 在 Windows/WSL 混合环境中错误 skip H5 probe 的问题。

非目标:

1. 不声明 L5 终验完成;`FT-013`~`FT-015` 仍是后续 persona walkthrough。
2. 不改 Next.js 参考源页面设计。
3. 不把状态文案/倒计时/标题误算成业务动作。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\uniapp-port-coverage-audit.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-front-action-sample.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\shards\uni-fr-*-runtime.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\shards\uni-fr-*-front-action-sample.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\uniapp-full-route-batch-audit-evidence.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\ledger.ndjson`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\LEDGER.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\MASTER-PLAN.md`
- `D:\WORKS\PLAN\Nexion-uniapp\scripts\verify.sh`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-PITFALLS.md`
- `D:\WORKS\PLAN\Nexion-uniapp\docs\PORT-LEDGER.md`

## 4. 方案

- 新增 `scripts/uniapp-port-coverage-audit.mjs`:直接扫描 `Nexion-prototype/app/**/page.tsx` 和 `Nexion-uniapp/src/pages.json`,按明确动态段/flatten 规则映射:
  - `/` -> `/#/pages/index/index`
  - `/store/[productId]` -> `/#/pages/store/detail`
  - `/store/orders/[id]` -> `/#/pages/store/order-detail`
  - `/me/security/kyc-express` -> `/#/pages/me/kyc`
  - `/ref/[code]` -> `/#/pages/ref/code`
  - `/tx/[hash]` -> `/#/pages/tx/hash`
  - 其余单段双写、多段 flatten/dash/how-it-works 候选。
- 允许唯一 net-new UniApp 页 `/#/pages/onboarding/terms`;其他额外页视为未裁决漂移。
- 读取 `docs/audit/shards/uni-fr-*-runtime.ndjson` 和 `uni-fr-*-front-action-sample.ndjson`,将路由错误和 action 阻断分类升级为 gate fail。
- 收紧 `remediation-runtime-front-action-sample.mjs` 的 UniApp 候选抽取:保留真实 `Sign in` 动作,过滤倒计时、工单标题、状态标签、说明性 copy。
- UniApp `verify.sh` 在 WSL bash 下优先使用 `curl.exe`,避免 Windows dev server 在线时被 Linux curl 误判为 skip。

## 5. 同形全站扫描范围

- 静态:Next 80 route files 全扫;UniApp 81 pages 全扫;所有 page 的 `.vue` 文件存在。
- Runtime:`UNI-FR-01`~`UNI-FR-10` 全量 rerun,合计 82 条 capture(含重复 shard 路由),0 error。
- Action:`UNI-FR-01`~`UNI-FR-10` 全量 rerun,合计 86 条样本,0 阻断分类。
- Sampler 误报同形:倒计时 `Resets in...`、状态 `Ready to claim`、工单标题 `Withdrawal pending...`、签到提示 `Start your streak today` 均不再被当业务动作。

## 6. 验收断言

1. `node scripts\uniapp-port-coverage-audit.mjs`: `status=passed`, `nextRoutes=80`, `uniPages=81`, `mappedRoutes=80`, `runtimeCaptured=82`, `actionRows=86`, `blockingActionSamples=0`。
2. `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh`: PASS, 15 pass / 0 fail,且 H5 probe 为 `Home shell [200] /` 而非 SKIP。
3. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run verify`: PASS。
4. `cd D:\WORKS\PLAN\Nexion-admin-prototype; node scripts\ledger-validate.mjs`: PASS。
5. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build`: PASS。

## 7. 拟新增哨兵

- `scripts/uniapp-port-coverage-audit.mjs`
- `scripts/verify.sh` 中新增 `UniApp 全路由迁移 gate(Next 映射/pages/runtime/action sample)`。
- UniApp `scripts/verify.sh` WSL `curl.exe` fallback 防 H5 probe 假 skip。

---

## 完成回执

- `UNI-FR-01`~`UNI-FR-10` runtime 已在 `UNI_BASE_URL=http://localhost:5173` 全量刷新:82/82 captured,0 routeErrors,0 errors。
- `UNI-FR-01`~`UNI-FR-10` front action sampler 已在 `UNI_BASE_URL=http://localhost:5173` 全量刷新:86 samples,86 sampled,0 errors,0 `noObservableChange`,0 `clickTargetMissing`,0 `hashOnlyNoContent`。
- `node scripts\uniapp-port-coverage-audit.mjs`: PASS, `nextRoutes=80`, `uniPages=81`, `mappedRoutes=80`,唯一 extra 为 `/#/pages/onboarding/terms`。
- `D:\WORKS\PLAN\Nexion-uniapp`: `bash scripts/verify.sh` PASS,15 pass / 0 fail, H5 probe `Home shell [200] /`。
- `INIT-008` ledger 已转 verified, sentinel 绑定 `scripts/uniapp-port-coverage-audit.mjs`。
