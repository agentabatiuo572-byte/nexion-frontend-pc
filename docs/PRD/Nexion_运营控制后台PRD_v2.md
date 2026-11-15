# Nexion · 运营控制后台 PRD(Ops Console PRD)— V2 卷:设备商城(E)+ 分销团队(F)

> **B38 E4 后端增量（2026-11-08）**：[九项契约](B38-后端九项交付契约-20261108.md)规定退款由财务主管／有权超管发起、另一有权超管批准，直接接口无双人旁路；普通订单已完成任务结算一次，未完成停止，已到账设备收益保持。PC `2d30284f` 已接入 B38 第二组的权限、任务影响及原号恢复，见 [E4]；页面静态同步不替代真实批准与资金、任务终点验收，退款金额及促销／试用继续各自范围。

> **BE-E 八项后端补充（2026-11-11）**：八项后端已完成 GPT 隔离 HTTP 整体业务验收（2026-11-11）；01／04／05 补修后复验通过，回执见后端 `docs/acceptance/BE-E-20261111.md`。未发布正式 TEST，未接入 PC 页面。BE-E-01／03／08 具体规则见 E1／E6。
>
> - **E2／A2（BE-E-02）**：规则任务票及历史记录新增 `ruleTaskAction`，由服务端保存的不可变命令类型导出 `CREATE / UPDATE / ENABLE / DISABLE`，不读取当前任务状态或可编辑说明推断。`e2_task_update` 即使载荷 `enabled=false` 仍为 `UPDATE`；既有通用 `action` 字段保持原义。PC 动作名称调整仍待前端方案确认，本批未改页面。
> - **E5 概览（BE-E-06）**：`GET /api/admin/devices/overview` 在原分组查询中增加 `errorRetry / legacyPending / waitingConfig`，分别统计列表同一 canonical effective 状态 `ERROR / LEGACY_PENDING / WAITING_CONFIG`；原四项字段和口径保持。模拟模式关闭时新增三项均为 0，不另用原始状态计数。
> - **E5 筛选（BE-E-07）**：`GET /api/admin/devices` 新增可选 `Long userId`，按用户精确匹配，并与其他筛选及原 `keyword` 模糊匹配取交集；原关键词模糊语义保持。`userId <= 0` 返回 422，不退化成全量查询。
> - **E6 风控原结果（BE-E-04）**：新增 `GET /api/admin/config/phone-calibration/risk/receipts/by-key?commandKey=...`，返回原命令身份、状态及 `originalResponse`（原 `settings / stats`）。读取须具当前 E6 读权，且为原操作人，或具有未知结果核查权的有效超管；不能借读取重执行，也不能用当前配置推测原结果。缺少原身份绑定的旧记录拒绝恢复；确证原操作成功后仍保留原成功回执。
> - **E2／E5 受控核查（BE-E-05）**：沿 [B38 未知操作结果核查](B38-后端九项交付契约-20261108.md#2-未知操作结果核查b38-be-03) 绑定原命令及对象。E5 成功证据匹配持久审计的大写 canonical action（`ADMIN.DEVICE_ACTIVATED / ADMIN.DEVICE_DEACTIVATION_REQUESTED / ADMIN.DEVICE_DEACTIVATED / ADMIN.DEVICE_PAUSED / ADMIN.DEVICE_RESUMED`），不拿写入别名的小写字符串作拒绝依据；核查不新增执行权。

**最后更新：2026-10-06**

> **现行裁决(2026-08-07)**:全项目已取消 KYC 与钱包配对；本卷中相关门槛、事件、履约核验和地址确认描述全部失效，不得实现或恢复。

> 本卷是运营控制后台 PRD 的 **V2 分卷**,承接 V1 卷(`Nexion_运营控制后台PRD_v1.md`)的横切地基:§1.8 三原则(双账本 / server-canonical / 埋点优先)· A2 审计 & 操作确认(Confirm-with-Reason,2026-06 操作确认决议)· A4 埋点事件体系(§2.4)· §3.14 跨域归属 · H1 Phase 10-dial 权威(§1.7)。章节编号续 V1(Ch10 起)。
> **跨卷 §锚点**:§1.x–§9.x(本后台)指向 **V1 文件**;§13.4 / §9.11x / §6.x / §7.x 指向前端 PRD v3.5 与 12 月节奏表。参数默认值锚 12 月节奏表 §6,前端为现状参考。撰写遵循 `nexion-admin-prd` skill 流水线。
> **E3 后发裁定（2026-07-21）**：`specs/FEAT-DEV01-task-capacity-schedule.md` 与 `specs/FEAT-DEV02-tradein-ladder.md` 是 E3 当前唯一执行规格，优先于本卷中全部 `degradeEarly/degradeMid/degradeLate/minEfficiency/minHoldingMonths/salvage` 旧字段、旧公式、旧接口与旧 K2 联动描述。旧段落只保留为历史设计背景，不得进入代码、配置、页面、CGM 或验收口径。

> **Genesis 资格后发裁定（2026-08-27）**：`specs/FEAT-GEN02-unified-eligibility-policy.md` 是创世节点认购资格的当前唯一规格。真实 G4 只配置 `eligibility.enabled / maxPerUser / minAccountAgeDays`；旧四项组合资格及前端本地求值全部退役。本文设备 SKU 的 E1 `purchaseGate` 与 E3 设备 eligibility 属独立能力，不受该裁定影响。

> **当前状态合同（2026-08-16）**：状态必须按能力边界读取，不得把 Sandbox/Mock、单一配置页或阶段展示扩大为生产能力。
>
> | 能力 | 当前状态 | 允许宣称的范围 | 明确保持 HOLD 的范围 |
> |---|---|---|---|
> | Gen-2 E1 `purchaseGate` + App `GET /api/store/purchase-eligibility` | **COMPLETE** | 服务端权威判定；普通单、组合/Sandbox 单、Trade-in 与容量替换均在提交前复验；Pro v2 默认 V≥2、Rack P2 默认 V≥4 | 不得把 E3 九类通用规则编辑器混入该完成项 |
> | E3 九类通用 eligibility 编辑器 | **HOLD** | 仅保留未来扩展设计，当前不覆盖或旁路 E1 `purchaseGate` | 编辑器 UI、九类规则运行时映射和以其作为成交授权 |
> | Passkey / Telegram | **Sandbox Mock COMPLETE** | 显式 Sandbox 使用服务端 Mock 身份并显示 Mock 标识 | 生产 WebAuthn/Passkey ceremony 与 Telegram Login Widget verifier |
> | Janus | **Sandbox executor / 签名回执 / ACK Mock COMPLETE** | 仅 `test/acceptance/local-sandbox` allowlist，回执/证明带 `SANDBOX` 来源 | 实体真机、native attestation、生产 handoff 与真实设备 ACK |
> | 提现结果未知的核验与放弃 | **COMPLETE** | 服务端先核验 canonical withdrawal；未建单才写 `ABANDONED` tombstone；不取消已提交提现 | 真实银行/链上/PSP 出款仍按生产供应商范围 HOLD |
>
> **历史口径说明**：2026-08-15 的旧 HOLD 记录仅代表当日快照，已由本节 2026-08-16 状态合同取代；历史事实不改写，当前执行口径以本节为准。

## 目录(V2 卷)

| 章 | 标题 | 域 | 状态 |
|---|---|---|---|
| 10 | 设备与商城 | E | ✅ 本卷 |
| 11 | 分销与团队 | F | ✅ 本卷 |

---

## 第 10 章 设备与商城(域 E)

> **E 域现行页面（2026-11-09）**：E1 商品目录与上架门、E2 任务池、E3 设备使用与升级置换、E4 订单进度、E5 设备管理、E6 手机任务与设备配置。E1a/E1b 与 E3a/E3b 保留功能区子标号；E2、E5、E6 按本次任务池切换更新，导航与页面标题一致。

> **本章覆盖 E1–E6 六个页面**：商品发布、DEVICE 任务等级、设备生命周期与置换、订单履约、用户设备管理，以及集中到 E6 的 PHONE 任务、收益、用户手机和校准。等级决定任务内容，月收益目标决定收益；设备与手机各有独立任务池。
>
> 本章承接 V1 已落地的横切地基:**审计 / 操作确认权威归 A2**(§3.14;全章高敏写操作复用 A2 操作确认契约——确认弹窗 + 理由必填(server 强制非空 400 `REASON_REQUIRED`)+ 审计 schema,2026-06 操作确认决议,E 域不另立确认机制)、**埋点命名 / 身份 / 通用属性权威归 A4**(§2.4;本章所有 `device.*` / `store.*` / `checkout.*` / `admin.*` 事件均在 A4 schema registry 注册,⑧ 段不另立命名)、**资金动作权威归 D 域**(订单支付走 D1 充值 / PSP、paid 写 D4 账本,见 E4)。
>
> 跨域归属(§3.14)在本章的体现 / 须补登条目:
> - **E3 换新阶梯权威归 E3**，K2 只读消费已完成置换、正数佣金与 IN 向正数赠送事实；K2 不持有换新配置，也不再读取 `minHoldingMonths`。
> - **E1 设备规格(baseRate / baseRateNEX / price)被 C1 用户画像 fleet 卡引用**(§Ch5 C1 展示用户持有设备的日产基准),E1 为规格权威源,C1 只读展示。
> - **E1 代际发布门由 H1 Phase 月龄派发驱动**(§1.7 Phase 引擎权威归 H1),E1 调整的是「代际发布时点 / trade-in 折扣」,Phase 月龄判定本身归 H1;E1 联动 H1 但不持 Phase 权威。
> - **E4 订单支付链路依赖 D 域**:支付走 **D1 充值与收款对账 / PSP**,paid 状态写 **D4 账本 / 账单审计**,退款联动 D 资金回退 + `cumulativeDepositUsdt` 核减(原子)。E4 持订单状态机权威,资金侧动作归 D。
> - **salvage credit 不入余额**:E3 残值额度**仅在置换结账时作为扣减项使用,不写 `creditBalance`、不可提现、不可累加**(§7.5 不变量 M2),后台不得提供「将 salvage 转入余额」的运营动作。
>
> **本章须在 V4 跨文档收口时补入 V1 §3.14 跨域归属表的条目**(与 V1 其他章节记录 §3.14 待补条目的体例保持一致):**E1 设备规格权威归 E1**(C1 只读引用)/ **E3 `minHoldingMonths` 权威归 E3**(K2 只读消费)/ **E4 订单状态机权威归 E4**(资金侧动作走 D 域,D1/D4 为资金联动方)/ **E4 `cumulativeDepositUsdt` 退款核减写权归属**(下条单列)。
>
> **本章须在 V2 落地前(非 V4 可拖)完成的阻断性跨域确认项**(列入 §3.14 待补条目并标注 V2 gate 阻断):
> - **`cumulativeDepositUsdt` 退款核减写路径归属待 D1/D4 对齐确认**:E4 退款核减拟由 D4 账本通过 `recordDeposit(-amount)` 原子写入,但 V1 D1⑦ 仅定义正向充值写路径、D1④ chargeback 仅要求「同步核减」而未指定执行域/函数。**该逆向写权归属须在 V2 落地前与 D1/D4 域对齐确认,E4 不可单方面声明 D4 的写行为**(详见 E4⑤/⑦)。
> - **`order` domain 扩展申请**:V1 §2.4.3 domain 枚举(21 个)不含 `order`;E4 订单状态机事件依赖该 domain。**V2 sprint 开始即向 A4 申请 `order` domain 扩展(blocking 依赖,不可拖至 V4),并登记为 V2 起始工单**(详见 E4⑧)。
> - **Gen-2 当前成交授权已完成**：E1 结构化 `purchaseGate`（Pro v2 默认 V≥2、Rack P2 默认 V≥4）及 App eligibility 查询/服务端复验已闭环；E3 九类通用 eligibility 编辑器仍为后续扩展，不能再作为 Gen-2 当前成交阻断项(详见 E1⑤ / E3b③/④)。
> - **`MAX_DEVICES` 参数化为条件性待补项**:V2 阶段 `MAX_DEVICES` 为写死常量(hardcode=6),不开放运营调整,**不作为现状补录项进入 §3.14**;**V4 评估参数化后,若 `MAX_DEVICES` 开放运营调整,则权威归 E5 并补入 §3.14**(详见 E5③)。
>
> 全章遵循三条贯穿原则(§1.8):**server-canonical**(定价 / 衰减 / salvage / 槽位上限 / minHoldingMonths 全部服务端权威,client 仅 UI cache,§9.11d.2)、**操作确认(Confirm-with-Reason)**(改定价 / 上下架 / 代际发布 / 衰减曲线 / salvage / trade-in 参数等放大转化或影响全站回本的高敏动作一律经业务专属确认弹窗 + 理由必填执行并落 A2 审计,2026-06 操作确认决议)、**埋点优先**(所有商城与设备态势派生自 A4 事件流)。
>
> **默认值口径(§7 硬规则)**:本章参数默认值,凡 12 月节奏表 §6 覆盖者(衰减曲线 §6.1 / 代际节点 §6.2 / 任务锁定累计 §6.5)**以 12 月节奏表为权威**;设备基础定价(SKU price / baseRate / baseRateNEX / 任务定价)12 月节奏表未覆盖,**以前端 §7 / §6.3 现状为参考**并在文中标注「现状值」。三者冲突时以 12 月节奏表为准,就地注明前端现状值与差异(供开发对照现状↔目标)。

---

#### [E1a] 商品目录 & 定价

**2026-11-14 后端 111e00cd 同步**：eeac87ae 将阶段 meta/skus 的 null 投影规范为空串；PC原字符串边界允许空串并显示未填写/—，不放宽其他字段、不写回DB，请求与界面保持。出处 OpsDeviceService.e1GenerationGates:2052–2057。

**2026-11-11 复查修正**：上架条件编辑、归档、绝对偏移和强制开放两方向统一使用商品编号作为审批目标，后端按同一真实对象阻止双待批单；本标签页已收到的待审批回执保留原命令号；页头刷新和打开商品资料或审批详情时按原命令号查询真实审批状态，明确读到已批准、已驳回、已撤回或已过期后解除该回执的对象锁。未查到或读取失败时保留待审批锁并提供重试，不因目录变化或回执刷新清除待确认存储里的未知原命令。媒体代理保留后端机器原因及未知标识；幂等冲突、无法分类的409保留原上传和原号。请求在途只显示提交中或上传中，原操作仍先保存再发送；失败或不完整回包后才展示结果未确认。成功显示审批单号，商品上有可查看的待审批标记；按原号核对找到待审批回执也显示同一标记。原操作及旧记录只展示简明事实，完整原记录仍可复制。商品、阶段与上架条件、折扣独立读取，已读取的商品不因关联失败隐藏；每个操作只依赖实际使用的来源：商品新增/编辑和上架需目录及开放阶段（编辑含审核契约），下架/删除只需目录；阶段新增/编辑及既有上架条件编辑、偏移、撤销强制、移除只需阶段，删除阶段、新增上架条件和强制提前开放还需目录；阶梯折扣只需折扣来源。独立配置区不因目录读取失败隐藏，失败块可独立重试；E3关联设置只控制抢先购调整，没有E3读取权限或读取失败时显示「当前设置未读取」并只禁用该项，其他E1操作不受此项影响；阶段未读到时商品卡标明「开放阶段未读取」，不据此误报阶段冲突，上架条件摘要和规则数量也标明未读取，不显示成零。

托管机房单行完整显示，UVT、试用和阶段另排；商品名中间省略时断点处的空格保留；售罄标签与剩余数分开；购买条件图标与文字同一行；卡片行列间距一致；缺目标或不限库存不保留空图形块，同排底部操作对齐。在售未配置等级进入可筛选的警示结论，售罄只在卡片提示。只读商品名称直接打开资料，不留单项更多和空操作列。资料按四组默认收起，售价突出、购买条件为中文条目、阶段为名称、不适用字段不列。编辑四区在1024仍是固定两列，数字输入有合适宽度、售价更宽，任务等级一行四项。四类配置确认常显当前与新值；金额精度和卡片一致，提交原值不变。

**2026-11-10 改版现行交互（优先于下文旧布局、即时执行和取整示意）**：`/devices/pricing` 使用商品卡片墙，首层是「在售／草稿／已下架／上架受阻」四个可切换筛选的统计、开放阶段线和商品搜索。未声明发布门、无效行、读取失败分别显示，不当作0或合法空目录。商品卡头依次为名称与状态、商品编号与档位、USD售价；没有媒体只显示可读屏和悬停的占位图标，角标贴缩略图角，现行生命周期不重复标注，已停产常显。标语最多一行，完整名称、标语、规格与购买门从「⋯ → 商品资料」查看。卡片按内容自然排布，同排底部操作对齐，缺目标与不限库存不留图形空位；托管机房完整单列，UVT日值、试用和开放阶段另排。库存条分母为已售加剩余，非初始批次售罄率；不限库存不画条。

编辑使用宽抽屉四区「基本信息／收益与任务／库存与购买条件／规格与资料」，可直接定位，底部固定提交；编号、累计与本期销量只读，隐藏历史字段随完整快照保留。确认叠在草稿上，取消回原输入；未保存离开提供继续、放弃、提交三选。所有字段差异完整展示，真实金额保留全部小数并标USD、USDT或UVT；旧回本与首年净额可查，标「参考口径未换汇」，手机参考基准固定0.08，不冒充E6当前值。卡底同一行直接编辑与上下架；禁用原因紧邻对应按钮。商品资料、按当前阶段上架及删除在更多菜单内，删除保留影响勾选。结论显示需处理的受阻、旧编号、待核实和在售未配置任务等级数量与处理入口；没有需处理项时提示目录已就绪。1440×900默认首屏完整露出第一排商品卡及第二排开头。

金额与配置展示去掉后端补的末尾0，按同组或同列的真实最多小数位对齐，至少两位；每卡售价独立取精度，月目标和同卡区间对齐，比例配置按实际位数（10.000000%显示10%）。真实小数不舍入；悬停或聚焦可读取后端原值。数量、月份等整数保持整数；确认前后值和提交内容保持完整原值，不受展示格式影响。

在售用中性对勾，已开放和已启用用对勾与运行色；草稿用中性资料图标，下架与归档为结束灰色；时钟仅用于等待月份或阶段。需补资格、阶段不匹配才用警示色，试用/购买条件/强制设置按各自语义显示。

开放计划收进管理折叠，商品计划与阶段设置每次显示一张表。新增上架条件的商品选择字段独占一行，当前商品名和编号完整显示；不改变共用下拉样式或提交内容。抢先购关联读取失败时显示未读取并禁止调整，不冒充关闭；组合折扣以配置行呈现。开放偏移明确为新的绝对值-12～12，不自动加减1。强制两方向按专门权限提供，仍不能跳过阶段和设备资格。

全部13种E1提案保存原对象、完整内容、理由、原版本、操作者和命令号，持久保存成功后才发A2；同业务对象结果未知时不能发新修改，只能原请求原号重试或读回原审批单。原月收益记录继续恢复，旧只有指纹和号的记录仅核查。重试明确拒绝后才人工解除；登录、权限、限流和幂等层未知均不解除；24小时后保留原记录与对象锁，不再重发。媒体直接上传另存原号、multipart参数、文件名/MIME/大小与SHA-256；刷新后重新选择同一文件并核对后才能原样重试；裁剪图由页面生成，刷新后不能用原图替代。提示到商品详情核对图片是否已更新，已更新按现有条件解除待确认，未更新或不能解除时联系技术核查；原号、记录及解除规则保持，不允许换文件重传。移除不删对象存储。所有提案成功只表示「已提交，等待审批后执行」，不在本页批准。

**旧型号维护例外（D01，2026-11-12）**：后端 `66ecdb47` 已支持原本在售的未知型号在不重新上架、不改变月目标及允许波动、不改变任务等级集合时维护名称、图片等无关字段或下架。编辑校验按这一条件放行，仍走现有商品 A2 提案；不补造任务等级、目标或机房。新建、重新上架、改目标或范围保留原校验与后端审批保护。页面的旧型号提醒文字由视觉 worker 按此边界更新。

2026-10-25：商品硬件型号与 GPU 数量分别配置，AI 性能展示完整读回 App；新增每商品资料名称与 HTTPS 链接，参与 A2 审核和版本校验。功耗须标注 GPU 额定或整机实测口径。详见 [商品规格联动补充](specs/FEAT-APP-20261025-experience-alignment.md#商品详情规格补充2026-10-25)。

**2026-11-09 任务池切换（优先于本节旧按单计价说明）**：商品任务范围改为 `allowedPoolCodes`，删除请求中的旧大类／具体任务 ID 字段。编辑抽屉多选四个固定 DEVICE「任务等级」，上架至少一个。帮助图标说明此等级会在 App 商城商品介绍中展示，且只决定运行哪些任务、不决定收益；默认不展开解释。抽屉按当前选择显示小型只读预览，例如「可运行初级 / 中级 AI 算力任务」，发布审批后 App 才使用已发布策略更新。App 通过公开商品 `taskLevels: number[]` 本地化等级，不显示任务名、时长或数量；PC 管理端保留这些任务信息。月收益目标与波动必填；选有等级时不能清空目标，草稿保存、发布、仅改目标和 A2 回放均由服务端统一校验。等级只决定任务内容，不决定金额。改等级、目标、托管文字及上下架保持现有双人审批，目标放大仍检查覆盖率；从未发布的草稿仅保存草稿，不因此发布。

固定等级选择和保存直接使用 L1 初级、L2 中级、L3 高级、L4 旗舰，不依赖 E2 读取权限或任务池接口成功。只有具备 `device_e2_read` 时才读取任务数及引用等附加信息。商品型号和月收益目标／任务等级资格使用 E3 的同一身份与顺序：商品编码 + 交付 product_type（新建 Share 档位写 SHARE，其余写 DEVICE；编辑保留已有 product_type）。营销档位不作为型号。只接受 CloudShare、S1、Pro、ProV2、RackP1、RackP2 六类；新建（含草稿）、首次上架和重新上架在后端直接命令、A2 预览／提案及批准回放均拒绝其他身份，422 `SKU_MODEL_UNRECOGNIZED`，失败不建票；已有无法识别型号的存量商品（包括带月目标的行）仍在目录显示并提供编辑、下架操作；抽屉及直接／A2 提交保留已存目标和带宽，原值回传不算重设目标。此类商品可改其他字段、可下架，不可上架／重新上架或新增、改变目标／带宽；目录复用商品编号的型号提示说明上架限制。后端已放行旧在售商品仅改无关字段，跳过 SKU_POOL_REQUIRED / SKU_DATACENTER_REQUIRED（2026-11-11 补，BE-E-01）。其他范围、任务池、托管、红线与审批校验不变。PC 新建在商品编号字段提示「商品编码需包含型号标识：s1、box、pro、pro-v2、rack-p1、rack-p2 或 share」，并用同文案映射后端错误。等级与目标输入正常展示，移除旧的不支持型号分支。`aurora-x + Pro` 拒绝，`acc-x-box + Pro` 按 S1；不改 E3 分类、交付类型、产能或结算。

「托管机房」为 SKU `datacenter` 自由文本（≤128 字，上架必填），用 `GET /api/admin/devices/sku-datacenter-labels` 提示已有写法，不与机房登记绑定。建议 `Singapore · SG-1`。设备交付时复制商品标签（推广赠机用冻结商品快照），改商品不改已交付设备。A2 摘要及完整审阅字段显示「任务等级」「托管机房」。处理 `SKU_POOL_REQUIRED/SKU_POOL_TARGET_REQUIRED/SKU_POOL_KIND_INVALID/MONTHLY_TARGET_CLEAR_FORBIDDEN_WITH_POOLS/SKU_DATACENTER_REQUIRED` 为明确中文。

**① 目的 & 对齐**
设备 SKU 的目录、定价、上下架与库存的统一运营面,是硬件 GMV 收入引擎的源头控制点。对齐前端 §7.1(商品列表 `/store`,6+ SKU 卡片)+ §9.11c.1(Device specs,`GET /api/products/specs` 收敛 `lib/store/index.ts` 的 `baseRate / baseRateNEX / price` 全表)。服务的业务目标:设备销售转化(§1.4 收入来源一·硬件 GMV)、回本叙事与首年 ROI 的全站口径管理、套餐折扣驱动多件购买的客单价提升。**E1 是设备规格的唯一权威源**,被 C1 用户画像 fleet 卡只读引用(§3.14)。

> **现行数据契约(2026-08-16)**：E1 与 UniApp 商城不是两份目录。商品编号、名称、档位、价格、双币日产、库存、销量、销售状态、代际和解锁阶段指针统一以 `nx_product` 为服务端交易真源；发布月份、资格前置、阶段偏移和强制解锁等运营规则由 `nx_admin_device_generation_gate` 管理。PC E1 通过 `/api/admin/devices/skus` 管理商品，UniApp 通过 `/api/store/catalog` 只读投影，询价与下单校验同一商品行。`nx_admin_device_sku` 仅作为兼容扩展表补充托管机房文字、功耗、AI 展示参数、功能列表、`baseRate` 展示串、媒体引用与结构化 `purchaseGate`；历史核心字段不能反向覆盖 `nx_product`。Sandbox 可复制库存以隔离验收写入，但读取时刷新可售项，提交时再次联查当前商品状态。完整编辑、上下架和删除均必须携 `X-Product-Revision`；revision 为 `DATETIME(6)`，任一商品或库存写入都至少单调前进 1 微秒，同秒并发也不能复用旧版本，冲突返回 409。

> **销售状态、发布阶段与用户成交资格必须分离**：当前 SKU API 的销售状态只接受 `on / off / pending`，`lifecycle` 只表达 `active / legacy`；未发布商品由 `unlockPhase` 和 E1 上架节奏门控制，不能再把 `coming-soon` 混入销售状态。App 的锁定卡是展示层；Gen-2 用户成交资格已由 E1 `purchaseGate` + 服务端 eligibility 复验闭环。E3 九类通用 eligibility 编辑器仍 HOLD，不得用其 HOLD 状态否定或覆盖 E1 当前完成项。

**② 后台界面**
SKU 目录管理台,自上而下三区:
1. **SKU 列表表格**:每行一个 SKU `[SKU key / 名称 / 代际 / saleStatus(on|off|pending) / lifecycle(active|legacy) / price / 双币日产 / stock / unlockPhase]`,行尾操作入口(编辑 / 上下架)。列表不得写死商品数量或名称，以 `nx_product` 当前记录为准；Pro v2 等新代际商品通过 `unlockPhase` 展示发布阶段，不使用 `coming-soon` 销售状态。
   > **注 1(SKU 数量跨文档差异)**:V1 §3.2 E1 行记录为「/store 商品表(6 SKU)」(V1 时前端现状),本表列出 7 个管理对象(含 Pro v2 / Genesis 目录位)。**差异为 V2 落地补入 Pro v2 后修正为 7 个 SKU**(消除 §3.2「6 SKU」与本章「7 对象」的隐性矛盾)。
   > **注 2(Cloud Share Premium 待确认)**:Cloud Share Premium(12 月节奏表 §3.3 月 10 新品)的 SKU 治理方案待确认——若为独立 SKU 则 E1 补入 SKU 列表 + E1 补入代际发布门;若为原地 tier 升级则在 status 逻辑中补充 Cloud Share 的 `premium` 状态;先经 PM 确认。当前 7 个管理对象未涵盖该新品。
2. **SKU 详情编辑抽屉**:编辑商品基本信息、价格、每件算力点、硬件规格、收益、库存、开放阶段、购买条件、资料及媒体等；无月收益目标时，份额型填写参考年奖励率区间与每日 UVT；有目标时显示目标对应的预估日区间与月金额。已有非份额商品的开放阶段为空时显示「请选择开放阶段」，不冒充已选首项；即使只有一个合法阶段也可明确选择。未选仍拒绝保存；没有可用阶段时显示「请先配置阶段」并禁用选择。任务等级及其他商品校验照常执行（BUG-150）。点击「保存修改」进入确认，填写理由后提交 A2，由另一名管理员审核通过后生效(E1a-MD2)。
3. **套餐折扣 ladder 面**:阶梯折扣配置(4 件 12% / 3 件 8% / 2 件 5%,对齐 §9.11c.1 `GET /api/config/cart/bundle-discount` + 前端 `lib/store/cart.ts`),驱动结算购物车多件购买。
4. **库存告警视图**:`stock < 50` 的 SKU 以橙色 `NN LEFT` 标注(对齐前端 §7.1 库存告警 `<50 时显示 NN LEFT 橙色`),供运营补货 / 控量决策。
5. **SKU 购买门配置区（E1，COMPLETE）**：结构化配置 `rankMin / activeDirectMin / teamVolumeMin / mode(all|either) / quotaCap / quotaSold / quotaPeriod / enforce`。App 先通过 `GET /api/store/purchase-eligibility` 获取当前用户决策；普通单、组合单、Sandbox 单、Trade-in 询价/提交及容量替换由服务端按同一规则复验。规则畸形或用户事实缺失时失败关闭；空门表示不附加用户条件。当前仅支持 `quotaPeriod=lifetime`；旧 `month` 数据保留读取但标记 HOLD、不可直接保存，待建立按自然月隔离的原子 usage 计数后再恢复。E3 九类通用 eligibility 编辑器另列 HOLD，不得作为本门的运行时实现。

**③ 可控参数**

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| `price`（各 SKU，USDT） | 编辑回显当前值 | > 0 | 仅新单(在途订单锁价,见 ⑦) | §7.1 ProductCard 价格行 / §7.2 详情 / 结账金额 |
| `computePoints`（每件算力点） | 编辑回显当前值，留空保留原值；新建留空按售价 × 10 | 不小于 0 的整数 | A2 审核通过后仅影响之后的订单 | 商品详情算力点、团队等级与配额 |
| 月收益目标 `monthlyTargetUsdt`（USDT） | 上架必填；已选等级时不得清空 | 1–1,000,000，最多 2 位小数；仅 Cloud Share、S1、Pro、Pro v2、Rack P1、Rack P2 六类，手机及其他未有产能规则的型号不适用 | 走现有 A2；批准后只影响新任务，运行中任务保持冻结金额 | App 商品卡、详情、设备卡、首页对比及新领取试用使用同源预估；PC 商品目录卡片同样显示精确月目标与预估日产，Share 显示预估日区间，只读运营可直接查看；月金额直接用目标 T，日均为 T/30 |
| 允许波动 `monthlyTargetBandPct`（%） | 有目标时必填 | 1–50，最多 1 位小数 | 与目标同票批准；持续运行的设备月区间为 T × 当期 E3 产能比例 ×（1 ± b），停机不补发 | Cloud Share 日区间为 T(1∓b)/30；每日收益有起伏，金额均标为预估 |
| 每日收益 USDT `dailyEarn`（满产能；原 `baseRate` 基准） | 编辑回显当前值 | 无目标时手填非负数，最多 6 位小数；有目标时隐藏手填，显示只读 T/30 | 无目标型号的已激活设备沿用购入时基准并叠加 E3；**目标型号的当前预估日产改用 T/30 × 当前产能比例**，已有订单和已领试用保持原记录 | 商品、设备卡、首页对比及回本估算；有 DEVICE 等级时不允许清空目标 |
| Cloud Share 参考年奖励率 `shareYieldMin / shareYieldMax`（%） | 无目标时回显当前区间 | 无目标时手填非负上下限，上限不小于下限；有目标时隐藏手填，由系统按 T(1∓b) × 365/30 ÷ 售价 × 100 计算百分数点 | 目标或售价获批后重新计算；有 DEVICE 等级时不允许清空目标 | 有目标时 App 和 PC 直接使用日区间与精确月目标，不从有限精度年率反算；每日 UVT 保持原规则 |
| 任务等级 `allowedPoolCodes` | 编辑回显，草稿可空 | DEVICE 等级多选，上架至少 1 个；选有等级须有月收益目标 | E1 A2 审批；已有发布历史追加策略版本，首次发布前仍为草稿 | 商品公开 taskLevels 仅包含已发布等级编号；App 展示等级文案，不展示具体任务内容 |
| 托管机房 `datacenter` | 编辑回显，可输入已有标签建议 | 最多 128 字，上架必填 | A2 获批后供新交付设备复制；已有设备保留快照 | 商品与设备托管标签原样展示 |
| 每日收益 UVT `dailyEarnNex`（原 `baseRateNEX`） | 编辑回显当前值 | ≥ 0 | 沿用现有生效规则；月目标只管 USDT，不改 UVT 日奖 | 商品双币收益副字；Cloud Share UVT 日奖仍按 UTC 日 |
| 回本天数（预估） | 根据当前售价与预估日均计算 | round(price / dailyEstimate)，目标型号 dailyEstimate=T/30 | 随价格与预估日均更新；不是实际到账承诺 | 商品与编辑抽屉估算 |
| 首年净收益（预估） | 根据当前售价与预估日均计算 | dailyEstimate × 365 − price | 随价格与预估日均更新 | 商品与编辑抽屉估算 |
| `monthlyPrice × installMonths` | 现状:installMonths=12(如 S1 `$119/mo × 12`) | installMonths 1–24 | 仅新单 | §7.1 价格行分期文案 |
| `stock`(各 SKU) | 现状值(`lib/store` 库存),`< 50` 触发橙色告警 | ≥ 0 | 实时(影响在售) | §7.1 库存告警 `NN LEFT` / 售罄态 |
| `saleStatus` / `lifecycle` | 销售状态与生命周期分列；新代际的待发布状态由 `unlockPhase` 表达 | saleStatus:`on\|off\|pending`; lifecycle:`active\|legacy` | 实时 | 商品是否可售 / LEGACY chip / 阶段锁定卡 |
| 套餐折扣 ladder | **现状值**:4 件 12% / 3 件 8% / 2 件 5%(§9.11c.1) | 各档 0–30% | 仅新购物车结算 | §9.11c.1 cart / 结算购物车多件折扣 |
| **购买门** `purchaseGate` | Gen-2 初始值：Pro v2 `V≥2`；Rack P2 `V≥4`；PC 可按结构化字段调整 | rank 0–12；直推/团队业绩非负；可选锁额配对 | 新询价/新成交实时；服务端最终授权 | App 目录/结算提示 + 普通/组合/Sandbox/换购/容量替换服务端复验 |

> **当前配置与预估收益**：价格、手填收益和目标均回显服务端当前值，不使用旧原型常量作为默认值。请求缺省目标与波动字段表示保留原值；有 DEVICE 等级时禁止 `clearMonthlyTarget=true`，PC 显示原因并拒绝提交。当前预估收益与新试用同源；新试用直接用 T/30，包括小额值，已领试用与已成交订单不重算。参与产能变化的型号按 E3 设置折算；Cloud Share 默认不参与，实际以 E3 配置为准。说明放进提示图标，收益区默认只显示字段、值与操作。

**④ 操作动作**

| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 上下架 SKU(`saleStatus` on / off) | 商品运营(lead) | 行内确认；影响在售目录 | `admin.product_listed` / `admin.product_unlisted`(SKU / before-after saleStatus / operator / reason) |
| 编辑商品（含价格、每件算力点、收益） | 商品运营(lead)/ 超管 | E1a-MD2（理由必填），提交 A2 双人审批 | SKU / 变更字段 / 修改前后值 / 发起人 / 审批人 / 理由 |
| 覆盖 stock | 商品运营 | SKU 编辑确认；库存只接受 0–2147483647 整数，并携商品版本防并发覆盖。`stock=0` 只形成售罄，不自动改销售状态；下架须另走状态动作 | admin 审计事件(SKU / before-after stock / operator) |
| 调套餐折扣 ladder | 商品运营(lead) | E1a-MD3(理由必填)(放大转化向,影响客单价与毛利) | `admin.product_price_changed`(scope=bundle-discount / before-after / operator / reason) |

> 2026-06 操作确认决议后,原复核层级转为执行门槛:上下架 / 调折扣执行权 = 商品运营 lead 层级(member 不可执行);调定价影响全站经济叙事,执行权就高 = 商品运营(lead)/ 超管。理由必填(server 强制非空 400 `REASON_REQUIRED`)。商品完整编辑按现行 A2 双人审批流程提交，另一名管理员审核通过后才生效，不在抽屉保存时直接更新商品。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 上下架 SKU | ②第 1 区 SKU 列表行尾「上下架」 | 行内按钮 | 仅商品运营 lead / 超管渲染；阶段未到由 `unlockPhase` 独立展示锁定，不复用销售状态 | 调用独立状态接口，行内确认后执行 |
| 编辑商品 | ②第 2 区 SKU 详情编辑抽屉「保存修改」 | 主按钮 | 仅商品运营 lead / 超管渲染；表单无变更时置灰；只改每件算力点即可启用，改回原值再次置灰 | 打开弹窗 E1a-MD2 |
| 覆盖 stock | ②第 1 区 SKU 列表行尾「改库存」 | 行内按钮 | 商品运营及以上渲染 | 随完整 SKU 编辑提交；接受 0，显示售罄但不自动下架；携 `X-Product-Revision` 防止覆盖并发扣库存 |
| 调套餐折扣 ladder | ②第 3 区套餐折扣 ladder 面「保存折扣配置」 | 主按钮 | 仅商品运营 lead / 超管渲染;各档未变更时置灰 | 打开弹窗 E1a-MD3 |
| 查看库存告警视图 | ②第 4 区导航 tab | 链接 | 恒可用 | 跳转视图,无弹窗 |

**(2) 弹窗规格(逐弹窗)**

##### [E1a-MD1] 上下架 SKU 确认
- **功能**:切换单 SKU 的销售状态 `saleStatus`(`on` / `off`)，确认即生效，仅影响在售目录；`lifecycle`(`active` / `legacy`)与 `unlockPhase` 是独立字段，不能借上下架接口改写。
- **布局结构**:1. **信息区**:SKU key / 名称 / 代际 / 当前 saleStatus / lifecycle / unlockPhase / stock / price。2. **影响预览区**:展示「before saleStatus → after saleStatus」与受影响商城入口；`stock=0` 只显示售罄，阶段未到只显示锁定。3. **输入区**:见下表。4. **按钮区**。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 saleStatus | 下拉单选(on / off) | 是 | 仅切换销售状态；不得与当前值相同 | 当前 saleStatus |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认上下架]`(主按钮;必填未过校验 / eligibility 阻断时置灰;提交 loading 防双击)。
- **错误态**:400 `REASON_REQUIRED` / 409(销售状态已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;列表行 saleStatus 就地更新;toast「SKU 已上下架 · 已记审计」;事件 `admin.product_listed` / `admin.product_unlisted` 落 A2;实时告警超管 / 商品运营 lead。

##### [E1a-MD2] 商品编辑抽屉与确认
- **功能**:完整编辑单 SKU，确认后提交 A2，由另一名管理员审核通过后生效。价格和每件算力点仅影响之后的订单，在途订单沿用快照。
- **变更判定（BUG-088，2026-11-04）**:S1、Pro、Pro v2、Rack P1、Rack P2、Cloud Share 打开编辑抽屉但未输入时，「保存修改」置灰；只改「每件算力点」即可启用，改回原值再次置灰。编辑时清空算力点表示保留原值，不单独构成修改；变更判断、提交摘要及提交商品均使用该原值。新建留空仍按售价 × 10。数字与表示同一数值的输入文本视为相等。「收益展示串」是派生字段，其差异不算运营修改；按钮、进入确认及提交前的无修改检查使用同一规则，仅展示串不同不能提交提案。
- **提交摘要与 A2 详情**:任一真实字段有改动时，保存的商品及前端提交给 A2 的变更摘要保留全部差异，包括自动计算的展示值。月收益目标或允许波动单独修改也构成真实变更，摘要分别显示两项的变更前后值；有目标时自动计算的日收益与年率差异不单独算运营输入变化。Cloud Share 每次保存仍按当前收益参数刷新展示串，避免旧的美元日产文案继续留在数据中。前端提交摘要按核心字段优先排列，「每件算力点」列于前部，按整数显示；只改算力点时列出「每件算力点：旧值 → 新值」，Share 原展示串过期时另列「收益展示串」前后值，原展示串已是最新时不重复列出。这些字段顺序和仅列变化的规则只针对前端提交摘要；A2 详情与批准确认均展示系统保存的完整前后值；月收益目标按 USDT 金额、允许波动按 ±x%、清空操作按「关闭月收益目标：是／否」显示，同票恢复的每日收益带 USDT/日、Share 参考年奖励率上下限带 %，未设置值保留「未设置」。
- **抽屉相关输入**（其他商品字段沿用②及商品规格联动补充；理由在后续确认中填写）:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 price(USDT) | 数字输入 | 否(至少改一项) | > 0(③ 参数表范围);client 即时校验 + server 复核 | 当前值 |
| 每件算力点（computePoints） | 数字输入 | 否(至少改一项) | 不小于 0 的整数；编辑留空保留原值，新建留空按售价 × 10 | 当前值 |
| 月收益目标（monthlyTargetUsdt）/ 允许波动（monthlyTargetBandPct） | 数字输入 + 提示图标 | 支持的六类型号上架或选有任务等级时目标必填，波动同时必填 | 目标 1–1,000,000 / 最多 2 位小数；波动 1%–50% / 最多 1 位小数；存量其他型号显示原目标／带宽并原样提交，拒绝新增或修改目标／带宽，并显示型号提示、阻止上架 | 当前值 |
| 每日收益 USDT / UVT（dailyEarn / dailyEarnNEX） | 数字输入；有目标时 USDT 改只读预估行 | 有 DEVICE 等级时不能清空目标；UVT 沿用原规则 | 非负数；有目标时 USDT 直接按目标计算，不提交隐藏手填值 | 未配置等级的草稿保留原值 |
| 共享份额参考年奖励率下限 / 上限（shareYieldMin / shareYieldMax） | 无目标时数字输入 | 有 DEVICE 等级时不提供清空目标路径 | 非负数且上限不小于下限；有目标时隐藏手填，只读显示日区间与月目标 | 未配置等级的草稿保留原值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:抽屉 `[取消]` · `[保存修改]`；无业务变更、名称或售价为空、媒体仍在上传或未上传成功时不能保存。点击后按现有字段校验进入操作确认，填写理由并提交审批。
- **错误态**：目标或波动超出范围、已选等级但清空目标时明确拒绝；任务池不符合要求时显示受影响型号与调整要求。批准目标放大未通过兑付覆盖率检查时保留待审；商品版本冲突返回 409，提示刷新当前值。理由、权限及其他字段继续沿用各自校验。
- **成功反馈**:提案进入 A2 待审，商品此时仍显示原值；审核通过后重新读取商品，核对新值及审计记录。
- **改版集成的月收益原操作恢复（2026-11-09）**：有月目标或显式关闭目标的商品提案，提交前在本标签页保存原对象、完整提案、理由和命令号，存不下不发；结果未知时该商品不能再提交其他修改。刷新后仍保留，只能按原请求重试；重试被 `isExplicitRejection` 认定为明确拒绝后，核实原结果才可解除本地待确认。超过 24 小时保留记录并停止重试。A2 批准／驳回使用既有同号恢复流程；目标变化单的执行摘要区分关闭与保留目标：关闭写「批准后关闭月收益目标，之后新建的任务恢复按单计价；已建任务和历史到账不变」，保留目标写「批准后按新目标建立后续任务；已建任务和历史到账不变」，批准人说明使用实际商品修改权限名称。批准入口按 `device_e1_write` 和 A2 批准权判断，驳回只要求 A2 批准权，发起人不能处理自己的申请。
- **月收益审批第二轮展示修正（2026-11-09，基于 `5c196202`）**：关闭目标单的队列摘要先写「关闭月收益目标」，第二行列改后的日产收益（USDT/日）或年奖励率区间（%）；开启、提高目标沿原摘要。详情与确认共用布尔前后值格式，已知布尔项按真实默认值展示：关闭目标、允许试用的空值显示「否」；购买限制 enforce 由后端要求非空，合法布尔值照实展示，历史空值不推断默认，显式关闭显示「否 → 是」，金额等非布尔空值仍为「未设置」。
- **金额域拒绝提示**：按后端 `abaf9207` 的 `MONTHLY_TARGET_REWARD_OUT_OF_RANGE` 显示「月收益目标对应的任务奖励金额超出允许范围」，提醒核对目标、波动和设备产能；回包有 `maxRewardUsdt` 时保留原精度显示单笔任务奖励上限，有 `affectedSkuIds` 时按商品目录解析受影响型号（包含下架型号，名称不可读则保留编号）。这不是月目标输入上限或承诺到账额。A2 和 E1 共用同一提示；缺少受影响型号时明确写信息缺失，不编造上限。原审批／提案的结果判定与 R1 恢复规则不变。

- **本轮核对边界（2026-11-09）**：集成 `66a7767c`，行为补充 `51b60bf4`／`465358d9`。本地后端事实按 `abaf9207`；页面只读预览已打开硬件／Share月目标编辑及清空控件，增长账号可编辑、审计只读，A2月目标单及原号恢复由页面内拦截响应验证。未实际发布商品、批准目标或验证真实任务到账；不据此宣称公共 TEST 联合验收通过。

##### [E1a-MD3] 调套餐折扣 ladder 确认
- **功能**:更新阶梯折扣(4 件 / 3 件 / 2 件档)，提交审批，批准后仅新订单结算使用新折扣。

2026-11-11 E1 复查：组合购折扣沿审批后生效，既有订单不变。确认框仅保留一组完整前后值对照及三档输入，不另列当前值；未改时禁提交。仅任一档折扣调高时显示支出放大警示。按后端 `fdc9f469` 核对，折扣提交与批准均不检查兑付覆盖率；提交参数、放大标记、版本和命令号沿原流程。
- **布局结构**:1. **信息区**:当前 ladder 三档(4 件 12% / 3 件 8% / 2 件 5%)。2. **影响预览区**:before→after 并排展示三档;提示行「放大折扣提升客单价转化、压缩毛利,仅新购物车结算生效」。3. **输入区**:见下表。4. **按钮区**。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标折扣(4 件档,%) | 数字输入 | 是 | 0–30%(③);须 ≥ 3 件档(阶梯保序,server 复核) | 当前值 |
| 目标折扣(3 件档,%) | 数字输入 | 是 | 0–30%(③);须 ≥ 2 件档 | 当前值 |
| 目标折扣(2 件档,%) | 数字输入 | 是 | 0–30%(③) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认调折扣]`(主按钮;越界 / 失序 / reason 未达标置灰;loading 防双击)。
- **错误态**:400(越界或阶梯失序,内联警示)/ 400 `REASON_REQUIRED` / 409(提示刷新)/ 403。
- **成功反馈**:弹窗关闭;ladder 面就地更新;toast「套餐折扣已更新 · 已记审计」;事件 `admin.product_price_changed`(scope=bundle-discount)落 A2;实时告警超管 / 商品运营 lead。

**⑤ 接口**
收敛前端 §9.11c.1 Device specs 种子:
- `GET /api/admin/devices/skus` · `GET /api/admin/devices/skus/:skuKey` — PC E1 返回 `nx_product` 交易核心及 `nx_admin_device_sku` 运营扩展；App `GET /api/store/catalog` 从相同 `nx_product` 投影当前可售集合。商品身份、价格、双币日产、库存、销量和销售状态不得从兼容表或客户端常量补回；`baseRate` 目前仍是 E1 扩展展示串，不能宣称已迁入 `nx_product`。
- `POST /api/admin/devices/skus` · `PUT /api/admin/devices/skus/:skuKey` · `PATCH /api/admin/devices/skus/:skuKey/status` · `DELETE /api/admin/devices/skus/:skuKey` — 新增、更新、上下架和软删除均在同一事务内先写 `nx_product`，再同步 E1 扩展。PUT、PATCH 和 DELETE 除理由及幂等键外，都必须把最近一次 GET 响应体中的 `updatedAt` 作为 `X-Product-Revision` 请求头；缺失或过期返回 409，客户端刷新后重新操作。库存允许 0，但不会自动改写销售状态。
- `purchaseGate` 已启用：PC E1 可保存结构化门，App 可查询当前用户资格，普通/组合/Sandbox 下单、Trade-in 和容量替换均在服务端复验；非法配置或事实缺失失败关闭。配额字段仅在成对有效时启用，Sandbox 配额消费限定 RunID 隔离目录。
- `PUT /api/admin/config/cart/bundle-discount` — 套餐折扣 ladder(对齐 §9.11c.1 `GET /api/config/cart/bundle-discount`;确认弹窗 E1a-MD3,body 携 reason)。

**⑥ 权限 & 审计**

| 动作 | 商品运营 | 超管 | 财务 | 只读审计 |
|---|---|---|---|---|
| 查看 SKU 目录 / 规格 | ✅ | ✅ | ✅ | ✅ |
| 覆盖 stock | ✅ | ✅ | — | — |
| 上下架 SKU | ✅(lead) | ✅ | — | — |
| 调定价 / 每日收益 / 月收益目标 | ✅(lead) | ✅ | — | — |
| 调套餐折扣 | ✅(lead) | — | — | — |

> 「✅(lead)」指商品运营角色的 lead 层级(商品运营主管),member 不可执行(2026-06 操作确认决议:原复核层级转为执行门槛)。审计记录字段引用 A2 统一 schema(§2.4 ⑥ / Ch2 A2):`action_type / skuKey / before / after / operator / reason / IP / ts`。

**⑦ 风控 & 联动**
- **定价 server-canonical**:price / baseRate / baseRateNEX 服务端唯一权威,client(`lib/store`)仅 UI cache(§9.11d.2 设备类常量篡改防御外推:定价不可由 client 决定)。结账金额、回本天数、ROI 全部 server 计算并下发。
- **调价仅影响新单,在途锁价**:已 `placed` 未 `paid` 的订单按下单时价格结算(订单快照价),改价 `effectiveAt` 后仅对新 `placed` 订单生效,避免「支付中价格漂移」。
- **stock 与销售状态分离**:`stock=0` 表示当前售罄，不等于下架；服务端不自动改写 `saleStatus`。恢复库存后能否重新可售仍取决于独立销售状态与阶段门，避免库存写入偷偷改变商品生命周期。
- **月收益目标放大在批准执行时检查 B1**：开启目标、提高 T×(1+b) 由服务端根据批准前后值判定为放大；有 DEVICE 等级时禁止清空目标；前端不自行标记放大。批准执行先检查兑付覆盖率，低于红线返回 `COVERAGE_BELOW_REDLINE`，商品及策略不变，票据保持待审。普通价格、手填收益和套餐折扣继续执行各自现行审批与风控规则。
- **目标与任务池一起校验**：启用目标或修改可跑任务范围时，候选任务只能是正额 USDT、时长不超过 120 分钟。E2 随机新增或批量启用按最终候选统一校验（含下架存量设备），直接生效免 A2 与覆盖率；E1 和 PHONE 的原 A2 回放仍保留相应校验；不合规拒绝可返回 `MONTHLY_TARGET_POOL_INELIGIBLE` 及 `affectedSkuIds`，PC 显示受影响型号名称和修改要求。合法候选池为空时沿用 `WAITING_CONFIG`，设备不运行、不累计应得。
- **只改目标也发布策略**：已有发布历史时沿用已发布任务范围，包含已下架但仍有存量设备的型号；同票批准范围变更或首次上架时使用本票批准的范围；从未发布过的商品只存草稿，首次上架时一起发布。有 DEVICE 等级时禁止清空目标；缺省字段不清空原目标。
- **购买门服务端授权**:`purchaseGate` 由 E1 保存并下发只读展示，App 客户端只做预提示；最终授权在普通/组合/Sandbox 下单、Trade-in 与容量替换入口由服务端执行，客户端不能放行或覆盖。
- **联动**:E1 的 `unlockPhase` 仅负责阶段锁定展示，`saleStatus` 独立控制是否在售，E1 `purchaseGate` 负责 Gen-2 用户成交授权并由服务端复验，E3 衰减曲线决定 legacy SKU 的终身产出节奏；C1 fleet 卡引用本规格表(§3.14)。E3 九类通用 eligibility 编辑器的 UI/运行时映射仍 HOLD；该 HOLD 不回退已完成的 E1 `purchaseGate`。

**⑧ 埋点(事件)**
对齐 A4(§2.4.5 ②转化 family + ⑥ admin family):
- **消费(转化漏斗,§2.4.5 ②)**:`store.viewed`(商城浏览,← 漏斗 L2→L3,§2.4.7)· `product.detail_viewed`(SKU 详情曝光,归因哪些 SKU 被看)· `checkout.completed`(首购 / 复购成交,← L3→L4),用于 E1 的「SKU 维度转化漏斗」(浏览→详情→成交)与定价调整前后的成交率归因。
- **产生(admin 审计,§2.4.5 ⑥ admin family,须 A4 schema registry 注册)**:
  - `admin.product_listed` / `admin.product_unlisted` — 触发点:SKU 上下架确认执行(E1a-MD1);属性 `skuKey / before_status / after_status / operator / reason / ts`;喂 L3 财务报表(在售目录变更)+ 审计。
  - `admin.product_price_changed` — 触发点:定价 / baseRate / baseRateNEX / installMonths / 套餐折扣确认执行(E1a-MD2 / E1a-MD3);属性 `skuKey / scope(price|baseRate|baseRateNEX|installMonths|bundle-discount) / field / before / after / effective_at / operator / reason / ts`;喂 B4 节奏态势(改价对转化的影响归因)+ L3 + 审计。
- 库存覆盖、纯查看仅落 A2 审计记录,无独立 KPI 事件(运营内部目录治理,无用户侧事件)。

---

#### [E1b] 代际发布门

**① 目的 & 对齐**
控制 Gen-2 新品(Pro v2 / Rack P2)的发布时点与 trade-in 折扣,制造代际升级的稀缺感与升级窗口紧迫感。对齐前端 §7.1(`Product.unlocksAtPhase` 代际发布门 + 底部 "Next generation" 锁定区)+ 12 月节奏表 §6.2(`GENERATION_RELEASES`)。服务的业务目标:首波 / 末波代际升级转化(§1.4 硬件 GMV 复购)、配合 12 月节奏 P3/P5 升级窗口放大 trade-in 漏斗(联动 E3)。

**② 后台界面**
1. **代际发布时点表**:每个 Gen-2 SKU 一行 `[SKU / 计划发布月(按 H1 Phase 月龄)/ releaseState(locked / released)/ saleStatus(on / off)/ tradeinDiscount(抵扣额 USDT)/ 距发布剩余 / 提前·延迟开关]`。
2. **提前 / 延迟开关**:对单 SKU 调整发布时点(相对 H1 Phase 月龄拐点提前 / 延后),或**强制解锁单 SKU**(将 releaseState 从 locked 变为 released，绕过月龄门，应急放量用；不自动把已下架商品改为 on)。
3. **trade-in 折扣编辑**:每个 Gen-2 SKU 的代际抵扣额(`TRADEIN_UPGRADE_MAP`,E3 落地置换扣减,E1 持发布侧折扣登记),与 E3 的 salvage 残值叠加构成净付。
   > **注**:Cloud Share Premium(12 月节奏表 §3.3 月 10 新品)若为独立 SKU,须在本代际发布门补入相应发布节点;若为原地 tier 升级则不进发布门,仅在 E1 status 逻辑承载。当前代际发布节点(Pro v2 / Rack P2)未涵盖该新品,先经 PM 确认。

**③ 可控参数**

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| `GENERATION_RELEASES` 发布月(`releaseMonth`,绝对月) | **12 月节奏表 §6.2 权威**:月 5 `stellarbox-pro-v2`、月 10 `stellarrack-p2`(产品标识符为 §6.2 kebab-case key) | 月 1–12 | 仅新对象(到月龄门后 releaseState 由 locked 变为 released，saleStatus 不变) | §7.1 列表分组(已发布→ProductCard / 未发布→LockedProductCard)/ §7.2 ProductDetailGate |
| `tradeinDiscount`(代际抵扣 USDT) | **§6.2 权威**:`stellarbox-pro-v2` $300、`stellarrack-p2` $800(与前端 `TRADEIN_UPGRADE_MAP`:S1/Pro→Pro v2 −$300、Rack P1→Rack P2 −$800 一致) | ≥ 0 | 仅新置换单 | §7.1 代际映射 / §7.6 TradeinWindowBanner 折扣文案 / E3 置换净付 |
| `unlocksAtPhase`(仅前端现状映射字段,参考) | **前端 §7.1 现状**:`stellarbox-pro-v2` = `P3` / `stellarrack-p2` = `P5`。Phase→月龄语义见下「冲突裁决」注 | P1–P6 | 仅新对象 | §7.1 / §7.2 phase gate 渲染 |
| 提前 / 延迟 / 强制解锁开关 | 关(按 §6.2 月龄门自动派发) | per SKU 布尔 + 偏移月 | 实时(影响释放判定) | §7.1 锁定区显隐 |

> **默认值口径与冲突裁决(§7 硬规则;已回源核实)**:发布时点**以 12 月节奏表 §6.2 为权威——月 5 `stellarbox-pro-v2` / 月 10 `stellarrack-p2`**。`unlocksAtPhase` 为**仅前端现状映射字段,后台不直接配置此值;后台以 `releaseMonth`(绝对月)为配置单位**。
> - **Pro v2(P3)经源码核实与 §6.2 月 5 一致,无差异**:原型 `lib/store/product-phase.ts` 定义 P3 `monthsFrom: 4`(`monthsTo: 6`),而 `getMonthsSince` 返回「已**经过**的月数」、`getPhaseForMonth` 以 `month >= monthsFrom` 匹配——即经过 4 个月后进入 P3,对应平台第 5 个月起,**与 §6.2 月 5 完全一致**。故 Pro v2 不存在月份差异。
> - **Rack P2(P5)与 §6.2 月 10 存在 1 个月真实差异**:P5 `monthsFrom: 8` 即经过 8 个月后进入 P5(平台第 9 个月起),而 §6.2 记为月 10,**差 1 个月**。**冲突以 §6.2 的月 10 为准**;该 Rack P2 差异条目(`Rack P2 P5(monthsFrom=8 → 月 9)vs §6.2 月 10`)**须在 V4 跨文档收口时补入 V1 §3.15 附录 A(前端内部矛盾清单)**,使 V4 收口 checklist 可追踪(供开发对齐 Phase→月龄阈值或改用绝对发布月)。E1 的发布派发以 H1 Phase 月龄为驱动源(§1.7),E1 调发布时点与折扣,不持 Phase 权威。

**④ 操作动作**

| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 提前 / 延迟代际发布(调发布月,联动 H1 Phase 月龄门) | 商品运营(lead)/ 超管 | E1b-MD1(理由必填)(影响全站新品供给与升级窗口节奏) | `admin.generation_released`(SKU / 计划→实际发布月 / 偏移 / mode=schedule-advance\|schedule-delay / operator / reason) |
| 强制解锁单 SKU(`locked → released`,应急放量) | 商品运营(lead)/ 超管 | E1b-MD2(理由必填)(绕过月龄门,应急放量,弹窗强制展示 E3b eligibility 校验结果) | `admin.generation_released`(SKU / mode=force-unlock / operator / reason) |
| 调 `tradeinDiscount`(代际抵扣额) | 商品运营(lead) | E1b-MD3(理由必填)(放大置换转化向,影响 GMV 与应付) | `admin.generation_released`(SKU / mode=discount-change / field=tradeinDiscount / before-after / operator / reason) |

> 2026-06 操作确认决议后,原复核层级转为执行门槛:调发布月 / 强制解锁原复核为超管层级,执行权就高 = 商品运营(lead)/ 超管;调 `tradeinDiscount` 原复核为商品运营 lead 层级,执行权 = 商品运营(lead)。所有确认弹窗动作经理由必填(server 强制非空 400 `REASON_REQUIRED`)即时生效,落 A2 审计并实时告警超管 / 商品运营 lead。`tradeinDiscount` 调升放大置换转化与应付,但不构成即时资金流出(同 E1a⑦ 口径),不前置 B1 红线预检。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 提前 / 延迟代际发布 | ②第 1 区发布时点表行尾「提前·延迟开关」 | 行内按钮 | 仅商品运营 lead / 超管渲染;releaseState 已 released 时置灰(已释放不可回拨) | 打开弹窗 E1b-MD1 |
| 强制解锁单 SKU（阶段释放能力） | ②第 2 区「强制解锁」 | 行内按钮(警示色) | 仅商品运营 lead / 超管渲染;releaseState 已 released 时置灰;force-unlock 阶段释放操作仍 HOLD；不影响已完成的 E1 `purchaseGate` | 打开弹窗 E1b-MD2 |
| 调 tradeinDiscount | ②第 3 区 trade-in 折扣编辑「保存抵扣额」 | 主按钮 | 仅商品运营 lead / 超管渲染;表单无变更时置灰 | 打开弹窗 E1b-MD3 |
| 查看发布时点表 / 距发布剩余 | ②第 1 区 | 只读视图 | 恒可用 | 就地查看,无弹窗 |

**(2) 弹窗规格(逐弹窗)**

##### [E1b-MD1] 调代际发布月确认
- **功能**:对单 Gen-2 SKU 调整发布时点(相对 H1 Phase 月龄拐点提前 / 延后),确认即生效,影响释放判定。
- **布局结构**:1. **信息区**:SKU key / 名称 / 当前 status / §6.2 计划发布月 / 当前生效发布月 / 距发布剩余。2. **影响预览区**:before→after 发布月并排展示 + 偏移量(±N 月);提示行「提前放量与延迟放量对转化节奏含义相反(B4 按 mode 分向归因)」;与 H1 Phase 拐点 checklist 的协同提示(⑦ 联动 H1)。3. **输入区**:见下表。4. **按钮区**。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标发布月(releaseMonth,绝对月) | 数字输入 | 是 | 月 1–12(③ 范围);不得与当前生效值相同;client 即时校验 + server 复核 | 当前生效发布月 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认调整发布月]`(主按钮;未变更 / 越界 / reason 未达标时置灰;loading 防双击)。
- **错误态**:400(月份越界,server 回传允许范围,弹窗不关内联警示)/ 400 `REASON_REQUIRED` / 409(发布门配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;发布时点表行就地更新(计划→实际发布月 + 偏移标记);toast「发布月已调整 · 已记审计」;事件 `admin.generation_released`(mode=schedule-advance|schedule-delay)落 A2;实时告警超管 / 商品运营 lead。

##### [E1b-MD2] 强制解锁 SKU 确认
- **功能**:目标能力是将单 Gen-2 SKU 的 `releaseState` 从 `locked` 变为 `released`，且不改 `saleStatus`；该“强制释放阶段门”仍为 **HOLD**，仅表示运营阶段覆盖能力未签发，不回退已完成的 E1 `purchaseGate` 用户成交授权。
- **布局结构**:1. **信息区**:SKU key / 名称 / 当前 status / §6.2 计划发布月 / 距计划发布剩余。2. **影响预览区(必有)**:**「绕过 H1 月龄门,全体用户立即可购」红色警示条恒显**;E1 阶段释放谓词校验结果回显(server 预检下发;阶段规则为空时阻断警示条 + 确认钮置灰,文案含「server 将拒绝(400),force-unlock 不豁免」);提示行「释放后不可自动回收,回退须经 E1a 上下架(E1a-MD1)」。3. **输入区**:见下表。4. **按钮区**。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认强制解锁]`(警示色主按钮;eligibility 阻断 / reason 未达标时置灰;loading 防双击)。
- **错误态**:400(E1 阶段释放谓词为空,弹窗不关,内联阻断条)/ 400 `REASON_REQUIRED` / 409(SKU 已被释放,提示刷新)/ 403。
- **成功反馈(完成阶段释放服务端复核后)**:弹窗关闭;发布时点表 releaseState 就地更新为 released，E1a saleStatus 保持原值;toast「SKU 已强制解锁 · 已记审计」;事件 `admin.generation_released`(mode=force-unlock)落 A2;实时告警超管 / 商品运营 lead。该动作不改变 E1 `purchaseGate` 判定。

