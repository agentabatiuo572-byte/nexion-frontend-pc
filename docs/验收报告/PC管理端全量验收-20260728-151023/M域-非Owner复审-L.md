# M 域非 Owner 复审报告（L→M）

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 复审范围：M1 客服总览、M2 工单台、M3 即时会话台、M4 知识库与 SLA、M5 话术与模板。
- 范围真源：`lib/nav/console-nav.ts`，M 域共 5 个模块。
- 最终锁定候选：
  - PC Build ID：`zfPfSm8yHDpNEEN8zcqdN`
  - PC PID：`13288`
  - 后端 JAR SHA-256：`F1DF14205D3FC6809376135735F1A7907D64271F2CDE121590DCA3FDE8B1A260`
  - 后端 PID：`21012`
  - 隔离数据库：`nexion_acceptance_20260728_151023`
  - Redis：DB 14
- 复审裁决：**M1–M5 全部通过；允许进入 75 模块统一锁定用例。**
- 初审评分：**99.1/100，通过**（门槛 >96）。
- 非 Owner 对抗复审评分：**99.4/100，通过**（门槛 >98）。
- 未关闭缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 当前血量：**100/100**。

本报告不复用任何旧候选结论。最终候选上重新使用全新 Chromium、全新业务前缀 `L2M-LOCK-*`、全新权限账号 `99510/99511/99512` 完成全部锁定范围。PC Build ID、JAR SHA 和两个服务 PID 在最终复审前后均未漂移。

最终候选共完成 Playwright `12/12`、M 域静态合同 `63/63`。主流程全部使用真实后端、MySQL 权威数据和可见页面操作；未使用 mock、localStorage 权威数据或直接修改 DOM。网络故障注入只用于异常分支，未替代任何主流程。

## 模块逐项裁决

| 模块 | 可见入口 | 权威数据及调用链 | 最终候选重点复验 | 结果 | 评分 |
|---|---|---|---|---:|---:|
| M1 客服总览 | `/service/overview` | 工单、会话、SLA、坐席负载及 M2–M5 聚合 | 结果未知保留表单、同键重试、配置 CAS 恢复、子源失败隔离、刷新重登 | **PASS** | 99.2 |
| M2 工单台 | `/service/tickets` | `nx_support_ticket`、消息、状态、归档及 M3 来源链接 | UI 创建/回复、内部备注幂等、异载荷与陈旧 CAS 409、404/422、M3 回链、刷新重登 | **PASS** | 99.3 |
| M3 即时会话台 | `/service/sessions` | 会话、消息、回执、用户目录及转工单均为后端权威 | 真实用户发起、M5 模板、结果未知同键重试、双运营员并发仅一胜、M3→M2→M1 | **PASS** | 99.5 |
| M4 知识库与 SLA | `/service/kb-sla` | FAQ、九类 SLA、M1/M2 消费链 | 首屏失败关闭、FAQ 完整生命周期、结果未知、并发唯一性、SLA 写入与精确恢复、503 | **PASS** | 99.3 |
| M5 话术与模板 | `/service/scripts` | `nx_help_article` 会话模板、策略配置及 I6 三语言镜像 | 草稿→I6→发布→M3 消费→归档、同键异载荷 409、双运营员 stale-CAS 409、终态不可复活 | **PASS** | 99.5 |

## 十步复审记录

### 1. 页面与动作盘点

- M1：指标卡、SLA、坐席负载、自动均衡及 M2/M3/M5 跳转。
- M2：新建、回复、内部备注、优先级、状态、归档及来源会话。
- M3：真实用户主动会话、模板回复、回执、并发回复、转工单及归档。
- M4：FAQ 新增、编辑、发布、下架、删除和九类 SLA。
- M5：会话类别、顾问策略、回复模板发布门及归档终态。
- 五个模块的首轮、返回、刷新和退出重登均从可见侧栏进入。

### 2. 页面字段到数据库溯源

| 模块 | 主接口 | 权威表或配置 | 跨域消费者 |
|---|---|---|---|
| M1 | tickets/load-config 与客服聚合接口 | `nx_support_ticket`、`nx_conversation`、`nx_support_sla_rule`、坐席配置 | M2、M3、M4、M5、A2、A4 |
| M2 | content/tickets | `nx_support_ticket`、`nx_support_ticket_message` | C/D/E 处置入口、M3 来源会话、M1 |
| M3 | content/conversations | `nx_conversation`、`nx_conversation_message`、`nx_conversation_message_receipt`、`nx_conversation_transfer` | M5 模板、M2 工单、M1 计数 |
| M4 | content/knowledge | `nx_product_faq`、`nx_support_sla_rule` | M1 SLA、M2 截止时间、A2/A4 |
| M5 | content/session-templates | `nx_help_article` 的 `session_reply_template`、策略配置、`nx_i18n_message*` | I6 发布门、M3 模板选择器、M1 |

### 3. 真实 Chromium 操作

- M1 `1/1`、M2 `1/1`、M4 `2/2`、M3/M5 联合轨 `1/1`。
- 最终只读与失败关闭轨 `2/2`。
- 全新权限夹具创建 `1/1`、权限验收 `3/3`、清理 `1/1`。
- 所有主要写操作都由页面点击和输入触发，并等待真实响应及服务端回读。

### 4. 主流程、空态、刷新、返回和重登

