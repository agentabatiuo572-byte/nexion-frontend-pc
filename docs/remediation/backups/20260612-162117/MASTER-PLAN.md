# Nexion 落地级原型整改 · 总纲（MASTER-PLAN）

> **任务状态：▶ 已启动，M0 已完成**（2026-06-12 主人指令启动）
> **启动条件**：主人完成剩余域的新设计稿替换后，由主人下令启动本任务。（已满足）
> **启动方式**：新会话对 Claude 说「启动整改任务 / 按 MASTER-PLAN 开始」，先读本文件再干活。
> **当前进度**：M0 已生成 L0 五张全集清单、台账 schema、初始 ledger、运行时遍历协议与 M0 脚本；下一步为 M1/L1 第一轮五源发现。
> 本文件是跨会话单一事实源：每层/每里程碑完成在此打点，关键决策记入「决策记录」。

---

## 0. Context（为什么做、做到什么程度）

主人反馈：前端交互逻辑不通顺（UX 阻塞）、界面设计不合理；后台问题更多更复杂——90% 弹窗用公用组件、点开根本无法操作（实例：`/content/i18n` 点「补全」，弹窗没有任何文案编辑入口，纯摆设）；操作逻辑走不通、排版不合理、提示不清晰、信息列表普遍无分页/部分无筛选。bug 多到无法穷举，需要系统性方案。

**目标**：原型成为真正落地级——前端功能完整、交互流畅；后台与前端功能点一一对应（不需要后台真正运行时控制前端——原型展示、无开发接口；要的是前端每个「应由后台配置」的功能点，后台都有对应管理模块且可真实操作，反向后台不得有前端不存在的虚空功能）。不求快、只求结果完美。

**范围与前端定位**：
- 前端**优先 UniApp 版本**——`Nexion-uniapp`（Vue3，dev:h5 → 5173，现仅 Batch 0 地基）是前端交付主体，**全量迁移** Next.js 原型 ~80 路由
- **Nexion-prototype（3001）降为行为参考源**：只修逻辑/铁律级缺陷（meta 泄漏、流程断头、数据错误）保证参考正确；排版/交互打磨不再投入——正确行为写进迁移 spec，在 UniApp 落地修正后的版本
- 后台 **Nexion-admin-prototype（3002）** 全面整治
- **域替换前置**：剩余域（C/A/G/H/I/B 等）的新设计稿替换由主人在本任务启动前完成；本任务以「12 域全部替换完毕」的代码为审计基线。设计稿本身也存在 bug（主人明示设计稿不可全信）——替换后的域照样全量审计

