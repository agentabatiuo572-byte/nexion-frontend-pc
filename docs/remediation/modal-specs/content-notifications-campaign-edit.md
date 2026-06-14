# Modal Spec: content notifications campaign edit

| 字段 | 值 |
|---|---|
| 路由 | `/content/notifications` |
| 触发动作 | `编辑` |
| 关联缺陷 | RT-011 |
| 所属 spec | `specs/SPEC-L2a02-admin-content-business-modals.md` |

## 操作目标

编辑已有 notification campaign 的标题、正文、优先级、受众、排期和预算。不能只写备注。

## 必须控件

- campaign id readonly
- title input
- body textarea
- priority tier select
- audience select
- schedule datetime input
- budget input
- swipe/deep-link target input
- audit reason textarea

## 写入 action

- `I.campaign.<id>.title`
- `I.campaign.<id>.body`
- `I.campaign.<id>.tier`
- `I.campaign.<id>.audience`
- `I.campaign.<id>.schedule`
- A2 audit: `admin.notification_campaign_edited`

## 成功后哪里变

campaign 列表行的 title/audience/tier/schedule 变化; detail drawer 显示新正文。

## 失败分支

- title/body 为空: disabled。
- critical tier 未填写受众与回滚说明: disabled。
- schedule 在过去: disabled。

## 运行时验收

`编辑` 弹窗要与 `+ 新建 Campaign` 一样具备业务字段; 保存后列表行变化并 persist。

