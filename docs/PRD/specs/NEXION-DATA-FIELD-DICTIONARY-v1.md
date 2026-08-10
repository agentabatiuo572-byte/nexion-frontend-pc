# NEXION 字段级数据字典 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 文档状态：逻辑合同基线  
> 事实来源：`D:\workspace\nexion-backend` 当前 Java Entity、Mapper 与服务端权威边界；本文不替代 MySQL migration、`information_schema` 或 API schema。  
> 目标：统一字段含义、权威来源、敏感度、不可变约束、消费边界和删除/保留规则，避免同名异义、客户端权威态和静默精度损失。

## 1. 约定

### 1.1 敏感度

| 级别 | 示例 | 默认控制 |
|---|---|---|
| S0 公开 | 已批准公开内容、SKU 名称 | 完整性与发布审计 |
| S1 内部 | 配置说明、非个人运营指标 | 员工最小权限 |
| S2 个人 | 昵称、语言、普通设备信息 | 数据作用域、导出审计、界面脱敏 |
| S3 敏感 | 电话、IP、钱包地址、KYC、风险、工单 | 字段级权限、默认遮罩、导出理由 |
| S4 秘密/资产 | 密码哈希、Token、私钥、OTP、原始支付回调 | 不返回前端、不进普通日志、加密/专用密钥管理 |

### 1.2 保留类别

| 代码 | 适用 | 当前决策 |
|---|---|---|
| R1 | 账号与产品履约 | 账号存续期 + 删除流程；法定例外需逐字段批准 |
| R2 | 资金、订单、税务、争议 | 时长由实体/市场法律与财务政策决定，当前 `TBD-DEC-022` |
| R3 | 安全、风控、审计 | 以防欺诈/事件调查目的限定，当前 `TBD-DEC-022` |
| R4 | 分析、体验、营销 | 最短必要期；同意撤回/账号删除后删除或不可逆匿名化 |

所有时长未获批准前，不得在隐私政策或客服话术中填写具体天数。

### 1.3 `BaseEntity` 通用字段与可选版本字段

| 字段 ID | 物理字段 | 类型 | 敏感度 | 含义/约束 | 保留 |
|---|---|---|---|---|---|
| FLD-001 | `id` | BIGINT | S1 | 服务端生成的内部主键；不得在 UI 中推断业务含义 | 随对象 |
| FLD-002 | `created_at` | DATETIME | S1 | 服务端创建时间，统一时区存储；客户端时间不可覆盖 | 随对象 |
| FLD-003 | `updated_at` | DATETIME | S1 | 权威最后修改时间；不得作为唯一并发控制 | 随对象 |
| FLD-004 | `is_deleted` | BOOLEAN/TINYINT | S1 | 逻辑删除标记；不等于数据权利请求已完成 | 随对象 |
| FLD-005 | `version` | BIGINT/INTEGER | S1 | 可选对象字段，并非 `BaseEntity` 通用字段；若对象用于 CAS，提交时必须携带预期版本，冲突返回 409 | 随对象 |

## 2. 账号与身份

### 2.1 `nx_user`（用户主档权威表）

