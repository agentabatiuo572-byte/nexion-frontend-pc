# UniApp 真实后端联调与 RunID 隔离验收规格 v1

> 状态：Implemented and acceptance-tested（2026-08-12）
> 范围：`nexion-backend`、`NX1.0-UniApp`、`nexion-ops-console`
> 本轮 RunID：`UNIAPP-BACKEND-20260812-114057`

## 1. 目标与不可破坏约束

首次用户必须从可见页面完成真实注册、登录和业务闭环；页面展示的成功必须来自后端权威状态。验收环境与生产环境共用代码但不共用事实：所有验收写入以服务端 profile、账号 Sandbox 标识和 RunID 三重准入，任何配置漂移、来源不明、结果未知或正式表增量都失败关闭。

生产外部动作不由 Sandbox 代替。真实提现、真实 PSP/银行/链上、Cregis payout、Janus native 和实体设备动作在供应商或生产授权缺失时保持 HOLD，不允许前端本地成功。

## 2. 统一环境契约

1. 服务端只接受恰好一个 `acceptance`、`test` 或 `local-sandbox` profile；mixed/unknown 拒绝读写。
2. `NEXION_ACCEPTANCE_RUN_ID` 是 Funds、H8、课程、商城、客服和 L6 的服务端权威分区；客户端传入值只能与之精确相等。
3. Sandbox 账号、钱包、JWT audience、refresh session、注册 OTP、手机号唯一键与登录风控键都绑定同一服务端环境。
4. Sandbox 表永久保留 `source=mock`、`source_environment=SANDBOX`、RunID；生产路径拒绝 Sandbox 身份，Sandbox 路径拒绝生产身份。
5. 每个观察面必须同时满足：本 Run 有独立事实、来源标记完整、正式物理表/审计/幂等/outbox 增量为 0。事实为 0 是 `INSUFFICIENT`，任一正式增量非 0 是 `VIOLATION`。

## 3. 八条首用链路

| 链路 | 用户/运营闭环 | 权威与隔离 |
|---|---|---|
| 登录与注册 | 注册 → 服务端会话投影 → onboarding → 重登 | JWT/refresh/OTP/手机号按环境；迟到 A 会话不得覆盖 B |
| 配置 | PC 读取服务端配置；不可用项只读/HOLD | remote 不继承 mock 风控、提现或分享策略 |
| Funds | App 读钱包 → Sandbox top-up/withdraw receipt → 账本回读 | wallet/order/ledger/callback 按 RunID；Production withdrawal HOLD |
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

## 5. 可见证据与签发门

PC 与 App 均常驻显示 `mock/SANDBOX`、当前 RunID 或永久 Sandbox 标签。每轮保存真实页面截图、接口回执、数据库观察、完整测试日志、构建指纹和清理记录。以下任一项发生即拒绝签发：

- 本地状态或计时器制造成功；
- Sandbox 身份或 token 进入 Production；
- 正式事实、审计、幂等、outbox 出现本轮增量；
- 结果未知后换键重试；
- 观察事实为 0 仍显示通过；
- 外部 provider 未配置却显示已支付、已出款或已激活。

## 6. 本轮验收结果与边界

Run `UNIAPP-BACKEND-20260812-114057` 已在隔离 MySQL schema、真实 Java 后端、真实 PC production build 和真实 UniApp H5 runtime 上执行八条链路。Funds、H8、课程、商城、客服和 L6 均生成本 Run Sandbox 事实，观察到的正式增量为 0。完整 Maven、PC verify、App verify 通过后方可形成候选；部署与真实外部资金/设备动作不属于本轮授权。
