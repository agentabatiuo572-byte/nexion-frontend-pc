# FEAT-COMPUTE-V2：随机派单、独立运行态与分钟结算

**2026-11-03 英文任务目录。** E2 任务列表只展示版本化的规则任务。六个类别各有 50 个不同的英文名称，例如 `image gen` 和 `image gen - watercolor portrait`。旧的按项市场单价留在市场定价和历史记录中。设备每次按商品已获准的大类，从在本单开始时已发布、已启用的具体任务中等概率抽取一项。每一类的 50 项沿用原类别的时长、奖励及币种。已开始的任务与历史凭证使用派发时冻结的名称。商品范围与任务名称分别维护，改名不会改变派发资格。

PC 管理端 E1 的“新增商品”“编辑商品”和“手机类别可跑任务”只勾选六个大类：向量计算（EM）、语音处理（SP）、图像生成（IG）、大模型推理（LL）、模型微调（FT）、视频生成（VG）。商品回显自己的 `allowedTaskClasses`，手机回显手机策略。E2 维护各类的具体任务、时长、奖励和启停。商品与手机策略经现有审批发布后持续授权所选大类；例如 Pro 已勾图像生成，E2 发布并启用第 51 个图像任务后，它自动参与后续派单，无需再发布 Pro。停用会移出候选，改类后按新大类判断；所有获准大类都无启用任务时等待配置，同类新任务启用后恢复。每个具体候选等概率，正在运行的任务仍按派发时的快照结算。

E1 商品管理首页的手机卡片在标题旁显示当前版本。六个大类在宽屏并排，窄屏自动换行。选中项以主题色和勾号标识，说明和「提交发布」位于卡片底部。

首次切换保留既有任务、凭证和按任务 ID 发布的历史版本；当前整类配置生成新的生效版本，草稿仅转换为草稿。历史补算按当时有效的版本取数。无法无损归类的当前配置会阻止迁移，避免意外扩大派发范围。

