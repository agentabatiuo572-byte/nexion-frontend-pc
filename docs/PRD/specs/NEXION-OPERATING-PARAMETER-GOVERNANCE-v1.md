# NEXION 运营参数治理目录 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 文档状态：逻辑治理基线  
> 事实来源：后端当前 `nx_config_item`、配置消费者及已存在的 key 常量。这里列出 key 不代表其业务规则已批准，更不代表相关功能可以上线。  
> 目标：每个参数只有一个权威 key、明确单位/边界/生效方式/消费者/回滚与监控；禁止“改一个数字、多个域静默变化”。

## 1. 参数风险等级

| 级别 | 影响 | 审批和执行 |
|---|---|---|
| C0 | 展示偏好，不改变资格/资产/安全 | Owner 单人 + CAS + A2 |
| C1 | 运营节奏、通知、非资产体验 | Owner + 影响预览 + A2/A4 |
| C2 | 资格、库存、奖励、价格展示、客服 SLA | 业务 + 技术，灰度、回滚、跨域验证 |
| C3 | 资金、费用、KYC/风控、权限、安全 | maker/checker 候选、全局锁、强审计、对账 |
| C4 | Kill-Switch、Geo、资产转出、恢复高风险服务 | 方向型权限；收紧可快速执行，恢复按 DEC-011/019 审批 |

任何参数若同时影响多个级别，按最高级别治理。`config_value` 为字符串存储时，消费者仍必须按注册 schema 严格解析；畸形值失败关闭，不得悄悄回到宽松默认。

## 2. 参数注册合同

每个 key 必须具备：

```text
paramId / canonicalKey / aliasesToRetire
owner / consumers / affectedModules
valueType / JSON schema / unit / precision / allowedRange / enum
defaultSource / defaultValue / missingBehavior / malformedBehavior
riskClass / direction (tighten|loosen|neutral)
effectiveMode (dynamic|scheduled|new-instance-snapshot|restart)
approvalPolicy / idempotencyScope / CAS version
previewQuery / affectedObjectCount / crossDomainEffects
rollbackValue / rollbackWindow / irreversibleEffects
auditEvent / outboxEvent / metrics / alertThreshold
legalMarketGate / claimIds / userDisclosureVersion
```

## 3. 当前已核对 key 目录

本目录是代码核对快照，不声称天然穷尽数据库或后续分支。任何新发现且未登记的 key 默认禁止运营修改，必须先补注册合同。状态：`ACTIVE_FACT` 表示代码确有消费者；`NEEDS_RULE_APPROVAL` 表示 key 存在但值/边界未获产品批准；`ALIAS_RETIRE` 表示兼容别名需迁移；`BLOCKED_FEATURE` 表示相关功能当前不得面向真实用户。

### 3.1 认证与账号安全

| ID | canonical key | 类型/单位 | 消费/语义 | 风险/生效 | 当前状态 |
|---|---|---|---|---|---|
| PAR-001 | `auth.session.idle_ttl_days` | INTEGER/天 | 管理/用户会话空闲期限；代码读取范围 7–90 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-002 | `auth.risk.login_lock_threshold` | INTEGER/次 | 短期登录锁触发次数 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-003 | `auth.risk.login_long_lock_threshold` | INTEGER/次 | 长期锁触发次数；必须大于短期阈值 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-004 | `auth.risk.lock_duration_minutes` | INTEGER/分钟 | 短期锁持续时间 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-005 | `auth.risk.long_lock_duration_hours` | INTEGER/小时 | 长期锁持续时间 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-006 | `auth.risk.otp_cooldown_seconds` | INTEGER/秒 | registration-risk facade 路径的冷却；不是 App 注册/登录发送的全局重发参数 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-007 | `auth.risk.otp_max_24h` | INTEGER/次 | registration-risk facade 路径 24h 上限；不是 App 发送日限额别名 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-008 | `auth.risk.captcha_off_window` | STRING / ISO-8601 Instant UTC | `Instant.parse` 可解析的暂停截止时刻；缺失/畸形时 CAPTCHA bypass 不生效 | C3/scheduled | ACTIVE_FACT |
| PAR-009 | `auth.risk.c6.version` | INTEGER | Captcha/注册风控版本 | C3/dynamic | ACTIVE_FACT |
| PAR-010 | `auth.security.c5_config_version` | INTEGER | 安全配置版本/缓存失效依据 | C3/dynamic | ACTIVE_FACT |
| PAR-011 | `kyc.network_whitelist` | ARRAY/网络代码 | KYC 钱包允许网络 | C3/dynamic | NEEDS_RULE_APPROVAL |

