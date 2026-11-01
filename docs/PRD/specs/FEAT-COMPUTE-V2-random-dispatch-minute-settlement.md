# FEAT-COMPUTE-V2：随机派单、独立运行态与分钟结算

日期：2026-11-01；TEST 进度更新：2026-11-02（现场回执使用 UTC）。依据：本聊天用户批准的《设备算力任务优化计划书：随机派单、Redis 运行态、RocketMQ 可靠事件、分钟批量结算》，以及同日后发决定“先满足效率，暂不考虑可靠事件要求”。本规格适用于正式后端、管理端及 App 共用 H5 页面；H5 Lite 分支仍独立维护、发布。

状态：TEST已发布backend446/9eae08a0、App366/128ede89和PC280。App366于2026-11-01T20:19:39Z完成正常发布和任务恢复，后端PID1004534未重启；普通当前作业、无障碍名称、最近完成chip及Home当前作业均实际复验为产品名称Embedding，无内部执行器标识或普通任务编号。首轮5项ISSUED/模型OOM/RECOVERY及暂停均保留为历史；19:49:56Z快照73项VERIFIED=73分摊、4个USDT批次共1500微单位，独立资金复核3382项字段断言通过、0异常，随后19:56:08Z已达237任务/10批次4785微单位。两种真实输入、运行/完成秒数、PENDING/POSTED历史和批次已有实景证据，540秒资源窗口0新增OOM且20%余量保持；该窗口在正常前端维护后另起，不拼接计时。正UVT实景、2小时/24小时长稳仍PENDING，不能把短窗口成功当作全量验收。

## 1. 边界与权威

- 管理能力为 1000 个账号、每账号最多 6 个权益槽，共 6000 槽。权益槽数量不等于真实推理并发；现有 TEST 单机真实执行上限为 6，按资源预算调度，共用一个执行引擎，不新增分布式算力池。
- TEST 当前只承认已部署、可真实计算并独立验证的 BGE 执行能力。六类任务配置可维护，不代表六类执行器均已安装。未安装、能力不符、禁用、暂停、kill 或无资格的候选不得派发；不能用计时器、Mock 或固定成功替代真实执行。
- 任务、收益、钱包、凭证、配置版本均由服务端决定。App/H5 只读取，不提供领取、完成、领奖或写收益动作。预计进度达到 100% 不触发任何资金或任务状态迁移。
- Redis 是可重建实时运行态；RocketMQ 保存生命周期事件；MySQL 保存任务、收益、钱包增量、批次与资金凭证；MinIO 保存产物。不得在 Redis/MQ 放全量产物、账号凭据或秘密。
- 本轮优先效率，复用 TEST Broker 既有 `ASYNC_FLUSH` 与 72 小时保留，不修改 Broker；`SYNC_FLUSH`、7 天保留及强制关闭清理等可靠性增强延期，不作为 v2 启用门禁（`strictDurability=false` 默认）。保留 MQ 发送确认、重复保护与 DB 唯一约束；异步刷盘确认不代表已物理落盘，不能宣称断电绝对不丢或超过保留期仍能完整恢复。
- 保留原设备及账号资格、E3 能力调整、每日 UVT 唯一性和 v1 UNKNOWN 恢复预算。新旧引擎不得对同设备双派，回滚停止新 v2 派单但继续收敛已有 v2。

## 2. 管理端任务配置

入口：E2 任务列表的新增、编辑抽屉。原任务类型、模型、奖励范围、显存、状态、单位等字段继续生效。新配置进入原有业务确认与 A2 命令，再由服务端校验、保存、回读；不能只在浏览器生效。

| 字段 | 类型与约束 | 兼容与默认 |
|---|---|---|
| `selectionWeight` | 整数，1–1000000 | 旧配置缺省 1；仅在合格候选间按权重随机 |
| `expectedDurationMinSec` | 整数秒，1–86400 | 默认按下表 |
| `expectedDurationMaxSec` | 整数秒，1–86400，且不小于最短值 | 默认按下表 |
| `executionTimeoutSec` | 整数秒，1–172800，且不小于预计最长值 | 留空沿用服务端配置 |
| `runtimeKey` | 最多 96 字符 | 留空沿用；填写不安装执行器 |
| `validatorKey` | 最多 96 字符 | 留空沿用；验证必须独立于执行结果宣告 |
| `workloadConfigJson` | 有效 JSON 对象，UTF-8 最多 16KB | 留空沿用；数组、null、无效 JSON 拒绝 |

| 类型 | IG | VG | LL | FT | EM | SP |
|---|---:|---:|---:|---:|---:|---:|
| 预计最短、最长默认值（秒） | 18 | 900 | 12 | 1800 | 5 | 30 |

奖励范围非负、最低不超过最高，最多 12 位整数及 6 位小数，最低等于最高合法。权重、预计时长及超时拒绝小数、空必填值、负数、越界及逆序区间。前端给出可恢复的字段错误，后端重复校验。

TEST 已通过正常 E2 SuperAdmin 提案与 A2 SuAdmin 审批两项 EM/BGE-M3 配置，数据库六位奖励范围及不同输入摘要已核对（`CANARY-TASK-PROFILES.json`及实际审批/回读证据）。两项复用真实 `test-bge-m3-v1` 执行与独立校验能力，不代表安装了其他模型或任务类型。

| 配置 ID | 输入字符数（3 段） | 预计秒数 | USDT 抽签范围 |
|---|---|---|---|
| `TK-1793552869608` | 20 / 25 / 18 | 5–8 | 0.000010–0.000020（10–20 微单位） |
| `TK-1793552978860` | 174 / 185 / 190（修订后） | 15–25 | 0.000020–0.000030（20–30 微单位） |

长文输入已通过正常E2/A2修订：原816/846/846字符输入在现有1.5GiB模型限制下出现OOM；`CANARY-LONG-WORKLOAD-V2.json`为174/185/190字符ASCII三段，独立容量探针HTTP200、3×1024向量、3.95秒，仅证明该输入可运行，不代表经济任务完成。正常E2原目录价0导致保存被阻后，按明确授权复用原创建正微额`price=0.000025`通过表单与服务端校验，经济min/max仍20–30微单位；旧DECIMAL(18,4)回读仍为0，不升到0.0001。SuperAdmin提案`WO-261101192736142-788`由独立SuAdmin于2026-11-01T19:29:54执行，重新进入E2后新workload逐字精确一致，名称、EM/BGE-M3、权重1、15–25秒、timeout300、runtime/validator、VRAM8与正常接单状态均保持（`E2-LONG-WORKLOAD-READBACK.json`及截图）。E2页面未暴露policy版本字段，后续根已确认revision2，真实新派长文stage及完成详情也显示配置版本2；本次未操作原五项冻结任务，不以新配置覆盖其输入或收益。

