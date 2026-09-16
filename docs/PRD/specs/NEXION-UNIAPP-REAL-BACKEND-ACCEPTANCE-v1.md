# UniApp 真实后端联调与 RunID 隔离验收规格 v1

> 状态：隔离验收契约；当前版本须重新取得本规格所列证据后签发，历史样本不覆盖后续改动。
> 范围：`nexion-backend`、`nexion-frontend-uniapp`、`nexion-frontend-pc`
> 历史 RunID 样本：`UNIAPP-BACKEND-20260812-114057`

## 1. 目标与不可破坏约束

首次用户必须从可见页面完成真实注册、登录和业务闭环；页面展示的成功必须来自后端权威状态。验收环境与生产环境共用代码但不共用事实：Sandbox 链路写入以服务端 profile、账号 Sandbox 标识和 RunID 三重准入，任何配置漂移、来源不明、结果未知或正式表增量都失败关闭。BANKQR 的独立数据库夹具另按 §2.1 准入，不混入 Sandbox 正向链路。

生产外部动作不由 Sandbox 代替。真实提现、真实 PSP/银行/链上、Cregis payout、Janus native 和实体设备动作在供应商或生产授权缺失时保持 HOLD，不允许前端本地成功。

## 2. 统一环境契约

1. 服务端只接受恰好一个 `acceptance`、`test` 或 `local-sandbox` profile；mixed/unknown 拒绝读写。
2. `NEXION_ACCEPTANCE_RUN_ID` 是 Funds、H8、课程、商城、客服和 L6 的服务端权威分区；客户端传入值只能与之精确相等。
3. Sandbox 账号、钱包、JWT audience、refresh session、注册 OTP、手机号唯一键与登录风控键都绑定同一服务端环境。
4. Sandbox 表永久保留 `source=mock`、`source_environment=SANDBOX`、RunID；生产路径拒绝 Sandbox 身份，Sandbox 路径拒绝生产身份。
5. 每个观察面必须同时满足：本 Run 有独立事实、来源标记完整、正式物理表/审计/幂等/outbox 增量为 0。事实为 0 是 `INSUFFICIENT`，任一正式增量非 0 是 `VIOLATION`。
6. App 所有手机号入口只允许越南 `+84` 与中国 `+86`：生产构建默认 `+84`，开发构建默认 `+86`。国家/地区列表保留其他条目作为覆盖范围说明，但必须置灰、不可聚焦、不可通过点击或键盘选中。Java 后端对 OTP、登录、注册、密码重置、二次验证、提现地址短信确认、OAuth 会话、refresh、JWT 与可信网关会话执行同一白名单和号码格式校验；历史或脏会话失败关闭并撤销，不能仅依赖前端禁用。

### 2.1 BANKQR 独立夹具边界

当前银行接口仅允许单一 `dev` 或 `prod` profile 且拒绝 Sandbox 账号；在本节 Sandbox 环境中只验 profile/身份拒绝和 HOLD，不执行正向出款。银行正向契约测试须使用独立随机 MySQL schema、`dev` 测试环境及受控供应商夹具，与运行中的正式库和外部出款隔离。该证据证明首次绑定、用途隔离的换卡短信、立即生效、账户与报价一致性、原单恢复和账务契约，不证明 RunID Sandbox 已支持银行提现或真实供应商已到账。外部账户核验门已撤销；真实供应商契约及授权实盘验收未完成前，公开代付继续 HOLD。App 已采用换卡短信及新账户守卫；三端正向链路仍须取得同版本证据，不得以代码适配提前签发。

## 3. 首用链路

