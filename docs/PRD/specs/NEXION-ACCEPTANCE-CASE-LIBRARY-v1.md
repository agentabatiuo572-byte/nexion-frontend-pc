# Nexion 业务语言验收用例库 v1.0

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 状态：Reusable Baseline
>
> 编制日期：2026-08-04
>
> 覆盖：PC A–M 75 个模块及 App/后端跨域消费者

## 1. CAPABILITY

本用例库把验收从页面选择器和临时脚本中抽离，改用“前置条件—普通用户操作—业务预期—错误出口—数据证据”表达。页面重构后，只要业务对象、权限和合同没有变化，用例仍可复用。

执行时必须遵守 `D:\nexion\页面业务逻辑通顺性验收方法.md`：从真实登录页和可见侧栏进入，使用真实浏览器和真实后端，不用隐藏 URL、mock、DOM 修改或 localStorage 制造成功态。

## 2. CONSTRAINTS

- 第一次打开产品的普通运营员能够理解入口、字段、按钮和结果。
- 初次走查与技术/墨菲复审分离；复审者不参与目标缺陷修复。
- 修复后从登录入口重跑整个模块，不只重试失败按钮。
- 权限覆盖菜单、页面、按钮、API、数据五层。
- 结果未知时使用原幂等键查询/重试，禁止换键连点。
- 产品缺陷与环境阻塞分开；环境阻塞不打分、不签发通过。
- 所有通过结论必须能回到请求、业务表、状态、账本、A2 审计、A4/outbox 和消费者证据。

## 3. 通用用例包

### 3.1 用例格式

| 字段 | 要求 |
|---|---|
| Case ID | 稳定编号，格式 `AC-域模块-序号` |
| 角色 | 精确角色、菜单、权限和数据范围 |
| 前置条件 | 服务版本、账号、对象状态、数据版本、资金/门禁快照 |
| 操作 | 从可见入口按用户语言描述点击、输入、等待、刷新 |
| 预期 | 页面反馈、服务端状态、允许的下一动作和禁止动作 |
| 错误出口 | 401/403/404/409/422/500、超时、断网、畸形 200 的恢复 |
| 证据 | trace、截图、请求、数据库、审计、outbox、跨域/App 结果 |
| 清理 | 恢复可变夹具；保留不可变审计边界 |

### 3.2 可复用对抗包

| 包编号 | 覆盖内容 | 通过条件 |
|---|---|---|
| PK-NAV | 可见侧栏进入、返回、逐页刷新、退出重登 | URL、标题、选中菜单和服务端状态一致，无隐藏入口依赖 |
| PK-PERM | readonly、nowrite、nomenu、maker、独立执行人 | 五层权限均失败关闭；权限数组和菜单等集 |
| PK-HTTP | 401/403/404/409/422/500 | 提示可理解、表单保留适当、无越权/部分副作用 |
| PK-NET | 超时、断网、响应丢失、真实 request failure | 显示结果待确认；同键查询/重试，不重复副作用 |
| PK-PROTO | 畸形 200、缺字段、错类型、旧枚举 | 不把坏响应当空态/成功；保持旧快照并告警 |
| PK-IDEM | 同键同载荷、同键异载荷、重复点击 | 同载荷同结果；异载荷 409；只产生一次副作用 |
| PK-CAS | 双运营员同版本并发 | 只有一个成功；失败方刷新后重新决定 |
| PK-STATE | 每条合法迁移、跨级/反向/终态复活 | 合法迁移成功；非法迁移 409 且状态不变 |
| PK-DATA | 业务表、账本、审计、outbox、消费者 | 数量、ID、版本、金额和前后快照一致 |
| PK-PRIV | 脱敏、导出、解密、直接对象访问 | 默认脱敏；解密单独授权；下载审计完整 |
| PK-CROSS | 上下游模块与 App 消费 | 同一 canonical ID/版本；无本地权威回退 |
| PK-CLEAN | 测试夹具、锁、会话、MFA、Redis、MinIO | 可变数据恢复；审计/outbox 按边界保留 |

