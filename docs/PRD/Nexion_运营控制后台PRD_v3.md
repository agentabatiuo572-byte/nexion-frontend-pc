# Nexion · 运营控制后台 PRD(Ops Console PRD)— V3 卷:金融产品(G)+ 增长活动(H3-H6)

> 本卷是运营控制后台 PRD 的 **V3 分卷**,承接 V1 卷(`Nexion_运营控制后台PRD_v1.md`)与 V2 卷(`Nexion_运营控制后台PRD_v2.md`)的横切地基:§1.8 三原则(双账本 / server-canonical / 埋点优先)· A2 审计 & 操作确认(Confirm-with-Reason)· A4 埋点事件体系(§2.4)· §3.14 跨域归属 · H1 Phase 8-dial 权威(§1.7)· B1 兑付覆盖率红线。章节编号续 V2(Ch12 起)。
> **跨卷 §锚点**:§1.x–§9.x(本后台)指向 **V1 文件**;§10.x–§11.x(本后台)指向 **V2 文件**;§13.4 / §9.11x / §6.x / §7.x / §10.x / §5.7 等指向前端 PRD v3.5 与 12 月节奏表。参数默认值锚 12 月节奏表 §6,前端为现状参考。撰写遵循 `nexion-admin-prd` skill 流水线。
> **本卷主题**:金融产品(G 域)是平台「NEX 平台代币经济(前端 §1.4 第三条收入支柱)+ 设备-外金融产品」核心运营控制面——Staking 池 APY / 兑换风控 caps / NEX 周曲线关键帧排程 / Genesis 经济 / 复投激励;增长活动(H3-H6)是留存与活跃节奏的运营控制面——Quest 任务 / 限时活动 / 签到连胜 / 里程碑。两域均高度依赖 H1 Phase 调度(questBonusMultiplier 等时变 dial)与 B1 兑付覆盖率约束(所有放大流出的 APY / 分红 / 奖励)。

## 目录(V3 卷)

| 章 | 标题 | 域 | 状态 |
|---|---|---|---|
| 12 | 金融产品 | G | ✅ 本卷 |
| 13 | 增长活动(Quest/活动/签到/里程碑) | H3-H6 | ✅ 本卷 |

---

## 第 12 章 金融产品(域 G)