##### [E1b-MD3] 调 tradeinDiscount 确认
- **功能**:更新单 Gen-2 SKU 的代际抵扣额(`tradeinDiscount`),确认即生效,仅新置换单生效。
- **布局结构**:1. **信息区**:SKU key / 名称 / 当前 tradeinDiscount(§6.2 权威值对照)。2. **影响预览区**:before→after 抵扣额并排展示;**置换净付预览**(代际抵扣 + E3 salvage 残值叠加构成净付的示例换算);提示行「调升放大置换转化与应付 GMV 让利,仅新置换单生效」。3. **输入区**:见下表。4. **按钮区**。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 tradeinDiscount(USDT) | 数字输入 | 是 | ≥ 0(③ 范围);不得与当前值相同;client 即时校验 + server 复核 | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认调抵扣额]`(主按钮;未变更 / 越界 / reason 未达标时置灰;loading 防双击)。
- **错误态**:400(数值越界,内联警示)/ 400 `REASON_REQUIRED` / 409(提示刷新当前值)/ 403。
- **成功反馈**:弹窗关闭;折扣编辑面就地更新;toast「代际抵扣已更新 · 仅新置换单生效 · 已记审计」;事件 `admin.generation_released`(mode=discount-change)落 A2;实时告警超管 / 商品运营 lead。

**⑤ 接口**
- `GET / POST / PATCH / DELETE /api/admin/devices/e1/generation-gates[/{skuId}]` — 上架节奏配置接口已启用，持久化 `releaseMonth / phase / eligibility / phaseOffset / forceUnlock / status` 等规则并由 E1 列表和上架前置校验消费；PC BFF 对应 `/api/admin/e1/generation-gates[/{skuId}]`。它不替代商品核心字段，也不直接授予某个用户购买资格。
  - **阶段释放与成交授权分轨**:服务端按 `releaseMonth`/账户 Phase 复核 E1 阶段释放；`force-unlock` 不改变 `saleStatus`，也不得旁路 E1 `purchaseGate`。Gen-2 用户购买资格已由 E1 `purchaseGate` 在普通/组合/Sandbox 下单、Trade-in 与容量替换入口复验；E3 九类通用 eligibility 编辑器仍 HOLD。
- 读取侧由 `nx_product` 商品核心 + `nx_admin_device_generation_gate` 运营规则 + H1 Phase 共同投影；App 锁定卡只是 UI 提示，不能替代订单授权。

**⑥ 权限 & 审计**

| 动作 | 商品运营 | 超管 | 只读审计 |
|---|---|---|---|
| 查看发布门配置 | ✅ | ✅ | ✅ |
| 提前 / 延迟发布 | ✅(lead) | ✅ | — |
| 强制解锁 SKU | ✅(lead) | ✅ | — |
| 调 tradeinDiscount | ✅(lead) | ✅ | — |

> 「✅(lead)」指商品运营角色的 lead 层级,member 不可执行(2026-06 操作确认决议:原复核层级转为执行门槛)。审计字段引用 A2 统一 schema:`skuKey / before / after / mode / operator / reason / ts`。

**⑦ 风控 & 联动**
- **上架前置与成交授权均已服务端闭环（COMPLETE）**：E1 上架动作读取服务端 generation gate，校验阶段、发布时间与 eligibility 前置；同时普通下单、组合下单、Sandbox、Trade-in 与容量替换均在提交前按用户 Phase/资格由服务端最终复核，客户端不能绕过或覆盖该授权门。Pro v2 默认 V≥2、Rack P2 默认 V≥4。
- **发布释放与 eligibility 互锁**：Gen-2 SKU 在 E1 转为在售前，以 generation gate 的 eligibility 标记、阶段及发布时间为前置，规则不满足则服务端阻断上架；成交入口另由 E1 `purchaseGate` 服务端复核。E3 九类通用 eligibility 编辑器仍为未来扩展 **HOLD**，不覆盖、旁路或否定当前已完成的 E1 成交授权。
- **联动 H1**:调整发布月须在 H1 调度的 Phase 拐点 checklist 中评估(代际发布与 P3/P5 升级窗口协同,§1.7);E1 提前 / 延迟为 H1 Phase 推进的连带项之一。
- **联动 E3 / E1**:发布释放 → E1 SKU `status` 转 active;`tradeinDiscount` 与 E3 salvage 残值叠加构成置换净付(E3 落地置换 tx)。

**⑧ 埋点(事件)**
对齐 A4(§2.4.5 ⑥ admin family):
- **产生(admin 审计,须 A4 schema registry 注册)**:`admin.generation_released` — 触发点:代际发布门确认执行(提前 / 延迟 / 强制解锁 / 改折扣,E1b-MD1 / E1b-MD2 / E1b-MD3);属性 `skuKey / mode(schedule-advance|schedule-delay|force-unlock|discount-change) / planned_month / effective_month / tradeinDiscount / operator / reason / ts`;**`mode` 区分提前(`schedule-advance`)/ 延迟(`schedule-delay`)/ 应急强制(`force-unlock`)/ 折扣调整(`discount-change`),供 B4 按方向聚合转化影响(提前放量与延迟放量对转化节奏含义相反,不合并为同一 mode)**;喂 B4 节奏态势(代际发布拐点)+ L3 财务报表(新品供给变更)+ 审计。
- **消费(间接)**:代际发布的转化效果由 E1 `store.viewed` / `product.detail_viewed`(Gen-2 SKU 维度)+ E3 `device.replaced`(置换成交)反映,E1 不另立用户侧事件(发布门为配置项)。

---

#### [E2] 任务池

E2、E5、E6 设备与任务原命令共用核查入口：超过 24 小时或后端结果未知时沿用现行核查权限；最新查询仍为 `PROCESSING` 时不显示结案入口，原记录和锁继续保留。依据后端 `66ecdb47` 的 `AdminCommandInvestigationService.investigate`，超期不改变处理中不可结案的规则。

**2026-11-12 后端同步（代码侧）**：随机添加与批量启停仍在 JSON 中保存原 `idempotencyKey`，24 小时内只原样重试。原「读回核对」同时用原命令号、POST 方法和完整 `/api/admin/devices/task-pools/...` 路径查询服务器绑定；查询为空、403、UNKNOWN/PROCESSING 均保留原记录与锁。共享调查客户端只向服务器提交 `scope/commandKey/requestHash/conclusion/evidenceReference/evidenceAuditId?`，scope/hash 来自查询，不由浏览器生成；仅持调查权限及本页读权的在职超管可提交。SUCCEEDED/NOT_EXECUTED/STILL_UNKNOWN 是待服务器验证的结论，缺有效证据不能解锁。受控结案的新入口和证据表单由视觉 worker 接入 `checkE2Command(record, evidence)`；本轮没有增加界面。

**① 目的 & 对齐（2026-11-10）**：运营维护用户设备可跑的任务等级。等级只决定跑什么任务，收益由 E1 已发布的月收益目标配平。DEVICE 与 PHONE 完全隔离。

**② 后台界面**：菜单与标题为「任务池」。页首一句候选结论，下面四张可选择的等级卡：「L1 初级」「L2 中级」「L3 高级」「L4 旗舰」。每卡主数为启用任务数，附总数、启用比例、0–120 分钟平均时长尺、服务端返回的「约 N 单/台/天」与三态商品使用小计；选中卡连接下方唯一任务表。1440 四列，1024 两列两行，不提供新增、改名或删除等级。列表默认只显示勾选、英文原任务名、类型标签、时长和启用状态，提供类型／状态筛选、分页、随机添加、批量启停；不显示价格、奖励或权重。商品引用完整名单按已发布／草稿／已下架有设备分组放在提示气泡，口径、生成规则和技术信息进问号／指南。四池同次读取后，联合非草稿 productKey 判断所有候选等级是否均无启用任务；按真实没有候选商品数 N 提示后果；N=0 时不误报商品无候选，四级全部无启用任务时仍警示四级全空。

**③ 可控参数**：固定 L1 初级、L2 中级、L3 高级、L4 旗舰；编号、level、名称与 kind 不可编辑，不提供等级增删改。随机添加数量为 1–50，可选六类过滤，理由 8–200 字；首次提交前完整保存原等级快照、POST 方法／路径／body、数量与类型或原 ids／目标状态、理由、操作者、命令号和首次时间；持久保存失败不发送。结果未知冻结本次意图并锁住本等级三种新写入，同标签页刷新恢复，只能原样重试。后端按 body 中的命令号与内容哈希 retained 去重。首次 24 小时后保留记录和锁，禁止重发；401／403／408／425／429、所有 IDEMPOTENCY_* 和 TASK_POOL_IDEMPOTENCY_CONFLICT 均不允许解除。只有原样重试得到明确业务拒绝后，人先核实才可解除本地记录；不替代后端核查结案。每级最多 200 个启用任务、300 个总任务（含停用）。名称由服务端按英文目录生成，同池不重名。DEVICE 内部金额只用于月内相对配平，运营页面不展示。

| 类型 | 随机时长（分钟，5 分钟整数倍） |
|---|---|
| EM 向量计算 | 30–60 |
| SP 语音处理 | 45–90 |
| IG 图像生成 / LL 大模型推理 | 60–120 |
| FT 模型微调 / VG 视频生成 | 90–120 |

平均时长取全部启用任务算术平均，日单量由服务端返回 `1440 / avg`，无启用任务时显示「—」，不伪造 0 或使用固定负载值。

**④ 操作与弹窗**：随机添加、批量启停填理由直接生效，记审计，不走 A2 双人审批或兑付覆盖率。弹窗层次为标题→关键信息（当前等级、对象和影响）→连续填写项（数量、限定类型复选框、理由）→次要说明。头尾固定，停用影响和理由优先常显，完整任务名单放在可展开区，展开后随正文滚动。停用前请求影响预览；如果商品失去所有可用任务，弹窗列出商品名、受影响设备数和「当前单完成后等待配置；停跑期间不计收益、不补发」。影响读取失败时不得提交停用，可以用原等级和原 ids 重新计算，不丢理由。影响统计已激活且未停用、状态合格的非手机生产设备，正在完成当前单的设备也计入；影响是读取快照，提交时设备数可能变化。批量只提交本页所选且与目标状态不同的行，并保留可展开的完整原名单；实际回执 updated 可为 0，按真实数量提示。启用及添加只影响新任务，运行中任务保持冻结版本。

**⑤ 接口**：基础路径 `/api/admin/devices`。`GET /task-pools?kind=DEVICE`；`GET /task-pools/{code}/tasks` 支持 `taskClass/enabled/pageNum/pageSize`；`POST /task-pools/{code}/random-tasks` 携 `count/taskClasses?/reason/idempotencyKey`；`GET /task-pools/{code}/disable-impact?taskTypeIds=…`；`POST /task-pools/{code}/tasks/status` 携 `taskTypeIds/enabled/reason/idempotencyKey`。列表使用 `kind=DEVICE`。筛选立即查询，切级回第一页清选择并保留筛选／页长，默认 20，支持 10／20／50；URL replace 记住 pool、taskClass、enabled、pageNum、pageSize，刷新恢复，不覆盖主题参数。读回当前事实不能当作命令回执。写成功与读失败分开显示，读失败时禁新写入。错误保留原状态码、原因码与结构化数据，按合同显示明确中文，包括启用／总量上限、同键异内容、不属于当前池及 kind 不符。

**⑥ 权限与固定等级**：沿用 `device_e2_read/write`。运营只能向四个固定等级随机添加任务和批量启停任务；等级本身没有写入口、客户端方法或代理路由。PHONE 保持独立。

**⑦ 联动与删减**：手机档位分界、手机 5 档收益、新用户引导对比迁至 E6。E2 移除六类定价、队列饱和度、升级预览、圆环、排行及热力图。旧引擎配置在后端仍保留供历史消费者使用，不用这些数值冒充实时运行负载。空池恢复按后端的生效时刻及错峰规则处理，停跑期间不补发。

**⑧ 审计与验收**：事件仅为 `E2_TASK_POOL_RANDOM_ADDED/STATUS_CHANGED`。从真实入口验证固定四档展示、随机添加、幂等重试、筛选与启停影响；每次写后刷新读回。前端类型检查、构建与后端就绪后的实景操作分别记录，不用编译结果代替业务验收。

---

#### [E3a] 设备使用与产能规则

本页 `/devices/trade-in` 维护设备产能与升级置换配置，读取 `GET /api/admin/devices/e3/overview` 和 `GET /api/admin/devices/e3/tradein/overview`。打开及手动刷新读取，不自动轮询。后端 `111e00cd` 提供三段月龄台数：前期 `earlyDeviceCount` 为月龄 ≤ stageEarlyEnd，中期 `midDeviceCount` 为 stageEarlyEnd < 月龄 ≤ stageMidEnd，后期直接使用 `cliffDeviceCount`（月龄 > stageMidEnd），不在前端相减。页面在曲线右侧「在用设备在哪一段」用分段条显示三段台数及合计，没有在用设备时写「没有在用设备」。统计排除 RECYCLED/DEACTIVATED/INACTIVE/RETIRED；月龄是依次取购买、激活、创建时间到现在的整月数。没有在用设备时 `averageAgeMonths=null`，页面显示「—」（不带单位）；真实 0 月仍显示 0。除平均月龄允许 null 外，必需统计及计数缺失、null 或非法数值仍报读取失败；三段台数必须为非负整数。事务按最近 24 小时，恢复次数不计入成功率；本月申请与金额按服务器业务日历。`latestAt=null` 表示无最近记录，显示「—」。折抵金额为 USDT，全精度，不做金额舍入。

产能按分段复利：从 100% 乘各月所在段的 `(1+delta/100)` 后取 floor，下限不重置后续内部连乘。前期为 1..stageEarlyEnd，中期为其后至 stageMidEnd，后期从 stageMidEnd+1 起持续；cycleMonths 只决定图表范围，不截断产能。后端投影六位小数；PC 图表为数学预览。正变化合法且后端不封顶 100%，App 目前拒绝超过 100% 的投影，保留提示，后端待办 E3-BE-04。8 类商品各有参与曲线/固定 100% 的开关。补贴窗口从 purchasedAt 优先、否则 activatedAt 起算，只影响补贴显示，不改变 applyCapacity。页面对分界移动、参与递减与免递减的影响写条件说法（按曲线低于或高于 100%），不承诺「越久任务越少」。产能图纵轴按数据取到 5% 整数的上限，不再固定画到 150%。

本页保留 14 个入口：前/中/后期每月变化、产能下限、补贴天数、升级置换开关、仅限更贵、最多抵扣台数、等级资格共 9 个单项；分段月份、提示升级金额、8 类商品参与开关、4 条分档线、5 档折抵比例共 5 个组合。单项 `command={domain:E,op:e3_config,params:{key,value}}`，`obj=完整键`，`target=E/device_e3_config/后端规范键`；组合 `op=e3_config_batch, params.values=整组完整键值`，obj 为所有完整键排序后逗号连接，targets 对应完整组，不拆单。sourceDomain=E3，type=param，sos=false，旧 beforeValue/afterValue、理由、action 和请求字段顺序保留；提交时的完整当前参数另存为恢复证据，不作为服务端版本校验。A09 的 309 字符对象在后端票据中截为 255，command/targets 不截断。

所有入口只向 `POST /api/admin/platform/audit/operations` 发提案，成功为待审批，批准才执行。设备写权之外还要 A2 write 或 proposal_create；仅 proposal_create 没有 A2 write 的账号，五组组合按既定决定不可用，不拆成逐项绕过 E3-BE-01。批准者须活跃、有 platform_a2_operation_approve、域范围允许且不是发起人；单项还须 device_e3_read，组合没有专用 E3 批准映射，不承诺固定超级管理员角色。批准执行以当时配置形成候选，无 expectedVersion/CAS。放大方向以后端真实候选为准；放大时兑付覆盖率缺失、不可靠、缺红线或低红线均拒绝；涉及曲线/参与变化且受影响商品的任务奖励上界超过 999999999999.999999 USDT 时拒绝。提案阶段不检查这两项。

R1：每次发出前保存完整原提案 body（含 operator、原理由、command、锁）、命令号、当前全参数、新值、提交时间和 owner；存储失败不发。组合只有一条记录。未知后原框所有输入冻结；刷新仍有原记录与恢复入口，概览失败时恢复仍可用。24 小时内只按保存 body+key 重发；只有明确 4xx 业务拒绝才解除，401/403/408/425/429 和 IDEMPOTENCY_* 保留；超过 24 小时只查询。创建成功保留待批记录，页面刷新时按本人命令号查询权威票据：pending 保留全部参数标记及拟改值，approved/withdrawn/expired 移除，rejected 显示已有被驳回状态并允许新申请。重试的历史回包不当当前配置或当前审批状态：原号 POST 成功只确认这份申请建过单，先保留为「已提交，审批结果未查到」，只提供查询原结果；只有原号 GET 返回 pending 才显示待批准和批准后曲线。查询失败保留提示、原记录和参数的新内容拦截，不用成功提示覆盖查询失败；后续权威终态照常收敛。恢复后关闭原框并独立重读配置，成功读取前禁新修改。查询权限与重发权限分别判断。原票过期且按原号查询严格返回 A2_PROPOSAL_NOT_FOUND 时，提示条给出「解除待确认」，确认框确认后先重查、仍查无此单才解除本标签页记录。缺完整原请求的旧 E3 指纹单独一条提示，只能查询原结果，查到终态后移除，禁止重发。待批准记录列成一条「N 项修改等批准」，每项可单独查询审批结果。提示统一叫「结果未知」，按钮「查询原结果」「按原请求重试」，逐条写改了什么、提交时间（北京时间）和理由，不显示命令号。

#### [E3b] 升级置换规则与统计

按旧设备累计产出 ÷ 旧设备实付金额 × 100 分 5 档；严格小于 cut 才在当前档，等于边界归下一档，第 5 档为不小于 cut4。4 条界线严格递增，5 档抵扣比例 0..100 且严格递减，第 5 档可为 0。折抵为实付金额 × 档位比例 ÷ 100，后端六位小数并不超过目标价格，只减应付，不进余额。关闭 requireHigherPrice 后可换不同商品的同价或更便宜设备，应付可为 0；仍检查来源设备归属、活跃、已付金额、目标上架/库存、发布及购买资格。

maxDevicesPerOrder 入口保留，但当前后端及 App 每次只取一个 sourceDeviceId，配大于 1 也不合并多源；已定 E3-BE-02，页面保留「目前每单只按 1 台处理」。三种 taskLock 金额仅保存，App 没有消费者，归「目前不生效」，已定 E3-BE-03。资格为全部用户及 L2+ 至 L6+ 六个单选，降低门槛是放大，全部用户仍受其他条件限制；九类通用 eligibility、旧 salvage/minHoldingMonths/promo/inventory 的规划入口未在当前 E3 实现，不能当已有能力恢复。

本月申请数与折抵合计包括未完成/被拒申请，不是完成成交额。「近 30 天高频置换账户」是同期完成置换至少三次且有正佣金或礼品入账的用户数，不是 K2 阻断次数，不自动处置。回收/停用成功数按当前状态及更新时间，失败/恢复来自审计；置换各计数来自不同订单/申请口径。latestKind 按是否有失败数生成，不证明最后一条事件结果。

设备代理读取失败单独返回 DEVICES_BACKEND_READ_UNAVAILABLE，文案说明没有读到数据；B0 运营总览及 E1/E2/E3/E4/E5/E6共用该读取归类。写请求仍保留 DEVICES_BACKEND_UNAVAILABLE 的结果未知提示。本页无单台设备处置、审批决定或导出入口。接口、商品范围、权限和 14 项命令合同保持。

---

#### [E4] 订单进度

**2026-11-15 B38 接线**：新提案保存 A2 完整 request 与 commandOrigin，原样重试不改操作人/角色/业务内容。重试成功后查当前审批单，不把建单回放当成现在待批。checkE4Investigation(record,evidence?)、e4InvestigationResults、e4InvestigationAccess 提供核查数据；只有权威终态解除未知，关闭旧确认并重读当前数据。查不到或读取失败通常保留；审批提案遵循 R1 特例：过期后原键查询明确 A2_PROPOSAL_NOT_FOUND，允许现有确认框确认后解除。直接写不适用；旧提案查到匹配当前票据可恢复，不补造来源。核查输入/按钮/结果/联系人及旧框文字由视觉接。A2_COMMAND 成功仅证明建单命令完成，不证明退款执行。出处 eb08d01a OpsCommandInvestigationController、AdminCommandInvestigationService、AdminCommandOrigin。

**① 目的 & 对齐**
设备订单的进度核对与审批处置入口——列表、详情、按事实推进及退款；设备分配和激活在设备管理办理。对齐前端 §7.4(订单管理 `/store/orders`,4 阶段直通车)+ §9.11f(订单失败态补全:当前前端 `cancelled` 折叠所有失败为一类,后台须拆分缺失态)。服务的业务目标:履约可观测(订单从下单到激活的状态流转)、退款与资金回退的合规处置(联动 D 域)、失败态精细化(区分支付失败 / 过期 / 退款 / 拒付 / 配机失败)。**E4 持订单状态机权威,订单支付走 D1 / PSP、paid 写 D4 账本**。

> **本子模块涉及的 V2 落地前阻断性跨域确认项(承本章引言)**:
> - **退款资金现行实现**：后端通过 `E4OrderRefundSettlementFacade` 在订单事务内更新钱包、累计充值、退款流水与账单；累计充值按实退金额扣减且不小于 0，不再按“拟由 recordDeposit 写入、待确认归属”描述当前接口。真实资金终点验收与旧事件 schema 对齐仍须分别留证。
> - **`order` domain 扩展**:V1 §2.4.3 domain 枚举(21 个)不含 `order`,**V2 sprint 开始即向 A4 申请 `order` domain 扩展(blocking 依赖),并登记为 V2 起始工单**(⑧)。

**② 后台界面**
托管机房只读已交付设备的 SKU 标签快照，不提供机房登记或单订单改派。

路由 `/devices/orders`,列表页。读权限 `device_e4_read`,写权限 `device_e4_write`,退款单独要 `device_e4_order_refund` 加 `platform_a2_proposal_create` 或 `platform_a2_write`；普通动作沿原写码，后端仍检查提案权限。退款入口只是「可申请退款审批」，身份由后端核实，见⑥。页头有「这页怎么用」和「刷新」;切回这页时自动重读,不轮询。

1. **结论和汇总**:最上面一句话:按状态说明有多少单等待交付或退款核对，有待审批先等待审批，不把这些数量当作当前可操作单数；提示里分开写数量,按钮分别去进行中和开通失败;都没有时写「没有要处理的订单」,数量读不到时不下结论。等待核对的数量只按业务状态统计，待审批行不代表可再次操作；统计范围:已下单不算,付款或超时由系统处理;已支付、开通中算,后端没有自动推进,要在「设备管理」分配或激活后到这页推进;开通失败算,要人退款,退款后离开这个状态。开通失败按状态计数,列表接口没有付款筛选;后端把开通失败都记成已付款,例外是绕过这个流程写入的旧数据。正常付款后订单直接到已激活,不经过这两个状态。汇总 2 个:进行中订单、失败订单,算全部订单,跟搜索词变,不随状态筛选变,换搜索词时新数读齐前显示占位。当前筛选的总数写在分页上,分页旁写本页已激活笔数和合计,写明只算这一页。正常结论为 16px 一行，不放大；有等待核对订单时才突出。结论句第二行只写数量和点一行看什么;按当前搜索词算、设备分配和激活在「设备管理」做,在句尾的提示图标里。汇总数字算哪些状态、跟什么变,在名称旁的提示图标里;列表标题旁的提示图标写点一行看到哪一步,「订单状态怎么流转」标题旁的提示图标写托管、退款条件和「标记失败结果」不退款。抽屉底部常显的只有现在能不能做;退款不可撤销这类后果在按钮旁的提示图标里。
2. **查询**:状态分段(全部 / 进行中 / 已交付 / 失败 / 已结束)+ 搜索框(订单号 / 用户编号 / 商品,停止输入 300 毫秒后查询)+ 清除筛选。细分状态收进「更多筛选」，已选值写成可移除的条件条。接口的 `state` 只收一个值,整组时按状态分别读到当前页,按下单时间合并切页。查询条件写网址(`group`、`state`、`q`、`page`、`pageSize`)。
3. **订单表**:默认 6 列:订单号(中间省略,悬停和抽屉看全值)、状态(进行中的第二行写等什么)、用户、商品、金额 USDT、下单至今(已结束的单写「—」)。订单号和状态的表头点开有解释。待审批只在状态格第二行写标签，不挤入动作、提交人和时间；这些写在详情。1024 保留六列，长商品名单行省略，悬停看全文，商品统一写「名称 × 数量」。金额在列表、抽屉和确认框都写接口的全部小数,收到几位写几位,不封顶,不舍入,至少 2 位,不用 `$`。托管机房在「显示更多列」,选择按账号记住。分页 10 / 20 / 50 / 100。
4. **详情抽屉**:点一行从右侧滑出,浮在列表上,列表不变窄,被点的行高亮;点另一行或上一条、下一条直接切换,点空白处、Esc、右上角关闭。开头是步骤条(到哪一步)和判断要点(下一步或当前结果、对象、金额、付款来源、退款条件);订单信息、关联设备、状态轨迹、资金记录分别收起,订单信息里的下单时间写真实时间,数量带单位(如「1 台」);底部固定动作,说明只留风险一句,被挡时换成阻断原因。已结束的订单不显示步骤条和实时覆盖率,结果行写当前状态意味着什么，不重复状态标签；失败原因从状态轨迹取，另起一行。已付款的开通失败单是例外:判断要点多一行退款条件,底部有退款,和普通退款同样的权限、覆盖率和不可撤销说明。同订单较新的详情状态优先于旧列表，详情已退款时不能因列表仍是已支付而继续提供退款。详情没读完或读取失败时,动作全部禁用,「按订单号查账单」按权限照常显示。列表在读(含切回这页的自动重读)或读取失败时,抽屉动作和已打开的确认框同样禁用并写原因,读成功后恢复,确认框里已填的内容留着。切回这页时抽屉开着就连当前详情一起重读,旧详情留在屏幕上,列表和详情都读完才解锁;详情读失败时清掉旧详情,抽屉和确认框保持禁用,重试成功才恢复。
   详情判断要点的问号、订单信息里的资金事实和退款确认框都叫「兑付覆盖率」；当前、执行后各一位小数，红线按配置原值写。三项读数不全时写「兑付覆盖率暂时读不到，暂不能退款」「要先读到兑付覆盖率才能退款」，不按低于红线下结论。
单一失败结果（已支付只能拒付、开通中只能开通失败）按确认框已有的固定结果提交，用户可见的失败原因仍按原规则必选。

5. **订单状态怎么流转**:列表下面的折叠组,主流程 4 步和 6 种异常或结束的单数、说明。
6. **结果未确认**：发送前将完整原提案、理由、编号和创建／到期时间存入 sessionStorage；存不下不发。推进、退款、取消和失败提案首次发送均使用同一完整原操作存储，不再另记旧指纹槽位。未知结果保留原确认框并冻结原内容与理由；关闭原框或刷新后页顶仍有待确认，锁该订单新动作；八种明确未定幂等码沿 A2 保号（v1 §3.2.1）。有 `platform_a2_read` 或 `platform_a2_proposal_create` 时提供「查询原提案」，先严格按原号查询，只有精确 `404 + A2_PROPOSAL_NOT_FOUND` 算未查到；未找到仍保留记录，只作为原样重试的前置查询结果，不能证明原操作未执行。查询失败、无权或其他 404 不解锁。找到原单后重读业务状态，不把找到待批单当已退款；没有原单查询权时按现有恢复入口原样重试，服务端仍校验。
   重试须未满 24 小时及当前对应写权；退款重试与新申请同样要求退款码加提案权，不按主角色排除合法兼任账号。每次重试先核实持久原记录：缺失／读取失败只停发，保留现有内存信封、原号、对象锁、理由及时间，不 forget、不报过期或结案。再次持久保存失败时已有原命令同样保留；全新且根本没发出的命令可清理。24 小时后只核对，原记录与锁保留，不换号、不重发。旧的 E4 指纹记录没有完整请求与理由，只能查询；过期也保留，其他 E 页读取同一存储时不能删除。
   原样重试被后端明确业务拒绝后才可人工核实并「解除待确认」；401／403／408／425／429、所有 `IDEMPOTENCY_*`、未知／不可读响应及本地错误不算明确拒绝。解除共用说明为「确认原操作的结果后再解除。这里只清除本标签页的待确认记录，不撤销原操作，不代替后端核查结案；之后能不能重新提交，以后端校验为准。」；不是撤回审批或办理后端核查，本页没有核查结案入口。

服务端待审批标记保留原业务状态。列表只写「待审批」标签；详情提示条写动作、提交人及业务时间，不再套标签。判断要点的下一步写「等待超级管理员审批」，退款行只写「等待审批结束」，底部保留阻断原因。批准、驳回或撤回后读取最新结果，再按当前权限和条件操作。待确认恢复入口失去写权限时禁重试并常显原因，原记录与核查入口保留。

订单详情的「关联设备」用 `RecordList` 展示服务端 `devices` 返回的全部设备，区分购买设备（`PURCHASE`）和促销赠品（`PROMOTION_GIFT`），逐台显示设备状态、持有状态和可复制实例号，默认五条，其余可展开。设备 ID、来源及原始状态保留查看入口。旧回执未提供数组时保留单台实例号；空数组显示尚未生成。状态轨迹只有一条时用事实列状态变化、时间、操作人和原因，不画时间线；多条用 `Timeline`，最新在上，保留事件、发生时间、原因和统一打码的操作人；资金记录用 `RecordList`，金额带 USDT，时间、来源、收支、状态、业务单号及账本核对入口分别显示。设备和资金记录按完成、等待区分状态颜色，已发生的事实不用待生效的蓝色。

退款说明按购买设备与赠品分开：仅处理仍属于原购买者、且未退款或回收的购买设备，标为已退款并停用；已到账的设备收益不扣回。赠品不计入购买设备停用范围，另按促销奖励售后规则处理。数组缺失时说明明细未提供，不用旧单设备字段推断购买设备。退款确认中的设备及试用转购奖励后果占整行，促销奖励独占整行，逐项用记录列表保留对象、金额、追回及损失承担后果，不在窄 Fact 值列提前换行。

**普通购买设备的退款任务影响（B38／BE-06）**：详情与退款确认框各展示一次。普通订单已完成任务按原规则结算一次，未完成任务随退款停止，已到账设备收益不扣回；不把停用简写成所有收益都停止结算。`refundImpact` 只含普通购买设备，不含促销赠品；`TRIAL_CONVERT` 不展示此投影，试用转购、赠品与促销奖励仍走原售后规则，不改变本单应退金额。

| 事实 | 现行展示及未知处理 |
|---|---|
| 完成待结算 `completedPending` | 项数、USDT、UVT 分开；运行统计完整且返回非 null 才列值 |
| 未完成待停止 `unfinishedTaskCount` | 运行完整且非 null 才列值，其他为「未知」 |
| 已停止 `stoppedTaskCount` | 持久事实，已知 0 仍写 0，不因运行态失败清成未知 |
| 已到账保留 `creditedRetained` | 项数、两币金额保留已知事实，不把 0 当未读到 |
| 范围与时间 | 普通购买设备、截至 `asOf` 的业务时间；快照不证明收益已经到账或决定应退金额 |

`runtimeComplete=false` 时完成待结算、未完成一律显示未知，即使误带 0 也不用；整个投影缺失则警告“不能按没有任务处理”。模拟运行关联未核实、计算运行态不可用、完成结果未知分别写中文，原码留技术提示。任务未知提示本身不新增退款阻断，仍按 `refundAllowed`、资金、状态及权限判断；金额保留原小数、不舍入、至少两位。后端运行态与持久数据共同投影，并扣除已提交 allocation，避免已结算重复计入待结算。

**③ 可控参数**

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| DC 分配规则 | **现状**:Rack(P1/P2)→ Frankfurt / 其余 SKU → Singapore | 规则表(kind → DC) | 仅新订单 | 订单详情 DC 字段 / provisioning 阶段 |
| 阶段推进 | 页面按已发生的付款、分配、激活事实提交推进审批 | 本页无自动／混合策略切换入口 | 批准后生效 | 正常购买流程由服务端交付；遗留待推进订单核实事实后处理 |
| 订单过期时窗(`placed → expired`) | **现状未定义**(前端 §9.11f 仅声明缺失态,具体时窗由 PM 与开发在 V2 实施时确认);建议 15–30 分钟 | 分钟 | 仅新订单 | 订单 expired 态(新增) |

> **订单状态机(§9.11f 补全,后台权威拆分)**:
> - **正常链路(前端 §7.4 现状)**:`placed → paid → provisioning → activated`(平台机房托管模式,无实物物流环节)。
> - **缺失失败态(§9.11f 后台须拆分)**:当前前端 `cancelled` 折叠所有失败为一类;后台拆分为 **`payment_failed`**(支付失败)/ **`expired`**(下单未支付超时)/ **`refunded`**(已退款)/ **`chargeback`**(拒付)/ **`provisioning_failed`**(配机失败)五个独立终态/中间态。
> - **状态转移**:`placed →(支付成功)→ paid`;`placed →(支付失败)→ payment_failed`;`placed →(超时)→ expired`;`placed →(用户取消)→ cancelled`;`paid →(配机)→ provisioning →(成功)→ activated`;`provisioning →(失败)→ provisioning_failed`;`paid / provisioning / activated →(运营退款)→ refunded`;`paid →(PSP 拒付)→ chargeback`。创建订单时已预占的 `nx_product` 库存，在 `payment_failed`、`expired`、`cancelled` 或 `refunded` 时必须与订单状态更新同事务复库并回退销量；商品即使已软删除也须承接历史订单复库，但不重新对商城可见。
> - **`payment_failed` 终态处置(业务决策:方案 A 终态)**:`payment_failed` 为**终态,用户须重新下单**;E4 订单列表须展示原失败单,新下单时携带可选 `relatedOrderId` 关联原单便于 GMV 去重,失败单不计 GMV。(不采用「`payment_failed →(重新支付)→ paid`」重试路径,避免同单多次支付的状态机歧义。)
>   - **`relatedOrderId` server 端校验(防伪造操纵 GMV)**:`relatedOrderId` 为可选字段,**client 传入时 server 强制校验原单须处于 `payment_failed` 终态且 `userId` 一致,否则 `POST /api/orders` 返回 400**;server 亦可按「同 `userId` + 同 SKU + 60 分钟内 `payment_failed` 单」自动关联(**server-side 关联优先于 client 传入,防伪造**)。
>
> **默认值口径声明**:订单状态机为前端 §7.4 现状(4 阶段)+ §9.11f 失败态拆分需求,**12 月节奏表 §6 未覆盖**,以前端现状 + §9.11f 补全为准。DC 分配为机房托管运营规则(前端现状)。订单过期时窗前端现状未定义,具体值由 PM 与开发 V2 实施时确认(建议 15–30 分钟)。

**④ 操作动作**

| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 推进到下一步 | `device_e4_write` | 确认框,提交审批(`e4_order_state`) | A2 提案、审批与域审计 |
| 取消订单(仅已下单) | `device_e4_write` | 确认框,提交审批(`e4_order_cancel`) | A2 提案、审批与域审计 |
| 标记失败结果(已下单、已支付、开通中) | `device_e4_write` | 确认框,提交审批(`e4_order_terminal`) | A2 提案、审批与域审计 |
| 退款 | `device_e4_order_refund` | E4-MD1,提交审批(`e4_order_refund`)(**联动 D 退款 + 资金回退 + cumulativeDepositUsdt 核减,资金流出动作**) | A2 提案、审批与域审计 |

> 四个写操作都走 A2:提交后要另一位超级管理员在「操作记录与审批」批准才生效,这页不批。四个确认框标题只写「取消订单」「标记失败结果」「推进订单」「退款订单」,下面是蓝色「批准后生效」;只有退款以金额为关键数字；取消先写当前状态，标记失败和推进先写当前状态或状态变化，再写订单等事实，金额普通显示;推进和标记失败的状态变化写成现在到改后,改后蓝色。谁来批准与批准前的说明放在生效标签提示图标里,执行摘要写这次的真实影响,比如退款写「钱退回用户钱包，符合退款范围的购买设备停用」,不重复常显的金额和状态变化。推进只确认已发生的事实:已支付→开通中要款项已结算且设备编号、实例号和托管机房标签事实齐全，指引为到「设备管理」核对设备和托管机房标签,开通中→已激活要设备已激活,已下单不能手动变已支付。退款批准执行时检查当前与执行后的兑付覆盖率，低于红线拒绝；提交提案不查覆盖率，读到的预览只作当前依据。取消订单、标记失败同样带「不能撤销」和危险按钮；标记拒付后不能退款。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 推进到下一步 | ②详情抽屉底部,主按钮 | 按钮 | 有写权限、详情读完、事实满足时才显示;不满足时判断要点写原因 | 打开确认框,提交审批 |
| 取消订单 | ②详情抽屉底部 | 按钮 | 有写权限且已下单时显示;详情没读完时禁用 | 打开确认框,选取消原因(用户可见),提交审批 |
| 标记失败结果 | ②详情抽屉底部 | 按钮 | 有写权限且已下单、已支付、开通中时显示;详情没读完时禁用 | 打开确认框,选失败结果和原因,提交审批,只有一个结果时写成事实。不会退款:标记拒付写「之后不能再退款」,标记开通失败写「已付的钱之后可以走退款」 |
| 退款 | ②详情抽屉底部，描边红字；只有退款一个动作时放右侧 | 按钮 | 有退款权且已支付、开通中、已激活、已入库,或已付款(`paymentStatus` 是 PAID)的开通失败时显示,详情没读完的开通失败单先显示为禁用;读取中写「正在检查…」,资金不足或覆盖率读不到时按钮写「暂不能退款」,都不可点;完整原因(「平台资金低于安全线，暂不能退款」「兑付覆盖率暂时读不到，暂不能退款」)写在按钮提示和判断要点里,底部说明换成阻断原因 | 打开弹窗 E4-MD1 |
| 状态 / 关键词筛选 | ②查询区 | 就地筛选 | 恒可用 | 分段和下拉立即查询,回第 1 页;搜索框停止输入 300 毫秒后查询 |

**(2) 弹窗规格(逐弹窗)**

##### [E4-MD1] 退款确认

**现行范围（2026-11-15，B37）**：退款确认业务表单已接 `refundAmountUsdt` 原文本输入；大于 0 USDT、不超过订单本金、最多 6 位小数，按十进制整数比较，不转浮点、不舍入。完整原提案连金额、理由及命令号先持久保存，未知后冻结并原样恢复。订单仍整单终态退款，设备回收、库存和促销追回按整单执行。详情原有覆盖率是全额预览，不用它拒绝本可执行的少退申请；实际金额由批准执行时检查。订单 `refundAmountUsdt`、详情 `refundReason`（退款轨迹原理由），以及 A2 回执 `originalAmountUsdt/refundAmountUsdtText/refundReason` 已备好，旧字段为空保持空。金额事实行、全额预览标识、实退/少退理由展示交视觉 worker；本次只增最基本的业务输入。真实批准、钱包／账单／收益终点尚须专门验收，不能用页面模拟代替。

- **功能**:提交退款审批。批准后 server 单事务:钱退回 USDT 钱包,付款记录标为已退款,写退款流水和账单,`cumulativeDepositUsdt` 减去这笔;仍属于原购买者且未退款或回收的购买设备改为已退款并停用，已完成任务按原规则结算一次、未完成任务停止、已到账收益保留；已发放的赠品设备收回并停止任务，已到账赠品收益不扣回，由平台承担;商品库存退回。
- **布局结构**：沿用共用宽框 680 档，标题「退款订单」及红底警告图标，蓝色「批准后生效」和红色「不能撤销」。执行摘要默认收起，影响句独占一行；另一位有权超管批准前钱不退、设备不动。普通订单左侧列退款金额、订单、用户、单一退款去向、当前→执行后兑付覆盖率及红线，右侧为「任务／项数／USDT／UVT」四列表，分别列完成待结算、未完成待停止、已停止、已到账保留。覆盖率一位小数、红线配置原值，只列一次，提示注明批准执行时再查；金额是关键数字，保持原精度。商品与购买设备细则折叠，含真实持有状态、全部购买设备、权限身份说明；无设备数组时写明细未提供，不按旧单个设备号推断。
- **促销与试用**：促销奖励对象、金额、追回结果及余额不足由平台承担的结案后果继续常显，购买者写「购买者（本单用户）」，邀请人带真实 ID；同短句合并，完整规则、台账号及复制入口放问号。赠品存在才写收回、停止任务、已到账收益不扣回并由平台承担；明确没有赠品不写，数组缺失不猜。损失金额以执行后奖励台账为准，退款前不以退款额／面额代替损失估算。试用转购奖励可能追回，按当时规则最多收回未花掉部分，未追回转人工核查，不套普通任务表。有 `growth_promotion_reward_read` 才读奖励；无权或读取失败写原因，仍按原退款门槛判断。
- **首屏与滚动**：退款原因和完整理由框在标准首屏可填写；促销较多、试用转购或多渠道超出一屏时只滚框体一层，头和底栏固定，不遮字段。原因写「用户可见」，理由仍只记操作记录；单渠道是事实，多渠道才给下拉。商品细则收起不隐藏退款、两币任务或促销资金后果。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 退款金额（USDT） | 文本输入 | 是 | 大于 0、不超过原本金、最多 6 位小数；原文本持久保存和发送 | 原本金 |
| 退款渠道 | 后端返回多个渠道时是下拉单选;只有一个时不给下拉,写成关键信息里的「退款去向」 | 是 | 后端返回的渠道,现在只有 WALLET(退回 USDT 钱包) | 第一个渠道 |
| 退款原因(用户可见) | 下拉单选 | 是 | 用户申请退款 / 重复支付 / 设备无法交付 / 订单异常 / 其他原因 | 空,必须人选 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[提交审批]`(危险色;理由或原因未填时置灰;提交中防双击;请求带稳定命令号)。
- **错误态**:明确失败时留在弹窗,显示错误和已填内容;结果未知时关闭弹窗,转成页面上方的待确认条(②第 6 条)。
- **成功反馈**:弹窗和抽屉关闭,提示「已提交审批，等超级管理员批准。进度到「操作记录与审批」看。」;订单状态不变,批准后才变成已退款。

