"use client";

/**
 * M2 工单台 — 全宽表格列队 + 右侧滑出详情抽屉(helpdesk 设计稿布局)。
 * 业务读写走后端 content/ticket/conversation 接口;I.support.* / I.session.* 为 M 容器传入的视图适配键。
 * 例行坐席操作(回复/改状态/改优先级/转交/关闭重开)直接执行 + 自动 A2 审计;
 * 仅「升级为即时会话」这类跨载体处置走操作确认 + 理由。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Icon, MessageThread, Modal, type ThreadMessage } from "../design-kit";
import {
  type SessionReplyTpl,
  type SupportSla,
  type SupportTicket,
  type SupportTicketCategory,
  type SupportTicketPriority,
  type SupportTicketStatus,
} from "./data";
import { catCN, Empty, HDSelect, MAvatar, MiniMenu, ownerLabel, PRIO_CN, Prio, relWhen, TicketStatus, TK_STATUS_CN, type HDOption, type MenuItem } from "./hd-ui";
import type { MCtx } from "./types";
import { type MSupportAgent } from "@/lib/admin/m-client";
import { useAdminAuth } from "@/lib/store/admin-auth";

const TICKET_KEY = "I.support.tickets";
const SLA_KEY = "I.support.sla";
const REPLY_TEMPLATE_KEY = "I.session.replyTemplates";
const AGENT_LIST_KEY = "I.support.agents";

type Scope = "active" | "resolved" | "archived" | "all";
const SCOPES: Array<[Scope, string]> = [
  ["active", "活跃"],
  ["resolved", "已解决"],
  ["archived", "已归档"],
  ["all", "全部"],
];
const ACTIVE_STATUSES: SupportTicketStatus[] = ["open", "in_progress", "pending_user"];
const STATUS_TRANSITIONS: Record<SupportTicketStatus, SupportTicketStatus[]> = {
  open: ["in_progress", "pending_user", "resolved", "closed"],
  in_progress: ["open", "pending_user", "resolved", "closed"],
  pending_user: ["open", "in_progress", "resolved", "closed"],
  resolved: ["open", "pending_user", "closed"],
  closed: ["open"],
};
const STATUS_ACTION_CN: Record<SupportTicketStatus, string> = {
  open: "重新打开",
  in_progress: "标记处理中",
  pending_user: "待用户补充",
  resolved: "标记已解决",
  closed: "关闭工单",
};
const CATEGORY_LIST: SupportTicketCategory[] = ["account", "withdrawal", "deposit", "kyc", "hardware", "earnings", "genesis", "technical", "other"];
const PRIORITY_LIST: SupportTicketPriority[] = ["urgent", "high", "normal", "low"];

/* 工单分类 → 跨域处置直达链接(C/D/E 域)。按工单分类匹配一条直达路由,
 * 让坐席从工单详情一步跳到真正的处置流程,而不是只靠 toast + 手工导航。
 * href 接收 userId(已由工单详情保证为真实用户绑定)。 */
const CATEGORY_CROSS_LINKS: Array<{ category: SupportTicketCategory; href: (userId: number) => string; label: string; icon: "wallet" | "users" | "shield" | "box" | "coin" }> = [
  { category: "withdrawal", href: (uid) => `/users/search/${uid}#hub-withdrawal`, label: "去提现记录", icon: "wallet" },
  { category: "deposit", href: (uid) => `/users/search/${uid}#hub-deposit`, label: "去充值记录", icon: "wallet" },
  { category: "kyc", href: () => `/users/kyc`, label: "去实名台账", icon: "shield" },
  { category: "account", href: () => `/users/actions`, label: "去账户处置", icon: "users" },
  { category: "hardware", href: (uid) => `/users/search/${uid}#hub-devices`, label: "去设备明细", icon: "box" },
  { category: "earnings", href: (uid) => `/users/search/${uid}#hub-deposit`, label: "去收益明细", icon: "coin" },
];
function findCategoryCrossLink(category: SupportTicketCategory): typeof CATEGORY_CROSS_LINKS[number] | null {
  return CATEGORY_CROSS_LINKS.find((link) => link.category === category) ?? null;
}
const PAGE_SIZE_OPTIONS = ["8", "15", "30"];
const WHO_CN: Record<"user" | "agent" | "system" | "internal", string> = {
  user: "用户",
  agent: "坐席",
  system: "系统",
  internal: "内部",
};
type CreateTicketForm = {
  userId: string;
  category: SupportTicketCategory;
  priority: SupportTicketPriority;
  owner: string;
  title: string;
  body: string;
};

