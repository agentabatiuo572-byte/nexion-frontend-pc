# PC 管理端配置项盘点（A–M 域 · 68 子菜单）

> 数据基准：PC 端实现（`lib/admin/registry/*.ts` + `domain-views/*-view.tsx` + `lib/admin/*-client.ts`）× 高保真（`nexion-高保真/.../domain-views/` + mock）× PRD v1–v4 三方对齐。
> 盘点日期：2026-07-05。

---

## 一、口径与图例

### 统计口径
**只统计「后台可配置项」**：运营在后台可编辑/可调的参数、开关、阈值、费率、系数、规则、档位、奖励额、模板、白名单、RBAC、渠道接入、文案等。
**不统计**：纯展示 / 查询 / 报表数据 / 审计日志 / 只读详情 / 单笔操作动作（单笔审批/冻结/退款/处置等）。

### 分类定义
| 类别 | 定义 | 典型例 |
|---|---|---|
| **基础类** | 通用基座配置，跨业务复用、与具体业务规则解耦 | 账号/角色/权限、审计策略、系统参数、渠道接入、通知模板、i18n 文案、Kill-Switch 矩阵、SLA、白名单、DC 元数据、代际门、下载配置、映射表 |
| **业务类** | 业务运行参数，直接影响该域业务逻辑或资金/风控口径 | 费率、阈值、系数、规则、档位、奖励额、APY、锁仓规则、折抵率、TOPS、计酬倍率 |

### 现状图例
- ✅ 已实现：PC 有可编辑配置且接后端
- ⚠️ 部分：有 UI/mock 但未接后端，或字段不全/只读
- ❌仅PRD：PRD 要求但 PC 端无实现
- ❌缺失：高保真有但 PC 端无

---

## 二、全局汇总表

| 域 | 域名 | 子菜单数 | 基础类 | 业务类 | 合计 | 实现度概览 |
|---|---|---|---|---|---|---|
| A | 平台基础 | 5 | 24 | 0 | 24 | 16✅ / 8❌仅PRD |
| B | 总览驾驶舱 | 5 | 0 | 19 | 19 | 3✅ / 16❌仅PRD（B 域定位为看板入口，自有配置少）|
| C | 用户与账户 | 6 | 2 | 4 | 6 | 5✅ / 1⚠️ |
| D | 资金与财务 | 5 | 5 | 9 | 14 | 14✅（全接后端）|
| E | 设备与商城 | 6 | 36 | 48 | 84 | 79✅ / 1⚠️ / 4❌（含缺口）|
| F | 分销与团队 | 5 | 23 | 24 | 47 | 24✅ / 7⚠️ / 16❌仅PRD |
| G | 金融产品 | 5 | 9 | 23 | 32 | 31✅ / 1⚠️ |
| H | 增长与运营节奏 | 6 | 16 | 44 | 60 | 56✅ / 4⚠️ |
| I | 内容与合规 CMS | 5 | 14 | 19 | 33 | 31✅ / 2⚠️ |
| J | 紧急与合规控制 | 4 | 8 | 10 | 18 | 18✅（全接后端）|
| K | 风控与反作弊 | 5 | 3 | 12 | 15 | 15✅（全接后端）|
| L | 数据与分析 BI | 6 | 2 | 8 | 10 | 10✅（L1–L4/L6 纯报表无配置）|
| M | 客服中心 | 5 | 7 | 1 | 8 | 8✅（全接后端）|
| **合计** | **13 域** | **68** | **149** | **221** | **≈370** | **约 310✅ / 15⚠️ / 45❌（缺口集中在 B/F/A）** |

**分类占比**：基础类 149 项（40%）/ 业务类 221 项（60%）。业务类多集中在 E（设备计酬）、H（增长奖励）、F（分销费率）、G（金融 APY）四大资金/激励域。

---

## 三、各域详细盘点

### 域 A · 平台基础（A1–A5）

#### A1 · 运营账号 & RBAC（`/platform/rbac`）
- **基础类**：
  - 运营账号生命周期（新建/编辑/禁用/启用/删除） | ✅ | PC
  - 账号角色分配（7 角色枚举，有效超管 ≥2 校验） | ✅ | PC
  - 全域 RBAC 权限矩阵（域×动作×角色，M/C/R/-） | ✅ | PC
  - RBAC 高敏动作行登记（新增动作入总表） | ✅ | PC
  - 登录安全基线 4 项（session 滑动 15–60min / 绝对 4–12h / 失败短锁 3–10 次 / 短锁时长 5–60min） | ✅ | PC
  - member/lead 权限层级（执行门槛） | ❌仅PRD | PRD v1 §2.1
  - 登录失败长锁档（默认 15 次/24h + 强制 2FA） | ❌仅PRD | PRD v1 §2.1
  - 铁律不变量（强制 2FA 不可关 / 新账号零写权 / 有效超管 ≥2，server 强制非可调） | ✅（server 不变量）| PC

