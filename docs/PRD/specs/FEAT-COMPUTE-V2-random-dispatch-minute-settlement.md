# FEAT-COMPUTE-V2：随机派单、独立运行态与分钟结算

日期：2026-11-01。依据：本聊天用户批准的《设备算力任务优化计划书：随机派单、Redis 运行态、RocketMQ 可靠事件、分钟批量结算》，以及同日后发决定“先满足效率，暂不考虑可靠事件要求”。本规格适用于正式后端、管理端及 App 共用 H5 页面；H5 Lite 分支仍独立维护、发布。

状态：批准的功能合同与本轮实现口径。代码自测、TEST 部署、真实页面操作、资金验收、2 小时持续及 24 小时长稳必须分别留证，本文不代表这些验收已通过。

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

Home、Earn、设备详情页面可见且 App 在前台时，每 3 秒合并读取六槽任务；复用账号代际、页面可见与运行配置隔离，同一请求合并。隐藏页面/后台停止快速读取；不加速手机运行信号写入和整舰队/钱包读取。切换账号及同账号重新绑定立即清理待结算、批次、详情；旧账号或旧页面的迟到响应不得写入新页面。

停止新派单后，TEST 所属已到账结算历史继续可读，不依赖 admission 开关。App 即使回到 v1 任务投影，仍可读取该账号的 v2 已到账批次；未启用该接口的旧服务仅明确 404/501 隐藏入口，认证、网络及服务错误保持可见。

## 6. 配置迁移时机

后端首次启用新 E2 字段前应用 `20261101_compute_v2_task_policy.sql` 与 `20261101_compute_v2_reward_precision.sql`；既有启动 `ensureSchema` 同步创建策略表并将任务奖励列补齐为 `DECIMAL(18,6)`。新字段缺省仍按旧配置默认，不要求旧测试构造器提供新 mapper。18,5 改为 18,6 后整数位由 13 位变为 12 位，存在超界旧值时拒绝迁移，不能截断或回填业务奖励。新输入同时限制 12 位整数、6 位小数；策略设置和创建/修改前后值进入 A2 审计。

V2 结算四表的 UPDATE/DELETE 禁改由八个固定触发器约束。实际 native 迁移门禁已拒绝这批未审程序，拒绝发生在 SQL 执行前；不得关闭普通存储程序门禁、手工执行仓库 SQL 或借用宽泛 root 权限绕过。此次新增专用准入只接受 `20261101_compute_v2_settlement.sql` 的固定文件 SHA、八段精确 offset/length/hash 与固定名称/表/事件/触发体；其他程序仍拒绝，既有 Cregis、support、H4 准入和权限保持。

固定 lane 的独立开关 `allow_fixed_compute_v2_trigger_install` 默认 false。经本轮固定范围复核后，仍须在任何 hold、备份和 DDL 前核对 app/root 身份、MySQL 版本、binlog/ROW、字符集及现有 grants；不得为本次任务扩大 grants 或改变其他审批开关。app 仅执行已审普通表 DDL，root 仅安装固定 definer 的八个已钉住 CREATE 片段，前置拒绝已有或部分对象、逐项及最终核对 metadata。数据库 DDL 不具备整批事务回滚语义；SQL 或确认结果未知后保留 SQL_FAILED/启动阻断与原备份/回执，不自动重跑、补删触发器或伪造历史 APPLIED。

迁移准入代码通过独立固定更新器纳入 native 发布：可信文件集合仍为原 13 个，仅替换 `database_migrations.py`，其他 12 个字节 pin 不变；同时验证实际 `0794fa15…` 旧源、完整旧闭包、stage 完整闭包与唯一新候选 pin。更新只处理该源及其 config/runtime-lock pin，并仅新增本轮已明确批准的专用 lane flag=true；其余原审批、外部/job/JAR policy、状态、启动 guard 和秘密保留。故障按原字节/权限恢复并复核完整旧闭包，不能清迁移/发布 hold 放行。候选、自测、跨 Agent 复核、主机更新与实际 SQL 迁移分别留证，所有主机和部署操作由根统一执行。

