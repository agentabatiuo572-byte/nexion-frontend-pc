# 改版组件 app/components/rd

新页面只用这里的组件。旧组件留到最后一个旧页面迁完。每个组件文件开头都有完整例子，这里写怎么开始、选哪个、别踩哪些坑。

```tsx
import { RdPage, PageHeader, Conclusion, StatBand, Stat, Panel } from "@/app/components/rd";
```

## 迁移一页的起手式

```tsx
<RdPage>
  <PageHeader pageId="D3" title="资金储备与应付款" summary="看平台的钱够不够付，要不要补储备。" actions={…} />
  <Conclusion state="ok" lead icon={ShieldCheck}>资金安全：正常，可覆盖 267 天</Conclusion>
  <StatBand>…</StatBand>
  <Panel title="储备组成" icon={PieChart} tone="role-1">…</Panel>
</RdPage>
```

**一定要包 `RdPage`。** 它保留 `.dkpage`，把旧组件的颜色接到新配色，并让里面的旧 `Modal`、`OperationConfirmModal` 走 Radix 弹窗。不包的话，旧弹窗开在新抽屉上按 Esc 会连抽屉一起关。

`PageHeader` 的 `pageId` 同时决定「这页怎么用」的内容，内容写在 `lib/admin/page-guides/index.ts`，没写的页不显示入口。

## 选哪个组件