**事实基线**（2026-06-11/12 三轮侦察 + 回源验证）：
- 前端参考源：~80 路由、verify.sh 229 项仅 smoke、已知 14 个交互断点（含 P0 meta 泄漏：P1-P6 阶段名出现在 Home）、i18n en/zh 差 99 key、6 处死链
- 后台：65 路由；渲染面 = domain-views（*-tabs/ 6,633 行）+ console 路由群（/content/* 等）；弹窗三公用原语（OperationConfirmModal/KConfirmModal/ViewParamModal）+ 各处自定义 Modal；220 onClick / 101 弹窗触发点 / 120 真写 / 130 toast；「90% 不可操作」与静态扫描矛盾，必须运行时定案；已实锤 C 域 2FA toast-only 假写
- 口径：Genesis（$24.08）与衰减曲线（−4/−6/−23.7%·floor22%）双端已对齐处方（早期侦察误报），工作是「上锁」防回漂
- 两端对应性：后台参数面板较全（E3/G1/G4/F2/D5 均有编辑入口），但从未做全站级「前端功能点 ↔ 后台管理模块」对应盘点；三实体 schema 有差异（SKU 85%、提现单 70%、用户 65% 对齐度）

**主人已定决策**（决策记录见文末）：①前端 UniApp 优先 + 全量迁移，参考源只修逻辑级；②缺陷 P0-P2 全修到 0，P3 逐项裁决；③域替换由主人前置完成；④后台与前端功能点一一对应（非真实联动）；⑤spec 化 + MD 文档对照执行；⑥模型分层调度；⑦列表分页/筛选纳入检查范围。

---

## 1. 总体结构：六层

```
L0 范围与基线盘点 ──→ L1 缺陷完美发现层（无遗漏） ──→ L2 缺陷修复层（修到清零）
                                                          ↓
            L5 终验层 ←── L4 防回归哨兵层 ←── L3 功能完整性建设层（一一对应+UniApp 迁移+口径）
```

各层非严格串行：L1 产出台账后 L2 即开工；L4 哨兵随 L2/L3 每修一项同步沉淀；L1 在 L2/L3 期间复跑（发现是持续过程）。

**三条贯穿原则**：
1. **台账驱动**——一切缺陷进台账，修复 PR 引用缺陷 id，关闭以运行时复测为准，禁止「顺手修了没记录」
2. **哨兵单调性**——台账 close 必填 sentinel 字段（指向 verify 检查项/扫描器规则/E2E 用例），哨兵需「跑红→绿」验证真的会咬人，只增不删
3. **改一处全站扫同类**——每个修复 spec 必含同形缺陷全站扫描，同根因合并为缺陷簇统一处理

---

## 2. L0 范围与基线盘点

把整治对象枚举成机器可读清单（后续各层覆盖率的分母）：
1. **路由全集**：前端 app/ 全部 page.tsx + 后台 nav-routes.mjs，双真源交叉校验
2. **弹窗全集**：全仓（含 console 路由，不只 domain-views）grep 所有 Modal/Drawer/Sheet/Dialog 触发点，记触发位置/所用原语/声称的操作语义
3. **可交互元素全集**：每路由 button/link/input/toggle 静态计数（遍历对账基准）
4. **业务流全集**：从 PRD + 运营 SOP 提炼端到端流程（前端：注册/购机/充提/质押/团队/trade-in…；后台：调价/确认提现/处置风控/补全翻译/发活动/改参数…每域 3-5 条运营任务）
5. **功能点对应全集**：前端「应由后台配置」的功能点全集（SKU 字段/费率/提现规则/staking 档位/活动任务/文案 i18n/开关/风控阈值/页面模块…）+ 经济模型处方参数清单（L3a 对应矩阵分母）

存放：`docs/remediation/inventory/*.json`。

---

## 3. L1 缺陷完美发现层（无遗漏机制）

**五源三角化 + 收敛判据 + 完整性批评家**：

### 来源 A · 运行时全遍历（机器视角：存在的东西能不能用）
- 22 个审计分片（前端 10 按业务域 / 后台 12 按域+console 路由群），每分片一个 subagent，~10 路并行
- 协议：curl 预热 → 逐路由 navigate → 枚举全部可交互元素 → 逐个触发 → 断言效果（路由变/DOM 变/弹窗现/toast 现，四选一）。点了无可观测变化 = dead-control；toast 了但刷新后状态丢 = fake-write
- **弹窗五元组**（每弹窗必录）：有无输入控件 / confirm 初始 disabled? / disabled 有无原因解释 / 填合法值能否提交 / 提交后状态真变且 persist。OperationConfirm 必须走完 operator → store/audit→落地全程
- **列表能力基线**（每个数据列表/表格必录，专抓「该有的不在」）：分页（含每页条数/总数）/ 筛选 / 搜索 / 排序 / 空态 五件套逐项记有无；≤5 行静态摘要可豁免分页但需显式标注理由；缺失记 `list-capability`（主人指出的「所有列表无分页、部分无筛选」即此类，预录入）
- 每路由截图 + console.error 收集 + V5 rubric 排版打分（<80 记 layout 缺陷）+ 文案按「用户无外部知识能否理解」记 copy 缺陷

### 来源 B · 任务式走查（运营者/用户视角：想做的事能不能做成）
- 每条业务流一个 persona agent 实际执行：「把 S1 调价到 $1,399」「驳回提现单并留原因」「补全一条 zh 翻译」「用户从注册到第一笔提现」。后台任务**双角色**各跑一遍（superadmin 仍需操作确认 + 普通 operator 操作确认）
- 判定标准：任务能否端到端完成——直接抓「弹窗纯摆设」类缺陷（弹窗在来源 A 记 modal-blocked，在来源 B 记「任务无法完成」——后者是本质）

### 来源 C · 对照审计（规格视角：该有的在不在——正交于「存在的对不对」）
- PRD ↔ 实现：前端对照产品 PRD v3.7、后台对照运营后台 PRD 12 域章节，逐功能点核对声明的功能有没有真落地
- 设计稿 ↔ port 结果：替换后各域对照 design_handoff 包字段级 diff，查 port 走样（漏块/错样式/丢交互/meta 词残留）
- **设计稿本身质量审查**：各包稿内交互逻辑自洽性/数据合理性/与原型铁律冲突点（meta 词、桌面 hover 依赖、MLM 词），稿内 bug 记 `spec-gap`，**原型规则胜设计稿**
- **数据一致性审查**（历史错题专项）：同一实体/事件跨页面同值、时间线自洽、聚合=明细之和、stat 单源派生、演示态数值与 phase 同向——矛盾记 `data-canon`
- 处方 ↔ 参数：经济模型处方清单对照后台参数面板，查缺编辑入口的参数

### 来源 D · 静态扫描器族
死链（href="#"/空 onClick）、i18n key 镜像 diff + 硬编码文案、meta 词表泄漏、disabled 无解释、toast-only 假写模式、列表组件缺件——扩展现有 interaction-audit.mjs / admin-interaction-audit.mjs

### 来源 E · 完整性批评家（审计审计者）
独立 agent 对照 L0 全集问「哪条路由没遍历？哪个弹窗没五元组？哪条流没走？哪个 PRD 点没核对？」缺口打回补测

### 收敛判据（什么叫找完了）
- 覆盖率核算：路由/弹窗五元组/业务流/PRD 功能点 100% 有记录（对照 L0 全集机器核算）
- **loop-until-dry**：五源跑完算一轮；L2 期间受影响区域复跑；终验前全量复跑——**连续两轮 0 新增 P0/P1** 才认定收敛
- 交叉验证：P0 一律双 agent 独立复现后入账

### 缺陷台账（单一事实源）
`docs/audit/ledger.ndjson`（只追加）+ 脚本生成 LEDGER.md 看板。schema：
`id / side(frontend|admin|cross|uniapp) / route / title / category(dead-control|fake-write|modal-blocked|flow-break|task-fail|spec-gap|port-drift|list-capability|layout|copy|i18n|console-error|data-canon|meta-leak) / severity(P0-P3) / repro / expected / actual / evidence / dedup_key / cluster / status(open→spec'd→fixed→verified→closed，前端打磨类可标 fix-in-port) / fix_pr / sentinel(关闭必填) / found_by`

严重级判据：P0=铁律违反/业务流中断/假写/数据错误；P1=可走通但体验断裂（无反馈/无解释/死链/弹窗摆设）；P2=排版/文案/一致性；P3=打磨。已知缺陷（14 断点、C 域 2FA、99 i18n key、/content/i18n 补全弹窗、列表无分页）预录入。

---

## 4. L2 缺陷修复层（修到清零）

### 2a 弹窗逐个细化重构（后台重灾区，最大工作流）
公用弹窗「一个原因框打天下」是病根。按操作语义重新设计弹窗体系：
1. **操作语义分类法**：弹窗全集逐个归类——文本/内容编辑型（如 i18n 补全：多行编辑器+源文对照+预览）/ 参数调整型（数字/选项+当前值+值域+影响面）/ 确认处置型（凭据+处置选项+原因+操作确认）/ CRUD 表单型（走 Drawer）/ 批量操作型 / 向导型 / 纯展示型（显式 readonly，不做假按钮）
2. **每类一个表单原语标准**：可输入控件、校验、提交写入 store action、成功/失败反馈、审计落账、（高敏）操作确认外壳。操作确认 保留为操作确认外壳，**壳内操作表单体按类定制**
3. **每弹窗一张规格卡**（modal-specs/）：触发点/操作目标/所需输入/写入 action/成功后哪里变/失败分支/权限。重构后任务式验证：**弹窗声称的操作必须能真实完成并 persist**
4. 全局机制先行 PR：disabled 必须渲染可见原因（必填项缺/覆盖率红线/权限不足）

### 2b 前端缺陷分流（参考源只修逻辑级）
- **逻辑/铁律级**（meta 泄漏、流程断头、状态机错误、数据错误、假写）→ 修 Next.js 参考源 + 写进迁移 batch spec
- **体验/排版/打磨级** → 不再改 Next.js，缺陷+正确做法写进迁移 spec，UniApp 落地修正版（台账标 `fix-in-port`）

### 2c 全部 12 域（替换后状态）整治
针对来源 C 的 port-drift/spec-gap + 各域台账缺陷，按域出整治 PR。**双重质量 gate 沉淀**：入口审稿 gate（设计稿先过稿内质量审查才许 port——供后续任何替换复用）+ 出口验收 gate（字段级 diff 哨兵、弹窗五元组预检、任务式验收）。

### 2d 列表能力标准化（全站横向）
1. 建统一 **List/Table 原语**（后台 design-kit 扩展）：分页（页码+每页条数+总数）、筛选（按列类型出筛选器）、搜索、排序、空态、行数统计
2. 以 `list-capability` 台账为清单，按域分批替换接入（横向组件 sprint 流程）
3. UniApp 侧建移动端等价物（长列表加载更多/无限滚动 + 筛选 tab）
4. 豁免需显式 `paginationExempt` 注记，哨兵据此放行

### 2e 排版与文案
layout/copy 缺陷按域打包修，依据 nexion-design V5 设计系统；文案标准=「运营者无外部知识能理解此控件做什么、做了会怎样」。

**L2 出口**：台账 P0=P1=P2 全部 closed（运行时复测）；P3 清单交主人逐项裁决。

---

## 5. L3 功能完整性建设层

### 3a 功能点一一对应（后台管理面 ⟷ 前端业务面，不做真实联动）
1. **对应矩阵**：`inventory/feature-mapping.json`——每个前端可配置功能点 ↔ 后台模块/参数 key/编辑入口；反向映射。三态：✅ 对应且可操作 / ⚠️ 有入口但操作不完整 / ❌ 缺口
2. **正向补齐**（前端有、后台无管理入口）：按「动作完整性门」标准补——编辑入口 + 按操作语义定制的弹窗表单体（复用 2a 原语）+ 操作确认（高敏）+ 审计 + 真写后台 store（mock 但 backend-replaceable）。重点预估：staking 档位管理、活动/任务配置、i18n 文案管理（/content/i18n 做成真编辑器即样板）、页面模块开关、提现规则全字段
3. **反向清理**（后台有、前端无对应业务）：虚空管理项逐个裁决——确为前端缺失的转工单，多余的删除（清单交主人）
4. **三实体 schema 对齐**：SKU（lifecycle/status 命名消歧）、提现单（状态机枚举统一）、用户（KYC 分级/冻结/风险分前端补展示位）
5. **数字口径同显**：两端同一业务数字必同值，扩展 sku-field-mirror.mjs 为多实体口径镜像哨兵

**验收（任务式）**：矩阵 100% 无 ❌/⚠️；抽任一前端功能点，后台能完成对应管理任务，真写 persist + 审计可见。

### 3b 替换后残留缺口补齐
若 L1 审计发现某域职能缺失（如 B 域由 overview 页群承担但有缺口），出 spec 经主人确认后补齐。新建/补齐域必过弹窗五元组 + 列表基线 + 任务式验收。

### 3c UniApp 全量迁移（前端交付主体，最大建设工作流）
- 强制走 nexion-uniapp-port skill（四阶段闭环 + cookbook + PORT-LEDGER/PORT-PITFALLS）
- **batch 切分**：核心转化链先行（onboarding→注册→首页→商城→checkout→订单→earn→钱包充提→团队→me），外围页随后，直至 ~80 路由全量迁完；batch 分期清单 M1 后报主人批
- **每 batch spec 必含**：页面清单 + 该范围台账缺陷修正方案（fix-in-port 落地，不照抄参考源 bug）+ i18n key 迁移 + 列表能力达标方案 + 验收断言
- **batch 验收**：uniapp verify.sh 扩展 + 浏览器实景（5173）+ 弹窗/列表基线 + 与参考源并排对照（行为一致、缺陷已修）
- **哨兵随迁**：meta-leak/i18n 镜像/死链/列表能力的 uni 等价物，每 batch 必跑

### 3d 口径上锁
真源链：经济模型处方（人读）→ `docs/remediation/canon-numbers.json`（机读锚点：Genesis $24.08/年化 87.9%/衰减 −4/−6/−23.7%·floor22%/staking 档位/unilevel 7 层/S1 日产 $38.5…）→ 双端代码常量。`canon-sentinel.mjs`（双 repo 各一份，模式抄 sku-field-mirror：相对路径读对端、对端缺失优雅跳过）接入双端 verify.sh——任何一端改数字不改锚点即爆红。顺手收口前端 staking 三套利率表（withdraw 页第三套抄写值是已知 bug）。

---

## 6. L4 防回归哨兵层

| 沉淀时机 | 哨兵 | 落点 |
|---|---|---|
| L1 | 可重跑遍历器（路由+元素+弹窗五元组协议）+ console-error gate + 截图基线 | docs/audit/ + Playwright 套件 |
| L2a | 弹窗可操作性 gate（调用点必有操作表单或显式 readonly；阻塞必有可见文案）+ fake-write 哨兵 + 操作确认全流程 E2E（每域 1 条） | admin-interaction-audit 扩展 + e2e/ |
| L2b | meta-leak 扫描器 / 死链扫描器 / i18n 镜像 gate / 交互 E2E 种子套件 | 前端 verify.sh 新层 + e2e/ |
| L2c | port 字段级 diff 哨兵 + registry/ported/console-nav 一致性脚本 + 入口审稿 gate 文档 | admin verify.sh |
| L2d | 列表能力 gate（数据列表必接 List/Table 原语或显式豁免注记） | 双端 interaction-audit 新规则 |
| L3a/3d | 对应矩阵哨兵（feature-mapping 全 ✅ 才绿）+ 多实体口径镜像哨兵 + canon-sentinel | 双端 verify.sh |
| L3c | UniApp 迁移哨兵随迁（四类哨兵 uni 等价物 + uniapp verify.sh 每 batch 扩展） | Nexion-uniapp scripts/ |
| L5 | nightly-regression.sh 一键全量编排 | admin scripts/ |

---

## 7. L5 终验层（落地级的客观判定，12 条全部机器可判）

1. 三端 verify.sh all 全绿（admin / Next.js 参考源 / uniapp，含全部新增层）
2. **UniApp（5173）**核心业务流 E2E ≥15 条全绿；~80 路由 100% 迁完且每 batch 验收通过；参考源逻辑级缺陷清零
3. 后台每域 ≥3 条运营任务 E2E（任务式），每域至少 1 条完整操作确认流
4. 遍历器复跑 dead-control=0、fake-write=0、list-capability=0
5. 弹窗五元组 100% 通过（全量弹窗清单，含 console 路由与替换后各域）
6. 台账 P0=P1=P2=0；P3 100% 经主人裁决标记
7. feature-mapping 矩阵 100% ✅；抽查任务式验证通过
8. canon-diff=0
9. i18n 镜像 diff=0，双语遍历 0 裸 key 0 硬编码（UniApp 侧为准）
10. meta-leak 0 hit
11. 全路由 console.error=0、404 资源=0
12. 哨兵审计：全部 closed 缺陷的 sentinel 存在且验证过会真实失败

---

## 8. 方案文档体系（spec 化，对照执行）

```
Nexion-admin-prototype/docs/remediation/
├── MASTER-PLAN.md                 # 本文件：总纲+进度打点+决策记录
├── inventory/                     # L0 五张全集清单 + feature-mapping.json
├── specs/                         # 每工单一份 SPEC-<层><序号>-<slug>.md（_TEMPLATE.md 为模板）
├── modal-specs/                   # 每弹窗一张规格卡 <route>--<modal>.md
├── canon-numbers.json             # 口径锚点（机读真源）
└── ../audit/
    ├── ledger.ndjson + LEDGER.md  # 缺陷台账（只追加）+ 人读看板
    ├── runtime-crawl-protocol.md  # L1 遍历协议（SOP，可重跑）
    └── shards/*.ndjson + screenshots/
```

硬规则：①任何实现 PR 必须引用一份 status=approved 的 spec（P0 紧急修可先斩后奏但 24h 内补 spec）；②spec 验收断言必须机器可测，完成时回填证据；③本文件是跨会话接续入口（写进两工程 CLAUDE.md）；④弹窗重构一律先有规格卡再动代码，按域 10-20 张一批交主人过目。UniApp 迁移 batch 台账沿用 Nexion-uniapp/docs/PORT-LEDGER.md。

---

## 9. 模型分工（按任务复杂度分层调度）

原则：①主循环（编排/裁决/与主人对话）始终用会话主模型 **Fable 5**；②subagent 按认知密度分层；③**质量门与模型无关**——任何层级产出过同一套 gate，过不了升一级重跑；④模型名是快照，以会话环境实际可用层级为准。

| 层级 | 模型 | 适用任务 | 落点 |
|---|---|---|---|
| T0 主脑 | Fable 5（主循环/继承） | 方案/spec 设计、架构决策、审计仲裁聚簇、P0 裁决、弹窗原语与全局机制设计、schema 统一、done-review 终审、终验报告 | 来源 E 批评家、L1 仲裁、2a 分类法与原语、各工单 spec、L3 矩阵裁决、L5 仲裁 |
| T1 重实现 | Opus 4.8 | 标准实现工单、需业务理解的审查对照 | 来源 B 走查、来源 C 对照审计、P0 双复现、2a 各域弹窗重构、2c 域整治、3a 补齐、**3c UniApp batch 实现**、哨兵/E2E 编写、nexion-audit 3 路审查 |
| T2 量产 | Sonnet 4.6 | 高量协议化机械执行 | L0 清单生成、来源 A 遍历 22 分片、来源 D 扫描跑批、i18n diff 初稿、终验遍历复跑 |
| T3 轻量 | Haiku 4.5 | 格式化/校验微任务 | 台账 schema 校验、LEDGER 看板生成、截图归档清理、spec 状态检查 |

升降级：T2 分片经 T0 抽检，漏报/误报高的升 T1 重跑；T1 连续两轮过不了审计的工单升 T0 亲做；高敏改动（操作确认语义/财务口径/铁律）一律 T0 设计 + T1 实现 + T0 确认。

---

## 10. 执行治理

**标准工单流水线**：台账拉簇 → 写 spec（按 _TEMPLATE）→ 批准 → 实现（nexion-sprint；UI/文案强制加载 nexion-design；uniapp 强制加载 nexion-uniapp-port）→ nexion-audit 3-agent 审计循环到 P0=0 → done-review 6 维自检 → Playwright 重放 repro 断言已修 + 新哨兵跑红→绿 → 台账更新 + spec 回填证据 → PR（引用 spec 路径+缺陷 id+哨兵 diff）。

**并行编排**：三工程工单全程并行；同 repo 内文件面无交集才并行；全局机制类 PR（弹窗原语/List 原语/操作确认 契约）先行，其余 rebase 其上；审计分片 Workflow ~10 路并行。

**跨会话持久化**：本文件 + ledger.ndjson 是外部状态，任何会话冷启动可接续。每层完成在此打点并汇报主人。

**PRD 同步**：涉功能语义变化的工单，按 Phase 收口批量走 nexion-prd-sync 问询主人确认后同步，不逐单打扰、绝不默跳。

**风险防御**：E2E flake（预热+重试 2 次+flaky 单列+文本断言非像素）；两端 schema 互改互坏（口径镜像哨兵 PR 必跑）；弹窗审计误判（五元组强制运行时取证）；设计稿不可全信（审稿 gate + 原型规则胜设计稿）；哨兵腐化（close 强制跑红→绿+终验哨兵审计）；spec 主观争议（spec 先行经主人确认再实现）；多 agent 写冲突（spec 文件面交集检查）。

---

## 11. 里程碑与主人决策点

| 里程碑 | 内容 | 状态 | 需要主人的决策 |
|---|---|---|---|
| **前置** | 主人完成剩余域新设计稿替换 | ✅ 已满足（2026-06-12 主人下令启动） | — |
| **M0** | 文档体系落库 + L0 五张全集清单 + 台账 schema | ✅ 已完成（2026-06-12）：routes/modals/interactions/business-flows/feature-mapping + ledger schema + 初始 ledger + 运行时遍历协议 + M0/ledger 校验脚本 | — |
| **M1** | L1 第一轮五源发现 → 台账 v1 + LEDGER 看板 + 弹窗分类统计 + feature-mapping 初版 | ⏸ | ① 确认全貌与优先级；② 反向清理裁决；③ UniApp batch 分期清单报批 |
| **M2** | 全局机制 PR（弹窗原语/List 原语+uni 等价物/disabled 原因可见化）+ 参考源逻辑级清零 | ⏸ | ④ 弹窗规格卡按域批审 |
| **M3** | UniApp 核心转化链 batch 迁完（含 fix-in-port 落地） | ⏸ | — |
| **M4** | 后台弹窗 100% 可操作 + 列表标准化全站完成 + 12 域整治清零 | ⏸ | — |
| **M5** | 替换后残留缺口补齐 + UniApp 外围页 batch 持续推进 | ⏸ | ⑤ 缺口 spec 确认 |
| **M6** | UniApp 全量迁完 + feature-mapping 100% ✅ + schema 对齐 + 口径上锁 | ⏸ | — |
| **M7** | L5 终验 12 条全过 → 终验报告 + nightly 一键回归 | ⏸ | ⑥ P3 逐项裁决；⑦ PRD 批量同步确认；⑧ 终验验收 |

---

## 12. 决策记录

| 日期 | 决策 | 内容 |
|---|---|---|
| 2026-06-11 | 修复深度 | P0-P2 全修到 0，P3 逐项交主人裁决 |
| 2026-06-11 | 控制形态 | 不做后台→前端真实运行时控制（原型无接口）；做功能点一一对应矩阵 |
| 2026-06-11 | 文档形态 | spec 化 + MD 文档对照执行，无 approved spec 不开工 |
| 2026-06-11 | 模型分工 | T0 Fable 5 / T1 Opus 4.8 / T2 Sonnet 4.6 / T3 Haiku 4.5，质量门与模型无关 |
| 2026-06-11 | 列表能力 | 分页/筛选/搜索/排序/空态五件套纳入一等检查维度 |
| 2026-06-11 | 前端定位 | UniApp 优先、全量迁移；Next.js 原型降参考源只修逻辑级 |
| 2026-06-12 | 任务时序 | 方案落地后暂存；主人先完成剩余域设计稿替换，再启动本任务 |
