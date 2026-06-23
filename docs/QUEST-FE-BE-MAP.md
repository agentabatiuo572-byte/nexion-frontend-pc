# 任务系统 · 前端(uniapp)↔ 运营后台 映射文档

> 2026-06-22 · 对着 **uniapp 前端真实任务面**(`D:\WORKS\PLAN\Nexion-uniapp\src\**`)逐张卡 / 逐个数值核对它在运营后台原型(`D:\WORKS\PLAN\Nexion-admin-prototype`,H 域 H3–H6)的配置入口。
> 每个数值双侧回源(前端文件:行 ↔ 后台 `h-tabs/data.ts` 键),不凭转述。
>
> **本文档定位 vs 既有两份**:
> - `FRONTEND-LEVER-MAP.md` / `CONTROL-MAP.md`(2026-06-03 产出)= **H5 基准 · 模块级**(每域有无对应控制面)。
> - 本文档 = **uniapp 基准 · 任务专项 · 字段/数值级** + 命名碰撞澄清 + 触发机制。三者互补,不替代。

---

## 1. 状态图例

| 标记 | 含义 |
|---|---|
| 🟢 | **对齐 · 仅未连通** — 后台有对应配置键，数值与前端一致；只差真后台 API 把两套 mock 接通。 |
| 🟡 | **有对应 · 值或口径有出入** — 后台有键，但数值 / 路径 / 语义与前端不一致，接通前需对齐。 |
| 🔴① | **正向缺口** — 前端有这张卡 / 这个数值，后台**没有**可配的对应项。 |
| 🔴② | **反向缺口** — 后台有配置，但前端(uniapp)**整套功能未 port**，配置悬空无人消费。 |

> **全局前提**：前后端是两套独立 mock。前端读各自 localStorage（`nexion-quest-v1` / `nexion-nex-faucet-v1` / `nexion-milestones-v1` …），后台写 `nexion-admin-*`。**运营在后台改值，前端当前不会变** —— 要靠真后台 API 才连通。双方代码都已标 `backend-replaceable` + API 契约（见 §6）。

---

## 2.「本周任务」命名碰撞澄清 ⚠️

**「本周任务 / Weekly Quest」这个名字在前端被两个完全不同的东西共用了。** 这是排查时最易混淆的点 —— 「后台的每周任务（两档+周冠军）是不是首页那张转化卡的配置入口？」答案是 **不是**。

| 对象 | 前端载体 | i18n namespace | 后台对应 | 缺口 |
|---|---|---|---|---|
| **(a) 首页转化卡** | `components/home/conversion-banner.vue` | `home.weeklyQuest*`（`zh.ts:362`） | **无** | 🔴① |
| **(b) 真 Weekly Quest 系统** | 仅 i18n（组件未 port） | `weeklyQuest`（`zh.ts:4084`） | H3 `WEEKLY_T1`/`WEEKLY_T2`/`champBonus`/`mult` | 🔴② |
| **(c) missions 页「本周」行** | `pages/missions/missions.vue:57-72` | `missions.week*` | 占位 → 跳 daily（临时） | N/A |

**(a) 首页转化卡** = 截图下半「☄ 本周任务 · 激活 NexionBox S1 即可领取 · +1,200 NEX」。本质是**设备 upsell 促销 banner**（注释自写 `ZONE 1 upsell`）：

- `conversion-banner.vue:65-67`：`promoMult = 1.5` · `baseReward = 800` · `finalReward = 1200`（= 800 × 1.5，全硬编码）
- `conversion-banner.vue:71`：倒计时 `(4×86400 + 12×3600)s` ≈ 4d 12h（硬编码）
- `conversion-banner.vue:78,82`：`$X/d` 日产 + 目标设备名，由 `derivePromoUpgrade(app.devices)` 按用户最高设备动态派生
- `conversion-banner.vue:110-112`：整卡点击跳商城详情页