| 要做什么 | 用 | 文件 |
|---|---|---|
| 页面根 | `RdPage` | `surface.tsx` |
| 页头：标题、一句说明、「这页怎么用」、动作、数据时间；详情页的身份行传 `identity` | `PageHeader` | `page-header.tsx` |
| 这页怎么用 | `PageGuide`，`PageHeader` 自动带 | `page-guide.tsx` |
| 看板第一句话 | `Conclusion`；正常态不放大，`lead` 只在异常或带关键数字时放大；`hint` 只写建议和该做什么，怎么算传 `explain` 进句尾的提示图标 | `conclusion.tsx` |
| 一排关键数字，最多 4 个 | `StatBand`、`Stat`；普通数字 24px，最重要的一个传 `lead` 放到 40px，页面不改字号；这一屏的结论已经放大了数字时不传，每屏一个 40px；没有明显主次的可以不传；整张可点传 `href` 或 `onOpen`；值是 0 或「—」时自动弱化（字色弱、图标底灰、`lead` 不放大），不带数字的文字（「无权限」）16px，传了 `lead` 也不放大；口径传 `explain` 进名称旁的提示图标，`sub` 只放数据。一格至少放得下数字，长金额放不下就换行，不折行不缩字。窄于 900 时 `lead` 独占一行，其余排在下面；没有 `lead` 时四个两两一行，三个留在一行；只有两三个数时 `StatBand` 传 `fit`，每格从内容宽往外长填满一行，不拉成等宽的半格，窄时 `lead` 也不独占一行 | `stat.tsx` |
| 一组经营数字：每个都带对比和分项，要切时段 | `MetricBoard`、`MetricCard`；一张卡四层：名称、主数、对比一行、分项，层高都是定的，同排同高，切时段不跳版。分项是 `rows`（最多三行名称和值），或 `bar` 比例条：两样比哪样多，条下只写图例不写数，全是 0 时写 `bar.empty`。`MetricBoard` 的 `rows` 传这组卡各时段最多几行（比例条算两行），分项区按它留高。0、读不到（`state="failed"`，传 `onRetry`）、读取中（`state="loading"`）分开，没权限不渲染；两套主题 0 和「—」都弱化。整张可点传 `href`，名称行右边有箭头，悬停整张变亮。3、6 张三列，4 张够宽四列，不够两两一行，2 张两列，只有 2 张时分项限宽 360；这组卡任一时段有 8 位以上长金额时页面传 `long`（用导出的 `LONG` 算），内容区窄于 900 时两列，不缩字，切时段列数不变。对比行里可以放一个问号，不撑高这一行。目前只有今日概览用（PG-41），其他页用 `StatBand` | `metric.tsx` |
| 一块内容 | `Panel`；已经在一个面板里的分区传 `plain`，不套底；`sub` 只放数据（范围、单位、数量、时间），解释传 `explain` 进标题旁的提示图标 | `panel.tsx` |
| 区块标题、统计数字前的图标 | `IconTile`，`Panel`、`Stat` 传 `icon` 就有 | `icon-tile.tsx` |
| 切不同内容 | `PageTabs`；`useTabIds` 一处给 id，内容包 `role="tabpanel"`，页签和面板互相指向；`count` 写页签里要处理的数，0 弱化，读不到传「—」，数到上限传「50+」这类文字；页签里面再分一层传 `level={2}`，下划线式（Ant Design Tabs 默认），和外层的底色块分得开 | `tabs.tsx` |
| 筛同一张表、切时间窗 | `Segments` | `tabs.tsx` |
| 表单里二选一、三选一（放在 `Field` 里，自带底槽和抬起的选中项） | `Segments` | `tabs.tsx` |
| 次要内容收起来 | `Fold`，`summary` 必填；区块的「查看…」传 `actions` 放标题行右侧，每块最多一个；这组怎么算传 `explain`，不在折叠里铺长段落 | `fold.tsx` |
| 看板里要处理的事 | `TodoList`、`TodoItem`，读不到用 `TodoFailed`；目标页不可达时不传 `href`，这一行照样提醒，不能点、没有箭头，`sub` 写该找谁 | `todo-list.tsx` |
| 一块内容读取中、失败、空 | `BlockState`，折叠摘要里的失败传 `compact` 一行写完，重试是文字链；一个数字或一行读不到用 `InlineRetry`，同一个样子 | `block-state.tsx` |
| 按天的柱图 | `Bars`，全是 0 别画，写一句话 | `bars.tsx` |
| 表格 | `Table`、`Th`、`Tr`、`Td`、`Cell`；金额、数量、日期传 `num`，单号、哈希、地址才传 `mono`；理由这类长文本列给 `Td` 传 `grow`，占满剩下的列宽，放不下才省略（一张表最多一列）；只有第一行是单号时把它包进 `<span data-mono>`；6 列在 1024 放不下、第一列是长单号时给 `Table` 传 `data-tight`，窄于 1280 时格子最宽 200（`.rd-split` 里始终 200），长单号由页面中间省略，留能区分的尾段；要一直标出来的行给 `Tr` 传 `mark`：带单号进来命中的 `hit`（蓝底），对不上要核查的 `danger`（红底），和打开详情的 `selected` 分开 | `table.tsx` |
| 显示更多列 | `useTableColumns`、`ColumnPicker` | `table.tsx` |
| 表格加载、空、失败 | `TableLoading`、`TableMessage`；失败传 `role="alert"`，自动是失败红 | `table.tsx` |
| 表格分页 | `Pager`，有数据才渲染 | `pager.tsx` |
| 勾选后的批量操作 | `BatchBar`，勾选框用 `Checkbox`，勾选列的表头传 `Th control`；`hint` 收进已勾选数旁的提示图标 | `batch-bar.tsx`、`checkbox.tsx` |
| 行操作放不下 | `MoreMenu` | `menu.tsx` |
| 查询区 | `FilterBar`、`FilterField`、`Input`；范围控件项多、和搜索框排一行放不下时，`scope` 外面包 `<div className="rd-filter-scope-row">`，独占第一行；左标签加一个框（比如「开始时间」和日期时间框）包 `<span className="rd-filter-group">`，折行时不拆开；条件有误时给出错的框传 `aria-invalid`，筛选条里描边是橙黄 | `filter-bar.tsx` |
| 多行输入 | `Textarea`，放进 `Field`；字数传 `count`，写在框的右下角 | `filter-bar.tsx` |
| 中、越、英三语正文 | `LocaleTabs`，切语言不动其他语言的内容，缺内容的页签写「缺失」 | `locale-tabs.tsx` |
| 下拉、排序 | `Select`；放进 `Field` 自动接上 `id`、`aria-describedby`、`aria-invalid` | `select.tsx` |
| 单条详情、长表单 | `Drawer`，底部用 `Decision` | `overlay.tsx` |
| 详情开头 3～5 行 | `JudgmentPoints` | `judgment.tsx` |
| 详情、确认框里成对的名称和值 | `Facts`、`Fact`；确认框的关键数字传 `lead`（每框最多一个，放第一行），值是不带数字的文字时按普通的值显示，大字只给数字；带含义的值传 `tone`；状态变化写 `Change`（改后蓝），已经生效的变化传 `settled`（新值正文色）；值是「—」时自动弱化。放在 `Modal` 里自动带浅底 | `facts.tsx` |
| 按时间发生的操作、状态历史 | `Timeline`；最新在上，主体在组件内经 `maskAuditActor` 打码；仅失败 `danger`、待确认 `warn` 的节点上色 | `timeline.tsx` |
| 提现历史、流水、同组账户等同类记录 | `RecordList`；主值、单位、时间和对象、状态、可复制单号分层；默认 5 条，点「查看全部」展开 | `record-list.tsx` |
| 要人看到的提醒、错误、待确认条 | `Notice`；正文超过一行、动作不止一个时传 `actionBelow`，动作排到正文下面、和正文左对齐，正文占满整条宽；没传时动作有三个以上也会自动换到正文下面一行；多段正文用 `<p>`，段间 8px；按钮和解释它的问号包在 `<span data-pair>` 里挨着；条里的链接不在词中间折行 | `block-state.tsx` |
| 短任务弹窗 | `Modal`；`icon` 是标题前的图标底，`sub` 放标题下的后果标签，危险确认传 `tone="danger"` | `overlay.tsx` |
| 写操作确认 | 继续用 `OperationConfirmModal` | 见下 |
| 确认框、修改框里的版本冲突：框不关，读最新 | `ConflictBar`，放进 `blockedReason` 或框里的错误条；`message` 写这页被改的是什么，`onRead` 读到最新后页面按最新的值重开框（OP-97），读取失败时组件换成统一的一句，已填的留着 | `conflict-bar.tsx` |
| 解除待确认 | `ReleaseModal`；`label` 写原操作，统一的一句话在组件里，页面特有的说明传 `explain`。按原操作重试失败后放不放出「解除待确认」只用 `lib/admin/explicit-rejection.ts` 的 `isExplicitRejection`：带原因码的 4xx 才算，401、403、408、425、429 和 `IDEMPOTENCY_*` 不算 | `overlay.tsx` |
| 按钮 | `Button`、`IconButton`；和主按钮并排的危险入口用 `danger-outline`，实心 `danger` 只给最终确认。高度读 `--rd-control-h`（32）、`-sm`（24）、`-lg`（40），页面不写高度 | `button.tsx` |
| 状态 | `StatusTag`；列表筛成只有一种状态时，这个默认状态传 `neutral`（灰字加图标）；弹窗标题下「不能撤销」用 `IrreversibleTag`，走审批的「批准后生效」把谁来批、批准前什么不变传 `explain`，不写事实行 | `status-tag.tsx` |
| 提示图标和气泡：这是什么、显示位置、生效时间、口径、后果 | `Explain`，悬停、点击、键盘都能开；`Stat` 里的气泡向上、`ConfigRow` 里的向下展开，都从问号左边起，不盖住被解释的数字、不压侧栏，放不下自动翻边；`content` 自由内容（多段用 `<p>`），`rows` 分行写；`Panel`、`Fold`、`Conclusion`、`Stat`、`ConfigRow`、`Field`、`Check`、`CheckGroup`、`KeyValues`、`Decision`、`Drawer`、`StatusTag` 传 `explain` 就自带。正文里的词写成 children 就是虚线下划线，不加图标 | `explain.tsx` |
| 一个整体分几份 | `Donut` 环图，中间写总额，图例写数；旁边有表格时传 `legend={false}`，表格第一列放色点当图例；两类都有钱才画 | `chart.tsx` |
| 图和数据放一起 | `Figure`，图在左（`width` 是上限）、数据在右，名字和数字挨着；容器窄时上下排，尺和条这类宽图传 `stack="wide"` | `chart.tsx` |
| 几类比大小 | `BarList` 排序条，一个颜色，数字在条右边；`value` 传 `null` 写「样本过小」 | `chart.tsx` |
| 表格一格里的 0～1 读数 | `InlineMeter`，`tone` 由页面按现有阈值传 | `meter.tsx` |
| 一个读数和红线、健康线比 | `ThresholdMeter` 阈值尺，刻度包住当前值，条的 `tone` 由页面按现有比较传 | `meter.tsx` |
| 一个值落在固定几档里 | `TierBand` 档位带，`current` 由页面传，组件不算档 | `meter.tsx` |
| 柱图、走势线 | `ColumnChart`、`TrendLine`，传槽位 `slot`；趋势只画真实历史 | `chart.tsx` |
| 只读的流程进度：走到哪一步 | `Steps`，当前步从现有状态字段取 | `steps.tsx` |
| 几条线比走势，或要画目标线、事件线 | `TrendLines`，目标线传 `marks`，事件线传 `event` | `chart.tsx` |
| 表格里看走向 | `Sparkline`，至少两个点才传，数值要在别处读到 | `chart.tsx` |
| 并排两块 | `.rd-split` 放两个 `Panel`。看板里对等的两块等高，`data-even` 再等宽；左边选一行右边看详情的主从结构传 `data-detail`，高度跟内容走。放不下时按内容折成上下排，不写窗口宽度；主从结构给明细面板 `id`，点行后 `scrollIntoView` | `rd.css` |
| 表单字段、勾选 | `Field`、`Check`、`CheckGroup`；页面上常驻表单的说明传 `explain`（标签旁的提示图标），修改框和抽屉里填写时要看的「怎么填」传 `help`；范围、字数传 `hint`，跟在字段名后面。rd 控件直接放就接上 `id` 和错误，别的控件用函数子项 | `field.tsx` |
| 名称和值成对 | `KeyValues`；名称的解释传 `explain`，`sub` 只放数据 | `key-values.tsx` |
| 一块内容的加载、空、失败、无权限 | `BlockState` | `block-state.tsx` |
| 页内提示：待生效、结果未知、只读说明 | `Notice` | `block-state.tsx` |
| 应急页的业务卡：名称、状态、勾选、动作 | `ControlGrid`、`ControlCard`；动作不收进折叠组，说明和后果传 `explain`（`rows`），进名称旁的提示图标 | `control-card.tsx` |
| 确认框里多项修改的前后值 | `DiffList`；只列改了的项，其余收进折叠，某一项的风险传这一行的 `note`；只有一行时写一句「现在 → 改后」 | `diff-list.tsx` |
| 改一个值：现在值、新值输入、方向 | `DiffField`；范围只写 `hint`，方向传 `state`，改了会怎样传 `note` | `diff-list.tsx` |
| 一列固定的等级 | `LevelList` | `level-list.tsx` |
| 配置项：名称、提示图标、当前值、动作 | `ConfigList`（`label` 给这组起名）、`ConfigRow`；一项一行，这是什么、显示位置、生效时间、改了会怎样（`what`、`where`、`when`、`effect`）都在提示图标的气泡里；说明表放 `lib/admin/config-help/`，按参数键取 | `config-list.tsx` |
| 配置页三组以上的分组导航，详情页的分区导航（传 `row` 横排） | `SectionNav`、`useSectionNav`；定位写进网址 `section`，目标在折叠组里先展开，滚到底时亮最后一组 | `section-nav.tsx` |
| 数字输入，单位写在框里 | `NumberInput`；照 Ant Design InputNumber：显示带千分位，`value` 和 `onChange` 里的 `event.target.value` 是不带逗号的原值；宽度按 `min`、`max` 和现在的值定，单位紧跟数字，不拉满；只收数字、一个小数点和允许时的负号，空、填了一半（「-」「.」）和 0 原样交给页面，页面把不是数字的当填错；上下方向键按 `step` 加减。`OperationConfirmModal` 的 `edit.kind: "number"` 在 `RdPage` 里自动用它 | `number-input.tsx` |

