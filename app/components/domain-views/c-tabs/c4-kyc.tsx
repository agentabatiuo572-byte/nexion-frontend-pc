"use client";

/**
 * C4 KYC 合规台账 — 全平台实名状态的唯一权威台账(design_handoff_c_domain port)。
 * 单源纪律:
 *  - 三段人数闭合 REGISTERED_USERS(C4_STATS.verified = 总数 − 未验证 − 复审中,占比现算);
 *  - 台账行 = data.C4_LEDGER(KR-7738=usr_77D4 按 K 域权威,配对地址与 WITHDRAWALS 同链同址);
 *  - 实名实时态 = pget(`C.kyc.<id>.st`) 覆盖种子(D2/G2/K5 同键取真值,不各存一份);
 *  - 网络白名单 = pget("C.kyc.networks") ?? KYC_NETWORKS(调参真写同键)。
 * 操作确认 显式 edit 契约:人工标记已验证 / 撤销实名 = 处置不传 edit;网络白名单 = 调参传 edit。
 * amplifies 仅放大资金流出方向:人工标记已验证 = 放开提现/兑换门 → true(设计稿标 false 为错,纠正);
 * 撤销实名 = 收紧 → false;触发复审 = 只发 K5 工单不改门槛 → 仍需操作确认 带必填原因。
 */
import { useState } from "react";
import { Download } from "lucide-react";
import { PaginationExemptionList } from "../design-kit";
import { REGISTERED_USERS } from "@/lib/mock/admin/design-data";
import { C4_LEDGER, C4_STATS, KYC_NETWORKS, KYC_STATE, type KycRow } from "./data";
import type { CCtx } from "./types";

type Flt = "all" | KycRow["st"];
const FLT: [Flt, string][] = [["all", "全部"], ["verified", "已验证"], ["none", "未验证"], ["review", "复审中"]];

