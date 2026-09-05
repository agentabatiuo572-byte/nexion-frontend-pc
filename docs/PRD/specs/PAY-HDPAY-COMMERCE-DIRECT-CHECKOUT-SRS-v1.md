# PAY-HDPAY-COMMERCE-DIRECT-CHECKOUT-SRS-v1（已废止，仅作历史记录）

> **状态：RETIRED（2026-09-03）**
> 本草案不得作为现行需求、接口或验收依据。现行产品裁决是：HDPay 仅用于
> 钱包充值；商城订单只能由 NexGrid 钱包余额支付。余额不足时阻止购买并引导
> 用户充值，充值到账后再通过 `POST /api/orders/{orderNo}/pay` 扣钱包并激活设备。
> 历史 `COMMERCE_ORDER` 字段只用于识别、隔离和人工复核旧会话，禁止新建、
> 提交或结算。以下正文完整保留，仅供审计决策演变，不代表可实现能力。

## 1. 目标

在正式生产数据边界内补齐以下闭环：

`商城订单（PENDING_PAYMENT） → 创建/恢复唯一 HDPay BANKQR 代收单 → 打开 HDPay 托管支付页 → 签名回调触发主动查单 → 原子支付订单并激活设备`。

本能力是“订单直付”，不是“先充值钱包、再从钱包购买”。HDPay 回调结算商城订单时不得增加或扣减用户钱包余额。

## 2. 范围与不变量

1. 一个商城订单最多绑定一个 HDPay 商户订单号；重试、刷新和重复点击只能恢复同一代收单。
2. 只有订单所属用户可以创建或恢复支付会话。
3. 创建支付会话前，服务端必须确认订单仍为 `PENDING/PENDING_PAYMENT/WAITING_PAYMENT`，金额大于零且与支付意图金额完全一致。
4. HDPay 外部请求不得占用商城订单长事务锁。先在短事务内固化订单与支付意图绑定，提交事务后再请求 HDPay。
5. `submit_unknown` 只能用同一商户订单号主动查单恢复，禁止自动换号重提。
6. 回调签名只作为触发条件；订单结算必须以 HDPay 主动查单得到的已支付状态、商户订单号、平台订单号、VND 金额和 `BANKQR` 类型为权威事实。
7. 订单支付、支付记录、设备实例、订单状态历史、支付意图、HDPay 结算状态、回调收件箱、审计与业务事件必须在同一数据库事务内提交或全部回滚。
8. 重复回调不得产生第二条支付记录、第二批设备、第二次库存变化或任何钱包变化。
9. 金额、用户、订单、支付类型、平台订单号或状态不一致时进入持久化人工复核，不支付订单、不激活设备、不变更钱包。
10. HDPay 不提供关单/退款接口。代收单进入可能已提交状态后，商城订单不得再由用户取消；NexGrid 不提供用户主动退款入口。
11. 支付意图创建事务一旦成功，取消入口就必须阻断该订单；不得在“已绑定 intent、尚未插入 HDPay 行”的竞态窗口取消订单。
12. 已入账订单随后收到非支付成功状态时，只创建持久人工复核事实并保持资金与设备不自动反转；在 HDPay 给出明确状态语义和不可变退款流水前，禁止自动退款、自动扣回或自动停用设备。
13. 向 HDPay 发起网络请求前，必须在数据库时间下以 `intent.status=AWAITING_PAYMENT AND expires_at>NOW()` 为条件完成一次性提交授权，并先把本地提交状态持久化为 `SUBMIT_UNKNOWN`；进程在外呼前后崩溃时，后续只能按同一商户订单号主动查单恢复，禁止凭本地 `PENDING` 重发。

## 3. 接口契约

### 3.1 创建或恢复商城支付会话

`POST /api/orders/{orderNo}/payment-session`

请求头：

- `Authorization: Bearer <user token>`
- `Idempotency-Key: <8..128 chars>`

成功响应必须包含：

- `orderNo`：当前商城订单号
- `intentNo`：唯一 HDPay 商户订单号
- `paymentMode: hosted`
- `providerStatus: created`
- `paymentUrl`：服务端已按精确主机白名单验证的 HTTPS 托管页
- `paymentUrlTrusted: true`
- `status: awaiting_payment`
- `amountUsdt`、`vndAmount`
- `serverCanonical: true`、`source: server`、`sourceEnvironment: PRODUCTION`、`runId: ""`

响应不得包含内部银行卡号、匹配备注、MD5 密钥或签名原文。

### 3.2 HDPay 回调

公网地址固定转发到 Java：

`POST /openapi/v1/payments/hdpay/pay-in/callback`

边缘代理只负责 TLS 终止和原样反向代理，不在代理层伪造业务成功。Java 仅在签名校验、持久化领取和处理规则完成后返回 HDPay 要求的精确文本 `success`。

回调基础地址必须使用公网 HTTPS、标准 443 端口，并命中部署配置的精确主机 allowlist；禁止 localhost、私网、测试网段、用户信息、query 或 fragment。`trycloudflare`、Pinggy 免费域名等临时隧道只允许在显式本地验收开关且 active profile 属于 `dev/local/test/acceptance` 时使用；`prod/production/staging` 必须硬拒绝并使用固定、受控 FQDN。

## 4. 数据契约

`nx_vietqr_intent` 增加：

- `settlement_target_type`：`WALLET_TOPUP | COMMERCE_ORDER`，历史数据默认 `WALLET_TOPUP`
- `target_order_no`：商城直付时必填且全局唯一

`nx_hdpay_payin_order.merchant_order_id` 继续引用支付意图号。商城订单号不得直接复用为 HDPay 商户订单号，避免不同业务域的幂等语义混淆。

## 5. 前端行为

1. 正式 App 创建商城订单并完成服务器读回验证后，立即调用支付会话接口。
2. App 只接受 `paymentUrlTrusted=true` 且 URL 为 HTTPS、443、无用户信息/fragment并命中客户端精确 HDPay 主机 allowlist 的响应，然后跳转 HDPay 托管页。
3. App 在跳转前持久化账号作用域内的 `orderNo`；返回、刷新或重新登录后恢复该订单的服务器轮询，不在浏览器本地伪造支付或激活状态。
4. 只有服务器订单读回 `PAID/COMPLETED/ACTIVATED` 后，页面才能展示支付成功和设备已激活。

## 6. 验收

必须至少验证：

1. 同一订单重复创建会话只得到一个 `intentNo` 和一个 HDPay 商户订单。
2. 其他用户无法创建/恢复该订单会话。
3. 首次真实回调后：订单一条、支付记录一条、设备数量等于订单数量、钱包前后完全相同。
4. 同一回调重复投递后，上述计数和钱包仍不变。
5. 金额不符和平台订单号冲突进入人工复核且无业务资金/设备副作用。
6. 公网 HTTPS 回调能从外部探针到达 Java 精确路径，证书链和主机名验证通过。
7. App 返回支付页后能按服务器状态继续轮询并展示最终激活结果。