**⑤ 接口**

- `GET /api/admin/devices/orders?state=&keyword=&pageNum=&pageSize=`、`GET /api/admin/devices/orders/:orderNo`：列表和详情，详情包括当前状态、覆盖率、退款条件、设备、轨迹、资金记录及可空 `refundImpact`。
- `POST /api/admin/platform/audit/operations`：本页推进／取消／标记失败／退款均提交 A2 原命令；退款为 `E / e4_order_refund`，携 `orderNo/refundChannel/refundReasonCode/refundAmountUsdt`，来源 E4、目标 `E / device_order / {orderNo}`，理由和原 `Idempotency-Key` 必填。
- PATCH／POST 直接退款接口及共享业务服务不能绕过：没有真实 A2 回放上下文与原工单返回 `E4_REFUND_APPROVAL_REQUIRED`。PC 已移除未使用的直退 helper，不提供 PUT 手动回滚／改派 DC 入口。
- 后端批准执行重核退款状态、当前及执行后覆盖率，单事务更新订单、资产库存、钱包、退款账本与累计充值；操作结果以回读为准。用户下单仍沿既有 `/api/orders`，不由本页代用户创建。

**⑥ 权限 & 审计**

| 动作 | 实际权限与身份 |
|---|---|
| 订单读取 | `device_e4_read` 及页面菜单；内置增长、财务、财务主管、客服、审计、超管按既有读权 |
| 推进／取消／标记失败 | 页面沿 `device_e4_write`，提交 A2 再由后端核权；不能沿旧“订单运营 lead 可独立执行”表直做 |
| 发起退款、退款原操作重试 | 前端同时要求 `device_e4_order_refund` 与 `platform_a2_proposal_create`／`platform_a2_write` 之一；后端验证发起人真实超管身份，或退款权限的有效授予来源含 `FINANCE_LEAD`，并有退款码 |
| 批准／驳回退款 | 另一位真实超管，具有 `platform_a2_operation_approve` 和 `device_e4_order_refund`，发起人不可自批 |
| 查询本人原提案 | 前端认 `platform_a2_read` 或 `platform_a2_proposal_create`；服务端继续执行本人／对象范围 |

