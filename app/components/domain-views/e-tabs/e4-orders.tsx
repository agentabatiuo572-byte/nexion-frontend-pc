import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, Coins, Copy, History, Package, Receipt, RefreshCw, Route, Server, User, Workflow } from "lucide-react";
import {
  BlockState, Button, Cell, Change, ColumnPicker, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, IrreversibleTag,
  JudgmentPoints, Notice, PageHeader, Pager, Panel, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Steps, Table, TableLoading, TableMessage, Td, Th, Tr,
  useTableColumns, type JudgmentRow, type SegmentItem, type TableColumn,
} from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { E4_CLOSE_REASONS, E4_CLOSE_REASON_LABELS, E4_REFUND_REASONS, E4_REFUND_REASON_LABELS, e4FundingLedgerHref } from "@/lib/admin/e4-client";
import { operatorOrderFact, operatorOrderHistoryActor, operatorOrderHistoryReason } from "@/lib/admin/e-operator-display";
import { fmtPct } from "@/lib/format";
import { useReach } from "@/lib/nav/use-reach";
import { PromotionRefundImpact } from "../promotion-refund-impact";
import type { E4PendingCommand, EViewCtx } from "./types";
import { E4_PAGE_SIZES, ORDER_FINAL_STATES, ORDER_FLOW, ORDER_STATE_GROUPS, ORDER_STATE_TONE, orderAmount, orderAmountDigits, orderMoney, stateLabel, type E4Query } from "./data";

const FLOW_STATES = ["placed", "paid", "provisioning"];
const FAILED_STATES = ["payment_failed", "provisioning_failed", "chargeback"];

// 状态的白话：这个状态意味着什么、下一步谁来做（DP-35）。流程示意和抽屉共用。
const STATE_TEXT: Record<string, string> = {
  placed: "用户已下单，还没付款。付款记录确认到账后才算已支付，后台不能手动标记。",
  paid: "用户已付款。款项结算、设备和数据中心都到位后，才能推进到开通中。",
  provisioning: "设备放在平台机房托管，不发实物，所以开通时要分配数据中心。设备激活后，才能推进到已激活。",
  activated: "设备已激活，订单已交付。",
  inventory: "设备已进用户的设备仓库，还没激活。这也算已交付。",
  payment_failed: "下单后未成功扣款",
  expired: "订单超时未支付",
  provisioning_failed: "开通没有完成，订单已终止。已付款的单可以退款",
  refunded: "人工退款，钱已退回，相关记录已冲回",
  chargeback: "支付渠道拒付 / 争议",
  cancelled: "仅未支付订单可取消。用户未付款，订单已终止",
};
// 列表第二行：只写状态本身确定的下一步，事实够不够要进详情才知道。
const STATE_NEXT: Record<string, string> = { placed: "等用户付款", paid: "待开通设备", provisioning: "待激活设备" };

const REFUND_CHANNEL_LABELS: Record<string, string> = { WALLET: "用户的 USDT 钱包", ORIGINAL_PAYMENT: "原支付渠道" };
// 标记失败的真实后果（后端 ORDER_TRANSITIONS、ORDER_STOCK_RELEASE_STATES）：拒付之后没有任何可走的状态，开通失败后还能退。
const TERMINAL_IMPACT: Record<string, string> = {
  placed: "订单终止，占用的库存放回",
  paid: "订单标为拒付，到此结束",
  provisioning: "订单标为开通失败，到此不再开通",
};
const TERMINAL_REFUND: Record<string, string> = {
  placed: "不涉及，用户还没付款",
  paid: "拒付后不能再退款，要退钱先退款，不要标记",
  provisioning: "这一步不退款，之后可以走退款",
};
// 每个审批框都一样的话，收进生效标签的提示图标，不和金额、用户同档（N09）。发起人不能批自己的单（后端 A2_MAKER_CHECKER_REQUIRED）。
const APPROVAL_NOTE = "超级管理员批准后才执行，批准前这单不变。发起人不能批自己提交的单。";

const ORDER_COLUMNS: readonly TableColumn[] = [
  { key: "order", label: "订单号", locked: "第一列不能关" },
  { key: "state", label: "状态", locked: "状态要一直看得到" },
  { key: "user", label: "用户" },
  { key: "sku", label: "商品" },
  { key: "amount", label: "金额" },
  { key: "dc", label: "数据中心", extra: true },
  { key: "age", label: "下单至今" },
];

/** 列表里中间省略，状态才不被挤走；全值在悬停、读屏和抽屉里（ST-04）。 */
const shortNo = (value: string) => value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;
const statusOption = (state: string) => ({ value: state, label: stateLabel(state) });