| ID | 字段 | 类型/格式 | 敏感 | 含义与不可变约束 | 消费者 | 保留/删除 |
|---|---|---|---|---|---|---|
| FLD-006 | `country_code` | ISO 国家代码候选 | S2 | 注册/身份国家；不能由 IP 单独覆盖，格式标准待确认 | Geo、KYC、内容 | R1 |
| FLD-007 | `phone` | E.164 候选 | S3 | 登录/联系标识；列表默认脱敏；唯一性与换绑规则需合同化 | Auth、客服 | R1；删除时去标识/法定例外 |
| FLD-008 | `password_hash` | 密码哈希 | S4 | 只存强哈希；永不导出/返回/记录；重置产生新哈希 | Auth | R3 安全边界 |
| FLD-009 | `nickname` | Unicode 文本 | S2 | 用户展示名；需长度、控制字符、冒用和审核规则 | App、客服 | R1 |
| FLD-010 | `avatar_url` | URL/对象引用 | S2 | 应优先保存受控对象引用；不得信任任意远程 URL | App、内容 | R1；删除对象 |
| FLD-011 | `referral_code` | 不区分大小写代码 | S2 | 服务端唯一、不可通过客户端重算 | 增长 | R1/R2 依奖励事实 |
| FLD-012 | `sponsor_user_id` | BIGINT FK | S3 | 推荐关系权威 ID；一经产生的可变性和申诉规则待 DEC-014/037 | 增长、风控 | R2/R3 |
| FLD-013 | `sponsor_code` | 代码快照 | S2 | 推荐发生时的代码证据，不作为当前关系唯一权威 | 增长、审计 | R2 |
| FLD-014 | `kyc_status` | 枚举投影 | S3 | 用户表投影；KYC 权威记录为 `nx_kyc_profile`，两者不一致失败关闭 | KYC、钱包 | R2/R3 |
| FLD-015 | `user_level` | 枚举 | S2 | 用户业务等级；来源规则必须版本化 | 增长、风控 | R1/R2 |
| FLD-016 | `v_rank` | 枚举 | S2 | V-Rank；不得由前端本地累计决定 | 增长 | R1/R2 |
| FLD-017 | `status` | 枚举 | S3 | 账号生命周期；规范枚举和冻结/恢复状态机待 DEC-012 | Auth、全域 | R1/R3 |
| FLD-018 | `language` | BCP 47 候选 | S2 | 用户语言偏好，不等于法律地区 | App、内容 | R1 |
| FLD-019 | `region` | 地区代码 | S2 | 运营地区投影；必须注明来源与可信度 | Geo、内容 | R1/R3 |
| FLD-020 | `bio` | Unicode 文本 | S2 | 用户自述内容；需输入清洗与删除 | App、客服 | R1 |
| FLD-021 | `timezone` | IANA 时区候选 | S2 | 仅用于展示/日界线规则；不得以模糊缩写存储 | App、任务 | R1 |

### 2.2 `nx_user_security` 与 `nx_user_session`

| ID | 表.字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-022 | `nx_user_security.user_id` | BIGINT FK | S3 | 一对一关联用户；禁止客户端指定他人 ID | R3 |
| FLD-023 | `two_factor_enabled` | BOOLEAN | S3 | 服务端 MFA 事实；开启/关闭需强验证和审计 | R3 |
| FLD-024 | `login_fail_count` | INTEGER | S3 | 风控计数；原子更新、成功后按策略重置 | R3 |
| FLD-025 | `password_reset_required` | BOOLEAN | S3 | 强制改密门禁；不得只靠 UI 提示 | R3 |
| FLD-026 | `password_changed_at` | DATETIME | S3 | 用于旧会话/Token 吊销判断 | R3 |
| FLD-027 | `last_login_at` | DATETIME | S3 | 最近成功登录服务端时间，不含失败尝试 | R3 |
| FLD-028 | `last_login_ip` | IP | S3 | 默认遮罩；不用于单独确定国家或身份 | R3 |
| FLD-029 | `nx_user_session.user_id` | BIGINT FK | S3 | 会话归属，不从客户端请求体接受 | R3 |
| FLD-030 | `refresh_token_id` | 随机 ID/哈希 | S4 | 不存可直接使用的明文 Refresh Token | R3 |
| FLD-031 | `device_name` | 文本 | S2 | 用户可理解的会话设备名；不可当稳定设备身份 | R3 |
| FLD-032 | `client_ip` | IP | S3 | 会话建立/活动 IP；默认遮罩 | R3 |
| FLD-033 | `expires_at` | DATETIME | S3 | 服务端过期时间；过期后任何端都不得续用 | R3 |
| FLD-034 | `revoked_at` | DATETIME? | S3 | 非空即吊销；账号冻结后按 DEC-018 传播 | R3 |
| FLD-035 | `last_active_at` | DATETIME | S3 | 服务端可信活动时间，写入频率受控 | R3 |
| FLD-036 | `session_chain_id` | 随机 ID | S4 | Refresh Token 轮换族；用于检测复用 | R3 |
| FLD-037 | `rotated_to_id` | ID | S4 | 指向新会话/Token ID，防并发重放 | R3 |
| FLD-038 | `rotation_redeemed_at` | DATETIME? | S4 | 旧 Token 已兑换事实；重复兑换触发族吊销 | R3 |

