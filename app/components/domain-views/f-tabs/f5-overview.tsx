"use client";

/**
 * F5 首屏的两张图：奖励走到哪一步（七个状态排成一条路，冻结和冲正是岔路），八类奖励。
 * 数的都是全部记录，不跟下方筛选变（D01）。金额只画后端给了的：冷却中、已解锁和合计有金额，其余只有笔数。
 */
import type { ReactNode } from "react";
import { ArrowDown, ArrowRight, ArrowUp, Check, Layers3, Route } from "lucide-react";
import { Fold, Panel, RatioBar, Table, Td, Th, Tr } from "@/app/components/rd";
import type { F5CommissionAuditOverview } from "@/lib/admin/f1-client";
import { operatorCopyText } from "@/lib/admin/operator-copy";
import { KIND_LABELS, STATUS_BY_LABEL, STATUS_META, splitMoneyLabel } from "./f5-shared";

type Money = { usdt: string; uvt: string } | null;

function MoneyLines({ money }: { money: Money }) {
  if (!money) return <span className="f5-node-money" data-empty="">金额读不懂</span>;
  return (
    <span className="f5-node-money">
      <span><b>{money.usdt}</b> USDT</span>
      <span><b>{money.uvt}</b> UVT</span>
    </span>
  );
}

function Node({ status, count, money, note, selected, onSelect, testid }: {
  status: string;
  count: number | undefined;
  money?: Money;
  note?: ReactNode;
  selected: boolean;
  onSelect?: () => void;
  testid?: string;
}) {
  const meta = STATUS_META[status];
  const Icon = meta?.icon;
  const body = (
    <>
      <span className="f5-node-head">
        <span className="f5-node-dot" data-tone={meta?.tone ?? "neutral"} aria-hidden>{Icon && <Icon size={12} strokeWidth={2.2} />}</span>
        <span className="f5-node-name">{meta?.name ?? status}</span>
        {selected && <span className="f5-node-on"><Check size={12} strokeWidth={2.4} aria-hidden />已筛选</span>}
      </span>
      <span className="f5-node-count" data-zero={count ? undefined : ""}>{count === undefined ? "—" : count.toLocaleString("en-US")}<small>笔</small></span>
      {money !== undefined && <MoneyLines money={money} />}
      {note && <span className="f5-node-note">{note}</span>}
    </>
  );
  return onSelect
    ? <button type="button" className="f5-node" data-status={status} data-testid={testid} aria-pressed={selected} onClick={onSelect}
        aria-label={`${meta?.name ?? status} ${count ?? "—"} 笔，${selected ? "再点一次取消筛选" : "点一下只看这个状态的记录"}`}>{body}</button>
    : <div className="f5-node" data-status={status}>{body}</div>;
}

function FlowLink({ label, dir = "right", tone }: { label: ReactNode; dir?: "right" | "down" | "both" | "none"; tone?: "action" }) {
  return (
    <span className="f5-link" data-dir={dir} data-tone={tone}>
      {dir === "none" ? null : dir === "right" ? <ArrowRight size={14} aria-hidden /> : dir === "down" ? <ArrowDown size={14} aria-hidden /> : <><ArrowDown size={14} aria-hidden /><ArrowUp size={14} aria-hidden /></>}
      <span>{label}</span>
    </span>
  );
}