**1,200 这个数不在后台 weekly 任何一条里**（后台最接近的是 `WEEKLY_T1` 的「S1→Pro v2 = 1,500」）。它的促销外壳参数（固定 1.5×、4d12h 窗口、$日产、目标设备、CTA 文案、上下架）后台**没有任何配置项**。→ **🔴① 正向缺口**。

**(b) 真 Weekly Quest 系统** = 后台「每周任务（两档+周冠军）」的真正前端对应物。前端**有完整 i18n 文案**逐条对得上后台：

| 前端 `weeklyQuest` ns（`zh.ts`） | 后台 H3（`data.ts`） |
|---|---|
| `bonusCta`「领取 Weekly Champion 奖」(4089) | `champBonus`「+500 NEX × P3 1.1×」(`h3-quest-events.tsx:75`) |
| `promoChip`「{mult}× 加成」(4088) | `WEEKLY_MULT` 6 阶倍率（`data.ts:278`） |
| `tier1_nex_v2_lock` / `buy_genesis` / `buy_additional_hw` / `tradein_upgrade` / `upgrade_s1_to_pro_v2` / `subscribe_premium`（4092-4109） | `WEEKLY_T1` 一档 9 条（`data.ts:253`：USDT质押/买Genesis/加购/换新/S1→Prov2/复投…） |
| `tier2Label`「参与任务」(4086) | `WEEKLY_T2` 二档完成池（`data.ts:266`） |

**但承载它的组件（源原型的 `WeeklyQuestHero` / `WeeklyQuestList`）还没从 H5 port 到 uniapp**（`missions.vue:10-17` 注释明写 *"those quest subsystems are not yet ported to uni"*）。uniapp 里**无组件、无 store、无触发 watcher、无 claim** —— 见 §3。→ **🔴② 反向缺口**。

---

## 3. 任务触发与完成判定机制总览

回答「渲染面没 port，用户怎么触发任务？」—— 不同任务触发模型不同，当前 uniapp 可用性也不同：

| 任务 | 触发 / 完成判定 | 领取 | 当前 uniapp 可用性 |
|---|---|---|---|
| 首日任务（route 类） | App.vue 路由 watcher 1s 轮询自动（`App.vue:375-397`） | 自动 `creditNex` + toast | ✅ 仅 `visit_earn`/`visit_store`/`view_product_roi` 3 项能跑 |
| 首日任务（动作类） | 无触发逻辑（`connect_wallet`/`setup_profile`/`invite_friend`） | — | ⚠️ 当前**触发不了**（`invite-earn-card.vue:9` 注释：`markComplete("invite_friend") omitted`） |
| 每日签到 | 用户主动点签到（`daily.vue:305` → `nex-faucet.ts:125 signIn`） | 主动 `claimMilestone` | ✅ 能跑 |
| 签到里程碑 | streak 累积达阈值（`daily.vue:329`） | 主动领取 | ✅ 能跑 |
| 活动 | 用户主动 join / claim（`event-quest` store） | 主动 claim | ✅ 能跑（trackable 4 条） |
| 收入里程碑 | 收益累计跨阈值，App.vue 4s poll 自动（`App.vue:277-303`） | 自动庆祝浮层 | ✅ 能跑 |
| **真 weekly（两档+周冠军）** | **本应：行为归因**（server 监听质押/购买/复投…事件 → 对应后台 `questContract`，`h3-quest-events.tsx:90-106`） | **本应：主动 claim + Champion bonus** | **❌ 跑不了（无 watcher/store/渲染/claim，仅 i18n）** |

**关键认知**：
- 真 weekly 的「触发（完成判定）」靠**真实业务行为 + server 归因**，理论上**不依赖** weekly 渲染面（用户照样在质押页质押、商城加购）。
- **但「领取」依赖渲染面** —— `weeklyQuest` ns 有 `claim:"领取 +{n} NEX"`、`bonusCta:"领取 Weekly Champion 奖"`，这套设计是**要用户主动领的**（尤其周冠军 bonus），没渲染面就没领取入口。
- 且 uniapp 当前**纯 mock、无 server、无归因 watcher**，所以现在连「自动判定」都不存在。后台 17 条 weekly 配置在 uniapp 端**完全悬空**。

