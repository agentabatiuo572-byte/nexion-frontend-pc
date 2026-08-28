# PAY-VIETQR App × 后端 × PC 对接规格 v1

> 日期：2026-07-25  
> 状态：Implemented / Verified  
> 权威依据：`Nexion_运营控制后台_开发落地规格.md` D1/D3/D4/D6、`后台产品更新日志.md` 2026-07-25、App 一期对接契约

## CAPABILITY

把 App 的 VietQR 充值从本地 mock 状态机切换为服务端单一事实源，并与 PC 的 D1 人工对账、D6 汇率配置形成同一条资金闭环：

1. PC 在 D1/D6 管理收款账户、限额、牌价、点差和锁价窗口；
2. App 只读服务端配置与报价，使用稳定 `Idempotency-Key` 创建充值意向单；
3. 后端原子锁定汇率版本、应付 VND、收款账户、唯一附言和过期时间；
4. 后端同步创建 `APP-{intentNo}` 在途投影供 D1 查看；PC 可从该付款单发起回单登记，填写银行侧唯一流水号并上传真实银行回单图片，再按 `MATCHED/ORPHAN/MISMATCH/LATE` 分类处置；
5. 对账成功在同一事务内推进 intent、对账单、钱包累计入金和 D4 不可变账本；
6. App 按当前登录用户重新读取意向单，展示服务端最终状态。

第一性原理下，资金事实只有一份：App 页面、PC 页面和回调适配器都不能自行制造“已到账”。最小实现只引入一个 canonical intent，不另建第二套订单或余额模型。

## CONSTRAINTS

### 业务不变量

- `intent_no`、`memo_code` 全局唯一；`user_id + create_idempotency_key` 唯一。
- 创建请求的金额、汇率、版本、VND 应付额、收款账户和过期时间一经落库不可被 App 修改。
- 同一幂等键与同一规范请求体返回同一 intent；同键不同金额返回 `409 IDEMPOTENCY_REQUEST_CONFLICT`。
- App 只能读取和取消自己的 intent；跨用户查询统一返回 404，避免对象存在性泄漏。
- 取消只允许 `AWAITING_PAYMENT` 且未过期状态，并使用 `expectedVersion` CAS。
- 过期由服务器时间裁决；客户端倒计时仅用于显示。
- 首笔可归属回单登记时必须原子占用 intent：精确回单进入不可取消、不可过期的 `RECEIPT_REVIEW`，差额/迟到回单进入对应复核态；财务点击时间不得改变银行 `received_at` 已确定的分类。
- App intent 创建与 D1 `INFLIGHT` 投影同事务；取消、过期或核销后关闭投影，PC 不得继续显示伪在途单。
- `CREDITED`、`CANCELLED`、`RETURNED` 为终态，重复回调或重复点击不得二次入账。
- 同一附言的第二笔独立银行流水不得重开或覆盖原 intent；它进入 `LATE` 补充回单并保留 canonical 用户/账户证据，只能登记退回，不得复用已过期锁价补入账，也不再推进原 intent。
- PC 的 `match/writeoff` 必须先锁定 canonical intent；操作员输入的 `userId` 只能校验，不能成为入账归属真源。
- 所有回单必须有全局唯一 `payment_reference`；登记前必须通过受 `finance_d1_bank_reconcile` 保护的 `POST /api/admin/finance/vietqr/receipt-evidence` 上传真实银行回单图片。服务端只接受 JPG/PNG，除核对文件头、扩展名和声明类型外，还必须完成 PNG 块结构/CRC 校验或 JPEG 完整解码、限制总像素并计算 SHA-256，再把对象保存到服务端生成的专属路径；返回的 `media:vqr_{opaqueId}` 必须在证据表中存在、属于 VietQR 回单用途且尚未绑定。登记与一次性绑定在同一事务内完成，禁止人工证据文字、截断/伪造图片、伪造路径、通用媒体引用或重复绑定；上传与绑定均记录认证操作者及高风险审计。
- 普通匹配只允许同一收款账户且实收与应付差额不超过登记当时的 D1 容差；登记完成后的调参不得反向卡死既有 `MATCHED` 回单。
- 收款账户日累计统一使用越南银行业务日 `Asia/Ho_Chi_Minh (UTC+7)`，不得受浏览器、应用或 MySQL 会话时区影响；真实回单唯一流水登记成功时即记录物理实收。超日限额时先推进当前回单复核，再熔断账户、取消该账户其余 `AWAITING_PAYMENT` intent 并关闭其在途投影；不得拒绝或扣留已经到账的用户资金。
- 所有 `OPEN` 且 `received_vnd > 0` 的真实回单（包括 `MATCHED`）进入 D3 第九类待核实入金；确认入账后才从待核实负债转入钱包负债。
- 钱包入账、`cumulative_deposit_usdt`、D4 ledger、reconciliation 和 intent 终态必须同事务成功或同事务回滚。