### 3.2 资金健康、提现与兑换

| ID | canonical key | 类型/单位 | 消费/语义 | 风险/生效 | 当前状态 |
|---|---|---|---|---|---|
| PAR-012 | `wallet.dual-ledger.redline-pct` | DECIMAL/% | 覆盖率红线 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-013 | `wallet.dual-ledger.healthy-pct` | DECIMAL/% | 健康线；应高于红线 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-014 | `wallet.dual-ledger.run-risk-pct` | DECIMAL/% | 挤兑风险线；与 B5 规则关系需固定 | C3/dynamic | NEEDS_RULE_APPROVAL |
| PAR-015 | `wallet.dual-ledger.scope` | ENUM/JSON | 覆盖率纳入负债范围 | C3/scheduled | NEEDS_RULE_APPROVAL |
| PAR-016 | `wallet.dual-ledger.alert.coverage-redline.ack` | BOOLEAN + actor/time 候选 | 红线告警确认；不得消除告警事实 | C3/dynamic | ACTIVE_FACT |
| PAR-017 | `treasury.d3.forecast-config` | JSON | D3 生效预测模型与负债类别 | C3/scheduled | ACTIVE_FACT |
| PAR-018 | `treasury.d3.forecast-config.pending` | JSON | 待生效配置 | C3/scheduled | ACTIVE_FACT |
| PAR-019 | `treasury.d3.forecast-config.pending-effective-at` | DATETIME/UTC | 计划生效时间 | C3/scheduled | ACTIVE_FACT |
| PAR-020 | `treasury.d3.forecast-config.version` | INTEGER | 配置变更序列 | C3/dynamic | ACTIVE_FACT |
| PAR-021 | `treasury.d3.forecast-config.active-version` | INTEGER | 当前生效版本 | C3/dynamic | ACTIVE_FACT |
| PAR-022 | `treasury.d3.forecast-config.pending-version` | INTEGER | 待生效版本 | C3/scheduled | ACTIVE_FACT |
| PAR-023 | `growth.phase.withdraw_cooldown_days` | INTEGER/天 | 提现冷却；与增长阶段联动 | C3/new-intent snapshot | NEEDS_RULE_APPROVAL |
| PAR-024 | `wallet.withdrawal.cooldown_days` | INTEGER/天 | 提现冷却旧 key | C3 | ALIAS_RETIRE → PAR-023 |
| PAR-025 | `wallet.exchange.user_daily_cap_usdt` | DECIMAL/USDT/日 | 单用户兑换日限额 | C3/dynamic | BLOCKED_FEATURE |
| PAR-026 | `wallet.exchange.platform_daily_cap_usdt` | DECIMAL/USDT/日 | 平台兑换日限额 | C3/dynamic | BLOCKED_FEATURE |
| PAR-027 | `wallet.exchange.fee_pct` | DECIMAL/% | 兑换费率；订单需保存快照 | C3/new-order snapshot | BLOCKED_FEATURE |
| PAR-028 | `wallet.exchange.fee_min_usdt` | DECIMAL/USDT | 最低兑换费 | C3/new-order snapshot | BLOCKED_FEATURE |
| PAR-029 | `wallet.exchange.queue_mode` | ENUM | 兑换队列行为 | C3/dynamic | BLOCKED_FEATURE |
| PAR-030 | `wallet.exchange.kyc_threshold_usdt` | DECIMAL/USDT/累计 | 兑换 KYC 触发线 | C3/new-intent | BLOCKED_FEATURE |
| PAR-031 | `wallet.exchange.nex_usdt_price` | DECIMAL/USDT per NEX | 当前 NEX 价格；必须来自批准价格源 | C3/dynamic | BLOCKED_FEATURE |

### 3.3 市场、价格、Genesis 与锁仓