## 颜色：只传 tone，不写色值

组件只收 `tone`，取值在 `tone.ts`，含义在规范 06。

- 状态 `ok`、`warn`、`danger`、`progress`、`done`、`neutral`：这件事现在怎么样。已结束用 `done`，不用 `ok`；列表的默认状态（要处理列表里的待审核）用 `neutral`，颜色留给例外行（VS-21）。
- 角色 `role-1` 金（持有的钱）、`role-2` 青（往来的钱和物）、`role-3` 紫（人和时限）、`role-4` 品红（规则给的数）、`role-other` 灰：页内的数字和图标底。常见数字的槽位看 VS-12。
- 域色 `money`、`users`、`devices`、`risk`、`system`：只用在侧栏和表头小图标（`Th` 的 `tone`）。内容区的数字和图标底不用它。

图表的颜色同理：系列传槽位 `slot`（1 金、2 青、3 紫、4 品红、other 灰），只有表示好坏的条才传状态 `tone`（VS-43）。图里的文字和数字永远是文字色。一个数字先问状态，再问角色。深色主题数字用角色色字，浅色主题数字用正文色、身份靠实色图标底（VS-14），这条在 `rd.css` 里，页面不用管。值是 0 或「—」时 `Stat` 自动弱化：字色弱、图标底灰、`lead` 也不放大。链接不用品牌色，`rd-link` 是正文色加下划线（VS-06）。数字用 Inter，等宽只给单号、哈希、地址（VS-52）。页面自己的样式也只写 `var(--rd-*)`，变量表在 `tokens.css`。

