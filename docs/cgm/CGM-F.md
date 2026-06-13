# CGM-F · 分销与团队(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 20 行。

| id | scope | type | frontendField | opsPurpose | crudActions | 操作确认 | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-F-001 | per-user | data-CRUD | leftVolumeMonth() / rightVolumeMonth() — 双轨左右月业绩 | network_growth,payout_pacing | 只读派生(运营核对双轨业绩均衡度) | · | GET /api/me/binary (读·双轨业绩) — TBD·派生自 server 聚合 | gap |
| CGM-F-002 | per-user | data-CRUD | todayUSDT() / monthUSDT() / monthNEX() / totalU… | fund_safety,platform_integrity | 只读派生,无 CRUD(运营核对单用户计提汇总是否异常) | · | GET /api/me/earnings?range=today/month (读·server … | gap |
| CGM-F-003 | per-user | data-CRUD | totalMembers / totalMonthVolumeUSD / totalAllTi… | network_growth,risk,platform_integrity | 只读派生(运营核对团队规模/业绩是否异常增长) | · | GET /api/me/network/summary (读) — TBD·派生自 server … | gap |
| CGM-F-004 | per-user | function-action | useCommission.unlockMatured() — cooling→unlocke… | fund_safety,payout_pacing,platform_inte… | 运营无直接改;解锁判定 server 权威(目标态:防 client 篡改提前解锁) | Y | SSE /api/me/commission/stream 或 /api/me/earnings/… | gap |
| CGM-F-005 | per-user | function-action | useCommission.withdraw(id) — unlocked→withdrawn | fund_safety,payout_pacing,risk | 运营/风控可冻结单用户提现(目标态:冷却中不可提) | Y | POST /api/me/commission/:id/withdraw (写) — TBD·建议… | gap |
| CGM-F-006 | per-user | function-action | useNetwork.addSpillover(n) — 往 layer1 binary ri… | network_growth,platform_integrity,risk | 运营手动调整成员双轨归位/spillover 配置(目标态:改位写入 A2 审计,防人为操纵双侧均衡) | Y | POST /api/admin/network/placement (写·手动改位 操作员-C… | gap |
| CGM-F-007 | per-user | data-CRUD | user.referralCode + referralUrl (邀请码/邀请链接) | network_growth,conversion | 运营查看;邀请码 server 生成唯一(目标态:防伪造/碰撞) | · | GET /api/me/referral (读·邀请码+链接) — TBD·派生自 user st… | gap |
| CGM-F-008 | per-user | data-CRUD | useSponsorship: sponsorCode / sponsor / giftCla… | risk,platform_integrity,network_growth | 运营/风控解绑或冻结异常 sponsor 关系(目标态:反多账户命中下发 C2/C5 处置;welcome gift server 幂等防… | Y | POST /api/sponsorship/bind (写·绑定+反多账户) · GET /api… | gap |
| CGM-F-009 | per-user | function-action | useSponsorship.bind(code) — 绑定 sponsor (first-w… | risk,platform_integrity,network_growth | 运营查看;绑定 server 权威+反多账户(目标态:无反多账户检测=黑产养号漏洞,server 必修) | · | POST /api/sponsorship/bind (写·操作确认 不适用·风… | gap |
| CGM-F-010 | per-user | function-action | useSponsorship.claimGift() — 领 welcome gift (gi… | fund_safety,risk,platform_integrity | 运营/风控可阻断异常领取(目标态:server userId 幂等单次;client reset 不可重领) | Y | POST /api/sponsorship/claim-gift (写·server 幂等) — … | gap |
| CGM-F-011 | platform | param-config | binaryMatchToday() 公式: min(L/30,R/30)*0.10, 日 c… | payout_pacing,fund_safety,phase_12mo,ri… | 运营调匹配比例(5-15%)/日封顶/结余结转开关(目标态:升比例或封顶=放大敞口,过 B1+联动 D4 计提评估;封顶随月龄由 H1 下… | Y | GET /api/config/commission/rates 或 /api/admin/pla… | gap |
| CGM-F-012 | platform | data-CRUD | CommissionEvent[] (events 流水: kind/sourceUserId… | fund_safety,risk,platform_integrity | 运营冻结异常佣金事件 / 解锁 / 驳回(目标态:命中风控自动冻结,解冻需风控确认+A2 留痕) | Y | GET /api/admin/network/commissions?kind=&uid=&cur… | gap |
| CGM-F-013 | platform | param-config | INVITE_REWARDS (REWARD_USDT=1 / BASE_REWARD_NEX… | fund_safety,conversion,phase_12mo,netwo… | 运营调邀请奖励额度与 phase 倍率(目标态:升=放大流出过 B1;30 天/好友冷却) | Y | GET /api/config/sponsorship (读) · PUT /api/admin/… | gap |
| CGM-F-014 | platform | data-CRUD | NetworkMember[] (id/name/avatar/vRank/layer 1-7… | network_growth,risk,platform_integrity | 运营查看为主;异常成员(刷量/同设备)冻结联动 K2 反欺诈(目标态:取消上榜资格操作确认) | Y | GET /api/me/network (读·用户下线树) · GET /api/admin/ne… | gap |
| CGM-F-015 | platform | param-config | phase.inviteBonusMultiplier (邀请加成倍率 1×-4×) | phase_12mo,conversion,fund_safety,netwo… | 运营在 H1 调 inviteRewardMultiplier(目标态:放大流出方向 server 先核 B1 覆盖率<红线拒收;F 域不… | Y | GET /api/admin/platform/phase-config (读·H1 下发) · … | gap |
| CGM-F-016 | platform | data-CRUD | SPONSORS pool (name/vRank/title/city/downlines)… | network_growth,platform_integrity | 只读解析(运营核对推荐码归属) | · | GET /api/ref/:code (读·解析 sponsor 身份) — TBD·建议落地页解… | gap |
| CGM-F-017 | platform | param-config | UNILEVEL_NEX (L1:50 / L2:20 / L3:10 / L4:5 / L5… | payout_pacing,fund_safety,phase_12mo | 运营调整各层 NEX 计提系数(目标态:升 NEX 派发=放大流出,提交先过 B1 红线) | Y | GET /api/config/commission/rates (读) · PUT /api/a… | gap |
| CGM-F-018 | platform | param-config | UNILEVEL_USDT (L1:0.10 / L2:0.05 / L3:0.03 / L4… | payout_pacing,fund_safety,phase_12mo | 运营按 phase 紧缩或 promotion 调整各层 USDT 比例(目标态:新结算周期生效,L1 锁定 Direct Royalty… | Y | GET /api/config/commission/rates (读) · PUT /api/a… | gap |
| CGM-F-019 | platform | param-config | USDT 佣金冷却期 ONE_DAY*30 (unilevel/binary unlockAt… | payout_pacing,fund_safety,risk | 运营按监管紧缩拉长冷却 30d→45d→60d(目标态:防套利;下调需风控单独确认) | Y | GET /api/config/commission/cooling-days (读) · PUT… | gap |
| CGM-F-020 | platform | param-config | WELCOME_GIFT_USDT=5 / WELCOME_GIFT_NEX=200 (注册 … | fund_safety,conversion,phase_12mo,risk | 运营调 welcome gift 额度(目标态:升额=放大获客成本流出过 B1;phase-driven multiplier) | Y | GET /api/config/sponsorship (读) · PUT /api/admin/… | gap |
