# 客服重构：数据、权限与接口契约

需求来源：[OWNER-DECISIONS.md](OWNER-DECISIONS.md)。本文所有新增字段、端点和事件均为**目标契约，尚未实现**；现状证据见 [SOURCE-MAP.md](SOURCE-MAP.md)。业务规则唯一由本文定义，SPEC 引用本文，不另设默认数字。视觉由 S2 独立交付。

## C1 不变量与最小默认

1. 邀请树、服务归属、主动维护是三个独立维度。任何客服操作不得改邀请人、团队或财务关系。
2. 每个客户至多一个当前归属；已绑定恰好一个。普通客服只读写本人客户，主管审阅但不能冒名对客发送。客户端身份从登录态取，不能提交其他 customerId 冒用。
3. 顾问忙碌、离线、并发满均不换归属；未绑定可以留言。普通客服入口、工单回复、主动发信、历史会话、SSE 和图片同样受此约束。
4. 联系成功发出、维护成功、停止主动维护分别建模。发送成功指消息和收件箱持久事务已提交，可读回；不是“已读”、上传完毕或按钮反馈。
5. 下列为 S1 最小实现默认，来自 R05 的必要消歧，**不是主人原话或既有生产值**：维护仅由显式“联系维护”入口/发送意图产生；原本活跃的客户须出现联系后新的有效活动事件才成功；同一归属最多一个未结束周期；不设未要求的成功归因超时；停止/转绑结束未成功周期；恢复不复活旧周期。协调会话可据此审阅，不需重复索取已经授权的实施许可。
6. 沉睡天数D、再次维护间隔M、活动统计窗口W无可靠现有权威值时保持null。继承显式mode=UNCONFIGURED/LIMITED/UNLIMITED；仅LIMITED使用L，L=0合法。禁止将示例30/7/2写为生产默认。UNCONFIGURED注册正常入池；UNLIMITED不设层数门，但仍校验直接邀请人有效绑定与防环。D/M/W独立可用：待维护只依赖M和归属/开关，D/W未配置分别影响沉睡/活跃指标，不阻断维护；人工沟通与停止/恢复始终可用。依据见[HANDOFF.md](HANDOFF.md)。

## C2 数据字典与生成

复用现有 app 用户、admin 账号、客服 profile、conversation/message 和 append-only 审计。现有 assignment 表已经通过生成列 active_user_id 的唯一索引保证单一 ACTIVE：优先在此扩字段和版本，CurrentAssignment 是逻辑投影，不要求再造当前绑定表。以下是领域字段，不要求另造通用框架。所有 id、时间、操作者、版本、统计均服务端权威；前端只缓存。