#### A2 · 审计 & 操作确认（`/platform/audit`）
- **基础类**：
  - 操作理由最短长度（默认 8 字，8–200） | ✅ | PC
  - 审计日志保留期（默认 13 月，13–36） | ✅ | PC
  - 审计/事件字段 schema 注册变更 | ✅ | PC
  - 高敏动作清单（9 大类，增删须发布） | ⚠️（PC 只读展示）| PC+PRD
  - 执行门槛分流状态机 | ⚠️（机制后端派生，无前端配置面）| PC+PRD

#### A3 · 系统配置（`/platform/config`）
- **基础类**：
  - 功能开关 feature flag（on/off/灰度 10/20/50/90%） | ✅ | PC
  - kill-switch 5 闸状态存储（操作面迁 J1，本页只读） | ⚠️（只读兼容）| PC
  - geo-block 国家列表（操作面迁 J2，本页只读跳转） | ⚠️（只读跳转）| PC+PRD
  - 服务器时钟/防重号 Idempotency-Key TTL 卡 | ❌缺失（2026-06 按指令移除配置面）| PC+PRD

#### A4 · 埋点事件体系（`/platform/events`）
- **基础类**：
  - schema registry（事件/属性注册：命名/版本/PII 校验/采样/ownerDomain，只增不删） | ✅ | PC
  - domain 扩展工单登记（V3/V4 批次） | ✅ | PC
  - 口径参数·Day0 接入窗口（默认 90s） | ✅ | PC
  - 口径参数·事件留存期（默认 13 月） | ✅ | PC
  - 口径参数·采样率（资金/风控/转化 100% 锁定，view/session 类可调） | ✅ | PC
  - 留存口径（Day1/7/30 锁定只读） | ⚠️（锁定只读）| PC+PRD
  - cohort 粒度/Phase 归因强制属性 | ⚠️ | PC+PRD

#### A5 · 平台参数寄存器（`/platform/params-registry`）
- 无后台配置项（纯只读索引 + 跳转各 owner 域）。
- 运行时索引只读聚合服务端启用配置与 J1/J2 实时态；展示当前值、来源健康、更新时间和后端明确给出的 owner-link。CGM 是规划盘点，不作为运行时值源。

> **域 A 小计：基础类 24 项（16✅ / 8❌）· 业务类 0 项**

---

### 域 B · 总览驾驶舱（B1–B5）

> 域定位（PRD §Ch4）：「驾驶舱是看板与跳转入口，本身不持有处置权」。B 域自有 client 仅 `fetchBDomainDashboard`（读）+ `acknowledgeBDomainAlert`（单笔 ack），无 update/configure。

#### B1 · 双账本总览（`/overview/dual-ledger`）
- **业务类**：
  - 兑付覆盖率红线 redlinePct（默认 100%，80–150%，UI 入口在 B1 实写 D3） | ✅ | PC+PRD
  - 挤兑压力红线 runRiskPct（UI 入口在 B1 → D3） | ✅ | PC
  - 全局熔断批量停摆 killDomains（UI 入口在 B1 → J1） | ✅ | PC
  - 兑付覆盖率黄线（默认 110%，须 > 红线） | ❌仅PRD | PRD v1 §B1
  - 储备科目纳入开关组 | ❌仅PRD | PRD
  - 净敞口曲线默认窗口 / 告警渠道订阅 / 手动储备注入登记 / 对账导出 | ❌仅PRD | PRD

#### B2 · 资金池水位（`/overview/liquidity`）
- **业务类**：到期预测窗口 / 8 类负债科目开关 / staking 利息计提口径 / trial 潜在 redeemed 压力层 / 预测参数弹窗 / 导出 —— 全 ❌仅PRD（PC 纯展示）

#### B3 · 转化漏斗（`/overview/funnel`）· B4 · 节奏状态（`/overview/rhythm`）
- 无后台配置项（纯展示/报表；节奏 dial 权威在 H1，B4 只读跳转）。

#### B5 · 风险雷达（`/overview/risk-radar`）
- **业务类**：挤兑比率黄线 bankrunYellow（默认 20%）/ 红线 bankrunRed（默认 40%，被 J1 R1 引用）/ 告警渠道订阅 / 风险 feed 导出 —— 全 ❌仅PRD（PC 纯展示）
- 注：出金压力比红线 `pressureRedLine=0.7` 为经济模型锚定的固定不变量，不计可配置项。

> **域 B 小计：基础类 0 项 · 业务类 19 项（3✅ / 16❌仅PRD）**

---

### 域 C · 用户与账户（C1–C6）

#### C1 · 检索 & 画像 · C2 · 账户操作 · C3 · 余额 & 资产调整
- 均无后台配置项（C1 纯展示跨域聚合；C2/C3 索单笔处置，REASON_CODES 等为前端硬编码枚举非可配）。

#### C4 · KYC 合规台账（`/users/kyc`）
- **基础类**：配对网络白名单（TRC20/ERC20/BTC/ETH，`updateUserKycNetworkWhitelist`） | ✅ | PC
- **业务类**：KYC 验证费（$1，前端只读展示，调整走治理流程） | ⚠️ | PC+PRD

