# SPEC-L2b05-next-reference-logic-dead-controls

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2b 前端缺陷分流 / Next 参考源逻辑级清零 |
| 端 | frontend(参考源) / cross |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-001, INIT-005, INIT-006, SD-001, SD-002, SD-003, FR-001, FR-002, FR-008 |
| 关联规格卡 | - |

## 1. 背景与问题

Next 参考源不再承担主要视觉打磨, 但仍是 UniApp 行为参考。当前存在 Home 内部 phase 标签泄漏、多个 `href="#"` 死链、Trust/Learn/Store review CTA 无响应、i18n key mismatch。参考源若继续带着逻辑级错误, UniApp 迁移会复制错行为。

## 2. 目标与非目标

目标: 参考源逻辑/铁律级缺陷清零: 无 meta leak、无看起来可点但无动作的参考 CTA、i18n key 镜像一致。把体验类/排版类问题只写入 UniApp port spec, 不投入 Next 视觉重构。

非目标: 不重构 Next 页面布局; 不把所有 UniApp P1 反向移植到 Next。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\trust\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\learn\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\store\[productId]\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\(main)\me\wallet\nex\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\app\ref\[code]\page.tsx`
- `D:\WORKS\PLAN\Nexion-prototype\lib\i18n\messages\en.ts`
- `D:\WORKS\PLAN\Nexion-prototype\lib\i18n\messages\zh.ts`
- `D:\WORKS\PLAN\Nexion-prototype\scripts\interaction-audit.mjs`
- `D:\WORKS\PLAN\Nexion-prototype\scripts\verify.sh`

## 4. 方案

1. Home 上所有 `P1`-`P6` 等内部阶段标签替换为用户可见业务文案, 保留内部 phase 仅在非可见常量/注释中。
2. `href="#"` 若有业务动作, 改成真实 route/scroll/modal; 若纯展示, 改为非链接元素并移除 pointer 样式。
3. Store review CTA 打开/滚动到 reviews 区, 并同步 UniApp 行为要求。
4. Learn article card 打开课程/文章详情或内联 lesson sheet; 不再是 dead anchor。
5. i18n en/zh key 做镜像补齐, `verify.sh` 加 key diff gate。

## 5. 同形全站扫描范围

- `rg -n "href=\\\"#\\\"|href='\\#'|window.location.hash|P[1-6]" D:\WORKS\PLAN\Nexion-prototype\app D:\WORKS\PLAN\Nexion-prototype\lib`
- `node D:\WORKS\PLAN\Nexion-prototype\scripts\interaction-audit.mjs` 或现有 verify 中同类 gate。
- i18n: 对 `lib/i18n/messages/en.ts` 与 `zh.ts` 做 key set diff。

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-prototype; npm run build` 通过。
2. `cd D:\WORKS\PLAN\Nexion-prototype; bash scripts\verify.sh` 通过, 且新增 meta/dead-anchor/i18n gate 真实覆盖。
3. 依次运行:
   `cd D:\WORKS\PLAN\Nexion-admin-prototype; $env:FRONT_ACTION_SAMPLE_LIMIT='3'; node scripts\remediation-runtime-front-action-sample.mjs NEXT-FR-01`;
   `node scripts\remediation-runtime-front-action-sample.mjs NEXT-FR-03`;
   `node scripts\remediation-runtime-front-action-sample.mjs NEXT-FR-09`。FR-001/002/008 样本不再无响应。
4. `rg -n "href=\\\"#\\\"|P[1-6]" app lib` 不得命中用户可见页面文本; 合理注释/测试需白名单。

## 7. 拟新增哨兵

- Next `verify.sh` 新增 `meta-leak`, `dead-anchor`, `i18n-mirror` 三项。
- `interaction-audit.mjs` 输出可被 remediation ledger 复用的 dead-control 清单。

---

## 完成回执（实现完成时回填）

- 验证证据：`docs/audit/next-reference-logic-runtime-evidence.md`
  - `npm run build` PASS。
  - `bash -lc 'BASE_URL=http://172.17.192.1:3001 bash scripts/verify.sh all'` PASS：`230 passed, 0 failed`。
  - `node scripts\i18n-key-mirror.mjs` PASS：`3542 keys`。
  - `node scripts\interaction-audit.mjs` PASS：0 findings。
  - `NEXT-FR-01` / `NEXT-FR-03` / `NEXT-FR-09` / `UNI-FR-03` action sampler 均 `noObservableChange=0`。
  - Browser 实景：Trust profile/press/Q3 report、Store review center、Learn lesson sheet completion、NEX donate unavailable state 全部有真实业务反馈，`errors=[]`。
- 同形扫描结果：`rg -n 'href="#"|href=''#''' app lib` 0 命中；`verify.sh` dead-anchor / phase-label / i18n mirror 三个新增 gate 全绿。
- 哨兵：`scripts/verify.sh` `[1.6] Reference dead-anchor guard`、`[1.7] Internal phase-label leak guard`、`[1.8] i18n mirror guard`；`scripts/i18n-key-mirror.mjs`；`scripts/interaction-audit.mjs`；runtime samplers `NEXT-FR-01`、`NEXT-FR-03`、`NEXT-FR-09`、`UNI-FR-03`。
- PR：本地整改任务，未创建远端 PR。
- 台账更新：`INIT-001`、`INIT-005`、`INIT-006`、`SD-001`、`SD-002`、`SD-003`、`FR-001`、`FR-002`、`FR-008` 转 `verified`。
