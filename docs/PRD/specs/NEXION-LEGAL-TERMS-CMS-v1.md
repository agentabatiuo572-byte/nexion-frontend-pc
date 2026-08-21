# NEXION Legal Terms CMS v1

## 权威边界

Terms 是独立于 I5 风险披露的法律条款能力。后端 `nx_legal_terms_version` 保存每个 `locale + jurisdiction + version` 的结构化段落、状态、revision 和生效时间；正文由字段组成，运营端不得提交整段 JSON。`nx_legal_terms_ack` 保存用户、环境、Sandbox RunID、法域、语言和已确认版本。

## 状态与并发

版本状态为 `DRAFT → PUBLISHED → SUPERSEDED` 或 `PUBLISHED → REVOKED`。草稿保存、发布和撤回都携带 expected revision；过期 revision 返回 `LEGAL_TERMS_VERSION_CONFLICT`。发布新版本后，服务端读取只返回该语言/法域的当前 `PUBLISHED` 版本，旧确认不会满足新版本。

## 读取与回退

App 使用 `GET /api/legal/terms/current?locale=&jurisdiction=`。回退顺序是请求 Locale 精确值、基础语言、`en`，并在每一层先尝试请求法域，再尝试 `GLOBAL`；响应返回 resolved 字段和 `provenance`。响应必须声明 `source=server` 及 `PRODUCTION`/`SANDBOX` 环境，生产环境不得携带 RunID。无发布版本、结构非法、环境不一致或读取失败均失败关闭。

## 确认

App 使用 `POST /api/legal/terms/acknowledgment`，提交当前 resolved locale、jurisdiction、version、确认标记、幂等键和当前 Sandbox RunID。服务端重新读取当前发布版本后再写入，重复请求幂等；用户、环境、RunID、版本不匹配时拒绝。确认写入必有审计记录。

## 权限与撤回

PC 读取、草稿写入、发布/撤回分别受 `content_legal_terms_read`、`content_legal_terms_write`、`content_legal_terms_publish` 保护，并通过内容角色/超管授权。撤回后没有其他有效发布版本时，App 继续失败关闭，不回退静态 i18n 或风险披露内容。

## 当前验证边界

首次真实复跑记录在 `D:\workspace\bug-pic\seven-closures-20260817\initial\terms\rerun`：PC 最小草稿因 ISO `T` 分隔时间不符合后端 Jackson 的空格分隔 `LocalDateTime` 契约而返回 `REQUEST_BODY_INVALID`；已在 PC client/editor 修复并新增 2 项合同测试。当前 PC `npm run build` 与合同测试通过；App ack 已明确使用认证请求，未登录确认安全回跳登录，Me 提供稳定 Terms 入口，登录完成/会话恢复检查以账号、Bearer 和 Terms RunID/版本栅栏保护；App Terms/API/导航与会话栅栏定向 Vitest 9 项、`npm run build:h5` 通过。App 全量 `npm run type-check` 当前被工作树既有 `node:fs`/`__dirname` 测试类型、`voucher-popup-scheduler.ts` 与 `behavior-analytics.ts` 错误阻断；Backend 当前 testCompile 被既有 `AppProofServiceTest` 构造器不匹配阻断。真实 publish/ack/re-ack/fallback/revoke 链路需在重启到包含本修复的健康后端与 App 后复验，当前不宣称端到端通过。