| 对象 | 字段 / 类型 / 默认 | 生成与约束 |
|---|---|---|
| CurrentAssignment | customerId: bigint逻辑唯一；assignmentId: bigint；agentAdminId: bigint；version: bigint | 当前ACTIVE以既有active_user_id唯一索引保证，历史保留多条INACTIVE，不用 `UNIQUE(customerId,status)` 限制历史 |
| AssignmentHistory | id、customerId、agentAdminId、startedAt、endedAt?、source(MANUAL/INHERITED/MIGRATED)、segmentRootId、depth、parentAssignmentId?、ruleVersion?、operationId、reason | 追加历史；人工单客/批量每客新 assignmentId，root=本人、depth=0；继承 depth=直接邀请人当前 depth+1，root 沿用；迁移不伪造未知继承深度 |
| BindingPool | customerId 唯一、reason(NO_INVITER/INVITER_UNBOUND/DEPTH_LIMIT/RULE_UNCONFIGURED/AGENT_UNAVAILABLE/MIGRATION_REVIEW)、enteredAt、version | 已绑定与待绑定池互斥；入池无自动认领；主管成功分配同事务出池 |
| MaintenancePreference | customerId PK、enabled:boolean=true、version、changedAt、changedBy、reason | 客户级主动维护意愿跨转绑保留；停止不是解绑。仅当前顾问可操作本人客户；主管可审阅和转绑，不能代签本人停止 |
| MaintenanceExecution | id、customerId、assignmentId、agentAdminId、messageId unique、cycleId、committedAt、commandKey | 每条明确维护意图且成功持久化的人工消息一条；失败、重试同消息、自动推送、普通服务回复不计 |
| MaintenanceCycle | id、customerId、assignmentId、agentAdminId、openedAt、baselineActivitySeq、firstExecutionId、state(OPEN/SUCCEEDED/STOPPED/TRANSFERRED)、closedAt?、successEventId? | 首次维护发送同事务建立；同一 assignment 至多一个 OPEN；后续联系加入原周期，不改 baseline/开周期时间 |
| AccountActivity | eventId unique、customerId、seq、occurredAt、acceptedAt、source、sourceRef unique | 服务端成功提交真实前台操作时产生；seq 为客户内单调顺序，不能接受客户端自报成功时间。事件与业务写同事务或可靠 outbox；处理重放不重计 |
| ActivityProjection | customerId、lastEffectiveAt?、lastSeq?、coverageStartAt、complete:boolean、observedThroughAt | complete按C4.4当前判定所需区间计算；断档可恢复，缺时间不伪造 |
| SupportRules | version、dormantDays:D?、maintenanceDays:M?、activityWindowDays:W?、inheritanceMode、maxInheritanceDepth:L?、updatedAt/By、reason | D/M/W为正整数，各自可null；D/W同时配置才校验W≤D。mode默认UNCONFIGURED，LIMITED须非负整数L（0仅人工根），UNLIMITED/UNCONFIGURED时L=null；范围采用数据库/安全整数限制，无额外业务上限 |
| HumanMessage 扩展 | id、conversationNo、customerId、senderType、senderAdminId?、assignmentId?、kind(TEXT/IMAGE)、content?、attachmentId?、intent(SERVICE/MAINTENANCE)、clientMessageId、createdAt | TEXT 非空；IMAGE 引用已就绪附件，可无文字；历史默认 TEXT/SERVICE，保留原作者，不回填维护执行 |
| PrivateAttachment | id、customerId、uploaderType/Id、assignmentId?、mime、bytes、width/height、privateObjectKey、state(UPLOADING/READY/ATTACHED/REJECTED/EXPIRED)、expiresAt、messageId? | 服务端随机 id；按真实文件解码判断类型；暂存完成不等于发信；同附件最多附一条消息，重试同命令例外 |

### C2.1 原子性、顺序与幂等

以客户稳定主记录为串行化锁，注册继承同时锁直接邀请人归属读取、规则版本；批量按 customerId 升序取锁。归属、周期、发送、活动成功判定、停止恢复共享此锁序/等价串行化事务，避免转绑后旧顾问发信。

请求需 Idempotency-Key（8–128 字符）和 expectedVersion/expectedAssignmentId；服务端按认证主体+操作+key 唯一，绑定请求摘要。同 key 同载荷返回原结果；换载荷 409；事务未提交不留“成功”命令。发送还以主体+clientMessageId 唯一永久约束，不能因命令缓存过期制造重复消息/执行。归属变更重放须先做**当前读权限**检查，不得借旧成功缓存读出已转走的客户资料。

主管批量操作提交显式 customerIds 和逐客户 expectedAssignmentId/version；沿用现有每请求100客的技术批量限制（不是顾问总绑定上限）；整体预检、整体事务，无部分成功；并发变化 409 返回可重新预览的冲突标识，前端保留选择，刷新后重新确认产生新命令。同目标当前归属重复分配为 no-op，不重置继承段/首次联系；转绑 A→B→A 是新归属。reason 8–200 字符；操作者从安全上下文取，忽略请求中的 operator/ownerName。

## C3 归属、继承与消息访问

注册有效邀请人=current direct inviter。仅其当前归属可继承：顾问账号与客服资格有效、已知depth，且mode=UNLIMITED或mode=LIMITED且depth+1≤L。UNCONFIGURED不能继承。忙/离线/会话满不影响资格。无邀请人、邀请人未绑定、深度超限、规则未配置分别入池；不向更高祖先找顾问。沿用注册防自邀/防环及同环境校验，只读取直接邀请人已验证归属，不扫描整树；未知深度/坏链入MIGRATION_REVIEW。账号创建、邀请关系、继承或入池须同事务提交；客服附属写失败回滚并允许同注册意图安全重试，不能留“注册成功但无归属且无池记录”。mode/L变更只影响之后注册；邀请人后来补绑不回溯吸走池内客户。

人工绑定/转绑每个明确选中客户为新 root0；默认只当前客户。选择后代时先预览**实际客户 id 清单**，每人显示原→新归属，排除未选择客户；不能提交“整棵树”待执行时再扩展。未来从未选择后代注册仍按其原 segment 继承。继承/注册与转绑并发以事务串行先后为准，记录实际读取的 parentAssignmentId 与 ruleVersion。