## 说明只进提示图标（DP-06）

页面上只留数据（数量、时间、状态）、要处理的事和一句话结论。解释性文字一律收进紧挨着被解释的东西的提示图标：区块副标题里的解释、配置项的这是什么和显示位置、生效时间、操作后果、数字口径、折叠里的长段落、筛选旁的提示。`Panel`、`Fold`、`Drawer` 的 `sub` 只放数据（范围、单位、数量、时间），解释传 `explain`。`Conclusion` 的 `hint` 只写建议和该做什么。`Decision` 的 `note` 只写现在能不能做、为什么不能，按下去会怎样传 `explain`。有疑问先收起来。

## 配置页的排法

样板是 H2 免费试用设置：汇总带下面左边是分组、右边是窄栏，窄栏先放分组导航、再放紧急关闭和当前状态（红按钮不抢首屏），滚动时钉住；窄宽时导航收成一排文字加下划线，钉在顶上，窄栏其余的卡片排到第一组后面，紧急关闭的状态和按钮排成一行，卡的说明在标题旁的提示图标里。配置项的值紧跟名称（名称列最宽 280），动作贴右边线。

```tsx
const nav = useSectionNav(SECTIONS, { ready: !!model, onReveal: (id) => openFold(id) });
<div className="rd-config-layout"><div className="rd-config-grid">
  <div className="rd-config-rail"><SectionNav label="本页分组" items={SECTIONS} nav={nav} /><Panel …>紧急关闭</Panel></div>
  <div className="rd-config-groups">
    <div id={nav.anchor("common")}><Panel title={<span tabIndex={-1} data-section-focus="">常改参数</span>}><ConfigList>…</ConfigList></Panel></div>
    <div id={nav.anchor("advanced")}><Fold title="高级设置" summary="11 项：…" open={…} onOpenChange={…}>…</Fold></div>
  </div>
</div></div>
```

一切正常时用 `Conclusion` 一句话（16px，不放大），和看板、报表、工作台一个样子；有异常才用 `Notice`。每项自己保存，页头不放全局保存。没有修改权限时 `ConfigRow` 不传 `action`。`PageHeader` 的 `guideExtra` 放「这页怎么用」里随数据变的内容。

## 详情页的排法

样板是用户详情（`app/_console/users/search/[id]/page.tsx`），完整客户档案、促销活动详情照它做。从上到下：

```tsx
<RdPage>
  <PageHeader pageId="C1D" title={对象名字} summary="…" back={<Link …>返回用户列表</Link>} actions={<Button>刷新</Button>}
    identity={<>编码、状态、等级</>} meta="注册、最近登录、读取时间" readOnly={整页没有写权限时写一句} />
  <Conclusion …>一句话：有没有要处理的事</Conclusion>   账户受限时这句就是页级提示，一屏只有一条
  {待确认条}
  <StatBand>最多 4 个，点数字定位并展开</StatBand>
  <Panel title="处理入口">次按钮一行，跨页查询用 .rd-links 一行</Panel>
  <Panel title="风险与资产">第一层要看的成对数值，一行排开</Panel>
  <div className="rd-detail-nav"><SectionNav row label="本页分区" items={sections} nav={nav} /></div>
  <div className="rd-detail-groups">
    <div id={nav.anchor("security")}><Fold title="安全" summary="…" alert={…} open={…} onOpenChange={…}>…</Fold></div>
  </div>
</RdPage>
```

- 分区的 `alert` 和折叠组的 `alert` 用同一个值，有异常时默认展开，摘要只写异常。
- 折叠组里的一小块用 `Panel plain headingLevel={3}`，外面包 `.rd-detail-block`；成对的小汇总用 `.rd-detail-values`（`dl`），名字和数字挨着，不拉到面板右端。
- 块里的单条记录点行开 `Drawer`，上一条下一条在当前页的行里切。
- 缺的区块不显示，读取失败只替换这一块，结论句写「X 读取失败，这部分没有判断」。
- 带锚点或 `section` 进来时，等上面的内容读完再定位，不然内容撑开会把目标顶走。

