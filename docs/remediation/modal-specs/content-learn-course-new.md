# Modal Spec: content learn course new

| 字段 | 值 |
|---|---|
| 路由 | `/content/i18n`, `/content/learn` |
| 触发动作 | `+ 新建课程` |
| 关联缺陷 | RT-008 |
| 所属 spec | `specs/SPEC-L2a02-admin-content-business-modals.md` |

## 操作目标

创建一条教程课程草稿, 后续可发布到 Learn/教程中心。不能只记录“新建课程”动作。

## 必须控件

- slug input
- category select
- level select
- duration input
- reward input, 带合法范围
- title.zh / title.en input
- body.zh / body.en textarea
- publish state select, 默认 draft
- audit reason textarea

## 写入 action

- `I.tutorial.<slug>.meta`
- `I.tutorial.<slug>.title.zh`
- `I.tutorial.<slug>.title.en`
- `I.tutorial.<slug>.body.zh`
- `I.tutorial.<slug>.body.en`
- A2 audit: `admin.learn_course_draft`

## 成功后哪里变

教程列表新增草稿行, 分类筛选可找到, 草稿详情显示刚填写的 title/body/reward。

## 失败分支

- slug 重复或非法: 拒写并显示原因。
- reward 超出范围: confirm disabled。
- 双语标题/正文缺失: confirm disabled。

## 运行时验收

打开 `+ 新建课程`, 填写合法字段并保存, 列表新增草稿; 刷新 `/content/learn` 后草稿仍可见。

