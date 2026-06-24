import { useMemo } from "react";
import { CodeTag, Badge, DataListPager } from "../design-kit";
import type { EViewCtx } from "./types";
import { ostate, stateLabel } from "./data";
import { EStats } from "./stats";

const Arrow = () => <svg width={16} height={12} viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 6h10M9 2l4 4-4 4" /></svg>;
const Chevron = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>;

const CONNECTORS = [{ cls: "start", ln: "a" }, { cls: "mid", ln: "b" }, { cls: "end", ln: "c" }];
const FILTERS = [
  { s: "all", label: "全部" },
  { s: "created", label: "created" },
  { s: "paid", label: "paid" },
  { s: "allocating", label: "allocating" },
  { s: "active", label: "active" },
  { s: "failed", label: "failed" },
  { s: "payment_failed", label: "payment_failed" },
  { s: "expired", label: "expired" },
  { s: "provisioning_failed", label: "provisioning_failed" },
  { s: "refunded", label: "refunded" },
  { s: "cancelled", label: "cancelled" },
];
const IN_FLIGHT_STATES = new Set(["created", "paid", "allocating", "failed"]);
const money = (value: number) => `$${Math.round(value).toLocaleString()}`;

export function E4Orders({ ctx }: { ctx: EViewCtx }) {
  const { orders } = ctx;
  const curF = ctx.e4Filter;
  const stateCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const order of orders) {
      const state = ctx.orderState(order);
      counts.set(state, (counts.get(state) ?? 0) + 1);
    }
    return counts;
  }, [ctx.orderState, orders]);
  const activeAmount = orders
    .filter((o) => ctx.orderState(o) === "active")
    .reduce((sum, o) => sum + o.amt, 0);
  const inFlight = orders.filter((o) => IN_FLIGHT_STATES.has(ctx.orderState(o))).length;
  const missingTerminal = orders.filter((o) => ctx.orderState(o) === "failed").length;
  const nodes = [
    { cls: "start", nm: "created", ct: `${stateCounts.get("created") ?? 0} 在` },
    { cls: "flow", nm: "paid", ct: `${stateCounts.get("paid") ?? 0} 在` },
    { cls: "flow", nm: "allocating", ct: `${stateCounts.get("allocating") ?? 0} 在 · DC 分配中` },
    { cls: "end", nm: "active ✓", ct: `${stateCounts.get("active") ?? 0} 在` },
  ];
  const branches = [
    { cls: "err", nm: "payment_failed", ct: `${stateCounts.get("payment_failed") ?? 0} 在`, desc: "支付失败 · created 阶段" },
    { cls: "warn", nm: "expired", ct: `${stateCounts.get("expired") ?? 0} 在`, desc: "订单超时未支付" },
    { cls: "err", nm: "provisioning_failed", ct: `${stateCounts.get("provisioning_failed") ?? 0} 在`, desc: "DC 分配超时" },
    { cls: "warn", nm: "refunded", ct: `${stateCounts.get("refunded") ?? 0} 在`, desc: "人工退款 · D4 联动" },
    { cls: "neutral", nm: "cancelled", ct: `${stateCounts.get("cancelled") ?? 0} 在`, desc: "created/paid 前可取消" },
    { cls: "warn", nm: "缺失终态", ct: `${missingTerminal} 待处置`, desc: "failed 待补建终态" },
  ];
  const rows = orders;

  return (
    <>
      <EStats items={[
        { k: "后端订单", v: ctx.e4Total, sub: ctx.e4Loading ? "同步中" : ctx.e4Error ? "同步异常" : `第 ${ctx.e4Page} 页 ${orders.length} 条`, tone: "ok" },
        { k: "运行中金额", v: money(activeAmount), sub: `当前页 ${stateCounts.get("active") ?? 0} 笔 active` },
        { k: "流转中订单", v: inFlight, sub: "当前页 created / paid / allocating / failed", tone: inFlight ? "cyan" : "" },
        { k: "缺失终态", v: missingTerminal, sub: "当前页 failed 需补建终态", tone: missingTerminal ? "danger" : "ok" },
      ]} />

      {/* 状态机流转图 */}
      <section className="sm-card">
        <div className="sm-h">
          <span className="ttl">订单状态机 · 流转图</span>
          <span className="sub">当前页实时状态 · 主路径 + 终态分支</span>
          <span className="r"><CodeTag tone="electric">订单状态机</CodeTag><CodeTag>devices/orders</CodeTag></span>
        </div>
        {ctx.e4Error && <div className="tint warn tiny" style={{ marginBottom: 12 }}>E4 同步失败:{ctx.e4Error}</div>}
        {ctx.e4Loading && <div className="tint tiny" style={{ marginBottom: 12 }}>正在同步订单数据...</div>}
        <div className="sm-diagram">
          <div className="sm-path-main">
            {nodes.map((n, i) => (
              <span key={n.nm} style={{ display: "contents" }}>
                <div className={`sm-node ${n.cls}`}>
                  <div className="box"><div className="nm">{n.nm}</div><div className="ct">{n.ct}</div></div>
                </div>
                {i < CONNECTORS.length && (
                  <div className={`sm-connect ${CONNECTORS[i].cls}`}>
                    <span className={`ln ${CONNECTORS[i].ln}`} /><span className="arr"><Arrow /></span>
                  </div>
                )}
              </span>
            ))}
          </div>
          <div className="sm-branches">
            <span className="lbl">异常 / 终止分支 · 6 类终态</span>
            {branches.map((b) => (
              <div className={`sm-branch ${b.cls}`} key={b.nm}>
                <div className="nm">{b.nm}</div><div className="ct">{b.ct}</div><div className="desc">{b.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 订单队列 */}
      <section className="q-card">
        <div className="q-h">
          <span className="ttl">订单队列</span>
          <span className="sub">后端 orders API · pageNum / pageSize · 点行查看详情</span>
          <span className="r"><CodeTag tone="electric">A2 审计</CodeTag></span>
        </div>
        <div className="filter-bar">
          {FILTERS.map((f) => (
            <span key={f.s} className={`fchip${curF === f.s ? " on" : ""}`} onClick={() => ctx.setE4Filter(f.s)}>
              {f.label}
            </span>
          ))}
        </div>
        <div className="q-row head">
          <div>订单 ID</div><div>用户</div><div>SKU</div><div style={{ textAlign: "right" }}>金额</div>
          <div>DC 分配</div><div>状态</div><div style={{ textAlign: "right" }}>时长</div><div />
        </div>
        {ctx.e4Loading ? (
          <div className="q-empty">正在从后端加载第 {ctx.e4Page} 页订单...</div>
        ) : ctx.e4Error ? (
          <div className="q-empty">E4 订单接口读取失败:{ctx.e4Error}</div>
        ) : rows.length === 0 ? (
          <div className="q-empty">{curF === "all" ? "后端暂无订单记录" : "当前状态无匹配订单"}</div>
        ) : rows.map((o) => {
          const st = ctx.orderState(o);
          return (
            <div className="q-row" key={o.id} onClick={() => ctx.openOrder(o)}>
              <div className="oid">{o.id}</div>
              <div className="uid">{o.user}</div>
              <div className="sku">{o.sku}</div>
              <div className="amt">${o.amt.toLocaleString()}</div>
              <div className="dc">{o.dc}</div>
              <div><Badge tone={ostate[st] ?? "neutral"}>{stateLabel(st)}</Badge></div>
              <div className="age">{o.age}</div>
              <div className="chev"><Chevron /></div>
            </div>
          );
        })}
        <DataListPager
          label="订单队列"
          page={ctx.e4Page}
          pageSize={ctx.e4PageSize}
          total={ctx.e4Total}
          onPageChange={ctx.setE4Page}
          onPageSizeChange={ctx.setE4PageSize}
          pageSizeOptions={[10, 20, 50, 100]}
        />
      </section>
      <p className="f-foot">补建终态 = 对账兜底:状态机偶发缺失终态时,运营手动落定 <span style={{ fontFamily: "var(--mono)" }}>payment_failed / expired / refunded / provisioning_failed</span> 之一,由后端写 A2 审计。订单队列通过后端 <span style={{ fontFamily: "var(--mono)" }}>pageNum / pageSize / state</span> 分页读取,退款 / 取消 / 主路径流转均调用后端订单状态机接口。</p>
    </>
  );
}