| ID | canonical key | 类型/单位 | 消费/语义 | 风险/生效 | 当前状态 |
|---|---|---|---|---|---|
| PAR-032 | `wallet.nex_market.weekly_curve` | JSON/time series | NEX 周曲线 | C3/dynamic | BLOCKED_FEATURE |
| PAR-033 | `wallet.nex_market.pump_probability` | DECIMAL/% | 人为“拉升概率” | C3 | BLOCKED_FEATURE；应删除设计 |
| PAR-034 | `wallet.nex_market.volatility_pct` | DECIMAL/% | 展示/模拟波动 | C3 | BLOCKED_FEATURE |
| PAR-035 | `wallet.nex_market.oracle` | ENUM/URL ref | 价格源标识 | C3/dynamic | BLOCKED_FEATURE |
| PAR-036 | `wallet.nex_market.deviation_pct` | DECIMAL/% | 价格偏差门槛 | C3/dynamic | BLOCKED_FEATURE |
| PAR-037 | `wallet.nex_market.cost_basis` | DECIMAL | 成本基准，定义与币种待定 | C3 | BLOCKED_FEATURE |
| PAR-038 | `wallet.nex_market.paused` | BOOLEAN | 市场暂停 | C4/dynamic | BLOCKED_FEATURE |
| PAR-039 | `G.genesis.airdropPct` | DECIMAL/% | Genesis 空投比例 | C3/new-position snapshot | BLOCKED_FEATURE |
| PAR-040 | `G.genesis.emissionCurve` | JSON | 排放曲线 | C3/versioned snapshot | BLOCKED_FEATURE |
| PAR-041 | `G.genesis.airdropLockDays` | INTEGER/天 | 空投锁定天数 | C3/new-position snapshot | BLOCKED_FEATURE |
| PAR-042 | `G.genesis.lottery.monthlyCapacity` | INTEGER/月 | Genesis 月容量 | C3/scheduled | BLOCKED_FEATURE |
| PAR-043 | `growth.phase.genesis_emissions_open` | BOOLEAN | 阶段排放门禁 | C4/dynamic | BLOCKED_FEATURE |
| PAR-044 | `disclosure.gate.genesis` | BOOLEAN/version ref | Genesis 风险披露门禁 | C3/dynamic | BLOCKED_FEATURE |
| PAR-045 | `disclosure.gate.staking` | BOOLEAN/version ref | 锁仓披露门禁 | C3/dynamic | BLOCKED_FEATURE |
| PAR-046 | `disclosure.gate.withdraw` | BOOLEAN/version ref | 提现披露门禁 | C3/dynamic | NEEDS_RULE_APPROVAL |

### 3.4 增长、试用、奖励与团队