### 安全与隐私

- 所有 App intent 路由必须是已认证 `USER` subject；admin token、匿名请求和伪造用户 ID 均拒绝。
- 银行账号继续使用 AES-GCM 密文落库；PC 永不返回完整账号，App 仅向 intent 所属用户返回本单收款账号。
- App 请求和日志不得包含数据库 ID、钱包余额真值、后台权限或运营员身份。
- 服务端严格校验金额精度、上下限、幂等键长度、状态枚举和 CAS 版本。
- 接口错误使用真实 HTTP 400/401/403/404/409/422/503 与统一 `ApiResult` envelope；失败时 App 清除旧可操作快照，不回退 mock。

### 运行约束

- 后端：Java 17、Spring Boot、MyBatis、MySQL 8，事务边界在 application service。
- App：Vue 3、Pinia、uni-app、TypeScript；`mock` 与 `remote` 明确分流。
- PC 既有 D1/D6 页面和接口保持兼容；本阶段只收紧 D1 对账写路径，不重做页面。

## IMPLEMENTATION CONTRACT

### 数据模型：`nx_vietqr_intent`

必备字段：

| 字段 | 约束 |
|---|---|
| `intent_no` | 服务端生成，全局唯一 |
| `user_id` | 认证用户，禁止请求体传入 |
| `create_idempotency_key` / `create_request_hash` | 同用户幂等与冲突检测 |
| `requested_usdt` / `payable_vnd` | 服务端规范化与计算 |
| `locked_fx_rate_vnd_per_usdt` / `fx_quote_version` | D6 下单快照 |
| `bank_account_id` / `memo_code` | D1 账户池分配；附言全局唯一 |
| `status` | `AWAITING_PAYMENT/RECEIPT_REVIEW/CREDITED/EXPIRED/MISMATCH_REVIEW/LATE_REVIEW/CANCELLED/RETURN_PENDING/RETURNED` |
| `received_vnd` / `credited_usdt` | 仅回单/对账链写 |
| `expires_at` / `matched_at` | 服务端时间 |
| `version` | 所有状态推进 CAS |

### App API

| Method | Path | 契约 |
|---|---|---|
| GET | `/api/app/payments/config` | 返回 VietQR 可用性、限额、容差、宽限期和配置版本 |
| GET | `/api/app/payments/fx-quote?fiat=VND&asset=USDT` | 返回 D6 基准价、点差、派生报价、锁价分钟和版本 |
| POST | `/api/app/deposits/vietqr/intents` | Header 必须带 `Idempotency-Key`；body 仅 `{ usdtAmount }` |
| GET | `/api/app/deposits/vietqr/intents?limit=` | 当前用户最近意向单，支持刷新/重登恢复 |
| GET | `/api/app/deposits/vietqr/intents/{intentNo}` | 当前用户单笔状态 |
| POST | `/api/app/deposits/vietqr/intents/{intentNo}/cancel` | Header 带稳定幂等键；body `{ expectedVersion }` |

App 响应解析必须逐字段校验。畸形 2xx、未知状态、无效日期、非正金额或缺少收款账户均按协议错误失败关闭。