| 链路 | 用户/运营闭环 | 权威与隔离 |
|---|---|---|
| 登录与注册 | `+84/+86` 发码 → 服务端注册预验成功 → 设置密码 → 最终注册重验消费 → 会话投影 → onboarding → 重登 | 预验不消费、不建号或会话；错误/过期/跨环境不进入密码。生产默认 `+84`、开发默认 `+86`；JWT/refresh/OTP/手机号按环境；迟到会话或编辑输入后的旧响应不得推进新流程 |
| 配置 | PC 读取服务端配置；不可用项只读/HOLD | remote 不继承 mock 风控、提现或分享策略 |
| Funds | App 读钱包 → Sandbox top-up/withdraw receipt → 账本回读 | wallet/order/ledger/callback 按 RunID；Production withdrawal HOLD |
| Funds 银行分支（独立夹具，非 Sandbox 正向链路） | 按 §2.1 验证首次免短信、换卡专属短信且立即生效 → 锁定报价 → 原意图提交/恢复 → D2 证据与钱包回读；Sandbox 只验证拒绝/HOLD | 平台账号、收款账户编号与版本须匹配原报价，不再要求外部真实性核验；真实服务商配置与资金门继续生效，不能从原始状态推断到账或退款 |
| H8 | Sandbox 推荐关系 → PC 结算 → App 同 Run 投影 | 独立 settlement/ledger/command/audit；不写正式钱包/A2 |
| 课程 | PC 保存/发布 → App 开始/答题/完成 → 奖励回读 | catalog/progress/event/reward/idempotency 按 RunID；revision CAS |
| 商城 | PC catalog → App 下单 → PC callback → App 轮询终态 | order/inventory/receipt/inbox/audit 按 RunID；PENDING 不冒充激活 |
| 客服 | App 会话/工单 → PC 回复/处置 → App 回读 | ticket/conversation/message/receipt/command 独立；正式入口 profile guard |
| L6 | App 生命周期事件 → opaque receipt → PC 因果观察 | fact/去重/限流按 RunID；正式 fact/outbox 任一增量即拒绝 |

## 4. 幂等、并发与结果未知

- 命令键必须在发送前生成并按账号、RunID、业务意图持久化；网络、协议和 5xx 保留原键，明确业务失败才退役。
- 同键同载荷返回首份持久回执；同键异载荷返回冲突。callback/inbox/receipt 唯一键必须包含 RunID。
- 余额、库存、状态、课程 revision、客服 status/version 使用行锁或 CAS；并发失败不允许部分提交。
- 客服轮询、订单轮询和行为回执采用账号 epoch、request generation、single-flight 或事务后释放的 session authority，迟到响应不得回退新状态。
- 注册预验与忘记密码预验分别绑定原手机号、挑战及输入；只有当前请求成功才进入设置密码。最终提交重新校验并消费；忘记密码完成后吊销会话并返回密码登录，不能自动登录。
- 账户内改密在等待前固定已校验的输入，成功指令回执只恢复一次；请求期间修改密码或验证码不能应用旧响应，也不能令加载状态永久不解除。
- 银行未知提交只查原 quoteNo/withdrawalNo，不换键新付；MULTIPLE 意图逐笔恢复，缺少恢复字段不视为无原请求。未提交报价由服务端耐久确认 ABANDONED/EXPIRED 后释放；通道关闭保留原单查询，新单仍需重验配置和账户资格。

## 5. 可见证据与签发门

Sandbox 链路的 PC 与 App 均常驻显示 `mock/SANDBOX`、当前 RunID 或永久 Sandbox 标签。每轮保存真实页面截图、接口回执、数据库观察、完整测试日志、构建指纹和清理记录；BANKQR 夹具另记独立 schema、profile、受控提供方与账务断言，不冒用 Sandbox 标识或真实到账结论。以下任一项发生即拒绝签发：

- 本地状态或计时器制造成功；
- Sandbox 身份或 token 进入 Production；
- 正式事实、审计、幂等、outbox 出现本轮增量；
- 结果未知后换键重试；
- 观察事实为 0 仍显示通过；
- 外部 provider 未配置却显示已支付、已出款或已激活。

## 6. 历史验收样本与适用边界

Run `UNIAPP-BACKEND-20260812-114057` 已在隔离 MySQL schema、真实 Java 后端、真实 PC production build 和真实 UniApp H5 runtime 上执行八条链路。Funds、H8、课程、商城、客服和 L6 均生成本 Run Sandbox 事实，观察到的正式增量为 0。完整 Maven、PC verify、App verify 通过后方可形成候选；部署与真实外部资金/设备动作不属于本轮授权。