| ID | canonical key | 类型/单位 | 消费/语义 | 风险/生效 | 当前状态 |
|---|---|---|---|---|---|
| PAR-047 | `growth.phase.current_month` | INTEGER/月序 | 当前运营月 | C2/scheduled | NEEDS_RULE_APPROVAL |
| PAR-048 | `growth.phase.current` | ENUM | 当前 Phase | C2/scheduled | NEEDS_RULE_APPROVAL |
| PAR-049 | `H1.rhythm.totalMonths` | INTEGER/月 | 总节奏月数 | C2/versioned | NEEDS_RULE_APPROVAL |
| PAR-050 | `H1.rhythm.currentMonth` | INTEGER/月 | H1 当前月镜像 | C2 | ALIAS/MIRROR REVIEW |
| PAR-051 | `H1.rhythm.phaseProgressPct` | DECIMAL/% | Phase 进度展示 | C1/dynamic | NEEDS_RULE_APPROVAL |
| PAR-052 | `growth.checkin.reward_nex` | DECIMAL/NEX | 签到基础奖励 | C3/new-event snapshot | BLOCKED_FEATURE |
| PAR-053 | `growth.checkin.streak_bonus_nex` | DECIMAL/NEX | 连签奖励 | C3/new-event snapshot | BLOCKED_FEATURE |
| PAR-054 | `growth.checkin.lucky_multiplier_max` | DECIMAL/倍 | 随机倍数上限 | C3 | BLOCKED_FEATURE |
| PAR-055 | `growth.checkin.lucky_1_5_pct` | DECIMAL/% | 1.5× 概率 | C3 | BLOCKED_FEATURE |
| PAR-056 | `growth.checkin.lucky_2_pct` | DECIMAL/% | 2× 概率；概率和必须校验 | C3 | BLOCKED_FEATURE |
| PAR-057 | `growth.checkin.broken_hours` | INTEGER/小时 | 连签中断窗口 | C2/new-event | NEEDS_RULE_APPROVAL |
| PAR-058 | `growth.checkin.revive_cards` | INTEGER/张 | 补签卡规则 | C2/new-event | NEEDS_RULE_APPROVAL |
| PAR-059 | `growth.earn_milestone.tick_interval_seconds` | INTEGER/秒 | 里程碑计算节奏 | C1/dynamic | NEEDS_RULE_APPROVAL |
| PAR-060 | `growth.withdraw_nex_gate.min_balance_nex` | DECIMAL/NEX | 提现 NEX 门槛 | C3/new-intent | BLOCKED_FEATURE |
| PAR-061 | `withdrawal.nex_gate.min_balance_nex` | DECIMAL/NEX | 旧/镜像 key | C3 | ALIAS_RETIRE → PAR-060 |
| PAR-062 | `growth.withdraw_nex_gate.hold_days` | INTEGER/天 | NEX 持有门槛 | C3/new-intent | BLOCKED_FEATURE |
| PAR-063 | `withdrawal.nex_gate.hold_days` | INTEGER/天 | 旧/镜像 key | C3 | ALIAS_RETIRE → PAR-062 |
| PAR-064 | `growth.voucher.sku_options` | ARRAY/SKU | 优惠券可用 SKU | C2/new-voucher snapshot | NEEDS_RULE_APPROVAL |
| PAR-065 | `growth.sunset.exclusions` | ARRAY/object | 日落排除对象 | C3/versioned | NEEDS_RULE_APPROVAL |
| PAR-066 | `commission/cooling-days` | INTEGER/天 | 佣金冷却，多消费者共享 | C3/new-event snapshot | BLOCKED_FEATURE |
| PAR-067 | `team.ui.F.unilevel.depthGate` | INTEGER/层 | 网络佣金深度 | C3 | BLOCKED_FEATURE |
| PAR-068 | `team.ui.F.unilevel.depthGateRank` | ENUM | 解锁层级的等级 | C3 | BLOCKED_FEATURE |
| PAR-069 | `team.ui.F.pool.ratio` | DECIMAL/% | 领导池注入比例 | C3 | BLOCKED_FEATURE |
| PAR-070 | `team.ui.F.pool.unlockVRank` | ENUM | 领导池解锁等级 | C3 | BLOCKED_FEATURE |
| PAR-071 | `team.ui.F.pool.monthlyCap` | DECIMAL/月 | 月度上限，币种待定 | C3 | BLOCKED_FEATURE |
| PAR-072 | `team.ui.F.binary.matchRate` | DECIMAL/% | 二元匹配率 | C3 | BLOCKED_FEATURE |
| PAR-073 | `team.ui.F.binary.threshold` | DECIMAL/业务量 | 结算阈值 | C3 | BLOCKED_FEATURE |
| PAR-074 | `team.ui.F.binary.paused` | BOOLEAN | 二元结算暂停 | C4 | BLOCKED_FEATURE |

### 3.5 Kill-Switch、Geo 与应急控制

