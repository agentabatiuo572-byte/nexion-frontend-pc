# M 域 Owner 验收报告

## 结论

- Run ID：`pc-full-acceptance-20260728-151023`
- 范围：M1 客服总览、M2 工单台、M3 即时会话台、M4 知识库与 SLA、M5 话术与模板，共 5 个模块。
- 锁定基线：PC `91d1c2d`、后端 `a1cc2a7`、App `0e2178b`。
- 最终修复候选：PC Build ID `4QKkqEM_9AH1_6bkQWmha`（PID 21324）；后端 JAR SHA-256 `585A8B66D577667207AF81F842F7BDA1BAAD850521F78771D98064227E8E9C8A`（PID 14128）；隔离库 `nexion_acceptance_20260728_151023`。
- Owner 裁决：**M1/M2/M3/M4/M5 全部通过初审，进入非 Owner 轮换复审。**
- 初审评分：**98.7/100，通过**（门槛 >96）。
- 未关闭产品缺陷：`P0/P1/P2/P3 = 0/0/0/0`。
- 权限复审夹具 `99380/99381/99382` 按计划保留；密码和 MFA 秘钥只存放于受限证据目录。

本轮没有复用旧通过结论。五个模块均从真实登录页和可见侧栏进入，使用 Chromium 完成点击、输入、刷新、退出重登、服务端回读和跨模块链路核对。M1 `1/1`、M2/M3 加载失败关闭与 M2 主链 `2/2`、M3 最终修复轨 `1/1`、M4 `2/2`、M5 最终轨 `1/1`、权限轨 `3/3`、M 域静态合同 `62/62` 通过。主流程未使用 mock、localStorage 权威数据、直接修改 DOM 或固定睡眠。

## 模块逐项结果

| 模块 | 可见入口 | 权威数据与调用链 | 重点复验 | Owner 裁决 | 评分 |
|---|---|---|---|---:|---:|
| M1 客服总览 | `/service/overview` | `nx_support_ticket`、`nx_conversation`、`nx_support_sla_rule`、`nx_support_agent_profile` 真实聚合；与 M2/M3/M4/M5 同源 | 负载配置结果未知同键重试、刷新重登、单一子源失败隔离、M5 坐席同源 | **PASS** | 98.6 |
| M2 工单台 | `/service/tickets` | 工单、消息、状态、归档及会话来源均来自后端；关联 C/D/E 处置入口和 M3 来源链接 | 首次加载失败关闭、真实创建/回复、401/403/404/409/422、刷新重登、终态归档 | **PASS** | 98.5 |
| M3 即时会话台 | `/service/sessions` | 会话、消息、回执、转交、转工单和用户档案为服务端权威；消费 M5 已发布模板并回流 M2/M1 | 非目标接收 403、目标坐席接收、wait、结果未知同键重试、CAS、M3→M2、M2→M3、只读权限 | **PASS** | 99.0 |
| M4 知识库与 SLA | `/service/knowledge` | FAQ 与九类 SLA 全部来自 `nx_help_article`、`nx_support_sla_rule`；M1 消费同一 SLA | 首次加载失败关闭、九类完整性、FAQ 未知结果/并发 CAS、503、刷新重登、精确恢复 | **PASS** | 98.8 |
| M5 话术与模板 | `/service/scripts` | 类别、策略、话术、回复模板来自后端；发布强制依赖 I6 中英越已发布镜像，M3 只消费 published 内容 | 草稿→I6→发布→归档、结果未知同键重试、陈旧写 409、只读 403、M5→M3/M1 | **PASS** | 98.8 |

## 十步验收记录

### 1. 页面与动作盘点

- 范围真源 `lib/nav/console-nav.ts` 中 M 域共 5 个模块。
- M1：指标、坐席负载和自动均衡；M2：工单新建、回复、分派、优先级、状态、归档；M3：主动会话、回复、转交、接收、等待、退回、转工单；M4：FAQ 生命周期和九类 SLA；M5：类别、顾问策略、话术和即时回复模板生命周期。
- 所有首轮入口来自可见侧栏，没有用直达 URL 替代用户入口证据。

### 2. 页面字段到数据库的完整溯源

