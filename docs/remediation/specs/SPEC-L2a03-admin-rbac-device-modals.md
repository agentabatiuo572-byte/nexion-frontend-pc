# SPEC-L2a03-admin-rbac-device-modals

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2a 弹窗逐个细化重构 / RBAC 与设备 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | RT-012, RT-013, RT-015 |
| 关联规格卡 | `modal-specs/platform-rbac-change-role.md`, `modal-specs/platform-rbac-permission-matrix.md`, `modal-specs/devices-delete-down-reason.md` |

## 1. 背景与问题

用户明确指出“改角色”弹窗必须真的有改角色控件。运行时证据表明 `/platform/rbac` 的新建账号/改角色只有自由文本或普通输入, 改授权没有权限矩阵; `/devices/pricing` 删除、`/devices/tasks` 下架提示需要理由却没有理由输入。

## 2. 目标与非目标

目标: RBAC 与设备破坏性操作的弹窗语义完整。角色变更必须结构化选择角色/lead 层级; 授权变更必须有模块/动作矩阵; 删除/下架必须有理由字段并写入审计。

非目标: 不接真实 IAM; 不改变 A 域“有效超管不少于 2”铁律; 不重做 E 域商品卡视觉。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\a-tabs\a1-accounts.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\a-tabs\data.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\a-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\e-tabs\e1-catalog.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\e-tabs\e2-tasks.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\e-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\store\admin\platform-config-store.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\lib\store\admin\user-ops-store.ts`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-action-sample.mjs`

## 4. 方案

1. 改角色: 用 select/segmented control 选择 role key, toggle/checkbox 选择 lead/member, 实时显示影响权限摘要; 禁止自由输入 role 字符串。
2. 新建运营账号: 表单包含 display name、email、初始角色、lead/member、默认零写权说明; 提交前走操作确认。
3. 改授权: 使用权限矩阵, 行为是 module/action x role 的 grant cell 切换; 保存前展示 diff。
4. 设备删除/任务下架: 弹窗必须包含必填 reason textarea、影响面提示、confirm disabled reason; 提交后对应列表项状态变化并写审计。
5. 保留超管数量守门, UI 预判与提交阶段都要拒绝破坏铁律。

## 5. 同形全站扫描范围

- `rg -n "改角色|新建运营账号|改授权|role\\[/lead\\]|A\\.rbac|权限矩阵" D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\a-tabs`
- `rg -n "删除|下架|操作理由|delSku|delTask|reason" D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\e-tabs`
- 全站扫自由文本角色输入: `rg -n "role key|目标新值栏填新角色|kind:\\s*\"text\".*role" D:\WORKS\PLAN\Nexion-admin-prototype\app`

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build` 通过。
2. `node scripts\remediation-runtime-action-sample.mjs AD-02` 后 RT-012/RT-013 不再为 `business-incomplete-modal`。
3. `node scripts\remediation-runtime-action-sample.mjs AD-05` 后 RT-015 不再为 `business-incomplete-modal`。
4. 改角色任务: 选择 finance/lead, 填理由, 确认后目标账号角色列变化, 刷新仍在, A2 audit 有记录。
5. 改授权任务: 勾选/取消一个权限 cell, diff 可见, 提交后矩阵 cell 状态变化并 persist。
6. 删除/下架任务: reason 少于门槛 confirm disabled 且显示原因; 合法 reason 后提交, 列表项删除/下架状态可见。

## 7. 拟新增哨兵

- `admin-modal-contract-audit.mjs` 对 role/permission/destructive semantic 加 required controls。
- AD-02/AD-05 runtime action sample 纳入 PR gate。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `node scripts/admin-rbac-device-modal-proof.mjs` PASS: `change-role-persists`, `permission-matrix-diff-persists`, `sku-delete-reason-persists`, `task-down-reason-persists`.
  - `node scripts/remediation-runtime-action-sample.mjs AD-02` PASS: `samples=26`, `errors=0`, `noObservableChange=0`, `businessIncompleteModal=0`.
  - `node scripts/remediation-runtime-action-sample.mjs AD-05` PASS: `samples=6`, `errors=0`, `noObservableChange=0`, `businessIncompleteModal=0`.
  - `npm run build` PASS; `npm run verify` PASS: `143 checks, 0 failed`.
  - In-app Browser `/platform/rbac`: role-select modal has role/tier controls and disabled reason gate; permission modal has 7 grant controls, no-diff disabled, `客服:-→R` diff preview, confirm enabled after reason; console errors 0.
- 同形扫描结果：
  - `node scripts/admin-modal-contract-audit.mjs` PASS: role-select / permission-matrix / destructive-reason controls present; role/permission free-text regressions forbidden.
  - `rg -n "role key|目标新值栏填新角色|kind:\\s*\"text\".*role" app` no free-text role edit regression in active implementation.
- 哨兵：
  - `scripts/admin-modal-contract-audit.mjs` now requires permission no-diff guard and `permission-diff-preview`.
  - `scripts/verify.sh` now runs `admin-modal-contract-audit.mjs` as the business modal contract gate.
  - `scripts/admin-rbac-device-modal-proof.mjs` records runtime proof into `docs/audit/shards/ad-02-ad-05-rbac-device-action-sample.ndjson`.
- PR：
  - 当前为本地整改任务，未创建 PR。
- 台账更新：
  - `RT-012`, `RT-013`, `RT-015` retain `verified` status with L2a03 domain-level runtime evidence appended.
  - Evidence summary: `docs/audit/admin-rbac-device-modal-runtime-evidence.md`.