### 2.3 `nx_kyc_profile` 与 `nx_kyc_status_history`

| ID | 表.字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-039 | `nx_kyc_profile.user_id` | BIGINT FK | S3 | KYC 主体；当前代码按用户取未删除唯一记录 | R2/R3 |
| FLD-040 | `status` | `NONE/PENDING/APPROVED/REJECTED` 候选 | S3 | 权威 KYC 状态；实际允许枚举需由 DEC-012 统一 | R2/R3 |
| FLD-041 | `country` | 国家代码 | S3 | 证件/核验国家，不等于当前所在地 | R2/R3 |
| FLD-042 | `paired_address` | 钱包地址 | S3 | 已核验配对地址；展示需截断，换绑需强验证 | R2/R3 |
| FLD-043 | `network` | 链/网络枚举 | S3 | 必须来自受治理白名单；地址格式与网络成对校验 | R2/R3 |
| FLD-044 | `paired_at` | DATETIME | S3 | 配对完成的服务端时间 | R2/R3 |
| FLD-045 | `trigger_source` | 原因枚举 | S3 | 触发/最近变更来源，不能用自由文本代替原因码 | R3 |
| FLD-046 | `reviewed_by/reviewed_at` | 操作者/时间 | S3 | 审核责任证据；与 A2 关联 | R3 |
| FLD-047 | `nx_kyc_status_history.before_status/after_status` | 枚举 | S3 | 不可变迁移对；必须符合状态机 | R3 |
| FLD-048 | `reason_code/reason` | 枚举 + 文本 | S3 | 机器原因和可读理由分离；不得写入证件原文 | R3 |
| FLD-049 | `evidence_ref` | 对象引用 | S3 | 指向受控证据，不在普通表保存证件内容 | R2/R3 |
| FLD-050 | `idempotency_key/ticket_id` | ID | S3 | 防重复变更并关联审批/工单 | R3 |

## 3. 资金、支付与账本

### 3.1 `nx_wallet_ledger`（资产权威流水）

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-051 | `user_id` | BIGINT FK | S3 | 账本主体 | R2 |
| FLD-052 | `biz_no` | 业务单号 | S3 | 关联订单/奖励/提现；同一业务幂等唯一性需 DB 约束 | R2 |
| FLD-053 | `biz_type` | 枚举 | S2 | 账本来源类别；未知值失败关闭 | R2 |
| FLD-054 | `asset` | 资产代码 | S2 | 资产维度；禁止把不同网络/法律性质资产混为一项 | R2 |
| FLD-055 | `direction` | `CREDIT/DEBIT` 候选 | S2 | 方向与 amount 符号规则必须唯一，禁止双重表达冲突 | R2 |
| FLD-056 | `amount` | DECIMAL | S3 | 正精度金额；不得 float；精度/scale 由资产合同决定 | R2 |
| FLD-057 | `balance_after` | DECIMAL | S3 | 该流水后的权威余额；连续性需对账 | R2 |
| FLD-058 | `status` | 枚举 | S3 | 入账事实状态；不可用 UI 文案代替 | R2 |
| FLD-059 | `remark` | 文本 | S2 | 内部说明，不存秘密/证件/完整地址 | R2 |

