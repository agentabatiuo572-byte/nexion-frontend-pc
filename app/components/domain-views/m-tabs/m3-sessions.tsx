"use client";

/**
 * M3 即时会话台 — 收件箱三栏(列表 + 富气泡对话 + 客户档案)(helpdesk 设计稿布局,由 I9 迁出)。
 * 会话 / 工单读写走后端 content 接口;I.session.* / I.support.* 为 M 容器传入的视图适配键。
 * I.session.ui.lastConvo 仅保留为坐席续聊 UI 态。
 * 例行坐席操作(回复/转交/改状态/推送/归档/标签/备注)直接执行 + 自动 A2 审计;
 * 主动发起会话(人群投放) / 转工单 走操作确认 + 理由。续聊恢复后刷新仍回上次会话。
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon, MessageThread, type ThreadMessage } from "../design-kit";
import {
  STANDBY_POOL_LABEL,
  TRANSFER_TIMEOUT_MINS,
  USER_ACK_POOL,
  transferTargetLabel,
  type AdvisorScript,
  type CustomerNote,
  type CustomerProfile,
  type InitiateIdentity,
  type SegField,
  type SessionConvo,
  type SessionMsg,
  type SessionReplyTpl,
  type SessionStatus,
  type SessionTransfer,
  type SupportTicket,
} from "./data";
import { ConvStat, Empty, MAvatar, ownerLabel, relWhen } from "./hd-ui";
import { InitiateModal, QuickActionModal, ReturnModal, TransferModal, type InitiatePayload, type ReturnPayload, type TransferPayload } from "./m3-modals";
import type { MCtx } from "./types";
import { fetchMSupportWorkbenchSkus, type MSupportAgent } from "@/lib/admin/m-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const CONVO_KEY = "I.session.convos";
const TICKET_KEY = "I.support.tickets";
const SCRIPT_LIST_KEY = "I.session.scripts";
const REPLY_TEMPLATE_LIST_KEY = "I.session.replyTemplates";
const AGENT_LIST_KEY = "I.support.agents";
const TRANSFER_TARGETS_KEY = "I.session.transferTargets";
const AUDIENCE_OPTIONS_KEY = "I.session.audienceOptions";
const SEGMENT_FIELDS_KEY = "I.session.segmentFields";
const LAST_CONVO_KEY = "I.session.ui.lastConvo";
const FALLBACK_KEY = "I.session.workbench.timeoutFallback"; // 工作台「转入待处理超时回落备勤池」开关("on"=启用)
const INBOX_PAGE_SIZE = 8; // 会话收件箱每页条数(翻页器)

type PushSku = { id: string; title: string; subtitle: string; to: string };
type PushSkuSource = OpsSku;

type ConvSeg = "all" | "unread" | "incoming" | "active" | "resolved" | "archived";
const SEGS: Array<[ConvSeg, string]> = [
  ["all", "全部"],
  ["unread", "未读"],
  ["incoming", "转入待处理"],
  ["active", "进行中"],
  ["resolved", "已解决"],
  ["archived", "归档"],
];

// 「转入待处理」已等待时长(运营可读,不带「前」字)。
function waitedFor(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "不到 1 分钟";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时`;
  return `${Math.floor(diff / 86_400_000)} 天`;
}
function isTransferOverdue(t: SessionTransfer): boolean {
  return Date.now() - t.ts > TRANSFER_TIMEOUT_MINS * 60_000;
}

function parseParamArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}
function textOf(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}
function cloneConvos(rows: SessionConvo[]): SessionConvo[] {
  return rows.map((c) => ({ ...c, messages: c.messages.map((m) => ({ ...m })) }));
}
function cloneTickets(rows: SupportTicket[]): SupportTicket[] {
  return rows.map((t) => ({ ...t, messages: t.messages.map((m) => ({ ...m })) }));
}
function statusLabel(status: SessionStatus): string {
  return status === "open" ? "进行中" : status === "resolved" ? "已解决" : "已关闭";
}
function nextTicketId(rows: SupportTicket[]): string {
  const max = rows.reduce((acc, row) => {
    const n = Number(row.id.replace(/^TK-/, ""));
    return Number.isFinite(n) ? Math.max(acc, n) : acc;
  }, 1024);
  return `TK-${max + 1}`;
}
const HREF_CN: Record<string, string> = { "/store": "商城", "/staking": "锁仓", "/genesis": "创世节点" };
function hrefLabel(href: string): string {
  return HREF_CN[href] ?? href;
}
function toPushSku(sku: PushSkuSource): PushSku {
  const subtitle = [sku.tier, sku.tagline, sku.gpu || sku.vram].filter(Boolean).slice(0, 2).join(" · ");
  return {
    id: sku.id || sku.name,
    title: sku.name || sku.id || "未命名 SKU",
    subtitle: subtitle || "客服工作台商品",
    to: "/store",
  };
}

export function M3Sessions({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;

  const convos = useMemo(() => cloneConvos(parseParamArray<SessionConvo>(pget(CONVO_KEY), [])), [ctx.params, pget]);
  const advisorScripts = useMemo(() => parseParamArray<AdvisorScript>(pget(SCRIPT_LIST_KEY), []), [ctx.params, pget]);
  const replyTemplates = useMemo(() => parseParamArray<SessionReplyTpl>(pget(REPLY_TEMPLATE_LIST_KEY), []), [ctx.params, pget]);
  const supportAgents = useMemo(() => parseParamArray<MSupportAgent>(pget(AGENT_LIST_KEY), []), [ctx.params, pget]);
  const transferTargets = useMemo(() => parseParamArray<Record<string, unknown>>(pget(TRANSFER_TARGETS_KEY), []), [ctx.params, pget]);
  // 发起身份:锁定当前登录客服的坐席身份(adminId 匹配)。登录者是坐席 → 只能以自己身份发起;
  // 登录者无坐席记录(如 superadmin 主管) → fallback 列全部启用坐席,支持代发。
  const currentAdminId = useAdminAuth((s) => s.session?.adminId);
  const initiateIdentities = useMemo<InitiateIdentity[]>(() => {
    const enabled = supportAgents.filter((agent) => agent.enabled);
    const mine = enabled.filter((agent) => agent.adminId === currentAdminId);
    const source = mine.length > 0 ? mine : enabled;
    return source.flatMap((agent) =>
      agent.serviceTypes.map((type) => ({
        id: `${agent.id}:${type}`,
        name: agent.name,
        type,
        label: type === "advisor" ? "专属客服" : "普通客服",
      })),
    );
  }, [supportAgents, currentAdminId]);
  const transferAgents = useMemo(
    () => supportAgents.filter((agent) => agent.enabled && agent.transferable && !agent.busy).map((agent) => ({ id: agent.id, name: agent.name, position: agent.position })),
    [supportAgents],
  );
  const transferQueues = useMemo(() => {
    const rows = transferTargets
      .filter((target) => textOf(target.targetType).toLowerCase() === "queue")
      .map((target) => textOf(target.targetName || target.targetId).trim())
      .filter(Boolean);
    return Array.from(new Set(rows));
  }, [transferTargets]);
  const audiencePresets = useMemo(() => {
    const rows = parseParamArray<string>(pget(AUDIENCE_OPTIONS_KEY), []);
    return rows;
  }, [ctx.params, pget]);
  const segmentFields = useMemo(() => {
    const rows = parseParamArray<SegField>(pget(SEGMENT_FIELDS_KEY), []);
    return rows;
  }, [ctx.params, pget]);
  const initiateCustomers = useMemo(() => {
    const rows = new Map<string, CustomerProfile>();
    convos.forEach((convo) => {
      const profile = convo.profile;
      if (profile?.uid && !rows.has(profile.uid)) rows.set(profile.uid, profile);
    });
    return Array.from(rows.values());
  }, [convos]);

  const [seg, setSeg] = useState<ConvSeg>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(() => pget(LAST_CONVO_KEY) ?? convos[0]?.id ?? "cv-advisor-1");
  const [replyBody, setReplyBody] = useState("");
  const [quick, setQuick] = useState<"history" | "tickets" | "resetpw" | "account" | "note" | null>(null);
  const [showInitiate, setShowInitiate] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false); // 转交弹窗
  const [showReturn, setShowReturn] = useState(false);     // 手动退回弹窗
  const [profilePeek, setProfilePeek] = useState(false); // 窄屏右栏抽屉开关
  const openFullProfile = () => {
    setProfilePeek(true);
    toast("客户信息已在右侧客服档案面板展示");
  };
  const [pushSkus, setPushSkus] = useState<PushSku[]>([]);
  const [pushSkuLoading, setPushSkuLoading] = useState(true);
  const [pushSkuError, setPushSkuError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setPushSkuLoading(true);
    fetchMSupportWorkbenchSkus()
      .then((skus) => {
        if (!active) return;
        setPushSkus(skus.filter((sku) => sku.status !== "off").map(toPushSku));
        setPushSkuError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setPushSkus([]);
        setPushSkuError(error instanceof Error ? error.message : "E1_SKU_LOAD_FAILED");
      })
      .finally(() => {
        if (active) setPushSkuLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // 坐席回复后的 typing/ack 仅用于高保真瞬态效果；已读事实只消费后端 receiptStatus。
  const [echo, setEcho] = useState<{ cid: string; typing: boolean; ackTs?: number; ackText?: string }>({ cid: "", typing: false });
  const echoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearEchoTimers = () => {
    echoTimers.current.forEach(clearTimeout);
    echoTimers.current = [];
  };
  useEffect(() => () => clearEchoTimers(), []);

  // 续聊恢复:hydrate 后一次性恢复上次会话;手动选过即锁(restoredRef)。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    const last = pget(LAST_CONVO_KEY);
    if (last && convos.some((c) => c.id === last)) {
      restoredRef.current = true;
      setSelectedId(last);
    }
  }, [pget, convos]);

  const selected = convos.find((c) => c.id === selectedId) ?? convos[0] ?? null;
  const ownerName = selected?.owner ?? "Unassigned";

  const selectConvo = (id: string) => {
    restoredRef.current = true;
    setSelectedId(id);
    setReplyBody("");
    clearEchoTimers();
    setEcho({ cid: "", typing: false }); // 换会话不带上一条的模拟回执
    setParam(LAST_CONVO_KEY, id, { action: "记录坐席当前会话", reason: "ui-state" });
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return convos
      .filter((c) => (seg === "archived" ? c.archived === true : !c.archived))
      .filter((c) => {
        if (seg === "unread") return c.unread > 0;
        if (seg === "incoming") return c.transfer != null;
        if (seg === "active") return c.status === "open";
        if (seg === "resolved") return c.status === "resolved";
        return true;
      })
      .filter((c) => {
        if (!q) return true;
        const typeLab = c.type === "advisor" ? "顾问 advisor" : "客服 support";
        return [c.id, c.agentName, c.owner, c.customer ?? "", c.profile?.nickname ?? "", typeLab].some((t) => t.toLowerCase().includes(q));
      })
      .sort((a, b) => b.lastTs - a.lastTs);
  }, [convos, query, seg]);

  const resolvedOpen = convos.filter((c) => c.status === "resolved" && !c.archived).length;

  // 收件箱分类计数(待处理数量:未读 / 转入待处理 等),独立于搜索词。
  const segCounts = useMemo(() => {
    const live = convos.filter((c) => !c.archived);
    return {
      all: live.length,
      unread: live.filter((c) => c.unread > 0).length,
      incoming: live.filter((c) => c.transfer != null).length,
      active: live.filter((c) => c.status === "open").length,
      resolved: live.filter((c) => c.status === "resolved").length,
      archived: convos.filter((c) => c.archived).length,
    } as Record<ConvSeg, number>;
  }, [convos]);

  // 翻页器:filtered 分页;切换分类/搜索回第 1 页。
  const pageCount = Math.max(1, Math.ceil(filtered.length / INBOX_PAGE_SIZE));
  const curPage = Math.min(page, pageCount);
  useEffect(() => {
    setPage(1);
  }, [seg, query]);
  const pageStart = (curPage - 1) * INBOX_PAGE_SIZE;
  const paged = filtered.slice(pageStart, pageStart + INBOX_PAGE_SIZE);

  const writeConvos = (next: SessionConvo[], reason: string, action: string) => setParam(CONVO_KEY, JSON.stringify(next), { action, reason });
  const updateConvo = (id: string, updater: (c: SessionConvo) => SessionConvo, reason: string, action: string) =>
    writeConvos(convos.map((c) => (c.id === id ? updater(c) : c)), reason, action);

  // ── 转入待处理:工作台「超时回落备勤池」策略由后端定时任务执行;前端只保存策略与展示状态──
  const fallbackOn = pget(FALLBACK_KEY) === "on";
  const setFallback = (on: boolean) => setParam(FALLBACK_KEY, on ? "on" : "off", { action: "工作台·转入待处理超时回落备勤池开关", reason: "调整 M3 会话转入待处理超时回落策略" });

  const sendReply = () => {
    if (!selected) return;
    if (!replyBody.trim()) {
      toast("回复需要正文");
      return;
    }
    const now = Date.now();
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        unread: 0,
        lastTs: now,
        status: c.status === "resolved" ? "open" : c.status,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: c.owner === "Unassigned" ? "客服台" : c.owner, status: "sent", text: replyBody.trim() }],
      }),
      "坐席回复(正文已留档)",
      `坐席回复会话 ${selected.id} · admin.conversation_replied`,
    );
    setReplyBody("");
    toast(`${selected.id} 已回复`);
    startEcho(selected.id);
  };

  // 把某会话最后一条坐席实质消息标记为「已读」并落库:读最新持久值避免 stale;已是已读则跳过;
  // reason=ui-state → 不进 A2 高敏审计。落库后切走切回 / 刷新回执都不倒退。
  // 高保真预览只模拟「正在输入 → 短回执」瞬态；已读状态只能消费后端真实 receiptStatus，禁止后台伪造用户已读。
  const startEcho = (cid: string) => {
    if (process.env.NEXT_PUBLIC_ENABLE_SUPPORT_ECHO_PREVIEW !== "true") return;
    clearEchoTimers();
    setEcho({ cid, typing: false });
    echoTimers.current.push(setTimeout(() => setEcho((e) => (e.cid === cid ? { ...e, typing: true } : e)), 1500));
    echoTimers.current.push(
      setTimeout(() => {
        const ackText = USER_ACK_POOL[Math.floor((Date.now() / 1000) % USER_ACK_POOL.length)];
        setEcho((e) => (e.cid === cid ? { ...e, typing: false, ackTs: Date.now(), ackText } : e));
      }, 3600),
    );
  };

  // ── 跨坐席转交处置(全程例行内部交接:不弹 MC、不调 logAudit;转交/退回原因记入会话系统消息)──
  const runTransfer = (p: TransferPayload) => {
    if (!selected) return;
    const now = Date.now();
    const fromOwner = selected.owner === "Unassigned" ? "客服台" : selected.owner;
    const toLabel = transferTargetLabel(p.to);
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        owner: toLabel,
        lastTs: now,
        transfer: { from: fromOwner, to: p.to, reason: p.reason, ts: now },
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `${fromOwner} 转交给 ${toLabel} · 原因:${p.reason}` }],
      }),
      "跨坐席转交(例行,自动留档 · 不触发审计弹窗)",
      `会话转交 ${selected.id} → ${toLabel} · admin.conversation_transfer`,
    );
    setShowTransfer(false);
    toast(`${selected.id} 已转交 ${toLabel} · 转入待处理`);
  };
  const acceptTransfer = () => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    const newOwner = t.to.kind === "agent" ? t.to.name : selected.owner !== "Unassigned" ? selected.owner : transferTargetLabel(t.to);
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        transfer: undefined,
        owner: newOwner,
        status: "open",
        unread: 0,
        lastTs: now,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `${newOwner} 接收接入 · 开始接待(来自 ${t.from})` }],
      }),
      "接收转入会话(例行,自动留档)",
      `会话接收接入 ${selected.id} · admin.conversation_transfer_accept`,
    );
    toast(`${selected.id} 已接入 · ${newOwner} 接待`);
  };
  const waitTransfer = () => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        lastTs: now,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `保持转入待处理 · 继续等待 ${transferTargetLabel(t.to)} 接入(来自 ${t.from})` }],
      }),
      "转入待处理继续等待(例行,自动留档)",
      `会话等待处理 ${selected.id} · admin.conversation_transfer_wait`,
    );
    toast(`${selected.id} 保持转入待处理 · 继续等待接入`);
  };
  const runReturn = (p: ReturnPayload) => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    const back = p.target === "from" ? t.from : STANDBY_POOL_LABEL;
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        transfer: undefined,
        owner: back,
        lastTs: now,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `已退回${p.target === "from" ? `原坐席 ${back}` : back} · 退回原因:${p.reason}` }],
      }),
      "退回转入会话(例行,自动留档 · 原因入会话消息)",
      `会话退回 ${selected.id} → ${back} · admin.conversation_transfer_return`,
    );
    setShowReturn(false);
    toast(`${selected.id} 已退回 ${back}`);
  };
  const setStatusDirect = (id: string, status: SessionStatus) => {
    updateConvo(id, (c) => ({ ...c, status, lastTs: Date.now() }), `会话状态「${statusLabel(status)}」(例行,自动留档)`, `会话状态 ${id} · admin.conversation_status`);
    toast(`${id} → ${statusLabel(status)}`);
  };

  const runInitiate = (p: InitiatePayload) => {
    const now = Date.now();
    const existing = cloneConvos(parseParamArray<SessionConvo>(pget(CONVO_KEY), []));
    const cid = `cv-out-${now}`;
    const opening: SessionMsg = { ts: now, sender: "agent", agentName: p.identity.name, status: "sent", text: p.text };
    if (p.identity.type === "advisor" && p.ctaHref && p.ctaHref !== "—" && p.ctaHref !== "") opening.ctaHref = p.ctaHref;
    const newConvo: SessionConvo = {
      id: cid,
      type: p.identity.type,
      agentName: p.identity.name,
      roleKey: p.identity.type === "advisor" ? "conversations.roleAdvisor" : "conversations.roleSupport",
      unread: 0,
      lastTs: now,
      status: "open",
      owner: p.identity.name,
      customer: p.profile?.nickname ?? p.targetLabel,
      origin: p.identity.type === "advisor" ? "advisor" : "support",
      profile: p.profile, // 单用户 → 选中的真实客户档案;人群群发 → undefined(走 batchInfo)
      batchInfo: p.isSegment ? { audienceDesc: p.targetDesc, identity: `${p.identity.label} · ${p.identity.name}`, script: p.text } : undefined,
      messages: [
        { ts: now, sender: "agent", agentName: "系统", text: `由「${p.identity.label} · ${p.identity.id}」主动发起 · 目标:${p.targetDesc}${p.reason ? ` · 理由:${p.reason}` : ""}` },
        opening,
      ],
    };
    writeConvos([...existing, newConvo], p.reason ? "主动发起会话(人群投放 · 理由已留档)" : "主动发起会话(单用户 · 例行)", `主动发起会话 ${cid} · admin.conversation_initiated`);
    setShowInitiate(false);
    selectConvo(cid);
    if (!p.isSegment) startEcho(cid); // 单客户主动会话:开场白同享回执;人群群发无单一读者,不模拟已读
    toast(`已以「${p.identity.label}」向 ${p.targetLabel} 发起会话`);
  };

  const convertToTicket = () => {
    if (!selected) return;
    const convo = selected;
    openActionConfirm({
      action: <>转工单 · {convo.id}</>,
      detail: (
        <>
          把会话 <b>{convo.agentName}</b>(<span className="mono">{convo.id}</span>)转为可追踪工单,进入 SLA 队列与 D2/C4/E5 升级路径;工单写入 <span className="mono">I.support.tickets</span>。适用于需要跨班次跟进的提现 / KYC / 设备问题。
        </>
      ),
      amplifies: false,
      run: (reason: string) => {
        const now = Date.now();
        const existingTickets = cloneTickets(parseParamArray<SupportTicket>(pget(TICKET_KEY), []));
        const id = nextTicketId(existingTickets);
        const newTicket: SupportTicket = {
          id,
          subject: `由会话 ${convo.id} 转入 · ${convo.agentName}`,
          category: "account",
          status: "open",
          priority: "normal",
          createdAt: now,
          updatedAt: now,
          lastReplyAt: now,
          unread: 0,
          owner: convo.owner === "Unassigned" ? "Unassigned" : convo.owner,
          messages: convo.messages.map((m) => ({ ts: m.ts, author: m.sender, agentName: m.agentName, body: m.text })),
        };
        setParam(TICKET_KEY, JSON.stringify([newTicket, ...existingTickets]), { action: `会话转工单 ${convo.id} → ${id} · admin.support_ticket_from_conversation`, reason });
        toast(`${convo.id} 已转工单 ${id}`);
      },
    });
  };

  const pushSku = (sku: PushSku) => {
    if (!selected) return;
    const now = Date.now();
    const text = `帮你整理了一份「${sku.title}」详情(${sku.subtitle}),方便对照看看:`;
    updateConvo(
      selected.id,
      (c) => ({
        ...c,
        unread: 0,
        lastTs: now,
        status: c.status === "resolved" ? "open" : c.status,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: c.owner === "Unassigned" ? "客服台" : c.owner, status: "sent", text, ctaHref: sku.to }],
      }),
      "坐席推送商品卡(正文已留档)",
      `坐席推送商品卡 ${sku.id} → ${selected.id} · admin.conversation_sku_pushed`,
    );
    toast(`已推送「${sku.title}」`);
    startEcho(selected.id); // 推送卡 = 坐席→客户消息,与文字回复同享已读 / 输入中回执
  };

  const archiveConvo = (id: string, on: boolean) => {
    updateConvo(id, (c) => ({ ...c, archived: on }), on ? "会话归档(例行)" : "撤销归档(例行)", `${on ? "会话归档" : "撤销归档"} ${id} · admin.conversation_archive`);
    toast(on ? `${id} 已归档` : `${id} 已撤销归档`);
  };
  const archiveAllResolved = () => {
    const targets = convos.filter((c) => c.status === "resolved" && !c.archived);
    if (targets.length === 0) {
      toast("没有可归档的已解决会话");
      return;
    }
    const ids = new Set(targets.map((c) => c.id));
    writeConvos(convos.map((c) => (ids.has(c.id) ? { ...c, archived: true } : c)), "批量归档已解决会话(例行)", `批量归档已解决会话 ${targets.length} 个 · admin.conversation_archive_batch`);
    toast(`已批量归档 ${targets.length} 个已解决会话`);
  };

  const addNote = (text: string) => {
    if (!selected?.profile || !text.trim()) return;
    ctx.addCustomerNote(selected.id, text.trim());
    toast("客户备注已保存");
  };
  const removeNote = (noteId: string) => {
    if (!selected?.profile) return;
    ctx.removeCustomerNote(selected.id, noteId);
    toast("客户备注已删除");
  };
  const addCustomerTag = (tag: string) => {
    if (!selected?.profile || !tag.trim()) return;
    const t = tag.trim();
    if (selected.profile.customTags.includes(t)) return;
    ctx.addCustomerTag(selected.id, t);
    toast(`已加标签「${t}」`);
  };
  const removeCustomerTag = (tag: string) => {
    if (!selected?.profile) return;
    ctx.removeCustomerTag(selected.id, tag);
  };
  // QuickAction 账户类:客服侧只发起 + 提示,真实处置回 C/D 域;按主人指令 QuickAction 不写审计。
  const runAccountAction = (label: string) => {
    if (!selected?.profile) return;
    toast(`已发起「${label}」· 交 C/D 域复核`);
    setQuick(null);
  };

  const echoOnThis = echo.cid === selected?.id;
  // 最后一条坐席实质消息(排除系统消息)→ 唯一显示回执处(镜像前端 iMessage 惯例)。
  const lastAgentIdx = (() => {
    const msgs = selected?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].sender === "agent" && msgs[i].agentName !== "系统") return i;
    }
    return -1;
  })();
  const baseThread: ThreadMessage[] = (selected?.messages ?? []).map((m, i) => {
    const isAgent = m.sender === "agent";
    const isSystem = isAgent && m.agentName === "系统";
    const role: "support" | "advisor" | "user" = isAgent ? (selected!.type === "advisor" ? "advisor" : "support") : "user";
    const cta = !isSystem && m.ctaHref && m.ctaHref !== "—"
      ? { kind: "link" as const, label: `打开 ${hrefLabel(m.ctaHref)}`, onClick: () => toast(`已在用户端打开「${hrefLabel(m.ctaHref!)}」`) }
      : undefined;
    const receipt = i === lastAgentIdx ? (m.status === "read" ? "已读" : "未读") : undefined;
    return {
      ts: m.ts,
      fromAgent: isAgent,
      system: isSystem,
      role,
      agentName: m.agentName,
      senderName: isAgent ? m.agentName : selected?.profile?.nickname ?? selected?.customer ?? "用户",
      vlevel: !isAgent ? selected?.profile?.vlevel : undefined,
      body: m.text,
      cta,
      receipt,
    };
  });
  // 追加模拟用户短回执(瞬态,回执到达后坐席那条自然显「已读」)。
  const threadMessages: ThreadMessage[] = echoOnThis && echo.ackTs && echo.ackText
    ? [
        ...baseThread,
        {
          ts: echo.ackTs,
          fromAgent: false,
          role: "user" as const,
          senderName: selected?.profile?.nickname ?? selected?.customer ?? "用户",
          vlevel: selected?.profile?.vlevel,
          body: echo.ackText,
        },
      ]
    : baseThread;

  return (
    <div className="m3-stage">
      {/* 左:会话收件箱 */}
      <div className="m3-col-list">
        <div style={{ padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500 }}>会话收件箱</h2>
            <span className="mono dim2" style={{ fontSize: 11.5 }}>{filtered.length}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
              {resolvedOpen > 0 && (
                <button type="button" data-proof="session-archive-batch" className="btn btn-sec btn-sm" title={`归档已解决 ${resolvedOpen} 个`} onClick={archiveAllResolved}>
                  <Icon name="box" size={16} />
                  {resolvedOpen}
                </button>
              )}
              <button type="button" data-proof="session-initiate" className="btn btn-pri btn-sm" onClick={() => setShowInitiate(true)}>
                <Icon name="plus" size={16} />
                主动发起会话
              </button>
            </div>
          </div>
          <div className="inp">
            <Icon name="search" size={15} />
            <input data-proof="session-search" placeholder="搜索用户 / 会话号 / 坐席 / 类别" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="seg" style={{ flexWrap: "wrap" }}>
            {SEGS.map(([k, lab]) => (
              <button key={k} className={seg === k ? "on" : ""} onClick={() => setSeg(k)}>
                {lab}
                {segCounts[k] > 0 && <span className="seg-n">{segCounts[k]}</span>}
              </button>
            ))}
          </div>
          <div className="m3-fallback-bar">
            <span className="m3-fallback-lab"><Icon name="clock" size={13} />转入超时回落备勤池</span>
            <span className="dim2" style={{ fontSize: 11, marginLeft: "auto", marginRight: 8 }}>{fallbackOn ? "超时自动回落" : "关 · 持续等待"}</span>
            <button type="button" data-proof="session-transfer-fallback" className={`sw${fallbackOn ? " on" : ""}`} role="switch" aria-checked={fallbackOn} title="转入待处理超时是否自动回落备勤池重新分配" onClick={() => setFallback(!fallbackOn)} />
          </div>
        </div>
        <div className="cv-list">
          {paged.map((c) => {
            const on = selected?.id === c.id;
            const lastMsg = c.messages[c.messages.length - 1];
            const active = c.status === "open";
            const name = c.profile?.nickname ?? c.customer ?? c.agentName;
            const origin = c.origin ?? "user";
            const originLabel = origin === "advisor" ? "顾问发起" : origin === "support" ? "客服发起" : "用户发起";
            return (
              <button key={c.id} type="button" className={`cv-item${on ? " on" : ""}${c.unread ? " unread" : ""}`} onClick={() => selectConvo(c.id)}>
                <div className="cv-r1">
                  <MAvatar name={name} size="sm" live={active} />
                  <span className="cv-name">{name}</span>
                  {c.profile && <span className="msg-vlevel">{c.profile.vlevel}</span>}
                  <span className="cv-sp" />
                  {c.unread > 0 && <span className="cv-unread">{c.unread}</span>}
                  <span className="cv-time" suppressHydrationWarning>{relWhen(c.lastTs)}</span>
                </div>
                <div className="cv-prev">
                  {lastMsg && lastMsg.sender === "agent" ? "我:" : ""}
                  {lastMsg ? lastMsg.text : ""}
                </div>
                <div className="cv-meta">
                  {c.transfer ? (
                    <>
                      <span className="cv-stat" style={{ color: "var(--m-wait)" }}>
                        <Icon name="arrow" size={11} />
                        转入待处理
                      </span>
                      <span className="cv-tag">· 来自 {ownerLabel(c.transfer.from)}</span>
                      {c.transfer.fellBack ? (
                        <span className="cv-tag" style={{ color: "var(--ink-4)" }}>· 已回落备勤池</span>
                      ) : isTransferOverdue(c.transfer) ? (
                        <span className="cv-tag" style={{ color: "var(--m-high)" }}>· 已超时</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className={`cv-stat ${active ? "active" : "resolved"}`}>
                        {active && <span className="live" />}
                        {active ? "进行中" : "已解决"}
                      </span>
                      <span className={`cv-origin ${origin}`}>
                        <Icon name={origin === "user" ? "users" : "arrow"} size={11} />
                        {originLabel}
                      </span>
                      <span className="cv-tag">· 接待 {ownerLabel(c.owner)}</span>
                    </>
                  )}
                  {c.archived && <span className="cv-archived-tag"><Icon name="box" size={12} />已归档</span>}
                  {c.status === "resolved" && !c.archived && (
                    <span className="cv-arch" role="button" data-proof="session-archive" title="归档此会话" onClick={(e) => { e.stopPropagation(); archiveConvo(c.id, true); }}>
                      <Icon name="box" size={15} />
                    </span>
                  )}
                  {c.archived && (
                    <span className="cv-arch" role="button" data-proof="session-unarchive" title="撤销归档" onClick={(e) => { e.stopPropagation(); archiveConvo(c.id, false); }}>
                      <Icon name="arrow" size={15} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {!filtered.length && <Empty icon="search">没有匹配的会话</Empty>}
        </div>
        {filtered.length > 0 && (
          <div className="m3-pager" data-list-pager="true">
            <span className="dim2" style={{ fontSize: 11.5 }}>{pageStart + 1}–{Math.min(pageStart + INBOX_PAGE_SIZE, filtered.length)} / {filtered.length}</span>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
              <button type="button" className="btn btn-sec btn-sm btn-icon" disabled={curPage <= 1} title="上一页" onClick={() => setPage(curPage - 1)}>
                <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevron" size={15} /></span>
              </button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button key={p} type="button" className={`tk-pageno${p === curPage ? " on" : ""}`} onClick={() => setPage(p)}>
                  {p}
                </button>
              ))}
              <button type="button" className="btn btn-sec btn-sm btn-icon" disabled={curPage >= pageCount} title="下一页" onClick={() => setPage(curPage + 1)}>
                <Icon name="chevron" size={15} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 中:对话面板 */}
      {selected ? (
        <div className="m3-col-chat">
          <ChatHeader
            convo={selected}
            onTransfer={() => setShowTransfer(true)}
            onStatus={(s) => setStatusDirect(selected.id, s)}
            onToTicket={convertToTicket}
            onToggleProfile={() => setProfilePeek((v) => !v)}
          />
          {selected.transfer && (
            <TransferBanner transfer={selected.transfer} onAccept={acceptTransfer} onWait={waitTransfer} onReturn={() => setShowReturn(true)} />
          )}
          <div className="ChatBody">
            <MessageThread messages={threadMessages} relWhen={relWhen} resetKey={selected.id} agentName={ownerLabel(selected.owner)} agentAvatar={selected.owner !== "Unassigned" ? <MAvatar name={selected.owner} size="sm" /> : undefined} handlerRole={selected.type === "advisor" ? "顾问" : "客服"} typing={echoOnThis && echo.typing} typingLabel="用户正在输入…" />
          </div>
          {selected.transfer ? (
            <div className="m3-xfer-lock">
              <Icon name="lock" size={15} />
              <span>会话处于转入待处理 · 请先「接收接入」再回复,或「手动退回」</span>
            </div>
          ) : (
            <ChatComposer
              convo={selected}
              replyBody={replyBody}
              onReplyChange={setReplyBody}
              onSend={sendReply}
              onPushSku={pushSku}
              pushSkus={pushSkus}
              pushSkuLoading={pushSkuLoading}
              pushSkuError={pushSkuError}
              advisorScripts={advisorScripts}
              replyTemplates={replyTemplates}
            />
          )}
        </div>
      ) : (
        <div className="m3-col-chat">
          <Empty icon="users">从左侧选择一个会话开始接待</Empty>
        </div>
      )}

      {/* 右:客户档案 */}
      <UserPanel
        convo={selected}
        open={profilePeek}
        onOpenProfile={openFullProfile}
        onQuick={(k) => setQuick(k)}
        onAddTag={addCustomerTag}
        onRemoveTag={removeCustomerTag}
      />

      {showInitiate && (
        <InitiateModal
          onClose={() => setShowInitiate(false)}
          onSend={runInitiate}
          identities={initiateIdentities}
          advisorScripts={advisorScripts}
          replyTemplates={replyTemplates}
          customers={initiateCustomers}
          audiencePresets={audiencePresets}
          segmentFields={segmentFields}
        />
      )}
      {showTransfer && selected && <TransferModal currentOwner={selected.owner} onClose={() => setShowTransfer(false)} onSubmit={runTransfer} agents={transferAgents} queues={transferQueues} />}
      {showReturn && selected?.transfer && <ReturnModal fromAgent={selected.transfer.from} onClose={() => setShowReturn(false)} onSubmit={runReturn} />}
      {quick && selected?.profile && (
        <QuickActionModal kind={quick} profile={selected.profile} onClose={() => setQuick(null)} onAddNote={addNote} onRemoveNote={removeNote} onAccount={runAccountAction} />
      )}
    </div>
  );
}

/* ---- 对话头 ---- */
function ChatHeader({
  convo,
  onTransfer,
  onStatus,
  onToTicket,
  onToggleProfile,
}: {
  convo: SessionConvo;
  onTransfer: () => void;
  onStatus: (s: SessionStatus) => void;
  onToTicket: () => void;
  onToggleProfile: () => void;
}) {
  const name = convo.profile?.nickname ?? convo.customer ?? convo.agentName;
  const active = convo.status === "open";
  const closed = convo.status === "closed" || convo.archived;
  const incoming = !!convo.transfer; // 转入待处理:常规动作收起,改由转交横幅处置
  return (
    <div style={{ padding: "13px 16px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 8 }}>
      <div style={{ minWidth: 140, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</span>
          {convo.profile && <span className="cvp-vchip" style={{ height: 18, padding: "0 6px", fontSize: 11 }}>{convo.profile.vlevel}</span>}
        </div>
        <div className="dim2" style={{ fontSize: 11.5, marginTop: 3, display: "flex", gap: 10, alignItems: "center" }}>
          {convo.profile && <span className="mono">{convo.profile.uid}</span>}
          <span>当前对话用户</span>
        </div>
      </div>
      {incoming ? (
        <span className="stat wait"><Icon name="arrow" size={13} />转入待处理</span>
      ) : (
        <>
          <ConvStat active={active} />
          {active && !closed && (
            <button type="button" data-proof="session-transfer" className="btn btn-sec btn-sm" onClick={onTransfer}>
              <Icon name="users" size={16} />
              转交
            </button>
          )}
          {!closed && (
            <button type="button" data-proof="session-status" className="btn btn-sec btn-sm" onClick={() => onStatus(active ? "resolved" : "open")}>
              <Icon name={active ? "check" : "arrow"} size={16} />
              {active ? "标记已解决" : "重新激活"}
            </button>
          )}
          {!closed && (
            <button type="button" data-proof="session-to-ticket" className="btn btn-cyan btn-sm" onClick={onToTicket}>
              <Icon name="doc" size={16} />
              转工单
            </button>
          )}
        </>
      )}
      <button type="button" className="btn btn-ghost btn-icon btn-sm" title="客户档案" onClick={onToggleProfile}>
        <Icon name="eye" size={16} />
      </button>
    </div>
  );
}

/* ---- 转入待处理横幅(目标坐席 B 侧处置:接收接入 / 等待处理 / 手动退回)---- */
function TransferBanner({ transfer, onAccept, onWait, onReturn }: { transfer: SessionTransfer; onAccept: () => void; onWait: () => void; onReturn: () => void }) {
  const toLabel = transferTargetLabel(transfer.to);
  const overdue = isTransferOverdue(transfer);
  return (
    <div className="m3-xfer-banner">
      <div className="m3-xfer-head">
        <span className="stat wait"><Icon name="arrow" size={13} />转入待处理</span>
        {transfer.fellBack ? (
          <span className="m3-xfer-flag fell"><Icon name="box" size={12} />已超时回落{STANDBY_POOL_LABEL}</span>
        ) : overdue ? (
          <span className="m3-xfer-flag over"><Icon name="clock" size={12} />已超时 · 等待 {waitedFor(transfer.ts)}</span>
        ) : (
          <span className="dim2" style={{ fontSize: 11.5 }}>已等待 {waitedFor(transfer.ts)}</span>
        )}
      </div>
      <div className="m3-xfer-meta">来自 <b>{ownerLabel(transfer.from)}</b> · 转交至 <b>{toLabel}</b></div>
      <div className="m3-xfer-reason">转交原因:{transfer.reason}</div>
      <div className="m3-xfer-acts">
        <button type="button" data-proof="session-transfer-accept" className="btn btn-pri btn-sm" onClick={onAccept}>
          <Icon name="check" size={15} />接收接入
        </button>
        <button type="button" data-proof="session-transfer-wait" className="btn btn-sec btn-sm" onClick={onWait}>
          <Icon name="clock" size={15} />等待处理
        </button>
        <button type="button" data-proof="session-transfer-return" className="btn btn-danger btn-sm" onClick={onReturn}>
          <Icon name="arrow" size={15} />手动退回
        </button>
      </div>
    </div>
  );
}

/* ---- 对话 Composer(快捷模板显内容 + 查看更多 + 推送 SKU(全员)+ 发送动效)---- */
function ChatComposer({
  convo,
  replyBody,
  onReplyChange,
  onSend,
  onPushSku,
  pushSkus,
  pushSkuLoading,
  pushSkuError,
  advisorScripts,
  replyTemplates,
}: {
  convo: SessionConvo;
  replyBody: string;
  onReplyChange: (v: string) => void;
  onSend: () => void;
  onPushSku: (sku: PushSku) => void;
  pushSkus: PushSku[];
  pushSkuLoading: boolean;
  pushSkuError: string | null;
  advisorScripts: AdvisorScript[];
  replyTemplates: SessionReplyTpl[];
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const isAdvisor = convo.type === "advisor";
  const quick: Array<{ id: string; group: string; text: string }> = isAdvisor
    ? advisorScripts.filter((s) => s.status === "published").map((s) => ({ id: s.id, group: s.group, text: s.text }))
    : replyTemplates.filter((t) => t.type === "support" && t.status === "published").map((t) => ({ id: t.id, group: "客服", text: t.text }));
  const fill = (text: string) => onReplyChange(replyBody ? `${replyBody} ${text}` : text);
  const doSend = () => {
    if (!replyBody.trim() || sending) return;
    setSending(true);
    onSend();
    setTimeout(() => setSending(false), 550);
  };
  return (
    <div className="ChatComposer">
      {pickOpen && <SkuPicker skus={pushSkus} loading={pushSkuLoading} error={pushSkuError} onClose={() => setPickOpen(false)} onPick={(sku) => { onPushSku(sku); setPickOpen(false); }} />}
      {tplOpen && <TemplatePicker title={isAdvisor ? "快捷话术回复" : "回复模板"} items={quick} onClose={() => setTplOpen(false)} onPick={(text) => { fill(text); setTplOpen(false); }} />}
      <div className="composer-tools">
        <button type="button" className={`composer-tool${tplOpen ? " on" : ""}`} aria-expanded={tplOpen} onClick={() => { setTplOpen((v) => !v); setPickOpen(false); }}>
          <Icon name="doc" size={15} />
          <span>{isAdvisor ? "快捷话术回复" : "回复模板"}</span>
          <span className="composer-tool-n">{quick.length}</span>
        </button>
        <button type="button" data-proof="session-push-sku" className={`composer-tool${pickOpen ? " on" : ""}`} aria-expanded={pickOpen} onClick={() => { setPickOpen((v) => !v); setTplOpen(false); }}>
          <Icon name="box" size={15} />
          <span>推送商品</span>
          <span className="composer-tool-n">{pushSkuLoading ? "..." : pushSkus.length}</span>
        </button>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
        <textarea
          className="ta"
          data-proof="session-reply"
          rows={2}
          placeholder="输入回复,⌘/Ctrl+Enter 发送"
          value={replyBody}
          onChange={(e) => onReplyChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSend();
          }}
        />
        <button type="button" data-proof="session-reply-save" className={`chat-send${sending ? " sending" : ""}`} disabled={!replyBody.trim()} onClick={doSend}>
          <Icon name="arrow" size={18} />
          发送
        </button>
      </div>
    </div>
  );
}

/* ---- 回复模板 / 话术「查看更多」popover —— 显全文,点选快速填入 ---- */
function TemplatePicker({ title, items, onClose, onPick }: { title: string; items: Array<{ id: string; group: string; text: string }>; onClose: () => void; onPick: (text: string) => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const ql = q.trim().toLowerCase();
  const list = ql ? items.filter((t) => (t.id + t.group + t.text).toLowerCase().includes(ql)) : items;
  return (
    <div ref={ref} className="sku-pop">
      <div className="sku-pop-h">
        <span>
          <Icon name="doc" size={16} />
          {title} · 选一条快速回复
        </span>
        <button type="button" className="sku-pop-close" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="sku-pop-search">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索模板内容" />
      </div>
      <div className="sku-pop-list">
        {list.length === 0 ? (
          <div className="sku-pop-empty">
            <Icon name="doc" size={16} />
            没有匹配的模板
          </div>
        ) : (
          list.map((t) => (
            <button key={t.id} type="button" className="sku-pop-item" style={{ alignItems: "flex-start" }} onClick={() => onPick(t.text)}>
              <span className="sku-pop-info">
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="idtag" style={{ fontSize: 11 }}>{t.id}</span>
                  <span className="dim2" style={{ fontSize: 11 }}>{t.group}</span>
                </span>
                <span style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5, whiteSpace: "normal", marginTop: 3 }}>{t.text}</span>
              </span>
              <span className="sku-pop-arrow">
                <Icon name="arrow" size={15} />
              </span>
            </button>
          ))
        )}
      </div>
      <div className="sku-pop-foot">
        <span className="mono dim2" style={{ fontSize: 11 }}>共 {items.length} 条</span>
      </div>
    </div>
  );
}

function SkuPicker({ skus, loading, error, onClose, onPick }: { skus: PushSku[]; loading: boolean; error: string | null; onClose: () => void; onPick: (sku: PushSku) => void }) {
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  const ql = q.trim().toLowerCase();
  const list = ql ? skus.filter((s) => (s.id + s.title + s.subtitle).toLowerCase().includes(ql)) : skus;
  return (
    <div ref={ref} className="sku-pop">
      <div className="sku-pop-h">
        <span>
          <Icon name="box" size={16} />
          推送商品 SKU
        </span>
        <button type="button" className="sku-pop-close" onClick={onClose}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="sku-pop-search">
        <Icon name="search" size={15} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索 SKU 名称 / 编号" />
      </div>
      <div className="sku-pop-list">
        {loading ? (
          <div className="sku-pop-empty">
            <Icon name="box" size={16} />
            正在读取客服工作台商品
          </div>
        ) : error ? (
          <div className="sku-pop-empty">
            <Icon name="box" size={16} />
            客服工作台商品读取失败:{error}
          </div>
        ) : list.length === 0 ? (
          <div className="sku-pop-empty">
            <Icon name="box" size={16} />
            {q ? `没有匹配「${q}」的商品` : "暂无可推送商品"}
          </div>
        ) : (
          list.map((s) => (
            <button key={s.id} type="button" className="sku-pop-item" onClick={() => onPick(s)}>
              <span className="sku-pop-thumb">
                <Icon name="box" size={19} />
              </span>
              <span className="sku-pop-info">
                <span className="sku-pop-title">{s.title}</span>
                <span className="sku-pop-sub">{s.subtitle}</span>
              </span>
              <span className="sku-pop-arrow">
                <Icon name="arrow" size={15} />
              </span>
            </button>
          ))
        )}
      </div>
      <div className="sku-pop-foot">
        <span className="mono dim2" style={{ fontSize: 11 }}>共 {skus.length} 个可推送商品 · 来源客服工作台商品</span>
      </div>
    </div>
  );
}

/* ---- 右栏:客户档案 ---- */
function UserPanel({
  convo,
  open,
  onOpenProfile,
  onQuick,
  onAddTag,
  onRemoveTag,
}: {
  convo: SessionConvo | null;
  open: boolean;
  onOpenProfile: () => void;
  onQuick: (k: "history" | "tickets" | "resetpw" | "account" | "note") => void;
  onAddTag: (t: string) => void;
  onRemoveTag: (t: string) => void;
}) {
  const p = convo?.profile;
  const batch = convo?.batchInfo;
  if (!p) {
    return (
      <div className={`cv-profile${open ? " open" : ""}`}>
        <div className="cvp-scroll">
          {batch ? (
            <>
              <div className="cvp-sec" style={{ marginTop: 0 }}>群发批次</div>
              <div className="cvp-risk mid">
                <span className="rl">群发</span>
                <span className="rn">本会话是一次人群群发触达的批次代表,非单一客户;按下方受众条件批量发出,无单一客户档案。</span>
              </div>
              <div className="cvp-sec">发起身份</div>
              <div className="cvp-row"><span className="k">身份</span><span className="v">{batch.identity}</span></div>
              <div className="cvp-sec">受众条件</div>
              <div className="cvp-row"><span className="k">圈选</span><span className="v" style={{ textAlign: "right", maxWidth: 190 }}>{batch.audienceDesc}</span></div>
              <div className="cvp-sec">开场话术</div>
              <div style={{ fontSize: 12.5, color: "var(--ink-2)", lineHeight: 1.55, padding: "4px 0" }}>{batch.script}</div>
            </>
          ) : (
            <Empty icon="users">该会话暂未关联客户档案</Empty>
          )}
        </div>
      </div>
    );
  }
  const riskCls = p.risk === "低" ? "low" : p.risk === "中" ? "mid" : "high";
  const rows: Array<[string, string, boolean]> = [
    ["持有设备", p.device, false],
    ["算力", p.hashrate, false],
    ...(p.idle ? ([["闲置情况", p.idle, false]] as Array<[string, string, boolean]>) : []),
    ["地区", p.region, false],
    ["手机号", p.phone, true],
    ["账龄", p.joined, false],
    ["最近活跃", p.lastActive, false],
  ];
  return (
    <div className={`cv-profile${open ? " open" : ""}`}>
      <div className="cvp-scroll">
        <div className="cvp-id">
          <MAvatar name={p.nickname} size="lg" />
          <div style={{ minWidth: 0 }}>
            <div className="nm">{p.nickname}</div>
            <div className="uid">{p.uid}</div>
          </div>
        </div>
        <div className="cvp-tags">
          <span className="cvp-vchip">
            <Icon name="flame" size={12} />
            {p.vlevel}
          </span>
          <span className="cvp-kyc">
            <Icon name="check" size={12} />
            KYC {p.kyc}
          </span>
        </div>

        <button type="button" data-proof="customer-profile-open" className="cvp-cta" onClick={onOpenProfile}>
          <Icon name="doc" size={15} />
          查看会话客户信息
          <Icon name="chevron" size={15} />
        </button>

        <div className="cvp-sec">风险研判</div>
        <div className={`cvp-risk ${riskCls}`}>
          <span className="rl">风险 {p.risk}</span>
          <span className="rn">{p.riskNote}</span>
        </div>

        <div className="cvp-sec">资金概览</div>
        <div className="cvp-grid">
          <div className="cvp-cell"><div className="k">累计充值</div><div className="v">{p.recharge}<small>USDT</small></div></div>
          <div className="cvp-cell"><div className="k">累计提现</div><div className="v">{p.withdraw}<small>USDT</small></div></div>
          <div className="cvp-cell"><div className="k">当前余额</div><div className="v">{p.balance}<small>USDT</small></div></div>
          <div className="cvp-cell"><div className="k">关联工单</div><div className="v">{p.tickets}<small>张</small></div></div>
        </div>

        <div className="cvp-sec">账户与设备</div>
        <div>
          {rows.map(([k, v, mono]) => (
            <div key={k} className="cvp-row">
              <span className="k">{k}</span>
              <span className={`v${mono ? " mono" : ""}`}>{v}</span>
            </div>
          ))}
        </div>

        <div className="cvp-sec">客户标签</div>
        <TagEditor systemTags={p.systemTags} customTags={p.customTags} onAdd={onAddTag} onRemove={onRemoveTag} />

        {p.notes && p.notes.length > 0 && (
          <>
            <div className="cvp-sec">内部备注 <span className="dim2" style={{ marginLeft: 4 }}>{p.notes.length}</span></div>
            <div>
              {p.notes.map((n) => (
                <div key={n.id} style={{ padding: "10px 0", display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ fontSize: 12.5, color: "var(--ink)", lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{n.text}</div>
                  <span className="dim2" style={{ fontSize: 11.5 }} suppressHydrationWarning>{n.author} · {relWhen(n.ts)}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="cvp-sec">快捷操作</div>
        <div className="cvp-acts">
          <button type="button" className="cvp-act" onClick={() => onQuick("history")}><Icon name="clock" size={17} />历史会话</button>
          <button type="button" className="cvp-act" onClick={() => onQuick("tickets")}><Icon name="doc" size={17} />关联工单</button>
          <button type="button" className="cvp-act" onClick={() => onQuick("resetpw")}><Icon name="lock" size={17} />重置密码</button>
          <button type="button" className="cvp-act" onClick={() => onQuick("account")}><Icon name="wallet" size={17} />账户操作</button>
          <button type="button" className="cvp-act" onClick={() => onQuick("note")}><Icon name="doc" size={17} />添加备注</button>
        </div>
      </div>
    </div>
  );
}

function TagEditor({ systemTags, customTags, onAdd, onRemove }: { systemTags: string[]; customTags: string[]; onAdd: (t: string) => void; onRemove: (t: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus();
  }, [editing]);
  const commit = () => {
    if (val.trim()) onAdd(val.trim());
    setVal("");
    setEditing(false);
  };
  return (
    <div className="cvp-tags" style={{ marginTop: 4 }}>
      {systemTags.map((t) => (
        <span key={t} className="chip" title="系统标签 · 只读(随状态派生)" style={{ cursor: "default", opacity: 0.8 }}>
          <Icon name="lock" size={11} />
          {t}
        </span>
      ))}
      {customTags.map((t) => (
        <button key={t} type="button" className="chip" style={{ cursor: "pointer", paddingRight: 4 }} title="点击移除" onClick={() => onRemove(t)}>
          {t}
          <span style={{ marginLeft: 4, color: "var(--ink-4)", fontSize: 12, lineHeight: 1 }}>×</span>
        </button>
      ))}
      {editing ? (
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setVal("");
              setEditing(false);
            }
          }}
          onBlur={commit}
          placeholder="新标签 ↵"
          style={{ height: 22, padding: "0 9px", borderRadius: 999, border: "1px dashed var(--m-hd-border)", background: "var(--m-hd-soft)", color: "var(--ink)", fontFamily: "inherit", fontSize: 11.5, outline: "none", minWidth: 0, width: 100 }}
        />
      ) : (
        <button type="button" className="chip" style={{ cursor: "pointer", color: "var(--ink-3)", borderStyle: "dashed" }} onClick={() => setEditing(true)}>
          <Icon name="plus" size={12} />
          添加
        </button>
      )}
    </div>
  );
}