默认 GROWTH 没有退款权，不能发起；但主角色 GROWTH 兼任合法 FINANCE_LEAD 授权时可走受限申请入口。会话的主角色不能证明每项权限来源，前端不再以 `session.role !== growth` 一刀切，也没有给默认增长增权。审计保留原单、前后状态、实退金额、渠道、原因、发起／批准身份、目标和幂等号；提交提案不是退款执行事件。

**⑦ 风控 & 联动**
- **订单 ID server mint**(§9.11d.2):订单 ID(及 Bill ID)服务端单源生成,client 不可 mint / 枚举 / 撞 ID(防伪造 PSP token / 枚举订单)。
- **支付走 D1 PSP**:订单支付经 D1 充值与收款对账 / PSP(Stripe / Adyen 等),`payment_failed` / `chargeback` 由 PSP 回调驱动(前端永不可知失败概率 / RNG,§9.11d.2)。
- **paid 写 D4 bill**:订单进入 `paid` 时 server 在 D4 账本写入账单(server 是唯一账本,client 拉 `GET /api/bills` 不写,§9.11d.2);`device.replaced` 类置换订单的扣款 + bill 同理。
- **退款资金与累计充值原子更新**：当前通过财务结算 facade，在订单事务内按实退金额增加钱包、核减 `cumulativeDepositUsdt`（最低 0）、写退款流水及 bill、标付款记录已退款；订单资产及库存同步处理，失败回滚。原“拟由 D4 recordDeposit(-amount) 实现”的描述不代表现行代码。
- **累计充值与既有资格**：退款后的累计值用于后续业务判断，不由 PC 重算或撤销既有购买资格；本单设备、赠品和奖励分别按当前退款／促销售后规则处理，不把累计核减当成所有关联资产统一撤销。
- **联动 E1 / E5**:订单 SKU 价格引用 E1 规格(下单快照价,在途锁价);`activated` 时关联 E5 设备(deviceId 绑定 + 槽位激活)。