上述秒数是冻结预计值，尚未作为两种任务的实际完成耗时验收。原目录 `price` 仍为 `DECIMAL(18,4)`，微额在目录显示为 `$0.00` 属于既有精度/展示限制；V2 使用六位 `minReward/maxReward` 抽取微单位报价并经 E3 冻结和结算，不以目录显示值推定实际奖励为零，也不据此虚构已到账。

配置只影响后续新派任务。派单时冻结任务输入、配置版本、预计时长、执行器/校验器与奖励报价，重试使用原业务标识，不重新随机。已领取任务不因运营改配置改变金额或工作内容。编辑必须保留服务端原状态，不把暂停或下架任务自动改为启用。

通用执行超时上限仍为 172800 秒，合法配置不能因 worker 使用较小的硬编码上限被错误送入恢复。现有 BGE 独立校验器另有 180 秒预算，与任务执行超时分别校验和报告；填写更长执行超时不延长独立校验预算。

## 3. 调度与完成事实

设备当前任务主状态：`QUEUED → RUNNING → VERIFYING → COMPLETED`；异常恢复进入 `RECOVERING`，终止可为 `FAILED`、`CANCELLED`。原手机任务的 `PAUSED` 以及 v1 `CLAIMED` 兼容保留。

- `QUEUED` 未真正开始，`startedAt=null`；排队不计运行时长或收益，不占真实计算连接、线程或执行名额。无可用计算名额继续排队。
- `RUNNING` 从实际开始时间计时。预计时长、预计完成时间只作展示；实际耗时由服务端返回，不用排队时间充当运行时间。
- `VERIFYING` 代表计算结果等待独立校验与可靠完成事件确认；不能仅因推理返回就入账。
- worker 中断、租约超时或后端重启进入受控恢复；旧代际先隔离，旧推理退出后才释放真实执行名额，迟到提交拒绝。
- 一槽待停用时按已有规则完成当前工作后退出，其他槽独立继续；暂停、撤权、冻结等仍由服务端拒绝非法新领或完成。

正常取消激活（包括“完成后停用”）在有未退出 v2 代际时沿用 `pending_deactivate`：不清除仍在执行或结果未知的任务。尚未开始的排队任务须在原取消激活事务提交后合法取消；已开始的任务等待真实计算、独立校验和物理退出，EXITED 确认后才可终结停用。已有 v1 UNKNOWN／未解决请求仍保留并阻止提前释放。置换、容量替换、后台解绑、回收不能替代该排空流程：代际未排空返回 `COMPUTE_V2_DEVICE_BUSY`；不以释放权益为由复用正在执行的设备或丢弃已确认收益。已有有界调度会重试待停用收敛，不新增每账号独立定时器。

本轮为真实解除四个旧槽卡住，追加固定TEST本案的A2无收益终结能力，范围仅1208/1209/1212/1214原owner/device/instance/task/config/request key/body hash/generation1。原1380及其他UNKNOWN不在范围内，不能把自然到期或一般停用当成终结依据。root以真实旧backend/worker/模型进程退出、boot/epoch、原journal指纹等证据形成HMAC签证，经专用worker bearer接口验签注册单JVM cache；此步骤不取消任务或写业务DB。后台实例重启后签证失效，须重新取证注册。

入口位于正常E5「设备运行管理」逐用户设备行，仅当后端GET返回本案eligible且管理员同时具备device_e5_write和既有A2提案权限时出现“结束未确认任务（不计收益）”。既有SuperAdmin maker用普通操作确认填写8–200字理由，页面显示精确原任务/代际、case、proofSha及backendInstanceId；只POST reason和proofSha，后端取已验签proof固化为typed A2命令。使用既有acct分类和独立SuAdmin checker，不新增角色、凭据或MFA旁路。票号回显为待复核，提交不伪装已取消；A2展示服务端规范化的无收益结果、证明和epoch，maker不能自审，批准时重核权限、退出证明和零副作用。

只有同事务完成真实task CANCELLED、不可覆盖的zero-credit resolution与精确旧runtime清理后，资源/admission才按完整匹配的原request+已提交裁决逐条排除其承诺；同设备其他不确定请求和foreign resolution不得释放。V2只读恢复投影也只排除上述精确已提交裁决，避免已终结槽仍被原UNKNOWN画为恢复；没有裁决、foreign事实或非取消任务仍保留恢复事实。原request的PROCESSING/UNKNOWN、generation/recovery预算及旧journal保留，不伪造ROLLED_BACK、不授重放，不创建收益回执、钱包流水、fund operation或补偿款。任何正向receipt/收益/ledger/UVTdaily/fund/outbox等证据均拒绝无收益终结并转对账；并发完成、重复审批、DB提交ACK丢失只能收敛到原裁决，不能重复归还或加钱。后续进入V2和新任务收益仍走原资格、真实执行、确权和分钟结算，不计作旧取消的收益。

固定四案已完成真实 E5/A2 双人流程：1208、1212、1214先执行成功；1209首票因 `device.deactivated` outbox 契约不全返回422，事务完整回滚，旧票由 maker 正常页面取消后为 `rejected`，不能记成已执行或 `withdraw`。`817f2007957b85b241111603ad3f1736181d72ae`补齐 canonical 停用事件的 userId、previousStatus、rowVersion，4项定向及1项真实 outbox 回归后随 backend444 发布。重启重新取证/注册后，SuAdmin 于2026-11-01T17:18:43Z执行新票 `WO-261101171820550-916`。

`ZERO-CREDIT-ACTUAL-FOUR.json`及最终 `V2-CANARY-CONFIGURED.json`核对四个原任务均为 CANCELLED、原 request/执行证据和 journal 未改、无收益回执/earning/钱包流水/fund operation或完成入账副作用；四案旧承诺不再阻塞。1209原待停用收敛为 DEACTIVATED，不自动激活；其余1204/1208/1210/1212/1214共5台符合当前激活资格。以上是旧任务无收益终结，不能称旧任务已计算完成或已结算，也不代表后续新经济链路已通过。

## 4. 资金与分钟批次

任务完成与到账分开，`settlementStatus` 为 `NONE`（尚无已确认收益）、`PENDING`（已验证完成待结算）、`POSTED`（已入账）或 `BLOCKED`（受控挂起）。排队、计算、校验、恢复及未产生已确认结果的失败/取消任务为 NONE，冻结报价不能算入待结算。旧 COMPLETED 包装为 POSTED，旧活动任务为 NONE。冻结奖励不能被客户端修改；只有 `POSTED` 才进入钱包可用余额及后续分佣依据。

