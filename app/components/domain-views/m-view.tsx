"use client";

/**
 * M 客服中心 — 抽 I8(工单)+ I9(即时会话)重组的独立域。5 子页:
 *   M1 客服总览 / M2 工单台 / M3 即时会话台 / M4 知识库与 SLA / M5 话术与模板配置。
 * 真写键沿用 I.support.* / I.session.*(persist 兼容,与 nav 域 code M 解耦)。
 * MC 显式 edit 契约:调参传 edit、处置不传。MessageThread 共享组件复用于 M2/M3。
 */
import { useMemo, useState } from "react";
import "./m-domain.css";
import { Icon, MessageThread, OperationConfirmModal, useToast, type ThreadMessage } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { M1Overview } from "./m-tabs/m1-overview";
import { M2Tickets } from "./m-tabs/m2-tickets";
import { M3Sessions } from "./m-tabs/m3-sessions";
import { M4KbSla } from "./m-tabs/m4-kb-sla";
import { M5Scripts } from "./m-tabs/m5-scripts";
import { SESSION_CONVOS, SUPPORT_TICKETS, type SessionConvo, type SupportTicket } from "./m-tabs/data";
import { MAvatar, ownerLabel } from "./m-tabs/hd-ui";
import type { ConfirmReq, MCtx, ActionConfirmReq } from "./m-tabs/types";

// 持续接待 dock 跨 M 子页 UI 态(随 platform-config 持久,切页不挂断)。
const DOCK_CONVO_KEY = "I.session.convos";
const DOCK_LAST_KEY = "I.session.ui.lastConvo";
const DOCK_OPEN_KEY = "I.session.ui.dockOpen"; // "1" = 展开面板,否则收为药丸
const DOCK_OFF_KEY = "I.session.ui.dockOff";   // 记录被关闭时的会话 id;坐席切到新会话即自动复现

const FOLD: Record<string, string> = {
  M1: "M1",
  M2: "M2",
  M3: "M3",
  M4: "M4",
  M5: "M5",
};

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  M1: ["只看不改 · 数字来自工单和会话", "工单 + 会话实时汇总"],
  M2: ["回复 / 关单自动留痕 · 放钱去 D2", "处理中工单实时计数"],
  M3: ["会话不断线 · 坐席回复自动留痕", "进行中会话 + 待回复实时计数"],
  M4: ["改 FAQ / SLA 要填理由留痕", "帮助内容 + 分类 SLA"],
  M5: ["改推送 / 话术要确认留痕", "顾问推送 + 话术模板"],
};

export function MDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "M1", [meta.l2Id]);
  const setParam = usePlatformConfig((s) => s.setParam);
  const logAudit = usePlatformConfig((s) => s.logAudit);
  const params = usePlatformConfig((s) => s.params);
  const hydrated = useOpsHydrated();
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);

  const ctx: MCtx = {
    pget: (k) => (hydrated ? (params?.[k] as string | undefined) : undefined),
    params: hydrated && params ? params : {},
    setParam,
    logAudit,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const [ro, liveLabel] = RO_LIVE[tab];
  // 实时计数:M1/M2/M3 的「实时计数/汇总」从真写键(I.session.convos / I.support.tickets)派生真数字,
  // 替代原静态虚标(名副其实 + 随会话/工单变动实时刷新);M4/M5 是描述标签(未声称计数)保留原文。
  // hydration 守卫:未 hydrate 用 seed 计数(SSR 与首帧一致防抖动)。
  const liveCount = useMemo(() => {
    if (tab !== "M1" && tab !== "M2" && tab !== "M3") return null;
    const convos = dockParseConvos(hydrated ? (params?.["I.session.convos"] as string | undefined) : undefined);
    const tickets = parseTicketsLive(hydrated ? (params?.["I.support.tickets"] as string | undefined) : undefined);
    const openConvos = convos.filter((c) => c.status === "open" && !c.archived).length;
    const unreadConvos = convos.filter((c) => c.unread > 0 && !c.archived).length;
    const openTickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
    if (tab === "M3") return `进行中 ${openConvos} · 待回复 ${unreadConvos}`;
    if (tab === "M2") return `处理中工单 ${openTickets}`;
    return `工单 ${openTickets} · 会话 ${openConvos}`; // M1
  }, [tab, params, hydrated]);
  const live = liveCount ?? liveLabel;
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
    </>
  );

  return (
    <div className="dkpage mdom">
      <DomainHeader {...meta} right={right} />

      {tab === "M1" && <M1Overview ctx={ctx} />}
      {tab === "M2" && <M2Tickets ctx={ctx} />}
      {tab === "M3" && <M3Sessions ctx={ctx} />}
      {tab === "M4" && <M4KbSla ctx={ctx} />}
      {tab === "M5" && <M5Scripts ctx={ctx} />}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          onClose={() => setActionConfirm(null)}
          onConfirm={(reason, newValue, businessValue) => { mc.run(reason, newValue, businessValue); setActionConfirm(null); }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      <SessionDock ctx={ctx} hidden={tab === "M3"} />
      {toastNode}
    </div>
  );
}