### 3.2 `nx_deposit_order`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-060 | `deposit_no` | 唯一业务号 | S3 | 用户可查询的入金 ID；服务端生成 | R2 |
| FLD-061 | `user_id` | BIGINT FK | S3 | 入金归属；地址归属与登录用户双校验 | R2 |
| FLD-062 | `chain_name` | 网络枚举 | S2 | 与资产、地址、确认数策略配套 | R2 |
| FLD-063 | `chain_tx_hash` | 链交易哈希 | S3 | 链内唯一/网络内查询；不视为最终成功 | R2 |
| FLD-064 | `asset` | 资产代码 | S2 | 服务端白名单 | R2 |
| FLD-065 | `amount` | DECIMAL | S3 | 链上实际金额，精度不丢失 | R2 |
| FLD-066 | `confirmations` | INTEGER | S2 | 当前确认数；与策略阈值分离 | R2 |
| FLD-067 | `status` | 枚举 | S3 | 观察、确认、入账、失败等规范状态待 DEC-012 | R2 |
| FLD-068 | `ledger_id` | BIGINT FK | S3 | 成功入账的唯一账本关联；成功态不可缺 | R2 |
| FLD-069 | `confirmed_at/credited_at` | DATETIME | S3 | 链确认与账本入账是两个事实 | R2 |
| FLD-070 | `failed_at/failure_reason` | 时间 + 原因码/文本 | S3 | 失败可解释；不得把结果未知写成最终失败 | R2/R3 |

### 3.3 `nx_withdrawal_order`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-071 | `withdrawal_no` | 唯一业务号 | S3 | 全链路幂等和查询主键 | R2 |
| FLD-072 | `user_id` | BIGINT FK | S3 | 提现归属 | R2 |
| FLD-073 | `asset/chain` | 资产/网络枚举 | S2 | 地址与网络强校验，按市场白名单 | R2 |
| FLD-074 | `amount` | DECIMAL | S3 | 用户提交总额，具体 gross/net 定义需 UI 同屏 | R2 |
| FLD-075 | `fee` | DECIMAL | S3 | 兼容字段；权威费用模型必须指明使用哪一列 | R2 |
| FLD-076 | `d2_penalty_fee_rate` | DECIMAL 比率 | S3 | 费率快照，不从当前配置回算历史 | R2 |
| FLD-077 | `d2_gross_fee` | DECIMAL | S3 | 抵扣前费用快照 | R2 |
| FLD-078 | `d2_nex_burned` | DECIMAL | S3 | 实际消耗 NEX；必须关联账本 | R2 |
| FLD-079 | `d2_nex_fee_offset_rate` | DECIMAL | S3 | 抵扣率快照；单位需显式 | R2 |
| FLD-080 | `d2_fee_waived` | DECIMAL | S3 | 减免费用，不能大于 gross fee | R2 |
| FLD-081 | `d2_actual_fee` | DECIMAL | S3 | 实收费用；`gross - waived` 等式需校验 | R2 |
| FLD-082 | `d2_net_receive` | DECIMAL | S3 | 用户预计/实际净收；提交前同版本展示 | R2 |
| FLD-083 | `target_address` | 链上地址 | S3 | 默认截断；完整值仅最小权限；换址/白名单另审 | R2/R3 |
| FLD-084 | `risk_decision_id` | BIGINT FK | S3 | 放行时绑定风险决定版本 | R2/R3 |
| FLD-085 | `chain_tx_hash` | 哈希 | S3 | 广播结果引用；非空不自动等于完成 | R2 |
| FLD-086 | `status` | 枚举 | S3 | 必须覆盖审核、广播、结果未知、完成、失败等 | R2 |
| FLD-087 | `chain_submitted_at/completed_at` | DATETIME | S3 | 广播与最终完成时间分离 | R2 |
| FLD-088 | `failed_at/failure_reason` | 时间 + 原因 | S3 | 最终失败需权威证据；用户文案与内部错误分层 | R2/R3 |
| FLD-089 | `chain_broadcast_attempts` | INTEGER | S2 | 重试次数；幂等广播且有上限 | R3 |
| FLD-090 | `next_broadcast_at` | DATETIME | S2 | 服务端调度时间 | R3 |
| FLD-091 | `last_broadcast_error` | 文本 | S3 | 脱敏；不含密钥和完整供应商响应 | R3 |
| FLD-092 | `broadcast_dead_at` | DATETIME | S3 | 进入人工/死亡队列的时间，不等于资产失败 | R2/R3 |

