"use client";

/**
 * M3 即时会话台 — 收件箱三栏(列表 + 富气泡对话 + 客户档案)(helpdesk 设计稿布局,由 I9 迁出)。
 * 会话 / 工单读写走后端 content 接口;I.session.* / I.support.* 为 M 容器传入的视图适配键。
 * I.session.ui.lastConvo 仅保留为坐席续聊 UI 态。
 * 例行坐席操作(回复/转交/改状态/推送/归档/标签/备注)直接执行 + 自动 A2 审计;
 * 主动发起会话 / 转工单走真实后端写链。续聊恢复后刷新仍回上次会话。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, MessageThread, type ThreadMessage } from "../design-kit";
import {
  STANDBY_POOL_LABEL,
  TRANSFER_TIMEOUT_MINS,
  transferTargetLabel,
  type AdvisorScript,
  type CustomerNote,
  type CustomerProfile,
  type InitiateIdentity,
  type SessionConvo,
  type SessionMsg,
  type SessionReplyTpl,
  type SessionStatus,
  type SessionTransfer,
} from "./data";
import { ConvStat, Empty, MAvatar, ownerLabel, relWhen } from "./hd-ui";
import { IdlePolicyModal, InitiateModal, QuickActionModal, ReturnModal, TransferModal, type InitiatePayload, type ReturnPayload, type TransferPayload } from "./m3-modals";
import type { MCtx } from "./types";
import {
  fetchMConversationTimeoutPolicy,
  fetchMSupportWorkbenchSkus,
  fetchMSupportWorkbenchUsers,
  updateMConversationTimeoutPolicy,
  type ConversationTimeoutPolicy,
  type MSupportAgent,
} from "@/lib/admin/m-client";
import type { User360Profile } from "@/lib/admin/user360-client";
import type { OpsSku } from "@/lib/admin/platform-types";
import { useAdminAuth } from "@/lib/store/admin-auth";

const CONVO_KEY = "I.session.convos";
const SCRIPT_LIST_KEY = "I.session.scripts";
const REPLY_TEMPLATE_LIST_KEY = "I.session.replyTemplates";
const AGENT_LIST_KEY = "I.support.agents";
const TRANSFER_TARGETS_KEY = "I.session.transferTargets";
const LAST_CONVO_KEY = "I.session.ui.lastConvo";
const FALLBACK_KEY = "I.session.workbench.timeoutFallback"; // 工作台「转入待处理超时回落备勤池」开关("on"=启用)
const INBOX_PAGE_SIZE = 8; // 会话收件箱每页条数(翻页器)

type InboxPageToken = number | "gap-left" | "gap-right";

function visibleInboxPages(pageCount: number, currentPage: number): InboxPageToken[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1);
  const pages = Array.from(new Set([1, pageCount, currentPage - 1, currentPage, currentPage + 1]
    .filter((page) => page >= 1 && page <= pageCount)))
    .sort((left, right) => left - right);
  const tokens: InboxPageToken[] = [];
  pages.forEach((page, index) => {
    const previous = pages[index - 1];
    if (previous && page - previous > 1) tokens.push(index === 1 ? "gap-left" : "gap-right");
    tokens.push(page);
  });
  return tokens;
}

type PushSku = { id: string; title: string; subtitle: string; to: string };
type PushSkuSource = OpsSku;

type ConvSeg = "all" | "unread" | "incoming" | "active" | "resolved" | "archived";
type ConvCategory = "all" | "advisor" | "support";
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
function statusLabel(status: SessionStatus): string {
  return status === "open" ? "进行中" : status === "resolved" ? "已解决" : "已关闭";
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

/* ============ 跨域直达路由映射(C/D/E 域处置页)============
 * 客服在 M3/M2 发起的账户/资金/设备/实名类动作,真实处置回 C/D/E 域;
 * 这里提供直达路由,避免只靠 toast + 手工导航。uid 为用户编码,留空跳域首页队列。
 */
const ACCOUNT_ACTION_ROUTES: Array<{ label: string; domain: string; path: (uid: string) => string }> = [
  { label: "临时冻结账户", domain: "C2 账户操作", path: () => "/users/actions" },
  { label: "提现限额下调", domain: "D 域提现", path: (uid) => `/users/search/${encodeURIComponent(uid)}#hub-withdrawal` },
  { label: "补资料指令", domain: "C4 实名台账", path: () => "/users/kyc" },
  { label: "解绑并重装设备", domain: "E 域设备", path: (uid) => `/users/search/${encodeURIComponent(uid)}#hub-devices` },
];
function accountActionPath(label: string, uid: string): string | null {
  const found = ACCOUNT_ACTION_ROUTES.find((item) => item.label === label);
  return found ? found.path(uid) : null;
}