待结算按资产分别返回 `pendingEarned: [{asset, amount, taskCount}]`，`amount` 为六位小数字符串；USDT 与 NEX（页面品牌名 UVT）隔离。App 不求和后写钱包，不把待结算金额计入可提现或可消费余额；显示舍入只用于展示，传输原精度不变。

SQL 提交成功但 ACK 未确认时，不能把同一事件同时展示为已到账和待结算。读取先原子取得该账号的待结算 VERIFIED 事件索引和四项金额/数量，再在同一 SQL 一致快照中按该账号、TEST 范围查询这些事件已提交的分摊证据，从摘要扣除已入账部分；每次 SQL IN 最多 200 个事件。不能只检查当前页面或最近六任务，也不扫描全局 30000 事件。索引、金额、数量、资产配套或身份不一致时返回读取失败，不能伪造零。

- 完成业务事件收到 Broker 发送确认后才进入可结算集合。重复事件只能累计一次；未知发送结果按同一事件重投。本轮不额外要求 SYNC_FLUSH。
- 以不可变 60 秒窗口封存，同账号同币聚合，每批最多 200 项；迟到事件形成补充批次，不改已封存集合。
- MySQL 同事务写任务分摊、收益、钱包增量、批次和总账；任一点失败整体回滚。批次、任务唯一性防重复发放；SQL 提交结果未知只核原批次，不另建新款。
- 正常停用不阻止已确认收益入账；冻结账号、钱包代际变化、孤儿资金证据等进入 BLOCKED，不伪装到账。UVT 按原 UTC 业务日唯一，跨日仍保留完成与入账两个时间。
- BLOCKED 最小权威来源是 Redis 按 canonical VERIFIED 事件 ID（任务号和代际）记录的确定性结算错误 marker，仅限账户冻结、钱包/设备身份或缺失、孤儿证据等明确错误；瞬时 SQL/网络失败不据此冒充 BLOCKED。读取只对尚无 SQL POSTED 证据的 VERIFIED 投影 BLOCKED，可附 `settlementBlockReason` 错误码；SQL 已提交分摊优先，不能被残留 marker 降级。marker 不删除原 pending 窗口或 MQ offset，成功确认入账后原子清除；重启由重试重建，不声明已有持久 BLOCKED 表或 DLQ。本轮可靠性增强仍延期。单账号批次失败不阻止继续处理其他账号已封存批次，既有全局未落库积压 5 分钟暂停新领门禁仍保留。
- Redis 丢失时从 SQL 快照和仍可读取的 MQ 未持久事件重建，重建前不新派；消费位点不得越过尚未落库的业务事实。恢复能力受现有异步刷盘和 72 小时保留边界限制。

## 5. App/H5 展示与接口

用户最终名称约定：普通当前作业、作业卡和完成历史只显示产品名称，不把内部KIND、model/executor/client、位置或`#CV2`拼进标题。保留并发产品决策`7b25af80`：普通名称使用既有`CurrentTask.type`对应的英文workload label（如Embedding），各语言保持同一产品名称；后台单语配置名仍由服务端`taskName`冻结并在显式凭证/审计中可核对，不据UI类别名推断两份输入相同。未解锁预览沿同一产品名称规则。禁止前端硬编码`TEST_BGE`替换或伪造其他执行能力；状态、进度、预计/实际时长、冻结报价和结算状态继续展示。显式任务、批次、资金与凭证详情保留业务ID和有明确标签的模型字段；已冻结事件不为文案改动重写。Home设备卷轴按P62布局显示状态，Earn新stage标题及仪表aria使用`task.type`。

App363类型检查失败后，364已实际完成P62生产类型检查及打包，真实artifact源码为`6d4cdb7db248f71d6510a4a52c248d9005801268`，不能把触发时预期的5686源码当产物来源。远端后续推进导致364不再满足原生`BUILD_IS_NOT_CURRENT_TEST`，未发布旧产物；新stage两处名称回退已最小修复并推test `5b5fed335b8a1916e1bf05f7aa8ffae9d17ad553`。App365于2026-11-01T18:42:37Z排队2179后，根已在实际最新页面确认stage可见名称和无障碍标签均为PC配置的“TEST BGE 长文索引”，无内部model或`#id`，该版本的当前作业名称要求已满足。后续产品英文label映射与普通“今日最近完成”chip单字段修订已随App366正常发布，并经当前页面独立复验通过。完整产物/发布回执仍按实际来源归档，不以排队预期SHA替代；名称满足不证明任务计算或资金闭环通过。

任务设备卡及首页展示队列、计算、校验、恢复、完成等服务端状态。设备卡区分预计时长、实际运行时长、冻结奖励、结算状态、批次号与配置版本；完成记录可展开任务详情，已入账且有真实凭证时可读取原计算凭证。

预计时长耗尽不能显示为已确认完成：`CLAIMED/RUNNING/PAUSED/VERIFYING` 及尚无完成权威状态的进度最多 99%，只有真实 `COMPLETED` 可以显示 100%；`RECOVERING` 与未开始任务隐藏百分比，保留原暂停和中断计时。

V2 读取包装器按本账号设备一次批量核对旧 COMPLETE 请求，精确绑定原任务、账号、设备、当前实例与配置；`UNKNOWN` 或按同一业务 Clock 严格超过十分钟的 `PROCESSING` 投影恢复，正好十分钟及新鲜请求保持原态。仍有当前旧任务时只改同任务状态为 `RECOVERING`，并清空不可信预计完成时间；租约过期导致旧接口不再返回 currentTask 时，返回设备级 `recoveryPending=true/recoveryReason=LEGACY_COMPLETE_OUTCOME_UNKNOWN`，currentTask 保持空。App/H5 的 Home、Earn 卡片、设备详情及设备仓库共用该恢复判断，不把槽显示为空闲或伪造任务/进度；新字段缺省兼容旧接口。另一历史任务不得污染正常当前任务，真实完成/凭证优先。该只读状态不清 UNKNOWN、不授予重放、不释放物理资源，也不代表四个旧槽已恢复、已完成或已结算；v1 后端协议保持不变。

收益页任务中心提供独立待结算区和结算批次列表；批次详情展示状态、原精度金额的展示值、任务数、完成窗口、入账时间及各任务分摊、完成时间、真实凭证号。空数据、加载、失败重试和分页分别展示；读取失败不把未知金额显示成 0。

