"use client";

/**
 * I8 客服支持 CMS — Help/FAQ + ticket SLA + operator ticket desk.
 * 真写统一落 platform-config params:
 *  - I.support.faqs: FAQ/help content rows
 *  - I.support.sla: category SLA matrix
 *  - I.support.tickets: UniApp ticket mock field mirror + admin owner/status/reply
 * 关键验收:新建 FAQ、回复 ticket、关闭 ticket 三个动作必须刷新后仍在。
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { DataListPager, PaginationExemptionList, useDataListPager } from "../design-kit";
import {
  SUPPORT_AGENTS,
  SUPPORT_CATEGORY_LABEL,
  SUPPORT_FAQS,
  SUPPORT_PRIORITY_LABEL,
  SUPPORT_REPLY_TEMPLATES,
  SUPPORT_SLA,
  SUPPORT_STATUS_LABEL,
  SUPPORT_TICKETS,
  type SupportFaq,
  type SupportSla,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./data";
import type { ICtx } from "./types";

const FAQ_KEY = "I.support.faqs";
const SLA_KEY = "I.support.sla";
const TICKET_KEY = "I.support.tickets";

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

const CATEGORY_OPTIONS: SupportTicketCategory[] = [
  "withdrawal",
  "deposit",
  "kyc",
  "hardware",
  "account",
  "earnings",
  "genesis",
  "technical",
  "other",
];
const FAQ_CATEGORY_OPTIONS: SupportFaq["category"][] = ["general", ...CATEGORY_OPTIONS];
const PRIORITY_OPTIONS: SupportTicketPriority[] = ["low", "normal", "high", "urgent"];
const STATUS_OPTIONS: SupportTicketStatus[] = ["open", "in_progress", "pending_user", "resolved", "closed"];

type NewFaqForm = {
  category: SupportFaq["category"];
  question: string;
  answer: string;
  status: SupportFaq["status"];
  surface: SupportFaq["surface"];
  reason: string;
};

const EMPTY_FAQ: NewFaqForm = {
  category: "general",
  question: "",
  answer: "",
  status: "published",
  surface: "Help Center",
  reason: "",
};

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

function nextFaqId(rows: SupportFaq[]): string {
  const max = rows.reduce((acc, row) => {
    const n = Number(row.id.replace(/^FAQ-/, ""));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 3);
  return `FAQ-${String(max + 1).padStart(3, "0")}`;
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

export function I8Support({ ctx }: { ctx: ICtx }) {
  const { pget, setParam, toast } = ctx;
  const faqs = useMemo(() => parseParamArray<SupportFaq>(pget(FAQ_KEY), SUPPORT_FAQS), [ctx.params, pget]);
  const sla = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), SUPPORT_SLA), [ctx.params, pget]);
  const tickets = useMemo(() => cloneTickets(parseParamArray<SupportTicket>(pget(TICKET_KEY), SUPPORT_TICKETS)), [ctx.params, pget]);

  const [newFaq, setNewFaq] = useState<NewFaqForm>(EMPTY_FAQ);
  const [slaCategory, setSlaCategory] = useState<SupportTicketCategory>("withdrawal");
  const [slaDraft, setSlaDraft] = useState({ firstResponseMins: "15", resolutionHours: "12", queue: "Payment desk", escalation: "D2 withdrawal review", reason: "" });
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
    const row = sla.find((item) => item.category === slaCategory) ?? SUPPORT_SLA.find((item) => item.category === slaCategory);
    if (!row) return;
    setSlaDraft({
      firstResponseMins: String(row.firstResponseMins),
      resolutionHours: String(row.resolutionHours),
      queue: row.queue,
      escalation: row.escalation,
      reason: "",
    });
  }, [sla, slaCategory]);

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

  const writeFaqs = (next: SupportFaq[], reason: string, action: string) => {
    setParam(FAQ_KEY, JSON.stringify(next), { action, reason });
  };

  const writeSla = (next: SupportSla[], reason: string, action: string) => {
    setParam(SLA_KEY, JSON.stringify(next), { action, reason });
  };

  const writeTickets = (next: SupportTicket[], reason: string, action: string) => {
    setParam(TICKET_KEY, JSON.stringify(next), { action, reason });
  };

  const saveFaq = () => {
    if (!newFaq.question.trim() || !newFaq.answer.trim() || !minReason(newFaq.reason)) {
      toast("FAQ 需要问题 / 回答 / 8 字以上审计理由");
      return;
    }
    const row: SupportFaq = {
      id: nextFaqId(faqs),
      category: newFaq.category,
      question: newFaq.question.trim(),
      answer: newFaq.answer.trim(),
      status: newFaq.status,
      surface: newFaq.surface,
      updatedAt: new Date().toISOString().slice(0, 10),
    };
    writeFaqs([row, ...faqs], newFaq.reason.trim(), `新建支持 FAQ ${row.id} · admin.support_faq_created`);
    setNewFaq(EMPTY_FAQ);
    toast(`${row.id} 已保存 · ${SUPPORT_CATEGORY_LABEL[row.category]} FAQ`);
  };

  const saveSla = () => {
    const firstResponseMins = Number(slaDraft.firstResponseMins);
    const resolutionHours = Number(slaDraft.resolutionHours);
    if (!Number.isFinite(firstResponseMins) || !Number.isFinite(resolutionHours) || firstResponseMins <= 0 || resolutionHours <= 0) {
      toast("SLA 数值必须大于 0");
      return;
    }
    if (!slaDraft.queue.trim() || !slaDraft.escalation.trim() || !minReason(slaDraft.reason)) {
      toast("SLA 需要队列 / 升级路径 / 8 字以上审计理由");
      return;
    }
    const row: SupportSla = {
      category: slaCategory,
      firstResponseMins,
      resolutionHours,
      queue: slaDraft.queue.trim(),
      escalation: slaDraft.escalation.trim(),
    };
    const next = [row, ...sla.filter((item) => item.category !== slaCategory)];
    writeSla(next, slaDraft.reason.trim(), `更新支持 SLA ${slaCategory} · admin.support_sla_changed`);
    toast(`${SUPPORT_CATEGORY_LABEL[slaCategory]} SLA 已更新`);
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
          <div className="k">Help 内容</div>
          <div className="v">{faqs.length} 条</div>
          <div className="sub">FAQ / ticket create / Nova 共用</div>
        </div>
      </div>

      <div className="two-col">
        <section className="l-card" data-support-panel="faq">
          <div className="l-h">
            <span className="ttl">Help/FAQ 内容管理</span>
            <span className="sub">· 对应 UniApp /pages/me/help 与 /support 的自助内容</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>FAQ</th>
                  <th>分类</th>
                  <th>Surface</th>
                  <th>状态</th>
                  <th>更新</th>
                </tr>
              </thead>
              <tbody>
                {faqs.map((faq) => (
                  <tr key={faq.id}>
                    <td>
                      <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{faq.id}</span>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>{faq.question}</div>
                      <div style={{ fontSize: 11.5, color: "var(--ink-4)", marginTop: 2, maxWidth: 460 }}>{faq.answer}</div>
                    </td>
                    <td><span className="bdg cyan">{SUPPORT_CATEGORY_LABEL[faq.category]}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{faq.surface}</td>
                    <td><span className={`bdg ${faq.status === "published" ? "ok" : "dim"}`}>{faq.status}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{faq.updatedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="l-card" data-support-panel="faq-create">
          <div className="l-h">
            <span className="ttl">新增 FAQ</span>
            <span className="sub">· 保存后立即进入 Help Center 内容池</span>
          </div>
          <div className="l-b">
            <div className="grid g-2" style={{ gap: 12, marginBottom: 12 }}>
              <Field label="分类 category" required>
                <Select value={newFaq.category} onChange={(event) => setNewFaq({ ...newFaq, category: event.target.value as SupportFaq["category"] })}>
                  {FAQ_CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_CATEGORY_LABEL[item]}</option>)}
                </Select>
              </Field>
              <Field label="可见位置 surface" required>
                <Select value={newFaq.surface} onChange={(event) => setNewFaq({ ...newFaq, surface: event.target.value as SupportFaq["surface"] })}>
                  <option value="Help Center">Help Center</option>
                  <option value="Ticket Create">Ticket Create</option>
                  <option value="Nova">Nova</option>
                </Select>
              </Field>
            </div>
            <div style={{ display: "grid", gap: 12 }}>
              <Field label="问题 question" required>
                <Input data-proof="support-faq-question" value={newFaq.question} onChange={(event) => setNewFaq({ ...newFaq, question: event.target.value })} placeholder="如:How long does withdrawal review take?" />
              </Field>
              <Field label="回答 answer" required>
                <TextArea data-proof="support-faq-answer" rows={4} value={newFaq.answer} onChange={(event) => setNewFaq({ ...newFaq, answer: event.target.value })} placeholder="写清用户可执行步骤、后台处理队列与 SLA" />
              </Field>
              <Field label="发布状态">
                <Select value={newFaq.status} onChange={(event) => setNewFaq({ ...newFaq, status: event.target.value as SupportFaq["status"] })}>
                  <option value="published">published</option>
                  <option value="draft">draft</option>
                </Select>
              </Field>
              <Field label="审计理由(8 字以上)" required>
                <Input data-proof="support-faq-reason" value={newFaq.reason} onChange={(event) => setNewFaq({ ...newFaq, reason: event.target.value })} placeholder="例: FR-009 对应帮助中心缺口补齐" />
              </Field>
              <button type="button" data-proof="support-faq-save" className="l-btn primary" onClick={saveFaq}>保存 FAQ</button>
            </div>
          </div>
        </section>
      </div>

      <section className="l-card" data-support-panel="sla">
        <div className="l-h">
          <span className="ttl">Ticket 分类与 SLA</span>
          <span className="sub">· 分类归队列,升级路径回到 C/D/E/G 等业务域</span>
          <div className="r">
            <span className="icode electric">I.support.sla</span>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 800 }}>
            <thead>
              <tr>
                <th>分类</th>
                <th className="num">首响</th>
                <th className="num">解决 SLA</th>
                <th>队列</th>
                <th>升级路径</th>
              </tr>
            </thead>
            <tbody>
              {sla.map((row) => (
                <tr key={row.category}>
                  <td><span className="bdg cyan">{SUPPORT_CATEGORY_LABEL[row.category]}</span></td>
                  <td className="num mono">{row.firstResponseMins}m</td>
                  <td className="num mono">{row.resolutionHours}h</td>
                  <td>{row.queue}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>{row.escalation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="l-b">
          <div className="grid g-2" style={{ gap: 12 }}>
            <Field label="要调整的分类" required>
              <Select data-proof="support-sla-category" value={slaCategory} onChange={(event) => setSlaCategory(event.target.value as SupportTicketCategory)}>
                {CATEGORY_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_CATEGORY_LABEL[item]}</option>)}
              </Select>
            </Field>
            <Field label="首响分钟 firstResponseMins" required>
              <Input type="number" value={slaDraft.firstResponseMins} onChange={(event) => setSlaDraft({ ...slaDraft, firstResponseMins: event.target.value })} />
            </Field>
            <Field label="解决小时 resolutionHours" required>
              <Input type="number" value={slaDraft.resolutionHours} onChange={(event) => setSlaDraft({ ...slaDraft, resolutionHours: event.target.value })} />
            </Field>
            <Field label="负责人队列 queue" required>
              <Input value={slaDraft.queue} onChange={(event) => setSlaDraft({ ...slaDraft, queue: event.target.value })} />
            </Field>
            <Field label="升级路径 escalation" required>
              <Input value={slaDraft.escalation} onChange={(event) => setSlaDraft({ ...slaDraft, escalation: event.target.value })} />
            </Field>
            <Field label="审计理由(8 字以上)" required>
              <Input value={slaDraft.reason} onChange={(event) => setSlaDraft({ ...slaDraft, reason: event.target.value })} placeholder="例:SLA 与 D2/C4 队列口径同步" />
            </Field>
          </div>
          <button type="button" className="l-btn primary" style={{ marginTop: 12 }} onClick={saveSla}>保存 SLA 配置</button>
        </div>
      </section>

      <div className="two-col">
        <section className="l-card" data-support-panel="tickets">
          <div className="l-h">
            <span className="ttl">Ticket 列表</span>
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
              <Field label="搜索 ticket / subject / owner">
                <Input data-proof="support-ticket-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="TK-1024 / withdrawal / Marina" />
              </Field>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 880 }}>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>分类</th>
                  <th>状态</th>
                  <th>优先级</th>
                  <th>Owner</th>
                  <th>Last reply</th>
                  <th style={{ textAlign: "right" }}>动作</th>
                </tr>
              </thead>
              <tbody>
                {ticketPager.pageRows.map((ticket) => (
                  <tr key={ticket.id} className="click" onClick={() => setSelectedId(ticket.id)}>
                    <td>
                      <span className="mono" style={{ fontWeight: 700, color: "var(--ink)" }}>{ticket.id}</span>
                      <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 3 }}>{ticket.subject}</div>
                    </td>
                    <td><span className="bdg cyan">{SUPPORT_CATEGORY_LABEL[ticket.category]}</span></td>
                    <td><span className={`bdg ${statusTone(ticket.status)}`}>{SUPPORT_STATUS_LABEL[ticket.status]}</span></td>
                    <td><span className={`bdg ${priorityTone(ticket.priority)}`}>{SUPPORT_PRIORITY_LABEL[ticket.priority]}</span></td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{ticket.owner}</td>
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
            <span className="sub">· 分配 / 回复 / 改状态 / 关闭都是真写</span>
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
                {selected.messages.map((message, index) => {
                  const isAgent = message.author === "agent";
                  return (
                    <div
                      key={`${message.ts}-${index}`}
                      style={{
                        padding: "11px 12px",
                        borderRadius: 10,
                        background: isAgent ? "var(--i-ac-soft)" : "var(--surface-2)",
                        color: "var(--ink-2)",
                      }}
                    >
                      <div className="mono" style={{ fontSize: 11, color: isAgent ? "var(--i-ac)" : "var(--ink-4)", marginBottom: 5 }}>
                        {isAgent ? message.agentName ?? "Agent" : "User"} · {relWhen(message.ts)}
                      </div>
                      <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>{message.body}</div>
                    </div>
                  );
                })}
              </div>

              <div className="grid g-2" style={{ gap: 10 }}>
                <Field label="Owner" required>
                  <Select data-proof="support-ticket-owner" value={ownerDraft} onChange={(event) => setOwnerDraft(event.target.value)}>
                    {SUPPORT_AGENTS.map((agent) => <option key={agent} value={agent}>{agent}</option>)}
                  </Select>
                </Field>
                <Field label="Priority" required>
                  <Select value={priorityDraft} onChange={(event) => setPriorityDraft(event.target.value as SupportTicketPriority)}>
                    {PRIORITY_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_PRIORITY_LABEL[item]}</option>)}
                  </Select>
                </Field>
                <Field label="Status" required>
                  <Select data-proof="support-ticket-status" value={statusDraft} onChange={(event) => setStatusDraft(event.target.value as SupportTicketStatus)}>
                    {STATUS_OPTIONS.map((item) => <option key={item} value={item}>{SUPPORT_STATUS_LABEL[item]}</option>)}
                  </Select>
                </Field>
                <Field label="分配 / 改状态审计理由" required>
                  <Input data-proof="support-ticket-meta-reason" value={assignReason} onChange={(event) => setAssignReason(event.target.value)} placeholder="例: 根据 TK 队列 SLA 转 Payment desk" />
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
            </div>
          ) : (
            <div className="l-b">
              <div className="itint">请选择左侧工单。</div>
            </div>
          )}
        </section>
      </div>

      <p className="f-foot">
        <b>执行门槛</b>:FAQ / SLA / 工单写动作均要求业务字段 + 审计理由,写入 A2 审计与 platform-config 持久层。<b>前端对应</b>:UniApp `/pages/me/help`、`/pages/me/support`、`/pages/me/support-tickets` 使用同构 ticket 字段;后台 owner/status/priority/reply 是运营侧补齐字段。<b>边界</b>:客服台只记录解释、分配、回复与关闭;真正资金放行仍回 D2,账户安全处置回 C5,设备换货回 E5。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "Help/FAQ 内容管理",
            maxRows: 3,
            reason: "FAQ 当前三条种子内容,新增 FAQ 后进入内容管理列表",
          },
          {
            label: "Ticket 分类与 SLA",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "SLA 分类固定六类,同屏核对升级路径比翻页更适合",
          },
        ]}
      />
    </>
  );
}