---

## 4. 逐面映射详表

### 4.1 首日任务卡（6 任务）🟡

**前端**：`components/home/day-one-quest-card.vue:101-122` + `store/quest.ts:56-66`
**后台**：`h-tabs/data.ts:236-250`（`DAY_ONE_TASKS` + `DAY_ONE_STATES`）· 真写键 `h3-quest-events.tsx:71-72`

| 任务 | 前端 NEX | 后台 seed | 后台真写键 |
|---|---|---|---|
| connect_wallet 连接钱包 | 50 | 绑卡 50 NEX | `H3.dayOne.0.reward` |
| visit_earn 访问收益页 | 30 | 逛收益页 30 | `H3.dayOne.1.reward` |
| visit_store 访问商城 | 50 | 逛商城 50 | `H3.dayOne.2.reward` |
| view_product_roi 看 ROI | 100 | 看回报率 100 | `H3.dayOne.3.reward` |
| setup_profile 设资料 | 80 | 设资料 80 | `H3.dayOne.4.reward` |
| invite_friend 邀请好友 | 200 + $1 | 邀请好友 200 + $1 | `H3.dayOne.5.reward` |
| **总奖励** | 500（单档） | active 500 / grace 200 / expired 0 | `H3.dayOne.triReward` |
| **时窗** | 倒计时 18h24m | 24h 全额 / 72h 宽限 | `H3.dayOne.windowMs` |

- **奖励数额前后端一致**（50/30/50/100/80/200+$1，总 500）✅
- **出入点**：
  1. **href 三套口径不一**：card（`/pages/me/wallet-topup`、`/pages/store/detail?id=stellarbox-s1`…）vs store（`/me/wallet/topup`、`/store/stellarbox-s1`…）vs 后台（`topup?kyc=1`、`/store/roi`、`/team/invite`…）。接通时需统一为真路由（→ §5 G3）。
  2. **完成语义不一**：后台是三相状态机（active 500 / grace 200 / expired 0 + 24h/72h 窗口），前端只实装 active 单档 500 + 18h24m 单一倒计时，无 grace/expired（→ §5 G4）。
  3. **触发不全**：6 项中仅 3 个 route 任务能自动完成；动作类 3 项当前触发不了（§3）。

### 4.2 每日签到 🟢

**前端**：`store/nex-faucet.ts:44-45,138` + `pages/daily/daily.vue`
**后台**：`h-tabs/data.ts:377`（`CHECKIN_RULES`）· 真写键 `H5.{baseline,bonus7,p15,p2,broken,saverHold,saverRecoverCap}`（saver 已拆「持有 / 恢复上限」单值两行）

| 规则 | 前端 | 后台 | 状态 |
|---|---|---|---|
| 每日基础 | `SIGNIN_BASE_NEX = 2` | baseline +2 NEX | 🟢 |
| 7 连胜加奖 | `SIGNIN_STREAK7_BONUS_NEX = 5` | bonus7 +5 NEX | 🟢 |
| 幸运 1.5× 概率 | `roll < 0.20`（15%）(`nex-faucet.ts:138`) | p15 15% | 🟢 |
| 幸运 2× 概率 | `roll < 0.05`（5%） | p2 5% | 🟢 |
| 断签阈值 | `2 × ONE_DAY`（48h）(`nex-faucet.ts:132`) | broken 48 小时 | 🟢 |
| 复活卡 | 默认 1 张（`nex-faucet.ts:57`） | saver 1 张 / 30 天 | 🟢 |

**全项数值一致**，仅未连通。

### 4.3 签到里程碑（7 档）🟢

**前端**：`pages/daily/daily.vue:203-211`（`MILESTONES`）
**后台**：`h-tabs/data.ts:387`（`STREAK_MS`）· 真写键 `H5.ms.<i>`