| 接口 | 用途与合同 |
|---|---|
| `GET /api/tasks/v2/assignments` | 一次读取账号全部设备槽；`serverNow/devices` 与旧外形兼容，增加 `protocolVersion:2`、`pendingEarned` |
| 当前/最近任务 | 保留 `requiredSeconds`（冻结预计秒数）、`rewardUsdt`（冻结报价）；增加 `queuedAt`、可空 `startedAt/completableAt`、`actualDurationSec`、`settlementStatus`、`settlementBatchNo`、`settledAt`、`configVersion` |
| `GET /api/tasks/v2/settlements?cursor&limit` | `{records:[{batchNo,asset,amount,taskCount,status,windowStart,windowEnd,postedAt}],nextCursor}`；每页最多 50 |
| `GET /api/tasks/v2/settlements/{batchNo}` | 批次字段加 `items:[{taskNo,receiptNo,deviceId,taskType,amount,completedAt}]`；响应批次号、任务唯一性、项数及整数微单位总额须一致 |
| `GET /api/tasks/assignments` | 原 v1 只读兼容；仅 v2 端点明确 HTTP 404/501 不可用时回退 |

所有数据沿用 `source:'server'`、`sourceEnvironment:'PRODUCTION'`、`runId:''`、`serverCanonical:true` 权威校验。部署范围由服务端给出，用户不能借参数切换 TEST 或生产。认证失败、网络异常、5xx 或协议错误必须暴露当前读取失败，不用旧接口掩盖。

`actualDurationSec`在V2真实运行投影中表示：RUNNING（含COMPUTING）、VERIFYING、RECOVERING有真实`startedAt`时，以注入的服务端Clock当前Instant减开始时刻返回已用秒数，未来起点最低为0；未开始仍为null。它不是预计剩余倒计时，超过预计时长也不改为COMPLETED、不生成待结算收益。校验/恢复阶段的当前elapsed包含等候时间，不宣称纯模型推理耗时；VERIFIED后继续使用原真实`startedAt→completedAt`最终耗时，不能拿postedAt或当前时间替代，最终值按完成证据定值。缺乏同等运行证据的legacy/SQL fallback保留原未知语义。API、store和现有状态组件均已使用同名字段，无需改App；该后端读取修复已随446实机读回：长文运行1.372秒、校验13.919秒，详情最终耗时7.191秒；短文本运行0.585秒，排队未开始仍为—。这些是不同任务/时点样本，不要求运行中等候elapsed等于最终完成耗时。

Home、Earn、设备详情页面可见且 App 在前台时，每 3 秒合并读取六槽任务；复用账号代际、页面可见与运行配置隔离，同一请求合并。隐藏页面/后台停止快速读取；不加速手机运行信号写入和整舰队/钱包读取。切换账号及同账号重新绑定立即清理待结算、批次、详情；旧账号或旧页面的迟到响应不得写入新页面。

停止新派单后，TEST 所属已到账结算历史继续可读，不依赖 admission 开关。App 即使回到 v1 任务投影，仍可读取该账号的 v2 已到账批次；未启用该接口的旧服务仅明确 404/501 隐藏入口，认证、网络及服务错误保持可见。

## 6. 配置迁移时机

后端首次启用新 E2 字段前应用 `20261101_compute_v2_task_policy.sql` 与 `20261101_compute_v2_reward_precision.sql`；既有启动 `ensureSchema` 同步创建策略表并将任务奖励列补齐为 `DECIMAL(18,6)`。新字段缺省仍按旧配置默认，不要求旧测试构造器提供新 mapper。18,5 改为 18,6 后整数位由 13 位变为 12 位，存在超界旧值时拒绝迁移，不能截断或回填业务奖励。新输入同时限制 12 位整数、6 位小数；策略设置和创建/修改前后值进入 A2 审计。

V2 结算四表的 UPDATE/DELETE 禁改由八个固定触发器约束。实际 native 迁移门禁已拒绝这批未审程序，拒绝发生在 SQL 执行前；不得关闭普通存储程序门禁、手工执行仓库 SQL 或借用宽泛 root 权限绕过。此次新增专用准入只接受 `20261101_compute_v2_settlement.sql` 的固定文件 SHA、八段精确 offset/length/hash 与固定名称/表/事件/触发体；其他程序仍拒绝，既有 Cregis、support、H4 准入和权限保持。

固定 lane 的独立开关 `allow_fixed_compute_v2_trigger_install` 默认 false。经本轮固定范围复核后，仍须在任何 hold、备份和 DDL 前核对 app/root 身份、MySQL 版本、binlog/ROW、字符集及现有 grants；不得为本次任务扩大 grants 或改变其他审批开关。app 仅执行已审普通表 DDL，root 仅安装固定 definer 的八个已钉住 CREATE 片段，前置拒绝已有或部分对象、逐项及最终核对 metadata。数据库 DDL 不具备整批事务回滚语义；SQL 或确认结果未知后保留 SQL_FAILED/启动阻断与原备份/回执，不自动重跑、补删触发器或伪造历史 APPLIED。

迁移准入代码通过独立固定更新器纳入 native 发布：可信文件集合仍为原 13 个，仅替换 `database_migrations.py`，其他 12 个字节 pin 不变；同时验证实际 `0794fa15…` 旧源、完整旧闭包、stage 完整闭包与唯一新候选 pin。更新只处理该源及其 config/runtime-lock pin，并仅新增本轮已明确批准的专用 lane flag=true；其余原审批、外部/job/JAR policy、状态、启动 guard 和秘密保留。故障按原字节/权限恢复并复核完整旧闭包，不能清迁移/发布 hold 放行。候选、自测、跨 Agent 复核、主机更新与实际 SQL 迁移分别留证，所有主机和部署操作由根统一执行。

固定 lane 独立本地安全/故障检查 13 项、更新器独立 30 项通过，未发现具体 P0/P1；旧准入回归 73 项和隔离 MySQL 8.0.45 上八个模板 metadata/拒改检查另有证据。这些本地结果不替代真实 MySQL 8.4 验收。后续 backend443 原生回执已确认完整备份、四项 V2 迁移和固定四案 resolution 迁移 APPLIED，八个 V2 禁改触发器的实际 definer/body/metadata 已读验；backend444为无新增SQL的代码发布。实际依据分别保存在 `NATIVE-443-LATEST.json`、`NATIVE443-VERIFIED.json`和 `NATIVE-444-LATEST.json`。

## 7. 资源维护与发布排空

V2 worker 纳入现有 TEST 维护排空流程，复用现役资源预算、整机 20% 余量、CI 构建预算、3 GiB CI 门禁及发布恢复锁，不扩大现役发布可信文件集合。资源控制候选仅增加明确的 `uvel-compute-v2-worker.service` 与 `/var/lib/uvel-compute-v2`，DynamicUser 路径须按原规则验证到受控 private 目录。

逻辑激活与实际开算分开：1000 账号、每账号最多 6 个合法权益槽可形成 6000 个逻辑槽，不因 TEST 只有 6 个真实执行名额把第 7 个逻辑设备一概判为主机满载。每账号权益、所有权和原激活资格仍生效。v1 占用的执行资源与 v2 尚未退出的真实执行许可共用主机并发守门；v2 开算与 v1 资源申请按同一资源锁、有效容量快照和维护状态校验，共计不得超过当前预算上限（正常 TEST 为 6）。逻辑排队不能取得真实执行许可，独立校验器预算也不能冒充额外任务名额。

