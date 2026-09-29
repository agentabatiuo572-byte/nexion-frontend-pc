# 源码基线与需求映射

本轮只读源码核对，不代表运行验证。规则/功能权威是 [OWNER-DECISIONS.md](OWNER-DECISIONS.md)，而不是下述现状行为。

| 仓 | 只读基线 | 读取方式 |
|---|---|---|
| 后台 | `0f54a406404a7d0ced9d629566a27586076771b6` | 本工作树 `D:/WORKS/PLAN/.wt/cs-spec-20260929-admin`，分支`codex/cs-spec-20260929` |
| 后端 | `cc5d96f928c82f081ce0d1e62c9874486634187a` | `git -C D:/WORKS/PLAN/nexion-backend show <SHA>:<path>`；本地test较旧，不能读工作树冒充最新 |
| 客户端 | `710e9eecfeefee36014c779ca699ec8fcc66fd87` | `D:/WORKS/PLAN/Nexion-uniapp` main；客服相关文件只读，无关WIP不动 |

## 后台链路

| 文件 / 方法 | 已核实事实 | 目标影响 |
|---|---|---|
| `lib/nav/console-nav.ts` M域；`app/components/shell/console-shell.tsx` SUPPORT_HOME_PATH | `/service/overview,tickets,sessions,kb-sla,scripts`；support登录根页转overview | 保留入口，overview改本人工作台，主管管理和超管规则权限分开 |
| `app/components/domain-views/m-view.tsx` MDomainView | fetchMContentData、会话SSE、持续接待dock、sessionStorage命令恢复 | 全部同样执行归属撤权与状态恢复 |
| `lib/admin/m-client.ts` apiRequest、mContentActions | 代理前缀`/api/admin/content`；M1/M5绑定、seat-assignment、普通转接、主动发信、工单回复路径齐全 | 收敛所有写入口；新增body与响应严格验证，不能信名字反推adminId |
| `app/components/domain-views/m-tabs/m1-overview.tsx`、`m5-scripts.tsx` | 两处绑定/坐席操作 | 不允许一处换新契约另一处绕行 |
| `app/components/domain-views/m-tabs/m3-sessions.tsx`、`m3-modals.tsx` | 旧队列/备勤/坐席转接交互 | 人工服务线退役为正式转绑提示 |
| `app/api/admin/content/[...path]/route.ts` proxy | cookie认证、allowlist、sandbox拒绝；request.text()/upstream.text() | 图片需要保持认证的二进制路径，不能文字代理原样转图 |
| `package.json` | `verify`、`test:m2-contract`…`test:m5-contract`、`verify:m-domain-config`、`test:e2e` | 命令存在但尚未验证新功能；后续全量verify不可由spec-lint替代 |

## 后端链路（路径均相对仓根）

Java目录前缀 `src/main/java/ffdd/opsconsole/`。以下符号是稳定回源锚点，行号可由固定SHA读取，不拿本地旧文件定位。

| 路径 / 符号 | 已核实事实 | 目标影响 |
|---|---|---|
| `content/mapper/SupportAgentMapper.java` createAssignmentTable/addActiveUserUniqueIndex | ACTIVE生成列唯一索引已存在；没有段、深度、维护字段 | 扩现有模型，保留唯一约束；不新造第二绑定真源 |
| 同文件 deactivateDuplicateActiveAssignments；`content/infrastructure/MybatisSupportAgentRepository.java` ensureSchema | 按更新时间保一条，其余自动INACTIVE；read overview可能触发 | 迁移先只读预检、保留重复样本；不得先触发自修再报无冲突 |
| `content/application/OpsSupportAgentService.java` assignAdvisorUser(s)、routeAdvisorForUser | 批量100/幂等已有；主管为SUPPORT+MANAGER，不能给自己分配；路由跳过busy后回退 | 保留单请求安全界限；同目标no-op；资格和工作量分离 |
| `content/mapper/SupportAgentMapper.java` findActiveDedicatedAdvisor | UNION其他顾问；busy/transferable过滤，绑定数与max_concurrent混用 | 严格本人绑定，没绑定只能留言待分配 |
| `auth/application/AppUserRegistrationService.java` 注册事务 | sponsor_user_id/code、团队投影、钱包/会话、referral.bound；无客服继承 | 同事务补归属/池；团队7层不是客服L |
| `content/application/AppSupportService.java` start/replyConversation | authenticated userId校验、版本与幂等已有；advisor路由会回退 | 保留本人隔离与恢复，两个人工入口统一专属规则 |
| `content/application/OpsConversationService.java` page/detail/reply/transfer/initiate | 后台缺当前客户归属门；转接只改会话；30分钟可回落备勤 | 所有后台读写对象授权；退役人工自动回退 |
| `content/realtime/ConversationSocketAccess.java` Participants.canRead；`ConversationAdminReadService.java` | ADMIN仅M3 read；已读也未查归属 | WebSocket/已读同样撤权 |
| `content/web/OpsConversationStreamController.java` onConversationMessage | 对registry所有坐席emitter发包含正文的event | 发布前按当前归属/审阅权限过滤，撤权立即生效 |
| `content/infrastructure/MybatisConversationRepository.java` replyAndReturnMessageId/create | 后台回复senderId=null；主动开场agent消息senderId为客户id | 历史保留且作者可信度未知；新消息实际顾问id服务端写 |
| `content/domain/ContentConversationMessageView.java`；相关start/reply DTO | 纯content文字，现有长度2000；没有附件字段 | TEXT/IMAGE判别，保留文字2000限制，私有附件独立 |
| `shared/security/JwtAuthenticationFilter.java` touch；`shared/security/mapper/AuthSessionMapper.java` touchActiveUserSession | 每个认证请求可更新last_active_at；SQL使用UTC+8表达 | 不作有效活跃；新事件存UTC，转换既有LocalDateTime须明确来源时区 |
| `bi/application/BehaviorAnalyticsService.java` ingest | 身份/环境/路由/时间/去重，page/click/store事件；采样会丢事实 | 不直接当完整客户活跃投影；不要借采样BI冒充全量 |
| `bi/mapper/BehaviorAnalyticsMapper.java` | 事实仅actor_hash，无userId | 新投影必须可追溯客户，不能凭昵称/hash猜绑定 |
| `growth/application/AppGrowthEngagementService.java` daily.checkin等 | 服务端真实签到/领取等事务事实存在 | 可作为后续白名单候选，接入前列实际源与反例；本期不是所有事件自动有效 |
| `platform/application/OpsAdminAccountService.java` updateStatus | 超管停用+撤session+审计，无客服交接 | 不扩主管停用权限；禁止停用后路由回退 |
| `media/web/OpsMediaController.java` | 现有媒体上传属于设备E1权限 | 私聊不能为了复用给客服E1权限/公开素材URL |
| `content/application/OpsSessionTemplateService.java` advisor-policy | delay/cooldown/maxPerSession，不是D/M/W/L；自动推送执行不可用 | 不拿旧话术数字当本期规则，不发明营销 |

