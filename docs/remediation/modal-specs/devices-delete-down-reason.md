# Modal Spec: devices delete / down reason

| 字段 | 值 |
|---|---|
| 路由 | `/devices/pricing`, `/devices/tasks` |
| 触发动作 | `删除`, `下架` |
| 关联缺陷 | RT-015 |
| 所属 spec | `specs/SPEC-L2a03-admin-rbac-device-modals.md` |

## 操作目标

执行设备 SKU 删除或任务下架这类破坏性动作, 必须填写操作理由并写审计。

## 必须控件

- target readonly: SKU/task id/name
- impact summary: affected frontend route / active orders / visible users
- reason textarea, 8 字以上
- optional rollback note textarea
- confirm checkbox: understand impact

## 写入 action

- SKU: `E.sku.<id>.status=deleted/off`
- Task: `E.task.<id>.status=down`
- A2 audit: `admin.device_sku_deleted` / `admin.device_task_down`

## 成功后哪里变

SKU 或 task 列表项消失/变下架; 统计计数变化; 刷新后仍在。

## 失败分支

- reason 不足: confirm disabled。
- 未勾选 impact acknowledgement: disabled。
- 存在 active dependency: 拒写或要求转为下架而非删除。

## 运行时验收

AD-05 action sample 对 `删除` / `下架` 必须看到 reason textarea; 填合法 reason 后提交产生列表状态变化。