| 连胜天 | 前端奖励 | 后台奖励 | 状态 |
|---|---|---|---|
| 3 | +5 NEX | +5 NEX | 🟢 |
| 7 | +15 NEX | +15 NEX | 🟢 |
| 14 | +$1 USDT | +$1 | 🟢 |
| 21 | +100 NEX | +100 NEX | 🟢 |
| 30 | 转盘票 ×1 | 🎰 转盘票 ×1 | 🟢 |
| 60 | +$10 USDT | +$10 | 🟢 |
| 100 | 徽章 | ⭐ 连胜大师徽章 | 🟢 |

**完全一致**。

### 4.4 连胜升级券（4 档）🟡

**前端**：`components/daily/streak-power-ups.vue:97-102`
**后台**：`h-tabs/data.ts:398`（`POWER_UPS`）· 真写键 `H5.pu.<i>`

| 连胜天 | 前端 | 后台 | 状态 |
|---|---|---|---|
| 7 | royalty_boost 版税加成 →team | 版税加成（兑现 F2） | 🟢 |
| 14 | **nex_boost NEX 钱包加成** →wallet | **团队版税 +3%（兑现 F2）** | 🟡 语义出入 |
| 30 | staking_boost 质押加成 →staking | 质押 +2% 年化（兑现 G1） | 🟢 |
| 60 | genesis_whitelist →genesis | Genesis 白名单（兑现 G4） | 🟢 |

阈值 7/14/30/60 全对齐；**第 2 档（14 天）权益语义前后端不同**（前端 NEX 钱包加成 vs 后台团队版税 +3%）。

### 4.5 收入里程碑（5 档）🟢

**前端**：`store/milestones.ts:31-37`（`EARNINGS_MILESTONES`）+ App.vue 4s poll
**后台**：`h-tabs/data.ts:406`（`EARN_MS`）· 真写键 `H6.<i>`

| 终身收益阈值 | 前端 NEX | 后台 NEX | 状态 |
|---|---|---|---|
| $100 | 100 | 100 | 🟢 |
| $500 | 250 | 250 | 🟢 |
| $1,000 | 500 | 500 | 🟢 |
| $5,000 | 1,500 | 1,500 | 🟢 |
| $10,000 | 3,000 | 3,000 | 🟢 |

**完全一致**。

### 4.6 活动列表 🟡

**前端**：`mock/events.ts:56-221`（10 条 `EVENTS`）
**后台**：`h-tabs/data.ts:314`（7 条 `EVENTS_CMS`）· 真写键 `H4.event.<id>.{status,reward,featured}`

`EventKind` 闭集两端一致（8 种：discount/referral/wheel/regional/boost/seasonal/holding/onboarding）。但 demo 条目与奖励多处不一：

| 前端（10） | 后台（7） | 对照 |
|---|---|---|
| evt-pro-upgrade-7d「$500 OFF + ×2 票」featured | pro-7d「2,000 NEX」featured | 🟡 奖励完全不同 |
| evt-refer-5-get-pro「免费 Pro($899)」rewardNEX 200 | ref-5「5,000 NEX」 | 🟡 奖励不同 |
| evt-spring-spin 转盘 | spring-wheel | 🟢 对应 |
| evt-onboarding-7d「+200 NEX + Saver」 | onboard-7d「200 NEX」 | 🟢 对应 |
| evt-regional-pk「$20K」ongoing | regional-pk「—」upcoming | 🟡 状态不同 |
| evt-anniversary-spin ended | anniv-wheel ended | 🟢 对应 |
| evt-nex-holders-share「$5K」rewardNEX 120 | nex-div「见奖池」 | 🟢 对应 |
| evt-weekend-double-nex（boost） | — | 🔴① 前端单边 |
| evt-reinvest-bonus（boost） | — | 🔴① 前端单边 |
| evt-black-friday（seasonal） | — | 🔴① 前端单边 |