#### C5 · 安全 & 会话（`/users/security`）
- **基础类**：凭证与会话参数组（会话超时/刷新 TTL/挑战码过期/2FA 强制窗口，逐项可调 `PATCH /security/credential-params/{key}`，部分 readOnly） | ✅ | PC

#### C6 · 注册/登录风控（`/users/reg-risk`）
- **业务类**：
  - OTP 验证码参数组（有效期/重发冷却/同号 24h 上限） | ✅ | PC
  - 连错锁定两档阈值（短锁 5 次/15min + 长锁 10 次/24h） | ✅ | PC
  - 人机验证 CAPTCHA 全局开关 + 紧急关闭恢复时限（30min/1h/2h/4h 枚举） | ✅ | PC
- 注：同 IP/设备/支付工具去重参数归 K1，本页提交会被后端 422 拒收。

> **域 C 小计：基础类 2 项 · 业务类 4 项（5✅ / 1⚠️）**

---

### 域 D · 资金与财务（D1–D5）

#### D1 · 充值对账中心（`/finance/recon`）
- **基础类**：充值渠道启停（5 渠道开关）/ 主备 PSP 切换（Checkout↔Stripe）/ BIN 段锁定管理 —— 全 ✅ | PC
- **业务类**：渠道手续费率 fee / 渠道最低入金额 minAmount / 刷卡风控参数（cardParams 动态键值） —— 全 ✅ | PC

#### D2 · 提现审核队列 · D4 · 账本/账单审计
- 无配置项（D2 纯审批引用 K3/K4/C4 信号；D4 纯审计/单笔调账）。

#### D3 · 资金池水位仪表盘（`/finance/pool`）
- **基础类**：储备注入登记（凭据号）/ 储备负债口径说明 —— ✅ | PC
- **业务类**：覆盖率红线 redlinePct / 健康线 healthyPct / 挤兑风险线 runRiskPct —— 全 ✅（`PATCH /treasury/dual-ledger/thresholds`）| PC

#### D5 · 提现参数配置（`/finance/params`）
- **业务类**：每日提现次数上限 dailyLimitCount（1–10）/ 单次余额可提比例 balanceMaxRatio（50–100%）/ 提现费率 networkFee（0–5%） —— 全 ✅（`PATCH /finance/withdrawal-params`，放松方向过 B1 红线）| PC
- 注：NEX 抵扣率/罚金费率/冷却时间由 H1 统一派发，D5 只读跳转。

> **域 D 小计：基础类 5 项 · 业务类 9 项（全 ✅）**

---

### 域 E · 设备与商城（E1–E6）

#### E1 · 商品目录 & 代际门（`/devices/pricing`）
- **基础类（14 项全 ✅）**：SKU 名称/tagline/badge、tier 档位、gpu/vram/hashRate/power 规格、datacenter 归属、AI 算力指标、aiUnlocks 池关联、features 清单、媒体资源、rating/reviews/sold、supersededBy、reviews 评价管理、tag 标签、阶段表 ph.label/meta/skus、阶段 sortOrder/status/增删
- **业务类（22 项，21✅ + 1❌）**：
  - ✅ price 售价 / dailyEarn 日产 USDT / dailyEarnNEX 日产 NEX / shareYield 年化 / baseRate / stock 库存 / status 上下架 / generation 代际 / lifecycle / tradeinDiscount 折扣 / unlockPhase / purchaseGate 资格门（rankMin/activeDirectMin/teamVolumeMin/mode）/ purchaseGate 锁额门（quotaCap/quotaSold/quotaPeriod=enforced lifetime；旧 month 读取显示 HOLD、不可保存，按月原子 usage 计数待后续）/ 代际门 releaseMonth / phase / phaseOffset / discount / eligibility / forceUnlock / archive / setCurrentPhase
  - ❌仅PRD：套餐折扣 ladder（monthlyPrice × installMonths）

#### E2 · 收益 & 任务引擎（`/devices/tasks`）
- **基础类（6 项全 ✅）**：任务 name/unit/requirement/taskClass/model/列表筛选翻页
- **业务类（10 项，8✅ + 2❌）**：
  - ✅ 任务单价 price（saveE2Task）/ 单价快速调整（PATCH /price）/ minReward·maxReward 区间 / minVRAM 路由门槛 / saturation 饱和度 / killInit 紧急下架 / 任务 DELETE / 手机档位 dailyUsdt(T1–T5) / dailyNex(T1–T5)
  - ❌仅PRD：QUEUE_SATURATION 全局饱和因子 / Locked teaser VRAM 档预览区