真实物理计数修正：首轮发现cohort外24台历史ACTIVE但闲置的逻辑设备被误计为physical，导致V2只ISSUED而未开算。V2新执行应按不同设备去重计入未收敛的V1 PROCESSING/UNKNOWN请求或真实未关闭execution manifest，再加V2 permits；无manifest的逻辑任务和闲置激活承诺不占物理槽。此调整不取消历史设备、不改其业务状态，原V1激活/替换的保守计数保持。无结果的EXPIRED/CANCELLED manifest仍占用，只有原受控终结响应或完整匹配的四案零收益裁决可关闭；真正完成的manifest由原事务提交的结果标记、COMPLETED任务和匹配已入账凭证关闭。计数只读轻量事实，不重读产物BLOB或在准入查询中重复资金验证。

V1首次NEXT按resource guard→owner→device顺序，与V2 reserve串行检查实际V1占用+V2 permits+新增一位，并在业务工作前提交PROCESSING intent；manifest/task与请求COMMITTED在原业务事务原子提交，不跨模型HTTP/MQ持这段锁。原exact COMMITTED重试不因drain重复借槽；合法ROLLED_BACK恢复若要新建工作仍重新准入，只有其精确仍存活原manifest可复用已有占用，新key不得借未知旧manifest。UNKNOWN身份、恢复授权及四案排除边界不变。该代码及真实MySQL并发/身份测试见`PHYSICAL-ADMISSION-FIX-REPORT.md`，相关修复已随446在TEST发布并实际继续派单；真实短窗口计数和资金结果见第8节，不以组件测试代替长期容量验收。

维护标记只阻止处于 `IDLE` 的 worker 开始一次新领取。已经落 journal 的 `CLAIM_INTENT`、计算、提交、校验及退出流程继续按原任务、代际和请求对账，保留必要心跳与原 journal，等待任务合法收敛；不能因 drain 把未知领取改回 IDLE、重做推理或跳过完成确认。资源控制须只读识别完整的六个 `runner-1.sqlite` 至 `runner-6.sqlite`，读取 WAL 和恢复历史并校验完整摘要；缺失、错误 schema、链接或摘要变化不得跳过。未被明确保护的 V2 journal 只有 `IDLE` 可以进入 READY；计算、提交、已验证但尚未退出和恢复状态均保持维护等待，不能把 UNKNOWN 泛化为可发布。旧 V1 的精确 protected journal 和恢复预算完全保留。

CI 维护 helper 默认只生成只读计划，明确 `enter/restore` 才改变维护资源态。进入前先快照发布 timer/service 的原状态，再由操作者显式暂停发布；使用原 graceful drain 等待 READY，不能直接 SIGTERM 旧 worker 阻断待提交完成。资源控制的 `resume-maintenance` 在保留 ready、matching drainId、无发布事务、backend 健康、精确 finalInventory/protected 等校验后，额外要求所有 worker inactive/MainPID0 和发布 timer/service 已停；先持久保存原 `receipt.services` 与 `workersKeptStopped=true`，再清本次匹配 marker，保持 worker 不启动。默认 `resume-release` 仍保留旧恢复义。禁止手改 receipt、泛清 marker；ACK 丢失后的残缺 marker 仍保持受控等待。

helper 进入前继续核对 TEST/root-isolated、原与新资源脚本 SHA、预算原文 SHA、所有预算 worker 已正常停止且 MainPID 为 0、原 protected 摘要一致、构建终结且 agent 空闲，以及没有旧发布/drain 事务。它持久保存预算原文、CI 限额和六个 fleet 模型的身份、限额、端口与模型摘要，只停同 ID 的六个 fleet 模型，保留基座校验器及其他业务承诺。CI 内存与 swap 硬限从 1 GiB 调整为 3 GiB，移除这六个已停止模型的预算项，维护 `maxActiveExecutors=1`、构建预算及各请求为 3 GiB，承诺总额由 24.5 GiB 变为 17.5 GiB；原资源 snapshot/admit-build 与整机 20% 余量门禁仍必须通过，不代发 Jenkins 构建。

helper 使用持久原始回执及精确归属的维护 HALTED 标记；专用 root-owned `maintenance-operation.lock` 以非阻塞独占 flock 覆盖整次 enter/restore，拒绝同一回执的并发交错。发布锁先于资源锁，Docker、模型健康与 snapshot 等等待不持有这两个短锁，不阻塞正常容量快照。任一失败保留证据和受控阻断，不能清除外来 hold 或改写旧 journal。恢复须确认构建终结、agent 空闲和无发布事务，按原回执恢复 CI 1 GiB、预算原始字节以及同 ID 六模型的原限额、端口和健康；未知 ACK 后也只用原回执续做恢复。worker 始终保持 inactive，由操作者按原发布流程显式恢复。发布 timer 仅在维护前快照为 active 时恢复；本轮现场原本 timer/service 均 inactive，维护后保留该状态，不自动启动发布。

后续App366准备时，现场helper已更新为`05d25f77…96a328`；独立差异复核确认只精确增加worker256MiB、observer24MiB承诺及相应维护总额，其他锁、原模型身份、journal、20%余量与构建准入不变。当前canary预算为24.7734375GiB，六模型停态维护预算17.7734375GiB，真实只读plan(ad2)已通过；不需要为前端构建先将后端切回disabled或重启。旧9259的RESTORED回执仍保留原字节，不能改写成新预算回执或用新decoded伪通过。20:01:50原graceful drain已READY，随后原resume-maintenance保持worker停态；observer正常SIGTERM证据保留。旧ee-pinned pause在首行版本断言拒绝，未写配置、未创建备份、未重启后端；后续归档、构建、发布及恢复须按新实际回执验收。

为下一次合法CI维护释放已终结旧回执的live名称，专用归档候选仅接受本轮固定RESTORED task/raw receipt、已审helper/resource及原预算SHA，默认只读plan。执行前重放恢复后的空闲/身份/限额/模型健康/旧journal及无事务条件，不调用可能清hold的restore。归档先持久manifest和原receipt同inode硬链，再移除原live名称；undo仅在同一原空闲基线且无新receipt/hold时恢复硬链，历史证据保留，不能覆盖新cycle或复用已undo旧cycle。整操作锁全程保持，耗时Docker/模型HTTP/CI遍历在发布/资源短锁外，最终短锁内再次核对原receipt/budget/holds/worker及原journal后落盘。该候选不改预算、模型、构建、worker或旧保护，仍须独立故障/恢复复核及操作者现场只读plan，不代表已执行归档。

