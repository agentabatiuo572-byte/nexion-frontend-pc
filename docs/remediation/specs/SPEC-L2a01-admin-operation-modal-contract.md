# SPEC-L2a01-admin-operation-modal-contract

| 字段 | 值 |
|---|---|
| 状态 | verified |
| 层/工作流 | L2a 弹窗逐个细化重构 / 全局契约 |
| 端 | admin |
| 模型层级 | spec=T0; 实现=T1 |
| 关联缺陷 id | INIT-002, RT-007, RT-008, RT-009, RT-010, RT-011, RT-012, RT-013, RT-015 |
| 关联规格卡 | `modal-specs/content-i18n-edit-repair.md`, `modal-specs/content-learn-course-new.md`, `modal-specs/content-copy-ab-draft-edit.md`, `modal-specs/content-disclosure-trust-new-version.md`, `modal-specs/content-notifications-campaign-edit.md`, `modal-specs/platform-rbac-change-role.md`, `modal-specs/platform-rbac-permission-matrix.md`, `modal-specs/devices-delete-down-reason.md` |

## 1. 背景与问题

后台 Source A 已确认 16 个 `business-incomplete-modal`: 弹窗会打开, 但弹窗内控件与按钮业务语义不匹配。典型问题是编辑/新建/改角色/改授权等业务动作仍落到通用 OperationConfirmModal 的理由框或自由文本输入, 导致“看起来有弹窗, 实际没法完成业务”。

## 2. 目标与非目标

目标: 建立全局弹窗契约, 让每个高敏确认壳只负责确认与审计, 业务表单体必须由调用方显式提供并可机器检查。按钮语义与弹窗控件必须一致: “改角色”有角色选择器, “编辑文案”有 zh/en 字段, “新建课程”有课程字段。

非目标: 不一次性重做所有后台视觉; 不把合理只读详情 drawer 改成可编辑; 不取消高敏操作确认。

## 3. 改动文件面声明

- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\design-kit.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\modal-contracts.tsx` (新建或等价落点)
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\i-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\a-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views\e-view.tsx`
- `D:\WORKS\PLAN\Nexion-admin-prototype\scripts\remediation-runtime-action-sample.mjs`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\remediation\modal-specs\*.md`

## 4. 方案

1. `OperationConfirmModal` 保留为确认外壳: reason、coverage/risk warning、confirm disabled reason、audit copy。
2. 新增显式业务表单契约, 至少支持 `copy-edit`, `course-authoring`, `campaign-edit`, `version-authoring`, `role-select`, `permission-matrix`, `destructive-reason`。
3. 禁止再用动作名正则猜测控件; 调用点必须传 `businessForm` 或显式 `readonlyReason`。
4. Confirm disabled 原因必须可见: reason 不足、必填字段缺失、权限不足、覆盖率红线等均显示具体原因。
5. 运行时 action sampler 的 businessAssessment 从“有弹窗”升级为“对应业务控件存在 + 合法填写后可提交 + 提交后目标状态变化”。

## 5. 同形全站扫描范围

- `rg -n "OperationConfirmModal|openActionConfirm|openConfirm\\(|KConfirmModal|ViewParamModal" D:\WORKS\PLAN\Nexion-admin-prototype\app`
- `rg -n "edit:\\s*\\{|kind:\\s*\"text\"|目标新值|备注\\(可选|可补充处置依据" D:\WORKS\PLAN\Nexion-admin-prototype\app\components\domain-views`
- 所有 `business-incomplete-modal` 证据中的 actionText 必须回扫。

## 6. 验收断言（机器可测）

1. `cd D:\WORKS\PLAN\Nexion-admin-prototype; npm run build` 通过。
2. `node scripts\remediation-runtime-action-sample.mjs AD-02`, `AD-05`, `AD-09` 后对应 RT-007~RT-013/RT-015 样本不再出现 `business-incomplete-modal`。
3. 对每类业务表单至少 1 个 Playwright 任务断言: 填合法字段, confirm 从 disabled 变 enabled, 提交后 store/audit/列表状态变化, 刷新后仍在。
4. `rg` 不得命中新建/编辑/改角色/改授权调用点只传 reason/free-text 而无业务表单规格。

## 7. 拟新增哨兵

- `remediation-runtime-action-sample.mjs` 增加 modal semantic gate: action semantic -> required controls map。
- 新增 `scripts/admin-modal-contract-audit.mjs`: 静态扫所有 OperationConfirmModal 调用, 无 `businessForm` / `readonlyReason` / 纯确认白名单则失败。

---

## 完成回执（实现完成时回填）

- 验证证据：
  - `npx --no-install tsc --noEmit` PASS。
  - `npm run build` PASS。
  - `npm run verify` PASS: 136 checks, 0 failed。
  - `node scripts\remediation-runtime-action-sample.mjs AD-02` PASS: samples=26, errors=0, noObservableChange=0, businessIncompleteModal=0。
  - `node scripts\remediation-runtime-action-sample.mjs AD-05` PASS: samples=6, errors=0, noObservableChange=0, businessIncompleteModal=0。
  - `node scripts\remediation-runtime-action-sample.mjs AD-09` PASS: samples=41, errors=0, noObservableChange=0, businessIncompleteModal=0。
  - `node scripts\admin-modal-contract-proof.mjs` PASS: `role-select`, `permission-matrix`, `copy-edit`, `campaign-edit`, `course-authoring`, `version-authoring`, `destructive-reason` 7/7 运行时证明通过；均验证 confirm enabled、提交写 store/audit 或列表、刷新仍在。
  - `node scripts\admin-modal-contract-audit.mjs` PASS: required=7, forbidden=9。
  - `node scripts\ledger-validate.mjs` PASS: 36 entries。
- 同形扫描结果：
  - A1 `改角色` 已从 free-text `edit` 改为 `role-select`。
  - A1 `改授权` 已从 free-text grant 串改为 `permission-matrix`。
  - I1/I3/I4/I6 的草稿编辑/课程新建/披露新版均改为业务表单并写结构化 params。
  - E1 SKU 删除、E2 任务下架已从普通 `confirm()` 改为 `destructive-reason` 操作确认。
- 哨兵：
  - `scripts/admin-modal-contract-proof.mjs` 新增七类业务表单运行时证明。
  - `scripts/admin-modal-contract-audit.mjs` 新增静态回归哨兵。
  - `scripts/remediation-runtime-action-sample.mjs` 修正 semantic gate，避免 i18n 文案编辑被课程字段误判，同时保持业务控件检查。
  - `scripts/no-double-sign-terms.mjs` 跳过截图/trace 二进制证据目录，避免 WSL verify 扫图 EIO。
- PR：本地工作区未创建 PR。
- 台账更新：`INIT-002`, `RT-007`, `RT-008`, `RT-009`, `RT-010`, `RT-011`, `RT-012`, `RT-013`, `RT-015` 已更新为 `verified`；`docs/audit/LEDGER.md` 已重建；`docs/audit/task-walkthrough-matrix.md` 已更新后台 AT-001~AT-007/AT-009 状态。
