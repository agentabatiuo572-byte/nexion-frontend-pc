# 侦察报告 — admin 后台离「加产品线维度」有多远

> 只读侦察产出。口径:设想一个 admin 管两个 App(Nexion-uniapp 脏样本 + Nexion-CC 净样本),加一个「产品线」维度。账户/KYC/风控/提审/资金核=共享域,SKU/收益/佣金/设备/营销=产品线自配域。判断现状离该目标的距离。
> 源:`docs/PRD/Nexion_运营控制后台_开发落地规格.md`(第 1/2/4 章)+ `lib/nav/console-nav.ts` + `lib/admin/ops-authority.ts` + 全仓 .ts/.tsx grep。
> 侦察日期 2026-07-17。**未动任何代码。**

---

## §1 12 域归属草案(逐域:共享 / 自配 / 混合)

现状 IA = `CONSOLE_NAV` 13 域(A–M)/ 72 个 L2 入口,扁平数组,**无任何产品线/App 分层**。按背景口径给归属草案:

| 域 | 名称 | 归属 | 一句理由 |
|---|---|---|---|
| **A** 平台基础 | RBAC/审计/系统配置/事件模型 | **共享** | 后台账号体系、审计留痕、kill-switch、事件 schema 是 admin 自身骨架,与业务 App 无关,天然跨 App 共享;仅审计/事件需加产品线标签区分「作用在哪个 App」。 |
| **B** 总览驾驶舱 | 双账本/资金池/漏斗/节奏/风险雷达 | **混合** | 资金安全水位(B1/B2)是全平台口径;转化漏斗/节奏状态(B3/B4)是各 App 各自增长指标,应按产品线切片。 |
| **C** 用户与账户 | 检索/账户操作/余额/KYC/安全/风控配置 | **共享** | 账户身份、KYC 台账、安全会话是跨 App 用户层;C3 余额调整涉资金需按账户隔离。前提:需先定「一个 user 跨 App 共享还是各 App 独立 user」。 |
| **D** 资金中心 | 充值对账/提现审核/资金池/账本/提现参数 | **共享**(D5 偏自配) | 提现审核、账本审计是资金核心,背景明确共享;仅 D5 提现参数(日限额/费率)可能各 App 各配。 |
| **E** 设备商城 | SKU/收益任务/生命周期/订单/运维/算力配置 | **自配** | SKU 目录、定价、日产出率、算力配置两 App 完全不同(Nexion 卖矿机 vs CC 卖 AI 云算力);E 域每个 Config 都要按产品线一份。 |
| **F** 分销团队 | V-Rank/佣金费率/双轨/领导池/佣金审计 | **自配**(强) | 佣金费率、V-Rank、双轨结算各 App 独立;CC 净样本很可能整个 F 域不启用。 |
| **G** 金融产品 | Staking/兑换/行情/Genesis/Premium/Vault/复投 | **自配**(强) | 金融产品线各 App 各配;CC 净样本可能整域不启用这些庞氏金融件。 |
| **H** Phase 与增长 | 节奏调度/试用/Quest/活动/签到/里程碑 | **自配** | 12 月节奏、试用引擎、活动是各 App 各自增长运营,节奏独立。 |
| **I** 内容合规 CMS | 文案A/B/推送/通知/信任中心/披露/i18n/教程 | **自配**(I5 偏混合) | 文案/推送/教程各 App 各配;仅风险披露版本(I5,合规关键件)与 i18n 基线可能共享合规底座。 |
| **J** 紧急合规 | Kill-switch/Geo-block/篡改监控/应急SOP | **共享** | 止血闸、地域屏蔽、应急 SOP 是平台级风控合规;但闸需能按 App 单独止血(关 CC 提现不连累 Nexion)。 |
| **K** 风控 | 反多账户/套利/提现风控/评分/KYC复审/Janus | **共享**(参数偏自配) | 风控引擎、评分模型、多账户识别应跨 App 共享信号(同一人在两 App 开号=多账户,共享才是价值点);仅阈值参数可各 App 各配。K6 Janus 设备接管偏 Nexion 特有。 |
| **L** 数据分析 BI | KPI/漏斗/财务报表/设备报表/导出 | **混合** | BI 只读引用,天然应支持按产品线切片;L3 财务报表引用 B1+D3 需定「合并口径 vs 分 App 口径」。 |
| (M) 客服面 | tickets(不在 70 子模块索引内) | **共享** | 客服工单跨 App,后加域,数据模型总表未登记。 |