> 2026-11-03 最新进度：当前唯一实施与验收依据为 [设备模拟任务低负载方案（uvel-docs 22）](https://github.com/agentabatiuo572-byte/uvel-docs/blob/main/handoffs/2026-10-28/app/22-simulated-tasks-low-load.md)。本文第 1–10 节保留为过渡方案与历史证据，不能继续作为新任务实施合同；第 10 节 RULE_CYCLE 已被替代。
>
> 新方案同时覆盖手机与 IDC：SQL 保存任务、适用时刻配置与结算，Spring 共享调度推进；手机由当前安装确认在线并维持一小时有效区间，IDC 独立运行。后台 E2 发布固定整数分钟时长、固定基础奖励、资产与启停；E1 商品型号及手机类别勾选 `taskClass`，服务端在已选大类的启用任务中等概率抽取，无权重或独立等级体系。类型、商品、E3 采用追加历史版本，按任务逻辑开始时刻取适用版本，缺失明确报错；在途任务冻结原快照，旧真实任务与凭证按原路收尾。普通用户页面不新增测试提示。
>
> 本轮配置实现沿现有 E1/E2/A2 权限、商品发布及乐观锁入口；手机仅维护现有 `phone` 类别策略，不伪造硬件商品、订单或付费资格。商品草稿不会发布任务策略，上架须至少选择一个完整且启用的类型；类型后续停用造成空池时等待配置。公共 TEST 已部署 #451，手机＋五台 IDC 首笔资金链及真机任务／凭证 UI 主链 PASS；版本冲突、其他型号／全部类型、UVT 日奖、公共后台一小时和完整恢复仍属未覆盖范围。硬件策略键为 `product_no`（E1 `skuId`），订单／置换按同值写入设备 `product_code`；手机固定 `phone`。初始类型及商品／手机范围已通过正常 MFA／A2 配置，迁移不 seed 时长、奖励或历史版本。
>
> 币种统一：本轮新模拟类型的配置、API、E2 和手机策略仅使用 `USDT|UVT`。已有类型历史中的 NEX 原值不重写，读取时兼容为 UVT；追加 `20261102_simulated_task_policy_uvt_asset.sql` 扩展配置历史表约束，旧迁移字节、金额、账本约束及 `nex_available`／`reward_nex` 等内部列保持兼容。本文后续历史章节不据此追改原始事实。
>
> 2026-11-03 隔离复验：后端 `a223d645`／Jenkins #451 构建通过。SIM／V2 的 `device.deactivated` 已修复为 revision 315 canonical 6 字段，保留审计和旧任务证据；手机到期边界、重连不补空窗、中途到期、立即停止以及 IDC 积压后停止实际 PASS。14 个连续补算周期的任务、凭证、流水、收益事件和资金操作各 14，钱包增量与 24 个资金分录闭合。零奖励单任务主链 PASS，有凭证但无钱包流水、收益入账事件或资金分录，原正金额约束保持启用；UVT-only 无 USDT 零金额流水。
>
> 公共 TEST 切换：用户已明确授权 #451 部署、迁移、自行合理配置、启用 SIM、停止旧派单并收尾旧任务，覆盖此前“正式配置随后自行填写”的暂停安排。backend `a223d645371a54a5133ef17d155199b08920ff28` 已部署，policy／policy_uvt_asset／runtime／runtime_recent_read_index 四项 20261102 迁移已完成；6 新类型及 7 项商品／手机范围配置已完成 13 项双管理员正常 MFA／A2 审批。实际时长为 10／10／20／20／30／30 分钟，基础奖励依 EM／SP／IG／LL／FT／VG 为 0.001319／0.012570／0.347222／0.388889／2.062500／3.437500 USDT；允许类型数 phone／cloud-share 各 1、S1 2、Pro 3、Pro-v2 4、P1 5、P2 6，具体 ID 及配置表见唯一文档 22。
>
> E3 前长期日收益期望依 1–6 类型范围为 0.189936／1.000008／12.999996／18／45／75 USDT，按 `sum(奖励)/sum(分钟)×1440` 计算，不是日到账保证；cloud-share 原 3 UVT／日保持。P2 仍 off 草稿且无当前活跃设备，hd1／finite503 历史测试商品无当前活跃设备，未修改。
>
> 公共手机自然周期链 PASS：手机 1383 经 HBuilder CLI／onshow 启动 `SIM-00F26D8478FE454BA78F9E6DC140EB4C`；业务时间 UTC+8 开始 00:52:55.414772、到期 01:02:55.414772、入账 01:03:20.023576，USDT 0.001319，receipt CREDITED／proof NULL，ledger／earning／fund operation 各 1；钱包增量 0.001319 USDT，UVT 不变，version／fund revision 各 +1。
>
> 最新用户裁决“把旧的直接删除，重新接新的任务”已按取消移除未结算队列执行：34 V1 CANCELLED，5 未 STARTED V2 追加 FAILED；39 对象无资金／执行／UNKNOWN 等关联，整个 wallet row hash 不变，原件／触发器／18 个事件（含 5 VERIFIED 原批次）保留。最终 PID 3626775 为 SIM=true、V2=false、test-cloud=false；全局 legacyUnresolved／v2Unexited／verifiedAllocationInvalid 均 0，四 protected case 各 1，5 IDC＋phone 均新 SIM RUNNING 无 error。原冲突事件及 MQ／Redis 坏重放保留停用，未改 seen、清 key 或跳 offset，未新增隔离功能。
>
> 四台 IDC 首笔 10 分钟公共链 PASS：1204／SP 0.012570 USDT，1208／1212／1214 的 EM 各 0.001319，合 0.016527；各 task／receipt／ledger／earning／fund operation／leg 为 1，journal USDT delta=quote，proof NULL；UTC+8 到期 01:33:18.460647、入账 01:33:26.02～.128。旧 3 运行模型 UTC 17:33:16 已先行停止，9 容器 restart=no；独立 ollama 11434／RAG 8010 未动。真机已实操新任务 64%→94%→新周期及凭证列表／详情已入账 +0.001319 USDT，截图 `artifact/native-debug-20261103/new-rule-task-receipt.png`，UI 主链 PASS。
>
> 第五台云补验 PASS：P1／1210 的 LL 首笔 20 分钟任务 `SIM-89636B168C374E089FCA5AEE889D56FA` 已 COMPLETED／CREDITED 0.388889 USDT，UTC+8 到期 01:43:18.460647、入账 01:43:31.042963；receipt／ledger／earning／fund operation 各 1，journal delta=quote，proof NULL。五 IDC 首笔共 0.405416 USDT，实际覆盖 EM／SP／LL，不外推 IG／FT／VG 或 UVT 日奖。最终时点新 RUNNING 27／COMPLETED 27／errors 0、用例账号 6 台设备 RUNNING，仅属时间观测，非压测。
>
> 永久退役实际 APPLY exit 0：retirement `b07f8aea51924a33a182362253ca0aa4`，drain `c5582f4afe0e45ebb9c65ea33a326fec` 经原 resume-maintenance 正常关闭，回执 `/var/lib/uvel-task-control/compute-retirement.json` SHA256 `cf920ab9a76f42bfa72869c1f050febd11645daf918ba9d0d3517ab4e59c5767`；committed 26600275968→15032385536 bytes，3 worker＋observer 永久条件停用，原 journal 只读封存。客服资金汇总 503、1000 用户压测未跑、其他型号／全类型及公共后台一小时等未覆盖限制继续保留，不宣称全量或 prod 验收通过。
>
> 最终运行门禁：3 worker disabled／PID 0，observer static／PID 0 且条件 block，独立 ollama／RAG healthy；allowNewActivations=true、draining=false、HALTED absent。旧 CI maintenance 只读 plan exit 1／`COMPUTE_PERMANENTLY_RETIRED` 为预期拒绝，未尝试 restore。


日期：2026-11-01；TEST 进度更新：2026-11-02（现场回执使用 UTC）。依据：本聊天用户批准的《设备算力任务优化计划书：随机派单、Redis 运行态、RocketMQ 可靠事件、分钟批量结算》，以及同日后发决定“先满足效率，暂不考虑可靠事件要求”。本规格适用于正式后端、管理端及 App 共用 H5 页面；H5 Lite 分支仍独立维护、发布。

2026-11-02 后发决定：本轮新云端任务改用 E2 六类配置驱动的服务端规则周期，手机继续真实本机执行，合同与验收矩阵见第10节。第1–9节的模型安装、真实执行、独立模型验真与进程退出要求保留用于原模型模式及已冻结在途任务；不能据此把新规则周期写成真实模型执行。第9节及产品日志保留此前阶段证据，本轮规则周期候选尚未部署、未完成验收，也未发布 prod。

既有业务发布基线（本批增量见第9节）：TEST已发布backend446/9eae08a0、App366/128ede89和PC280。App366于2026-11-01T20:19:39Z完成正常发布和任务恢复，后端PID1004534未重启；普通当前作业、无障碍名称、最近完成chip及Home当前作业均实际复验为产品名称Embedding，无内部执行器标识或普通任务编号。首轮5项ISSUED/模型OOM/RECOVERY及暂停均保留为历史；19:49:56Z快照73项VERIFIED=73分摊、4个USDT批次共1500微单位，独立资金复核3382项字段断言通过、0异常，随后19:56:08Z已达237任务/10批次4785微单位。两种真实输入、运行/完成秒数、PENDING/POSTED历史和批次已有实景证据，540秒资源窗口0新增OOM且20%余量保持；该窗口在正常前端维护后另起，不拼接计时。正UVT实景、2小时/24小时长稳仍PENDING，不能把短窗口成功当作全量验收。

## 1. 边界与权威

- 管理能力为 1000 个账号、每账号最多 6 个权益槽，共 6000 槽。权益槽数量不等于真实推理并发；现有 TEST 单机真实执行上限为 6，按资源预算调度，共用一个执行引擎，不新增分布式算力池。
- 此前 V2 业务上线仅具备 BGE 执行能力；本批五类新云端模型服务已实跑独立校验，但新业务后端尚未部署，接入和验收以第9节分别记录。六类任务配置可维护，不代表相应模型已安装或业务已启用。未安装、能力不符、禁用、暂停、kill 或无资格的候选不得派发；不能用计时器、Mock 或固定成功替代真实执行。
- 任务、收益、钱包、凭证、配置版本均由服务端决定。普通任务展示和 H5 只读取；本批 Android 本机执行入口见第9.3节，不能由客户端直接写收益。预计进度达到 100% 不触发任何资金或任务状态迁移。
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

算力证明的列表收益、详情主额及USDT/UVT收益分项按接口实际金额显示完整有效小数位，不固定两位或六位，不舍入、不截断、不人为补零。例如 `0.00002` 显示五位、`0.12` 显示两位、`0.000027` 显示六位；整数不补 `.00`。仅改变这些算力证明的金额展示，钱包、支付和账本数值及其他页面默认格式不变。

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

## 9. 2026-11-02 增量：六类真实执行与手机本机 EM

本节记录原真实模型模式的实现合同及阶段历史；后续手机56单与backend450/App367进展见9.7，本轮新云端规则周期见第10节。五项新云端配置的 E2/A2 审批与回读、五类真实模型执行/独立校验、手机 ARM 整模型预验已有本批证据；云端六类真实模型完整经济闭环与长稳验收仍为 **PENDING**，不能用新规则周期替代该证据。第 1、5 节旧版“App 仅只读”的适用范围由本节的原生手机入口更新；H5、普通任务展示和钱包读取仍只读。第 1 节“仅 BGE 已部署”以及第 8 节历史发布、测试数量和短窗口结论均属于此前版本，不能作为本批六类或手机端到端通过的证据。

### 9.1 真实模型及可观察产物

| 类别/执行位置 | 真实模型与冻结版本 | runtimeKey / validatorKey（必须相同） | 必须完成的工作及产物 |
|---|---|---|---|
| IG / CLOUD | `nota-ai/bk-sdm-tiny`，`0364108e53b7f7f4d2585e817a0b7a83dc261cfa` | `bk-sdm-tiny-image-v1` | T4 上真实扩散生成 PNG；核任务绑定、像素内容、尺寸、摘要及独立模型重算 |
| VG / CLOUD | 同一正式 BK-SDM 权重版本，Text2Video-Zero 流程 | `bk-sdm-tiny-video-v1` | 生成有时序变化的多帧 MP4；独立解码、帧数/帧率/内容检查及模型重算，不接受静帧循环或修改扩展名 |
| LL / CLOUD | `HuggingFaceTB/SmolLM2-135M-Instruct`，`12fd25f77366fa6b3b4b768ec3050bf629380bac` | `ll-smollm2-135m-instruct-v1` | CPU 真实 greedy token 生成；`tokens.json` 包含真实 token IDs、文本及输入/输出用量 |
| FT / CLOUD | 同一 SmolLM2 135M 正式预训练基座及版本 | `ft-smollm2-135m-lora-v1` | CPU 真实反向传播、AdamW、LoRA 参数更新；`adapter.zip` 包含可加载 adapter 配置/权重及训练证据 |
| EM / CLOUD | 现有 `BGE-M3` / `bge-m3:567m`，沿用任务冻结的实际 Ollama digest | `test-bge-m3-v1` | 保留 V2 的三个输入、3×1024 float32 向量和独立 BGE 校验；原最低显存 8GB 不变 |
| SP / CLOUD | `openai/whisper-tiny`，`169d4a4341b33bc18d8881c4b69c2e104e1cc0af` | `sp-whisper-tiny-v1` | CPU 对真实 WAV 做识别；`transcript.json` 保存模型 token、文本、实际时间戳及音频摘要，可按公开参考文本计算 WER |
| EM / PHONE | `sentence-transformers/all-MiniLM-L6-v2`，显示名 `all-MiniLM-L6-v2`，`1110a243fdf4706b3f48f1d95db1a4f5529b4d41` | `phone-minilm-wasm-v1` | 原生 App 的 Worker 内以 ONNX Runtime Web/WASM 执行 FP32 真实模型，masked mean pooling 后 L2 归一化；`embedding.f32` 为 2×384 little-endian float32，共 3072B；服务端独立 ONNX 重算 |

上述模型如实显示其名称和规模，不冒充 70B、405B、Sora 或商业训练效果。FT 固定 LoRA rank=4、alpha=8、q_proj/v_proj、dropout=0，要求实际训练集 loss 下降、参数更新量非零、重新加载 adapter 后 loss 一致，并由独立进程重放；验证集 loss 如实记录，短训练不代表泛化质量提升。SP 使用公开的 Whisper 官方 `tests/jfk.flac` 语音样本，转换成 16kHz/mono/PCM16 WAV 后冻结转换产物 SHA256，不使用私有用户录音或纯音冒充识别。

模型文件与依赖由后端 `scripts/compute_v2_image_video_models.json`、`compute_v2_text_audio_models.json`、`compute_v2_phone_embedding_models.json` 列出；安装 profile 由 `compute_v2_model_installations.json` 冻结类别、runtime、deviceKind、模型/版本、文件摘要、依赖、device 和 dtype。`modelDigest` 是该 profile 去掉 `modelDigest` 后 canonical sorted UTF-8 JSON 的 SHA256，不能用单个权重摘要替代。手机 ONNX 文件为约 90.4MB，权重 SHA256 为 `6fd5d72fe4589f189f8ebc006442dbb529bb7ce38f8082112682524616046452`；本批手机 profile digest 为 `sha256:4fd205f37776262f8e8d3224ce5a4ed0b19bd106129046da04322a6bd19b4562`。

### 9.2 输入与安装资格

- IG/VG：`prompt` 1–1000 字符，`width/height` 256–512 且为 64 的倍数，`steps` 8–32；VG 另有 `frames` 4–8、`fps` 1–16。
- LL：`prompt` 1–2000 字符，实际输入最多 256 tokens；`maxNewTokens` 8–128，允许模型真实 EOS 提前结束。
- FT：`trainingTexts` 2–8 条、每条 8–1024 字符；`evaluationText` 必须与训练文本不同；`maxSequenceLength` 32–128，`steps` 2–8，`learningRate` 0.0001–0.01。
- SP：`audioPath` 是模型 snapshot 内的相对 WAV 引用，配 `audioSha256`、`language="english"`、`maxNewTokens` 16–128；音频 0.1–30 秒且非静音。可同时提供 `referenceText`、`maxWordErrorRate`（0–0.5），参考文本只用于验收质量，不能替代模型输出。
- 手机 EM：仅 `inputIds`、`attentionMask`、`tokenTypeIds` 三个 2×N 整型矩阵；配置中的 base 输入为 2–120 tokens 且起始为 CLS（101），词表 ID 0–30521，mask/type 为 0/1，每条有效 mask 至少两个 token。签发新手机任务时，服务端复用 SecureRandom 在每行 CLS 后插入八个独立的 1000–30521 词表 ID，同时插入 mask=1/type=0，最终 N 不超过 128。完整实际挑战矩阵冻结进 manifest/inputHash 并同时发给真实 Worker 和独立 verifier，不在模型内部偷偷改输入。只换 seed 不能改变确定性 ONNX 计算，旧固定输入向量不得仅重绑任务摘要后用于新单。若未来增加可读文本，必须同时冻结其 tokenizer 映射，不能把任意文本与无关 token 混为同一输入。

本批安装注册表的 IG/VG 默认 workload 采用已经实际复验的 `512×512/16 steps`；VG 为 `4 frames/4fps`。早期 `256×256/8 steps` 仅是此前真实模型跑通样本，其抽象画面不足以作为当前默认质量依据。E2 保存 `{}` 时仍由注册表展开实际 workload，不由预计 18/900 秒代替模型计算。

`nexion.compute-v2.modal-runtime-registry-json` 是部署端的最多六个安装条目，每条包含 `taskClass/runtimeKey/modelName/modelRevision/modelDigest/deviceKind/ready/workload`。只有严格匹配固定模型、版本、类别及设备种类且 `ready=true` 的条目才能成为候选；runtime 与 validator 必须相同。空 E2 输入配置 `{}` 采用该安装条目的冻结默认 workload，非空配置必须满足对应类型合同；整个 workload UTF-8 最多 16KB。

`deviceKind` 取 `CLOUD` 或 `PHONE`，属于安装注册信息，**不在 E2 表单、A2 task params 或 DeviceTaskUpsertRequest 中**。输入该字段不能安装模型或改变设备权限。五类新云端执行器均为 CLOUD；MiniLM 为 PHONE，云端 runner 不领取其排队任务，手机不领取云端任务。任务仍须通过正常 E2 配置审批、allowed-task-ids、状态/kill、设备权益及最低显存筛选，随后按权重抽选并冻结 E3 报价；注册表本身不授予权益。

### 9.3 原生手机入口与恢复

本批手机执行资格来自当前原生 APP 会话及其 installation、服务端当前绑定与 executionOwner，不能由请求指定任意 userId/deviceId/installationId。设备须为 OWNED 的 MOBILE/PHONE、已激活且有 server-canonical/PRODUCTION 校准，最近 120 秒心跳有效、电量至少 20%、网络可用、无暂停，并在真实模型 SHA 校验和 ONNX session 创建后上报本机 engine readiness。readiness 有效期 120 秒，授权运行心跳续期，退出后失效；填写 runtime 字符串或仅有电量/网络观测不构成模型就绪。

正常APK/WGT仅携带ORT、Worker和许可证，90,405,214字节权重不进包；首次使用从固定官方HF HTTPS revision下载，按revision和SHA保存到App私有持久缓存，每次Worker仍核完整权重SHA后才加载ORT。HBuilderX 5.33与SM-A5760已实际完成首下载→私有保存→生产Worker推理199ms、完整进程重启后缓存命中（新增下载0字节）→推理202ms，两次完整产物分别独立Python ORT复算通过；199/202ms不是下载耗时。缓存路径实际为 `_doc/uniapp_save/<timestamp>.onnx`，经plus转换和renderjs文件URL送入Worker成功读取。下载中切后台后失败可能卡住准备标志的catch恢复P1已最小修代码，但后台失败→前台重试E2仍PENDING。调试壳缓存、正常云包、正式APK首次缓存分别记账。用户最新选择本轮直接用HBuilder真机基座调试，手机业务链路以该正常基座入口实际领取/独立验真/结算/恢复结果验收，正式APK安装不再是本轮前置条件。

手机同时加入全局 `device-ids` 和独立 `phone-device-ids` 才能执行。当前手机 1383 为真实 7GB 设备，手机 MiniLM 任务设置 `minVram=0`，服务端按真实 CPU runtime 资格派发；不将其内存伪报为 8GB，不降低或覆盖云端 BGE 的 8GB 门槛，不将手机登记成付费 fleet。手机 USDT 沿正常冻结报价及 VERIFIED 后分钟入账；不附加 CloudShare 付费每日 UVT。

旧 v1 领取候选明确排除 `all-MiniLM-L6-v2`，防止该 minVram0 配置启用后被其他未 enrolled 手机或旧设备领取。此排除只作用于 v1 新领取的 chooseTask，不改变共享 mapper、V2 候选或已有在途任务；新 MiniLM 必须走手机 V2 身份绑定、真实本机执行和独立 ONNX 校验。

新增普通 App bearer 入口 `/api/app/compute-v2/phone/{next,heartbeat,complete,receipt,exited}`。next 仅收 `runtimeKey/modelRevision/modelDigest/engineReady/modelSha256/enginePlatform`；其余请求以 taskNo/generation/claimToken 绑定当前 owner。complete 保留 proofNonce/inputHash/modelDigest/resultHash/resultArtifactBase64/proofTimestamp。最后一项时间戳可在重试时刷新，原 bundle、摘要、nonce 和冻结身份不能改变。

客户端发 next 前保存 CLAIM_INTENT，开始真实计算前保存 COMPUTE_INTENT，发送完成前保存原完整 bundle。COMPUTE_INTENT 或 ACK 未知时先查原 receipt，不重算、不换任务/代际；只有 `COMPLETED` 且 taskNo/generation/inputHash/resultHash 一致才视为完成确认。后台、低电、断网或 Worker 失败时先实际终止 Worker，恢复可通信后携 `workerExited=true` 及退出原因确认原代际。服务端存在活跃校验或待确认完成事件时拒绝释放；其余中止记录为 FAILED/FENCED 和独立退出证据，再按同一 V2 EXITED 释放许可，不能记为完成或收益。手机退出证据由当前绑定 owner 提交，云端仍使用受信进程观察，不互相冒充。

租约过期或校验失败后，receipt 在当前运行态仍精确匹配该 taskNo/generation、状态为 `FAILED/RECOVERING` 且没有待确认 VERIFIED 时返回 `state=FAILED`，`exitConfirmed` 仍只由真实 EXITED 证据决定。手机据此沿现有 `EXITING/WORKER_ERROR` 确认原 Worker 已退出，避免将已围栏任务无限重提 complete；新任务或新代际状态不得覆盖旧任务回执，staged/outgoing VERIFIED 的 MQ ACK 未知仍保留 `IN_PROGRESS`，已经 VERIFIED 的完成回执仍优先。此恢复路径的断网超过租约实景验收尚为 PENDING，编译通过不代表该业务流程已验收。

### 9.4 资源与真实退出

逻辑容量仍为 6000 槽、每账号最多六槽，服务器物理 permit 总数不超过六。当前部署方案复用单个共享 BGE 执行容器 1.5GiB、独立 BGE 校验容器 1.5GiB、多模态容器 7.5GiB（6GiB 工作池及 1.5GiB 开销），模型总承诺 10.5GiB，沿用原预算；整机 20% 内存余量仍以 host capacity 字节证据校验。不得为满足六类名称而驻留六份大模型。

| 工作 | 执行准入成本 | 子进程/执行约束 |
|---|---|---|
| 云端 EM/BGE | 1536MiB、2 CPU threads，最多一个 EM permit | 执行和独立校验均 `num_thread=2,num_gpu=0`；同一 EM permit 保持到真实退出，计算与该单的独立校验按阶段运行 |
| IG/VG | 每单 6144MiB、2 CPU threads | 正式权重在 T4/CUDA 执行；工作池仅容一个此类重任务 |
| LL | 1536MiB、2 CPU threads | CPU，模型按需加载 |
| FT | 2560MiB、2 CPU threads | CPU，实际训练及 adapter 加载，不以驻留时间替代工作 |
| SP | 1024MiB、2 CPU threads | CPU，真实音频识别 |
| 手机 EM | 本机执行对服务器准入成本为 0，仍占全局一个 permit | 手机 WASM 1 thread；独立服务端校验另占多模态工作池 512MiB/1 thread |

资源策略须显式启用；服务器执行准入 CPU 合计上限为 6，多模态实际子进程 CPU 池上限为 4，配合单个 BGE 的执行/独立校验阶段控制活动推理线程。云端保持 FIFO，头任务资源不足时等待，不新增绕过计数或重抽；手机只 reserve 自己的绑定设备任务，独立于云端队首，但仍受全局 permit 与校验工作池限制。本批 IG/VG 512²/16 步整体模型复验已有资源观测：GPU 一秒采样峰值 6073MiB，modal 父 cgroup lifetime peak 6118756352B（约 5.70GiB），OOM 事件 0，MemAvailable 最低 17172692992B，高于当时 20% reserve。它只覆盖该模型复验窗口；新业务运行态的重轻任务推进、混合负载和持续余量仍待现场验证。

新 `shared-bge-container-id`、`modal-container-id` 反映实际父容器身份。云端 V2 EM 回报共享 BGE CID 与独立 base validator CID；云端 V3 回报同一个 modal 父 CID，实际执行和校验必须是不同的新子进程；手机返回 `executionKind=PHONE` 并省略 Docker 计算身份。旧日志排空后才切换物理映射，不把停态旧 fleetN CID 当作真实执行身份。

多模态服务按完整任务绑定单飞，执行、独立校验分别启动新进程。启动前持久化 intent，已有未知或失败记录不自动重算；校验首次冻结 bundle SHA，不允许另一个结果覆盖。正常或超时均须等待子进程实际退出，必要时 TERM/KILL 进程组并 wait，之后才归还本地预算。`/status` 中没有进程记录、没有 exitCode 或仅 activeProcesses 为空都不能证明实际退出。现有旧 UNKNOWN、钱包、任务和 journal 原证据继续保留。

### 9.5 协议 3 与完成确权

旧 EM 的 Manifest V2、原 f32 校验及原在途恢复继续兼容。新云端五类和手机 EM 使用 Manifest V3，冻结 `taskClass/runtimeKey/validatorKey/taskConfigId/revision/modelName/modelRevision/modelDigest/workload/seed/executionTimeoutSec`；inputHash 为该 manifest 字节摘要。worker/手机响应在原 taskType 之外返回 taskClass、协议版本、runtime/validator、真实模型/版本/摘要、workload、seed、配置版本及超时，并回填真实 taskNo/generation/inputHash。

模型工作绑定八字段为 `taskNo,generation,inputHash,taskClass,runtimeKey,modelRevision,workload,seed`，按排序 UTF-8 JSON 计算 taskBindingHash。完成请求外形不变：`resultArtifactBase64` 是 bundle 原字节的 base64，bundle 包含模块 result 及真实 artifactBase64；resultHash 是 bundle 原字节 SHA256。先校类别/模型/输入绑定、大小、产物名/媒体类型/摘要，再做独立模型验证；bundle 上限 32MiB，手机固定 3072B 原向量，拒绝跨任务/代际/类型、篡改、截断及伪造。

后端仅以独立 backend-only validator token 调用 loopback `/verify`，RPC 严格传 `task` 八字段、`bundleBase64` 原字节和冻结 `executionTimeoutSec`。不得先用 Jackson 重编码 bundle 再由 Python 重编码计算摘要，以免浮点表示差异改变合法 FT 结果。校验进程退出成功后返回 verified/taskBindingHash/resultHash；HTTP 请求时限为冻结执行超时加 120 秒，不持 SQL 锁等待模型。

独立校验成功后仍调用原 verifiedComplete，存 MinIO `.bundle.json`（旧 V2 EM 仍 `.f32`），MQ/Redis 仅传引用与摘要。资金事件和 TaskSnapshot 仍为 schema 2，不复制钱包、分摊、去重或分钟 SQL 流程。阶段/预计时长不产生收益；只有 VERIFIED 进入待结算，真实分钟批次才进入已到账。

### 9.6 正常 E2/A2 配置与实际审批

本批五项新云端配置已沿 E2“收益&用户任务管理 → 任务列表 → 新增任务”填写正式类型、真实模型、最低显存、奖励与调度字段，提交业务确认及理由，再由 **superadmin 发起、suadmin 审批**。每项均在 A2 显示“已执行”后重新进入 E2，正常打开编辑抽屉完整回读并关闭，未另存修改。新增提案共用空 create target 锁，因此采用逐项提交→不同管理员批准→回读→下一项的正常流程；此前被该锁拦截的 VG 没有落库，锁释放后才正常重新提交。没有借 SQL 写入或隐藏 API 绕审批；旧待审批票未动。后续新增/修改仍按同一业务权限与 maker/checker 规则办理。

实际 task command params 为 `name,price,unit,requirement,saturation,status,taskClass,model,minReward,maxReward,minVram,killInit,selectionWeight,expectedDurationMinSec,expectedDurationMaxSec,executionTimeoutSec,runtimeKey,validatorKey,workloadConfigJson`；update 另带 taskId。`workloadConfigJson` 是 JSON **字符串**，不是嵌套对象；PC 内部 `minVRAM` 映射到提交字段 `minVram`。modelRevision/modelDigest/deviceKind/ready 来自部署注册表，不是 E2 可授予字段。

以下为已批准且完整回读的实际云端配置。代表模型及 runtime/validator 与 9.1 相同；IG/VG 为 `nota-ai/bk-sdm-tiny`，LL/FT 为 `HuggingFaceTB/SmolLM2-135M-Instruct`，SP 为 `openai/whisper-tiny`。

| 任务 / taskId | A2 已执行票 | 保留原类报价 min–max（USDT/job） / price | minVram（GB） | 固定预计秒数 / 超时秒数 |
|---|---|---|---:|---|
| IG 图像生成 / `TK-1793572436690` | `WO-261101222208529-632` | 0.0001–0.045 / 0.045 | 12 | 18–18 / 3600 |
| VG 视频生成 / `TK-1793572618490` | `WO-261101223602102-268` | 0.45–1.8 / 1.8 | 48 | 900–900 / 3600 |
| LL 文本推理 / `TK-1793572684179` | `WO-261101223740659-515` | 0.00005–0.85 / 0.85 | 80 | 12–12 / 3600 |
| FT 模型微调 / `TK-1793572862945` | `WO-261101224039984-75` | 0.06–0.42 / 0.42 | 48 | 1800–1800 / 3600 |
| SP 语音处理 / `TK-1793573065179` | `WO-261101224402243-794` | 0.00005–0.072 / 0.072 | 8 | 30–30 / 3600 |

五项共同配置为 `unit=/job`、权益 `S1+`、饱和度 35%、`status=active`、正常接单（`killInit=派发中`）、`selectionWeight=1`、`workloadConfigJson="{}"`；runtimeKey 与 validatorKey 均为各自 9.1 的同值。最低显存保留原类别 12/48/80/48/8GB，没有统一降为 8GB。预计秒数只是固定显示范围，实际模型完成和退出取真实进程与产物。目录 price 的既有四位小数显示限制不改变六位奖励报价。证据为本批 `run/{IG632,VG268,LL515,FT75,SP794}-A2-approved.jpg`、对应 `-E2-edit-readback.jpg` 和 `-E2-readback.txt`。

手机配置随后已通过正常 E2/A2 票474批准，新 taskId 为 `TK-1793604640744`。配置为“手机向量计算”、EM / `all-MiniLM-L6-v2` / `phone-minilm-wasm-v1`，报价 0.00002–0.00003 USDT/job、price=0.00003，手机+、minVram=0、权重1、饱和度35%、预计5–5秒、超时300秒、输入 `{}`，完整回读和真实业务阶段结果见9.7。

`{}` 仅在安装条目已保存符合 9.2 的真实默认输入时使用，签发时必须展开为完整冻结 workload。后续价格、权益、时长和派发状态修改仍需正常 E2/A2；旧停用1209不因本批配置恢复。该阶段云端 allowlist 已部署为上述五项及旧 BGE 短文本 `TK-1793552869608`，手机另纳入正常批准的 `TK-1793604640744`。已有 A2 批准不等于实际派发、执行或收益入账；新规则周期仍按第10节开关与当前设备范围启用。

### 9.7 本批验收状态

本批 TEST-PLAN C80–C98、FLOW05/06 的完整业务链路仍保持 **PENDING**，以下已取得的分阶段证据分别记账：

| 环节 | 本批实际状态与边界 |
|---|---|
| 云端与手机 E2/A2 | 五项云端票均由不同管理员正常批准并在E2完整回读；手机票474由superadmin发起、suadmin执行，新ID为TK-1793604640744，MiniLM/手机+/minVram0/报价20–30微USDT/权重1/预计5秒/超时300秒已完整回读 |
| 云端五类整体模型 | TEST modal HTTP `execute→verify→status` 实跑 IG/VG/LL/FT/SP，每类执行和独立校验均为不同新进程且 exit0；未通过业务派单或资金入口 |
| IG/VG 当前质量 | 512²/16 steps 再验通过；IG PNG 可辨，VG 4帧/4fps可完整解码且帧间有变化。已查看图片和四帧拼图；浏览器播放器实播尚未完成 |
| LL/FT/SP 实际输出 | LL真实生成22 tokens；FT两步训练230400个LoRA参数，loss 4.313211→4.064163、更新量非零、adapter重载与独立重复训练通过；SP对11秒公开JFK音频识别，WER0且独立复算通过 |
| 手机 ARM 与真实业务 | SM-A5760/Android16/WebView156、HBuilderX5.33使用真实MiniLM/ORT及私有缓存；原独立复算误差9.6857548×10⁻⁸。正常基座9613/596ff已实际完成56单领取→ARM计算→独立服务端验真→分钟入账→下一单，未安装新包；后台失败重试、故障恢复与模型增量RAM峰值仍待验 |
| 新版本发布 | 根盘闲置缓存/产物/旧journal清理约3.65GiB后，原15GiB预检通过，门槛未改。backend450/2fa8924e及App367/9613a86f均经正常回滚验证及发布，host state匹配。后续资格事务修复6f86fcdd及算力证明完整金额精度af95706d已推test，实际新发布/基座复验另记；不执行新的APK安装/来源权限操作 |
| 本批资金 | before848d95…原快照保留。07:50:54UTC手机中间快照56单/224生命周期/56份分摊与凭证/10批，钱包、批次、分配和资金journal均增1391微USDT、UVT0，修订连续且无重复；经独立复核通过。最终after尚未采，不能以手机样本替代云六类资金验收 |
| 全业务与长稳 | 手机主流程和分钟资金已通过上述样本；资格读取的READ ONLY事务冲突及微额金额显示修复进入发布/实景复验。云端六类经济闭环、故障恢复、混合资源、6000逻辑槽、新2小时/24小时仍待实际完成，不拼接旧窗口 |

五类模型原始回执见本批 `run/model-evidence/whole-model-e2e-results.json`，质量复验见 `quality-e2e-results.json`，手机见 `PHONE-ARM-EM-EVIDENCE.json` 及 `run/INDEPENDENT-BACKEND-REVIEW.md` 补记。生产 compile/package、静态审阅、HBuilder真机预验与模型服务实跑都只证明相应环节，不能替代完整业务终点；早期历史窗口不拼入本批长稳。

必需证据包括：正常 E2/A2 保存及重新进入回读；六类真实产物和模型摘要；手机 1383 当前 owner/绑定/心跳/电量/网络及真实 WASM 输出；合法候选等权/不等权抽选及快照不重抽；错类型、错模型/摘要、跨任务/代际、假产物和普通用户越权被拒；实际执行/验证超时、ACK 未知及子进程真实退出；Redis→MQ→一分钟 SQL 批次/分摊/钱包逐字段一致；正常 App/PC 页面操作；资源余量与无新增 OOM。6000 逻辑槽负载、真实物理并发、2 小时和 24 小时各自独立记账，不拼接历史窗口或将未运行标成通过。只开展 E2E 和完整业务链路验证，不新增或运行单元测试/独立集成套件；临时验证源码按工作区规则清理，仅保留必要回执。

手机反重放的整模型正反样本已实际通过：ARM新挑战向量可通过独立ORT，重绑旧3072B向量被拒。仍须在本轮HBuilder真机基座正常业务流程核新单确由服务端签发两行各八token挑战、重复 next/ACK 恢复沿原冻结矩阵、旧向量被拒且不入账、新向量合法入账；这一全链路及断网超过租约的恢复/真实退出验收仍为 PENDING，不能用 SecureRandom 或编译成功代替。

## 10. 【已被 uvel-docs 22 替代，仅留历史】 2026-11-02 后发增量：云端规则周期与完整凭证

本节仅调整新云端任务的执行方式。云端不再为每个新周期调用真实 Python 模型，而由服务端依 E2 六类（IG/VG/LL/FT/EM/SP）配置随机选任务、报价和时长，到期后自动完成并进入原分钟资金链；关闭手机、退出 App、切后台或不刷新页面不影响已激活云端设备继续运行。手机本机算力保持第9.3节真实 MiniLM/WASM、在线与会话资格、独立 ONNX 验真和退出确认要求，不能用云端规则周期替代。

### 10.1 启用、选取与冻结

- 独立开关 `nexion.compute-v2.rule-cycle-enabled` 默认 `false`，仅对当前已有 enrolled 范围中的合格云端设备启用。环境名不硬编码；联调或 prod 上线前需要运行本模式时，由部署配置显式开启并核对实际设备范围。本次只有 test 分支候选，不代表已经部署或获准发布 prod。
- 复用 E2/A2 已有六类任务、启停/kill、权益、最低显存、任务 allowlist、`selectionWeight`、六位 `minReward/maxReward`、`expectedDurationMinSec/expectedDurationMaxSec` 与原 E3 报价规则。PC 字段已具备，本轮不新增配置页面或审批通道。云端规则周期不以 Python 模型安装、模型进程或手机会话/心跳作为开始和续算条件。
- 每轮在合法候选中按权重抽选配置，在配置区间内抽取报价及整数秒时长，按原 E3 形成最终冻结奖励。任务、代际、配置ID/版本、类别、配置模型信息、抽中时长、最终奖励及服务端起止依据随原快照冻结。刷新、重连、重复请求、MQ 重投和服务端重启均恢复同轮原快照，不重新抽类型、金额或时长。E2 后续编辑只影响新轮。
- 服务端从实际开始时间计时，到冻结时长才确认本轮完成；客户端时间和进度达到100%不触发完成或入账。读取页面不推进周期，也不依赖手机发送 next/heartbeat/complete 来推动云端。服务端确认后再按原调度条件进入下一轮；停用、撤权、冻结等沿既有业务规则处理。

### 10.2 资金、凭证与旧任务

- 复用现有 Redis 运行态、生命周期 MQ、原 VERIFIED 事件及60秒 SQL 批次，不新增分布式池或独立结算框架。规则条件确认完成后才产生一次待结算事实；原账号/资产批次、任务分摊、收益、钱包增量、总账与唯一约束继续生效。重复到期处理、重启恢复和 ACK 未知只核原轮/原事件/原批次，不能重发奖励；积压、BLOCKED 与恢复边界沿第4节。
- 规则周期记录 `executionMode=RULE_CYCLE`、`modelExecuted=false`、`proofKind=RULE_SETTLEMENT`。这些是服务端凭证 JSON/审计元数据；页面沿现有产品名称、状态、进度、收益及凭证布局，不额外加入“测试数据”“未执行模型”等提示。配置中的模型名称只代表该轮选择的配置，不能据此生成真实推理声明。
- 完整凭证关联原任务/代际、设备/账号、配置ID/版本、类别及配置模型、冻结报价和最终收益、冻结时长、服务端开始/完成时间、结算状态、批次与分摊。规则凭证中的哈希必须对应实际规则快照/结算内容原字节，可按其 JSON 核验；不伪造模型输入/输出、产物或进程证明，不挪用真实模型产物摘要。只有真实已入账事实才能显示 POSTED，NONE/PENDING/BLOCKED 不显示成到账。
- 算力证明列表、详情主额及USDT/UVT分项继续按实际有效小数位完整展示，不固定两位或六位、不截断、不补零；钱包和账本原值不变。详情状态与进度读取服务端事实，运行中最多99%，服务端 COMPLETED 后才100%。
- 切换开关只影响新派任务，已冻结的真实模型任务继续原 manifest、worker、独立 verifier、receipt、退出确认及分钟结算路径，不改快照、不转换为规则凭证、不重放执行。原真实模型凭证按原路读取。关掉规则开关停止新规则轮，已有规则轮继续按冻结内容收敛；完成后停用沿原待停用流程收尾，不再发下一轮。

### 10.3 最小全链路验收矩阵

本轮只运行 E2E 和完整业务链路；不新增或运行单元测试、独立集成套件。以下为待执行验收，历史56单手机资金样本、真实模型子流程和构建成功均不能替代本轮结论。临时验证代码按工作区要求清理，仅留必要证据。

| 场景 | 业务入口与可观察终点 | 本轮状态 |
|---|---|---|
| E2 配置与随机冻结 | 正常 E2/A2 保存并重新进入回读六类范围；新轮选取合法类型、报价和时长；运行中改配置、刷新及重试保持原任务/代际和快照，后续新轮用新配置 | 待验 |
| 服务端周期与资金幂等 | 新云端轮→到期完成→VERIFIED/MQ→60秒 SQL→凭证/分摊/收益/钱包/总账逐字段相符；重复读取、到期处理或原事件重投不增加第二份奖励 | 待验 |
| 重启同轮与未知结果恢复 | 运行中和完成ACK未知时恢复服务端；原轮类型/时长/奖励不重抽，已提交批次按原证据回查，未确认结果继续受控恢复并最终一次收敛 | 待验 |
| 停用与开关 | 运行中“完成后停用”只收尾原轮且不新派；关闭规则开关不改在途快照，当前范围外设备、暂停/无资格配置不能加入新规则轮 | 待验 |
| 关闭手机与云端独立 | 实际关闭/退出手机 App 后，已激活云端轮仍到期、入账并继续下一轮；重新打开页面状态与服务端一致；手机本机任务按真实退出/恢复路径处理 | 待验 |
| 完整凭证与权限 | App 实际操作列表→详情→原JSON/凭证读取；收益完整精度、真实结算状态和规则元数据/哈希一致；非owner与越权凭证请求拒绝，无客户端改额或提前完成入口 | 待验 |
| 旧模型与手机真实路径 | 已冻结真实模型任务按原执行/校验/退出/资金链收尾，原模型凭证可读且不转规则；手机真实领取→本机计算→独立验真→分钟入账→下一单，离线/后台停止新领并恢复原任务 | 待验 |
| 6000逻辑槽与轮询延迟 | 1000账号/每账号最多6槽的逻辑运行与页面批量轮询，记录实际成功率、延迟及周期/资金积压；读请求不改变轮次，不把逻辑槽数写成真实模型并发，不以fixture写成真实6000账号资金验收 | 待验 |

验收结论待根 Agent 提供本轮实际部署、页面操作、恢复与资金回执后补记；当前没有本轮规则周期部署、完整业务通过或 prod 发布结论。
