# Modal Spec: platform RBAC permission matrix

| 字段 | 值 |
|---|---|
| 路由 | `/platform/rbac` |
| 触发动作 | `改授权` |
| 关联缺陷 | RT-013 |
| 所属 spec | `specs/SPEC-L2a03-admin-rbac-device-modals.md` |

## 操作目标

修改角色对模块/动作的授权矩阵。不能通过自由文本编码权限字符串。

## 必须控件

- role readonly/select
- module/action matrix
- grant cell controls: none/read/write/approve 或等价层级
- diff preview: before -> after
- risk warning for write/approve escalation
- audit reason textarea

## 写入 action

- `A.rbac.<role>.<actionId>`
- A2 audit: `admin.rbac_permission_changed`

## 成功后哪里变

RBAC 矩阵 cell 状态变化; 角色详情权限摘要变化; 刷新后仍在。

## 失败分支

- 没有任何 diff: confirm disabled。
- 越权组合: 拒写并显示 server 同步校验理由。
- reason 不足: disabled。

## 运行时验收

AD-02 action sample 对 `改授权` 必须识别 matrix/checkbox/select 控件, 不再只有一个 text input。