转绑事务结束旧归属，建立新归属，结束旧 OPEN 周期为 TRANSFERRED，保留维护开关，原顾问失去该客户全部在线读写/流/附件访问。旧已成功周期及执行仍归原顾问统计，历史报表只保留允许的汇总，不提供已转走客户正文。新顾问可读必要完整客服历史，作者和时间不改；首次待联系按新 assignment 判定。所有旧/新 conversation 的授权都查客户当前归属，不能信 ownerAgentId 遗留字段。

停用账号立即禁止该顾问读写；既有客户归属保留并标“顾问暂不可服务”，消息仍入原客户收件箱，主管显式转绑交接，不做偷偷解绑/均衡；新注册不能继承停用顾问。停用权限继续由现有超管账号权限管理，本期“主管处理停用交接”不等于扩予停用账号权限。停用/转绑审计保留处理人、原因、前后值、命令与请求追踪。会话 closed/resolved 只影响对话段：再次求助续建服务会话仍属同一顾问，不改变长期绑定；已关闭段不可追加，创建新段可留言。新关闭/解决操作须无未处理客户消息，否则409并提示先回复；存量已关闭且未回复的消息可由当前顾问在新段回复时显式带replyTargets覆盖，见C4.3，不能假清已读。

## C4 维护、活动与统计

### C4.1 有效活动

最低可靠来源为服务端验证成功的**交互登录**及服务端白名单内真实前台业务操作成功；明确排除刷新 token、轮询、连接/SSE/已读回执、人工客服聊天发信本身、自动结算、设备后台任务、管理员操作。不要在整个认证过滤器中“有请求就活跃”。S4 必须逐事件给出真实调用点、服务器如何区分交互/后台、唯一 sourceRef 和正反例；无法可靠区分的来源不启用。以交互登录为首个可用源是技术最小默认，更多来源仅在证明后接入，不凭客户端事件名信任。

baselineActivitySeq 在首次执行事务内捕获。成功要求同客户的**新**有效事件 seq>baseline、事件事务线性顺序晚于首次执行，且处理时周期仍 OPEN、开关 enabled、归属未变。时间相同用单调 seq/提交顺序破平局；回放/晚到的发送前事件不能成功（必须有原业务提交序/发生时间证据，不能以消费者收到时间冒充）。一个 activityEvent 至多成功一个周期，unique(customerId,successEventId)。原本活跃客户也必须新的真实操作；仅刷新标签/配置重算不能成功。unknown 客户可以以联系后的首个可证事件证明本次成功，但不得补造联系前活跃记录。

### C4.2 周期和待维护

| 输入 / 状态 | 结果 | 明确不发生 |
|---|---|---|
| enabled、当前归属、显式人工维护发送提交，无 OPEN | 创建 OPEN + execution，捕获 baseline | 不立即成功 |
| OPEN 再次维护发送 | 新 message/execution 加入同 cycle；lastExecutionAt 更新 | 不重置 baseline、不增加周期数 |
| 同消息超时重试 | 回查/返回同 message/execution | 不重复计数 |
| 有效新活动，OPEN | SUCCEEDED + 唯一 successEvent；closeAt=有效事件时间 | 非 OPEN 不成功；不因回复自动成功 |
| enabled→stopped | OPEN→STOPPED；从主动待办移除，审计原因 | 不解绑、不屏蔽主动求助、不成功 |
| stopped 时再活跃 | 更新活跃状态/窗口统计 | 不改旧周期，不产生维护成功 |
| stopped→enabled | 不重开旧周期；恢复当下待维护计算 | 不自动执行、不自动成功 |
| 转绑 | OPEN→TRANSFERRED，历史执行/成功归旧顾问 | 不转移功劳；停止开关不自动恢复 |
| 规则 D/M/W 修改/时间推移 | 仅重算当前标签与到期显示 | 不生成 execution/cycle/success |