/* ============ MP2 持续接待 dock —— 切页不挂断(M3 自身是全屏对话台,故 M3 不显)============ */
function dockParseConvos(raw: string | undefined): SessionConvo[] {
  if (!raw) return SESSION_CONVOS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionConvo[]) : SESSION_CONVOS;
  } catch {
    return SESSION_CONVOS;
  }
}
function parseTicketsLive(raw: string | undefined): SupportTicket[] {
  if (!raw) return SUPPORT_TICKETS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SupportTicket[]) : SUPPORT_TICKETS;
  } catch {
    return SUPPORT_TICKETS;
  }
}
function dockRelWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function SessionDock({ ctx, hidden }: { ctx: MCtx; hidden: boolean }) {
  const [draft, setDraft] = useState("");
  const lastId = ctx.pget(DOCK_LAST_KEY);
  const convos = useMemo(() => dockParseConvos(ctx.pget(DOCK_CONVO_KEY)), [ctx.params]);
  const conv = convos.find((c) => c.id === lastId) ?? null;
  const open = ctx.pget(DOCK_OPEN_KEY) === "1";
  const offFor = ctx.pget(DOCK_OFF_KEY);

  // M3 在台 / 无活跃会话 / 已被关闭(且仍是同一会话)→ 不显
  if (hidden || !conv || (offFor && offFor === lastId)) return null;

  const setOpen = (v: boolean) => ctx.setParam(DOCK_OPEN_KEY, v ? "1" : "0", { action: "持续接待 dock 展开/收起", reason: "ui-state" });
  const closeDock = () => ctx.setParam(DOCK_OFF_KEY, conv.id, { action: "持续接待 dock 关闭", reason: "ui-state" });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    const next = convos.map((c) =>
      c.id === conv.id
        ? {
            ...c,
            unread: 0,
            lastTs: now,
            messages: [...c.messages, { ts: now, sender: "agent" as const, agentName: c.owner === "Unassigned" ? "Support desk" : c.owner, text }],
          }
        : c,
    );
    ctx.setParam(DOCK_CONVO_KEY, JSON.stringify(next), {
      action: `坐席回复会话 ${conv.id} · admin.conversation_replied`,
      reason: "持续接待 dock 回复(正文已留档)",
    });
    setDraft("");
    ctx.toast(`${conv.id} 已回复`);
  };

  const customer = conv.customer ?? conv.agentName;

  if (!open) {
    return (
      <button
        type="button"
        data-proof="session-dock-pill"
        onClick={() => setOpen(true)}
        className="card"
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, display: "flex", alignItems: "center", gap: 9, padding: "8px 12px 8px 9px", borderRadius: 999, boxShadow: "var(--m-sh-pop)", cursor: "pointer", color: "var(--ink)" }}
        title="持续接待 · 切页不挂断"
      >
        <MAvatar name={customer} size="sm" />
        <span style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{customer}</span>
        {conv.unread > 0 && <span className="cv-unread">{conv.unread}</span>}
        <span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon name="chevron" size={14} /></span>
      </button>
    );
  }

  const threadMessages: ThreadMessage[] = conv.messages.map((m) => {
    const isAgent = m.sender === "agent";
    const isSystem = isAgent && m.agentName === "系统";
    return {
      ts: m.ts,
      fromAgent: isAgent,
      system: isSystem,
      role: isAgent ? (conv.type === "advisor" ? "advisor" : "support") : "user",
      agentName: m.agentName,
      senderName: isAgent ? m.agentName : customer,
      body: m.text,
      ctaHref: m.ctaHref,
    } as ThreadMessage;
  });

  return (
    <div
      data-proof="session-dock-panel"
      className="card"
      style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 372, maxHeight: "min(72vh, 540px)", boxShadow: "var(--m-sh-pop)", overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--m-bg-2)" }}>
        <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "var(--m-hd)", animation: "m-hd-pulse-blue 1.8s ease-out infinite" }} />
        <span style={{ fontSize: 12, color: "var(--m-hd-2)", fontWeight: 500 }}>持续接待</span>
        <span className="dim2" style={{ fontSize: 11 }}>切页不挂断</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} title="收起"><Icon name="chevron" size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={closeDock} title="关闭"><Icon name="x" size={15} /></button>
      </div>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
        <MAvatar name={customer} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13, fontWeight: 500 }}>{customer}</b>
            <span className="chip" style={{ height: 18, fontSize: 11 }}>{conv.type === "advisor" ? "专属顾问" : "普通客服"}</span>
          </div>
          <div className="dim2" style={{ fontSize: 11, marginTop: 2 }}>接待 {ownerLabel(conv.owner)} · <span className="mono">{conv.id}</span> · {dockRelWhen(conv.lastTs)}</div>
        </div>
      </div>
      <div className="ChatBody" style={{ flex: 1, minHeight: 0 }}>
        <MessageThread messages={threadMessages} relWhen={dockRelWhen} resetKey={conv.id} />
      </div>
      <div style={{ padding: "9px 11px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          className="ta"
          data-proof="session-dock-reply"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder="边处理边回复… ⌘/Ctrl+Enter"
          style={{ maxHeight: 80 }}
        />
        <button type="button" className="btn btn-pri btn-sm" disabled={!draft.trim()} onClick={send}><Icon name="arrow" size={16} /></button>
      </div>
    </div>
  );
}
