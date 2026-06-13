import { useState } from "react";
import { CodeTag, Badge } from "../design-kit";
import type { EViewCtx } from "./types";
import { ostate, stateLabel } from "./data";
import { EStats } from "./stats";

const Arrow = () => <svg width={16} height={12} viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 6h10M9 2l4 4-4 4" /></svg>;
const Chevron = () => <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 6l6 6-6 6" /></svg>;

const NODES = [
  { cls: "start", nm: "created", ct: "42 在" },
  { cls: "flow", nm: "paid", ct: "18 在" },
  { cls: "flow", nm: "allocating", ct: "7 在 · DC 分配中" },
  { cls: "end", nm: "active ✓", ct: "41,208 累计" },
];
const CONNECTORS = [{ cls: "start", ln: "a" }, { cls: "mid", ln: "b" }, { cls: "end", ln: "c" }];
const BRANCHES = [
  { cls: "err", nm: "payment_failed", ct: "0 在 24h", desc: "支付失败 · created 阶段" },
  { cls: "warn", nm: "expired", ct: "1 在 24h", desc: "订单 30min 未支付" },
  { cls: "err", nm: "provisioning_failed", ct: "2 在 24h", desc: "DC 分配超时" },
  { cls: "warn", nm: "refunded", ct: "1 在 24h", desc: "人工退款 · D4 联动" },
  { cls: "neutral", nm: "cancelled", ct: "0 在 24h", desc: "created/paid 前可取消" },
  { cls: "warn", nm: "补建终态", ct: "1 待处置", desc: "缺失终态 · 对账兜底" },
];
const FILTERS = [
  { s: "all", label: "全部" }, { s: "active", label: "active" }, { s: "allocating", label: "allocating" },
  { s: "paid", label: "paid" }, { s: "failed", label: "failed / 异常" }, { s: "refunded", label: "refunded" },
];

export function E4Orders({ ctx }: { ctx: EViewCtx }) {
  const { orders } = ctx;
  const [curF, setCurF] = useState("all");
  const rows = orders.filter((o) => {
    if (curF === "all") return true;
    return ctx.orderState(o) === curF;
  });

  return (
    <>
      <EStats items={[
        { k: "24h 成交", v: "218", sub: "$524k 总额", tone: "ok" },
        { k: "流转中订单", v: "42", sub: "created / paid / allocating" },
        { k: "失败率 24h", v: "0.9%", sub: "2 笔 · DC 分配超时", tone: "warn" },
        { k: "缺失终态", v: "1", sub: "需补建终态 · 对账兜底", tone: "danger" },
      ]} />

      {/* 状态机流转图 */}
      <section className="sm-card">
        <div className="sm-h">
          <span className="ttl">订单状态机 · 流转图</span>
          <span className="sub">主路径 + 6 类终态分支</span>
          <span className="r"><CodeTag tone="electric">订单状态机</CodeTag><CodeTag>E.order.*</CodeTag></span>
        </div>
        <div className="sm-diagram">
          <div className="sm-path-main">
            {NODES.map((n, i) => (
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
            {BRANCHES.map((b) => (
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
          <span className="sub">最近 24h · 点行查看详情</span>
          <span className="r"><CodeTag tone="electric">A2 审计</CodeTag></span>
        </div>
        <div className="filter-bar">
          {FILTERS.map((f) => (
            <span key={f.s} className={`fchip${curF === f.s ? " on" : ""}`} onClick={() => setCurF(f.s)}>
              {f.s === "all" ? `${f.label} ${orders.length}` : f.label}
            </span>
          ))}
        </div>
        <div className="q-row head">
          <div>订单 ID</div><div>用户</div><div>SKU</div><div style={{ textAlign: "right" }}>金额</div>
          <div>DC 分配</div><div>状态</div><div style={{ textAlign: "right" }}>时长</div><div />
        </div>
        {rows.length === 0 ? (
          <div className="q-empty">当前筛选无匹配</div>
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
      </section>
      <p className="f-foot">补建终态 = 对账兜底:状态机偶发缺失终态时,运营手动落定 <span style={{ fontFamily: "var(--mono)" }}>payment_failed / expired / refunded / provisioning_failed</span> 之一,写 A2 审计。退款 / 取消会联动 <b>D4</b>(资金应付方向)与 <b>C3</b>(用户配额/资产回退),不影响其他订单。</p>
    </>
  );
}