### 3.4 `nx_payment_record`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-093 | `payment_no/order_no` | 唯一业务号 | S3 | 支付与订单双向唯一关联规则需明确 | R2 |
| FLD-094 | `user_id` | BIGINT FK | S3 | 支付用户 | R2 |
| FLD-095 | `provider/provider_payment_id` | 枚举 + 外部 ID | S3 | 供应商引用；不得暴露密钥或内部商户号 | R2 |
| FLD-096 | `amount_usdt/currency` | DECIMAL + ISO/资产代码 | S3 | 名称与 currency 可能冲突，正式合同应改为通用 amount 或限制 currency | R2 |
| FLD-097 | `payment_status` | 枚举 | S3 | 以供应商权威查询 + 本地状态机为准 | R2 |
| FLD-098 | `checkout_url` | URL | S3 | 短期、域名白名单、防开放重定向；日志遮罩参数 | R2/最短期 |
| FLD-099 | `expires_at/expired_at` | DATETIME | S2 | 计划过期与实际过期分离 | R2 |
| FLD-100 | `callback_event_id` | 外部事件 ID | S3 | Webhook 幂等键 | R2/R3 |
| FLD-101 | `signature_status` | 枚举 | S3 | 验签失败永不改变资金状态 | R3 |
| FLD-102 | `raw_callback` | JSON/TEXT | S4 | 可能含 PII/秘密；加密、严格访问、最短保留和字段过滤 | R2/R3 |
| FLD-103 | `paid_at/failed_at` | DATETIME | S3 | 成功/最终失败事实时间 | R2 |
| FLD-104 | `failure_reason` | 原因码/文本 | S3 | 用户安全文案与内部详细错误分离 | R2/R3 |
| FLD-105 | `reconcile_attempts/last_reconcile_at/next_reconcile_at` | 计数/时间 | S2 | 结果未知对账调度 | R3 |
| FLD-106 | `last_reconcile_error` | 文本 | S3 | 脱敏；超过阈值进入告警/人工队列 | R3 |

## 4. 设备、SKU 与风险

### 4.1 `nx_user_device`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-107 | `user_id` | BIGINT FK | S3 | 设备归属；转移/解绑必须走状态机 | R1/R2 |
| FLD-108 | `source_order_no/product_id/product_code` | 引用 | S3 | 购买来源与产品快照关联 | R2 |
| FLD-109 | `product_tier/generation` | 枚举/整数 | S2 | 产品能力分类；不能决定实际收益 | R1/R2 |
| FLD-110 | `instance_no` | 唯一业务号 | S3 | 设备实例权威标识 | R1/R2 |
| FLD-111 | `name/device_type` | 文本/枚举 | S2 | 用户命名与设备类别分离 | R1 |
| FLD-112 | `gpu_model/vram_total_gb/base_power_w` | 规格 | S2 | 规格证据来源需标注；客户端探测不可覆盖已购硬件事实 | R1/R2 |
| FLD-113 | `dc_location` | 地区/站点 | S3 | 可能揭示基础设施；用户仅显示必要粒度 | R1/R3 |
| FLD-114 | `price_usdt_snapshot` | DECIMAL | S3 | 购买时价格快照，不随 SKU 当前价变化 | R2 |
| FLD-115 | `ownership_status/source_channel` | 枚举 | S3 | 所有权与来源；影响置换/售后 | R1/R2 |
| FLD-116 | `status` | 枚举 | S3 | 在线/离线不等于所有权；规范状态机待定 | R1/R2 |
| FLD-117 | `hashrate` | DECIMAL | S2 | 必须定义单位、采集/计算方法和是否实际交付 | R1/R4 |
| FLD-118 | `daily_usdt/daily_nex` | DECIMAL | S3 | 展示投影，不得替代账本；应注明已结算/估算 | R2/R4 |
| FLD-119 | `last_seen_at` | DATETIME | S3 | 在线遥测时间；可形成行为画像 | R1/R4 |
| FLD-120 | `purchased_at/activated_at/deactivated_at` | DATETIME | S3 | 生命周期事实时间，不从当前状态倒推 | R1/R2 |
| FLD-121 | `pending_deactivate` | INTEGER/BOOLEAN | S3 | 待停机命令投影；需幂等与最终状态查询 | R1/R3 |

### 4.2 `nx_admin_device_sku`