`INFLIGHT` 是 canonical intent 的 PC 只读投影，不是第二份资金订单。投影号固定为 `APP-{intentNo}`；其创建与 intent 同事务，取消/过期、账户停用或回单登记后软关闭。D1 的常规入口是从“待付款单”某一行点击“登记这笔回单”，页面自动带入该单分配的收款账户、附言和应付金额；顶部“登记未归属回单”只用于银行流水暂时找不到付款单的例外场景，不得默认选择第一张账户。登记写入唯一 `paymentReference`、实际收款账户、实收 VND、银行到账时间和专属上传接口生成的 `evidenceRef`，服务端按 canonical intent 分类为 `MATCHED/ORPHAN/MISMATCH/LATE`，页面不能指定入账用户。证据引用不是对象路径：登记表单只保存并提交不透明资产号；只有 `nx_vietqr_receipt_evidence` 中状态为 `AVAILABLE` 的资产号可用，登记时原子改为 `BOUND` 并记录对应对账单，任何第二次使用均失败关闭。`paymentReference` 必须提示为银行 App/网银显示的 Transaction ID、Reference No. 或 FT 流水，不是 Nexion 付款单号，也不是任意备注。凡附言直接命中 intent 的回单，银行到账时间也必须不早于该 intent 的创建时间，禁止用新附言登记历史流水。`receivedAt` 的 HTTP 契约必须是带 `Z` 或明确偏移量的 ISO-8601 绝对时间；PC 的无偏移人工输入固定按越南 `UTC+7` 解释后再发送，后端转换为统一业务时区比较 intent 创建与到期边界。回单同时持久化 `intent_transition_required`：首笔回单负责推进 intent，终态或已占用 intent 的后续独立流水只作为补充回单处置，永不重开原状态机。

### PC 对账收紧

D1 银行对账的五个用户视图必须同时显示“当前含义”和“下一步”，不能只暴露内部分类名：`INFLIGHT=待付款单`、`MATCHED=已匹配回单`、`ORPHAN=未找到付款单（原孤儿）`、`MISMATCH=信息不一致（原差额）`、`LATE=逾期 / 重复回单`。确定性业务拒绝后保留当前队列与表单上下文，不把列表清空成加载态；写操作已受理但列表回读失败时也保留旧快照，关闭本次确认弹窗，并明确提示先刷新核对、不要重复提交，不能让操作者在同一弹窗内再铸新请求号。账户不一致的 `MISMATCH` 禁止展示“按实收核销”，必须提示核对或退回；只有纯金额差异才能按实收核销。历史 intent 缺失分配账户时返回 `UNKNOWN`，页面按失败关闭显示“历史账户信息缺失”，不得误归为金额差异。

- `MATCH_CREDIT`：已绑定回单只允许使用回单内的 canonical `intentNo`，请求不得改绑；仅 `ORPHAN` 可由财务指定目标 intent。如请求携 `userId`，必须与 intent 用户一致。
- `WRITE_OFF`：只能使用 reconciliation 已绑定的 `intentNo`，禁止临时换用户。
- `RETURN`：不写钱包；首笔绑定回单按状态机推进为 `RETURNED`，补充回单只终结自身 reconciliation，不改变原 intent 终态。未绑定的 `ORPHAN` 退回不得携带 `intentNo/userId`，只能保持无归属并终结回单；只有 `MATCH_CREDIT` 可为其建立 canonical intent 归属。
- 入账前检查对账视图与 intent 状态相容、回单唯一流水号、证据编号、收款账户、canonical 锁价和版本未冲突。首笔绑定回单使用登记时的不可变分类；`LATE`（含宽限期后到账和补充回单）一律只允许退回。
- `ORPHAN` 手工匹配的银行到账时间不得早于目标 intent 创建时间，不提供可被滥用的反向时钟容差，禁止先到账流水追溯绑定后建 intent。
- 入账 USDT 永远使用 canonical intent 的锁价计算，不信任回单记录里的可变牌价。登记后已冻结为 `MATCHED/ORPHAN` 的合法资金不得被后续调低 `perTxLimitUsd` 反向卡死；`MISMATCH` 按实收核销的折算金额不得超过“原 intent 请求额与当前 D1 单笔上限”的较大值，超限只能退回并升级复核。
- 回单登记时按越南 `UTC+7` 业务日原子更新收款账户当日实收；超过日上限时账户转为 `FUSED`、停止分配新 intent，并关闭该账户其余等待单。后续结算不得再次累计，也不得因日限额拒绝已收到的资金。
- 入账后 intent、reconciliation、wallet、`cumulative_deposit_usdt`、D4 ledger 一致；任一写入行数不为 1 即整体回滚。

