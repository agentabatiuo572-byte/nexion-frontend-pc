# CGM-A · 平台基础(字段级控制矩阵)

> 自动生成于 Batch 0 全运营面 inventory。完整 serverCanonical/source/querySurface 见 `cgm.manifest.json`。coverage 默认 gap,per-batch 回源后升级 built/spec_only。

本域 26 行。

| id | scope | type | frontendField | opsPurpose | crudActions | 操作确认 | endpoint | cov |
|---|---|---|---|---|---|---|---|---|
| CGM-A-001 | per-user | data-CRUD | Notification (items[]: id/kind/priority/title/b… | platform_integrity,content_compliance | 运营按用户检索通知历史;对错误投放的单条通知执行撤回/删除;对合规通知补发 | · | 读 GET /api/notifications?cursor=&limit=&priority=… | gap |
| CGM-A-002 | per-user | function-action | useAuth.onboardingComplete / completeOnboarding… | platform_integrity,conversion,risk | 运营核查注册/登录记录;争议时手动标记 onboardingComplete 或强制登出;封号(置 isAuthenticated=fal… | Y | 写 POST /api/auth/{signup/signin/signout} + POST /… | gap |
| CGM-A-003 | per-user | function-action | useNotifications.markRead / markAllRead / clear… | platform_integrity,content_compliance | 运营(客服)代用户标记已读/清空通知中心;核查未读计数与触达回执 | · | 读 GET /api/notifications;写 POST /api/notification… | gap |
| CGM-A-004 | per-user | param-config | usePreferences.notifPrefs (Record<NotifKind, bo… | content_compliance,platform_integrity | 运营核查/重置用户通知偏好;在服务端强制 critical/compliance 类不可被用户静音(notifFooter 规则:Crit… | · | 读+写 TBD·建议 GET/PUT /api/me/notification-preferenc… | gap |
| CGM-A-005 | per-user | param-config | usePreferences.soundEnabled / hapticsEnabled | platform_integrity | 一般只读;客服可代用户重置 UI 体验偏好 | · | 读+写 TBD·建议 GET/PUT /api/me/ui-preferences | gap |
| CGM-A-006 | platform | param-config | ACHIEVEMENTS[] (6+ 项 category/i18nKey/rewardNex… | conversion,payout_pacing,content_compli… | 运营调每成就奖励额、增删成就、改文案/分类 | Y | 读+写 GET /api/config/achievements TBD (+ admin PUT) | gap |
| CGM-A-007 | platform | param-config | CAP_CRITICAL / CAP_HIGH / CAP_NORMAL / CAP_LOW | platform_integrity,content_compliance | 运营调整服务端留存策略(每 priority 桶上限与淘汰规则);确保 critical 类合规通知永不被 LIFO 淘汰 | Y | 读+写 TBD·建议 GET/PUT /api/admin/notifications/reten… | gap |
| CGM-A-008 | platform | param-config | EARNINGS_MILESTONES[] (5 档 thresholdUSD/nexRewa… | payout_pacing,conversion,phase_12mo | 运营调阈值/奖励额、增删档位(阶段调整) | Y | 读+写 GET /api/config/milestones (+ admin PUT TBD) | gap |
| CGM-A-009 | platform | param-config | EVENT_REWARD_NEX + EVENT_BADGE_ID + TRACKABLE_E… | conversion,payout_pacing | 运营调每活动领奖 NEX、改达成 target(如 refer 5→3)、改 trackable 集合、改评估规则 | Y | 读+写 GET /api/quests/event-config TBD · 评估 POST /a… | gap |
| CGM-A-010 | platform | param-config | EVENTS[] (10 活动:kind/status/reward/ribbon/count… | conversion,content_compliance,network_g… | 运营增删/上下线活动、改状态、改奖励文案/折扣/倒计时/featured、按区域投放 | Y | 读+写 GET /api/events?status=ongoing&region= (+ adm… | gap |
| CGM-A-011 | platform | param-config | getPhaseRewardMultiplier(phase) 1.0→1.5 (P1..P6) | phase_12mo,payout_pacing,conversion | 运营按 phase 调奖励倍率(节奏后期加码留存) | Y | 读+写 GET /api/admin/platform/phase-config (倍率字段) T… | gap |
| CGM-A-012 | platform | param-config | MONTHLY_CHALLENGES[] (5 主题 monthsFrom/To/reward… | conversion,phase_12mo,payout_pacing,net… | 运营调主题分段月数、奖励 NEX、子目标 target 阈值、增删主题 | Y | 读+写 GET /api/quests/monthly (+ admin PUT TBD) | gap |
| CGM-A-013 | platform | param-config | MONTHLY_LOCKED_TASK_USD (P1-P6 phase-keyed: 40/… | conversion,phase_12mo | 运营按 phase 调 FOMO 月度锁定额(促升级/复投) | Y | 读+写 GET /api/config/task-lock (+ admin PUT TBD) | gap |
| CGM-A-014 | platform | param-config | PHASES[] (P1-P6 ×10-dial: inviteBonusMultiplier… | phase_12mo,payout_pacing,fund_safety,co… | 运营调每 phase 各 dial 值、调 phase 月数边界、开关 feature gate(server-only enforcem… | Y | 读+写 GET /api/admin/platform/phase-config (+ admin… | gap |
| CGM-A-015 | platform | param-config | QUEST_TASKS[] (id/href/rewardNex/rewardUsdt/ord… | conversion,content_compliance | 运营调每任务奖励额、增删/重排任务、改 CTA 路由(A/B 引导实验) | Y | 读+写 GET /api/config/quest/day-one (+ admin PUT TB… | gap |
| CGM-A-016 | platform | param-config | QUEST_WINDOW_MS=24h / QUEST_GRACE_END_MS=72h / … | conversion,payout_pacing,phase_12mo | 运营调 active/grace 时窗长度、调 final/grace bonus NEX 额、调降幅 | Y | 读+写 GET /api/config/quest/day-one | gap |
| CGM-A-017 | platform | param-config | SPIN_PRIZES[] (8 档 kind/amount/weight/isReal/ti… | fund_safety,payout_pacing,platform_inte… | 运营调每档权重/面值、增删奖项、设真实奖开关;Genesis 整台节点禁入转盘 | Y | 读+写 GET /api/admin/lucky-spin/prize-pool TBD (+ P… | gap |
| CGM-A-018 | platform | param-config | STELLA_CADENCE (10 channel × {enabled,tickMs,co… | conversion,content_compliance,platform_… | 运营按 cohort/phase/风险态势在线调每 channel 的 tickMs/cooldownMs;enabled=false 单… | Y | 读+写 GET/PUT /api/admin/stella/cadence-config (TBD… | gap |
| CGM-A-019 | platform | param-config | STELLA_CADENCE.tradein.{efficiencyThreshold=0.6… | conversion,phase_12mo,payout_pacing | 运营调效率触发阈值、phase 分桶 cooldown、完成数触发阈值 | Y | 读+写 GET/PUT /api/admin/stella/cadence-config (TBD) | gap |
| CGM-A-020 | platform | param-config | STELLA_CADENCE[*].cooldownMs / tickMs / cooldow… | conversion,platform_integrity,phase_12mo | 运营按 cohort/phase/风控态调整各类推送频率;收紧 cooldown 降低打扰;调整 tradein efficiencyTh… | Y | 读 GET /api/admin/stella/cadence-config (TBD);写 PU… | gap |
| CGM-A-021 | platform | param-config | STELLA_CADENCE[*].enabled (welcome/market/upgra… | platform_integrity,conversion,content_c… | 运营按类别开/关 AI 顾问自动推送(单类 kill-switch,不影响其他类);合规收紧时一键关停 upgrade/tradein 等… | Y | 读 GET /api/admin/stella/cadence-config (TBD);写 PU… | gap |
| CGM-A-022 | platform | param-config | STREAK_POWERUPS[] (4 项 threshold/key/href/badge… | conversion,network_growth,phase_12mo | 运营调解锁阈值天数、改权益/路由、增删 power-up | Y | 读+写 GET /api/config/streak-powerups TBD (+ admin … | gap |
| CGM-A-023 | platform | param-config | TIER1_QUESTS (9 项 id/href/rewardNex/rewardUsdt/… | conversion,network_growth,phase_12mo | 运营调每档奖励额、增删任务、改派发条件阈值(余额≥2K/rank≥6 等)、改 CTA 路由 | Y | 读+写 GET /api/quests/weekly?weekKey= (+ admin PUT … | gap |
| CGM-A-024 | platform | param-config | TIER2_QUESTS (8 项 id/href/rewardNex/rewardUsdt)… | conversion,network_growth | 运营调每池奖励额、增删池项、改抽样数量、调 Weekly Champion bonus | Y | 读+写 GET /api/quests/weekly?weekKey= | gap |
| CGM-A-025 | platform | function-action | useNotifications.push | platform_integrity,content_compliance,c… | 运营创建/编辑/下发系统级广播通知模板,设置 priority 与 CTA 落地;调整 6 类 kind 的投放开关与文案;紧急时将运行中… | Y | 读 GET /api/notifications?cursor=&limit=&priority=… | gap |
| CGM-A-026 | platform | param-config | useTrialConfig.config.{autoPushEnabled,autoPush… | conversion,content_compliance,platform_… | 运营开关 auto-push、调延迟/冷却/单会话上限(防骚扰 vs 转化平衡) | Y | 读 GET /api/trial/state (+ session bootstrap) · 写 … | gap |