| ID | 字段组 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-122 | `sku_id/name/tier/generation` | 标识/文本 | S0/S1 | SKU 身份与代际；已售订单引用快照 | 版本化保留 |
| FLD-123 | `gpu/vram/hash_rate/power_text/datacenter` | 文本规格 | S0 | 公开前必须有供应/测试证据和统一单位 | 版本化保留 |
| FLD-124 | `price` | DECIMAL | S0 | 当前标价；币种必须另有权威字段/合同 | 版本化保留 |
| FLD-125 | `daily_earn/daily_earn_nex` | DECIMAL | S1/高风险 | 预测/展示值，不能成为账本；发布受 CLM 台账阻断 | R4/版本化 |
| FLD-126 | `share_yield_min/max/base_rate` | DECIMAL/文本 | S1/高风险 | 单位、区间和算法需定义；不得作为保证收益 | 版本化 |
| FLD-127 | `sold/stock_text` | 数量/文本 | S0 | `sold` 权威统计与营销文本分离；不可制造虚假稀缺 | 版本化 |
| FLD-128 | `features_json/ai_unlocks` | JSON/文本 | S0/S1 | 结构化 schema、未知字段失败关闭、三语内容 | 版本化 |
| FLD-129 | `lifecycle/superseded_by/status` | 枚举/引用 | S1 | 上架—下架—替代状态机；下架不改历史订单 | 永久版本链 |
| FLD-130 | `tradein_discount` | DECIMAL | S1 | 单位和适用条件必须明确，订单保存快照 | R2/版本化 |
| FLD-131 | `unlock_phase/purchase_gate_json` | 枚举/JSON | S1 | 服务端准入；客户端隐藏不足以阻断 | 版本化/R3 |
| FLD-132 | `image_asset_id/object_key/preview_url` | 对象引用 | S1 | 受控 MinIO 资源；预览 URL 可过期 | 随版本 |

#### 4.2.1 `DeviceSkuEntity` 补充物理字段（本轮代码复核）

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-170 | `tagline` | 文本 | S0/声明门禁 | SKU 营销短句；必须映射 CLM ID、语言、地区、有效期和批准截图 | 版本化保留 |
| FLD-171 | `badge` | 文本/枚举候选 | S0/声明门禁 | 徽章不得表达未经证明的稀缺、排名、认证或收益 | 版本化保留 |
| FLD-172 | `rating` | DECIMAL | S0/高风险 | 必须定义量表、样本、时间窗、舍入和是否来自真实用户；无证据不公开 | 版本化/R4 |
| FLD-173 | `reviews` | INTEGER | S0/高风险 | 评论数量必须来自权威记录并排除测试/重复，不能作为静态营销数字 | 版本化/R4 |
| FLD-174 | `ai_image_gen_per_min` | BIGINT/张每分钟 | S0/能力声明 | 固定模型、分辨率、批量、硬件、环境和统计口径；映射能力类 CLM 审核 | 版本化保留 |
| FLD-175 | `ai_llm_tokens_per_sec` | BIGINT/token 每秒 | S0/能力声明 | 固定模型、量化、上下文、输入/输出口径和测试环境；不得泛化为所有模型性能 | 版本化保留 |
| FLD-176 | `ai_video_min_per_hour` | BIGINT/视频分钟每小时 | S0/能力声明 | 固定模型、分辨率、帧率、时长和质量设置；需可复现实测 | 版本化保留 |
| FLD-177 | `ai_fine_tune_mins` | BIGINT/分钟 | S0/能力声明 | 明确数据集、模型、轮次、批量、精度、硬件和完成定义；命名需说明越小是否越好 | 版本化保留 |
| FLD-178 | `tag` | 文本/枚举候选 | S0/S1 | 与 `badge`、`tagline` 分离；结构化枚举，未知值失败关闭，发布仍受声明门禁 | 版本化保留 |

上述 AI 性能字段在缺少基准测试原始数据、测试脚本、制品版本、环境和复算结果时不得进入公开 API/页面。发布扫描必须把它们映射到 `NEXION-CLAIMS-EVIDENCE-REGISTER-v1.md`；“代码中有数值”不构成真实性证据。