type PendingCreatedTicket = {
  subject: string;
  userId?: number;
  existingIds: string[];
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
  return rows.map((ticket) => ({ ...ticket, messages: ticket.messages.map((m) => ({ ...m })) }));
}

type LinkedConversation = { no: string; archived: boolean };

function linkedConversation(ticket: SupportTicket): LinkedConversation | null {
  for (const message of ticket.messages) {
    // M3→M2 转单会关闭源会话，因此返回链接必须直接进入“归档”；否则 q 搜索会落到空列表。
    const converted = message.body.match(/会话号[:：]\s*(CV-[^，。\s]+)/);
    if (converted?.[1]) return { no: converted[1], archived: true };
    // M2→M3 升级产生的是仍在处理的即时会话，继续进入默认活跃范围。
    const escalated = message.body.match(/即时会话\s+(CV-[^，。\s]+)/);
    if (escalated?.[1]) return { no: escalated[1], archived: false };
  }
  return null;
}

function isAssignableSupportAgent(agent: MSupportAgent): boolean {
  return agent.enabled && agent.transferable && agent.serviceTypes.includes("support");
}

export function M2Tickets({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM2 = isSuperAdmin || Boolean(authorities?.includes("service_m2_write"));
  const ticketsAvailable = pget("I.support.ticketsAvailable") === "1";
  const tickets = useMemo(() => cloneTickets(parseParamArray<SupportTicket>(pget(TICKET_KEY), [])), [ctx.params, pget]);
  const replyTemplates = useMemo(
    () =>
      parseParamArray<SessionReplyTpl>(pget(REPLY_TEMPLATE_KEY), [])
        .filter((tpl) => tpl.type === "support" && tpl.status === "published")
        .map((tpl) => tpl.text),
    [ctx.params, pget],
  );
  const slaRows = useMemo(() => parseParamArray<SupportSla>(pget(SLA_KEY), []), [ctx.params, pget]);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const ownerOptions = useMemo(() => {
    const assignableAgentNames = supportAgents
      .filter(isAssignableSupportAgent)
      .map((agent) => agent.name.trim())
      .filter(Boolean);
    return Array.from(new Set(assignableAgentNames));
  }, [supportAgents]);
  const ticketCategoryOptions = useMemo(() => {
    const cats = new Set<SupportTicketCategory>(CATEGORY_LIST);
    slaRows.forEach((row) => cats.add(row.category));
    return Array.from(cats).map((value) => ({ value, label: catCN(value) }));
  }, [slaRows]);

  const [scope, setScope] = useState<Scope>("active");
  const [categoryFilter, setCategoryFilter] = useState<"all" | SupportTicketCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | SupportTicketStatus>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [internalNoteBody, setInternalNoteBody] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [writePending, setWritePending] = useState(false);
  const [pendingCreatedTicket, setPendingCreatedTicket] = useState<PendingCreatedTicket | null>(null);
  const writeInFlight = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedScope = params.get("scope");
    const requestedStatus = params.get("status");
    if (requestedScope === "active" || requestedScope === "resolved" || requestedScope === "archived" || requestedScope === "all") {
      setScope(requestedScope);
    }
    if (requestedStatus && (["open", "in_progress", "pending_user", "resolved", "closed"] as string[]).includes(requestedStatus)) {
      setStatusFilter(requestedStatus as SupportTicketStatus);
    }
  }, []);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    const pending = pendingCreatedTicket;
    if (!pending) return;
    const authoritative = tickets.find((ticket) =>
      ticket.subject === pending.subject
      && ticket.userId === pending.userId
      && !pending.existingIds.includes(ticket.id));
    if (!authoritative) return;
    setPendingCreatedTicket(null);
    setSelectedId(authoritative.id);
    setDrawerOpen(true);
  }, [pendingCreatedTicket, tickets]);

  const resolvedCount = tickets.filter((t) => !t.archived && (t.status === "resolved" || t.status === "closed")).length;
  const archivedCount = tickets.filter((t) => t.archived).length;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tickets
      .filter((t) => {
        if (scope === "all") return true;
        if (scope === "archived") return t.archived;
        if (scope === "resolved") return !t.archived && (t.status === "resolved" || t.status === "closed");
        return !t.archived && ACTIVE_STATUSES.includes(t.status);
      })
      .filter((t) => statusFilter === "all" || t.status === statusFilter)
      .filter((t) => categoryFilter === "all" || t.category === categoryFilter)
      .filter((t) => {
        if (!q) return true;
        return [t.id, t.subject, t.owner, catCN(t.category)].some((text) => text.toLowerCase().includes(q));
      })
      .sort((a, b) => b.lastReplyAt - a.lastReplyAt);
  }, [tickets, scope, statusFilter, categoryFilter, query]);

  useEffect(() => {
    if (drawerOpen && selectedId && !filtered.some((ticket) => ticket.id === selectedId)) {
      setDrawerOpen(false);
    }
  }, [drawerOpen, filtered, selectedId]);

  // 本地 page state 渲染设计稿 tk-pager(数字 + data-list-pager 供运行时分页门计数)。
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const curPage = Math.min(page, pageCount);
  useEffect(() => {
    setPage(1);
  }, [scope, statusFilter, categoryFilter, query, pageSize]);
  const start = (curPage - 1) * pageSize;
  const paged = filtered.slice(start, start + pageSize);

  useEffect(() => {
    setReplyBody("");
    setInternalNoteBody("");
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

  const commitTicketWrite = async (write: () => Promise<boolean>, successMessage: string): Promise<boolean> => {
    if (writeInFlight.current) {
      toast("操作正在提交,请稍候");
      return false;
    }
    writeInFlight.current = true;
    setWritePending(true);
    try {
      const succeeded = await write();
      if (succeeded) toast(successMessage);
      return succeeded;
    } finally {
      writeInFlight.current = false;
      setWritePending(false);
    }
  };

  const updateTicket = async (id: string, updater: (t: SupportTicket) => SupportTicket, reason: string, action: string): Promise<boolean> => {
    const next = tickets.map((t) => (t.id === id ? updater(t) : t));
    return setParam(TICKET_KEY, JSON.stringify(next), { action, reason });
  };

  const createTicket = async (form: CreateTicketForm) => {
    if (!canWriteM2 || !ticketsAvailable) return;
    const title = form.title.trim();
    const body = form.body.trim();
    const userId = form.userId.trim() ? Number(form.userId) : undefined;
    if (!title || !body) {
      toast("新建工单需要标题和问题描述");
      return;
    }
    if (userId !== undefined && (!Number.isSafeInteger(userId) || userId <= 0)) {
      toast("用户 ID 必须是正整数,也可以留空");
      return;
    }
    if (!form.owner || !ownerOptions.includes(form.owner)) {
      toast("新建工单需要选择真实客服负责人");
      return;
    }
    const selectedSla = slaRows.find((item) => item.category === form.category);
    if (!selectedSla) {
      toast("该分类 SLA 权威规则不可用,请刷新后重试");
      return;
    }
    const now = Date.now();
    const row: SupportTicket = {
      id: `TK-${now}`,
      userId,
      userVerified: false,
      subject: title,
      category: form.category,
      status: "open",
      priority: form.priority,
      createdAt: now,
      updatedAt: now,
      lastReplyAt: now,
      unread: 1,
      owner: form.owner,
      archived: false,
      version: 0,
      slaTarget: {
        ruleVersion: selectedSla.version,
        firstResponseMins: selectedSla.firstResponseMins,
        resolutionHours: selectedSla.resolutionHours,
        queue: selectedSla.queue,
        escalation: selectedSla.escalation,
        firstResponseDeadlineAt: now + selectedSla.firstResponseMins * 60_000,
        resolutionDeadlineAt: now + selectedSla.resolutionHours * 3_600_000,
        firstResponseOverdue: false,
        resolutionOverdue: false,
        evaluatedAt: now,
      },
      messages: [{ ts: now, author: "user", body }],
    };
    setPendingCreatedTicket({ subject: title, userId, existingIds: tickets.map((ticket) => ticket.id) });
    const succeeded = await commitTicketWrite(
      () => setParam(TICKET_KEY, JSON.stringify([row, ...tickets]), { action: "新建客服工单 · admin.support_ticket_created", reason: "客服人工新建工单并自动留档" }),
      `工单已创建并进入 ${ownerLabel(form.owner)} 队列`,
    );
    if (succeeded) {
      setShowCreate(false);
    } else {
      setPendingCreatedTicket(null);
    }
  };

  // 例行:回复(正文本身即留档)
  const sendReply = async (body: string) => {
    if (!selected || !canWriteM2 || !ticketsAvailable || selected.archived) return;
    if (!body.trim()) {
      toast("回复需要正文");
      return;
    }
    const now = Date.now();
    const succeeded = await commitTicketWrite(
      () => updateTicket(
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
      ),
      `${selected.id} 已回复并转待用户`,
    );
    if (succeeded) setReplyBody("");
  };

  // 例行:直接流转状态(状态菜单 + 关闭/重开)。closeOrReopen 保留关闭↔重开翻转。
  const setTicketStatusDirect = async (id: string, status: SupportTicketStatus) => {
    if (!canWriteM2 || !ticketsAvailable) return;
    const t = tickets.find((x) => x.id === id);
    if (!t || t.archived || t.status === status) return;
    const now = Date.now();
    await commitTicketWrite(
      () => updateTicket(id, (x) => ({ ...x, status, updatedAt: now }), `状态流转「${TK_STATUS_CN[status]}」(例行,自动留档)`, `工单状态流转 ${id} · admin.support_ticket_status`),
      `${id} → ${TK_STATUS_CN[status]}`,
    );
  };
  const closeOrReopen = async () => {
    if (!selected || !canWriteM2 || !ticketsAvailable || selected.archived) return;
    const now = Date.now();
    const nextStatus: SupportTicketStatus = selected.status === "closed" || selected.status === "resolved" ? "open" : "closed";
    await commitTicketWrite(
      () => updateTicket(
        selected.id,
        (t) => ({ ...t, status: nextStatus, updatedAt: now }),
        `坐席${nextStatus === "closed" ? "关闭" : "重开"}工单(例行,自动留档)`,
        `${nextStatus === "closed" ? "关闭" : "重开"}工单 ${selected.id} · admin.support_ticket_${nextStatus === "closed" ? "closed" : "reopened"}`,
      ),
      `${selected.id} 已${nextStatus === "closed" ? "关闭" : "重开"}`,
    );
  };

  // 例行:改优先级 / 转交 owner
  const setPriorityDirect = async (id: string, priority: SupportTicketPriority) => {
    if (!canWriteM2 || !ticketsAvailable) return;
    const now = Date.now();
    await commitTicketWrite(
      () => updateTicket(id, (t) => ({ ...t, priority, updatedAt: now }), `调整优先级「${PRIO_CN[priority]}」(例行,自动留档)`, `工单优先级 ${id} · admin.support_ticket_priority`),
      `${id} 优先级 → ${PRIO_CN[priority]}`,
    );
  };
  const setOwnerDirect = async (id: string, owner: string) => {
    if (!canWriteM2 || !ticketsAvailable) return;
    if (!ownerOptions.includes(owner)) {
      toast("只能转交给当前可接单的客服坐席");
      return;
    }
    const now = Date.now();
    await commitTicketWrite(
      () => updateTicket(id, (t) => ({ ...t, owner, updatedAt: now }), `转交坐席「${owner}」(例行,自动留档)`, `工单转交 ${id} · admin.support_ticket_owner`),
      `${id} 已转交 ${owner}`,
    );
  };

  const setArchivedDirect = async (id: string, archived: boolean) => {
    if (!canWriteM2 || !ticketsAvailable) return;
    const ticket = tickets.find((item) => item.id === id);
    if (!ticket || Boolean(ticket.archived) === archived) return;
    if (archived && ticket.status !== "resolved" && ticket.status !== "closed") {
      toast("只有已解决或已关闭的工单可以归档");
      return;
    }
    const now = Date.now();
    await commitTicketWrite(
      () => updateTicket(
        id,
        (item) => ({ ...item, archived, archivedAt: archived ? now : undefined, updatedAt: now }),
        archived ? "已解决工单例行归档并自动留档" : "归档工单恢复到已解决队列并自动留档",
        `${archived ? "归档" : "恢复"}工单 ${id} · admin.support_ticket_${archived ? "archived" : "unarchived"}`,
      ),
      `${id} 已${archived ? "归档" : "恢复到已解决队列"}`,
    );
  };

  const addInternalNote = async (body: string) => {
    if (!selected || !canWriteM2 || !ticketsAvailable || selected.archived) return;
    const note = body.trim();
    if (!note) {
      toast("内部备注需要正文");
      return;
    }
    const succeeded = await commitTicketWrite(
      () => setParam("I.support.ticketInternalNote.__create", JSON.stringify({
        ticketNo: selected.id,
        body: note,
        expectedStatus: selected.status,
        expectedVersion: selected.version,
      }), {
        action: `工单内部备注 ${selected.id} · admin.support_ticket_internal_note`,
        reason: "客服内部协作备注自动留档",
        commandKey: `m2:ticket:${selected.id}:internal-note:${selected.version}:${note}`,
      }),
      `${selected.id} 内部备注已保存`,
    );
    if (succeeded) setInternalNoteBody("");
  };

  // 处置:升级为即时会话(不传 edit;真写对方真写键 I.session.convos + 工单 thread 留系统标注)
  const escalateToConversation = () => {
    if (!selected || !canWriteM2 || !ticketsAvailable || selected.archived) return;
    const ticket = selected;
    if (!ticket.userId || ticket.userId <= 0 || !ticket.userVerified) {
      toast("该工单没有后端确认的真实用户,请先核对用户后再升级会话");
      return;
    }
    const assignedAgent = supportAgents.find((agent) => isAssignableSupportAgent(agent) && agent.name === ticket.owner);
    if (!assignedAgent) {
      toast("当前负责人不在可接单客服名册,请先转交后再升级会话");
      return;
    }
    openActionConfirm({
      action: <>升级为即时会话 · {ticket.id}</>,
      detail: (
        <>
          把工单 <b>{ticket.subject}</b> 升级为即时会话,坐席 <b>{ticket.owner}</b> 在会话中心继续实时接待;系统会保留真实用户关联,并在本工单同步记录会话编号。仅迁移接待载体,资金放行仍回 D2。
        </>
      ),
      amplifies: false,
      run: (reason: string) => {
        void commitTicketWrite(
          () => setParam("I.support.ticketEscalation.__create", JSON.stringify({
            ticketNo: ticket.id,
            ownerAgentId: assignedAgent.id,
            ownerAgentName: assignedAgent.name,
            expectedStatus: ticket.status,
            expectedVersion: ticket.version,
          }), {
            action: `工单升级为即时会话 ${ticket.id} · admin.conversation_from_ticket`,
            reason,
            commandKey: `m2:ticket:${ticket.id}:escalate:${ticket.version}`,
          }),
          `${ticket.id} 已升级为即时会话`,
        ).then((succeeded) => {
          if (succeeded) setDrawerOpen(false);
        });
      },
    });
  };

  const categoryOptions: HDOption[] = [{ value: "all", label: "全部分类" }, ...ticketCategoryOptions];

  const threadMessages: ThreadMessage[] = (selected?.messages ?? []).map((m) => ({
    ts: m.ts,
    fromAgent: m.author === "agent",
    agentName: m.agentName,
    senderName: m.author === "internal"
      ? `内部备注 · ${m.agentName ?? "客服台"}`
      : m.author === "system"
        ? "系统"
        : m.author === "agent"
          ? m.agentName ?? "客服台"
          : "用户",
    system: m.author === "system" || m.author === "internal",
    role: m.author === "user" ? "user" : "support",
    body: m.body,
  }));

  return (
    <div className="tk-wrap m2-stage">
      <p className="dim" style={{ margin: "0 0 12px", fontSize: 13 }}>
        用户提的问题在这排队 · 点一行打开<b style={{ color: "var(--ink-2)", fontWeight: 500 }}>工单详情与处理</b>:回复 / 改状态 / 转交 / 关单 / 升级为即时会话。
      </p>
      {!ticketsAvailable && (
        <div className="itint" role="alert" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13 }}>工单数据暂时无法同步,当前不展示空队列,也不会开放写操作。</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>请稍后刷新页面;若持续失败,联系平台管理员检查客服工单服务。</div>
        </div>
      )}
      {ticketsAvailable && !canWriteM2 && (
        <div className="itint" role="status" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13 }}>当前账号为只读模式。</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>可以筛选和查看工单,回复、流转、归档及升级会话需要 M2 写权限。</div>
        </div>
      )}
      {ticketsAvailable && canWriteM2 && ownerOptions.length === 0 && (
        <div className="itint" role="alert" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13 }}>当前没有可接单的客服坐席。</div>
          <div className="dim2" style={{ fontSize: 11.5, marginTop: 4 }}>请先在 M1 启用具备客服服务类型且允许转交的坐席。</div>
        </div>
      )}
      <div className="tk-toolbar">
        <div className="seg">
          {SCOPES.map(([k, lab]) => (
            <button key={k} className={scope === k ? "on" : ""} onClick={() => setScope(k)}>
              {k === "archived" && <Icon name="box" size={14} />}
              {lab}
              {k === "resolved" ? ` ${resolvedCount}` : k === "archived" ? ` ${archivedCount}` : ""}
            </button>
          ))}
        </div>
        <div style={{ width: 188 }}>
          <HDSelect value={categoryFilter} onChange={(v) => setCategoryFilter(v as "all" | SupportTicketCategory)} options={categoryOptions} />
        </div>
        <div style={{ width: 150 }}>
          <HDSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as "all" | SupportTicketStatus)}
            options={[{ value: "all", label: "全部状态" }, ...Object.entries(TK_STATUS_CN).map(([value, label]) => ({ value, label }))]}
          />
        </div>
        <div className="inp" style={{ flex: 1, maxWidth: 320 }}>
          <Icon name="search" size={15} />
          <input data-proof="support-ticket-search" placeholder="搜索主题 / 单号 / 负责人 / 分类" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        {canWriteM2 && ticketsAvailable && ownerOptions.length > 0 && (
          <button type="button" data-proof="support-ticket-create" className="btn btn-pri btn-sm" disabled={writePending} onClick={() => setShowCreate(true)}>
            <Icon name="plus" size={16} />
            新建工单
          </button>
        )}
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
                      {canWriteM2 && ticketsAvailable && !t.archived && !done && (
                        <button type="button" className="tk-iact ok" title="标记已解决" onClick={() => setTicketStatusDirect(t.id, "resolved")}>
                          <Icon name="check" size={16} />
                        </button>
                      )}
                      {canWriteM2 && ticketsAvailable && t.archived ? (
                        <button type="button" className="tk-iact" title="恢复到已解决队列" onClick={() => setArchivedDirect(t.id, false)}>
                          <Icon name="arrow" size={16} />
                        </button>
                      ) : canWriteM2 && ticketsAvailable && done ? (
                        <>
                          <button type="button" className="tk-iact" title="归档" onClick={() => setArchivedDirect(t.id, true)}>
                            <Icon name="box" size={16} />
                          </button>
                          <button type="button" className="tk-iact" title="重新打开" onClick={() => setTicketStatusDirect(t.id, "open")}>
                            <Icon name="arrow" size={16} />
                          </button>
                        </>
                      ) : canWriteM2 && ticketsAvailable ? (
                        <button type="button" className="tk-iact" title="关闭" onClick={() => setTicketStatusDirect(t.id, "closed")}>
                          <Icon name="x" size={16} />
                        </button>
                      ) : null}
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
        {ticketsAvailable && !filtered.length && <Empty icon="search">没有匹配的工单;可以调整筛选条件{canWriteM2 ? "或新建工单" : ""}</Empty>}
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
          internalNoteBody={internalNoteBody}
          onInternalNoteChange={setInternalNoteBody}
          onInternalNote={addInternalNote}
          onClose={() => setDrawerOpen(false)}
          onSend={sendReply}
          onStatus={(s) => setTicketStatusDirect(selected.id, s)}
          onPriority={(p) => setPriorityDirect(selected.id, p)}
          onOwner={(o) => setOwnerDirect(selected.id, o)}
          onCloseReopen={closeOrReopen}
          onArchive={(archived) => setArchivedDirect(selected.id, archived)}
          onEscalate={escalateToConversation}
          thread={threadMessages}
          replyTemplates={replyTemplates}
          ownerOptions={ownerOptions}
          canWrite={canWriteM2 && ticketsAvailable && !writePending}
        />
      )}

      {showCreate && (
        <CreateTicketModal
          categoryOptions={ticketCategoryOptions}
          ownerOptions={ownerOptions}
          submitting={writePending}
          onClose={() => setShowCreate(false)}
          onSave={createTicket}
        />
      )}
    </div>
  );
}