export function E4Orders({ ctx }: { ctx: EViewCtx }) {
  const { orders, e4Query: query, e4Counts: counts, e4Loading: loading, e4Error: error } = ctx;
  const reach = useReach();
  const [releasing, setReleasing] = useState<E4PendingCommand | null>(null);
  const columns = useTableColumns("e4-orders", ORDER_COLUMNS);
  const currentGroup = ORDER_STATE_GROUPS.find((group) => group.value === query.group);
  // 数量只写在汇总和流程表里，分段不再带数（DP-61）。
  const segments: SegmentItem<E4Query["group"]>[] = [
    { value: "all", label: "全部" },
    ...ORDER_STATE_GROUPS.map((group) => ({ value: group.value, label: group.label, tone: group.tone })),
  ];
  const countOf = (states: readonly string[]) => counts ? states.reduce((sum, state) => sum + (counts[state] ?? 0), 0) : undefined;
  const flowCount = countOf(FLOW_STATES);
  // 要人工的单：等开通或激活的，加开通失败等退款的（后端把开通失败都记成已付款）。
  const flowWait = countOf(["paid", "provisioning"]);
  const refundWait = counts?.provisioning_failed ?? 0;
  const waitCount = flowWait === undefined ? undefined : flowWait + refundWait;
  const searchNote = query.keyword ? "按当前搜索词算。" : "";
  const waitTitle = flowWait && refundWait ? <>有 <b>{waitCount}</b> 单要处理</>
    : refundWait ? <>有 <b>{refundWait}</b> 单开通失败待退款</> : <>有 <b>{flowWait}</b> 单等开通或激活</>;
  const waitHint = `${flowWait && refundWait ? `${flowWait} 单等开通或激活，${refundWait} 单开通失败待退款。` : ""}${flowWait ? "点一行看差什么。" : "点一行核对付款和覆盖率，再提交退款。"}`;
  // 怎么算、去哪做收进结论旁的提示图标（DP-06）。
  const waitExplain = `${flowWait ? "设备分配和激活在「设备运行管理」做。" : ""}${searchNote}` || undefined;
  const failedCount = countOf(FAILED_STATES);
  const countState = ctx.e4CountsFailed ? "数量暂时读不到" : counts ? undefined : "读取中";
  const activated = orders.filter((order) => ctx.orderState(order) === "activated");
  const hasConditions = query.group !== "all" || query.state !== "" || ctx.e4KeywordInput !== "";
  // 同一列按这一页最多的小数位补零，小数点对齐（ST-02）。
  const amountDigits = Math.max(2, ...orders.map((order) => orderAmountDigits(order.amt)));
  // 小数相加有浮点尾巴（0.1 + 0.2），收回到原始金额的位数再显示。toFixed 最多 100 位。
  const activeAmount = Number(activated.reduce((sum, order) => sum + order.amt, 0).toFixed(Math.min(amountDigits, 100)));
  const tableColumns = ORDER_COLUMNS.filter((column) => columns.isVisible(column.key)).length;
  const countText = (state: string) => `${counts?.[state] ?? "—"} 单`;

  return <>
    <PageHeader pageId="E4" title="订单进度" summary={<AutoGloss>查设备订单到哪一步，处理交付、失败和退款。</AutoGloss>}
      meta={<span className="rd-toolbar">
        <span>{ctx.e4ReadAt ? `${ctx.e4ReadAt} 读取（${businessZone().label}），` : ""}切回这页时自动读取</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => void ctx.refreshE4()}>刷新</Button>
      </span>}
      readOnly={ctx.canWriteE4 || ctx.canRefundE4 ? undefined : "你只能查看；处理订单需要对应的修改权限"} />

    {ctx.e4Pending.map((record) => {
      const expired = record.expiresAt <= Date.now();
      // 能查原提案就先查，明确查不到才重试；重试要当前还有这项写权（OP-93）。
      const canRetry = record.spec.command.op === "e4_order_refund" ? ctx.canRefundE4 : ctx.canWriteE4;
      const needQuery = ctx.canQueryE4 && !ctx.e4QueryMissing.includes(record.commandKey);
      const retryBlock = expired ? undefined : !canRetry ? "这个账号已没有这项权限，请有权限的同事处理" : needQuery ? "先查原提案，明确查不到才能重试" : undefined;
      return <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`}
        action={<>
          {ctx.canQueryE4 && <Button size="sm" disabled={!!ctx.e4Retrying} onClick={() => void ctx.checkE4Pending(record)}>查询原提案</Button>}
          <Button size="sm" loading={ctx.e4Retrying === record.fingerprint} disabled={!!ctx.e4Retrying || expired} disabledReason={retryBlock} onClick={() => void ctx.retryE4Pending(record)}>按原操作重试</Button>
          {ctx.e4RetryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!ctx.e4Retrying} onClick={() => setReleasing(record)}>解除待确认</Button>}
        </>}>
        {formatBusinessTimeFull(new Date(record.createdAt).toISOString(), "—")}（{businessZone().label}）发出，可能已经提交。{expired ? "已超过 24 小时，不能再重试，请到操作记录与审批核对。" : !canRetry ? "这个账号已没有这项权限，不能重试。" : needQuery ? "先查原提案，查不到再按原操作重试。" : "重发原内容，已成功的不会重复执行。"}这单在有结论前不能再操作。
        {reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href={`/platform/audit?domain=E&object=${encodeURIComponent(record.orderNo)}`}>到操作记录核查</Link></>}
        <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 理由 ${record.spec.reason}`} />
        {ctx.e4PendingNotes[record.fingerprint] && <div>{ctx.e4PendingNotes[record.fingerprint]}</div>}
      </Notice>;
    })}

    {ctx.e4CountsFailed
      ? <Conclusion state="unknown" action={<Button size="sm" onClick={() => void ctx.refreshE4()}>重试</Button>}>订单数量读不到，还不知道有没有要处理的</Conclusion>
      : waitCount === undefined ? <Conclusion state="unknown">正在读取有没有要处理的订单…</Conclusion>
        : waitCount > 0
          ? <Conclusion state="warn" lead hint={waitHint} explain={waitExplain}
              action={<>
                {!!flowWait && <Button size="sm" onClick={() => ctx.updateE4Query({ group: "flow", state: "" })}>看进行中的订单</Button>}
                {refundWait > 0 && <Button size="sm" onClick={() => ctx.updateE4Query({ group: "failed", state: "provisioning_failed" })}>看开通失败的订单</Button>}
              </>}>{waitTitle}</Conclusion>
          : <Conclusion state="ok" hint={counts?.placed ? `${counts.placed} 单在等用户付款，不用操作。` : undefined} explain={searchNote || undefined}>没有要处理的订单</Conclusion>}

    <StatBand label="订单汇总">
      <Stat tone="role-2" icon={Workflow} label="进行中订单" value={flowCount ?? "—"} unit={flowCount === undefined ? undefined : "单"}
        sub={countState} explain="已下单 / 已支付 / 开通中三个状态的单数，算全部订单，跟着搜索词变，不随下方状态筛选变。" />
      <Stat icon={AlertTriangle} iconTone={failedCount ? "danger" : undefined} tone={failedCount ? "danger" : undefined} label="失败订单" value={failedCount ?? "—"} unit={failedCount === undefined ? undefined : "单"}
        sub={countState} explain="支付失败 / 开通失败 / 拒付三个状态的单数，算全部订单，跟着搜索词变，不随下方状态筛选变。" />
    </StatBand>

    <FilterBar
      scope={<>
        <Segments label="订单状态分组" value={query.group} items={segments} onChange={(group) => ctx.updateE4Query({ group, state: "" })} />
        <FilterField>
          {currentGroup
            ? <Select aria-label="订单状态筛选" value={query.state} onChange={(state) => ctx.updateE4Query({ state })} options={[{ value: "", label: currentGroup.allLabel }, ...currentGroup.states.map(statusOption)]} />
            : <Select aria-label="订单状态筛选" value={query.state} onChange={(state) => ctx.updateE4Query({ state })} options={[{ value: "", label: "全部状态" }]} groups={ORDER_STATE_GROUPS.map((group) => ({ label: group.label, options: group.states.map(statusOption) }))} />}
        </FilterField>
      </>}
      onClear={ctx.clearE4Filters}
      canClear={hasConditions}
    >
      <FilterField grow><Input aria-label="搜索订单" placeholder="订单号 / 用户编号 / 商品" value={ctx.e4KeywordInput} onChange={(event) => ctx.setE4KeywordInput(event.target.value)} /></FilterField>
    </FilterBar>

    <Panel flush icon={ClipboardList} tone="role-2" title={currentGroup ? `${currentGroup.label}的订单` : "全部订单"} explain="点一行看到哪一步、下一步做什么" actions={<ColumnPicker columns={columns} />}>
      <Table label="订单列表" aria-busy={loading}>
        <thead><tr>
          <Th sticky="start"><Explain label="订单号开头是什么意思" content="ORD 是普通购买，BND 是组合购买，TRC 是试用转购买。其他开头看详情里的订单类型。">订单号</Explain></Th>
          <Th><Explain label="状态怎么分组" content="进行中：已下单、已支付、开通中。已交付：已激活、已入库，已入库是设备进了用户的设备仓库但还没激活。失败：支付失败、开通失败、拒付。已结束：已过期、已退款、已取消。">状态</Explain></Th>
          {columns.isVisible("user") && <Th icon={User} tone="users">用户</Th>}
          {columns.isVisible("sku") && <Th icon={Package} tone="devices">商品</Th>}
          {columns.isVisible("amount") && <Th align="right" icon={Coins} tone="money">金额（USDT）</Th>}
          {columns.isVisible("dc") && <Th icon={Server} tone="devices">数据中心</Th>}
          {columns.isVisible("age") && <Th align="right">下单至今</Th>}
        </tr></thead>
        <tbody>
          {loading ? <TableLoading columns={tableColumns} rows={Math.min(query.pageSize, 10)} />
            : error ? <TableMessage columns={tableColumns} role="alert">订单加载失败：{error} <Button size="sm" onClick={() => void ctx.refreshE4()}>重试</Button></TableMessage>
              : orders.length === 0 ? <TableMessage columns={tableColumns} role="status">
                {hasConditions ? <>{query.keyword ? "没有符合条件的订单" : "这个状态下没有订单"} <Button size="sm" onClick={ctx.clearE4Filters}>清除筛选</Button></> : "暂无订单"}
              </TableMessage>
                : orders.map((order) => {
                  const state = ctx.orderState(order);
                  return (
                    <Tr key={order.id} selected={ctx.selOrder?.id === order.id} onOpen={() => ctx.openOrder(order)}>
                      <Td sticky="start"><Cell mono full main={<button type="button" className="rd-cell-link" data-e4-order-trigger title={order.id} aria-label={`查看订单 ${order.id}`} aria-haspopup="dialog" onClick={() => ctx.openOrder(order)}>{shortNo(order.id)}</button>} /></Td>
                      <Td><Cell main={<StatusTag tone={ORDER_STATE_TONE[state] ?? "neutral"}>{stateLabel(state)}</StatusTag>} sub={STATE_NEXT[state]} /></Td>
                      {columns.isVisible("user") && <Td><Cell mono main={order.user} /></Td>}
                      {columns.isVisible("sku") && <Td><Cell main={order.sku} title={order.sku} /></Td>}
                      {columns.isVisible("amount") && <Td align="right"><Cell num main={orderAmount(order.amt, amountDigits)} /></Td>}
                      {columns.isVisible("dc") && <Td><Cell main={order.dc} title={order.dc} /></Td>}
                      {columns.isVisible("age") && <Td align="right"><Cell num main={ORDER_FINAL_STATES.includes(state) ? "—" : order.age} /></Td>}
                    </Tr>
                  );
                })}
        </tbody>
      </Table>
      {!error && ctx.e4Total > 0 && <Pager label="订单列表" total={ctx.e4Total} page={query.page} pageSize={query.pageSize} sizes={E4_PAGE_SIZES} loading={loading}
        note={!loading && activated.length > 0 ? `本页已激活 ${activated.length} 笔，合计 ${orderMoney(activeAmount)}，只算这一页` : undefined}
        onPage={(page) => ctx.updateE4Query({ page })} onPageSize={(pageSize) => ctx.updateE4Query({ pageSize })} />}
    </Panel>

    <Fold title="订单状态怎么流转" summary={`主流程 4 步，另有 ${ORDER_FINAL_STATES.length} 种异常或结束`} icon={Route}
      explain="设备放在平台机房托管，不发实物，所以开通时要分配数据中心。只有已支付、开通中、已激活、已入库或已付款的开通失败订单能退款，批准执行时会检查平台资金是否够退。「标记失败结果」不会退款。">
      <Steps label="订单处理流程" items={[
        { label: "已下单", state: "todo", sub: countText("placed") },
        { label: "已支付", state: "todo", sub: countText("paid") },
        { label: "开通中", state: "todo", sub: `${countText("provisioning")} · 分配数据中心中` },
        { label: "已交付", state: "todo", sub: `${counts?.activated ?? "—"} 单已激活 · ${counts?.inventory ?? "—"} 单已入库` },
      ]} />
      <Table label="异常或结束的订单">
        <thead><tr><Th>异常或结束的订单 · {ORDER_FINAL_STATES.length} 种</Th><Th align="right">单数</Th><Th>说明</Th></tr></thead>
        <tbody>
          {ORDER_FINAL_STATES.map((state) => (
            <Tr key={state}>
              <Td><StatusTag tone={ORDER_STATE_TONE[state]}>{stateLabel(state)}</StatusTag></Td>
              <Td align="right"><Cell num main={counts?.[state] ?? "—"} /></Td>
              <Td>{STATE_TEXT[state]}</Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Fold>

    <E4OrderDrawer ctx={ctx} />

    {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => { ctx.releaseE4Pending(releasing); setReleasing(null); }}
      explain="重试被拒说明不了原操作的结果，先到操作记录确认它有没有提交。解除后原操作不再重试，系统仍按这单现在的状态校验。" />}
  </>;
}

function E4OrderDrawer({ ctx }: { ctx: EViewCtx }) {
  const reach = useReach();
  const { orders, selOrder, e4Detail, e4DetailLoading, e4DetailError, canWriteE4, canRefundE4, openActionConfirm, toast } = ctx;
  const o = selOrder && (orders.find((order) => order.id === selOrder.id) ?? selOrder);
  if (!o) return <Drawer open={false} onClose={ctx.closeOrder} title="订单详情">{null}</Drawer>;

  const eff = ctx.orderState(o);
  const finalized = ORDER_FINAL_STATES.includes(eff);
  const canCancel = canWriteE4 && eff === "placed";
  const terminalOptions = eff === "placed" ? ["payment_failed", "expired"]
    : eff === "paid" ? ["chargeback"]
      : eff === "provisioning" ? ["provisioning_failed"] : [];
  const orderFlow = eff === "inventory" ? ["placed", "paid", "provisioning", "inventory"] : ORDER_FLOW;
  const idx = orderFlow.indexOf(eff);
  const hasSettledFunding = e4Detail?.funding.some((item) => {
    const source = item.source.toUpperCase();
    const status = item.status.toUpperCase();
    return ["PAID", "SUCCESS", "POSTED", "COMPLETED"].includes(status)
      && (source === "D1_PAYMENT"
        || ((source === "D4_LEDGER" || source === "D4_BILL") && item.direction.toUpperCase() === "OUT"));
  }) === true;
  const hasAllocatedDevice = !!e4Detail?.deviceId
    && !!e4Detail.deviceInstanceNo
    && !!o.dc && o.dc !== "—";
  const nextStep = !finalized
    ? eff === "paid" && hasSettledFunding && hasAllocatedDevice
      ? "provisioning"
      : eff === "provisioning" && !!e4Detail?.deviceActivatedAt
        ? "activated"
        : undefined
    : undefined;
  const nextState = canWriteE4 ? nextStep : undefined;
  const progressBlock = eff === "placed"
    ? { code: "ORDER_PAYMENT_CONFIRMATION_REQUIRED", title: "等用户付款", text: "要等付款记录确认用户真的付了款，后台不能手动标记已付款。" }
    : eff === "paid" && (!hasSettledFunding || !hasAllocatedDevice)
      ? { code: "ORDER_PROVISIONING_EVIDENCE_REQUIRED", title: "等款项结算和设备分配", text: "要先确认款项已结算，并在「设备运行管理」分配好设备和数据中心。" }
      : eff === "provisioning" && !e4Detail?.deviceActivatedAt
        ? { code: "ORDER_DEVICE_ACTIVATION_REQUIRED", title: "等设备激活", text: "要先在「设备运行管理」激活设备，订单才能完成。" }
        : null;
  // 开通失败要读完详情才知道付没付款，没读完时先当能退，动作由读取锁挡着。
  const refundableState = ["paid", "provisioning", "activated", "inventory"].includes(eff)
    || (eff === "provisioning_failed" && (!e4Detail || e4Detail.paymentStatus.toUpperCase() === "PAID"));
  const refundReady = canRefundE4 && refundableState && e4Detail?.refundAllowed === true;
  // 三个数缺一个就算不出能不能退，和资金不足是两回事，阻断相同（后端 refundCoverageBlocked）。
  const coverageKnown = e4Detail?.coverageCurrent != null && e4Detail.coverageProjected != null && e4Detail.coverageRedline != null;
  // 覆盖率一位小数，红线是配置值，按原值写（TX-23）。
  const coverageText = coverageKnown
    ? `当前 ${fmtPct(e4Detail.coverageCurrent!)} → 执行后 ${fmtPct(e4Detail.coverageProjected!)} · 红线 ${e4Detail.coverageRedline}%`
    : "暂无数据";
  const refundBlockText = coverageKnown ? "平台资金低于安全线，暂不能退款" : "资金覆盖率暂时读不到，暂不能退款";

  const index = orders.findIndex((order) => order.id === o.id);
  const prev = index > 0 ? orders[index - 1] : undefined;
  const next = index >= 0 ? orders[index + 1] : undefined;
  const pendingFact = e4DetailError ? { value: "读取失败", state: "danger" as const } : { value: "正在读取…" };
  // 读完详情才能做决定（OP-150）：下一步、退款条件都靠详情里的事实。
  const orderPending = ctx.e4Pending.some((record) => record.orderNo === o.id);
  const waitReason = orderPending ? "这单有结果未确认的操作，先到页面上方处理" : e4DetailError ? "订单详情读取失败，重试成功后才能操作" : e4DetailLoading || !e4Detail ? "正在读取订单事实" : ctx.e4ReadBlock;
  const approvalTag = <StatusTag tone="progress" filled explain={APPROVAL_NOTE}>批准后生效</StatusTag>;
  // 批准后收不回来的操作：不能撤销，红按钮（VS-25、VS-106）。
  const irreversibleApproval = <>{approvalTag}<IrreversibleTag /></>;
  // 对象、金额、审批人常显在框里（OP-48）；rows 放这个操作自己要核对的事实。
  // 金额是确认框的关键数字，放第一行（VS-102）。
  const orderFacts = (rows: ReactNode, amountLabel = "金额", orderRow = false) => <Facts>
    <Fact k={amountLabel} lead tone="role-1" unit="USDT">{orderAmount(o.amt)}</Fact>
    {orderRow && <Fact k="订单"><span data-mono>{o.id}</span></Fact>}
    <Fact k="用户">{o.user}</Fact>
    <Fact k="商品">{o.sku}</Fact>
    {rows}
  </Facts>;
  const reasonHint = "写清依据或工单号。只记在操作记录里，用户看不到";
  // 批准后后端把这单的设备改成已退款、停用（rollbackOrderDevices），赠品设备不在内，由活动规则收回。
  const hasDevice = !!e4Detail?.deviceId || !!e4Detail?.deviceInstanceNo;
  const refundDeviceLine = hasDevice ? "设备停用，已到账的收益不扣回"
    : eff === "provisioning_failed" ? "没有开通成功，没有设备要停用" : "还没有设备，退款后不再开通";
  // 后端不收回设备收益。例外：按全期结算转购买的试用奖励，退款后收回钱包里没花掉的部分；活动奖励走活动规则。
  const refundDeviceDetail = `退款后用户钱包多这笔钱，平台的应付款跟着增加。${hasDevice ? "这单的设备不再归用户，不再派任务，不再产生新收益。活动赠品的设备按活动规则处理。" : ""}${e4Detail?.orderType === "TRIAL_CONVERT" ? "转购买时发的试用奖励按当时的规则处理，最多收回钱包里没花掉的部分。" : ""}活动奖励按活动规则处理。`;

  // 具体原因只从状态轨迹取，状态本身证明不了原因。
  const closeRecord = e4Detail?.history.findLast((item) => item.toState === eff);
  const nextRow: JudgmentRow = finalized
    ? { label: "结果", value: stateLabel(eff), reason: <>{STATE_TEXT[eff]}{closeRecord && e4Detail && <> · 记录的原因：{operatorOrderHistoryReason(closeRecord.reason, e4Detail.paymentMethod)}</>}</>, state: ORDER_STATE_TONE[eff] === "danger" ? "danger" : undefined }
    : !e4Detail ? { label: "下一步", ...pendingFact }
      : nextStep ? { label: "下一步", value: `可以推进到「${stateLabel(nextStep)}」`, reason: canWriteE4 ? "条件都满足了，点下面「推进到下一步」提交审批。" : "条件都满足了，要有修改权限的账号提交。", state: "progress" }
        : progressBlock ? { label: "下一步", value: progressBlock.title, reason: <span title={progressBlock.code}>{progressBlock.text}</span>, state: eff === "placed" ? undefined : "warn" }
          : { label: "下一步", value: "暂无可推进步骤", reason: "订单已交付，不用处理。" };
  const coverageReason = <><Explain label="覆盖率是什么" content="平台储备除以应付款，越高越安全。退款后低于红线时不能退款。">覆盖率</Explain> {coverageText}</>;
  const refundRow: JudgmentRow | null = finalized && !refundableState ? null
    : !refundableState ? { label: "退款", value: "不能退款", reason: "用户还没付款。只有已支付、开通中、已激活、已入库或已付款的开通失败订单能退款。" }
      : !e4Detail ? { label: "退款", ...pendingFact }
        : e4Detail.refundAllowed ? { label: "退款", value: canRefundE4 ? "可以退款" : "符合退款条件，这个账号不能退款", reason: coverageReason }
          : { label: "退款", value: refundBlockText, reason: coverageKnown ? coverageReason : "要先读到资金覆盖率才能退款。过一会儿重新打开这单。", state: coverageKnown ? "danger" : "warn" };
  const rows: JudgmentRow[] = [
    nextRow,
    { label: "对象", icon: User, tone: "users", value: o.user, reason: o.sku },
    { label: "金额", icon: Coins, tone: "money", value: orderMoney(o.amt), reason: e4Detail ? `${e4Detail.quantity} 台 · ${operatorOrderFact("type", e4Detail.orderType)}` : undefined },
    e4Detail
      ? { label: "付款来源", value: `${operatorOrderFact("payment", e4Detail.paymentMethod)} · ${operatorOrderFact("paymentStatus", e4Detail.paymentStatus)}`, reason: e4Detail.paymentNo ? <span data-mono>{e4Detail.paymentNo}</span> : undefined }
      : { label: "付款来源", ...pendingFact },
    ...(refundRow ? [refundRow] : []),
  ];

  const refundBlocked = canRefundE4 && refundableState && e4Detail?.refundAllowed === false;
  const hasAction = !!nextState || canCancel || (canWriteE4 && terminalOptions.length > 0) || (canRefundE4 && refundableState);
  // 常显的只有现在能不能做；按下去会怎样收进按钮旁的提示图标（DP-06）。
  const note = !canWriteE4 && !canRefundE4 ? "你只能查看这单。"
    : !hasAction ? "这单现在没有人工操作。"
    : waitReason ? `${waitReason}。` : undefined;
  const consequence = (!canWriteE4 && !canRefundE4) || !hasAction ? undefined
    : refundBlocked ? `${coverageKnown ? "退款后平台资金会低于安全线，补足后才能退款。" : "要先读到资金覆盖率才能退款。"}${terminalOptions.length > 0 ? "「标记失败结果」不会退款。" : ""}`
    : canRefundE4 && refundableState ? `退款不可撤销。批准后钱退回用户钱包${hasDevice ? "，这单的设备停用" : ""}。${terminalOptions.includes("chargeback") ? "标记拒付不会退款，标记后也不能再退。" : terminalOptions.length > 0 ? "「标记失败结果」不会退款。" : ""}`
      : canCancel ? "提交后要批准才生效。用户还没付款，取消和标记失败都不涉及退款。"
        : "提交后要批准才生效。";
  const copyNo = () => {
    void navigator.clipboard?.writeText(o.id).then(() => toast("已复制订单号"), () => toast("复制失败，请手动选择订单号"));
  };

  return (
    <Drawer open onClose={ctx.closeOrder} title="订单详情" icon={ClipboardList} tone="role-2"
      sub={<>{o.id} <IconButton aria-label="复制订单号" data-size="sm" onClick={copyNo}><Copy size={13} aria-hidden /></IconButton><StatusTag tone={ORDER_STATE_TONE[eff] ?? "neutral"} explain={STATE_TEXT[eff]}>{stateLabel(eff)}</StatusTag></>}
      nav={{ hasPrev: Boolean(prev), hasNext: Boolean(next), onPrev: () => { if (prev) ctx.openOrder(prev); }, onNext: () => { if (next) ctx.openOrder(next); } }}
      footer={<Decision note={note} explain={consequence}
        danger={canRefundE4 && refundableState && <Button variant="danger-outline" disabledReason={waitReason ?? (refundReady ? undefined : refundBlockText)} onClick={() => {
          if (!e4Detail || !refundReady || orderPending) return;
          const channels = e4Detail.refundChannels.length ? e4Detail.refundChannels : ["WALLET"];
          // 只有一个去向时没得选，写成事实，不给下拉（OP-126）。
          const channel = channels.length === 1 ? channels[0] : undefined;
          const reasonField = { key: "refundReasonCode", label: channel ? "退款原因" : "退款原因（用户可见）", current: "", inputKind: "select" as const, options: ["", ...E4_REFUND_REASONS], optionLabels: { "": "请选择退款原因", ...E4_REFUND_REASON_LABELS }, required: true, wide: !!channel };
          openActionConfirm({
            // 标题只写动作，单号进事实区；name 照旧记进操作记录（VS-101）。
            // amplify 只管框里的覆盖率提示：那句写「提交时检查」，后端实际在批准执行时才查，所以覆盖率写进事实区。提案里的 amplifies 照旧是 true。
            briefKind: "funds", name: "退款 · " + o.id, title: "退款", op: "order-refund", orderId: o.id, amplify: false, fixedVal: channel,
            effect: irreversibleApproval, confirmLabel: "提交审批", confirmTone: "danger", reasonPlaceholder: reasonHint,
            statedBrief: { impact: `钱退回用户钱包${hasDevice ? "，这单设备停用" : ""}`, check: "核对用户、金额和退款原因，理由写清依据或工单号。" },
            facts: orderFacts(<>
              {channel && <Fact k="退款去向">{REFUND_CHANNEL_LABELS[channel] ?? channel}</Fact>}
              <Fact k="退款后">{refundDeviceLine}<Explain label="退款后设备和收益怎么处理" content={refundDeviceDetail} /></Fact>
              {/* 退款入口只在读到覆盖率时开。 */}
              <Fact k="覆盖率">{fmtPct(e4Detail.coverageCurrent!)} → 执行后 {fmtPct(e4Detail.coverageProjected!)}，红线 {e4Detail.coverageRedline}%<Explain label="覆盖率什么时候检查" content="批准执行时后端再查一次，当前或执行后低于红线就不退款。" /></Fact>
              <Fact k="促销奖励"><PromotionRefundImpact orderNo={o.id} compact /></Fact>
            </>, "退款金额", true),
            businessForm: channel
              ? { kind: "multi-field", title: "用户可见的原因", fields: [reasonField] }
              : { kind: "multi-field", title: "退款渠道与原因", fields: [
                { key: "refundChannel", label: "退款渠道", current: channels[0], inputKind: "select", options: channels, optionLabels: REFUND_CHANNEL_LABELS, required: true, showDiff: true },
                reasonField,
              ] },
            detail: `退款 ${orderMoney(o.amt)}。钱退回用户的 USDT 钱包，付款记录标为已退款，补一条退款账单，用户的累计充值减去这笔金额。`,
          });
        }}>{e4DetailLoading ? "正在检查…" : e4Detail?.refundAllowed === false ? "暂不能退款" : "退款"}</Button>}
        others={<>
          {canCancel && <Button disabledReason={waitReason} onClick={() => openActionConfirm({ briefKind: "record", name: "取消订单 · " + o.id, title: "取消订单", op: "order-cancel", orderId: o.id, amplify: false, effect: irreversibleApproval, confirmLabel: "提交审批", confirmTone: "danger", reasonPlaceholder: reasonHint,
            statedBrief: { impact: "订单终止，占用的库存放回。用户没付款，不涉及退款", check: "核对订单和取消原因，理由写清依据或工单号。" },
            facts: orderFacts(<Fact k="当前状态">{stateLabel(eff)}</Fact>, "金额", true),
            detail: `取消 ${o.id}（${stateLabel(eff)}）。用户还没付款，取消后订单终止。`,
            businessForm: { kind: "multi-field", title: "用户可见的原因", fields: [
              { key: "closeReasonCode", label: "取消原因", current: "", inputKind: "select", options: ["", ...E4_CLOSE_REASONS.cancelled], optionLabels: { "": "请选择取消原因", ...E4_CLOSE_REASON_LABELS }, required: true, wide: true },
            ] } })}>取消订单</Button>}
          {canWriteE4 && terminalOptions.length > 0 && <Button disabledReason={waitReason} onClick={() => {
            // 已支付只能拒付，开通中只能开通失败：只有一个结果时写成事实，不给下拉（OP-126）。
            const only = terminalOptions.length === 1 ? terminalOptions[0] : undefined;
            const reasonFields = terminalOptions.filter((s) => E4_CLOSE_REASONS[s]).map((s) => (
              { key: "closeReasonCode", label: only ? "失败原因" : "原因（用户可见）", current: "", inputKind: "select" as const, options: ["", ...E4_CLOSE_REASONS[s]], optionLabels: { "": "请选择原因", ...E4_CLOSE_REASON_LABELS }, required: true, wide: !!only, visibleWhen: only ? undefined : { key: "terminalState", equals: s } }));
            openActionConfirm({ briefKind: "record", name: "标记失败结果 · " + o.id, title: "标记失败结果", op: "order-terminal", orderId: o.id, amplify: false, fixedVal: only, effect: irreversibleApproval, confirmLabel: "提交审批", confirmTone: "danger", reasonPlaceholder: reasonHint,
              statedBrief: { impact: TERMINAL_IMPACT[eff], check: "核对失败结果和原因，理由写清依据或工单号。" },
              facts: orderFacts(<>
                {only ? <Fact k="状态变化"><Change from={stateLabel(eff)} to={stateLabel(only)} /></Fact> : <Fact k="当前状态">{stateLabel(eff)}</Fact>}
                <Fact k="退款">{TERMINAL_REFUND[eff]}</Fact>
              </>, "金额", true),
              detail: `当前状态：${stateLabel(eff)}。这一步不退款。`,
              businessForm: !only
                ? { kind: "multi-field", title: "失败结果与原因", hint: "过期的原因会自动记录，支付失败要选择原因。", fields: [
                  { key: "terminalState", label: "失败结果", current: "", inputKind: "select", options: ["", ...terminalOptions], optionLabels: { "": "请选择失败结果", ...Object.fromEntries(terminalOptions.map((s) => [s, stateLabel(s)])) }, required: true },
                  ...reasonFields,
                ] }
                : reasonFields.length > 0 ? { kind: "multi-field", title: "用户可见的原因", fields: reasonFields } : undefined });
          }}>标记失败结果</Button>}
        </>}
        primary={nextState && <Button variant="primary" disabledReason={waitReason} onClick={() => openActionConfirm({ briefKind: "record", name: `推进订单 · ${o.id} → ${stateLabel(nextState)}`, title: "推进订单", op: "order-state", orderId: o.id, fixedVal: nextState, amplify: false, effect: approvalTag, confirmLabel: "提交审批", reasonPlaceholder: reasonHint,
          statedBrief: { impact: nextState === "provisioning" ? "订单进入开通中，接着到「设备运行管理」激活设备" : "订单完成交付，不用再处理", check: "核对状态变化，理由写清依据或工单号。" },
          facts: orderFacts(<Fact k="状态变化"><Change from={stateLabel(eff)} to={stateLabel(nextState)} /></Fact>, "金额", true),
          detail: `手动推进 ${o.id}：${stateLabel(eff)} → ${stateLabel(nextState)}` })}>推进到下一步</Button>}
      />}>
      {!finalized && <Steps label="订单进度" items={orderFlow.map((state, position) => ({ label: stateLabel(state), state: position < idx ? "done" as const : position === idx ? "current" as const : "todo" as const }))} />}
      {orderPending && <Notice tone="warn">这单有结果未确认的操作，不要重复处理。状态变了也不算确认。到页面上方按原操作重试，或看操作记录核查。</Notice>}
      {e4DetailError && <BlockState state="error" title="详情加载失败" detail={`${e4DetailError} · 为避免按旧数据操作，已暂停处理。`} onRetry={() => ctx.openOrder(o)} />}
      <JudgmentPoints rows={rows} />
      <Fold inset title="订单信息" icon={Package} tone="devices" summary={`${o.dc === "—" ? "未分配数据中心" : o.dc} · 下单 ${o.age} 前`}>
        <Facts>
          <Fact k="数据中心">{o.dc}</Fact>
          <Fact k="下单时间">{o.orderedAt ? `${formatBusinessTimeFull(o.orderedAt, "—")}（${businessZone().label}）` : "—"}</Fact>
          {e4Detail && <Fact k="设备实例"><span data-mono>{e4Detail.deviceInstanceNo ?? "尚未生成"}</span></Fact>}
          {e4Detail && !finalized && !refundableState && <Fact k="平台资金覆盖率">{coverageText}</Fact>}
        </Facts>
      </Fold>
      {e4Detail && <>
        <Fold inset title="状态轨迹" icon={History} summary={e4Detail.history.length ? `${e4Detail.history.length} 条记录` : "暂无记录"}>
          {e4Detail.history.length === 0 ? "暂无记录" : <Facts>
            {e4Detail.history.map((item, position) => <Fact key={`${item.createdAt}-${position}`} k={`${stateLabel(item.fromState)} → ${stateLabel(item.toState)}`}>{operatorOrderHistoryActor(item.operator)} · {operatorOrderHistoryReason(item.reason, e4Detail.paymentMethod)}</Fact>)}
          </Facts>}
        </Fold>
        <Fold inset title="资金记录" icon={Receipt} tone="money" summary={e4Detail.funding.length ? `${e4Detail.funding.length} 条记录` : "暂无付款或账单记录"}>
          {e4Detail.funding.length === 0 ? "暂无付款或账单记录" : <Facts>
            {e4Detail.funding.map((item, position) => {
              const ledgerHref = e4FundingLedgerHref(item);
              return <Fact key={`${item.source}-${item.bizNo}-${position}`} k={operatorOrderFact("source", item.source)}>
                {operatorOrderFact("direction", item.direction)} {orderMoney(item.amount)} · {operatorOrderFact("fundingStatus", item.status)} · <span data-mono>{item.bizNo}</span>
                {ledgerHref && reach(ledgerHref, "finance_d4_read") && <> · <Link className="rd-link" href={ledgerHref}>到账本与账单核对查看</Link></>}
              </Fact>;
            })}
          </Facts>}
        </Fold>
      </>}
      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {reach("/platform/audit", "platform_a2_read") && <Link className="rd-link" href={`/platform/audit?domain=E&object=${encodeURIComponent(o.id)}`}>操作记录</Link>}
        {reach("/platform/events") && <Link className="rd-link" href="/platform/events">用户行为事件</Link>}
        {!e4Detail?.funding.some((item) => e4FundingLedgerHref(item)) && reach("/finance/ledger", "finance_d4_read") && <Link className="rd-link" href={`/finance/ledger?bizNo=${encodeURIComponent(o.id)}`}>按订单号查账单</Link>}
      </nav>
    </Drawer>
  );
}
