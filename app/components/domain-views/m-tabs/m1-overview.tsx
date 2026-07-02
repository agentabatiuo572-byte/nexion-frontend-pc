"use client";

/**
 * M1 客服中心总览 — 全派生只读看板(helpdesk 设计稿布局),零新 mock。
 * 数字单源派生自 pget(I.support.* / I.session.*),与 M2/M3/M4 写的真写键同源。
 * 4 KPI(可点进台)+ 分类 SLA 达成与超时风险 + 坐席负载;调整负载 = 高敏配置(必填理由 → setParam + logAudit)。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  type LoadConfig,
  type SessionConvo,
  type SupportSla,
  type SupportTicket,
  type SupportTicketCategory,
} from "./data";
import { Icon, type IconName, Modal, Toggle } from "../design-kit";
import { catCN, MAvatar } from "./hd-ui";
import type { MCtx } from "./types";
import { changeA1AccountRole, fetchA1Overview, type A1Operator, type A1RoleDefinition } from "@/lib/admin/a1-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { fetchUserProfilesPage, type User360Profile } from "@/lib/admin/user360-client";
import type { MAdvisorAssignment, MSupportAgent } from "@/lib/admin/m-client";

const TICKET_KEY = "I.support.tickets";
const SLA_KEY = "I.support.sla";
const CONVO_KEY = "I.session.convos";
const AGENT_LIST_KEY = "I.support.agents";
const ASSIGNMENT_LIST_KEY = "I.support.advisorAssignments";
const LOAD_KEY = (f: string) => `I.support.load.${f}`;
const AGENT_CAP_KEY = (name: string) => `I.support.agent.${name}.cap`;
const AGENT_BUSY_KEY = (name: string) => `I.support.agent.${name}.busy`;

const SUPPORT_SEAT_ROLES = [
  { key: "support_manager", label: "客服主管", hint: "由超管分配;可分配专属/通用客服" },
  { key: "support_dedicated", label: "专属客服", hint: "由超管/客服主管绑定服务用户" },
  { key: "support_general", label: "通用客服", hint: "接普通工单与即时会话" },
];
const SUPPORT_STAFF_ROLE_KEYS = new Set(["support", "support_dedicated", "support_general"]);
const SUPPORT_ADMIN_ROLE_KEYS = new Set(["support", "support_manager", "support_dedicated", "support_general"]);

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
const boolParam = (raw: string | undefined): boolean | null => (raw === "1" ? true : raw === "0" ? false : null);
const numParam = (raw: string | undefined): number | null => {
  const n = Number(raw);
  return raw != null && raw !== "" && Number.isFinite(n) ? n : null;
};

function loadConfigFromBackendParams(pget: (key: string) => string | undefined): LoadConfig | null {
  const autoBalance = boolParam(pget(LOAD_KEY("autoBalance")));
  const defaultCap = numParam(pget(LOAD_KEY("defaultCap")));
  const burstCap = numParam(pget(LOAD_KEY("burstCap")));
  const warnPct = numParam(pget(LOAD_KEY("warnPct")));
  const quietHourBalance = boolParam(pget(LOAD_KEY("quietHourBalance")));
  const overflowQueue = pget(LOAD_KEY("overflowQueue"));
  if (
    autoBalance == null ||
    defaultCap == null ||
    burstCap == null ||
    warnPct == null ||
    quietHourBalance == null ||
    overflowQueue == null ||
    overflowQueue.trim() === ""
  ) {
    return null;
  }
  return { autoBalance, defaultCap, burstCap, warnPct, quietHourBalance, overflowQueue };
}

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

function numericUserId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = value == null ? "" : String(value).trim();
  if (!raw) return 0;
  const direct = Number(raw);
  if (Number.isFinite(direct)) return direct;
  const matched = raw.match(/\d+/)?.[0];
  const parsed = matched ? Number(matched) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function userIdOf(profile: User360Profile): number {
  return numericUserId(profile.id) || numericUserId(profile.userNo);
}

function userNoOf(profile: User360Profile): string {
  return profile.userNo || (profile.id ? `U${String(profile.id).padStart(8, "0")}` : "未编号用户");
}

function isDedicatedSupportAgent(agent: MSupportAgent): boolean {
  return agent.adminRole === "support_dedicated" || agent.position.includes("专属");
}

function roleLabel(roles: A1RoleDefinition[], role: string): string {
  return roles.find((item) => item.key === role)?.name ?? SUPPORT_SEAT_ROLES.find((item) => item.key === role)?.label ?? role;
}

export function M1Overview({ ctx }: { ctx: MCtx }) {
  const { pget } = ctx;
  const [showLoad, setShowLoad] = useState(false);
  const [showSeatRoles, setShowSeatRoles] = useState(false);
  const [showUserAssign, setShowUserAssign] = useState(false);
  const [assignAgent, setAssignAgent] = useState<MSupportAgent | null>(null);
  const operatorName = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const currentRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const currentRoleKey = String(currentRole);
  const canManageSupportSeats = currentRoleKey === "superadmin" || currentRoleKey === "super" || currentRoleKey === "support_manager";

  const tickets = useMemo(() => parseParamArray<SupportTicket>(pget(TICKET_KEY), []), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);
  const convos = useMemo(() => parseParamArray<SessionConvo>(pget(CONVO_KEY), []), [ctx.params, pget]);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const advisorAssignments = useMemo(() => parseParamArray<MAdvisorAssignment>(pget(ASSIGNMENT_LIST_KEY), []), [ctx.params, pget]);
  const seatAssignmentAgents = useMemo(
    () => supportAgents.filter((agent) => agent.adminId > 0 && agent.enabled),
    [supportAgents],
  );
  const assignableAgents = useMemo(
    () => seatAssignmentAgents.filter((agent) => isDedicatedSupportAgent(agent) && agent.serviceTypes.includes("advisor")),
    [seatAssignmentAgents],
  );
  const activeAdvisorAssignmentCount = advisorAssignments.filter((row) => row.status === "ACTIVE").length;

  const openTickets = tickets.filter((t) => t.status === "open" || t.status === "in_progress").length;
  const pendingUser = tickets.filter((t) => t.status === "pending_user").length;
  const liveSessions = convos.filter((c) => c.status === "open").length;
  const pendingReplies = convos.filter((c) => c.status === "open" && c.messages[c.messages.length - 1]?.sender === "user").length;

  const loadCfg = useMemo(() => loadConfigFromBackendParams(pget), [ctx.params, pget]);

  const loadRows = supportAgents.map((a) => {
    const openTk = tickets.filter((t) => t.owner === a.name && (t.status === "open" || t.status === "in_progress")).length;
    const openCv = convos.filter((c) => c.owner === a.name && c.status === "open").length;
    const assignments = advisorAssignments.filter((row) => row.agentAdminId === a.adminId && row.status === "ACTIVE").length;
    const total = openTk + openCv;
    const cap = numOr(pget(AGENT_CAP_KEY(a.name)), a.maxConcurrent || loadCfg?.defaultCap || 0);
    const busy = boolOr(pget(AGENT_BUSY_KEY(a.name)), Boolean(a.busy || !a.enabled));
    const util = Math.round((total / Math.max(1, cap)) * 100);
    return { id: a.id, agent: a, name: a.name, role: a.position, enabled: a.enabled, openTk, openCv, total, cap, busy, util, assignments };
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
        <span className="dim" style={{ fontSize: 13 }}>工单和会话的实时概况 · 已分配服务用户 {activeAdvisorAssignmentCount}</span>
        <span className="sp" />
        <button
          type="button"
          className="btn btn-sec btn-sm"
          disabled={!canManageSupportSeats}
          title={canManageSupportSeats ? "从 A1 管理员账号里分配客服主管 / 专属客服 / 通用客服坐席" : "只有超管或客服主管可以分配客服坐席"}
          onClick={() => setShowSeatRoles(true)}
        >
          <Icon name="users" size={16} />
          分配坐席
        </button>
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
              {loadCfg?.autoBalance && (
                <span className="chip" style={{ height: 18, fontSize: 11.5, color: "var(--m-hd-2)", background: "var(--m-hd-soft)", border: "none" }}>
                  <Icon name="gauge" size={12} />
                  自动平衡
                </span>
              )}
              {!loadCfg && (
                <span className="chip" style={{ height: 18, fontSize: 11.5, color: "var(--m-high)", background: "var(--m-high-soft)", border: "none" }}>
                  后端配置未返回
                </span>
              )}
              <span className="sp" />
              <button
                type="button"
                className="btn btn-sec btn-sm"
                onClick={() => (loadCfg ? setShowLoad(true) : ctx.toast("M1 负载配置未从后端返回,请先检查 /content/tickets/load-config"))}
                disabled={!loadCfg}
              >
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
              const warnPct = loadCfg?.warnPct ?? 101;
              const tone = l.util >= 100 ? "var(--m-urgent)" : l.util >= warnPct ? "var(--m-high)" : l.util >= 50 ? "var(--m-hd-2)" : "var(--m-ok)";
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
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", minWidth: 118, gap: 4 }}>
                    <span className="tnum" style={{ fontSize: 13, color: tone, fontWeight: 500 }}>{l.util}%</span>
                    <span className="mono dim2" style={{ fontSize: 11.5 }}>{l.total} / {l.cap} · {l.openTk}单 {l.openCv}话</span>
                    <span className="dim2" style={{ fontSize: 11.5 }}>服务用户 {l.assignments}</span>
                    <button
                      type="button"
                      className="btn btn-sec btn-sm"
                      disabled={!canManageSupportSeats || !l.agent.enabled || l.agent.adminId <= 0 || !isDedicatedSupportAgent(l.agent)}
                      title={!canManageSupportSeats ? "只有超管或客服主管可以绑定服务用户" : isDedicatedSupportAgent(l.agent) ? "给此专属客服绑定服务用户" : "只有专属客服可以绑定服务用户"}
                      onClick={() => {
                        setAssignAgent(l.agent);
                        setShowUserAssign(true);
                      }}
                      style={{ marginTop: 2 }}
                    >
                      绑定用户
                    </button>
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

      {showLoad && loadCfg && <LoadConfigModal ctx={ctx} loadCfg={loadCfg} rows={loadRows} onClose={() => setShowLoad(false)} />}
      {showSeatRoles && (
        <SupportSeatRoleModal
          ctx={ctx}
          operatorName={operatorName}
          currentRole={currentRoleKey}
          onClose={() => setShowSeatRoles(false)}
        />
      )}
      {showUserAssign && (
        <SeatAssignmentModal
          ctx={ctx}
          agents={assignableAgents}
          initialAgent={assignAgent}
          onClose={() => {
            setShowUserAssign(false);
            setAssignAgent(null);
          }}
        />
      )}
    </div>
  );
}

/* ============ 坐席负载调度弹窗(高敏 · 必填理由 · setParam 真写 + 审计)============ */
type LoadRow = { id: string; agent: MSupportAgent; name: string; role: string; enabled: boolean; total: number; cap: number; busy: boolean; util: number; assignments: number };

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

