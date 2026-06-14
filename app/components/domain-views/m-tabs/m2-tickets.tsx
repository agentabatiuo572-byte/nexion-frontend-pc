"use client";

/**
 * M2 工单台 — 客服工单 list + detail desk(由 I8 迁出)。
 * 真写统一落 platform-config params(persist 兼容前缀):
 *  - I.support.tickets: UniApp ticket mock field mirror + admin owner/status/reply
 *  - 升级为即时会话时写 I.session.convos(对方真写键,不造影子)。
 * 关键验收:回复 ticket、关闭 ticket、升级为即时会话三个动作必须刷新后仍在。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataListPager, MessageThread, PaginationExemptionList, useDataListPager, type ThreadMessage } from "../design-kit";
import {
  SESSION_CONVOS,
  SUPPORT_AGENTS,
  SUPPORT_CATEGORY_LABEL,
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_REPLY_TEMPLATES,
  SUPPORT_STATUS_LABEL,
  SUPPORT_TICKETS,
  type SessionConvo,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./data";
import type { MCtx } from "./types";

const TICKET_KEY = "I.support.tickets";
const CONVO_KEY = "I.session.convos";

const STATUS_FILTERS: Array<["all" | SupportTicketStatus, string]> = [
  ["all", "全部"],
  ["open", "Open"],
  ["in_progress", "处理中"],
  ["pending_user", "待用户"],
  ["resolved", "已解决"],
  ["closed", "已关闭"],
];

const CATEGORY_FILTERS: Array<["all" | SupportTicketCategory, string]> = [
  ["all", "全部"],
  ["withdrawal", "Withdrawal"],
  ["kyc", "KYC"],
  ["hardware", "Hardware"],
  ["account", "Account"],
  ["genesis", "Genesis"],
  ["technical", "Technical"],
];

const PRIORITY_OPTIONS: SupportTicketPriority[] = ["low", "normal", "high", "urgent"];
const STATUS_OPTIONS: SupportTicketStatus[] = ["open", "in_progress", "pending_user", "resolved", "closed"];

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
  return rows.map((ticket) => ({
    ...ticket,
    messages: ticket.messages.map((message) => ({ ...message })),
  }));
}

function cloneConvos(rows: SessionConvo[]): SessionConvo[] {
  return rows.map((convo) => ({ ...convo, messages: convo.messages.map((message) => ({ ...message })) }));
}

function statusTone(status: SupportTicketStatus): string {
  if (status === "open" || status === "pending_user") return "warn";
  if (status === "in_progress") return "cyan";
  if (status === "resolved") return "ok";
  return "dim";
}

function priorityTone(priority: SupportTicketPriority): string {
  if (priority === "urgent") return "bad";
  if (priority === "high") return "warn";
  if (priority === "normal") return "cyan";
  return "dim";
}

function relWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function minReason(reason: string): boolean {
  return reason.trim().length >= 8;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>
        {label}
        {required && <b style={{ color: "var(--danger)", marginLeft: 4 }}>*</b>}
      </span>
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="fld" {...props} />;
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="fld" {...props} />;
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="fld" {...props} />;
}

export function M2Tickets({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const tickets = useMemo(() => cloneTickets(parseParamArray<SupportTicket>(pget(TICKET_KEY), SUPPORT_TICKETS)), [ctx.params, pget]);

  const [statusFilter, setStatusFilter] = useState<"all" | SupportTicketStatus>("all");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportTicketCategory>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("TK-1024");
  const [ownerDraft, setOwnerDraft] = useState("Marina K.");
  const [priorityDraft, setPriorityDraft] = useState<SupportTicketPriority>("high");
  const [statusDraft, setStatusDraft] = useState<SupportTicketStatus>("open");
  const [assignReason, setAssignReason] = useState("");
  const [replyBody, setReplyBody] = useState("");
  const [replyReason, setReplyReason] = useState("");
  const [closeReason, setCloseReason] = useState("");

  const selected = tickets.find((ticket) => ticket.id === selectedId) ?? tickets[0] ?? null;

  useEffect(() => {
    if (!selected) return;
    setOwnerDraft(selected.owner);
    setPriorityDraft(selected.priority);
    setStatusDraft(selected.status);
    setAssignReason("");
    setReplyBody("");
    setReplyReason("");
    setCloseReason("");
  }, [selected?.id, selected?.owner, selected?.priority, selected?.status]);

  const filteredTickets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter((ticket) => statusFilter === "all" || ticket.status === statusFilter)
      .filter((ticket) => categoryFilter === "all" || ticket.category === categoryFilter)
      .filter((ticket) => {
        if (!q) return true;
        return [ticket.id, ticket.subject, ticket.owner, SUPPORT_CATEGORY_LABEL[ticket.category]]
          .some((text) => text.toLowerCase().includes(q));
      })
      .sort((a, b) => b.lastReplyAt - a.lastReplyAt);
  }, [categoryFilter, query, statusFilter, tickets]);

  const ticketPager = useDataListPager(filteredTickets, {
    initialPageSize: 5,
    resetKey: `${statusFilter}:${categoryFilter}:${query}:${tickets.length}`,
  });

  const openCount = tickets.filter((ticket) => ticket.status === "open" || ticket.status === "in_progress").length;
  const awaitingUser = tickets.filter((ticket) => ticket.status === "pending_user").length;
  const urgentCount = tickets.filter((ticket) => ticket.priority === "urgent" || ticket.priority === "high").length;
  const resolvedCount = tickets.filter((ticket) => ticket.status === "resolved" || ticket.status === "closed").length;

  const writeTickets = (next: SupportTicket[], reason: string, action: string) => {
    setParam(TICKET_KEY, JSON.stringify(next), { action, reason });
  };

  const updateTicket = (id: string, updater: (ticket: SupportTicket) => SupportTicket, reason: string, action: string) => {
    const next = tickets.map((ticket) => (ticket.id === id ? updater(ticket) : ticket));
    writeTickets(next, reason, action);
  };

  const saveTicketMeta = () => {
    if (!selected) return;
    if (!minReason(assignReason)) {
      toast("分配 / 改状态需要 8 字以上审计理由");
      return;
    }
    const now = Date.now();
    updateTicket(
      selected.id,
      (ticket) => ({ ...ticket, owner: ownerDraft, priority: priorityDraft, status: statusDraft, updatedAt: now }),
      assignReason.trim(),
      `工单分配与状态更新 ${selected.id} · admin.support_ticket_updated`,
    );
    toast(`${selected.id} 已更新 owner/status/priority`);
  };

  const sendReply = () => {
    if (!selected) return;
    if (!replyBody.trim() || !minReason(replyReason)) {
      toast("回复需要正文和 8 字以上审计理由");
      return;
    }
    const now = Date.now();
    updateTicket(
      selected.id,
      (ticket) => ({
        ...ticket,
        owner: ownerDraft,
        status: "pending_user",
        updatedAt: now,
        lastReplyAt: now,
        unread: 0,
        messages: [
          ...ticket.messages,
          { ts: now, author: "agent", agentName: ownerDraft === "Unassigned" ? "Support desk" : ownerDraft, body: replyBody.trim() },
        ],
      }),
      replyReason.trim(),
      `工单回复 ${selected.id} · admin.support_ticket_replied`,
    );
    toast(`${selected.id} 已回复并转待用户`);
  };

  const closeOrReopen = () => {
    if (!selected) return;
    if (!minReason(closeReason)) {
      toast("关闭 / 重开需要 8 字以上审计理由");
      return;
    }
    const now = Date.now();
    const nextStatus: SupportTicketStatus = selected.status === "closed" ? "open" : "closed";
    updateTicket(
      selected.id,
      (ticket) => ({ ...ticket, status: nextStatus, updatedAt: now }),
      closeReason.trim(),
      `${nextStatus === "closed" ? "关闭" : "重开"}工单 ${selected.id} · admin.support_ticket_${nextStatus === "closed" ? "closed" : "reopened"}`,
    );
    toast(`${selected.id} 已${nextStatus === "closed" ? "关闭" : "重开"}`);
  };

  // 升级为即时会话:处置类(不传 edit)。真写对方真写键 I.session.convos,并给工单 thread 留一条系统标注。
  const escalateToConversation = () => {
    if (!selected) return;
    const ticket = selected;
    openActionConfirm({
      action: <>升级为即时会话 · {ticket.id}</>,
      detail: (
        <>
          把工单 <b>{ticket.subject}</b> 升级为即时会话,坐席 <b>{ticket.owner}</b> 在会话中心继续实时接待;
          会话写入 <span className="mono">I.session.convos</span>,本工单 thread 同时留一条升级标注。仅迁移接待载体,资金放行仍回 D2。
        </>
      ),
      amplifies: false,
      run: (reason: string) => {
        const now = Date.now();
        const existingConvos = cloneConvos(parseParamArray<SessionConvo>(pget(CONVO_KEY), SESSION_CONVOS));
        const newConvo: SessionConvo = {
          id: `cv-from-${ticket.id}`,
          type: "support",
          agentName: ticket.owner,
          roleKey: "conversations.roleSupport",
          unread: 0,
          lastTs: now,
          status: "open",
          owner: ticket.owner,
          messages: [{ ts: now, sender: "agent", agentName: ticket.owner, text: `(由工单 ${ticket.subject} 升级)` }],
        };
        setParam(
          CONVO_KEY,
          JSON.stringify([...existingConvos, newConvo]),
          { action: `工单升级为即时会话 ${ticket.id} · admin.conversation_from_ticket`, reason },
        );
        updateTicket(
          ticket.id,
          (t) => ({
            ...t,
            updatedAt: now,
            messages: [...t.messages, { ts: now, author: "agent", agentName: t.owner, body: `已升级为即时会话 ${newConvo.id},坐席在会话中心继续接待。` }],
          }),
          reason,
          `工单升级为即时会话 ${ticket.id} · admin.conversation_from_ticket`,
        );
        toast(`${ticket.id} 已升级为即时会话 ${newConvo.id}`);
      },
    });
  };

  const threadMessages: ThreadMessage[] = (selected?.messages ?? []).map((message) => ({
    ts: message.ts,
    fromAgent: message.author === "agent",
    agentName: message.agentName,
    body: message.body,
  }));

  return (
    <>
      <div className="f-stats">
        <div className="f-stat warn">
          <div className="k">处理中工单</div>
          <div className="v">{openCount}</div>
          <div className="sub">open + in_progress</div>
        </div>
        <div className="f-stat cyan">
          <div className="k">待用户补充</div>
          <div className="v">{awaitingUser}</div>
          <div className="sub">pending_user · App 侧可继续回复</div>
        </div>
        <div className="f-stat danger">
          <div className="k">高优先级</div>
          <div className="v">{urgentCount}</div>
          <div className="sub">urgent/high 进入客服快速通道</div>
        </div>
        <div className="f-stat ok">
          <div className="k">已结工单</div>
          <div className="v">{resolvedCount}</div>
          <div className="sub">resolved + closed</div>
        </div>
      </div>

      <div className="two-col">
        <section className="l-card" data-support-panel="tickets">
          <div className="l-h">
            <span className="ttl">工单列表</span>
            <span className="sub">· 字段镜像 UniApp support ticket mock</span>
            <div className="r chips">
              <span className="lb">状态</span>
              {STATUS_FILTERS.map(([value, label]) => (
                <button key={value} className={`chip${statusFilter === value ? " sel" : ""}`} onClick={() => setStatusFilter(value)}>{label}</button>
              ))}
            </div>
          </div>
          <div className="l-b" style={{ paddingBottom: 10 }}>
            <div className="grid g-2" style={{ gap: 10 }}>
              <Field label="分类筛选">
                <Select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value as "all" | SupportTicketCategory)}>
                  {CATEGORY_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </Field>
              <Field label="搜索 工单号 / 主题 / 负责人">
                <Input data-proof="support-ticket-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="TK-1024 / withdrawal / Marina" />
              </Field>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th>工单</th>
                  <th>分类</th>
                  <th>状态</th>
                  <th>优先级</th>
                  <th>负责人</th>
                  <th>最近回复</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {ticketPager.pageRows.map((ticket) => (
                  <tr key={ticket.id} className="click" onClick={() => setSelectedId(ticket.id)}>
                    <td>
                      <span style={{ fontWeight: 600, color: "var(--ink)" }}>{ticket.subject}</span>
                      <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>{ticket.id}</div>
                    </td>
                    <td><span className="bdg cyan">{SUPPORT_CATEGORY_LABEL[ticket.category]}</span></td>
                    <td><span className={`bdg ${statusTone(ticket.status)}`}>{SUPPORT_STATUS_LABEL[ticket.status]}</span></td>
                    <td><span className={`bdg ${priorityTone(ticket.priority)}`}>{SUPPORT_PRIORITY_LABEL[ticket.priority]}</span></td>
                    <td style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{ticket.owner}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{relWhen(ticket.lastReplyAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      <button type="button" className="l-btn sm mc" onClick={(event) => { event.stopPropagation(); setSelectedId(ticket.id); }}>查看处理</button>
                    </td>
                  </tr>
                ))}
                {ticketPager.total === 0 && (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "22px 12px", color: "var(--ink-4)" }}>
                      当前筛选下没有工单
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="客服工单队列"
            page={ticketPager.page}
            pageSize={ticketPager.pageSize}
            total={ticketPager.total}
            rawTotal={tickets.length}
            onPageChange={ticketPager.setPage}
            onPageSizeChange={ticketPager.setPageSize}
            pageSizeOptions={[5, 10, 20, 50]}
          />
        </section>

        <section className="l-card" data-support-panel="ticket-detail">
          <div className="l-h">
            <span className="ttl">工单详情与处理</span>
            <span className="sub">· 分配 / 回复 / 改状态 / 关闭 / 升级会话都是真写</span>
            <div className="r">
              {selected && <span className="icode electric">{selected.id}</span>}
            </div>
          </div>
          {selected ? (
            <div className="l-b" style={{ display: "grid", gap: 14 }}>
              <div className="itint">
                <b>{selected.subject}</b>
                <div style={{ marginTop: 6 }}>
                  <span className="bdg cyan">{SUPPORT_CATEGORY_LABEL[selected.category]}</span>{" "}
                  <span className={`bdg ${statusTone(selected.status)}`}>{SUPPORT_STATUS_LABEL[selected.status]}</span>{" "}
                  <span className={`bdg ${priorityTone(selected.priority)}`}>{SUPPORT_PRIORITY_LABEL[selected.priority]}</span>
                </div>
                <div className="tiny" style={{ color: "var(--ink-4)", marginTop: 8 }}>
                  created {relWhen(selected.createdAt)} · updated {relWhen(selected.updatedAt)} · lastReplyAt {relWhen(selected.lastReplyAt)}
                </div>
              </div>

              <div style={{ display: "grid", gap: 8 }}>
                <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>MESSAGE THREAD</div>
                <MessageThread messages={threadMessages} relWhen={relWhen} />
              </div>

              <div className="grid g-2" style={{ gap: 10 }}>
                <Field label="负责人 owner" required>
                  <Select data-proof="support-ticket-owner" value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)}>
                    {SUPPORT_AGENTS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                  </Select>
                </Field>
                <Field label="优先级 priority" required>
                  <Select value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as SupportTicketPriority)}>
                    {PRIORITY_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_PRIORITY_LABEL[item]}</option>)}
                  </Select>
                </Field>
                <Field label="状态 status" required>
                  <Select data-proof="support-ticket-status" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as SupportTicketStatus)}>
                    {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_STATUS_LABEL[item]}</option>)}
                  </Select>
                </Field>
                <Field label="分配 / 改状态审计理由" required>
                  <Input data-proof="support-ticket-meta-reason" value={assignReason} onChange={(event) => setAssignReason(event.target.value)} placeholder="例: 根据工单队列 SLA 转 Payment desk" />
                </Field>
              </div>
              <button type="button" className="l-btn primary" onClick={saveTicketMeta}>保存 owner / priority / status</button>

              <div className="itint cyan">
                <b>快捷回复模板</b>
                <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
                  {SUPPORT_REPLY_TEMPLATES.map((tpl) => (
                    <button key={tpl} type="button" className="chip" onClick={() => setReplyBody(tpl)}>{tpl.slice(0, 18)}...</button>
                  ))}
                </div>
              </div>
              <Field label="运营回复正文" required>
                <TextArea data-proof="support-ticket-reply" rows={4} value={replyBody} onChange={(event) => setReplyBody(event.target.value)} placeholder="回复给用户看的处理说明;保存后追加 agent message" />
              </Field>
              <Field label="回复审计理由" required>
                <Input data-proof="support-ticket-reply-reason" value={replyReason} onChange={(event) => setReplyReason(event.target.value)} placeholder="例: 已核对 D2 提现队列并同步 ETA" />
              </Field>
              <button type="button" data-proof="support-ticket-reply-save" className="l-btn primary" onClick={sendReply}>回复并转待用户</button>

              <Field label={selected.status === "closed" ? "重开理由" : "关闭理由"} required>
                <Input data-proof="support-ticket-close-reason" value={closeReason} onChange={(event) => setCloseReason(event.target.value)} placeholder={selected.status === "closed" ? "例: 用户回复后需要继续处理" : "例: 用户确认到账,问题已解决"} />
              </Field>
              <button type="button" data-proof="support-ticket-close" className="l-btn mc" onClick={closeOrReopen}>
                {selected.status === "closed" ? "重开工单" : "关闭工单"}
              </button>

              <button type="button" data-proof="support-ticket-escalate" className="l-btn mc" onClick={escalateToConversation}>
                升级为即时会话
              </button>
            </div>
          ) : (
            <div className="l-b">
              <div className="itint">请选择左侧工单。</div>
            </div>
          )}
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:工单分配 / 回复 / 关闭 / 升级会话均要求业务字段 + 审计理由,写入 A2 审计与 platform-config 持久层。<b>前端对应</b>:UniApp `/pages/me/support`、`/pages/me/support-tickets` 使用同构 ticket 字段;后台 owner/status/priority/reply 是运营侧补齐字段。<b>边界</b>:客服台只记录解释、分配、回复与关闭;真正资金放行仍回 D2,账户安全处置回 C5,设备换货回 E5。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "工单列表",
            kind: "sample-ledger",
            maxRows: 5,
            reason: "工单为种子样本,新增/升级动作后进入队列",
          },
        ]}
      />
    </>
  );
}
