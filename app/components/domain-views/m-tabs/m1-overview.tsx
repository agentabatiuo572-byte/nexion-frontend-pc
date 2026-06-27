"use client";

/**
 * M1 客服中心总览 — 全派生只读看板(helpdesk 设计稿布局),零新 mock。
 * 数字单源派生自 pget(I.support.* / I.session.*),与 M2/M3/M4 写的真写键同源。
 * 4 KPI(可点进台)+ 分类 SLA 达成与超时风险 + 坐席负载;调整负载 = 高敏配置(必填理由 → setParam + logAudit)。
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  LOAD_CONFIG_DEFAULT,
  type LoadConfig,
  type SessionConvo,
  type SupportSla,
  type SupportTicket,
  type SupportTicketCategory,
} from "./data";
import { Icon, type IconName, Modal, Toggle } from "../design-kit";
import { catCN, MAvatar } from "./hd-ui";
import type { MCtx } from "./types";
import type { MSupportAgent } from "@/lib/admin/m-client";

const TICKET_KEY = "I.support.tickets";
const SLA_KEY = "I.support.sla";
const CONVO_KEY = "I.session.convos";
const AGENT_LIST_KEY = "I.support.agents";
const LOAD_KEY = (f: string) => `I.support.load.${f}`;
const AGENT_CAP_KEY = (name: string) => `I.support.agent.${name}.cap`;
const AGENT_BUSY_KEY = (name: string) => `I.support.agent.${name}.busy`;

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
const numOr = (raw: string | undefined, fb: number) => {
  const n = Number(raw);
  return raw != null && raw !== "" && !Number.isNaN(n) ? n : fb;
};
const boolOr = (raw: string | undefined, fb: boolean) => (raw === "1" ? true : raw === "0" ? false : fb);

function catRisk(tickets: SupportTicket[], cat: SupportTicketCategory): { lvl: string; pct: number; n: number } {
  const open = tickets.filter((t) => t.category === cat && (t.status === "open" || t.status === "in_progress" || t.status === "pending_user"));
  if (open.some((t) => t.priority === "urgent")) return { lvl: "超时风险", pct: 105, n: open.length };
  if (open.some((t) => t.priority === "high")) return { lvl: "临近", pct: 82, n: open.length };
  if (open.length) return { lvl: "达成", pct: 40, n: open.length };
  return { lvl: "达成", pct: 12, n: 0 };
}

function SlaBar({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div style={{ flex: 1, height: 6, background: "var(--surface-3)", borderRadius: 999, overflow: "hidden" }}>
      <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: tone, borderRadius: 999 }} />
    </div>
  );
}

export function M1Overview({ ctx }: { ctx: MCtx }) {
  const { pget } = ctx;
  const [showLoad, setShowLoad] = useState(false);

  const tickets = useMemo(() => parseParamArray<SupportTicket>(pget(TICKET_KEY), []), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);
  const convos = useMemo(() => parseParamArray<SessionConvo>(pget(CONVO_KEY), []), [ctx.params, pget]);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const pendingUser = tickets.filter((t) => t.status === "pending_user").length;
  const liveSessions = convos.filter((c) => c.status === "open").length;
  const pendingReplies = convos.filter((c) => c.status === "open" && c.messages[c.messages.length - 1]?.sender === "user").length;

  const loadCfg: LoadConfig = {
    autoBalance: boolOr(pget(LOAD_KEY("autoBalance")), LOAD_CONFIG_DEFAULT.autoBalance),
    defaultCap: numOr(pget(LOAD_KEY("defaultCap")), LOAD_CONFIG_DEFAULT.defaultCap),
    burstCap: numOr(pget(LOAD_KEY("burstCap")), LOAD_CONFIG_DEFAULT.burstCap),
    warnPct: numOr(pget(LOAD_KEY("warnPct")), LOAD_CONFIG_DEFAULT.warnPct),
    quietHourBalance: boolOr(pget(LOAD_KEY("quietHourBalance")), LOAD_CONFIG_DEFAULT.quietHourBalance),
    overflowQueue: pget(LOAD_KEY("overflowQueue")) ?? LOAD_CONFIG_DEFAULT.overflowQueue,
  };

  const loadRows = supportAgents.map((a) => {
    const openTk = tickets.filter((t) => t.owner === a.name && (t.status === "open" || t.status === "in_progress")).length;
    const openCv = convos.filter((c) => c.owner === a.name && c.status === "open").length;
    const total = openTk + openCv;
    const cap = numOr(pget(AGENT_CAP_KEY(a.name)), a.maxConcurrent || loadCfg.defaultCap);
    const busy = boolOr(pget(AGENT_BUSY_KEY(a.name)), Boolean(a.busy || !a.enabled));
    const util = Math.round((total / Math.max(1, cap)) * 100);
    return { id: a.id, name: a.name, role: a.position, enabled: a.enabled, openTk, openCv, total, cap, busy, util };
  }).sort((x, y) => y.util - x.util);
  const busyCount = loadRows.filter((r) => r.busy).length;
  const maxLoad = Math.max(1, ...loadRows.map((l) => Math.max(l.total, l.cap)));

  const kpis: Array<{ label: string; val: number; sub: string; icon: IconName; tone: boolean; to: string }> = [
    { label: "进行中工单", val: openTickets, sub: "待处理 + 处理中", icon: "doc", tone: true, to: "/service/tickets" },
    { label: "待用户补充", val: pendingUser, sub: "等待用户回传", icon: "clock", tone: false, to: "/service/tickets" },
    { label: "进行中会话", val: liveSessions, sub: "实时接待中", icon: "users", tone: true, to: "/service/sessions" },
    { label: "待坐席回复", val: pendingReplies, sub: "用户已发待回", icon: "bell", tone: false, to: "/service/sessions" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="m-toolbar">
        <span className="dim" style={{ fontSize: 13 }}>工单和会话的实时概况,只看不改</span>
        <span className="sp" />
        <Link href="/service/tickets" className="btn btn-sec btn-sm">
          <Icon name="doc" size={16} />
          进工单台
        </Link>
        <Link href="/service/sessions" className="btn btn-pri btn-sm">
          <Icon name="users" size={16} />
          进会话台
        </Link>
      </div>

      <div className="m1-kpis">
        {kpis.map((k) => (
          <Link key={k.label} href={k.to} className="card card-pad" style={{ display: "flex", flexDirection: "column", gap: 12, textDecoration: "none", color: "inherit" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>{k.label}</span>
              <span style={{ width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center", background: k.tone ? "var(--m-hd-soft)" : "var(--surface-2)", color: k.tone ? "var(--m-hd-2)" : "var(--ink-3)" }}>
                <Icon name={k.icon} size={16} />
              </span>
            </div>
            <div>
              <div className="tnum" style={{ fontSize: 30, fontWeight: 500, letterSpacing: "-0.02em", lineHeight: 1, color: "var(--ink)" }}>{k.val}</div>
              <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 6 }}>{k.sub}</div>
            </div>
          </Link>
        ))}
      </div>

      <div className="m1-cols">
        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <div className="sec-h">
              <span className="t">SLA 监控</span>
              <span className="sp" />
              <span className="n">首响 / 解决</span>
            </div>
          </div>
          <div style={{ padding: "0 18px 14px" }}>
            {sla.map((row) => {
              const r = catRisk(tickets, row.category);
              const tone = r.lvl === "超时风险" ? "var(--m-urgent)" : r.lvl === "临近" ? "var(--m-high)" : "var(--m-ok)";
              return (
                <div key={row.category} className="m1-sla-row">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                      {catCN(row.category)} <span className="dim2 mono" style={{ fontWeight: 400, fontSize: 11 }}>{row.category}</span>
                    </span>
                    <span className="dim2" style={{ fontSize: 11.5 }}>在途 {r.n} · {row.queue}</span>
                  </div>
                  <SlaBar pct={r.pct} tone={tone} />
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, color: tone, fontWeight: 500 }}>{r.lvl}</span>
                    <div className="mono dim2" style={{ fontSize: 11 }}>{row.firstResponseMins}m / {row.resolutionHours}h</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-pad" style={{ paddingBottom: 6 }}>
            <div className="sec-h">
              <span className="t">坐席负载</span>
              <span className="n">{busyCount} 忙 / {loadRows.length}</span>
              {loadCfg.autoBalance && (
                <span className="chip" style={{ height: 18, fontSize: 11.5, color: "var(--m-hd-2)", background: "var(--m-hd-soft)", border: "none" }}>
                  <Icon name="gauge" size={12} />
                  自动平衡
                </span>
              )}
              <span className="sp" />
              <button type="button" className="btn btn-sec btn-sm" onClick={() => setShowLoad(true)}>
                <Icon name="gauge" size={16} />
                调整负载
              </button>
            </div>
          </div>
          <div style={{ padding: "0 18px 16px" }}>
            {loadRows.length === 0 ? (
              <div className="itint" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>暂无客服坐席</div>
                <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>坐席名单来自 A1 管理员里的客服角色,请先给管理员分配客服角色。</div>
              </div>
            ) : loadRows.map((l) => {
              const tone = l.util >= 100 ? "var(--m-urgent)" : l.util >= loadCfg.warnPct ? "var(--m-high)" : l.util >= 50 ? "var(--m-hd-2)" : "var(--m-ok)";
              return (
                <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border)" }}>
                  <MAvatar name={l.name} size="sm" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{l.name}</span>
                      <span className="dim2" style={{ fontSize: 11.5 }}>{l.role}</span>
                      {!l.enabled && (
                        <span className="chip" style={{ height: 18, fontSize: 11.5, color: "var(--ink-3)", background: "var(--surface-3)", border: "none" }}>未启用</span>
                      )}
                      {l.busy && (
                        <span className="chip" style={{ height: 18, fontSize: 11.5, color: "var(--m-high)", background: "var(--m-high-soft)", border: "none" }}>暂停接派单</span>
                      )}
                    </div>
                    <div style={{ height: 6, background: "var(--surface-3)", borderRadius: 999, marginTop: 6, overflow: "hidden", position: "relative" }}>
                      <div style={{ width: `${Math.min(100, (l.total / Math.max(1, l.cap)) * 100)}%`, height: "100%", background: tone, borderRadius: 999, transition: "width .3s" }} />
                      <div style={{ position: "absolute", left: `${(l.cap / maxLoad) * 100}%`, top: -2, bottom: -2, width: 1, background: "var(--border-strong)" }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 96, gap: 2 }}>
                    <span className="tnum" style={{ fontSize: 13, color: tone, fontWeight: 500 }}>{l.util}%</span>
                    <span className="mono dim2" style={{ fontSize: 11.5 }}>{l.total} / {l.cap} · {l.openTk}单 {l.openCv}话</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="dim2" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        <b style={{ color: "var(--ink-3)", fontWeight: 500 }}>口径</b>:本页数字来自后端工单、会话、SLA 与坐席负载配置。坐席名单来自 A1 客服角色,岗位 / 服务类型在 M5 配置;负载从工单 / 会话 owner 派生,负载调度策略经「调整负载」高敏弹窗落库。
      </p>

      {showLoad && <LoadConfigModal ctx={ctx} loadCfg={loadCfg} rows={loadRows} onClose={() => setShowLoad(false)} />}
    </div>
  );
}

/* ============ 坐席负载调度弹窗(高敏 · 必填理由 · setParam 真写 + 审计)============ */
type LoadRow = { id: string; name: string; role: string; enabled: boolean; total: number; cap: number; busy: boolean; util: number };

