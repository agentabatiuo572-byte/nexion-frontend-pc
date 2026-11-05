# 改版组件 app/components/rd

新页面只用这里的组件。旧组件留到最后一个旧页面迁完。每个组件文件开头都有完整例子，这里写怎么开始、选哪个、别踩哪些坑。

```tsx
import { RdPage, PageHeader, Conclusion, StatBand, Stat, Panel } from "@/app/components/rd";
```

## 迁移一页的起手式

```tsx
<RdPage>
  <PageHeader pageId="D3" title="资金储备与应付款" summary="看平台的钱够不够付，要不要补储备。" actions={…} />
  <Conclusion state="ok" lead icon={ShieldCheck}>资金安全：正常，可覆盖 <b>267</b> 天</Conclusion>
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
| 页头：标题、一句说明、「这页怎么用」、动作、数据时间 | `PageHeader` | `page-header.tsx` |
| 这页怎么用 | `PageGuide`，`PageHeader` 自动带 | `page-guide.tsx` |
| 看板第一句话 | `Conclusion` | `conclusion.tsx` |
| 一排关键数字，最多 4 个 | `StatBand`、`Stat`；整张可点传 `href` 或 `onOpen` | `stat.tsx` |
| 一块内容 | `Panel`；已经在一个面板里的分区传 `plain`，不套底 | `panel.tsx` |
| 区块标题、统计数字前的图标 | `IconTile`，`Panel`、`Stat` 传 `icon` 就有 | `icon-tile.tsx` |
| 切不同内容 | `PageTabs` | `tabs.tsx` |
| 筛同一张表、切时间窗 | `Segments` | `tabs.tsx` |
| 次要内容收起来 | `Fold`，`summary` 必填；区块的「查看…」传 `actions` 放标题行右侧，每块最多一个 | `fold.tsx` |
| 看板里要处理的事 | `TodoList`、`TodoItem`，读不到用 `TodoFailed` | `todo-list.tsx` |
| 一块内容读取中、失败、空 | `BlockState`，折叠摘要里的失败传 `compact` 一行写完；一个数字或一行读不到用 `InlineRetry` | `block-state.tsx` |
| 按天的柱图 | `Bars`，全是 0 别画，写一句话 | `bars.tsx` |
| 表格 | `Table`、`Th`、`Tr`、`Td`、`Cell`；金额、数量、日期传 `num`，单号、哈希、地址才传 `mono` | `table.tsx` |
| 显示更多列 | `useTableColumns`、`ColumnPicker` | `table.tsx` |
| 表格加载、空、失败 | `TableLoading`、`TableMessage` | `table.tsx` |
| 表格分页 | `Pager`，有数据才渲染 | `pager.tsx` |
| 勾选后的批量操作 | `BatchBar`，勾选框用 `Checkbox`，勾选列的表头传 `Th control` | `batch-bar.tsx`、`checkbox.tsx` |
| 行操作放不下 | `MoreMenu` | `menu.tsx` |
| 查询区 | `FilterBar`、`FilterField`、`Input` | `filter-bar.tsx` |
| 下拉、排序 | `Select` | `select.tsx` |
| 单条详情、长表单 | `Drawer`，底部用 `Decision` | `overlay.tsx` |
| 详情开头 3～5 行 | `JudgmentPoints` | `judgment.tsx` |
| 详情里成对的名称和值 | `Facts`、`Fact` | `facts.tsx` |
| 要人看到的提醒、错误、待确认条 | `Notice` | `notice.tsx` |
| 短任务弹窗 | `Modal` | `overlay.tsx` |
| 写操作确认 | 继续用 `OperationConfirmModal` | 见下 |
| 按钮 | `Button`、`IconButton`；和主按钮并排的危险入口用 `danger-outline`，实心 `danger` 只给最终确认 | `button.tsx` |
| 状态 | `StatusTag`；列表筛成只有一种状态时，这个默认状态传 `neutral`（灰字加图标） | `status-tag.tsx` |
| 点开看口径或解释 | `Explain`，`Stat`、`StatusTag` 传 `explain` 就有；把要解释的词写成 children，词带虚线下划线，不加问号 | `explain.tsx` |
| 一个整体分几份 | `Donut` 环图，中间写总额，图例写数；旁边有表格时传 `legend={false}`，表格第一列放色点当图例；两类都有钱才画 | `chart.tsx` |
| 图和数据放一起 | `Figure`，图在左（`width` 是上限）、数据在右，名字和数字挨着；容器窄时上下排，尺和条这类宽图传 `stack="wide"` | `chart.tsx` |
| 几类比大小 | `BarList` 排序条，一个颜色，数字在条右边；`value` 传 `null` 写「样本过小」 | `chart.tsx` |
| 一个读数和红线、健康线比 | `ThresholdMeter` 阈值尺，刻度包住当前值，条的 `tone` 由页面按现有比较传 | `meter.tsx` |
| 一个值落在固定几档里 | `TierBand` 档位带，`current` 由页面传，组件不算档 | `meter.tsx` |
| 柱图、走势线 | `ColumnChart`、`TrendLine`，传槽位 `slot`；趋势只画真实历史 | `chart.tsx` |
| 只读的流程进度：走到哪一步 | `Steps`，当前步从现有状态字段取 | `steps.tsx` |
| 表单字段、勾选 | `Field`、`Check`、`CheckGroup` | `field.tsx` |
| 名称和值成对 | `KeyValues` | `key-values.tsx` |
| 一块内容的加载、空、失败、无权限 | `BlockState` | `block-state.tsx` |
| 页内提示：待生效、结果未知、只读说明 | `Notice` | `block-state.tsx` |
| 确认框里的前后值 | `DiffList` | `diff-list.tsx` |
| 一列固定的等级 | `LevelList` | `level-list.tsx` |

## 颜色：只传 tone，不写色值

组件只收 `tone`，取值在 `tone.ts`，含义在规范 06。

- 状态 `ok`、`warn`、`danger`、`progress`、`done`、`neutral`：这件事现在怎么样。已结束用 `done`，不用 `ok`；列表的默认状态（要处理列表里的待审核）用 `neutral`，颜色留给例外行（VS-21）。
- 角色 `role-1` 金（持有的钱）、`role-2` 青（往来的钱和物）、`role-3` 紫（人和时限）、`role-4` 品红（规则给的数）、`role-other` 灰：页内的数字和图标底。常见数字的槽位看 VS-12。
- 域色 `money`、`users`、`devices`、`risk`、`system`：只用在侧栏和表头小图标（`Th` 的 `tone`）。内容区的数字和图标底不用它。

图表的颜色同理：系列传槽位 `slot`（1 金、2 青、3 紫、4 品红、other 灰），只有表示好坏的条才传状态 `tone`（VS-43）。图里的文字和数字永远是文字色。一个数字先问状态，再问角色。深色主题数字用角色色字，浅色主题数字用正文色、身份靠实色图标底（VS-14），这条在 `rd.css` 里，页面不用管。链接不用品牌色，`rd-link` 是正文色加下划线（VS-06）。数字用 Inter，等宽只给单号、哈希、地址（VS-52）。页面自己的样式也只写 `var(--rd-*)`，变量表在 `tokens.css`。

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

风险、阻断原因放 `JudgmentPoints`，不能放进 `Fold`。有未保存内容时在 `onPrev`、`onNext`、`onClose` 和行的 `onOpen` 里先拦；切条时让旧请求失效，这两件都是页面的事。

## 写操作确认

逻辑全在 `OperationConfirmModal` 里（理由规则、覆盖率拦截、提交中锁定、失败留表单），新旧页面用同一份。放进 `RdPage` 后自动变成：Radix 弹窗、新外观、执行摘要常显、覆盖率提示排在理由上面。新加两个可选属性，旧页面不传就和原来一样：

- `effect`：生效标签，比如 `<StatusTag tone="progress" filled>立即生效</StatusTag>`，只在 `RdPage` 里显示。
- `confirmLabel`：确认按钮写动作，比如 `确认放行`，默认 `确认提交`。
- `statedBrief`：这个操作自己的 `{ impact, check }`，传了摘要就不按文字猜（OP-51）。
- `blockedReason`：这次不能再提交的原因，写在框里，确认按钮禁用。比如提交时发现单据已被别人处理：再调一次 `openActionConfirm`，传最新内容和这个字段，框不关，已填的理由留着。

- `facts`：做决定要核对的事实，常显在业务字段上面，比如收款网络和完整地址。人要在看得到它的地方选核验项。
- `confirmTone`：不能撤销的操作传 `danger`，确认按钮用危险色。
- `coverageLead`：放大方向提示的开头，默认「这项操作会让平台多付钱」，页面可以换成这个操作的白话。覆盖率高于红线时提示是安静的，低于红线才红。

业务表单的字段传 `mustChoose: true` 时不给默认值，下拉多一项「请选择」，必须人选了才能提交。核验类字段（大额放行的「地址与风险信息」、手动退款的「已核实」）和不能撤销的操作的原因都要这样，不能取第一项当默认值。多字段表单传 `derive(key, next)` 时，一个字段变了可以带着别的字段变，比如改等待天数时复查时间跟着变。

## 已经由组件保证的事

- `Button`：`type` 默认 `button`，属性全部透传，`loading` 时点击无效、宽度不变；`disabledReason` 时不可点但能聚焦，悬停和聚焦都看得到原因。
- `Tr`：传 `onOpen` 后 Tab 能到，Enter、Space 打开，行内的按钮、链接、输入不触发。
- `Drawer`、`Modal`：Tab 圈在里面，Esc 只关最上层，打开时聚焦容器，关闭后焦点回到当前高亮行或原来的按钮，`busy` 时全部锁住。
- `PageTabs`、`Segments`：方向键、Home、End 移动并立即选中，禁用项跳过。页签的网址读写在页面做。
- `Select`：方向键环绕，Tab 和 Esc 收起，选后焦点回到触发器，禁用时收起且恢复后不自动展开。`required` 时空串算没选，表单提交被拦下，空值选项不进列表；不必填时空值选项是能选中的「全部」，表单值是空串。
- `FilterBar`：Enter 等于查询；查询中只禁「查询」，条件照常能改；更多筛选收起不丢值。
- 列选择按账号和表格记在本地，记忆损坏时回到默认列，不影响导出和请求。

## 组件不管的事

权限、审批路径、金额规则、网址参数、幂等键，都由页面传入或继续走原来的 lib。组件不改写调用方的文字。

`Cell` 最宽 280，长文本省略，`title` 给全文，只有鼠标能看到。要让键盘也能看，把这段文字放进可聚焦的按钮或链接里（ST-04）。单号这类不能截短的传 `full`（TX-28）。

## 深浅两套主题

深色默认，浅色挂 `data-theme="light"`，两套都正式保留。`theme-switch.tsx` 管三件事：`<ThemeScript />` 在 `app/layout.tsx` 的 `<head>` 里同步执行，首屏按记住的选择设属性，不闪屏；`<ThemeToggle adminId={…} />` 是顶栏和登录页的开关（太阳「浅色」、月亮「深色」）；`useAdminTheme(adminId)` 登录后按账号记住的选择切换。记忆在本机：`nexion-admin-rd-theme` 是最近一次的选择（登录前也用它），`nexion-admin-rd-theme:<adminId>` 是每个账号的选择。网址参数 `?theme=light|dark` 只给截图和验收脚本用，不是入口。

两套主题的差别只在 `tokens.css` 和 `rd.css` 里：浅色数字用正文色、身份靠实色图标底和图表色（VS-14）；白面板加 1px 边、横幅改左侧 3px 状态色竖条加很浅的底（VS-94）；Logo 换横版 on-light（`shell.css`）。页面不写这些。

还没迁移的页面，`console-shell.tsx` 给内容区 `<main>` 挂 `data-theme="dark"` 和 `.rd-legacy`，里面仍是旧的深色取值，侧栏和顶栏跟主题走（VS-95）。迁完一页就把它的路径加进 `lib/nav/console-nav.ts` 的 `REDESIGNED_PATHS`。

## 依赖

`@radix-ui/react-dialog`、`react-popover`、`react-select`、`react-tooltip` 都写确切版本，而且要一起升。它们共用一份 DismissableLayer，版本不齐会装出两份，Esc 就关不准最上层了。