#### E3 · 生命周期 & Trade-in（`/devices/trade-in`）
- **任务产能类（全 ✅，`PATCH /e3/config`）**：三段按月复利变化率 capacityBand1/2/3DeltaPct / 分段 stageEarlyEnd、stageMidEnd / 图表视窗 cycleMonths / 产能下限 capacityFloorPct / 补贴标注天数 capacitySubsidyDays / 8 个 SKU 参与开关 / 任务锁定月度损失阈 taskLock.s1/pro/rack。`cycleMonths` 不截断运行曲线，段 3 持续到下限。
- **Trade-in 类（全 ✅）**：开关 tradeinEnabled / 资格 eligibility / 累计产出-实付比例界点 tradeinLadderCut1..4 / 五档折抵率 tradeinLadderCredit1..5 / 目标高价限制 / 单笔数量上限 / promo 倍率与弹窗节奏。
- **已退役（运行时禁读写）**：degradeEarly/Mid/Late、minEfficiency、salvagePct、minHoldingMonths；K2 改读已完成置换事实及正向返佣/礼金入账。

#### E4 · 订单状态机（`/devices/orders`）
- 无配置项（PC 纯状态机展示 + 单笔订单操作）。PRD 列 3 项业务类全 ❌仅PRD：DC 分配规则 / 各阶段推进策略 / 订单过期时窗（placed→expired，建议 15–30min）。

#### E5 · 设备运维（`/devices/ops`）
- **基础类（4 项全 ✅，DC CRUD）**：dcLocation 标识 / regionLabel 展示名 / status（active/maintenance/disabled）/ sortOrder
- **业务类**：单户设备上限 maxDevicesPerUser（PC 只读，PRD v2 写死=6，V4 评估参数化）| ❌仅PRD

#### E6 · 算力与设备配置（`/devices/compute-config`）
- **基础类（6 项，5✅ + 1❌缺失）**：
  - ✅ 客户端下载地址 download.url / 下载页 zhTitle/zhGuide/enTitle/enGuide 双语文案
  - ❌缺失：客户端版本号字段（口径列入但 PC/mock/PRD 均无此字段）
- **业务类（10 项，9✅ + 1❌缺失）**：
  - ✅ 电脑共享算力入口开关 computeShareEnabled / H5 基础托管系数 h5BaseFactor（0–1，默认 0.6）/ App 连续在线满额时长 continuityFullHours（默认 2h）/ G1–G6 档位名称 gpuTier.label（6 字段）/ G1–G6 算力 TOPS gpuTier.tops（默认 40/90/160/290/460/660）/ G1–G6 识别词槽位 gpuTier.keyword1..6（36 字段）/ 收益估算基准算力 yieldEstimate.topsBaseline（默认 28）/ 基准日产 USDT yieldEstimate.dailyUsdtPerBaseline（默认 0.06）/ NEX 折算系数 yieldEstimate.nexPerUsdt（默认 166.67）
  - ❌缺失：客户端强制升级开关（口径列入但无字段）

> **域 E 小计：基础类 36 项（35✅ / 1❌缺失）· 业务类 48 项（44✅ / 1⚠️ / 5❌）**

---

### 域 F · 分销与团队（F1–F5）

#### F1 · V-Rank 晋升（`/network/v-rank`）
- **基础类**：vRankPermanent 不降级开关 | ❌仅PRD
- **业务类（11 项，6✅ / 2⚠️ / 3❌）**：
  - ✅ V-Rank 门槛 13 阶 × 5 维（selfBuy/teamGv/directRefs/legCount/legRank，F.vrank.{V0–V12}）/ V-Rank 奖励清单 CRUD（usdt/nex/voucher/sku/custom）
  - ⚠️ cultivationBonus 培育奖（PC 通过 V 级 nex 奖励等效）/ peerBonus 平级奖（PC 在 F2 params 呈现）
  - ❌仅PRD：头衔 title / unilevelDepth / prizeName；实物奖发货队列（设计已收编为奖励清单）

#### F2 · 网络版税费率（`/network/royalty`）
- **基础类（3 项全 ❌仅PRD）**：佣金冷却天数 cooling-days（默认 30d）/ InfluenceScore clamp（1.0–5.0）/ 层暂停恢复（layer pause）
- **业务类（8 项，4✅ / 2⚠️ / 2❌）**：
  - ✅ UNILEVEL_USDT[L1–L7]（L1=10%…L7=0.5%，和 ≤25%）/ UNILEVEL_NEX[L1–L7]（per $1，amplify）/ 8 张动态参数卡（含 maxCombinedOutflowPct 护栏）/ Rate Tier 升档（只读派生）
  - ⚠️ promo 周倍率（动态卡）/ peer 平级奖（动态卡）
  - ❌仅PRD：Partner Status 门槛+权益（4 档 $0/$5K/$50K/$500K）

#### F3 · 双轨结算引擎（`/network/binary`）
- **基础类（8 项，7✅ / 1❌）**：
  - ✅ threshold 两轨结算门槛（默认 $1000）/ matchRate 平衡匹配比例（默认 10%，0–20%，amplify）/ spillover 自动安置开关 / gvResetCron GV 月度归零 / settlePeriod 结算周期 / residualPolicy 沉淀处置（清零/转结，amplify）/ binaryDailyCapUSD（只读镜像 H1）
  - ❌仅PRD：双轨暂停开关