> **域定位**:金融产品(G 域)是平台「NEX 平台代币经济(前端 §1.4 第三条收入支柱:锁仓 / 兑换 / 二级市场)+ 设备-外金融产品(复投)」的运营控制面(§1.4 四条收入支柱中未列「金融产品利差」独立科目,本域定位对齐 §1.4 既有分类,不另立排名)。它把用户「已收资金」沉淀为锁仓 / 兑换 / 持有 / 复投四类产品,并通过 APY / caps / 价格曲线 / 分红率 等杠杆调节资金流入与流出节奏。G 域 **5 个子模块全部 V3**:G1 Staking 池配置 · G2 兑换风控 · G3 NEX 周曲线关键帧排程器 · G4 Genesis 经济 · G7 复投激励。
>
> **八条贯穿全章的跨域事实(逐子模块兑现)**:
> 1. **放大流出前置核验 B1(§1.8 原则一)**:升 APY / 升分红率 / 放宽兑换 caps / 拉升 NEX 现价 / 降罚款 —— 任一放大资金流出方向的金融参数,提交前 server 须先核验 B1 兑付覆盖率红线(`coverageRedLine` 默认 **100%**,§1.8 / Ch4 B1 §③),低于红线 server 拒绝提交(返回 422 + 当前覆盖率)。**NEX 计价负债重估口径(本章权威定义,G3/G6 单向引用此处)**:凡拉升 NEX 现价 / 升 NEX 计价 APY 的 B1 前置核验,**须以「拟生效新价」重算含在锁 NEX 本金在内的全量 NEX 计价应付负债(如 G6 NEX v2 在锁本金 USDT 等值)后再判红线**,避免旧价分母通过、新价生效后跌破红线的窗口(Ch4 B1 §③ 落权威定义)。
> 2. **USDT 派发即落 D4 bill + 锁仓计 B2/D3 负债**:staking 到期本息 / Genesis 日分红 / NEX v2 到期 / 复投到期 / premium 返现的每笔 USDT 派发即在 **D4 账本落一条 bill**(与 A4 money 事件一一对应,V2 D4 §账实相符);staking / NEX v2 锁仓的**未到期本息**计入 **B2 应付负债 / D3 资金池**应付侧(§3.14:应付负债权威归 B1/B2、资金池水位权威归 D3)。**G 域不另立账本**,只配置产品参数并触发派发,记账与水位归 D/B。
> 3. **server-canonical(§9.11d)**:staking position 状态机 · NEX price 与周价格曲线推进 · exchange gate 决策 · Genesis ownership 全部服务端权威,client 仅 UI cache / preview;后台各子模块写明该约束。
> 4. **操作确认(Confirm-with-Reason,§1.8 原则二.4;2026-06 操作确认决议)**:改 APY / penalty、改兑换 caps / gate 阈值、改 NEX 周价格曲线关键帧 / 排程 / oracle 源、Genesis pause / 分红率 / geo、各 kill-switch —— 一律单人执行 + 业务专属确认弹窗 + 理由必填(server 强制非空,400 `REASON_REQUIRED`,8–200 字)+ A2 审计留痕(operator / before / after / reason / IP / ts),即时生效;高敏动作落审计同时实时告警超管与对应域角色 lead。**放大资金流出方向的动作前置 B1 兑付覆盖率红线核验**(低于红线 server 拒绝,422 `COVERAGE_BELOW_REDLINE`),其确认弹窗内必有影响预览区展示 server 预检的「拟生效后覆盖率」;资金 / 资产类写入另携 `Idempotency-Key`(§9.11e)。各动作的执行权与弹窗规格见各子模块「④ 操作动作」与「④a」段。**kill-switch 矩阵权威归 J1(V4)**,G 域各子模块是 kill 的**生效面**(本章列出各产品的 kill endpoint,矩阵编排与跨闸联动在 J1);kill 熔断为止血方向(执行=风控(lead)/ 超管,不前置 B1),**恢复方向(disable→enable)执行=仅超管 + B1 红线预检**(V1 切换入口在 A3〔A3-MD3〕,与 V1 A3④ 口径一致)。
> 5. **埋点对齐 A4(§2.4)**:本章所有 `§2.4.x` 埋点锚（domain 枚举 §2.4.3 / money family §2.4.5 ③ / 漏斗定义 §2.4.7）均指 **V1 卷 §2.4(A4 埋点事件体系)**,**非前端 v3.5 §2.4（前端 §2.4 是「30 天用户旅程」，其下无 2.4.3/2.4.5/2.4.7）**——避免 prototype lens 误读为前端锚。§2.4.3 domain 枚举**已含** `staking / exchange / genesis`(G1/G2/G4 复用);**未含** `nex`(G3)/ `repurchase`(G7)—— 这两个 domain 须**向 A4 申请 domain 枚举扩展(V1 §2.4.3），blocking 依赖,登记为 V3 起始工单**(体例参 V2 E4 `order` domain / F5 `commission.kind`)。锁仓 / 分红 / 到期派发类事件 `is_server_authoritative=true`。
> 6. **12 月默认值口径(§7 硬规则)**:APY / 分红率 / 兑换 caps / NEX 价 / 节点价 等业务常量 12 月 §6 未覆盖 → 以前端 §9.4–§9.6 / §10 / §13.3 现状值为**参考并标注「现状值」**。三者冲突以 12 月节奏表为准,就地注明差异。
> 7. **中性运营语言**:全程真实平台金融运营者口径(理财产品 / 质押利率 / 兑换风控 / 做市 / 分红 / 锁仓 / 预言机喂价),禁一切编辑性 / 价格操纵类措辞,价格调节统一表述为「做市 / 价格曲线 / 价格上行概率 / 波动幅度」。
> 8. **派发 / claim / 熔断幂等 + 并发裁决(对齐 §9.11e)**:所有资金派发(staking / Genesis 日分红 / NEX v2 到期 / 复投到期本息)与各 kill endpoint 均须携 **`Idempotency-Key`**(V1 §9.11e 明列「`Idempotency-Key`(资金/资产类动作)」为必填;§9.11e 跨 store mutation 原子性 + 幂等去重),网络 retry 不致重复派发 / 重复入账。**竞态裁决规则**:`kill 锁定优先于 in-flight claim`——position 一旦进 `slashed` / `early_forfeit` 等 kill 终态,并发到达的 `claim` 返 **409**(状态已变,不再派发);参数变更对 in-flight position **按开锁时锁定值结算**(乐观锁,不可追溯改既有 position)。逐子模块 ⑦ 据此兑现各自的派发 / claim / kill 竞态点。

---

#### [G1] Staking 池配置
**① 目的 & 对齐**: 配置平台两套定期质押产品(USDT 锁仓 + NEX 池)的 4 档期限 APY、提前赎回罚款、最小额、启用态与单档 kill,作为 NEX 代币经济(§1.4 第三支柱)质押利率/利差的核心调节面。对齐前端 **§9.6**(`/staking` 4 档 30/90/180/365 天)+ **§13.3.1**(USDT/NEX 双产品数值)+ **§9.11c.1**(staking pools 统一接口)+ **§9.11d.1**(单档 disable kill)。服务业务目标:在 B1 兑付安全约束内,用高档 APY 沉淀长周期锁仓资金(提升留存与「已收资金」规模),服务 **§18.2 Day7 留存(>60%)** 的资金侧留存路径与 **B1 兑付安全水位**(内部风控口径;§18.2 八项 KPI 闭集无「资金留存 / LTV」项,staking 按前端 §1.4 商业模式四支柱归入第三支柱「NEX 平台代币经济(锁仓/兑换/二级市场)」、未单列独立收入科目,故不以臆造 KPI 锚定)。

**② 后台界面**:
- **池配置列表**(双产品分组,每产品 4 档行):`产品(USDT 锁仓 / NEX 池)· 期限(30/90/180/365d)· APY · penalty% · minStake · enabled · 在锁本金合计 · 在锁 position 数 · 累计应付利息(D3 派生)· 单档 kill 状态灯`。
- **Position 监控视图**(只读,server-canonical):按状态机分组计数 + 可下钻单 position(`userId 脱敏 / 产品 / 期限 / 本金 / APY 锁定值 / 开锁时间 / 到期时间 / 累计应付利息 / 状态`)。
- **状态机**(V1 §9 数据模型,server-canonical):`pending_lock(提交锁仓待确认)→ active(锁仓计息中)→ mature_unclaimed(到期未领)→ claimed(已领本息)`;旁路:`active → early_withdrawn(提前赎回·扣罚款 forfeit 利息)`、`active/mature_unclaimed → slashed(单档 kill 后处置)`、`pending_lock → refunded(锁仓失败退本金)`。
- **关键视图**:到期日历(未来 N 天到期本息热力,喂 B2 到期负债预测)+ 单档 kill 影响预览(disable 某档对在锁 position 的处置说明)。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| USDT 锁仓 APY(30/90/180/365d) | **现状值(§9.6 / §13.3.1)**:12% / 35% / 80% / 180% | 各档 0–300%,保序(长期 ≥ 短期) | 仅新 position(在锁按开锁时锁定 APY 到期) | `/staking` plan 卡 APY 大字 + Stake sheet 预测 |
| USDT 锁仓 penalty(30/90/180/365d) | **现状值(§9.6)**:5% / 15% / 30% / 50% 本金 | 各档 0–100% | 仅新 position | `/staking` plan 卡罚款警告 + early withdraw 提示 |
| NEX 池 APY(30/90/180/365d) | **现状值(§13.3.1)**:5% / 12% / 20% / 35% | 各档 0–300%,保序 | 仅新 position | `/staking` NEX 产品 APY(币种区分文案) |
| NEX 池 minStake(30/90/180/365d) | **现状值(§13.3.1)**:1,000 / 5,000 / 10,000 / 20,000 NEX | ≥ 0 | 仅新 position | NEX 池 Stake sheet 最小额校验 |
| `enabled`(每产品每档) | true | bool | 实时(关闭即停新锁,在锁不受影响,除非走 kill) | plan 卡是否可 Stake |
| 单档 kill(尤其 180%/365d) | 关 | bool | 实时(熔断停新锁 + 在锁处置走 ⑦) | plan 卡熔断态(对齐 §9.11d.1) |

> **⚠️ USDT-staking APY 多披露面收敛(承接前端 §13.3.1 已记录的 withdraw 页 mismatch 并落实其收敛方案,记入 §3.14 待补)**:**canonical 仅 §9.6 主表**(`12% / 35% / 80% / 180%`,源 `lib/v3/staking.ts`);其余披露面均**误用 `5/12/20/35`(NEX 池数)**——① **§9.6.3 how-it-works** `$100` 示例(`30d/5% · 90d/12% · 180d/20% · 365d/35%`,且美元值 `30d/$4.11` 等按复利/夸大口径,与 simple-interest 不符:`$100×5%×30/365 = $0.41`,差约 10×,$ 值须按 simple-interest 重算);② **§9.3.4 StakeAlternativeCard**(`5%/12%/20%`);③ **withdraw 页**(`0.05/0.12/0.20`)。前端 **§13.3.1已记录 withdraw 页一处 mismatch 及收敛方案**(单一 `GET /api/config/staking/pools` 数据源);本审查另发现 §9.6.3 / §9.3.4 两处同源误用 NEX 池数,**合计 4 披露面**(前端 §13.3.1 称 withdraw 页为「第三套」,本卷按 canonical §9.6 计为含主表共 4 披露面):四面逐条登记统一改读 `GET /api/config/staking/pools`(USDT product),消除 UI/业务 mismatch;§9.6.3 美元示例须按 simple-interest 重算。区分「前端已记录(withdraw 页)」与「本章新增发现(§9.6.3 / §9.3.4)」。
> **默认值口径**:12 月节奏表 §6 未覆盖 staking APY/penalty,故取前端现状值(标注「现状值」);升 APY / 降 penalty 属放大流出,受 ① B1 红线前置约束。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改 APY / penalty / minStake | 财务(lead)/ 超管(2026-06 操作确认决议,原复核层级就高为执行门槛) | G1-MD1(理由必填+B1 红线预检) | `admin.staking_pool_config_changed`(产品 / 期限 / 前后值 / 原因 / operator) |
| 切换单档 `enabled` | 运营(lead)/ 超管 | G1-MD2(理由必填) | `admin.staking_pool_enabled_changed` |
| 单档 kill(熔断) | 风控(lead)/ 超管(止血方向) | G1-MD3(理由必填;在锁 position 处置方案须随单提交) | `admin.staking_pool_killed`(poolId / 处置方案 / operator)→ 同步 J1 矩阵 |
| 查看池配置 / position 监控 / 到期日历 | 全角色(按可见性裁剪) | 否(只读) | — |

> **单档恢复(disable→enable)不在本表**:恢复属放大流出方向,V1 经 A3 kill-switch config store 执行(A3-MD3:仅超管 + B1 红线预检),V4 归 J1 矩阵;G1 仅作生效面(章首贯穿事实 ④)。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改 APY / penalty / minStake | ② 池配置列表行内「编辑」(每产品每档) | 行内按钮 | 仅财务(lead)/ 超管渲染;已 kill 档置灰 | 打开弹窗 G1-MD1 |
| 切换单档 enabled | ② 池配置列表行内 `enabled` 开关 | 开关 | 仅运营(lead)/ 超管可操作;已 kill 档置灰 | 打开弹窗 G1-MD2 |
| 单档 kill(熔断) | ② 池配置列表行内「熔断」(联动「单档 kill 影响预览」关键视图) | 行内警示按钮 | 仅风控(lead)/ 超管渲染;仅未 kill 档显示 | 打开弹窗 G1-MD3 |
| 查看 position 监控 / 到期日历 | ② Position 监控视图 / 关键视图 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [G1-MD1] Staking 单档参数变更
- **功能**:修改单产品单档的 APY / penalty / minStake,确认即生效(仅对新 position,在锁按开锁锁定值结算)。
- **布局结构**:1. **信息区**:产品 / 期限 / 当前 APY / penalty / minStake / 该档在锁本金合计 / 在锁 position 数。2. **影响预览区**:before→after 并排;server 预检「**拟生效后覆盖率**」+ **受影响在锁 position 数**(在锁按开锁锁定值结算,新值仅对新 position 生效);升 APY / 降 penalty 且预检低于 B1 红线时展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);跨档保序冲突时内联指出冲突档位。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 APY | 数字输入(%) | 改 APY 时必填 | 各档 0–300%,同产品跨档保序(③ 表);违反 server 返 422 | 当前值 |
| 目标 penalty | 数字输入(%) | 改 penalty 时必填 | 各档 0–100%(③ 表) | 当前值 |
| 目标 minStake | 数字输入 | 改 minStake 时必填 | ≥ 0(③ 表) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(主按钮;必填未过校验 / 升 APY · 降 penalty 预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(跨档保序违反,内联指出冲突档位)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403(执行权不符)。
- **成功反馈**:弹窗关闭;池配置行就地更新;toast「单档参数已生效 · 已记审计」;事件 `admin.staking_pool_config_changed`;实时告警超管 + 财务 lead。

##### [G1-MD2] 单档启用态切换
- **功能**:切换单产品单档 `enabled`(关闭即停新锁,在锁不受影响),确认即生效。
- **布局结构**:1. **信息区**:产品 / 期限 / 当前 `enabled` 态 / 该档在锁 position 数(关闭不影响在锁,仅停新锁)。2. **输入区**:reason(多行文本,必填,8–200 字)。3. **按钮区**:取消 / 确认切换。
- **错误态**:400 `REASON_REQUIRED` / 409(状态已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;行内开关就地更新;toast「启用态已切换 · 已记审计」;事件 `admin.staking_pool_enabled_changed`;实时告警超管 + 运营 lead。

##### [G1-MD3] Staking 单档熔断
- **功能**:单档 kill(对齐 §9.11d.1),止血方向,确认即 server enforce(停新锁 + 在锁处置走 ⑦),处置方案随单提交。
- **布局结构**:1. **信息区**:产品 / 期限 / **该档在锁本金合计 + 在锁 position 数 + 处置预案说明**(②「单档 kill 影响预览」同源)/ 最近一次该档变更记录(引自审计)。2. **影响预览区**:警示条「熔断后该档全局停新锁,在锁 position 按处置方案进入 `slashed` 处置;即时生效并同步 J1 矩阵 + B5 风险雷达」。3. **输入区**:在锁处置方案(多行文本,必填;随单落审计)+ reason(多行文本,必填,8–200 字)+ 触发依据单选(监管点名 / 兑付风险 / 安全事件 / 其他)。4. **按钮区**:取消 / 确认熔断(警示色)。
- **错误态**:400 `REASON_REQUIRED` / 409(该档已为 kill 态,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;单档 kill 状态灯变红;toast「已熔断 · 已记审计」;事件 `admin.staking_pool_killed`(携 `Idempotency-Key` 提交);实时告警超管 + 风控 lead;同步 J1 矩阵 + B5 风险雷达。恢复经 A3-MD3(仅超管 + B1 红线预检)。

**⑤ 接口**(收敛 §9.11c.1 / §9.11d.1):
- `GET /api/config/staking/pools` — 双产品 4 档全表(APY/penalty/minStake/enabled);**server-canonical 配置源**,前端 `/staking`(§9.6 主表)+ §9.6.3 how-it-works 示例 + §9.3.4 StakeAlternativeCard + withdraw 页 stake-alternative 卡**四面统一读此**(消除 USDT-staking 多披露面 mismatch,见 ③ 收敛注)。
- `GET /api/admin/staking/positions?status=&product=&cursor=` — position 监控(按状态机 / 产品筛,游标分页);返回 server 权威 position 列表 + 累计应付利息(D3 派生)。
- `PUT /api/admin/staking/pools/:product/:term` — 改单档参数(经确认弹窗 G1-MD1,reason 必填(空值 400 `REASON_REQUIRED`);**升 APY / 降 penalty server 先核 B1 覆盖率,< 红线返 422**;**单档 APY 改动还须通过同产品跨档保序校验(长期档 APY ≥ 相邻短期档),违反返 422 + 提示冲突档位**——保序校验与 B1 红线校验同为提交前 server 硬门,非文档建议)。
- `POST /api/admin/staking/pool/:id/disable` — 单档 kill(对齐 §9.11d.1;经确认弹窗 G1-MD3,reason + 在锁处置方案必填;携 `Idempotency-Key`)。

**⑥ 权限 & 审计**:
| 角色 | 查看池/position | 改 APY/penalty/minStake | 切 enabled | 单档 kill |
|---|---|---|---|---|
| 运营 | ✅ | — | ✅(lead) | — |
| 财务 | ✅ | ✅(lead) | — | — |
| 风控/合规 | ✅ | — | — | ✅(lead) |
| 超管 | ✅ | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):放大流出方向(改 APY/penalty/minStake)按原复核层级就高为执行门槛(财务(lead)/ 超管 + B1 红线预检);enabled 切换 = 运营(lead)/ 超管;单档 kill = 止血方向,风控(lead)/ 超管。

审计字段(A2):`action / product / term / field / before / after / reason / coverageAtSubmit(改 APY 时记提交时覆盖率) / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:position 状态机、在锁本金、累计利息、APY 锁定值全部 server 权威;client `/staking` 实时累积利息(每 4s tick)仅 UI 预览,不写账;`Bills` 客户端 push 无效,到期本息以 server 派发的 D4 bill 为准。
- **负债联动(② 跨域事实)**:`staking.opened` 增 B2 应付负债(本金 + 按 APY × 已锁天数线性派生的应付利息,Ch4 B2 §负债科目 2/3);`staking.claimed` 核减;到期派发落 D4 bill。**B2 到期负债预测**消费 G1 到期日历。
- **B1 前置(① 跨域事实)**:升 APY / 降 penalty 提交即被 `PUT` server 拦截核验覆盖率红线。
- **篡改防御(§9.11d.2)**:client 不得本地推进 position 状态或伪造到期 claim;早赎 forfeit 利息由 server 计算扣除,client 仅展示。
- **幂等 & 并发裁决(章首贯穿事实 ⑧;§9.11e)**:`claim` 本息派发携 `Idempotency-Key` 去重(retry 不重复入账);竞态 `mature_unclaimed/active → claimed` 与 `active/mature_unclaimed → slashed`(单档 kill)同源,**kill 锁定优先**——position 进 `slashed` 后并发 `claim` 返 **409**;改 APY/penalty 对 in-flight position 按开锁时锁定值结算(乐观锁,不追溯)。
- **kill 联动 J1(V4)**:单档 disable 是 J1 kill-switch 矩阵的生效面;熔断 180%/365d 高息档时 J1 编排跨闸联动(如同步预警 B5 风险雷达)。

**⑧ 埋点(事件)**:
- **消费**:`staking.opened / staking.claimed`(§2.4.5 ③ money,`is_server_authoritative=true`;G1 监控视图与到期日历消费)。
- **产生(admin 审计)**:`admin.staking_pool_config_changed` · `admin.staking_pool_enabled_changed` · `admin.staking_pool_killed`(走 A2 操作确认审计(operator / reason),登记 A4 schema registry)。
- **domain 状态**:`staking` 已在 §2.4.3 枚举内,无需扩展。
- **喂给**:`staking.opened/claimed` → B2 应付负债 / D3 资金池 / D4 账本 / B1 覆盖率;到期日历 → B2 到期预测;kill 审计 → J1(V4)+ B5 风险雷达 + L3 财务报表。

---

#### [G2] 兑换风控
**① 目的 & 对齐**: 配置 NEX↔USDT 兑换的三阈值风控 caps、gate 决策与排队逻辑,作为「代币经济」资金从 NEX 形态流出到 USDT(可提现)形态的闸门。对齐前端 **§9.4**(`/me/wallet/exchange`:§9.4.1 Swap UI / §9.4.2 三阈值 caps / §9.4.3 Gate 决策 / §9.4.4 风控仪表盘)+ **§9.11c.1**(exchange 三阈值接口)。服务业务目标:在合规(FATF Travel Rule / MiCA 叙事)与兑付安全约束内,限制 NEX→USDT 的日流出速度,保护资金池水位,服务 **B1 兑付覆盖率水位**(内部风控口径;§18.2 八项 KPI 闭集无「资金安全」项,本模块为风控/兑付安全杠杆,不以臆造 KPI 锚定)。

**② 后台界面**:
- **caps 配置面**:`USER_DAILY_CAP / PLATFORM_DAILY_CAP / KYC_LIFETIME_THRESHOLD` 三阈值 + 当前实时占用(用户侧分布 / 平台日池占用 %)。
- **Gate 决策监控**:三类拦截命中计数与趋势(`kyc-required / user-cap / platform-cap`)。
- **Queue 视图**(只读,server-canonical):超 cap 进入次日队列的待处理兑换单列表(`userId 脱敏 / 方向 / 金额 / 入队时间 / 预计处理日`),可取消(用户侧「funds never locked unilaterally」叙事的运营内部对应面)。
- **风控仪表盘**(对齐 §9.4.4):平台日池进度条 + KYC 触发线命中分布 + Queue 深度。
- **状态机**(兑换单,server-canonical):`submitted → gated(被拦截)| queued(排队) | swapped(成交·落 swap bill)`;`queued → swapped(次日处理)| cancelled(用户取消)`。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| `USER_DAILY_CAP_USD` | **现状值(§9.4.2 / §13.3)**:50 | 0–10,000 | 实时(当日额度判定即用新值) | §9.4.4 用户日 cap 进度条 + gate `user-cap` |
| `PLATFORM_DAILY_CAP_USD` | **现状值(§9.4.2 / §13.3)**:20,000 | 0–10,000,000 | 实时 | §9.4.4 平台日池进度条 + gate `platform-cap` |
| `KYC_LIFETIME_THRESHOLD_USD` | **现状值(§9.4.2 / §13.3)**:100 | 0–100,000 | 实时(累计达阈值即触发) | gate `kyc-required` → 引导 `/me/wallet/topup?kyc=1` |
| `EXCHANGE_FEE_PCT`(兑换手续费率) | **现状值(§9.4.1 `exchange.feeFree` / §13.3)**:0%(免费推广期) | 0%–10% | 仅新单(在途按提交时锁定费率,改后不追溯) | §9.4.1 swap UI `feeLabel/feeFree`;开费后值同步显示 |
| `EXCHANGE_FEE_MIN_USD`(最低单笔手续费) | 0.50(随费率启用生效;`EXCHANGE_FEE_PCT=0` 时不计) | 0–5 | 仅新单 | 单笔实际手续费 = `max(amount × EXCHANGE_FEE_PCT, EXCHANGE_FEE_MIN_USD)` |
| Queue 启用(超 cap 排队 vs 直接拒绝) | 启用(超 cap 进次日队列) | bool | 实时 | `user-cap`/`platform-cap` 弹窗「Queue for tomorrow」 |
| swap 全局 pause(kill) | 关 | bool | 实时(熔断停所有兑换) | 兑换页熔断态(§9.11d.1) |
| `geo_block`(地域限制) | 空 | 国家码数组 | 实时(随 pause 提交,边缘 IP 判定) | 兑换页 geo 拦截(**§9.11d.1 通用 region geo-block 派生**「各 endpoint 加 geo_block」;§9.11d.1 exchange pause 行本身未显式列 geo_block,此为通用 region 拦截在兑换面的可选扩展,非前端 exchange 专属既有字段) |

> **默认值口径**:12 月节奏表 §6 未覆盖兑换 caps,取前端现状值(标注「现状值」)。**放宽 caps（升 USER/PLATFORM_DAILY_CAP）/ 降 `EXCHANGE_FEE_PCT` = 放大 USDT 流出**,受 ① B1 红线前置约束。`geo_block` 为 §9.11d.1 通用 region geo-block在兑换面的派生扩展(非前端 exchange 专属字段),随 swap pause 提交、kill 矩阵编排归 J1(V4)。
>
> **`EXCHANGE_FEE_PCT` 收入分配口径(本子模块权威定义)**:费率启用后,每笔兑换手续费按 **30% 进 NEX 回购销毁池**(对应 G3 NEX 周曲线排程器的回购销毁量)/ **70% 进 D1 `fee_buffer` 备付金**(对齐 D1③ Card 渠道 `fee_buffer` 同一备付金池);分配比例本身为运营杠杆(可在本表追加 `FEE_BURN_RATIO` 参数,默认 0.30,V4 视需开放)。「30% 平台手续费回购」叙事的真实数学来源在此,降费/调分配比 = 放大流出方向(回购量减少 / 备付金累积放缓),受 B1 红线前置约束。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改三阈值 caps | 财务(lead)/ 超管(2026-06 操作确认决议,放宽方向原复核层级就高为执行门槛) | G2-MD1(理由必填+B1 红线预检(放宽方向)) | `admin.exchange_caps_changed`(字段 / 前后值 / coverageAtSubmit / 原因 / operator) |
| 改 `EXCHANGE_FEE_PCT` / `EXCHANGE_FEE_MIN_USD` | 财务(lead)/ 超管 | G2-MD2(理由必填+B1 红线预检(降费率方向)) | `admin.exchange_fee_changed`(字段 / 前后值 / coverageAtSubmit / 原因 / operator) |
| 切 Queue 启用 / 处理次日队列 | 运营(lead)/ 超管 | G2-MD3(理由必填) | `admin.exchange_queue_config_changed` |
| swap 全局 pause(kill) | 风控(lead)/ 超管(止血方向) | G2-MD4(理由必填) | `admin.exchange_paused`(reason / geo_block / operator)→ 同步 J1 |
| 查看 caps / Queue / gate-stats / 风控仪表盘 | 全角色(按可见性裁剪) | 否(只读) | — |

> **swap 恢复(pause→resume)不在本表**:恢复属放大流出方向,V1 经 A3 kill-switch config store 执行(A3-MD3:仅超管 + B1 红线预检),V4 归 J1 矩阵;G2 仅作生效面(章首贯穿事实 ④)。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改三阈值 caps | ② caps 配置面三阈值卡「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染;swap 已 pause 时置灰 | 打开弹窗 G2-MD1 |
| 改费率(`EXCHANGE_FEE_PCT` / `EXCHANGE_FEE_MIN_USD`) | ② caps 配置面费率卡「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 G2-MD2 |
| 切 Queue 启用 / 处理次日队列 | ② Queue 视图顶部开关 / 队列工具栏「处理今日批次」 | 开关 / 次按钮 | 仅运营(lead)/ 超管可操作;队列为空时「处理」置灰 | 打开弹窗 G2-MD3 |
| swap 全局 pause | ② caps 配置面「全局暂停」 | 警示按钮 | 仅风控(lead)/ 超管渲染;仅未 pause 态显示 | 打开弹窗 G2-MD4 |
| 查看 Queue / gate-stats / 仪表盘 | ② Queue 视图 / Gate 决策监控 / 风控仪表盘 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [G2-MD1] 兑换三阈值变更
- **功能**:修改 `USER_DAILY_CAP_USD / PLATFORM_DAILY_CAP_USD / KYC_LIFETIME_THRESHOLD_USD` 任一,确认即实时生效(当日额度判定即用新值)。
- **布局结构**:1. **信息区**:三阈值当前值 / 当前实时占用(用户侧分布 / 平台日池占用 %)/ 最近一次 caps 变更记录(引自审计)。2. **影响预览区**:before→after 并排;放宽方向(升 USER/PLATFORM cap)时 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);收紧方向提示「当日已超新 cap 的在途单不追溯,按提交时额度判定」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 `USER_DAILY_CAP_USD` | 数字输入(USD) | 改该项时必填 | 0–10,000(③ 表) | 当前值 |
| 目标 `PLATFORM_DAILY_CAP_USD` | 数字输入(USD) | 改该项时必填 | 0–10,000,000(③ 表) | 当前值 |
| 目标 `KYC_LIFETIME_THRESHOLD_USD` | 数字输入(USD) | 改该项时必填 | 0–100,000(③ 表) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(主按钮;必填未过校验 / 放宽方向预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(超出 ③ 表范围,server 返回合法区间)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403(执行权不符)。
- **成功反馈**:弹窗关闭;caps 卡就地更新;toast「三阈值已生效 · 已记审计」;事件 `admin.exchange_caps_changed`;实时告警超管 + 财务 lead。

##### [G2-MD2] 兑换费率变更
- **功能**:修改 `EXCHANGE_FEE_PCT` / `EXCHANGE_FEE_MIN_USD`,确认即生效(仅新单,在途按提交时锁定费率)。
- **布局结构**:1. **信息区**:当前费率 / 最低单笔手续费 / 24h 兑换量(server 派生,估算费收影响)/ 30%/70% 收入分配口径提示(③ 收入分配注)。2. **影响预览区**:before→after 并排;降费率方向 server 预检「**拟生效后覆盖率**」+ 红线警示(低于红线确认钮置灰);升费率提示「仅新单生效,UI `feeLabel` 同步」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 `EXCHANGE_FEE_PCT` | 数字输入(%) | 改该项时必填 | 0%–10%(③ 表) | 当前值 |
| 目标 `EXCHANGE_FEE_MIN_USD` | 数字输入(USD) | 改该项时必填 | 0–5(③ 表) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(降费率预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;费率卡就地更新;toast「费率已生效(仅新单) · 已记审计」;事件 `admin.exchange_fee_changed`;实时告警超管 + 财务 lead。

##### [G2-MD3] Queue 配置与次日队列处理
- **功能**:切换 Queue 启用(超 cap 排队 vs 直接拒绝)或触发处理当日待处理队列批次,确认即生效。
- **布局结构**:1. **信息区**:当前 Queue 启用态 / 队列深度(待处理单数 + 金额合计,server 派生)。2. **影响预览区**:关闭 Queue 时提示「在队单按既有排队继续处理,仅新超 cap 单改为直接拒绝」;处理批次时展示本批单数 + 金额合计。3. **输入区**:操作类型单选(切换启用态 / 处理今日批次)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认执行(处理批次提交 loading 锁定,携 `Idempotency-Key`(batchDate 维度去重))。
- **错误态**:400 `REASON_REQUIRED` / 409(队列已被并发处理 / 配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;Queue 视图就地更新;toast「Queue 配置已生效 / 批次已处理 · 已记审计」;事件 `admin.exchange_queue_config_changed`;实时告警超管 + 运营 lead。

##### [G2-MD4] swap 全局暂停
- **功能**:swap 全局 pause(对齐 §9.11d.1),止血方向,确认即 server enforce(停所有兑换),可随单提交 `geo_block`。
- **布局结构**:1. **信息区**:当前 swap 状态 / 24h 兑换量 / 当前 Queue 深度(暂停后队列冻结)/ 最近一次 pause 变更记录(引自审计)。2. **影响预览区**:警示条「暂停后兑换 endpoint 全局拒绝,在队单冻结;即时生效并同步 J1 矩阵 + B5 风险雷达」。3. **输入区**:`geo_block` 国家多选(可选,ISO 国家码)+ reason(多行文本,必填,8–200 字)+ 触发依据单选(监管点名 / 兑付风险 / 安全事件 / 其他)。4. **按钮区**:取消 / 确认暂停(警示色;提交 loading 锁定,携 `Idempotency-Key`)。
- **错误态**:400 `REASON_REQUIRED` / 409(已为 pause 态,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;swap 状态灯变红;toast「已暂停 · 已记审计」;事件 `admin.exchange_paused`;实时告警超管 + 风控 lead;同步 J1 矩阵 + B5 风险雷达。恢复经 A3-MD3(仅超管 + B1 红线预检)。

**⑤ 接口**(收敛 §9.11c.1 / §9.11d.1):
- `GET /api/config/exchange/caps` — 三阈值 + Queue 配置 + 费率配置;**server-canonical**,前端 §9.4.1 swap UI(`feeLabel/feeFree`)+ §9.4.2 gate 判定读此。
- `GET /api/admin/exchange/queue?cursor=` — 次日队列监控(server 权威待处理单)。
- `GET /api/admin/exchange/gate-stats?window=` — 三类拦截命中统计(喂仪表盘)。
- `PUT /api/admin/exchange/caps` — 改三阈值 + Queue 配置(经确认弹窗 G2-MD1 / G2-MD3,reason 必填(空值 400 `REASON_REQUIRED`);**放宽 server 先核 B1,< 红线返 422**)。
- `PUT /api/admin/exchange/fee` — 改 `EXCHANGE_FEE_PCT` / `EXCHANGE_FEE_MIN_USD`(经确认弹窗 G2-MD2,reason 必填;**降费率 server 先核 B1,< 红线返 422**;仅新单生效)。
- `POST /api/admin/exchange/pause` — swap 全局 pause(对齐 §9.11d.1;经确认弹窗 G2-MD4,reason 必填;payload `geo_block: string[]`;携 `Idempotency-Key`)。

**⑥ 权限 & 审计**:
| 角色 | 查看 caps/queue | 改 caps / 费率 | Queue 配置/处理队列 | swap pause |
|---|---|---|---|---|
| 风控/合规 | ✅ | — | — | ✅(lead) |
| 运营 | ✅ | — | ✅(lead) | — |
| 财务 | ✅ | ✅(lead) | — | — |
| 超管 | ✅ | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — | — |

> **执行权说明(2026-06 操作确认决议)**:caps 放宽与降费率均为放大流出方向,按原复核层级就高为执行门槛(财务(lead)/ 超管 + B1 红线预检);费率与 caps 同归财务(lead)执行但审计事件分立(费率是经营杠杆而非风控阈值);swap pause 为止血方向,风控(lead)/ 超管。

审计字段(A2):`action / field / before / after / coverageAtSubmit / reason / geo_block / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:gate 决策(三类拦截)server 权威;`useWalletPairing.walletPaired` 客户端可篡改,KYC 触发线命中后真值在 server `GET /api/kyc/status`,兑换 endpoint 二次 enforce(client 跳过无效)。
- **跨模块联动**:`KYC_LIFETIME_THRESHOLD` 命中 → **K5 KYC 复审**(累计兑换 KYC 阈值**分阶段归属**:**V1 阶段权威在 K5(C4 / G2 只读引用),V3 G2 落地后移交 G2**——§3.14:`K5(V1)/ G2(V3)`;C4 消费 / 兑换日 cap 三阈值另归 G2;V1 K5 §⑦ 已声明「兑换触发阈值由 G2 配置」);`exchange.swapped` → D4 swap bill + 影响 D3 资金池(NEX→USDT 减 USDT 储备)。
- **手续费分配联动 G3/D1**:`EXCHANGE_FEE_PCT > 0` 时,每笔 `exchange.swapped` 的手续费按 **30% 进 G3 NEX 回购销毁池**(对应 G3⑦ 周曲线排程器回购销毁量)/ **70% 进 D1 `fee_buffer` 备付金**(D1③ Card 渠道同一备付金池累积口径);费率/分配比例改动经 `admin.exchange_fee_changed` 审计,喂 L3 财务报表的「手续费收入分解」面与 B1 备付金/回购口径敏感性分析。
- **B1 前置(① 跨域事实)**:放宽 caps 提交即 server 核验覆盖率红线。
- **篡改防御(§9.11d.2)**:client 不得本地绕过 cap / gate;排队取消由 server 处置,client 仅订阅 Queue 态。
- **geo_block 状态机落点 + in-flight 处置(对齐章首贯穿事实 ⑧)**:geo_block 命中**归 `gated`(子类 `geo-blocked`)**,不另立终态;**新增 geo_block 国家对该国已在 `queue` 的兑换单按章首贯穿事实 ⑧「锁定优先」原则转 `cancelled`**(不继续排队成交),client 仅订阅终态变更,本金不被单方面锁定(对齐「funds never locked unilaterally」叙事)。
- **kill 联动 J1(V4)**:swap pause + geo_block 是 J1 矩阵生效面。

**⑧ 埋点(事件)**:
- **消费**:`exchange.swapped`(§2.4.5 ③ money,`is_server_authoritative=true`;G2 仪表盘 + Queue 监控消费)。
- **产生(admin 审计)**:`admin.exchange_caps_changed` · `admin.exchange_fee_changed` · `admin.exchange_queue_config_changed` · `admin.exchange_paused`(A2 审计,登记 A4 schema registry)。
- **domain 状态**:`exchange` 已在 §2.4.3 枚举内,无需扩展。
- **喂给**:`exchange.swapped` → D4 账本 / D3 资金池 / K5 复审(累计阈值)/ B3 漏斗;gate-stats → G2 风控仪表盘;caps 审计 → B1 覆盖率影响评估 + J1(V4)。

---

#### [G3] NEX 周曲线关键帧排程器
**① 目的 & 对齐**: 配置 $NEX 代币的**周价格曲线关键帧排程器** —— 由原「手动设单一现价值」升级为「配置一周(7 天)价格关键帧曲线,server cron 每日 00:00 UTC 自动推进到下一帧并更新全站现价」,作为「代币经济」的定价基础设施。对齐前端 **§5.7**(`$NEX` 代币行情:price / 价格曲线 / oracle)+ **§11.9**(`/market` 行情详情页)+ **§9.11c.1**(NEX 市场参数 + 价格曲线接口)。服务业务目标:维持 NEX/USDT 行情的可信展示(锚定「主流 AI/DePIN 赛道」+ 交易所审核预期),驱动用户买入 NEX,支撑代币经济流入。**G3 NEX 现价仍是 G2 兑换与 G7 复投的唯一定价源(下游引用 G3 现价单源 `G.market.price`)**。

> **中性语言铁律**:本子模块全程描述为「周价格曲线 / 关键帧 / 排程推进 / 做市 / 预言机喂价」。前端 §9.11c.1 内部代码常量名含 `pump`(`isPump` 价格上行概率曲线)属实现命名,后台 PRD **一律转述为「价格上行概率 / 做市波动幅度」**,严禁价格操纵类编辑性措辞。

**② 后台界面**:
- **7 日关键帧表(排程核心)**:一周 7 天逐日关键帧,每日一行 `目标价 / 上行概率 / 波动`;server cron 每日 00:00 UTC 推进到下一日关键帧、把当日目标价写入现价单源。
- **排程控制面**:`schedule(自动按日推进)/ pin(钉住某一日帧、暂停推进)/ loop(跑完一周后循环重跑或停在末值)`;当前所在帧(运营日序)+ 下一帧推进倒计时 + 已推进进度。
- **手动 override 层(应急)**:应急直写现价(绕过曲线即时设值)/ 切喂价源 / 暂停排程;override 为非常态应急通道,与关键帧排程并存。
- **现价与监控**:实时现价大数 + 24h sparkline + 近 N 小时 kline + ATH 行(对齐 §11.9 `$0.184` ATH 损失感展示的运营内部口径)。
- **喂价源状态**:oracle 源健康灯 + 最近喂价时间戳 + 偏离告警(现价与喂价源偏离阈值)。
- **状态机**:无用户对象状态机(行情为连续值);排程运行态 `scheduled(自动推进)/ pinned(钉某帧停推进)/ paused(暂停·现价冻结于最后值)`。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| 基准锚现价(`G.market.price` 现状) | **现状值(§5.7 / §11.9)**:$0.171 | > 0 | 排程推进 / override 写入(单源) | Home `$NEX` ticker / `/market` Hero / §9.4 兑换汇率 / G7 复投定价 |
| 周关键帧集(7 日 × `目标价 / 上行概率 / 波动`) | **净新配置对象**(原手动单值升级而来;初始可由基准锚现状 $0.171 与现状曲线参数填充) | 每帧:目标价 > 0 / 上行概率 0–1 / 波动 0–±20% | 每日 00:00 UTC cron 推进当日帧、写现价 | `/market` kline 走势 / Home sparkline / 现价单源 |
| 价格上行概率(`isPump`,逐帧) | **现状值(§9.11d.3 / §9.11c.1)**:0.08 | 0–1 | 当日帧推进生效 | `/market` kline 走势 / Home sparkline |
| 做市波动幅度(±,逐帧) | **现状值(§9.11d.3)**:±3% | 0–±20% | 当日帧推进生效 | kline 单 tick 幅度 |
| 排程模式 | `schedule`(自动按日推进) | 枚举 `{ schedule, pin(钉某帧), loop(循环 / 停末值) }` | 实时(改即生效) | 现价是否随排程推进 |
| 喂价源(oracle source) | `ORACLE_INTERNAL_MM`(server 内部做市源;现状 `useMarket` store 派生) | 枚举常量 `{ ORACLE_INTERNAL_MM, ORACLE_EXTERNAL_FEED }` | 实时(切源即换喂价;外部源喂价频率默认 1 tick/4s,与内部做市同频) | 全站 NEX 价格(ticker / market / exchange) |
| 喂价偏离告警阈值(`oracleDeviationPct`) | 5%(现价与喂价源偏离超此即告警,② 偏离告警用) | 0–50% | 实时(下一比对周期生效) | 无前端展示(运营内部 oracle 健康面 + `nex.oracle_deviation_flagged` 事件) |
| 排程 paused | 否(running) | bool | 实时(paused 冻结现价 + 停推进) | 价格展示是否更新 |

> **默认值口径**:周关键帧曲线为**净新配置对象**(由「手动设单值」升级);12 月节奏表 §6 未覆盖 NEX 价格曲线,基准锚现价 / 逐帧曲线参数取前端现状值(标注「现状值」)。**改目标价 / 上行概率 = 放大 NEX→USDT 兑换的等值流出潜力**(目标价越高,同量 NEX 兑出 USDT 越多),故改关键帧曲线受 ① B1 红线前置约束 + 操作确认(确认弹窗 + 理由必填);**红线以「周峰值价」重估全部 NEX 计价负债**(取 7 日关键帧中目标价峰值作分母重估,避免某日帧拉高时窗口性跌破红线)。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改周关键帧曲线(目标价 / 上行概率 / 波动) | 财务(lead)/ 超管(2026-06 操作确认决议,放大方向原复核层级就高为执行门槛) | G3-MD1(理由必填+B1 红线预检(以周峰值价重估)) | `admin.nex_price_curve_changed`(字段 / 前后值 / coverageAtSubmit(周峰值价口径)/ 原因 / operator) |
| 改排程控制(schedule / pin / loop) | 财务(lead)/ 超管 | G3-MD2(理由必填) | `admin.market_schedule_changed`(模式前后值 / pin 帧 / operator) |
| 切喂价源(oracle)† | 仅超管(原复核=超管,就高;基础设施操作) | G3-MD3(理由必填) | `admin.nex_oracle_source_changed`(前后源 / operator) |
| 应急直写现价 override(放大方向) | 仅超管 | G3-MD4(理由必填+B1 红线预检) | `admin.nex_price_overridden`(前后价 / coverageAtSubmit / operator) |
| 暂停排程(止血) | 风控(lead)/ 超管 | G3-MD5(理由必填) | `admin.market_paused` |
| 恢复排程(放大方向) | 仅超管 | G3-MD6(理由必填+B1 红线预检) | `admin.market_resumed` |
| 查看曲线 / 排程 / 喂价源状态 | 全角色(按可见性裁剪) | 否(只读) | — |

> † 「技术」不在 V1 §1.1 七角色枚举内;**§2.1 RBAC 落地前 oracle 切换默认由 `超级管理员`(基础设施总闸)代理执行,不单独开 `tech` 账号**(§2.1 落地后再细分,详见 ⑥ 后「技术」角色映射注)。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改周关键帧曲线 | ② 7 日关键帧表行内「编辑帧」 | 行内按钮 | 仅财务(lead)/ 超管渲染;paused 时可编辑(恢复后生效) | 打开弹窗 G3-MD1 |
| 改排程控制(schedule / pin / loop) | ② 排程控制面「切换模式 / 钉帧」 | 次按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 G3-MD2 |
| 切喂价源(oracle) | ② 喂价源状态面「切换喂价源」 | 次按钮 | 仅超管渲染 | 打开弹窗 G3-MD3 |
| 应急直写现价 override | ② 手动 override 层「应急直写现价」 | 警示次按钮 | 仅超管渲染 | 打开弹窗 G3-MD4 |
| 暂停排程 | ② 排程控制面「暂停排程」 | 警示按钮 | 仅风控(lead)/ 超管渲染;仅非 paused 态显示 | 打开弹窗 G3-MD5 |
| 恢复排程 | ② 排程控制面「恢复排程」 | 次按钮 | 仅超管渲染;仅 paused 态显示 | 打开弹窗 G3-MD6 |
| 查看曲线 / 排程 / 喂价源状态 | ② 关键帧表 / 排程 / 喂价源状态 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [G3-MD1] 周关键帧曲线变更
- **功能**:修改 7 日关键帧的目标价 / 价格上行概率 / 做市波动幅度,确认即写入曲线,server cron 于对应日 00:00 UTC 推进时生效。
- **布局结构**:1. **信息区**:当前周曲线 7 帧(目标价 / 上行概率 / 波动)/ 当前所在帧 / 实时现价大数(② 同源)。2. **影响预览区**:before→after 逐帧并排;改目标价 / 上行概率(放大方向)时 server 预检「**拟生效后覆盖率(以周峰值价重估)**」(取改后 7 帧目标价峰值,重算含在锁 NEX 本金的全量 NEX 计价应付负债后判红线,章首贯穿事实 ① 重估口径),低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);并展示「NEX 计价负债按周峰值价重估后等值变化」摘要行。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 逐帧目标价(7 帧) | 数字输入组(USD) | 改某帧时必填 | > 0(③ 表) | 当前帧值 |
| 逐帧上行概率(7 帧) | 数字输入组(0–1) | 改某帧时必填 | 0–1(③ 表) | 当前帧值 |
| 逐帧波动幅度(7 帧) | 数字输入组(±%) | 改某帧时必填 | 0–±20%(③ 表) | 当前帧值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(放大方向预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(超出 ③ 表范围)/ 400 `REASON_REQUIRED` / 409(曲线已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;关键帧表 + 现价大数就地更新;toast「周曲线已生效 · 已记审计」;事件 `admin.nex_price_curve_changed`;实时告警超管 + 财务 lead。

##### [G3-MD2] 排程控制变更
- **功能**:在 `schedule(自动推进)` / `pin(钉住某一日帧)` / `loop(跑完循环或停末值)` 间切换排程模式,确认即生效。
- **布局结构**:1. **信息区**:当前模式 / 当前所在帧 / 下一帧推进倒计时(② 排程控制同源)。2. **影响预览区**:前后模式并排;pin 钉住时提示「现价冻结于该帧目标价、停止每日推进直至切回 schedule」;loop 提示「跑完一周后是否循环重跑或停在末帧」。3. **输入区**:目标模式单选(③ 表枚举)+ pin 时选目标帧(下拉日 1–7)+ loop 时选循环 / 停末值 + reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:400 `REASON_REQUIRED` / 409(排程已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;排程控制面就地更新;toast「排程已变更 · 已记审计」;事件 `admin.market_schedule_changed`;实时告警超管 + 财务 lead。

##### [G3-MD3] 喂价源切换
- **功能**:在 `ORACLE_INTERNAL_MM` / `ORACLE_EXTERNAL_FEED` 间切换喂价源,确认即换源(实时)。
- **布局结构**:1. **信息区**:当前源 / 源健康灯 / 最近喂价时间戳 / 当前偏离值(② 喂价源状态同源)。2. **影响预览区**:前后源并排;偏离值超告警阈值时提示行「切源瞬间现价可能跳变,下游 G2 兑换 / G7 复投定价即时随动」。3. **输入区**:目标源单选(枚举,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认切换。
- **错误态**:400 `REASON_REQUIRED` / 409(源已被他人切换,提示刷新)/ 403(非超管)。
- **成功反馈**:弹窗关闭;喂价源状态面就地更新;toast「喂价源已切换 · 已记审计」;事件 `admin.nex_oracle_source_changed`;实时告警全体超管。

##### [G3-MD4] 应急直写现价 override
- **功能**:绕过周曲线即时直写现价(应急通道),放大方向,仅超管,前置 B1 红线核验,确认即写入现价单源。
- **布局结构**:1. **信息区**:当前现价 / 当前所在帧目标价 / 实时现价大数。2. **影响预览区**:before→after 现价并排;**拉升现价方向** server 预检「拟生效后覆盖率」(以拟写入价重估全量 NEX 计价负债),低于红线阻断提示(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);提示「override 即时改全站现价,下游 G2 兑换 / G7 复投定价随动;不改周曲线本身,下次 cron 推进仍按曲线」。3. **输入区**:目标现价(数字输入 USD,> 0)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认直写(警示色)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403(非超管)。
- **成功反馈**:弹窗关闭;现价大数就地更新;toast「现价已直写 · 已记审计」;事件 `admin.nex_price_overridden`;实时告警全体超管。

##### [G3-MD5] 排程暂停
- **功能**:暂停排程(→paused,现价冻结于最后值 + 停每日推进),止血方向,确认即生效。
- **布局结构**:1. **信息区**:当前排程态 / 现价 / 24h 兑换量(暂停冻结下游定价的影响参考)。2. **影响预览区**:警示条「暂停后全站 NEX 价格冻结、停止每日推进,G2 兑换 / G7 复投按冻结价计价;即时生效并同步 J1 矩阵」。3. **输入区**:reason(多行文本,必填,8–200 字)+ 触发依据单选(监管点名 / 价格异常 / 安全事件 / 其他)。4. **按钮区**:取消 / 确认暂停(警示色)。
- **错误态**:400 `REASON_REQUIRED` / 409(已为 paused,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;排程状态灯变 paused;toast「排程已暂停 · 已记审计」;事件 `admin.market_paused`;实时告警超管 + 风控 lead;同步 J1 矩阵。

##### [G3-MD6] 排程恢复
- **功能**:恢复排程(paused→scheduled),放大方向(价格恢复推进 = 流出潜力恢复),仅超管,前置 B1 红线核验,确认即生效。
- **布局结构**:1. **信息区**:排程暂停时间 / 暂停理由(引自审计)/ 冻结现价。2. **影响预览区**:server 预检「恢复后兑付覆盖率」(按当前周曲线峰值价与冻结价重估);低于红线阻断提示(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」)。3. **输入区**:reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认恢复。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 400 `REASON_REQUIRED` / 409 / 403(非超管)。
- **成功反馈**:弹窗关闭;排程状态灯变 scheduled;toast「排程已恢复 · 已记审计」;事件 `admin.market_resumed`;实时告警全体超管。

**⑤ 接口**(收敛 §9.11c.1):
- `GET /api/config/market/nex` / WebSocket `/api/market/nex` — NEX 现价 + 实时 price feed;**server-canonical**(§9.11d.3:价格曲线必须 server-driven,client `useMarket` 仅 UI cache)。
- `GET /api/admin/market/curve` — 读取 7 日关键帧曲线 + 当前排程态 + 当前所在帧。
- `PUT /api/admin/market/curve` — 改周关键帧曲线 / 排程控制(经确认弹窗 G3-MD1 / G3-MD2,reason 必填(空值 400 `REASON_REQUIRED`);**改目标价 / 上行概率 server 先核 B1〔以周峰值价重估〕,< 红线返 422**)。
- `POST /api/admin/market/advance` — cron 推进当日关键帧、写现价单源 `G.market.price`(server 内部每日 00:00 UTC 触发,非前端;携 `Idempotency-Key` 按运营日去重防重复推进)。
- `PUT /api/admin/market/override` — 应急直写现价(经确认弹窗 G3-MD4,reason 必填,仅超管;**拉升现价 server 先核 B1,< 红线返 422**;携 `Idempotency-Key`)。
- `PUT /api/admin/market/nex/oracle` — 切喂价源(经确认弹窗 G3-MD3,reason 必填;仅超管)。
- `POST /api/admin/market/{pause|resume}` — 暂停 / 恢复排程(经确认弹窗 G3-MD5 / G3-MD6,reason 必填;**resume 仅超管 + server 先核 B1,< 红线返 422**;携 `Idempotency-Key`)。

**⑥ 权限 & 审计**:
| 角色 | 查看曲线/排程 | 改曲线/排程 | 切 oracle | override 直写 | 暂停排程 | 恢复排程 |
|---|---|---|---|---|---|---|
| 运营 | ✅ | — | — | — | — | — |
| 财务 | ✅ | ✅(lead) | — | — | — | — |
| 风控/合规 | ✅ | — | — | — | ✅(lead) | — |
| 超管 | ✅ | ✅ | ✅(代理「技术†」) | ✅(仅超管) | ✅ | ✅(仅超管) |
| 客服 / 只读审计 | ✅(只读) | — | — | — | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):改曲线 / 排程为放大方向,原复核层级就高为执行门槛(财务(lead)/ 超管 + B1 红线预检〔以周峰值价重估〕);oracle 切换 / override 直写 / 排程恢复原复核 = 超管,就高为仅超管(override 与恢复另带 B1 预检);暂停 = 止血方向,风控(lead)/ 超管。

审计字段(A2):`action / field / before / after / coverageAtSubmit(改曲线/override 时,周峰值价口径) / scheduleModeBefore / scheduleModeAfter / oracleBefore / oracleAfter / reason / operator / ts`。

> **「技术」角色 §1.1 映射(单一默认值 + 待 §2.1 细分)**:本表 oracle 切换的执行角色「技术†」**不在 V1 §1.1 七角色**(超级管理员/财务/风控/增长/内容/客服/只读审计)枚举内,亦不在 §A.2 row6 待映射旧命名清单。oracle / 喂价源切换为基础设施操作,**§2.1 RBAC 落地前默认由 `超级管理员`(基础设施总闸)代理执行(单一可实现默认值,不再二选一,不单独开 `tech` 账号)**;**§2.1 RBAC(后续批次)落地后再细分**——若正式新增 `tech` 角色则迁移,否则保持超管代理(体例同 V1 K5 §⑦ 对非枚举角色的处理:工作命名先行 + V4 统一映射 §1.1)。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.3)**:NEX price + 周关键帧推进 100% server-driven;`lib/v3/market.ts` 的 client 价格 tick 仅 UI 渲染,真值在 server price feed 与 cron 推进;client 篡改 `useMarket` 不影响兑换 / 复投定价(server 重算)。cron 每日 00:00 UTC 推进当日帧、写现价单源 `G.market.price`。
- **下游定价联动**:**G3 现价是 G2 兑换报价(§9.4 汇率)与 G7 复投定价的单一源**;G2/G7 server 端计价一律取 G3 server 现价,不接受 client 传入价。NEX 现价变动即时影响 B1 应付负债折算(NEX 计价负债部分)。
- **B1 前置(① 跨域事实;以周峰值价重估)**:改目标价 / 上行概率 / override 直写提交即 server 核验覆盖率红线;该前置检查须**以「周关键帧目标价峰值」重算含在锁 NEX 本金的全量 NEX 计价应付负债后再判红线**——口径权威见章首贯穿事实 ① 的「NEX 计价负债重估口径」子句(Ch4 B1 §③),本处单向引用、以周峰值价为分母口径,不重复定义。
- **kill 联动 J1(V4)**:排程 pause 是 J1 矩阵生效面(监管点名代币定价时全局冻结)。

**⑧ 埋点(事件)**:
- **产生(行情 server)**:`market.curve_advanced`(cron 每日推进当日关键帧,`is_server_authoritative=true`;属性:`operatingDay / framePrice / source / ts`)· `nex.price_updated`(server 写现价 tick 关键节点,`is_server_authoritative=true`;属性:`price / change24h / source / ts`)· `nex.oracle_deviation_flagged`(喂价偏离阈值)。
- **产生(admin 审计)**:`admin.nex_price_curve_changed` · `admin.market_schedule_changed` · `admin.nex_oracle_source_changed` · `admin.nex_price_overridden` · `admin.market_paused/resumed`(A2 审计)。
- **domain 状态(blocking)**:`nex` / `market` **不在** §2.4.3 domain 枚举内 → **须向 A4 申请 domain 枚举扩展(§2.4.3),blocking 依赖,登记为 V3 起始工单**(体例参 V2 E4 `order` domain)。在 A4 扩展落地前,G3 行情 / 排程事件暂记 `admin` family 占位,扩展后迁回 `nex.*` / `market.*`。
- **喂给**:`nex.price_updated` / `market.curve_advanced` → G2 兑换定价 / G7 复投定价 / B1 NEX 计价负债折算 / L 域行情 BI;curve 审计 → B1 覆盖率影响评估 + J1(V4)。

---

#### [G4] Genesis 经济
**① 目的 & 对齐**: 配置 Genesis 创世节点的经济参数 —— 节点总量 / 一级单价 / 每日分红率 / 二级版税 / 一二级市场 pause / geo 地域限制,作为「代币经济」最高客单价产品(节点 NFT + 永续分红)的运营面。对齐前端 **§10**(`/genesis` 一二级市场 / 每日分红 / pause / geo)+ **§9.11d.1**(Genesis 全局 pause + geo_block)。服务业务目标:用 $9,999 高客单 + 永续分红叙事沉淀大额资金,支撑 **§18.2「Genesis 售罄速度 < 14 天」KPI**(§18.2 八项闭集中 Genesis 直接对应项);同时分红率是应付负债精算的关键输入。

> **✅ 每日分红率已裁定 = 0.1%/日(PM 2026-06-01;V1 附录 §A.1 row5 + §1.7)**:前端原存在自相矛盾(差异 15×)——
> - **§10.1.1**(一级预售规则):`全网每日交易 0.1% 池子均分`,单张日产约 **$1.50**;
> - **§10.1.3**(how-it-works §2):`0.1%`,但举例 `当前约 $24/day`;
> - **§10.3.3**(持有人 Dashboard 业务规则):`dailyDividendPerNode = platformDailyVolumeUSD × 1.5% / 1000`,HOLDER PERKS 文案写 `💎 1.5% 平台分润`。
>
> **裁定结论(PM 2026-06-01,V1 §A.1 row5 权威记录)**:**§10.1 的 0.1% 为权威值**;前端 §10.3 = 1.5% 为**笔误**,V4 上报前端订正为 0.1%(§10.1.3 的 $24/day 同属前端示例口径误差,随 V4 订正)。Genesis 日分红应付负债按 **`节点价 × 持有量 × 0.1%/日`** 精算(Ch4 B2 负债科目 4「Genesis 日分红承诺」),**D3 应付负债精算据此落地,不再阻塞**。③ 参数表 `dailyDividendShare` 默认值即 **0.1%/日**(§10.1.1 权威),仍受 B1 红线前置约束。

**② 后台界面**:
- **节点经济配置面**:`TOTAL_SLOTS / unitPriceUSDT / dailyDividendShare(0.1%/日,已裁定)/ 二级版税% / 一级售出进度 / 已铸造量`。
- **一二级市场监控**:一级售出 ticker(对齐 §10.1)+ 二级市场 stats(floor / 24h vol / listed / owners,对齐 §10.2.1,SSE 实时)。
- **分红派发监控**:日分红应付池 + 每日 00:00 UTC 派发批次(喂 B2 负债 / D4 bill)。
- **geo / pause 面**:一二级市场全局 pause 开关 + `geo_block` 国家清单(边缘 IP 判定)。
- **ownership 视图**(只读,server-canonical):`tokenId / 持有者(脱敏)/ 来源(一级 / 二级)/ lifetime 分红`;二级转让时分红跟随 NFT(§10.2「dividends move with the NFT」)。
- **状态机**(节点,server-canonical):`minted(一级售出 / 铸造)→ held(持有计分红)`;旁路:`held → listed(二级挂单)→ sold(二级成交·扣 2.5% 版税·分红跟随新持有者)`。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| `TOTAL_SLOTS`(节点总量) | **现状值(§10.1.1 / §13.3)**:1,000 | ≥ 已铸造量(不可低于已售) | 仅未来供应(已售不变) | `/genesis` 售出进度 `847/1,000` |
| `unitPriceUSDT`(一级单价) | **现状值(§10.1.1 / §13.3)**:$9,999 | > 0 | 仅新一级购买(在途锁价) | `/genesis` Hero 单价 + Reserve CTA |
| `dailyDividendShare`(每日分红率) | **✅ 0.1%/日**(§10.1.1 权威,PM 2026-06-01 裁定;§10.3=1.5% 为前端笔误待 V4 订正)。日分红应付 = `节点价 × 持有量 × 0.1%/日` | 0–可调,升率受 B1 约束 | 实时 | §10.1 日预估收益 / §10.3 holder dashboard 分红 |
| 二级版税(`royalty`) | **现状值(§10.2.3 / §13.3)**:2.5%(卖家成交扣) | 0–20% | 仅新二级成交 | §10.2 挂单 confirm「扣 2.5% 版税」 |
| 一二级市场 pause(kill) | 关 | bool | 实时(熔断停一二级 + 分红保留 / 暂停按 J1 处置) | §10 市场熔断态(§9.11d.1) |
| `geo_block`(地域限制) | 空 | 国家码数组 | 实时(边缘 IP 判定) | §10 marketplace geo 拦截 |

> **默认值口径**:总量 / 单价 / 版税取前端现状值(标注「现状值」);**分红率已裁定 = 0.1%/日**(PM 2026-06-01,§10.1.1 权威;③ 已标注,前端 §10.3=1.5% 笔误待 V4 订正)。升分红率 = 放大 USDT 流出,受 ① B1 红线前置约束。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改总量 / 单价 / 版税 | 财务(lead)/ 超管(2026-06 操作确认决议,原复核层级就高为执行门槛) | G4-MD1(理由必填) | `admin.genesis_economics_changed`(字段 / 前后值 / 原因 / operator) |
| 改每日分红率（基准 0.1%/日） | 仅超管(原复核=超管,就高;放大方向) | G4-MD2(理由必填+B1 红线预检(升率方向);偏离 0.1% 权威基准须附 PM 决议 ref) | `admin.genesis_dividend_rate_changed`(前后值 / coverageAtSubmit / pmRulingRef / operator) |
| 一二级市场 pause(kill) | 风控(lead)/ 超管(止血方向) | G4-MD3(理由必填;分红处置方案随单提交) | `admin.genesis_paused`(geo_block / 分红处置 / operator)→ 同步 J1 |
| 设 / 改 geo_block | 风控 / 合规(lead)/ 超管(收紧方向,体例同 A3-MD4) | G4-MD4(理由必填) | `admin.genesis_geo_changed`(国家清单 / operator) |
| 查看经济配置 / ownership / 分红派发监控 | 全角色(按可见性裁剪) | 否(只读) | — |

> **Genesis 恢复(pause→resume)不在本表**:恢复属放大流出方向,V1 经 A3 kill-switch config store 执行(A3-MD3:仅超管 + B1 红线预检),V4 归 J1 矩阵;G4 仅作生效面(章首贯穿事实 ④)。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改总量 / 单价 / 版税 | ② 节点经济配置面参数卡「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染;市场已 pause 时可编辑(恢复后生效) | 打开弹窗 G4-MD1 |
| 改每日分红率 | ② 节点经济配置面分红率卡「编辑」 | 行内按钮 | 仅超管渲染 | 打开弹窗 G4-MD2 |
| 一二级市场 pause | ② geo / pause 面「全局暂停」 | 警示按钮 | 仅风控(lead)/ 超管渲染;仅未 pause 态显示 | 打开弹窗 G4-MD3 |
| 设 / 改 geo_block | ② geo / pause 面「编辑国家列表」 | 行内按钮 | 仅风控 / 合规(lead)/ 超管渲染 | 打开弹窗 G4-MD4 |
| 查看 ownership / 分红派发监控 | ② ownership 视图 / 分红派发监控 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [G4-MD1] 节点经济参数变更
- **功能**:修改 `TOTAL_SLOTS` / `unitPriceUSDT` / 二级版税,确认即生效(总量仅未来供应,单价仅新一级购买,版税仅新二级成交)。
- **布局结构**:1. **信息区**:当前总量 / 已铸造量 / 一级售出进度 / 单价 / 版税。2. **影响预览区**:before→after 并排;`TOTAL_SLOTS` 低于已铸造量时内联阻断(server 422);降单价提示「在途一级单按锁定价结算,不追溯」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 `TOTAL_SLOTS` | 数字输入 | 改该项时必填 | ≥ 已铸造量(③ 表;违反 server 422) | 当前值 |
| 目标 `unitPriceUSDT` | 数字输入(USD) | 改该项时必填 | > 0(③ 表) | 当前值 |
| 目标二级版税 | 数字输入(%) | 改该项时必填 | 0–20%(③ 表) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(必填未过校验时置灰;提交 loading 锁定)。
- **错误态**:422(`TOTAL_SLOTS` 低于已铸造量 / 超出 ③ 表范围,server 返回合法区间)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;经济配置卡就地更新;toast「经济参数已生效 · 已记审计」;事件 `admin.genesis_economics_changed`;实时告警超管 + 财务 lead。

##### [G4-MD2] Genesis 每日分红率变更
- **功能**:修改 `dailyDividendShare`(权威基准 0.1%/日,PM 2026-06-01 裁定),确认即实时生效;仅超管。
- **布局结构**:1. **信息区**:当前分红率 / 当前持有量 / 日分红应付池(= 节点价 × 持有量 × 率,server 派生)/ 最近一次分红率变更记录(引自审计)。2. **影响预览区**:before→after 并排 + 「拟生效后日分红应付」对比;升率方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);偏离 0.1% 基准时提示行「偏离权威基准,须附 PM 决议 ref」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标分红率(%/日) | 数字输入 | 是 | ≥ 0;升率过 B1(③ 表) | 当前值(0.1) |
| PM 决议 ref | 文本输入(决议链接 / 编号) | 偏离 0.1% 基准时必填 | 非空;落审计 `pmRulingRef` | 空 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(升率预检低于红线 / 偏离基准未附 ref 时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 400 `REASON_REQUIRED` / 400(偏离基准缺 pmRulingRef)/ 409 / 403(非超管)。
- **成功反馈**:弹窗关闭;分红率卡就地更新;toast「分红率已生效 · 已记审计」;事件 `admin.genesis_dividend_rate_changed`;实时告警全体超管 + 财务 lead。

##### [G4-MD3] Genesis 一二级市场暂停
- **功能**:一二级市场 pause(对齐 §9.11d.1),止血方向,确认即 server enforce(停一级购买 + 二级挂单成交),分红处置方案随单提交。
- **布局结构**:1. **信息区**:当前市场状态 / 已售节点数 / 当日未结分红池 / 最近一次 pause 变更记录(引自审计)。2. **影响预览区**:警示条「暂停后一二级 endpoint 全局拒绝;当批未结分红按所选处置方案执行;即时生效并同步 J1 矩阵 + B5 风险雷达」。3. **输入区**:分红处置单选(`held` 保留继续计提 / 暂停计提按 J1 处置)+ `geo_block` 国家多选(可选)+ reason(多行文本,必填,8–200 字)+ 触发依据单选(监管点名 / 兑付风险 / 安全事件 / 其他)。4. **按钮区**:取消 / 确认暂停(警示色;携 `Idempotency-Key`)。
- **错误态**:400 `REASON_REQUIRED` / 409(已为 pause 态,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;市场状态灯变红;toast「已暂停 · 已记审计」;事件 `admin.genesis_paused`;实时告警超管 + 风控 lead;同步 J1 矩阵 + B5 风险雷达。恢复经 A3-MD3(仅超管 + B1 红线预检)。

##### [G4-MD4] Genesis geo_block 配置
- **功能**:编辑 Genesis 市场国家级屏蔽列表(增删国家码),确认即 server enforce(边缘 IP 判定)。
- **布局结构**:1. **信息区**:当前 `geo_block` 列表(国家码 chip 集)/ 最近变更记录(引自审计)。2. **影响预览区**:本次 diff(新增屏蔽 / 解除屏蔽两组 chip 并排);新增屏蔽国家展示该国当前持有人数(server 派生);解除屏蔽提示行「解除屏蔽将恢复该国用户访问(放大方向)」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 国家列表 | 多选搜索框(ISO 国家码) | 是 | 合法 ISO 码;与当前列表相同则确认钮置灰 | 当前列表 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **错误态**:400 `REASON_REQUIRED` / 409(列表已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;geo 面就地更新;toast「屏蔽列表已更新 · 已记审计」;事件 `admin.genesis_geo_changed`;实时告警超管 + 风控 lead。

**⑤ 接口**(收敛 §9.11c.1 / §9.11d.1):
- `GET /api/genesis/state` — 节点经济(TOTAL_SLOTS / unitPriceUSDT / dailyDividendShare);**server-canonical**,前端 §10.1 读此。
- SSE `/api/genesis/marketplace/stats` — 二级市场实时 stats(floor / vol / listed / owners,对齐 §10.2.1)。
- `GET /api/admin/genesis/ownership?cursor=` — ownership 视图(server 权威持有台账)。
- `PUT /api/admin/genesis/economics` — 改总量 / 单价 / 版税(经确认弹窗 G4-MD1,reason 必填(空值 400 `REASON_REQUIRED`))。
- `PUT /api/admin/genesis/dividend-rate` — 改分红率(基准 0.1%/日;经确认弹窗 G4-MD2,reason 必填,仅超管;**升率 server 先核 B1,< 红线返 422**)。
- `POST /api/admin/genesis/pause` — 一二级 pause(对齐 §9.11d.1;经确认弹窗 G4-MD3,reason 必填;payload `geo_block: string[]`;携 `Idempotency-Key`)。

**⑥ 权限 & 审计**:
| 角色 | 查看经济/ownership | 改总量/单价/版税 | 改分红率 | pause | geo_block |
|---|---|---|---|---|---|
| 运营 | ✅ | — | — | — | — |
| 财务 | ✅ | ✅(lead) | — | — | — |
| 风控/合规 | ✅ | — | — | ✅(lead) | ✅(lead) |
| 超管 | ✅ | ✅ | ✅(仅超管) | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):经济参数按原复核层级就高(财务(lead)/ 超管);分红率原复核 = 超管,就高为仅超管 + B1 红线预检(升率方向);pause / geo_block 为止血 / 收紧方向,风控(lead)/ 超管。

审计字段(A2):`action / field / before / after / coverageAtSubmit(改分红率时) / pmRulingRef(分红率裁定引用) / geo_block / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:Genesis ownership + 分红派发 + 二级成交 server 权威;前端 `useGenesis.ownedTokenIds` 仅展示真实购买序号,client 不得伪造持有 / 分红;§10.3 holder dashboard `myOwned === 0` 显示真实空状态。
- **负债联动(② 跨域事实)**:`genesis.purchased` 增 B2 应付负债科目 4「Genesis 日分红承诺」,**精算公式 = `节点价 × 持有量 × 0.1%/日`**(分红率已裁定 0.1%,§10.1.1;根因账本归 **D3,B2 为其驾驶舱概览卡同口径**,§3.14);日分红派发落 D4 bill。二级版税收入入网络金库(§10.2.3)。
- **B1 前置(① 跨域事实)**:升分红率提交即 server 核验覆盖率红线。
- **篡改防御(§9.11d.2)**:tokenId / 分红 server 单源,client 不可枚举 / 撞 ID;OpenSea 外链为站内 P2P 导流,无真实跨链写。
- **幂等 & 并发裁决(章首贯穿事实 ⑧;§9.11e)**:每日 00:00 UTC 日分红派发批次携 **`Idempotency-Key`**(batchDate 维度去重,retry / 重跑不重复派发);Genesis pause 后并发到达的当批未结分红按 ④ 分红处置方案处理(`held` 保留 / 暂停按 J1),pause 锁定优先于 in-flight 派发。
- **kill 联动 J1(V4)**:Genesis pause + geo_block 是 J1 矩阵生效面(证券类风险 / 国家级屏蔽)。

**⑧ 埋点(事件)**:
- **消费**:`genesis.purchased`(§2.4.5 ③ money,`is_server_authoritative=true`;G4 监控 + ownership 消费)。
- **产生(分红 server)**:`genesis.dividend_paid`(每日派发批次,`is_server_authoritative=true`;属性:`tokenId / amountUsdt / rateApplied / ts`)。
- **产生(admin 审计)**:`admin.genesis_economics_changed` · `admin.genesis_dividend_rate_changed` · `admin.genesis_paused` · `admin.genesis_geo_changed`(A2 审计)。
- **domain 状态**:`genesis` 已在 §2.4.3 枚举内,无需扩展(`genesis.dividend_paid` 为本域内新增 object_action,登记 A4 schema registry)。
- **喂给**:`genesis.purchased` / `genesis.dividend_paid` → B2 应付负债科目 4 / D3 资金池 / D4 账本 / B1 覆盖率;经济审计 → J1(V4)。
- **`commission.kind=genesis` 交叉引用归属(非前端 §10 杠杆)**:`commission.kind=genesis`(推荐人因下线买 Genesis 得佣金)**仅见 admin V2 F5 佣金域 + §3.14 归属**,**前端 §10 原型不含此链路**(§10 仅一级 $9,999 买断 / 二级 2.5% 版税 / 每日分红,无 Genesis 推荐佣金)。故 prototype lens 下不应将其当作前端既有杠杆;计提权威归 **V2 F5 消费 / §3.14**。**§3.14 待补一条**:Genesis 推荐佣金链路前端缺失,待 PM 确认是否需要(若需要则 V4 上报前端补 §10 链路)。

---

#### [G7] 复投激励
**① 目的 & 对齐**: 配置复投产品的锁仓 APY / 期限 / 培育奖倍率 / Genesis 抽奖券联动,作为引导用户把余额重新投入资金循环的转化产品。对齐前端 **§9.5**(`/me/wallet/repurchase`:35% APY / 90 天 / Genesis 抽奖券)。服务业务目标:用更短路径(复投得锁仓收益 + 培育奖 + 抽奖券)把用户留在资金循环内,提升复投率与资金留存,服务 **B3 转化漏斗复投级**(`wallet.reinvest`,§2.4.7;漏斗级而非 §18.2 八项 KPI——§18.2 闭集无独立「复投/LTV」KPI 项)与 **§18.2 Day7 留存** cohort。**复投定价引用 G3 NEX 现价**(若复投以 USDT 触发则定价中性,涉 NEX 估值部分取 G3 现价);**Genesis 抽奖券联动 G4**。

**② 后台界面**:
- **复投配置面**:`APY / LOCK_DAYS / 培育奖倍率 / Genesis 抽奖券发放规则 / preset 金额档`。
- **复投监控**:复投单数 / 金额分布 / 90 天后到期本息预测(喂 B2)/ 发放的抽奖券数(联动 G4 Genesis 抽奖池)。
- **状态机**(复投,server-canonical):复用 staking 锁仓状态机(`pending_lock → active(90d 锁仓)→ mature_unclaimed → claimed`;旁路 `early_withdrawn` 罚本金 15% + forfeit 利息 / 券,§9.5 how-it-works §3)。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| 复投 `APY` | **现状值(§9.5)**:35% | 0–300% | 仅新复投单(在锁锁定) | §9.5 `35% APY · 90 days` benefit |
| 复投 `LOCK_DAYS` | **现状值(§9.5)**:90 天 | ≥ 1 | 仅新复投单 | §9.5 `90 天` 锁仓 + 预测 |
| 培育奖倍率(Cultivation) | **现状值(§9.5)**:×1.5 | ≥ 1.0 | 实时(复投者培育奖计算即用) | §9.5 `Cultivation ×1.5` benefit |
| Genesis 抽奖券发放 | **现状值(§9.5)**:每复投单 +1 张(每月开奖,联动 G4) | ≥ 0 张 / 单 | 仅新复投单 | §9.5 `Genesis lottery ticket` benefit |
| preset 金额档 | **现状值(§9.5)**:$100 / 200 / 500 / 1,000 | 自定义档位 | 实时 | §9.5 金额输入 presets |
| 早赎罚款 | **现状值(§9.5 how-it-works)**:罚本金 15% + forfeit 利息/券 | 0–100% 本金 | 仅新复投单 | §9.5 how-it-works `Early withdrawal cost` callout |

> **默认值口径**:12 月节奏表 §6 未覆盖复投 APY/倍率(注:12 月 §6.4 `reinvestMultiplier` 月 5–6 限时 2× 的**消费/生效面归 G7 复投域**(PM 2026-06-02 裁定:复投动作发生在 G7 `/me/wallet/repurchase`,倍率在复投那一刻套用,与 V1 §⑤ dial 表「G7 域生效」一致),与本子模块的复投**产品** APY/培育倍率为同域不同杠杆;G7 既配置产品参数、又是 H1 下发 `reinvestMultiplier` 的生效面)。取前端现状值(标注「现状值」)。升 APY / 升培育倍率 / 降罚款属放大流出,受 ① B1 红线前置约束。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改 APY / 锁期 / 培育倍率 | 财务(lead)/ 超管(2026-06 操作确认决议,放大方向原复核层级就高为执行门槛) | G7-MD1(理由必填+B1 红线预检(升 APY / 升倍率方向)) | `admin.repurchase_config_changed`(字段 / 前后值 / coverageAtSubmit / operator) |
| 改 Genesis 抽奖券发放规则 | 运营(lead)/ 超管 | G7-MD2(理由必填;联动 G4 抽奖池容量核对) | `admin.repurchase_lottery_changed`(前后规则 / G4 核对 ref / operator) |
| 改 preset / 早赎罚款 | 运营(lead)/ 超管 | G7-MD3(理由必填+B1 红线预检(降罚款方向)) | `admin.repurchase_params_changed` |
| 查看配置 / 复投监控 | 全角色(按可见性裁剪) | 否(只读) | — |

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改 APY / 锁期 / 培育倍率 | ② 复投配置面参数卡「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 G7-MD1 |
| 改 Genesis 抽奖券发放规则 | ② 复投配置面抽奖券规则行「编辑」 | 行内按钮 | 仅运营(lead)/ 超管渲染 | 打开弹窗 G7-MD2 |
| 改 preset / 早赎罚款 | ② 复投配置面 preset / 罚款卡「编辑」 | 行内按钮 | 仅运营(lead)/ 超管渲染 | 打开弹窗 G7-MD3 |
| 查看复投监控 / 到期预测 | ② 复投监控 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [G7-MD1] 复投产品参数变更
- **功能**:修改复投 `APY` / `LOCK_DAYS` / 培育奖倍率,确认即生效(APY / 锁期仅新复投单,培育倍率实时)。
- **布局结构**:1. **信息区**:当前 APY / 锁期 / 培育倍率 / 在锁复投单数 + 金额合计(② 复投监控同源)。2. **影响预览区**:before→after 并排;升 APY / 升倍率方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);提示「在锁复投单按开锁锁定值结算,不追溯」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 `APY` | 数字输入(%) | 改该项时必填 | 0–300%(③ 表) | 当前值(35%) |
| 目标 `LOCK_DAYS` | 数字输入(天) | 改该项时必填 | ≥ 1(③ 表) | 当前值(90) |
| 目标培育奖倍率 | 数字输入(×) | 改该项时必填 | ≥ 1.0(③ 表) | 当前值(×1.5) |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(升 APY / 倍率预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(超出 ③ 表范围)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;配置卡就地更新;toast「复投参数已生效 · 已记审计」;事件 `admin.repurchase_config_changed`;实时告警超管 + 财务 lead。

##### [G7-MD2] Genesis 抽奖券发放规则变更
- **功能**:修改每复投单的 Genesis 抽奖券发放张数 / 规则(仅新复投单生效),确认即生效;联动 G4 每月开奖池。
- **布局结构**:1. **信息区**:当前发放规则 / 本月已发券数 / G4 抽奖池当前容量(server 派生,跨域只读)。2. **影响预览区**:before→after 并排;G4 池容量核对结果行(拟生效发放节奏 vs 池容量;超容量内联警示,确认钮置灰)。3. **输入区**:目标张数 / 单(数字输入,≥ 0,③ 表)+ G4 核对 ref(文本输入,必填;落审计)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422(G4 池容量核对不通过,server 回传容量缺口)/ 400 `REASON_REQUIRED` / 400(缺 G4 核对 ref)/ 409 / 403。
- **成功反馈**:弹窗关闭;规则行就地更新;toast「发放规则已生效(仅新复投单) · 已记审计」;事件 `admin.repurchase_lottery_changed`;实时告警超管 + 运营 lead;同步 G4 开奖池预估。

##### [G7-MD3] 复投 preset / 早赎罚款变更
- **功能**:修改 preset 金额档 / 早赎罚款比例,确认即生效(preset 实时,罚款仅新复投单)。
- **布局结构**:1. **信息区**:当前 preset 档位 / 早赎罚款比例 / 在锁复投单数。2. **影响预览区**:before→after 并排;**降罚款方向** server 预检「**拟生效后覆盖率**」(降罚款 = 放大流出,③ 注),低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」)。3. **输入区**:preset 档位编辑(数字输入组,自定义档位)+ 目标早赎罚款(数字输入 %,0–100% 本金,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(降罚款方向,弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;配置卡就地更新;toast「参数已生效 · 已记审计」;事件 `admin.repurchase_params_changed`;实时告警超管 + 运营 lead。

**⑤ 接口**(收敛 §9.11c.1;复投走 staking vault):
- `GET /api/config/repurchase` — APY / 锁期 / 培育倍率 / 抽奖券规则 / presets / 罚款;**server-canonical**,前端 §9.5 读此。
- `GET /api/admin/repurchase/orders?status=&cursor=` — 复投单监控(server 权威;复用 staking position 台账,`product=repurchase`)。
- `PUT /api/admin/repurchase/config` — 改复投参数(经确认弹窗 G7-MD1/MD2/MD3,reason 必填(空值 400 `REASON_REQUIRED`);**升 APY / 倍率 / 降罚款 server 先核 B1,< 红线返 422**)。

> **复投落地为原子组合(§9.11e)**:前端 §9.5.3 复投 = `debitBalance(amount) + stake(amount, 90)` 两 store 写,真后台须收敛到 single endpoint + server transaction(§9.11e:跨 store mutation 原子性),G7 配置的参数由该 server 事务一致应用。

**⑥ 权限 & 审计**:
| 角色 | 查看配置/复投单 | 改 APY/倍率 | 改抽奖券/preset/罚款 |
|---|---|---|---|
| 运营 | ✅ | — | ✅(lead) |
| 财务 | ✅ | ✅(lead) | — |
| 超管 | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):APY / 倍率为放大方向,原复核层级就高(财务(lead)/ 超管 + B1 红线预检);抽奖券 / preset / 罚款原复核 = 运营主管,就高为运营(lead)/ 超管(降罚款方向另带 B1 预检)。

审计字段(A2):`action / field / before / after / coverageAtSubmit / lotteryRuleRef(联动 G4) / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:复投单状态(复用 staking 状态机)server 权威;client 不得本地伪造复投到期 / 券;早赎罚款 + forfeit 由 server 计算。
- **下游定价联动 G3**:复投以 USDT 触发(§9.5.3 `debitBalance`),定价中性;涉及 NEX 估值展示部分取 **G3 server 现价**(不接受 client 价)。
- **抽奖券联动 G4**:复投发放的 Genesis 抽奖券进 G4 每月开奖池;改发放规则须核对 G4 抽奖池容量(④ 确认弹窗 G7-MD2 附 G4 核对 ref)。
- **负债联动(② 跨域事实)**:`staking.opened(product=repurchase)` 增 B2 应付负债(本金 + 90 天 APY 应付利息);到期本息落 D4 bill。
- **B1 前置(① 跨域事实)**:升 APY / 培育倍率提交即 server 核验覆盖率红线。
- **原子性 + 幂等 & 并发裁决(§9.11e;章首贯穿事实 ⑧;§9.11e)**:复投两 store 写(`debitBalance + stake`)收敛 server 单事务,crash 中途不得部分持久化;复投提交 + 90 天到期本息 `claim` 派发携 **`Idempotency-Key`** 去重(retry 不重复扣款 / 重复入账);竞态 `mature_unclaimed → claimed` 与早赎 `active → early_withdrawn`(罚本金 15% + forfeit）以 server 终态为准,early_withdrawn / kill 锁定后并发 claim 返 **409**;改 APY/倍率对在锁复投单按开锁锁定值结算(不追溯)。

**⑧ 埋点(事件)**:
- **产生 / 消费**:`wallet.reinvest`(§2.4.7 漏斗定义已列,但 **V1 阶段尚未在 A4 schema registry 正式注册**且 **domain 归属 `wallet` vs `checkout` 待 A4 治理确认**,§2.4.8;V1 B3 §③ 因此降级用二次 `checkout.completed`。**G7（V3）落地即随 schema 变更确认流程(§2.4.8,仅超管经 A2-MD1 确认弹窗执行）完成 `wallet.reinvest` 正式注册并切换 B3 复投级双口径**)+ `staking.opened(product=repurchase)` / `staking.claimed`(money family,复用 `staking` domain)。
  - **口径热切灰度(避免 B3 复投级 CVR 时间序列断层)**:`wallet.reinvest` 正式注册后设**双写过渡窗**(同时记 `wallet.reinvest` 与二次 `checkout.completed`)**≥ 一个 cohort 周期**,B3 复投级在窗口内**双口径对账一致后再切主口径**;**切换失败回退二次 `checkout.completed`**;**历史 cohort 不回填(仅新口径前向生效)**,以避免序列重写造成的复投级 CVR 历史断层。
- **产生(admin 审计)**:`admin.repurchase_config_changed` · `admin.repurchase_lottery_changed` · `admin.repurchase_params_changed`(A2 审计)。
- **domain 状态(blocking)**:复投资金侧复用 `staking` domain + `wallet.reinvest`(`staking` 在 §2.4.3 枚举内;`wallet.reinvest` 待 A4 注册见上);复投**专属转化事件**(如 `repurchase.sheet_viewed`)的 `repurchase` **不在** §2.4.3 枚举内 → **须向 A4 申请 domain 枚举扩展(§2.4.3),blocking 依赖,登记为 V3 起始工单**(体例同 G3 `nex` / `market`,无条件登记);**资金侧仍走 `staking.*` / `wallet.reinvest`,不重复记账**。
- **喂给**:`wallet.reinvest` → B3 复投漏斗级(§2.4.7)/ 复投率(运营内部漏斗口径,非 §18.2 八项 KPI;§2.4.7 B3 复投级);`staking.opened(product=repurchase)` → B2 应付负债 / D4 账本 / B1 覆盖率;抽奖券 → G4 开奖池;config 审计 → B1 + J1(V4)。

---

---

## 第 13 章 增长活动(域 H3-H6)

> **域定位**:增长活动(H3-H6)是平台「留存与活跃节奏」的运营控制面——把新用户拉新期的转化任务、限时活动、签到连胜、里程碑激励组织成一套可调度的增长引擎,服务 **§18.2「Day7 留存 >60%」**(KPI #2,§2.4.6),并在转化漏斗(B3)内驱动注册→首购级(§2.4.7)。H1 Phase 调度(§1.7)与 H2 Trial 已落地节奏总闸与拉新 wedge;本章补齐 H3-H6 四个子模块,**均 V3**:H3 Quest 任务引擎 · H4 活动中心 CMS · H5 签到 & 积分 · H6 里程碑庆祝。四者共享同一组跨域事实(server-canonical 防伪造 / NEX 流出受 B1 约束 / Phase dial 权威归 H1 / 操作确认 / A4 埋点),逐子模块兑现。
>
> **七条贯穿全章的跨域事实(逐子模块兑现)**:
> 1. **server-canonical(前端 §9.11d)**:quest 完成态 · streak 连胜计数 · milestone 触发 · Lucky 倍率与 Lucky Spin 结果**全部服务端权威**,client 仅 UI cache / 展示(前端 §9.11d.2 已列 `_devBumpEarningsTotal` 伪造 lifetime USD 领里程奖、`useProductPhaseOverride.pinned` 解锁高倍率等篡改路径)。**防伪造完成 / 伪造连胜 / 客户端刷 Lucky**——localStorage 不持权威。**概率型机制**(Lucky 15%/1.5× · 5%/2×;Day-30 milestone 发的 spin 票兑奖见 H4)须 server 裁决 + `NODE_ENV` guard:前端 §9.8 现状「Lucky multiplier 仅在 `signIn` handler 内 `Math.random()` roll」是 client 兜底,**生产环境概率计算严禁落在 client 端随机函数**——前端 §9.11d.3 已明列「Sign-in lucky multiplier(5% 2x / 15% 1.5x)→ `POST /api/points/sign-in` 返 multiplier」为「必须 server-driven」项(锚 `lib/v3/points.ts:87-88`),本章 H5 落实其 server 权威化。
> 2. **NEX/USDT 奖励流出受约束**:quest NEX(Day-One 500 NEX 等)/ milestone NEX / streak NEX = 放大 NEX 流出(代币经济侧);Streak Power-Ups 中 Royalty Boost(F2 unilevel 费率)/ Premium 7-day trial(G5)/ +2% APY on next stake(G1)/ Genesis whitelist(G4)= **跨域奖励**,H5 是触发面,下游域(F2/G5/G1/G4)honor 兑现并各自受 B1 兑付覆盖率约束(§1.8 原则一)。**改 Lucky 概率 / 里程碑 NEX 奖励 / quest 奖励倍率等放大流出方向的调整,提交前 server 须先核验 B1 覆盖率红线**(`coverageRedLine` 默认 **100%**,Ch4 B1 §③),低于红线 server 拒绝提交(返回 **422** + 当前覆盖率)。
> > **B1 红线拒绝码跨卷对账注**:本卷(V3)B1 红线拒绝统一 **422**(Ch4 B1 §③),本章沿用;V1 卷 B1 兑付覆盖率拒绝用 **403**(V1 §⑤「PUT 放大流出方向为覆盖率红线强约束」:覆盖率低于红线 server 拒绝、返回 403 + 当前覆盖率值)。二者指同一前置硬门(覆盖率低于红线即 server 拒绝提交),码值差异开发以单一码值落地。
> 3. **Phase dial 权威归 H1(§1.7),H3-H6 是消费/生效面**:`questBonusMultiplier` 是 H1 Phase **dial**(§1.7;12 月节奏表 §6.4「月 1-2 = 4,其他 = 1」拉新期任务加成),**权威归 H1 调度器,前端 Phase 引擎(`lib/store/product-phase.ts` PHASES)尚未实装该 dial**(前端现状 dial 含 `inviteBonusMultiplier` / `withdrawalPointsPer100` / `withdrawalCooldownDays` / `binaryDailyCapUSD` / `complianceHoldEnabled` 等;**前端现状仍含已下线的 `premiumSubscriptionAvailable` / `nexV2LockAvailable`**,后台 8-dial 模型已移除该两 gate;前端无 quest 字段、亦无 newUser 字段),真后台 H1 落地后 H3 作为消费面读取并套用,H3 不持 dial 写权(分工同 D5 提现参数、F3 双轨 binaryDailyCap 的「H1 下发 / 业务域消费」范式)。
> > **Phase dial 数口径脚注(B4-note 体例)**:H1 后台权威口径 = **10-dial**(§1.7 / 12 月 §6.4 九项 + `complianceHoldEnabled`);前端现状有差异——前端 §9.11c.1 / §9.11d.3 写 **8 dials**(缺 `newUserBonusMultiplier` + `questBonusMultiplier`,且把 `complianceHoldEnabled` 计入)、前端 §13.4.1 为 **7-dial**、`lib/store/product-phase.ts` PHASES 现状 **7 dial**(同样无 quest dial)。dial 数差异后台按 10-dial 口径落地。**`questBonusMultiplier` 为本章相关但前端未实装的 dial**(仅 12 月 §6.4 规划值),H3 落地时若 H1 尚未下发则任务结算乘数取 1×(等价于现状无乘数平铺,前端 `lib/mock/quest.ts` Day-One 500/200 NEX 即平铺无乘数)。
> 4. **操作确认(Confirm-with-Reason,§1.8 原则二.4;2026-06 操作确认决议)**:改 quest 奖励 / 任务清单、改活动配置(上下架 / featured / 奖励)、改签到奖励 / Lucky 概率 / 里程碑奖励、改 Streak Saver 规则、改 milestone 阈值 / NEX 奖励 —— 一律单人执行 + 业务专属确认弹窗 + 理由必填(server 强制非空,400 `REASON_REQUIRED`,8–200 字)+ A2 审计留痕(operator / before / after / reason / IP / ts),即时生效;高敏动作落审计同时实时告警超管与对应域角色 lead(留痕落 A2 统一 schema,§2.x ⑥;确认门与 schema 变更权威归 A2,§3.14:审计/操作确认权威归 A2,本域不另立确认机制)。**改 Lucky 概率 / 里程碑 NEX 奖励 / 奖励倍率 / 奖池调升 = 放大流出方向,确认弹窗带 B1 红线预检(前置核 B1,低于红线 422 `COVERAGE_BELOW_REDLINE`,弹窗内展示 server 预检的「拟生效后覆盖率」);关闭 / 调降方向不带预检**(跨域事实 2)。
> 5. **埋点对齐 A4(V1 §2.4 埋点事件体系)**:`quest.*` / `event.*` / `daily.*`(签到)/ `milestone.*` 事件须在 A4 schema registry 注册。**§2.4.3 domain 枚举现状(V1 §2.4.3 现行登记)**:`app / auth / referral / kyc / onboarding / store / checkout / device / earnings / wallet / withdraw / commission / staking / exchange / genesis / trial / quest / daily / nova / phase / risk / admin`——**已含** `quest` / `daily`(§2.4.5 ④ engagement family 已列 `quest.completed` / `daily.checkin`)→ H3/H5 复用,无需扩展;**未含** `event`(H4)/ `milestone`(H6)→ 这两个 domain **须向 A4 申请 domain 枚举扩展(§2.4.3),blocking 依赖,登记为 V3 起始工单**(体例参 V2 `order` domain 起始工单 / V3 G3 `nex`、G5 `premium`、G7 `repurchase`)。新增 object_action 的 registry 注册同走 **A4 schema 变更确认(§2.4.8;§2.x ⑥「审计/埋点 schema 变更(新增事件/属性)」仅超管经 A2-MD1 确认弹窗执行)**,emit 前完成,与 H4/H6 domain 扩展同属 blocking 前置。quest claim / 签到 / 里程碑 / Lucky 派发事件 `is_server_authoritative=true`(§2.4.4:资金 / 状态事件 = true)。这些事件喂 **B3 漏斗(§2.4.7)+ Day7 留存(KPI #2,§2.4.6)+ L 域 BI**。
> 6. **12 月默认值口径(§7 硬规则)**:`questBonusMultiplier` 月 1-2 = 4× 以 **12 月节奏表 §6.4** 为权威(规划值,前端未实装);quest NEX 奖励 / Lucky 概率 / 里程碑阈值与奖励 / streak 规则等 12 月 §6 未覆盖 → 以前端 §5.15 / §9.8 / §11.3a / §11.10 / §11.13 现状值为**参考并标注「现状值」**。三者冲突以 12 月节奏表为准,就地注明差异。
> 7. **中性运营语言**:全程真实平台增长运营者口径(任务运营 / 活动配置 / 签到留存 / 里程碑激励 / 连胜机制 / 概率型奖励);禁一切 meta / 编辑性措辞,留存 / 里程碑路线图 / 连胜保护等机制统一表述为「留存激励 / 里程碑路线图 / 连胜保护」。
>
> **跨域事实声明(H 域内引用闭合)**:本批 H3-H6 落地的 Phase-dial 消费面**仅** `questBonusMultiplier`(H3,跨域事实 3/6)。另有三个增长侧消费倍率 dial 的落点存在 V1 内部口径冲突,**本章不硬指定,声明并记入 §3.14 + V4 跨文档收口**:(a) `newUserBonusMultiplier` 消费面——V1 §⑤ dial 表(`newUserBonusMultiplier` 锚)与 12 月 §6.4 均指向「H3–H6 域 V3 后生效」,口径一致,待 H 域后续子模块收口;(b) `inviteRewardMultiplier` 消费面——同上,V1 dial 表锚「H3–H6 域 V3 后生效」;(c) `reinvestMultiplier` 消费面——**存内部口径冲突**:V1 §⑤ dial 表(复投加成行)锚「**G7 域 V3 后生效**」,而 V3 G7 子模块(本卷 G7 §默认值口径注)复述「12 月 §6.4 `reinvestMultiplier` 月 5–6 限时 2× 是 **H3–H6 增长侧的复投奖励倍率 dial**,H1 下发的 `reinvestMultiplier` 另在增长活动域生效」,即 reinvestMultiplier 究竟落 H3-H6 还是 G7 在 V1↔V3 之间未定论。`reinvestMultiplier` / `newUserBonusMultiplier` / `inviteRewardMultiplier` 三者消费面在 H3-H6 通篇**零落地**(本批仅 `questBonusMultiplier`),为消除 V1 dial 表→H3-H6 的单向引用悬空,在此显式声明三者落点待 H 域后续子模块 / G7 收口对账;最终归属由 PM 回源决议,记入 §3.14 与 V4 跨文档收口,不在本仲裁层硬指定。

---

#### [H3] Quest 任务引擎
**① 目的 & 对齐**: 配置平台三层任务体系(首日 Day-One Quest / 每周 Weekly Quests / 每月 Monthly Challenge)的任务清单、NEX 奖励、3-phase 时窗与 Phase 乘数消费面,作为新用户拉新期与持续活跃期的任务化转化引擎。对齐前端 **§5.15**(`/` Home 顶部 Day-One Quest:active 0-24h=500 NEX / grace 24-72h=200 NEX / expired 72h+=0;§5.15.3 6 任务清单)+ **§11.13**(`/missions` Mission Center 4 层架构 L1-L4:Weekly Tier1/Tier2 + Monthly Challenge,§11.13.1 总览)+ **§9.11c.1**(`GET /api/config/quest/day-one`「新人转化最核心钩子」)。服务业务目标:把新用户首日活跃→商城浏览→绑卡前段漏斗动作组织成任务化引导——首日 6 任务中,逛商城(`visit_store`)/ 看 ROI(`view_product_roi`)直接产 `store.viewed`(漏斗 #3,§2.4.7),绑卡(`connect_wallet`,href `topup?kyc=1`)命中绑卡级 `kyc.express_verified`,邀请(`invite_friend`)产 `referral.invite_sent`,设资料(`setup_profile`)/ 逛 Earn(`visit_earn`)为纯留存动作(不入漏斗)。通过签到/任务/里程碑回访激励**间接**提升 Day7 活跃(KPI #2 口径为 `app.dau ÷ register cohort`,§2.4.6;本机制经回访→`app.dau` 路径间接贡献,非 KPI 直接口径),并通过任务 CTA 引导用户产生 `store.viewed` / `checkout.completed` 这些 B3 漏斗级事件(行为驱动,非 quest 事件本身入漏斗)。
> **§5.15 / §11.13 锚点脚注**:Monthly Challenge 规格簇散落多处——§11.13.1(,L3 概览「10,000 NEX + 月度勋章」,口径为该层「单次最大奖」)/ §12.14(,`useMonthlyChallenge` store)/ §9.11c.2(,列 `GET /api/quests/monthly` endpoint,锚 `lib/mock/monthly-challenge.ts`)/ 代码(`lib/mock/monthly-challenge.ts:42-103` 完整 5 主题 reward 表)。**前端 PRD 不存在 §11.14 标题**(章节序 §11.13.1…§11.13.10 后跳 §12.x);前端 PRD 三处 `§11.14` 引用为悬空引用,本章一律不引 §11.14,改引上述真实锚点。

**② 后台界面**:
- **Day-One Quest 配置面**(§5.15):3-phase 时窗(`QUEST_WINDOW_MS` active / `QUEST_GRACE_END_MS` grace 边界)+ 各 phase 完成奖励(500 / 200 / 0 NEX)+ Badge 映射(`day_one_hero` / `day_one_latecomer`)+ 6 任务清单(`id / 标题 i18n key / 跳转 href / 完成触发类型 / 奖励 NEX`)。
- **Weekly Quests 配置面**(§11.13.3/.4):Tier 1 派发器 9 条优先级规则(条件 / quest id / base reward NEX / 入金类型 / Badge)+ Tier 2 池 8 条(quest id / base reward / 派发条件)+ Weekly Champion bonus 行(+500 NEX × phase mult)。
- **Monthly Challenge 配置面**(§11.13.1 + §12.14 + `lib/mock/monthly-challenge.ts:42-103`):**5 主题 × {`monthsFrom`/`monthsTo` 月龄分段 · `rewardNex` · `badgeId` · 3 AND-gated `subGoals`}**——`foundation_builder`(月龄 0-2 · 1,500 NEX)/ `network_architect`(2-4 · 2,500)/ `premium_pathway`(4-6 · 4,000)/ `diamond_tier`(6-9 · 6,000)/ `founders_quest`(9+ · 10,000 NEX + 勋章);派发器(`dispatchMonthlyChallenge` 按 `joinedAt` 月数)+ 5 主题清单 + 每主题 3 子目标(各带 `key` / `href` / `target`)。L3 架构概览见 §11.13.1。
- **Phase 现值只读条**:展示当前各 Phase 的 Weekly Tier1 phase reward multiplier 端点摘要(P1 1.0 → P6 1.5,完整六档曲线见 ③)+ `questBonusMultiplier` 现值(由 H1 下发,H3 不可改;前端未实装时取 1×)。
- **任务完成监控**(只读,server-canonical):按 quest 维度的完成 / claim 计数 + 单 phase 转化漏斗(active claim 率 / grace claim 率 / expired 流失)。
- **状态机**(Day-One Quest,§5.15.1,server-canonical):`active(0-24h·500 NEX)→ grace(24-72h·200 NEX)→ expired(72h+·0·Home 不渲染让位)`;claim 旁路:`active/grace 全 6 任务完成 → claimed(creditNex + unlock badge)`。Weekly 状态机按 `weekKey` 跨周 reset(§11.13.6);Monthly 按 `rollMonthIfStale` 跨月清空(§12.14 `useMonthlyChallenge`)。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| Day-One active 奖励 | **现状值(§5.15.1)**:500 NEX | ≥ 0 | 仅新进 active 的用户(在窗用户按进窗锁定值) | §5.15.4 `Claim +500 NEX bonus` |
| Day-One grace 奖励 | **现状值(§5.15.1)**:200 NEX(降 60%) | 0 ≤ x ≤ active 值 | 仅新进 grace | §5.15.4 `Claim Latecomer +200 NEX` |
| `QUEST_WINDOW_MS`(active 窗)/ `QUEST_GRACE_END_MS`(grace 上界) | **现状值(`lib/mock/quest.ts:35-36` / §9.11c.1)**:86,400,000(24h)/ 259,200,000(72h) | active 1h–168h;grace ≥ active | 见下方 ⑦「改窗相位语义」二选一裁定 | §5.15.2 倒计时 chip 起算 |
| Day-One 6 任务清单(id / href / 奖励) | **现状值(§5.15.3 / `quest.ts:25-30`)**:connect_wallet 50 / visit_earn 30 / visit_store 50 / view_product_roi 100 / setup_profile 80 / invite_friend 200 NEX + $1 USDT | 任务可增删改;单任务奖励 ≥ 0 | 仅新进 active(在窗按锁定清单) | §5.15.3 6 行任务 row |
| Weekly Tier1 base reward(9 条) | **现状值(§11.13.3)**:nex_v2_lock 3,000 / buy_genesis 2,500 / buy_additional_hw 2,000 / tradein_upgrade 1,800 / upgrade_s1_to_pro_v2 1,500 / subscribe_premium 800 / buy_first_box 1,000+$10 / topup_balance 100 / stake_fallback 250 NEX | 各 ≥ 0 | 仅新 weekKey 派发(同周锁定) | `<WeeklyQuestHero>` 大字 `+XXX NEX` |
| Weekly Tier2 base reward(8 条) | **现状值(§11.13.4)**:invite_friend 200+$2 / reinvest 120 / stake_small 150 / nex_swap 80 / top_up_small 100 / browse_store 50 / ai_jobs_50 80 / genesis_browse 60 NEX | 各 ≥ 0 | 仅新 weekKey 派发 | `<WeeklyQuestList>` 行奖励 |
| Weekly Champion bonus | **现状值(§11.13.5)**:+500 NEX × phase mult(P1=500 / P6=750) | ≥ 0 | 仅新 weekKey | `<WeeklyQuestList>` 底部 Bonus 行 |
| Weekly Tier1 phase reward multiplier 曲线 †† | **现状值(§11.13.3 `getPhaseRewardMultiplier`,`weekly-quests.ts:199-208`)**:P1 1.0 / P2 1.0 / P3 1.1 / P4 1.2 / P5 1.3 / P6 1.5 | 各档 ≥ 0,逐档可配 | 仅新 weekKey(按当前 Phase 锁定) | `<WeeklyQuestHero>` / `<WeeklyQuestList>` `×N boost` chip(reward × mult) |
| Monthly Challenge 5 主题各档奖励 | **现状值(`monthly-challenge.ts:42-103`)**:foundation_builder 1,500 / network_architect 2,500 / premium_pathway 4,000 / diamond_tier 6,000 / founders_quest 10,000 NEX(+ 月度勋章) | 各 ≥ 0,逐主题可配 | 仅新月派发(已 claimable 按当前值) | `<MonthlyChallengeCard>` |
| Monthly Challenge 月龄分段 + 子目标 target | **现状值(`monthly-challenge.ts:42-103`)**:各主题 `monthsFrom`/`monthsTo` + 每主题 3 子目标 `target`(如 lifetime_earned 200/1500/5000/15000/40000) | target ≥ 0,分段保序 | 仅新月派发 | `<MonthlyChallengeCard>` 子目标进度 |
| `questBonusMultiplier`(H1 下发)† | **规划值(12 月 §6.4)**:月 1-2 = 4,其他 = 1;**前端未实装**(`product-phase.ts` PHASES 无此 dial) | 1–4(倍率,H1 dial,H3 不可改) | 由 H1 Phase 调度(月粒度);H1 未下发时取 1× | quest 结算 NEX 实发额(乘数生效) |

> **默认值口径**:quest 奖励 / 时窗 / 任务清单 / Monthly 各档奖励 + 子目标取前端现状值(标注「现状值」);**`questBonusMultiplier` 以 12 月 §6.4「月 1-2 = 4×」为权威**(规划值,前端未实装,跨域事实 3/6)。**升 quest 奖励 = 放大 NEX 流出**,受跨域事实 2 的 B1 红线前置约束。
> † **questBonusMultiplier 不在本子模块写权范围**——它是 H1 Phase dial(§1.7),H3 仅读取 Phase 现值并在任务结算时套用 `实发 NEX = base reward × questBonusMultiplier`;改 dial 走 H1 调度器,前端落地前该 dial 不存在(跨域事实 3 脚注)。**拉新期 4× 业务意图**:`questBonusMultiplier` 拉新期 4×(高于 `inviteRewardMultiplier` / `newUserBonusMultiplier` 的 2×,均 12 月 §6.4)意在用任务奖励作为新用户首两月最强留存 + 转化抓手,与 newUserBonus 2× / inviteReward 2× 在 §4.3 杠杆组合叠加,形成拉新期增长合力。
> †† **Weekly phase multiplier 与 questBonusMultiplier 是不同杠杆**:前端 §11.13.3 `getPhaseRewardMultiplier`(P1 1.0→P6 1.5)是 Weekly 任务**另一套**乘数(已实装于 `lib/mock/weekly-quests.ts`),H3 配置本曲线;`questBonusMultiplier`(月 1-2=4× 的 Day-One/全局任务加成)由 H1 下发且前端未实装。二者均在任务结算生效但来源不同,就地区分避免混淆。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改 Day-One 时窗 / phase 奖励 / 6 任务清单 | 增长(lead)/ 超管(2026-06 操作确认决议,原复核层级就高为执行门槛) | H3-MD1(理由必填+B1 红线预检(升奖励方向)) | `admin.quest_dayone_config_changed`(字段 / 前后值 / coverageAtSubmit / 原因 / operator) |
| 改 Weekly Tier1/Tier2 清单 / 奖励 / Champion bonus | 增长(lead)/ 超管 | H3-MD2(理由必填+B1 红线预检(升奖励方向)) | `admin.quest_weekly_config_changed`(tier / quest id / 前后值 / coverageAtSubmit / operator) |
| 改 Monthly Challenge 主题 / 各档奖励 / 月龄分段 / 子目标 target(按 challenge id 维度) | 增长(lead)/ 超管 | H3-MD3(理由必填+B1 红线预检(升奖励方向)) | `admin.quest_monthly_config_changed`(challenge id / field / 前后值 / operator) |
| 改 Weekly phase reward multiplier 曲线 | 财务(lead)/ 超管(放大全周任务流出,原复核 = 财务主管就高) | H3-MD4(理由必填+B1 红线预检(调升方向)) | `admin.quest_weekly_phasemult_changed`(前后曲线 / coverageAtSubmit / operator) |
| 查看任务配置 / 完成监控 | 全角色(按可见性裁剪) | 否(只读) | — |

> **questBonusMultiplier dial 不在本表**:`questBonusMultiplier` 调整属 **H1 Phase 调度器**动作(§1.7),不在 H3 操作面;H3 仅消费下发值。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改 Day-One 时窗 / 奖励 / 任务清单 | ② Day-One Quest 配置面参数卡 / 任务清单行「编辑」 | 行内按钮 | 仅增长(lead)/ 超管渲染 | 打开弹窗 H3-MD1 |
| 改 Weekly 清单 / 奖励 / Champion bonus | ② Weekly Quests 配置面 Tier1/Tier2 行「编辑」 | 行内按钮 | 仅增长(lead)/ 超管渲染 | 打开弹窗 H3-MD2 |
| 改 Monthly 主题 / 奖励 / 分段 / 子目标 | ② Monthly Challenge 配置面主题卡「编辑」 | 行内按钮 | 仅增长(lead)/ 超管渲染 | 打开弹窗 H3-MD3 |
| 改 Weekly phase mult 曲线 | ② Phase 现值只读条旁「编辑曲线」 | 次按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H3-MD4 |
| 查看完成监控 / 漏斗 | ② 任务完成监控 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [H3-MD1] Day-One Quest 配置变更
- **功能**:修改 Day-One 3-phase 时窗(`QUEST_WINDOW_MS` / `QUEST_GRACE_END_MS`)/ 各 phase 奖励 / 6 任务清单(增删改),确认即生效(对在窗用户的相位语义按 ⑦ 所选方案 A/B 执行)。
- **布局结构**:1. **信息区**:当前时窗 / active / grace 奖励 / 任务清单摘要 / 当前在窗用户数(server 派生)。2. **影响预览区**:before→after 并排;升奖励方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);改窗时提示行「按 ⑦ 所选方案(A:仅新 mount 生效 / B:在窗用户重算相位)执行」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 active / grace 奖励(NEX) | 数字输入组 | 改该项时必填 | active ≥ 0;grace ≤ active(③ 表) | 当前值(500/200) |
| 目标时窗(`QUEST_WINDOW_MS` / `QUEST_GRACE_END_MS`) | 数字输入组(小时换算) | 改该项时必填 | active 1h–168h;grace ≥ active(③ 表) | 当前值(24h/72h) |
| 任务清单编辑(id / href / 奖励) | 行内可编辑表格 | 改该项时必填 | 单任务奖励 ≥ 0(③ 表) | 当前清单 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(升奖励预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(超出 ③ 表范围)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;配置面就地更新;toast「Day-One 配置已生效 · 已记审计」;事件 `admin.quest_dayone_config_changed`;实时告警超管 + 增长 lead。

##### [H3-MD2] Weekly Quests 配置变更
- **功能**:修改 Weekly Tier1(9 条)/ Tier2(8 条)清单、base reward、Champion bonus,确认即生效(仅新 weekKey 派发,同周锁定)。
- **布局结构**:1. **信息区**:当前 tier 清单摘要 / 本周 weekKey / 本周已派发任务数。2. **影响预览区**:before→after 并排(逐 quest id diff);升奖励方向 server 预检「**拟生效后覆盖率**」+ 红线警示(低于红线确认钮置灰);提示「本周已派发任务按派发时锁定值结算,新值下个 weekKey 生效」。3. **输入区**:tier 选择(Tier1 / Tier2 / Champion bonus)+ 逐条 base reward 编辑(数字输入,≥ 0,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;配置面就地更新;toast「Weekly 配置已生效(下个 weekKey) · 已记审计」;事件 `admin.quest_weekly_config_changed`;实时告警超管 + 增长 lead。

##### [H3-MD3] Monthly Challenge 配置变更
- **功能**:按 challenge id 修改主题各档奖励 / 月龄分段(`monthsFrom`/`monthsTo`)/ 子目标 target,确认即生效(仅新月派发,已 claimable 按当前值)。
- **布局结构**:1. **信息区**:所选 challenge id / 当前奖励 / 分段 / 3 子目标 target / 本月在挑战用户数(server 派生)。2. **影响预览区**:before→after 并排;升奖励方向 server 预检「**拟生效后覆盖率**」+ 红线警示(低于红线确认钮置灰);分段保序冲突时内联指出冲突主题。3. **输入区**:目标 `rewardNex`(数字输入,≥ 0)+ 分段 `monthsFrom`/`monthsTo`(数字输入组,保序,③ 表)+ 子目标 target 编辑(数字输入组,≥ 0)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(分段保序违反,内联指出冲突主题)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;主题卡就地更新;toast「Monthly 配置已生效(仅新月) · 已记审计」;事件 `admin.quest_monthly_config_changed`;实时告警超管 + 增长 lead。

##### [H3-MD4] Weekly phase multiplier 曲线变更
- **功能**:修改 Weekly Tier1 phase reward multiplier 六档曲线(P1–P6),确认即生效(仅新 weekKey,按当前 Phase 锁定)。
- **布局结构**:1. **信息区**:当前六档曲线(P1 1.0 → P6 1.5)/ 当前 Phase 与本周适用档。2. **影响预览区**:before→after 曲线并排(逐档 diff);调升任一档 server 预检「**拟生效后覆盖率**」(放大全周任务流出),低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」)。3. **输入区**:P1–P6 逐档数字输入(各档 ≥ 0,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;曲线条就地更新;toast「曲线已生效(下个 weekKey) · 已记审计」;事件 `admin.quest_weekly_phasemult_changed`;实时告警超管 + 财务 lead。

**⑤ 接口**(`GET` 配置源收敛 §9.11c.1/.2):
- `GET /api/config/quest/day-one` — Day-One 时窗 + phase 奖励 + 6 任务清单;**server-canonical 配置源**(§9.11c.1「新人转化最核心钩子」),前端 §5.15 读此。
- `GET /api/quests/weekly?weekKey=` — Weekly Tier1/Tier2 派发清单 + 奖励(§9.11c.2;按 `weekKey` 确定性派发);**server-canonical**,前端 §11.13 读此。
- `GET /api/quests/monthly` — Monthly Challenge 主题 + 各档奖励 + 月龄分段 + 子目标(§9.11c.2);前端 §12.14 + §11.13.1 读此。
- `GET /api/admin/quest/completions?quest=&phase=&cursor=` — 任务完成 / claim 监控(server 权威完成台账,游标分页)。
- `PUT /api/admin/quest/day-one` / `PUT /api/admin/quest/weekly` / `PUT /api/admin/quest/monthly` — 改各层配置(经确认弹窗 H3-MD1/MD2/MD3/MD4,reason 必填(空值 400 `REASON_REQUIRED`);**升奖励 server 先核 B1,< 红线返 422**)。
- **questBonusMultiplier 不在本组接口**:其值由 `GET /api/admin/platform/phase-config`(H1,§9.11c.1)下发,H3 server 在 quest 结算时读取并套用,H3 不重复定义 dial 写接口。

**⑥ 权限 & 审计**:
| 角色 | 查看任务/完成 | 改 Day-One/Weekly/Monthly | 改 phase mult 曲线 |
|---|---|---|---|
| 增长 | ✅ | ✅(lead) | — |
| 财务 | ✅ | — | ✅(lead) |
| 超管 | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):三层任务配置原复核层级就高为增长(lead)/ 超管(升奖励方向带 B1 红线预检);phase mult 曲线原复核 = 财务主管,就高为财务(lead)/ 超管。审计字段(A2 统一 schema,§2.x ⑥):`action / quest_layer / quest_id / field / before / after / coverageAtSubmit(升奖励时) / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:quest 完成态、claim 态、累计 NEX 全部 server 权威;前端 §5.15 `useQuest` persist + §11.13 `useWeeklyQuest` / `useMonthlyChallenge` 当前 localStorage 持久化,**真后台对接后完成态以 server 状态机为准,client 仅 UI cache**;路由型任务(visit_earn / visit_store / view_product_roi)的 `QuestRouteWatcher` markComplete 须经 server 二次确认(client 标记无效)。**防伪造完成**:client 不得本地 setState 标记任务完成或伪造 claim(§9.11d.2 同 Bills 伪造防御:server 唯一真相源)。
- **改窗(`QUEST_WINDOW_MS` / `QUEST_GRACE_END_MS`)对在窗用户相位语义——二选一须落地**:前端 `getQuestState`(`quest.ts:43-49`)完全由 `elapsedMs`(=now−startedAt)与全局常量 `QUEST_WINDOW_MS` / `QUEST_GRACE_END_MS` 实时比较得相位,**per-user 仅 `startedAt`(起算点)锁定,窗长本身是全局常量**——故改窗长即时影响所有在窗用户相位(active 可能瞬跳 grace/expired)。后台落地须二选一并写入接口契约:
> - **方案 A(真乐观锁,per-instance 配置快照)**:窗长变更仅对改后**新 mount** 用户生效——server 为每个 quest 实例在 `startedAt` 时刻快照 `windowMs` / `graceEndMs`,在窗用户继续按各自快照窗长判相位,不受后续改窗影响。需持久化 per-instance 窗快照。
> - **方案 B(全局即时量)**:窗长为全局即时量,改后在窗用户按新窗**重算相位**(可能即时降级 active→grace),已 `claimed` 奖励不回收。无 per-instance 快照。
> 两方案的差异(是否持久化 per-instance 窗快照)开发须明确知会,接口文档注明所选方案。
- **questBonusMultiplier 联动 H1(§1.7)**:结算实发 NEX = `base reward × questBonusMultiplier`,乘数由 H1 按 `joinedAt` 月龄下发(规划月 1-2 = 4×);前端 Phase 引擎尚未实装该 dial(`product-phase.ts` PHASES 无 quest 字段),H1 落地前结算取 1×;H3 不持写权(分工同 D5/F3/E1)。
- **NEX 流出联动 B1/B2(跨域事实 2)**:`quest.claimed` 的 NEX 派发增 NEX 计价代币流出;升 quest 奖励 / 倍率提交即被 `PUT` server 拦截核验 B1 覆盖率红线(NEX 计价负债折算口径见 Ch4 B1 §③)。
- **幂等 & 并发裁决(§9.11e)**:quest claim 携 **`Idempotency-Key`**(§9.11e 通则:所有 mutation endpoint 必须支持 Idempotency-Key;quest NEX 派发属新增奖励入账动作,沿用该通则,作为 V3 新登记事务边界行——§9.11e 表当前未含 quest 行)去重——retry 不重复 creditNex;竞态 `active → claimed` 与 `active → expired`(时窗滚动)以 server 终态为准,**expired 锁定优先**——进 expired 后并发到达的 claim 返 **409**(窗口已关,不派发);配置变更对 in-flight quest 按进窗 / 派发周锁定值结算(乐观锁,不追溯改既有用户的任务清单 / 奖励)。
- **kill 联动 J1(V4)**:quest 引擎无独立 kill-switch(§9.11d.1 未列),但 quest 内嵌的入金 CTA(如 §5.15.4 主 CTA 跳 `/store/stellarbox-s1`)受下游域 kill 影响;若监管点名「任务诱导」需全局停 quest,经 J1 矩阵编排(V4)。

**⑧ 埋点(事件)**:
- **产生(quest server)**:`quest.completed`(§2.4.5 ④ engagement,单任务完成,`is_server_authoritative=true`)· `quest.claimed`(phase / layer / reward NEX × multiplier;`is_server_authoritative=true`)—— `quest.claimed` 为本域内新增 object_action,注册同走 A4 schema 变更确认流程(§2.4.8,仅超管经 A2-MD1 确认弹窗执行)。
- **产生(admin 审计)**:`admin.quest_dayone_config_changed` · `admin.quest_weekly_config_changed` · `admin.quest_monthly_config_changed` · `admin.quest_weekly_phasemult_changed`(走 A2 操作确认审计(operator / reason),归 §2.4.5 ⑥ admin family,注册走 §2.4.8)。
- **domain 状态**:`quest` **已在** §2.4.3 domain 枚举内(;§2.4.5 ④ 已列 `quest.completed`),**无需扩展**;新 object_action `quest.claimed` 走 §2.4.8 schema 变更确认流程注册 registry。
- **喂给**:分两层——(a) quest/Day-One 任务 CTA 引导用户产生 `store.viewed` / `checkout.completed` 这些 B3 漏斗级事件(行为驱动,非 quest 事件本身入漏斗)→ B3 注册→首购漏斗(§2.4.7);(b) `quest.completed` / `quest.claimed` 事件本身喂活动效果 / 留存 BI(L 域:完成→claim CVR)+ `app.dau` 回访(经 §2.4.6 KPI #2 间接,非 KPI 直接口径),**不进 B3 漏斗主图**;phase 归因用通用属性 `phase`(§2.4.4);config 审计 → B1 覆盖率影响评估 + L 域。

---

#### [H4] 活动中心 CMS
**① 目的 & 对齐**: 配置限时活动(campaign / 活动位)的上下架、featured、奖励、追踪逻辑与 8 种 EventKind,作为周期性流量回访点的活动运营面。对齐前端 **§11.10**(`/events`:§11.10.3 8 种 EventKind / §11.10.2 页面结构 / §11.10.6 Trackable vs Decorative 真任务化引擎)+ **§9.11c.2**(`GET /api/events?status=ongoing&region=`「季度活动滚动」)。服务业务目标:用限时折扣 / 邀请挑战 / 抽奖 / 区域 PK 等活动卡形成「周期性回访 + 独立 conversion hook」;活动卡内的任务 CTA 引导用户产生 `store.viewed` / `checkout.completed` 这些 B3 漏斗级事件(行为驱动),并通过回访→`app.dau` 路径间接提升 Day7 活跃(KPI #2 口径为 `app.dau ÷ register cohort`,§2.4.6;本机制经回访间接贡献,非 KPI 直接口径);每个 trackable 活动接真平台状态(§11.10.6 `evaluateEventProgress`),完成直接 `creditNex` + unlock badge。
> **域边界(H4 活动运营 vs V4 I 通用 CMS,§3.14 标注)**:**H4 管限时活动与活动追踪**(campaign / 活动位:EventKind 枚举 / featured / trackable progress / 活动奖励 / 倒计时 / geo 区域 / wheel 转盘奖项池);**V4 I 域管通用内容**(通用文章 / 营销 banner / 合规法务文案 / i18n namespace 多版,前端 §9.11c.2 `GET /i18n/{namespace}`)。二者在 **§3.14 跨域归属补一行**:`活动运营 → H4(V3);通用内容 CMS → I(V4)`。交集处理:活动卡内嵌的营销文案若属可独立 A/B 的通用 copy,文案池归 I,活动结构(kind / reward / progress / 时窗)归 H4;H4 引用 I 的文案 key,不重复持有通用 copy 权威。

**② 后台界面**:
- **活动列表**(§11.10.5,server-canonical):`id / kind(8 枚举)/ status(ongoing/upcoming/ended)/ title / subtitle / ribbon / emoji / tint / reward(USDT/NEX)/ featured / trackable?/ progress / countdown / startsIn / joined 计数 / claimed 计数 / href`。
- **活动详情 / 编辑**:单活动全字段编辑 + Featured Hero 主推位指派(同时仅 1 个 featured,§11.10.2)+ trackable 活动的 evaluator 绑定(§11.10.6:`evaluateEventProgress` 字段 / target / 奖励 NEX / badge id)。
- **Trackable 监控**(只读):4 个 trackable 活动(§11.10.6)的真实 progress 分布 + join / done / claim 漏斗:`evt-pro-upgrade-7d`(target 1·2,000 NEX)/ `evt-refer-5-get-pro`(target 5·5,000 NEX)/ `evt-onboarding-7d`(target 4·200 NEX)/ `evt-nex-holders-share`(target 1,000·500 NEX)。
- **Lucky Spin 转盘治理**(`wheel` EventKind,server-canonical RNG):转盘奖项池 + 各奖项概率 + 派奖;含两类 wheel 入口——`evt-spring-spin`(日重置型:`events.ts:116-125`,subtitle「1 free spin per day」,ribbon「DAILY · RESETS 00:00 UTC」,每日一次)+ `evt-anniversary-spin`(周年型:`events.ts:188+`,status=ended,周年活动)。**✅ 转盘奖项池 / 概率已裁定(PM 2026-06-02,见 ③ Lucky Spin 奖池表 + 护栏)**;原型仅 §11.10.3 `wheel` 枚举、无 prize pool / 概率,本配置面为净新落地。**Genesis 节点不进转盘 + 真实奖受日预算/库存/B1 红线三护栏**(风险最低)。H5 签到 milestone 发「spin 票」,H4 wheel 治理「票兑奖的奖项池 / 概率 / 派奖」,两入口经「spin 票」凭证解耦。
- **geo / 区域面**:活动 `region` 过滤(§9.11c.2)+ `geo_block` 国家清单(随活动配置,边缘 IP 判定,§9.11d.1 通用 region geo-block 在活动面的派生)。
- **状态机**(活动,§11.10.4,server-canonical):`upcoming(Starts in X·Notify-me)→ ongoing(全亮·Join/Claim)→ ended(可查历史)`;trackable 用户参与旁路(§11.10.7):`未 join → joined(useEventQuest.join)→ done(progress 达 target)→ claimed(creditNex + unlock badge)`。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| 活动 `kind`(8 枚举) | **现状值(§11.10.3 / `events.ts:8-16`)**:`discount / referral / wheel / regional / boost / seasonal / holding / onboarding` | 8 枚举闭集(新增 kind 须前后端 schema 联动,见下注) | 仅新建 / 改活动 | §11.10.3 活动类型 chip + 标签 |
| 活动 `status` | **现状值(§11.10.4)**:ongoing / upcoming / ended | 3 枚举 | 实时(状态切换即改卡视觉与可点性) | §11.10.4 卡片视觉 + 行为 |
| `featured`(主推位) | **现状值(§11.10.2)**:默认 `evt-pro-upgrade-7d`(NexionBox Pro Flash Upgrade) | 同时仅 1 个 true | 实时 | §11.10.2 Featured Hero 大卡 |
| 活动奖励(USDT / NEX) | **现状值(§11.10.6 trackable)**:pro-upgrade 2,000 / refer-5 5,000 / onboarding 200 / nex-holders 500 NEX | ≥ 0 | 仅新 claim(已 done 未 claim 按当前值) | 活动卡 `Claim +N NEX` |
| trackable evaluator 绑定 | **现状值(§11.10.6)**:`ctx.ownsProOrHigher` / `ctx.directInviteCount(≤5)` / `ctx.vRank(7d内达V2)` / `ctx.nexBalance(≤1,000)` | evaluator 字段 + target | 仅新 join | 活动 progress bar |
| Lucky Spin 转盘奖池(档位 + 概率,`wheel`)| **✅ 已裁定(PM 2026-06-02),见下方 Lucky Spin 奖池表**(初始 8 档 · EV≈$0.73/spin · Genesis 不进转盘) | **档位可增删 2-12 档**;各档概率(weight)之和 = 100(server 校验,≠100 或档位越界返 422) | 实时(server 裁决) | `evt-spring-spin` 日重置转盘 / `evt-anniversary-spin` 周年转盘 |
| `countdown / startsIn`(时窗) | per-event(UTC,§11.10.2「Events run on UTC time」) | 起止时间戳 | 实时(到期自动转 ended) | 卡倒计时 / 开始时间 |
| `region` / `geo_block` | 空(全区) | 国家码数组 | 实时(边缘 IP 判定) | §9.11c.2 region 过滤 / geo 拦截 |
| 活动 pause(下架) | 关 | bool | 实时(下架即停 join/claim) | 活动卡熔断 / 隐藏态 |

> **默认值口径**:8 EventKind / featured / trackable 奖励取前端现状值(标注「现状值」);wheel 转盘奖项池 / 概率 ✅ 已裁定(PM 2026-06-02,见下方 Lucky Spin 奖池表;治理归属见 §① 域边界);12 月 §6 未覆盖活动配置。**升活动 NEX 奖励 = 放大流出**,受跨域事实 2 的 B1 红线前置约束。`geo_block` 为 §9.11d.1 通用 region geo-block 在活动面派生,kill 矩阵编排归 J1(V4)。
> **EventKind / evaluator 扩展治理**:新增 EventKind / evaluator 字段属前后端 schema 联动变更,须经操作确认(确认弹窗 + 理由必填)+ 前端 ctx 同步发布(类比 A4 domain 扩展工单),非后台单方可加。

> **Lucky Spin 奖池表(PM 2026-06-02 裁定 — 风险最低 + 运营最简口径)**:转盘机制原型未实现(§11.10.3 `wheel` 仅枚举),本表为 PM 裁定的净新落地口径。**一个转盘、一张奖池表**——`evt-spring-spin`(日重置)与 `evt-anniversary-spin`(周年型)复用同一奖池,仅活动外壳 / 文案不同,不分两套奖池。
>
> **spin 票来源(统一,运营最简)**:① 每日 1 次免费 spin(`evt-spring-spin`,UTC 00:00 重置);② H5 签到连胜满 30 天里程碑额外 +1 张 bonus spin(进**同一**转盘,§Ch13 H5 里程碑;H5 仅发票、H4 持奖池)。两来源都消费同一 `POST /api/events/:id/spin` + 同一奖池表,**不另立第二套转盘 / 第二张奖池**。

| 档 | 奖项 | 内容 | 默认概率 | 性质 / 成本 |
|---|---|---|---|---|
| 1 | 安慰奖 | +5 NEX | 38% | 平台内代币,近零成本 |
| 2 | 小积分 | +50 积分 | 24% | 平台内,引导复投 |
| 3 | 小 NEX | +30 NEX | 18% | 平台内 |
| 4 | 中 NEX | +150 NEX | 11% | 平台内 |
| 5 | 小额 USDT | $1 USDT | 5% | 真实流出(受护栏) |
| 6 | 购机抵扣券 | $50 抵扣券(仅抵购机款 / 不可提现) | 3% | 转化导向,非现金流出 |
| 7 | 中额 USDT | $20 USDT | 0.9% | 真实流出(受护栏) |
| 8 | 大奖 USDT | $500 USDT | 0.1% | jackpot / 社会证明(受护栏) |

> **Genesis 整台节点不进转盘**(PM 2026-06-02:免费送 $9,999 节点风险过高、与日免费转盘节奏不符)。真实 USDT 流出 EV ≈ **$0.73/spin**(0.05×$1 + 0.009×$20 + 0.001×$500 = $0.05 + $0.18 + $0.50 = **$0.73**,逐项展开本档贡献),日免费转盘可承受;$50 券为购机抵扣不计现金流出。**前端 `evt-spring-spin` subtitle「win $1–$500 USDT or a Genesis Node」须删「or a Genesis Node」**。
>
> **风险护栏(3 个全局参数 + B1 自动降级,运营只调这几项):**

| 护栏参数 | 默认值 | 作用 |
|---|---|---|
| `wheelDailyPayoutBudgetUSD`(日派彩预算上限) | $2,000 | 全站当日转盘真实 USDT 派彩累计达上限 → 真实奖档(5/7/8)当日关闭、只发 NEX/积分/券,次日 UTC 重置 |
| `wheelPrizeDailyCap`(单奖每日全局库存) | $500 奖 5 次/日 · $20 奖 50 次/日 · $50 券 200 张/日 | 单档真实奖当日全站中出达上限 → 该档关闭、概率按比例并入安慰档(防集中爆奖) |
| `wheelRealPrizeEnabled`(真实奖总开关) | 开 | kill 开关:关闭则真实奖档(5/7/8)停发、只剩 NEX/积分/券档(应急 / 监管一键止血,联动 J1 矩阵) |

> **B1 兑付覆盖率红线自动降级(核心风险控制)**:server 每次 spin 裁决前核 B1 覆盖率;**低于红线(`coverageRedLine` 默认 100%)→ 自动降级为「仅 NEX/积分/券档」**(真实 USDT 档 5/7/8 当次不参与裁决、概率并入安慰档),无需人工干预,覆盖率回升自动恢复——把转盘真实流出与平台兑付安全硬绑定。
> **server RNG + NODE_ENV guard**:中奖裁决 100% server 执行(`POST /api/events/:id/spin`),概率表 server 持有,client 永不可知概率 / 不 roll;生产环境 RNG 严禁落客户端随机函数(对齐 G4 分红 / H5 Lucky multiplier 口径)。每日上限按 `eventId × userId × spinDate`(UTC 日桶)server 计票、超额返 409(§⑦)。
> **档位可增删(运营可配,非固定 8 档)**:奖池档位数**非硬编码 8**——运营可**增 / 删 / 改**档位(**2-N 档,N ≤ 12** 受转盘 UI 可读上限约束),每档可改 `奖项类型(kind)/ 金额(amount)/ 概率(weight)/ 是否真实奖(isReal)/ 文案(labelKey)`;**增删档后须重新分配各档 weight 使之和 = 100**,否则 `PUT .../wheel` 返 422。默认 8 档(EV≈$0.73/spin,5/7/8 档真实奖逐项贡献:$1×5% = $0.05,$20×0.9% = $0.18,$500×0.1% = $0.50)为 PM 2026-06-02 裁定的**初始配置**,不是上限或下限。**EV 值随 WHEEL_TIERS[isReal=true] 派生**,改任一档真实奖概率/金额则总 EV 自动更新(`Σ wheel[real].amount × wheel[real].weight ÷ 100`,运营端在改奖池弹窗内可见实时预览)。新增真实奖档(isReal=true)同样受三护栏 + B1 红线 + 操作确认(确认弹窗 H4-MD4 + 理由必填)约束。
> **改奖池 / 概率 / 护栏**:一律经确认弹窗 H4-MD4(理由必填+B1 红线预检,执行=财务(lead)/ 超管)+ 提交即过 B1 + 落 `admin.event_wheel_changed` 审计(§④);经专属端点 `PUT /api/admin/events/:id/wheel`(§⑤);概率和 ≠ 100% 或档位数越界 [2,12] server 拒绝(422)。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 新建 / 上下架活动 | 增长(lead)/ 超管(2026-06 操作确认决议,原复核层级就高;内容角色保留草稿编辑,上架经增长(lead)执行) | H4-MD1(理由必填) | `admin.event_published`(event id / kind / status 前后 / operator) |
| 指派 / 撤销 featured | 增长(lead)/ 超管 | H4-MD2(理由必填;featured 唯一性 server 校验,违反返 422) | `admin.event_featured_changed`(前 featured / 新 featured / operator) |
| 改活动奖励 / trackable evaluator | 财务(lead)/ 超管(放大方向原复核 = 财务主管就高) | H4-MD3(理由必填+B1 红线预检(升奖励方向)) | `admin.event_reward_changed`(event id / 前后奖励 / coverageAtSubmit / operator) |
| 改 Lucky Spin 转盘奖池(**增删档位 / 改概率 / 改护栏**,经 `PUT .../wheel`) | 财务(lead)/ 超管 | H4-MD4(理由必填+B1 红线预检(放大流出 + 概率型);weight 和≠100 或档位∉[2,12] 返 422) | `admin.event_wheel_changed`(前后档位集 / 概率 / 护栏 / coverageAtSubmit / operator) |
| 设 / 改 region / geo_block | 风控 / 合规(lead)/ 超管(收紧方向,体例同 A3-MD4) | H4-MD5(理由必填) | `admin.event_geo_changed`(event id / 国家清单 / operator) |
| 查看活动列表 / tracking / 转盘监控 | 全角色(按可见性裁剪) | 否(只读) | — |

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 新建 / 上下架活动 | ② 活动列表工具栏「新建」/ 行内「上架/下架」 | 主按钮 / 行内按钮 | 仅增长(lead)/ 超管渲染(内容角色仅见草稿编辑) | 打开弹窗 H4-MD1 |
| 指派 / 撤销 featured | ② 活动详情「设为主推」/ 当前 featured 卡「撤销主推」 | 行内按钮 | 仅增长(lead)/ 超管渲染;ended 活动置灰 | 打开弹窗 H4-MD2 |
| 改活动奖励 / evaluator | ② 活动详情奖励 / evaluator 区「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H4-MD3 |
| 改转盘奖池 / 护栏 | ② Lucky Spin 转盘治理面「编辑奖池」 | 次按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H4-MD4 |
| 设 / 改 region / geo_block | ② geo / 区域面「编辑国家列表」 | 行内按钮 | 仅风控 / 合规(lead)/ 超管渲染 | 打开弹窗 H4-MD5 |
| 查看 tracking / 转盘监控 | ② Trackable 监控 / 转盘治理 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [H4-MD1] 活动上下架确认
- **功能**:新建活动(全字段)或切换活动 status(upcoming/ongoing/ended、上架 / 下架),确认即生效(下架即停 join/claim)。
- **布局结构**:1. **信息区**:活动 id / kind / 当前 status / joined·claimed 计数(server 派生)。2. **影响预览区**:status before→after;下架时警示行「下架后该活动 join/claim 即时拒绝,已 claim 不回收」;新建时展示全字段摘要。3. **输入区**:目标 status 单选(③ 表 3 枚举)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认执行(提交 loading 锁定)。
- **错误态**:400 `REASON_REQUIRED` / 409(status 已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;活动列表行就地更新;toast「活动状态已生效 · 已记审计」;事件 `admin.event_published`;实时告警超管 + 增长 lead。

##### [H4-MD2] Featured 主推位变更
- **功能**:指派 / 撤销 Featured Hero 主推位(同时仅 1 个 featured,§11.10.2),确认即实时生效。
- **布局结构**:1. **信息区**:当前 featured 活动 / 拟指派活动(id / kind / status)。2. **影响预览区**:前 featured → 新 featured 并排;提示「原主推卡自动降级为普通卡」;指派 ended/upcoming 活动时内联警示。3. **输入区**:目标活动选择(下拉,仅 ongoing 活动)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422(featured 唯一性违反 / 目标活动非 ongoing,server 校验)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;Featured Hero 就地切换;toast「主推位已生效 · 已记审计」;事件 `admin.event_featured_changed`;实时告警超管 + 增长 lead。

##### [H4-MD3] 活动奖励 / evaluator 变更
- **功能**:修改活动奖励(USDT/NEX)或 trackable evaluator 绑定(字段 / target / badge id),确认即生效(仅新 claim,已 done 未 claim 按当前值)。
- **布局结构**:1. **信息区**:活动 id / 当前奖励 / evaluator 绑定 / 当前 join·done·claim 漏斗(② Trackable 监控同源)。2. **影响预览区**:before→after 并排;升奖励方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);改 evaluator 时提示「仅新 join 生效,在途参与按 join 时绑定结算」。3. **输入区**:目标奖励(数字输入,≥ 0,③ 表)+ evaluator 字段 / target 编辑(枚举下拉 + 数字输入,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(evaluator 字段不在 ctx 枚举)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;活动详情就地更新;toast「奖励已生效 · 已记审计」;事件 `admin.event_reward_changed`;实时告警超管 + 财务 lead。

##### [H4-MD4] Lucky Spin 转盘奖池变更
- **功能**:增删改转盘奖池档位(kind / amount / weight / isReal / labelKey)与三护栏(`wheelDailyPayoutBudgetUSD` / `wheelPrizeDailyCap` / `wheelRealPrizeEnabled`),确认即实时生效(server 裁决即用新表)。
- **布局结构**:1. **信息区**:当前档位表(8 档全列)/ 当前 EV($/spin,server 派生)/ 当日已派彩 vs 预算 / 三护栏现值。2. **影响预览区**:前后档位集 diff(增删档高亮)+ 「拟生效后 EV」对比行;weight 和实时合计条(≠100 内联红条,确认钮置灰);含真实奖档(isReal=true)调升时 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);`wheelRealPrizeEnabled` 关闭时警示行「真实奖档(5/7/8)停发,只剩 NEX/积分/券档」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 档位编辑(增删改) | 行内可编辑表格(kind 枚举下拉 / amount / weight / isReal 开关 / labelKey) | 是 | 档位数 ∈ [2,12];weight 之和 = 100;amount ≥ 0(③ 表) | 当前档位表 |
| `wheelDailyPayoutBudgetUSD` | 数字输入(USD) | 改该项时必填 | > 0(③ 护栏表) | 当前值($2,000) |
| `wheelPrizeDailyCap` | 数字输入组(逐真实奖档) | 改该项时必填 | ≥ 0(③ 护栏表) | 当前值 |
| `wheelRealPrizeEnabled` | 开关 | 改该项时必填 | bool | 当前值(开) |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(weight 和≠100 / 档位越界 / 真实奖调升预检低于红线时置灰;提交 loading 锁定,携 `Idempotency-Key`)。
- **错误态**:422(weight 和≠100,server 回传合计值)/ 422(档位数∉[2,12])/ 422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 400 `REASON_REQUIRED` / 409(奖池已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;转盘治理面就地更新;toast「奖池已生效 · 已记审计」;事件 `admin.event_wheel_changed`;实时告警超管 + 财务 lead;同步 J1 矩阵(`wheelRealPrizeEnabled` 关闭时)。

##### [H4-MD5] 活动 region / geo_block 配置
- **功能**:编辑活动 `region` 过滤 / `geo_block` 国家清单(边缘 IP 判定),确认即 server enforce。
- **布局结构**:1. **信息区**:活动 id / 当前 region / geo_block 列表(国家码 chip 集)。2. **影响预览区**:本次 diff(新增屏蔽 / 解除屏蔽两组 chip 并排);新增屏蔽国家展示该国当前参与用户数(server 派生);解除屏蔽提示行「解除屏蔽将恢复该国用户参与(放大方向)」。3. **输入区**:国家列表多选搜索框(ISO 国家码;与当前列表相同则确认钮置灰)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:400 `REASON_REQUIRED` / 409(列表已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;geo 面就地更新;toast「区域配置已生效 · 已记审计」;事件 `admin.event_geo_changed`;实时告警超管 + 风控 lead。

**⑤ 接口**(`GET` 配置源收敛 §9.11c.2):
- `GET /api/events?status=&region=` — 活动列表(按状态 / 区域筛);**server-canonical**(§9.11c.2),前端 §11.10 读此。
- `GET /api/admin/events/:id/tracking?cursor=` — trackable 活动 join/done/claim 监控(server 权威参与台账)。
- `POST /api/admin/events` / `PUT /api/admin/events/:id` — 新建 / 改活动(经确认弹窗 H4-MD1/MD2/MD3/MD5,reason 必填(空值 400 `REASON_REQUIRED`);**升奖励 server 先核 B1,< 红线返 422**;**改 featured 时 server 强制 featured 唯一性,违反返 422**)。
- `POST /api/admin/events/:id/{publish|unpublish}` — 上下架(经确认弹窗 H4-MD1,reason 必填)。
- `POST /api/events/:id/spin` — Lucky Spin 转盘派奖(**server-canonical RNG** 裁决奖项;奖项池 / 概率已裁定 §③ 奖池表;server 强制日派彩预算 / 单奖每日库存 / B1 红线自动降级三护栏 + `spinDate` 日桶计票超额 409)。
- `PUT /api/admin/events/:id/wheel` — **Lucky Spin 转盘专属配置端点**(奖池档位 + 各档概率 + 三护栏,从通用 `PUT /api/admin/events/:id` 拆出,因奖池为结构化大对象,独立端点便于校验与审计);payload `{ segments: [{ id, kind: "nex"|"points"|"usdt"|"coupon", amount, weight, isReal, labelKey }], guardrails: { wheelDailyPayoutBudgetUSD, wheelPrizeDailyCap, wheelRealPrizeEnabled } }`;经确认弹窗 H4-MD4(reason 必填,执行=财务(lead)/ 超管);**server 三重校验**:① 各档 `weight` 之和 = 100(违反返 **422**)② 档位数 ∈ [2, 12](越界返 422)③ 含真实奖档(`isReal=true`)的放大流出须先过 B1 红线(< 红线返 **422** + 当前覆盖率);幂等 `Idempotency-Key`;放行落 `admin.event_wheel_changed` 审计(§④)。

**⑥ 权限 & 审计**:
| 角色 | 查看活动/tracking | 上下架 | 改 featured | 改奖励/evaluator/转盘 | 改 geo |
|---|---|---|---|---|---|
| 增长 | ✅ | ✅(lead) | ✅(lead) | — | — |
| 内容 | ✅ | 草稿编辑(上架经增长 lead) | — | — | — |
| 财务 | ✅ | — | — | ✅(lead) | — |
| 风控/合规 | ✅ | — | — | — | ✅(lead) |
| 超管 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):上下架 / featured 原复核 = 增长主管,就高为增长(lead)/ 超管;奖励 / evaluator / 转盘为放大方向,原复核 = 财务主管就高(财务(lead)/ 超管 + B1 红线预检);geo 为收紧方向,风控 / 合规(lead)/ 超管。

审计字段(A2 统一 schema,§2.x ⑥):`action / event_id / kind / field / before / after / coverageAtSubmit(改奖励/转盘时) / geo_block / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:trackable 活动 progress + join/claim 态 server 权威;前端 §11.10.6 `useEventQuest`(persist key `nexion-event-quest-v1`)+ `evaluateEventProgress` 当前 client 评估,**真后台对接后 progress 由 server 按真实平台状态(`ownsProOrHigher` / `directInviteCount` / `vRank` / `nexBalance`)裁决**,client 仅展示;decorative 活动的 `joined` 为 `events.ts` hardcode 展示字段,无权威态。**防伪造完成**:client 不得本地标记 trackable progress 达标或伪造 claim(§9.11d.2)。
- **转盘 server-canonical RNG + 三护栏(`wheel`)**:Lucky Spin 随机裁决须 server 执行(`POST /api/events/:id/spin`)+ NODE_ENV guard,client 不 roll / 不可知概率(§9.11d.3);奖项池 / 概率已裁定(§③ 奖池表),受**日派彩预算上限 / 单奖每日全局库存 / B1 覆盖率红线自动降级(低于红线只发 NEX/积分/券档)**三护栏约束;Genesis 不入转盘。
- **NEX 流出联动 B1(跨域事实 2)**:活动 `event.claimed` 的 NEX 派发(如 refer-5 的 5,000 NEX)增 NEX 流出;升活动奖励 / 转盘奖项提交即 server 核验 B1 覆盖率红线。
- **跨模块联动**:trackable evaluator 消费的真实状态来自多域——`ownsProOrHigher`(E 设备 / 商城,V2)/ `directInviteCount`(F 分销 / 团队,V2)/ `vRank`(F V-Rank,V2)/ `nexBalance`(G 代币,V3);H4 只读消费,不持这些状态权威。活动内嵌 CTA 跳转(折扣→商城 / 邀请→团队 / 抽奖→转盘)联动下游域转化。
- **幂等 & 并发裁决(§9.11e)**:活动 claim / 转盘派奖携 **`Idempotency-Key`**(§9.11e 通则,沿用作 V3 新登记事务边界行,§9.11e 表当前未含 event 行)去重,**dedup key 维度区分两类**:(a) 一次性活动 claim(trackable `done`→`claimed`)去重 `eventId × userId`;(b) 每日重置 spin(`wheel` daily,如 `evt-spring-spin`)去重 `eventId × userId × spinDate`(UTC 日桶),显式声明「每日一次上限 = server 按 `spinDate` 计票,超额返 **409**」,体例对齐 G4 batchDate(§9.11e)——纯 `eventId × userId` 会误锁次日合法 spin,纯 UUID 又无法强制每日一次上限,故须 `spinDate` 维度。竞态 `done → claimed` 与活动 `ongoing → ended`(时窗滚动 / 下架)以 server 终态为准——**ended/下架锁定优先**:活动转 ended 后并发到达的 claim 按 §11.10 现状(ended 卡可查历史,不可新 claim)返 **409**;配置变更对 in-flight 参与按 join / 派发时锁定值结算(不追溯)。
- **kill 联动 J1(V4)**:活动 pause / 下架 + geo_block 是 J1 矩阵生效面(监管点名某类活动如「抽奖涉赌」时批量下架转盘)。

**⑧ 埋点(事件)**:
- **产生(活动 server)**:`event.joined`(trackable 用户 opt-in)· `event.progressed`(progress 跨阶段,可选)· `event.claimed`(reward NEX / badge;`is_server_authoritative=true`)—— `event.*` 全部为新增,走 §2.4.8 schema 变更确认流程(仅超管经 A2-MD1 确认弹窗执行)注册 registry。
- **产生(admin 审计)**:`admin.event_published` · `admin.event_featured_changed` · `admin.event_reward_changed` · `admin.event_wheel_changed` · `admin.event_geo_changed`(A2 审计,归 §2.4.5 ⑥ admin family)。
- **domain 状态(blocking)**:`event` **不在** §2.4.3 domain 枚举内(V1 §2.4.3 现行登记不含 `event`)→ **须向 A4 申请 domain 枚举扩展(§2.4.3),blocking 依赖,登记为 V3 起始工单(sprint 开始即发起)**(体例参 V2 `order` domain 起始工单 / V3 G3 `nex`)。占位选择依据:`event.*` 本质是用户侧留存 / engagement 事件,但 §2.4.5 ④ engagement family 现成员(`app.dau` / `daily.checkin` / `quest.completed` / `nova.*`)为 V1 固定清单,不含 event 类宿主;在扩展落地前 H4 活动事件**暂记 `admin` family 占位、临时编号**(体例锚 V1 §2.4.5⑥ `admin.coverage_threshold_breached` 归 admin family 的占位范式),`is_server_authoritative=true`(§2.4.4)资金 / 状态事件不受 family 占位影响其 B3 / KPI 权威口径,扩展后迁回 `event.*`。**过渡期 BI 兜底**:占位期 BI 对 Day7 留存 / B3 漏斗显式 union admin family 中 `is_server_authoritative=true` 且 `object_action ∈ {event.*}` 的临时编号事件,或在 §2.4.8 工单将 domain 扩展列为 V3 sprint-0 must-finish-before-BI-cutover。
- **喂给**:分两层——(a) 活动 CTA 引导用户产生 `store.viewed` / `checkout.completed` 这些 B3 漏斗级事件(行为驱动,非 `event.*` 事件本身入漏斗)→ B3 留存 / 注册→首购漏斗(§2.4.7);(b) `event.joined` / `event.claimed` 事件本身喂活动效果 BI(L 域:各 EventKind 的 join→claim CVR)+ `app.dau` 回访(经 §2.4.6 KPI #2 间接),**不进 B3 漏斗主图**;奖励审计 → B1 覆盖率影响评估 + J1(V4)。

---

#### [H5] 签到 & 积分
**① 目的 & 对齐**: 配置每日签到的积分规则、Lucky 概率倍率、30 天里程碑路线图、Streak Saver 断签复活卡、Streak Power-Ups 连胜增益,作为留存节奏的签到引擎。对齐前端 **§9.8**(`/daily`:§9.8.1 签到规则 + Lucky multiplier / §9.8.2 30 天里程碑 / §9.8.3 Streak Saver / §9.8.6 Streak Power-Ups)+ **§9.11c.1**(`POST /api/points/sign-in` 返 multiplier「A/B 实验值」)+ **§9.11d.3**(Lucky multiplier「必须 server-driven」,锚 `lib/v3/points.ts:87-88`)。服务业务目标:用每日签到 + 连胜里程碑形成留存激励的回访节奏(§9.8.2:累计连胜越久,里程碑路线图越临近),通过回访→`app.dau` 路径**间接**提升 Day7 活跃(KPI #2 口径为 `app.dau ÷ register cohort`,§2.4.6;本机制经回访间接贡献,非 KPI 直接口径)。**Lucky 概率是概率型奖励,必须 server-canonical RNG**(跨域事实 1);Day-30 里程碑发放一张转盘票(spin 票),转盘奖项池 / 概率 / 派奖治理归 H4(`wheel` EventKind);Streak Power-Ups 含跨域奖励(F2/G5/G1/G4),H5 是触发面。

**② 后台界面**:
- **签到规则配置面**(§9.8.1):baseline 积分 / 7 天连续 bonus / Lucky 15% → 1.5× / Lucky 5% → 2× / 断签阈值(>48h)/ Streak Saver 恢复上限(30 天)。
- **30 天里程碑配置面**(§9.8.2,7 阶梯):`Day 阈值 / 奖励 / 类型(points/usdt/nex/spin/badge)`——Day3 +5 积分 / Day7 +15 积分 / Day14 +1 USDT / Day21 +100 NEX / Day30 🎰 Lucky Spin 票(转盘治理归 H4)/ Day60 +10 USDT / Day100 ⭐ Streak Master Badge(NFT)。
- **Streak Power-Ups 配置面**(§9.8.6,4 档,`streak-powerups.ts:32-69`):`streak 阈值 / 增益名 / 转化路径 / badge`——7 天 Royalty Boost(→ F2 unilevel,href `/team/unilevel/how-it-works`)/ 14 天 Premium 7-day free trial(→ G5,href `/me/wallet/premium`)/ 30 天 +2% APY on next stake(→ G1,href `/staking`)/ 60 天 Genesis whitelist priority(→ G4 Genesis,href `/genesis`)。
- **签到监控**(只读,server-canonical):签到率 / streak 分布(7/14/30/60/100 天分段人数)/ Lucky 触发分布(1.5× / 2× 命中率实测 vs 配置)/ Streak Saver 消耗量 / 各里程碑 claim 分布。
- **状态机**(签到 streak,server-canonical):`signed_today → (次日)pending → signed`;断签旁路:`signed → broken(>48h 未签·streak 归 0)→ restored(消耗 1 Streak Saver·恢复至 min(longestStreak,30))`。里程碑:`locked(Xd to unlock)→ claimable(streak ≥ 阈值派生态)→ claimed`。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| 签到 baseline 积分 | **现状值(§9.8.1 / `points.ts:84`)**:+1 贡献积分 / 日 | ≥ 0 | 实时(下次签到生效) | §9.8.5 签到主 CTA |
| 7 天连续 bonus | **现状值(§9.8.1 / `points.ts:85`)**:+5 积分 | ≥ 0 | 实时 | §9.8.5 日历 Sun 第 7 天 |
| **Lucky 1.5× 概率** | **现状值(§9.8.1 / §9.11d.3 / `points.ts:88`)**:15% | 0–100%;且 `p(1.5×)+p(2×) ≤ 100%`,余为 baseline 1.0× | 实时(server 裁决,§9.11d.3) | §9.8.5 副字 `15% chance of 1.5×`(UI 公示) |
| **Lucky 2× 概率** | **现状值(§9.8.1 / §9.11d.3 / `points.ts:88`)**:5% | 0–100%;且 `p(1.5×)+p(2×) ≤ 100%`,余为 baseline 1.0×;server 校验和 >100% 返 **422** | 实时(server 裁决) | §9.8.5 副字 `5% chance of 2×`(UI 公示) |
| 断签阈值 | **现状值(§9.8.1 / `points.ts:82`)**:>48h 未签 → 重置 0 | ≥ 24h | 实时 | §9.8.3 Saver 按钮亮起判定 |
| Streak Saver 默认持有 / 恢复上限 | **现状值(§9.8.3 / `points.ts:66,127`)**:默认 1 张 / 恢复至 `min(longestStreak,30)` | ≥ 0 张 / 上限 ≤ 30 天 | 实时 | §9.8.3 复活卡余量 + 恢复值 |
| 30 天里程碑 7 阶梯(阈值 / 奖励 / 类型) | **现状值(§9.8.2)**:3/+5积分 · 7/+15积分 · 14/+1USDT · 21/+100NEX · 30/Lucky Spin 票 · 60/+10USDT · 100/Badge | 阶梯可增删改;奖励 ≥ 0 | 仅新达成(已 claimable 按当前值) | §9.8.2 里程碑路线图 7 行 |
| Streak Power-Ups 4 档(§9.8.6) | **现状值(`streak-powerups.ts:32-69`)**:7d Royalty Boost / 14d Premium trial / 30d +2% APY / 60d Genesis whitelist | 阈值 + 增益值可改 | 实时(streak 达阈值即解锁) | §9.8.6 4 行 conversion-tied unlock |

> **默认值口径**:积分 / Lucky 概率 / 里程碑 / Streak 规则取前端现状值(标注「现状值」);12 月 §6 未覆盖签到参数。**升 Lucky 概率 / 升里程碑 NEX·USDT 奖励 / 升 Power-Up 增益 = 放大流出**,受跨域事实 2 的 B1 红线前置约束。**Lucky 1.5×/2× 是概率型机制**,数值改动同时受 server-canonical RNG 约束(⑦);两 Lucky 概率约束对称——`p(1.5×)+p(2×) ≤ 100%`,余为 baseline 1.0×,server 校验和 >100% 返 422(与 B1 红线 422 体例并列);可选加单项软上限(如 ≤50%)防极端配置,附 PM 决议 ref(体例同 G4 分红率偏离基准)。Day-30 转盘奖项池 / 概率治理归 H4。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改 baseline / 7天 bonus / 断签阈值 / Saver 规则 | 增长(lead)/ 超管(2026-06 操作确认决议,原复核层级就高为执行门槛) | H5-MD1(理由必填) | `admin.checkin_rules_changed`(字段 / 前后值 / operator) |
| **改 Lucky 概率(1.5× / 2×)** | 财务(lead)/ 超管(放大方向原复核层级就高) | H5-MD2(理由必填+B1 红线预检(调升方向);和 >100% 返 422;改后 server RNG 即用新概率) | `admin.checkin_lucky_prob_changed`(前后概率 / coverageAtSubmit / operator) |
| 改 30 天里程碑奖励 / 阶梯 | 财务(lead)/ 超管 | H5-MD3(理由必填+B1 红线预检(升 NEX/USDT 奖励方向)) | `admin.checkin_milestone_changed`(阶梯 / 前后奖励 / coverageAtSubmit / operator) |
| 改 Streak Power-Ups(跨域增益) | 财务(lead)/ 超管 | H5-MD4(理由必填+B1 红线预检(增益调升方向);改后联动下游域兑现) | `admin.checkin_powerup_changed`(档位 / 前后增益 / 下游域 ref / coverageAtSubmit / operator) |
| 查看签到规则 / 监控 | 全角色(按可见性裁剪) | 否(只读) | — |

> Day-30 转盘奖项池 / 概率的操作动作归 **H4**(`admin.event_wheel_changed`),不在本表;H5 仅配置「Day-30 发放一张 spin 票」的里程碑奖励行(走上方里程碑动作)。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改基础规则(baseline / bonus / 断签 / Saver) | ② 签到规则配置面参数卡「编辑」 | 行内按钮 | 仅增长(lead)/ 超管渲染 | 打开弹窗 H5-MD1 |
| 改 Lucky 概率 | ② 签到规则配置面 Lucky 区「编辑概率」 | 次按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H5-MD2 |
| 改里程碑奖励 / 阶梯 | ② 30 天里程碑配置面阶梯行「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H5-MD3 |
| 改 Streak Power-Ups | ② Power-Ups 配置面档位行「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H5-MD4 |
| 查看签到监控 | ② 签到监控 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [H5-MD1] 签到基础规则变更
- **功能**:修改 baseline 积分 / 7 天连续 bonus / 断签阈值 / Streak Saver 持有与恢复上限,确认即实时生效(下次签到 / 判定即用新值)。
- **布局结构**:1. **信息区**:当前各规则值 / 当日签到量 / Saver 消耗量(② 监控同源)。2. **影响预览区**:before→after 并排;缩短断签阈值时提示行「将放宽 broken 判定,在签用户下个判定周期生效」。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 baseline 积分 | 数字输入 | 改该项时必填 | ≥ 0(③ 表) | 当前值(+1) |
| 目标 7 天 bonus | 数字输入 | 改该项时必填 | ≥ 0(③ 表) | 当前值(+5) |
| 目标断签阈值(h) | 数字输入 | 改该项时必填 | ≥ 24h(③ 表) | 当前值(48h) |
| 目标 Saver 持有 / 恢复上限 | 数字输入组 | 改该项时必填 | 持有 ≥ 0;上限 ≤ 30 天(③ 表) | 当前值(1 / 30) |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(必填未过校验时置灰;提交 loading 锁定)。
- **错误态**:422(超出 ③ 表范围,server 返回合法区间)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;规则卡就地更新;toast「签到规则已生效 · 已记审计」;事件 `admin.checkin_rules_changed`;实时告警超管 + 增长 lead。

##### [H5-MD2] Lucky 概率变更
- **功能**:修改 Lucky 1.5× / 2× 概率(概率型机制,server-canonical RNG),确认即实时生效(server RNG 即用新概率;UI 公示值同步)。
- **布局结构**:1. **信息区**:当前两概率 / 近 7 天实测命中率 vs 配置(② 监控同源)/ baseline 占比(= 100% − 两概率和)。2. **影响预览区**:before→after 并排 + 「拟生效后概率分布」条;调升方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);两概率和实时合计条(>100% 内联红条,确认钮置灰)。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标 Lucky 1.5× 概率(%) | 数字输入 | 是 | 0–100%;`p(1.5×)+p(2×) ≤ 100%`(③ 表) | 当前值(15%) |
| 目标 Lucky 2× 概率(%) | 数字输入 | 是 | 0–100%;和 ≤ 100%,违反 server 422(③ 表) | 当前值(5%) |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(和 >100% / 调升预检低于红线时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(概率和 >100%,server 回传合计值)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;Lucky 区就地更新(前端 §9.8.5 公示副字同步);toast「Lucky 概率已生效 · 已记审计」;事件 `admin.checkin_lucky_prob_changed`;实时告警超管 + 财务 lead。

##### [H5-MD3] 30 天里程碑配置变更
- **功能**:增删改 7 阶梯(Day 阈值 / 奖励 / 类型),确认即生效(仅新达成,已 claimable 按当前值)。
- **布局结构**:1. **信息区**:当前 7 阶梯全列 / 各阶梯 claim 分布(② 监控同源)。2. **影响预览区**:前后阶梯 diff(增删行高亮);升 NEX/USDT 奖励方向 server 预检「**拟生效后覆盖率**」,低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);阈值保序冲突时内联指出冲突阶梯。3. **输入区**:阶梯行内可编辑表格(Day 阈值 / 奖励值 / 类型枚举 points|usdt|nex|spin|badge;奖励 ≥ 0,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(阈值保序违反)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;阶梯面就地更新;toast「里程碑已生效 · 已记审计」;事件 `admin.checkin_milestone_changed`;实时告警超管 + 财务 lead。Day-30 spin 票对应转盘奖池治理在 H4(H4-MD4)。

##### [H5-MD4] Streak Power-Ups 变更
- **功能**:修改 4 档 Power-Up 的 streak 阈值 / 增益值,确认即实时生效(streak 达阈值即按新档解锁);跨域增益由下游域(F2/G5/G1/G4)兑现。
- **布局结构**:1. **信息区**:当前 4 档(阈值 / 增益 / 下游域 / badge)/ 各档解锁人数(② 监控同源)/ 下游兑现状态标注(V3 落地前仅触点价值,⑦ 现状标注)。2. **影响预览区**:before→after 并排;增益调升方向 server 预检「**拟生效后覆盖率**」(放大下游 F2/G5/G1/G4 流出),低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);展示受影响下游域 chip(落审计 `downstreamDomainRef`)。3. **输入区**:档位选择(4 档)+ 目标阈值(数字输入,天)+ 目标增益值(数字输入,按档类型)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(弹窗不关,内联阻断条)/ 422(超范围)/ 400 `REASON_REQUIRED` / 409 / 403。
- **成功反馈**:弹窗关闭;Power-Ups 面就地更新;toast「Power-Up 已生效 · 已记审计」;事件 `admin.checkin_powerup_changed`;实时告警超管 + 财务 lead;通知下游域 lead(F2/G5/G1/G4 对应域)。

**⑤ 接口**(`GET` 配置源收敛 §9.11c.1 / RNG 收敛 §9.11d.3):
- `POST /api/points/sign-in` — 签到 + **server 裁决 Lucky multiplier 后返 `{ basePoints, multiplier(1/1.5/2), totalPoints, streak }`**;**server-canonical RNG**(§9.11d.3:Lucky multiplier 必须 server-driven,client 不得本地 roll)。
- `GET /api/config/checkin` — 签到规则 + Lucky 概率 + 里程碑阶梯 + Power-Ups 配置(**server-canonical**,前端 §9.8 读此)。**Lucky 概率值在 UI 公示**(对齐 §9.8.5 副字明示 `15% chance of 1.5×` / `5% chance of 2×`,有意暴露的转化文案);server 持有的是**裁决权与权威值**(client 不得本地 roll,§9.11d.3),即「概率公开但裁决在 server」,与防预测无关。
- `GET /api/admin/checkin/stats?window=` — 签到监控(streak 分布 / Lucky 命中率 / Saver 消耗 / 里程碑 claim)。
- `PUT /api/admin/checkin/config` — 改签到规则 / Lucky 概率 / 里程碑 / Power-Ups(经确认弹窗 H5-MD1/MD2/MD3/MD4,reason 必填(空值 400 `REASON_REQUIRED`);**升奖励 / 升概率 / 升增益 server 先核 B1,< 红线返 422**;**Lucky 概率和 >100% 返 422**)。
- **Day-30 转盘派奖接口归 H4**(`POST /api/events/:id/spin`);H5 不定义转盘派奖接口。

**⑥ 权限 & 审计**:
| 角色 | 查看规则/监控 | 改基础规则 | 改 Lucky 概率/里程碑 | 改 Power-Ups |
|---|---|---|---|---|
| 增长 | ✅ | ✅(lead) | — | — |
| 财务 | ✅ | — | ✅(lead) | ✅(lead) |
| 超管 | ✅ | ✅ | ✅ | ✅ |
| 客服 / 只读审计 | ✅(只读) | — | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):基础规则原复核 = 增长主管,就高为增长(lead)/ 超管;Lucky 概率 / 里程碑 / Power-Ups 为放大方向,原复核层级就高(财务(lead)/ 超管 + B1 红线预检(调升方向))。

审计字段(A2 统一 schema,§2.x ⑥):`action / field / before / after / coverageAtSubmit(升奖励/概率/增益时) / downstreamDomainRef(改 Power-Up 时记 F2/G5/G1/G4) / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:streak 连胜计数、longestStreak、里程碑 claim 态、Power-Up 激活态全部 server 权威;前端两 store 独立持久化——`usePoints`(persist `nexion-points-v1`:`signInStreak` / `longestStreak` / `claimedMilestones` / `streakSavers`)+ `useDailyPowerUp`(persist `nexion-daily-powerup-v1`:Power-Up `claimed[]` / `claimedAt`)当前 localStorage 持久化,**真后台对接后 streak / 里程碑 / Power-Up 态以 server 状态机为准,client 仅 UI cache**(§9.8 现状 `mounted` guard 仅防 hydration,非权威源)。**防伪造连胜**:client 不得本地 setState 拉高 `signInStreak` 或伪造里程碑 claim(§9.11d.2 同 Bills / earnings 伪造防御)。**里程碑 claimable 为派生态**:前端 `claimMilestone(day)`(`points.ts:136-146`)以 `signInStreak ≥ 阈值` 派生(非持久化字段)、`claimedMilestones[]` 持久化已领集合,真后台改 server 权威即可,无需新增独立状态机字段。
- **概率型机制 server-canonical RNG + NODE_ENV guard(跨域事实 1;§9.11d.3)**:Lucky 1.5×/2× 随机裁决**必须 server 端执行**——`POST /api/points/sign-in` server roll 后返结果,client 仅展示。**生产环境严禁 client 端随机函数(前端 RNG)**:前端 §9.8 `Math.random()`(`points.ts:87`)仅 `signIn` handler 内 roll 是真后台未接入前的 client 兜底——**§9.11d.3 是唯一主锚**(随机裁决须 server 执行、client 不 roll);§9.11d.2 `NODE_ENV` strip 为**次要补充**,限定为「client 端遗留 `Math.random()` fallback 须 build-time 剥离」(同 `product-phase.ts` `setPinned` 生产 no-op 范式,`product-phase.ts:169`),非「strip 掉即满足 server-canonical RNG」。**防客户端刷 Lucky**:client 不能反复 roll 直到出 2×(server 单次签到单次裁决,§9.11e 幂等去重)。
- **跨域奖励联动(跨域事实 2)**:Streak Power-Ups 触发跨域兑现——7 天 Royalty Boost → **F2 unilevel 费率**(V2,F2 honor 并受 B1 约束)/ 14 天 Premium 7-day trial → **G5 Premium**(V3 Ch12 G5)/ 30 天 +2% APY on next stake → **G1 Staking**(V3)/ 60 天 Genesis whitelist → **G4 Genesis**(V3);**H5 是触发面,下游域兑现并各自受 B1 兑付覆盖率约束**。**`→G5 Premium` 接口边界**:Power-Up 触发的 7-day trial 复用 G5 premium 订阅状态机 / 接口(V3 Ch12 G5),H5 不另立 premium 授予逻辑,使触发面↔兑现面接口边界双向可追溯(G5 改 premium 接口时 H5 引用不失锚)。**现状标注 + 业务杠杆提示**:前端 `lib/store/daily-powerup.ts` `claim` 仅写 `claimed[]` / `claimedAt`、`lib/mock/streak-powerups.ts:32-69` 每档仅持 `threshold/icon/tint/key/href/badgeId`(**无费率 / APY 数值字段**),即**目前仅实现激活 + 跳转目标路由 + 解锁 badge**;**下游 F2/G5/G1/G4 honor 接线为 V3 待落地项,在此之前 Power-Up 仅产生路由跳转 + badge 解锁的留存触点价值,+5% 费率 / +2% APY 等实质增益不兑现**——运营调参时其留存效果应按「触点引导」而非「增益兑付」评估(配了增益但下游零兑现=该杠杆 V3 落地前留存效果为 0,据此调参会误判)。改 Power-Up 增益提交即 server 核验 B1(④ 确认弹窗 H5-MD4 落审计 `downstreamDomainRef`)。
- **NEX/USDT 流出联动 B1(跨域事实 2)**:里程碑 NEX(Day21 +100 NEX)/ USDT(Day14 +1 / Day60 +10 USDT)/ Lucky 倍率放大签到积分→后续提现额度消耗;升 Lucky 概率 / 里程碑奖励提交即 server 核验 B1 红线。
- **幂等 & 并发裁决(§9.11e)**:签到 / 里程碑 claim 携 **`Idempotency-Key`**(§9.11e 通则,沿用作 V3 新登记事务边界行,§9.11e 表当前未含 daily 行)去重(retry 不重复发积分);竞态「同日重复签到」由 server 拒绝(§9.8.1 / `points.ts:78`:同一天不可重复签到,0:00 前不算新一天);Streak Saver 消耗与里程碑 claim 以 server 终态为准。Day-30 转盘票发放属里程碑 claim 的奖励项,转盘本身派奖幂等归 H4。
- **kill 联动 J1(V4)**:签到引擎无独立 kill(§9.11d.1 未列);若 Lucky 涉「概率奖励」监管点名,经 J1 矩阵(V4)处置(转盘停发归 H4)。

**⑧ 埋点(事件)**:
- **产生(签到 server)**:`daily.checkin`(§2.4.5 ④ engagement,`is_server_authoritative=true`;属性含 `streak / multiplier(1/1.5/2) / basePoints`)· `daily.lucky_triggered`(Lucky 命中,属性 `multiplier`)· `daily.milestone_claimed`(里程碑 claim,属性 `day / rewardType / amount`)· `daily.spin_awarded`(Day-30 转盘票发放;转盘派奖事件归 H4 `event.*`)· `daily.powerup_activated`(Power-Up 激活,属性 `tier / downstreamDomain`)—— 派发类 `is_server_authoritative=true`,新增 object_action(`daily.lucky_triggered` / `daily.milestone_claimed` / `daily.spin_awarded` / `daily.powerup_activated`)走 §2.4.8 schema 变更确认流程(仅超管经 A2-MD1 确认弹窗执行)注册 registry。
- **产生(admin 审计)**:`admin.checkin_rules_changed` · `admin.checkin_lucky_prob_changed` · `admin.checkin_milestone_changed` · `admin.checkin_powerup_changed`(A2 审计,归 §2.4.5 ⑥ admin family)。
- **domain 状态**:`daily` **已在** §2.4.3 domain 枚举内(;§2.4.5 ④ 已列 `daily.checkin`),**无需扩展**;新 object_action 走 §2.4.8 注册 registry。
- **喂给**:`daily.checkin` → `app.dau` 回访(经 §2.4.6 KPI #2 间接)/ §2.4.5 ④ engagement family;`daily.lucky_triggered` / `daily.spin_awarded` → Lucky 命中率监控 + B1 流出影响;`daily.powerup_activated` → 下游域兑现归因(F2/G5/G1/G4)+ 转化路径 BI;config 审计 → B1 + L 域。

---

#### [H6] 里程碑庆祝
**① 目的 & 对齐**: 配置收益累计里程碑(MilestoneWatcher)的 5 档阈值与 NEX 奖励,作为被动触发的成就庆祝激励面。对齐前端 **§11.3a**(`(main)/layout.tsx` MilestoneWatcher:4s tick 监听 `earnings.total + earnings.today` 跨越阈值 fire celebration overlay + 自动入账 NEX)+ **§9.11c.1**(`GET /api/config/milestones`「阶段调整」)。服务业务目标:在用户累计入账跨越关键档位时被动 fire 庆祝 + 自动派 NEX 奖励(§11.3a:无需用户操作,区别于 §11.4 主动 claim 成就),强化「收益真实累积」的产品感与持续运营动机,通过里程碑驱动回访→`app.dau` 路径**间接**提升 Day7 活跃(KPI #2 口径为 `app.dau ÷ register cohort`,§2.4.6;本机制经回访间接贡献,非 KPI 直接口径)。**5 档阈值 / NEX 奖励为放大 NEX 流出,改阈值 / 奖励前置核 B1**(跨域事实 2)。

**② 后台界面**:
- **里程碑配置面**(§11.3a 5 档,server-canonical,`lib/store/milestones.ts:28-34`):`id / 阈值(USD 累计入账)/ NEX 奖励 / 业务文案 key`——earn-100($100/+100 NEX)/ earn-500($500/+250 NEX)/ earn-1000($1,000/+500 NEX)/ earn-5000($5,000/+1,500 NEX)/ earn-10000($10,000/+3,000 NEX)。
- **里程碑监控**(只读,server-canonical):各档 fire 人数分布 + 累计派发 NEX(喂代币流出口径)+ fire 速率(cohort 维度跨档时间)。
- **状态机**(里程碑,§11.3a,server-canonical):`unfired → fired(累计入账跨阈值·自动 creditNex·overlay 展示)`;一次只 fire 一档(§11.3a / `milestone-watcher.tsx:77` `return; // fire one at a time`,POLL_MS=4000:即使跨多档走串行 cascade,每 4s 检查一个),`firedIds` server 记录(§11.3a persist `nexion-milestones-v1` 真后台迁 server),不重触发。

**③ 可控参数**:

| 参数 | 默认值 | 范围 | 生效时机 | 影响的前端 |
|---|---|---|---|---|
| earn-100 阈值 / 奖励 | **现状值(§11.3a / §9.11c.1 / `milestones.ts:29`)**:$100 / +100 NEX | 阈值 ≥ 0 保序;奖励 ≥ 0 | 仅新 fire(已 fire 不追溯) | §11.3a overlay `$100+` + `+100 NEX` chip |
| earn-500 阈值 / 奖励 | **现状值(§11.3a / `milestones.ts:30`)**:$500 / +250 NEX | 同上,保序(> 前档) | 仅新 fire | overlay `$500+` |
| earn-1000 阈值 / 奖励 | **现状值(§11.3a / `milestones.ts:31`)**:$1,000 / +500 NEX | 同上,保序 | 仅新 fire | overlay `$1,000+` |
| earn-5000 阈值 / 奖励 | **现状值(§11.3a / `milestones.ts:32`)**:$5,000 / +1,500 NEX | 同上,保序 | 仅新 fire | overlay `$5,000+` |
| earn-10000 阈值 / 奖励 | **现状值(§11.3a / `milestones.ts:33`)**:$10,000 / +3,000 NEX | 同上,保序 | 仅新 fire | overlay `$10,000+` |
| 里程碑文案 key | **现状值(§11.3a)**:`milestones.*` 5 阈值业务文案 + `genericBody` fallback | i18n key(通用 copy 归 V4 I 域) | 实时 | overlay 标题 + 阈值专属文案 |
| watcher tick 间隔 | **现状值(§11.3a / `milestone-watcher.tsx:25` POLL_MS)**:4s | ≥ 1s(过密增 server 负载) | 实时 | overlay fire 检测延迟 |

> **默认值口径**:5 档阈值 / NEX 奖励 / tick 取前端现状值(标注「现状值」);12 月 §6 未覆盖里程碑参数。**升里程碑 NEX 奖励 / 降阈值 = 放大 NEX 流出**,受跨域事实 2 的 B1 红线前置约束。阈值须保序(高档阈值 > 低档),由 ⑤ `PUT` server 校验(违反返 422)。

**④ 操作动作**:
| 动作 | 执行权 | 确认弹窗 | 审计点 |
|---|---|---|---|
| 改里程碑阈值 / NEX 奖励(5 档) | 财务(lead)/ 超管(2026-06 操作确认决议,放大方向原复核层级就高为执行门槛) | H6-MD1(理由必填+B1 红线预检(升奖励 / 降阈值方向);阈值保序 server 校验,违反 422) | `admin.milestone_config_changed`(档 id / field / 前后值 / coverageAtSubmit / 原因 / operator) |
| 改 watcher tick 间隔† | 仅超管(原复核=超管,就高;基础设施操作) | H6-MD2(理由必填) | `admin.milestone_tick_changed`(前后值 / operator) |
| 查看里程碑配置 / 监控 | 全角色(按可见性裁剪) | 否(只读) | — |

> † 「技术」不在 V1 §1.1 七角色枚举内;**§2.1 RBAC 落地前 watcher tick 调整(基础设施型)默认由 `超级管理员` 代理执行,不单独开 `tech` 账号**(§2.1 落地后再细分;体例同 V3 G3 oracle 切换对非枚举角色的处理)。里程碑文案(`milestones.*`)归 V4 I 域,本表不含文案改动。

**④a 交互与弹窗规格**

**(1) 动作触发总表**

| 动作(同④) | 触发控件 + 位置 | 形态 | 可用态规则 | 点击行为 |
|---|---|---|---|---|
| 改里程碑阈值 / NEX 奖励 | ② 里程碑配置面 5 档行「编辑」 | 行内按钮 | 仅财务(lead)/ 超管渲染 | 打开弹窗 H6-MD1 |
| 改 watcher tick 间隔 | ② 里程碑配置面 tick 参数卡「编辑」 | 次按钮 | 仅超管渲染 | 打开弹窗 H6-MD2 |
| 查看里程碑监控 | ② 里程碑监控 tab | 链接 | 恒可用(按角色裁剪) | 跳转对应视图,无弹窗 |

**(2) 弹窗规格**

##### [H6-MD1] 里程碑阈值 / 奖励变更
- **功能**:修改 5 档里程碑的阈值(USD 累计入账)/ NEX 奖励,确认即生效(仅新 fire,已 fire 不追溯)。
- **布局结构**:1. **信息区**:所选档 id / 当前阈值 / 奖励 / 该档已 fire 人数 + 累计派发 NEX(② 监控同源)。2. **影响预览区**:before→after 并排;升 NEX 奖励 / 降阈值方向 server 预检「**拟生效后覆盖率**」+ 「拟新增可 fire 人群估算」(降阈值时 server 派生),低于 B1 红线展示红线警示条(确认钮置灰,文案含「覆盖率低于红线,server 将拒绝(422)」);阈值保序冲突时内联指出冲突档位。3. **输入区**:见下表。4. **按钮区**:取消 / 确认变更。
- **输入与选择控件**:

| 字段 | 控件类型 | 必填 | 校验 | 默认值 |
|---|---|---|---|---|
| 目标阈值(USD) | 数字输入 | 改该项时必填 | ≥ 0,保序(> 前档、< 后档,③ 表);违反 server 422 | 当前值 |
| 目标 NEX 奖励 | 数字输入 | 改该项时必填 | ≥ 0(③ 表) | 当前值 |
| reason | 多行文本 | 是 | 8–200 字;server 空值 400 `REASON_REQUIRED` | 空 |

- **按钮区**:`[取消]` · `[确认变更]`(升奖励 / 降阈值预检低于红线 / 保序冲突时置灰;提交 loading 锁定)。
- **错误态**:422 `COVERAGE_BELOW_REDLINE`(含 server 回传当前覆盖率,弹窗不关,内联阻断条)/ 422(阈值保序违反,内联指出冲突档位)/ 400 `REASON_REQUIRED` / 409(配置已被他人变更,提示刷新)/ 403。
- **成功反馈**:弹窗关闭;档位行就地更新;toast「里程碑配置已生效(仅新 fire) · 已记审计」;事件 `admin.milestone_config_changed`;实时告警超管 + 财务 lead。

##### [H6-MD2] watcher tick 间隔变更
- **功能**:修改 MilestoneWatcher 轮询间隔(POLL_MS),确认即实时生效;仅超管(基础设施型)。
- **布局结构**:1. **信息区**:当前 tick 间隔 / fire 检测延迟说明(引用 ③ 表「影响」)。2. **影响预览区**:before→after 并排;调密(< 当前值)提示行「轮询加密将增加 server 负载」。3. **输入区**:目标间隔(数字输入,秒;≥ 1s,③ 表)+ reason(多行文本,必填,8–200 字)。4. **按钮区**:取消 / 确认变更。
- **错误态**:422(低于 1s 下限,server 返回合法区间)/ 400 `REASON_REQUIRED` / 409 / 403(非超管)。
- **成功反馈**:弹窗关闭;tick 卡就地更新;toast「tick 间隔已生效 · 已记审计」;事件 `admin.milestone_tick_changed`;实时告警全体超管。

**⑤ 接口**(`GET` 配置源收敛 §9.11c.1):
- `GET /api/config/milestones` — 5 档阈值 + NEX 奖励 + 文案 key;**server-canonical 配置源**(§9.11c.1),前端 §11.3a 读此。
- `GET /api/admin/milestones/stats?window=` — 各档 fire 人数 + 累计派发 NEX + fire 速率(server 权威)。
- `PUT /api/admin/milestones/config` — 改阈值 / 奖励 / tick(经确认弹窗 H6-MD1 / H6-MD2,reason 必填(空值 400 `REASON_REQUIRED`);**升奖励 / 降阈值 server 先核 B1,< 红线返 422**;**阈值保序 server 校验,违反返 422**)。

**⑥ 权限 & 审计**:
| 角色 | 查看里程碑/监控 | 改阈值/奖励 | 改 tick |
|---|---|---|---|
| 增长 | ✅ | — | — |
| 财务 | ✅ | ✅(lead) | — |
| 超管 | ✅ | ✅ | ✅(仅超管) |
| 客服 / 只读审计 | ✅(只读) | — | — |

> 执行权 = 单人执行(2026-06 操作确认决议):阈值 / 奖励为放大方向,原复核层级就高(财务(lead)/ 超管 + B1 红线预检);tick 原复核 = 超管,就高为仅超管(基础设施操作)。

审计字段(A2 统一 schema,§2.x ⑥):`action / milestone_id / field / before / after / coverageAtSubmit(升奖励/降阈值时) / reason / operator / ts`。

**⑦ 风控 & 联动**:
- **server-canonical(§9.11d.2)**:里程碑触发判定(累计入账跨阈值)+ `firedIds` + 自动 NEX 派发全部 server 权威;前端 §11.3a `useMilestones`(persist `nexion-milestones-v1`)+ 4s tick 监听当前 client 评估,**真后台对接后 fire 判定基于 server 权威累计入账**(§9.11d.2 明列 `_devBumpEarningsTotal` 伪造 lifetime USD 领里程奖为篡改路径,server build-time strip + tree-shake)。**口径说明**:前端判定值 = **累计入账**(`earnings.total + earnings.today`,即 §11.3a watcher 的 `lifeToDate` 口径,`milestone-watcher.tsx:54` `const lifeToDate = (total ?? 0) + (today ?? 0)`)——非纯 lifetime total,后端若据「lifetime」字面只取 `total` 会漏当日增量致跨阈值时机偏差,故 ③/⑦ 统一用「累计入账(`earnings.total + earnings.today`)」表述,server 权威化口径含当日增量。**防伪造里程碑**:client 不得本地拨高 earnings 跨阈值或伪造 fire(§9.11d.2 / §9.11d.3 dev 钩子生产剥离)。
- **fire 判定与自动派发原子性 + cascade 配置漂移 + idempotency 粒度(§9.11e)**:里程碑 fire 判定(写 `firedIds`,`milestones.ts:48-51` 仅 append firedIds 无 creditNex,crediting 在 `milestone-watcher.tsx:59-78` 路径)与自动 `creditNex` + 落 D4 bill 须收敛 server 单事务,crash 中途**不得出现 `firedIds` 已置位而 NEX 未入账的部分态**(否则用户永久丢该档 NEX 且不重触发);派发事务失败则 `firedIds` 回滚、下个 tick 重判重发。补两点:(1) **idempotency key 粒度 = `milestoneId × userId`**(每档独立),cascade 中每档单独幂等,部分成功可续;(2) **cascade 跨档结算时点锁定**——跨越判定瞬间快照全部待 fire 档位当时配置值,逐档按快照值派发,不受 cascade 期间配置变更影响,与 in-flight 乐观锁口径一致;watcher `return; // fire one at a time`(`milestone-watcher.tsx:77`)+ POLL_MS=4000 已证实串行 cascade。与 G 域 staking / genesis claim 的 409 / 乐观锁兜底对齐。
- **NEX 流出联动 B1(跨域事实 2)**:里程碑自动派 NEX(earn-10000 单档 +3,000 NEX)增 NEX 流出;升奖励 / 降阈值提交即 server 核验 B1 覆盖率红线(NEX 计价负债折算口径见 Ch4 B1 §③)。
- **跨模块联动**:里程碑消费的累计入账来自设备 mining + 团队佣金聚合(`earnings.total + earnings.today`,§9.8 / 前端收益体系);H6 只读消费 earnings 权威,不持收益账权威(收益账归设备 / 佣金域)。fire 的自动入账 NEX 落 D4 bill(`milestone-watcher.tsx:68-75` `useBills.add` type=achievement)。
- **幂等 & 并发裁决(§9.11e)**:里程碑自动派 NEX 携 **`Idempotency-Key`**(`milestoneId × userId` 维度去重;§11.3a `firedIds` 防重触发对应 server 端幂等;§9.11e 通则,沿用作 V3 新登记事务边界行,§9.11e 表当前未含 milestone 行)——retry / 多 tick 不重复派发;cascade fire(跨多档)server 串行裁决,一次一档(§11.3a),并发 tick 不致同档多次 fire。
- **kill 联动 J1(V4)**:里程碑庆祝无独立 kill(§9.11d.1 未列);若监管限制「收益里程碑奖励」,经 J1 矩阵(V4)停自动派发(改奖励为 0 或 tick 停)。

**⑧ 埋点(事件)**:
- **产生(里程碑 server)**:`milestone.fired`(累计入账跨阈值自动触发,`is_server_authoritative=true`;属性:`milestone_id / threshold_usd / reward_nex / lifetime_earnings_usd / ts`)—— `milestone.*` 为新增,走 §2.4.8 schema 变更确认流程(仅超管经 A2-MD1 确认弹窗执行)注册 registry。
- **产生(admin 审计)**:`admin.milestone_config_changed` · `admin.milestone_tick_changed`(A2 审计,归 §2.4.5 ⑥ admin family)。
- **domain 状态(blocking)**:`milestone` **不在** §2.4.3 domain 枚举内(V1 §2.4.3 现行登记不含 `milestone`)→ **须向 A4 申请 domain 枚举扩展(§2.4.3),blocking 依赖,登记为 V3 起始工单(sprint 开始即发起)**(体例参 V2 `order` domain 起始工单 / V3 G3 `nex`)。占位选择依据:`milestone.fired` 本质是用户侧留存 / engagement 事件,但 §2.4.5 ④ engagement family 现成员(`app.dau` / `daily.checkin` / `quest.completed` / `nova.*`)为 V1 固定清单,不含 milestone 类宿主;扩展落地前 `milestone.fired` **暂记 `admin` family 占位、临时编号**(体例锚 V1 §2.4.5⑥ `admin.coverage_threshold_breached` 归 admin family 的占位范式),`is_server_authoritative=true`(§2.4.4)资金 / 状态事件不受 family 占位影响其 B3 / KPI 权威口径,扩展后迁回 `milestone.*`。**过渡期 BI 兜底**:占位期 BI 对 Day7 留存显式 union admin family 中 `is_server_authoritative=true` 且 `object_action ∈ {milestone.fired}` 的临时编号事件,或在 §2.4.8 工单将 domain 扩展列为 V3 sprint-0 must-finish-before-BI-cutover。
- **喂给**:`milestone.fired` → `app.dau` 回访(经 §2.4.6 KPI #2 间接,里程碑驱动回访)/ 代币流出 BI(L 域:各档累计 NEX 派发)/ B1 NEX 流出影响;config 审计 → B1 覆盖率影响评估 + J1(V4)。
