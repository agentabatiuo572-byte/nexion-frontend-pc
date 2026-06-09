# 运营后台 · 运营动作完整性台账(OPS-ACTIONS-MATRIX)

> 目的:把"运营者对每个对象**该能做的动作** = 真能用 / 死控件 / 完全缺失 / 合理只读"逐项列清,量化欠账、排补齐优先级,并作为新的「动作完整性门」基线。
> 缘起:主人发现「商品目录 & 定价」只有定价、连改价/下架都没有 —— 排查后确认这是**系统性**问题(全后台动作层 ~90% 是死控件),而非孤例。本台账回答"为什么细化排查还漏这么多"并驱动补齐。

> **🟢 现状速览(2026-06-05,以此为准)**:§0/§1/§2/§3 的数字为 **2026-06-04 排查时**的「补齐前」快照(故仍显示大量 🟠死控件、"真接 store 仅 ~20")。**截至 2026-06-05 已全部补齐**——机读清单 `docs/ops-actions.manifest.json` 当前 = **102 行 · ✅built 93 · 🟠pending 0 · ❌missing 0 · ⚪readonly 9 · 死控件 baseline 11 · 欠账 0**,gate 每次 verify 校验。Nova(I2)已补完整 CRUD(新增/编辑/删除/kill,真写 persist+审计)。**全局现状一律以 manifest 为单一权威源**;下方 §1/§3 保留作补齐前记录 + 方法论参考,数字不再实时维护。

## 0. 一句话结论

后台的**展示/看板层是真的**(全路由 SSR 渲染、数据齐、四镜头审过),但**运营动作层**(增 / 改 / 上下架 / 状态切换 / 参数配 / 审批)**约 90% 是 `setMc → MakerCheckerModal → onConfirm 只 setToast("已提交复核")` 的死控件** —— 点了不写任何 store、刷新即丢。
全后台 registry 声明约 **671 个动作**,真正接了持久 store(真 CRUD)的仅约 **20 个**,其中 **11 个集中在 C 域 360 HUB**(`users/search/[id]`),其余真动作只有:A 账号创建、E3 任务 CRUD、C 冻结、I2 Nova 启停。

> 注:本项目是 mock 原型,"死控件→toast"在原型语境曾被当作可接受的"演示外壳"。但项目已由 **E3 任务引擎 + C 域 360 HUB** 树立了"真交互"样板(真写持久 store + 即时反映 + 审计,backend-replaceable)。以该样板为准,死控件 = 未达项目自身标准 = 真欠账。

## 1. 全域汇总

| 域 | 运营对象数 | ✅真实装 | 🟠死控件 | ❌完全缺失 | ⚪合理只读 | registry声明动作 | **高优先真欠账** | 性质 |
|---|---|---|---|---|---|---|---|---|
| A 平台基础 | 5 | 2(账号) | ~12 | 3(RBAC编辑/…) | 2 | 37 | **6** | 死控件为主 |
| B 总览驾驶舱 | 5 看板 | 0 | 3 | 3 | 5 | 0(dashboard) | **3** | ⚪ 多数合理只读 |
| C 用户与账户 | 9 | **11(360 HUB)** | 16(列表页) | 0 | 2 | 37 | **5** | 🔴 HUB真/列表假**割裂** |
| D 资金与财务 | 6 | 1–2 | ~13 | 3–5 | 1 | 23 | **7** | 全死控件 |
| E 设备与商城 | 8 | 4(任务) | ~9 | 3(上下架/…) | — | 80 | **9** | E3真,E1/E2/E5/E6/E7死 |
| F 分销与团队 | 7 | **0** | ~14 | 2 | — | 95 | **16** | 全死控件 |
| G 金融产品 | 7 | **0** | ~13 | 2 | — | 100 | **17(+1熔断)** | 全死控件 |
| H 增长节奏 | 6 | **0** | 13 | 3 | — | 81 | **5–16** | 全死控件(apply只改useState) |
| I 内容合规CMS | 7 | 2(Nova) | 18 | 1 | — | 45 | **6** | 🔴 核心欠账区 |
| J 紧急合规 | 4 | **0** | 9 | 1–2 | — | 41 | **9** | 全死控件(含Kill-Switch) |
| K 风控反作弊 | 5 | **0** | ~8 | 2–3 | — | 48 | **8** | 全死控件 |
| L 数据BI | 5 | **0** | 3 | 2 | 5(L1–L4) | 44 | **1** | ⚪ 多数合理只读 |
| **合计** | **74** | **~20** | **~110** | **~25** | **~15** | **~671** | **~90** | — |