| 模块 | 前端/后端主链 | 权威表或配置 | 上下游 |
|---|---|---|---|
| M1 | `m1-overview.tsx` → `m-client.ts` → content 聚合接口 | `nx_support_ticket`、`nx_conversation`、`nx_support_sla_rule`、`nx_support_agent_profile`、负载配置 | M2/M3/M4/M5、A2/A4 |
| M2 | `m2-tickets.tsx` → tickets API | `nx_support_ticket`、`nx_support_ticket_message` | C/D/E 跳转、M3 来源会话、A2/A4 |
| M3 | `m3-sessions.tsx` → conversations API | `nx_conversation`、`nx_conversation_message`、`nx_conversation_message_receipt`、`nx_conversation_transfer` | M5 模板、M2 转工单、M1 计数、C 用户档案 |
| M4 | `m4-kb-sla.tsx` → knowledge API | `nx_help_article`、`nx_support_sla_rule` | M1 SLA 聚合、帮助中心、A2/A4 |
| M5 | `m5-scripts.tsx` → session-templates API | `nx_help_article` 的 `session_script/session_reply_template`、会话策略配置 | I6 多语发布门、M3 回复模板、M1 坐席 |

### 3. 真实 Chromium 点击、输入与等待

- M1 `1/1`、M2/M3 `2/2`、M3 `1/1`、M4 `2/2`、M5 `1/1`、权限轨 `3/3`。
- M3 最终候选从可见侧栏完成真实发起会话、模板回复、转交、等待、目标坐席接收、回复、刷新和转工单。
- M5 从可见侧栏完成真实策略变更并恢复、脚本/模板未知结果重试、I6 发布门、刷新重登和归档终态。
- 关键截图及 `runtime-result.json` 位于受限 M 证据目录，不上传 GitHub。

### 4. 主流程、空态、刷新、返回与退出重登

- 五模块均验证首次加载、真实数据、刷新和退出重登。
- M2 新工单回复后归档，重登仍可在归档区回读；M3 目标坐席接收和回复后刷新仍存在，转工单后从 M2 可返回来源会话。
- M5 published 脚本/模板刷新、重登后保持，归档后从 M3 模板选择器消失。
- 加载未完成、畸形或失败时不把空数组当正常空态，不暴露真实写入口。

### 5. 菜单、路由、按钮、接口、数据五层权限

- `m_readonly`、`m_no_write`：M1–M5 读取 200，页面写控件隐藏或禁用，绕过页面写接口为 403。
- `m_no_menu`：M 域侧栏入口不可见，直达路由受保护，M 域读取和写入接口均拒绝。
- 匿名接口返回 401；独立 SUPPORT 坐席只获得 M3/M5 所需权限；降级 auditor 后保持读取但所有写路径消失，绕过 UI 为 403。
- 正式 `superadmin` 未改权。

### 6. 异常、超时与失败关闭

- 覆盖 401、403、404、409、422、503、HTTP 200 畸形数据和请求已成功但响应丢失。
- M2/M3/M4 只有显式 `availability === "1"` 才开放写入口。
- M1/M3/M4/M5 对结果未知保留输入和稳定幂等键；恢复后同一载荷只产生一条业务记录。
- M4 knowledge 503 清除旧权威快照并隐藏写入口；恢复真实响应后才重新开放。

### 7. 幂等键、同键异载荷、CAS 与双运营员并发

- M1、M3、M4、M5 均验证同键同载荷重放不重复；同键异载荷或陈旧版本为 409。
- M3 7/8/200/201 字理由边界按合同返回 422/200/200/422；直接写入前逐次回读当前 CAS。
- M4 FAQ 双运营员并发只有一个写入成功，另一个因 CAS 失败；清理时重新读取最新版本。
- M5 策略陈旧写 409；脚本和模板在“服务端已成功、客户端收到 502”后用同键同载荷重试，各只生成一条。

### 8. 数据库、状态、A2/A4 与跨域核对