**⑧ 埋点(事件)**
对齐 A4(§2.4.5 ②转化 + ③ money + ⑥ admin family)。
> **`order` domain 注册(V2 gate 阻断依赖)**:当前 A4 §2.4.3 domain 枚举(21 个)含 `store / checkout / device`,**不含 `order`**。**E4 落地前(V2 gate)须向 A4 申请扩展 `order` 为新 domain,作为 blocking 依赖,不等 V4 收口;该申请登记为 V2 sprint 开始即发起的工单**(若 V2 落地时 A4 无 `order` domain,所有 `order.*` 事件无法引用)。
> **过渡策略(V4 收口前的暂行,须经 A4 章节负责人确认后方可落地)**:若 V2 gate 时 `order` domain 尚未就绪,**仅允许以 `checkout.*` 子域作过渡宿主承载订单生命周期事件**(**剔除 `device.*` 宿主**——`device.*` 在 V1 语义为设备激活/产出域,不混入订单状态机事件);待 `order` domain 注册后迁移。临时命名映射表(每个 `order.*` → `checkout.*` 过渡全名):

| 目标事件(`order.*`) | 过渡宿主全名(`checkout.*`) | 迁移识别标记 |
|---|---|---|
| `order.placed` | `checkout.order_placed` | `domain_override: 'order'` |
| `order.paid` | `checkout.order_paid` | `domain_override: 'order'` |
| `order.provisioning` | `checkout.order_provisioning` | `domain_override: 'order'` |
| `order.activated` | `checkout.order_activated` | `domain_override: 'order'` |
| `order.payment_failed` | `checkout.order_payment_failed` | `domain_override: 'order'` |
| `order.expired` | `checkout.order_expired` | `domain_override: 'order'` |
| `order.refunded` | `checkout.order_refunded` | `domain_override: 'order'` |
| `order.chargeback` | `checkout.order_chargeback` | `domain_override: 'order'` |
| `order.provisioning_failed` | `checkout.order_provisioning_failed` | `domain_override: 'order'` |

> 过渡期约束:① 过渡期内订单状态机事件使用 `checkout.*` 子域时,**必须在事件属性中加 `is_order_lifecycle: true`** 以区分结账动作事件;② 所有过渡事件属性中加 `domain_override: 'order'` 供 V4 迁移识别;③ **GMV 计量口径在过渡期内以 `checkout.order_paid`(对应 `order.paid`)为权威**,`checkout.completed`(结账动作)不参与 GMV 计量;④ **不允许用同一事件 key 同时服务漏斗归因和订单状态机两种语义**(`checkout.completed` 仅漏斗、`checkout.order_*` 仅状态机)。

- **产生(订单状态机 + admin 审计,须 A4 schema registry 注册;`order.*` 域注册前按上表过渡)**:
  - `order.placed` — 触发点:订单创建;属性 `orderId / userId / sku / qty / amount / dc / relatedOrderId(payment_failed 重新下单关联,如适用) / is_server_authoritative: true(server 侧创建) / ts`。
  - `order.paid` — 触发点:支付成功(写 D4 bill);属性 `orderId / amount / pay_method / billId / is_server_authoritative: true / ts`(← GMV)。
  - `order.provisioning` / `order.activated` — 触发点:配机 / 激活(关联 deviceId);属性 `orderId / deviceId / dc / is_server_authoritative: true / ts`。
  - **失败态事件(§9.11f)**:`order.payment_failed` / `order.expired` / `order.refunded` / `order.chargeback` / `order.provisioning_failed` — 各携 `orderId / reason / amount(退款额,如适用) / relatedOrderId(如适用) / is_server_authoritative: true / ts`。
  - `admin.order_refunded` — 触发点:退款审批批准后实际执行（E4-MD1，执行时资金检查通过）;属性 `orderId / amount / refund_channel / cumulativeDeposit_adjusted / operator / reason / ts`;喂 D 资金对账 + L3 + 审计。
- **`order.placed` 与 `checkout.completed` 双源去重(防 GMV 双计)**:`checkout.completed` 属**转化漏斗 family**(§2.4.5② L3→L4 KPI 口径),`order.placed` 属**订单状态机 family**(履约起点);两者在同一结账动作中同时产生。**GMV 计量以 `order.paid`(server-authoritative,已写 D4 bill;过渡期为 `checkout.order_paid`)为权威**,`checkout.completed` 仅做漏斗归因,不参与 GMV 计量;**`payment_failed` 单的 `order.placed` 不计入 GMV**;**若新单含 `relatedOrderId` 且已 paid,GMV 仅计新单一次(以 `order.paid.orderId` 去重)**。V4 收口须声明 `order.placed` 与 `checkout.completed` 的对应关系以防 GMV 双计(V1 无「1:1 对应」定义,不得直接混用作 GMV 来源)。
- **消费**:`wallet.topup_confirmed`(§2.4.5 ③,支付确认入账,作订单 paid 的资金侧对账依据);辅 `checkout.completed`(§2.4.5 ②,结账成交,仅漏斗归因,不参与 GMV)。

---

#### [E5] 设备管理

**2026-11-14 后端 111e00cd 同步**：用户级恢复只清有效归属设备上的运营暂停，保留退款、账户停用、手机离线/低电量、换机、解绑/停用/回收等系统暂停。一次最多200候选ID，仅更新该集合；实际恢复数取changedCount，无候选404 PAUSED_USER_DEVICES_NOT_FOUND，成功和无候选后刷新核对。入口用userDeviceSlotNo的有效归属投影及暂停原因判断；确认框写“只恢复运营手动暂停的设备；退款、注销、换机、离线、电量低等系统暂停保持不变”，范围写“这位用户被运营暂停的设备（含手机）”，执行摘要注明实际台数以回执为准、单次最多200台；成功提示“已恢复 n 台运营暂停的设备”；无候选404关框、页首提示“这位用户已没有运营暂停的设备，没有恢复任何设备”并刷新。出处 DeviceOpsMapper.RESUMABLE_OPERATIONAL_PAUSE/lockE5BatchCandidateIds/resumeDevicesByUser，OpsDeviceService.batchE5Devices。

**2026-11-12 后端同步（代码侧）**：同一 overview 已增加 `errorRetry/legacyPending/waitingConfig`，客户端按非负整数读取，不另发列表计数。这三数按列表有效状态解析，与原四数的旧状态口径不同，不相加成分布；三数的可见展示由视觉 worker 接入。名额标记绑定后端 `userId` 精确筛选，清空旧搜索词但保留状态、来源、商品；普通搜索与 userId 取交集，分页、单项清除、全部清除及网址恢复携同一 userId。现有读回入口同时按号查询，只有权威成功或 `CONFIRMED_NOT_EXECUTED && newOperationAllowed && !locked` 才收敛；当前列表、查不到及403不解除。受控结案逻辑通过 `useE5Commands().check(record, evidence)` 暴露，只允许持调查权限及 E5 读权的超管提交，由服务端再次核实在职、绑定和证据。三数、证据框、入口、名额旧提示及新错误码中文留给视觉 worker，不改变现有屏幕组成。

**① 范围（2026-11-11）**：仅购买 `ORDER`、置换 `TRADE_IN`、试用转正 `TRIAL`、赠送 `PROMOTION_GIFT` 的用户设备，不含手机、未转正试用和测试设备。手机在 E6「手机算力配置」。历史 `hostingLabel` 可为 null，显示「—」；不恢复机房登记与遥测。

**② 页面与图形**：标准页头、短说明及「这页怎么用」，一句全部用户设备数量结论，四格「设备总数／运行中／等待启动／已停用」，统计不随筛选变化，初始没有选中态；点统计或分段后才高亮。状态分布面板只用 overview 四数派生 `other=total-running-waitingActivation-stopped`，不造异常计数；四数不齐或和不一致时不画条。统计与分布图例常显箭头／边界，等待启动用蓝色，已停用深灰、其他浅灰；组内选项使用同一状态图标与色调。任务关闭时结论写明本页只读。同一概览已交付出错重试、旧任务待核对、等待配置三数，代码直接读取；可见三数交视觉 worker，不新增列表计数。总0、单一状态、读取中与失败各自展示。运行中／已停用可直接筛；等待启动／其他先选择组内一个真实状态（P1 A），不请求整组筛选。

默认六列「设备／用户／状态／本月收益／当前任务／操作」，商品·托管机房及来源放「显示更多列」和详情，按账号记住列选择。设备行一次打开540宽浮层详情，列表不缩窄，当前页前后条、实例号复制、判断要点、设备事实、用户名额三节同级，收益为判断要点最强数字，值与图形左对齐；原错误、下次重试和中文暂停原因常显，原码进技术信息。长实例号连续折行并保留复制。用户编号链接须同时满足目标菜单与读取权限；同一行第二行并列「已激活 n/6」小标记，口径含手机，中性描边并带箭头（满额不作为告警），点标记按这位用户的后端 userId 精确筛选，清空旧关键词并保留其他筛选；后续关键词与精确用户取交集。悬停与读屏的旧“按编号搜索”文字待视觉 worker 更新。仍一台一行、ID倒序与原分页，不分组，沿原接口携 userId 参数。读取边界缺少名额字段时不渲染行，不补0/6。1440和1024、深浅主题共用rd组件；默认六列在1024全部可见且不横滚、不固定。只有更多列打开且容不下时，表内横滚并固定设备、状态和操作。

本月收益列头统一USDT，格内两行：已到账；预估区间，宽时与compact刻度条并列，窄时仅文字。保留接口十进制真实精度，去除后端补零；到账列和预估端点组分别按当前页所需的最大小数位对齐（至少两位），不舍入；悬停或聚焦金额、区间可查后端原值，币种USDT，不写美元符号。范围尺从0至到账与预估高值的较大者，低高相等画刻度，到账超过区间不截顶；null不当0，关闭目标保留到账但没有预估。设备月起止、产能、目标关闭、周期内配置变化及停跑不计不补放口径问号。当前任务只用真实对象，时间位置按成功读取时刻与业务时区起止计算，旁写距应完成时间；时间位置条用中性色（蓝色只留给状态）；到期写刷新核对，不表示已完成。无任务不造任务。

表格使用静态colgroup、width:100%、table-layout:fixed，E5样式按容器宽度的比例与clamp边界分配列宽，设备／当前任务优先；不使用JS布局或文字测量。设备名单行省略，加实例号共两行，完整名称保留title；实例号前段可收缩省略、末8位固定，全文保留title、读屏说明和原生Tab提示。1440常规长度样例与1680默认/更多列实例号完整；特别长号仍可查全文。容器不超过1129px时，表内收益只留完整到账及预估文字、不画范围尺；任务保留类型与距应完成时间、不画时间条；用户名额标记缩成n/6，完整悬停与读屏说明不变。1024默认表与容器同为749px，六列无横滚；更多列齐开时1005px，仅表内滚动；1440默认1165px、更多列1402px；1680默认/更多列均1405px。详情图形及所有业务数值保留。当前页没有一行带预估区间时（例如任务已关闭、整页只读），本月收益列只放到账或「—」并收窄；同时没有一行有当前任务时，当前任务列也收窄、「—」居中；省下的宽度分给设备、用户、状态三列，1440下51位实例号完整显示，不在状态和收益之间留大片空白（未开更多列时生效，只按当前页数据判断，不改列、数据或请求；第一次读取完成前不定排法、表头文字先不画，之后重读、翻页、筛选沿用上一次排法，只有新一页数据需要另一种时才换，表头不来回跳）。1024下设备列不小于132px，常见商品名（如 NexGridBox Pro）完整，宽度从状态列让出。状态分布图例首项与分布条左边线对齐。详情浮层标题下的实例号单行显示、中间省略保留末8位，完整号在设备事实里可复制。

**③ 查找与状态**：11态、四来源、关键词和商品筛选完整保留。默认状态／搜索／来源，商品在更多筛选。搜索停300ms或Enter查询，下拉立即查询，条件和页长变化回第一页；10／20／50条，后端ID倒序。网址保存 `keyword/userId/simState/source/productCode/pageNum/pageSize`，前进后退恢复，保留其他参数；无效参数只在表内显示一次，并提供“清除筛选”；无效状态下拉明确标“无效状态”，不静默当全部。空状态只陈述一次。分页统一用“台”。商品名称只在有E1读权时读取SKU目录，不读上架门、折扣或图片；无权／失败显示代码，不阻断E5。

状态筛选分组统一写「运行、暂停、停用中」。状态名称保持：待激活、等待初始化、旧任务未结清、运行中、等待配置、已暂停、停用中、已停用、已解绑、出错重试中、任务已关闭。普通激活仅待激活；等待初始化自动开始；旧任务先核证据，改池不能解决；等待配置去任务池核对；出错显示原错误和下次重试，系统每30秒重试，无修复按钮；停用中仍占名额且不能再次处置；任务已关闭整页只读；页头说明只写查看，行尾不重复“只读”。已暂停用暂停图标，任务关闭用电源关闭图标，时钟仅用于等待。停用中行的操作列和别的行一样放「⋯」，禁用，悬停或聚焦说明「停用中，结算后自动停用，暂时没有可做的操作」；状态第二行常显“结算后自动停用”。任务已关闭时原因写在页头和结论句，行上不带问号。共用状态／任务口径移到列头，行内仅特殊原因保留问号，任务类型可点开查本条时间事实。

**④ 写操作与R1**：行尾⋯和详情底部使用相同动作判断。普通激活、取消激活、暂停／恢复用户直接POST；强制激活、解绑及旧任务无收益终结只提交A2。用户暂停／恢复确认以用户及全部设备（含手机）为主对象，只将发起设备作为次要事实；作用全部设备（含手机），成功数取 `changedCount`，停跑不计收益不补发。取消激活有运行单时等待当前单完成结算后停用且不再接新单，不退款；强激不越每人6台；解绑不退款、购入时间不变。强激／解绑需专门业务权或growth委托，并具实际A2发起权；缺平台权禁用并说明。

七种意图首次发送前持久保存操作者、会话代次、设备／用户快照、原path/method/body、完整A2信封、原理由、命令号及24小时期限。存储失败零写入；结果未知冻结原内容与对象，刷新可恢复，只从原信封原号重试。待确认行有标记，读回后条内写出本页读到的状态或未包含原对象；不能凭状态自动解锁。原号重试被明确拒绝后，标题改“原号重试已拒绝”，主按钮改“解除待确认”，不再混入通用网络重提指引。单设备未知阻止同用户批量动作，用户批量未知阻止该用户设备动作；E6手机动作共用设备／整用户的待确认锁；两页识别同一操作者另一页保存的原操作，只在原页面按原请求恢复，不在新页面另起意图。成功回执有效才清记录，后续读取失败不重复POST。仅原号重试收到 `isExplicitRejection` 认定的带码明确拒绝，人工核对后可解除本页锁；401／403／408／425／429、所有IDEMPOTENCY码、未知及旧任务前置证据变化不能解除。过24小时只读回核对，保留记录和对象锁；旧指纹缓存无法还原原请求时只核查，不用新草稿补原操作。

确认框读服务端reason-policy并与8–200取更严交集；规则失败不能提交，理由按NFC可见字符及接口码点检查，提交中全锁。对象、状态、名额和不可撤销／不计收益后果常显，执行摘要默认收起，确认按钮具名。审批由另一位具审批权及对应业务权的管理员复核，不能本人批，本页无批准入口。激活框名额比例条仅保留内置悬停和读屏说明，不再另抄旁文；激活前后值仍常显，超额提示保留实际n/6；解除框的正文、事实、拒绝提示和核实勾选按ReleaseBody直接排列的共用样式留16px间距。旧任务终结的原请求、任务执行记录及恢复预算保留，不授予重放。旧任务仅LEGACY_PENDING且E5写权与proposal_create双权主动GET；展示无案／退出证明／阻断／已结／可申请，证据逐字段复核不变后才提交；有效票号仅证明申请已收录。

**⑤ 接口与权限**：保留 `/api/admin/devices`、`/overview`、`/observability`、activate/deactivate、batch pause/resume、legacy-unknown-resolutions GET／proposals POST和 `/api/admin/platform/audit/operations`。普通读写沿 `device_e5_read/write`，强激／解绑沿专项业务权和A2发起权，E6配置权不授予设备处置权。全部写意图后端按原Idempotency-Key及内容去重，普通动作24小时窗口；复用共享按号查询和受控核查接口；原读回入口已接查询，证据表单由视觉 worker 接入，不提供超期自动解锁。

**⑥ 活动与验证边界**：「最近24小时操作」默认尚未读取，展开才GET，最多50条；空、失败、加载和成功分开，动作名与菜单一致；每条一行放动作、时间和可从当前页匹配的设备实例／用户号，不在当前页则明确显示原对象编号；原事件与原对象放各条技术气泡，不重复列出第二份活动。刷新仅对已展开活动重读。页面模拟可验证展示、命令保持和拒绝分类；2026-11-11已从真实应用入口验证七意图未知恢复、23项查找/详情旅程、5项重试边缘和实际四角色；业务写均在浏览器拦截。71态完成1440/1024深浅默认/展开截图并逐态复核。真实审批执行、资金及用户终端结果须另外验证，不以模拟代签。

---

#### [E6a] 手机任务、收益、用户手机与校准规则

**2026-11-14 后端 111e00cd 同步**：手机恢复沿E5运营暂停及有效归属范围，最多200候选，按changedCount和404核对刷新。风险结案不再传receiptOnly，接已有成功审计编号并传真实evidenceAuditId；63a4f669已将 E6_PHONE_RISK_SETTINGS / CONFIG / E.compute.phoneRisk.settings / ADMIN.PHONE_RISK_SETTINGS_UPDATED 纳入成功证据白名单，严格绑定原actor/method/path/recordId/scope/key/hash，接受SUCCESS及SUCCEEDED，证据不足仍UNKNOWN。旧无receiptVersion记录不升级。手机页恢复确认框与E5同一说法（范围“该用户被运营暂停的设备，包含手机”），成功提示同E5；无候选404时确认框内报原因并刷新列表。旧“不接受操作记录编号”分支已删除；结案框选“已执行”时显示“成功审计编号”输入，说明不再重复“证据不够记为仍未知”。出处 AdminCommandInvestigationService.supportedSuccessFact、AdminCommandInvestigationMapper.successEvidence。

**2026-11-12 风控与直接命令同步（代码侧）**：新风控保存的原信封带 `receiptVersion=1`，PUT 按原修订、全部模式、两阈值、理由和 Idempotency-Key 去重；24 小时内恢复逻辑允许原样重试。升级前没有该标记的旧未知记录保持只读当前设置。GET `/api/admin/config/phone-calibration/risk/receipts/by-key?commandKey=` 精确代理保留查询串；`checkDirect` 验证 scope、key、原操作者、method/path/target/hash/status，只有原绑定一致且状态成功或确认未执行才收敛，当前设置独立读取。查不到不证明未执行，403不解除，旧无来源及仍在处理中继续保留；成功回执的 originalResponse=null 保持为空，不补造原 settings/stats。用户手机直接动作沿原 E5 命令的服务器绑定查询与证据核查，原页面、原快照和 E5/E6 对象锁保留。刷新后风控重试及明确的查原保存结果入口、手机核查／结案入口、确认框与使用说明的旧「不去重」说法，以及新错误码中文由视觉 worker 完成；本轮不改变屏幕组成和文案。

**手机功能集中（2026-11-09）**：E6 顶部为「手机任务池」，使用 `GET /api/admin/devices/task-pools?kind=PHONE` 和 `/task-pools/PHONE/tasks` 展示英文任务名、类型、时长、`baseReward`、`asset` 与启用状态。没有随机添加；新增、编辑、启停继续使用现有 `/tasks` 与 A2 双人审批、覆盖率和版本规则，HTTP 和 A2 参数均携顶层 `poolCode:"PHONE"`，旧格式明确拒绝；仅可写 PHONE 类型。手机策略固定解析为 `["PHONE"]`，旧手机大类选择入口删除。

PHONE 参数编辑继续省略 catalog `status`，由后端保留原状态；编辑已有任务时启停只读，catalog 状态变更走行内启用／停用。`TASK_STATUS_REQUIRES_LIFECYCLE_ACTION` 明确提示参数编辑不能改变启停状态及正确操作入口。正奖励任务从停用改为启用、编辑提高奖励或启用任务时，确认弹窗沿用「会多付钱」提示，`amplifies` 由服务端按规则任务前后值重算（新建启用且 baseReward>0、由停到启、提高奖励或启用状态缩短时长均判为放大），E6/A2 使用同一口径、不信任提案请求值；单纯停用不标资金放大，零奖励启用不承诺免覆盖率检查，后端覆盖率校验保持（2026-11-11 补，BE-E-08）。

E6 逐区授权：PHONE 任务、手机 5 档收益和新用户引导收益对比均沿用原 E2 权限，只有 `device_e2_read` 才读取和显示，PHONE 任务与档位调整按钮及提交还须 `device_e2_write`，引导对比保持只读；用户手机列表和设备动作沿用 E5 读取与各动作权限；校准及其余设备配置读取／修改分别用 `device_e6_read/write`（换机等专项条件照旧）。无对应读取权不挂载区块、不请求其数据。持 E2／E5 手机权限的操作者通过既有菜单机制获得 E6 入口；显式菜单由后端迁移，PC 仅在缺少显式菜单时扩展原权限推导，不授予 E6 写权。页面迁移不改变后端原有权限。

E2 的「手机 5 档收益」「新用户引导收益对比」迁入本页，数据与行为保持：5 档调整仍走现有审批；批准后更新档位配置，供后续校准与引导展示使用，不改变已派 PHONE 任务的奖励快照，不承诺下个结算周期重定价。引导对比只读，手机来自 T3、其他来自在售商品，去来源处修改。档位分界只保留 E6 的现有完整校准面板。
5 档收益调整按币种逐项校验专权：改 USDT 收益须 `device_e2_phone_tier_usdt`，改 UVT／NEX 收益须 `device_e2_phone_tier_nex`；提案、批准与回放三处同口径，只改一种币种而缺该币种专权时返回 403（2026-11-11 补，BE-E-03）。

「用户手机」列表读 `GET /api/admin/devices/phones?keyword=&pageNum=&pageSize=`，保留现有手机遥测与激活／取消／强制激活／解绑／按用户暂停动作。动作权限沿用 E5，E6 配置权不授予设备处置权。理由在各动作弹窗填写，每人 6 台上限包含手机。手机每任务奖励、固定时长及 1 小时在线有效期保持；PHONE 与商城 DEVICE 池互不相通。



**四分区改版（2026-11-10）**：按读权显示「手机任务」「档位与收益」「用户手机」「校准与风控」。`tab=tasks|tiers|phones|calibration` 和校准 `section` 记住位置，替换 URL 保留其他参数；旧 `#phone-calibration` 继续定位校准。切分区保留本页会话普通草稿，刷新有变更时先提示；已发原命令独立保留。