- **业务类**：0（双轨对碰为机械公式）

#### F4 · 池/配额/大使/榜（`/network/leadership-pool`）
- **基础类（11 项，6✅ / 5❌）**：
  - ✅ pool.ratio 周 GMV 注入率（默认 5%，3–10%，amplify）/ pool.monthlyCap 月度上限 / quota.proUnlock（≥5 直推）/ quota.rackUnlock（≥15 直推 OR ≥$20K）/ quota.monthlyStock（1000/100 台）/ leaderboard.poolUsd（amplify）
  - ❌仅PRD：poolSettleCron / poolUnlockVRank / top1MaxPct·top5MaxPct 头部集中度 / leaderboardMinUsd / 暂停榜单·断货暂停配额
- **业务类（5 项，1✅ / 1⚠️ / 3❌）**：
  - ✅ pool.votes V 级票数权重（V3:1…V12:512，amplify）
  - ⚠️ PERIOD_PRIZE 4 周期奖池（PC 仅暴露"本期"单键）
  - ❌仅PRD：大使区域预算配额 / KOL 预算占比 / 下季度配额评估日

#### F5 · 佣金事件审计（`/network/commissions`）
- 无配置项（纯审计流水 + 单笔冻结/解锁 dispose）。PRD 缺口：异常预警阈值 | ❌仅PRD

> **域 F 小计：基础类 23 项（13✅ / 10❌）· 业务类 24 项（11✅ / 5⚠️ / 8❌）**

---

### 域 G · 金融产品（G1–G7）

#### G1 · Staking 池配置（`/finance-products/staking`）
- **基础类**：单档 enabled 停售/恢复 / 单档熔断 kill·解除 —— 全 ✅
- **业务类**：各档 APY（30/90/180/365d 默认 12%/35%/80%/180%）/ 各档提前赎回罚款 penalty（5/15/30/50%）/ 各档最小锁仓额 minStake —— 全 ✅（升息·降罚款过 B1）

#### G2 · 兑换风控（`/finance-products/exchange`）
- **基础类**：swap 全局熔断/恢复（联动 J1）| ✅
- **业务类**：USER_DAILY_CAP_USD（默认 $50）/ PLATFORM_DAILY_CAP_USD（默认 $20K）/ EXCHANGE_FEE_PCT + _MIN_USD（默认 0%，30% 进 NEX 回购池）/ queueMode 排队策略 / KYC_LIFETIME_THRESHOLD_USD（默认 $100，V1 在 K5） —— 4✅ / 1⚠️

#### G3 · NEX 行情引擎（`/finance-products/market`）
- **基础类**：排程 schedule（每日 HH:mm 自动推进）/ pin·loop / 手动推进 advanceFrame / 引擎暂停恢复 / 喂价源 oracle 切换 —— 全 ✅
- **业务类**：周曲线 7 日关键帧 × 3 字段（targetPrice/pumpProbability/volatilityPct）/ 应急直写现价 override / volatilityPct 波动幅度（0–20%）/ deviationPct 偏离告警阈值 / costBasis 成本基准锚 —— 全 ✅（改目标价/上行概率以周峰值价重估 NEX 计价负债过 B1）

#### G4 · Genesis 经济（`/finance-products/genesis`）
- **基础类**：一二级市场熔断/恢复（联动 J1）| ✅
- **业务类**：节点总量 TOTAL_SLOTS（默认 1000）/ 一级单价 unitPriceUSDT（默认 $9999）/ 每日分红率 dailyDividendShare（基准 0.1%，仅超管）/ 二级版税 royalty（默认 2.5%）/ 分红基数口径 divBase —— 全 ✅

#### G7 · 复投激励（`/finance-products/repurchase`）
- **业务类（5 项全 ✅）**：复投 APY（默认 35%，90d 锁）/ 培育奖倍率 nurture（×1.5）/ Genesis 抽奖券规则 lottery / 早赎罚款 penalty（本金 15%）/ preset 金额档（$100/200/500/1000）

> **域 G 小计：基础类 9 项 · 业务类 23 项（31✅ / 1⚠️）**

---

### 域 H · 增长与运营节奏（H1–H7）

#### H1 · Phase 调度器（`/growth/phase`）
- **基础类**：节奏总时长 totalMonths / 当前月+阶段进度校准 / Phase 切换控制（pin/schedule/loop）/ 用户群 override 撤销 —— 全 ✅
- **业务类（8 项 dial × 月度旋钮矩阵，全 ✅）**：inviteRewardMultiplier 邀请加成 / questRewardMultiplier 任务加成 / trialOffsetCapUsdt 试用抵扣上限 / deviceReleasePacingPct 设备放量 / commissionTighteningPct 佣金收紧 / campaignRewardNex 活动奖励 / withdrawNexMinBalance 提现 NEX 门槛 / withdrawNexHoldDays 持有天数（后两项镜像 D5）