待维护为当前本人绑定、enabled且M已配置（D/W无需配置），并满足：本次归属从未有维护执行，或now≥lastExecutionAt+M×24h。若存在SUCCEEDED周期，则下一周期到期锚点取max(lastExecutionAt,lastSucceededAt)，避免刚成功立即追发。停止恢复后按同一锚点计算，已过期即到期；没有新发送不建周期。OPEN可持续跨多次到期联系，只成功一次；M仅控制到期待办提醒，不限制人工联系：成功后再次显式维护发送（即使提前或M=null）即可另开周期；发送后仍需新的有效事件才成功。沉睡标签独立，不是待维护必要条件（活跃客户也可定期维护）；待办以customerId去重。首次待联系=本assignment尚无顾问成功人工发信，SERVICE/MAINTENANCE均可完成首次联系；主动首次待办排除stopped，但未联系事实仍可在详情查看。

### C4.3 六指标

所有指标带 evaluatedAt、rulesVersion、scope、数据完整性；同一响应内一致快照，服务端聚合、分页不影响总量。时间区间 UTC 半开 [from,to)，界面按当前显示时区转换，业务“天”=24小时。

| 指标 | 唯一口径 |
|---|---|
| 绑定客户 | 当前本人有效 assignment 客户数；与并发会话数分列，无绑定人数上限 |
| 活跃客户 | 当前绑定客户在窗口 [now-W×24h,now] 有有效事件的去重人数；标签为“近 W 天活跃” |
| 沉睡客户 | lastEffectiveAt非空、now-lastEffectiveAt≥D×24h且C4.4所需区间覆盖完整；否则不能硬算沉睡 |
| 待维护 | C4.2 公式，去重客户；未配置返回 unavailable/null，不返回伪零 |
| 待顾问回复 | 客户任一人工服务会话存在未被后续顾问成功服务回复覆盖的客户消息；按客户去重，read 不清零；停止仍保留 |
| 首次待联系 | C4.2 本次归属从未人工联系且 enabled 的客户；新归属归零，不继承旧顾问首次记录 |

六项有重叠，不应加和为客户总数。活动窗口不等于当前状态：当前标签为 ACTIVE（距最后有效活动<D）、DORMANT、UNKNOWN；W≤D 时可有当前 ACTIVE 但窗口不活跃的客户。待回复跨会话聚合；发送时带replyTargets:[{conversationNo,throughMessageId}]，省略时不清待回复。服务端验证每个目标都属同一客户、游标是真实客户消息且当前顾问有权；默认只填当前会话，处理存量已关闭未回复时由界面明确选中该旧会话游标并在新段回复。仅成功提交回复同事务更新指定目标的已处理游标，旧段不追加消息；后续并发新消息仍待回复。维护发送不能自动覆盖任何未选目标。旧replyThroughMessageId可兼容映射成当前会话单目标。

业绩分三项：执行次数=唯一 execution 数；成功周期数=SUCCEEDED 周期数；成功客户数=选定时间窗内成功的 customerId 去重。都按事件发生时保存 agentAdminId，转绑不改历史；不将成功周期数/当前绑定人数当成功率，首期不增加未请求的转化率。

活跃指标点击固定`filter=WINDOW_ACTIVE`，窗口与响应rulesVersion/evaluatedAt一致；当前状态筛选`ACTIVE`使用D，不与窗口混用。测试必须包含W<距最后活动<D的客户：当前ACTIVE但不在WINDOW_ACTIVE中。W未配置时WINDOW_ACTIVE不可用，ACTIVE只依赖D及有效活动，不互相封死。

### C4.4 活动覆盖恢复

coverageStartAt是自最近一次采集缺口结束后可证明连续观察的起点，observedThroughAt为持久消费完成水位，不能直接伪填now。新注册启用采集时从注册提交起覆盖；迁移无历史从启用起覆盖。每个有效新事件更新lastEffectiveAt，但不补造之前历史。

当前ACTIVE：存在真实有效事件且距now<D即可证明，历史缺失不妨碍此结论。当前DORMANT：lastEffectiveAt非空、距now≥D，且区间[now-D,now]完整（coverageStartAt≤now-D且水位覆盖评估时刻）；否则UNKNOWN。无任何真实时间的迁移客户保持UNKNOWN直至首个有效事件；首事件后可ACTIVE，持续完整观察D后可DORMANT。采集中途断档时仍有D内事件可保持ACTIVE；过D后若区间不完整则UNKNOWN；连续恢复D后再允许DORMANT。规则D变大需重新计算覆盖，不能保留旧complete=true。

窗口活跃：W内有有效事件是确定活跃；W内无事件但窗口覆盖完整才确定不活跃，其余未知。聚合返回knownActiveCount和unknownWindowCount；unknownWindowCount>0时精确活跃人数为null，界面显示“已确认活跃N，另有X待确认”，点击WINDOW_ACTIVE仅列已确认集合，不能假报完整总数。指标统计评估取已处理水位，暴露延迟/报错，不能以消费者稍后收到的旧事件制造成功。

