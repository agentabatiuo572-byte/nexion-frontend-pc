# NEXION 术语与多语言词典 v1

> **现行裁决(2026-08-07)**:全项目已取消 KYC、钱包配对、C4 与 K5；本文相关旧字段、门禁、用例、权限或流程仅保留为历史基线，不得作为现行实现、运营或验收依据。

> 目标：让 App、PC、客服、PRD、事件和 API 对同一业务对象使用同一名字，降低“同词异义”和翻译漂移。
> 语言：中文 `zh`、英语 `en`、越南语 `vi`。品牌、代币、协议字段不翻译。
> 状态：业务基线；越南语合规、金融与商店文案上线前仍须母语审校，不得用机器翻译直接发布。

## 1. 使用规则

1. 代码标识、事件名、状态枚举、货币精度与展示文案分层管理；翻译不能改变服务端合同。
2. `NEXION`、`NEX`、`USDT`、`Nova`、`Genesis`、`KYC`、`MFA`、`API`、`ID`、`UTC` 保留原文；大小写不得变化。
3. 中文与越南语为受管文案必填，英语按当前后台能力可选；App 三语言包必须保持 key 集与占位符集一致。
4. 金额、APY、收益、排名、稀缺性和倒计时必须来自实时字段，不得把营销形容词写进权威字段。
5. 禁止把 `pending` 一律译为“处理中”：它可能是待审核、待支付、待上链或待确认，必须按对象选词。
6. 状态词使用“已/待/失败/取消”表达事实，不用“马上、绝对、安全、稳赚”等承诺词。

## 2. 核心业务词典

`代码/事件词`是推荐稳定标识；已经上线的不同标识须通过兼容映射迁移，不得静默改合同。