手机任务以三项节奏小结与六列表显示，仅取 PHONE 池；无启用任务的平均时长与约每天单数显示「—」。五档用同尺度 USDT 阶梯，UVT 单独完整显示，T3 标「当前引导档」；合法响应必须五档齐全、身份唯一且金额为正，不完整时整组不画。引导对比只读，手机行置顶，少于四项保留提醒。日收益调整除 E2_write 和提案能力外还按 `device_e2_phone_tier_usdt` / `device_e2_phone_tier_nex` 隐藏对应入口；后端 66ecdb47 已在提案、批准及回放按请求币种分别检查专权；双币请求须双权。单币页面请求保留，原操作恢复也逐币种检查；服务器票的 type/amplifies 保存为 proposalReceipt，可见展示交视觉 worker。

用户手机停用中行与 E5 一样显示禁用「⋯」，提示「停用中，结算后自动停用，暂时没有可做的操作」。仅有暂停原因或异常状态的行在状态旁显示原因问号，只讲原因。「电量和心跳」列第一行是电量，第二行常显距上次心跳多久（「心跳 42 秒前」，按秒、分钟、小时、天取整），没采到写「心跳未采集」；每行电量均可点开遥测气泡，查看原始状态、运行状态、电量、心跳、距心跳秒数、充电、网络和温控；未采集字段明确写「未采集」，不当 0。Android 校准试算命中显示芯片名（后端 `model`），缺失时用 `socKey`；都缺失则写「命中规则未返回名称」，不把空值拼成 null。`fdc9f469` 的有效芯片规则要求名字和键均非空，缺失提示仅兜底展示。

用户手机复用 E5 phones 模式与原权限：默认设备、用户、状态、每日收益、电量和心跳、操作六列；当前任务号在「显示更多列」保留。状态先后和后端一致：已解绑 / 停用、停用中排在运营暂停前面，其余有暂停原因的写「已暂停」，原因在问号里；充电／网络遥测 null 显示「未采集」。查询只传 keyword/pageNum/pageSize，不造全平台手机状态分布。六种动作的六台门槛、全用户暂停范围、不退款／不补发及审批边界不变。

2026-11-11 版式补充：金额显示去掉后端补零，同组／同列用真实最大小数位对齐且至少 2 位，不舍入；五档 USDT 为 3 位、UVT 为 2 位，悬停或聚焦可见后端原值，确认与命令保留完整字符串。手机状态用 rd 对应图标／色调；设备格最多两行，1440 实例号完整、1024 中间省略保留后缀，复制和读屏仍是一整串；设备名和手机任务名不拆开，放不下在末尾省略。分界轴与输入等宽，1440 四列、1024 两行两列，校验约束在框下；硬件空态用标准空块加导入／新增入口，帮助跟标题。窄屏主题导航上移，待核验异常标记保留。任务、风控及换机数值错误贴着对应字段显示；预设预览取消后可再次载入。原值气泡适配长实例号，不溢出边框。可选当前任务号单行显示，窄列中间省略并保留后缀，悬停／聚焦可查全号。

2026-11-11 复查补充：任务名称列设上限，操作统一用「⋯」；只读角色收起操作列，任务一项未改不能提案。任务与校准确认逐项显示「现在 → 改后」，支出增加用警示图标说明具体依据，同次试算的匹配、其中变化和待核验数常显。手机解绑、整用户暂停及本单结算后停用的后果常显在事实区。档位非递减校验和允许范围贴着输入框；换机四项在页面、编辑和确认中同名，未改禁用提交。成功提案用进行色显示对象、审批单与「查审批结果」，同分区多条合并展开；只有结果未知保留警示与原样重试，明确拒绝后突出解除。读失败每个资源只报一处，依赖块用中性等待文案；预约结论用进行色并标明时区，同时列出空 Android 规则及待核验硬件。试算变化数包含在匹配数内，待核验用警示色。

校准与风控用八个主题定位；当前、预约、草稿分界轴明确区分，共同数值刻度。待核验样本非空直接展示；Android/iPhone 共用一个可切换目录，预设与编辑用抽屉，完整本地规则校验、整颗芯片移动、主动删除记忆及补设备事实默认不选均保留。风控独立首次失败即可重试；六模式和两阈值整组编辑、直接保存，统计按真实检查码呈现命中／拦截与比例，不将命中当全部校准量。换机仍为 E6_write AND flag_toggle，四值一单原子审批，原发布结果与当前资源分别显示。

**结果未确认**：首发前保存当前账号、原对象、完整请求（含理由、版本、命令和目标）、原命令号与发起时间；存储失败阻止发送。未知结果锁住相应对象，切区、刷新、404、当前值相同或超过 24 小时均不清除。有去重保证的操作只原样重试；A2 先查原票，只有权威终态才能准备新变更；重试明确拒绝后按 `isExplicitRejection` 人工解除本地保护，401/403/408/425/429 和 IDEMPOTENCY_* 不算。风控 PUT 已按 key/hash 绑定去重；新信封可在原确认框原样重试，升级前缺 receiptVersion 的旧记录继续只读回。现有读取当前设置入口先查询原保存回执，再独立读取当前配置，查不到、403、无来源及未知均不解除；原响应不可读时只接受回执终态，不补造原设置。刷新后的待确认条和原确认框都能按原操作重试；完成提示使用后端重放的原保存版本，当前版本独立读回。新版风控未知记录查询仍未知或超过24小时后，有调查权限及 device_e6_read 的超级管理员可用共用核查结案框提交后端支持的三种结论；无权显示联系提示。先按 PUT 原路径和原命令号查询服务端 scope/hash，再提交证据，证据不足仍未知、保留记录，确认终态才解除；旧无回执版本记录仍只读回。旧缺完整请求／理由记录只可查原票。连续在线兼容值只读；三估算值按精确 paramKey 单独审批，只承诺公共配置发布，不承诺现行手机结算消费；基准算力降低才标放大，基准日产及UVT折算系数增加才标放大，确认提示与提案使用同一方向。换机重试拒绝证据绑定原命令号，旧命令的解除证据不能用于后续命令。旧E域槽位保留已改版E页（含E4）的过期证据；过期仅查询，E3本次仍沿原策略。

金额在响应接收边界保留后端十进制字面值供显示、确认与原请求；18x6 比较用缩放整数，图形比例才用 Number。不额外舍入、缩写或把 null 当零。

**① 目的 & 对齐**：为原生 APP 提供可审计的硬件匹配规则、五档分界和换机资格。普通手机校准自动匹配，不逐个审批；平台算力不冒充物理 TOPS 或真实跑分。对齐前端 §4.7.3、§6.10、§6.11。

**② 后台界面**：/devices/compute-config 展示当前与待生效版本、四个分界、硬件规则、来源说明、待核验硬件汇总及试算。E2 不再挂载手机分界入口。/platform/config 提供只读摘要；发布审批在 /platform/audit。空配置明确尚未发布，读取失败提供重试；待生效版本存在时禁止继续提交。只读权限不显示提交能力。

**③ 可控参数**：

| 参数 | 约束 | 生效 |
|---|---|---|
| thresholds | 四个严格递增正数，划分五档 | 下次校准 |
| androidSocRules / iosModelRules | Android 按规范芯片及已核实标识匹配；iOS 按机型及已核实硬件别名匹配，配置运营算力区间；来源须可核实，冲突进入待核验。详见手机校准发布规格 | 批准后用于后续校准 |
| computeValue | 大于 0、不超过 1,000,000、最多三位小数；不是 TOPS | 下次校准 |
| expectedRevision | 必须匹配服务端当前修订 | 审批执行时再校验 |
| effectiveAt | 留空为批准后生效，或预约未来至多 366 天；仅允许一个待生效版本 | 须先批准且到达预约时间；若批准时已过预约时间，则批准后生效 |
| phoneBinding.allowReplacement | 允许或禁止替换绑定 | 新安装登录与激活时 |
| phoneBinding.minReplacementIntervalDays | 非负整数天数，按最近成功替换时间计算 | 新安装登录与激活时 |
| phoneBinding.replacementWindowDays / maxReplacementsInWindow | 统计窗口为 1–365 天，窗口内次数上限为 1–100 次，均为整数，与另两项策略一起审批 | 批准后用于后续换机资格检查 |

不提供未经核实的硬件种子或默认能力值。未知硬件进入待核验；精确型号已知但硬件不符时不能使用泛型号兜底。普通注册礼独立于手机能力，H5 登记奖励与基础托管收益停用。

**硬件目录呈现（2026-11-11）**：Android 按标准折叠组展示，共用字段和控件；各档芯片表列宽一致，整颗移动、编辑、移除同排靠右。iPhone 目录跟随页面滚动，保留三项筛选；状态为「已启用／已停用」，每行显示「编辑」和更多菜单，启停及危险删除在菜单中；删除确认独占一行，不挤压状态列。两种预设导入及机型／芯片编辑抽屉统一 540px，预览逐项列出新增、跳过、补充信息和冲突，原始目录说明收进技术信息。新增表单在交互后显示字段错误，保存仍使用原有校验与完整草稿。

**硬件收尾核验（2026-11-11）**：独立复核 F5、F6、F7，48 个硬件状态在 1440／1024 宽、深／浅两套主题均走通，逐张复审最终实现的 472 张截图。通过真实页面分别捕获 `c4fafe67` 与最终实现的 Android 导入、芯片编辑／整颗移动／移除、iPhone 设备信息导入与范围编辑后的试算及方向请求，加完整发布提案共 13 份请求体，逐字节一致；发布提案在发送前拦截，未执行真实发布或审批。逐态结论、截图清单和最终关卡结果见 E6 重构说明、`reports/visual/E6/REVIEW.md` 及 `hd-impl-e6-fin` 收尾报告。

**④ 操作动作**：编辑规则→试算及影响预览→输入 8–200 字理由→提交 A2 审批。编辑后原试算失效。提交成功仅表示待审批，不显示已生效。另一名具备权限的操作员检查完整阈值、规则、来源、目标版本与生效时间后批准；确认弹窗仍展示完整提案。审批重放按版本锁、幂等键与覆盖率护栏执行，禁止自批及过期版本覆盖。

**连续在线满额时长退役（BUG-282，2026-11-07 后发裁定）**：`E.compute.continuityFullHours` 保留已存原值及小时单位，E6 与公共配置继续兼容读取，不参与任务收益计算，不提供调整、恢复或新提案入口。E6 在线参数计数与相关说明标明退役兼容用途；A5 同名旧行保留当前值与历史，标明已退役只读，不显示修改需确认。A2 从服务端 `retiredOperation` 标记识别原单或包含此键的旧批量申请，保留查看和按原权限取消/撤回，不允许执行；其他 E6 参数及有效批量不受影响，不修改原配置值、历史任务和收益快照。本条优先于旧在线加成可调及参与收益的描述。

**当前生效路径（BUG-147，T02；BUG-282 更新）**：机型风控填理由保存后立即生效，用于之后的校准；不走审批。手机校准规则由另一位超级管理员批准后生效，预约发布还须到达所选时间；批准时若已过预约时间则批准后生效。手机换机策略批准后生效，用于后续换机资格检查。连续在线满额时长已退役，仅兼容读取。收益估算三项仍按原审批流程批准后发布到公共配置 `/api/config/platform`；页面、详情和确认说明仅承诺这一已核实的发布结果，不承诺它们被任务结算或 App 收益估算消费。当前模拟任务按已保存的任务金额结算，本轮不改变结算。全页说明、页脚和各确认说明必须区分这些路径，不把风控写为待审批，也不把预约版本写为批准即发布。校准和风控确认框在未展开详情时也直接显示各自的生效路径。机型风控保存请求须携 `Idempotency-Key`，同键同内容重放原回执、同键异内容拒绝（2026-11-11 补，BE-E-04）。

**⑤ 接口**：GET /api/admin/config/phone-calibration 返回当前/待生效策略与待核验硬件汇总；POST /api/admin/config/phone-calibration/preview 试算样本并返回历史影响统计。写入使用既有 A2 提案流程，command.op=e6_phone_calibration，目标为 E / phone_calibration_policy / phone-calibration。APP 只读校准结果，不获得管理端规则编辑权限。

**⑥ 权限 & 审计**：读取要求 E6 或 E2 read；试算要求 E6 read；发布要求 E6 业务权限并通过 A2 双人审批。A2 从持久化 command 读取详情，不信任提交方摘要。记录操作人、审批人、理由、前后版本及幂等执行结果；A5 显示规则版本摘要。

**⑦ 风控 & 联动**：配置解析或持久化不可用时禁止手机激活，不伪造成功。手机校验按用户 2026-10-03 决定保留普通账号认证、安装标识、账号/设备归属、绑定与换机、服务端规则匹配、版本和幂等业务校验；不要求 APK 包名/签名白名单、Android 硬件密钥证明或证明有效期。安装标识用于区分安装，不声称能防伪或证明真实物理算力。策略不回溯已结算收益，不直接改已激活手机值；已有手机在下一次主动校准时使用新规则。异机原生登录先停止旧手机任务，即使换机被拒也不得继续领取；原绑定合法恢复只解除换机暂停并等待新心跳，运营暂停保留。已购设备不受手机绑定策略影响。

**⑧ 埋点(事件)**：沿用 A2 审计、配置审计与 compute.config_changed 事件。验收覆盖空配置、非法/冲突规则、试算失败重试、取消不写入、待审批、不同审批人、版本冲突、预约生效、待核验重试及只读权限。原生 Android 设备识别、校准、绑定、异常恢复与执行需要独立真机验收；空硬件规则仍是待核验，不直接生成算力或收益。

#### [E6b] 平台特性开关

**① 目的 & 对齐**:为运营提供平台布尔特性开关(feature flag)寄存器,规划用于门控用户端对应功能的显隐(forward-spec);本期(SPEC-0)示范 `computeShareEnabled`(电脑共享算力 PC 入口,默认关闭)。对齐 uniapp `store/config-types.ts`(`FeatureFlags.computeShareEnabled` / `FeatureFlagKey`)+ `mock/platform-config.ts`(`DEFAULT_PLATFORM_CONFIG.featureFlags`,DR-1 默认 OFF),admin `lib/mock/admin/compute-config.ts`(`COMPUTE_FLAGS`)。**现状(真)**:flag 在 admin 可切换 + DR-1 默认 OFF + admin/uniapp 双 mock 镜像;前端**尚无任何 UI 消费此 flag**(grep `computeShareEnabled` 于 uniapp `src/` 仅命中 `mock/platform-config.ts` 与 `store/config-types.ts`,0 个 `.vue` / 组件 / store 消费;`config-types.ts` 注:「前端零入口零推送;后台一键开启后前端才长出弱入口」—— 将来时)。**门控用户端「电脑共享算力」PC 弱入口与下载页显隐是 forward-spec(后续 SPEC,pending),前端消费未落地**;电脑算力本体(对应 §6.11 载体分层将新增的 PC 载体)亦为后续 SPEC,前端 PRD 暂无独立章节。服务的业务目标:以可控开关分阶段对用户放开新算力载体入口(对齐 §1.4 **算力撮合服务费**新增量 —— 共享自有 PC 算力 ≠ 购买 NexionBox,故不含设备销售口径;撮合服务费是三杠杆里最直接的 §1.4 链;与 12 月节奏的功能开放节拍对齐)。

**② 后台界面（现行边界）**：本页当前接口的 flags/gpuTiers 为空、下载地址为空，不再生成旧平台开关或 GPU／下载编辑入口。以下 `computeShareEnabled` 表仅保留历史 forward-spec 背景，不代表本轮 E6 已提供该操作。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| `computeShareEnabled`(电脑共享算力入口) | `false`(默认关闭,DR-1) | 布尔(`on` / `off`) | 下次 `platform-config` 拉取生效(冷启动 / TTL 刷新;无推送通道) | **[forward-spec · 前端消费未落地]** 规划门控用户端「电脑共享算力」PC 弱入口与下载页显隐(开启则显现、关闭则隐藏);现状前端无任何 UI 消费此 flag,toggle 仅改 server-canonical flag 值 |

> admin params 存储以字符串 `"on"` / `"off"` 编码(`pget` 派生);PROD 接口 body 用 `enabled: boolean`(`compute-config.ts` 头注),与 uniapp 端 `boolean` 一致 —— 编码差异为各端 mock 细节,跨端 key 与语义一致。

**④ 操作动作**:`开启<flag>` / `关闭<flag>`(切 `computeShareEnabled`)。执行角色:**对齐 A3/J1 feature-flag 治理分层 —— 增长(lead)/ 超管执行,止血场景风控参与**;开启即对全网放开新载体入口,reversible 且不涉资金流出 / kill-switch。切换经业务专属确认弹窗(toggle)+ 理由必填 → `setParam(E.compute.computeShareEnabled, "on"|"off")` 写入 server-canonical(下次拉取生效)+ A2 审计 + 实时告警。

**④a 交互与弹窗规格**:
- 触发控件:flag 行右侧开关(`role=switch`,`data-on`,`data-proof=e6-flag-toggle`;位置:平台特性开关面板每行尾;可用态:`hydrated` 后可点;点击行为:`openActionConfirm({op:"param-fixed", paramKey:computeFlagParamKey(key), fixedVal:next?"on":"off"})` → 因不传 `edit` 故无「目标新值」number 输入)。
- 弹窗(shell `OperationConfirmModal`):
  - 信息区:动作名(「开启 / 关闭 电脑共享算力入口 · `computeShareEnabled`」)+ detail(`frontendEffect`,forward-spec:**规划**开启后用户端显现 PC 入口与下载页、关闭则隐藏;现状前端尚无消费,toggle 仅改 server-canonical flag 值)。
  - 影响预览区:当前态 → 目标态(开 / 关);(规划)门控用户端入口显隐说明。
  - 输入区:仅 理由(reason,必填 ≥8 字 / `reasonMin=8`);无目标新值 number 输入(`param-fixed` 固定值)。
  - 输入控件表:reason text(必填 ≥8 字;无客户端上界;空 reason 由 PROD 服务端拒绝为建议契约,TBD)。
  - 按钮区:确认 / 取消(视觉弱于确认)。
  - 错误态:reason 不足 8 字 → 阻止提交(`reasonMin`)。
  - 成功反馈:toast「<动作名> · 已写入 · 以后端为准」;A2 审计落账。

**⑤ 接口**:
- 用户端读(已落地,server-canonical):`GET /api/config/platform` → `featureFlags.computeShareEnabled`(`mock/platform-config.ts` 头注 PROD 行;客户端只读缓存)。
- admin 改(已定义于 `compute-config.ts` 头注 PROD 行):`PATCH /api/admin/config/feature-flags/:key` body `{ enabled: boolean; reason: string }`,`Idempotency-Key` 请求去重头(PROD PATCH)。
- admin 读:`GET /api/admin/config/feature-flags` → `{ key: ComputeFlagKey; enabled: boolean }[]`。
- 现状 mock(backend-replaceable):`e6-compute-config.tsx` → `openActionConfirm(op:"param-fixed")` → `e-view.tsx` `setParam("E.compute.computeShareEnabled", "on"|"off", {action, reason})`(自带 A2 审计);读经 `pget`,未设回退 `defaultOn=false`。

**⑥ 权限 & 审计**:角色×动作矩阵片段 —— 查看:全运营角色只读;切换开关:**增长(lead)/ 超管**执行(对齐 A3/J1 flag 治理,止血场景风控参与)+ 理由必填 + A2 审计。审计**沿用统一 A2 schema(§2.x A2 ⑥)**,字段(append-only):`actor`、`role`、`ip`、`action`(如「开启 电脑共享算力入口」)、`target`(`E.compute.computeShareEnabled`)、`before`(on / off)、`after`、`reason`(≥8 字)、`ts`。注:同 E6a —— 现状 mock `OpsAuditEntry` 缺 `role` / `ip`,登记为代码侧待补(以 §2.x A2 ⑥ 为 schema 单源);`Idempotency-Key` 非审计列,为 PROD PATCH 请求去重头(见 ⑤)。开关变更实时告警(放开 / 收起用户侧载体入口为高敏配置)。

**⑦ 风控 & 联动**:server-canonical —— `featureFlags` 服务端权威,客户端仅 UI cache(DR-7),不可篡改。下次拉取生效:改后对全网在客户端**下次 `platform-config` 拉取(冷启动 / TTL 刷新)时生效**;无推送通道,非实时;开关本身不涉已结算收益,无回溯问题。联动(forward-spec):`computeShareEnabled` 规划门控用户端电脑算力 PC 入口与下载页显隐,**现状前端无消费(后续 SPEC,pending)**;开启即对全网放开新载体入口,须与 12 月节奏(新载体何时对用户开放)、容量与风控就绪对齐。电脑算力本体计产规则、PC 载体因子待后续 SPEC 在 §6.11 载体因子表落地。**治理边界**:`computeShareEnabled` = 平台能力开关(载体放开,E6 域托管),与 §9.11d.1 → J1 止血型 kill-switch 功能闸**分治、不重叠**(`computeShareEnabled` 不在 §9.11d.1 二元功能闸集合,无双写冲突);交叉引用 A3 / J1。**上线顺序门**:`computeShareEnabled → on` 仅在 **PC-载体 SPEC(§6.11 PC 载体行 + 计产规则)落地后**才有业务价值;此前 ON 会暴露指向尚未实现功能的不完整入口,须按此顺序依赖放开。跨端一致:admin `E.compute.computeShareEnabled` 与 uniapp `FeatureFlags.computeShareEnabled` 同 key,增减 flag 须三端同步(`config-types.ts` / `platform-config.ts` ↔ `compute-config.ts`)。

**⑧ 埋点(事件)**:纯平台配置,无用户侧业务事件;仅 admin 审计事件(对齐 A4)。`compute.flag_toggled` —— 触发点:E6b 开关切换确认成功;关键属性:`actor`、`flagKey`(`computeShareEnabled`)、`before`、`after`、`reason`、`ts`;消费:A2 审计流水 + 配置变更告警。注:当 `computeShareEnabled` 翻为 `on` 后,用户端新增 PC 入口曝光 / 点击等用户侧事件由后续「电脑算力」SPEC 定义,不在本开关范围。

## 第 11 章 分销与团队(域 F)

F 域保留五个页面：F1 团队等级晋升、F2 团队奖励设置、F3 团队平衡奖励、F4 奖励池、名额与排行榜、F5 奖励记录核对。F4 的团队激励池、硬件配额、大使审批和排行榜各有独立功能契约。

F4 总览的 `voteWeights` 只列出有效等级的正整数票数。没有配置正票数时，返回 `[]`，票数区显示「票数还没设置」，团队激励池、硬件配额、区域大使和排行榜仍可读取。结算时由服务端核验配置和参与人的有效票权。

> **后台用词（2026-11-04）**：运营后台的页面名和文案与 App 用同一套名称，不再使用投资、多层级或双轨用词。F2「团队奖励设置」、F3「团队平衡奖励」、F4「奖励池、名额与排行榜」、F5「奖励记录核对」。奖励类型：好友购买奖励（`direct_purchase`）、好友设备收益奖励（`direct_device_earning`）、团队购买奖励（`network`，按 L1–L7 规则编号配置）、团队平衡奖励（`binary`，A 组 / B 组）、同级奖励（`peer`）、好友升级奖励（`cultivation`）、团队激励池（`leadership`）、创世节点收益（`genesis`）。人与关系：直推 / 直属 → 直接邀请的好友，下级 → 团队成员，上级 → 邀请人；业绩 → 订单额；安置 → 分组；佣金 → 奖励。L1–L7 作为规则编号保留，页面不写「第 N 层」。接口字段、枚举值、权限码、路由、参数键和 A2 动作串不变；本章以下正文中的旧称（双轨、对碰、佣金、七层、直属、领导池、培育奖等）指同一对象。后端下发的标签（菜单与权限显示名、F5 来源说明、排行榜「USDT 佣金」等）由后端单独改名。

- F2 保留现行团队购买奖励规则（L1–L7），L1 唯一固定 10% 基础预算支持双币拆分，L2–L7 沿原规则；好友设备收益奖励的总比例和拆分独立配置。两类政策同一版本审批，未配置不补正式费率。Partner Status 与原购买/其他奖励冷却保留独立控制。
- F1 等级、好友升级奖励，F3 团队平衡奖励，F4 团队激励池、配额、大使和排行榜保持原公式、参数与入口。等级及团队关系的既有可见性规则不扩大好友奖励的受益范围。
- F5 保留历史 network、binary、peer、cultivation、leadership、genesis，新增 direct_purchase、direct_device_earning；八类金额按 USDT/NEX 分币种统计，好友奖励按结算组处置。
- 高敏操作复用 A2 的确认、理由、审批、稳定命令号和审计；资金放大复用 B1 服务端覆盖率门；钱包资金和奖励账归 D4，不新建另一套账本。
- 购买拆分冷却只读引用原 commission/cooling-days；设备分成冷却独立，提现冷却仍归 D5/H1，不可混用。
- F3 团队平衡奖励每日上限仍由 H1 Phase 派发；F4 排行榜反欺诈继续复用 K1、消费 K2，取消资格执行归 F4d。既有未确认的 F4 资金阈值、排行榜事件与 all-time 派奖触发口径不由本节另作裁决。
- F1 的等级门槛与奖励清单、Partner Status 权益、团队激励池票权及配额继续使用各自已确认来源。好友购买奖励不得另建总比例权威，原 L1 实际配置固定 10%；好友设备收益奖励不继承购买比例。
- 埋点命名、身份和通用属性继续归 A4；好友奖励事件带结算号、来源和政策快照。统计只计真实已到账净额，不把待审批、冻结或已撤销奖励当作到账。
- 账户侧文案使用可理解的业务名称，不暴露内部层级、字段或错误码；后台契约与权限由服务端权威执行。

---

#### [F1] 团队等级晋升

2026-11-15 按后端 `111e00cd`、App `44b55db8` 核对当前合同。路由 `/network/v-rank`，`network_f1_read` 控制读取；本节覆盖现有能力，不恢复旧稿从未实现的 V9–V12、奖励调序、批量派奖、领取或完整权益预览。

**页面与读取**：V0–V8 九级阶梯及所选一级详情；晋升记录、奖励发放记录、App 等级说明独立页签。总览、两套历史独立读取/报错，不轮询；说明页签打开时另读。总会员含 V0；本月晋升按增长与团队业务自然月计算升档日志人次，含人工升级，同人多次升档分别计数。历史每批 100 条，按 ID 倒序追加；晋升筛选用户/等级/批次/日期，发放筛选用户/等级/类型/状态。抽屉保留全部字段、快照、关联事件/审计/账单。筛选不写 URL。

**五项晋升条件**：自购算力点、团队算力点、合格直接邀请人数、达标分支数及最低等级。正门槛才参与 AND；0 不要求；分支数正而最低等级未设置时不满足。直邀人数只计直接邀请的好友中自购达到 V1 门槛者，改 V1 会影响各级该人数。四项有效相邻门槛保序允许相等、跳过 0/未成对分支；直接邀请人数不做相邻保序。首次九级配置不做整组相邻保序。

