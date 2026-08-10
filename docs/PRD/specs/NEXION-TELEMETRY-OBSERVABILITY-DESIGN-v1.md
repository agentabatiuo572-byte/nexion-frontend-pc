# NEXION 埋点与可观测性设计 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 目标：用同一条可追踪证据链回答“用户做了什么、系统是否成功、业务事实是否一致、何时需要告警”。
> 现状边界：后端已有 `X-Trace-Id`/MDC/A2 审计与大量 outbox 事件，但常规 Actuator 只暴露 health/info，App 未见正式第三方分析/崩溃 SDK 接线。本文件定义目标合同，不把规划项冒充已上线能力。

## 1. 四类信号与职责

| 信号 | 回答的问题 | 权威性 | 典型保存 |
|---|---|---|---|
| 业务事件 | 对象发生了什么状态变化 | 由业务事务 + outbox 产生，最高 | A4/事件仓库；按业务保存类 |
| 审计事件 | 谁以什么权限和理由做了什么 | A2 append-only，高敏问责权威 | R4 |
| 产品埋点 | 用户看见/点击/放弃了什么 | 行为分析，不可替代业务终态 | 原始 R1，聚合后 P1 |
| 技术遥测 | 请求/依赖/进程是否健康 | 运行诊断，不可替代账本 | 指标、日志、trace 按 R1 |

一次高敏写操作的闭环应为：客户端 `interaction_id` → PC BFF/API `trace_id` → 业务单号/幂等键 → 数据事务 → A2 审计 + outbox → 消费终态 → 用户查询/通知。任何一环不能单独宣称业务成功。

## 2. 统一事件合同

### 2.1 Envelope

```json
{
  "event_id": "uuid",
  "event_name": "withdrawal.completed",
  "event_version": 1,
  "occurred_at": "2026-08-04T12:34:56.789Z",
  "observed_at": "2026-08-04T12:34:56.900Z",
  "source": "backend",
  "environment": "prod",
  "service": "nexion-backend",
  "app_version": null,
  "platform": "server",
  "locale": null,
  "trace_id": "...",
  "interaction_id": null,
  "session_id_hash": null,
  "actor_type": "system",
  "actor_id_hash": null,
  "aggregate_type": "WITHDRAWAL",
  "aggregate_id": "WD-...",
  "sequence": 4,
  "idempotency_key_hash": "...",
  "schema_ref": "a4://withdrawal.completed/1",
  "attributes": {}
}
```

### 2.2 字段规则

- `event_id` 全局唯一；生产者重试保持不变。消费者以它去重，业务幂等仍按业务键执行。
- `event_name` 使用小写 `object.action`；过去已存在的大小写/下划线事件先登记 alias，不在消费者未迁移时直接改名。
- `event_version` 只在不兼容 schema 变化时递增；新增可选字段走兼容变更与 registry 审批。
- `occurred_at` 为业务发生时间，`observed_at` 为平台接收时间；迟到/乱序用二者判断。
- `trace_id` 沿用后端请求链；异步消费者新建 span 但保留原 trace link。
- 用户/管理员/会话 ID 默认 hash 或内部代理键；原始手机号、邮箱、IP、证件、钱包、token、自由文本禁止进入通用埋点。
- 金额用十进制定点字符串并带 `asset`，禁止浮点；报表统一存最小单位或明确 scale。
- `reason_code` 采用枚举；自由理由只进受限审计，不进低权限指标标签。

### 2.3 Cardinality 与标签

指标 label 只允许低基数：environment、service、route template、method、status class、error_code、domain、platform、app_version major/minor、region、dependency。用户 ID、业务单号、trace ID、URL 原始 path、错误 message 禁止作为指标 label，只存在日志/trace 字段中。

## 3. 命名与 Registry 门禁

