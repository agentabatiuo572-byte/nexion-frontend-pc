# Modal Spec: content copy A/B draft edit

| 字段 | 值 |
|---|---|
| 路由 | `/content/copy-ab` |
| 触发动作 | `编辑草稿` |
| 关联缺陷 | RT-009 |
| 所属 spec | `specs/SPEC-L2a02-admin-content-business-modals.md` |

## 操作目标

编辑 A/B copy draft 的版本、文案、受众和流量配置。不能只有备注 textarea。

## 必须控件

- readonly draft id / current version
- variant id input
- headline.zh / headline.en input
- body.zh / body.en textarea
- audience select
- traffic split input, 0-100
- rollback note textarea
- audit reason textarea

## 写入 action

- `I.copyab.<draftId>.variant`
- `I.copyab.<draftId>.headline.zh/en`
- `I.copyab.<draftId>.body.zh/en`
- `I.copyab.<draftId>.audience`
- `I.copyab.<draftId>.trafficSplit`
- A2 audit: `admin.copyab_draft_saved`

## 成功后哪里变

draft 行版本号/文案摘要/受众/流量比例变化; 详情 drawer 显示新版本。

## 失败分支

- traffic split 非 0-100: disabled。
- zh/en token 不一致: disabled。
- reason 不足: disabled。

## 运行时验收

`编辑草稿` 弹窗必须至少包含 copy fields + audience + traffic split; 提交后列表行可见变化。