/** 奖励走到哪一步：主路 等价格 → 冷却中 → 已解锁 → 已提现；岔路 冻结（可解冻）、冲正（余额不够的进待追回）。点一个状态筛下方列表。 */
export function F5StatusFlow({ data, statusFilter, onStatus, pendingCount, onPending }: {
  data: F5CommissionAuditOverview;
  statusFilter: string;
  onStatus: (status: string) => void;
  /** 等价格的组数；选了状态时后端不返回这一项，页面传 undefined。 */
  pendingCount: number | undefined;
  onPending: () => void;
}) {
  const counts: Record<string, number> = {};
  const known = new Set<string>();
  data.statusDistribution.forEach((item) => {
    const key = STATUS_BY_LABEL[item.nm];
    if (key) { counts[key] = Number(item.ct); known.add(key); }
  });
  const node = (status: string, extra?: { money?: Money; note?: ReactNode }) => (
    <Node status={status} count={counts[status]} money={extra?.money} note={extra?.note} testid="f5-status-distribution-item"
      selected={statusFilter === status} onSelect={known.has(status) ? () => onStatus(status) : undefined} />
  );
  const total = splitMoneyLabel(data.summary.monthlyCommissionSpendLabel);
  const totalCount = data.commissionKinds.reduce((sum, item) => sum + (Number.parseInt(item.ct, 10) || 0), 0);
  const policy = data.coolingPolicy;
  return (
    <Panel icon={Route} tone="role-2" title="奖励走到哪一步" className="f5-flow-panel"
      sub={<>全部记录 · {totalCount.toLocaleString("en-US")} 笔{total && <> · 合计 {total.usdt} USDT · {total.uvt} UVT</>}</>}
      explain={<>
        <p>数的是八类奖励的全部记录，不跟下方的筛选变。点一个状态，下方列表只看这个状态；再点一次取消。</p>
        <p>合计是八类、所有状态的金额相加，包括已冲正和已拒绝，不是实际发出去的钱；两种币分开算，不相加。</p>
        <p>等价格的好友奖励在 UVT 价格可用后算出金额，进入冷却中；冷却到期自动解锁，也可以提交审批提前解锁；用户提走后是已提现。</p>
        <p>冷却中、已解锁、已冻结三种都能冲正；补发会生成一笔新记录，原记录不变。</p>
        <p>只有冷却中和已解锁有金额，其余状态后端只给笔数。金额是后端汇总时四舍五入到两位小数的数。</p>
      </>}>
      <div className="f5-flow" role="group" aria-label="奖励状态流程">
        <div className="f5-flow-main">
          <button type="button" className="f5-node" data-status="pending" onClick={onPending} aria-label={`等价格 ${pendingCount ?? "—"} 组，点一下看等价格的奖励`}>
            <span className="f5-node-head">
              <span className="f5-node-dot" data-tone="neutral" aria-hidden />
              <span className="f5-node-name">等价格</span>
            </span>
            <span className="f5-node-count" data-zero={pendingCount ? undefined : ""}>{pendingCount === undefined ? "—" : pendingCount.toLocaleString("en-US")}<small>组</small></span>
            <span className="f5-node-note">{pendingCount === undefined ? "选了状态时不返回" : "金额还没算出"}</span>
          </button>
          <FlowLink label="算出金额" />
          {node("cooling", { money: splitMoneyLabel(data.summary.coolingBalanceLabel) })}
          <FlowLink label="到期解锁" tone="action" />
          {node("unlocked", { money: splitMoneyLabel(data.summary.withdrawableThisMonthLabel), note: "能提多少以钱包为准" })}
          <FlowLink label="提现" />
          {node("withdrawn")}
        </div>
        <div className="f5-flow-branch">
          <div className="f5-flow-branch-col" data-col="pending">
            <FlowLink dir="none" label="另有旧记录" />
            {node("rejected", { note: "以前没发出去" })}
          </div>
          <div className="f5-flow-branch-col" data-col="cooling">
            <FlowLink dir="both" label="冻结 / 解冻" tone="action" />
            {node("frozen")}
          </div>
          <div className="f5-flow-branch-col" data-col="unlocked">
            <FlowLink dir="down" label="冲正" tone="action" />
            {node("reversed", { note: "非好友奖励可补发" })}
          </div>
          <div className="f5-flow-branch-col" data-col="withdrawn">
            <FlowLink dir="down" label="余额不够收回" />
            {node("recovery_pending")}
          </div>
        </div>
      </div>
      <Fold inset title="各类奖励的冷却期" icon={Layers3}
        summary={policy.length ? `${policy.length} 类 · ${policy.filter((item) => item.days > 0).map((item) => `${KIND_LABELS[item.kind] ?? "未知类型"} ${item.days} 天`).join("、") || "都是即时"}` : "后端没有返回"}
        explain="好友购买和好友设备收益两类的冷却期按「团队奖励设置」里的好友奖励政策，不在这张表里。">
        {policy.length ? (
          <Table label="各类奖励的冷却期" className="f5-cool-table">
            <thead><tr><Th>奖励类型</Th><Th align="right">冷却期</Th><Th>说明</Th></tr></thead>
            <tbody>
              {policy.map((item) => (
                <Tr key={item.kind}>
                  <Td>{KIND_LABELS[item.kind] ?? "未知奖励类型"}</Td>
                  <Td align="right">{item.days ? `${item.days} 天` : "即时"}</Td>
                  <Td grow>{item.policy.includes("commission/cooling-days") ? "按团队奖励的统一冷却天数" : operatorCopyText(item.policy) || "—"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <p className="f5-weak">后端没有返回冷却期设置。</p>}
      </Fold>
    </Panel>
  );
}

/** 八类奖励：每类的笔数和两种币金额；条是这一类占全部笔数的多少（按笔数算，不按金额）。点一类筛下方列表。 */
export function F5KindTiles({ data, kindFilter, onKind }: { data: F5CommissionAuditOverview; kindFilter: string; onKind: (kind: string) => void }) {
  const counts = data.commissionKinds.map((item) => Number.parseInt(item.ct, 10) || 0);
  const total = counts.reduce((sum, value) => sum + value, 0);
  return (
    <Panel icon={Layers3} tone="role-1" title="八类奖励" sub="全部记录"
      explain="每类的笔数和两种币的金额，算全部记录，不跟下方筛选变。条是这一类占全部笔数的比例，按笔数算，不按金额。金额是后端汇总时四舍五入到两位小数的数。">
      <div className="f5-kinds">
        {data.commissionKinds.map((item, index) => {
          const money = splitMoneyLabel(item.amt);
          const count = counts[index];
          const on = kindFilter === item.key;
          const name = KIND_LABELS[item.key] ?? item.lbl;
          return (
            <button key={item.key} type="button" className="f5-kind" data-testid="f5-commission-kind-card" data-kind={item.key} aria-pressed={on}
              aria-label={`${name} ${count} 笔，${on ? "再点一次取消筛选" : "点一下只看这一类"}`} onClick={() => onKind(item.key)}>
              <span className="f5-kind-head"><span className="f5-kind-name">{name}</span>{on && <span className="f5-node-on"><Check size={12} strokeWidth={2.4} aria-hidden />已筛选</span>}</span>
              <span className="f5-kind-count" data-zero={count ? undefined : ""}>{count.toLocaleString("en-US")}<small>笔{total ? ` · 占 ${Math.round((count / total) * 100)}%` : ""}</small></span>
              <RatioBar quiet label={`${name}占全部笔数`} value={count} total={total} valueText={`${count} 笔，全部 ${total} 笔`} tone="role-1"
                state={total === 0 ? "empty" : "ready"} emptyText="还没有记录" />
              {money ? (
                <span className="f5-kind-money">
                  <span data-zero={/^0(\.0+)?$/.test(money.usdt) ? "" : undefined}>{money.usdt} <small>USDT</small></span>
                  <span data-zero={/^0(\.0+)?$/.test(money.uvt) ? "" : undefined}>{money.uvt} <small>UVT</small></span>
                </span>
              ) : <span className="f5-kind-money" data-empty="">金额读不懂</span>}
            </button>
          );
        })}
      </div>
    </Panel>
  );
}