固定 lane 独立本地安全/故障检查 13 项、更新器独立 30 项通过，未发现具体 P0/P1；旧准入回归 73 项和隔离 MySQL 8.0.45 上八个模板 metadata/拒改检查另有证据。后者不代表生产所限 MySQL 8.4 的实际权限/能力或 native 安装已验收，仍需根从真实闭包更新、备份与实际发布回执核验。

## 7. 资源维护与发布排空

V2 worker 纳入现有 TEST 维护排空流程，复用现役资源预算、整机 20% 余量、CI 构建预算、3 GiB CI 门禁及发布恢复锁，不扩大现役发布可信文件集合。资源控制候选仅增加明确的 `uvel-compute-v2-worker.service` 与 `/var/lib/uvel-compute-v2`，DynamicUser 路径须按原规则验证到受控 private 目录。

逻辑激活与实际开算分开：1000 账号、每账号最多 6 个合法权益槽可形成 6000 个逻辑槽，不因 TEST 只有 6 个真实执行名额把第 7 个逻辑设备一概判为主机满载。每账号权益、所有权和原激活资格仍生效。v1 占用的执行资源与 v2 尚未退出的真实执行许可共用主机并发守门；v2 开算与 v1 资源申请按同一资源锁、有效容量快照和维护状态校验，共计不得超过当前预算上限（正常 TEST 为 6）。逻辑排队不能取得真实执行许可，独立校验器预算也不能冒充额外任务名额。

维护标记只阻止处于 `IDLE` 的 worker 开始一次新领取。已经落 journal 的 `CLAIM_INTENT`、计算、提交、校验及退出流程继续按原任务、代际和请求对账，保留必要心跳与原 journal，等待任务合法收敛；不能因 drain 把未知领取改回 IDLE、重做推理或跳过完成确认。资源控制须只读识别完整的六个 `runner-1.sqlite` 至 `runner-6.sqlite`，读取 WAL 和恢复历史并校验完整摘要；缺失、错误 schema、链接或摘要变化不得跳过。未被明确保护的 V2 journal 只有 `IDLE` 可以进入 READY；计算、提交、已验证但尚未退出和恢复状态均保持维护等待，不能把 UNKNOWN 泛化为可发布。旧 V1 的精确 protected journal 和恢复预算完全保留。

CI 维护 helper 默认只生成只读计划，明确 `enter/restore` 才改变维护资源态。进入前先快照发布 timer/service 的原状态，再由操作者显式暂停发布；使用原 graceful drain 等待 READY，不能直接 SIGTERM 旧 worker 阻断待提交完成。资源控制的 `resume-maintenance` 在保留 ready、matching drainId、无发布事务、backend 健康、精确 finalInventory/protected 等校验后，额外要求所有 worker inactive/MainPID0 和发布 timer/service 已停；先持久保存原 `receipt.services` 与 `workersKeptStopped=true`，再清本次匹配 marker，保持 worker 不启动。默认 `resume-release` 仍保留旧恢复义。禁止手改 receipt、泛清 marker；ACK 丢失后的残缺 marker 仍保持受控等待。

helper 进入前继续核对 TEST/root-isolated、原与新资源脚本 SHA、预算原文 SHA、所有预算 worker 已正常停止且 MainPID 为 0、原 protected 摘要一致、构建终结且 agent 空闲，以及没有旧发布/drain 事务。它持久保存预算原文、CI 限额和六个 fleet 模型的身份、限额、端口与模型摘要，只停同 ID 的六个 fleet 模型，保留基座校验器及其他业务承诺。CI 内存与 swap 硬限从 1 GiB 调整为 3 GiB，移除这六个已停止模型的预算项，维护 `maxActiveExecutors=1`、构建预算及各请求为 3 GiB，承诺总额由 24.5 GiB 变为 17.5 GiB；原资源 snapshot/admit-build 与整机 20% 余量门禁仍必须通过，不代发 Jenkins 构建。