→ 7 条大致对应（奖励多处需对齐），3 条前端单边后台 demo 未列（boost/seasonal 类型在闭集内，可补 seed）。

### 4.7 邀请赚钱卡 🟡

**前端**：`components/team/invite-earn-card.vue:105-106,122-125`
**后台**：分散四处

| 维度 | 前端 | 后台 |
|---|---|---|
| 基础奖励 | $200 + 200 NEX（×phase 倍率） | — |
| 首日邀请 | （= 首日任务⑥） | `H3.dayOne.5` = 200 NEX + $1 |
| 周二档邀请 | （真 weekly，未 port） | `WEEKLY_T2[0]` = 200 + $2 |
| 邀请加成倍率 | `phase.inviteBonusMultiplier` | `H1.dial.invite`（`DIAL_MATRIX[*][1]`，`data.ts:74`） |
| 下线佣金 | `commission.ts` unilevel 7 层 | F2 网络版税（见 §4.8） |

**口径分散三处不一**：邀请卡 $200+200NEX vs 首日 200NEX+$1 vs 周二档 200+$2。且 `invite-earn-card.vue:9` 注释明示 `markComplete("invite_friend") omitted`（邀请完成判定未接）。

### 4.8 其他（归属非 H 域，本表只标归属）

| 前端 | 后台 | 状态 |
|---|---|---|
| unilevel 佣金 7 层（`commission.ts:43-49`：L1 0.10…L7 0.005） | F2 网络版税（Direct Royalty 10% = L1）见 `CONTROL-MAP.md` F2 | 🟢 归 F 域 |
| 算力任务 TaskCenter（`mock/tasks.ts`，GPU 跑单） | E2 设备收益任务引擎 | 🟡 归 E 域，未连通 |

---

## 5. 缺口台账（可转工单）

| ID | 类型 | 缺口 | 建议 |
|---|---|---|---|
| **G1** | ✅ 已闭环（后台） | ~~首页转化卡后台无配置入口~~ → **已落地**：H3「本周转化卡配置面」（`promo-banner-edit` businessForm，字段：基础奖励 800 / 倍率 1.5 / 倒计时天时 / 目标设备 / $日产 / 上下架 + finalReward 1200 派生）+ `GET/PUT /api/config/quest/promo-banner` 契约 + H3-MD5 弹窗。PRD v3 §H3 已同步。**前端接线待真后台**（uniapp `conversion-banner.vue` 现仍硬编码）。 | 后台 ✅；前端接线归真后台 |
| **G2** | ✅ 已闭环（前端） | ~~真 weekly 系统 uniapp 整套功能未 port~~ → **已 port**：`store/weekly-quest.ts`（周回滚+claim）+ `mock/weekly-quests.ts`（dispatchTier1 9 优先级 / dispatchTier2 8 池取 4 确定性 / phase mult 1.0→1.5）+ `components/home/weekly-quest-{hero,list}.vue` 嵌入 missions「本周」section；CTA tap 触发 completion → claim → champion bonus 全流程实景验证可达。前端 PRD §11.13.5 已同步。 | 前端 ✅；真后台接 `GET /api/quests/weekly` |
| **G3** | 🟡 | 首日任务 href 三套口径不一（card / store / 后台） | 接通时统一为真路由 |
| **G4** | 🟡 | 首日完成语义不一（三相 500/200/0 + 窗口 vs 单档 500 + 18h24m 倒计时；动作类 3 项无触发） | 前端补 grace/expired 三相 + 动作类任务完成判定（含 invite markComplete） |
| **G5** | 🟡 | 活动列表条目/奖励对不齐（前端 10 vs 后台 7；7 对应奖励多处不一，3 前端单边） | 对齐 demo seed + 奖励口径 |
| **G6** | 🟡 | 邀请奖励口径分散三处不一（$200+200NEX / 200NEX+$1 / 200+$2） | 统一邀请奖励口径单源 |
| **G7** | 🟡 | 全局两套独立 mock 未连通 | 接真后台 API（见 §6），预期态 |