#### H2 · 免费试用引擎（`/growth/trial`）
- **基础类**：auto-push 急停（1.5s 即时止血）| ✅
- **业务类（13 项，TrialConfig 19 参数全 ✅）**：时窗 trialDays/graceDays/extensionDays（3/7/3）/ 折扣率 discountRate+discountCapUSD（0.15/$20）/ 试用收益抵扣上限 trialOffsetCapUSD（$50）/ 高质量延长阈值（$100）/ 扣款失败率 chargeFailRate（server-only）/ trialProductId / trialPriceUSD（$1299）/ 影子累计 shadowDailyUSD·NEX / cooldownDays（30）/ phaseOpen / autoPush 三参（1500ms/24h/1）/ autoChargeAtEnd

#### H3 · 任务引擎（`/growth/quest`）
- **基础类**：任务 completionType+completionEvent / 任务增删启停 | ⚠️（PC 仅改奖励，无增删/完成判定编辑器）
- **业务类（11 项，9✅ / 2⚠️）**：首日时窗 dayOne.windowMs / 首日三相奖励 triReward / 首日每任务奖励（6 任务）/ 周任务一档·二档奖励 / 周冠军加奖 / 阶段倍率曲线 mult.P1–P6 / 月度主题奖励（5 主题）/ 转化卡（baseReward/multiplier/countdown/targetDevice/status）—— 多数 ✅；月度主题月龄分段+子目标 ⚠️

#### H4 · 活动中心（`/growth/events`）
- **基础类**：活动状态切换 status / Featured 主推位指派 —— ✅
- **业务类（4 项，2✅ / 2⚠️）**：活动奖励（USDT/NEX）✅ / trackable evaluator 绑定 ⚠️ / Lucky Spin 转盘奖池（结构化档位编辑）⚠️ / 转盘护栏（wheelDailyPayoutBudgetUSD/wheelPrizeDailyCap/wheelRealPrizeEnabled）✅

#### H5 · 签到 & NEX（`/growth/daily`）（已合并原 H6 收益里程碑）
- **基础类**：收益里程碑检查间隔 tickInterval（默认 4s）/ Streak Power-Ups 触发天数（7d/14d/30d/60d）+ 备注 —— ✅（增益值字段 PRD 要求 PC 未提供 = ⚠️）
- **业务类（6 项全 ✅）**：签到 baseline+7 天 bonus / Lucky 概率 p15+p2（默认 15%+5%，和 ≤100%）/ 断签阈值 broken（>48h）/ Streak Saver 持有+恢复上限 / 连签里程碑奖励（7 阶梯）/ 收益里程碑 5 档门槛+奖励（$200→50NEX … $40000→2500NEX）

#### H7 · 代金券（`/growth/vouchers`）
- **基础类（7 项全 ✅）**：type 类型 / applicableSkus 适用 SKU / audience 受众 / startAt·endAt 有效期 / claimSurfaces 领取入口 / popupEnabled·stackWith 策略 / status+删除
- **业务类**：满减面值 amountUSD / 折扣率 percent / 满减门槛 minPurchaseUSD / 折扣封顶 maxDiscountUSD —— 全 ✅（代金券不走 B1 红线，促销折扣非负债）

> **域 H 小计：基础类 16 项 · 业务类 44 项（56✅ / 4⚠️）**

---

### 域 I · 内容与合规 CMS（I1–I6）

#### I1 · 转化文案 A/B（`/content/copy-ab`）
- **基础类**：文案版本管理（草稿/发布/回滚/下架）/ 双语文案镜像 / 占位符一致性校验 —— 全 ✅
- **业务类**：A/B 分流比例（和=100%，sticky）/ A/B 受众定向 / 实验框架参数（最小样本/最长运行 ≤90 天）/ 采纳获胜变体 —— 全 ✅

#### I2 · Nova 推送运营（`/content/nova`）
- **基础类**：推送通道 CRUD（10 通道）/ 推送模板池（i18n+CTA） —— 全 ✅
- **业务类**：单通道 kill 开关 / 通道节奏（tickMs/cooldownMs）/ phase-keyed 分档 / social-event 5 类概率分布（和=100%）/ 真实事件池条目数 —— 全 ✅

#### I3 · 通知 Campaign（`/content/notifications`）
- **基础类**：Campaign CRUD（草稿/调度/立即/取消）/ 双语正文+受众定向 —— 全 ✅
- **业务类**：4 档优先级容量 CAP（critical∞/high 50/normal 200/low 30）✅ / swipe 路由配置（按 NotifKind 联动）⚠️（PC 仅只读，缺 updateI3Swipe）

#### I4 · 信任中心与披露（`/content/trust`）（PC 合并 PRD 的 I4+I5）
- **基础类**：6 版块信任中心内容（发布/回滚/下架）/ 法域×版本映射矩阵（4 法域）/ 受限动作范围 gated actions —— 全 ✅
- **业务类**：4 法域×7 章节披露正文 ✅ / 重新确认开关 requiresReack ✅ / 财务·NEX 数字字段字段级编辑 ⚠️（PC 仅版块整体发布，字段级写缺失）/ 数据来源标注+对外披露属性 ⚠️