**小结**:明确共享 5(A/C/D/J/K)· 明确自配 5(E/F/G/H/I)· 混合 2(B/L)· 客服 M 共享。与背景口径高度吻合——共享/自配的**业务切面天然存在**,只是现状用「域」硬编成一套,没有「产品线」这根正交轴。

---

## §2 账户/资金/风控现有数据模型(有无 uid / 产品线维度)

关键结论:**所有业务实体是 `userId` 单键;资金账本/风控模型是全平台单份聚合。零 `productLine`/`appId`/`tenantId` 字段。**

### 账户
- **OperatorAccount**(admin 账号):`accountId · role{super|finance|risk|growth|content|support|auditor} · permissionTier{member|lead} · status`。无产品线。
- **User**(权威在前端 §12,后台引用):`usdtBalance · nexBalance · pendingEarnings · points · referralCode · cumulativeDepositUsdt · 设备fleet`。隐含 `userId` 单键,**无 productLine/appId**。
- **KycLedger**:`userId · kycStatus{verified|unverified|in-review} · walletPaired · pairedAddress · network`。`userId` 维度,无产品线。GET `/api/kyc/status/:userId` 单源。

### 资金
- **Withdrawal**(12 态):`withdrawalId · userId · amountUsdt · riskScore(K4) · kycStatus(C4) · hitRules(K3)`。userId 键,无产品线。
- **Bill**(7 类):`billId · userId · type · amount · currency`。server 唯一账本,userId 键,无产品线。
- **TreasuryLedger·B1**(负债 8 科目)+ **D3**(储备账本):**全平台单份聚合**,`coverageRatio/netExposure/reserveTotal` 均全局标量。**无按 App 分账维度**。财务单源 = `lib/mock/admin/ledger.ts` 一份 `LedgerSnapshot`,B1/D 全域金额从它派生,明文「无二源」。

### 风控(K 域)
- **RiskScore**:`userId · score(0–100) · band · dimensions[]`。唯一评分源,userId 键,无产品线。
- **RiskModel**:`weights{multiAccount,arbitrage,kycStatus,...}(和=1) · scoreBand · autoEscalateScore`。**单份全局模型**,无产品线。
- **WithdrawRule / K1 去重簇 / K2 套利信号**:`ruleId / clusterId / userId` 键,规则集全局单份,无产品线。

### 审计/事件(加维度的关键接触点)
- **AuditLog**:`operator · role · action · object{domain, objectId} · before · after · reason · ip · ts`。`object.domain` = **12 域枚举**(§2.4.3 现行 22 个),**不含产品线维度**。
- **EventSchema**:`eventName(domain.object_action) · ownerDomain`。domain 轴只有业务域,无 App/产品线。

---

## §3 现有可配置与多维度机制成熟度(能不能挂产品线维度,差什么)

### 已有的「按维度切片/覆盖配置」先例(可复用作参考,但都不是 App 维度)
1. **featureFlags.scope** `enum{all|cohort|phase}`(A3 SystemConfig)—— 灰度范围维度。
2. **PhaseConfig.cohortOverrides[]**(H1)—— 按 cohort(注册周 `YYYY-Www`)覆盖逐月参数,`{cohortId, monthOffset, 区间}`。这是**现成的「基线配置 + 按维度覆盖」模式**。
3. **Strategy.scope + rollout{percent, cohortIds}**(K6 Janus)—— 策略灰度作用域(注:`scope` 语义 = 适用哪些 DeviceStatus,**非产品线**)。
4. **Disclosure version × jurisdiction 双维**(I5)—— 法域正交维度,证明系统能承载「二维配置矩阵」。