| ID | 领域 | 代码/事件词 | 中文 zh | English en | Tiếng Việt vi | 释义与使用边界 |
|---|---|---|---|---|---|---|
| TERM-001 | 品牌 | `NEXION` | NEXION | NEXION | NEXION | 品牌名，不翻译、不变大小写 |
| TERM-002 | 资产 | `NEX` | NEX | NEX | NEX | 平台代币符号，不写“币价保证” |
| TERM-003 | 资产 | `USDT` | USDT | USDT | USDT | 计价/结算资产符号 |
| TERM-004 | 账户 | `user` | 用户 | User | Người dùng | 使用产品的自然人账户；后台管理员另称“运营账号” |
| TERM-005 | 账户 | `user_no` | 用户编号 | User ID | Mã người dùng | 可展示的业务编号，不等于数据库主键 |
| TERM-006 | 账户 | `account_status` | 账户状态 | Account status | Trạng thái tài khoản | 账户整体可用性，不能与 KYC 状态混用 |
| TERM-007 | 账户 | `active` | 正常 | Active | Đang hoạt động | 当前可用；不表示所有子能力均开放 |
| TERM-008 | 账户 | `frozen` | 已冻结 | Frozen | Đã đóng băng | 暂停受管动作，须展示理由与恢复出口 |
| TERM-009 | 账户 | `closed` | 已注销 | Closed | Đã đóng tài khoản | 账户生命周期终态；不代表法定账本被物理删除 |
| TERM-010 | 安全 | `session` | 登录会话 | Session | Phiên đăng nhập | 单设备登录凭据生命周期 |
| TERM-011 | 安全 | `mfa` | 多因素认证 | Multi-factor authentication | Xác thực đa yếu tố | 首次出现可带缩写 MFA |
| TERM-012 | 安全 | `revoke_session` | 撤销会话 | Revoke session | Thu hồi phiên đăng nhập | 让指定会话立即失效，不等于删除设备 |
| TERM-013 | KYC | `kyc` | 身份验证（KYC） | Identity verification (KYC) | Xác minh danh tính (KYC) | 面向用户优先说“身份验证”，后台可用 KYC |
| TERM-014 | KYC | `kyc_pending` | 待审核 | Pending review | Đang chờ xét duyệt | 材料已提交但未决 |
| TERM-015 | KYC | `kyc_approved` | 已通过 | Approved | Đã phê duyệt | KYC 通过，不等于交易必然通过 |
| TERM-016 | KYC | `kyc_rejected` | 未通过 | Not approved | Không được phê duyệt | 用户侧避免惩罚性“拒绝”，须给下一步 |
| TERM-017 | 资金 | `wallet` | 钱包 | Wallet | Ví | NEXION 账户内资产视图；外部链上钱包需显式加“外部” |
| TERM-018 | 资金 | `available_balance` | 可用余额 | Available balance | Số dư khả dụng | 可用于当前动作的余额，不含冻结/待结算 |
| TERM-019 | 资金 | `ledger_balance` | 账本余额 | Ledger balance | Số dư sổ cái | 服务端权威账本金额，非展示缓存 |
| TERM-020 | 资金 | `deposit` | 充值 | Deposit | Nạp tiền | 外部资产进入 NEXION；银行入金可用“银行转账充值” |
| TERM-021 | 资金 | `withdrawal` | 提现 | Withdrawal | Rút tiền | NEXION 资产转出，不用“退款”代替 |
| TERM-022 | 资金 | `pending_review` | 待审核 | Pending review | Chờ xét duyệt | 需要人工/规则审核 |
| TERM-023 | 资金 | `processing` | 处理中 | Processing | Đang xử lý | 已进入执行链，结果尚未确定 |
| TERM-024 | 资金 | `completed` | 已完成 | Completed | Đã hoàn tất | 业务终态；链上交易另核对确认数 |
| TERM-025 | 资金 | `failed` | 失败 | Failed | Thất bại | 明确失败且可安全重试时使用；未知结果不得标失败 |
| TERM-026 | 资金 | `result_unknown` | 结果待确认 | Result pending confirmation | Kết quả đang chờ xác nhận | 超时/断网后无法判断是否成功，禁止诱导重复提交 |
| TERM-027 | 资金 | `reconciliation` | 对账 | Reconciliation | Đối soát | 比较内部账本、支付/银行/链上来源并处理差异 |
| TERM-028 | 资金 | `coverage_ratio` | 兑付覆盖率 | Payout coverage ratio | Tỷ lệ đảm bảo chi trả | B1 权威指标；不得简写为“收益率” |
| TERM-029 | 商城 | `sku` | SKU | SKU | SKU | 可售最小库存单元；对用户可显示“规格” |
| TERM-030 | 商城 | `order` | 订单 | Order | Đơn hàng | 购买交易对象 |
| TERM-031 | 商城 | `trade_in` | 以旧换新 | Trade-in | Thu cũ đổi mới | 旧设备折抵新设备，不译为普通“回收” |
| TERM-032 | 商城 | `delist` | 下架 | Delist | Ngừng niêm yết | 停止新售，不删除历史订单或库存事实 |
| TERM-033 | 设备 | `device` | 设备 | Device | Thiết bị | 物理/虚拟设备业务对象；登录手机称“登录设备” |
| TERM-034 | 设备 | `device_model` | 手机型号 | Device model | Mẫu thiết bị | 型号信息，不等于稳定硬件 ID |
| TERM-035 | 设备 | `capability_score` | 设备能力评分 | Device capability score | Điểm năng lực thiết bị | 基于信号的分层展示/判定；不得称真实 AI 算力证明 |
| TERM-036 | 设备 | `online` | 在线 | Online | Trực tuyến | 最近心跳在有效窗内，不等于任务正在执行 |
| TERM-037 | 设备 | `offline` | 离线 | Offline | Ngoại tuyến | 心跳过期；不直接推导故障原因 |
| TERM-038 | 设备 | `inventory` | 设备库存 | Device inventory | Kho thiết bị | 已拥有但未激活/未运行的设备集合 |
| TERM-039 | 团队 | `referral` | 推荐关系 | Referral | Quan hệ giới thiệu | 邀请人与被邀请人的归属关系 |
| TERM-040 | 团队 | `direct_referral` | 直属成员 | Direct referral | Thành viên trực tiếp | 仅一层直接邀请，不用“下线” |
| TERM-041 | 团队 | `team_tree` | 团队树 | Team tree | Cây đội nhóm | 层级关系视图，隐私字段必须最小化 |
| TERM-042 | 团队 | `v_rank` | V 等级 | V Rank | Hạng V | 业务等级名，`V` 保留；不是监管评级或信用评分 |
| TERM-043 | 团队 | `commission` | 佣金 | Commission | Hoa hồng | 规则计算的分销收入，须与奖励/返现区分 |
| TERM-044 | 团队 | `quota` | 配额 | Quota | Hạn mức | 可用数量/额度上限，必须写明周期与单位 |
| TERM-045 | 金融产品 | `staking` | 锁仓 | Staking | Khóa tài sản | 用户侧优先“锁仓”；首次出现可写“锁仓（Staking）” |
| TERM-046 | 金融产品 | `apy` | 预估年化收益率 | Estimated APY | APY ước tính | 必须带“预估/可变”，不得写保证收益 |
| TERM-047 | 金融产品 | `position` | 持仓 | Position | Vị thế | 单笔锁仓/产品头寸，不等于可用余额 |
| TERM-048 | 金融产品 | `maturity` | 到期 | Maturity | Đáo hạn | 产品约定周期终点 |
| TERM-049 | 金融产品 | `compound` | 复投 | Reinvest | Tái đầu tư | 将可用收益再次投入；不得默认勾选或隐瞒风险 |
| TERM-050 | 金融产品 | `genesis` | Genesis | Genesis | Genesis | 产品专名，不翻译 |
| TERM-051 | 增长 | `trial` | 试用 | Trial | Dùng thử | 有开始、宽限、到期和退出规则 |
| TERM-052 | 增长 | `voucher` | 代金券 | Voucher | Phiếu ưu đãi | 仅可按规则抵扣，不是可提现余额 |
| TERM-053 | 增长 | `coupon` | 优惠券 | Coupon | Mã giảm giá | 优惠凭证；若产品不区分 voucher/coupon 应统一一个词 |
| TERM-054 | 增长 | `campaign` | 运营活动 | Campaign | Chiến dịch | 有受众、时窗、内容和效果归因的活动对象 |
| TERM-055 | 内容 | `notification` | 通知 | Notification | Thông báo | 系统/业务消息总称；推送是送达通道之一 |
| TERM-056 | 内容 | `push_notification` | 推送通知 | Push notification | Thông báo đẩy | 操作系统级推送，不等同 App 内消息 |
| TERM-057 | 内容 | `risk_disclosure` | 风险披露 | Risk disclosure | Công bố rủi ro | 版本化合规正文，不称“免责声明”来削弱责任 |
| TERM-058 | 内容 | `acknowledgement` | 确认知悉 | Acknowledgement | Xác nhận đã đọc hiểu | 表示用户确认阅读，不等同无条件同意全部处理 |
| TERM-059 | 应急 | `kill_switch` | 紧急熔断开关 | Kill switch | Công tắc dừng khẩn cấp | 平台能力止血控制；用户侧说明具体不可用能力 |
| TERM-060 | 应急 | `geo_block` | 地域限制 | Geographic restriction | Hạn chế theo khu vực | 基于法域/地区限制，不使用歧视性措辞 |
| TERM-061 | 风控 | `risk_score` | 风险评分 | Risk score | Điểm rủi ro | 内部风控信号，不是用户信用分 |
| TERM-062 | 风控 | `risk_cluster` | 风险簇 | Risk cluster | Cụm rủi ro | 共享地址/设备等关系聚类，须可人工复核 |
| TERM-063 | 风控 | `manual_review` | 人工复核 | Manual review | Xét duyệt thủ công | 自动规则之后的人审出口 |
| TERM-064 | 风控 | `appeal` | 申诉 | Appeal | Khiếu nại | 用户对限制/决定提出复核请求 |
| TERM-065 | 客服 | `support_ticket` | 客服工单 | Support ticket | Phiếu hỗ trợ | 异步问题单，有优先级、Owner 和 SLA |
| TERM-066 | 客服 | `conversation` | 客服会话 | Support conversation | Cuộc trò chuyện hỗ trợ | 实时/准实时对话，不与工单状态混用 |
| TERM-067 | 平台 | `audit_log` | 审计日志 | Audit log | Nhật ký kiểm toán | 高敏操作的不可变证据，不是普通应用日志 |
| TERM-068 | 平台 | `outbox_event` | 事件发件箱记录 | Outbox event | Bản ghi sự kiện outbox | 保证业务写入与事件发布可恢复的一致性记录 |
| TERM-069 | 平台 | `idempotency_key` | 幂等键 | Idempotency key | Khóa idempotency | 同一意图重试去重；不得跨不同 payload 复用 |
| TERM-070 | 平台 | `version_conflict` | 版本冲突 | Version conflict | Xung đột phiên bản | CAS 冲突；提示刷新后重试，不能覆盖他人修改 |