**17 个写入口与生效**：

| 入口 | 权限/通道 | 生效与限制 |
|---|---|---|
| 五项门槛逐项维护（5） | `network_f1_write`；PATCH 或 A2 `f1_rank_policy_change` | 按引擎方向判断，放宽才审批；收紧/等值直存。分支数 0 时改最低级不算放宽；正分支但 NONE 时降数量仍不算放宽，设有效最低级才放宽。保存仅影响后续评估，无全量重算或历史补发。 |
| 新增/编辑奖励（2） | 同权；POST/PUT 或同一专用审批 | usdt/uvt 金额为精确正小数字符串（12 位整数、6 位小数）；资金增加/改成资金/跨币按当时 B1 价格估值增加才审批。券、SKU 选当前可发/可履约候选，自定义非空。只改未来模板，历史快照不改。 |
| 移除奖励（1） | 同权；DELETE 直存 | 不要求重选旧失效标的，不回收已发奖励，不删历史。 |
| 开启/关闭保护（2） | `network_f1_permanent_protection`；A2 `f_ui_config` | `F.vrank.permanent`；on 保后续评估时的当前等级，off/缺值允许降到实际达到级。只改变后续评估，不扫描全体，不恢复历史最高级，人工 rollback 不受保护限制。 |
| 奖品名/各级头衔（2） | `network_f1_write`；A2 `f_ui_config` | 只改显示/接口值，不晋升、不发奖。批准头衔覆盖 PC 等级名；App 当前只显示 Vn，无头衔与奖品名界面消费者。 |
| 人工调级（1） | `network_f1_promote_user`；A2 `f_vrank_override` | 用户编号须正安全整数，目标/方向自己选；有 C1 读权时读取用户资料等级镜像，无结果保留未知，不能假定 V0。批准时重新核对真实等级及严格升/降方向；promote 只发目标级奖励，中间各级不补；rollback 不追回历史。 |
| 重发/冲正（2） | `network_f1_reward_reissue` / `network_f1_reward_reverse`；A2 `f_reward_payout_action` | 重发只允许 REVERSED；冲正只允许 GRANTED/REISSUED/PENDING_GRANT。资金重发按原 sponsorUserId 决定收款人，资金冲正仅有关联事件时反向记账；SKU 恢复或取消履约/权益；券/custom 仅改发放单状态，不实际补发/收回。FAILED 无本页重试。 |
| 首次九级配置（1） | `network_f1_write`；A2 `f_vrank_bootstrap` | 等级/奖励两表全空、mutex、一次 V0–V8、rewards=[]。标题/数字必填，V1–V8 至少一项正门槛，分支成对；不包含资金奖励。批准前仍显示空。 |
| 保存/发布等级说明（1） | `network_f1_write`；PUT rank-policy 直接 CAS | 无额外发布权限/审批；1–10 个语言含 fil，每语言 1–100 段；理由 8–500，保存整体含保留公开版最大 1 MiB。DRAFT 保留公开快照，PUBLISHED 替换；version 可不变，revision 必须匹配。 |

8 个始终审批、7 个按方向审批、2 个直接入口；五门槛/奖励增改删 REST 和 A2 外层按命令去重，说明保存不去重。专用放宽/增资审批由另一位超级管理员且有 A2 批准权执行；普通八项按另一位管理员、A2 批准权、对应业务权和 maker/checker 分离处理。精确命令、目标、字段见 [F1 条件与奖励审批](F1-条件与奖励审批-20261105.md)。

**待审批与直接保存**：来自可读 A2 队列与本人原票权威查询的 `f1_rank_policy_change` 在对应等级显示待审批。后端直存门槛/奖励不带版本、也不受该审批锁限制，PC 保持此行为；实际变更会让旧审批版本失配。等值保存未改变摘要时不一定失配。未获 A2 队列读权只能核到本人已保存的原申请，不能宣称覆盖其他人。

人工调级读取当前等级时，使用 C1 按内部用户编号精确筛选的唯一结果，并按该列表最小页长 20 请求；列表投影只有公开 userNo，不以缺失的内部 id/userId 再匹配。查无用户、数量不唯一或读取失败仍保留未知提示。原确认框在总览查询期间保持实例和原理由，收敛后关闭并重读。

**结果未知**：发送前持久保存完整原请求、操作者、对象、理由、创建时间与原号，存不下不发送。R-F1 沿用专用存储，普通八项和 F2 使用同一 F 域底层实例；旧记录只有输入指纹时仅核查，不伪造 POST。结果未知冻结确认输入与理由；24h 内原请求原号重试，超时只读核对。第一次明确拒绝按 deterministic 分类弃号；保留下来的原命令重试只以 explicit-rejection 判定，认证/限流和幂等未决不当结论。查询不写；成功重放后重读当前配置及审批状态，历史回执不作当前有效值。审批只有权威查询 pending 才标待批，查失败撤销该观察、保留原记录。

**说明未知**：HTTP 4xx 或 HTTP 200 内非零业务码的明确拒绝保留编辑内容、解除本次保存记录，不冻结为结果未知；5xx、传输失败或不可读回包仍保留原记录。保存前完整保留原文档/revision/理由；刷新或重进编辑器恢复原内容并冻结。唯一恢复动作是 GET，按原版本/状态/全部语言内容和 revision+1 比对；不一致或读失败继续保留，绝不重发 PUT。读回匹配是当前内容确认，不是独立的命令回执。发布后 App 在下次成功读取时使用；缺回退语言或固定所需段落时可能不可用，不能将简化预览视作最终 App 排版保证。

等级行的 `unilevelDepth` 是配置/公开展示值；当前团队购买奖励结算读 F2 全局比例、暂停和 depthGate，未读取本级该字段，不能将其单独宣称为实际可拿奖励层数。现成首次配置确认框仍标资金放大，会受共享前端覆盖率阻断；后端首次配置不带奖励且没有这项覆盖率检查，交协调人和视觉 worker 统一现成提示与阻断。

**显示与交付边界**：金额写币种，保留完整小数；历史 amount 在 JSON 数字解析前保留原十进制文本，不用 JS number 作为核对金额。缺保护按关闭执行；缺覆盖率不当 0。保护不保证永不降级；票权不保证随等级递增；人口不保证高等级更少。重发/冲正以类型分支为准。App 同级奖能力未开放，比例只是配置。

逻辑接入未改既定排版或重写界面文字。R-A2 原操作列表、总览失败时的全局恢复入口、过期提案确认解除等未提供视觉位置；恢复数据和 query/retry/release 接口已提供，交视觉 worker 补现有设计。无通用直接写人工解除能力；跨账号恢复 BUG-308 本轮不扩展。浏览器拦截验证按域末项统一执行，本节不声称已验真实写入。

---

#### [F2] 团队奖励设置

同一管理员的登录会话续期不重置尚未提交的确认输入；账号或审批读取资格变更按当前身份重新读取，发送前仍核对当前业务权限。批量提案拒绝不重建确认框，保留输入和理由；未知保留原请求供查询或原样重试。

> 后台页面名「团队奖励设置」（原「网络版税与分成」）。页面内：团队购买奖励（L1–L7 比例、按 L1–L7 分别暂停、团队购买奖励结算的启用 / 暂停 / 恢复）、好友奖励设置（好友购买奖励拆分 + 好友设备收益奖励，整组审批）、合作伙伴权益门槛（当前仅保存，不自动开通）、购买与其他奖励冷却。

**① 目的 & 对齐**：作为运营者，我想在同一页面配置七层购买、直属购买拆分和直属设备收益，以便核对同一来源的资金范围；作为审批者，我想按完整快照和引用版本批准，避免旧预览套用新支出规则。对齐 App 网络版税、F5、A2、B1 和 D4。

A→B→C：B 购买时 A 是 L1；C 购买时 A 是 L2、B 是 L1。购买继续原七层规则，最多七层，不因资格不足压缩层级。拆分只作用于每笔订单的相对 L1；L2–L7 原资格、Influence、活动倍率、额外 NEX 和合并上限不改。B 的真实设备收益只给 A 直属设备分成，C 的设备收益只给 B；邀请佣金和其他团队奖励不得递归计入设备分成。平台额外支付，成员原收益不减。对碰、V 等级、培育、领导池、注册礼和 Partner Status 保持独立规则。

**② 后台界面**：入口 `/network/royalty`，按七层购买、直属购买拆分与设备分成、独立权益设置、确认审批的顺序呈现。

- 七层购买：当前已有 L1–L7 基础预算率、额外 NEX 系数、暂停、资格门槛、Influence 边界、活动倍率和合并上限。L1 基础预算仍由原唯一配置固定 10%；读取缺失显示未配置，不凭页面常量初始化。L2–L7 可按旧规则调整。
- L2–L7 USDT 奖励比例按百分数输入，提案命令保留输入原文并带 `%`：`0.5 → "0.5%" → 0.005`、`1 → "1%" → 0.01`、`5 → "5%" → 0.05`、`100 → "100%" → 1`（末列为 `usdt_rate`）。PC 提案前后值带 `%`，调高/调低以同为百分数的当前值和输入值比较；提交只收录申请，批准后才生效。不得对 UVT 系数、金额、天数或本已明确按百分数解析的其他参数套用这项转换。后端现行审批描述仍将原值改写为「以服务器执行时状态为准」，并将 `f_unilevel_rule` 统一标记为放大；本次 PC 修复不宣称这些后端限制已消除。
- 直属购买拆分：仅启用状态和 USDT 占比可编辑，NEX 自动补足；原 L1 预算与购买冷却只读引用。启用时拆分所得 NEX 替代旧 L1 额外 NEX；生效期间旧系数入口只读。关闭恢复未来 L1 全额 USDT 和旧系数 NEX，七层购买不停用。
- 直属设备收益：独立启用、总比例、USDT 占比及冷却；只读引用已有 NEX 行情，不建立第二行情。
- 独立设置：Partner Status 四档门槛（当前只存配置，不会按月订单额自动判档或开通权益）、原购买与其他佣金冷却、未接入参数的只读核查；不启用平级奖或其他未接入能力。
- 默认态读取服务端实际值，编辑保留草稿；空态逐块显示未配置，`unilevelRates=[]`、部分规则行和明确 null 均保留缺失状态；不以默认比例补齐；加载态阻止对应提交；失败态分块重试且保留草稿，不隐藏另一成功区域或补假默认。
- 显示七层新结算是否已切换，与购买拆分开关分开；切换前仍按原代际，切换后关闭拆分仍是新七层结算。历史奖励不重算。

```mermaid
flowchart LR
  R["读取现行七层和直属政策"] --> D["保留完整草稿"]
  D --> P["确认两类差异、理由和资金方向"]
  P --> A["A2 待审批"]
  A --> V["复验政策版本和七层引用版本"]
  V -->|一致| E["批准整组生效"]
  V -->|过期| X["拒绝，重新预览提交"]
  P -->|取消| D
  E --> G["GET 读回并刷新核对"]
  classDef existing fill:#dbeafe,color:#111827
  classDef approved fill:#dcfce7,color:#111827
  class R,D,P,A,V,X existing
  class E,G approved
```

**③ 参数与数据字典**：全部服务端权威，页面仅缓存；不接受客户端行情、生效时间或受益关系。

| 字段 | 契约 |
|---|---|
| schemaVersion | 2；读取显式 query 协商，写入 body 声明 |
| settlementMode / sevenLayerEnabled / cutoverAt | 当前 DIRECT_ONLY_V1 或 SEVEN_V2、是否已到切换边界、服务端 UTC 时间或 null；与拆分开关独立 |
| configured / policyVersion / effectiveAt | 未配置为 false / 0 / null；已配置版本为正整数，生效时间由服务端批准生成 |
| policySchemaVersion / purchaseSplitConfigured | 实际存储政策为 1/2；旧 v1 政策仍可有有效设备规则，但购买拆分未配置，占位 50 不视为生效比例；切换前 purchase 仅旧规则只读投影，v2 写入拒绝该对象 |
| expectedVersion / expectedSevenLayerRevision | 非负整数；绑定直属政策与被引用七层快照，任何相关七层批准写入递增 revision |
| purchaseSplit | 仅 enabled、usdtSharePct；不得含 totalRatePct、coolingDays 或旧 purchase 对象 |
| purchaseSplit.usdtSharePct | 0–100%；启用时严格大于 0 且小于 100；NEX=100%-USDT |
| sevenLayerReference | revision、baseRatePct、coolingDays、legacyNexPerUsd 只读引用；缺实际配置值为 null，不写默认 |
| deviceEarning | enabled、totalRatePct、usdtSharePct、coolingDays；总比例 0–100%，启用时大于 0；两币占比均正；冷却 0–365 整天 |
| nexUsdtPrice | 已有行情能力的正数或 null；缺价待计算，不默认价格或改发全 USDT |
| F.cooldown / commission/cooling-days | 原七层购买与其他原奖励冷却，0–90 整天；购买从首次整链 preparedAt 起算并锁定 |
| F.partner.tiers | Standard / Verified / Premium / Diamond 四档非负、非递减门槛；当前只保存，不会自动判档或开通权益 |
| F.unilevel.* / F.influence.* / F.promo.weekMultiplier | 原七层唯一配置；L1 基础预算固定 10%，L2–L7 可配置；原合并上限按拆前预算占用 |

购买先按原七层算出最终 L1 预算 U1，再发 `floor6(U1×USDT占比)` USDT 与 `floor6(U1×NEX占比/锁定价格)` NEX。七层合并上限占用仍为 U1，拆后现金减少不释放额度给深层。设备按真实已入账凭证 USDT+NEX×价格，乘设备总比例再拆双币；来源和价格快照不随重试改变。影子收益、充值、礼金、邀请佣金、团队奖励、开发模拟和测试工作器不属于设备收益。

**④ 动作与验收**：草稿→确认理由与影响→A2 待批→批准整组生效或驳回。禁止未批直写、部分生效和过期覆盖。

- Given A→B→C，When B/C 分别购买，Then A 分别得到拆分 L1 与原 L2，B 只得到 C 的一次 L1。
- Given 有权限且两版本未变，When 提交完整 v2 政策并批准，Then 一次生成整组版本，GET 读回和刷新一致。
- 异常1：任何七层费率、暂停、门槛、倍率、影响边界、上限或购买冷却已批准变化，旧预览及待批引用失效，须重读、重新预览和重提；草稿不得静默覆盖。
- 异常2：无权限、理由不足、比例非法、旧 schema 或购买第二总比例，前后端均拒绝，不修改资金或规则。
- 异常3：关闭拆分须展示将恢复的旧 L1 NEX 系数及增加的 USDT 构成，B1 按实际两币支出判断，不能把关闭一概视为收缩；缩短冷却同样复验。
- 异常4：所有 F2 提案在发送前持久化完整请求、理由、对象与原命令号；无法持久化不发送。结果未知后原确认框冻结，刷新后仍可从原记录查询/原样重试；写权限撤回不影响独立的查询入口，服务端仍按真实权限裁决。原样重试成功只证明建过单，须 GET 原号查询当前审批单，不能把历史 pending 回执投为当前待审批。
- 待审批：A2 按 F 域读取，按 operationCode/obj 对齐具体参数和实际锁；费率与系数共享同层锁，暂停整组锁七个 ui_config。好友政策和整体结算分别匹配对应操作，刷新后保留。无读权、读取失败或响应不完整时显示审批进度未知，不解释为没有待审批。
- 恢复了结后作废旧的新修改确认快照，重读当前规则/政策再允许依赖该数据的新修改；回放回执不设成当前业务数据。超过24小时保留原记录、只能查询；过期且精确返回 A2_PROPOSAL_NOT_FOUND 才可在确认后解除（解除逻辑已提供，现有界面缺确认入口，交视觉补接）。403/401/408/425/429和IDEMPOTENCY_*不是重试的明确结论；首次确定性拒绝按HTTP4xx或HTTP2xx非0业务码结束本次尝试，保留确认输入和真实原因。
- 异常5：任一区块 API 失败、未配置或缺价，明确提示和重试，保留另一成功区域与草稿，不伪造费率、行情和到账。旧 L1 UVT 系数只有在已知七层与购买拆分均启用时才显示「已改用好友购买奖励拆分」；政策加载中、加载失败或尚未确认分别说明并禁止编辑，不推断拆分生效（BUG-200）。

**④a 点击流**：

| 触发 | 行为与反馈 |
|---|---|
| 七层费率、系数、门槛、倍率、暂停与冷却 | 原参数确认，显示当前→目标、适用范围、理由、确认/取消；拆分生效时旧 L1 NEX 不可编辑 |
| 购买拆分开关与 USDT 数值 | 更新草稿，NEX 自动补足，只读引用原 L1 预算和冷却 |
| 设备总比例、拆分、冷却 | 独立数字校验，说明成员原收益不减 |
| 提交审批 | 显示改前/改后、两版本、旧系数恢复范围、资金方向，理由 8–200 字；服务端执行时再核验 |
| 取消 / 失败 | 不丢草稿和理由，有明确出口与重试 |
| 重新读取 / 放弃草稿并重载 | 两者均请求实际配置；普通刷新保留草稿，显式放弃只在成功读回后按新版本重置草稿；待审批由A2权威状态收敛，不因放弃草稿被清掉，失败保留草稿并显示错误（BUG-197） |
| 查看审批进度 | 有权限进入既有 A2；待批、生效、驳回分别呈现 |

**⑤ 接口**：

| 接口 | 契约 |
|---|---|
| GET /api/admin/teams/rates?schemaVersion=2 | 当前已有七层规则、独立参数及 sevenLayerRevision；不把 usdtPct 改为拆后现金率 |
| GET /api/admin/teams/direct-referral-policy?schemaVersion=2 | 当前 v2 政策、代际、切换状态、sevenLayerRevision、sevenLayerReference、purchaseSplit 与 deviceEarning |
| GET /api/config/commission/direct-referral?schemaVersion=2 | 同一已发布政策的只读投影 |
| PUT /api/admin/teams/direct-referral-policy | schemaVersion=2、expectedVersion、expectedSevenLayerRevision、完整 purchaseSplit/deviceEarning、reason、Idempotency-Key；只经 A2 生效 |
| A2 f_direct_referral_policy | target=direct_referral_policy/current；重放核验权限、两版本、真实资金方向和完整快照 |
| PATCH /api/admin/teams/commissions/config/:key | 沿原实际写入接口与 A2 命令；不恢复不存在接口；相关七层变化递增统一 revision |

后端先支持两版读取，PC 支持两代际后才批准切换 T。T 后受影响 Team 的 v1 读取明确要求升级，不发送旧端会误解的金额结构；账户、钱包和设备本人收益原接口不受影响。T 后未执行的 v1 购买提案失效，按 v2 重预览，已批准历史政策保持原义。

**⑥ 权限 & 审计**：读 network_f2_read；购买/设备政策及各层费率、NEX 和活动倍率 network_f2_royalty_rate；资格、Influence、暂停、上限、冷却和 Partner Status network_f2_policy_amplify。审批沿既有 A2 权限、稳定命令号、24h 幂等及追加审计，服务端最终授权。审计含操作人、理由、完整改前改后、引用版本、批准/失败及生效时间。

**⑦ 风控 & 联动**：七层与拆分审批/准备读取同一一致配置快照，不能只靠不同 A2 目标锁。旧 L1 NEX 待批不得绕过生效拆分；关闭恢复只影响未来来源。F5 核对双币组、原订单、真实到账和追回；设备本人收益不回滚。不得重算历史、补发重复来源或把价格等待当关闭。

**⑧ 埋点(事件)**：既有佣金事件体系继续，direct_purchase 表示新七层 L1，network 表示现行网络购买含 L2–L7，direct_device_earning 表示直属设备分成。事件关联订单/凭证、结算号、原层级、政策与七层引用版本；列表查询、配置提交和待批均不等于钱包到账。

---
#### [F3] 团队平衡奖励

**当前实现（2026-11-15，后端 `111e00cd`）**：入口 `/network/binary`。运营读取团队A、B两组的历史结算、结算设置和H1当前上限；调整配置或提请手动结算需审批；给直接好友分组直接写入。共10个方向，A01–A08走A2并按原命令号去重，A09/A10不按命令号去重。请求、角色、数据和拒绝均以后端现行合同为准，不把申请登记说成已发放。

**读数据和页面范围**：`GET /api/admin/teams/binary` 返回总览，`GET /api/admin/teams/binary/assignments` 返回一位邀请人的活跃直接好友。总览结算最多100条，按结算日、记录ID倒序；同一人可以多行，不是今日全量邀请人。A/B额、匹配订单额、记账奖励在SQL已舍为整数，PC不反算精确历史金额。匹配订单额不是奖励金额；历史参与人数是所有结算记录distinct owner，被拦下数是BLOCKED/REJECTED/FAILED/FROZEN行数。月累计SQL只有从当月起点的下界，日累计是业务日的matched_volume。近7天自动分组按assignment时间窗口计数，不含人工分组。未匹配池是按当前残额策略得到的双腿剩余中较大一侧合计，不是两腿差额。

本地支持按邀请人编码、状态、注册月筛选，分页10/20/50，并按结算日汇总已读记录；不扩大后端100条范围。成员查询按编号排序、每页20，可按分组状态和页码查。页面进入时读取，不自动刷新。错误/缺值不伪装成0；总览必填嵌套字段严格检查，业务配置空文本仍保留以显示未配置，coverage为null不补0。

**设置与结算参数**：

| 设置 | 合同、范围和实际用途 |
|---|---|
| 每组订单额门槛 | `F.binary.threshold`，>0且≤5000 USDT，最多6位小数。双腿对残额策略所得volumeWindow检查门槛。 |
| 匹配比例 | `F.binary.matchRate`，百分数>0且≤20，最多10位小数；输入1提交1%，结算比率0.01。裸存值也为百分数。PC不因App小比例缺陷加下限，合法最小普通十进制输入0.0000000001%。 |
| 自动分组 | `F.binary.spillover`，请求仍提交已启用/已关闭。结算消费兼容on/true/1/已启用与off/false/0/已关闭；PC照此判断，不信错误的overview boolean别名。开启只在结算遇到未分齐的直接好友时按两组人数补齐，平数先A，不按订单额，不立即批量分组。 |
| 归零说明 | `F.binary.gvResetCron`，只保存非空说明文本，不是cron执行器。唯一选项及结算日元数据取业务日历`trackZones.GROWTH_TEAM`；日历未确认不回退越南默认值。实际订单窗口由业务日历和残额策略决定。 |
| 周期和残额 | 一张`F/f_config_batch`含`F.binary.settlePeriod`和`F.binary.residualPolicy`，两个target均带上。每日/每周/每月分别每天/周日/月末结算；残额每月清零/每次对碰清零/转结。批准时原子写入active配置，任一失败整批回滚；不拆两张提案绕过权限。 |
| 发放 | `F.binary.paused`，写on暂停/off恢复；消费判断trim、大小写不敏感，true/1/on均已暂停，false/0/off均未暂停，其他值不能按正常结算。页面状态、按钮方向和确认框同一判断。 |
| 每日上限 | H1当前运营月`binaryDailyCap`，F3只读。使用总览`dailyCap.h1BinaryDailyCap`的精确十进制，缺值不补0，不用`currentLabel`缩写反推；标签原文留在技术信息。每期cap=日cap×1/7/当月天数，再扣该结算日已记金额。 |

降低门槛、提高比例由后端以当前值重判为资金放大；修复非法当前值也可能放大。后端A2建单只验证参数、权限及锁，不查B1；批准执行`updateUiConfig`才按放大方向查当前覆盖率。周期与残额不触发这两项的配置护栏；每笔实际结算还要核B1。PC既有确认框可以显示/拦截覆盖率快照，不能把它说成后端已完成批准预检。

**结算五步的实际边界**：先按有效实付订单和残额策略得到两组体量；检查暂停、周期、门槛；计算可匹配额及已消费量；按当前比例与剩余每期cap向下6位算实际奖励；创建结算PENDING、奖励COOLING和USDT账本PENDING。冷却天数来自`commission/cooling-days`，无有效非负整数时默认30。每月清零取本月订单并扣月内消费；逐次清零按成功游标后且本月的新订单；转结取截止结算日全部有效订单，双腿分别扣全部已消费matched（包括较晚结算日已经消费的记录）。图形是概要，不是本笔奖励预估；`min(A,B)`不能自动称为本笔实际matched。

**A01 手动结算**：精确`network_f3_write`，邀请人正安全整数、日期YYYY-MM-DD、业务日历中已结束的一天，理由依A2规则。提案`sourceDomain:F3`，`obj:<owner>:<date>`，`command:{domain:F,op:f3_binary_settle,params:{values:{ownerUserId,settlementDate}}}`，target`F/binary_settlement/<owner>:<date>`。创建申请不记账；另一位有效超级管理员、有A2批准权且非发起人批准时才按当时订单、配置、H1和实际新增负债核对B1。相同owner/date已有已提交回执返回原记录，不重算；不满足条件返回真实原因，审批执行不算成功。旧直结算接口仅读回已有回执，不能创单或绕审批。

**A02–A08 配置审批**：门槛、比例、自动分组、归零说明、暂停及恢复均`F/f_ui_config`，obj=key，target=`F/ui_config/key`，sourceDomain=F3；周期和残额为原子`f_config_batch`，obj为两key逗号连接、targets两项，不附重复单target。单项配置使用`network_f3_match_rate`，暂停/恢复使用`network_f3_engine_pause`，发起还需A2写或发起权。配置批准需另一位有效管理员的A2批准权及该目标业务权，不要求超级管理员身份。批量`requiredAuthority`缺逐项映射，委托账号可能收到`A2_BUSINESS_PERMISSION_UNMAPPED`；PC保留整批入口并显示真实原因（F3-BE-02），不绕过。

批准后设置立即用于下一次实际执行的结算，包括补结以前没结的日期；已提交回执不变。暂停只阻断后续F3新结算，不收回已记奖励；恢复只解除暂停，仍守其他条件，也不自动遍历补结全部暂停期间日期。

**A09/A10 成员归组**：精确读权+写权。`POST /api/admin/teams/binary/assignments`，JSON仅`{ownerUserId,memberUserId,leg:A或B}`，无理由、无Idempotency-Key、无A2。原邀请人与成员必须符合后端直接好友关系。后端唯一行+行锁保证同组返回replayed，异组409不可换组；仅写assignment与审计，不触发结算。

**R1原操作恢复**：8个审批发前持久保存完整请求、对象、内容、理由、操作者、原命令号和首次时间，存不下不发。配置复用唯一`nexion-admin-f-commands-v1`实例；人工结算沿原共享`nexion-admin-withdrawal-config-proposals`实例。未知后原确认输入/理由冻结，刷新保留；读取原票和按原请求重试分开，查询不依赖现有写权。24小时后仍保留但不POST。首次明确拒绝按`isDeterministicRejection`丢本次号、保留表单原因；恢复重试只按`isExplicitRejection`收敛，401/403/408/425/429/幂等未收敛继续保留。原POST回放之后必须GET核当前mine/obj/operationCode/status，不能拿历史pending回执标当前待批；查询失败显示结果未知并保留。恢复先使旧总览失效，重读成功前不能新改。

