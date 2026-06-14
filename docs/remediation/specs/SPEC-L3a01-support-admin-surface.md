# SPEC-L3a01-support-admin-surface

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L3a 功能点一一对应 / 缺面补齐 |
| 端 | cross / admin / uniapp |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | SD-005, FR-009, FM-018 |
| 关联规格卡 | `modal-specs/content-support-ticket-workflow.md` |

## 1. 背景与问题

Feature mapping FM-018 显示前端 Help/Support/Support Tickets 有业务面, 但后台缺 `/content/support` 管理 surface。UniApp 同时存在支持 CTA 无响应 FR-009。前端支持流修通后, 后台仍需要对应 help content/ticket 管理入口, 否则不能满足“后台与前端功能点一一对应”。

## 2. 目标与非目标

目标: 增加 `/content/support` 后台 surface, 能管理 FAQ/help content、ticket 分类、ticket 状态、运营回复模板, 并与 UniApp support ticket mock 数据保持字段镜像。

非目标: 不接真实客服 SaaS; 不实现在线聊天; 不把 support 归入风险/用户域导致内容管理不可见。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\nav\console-nav.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\nav\spec-hints.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\admin\registry\i.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\(console)\content\support\page.tsx` (新建或等价 route)
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\store\admin\platform-config-store.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\inventory\feature-mapping.json`
- `D:\WORKS\PLAN\Nexion-uniapp\src\mock\tickets.ts`
- `D:\WORKS\PLAN\Nexion-uniapp\src\pages\me\support*.vue`

## 4. 方案

1. 导航新增 `/content/support`, 放在内容与合规 CMS 下。
2. 页面包含三块: Help/FAQ 内容管理、Ticket 分类与 SLA、Ticket 列表与运营回复。
3. Ticket 操作必须是真动作: open -> detail, assign, reply, change status, close/reopen, 每项有业务字段和审计理由。
4. 与 UniApp ticket mock 对齐字段: id, category, subject, status, priority, lastReplyAt, messages, owner。
5. 更新 feature-mapping FM-018 status/evidence, 但只有后台操作和 UniApp 支持流均验证通过后才能从 gap 变 ok。

## 5. 同形全站扫描范围

- `rg -n "support|ticket|FAQ|help" D:\WORKS\PLAN\Nexion-admin-prototype D:\WORKS\PLAN\Nexion-uniapp\src -g "!node_modules/**" -g "!.next/**"`
- `node scripts\remediation-feature-map-audit.mjs` 与 `node scripts\remediation-feature-map-operability.mjs`。

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build` 通过。
2. `/content/support` 在 nav routes、routes inventory、feature mapping 中均存在。
3. Runtime admin shard 覆盖 `/content/support`, route/action error 为 0。
4. 至少 3 个操作任务可完成并 persist: 新建 FAQ、回复 ticket、关闭 ticket。
5. `node scripts\remediation-feature-map-operability.mjs` 后 FM-018 不再是 `gap`, 但若 FR-009 未关闭仍保持 blocked。

## 7. 拟新增哨兵

- Feature-mapping gate: FM-018 无 `/content/support` 直接失败。
- Support ticket task walkthrough: create/reply/close 三任务。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `node scripts/admin-support-surface-audit.mjs` PASS
  - `node scripts/admin-support-surface-proof.mjs` PASS: route controls present, `FAQ-004` persisted after refresh, `TK-1024` reply persisted after refresh, `TK-1024` close persisted after refresh
  - `node scripts/remediation-runtime-admin-shard.mjs AD-09` PASS: 8/8 captured, 0 errors, `/content/support` runtime captured
  - `node scripts/remediation-feature-map-audit.mjs` PASS: `gaps=0`
  - `node scripts/remediation-feature-map-operability.mjs` PASS: `FM-018` = `provisionally-operable`, no blocking ledger ids
- 同形扫描结果：
  - `rg -n "support|ticket|FAQ|help" ...` 范围已覆盖 admin + UniApp support mock/store/pages；UniApp ticket mock/store 已补 `owner/lastReplyAt` 镜像字段。
  - `/content/support` 不使用空通用弹窗承载核心动作；FAQ/SLA/ticket 处理均为页面内业务字段 + 审计理由 + persist。
- 哨兵：
  - `scripts/admin-support-surface-audit.mjs`
  - `scripts/admin-support-surface-proof.mjs`
  - `scripts/verify.sh` support surface gate + `/content/support` SSR needles
  - `docs/audit/shards/ad-09-support-action-sample.ndjson`
- PR：local remediation batch
- 台账更新：`SD-005` 转 `verified`; `FM-018` 从 gap 转 `provisionally-operable`