归档工具最终pin为bda58c6e…08ff47，17项独立本地fixture通过，初稿长锁P1已修并关闭；Windows fixture对POSIX owner/mode/flock作明确适配，不作为主机权限验收。现场plan、archive/undo及后续新CI周期由根按实际回执执行，不因本地复核直接标完成。

首次启用V2前须备齐六个全新IDLE journal。专用准备脚本只导入已pin c856cb8e…e8c1e的worker.Journal，在相同DynamicUser/StateDirectory的private实体目录持原worker.lock排他锁；任何既有`*.sqlite*`均拒绝，不接触旧journal或运行worker main/HTTP/任务/资金。创建后确认runner-1至6精确集合、各state=IDLE且recovery_history为空，再由原resourcecontroller实际fingerprint确认六库IDLE才允许后续配置。执行前保持worker/observer inactive，Python隔离入口不使用优化以保留关键assert；中途部分创建保留现场并拒绝盲目重跑，不自动删库。

已 SQL 确认入账、且不再持有执行许可的任务热缓存采用 600 秒保留策略；过期后的任务、凭证及请求历史从 SQL 的原任务/事件/分摊回查，仍校验账号、部署范围、任务与代际，不因缓存缺失重新抽签、执行或结算。尚未落库、确认结果未知、受控挂起或尚未退出的原证据不因该热缓存到期主动清除；沿用未落库容量上限、执行许可和积压 5 分钟暂停新领等有界约束。SQL 历史与热缓存分层不扩大本轮 ASYNC_FLUSH/72 小时恢复保证。

新增独立脚本须先通过本地回归与根 Agent 差异复核，再由发布操作者安装并添加明确 worker 预算项；代码候选和本地测试不代表主机安装或维护排空已经验收。

App生产打包单独限制Node old-space，当前为1792MiB，沿用CI 3GiB硬限，为remoting和构建native内存留余量。App360的exit137已由CI cgroup/kernel证据定位为构建Node内存耗尽（anonRSS约2.58GiB），不是业务后端、V2模型或整机运行OOM；不因此扩大业务/CI预算或修改可信发布闭包。必须用原npm生产命令及`--base /app/`实际构建，并由新原生CI复验；本地堆限通过不等于CI cgroup或业务长稳通过。1536MiB实际heap不足后才按证据调整1792MiB，不再盲目提高。

1536MiB配置在App候选7680fa3e基础上的本机构建exit0、37.728秒，但原生CI361明确exit134：GC仍接近1495MiB后报V8 heap limit/Ineffective mark-compacts，证明Linux CI冷构建不适合该上限，与360的cgroup kill区分保留。仅将package脚本调至1792MiB后，本机同命令exit0、28.166秒，入口的/app/assets引用及文件存在；未改依赖、其它App源码/配置或总CI预算。根侧原生CI362实际成功，App源a1e05e60已发布TEST；这一构建适配结果不替代业务运行或长稳验收。

已安装且与lock一致的Vite5.2.8、Rollup4.14.3及Uni插件源码只读检查显示：Uni生产默认Terser，其worker池默认可用CPU数减一，后续可按实际阶段/进程证据评估`terserOptions.maxWorkers=1`；尚未应用。Rollup文件并发默认20；Uni默认warn日志会跳过Vite gzip大小报告，不把报告开关当成已证实OOM原因。更换压缩器或其它配置会另做产物/运行验证，不与本轮单行堆限修改混合。

App363/ff372877在`vue-tsc`阶段以V8 heap OOM/exit134失败，尚未执行H5打包；CI实际`NODE_OPTIONS`为2560MiB，与publisher256MiB、App360的cgroup kill和App361的打包heap失败分开留证。本地默认heap4288MiB下通过不代表CI适配。生产TS/Vue检查拆出测试入口，拆分时973个生产根文件（含327个Vue）全部保留、987个测试/辅助入口不再作为生产根；原完整`tsconfig.json`与`type-check:all`保留，定向行为测试另行执行。不降低编译规则、不跳过生产type、不提高预算；类型沿用CI2560MiB，1792MiB仅用于既有H5打包。本地受限2560检查与原79项行为通过后，App364实际原生type/pack成功（225493ms）；该实机结果不等于名称修复已部署或业务闭环通过。

后端发布前的全库备份必须满足现有资源门禁。backend440在备份期间触发MySQL自身3.5GiB cgroup OOM，当次四项V2 SQL未执行。根仅以`SET PERSIST`将buffer pool由2GiB调整为1.5GiB，未restart或提高容器cap；allocator跟踪分配减少约523.52MiB，但raw cgroup未下降，原raw-delta失败及reconciled证据保留，不能据此声称RSS下降。后续443原生流程已实际通过完整备份和迁移；不将440失败改写为当次成功。

backend442另因临时publisher被设256MiB上限，在STAGING阶段cgroup OOM，原437保持健康、当次0迁移/0切换。按精确raw transaction调用已核验原生`discard_staging`恢复，保留partial stage，不手删事务或rename旧stage。用户已明确取消临时publisher上限：443及444均使用 `MemoryMax=infinity`，443发布成功日志峰值约2.2GiB。此决定仅针对临时publisher，不扩展业务JVM、MySQL、模型、CI或worker限额，也不把publisher峰值当作业务运行容量。

独立资源observer只读采集10个固定目标，每60秒记录proc/cgroup、20%余量与loopback health；2h/24h marker仅表示资源窗口到达并带失败计数，不证明经济任务或财务一致。原fd691020…脚本的13项逻辑/故障fixture独立复验通过，marker写/sync失败明确fatal；健康URL修正版171170fe…已实际安装，unit仍为226d76b8…d6de6a27。根已读验2026-11-01T17:25:19Z首个60秒样本health=200、failure=0且20%余量通过；滚动快照`V2-OBSERVATION-LATEST.json`继续单独记录后续采样，不覆盖首样本事实。资源样本不证明24MiB/Tasks16全天峰值或2h/24h业务长稳。

## 8. 验收与暂未结论

定向测试计划为本任务 `TEST-PLAN.md` 的 C01–C31、C37–C71/FLOW01–04，以及 `CI-MAINTENANCE-TEST-PLAN.md` 的 C32–C36。前端自测覆盖配置边界、审批载荷、v1/v2兼容、权威协议、精确金额、空开始时间、预计不完成、账号/页面隔离、分组合并读及批次分页。资源维护追加service/root白名单、六journal完整性、WAL/恢复历史摘要、严格等待和旧保护预算回归；native固定八触发器及13集合/12不变另做权限、异常、恢复与独立复核。四案C49–C61/FLOW04已有真实双人终结与零收益证据，后续新经济任务仍PENDING；C62–C64保留publisher恢复/发布证据；C65–C69覆盖真实物理计数、NEXT共享guard及暂停恢复，C70–C71覆盖名称与追踪ID。各自的本地、CI、native和现场结果分开，不据旧取消或构建成功关闭整个流程。