#### I6 · i18n 文案与教程（`/content/i18n`）
- **基础类**：i18n 双语词条（~770 词条，草稿/发布）/ 中英镜像强制闸 / 占位符校验 / 完整性扫描 —— 全 ✅
- **业务类**：marketing 多版 A/B 实验 / 教程课程 CRUD（15 门×5 分类）/ 课程奖励 NEX（10–50，amplify）/ 推荐位课程 —— 全 ✅

> **域 I 小计：基础类 14 项 · 业务类 19 项（31✅ / 2⚠️）**

---

### 域 J · 紧急与合规控制（J1–J4）

#### J1 · Kill-Switch 矩阵（`/emergency/kill-switch`）
- **基础类**：5 大业务闸开关（withdraw/exchange/staking/genesis/trial）/ 应急批量熔断 —— 全 ✅
- **业务类**：应急 SLA（响应/升级时限+轮数，默认 15/60/4）/ 自动触发规则阈值（R2 对账缺口 $50K）/ 恢复前置 B1 覆盖率核验（只读引用） —— 全 ✅

#### J2 · Geo-block（`/emergency/geo-block`）
- **基础类**：黑名单 banned / 受限名单 limited / 应急即时封锁 —— 全 ✅
- **业务类**：per-endpoint 国家映射（7 入口）/ 边缘 IP 判定源切换（仅超管） —— 全 ✅

#### J3 · 篡改防御监控（`/emergency/tamper`）
- **业务类**：账户级篡改告警频次阈值（默认 10 次/24h）/ 喂 K4 风险评分开关 —— 全 ✅（其余纯只读监控，处置移交 C2/K1）

#### J4 · 监管点名应急 SOP（`/emergency/sop`）
- **基础类**：应急剧本库（8 预置+新建）/ 动作序列编辑器（仅止血白名单）/ 通知模板+回滚关联 —— 全 ✅
- **业务类**：应急/常规轨执行（应急轨 SLA 压缩至分钟级）/ 演练要求 / 触发场景+责任角色+SLA —— 全 ✅

> **域 J 小计：基础类 8 项 · 业务类 10 项（全 ✅）**

---

### 域 K · 风控与反作弊（K1–K5）

#### K1 · 反多账户引擎（`/risk/multi-account`）
- **基础类**：IP 白名单增删启停（含备注/过期）| ✅
- **业务类**：反多账户引擎参数（关联强度阈值 ≥0.7 等）| ✅

#### K2 · 套利 & 刷量检测（`/risk/abuse`）
- **业务类**：套利检测参数（最低持有月数默认 6 等）| ✅

#### K3 · 提现风控规则引擎（`/risk/withdrawal-rules`）
- **基础类**：规则状态切换（draft/active/paused/archived）/ 规则试运行 dry-run —— 全 ✅
- **业务类**：规则增删（维度+条件+结果 pass/delay/freeze/manual）/ 规则条件改写 —— 全 ✅

#### K4 · 风险评分模型（`/risk/scoring`）
- **业务类（6 项全 ✅，仅超管）**：六维权重（和=1）/ 输入数据源开关 / 分档阈值（lowMax 默认 40 / highMin 默认 70）/ 自动转人工分阈值（默认 ≥85）/ 用户级评分覆写 / 用户级评分重算

#### K5 · 大额 KYC 复审 & 告警（`/risk/kyc-review`）
- **业务类**：KYC 复审参数（触发阈值 ≥$1000/累计 ≥$100/K4 ≥85 + SLA 7 工作日）/ 手工创建复审单 —— 全 ✅

> **域 K 小计：基础类 3 项 · 业务类 12 项（全 ✅）**

---

### 域 L · 数据与分析 BI（L1–L6）

> L 域定位：读侧无写权威。L1–L4/L6 均为纯只读报表，业务口径锁定引用 A4/B/E/H/F 等域，仅会话级视图参数（时间窗/cohort/粒度）+ 聚合导出，不计配置项。

#### L1 · KPI 看板 · L2 · 漏斗/cohort/留存 · L3 · 财务报表 · L4 · 设备/任务/网络报表 · L6 · 用户行为热力图
- 均无后台配置项（纯只读报表）。

#### L5 · 导出 & 监管报告（`/analytics/export`）
- **基础类**：导出任务管理（发起/放行/重试/下载，状态机）/ 自定义报表模板 —— 全 ✅
- **业务类（8 项全 ✅）**：含敏感数据导出确认门（强制不可关）/ 数据脱敏策略（3 档 masking_policy）/ 解密导出（强操作确认+强制事由）/ 下载链接 TTL（默认 24h，1–72）/ 账单导出范围（D4 7–8 类 BillType 勾选）/ 单任务行数上限（≤100 万）/ 监管报告周期（月/季/年/专项）/ 监管报告模板（KYC/资金兑付/AML/辖区专项，关联 I4 披露版本×法域）

> **域 L 小计：基础类 2 项 · 业务类 8 项（全 ✅）**