## C5 权限与端点

实际前缀：后台 `/api/admin/content`；客户端 `/api/app/support`。后台 Next 同前缀代理。现有 body/version/envelope 兼容，新增字段不得由客户端决定权限。角色名称映射实际 authority 和服务端客服 profile，不按前端菜单/字符串自封主管。S3 输出现有 grant→下表动作映射及迁移证据，不另起整套 RBAC。

| 动作 | 本人客服 | 主管 | 超管 | 客户 |
|---|---|---|---|---|
| 本人工作台/绑定客户/私聊历史 | 本人客户 | 审阅全部 | 审阅全部 | 自己的私聊 |
| 人工对客文字/图片发送 | 当前本人客户 | 不冒用顾问 | 不冒用顾问 | 自己；未绑定可留言 |
| 主动维护/停止/恢复 | 当前本人客户 | 只审阅，交接用转绑 | 同主管 | 无 |
| 分配/转绑/池/停用交接 | 无 | 有 | 有 | 无 |
| D/M/W/L 配置 | 无 | 只读 | 有 | 无 |
| 工单内部协作/知识库 | 保留原授权 | 保留原授权 | 保留原授权 | 原有查询/提交 |

具有多重角色的账号只有作为当前有效顾问时才能以自身身份发信；主管授权本身不能发送。

### C5.1 现有端点的必要收紧

| 现有端点 | 目标调整 |
|---|---|
| GET `/support-agents`、`/support-agents/page` | 主管保留 roster；普通客服返回最小本人资料；不泄漏其他客服客户列表 |
| POST `/support-agents/{adminId}/assignments`、`/assignments/batch`；PATCH `/seat-assignment` | 同一个 C3 分配事务，统一 reason/key/预期版本，不允许 seat 内 userIds 绕过 |
| DELETE `/support-agents/{adminId}/assignments/{id}` | 本期不提供任意解绑操作；服务端拒绝旧解除入口，交接用正式转绑，保留历史记录 |
| GET/POST `/conversations`；GET `/{no}`；POST `/{no}/replies` | 列表、详情、主动发信和回复均查当前客户归属；扩展kind/attachment/intent/replyTargets（兼容当前会话replyThroughMessageId）；新会话 owner 从服务端归属派生 |
| POST `/conversations/{no}/transfer`、`/transfer/accept`、`/transfer/return`、`/transfer/wait` | 人工客服线不再变更接待人，返回 409 正式转绑提示；取消普通客服/队列/备勤绕行；不触及 Nova AI 业务 |
| GET `/conversations/stream` | 按实时归属过滤，转绑撤订阅/终止旧权限，下次连接重新校验 |
| POST `/conversations/realtime-ticket`；WebSocket `/ws/conversations` | 新后台test实际主通路；短票只认证，不永久缓存对象授权。watch/typing/presence、create/reply/read命令与每个事件均校验实时归属，原key/载荷和HTTP同一事务；ping/pong、presence和已读不算账户活跃 |
| POST `/tickets/{no}/replies`、`/tickets/{no}/escalate`、`/conversations/{no}/ticket` | 对客回复只当前顾问；内部工单指派不改变顾问，对客升级不绕归属 |
| App GET/POST `/conversations`、GET `/{no}`、POST `/{no}/replies`、`/{no}/read` | 只自己；advisor/support 两个入口同专属授权；closed 后重开不回退其他客服；read 不记活跃或成功 |
| App GET `/commands/{key}` | 保留命令恢复；扩展图片/消息结果；只当前客户本人可查 |

表内 `/{no}` 指各行所属 conversations 路径；最终 HTTP 方法以 SOURCE-MAP 和 S3 实测路由为准，不能把新增目标当成已上线能力。

### C5.2 新目标端点（尚不存在）

