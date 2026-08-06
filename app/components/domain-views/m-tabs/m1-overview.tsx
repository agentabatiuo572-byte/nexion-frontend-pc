"use client";

/**
 * M1 客服中心总览 — 指标只读、坐席与负载授权维护(helpdesk 设计稿布局),零新 mock。
 * 数字单源派生自 pget(I.support.* / I.session.*),与 M2/M3/M4 写的真写键同源。
 * 4 KPI(可点进台)+ 分类 SLA 达成与超时风险 + 坐席负载;调整负载 = 高敏配置(必填理由 → setParam + logAudit)。
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { displayAdminError } from "@/lib/admin/error-messages";
import {
  type LoadConfig,
  type SessionConvo,
  type SupportSla,
  type SupportTicket,
} from "./data";
import { Icon, type IconName, Modal, Toggle } from "../design-kit";
import { catCN, MAvatar } from "./hd-ui";
import type { MCtx } from "./types";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { User360Profile } from "@/lib/admin/user360-client";
import { fetchMSupportWorkbenchUsers, type MAdvisorAssignment, type MSupportAgent } from "@/lib/admin/m-client";

const TICKET_KEY = "I.support.tickets";
const SLA_KEY = "I.support.sla";
const CONVO_KEY = "I.session.convos";
const AGENT_LIST_KEY = "I.support.agents";
const ASSIGNMENT_LIST_KEY = "I.support.advisorAssignments";
const LOAD_WARNINGS_KEY = "I.support.loadWarnings";
const LOAD_KEY = (f: string) => `I.support.load.${f}`;
const AGENT_CAP_KEY = (name: string) => `I.support.agent.${name}.cap`;
const AGENT_BUSY_KEY = (name: string) => `I.support.agent.${name}.busy`;

const SUPPORT_SEAT_TYPES = [
  { position: "客服主管", label: "客服主管", hint: "由超管分配;可分配专属/通用客服坐席" },
  { position: "专属客服", label: "专属客服", hint: "由超管/客服主管绑定服务用户" },
  { position: "通用客服", label: "通用客服", hint: "接普通工单与即时会话" },
];
const BOUND_ASSIGNMENT_PAGE_SIZE = 8;
const ACTIVE_TICKET_STATUSES = new Set<SupportTicket["status"]>(["open", "in_progress", "pending_user"]);

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
  const version = numParam(pget(LOAD_KEY("version")));
  const autoBalance = boolParam(pget(LOAD_KEY("autoBalance")));
  const defaultCap = numParam(pget(LOAD_KEY("defaultCap")));
  const burstCap = numParam(pget(LOAD_KEY("burstCap")));
  const warnPct = numParam(pget(LOAD_KEY("warnPct")));
  const quietHourBalance = boolParam(pget(LOAD_KEY("quietHourBalance")));
  const overflowQueue = pget(LOAD_KEY("overflowQueue"));
  if (
    version == null ||
    version < 1 ||
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
  return { version, autoBalance, defaultCap, burstCap, warnPct, quietHourBalance, overflowQueue };
}

function isActiveTicket(ticket: SupportTicket): boolean {
  return ticket.status === "open" || ticket.status === "in_progress" || ticket.status === "pending_user";
}

function slaRisk(tickets: SupportTicket[], rule: SupportSla, now = Date.now()): { lvl: string; pct: number; n: number } {
  const active = tickets.filter((ticket) => ticket.category === rule.category && isActiveTicket(ticket));
  if (active.length === 0) return { lvl: "无在途", pct: 0, n: 0 };
  const maxRatio = active.reduce((highest, ticket) => {
    const createdAt = Number(ticket.createdAt) || now;
    const firstAgentReplyAt = ticket.messages.find((message) => message.author === "agent")?.ts;
    const firstResponseElapsed = Math.max(0, (firstAgentReplyAt || now) - createdAt);
    const resolutionElapsed = Math.max(0, now - createdAt);
    const firstResponseRatio = firstResponseElapsed / Math.max(1, rule.firstResponseMins * 60_000);
    const resolutionRatio = resolutionElapsed / Math.max(1, rule.resolutionHours * 3_600_000);
    return Math.max(highest, firstResponseRatio, resolutionRatio);
  }, 0);
  const pct = Math.round(maxRatio * 100);
  return { lvl: pct >= 100 ? "已超时" : pct >= 80 ? "临近" : "达成", pct, n: active.length };
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
  return agent.seatType === "DEDICATED" || agent.position.includes("专属");
}

function isSupportSupervisor(agent: MSupportAgent | null | undefined): boolean {
  return Boolean(agent?.seatType === "MANAGER" || agent?.position.includes("主管"));
}

function seatLabel(position: string): string {
  return SUPPORT_SEAT_TYPES.find((item) => item.position === position)?.label ?? position;
}

export function M1Overview({ ctx }: { ctx: MCtx }) {
  const { pget } = ctx;
  const [showLoad, setShowLoad] = useState(false);
  const [showSeatRoles, setShowSeatRoles] = useState(false);
  const [showUserAssign, setShowUserAssign] = useState(false);
  const [assignAgent, setAssignAgent] = useState<MSupportAgent | null>(null);
  const operatorName = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const currentRole = useAdminAuth((s) => s.session?.role ?? s.role);
  const currentAdminId = useAdminAuth((s) => s.session?.adminId ?? 0);
  const authorities = useAdminAuth((s) => s.session?.authorities);
  const currentRoleKey = String(currentRole);

  const tickets = useMemo(() => parseParamArray<SupportTicket>(pget(TICKET_KEY), []), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);
  const convos = useMemo(() => parseParamArray<SessionConvo>(pget(CONVO_KEY), []), [ctx.params, pget]);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const supportAgentsAvailable = pget("I.support.agentsAvailable") === "1";
  const supportAgentsError = pget("I.support.agentsError") ?? "unavailable";
  const advisorAssignments = useMemo(() => parseParamArray<MAdvisorAssignment>(pget(ASSIGNMENT_LIST_KEY), []), [ctx.params, pget]);
  const loadWarnings = useMemo(() => parseParamArray<string>(pget(LOAD_WARNINGS_KEY), []), [ctx.params, pget]);
  const currentSupportAgent = useMemo(
    () => supportAgents.find((agent) => agent.adminId === currentAdminId) ?? null,
    [currentAdminId, supportAgents],
  );
  const isSuperAdmin = currentRoleKey === "superadmin" || currentRoleKey === "super";
  const canWriteM1 = isSuperAdmin || Boolean(authorities?.includes("service_m1_write"));
  const canManageSupportSeats = canWriteM1 && (isSuperAdmin || isSupportSupervisor(currentSupportAgent));
  const seatAssignmentAgents = useMemo(
    () => supportAgents.filter((agent) => agent.adminId > 0 && agent.enabled),
    [supportAgents],
  );
  const assignableAgents = useMemo(
    () => seatAssignmentAgents.filter((agent) => isDedicatedSupportAgent(agent)),
    [seatAssignmentAgents],
  );
  const activeAdvisorAssignmentCount = advisorAssignments.filter((row) => row.status === "ACTIVE").length;

  const openTickets = tickets.filter((t) => ACTIVE_TICKET_STATUSES.has(t.status)).length;
  const pendingUser = tickets.filter((t) => t.status === "pending_user").length;
  const liveSessions = convos.filter((c) => c.status === "open" && !c.archived).length;
  const pendingReplies = convos.filter((c) => c.status === "open" && !c.archived && c.unread > 0).length;

  const loadCfg = useMemo(() => loadConfigFromBackendParams(pget), [ctx.params, pget]);

  const knownAgentNames = new Set(supportAgents.map((agent) => agent.name));
  const unassignedLoadCount = tickets.filter((ticket) => isActiveTicket(ticket) && !knownAgentNames.has(ticket.owner)).length
    + convos.filter((convo) => convo.status === "open" && !knownAgentNames.has(convo.owner)).length;
  const loadRows = supportAgents.map((a) => {
    const openTk = tickets.filter((t) => t.owner === a.name && isActiveTicket(t)).length;
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
    { label: "活跃工单", val: openTickets, sub: "待处理 + 处理中 + 待补充", icon: "doc", tone: true, to: "/service/tickets?scope=active" },
    { label: "待用户补充", val: pendingUser, sub: "等待用户回传", icon: "clock", tone: false, to: "/service/tickets?scope=active&status=pending_user" },
    { label: "进行中会话", val: liveSessions, sub: "实时接待中", icon: "users", tone: true, to: "/service/sessions?seg=active" },
    { label: "待坐席回复", val: pendingReplies, sub: "用户已发待回", icon: "bell", tone: false, to: "/service/sessions?seg=unread" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="m-toolbar">
        <span className="dim" style={{ fontSize: 13 }}>工单和会话的实时概况 · 已分配服务用户 {activeAdvisorAssignmentCount}</span>
        <span className="sp" />
        {canWriteM1 && (
          <button
            type="button"
            className="btn btn-sec btn-sm"
            disabled={!supportAgentsAvailable || !canManageSupportSeats}
            title={!supportAgentsAvailable
              ? "坐席数据暂不可用,请刷新后重试"
              : canManageSupportSeats
                ? "从客服管理员里分配客服主管 / 专属客服 / 通用客服坐席"
                : "只有总管理员或客服主管可以分配坐席"}
            onClick={() => setShowSeatRoles(true)}
          >
            <Icon name="users" size={16} />
            分配坐席
          </button>
        )}
        <Link href="/service/tickets" className="btn btn-sec btn-sm">
          <Icon name="doc" size={16} />
          进工单台
        </Link>
        <Link href="/service/sessions" className="btn btn-pri btn-sm">
          <Icon name="users" size={16} />
          进会话台
        </Link>
      </div>

      {loadWarnings.length > 0 && (
        <div className="itint" role="status">
          <div style={{ fontSize: 13 }}>部分信息暂未同步:{loadWarnings.join("、")}</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>其余可用信息仍会正常显示;请稍后刷新重试。</div>
        </div>
      )}

      {!supportAgentsAvailable && (
        <div className="itint" role="alert">
          <div style={{ fontSize: 13 }}>
            {supportAgentsError === "permission" ? "当前账号没有读取 M1 坐席名册的权限。" : "坐席数据暂不可用,当前不会开放坐席与负载调整。"}
          </div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>
            {supportAgentsError === "permission" ? "请联系管理员核对 service_m1_read 权限。" : "这不是坐席管理权限不足;系统已停止使用空名册推断权限,请刷新后重试。"}
          </div>
        </div>
      )}

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
              const r = slaRisk(tickets, row);
              const tone = r.lvl === "已超时" ? "var(--m-urgent)" : r.lvl === "临近" ? "var(--m-high)" : "var(--m-ok)";
              return (
                <div key={row.category} className="m1-sla-row">
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
                      {catCN(row.category)}
                    </span>
                    <span className="dim2" style={{ fontSize: 11.5 }}>在途 {r.n}</span>
                  </div>
                  <SlaBar pct={r.pct} tone={tone} />
                  <div style={{ textAlign: "right" }}>
                    <span style={{ fontSize: 12, color: tone, fontWeight: 500 }}>{r.lvl}</span>
                    <div className="dim2" style={{ fontSize: 11 }}>首响 {row.firstResponseMins} 分钟 / 解决 {row.resolutionHours} 小时</div>
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
                  负载策略暂不可用 · 请刷新重试
                </span>
              )}
              <span className="sp" />
              <button
                type="button"
                className="btn btn-sec btn-sm"
                onClick={() => (loadCfg && supportAgentsAvailable && canManageSupportSeats ? setShowLoad(true) : ctx.toast(!supportAgentsAvailable ? "坐席数据暂不可用,请刷新页面后重试" : loadCfg ? "当前账号无权调整坐席负载" : "负载策略暂不可用,请刷新页面后重试"))}
                disabled={!loadCfg || !supportAgentsAvailable || !canManageSupportSeats}
                title={!supportAgentsAvailable ? "坐席数据暂不可用,请刷新页面后重试" : !loadCfg ? "负载策略暂不可用,请刷新页面后重试" : canManageSupportSeats ? "调整坐席容量与自动平衡策略" : "只有总管理员或客服主管可以调整"}
              >
                <Icon name="gauge" size={16} />
                调整负载
              </button>
            </div>
          </div>
          <div style={{ padding: "0 18px 16px" }}>
            {unassignedLoadCount > 0 && (
              <div className="itint" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>待归属或名册外工作 {unassignedLoadCount} 项</div>
                <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>这些在途工单或会话不会计入具体坐席利用率;请到工单台或会话台分配负责人。</div>
              </div>
            )}
            {!supportAgentsAvailable ? (
              <div className="itint" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>坐席负载数据暂不可用</div>
                <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>已按失败关闭处理,不会把读取失败显示成“暂无客服坐席”。</div>
              </div>
            ) : loadRows.length === 0 ? (
              <div className="itint" style={{ marginTop: 10 }}>
                <div style={{ fontSize: 13 }}>暂无客服坐席</div>
                <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>坐席名单来自 A1 全局角色为「客服」的管理员,请先给管理员分配客服角色。</div>
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
                    {canManageSupportSeats && (
                      <button
                        type="button"
                        className="btn btn-sec btn-sm"
                        disabled={!l.agent.enabled || l.agent.adminId <= 0 || !isDedicatedSupportAgent(l.agent)}
                        title={isDedicatedSupportAgent(l.agent) ? "给此专属客服绑定服务用户" : "只有专属客服可以绑定服务用户"}
                        onClick={() => {
                          setAssignAgent(l.agent);
                          setShowUserAssign(true);
                        }}
                        style={{ marginTop: 2 }}
                      >
                        绑定用户
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <p className="dim2" style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
        <b style={{ color: "var(--ink-3)", fontWeight: 500 }}>使用说明</b>:概况数字和 SLA 进度仅用于查看;进入工单台或会话台处理用户问题。只有总管理员或客服主管能调整坐席与负载策略,所有调整都会记录操作人和理由。
      </p>

      {showLoad && loadCfg && <LoadConfigModal ctx={ctx} loadCfg={loadCfg} rows={loadRows} onClose={() => setShowLoad(false)} />}
      {showSeatRoles && (
        <SupportSeatRoleModal
          ctx={ctx}
          operatorName={operatorName}
          currentRole={currentRoleKey}
          currentAdminId={currentAdminId}
          agents={seatAssignmentAgents}
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
  const [noChangeMessage, setNoChangeMessage] = useState("");
  const [writeOutcomeUnknown, setWriteOutcomeUnknown] = useState(false);
  const [saving, setSaving] = useState<"config" | "rebalance" | null>(null);
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;

  useEffect(() => {
    setNoChangeMessage("");
    setWriteOutcomeUnknown(false);
  }, [autoBalance, defaultCap, burstCap, warnPct, quietHour, overflow, caps, busyMap]);

  const clamp = (v: string, lo: number, hi: number) => String(Math.max(lo, Math.min(hi, Math.round(Number(v) || 0))));

  async function save() {
    if (!reasonOk || saving) return;
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
      setNoChangeMessage("当前配置没有变化,无需保存。");
      ctx.toast("当前配置没有变化,无需保存");
      return;
    }
    setSaving("config");
    setWriteOutcomeUnknown(false);
    try {
      const ok = await ctx.setParam("I.support.load.__bulk", JSON.stringify({
        expectedVersion: loadCfg.version,
        autoBalance,
        defaultCap: Number(clamp(defaultCap, 0, 40)),
        burstCap: Number(clamp(burstCap, 0, 40)),
        warnPct: Number(clamp(warnPct, 50, 100)),
        quietHourBalance: quietHour,
        overflowQueue: overflow.trim(),
        agentState,
      }), { action: "M1 坐席负载调度", reason: r });
      if (!ok) {
        setWriteOutcomeUnknown(true);
        return;
      }
      ctx.toast("负载调度已提交 · 后端留档");
      onClose();
    } finally {
      setSaving(null);
    }
  }

  async function rebalance() {
    if (saving) return;
    if (!reasonOk) {
      ctx.toast("手动均衡需先填变更理由(8-200 字)");
      return;
    }
    setSaving("rebalance");
    setWriteOutcomeUnknown(false);
    try {
      const ok = await ctx.setParam("I.support.load.__rebalance", JSON.stringify(rows.map((r) => ({
        id: r.id,
        name: r.name,
        cap: r.cap,
        busy: r.busy,
        total: r.total,
        util: r.util,
      }))), { action: "M1 坐席负载手动均衡", reason: reason.trim() });
      if (!ok) {
        setWriteOutcomeUnknown(true);
        return;
      }
      ctx.toast("已触发一次手动均衡 · 后端留档");
      onClose();
    } finally {
      setSaving(null);
    }
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
          <button type="button" className="btn btn-sec btn-sm" onClick={onClose} disabled={Boolean(saving)}>取消</button>
          <button type="button" className="btn btn-sec btn-sm" onClick={rebalance} disabled={Boolean(saving)}>{saving === "rebalance" ? "提交中..." : "立即手动均衡"}</button>
          <button type="button" className="btn btn-pri btn-sm" onClick={save} disabled={!reasonOk || Boolean(saving)}>{saving === "config" ? "提交中..." : writeOutcomeUnknown ? "使用同一命令重试" : `保存${!reasonOk ? " · 需填理由" : ""}`}</button>
        </div>
      }
    >
      {noChangeMessage && (
        <div className="itint" role="status" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>{noChangeMessage}</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>请修改至少一项配置后再保存,或点击取消返回。</div>
        </div>
      )}
      {writeOutcomeUnknown && (
        <div className="itint" role="alert" style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13 }}>写入失败或结果未知,输入已保留。</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>请使用同一命令重试;若仍失败,可取消后刷新核对服务器状态。</div>
        </div>
      )}
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
        <span style={{ fontSize: 13 }}>变更理由 <span style={{ color: "var(--danger)" }}>*</span> <span className="sub">(必填 8-200 字 · 留档至 A2 审计)</span></span>
        <textarea className="fld" rows={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:周一早高峰预期 Withdrawal 峰值,临时提升 Marina K. 上限并暂停 Aisha 接派单培训" style={{ resize: "vertical" }} />
      </label>
    </Modal>
  );
}

function SupportSeatRoleModal({
  ctx,
  operatorName,
  currentRole,
  currentAdminId,
  agents,
  onClose,
}: {
  ctx: MCtx;
  operatorName: string;
  currentRole: string;
  currentAdminId: number;
  agents: MSupportAgent[];
  onClose: () => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [targetPosition, setTargetPosition] = useState("通用客服");
  const [userKeyword, setUserKeyword] = useState("");
  const [users, setUsers] = useState<User360Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User360Profile[]>([]);
  const [reason, setReason] = useState("");
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userError, setUserError] = useState("");
  const canAssignSupervisor = currentRole === "superadmin" || currentRole === "super";
  const currentAgent = agents.find((agent) => agent.adminId === currentAdminId) ?? null;
  const canAssignSupportStaff = canAssignSupervisor || isSupportSupervisor(currentAgent);
  const seatOptions = canAssignSupportStaff ? SUPPORT_SEAT_TYPES.filter((seat) => canAssignSupervisor || seat.position !== "客服主管") : [];
  const operatorReady = operatorName.trim().length > 0;
  const normalizedKeyword = keyword.trim().toLowerCase();
  const candidates = useMemo(
    () => agents
      .filter((agent) => agent.status === "enabled" && agent.adminId > 0)
      .filter((agent) => canAssignSupervisor || agent.adminId !== currentAdminId)
      .filter((agent) => {
        if (!normalizedKeyword) return true;
        return [agent.name, agent.email, String(agent.adminId), agent.position]
          .join(" ")
          .toLowerCase()
          .includes(normalizedKeyword);
      }),
    [agents, canAssignSupervisor, currentAdminId, normalizedKeyword],
  );
  const selected = candidates.find((agent) => String(agent.adminId) === selectedId) ?? candidates[0] ?? null;
  const allActiveAssignments = useMemo(
    () => parseParamArray<MAdvisorAssignment>(ctx.pget(ASSIGNMENT_LIST_KEY), [])
      .filter((row) => row.status === "ACTIVE"),
    [ctx.params, ctx],
  );
  const activeAssignmentByUserId = useMemo(() => {
    const map = new Map<number, MAdvisorAssignment>();
    allActiveAssignments.forEach((row) => {
      if (Number.isFinite(Number(row.userId)) && !map.has(row.userId)) {
        map.set(row.userId, row);
      }
    });
    return map;
  }, [allActiveAssignments]);
  const boundUserIds = useMemo(
    () => new Set(activeAssignmentByUserId.keys()),
    [activeAssignmentByUserId],
  );
  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map(userIdOf).filter((userId) => userId > 0)),
    [selectedUsers],
  );
  const bindableSelectedUsers = selectedUsers.filter((user) => {
    const userId = userIdOf(user);
    return userId > 0 && !boundUserIds.has(userId);
  });
  const assigningDedicated = targetPosition === "专属客服";
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canSave = Boolean(canAssignSupportStaff && operatorReady && selected && reasonOk && !saving && (!assigningDedicated || bindableSelectedUsers.length > 0));

  useEffect(() => {
    setSelectedId((current) => current || (candidates[0] ? String(candidates[0].adminId) : ""));
  }, [candidates]);

  useEffect(() => {
    if (!canAssignSupervisor && targetPosition === "客服主管") {
      setTargetPosition("通用客服");
    }
  }, [canAssignSupervisor, targetPosition]);

  useEffect(() => {
    if (selected && !candidates.some((agent) => agent.adminId === selected.adminId)) {
      setSelectedId(candidates[0] ? String(candidates[0].adminId) : "");
    }
  }, [candidates, selected]);

  useEffect(() => {
    if (!assigningDedicated) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoadingUsers(true);
      setUserError("");
      fetchMSupportWorkbenchUsers({ keyword: userKeyword.trim(), pageNum: 1, pageSize: 8 })
        .then((page) => {
          if (!alive) return;
          setUsers(page.records);
        })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setUserError(displayAdminError(err));
        })
        .finally(() => {
          if (alive) setLoadingUsers(false);
        });
    }, 250);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [assigningDedicated, userKeyword]);

  useEffect(() => {
    setSelectedUsers([]);
  }, [targetPosition, selected?.adminId]);

  const toggleUser = (user: User360Profile) => {
    const userId = userIdOf(user);
    if (!userId || boundUserIds.has(userId)) return;
    setSelectedUsers((prev) => {
      const exists = prev.some((row) => userIdOf(row) === userId);
      return exists ? prev.filter((row) => userIdOf(row) !== userId) : [...prev, user];
    });
  };

  const save = async () => {
    if (!canSave || !selected) return;
    setSaving(true);
    try {
      const userIds = assigningDedicated
        ? Array.from(new Set(bindableSelectedUsers.map(userIdOf).filter((userId) => userId > 0)))
        : [];
      const ok = await ctx.setParam("I.support.seatAssignment.__update", JSON.stringify({
        adminId: selected.adminId,
        position: targetPosition,
        serviceTypes: selected.serviceTypes,
        tags: selected.tags,
        maxConcurrent: selected.maxConcurrent,
        enabled: selected.enabled,
        transferable: selected.transferable,
        busy: selected.busy,
        userIds,
      }), {
        action: "M1 分配客服坐席",
        reason: reason.trim(),
      });
      if (!ok) return;
      ctx.toast(`${selected.name} 已提交分配为 ${seatLabel(targetPosition)}${userIds.length ? `,绑定 ${userIds.length} 个用户` : ""}`);
      onClose();
    } catch (err) {
      ctx.toast(`分配失败:${displayAdminError(err)}`);
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
      footer={<><span className="sub">{!canAssignSupportStaff ? "只有超管或客服主管可以分配客服坐席" : !operatorReady ? "正在读取当前管理员身份" : assigningDedicated ? `专属客服必须同时绑定用户 · 已选 ${bindableSelectedUsers.length} 人` : canAssignSupervisor ? "超管可分配客服主管 / 专属客服 / 通用客服" : "客服主管只能分配专属客服 / 通用客服"}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose}>取消</button><button type="button" data-proof="m1-seat-role-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={save}>{saving ? "提交中..." : canSave ? "确认分配" : !canAssignSupportStaff || !operatorReady ? "无权限" : assigningDedicated && bindableSelectedUsers.length === 0 ? "需绑定用户" : "需选择并填写理由"}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>搜索客服管理员</span>
            <div className="inp">
              <Icon name="search" size={15} />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="管理员姓名 / 邮箱 / 当前坐席" />
            </div>
          </label>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 300, overflow: "auto", paddingRight: 2 }}>
            {candidates.length === 0 && (
              <div className="itint">
                <div style={{ fontSize: 13 }}>暂无可分配管理员</div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>搜索源是 A1 里全局角色为「客服」的管理员;请先在 A1 创建客服管理员。</div>
              </div>
            )}
            {candidates.map((agent) => {
              const selectedRow = selected?.adminId === agent.adminId;
              return (
                <button
                  key={agent.adminId}
                  type="button"
                  data-proof="m1-seat-admin-option"
                  onClick={() => setSelectedId(String(agent.adminId))}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${selectedRow ? "var(--m-hd-border)" : "var(--border)"}`, background: selectedRow ? "var(--m-hd-soft)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{agent.name || agent.email || `管理员 ${agent.adminId}`}</span>
                    <span className="mono dim2" style={{ fontSize: 11.5 }}>{agent.email || "未配置邮箱"} · {agent.position || "通用客服"}</span>
                  </span>
                  <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>客服</span>
                  {selectedRow && <Icon name="check" size={15} />}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>目标客服坐席</span>
            <div style={{ display: "grid", gap: 8 }}>
              {seatOptions.map((option) => (
                <button
                  key={option.position}
                  type="button"
                  className="btn btn-sec btn-sm"
                  onClick={() => setTargetPosition(option.position)}
                  style={{ justifyContent: "flex-start", height: "auto", padding: "9px 10px", borderColor: targetPosition === option.position ? "var(--m-hd-border)" : undefined, background: targetPosition === option.position ? "var(--m-hd-soft)" : undefined }}
                >
                  <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <span style={{ color: "var(--ink)" }}>{option.label}</span>
                    <span className="dim2" style={{ fontSize: 11.5 }}>{option.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          </label>
          {selected && (
            <div className="itint" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 13 }}>当前选择: {selected.name || selected.email}</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>当前坐席 {seatLabel(selected.position)} → 目标坐席 {seatLabel(targetPosition)}</div>
            </div>
          )}
          {assigningDedicated && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>绑定服务用户 <b style={{ color: "var(--danger)" }}>*</b></span>
                <div className="inp">
                  <Icon name="search" size={15} />
                  <input value={userKeyword} onChange={(e) => setUserKeyword(e.target.value)} placeholder="用户名 / 用户编码 / 手机号" />
                </div>
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {bindableSelectedUsers.length === 0 ? (
                  <div className="itint" style={{ padding: "10px 12px", width: "100%" }}>专属客服必须同时绑定至少 1 个真实用户。</div>
                ) : bindableSelectedUsers.map((user) => (
                  <button
                    key={`seat-selected-${userNoOf(user)}-${userIdOf(user)}`}
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
              {loadingUsers && <div className="itint">正在查询用户...</div>}
              {!loadingUsers && userError && <div className="itint">用户加载失败 · {userError}</div>}
              {!loadingUsers && !userError && users.map((user) => {
                const id = userIdOf(user);
                const checked = selectedUserIds.has(id);
                const boundAssignment = activeAssignmentByUserId.get(id);
                const alreadyBound = Boolean(boundAssignment);
                const boundToSelected = boundAssignment?.agentAdminId === selected?.adminId;
                return (
                  <button
                    key={`seat-user-${userNoOf(user)}-${id}`}
                    type="button"
                    data-proof="m1-seat-bound-user-option"
                    disabled={alreadyBound}
                    onClick={() => toggleUser(user)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${checked ? "var(--m-hd-border)" : "var(--border)"}`, background: checked ? "var(--m-hd-soft)" : alreadyBound ? "var(--bg-2)" : "transparent", cursor: alreadyBound ? "not-allowed" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: alreadyBound ? 0.62 : 1 }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{user.nickname || "未命名用户"}</span>
                      <span className="mono dim2" style={{ fontSize: 11.5 }}>{userNoOf(user)} · {user.phoneMasked || "未留手机号"} · KYC {user.kycStatus || "PENDING"}</span>
                    </span>
                    {alreadyBound && <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{boundToSelected ? "已绑定" : "已绑定其他坐席"}</span>}
                    {checked && <Icon name="check" size={15} />}
                  </button>
                );
              })}
            </div>
          )}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>分配理由 <b style={{ color: "var(--danger)" }}>*</b></span>
            <textarea className="fld" rows={4} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客服主管排班调整,将该管理员分配为通用客服承接实时会话。" style={{ resize: "vertical" }} />
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
  const [keyword, setKeyword] = useState("");
  const [boundKeyword, setBoundKeyword] = useState("");
  const [boundPage, setBoundPage] = useState(1);
  const [users, setUsers] = useState<User360Profile[]>([]);
  const [selectedUsers, setSelectedUsers] = useState<User360Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [unbindingId, setUnbindingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const agent = agents.find((row) => String(row.adminId) === agentAdminId) ?? agents[0] ?? null;
  const agentCanAssign = Boolean(agent?.enabled && agent.serviceTypes.includes("advisor"));
  const allActiveAssignments = useMemo(
    () => parseParamArray<MAdvisorAssignment>(ctx.pget(ASSIGNMENT_LIST_KEY), [])
      .filter((row) => row.status === "ACTIVE"),
    [ctx.params, ctx],
  );
  const activeAssignments = useMemo(
    () => allActiveAssignments.filter((row) => row.agentAdminId === agent?.adminId),
    [agent?.adminId, allActiveAssignments],
  );
  const normalizedBoundKeyword = boundKeyword.trim().toLowerCase();
  const filteredActiveAssignments = useMemo(
    () => activeAssignments.filter((row) => {
      if (!normalizedBoundKeyword) return true;
      return [row.nickname, row.userNo, String(row.userId)]
        .join(" ")
        .toLowerCase()
        .includes(normalizedBoundKeyword);
    }),
    [activeAssignments, normalizedBoundKeyword],
  );
  const boundPageCount = Math.max(1, Math.ceil(filteredActiveAssignments.length / BOUND_ASSIGNMENT_PAGE_SIZE));
  const visibleActiveAssignments = useMemo(
    () => filteredActiveAssignments.slice((boundPage - 1) * BOUND_ASSIGNMENT_PAGE_SIZE, boundPage * BOUND_ASSIGNMENT_PAGE_SIZE),
    [boundPage, filteredActiveAssignments],
  );
  const activeAssignmentByUserId = useMemo(() => {
    const map = new Map<number, MAdvisorAssignment>();
    allActiveAssignments.forEach((row) => {
      if (Number.isFinite(Number(row.userId)) && !map.has(row.userId)) {
        map.set(row.userId, row);
      }
    });
    return map;
  }, [allActiveAssignments]);
  const boundUserIds = useMemo(
    () => new Set(activeAssignmentByUserId.keys()),
    [activeAssignmentByUserId],
  );
  const selectedUserIds = useMemo(
    () => new Set(selectedUsers.map(userIdOf).filter((userId) => userId > 0)),
    [selectedUsers],
  );
  const bindableSelectedUsers = selectedUsers.filter((user) => {
    const userId = userIdOf(user);
    return userId > 0 && !boundUserIds.has(userId);
  });
  const reasonOk = reason.trim().length >= 8 && reason.trim().length <= 200;
  const canSave = Boolean(agent && agent.adminId > 0 && agentCanAssign && bindableSelectedUsers.length > 0 && reasonOk && !saving && unbindingId === null);

  useEffect(() => {
    let alive = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      fetchMSupportWorkbenchUsers({ keyword: keyword.trim(), pageNum: 1, pageSize: 8 })
        .then((page) => {
          if (!alive) return;
          setUsers(page.records);
        })
        .catch((err) => {
          if (!alive) return;
          setUsers([]);
          setError(displayAdminError(err));
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

  useEffect(() => {
    setBoundPage(1);
  }, [agent?.adminId, normalizedBoundKeyword]);

  useEffect(() => {
    setBoundPage((page) => Math.min(Math.max(1, page), boundPageCount));
  }, [boundPageCount]);

  const toggleUser = (user: User360Profile) => {
    const userId = userIdOf(user);
    if (!userId || boundUserIds.has(userId)) return;
    setSelectedUsers((prev) => {
      const exists = prev.some((row) => userIdOf(row) === userId);
      return exists ? prev.filter((row) => userIdOf(row) !== userId) : [...prev, user];
    });
  };

  const save = async () => {
    if (!canSave || !agent) return;
    const userIds = Array.from(new Set(bindableSelectedUsers.map(userIdOf).filter((userId) => userId > 0)));
    if (userIds.length === 0) return;
    setSaving(true);
    try {
      const ok = await ctx.setParam("I.support.advisorAssignment.__create", JSON.stringify({
        adminId: agent.adminId,
        userIds,
      }), {
        action: "M1 绑定专属客服服务用户",
        reason: reason.trim(),
      });
      if (!ok) return;
      ctx.toast(`${agent.name} 已提交绑定 ${userIds.length} 个用户`);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const unbind = async (assignment: MAdvisorAssignment) => {
    if (!agent || saving || unbindingId !== null) return;
    if (!reasonOk) {
      ctx.toast("解绑需先填写变更理由(8-200 字)");
      return;
    }
    setUnbindingId(assignment.id);
    try {
      const ok = await ctx.setParam("I.support.advisorAssignment.__delete", JSON.stringify({
        adminId: agent.adminId,
        assignmentId: assignment.id,
      }), {
        action: "M1 解绑专属客服服务用户",
        reason: reason.trim(),
      });
      if (!ok) return;
      ctx.toast(`${assignment.userNo || assignment.userId} 已提交解绑`);
    } finally {
      setUnbindingId(null);
    }
  };

  return (
    <Modal
      title="绑定/解绑专属客服服务用户"
      icon="users"
      wide
      onClose={onClose}
      footer={<><span className="sub">{agents.length === 0 ? "暂无专属客服,请先在 M1 分配专属客服坐席" : agentCanAssign ? `用户来自客服工作台查询 · 已选 ${bindableSelectedUsers.length} 人 · 已绑定 ${activeAssignments.length} 人` : `当前坐席未开启专属客服服务 · 可解绑已绑定 ${activeAssignments.length} 人`}</span><span style={{ flex: 1 }} /><button type="button" className="btn btn-sec btn-sm" onClick={onClose} disabled={saving || unbindingId !== null}>取消</button><button type="button" data-proof="m1-seat-assignment-save" className="btn btn-pri btn-sm" disabled={!canSave} onClick={save}>{saving ? "提交中..." : `绑定${canSave ? ` ${bindableSelectedUsers.length} 人` : agents.length === 0 ? " · 无专属客服" : agentCanAssign ? " · 待补全" : " · 需开启服务类型"}`}</button></>}
    >
      <div className="mcol" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>选择坐席</span>
            {agents.length === 0 ? (
              <div className="itint" style={{ padding: "10px 12px" }}>
                <div style={{ fontSize: 13 }}>暂无专属客服坐席</div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>坐席名单来自 M1 客服业务坐席配置。先把客服管理员分配为专属客服并绑定用户后,这里会出现可选坐席。</div>
              </div>
            ) : (
              <select className="fld" value={agentAdminId || String(agent?.adminId ?? "")} onChange={(e) => { setAgentAdminId(e.target.value); setSelectedUsers([]); }}>
                {agents.map((row) => (
                  <option key={row.adminId} value={String(row.adminId)}>
                    {row.name} · {row.position} · 已服务 {row.assignedUserCount} 人{row.serviceTypes.includes("advisor") ? "" : " · 需开启专属客服服务"}
                  </option>
                ))}
              </select>
            )}
          </label>
          {agents.length > 0 && !agentCanAssign && (
            <div className="itint" style={{ padding: "10px 12px" }}>
              <div style={{ fontSize: 13 }}>该坐席当前不能接收专属服务用户分配</div>
              <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 4 }}>到 M5「客服岗位与专属客服」把该坐席服务类型勾选为专属客服服务后,这里即可提交绑定;当前已绑定用户仍可在下方解绑。</div>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            <div className="sub" style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
              <span>当前已绑定用户</span>
              <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{activeAssignments.length} 人</span>
            </div>
            {activeAssignments.length === 0 ? (
              <div className="itint" style={{ padding: "10px 12px" }}>此专属客服暂无已绑定服务用户。</div>
            ) : (
              <>
                <div className="inp">
                  <Icon name="search" size={15} />
                  <input value={boundKeyword} onChange={(e) => setBoundKeyword(e.target.value)} placeholder="搜索已绑定用户 / 用户编码" />
                </div>
                {filteredActiveAssignments.length === 0 ? (
                  <div className="itint" style={{ padding: "10px 12px" }}>没有匹配的已绑定用户。</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 252, overflow: "auto", paddingRight: 2 }}>
                    {visibleActiveAssignments.map((row) => (
                      <div
                        key={`bound-${row.id}`}
                        style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-1)" }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.nickname || "未命名用户"}</span>
                          <span className="mono dim2" style={{ display: "block", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.userNo || `用户 ${row.userId}`}</span>
                        </span>
                        <button
                          type="button"
                          data-proof="m1-seat-assignment-unbind"
                          className="btn btn-sec btn-sm"
                          disabled={saving || unbindingId !== null}
                          title={reasonOk ? "解除此用户与当前专属客服的绑定" : "先填写变更理由(8-200 字)"}
                          onClick={() => unbind(row)}
                        >
                          {unbindingId === row.id ? "解绑中..." : "解绑"}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {filteredActiveAssignments.length > BOUND_ASSIGNMENT_PAGE_SIZE && (
                  <div className="row" style={{ alignItems: "center", gap: 8 }}>
                    <span className="sub" style={{ flex: 1 }}>第 {boundPage} / {boundPageCount} 页 · 匹配 {filteredActiveAssignments.length} 人</span>
                    <button type="button" className="btn btn-sec btn-sm" disabled={boundPage <= 1} onClick={() => setBoundPage((page) => Math.max(1, page - 1))}>上一页</button>
                    <button type="button" className="btn btn-sec btn-sm" disabled={boundPage >= boundPageCount} onClick={() => setBoundPage((page) => Math.min(boundPageCount, page + 1))}>下一页</button>
                  </div>
                )}
              </>
            )}
          </div>
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
            <textarea className="fld" rows={3} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例:客服主管按用户等级与问题类型绑定专属客服跟进。" style={{ resize: "vertical" }} />
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
            const boundAssignment = activeAssignmentByUserId.get(id);
            const alreadyBound = Boolean(boundAssignment);
            const boundToCurrent = boundAssignment?.agentAdminId === agent?.adminId;
            return (
              <div
                key={`${userNoOf(user)}-${id}`}
                data-proof="m1-seat-user-option"
                role={alreadyBound ? undefined : "button"}
                tabIndex={alreadyBound ? undefined : 0}
                onClick={() => {
                  if (!alreadyBound) toggleUser(user);
                }}
                onKeyDown={(event) => {
                  if (!alreadyBound && (event.key === "Enter" || event.key === " ")) {
                    event.preventDefault();
                    toggleUser(user);
                  }
                }}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 10, border: `1px solid ${checked ? "var(--m-hd-border)" : "var(--border)"}`, background: checked ? "var(--m-hd-soft)" : alreadyBound ? "var(--bg-2)" : "transparent", cursor: alreadyBound ? "default" : "pointer", textAlign: "left", fontFamily: "inherit", opacity: alreadyBound ? 0.78 : 1 }}
              >
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>{user.nickname || "未命名用户"}</span>
                  <span className="mono dim2" style={{ fontSize: 11.5 }}>{userNoOf(user)} · {user.phoneMasked || "未留手机号"} · KYC {user.kycStatus || "PENDING"}</span>
                </span>
                {alreadyBound && <span className="chip" style={{ height: 20, fontSize: 11, border: "none" }}>{boundToCurrent ? "已绑定" : "已绑定其他坐席"}</span>}
                {boundAssignment && boundToCurrent && (
                  <button
                    type="button"
                    data-proof="m1-seat-user-unbind"
                    className="btn btn-sec btn-sm"
                    title={reasonOk ? "解除此用户与当前专属客服的绑定" : "先填写变更理由(8-200 字)"}
                    onClick={(event) => {
                      event.stopPropagation();
                      unbind(boundAssignment);
                    }}
                  >
                    解绑
                  </button>
                )}
                {checked && <Icon name="check" size={15} />}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