helper 使用持久原始回执及精确归属的维护 HALTED 标记；专用 root-owned `maintenance-operation.lock` 以非阻塞独占 flock 覆盖整次 enter/restore，拒绝同一回执的并发交错。发布锁先于资源锁，Docker、模型健康与 snapshot 等等待不持有这两个短锁，不阻塞正常容量快照。任一失败保留证据和受控阻断，不能清除外来 hold 或改写旧 journal。恢复须确认构建终结、agent 空闲和无发布事务，按原回执恢复 CI 1 GiB、预算原始字节以及同 ID 六模型的原限额、端口和健康；未知 ACK 后也只用原回执续做恢复。worker 始终保持 inactive，由操作者按原发布流程显式恢复。发布 timer 仅在维护前快照为 active 时恢复；本轮现场原本 timer/service 均 inactive，维护后保留该状态，不自动启动发布。

为下一次合法CI维护释放已终结旧回执的live名称，专用归档候选仅接受本轮固定RESTORED task/raw receipt、已审helper/resource及原预算SHA，默认只读plan。执行前重放恢复后的空闲/身份/限额/模型健康/旧journal及无事务条件，不调用可能清hold的restore。归档先持久manifest和原receipt同inode硬链，再移除原live名称；undo仅在同一原空闲基线且无新receipt/hold时恢复硬链，历史证据保留，不能覆盖新cycle或复用已undo旧cycle。整操作锁全程保持，耗时Docker/模型HTTP/CI遍历在发布/资源短锁外，最终短锁内再次核对原receipt/budget/holds/worker及原journal后落盘。该候选不改预算、模型、构建、worker或旧保护，仍须独立故障/恢复复核及操作者现场只读plan，不代表已执行归档。

归档工具最终pin为bda58c6e…08ff47，17项独立本地fixture通过，初稿长锁P1已修并关闭；Windows fixture对POSIX owner/mode/flock作明确适配，不作为主机权限验收。现场plan、archive/undo及后续新CI周期由根按实际回执执行，不因本地复核直接标完成。

首次启用V2前须备齐六个全新IDLE journal。专用准备脚本只导入已pin c856cb8e…e8c1e的worker.Journal，在相同DynamicUser/StateDirectory的private实体目录持原worker.lock排他锁；任何既有`*.sqlite*`均拒绝，不接触旧journal或运行worker main/HTTP/任务/资金。创建后确认runner-1至6精确集合、各state=IDLE且recovery_history为空，再由原resourcecontroller实际fingerprint确认六库IDLE才允许后续配置。执行前保持worker/observer inactive，Python隔离入口不使用优化以保留关键assert；中途部分创建保留现场并拒绝盲目重跑，不自动删库。

已 SQL 确认入账、且不再持有执行许可的任务热缓存采用 600 秒保留策略；过期后的任务、凭证及请求历史从 SQL 的原任务/事件/分摊回查，仍校验账号、部署范围、任务与代际，不因缓存缺失重新抽签、执行或结算。尚未落库、确认结果未知、受控挂起或尚未退出的原证据不因该热缓存到期主动清除；沿用未落库容量上限、执行许可和积压 5 分钟暂停新领等有界约束。SQL 历史与热缓存分层不扩大本轮 ASYNC_FLUSH/72 小时恢复保证。

新增独立脚本须先通过本地回归与根 Agent 差异复核，再由发布操作者安装并添加明确 worker 预算项；代码候选和本地测试不代表主机安装或维护排空已经验收。

