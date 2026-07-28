import { useMemo } from "react";
import { CodeTag, Badge, DataListPager } from "../design-kit";
import type { EViewCtx } from "./types";
import { ostate, stateLabel } from "./data";
import { EStats } from "./stats";

const Arrow = () => <svg width={16} height={12} viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 6h10M9 2l4 4-4 4" /></svg>;
const Chevron = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>;

const CONNECTORS = [{ cls: "start", ln: "a" }, { cls: "mid", ln: "b" }, { cls: "end", ln: "c" }];
// 筛选值 s 是后端订单状态机契约(backend-canonical,不可改);label 运营可读中文,复用 data.ts 的 stateLabel 单一真源。
const ORDER_STATES = ["placed", "paid", "provisioning", "activated", "payment_failed", "expired", "provisioning_failed", "refunded", "chargeback", "cancelled"] as const;
const FILTERS = [
  { s: "all", label: "全部" },
  ...ORDER_STATES.map((s) => ({ s, label: stateLabel(s) })),
];
const IN_FLIGHT_STATES = new Set(["placed", "paid", "provisioning"]);
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
    .filter((o) => ctx.orderState(o) === "activated")
    .reduce((sum, o) => sum + o.amt, 0);
  const inFlight = orders.filter((o) => IN_FLIGHT_STATES.has(ctx.orderState(o))).length;
  // 状态机主路径节点:nm 中文主标(运营可读);ct 计数补全语义(原"X 在"语意残缺)。
  const nodes = [
    { cls: "start", nm: "已下单", ct: `${stateCounts.get("placed") ?? 0} 单` },
    { cls: "flow", nm: "已支付", ct: `${stateCounts.get("paid") ?? 0} 单` },
    { cls: "flow", nm: "开通中", ct: `${stateCounts.get("provisioning") ?? 0} 单 · DC 分配` },
    { cls: "end", nm: "已激活 ✓", ct: `${stateCounts.get("activated") ?? 0} 单` },
  ];
  // 终态分支:nm 中文主标;desc 补因果(去状态码裸用,与 nm 不重复)。
  const branches = [
    { cls: "err", nm: "支付失败", ct: `${stateCounts.get("payment_failed") ?? 0} 单`, desc: "下单后未成功扣款" },
    { cls: "warn", nm: "已过期", ct: `${stateCounts.get("expired") ?? 0} 单`, desc: "订单超时未支付" },
    { cls: "err", nm: "开通失败", ct: `${stateCounts.get("provisioning_failed") ?? 0} 单`, desc: "DC 分配超时" },
    { cls: "warn", nm: "已退款", ct: `${stateCounts.get("refunded") ?? 0} 单`, desc: "人工退款 · D1/D4 资金闭环" },
    { cls: "err", nm: "拒付", ct: `${stateCounts.get("chargeback") ?? 0} 单`, desc: "支付渠道拒付 / 争议" },
    { cls: "neutral", nm: "已取消", ct: `${stateCounts.get("cancelled") ?? 0} 单`, desc: "仅未支付订单可取消" },
  ];
  const rows = orders;

  return (
    <>
      <EStats items={[
        { k: "后端订单", v: ctx.e4Total, sub: ctx.e4Loading ? "同步中" : ctx.e4Error ? "同步异常" : `第 ${ctx.e4Page} 页 ${orders.length} 条`, tone: "ok" },
        { k: "已激活金额", v: money(activeAmount), sub: `当前页 ${stateCounts.get("activated") ?? 0} 笔已激活` },
        { k: "流转中订单", v: inFlight, sub: "当前页 已下单 / 已支付 / 开通中", tone: inFlight ? "cyan" : "" },
        { k: "失败终态", v: (stateCounts.get("payment_failed") ?? 0) + (stateCounts.get("provisioning_failed") ?? 0) + (stateCounts.get("chargeback") ?? 0), sub: "支付失败 / 开通失败 / 拒付", tone: "danger" },
      ]} />

      {/* 状态机流转图 */}
      <section className="sm-card">
        <div className="sm-h">
          <span className="ttl">订单状态机 · 流转图</span>
          <span className="sub">当前页实时状态 · 主路径 + 终态分支</span>
          <span className="r"><CodeTag tone="electric">订单状态机</CodeTag></span>
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
          <span className="sub">当前筛选结果</span>
        </div>
        <div className="filter-bar">
          <input
            className="fld"
            aria-label="搜索订单"
            value={ctx.e4Keyword}
            onChange={(event) => ctx.setE4Keyword(event.target.value)}
            placeholder="订单号 / 用户编码 / SKU"
            style={{ minWidth: 240, flex: "1 1 280px" }}
          />
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
      <p className="f-foot">订单状态以后端订单主数据为准。退款仅允许已支付 / 开通中 / 已激活,并在提交前校验 B1 覆盖率;补建失败终态不包含退款。</p>
    </>
  );
}