## 2. 性质分类(决定补不补)

- **✅ 真实装(~20)** — 已达样板,保持:A 账号创建 / E3 任务 CRUD / C 360 HUB 11 动作(设备CRUD·冻结·会话·2FA·收益·取消订单) / C 冻结 / I2 Nova 启停。
- **🟠 死控件(~110)** — **欠账主体**:声明 + UI 入口都在,但 handler 只 toast,不写 store。补法 = 接真 store(仿 E3 / user-ops 模式)。
- **❌ 完全缺失(~25)** — registry 声明了但 view 没渲染该按钮,或压根没有:E 上架/下架按钮、E 删除SKU、D 账本红冲/对账核销/挂账、K KYC驳回·补件、J SOP历史、A RBAC权限编辑、H phase手动pin/cohort override/转盘奖池、L 报表排程·模板、B 红线阈值·告警处置。**最隐蔽,纯靠"声明存在"骗过了 CGM。**
- **⚪ 合理只读(~15,不算欠账)** — 本就该 server-canonical 单向只读 / 纯分析看板:B 全 5 看板(决策动作跨域委托 F/H/J)、L1–L4 KPI/财务/运营看板、D3 储备水位、C/各域只读统计。

## 3. 高优先真欠账 — 补齐分批(按运营关键度)

> **✅ 已全部补齐(截至 2026-06-05)**:下列 P0/P1/P2 欠账动作均已接真写 store + 审计(manifest built 93 / 欠账 0),含 I2 Nova 完整 CRUD。本节保留作**补齐前欠账台账 + 优先级方法论**参考。

> 判据:运营为保证业务正常运转**是否必须真操作它**?是 → 该真写。高敏(资金/资产/规则/kill-switch)一律 Maker-Checker 真双签 + server-canonical + 审计。

### P0 高敏即时动作(资金/风控/合规/止血) — 最先补
| 域 | 对象 | 欠账动作 | 现状 | 证据 |
|---|---|---|---|---|
| D | 提现申请 | 放行 / 冻结 | 🟠死控件 | `d-view.tsx:134,156` |
| D | 账本 | 红冲 / 对账核销 | ❌缺失 | `d.ts:41` 声明,view 无按钮 |
| K | 多账户簇 | 确认/解除/封禁全簇 | 🟠死控件 | `k-view.tsx:174-176` |
| K | KYC 复审 | 通过 / **驳回 / 补件** | 🟠死控件+❌缺失 | `k-view.tsx:149`;`k.ts:214` 驳回/补件缺渲染 |
| J | Kill-Switch 7闸 | 熔断 / 恢复(双签) | 🟠死控件 | `j-view.tsx:90` |
| J | 篡改防御 | 确认拦截 / 封禁 | 🟠死控件 | `j-view.tsx:121-123` |
| C | 账户(列表) | 冻结/解冻/限制(与HUB割裂) | 🟠死控件 | `c-view.tsx:39-44` |
| A | 运营账号 | 停用账号 / 改角色 / 重置2FA | 🟠死控件 | `a-view.tsx:154-156` |

### P1 业务参数与发布(决定业务运转) — 次之
| 域 | 对象 | 欠账动作 | 现状 |
|---|---|---|---|
| E | 商品SKU | **改价 / 上架 / 下架 / 编辑 / 删除**(主人点名) | 🟠死控件+❌缺失 `e-view.tsx:133`,上下架/删除缺 |
| E | baseRate / 代际门(E2) / trade-in(E5) | 调产出 / 放行新代 / 调折抵 | 🟠死控件 |
| F | 网络版税 / V级 / 奖池 / 配额 | 改费率 / 改阈值 / 改比例 | 🟠死控件(16项全死) |
| G | staking / 兑换 / Genesis / 复投 | 调APY / 汇率费率限额 / 分红 / 紧急pause | 🟠死控件(17项全死) |
| H | phase拨盘 / 试用引擎 / 活动 | 调dial / 改试用参数 / 上下线活动 | 🟠死控件(写useState不持久) |
| A | 系统参数 / 埋点事件 | 调维护模式·限流 / 灰度·全量 | 🟠死控件 |
| B | 兑付红线 / Kill-Switch入口 / P0告警 | 调阈值 / 一键触发 / 标记处置 | 🟠+❌ |

