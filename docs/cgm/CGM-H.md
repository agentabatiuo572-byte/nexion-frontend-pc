# CGM-H · 增长节奏(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 14 行。

| id | scope | type | frontendField | opsPurpose | crudActions | 操作确认 | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-H-001 | per-user | data-CRUD | useAchievements.records (id/unlockedAt/claimed)… | conversion,fund_safety,platform_integri… | 运营处理重复领奖申诉、撤销异常 USDT/NEX 奖励、补发漏解锁成就 | Y | 读 TBD·建议 GET /api/achievements · 写 POST /api/achi… | gap |
| CGM-H-002 | per-user | data-CRUD | useDailyPowerUp.{claimed,claimedAt} + claim/has… | conversion,network_growth | 运营处理重复激活申诉、撤销异常激活、补发 | Y | 读 TBD·建议 GET /api/powerups/state · 写 POST /api/po… | gap |
| CGM-H-003 | per-user | data-CRUD | useEventQuest.{joined,claimed,joinedAt} | conversion,platform_integrity | 运营处理重复领奖申诉、撤销异常领取、冻结刷活动账户 | Y | 读 TBD·建议 GET /api/events/state · 写 POST /api/even… | gap |
| CGM-H-004 | per-user | data-CRUD | useLuckySpin.{bonusTickets,lastFreeSpinDate,his… | fund_safety,payout_pacing,platform_inte… | 运营发/扣 bonus 票、重置今日免费次数申诉、撤销异常中奖入账 | Y | 写 POST /api/events/:id/spin (server roll + 派奖) · … | gap |
| CGM-H-005 | per-user | data-CRUD | useMilestones.firedIds + isFired/markFired | fund_safety,conversion,platform_integri… | 运营处理重复触发申诉、撤销异常 NEX 入账、重置里程碑(replay) | Y | 读 GET /api/config/milestones · 写 POST /api/milest… | gap |
| CGM-H-006 | per-user | data-CRUD | useMonthlyChallenge.{monthKey,claimedIds} + rol… | conversion,platform_integrity,phase_12mo | 运营处理重复领奖申诉、撤销异常领取、校正 monthKey | Y | 读 TBD·建议 GET /api/quests/monthly/state · 写 POST /… | gap |
| CGM-H-007 | per-user | data-CRUD | usePoints.{points,history,lastSignedInAt,signIn… | fund_safety,payout_pacing,conversion,pl… | 运营补/扣积分(申诉)、校正 streak、发/扣复活卡、撤销异常积分 | Y | 读 TBD·建议 GET /api/points/state · 写 POST /api/poin… | gap |
| CGM-H-008 | per-user | function-action | usePoints.signIn() lucky multiplier (roll<0.05→… | conversion,payout_pacing,risk | 运营调爆点概率(2x/1.5x 阈值)、7 天 bonus 额、A/B 实验分桶 | Y | 写 POST /api/points/sign-in (返 multiplier) | gap |
| CGM-H-009 | per-user | function-action | useProductPhaseOverride.{pinned,setPinned} (rep… | platform_integrity,phase_12mo | 运营无需用;审计校验 phase 决策一致性 | Y | 写 N/A(生产 no-op);读 phase 走 GET /api/admin/platform… | gap |
| CGM-H-010 | per-user | data-CRUD | useQuest.completed / claimedFinal / claimedPhas… | conversion,phase_12mo,platform_integrity | 运营校正/重置异常 quest 状态(误判 expired、重复领奖申诉);冻结争议账户的 claim | Y | 读 TBD·建议 GET /api/quest/state · 写 POST /api/quest… | gap |
| CGM-H-011 | per-user | function-action | useQuest.markComplete(id) → creditNex/creditBal… | conversion,fund_safety,platform_integri… | 运营审计/撤销异常 bonus 入账(idempotency key 重发);黑产养号批量发奖时冻结 | Y | 写 POST /api/quest/complete (返 canonical balance +… | gap |
| CGM-H-012 | per-user | data-CRUD | useStella.{messages,unread,mode,agentName,coold… | conversion,content_compliance,platform_… | 运营无需直接改;监管投诉时导出会话审计、按 channel 静默 | Y | 读 SSE /api/stella/push TBD · 写 N/A(本地会话态) | gap |
| CGM-H-013 | per-user | data-CRUD | useWeeklyQuest.{weekKey,tier1Completed,tier1Cla… | conversion,platform_integrity | 运营处理跨周 rollover 异常、重复领奖申诉、校正 weekKey;冻结刷量账户 | Y | 读 TBD·建议 GET /api/quests/weekly/state · 写 POST /a… | gap |
| CGM-H-014 | platform | function-action | useStella.enterLiveAgent() / pushAgentReply() +… | content_compliance,conversion,platform_… | 运营改客服身份池/回复模板、调 idle 超时;监管审查时下线模板 | Y | 读+写 GET /api/admin/stella/agent-templates TBD (内容… | gap |