---

### 域 M · 客服中心（M1–M5）

#### M1 · 客服总览 · M2 · 工单台 · M3 · 即时会话台
- 均无配置项（M1 纯展示汇总；M2/M3 索单笔工单/会话流转操作）。

#### M4 · 知识库与 SLA（`/service/kb-sla`）
- **基础类**：Help/FAQ 内容池（分类+可见位置+中英问答+草稿/发布）/ SLA 模板矩阵（9 类工单×首响分钟×解决小时×负责人×升级路径） —— 全 ✅

#### M5 · 话术与模板配置（`/service/scripts`）
- **基础类（5 项全 ✅）**：会话类别启停（advisor/support/ai）/ 顾问主动话术库（编号/分组/文案/CTA/受众/状态）/ 即时回复模板库（support/advisor）/ 客服岗位配置（接派单上限/服务类型/启停）/ 专属客服绑定解绑
- **业务类**：顾问主动推送策略 AutoPushPolicy（总开关+首推延迟+冷却+单会话上限+受众）| ✅

> **域 M 小计：基础类 7 项 · 业务类 1 项（全 ✅）**

---

## 四、关键发现与缺口优先级

### 1. 实现度分布
- **全接后端（无缺口）**：D（资金）、J（紧急）、K（风控）、L（BI）、M（客服）、C（用户，仅 1⚠️）、G（金融，仅 1⚠️）—— 这 7 域配置面完整。
- **重度实现**：E（设备，79✅ / 5❌）、H（增长，56✅ / 4⚠️）、I（内容，31✅ / 2⚠️）。
- **缺口集中**：**B 域（16 项❌仅PRD）**、**F 域（16 项❌仅PRD）**、**A 域（8 项❌仅PRD）**。

### 2. 主要缺口清单（PRD 要求未落 PC，按优先级）

| 优先级 | 域 | 缺口 | 说明 |
|---|---|---|---|
| 高 | B | B2 资金池预测参数 / B5 挤兑阈值 / B1 黄线+科目开关 | B 域整体配置面缺失（PC 仅落 3 个跨域写入口） |
| 高 | F | F2 cooling-days / Partner Status / F4 poolSettleCron·poolUnlockVRank·头部集中度 / 4 周期 PERIOD_PRIZE / 大使预算 | F 域「基础类护栏」大量只读或缺失，影响分销结算可控性 |
| 中 | A | member/lead 层级 / 长锁档 / 高敏动作清单可编辑 / geo-block 配置面 | A 域 RBAC 与安全基线的 PRD 增项 |
| 中 | I | I3 swipe 路由写 action / I4 财务字段字段级编辑 | 字段级写权限补全 |
| 中 | H | H3 任务增删/completionType / H4 evaluator+转盘奖池结构化编辑 | 高级多字段编辑 UI |
| 低 | E | E4 订单 DC 分配/推进策略/过期时窗 / E5 maxDevices 参数化 / E1 套餐折扣 ladder | 多为 V4 评估项或设计收编 |

### 3. 高敏配置铁律（全域一致）
所有放大资金/负债流出方向的配置（升 APY/倍率/奖励/概率/拉价/降罚款/恢复熔断/折抵率）统一过 **B1 兑付覆盖率红线预检**（返回 422 拦截）；高敏写入统一走 **OperationConfirmModal + 理由（≥6–8 字）+ Idempotency-Key + A2 append-only 审计**；MC 显式 edit 契约（调参传 edit{kind,current,unit}、处置不传）严格落地。

### 4. 三大单一真源铁律体现
- **IA 单源**：68 子菜单由 `console-nav.ts` 驱动（侧栏/路由/面包屑/verify）。
- **财务单源**：B1/D 域金额、覆盖率、压力比从 `ledger.ts` 派生；红线阈值权威在 D3（B1/J1 只读引用）。
- **配置归属单源**：D5 ← H1（节奏只读）、D2 ← K3+K4+C4（信号只读）、K5 → D2（冻结联动）、K1 白名单为 IP 处置唯一源 —— 盘点未发现"两处都能改同一参数"的双源风险。

---

## 五、数据源文件索引

- **IA 单源**：`lib/nav/console-nav.ts`（13 域 68 模块）
- **内容单源（registry）**：`lib/admin/registry/{a..m}.ts`
- **后端 client（配置写接口权威）**：`lib/admin/{a1..a4,b,c,d,e1..e6,f1,g1..g4,g7,h,i,j,k,l,m}-client.ts`
- **渲染面**：`app/components/domain-views/{a..m}-view.tsx` + `{a..m}-tabs/*.tsx`
- **PRD**：`docs/PRD/Nexion_运营控制后台PRD_v1.md`~`v4.md`（v1=A/B/C/D/E/F/H/K 章；v2=E1–E6+F §17.1；v3=G+H 章；v4=I/J/L+总收口）
- **高保真**：`nexion-高保真/nexion-ops-console/app/components/domain-views/` + `lib/mock/admin/`
