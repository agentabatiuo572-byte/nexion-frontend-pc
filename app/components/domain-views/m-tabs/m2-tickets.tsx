"use client";

/**
 * M2 工单台 — 全宽表格列队 + 右侧滑出详情抽屉(helpdesk 设计稿布局)。
 * 业务读写走后端 content/ticket/conversation 接口;I.support.* / I.session.* 为 M 容器传入的视图适配键。
 * 例行坐席操作(回复/改状态/改优先级/转交/关闭重开)直接执行 + 自动 A2 审计;
 * 仅「升级为即时会话」这类跨载体处置走操作确认 + 理由。
 */
import { useEffect, useMemo, useState } from "react";
import { Icon, MessageThread, type ThreadMessage } from "../design-kit";
import {
  SUPPORT_AGENTS,
  type SessionConvo,
  type SessionReplyTpl,
  type SupportSla,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./data";
import { catCN, Empty, HDSelect, MAvatar, MiniMenu, ownerLabel, PRIO_CN, Prio, relWhen, TicketStatus, TK_STATUS_CN, type HDOption, type MenuItem } from "./hd-ui";
import type { MCtx } from "./types";

const TICKET_KEY = "I.support.tickets";
const CONVO_KEY = "I.session.convos";
const SLA_KEY = "I.support.sla";
const REPLY_TEMPLATE_KEY = "I.session.replyTemplates";

type Scope = "active" | "archived" | "all";
const SCOPES: Array<[Scope, string]> = [
  ["active", "活跃"],
  ["archived", "归档"],
  ["all", "全部"],
];
const ACTIVE_STATUSES: SupportTicketStatus[] = ["open", "in_progress", "pending_user"];
const STATUS_MENU: Array<[SupportTicketStatus, string]> = [
  ["in_progress", "标记处理中"],
  ["pending_user", "待用户补充"],
  ["resolved", "标记已解决"],
];
const PRIORITY_LIST: SupportTicketPriority[] = ["urgent", "high", "normal", "low"];
const PAGE_SIZE_OPTIONS = ["8", "15", "30"];
const WHO_CN: Record<"user" | "agent", string> = { user: "用户", agent: "坐席" };

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function cloneTickets(rows: SupportTicket[]): SupportTicket[] {
  return rows.map((ticket) => ({ ...ticket, messages: ticket.messages.map((m) => ({ ...m })) }));
}
function cloneConvos(rows: SessionConvo[]): SessionConvo[] {
  return rows.map((convo) => ({ ...convo, messages: convo.messages.map((m) => ({ ...m })) }));
}

export function M2Tickets({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const tickets = useMemo(() => cloneTickets(parseParamArray<SupportTicket>(pget(TICKET_KEY), [])), [ctx.params, pget]);
  const replyTemplates = useMemo(
    () =>
      parseParamArray<SessionReplyTpl>(pget(REPLY_TEMPLATE_KEY), [])
        .filter((tpl) => tpl.type === "support" && tpl.status === "published")
        .map((tpl) => tpl.text),
    [ctx.params, pget],
  );
  const slaRows = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);

  const [scope, setScope] = useState<Scope>("active");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportTicketCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  const archivedCount = tickets.filter((t) => t.status === "resolved" || t.status === "closed").length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter((t) => {
        if (scope === "all") return true;
        if (scope === "archived") return t.status === "resolved" || t.status === "closed";
        return ACTIVE_STATUSES.includes(t.status);
      })
      .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
      .filter((t) => {
        if (!q) return true;
        return [t.id, t.subject, t.owner, catCN(t.category)].some((text) => text.toLowerCase().includes(q));
      })
      .sort((a, b) => b.lastReplyAt - a.lastReplyAt);
  }, [tickets, scope, categoryFilter, query]);

  // 本地 page state 渲染设计稿 tk-pager(数字 + data-list-pager 供运行时分页门计数)。
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, pageCount);
  useEffect(() => {
    setPage(1);
  }, [scope, categoryFilter, query, pageSize]);
  const start = (curPage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  useEffect(() => {
    setReplyBody("");
  }, [selectedId]);

  // Esc 关抽屉
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const openTicket = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };

  const updateTicket = (id: string, updater: (t: SupportTicket) => SupportTicket, reason: string, action: string) => {
    const next = tickets.map((t) => (t.id === id ? updater(t) : t));
    setParam(TICKET_KEY, JSON.stringify(next), { action, reason });
  };

  // 例行:回复(正文本身即留档)
  const sendReply = (body: string) => {
    if (!selected) return;
    if (!body.trim()) {
      toast("回复需要正文");
      return;
    }
    const now = Date.now();
    updateTicket(
      selected.id,
      (t) => ({
        ...t,
        status: "pending_user",
        updatedAt: now,
        lastReplyAt: now,
        unread: 0,
        messages: [...t.messages, { ts: now, author: "agent", agentName: t.owner === "Unassigned" ? "客服台" : t.owner, body: body.trim() }],
      }),
      "坐席回复(正文已留档)",
      `工单回复 ${selected.id} · admin.support_ticket_replied`,
    );
    setReplyBody("");
    toast(`${selected.id} 已回复并转待用户`);
  };

  // 例行:直接流转状态(状态菜单 + 关闭/重开)。closeOrReopen 保留关闭↔重开翻转。
  const setTicketStatusDirect = (id: string, status: SupportTicketStatus) => {
    const t = tickets.find((x) => x.id === id);
    if (!t || t.status === status) return;
    const now = Date.now();
    updateTicket(id, (x) => ({ ...x, status, updatedAt: now }), `状态流转「${TK_STATUS_CN[status]}」(例行,自动留档)`, `工单状态流转 ${id} · admin.support_ticket_status`);
    toast(`${id} → ${TK_STATUS_CN[status]}`);
  };
  const closeOrReopen = () => {
    if (!selected) return;
    const now = Date.now();
    const nextStatus: SupportTicketStatus = selected.status === "closed" ? "open" : "closed";
    updateTicket(
      selected.id,
      (t) => ({ ...t, status: nextStatus, updatedAt: now }),
      `坐席${nextStatus === "closed" ? "关闭" : "重开"}工单(例行,自动留档)`,
      `${nextStatus === "closed" ? "关闭" : "重开"}工单 ${selected.id} · admin.support_ticket_${nextStatus === "closed" ? "closed" : "reopened"}`,
    );
    toast(`${selected.id} 已${nextStatus === "closed" ? "关闭" : "重开"}`);
  };

  // 例行:改优先级 / 转交 owner
  const setPriorityDirect = (id: string, priority: SupportTicketPriority) => {
    const now = Date.now();
    updateTicket(id, (t) => ({ ...t, priority, updatedAt: now }), `调整优先级「${PRIO_CN[priority]}」(例行,自动留档)`, `工单优先级 ${id} · admin.support_ticket_priority`);
    toast(`${id} 优先级 → ${PRIO_CN[priority]}`);
  };
  const setOwnerDirect = (id: string, owner: string) => {
    const now = Date.now();
    updateTicket(id, (t) => ({ ...t, owner, updatedAt: now }), `转交坐席「${owner}」(例行,自动留档)`, `工单转交 ${id} · admin.support_ticket_owner`);
    toast(`${id} 已转交 ${owner}`);
  };

  // 处置:升级为即时会话(不传 edit;真写对方真写键 I.session.convos + 工单 thread 留系统标注)
  const escalateToConversation = () => {
    if (!selected) return;
    const ticket = selected;
    openActionConfirm({
      action: <>升级为即时会话 · {ticket.id}</>,
      detail: (
        <>
          把工单 <b>{ticket.subject}</b> 升级为即时会话,坐席 <b>{ticket.owner}</b> 在会话中心继续实时接待;会话写入 <span className="mono">I.session.convos</span>,本工单 thread 同时留一条升级标注。仅迁移接待载体,资金放行仍回 D2。
        </>
      ),
      amplifies: false,
      run: (reason: string) => {
        const now = Date.now();
        const existingConvos = cloneConvos(parseParamArray<SessionConvo>(pget(CONVO_KEY), []));
        const newConvo: SessionConvo = {
          id: `cv-from-${ticket.id}`,
          type: "support",
          agentName: ticket.owner,
          roleKey: "conversations.roleSupport",
          unread: 0,
          lastTs: now,
          status: "open",
          owner: ticket.owner,
          customer: `工单 ${ticket.id} 用户`,
          origin: "support",
          profile: {
            uid: "—",
            nickname: `工单 ${ticket.id} 用户`,
            phone: "—",
            vlevel: "—",
            kyc: "待核对",
            tags: [catCN(ticket.category)],
            risk: "中",
            riskNote: `由工单 ${ticket.id}(${catCN(ticket.category)})升级转入 · 完整客户档案待客服在用户系统补全。`,
            recharge: "—",
            withdraw: "—",
            balance: "—",
            tickets: 1,
            device: "—",
            hashrate: "—",
            region: "—",
            joined: "—",
            lastActive: "刚刚",
            ledger: [],
            notes: [],
          },
          messages: [{ ts: now, sender: "agent", agentName: ticket.owner, text: `(由工单 ${ticket.subject} 升级)` }],
        };
        setParam(CONVO_KEY, JSON.stringify([...existingConvos, newConvo]), { action: `工单升级为即时会话 ${ticket.id} · admin.conversation_from_ticket`, reason });
        updateTicket(
          ticket.id,
          (t) => ({ ...t, updatedAt: now, messages: [...t.messages, { ts: now, author: "agent", agentName: t.owner, body: `已升级为即时会话 ${newConvo.id},坐席在会话中心继续接待。` }] }),
          reason,
          `工单升级为即时会话 ${ticket.id} · admin.conversation_from_ticket`,
        );
        toast(`${ticket.id} 已升级为即时会话 ${newConvo.id}`);
        setDrawerOpen(false);
      },
    });
  };

  const categoryOptions: HDOption[] = [{ value: "all", label: "全部分类" }, ...slaRows.map((s) => ({ value: s.category, label: catCN(s.category) }))];

  const threadMessages: ThreadMessage[] = (selected?.messages ?? []).map((m) => ({
    ts: m.ts,
    fromAgent: m.author === "agent",
    agentName: m.agentName,
    senderName: m.author === "agent" ? m.agentName ?? "客服台" : "用户",
    role: m.author === "agent" ? "support" : "user",
    body: m.body,
  }));

  return (
    <div className="tk-wrap m2-stage">
      <p className="dim" style={{ margin: "0 0 12px", fontSize: 13 }}>
        用户提的问题在这排队 · 点一行打开<b style={{ color: "var(--ink-2)", fontWeight: 500 }}>工单详情与处理</b>:回复 / 改状态 / 转交 / 关单 / 升级为即时会话。
      </p>
      <div className="tk-toolbar">
        <div className="seg">
          {SCOPES.map(([k, lab]) => (
            <button key={k} className={scope === k ? "on" : ""} onClick={() => setScope(k)}>
              {k === "archived" && <Icon name="box" size={14} />}
              {lab}
              {k === "archived" ? ` ${archivedCount}` : ""}
            </button>
          ))}
        </div>
        <div style={{ width: 188 }}>
          <HDSelect value={categoryFilter} onChange={(v) => setCategoryFilter(v as "all" | SupportTicketCategory)} options={categoryOptions} />
        </div>
        <div className="inp" style={{ flex: 1, maxWidth: 320 }}>
          <Icon name="search" size={15} />
          <input data-proof="support-ticket-search" placeholder="搜索主题 / 单号 / 负责人 / 分类" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <span className="mono dim2" style={{ marginLeft: "auto", fontSize: 12.5 }}>共 {filtered.length} 条</span>
      </div>

      <div className="tk-scroll">
        <table className="tk-table">
          <thead>
            <tr>
              <th style={{ width: "38%" }}>工单</th>
              <th style={{ width: 110 }}>分类</th>
              <th style={{ width: 86 }}>优先级</th>
              <th style={{ width: 120 }}>状态</th>
              <th style={{ width: 132 }}>负责人</th>
              <th style={{ width: 150 }}>最近回复</th>
              <th style={{ textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((t) => {
              const last = t.messages[t.messages.length - 1];
              const sel = drawerOpen && selected?.id === t.id;
              const done = t.status === "resolved" || t.status === "closed";
              return (
                <tr key={t.id} className={`tk-row${sel ? " sel" : ""}`} onClick={() => openTicket(t.id)}>
                  <td>
                    <div className="tk-subj">{t.subject}</div>
                    <div className="tk-id">{t.id}</div>
                  </td>
                  <td>
                    <span className="chip" style={{ border: "none" }}>{catCN(t.category)}</span>
                  </td>
                  <td>
                    <Prio p={t.priority} />
                  </td>
                  <td>
                    <TicketStatus status={t.status} />
                  </td>
                  <td>
                    <span className="agent">
                      <MAvatar name={t.owner} size="sm" />
                      <span className="nm" style={{ fontSize: 12.5 }}>{ownerLabel(t.owner)}</span>
                    </span>
                  </td>
                  <td>
                    <div className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{relWhen(t.lastReplyAt)}</div>
                    <div className="dim2" style={{ fontSize: 11 }}>{last ? WHO_CN[last.author] : "—"}回复</div>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="tk-acts">
                      {!done && (
                        <button type="button" className="tk-iact ok" title="标记已解决" onClick={() => setTicketStatusDirect(t.id, "resolved")}>
                          <Icon name="check" size={16} />
                        </button>
                      )}
                      {t.status === "closed" ? (
                        <button type="button" className="tk-iact" title="重开" onClick={() => setTicketStatusDirect(t.id, "open")}>
                          <Icon name="arrow" size={16} />
                        </button>
                      ) : (
                        <button type="button" className="tk-iact" title="关闭" onClick={() => setTicketStatusDirect(t.id, "closed")}>
                          <Icon name="x" size={16} />
                        </button>
                      )}
                      <button type="button" className="btn btn-sec btn-sm" title="打开处理" onClick={() => openTicket(t.id)}>
                        <Icon name="eye" size={16} />
                        处理
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length && <Empty icon="search">没有匹配的工单</Empty>}
      </div>

      {filtered.length > 0 && (
        <div className="tk-pager" data-list-pager="true">
          <span className="dim2" style={{ fontSize: 12.5 }}>
            显示 {start + 1}–{Math.min(start + pageSize, filtered.length)} · 共 {filtered.length} 条
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 14 }}>
            <span className="dim2" style={{ fontSize: 12.5 }}>每页</span>
            <div style={{ width: 78 }}>
              <HDSelect value={String(pageSize)} onChange={(v) => setPageSize(Number(v))} options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: n }))} />
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" className="btn btn-sec btn-sm btn-icon" disabled={curPage <= 1} title="上一页" onClick={() => setPage(curPage - 1)}>
              <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}>
                <Icon name="chevron" size={16} />
              </span>
            </button>
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <button key={p} type="button" className={`tk-pageno${p === curPage ? " on" : ""}`} onClick={() => setPage(p)}>
                {p}
              </button>
            ))}
            <button type="button" className="btn btn-sec btn-sm btn-icon" disabled={curPage >= pageCount} title="下一页" onClick={() => setPage(curPage + 1)}>
              <Icon name="chevron" size={16} />
            </button>
          </div>
        </div>
      )}

      {drawerOpen && selected && (
        <TicketDrawer
          ticket={selected}
          replyBody={replyBody}
          onReplyChange={setReplyBody}
          onClose={() => setDrawerOpen(false)}
          onSend={sendReply}
          onStatus={(s) => setTicketStatusDirect(selected.id, s)}
          onPriority={(p) => setPriorityDirect(selected.id, p)}
          onOwner={(o) => setOwnerDirect(selected.id, o)}
          onCloseReopen={closeOrReopen}
          onEscalate={escalateToConversation}
          thread={threadMessages}
          replyTemplates={replyTemplates}
        />
      )}
    </div>
  );
}

