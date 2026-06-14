# SPEC-L2b04-uniapp-growth-deeplinks

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2b 前端缺陷分流 / UniApp 增长与外链动作 |
| 端 | uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | FR-012, FR-013 |
| 关联规格卡 | - |

## 1. 背景与问题

Team/Genesis/Events/Proof 多个 CTA 在真实 H5 采样中无响应: 发票/流量日志提交、购买 Pro、打开 Genesis marketplace、View on OpenSea、Claim discount、分享 proof 均没有 route、sheet、toast 或状态变化。

## 2. 目标与非目标

目标: 所有看起来可点的增长/外链 CTA 必须完成一个明确动作: 内部路由、业务 sheet、外链复制/打开、领取状态写入或不可用原因。

非目标: 不接真实 OpenSea/浏览器分享能力; 不新增团队结算后台。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\team\agent.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\team\quota.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\genesis\how-it-works.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\genesis\marketplace.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\events\events.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\proof.vue`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\event-quest.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\genesis.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\store\ui.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\lib\route.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\en.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\i18n\messages\zh.ts`

## 4. 方案

1. Team: invoice/log submission 打开提交 drawer/sheet, 包含活动、金额/证据链接、备注字段; Buy Pro 路由到 `/pages/store/detail?id=stellarbox-pro` 或 checkout。
2. Genesis: marketplace CTA 内部路由到 `/pages/genesis/marketplace`; OpenSea 在 H5 优先 `window.open`, 失败则 copy URL 并 toast。
3. Events: Claim discount 写入 `event-quest` 领取状态或打开领取确认 sheet, 重复领取展示已领取状态。
4. Proof: share CTA 在 H5 使用 copy/share fallback, 成功后展示 copied/shared 状态。
5. 把“平台能力不可用”作为显式反馈, 禁止静默失败。

## 5. 同形全站扫描范围

- `rg -n "OpenSea|marketplace|Claim discount|share|Submit invoice|Buy NexionBox|window\\.open|setClipboardData" D:\WORKS\PLAN\Nexion-uniapp\src`
- 扫描所有 `@click` 空 handler 或仅注释占位的增长 CTA: `rg -n "@click=\"\\(\\)|@click=\".*TODO|fail: \\(\\) => \\{\\}" D:\WORKS\PLAN\Nexion-uniapp\src\pages`

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check` 通过。
2. 依次运行:
   `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='2'; node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-07`;
   `node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-08`;
   `node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-09`;
   `node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-10`。FR-012/013 样本不再无响应。
3. Team invoice CTA 打开含提交字段的 sheet; Buy Pro route 到 store 相关页面。
4. Genesis marketplace CTA route 变化; OpenSea 失败时 toast/copy URL 可见。
5. Claim discount 写入领取态, 刷新仍显示已领取或下一步。
6. Proof share CTA 产生 copied/shared 文案或系统分享 fallback。

## 7. 拟新增哨兵

- `front-action-sample` 增加 external/deep-link 分类: 外链点击必须有 `urlChanged`, `newPage`, `copied`, `toast`, 或 explicit unavailable reason 之一。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check` PASS。
  - `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh` PASS：14 pass / 0 fail；H5 route check 因本轮 dev server 在 `5174` 而脚本探测 `5173` 被跳过。
  - `UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-07` PASS：`noObservableChange=0`。
  - `UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-08` PASS：`noObservableChange=0`。
  - `UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-09` PASS：`noObservableChange=0`。
  - `UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-10` PASS：`noObservableChange=0`。
  - Browser H5 proof: Team KOL bucket selects application context and exposes submission fields; Buy Pro routes to `/#/pages/store/detail?id=stellarbox-pro`; Genesis routes to marketplace, OpenSea fallback dialog exposes Retry/Back controls, listing Buy writes Mine state; Events Claim discount persists claimed state after reload; Proof Copy link / Save PNG show feedback toasts.
- 同形扫描结果：
  - Team incentive CTAs, Genesis marketplace/OpenSea/listing buy, Events discount claim, and Proof share destination controls were rescanned and converted from generic/no-op controls into semantic actionable buttons with route/state/toast/dialog feedback.
- 哨兵：
  - `UNI-FR-07`, `UNI-FR-08`, `UNI-FR-09`, `UNI-FR-10` action samplers now guard these route families with `noObservableChange=0`.
  - Browser runtime console/pageerror listeners were used for Proof and OpenSea flows; current interactions report `errors=[]`.
- PR：
  - 本地整改，未创建 git PR。
- 台账更新：
  - `FR-012`、`FR-013` 已转 `verified`。
  - 证据文档：`docs/audit/uniapp-growth-deeplinks-runtime-evidence.md`。
