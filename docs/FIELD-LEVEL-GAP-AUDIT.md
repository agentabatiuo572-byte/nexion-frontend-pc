# 字段级覆盖缺口台账 — 前端展示字段 ↔ 后台可编辑字段

> 2026-06-04 · 起因:主人发现「前端商品卡参数 ≫ 后台新增 SKU 表单字段」。
> 据此把完整性门从**动作级**(有没有'新增/编辑'这个动作)下沉到**字段级**(后台可编辑字段 ⊇ 前端展示字段),并全域扫描同型缺口。
> 本文档是主人定「下一步补哪些域」的依据。**E1 SKU 已按此范式修复;E3/G/F/H 待批次补齐。**

## 架构前提(避免误读)

前端(`Nexion-prototype`)与后台(`Nexion-admin-prototype`)是**两个独立 mock 工程,尚未共享数据层**。因此「后台改了前端不变」是当前预期状态,不是 bug。本次目标与 SKU 一致:让**后台数据模型字段镜像前端展示全集 + seed 数值对齐前端真值**,使将来接真后台时前端零重写、且运营面板显示的数字与用户端一致。三层区分:

| 层 | 含义 | 判定 |
|---|---|---|
| registry 声明(`lib/admin/registry/*.ts` 的 `fields`/`groups`) | DSL 字符串,**不渲染** | 不算"能编辑" |
| domain-view 真渲染(`app/components/domain-views/*-view.tsx`) | 真有表单/抽屉/「调整」控件 | 算 |
| store 真持久化(`platform-config-store.ts` 的 `Ops*` + `setParam`) | 写入 + 审计 + persist | 算 |

## E1 商品 SKU — 已修复(字段级 ✅ 范式样板)

- `OpsSku` 从 7 字段扩为前端 `Product` 镜像超集(**24 字段**:基本/硬件规格/价格/收益双币/营销社会证明/AI 性能/代际生命周期)。
- `baseRate` 字符串拆为结构化 `dailyEarn`+`dailyEarnNEX`;seed 按前端 PRODUCTS 6 款真值重写(修掉 S1 日产 $5.30→$38.50、库存 ∞→47 等错值)。
- 新增/编辑抽屉 6 分组全字段表单,真写 `OpsSku` store + 审计 + persist(运行时验证:新增+刷新不丢+编辑回填全字段)。
- 新增常驻 verify gate `scripts/sku-field-mirror.mjs`:断言 `OpsSku` ⊇ 前端 `Product`,前端加字段后台漏则爆红。

## 全域缺口速览(扫描结果,已抽验关键数值)

