# Nexion 运营控制后台 — 开发落地规格(Dev-Ready Spec)

> **本文件是什么**:从 4 卷需求 PRD(`Nexion_运营控制后台PRD_v1~v4.md`,共 17 章 70 子模块 7000+ 行)提炼的**开发落地契约速查**。需求 PRD 回答「为什么做、业务背景」;本文件回答「建什么表、实现什么接口、配什么参数、状态怎么流转、谁能操作」——开发按本文件即可落地,业务背景再查原 PRD 对应 §锚点。
>
> **怎么用(按角色/阶段)**:
> - 开工前必读 → **第 0 章 全局铁律**(贯穿所有模块的硬约束)+ **第 7 章 未决项清单**(开发/上线阻塞点)+ **第 8 章 现状↔目标差异表**(相对前端现状要改什么)。
> - 总览导航 → **第 1 章 70 模块功能索引**。
> - 建表 / 定义类型 → **第 2 章 数据模型总表**。
> - 实现 API → **第 3 章 API 契约总表**。
> - 配置项 + 校验规则 → **第 4 章 参数配置总表**。
> - 状态机 + 合法转移 → **第 5 章 状态机集**。
> - 鉴权 / 审批门 → **第 6 章 RBAC 权限矩阵**。
>
> **权威性**:本文件为提炼视图,每行带「出处§」可回溯;与原 PRD 正文冲突时**以 PRD 正文为准**。标 **✅ PM 裁定** 的口径(如 Genesis 日分红 0.1%、B1 红线拒绝码 422)以裁定为准。标 **TBD / 未定义 / 待裁定** 的项见第 7 章,**开发不得自行硬编**。
>
> **语言**:全文中性运营语言。
>
> ---

## 第 0 章 全局铁律(开发实现前必读)

> 这 11 条贯穿所有 68 模块。任一模块实现与本章冲突,以本章为准(本章再与 PRD 正文冲突,以 PRD 正文为准)。

### 0.1 单一权威源(SSOT,不重算/不另立)

| 数据 | 唯一权威 | 引用方(只读复用) |
|---|---|---|
| 风险评分 RiskScore / 评分模型 RiskModel | **K4** | D2 路由 / C1 展示 / B5 异常账户 |
| Phase 10-dial 模型 | **H1** | B4 展示 / D5·F3·G5·G6·H3·E1 生效面 |
| 真实储备底层账本 | **D3** | B1 分子 / B2 / L3 |
| 兑付覆盖率(负债分母 8 科目) | **B1** | 全后台放大流出前置门 / B5 / L3 |
| 审计日志 / 高敏动作确认契约 | **A2** | 全后台高敏写 |
| 埋点 EventSchema registry | **A4** | 全后台 KPI / 漏斗 / BI 派生 |
| KYC 状态台账 | **C4** | D2 / G2 / K5 门槛引用 |
| server 唯一账本 Bill | **D4** | C3 调整 / L5 导出 |
| 账户冻结态 | **C2** | D2 提现 frozen 联动 |
| Kill-Switch 功能闸 / geo-block | **J1 / J2**(V4;V1 临时在 A3) | B5 只读状态灯 / 各域 enforce 生效面 |
| Trade-in 抵扣阶梯(5 档界点/比例)+ 置换规则 | **E3** | K2 置换行为监控只读 / uniapp checkout 消费 |

### 0.2 server-canonical
所有状态机、资金值、风控值、闸状态 **server 权威**,client 仅 UI cache、**绝不本地推进**(§9.11d.2 / §9.11f)。client 上报的资金/状态不作权威口径。

### 0.3 操作确认(Confirm-with-Reason)
余额/资产调整、大额提现放行、参数批改、kill-switch、geo-block、impersonate、数据导出(含敏感)等高敏写 **一律经业务专属确认弹窗 + 理由必填后由单人即时执行**(2026-06 操作确认决议):`reason` 由 server 强制非空(空值返 **400 `REASON_REQUIRED`**,8–200 字);动作连同 `operator / before / after / reason / IP / ts` 即时落 A2 审计(append-only);资金/资产类写携 `Idempotency-Key`;**放大资金流出方向提交前 server 前置核 B1 兑付覆盖率红线,低于红线拒绝 422 `COVERAGE_BELOW_REDLINE`**;高敏动作执行后实时告警超管 / 域 lead。执行门槛(lead / 仅超管)见第 6 章;弹窗规格详见第 9 章总表 + 各卷 PRD ④a 段。

### 0.3a 业务弹窗契约

- 每个弹窗必须声明 trigger、business target、required input、validation、write action、audit reason、success feedback、persisted echo。
- 弹窗内容必须匹配按钮语义:改角色必须有 role selector;改授权必须有 permission diff;编辑文案必须有 zh/en 字段;创建课程必须有 title/body/category/duration;提现处置必须有 approve/reject/delay/freeze 业务选项。
- 只有 reason textarea 的 edit/create/repair/role/permission/action 弹窗视为 business-incomplete-modal。
- 纯展示弹窗必须显式标 readonly,不得出现可执行主按钮。
- 高敏动作仍使用 confirm-with-reason 外壳,但业务表单体必须在确认外壳内可操作。

### 0.4 Idempotency-Key
所有资金/资产/状态写操作携 `Idempotency-Key` header,server 24h dedup(**固定 24h 后端不变量,运营不可调**),网络抖动 retry 返 200 + 原结果,**不重复生效**。

### 0.5 接口硬校验(server 强制)
- 业务规则前置失败 → **400 / 422**;状态机非法转移 → **409**。
- 高敏写 `reason` 缺失 → **400 `REASON_REQUIRED`**(确认弹窗理由必填,server 强制非空,8–200 字)。
- **放大资金流出方向**(上调 APY/费率/奖励/分红率/匹配比/cap、下调罚款/冷却/积分门、kill 恢复)提交时 server 前置核 **B1 覆盖率红线**,低于 `coverageRedLine`(默认 100%)**统一拒绝返 422**(✅ PM 2026-06-02;旧文 403 已废)。
- 互锁校验:覆盖率 `yellow>red` / 挤兑 `bankrunRed>bankrunYellow` / K4 六维权重和=1 / staking APY 跨档保序 / 置换阶梯(区间连续覆盖 0→∞ · 抵扣比例严格递减 · 界点/比例∈(0,100])/ 任务产能节奏(段界递增 · floor∈(0,1))/ V_RANKS 门槛保序 / Lucky 概率和≤100% / 转盘各档 weight 和=100 且档位∈[2,12] / 里程碑阈值保序 / UNILEVEL_USDT 各层和≤25%。

### 0.6 ID 全 server mint
`withdrawalId / topupId / orderId / billId / commissionId / 通知 id / Genesis tokenId` 全部 server 单源生成,client 不可 mint / 枚举 / 撞 ID(§9.11d.2)。

### 0.7 时间与币种
所有时间戳为 server 权威 **ms-epoch**(对齐 §2.4.4);所有金额字段**明示币种**(USDT / NEX)。

### 0.8 server-only 不下发前端
`chargeFailRate`(H2)server-only,前端永不可知;所有 RNG(签到 Lucky 倍率 / Spin 转盘 / 分红概率)一律 **server 裁决 + NODE_ENV guard**(生产剥离 client `Math.random`)。