历史分层证据：App fa67353d 定向86项及类型、PC 8280f431 定向21项及类型通过，后续必要构建由原生CI完成。读取/MyBatis22项、真实SQL/事件合同/生命周期36项、生命周期/架构116项、资源controller28项及CI helper17项分别留证，不能相加冒充端到端通过。桥接组合原301项中的顺序断言已修，最终桥接17项全过；缓存/物理容量/桥接/架构48项通过、0skip，包括真实Redis3项、真实MySQL容量及迁移4项、真实MQ/SQL1项。600秒缓存、旧请求SQL原单回查、未落库证据保留及仅阻IDLE的drain均有定向记录。CI helper整操作并发P1修复、resume-maintenance独立3项及根AST复核通过。这些证据不能替代当前部署后的真实经济闭环。

隔离协议压测覆盖1000账号、6000槽，3轮共3000次真实HTTP读取无错误；真实Redis、MyBatis、MySQL和服务容器参与，身份及旧所有权投影使用fixture，没有真实模型或资金入账。这不代表6000任务同时执行，也不能把旧查询压测数据挪作后来resolution SQL的压测结果。三个仓库仅进入test，未合并main。

历史发布记录：TEST此前已发布backend444/`817f2007957b85b241111603ad3f1736181d72ae`、PC280/`c79d4944a9d6c56c0f4deff70112d6595e3632ed`、App362/`a1e05e60c20245a56f430b9d30c929f50157acd4`。backend444完整CI报告为Tests run12705、Failures0、Errors0、1004项条件化skip，不能写成12705项均已执行通过；原生发布成功、无transaction/hold，publisher MemoryMax=infinity。依据为`BACKEND-BUILD-444-STATUS.json`与`NATIVE-444-LATEST.json`。

18:42阶段记录：backend445 CI已SUCCESS，产物源码`36567e3812f14b7b188d169748a4f52bbc3af9ad`，报告Tests run12718、Failures0、Errors0、1016项条件化skip（`BACKEND-BUILD-445-STATUS.json`），当时尚未native发布，App365也仅排队。后续名称已有实景结果；完整native回执及经济闭环由根统一归档，不能把构建成功、预期SHA或队列回执当作发布，仍核实际artifact与当时最新test。

当前发布与新经济窗口：backend446实际源码`9eae08a0da57c6709ad82a70deca714eb0748286`，worker SHA `25face7cf0ca549db3e9d5af27501ecfbe17cc9e0c29ec43b3e1adc6a5dfa22d`，于2026-11-01T19:46:18Z正常恢复V2；Hikari仍10。`V2-FINAL-OBSERVATION.json`在19:48:32Z记录SQL 46 VERIFIED、46 USDT分摊和3批共916微单位，合格五设备已到generation13并继续接单；资源sample elapsed120秒、health200、failureEvents0、reserve20PercentMaintained=true，窗口仅STARTED，尚无2h/24h完成marker。App实际发布仍365/`5b5fed335b8a1916e1bf05f7aa8ffae9d17ad553`，不能把后续source推送当已发布。

同窗口后续`V2-CONTINUOUS-OBSERVATION-1955.json`在19:56:08Z记录237 VERIFIED=237分摊、10个USDT批次共4785微单位。最新540秒资源样本health200、failureEvents0，10目标新增OOM为0、20%余量保持、MemAvailable9792827392字节；三主进程PID不变，旧五个recovery_history未增。一次心跳未确认和一次领取重试被正常记录，不能描述为没有任何重试。该连续窗口因App366正常维护结束并须完整保留，不能将暂停前后拼接为2小时或24小时无中断通过。

独立资金核对：`V2-MONEY-INDEPENDENT-REVIEW.json`对19:49:56Z快照给出PASS，3382字段断言通过、0失败/异常；73任务身份、冻结报价、真实receipt、ledger、earning一致，73 VERIFIED=73 allocations，4个USDT批次总1500微单位与同wallet/incarnation实际增量精确一致。该证据覆盖首次真实完成、分钟入账和继续接单，正UVT收益实景未覆盖；不能扩大为2h/24h或所有故障路径实机通过。

最终配置沿实际最高优先级`/srv/nexgrid/secrets/cloud-bge-executor.env`保留完整原JSON和同一root proof key，四案实际A2零收益预检通过后才落配置；不将低优先级backend.env当作生效源，也不记录密钥值。`V2-CANARY-CONFIGURED.json`记录预算SHA `ad2be8e7871799fbc9d183a491625a306d4451ace7d4a7795ba6e1cbce1c9136`、六个enrolled设备及其中1209保持停用；生效配置的Hikari上限为10。2026-11-01T17:24:19Z已配置启用并启动backend PID763366、worker764120、observer764125；17:25:52Z快照的六个runner journal仍全IDLE、无任务，服务active不算经济任务完成。

以上是首轮启用历史。因物理计数问题，随后仅有5项ISSUED、0项STARTED、无推理，worker六库保持IDLE。2026-11-01T17:52:16Z已正常停止worker/observer并保留首观察窗口证据，私有备份当前canary字节后恢复9259原预算及disabled配置，正常重启后端PID817846，实际JSON V2=false；5项ISSUED、MQ/Redis/SQL、原journal、四案A2和其他历史设备均保留（`V2-PAUSED-FOR-ADMISSION-FIX.json`）。首窗口只有资源观察，不是持续计算起点，不能续算2h/24h业务长稳；待新native门禁发布及正常恢复后重新确认真实经济起点。

资金before基线为`V2-MONEY-BEFORE.json`的2026-11-01T18:30:17Z实读：TEST事件5、VERIFIED=0、分摊0、结算批次0、pendingMicros=0。钱包原余额/代际/版本与每日UVT依据保留在原回执，后续必须逐事件、批次和真实流水比较；这些0只说明尚无新经济确权或入账，不能把ISSUED报价算收益。

Broker实际`autoCreateSubscriptionGroup=false`，须按正常mqadmin仅初始化专用`nexion-compute-v2-checkpoint-TEST`组。`MQ-GROUP-CREATED.json`记录17:33:22Z专用组创建成功及Broker配置未变，保留原ASYNC_FLUSH/72小时；这不等于已确认消费恢复、任务分配或首次分钟入账。

`REAL-SIX-CAPACITY.json`已给出六路真实BGE模型并发加一路独立validator的直接容量证据：7次执行29.74–31.22秒，3个输入各1024维向量均finite、模型/validator最大绝对差0；最低可用内存11014451200B，高于20%门槛6651609908B。该验证创建经济任务数为0，证明此次直接模型并发和内存余量，不代表派单、MQ确权、分钟结算、钱包或2h/24h业务运行已通过。