---

## 6. 接真后台 API 契约对接清单

前端代码注释里预留的 API ↔ 后台真写键：

| 前端 API（注释预留） | 前端出处 | 后台真写键 |
|---|---|---|
| `GET /api/quest` + `POST /api/quest/complete` | `store/quest.ts:25-29` | `H3.dayOne.*` |
| `POST /api/events/:id/join \| claim` | `store/event-quest.ts` | `H4.event.*` |
| `POST /api/nex/sign-in` | `store/nex-faucet.ts:20` | `H5.{baseline,bonus7,p15,p2,...}` |
| `GET /api/config/milestones` + `POST /api/me/milestones/:id/claim` | `store/milestones.ts:16-21` | `H6` `EARN_MS` |
| `GET /api/config/commission/rates` | `store/commission.ts:6` | F2 网络版税 |
| `GET/PUT /api/config/quest/promo-banner`（契约已定） | uniapp `conversion-banner.vue:65-82`（待接） | `H3.promoBanner.config`（✅ 后台已建，G1 闭环） |
| `GET /api/quests/weekly?weekKey=`（契约已定） | uniapp `store/weekly-quest.ts` + `weekly-quest-{hero,list}.vue`（✅ 已 port，mock 待接） | `H3.weekly.*`（✅ 后台已建 + 前端已 port，G2 闭环） |

---

## 7. 备注：后台写约束

- **`setParam` + amplifies + B1 红线**：升奖励 / 升倍率 / 升概率 / 降门槛 = 放大 NEX 流出，提交即过 B1 备付金覆盖率红线核验（不足直接 422）。见 `h3-quest-events.tsx` 各 `openActionConfirm({ amplifies: true })`。
- **单源纪律**：后台权威数值零复制，全部 join 或同源派生（`data.ts:4-10`）。改值改 `h-tabs/data.ts`，registry/h.ts 的 content 是死代码。
- **questContract 行为归因契约**（`h3-quest-events.tsx:90-106`）：每个任务派生 `task_key` / 服务端事件 `quest.task_completed` / 下游业务事件 / B3 漏斗归属 / L 域 BI 口径 —— 真 weekly 接通时的触发归因即依此契约。
- **server-canonical**：完成态 / claim 态 server 权威，client 不可伪造；claim 携 Idempotency-Key 防重；过期优先于领取（409）。

---

> **结论速记**：后台**不缺**任务控制模块（H3 全有，真渲染面 `/growth/quest`）。前后端任务体系**视觉/数值大面对齐**（签到、里程碑、收入里程碑完全一致），核心待办是：① 接真后台 API 打通两套 mock；② ~~补首页转化卡的后台配置入口（G1）~~ **✅ G1 已闭环**（H3 本周转化卡配置面 + `promo-banner` endpoint 已落地，前端接线待真后台）；③ ~~把真 weekly 系统 port 到 uniapp（G2）~~ **✅ G2 已闭环**（uniapp weekly-quest store + hero/list 组件嵌入 missions「本周」，全 claim / champion bonus 流程实景验证可达）。
>
> **2026-06 进度补记**：H3 三层任务（首日 / 每周两档 / 月度）后台已从「只改单个奖励数字」升级为**完整 CRUD**——多字段编辑（businessForm）+ 增 / 删 + 上下架 `status`（生效中 / 已停用 / 已归档）+ 完成判定 `completionType`（visit / event / manual）+ `completionEvent`（阶段1-2 落地）；转化卡配置 G1（阶段3 落地）；**uniapp 真 Weekly Quest port G2（阶段4 落地**：dispatchTier1 9 优先级 / dispatchTier2 8 池取 4 确定性 / phase mult + 周回滚 + claim/champion bonus，嵌入 missions「本周」，CTA tap 触发 completion）。后台同步进 PRD v3 §H3（弹窗 H3-MD1 / MD2 / MD3 / MD5），前端同步进 PRD §11.13.5。