### 验收断言

1. PC 调整 D6 后，App 读取相同 `version` 和服务端派生报价。
2. 相同创建键并发或重放只有一条 intent；同键异参 409。
3. 用户 A 无法读取、取消或枚举用户 B 的 intent。
4. 取消与到账竞争依赖 intent 版本 CAS，只允许一个终态写入；失败方刷新服务端结果。
5. 重复 D1 核销不增加第二次钱包余额、累计入金或 ledger。
6. App 刷新/重登后从列表恢复等待、复核、成功和过期状态。
7. 断网、401、409、422、503 和畸形 200 均不展示旧单为可操作状态。
8. 到期前或宽限期内到账的回单，即使财务在宽限期后点击确认也可入账；宽限期后到账只进入 `LATE`。
9. 已成功/已取消 intent 的第二笔新银行流水进入补充 `LATE` 队列，只能登记退回，原 intent 始终保持终态且旧锁价不得复用。
10. `OPEN + MATCHED` 在确认窗口内同时计入物理储备和 D3 待核实入金，不得高估覆盖率。
11. 同一绝对到账时点分别以 UTC+7、UTC+8、UTC+9 发送时分类一致；不带偏移量的 HTTP 时间被拒绝，越南午夜前后日累计不会被 MySQL `+08:00` 会话切断。
12. 附言直接命中和 `ORPHAN` 手工匹配两条路径都不能把回单归属到其到账后才创建的 intent，即使只晚 1 秒也必须拒绝；任何可入账回单折算后不得突破 D1 单笔上限。
13. 未绑定 `ORPHAN` 的退回请求如携带任意 `intentNo/userId` 必须失败关闭；合法无目标退回不得查询、推进或改写任何 intent。
14. 回单登记未上传图片、仅提交人工输入文字、伪造 `media:` 引用、通用媒体引用、文件后缀与真实格式不符、图片截断/无法完整解码或重复使用同一证据时必须拒绝；上传中不能提交。
15. 账户不一致的回单不得出现“按实收核销”；确定性拒绝后当前分类列表仍保留，不要求人工刷新才能恢复数据。

## NON-GOALS

- 本阶段不接国际卡 PSP session、拒付/退款 UI。
- 本阶段不伪造正式银行 VietQR 二维码；provider 未返回正式 payload 前，remote App 仅展示账号、金额和附言手工转账，mock 演示点阵不得出现在 remote。
- 本阶段不接 TRC20/BEP20/ERC20 地址派发和链上监听。
- 本阶段不实现 USDT 提现地址换绑挑战。
- 本阶段不新增 PC 菜单；在既有 D1 页面增加受 `finance_d1_bank_reconcile` 保护的银行回单登记入口。
- 本阶段不把 App mock 数据迁移成真实资金记录。

## OPEN QUESTIONS

- 银行回单提供商的正式签名协议仍由 provider adapter 确认；当前已提供财务 PC 受控回单登记闭环，生产自动回调不得绕过同一分类、幂等、证据和结算服务。
- 生产流量限速由 API Gateway 还是应用内 Redis 承担，需要部署侧最终确认；应用内先以“每用户最多 5 张未过期意向单”限制资源占用。
- `RETURN_PENDING` 到 `RETURNED` 的银行实际退款回执后续单独接 provider 状态，本阶段 PC 登记退回直接落 `RETURNED`。

## HANDOFF

- 后端：先迁移 `nx_vietqr_intent`，再发布 App API 与 D1 对账收紧；发布顺序不可反转。
- App：remote 模式启用新 API，mock 模式保持现有演示引擎；remote 失败不得回退 mock。
- PC：沿用现有 D1 操作入口，确认 409/422 错误文案能区分 intent 不存在、归属不符、终态和 CAS 冲突。
- 测试：单元/SQL 合同测试先行；完成后做 MySQL 真实事务、App H5 真实请求和非 Owner 墨菲复审。