## 单条详情的抽屉

默认关着，列表占满宽度。点一行滑出，浮在列表上，不用暗遮罩，列表不变窄。被点的行传 `selected` 保持高亮，上一条下一条切到视口外的行会自动滚过去。工作台页才让列表和详情并排，并排不用 `Drawer`。

抽屉开着时列表还能滚、还能点：点另一行直接切到那一行，不关抽屉，审核时不用来回开关；点行里的按钮也不关。点空白处或页面其他地方才关，这一下照常点到那个控件。提交中（`busy`）抽屉外面点不了。

```tsx
<Tr selected={row.id === current?.id} onOpen={() => open(row)}>…</Tr>
<Drawer open={Boolean(current)} onClose={close} title="单笔详情" sub={current?.no}
  busy={submitting} nav={{ onPrev, onNext, hasPrev, hasNext }}
  footer={<Decision danger={…} others={…} primary={…} />}>
  <JudgmentPoints rows={…} />
  <Fold title="费用明细" summary="手续费 62.40 USDT" inset>…</Fold>
</Drawer>
```

风险、阻断原因放 `JudgmentPoints`，不能放进 `Fold`。折叠里的 `Facts` 要和上面的事实同一条左边线时，外面包 `<div className="rd-fold-flush">`。有未保存内容时在 `onPrev`、`onNext`、`onClose` 和行的 `onOpen` 里先拦；切条时让旧请求失效，这两件都是页面的事。

## 弹窗里的四层

弹窗、确认框、抽屉里的文字不能一个颜色。打开一个框要一眼分清四件事，规则在规范 06 第十节（VS-100～VS-108），都做在组件里，页面不调字号和颜色：

| 层 | 页面怎么给 | 组件给的样子 |
|---|---|---|
| 这是什么操作 | `title` 只写动作和对象，页面分组和长单号不进标题 | 16px、600，前面 28px 图标底：默认灰，危险确认红，不带业务色 |
| 关键信息 | 金额用 `<Fact lead tone="role-1" unit="USDT">`；前后值用 `DiffList`、`DiffField`；风险等级用 `StatusTag`；部分能撤销用 `<Fact tone="warn">` | 关键数字 24px、600，金额金色（浅色是正文色）；值 14px、500；改后的值进行中蓝 |
| 要填的 | `Field`，必填传 `required` | 字段名 14px、500、主文字；输入内容亮，占位弱 |
| 辅助 | 范围、字数传 `hint`、`count`；说明传 `explain` | 13px 弱文字；能进提示图标就进 |

后果不写成灰字：生效方式是标题下的蓝色标签（`<StatusTag tone="progress" filled>立即生效</StatusTag>`），收不回来的操作再加 `<IrreversibleTag />`；不改线上的写操作（保存草稿、业务继续关停、只改你看到的显示）用灰底标签。红只给危险确认、提交失败和真危险的后果；填错、结果未知、被别人改了用橙黄。同一件事只写一处：范围不在标签、占位、说明里各写一遍，没改时不写「还没改动」，确认按钮禁用并写原因就够。

页面只传内容：`title`、`facts`、`Fact` 的 `lead`、`sub` 或 `effect`。`openActionConfirm`、`openConfirm` 和 `KConfirmModal` 都能传 `title`，`action` 照旧进操作记录，不要动。框里的状态变化写 `<Fact k="状态"><Change from="冻结" to="待审核" /></Fact>`。三个并排的字段放 `<div className="rd-form-grid" data-cols="3">`。540 宽的抽屉里字段一项一行，帮助在窄列里会断词折行（VS-105）。

```tsx
<Modal title="调整同一 IP 每天最多注册多少个账号" icon={SlidersHorizontal} sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} …>
  <DiffField before="3" unit="个" hint="1–10 的整数" error={problem}
    state={changed && <StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag>}
    note={changed && "改成 5：同一 IP 24 小时内注册到 5 个后，新用户注册被拒绝。"}>
    {(control) => <NumberInput {...control} unit="个" min={1} max={10} value={value} onChange={…} />}
  </DiffField>
  <Field label="操作理由" required hint="至少 8 字">
    {(control) => <Textarea {...control} value={reason} count={`${length}/200`} onChange={…} />}
  </Field>
</Modal>
```

## 写操作确认

逻辑全在 `OperationConfirmModal` 里（理由规则、覆盖率拦截、提交中锁定、失败留表单），新旧页面用同一份。放进 `RdPage` 后自动变成：Radix 弹窗、新外观、执行摘要默认收起（标题行写影响）、覆盖率提示排在理由上面。金额、对象、前后值不能只写在 `detail` 里，要传 `facts` 或 `edit`，它们常显。新加两个可选属性，旧页面不传就和原来一样：