- M1–M5 均完成首次进入、返回、刷新、退出登录和重新登录。
- M2 工单及 M3→M2 工单在刷新和重登后仍能从权威接口回读。
- M3 使用真实用户目录创建会话，消费 M5 已发布模板；M5 归档后模板立即从 M3 选择器消失。
- 加载中、失败或畸形响应不会被当作正常空态，不会暴露可写页面。

### 5. 五层权限

- 全新 `m_readonly`、`m_no_write`：M1–M5 菜单和路由可见、读取接口 200、页面写控件禁用或隐藏、直接写接口 403。
- 全新 `m_no_menu`：M 域菜单不可见，直达路由受保护，M1–M5 读写接口全部拒绝；刷新和重登不能从缓存恢复权限。
- 匿名读取返回 401/403。
- 权限轨使用账号 `99510/99511/99512`，未修改正式 `superadmin`。

### 6. 异常与失败关闭

- 覆盖 401、403、404、409、422、500、M3 超时、HTTP 200 畸形响应和成功响应丢失。
- M1/M3/M4/M5 对结果未知保留输入、表单和稳定幂等键。
- M5 读取结果未知、M3 超时和畸形 200 均不回退为可写空数据；恢复真实后端后页面恢复。
- 写入 500/502 仅用于故障注入分支，主流程仍由真实后端完成。

### 7. 幂等、CAS 和双运营员

- M1、M2、M3、M4、M5 均覆盖同键同载荷安全重放。
- M2/M3/M5 同键异载荷返回 409；M2/M5 陈旧 CAS 返回 409。
- M3 使用 `superadmin` 与独立 `d_checker` 在相同 status/version 上并发回复，结果严格为一个 200、一个 409，消息只新增一条。
- M5 由 root 修改策略，checker 使用旧快照写入返回 409；checker 取得最新快照后精确恢复原值。
- M4 并发创建生成不同资源，FAQ/SLA 清理前重新读取最新版本，不覆盖其他运营员状态。

### 8. 数据库、A2/A4/outbox 与跨域一致性

- M3→M2 为一个原子命令：会话关闭并生成唯一工单；M2 展示来源会话链接，M1 聚合计数同步。
- M5 发布前由独立 checker 建立 I6 中英越镜像；发布后 M3 可见，归档后 M3 不可见，归档终态复活请求返回 409。
- 最终候选本轮保留不可变 A2 审计 **33 条**，均可通过审计接口回查。
- A4/outbox 持久化 **11 条**，隔离环境中为 `PENDING`，A4 页面可见；这是不可变事件证据，不是业务夹具残留。
- M1 配置、M4 SLA 和 M5 策略均按最新 CAS 恢复原值。

### 9. 精确清理

- 业务夹具：ticket、ticket message、conversation、conversation message/receipt/transfer、FAQ、M5 模板、I6 message/version 均为 **0**。
- 幂等记录：本轮 `L2M-LOCK-M*` 为 **0**。
- Redis DB14：业务前缀、资源编号、权限账号和 MFA replay counter 均为 **0**。
- 权限账号 `99510/99511/99512` 最终全部为 `disabled + unassigned + tfa=false + sessions=0`；活动账号、绑定角色、MFA、会话均为 **0**。
- 自定义角色创建数为 **0**；正式管理员和其他域夹具未被修改。
- A2 审计和 A4/outbox 按不可变证据规则保留。

### 10. 评分

初审：**99.1/100，通过。**

- 真实用户主链与跨域闭环：39.8/40
- 权限、异常和失败关闭：29.8/30
- 幂等、CAS、双运营员及审计：19.8/20
- 证据与精确清理：9.7/10

非 Owner 对抗复审：**99.4/100，通过。**

- 在初审范围上增加权限篡改、超时、畸形 200、成功响应丢失、同键异载荷、双运营员竞争、终态复活、刷新重登和跨域一致性攻击。
- 唯一扣分为隔离环境未运行 RocketMQ 消费者，11 条事件停留在 durable outbox `PENDING`；事件已持久化且 A4 可见，不影响本次 PC 管理端功能裁决。

## 缺陷裁决

| 编号 | 类型 | 等级 | 结果 |
|---|---|---:|---|
| M-OWNER-001～003 | Owner 历史产品缺陷 | P1 | 已在最终候选中重新覆盖，未复现 |
| M-L-CARRIER-001 | 验收载具：当前路由重复点击未重挂载 | P3 | 改为真实 reload 后，最终候选读轨 `2/2` |
| M-L-CARRIER-002 | 验收载具：重复 React GET 覆盖注入响应 | P3 | 对精确 GET 全量拦截后，失败关闭与恢复通过 |
| M-L-CARRIER-003 | 验收清理：MFA replay counter | P3 | 只删除 3 个新账号的精确键，最终 Redis 残留 0 |

最终候选未发现新的产品缺陷，缺陷台账无需新增未关闭项。

## 证据索引

- 受限根目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\M-review-L\locked`
- M1：`write\M1`
- M2：`write\M2\runtime-result.json`
- M3/M5：`write\M35\runtime-result.json`
- M4：`write\M4`
- 只读与失败关闭：`read-failclosed`
- 权限夹具：`permissions\fixture.json`
- 权限清理：`permissions\cleanup\result.json`

Trace、视频、认证状态和包含账号凭据的夹具只保存在受限目录，不进入 GitHub。