| ID | canonical key | 类型 | 关闭时语义 | 恢复要求 | 当前状态 |
|---|---|---|---|---|---|
| PAR-075 | `killswitch.withdraw` | ENUM STRING (`enabled`/`disabled`) | `disabled` 禁止提现写入；查询和对账仍可用；缺失当前实现默认为 `enabled` | 状态健康、对账、审批、灰度 | ACTIVE_FACT / MISSING-FAIL-OPEN GAP |
| PAR-076 | `emergency.killswitch.withdraw` | ENUM STRING (`enabled`/`disabled`) | 旧提现开关；当前 canonical 优先且不比较冲突 | 迁移期双读不一致即关闭、告警并拒绝恢复 | ALIAS_RETIRE → PAR-075 |
| PAR-077 | `killswitch.exchange` | ENUM STRING (`enabled`/`disabled`) | `disabled` 关闭兑换；缺失当前实现默认为 `enabled` | 许可/功能阻断关闭后才可恢复 | BLOCKED_FEATURE |
| PAR-078 | `emergency.killswitch.exchange` | ENUM STRING (`enabled`/`disabled`) | 旧兑换开关；不得把 `true` 解释为“关闭” | 双读不一致失败关闭 | ALIAS_RETIRE → PAR-077 |
| PAR-079 | `killswitch.staking` | ENUM STRING (`enabled`/`disabled`) | `disabled` 关闭新锁仓/按批准策略处理存量 | 法律/资产/对账/审批 | BLOCKED_FEATURE |
| PAR-080 | `J.killswitch.staking` | ENUM STRING (`enabled`/`disabled`) | 旧锁仓开关 | 双读不一致失败关闭 | ALIAS_RETIRE → PAR-079 |
| PAR-081 | `killswitch.genesis` | ENUM STRING (`enabled`/`disabled`) | `disabled` 关闭发行/购买/排放 | 法律/发行/披露/审批 | BLOCKED_FEATURE |
| PAR-082 | `J.killswitch.genesis` | ENUM STRING (`enabled`/`disabled`) | 旧 Genesis 开关 | 双读不一致失败关闭 | ALIAS_RETIRE → PAR-081 |
| PAR-083 | `killswitch.trial` | ENUM STRING (`enabled`/`disabled`) | `disabled` 关闭新 Trial；存量按快照/安全策略 | DEC-015 + 影响预览 | NEEDS_RULE_APPROVAL |
| PAR-084 | `emergency.killswitch.trial` | ENUM STRING (`enabled`/`disabled`) | 旧 Trial 开关 | 双读不一致失败关闭 | ALIAS_RETIRE → PAR-083 |
| PAR-085 | `emergency.geo.j4.block.required` | BOOLEAN | 强制 Geo 阻断；服务端失败关闭 | 地区法律批准 + 多层 Geo 测试 | ACTIVE_FACT |
| PAR-086 | `emergency.tamper.alert.threshold` | INTEGER/次或分数 TBD | 篡改告警阈值 | 安全审批与基线回放 | NEEDS_RULE_APPROVAL |
| PAR-087 | `risk.bankrun-yellow-pct` | DECIMAL/% | 银行挤兑黄线，代码范围 5–50；缺失/越界/畸形当前静默回落 20，不满足全局 fail-closed | 风险/财务审批 | NEEDS_RULE_APPROVAL / IMPLEMENTATION GAP |
| PAR-088 | `risk.bankrun-red-pct` | DECIMAL/% | 银行挤兑红线，代码范围 10–80；需与黄线联动，非法组合当前静默回落 20/40 | 风险/财务审批 | NEEDS_RULE_APPROVAL / IMPLEMENTATION GAP |
| PAR-089 | `risk.bankrun-threshold-version` | INTEGER | B5 阈值版本 | 与 087/088 原子更新 | ACTIVE_FACT |

### 3.6 App OTP 发送与 D5 提现实键（补充核对）