- M3 的会话转交、等待、接收、回复和转工单均从服务端回读；M2 工单显示来源会话，M1 计数同步变化。
- M5 发布前必须存在 I6 中英越 published 镜像；M3 只展示 M5 published 模板，归档后立即移除。
- M4 九类 SLA 均存在且唯一，M1 消费同一响应时限。
- A2 审计和 A4/outbox 对实际写操作留痕；失败的 CAS、权限和参数请求不前移业务状态。

### 9. 精确清理

- 首轮错误夹具 `99377/99378/99379` 与本轮 M3/M5 临时账号共 16 个，最终全部 `disabled + unassigned + tfa=false + sessions=0`。
- M3/M5 临时坐席共 13 个，最终 `enabled/transferable/busy = 0/0/0`；用户分配残留为 0。
- 11 条验收会话全部进入 CLOSED，active=0；M3 转工单为 RESOLVED 且 archived。
- 7 条 M3/M5 验收话术/模板全部 archived，active=0；21 条关联 I6 三语言记录全部归档，active=0。
- 对被账号降级隐藏的 3 个坐席，按 API 状态机临时恢复可见角色和启用态、停用 profile，再恢复 `disabled + unassigned`；没有直接修改数据库。
- 复审专用账号 `99380/99381/99382` 按计划保留，复审后由主智能体统一清理。

### 10. 初审评分

**98.7/100，通过。**

- 五模块真实浏览器主链与跨模块调用链：39.6/40。
- 五层权限、异常与失败关闭：29.6/30。
- 幂等、CAS、并发、审计和跨域一致性：19.7/20。
- 证据、隔离与精确清理：9.8/10。

扣分项：不可逆的生产客服动作仅在隔离夹具中执行；权限复审账号按统一计划暂未清理。两项均为验收边界，不构成产品缺陷。

## 缺陷闭环

| 编号 | 模块 | 等级 | 闭环 |
|---|---|---:|---|
| M-001 | M4 | P1 | 九类 SLA 基线、幂等迁移和首次加载失败关闭已修复；M4 `2/2` 通过 |
| M-002 | M2/M3 | P1 | availability 改为仅显式 `1` 开放写入；延迟加载与主链 `2/2` 通过 |
| M-003 | M3 | P1 | transfer decision 从错误 `OPEN` 改为权威 `TRANSFERRED` CAS；最终 Build M3 `1/1` 通过 |
| M-AUTO-001 | M4 验收载具 | P3 | 清理前重读 CAS 后 M4 `2/2`，FAQ/SLA 残留 0 |
| M-AUTO-002 | 权限/M3/M5 载具 | P3 | 使用 A1 返回的 `temporaryPassword`，夹具和独立账号链通过 |

M5 最终清理脚本还修正了一处响应形状假设：会话状态 PATCH 返回直接 `ConversationView`，不是 detail wrapper。该项属于验收载具问题；修复后使用全新账号、会话、脚本和模板从入口完整重跑 `1/1`。

## 证据索引

- 受限目录：`D:\workspace\bug-pic\.restricted\pc-full-acceptance-20260728-151023\M`
- M1：`M1-final`
- M2：`M2-final/runtime-result.json`
- M3：`M3-final/runtime-result.json`
- M4：`M4-final`
- M5：`M5-final/runtime-result.json`
- 权限夹具：`permission-fixtures.json`
- 缺陷台账：同目录上级的 `缺陷台账.md`

## 复审交接

- 非 Owner 复审须使用全新浏览器上下文，重新执行 M1–M5 可见入口、刷新、退出重登、权限篡改、结果未知、并发/CAS、失败关闭和 M5→I6→M3/M1、M3→M2→M3 链路。
- 复审账号为 `99380/99381/99382`，凭据只从受限 `permission-fixtures.json` 读取。
- 复审通过门槛 >98；完成后必须清理三账号并核对账号、会话、Redis、幂等键及临时配置残留为 0。

## 最终清理补记

- 非 Owner 复审与统一 75 模块终验完成后，主控 cleanup r4 已执行上述清理要求。
- `99377/99378/99379`、`99380/99381/99382` 及本 Run 全部隔离账号最终均为 `disabled + unassigned + tfa=false + sessions=0`。
- 活动自定义角色/角色关系、本 Run 幂等记录、Redis DB14 和待审批工单均为 0；本节取代前文“为复审保留”的中间态说明。