所有写模块默认执行 `PK-NAV+PK-PERM+PK-HTTP+PK-NET+PK-PROTO+PK-IDEM+PK-CAS+PK-DATA+PK-CLEAN`；状态机模块再加 `PK-STATE`，敏感数据加 `PK-PRIV`，跨域模块加 `PK-CROSS`。

## 4. 75 模块主用例目录

### 4.1 A 平台基础

| Case ID | 模块 | 主场景（前置条件 → 操作 → 预期） | 增量包 |
|---|---|---|---|
| AC-A1-01 | 运营账号 & RBAC | 准备启用运营员和最小角色 → 停用、验证新登录被拒、重新启用并登录 → 既有授权不扩张，停用/启用均有审计 | PK-PERM、PK-CAS、PK-PRIV |
| AC-A2-01 | 审计 & 操作确认 | 准备一个超出发起人执行门槛的合法命令 → 发起、由独立有权人执行、查询历史 → 原命令只执行一次，身份、原因、前后快照和结果完整 | PK-PERM、PK-IDEM、PK-CAS、PK-CROSS |
| AC-A3-01 | 系统配置 | 读取当前单例配置 → 修改一个可逆值、刷新重登、恢复原值 → 版本单调、运行时读取新值、恢复精确 | PK-CAS、PK-CROSS |
| AC-A4-01 | 埋点事件体系 | 选择现役事件 schema → 新增兼容 revision 并触发样例事件 → 历史 revision 保留，消费者按新 schema 成功处理 | PK-PROTO、PK-CROSS |
| AC-A5-01 | 平台参数寄存器 | 选择有明确 Owner 的参数 → 修改合法值并尝试越界/未知键 → 合法值生效，越界/未知键 422，Owner 和影响面可追溯 | PK-CAS、PK-PROTO |
| AC-A6-01 | 角色管理 | 新建临时最小角色 → 授予一个菜单和 read 权限、登录验证、撤销 → 无跨域权限，自授予和危险角色修改被拒 | PK-PERM、PK-CAS |
| AC-A7-01 | 菜单管理 | 新建临时父子菜单 → 尝试先停父、删除已授权菜单，再正确清理 → 关联约束 409，合法顺序成功且审计必达 | PK-PERM、PK-CAS、PK-DATA |
| AC-A8-01 | 权限字典 | 新建临时权限 code → 授权、使用、停用 → code 语义不可改，停用后 API 立即失败关闭 | PK-PERM、PK-CROSS |

### 4.2 B 总览驾驶舱

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-B1-01 | 双账本总览 | 准备已知钱包与负债快照 → 查看覆盖率并下钻来源 → 页面总额与 D4/资金源同口径，不能从看板改账 | PK-PROTO、PK-CROSS |
| AC-B2-01 | 资金池水位 | 准备黄/红线边界数据 → 查看告警、确认、导出 → 阈值边界准确，增长角色无导出，确认不改变资金事实 | PK-PERM、PK-PRIV |
| AC-B3-01 | 转化漏斗 | 准备可计算 cohort → 切换时间窗/渠道并导出 → 分母分子可解释，小样本不泄露单用户 | PK-PROTO、PK-PRIV |
| AC-B4-01 | 节奏状态 | 准备 H1 当前阶段 → 查看各 dial 和跳转 H1 → 与 H1 同版本，本页无第二套编辑入口 | PK-CROSS、PK-NAV |
| AC-B5-01 | 风险雷达 | 准备 K/J 告警 → 查看趋势并跳转目标模块 → 数量与源域一致，不在雷达直接处置 | PK-CROSS、PK-PROTO |