/* 会话内 SKU/商品卡 cta 是面向用户的应用路由(/store /staking /genesis);
 * 客服点击应跳到对应管理域页面核对商品,而不是只弹 toast。 */
const CTA_HREF_TO_ADMIN: Record<string, string> = {
  "/store": "/devices/pricing",
  "/staking": "/finance-products/staking",
  "/genesis": "/finance-products/genesis",
};
function ctaHrefToAdminPath(href: string): string | null {
  return CTA_HREF_TO_ADMIN[href] ?? null;
}

function workbenchUserToCustomerProfile(user: User360Profile): CustomerProfile {
  const rawId = textOf(user.id).trim();
  const uid = textOf(user.userNo).trim() || (rawId ? `U${rawId.padStart(8, "0")}` : "");
  const riskBand = textOf(user.riskBand).trim().toUpperCase();
  const risk: CustomerProfile["risk"] = riskBand === "HIGH" || riskBand === "高"
    ? "高"
    : riskBand === "LOW" || riskBand === "低"
      ? "低"
      : "中";
  const systemTags = [textOf(user.status).trim(), textOf(user.vRank || user.userLevel).trim(), textOf(user.kycStatus).trim()]
    .filter(Boolean);
  const balances = [
    user.walletUsdt == null ? "" : `${textOf(user.walletUsdt)} USDT`,
    user.walletNex == null ? "" : `${textOf(user.walletNex)} NEX`,
  ].filter(Boolean);
  const deviceCount = textOf(user.deviceCount).trim();
  const activeDeviceCount = textOf(user.activeDeviceCount).trim();
  return {
    uid,
    nickname: textOf(user.nickname).trim() || uid,
    phone: textOf(user.phoneMasked, "—"),
    vlevel: textOf(user.vRank || user.userLevel, "—"),
    kyc: textOf(user.kycStatus, "待核对"),
    systemTags,
    customTags: [],
    risk,
    riskNote: user.riskScore == null ? "来自真实用户风险档案" : `风险评分 ${textOf(user.riskScore)}`,
    recharge: "—",
    withdraw: "—",
    balance: balances.join(" / ") || "—",
    tickets: 0,
    device: deviceCount ? `${deviceCount} 台${activeDeviceCount ? ` · ${activeDeviceCount} 台活跃` : ""}` : "—",
    hashrate: "—",
    region: textOf(user.countryCode, "—"),
    joined: textOf(user.registeredAt, "—"),
    lastActive: textOf(user.lastLoginAt, "—"),
    ledger: [],
    notes: [],
  };
}

