# Modal Spec: platform RBAC change role

| 字段 | 值 |
|---|---|
| 路由 | `/platform/rbac` |
| 触发动作 | `+ 新建运营账号`, `改角色` |
| 关联缺陷 | RT-012 |
| 所属 spec | `specs/SPEC-L2a03-admin-rbac-device-modals.md` |

## 操作目标

创建账号或变更账号角色。必须提供结构化角色选择, 不能要求操作者手写 `finance/lead` 这类编码。

## 必须控件

- target operator readonly, 新建时为 email/display name
- role select: super, finance, risk, growth, content, support, audit
- lead/member segmented control
- permission summary preview
- effective superadmin count preview
- audit reason textarea

## 写入 action

- `A.acct.<id>.role`
- `A.acct.<id>.tier`
- 新建时 `A.acct.<newId>.status`
- A2 audit: `admin.operator_role_changed` / `admin.operator_created`

## 成功后哪里变

账号列表角色列变化; 角色详情与权限摘要变化; 刷新后仍在。

## 失败分支

- 超管降级导致有效超管 < 2: 拒写, 显示铁律原因。
- role 未选择: disabled。
- reason 不足: disabled。

## 运行时验收

`改角色` 弹窗内必须有 role select/segmented control; `+ 新建运营账号` 必须有初始角色选择。