function TicketDrawer({
  ticket,
  replyBody,
  onReplyChange,
  onClose,
  onSend,
  onStatus,
  onPriority,
  onOwner,
  onCloseReopen,
  onEscalate,
  thread,
  replyTemplates,
}: {
  ticket: SupportTicket;
  replyBody: string;
  onReplyChange: (v: string) => void;
  onClose: () => void;
  onSend: (body: string) => void;
  onStatus: (s: SupportTicketStatus) => void;
  onPriority: (p: SupportTicketPriority) => void;
  onOwner: (o: string) => void;
  onCloseReopen: () => void;
  onEscalate: () => void;
  thread: ThreadMessage[];
  replyTemplates: string[];
}) {
  const isClosed = ticket.status === "closed";
  const statusItems: MenuItem[] = STATUS_MENU.map(([s, label]) => ({ label, cur: ticket.status === s, onClick: () => onStatus(s) }));
  const priorityItems: MenuItem[] = PRIORITY_LIST.map((p) => ({ label: PRIO_CN[p], cur: ticket.priority === p, onClick: () => onPriority(p) }));
  const ownerItems: MenuItem[] = SUPPORT_AGENTS.map((n) => ({ label: ownerLabel(n), cur: ticket.owner === n, onClick: () => onOwner(n) }));

  return (
    <>
      <div className="tk-drawer-back" onClick={onClose} />
      <div className="tk-drawer">
        <div style={{ padding: "15px 18px 14px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="idtag">{ticket.id}</span>
            <TicketStatus status={ticket.status} />
            <Prio p={ticket.priority} />
            <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClose} title="关闭 (Esc)" style={{ marginLeft: "auto" }}>
              <Icon name="x" size={16} />
            </button>
          </div>
          <h2 style={{ fontSize: 18, margin: "11px 0 0", fontWeight: 500 }}>{ticket.subject}</h2>
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 9, flexWrap: "wrap" }}>
            <span className="chip" style={{ border: "none" }}>{catCN(ticket.category)}</span>
            <span className="agent dim" style={{ fontSize: 12.5 }}>
              <MAvatar name={ticket.owner} size="sm" /> {ownerLabel(ticket.owner)}
            </span>
            <span className="dim2" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="clock" size={13} /> 更新 {relWhen(ticket.updatedAt)}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13, flexWrap: "wrap" }}>
            <MiniMenu label="状态" items={statusItems} />
            <MiniMenu label="优先级" items={priorityItems} />
            <MiniMenu label="转交" icon="users" items={ownerItems} />
            <div style={{ flex: 1 }} />
            <button type="button" data-proof="support-ticket-escalate" className="btn btn-cyan btn-sm" onClick={onEscalate}>
              <Icon name="arrow" size={16} />
              升级会话
            </button>
            <button type="button" data-proof="support-ticket-close" className={`btn btn-sm ${isClosed ? "btn-sec" : "btn-danger"}`} onClick={onCloseReopen}>
              <Icon name={isClosed ? "arrow" : "x"} size={16} />
              {isClosed ? "重开" : "关闭"}
            </button>
          </div>
        </div>

        <div className="ChatBody">
          <MessageThread messages={thread} relWhen={relWhen} />
        </div>

        {!isClosed && (
          <div className="ChatComposer">
            <div style={{ display: "flex", gap: 7, marginBottom: 9, flexWrap: "wrap", alignItems: "center" }}>
              <span className="dim2" style={{ fontSize: 11.5, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon name="flame" size={13} />
                快捷回复
              </span>
              {replyTemplates.length === 0 && <span className="dim2" style={{ fontSize: 11.5 }}>暂无可用回复模板</span>}
              {replyTemplates.map((tpl, i) => (
                <button key={i} type="button" className="chip" title={tpl} onClick={() => onReplyChange(replyBody ? `${replyBody} ${tpl}` : tpl)}>
                  {tpl.slice(0, 14)}…
                </button>
              ))}
            </div>
            <textarea
              className="ta"
              data-proof="support-ticket-reply"
              rows={3}
              placeholder={`回复 ${ticket.id} · ⌘/Ctrl+Enter 发送`}
              value={replyBody}
              onChange={(e) => onReplyChange(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSend(replyBody);
              }}
            />
            <div style={{ display: "flex", alignItems: "center", marginTop: 9 }}>
              <span className="dim2" style={{ fontSize: 11.5 }}>例行回复直接执行并自动留档,无需理由 · 资金放行回 D2 / 账户处置回 C5 / 设备换货回 E5</span>
              <button type="button" data-proof="support-ticket-reply-save" className="btn btn-pri btn-sm" style={{ marginLeft: "auto" }} onClick={() => onSend(replyBody)}>
                <Icon name="arrow" size={16} />
                发送回复
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