### P2 内容运营与数据交付(便利但非止血) — 最后
| 域 | 对象 | 欠账动作 | 现状 |
|---|---|---|---|
| I | 文案AB/Campaign/信任中心/披露/i18n/教程 | 设为胜出 / 投递 / 发布上下架 | 🟠死控件(18项,I 域核心欠账区) |
| H | 签到/抽奖/里程碑 | 调规则 / Lucky概率 / 阈值 | 🟠死控件 |
| L | 报表 | 生成 / 导出 / 重跑 / 排程 / 模板 | 🟠死控件+❌缺失 `l-view.tsx:130` |
| F | 大使 / 排行榜 | 审批 / 取消资格 | 🟠死控件 |

## 4. 各域明细索引

逐域「对象×动作×现状×证据」明细见各域 view + registry(已交叉核对,真写句柄数:F/G/H/J/K=0,E=4任务,A=2账号,C=1冻结+HUB 11):
- A `a-view.tsx` / `registry/a.ts` · B `app/(console)/overview/*` / `registry/b.ts` · C `c-view.tsx`+`users/search/[id]/page.tsx` / `registry/c.ts`
- D `d-view.tsx` · E `e-view.tsx` · F `f-view.tsx` · G `g-view.tsx` · H `h-view.tsx` · I `i-view.tsx` · J `j-view.tsx` · K `k-view.tsx` · L `l-view.tsx`

## 5. 根因 & 防再漏

**为什么细化排查还漏这么多(根因):**
1. 所有门只查「已存在代码对不对」(CGM adminTarget 存在 / 4镜头UI / interaction-audit 死控件限 hub/* / verify 文本),**无人查「该有的动作在不在 + 声明的动作有没有真落地」**。
2. **「声明即覆盖」幻觉**:registry DSL 的 `rowActions:["改价","上架"]` 字符串被当成"功能已实现";CGM `built` 判定(`cgm-coverage.mjs:50`)只 grep adminTarget 字符串存在,不验动作真写 store。声明层↔渲染层↔状态层三层断裂无门校验。
3. CGM 颗粒度是"字段级"(有没有控制点),不是"动作级"(对象的查/增/改/上下架/删/参数 齐不齐+真不真)。

**防再漏机制(待建,见方案 Part B):**
- ① 本台账(对象×标准动作 正向清单)= "查该有的在不在"。
- ② interaction-audit A 类死控件门从 `hub/*` 扩到 `domain-views/*`:检测「MakerChecker onConfirm 只 toast 不写 store」→ FAIL。
- ③ CGM `built` 升级:声明的写动作须真有 store handler 且被目标视图调用。
- ④ registry 声明↔渲染对齐门:声明的 rowAction 必须真渲染成带 handler 的按钮。

**地基已落地(2026-06-04):**
- `docs/ops-actions.manifest.json` — 机读清单(初始 97 行 built 6;**当前 102 行 · built 93 · pending 0 · missing 0 · readonly 9**,含 Nova I2 三条 CRUD)+ `deadControlBaseline`(各 view 死控件数,初始总 124,**补齐后当前总 11**)。
- `scripts/ops-actions-audit.mjs` — 动作完整性门(防新增死控件 + 防 built 退化 + readonly 须有据 + `OPS_BATCH` 批次收紧),已接 `verify.sh`。默认放行 pending(增量补齐不爆红)。
- `lib/store/admin/platform-config-store.ts` — 统一原语:`setParam(key,value,{action,reason})` 调参数真写 + `logAudit` + append-only `audit`(覆盖费率/APY/阈值/dial 类动作)。

## 6. 补齐一个动作的标准做法(SOP)

每补一个欠账动作,5 步(以「E 改价」为例):
1. **选行**:manifest 找 `status=pending/missing` 行(OPS-E-02 改价),定 storeAction 名(`updateSku`)。
2. **store**:`platform-config-store`(平台级)/`user-ops-store`(per-user)加真写 action — 对象 CRUD 仿 `addTask/updateTask/removeTask`;**纯调参数直接用现成 `setParam(key,value,{action,reason})`**(已含审计)。
3. **view**:死控件 `setMc(...)` 的 `MakerCheckerModal onConfirm={(reason,newVal)=>...}` 接到 store action(用 reason/newVal),状态即时反映;读侧加水合门 `useOpsHydrated()`。
4. **manifest**:该 row `status→built` + 填 `storeAction`;`deadControlBaseline[view]` 减去消灭的 setMc 数(只减不增)。
5. **回测**:`node scripts/ops-actions-audit.mjs`(PASS) + `npx tsc --noEmit` + `bash scripts/verify.sh all`;补完一批可 `OPS_BATCH=P0 …` 验该批清零。

门自动:挡新增 setMc 死控件(baseline 超标)、挡 built 退化(storeAction 消失)、量化剩余欠账。