1. 事件先登记后生产；登记项含 Owner、目的、触发原子点、schema、PII 分级、消费者、保存期、采样、SLO/告警影响和废弃计划。
2. “按钮点击”不叫 `order.completed`；产品动作与业务终态分开，如 `checkout.submit_clicked` 与 `order.created`。
3. 成功事件只在权威事务提交后产生；失败/拒绝事件包含稳定 `error_code`，不把异常 message 当字段。
4. 事件 schema 变更通过 A4 管理动作并写 A2 审计；破坏性变化必须双写/双读迁移。
5. 未知事件/版本进入隔离队列并告警，不能静默丢弃或用空字段灌入 BI。
6. 开发/验收/生产数据以 `environment + RunID` 隔离；测试事件不得计入正式 KPI。

## 4. 核心事件目录

表内名称是**目标 canonical**。`观察到的 alias`来自当前后端或 PRD 时予以保留；空白表示需实现前确认，不表示现有代码已发送。

| ID | 域 | canonical event | 原子触发点 | 必需业务属性 | 主要消费/告警 | 观察到的 alias/备注 |
|---|---|---|---|---|---|---|
| EVT-001 | A | `auth.login_succeeded` | 会话成功签发 | `auth_method,mfa_used,platform` | 登录成功率/安全 | 需与现有 auth 事件对齐 |
| EVT-002 | A | `auth.login_failed` | 认证明确拒绝 | `reason_code,platform` | 爆破/可用性 | 不含手机号/IP 原文 |
| EVT-003 | A | `auth.login_locked` | 锁定事务提交 | `reason_code,expires_at` | 安全告警 | 后端已见同名 outbox |
| EVT-004 | A | `admin.session_revoked` | 会话撤销提交 | `target_session_hash,reason_code` | 安全/A2 | 后端已见同名 alias |
| EVT-005 | A | `admin.role_permissions_changed` | RBAC 版本提交 | `role_code,permissions_delta_count` | 权限漂移告警 | 需 registry |
| EVT-006 | A | `admin.config_changed` | 配置版本发布 | `config_key,before_hash,after_hash` | 配置审计/回滚 | 各域具体 alias 归并 |
| EVT-007 | A | `admin.audit_exported` | 审计导出任务创建 | `scope,record_count` | 数据外发告警 | A2 自身也须审计 |
| EVT-008 | A | `outbox.delivery_changed` | 投递状态变化 | `event_family,status,retry_count` | 积压/死信 | 技术事件，不进业务 KPI |
| EVT-009 | B | `treasury.coverage_snapshot_created` | B1 快照完成 | `ratio,asset,liability,total_reserve` | 覆盖率门/告警 | 精确字段需财务确认 |
| EVT-010 | B | `funnel.snapshot_created` | 漏斗聚合提交 | `window,segment,step_counts` | B3/L | 聚合事件，不含用户明细 |
| EVT-011 | B | `phase.changed` | H1/平台 phase 生效 | `from,to,effective_at` | 全域配置关联 | 需配置版本关联 |
| EVT-012 | B | `risk.radar_signal_raised` | B5 聚合阈值越界 | `signal_code,severity` | 风控告警 | 不复制原始敏感 payload |
| EVT-013 | C | `user.registered` | 用户事务提交 | `channel,locale,region` | 注册漏斗 | 不含联系方式原文 |
| EVT-014 | C | `user.status_changed` | C2 状态提交 | `from,to,reason_code` | 冻结/恢复告警 | 当前有 C2/K1 大写 alias |
| EVT-015 | C | `wallet.ledger_posted` | 账本分录提交 | `biz_type,asset,amount,direction` | 资产对账 | 后端已见同名 |
| EVT-016 | C | `admin.balance_adjusted` | 资产调整批准入账 | `adjustment_no,asset,amount,direction` | SEV-0 监控/A2 | 后端已见同名 |
| EVT-017 | C | `kyc.status_changed` | KYC 权威状态提交 | `from,to,provider_code,reason_code` | KYC 漏斗/风险 | `admin.kyc_status_changed` alias |
| EVT-018 | C | `user.account_deletion_requested` | 注销请求受理 | `request_no,region` | 隐私 SLA | 新增 |
| EVT-019 | C | `user.account_deletion_completed` | 编排完成 | `request_no,retention_exception_codes` | 隐私证明 | 新增 |
| EVT-020 | D | `deposit.detected` | 外部入金唯一引用确认 | `deposit_no,channel,asset,amount` | 入金漏斗/对账 | 必须先唯一去重 |
| EVT-021 | D | `deposit.credited` | 账本入账提交 | `deposit_no,ledger_id,asset,amount` | 到账成功率 | 与 EVT-015 关联 |
| EVT-022 | D | `deposit.reconciliation_mismatch_found` | 对账差异落单 | `channel,asset,difference_bucket` | SEV-0/1 | 禁止高基数金额 label |
| EVT-023 | D | `withdrawal.requested` | 提现请求提交 | `withdrawal_no,asset,amount,network` | 提现漏斗 | 受众/地址不入通用事件 |
| EVT-024 | D | `withdrawal.reviewed` | 审核决定提交 | `decision,reason_code,risk_band` | 审核时长/拒绝率 | 审核人细节在 A2 |
| EVT-025 | D | `withdrawal.submitted_to_channel` | 外部唯一引用取得 | `withdrawal_no,channel,external_ref_hash` | 渠道成功率 | 结果未知前不发 completed |
| EVT-026 | D | `withdrawal.completed` | 渠道终态 + 账本结算 | `withdrawal_no,asset,amount,channel` | 核心 SLI/用户通知 | exactly-once 业务效果 |
| EVT-027 | D | `withdrawal.result_unknown` | 查询窗后仍未知 | `withdrawal_no,channel,reason_code` | SEV-1/人工队列 | 禁止自动重发 |
| EVT-028 | E | `sku.status_changed` | SKU 状态提交 | `sku_id,from,to` | 商城可售性 | `DEVICE_SKU` family alias 待映射 |
| EVT-029 | E | `order.created` | 订单事务提交 | `order_no,sku_id,amount,asset` | 购买漏斗 | 已见 `E4_ORDER` family |
| EVT-030 | E | `order.paid` | 支付与订单终态提交 | `order_no,payment_channel` | 支付转化/履约 | 当前动态 eventType 待登记 |
| EVT-031 | E | `order.refunded` | 退款账本提交 | `order_no,refund_no,asset,amount` | 退款率/对账 | 后端已见同名 |
| EVT-032 | E | `device.status_changed` | 设备状态提交 | `device_id,from,to,reason_code` | 在线/解绑漏斗 | E5 动态 alias 待映射 |
| EVT-033 | E | `device.capability_calibrated` | 服务端接受校准结论 | `tier,score_band,signal_quality` | 设备分层/反作弊 | 不上传原始 GPU 字符串到 BI |
| EVT-034 | E | `tradein.status_changed` | 以旧换新状态提交 | `tradein_no,from,to` | 转化/履约 | E3 family alias |
| EVT-035 | F | `referral.bound` | 推荐关系首次提交 | `referral_type,channel` | 邀请漏斗/防环 | 用户 ID 用内部聚合键 |
| EVT-036 | F | `rank.changed` | V Rank 提升/降级提交 | `from,to,reason_code` | 等级漏斗/奖励 | 一次只升一级规则 |
| EVT-037 | F | `commission.posted` | 佣金账本提交 | `commission_type,asset,amount,depth` | 分销对账 | 与 ledger 关联 |
| EVT-038 | G | `staking.position_opened` | 持仓提交 | `product_id,term,asset,amount` | 产品漏斗/覆盖率 | server gate 后发生 |
| EVT-039 | G | `staking.position_matured` | 到期结算提交 | `product_id,asset,payout` | 到期成功率 | 定时任务幂等 |
| EVT-040 | G | `exchange.completed` | 双资产账本原子提交 | `pair,side,base_amount,quote_amount` | 交易成功率/对账 | 禁止只凭客户端回执 |
| EVT-041 | G | `genesis.order_completed` | Genesis 成交提交 | `product_id,asset,amount` | 产品漏斗 | 命名与普通 order 分开 |
| EVT-042 | H | `trial.started` | 试用资格消费提交 | `trial_type,phase` | 试用漏斗 | 防重复领取 |
| EVT-043 | H | `trial.converted` | 关联正式订单完成 | `trial_type,sku_id,days_to_convert` | 核心转化 | 由业务事实关联，不靠点击 |
| EVT-044 | H | `campaign.joined` | 参与关系提交 | `campaign_id,segment` | 活动漏斗 | 不把 segment 放高基数 label |
| EVT-045 | H | `voucher.granted` | 发券事务提交 | `voucher_id,source,face_value` | 发放/核销 | `H7_VOUCHER_GRANTED` alias |
| EVT-046 | H | `voucher.redeemed` | 订单核销提交 | `voucher_id,order_no,discount` | 核销率/对账 | 与订单原子或可补偿 |
| EVT-047 | I | `content.published` | 版本发布提交 | `content_type,version,locales` | 发布健康/A2 | 各 I 域 alias 归并 |
| EVT-048 | I | `notification.sent` | 渠道接受批次/单条 | `campaign_id,channel,priority` | 送达分母 | 与 `push_sent` alias 映射 |
| EVT-049 | I | `notification.clicked` | 客户端真实打开 CTA | `campaign_id,channel,cta_id` | CTR/归因 | 防机器人/重复点击规则 |
| EVT-050 | I | `disclosure.acknowledged` | 服务端保存版本/法域 | `version,jurisdiction` | re-ack 覆盖率 | `disclosure.acked` alias 可兼容 |
| EVT-051 | I | `learning.course_completed` | quiz/完成规则提交 | `course_id,version,reward_nex` | 完课/发奖 | 奖励 ledger 单独关联 |
| EVT-052 | I | `conversation.status_changed` | 会话状态提交 | `category,from,to` | 客服实时性 | I9/客服共用 |
| EVT-053 | J | `admin.kill_switch_changed` | J1 状态提交 | `key,from,to,trigger_code` | 立即告警/全域关联 | `J1_KILLSWITCH_CHANGED`/`ADMIN_KILLSWITCH_TOGGLED` aliases |
| EVT-054 | J | `admin.geo_block_changed` | 地域规则提交 | `country_or_region,from,to` | 立即告警 | 不把用户 IP 放事件 |
| EVT-055 | J | `risk.tamper_detected` | 服务端拒绝篡改请求 | `endpoint_group,reason_code` | 安全告警 | PRD blocking registry 项 |
| EVT-056 | J | `admin.emergency_playbook_executed` | playbook 步骤/整单提交 | `playbook_id,step,result` | SEV 时间线 | PRD blocking registry 项 |
| EVT-057 | K | `risk.cluster_detected` | 风险簇版本提交 | `cluster_type,risk_band,member_count_band` | 风控队列 | 当前 multi-account family alias |
| EVT-058 | K | `risk.decision_changed` | 自动/人工决定提交 | `decision_type,from,to,reason_code` | 决策漂移/申诉 | 模型版本必关联 |
| EVT-059 | K | `risk.appeal_resolved` | 申诉终态提交 | `outcome,reason_code,turnaround_bucket` | 公平性/客服 | 不放自由文本 |
| EVT-060 | L | `analytics.pipeline_lag_observed` | 水位计算完成 | `pipeline,lag_bucket,status` | 数据新鲜度告警 | 技术指标事件 |
| EVT-061 | L | `report.generated` | 报表任务完成 | `report_type,window,row_count` | BI 可用性 | 导出另写 A2 |
| EVT-062 | L | `experiment.assignment_created` | 首次稳定分组 | `experiment_id,variant` | 实验分母 | 曝光需真实看见，不等于分组 |
| EVT-063 | M | `support.ticket_created` | 工单提交 | `category,priority,source` | 工单量/SLA | 不含正文 |
| EVT-064 | M | `support.ticket_escalated` | 跨域升级提交 | `category,to_domain,reason_code` | 升级率/拥堵 | 与业务单号通过受限链接关联 |
| EVT-065 | M | `support.ticket_resolved` | 解决结论提交 | `category,resolution_code,turnaround_bucket` | 首解率/时效 | resolved 不等于 closed |
| EVT-066 | M | `support.conversation_transferred` | 坐席转交提交 | `category,from_queue,to_queue,reason_code` | 转交率 | 不含会话正文 |

