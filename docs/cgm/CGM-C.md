# CGM-C · 用户与账户(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 28 行。

| id | scope | type | frontendField | opsPurpose | crudActions | MC | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-C-001 | per-user | function-action | activateDevice | platform_integrity,payout_pacing | 运营代用户激活(目标态=activatedAt 设为时间戳);受槽位上限(含 trial 预留)硬约束。 | Y | 写 TBD·建议 POST /api/devices/:id/activate | gap |
| CGM-C-002 | per-user | function-action | addDevice | conversion,platform_integrity | 运营代发/补发设备入库存(目标态=新增 inactive 设备),后接 debit+purchase 账单;槽位上限只对 active 生… | Y | 写 POST /api/store/checkout (TBD·candidate, not in… | gap |
| CGM-C-003 | per-user | function-action | deactivateDevice | platform_integrity,payout_pacing | 运营代停用(目标态=activatedAt=null + 遥测清零);停用立即 forfeit 当前任务奖励(currentTask 置 … | Y | 写 POST /api/devices/deactivate (TBD·candidate, no… | gap |
| CGM-C-004 | per-user | data-CRUD | devices[] (设备仓库列表) | platform_integrity,conversion,payout_pa… | 运营只读列表;增删改经各设备动作端点(add/activate/deactivate/replace/recycle),目标态=正确设备集… | Y | 读 GET /api/me/devices (TBD·candidate, not in PRD … | gap |
| CGM-C-005 | per-user | data-CRUD | devices[].activatedAt | platform_integrity,payout_pacing | 运营可代用户激活/停用(目标态=activatedAt 设为时间戳或 null);激活受 MAX_DEVICES=6 槽位上限约束。 | Y | 写 POST /api/devices/deactivate (TBD·candidate, no… | gap |
| CGM-C-006 | per-user | data-CRUD | devices[].interruptedAt / devices[].pausedReason | payout_pacing,platform_integrity | 运营只读;由设备心跳上报 {isCharging,isWifiConnected} 决定,服务端跑 gating 并回推,客户端只镜像。 | Y | 读/写 POST /api/device/:id/heartbeat (TBD·candidate… | gap |
| CGM-C-007 | per-user | data-CRUD | devices[].purchasedAt / devices[].generation | platform_integrity,fund_safety | 运营只读;purchasedAt 由购买事件写,generation 由 trade-in 递增,均服务端 canonical。 | Y | 读 GET /api/me/devices (TBD·candidate);写经购买/trade-… | gap |
| CGM-C-008 | per-user | data-CRUD | devices[].status | platform_integrity,payout_pacing | 运营一般只读(由设备心跳决定);异常时可标记 offline 停止产出,目标态=online/offline。 | Y | 读/写 POST /api/device/:id/heartbeat (TBD·candidate… | gap |
| CGM-C-009 | per-user | data-CRUD | LeadershipPayout history (weekId/weekStartTs/po… | payout_pacing,fund_safety,platform_inte… | 运营查看为主;分配名单按 V 阶日切快照,异常可冻结(目标态:结算受 F2 冷却约束) | Y | GET /api/pool/state (读·个人份额+历史) · GET /api/admin/… | gap |
| CGM-C-010 | per-user | function-action | moveToInventory | platform_integrity,conversion | 运营代发送回库存(目标态=activatedAt=null 保留设备);后接 addDevice+debit+purchase 账单。 | Y | 写 POST /api/devices/deactivate (TBD·candidate);后续… | gap |
| CGM-C-011 | per-user | function-action | nextRankProgress(state) / nextRankGap(state) — … | conversion,network_growth | 只读预览,无 CRUD | · | GET /api/me/v-rank (读·含 next gap) — server 派生,cli… | gap |
| CGM-C-012 | per-user | function-action | scheduleDeactivation | platform_integrity,payout_pacing | 运营代发优雅停用指令(目标态=任务完成后 activatedAt=null);区别于立即 forfeit 停用。 | Y | 写 POST /api/devices/deactivate (TBD·candidate;gra… | gap |
| CGM-C-013 | per-user | function-action | setPhoneRuntime | platform_integrity | 运营不操作;生产这些字段由设备 agent 心跳上报,客户端不可 mutate。 | · | 读/写 POST /api/device/:id/heartbeat (TBD·candidate… | gap |
| CGM-C-014 | per-user | data-CRUD | user.email / user.tier / user.joinedAt / user.r… | platform_integrity,network_growth | 运营可改 tier(升降级,目标态=核定等级);email/referralCode 一般只读或经申诉流程改;joinedAt 只读。 | Y | 读 GET /api/users/me (TBD·candidate, not in PRD §9… | gap |
| CGM-C-015 | per-user | data-CRUD | user.nexBalance | fund_safety,platform_integrity | 运营只读;调整经服务端代币账本补记调整分录,目标态=对账后正确余额,不直接客户端 set。 | Y | 读 GET /api/users/me (TBD·candidate, not in PRD §9… | gap |
| CGM-C-016 | per-user | data-CRUD | user.usdtBalance | fund_safety,platform_integrity | 运营一般只读;争议/差错冲正时通过补记一条调整账单(bill)间接修正余额至目标值,余额由账本服务端推导,不直接 set。 | Y | 读 GET /api/users/me (TBD·candidate, not in PRD §9… | gap |
| CGM-C-017 | per-user | data-CRUD | useVRank: myRank / selfBuyUSD / directRefs / te… | network_growth,risk,platform_integrity | 运营核对/必要时人工调整单用户晋升进度数据(目标态:server 重算为准;C2/C3 调账或 K 域反欺诈可冻结异常晋升) | Y | GET /api/me/v-rank (读·用户当前阶+进度) · 重算由 server 触发 —… | gap |
| CGM-C-018 | per-user | function-action | useVRank.setMyRank(v) / setProgress(p) | risk,platform_integrity,network_growth | 运营手动升/降单用户 V 阶(目标态:仅 server 写,双签+A2;客户端不得越权) | Y | 无直接前端端点;运营侧 PUT /api/admin/users/:uid/v-rank (写·M… | gap |
| CGM-C-019 | platform | param-config | currentWeekPoolUSDT (487321 ≈ 周交易$9.7M×5%) — 领导… | payout_pacing,fund_safety,phase_12mo | 运营调入池比例(目标态:升比例=池放大+平台净留存下降;改动 server 校验) | Y | GET /api/pool/state (读·本期池额) · PUT /api/admin/net… | gap |
| CGM-C-020 | platform | param-config | DEVICE_PRICE_USDT (设备零售价: s1=1299 / pro=2399 / … | conversion,fund_safety,platform_integri… | 运营调整设备售价(目标态=核定价);生产从 catalog 端点 fetch,admin 调价不需客户端 redeploy。 | Y | 读 GET /api/store/catalog / GET /api/products/spec… | gap |
| CGM-C-021 | platform | param-config | directBonus 各阶 (V0:0.05 / V1+:0.10) — L1 直推奖比例 | payout_pacing,fund_safety | Direct Royalty 不可调;仅 V 阶解锁逻辑变更(目标态:产品锁定值仅查阅) | Y | GET /api/config/v-ranks (读·directBonus 随阶) · Dire… | gap |
| CGM-C-022 | platform | data-CRUD | GLOBAL_V_DISTRIBUTION (全网 V 级分布: V0:84231 / V1:… | platform_integrity,network_growth | 只读 server 派生(运营核对全网 V 级人口结构) | · | GET /api/pool/state (读·全网 V 分布+池状态) — 头注 GET /api… | gap |
| CGM-C-023 | platform | param-config | MAX_DEVICES = 6 | platform_integrity,risk,fund_safety | 运营调整槽位上限(目标态=核定值);README 注:客户端 const 限制无效,真后台必须服务端强制。 | Y | 读 TBD·建议 GET /api/config/devices/slot-cap;写 PUT /… | gap |
| CGM-C-024 | platform | param-config | peerBonus 平级奖 (V3+ = 0.05) + cultivationBonus 培… | payout_pacing,fund_safety,network_growth | 运营调平级奖比例/培育奖 NEX 额度(目标态:升=放大流出过 B1;权益随阶解锁) | Y | GET /api/config/v-ranks (读) · PUT /api/admin/netw… | gap |
| CGM-C-025 | platform | param-config | prizeName / prizeIcon 实物奖品 (Apple Watch/iPhone/… | fund_safety,content_compliance,network_… | 运营调各阶奖品配置(目标态:奖品兑付联动 E 域库存/履约评估) | Y | GET /api/config/v-ranks (读·prizeName) · PUT /api/… | gap |
| CGM-C-026 | platform | param-config | V_RANKS[13] ladder (v0-v12: title/cnTitle/condi… | payout_pacing,fund_safety,phase_12mo,ne… | 运营按阶段调整各阶门槛(selfBuyUSD/directRefs/teamVolumeUSD/vDownlines)与权益(目标态:上调… | Y | GET /api/config/v-ranks (读) · PUT /api/admin/netw… | gap |
| CGM-C-027 | platform | param-config | V_VOTES (V0-V2:0 / V3:1 / V4:2 / V5:4 ... V12:5… | payout_pacing,fund_safety,network_growth | 运营调各 V 级票数权重(目标态:高阶占比更大;单人封顶防独占;改动按 F1 等级日切快照) | Y | GET /api/config/leadership-pool (读) · PUT /api/ad… | gap |
| CGM-C-028 | platform | param-config | VRankConditions 字段集 (selfBuyUSD / directRefs / … | payout_pacing,phase_12mo,network_growth | 运营调阶梯门槛阈值(目标态:门槛可配,server 校验保序/防抖动) | Y | GET /api/config/v-ranks (读·含 conditions) · PUT /a… | gap |
