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
| 一排关键数字，最多 4 个 | `StatBand`、`Stat` | `stat.tsx` |
| 一块内容 | `Panel` | `panel.tsx` |
| 区块标题、统计数字前的图标 | `IconTile`，`Panel`、`Stat` 传 `icon` 就有 | `icon-tile.tsx` |
| 切不同内容 | `PageTabs` | `tabs.tsx` |
| 筛同一张表、切时间窗 | `Segments` | `tabs.tsx` |
| 次要内容收起来 | `Fold`，`summary` 必填 | `fold.tsx` |
| 表格 | `Table`、`Th`、`Tr`、`Td`、`Cell` | `table.tsx` |
| 显示更多列 | `useTableColumns`、`ColumnPicker` | `table.tsx` |
| 表格加载、空、失败 | `TableLoading`、`TableMessage` | `table.tsx` |
| 查询区 | `FilterBar`、`FilterField`、`Input` | `filter-bar.tsx` |
| 下拉、排序 | `Select` | `select.tsx` |
| 单条详情、长表单 | `Drawer`，底部用 `Decision` | `overlay.tsx` |
| 详情开头 3～5 行 | `JudgmentPoints` | `judgment.tsx` |
| 短任务弹窗 | `Modal` | `overlay.tsx` |
| 写操作确认 | 继续用 `OperationConfirmModal` | 见下 |
| 按钮 | `Button`、`IconButton` | `button.tsx` |
| 状态 | `StatusTag` | `status-tag.tsx` |
| 点开看口径或解释 | `Explain`，`Stat`、`StatusTag` 传 `explain` 就有 | `explain.tsx` |

## 颜色：只传 tone，不写色值

组件只收 `tone`，取值在 `tone.ts`，含义在规范 06。

- 状态 `ok`、`warn`、`danger`、`progress`、`done`：这件事现在怎么样。已结束用 `done`，不用 `ok`。
- 角色 `role-1` 金（持有的钱）、`role-2` 青（往来的钱和物）、`role-3` 紫（人和时限）、`role-4` 品红（规则给的数）、`role-other` 灰：页内的数字和图标底。常见数字的槽位看 VS-12。
- 域色 `money`、`users`、`devices`、`risk`、`system`：只用在侧栏和表头小图标（`Th` 的 `tone`）。内容区的数字和图标底不用它。

一个数字先问状态，再问角色。页面自己的样式也只写 `var(--rd-*)`，变量表在 `tokens.css`。

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

`Cell` 的长文本用 `title` 给全文，只有鼠标能看到。要让键盘也能看，把这段文字放进可聚焦的按钮或链接里（ST-04）。

## 深浅切换（临时）

网址加 `?theme=light` 或 `?theme=dark`，选择记在浏览器里，默认深色。选定后删掉 `theme-switch.tsx`、`app/layout.tsx` 里的引用、`tokens.css` 里落选的那一套、`rd.css` 里 `:root[data-theme="light"]` 这个选择器，以及 `shell.css` 里落选的 Logo 规则和对应的图（`public/uvel-mark-dark.png` 或 `public/uvel-lockup-on-light.png`、`public/uvel-symbol.png`）。旧页面浅色下靠 `rd.css` 的变量映射保持可读，写死颜色的地方不会跟着变。

## 依赖

`@radix-ui/react-dialog`、`react-popover`、`react-select`、`react-tooltip` 都写确切版本，而且要一起升。它们共用一份 DismissableLayer，版本不齐会装出两份，Esc 就关不准最上层了。