| ID | canonical key | 类型/单位 | 消费/语义 | 风险/生效 | 当前状态 |
|---|---|---|---|---|---|
| PAR-090 | `auth.risk.otp_send_cooldown_seconds` | INTEGER/秒 | App 注册/登录 OTP 发送冷却；范围 30–300、缺失/畸形/越界回落 60；按 `countryCode:phone` 哈希主体 | C3/dynamic | ACTIVE_FACT / FALLBACK GAP |
| PAR-091 | `auth.risk.otp_send_window_minutes` | INTEGER/分钟 | App OTP 滑动窗口；范围 5–60、缺失/畸形/越界回落 15；与 PAR-006 非别名 | C3/dynamic | ACTIVE_FACT / FALLBACK GAP |
| PAR-092 | `auth.risk.otp_send_window_limit` | INTEGER/次 | App OTP 窗口发送上限；范围 2–20、缺失/畸形/越界回落 5 | C3/dynamic | ACTIVE_FACT / FALLBACK GAP |
| PAR-093 | `auth.risk.otp_send_day_limit` | INTEGER/次 | App OTP 单日发送上限；范围 5–50、缺失/畸形/越界回落 10 | C3/dynamic | ACTIVE_FACT / FALLBACK GAP |
| PAR-094 | `withdrawal.daily_count_limit` | INTEGER/次/日 | D5 App 强制读取的唯一业务权威：每日次数 | C3/dynamic | ACTIVE_FACT / CANONICAL |
| PAR-095 | `withdrawal.max_balance_pct` | DECIMAL/比例 | D5 单次余额比例上限，范围 `(0,1]` | C3/new-intent | ACTIVE_FACT / CANONICAL |
| PAR-096 | `withdrawal.fee_rate` | DECIMAL/比例 | D5 网络费率，代码上限 `0.05` | C3/new-intent snapshot | ACTIVE_FACT / CANONICAL |
| PAR-097 | `withdrawal.fee_min_usdt` | DECIMAL/USDT | D5 最低网络费 | C3/new-intent snapshot | ACTIVE_FACT / CANONICAL |
| PAR-098 | `withdrawal.fee_max_usdt` | DECIMAL/USDT | D5 最高网络费，不得低于最低费 | C3/new-intent snapshot | ACTIVE_FACT / CANONICAL |
| PAR-099 | `withdrawal.nex_fee_offset_rate` | DECIMAL/比例 | D5 NEX 抵扣率；相关代币功能仍受合规门禁 | C3/new-intent snapshot | ACTIVE_FACT / CANONICAL |
| PAR-100 | `withdrawal.min_usdt` | DECIMAL/USDT | D5 最低提现额 | C3/new-intent | ACTIVE_FACT / CANONICAL |
| PAR-101 | `withdrawal.trc20.enabled` | BOOLEAN | TRC20 网络可用性 | C4/dynamic | ACTIVE_FACT / CANONICAL |
| PAR-102 | `withdrawal.erc20.enabled` | BOOLEAN | ERC20 网络可用性 | C4/dynamic | ACTIVE_FACT / CANONICAL |
| PAR-103 | `withdrawal.d5.version` | INTEGER | D5 参数变更版本；当前仅锁定/递增 canonical，尚无持续 mirror 比较任务 | C3/dynamic | ACTIVE_FACT / DRIFT-SENTINEL IMPLEMENTATION GAP |
| PAR-104 | `wallet.withdrawal.daily_count_limit` | NUMBER | PAR-094 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-094 |
| PAR-105 | `wallet.withdrawal.max_balance_pct` | NUMBER | PAR-095 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-095 |
| PAR-106 | `wallet.withdrawal.fee_rate` | NUMBER | PAR-096 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-096 |
| PAR-107 | `wallet.withdrawal.fee_min_usdt` | NUMBER | PAR-097 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-097 |
| PAR-108 | `wallet.withdrawal.fee_max_usdt` | NUMBER | PAR-098 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-098 |
| PAR-109 | `wallet.withdrawal.nex_fee_offset_rate` | NUMBER | PAR-099 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-099 |
| PAR-110 | `wallet.withdrawal.min_usdt` | NUMBER | PAR-100 临时只写镜像，禁止业务读取 | C3 | ALIAS_RETIRE → PAR-100 |
| PAR-111 | `wallet.withdrawal.trc20.enabled` | BOOLEAN | PAR-101 临时只写镜像，禁止业务读取 | C4 | ALIAS_RETIRE → PAR-101 |
| PAR-112 | `wallet.withdrawal.erc20.enabled` | BOOLEAN | PAR-102 临时只写镜像，禁止业务读取 | C4 | ALIAS_RETIRE → PAR-102 |

D5 变更必须在一个受审计操作中更新 canonical 与临时镜像，携带 expectedVersion；任何部分失败回滚整组。漂移哨兵持续比较两组值，发现不一致立即阻断放宽类写入。回滚写入新的 canonical 版本，再镜像；完成全部消费者与数据库存量扫描后删除 `wallet.withdrawal.*`。

## 4. 当前结构性风险