## 3. 状态文案组合规则

| 场景 | 正确结构 | 示例 | 禁止 |
|---|---|---|---|
| 未知结果 | 事实 + 避免重复动作 + 查询出口 | “结果待确认，请勿重复提交；可在提现记录中查询。” | “失败，请重试” |
| 权限不足 | 能力边界 + 申请路径，不泄露敏感对象 | “你没有调整费率的权限，请联系财务负责人。” | “接口 403” |
| 状态冲突 | 当前状态 + 允许动作 | “订单已取消，不能再次支付。” | “操作异常” |
| 并发冲突 | 被他人更新 + 刷新动作 | “内容已被更新，请刷新后比较新版本。” | 静默覆盖 |
| 风控限制 | 受限能力 + 可理解理由码 + 申诉入口 | “提现暂不可用，需要人工复核。” | 暴露规则阈值/给出犯罪定性 |
| 合规阻断 | 地域/披露/KYC 具体门槛 + 下一步 | “完成身份验证后可继续提现。” | “账号有问题” |

## 4. 禁用词与替代表达

| 禁用/慎用 | 风险 | 推荐表达 |
|---|---|---|
| 保本、稳赚、零风险、保证收益 | 金融承诺与误导 | 预估、可变、存在损失风险，展示计算依据 |
| 全网最高、永久、绝对安全 | 无法持续证明 | 截至某时点的可核验比较；说明范围 |
| AI 算力（当实际仅为展示评分） | 夸大技术事实 | 设备能力评分 / 展示算力；说明信号与限制 |
| 下线 | 贬损且多义 | 直属成员、团队成员 |
| 黑名单用户 | 污名化 | 受限名单 / 风险名单；内部理由码 |
| 失败（结果未知时） | 诱导重复提交 | 结果待确认 |
| 删除（实际只下架/停用） | 混淆生命周期 | 下架、停用、归档、注销，按真实动作 |
| 通过 KYC 即安全 | 错误安全推断 | 身份验证已通过；交易仍受独立规则检查 |
| 免费（存在条件/后续收费） | 隐瞒条件 | 试用；明确期限、条件和到期后结果 |
| 实时（存在刷新/延迟） | 不真实承诺 | 更新于 HH:mm；预计延迟 X（由配置给出） |