### 4.3 `nx_risk_decision`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-133 | `decision_no` | 唯一业务号 | S3 | 风险决定可追溯 ID | R3 |
| FLD-134 | `user_id/biz_type/biz_no` | 引用 | S3 | 绑定具体主体和业务操作 | R2/R3 |
| FLD-135 | `region/user_level` | 快照 | S3 | 决策时上下文，不能用当前值改写历史 | R3 |
| FLD-136 | `client_ip/device_fingerprint` | IP/指纹 | S3 | 最小化、默认遮罩；持久标识受隐私/商店约束 | R3 |
| FLD-137 | `decision` | `ALLOW/REVIEW/DENY` 候选 | S3 | 未知值失败关闭；必须支持申诉/人工复核 | R3 |
| FLD-138 | `reason` | 原因码/文本 | S3 | 可解释但不泄露可被规避的全部规则 | R3 |
| FLD-139 | `risk_score` | INTEGER | S3 | 范围、版本、校准、阈值需记录；不跨模型直接比较 | R3 |
| FLD-140 | `rule_codes` | 代码集合 | S3 | 命中规则快照 | R3 |
| FLD-141 | `rule_snapshot` | JSON | S3 | 决策版本和参数；防篡改、限制敏感原始值 | R3 |
| FLD-142 | `reviewed_by/reviewed_at` | 操作者/时间 | S3 | 人工复核责任证据 | R3 |

## 5. 客服、审计与事件

### 5.1 `nx_support_ticket`

| ID | 字段 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-143 | `ticket_no/user_id` | 业务号/FK | S3 | 工单与用户；客服数据作用域强制执行 | R1/R3 |
| FLD-144 | `category/priority/status` | 枚举 | S3 | 分类、优先级、生命周期分别定义 | R1/R3 |
| FLD-145 | `title/last_message` | 文本 | S3 | 可能含敏感信息；列表摘要脱敏，全文不进普通日志 | R1/R3 |
| FLD-146 | `assigned_admin_id/name` | 操作者 | S3 | 分配权威关系；显示名只是快照 | R3 |
| FLD-147 | `user_unread_count/ops_unread_count/message_count` | INTEGER | S2 | 原子计数，可从消息重算但不静默负数 | R1 |
| FLD-148 | `last_message_at/closed_at` | DATETIME | S3 | 最近消息与关闭事实时间 | R1/R3 |
| FLD-149 | `archived/archived_at` | 布尔/时间 | S3 | 归档不等于删除，仍受权限和保留规则 | R1/R3 |
| FLD-150 | `version` | BIGINT | S1 | 工单并发 CAS；冲突需刷新 | 随工单 |

### 5.2 `nx_audit_log`

| ID | 字段组 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-151 | `trace_id/service_name` | ID/文本 | S2 | 跨服务关联；trace 不得包含用户秘密 | R3 |
| FLD-152 | `action/resource_type/resource_id` | 代码/ID | S3 | 谁对什么做了什么；动作字典版本化 | R3 |
| FLD-153 | `biz_no/user_id` | 引用 | S3 | 业务与用户关联 | R2/R3 |
| FLD-154 | `actor_id/actor_type/actor_username` | 身份快照 | S3 | 实际操作者；服务账号与人工区分 | R3 |
| FLD-155 | `client_ip` | IP | S3 | 默认遮罩，调查权限可展开 | R3 |
| FLD-156 | `method/path` | HTTP 元数据 | S2 | 路径需规范化，禁止记录 Token/query 秘密 | R3 |
| FLD-157 | `result/risk_level` | 枚举 | S2 | 操作结果与风险级别；未知值失败关闭 | R3 |
| FLD-158 | `detail_json` | JSON | S3/S4 禁止 | 只保存必要前后值/原因；字段级过滤密码、Token、证件、私钥 | R3 |

### 5.3 `nx_event_outbox`