| 风险 ID | 发现 | 后果 | 收口规则 |
|---|---|---|---|
| CFG-G01 | `killswitch.*`、`emergency.killswitch.*`、`J.killswitch.*` 多套别名 | 两端读取不同值，误恢复高风险功能 | 每类选一个 canonical；迁移期双读一致、单写 canonical，最终删除别名消费者 |
| CFG-G02 | 增长/H1 当前月存在多套 key | Phase、奖励、提现冷却和报表错位 | 建单一节奏对象及版本，消费者读同一快照 |
| CFG-G03 | `config_value` 可承载 NUMBER/BOOLEAN/JSON/STRING，但缺统一 schema registry | 畸形值被各服务不同解析 | key 注册 JSON schema、单位、缺失/畸形行为和合同测试 |
| CFG-G04 | 奖励、NEX、行情、APY/排放类参数存在但功能合规阻断 | 修改参数可能意外对外启用 | 参数状态与市场/功能门禁相与；配置不能绕过服务端功能禁用 |
| CFG-G05 | 当前价、周曲线、波动与“pump probability”可制造虚构市场 | 用户误导、操纵风险 | 删除人为价格生成设计；只接批准、可追溯、过期失败关闭的价格源 |
| CFG-G06 | 费用、限额、门槛、奖励变更缺统一存量/新对象生效规则 | 历史订单被重算、用户预览失真 | 交易创建时快照；存量迁移必须单独方案和用户披露 |
| CFG-G07 | Kill-Switch 只用布尔值不足以表达方向、原因、审批、TTL | 永久忘记恢复或未经授权恢复 | 使用控制对象：state/reason/actor/ticket/effectiveAt/expiresAt/version |
| CFG-G08 | 缺少参数对声明/隐私/客服/商店材料的反向索引 | 改数字后对外文案失真 | 每 key 关联 CLM、KB、市场、字段和验收用例 |
| CFG-G09 | `KillSwitchState` 当前缺失默认开启，canonical/legacy 冲突只取 canonical | 缺 key 或漂移可能误恢复高风险能力 | 修复为显式状态对象；缺失、未知、冲突均 fail-closed 并告警，恢复必须审批 |
| CFG-G10 | 银行挤兑阈值解析失败会静默使用 20/40 | 错误配置被掩盖且运营误以为配置已生效 | 在修复前标记实现缺口；写入端严格范围/关系校验，读取异常告警并采用经批准的阻断策略 |
| CFG-G11 | App OTP 发送参数缺失、畸形或越界会静默使用 60 秒/15 分钟/5 次/10 次 | 错误配置不被发现，且与 registration-risk facade 的 PAR-006/007 易混用 | 两路径分别注册消费者和指标；解析回退告警，禁止互当别名，按风险批准缺失策略 |

### 4.1 可机读注册表最低列

当前 Markdown 摘要不能替代可执行合同。进入实现时必须为每个 PAR 输出机器可读记录，至少包含：`canonicalKey`、`aliases`、`consumers`、`valueType/schema`、`unit/precision/range`、`defaultSource/value`、`missingBehavior`、`malformedBehavior`、`snapshotBoundary`、`approvalPolicy`、`expectedVersion`、`rollbackVersion`、`metrics` 和 `claimIds`。CI 校验代码常量、数据库 key 和注册表三者差异，未登记消费者或同 key 不同解析均阻断候选。

## 5. 变更闭环

1. **提案**：提交 canonical key、当前/目标值、方向、理由、数据依据、受影响人数/金额/国家和不可逆影响。
2. **预览**：在快照数据上计算对象差异；参数越收紧/放宽分别标识，不能只看平均值。
3. **审批**：按 C0–C4 执行 RBAC 与 maker/checker；幂等键和 expectedVersion 必填。
4. **生效**：获得全局配置临界区锁；写入新版本、effectiveAt 和 A2；需要传播则发布 A4。
5. **验证**：读取回显、服务消费者、数据库、跨域结果、刷新重登、并发冲突、畸形/缺失值失败关闭。
6. **观察**：比较变更前后成功率、拒绝率、资产差异、投诉、告警和分群影响；不以总量掩盖小群体异常。
7. **回滚**：写入新回滚版本，不覆盖历史；涉及已创建交易/奖励时按补偿流程处理，不能仅改回当前值。
8. **复盘**：记录假设、实际、偏差与重新打开阈值；参数长期无消费者则退役。

## 6. 参数验收用例

- 合法最小/最大/边界内值，超界、NaN、Infinity、空、错误单位、未知枚举、畸形 JSON。
- 缺 key、别名与 canonical 冲突、缓存旧值、A/B 两实例读取不同版本。
- 两运营员同版本并发、幂等键同载荷复用、同 key 不同载荷复用。
- 计划生效跨时区、服务重启、调度重复、回滚、消息重复/乱序/丢失。
- 新对象快照与存量对象不变；必须动态收紧的安全参数验证例外路径。
- 菜单/按钮/API/数据权限和 A2/A4；没有写权限角色不得通过直接 API 修改。
- Kill-Switch 收紧、查询/对账可用、恢复审批、Geo 多层执行和失败关闭。

本文登记 `PAR-001`–`PAR-112`。下一步应从实际数据库导出所有 `nx_config_item` key，与本目录做“未登记 key、无消费者 key、多消费者不同解析”三类差异扫描，并生成第 4.1 节机器注册表。
