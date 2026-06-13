# Modal Spec: content disclosure / trust new version

| 字段 | 值 |
|---|---|
| 路由 | `/content/disclosure`, `/content/trust` |
| 触发动作 | `草拟新版`, `发新版` |
| 关联缺陷 | RT-010 |
| 所属 spec | `specs/SPEC-L2a02-admin-content-business-modals.md` |

## 操作目标

草拟或发布一版风险披露/信任中心内容, 包含版本、辖区、语言、正文和生效策略。

## 必须控件

- current version readonly
- new version input
- jurisdiction multi-select
- language scope multi-select
- title.zh / title.en input
- body.zh / body.en textarea
- effective date/time input
- requires re-ack checkbox
- rollback plan textarea
- audit reason textarea

## 写入 action

- `I.disclosure.<jurisdiction>.version`
- `I.disclosure.<version>.body.zh/en`
- `I.trust.<section>.version`
- A2 audit: `admin.disclosure_version_drafted` / `admin.trust_version_published`

## 成功后哪里变

版本号、状态、辖区覆盖、正文摘要变化; 需要重新确认的版本显示 re-ack 标记。

## 失败分支

- version 未递增: disabled。
- jurisdiction/language/body 缺失: disabled。
- 发新版未填 rollback plan: disabled。

## 运行时验收

Source A AD-09 对 `草拟新版` / `发新版` 不得再只看到一个 text input 或 reason textarea, 必须识别 version/content/jurisdiction controls。