function TicketDrawer({
  ticket,
  replyBody,
  onReplyChange,
  internalNoteBody,
  onInternalNoteChange,
  onInternalNote,
  onClose,
  onSend,
  onStatus,
  onPriority,
  onOwner,
  onCloseReopen,
  onArchive,
  onEscalate,
  thread,
  replyTemplates,
  ownerOptions,
  canWrite,
}: {
  ticket: SupportTicket;
  replyBody: string;
  onReplyChange: (v: string) => void;
  internalNoteBody: string;
  onInternalNoteChange: (v: string) => void;
  onInternalNote: (body: string) => void;
  onClose: () => void;
  onSend: (body: string) => void;
  onStatus: (s: SupportTicketStatus) => void;
  onPriority: (p: SupportTicketPriority) => void;
  onOwner: (o: string) => void;
  onCloseReopen: () => void;
  onArchive: (archived: boolean) => void;
  onEscalate: () => void;
  thread: ThreadMessage[];
  replyTemplates: string[];
  ownerOptions: string[];
  canWrite: boolean;
}) {
  const isTerminal = ticket.status === "resolved" || ticket.status === "closed";
  const conversation = linkedConversation(ticket);
  const categoryCrossLink = findCategoryCrossLink(ticket.category);
  const statusItems: MenuItem[] = STATUS_TRANSITIONS[ticket.status].map((status) => ({ label: STATUS_ACTION_CN[status], onClick: () => onStatus(status) }));
  const priorityItems: MenuItem[] = PRIORITY_LIST.map((p) => ({ label: PRIO_CN[p], cur: ticket.priority === p, onClick: () => onPriority(p) }));
  const ownerItems: MenuItem[] = ownerOptions.map((n) => ({ label: ownerLabel(n), cur: ticket.owner === n, onClick: () => onOwner(n) }));

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
            {canWrite && !ticket.archived && <MiniMenu label="状态" items={statusItems} />}
            {canWrite && !ticket.archived && !isTerminal && <MiniMenu label="优先级" items={priorityItems} />}
            {canWrite && !ticket.archived && ticket.status !== "closed" && <MiniMenu label="转交" icon="users" items={ownerItems} />}
            {ticket.userId && ticket.userVerified && <Link className="btn btn-sec btn-sm" href={`/users/search/${ticket.userId}#hub-payment-methods`}><Icon name="wallet" size={16} />用户支付方式</Link>}
            {ticket.userId && ticket.userVerified && categoryCrossLink && (
              <Link className="btn btn-cyan btn-sm" href={categoryCrossLink.href(ticket.userId)}>
                <Icon name={categoryCrossLink.icon} size={16} />{categoryCrossLink.label}
              </Link>
            )}
            <div style={{ flex: 1 }} />
            {conversation ? (
              <Link className="btn btn-cyan btn-sm" href={conversation.archived
                ? `/service/sessions?seg=archived&q=${encodeURIComponent(conversation.no)}`
                : `/service/sessions?q=${encodeURIComponent(conversation.no)}`}>
                <Icon name="arrow" size={16} />查看会话 {conversation.no}
              </Link>
            ) : canWrite && !ticket.archived && !isTerminal && (
              <button
                type="button"
                data-proof="support-ticket-escalate"
                className="btn btn-cyan btn-sm"
                onClick={onEscalate}
                disabled={!ticket.userId || ticket.userId <= 0 || !ticket.userVerified}
                title={ticket.userId && ticket.userId > 0 && ticket.userVerified
                  ? "升级为与该用户的即时会话"
                  : "该工单没有后端确认的真实用户,无法升级会话"}
              >
                <Icon name="arrow" size={16} />
                升级会话
              </button>
            )}
            {canWrite && !ticket.archived && (
              <button type="button" data-proof="support-ticket-close" className={`btn btn-sm ${isTerminal ? "btn-sec" : "btn-danger"}`} onClick={onCloseReopen}>
                <Icon name={isTerminal ? "arrow" : "x"} size={16} />
                {isTerminal ? "重新打开" : "关闭"}
              </button>
            )}
            {canWrite && !ticket.archived && isTerminal && (
              <button type="button" className="btn btn-sec btn-sm" onClick={() => onArchive(true)} title="移入可查询的已归档队列">
                <Icon name="box" size={16} />归档
              </button>
            )}
            {canWrite && ticket.archived && (
              <button type="button" className="btn btn-sec btn-sm" onClick={() => onArchive(false)} title="恢复到已解决队列">
                <Icon name="arrow" size={16} />恢复
              </button>
            )}
          </div>
          {ticket.userId && !ticket.userVerified && (
            <div className="callout warn" style={{ marginTop: 10, fontSize: 12 }}>
              用户 ID {ticket.userId} 未通过后端用户表校验；支付方式、跨域处置和升级会话均已关闭。
            </div>
          )}
          {ticket.slaTarget && (
            <div className="dim2" data-proof="support-ticket-sla" style={{ marginTop: 10, fontSize: 12 }}>
              SLA v{ticket.slaTarget.ruleVersion}：首响目标 {new Date(ticket.slaTarget.firstResponseDeadlineAt).toLocaleString()}
              {ticket.slaTarget.firstResponseOverdue ? " · 已逾期" : " · 未逾期"}
              {" · "}解决目标 {new Date(ticket.slaTarget.resolutionDeadlineAt).toLocaleString()}
              {ticket.slaTarget.resolutionOverdue ? " · 已逾期" : " · 未逾期"}
              {" · "}队列 {ticket.slaTarget.queue} · 升级 {ticket.slaTarget.escalation}
            </div>
          )}
        </div>

        <div className="ChatBody">
          <MessageThread messages={thread} relWhen={relWhen} />
        </div>

        {canWrite && !ticket.archived && (
          <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", background: "var(--panel-2)" }}>
            <div className="dim2" style={{ fontSize: 11.5, marginBottom: 7 }}>
              内部备注仅客服可见，不会作为回复发送给用户
            </div>
            <textarea
              className="ta"
              data-proof="support-ticket-internal-note"
              rows={2}
              maxLength={2000}
              placeholder="记录内部核查、交接或 SLA 处置"
              value={internalNoteBody}
              onChange={(e) => onInternalNoteChange(e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
              <button
                type="button"
                data-proof="support-ticket-internal-note-save"
                className="btn btn-sec btn-sm"
                disabled={!internalNoteBody.trim()}
                onClick={() => onInternalNote(internalNoteBody)}
              >
                保存内部备注
              </button>
            </div>
          </div>
        )}

        {canWrite && ticket.status !== "closed" && !ticket.archived && (
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

function CreateTicketModal({
  categoryOptions,
  ownerOptions,
  submitting,
  onClose,
  onSave,
}: {
  categoryOptions: Array<{ value: SupportTicketCategory; label: string }>;
  ownerOptions: string[];
  submitting: boolean;
  onClose: () => void;
  onSave: (form: CreateTicketForm) => void;
}) {
  const firstOwner = ownerOptions[0] ?? "";
  const [userId, setUserId] = useState("");
  const [category, setCategory] = useState<SupportTicketCategory>(categoryOptions[0]?.value ?? "account");
  const [priority, setPriority] = useState<SupportTicketPriority>("normal");
  const [owner, setOwner] = useState(firstOwner);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  return (
    <Modal
      title="新建客服工单"
      icon="doc"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="dim2" style={{ fontSize: 11.5 }}>负责人来自客服坐席名册;新建会自动留档,无需填写理由</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn btn-sec btn-sm" disabled={submitting} onClick={onClose}>取消</button>
          <button
            type="button"
            data-proof="support-ticket-create-save"
            className="btn btn-pri btn-sm"
            disabled={submitting || !owner || !title.trim() || !body.trim()}
            onClick={() => onSave({ userId, category, priority, owner, title, body })}
          >
            {submitting ? "保存中…" : "保存工单"}
          </button>
        </>
      }
    >
      <div className="grid g-3" style={{ gap: 12, marginBottom: 12 }}>
        <label className="field">
          <label>分类</label>
          <select className="fld" value={category} onChange={(e) => setCategory(e.target.value as SupportTicketCategory)}>
            {categoryOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="field">
          <label>优先级</label>
          <select className="fld" value={priority} onChange={(e) => setPriority(e.target.value as SupportTicketPriority)}>
            {PRIORITY_LIST.map((item) => <option key={item} value={item}>{PRIO_CN[item]}</option>)}
          </select>
        </label>
        <label className="field">
          <label>负责人</label>
          <select className="fld" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {ownerOptions.map((item) => <option key={item} value={item}>{ownerLabel(item)}</option>)}
          </select>
        </label>
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        <label className="field">
          <label>用户 ID(可选)</label>
          <input className="fld" inputMode="numeric" value={userId} onChange={(e) => setUserId(e.target.value)} placeholder="关联真实用户后才可升级即时会话" />
        </label>
        <label className="field">
          <label>标题</label>
          <input className="fld" data-proof="support-ticket-create-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例:提现审核进度咨询" />
        </label>
        <label className="field">
          <label>问题描述</label>
          <textarea className="fld" data-proof="support-ticket-create-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} placeholder="写清用户诉求、截图/订单号/交易号等关键信息" style={{ resize: "vertical" }} />
        </label>
      </div>
    </Modal>
  );
}