主要控制器：`content/web/{OpsSupportAgentController,OpsSupportWorkbenchController,OpsConversationController,AppSupportController,OpsSessionTemplateController}.java`。后台会话status/archive现有为PATCH；transfer及其accept/return/wait为POST；ticket replies与conversation replies为POST。API目标详细表见CONTRACTS C5。

## 客户端链路

| 文件 / 方法 | 已核实事实 | 目标影响 |
|---|---|---|
| `src/api/support-api.ts` createSupportApi/parseConversationMessage | 生产`/api/app/support`；TEXT必须非空；命令结果回查/分页已有 | 扩IMAGE、归属等待/不可服务，保留严格校验与回查 |
| `src/domain/support.ts` ConvMessage/Conversation | 纯text/ts/status，advisor/support/ai分型 | 人工消息扩字段，AI不改业务 |
| `src/store/conversations.ts` command/sendUser/startConversation | 按账号隔离pending、刷新回查、同意图key、版本保护 | 图片沿用隔离/幂等；登出转号清缓存，不能缩成乐观toast |
| `src/pages/support/chat.vue`、`messages.vue`；`components/support/conversation-thread.vue` | 人工入口/关闭后重开/已读和文字线程 | 双入口专属规则、图片、窄屏、失败恢复；APP/H5及现有语言覆盖 |
| `src/pages/me/support.vue`、`support-tickets.vue` | 求助和工单入口 | 保留；对客权限变化仅必要适配，不重做无关页面 |

## 需求覆盖与去重

| 原始来源 | 功能 | 契约 / 验收 | 负责阶段 |
|---|---|---|---|
| 原始目标1/2、六指标 | M01/M05 | C4.3 / AC01、AC08、AC13 | S4/S5 |
| 原始目标3/4、R02/R03/R04 | M02/M03 | C2/C3/C5 / AC02–AC06 | S3/S5/S6 |
| R01、图片边界 | M03/M06 | C5 / AC09、AC12 | S4/S5/S6 |
| R05全部及维护边界 | M04 | C4 / AC07、AC08、AC10 | S4/S5 |
| R06独立阶段/验收 | 全部 | IMPLEMENTATION-PLAN / AC14 | 全阶段、S7 |
| R07生图先行 | S2设计输入；M01–M06行为 | AC12/AC14 | S2/S5/S6 |
| 存量/不生产执行/不改财务邀请 | M07 | C6 / AC11 | S3/S7 |
| 工单知识库/旧旁路/无默认数字 | M03/M05 | C1/C5 / AC06、AC08、AC13 | S3–S7 |

## 环境与命令边界

后台远端`https://github.com/jasonukkd/nexion-ops-console.git`的授权身份查询失败证据来自OWNER-DECISIONS（Repository not found）；不回退旧账号、不改owner。此限制不阻断本地规格交付，但不能称远端同步成功。

后端工具已由协调会话核实存在：`D:/WORKS/PLAN/.local-runtime/phone-calibration-tools/jdk-17.0.20.1+1`、`apache-maven-3.9.9/bin/mvn.cmd`、`mysql-verified/mysql-8.4.6-winx64/bin/{mysqld,mysql}.exe`（后二者路径同此前缀）。不在PATH不等于未安装；后端阶段设置临时JAVA_HOME/PATH，不下载替代工具。任何测试DB须独立schema及隔离凭据，生产数据不触及。本文未运行这些测试。