| 方法 / 路径 | 请求 | 响应/权限 |
|---|---|---|
| GET `/support-workbench/overview` | 可选 from/to，仅历史业绩；普通客服不可选他人 agentId | 六指标+业绩+unknownCount+规则可用性+evaluatedAt |
| GET `/support-workbench/customers` | pageNum/pageSize、keyword、filter(ALL/WINDOW_ACTIVE/ACTIVE/DORMANT/UNKNOWN/DUE/WAITING_REPLY/FIRST_CONTACT/STOPPED) | 服务端授权分页，records 含 assignment/version/activity/maintenance/未回复摘要 |
| GET `/support-workbench/customers/{customerId}` | 无 | 授权客户详情、当前归属、维护偏好、周期/执行分页入口；避免全量泄漏交易资料 |
| GET `/support-workbench/customers/{customerId}/maintenance` | pageNum/pageSize | 维护执行/周期历史，当前顾问/主管可审阅；旧顾问仅其统计汇总 |
| PATCH `/support-workbench/customers/{customerId}/maintenance` | enabled、reason、expectedVersion、expectedAssignmentId；key | 更新偏好与周期，返回权威详情；仅当前顾问 |
| GET `/support-agents/binding-pool` | 分页、keyword、reason | 主管待绑定池、原因、邀请关系最小信息 |
| POST `/support-agents/assignments/transfer` | targetAgentAdminId、customers:[id,expectedAssignmentId,expectedVersion]、reason；key | 显式范围原子转绑结果+每客新 assignment，主管 |
| GET/PUT `/support-agents/rules` | PUT D/M/W、inheritanceMode/L、expectedVersion、reason；key | 规则版本与独立未配置状态，超管写 |
| GET `/support-workbench/commands/{key}` | 无 | 当前认证主体的写入结果；转绑后不能重放出失权内容 |
| POST `/conversations/attachments`（后台） / `/attachments`（App） | multipart file、customerId（后台）、clientUploadId、expectedAssignmentId（后台）；key | READY 附件元信息；后台仅当前顾问，App 从 token 取客户 |
| GET `/conversations/attachments/{id}/content`（后台） / `/attachments/{id}/content`（App） | 登录态、可选 Range | 私有字节流、每请求实时鉴权、no-store；当前顾问/主管/本人客户 |
| DELETE 对应 `/attachments/{id}` | 尚未 ATTACHED；key | 取消本人暂存文件；已附着拒绝，不能删历史消息 |

上传限制由服务端能力响应（可扩展rules GET的attachmentPolicy只读段）提供：允许MIME/大小/像素/暂存期限必须在启用前配置并验证；不写无来源生产数值。最低静态JPEG/PNG解码后重编码、去EXIF；WebP只在真实编解码器验证后加入能力，不为它新增非必要依赖，未支持时明确提示。拒SVG/HTML/脚本、路径及远程URL抓取。管理员代理目前request.text()/response.text()：S5必须增加二进制通路且保留认证，不可文字代理转图。图片使用登录鉴权流，每次实时校验，不能发公共URL/长期签名链接；撤权不能抹去已下载副本，但阻止后续获取，页面清缓存和blob URL。

错误遵从现有 envelope；目标语义：401 登录失效、403 无动作授权、404 不存在或无对象访问（不泄漏存在）、409 版本/归属/命令冲突、422 内容校验/规则未配置、413 图片过大、415 类型不支持、429 限流、503 服务/存储不可用。界面转译为可操作中文或客户端现有语言，保留输入与重试，日志不存 token/图片内容。

## C6 迁移与回滚

S3 只在隔离库做 dry-run 与真实事务回读：统计每客户有效绑定数、无效/停用顾问、孤儿引用、重复、仅有历史接待而无绑定、未知继承段。单个可信有效旧 assignment 可迁为 MIGRATED、root=本人/depth=0 的**迁移默认**并标 provenance，不宣称这是历史邀请事实；重复/矛盾不得任取一条，输出人工裁决清单后入待处理流程，不能静默解绑。现有已绑定迁移不制造首次维护/成功事件，历史人工消息仍可保留，但本次切换后的首次联系从迁移切换点开始计算。历史senderId存在null或误写客户id的现状：保留原显示作者和原始字段，增加authorConfidence=UNKNOWN语义，不把现有senderId强行解释为真实顾问，更不能追造历史维护业绩。

扩展表/字段→只读对照→唯一约束与数据核对→统一权限开关→新界面接入。旧会话/附件/作者保留；迁移操作 id 幂等并保存前后映射。旧版本回滚若会恢复无专属约束的发信，必须先关闭人工对客写入口、保留留言读写安全路径，不能直接回退权限漏洞。不删新历史、不反改邀请/财务、不在本阶段部署或执行生产 SQL。S7 必须证明隔离环境迁移重跑不重复、回滚可恢复、安全约束持续成立。