## 5. 产品行为事件

行为事件只用于体验和漏斗，不作为资金/权限/状态权威。

| event | 触发 | 必需属性 | 防误用 |
|---|---|---|---|
| `screen.viewed` | 页面真正可见并停留达到最小阈值 | `screen_id,entry_point,load_state` | 不以路由开始代替可见；不可直接算业务成功 |
| `action.clicked` | 用户真实点击可用控件 | `screen_id,action_id,object_type` | 禁止发送输入框内容 |
| `form.validation_failed` | 客户端/服务端可行动校验失败 | `form_id,field_code,reason_code,layer` | 不发字段值 |
| `operation.feedback_shown` | 成功/失败/未知反馈被展示 | `operation,feedback_type,error_code` | 需与业务事件核对假成功 |
| `permission.block_shown` | 菜单/按钮/接口/数据权限阻断 | `layer,permission_code,screen_id` | 不泄露目标数据是否存在 |
| `empty_state.viewed` | 权威加载完成且对象为空 | `screen_id,empty_reason` | 加载失败不能报空状态 |
| `search.performed` | 查询提交并返回 | `screen_id,filter_keys,result_count_band` | 不发搜索词/手机号/ID 原文 |
| `export.requested` | 用户确认导出 | `report_type,scope,row_count_band` | 业务审计必须另写 A2 |
| `disclosure.scroll_completed` | 指定版本正文读到底 | `version,jurisdiction` | 不等于 acknowledged |
| `notification.opened` | 从系统通知打开 App | `campaign_id,channel,cta_id` | 与 sent/delivered 口径区分 |

