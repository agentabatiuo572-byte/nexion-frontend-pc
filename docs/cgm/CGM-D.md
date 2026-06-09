# CGM-D · 资金与财务(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 22 行。

| id | scope | type | frontendField | opsPurpose | crudActions | MC | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-D-001 | per-user | function-action | advanceWithdrawal | payout_pacing,fund_safety,platform_inte… | 运营经服务端推进/冻结/驳回/退款状态(目标态=终态 confirmed 或异常态);生产客户端永不改状态,仅反映服务端。 | Y | 读 GET /api/withdrawals/:id 或 webhook/SSE (per PRD… | gap |
| CGM-D-002 | per-user | data-CRUD | bills[] (Bill: id/type/amount/symbol/status/ts/… | fund_safety,platform_integrity,payout_p… | 运营只读流水 + 服务端补记调整/冲正分录(目标态=对账平);客户端只排序+展示,不重算 balanceAfter。 | Y | 读 GET /api/bills?range=30d;写 POST /api/bills(serv… | gap |
| CGM-D-003 | per-user | function-action | creditBalance | fund_safety,platform_integrity | 运营经服务端 action 端点产生入账+账单(目标态=正确余额);客户端 creditBalance 仅乐观 UI,非权威。 | Y | 无独立 /api/wallet/credit;入账经具体 action 端点副作用(余额由 bil… | gap |
| CGM-D-004 | per-user | function-action | creditNex / debitNex | fund_safety,platform_integrity | 运营经服务端代币 action 端点产生增减+账单(目标态=正确 NEX 余额);客户端仅乐观 UI。 | Y | 无独立 NEX wallet credit/debit 端点;经具体 action 端点副作用变更 | gap |
| CGM-D-005 | per-user | function-action | debitBalance | fund_safety,platform_integrity | 运营经服务端 action 端点扣款+账单(目标态=正确余额);客户端 debitBalance 仅 UX 守卫,非安全边界。 | Y | 无独立 /api/wallet/debit;扣款经具体 action 端点副作用(POST /ap… | gap |
| CGM-D-006 | per-user | data-CRUD | devices[].todayEarnings / devices[].todayEarnin… | payout_pacing,fund_safety,platform_inte… | 运营只读;停用/优雅停用时由动作自动清零(forfeit 当前任务奖励);产出由服务端任务调度器推送,客户端不算。 | Y | 读 SSE /api/me/earnings/stream (per PRD §9.11c.1, … | gap |
| CGM-D-007 | per-user | data-CRUD | earnings.history[] | payout_pacing,platform_integrity | 运营只读;由服务端收益事件流提供。 | Y | 读 GET /api/me/earnings / SSE /api/me/earnings/str… | gap |
| CGM-D-008 | per-user | data-CRUD | earnings.thisWeek / earnings.thisMonth / earnin… | payout_pacing,fund_safety | 运营只读;各区间桶由服务端独立按 range 聚合,客户端只接收渲染。 | Y | 读 GET /api/me/earnings?range=week/month/all (TBD·… | gap |
| CGM-D-009 | per-user | data-CRUD | earnings.today / earnings.todayNEX | payout_pacing,fund_safety,platform_inte… | 运营只读;服务端按日聚合 carry-over + live tick delta,客户端只渲染最终值,不可改。 | Y | 读 GET /api/me/earnings / SSE /api/me/earnings/str… | gap |
| CGM-D-010 | per-user | data-CRUD | latestWithdrawal (Withdrawal: id/amount/network… | fund_safety,payout_pacing,risk | 运营读单 + 推进/冻结/退款;目标态=终态。生产状态机缺 review-rejected/tx-failed/refunded/froz… | Y | 读 GET /api/withdrawals/:id (per PRD §9.11e);写 POS… | gap |
| CGM-D-011 | per-user | function-action | recordDeposit | fund_safety,platform_integrity | 运营触发补记/冲正充值(差错处理),目标态=对账后正确余额+累计;严禁把收益/salvage/KYC/quest 走此动作。 | Y | 读 GET /api/users/me (TBD·candidate);写 PSP-webhook… | gap |
| CGM-D-012 | per-user | function-action | recycleDevice | fund_safety,conversion,risk | 运营代发回收(目标态=移除设备 + 记 recycle credit 账单 pending trade-in);salvage 不得错记入… | Y | 写 POST /api/devices/recycle (TBD·candidate, not i… | gap |
| CGM-D-013 | per-user | function-action | replaceDevice | fund_safety,conversion,platform_integri… | 运营代发显式换机(目标态=旧换新+净额扣款+tradein 账单);salvage 仅抵扣不入余额;失败回滚重插旧设备。 | Y | 写 POST /api/devices/replace (TBD·candidate, not i… | gap |
| CGM-D-014 | per-user | function-action | submitWithdrawal | fund_safety,payout_pacing,risk | 运营审核/批准/驳回提现(maker-checker 双签);目标态=放行→processing/sent 或驳回退款。服务端原子事务:扣… | Y | 写 POST /api/withdrawals;读状态 GET /api/withdrawals/… | gap |
| CGM-D-015 | per-user | function-action | tick (收益/状态模拟主循环) | payout_pacing,fund_safety,platform_inte… | 运营不直接触发(SimulationProvider 驱动);生产由服务端调度器跑,客户端只订阅渲染。收据必须服务端签名。 | Y | 读 SSE/WebSocket /api/me/earnings/stream + /api/pl… | gap |
| CGM-D-016 | per-user | function-action | useBills.add | fund_safety,platform_integrity | 运营经服务端 POST /api/bills 写账单(目标态=新增 canonical 账单);客户端 add 仅 mock。 | Y | 写 POST /api/bills(server 返回 id) | gap |
| CGM-D-017 | per-user | data-CRUD | user.cumulativeDepositUsdt | fund_safety,risk,conversion | 运营只读 + 与服务端 canonical 值对账纠偏(客户端 +x.toFixed(2) 累加会丢亚分);目标态=server cano… | Y | 读 GET /api/users/me.cumulativeDepositUsdt (TBD·ca… | gap |
| CGM-D-018 | per-user | data-CRUD | user.pendingEarnings | payout_pacing,fund_safety | 运营只读;实际结算由服务端调度器把 pending 转入余额并写账单,目标态由服务端日结产生,客户端不改。 | Y | 读 SSE /api/me/earnings/stream (TBD·candidate per … | gap |
| CGM-D-019 | platform | param-config | 提现 fee 公式 max(1, min(20, amount×0.02)) + MIN_WI… | fund_safety,payout_pacing,risk | 运营调整费率/上下限/最低额/日额度(目标态=合规风控核定值);生产从配置端点读,非硬编码。 | Y | 读 GET /api/config/wallet/withdraw-limits;写 TBD·建议… | gap |
| CGM-D-020 | platform | param-config | BillType (账单类型枚举: earn/refer/bonus/topup/withdr… | platform_integrity,fund_safety,content_… | 运营按 type/status 筛选查询;类型集为服务端权威枚举,运营不擅改(扩类需服务端定义)。 | Y | 读 GET /api/bills?range=30d(按 type/status 过滤) | gap |
| CGM-D-021 | platform | param-config | DEVICE_SPECS.baseRate / baseRateNEX (各设备日产出: s1… | payout_pacing,fund_safety,platform_inte… | 运营调整产出基准(目标态=核定日产出率);生产从 specs 端点读,可不停机重调,客户端不可自调 efficiency。 | Y | 读 GET /api/products/specs (TBD·candidate, not in … | gap |
| CGM-D-022 | platform | param-config | salvage rate=0.30 / monthlyDecay=0.025 / minHol… | fund_safety,risk,conversion | 运营调整回收率/衰减/最小持有期(目标态=核定值;促销窗可降 minHoldingMonths);服务端唯一权威,客户端值仅 render… | Y | 读 GET /api/config/tradein (TBD·candidate);写 PUT /… | gap |