function SupportSeatRoleModal({
  ctx,
  operatorName,
  currentRole,
  onClose,
}: {
  ctx: MCtx;
  operatorName: string;
  currentRole: string;
  onClose: () => void;
}) {
  const [roles, setRoles] = useState<A1RoleDefinition[]>([]);
  const [operators, setOperators] = useState<A1Operator[]>([]);
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [targetRole, setTargetRole] = useState("support_general");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const canAssignSupervisor = currentRole === "superadmin" || currentRole === "super";
  const canAssignSupportStaff = canAssignSupervisor || currentRole === "support_manager";
  const roleOptions = canAssignSupportStaff ? SUPPORT_SEAT_ROLES.filter((role) => canAssignSupervisor || role.key !== "support_manager") : [];
  const operatorReady = operatorName.trim().length > 0;
  const normalizedKeyword = keyword.trim().toLowerCase();
  const candidates = operators
    .filter((operator) => operator.status === "enabled")
    .filter((operator) => operator.role !== "super" && operator.role !== "superadmin")
    .filter((operator) => canAssignSupervisor || (canAssignSupportStaff && SUPPORT_STAFF_ROLE_KEYS.has(operator.role)))
    .filter((operator) => {
      if (!normalizedKeyword) return true;
      return [operator.name, operator.email, operator.id, roleLabel(roles, operator.role)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedKeyword);
    });
  const selected = candidates.find((operator) => operator.id === selectedId) ?? candidates[0] ?? null;
  const roleExists = roles.some((role) => role.key === targetRole);
  const reasonOk = reason.trim().length >= 6;
  const canSave = Boolean(canAssignSupportStaff && operatorReady && selected && targetRole && roleExists && reasonOk && selected.role !== targetRole && !saving);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    fetchA1Overview()
      .then((overview) => {
        if (!alive) return;
        setRoles(overview.roles);
        setOperators(overview.operators);
        const first = overview.operators.find((operator) => operator.status === "enabled" && operator.role !== "super");
        setSelectedId((current) => current || first?.id || "");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : "A1_OPERATORS_LOAD_FAILED");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!canAssignSupervisor && targetRole === "support_manager") {
      setTargetRole("support_general");
    }
  }, [canAssignSupervisor, targetRole]);

  useEffect(() => {
    if (selected && !candidates.some((operator) => operator.id === selected.id)) {
      setSelectedId(candidates[0]?.id ?? "");
    }
  }, [candidates, selected]);

  const save = async () => {
    if (!canSave || !selected) return;
    setSaving(true);
    try {
      await changeA1AccountRole(selected.id, targetRole, reason.trim(), operatorName.trim());
      const overview = await fetchA1Overview();
      setRoles(overview.roles);
      setOperators(overview.operators);
      setSelectedId(selected.id);
      ctx.toast(`${selected.name} 已分配为 ${roleLabel(overview.roles, targetRole)};刷新 M 域后进入坐席名单`);
      onClose();
    } catch (err) {
      ctx.toast(`分配失败:${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="分配客服坐席"
      icon="users"
      wide
      onClose={onClose}
      footer={<><span className="sub">{!canAssignSupportStaff ? "只有超管或客服主管可以分配客服坐席" : !operatorReady ? "正在读取当前管理员身份" : canAssignSupervisor ? "超管可分配客服主管 / 专属客服 / 通用客服" : "客服主管只能分配专属客服 / 通用客服"}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button><button type="button" data-proof="m1-seat-role-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={save}>{saving ? "提交中..." : canSave ? "确认分配" : !canAssignSupportStaff || !operatorReady ? "无权限" : roleExists ? "需选择并填写理由" : "后端角色未就绪"}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>搜索管理员</span>
            <div className="inp">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="管理员姓名 / 邮箱 / 当前角色" />
            </div>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflow: "auto", paddingRight: 2 }}>
            {loading && <div className="itint">正在读取 A1 管理员账号...</div>}
            {!loading && error && <div className="itint">A1 管理员读取失败 · {error}</div>}
            {!loading && !error && candidates.length === 0 && (
              <div className="itint">
                <div style={{ fontSize: 13 }}>暂无可分配管理员</div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>搜索源是 A1 管理员账号;客服主管只能调整已有客服坐席。</div>
              </div>
            )}
            {!loading && !error && candidates.map((operator) => {
              const selectedRow = selected?.id === operator.id;
              const isSupportRole = SUPPORT_ADMIN_ROLE_KEYS.has(operator.role);
              return (
                <button
                  key={operator.id}
                  type="button"
                  data-proof="m1-seat-admin-option"
                  onClick={() => setSelectedId(operator.id)}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${selectedRow ? "var(--m-hd-border)" : "var(--border)"}`, background: selectedRow ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{operator.name || operator.email || `管理员 ${operator.id}`}</span>
                    <span className="mono dim2" style={{ fontSize: 11.5 }}>{operator.email || "未配置邮箱"} · {roleLabel(roles, operator.role)}</span>
                  </span>
                  <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{isSupportRole ? "客服" : "可分配"}</span>
                  {selectedRow && <Icon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>目标客服角色</span>
            <div style={{ display: "grid", gap: 8 }}>
              {roleOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className="btn btn-sec btn-sm"
                  onClick={() => setTargetRole(option.key)}
                  style={{ justifyContent: "flex-start", height: "auto", padding: "9px 10px", borderColor: targetRole === option.key ? "var(--m-hd-border)" : undefined, background: targetRole === option.key ? "var(--m-hd-soft)" : undefined }}
                >
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <span style={{ color: "var(--ink)" }}>{roleLabel(roles, option.key)}</span>
                    <span className="dim2" style={{ fontSize: 11.5 }}>{option.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </label>
          {selected && (
            <div className="itint" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 13 }}>当前选择: {selected.name || selected.email}</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>当前角色 {roleLabel(roles, selected.role)} → 目标角色 {roleLabel(roles, targetRole)}</div>
            </div>
          )}
          {!roleExists && (
            <div className="itint" style={{ padding: "10px 12px" }}>
              后端 A1 尚未返回 {targetRole} 角色,请先确认后端已重启并完成角色表自愈。
            </div>
          )}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>分配理由 <b style={{ color: "var(--danger)" }}>*</b></span>
            <textarea className="fld" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客服主管排班调整,将该管理员分配为通用客服承接实时会话。" style={{ resize: "vertical" }} />
          </label>
        </div>
      </div>
    </Modal>
  );
}

function SeatAssignmentModal({
  ctx,
  agents,
  initialAgent,
  onClose,
}: {
  ctx: MCtx;
  agents: MSupportAgent[];
  initialAgent: MSupportAgent | null;
  onClose: () => void;
}) {
  const [agentAdminId, setAgentAdminId] = useState(initialAgent ? String(initialAgent.adminId) : "");
  const [assignmentType, setAssignmentType] = useState("PRIMARY");
  const [keyword, setKeyword] = useState("");
  const [users, setUsers] = useState<User360Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User360Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const agent = agents.find((row) => String(row.adminId) === agentAdminId) ?? agents[0] ?? null;
  const agentCanAssign = Boolean(agent?.enabled && agent.serviceTypes.includes("advisor"));
  const activeAssignments = useMemo(
    () => parseParamArray<MAdvisorAssignment>(ctx.pget(ASSIGNMENT_LIST_KEY), [])
      .filter((row) => row.agentAdminId === agent?.adminId && row.status === "ACTIVE"),
    [agent?.adminId, ctx.params, ctx],
  );
  const boundUserIds = useMemo(
    () => new Set(activeAssignments.map((row) => row.userId).filter((userId) => Number.isFinite(Number(userId)))),
    [activeAssignments],
  );
  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map(userIdOf).filter((userId) => userId > 0)),
    [selectedUsers],
  );
  const bindableSelectedUsers = selectedUsers.filter((user) => {
    const userId = userIdOf(user);
    return userId > 0 && !boundUserIds.has(userId);
  });
  const reasonOk = reason.trim().length >= 6;
  const canSave = Boolean(agent && agent.adminId > 0 && agentCanAssign && bindableSelectedUsers.length > 0 && reasonOk);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchUserProfilesPage({ keyword: keyword.trim(), pageNum: 1, pageSize: 8 })
        .then((page) => {
          if (!alive) return;
          setUsers(page.records);
        })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setError(err instanceof Error ? err.message : "USERS_LOAD_FAILED");
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [keyword]);

  const toggleUser = (user: User360Profile) => {
    const userId = userIdOf(user);
    if (!userId || boundUserIds.has(userId)) return;
    setSelectedUsers((prev) => {
      const exists = prev.some((row) => userIdOf(row) === userId);
      return exists ? prev.filter((row) => userIdOf(row) !== userId) : [...prev, user];
    });
  };

  const save = () => {
    if (!canSave || !agent) return;
    const userIds = Array.from(new Set(bindableSelectedUsers.map(userIdOf).filter((userId) => userId > 0)));
    if (userIds.length === 0) return;
    ctx.setParam("I.support.advisorAssignment.__create", JSON.stringify({
      adminId: agent.adminId,
      userIds,
      assignmentType,
    }), {
      action: "M1 绑定专属客服服务用户",
      reason: reason.trim(),
    });
    ctx.toast(`${agent.name} 已提交绑定 ${userIds.length} 个用户`);
    onClose();
  };

  return (
    <Modal
      title="绑定专属客服服务用户"
      icon="users"
      wide
      onClose={onClose}
      footer={<><span className="sub">{agents.length === 0 ? "暂无可绑定用户的专属客服,请先在 A1 分配专属客服角色" : agentCanAssign ? `用户来自 C1 用户画像接口 · 已选 ${bindableSelectedUsers.length} 人` : "当前坐席未开启专属顾问服务类型,请先到 M5 配置岗位"}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button><button type="button" data-proof="m1-seat-assignment-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={save}>绑定{canSave ? ` ${bindableSelectedUsers.length} 人` : agents.length === 0 ? " · 无专属客服" : agentCanAssign ? " · 待补全" : " · 需开启服务类型"}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>选择坐席</span>
            {agents.length === 0 ? (
              <div className="itint" style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 13 }}>暂无专属客服坐席</div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>坐席名单来自 A1 管理员专属客服角色。先给管理员分配专属客服并启用后,这里会出现可选坐席。</div>
              </div>
            ) : (
              <select className="fld" value={agentAdminId || String(agent?.adminId ?? "")} onChange={(e) => { setAgentAdminId(e.target.value); setSelectedUsers([]); }}>
                {agents.map((row) => (
                  <option key={row.adminId} value={String(row.adminId)}>
                    {row.name} · {row.position} · 已服务 {row.assignedUserCount} 人{row.serviceTypes.includes("advisor") ? "" : " · 需开启专属顾问"}
                  </option>
                ))}
              </select>
            )}
          </label>
          {agents.length > 0 && !agentCanAssign && (
            <div className="itint" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 13 }}>该坐席当前不能接收专属服务用户分配</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>到 M5「客服岗位与专属顾问」把该坐席服务类型勾选为专属顾问后,这里即可提交绑定。</div>
            </div>
          )}
          <select className="fld" value={assignmentType} onChange={(e) => setAssignmentType(e.target.value)}>
            <option value="PRIMARY">主顾问</option>
            <option value="BACKUP">备用顾问</option>
          </select>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>搜索用户</span>
            <div className="inp">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="用户名 / 用户编码 / 手机号" />
            </div>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="sub" style={{ fontWeight: 600 }}>已选用户</div>
            {bindableSelectedUsers.length === 0 ? (
              <div className="itint" style={{ padding: "10px 12px" }}>从右侧搜索结果中多选要绑定给专属客服的用户。</div>
            ) : (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bindableSelectedUsers.map((user) => (
                  <button
                    key={`selected-${userNoOf(user)}-${userIdOf(user)}`}
                    type="button"
                    className="chip"
                    onClick={() => toggleUser(user)}
                    title="移除已选用户"
                    style={{ height: 24, fontSize: 11.5 }}
                  >
                    {userNoOf(user)} · {user.nickname || "未命名用户"}
                    <Icon name="x" size={12} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>分配理由 <b style={{ color: "var(--danger)" }}>*</b></span>
            <textarea className="fld" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客服主管按用户等级与问题类型绑定专属客服跟进。" style={{ resize: "vertical" }} />
          </label>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
          <div className="sub" style={{ fontWeight: 600 }}>可选用户</div>
          {loading && <div className="itint">正在查询用户...</div>}
          {!loading && error && <div className="itint">用户加载失败 · {error}</div>}
          {!loading && !error && users.length === 0 && (
            <div className="itint">
              <div style={{ fontSize: 13 }}>暂无匹配用户</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>换一个昵称、用户编码或手机号关键词。</div>
            </div>
          )}
          {!loading && !error && users.map((user) => {
            const id = userIdOf(user);
            const checked = selectedUserIds.has(id);
            const alreadyBound = boundUserIds.has(id);
            return (
              <button
                key={`${userNoOf(user)}-${id}`}
                type="button"
                data-proof="m1-seat-user-option"
                disabled={alreadyBound}
                onClick={() => toggleUser(user)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${checked ? "var(--m-hd-border)" : "var(--border)"}`, background: checked ? "var(--m-hd-soft)" : alreadyBound ? "var(--bg-2)" : "transparent", cursor: alreadyBound ? "not-allowed" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: alreadyBound ? 0.62 : 1 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{user.nickname || "未命名用户"}</span>
                  <span className="mono dim2" style={{ fontSize: 11.5 }}>{userNoOf(user)} · {user.phoneMasked || "未留手机号"} · KYC {user.kycStatus || "PENDING"}</span>
                </span>
                {alreadyBound && <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>已绑定</span>}
                {checked && <Icon name="check" size={15} />}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
