# CGM-G · 金融产品(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 32 行。

| id | scope | type | frontendField | opsPurpose | crudActions | 操作确认 | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-G-001 | per-user | function-action | NexV2LockPage lock action (matureValue = amount… | fund_safety,payout_pacing,conversion,ri… | 运营查锁仓申请;审核/驳回;到期出金确认;phase 门控开关 | Y | 写 POST /api/nex-v2-lock (TBD·建议) (抄 _config READM… | gap |
| CGM-G-002 | per-user | function-action | PremiumPage subscribe action (firstMonthPrice =… | conversion,fund_safety | 运营查订阅转化;调价/折扣;续费/取消(later sprint);phase 门控 | Y | 写 POST /api/premium/subscribe (TBD·建议) (抄 _config… | gap |
| CGM-G-003 | per-user | function-action | RepurchasePage.handleRepurchase (debitBalance +… | conversion,fund_safety,payout_pacing | 运营查复投转化漏斗(失败提现导流);核对四笔非原子写一致性;争议时回滚整组(余额/积分/质押/账单) | Y | 写 POST /api/wallet/reinvest (抄 repurchase/page.ts… | gap |
| CGM-G-004 | per-user | data-CRUD | useExchange.history[] (SwapEvent: fromSym/toSym… | fund_safety,platform_integrity,risk | 运营查兑换历史对账;异常套利单标记/冻结;争议成交回滚 | Y | 读 GET /api/swaps (TBD·建议) · 写 POST /api/swap (抄 e… | gap |
| CGM-G-005 | per-user | function-action | useExchangeV3.canExchange(usd) / record(usd) | fund_safety,risk,platform_integrity | 运营查谁触限/触发KYC;手动放行/封禁某用户兑换;调全局门控策略 | Y | 写 POST /api/swap (server 内执行 gate + record) (TBD·… | gap |
| CGM-G-006 | per-user | data-CRUD | useExchangeV3.queue[] (QueuedExchange: amountUS… | payout_pacing,fund_safety,risk | 运营查排队积压;手动提前放行/取消排队单;次日重置批处理监控 | Y | 读 GET /api/swap/queue (TBD·建议) · 写 POST /api/swap… | gap |
| CGM-G-007 | per-user | function-action | useExchangeV3.setKycVerified(v) / kycVerified | risk,platform_integrity,content_complia… | 运营审核 KYC、置 verified/驳回;争议时撤销验证 | Y | 读 GET /api/kyc/status (TBD·建议) · 写 POST /api/kyc/… | gap |
| CGM-G-008 | per-user | data-CRUD | useGenesis.myListings[] (MyListing: tokenId/ask… | fund_safety,platform_integrity,risk | 运营查/下架违规挂单(cancel);成交对账(fulfillSale 收益由 caller 入账);争议撤单;监控二级地板价 | Y | 读 GET /api/genesis/listings (TBD·建议) · 写 POST /ap… | gap |
| CGM-G-009 | per-user | data-CRUD | useGenesis.ownedTokenIds[] / myOwned | fund_safety,platform_integrity,risk | 运营查节点持仓;争议/退款时调整持有(回收 tokenId);冻结可疑持有 | Y | 读 GET /api/genesis/state (抄 _config README L34) | gap |
| CGM-G-010 | per-user | function-action | useGenesis.purchase(n, tokenIds?) | conversion,fund_safety,risk | 运营查认购流水、对账资金;监管点名时 POST /api/admin/genesis/pause 暂停发售;调发售参数 | Y | 写 POST /api/genesis/purchase (TBD·建议) · POST /api… | gap |
| CGM-G-011 | per-user | function-action | useStaking.claim(id) | payout_pacing,fund_safety | 运营查领取流水;手动批准/驳回到期出金;争议利息确认与改派 | Y | 写 POST /api/stakes/:id/claim (抄 staking.ts 头注) | gap |
| CGM-G-012 | per-user | function-action | useStaking.earlyWithdraw(id) | fund_safety,payout_pacing,risk | 运营查早赎记录、核对罚金计算;争议时手动调整退款/减免罚金(需确认);批量风险时暂停早赎通道 | Y | 写 POST /api/stakes/:id/early-withdraw (抄 staking.… | gap |
| CGM-G-013 | per-user | data-CRUD | useStaking.positions[] | fund_safety,payout_pacing,risk | 运营查仓与状态;手动改单状态(冻结可疑仓、强制 matured、争议单回滚到 active);read-only 净额校验,改本金/APY… | Y | 读 GET /api/stakes (TBD·建议) · 写 POST /api/stakes/:… | gap |
| CGM-G-014 | per-user | function-action | useStaking.stake(amount, termDays) | fund_safety,conversion,payout_pacing | 运营可对单笔 stake 审核/驳回;开/关某档位申购(配合 per-pool enabled);异常单撤单 | Y | TBD·建议 POST /api/stakes (open) | gap |
| CGM-G-015 | per-user | function-action | WithdrawPage.handleSubmit (points.spend + submi… | fund_safety,payout_pacing,risk,platform… | 运营确认/驳回提现;核对扣积分+锁定USDT+建队列+写bill 一致性;争议回滚;调风控 | Y | 写 POST /api/withdrawals (抄 withdraw/page.tsx 注) | gap |
| CGM-G-016 | platform | param-config | exchange minFrom (usdt2nex=1 / nex2usdt=10) + f… | conversion,fund_safety | 调最小兑换额、开启/调整兑换费率(目前0) | Y | 读 GET /api/config/exchange/caps (含 min/fee) (TBD·… | gap |
| CGM-G-017 | platform | param-config | GENESIS_ROYALTY_RATE=0.025 | fund_safety,payout_pacing,network_growth | 调版税率;金库分成策略调整 | Y | 读 GET /api/genesis/state (含 royalty) (TBD·建议) | gap |
| CGM-G-018 | platform | param-config | MIN_WITHDRAWAL_USD=20 / fee=2% (clamp $1~$20) /… | fund_safety,payout_pacing,risk,content_… | 监管/风控调提现阈值(日常操作):最低额、费率公式、日额度上限 | Y | 读 GET /api/config/wallet/withdraw-limits (抄 _conf… | gap |
| CGM-G-019 | platform | param-config | NEX v2 Lock LOCK_MONTHS=24 / APY=2.50 / MIN_LOC… | payout_pacing,fund_safety,content_compl… | 调锁期/APY/最低额;250% APY 监管最先点名→kill-switch 下架 | Y | 读 GET /api/config/nex-v2-lock · 写 admin kill swit… | gap |
| CGM-G-020 | platform | param-config | Premium MONTHLY_PRICE=99 / FIRST_MONTH_DISCOUNT… | conversion,payout_pacing | 运营常调订阅价/折扣 | Y | 读 GET /api/config/premium (抄 _config README L40) | gap |
| CGM-G-021 | platform | param-config | projectedYield = amount × 0.35 × (90/365); earn… | conversion,payout_pacing | 调复投激励:APY 估算口径、积分换算率、预设档位、1.5×培育倍数/Genesis 抽奖券等附加权益 | Y | 读 GET /api/config/staking/pools + GET /api/config… | gap |
| CGM-G-022 | platform | param-config | STAKING_APY {30:0.12,90:0.35,180:0.80,365:1.80} | payout_pacing,fund_safety,risk,content_… | 调每档 APY、kill-switch 下架某档(per-pool enabled boolean);监管点名高息第一秒整池下线;统一为单… | Y | 读 GET /api/config/staking/pools · 写 PUT /api/admi… | gap |
| CGM-G-023 | platform | param-config | STAKING_PENALTY {30:0.05,90:0.15,180:0.30,365:0… | fund_safety,payout_pacing,risk | 调每档罚率;风控收紧/放松早退成本;随 phase 调整 | Y | 读 GET /api/config/staking/pools (penalty 字段) (抄 s… | gap |
| CGM-G-024 | platform | param-config | STAKING_POOLS[] (NEX 池: apy 5/12/20/35, minStak… | payout_pacing,conversion,fund_safety,co… | 调 NEX 池 APY/minStake/premium 标识/启停;明确币种标签消歧;统一进单一 server pool 列表 | Y | 读 GET /api/config/staking/pools (抄 staking-pools.… | gap |
| CGM-G-025 | platform | param-config | TOTAL_SLOTS=1000 / unitPriceUSDT=9999 / soldSlo… | conversion,fund_safety,content_complian… | 调供应量/单价/分红比例;监管点名'证券类风险'立即下架(kill-switch);POST /api/admin/genesis/adj… | Y | 读 GET /api/genesis/state · 写 POST /api/admin/gene… | gap |
| CGM-G-026 | platform | param-config | useExchange.rate (USDT per 1 NEX, jitterRate ba… | fund_safety,conversion,platform_integri… | 设置/调整兑换基准汇率与抖动范围;锁定汇率应对挤兑;与 market.nexPriceUSDT 行情价对齐口径 | Y | 读 GET /api/exchange/rate (TBD·建议) · 写 PUT /api/ad… | gap |
| CGM-G-027 | platform | param-config | useGenesis.currentDailyVolumeUSD() = 24_000_000… | payout_pacing,conversion,content_compli… | 调日交易量基数→联动调单节点分红展示;保持回本周期可信不自曝;统一防分叉 | Y | 读 GET /api/genesis/state (含 volume/dividend) (TBD… | gap |
| CGM-G-028 | platform | function-action | useGenesis.tickSales() (每30s 假涨 1-3 张) | conversion,content_compliance,platform_… | 调进度条增长节奏/上限;保证 soldSlots 不超 TOTAL_SLOTS | Y | 读 GET /api/genesis/state (server 推真实 soldSlots) (… | gap |
| CGM-G-029 | platform | param-config | useMarket {nexPriceUSDT=0.171, open24h, high24h… | conversion,platform_integrity,content_c… | 设置/调整 NEX 价格与行情数据;调流通量影响市值;统一全客户端口径(现各客户端独立 random) | Y | 读 WebSocket /api/market/nex (抄 market.ts 头注 + _co… | gap |
| CGM-G-030 | platform | param-config | useMarket.tickPrice() pump prob 0.08 / 幅度 ±3% /… | conversion,content_compliance,platform_… | 调上行触发概率/幅度/节奏(K线做市后台调);设置 K 线走势;监管敏感时暂停做市 | Y | 读 WebSocket /api/market/nex (pump 服务端) (抄 market.… | gap |
| CGM-G-031 | platform | param-config | USER_DAILY_CAP_USD=50 / PLATFORM_DAILY_CAP_USD=… | fund_safety,risk,content_compliance | 合规/风控实时调三阈值(收紧或放宽);挤兑时下调平台日池;调 KYC 触发线 | Y | 读 GET /api/config/exchange/caps · 写 PUT /api/admi… | gap |
| CGM-G-032 | platform | function-action | useStaking.markMatured() | payout_pacing,platform_integrity | 运营/定时任务触发批量置 matured;监控成熟队列积压 | Y | TBD·建议 server cron (无对应客户端写端点) | gap |