export function M3Sessions({ ctx }: { ctx: MCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const router = useRouter();
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM3 = isSuperAdmin || Boolean(authorities?.includes("service_m3_write"));
  const canManageTimeoutPolicy = isSuperAdmin || Boolean(authorities?.includes("service_m3_timeout_manage"));
  const conversationsAvailable = pget("I.session.conversationsAvailable") !== "0";

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
  const conversationCustomers = useMemo(() => {
    const rows = new Map<string, CustomerProfile>();
    convos.forEach((convo) => {
      const profile = convo.profile;
      if (profile?.uid && !rows.has(profile.uid)) rows.set(profile.uid, profile);
    });
    return Array.from(rows.values());
  }, [convos]);

  const [seg, setSeg] = useState<ConvSeg>("all");
  const [typeFilter, setTypeFilter] = useState<ConvCategory>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(() => pget(LAST_CONVO_KEY) ?? convos[0]?.id ?? "cv-advisor-1");
  const [replyBody, setReplyBody] = useState("");
  const [quick, setQuick] = useState<"history" | "tickets" | "resetpw" | "account" | "note" | null>(null);
  const [showInitiate, setShowInitiate] = useState(false);
  const [showIdlePolicy, setShowIdlePolicy] = useState(false);
  const [idlePolicy, setIdlePolicy] = useState<ConversationTimeoutPolicy | null>(null);
  const [idlePolicyLoading, setIdlePolicyLoading] = useState(true);
  const [idlePolicySaving, setIdlePolicySaving] = useState(false);
  const [idlePolicyError, setIdlePolicyError] = useState("");
  const [initiateCustomerQuery, setInitiateCustomerQuery] = useState("");
  const [directoryCustomers, setDirectoryCustomers] = useState<CustomerProfile[]>([]);
  const [initiateCustomerLoading, setInitiateCustomerLoading] = useState(false);
  const [initiateCustomerError, setInitiateCustomerError] = useState("");
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
  const [writePending, setWritePending] = useState(false);
  const writeInFlight = useRef(false);

  const loadIdlePolicy = useCallback(async (): Promise<ConversationTimeoutPolicy | null> => {
    setIdlePolicyLoading(true);
    setIdlePolicyError("");
    try {
      const loaded = await fetchMConversationTimeoutPolicy();
      setIdlePolicy(loaded);
      return loaded;
    } catch (error) {
      setIdlePolicy(null);
      setIdlePolicyError(error instanceof Error ? error.message : "M3_TIMEOUT_POLICY_LOAD_FAILED");
      return null;
    } finally {
      setIdlePolicyLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadIdlePolicy();
  }, [loadIdlePolicy]);

  const openIdlePolicy = async () => {
    setIdlePolicyError("");
    const loaded = await loadIdlePolicy();
    if (loaded) {
      setShowIdlePolicy(true);
    } else {
      toast("超时策略加载失败,未使用本地默认值;请检查后端后重试");
    }
  };

  const saveIdlePolicy = async (input: { warnMinutes: number; closeMinutes: number; reason: string }) => {
    if (!idlePolicy || !canManageTimeoutPolicy || idlePolicySaving) return false;
    setIdlePolicySaving(true);
    setIdlePolicyError("");
    const reasonFingerprint = Array.from(input.reason).reduce(
      (hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0,
      2166136261,
    ).toString(36);
    const commandKey = `m3-timeout-policy:${idlePolicy.version}:${input.warnMinutes}:${input.closeMinutes}:${reasonFingerprint}`;
    try {
      const updated = await updateMConversationTimeoutPolicy(idlePolicy, input, commandKey);
      setIdlePolicy(updated);
      toast("会话超时策略已更新,服务端调度立即按新版本执行");
      return true;
    } catch (error) {
      setIdlePolicyError(error instanceof Error ? error.message : "M3_TIMEOUT_POLICY_UPDATE_FAILED");
      return false;
    } finally {
      setIdlePolicySaving(false);
    }
  };

  const initiateCustomers = useMemo(() => {
    const rows = new Map<string, CustomerProfile>();
    [...directoryCustomers, ...conversationCustomers].forEach((profile) => {
      if (profile.uid && !rows.has(profile.uid)) rows.set(profile.uid, profile);
    });
    return Array.from(rows.values());
  }, [conversationCustomers, directoryCustomers]);

  useEffect(() => {
    if (!showInitiate) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setInitiateCustomerLoading(true);
      setInitiateCustomerError("");
      fetchMSupportWorkbenchUsers({ keyword: initiateCustomerQuery.trim(), pageNum: 1, pageSize: 8 })
        .then((result) => {
          if (!active) return;
          setDirectoryCustomers(result.records.map(workbenchUserToCustomerProfile).filter((profile) => profile.uid));
        })
        .catch((error: unknown) => {
          if (!active) return;
          setDirectoryCustomers([]);
          setInitiateCustomerError(error instanceof Error ? error.message : "USERS_LOAD_FAILED");
        })
        .finally(() => {
          if (active) setInitiateCustomerLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [showInitiate, initiateCustomerQuery]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("seg");
    const requestedQuery = params.get("q");
    if (requested && SEGS.some(([value]) => value === requested)) {
      setSeg(requested as ConvSeg);
    }
    if (requestedQuery) setQuery(requestedQuery);
  }, []);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return convos
      .filter((c) => (seg === "archived" ? c.archived === true : !c.archived))
      .filter((c) => typeFilter === "all" || c.type === typeFilter)
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
  }, [convos, query, seg, typeFilter]);

  // 详情必须属于当前筛选结果。筛选为 0 条时清空详情和写入口，避免误操作旧会话。
  const selected = filtered.find((c) => c.id === selectedId) ?? filtered[0] ?? null;
  const ownerName = selected?.owner ?? "Unassigned";
  const currentAgentNames = useMemo(() => supportAgents.filter((agent) => agent.adminId === currentAdminId).map((agent) => agent.name), [supportAgents, currentAdminId]);
  const canAcceptSelectedTransfer = Boolean(selected?.transfer) && (
    selected?.transfer?.to.kind === "agent"
      ? currentAgentNames.includes(selected.transfer.to.name)
      : currentAgentNames.length > 0
  );

  const selectConvo = (id: string) => {
    restoredRef.current = true;
    setSelectedId(id);
    setReplyBody("");
    setParam(LAST_CONVO_KEY, id, { action: "记录坐席当前会话", reason: "ui-state" });
  };

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
  }, [seg, typeFilter, query]);
  const pageStart = (curPage - 1) * INBOX_PAGE_SIZE;
  const paged = filtered.slice(pageStart, pageStart + INBOX_PAGE_SIZE);

  const commitM3Write = async (write: () => Promise<boolean>, successMessage: string): Promise<boolean> => {
    if (writeInFlight.current) {
      toast("操作正在提交,请稍候");
      return false;
    }
    if (!canWriteM3 || !conversationsAvailable) return false;
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
  const writeConvos = (next: SessionConvo[], reason: string, action: string, commandKey: string) =>
    setParam(CONVO_KEY, JSON.stringify(next), { action, reason, commandKey });
  const updateConvo = (id: string, updater: (c: SessionConvo) => SessionConvo, reason: string, action: string, commandKey: string) =>
    writeConvos(convos.map((c) => (c.id === id ? updater(c) : c)), reason, action, commandKey);

  // ── 转入待处理:工作台「超时回落备勤池」策略由后端定时任务执行;前端只保存策略与展示状态──
  const fallbackOn = pget(FALLBACK_KEY) === "on";
  const setFallback = async (on: boolean) => {
    await commitM3Write(
      () => setParam(FALLBACK_KEY, on ? "on" : "off", { action: "工作台·转入待处理超时回落备勤池开关", reason: "调整 M3 会话转入待处理超时回落策略", commandKey: `m3:fallback-policy:${on}` }),
      on ? "已启用超时回落备勤池" : "已停用超时回落备勤池",
    );
  };

  const sendReply = async () => {
    if (!selected) return;
    if (!replyBody.trim()) {
      toast("回复需要正文");
      return;
    }
    const now = Date.now();
    const succeeded = await commitM3Write(
      () => updateConvo(
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
        `m3:reply:${selected.id}:${replyBody.trim()}`,
      ),
      `${selected.id} 已回复`,
    );
    if (succeeded) setReplyBody("");
  };

  // ── 跨坐席转交处置(全程例行内部交接:不弹 MC、不调 logAudit;转交/退回原因记入会话系统消息)──
  const runTransfer = async (p: TransferPayload) => {
    if (!selected) return;
    const now = Date.now();
    const fromOwner = selected.owner === "Unassigned" ? "客服台" : selected.owner;
    const toLabel = transferTargetLabel(p.to);
    const succeeded = await commitM3Write(() => updateConvo(
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
      `m3:transfer:${selected.id}:${JSON.stringify(p.to)}:${p.reason}`,
    ), `${selected.id} 已转交 ${toLabel} · 转入待处理`);
    if (succeeded) setShowTransfer(false);
  };
  const acceptTransfer = async () => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    const newOwner = t.to.kind === "agent" ? t.to.name : selected.owner !== "Unassigned" ? selected.owner : transferTargetLabel(t.to);
    await commitM3Write(() => updateConvo(
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
      `m3:transfer-accept:${selected.id}`,
    ), `${selected.id} 已接入 · ${newOwner} 接待`);
  };
  const waitTransfer = async () => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    await commitM3Write(() => updateConvo(
      selected.id,
      (c) => ({
        ...c,
        lastTs: now,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `保持转入待处理 · 继续等待 ${transferTargetLabel(t.to)} 接入(来自 ${t.from})` }],
      }),
      "转入待处理继续等待(例行,自动留档)",
      `会话等待处理 ${selected.id} · admin.conversation_transfer_wait`,
      `m3:transfer-wait:${selected.id}`,
    ), `${selected.id} 保持转入待处理 · 继续等待接入`);
  };
  const runReturn = async (p: ReturnPayload) => {
    if (!selected?.transfer) return;
    const now = Date.now();
    const t = selected.transfer;
    const back = p.target === "from" ? t.from : STANDBY_POOL_LABEL;
    const succeeded = await commitM3Write(() => updateConvo(
      selected.id,
      (c) => ({
        ...c,
        transfer: undefined,
        owner: back,
        lastTs: now,
        messages: [...c.messages, { ts: now, sender: "agent", agentName: "系统", text: `已退回${p.target === "from" ? `原坐席 ${back}` : back} · 退回原因:${p.reason}` }],
      }),
      p.reason,
      `会话退回 ${selected.id} → ${back} · admin.conversation_transfer_return`,
      `m3:transfer-return:${selected.id}:${p.target}:${p.reason}`,
    ), `${selected.id} 已退回 ${back}`);
    if (succeeded) setShowReturn(false);
  };
  const setStatusDirect = async (id: string, status: SessionStatus) => {
    await commitM3Write(
      () => updateConvo(id, (c) => ({ ...c, status, lastTs: Date.now() }), `会话状态「${statusLabel(status)}」(例行,自动留档)`, `会话状态 ${id} · admin.conversation_status`, `m3:status:${id}:${status}`),
      `${id} → ${statusLabel(status)}`,
    );
  };

  const runInitiate = async (p: InitiatePayload) => {
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
      profile: p.profile,
      messages: [
        { ts: now, sender: "agent", agentName: "系统", text: `由「${p.identity.label} · ${p.identity.id}」主动发起 · 目标:${p.targetDesc}` },
        opening,
      ],
    };
    const succeeded = await commitM3Write(
      () => writeConvos(
        [...existing, newConvo],
        "主动发起会话(单用户 · 例行)",
        `主动发起会话 ${cid} · admin.conversation_initiated`,
        `m3:initiate:${p.identity.id}:${p.profile?.uid ?? p.targetLabel}:${p.text}:${p.ctaHref ?? ""}`,
      ),
      `已以「${p.identity.label}」向 ${p.targetLabel} 发起会话`,
    );
    if (succeeded) {
      setShowInitiate(false);
      selectConvo(cid);
    }
  };

  const convertToTicket = () => {
    if (!selected) return;
    const convo = selected;
    openActionConfirm({
      action: <>转工单 · {convo.id}</>,
      detail: <>把会话 <b>{convo.agentName}</b>(<span className="mono">{convo.id}</span>)转为可追踪工单并进入 SLA 队列。适用于需要跨班次跟进的提现、KYC 或设备问题。</>,
      amplifies: false,
      reasonMin: 8,
      reasonMax: 200,
      run: (reason: string) => commitM3Write(
        () => setParam("I.session.ticket.__create", JSON.stringify({
          conversationNo: convo.id,
          category: "account",
          priority: "normal",
          title: `由会话 ${convo.id} 转入 · ${convo.profile?.nickname ?? convo.customer ?? convo.agentName}`,
          assignedAdminId: supportAgents.find((agent) => agent.name === convo.owner)?.adminId,
          assignedAdminName: supportAgents.some((agent) => agent.name === convo.owner) ? convo.owner : "Unassigned",
        }), { action: `会话转工单 ${convo.id} · admin.support_ticket_from_conversation`, reason, commandKey: `m3:convert-ticket:${convo.id}` }),
        `${convo.id} 已转工单`,
      ),
    });
  };

  const pushSku = async (sku: PushSku) => {
    if (!selected) return;
    const now = Date.now();
    const text = `帮你整理了一份「${sku.title}」详情(${sku.subtitle}),方便对照看看:`;
    await commitM3Write(() => updateConvo(
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
      `m3:push-sku:${selected.id}:${sku.id}`,
    ), `已推送「${sku.title}」`);
  };

  const archiveConvo = async (id: string, on: boolean) => {
    await commitM3Write(
      () => updateConvo(id, (c) => ({ ...c, archived: on }), on ? "会话归档(例行)" : "撤销归档(例行)", `${on ? "会话归档" : "撤销归档"} ${id} · admin.conversation_archive`, `m3:archive:${id}:${on}`),
      on ? `${id} 已归档` : `${id} 已撤销归档`,
    );
  };
  const archiveAllResolved = async () => {
    const targets = convos.filter((c) => c.status === "resolved" && !c.archived);
    if (targets.length === 0) {
      toast("没有可归档的已解决会话");
      return;
    }
    await commitM3Write(
      () => setParam("I.session.archiveBatch.__create", JSON.stringify({ conversationNos: targets.map((c) => c.id) }), { action: `批量归档已解决会话 ${targets.length} 个 · admin.conversation_archive_batch`, reason: "批量归档已解决会话", commandKey: `m3:archive-batch:${targets.map((c) => c.id).sort().join(",")}` }),
      `已批量归档 ${targets.length} 个已解决会话`,
    );
  };

  const addNote = async (text: string): Promise<boolean> => {
    if (!selected?.profile || !text.trim() || !canWriteM3 || !conversationsAvailable) return false;
    const succeeded = await ctx.addCustomerNote(selected.id, text.trim());
    if (succeeded) toast("客户备注已保存");
    return succeeded;
  };
  const removeNote = async (noteId: string): Promise<boolean> => {
    if (!selected?.profile || !canWriteM3 || !conversationsAvailable) return false;
    const succeeded = await ctx.removeCustomerNote(selected.id, noteId);
    if (succeeded) toast("客户备注已删除");
    return succeeded;
  };
  const addCustomerTag = async (tag: string): Promise<boolean> => {
    if (!selected?.profile || !tag.trim() || !canWriteM3 || !conversationsAvailable) return false;
    const t = tag.trim();
    if (selected.profile.customTags.includes(t)) return false;
    const succeeded = await ctx.addCustomerTag(selected.id, t);
    if (succeeded) toast(`已加标签「${t}」`);
    return succeeded;
  };
  const removeCustomerTag = async (tag: string): Promise<boolean> => {
    if (!selected?.profile || !canWriteM3 || !conversationsAvailable) return false;
    return ctx.removeCustomerTag(selected.id, tag);
  };
  // QuickAction 账户类:客服侧只发起,真实处置回 C/D/E 域。直达路由跳到对应域处置页,
  // toast 仅作辅助提示(不再作唯一途径);按主人指令 QuickAction 不写审计。
  const runAccountAction = (label: string) => {
    if (!selected?.profile) return;
    const path = accountActionPath(label, selected.profile.uid);
    if (path) {
      router.push(path);
      toast(`已跳转「${label}」处置页 · M3 不代为提交`);
    } else {
      toast(`请前往 C/D 域完成「${label}」;M3 不会代为提交`);
    }
    setQuick(null);
  };

  // 最后一条坐席实质消息(排除系统消息)→ 唯一显示回执处(镜像前端 iMessage 惯例)。
  const lastAgentIdx = (() => {
    const msgs = selected?.messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].sender === "agent" && msgs[i].agentName !== "系统") return i;
    }
    return -1;
  })();
  const threadMessages: ThreadMessage[] = (selected?.messages ?? []).map((m, i) => {
    const isAgent = m.sender === "agent";
    const isSystem = isAgent && m.agentName === "系统";
    const role: "support" | "advisor" | "user" = isAgent ? (selected!.type === "advisor" ? "advisor" : "support") : "user";
    const cta = !isSystem && m.ctaHref && m.ctaHref !== "—"
      ? {
          kind: "link" as const,
          label: `查看 ${hrefLabel(m.ctaHref)}`,
          onClick: () => {
            const adminPath = ctaHrefToAdminPath(m.ctaHref!);
            if (adminPath) {
              router.push(adminPath);
              toast(`已跳转「${hrefLabel(m.ctaHref!)}」对应管理页核对`);
            } else {
              toast(`请在对应业务页面核对「${hrefLabel(m.ctaHref!)}」`);
            }
          },
        }
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
  return (
    <div className="m3-stage">
      {!conversationsAvailable && (
        <div className="itint" role="alert" style={{ gridColumn: "1 / -1", margin: 10 }}>
          会话数据暂时无法同步,当前不会把空列表当作真实结果,写操作也已关闭。
        </div>
      )}
      {conversationsAvailable && !canWriteM3 && (
        <div className="itint" role="status" style={{ gridColumn: "1 / -1", margin: 10 }}>
          当前账号为只读模式;查看与筛选可用,回复、转交、发起、归档及客户资料修改需要 M3 写权限。
        </div>
      )}
      {/* 左:会话收件箱 */}
      <div className="m3-col-list">
        <div style={{ padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 9 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <h2 style={{ fontSize: 15, fontWeight: 500 }}>会话收件箱</h2>
            <span className="mono dim2" style={{ fontSize: 11.5 }}>{filtered.length}</span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 7 }}>
              {canWriteM3 && conversationsAvailable && resolvedOpen > 0 && (
                <button type="button" data-proof="session-archive-batch" className="btn btn-sec btn-sm" disabled={writePending} title={`归档已解决 ${resolvedOpen} 个`} onClick={archiveAllResolved}>
                  <Icon name="box" size={16} />
                  {resolvedOpen}
                </button>
              )}
              <button
                type="button"
                data-proof="session-idle-policy"
                className="btn btn-sec btn-sm"
                disabled={idlePolicyLoading}
                title={idlePolicy
                  ? `超时策略:静默 ${idlePolicy.warnMinutes} 分钟提醒 · ${idlePolicy.closeMinutes} 分钟自动结束`
                  : idlePolicyError || "正在读取真实超时策略"}
                onClick={() => void openIdlePolicy()}
              >
                <Icon name="clock" size={16} />
                {idlePolicyLoading ? "策略读取中" : "超时策略"}
              </button>
              {canWriteM3 && conversationsAvailable && <button type="button" data-proof="session-initiate" className="btn btn-pri btn-sm" disabled={writePending} onClick={() => setShowInitiate(true)}>
                <Icon name="plus" size={16} />
                主动发起会话
              </button>}
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
          <select className="inp" aria-label="会话类别" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ConvCategory)}>
            <option value="all">全部类别</option>
            <option value="advisor">专属顾问</option>
            <option value="support">客服会话</option>
          </select>
          <div className="m3-fallback-bar">
            <span className="m3-fallback-lab"><Icon name="clock" size={13} />转入超时回落备勤池</span>
            <span className="dim2" style={{ fontSize: 11, marginLeft: "auto", marginRight: 8 }}>{fallbackOn ? "超时自动回落" : "关 · 持续等待"}</span>
            <button type="button" data-proof="session-transfer-fallback" className={`sw${fallbackOn ? " on" : ""}`} role="switch" aria-checked={fallbackOn} disabled={!canWriteM3 || !conversationsAvailable || writePending} title="转入待处理超时是否自动回落备勤池重新分配" onClick={() => setFallback(!fallbackOn)} />
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
                  {canWriteM3 && conversationsAvailable && c.status === "resolved" && !c.archived && (
                    <span className="cv-arch" role="button" data-proof="session-archive" title="归档此会话" onClick={(e) => { e.stopPropagation(); archiveConvo(c.id, true); }}>
                      <Icon name="box" size={15} />
                    </span>
                  )}
                  {canWriteM3 && conversationsAvailable && c.archived && (
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
            <div className="m3-pager-controls">
              <button type="button" className="btn btn-sec btn-sm btn-icon" disabled={curPage <= 1} title="上一页" onClick={() => setPage(curPage - 1)}>
                <span style={{ display: "inline-flex", transform: "rotate(180deg)" }}><Icon name="chevron" size={15} /></span>
              </button>
              {visibleInboxPages(pageCount, curPage).map((token) => typeof token === "number" ? (
                <button key={token} type="button" className={`tk-pageno${token === curPage ? " on" : ""}`} onClick={() => setPage(token)}>
                  {token}
                </button>
              ) : <span key={token} className="m3-page-gap" aria-hidden="true">…</span>)}
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
            canWrite={canWriteM3 && conversationsAvailable && !writePending}
            onTransfer={() => setShowTransfer(true)}
            onStatus={(s) => setStatusDirect(selected.id, s)}
            onToTicket={convertToTicket}
            onToggleProfile={() => setProfilePeek((v) => !v)}
          />
          {selected.transfer && (
            <TransferBanner transfer={selected.transfer} canWrite={canWriteM3 && conversationsAvailable && !writePending} canAccept={canAcceptSelectedTransfer} onAccept={acceptTransfer} onWait={waitTransfer} onReturn={() => setShowReturn(true)} />
          )}
          <div className="ChatBody">
            <MessageThread messages={threadMessages} relWhen={relWhen} resetKey={selected.id} agentName={ownerLabel(selected.owner)} agentAvatar={selected.owner !== "Unassigned" ? <MAvatar name={selected.owner} size="sm" /> : undefined} handlerRole={selected.type === "advisor" ? "顾问" : "客服"} />
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
              canWrite={canWriteM3 && conversationsAvailable && !writePending}
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
        onQuick={(k) => canWriteM3 && conversationsAvailable && setQuick(k)}
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
          customerLoading={initiateCustomerLoading}
          customerError={initiateCustomerError}
          onCustomerQueryChange={setInitiateCustomerQuery}
        />
      )}
      {showIdlePolicy && idlePolicy && (
        <IdlePolicyModal
          policy={idlePolicy}
          canSave={canManageTimeoutPolicy}
          saving={idlePolicySaving}
          error={idlePolicyError}
          onClose={() => {
            if (!idlePolicySaving) {
              setShowIdlePolicy(false);
              setIdlePolicyError("");
            }
          }}
          onSave={saveIdlePolicy}
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
  canWrite,
  onTransfer,
  onStatus,
  onToTicket,
  onToggleProfile,
}: {
  convo: SessionConvo;
  canWrite: boolean;
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
          <span className="mono" data-proof="session-conversation-no">{convo.id}</span>
          <span>当前对话用户</span>
        </div>
      </div>
      {incoming ? (
        <span className="stat wait"><Icon name="arrow" size={13} />转入待处理</span>
      ) : (
        <>
          <ConvStat active={active} />
          {canWrite && active && !closed && (
            <button type="button" data-proof="session-transfer" className="btn btn-sec btn-sm" onClick={onTransfer}>
              <Icon name="users" size={16} />
              转交
            </button>
          )}
          {canWrite && !closed && (
            <button type="button" data-proof="session-status" className="btn btn-sec btn-sm" onClick={() => onStatus(active ? "resolved" : "open")}>
              <Icon name={active ? "check" : "arrow"} size={16} />
              {active ? "标记已解决" : "重新激活"}
            </button>
          )}
          {canWrite && !closed && (
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
function TransferBanner({ transfer, canWrite, canAccept, onAccept, onWait, onReturn }: { transfer: SessionTransfer; canWrite: boolean; canAccept: boolean; onAccept: () => void; onWait: () => void; onReturn: () => void }) {
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
        <button type="button" data-proof="session-transfer-accept" className="btn btn-pri btn-sm" disabled={!canWrite || !canAccept} title={canAccept ? "接收接入" : "仅目标坐席可接收"} onClick={onAccept}>
          <Icon name="check" size={15} />接收接入
        </button>
        <button type="button" data-proof="session-transfer-wait" className="btn btn-sec btn-sm" disabled={!canWrite} onClick={onWait}>
          <Icon name="clock" size={15} />等待处理
        </button>
        <button type="button" data-proof="session-transfer-return" className="btn btn-danger btn-sm" disabled={!canWrite} onClick={onReturn}>
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
  canWrite,
}: {
  convo: SessionConvo;
  replyBody: string;
  onReplyChange: (v: string) => void;
  onSend: () => Promise<void>;
  onPushSku: (sku: PushSku) => void;
  pushSkus: PushSku[];
  pushSkuLoading: boolean;
  pushSkuError: string | null;
  advisorScripts: AdvisorScript[];
  replyTemplates: SessionReplyTpl[];
  canWrite: boolean;
}) {
  const [pickOpen, setPickOpen] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const isAdvisor = convo.type === "advisor";
  const quick: Array<{ id: string; group: string; text: string }> = isAdvisor
    ? advisorScripts.filter((s) => s.status === "published").map((s) => ({ id: s.id, group: s.group, text: s.text }))
    : replyTemplates.filter((t) => t.type === "support" && t.status === "published").map((t) => ({ id: t.id, group: "客服", text: t.text }));
  const fill = (text: string) => onReplyChange(replyBody ? `${replyBody} ${text}` : text);
  const doSend = async () => {
    if (!canWrite || !replyBody.trim() || sending) return;
    setSending(true);
    try {
      await onSend();
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="ChatComposer">
      {pickOpen && <SkuPicker skus={pushSkus} loading={pushSkuLoading} error={pushSkuError} onClose={() => setPickOpen(false)} onPick={(sku) => { onPushSku(sku); setPickOpen(false); }} />}
      {tplOpen && <TemplatePicker title={isAdvisor ? "快捷话术回复" : "回复模板"} items={quick} onClose={() => setTplOpen(false)} onPick={(text) => { fill(text); setTplOpen(false); }} />}
      <div className="composer-tools">
        <button type="button" className={`composer-tool${tplOpen ? " on" : ""}`} disabled={!canWrite} aria-expanded={tplOpen} onClick={() => { setTplOpen((v) => !v); setPickOpen(false); }}>
          <Icon name="doc" size={15} />
          <span>{isAdvisor ? "快捷话术回复" : "回复模板"}</span>
          <span className="composer-tool-n">{quick.length}</span>
        </button>
        <button type="button" data-proof="session-push-sku" className={`composer-tool${pickOpen ? " on" : ""}`} disabled={!canWrite} aria-expanded={pickOpen} onClick={() => { setPickOpen((v) => !v); setTplOpen(false); }}>
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
          disabled={!canWrite}
          onChange={(e) => onReplyChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") doSend();
          }}
        />
        <button type="button" data-proof="session-reply-save" className={`chat-send${sending ? " sending" : ""}`} disabled={!canWrite || !replyBody.trim() || sending} onClick={doSend}>
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
          <div className="cvp-cell"><div className="k">累计充值</div><div className="v">{p.recharge}</div></div>
          <div className="cvp-cell"><div className="k">累计提现</div><div className="v">{p.withdraw}</div></div>
          <div className="cvp-cell"><div className="k">当前余额</div><div className="v">{p.balance}</div></div>
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