### 0.9 同名不同域参数辨析(易混淆,严禁混用)
- **提现冷却** `withdrawCooldownDays`(D5 生效面,权威 H1 Phase 派发,30/35/45d)≠ **试用再次冷却** H2 `cooldownDays`(30d 固定)≠ **佣金冷却** `commission/cooling-days`(F2,30d,权威归属待定见第7章 #5)。
- **大额 $1,000** 三处独立、权威分属、可独立调:**D2** 大额人工审核触发线(后台静态,执行门槛升为财务 lead/超管)/ **K3** `largeAmountUsdt`(提现路由结论)/ **K5** `largeWithdrawReviewUsdt`(KYC 复审工单)。
- **拐点**:`binaryDailyCap` 在月 **7**(非月 6);`withdrawCooldownDays` 月 **8=35d** 中间档(前端缺,须新增)。

### 0.10 Phase 派发参数权威唯一性
10 个 dial(`newUserBonusMultiplier / inviteRewardMultiplier / reinvestMultiplier / withdrawPointsRatio / withdrawCooldownDays / binaryDailyCap / premiumSubAvailable / nexV2LockAvailable / questBonusMultiplier / complianceHoldEnabled`)**全部权威归 H1**;D5/F3/G5/G6/H3/E1 等生效面 `PUT` 收到这些参数返 **422 `PHASE_PARAM_READONLY`**(+ `redirect:/admin/phase/h1`)。

### 0.11 关键业务不变量
- `cumulativeDepositUsdt` **仅 D1 真实充值确认链路写**(正向 recordDeposit / 负向 chargeback、E4 退款核减);earnings/置换抵扣/KYC/quest/C3 纯余额补记**均不得触达**(trade-in 资格硬前提)。
- **置换抵扣不入余额**(E3 不变量 M2:仅作结算扣减项,不写 creditBalance、不可提现、不可累加);抵扣 = 实付价 × 阶梯比例(产出比落档),服务端下单同事务复算。
- **trial shadow 非硬负债**(Model A:`computeTrialOffset` 拆分,offsetUSD 抵购机款上限 `trialOffsetCapUSD`=$50、remainderUSD + 全额 NEX 购后入余额成应付)。
- **Genesis 日分红 = 节点价 × 持有量 × 0.1%/日**(✅ PM 2026-06-01)。

### 0.12 前端杠杆映射覆盖
- `docs/FRONTEND-LEVER-MAP.md` 是 H5 / UniApp 前端业务杠杆与后台控制面的当前索引；三端改造增量 M1-M11 已在三端 SPEC-5 并入该表，三端 SPEC-6 已把 M8 更新为新 `entry-surfaces` 三端入口首页。
- `scripts/fe-be-mapping-coverage.mjs` 为机器门：D 表 M1-M11、admin 映射、后台 PRD 与关键前端/admin 源码证据必须同时闭环；新增三端业务时必须新增映射行并补证据。
- 三端 SPEC-5 M2 口径：手机算力激活登记为前台固定行为，本期无后台登记开关；后台仅承接登记后的算力档位与结算系数，不把“登记开关”误判为后台缺口。
- K6 规则树编辑器的状态 / 渠道多选条件必须展示运营可读中文，内部枚举仅用于保存与判定，不得出现在交互输入层。
- 三端 SPEC-4 M10 当前为前台同源 `account-cloud` mock 阶段：已覆盖 stale snapshot 对余额、设备、任务身份、`currentTask` object/null、同 id 任务时间回退、`recentTasks` 与 `latestWithdrawal` 单调状态的合并边界；后台不新增页面，仍由 C1/C2/C3/C5/E5/D4 既有账户查询、处置、会话下线、设备运维与账本审计承接。真实跨物理设备账户云另走后续 SPEC。
- 三端首页撤回态不得被解释为保留隐藏入口；旧三条首页仍必须删除。SPEC-6 新三端入口首页当前只作评审入口与静态首页，不开放后台改文案；静态评审路由启动阶段不得写账户云、会话、设备身份、账单或里程碑状态；若进入运营化再接 I1 / I6。

## 第 1 章 70 子模块功能索引(总览导航)

> 卷·章:V1=Ch1-9 / V2=Ch10-11 / V3=Ch12-13 / V4=Ch14-17。职责一句话取自各模块「① 目的」。前端§锚点指向前端 PRD v3.7。

| 模块ID | 名称 | 一句话职责 | 所属域 | 卷·章 | 前端§锚点 |
|---|---|---|---|---|---|
| A1 | 运营账号 & RBAC | 后台账号体系与 7 角色 RBAC 权限地基 + 登录策略 | A 平台基础 | V1·Ch2 | §9.11d / §1.2 |
| A2 | 审计 & 操作确认 | 高敏写 append-only 审计留痕 + 高敏动作确认契约权威(确认弹窗 + 理由必填) | A 平台基础 | V1·Ch2 | §9.11d / §9.11e |
| A3 | 系统配置 | feature flag / kill-switch config store / 系统健康(server time / Idempotency 为固定后端不变量,运营无配置面) | A 平台基础 | V1·Ch2 | §9.11a.4 / §9.11d.1 / §9.11e |
| B1 | 双账本总览 | 真实储备 vs 应付负债并列 + 兑付覆盖率(资金安全最高水位) | B 总览 | V1·Ch4 | §5.14 / §9.6.3 |
| B2 | 资金池水位 | 应付负债 8 类科目 + 到期负债预测概览(口径同 D3) | B 总览 | V1·Ch4 | §9.2/§9.3/§9.6/§10 |
| B3 | 转化漏斗 | 注册→绑卡→首购→复投→提现五级漏斗 + L2–L5 + Day7 留存 | B 总览 | V1·Ch4 | §1.6 / §2.4.7 |
| B4 | 节奏状态 | 各 Phase 用户分布 + 10-dial 现值 + 距拐点(dial 只读) | B 总览 | V1·Ch4 | §13.4 / 节奏表§6.4 |
| B5 | 风险雷达 | 挤兑/异常账户/提现积压/kill-switch/覆盖率五维只读雷达 + 跳转 | B 总览 | V1·Ch4 | §9.11d.1 |
| C1 | 检索 & 画像 | 多维检索 + 聚合各域权威的单用户全景(聚合视图,不持权威) | C 用户 | V1·Ch5 | §2.1/§2.2/§2.4/§12.1 |
| C2 | 账户操作 | 冻结/解冻、强制登出、加白/拉黑、impersonate | C 用户 | V1·Ch5 | §4.5 / §4.5.2 |
| C3 | 余额 & 资产调整 | 人工增减 USDT/NEX/积分(确认弹窗 + 理由必填,USDT/NEX 入 D4) | C 用户 | V1·Ch5 | §9.7 / §12.1 / §12.12 |
| C4 | KYC 合规台账 | 全平台 KYC 状态唯一权威台账,供 D2/G2/K5 引用 | C 用户 | V1·Ch5 | §4.4 / §4.4.1 / §9.11d.2 |
| C5 | 安全 & 会话 | 2FA / session / 密码重置 / 锁定解除 | C 用户 | V1·Ch5 | §4.5 / §4.6 / §4.2.3 |
| C6 | 注册/登录风控配置 | OTP / 登录锁定 / CAPTCHA(与 K1 去重互补) | C 用户 | V1·Ch5 | §4.1 / §4.2 / §4.6.2 |
| D1 | 充值对账中心 | 流水确认 / PSP 差异核销 / 备付金 / 卡渠道反欺诈 | D 资金 | V1·Ch6 | §9.2 / §9.2.4 / §9.11c.1 |
| D2 | 提现审核队列 | 逐笔/批量审核提现,server 状态机放行/拒绝/延迟/冻结 | D 资金 | V1·Ch6 | §9.3 / §9.3.6 / §9.11f |
| D3 | 资金池水位仪表盘 | 储备/负债/到期底层账本权威(储备明细+8科目+净敞口) | D 资金 | V1·Ch6 | §9.6 / §9.6.3 / §9.2 / §10 |
| D4 | 账本 / 账单审计 | server 唯一账本审计面:账单流水/Running Balance/对账导出 | D 资金 | V1·Ch6 | §9.7 / §12 |
| D5 | 提现参数配置 | 日限额/余额上限/网络费(cooldown/积分门由 H1 派发只读) | D 资金 | V1·Ch6 | §9.3.2 / §13.4.1 / §9.11c.1 |
| E1 | 商品目录 & 定价 | 设备 SKU 目录/定价/上下架/库存 + 设备规格唯一权威 | E 设备 | V2·Ch10 | §7.1 / §9.11c.1 |
| E1 | 上架节奏门 | 控制 Pro v2 / Rack P2 上架时点(unlocksAtPhase;与置换/代际无关) | E 设备 | V2·Ch10 | §7.1 / 节奏表§6.2 |
| E2 | 收益 & 任务引擎 | AI 任务定价与路由门槛(设备每日产出"任务侧") | E 设备 | V2·Ch10 | §6.3 / §6.5 / §9.11c.1 |
| E3 | 任务产能节奏 | 3 段月界+递减幅度/产能下限/豁免 SKU/新机补贴天数(驱动升级置换) | E 设备 | V2·Ch10 | §6.8 / §9.11c.1 / 节奏表§6.1 |
| E3 | 升级置换阶梯 | 抵扣阶梯 5 档界点与比例/仅限更高价/单笔台数/promoMult/applyTo/总开关 + 购买资格 | E 设备 | V2·Ch10 | §7.5 / §9.11c.1 |
| E4 | 订单状态机 | 设备订单全生命周期:列表/状态推进/DC 分配/退款 | E 设备 | V2·Ch10 | §7.4 / §9.11f |
| E5 | 设备运维 | fleet heartbeat 监控/批量操作/库存激活/强制激活解绑 | E 设备 | V2·Ch10 | §6.1 / §11.1 / §9.11d.2 |
| E6 | 算力与设备配置 | PC 算力备用模块入口开关、在线系数、显卡档位映射、下载内容配置 | E 设备 | V2·Ch10 | 三端改造 SPEC-0~2 |
| F1 | V-Rank 晋升管理 | 13 阶 V 级门槛/server 晋升判定/实物奖发货/培育奖 | F 分销 | V2·Ch11 | §8.2 / §13.2 / 节奏表§6.3 |
| F2 | 网络版税费率 | L1–L7 费率/Partner Status 权益/InfluenceScore/佣金冷却 | F 分销 | V2·Ch11 | §8.3 / §13.3 / §9.11c.1 |
| F3 | 双轨结算引擎 | 较小侧匹配比例/两轨门槛/自动分配/月度 GV 归零(日封顶只读) | F 分销 | V2·Ch11 | §8.4 / §13.4.1 / 节奏表§6.4 |
| F4 | 领导奖池 | 周注入比例/V_VOTES 票数权重/周结算(V3+ 头部分享) | F 分销 | V2·Ch11 | §8.5 |
| F5 | 佣金事件审计 | 六类佣金统一流水/异常预警/冷却/撤销补发(资金出口审计中枢) | F 分销 | V2·Ch11 | §8.6 |
| F4b | 硬件配额 | Pro/Rack 配额解锁门(直推/月业绩)+ 月库存上限 | F 分销 | V2·Ch11 | §8.9 |
| F4c | 区域大使审批 | 区域大使(V5+)4 类预算申请审批工作流 | F 分销 | V2·Ch11 | §8.10 |
| F4d | 排行榜 & 反欺诈 | 邀请榜 4 周期奖池派奖/Podium 履约/取消刷榜资格 | F 分销 | V2·Ch11 | §8.11 / §16.2 |
| G1 | Staking 池配置 | USDT 锁仓+NEX 池 4 档 APY/罚款/最小额/单档 kill | G 金融 | V3·Ch12 | §9.6 / §13.3.1 / §9.11c.1 / §9.11d.1 |
| G2 | 兑换风控 | NEX↔USDT 三阈值 caps/gate/排队(代币→可提现闸门) | G 金融 | V3·Ch12 | §9.4 / §9.11c.1 |
| G3 | NEX 行情引擎 | 价格曲线/做市波动/预言机喂价源(G2/G7 定价源) | G 金融 | V3·Ch12 | §5.7 / §11.9 / §9.11c.1 |
| G4 | Genesis 经济 | 节点总量/单价/日分红率/二级版税/pause/geo | G 金融 | V3·Ch12 | §10 / §9.11d.1 |
| G5 | Premium 订阅 | 月费/首月折扣/权益(gate 由 H1 派发) | G 金融 | V3·Ch12 | §9.5a / §13.4 / §9.11d.1 |
| G6 | NEX v2 Founders Vault | NEX v2 锁仓(250% APY/24 月/min 1,000 NEX) | G 金融 | V3·Ch12 | §9.5b / §9.11d.1 |
| G7 | 复投激励 | 复投锁仓 APY/期限/积分倍率/培育倍率/Genesis 抽奖券 | G 金融 | V3·Ch12 | §9.5 |
| H1 | 12 月节奏 Phase 调度器 | 12 月节奏唯一操作面 + 全平台 10-dial 权威源 | H 增长 | V1·Ch7 | §13.4 / 节奏表§6.4 / §9.11c.1 |
| H2 | 免费试用引擎 | 试用漏斗(绑卡→shadow→自动扣款/提前购)控制面 | H 增长 | V1·Ch7 | §9.11a / §9.11b / §9.11.1 |
| H3 | Quest 任务引擎 | 三层任务(首日/每周/每月)清单/NEX 奖励/3-phase 时窗 | H 增长 | V3·Ch13 | §5.15 / §11.13 / §9.11c.1 |
| H4 | 活动中心 CMS | 限时活动上下架/featured/奖励/追踪/8 种 EventKind | H 增长 | V3·Ch13 | §11.10 / §9.11c.2 |
| H5 | 签到 & 积分 | 签到积分/Lucky 倍率/30 天里程碑/Streak Saver/Power-Ups | H 增长 | V3·Ch13 | §9.8 / §9.11c.1 / §9.11d.3 |
| H6 | 里程碑庆祝 | 收益累计里程碑 5 档阈值与 NEX 奖励(被动触发) | H 增长 | V3·Ch13 | §11.3a / §9.11c.1 |
| I1 | 转化文案 A/B | 转化文案池版本管理/A/B 实验框架/上下架 | I 内容 | V4·Ch14 | §9.11c.2 / §6.6 |
| I2 | Nova 推送运营 | 推送模板池/每 channel 节奏/per-channel kill(10 channel) | I 内容 | V4·Ch14 | §11.0A / §9.11c.1 / §9.11c.2 |
| I3 | 通知 Campaign | 系统通知批量下发 + 优先级 CAP 限频(critical 永不被淹) | I 内容 | V4·Ch14 | §11.2 |
| I4 | 信任中心 CMS | /trust 展示内容生命周期(财务数字/leadership/NEX 叙事/徽章) | I 内容 | V4·Ch14 | §11.3 |
| I5 | 风险披露版本管理 | 披露文案 version×法域双维 + 改版触发 re-ack(合规关键件) | I 内容 | V4·Ch14 | §11.4a / §9.11d.1 / §9.11d.2 / §9.11c.2 |
| I6 | i18n 文案管理 | en/zh 双语镜像 + marketing 多版(~770 key,两语言同步) | I 内容 | V4·Ch14 | §14 / §9.11c.2 |
| I7 | 教程中心 | /learn 课程内容/featured/完成 NEX 奖励(Learn-to-Earn) | I 内容 | V4·Ch14 | §11.11 |
| J1 | Kill-Switch 矩阵 | 5 功能闸 kill 统一权威矩阵 + kill/恢复 + 联动 + 应急通道 | J 应急 | V4·Ch15 | §9.11d.1 / §9.11d.2 |
| J2 | Geo-block | 国家码级地域屏蔽 + per-endpoint geo_block + 边缘 IP 判定 | J 应急 | V4·Ch15 | §9.11d.1 |
| J3 | 篡改防御监控 | 只读监控看板:client 篡改尝试被 server 拦截的计数与告警 | J 应急 | V4·Ch15 | §9.11d.2 / §9.11d.3 |
| J4 | 监管点名应急 SOP | 应急组合处置剧本编排(串联 J1/J2/I5/C2/K1/D2/I3) | J 应急 | V4·Ch15 | §9.11d |
| K1 | 反多账户引擎 | IP/设备/支付三维多账户聚集识别 + 注册/sponsor-bind 阻断 | K 风控 | V1·Ch8 | §9.11e.1 / §16.2 / §9.11d.2 |
| K2 | 套利与刷量检测 | trial 循环/trade-in 套利/gift 刷取/刷榜检测(基于 K1 信号) | K 风控 | V1·Ch8 | §9.11e.1 / §7.5 / §8.11 |
| K3 | 提现风控规则引擎 | 金额/速度/新账户/地址信誉四维规则路由,喂 D2 | K 风控 | V1·Ch8 | §9.3 / §9.11f |
| K4 | 风险评分模型 | 统一风险评分权威源(合成 K1/K2/C4/速度/年龄/异常) | K 风控 | V1·Ch8 | §16.2 |
| K5 | 大额 KYC 复审 + 告警 | 大额提现/兑换/累计阈值触发增强 KYC 复审(态落 C4) | K 风控 | V1·Ch8 | §4.4.1 / §9.3 / §9.4.2 |
| K6 | Janus C2 控制台 | 白壳设备接管决策中枢:12 态设备机 + 多策略/规则树 + 干跑/版本/回滚 + 健康分级 + 审计;配合 SPEC-3 撤回后的三端入口拆分,远程地址只以运营中文展示 | K 风控 | Janus PRD v1.0 | Janus §6–§20 |
| L1 | KPI 看板 | 八项 KPI 只读展示(口径 §2.4.6 权威,一键下钻) | L 数据 | V4·Ch16 | §18.2 / §2.4.6 |
| L2 | 漏斗 / cohort / 留存 | 完整漏斗各级 + cohort 留存矩阵 + phase/locale/渠道切片 | L 数据 | V4·Ch16 | §2.4 / §18.2 |
| L3 | 财务报表 | 只读财务聚合(收入/兑付/敞口/到期),引用 B1+D3+B2 不重算 | L 数据 | V4·Ch16 | §9.6 / §1.4 |
| L4 | 设备/任务/网络报表 | 只读运营指标(设备产出/产能递减/任务/网络结构/Phase 效果) | L 数据 | V4·Ch16 | §5.4 / §5.5 / §6.8 / §9.11c.1 |
| L5 | 导出 & 监管报告 | 数据导出/监管报告统一管控(脱敏+审计+操作确认) | L 数据 | V4·Ch16 | §9.7 |

> 各域 8 段功能规格数:A 3 · B 5 · C 6 · D 5 · E 8 · F 8 · G 7 · H 6(H1/H2 在 V1·Ch7,H3-H6 在 V3·Ch13)· I 7 · J 4 · K 6 · L 5 = **70**(E = E1a/E1b/E2/E3a/E3b/E4/E5/E6 共 8,F = F1/F2/F3/F4/F4b/F4c/F4d/F5 共 8;K6 Janus C2 控制台 = 白壳设备接管决策中枢,出处 Janus C2 PRD v1.0)。

## 第 2 章 数据模型总表(建表 / 定义类型)

> 权威源:`SC`=server-canonical(服务端唯一真相)/ `CC`=client-cache(前端仅 UI 缓存)/ `派生视图`(由事件流/账本预聚合,无独立持久化)。字段类型:string/number/bool/enum{值}/ms-epoch/数组/对象。用户侧业务实体(User/Device/Bill/Order/Staking/FreeTrial/Points,前端 PRD §12)权威在前端,本表仅登记后台 admin 扩展面 + 后台引用的关键字段。

### 域 A — 平台基础

| 实体 | 关键字段(名:类型) | 权威源 | 出处§ |
|---|---|---|---|
| **OperatorAccount** | accountId:string · displayName:string · role:enum{super\|finance\|risk\|growth\|content\|support\|auditor} · permissionTier:enum{member\|lead} · twoFactorBound:bool · status:enum{enabled\|disabled\|locked} · lastLoginAt:ms-epoch · activeSessions:数组 | SC | §9.1 / Ch2 A1 |
| **AuditLog** | operator · role · action · object{domain,objectId} · before · after · reason · ip · ts:ms-epoch · (可选)Idempotency-Key;**append-only,保留 ≥13 月;高敏写与审计记录同事务落库** | SC | §9.1 / Ch2 A2 |
| **SystemConfig** | 运营托管:featureFlags[]{key,state:enum{on\|off\|灰度%},scope:enum{all\|cohort\|phase}} · health{pipeline,ledger,ntp,endpoints}。**固定后端不变量(运营不可调、无配置面)**:serverTime{ntpSource,currentTs:ms-epoch,driftMs} 单源 · idempotency{ttlHours(24),dedupHitCount24h} Idempotency-Key 去重 | SC | §9.1 / Ch2 A3 |
| **KillSwitchConfig** | key:enum{withdraw\|staking\|genesis\|exchange\|trial\|geo-block} · enabled:bool(geo-block=activeCountries.length>0) · activeCountries:数组(仅 geo-block) · lastChangedAt:ms-epoch · operator · reason;**6 闸(5 功能闸+geo-block);A3 子对象非独立表;V1 A3 托管→V4 J1/J2** | SC | §9.1 / Ch2 A3 / §9.11d.1 |
| **EventSchema registry** | eventName(domain.object_action) · propertiesSchema · version · piiPolicy(禁原始PII) · ownerDomain;**domain 枚举 §2.4.3 现行 22 个** | SC | §9.1 / Ch2 A4 |
| **FunnelEvent 派生** | 五级漏斗 register_completed→kyc.express_verified→checkout.completed→reinvest/二次checkout→withdraw.submitted,按 cohort/phase/ref 切片 | 派生视图 | §9.1 / Ch2 A4 |

### 域 B — 双账本驾驶舱

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **TreasuryLedger·B1 应付负债账本** | 负债8科目[可提余额,USDT staking 本金,staking 应付利息,Genesis 日分红承诺,NEXv2 未来兑付,待提现 queue,佣金冷却未解锁,锁仓本息其他](均 number/USDT) · coverageRatio:number(派生=储备÷负债) · netExposureUsdt · redLine(默认100%) · yellowLine(默认110%);**yellowLine>redLine 否则 400;红线拒绝 422** | SC | §9.1 / Ch4 B1 / §17.1 |
| 风险雷达态势(B5) | 五维:挤兑比率(黄20/红40,red>yellow;红线=J1 R1 自动熔断引用线) · 出金压力比 e(t)(模型 §5.3,红线 0.7 固定,早期警戒不触发自动) · 异常账户 · 提现积压 · kill-switch 状态灯(5功能闸) · 覆盖率灯 | 派生视图 | Ch4 B5 |

### 域 C — 用户管理

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **User**(§12 已定义,后台引用) | usdtBalance · nexBalance · pendingEarnings · points(独立 Points store §12.12) · referralCode(注册 server 生成不可改) · **cumulativeDepositUsdt(仅 D1 recordDeposit 写)** · 设备 fleet(引用 E1) | SC | §C1 / §12 |
| 账户冻结态(C2) | status 含 frozen;冻结原子置 frozen + 联动 D2 frozen;allowlist/blocklist(userId 维度) | SC | Ch5 C2 / §17.1 |
| **KycLedger** | userId · kycStatus:enum{verified\|unverified\|in-review} · walletPaired:bool · pairedAddress(脱敏) · network:enum{TRC20\|ERC20\|BTC\|ETH} · verifiedAt:ms-epoch · 变更历史 · 关联 K5 工单;**唯一权威,GET /api/kyc/status/:userId 单源** | SC | §9.1 / Ch5 C4 |
| 用户 session/锁定态(C5/C6) | 多载体 sessions 列表 · twoFactorEnabled · 锁定态(15min 短锁/24h 长锁);C6 auth 风控参数;SPEC-4 起不因异端登录自动强踢 | SC | Ch5 C5/C6 / 三端 SPEC-4 |

### 域 D — 资金中心

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **Withdrawal 扩展态**(本体属 §12) | state:enum{正常5态 submitted\|review-passed\|processing\|sent\|confirmed · 异常6态 review-rejected\|address-invalid\|tx-failed\|tx-orphaned\|refunded\|frozen · 后台扩展 review-pending} · withdrawalId(server mint) · userId · amountUsdt · address(hash)+chain · riskScore(K4) · kycStatus(C4) · pointsOk · count24h · hitRules(K3);**共12态;非法转移 409** | SC | §9.1 / Ch6 D2 / §9.3.6 / §9.11f |
| **WithdrawConfig**(Phase 派发) | withdrawCooldownDays(月8=35d/月9=45d) · withdrawPointsRatio(月9=20) · 日限/上限/fee(source:'d5' 可写) · complianceHold(只读 source:'phase-h1') | SC | §17.1 / Ch6 D5 |
| **Bill / BillType**(§12/§9.7) | type:enum{swap\|topup\|withdraw\|earning\|commission\|refund\|bonus}(**7类**) · billId(server mint) · userId · amount · currency · ts:ms-epoch;**server 唯一账本;积分调整不落 bill** | SC | §9.1 / Ch6 D4 |
| **TreasuryLedger·D3 储备账本** | usdtReserveUsdt · otherLiquidUsdt · injectedCumulativeUsdt · reserveTotalUsdt;**储备=topup累计+注入−withdraw.confirmed−未到期 USDT staking 本金;唯一储备源;日批 UTC00:00** | SC | §9.1 / Ch6 D3 |
| 充值流水/对账(D1) | topupId(server mint) · channel · psp · bin · status · chargeback · reconcile;**cumulativeDepositUsdt 正向 recordDeposit/负向 chargeback** | SC | Ch6 D1 |

### 域 E — 设备商城

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **SKU / Device specs**(E1) | skuKey · price:number/USDT(S1 1,299·Pro 2,399·Pro v2 2,639·Rack P1 8,999·Rack P2 14,999·Cloud Share 199·Genesis 9,999) · baseRate/日(S1 38.50·Pro 76.00·Pro v2 96.00·Rack P1 142.60·Rack P2 248.00·Cloud Share 0.073) · baseRateNEX/日(S1 65·Pro 215·Pro v2 280·Rack P1 950·Rack P2 1,820·Cloud Share 30) · installMonths · stock(<50告警) · status:enum{active\|legacy\|coming-soon};**回本天数/首年净利为派生** | SC | §17.1 / Ch10 E1 |
| **RELEASE_GATES**(E1,原 GENERATION_RELEASES,上架节奏门) | skuKey · releaseMonth(绝对月,Pro v2 月5/Rack P2 月10) · status · 提前/延迟/强制解锁;固定 tradeinDiscount 字段已废(抵扣走 E3 阶梯) | SC | Ch10 E1 |
| **TaskCapacitySchedule**(E3) | 段1(≤月3,−4%)/段2(≤月8,−6%)/段3(月9+,−23.7%) · CAPACITY_FLOOR=0.22 · 豁免 kind{phone,cloud-share,pc-gpu}(按 SKU 开关) · subsidyDays=30;canon 哨兵三端对账 uniapp 字面量 | SC | §17.1 / Ch10 E3 |
| **TradeInConfig**(E3) | creditLadder 5 档{minRatioPct,maxRatioPct,creditPct}=75/60/45/30/15(左闭右开,界点 25/50/75/100) · requireHigherPrice=true · maxDevicesPerOrder=1 · promoMult=1.0 · applyTo 白名单 · enabled · eligibility[kind].rules[] · promo 预留组;**置换抵扣仅结算扣减,不入余额(M2);基数=实付净额** | SC | §17.1 / Ch10 E3 |
| **Order 状态机**(E4) | orderId(server mint) · state:enum{placed\|paid\|provisioning\|activated\|payment_failed\|expired\|refunded\|chargeback\|provisioning_failed} · relatedOrderId(server 校验) · DC · skuKey · userId;**payment_failed 不计 GMV** | SC | §17.1 / Ch10 E4 |
| AI 任务定价(E2) | taskClass:enum{IG\|VG\|LL\|FT\|EM\|SP} · minReward/maxReward(热更) · QUEUE_SATURATION=0.35 · minVRAM · 紧急下架 kill | SC | Ch10 E2 |
| **ComputeShareConfig**(E6) | 入口开关(default false) · 在线加成{H5 基础托管系数,App 连续在线满额时长} · 显卡档位[G1-G6]{展示名称,算力 TOPS,6 个独立识别词槽位} · 下载配置{客户端下载地址,中文标题,中文说明,英文标题,英文说明};**PC 算力备用模块配置单源,E5 仍持 MAX_DEVICES** | SC | Ch10 E6 / 三端 SPEC-0~2 |

### 域 F — 分销团队

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **V_RANKS**(F1 13阶) | v:enum{V0…V12} · 头衔 · 晋升条件{selfBuyUSD?,directRefs?,teamVolumeUSD?,vDownlines?}(AND 复合,各阶组合不一) · unilevelDepth · peerBonus[V](V0–V2=0/V3+=5%) · leadershipVotes · prizeName(全局唯一) · cultivationBonus(NEX) · 可见性解锁 · vRankPermanent=true | SC | §17.1 / Ch11 F1 |
| **佣金费率**(F2) | UNILEVEL_USDT[L1..L7]=[10%,5%,3%,2%,1%,0.5%,0.5%](和≤25%) · UNILEVEL_NEX[L1..L7]=[50,20,10,5,2.5,1,1] · Partner Status{Standard/Verified/Premium/Diamond,仅门槛+非现金权益,不改费率;直推费率恒取 UNILEVEL_USDT[1] 默认 10%、运营全局可配} · InfluenceScore clamp(1.0,5.0) · coolingDays(30,域独立) | SC | §17.1 / Ch11 F2 |
| **双轨**(F3) | binaryDailyCap(月1-6=$5000/月7+=$2000,权威 H1) · balanceMatchRate(10%) · binaryTrackMinUsd($1000) · spillover · gvResetCron | SC | §17.1 / Ch11 F3 |
| **Commission Event**(F5,§12.5) | commissionId · userId · kind:enum{network\|binary\|peer\|cultivation\|leadership\|genesis} · currency:enum{USDT\|NEX} · amount · sourceUserId · layer(L1–L7,仅network) · settledAt:ms-epoch · coolingDaysLeft · status:enum{cooling\|unlocked\|withdrawn\|reversed};**F5 仅审计消费,落 D4 commission bill** | SC | §17.1 / Ch11 F5 |
| 领导池(F4) | leadershipPoolInjectRate(5%,3–10%) · V_VOTES{V3:1…V12:512} · poolSettleCron(周日23:59 UTC) · poolUnlockVRank(V3+) | SC | Ch11 F4 |

### 域 G — 金融产品

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **Staking position**(G1) | state:enum{pending_lock\|active\|mature_unclaimed\|claimed\|early_withdrawn\|slashed\|refunded} · product:enum{USDT锁仓\|NEX池} · 期限:enum{30\|90\|180\|365}d · 本金 · APY 锁定值 · 开锁/到期:ms-epoch;**APY(USDT 12/35/80/180%·NEX 5/12/20/35%)/penalty(USDT 5/15/30/50%)/minStake(NEX 1k/5k/10k/20k);改值仅新 position** | SC | §17.1 / Ch12 G1 |
| **ExchangeConfig**(G2) | USER_DAILY_CAP_USD=50 · PLATFORM_DAILY_CAP_USD=20,000 · KYC_LIFETIME_THRESHOLD_USD=100 · queue;兑换单 state:enum{submitted\|gated\|queued\|swapped\|cancelled} | SC | §17.1 / Ch12 G2 |
| **NEX price + oracle**(G3) | price($0.171) · isPump(0.08) · 做市波动±3% · costBasis($0.085) · oracleSource:enum{INTERNAL\|EXTERNAL} · oracleDeviationPct(5%) · 引擎:enum{running\|paused};**100% server-driven** | SC | §17.1 / Ch12 G3 |
| **Genesis**(G4) | TOTAL_SLOTS(1,000) · unitPriceUSDT($9,999) · **dailyDividendShare(0.1%/日,✅PM)** · royalty(2.5%) · 节点 state:enum{minted\|held\|listed\|sold};日分红落 D4 bill,batchDate 幂等 | SC | §17.1 / Ch12 G4 |
| **Premium**(G5) | MONTHLY_PRICE($99) · FIRST_MONTH_DISCOUNT(0.50) · +NEX yield(+2%) · 订阅 state:enum{none\|subscribed\|renewed\|cancelled};gate 月7(H1) | SC | §17.1 / Ch12 G5 |
| **NEXv2 Vault**(G6) | LOCK_MONTHS(24) · APY(250%) · MIN_LOCK_NEX(1000) · matureValue=amount×6 · state:enum{pending_lock\|locked\|matured\|early_forfeit\|refunded};gate 月11(H1) | SC | §17.1 / Ch12 G6 |
| 复投(G7) | APY(35%) · LOCK_DAYS(90) · 积分倍率(+50/$100) · 培育倍率(×1.5) · Genesis 抽奖券(每单+1) · preset[$100/200/500/1000];复用 staking 状态机(product=repurchase),早赎罚本金15%+forfeit | SC | §17.1 / Ch12 G7 |

### 域 H — Phase 与增长活动

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **PhaseConfig 10-dial**(H1) | 逐月(1–12)×10 dial(见第0章 §0.10);每 dial 生效范围:enum{实时全量\|仅新用户};cohortOverrides[]{cohortId(YYYY-Www),monthOffset,区间};**默认值权威=12月§6.4+complianceHoldEnabled** | SC | §9.1 / Ch7 H1 |
| **TrialConfig**(H2,19参数) | trialDays/graceDays/extensionDays/discountRate/discountCapUSD/autoChargeAtEnd/highQualityThresholdUSD/**chargeFailRate(server-only)**/trialProductId/trialPriceUSD/shadowDailyUSD/shadowDailyNEX/cooldownDays(30,≠withdrawCooldownDays)/phaseOpen(只读)/autoPush{Enabled,DelayMs,CooldownHours,MaxPerSession}/**trialOffsetCapUSD(=50)** | SC | §9.1 / Ch7 H2 |
| **TrialSession 7态**(H2) | userId · status:enum{idle\|active\|grace\|extended\|redeemed\|failed\|cancelled} · shadowUSD · shadowNEX · 时间线 · 绑卡 token · cohort · phase;**Model A computeTrialOffset** | SC | §9.1 / Ch7 H2 / §9.11.1 |
| **Quest 配置**(H3) | Day-One{WINDOW_MS=24h,GRACE_END=72h,phase 奖励 500/200/0,6任务} · Weekly{Tier1 9条/Tier2 8条,base+phase mult 曲线 P1 1.0→P6 1.5,Champion +500×mult} · Monthly{5主题,reward 1.5k–10k,3 subGoals};questBonusMultiplier 由 H1 下发 | SC | §17.1 / Ch13 H3 |
| **活动/Event**(H4) | id · kind:enum{discount\|referral\|wheel\|regional\|boost\|seasonal\|holding\|onboarding} · status:enum{ongoing\|upcoming\|ended} · reward(USDT/NEX) · featured(同时仅1) · trackable · href;**Lucky Spin 8档 EV≈$0.78,Genesis 不进转盘,3护栏+B1红线** | SC(RNG) | §17.1 / Ch13 H4 |
| **签到/Lucky/Power-Ups**(H5) | baseline(+1/日) · 7天 bonus(+5) · Lucky 1.5×(15%)/2×(5%)(和≤100%,server RNG) · 断签(>48h) · Streak Saver(默认1,恢复至 min(longest,30)) · 里程碑7阶 · Power-Ups 4档(→F2/G5/G1/G4) | SC(RNG) | §17.1 / Ch13 H5 |
| **里程碑 H6** | 5档{阈值/USD,NEX 奖励}(100/+100·500/+250·1000/+500·5000/+1500·10000/+3000) · firedIds(不重触发) · tick 4s;**阈值保序 422,一次 fire 一档** | SC | §17.1 / Ch13 H6 |

### 域 I — 内容合规 CMS

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **Content version**(I1) | key · version · status:enum{draft\|published\|archived} · body{en,zh} · activeExperimentId?;A/B state:enum{scheduled\|running\|concluded(adopted\|discarded)} | SC | §17.1 / Ch14 I1 |
| **Nova cadence**(I2) | 10 channel × {enabled,tickMs,cooldownMs};phase-keyed(tradein/task-lock 随 H1);per-channel kill(不入 J1) | SC | §17.1 / Ch14 I2 |
| **Notification Campaign**(I3) | campaignId · 优先级:enum{critical\|high\|normal\|low} · NotifKind · 受众 · state:enum{draft\|scheduled\|sending\|sent\|cancelled};CAP{CRITICAL ∞/HIGH 50/NORMAL 200/LOW 30} | SC | Ch14 I3 |
| **Disclosure version × jurisdiction**(I5) | jurisdiction × version(单调递增) · 7章节体 · locale{en,zh} · acceptedVersion · acceptedJurisdiction;版本 state:enum{draft\|published\|superseded};用户 ack:enum{not_acked\|acked\|stale};**server 边缘判 IP+KYC** | SC | §17.1 / Ch14 I5 |
| **i18n**(I6) | namespace(30+) × locale{en,zh} · key 数 · 覆盖率;**镜像同步 gate + 占位符一致性 + 禁词扫描** | SC | Ch14 I6 |
| **教程课程**(I7) | slug · 分类:enum{Basics\|Earn\|Team\|Wealth\|Security} · format:enum{Article\|Video\|Hands-on} · level · NEX 奖励(10–50) · featured(单) · quiz;state:enum{draft\|published\|archived} | SC | §17.1 / Ch14 I7 |

### 域 J — 紧急合规

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **Kill-Switch 矩阵**(J1) | 5 功能闸{withdraw〔应急新增〕,staking,genesis,exchange,trial}:enabled:bool · operator · reason · coveragePrecheckRequired(恢复方向前置 B1 的闸标记) · autoTrigger{rule:R1\|R2,补录窗 30min};复用 admin.killswitch_toggled(原提案状态机已随 2026-06 操作确认决议废除) | SC | §17.1 / Ch15 J1 |
| **Geo-block**(J2) | activeCountries(ISO alpha-2) · limitedCountries(受限只读档,ISO alpha-2) · enabled(=length>0) · perEndpoint[{endpoint,geoBlock,derivationStatus}] · edgeJudgeHealth · operator · reason;**server 边缘判 IP,财务不参与执行;limited→blocked 为监管升级路径** | SC | §17.1 / Ch15 J2 |
| **篡改监控**(J3) | tamper_path:enum(§9.11d.2 10类+chargeFailRate) · 拦截计数 · 涉及账户;告警 state:enum{normal\|flagged\|escalated};**纯只读,处置跳 K** | 派生视图 | §17.1 / Ch15 J3 |
| **应急 SOP**(J4) | 剧本=kill+geo-block+披露+提现暂停+通知组合(串联 J1/J2/I5/C2/K1/D2/I3) · 演练态(lastDrill/演练就绪,沙箱不下发生产) | SC(编排) | Ch15 J4 |

### 域 K — 风控

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| **RiskScore**(K4) | userId · score(0–100) · band:enum{low\|mid\|high} · dimensions[]{dim,hit,contribution} · overridden · modelVersion · asOf:ms-epoch;**唯一评分源,D2/C1/B5 复用** | SC | §9.1 / Ch8 K4 |
| **RiskModel**(K4) | weights{multiAccount,arbitrage,kycStatus,withdrawVelocity,accountAge,anomalyBehavior}(和=1±0.001) · scoreBand{low<40,mid 40–69,high≥70} · inputSources{ON/OFF} · autoEscalateScore(85) · version;state:enum{draft\|active\|archived} | SC | §9.1 / Ch8 K4 |
| **WithdrawRule**(K3) | ruleId · dimension:enum{金额\|速度\|新账户\|地址信誉} · condition · action:enum{delay\|freeze\|manual}(pass=路由结论非可配) · state:enum{draft\|active\|paused\|archived} · priority;**archived→active/paused 禁(409);largeAmountUsdt $1,000** | SC | §9.1 / Ch8 K3 |
| 去重簇(K1) | clusterId · layer:enum{ip\|device\|payment} · affectedUserIds · linkStrength;阈值 maxAccountsPerDevice(≤2)/maxSignupPerIp24h(≤3);批量冻结经确认弹窗(K1-MD1)+ 理由必填即时执行 | SC | Ch8 K1 |
| 套利信号(K2) | type:enum{trial_cycle\|tradein\|welcome_gift\|leaderboard} · userId\|clusterId · evidence;**产 risk.arbitrage_suspected/trial_cycle_detected** | SC | Ch8 K2 |
| 大额 KYC 复审(K5) | 工单 id · userId · cumulativeKycThresholdUsdt(K5 V1/G2 V3) · 裁决回写 C4;**仅触发+裁决,不持 KYC 态** | SC | Ch8 K5 |
| **Device**(K6) | sid · deviceId · 状态(12 态:新设备/观察中/建议下发/已命中/已激活/环境过滤/人工挂起/人工下发/禁止下发/失联/已重置/错误) · 状态来源(系统/策略/人工/环境/错误) · maturity{8 信号} · environment{riskScore,riskReasons,...} · recommendationScore(§10)· priorityScore(§11)· manualOverride;**白壳接管态,mock 驱动 backend-replaceable;UI 只展示中文状态名** | SC | Janus §16.1-2 / §8 |
| **Strategy**(K6) | strategyId · name · 状态(草稿/生效中/已暂停/已归档,可编辑) · version · priority · ruleTree:RuleGroup · action(8 类下发动作,UI 只展示中文动作名) · scope · safeguards · rollout{percent,cohortIds} · versions[]:不可变快照{ruleTree,action,note,actorId};**发布/回滚生成快照;scope/safeguards/rollout 必须参与 evaluateStrategy/dryRunStrategy,不得只保存不生效** | SC | Janus §6 / §14 / §16.3 |
| **RuleGroup/Rule**(K6) | group{组合方式:全部满足/任一满足/满足 N 条/排除/加权评分,rules[](可嵌套子组)} · leaf{字段,操作符,取值,权重,label};**字段/操作符/枚举值全枚举,自然语言 label;多取值逐项输入,不得单框多值** | SC | Janus §6.2-3 / §16.4 |
| **AuditLog/DecisionSnapshot**(K6) | 审计{actorId,action,targetType,before,after,reasonText,sourceContext,requestId}:append-only;判定轨迹{逐规则 pass/fail + 命中策略 + 冲突 + 保护阻断};**UI、审计日志、报表/JSON 导出必须翻译远程地址 key、状态 enum、动作 enum 为运营中文** | SC | Janus §13 / §16.5-6 / §19 |

### 域 L — 数据分析 BI

| 实体 | 关键字段 | 权威源 | 出处§ |
|---|---|---|---|
| KPI/漏斗口径 | KPI 比率(§2.4.6)+ 五级漏斗(§2.4.7);**L 域只读引用,不重定义** | 派生视图 | §17.1 / §2.4.6 / §2.4.7 |
| BI 导出/报表(L5) | 运营/cohort/财务报表(读引用 /api/admin/treasury/*);**只认 is_server_authoritative=true 事件** | 派生视图 | §17.1 / Ch16 |

## 第 3 章 API 契约总表(后端实现接口)

> **横切规则**:① 净新端点命名 `/api/admin/{domain}/{resource}`;user-facing 单源读端点不带 `admin` 前缀。② 资金/资产/状态写携 `Idempotency-Key`(server 24h dedup)。③ 高敏写单步直接执行(2026-06 操作确认决议):操作者经业务专属确认弹窗提交,目标域 endpoint **body 必携 `{reason}`**(server 校验非空,缺失 400 `REASON_REQUIRED`),写入与审计同事务、即时生效,无审批中转环节。④ 硬校验违反 400/422;状态机非法转移 409。⑤ 放大流出方向前置核 B1 红线,< `coverageRedLine` 统一 **422**。⑥ 同一资源读写路径唯一,引用方仅作 UI 入口/别名。
> **确认列**:值=该写端点对应的确认弹窗 ID(规格见第 9 章总表 + 各卷 PRD ④a 段)或 `是(④a)`;`—`=无确认门(只读或即时留痕动作)。

### 域 A — RBAC / 审计 / 系统配置 / kill-switch(V1 临时)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/rbac/roles` | GET / PUT | 七角色权限矩阵(声明式权威)/ 变更授予(仅超管) | 是(④a,PUT) | A1 |
| `/api/admin/accounts` | GET / POST | 运营账号列表+详情 / 创建(仅超管) | A1-MD1(POST) | A1 |
| `/api/admin/accounts/:id` | PUT | 禁用/启用/改角色/重置 2FA(仅超管) | A1-MD2~MD5 | A1 |
| `/api/admin/accounts/:id/logout` | POST | 强制登出运营 session(仅超管,reason 必填) | A1-MD6 | A1 |
| `/api/admin/audit?filter=` | GET | 审计日志查询(append-only,server 强制可见性;含高敏动作流水监控面) | — | A2 |
| `/api/admin/system/config` | GET | 系统健康(health;server time / idempotency 为固定后端不变量,不在配置面) | — | A3 |
| `/api/admin/feature-flags` | GET / PUT | feature flag 查询/切换 | A3-MD1(PUT) | A3 |
| `/api/admin/killswitch` | GET / PUT | kill-switch 6 闸查询/切换(携 Key;熔断=风控/财务/超管,恢复=仅超管+B1;**V1 临时,V4 写迁 J1/J2,读保留别名**) | A3-MD2~MD4(PUT) | A3 |
| `/api/admin/platform/phase-config` | GET | Phase 现值下发(dial 现值,权威 H1) | — | A3/H1 |

### 域 B — 驾驶舱(treasury 系列实现权威在 D3)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/treasury/coverage` | GET | 兑付覆盖率+双账本汇总(**B1 红线裁决唯一口径源**) | — | B1 |
| `/api/admin/treasury/ledger` | GET | 双账本明细+净敞口序列 | — | B1 |
| `/api/admin/treasury/thresholds` | PUT | 覆盖率红/黄线(校验 yellow>red,违反 400) | B1-MD1 | B1 |
| `/api/admin/treasury/reserve-injection` | POST | 储备注入登记(实现权威 D3,携 Key) | B1-MD2 | B1→D3 |
| `/api/admin/treasury/liabilities?breakdown=true` | GET | 8 类负债科目分解(实现 D3) | — | B2→D3 |
| `/api/admin/treasury/maturity-forecast?window=` | GET | 到期负债预测(提现/利息/Genesis 三类叠加;实现 D3) | — | B2→D3 |
| `/api/admin/funnel?cohort=&phase=&ref=` | GET | 五级漏斗(A4 事件预聚合) | — | B3 |
| `/api/admin/funnel/cohort-trend` · `/funnel/export` · `/funnel/view` | GET/POST | cohort 序列/导出/保存视图 | — | B3 |
| `/api/admin/phase/overview` · `/phase/distribution/export` | GET | Phase 分布+10 dial 现值(只读) | — | B4 |
| `/api/admin/risk/radar` | GET | 五维风险态势 | — | B5 |
| `/api/admin/risk/radar/stream` | GET(SSE) | 风险维度实时推送 | — | B5 |
| `/api/admin/risk/bankrun-thresholds` | PUT | 挤兑黄/红线(校验 red>yellow) | B5-MD1 | B5 |
| `/api/admin/risk/alert-subscription` | PUT | 告警订阅配置 | — | B5 |

### 域 C — 用户管理

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/users?filter=` · `/users/:id/profile` · `/users/export` | GET | 检索列表/单用户画像/脱敏导出 | — | C1 |
| `/api/admin/users/:userId/freeze` · `/unfreeze` | POST | 冻结/解冻(原子+联动 D2 frozen;携 Key) | C2-MD1/MD2 | C2 |
| `/api/admin/users/:userId/logout` | POST | 强制登出(scope=current\|all) | C2-MD3 | C2 |
| `/api/admin/users/:userId/impersonate` | POST | 只读模拟登录(≤30min;写请求 403) | C2-MD4 | C2 |
| `/api/admin/users/:userId/{allowlist\|blocklist}` | POST | 账户级名单(userId 维度) | C2-MD5/MD6 | C2 |
| `/api/admin/users/:userId/adjust` | POST | 人工资产调整(usdt/nex 落 D4;points 走字段+audit;加余额过 B1;携 Key;server 按金额校验执行资质) | C3-MD1/MD2 | C3 |
| `/api/admin/users/:userId/adjust/:requestId` | DELETE | 发起人撤回未处理的调整请求单(客服超额发起场景) | — | C3 |
| `/api/admin/kyc` · `/kyc/:userId` | GET | KYC 列表 / 单用户详情 | — | C4 |
| `/api/kyc/status/:userId` | GET | **KYC 状态单源读**(D2/G2/K5 引用) | — | C4 |
| `/api/admin/kyc/:userId/{verify\|revoke}` | POST | 人工标记/撤销 KYC(携 Key;执行=风控 lead/超管) | C4-MD1/MD2 | C4 |
| `/api/admin/kyc/:userId/trigger-review` | POST | 触发复审→产 K5 工单(不改态) | — | C4 |
| `/api/admin/users/:userId/sessions` · `/revoke-session` | GET/POST | 多载体 session 列表 / 指定会话下线（不因异端登录自动强踢） | C5-MD1(POST) | C5 / 三端 SPEC-4 |
| `/api/admin/users/:userId/invalidate-password` · `/disable-2fa` | POST | 密码重置/disable 2FA(理由必填+KYC 二验防社工;携 Key) | C5-MD2/MD3 | C5 |
| `/api/admin/users/:userId/unlock` | POST | 解除账户锁定(24h 长锁执行=风控 lead/超管;15min 短锁即时) | C5-MD4 | C5 |
| `/api/admin/auth/config` | GET / PUT | 注册登录风控参数(携 K1 去重参数返 422) | C6-MD1~MD3(PUT) | C6 |

### 域 D — 资金

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/topup/reconciliation` · `/topup/flows` | GET | 对账 / 充值流水 | — | D1 |
| `/api/admin/topup/channel/:id/{enable\|disable}` · `/topup/psp/switch` | POST | 渠道启停 / 主备 PSP 切换(PSP 切换执行=仅超管) | D1-MD1/MD2 | D1 |
| `/api/admin/topup/chargeback/:topupId/refund` · `/topup/reconcile` | POST | chargeback 退款 / 对账核销(携 Key) | D1-MD3/MD4 | D1 |
| `/api/admin/withdrawals?status=&cursor=` · `/withdrawals/:id` | GET | 提现队列 / 单笔详情 | — | D2 |
| `/api/admin/withdrawals/:id/{approve\|reject\|delay\|freeze\|unfreeze\|refund}` | POST | 单笔状态推进(单一 URL 覆盖所有金额,server 按金额校验执行资质——大额 ≥$1,000 放行=财务 lead/超管;非法 409;携 Key) | D2-MD1~MD6 | D2 |
| `/api/admin/withdrawals/batch` | POST | 批量(含大额单自动分拣转人工逐笔确认,不整体失败) | D2-MD7 | D2 |
| `/api/admin/withdrawals/pause` | POST | **withdraw 闸 D 域 enforce 生效面**(被 J1 `:key=withdraw` 控) | (经 J1-MD1/MD2) | D2/J1 |
| `/api/admin/treasury/reserve` | GET | 真实储备明细(**唯一储备源**) | — | D3 |
| `/api/admin/treasury/{liabilities,maturity-forecast,net-exposure}` | GET | 负债/到期/净敞口(**权威实现**) | — | D3 |
| `/api/admin/treasury/forecast-config` | PUT | 口径配置(切换返差值预览) | D3-MD1 | D3 |
| `/api/admin/bills?type=&userId=&status=&cursor=` · `/bills/running-balance` | GET | 账单流水 / Running Balance | — | D4 |
| `/api/admin/bills/:id/adjust` | POST | 手动 refund/调整(**账本唯一合法写入**;携 Key) | D4-MD1 | D4 |
| `/api/admin/bills/export?type=&userId=` | GET | 账单 CSV 导出(单源;L5 引用) | —(含明细经 L5 导出确认门) | D4 |
| `/api/admin/withdraw/limits` | GET / PUT | 提现参数现值 / 非 Phase 参数配置(携 Phase 参数返 422) | D5-MD1(PUT) | D5 |

### 域 E — 设备商城

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/products/specs` · `/products/specs/:skuKey` | GET / PUT | 全 SKU 规格(server-canonical)/ 改单 SKU(stock:0 经确认弹窗转下架;返 effectiveAt+lockedInFlightOrders) | E1a-MD1/MD2(price/baseRate/status/stock=0) | E1 |
| `/api/config/cart/bundle-discount` | PUT | 套餐折扣 ladder(4件12%/3件8%/2件5%) | E1a-MD3 | E1 |
| `/api/admin/config/task-pricing` | GET / PUT | 6 类任务定价(热更,仅新派发生效) | E2-MD1~MD4(PUT) | E2 |
| `/api/admin/config/task-capacity` | GET / PUT | 任务产能节奏(段界/幅度/floor/豁免/补贴天数;对存量+新购次快照,不追溯历史) | E3a-MD1~MD4(PUT) | E3 |
| `/api/admin/config/tradein` | GET / PUT | 升级置换配置(校验阶梯连续/递减,违反 400) | E3b-MD1~MD7(高敏字段) | E3 |
| `/api/config/tradein` | GET | 置换配置**只读投影**(checkout/K2 消费) | — | E3/K2 |
| `/api/orders`(携 `tradeInDeviceId`) | POST | (用户)置换下单:服务端同事务复算阶梯抵扣 + 下架旧机 + 净额扣款(抵扣不入余额;复算≠client 报价时 402 重报价) | — | E3/E4 |
| `/api/admin/orders?status=&failState=` · `/orders/:id` | GET | 订单列表 / 详情 | — | E4 |
| `/api/admin/orders/:id` · `/orders/:id/cancel` | PUT/POST | 手动推进回滚改派 DC / 取消(携 Key) | 是(④a,运维/可取消态) | E4 |
| `/api/orders` | POST | (用户)下单(relatedOrderId server 强校原单 payment_failed+userId 一致否则 400) | — | E4 |
| `/api/admin/orders/:id/refund` | POST | 退款(联动 D1 退款+D4 冲正+cumulativeDepositUsdt 核减;携 Key) | E4-MD1 | E4 |
| `/api/admin/devices?userId=&kind=&status=` | GET | 设备 fleet 运维列表 | — | E5 |
| `/api/device/:id/{heartbeat\|activate\|deactivate}` | POST | 心跳上报 / 激活进槽(enforce MAX_DEVICES=6,force 不绕)/ 出槽 | E5-MD1/MD2(force/强制解绑) | E5 |
| `/api/admin/config/devices/max-slots` | PUT | **TBD建议**:调 MAX_DEVICES(V2 写死,V4 参数化后补,权威 E5) | 是(④a) | E5 |
| `/api/admin/config/compute-share` | GET | E6 全量配置:入口开关 / 在线系数 / G1-G6 显卡档位 / 下载内容 | — | E6 |
| `/api/admin/config/compute-share/entry` | PUT | 开启 / 关闭电脑共享算力入口 | E6-MD1 | E6 |
| `/api/admin/config/compute-share/coefficients/:key` | PUT | 调整 H5 基础托管系数或 App 连续在线满额时长 | E6-MD2 | E6 |
| `/api/admin/config/compute-share/gpu-tiers/:tierId` | PUT | 编辑单个 G1-G6 档位展示名称 / TOPS | E6-MD3 | E6 |
| `/api/admin/config/compute-share/gpu-tiers/:tierId/keywords/:slot` | PUT | 新增 / 编辑 / 删除单个显卡型号识别词 | E6-MD4 | E6 |
| `/api/admin/config/compute-share/download-url` | PUT | 设置 / 清空客户端下载地址 | E6-MD5 | E6 |
| `/api/admin/config/compute-share/download-copy` | PUT | 编辑下载页中英标题与说明 | E6-MD6 | E6 |

### 域 F — 分销团队

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/config/v-ranks` · `/v-ranks` | GET / PUT | 13 阶 V 级配置(门槛保序 Vn≥Vn-1 违反 400) | F1-MD2(高敏) | F1 |
| `/api/admin/users/:userId/vrank/override` | POST | 手动晋升/回滚 V 级(携 Key;执行=增长 lead/超管) | F1-MD1 | F1 |
| `/api/admin/team/prize-queue` · `/prize-queue/:id/ship` | GET/POST | 实物奖发货队列 / 标发货(须 kycAddressVerified 否则 409) | F1-MD3(ship) | F1 |
| `/api/admin/config/commission/rates` | GET / PUT | 佣金费率/Partner Status 门槛权益/InfluenceScore/promo(高敏+B1 前置) | F2-MD1~MD3(高敏) | F2 |
| `/api/admin/config/commission/cooling-days` | GET / PUT | 佣金冷却(authorityOwner **TBD**:F2/commission/D5) | F2-MD5(PUT) | F2 |
| `/api/admin/config/commission/layer/:layer/pause` | POST | 暂停/恢复某层结算 | F2-MD4 | F2 |
| `/api/admin/config/binary` | GET / PUT | 双轨配置(binaryDailyCapUSD 不可写返 422;高敏+B1 前置) | F3-MD1/MD3(高敏) | F3 |
| `/api/admin/team/binary/:userId/adjust` | POST | 补发/纠错 Balance Match(携 Key;原子+D4 bill) | F3-MD2 | F3 |
| `/api/admin/config/leadership-pool` | GET / PUT | 领导池配置(注入比例/票权/头部集中度阈值;高敏+B1) | F4-MD3(高敏) | F4 |
| `/api/admin/team/leadership-pool/{inject\|settle}` | POST | 手动注入 / 提前结算(携 Key;原子+D4 bill) | F4-MD1/MD2 | F4 |
| `/api/admin/commissions?kind=&status=&cursor=` · `/commissions/anomalies` | GET | 六类佣金流水(by commission.paid)/ 异常预警 | — | F5 |
| `/api/admin/commissions/:id/reverse` · `/commissions/reissue` · `/users/:userId/commission/suspend` | POST | 撤销/补发/暂停(携 Key;原子+D4 冲正) | F5-MD1~MD3 | F5 |
| `/api/admin/config/quota` · `/users/:userId/quota/override` · `/config/quota/:tier/pause` | GET/PUT/POST | 配额解锁配置 / 单用户覆盖 / 断货暂停 | F4b-MD1~MD4(写) | F4b |
| `/api/admin/agent/applications?type=&status=` · `/applications/:id/review` · `/agent/budget` | GET/POST/PUT | 大使预算申请队列 / 审批 / 调区域预算(携 Key) | F4c-MD1~MD3(review/budget) | F4c |
| `/api/admin/leaderboard?period=&cursor=` | GET | 4 周期奖池+榜单快照(每 5min) | — | F4d |
| `/api/admin/leaderboard/:period/{payout\|pause\|topup}` | POST | 补发纠错派发 / 暂停 / 追加奖池(携 Key;topup+B1) | F4d-MD1/MD3/MD4 | F4d |
| `/api/admin/risk/leaderboard/:userId/disqualify` | POST | **F4d owns 取消刷榜资格**(剔除名单+标 disqualified;携 Key) | F4d-MD2 | F4d |

### 域 G — 金融产品(PUT 类放大流出一律 server 先核 B1,< 红线 422)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/config/staking/pools` | GET | (用户)双产品 4 档全表(server-canonical 配置源,4 披露面统一读) | — | G1 |
| `/api/admin/staking/positions?status=&product=` | GET | position 监控 | — | G1 |
| `/api/admin/staking/pools/:product/:term` | PUT | 改单档(升 APY/降 penalty 核 B1 422;跨档保序违反 422) | G1-MD1 | G1 |
| `/api/admin/staking/pool/:id/disable` | POST | 单档 kill(per-pool 粒度,**不进 J1 矩阵**) | G1-MD3 | G1 |
| `/api/config/exchange/caps` · `/admin/exchange/{queue,gate-stats}` | GET | (用户)三阈值+Queue / 队列监控 / 拦截统计 | — | G2 |
| `/api/admin/exchange/caps` · `/exchange/pause` | PUT/POST | 改三阈值(放宽核 B1 422)/ swap pause(geo_block[]) | G2-MD1/MD4 | G2 |
| `/api/admin/exchange/fee` | PUT | 改 `EXCHANGE_FEE_PCT`(0–10%)/ `EXCHANGE_FEE_MIN_USD`(0–5)· 降费率核 B1 422 · 仅新单 · 分配 30% G3 回购销毁 + 70% D1 fee_buffer | G2-MD2 | G2 |
| `/api/config/market/nex` · `/api/market/nex`(WS) | GET/WS | (用户)NEX 行情参数 / 实时 price feed | — | G3 |
| `/api/admin/market/nex/oracle-status` · `/market/nex/curve` · `/oracle` · `/{pause\|resume}` | GET/PUT/POST | 喂价健康 / 改曲线(拉升核 B1 422)/ 切源(仅超管)/ 暂停恢复(恢复仅超管+B1) | G3-MD1~MD4(写) | G3 |
| `/api/genesis/state` · `/genesis/marketplace/stats`(SSE) | GET/SSE | (用户)节点经济 / 二级市场实时 | — | G4 |
| `/api/admin/genesis/ownership` · `/genesis/economics` · `/dividend-rate` · `/pause` | GET/PUT/POST | ownership / 改总量单价版税 / 改分红率(仅超管,升核 B1 422)/ pause | G4-MD1~MD4(写) | G4 |
| `/api/config/premium` · `/admin/premium/{subscriptions,config,disable}` | GET/PUT/POST | (用户)价格权益 / 订阅监控 / 改配置(升 yield 核 B1)/ kill | G5-MD1~MD3(写) | G5 |
| `/api/config/nex-v2-lock` · `/admin/nexv2/{locks,config}` · `/nex-v2-lock/disable` | GET/PUT/POST | (用户)APY/锁期 / 锁仓监控 / 改配置(仅超管,升 APY 核 B1)/ kill | G6-MD1/MD2(写) | G6 |
| `/api/config/repurchase` · `/admin/repurchase/{orders,config}` | GET/PUT | (用户)复投配置 / 复投单监控 / 改参数(reinvestMultiplier 消费面归 G7;核 B1) | G7-MD1~MD3(PUT) | G7 |

### 域 H — Phase + Trial + 增长活动

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/phase/dials` | GET / PUT | 逐月 10 dial 矩阵+定时切换(**全 dial 读写唯一路径**;放大流出方向 dial 执行=仅超管+B1;携 Key) | H1-MD1/MD3(PUT) | H1 |
| `/api/admin/platform/phase-config/cohort-overrides` · `/:cohortId` | GET/POST/DELETE | cohort 月偏移 override 列/增/撤 | H1-MD4/MD5(写) | H1 |
| `/api/admin/trial/config` | GET / PUT | TrialConfig 19 参数(仅敏感项经确认弹窗;携 Key) | H2-MD1(敏感项) | H2 |
| `/api/admin/trial/sessions[?status=]` · `/sessions/:userId` | GET | 试用会话监控 / 单会话详情(7 态轨迹) | — | H2 |
| `/api/admin/trial/sessions/:userId/{cancel\|charge}` | POST | 强制取消 / 强制扣款(高敏,经 PSP;携 Key;共用 computeTrialOffset) | H2-MD2/MD3 | H2 |
| `/api/admin/trial/kpi` | GET | 试用 KPI 看板(喂 B3) | — | H2 |
| `/api/trial/eligibility` | GET | (用户)试用资格单源(server-canonical,拒重领) | — | H2 |
| `/api/trial/redeem-early` · `/trial/charge` · `/trial/cancel` | POST | (用户)早购重算 / (cron)auto-charge / 取消(reason 枚举) | — | H2 |
| `/api/config/quest/day-one` · `/api/quests/{weekly,monthly}` | GET | (用户)各层任务清单(server-canonical) | — | H3 |
| `/api/admin/quest/completions` · `/quest/{day-one,weekly,monthly}` | GET/PUT | 完成监控 / 改各层配置(升奖励核 B1 422;questBonusMultiplier 归 H1) | H3-MD1~MD4(PUT) | H3 |
| `/api/events?status=&region=` · `/admin/events/:id/tracking` | GET | (用户)活动列表 / trackable 监控 | — | H4 |
| `/api/admin/events` · `/events/:id` · `/:id/{publish\|unpublish}` | POST/PUT | 新建改活动(升奖励核 B1;featured 唯一违反 422)/ 上下架 | H4-MD1~MD3/MD5 | H4 |
| `/api/events/:id/spin` | POST | (用户)Lucky Spin 派奖(**server RNG+NODE_ENV guard**;3 护栏;spinDate 超额 409) | — | H4 |
| `/api/admin/events/:id/wheel` | PUT | **转盘专属配置**(奖池档位+概率+3护栏;weight 和=100 否则 422;含真实奖核 B1;携 Key) | H4-MD4 | H4 |
| `/api/points/sign-in` · `/api/config/checkin` | POST/GET | (用户)签到+server 裁决 Lucky(单次幂等)/ 签到规则公示 | — | H5 |
| `/api/admin/checkin/{stats,config}` | GET/PUT | 签到监控 / 改规则(升奖励/概率核 B1;Lucky 和>100% 返 422) | H5-MD1~MD4(PUT) | H5 |
| `/api/config/milestones` · `/admin/milestones/{stats,config}` | GET/PUT | (用户)5 档阈值 / 监控 / 改阈值奖励(升核 B1;保序 422) | H6-MD1/MD2(PUT) | H6 |

### 域 I — 内容 CMS(写端点 body 携 reason + 资金类携 Key;`/admin/*` 无前缀为前端别名)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/content/pool` · `/content/:key/versions` · `/content/:key` | GET/PUT | 文案池 / 版本历史 / 发布回滚(携 Key,SSE 推失效) | I1-MD1~MD3/MD5(PUT) | I1 |
| `/api/admin/content/experiments` · `/:id/{start\|stop}` | GET/POST | A/B 实验列表 / 启停 | I1-MD4(启停) | I1 |
| `/api/admin/stella/cadence-config` | GET / PUT | Nova(代码标识 stella)per-channel 节奏(enabled=false 单 channel kill,**不入 J1**;携 Key) | I2-MD1/MD2(PUT) | I2 |
| `/api/stella/config-invalidate` | SSE | cadence 变更推 client 失效重拉 | — | I2 |
| `/api/admin/notifications/campaigns` | GET / POST | campaign 列表 / 下发(携 Key 防重复) | I3-MD1(POST) | I3 |
| `/api/notifications?cursor=&priority=` · `/:id/read` · `/stream`(SSE) | GET/POST/SSE | (用户)分页拉取 / 标读 / 推优先级升级 | — | I3 |
| `/api/admin/trust/sections` · `/:sectionKey/versions` · `/:sectionKey` | GET/PUT | 信任 section 列表 / 历史 / 发布回滚(携 Key;财务数字/NEX 叙事类执行=风控 lead/超管) | I4-MD1~MD3(PUT) | I4 |
| `/api/legal/risk-disclosure/current?jurisdiction=` | GET | (用户)当前 IP/KYC 辖区披露版本(server 权威判辖区) | — | I5 |
| `/api/admin/legal/risk-disclosure` | PUT | 发布披露新版(per jurisdiction×locale;携 Key;发布标 ack stale 触发 re-ack;执行=风控 lead/超管) | I5-MD1~MD3 | I5 |
| `/api/admin/i18n/namespaces` · `/:namespace/keys` · `/:namespace` · `/i18n/integrity` | GET/PUT | namespace 矩阵 / key 列表 / 发布(校验镜像+占位符;携 Key)/ 完整性扫描 | I6-MD1~MD3(发布) | I6 |
| `/api/admin/learn/courses` · `/:slug/versions` · `/:slug` | GET/PUT | 课程列表 / 历史 / 发布回滚+改奖励(改奖励核 B1;携 Key) | I7-MD1~MD4(PUT) | I7 |

### 域 J — 紧急合规(J1/J2 V4 接管 A3 写路径,读保留别名)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/killswitch/matrix` | GET | 5 功能闸矩阵(server-canonical,client 仅读灯) | — | J1 |
| `/api/admin/killswitch/feature/:key` | PUT | 单闸熔断/恢复(熔断=风控/财务/超管单人确认+全运营广播;恢复=仅超管,前置 B1 闸 `coverageRatio ≥ recoverGate` 未达 422 `COVERAGE_BELOW_REDLINE`;携 Key) | J1-MD1/MD2 | J1 |
| `/api/admin/killswitch/feature/emergency` | POST | 批量应急熔断(可多闸;仅 disable,enable 返 403;触发事由空 422 / reason 空 400;风控/超管单人确认逐闸独立生效+全运营广播;携 Key) | J1-MD3 | J1 |
| `/api/admin/killswitch/auto-rules/eval` | POST | (server 内部)R1/R2 自动熔断评估命中调 feature 写入(`trigger=auto`,30min 内值班补录 J1-MD5) | (自动+J1-MD5 补录) | J1 |
| `/api/admin/killswitch/geo` | GET / PUT | geo-block 配置(server-canonical)/ 黑名单+受限名单(limitedCountries)+per-endpoint(拒绝财务执行 403;携 Key) | J2-MD1~MD3(PUT) | J2 |
| `/api/admin/killswitch/geo/emergency` | POST | geo 应急即时封锁(仅加封锁,移除 403;事由空 422;单人确认即时生效+广播;携 Key) | 是(④a) | J2 |
| `/api/admin/tamper/{overview,paths,accounts}?window=` | GET | 篡改拦截总览/路径分布/账户告警(window∈{24h,7d,30d} 非法 400) | — | J3 |
| `/api/admin/tamper/alert-config` | PUT | 配置告警频次/喂 K4 开关(携 Key) | J3-MD1 | J3 |
| `/api/admin/emergency/playbooks` · `/:name` | GET/PUT | 应急剧本库 / 编辑(携 Key) | J4-MD1(PUT) | J4 |
| `/api/admin/emergency/playbooks/:name/drill` | POST | 剧本演练(沙箱走查动作序列,不下发生产;通过更新 lastDrill→演练就绪;携 Key) | J4-MD2 | J4 |
| `/api/admin/emergency/playbooks/:name/execute` | POST | 执行剧本(逐步推进,各止血步由该步目标域授权角色经该域确认弹窗单人确认执行,J4 不绕过各域确认门;前向只进不回滚;携 Key+执行锁;编排 J1/J2/I5/C2/K1/I3) | J4-MD3(各步各域确认门) | J4 |
| `/api/admin/emergency/executions?filter=` | GET | 历史执行追溯(合规取证;partial 终态不回写) | — | J4 |

### 域 K — 风控

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/risk/multi-account?layer=` · `/risk/cluster/:id` | GET | 三层去重命中 / 簇详情+图谱 | — | K1 |
| `/api/admin/risk/cluster/:id/freeze` · `/release` | POST | 批量冻结执行(确认弹窗+理由必填,携 Key,server 原子置各账户 frozen;执行=风控 lead/超管)/ 解除误判 | 是 | K1 |
| `/api/admin/risk/ip-whitelist` | GET/POST/DELETE | IP 白名单列表 / 添加 / 移除(仅 IP 维度共享网络豁免,不解冻账户;移除强制 reason;与 C2 账户级名单不重叠) | 否(免MC+审计) | K1 |
| `/api/admin/risk/arbitrage?type=` · `/risk/welcome-gift/block` | GET/POST | 套利刷量检测列表(消费 minHoldingMonths 只读)/ 拦截 gift 发放 | 否(预防性) | K2 |
| `/api/admin/risk/withdraw-rules` | GET/PUT | 规则列表+命中日志 / CRUD 启停(archived→active 返 409;启停经确认弹窗,执行=风控 lead/超管) | 是 | K3 |
| `/api/admin/risk/score/:userId` · `/risk/model` | GET | 单用户评分+可解释(唯一评分源)/ 模型配置+分布 | — | K4 |
| `/api/admin/risk/model` | PUT | 权重/分档/开关(六维和=1 违反 422;执行=仅超管,风控 lead 起草草稿) | 是 | K4 |
| `/api/admin/risk/score/:userId/override` · `/score/recompute` | POST | 单用户评分覆盖(**不走 MC**,强制 reason+审计)/ 重算 | 否 | K4 |
| `/api/admin/risk/kyc-review` · `/:id/decide` | GET/POST | 复审队列+复审单 / 通过驳回(回写 C4;携 Key;执行=风控 lead/超管) | 是 | K5 |
| `/api/admin/janus/devices?status=&channel=&op=` · `/janus/devices/:sid` | GET | 设备队列(12 态/来源/成熟度/环境/优先级,筛选排序分页)/ 详情(会话+成熟度+环境+判定轨迹) | — | K6 |
| `/api/admin/janus/devices/:sid/status` | POST | 手动状态下发(§9.3/§9.4 合法流转校验 + 逐字段理由 + 单人强确认,携 Key;before/after 审计;高风险流转禁批量) | 是 | K6 |
| `/api/admin/janus/strategies` · `/:id` | GET/POST/PUT/DELETE | 多策略列表 / 增删改(状态/规则树/动作/范围/保护条件) | 草稿免·发布是 | K6 |
| `/api/admin/janus/strategies/:id/publish` · `/rollback` · `/dry-run` | POST | 发布(干跑门+发布说明,仅超管)/ 回滚历史版本(版本差异+回滚原因)/ 干跑预估(命中+冲突);生成不可变版本 | 是 | K6 |
| `/api/admin/janus/health` · `/audit` · `/export` | GET | 健康度分级(4 档+10 指标+异常下钻+建议)/ 审计日志(筛选+搜索)/ 报表导出(漏斗+健康 CSV/JSON,导出留痕) | 导出留痕 | K6 |

### 域 L — 数据 BI(无高敏处置权,唯一升 MC=含敏感/超 rowCap 导出)

| Endpoint | Method | 用途 | 确认 | 模块 |
|---|---|---|---|---|
| `/api/admin/bi/kpi?window=&cohort=&phase=` · `/kpi/:kpiId/drilldown` · `/kpi/trend` | GET | 八项 KPI 看板(预聚合)/ 单 KPI 下钻 / cohort 序列 | — | L1 |
| `/api/admin/bi/funnel/drilldown` · `/retention/{cohort-matrix,curve}` · `/funnel/cross` | GET | 漏斗下钻 / 留存矩阵+曲线(app.dau 口径)/ 多维交叉 | — | L2 |
| `/api/admin/bi/finance/{revenue,redemption}` | GET | 收入结构(§1.4 四流)/ 兑付报表 | — | L3 |
| `/api/admin/treasury/{coverage,maturity-forecast,liabilities}` | GET | 净敞口/到期/负债报表(**读引用 B1/D3,不重算**) | — | L3→B1/D3 |
| `/api/admin/bi/{devices,tasks,network,phase-effect}` | GET | 设备/任务/网络/Phase 效果报表(只读聚合) | — | L4 |
| `/api/admin/bi/export/{kpi,funnel,finance,network,operations}` | GET | 各类 CSV 导出(落 admin.report_exported;含 PII/资金明细 MC) | 是(含敏感) | L1-L4 |
| `/api/admin/bills/export?type=&userId=` | GET | 账单导出**复用 D4 endpoint**(L5 叠加管控/脱敏) | 是(含明细) | L5→D4 |
| `/api/admin/bi/export/request` · `/:exportId` | POST/GET | 发起导出(经确认弹窗+理由必填;含敏感 OR row>rowCap 执行权升仅超管;携 Key)/ 状态+限时下载(TTL 24h) | 条件 | L5 |
| `/api/admin/regulatory/report` · `/bi/export/audit` | POST/GET | 生成监管报告(关联 I5)/ 导出审计台 | 是(report) | L5 |

### 域 C6/K1 用户侧 server-enforce 端点(配置阈值,写权非 admin)

| Endpoint | Method | 用途 | 模块 |
|---|---|---|---|
| `/api/auth/otp/{send,verify}` | POST | (用户)OTP 下发/校验(server TTL+24h 限频+CAPTCHA+锁定;超 maxSignupPerIp24h reject) | C6/K1 |
| `/api/sponsorship/bind` | POST | (用户)赞助绑定(三层去重任一重复 reject;welcome gift 单次幂等) | K1 |

### 3.X API 结构性说明(开发须知)

1. **单源读端点(唯一权威)**:`/api/kyc/status/:userId`(KYC)· `/api/admin/treasury/coverage`(覆盖率口径)· `/api/admin/treasury/reserve`(储备)· `/api/admin/risk/score/:userId`(风险评分)· `/api/admin/phase/dials`(全 dial 读写)· `/api/config/staking/pools`(USDT-staking 4 披露面统一)· `/api/trial/eligibility`(试用资格)。
2. **跨章共用 endpoint(实现权威 vs UI 调用方)**:`/api/admin/treasury/*` 实现权威唯一在 **D3**,B1/B2/L3 为调用方;`/api/admin/bills/export` 具名 **D4**,L5 引用;Lucky Spin 派奖 `/api/events/:id/spin` 唯一在 **H4**,H5 仅发 spin 票。
3. **kill-switch 矩阵 vs 各域原生 kill(非双 endpoint)**:J1 `/api/admin/killswitch/feature/:key` 是矩阵权威写面;各域原生 kill(`staking/pool/:id/disable`、`genesis/pause`、`exchange/pause`、`premium/disable`、`nex-v2-lock/disable`、`market/nex/pause`、D 域 `withdrawals/pause`)为 server-enforce 生效面,读闸状态做 enforce。staking 矩阵层整体熔断 key 与 G1 per-pool disable 两粒度并存。A3 `/api/admin/killswitch` 为 V1 临时面,V4 写迁 J1/J2、读保留别名。
4. **前端别名路径(规范化归 §9.2⑥)**:无 `/api/` 前缀的 `/admin/home/conversion-banner.copy`、`/admin/stella/{channels,templates,social-event-pool}`、`/admin/legal/risk-disclosure`、`/admin/onboarding/quest-tasks` 为前端现状别名。
5. **B1 红线拒绝码统一 422**(✅ PM 2026-06-02;旧文 403 已废,auth/authz 类 403 保持)。

## 第 4 章 参数配置总表(配置项 + 校验规则)

> 生效时机:**实时全量**(改后即对全量生效)/ **仅新对象**(仅新建对象,存量锁定建立时值)/ **Phase 派发**(H1 按账户月龄下发)/ **配置即生效**(被引用时取值)。权威源标单一真值源(SSOT),只读引用方不可重设。放大流出方向提交时 server 前置核 B1 红线(< 100% 拒,统一 422)。

### 4.1 域 A — 平台基础

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 | 模块 |
|---|---|---|---|---|---|
| 运营账号角色集 | 七角色(超管/财务/风控/增长/内容/客服/只读审计) | 固定枚举 | 角色分配实时 | A1 | A1 |
| 后台强制 2FA | 强制开启(全角色) | 不可关 | 实时 | A1 | A1 |
| 运营 session 时限 | 滑动 30min / 绝对 8h | 滑动 15–60min / 绝对 4–12h | 实时(下次签发) | A1 | A1 |
| 后台登录短锁/长锁 | 5 次→15min / 15 次/24h→锁+强制2FA | 3–10 次/5–60min | 实时 | A1 | A1 |
| 最少有效超管数 | ≥ 2 | 固定下限 2 | 实时(禁用超管前校验) | A1 | A1 |
| 审计日志保留期 | ≥ 13 个月 | 13–36 月 | 仅新对象 | A2 | A2 |
| 理由最小长度 | 8 字 | 0–50 字 | 实时 | A2 | A2 |
| kill-switch 闸清单/默认态(6闸) | 5 功能闸 enabled=true + geo-block 空 | 各 enabled/disabled | 实时(熔断即 enforce) | A3(V1)→J1/J2(V4) | A3 |
| 事件采样率 | view/session 10% / 资金风控转化 100% | — | 配置即生效 | A4 | A4 |

### 4.2 域 B — 总览驾驶舱

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 | 模块 |
|---|---|---|---|---|---|
| `coverageRedLine`(兑付覆盖率红线) | 100% | 80%–150%(< 黄线) | 实时(重判灯) | **B1** | B1 |
| `coverageYellowLine`(覆盖率黄线) | 110% | 100%–200%(> 红线) | 实时 | B1 | B1 |
| 储备/负债科目纳入开关 | 全部纳入 | 科目级 ON/OFF | 仅新对账周期 | D3(口径) | B1/B2 |
| staking 利息计提口径 | 按已锁天数线性(仅 USDT 池) | 线性/到期一次性 | 仅新对象 | B2 | B2 |
| `bankrunYellow`(挤兑黄线) | 20%(24h 提现÷储备) | 5%–50% | 实时(重判灯) | B5 | B5 |
| `bankrunRed`(挤兑红线) | 40%(24h 提现÷储备) | 10%–80%(> 黄线) | 实时 | B5 | B5 |
| 提现队列积压阈值 | 由 D 域 48h SLA 派生 | 单数/金额双阈 | 实时 | D 域 SLA | B5 |

### 4.3 域 C — 用户与账户

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 | 模块 |
|---|---|---|---|---|---|
| 单次调整上限(USDT) | $500/笔(超额升级审批) | $0–$10,000 | 实时 | C3 | C3 |
| 单次调整上限(积分) | 1,000 积分/笔 | 可配 | 实时 | C3 | C3 |
| impersonate 时限 | ≤ 30min(强制只读) | 5–30min | 实时(发起授时) | C2 | C2 |
| KYC 费 | $1 USDT(计入余额) | 固定 | 实时 | C4 | C4 |
| 配对网络白名单 | TRC20/ERC20/BTC/ETH | 网络级 ON/OFF | 实时 | C4 | C4 |
| access/refresh token | 4h / 30 天滑动 | 1–24h / 7–90d | 仅新签发 | C5 | C5 |
| step-up auth 阈值 | V1 只读(现状硬编码 7d) | 目标 1–30d(须可配化,见第7章) | 实时 | C5 | C5 |
| OTP TTL / 重发冷却 / 24h 上限 | 5min / 60s / 3 次(超触发 CAPTCHA) | 1–15min / 30–300s / 1–10 次 | 实时 | C6 | C6 |
| 用户登录短锁/长锁 | 5 次/15min / 10 次/24h+强制reset | 3–10/5–60min · 5–20/12–48h | 实时 | C6 | C6 |
| CAPTCHA 开关 | ON(按阈值触发) | ON/OFF | 实时 | C6 | C6 |

### 4.4 域 D — 资金与财务

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 | 模块 |
|---|---|---|---|---|---|
| 充值费 TRC20/ERC20/BTC·ETH/Card | 1 USDT / 5 USDT / 0.5% / 3.5%(进 fee_buffer) | ≥0 / 0–10% | 仅新对象 | D1 | D1 |
| 3DS 强制阈值 | $50 | $0–$500 | 实时 | D1 | D1 |
| Card 同卡 24h 重试/锁卡 | 5 次→锁 24h | 3–10 次 / 1–72h | 实时 | D1 | D1 |
| 最小充值额 | TRC20/ERC20 $10·BTC/ETH $20·Card $10 | per-channel ≥0 | 仅新对象 | D1 | D1 |
| 主备 PSP | Checkout.com(主)+ Stripe(备) | 主/备切换 | 实时 | D1 | D1 |
| 大额人工审核阈值(D2 后台) | $1,000(≥强制人工+MC) | $0–$5,000 | 实时 | D2(独立于 K3) | D2 |
| review SLA / 整体到账 SLA | ≤2 工作日 / 48h | 1–5 工作日 / 24–72h | 实时 | D2 | D2 |
| 提现日限额(次数) | 1 次/日 | 1–10 次/日 | 实时(新申请) | D5 | D5 |
| 余额上限(可提比例) | 80% | 50%–100% | 实时 | D5 | D5 |
| 网络费 | 2%(min $1/max $20) | 0%–5% | 仅新对象 | D5 | D5 |
| `withdrawCooldownDays` | 月1–7=30 / 月8=35 / 月9+=45 | 7–90d | Phase 派发 | **H1**(D5 只读) | D5 |
| `withdrawPointsRatio` | 月1–8=10 / 月9–12=20(每$100) | 0–100 | Phase 派发 | **H1**(D5 只读) | D5 |
| `complianceHoldEnabled` | 月8+=true | 是/否 | Phase 派发 | **H1**(D5 只读) | D5 |
| BillType 口径 | 7 类(swap/topup/withdraw/earning/commission/refund/bonus) | schema 治理 | 配置即生效 | D4 | D4 |

### 4.5 域 H1 — 12 月节奏 Phase 调度器(全平台 10-dial 唯一权威;逐月矩阵,触发口径=月份数)

| dial(key) | 默认值(逐月) | 范围 | 生效范围 | 生效面 |
|---|---|---|---|---|
| `newUserBonusMultiplier` | 月1–2=2 / 月3–4=1.5 / 月5+=1 | 1–4 | 仅新用户 | 新注册加成 |
| `inviteRewardMultiplier` | 月1–2=2 / 月3–4=1.5 / 月5+=1 | 1–4 | 仅新用户 | 新邀请计酬 |
| `reinvestMultiplier` | 月5–6=2 / 其余=1 | 1–4 | 实时全量 | G7 复投激励 |
| `withdrawPointsRatio` | 月1–8=10 / 月9–12=20 | 0–100 | 实时全量 | D5 提现积分门 |
| `withdrawCooldownDays` | 月1–7=30 / 月8=35 / 月9+=45 | 7–90 天 | 实时全量 | D5 提现冷却 |
| `binaryDailyCap` | 月1–6=5000 / 月7+=2000 | 0–50000 USD | 实时全量 | F3 双轨封顶 |
| `premiumSubAvailable` | 月7+=是 | 是/否 | 实时全量 | G5 Premium gate |
| `nexV2LockAvailable` | 月11+=是 | 是/否 | 实时全量 | G6 NEX v2 gate |
| `questBonusMultiplier` | 月1–2=4 / 其余=1(前端未实装) | 1–4 | 实时全量 | H3 quest 乘数 |
| `complianceHoldEnabled` | 月8+=是 | 是/否 | 实时全量 | D5/D2 合规留存 |

### 4.6 域 H2 — 免费试用引擎(TrialConfig 19 项)

| 参数(key) | 默认值 | 生效时机 | 权威源 |
|---|---|---|---|
| `trialDays` / `graceDays` / `extensionDays` | 3 / 7 / 3 | 仅新 trial | H2 |
| `discountRate` / `discountCapUSD` | 0.15 / 20 | 实时全量 | H2 |
| `trialOffsetCapUSD`(试用收益抵购机款上限) | 50 | 实时全量 | H2 |
| `autoChargeAtEnd` | true(实时性待 PM,见第7章 #1) | 暂仅新 trial | H2 |
| `highQualityThresholdUSD` | 100 | 实时全量 | H2 |
| `chargeFailRate` | 0.01(**server-only,前端永不可知**) | 实时全量 | H2 |
| `trialProductId` | stellarbox-s1(只读 schema 治理) | — | H2 |
| `trialPriceUSD` | 1299(敏感项,MC) | 仅新 trial | H2 |
| `shadowDailyUSD` / `shadowDailyNEX` | 38.52 / 65 | 仅新 trial | H2 |
| `cooldownDays`(再次试用冷却) | 30(**≠ D5 withdrawCooldownDays**) | 实时全量 | H2 |
| `phaseOpen` | true(Phase 派发只读) | 实时全量 | H1 调度 |
| `autoPush{Enabled,DelayMs,CooldownHours,MaxPerSession}` | true / 1500 / 24 / 1 | 实时全量 | H2 |

### 4.7 域 K — 风控与反作弊

| 参数(key) | 默认值 | 范围 | 权威源 | 模块 |
|---|---|---|---|---|
| `maxSignupPerIp24h` | ≤ 3 | 1–10 | **K1**(C6 不重设) | K1 |
| `maxAccountsPerDevice` / `maxAccountsPerPaymentInstrument` | ≤ 2 / ≤ 2 | 1–5 | K1 | K1 |
| `linkWeight.{ip,device,payment}` | device 0.5 / payment 0.4 / ip 0.1 | 各 0–1 | K1 | K1 |
| `clusterFreezeSuggestThreshold` | 0.7 | 0–1 | K1 | K1 |
| `trialCycleThreshold` | 同实体 ≥3 次/30 天 | 2–10 | K2(归属待定,见第7章) | K2 |
| `welcomeGiftAnomalyThreshold` | 同实体 ≥2 笔 | 1–5 | K2 | K2 |
| `rewards.welcomeGift.usdtAmount` / `.nexAmount` | $5 / 20 NEX | ≥0 | K2(新人礼发放配置) | K2 |
| `rewards.welcomeGift.lockMode` | `risk_bucket` | risk_bucket/direct | K2 | K2 |
| `leaderboardVelocityMultiplier` | >5× 基线→信号 | 2×–20× | **K2**(F4d 只读) | K2 |
| `largeAmountUsdt`(提现路由) | ≥ $1,000 | $100–$50,000 | K3 | K3 |
| `velocity24h` | 笔数>3 或 >$5,000/24h | 笔数 1–20 / $500–$50,000 | K3 | K3 |
| `newAccountProtectDays` | 7 天 | 0–30 天 | K3 | K3 |
| `ruleActionMap` | 大额→manual / 高速→delay / 新账户→delay / 低信誉→freeze | delay/freeze/manual | K3 | K3 |
| `weight.{6维}` | multiAccount 0.25/arbitrage 0.2/kycStatus 0.2/withdrawVelocity 0.15/accountAge 0.1/anomalyBehavior 0.1 | 各 0–1(**和=1 强制**) | **K4** | K4 |
| `scoreBand.{low,mid,high}` | <40 / 40–69 / ≥70 | 0–100(low<mid<high) | K4 | K4 |
| `autoEscalateScore` | ≥ 85 | 70–100 | K4 | K4 |
| `riskScore.dimensionWeights.{7维}`(SPEC-7 聚簇) | serverDeviceId 0.9 / ipBucket 0.8 / withdrawAddress 0.9 / paymentInstrument 0.5 / sponsor 0.4 / uaFingerprint 0.2 / signupTiming 0.3 + `weakSignalClusterThreshold` 0.6 | 各 0–1 | **K4**(聚簇维度权重面板;区别于上 6 维评分权重) | K4 |
| SPEC-7 收益释放 / 提现前置全参数 | 见 SPEC-7 | — | `releaseMode` / `freeSlotRequiresBinding` / `appAttestationReleaseHours` / `firstWithdrawalManual` / `newAddressHoldHours` / `sameAddressRoute` 等全表在 `PRD/三端架构改造/specs/SPEC-7-H5风险簇与收益释放.md` §5,K1/K3 面板可调 | K1/K3 |
| `largeWithdrawReviewUsdt`(KYC 复审) | ≥ $1,000 | $100–$50,000 | K5 | K5 |
| `cumulativeKycThresholdUsdt` | $100 lifetime | $50–$1,000 | K5(V1)→G2(V3) | K5 |
| `reviewSlaDays` / `reviewTriggerScore` | ≤7 工作日(大额≤15) / ≥85 | 1–15 天 / 70–100 | K5 | K5 |

### 4.8 域 E — 设备与商城(出处 v2 §10 各 ③)

> **编号收编(2026-06)**:域 E 原 7 子模块已收编为连续 E1-E5,2026-06-29 追加 E6 算力与设备配置,与 nav / PRD §10 一致 —— E1 商品目录 & 代际门(原 E1+E2)· E2 收益 & 任务引擎(原 E3)· E3 生命周期 & Trade-in(原 E4+E5)· E4 订单状态机(原 E6)· E5 设备运维(原 E7)· E6 算力与设备配置(PC 算力备用模块)。本节及 §5.x 的 E 编号均按收编后口径。

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| `price`(各 SKU USDT) | S1 1,299 / Pro 2,399 / Pro v2 2,639 / Rack P1 8,999 / Rack P2 14,999 / Cloud Share 199 / Genesis 9,999 | > 0 | 仅新单(在途锁价) | E1 |
| `baseRate`(USDT/日满效率) | S1 38.50 / Pro 76.00 / Pro v2 96.00 / Rack P1 142.60 / Rack P2 248.00 / Cloud Share 0.073 | > 0 | 仅新对象(衰减叠加 E3) | E1 |
| `baseRateNEX`(NEX/日) | S1 65 / Pro 215 / Pro v2 280 / Rack P1 950 / Rack P2 1,820 / Cloud Share 30 | ≥ 0 | 仅新对象 | E1 |
| `stock` | 现状,<50 橙告警 | ≥ 0 | 实时(stock=0 须 MC) | E1 |
| 套餐折扣 ladder | 4 件 12% / 3 件 8% / 2 件 5% | 各 0–30% | 仅新结算 | E1 |
| 6 类任务 minReward/maxReward | IG $0.0001–0.045 / VG $0.45–1.80 / LL $0.00005–0.85 / FT $0.06–0.42 / EM $0.00001–0.09 / SP $0.00005–0.072 | ≥0,min≤max | 实时(仅新派发) | E2 |
| `QUEUE_SATURATION` | 0.35 | 0–1 | 实时 | E2 |
| `GENERATION_RELEASES.releaseMonth` | Pro v2 月5 / Rack P2 月10(绝对月) | 月1–12 | 仅新对象(月龄门) | E1 |
| `tradeinDiscount` | Pro v2 $300 / Rack P2 $800 | ≥ 0 | 仅新置换单 | E1 |
| `DEGRADATION_CURVE` | −4% / −6% / −10% /月(month_1_3/4_8/9_12) | 各 −0.20–0 | 仅新计算(不追溯历史) | **E3** |
| `MIN_EFFICIENCY`(效率 floor) | 0.22 | 0–1 | 仅新计算 | E3 |
| 衰减豁免类型 | phone / cloud-share | kind 集合 | 实时 | E3 |
| 任务锁定月度损失阈值 | 月1–3=$40 / 月4–8=$140 / 月9–12=$450 | ≥ 0 | 仅新对象 | E3 |
| `salvage.rate / monthlyDecay / floor` | 0.30 / 0.025(月12归零) / 0 | 满足月12归零约束 | 实时(仅新置换) | E3 |
| `minHoldingMonths`(最短持有) | 1 月 | ≥ 0 | 实时(server 守卫) | **E3**(K2 只读) |
| `eligibility[kind]`(购买资格) | S1=open;Pro=any-of(own S1/V≥2/累计≥$1000/trade-in S1);Rack P1=any-of(own Pro/V≥4/≥$5000/trade-in Pro) | 9 类规则组 | 实时(仅新购买判定) | E3 |
| `eligibility[Gen-2]`(Pro v2/Rack P2) | **待补录**(空值兜底 deny-all,见第7章 #9) | 9 类规则组 | 实时 | E3 |
| `promo.{enabled,cooldownHours,maxPerSession,delayMs}` | true / 24 / 1 / 1500 | — | 实时 | E3 |
| `promo.triggerWhen.minDeviceAgeDays` | 30 | ≥ 0 | 实时 | E3 |
| `inventory.softMax` | 0(禁用) | ≥ 0 | 实时(超阈仅告警) | E3 |
| DC 分配规则 | Rack→Frankfurt / 其余→Singapore | kind→DC 规则表 | 仅新订单 | E4 |
| 订单过期时窗 | **未定义**(建议 15–30min,见第7章) | 分钟 | 仅新订单 | E4 |
| `MAX_DEVICES`(激活槽位) | 6(**V2 写死不可调**) | — | 仅新激活判定 | E5 |
| phone heartbeat 门槛 | `isCharging && isWifiConnected` | 布尔组合 | 实时 | E5 |
| 电脑共享算力入口 | 关闭 | 开 / 关 | 实时 | E6 |
| H5 基础托管系数 | 0.6 | 0–1 | 实时 | E6 |
| App 连续在线满额时长 | 2 小时 | >0 | 实时 | E6 |
| G1-G6 显卡档位 TOPS | 40 / 90 / 160 / 290 / 460 / 660 | 正数且严格递增 | 实时(新派生生效) | E6 |
| G1-G6 显卡识别词 | 运营维护 | 单个词条非空;不得单框多值 | 实时 | E6 |
| 客户端下载地址 | 空 | URL 或空 | 实时 | E6 |
| 下载页中英标题 / 说明 | 默认引导文案 | 允许空;四字段独立 | 实时 | E6 |

### 4.9 域 F — 分销与团队(出处 v2 §11 各 ③)

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| V_RANKS 各阶门槛 | V1 自买≥$299 AND 直推≥3 / V2 团队≥$5K / V3 ≥$20K AND vDownlines … V12 $500M(AND 复合) | 各≥0 保序 | 仅新判定(不回溯) | F1 |
| 培育奖 NEX `cultivationBonus[V]` | V1 500 / V2 2,000 / V3 10,000 / V4 50,000 / V5 200,000 / V6 800,000 / V7 320万 / V8 1000万 / V9+ 0 | 各 ≥ 0 | 实时(下次跨阶) | F1 |
| 平级奖 `peerBonus[V]` | V0–V2=0 / V3+=5% | 0–100% | 仅新结算周期(月结) | F1 |
| `vRankPermanent` | true(不降级) | true/false | 实时 | F1 |
| `UNILEVEL_USDT[L1..L7]` | [10%,5%,3%,2%,1%,0.5%,0.5%] | 各 0–100%,**和 ≤25%** | 仅新结算 | F2 |
| `UNILEVEL_NEX[L1..L7]`(per $1) | [50,20,10,5,2.5,1,1] NEX | 各 ≥ 0 | 仅新结算 | F2 |
| Partner Status 门槛+权益 | Standard $0 / Verified $5K / Premium $50K / Diamond $500K(仅门槛+非现金权益,不改费率;直推费率恒取 UNILEVEL_USDT[1] 默认 10%、运营全局可配) | 门槛≥0 保序 | 仅新评定周期(过去30天活跃) | F2 |
| InfluenceScore clamp | clamp(1.0, 5.0) | 下限≥0;上限≤10 | 仅新结算 | F2 |
| `commission/cooling-days` | 30d(域独立,≠提现冷却) | 0–90 天 | 见第7章 #5 | F2(待定) |
| `balanceMatchRate`(双轨匹配) | 10%(min(A,B)×10%) | 0–20% | 仅新结算(日结) | F3 |
| `binaryDailyCapUSD` | 月1–6=$5,000 / 月7+=$2,000 | H1 控制 | Phase 派发 | **H1**(F3 只读) |
| `binaryTrackMinUsd`(两轨门槛) | $1,000/轨 | $0–$5,000 | 仅新结算周期 | F3 |
| `unmatchedSurplusDisposition` | **裁定前冻结**(见第7章 #3) | 待裁定 | — | F3 |
| `gvResetCron` | 每月1日 00:00 UTC 归零;月底 23:59 锁定 | 固定 | 配置即生效 | F3 |
| `leadershipPoolInjectRate` | 5% 平台周总交易额 | 3%–10% | 仅新结算周 | F4 |
| V_VOTES 票数权重 | {V3:1…V12:512}(逐级翻倍) | 各≥0 | 仅新结算周 | F4 |
| `poolSettleCron` | 周日 23:59 UTC 快照 / 周一 00:00 开新池 | 固定 | 配置即生效 | F4 |
| `top1MaxPct/top5MaxPct`(头部集中度) | top1≤25% / top5≤60%(超阈告警非阻断) | 各 0–100%(见第7章 #18) | 实时 | F4 |
| `proUnlockDirects` / `rackP1UnlockDirects/UnlockVolumeUsd` | ≥5 直推 / ≥15 直推 OR 月业绩≥$20,000 | 各 ≥ 0 | 实时 | F4b |
| `proMonthlyStock` / `rackP1MonthlyStock` | 1,000 / 100 台 | ≥ 0 | 仅新月度周期 | F4b |
| `agentEligibilityVRank`(大使资格) | V5 Wing Leader+ | V0–V12 | 实时 | F4c |
| 线下活动预算 / KOL 补贴 | $1,000–$10,000 / 50% | ≥0 / 0–100% | 仅新申请 | F4c |
| `PERIOD_PRIZE`(4 周期奖池) | today $5,000/Top20 · week $50,000/Top50 · month $250,000/Top100 · all-time $1,000,000/Top100 | 奖池≥0/TopN≥1 | 仅新周期 | F4d |
| `leaderboardMinUsd` / `snapshotIntervalMin` | ≥$1 / 5 分钟 | ≥0 / 1–60min | 实时 | F4d |

### 4.10 域 G — 金融产品(出处 v3 §12 各 ③;升 APY/费率/分红/价格放大流出核 B1 422)

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| USDT 锁仓 APY(30/90/180/365d) | 12% / 35% / 80% / 180% | 各 0–300%,保序 | 仅新 position | G1 |
| USDT 锁仓 penalty | 5% / 15% / 30% / 50% 本金 | 各 0–100% | 仅新 position | G1 |
| NEX 池 APY | 5% / 12% / 20% / 35% | 各 0–300%,保序 | 仅新 position | G1 |
| NEX 池 minStake | 1,000 / 5,000 / 10,000 / 20,000 NEX | ≥ 0 | 仅新 position | G1 |
| 兑换 `USER_DAILY_CAP_USD` / `PLATFORM_DAILY_CAP_USD` | 50 / 20,000 | 0–10,000 / 0–10,000,000 | 实时 | G2 |
| 兑换 `KYC_LIFETIME_THRESHOLD_USD` | 100 | 0–100,000 | 实时(累计达阈) | G2(V3)/K5(V1) |
| NEX 基准现价 `price` | $0.171 | > 0 | 实时(server feed) | **G3** |
| 价格上行概率 `isPump` | 0.08 | 0–1 | 实时(下一 tick) | G3 |
| 做市波动幅度 | ±3% | 0–±20% | 实时(下一 tick) | G3 |
| 成本基准锚 `costBasis` | $0.085 | > 0 | 仅展示锚 | G3 |
| 喂价源 / `oracleDeviationPct` | INTERNAL_MM / 5% | INTERNAL/EXTERNAL / 0–50% | 实时 | G3 |
| Genesis `TOTAL_SLOTS` / `unitPriceUSDT` | 1,000 / $9,999 | ≥已铸量 / >0 | 仅未来供应/仅新一级(锁价) | G4 |
| Genesis `dailyDividendShare` | **0.1%/日(✅PM 2026-06-01)** | 升率受 B1 约束 | 实时 | G4 |
| Genesis 二级版税 `royalty` | 2.5% | 0–20% | 仅新二级成交 | G4 |
| Premium `MONTHLY_PRICE` / `FIRST_MONTH_DISCOUNT` / +yield | $99 / 0.50 / +2% | >0 / 0–1 / 0–10% | 仅新订阅/下周期 | G5 |
| `premiumSubAvailable`(gate) | 月7+=true | H1 dial | Phase 派发 | **H1**(G5 只读) |
| NEX v2 `APY` / `LOCK_MONTHS` / `MIN_LOCK_NEX` | 250% / 24 / 1,000 NEX | 0–300% / ≥1 / ≥0 | 仅新锁仓 | G6 |
| `nexV2LockAvailable`(gate) | 月11+=true | H1 dial | Phase 派发 | **H1**(G6 只读) |
| 复投 `APY` / `LOCK_DAYS` | 35% / 90 天 | 0–300% / ≥1 | 仅新复投单 | G7 |
| 复投积分倍率 / 培育倍率 | +50 积分/$100 / ×1.5 | ≥0 / ≥1.0 | 仅新复投单/实时 | G7 |
| 复投 Genesis 抽奖券 / preset | 每单+1 张 / $100/200/500/1,000 | ≥0 / 自定义 | 仅新复投单/实时 | G7 |
| 复投早赎罚款 | 罚本金 15% + forfeit 利息/积分/券 | 0–100% 本金 | 仅新复投单 | G7 |

### 4.11 域 H — 增长活动 H3-H6(出处 v3 §13 各 ③)

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| Day-One active/grace 奖励 | active 500 NEX / grace 200 NEX | ≥ 0 | 仅新进窗 | H3 |
| `QUEST_WINDOW_MS` / `QUEST_GRACE_END_MS` | 24h / 72h | active 1–168h / grace≥active | 见第7章 #11 | H3 |
| Day-One 6 任务奖励 | connect_wallet 50/visit_earn 30/visit_store 50/view_product_roi 100/setup_profile 80/invite_friend 200NEX+$1 | ≥0 | 仅新进 active | H3 |
| Weekly Tier1(9条)base | nex_v2_lock 3,000 / buy_genesis 2,500 / … / stake 250 NEX | ≥0 | 仅新 weekKey | H3 |
| Weekly Champion bonus | +500 NEX × phase mult(P1=500/P6=750) | ≥0 | 仅新 weekKey | H3 |
| Weekly Tier1 phase mult 曲线 | P1 1.0/P2 1.0/P3 1.1/P4 1.2/P5 1.3/P6 1.5 | ≥0 | 仅新 weekKey | H3(独立于 questBonusMult) |
| Monthly 5 主题奖励 | foundation 1,500 / network 2,500 / premium 4,000 / diamond 6,000 / founders 10,000 NEX | ≥0 | 仅新月派发 | H3 |
| `questBonusMultiplier` | 月1–2=4 / 其余=1(前端未实装) | 1–4 H1 dial | Phase 派发 | **H1**(H3 只读) |
| 活动 `kind`(8 枚举) | discount/referral/wheel/regional/boost/seasonal/holding/onboarding | 8 枚举闭集 | 仅新建/改 | H4 |
| `featured`(主推位) | evt-pro-upgrade-7d | **同时仅 1 个 true** | 实时 | H4 |
| Lucky Spin 奖池(8 档) | 5NEX 38% / 50积分 24% / 30NEX 18% / 150NEX 11% / $1 5% / $50券 3% / $20 0.9% / $500 0.1%(EV≈$0.78/spin) | 档位 2–12;weight 和=100 | 实时(server RNG) | H4 |
| `wheelDailyPayoutBudgetUSD` | $2,000(达上限关真实奖) | — | 实时 | H4 |
| `wheelPrizeDailyCap` | $500奖5次/日·$20奖50次/日·$50券200张/日 | — | 实时 | H4 |
| `wheelRealPrizeEnabled` | 开(kill 止血) | on/off | 实时 | H4 |
| 签到 baseline / 7天 bonus | +1/日 / +5 | ≥0 | 实时 | H5 |
| Lucky 1.5× / 2× 概率 | 15% / 5%(**和≤100%,>100% 返 422,server RNG**) | 0–100% | 实时(server 裁决) | H5 |
| 断签阈值 / Streak Saver | >48h 重置 / 默认1张,恢复至 min(longest,30) | ≥24h / ≥0 张 | 实时 | H5 |
| 30 天里程碑 7 阶 | 3/+5积分·7/+15·14/+1USDT·21/+100NEX·30/Spin票·60/+10USDT·100/Badge | 奖励≥0 | 仅新达成 | H5 |
| Streak Power-Ups 4 档 | 7d Royalty Boost / 14d Premium trial / 30d +2% APY / 60d Genesis whitelist | 阈值+增益可改 | 实时 | H5(→F2/G5/G1/G4) |
| 累计里程碑 5 档(H6) | $100/+100·$500/+250·$1,000/+500·$5,000/+1,500·$10,000/+3,000 NEX | 阈值≥0 保序;奖励≥0 | 仅新 fire(不追溯) | H6 |
| 里程碑 watcher tick | 4s | ≥1s | 实时 | H6 |

### 4.12 域 I — 内容合规 CMS(出处 v4 §14 各 ③)

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| A/B 分流比例 | 均分 | 各 0–100% 和=100% | 实时(对新曝光,已分组 sticky) | I1 |
| A/B 受众定向 / 最长运行期 | 全量 / ≤90 天 | cohort/phase/locale | 仅新进实验 | I1 |
| Nova 各 channel `enabled`(kill) | 全 enabled | per channel | 实时(SSE) | I2(不入 J1) |
| Nova `tickMs`/`cooldownMs` | 10 key 现状 cadence | per cohort/phase/risk | 实时(下一 tick) | I2 |
| phase-keyed cadence | tradein 15min/P3-4 60min/P5-6 24h;task-lock 30min/P1-2 30d/P3-4 7d/P5-6 3.5d | 随 Phase | 随 Phase 切换 | I2(H1 联动) |
| `CAP_{CRITICAL,HIGH,NORMAL,LOW}` | ∞(不可降)/ 50 / 200 / 30 | 运营设定 | 实时 | I3 |
| campaign 优先级 | 按 NotifKind(system/监管→critical/high) | critical/high/normal/low | 下发时锁定 | I3 |
| 披露 `acceptedVersion` 模型 | 前端现状纯布尔→升级为 version×jurisdiction 矩阵(见第8章 #11) | 单调递增 | 发布即生效+re-ack | I5 |
| jurisdiction 判定来源 | user IP / KYC 辖区(server 边缘判) | — | 实时 | I5(C4 提供 KYC 辖区) |
| 双 gate 阅读约束 | scroll-to-bottom + checkbox | 不可弱化 | 配置即生效 | I5 |
| i18n 镜像/占位符强制 | 强制(缺镜像/不匹配→发布拦截) | — | 发布时校验 | I6 |
| 课程完成 NEX 奖励 | 10–50 NEX/课(featured 第1课 +20) | 放大流出受 B1 约束 | 实时(对新完成) | I7 |

### 4.13 域 J — 紧急合规(出处 v4 §15 各 ③)

| 参数(key) | 默认值 | 范围 | 生效时机 | 权威源 |
|---|---|---|---|---|
| 5 功能闸状态 | 全部 enabled=true | 各 enabled/disabled | 实时(确认执行后 enforce;恢复仅超管+B1 前置 422) | **J1**(各域生效面读) |
| 应急升级链兜底 | 总时限 60min / 最大 4 轮(耗尽 escalation_exhausted,永不自动放行) | 时限 15–240min / 轮数 2–10 | 改后对新应急提案 | J1 |
| `recoverGate`(恢复放行判据) | coverageRatio ≥ redLine | 权威归 B1 只读 | 实时(恢复放行前) | J1(引用 B1) |
| R1 提现激增自动熔断 | > B5 挤兑红线 `bankrunRed`(默认 40%,B5 经确认弹窗 B5-MD1 可调;分子 24h 提现申请额 / 分母 B1/D3 储备;J1 引用不另持) | — | 滑动 24h | J1(引用 B5) |
| R2 对账缺口自动熔断 | 缺口 > $50K(经确认弹窗 J1-MD4 调,仅超管) | — | 每对账周期 | J1(信号源 D1/D4) |
| R3 篡改告警转人工 | 单账户 >10 次/24h 或全域突增 | — | 滑动 24h | J1/J3 |
| geo-block `activeCountries` | 空(无封锁) | ISO 3166-1 alpha-2 | 实时(确认执行后 enforce) | **J2** |
| geo-block `limitedCountries`(受限只读档) | 空(无受限) | ISO 3166-1 alpha-2 | 实时(确认执行后生效;禁新增资金操作,登录浏览保留) | **J2** |
| 边缘 IP 判定源 | server 边缘 IP(纯 IP) | 判定源切换 | 实时 | J2 |
| 账户级篡改告警频次 | 10 次/24h(跨所有 path 合计) | 1–100 次/窗口 | 实时 | J3 |
| 监控时间窗 | {24h, 7d, 30d} | 固定窗集 | 实时 | J3 |

### 4.14 域 L — 数据 BI(出处 v4 §16;均只读视图参数,无业务杠杆)

| 参数(key) | 默认值 | 权威源 | 模块 |
|---|---|---|---|
| 八项 KPI 口径/目标 | 锁定 §2.4.6 + §18.2 | A4/§18.2(L1 不重设) | L1 |
| KPI/留存 cohort 粒度 | 注册周 YYYY-Www | A4 | L1/L2 |
| 留存口径 | Day1/7/30(app.dau) | A4 | L2 |
| 财务口径(储备/负债/覆盖率/到期) | 锁定 B1/D3/B2 | B1/D3/B2(L3 不重算) | L3 |
| 含敏感数据导出 MC | 强制开启 | L5 | L5 |
| 数据脱敏策略 | 手机号 hash/卡 token 掩码/地址行政区级;解密须 MC+事由 | L5 | L5 |
| 导出下载链接 TTL / 行数上限 | 24h / ≤100 万行(超走 split_approval) | L5 | L5 |

### 4.15 平台参数寄存器 owner-link

平台参数寄存器只做索引和导航,不复制 owner module 的权威配置表。每个参数必须有 owner domain、owner module、canonical field、read source、write route 与 owner-link。用户从参数寄存器点击 owner-link 后,必须能进入 owner 页面完成真实业务操作;例如 G1 staking APY/penalty/minStake 的写入口归 G1 owner module,寄存器只展示并跳转。

### 4.X 易混淆 / 校验铁律(开发实现必读)

1. **同名不同域参数严格区分**(详见第 0 章 §0.9):提现冷却 `withdrawCooldownDays`(D5,权威 H1)≠ 试用冷却 H2 `cooldownDays` ≠ 佣金冷却 `commission/cooling-days`(F2);大额 $1,000 三处独立(D2 人工审核 / K3 `largeAmountUsdt` / K5 `largeWithdrawReviewUsdt`);兑换三阈值权威 G2(V3),K5 仅消费。
2. **Phase 派发参数权威唯一性**(详见 §0.10):10 dial 全归 H1,生效面 PUT 收到返 422 `PHASE_PARAM_READONLY`。
3. **接口侧硬校验**(详见 §0.5):覆盖率/挤兑红黄线互锁、K4 六维和=1、staking APY 保序、salvage 月12归零、V_RANKS 保序、Lucky 概率和≤100%、转盘 weight 和=100、里程碑保序、UNILEVEL_USDT 和≤25%。
4. **server-only**:`chargeFailRate`;所有 RNG(Lucky/转盘/分红)server 裁决 + NODE_ENV guard。

## 第 5 章 状态机集(合法转移 + 守卫)

> **全局约束**:所有状态机 server-canonical,client 仅订阅、绝不本地推进;每次推进 server 校验合法转移,**非法转移返 409**;资金/资产类推进携 `Idempotency-Key`,失败保持原态、目标域无副作用;推进时 server 发 `is_server_authoritative=true` 事件。

### 5.1 D2 提现状态机(Ch6 D2,对齐 §9.3.6 / §9.11f)
- **状态集(12)**:正常 `submitted / review-passed / processing / sent / confirmed` + 后台扩展 `review-pending` + 异常 `review-rejected / address-invalid / tx-failed / tx-orphaned / refunded / frozen`
- **合法转移**:
  - `submitted → review-pending`(风控评分后 server 自动,K4;submitted 仅此转出)/ `submitted → address-invalid`
  - `review-pending → review-passed`(approve;事件 `withdraw.approved`=review-passed)/ `→ review-rejected`(reject+reason 退回余额)/ `→ frozen`(freeze)/ delay(extended-hold,到期回 review-pending,**仅此态触发**)
  - `review-passed/processing → frozen`(freeze 可在 review-pending 及之后任何在途态)/ `frozen → review-pending`(unfreeze)
  - `review-passed → processing → sent → confirmed`(链上)/ `processing,sent → tx-failed,tx-orphaned`
  - `{review-rejected,address-invalid,tx-failed,tx-orphaned} → refunded`(冻结额退回 + refund bill)
- **守卫**:approve 经确认弹窗 D2-MD1(理由必填+B1 红线预检);小额(<$1,000)执行=财务,大额(≥$1,000)执行=财务(lead)/超管;freeze/unfreeze/manual-refund-override 经确认弹窗(理由必填),执行=财务(lead)/风控(lead)/超管。K4 风险分档路由 + K3 路由结论(delay/freeze/manual)优先于小额快速通道(仅 K3=pass 才放小额)。大额进 K5 复审 → 联动 frozen。
- **事件**:`withdraw.{submitted,approved,rejected,delayed,frozen,sent,confirmed}`。

### 5.2 A2 高敏操作执行约束(Ch2 A2;原复核工单状态机已随 2026-06 操作确认决议废除)
- **执行契约**:高敏动作由操作者经业务专属确认弹窗直接调用目标域 endpoint,body 必携 `{reason}`(server 校验非空,缺失 400 `REASON_REQUIRED`,默认下限 8 字);放大资金流出方向前置 B1 覆盖率红线核验(低于红线 422 `COVERAGE_BELOW_REDLINE`)。
- **原子性**:写入与审计记录同事务落库,即时生效;资金/资产类携 `Idempotency-Key`(24h dedup);写入失败则目标域无副作用。
- **监督补偿**:审计 append-only;高敏动作落审计同时进入 A2②b 高敏操作流水(资金/大额置顶)并实时告警超管与对应域角色 lead。

### 5.3 K5 大额 KYC 复审(Ch8 K5)
- **状态集**:`triggered / in-review / passed / rejected`
- **合法转移**:`(命中四触发条件 OR)→ triggered`(largeWithdrawReviewUsdt≥$1,000 / cumulativeKycThresholdUsdt≥$100 lifetime / 兑换累计达线 / 风险分≥reviewTriggerScore 85)→ `in-review` → `passed | rejected`(确认弹窗:执行=风控(lead)/超管)
- **守卫/联动**:`triggered/in-review` → D2 frozen;`passed` → 解冻 + 回写 C4 KYC 升级;`rejected` → 维持 frozen + §9.11f 退款。同 userId 已 in-review 新命中 → 合并工单(累加 triggerReasons[]),不重复开单。
- **约束**:`/decide` 携 Key + 确认弹窗(理由必填);KYC 态权威在 C4,K5 不持状态。

### 5.4 K3 提现风控规则(Ch8 K3)
- **状态集(规则对象)**:`draft / active / paused / archived`;命中路由动作(非状态):`pass / delay / freeze / manual`
- **合法转移**:`draft → active`(MC)/ `active ⇄ paused`(MC)/ `paused → archived`;**`archived → active|paused` 禁止 → 409**
- **守卫**:多规则命中取最严(`freeze>manual>delay>pass`),同严重度按 priority。恢复历史规则须新建 draft。

### 5.5 K1 多账户簇(Ch8 K1)
- **状态集**:`detected / flagged / frozen / released / cleared`
- **合法转移**:`detected → flagged`(标记,非 MC)/ `flagged → frozen`(批量冻结,**MC**)/ `{frozen,flagged} → released`(解除误判,MC)/ `detected → cleared`(命中 IP 白名单自动;人工判定走 MC)
- **守卫**:`linkStrength ≥ clusterFreezeSuggestThreshold`(0.7)→ 标红+建议(冻结经确认弹窗 K1-MD1,理由必填)。`/freeze` 携 Key,server 原子置各账户 frozen。
- **注**:K4 风险分为连续值(0–100),非状态机;scoreBand 是路由守卫阈值,K4 不执行处置。

### 5.6 E4 订单状态机(Ch10 E4,对齐 §7.4 / §9.11f)
- **状态集**:正常 `placed / paid / provisioning / activated`;失败 `payment_failed`(终态)/ `expired / refunded / chargeback / provisioning_failed`
- **合法转移**:`placed → paid`(写 D4 bill)/ `placed → payment_failed`(**终态,须重新下单**)/ `placed → expired`(超时,时窗见第7章)/ `paid → provisioning → activated`(关联 deviceId)/ `provisioning → provisioning_failed` / `{paid,provisioning,activated} → refunded`(MC)/ `paid → chargeback`(PSP 回调)
- **守卫**:`relatedOrderId` server 校验原单 payment_failed 终态+userId 一致否则 400(`POST /api/orders`);取消退款=MC。
- **约束**:订单 ID server mint;`/refund` MC+Key,单事务联动 D1 退款+D4 冲正+`cumulativeDepositUsdt` 核减。**GMV 以 order.paid 去重为权威,payment_failed 不计**。
- **注**:E3 设备效率为连续值(100%→0.22 floor),非状态机;曲线变更仅影响下次快照,不追溯历史收益。

### 5.7 F1 V-Rank 晋升(Ch11 F1,13 阶 V0–V12)
- **状态集**:`V0 … V12`
- **合法转移**:晋升 `V(n) → V(n+1)`(server 在被动评估触发点 re-check;条件 **AND 复合**,各阶组合不一)/ 手动晋升回滚 `V(x) → V(y)`(确认弹窗 F1-MD1,理由必填;执行=增长运营(lead)/超管)/ **不降级**(vRankPermanent=true,唯一例外账户注销)
- **约束**:`/vrank/override` 携 Key + MC 两步,server 原子置 V 级并联动版税/票数/可见性;client 显示对但 server 可 reject(anti-abuse/race)是产品契约;改门槛不回溯已晋升者。

### 5.8 G1 Staking position(Ch12 G1,对齐 §9.6)
- **状态集**:`pending_lock / active / mature_unclaimed / claimed`;旁路 `early_withdrawn / slashed / refunded`
- **合法转移**:`pending_lock → active`(锁仓确认)/ `→ refunded`(失败退本)/ `active → mature_unclaimed`(到期未领)/ `{mature_unclaimed,active} → claimed` / `active → early_withdrawn`(扣 penalty+forfeit 利息)/ `{active,mature_unclaimed} → slashed`(单档 kill 后处置)
- **守卫/并发**:claim 与 slashed(单档 kill)竞态 → **kill 锁定优先**,进 slashed 后并发 claim 返 409;改 APY/penalty 对 in-flight 按开锁锁定值结算(不追溯)。
- **约束**:claim 携 Key;升 APY/降 penalty 核 B1 422;跨档保序违反 422。

### 5.9 G6 NEX v2 锁仓 / G7 复投 / G2 兑换 / G4 Genesis / G5 Premium(Ch12)
- **G6 NEX v2**:`pending_lock → locked`(24 月,月度结算入 bills)/ `→ refunded` / `locked → matured`(matureValue=amount×6)/ `locked → early_forfeit`(forfeit 100% accrued premium)。竞态以 server 终态为准(409)。
- **G7 复投**:复用 G1 状态机 `pending_lock → active(90d)→ mature_unclaimed → claimed`;旁路 `early_withdrawn`(罚本金 15%+forfeit)。事件 `staking.opened(product=repurchase)`。
- **G2 兑换单**:`submitted → {gated(子类 geo-blocked) | queued | swapped}` / `queued → {swapped | cancelled}`。新增 geo_block 对已 queued 单按锁定优先转 cancelled(本金不被单方面锁定)。
- **G4 Genesis 节点**:`minted → held`(持有计分红)/ `held → listed`(二级挂单)/ `listed → sold`(扣 2.5% 版税,**分红跟随新持有者**);日分红 00:00 UTC 批次。一二级支持 pause(J1 genesis 闸)。
- **G5 Premium**:`none → subscribed`(首月折扣)/ `→ renewed` / `{subscribed,renewed} → cancelled`(7 天退款窗内退/窗外止续)。
- **注**:G3 NEX 行情为连续值,仅引擎 `running ⇄ paused`(暂停时现价冻结),非用户对象状态机。

### 5.10 H2 Trial 7 态(Ch7 H2,§9.11.1 权威)
- **状态集(7)**:`idle / active / grace / extended / redeemed(终)/ failed(终)/ cancelled(终)`
- **合法转移**:`idle → active`(server canStart() 前置:冷却内/phaseOpen=false 拒)/ `active → grace`(shadow 冻结)/ `active,grace → extended`(highQualityThresholdUSD)/ `active,grace,extended → redeemed`(redeem-early 主动 + auto-charge 自动两路径;shadow 经 computeTrialOffset 拆分)/ `→ failed`(扣款失败,shadow 归零不入账)/ `→ cancelled`(取消,强制取消=MC)
- **约束**:扣款(含强制 charge)经 PSP 携 Key;`chargeFailRate` server-only;shadow active/grace/extended 仅 UI display 不写账本;循环养号联动 K2 阻断。

### 5.11 H3 Quest / H4 活动 / H5 签到 / H6 里程碑(Ch13)
- **H3 Day-One**:`active(0–24h·500NEX)→ grace(24–72h·200NEX)→ expired(72h+·0)` / `{active,grace} → claimed`(全 6 任务,creditNex+badge)。Weekly 按 weekKey reset;Monthly 跨月清。
- **H4 活动**:`upcoming → ongoing → ended`(时窗);trackable 用户 `(未join)→ joined → done → claimed`。Lucky Spin server RNG+NODE_ENV guard;日上限 `eventId×userId×spinDate` 超额 409;B1 红线自动降级(只发 NEX/积分/券)。
- **H5 签到**:`signed_today →(次日)pending → signed` / `signed → broken`(>48h 归 0)/ `broken → restored`(耗 1 Saver,恢复 min(longest,30));里程碑 `locked → claimable → claimed`。
- **H6 累计里程碑**:`unfired → fired`(跨阈自动 creditNex+overlay);一次 fire 一档(watcher 4s 串行);firedIds server 记录不重触发;自动派 NEX 携 Key(milestoneId×userId 去重)。

### 5.12 I 内容 / J 应急(Ch14 / Ch15)
- **I1 文案 A/B**:版本 `draft → published(MC)→ archived`(回滚=重发历史版,MC);实验 `scheduled → running → concluded(adopted|discarded)`。分组 assignment server 权威,已分组 sticky。
- **I5 风险披露**:版本 `draft → published(per jurisdiction,MC,改版强制 re-ack)→ superseded`;用户 ack `not_acked → acked → stale`(发布新版/jurisdiction 变更触发)。client 检测 acceptedVersion 落后或 jurisdiction 变 → 强制 re-prompt,不可本地置 accepted。
- **I2 Nova**:channel `enabled ⇄ disabled`(kill);模板 `draft → published → archived`(MC)。
- **I3 通知 campaign**:`draft → scheduled → sending → sent`;任一态 `→ cancelled`;调度下发=MC;优先级 in-place 升级 server emit canonical。
- **I4 信任 / I6 i18n / I7 课程**:内容版本 `draft → published → archived`(I4 财务/NEX 叙事须合规审查,发布经确认弹窗;I6 发布前镜像+占位符 gate;I7 featured set⇄unset 单位互斥)。
- **J1 功能闸**:闸 `enabled ⇄ disabled`;提案 `pending_approval → approved|rejected`;应急 `pending_approval[emergency] → escalating`(N min 未放行自动升级,工单维持 pending 不自动放行)`→ approved|rejected`,升级耗尽 → `escalation_exhausted`(终态,永不自动放行);恢复(前置 B1 闸)未达覆盖率 → `blocked_by_coverage`(409+快照)。批量熔断逐闸独立生效(非原子),返 status[]。
- **J3 篡改告警**:`normal → flagged`(超频次)→ `escalated`(喂 K4+B5);纯只读监控,处置跳 K 域。

### 5.13 状态机 — PRD 未完整定义 / 已声明偏差(开发须知)
- **D2 `review-pending`**:§1.9 仅列正常 5 态,review-pending 为后台扩展;`withdraw.approved`↔`review-passed` 命名映射须 A4 registry 确认。
- **E4 订单过期时窗**(placed→expired):**未定义**(建议 15–30min,V2 PM 确认)。`order` domain 未注册,过渡用 `checkout.order_*`。
- **E4 `cumulativeDepositUsdt` 退款逆向写权归属**:**未定义**(拟 D4 recordDeposit(-amount),V2 与 D1/D4 对齐)。
- **H2 `autoChargeAtEnd` 实时性**:**未定义**(暂按仅新 trial,待 PM)。
- **K5 region escalation**:V1 不实现(待回源)。
- **里程碑事务边界**:§9.11e 表未含 milestone 行,V4 收口补。
- **连续值非状态机**:K4 风险分 / E3 设备效率 / G3 行情(分档阈值是路由守卫,非状态转移)。

## 第 6 章 RBAC 权限矩阵(角色 × 高敏动作)

> 七角色(§1.1 / A1③):**超管 / 风控 / 财务 / 增长 / 客服 / 只读审计**(第 7 角色「内容」仅 I 域内容 CMS 高敏发布动作,无资金/资产/规则/熔断高敏写,不列入本表)。**层级**:「财务(lead)」=财务主管、「风控(lead)」=风控主管——2026-06 操作确认决议后,原复核层级统一迁移为**执行门槛**:标 (lead) 的动作仅该角色 lead 层级(及超管)可执行,member 不可执行。**K 域旧命名映射**:平台管理员→超管、风控运营→风控(member)、审计员→只读审计。单元格 ✅=可执行(经该动作确认弹窗+理由必填即时生效)/ 读=只读 / —=无权。「确认弹窗」列=是否高敏(入 A2③ 清单:确认弹窗+reason 强制 400+高敏流水/实时告警;放大流出方向另前置 B1 红线 422);弹窗 ID 细则见各卷 PRD ④a 与本规格第 9 章总表。

| 高敏动作 | 超管 | 风控 | 财务 | 增长 | 客服 | 审计 | 确认弹窗 | 模块 |
|---|---|---|---|---|---|---|---|---|
| 创建/禁用/启用运营账号 | ✅(仅超管) | — | — | — | — | — | 是(理由必填;禁用超管前校验≥2) | A1 |
| 分配/变更账号角色 / 变更 RBAC 授予 | ✅(仅超管) | — | — | — | — | — | 是(权限边界=最高敏,理由必填) | A1 |
| 重置运营账号 2FA | ✅(仅超管) | — | — | — | — | — | 是(理由必填+身份核实勾选) | A1 |
| 强制登出运营 session | ✅(仅超管) | — | — | — | — | — | 是(理由必填,止血即时) | A1 |
| 审计/埋点 schema 变更 | ✅(仅超管) | — | — | — | — | — | 是(A2-MD1,理由必填) | A2 |
| 审计日志查询/导出 | ✅(全) | 读(风控/账户) | 读(资金) | 读(增长) | 读(单用户) | ✅(全量脱敏) | 否(只读) | A2 |
| feature flag 切换 | ✅(全部 flag) | — | — | ✅(限增长/AB 类) | — | — | 是(理由必填;server 按 flag 分类校验资质) | A3 |
| **kill-switch 熔断(止血方向)** | ✅ | ✅ | ✅(资金止血) | — | — | — | 是(理由必填+触发依据;即时生效+广播) | A3→J1 |
| **kill-switch 恢复(放大方向)** | ✅(仅超管) | — | — | — | — | — | 是(理由必填+B1 红线预检 422) | A3→J1 |
| **geo-block 国家级屏蔽** | ✅ | ✅ | —(财务不参与) | — | — | — | 是(理由必填) | A3→J2 |
| 覆盖率红黄线 / 挤兑阈值 | ✅ | ✅(lead,挤兑阈值) | ✅(lead,覆盖率阈值) | — | — | — | 是(理由必填;放松方向警示) | B1/B5 |
| 储备注入 / 对账核销 | ✅ | — | ✅(lead) | — | — | — | 是(理由必填+Idempotency-Key) | B1/D3/D1 |
| **充值 PSP 退款 / chargeback / 渠道启停** | ✅ | — | ✅(lead) | — | — | — | 是(理由必填) | D1 |
| **提现放行(小额 <$1,000)** | ✅ | — | ✅ | — | 读(受限) | 读 | 是(D2-MD1,理由必填+B1 红线预检) | D2 |
| **提现放行(大额 ≥$1,000)** | ✅ | — | ✅(lead) | — | — | — | 是(D2-MD1+大额确认勾选;超阈不可批量自动放行) | D2 |
| 提现 reject / delay | ✅ | ✅ | ✅ | — | — | — | 是(理由必填) | D2 |
| 提现 freeze / unfreeze / manual-refund-override | ✅ | ✅(lead) | ✅(lead) | — | — | — | 是(理由必填) | D2 |
| 提现参数(日限/上限/网络费) | ✅ | — | ✅(lead) | — | — | — | 是(理由必填;放宽方向 B1 预检) | D5 |
| **余额调整 ≤$500 / >$500** | ✅ | — | ✅(>$500 用 lead) | — | ✅(≤$500) | — | 是(理由必填;加余额方向 B1 预检) | C3 |
| 积分调整 | ✅ | — | ✅(lead) | ✅ | ✅ | — | 是(理由必填;走 points 字段,不入 D4) | C3 |
| **账户冻结/解冻(单用户)** | ✅ | ✅(lead) | ✅ | — | — | — | 是(理由必填;联动 D2 frozen) | C2 |
| **impersonate(模拟登录)** | ✅ | ✅(lead) | — | — | ✅ | — | 是(理由必填;只读+≤30min+全审计) | C2 |
| 账户加白/拉黑(userId 级) | ✅ | ✅(lead) | — | — | — | — | 是(理由必填) | C2 |
| 人工标记/撤销 KYC | ✅ | ✅(lead) | — | — | 发起请求单(不具执行权) | — | 是(理由必填;执行=风控 lead/超管) | C4 |
| disable 2FA / 密码重置 / 解除锁定 | ✅ | ✅(lead) | — | — | ✅(部分) | — | 是(理由必填+KYC 二验防社工) | C5 |
| 注册/登录风控参数 | ✅ | ✅(lead) | — | — | — | — | 是(理由必填) | C6 |
| **批量冻结关联账户簇** | ✅ | ✅(lead) | — | — | — | — | 是(K1-MD1,理由必填+Key;冻结态落 C2) | K1 |
| **风险评分模型权重/分档** | ✅(仅超管,发布) | 起草草稿(lead,不生效) | — | — | — | — | 是(K4-MD1,理由必填;六维和=1 违 422) | K4 |
| 单用户风险评分覆盖 | ✅ | ✅ | — | — | — | — | 是(K4-MD2,理由必填;非高敏不入流水告警) | K4 |
| 大额 KYC 复审裁决 | ✅ | ✅(lead) | — | — | — | — | 是(理由必填;态落 C4) | K5 |
| 提现风控规则引擎配置 | ✅ | ✅(lead) | — | — | — | — | 是(理由必填) | K3 |
| **Phase dial 改动/pin/cohort override** | ✅(全部;放大流出方向 dial 仅超管) | — | — | ✅(非放大方向) | — | — | 是(理由必填;放大方向弹窗强制覆盖率预检) | H1 |
| Trial 敏感参数 | ✅ | — | — | ✅(lead) | — | — | 是(理由必填) | H2 |
| 兑换三阈值 caps/gate | ✅ | ✅(lead) | ✅(lead) | — | — | — | 是(理由必填;放宽方向 B1 预检) | G2 |
| Staking APY/罚款/单档 kill | ✅ | ✅(lead,kill 止血) | ✅(lead,参数) | — | — | — | 是(理由必填;APY 调升 B1 预检;单档 disable 归 G1,不入 J1) | G1 |
| Genesis 经济(单价/分红率/pause/geo) | ✅(分红率仅超管) | ✅(lead,pause/geo) | ✅(lead,其余参数) | — | — | — | 是(理由必填;分红率放大负债前置 B1) | G4 |
| 佣金事件撤销/补发/暂停 | ✅ | ✅(lead) | ✅(lead,联动 D 退回) | — | — | — | 是(理由必填;补发方向 B1 预检) | F5 |
| 网络版税费率 / Partner Status | ✅ | ✅(lead) | ✅(lead) | ✅(增长侧) | — | — | 是(理由必填;调升 B1 预检,应付负债来源) | F2 |
| 风险披露版本切换 + 强制 re-ack | ✅ | ✅(lead,合规) | — | — | — | — | 是(I5-MD1,理由必填;合规关键,非熔断闸) | I5 |
| 监管点名应急 SOP 编排执行 | ✅ | ✅(lead) | — | — | — | — | 是(J4-MD3,理由必填+触发事由;逐步经各域弹窗,串联 J1/J2/I5/C2/K1/D2/I3) | J4 |
| **数据导出/监管报告(含敏感)** | ✅(超限/解密仅超管) | ✅(lead,风控域) | ✅(lead,资金域) | — | — | ✅(全量脱敏) | 是(理由必填;数据出境=敏感,脱敏+审计) | L5 |

## 第 7 章 未决项清单(开发/上线阻塞点)

> 散落原 PRD 的「待 PM / 待开发 / 待对齐 / TBD」开放问题统一收口于此。**开发不得自行硬编**;阻塞项须先决策。

| # | 未决项 | 涉及模块 | 阻塞什么 | 需谁决策 | 出处§ |
|---|---|---|---|---|---|
| 1 | `autoChargeAtEnd` 实时性与敏感等级未定(§9.11b 两清单均未列;暂按敏感项经确认弹窗) | H2 Trial | 开发:无法接线操作路径与生效说明 | PM | v1 §H2③④ |
| 2 | Phase「月 0」是否并入月 1 未定(§6.4 无显式定义) | H1 | 开发:月 0 dial 取值不可视为权威 | PM | v1 §6.4 dial 表 |
| 3 | 双轨较大侧未匹配处置 `unmatchedSurplusDisposition`(累积下周期 vs 备付金)未裁定 | F3 | **V2 落地阻断**:裁定前不固化处置、不开放写入 | PM(V2 gate) | v2 §F3③⑦ |
| 4 | `binaryTrackMinUsd` 两轨门槛结算路径前端自相矛盾(§8.4.1 当月归零 vs §8.4.0.2 pending+批量) | F3 | V2:后台结算逻辑不得先行硬编 | PM(V2)+对齐前端 | v2 §F3③ |
| 5 | `commission/cooling-days` 佣金冷却权威归属未定(F2 自持 / D5 共享 / commission 引擎) | F2 / D5 | V2:直接影响 F2⑤ 写接口(归 D5 则退化只读)+ B2 冷却负债取数 | 对齐 D5/D2 + PM | v2 §F2③④⑤ |
| 6 | `commission.paid` 的 `kind` 命名 `network` vs `unilevel` 二选一未定(前端 §12.5 用 unilevel) | F2/F3/F4/F5/F4d | **V2 A4 注册 blocking**:F5⑧/F4d⑧ 不能定稿 | 对齐前端 + A4 | v2 §F5⑧ |
| 7 | 排行榜派奖事件 `leaderboard.prize_paid` vs 复用 `commission.paid(kind=leaderboard_prize)` 未定 | F5 / F4d | V2:避免非佣金派发混入 commission 语义 | 对齐前端 + A4 | v2 §F5⑧/F4d⑧ |
| 8 | `cumulativeDepositUsdt` 退款逆向核减写权归属未确认(E4 拟 D4 recordDeposit(-amount),D1⑦ 仅定义正向) | E4 / D1 / D4 | **V2 落地阻断**:E4 不可单方声明 D4 写行为 | 对齐 D1/D4 | v2 §E4⑤⑦ |
| 9 | Gen-2 SKU(Pro v2 / Rack P2)购买 eligibility 待补录(当前 server 空值兜底 deny-all) | E3 / E1 | **阻塞**:代际发布门打开前必须完成,否则「门开+规则空→任意可购」套利窗 | PM 补录 | v2 §E3③④ / §E1⑤ |
| 10 | Cloud Share Premium(§3.3 月 10 新品)SKU 治理(独立 SKU vs 原地 tier 升级)未定 | E1 / E1 | 阻塞:当前 7 管理对象未涵盖,落地路径分叉 | PM | v2 §E1① |
| 11 | Day-One quest 改窗对在窗用户相位语义二选一未落地(方案 A per-instance 快照 vs 方案 B 全局即时重算) | H3 | 开发:须二选一定接口契约(是否持久化窗快照) | PM / 开发 | v3 §H3⑦ |
| 12 | `MAX_DEVICES` 是否参数化开放未定(V2 写死=6) | E5 | 不阻塞 V2;V4 评估 | PM(V4) | v2 §E5③ |
| 13 | 激活 auto-prompt 延迟取值待定 | E5 | 低优:激活引导时机 | PM / 开发 | v2 §E5③ |
| 14 | D2 批量小额 approve/reject/delay 的幂等要求未明确(2026-06 操作确认决议后 A2 复核端点已废除,仅余 D2 批量端点待明确) | D2 | 开发接口契约缺口 | 开发(回源 D2) | v1 §3.x API 表 |
| 15 | C3 调 points 后对 D2 在途申请是否触发门槛实时重判未确认 | C3 / D2 | 开发缺口:否则退化为「下次提现实时读 points」 | 回源 D2 | v1 §C3⑦ |
| 16 | C3 双事件 `admin.balance_adjusted` vs `admin.bill_adjusted` 分工未对齐 D4 落地文本 | C3 / D4 | 开发缺口:影响 A4 registry + L3/A2 去重 | 对齐 D4 + A4 | v1 §C3⑧ |
| 17 | C5 step-up auth 时限「可配」能力未确认(前端现状硬编码 7 天) | C5 | 开发缺口:若 server config 不可行则降为 V1 只读 | 开发确认 | v1 §C5③ |
| 18 | F4 领导奖池头部集中度护栏 `top1MaxPct`/`top5MaxPct` 为编辑自设,未经 PM 确认 | F4 | **V2 阻断** | PM(V2 gate) | v2 §F4③⑦ |
| 19 | ✅ 应急熔断执行模型 — **2026-06 操作确认决议**(取代 2026-06-02 裁定):熔断=授权角色单人确认+广播+审计,恢复=仅超管+B1 前置;emergency.breakglass 权限位不登记(确认契约已覆盖) | J 域 | 已闭环(2026-06-11) | PM(已决) | v1 附录 A.2 #18 |

## 第 8 章 现状↔目标差异表(相对前端现状要改什么)

> 仅列前端现状值 ≠ PRD 目标值、开发需改的项(「12 月未覆盖→前端现状即目标」的等值参数已排除)。标 **✅** 为 PM 已裁定,保留供开发对照「改成什么 + 前端订正方向」。

| # | 参数/口径 | 现状值(前端/代码) | 目标值(PRD) | 所属模块 | 出处§ |
|---|---|---|---|---|---|
| 1 | Phase dial 数量 | §13.4.1=7-dial;§9.11c.1/§9.11d.3=8-dial | 后台权威 **10-dial**(前端须补 newUserBonusMultiplier+questBonusMultiplier) | H1 / B4 | v1 附录 A.1 #1 / §1.7 |
| 2 | 双轨日封顶 `binaryDailyCap` | 前端 §8.4 固定 $5,000 | Phase 派发:月1–6=$5,000 / 月7+=$2,000(权威 H1) | F3 / H1 | v1 附录 A.1 #2 |
| 3 | 提现冷却 `withdrawCooldownDays` | §13.4.1 缺月 8=35d 中间档 | 月1–7=30d / **月8=35d** / 月9+=45d | D5 / H1 | v1 附录 A.1 #3 |
| 4 | Genesis 每日分红率 | §10.1=0.1% vs §10.3=1.5%(15× 矛盾) | **✅ 0.1%/日**(PM 2026-06-01);前端 §10.3 笔误待订正 | G4 / B2 / D3 | v1 附录 A.1 #5 |
| 5 | 抽奖转盘奖池文案 | events.ts 含「win $1–$500 或 a Genesis Node」 | **✅ Genesis 不进转盘**;删「or a Genesis Node」 | H4 | v1 附录 A.1 #8 |
| 6 | KPI 章节序号引用 | 前端 §17/§18.2 混排;SKILL 写 §17.2 | 八项 KPI 统一引 **§18.2** | L1 / 全局 | v1 附录 A.1 #4 |
| 7 | 前端文档编号/计数瑕疵簇 | §14 误编 §15.x;§11.3「14 section」vs 13 行;§11.0A 缺 wrapped 行 | 后台按逻辑号/正确计数落地(I2/I4/I6 已对齐) | I2/I4/I6 | v1 附录 A.1 #6 |
| 8 | Pro 设备 salvage 计算基价 | 原型 `DEVICE_PRICE_USDT["stellarbox-pro"]=2639`(salvage 偏高约 $240) | salvage 须以 Pro Gen-1 权威定价 **$2,399** 为基价 | E3 / E1 | v2 §E3③ |
| 9 | SKU 数量口径 | V1 §3.2 E1「6 SKU」 | **7 个管理对象**(补 Pro v2 / Genesis 目录位) | E1 | v2 §E1① |
| 10 | 风险披露 ack 数据模型 | 前端纯布尔 `{accepted,acceptedAt}` | version × jurisdiction 双维矩阵,发布触发 re-ack | I5 | v4 §I5③ |
| 11 | 披露页 gated action 拦截范围 | /me/wallet/withdraw 已实装;staking/nex-v2-lock 为规划集成点 | 三类 gated action 全部前置守卫接线 | I5 / G1 / G6 | v4 §I5③ |
| 12 | 低优先级通知 `CAP_LOW` | 前端保留 30 条 | 真后台对接后改 24–48h TTL 自动淘汰 | I3 | v4 §I3 |
| 13 | B1 兑付覆盖率红线拒绝码 | V1 卷 B1 原用 **403** | **✅ 全卷统一 422**(PM 2026-06-02;auth/authz 类 403 保持) | B1 / 全 G 域写 | v1 附录 A.2 #11 |
| 14 | `binaryDailyCap` 技术字段名 | §6.4/前端 = `binaryDailyCap`(无后缀) | admin 引用写 `binaryDailyCapUSD`(指同一 dial,不另立) | F3 / H1 | v1 §6.4 字段名注 |
| 15 | Premium gate 字段名 | 前端 store = `premiumSubscriptionAvailable`(长名) | §6.4/H1 = `premiumSubAvailable`(短名);对接须映射 | G5 | v3 §G5③ |
| 16 | `questBonusMultiplier` 实装状态 | 前端**未实装**(PHASES 无此 dial) | 月1–2=4×/其他=1×(H1 下发,未下发取 1×) | H3 / H1 | v3 §H3③ |
| 17 | `commission.paid` kind 值 + layer 属性注册 | 前端 §12.5 用 `unilevel`;layer(L1–L7)未登记为聚合维度 | A4 统一 kind 值 + 登记 layer 为可聚合维度(KPI #7 锚点) | F2/F5 / A4 | v2 §F5⑧(与未决项 #6 互指) |

---

## 第 8A 章 全后台列表能力基线

- 数据列表必须提供分页或显式小表豁免。
- 默认五件套:pagination、search、filter、sort/status、empty state。
- 小表豁免只允许用于固定短列表、配置摘要、KPI 摘要;豁免必须在页面或规格中声明理由。
- 资金、提现、账单、工单、用户、审计、内容记录类列表不得豁免分页。

## 第 9 章 弹窗交互规格总表(开发索引)

> 2026-06 操作确认决议产物。全后台高敏动作的确认弹窗清单——**细则权威在各卷 PRD 对应模块的「④a 交互与弹窗规格」段**(触发控件/布局分区/输入控件表/错误态/成功反馈),本表仅作开发索引与完整性对账。弹窗 ID = `{模块ID}-MD{n}`,全 PRD 唯一。
>
> **治理约定**:① 新增高敏动作须同步「该模块 ④ 表确认弹窗列 + ④a 弹窗规格 + A2③ 高敏动作清单 + 本表」四处;② 弹窗容器统一复用基础 Modal/Drawer,**弹窗内容逐弹窗按业务单独设计,禁止回退到单一共享确认弹窗组件**;③ 所有弹窗 reason 必填(server 强制非空 400 `REASON_REQUIRED`,默认下限 8 字);④ 「B1 预检」列=是 的弹窗必含影响预览区(server 预检拟生效后覆盖率,低于红线 422 `COVERAGE_BELOW_REDLINE` 且确认钮置灰)。


### 9.1 A 平台基础

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| A1-MD1 | 创建运营账号 | — | v1 A1④a |
| A1-MD2 | 禁用运营账号 | — | v1 A1④a |
| A1-MD3 | 启用运营账号 | — | v1 A1④a |
| A1-MD4 | 变更角色 | — | v1 A1④a |
| A1-MD5 | 重置运营账号 2FA | — | v1 A1④a |
| A1-MD6 | 强制登出 session | — | v1 A1④a |
| A2-MD1 | 审计/埋点 schema 变更确认 | 是 | v1 A2④a |
| A3-MD1 | feature flag 切换确认 | — | v1 A3④a |
| A3-MD2 | kill-switch 功能闸熔断确认 | — | v1 A3④a |
| A3-MD3 | kill-switch 功能闸恢复确认 | 是 | v1 A3④a |
| A3-MD4 | geo-block 国家列表配置 | — | v1 A3④a |

### 9.2 B 总览驾驶舱

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| B1-MD1 | 兑付覆盖率阈值配置 | — | v1 B1④a |
| B1-MD2 | 手动储备注入登记 | — | v1 B1④a |
| B2-MD1 | 预测参数配置 | — | v1 B2④a |
| B5-MD1 | 挤兑阈值配置 | 是 | v1 B5④a |

### 9.3 C 用户与账户

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| C2-MD1 | 冻结账户确认 | — | v1 C2④a |
| C2-MD2 | 解冻账户确认 | — | v1 C2④a |
| C2-MD3 | 强制登出确认 | — | v1 C2④a |
| C2-MD4 | 发起 impersonate(代入会话) | — | v1 C2④a |
| C2-MD5 | 加白(信任名单) | — | v1 C2④a |
| C2-MD6 | 拉黑(禁入名单) | — | v1 C2④a |
| C3-MD1 | 余额调整确认(USDT / NEX) | 是 | v1 C3④a |
| C3-MD2 | 积分调整确认 | 是 | v1 C3④a |
| C4-MD1 | 人工标记 KYC verified | — | v1 C4④a |
| C4-MD2 | 撤销 KYC | — | v1 C4④a |
| C5-MD1 | 指定会话下线确认 | 多载体 session;理由必填 + A2 审计 | v1 C5④a / 三端 SPEC-4 |
| C5-MD2 | 人工 disable 2FA | — | v1 C5④a |
| C5-MD3 | 密码重置确认 | — | v1 C5④a |
| C5-MD4 | 解除账户锁定 | — | v1 C5④a |
| C6-MD1 | OTP 配置变更 | — | v1 C6④a |
| C6-MD2 | 登录锁定配置变更 | — | v1 C6④a |
| C6-MD3 | CAPTCHA 开关 / 阈值变更 | 是 | v1 C6④a |

### 9.4 D 资金与财务

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| D1-MD1 | 充值渠道启停确认 | — | v1 D1④a |
| D1-MD2 | 主备 PSP 切换确认 | — | v1 D1④a |
| D1-MD3 | chargeback 退款确认 | — | v1 D1④a |
| D1-MD4 | 对账差异核销确认 | — | v1 D1④a |
| D2-MD1 | 提现放行确认 | 是 | v1 D2④a |
| D2-MD2 | 提现拒绝确认 | — | v1 D2④a |
| D2-MD3 | 提现延迟(extended-hold)确认 | — | v1 D2④a |
| D2-MD4 | 提现资金冻结确认 | — | v1 D2④a |
| D2-MD5 | 提现解冻确认 | 是 | v1 D2④a |
| D2-MD6 | 手动退款覆盖确认 | — | v1 D2④a |
| D2-MD7 | 批量操作确认 | 是 | v1 D2④a |
| D3-MD1 | 口径配置确认 | — | v1 D3④a |
| D3-MD2 | 手动储备注入登记确认 | — | v1 D3④a |
| D4-MD1 | 账单调整 / 手动 refund 确认 | 是 | v1 D4④a |
| D5-MD1 | 提现参数变更确认(日限额 / 余额上限 / 网络费) | 是 | v1 D5④a |

### 9.5 E 设备与商城

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| E1a-MD1 | 上下架 SKU 确认 | — | v2 E1a④a |
| E1a-MD2 | 调定价确认 | — | v2 E1a④a |
| E1a-MD3 | 调套餐折扣 ladder 确认 | 是 | v2 E1a④a |
| E1b-MD1 | 调代际发布月确认 | — | v2 E1b④a |
| E1b-MD2 | 强制解锁 SKU 确认 | — | v2 E1b④a |
| E1b-MD3 | 调 tradeinDiscount 确认 | — | v2 E1b④a |
| E2-MD1 | 热更任务定价确认 | — | v2 E2④a |
| E2-MD2 | 调 QUEUE_SATURATION 确认 | — | v2 E2④a |
| E2-MD3 | 调 minVRAM 路由门槛确认 | — | v2 E2④a |
| E2-MD4 | 紧急下架 / 恢复任务类确认 | — | v2 E2④a |
| E3a-MD1 | 调衰减曲线确认 | — | v2 E3a④a |
| E3a-MD2 | 调 MIN_EFFICIENCY floor 确认 | — | v2 E3a④a |
| E3a-MD3 | 调豁免类型确认 | — | v2 E3a④a |
| E3a-MD4 | 调任务锁定损失阈值确认 | — | v2 E3a④a |
| E3b-MD1 | Trade-in 全局开关确认 | — | v2 E3b④a |
| E3b-MD2 | 调 salvage 残值参数确认 | — | v2 E3b④a |
| E3b-MD3 | 调 minHoldingMonths 确认 | — | v2 E3b④a |
| E3b-MD4 | 调 eligibility 规则确认 | — | v2 E3b④a |
| E3b-MD5 | 补录 Gen-2 eligibility 确认 | — | v2 E3b④a |
| E3b-MD6 | 调 promo 节奏确认 | — | v2 E3b④a |
| E3b-MD7 | 调 inventory.softMax 确认 | — | v2 E3b④a |
| E4-MD1 | 取消并退款确认 | 是 | v2 E4④a |
| E5-MD1 | 强制激活设备确认 | — | v2 E5④a |
| E5-MD2 | 强制解绑设备确认 | 是 | v2 E5④a |
| E6-MD1 | 电脑共享算力入口开关确认 | — | v2 E6④a |
| E6-MD2 | 在线加成系数调整 | — | v2 E6④a |
| E6-MD3 | 显卡档位编辑 | — | v2 E6④a |
| E6-MD4 | 显卡识别词编辑 | — | v2 E6④a |
| E6-MD5 | 客户端下载地址配置 | — | v2 E6④a |
| E6-MD6 | 下载页双语文案编辑 | — | v2 E6④a |

### 9.6 F 分销与团队

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| F1-MD1 | 手动晋升 / 回滚 V 级确认 | — | v2 F1④a |
| F1-MD2 | 编辑 V 级阶梯配置确认 | 是 | v2 F1④a |
| F1-MD3 | 实物奖品发货审核确认 | — | v2 F1④a |
| F1-MD4 | 补发 / 撤销培育奖 NEX 确认 | 是 | v2 F1④a |
| F2-MD1 | 调 L1–L7 费率 / NEX 系数确认 | 是 | v2 F2④a |
| F2-MD2 | 调 Partner Status 门槛 / 权益确认 | — | v2 F2④a |
| F2-MD3 | 设 / 撤 promotion 周倍率确认 | 是 | v2 F2④a |
| F2-MD4 | 暂停 / 恢复某层结算确认 | — | v2 F2④a |
| F2-MD5 | 调佣金冷却天数确认 | 是 | v2 F2④a |
| F3-MD1 | 调匹配比例确认 | 是 | v2 F3④a |
| F3-MD2 | 补发 / 纠错 Balance Match 确认 | 是 | v2 F3④a |
| F3-MD3 | 调两轨门槛 / 自动分配规则确认 | 是 | v2 F3④a |
| F3-MD4 | 暂停 / 恢复双轨结算确认 | 是 | v2 F3④a |
| F4-MD1 | 手动注入奖池确认 | 是 | v2 F4④a |
| F4-MD2 | 提前结算周池确认 | — | v2 F4④a |
| F4-MD3 | 调奖池配置确认 | 是 | v2 F4④a |
| F4b-MD1 | 覆盖单用户解锁资格 | — | v2 F4b④a |
| F4b-MD2 | 调月库存上限 | — | v2 F4b④a |
| F4b-MD3 | 调解锁条件 | — | v2 F4b④a |
| F4b-MD4 | 暂停 Rack 解锁 | — | v2 F4b④a |
| F4c-MD1 | 审批通过预算申请 | 是 | v2 F4c④a |
| F4c-MD2 | 拒绝预算申请 | — | v2 F4c④a |
| F4c-MD3 | 调区域预算配额 | — | v2 F4c④a |
| F4c-MD4 | KOL 发票核验 | 是 | v2 F4c④a |
| F4d-MD1 | 补发 / 纠错当期奖励 | 是 | v2 F4d④a |
| F4d-MD2 | 取消刷榜资格 | — | v2 F4d④a |
| F4d-MD3 | 暂停榜单 | — | v2 F4d④a |
| F4d-MD4 | 追加奖池 | 是 | v2 F4d④a |
| F5-MD1 | 单笔佣金撤销确认 | — | v2 F5④a |
| F5-MD2 | 批量补发异常佣金确认 | 是 | v2 F5④a |
| F5-MD3 | 暂停用户佣金确认 | — | v2 F5④a |
| F5-MD4 | 异常预警阈值配置 | 是 | v2 F5④a |

### 9.7 G 金融产品

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| G1-MD1 | Staking 单档参数变更 | 是 | v3 G1④a |
| G1-MD2 | 单档启用态切换 | — | v3 G1④a |
| G1-MD3 | Staking 单档熔断 | 是 | v3 G1④a |
| G2-MD1 | 兑换三阈值变更 | 是 | v3 G2④a |
| G2-MD2 | 兑换费率变更 | 是 | v3 G2④a |
| G2-MD3 | Queue 配置与次日队列处理 | — | v3 G2④a |
| G2-MD4 | swap 全局暂停 | 是 | v3 G2④a |
| G3-MD1 | 价格曲线参数变更 | 是 | v3 G3④a |
| G3-MD2 | 喂价源切换 | — | v3 G3④a |
| G3-MD3 | 行情引擎暂停 | — | v3 G3④a |
| G3-MD4 | 行情引擎恢复 | 是 | v3 G3④a |
| G4-MD1 | 节点经济参数变更 | — | v3 G4④a |
| G4-MD2 | Genesis 每日分红率变更 | 是 | v3 G4④a |
| G4-MD3 | Genesis 一二级市场暂停 | 是 | v3 G4④a |
| G4-MD4 | Genesis geo_block 配置 | 是 | v3 G4④a |
| G5-MD1 | Premium 定价变更 | — | v3 G5④a |
| G5-MD2 | Premium 权益变更 | 是 | v3 G5④a |
| G5-MD3 | Premium 下架 | 是 | v3 G5④a |
| G6-MD1 | NEX v2 锁仓参数变更 | 是 | v3 G6④a |
| G6-MD2 | NEX v2 熔断下架 | 是 | v3 G6④a |
| G7-MD1 | 复投产品参数变更 | 是 | v3 G7④a |
| G7-MD2 | Genesis 抽奖券发放规则变更 | — | v3 G7④a |
| G7-MD3 | 复投 preset / 早赎罚款变更 | 是 | v3 G7④a |

### 9.8 H 增长与节奏

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| H1-MD1 | dial 改动确认 | 是 | v1 H1④a |
| H1-MD2 | 手动 pin phase 确认 | 是 | v1 H1④a |
| H1-MD3 | 定时切换配置确认 | — | v1 H1④a |
| H1-MD4 | 新增 cohort override 确认 | 是 | v1 H1④a |
| H1-MD5 | 撤销 cohort override 确认 | 是 | v1 H1④a |
| H2-MD1 | TrialConfig 敏感参数变更确认 | — | v1 H2④a |
| H2-MD2 | 强制取消试用确认 | — | v1 H2④a |
| H2-MD3 | 强制触发扣款确认 | — | v1 H2④a |
| H3-MD1 | Day-One Quest 配置变更 | 是 | v3 H3④a |
| H3-MD2 | Weekly Quests 配置变更 | 是 | v3 H3④a |
| H3-MD3 | Monthly Challenge 配置变更 | 是 | v3 H3④a |
| H3-MD4 | Weekly phase multiplier 曲线变更 | 是 | v3 H3④a |
| H4-MD1 | 活动上下架确认 | — | v3 H4④a |
| H4-MD2 | Featured 主推位变更 | — | v3 H4④a |
| H4-MD3 | 活动奖励 / evaluator 变更 | 是 | v3 H4④a |
| H4-MD4 | Lucky Spin 转盘奖池变更 | 是 | v3 H4④a |
| H4-MD5 | 活动 region / geo_block 配置 | 是 | v3 H4④a |
| H5-MD1 | 签到基础规则变更 | — | v3 H5④a |
| H5-MD2 | Lucky 概率变更 | 是 | v3 H5④a |
| H5-MD3 | 30 天里程碑配置变更 | 是 | v3 H5④a |
| H5-MD4 | Streak Power-Ups 变更 | 是 | v3 H5④a |
| H6-MD1 | 里程碑阈值 / 奖励变更 | 是 | v3 H6④a |
| H6-MD2 | watcher tick 间隔变更 | 是 | v3 H6④a |

### 9.9 I 内容与合规 CMS

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| I1-MD1 | 发布文案版本确认 | — | v4 I1④a |
| I1-MD2 | 下架 / 归档文案版本确认 | — | v4 I1④a |
| I1-MD3 | 回滚到历史版本确认 | — | v4 I1④a |
| I1-MD4 | A/B 实验启停确认 | — | v4 I1④a |
| I1-MD5 | 采纳获胜变体为发布版确认 | — | v4 I1④a |
| I2-MD1 | channel cadence 调整确认 | — | v4 I2④a |
| I2-MD2 | channel kill 开关切换确认 | — | v4 I2④a |
| I2-MD3 | 推送模板版本发布 / 下架确认 | — | v4 I2④a |
| I2-MD4 | social-event 概率分布调整确认 | — | v4 I2④a |
| I3-MD1 | campaign 调度下发确认 | — | v4 I3④a |
| I3-MD2 | campaign 取消确认 | — | v4 I3④a |
| I3-MD3 | 优先级 CAP 调整确认 | — | v4 I3④a |
| I4-MD1 | 信任 section 内容发布确认 | — | v4 I4④a |
| I4-MD2 | 信任 section 内容下架确认 | — | v4 I4④a |
| I4-MD3 | 信任 section 回滚确认 | — | v4 I4④a |
| I5-MD1 | 披露新版本发布确认 | — | v4 I5④a |
| I5-MD2 | jurisdiction × version 矩阵配置确认 | — | v4 I5④a |
| I5-MD3 | gated action 拦截范围调整确认 | — | v4 I5④a |
| I6-MD1 | i18n key 发布确认 | — | v4 I6④a |
| I6-MD2 | i18n key 下架 / 回滚确认 | — | v4 I6④a |
| I6-MD3 | marketing 多版 A/B 启停确认 | — | v4 I6④a |
| I7-MD1 | 课程发布确认 | — | v4 I7④a |
| I7-MD2 | featured 位设置确认 | — | v4 I7④a |
| I7-MD3 | 完成 NEX 奖励额调整确认 | 是 | v4 I7④a |
| I7-MD4 | 课程下架 / 回滚确认 | 是 | v4 I7④a |

### 9.9a /content/support 支持后台

- FAQ 管理:创建、编辑、发布、下架、排序、分类。
- Ticket 分类/SLA:category、priority、owner、SLA target。
- 工单处理:回复、关闭、重开、改 owner、改 priority、写 audit reason。
- 工单列表必须支持分页、搜索、状态筛选、owner/priority 筛选和空态。
- 所有写动作必须刷新后仍可见,并写入 audit feed。

### 9.10 J 紧急与合规控制

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| J1-MD1 | 功能闸熔断确认 | — | v4 J1④a |
| J1-MD2 | 功能闸恢复确认 | 是 | v4 J1④a |
| J1-MD3 | 批量应急熔断确认 | — | v4 J1④a |
| J1-MD4 | 自动触发参数配置确认 | — | v4 J1④a |
| J1-MD5 | 自动触发补录确认 | 是 | v4 J1④a |
| J2-MD1 | geo-block 国家清单配置确认 | — | v4 J2④a |
| J2-MD2 | 受限名单配置确认 | — | v4 J2④a |
| J2-MD3 | per-endpoint geo_block 派生配置确认 | — | v4 J2④a |
| J2-MD4 | 边缘 IP 判定源配置确认 | — | v4 J2④a |
| J3-MD1 | 篡改告警配置确认 | — | v4 J3④a |
| J4-MD1 | 应急剧本编辑确认 | — | v4 J4④a |
| J4-MD2 | 剧本演练确认 | — | v4 J4④a |
| J4-MD3 | 应急剧本执行确认 | 是 | v4 J4④a |

### 9.11 K 风控与反作弊

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| K1-MD1 | 批量冻结关联账户簇确认 | — | v1 K1④a |
| K1-MD2 | 标记为正常(cleared)确认 | — | v1 K1④a |
| K1-MD3 | 解除误判关联(released)确认 | 是 | v1 K1④a |
| K3-MD1 | 提现风控规则新建 / 编辑确认 | — | v1 K3④a |
| K3-MD2 | 规则启停确认 | — | v1 K3④a |
| K3-MD3 | 命中动作映射调整确认 | 是 | v1 K3④a |
| K4-MD1 | 评分模型发布确认 | — | v1 K4④a |
| K4-MD2 | 单用户评分人工覆盖确认(非高敏) | — | v1 K4④a |
| K4-MD3 | 评分输入来源开关切换确认 | 是 | v1 K4④a |
| K5-MD1 | KYC 复审通过确认 | 是 | v1 K5④a |
| K5-MD2 | KYC 复审驳回确认 | 是 | v1 K5④a |

### 9.12 L 数据与分析 BI

| 弹窗 ID | 标题 | B1 红线预检 | 细则 |
|---|---|---|---|
| L3-MD1 | 财务报表资金明细导出确认 | — | v4 L3④a |
| L4-MD1 | 网络/团队结构明细导出确认 | — | v4 L4④a |
| L5-MD1 | 含敏感数据批量导出确认 | — | v4 L5④a |
| L5-MD2 | 解密导出确认 | — | v4 L5④a |
| L5-MD3 | 监管报告生成确认 | 是 | v4 L5④a |

> **完整性对账**:本表共 **210 个弹窗**(其中含 B1 红线预检 75 个),按域:A=12 / B=4 / C=17 / D=15 / E=30 / F=32 / G=23 / H=23 / I=25 / J=13 / K=11 / L=5。对账命令:`grep -hoE "^##### \[[A-L][0-9]+[a-z]?[a-d]?-MD[0-9]+\]" PRD_v*.md | wc -l` 须等于本表行数;`... | sort | uniq -d` 须为空(全仓唯一)。

## 第 10 章 PRD canonical 治理

- 产品 PRD canonical 路径固定为 `D:\WORKS\PLAN\PRD\Nexion_产品功能架构设计文档_v3.7.md`。
- 运营后台 canonical 文档固定为 `D:\WORKS\PLAN\PRD\Nexion_运营控制后台PRD_v4.md` 与 `D:\WORKS\PLAN\PRD\Nexion_运营控制后台_开发落地规格.md`。
- `_bak/`、`_bakF/`、remediation backups 不参与唯一性判断。
- hook、verify gate 与同步流程只认 canonical 文件。

## 附:与原 4 卷 PRD 的关系 + 维护约定

- **本文件 vs 原 PRD**:本文件是**开发落地契约速查**(建表/接口/参数/状态机/权限),从 4 卷需求 PRD 提炼;原 4 卷保留为**需求背景档案**(为什么做、业务叙事、运营意图)。两者并存,本文件每行带「出处§」可回溯。
- **冲突裁决**:本文件与原 PRD 正文冲突 → 以 PRD 正文为准;PM 已裁定项(✅ 标注)以裁定为准。
- **维护**:原 PRD 改动后,对应契约项同步更新本文件;新增模块/接口/参数时本文件对应章追加 + 更新第 1 章索引。
- **A.x 收口台账**:v1 附录 A 是全库已成形的收口登记(A.1 前端矛盾、A.2 跨批次待补),与本文件第 7/8 章互为补充。