App生产打包单独限制Node old-space，当前为1792MiB，沿用CI 3GiB硬限，为remoting和构建native内存留余量。App360的exit137已由CI cgroup/kernel证据定位为构建Node内存耗尽（anonRSS约2.58GiB），不是业务后端、V2模型或整机运行OOM；不因此扩大业务/CI预算或修改可信发布闭包。必须用原npm生产命令及`--base /app/`实际构建，并由新原生CI复验；本地堆限通过不等于CI cgroup或业务长稳通过。1536MiB实际heap不足后才按证据调整1792MiB，不再盲目提高。

1536MiB配置在App候选7680fa3e基础上的本机构建exit0、37.728秒，但原生CI361明确exit134：GC仍接近1495MiB后报V8 heap limit/Ineffective mark-compacts，证明Linux CI冷构建不适合该上限，与360的cgroup kill区分保留。仅将package脚本调至1792MiB后，本机同命令exit0、28.166秒，入口的/app/assets引用及文件存在；未改依赖、其它App源码/配置或总CI预算。根侧原生CI362实际成功，App源a1e05e60已发布TEST；这一构建适配结果不替代业务运行或长稳验收。

已安装且与lock一致的Vite5.2.8、Rollup4.14.3及Uni插件源码只读检查显示：Uni生产默认Terser，其worker池默认可用CPU数减一，后续可按实际阶段/进程证据评估`terserOptions.maxWorkers=1`；尚未应用。Rollup文件并发默认20；Uni默认warn日志会跳过Vite gzip大小报告，不把报告开关当成已证实OOM原因。更换压缩器或其它配置会另做产物/运行验证，不与本轮单行堆限修改混合。

后端发布前的全库备份也必须满足现有资源门禁。backend440在备份期间触发MySQL自身3.5GiB cgroup OOM，四项V2 SQL尚未执行，不能记成迁移后回滚或部署成功。根仅以`SET PERSIST`将buffer pool由2GiB调整为1.5GiB，未restart或提高容器cap；allocator跟踪分配减少约523.52MiB，但raw cgroup未下降，原raw-delta检查失败记录保留并reconciled。不能据allocator变化声称RSS、raw cgroup或备份余量已经改善；调优后的full backup仍待实际验证。已暂存release不重命名、不冒充新构建：440重试被`RELEASE_ALREADY_STAGED`拒绝后，按原流程准备新的441构建和完整发布回执。

独立资源observer候选只读采集10个固定目标，每60秒记录proc/cgroup、20%余量与loopback health；2h/24h marker仅表示资源窗口到达并带失败计数，不证明经济任务、财务一致或业务长稳通过。最终script pin为fd691020…552c70f4、unit226d76b8…d6de6a27，13项本地fixture独立复验通过；marker写入或sync失败明确fatal，不被后续成功返回掩盖。24MiB/Tasks16实际峰值及systemd权限仍须现场确认，不把fixture或已审候选等同安装/长稳。

## 8. 验收与暂未结论

定向测试计划为本任务 `TEST-PLAN.md` 的 C01–C31、C37–C61/FLOW01–04，以及 `CI-MAINTENANCE-TEST-PLAN.md` 的 C32–C36。前端自测覆盖配置边界、审批载荷、v1/v2 兼容、权威协议、精确金额、空开始时间、预计不完成、账号/页面隔离、分组合并读及批次分页。资源维护追加 service/root 白名单、六 journal 完整性、WAL/恢复历史摘要、严格等待和旧保护预算回归；native 固定八触发器准入及 13 集合/12 不变更新器另做权限、异常、恢复与跨 Agent 复核。固定四案无收益终结的C49–C61/FLOW04覆盖精确身份、真实退出、零副作用、双人A2、并发/ACK、原证据不变、精确资源释放及后续真实新任务；完整现场流程仍为PENDING。构建和类型检查单独记录。