必须继续以实际 TEST 页面验证配置保存后重新进入回读、任务各状态、六槽合并刷新、待结算不可花费、批次与真实钱包一致。1000 账号 6000 槽协议负载与六路真实计算分别报告；每账号确定性错开秒数的不可变 60 秒封存窗口、批次目标 10 秒、积压暂停、20% 整机余量、2 小时和 24 小时长稳均需现场证据。没有真实执行不得标通过。MQ 按本轮 ASYNC_FLUSH/72 小时范围验收；延期增强不计未完成启用门禁，也不伪装已具备。

旧请求恢复显示与99%上限已完成Read/MyBatis34项、App九文件126项及类型检查，包括Home/Earn/设备详情/仓库实际Vue组件；原TEST SELECT与EXPLAIN留证精确四请求及账号/设备索引边界。这些只读修改没有改变原请求/资金/replay。后续真实四案A2无收益终结才解除其旧承诺，二者证据分开；旧任务不能因此被记为COMPLETED或POSTED。TEST App已实际看到未确认进度最多99%，新经济任务的状态、批次页面和短窗口钱包核对现已有独立实景证据，长期与正UVT覆盖仍分别待验。

四案E5入口53项定向、23项既有E5/A2回归及类型/生产构建，与capture/attest按6140固定manifest的13项独立fixture分别留证。之后PC280及正常maker/checker页面、四案真实退出签证和无收益裁决已有现场结果，不能把这些结果合并为新经济任务端到端通过。

名称检查分层保留：P62之前79项及类型检查通过；P62新source补两行stage名称修复后，7文件72/72相关检查通过、0skip（`app-task-name-p62-targeted.log`），包含新stage可见名称和仪表无障碍标签。数量为原79减8项旧日期结构用例再加1项新stage用例；旧8项因P62默认折叠历史尚未通过，未删除/跳过或迁就断言伪报全79通过。其未解决边界与本轮名称修复、364原生生产type/pack分别留证；App365名称页面已由根及独立只读复核确认。实际task-center历史默认折叠，正常点击展开可见两种配置名、2026/11/02当地日期与PENDING/POSTED状态；旧8个SSR用例仍直接渲染初始关闭状态，与P62交互前提不一致。没有改造或重跑这8项，也不能用单语言现场替代其Intl缺失/多语言/非法日期的全部断言。

后续专项：运行中实际时长读取改动通过隔离javac/JUnit的Read、Controller、Architecture共64/64，0skip（`read-actual-duration-tests.log`），覆盖有开始的五种运行投影、超预计仍NONE且报价不变、随Clock增长、未来起点0，以及已验证最终耗时不读当前Clock。未占共享Maven/SQL、未改冻结事件或资金；该读取修复已随446发布并取得实际秒数回读，组件断言与现场证据分别保留。worker另有HTTP错误来源保留修复19项本地用例：MODEL4xx不再被后续receipt4xx覆盖为后端错误，RECOVERY不因此重新推理/领取/退出，未知backend503保留原CLAIM_INTENT。它们是诊断/恢复边界证据，不代表模型HTTP400已解决或真实任务成功，checkpoint与实际物理收敛仍由根验收。

独立App读取验收见`APP-446-UI-READ-ACCEPTANCE.json`及同前缀截图/DOM：自有新标签复用3778登录态，正常Home→Earn→设备详情、历史展开、任务详情、收据、批次列表和20项子明细均可读取；长/短配置的当前名称与aria、真实运行秒数、长文最终7.191秒及配置2已见，待结算明确“暂不可提现或消费”，未进行领取、账号/停用、消费或提现操作。资金流水有明确标签的BGE-M3模型不在普通标题修订范围；显式任务/凭证/批次保留业务ID。曾观察V2收据CTR-3E37B39945964B378925240261F8BE8B执行时长0秒，根只读SQL证实真实间隔41195微秒、原整数秒字段取整0（`APP-446-RECEIPT-DURATION-AND-CI.json`），关闭为非本轮缺陷，不修改证据或伪造大于0耗时。

后续最小名称修订：独立现场发现Earn普通“今日最近完成”chip仍取done.model。已在最新origin/test ac456107基础只改done.type并新增真实模板行为回归，先red复现内部模型标识，再12/12 PASS、0skip；`128ede89a42ef2e47a386a12e792907e9ec05b51`正常推test，正式App仅FF两文件且4trackedWIP/.hbuilderx/153stash精确保留。保留远端英文产品label映射及所有客服/动画等并发改动，不改明确模型资金字段，不重复type/full。App366原生CI SUCCESS、223809毫秒，实际artifact源码128ede89、产物SHA256 `a4688f3dbab213ede9d713e4fa8d0186f9377dd6e9bdc39791ee3da5236aa70f`。2026-11-01T20:19:39Z正常restore-ci、native publish-uniapp、resume-workers全部exit0，publisher MemoryMax=infinity；backend446/PID1004534及原完整JSON、Hikari10和ad2预算保持，worker/observer已恢复。

App366现场名称验收：`APP366-NAMES-ACCEPTANCE.json`独立通过当前stage可见名称及aria、10个最近完成chip、Home两条当前作业均为Embedding，普通区无TEST_BGE_M3_V1或#CV2编号；主验另以手机尺寸页面实际切换UVELRack P1，看到Embedding、计算中、83%及预计5秒/实际1.079秒，并保存`APP-TASK-NAME-TEST-FINAL.png`。截图与DOM均取366当前页面，不挪用旧365证据。收益流水明确标注的模型和显式凭证业务编号仍保留。

此次维护正常排空后，以专用兼容归档保留旧3c050回执原字节及同inode，实际只读plan、archive及new05 enter/admit全exit0（`APP366-ARCHIVE-PLAN.json`、`APP366-ARCHIVE-ENTER-ADMIT.json`）；五项必要故障验证与根/独立复核分别留证。新CI周期a64e0dc84dc446eaa616926b4d2aa509正常恢复原ad2预算、CI1GiB和原六模型身份/限额，未改写旧回执冒充新decoded。`APP366-PUBLICATION-STATUS.json`记录native366、后端未重启、worker1068871/observer1068906正常恢复；此前观察六文件完整归档至window-before-app366-20261101，新2h/24h窗口从20:19:38Z重新开始，仍未通过长稳验收。

截至本节证据截止点，首次可信完成、两种输入真实执行、分钟USDT入账及五设备继续接单已有短窗口证据；正UVT收益实景、20%余量下2小时持续与24小时长稳仍PENDING。1209保持停用，不能自动重新激活以凑六路；1000账号/6000逻辑槽协议负载与真实执行并发仍分开报告。后续只按新的真实回执追加结论。