配置与人工结算共用视觉已留的原申请列表和既有确认框恢复入口，列表在总览失败分支之外；已查pending才显示待审批。人工结算查询未找到时保留原确认框，允许按原内容和原命令号重试；记录收敛后关闭。批量提案失败保留原输入和理由，不因重读重置。旧指纹/旧input-only记录不能补造完整POST，只按原key查询。过期且精确`A2_PROPOSAL_NOT_FOUND`可在明确确认后解除的API已接，缺确认容器交视觉。未去重分组发前保存admin/owner/member/leg，刷新恢复；结果未知只GET原owner+member，读到同组或异组可收敛，未分/缺行/读取失败保留，不重发POST。总览失败/读取中时，分组原intent也接到同一原申请列表，只GET核对。

**已登记边界**：F3-BE-01总览历史金额整数与原指标口径、F3-BE-02批量权限映射、BUG-430 App比例最低ratio1e-7与后端不一致均不由PC绕过。现有暂停note、只返回缩写上限的说法、流程图当前期/实色实际matched/无条件月归零/无条件恢复付款、配置建单查B1等措辞不成立，逐句登记在F3重构说明，留视觉修正；不声称此轮已完成真实页面写入验收。域末项统一在只读代理+页面拦截下验证全部写入方向。

---

#### [F4] 团队激励池

本节和 F4b/F4c/F4d 共同描述 `/network/leadership-pool`，按后端 `111e00cd` 核对（2026-11-15）。页面保留团队池、购机名额、大使材料及申请规则、日周月总榜的全部现行入口；没有额外注资、历史周池维护、榜单纠错/补发或单用户购机资格覆盖入口。角色名不代替精确权限。

**读取与金额**：进入及手动刷新读取 `/api/admin/teams/leadership-pool` 和 `/ambassador-policy`，没有页面自动轮询。总览失败时不使用旧数发起新修改；规则独立失败不影响申请查看，规则修改不可用。有效的空票数数组可读，未配置金额或覆盖率不补 0。池和四榜金额在 JSON 数字转换前保留十进制原文；月上限从原配置按后端 `$`/逗号/K/M 语法解释，避免使用后端整数投影。后端本来已取整的成交/实发指标、已舍入的汇总标签不反算精度，相关文案与字段缺口登记后交视觉/后端。

**团队池规则**：本周未结算估值 = 已付款订单小计（排除退款/拒付）×比例，且不超过本月剩余额度；已发周取实发，最多6位小数。结算按执行时参与等级和正票权分配，最后一位接尾差。同周已有成功 leadership 事件则跳过，不补本周后来的订单差额。配置必须 READY；缺版本、比例、月上限、参与等级或合法定时表达式时不能结算。历史已发不因改配置重算。

| 写入口 | 参数/对象 | 权限与生效 |
|---|---|---|
| 提前结算本周池 | `F/f4_pool_settle`，空params；obj本周团队激励池；target `F/leadership_pool_settlement/current-week` | `network_f4_pool_fund` + A2发起；批准后按执行时当前周真实入账UNLOCKED USDT；0金额/无合格票不保证付款 |
| 奖池比例 | `F.pool.ratio`，0–30百分数；1=1%，0.05=0.05% | 资金权限；A2批准后写入当前值，后续未结算部分使用；调高时执行端核B1 |
| 每月上限 | `F.pool.monthlyCap`，非负数字，可带K/M、货币符号/逗号 | 写权限；A2批准；后端保存时未独立拒绝非法格式，非法后池HOLD，不能声称一定拒存 |
| 自动结算时间 | `F.pool.settleCron`，5字段补秒0或合法6字段Spring cron | 写权限；A2批准，之后下一次调度命中即用新值；按业务日历GROWTH_TEAM当前时区解释 |
| 参与等级 | `F.pool.unlockVRank`，V1–V8 | 写权限；A2批准；历史V9–V12可读不代表可以新写 |
| 各等级票数 | `F.pool.votes.{V1…V8}`，0–1,000,000 | 页面入口和提交均须资金+写权限，后端A2实际验写权限；不放宽。小数后端向下取整；设0后本页正票投影不再返回该等级，不能在本页改回 |

自动调度每次只调用一次 `injectAndSettleLastClosedWeek`，只结最近结束的那一周，不回补遗漏的所有周。页面说明只解析能确定的每天、每周某天、每月1–28日单次写法，其他写法交后端解释，不猜频率。每月一次意味着其他各周不会自动结算；每天触发对已成功结算的周跳过。页面不得自行改运营的cron。GROWTH_TEAM时区从业务日历读取，日历未读到时不假定越南时间；实际周边界仍按后端VietnamBusinessPeriod的业务日历实现。

**头部占比**：top1/top5两个入口保留在排行榜规则内，0–100%，缺配置消费者默认25/60。它们限制排行榜派奖，不限制团队池票权分配；不能改成只告警。已决定的F4-P01/P02/P03/P04及覆盖率、结算时间均按此现状交付。

**审批与R1（全页23条提交路径）**：普通参数/处置、提前结算、总榜派奖及提高预算都创建A2申请，不直接执行业务。普通批准需另一位有效管理员，有A2批准权及该项业务权限，不能是maker；只有提高大使预算要求另一位有效超级管理员。普通`command:F/f_ui_config`，sourceDomain F4、obj参数键、target `F/ui_config/<key>`；大使状态例外锁原申请，obj申请号；额度带expectedMonthlyQuota，批准大使带expectedMaterialRevision。

每次发送前持久保存完整原body、理由、目标、操作者、原号、首次时间和原确认事实；存不下不发。普通审批共用原`nexion-admin-f-commands-v1`实例，预算审批共用原`nexion-admin-withdrawal-config-proposals`实例，规则直存共用原F域直写实例。F4记录按原管理员保留，换账号不丢且新账号不能重用；过24小时保留只能查。未决表单冻结，原记录从既有逐条提醒恢复，提醒不依赖总览成功；新修改与原记录恢复分开。

首次拒绝按`isDeterministicRejection`清本次号、保留原因；保留原号的重试只按`isExplicitRejection`收敛，401/403/408/425/429及幂等未收敛继续保留。审批重试回放的pending是历史回执，必须GET原号核当前mine/obj/operationCode/status后才标当前待批；查询失败保留未知。恢复了结即关旧确认、作废旧读取并重读，不能把历史回执设为当前配置。查询独立于现有写权限，由后端裁决读取资格。

审批过期且原号GET精确返回A2_PROPOSAL_NOT_FOUND后，可由明确确认解除；查询和解除逻辑已接，现有确认容器没有解除入口，交视觉worker补，不能自动清。规则直存及材料核验没有原号只读回执，查询当前业务状态不能证明原写不存在，记录保留；有效期内有去重的原POST/PUT可原样重试。旧版本只存指纹/理由而没存完整body的记录仅查，不补造请求。

**覆盖率**：总览coverage取B1 treasury facade读数，部分缺失时不补0；后端未返回可靠性字段，页面读数不能证明资金预检已过。提前结算和总榜派奖的执行链没有B1检查，确认框只显示当前读取供运营判断；原有前端低于红线拦截仍是页面快照判断。不能写成后端执行时必查。大使预算提案创建与批准均查B1；大使最终批准在执行时重核材料及B1。新错误码提供原因及后续动作的中文。

本轮为逻辑接入，未改版式/样式或重写既有文案。旧文字中的过度承诺、材料可批准状态、审批恢复统一叫法和缺少的解除确认容器逐句登记在F4重构说明及工作报告，由视觉worker处理。类型检查、目标构建和关卡3/6由本worker执行；真实页面写入拦截检查按共用安排由F域末项统一完成，不把静态检查当真实资金验收。

---

#### [F5] 奖励记录核对

> 2026-11-15 按后端 `111e00cd` 接逻辑；路由 `/network/commissions`，保留八类、七态、九个请求入口。七个奖励处置先审批；异常标准直接保存；CSV 是有审计的只读产物。页面现有措辞中不成立的部分登记在重构说明，由视觉轮修正，不视为新的业务承诺。

**① 目的 & 对齐**：逐笔核对奖励的来源、单币金额、状态、真实账本及处置历史，处理冻结、提前解锁、解冻、冲正、补发、用户奖种暂停和恢复。与 F2 政策、A2 审批、B1 覆盖率、D4 账本及 App 权威奖励投影对齐；提案成功只证明建单，不能称奖励已变更。

**② 后台界面与读取口径**：保留现有结论、七态流程、八类卡、奖励流水、等价格、异常样本、暂停名单、处置历史及详情抽屉。八类为 `direct_purchase/direct_device_earning/network/binary/peer/cultivation/leadership/genesis`；七态显示冷却中、已解锁、已提现、已冻结、已冲正、已拒绝、待追回，按原后端中文标题映射协议值。

- 七态、八类、合计取同一概览的全局未删除八类事件聚合；不跟流水筛选变。点击状态或类型清除其他筛选，只查该状态或类型，匹配总数与相应节点/卡的全局笔数同口径；再点取消。手动查询可组合类型、币种、用户编号、收款成员注册月份和状态。每次查询清选择；下一批沿用产生游标的条件，20 笔替换显示，`total` 不含游标。
- 单笔金额、整组两币、基数、价格、待追回保留 JSON 十进制文本，不经浮点数舍入；显示币种、每格最少两位小数并保留全部实际小数，悬停保留后端原值。汇总后端已经 HALF_UP 到两位，前端不补造精度。可空金额、价格和覆盖率不补 0。
- 等价格最多 100 组，数量是本次返回数组长度；只跟 kind/userId/cohort，不跟币种，选状态时不返回。`ts/unlockAt` 接收后端整数 epoch 毫秒；0/空不显示成 1970。占位两币 0 不是到账，没有 eventId 不可处置。
- 异常从全局最近 200 条挑选，金额偏离按奖种混币；频次至少 10；network 层比例也混币，不能当 USDT 估值。暂停名单全局最多 100 条，处置历史全局最近 50 条，不随筛选。
- 进入、筛选、翻批和手动重读时读取，不轮询。加载时禁新查询和处置；概览失败清旧数据。原操作提醒在概览成功分支外，读取失败仍能查询原结果，符合条件时按原请求重试。

**③ 字段与可控参数**：

| 字段 | 实际合同 |
|---|---|
| commissionId/eventId/auditKey/version | CM 事件号、当前事件版本；状态提案必须带原 expectedVersion |
| settlementNo/unlockAt | 真实组号与组 release_at 的毫秒投影；不能用剩余天数为 0 推断已真正到期 |
| sourceRef/sourceDeviceId/policyVersion/basisUsdt/nexUsdtPrice | 来源与政策快照；设备/价格/无组扩展字段按后端边界可空，不反算 |
| amountUSDT/amountNEX/recoveryPendingUSDT/recoveryPendingNEX | 整组两币应发与未实际追回数，不相加为单币金额 |
| commissionAnomalySigma | 2–5，步长 0.5 |
| layerRatioAnomalyPct | 后端 10–50 可小数；现有控件步长 1，不扩充选择范围 |
| ledgerBizNo | 有真实账本号才跳 D4，不用 CM 号伪造关联 |

**④ 操作动作**：

| 入口 | 请求与实际执行 |
|---|---|
| 冻结 / 提前解锁 / 解冻 | A2 `f_commission_status`，obj=原 auditKey，F/commission_event/CM 目标，含 value 和 expectedVersion。冻结/解冻需 freeze 权，提前解锁需 release 权。好友两类不开放提前解锁；network 结算组必须真正到 release_at，已知未来时点先禁提交，缺时点交后端裁决。 |
| 冲正 | A2 `f5_commission_reverse`，commissionId/refundRef，F/commission_event 目标。无组旧冻结态先拦；需先解冻。证据可为此事件订单/等级发放号或任意未删除客服工单号；后端不核工单归属。组按余额上限回收、剩余待追回；无组余额不足回滚，不转待追回。 |
| 批量补发 | A2 `f5_commission_reissue`，排序后的 commissionIds，多个事件锁，一票原子处理。只勾已冲正、非好友、来源未退款的行，维持 PD01；不新增已拒绝入口。每笔生成新记录，原行不变，来源只消费一次。network/binary 按当前冷却配置；其余四类直接 UNLOCKED。批准执行时查可靠 B1，低于红线整批拒。 |
| 暂停 / 恢复 | A2 `f5_commission_suspension`，userId、排序后的 kinds、显式 suspended，F/commission_user_kind/{userId:kinds}。批准才生效。暂停冻结现存开放事件；直属奖励以后在 hold 下仍可生成 FROZEN/WAITING_CALCULATION，不等于停止产生。其他奖种的生成器未统一消费暂停表。恢复好友组时无其他 hold 才回冷却，release_at 不重算；其他奖种只恢复暂停表，不自动解冻旧行。 |
| 调整标准 | PUT commissions/anomaly-config，保存两个数、原理由、操作者与原号。不审批，成功回执核对 operationNo 和原两值，再按当前有效筛选重读。新阈值影响后续读取历史样本的挑选，不改奖励金额或状态。 |
| 导出筛选结果 | POST commissions/export，取筛选栏当前草稿，不带 limit/cursor，理由必填。最多 50,000 行/10MiB；12 列、用户编号仅后四位、单号保留。校验元数据、SHA256、BOM、固定表头和行数后立刻下载，无 24h 下载链接。产物按原号去重，不要求业务写 R1 锁。 |

**⑤ 结果未知与审批恢复**：七个提案与异常标准发前保存完整原请求、对象、理由、管理员、原号、首次时间及确认事实。持久存储失败不发。未知冻结理由和表单；刷新后在既有提醒逐条显示，可回原确认框。查询与写权限分别判，写权收回后仍保留只读入口，由后端判断读资格。第一次明确拒绝按 isDeterministicRejection；保留原请求的重试仅 isExplicitRejection 才解除，权限/超时/限流及 IDEMPOTENCY_* 不表示原结果已知。

原号重试仅重放保存的 body 和 Idempotency-Key，24h 后保留、禁 POST、只查询。提案重放成功再按原号 GET 当前票，只有当前 pending 才标待审批并锁对象；GET 失败写建过单但当前审批状态未知。确认 mine/obj/operationCode，111e00cd 已给全部 F 命令 operationCode；不要求被服务端规范化的 action/before/after 与客户端相同。权威终态清原记录并重读；不把历史回放回执设成当前数据，重读失败时禁止新处置。直接阈值没有原命令回执查询端点，读当前两值只是核对，不凭相同或不同就删除未知记录。旧的不完整记录只查，不能重建 POST。

过期提案按原号明确 A2_PROPOSAL_NOT_FOUND 后可以经显式确认解除；逻辑已提供，现有页面缺此确认表面，交视觉轮接。直接阈值不适用此解除。

**⑥ 权限 & 审计**：read/export/write 和 freeze/release/reverse/reissue/suspend 各自独立，导出仍要求精确 export 权。F5 合法描述的提案只需对应业务动作权，不额外要求 A2 写权；但当前 A2 canonicalF5Kinds 仍只收六个旧奖种且最多六项，好友类型暂停/恢复对仅 F5 专权账号被门禁拒，对仅 proposal_create 的委托账号被上下文拒，完整 A2 write 的旧通用路径仍可建单，需后端统一八类合同，不新增绕过路径。没有 A2 总览权仍可按原号读取本人合法原票。另一位有效管理员还需审批批准权、对应业务处置权、票范围且不是发起人。A2 读取到的本人待批单逐条显示，存下的本人原单还逐条精确查询；无总览权时不能列出未保存在本标签页的其他历史本人单。

**⑦ 已知后端与文案边界**：用户奖种暂停把无组旧事件 unlock_at 清空，恢复奖种再手动解冻后仍无自动到期出口；不能泛称解冻后必自动到期。旧事件提前解锁执行链未见实时 B1 检查，前端只检查读到的快照；补发才在执行时查 B1。七态的 withdrawn 是 PAID/WITHDRAWN/SETTLED 归一，不能证明用户真的提走；unlocked 还包括即时奖种旧 PENDING/COOLING，不等于钱包可提余额。双币组仅为正金额币种建立事件，不能保证一组总有两笔。页面仍有这些过度概括，重构说明逐句登记，不凭通过静态关卡视为已修正文案。

**⑧ 验证与联动**：类型检查、目标生产构建、F5 关卡 3/6 在本提交执行；不建单元测试或问题专属测试文件。真实页面拦截验收按共用安排由 F 域最终页面检查执行，覆盖九入口的成功/拒绝/未知/刷新/同 body 同号/过期只查，以及待价格毫秒、原票当前状态、对象锁、金额和全部计数。F1–F4 行为不改，命令存储仍各用既有单实例。

---

#### [F4b] 硬件配额

购机名额沿F4总览返回有效商品、月cap/current、剩余、资格条件及最近已用记录。`current`是本月ACTIVE占用数量，剩余max(0,total−used)，85%及以上且cap>0标紧张。资格按directRefs、精确monthComputePointsText、ALL/EITHER解释；缺条件写未知，不补0。Pro/Rack字段是名称含PRO/RACK的首个商品月额度，不是资格门槛。

- 调额度：`F.quota.tier.{quotaCode或id}.monthlyQuota`，0–1,000,000整数，发送原cap为`expectedMonthlyQuota`。写权限+A2发起；另一位管理员批准后CAS生效，新值低于本月已用或原值变化均409并给最新总览，不修改已用历史，不退单。
- 回收：`F.quota.usage.{id}.status=recycled`，写权限+A2发起。批准将非删ACTIVE记录改RECYCLED，只释放名额，不退款、不删订单、不改变用户设备。页面对非ACTIVE记录禁用回收；服务端仍拒绝重复或缺失记录。
- 现行 `TeamCommissionMapper.quotaUsages` 只返回本月ACTIVE、最新30条；回收后该记录消失，不能称为已回收历史列表。已回收行的前端禁用只能作为防御检查，不能用后端正常返回的RECYCLED夹具验收。历史回收不代表当月增加额度；列表/说明的对应原话交视觉收窄。

改版不新增覆盖单用户资格、修改购机条件、暂停Rack、区域库存或退款入口。所有原号恢复遵循F4统一R1。

---

#### [F4c] 区域大使审批

材料合同另见[区域大使材料核验](BE-27-大使材料核验-20261107.md)。一份申请只选venue/kol/print/dev中的一类，批准仅开一笔所选类别额度，不付款，不是四类一起发。总览返回最新30份申请，PENDING优先；全历史汇总包括已批准总预算、所有申请总预算、kol_budget_pct最大值和待审最早活动日期，不是本月/预算上限/季度计划。后端金额标签已舍到2位，接口无完整汇总金额，PC不反算精度。

**材料读与核验**：查看材料GET原申请 `/ambassador-applications/{id}/materials`；附件GET私有files路径，没有PC上传/删除。本版核验分BUSINESS和FINANCE，两类均可直接POST`/materials/review`，不经A2、不批准预算、不付款。各需要对应专权、原材料版本、结论PASSED/NEEDS_MORE及理由；业务场地通过要求有效去重人数≥100且为整数，不能带财务认可金额；财务通过必填非负认可额，小数≤6位、整数≤12位，不能带人数。需补项须属于该类材料。两阶段无硬性先后顺序，页面流程图的顺序不能代替后端许可。缺认可额是尚未认可，0是合法已记录的0；材料申请额/认可额在JSON解析前保留十进制，12位整数+6位小数不经Number丢失。

请求以admin+申请+原号+完整body保留成功回执。发前保存完整原理由和申请快照，持久失败不发；未知冻结原版/原结论/原理由，换账号、刷新和过期均保留。重试按共享明确拒绝收敛；MATERIAL_REVISION_STALE/APPLICATION_NOT_PENDING发生在保留成功回放之后，可以确认原核验未提交。过24小时不POST，仍可GET当前材料/历史，不能把当前相似结论当原号回执。重试成功后重新读材料及总览，历史packet不冒充现在。

**批准/驳回**：两者在原材料详情创建`F/f_ui_config`申请、sourceDomain F4、obj申请号、target`F/ambassador_application/{id}`、paramKey`F.ambassador.{id}.status`，值approved/rejected。批准必须带expectedMaterialRevision并以后端canProposeApproval裁决；批准执行人不能是maker，也不能参与本版任何一次业务或财务核验。执行再次核版本/未处理、必要材料/私有文件、两阶段通过、场地人数、认可额≥申请额、活动日期已到、覆盖率。驳回不要求材料通过，不开额度，历史保留。列表只凭两阶段PASSED就显示“可以发起最终批准”的旧文案不构成后端保证，详情已有真实阻断原因，列表状态交视觉修正。

**申请规则两条提交路径**：精确`network_f4_pool_fund`，四类id固定。policyVersion 3–64位，原expectedRevision>0，默认预算落某类100–10000范围；各类min≤max、title/range≤80字、rule≤500字，金额完整十进制≤6位。

- 未提高默认预算或任一最高预算：PUT`/ambassador-policy`直接保存，含policy/revision、原reason/operator，原号hash也含理由。只提高最低预算仍属直存。成功后revision+1，后续App新申请读新规则，已有申请不重算。
- 提高默认或任一最高预算：POST A2 `F/f4_ambassador_policy_change`、params.values完整policy、obj default、target`F/ambassador_policy/default`。发起只需该专用资金权限（TeamFundApproval.canPropose），不额外要求普通A2发起权限；创建和批准均验B1和原版本，另一位有效超级管理员且有A2批准权方可执行。若页面误判直存，后端A2_CONFIRMATION_REQUIRED明确拒绝后转原内容提案；不误报已经保存。

后台可维护四类文字，但PC/App已知id优先本地字典，自定义title/rule不保证直显。App刷新已有未提交草稿时保留用户已填预算并重新校验，不能承诺后台保存后立即替用户改值。原号提案、直存及材料的状态提示复用既有F4RecoveryNotice。

---

#### [F4d] 排行榜 & 反欺诈

本页日/周/月/总榜只显示前三。服务端按有效正式用户本期已解锁USDT净奖励排序（不是订单额或算力），日/周/月总榜候选集最多20/50/100/100人；人数是截断后的候选数，不是全平台注册人数。周期按GROWTH_TEAM业务日历，当前为越南时间；前端显示时间按A3页面时区。榜单池精确十进制保留，后端已压精度的其他标签不能当完整原金额。

| 写入口 | 合同与真实效果 |
|---|---|
| 四榜奖池 | `F.pool.periodPrize`单个JSON数字对象含today/week/month/allTime四项≥0，仍一张A2单，不拆请求；金额不经Number重写丢精度。日周月下个未结算周期读新值，总榜人工批准时读，已派周期不重发 |
| 周榜覆盖额 | `F.leaderboard.poolUsd`，资金权+A2；消费者仅合法且>0时优先，否则用periodPrize.week。0不是关周池，保存端没有独立金额格式校验 |
| 统一上榜门槛 | `F.leaderboard.minUsd`，非负USDT，写权限+A2。缺配置按服务端0回填，不再默认1；全周期共用，暂停快照仍为原值 |
| 第1/前5最高占比 | `F.pool.top1MaxPct/top5MaxPct`，0–100%，资金权+A2；只限榜单派奖，不限团队池，没有两值大小关系校验。前5按合计剩余额度封顶，超出不重分 |
| 暂停 | `F.leaderboard.paused=on`，榜单处置权+A2；批准时事务捕获四周期不可变快照，失败不改成功。重复暂停409。有效FROZEN才显示暂停名单，无快照明确不可用，不补实时榜 |
| 恢复 | 同key=off，处置权+A2；批准恢复实时，快照历史保留。暂停时自动周期派奖返回0仍推进checkpoint，恢复不会补跳过周期；团队池不随榜单暂停 |
| 本周前三取消资格 | `F.leaderboard.week.user.{memberUserId}.status=disqualified`，处置权+A2；发起与执行均核有效本周K2本人信号或匹配K1有效簇证据；无证据NO_RISK_EVIDENCE，不绕。移出week排名及派奖，不冻结/追回，后端处置无具体周到期过滤，下周不会自动恢复 |
| 总榜派奖 | `F/f4_leaderboard_period_payout`，params.period=allTime，obj排行榜 allTime、target`F/leaderboard_settlement/allTime`；资金权+A2，暂停不可新提。批准后按执行时累计候选前100、名次N…1权重、top1/top5封顶、向下6位写UNLOCKED USDT；有成功lifetime事件则不重复，0池/无候选不发也不表示永久已完成 |

本页没有分周期人工补发、纠错、追加奖池、App总榜触发开关。反欺诈检测在K1/K2，本页不维护K2增速阈值；风控命中数是本周信号用户和已处置用户合并去重，不能当作当前榜待处理的精确人数。风险证据不提前返回，提交拒绝按真实原因显示。暂停和总榜派发同其他F4申请统一保存原body、原理由、原号、原事实；去重不能由浏览器UTC日换号替代，已删除跨日造新号路径。

已决定的后端跟进包括：票数鉴权不一致、月上限/周池格式与0含义、零票恢复入口、取消资格到期、暂停不补发、统计精度/口径、跨端榜单指标和资金B1预检。PC不新增财务/风控规则作为绕过。真实页面的成功、拒绝、未知、刷新恢复、24小时到期、原号逐字节及权限/锁检查由F域最后的页面验收项集中执行。

### 2026-11-15 F3 分组时间字段同步

F3 读取可空 `assignedAtIso`，存在时按全站业务时区显示同一 instant，缺失/null 回退原 assignedAt；两者均空显示—。不把存储 +08:00 当业务展示时区，不重写历史时间。固定「北京时间」列名交视觉同步。后端 `04d11022` `team/mapper/BinaryCommissionSettlementMapper.AssignmentMemberRow.assignedAtIso:62–66`。

2026-11-15 复查 F02：升级前仅label/orderNo/spec的 E4 提案仍可用原命令键取得当前票据；严格校验mine/obj及operationCode（历史无code则核原action），成功后解除未知记录并重读当前订单，pending由后端订单pendingApproval显示，终态按当前状态处理。查不到/失败/不匹配保留；不补来源、不重发。出处 backend04d11022 OpsAuditCenterService.proposalByIdempotencyKey/toTicket。

2026-11-15 R1提案过期修正：E4仅在过期后严格原键查询返回 A2_PROPOSAL_NOT_FOUND 时记本标签页可解除资格；新查询开始撤销旧资格，查询错误/其他404/匹配票据均不授予资格。现有解除确认框承载确认，确认时重核过期和对应记录，再解除并重读订单。D2/D3直接写不适用。