| 域·实体 | 后台现状 | 关键缺口 | 数值矛盾(后台 vs 前端真值) | 优先级 |
|---|---|---|---|---|
| **E3 设备 baseRate** | E3 tab 无 baseRate 面板(只能绕 E1) | 各档日产 USDT/NEX 调参、任务奖励倍率 questBonus、滚存/封顶 | — | **P0** |
| **E3 任务池** | OpsTask 5 字段,真接 store ✅ | 奖励**区间** min–max(被压成单值)、时长窗、逐模型 VRAM 门控、锁定任务潜在收益、sat 无输入 | 单价单值 vs 前端区间随机 | **P0** |
| **G1 Staking** | g-view 硬编码 3 档,单档 kill✅ | 罚金/最小额/锁期/池容量**只读或无控件** | **APY 三套打架**:后台 8/12/18% vs 前端 `STAKING_APY` 12/35/80/180%(已抽验) | **P0** |
| **G2 兑换** | 单/日/月 cap、手续费可调 | 平台日限、KYC 触发线、滑点/冷却/复核线 无控件 | 用户日限后台 $25K vs 前端 `USER_DAILY_CAP` $50;手续费 0.3% vs 前端 Free | **P0** |
| **G4 Genesis** | 单价/分红率/供给可调、二级 pause✅ | 收入归集比例、平台日交易量模型(分红可信度根)、挂单区间、最短持有 无控件 | **版税后台 5% vs 前端 `GENESIS_ROYALTY_RATE` 2.5%(已抽验)**;已售 812 vs 847;供给 1000 vs registry 2100 | **P0** |
| **G3 行情** | 现价只读、pump/波动/oracle 可调、pause✅ | 价格不可设(前端自跑,设计如此) | NEX 价 $0.0428 vs registry $1.286 vs 前端动态 | P1 |
| **G5 Premium/NEXv2/复投** | Premium 价/复投 3 参可调 | Premium 首月折扣/权益矩阵、NEX v2 全只读、复投门槛/预算 无控件 | 复投 APY 后台 15% vs 前端 35%;NEX v2 250% 只读 | P1(局部 P0) |
| **F1 V-Rank** | 硬编码 6 阶,门槛揉合字符串可调 | 漏 7 阶(V1/2/4/7/9/10/11);directBonus/peerBonus/版税深度/池票/培育奖/实物奖品 无控件 | — | **P0** |
| **F2 Unilevel** | L1–L7 USDT 费率可调✅ | **NEX 奖励/$1 只读**(双币另一条流出)、Rate Tier 4 档全只读 | — | P1 |
| **F3 Binary** | 门槛可调 | 匹配比例 10% 不可调、auto-placement/结转 无控件 | — | P1 |
| **F4 领导池/配额/大使/榜** | 池比例/配额门槛/榜池可调 | **V_VOTES 票数权重表**(分红唯一依据)不可配;**大使 4 类报销桶**全不可配;配额/榜单多实体被压成单值 | 池比例后台 5% vs registry 3%;V_VOTES 前端 1/64/512 vs registry 1/2/3 | **P0** |
| **F5 佣金** | 6 类事件冻结/解锁/驳回✅ | kind 枚举未完全对齐(漏 peer) | — | P2 |
| **H2 Trial** | 3 参可调 | 折扣率/宽限/延长/自动扣款开关/auto-push 4 件套/影子收益率 等 ~12 字段无控件 | 时长后台 14 vs 前端默认 3;抵扣上限 $120 vs $50 | **P0** |
| **H3 Quest** | 3 个聚合字符串可调 | **17 个真实 quest**(Day-One 6 + Weekly Tier1 9 + Tier2 8)逐个奖励全不可配;单 quest 不能停 | — | **P0** |
| **H5 签到积分** | 3 参可调 | 7 档 streak 里程碑整表、lucky 概率分布、saver 经济学 无控件 | 积分兑换口径后台 100pts=$1 vs 前端 1pt=$10(反向) | P1 |
| **H4 活动 Events** | 上线/下线/改奖励/新增✅ | 按 kind 而非按活动实例(同类多活动改不到具体);起止时间/progress 目标/推荐位/文案 无控件 | — | P1 |
| **H6 成就** | lifetime 5 档里程碑可调✅ | achievements 6 枚徽章成就系统整个无后台入口;里程碑阈值只读 | — | P1 |
| **H1 节奏 dial** | 10 dial + pin + cohort 可调✅ | 无显著缺口 | — | ✅ |

## 三类系统性根因(与既有「声明即覆盖」「修一处≠修全部」台账同型)

1. **后台用硬编码小表代替前端真实数据模型** —— f-view/h-view/g-view 各自写死小数组(`VRANK[6]`/`TRIAL_CONFIG[3]`/`QUEST_ROWS[3]`…),整张实体表是前端全集的子集:V-Rank 漏 7 阶、Quest 17 个只剩 3 聚合、大使 4 桶全缺、achievements 6 徽章整缺。
2. **registry 声明 ≫ domain-view 实现** —— registry 每实体列 15–20 个 ConfigField,domain-view 实际只渲染一小撮,大量声明字段连控件都没有(「声明即覆盖」幻觉在 F/H 域尤甚)。
3. **后台 seed 数值与前端真值矛盾** —— Staking APY、Genesis 版税/已售、兑换日限、Trial 时长/抵扣、积分兑换口径多处对不上。**这类对"产品数字必须可信不自曝庞氏"铁律是直接风险**(如 Genesis 版税显示错、池票权重显示错),须以前端真值为准统一。

## 建议补齐批次(供主人定序)