### 4.3 C 用户与账户

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-C1-01 | 检索 & 画像 | 准备同名、跨辖区用户 → 按 ID/手机号检索并打开画像 → 精确命中、越域不可见、敏感字段按角色脱敏 | PK-PERM、PK-PRIV |
| AC-C2-01 | 账户操作 | 准备 ACTIVE 用户 → 冻结、刷新重登验证消费者受限、解冻恢复 → CAS 正确，余额/历史不删除 | PK-STATE、PK-CROSS |
| AC-C3-01 | 余额 & 资产调整 | 准备可调整用户和覆盖率 → 发起 CREDIT/DEBIT、独立执行、再冲正 → 只入账一次，冲正新建账本事件 | PK-IDEM、PK-CAS、PK-PRIV、PK-CROSS |
| AC-C4-01 | KYC 合规台账 | 准备待复审用户 → 触发 K5、确认 C4 不提前改态、完成裁决 → 条件回写一次，证据引用完整 | PK-STATE、PK-CROSS、PK-PRIV |
| AC-C5-01 | 安全 & 会话 | 准备多设备会话 → 撤销指定会话/MFA 重置/解绑并重登 → 仅目标失效，token 不回显，全部写审计 | PK-PERM、PK-PRIV、PK-CROSS |
| AC-C6-01 | 注册/登录风控 | 准备 OTP 阈值边界 → 连续请求至滑块触发并模拟 provider 失败 → 第 N+1 次准确触发，依赖失败时不放行 | PK-PROTO、PK-CROSS |

### 4.4 D 资金与财务

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-D1-01 | 充值对账中心 | 创建 VietQR intent → 登记匹配回单、复核入账，再用第二流水尝试复用 → 首笔原子入账，第二笔进入 LATE 路径 | PK-STATE、PK-IDEM、PK-CROSS、PK-PRIV |
| AC-D2-01 | 提现审核队列 | 创建 submitted 提现 → 审核、处理、广播、确认；另跑冻结和 tx-failed→refunded → 主链和补偿链均单向且账本一致 | PK-STATE、PK-CAS、PK-CROSS |
| AC-D3-01 | 资金池水位仪表盘 | 准备储备变动 → 对照 B1、D4 查看水位和异常 → 三处同口径，读模型故障不改资金 | PK-PROTO、PK-CROSS |
| AC-D4-01 | 账本/账单审计 | 准备入金、提现、奖励和冲正 → 检索同一业务 ID → 借贷、币种、金额、关联号闭合，原流水不可编辑 | PK-PRIV、PK-CROSS |
| AC-D5-01 | 提现参数配置 | 读取当前参数 → 修改网络费三元组并恢复，尝试 H1 只读字段 → 原子版本更新；只读字段 422 | PK-CAS、PK-CROSS |
| AC-D6-01 | 汇率牌价 | 发布新报价 → 创建锁价交易并再次改价 → 旧交易保留原 quoteVersion，新交易使用新版本 | PK-CAS、PK-CROSS |

### 4.5 E 设备与商城

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-E1-01 | 商品目录 & 上架门 | 新建 pending SKU → 完成字段后上架、在 H7/F1 选择、再下架 → 消费者同步，下架不破坏历史引用 | PK-STATE、PK-CROSS |
| AC-E2-01 | 收益 & 任务引擎 | 发布新任务规则版本 → 新任务使用新版本、运行中任务保持快照 → 无追溯重算和重复奖励 | PK-IDEM、PK-CROSS |
| AC-E3-01 | 生命周期 & Trade-in | 准备 owned/active 设备 → 计算抵扣、创建订单、回收；另恢复误回收设备到 offline → 抵扣不入余额，恢复不直跳 online | PK-STATE、PK-CROSS |
| AC-E4-01 | 订单状态机 | placed→paid→provisioning→activated → 模拟重复支付回调和交付失败退款 → 单向迁移、库存/账本/券原子补偿 | PK-STATE、PK-IDEM、PK-CROSS |
| AC-E5-01 | 设备运维 | 准备在线/离线设备 → 批量暂停、解绑、恢复 → 目标集精确、上限有效、非目标不变 | PK-CAS、PK-CROSS |
| AC-E6-01 | 算力与设备配置 | 修改一个 GPU 档位和下载文案 → App 读取新版本、恢复原值 → 六档唯一递增，畸形投影不展示旧 mock | PK-PROTO、PK-CROSS |