- `effect`：生效标签，比如 `<StatusTag tone="progress" filled>立即生效</StatusTag>`，只在 `RdPage` 里显示，位置在标题下面。收不回来的操作在里面再加 `<IrreversibleTag />`，`facts` 里不用再写一行「能否撤销」。
- `title`：框上写的短标题，只写动作和对象。不传就用 `action`；`action` 照旧是记进操作记录的名字，不要为了缩短标题去改它，长单号放 `facts`。
- `confirmLabel`：确认按钮写动作，比如 `确认放行`，默认 `确认提交`。
- `statedBrief`：这个操作自己的 `{ impact, check }`，传了摘要就不按文字猜（OP-51）。
- `content`：比 `facts` 更长的影响块，比如促销奖励影响，放在事实区下面、要填的字段上面，能进事实区一行的不用它。资金信息都排在要填的字段前。框里内容超过一屏时框体一层滚动，头和底栏固定，内容在底栏前渐隐；理由框排在内容最后，不吸底，不盖东西。块用 `.rd-impact`，标题 `.rd-impact-title`，里面的 `Table` 不带面板底色，行距收紧。
- `blockedReason`：这次不能再提交的原因，写在框里，确认按钮禁用。比如提交时发现单据已被别人处理：再调一次 `openActionConfirm`，传最新内容和这个字段，框不关，已填的理由留着。

- `reasonPlaceholder`：理由框的占位，按场景写（TX-11），默认「例如：工单号、处理依据」。
- `facts`：做决定要核对的事实，常显在业务字段上面，比如收款网络和完整地址。人要在看得到它的地方选核验项。金额放第一行传 `lead`，它是这个框最大最亮的字。改一个值的框（`edit`）可以传函数 `(value) => …`：参数是填好的新值，没填好是 `undefined`，事实区随输入变，比如改基准价时「买入价」写 `<Change from="26,390" to="26,900" />`。函数每次都要返回事实块，没填好时写现在的值，事实区不跳。
- `confirmTone`：不能撤销或直接动钱的操作传 `danger`，确认按钮用危险色、标题前是红底警告图标（退款、拒绝、紧急关闭、强制扣款）。能解除的处置和放宽类判断不传。`KConfirmModal` 的 `ConfirmReq` 认同一个字段。
- `reasonPolicyOptional`：理由规则读不到时按默认 8–200 继续。只给紧急关停（Q-06），放大资金流出的操作不传。
- `approval`（整组审批，不带 `heading`）：在 `RdPage` 里和直接生效的框一个样子：标题下默认是「批准后生效」标签（谁来批、批准前什么不变进标签的提示，页面可以传 `effect` 换成自己的标签），覆盖率是安静的一行，不再铺橙黄横幅，理由叫「操作理由」。`coverageCheckCopy` 进覆盖率那行的提示。
- `coverageLead`：放大方向提示的开头，默认「这项操作会让平台多付钱」，页面可以换成这个操作的白话。读到覆盖率且不低于红线时，提示是安静的一行「兑付覆盖率 753.8%，红线 100.0%」（两个数都是一位小数），这句开头和检查说明进提示图标；低于红线才红，写全文。页面自己把覆盖率写进 `coverageLead` 时也只留这一句，检查说明进提示图标。

业务表单（`businessForm` 的 `multi-field`）的字段传 `explain` 时，字段名旁出现提示图标；校验不过的提示失焦或点过提交才出现，用橙黄。`multi-field` 不传 `title` 时没有分组小标题，只有一组字段就别传，框的标题已经说了（VS-104）。

框里的控件在 `RdPage` 里是一套样子：业务表单的下拉都是 rd `Select`，输入框高 32，字段名到控件 8，勾选框是 Ant Design 的样子，`Btn` 就是 rd `Button`，确认按钮不带勾。页面自己写的原生 `<select>` 不在这里面，要换成 `Select`。

改一个值的确认框（`edit`）在 `RdPage` 里自动用 `DiffField`：现在值在左、新值输入在右，数字放大，不再有「新值 · 当前 X」的标签和「当前 X」的占位。再给三个可选项：`hint` 写怎么填（范围只写这里），`preview(value)` 写改了会怎样、随输入变化，这两项只在 `RdPage` 里显示（CP-87）；`emptyOption` 写清空选项的名字，比如「不设上限」，要人点它才算清空，框里没填或填坏了都不算。`disallowCurrent` 时没改动不能保存，框里写原因（OP-18）。

确认框提交中锁住里面全部输入、选项、取消和 ×，失败后恢复（OP-33）。数字框填坏（只填了「-」「.」）不算空，不能提交。

理由字段写「操作理由 * 至少 8 字」，上限在理由框角落的字数里。缺什么写在灰按钮的提示里，刚打开不报错，字段失焦或点过提交才在字段下用警告色写原因。框里填过内容后点空白不关；按 Esc 先在底栏左边轻提示「再按一次 Esc 关闭，已填的内容不保留」，再按一次才关，接着打字就收起提示重新算；×、取消照常关，搜索框里打字不算填内容（`data-search`）。多字段表单里，每个字段的范围、格式错写在这个字段下；跨字段的 `feedback` 传 `field` 就写在那一项下面，不传写在表单最后。

收到权限层的 403（`ADMIN_PERMISSION_DENIED`、`ACCESS_DENIED`）时共用层提示「这个账号没有这项权限」，关框，外壳重读权限，页面上的按钮随之收起。业务规则的 403 有自己的说明，按普通失败留在框里。页面自己的表单（不走 `OperationConfirmModal`、`KConfirmModal`）在 catch 里用 `isPermissionDenied(error)` 判断，调 `announcePermissionDenied()` 后自己关框。