- **批次 1(P0·可信度/转化命门)** — 进度(2026-06-05):
  - ✅ **G4 Genesis**:版税 5%→**2.5%**、已售 812→**847**、补平台日交易量基数($24M)+二级地板($25,000)。verify 134/0 + browser 实景证明。
  - ✅ **G1 Staking**:APY 统一前端单源 **12/35/80/180%** + 补 365d 档 + 罚金/最小额对齐前端真值。消除三套打架。browser 证明。
  - ✅ **G2 兑换**:对齐前端 exchange.ts — 用户日限 **$50** / 平台日限 **$20,000** / KYC 触发 **$100** / 手续费 **Free**(原 0.3% 矛盾已修)。browser 证明。
  - ✅ **H3 Quest**:Weekly 17 quest(Tier1 主 9 + Tier2 互动 8)逐项奖励 + 启停,镜像前端 weekly-quests.ts。browser 17 行证明。
  - ✅ **H2 Trial**:扩 TrialConfig **17 字段全集** + 修矛盾(时长 14→3 / 抵扣 $120→$50)。browser $50 + 17 字段证明。
  - ⏳ **G 域增强(P1,后续)**:G1 罚金/最小额加可调控件、G5 复投 APY 15%→35% 矛盾。
  - ⏳ **Day-One quest(6,后续)**:weekly 之外的 day-one 6 任务(quest.ts)。

> **批次1 主体完成(2026-06-05)**:G4/G1/G2/H2/H3 五实体数值矛盾全消除 + 字段对齐前端真值,verify 134/0 + browser 实景证明。运营后台 PRD(E1/H3 行)已同步。
- **批次 2(P0·分销)** — 进度(2026-06-05):✅ F1 V-Rank **13 阶**(补 7 阶,对齐 V_RANKS 门槛/奖品/培育奖/人数)· ✅ F4 **V_VOTES 权重表**(真值 1/2/4…512,修 registry 1/2/3 矛盾,逐阶可调)· ✅ F2 Unilevel **NEX 奖励**可调 · ✅ F3 Binary **匹配比例**可调 · ✅ G1 罚金/最小额可调 · ✅ G5 复投 APY 15→35% · ✅ Day-One 6 quest + Monthly。browser 实景:V-Rank 13 行 + V_VOTES 512。
  - ⏳ **F 域后续**:区域大使 4 类报销桶(场地/KOL/物料/SDK)· F2 Rate Tier 4 档可调 · F4 配额/榜单多实体拆单值(Pro/Rack 库存、4 周期奖池)。
- **批次 3-4(P1/P2)**:E3 设备 baseRate 面板 + questBonus · H5 streak 里程碑 + lucky 概率 · H4 活动按实例粒度 · H6 achievements 6 徽章 · G3/G5 等。

## Audit(2026-06-05 · 3-agent 并行 + 回源复核)

全会话改动审计结论:**P0 = 0**(零自曝/零死控件/零回归破坏;字段镜像 OpsSku33⊇Product25+AI6 · OpsReview7⊇Review7 0 缺口;数值逐项对齐前端真值)。

**已修 P1(2 处,回源确认 + 运行时证明)**:
- `design-data.ts:86` H1 节奏 dial `trialOffsetCapUSD` $120→**$50**(同参数 H1 dial 与 H2 TrialConfig 显示矛盾=自曝,改 H2 时漏了 H1 dial 同型;已 browser 证明 H1 dial 显 $50)。
- `cgm.manifest.json:2479` crudActions 删已删字段 `monthlyPrice` + 补「用户评价 CRUD」声明。

**P2 已全部处理(2026-06-05)**:① 详情页评论区加空态占位(`_client.tsx` reviews 为空显 "No reviews yet — be the first to review");② H3 Monthly 拆为前端 5 档轮换(基石 1500 / 网络 2500 / 高阶 4000 / 钻石 6000 / 创世 10000;browser H3 共 29 行 = Day-One 7 + Weekly 17 + Monthly 5 证明);③ registry `e.ts` E1 rows 同步为真 6 SKU(S1/Pro/Pro v2/Rack P1/Rack P2/Cloud Share,对齐 design-data seed)。verify 134/0 + 前端 tsc 0 + browser 实景。**Audit 全清:P0=0 / P1=2 已修 / P2=3 已处理。**
- **批次 3(P0·E3)**:E3 设备 baseRate 调参面板 + questBonus dial;任务池区间/VRAM 门控。
- **批次 4(P1/P2)**:F2 NEX 奖励、F3 匹配比例、G3/G5、H5 里程碑、H4 活动粒度、H6 徽章、F5 kind 对齐。

## 补救范式(统一按 SKU 样板)

对每个实体:① 后台 `Ops*` 接口扩为前端模型镜像超集(结构化字段);② seed 用前端真值重写(消除数值矛盾);③ domain-view 表单/表格按字段分组真接 store + `setParam`;④ registry 的 `fields` 声明对齐实现或删除;⑤ 加 `*-field-mirror` verify 哨兵常驻防回归。
