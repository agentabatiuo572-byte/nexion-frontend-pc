# Modal Spec: content i18n edit / repair

| 字段 | 值 |
|---|---|
| 路由 | `/content/i18n`, `/content/learn` |
| 触发动作 | `编辑(中英同步)`, `修复` |
| 关联缺陷 | INIT-002, RT-007 |
| 所属 spec | `specs/SPEC-L2a01-admin-operation-modal-contract.md`, `specs/SPEC-L2a02-admin-content-business-modals.md` |

## 操作目标

编辑或修复一个用户可见 i18n key 的中英文文案, 并保存草稿/修复状态。不能只填写备注或操作理由。

## 必须控件

- readonly key path, namespace, current status
- `zh` textarea
- `en` textarea
- placeholder/token 校验区, 显示 zh/en token diff
- preview 区, 至少展示 App 端一处使用位置
- audit reason textarea, 8 字以上

## 写入 action

- `I.i18n.<key>.zh`
- `I.i18n.<key>.en`
- `I.i18n.<key>.status`
- A2 audit: `admin.i18n_copy_saved` / `admin.i18n_integrity_fix`

## 成功后哪里变

列表行的状态、更新时间、预览文案变化; integrity 计数根据修复项扣减; 刷新后仍在。

## 失败分支

- zh/en 任一为空: confirm disabled, 显示缺失字段。
- placeholder 不一致: confirm disabled, 显示 token diff。
- reason 不足: confirm disabled, 显示还需字数。

## 运行时验收

`node scripts\remediation-runtime-action-sample.mjs AD-09` 中 `编辑(中英同步)` / `修复` 的 dialog controls 必须包含 zh/en textarea, 且合法填写后提交能观察到列表变化。