### 4.6 F 分销与团队

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-F1-01 | V-Rank 晋升 | 准备满足下一阶的用户 → 触发两次评估 → 每次最多升一级、奖励一次；永久保护开关按版本生效 | PK-STATE、PK-IDEM、PK-CROSS |
| AC-F2-01 | 网络版税费率 | 修改一层费率至合法边界并尝试总和超限 → 新周期使用新值，超限 422，历史结算不变 | PK-CAS、PK-CROSS |
| AC-F3-01 | 双轨结算引擎 | 准备可结算批次 → 暂停、验证不结算、恢复并结算 → 批次幂等，暂停无部分派发 | PK-IDEM、PK-CROSS |
| AC-F4-01 | 池/配额/大使/榜 | 准备达标与未达标成员 → 执行周期结算并查看榜单 → 资格、配额和奖励可解释，K2 信号不直接处分 | PK-CROSS、PK-PRIV |
| AC-F5-01 | 佣金事件审计 | 准备 cooling/unlocked 事件 → 撤销并补发、暂停用户佣金再恢复 → 原事件保留，补发新建，账本闭合 | PK-STATE、PK-IDEM、PK-CROSS |

### 4.7 G 金融产品

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-G1-01 | Staking 池配置 | 创建仓位并推进 pending_lock→active→mature_unclaimed→claimed → 重复领取和 Kill 竞态 → 只结算一次，Kill 优先 | PK-STATE、PK-IDEM、PK-CROSS |
| AC-G2-01 | 兑换风控 | 提交兑换 → 分别命中 gated、queued、swapped 和取消 → 门禁理由明确，排队取消不成交 | PK-STATE、PK-CAS |
| AC-G3-01 | NEX 行情引擎 | 暂停引擎、观察价格不推进，再恢复 → running/paused 真实持久，旧价格点不重写 | PK-STATE、PK-CROSS |
| AC-G4-01 | Genesis 经济 | minted→held→listed→sold → 并发购买同一资产 → 只有一个成交，所有权与账本一致 | PK-STATE、PK-CAS、PK-CROSS |
| AC-G7-01 | 复投激励 | 创建 90 日复投仓位 → 到期领取与提前退出分别验证 → 复用 G1 幂等/罚则，H1 倍率只读 | PK-STATE、PK-CROSS |

### 4.8 H 增长与运营节奏

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-H1-01 | Phase 调度器 | 修改下一阶段 dial 并发布 → B4 和所有消费者读取同版本，恢复原值 → 无第二写源 | PK-CAS、PK-CROSS |
| AC-H2-01 | 免费试用引擎 | idle→active→grace→redeemed，另跑 failed/cancelled → 服务端时间权威，shadow 不进入余额 | PK-STATE、PK-NET、PK-CROSS |
| AC-H3-01 | 任务引擎 | 完成任务并领取 → 重复领取、跨账号领取、过期领取 → 只发一次，非法请求 403/409 | PK-IDEM、PK-PERM、PK-CROSS |
| AC-H4-01 | 活动中心 | upcoming→ongoing→ended；用户 joined→done→claimed → 活动和参与分离，结束不自动领取 | PK-STATE、PK-CROSS |
| AC-H5-01 | 签到 & NEX | 连续签到跨里程碑并执行 Lucky → streak、随机结果、里程碑奖励均 server-only 且一次 | PK-IDEM、PK-CROSS |
| AC-H7-01 | 代金券 | active 券领取→AVAILABLE→订单 USED；另撤销未用券 → 订单折扣原子，USED 不可撤销 | PK-STATE、PK-CAS、PK-CROSS |
| AC-H8-01 | 新人礼与邀请奖励 | 准备合法邀请和风险邀请 → 执行结算批次并重放 → 合法双方入账一次，风险对象跳过，整批失败回滚 | PK-IDEM、PK-CROSS、PK-PRIV |