App 行为事件默认 consent/政策策略待法务确认；安全、反欺诈、交易必要事件与可选分析必须分通道，不得因退出分析而关闭必要安全日志。

## 6. SLI、SLO 与告警候选

以下阈值是**起步候选**，上线前需以 2–4 周正常基线、业务风险和错误预算校准。无基线时先告警观察，不承诺外部 SLA。

| SLI | 计算 | 候选目标 | 页/工单条件 |
|---|---|---|---|
| 管理 API 可用性 | 非预期 5xx/真实请求总数 | ≥99.9%/30d | 5m 错误率 >2% 且 ≥20 请求：SEV-1 候选 |
| 管理 API 延迟 | route template p95/p99 | p95 <500ms（查询）；写按域基线 | p95 连续 10m 超基线 2×：SEV-2 |
| 登录成功率 | succeeded/(succeeded+明确 failed)，排除错误密码等用户原因另看 | 系统原因 ≥99.5% | 系统失败 5m >3%：SEV-1 |
| outbox 新鲜度 | now - 最老未投递 occurred_at | p95 <60s | 最老 >5m 或 dead-letter 增长：SEV-1 |
| 充值到账率 | credited/外部成功 detected | ≥99.9%，窗口按渠道 | 任一重复入账或账本差：SEV-0 |
| 提现终态率 | completed+明确 failed / submitted_to_channel | 按渠道 SLA | `result_unknown` 增长或重复外部引用：SEV-0/1 |
| 账本对账差异 | 内部账本 - 外部/渠道 | 0 未解释差异 | 非零且非已批准差异单：SEV-0 |
| KYC 技术成功率 | 供应商受理且有明确终态/提交 | ≥99%，排除业务拒绝 | provider 错误 10m >5%：SEV-1 |
| 设备在线新鲜度 | 有效窗内心跳设备/应在线设备 | 由设备类型基线 | 同版本/地区突降 >20%：SEV-1 |
| 通知送达/点击 | delivered/sent，clicked/delivered | 按 channel/campaign | critical 发送失败 >1%：SEV-1 |
| 客服首响/解决 | created→first_response/resolved | 按优先级目标 | P0/P1 超 SLA 或队列增长 2×：升级 |
| 数据管道新鲜度 | observed_at - occurred_at p95 | 核心 <5m，报表按批次 | KPI 水位停滞 2 个周期：SEV-2；资产报表：SEV-1 |