| ID | 字段组 | 类型 | 敏感 | 含义与约束 | 保留 |
|---|---|---|---|---|---|
| FLD-159 | `event_id` | 全局唯一 ID | S2 | 生产者幂等与消费者去重键 | R3/按业务 |
| FLD-160 | `aggregate_type/aggregate_id` | 类型/ID | S3 | 事件归属对象及顺序边界 | R3/按业务 |
| FLD-161 | `event_type/event_name/family_key` | 代码 | S2 | 规范事件名和兼容族；schema 注册后发布 | R3 |
| FLD-162 | `event_ts` | DATETIME | S2 | 业务事件时间，不等于入库/发布时间 | R3 |
| FLD-163 | `phase/account_age_months/cohort` | 上下文快照 | S2/S3 | 分群需目的限制；不用于未披露画像 | R3/R4 |
| FLD-164 | `server_authoritative` | BOOLEAN | S1 | 指明是否服务端权威事实；客户端事件不得伪装为 true | R3 |
| FLD-165 | `schema_revision/schema_registered` | 版本/布尔 | S1 | schema 不存在或不兼容时失败关闭/隔离 | R3 |
| FLD-166 | `analytics_event` | BOOLEAN | S1 | 分析事件与业务事件分流；不改变业务事实 | R3/R4 |
| FLD-167 | `payload` | JSON | S3 | 最小字段、schema 校验、秘密过滤、兼容策略 | 按事件最严来源 |
| FLD-168 | `status/retry_count/next_retry_at` | 枚举/计数/时间 | S2 | 发布状态与退避；重复发布由消费者幂等消化 | R3 |
| FLD-169 | `published_at/last_error` | 时间/文本 | S3 | 发布事实与脱敏错误；失败进入告警/死信 | R3 |

## 6. 必须立即关闭的字段级缺口

| 缺口 ID | 问题 | 风险 | 关闭动作 |
|---|---|---|---|
| DFD-G01 | 金额/比率字段未在本字典中取得统一 precision、scale、舍入和单位批准 | 对账差异、少付/多付 | 按资产/币种建立 Decimal 合同与 DB 约束 |
| DFD-G02 | KYC 状态同时存在 `nx_user.kyc_status` 与 `nx_kyc_profile.status` | 双权威冲突 | 固定 profile 为权威、投影修复与一致性告警 |
| DFD-G03 | `PaymentRecord.amount_usdt` 与 `currency` 可表达冲突 | 错币种结算 | 限制 currency=USDT 或迁移为通用 `amount` |
| DFD-G04 | SKU 收益、设备 `daily_*` 与账本金额容易混为收益事实 | 误导、资产错误 | 字段/DTO 明确 `estimate/projected/settled`，UI 分层 |
| DFD-G05 | IP、指纹、原始回调、审计 JSON、工单文本可能过量保存敏感数据 | 泄露与违规保留 | 字段过滤、加密、访问审计、最短保留和扫描 |
| DFD-G06 | R1–R4 具体期限、合法基础和市场例外未批准 | 隐私政策无法签字 | 关闭 DEC-021/022/027/028/030 |
| DFD-G07 | 多个枚举仍是候选而非唯一规范合同 | 未知状态被误判 | 关闭 DEC-012，生成 schema 与兼容映射 |
| DFD-G08 | 设备“算力/收益”指标定义和采集证据未批准 | 营销误导/设备指纹 | 关闭 DEC-025/033 与 CLM-012/015/018 |
| DFD-G09 | SKU `tagline/badge/rating/reviews` 与 AI 性能字段此前未进入字段/声明门禁 | 静态营销数字或性能值被当作真实证据 | 按 FLD-170–178 补测试、来源、单位和 CLM 批准；无证据不公开 |

## 7. 字段变更闭环

1. 先登记字段 ID、业务目的、Owner、权威表、敏感度和保留类别。
2. 同步 migration、Entity/DTO/API schema、权限、导出、审计脱敏、事件 schema、隐私/商店申报。
3. 对新增个人/设备/财务字段执行必要性与供应商/跨境评估；无法说明目的不采集。
4. 数据迁移需统计空值、未知枚举、精度、重复和孤儿引用；保存前后计数及哈希。
5. 以合同、并发、异常、删除、导出、日志泄密和跨域消费测试验收。
6. 生产观察字段质量和双权威差异；超过阈值停止扩量并回滚。

本文共登记 `FLD-001`–`FLD-178`。未登记字段不等于可以自由使用；它必须先进入本流程。
