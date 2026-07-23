# FEAT-DEV02 设备升级置换阶梯

## 目标与第一性原则

置换是一次“旧设备折抵 + 钱包补差 + 新设备交付”的原子购买，不是向钱包充值。折抵额只减少本次新设备应付金额；任何步骤失败都必须整体回滚，不得出现旧机已回收、钱包已扣款但新机未交付的中间真相。

## 权威定价

- 资格与开关：`tradeinEnabled`、`eligibility`。
- 阶梯：4 个严格递增的累计产出/实付比例界点 `tradeinLadderCut1..4`，对应 5 个严格递减折抵率 `tradeinLadderCredit1..5`。
- 限制：`tradeinRequireHigherPrice`、`tradeinMaxDevicesPerOrder`；当前用户流程一笔只接受一台属于该用户且为 ACTIVE 的旧设备。
- 报价按服务端累计已结算产出、旧机真实实付价和目标商品当前价计算；submit 必须重新计算，绝不信任 quote 返回值或客户端金额。

## 用户接口

- `GET /api/app/trade-in/config`：返回开关、资格、4/5 阶梯、高价限制与单笔上限。
- `POST /api/app/trade-in/quote`：请求 `{sourceDeviceId, targetProductNo}`，返回旧机实付、累计产出、比例、档位、折抵、目标价、应付、钱包余额和缺口。
- `POST /api/app/trade-in/submit`：同请求并强制 `Idempotency-Key`；成功返回置换单、设备订单、新旧设备和钱包扣款结果。

三接口只接受 USER Bearer JWT 的正整数 userId 主体；匿名或 ADMIN 主体不得代替用户下单。

## 原子落账与跨域事实

submit 在一个数据库事务中完成：锁定旧设备/钱包/商品与幂等键 → 重算资格和报价 → 扣减钱包 → 写 D4 `nx_wallet_ledger` → 写置换申请和设备订单 → 回收旧机 → 交付新机 → 写 required 审计及 A4 `tradein.completed`。同一用户重复幂等键返回同一结果；不同请求体冲突必须拒绝。

K2 的置换套利簇以近 30 天至少 3 次 `status=COMPLETED` 且 `completed_at` 在窗口内的置换，同时存在正数佣金或 `direction=IN`、金额大于 0 的赠送类钱包入账为准；pending/failed 申请、负数/OUT 礼金不得计数。禁止继续用旧 `months_owned` 拒绝记录替代。L4 必须展示 E3 配置变化、置换申请和已完成置换三项真实事实。

## 验收准则

- App 页面只用真实 config/quote/submit；不得保留 `salvagePct`、`minHoldingMonths` 或 localStorage 假成功。换购窗口必须按精确 `productNo + catalog.status/supersededBy` 判断，Pro v2/Rack P2 不得因 kind 别名被误判为旧机。
- 余额不足、旧机不属于本人、旧机非 ACTIVE、目标非在售/非更高价、资格不足均给出可理解错误且数据库无部分写入。
- 成功后刷新钱包和设备列表，旧机为已回收、新机可见、D4 可按 tradein 账单定位、A4 可按事件追踪。
- 管理端阶梯与资格变更即时影响新报价，不回溯已完成置换。