当前证据是分层自测及隔离组件验证。整合最新 test 后，App fa67353d 定向 86 项及类型检查、PC 8280f431 定向 21 项及类型检查通过；此前生产构建通过，最终部署仍须由原 CI 构建。读取/MyBatis 22 项、真实 SQL/事件合同/生命周期 36 项、生命周期/架构 116 项、资源 controller 28 项及 CI helper 17 项有独立分层记录，不能相加冒充端到端通过。桥接组合原 301 项中的顺序断言已修，最终桥接 17 项全过；最新缓存/物理容量/桥接/架构门禁共 48 项通过、0 skip，包括真实 Redis 3 项、真实 MySQL 容量及迁移 4 项、真实 MQ/SQL 1 项。600 秒缓存回收、旧请求 SQL 原单查回、未落库证据保留与只影响 IDLE 的 drain 均有新增定向记录。CI helper 的整操作并发 P1 已修，独立交错/锁复核通过；新增 resume-maintenance 独立 3 项及根 AST 差异复核通过，原默认恢复逻辑保留。

隔离协议压测覆盖 1000 账号、6000 槽，3 轮共 3000 次真实 HTTP 读取无错误；真实 Redis、MyBatis、MySQL 和服务容器参与，身份及旧所有权投影使用 fixture，没有真实模型或资金入账。这项结果不代表 6000 个任务同时执行。代码已进入三个仓库的 test，未合并 main。TEST已发布App362/a1e05e60和PC279/3f0；backend440/b5的完整12710项测试通过，但全库备份OOM阻止发布，当前后端仍437，四项V2 SQL未执行，后台配置及V2 worker尚未启用。原UNKNOWN证据保持；不能将前端发布、构建通过或状态文案当作槽已收敛、经济任务恢复或长稳通过。

`REAL-SIX-CAPACITY.json`已给出六路真实BGE模型并发加一路独立validator的直接容量证据：7次执行29.74–31.22秒，3个输入各1024维向量均finite、模型/validator最大绝对差0；最低可用内存11014451200B，高于20%门槛6651609908B。该验证创建经济任务数为0，证明此次直接模型并发和内存余量，不代表派单、MQ确权、分钟结算、钱包或2h/24h业务运行已通过。

必须继续以实际 TEST 页面验证配置保存后重新进入回读、任务各状态、六槽合并刷新、待结算不可花费、批次与真实钱包一致。1000 账号 6000 槽协议负载与六路真实计算分别报告；每账号确定性错开秒数的不可变 60 秒封存窗口、批次目标 10 秒、积压暂停、20% 整机余量、2 小时和 24 小时长稳均需现场证据。没有真实执行不得标通过。MQ 按本轮 ASYNC_FLUSH/72 小时范围验收；延期增强不计未完成启用门禁，也不伪装已具备。

追加的旧请求恢复显示与 99% 上限已完成定向组件检查：Read/MyBatis 34 项、App 九文件 126 项及类型检查通过；后者包括真实 Vue 组件的 Home、Earn、设备详情和仓库恢复展示，组件 fixture 同步既有 V2 状态子组件和页面生命周期接口。根侧只读 TEST SELECT 准确返回四条旧 COMPLETE/PROCESSING，按业务时间已陈旧超过六小时；EXPLAIN 使用账号状态、设备及请求任务索引，无全表扫描。这些是读取与显示证据，未改变请求状态、原执行/资金或重放权限。根已在TEST App实际看到未确认任务最多99%，但四个legacy槽仍未收敛，后端新读取投影尚待441发布后的实读验证；本轮修复不能标完成，更不能宣称四槽已恢复/已结算。

四案E5入口已完成53项定向、23项既有E5/A2回归及最终类型/生产构建，本地组件用例包含权限/eligible、proof和epoch变化、账号切换、迟到响应、待审批回显与丢失响应复用同一幂等键。最终capture/attest工具按6140固定manifest绑定四execution及原journal，独立13项fixture和源码复核通过。以上只证明候选代码与取证工具边界；PC280、正常maker/checker实际页面、四案真实退出签证/原子裁决、取消后逐条释放和新经济任务分钟到账尚待根统一部署验收，不能与本地通过混合计数。
