# SPEC-L2b01-uniapp-checkout-flow

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2b 前端缺陷分流 / UniApp 核心转化链 |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FR-003, FR-004, FM-002 |
| 关联规格卡 | - |

## 1. 背景与问题

Source E 动作采样确认 UniApp `/pages/store/checkout` 的 `Continue` 在真实 H5 运行时无可观察变化, 直接阻断购机流程。`/pages/store/orders` 空态 `Browse Store` 同样无响应, 使失败后无法回到商城。代码中已存在 checkout 状态机、`orders.createOrder()` 和 `bills.add()` 注释, 但运行时证据证明当前点击链未完成业务任务。

## 2. 目标与非目标

目标: 修通 UniApp checkout 从支付选择到确认、支付指引、订单创建、账单落账、订单列表/详情可见的完整链路; 修复空订单返回商城 CTA。

非目标: 不重做商城视觉设计; 不新增真实支付网关; 不改后台 SKU 管理面。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\store\checkout.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\store\orders.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\store\order-detail.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\components\store\chain-payment.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\components\store\card-payment.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\orders.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\bills.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\app.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\en.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\zh.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-front-action-sample.mjs` (仅当需要补强 checkout 任务断言)

## 4. 方案

1. 将 `Continue` 从裸 `step = 'confirm'` 收敛为明确的 `goConfirm()` handler, 在 H5/UniApp 事件模型下写入 `step.value` 并给当前步骤加可测标识。
2. 支付方式选择、确认、支付完成三段均必须有可观察结果: stepper 进度、标题/正文变化、按钮文案变化或 toast。
3. `Pay Now`/`Continue to payment` 后必须进入 `pay-instructions`; `ChainPayment`/`CardPayment` complete 后进入 `awaiting`; 自动确认后只创建一次 order, 同步写 `nexion-orders-v4` 与 `nexion-bills-v1`。
4. 订单创建失败必须回滚到可继续操作的步骤, 展示失败原因, 不允许 toast 成功但没有 order/bill。
5. `orders.vue` 空态 `Browse Store` 使用在 H5 下可观测的导航方式; 若 `reLaunch` 被当前运行时吞掉, 使用统一 safe route helper 或 `redirectTo` fallback。

## 5. 同形全站扫描范围

- `rg -n "step = '|step.value|@click=\"step|reLaunch\\(|navigateTo\\(" D:\WORKS\PLAN\Nexion-uniapp\src\pages\store D:\WORKS\PLAN\Nexion-uniapp\src\components\store`
- `rg -n "createOrder\\(|bills.add\\(|nexion-orders-v4|nexion-bills-v1" D:\WORKS\PLAN\Nexion-uniapp\src`
- 检查所有商城 CTA: `checkout`, `orders`, `order-detail`, `detail`, `store`, `bundle`。

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check` 通过。
2. `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='3'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-03` 后 `Continue` 与 `Browse Store` 不再为 `no-observable-change`。
3. Playwright 实景: 打开 `http://localhost:5173/#/pages/store/checkout?product=stellarbox-s1`, 点击 `Continue` 后出现 review/order 确认内容; 点击支付确认后进入支付指引; 触发 complete 后出现 awaiting/confirmed/live 链。
4. 刷新后 `/#/pages/store/orders` 至少显示新订单, order detail 可通过 `?id=` 打开。
5. 浏览器 storage 中 `nexion-orders-v4` 新增 order, `nexion-bills-v1` 新增 `type=purchase` 且 amount 为负数。

## 7. 拟新增哨兵

- 在 `remediation-runtime-front-action-sample.mjs` 增加 checkout 专项断言: `Continue` 必须改变步骤文本或进入确认卡; `Browse Store` 必须改变 route。
- 若新建 e2e, 命名为 `scripts/uniapp-checkout-flow-e2e.mjs`, 绑定 FR-003/FR-004 跑红→绿。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\uniapp-checkout-flow-runtime-evidence.md`
  - `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\shards\uni-fr-03-front-action-sample.ndjson`
  - `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\screenshots\uni-fr-03-hash-pages-store-checkout-Continue-front-after.png`
  - `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\screenshots\uni-fr-03-hash-pages-store-orders-Browse-Store-front-after.png`
- 同形扫描结果：
  - `UNI-FR-03` action sampler: routes=6, samples=8, errors=0, `noObservableChange=0`, `clickTargetMissing=0`.
  - 同形修复包含 checkout `Continue`, orders empty-state `Browse Store`, product detail sticky `Buy now` parent area, store `Orders` chip, order-detail `View on Earn`, order-detail back, and checkout/detail/orders/bundle page-header back controls。
  - `rg -n 'navigateBack|@click=' src\pages\store src\components\store`: store-domain `navigateBack` 0 hits；裸 `@click=` 只剩 `product-card.vue` 根节点，且该节点已有 `@tap` + `@click` 双绑定。
- 哨兵：
  - `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:UNI_BASE_URL='http://localhost:5174'; $env:FRONT_ACTION_SAMPLE_LIMIT='3'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-03`
  - `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check`
  - `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh`
  - Playwright browser batch: checkout/detail/orders/bundle direct-load page-header back controls all route to `/#/pages/store/store`; seeded order-detail `Back to orders` routes to `/#/pages/store/orders`; seeded order-detail `View on Earn` routes to `/#/pages/earn/earn`。
- PR：本地整改任务, 未创建远端 PR。
- 台账更新：`FR-003`、`FR-004` 已更新为 `verified` 并绑定 runtime sentinel。