export function C4Kyc({ ctx }: { ctx: CCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [flt, setFlt] = useState<Flt>("all");
  const [cur, setCur] = useState<string>(C4_LEDGER[0].id);

  // 实名实时态:pget 覆盖种子(C.kyc.<id>.st 与 D2/G2/K5 同键真值)。
  const liveSt = (r: KycRow): KycRow["st"] =>
    (pget(`C.kyc.${r.id}.st`) as KycRow["st"] | undefined) ?? r.st;
  const networks = pget("C.kyc.networks") ?? KYC_NETWORKS;

  const rows = C4_LEDGER.filter((r) => flt === "all" || liveSt(r) === flt);
  const sel = C4_LEDGER.find((r) => r.id === cur) ?? C4_LEDGER[0];
  const selSt = liveSt(sel);
  const verifiedPct = ((C4_STATS.verified / REGISTERED_USERS) * 100).toFixed(1);
  // K5 在审工单数实时跟裁决(种子 14 − 已裁决数,与 K5 页同源同减;audit R2 P2 修:防种子静态分叉)。
  // 只计种子工单(KR-纯数字);手动补触发工单(KR-M-*)不在基数 14 内,其裁决不参与扣减。
  const k5Decided = Object.keys(ctx.params).filter((k) => /^K\.kyc\.KR-\d+\.decision$/.test(k)).length;
  const k5Open = Math.max(0, C4_STATS.k5OpenTickets - k5Decided);

  const markVerified = () => openActionConfirm({
    action: `人工标记已验证 · ${sel.id}`,
    detail: "人工把该用户标为已验证(线下尽调等特殊场景)。标记后该用户提现(D2)/兑换(G2)门槛立即放开——放大资金流出方向,确认时同步核验覆盖率。实名状态是提现/兑换/复审三方的门槛真值,变更操作确认 + 防重号,产 admin.kyc_status_changed 同步给 D2 / G2 / K5。",
    amplifies: true,
    run: (reason) => {
      setParam(`C.kyc.${sel.id}.st`, "verified", { action: `人工标记已验证 ${sel.id}`, reason });
      toast(`${sel.id} 实名状态已变更 · 已同步 D2/G2/K5`);
    },
  });

  const revokeVerified = () => openActionConfirm({
    action: `撤销实名 · ${sel.id}`,
    detail: "撤销后该用户的提现、兑换门槛立即重新卡住——影响面大,务必写清依据。实名状态是提现/兑换/复审三方的门槛真值,变更操作确认 + 防重号,产 admin.kyc_status_changed 同步给 D2 / G2 / K5。",
    amplifies: false,
    run: (reason) => {
      setParam(`C.kyc.${sel.id}.st`, "none", { action: `撤销实名 ${sel.id}`, reason });
      toast(`${sel.id} 实名状态已变更 · 已同步 D2/G2/K5`);
    },
  });

  const trigReview = () => openConfirm({
    action: `触发增强复审 · ${sel.id}`,
    detail: "只生成复审工单交给大额复审台(K5),不直接改实名状态;K5 操作确认裁决后回写这里。单人可触发,写原因留痕。",
    chips: [["仅发工单 · 不改状态", "done"], ["裁决在 K5 操作确认", "ready"]],
    reason: true,
    okLabel: "确认触发",
    run: (reason) => {
      setParam(`C.kyc.${sel.id}.st`, "review", { action: `触发增强复审 ${sel.id}(发 K5 工单)`, reason });
      toast(`${sel.id} 复审工单已发 K5 · 状态升复审中`);
    },
  });

  const adjustNetworks = () => openActionConfirm({
    action: "配对网络白名单调整",
    detail: `当前 ${networks}。配对地址必须在白名单网络内;关掉某网络后,新配对不能选它,已配对的不受影响。操作确认。`,
    amplifies: false,
    edit: { kind: "text", current: networks },
    run: (reason, v) => {
      if (!v) return;
      setParam("C.kyc.networks", v, { action: "配对网络白名单调整", reason });
      toast(`网络白名单已更新为 ${v} · 理由留痕`);
    },
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">已验证</div><div className="v">{C4_STATS.verified.toLocaleString("en-US")}</div><div className="sub">占 {verifiedPct}%</div></div>
        <div className="f-stat"><div className="k">未验证</div><div className="v">{C4_STATS.unverified.toLocaleString("en-US")}</div><div className="sub">触发场景:首次提现 / 累计兑换过线 / 主动</div></div>
        <div className="f-stat warn"><div className="k">复审中</div><div className="v">{C4_STATS.inReview.toLocaleString("en-US")}</div><div className="sub">含待补件长尾 · 其中 K5 在审工单 {k5Open} · 裁决回写这里</div></div>
        <div className="f-stat cyan"><div className="k">验证费</div><div className="v">${C4_STATS.feeUsd}</div><div className="sub">计入用户余额 · 实际免费</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">触发条件与网络白名单</span>
          <span className="sub">· 触发阈值的调整入口不在这页:累计线在 K5、兑换日额度在 G2,这里只读展示</span>
          <div className="r"><span className="ccode lock">🔒 阈值归 K5 / G2 · 只读</span></div>
        </div>
        <div className="l-b">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div className="ctint"><b>触发场景(只读)</b> · 首次提现 / 终身累计兑换 ≥ $100 / 用户主动验证——命中任一即要求完成实名</div>
            <div className="ctint"><b>验证费</b> · $1(进用户余额)· 固定值,要改走治理流程</div>
            <div className="ctint" style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1 }}><b>配对网络白名单</b> · {networks}</span>
              <button className="l-btn sm mc" onClick={adjustNetworks}>调整</button>
            </div>
          </div>
        </div>
      </section>

      <div className="two-col r13-1">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">KYC 状态列表</span>
            <span className="sub">· 点行看详情</span>
            <div className="r">
              <div className="chips">
                {FLT.map(([v, lb]) => (
                  <button key={v} className={`chip${flt === v ? " sel" : ""}`} onClick={() => setFlt(v)}>{lb}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 680 }}>
              <thead><tr><th>账户</th><th>状态</th><th>配对地址(脱敏)</th><th>网络</th><th>配对时间</th><th>触发来源</th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const st = KYC_STATE[liveSt(r)];
                  return (
                    <tr key={r.id} className="click" onClick={() => setCur(r.id)} style={r.id === cur ? { background: "var(--surface-2)" } : undefined}>
                      <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.id}</td>
                      <td><span className={`bdg ${st[1]}`}>{st[0]}</span></td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{r.addr}</td>
                      <td className="mono" style={{ fontSize: 11.5 }}>{r.net}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{r.at}</td>
                      <td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r.src}</td>
                    </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--ink-4)", padding: "22px 12px" }}>该状态下暂无台账行 · 换个筛选试试</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">详情 · {sel.id}</span>
            <span className="sub">· 变更历史全留痕</span>
            <div className="r">
              {selSt !== "verified" && <button className="l-btn mc" onClick={markVerified}>人工标记已验证</button>}
              {selSt === "verified" && <button className="l-btn mc" onClick={revokeVerified}>撤销实名</button>}
              {selSt !== "review" && <button className="l-btn" onClick={trigReview}>触发复审</button>}
            </div>
          </div>
          <div className="l-b">
            {sel.info.map(([k, v], i) => (
              <div className="kv" key={k}>
                <span className="k">{k}</span>
                <span className="v">{i === 0 && k === "当前状态" && selSt !== sel.st ? `${KYC_STATE[selSt][0]}(本会话人工变更 · 已写审计)` : v}</span>
              </div>
            ))}
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>状态变更历史</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.9 }}>
              {sel.hist.map((h) => <div key={h}>· {h}</div>)}
            </div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>权威与引用关系</b>:实名状态只有这一本台账,提现门槛(D2)、兑换门槛(G2)、大额复审(K5)统一调同一个读取口取真值,不各存一份。复审两条路:触发是「事件通知」(K5 发工单、这里把状态升为复审中);裁决是「接口回写」(K5 操作确认通过/驳回后直接改这里的状态)。配对地址全程脱敏;监管导出按要求脱敏处理,落审计。人工标记/撤销带防重号,变更产 <b>admin.kyc_status_changed</b> 事件喂审计(A2)、提现(D2)、兑换(G2)、复审(K5)和监管报告(L5)。</p>
      <PaginationExemptionList
        items={[
          {
            label: "KYC 状态列表",
            maxRows: 5,
            reason: "KYC 台账当前页固定五条样本,按状态筛选即时缩小范围",
          },
        ]}
      />
    </>
  );
}

export function C4HeaderActions({ ctx }: { ctx: CCtx }) {
  return (
    <button
      className="f-cta"
      onClick={() => ctx.openConfirm({
        action: "监管导出(脱敏)",
        detail: "导出台账(账户 / 状态 / 网络 / 配对时间),地址按监管要求脱敏。聚合脱敏导出,单人可办,落审计;批量明细导出走 L5 管控。",
        okLabel: "确认导出",
        run: () => {
          ctx.logAudit({ actor: "总管理员", action: "KYC 台账监管导出(脱敏)", target: "C4" });
          ctx.toast("KYC 台账已导出(脱敏)· 落审计");
        },
      })}
    >
      <Download size={14} />
      监管导出(脱敏)
    </button>
  );
}