function LoadConfigModal({ ctx, loadCfg, rows, onClose }: { ctx: MCtx; loadCfg: LoadConfig; rows: LoadRow[]; onClose: () => void }) {
  const [autoBalance, setAutoBalance] = useState(loadCfg.autoBalance);
  const [defaultCap, setDefaultCap] = useState(String(loadCfg.defaultCap));
  const [burstCap, setBurstCap] = useState(String(loadCfg.burstCap));
  const [warnPct, setWarnPct] = useState(String(loadCfg.warnPct));
  const [quietHour, setQuietHour] = useState(loadCfg.quietHourBalance);
  const [overflow, setOverflow] = useState(loadCfg.overflowQueue);
  const [caps, setCaps] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.id, String(r.cap)])));
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>(() => Object.fromEntries(rows.map((r) => [r.id, r.busy])));
  const [reason, setReason] = useState("");
  const reasonOk = reason.trim().length >= 6;

  const clamp = (v: string, lo: number, hi: number) => String(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))));

  function save() {
    if (!reasonOk) return;
    const r = reason.trim();
    let changed = autoBalance !== loadCfg.autoBalance
      || quietHour !== loadCfg.quietHourBalance
      || Number(defaultCap) !== loadCfg.defaultCap
      || Number(burstCap) !== loadCfg.burstCap
      || Number(warnPct) !== loadCfg.warnPct
      || overflow.trim() !== loadCfg.overflowQueue;
    const agentState: Record<string, { cap: number; busy: boolean }> = {};
    for (const r2 of rows) {
      const nc = clamp(caps[r2.id] ?? String(r2.cap), 0, 40);
      agentState[r2.id] = { cap: Number(nc), busy: Boolean(busyMap[r2.id]) };
      if (Number(nc) !== r2.cap || busyMap[r2.id] !== r2.busy) changed = true;
    }
    if (!changed) {
      ctx.toast("负载调度未变更");
      onClose();
      return;
    }
    ctx.setParam("I.support.load.__bulk", JSON.stringify({
      autoBalance,
      defaultCap: Number(clamp(defaultCap, 0, 40)),
      burstCap: Number(clamp(burstCap, 0, 40)),
      warnPct: Number(clamp(warnPct, 50, 100)),
      quietHourBalance: quietHour,
      overflowQueue: overflow.trim(),
      agentState,
    }), { action: "M1 坐席负载调度", reason: r });
    ctx.toast("负载调度已提交 · 后端留档");
    onClose();
  }

  function rebalance() {
    if (!reasonOk) {
      ctx.toast("手动均衡需先填变更理由(≥6 字)");
      return;
    }
    ctx.setParam("I.support.load.__rebalance", JSON.stringify(rows.map((r) => ({
      id: r.id,
      name: r.name,
      cap: r.cap,
      busy: r.busy,
      total: r.total,
      util: r.util,
    }))), { action: "M1 坐席负载手动均衡", reason: reason.trim() });
    ctx.toast("已触发一次手动均衡 · 后端留档");
    onClose();
  }

  const numField = (label: string, hint: string, val: string, set: (v: string) => void, min: number, max: number) => (
    <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
      <span><span style={{ fontSize: 13 }}>{label}</span><span className="sub" style={{ display: "block" }}>{hint}</span></span>
      <input className="fld mono" type="number" min={min} max={max} value={val} onChange={(e) => set(e.target.value)} style={{ width: 88, textAlign: "right" }} />
    </label>
  );

  return (
    <Modal
      title="坐席负载调度"
      icon="gauge"
      wide
      onClose={onClose}
      footer={
        <div className="row" style={{ gap: 10, alignItems: "center", width: "100%" }}>
          <span className="sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <Icon name="shield" size={13} />负载调度影响所有新单分配 · 变更与手动均衡均记入 A2 审计
          </span>
          <div className="spacer" style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button>
          <button type="button" className="btn btn-sec btn-sm" onClick={rebalance}>立即手动均衡</button>
          <button type="button" className="btn btn-pri btn-sm" onClick={save} disabled={!reasonOk}>保存{!reasonOk ? " · 需填理由" : ""}</button>
        </div>
      }
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="sub" style={{ fontWeight: 600 }}>全局策略</div>
          <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span><span style={{ fontSize: 13 }}>自动平衡负载</span><span className="sub" style={{ display: "block" }}>新工单 / 会话按使用率分给最空闲坐席</span></span>
            <Toggle on={autoBalance} onClick={() => setAutoBalance((v) => !v)} />
          </label>
          {numField("默认负载上限(人均)", "单 + 话 合计上限", defaultCap, setDefaultCap, 0, 40)}
          {numField("突发可超额上限", "临时峰值兜底", burstCap, setBurstCap, 0, 40)}
          {numField("使用率预警阈值 %", "达到即标黄", warnPct, setWarnPct, 50, 100)}
          <label className="col" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 13 }}>超额溢出去向</span>
            <input className="fld" value={overflow} onChange={(e) => setOverflow(e.target.value)} placeholder="例:转人工备勤 / 排队 / Nova AI" />
          </label>
          <label className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "center" }}>
            <span><span style={{ fontSize: 13 }}>夜间均衡(22:00–08:00)</span><span className="sub" style={{ display: "block" }}>夜间在岗坐席人均上限减半</span></span>
            <Toggle on={quietHour} onClick={() => setQuietHour((v) => !v)} />
          </label>
        </div>

        <div className="col" style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div className="sub" style={{ fontWeight: 600 }}>坐席个人上限 / 接派单</div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            {rows.map((r, i) => (
              <div key={r.id} className="row" style={{ alignItems: "center", gap: 10, padding: "9px 12px", borderTop: i ? "1px solid var(--border)" : "none" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name}</div>
                  <div className="sub mono">{r.role} · {r.total}/{r.cap} · {r.util}%</div>
                </div>
                <input className="fld mono" type="number" min={0} max={40} value={caps[r.id] ?? String(r.cap)} onChange={(e) => setCaps((s) => ({ ...s, [r.id]: e.target.value }))} style={{ width: 68, textAlign: "right" }} aria-label={`${r.name} 接派单上限`} />
                <Toggle on={!busyMap[r.id]} onClick={() => setBusyMap((s) => ({ ...s, [r.id]: !s[r.id] }))} />
              </div>
            ))}
          </div>
          <div className="sub">右侧开关 = 接派单中 / 关闭即暂停接派单。</div>
        </div>
      </div>

      <label className="col" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 16 }}>
        <span style={{ fontSize: 13 }}>变更理由 <span style={{ color: "var(--danger)" }}>*</span> <span className="sub">(必填 ≥6 字 · 留档至 A2 审计)</span></span>
        <textarea className="fld" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:周一早高峰预期 Withdrawal 峰值,临时提升 Marina K. 上限并暂停 Aisha 接派单培训" style={{ resize: "vertical" }} />
      </label>
    </Modal>
  );
}