### 4.9 I 内容与合规

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-I1-01 | 转化文案 A/B | 创建草稿、发布、运行实验并采纳 → 旧版本保留，采纳不静默覆盖发布版本 | PK-STATE、PK-CROSS |
| AC-I2-01 | Nova 推送运营 | 新建模板并启用通道、发送样例、禁用 → 禁用后无新发送，历史送达不消失 | PK-STATE、PK-CROSS |
| AC-I3-01 | 通知 Campaign | draft→scheduled→sending→sent，发送中取消另一批 → 只阻止未发送部分，发送事实可追踪 | PK-STATE、PK-IDEM |
| AC-I4-01 | 信任中心 | 发布信任版块、App 查看、回滚/下架 → 版本可追溯，App 不回退硬编码内容 | PK-CROSS、PK-PRIV |
| AC-I5-01 | 风险披露 | 发布新披露 → 已确认用户变 stale，重新确认后资金动作恢复 → 确认绑定具体版本和辖区 | PK-STATE、PK-CROSS、PK-PRIV |
| AC-I6-01 | i18n 文案 | 同时编辑 zh/en/vi → 缺占位符、禁词、超长分别拒绝，合法发布三端同步 → placeholder 等集 | PK-PROTO、PK-CROSS |

### 4.10 J 紧急与合规控制

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-J1-01 | Kill-Switch 矩阵 | 关闭单闸并验证消费者停用，再在 B1 健康时恢复 → 关停优先、恢复受版本/B1 保护 | PK-CAS、PK-CROSS |
| AC-J2-01 | Geo-block | 新增 blocked/limited 国家并验证端点派生，模拟并发旧页面保存 → 紧急封锁不被旧快照覆盖 | PK-CAS、PK-CROSS |
| AC-J3-01 | 篡改防御监控 | 注入合法告警事实 → 查看、脱敏导出、跳转 C2/K1 → 本页不直接改账户，敏感内容受控 | PK-PRIV、PK-CROSS |
| AC-J4-01 | 监管点名应急 SOP | 锁定 playbook 版本后执行，第二步故障 → 停止危险后续、保留 PARTIAL 证据、补偿并恢复 | PK-STATE、PK-IDEM、PK-CAS、PK-CROSS |

### 4.11 K 风控与反作弊

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-K1-01 | 反多账户引擎 | detected→flagged→frozen→released，另跑 detected→cleared → 终态保留，证据变化才创建新 incident | PK-STATE、PK-CAS、PK-CROSS |
| AC-K2-01 | 套利 & 刷量检测 | 准备多层信号 → 标记/阻断礼品/联动 K1 冻结 → 信号与处分分离，跨域动作各自审计 | PK-CROSS、PK-PERM |
| AC-K3-01 | 提现风控规则引擎 | draft→active→paused→archived → 尝试恢复 archived、provider 超时 → 409/503 失败关闭，D2 不放行 | PK-STATE、PK-NET、PK-CROSS |
| AC-K4-01 | 风险评分模型 | 提交权重和=1、越界和≠1、人工覆盖再重算 → 版本/分数来源明确，非法权重 422 | PK-CAS、PK-PROTO、PK-CROSS |
| AC-K5-01 | 大额 KYC 复审 | triggered→in-review→passed/rejected → 同一用户并发触发合并工单，C4 条件回写一次 | PK-STATE、PK-CAS、PK-CROSS |
| AC-K6-01 | Janus C2 控制台 | 选择各类设备执行允许迁移并等待 ACK → 禁止非法迁移和 BLOCKED 批量强制，命令发布不冒充激活 | PK-STATE、PK-CAS、PK-CROSS |

