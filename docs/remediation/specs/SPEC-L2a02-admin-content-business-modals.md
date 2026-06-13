# SPEC-L2a02-admin-content-business-modals

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2a 弹窗逐个细化重构 / 内容域 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-002, RT-007, RT-008, RT-009, RT-010, RT-011 |
| 关联规格卡 | `modal-specs/content-i18n-edit-repair.md`, `modal-specs/content-learn-course-new.md`, `modal-specs/content-copy-ab-draft-edit.md`, `modal-specs/content-disclosure-trust-new-version.md`, `modal-specs/content-notifications-campaign-edit.md` |

## 1. 背景与问题

内容域的编辑/新建类弹窗普遍只展示通用说明和备注/理由框, 缺少真正能编辑业务对象的字段。Source A 已用截图证明 `/content/i18n`, `/content/learn`, `/content/copy-ab`, `/content/disclosure`, `/content/trust`, `/content/notifications` 均存在此类 modal-blocked。

## 2. 目标与非目标

目标: 内容域所有编辑/新建/修复类弹窗都变成业务表单: i18n 有 zh/en 字段和占位符校验, 课程有 authoring 字段, A/B draft 有 variant 字段, disclosure/trust 有版本/辖区/正文, notification edit 有 campaign 字段。

非目标: 不接真实 CMS 后端; 不重写整个 I 域页面结构; 不删除已有审计确认。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs\i6-i18n.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs\i1-copy-ab.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs\i3-campaign.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs\i4-trust.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs\data.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\store\admin\platform-config-store.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-action-sample.mjs`

## 4. 方案

1. i18n edit/repair: 表单字段包括 key、中文文案、英文文案、占位符列表、预览、发布状态; 保存写 `I.i18n.<key>.*` 并追加审计。
2. New course: 表单字段包括 slug、category、level、duration、reward、title.zh/en、body.zh/en、publish state; 保存后课程草稿出现在教程表。
3. Copy A/B draft: 表单字段包括 variant id、headline/body zh/en、audience、traffic split、version note; 保存后列表/详情显示新版本。
4. Disclosure/trust new version: 表单字段包括 version、jurisdiction、language scope、body、effective date、requires re-ack; 发布确认后状态变化。
5. Notification edit: 复用 campaign create drawer 的 title/body/tier/audience/schedule/budget 字段, 编辑保存后该 campaign 行立刻变化。

## 5. 同形全站扫描范围

- `rg -n "编辑\\(中英同步\\)|修复完整性|新建课程|编辑草稿|草拟新版|发新版|Campaign.*编辑|备注\\(可选" D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs`
- `rg -n "setParam\\(`I\\.|admin\\.i18n|admin\\.learn|admin\\.notification|admin\\.disclosure|admin\\.trust" D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-tabs`

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build` 通过。
2. `node scripts\remediation-runtime-action-sample.mjs AD-09` 后 RT-007~RT-011 不再出现 `business-incomplete-modal`。
3. 每个 modal-spec 中至少 1 条任务式验证: 填字段 -> 保存 -> 行/统计/详情变化 -> 刷新仍在 -> A2 审计可见。
4. i18n edit/repair 的 zh/en 字段缺失时 confirm disabled 且原因可见; 合法输入后 enabled。
5. Notification edit 不能退化为只写备注, 修改 title/body/audience 后列表可见。

## 7. 拟新增哨兵

- `admin-modal-contract-audit.mjs` 对内容域语义关键字建立 required field map。
- AD-09 runtime action sample 作为内容域 modal 回归 gate。

---

## 完成回执（实现完成时回填）

- 验证证据：2026-06-13 `node scripts/admin-content-business-modal-proof.mjs` PASS 6/6，覆盖 i18n edit guard、i18n repair、course authoring、copy A/B draft、disclosure draft、campaign edit；每项均执行“填字段 -> 提交 -> 刷新/重开 -> 页面与 store 持久化回证”。
- 同形扫描结果：`node scripts/remediation-runtime-action-sample.mjs AD-09` PASS：routes=8, samples=45, sampled=45, errors=0, noObservableChange=0, businessIncompleteModal=0；支持页内联表单动作按业务控件计入，不再把已可操作内联表单误判为缺弹窗。
- 哨兵：`node scripts/admin-modal-contract-audit.mjs` PASS checkedRequired=7 checkedForbidden=9；`node scripts/admin-modal-contract-proof.mjs` PASS 7/7；`npm run verify` PASS 143 checks, 0 failed；`npm run build` PASS；`npx --no-install tsc --noEmit` PASS；`git diff --check` 仅 CRLF warning，无 whitespace error。
- 浏览器实景：Playwright 打开 `http://localhost:3002/content/i18n`，`编辑(中英同步)` 弹窗确认有 zh/en textarea、占位符提示、审计理由和 disabled confirm；`+ 新建课程` 弹窗确认有 slug/category/format/difficulty/duration/reward/publishState/title/body 等业务字段，缺字段时 confirm disabled；console error=0。
- PR：未创建 git PR，本地工作树持续整改。
- 台账更新：`INIT-002`, `RT-007`, `RT-008`, `RT-009`, `RT-010`, `RT-011` 追加 `SPEC-L2a02-runtime` 证据；`docs/audit/LEDGER.md` 由 `ledger.ndjson` 重新生成。