告警必须包含：环境、服务/域、开始时间、当前值/阈值、基线、Runbook 链接、最近部署/配置版本、样本 trace ID 和静默/合并键。禁止只有“出错了”的告警。

## 7. 漏斗与口径

### 7.1 注册与激活

`screen.viewed(register)` → `action.clicked(register_submit)` → `user.registered` → `auth.login_succeeded` → `device.capability_calibrated`/首个权威激活动作。

- 分母用真实可见注册页，不用 App 启动；成功用 `user.registered`，不使用按钮点击。
- 以匿名 `funnel_id` 在注册成功后受控关联用户代理键；关联窗口和删除策略需登记。

### 7.2 购机

`screen.viewed(store)` → `screen.viewed(sku_detail)` → `checkout.submit_clicked` → `order.created` → `order.paid` → 履约终态。

- 代金券、试用转化、以旧换新、campaign 作为归因维度；归因规则（first/last touch、窗口）固定版本。
- 支付超时不落 `failed`，直到服务端明确终态。

### 7.3 充值/提现

充值：发起页可见 → 请求提交 → `deposit.detected` → `deposit.credited`。
提现：发起页可见 → `withdrawal.requested` → `reviewed` → `submitted_to_channel` → `completed/result_unknown/failed`。

业务成功率只取服务端终态；客户端页面退出不等于流失，可能等待外部结果。