## 5. i18n 工程门禁

1. 三语言文件 key 集必须相同；受管后台发布至少满足 `zh + vi`，若 App 对应 key 已存在 `en`，三者同步。
2. `{amount}`、`{count}`、`{date}` 等占位符集合必须完全一致；不得翻译变量名或改变数值单位。
3. 复数、日期、数字、货币由格式化器处理，不把 `$`、逗号、日期顺序硬编码进句子。
4. API enum 不直接展示；先映射 i18n key。未知 enum fail closed，显示“未知状态”并上报告警，不能回显原始内部值给用户。
5. 链接、换行、富文本标签必须进入允许列表；翻译不得注入 HTML、协议 URL 或脚本。
6. 截断测试覆盖 320px、字体放大、越南语长词、金额 12 位、用户名 64 字符和 RTL 非目标语言降级。
7. 翻译变更必须生成 key diff、占位符 diff、不可翻译词 diff、三端截图和回滚版本。

## 6. 决策与待清理项

| ID | 问题 | 默认决策 | Owner |
|---|---|---|---|
| TERM-OQ-01 | `voucher` 与 `coupon` 是否为两个业务对象 | 若规则/账本不同则保留；否则统一为“优惠券”并迁移旧 key | H/E 产品 |
| TERM-OQ-02 | 用户侧 `staking` 主词 | 默认“锁仓（Staking）”，后续页面仅“锁仓” | G/法务 |
| TERM-OQ-03 | “算力”是否与真实计算能力一致 | 未有可验证作业前统一“设备能力评分/展示算力” | E/架构/法务 |
| TERM-OQ-04 | PC 当前中文界面是否上线多语言 | 本词典先约束内容与业务对象；PC 壳国际化另立计划 | PC Owner |
| TERM-OQ-05 | 英语在 I2/I4/I5/I7 是否必填 | 当前后台多处为可选；面向英语市场前必须升级硬门 | 内容/市场 |
| TERM-OQ-06 | 越南语母语审校人和 SLA | 上线前必须指定，不允许开发自行批准金融/合规文案 | 内容/法务 |

## 7. 维护流程

新增术语必须提交：业务对象、唯一中文名、en/vi、代码标识、禁用同义词、示例页面、Owner。I6 发布时执行三语言/占位符/保留词校验；变更经确认理由、版本和 A2 审计；App、PC、客服模板与 PRD 在同一发布批次引用同一词条版本。