`useToast` 保留 `[toastNode, setToast]` 调用方式，提示统一交给根布局的 `ToastHost`，发起页面卸载后仍显示。没有框开着时提示条顶部居中、距视口顶 8px（Ant Design Message），落在顶栏那一条里，不盖页标题和页头的主按钮。打开 `Modal`（含 `OperationConfirmModal`、`KConfirmModal`）或全局确认框时立即清掉旧提示；框打开后新来的提示放在最上层框的标题下面，参与排版，不覆盖标题或表单。默认 3 秒，悬停暂停，移开重新计时。

提示类型写第二个参数：`setToast("已保存", "success")`，失败 `error`，要人注意和结果未知 `warn`，其余 `info`。没传时按文字判断：「已」开头又没有转折「但」是 `success`，含「失败」「错误」是 `error`，含「未确认」「待确认」「未完成」「不能」「无法」「没有提交」是 `warn`，别的是 `info`。这是迁移期的兜底，页面都传了就删。`Notice` 的 `tone` 同理，按这条提示说的事传，不要整页写死一种：失败 `danger`、等人处理 `warn`、已完成 `ok`、处理中 `progress`。

`Conclusion` 的气泡标题可传 `explainTitle`，默认仍为「这句话怎么算」。`PageGuide` 的技术信息用 `Fold`，默认收起，`more` 是纯文字，按句号和分号一句一行；三个分区标题 16/600，最常做的三件事一件一个 14/500 的小标题，步骤一行一步。页面编号只作为查找指南的内部键。

旧的 `KConfirmModal` 放进 `RdPage` 后同样换新外观；`statedBrief`、`effect`、`reasonPlaceholder` 用法同上。它按 A2 理由规则和可见字符计数，规则读不到时按默认 8–200 继续，紧急关闭这类操作继续用它（Q-06）。

业务表单的字段传 `mustChoose: true` 时不给默认值，下拉多一项「请选择」，必须人选了才能提交。核验类字段（大额放行的「地址与风险信息」、手动退款的「已核实」）和不能撤销的操作的原因都要这样，不能取第一项当默认值。多字段表单传 `derive(key, next)` 时，一个字段变了可以带着别的字段变，比如改等待天数时复查时间跟着变。

## 已经由组件保证的事

- `Explain`：鼠标悬停 100ms 打开、移开关闭，不抢焦点；点击或 Enter、Space 打开并钉住，焦点进气泡，再点一下、Esc 或点外面关闭，焦点回到图标；触屏点一下就开。图标 14px、弱文字色，全站一个样子。
- `Button`：`type` 默认 `button`，属性全部透传，`loading` 时点击无效、宽度不变，没传 `loadingText` 时显示转圈；`disabledReason` 时不可点但能聚焦，悬停和聚焦都看得到原因，点一下走 `onBlockedClick`；在 `Modal`、`Drawer` 的底栏里原因气泡朝左开（Ant Design Tooltip `placement="left"`），不往上盖理由框角上的字数。浅色主题次按钮浅底描边、深色填底（VS-94）。禁用不靠透明度，所有样式一个中性灰，两套主题强度一样。
- `IconButton`：`aria-label` 同时是悬停和聚焦时的提示，不用再包一层。
- `Panel`：标题行放不下时动作换到下一行，标题不拆字。
- `Table`：放不下时横向滚动，两侧影子提示还有内容；右对齐列的格子贴右边；悬停不盖选中色。操作列传 `sticky="end"`，默认右对齐，窄屏时固定在右边。
- `Steps` 排法跟上游：图标和文字一行，连线跟在文字后面，第一步贴左；`TrendLines` 的纵轴包住全部值和线，值和线都远离 0 时从整齐的低值起。
- `Tr`：传 `onOpen` 后 Tab 能到，Enter、Space 打开，行内的按钮、链接、输入不触发。焦点环画在格子上，固定列也是完整的框；`mark` 的底色选中时不变。
- `Table`：内容能横向滚时，固定列朝内容一侧带影子，滚到头消失。
- `Modal`：模态，Tab 圈在里面。`Drawer`：不挡外面的列表，不写 `aria-modal`，Tab 走到头回到页面。两者都是 Esc 只关最上层，打开时聚焦容器，关闭后焦点回到当前高亮行或原来的按钮，`busy` 时全部锁住。
- `Decision`：危险决定在左，主决定在右；只有危险决定时放右边，和别的框收在同一条线上。`explain` 的问号没有 `note` 时紧挨右边的按钮，不孤零零留在左下角。
- 整页表单的操作行用 `<div className="rd-toolbar" data-end="">`：状态和提示图标在左，按钮在右，顺序和抽屉底部一样。
- `PageTabs`、`Segments`：方向键、Home、End 移动并立即选中，禁用项跳过。页签的网址读写在页面做。
- `Select`：方向键环绕，Tab 和 Esc 收起，选后焦点回到触发器，禁用时收起且恢复后不自动展开。`required` 时空串算没选，表单提交被拦下，空值选项不进列表；不必填时空值选项是能选中的「全部」，表单值是空串。
- `FilterBar`：有 `notice` 时「条件未应用」这类 `result` 和原因排在一行；Enter 等于查询；查询中只禁「查询」，条件照常能改；更多筛选收起不丢值。`action` 换掉「查询」的位置，Enter 仍走 `onSubmit`；自定义日期这类第二行放进 `.rd-filter-line`。
- 列选择按账号和表格记在本地，记忆损坏时回到默认列，不影响导出和请求。按钮写「显示更多列」，选了才写「· 已选 n」。
- `Fold`：`alert` 的颜色只给这一行的摘要，折叠里的内容和子折叠不跟着变色。
- `ConfigRow`：气泡里的说明同时拼成一句给读屏，「这是什么：…。」一项一句；说明自己带了句末标点（。！？；）就不再补句号，页面写不写「。」都行。
- `JudgmentPoints`：有的行带图标时，不带的留出位置，标签一条线；值线和 `Fact` 一样。
- `Textarea`：随内容长高，不在外层滚动里再套一层滚动。
- 宽抽屉（`wide`）窄屏时停在侧栏右边。抽屉头下面有条线，内容滚上去不切成半行。