### 7.4 试用转化

`trial.offer_viewed` → `trial.started` → 有效使用事件 → `trial.converted` 或明确到期/取消。

转化归因必须关联正式订单完成，不能以点击“购买”作为转化。

### 7.5 通知与内容

`notification.sent` → provider delivered（若渠道提供）→ `notification.opened/clicked` → 目标业务事件。内容发布健康以发布事件、客户端取到版本和目标业务结果三层观察，避免只优化点击率。

## 8. 仪表盘

| 看板 | 最小内容 | Owner |
|---|---|---|
| 全局运行 | 请求量、5xx、p95、登录、outbox、DB/Redis/MinIO/MQ | A/SRE |
| 资产安全 | 覆盖率、充值/提现漏斗、未知结果、对账差异、调整金额 | B/D/财务 |
| 账户与 KYC | 注册、登录、锁定、KYC provider/状态、会话撤销 | C/K |
| 商城设备 | SKU 可售、下单支付、退款、设备在线/离线、校准质量 | E |
| 分销增长 | 邀请、V Rank、佣金、活动、试用、券发放/核销 | F/H |
| 金融产品 | 开仓、到期、交易、Genesis、失败原因、覆盖率 gate | G/B |
| 内容通知 | 发布版本、三语言完整率、送达/点击、披露 ack、课程完课 | I |
| 应急风控 | kill/geo 当前态与变更、篡改、风险簇、申诉、模型版本 | J/K |
| 数据质量 | 管道 lag、schema quarantine、重复/乱序、重算和报表任务 | L |
| 客服 | 队列、首响/解决、重开/转交/升级、按业务域根因 | M |