### 成熟度判定:**半成熟(有多维模式,无 App 轴)**
- **正面**:平台已有 cohort / phase / jurisdiction 三种正交切片先例,`cohortOverrides` 就是「单份基线 + 按 key 覆盖」的可复制骨架。加产品线维度**不用从零发明覆盖机制**。
- **缺口**:
  - 所有 Config 是**全局单例**(SystemConfig 单条、各域 Config 各单份),store = Zustand + localStorage 单命名空间 `nexion-admin-*`,**无按 App 分片**。
  - **E 域算力配置(E6 ComputeShareConfig)**、**K 域风控(K4 RiskModel)** 实测均为**单份全局对象**,没有任何「按分组配一份」的结构——正是自配域的核心缺口。
  - 无「当前产品线」上下文(context/选择器),无产品线枚举表,无产品线 × 域可见性矩阵。

---

## §4 加「产品线」维度的改动面初判

按 加性(A,不破坏现有结构)/ 破坏性(D,改数据结构或单源根)分级:

| 改动面 | 分级 | 说明 |
|---|---|---|
| 顶层「当前产品线」选择器 + 产品线枚举表 | **加性 A** | 新增全局 context(类比现有 phase 切换),不动现有页。 |
| IA/nav 产品线过滤 | **加性 A** | `CONSOLE_NAV` 加一层 visibility 过滤(自配域按当前产品线显隐,如 CC 隐藏 F 分销)。结构不变,加过滤层。72 L2 逐条标 `availableIn[]` 即可,机械工作量中等。 |
| AuditLog.object 加 `productLine` · EventSchema 加产品线轴 | **加性 A** | object 字段新增,审计留痕带 App 标签。向后兼容(旧记录 productLine=默认)。 |
| OpsAuthorityContext 加 `productLine` · RBAC 可选按 App 授权 | **加性 A** | `ops-authority.ts` 的 context 结构加字段;RBAC 矩阵可扩「某角色只管某 App」,默认全 App 保持现状。 |
| registry `{a..m}.ts` ConfigSpec 注入产品线上下文 | **加性为主 A** | 自配域 registry 改动大(每个 ConfigSpec 需感知当前产品线),共享域几乎不动;archetype 装配层加 productLine context 传递。 |
| **自配域(E/F/G/H/I 主体)所有 Config:单例 → keyed-by-productLine** | **破坏性 D** | ComputeShareConfig/SKU/佣金费率/RiskModel参数/节奏/文案池等从「一份」改 `Map<productLine, Config>`,**所有读点要带 productLine 参**。可复用 `cohortOverrides` 覆盖骨架降本,但改动铺满 E/F/G/H/I。 |
| 共享域业务实体(User/Bill/Withdrawal/RiskScore)产品线归属 | **取决于账户模型决策** | ①一个 user 跨两 App 共享 → 资金/设备记录加 productLine **来源标记**(加性字段);②两 App user 独立 → User 加 productLine **归属**(加性字段 + C1 检索加过滤)。二选一是架构规格必须先拍板的前置。 |
| **财务单源 `ledger.ts`(B1 双账本 + D3 储备)** | **破坏性 D(最大)** | 若两 App 资金池独立:`LedgerSnapshot` 单份 → 按 App 分账 + 合并视图。财务单源是 **B/D 全域派生的根**,改它牵连 B1/B2/B5/D3/D4/L3 全链;若资金池合并则此项可免,但需明确「兑付覆盖率按合并口径」是否可接受。 |

### 最大改动面(一句话)
**财务单源 `ledger.ts` 按 App 分账 + 各自配域(E/F/G/H/I)Config 从「全平台单份」改「按产品线分份」是破坏性核心;导航过滤 / 审计 / 高敏动作 / RBAC 加产品线轴均为加性外围。**

### 前置决策(架构规格须先拍板,直接决定改动是加性还是破坏性)
1. **账户是否跨 App 共享**:决定 C/D/K 共享域是「零改动 + 记录加来源标记」还是「User 加归属 + 全检索加过滤」。
2. **资金池是否隔离**:决定 `ledger.ts`(最大改动面)动不动。
3. **兑付覆盖率/风控信号是合并口径还是分 App**:决定 B/K/L 是切片还是分账。
