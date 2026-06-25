# Change Proposal · 节奏骨架值运营可配置(H1 单源 + 全活渲染面镜像)

- **日期**:2026-06-24
- **工作线**:② 运营后台原型(Nexion-admin-prototype, :3002)
- **状态**:Aligned(主人 2026-06-24 选「两个都加」)→ 实现中
- **触发**:主人 `http://localhost:3002/overview/rhythm` 观察「当前节奏状态被写死 12 个月无法调整?」

## Why
平台铁律「后台业务值必须可配置」。排查确认:B4 节奏页只读(设计如此,控制下放 H1);H1 的旋钮矩阵值/阶段切换可调;**但两个节奏骨架值全站写死、任何地方改不了**:
- **12 月总时长**(`command-center.CURRENT_PHASE.total` + `DIAL_MATRIX` 固定 12 行)— 纯 hardcoded,零入口。
- **当前运营月**(`design-data.PHASE.month=7`)— 无「设/推进当前月」控件。

附带的「本阶段进度 58%」(`CUR_PROG`)也是 B4 写死常量,与当前月同属「当前节奏位置」一组。

## What changes
**新建 live 单源(H1 拥有,backend-replaceable 持久键,均走 platform-config setParam + 审计):**
- `H1.rhythm.totalMonths`(默认 12)
- `H1.rhythm.currentMonth`(默认 7)
- `H1.rhythm.phaseProgressPct`(默认 58)

**数据层 `lib/mock/admin/command-center.ts`(节奏集中定义之家):**
- `RHYTHM_WEIGHTS = [2,2,3,1,2,2]`(P1–P6 月数权重,sum=12=默认节奏 shape;改总时长按权重等比重分布,total=12 时精确复现现有查表 canon「月7=P3 / 月8=P4」)。
- `monthToPhase(m, total)` 改权重派生(total-aware,canon-preserving)。
- `rhythmState(pget)` → `{ totalMonths, currentMonth, currentPhase, currentPhaseName, phaseProgressPct }`,读 `H1.rhythm.*` + seed 回退 + clamp(月∈[1,total]·total∈[9,24];min 9 守「每阶段≥1 月、无退化分桶」)。
- `CURRENT_PHASE` / `PHASE` 降级为 seed 默认(注释说明)。

**H1 Phase 调度器(`h-tabs/h1-phase.tsx`)新增「节奏骨架」段(矩阵上方),2 控件:**
1. **节奏总时长**:操作确认 `edit:select`(9/12/15/18/24 月,勾选不手输;去掉 6 月——6 月会把权重最小的 P4 挤成 0 月退化)→ 写 `totalMonths`,新 total < 当前月则一并 clamp 写 currentMonth。amplifies=false。
2. **当前节奏位置**:操作确认 `businessForm:multi-field`(① 当前运营月 select 1..total ② 本阶段进度% number)→ 各值独立写键。amplifies=false。(一组相关值 → 多字段弹窗铁律)
- 矩阵改渲染 `totalMonths` 行;`.cur` 高亮 + isCurrentMonth 双写读 `rs.currentMonth`;越界月(>12 无 seed)回退末 seed 行。KPI/分页豁免 reason 文案派生。

**B4 节奏页(`overview/rhythm/page.tsx`)改为同源镜像:** 读 `usePlatformConfig.params` + `rhythmState(pget)`,删 `CUR_IDX/CUR_PROG/"12个月"/"第7/12月"/"P3扩张期"/"58%"` 全部写死,改派生。(只读不变,只是不再抄快照)

**其余活渲染面同源镜像(防抄快照分叉):**
- `l1-kpi.tsx`(显示「月 {month}」)、`l4-ops.tsx`(当前 phase tab)、首页 `page.tsx` pulseFor 加 `H` case(「第 N/total 月」)、`h-view.tsx` RO_LIVE.H1 头部串(H1 同屏)。

## Out of scope(边界,留 seed 默认)
- B4 的「近8月入金 / 预算环 / 比率趋势」三块独立 demo 数据(与节奏骨架无关,不动)。
- `b.ts` registry summary(B4 是 bespoke page,summary 非活渲染面;留 seed 描述,与默认一致)。
- 阶段→月「边界细调」(各阶段几个月)不做逐阶段编辑,按权重等比重分布;后续可单独控件。
- H3 WEEKLY_MULT「P3 当前」marker / phaseBonus:已是 `PHASE.current` 派生,phase 随月变需另接;本批若 trivial 顺手,否则留 seed(报告列明)。

## Impact
- **页面**:/overview/rhythm(B4)、/growth/phase(H1)、/(首页 pulse)、L1/L4(L 域 KPI)。
- **store**:platform-config 新增 3 个 `H1.rhythm.*` params 键(persist · 审计)。
- **i18n**:admin 全中文,无 i18n 键(新控件文案中文)。
- **PRD**:运营后台 PRD H1 章节(§4)+ B4 章节需补「节奏骨架可配 + 三键」(P7 走 nexion-admin-prd)。
- **不变量风险**:单源派生(rhythmState 唯一真源)· monthToPhase canon 复现(total=12 精确) · backend-replaceable(setParam 键) · 勾选不手输(月/总时长 select) · 多字段弹窗(当前位置)。

## Done-when(P6 逐条回测)
1. H1 改「节奏总时长」→ 9/12/15/18/24 可选并真写持久(刷新仍在);矩阵行数随之变;currentMonth 超界自动 clamp。
2. H1 改「当前运营月」(select 1..total)+「阶段进度%」→ 真写持久;H1 KPI「月 N」+ 矩阵 .cur 行 + h-view 头部串 同步变。
3. B4 `/overview/rhythm` 不含任何写死 12/第7/12/P3/58%;改 H1 后刷新 B4「第 N/total 月 + 当前阶段 + 进度%」跟随变。
4. 首页 H 域 pulse + L1「月 N」+ L4 当前 phase tab 改 H1 后跟随变(无抄快照分叉)。
5. tsc 0 · verify.sh all 全过 · console 0 · audit P0=P1=0。