### 4.12 L 数据与分析

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-L1-01 | KPI 看板 | 固定源域快照 → 比对 KPI、刷新、跨时间窗 → 口径稳定，源域失败不显示伪默认值 | PK-PROTO、PK-CROSS |
| AC-L2-01 | 漏斗/cohort/留存 | 准备已知 cohort → 计算留存并导出 → 窗口、时区、去重口径一致，小样本抑制 | PK-PRIV、PK-CROSS |
| AC-L3-01 | 财务报表 | 生成汇总和敏感明细 → 独立批准、下载、过期后再下载 → 默认脱敏，过期拒绝，下载审计一次 | PK-PRIV、PK-IDEM |
| AC-L4-01 | 设备/任务/网络报表 | 对照 E/H/F 源数据 → 导出聚合和团队树 → 聚合一致，团队树需专权并脱敏 | PK-PRIV、PK-CROSS |
| AC-L5-01 | 导出 & 监管报告 | 生成敏感报告→PENDING_CONFIRM→READY→DOWNLOAD → 同模板并发只生成一次，辖区和版本固定 | PK-STATE、PK-CAS、PK-PRIV |
| AC-L6-01 | 用户行为热力图 | 采集匿名行为事件 → 查看聚合热力图并尝试单用户反查 → 只提供聚合，不泄露输入内容 | PK-PRIV、PK-PROTO |

### 4.13 M 客服中心

| Case ID | 模块 | 主场景 | 增量包 |
|---|---|---|---|
| AC-M1-01 | 客服总览 | 准备工单/会话/SLA 数据 → 查看 KPI 并跳转四条深链 → 统计与源对象一致，兄弟接口失败不伪装为 0 | PK-PROTO、PK-CROSS |
| AC-M2-01 | 工单台 | OPEN→IN_PROGRESS→PENDING_USER→RESOLVED→CLOSED→OPEN → 状态、归档和 SLA 分离，重开保留历史 | PK-STATE、PK-CAS |
| AC-M3-01 | 即时会话台 | OPEN→TRANSFERRED→OPEN→RESOLVED→CLOSED → 双坐席并发转交只有一个成功，关闭后不可普通发言 | PK-STATE、PK-CAS、PK-CROSS |
| AC-M4-01 | 知识库与 SLA | 编辑 FAQ 草稿并发布，修改一个 SLA 后恢复 → 版本可追溯，SLA 影响新计时且 CAS 生效 | PK-CAS、PK-CROSS |
| AC-M5-01 | 话术与模板配置 | 新建 zh/en/vi 模板并预览变量 → 缺变量/禁词拒绝，发布后会话选择可见 → 历史发送内容不改 | PK-PROTO、PK-CROSS |

## 5. 终验用例

| Case ID | 场景 | 通过标准 |
|---|---|---|
| AC-FINAL-01 | 登录后从可见侧栏首次打开 75 模块 | 75/75，页面与模块匹配，pageerror 和非预期 console error 为 0 |
| AC-FINAL-02 | 对 75 个页面逐页刷新 | 75/75，不依赖前一页 local state，不出现未授权请求 |
| AC-FINAL-03 | 退出重登后再次访问 75 模块 | 75/75，会话权限重新拉取，业务状态未回退 |
| AC-FINAL-04 | 统一请求审计 | 非预期 4xx/5xx、真实 request failure 为 0；导航取消仅在同路径替代 200 时豁免 |
| AC-FINAL-05 | 清理与证据哈希 | 可变夹具清理，审计边界保留，trace/截图/视频/清单哈希完整 |

## 6. NON-GOALS

- 不在本文保存 CSS/XPath/DOM 选择器。
- 不把 API 单测、静态检查或直接 URL 冒充首次用户走查。
- 不把历史报告的通过结论继承到新候选版本。
- 不在环境故障时给产品打失败分，也不把环境阻塞签成通过。

## 7. OPEN QUESTIONS

- `OPEN-001` 审批拓扑裁决后，需要统一替换用例中的“独立执行人”术语。
- 订单过期窗口、Trial 运行中配置策略、D1 `RETURN_PENDING` Owner 等状态机待决项，应在裁决后补充边界用例。
- REGION 数据范围口径确定后，C/D/I/K/M 域的数据越权夹具要锁定唯一辖区模型。

## 8. HANDOFF

自动化层可为每个 `AC-*` Case ID 绑定 Playwright spec 和证据目录，但业务文本是用例真源。选择器变化只改自动化映射，不改业务用例；业务规则变化必须先改状态机和本用例，再改代码。