## 组件不管的事

权限、审批路径、金额规则、网址参数、幂等键，都由页面传入或继续走原来的 lib。组件不改写调用方的文字。

`Cell` 最宽 280，长文本省略。传 `title`：被切时格子可聚焦，悬停和聚焦都看全文（ST-04）。单号这类不能截短的传 `full`（TX-28）。

用户写的内容（聊天气泡）加 `data-user-content`：那是数据，不是页面文字，量尺不按解释长句算。

## 深浅两套主题

深色默认，浅色挂 `data-theme="light"`，两套都正式保留。`theme-switch.tsx` 管三件事：`<ThemeScript />` 在 `app/layout.tsx` 的 `<head>` 里同步执行，首屏按记住的选择设属性，不闪屏；`<ThemeToggle adminId={…} />` 是顶栏和登录页的开关（太阳「浅色」、月亮「深色」）；`useAdminTheme(adminId)` 登录后按账号记住的选择切换。记忆在本机：`nexion-admin-rd-theme` 是最近一次的选择（登录前也用它），`nexion-admin-rd-theme:<adminId>` 是每个账号的选择。网址参数 `?theme=light|dark` 只给截图和验收脚本用，不是入口。

两套主题的差别只在 `tokens.css` 和 `rd.css` 里：浅色数字用正文色、身份靠实色图标底和图表色（VS-14）；白面板加 1px 边（VS-94）；输入框、下拉和确认框里的旧字段白底加 1px `--rd-line-strong` 描边，悬停 `--rd-control-line`（Ant Design Input），禁用和只读保留灰底，填错时只留外框；Logo 换横版 on-light（`shell.css`）。告警横幅和 `Notice` 两套主题一个样子：浅底加同色 1px 边，取 Ant Design Alert 默认。页面不写这些。

还没迁移的页面，`console-shell.tsx` 给内容区 `<main>` 挂 `data-theme="dark"` 和 `.rd-legacy`，里面仍是旧的深色取值，侧栏和顶栏跟主题走（VS-95）。迁完一页就把它的路径加进 `lib/nav/console-nav.ts` 的 `REDESIGNED_PATHS`；路径带对象编号的详情页加进 `REDESIGNED_DETAIL_PREFIXES`。

## 依赖

`@radix-ui/react-dialog`、`react-popover`、`react-select`、`react-tooltip` 都写确切版本，而且要一起升。它们共用一份 DismissableLayer，版本不齐会装出两份，Esc 就关不准最上层了。

## 成组记录（VS-109）

`Fact` 一项只放一条事实，不能用分隔符或多个子块拼记录。按时间发生的过程用 `Timeline`，同类对象用 `RecordList`。它们都能直接放进 `Fold`、`Drawer`，空态分别是「暂无操作记录」「暂无记录」；读取中、失败交给外层 `BlockState`。

```tsx
<Fold inset title="操作记录" summary={`共 ${events.length} 条`}>
  <Timeline entries={events} />
</Fold>
<RecordList label="提现历史" records={[
  { id: "1", value: "1,000.00", unit: "USDT", at: "2026-11-06T09:00:00+08:00",
    object: "TRON", status: <StatusTag tone="done">已完成</StatusTag>, reference: "WD20261106001" },
]} />
```

`TimelineEntry` 的 `id`、`action`、`actor`、`at` 必填，`detail`、`role`、`ip`、`tone` 选填。组件复制后排序，不改写输入记录。`RecordListEntry` 的 `id`、`value` 必填，`unit`、`at`、`object`、`status`、`reference` 选填，保持调用方的顺序。两者的 `at` 都传原始时间，显示按业务时区写成 `2026-11-06 09:00`（`Timeline` 带秒），时区只写在第一条有时间的记录上（TX-25、TX-26）；不把后端无时区时间当浏览器时间。金额由调用方按业务精度格式化，组件提供 tabular-nums 和单位层级。单号等宽、换行、复制有成功或失败反馈，复制按钮有完整名称。

`DiffField` 的 `hint` 和 `error` 写在新值输入框正下方，和输入框左对齐（Ant Design Form.Item 的 help、extra，VS-103「范围写在输入框下面」）；`note`（改了会怎样）仍在整块下面占整行。原有输入框的 `aria-describedby` 仍连接这些提示。

结构采用 [Ant Design Timeline](https://ant.design/components/timeline/) 的单侧节点、连线和事件内容，以及 [List](https://ant.design/components/list/) 的横排主内容、右侧附属信息、行分隔和默认 `12px 0` 内边距。节点灰色、失败红、待确认橙黄，14/22 正文、13/18 辅助，以及超过 5 条折起，是 VS-109 的产品差异；颜色全部取已有 `--rd-*`。