每个看板显示“数据更新于、数据窗口、口径版本、延迟状态”。数据源未知或过期时显示 degraded/unknown，不以 0 冒充正常。

## 9. 日志、Trace 与错误合同

- 结构化日志最少：timestamp、level、service、environment、trace_id、span_id、route template、method、status、duration_ms、error_code、release；body 默认不记录。
- API 错误返回稳定 `code`、用户可行动 message、`traceId`；500 不返回堆栈/SQL/内部类名。
- PC BFF 保留上游 trace 关联和真实网络失败；不得把上游 500 包成畸形 200。
- 慢请求 trace 对数据库、Redis、MinIO、MQ、外部渠道分 span；秘密 header/body 由采集端先清洗。
- App 崩溃与性能采集若接第三方 SDK，先完成 SDK BOM、采样、用户关联、删除与商店隐私声明；未登记不接入。

## 10. 数据质量与对抗校验

| 检查 | 规则 | 失败动作 |
|---|---|---|
| 完整性 | 每个业务终态有 event_id、aggregate、occurred_at、version | 隔离 + 告警，不灌 KPI |
| 唯一性 | `event_id` 唯一；业务事件按 aggregate/sequence 检查 | 消费去重并调查生产者 |
| 顺序 | 同 aggregate sequence 单调；允许跨聚合乱序 | 缺口等待窗后补偿/告警 |
| 新鲜度 | observed - occurred 在域 SLO 内 | 标记看板 stale，不显示 0 |
| 一致性 | 账本/订单/提现等事件与业务表抽样对账 | 资产差异 SEV-0 |
| Schema | registry 中 event/version 与 payload 匹配 | quarantine，禁止宽松强转 |
| 隐私 | 禁止字段/模式扫描：token、密码、证件、卡号、自由文本 | 阻断发送 + 安全告警 |
| 环境 | prod KPI 排除非 prod 与 RunID | 污染即重算并复盘 |

墨菲对抗场景：事件重复 10 次、延迟 24h、同聚合乱序、缺中间事件、200 畸形 payload、schema 新字段/删字段、时钟偏移、消费者崩溃重启、trace 跨异步丢失、隐私字段误塞 attributes。每类都必须有自动测试和可观察失败。

## 11. 分阶段落地

1. **P0 证据链**：锁定 envelope、registry、trace 传播、日志清洗；把账本/充值/提现/权限/kill/A2/outbox 纳入核心告警。
2. **P1 业务健康**：注册、KYC、订单、设备、试用、内容/通知、客服事件对齐 canonical/alias，建域看板。
3. **P2 产品分析**：在隐私选择与数据清单完成后接行为事件、漏斗与实验；不先上 SDK 再补声明。
4. **P3 优化**：基线校准 SLO、错误预算、自动回滚、合成探针、数据质量持续验证。

## 12. 待决问题

| ID | 必须决策 | Owner |
|---|---|---|
| OBS-OQ-01 | 指标/日志/trace/事件的具体平台与部署拓扑 | 架构/SRE |
| OBS-OQ-02 | canonical 事件与现有大写/下划线 alias 的迁移表 | A4/各域 |
| OBS-OQ-03 | 每类事件保存期、采样率、原始/聚合权限 | 数据/隐私 |
| OBS-OQ-04 | 正式 SLO、错误预算、Pager 轮值和自动回退阈值 | 管理层/SRE |
| OBS-OQ-05 | App 可选分析 consent 策略和第三方 SDK 选择 | 产品/法务/App |
| OBS-OQ-06 | notification delivered 的供应商真实性与去重口径 | I/供应商 |
| OBS-OQ-07 | 漏斗跨端匿名关联、归因窗口和删除机制 | L/隐私 |
| OBS-OQ-08 | 资产事件与账本抽样/全量对账频率 | B/D/财务 |
