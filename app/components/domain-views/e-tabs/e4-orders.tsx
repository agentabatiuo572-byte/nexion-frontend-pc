import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardList, Coins, Copy, History, Package, Receipt, RefreshCw, Route, Server, User, Workflow } from "lucide-react";
import {
  BlockState, Button, Cell, ColumnPicker, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input,
  JudgmentPoints, Modal, Notice, PageHeader, Pager, Panel, Segments, Select, Stat, StatBand, StatusTag, Steps, Table, TableLoading, TableMessage, Td, Th, Tr,
  useTableColumns, type JudgmentRow, type SegmentItem, type TableColumn,
} from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { businessClock, businessZone } from "@/lib/admin/business-time";
import { E4_CLOSE_REASONS, E4_CLOSE_REASON_LABELS, E4_REFUND_REASONS, E4_REFUND_REASON_LABELS, e4FundingLedgerHref } from "@/lib/admin/e4-client";
import { operatorOrderFact, operatorOrderHistoryActor, operatorOrderHistoryReason } from "@/lib/admin/e-operator-display";
import { useReach } from "@/lib/nav/use-reach";
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
  const waitCount = countOf(["paid", "provisioning"]);
  const searchNote = query.keyword ? "按当前搜索词算。" : "";
  const failedCount = countOf(FAILED_STATES);
  const countSub = (text: string) => ctx.e4CountsFailed ? "数量暂时读不到" : counts ? text : "读取中";
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

    {ctx.e4Pending.map((record) => (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`}
        action={<>
          <Button size="sm" loading={ctx.e4Retrying === record.fingerprint} disabled={!!ctx.e4Retrying} onClick={() => void ctx.retryE4Pending(record)}>按原操作重试</Button>
          {ctx.e4RetryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!ctx.e4Retrying} onClick={() => setReleasing(record)}>解除待确认</Button>}
        </>}>
        {businessClock(record.createdAt)}（{businessZone().label}）发出，可能已经提交。重试用同一命令号、同样的内容和理由，不会多提交一份。这单在有结论前不能再操作。
        {reach("/platform/audit", "platform_a2_read") && <> <Link className="rd-link" href={`/platform/audit?domain=E&object=${encodeURIComponent(record.orderNo)}`}>到操作记录核查</Link></>}
        <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 理由 ${record.spec.reason}`} />
        {ctx.e4PendingNotes[record.fingerprint] && <div>{ctx.e4PendingNotes[record.fingerprint]}</div>}
      </Notice>
    ))}

    {ctx.e4CountsFailed
      ? <Conclusion state="unknown" action={<Button size="sm" onClick={() => void ctx.refreshE4()}>重试</Button>}>订单数量读不到，还不知道有没有要处理的</Conclusion>
      : waitCount === undefined ? <Conclusion state="unknown">正在读取有没有要处理的订单…</Conclusion>
        : waitCount > 0
          ? <Conclusion state="warn" lead hint={`点一行看差什么，设备分配和激活在「设备运行管理」做。${searchNote}`}
              action={<Button size="sm" onClick={() => ctx.updateE4Query({ group: "flow", state: "" })}>看进行中的订单</Button>}>有 <b>{waitCount}</b> 单等开通或激活</Conclusion>
          : <Conclusion state="ok" hint={`${counts?.placed ? `${counts.placed} 单在等用户付款，不用操作。` : ""}${searchNote}` || undefined}>没有要处理的订单</Conclusion>}

    <StatBand label="订单汇总">
      <Stat tone="role-2" icon={Workflow} label="进行中订单" value={flowCount ?? "—"} unit={flowCount === undefined ? undefined : "单"}
        sub={countSub("已下单 / 已支付 / 开通中")} explain="全部订单里这三个状态的单数，跟着搜索词变，不随下方状态筛选变。" />
      <Stat icon={AlertTriangle} iconTone={failedCount ? "danger" : undefined} tone={failedCount ? "danger" : undefined} label="失败订单" value={failedCount ?? "—"} unit={failedCount === undefined ? undefined : "单"}
        sub={countSub("支付失败 / 开通失败 / 拒付")} explain="全部订单里这三个状态的单数，跟着搜索词变，不随下方状态筛选变。" />
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

    <Panel flush icon={ClipboardList} tone="role-2" title={currentGroup ? `${currentGroup.label}的订单` : "全部订单"} sub="点一行看到哪一步、下一步做什么" actions={<ColumnPicker columns={columns} />}>
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

    <Fold title="订单状态怎么流转" summary={`主流程 4 步，另有 ${ORDER_FINAL_STATES.length} 种异常或结束`} icon={Route}>
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
      <p className="rd-toolbar-note">设备放在平台机房托管，不发实物，所以开通时要分配数据中心。只有已支付、开通中、已激活、已入库或已付款的开通失败订单能退款，提交时会检查平台资金是否够退。「标记失败结果」不会退款。</p>
    </Fold>

    <E4OrderDrawer ctx={ctx} />

    {releasing && <Modal title="解除待确认" onClose={() => setReleasing(null)} footer={<>
      <Button onClick={() => setReleasing(null)}>取消</Button>
      <Button variant="primary" onClick={() => { ctx.releaseE4Pending(releasing); setReleasing(null); }}>确认解除</Button>
    </>}>
      <p><b>{releasing.label}</b></p>
      <p>重试被拒说明不了原操作的结果。先到操作记录确认原操作有没有提交，再解除。</p>
      <p>解除后这单可以重新处理，原操作不再重试，系统仍按这单现在的状态校验。这一步只放开本页的锁，不发请求，不写操作记录。</p>
    </Modal>}
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
  const coverageText = coverageKnown
    ? `当前 ${e4Detail.coverageCurrent!.toFixed(2)}% → 执行后 ${e4Detail.coverageProjected!.toFixed(2)}% · 红线 ${e4Detail.coverageRedline!.toFixed(2)}%`
    : "暂无数据";
  const refundBlockText = coverageKnown ? "平台资金低于安全线，暂不能退款" : "资金覆盖率暂时读不到，暂不能退款";

  const index = orders.findIndex((order) => order.id === o.id);
  const prev = index > 0 ? orders[index - 1] : undefined;
  const next = index >= 0 ? orders[index + 1] : undefined;
  const pendingFact = e4DetailError ? { value: "读取失败", state: "danger" as const } : { value: "正在读取…" };
  // 读完详情才能做决定（OP-150）：下一步、退款条件都靠详情里的事实。
  const orderPending = ctx.e4Pending.some((record) => record.orderNo === o.id);
  const waitReason = orderPending ? "这单有结果未确认的操作，先到页面上方处理" : e4DetailError ? "订单详情读取失败，重试成功后才能操作" : e4DetailLoading || !e4Detail ? "正在读取订单事实" : ctx.e4ReadBlock;
  const approvalTag = <StatusTag tone="progress" filled>批准后生效</StatusTag>;
  const briefOf = (check: string) => ({ impact: "批准后生效：提交后请另一位超级管理员在「操作记录与审批」中批准。", check });
  // 批准后后端把这单的设备改成已退款、停用（rollbackOrderDevices），赠品设备不在内，由活动规则收回。
  const hasDevice = !!e4Detail?.deviceId || !!e4Detail?.deviceInstanceNo;
  const refundDeviceText = hasDevice ? "这单的设备停用，不再归用户，不再派任务，不再产生新收益。活动赠品的设备按活动规则处理。"
    : eff === "provisioning_failed" ? "这单没有开通成功，没有设备要停用。" : "这单还没有设备，退款后不再开通。";
  // 后端不收回设备收益。例外：按全期结算转购买的试用奖励，退款后收回钱包里没花掉的部分；活动奖励走活动规则。
  const refundEarningsText = `这单设备已到账的收益不扣回。${e4Detail?.orderType === "TRIAL_CONVERT" ? "转购买时发的试用奖励按当时的规则处理，最多收回钱包里没花掉的部分。" : ""}活动奖励按活动规则处理。`;

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
    { label: "金额", icon: Coins, tone: "money", value: orderMoney(o.amt), reason: e4Detail ? `${e4Detail.quantity} · ${operatorOrderFact("type", e4Detail.orderType)}` : undefined },
    e4Detail
      ? { label: "付款来源", value: `${operatorOrderFact("payment", e4Detail.paymentMethod)} · ${operatorOrderFact("paymentStatus", e4Detail.paymentStatus)}`, reason: e4Detail.paymentNo ? <span data-mono>{e4Detail.paymentNo}</span> : undefined }
      : { label: "付款来源", ...pendingFact },
    ...(refundRow ? [refundRow] : []),
  ];

  const hasAction = !!nextState || canCancel || (canWriteE4 && terminalOptions.length > 0) || (canRefundE4 && refundableState);
  const note = !canWriteE4 && !canRefundE4 ? "你只能查看这单。"
    : !hasAction ? "这单现在没有人工操作。"
    : waitReason ? `${waitReason}。`
      : canRefundE4 && refundableState ? `退款不可撤销。批准后钱退回用户钱包${hasDevice ? "，这单的设备停用" : ""}。${terminalOptions.length > 0 ? "「标记失败结果」不会退款。" : ""}`
        : canCancel ? "提交后要批准才生效。用户还没付款，取消和标记失败都不涉及退款。"
          : "提交后要批准才生效。";
  const copyNo = () => {
    void navigator.clipboard?.writeText(o.id).then(() => toast("已复制订单号"), () => toast("复制失败，请手动选择订单号"));
  };

  return (
    <Drawer open onClose={ctx.closeOrder} title="订单详情" icon={ClipboardList} tone="role-2"
      sub={<>{o.id} <IconButton aria-label="复制订单号" data-size="sm" onClick={copyNo}><Copy size={13} aria-hidden /></IconButton><StatusTag tone={ORDER_STATE_TONE[eff] ?? "neutral"} explain={STATE_TEXT[eff]}>{stateLabel(eff)}</StatusTag></>}
      nav={{ hasPrev: Boolean(prev), hasNext: Boolean(next), onPrev: () => { if (prev) ctx.openOrder(prev); }, onNext: () => { if (next) ctx.openOrder(next); } }}
      footer={<Decision note={note}
        danger={canRefundE4 && refundableState && <Button variant="danger-outline" disabledReason={waitReason ?? (refundReady ? undefined : refundBlockText)} onClick={() => {
          if (!e4Detail || !refundReady || orderPending) return;
          const channels = e4Detail.refundChannels.length ? e4Detail.refundChannels : ["WALLET"];
          openActionConfirm({
            name: "退款 · " + o.id, op: "order-refund", orderId: o.id, amplify: true,
            effect: approvalTag, confirmLabel: "提交审批", confirmTone: "danger", coverageLead: "退款后用户钱包多这笔钱，平台的应付款跟着增加",
            statedBrief: briefOf("核对用户、金额和退款原因，理由写清依据或工单号。"),
            facts: <Facts><Fact k="用户">{o.user}</Fact><Fact k="商品">{o.sku}</Fact><Fact k="设备">{refundDeviceText}</Fact><Fact k="已到账的收益">{refundEarningsText}</Fact><Fact k="能否撤销">不可撤销</Fact></Facts>,
            businessForm: { kind: "multi-field", title: "退款渠道与原因", hint: `覆盖率 ${coverageText}`, fields: [
              { key: "refundChannel", label: "退款渠道", current: channels[0], inputKind: "select", options: channels, optionLabels: { WALLET: "退回 USDT 钱包", ORIGINAL_PAYMENT: "原支付渠道" }, required: true, showDiff: true },
              { key: "refundReasonCode", label: "退款原因（用户可见）", current: "", inputKind: "select", options: ["", ...E4_REFUND_REASONS], optionLabels: { "": "请选择退款原因", ...E4_REFUND_REASON_LABELS }, required: true, help: "这个原因会显示在用户的订单详情里；下方备注只记在操作记录里，用户看不到。" },
            ] },
            detail: `退款 ${orderMoney(o.amt)}。钱退回用户的 USDT 钱包，付款记录标为已退款，补一条退款账单，用户的累计充值减去这笔金额。`,
          });
        }}><AutoGloss>{e4DetailLoading ? "正在检查退款条件…" : e4Detail?.refundAllowed === false ? refundBlockText : "退款"}</AutoGloss></Button>}
        others={<>
          {canCancel && <Button disabledReason={waitReason} onClick={() => openActionConfirm({ name: "取消订单 · " + o.id, op: "order-cancel", orderId: o.id, amplify: false, effect: approvalTag, confirmLabel: "提交审批", statedBrief: briefOf("核对订单和取消原因，理由写清依据或工单号。"), detail: `取消 ${o.id}（${stateLabel(eff)}）。用户还没付款，取消后订单终止。`,
            businessForm: { kind: "multi-field", title: "取消原因", fields: [
              { key: "closeReasonCode", label: "取消原因（用户可见）", current: "", inputKind: "select", options: ["", ...E4_CLOSE_REASONS.cancelled], optionLabels: { "": "请选择取消原因", ...E4_CLOSE_REASON_LABELS }, required: true, help: "这个原因会显示在用户的订单详情里；下方备注只记在操作记录里，用户看不到。" },
            ] } })}>取消订单</Button>}
          {canWriteE4 && terminalOptions.length > 0 && <Button disabledReason={waitReason} onClick={() => openActionConfirm({ name: "标记失败结果 · " + o.id, op: "order-terminal", orderId: o.id, amplify: false, effect: approvalTag, confirmLabel: "提交审批", statedBrief: briefOf("核对失败结果和原因，理由写清依据或工单号。"), detail: `当前状态：${stateLabel(eff)}，选择一个失败结果。退款请用「退款」按钮。`,
            businessForm: { kind: "multi-field", title: "失败结果与原因", hint: "过期、拒付的原因会自动记录；支付失败、开通失败需要选择原因。", fields: [
              { key: "terminalState", label: "失败结果", current: "", inputKind: "select", options: ["", ...terminalOptions], optionLabels: { "": "请选择失败结果", ...Object.fromEntries(terminalOptions.map((s) => [s, stateLabel(s)])) }, required: true },
              ...terminalOptions.filter((s) => E4_CLOSE_REASONS[s]).map((s) => (
                { key: "closeReasonCode", label: "原因（用户可见）", current: "", inputKind: "select" as const, options: ["", ...E4_CLOSE_REASONS[s]], optionLabels: { "": "请选择原因", ...E4_CLOSE_REASON_LABELS }, required: true, visibleWhen: { key: "terminalState", equals: s }, help: "这个原因会显示在用户的订单详情里；下方备注只记在操作记录里，用户看不到。" })),
            ] } })}>标记失败结果</Button>}
        </>}
        primary={nextState && <Button variant="primary" disabledReason={waitReason} onClick={() => openActionConfirm({ name: `推进订单 · ${o.id} → ${stateLabel(nextState)}`, op: "order-state", orderId: o.id, fixedVal: nextState, amplify: false, effect: approvalTag, confirmLabel: "提交审批", detail: `手动推进 ${o.id}：${stateLabel(eff)} → ${stateLabel(nextState)}` })}>推进到下一步</Button>}
      />}>
      {!finalized && <Steps label="订单进度" items={orderFlow.map((state, position) => ({ label: stateLabel(state), state: position < idx ? "done" as const : position === idx ? "current" as const : "todo" as const }))} />}
      {orderPending && <Notice tone="warn">这单有结果未确认的操作，不要重复处理。状态变了也不算确认。到页面上方按原操作重试，或看操作记录核查。</Notice>}
      {e4DetailError && <BlockState state="error" title="详情加载失败" detail={`${e4DetailError} · 为避免按旧数据操作，已暂停处理。`} onRetry={() => ctx.openOrder(o)} />}
      <JudgmentPoints rows={rows} />
      <Fold inset title="订单信息" icon={Package} tone="devices" summary={`${o.dc === "—" ? "未分配数据中心" : o.dc} · 下单 ${o.age} 前`}>
        <Facts>
          <Fact k="数据中心">{o.dc}</Fact>
          <Fact k="下单时间">{o.age + " 前"}</Fact>
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
