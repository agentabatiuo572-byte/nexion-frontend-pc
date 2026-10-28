"use client";

import { customerConversations, replyTimeout } from "@/lib/admin/customer-conversations";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeAdminRealtime, getAdminRealtimeSnapshot, watchAdminConversation, sendAdminTyping } from "@/lib/admin/admin-conversation-realtime";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { displayAdminError } from "@/lib/admin/error-messages";
import { userNicknameText } from "@/lib/admin/brand-copy";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportAttachmentPolicy, type SupportCustomerDetail, type SupportReadMode } from "@/lib/admin/m-support-client";
import { markMConversationRead, fetchMConversationTimeoutPolicy, updateMConversationTimeoutPolicy, parseMConversationTimeoutPolicy, type ConversationTimeoutPolicy } from "@/lib/admin/m-client";
import { parseBusinessTime } from "@/lib/admin/business-time";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import type { SessionConvo, SessionMsg } from "./data";
import type { MCtx } from "./types";
import { M3CustomerProfile } from "./m3-customer-profile";
import { SupportContentTools, type SelectedSupportContent } from "./support-content-tools";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { IdlePolicyModal } from "./m3-modals";
import { Icon, Modal } from "../design-kit";
import { HDSelect } from "./hd-ui";
import { SupportBulkComposer } from "./support-bulk-composer";
import { AssignAdvisorDialog } from "./m3-assign-advisor";
import { setSupportAlertPrefs, useSupportAlertPrefs } from "@/lib/admin/support-alerts";
import { legacySupportDestination, privateMessageRecovery, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import "./m3-dedicated-chat.css";
import "./m3-conversation-list.css";

type Intent = "SERVICE" | "MAINTENANCE";
type Attachment = { file: File; url: string; uploadId: string; key: string; id?: string; state: "selected" | "uploading" | "ready" | "error"; error?: string };
type Pending = { conversationId: string; key: string; body: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedStatus?: string; expectedVersion: number };
type TimeoutInput = { warnMinutes: number; closeMinutes: number; reason: string };
type TimeoutCommand = { key: string; input: TimeoutInput; policy: ConversationTimeoutPolicy; operator: string };

const CONVO_KEY = "I.session.convos";
const newKey = () => `m3-${crypto.randomUUID()}`;
const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
const recoveryKey = (adminId: number, key: string) => `${pendingKey(adminId)}:recovery:${key}`;
const ticketLinksKey = (adminId: number) => `nexion-m3-converted-tickets-v1:${adminId}`;
const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
type StoredMessage = PendingMutationRecord & { payload: string };
// Legacy timeout rows must survive private-message housekeeping even when their payload cannot be recovered.
const pendingMessages = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", ttlMs: Number.MAX_SAFE_INTEGER-Date.now(), isValidRecord: (row) => typeof row.payload === "string" || /^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint) });
const pendingTimeoutPolicies = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-timeout-pending-v1", ttlMs: Number.MAX_SAFE_INTEGER-Date.now(), isValidRecord: (row) => typeof row.payload === "string" });
const readPending = (slot: string) => pendingMessages.list().find((row) => row.fingerprint === slot)?.payload;
const rememberPending = (slot: string, commandKey: string, value: object) => {
  pendingMessages.remember(slot, commandKey, { payload: JSON.stringify(value) });
  return pendingMessages.isDurablyStored(slot, commandKey);
};
export const validCustomerId = (value: string | null): value is string => Boolean(value && /^\d+$/.test(value) && /[1-9]/.test(value));
const customerIdOf = (convo: SessionConvo) => String(convo.customerId ?? "");
const canSendTo = (convo: SessionConvo, adminId: number) => convo.status !== "transferred" && convo.type !== "ai"
  && Number.isSafeInteger(adminId) && adminId > 0
  && convo.ownerAdminId === adminId;
const conversationStateLabel = (status: SessionConvo["status"]) => status === "open" ? "进行中" : status === "transferred" ? "已转出 · 只读" : "已结束";
const lostPermission = (cause: unknown) => cause != null && typeof cause === "object" && "status" in cause && (cause.status === 403 || cause.status === 404);
const rejectedSend = (cause: unknown) => cause instanceof SupportClientError
  && [400, 403, 404, 409, 422].includes(cause.status)
  && !isIndeterminateSupportError(cause);

function parseConversations(raw: string | undefined): SessionConvo[] {
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) ? rows as SessionConvo[] : [];
  } catch { return []; }
}

function messageTime(ts: number): string {
  return Number.isFinite(ts) && ts > 0 ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(ts) : "";
}

function detailTime(value: string | null | undefined): string {
  if (!value) return "未知";
  const timestamp = parseBusinessTime(value);
  return Number.isNaN(timestamp) ? "数据未同步" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function lastMessage(convo: SessionConvo): SessionMsg | undefined {
  return [...convo.messages].reverse().find((message) => message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && (message.sender === "user" || message.sender === "agent"));
}

function PrivateImage({ id, onRevoked }: { id: string; onRevoked: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const onRevokedRef = useRef(onRevoked);
  onRevokedRef.current = onRevoked;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setUrl("");
    setError("");
    supportClient.attachmentContent(id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch((cause: unknown) => { if (!controller.signal.aborted) { if (lostPermission(cause)) onRevokedRef.current(); else setError(displayAdminError(cause)); } });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, retry]);
  if (error) return <span role="alert">图片暂无法查看：{error} <button className="l-btn sm" type="button" onClick={() => setRetry((value) => value + 1)}>重试</button></span>;
  return url ? <img src={url} alt="会话图片" style={{ maxWidth: "min(100%, 320px)", maxHeight: 260, borderRadius: 10, objectFit: "contain" }} /> : <span>图片加载中…</span>;
}

function SupportMessage({message,previous,customerId,customerAvatarRef,customerName,onRevoked,newlyArrived}:{message:SessionMsg;previous?:SessionMsg;customerId:string;customerAvatarRef?:string|null;customerName:string;onRevoked:()=>void;newlyArrived?:boolean}) {
  const session=useAdminAuth(state=>state.session);
  const domains=session?resolveVisibleDomains(session):[];
  const canCheckSku=Boolean(session?.authorities.includes("device_e1_read")&&canAccessResolvedPath(domains,"/devices/pricing"));
  const system=message.sourceSenderType==="SYSTEM"||message.sourceSenderType==="INTERNAL";
  const name=system?"系统":message.sender==="agent"?message.agentName||"历史专属客服":customerName;
  const grouped=!system&&previous?.sourceSenderType===message.sourceSenderType&&previous?.sender===message.sender&&message.authorConfidence==="VERIFIED"&&previous.authorConfidence==="VERIFIED"&&previous.senderId===message.senderId&&message.ts-previous.ts<300000;
  const path=message.authorConfidence==="VERIFIED"&&message.senderId?(message.sender==="agent"?message.senderAvatar?advisorAvatarPath(message.senderId,customerId):undefined:String(message.senderId)===customerId?customerAvatarRef??undefined:undefined):undefined;
  const safeLegacy=message.kind==="TEXT"||!message.kind?legacySupportDestination(message.text):undefined;
  const canCheckLegacy=Boolean(safeLegacy&&canAccessResolvedPath(domains,safeLegacy)&&(safeLegacy!=="/devices/pricing"||canCheckSku));
  const imageCaption=message.kind==="IMAGE"?message.text.trim():"";
  // System notices are not anyone's speech: a centred strip without bubble, avatar or receipt (M-11).
  if(message.sourceSenderType==="SYSTEM")return <div className="m3-system-note" role="note"><span>{(message).text}</span><time>{messageTime(message.ts)}</time></div>;
  if(message.sourceSenderType==="INTERNAL")return <div className="m3-internal-note" role="note"><span className="m3-internal-note-label">内部备注 · {message.agentName&&message.agentName!=="系统"?message.agentName:"客服"} · {messageTime(message.ts)}</span><span style={{whiteSpace:"pre-wrap"}}>{(message).text}</span></div>;
  return <div className={`m3-message ${system?"system":message.sender==="agent"?"agent":""}${newlyArrived&&!system?" m3-new-message":""}`}>
    {!system&&(grouped?<span style={{width:28,flexShrink:0}}/>:<SupportAvatar name={name} path={path} version={message.senderAvatar?.version} size={28}/>)}
    <div className="m3-message-copy">
      {!grouped&&<span className="m3-message-author">{name}{!system&&message.authorConfidence!=="VERIFIED"?" · 作者身份未确认":""} · {messageTime(message.ts)}</span>}
      <div className={`msg-bubble ${message.sender==="agent"?"agent":"user"}`}>
        {message.kind==="IMAGE"?message.attachmentId?<PrivateImage id={message.attachmentId} onRevoked={onRevoked}/>:"图片暂不可用":<span style={{whiteSpace:"pre-wrap"}}>{(message).text}</span>}
        {imageCaption&&imageCaption!=="[图片]"&&<div className="m3-image-caption" style={{whiteSpace:"pre-wrap",marginTop:8}}>{message.text}</div>}
        {message.kind==="SKU"&&<div><strong>{(message.skuName ?? "")}</strong><p>商品编号：{message.skuId}</p>{message.targetAvailability==="UNAVAILABLE"?<span>商品已不可用；原推荐保留。</span>:canCheckSku?<a href={`/devices/pricing?query=${encodeURIComponent(message.skuId??"")}`}>核对商城商品</a>:<span aria-disabled="true">核对商城商品（无访问权限）</span>}</div>}
        {message.kind==="LINK"&&<p>{message.targetAvailability==="UNAVAILABLE"?"目标页面已不可用":`客户端目标：${{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[message.linkTarget?.type??"HOME"]}`}</p>}
        {safeLegacy&&(canCheckLegacy?<a href={safeLegacy}>核对原推荐页面</a>:<span aria-disabled="true">核对原推荐页面（无访问权限）</span>)}
      </div>
      {/* M-29: delivered is the normal case and says nothing; only 已读 or a missing message id is worth showing. */}
      {!system&&message.sender==="agent"&&(message.status==="read"||!message.id)&&<small className={`m3-message-receipt${message.id?"":" warn"}`}>{message.status==="read"?"已读":"提交状态未知"}</small>}
    </div>
  </div>;
}

function SupportContactPicker({onClose,onSelect}:{onClose:()=>void;onSelect:(id:string)=>void}) {
  const adminId=useAdminAuth(s=>s.session?.adminId),epoch=useAdminAuth(s=>s.authEpoch);
  const [keyword,setKeyword]=useState(""),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[rows,setRows]=useState<Awaited<ReturnType<typeof supportClient.customers>>|null>(null),[error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController();setRows(null);setError("");supportClient.customers({mode:"PERSONAL",pageNum:page,pageSize:10,filter:"ALL",keyword,signal:controller.signal}).then(p=>{if(!controller.signal.aborted)setRows(p);}).catch(e=>{if(!controller.signal.aborted)setError(displayAdminError(e));});return()=>controller.abort();},[keyword,page,retry,epoch]);
  return <Modal title="主动联系本人客户" icon="users" onClose={onClose} footer={<button className="btn btn-sec btn-sm" onClick={onClose}>取消</button>}><label>搜索客户姓名或编码<input className="fld" value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1);}}/></label><p>只可向当前本人客户发送；不再维护客户可在原求助会话中继续普通服务回复。</p>{error?<p role="alert">{error}<button className="l-btn sm" onClick={()=>setRetry(n=>n+1)}>重试客户列表</button></p>:!rows?<p role="status">正在加载客户…</p>:<>{!rows.records.length&&<p>暂无匹配的客户。</p>}{rows.records.map(c=><button className="l-btn sm" key={c.customerId} disabled={c.agentAdminId!==adminId||!c.maintenanceEnabled} onClick={()=>onSelect(c.customerId)}>{c.displayName||c.customerNo||c.customerId} · {c.customerNo||"编码未知"}{!c.maintenanceEnabled?" · 不再维护":c.agentAdminId!==adminId?" · 当前归属其他专属客服":""}</button>)}<div className="m-admin-toolbar"><button className="l-btn sm" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page} 页 · {rows.total} 位</span><button className="l-btn sm" disabled={page*10>=rows.total} onClick={()=>setPage(n=>n+1)}>下一页</button></div></>}</Modal>;
}

function CustomerHistoryMessages({ conversation, ctx, customerName, loadEnabled }: { conversation: SessionConvo; ctx: MCtx; customerName: string; loadEnabled: boolean }) {
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const load = ctx.loadConversationDetail;
  useEffect(() => {
    if (!loadEnabled || conversation.detailReady) return;
    const controller = new AbortController();
    void load(conversation.id, controller.signal).catch(cause => { if (!controller.signal.aborted) { if (lostPermission(cause)) ctx.invalidateScope(conversation.id,conversation.customerId); else setError(displayAdminError(cause)); } });
    return () => controller.abort();
  }, [conversation.id, conversation.version, conversation.detailReady, loadEnabled, load, retry]);
  const unread = conversation.detailReady ? [...conversation.messages].reverse().find(message => message.sender === "user" && message.id && message.status !== "read")?.id : undefined;
  useEffect(() => {
    if (!unread) return;
    const controller = new AbortController();
    void markMConversationRead(conversation.id,unread,controller.signal).catch(cause => { if (!controller.signal.aborted) setError(displayAdminError(cause)); });
    return () => controller.abort();
  },[conversation.id,unread,retry]);
  return <section aria-label="历史消息">{error && <p role="alert">历史消息加载失败：{error}<button type="button" onClick={()=>{setError("");setRetry(n=>n+1);}}>重试</button></p>}{!conversation.detailReady && <p role="status">正在加载历史消息…</p>}</section>;
}

type ListTab = "pending" | "unassigned" | "open" | "all" | "archived";
const LIST_TABS: Array<[ListTab, string]> = [["pending", "待回复"], ["unassigned", "待分配"], ["open", "进行中"], ["all", "全部"], ["archived", "归档"]];
const LIST_CHUNK = 30;
/** M-22/M-23: rows are customers (customerConversations); waiting customers first, longest wait first. */
function tabMatch(row: SessionConvo, tab: ListTab): boolean {
  if (tab === "archived") return row.archived === true;
  if (row.archived) return false;
  if (tab === "unassigned") return row.ownerUnbound === true;
  if (tab === "pending") return (row.pendingReplyCount ?? 0) > 0 && row.ownerUnbound !== true;
  if (tab === "open") return row.status === "open";
  return true;
}

export function M3DedicatedChat({ ctx }: { ctx: MCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const adminId = session?.adminId ?? 0;
  const scopeIdentity = `${authEpoch}:${adminId}`;
  const [reviewScope, setReviewScope] = useState<{ identity: string; mode: SupportReadMode } | null>(null);
  const [reviewScopeError, setReviewScopeError] = useState("");
  const [scopeRetry, setScopeRetry] = useState(0);
  const reviewGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), generation = ++reviewGeneration.current;
    setReviewScope(null); setReviewScopeError("");
    if (adminId) void supportClient.overview({ signal: controller.signal }).then(({ scope }) => {
      if (controller.signal.aborted || generation !== reviewGeneration.current || scope.actorId !== adminId) return;
      setReviewScope({ identity: scopeIdentity, mode: scope.mode });
    }).catch(() => { if (!controller.signal.aborted && generation === reviewGeneration.current) { setReviewScope(null); setReviewScopeError("当前会话范围暂时无法核对。请重试。"); } });
    const invalidate = () => { controller.abort(); reviewGeneration.current++; setReviewScope(null); setScopeRetry(value => value + 1); };
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => { controller.abort(); reviewGeneration.current++; window.removeEventListener("support-scope-invalidated", invalidate); };
  }, [adminId, scopeIdentity, scopeRetry]);
  const canWriteM3 = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities?.includes("service_m3_write"));
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const selectionRestored = useRef(false);
  // A deep link or restored selection opens in whichever inbox scope holds it (supervisors default to "mine").
  const followSelection = useRef(false);
  const [screen, setScreen] = useState<"list" | "chat" | "profile">("list");
  const [query, setQuery] = useState("");
  const [listTab, setListTab] = useState<ListTab>(() => { const tab = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"); return LIST_TABS.some(([value]) => value === tab) ? tab as ListTab : "pending"; }), [listLimit, setListLimit] = useState(LIST_CHUNK), [archiveIds, setArchiveIds] = useState<Set<string>>(new Set());
  const [contentChoice, setContentChoice] = useState<SelectedSupportContent | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const alertPrefs = useSupportAlertPrefs();
  // M-28: archiving is an occasional batch task; checkboxes only appear while it is switched on.
  const [archiveMode, setArchiveMode] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false), [contactOpen, setContactOpen] = useState(false), [assignOpen, setAssignOpen] = useState(false);
  const [timeoutOpen, setTimeoutOpen] = useState(false), [timeoutPolicy, setTimeoutPolicy] = useState<ConversationTimeoutPolicy | null>(null), [timeoutError, setTimeoutError] = useState(""), [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutInput,setTimeoutInput]=useState<{warnMinutes:number;closeMinutes:number;reason:string}|undefined>(undefined);
  const [timeoutPending, setTimeoutPending] = useState<TimeoutCommand | null>(null), [timeoutConflict, setTimeoutConflict] = useState(false), [timeoutLatest, setTimeoutLatest] = useState<ConversationTimeoutPolicy | null>(null), [timeoutReadOnly, setTimeoutReadOnly] = useState(false);
  const timeoutIdentityRef = useRef("");
  timeoutIdentityRef.current = `${authEpoch}:${adminId}:${session?.role === "super" || session?.role === "superadmin"}:${Boolean(session?.authorities?.includes("service_m3_read"))}:${Boolean(session?.authorities?.includes("service_m3_timeout_manage"))}`;
  const scopeGeneration = useRef(0);
  const [draftOwner, setDraftOwner] = useState(0), [metaTarget, setMetaTarget] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Saved drafts may still carry a purpose; it is now derived from the explicit 联系维护 switch below (M-26 / M-54).
  const [pending, setPending] = useState<Pending | null>(null);
  const [recoveries, setRecoveries] = useState<Array<{ slot: string; locator: PrivateMessageRecovery }>>([]);
  const [recoveryError, setRecoveryError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState("");
  const [sendError, setSendError] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [attachmentPolicy, setAttachmentPolicy] = useState<SupportAttachmentPolicy | null>(null);
  const [attachmentPolicyError, setAttachmentPolicyError] = useState("");
  const [attachmentPolicyRetry, setAttachmentPolicyRetry] = useState(0);
  const attachmentRef = useRef<Attachment | null>(null);
  const imageSelectionRef = useRef(0);
  const uploadControllerRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatColumnRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [firstDetail, setFirstDetail] = useState<SupportCustomerDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [profileDetail, setProfileDetail] = useState<SupportCustomerDetail | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [conversationError, setConversationError] = useState("");
  const [conversationRetry, setConversationRetry] = useState(0);
  const [closedCandidateError, setClosedCandidateError] = useState("");
  const [closedCandidateRetry, setClosedCandidateRetry] = useState(0);
  const [firstPending, setFirstPending] = useState<{ key: string; body: string; intent: Intent; clientMessageId: string; customerId: string; assignmentId: string; version: number; replyTargets: Array<{ conversationNo: string; throughMessageId: number }> } | null>(null);
  const [readError, setReadError] = useState("");
  const [readRetry, setReadRetry] = useState(0);
  const [selectedClosedIds, setSelectedClosedIds] = useState<Set<string>>(() => new Set());
  const [includeCurrentReply, setIncludeCurrentReply] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionChecking, setActionChecking] = useState(false);
  const [ticketLinks, setTicketLinks] = useState<Record<string, string>>({});
  const markedRef = useRef("");
  const identityRef = useRef("");
  identityRef.current = `${authEpoch}:${adminId}:${scopeGeneration.current}`;
  const [revokedIds, setRevokedIds] = useState<Set<string>>(() => new Set());
  const seenMessages=useRef<{conversationId:string;ids:Set<number>}|null>(null),[newMessageIds,setNewMessageIds]=useState<Set<number>>(new Set());

  const conversationsAvailable = ctx.pget("I.session.conversationsAvailable") === "1";
  const requestedCustomerIdValid = requestedCustomerId === null || validCustomerId(requestedCustomerId);
  const conversationSource = ctx.pget(CONVO_KEY);
  const all = useMemo(() => parseConversations(conversationSource), [conversationSource]);
  const agents = useMemo(() => {
    try { return JSON.parse(ctx.pget("I.support.agents") ?? "[]") as Array<{ adminId: number; seatType?: string; position?: string }>; }
    catch { return []; }
  }, [ctx.params, ctx]);
  const myAgent = agents.find((agent) => agent.adminId === adminId);
  const scopeMode = reviewScope?.identity === scopeIdentity ? reviewScope.mode : undefined;
  const canReviewAll = scopeMode === "MANAGED" || scopeMode === "ALL";
  const qualificationUnknown = scopeMode === undefined || session?.role !== "superadmin" && session?.role !== "super"
    && Boolean(session?.authorities?.includes("service_m1_read")) && ctx.pget("I.support.agentsAvailable") !== "1";
  const qualificationRef = useRef(qualificationUnknown);
  if (qualificationRef.current !== qualificationUnknown) {
    qualificationRef.current = qualificationUnknown;
    scopeGeneration.current += 1;
    identityRef.current = `${authEpoch}:${adminId}:${scopeGeneration.current}`;
  }
  const visible = useMemo(() => qualificationUnknown ? [] : all.filter((convo) => validCustomerId(customerIdOf(convo)) && !revokedIds.has(convo.id) && (canReviewAll || convo.ownerAdminId === adminId)).sort((a, b) => b.lastTs - a.lastTs), [all, canReviewAll, adminId, revokedIds, qualificationUnknown]);
  // M-27: supervisors switch between their own customers and reviewing the team, optionally one advisor at a time.
  const [scopeView, setScopeView] = useState<"mine" | "team" | null>(null), [agentFilter, setAgentFilter] = useState<number | 0>(0);
  const hasOwn = visible.some((convo) => convo.ownerAdminId === adminId);
  const reviewing = canReviewAll && (scopeView ?? (hasOwn && listTab !== "unassigned" ? "mine" : "team")) === "team";
  const scoped = useMemo(() => !canReviewAll ? visible : reviewing ? visible.filter((convo) => convo.ownerAdminId !== adminId && (!agentFilter || convo.ownerAdminId === agentFilter)) : visible.filter((convo) => convo.ownerAdminId === adminId), [visible, canReviewAll, reviewing, agentFilter, adminId]);
  const teamAgents = useMemo(() => [...new Map(visible.filter((convo) => convo.ownerAdminId && convo.ownerAdminId !== adminId).map((convo) => [convo.ownerAdminId!, convo.owner])).entries()], [visible, adminId]);
  const customerRows = customerConversations(scoped);
  const tabs = LIST_TABS.filter(([value]) => value !== "unassigned" || reviewing);
  const filtered = customerRows.filter(convo => tabMatch(convo,listTab) && (!query.trim() || [convo.customer ?? "", convo.profile?.nickname ?? "", convo.profile?.uid ?? "", customerIdOf(convo), convo.id].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))))
    .sort(listTab === "pending" || listTab === "unassigned" ? (a, b) => (a.pendingReplySince ?? Infinity) - (b.pendingReplySince ?? Infinity) : (a, b) => (b.lastHumanTs ?? b.lastTs) - (a.lastHumanTs ?? a.lastTs));
  const listRows = filtered.slice(0, listLimit);
  const requestedConvo = validCustomerId(requestedCustomerId) ? customerRows.find((convo) => customerIdOf(convo) === requestedCustomerId) : null;
  const selectedCustomer = visible.find(row=>row.id===selectedId)?.customerId;
  const selected = requestedCustomerId ? requestedConvo ?? null : selectedId ? customerRows.find(row=>row.customerId===selectedCustomer) ?? null : customerRows.find(convo=>!convo.archived) ?? null;
  const customerHistory = visible.filter(row => row.customerId === selected?.customerId && row.id !== selected?.id).sort((a,b) => a.lastTs-b.lastTs);
  const threadMessages = [...new Map([...(selected?.messages ?? []), ...customerHistory.flatMap(row=>row.detailReady ? row.messages : [])].map(message=>[message.id ?? `${message.ts}:${message.sender}:${message.text}`,message])).values()].sort((a,b)=>a.ts-b.ts || (a.id??0)-(b.id??0));
  // M-9: snapshots replace details, so the open thread would blank on every refresh. Keep showing its last loaded
  // messages until the reloaded detail arrives, only for the same customer thread, owner and binding.
  const lastShown = useRef<{ id: string; owner: SessionConvo["ownerAdminId"]; assignment: SessionConvo["assignmentId"]; messages: SessionMsg[] } | null>(null);
  if (selected?.detailReady) lastShown.current = { id: selected.id, owner: selected.ownerAdminId, assignment: selected.assignmentId, messages: threadMessages };
  const paneMessages = selected?.detailReady ? threadMessages
    : selected && lastShown.current?.id === selected.id && lastShown.current.owner === selected.ownerAdminId && lastShown.current.assignment === selected.assignmentId ? lastShown.current.messages : null;
  const [timeoutNow, setTimeoutNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setTimeoutNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { let current = true; void fetchMConversationTimeoutPolicy().then(policy => { if(current) setTimeoutPolicy(policy); }).catch(() => {}); return () => { current = false; }; }, [authEpoch]);
  const canContinueClosed = Boolean(canWriteM3 && selected?.detailReady && selected.status !== "open" && selected.ownerAdminId === adminId);
  const historyReadOnlyHint = (selected?.status === "transferred" ? "此会话已转出，仅可查看历史。" : "历史会话只读。") + (canContinueClosed ? "前往当前会话会重新核对专属客服归属。" : "");
  // M-26 / M-54: messages are service replies by default. Per SPEC FEAT-M04 and CONTRACTS §5 (owner decision R05),
  // maintenance is counted only through an explicit 联系维护 intent, so it is an opt-in switch, never inferred.
  const intentSource = requestedCustomerId && !selected ? firstDetail : profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const [maintenanceChosen, setMaintenanceChosen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intent") === "maintenance");
  const maintenanceOffered = Boolean(intentSource?.maintenanceEnabled && (intentSource.due === true || maintenanceChosen));
  const intent: Intent = maintenanceChosen && intentSource?.maintenanceEnabled ? "MAINTENANCE" : "SERVICE";
  const replyCustomerId = selected ? canSendTo(selected, adminId) ? customerIdOf(selected) : null : requestedCustomerId;
  const closedCandidateRows = replyCustomerId ? visible.filter((convo) => customerIdOf(convo) === replyCustomerId && convo.ownerAdminId === adminId && convo.id !== selected?.id && convo.pendingReplyCount !== 0) : [];
  const closedCandidateMissing = closedCandidateRows.filter((convo) => (intent === "SERVICE" || selectedClosedIds.has(convo.id)) && !convo.detailReady).map((convo) => convo.id);
  const closedReplyCandidates = closedCandidateRows.filter((convo) => convo.detailReady).flatMap((convo) => {
    const latest = [...convo.messages].reverse().find((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id));
    return latest?.sender === "user" && Number.isSafeInteger(latest.id) ? [{ conversationNo: convo.id, throughMessageId: latest.id!, text: latest.text }] : [];
  });
  const closedReplyTargets = closedReplyCandidates.filter((row) => intent === "SERVICE" || selectedClosedIds.has(row.conversationNo)).map(({ conversationNo, throughMessageId }) => ({ conversationNo, throughMessageId }));
  const closedCandidatesReady = closedCandidateMissing.length === 0 && (Boolean(selected) || !closedCandidateError) && [...selectedClosedIds].every((id) => closedReplyCandidates.some((row) => row.conversationNo === id));
  const displayedIntent = pending?.intent ?? firstPending?.intent ?? intent;
  const lockedTargets = firstPending?.replyTargets ?? pending?.message.replyTargets ?? [];
  const displayedClosedIds = new Set([...selectedClosedIds, ...lockedTargets.map((target) => target.conversationNo)]);
  const activeConversationRef=useRef(selected?.id);activeConversationRef.current=selected?.id;
  const realtime = useSyncExternalStore(subscribeAdminRealtime, getAdminRealtimeSnapshot, getAdminRealtimeSnapshot);
  const presence = realtime.ready && realtime.presence?.conversationNo === selected?.id ? realtime.presence : null;
  useEffect(() => {
    watchAdminConversation(conversationsAvailable ? selected?.id ?? null : null);
    return () => { sendAdminTyping(false); watchAdminConversation(null); };
  }, [selected?.id, conversationsAvailable, adminId, authEpoch]);
  const selectedUnbound = selected?.ownerUnbound === true;
  // M-25: only a thread this account can answer shows the editor; unassigned and supervisor review get one clear next step.
  const composerMode: "write" | "unbound" | "review" = !selected ? "write" : selectedUnbound ? "unbound" : selected.ownerAdminId !== adminId ? "review" : "write";
  const canAssign = Boolean(canReviewAll && selectedUnbound && selected?.customerId);
  const firstProfileCustomer = !selected && conversationsAvailable && firstDetail?.assignmentId && firstDetail.customerId === requestedCustomerId && (canReviewAll || firstDetail.agentAdminId === adminId) ? firstDetail : null;
  const profileCustomerId = selected && !selectedUnbound ? selected.customerId : firstProfileCustomer?.customerId;
  const currentProfileDetail = profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const ticketRows = (() => { try { const rows: unknown = JSON.parse(ctx.pget("I.support.tickets") ?? "[]"); return Array.isArray(rows) ? rows as Array<{ id?: string }> : []; } catch { return []; } })();
  const linkedTicketNo = selected && ctx.pget("I.support.ticketsAvailable") === "1" && ticketRows.some((ticket) => ticket.id === ticketLinks[selected.id]) ? ticketLinks[selected.id] : null;
  const targetKey = selected?.id ?? (requestedCustomerId ? `first:${requestedCustomerId}` : "");
  const draft = drafts[targetKey] ?? "";
  const recoveryBlocksTarget = recoveries.some(({ locator }) => Boolean(locator.conversationId && locator.conversationId === selected?.id) || Boolean(locator.customerId && locator.customerId === (selected?.customerId ?? requestedCustomerId)));
  const writable = !qualificationUnknown && !recoveryBlocksTarget && canWriteM3 && (selected ? selected.detailReady === true && closedCandidatesReady && canSendTo(selected, adminId) && Boolean(currentProfileDetail?.assignmentId && currentProfileDetail.agentAdminId === selected.ownerAdminId) : Boolean(validCustomerId(requestedCustomerId) && closedCandidatesReady && firstDetail?.assignmentId && firstDetail.agentAdminId === adminId));
  const lostAccess = Boolean(!qualificationUnknown && conversationsAvailable && selectedId && !requestedCustomerId && !visible.some((convo) => convo.id === selectedId));
  const unreadMessageId = selected?.detailReady ? [...selected.messages].reverse().find((message) => message.sender === "user" && message.id && message.status !== "read")?.id : undefined;
  useEffect(()=>{
    if(!selected?.detailReady)return;
    const ids=new Set(selected.messages.flatMap(m=>Number.isSafeInteger(m.id)?[m.id!]:[])),previous=seenMessages.current;
    setNewMessageIds(new Set(previous?.conversationId===selected.id?[...ids].filter(id=>!previous.ids.has(id)):[]));
    seenMessages.current={conversationId:selected.id,ids};
    const timer=setTimeout(()=>setNewMessageIds(new Set()),180);return()=>clearTimeout(timer);
  },[selected?.id,selected?.detailReady,selected?.messages]);

  const loadConversationDetail = ctx.loadConversationDetail;
  useEffect(() => {
    if (!selected || selected.detailReady || !conversationsAvailable || conversationError) return;
    const controller = new AbortController();
    void loadConversationDetail(selected.id, controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, selected.customerId);
      } else setConversationError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [selected?.id, selected?.version, selected?.ownerAdminId, selected?.detailReady, conversationsAvailable, authEpoch, conversationRetry, conversationError, loadConversationDetail]);
  useEffect(() => { setConversationError(""); }, [selected?.id, selected?.version, selected?.lastTs, authEpoch]);

  useEffect(() => {
    if (selected || !replyCustomerId || !conversationsAvailable || !closedCandidateMissing.length || closedCandidateError) return;
    const controller = new AbortController();
    void loadConversationDetail(closedCandidateMissing[0], controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(closedCandidateMissing[0], replyCustomerId);
      } else setClosedCandidateError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [selected?.id, replyCustomerId, closedCandidateMissing.join("|"), conversationsAvailable, authEpoch, closedCandidateRetry, closedCandidateError, loadConversationDetail]);
  useEffect(() => { setClosedCandidateError(""); }, [replyCustomerId, authEpoch]);

  useEffect(() => {
    if (selected && writable && ctx.pget("I.session.ui.lastConvo") !== selected.id) {
      void ctx.setParam("I.session.ui.lastConvo", selected.id, { action: "持续接待窗口 选择会话", reason: "ui-state" });
    }
  }, [selected?.id, writable, ctx]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conversationNo = params.get("conversationNo");
    setRequestedCustomerId(conversationNo ? null : params.get("customerId"));
    if (conversationNo) setSelectedId(conversationNo);
    if (conversationNo || params.get("customerId")) selectionRestored.current = true;
    if (conversationNo || params.get("customerId")) followSelection.current = true;
    if (conversationNo || params.get("customerId")) setScreen("chat");
  }, []);
  useEffect(() => {
    if (selectionRestored.current || !conversationsAvailable || qualificationUnknown) return;
    selectionRestored.current = true;
    const saved = ctx.pget("I.session.ui.lastConvo");
    if (saved && visible.some(convo => convo.id === saved && !convo.archived)) { setSelectedId(saved); followSelection.current = true; }
  }, [conversationsAvailable, visible, ctx, qualificationUnknown]);
  useEffect(() => {
    if (!followSelection.current || !conversationsAvailable) return;
    const target = requestedCustomerId ? visible.find((convo) => customerIdOf(convo) === requestedCustomerId) : selectedId ? visible.find((convo) => convo.id === selectedId) : undefined;
    if (!target && requestedCustomerId === null && !selectedId) return;
    followSelection.current = false;
    if (!target || !canReviewAll) return;
    setAgentFilter(0);
    setScopeView(target.ownerAdminId === adminId ? "mine" : "team");
  }, [conversationsAvailable, visible, requestedCustomerId, selectedId, canReviewAll, adminId]);

  const clearAttachment = useCallback((cancel = true) => {
    imageSelectionRef.current += 1;
    uploadControllerRef.current?.abort();
    uploadControllerRef.current = null;
    const current = attachmentRef.current;
    if (!current) return;
    URL.revokeObjectURL(current.url);
    if (cancel && current.id) void supportClient.cancelAttachment(current.id, newKey()).catch(() => undefined);
    attachmentRef.current = null;
    setAttachment(null);
  }, []);
  const readRecoveries = useCallback(() => {
    setRecoveries(pendingMessages.list().flatMap(record => {
      if (record.fingerprint !== pendingKey(adminId) && !record.fingerprint.startsWith(`${pendingKey(adminId)}:recovery:`) && !record.fingerprint.startsWith(`nexion-m3-first-pending:${adminId}:`)) return [];
      try {
        const value = JSON.parse(record.payload), locator = value.readOnlyRecovery === true ? privateMessageRecovery(value) : null;
        if (!locator) return [];
        const slot=recoveryKey(adminId, record.commandKey);
        if (slot!==record.fingerprint) { pendingMessages.forget(record.fingerprint, record.commandKey); rememberPending(slot, record.commandKey, locator); }
        return [{ slot, locator }];
      } catch { return []; }
    }));
  }, [adminId]);
  const revokeCustomer = useCallback((customerId?: string, authoritative = false) => {
    // A pending roster is not evidence that access was revoked. Server denials still clear immediately.
    if (qualificationUnknown && !authoritative) return;
    scopeGeneration.current += 1; identityRef.current = `${authEpoch}:${adminId}:${scopeGeneration.current}`; setActionChecking(false);
    setRecoveryBusy(""); setBusy(false);
    const affected = all.filter((convo) => !customerId || customerIdOf(convo) === customerId).map((convo) => convo.id);
    for (const record of pendingMessages.list()) {
      if (!record.fingerprint.startsWith(`nexion-m3-first-pending:${adminId}:`) && !record.fingerprint.startsWith(`${pendingKey(adminId)}:recovery:`) && record.fingerprint !== pendingKey(adminId)) continue;
      try {
        const payload=JSON.parse(record.payload);
        if (!customerId || payload.customerId===customerId || affected.includes(payload.conversationId)) {
          const locator=privateMessageRecovery(payload);
          if (!locator) {
            pendingMessages.forget(record.fingerprint, record.commandKey);
            if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]) throw new Error("Private body not removed");
            continue;
          }
          const slot=recoveryKey(adminId, record.commandKey);
          pendingMessages.forget(record.fingerprint, record.commandKey);
          rememberPending(slot, record.commandKey, locator);
          // Retry the smaller persisted row without deleting unrelated messages or legacy timeout commands.
          if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]?.payload !== JSON.stringify(locator)) {
            const persisted = JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}");
            const original = persisted[record.commandKey];
            if (!original || original.commandKey !== record.commandKey) throw new Error("Private recovery row unavailable");
            persisted[record.commandKey] = { ...original, fingerprint: slot, payload: JSON.stringify(locator) };
            try { sessionStorage.setItem("nexion-admin-m3-private-pending-v1", JSON.stringify(persisted)); }
            catch {
              // If even a smaller replacement is refused, erase private bodies and retain timeout lineage only.
              let durable = false;
              try {
                const timeouts: Record<string, StoredMessage> = {};
                for (const [key, value] of Object.entries(persisted)) {
                  const row = value as StoredMessage;
                  if (!/^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint)) continue;
                  const saved = JSON.parse(row.payload) as TimeoutCommand;
                  parseMConversationTimeoutPolicy(saved.policy);
                  if (saved.key !== key || row.commandKey !== key || !Number.isFinite(row.createdAt) || !Number.isFinite(row.expiresAt) || row.expiresAt <= Date.now() || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || typeof saved.operator !== "string" || !saved.input || !Number.isInteger(saved.input.warnMinutes) || saved.input.warnMinutes < 1 || saved.input.warnMinutes > 30 || !Number.isInteger(saved.input.closeMinutes) || saved.input.closeMinutes <= saved.input.warnMinutes || saved.input.closeMinutes > 120 || typeof saved.input.reason !== "string" || saved.input.reason.trim().length < 6 || saved.input.reason.trim().length > 200) throw new Error("Timeout recovery row invalid");
                  timeouts[key] = row;
                }
                const preserveTimeouts = () => {
                  const target = JSON.parse(sessionStorage.getItem("nexion-admin-m3-timeout-pending-v1") || "{}");
                  for (const [key, row] of Object.entries(timeouts)) {
                    if (target[key] && JSON.stringify(target[key]) !== JSON.stringify(row)) throw new Error("Timeout recovery row conflict");
                    target[key] = row;
                  }
                  if (Object.keys(timeouts).length) sessionStorage.setItem("nexion-admin-m3-timeout-pending-v1", JSON.stringify(target));
                  const stored = JSON.parse(sessionStorage.getItem("nexion-admin-m3-timeout-pending-v1") || "{}");
                  return Object.keys(timeouts).length > 0 && Object.entries(timeouts).every(([key, row]) => JSON.stringify(stored[key]) === JSON.stringify(row));
                };
                try { preserveTimeouts(); } catch { /* Retry after privacy erasure frees quota. */ }
                sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
                durable = preserveTimeouts();
              } catch {
                // Invalid metadata or blocked migration must never retain revoked private bodies.
                sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
              }
              setRecoveryError(durable ? "原消息内容已清除。结果确认前请不要刷新或关闭页面。" : "原消息内容已清除，但浏览器没能保存恢复记录；请不要刷新或关闭页面。");
              continue;
            }
            if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]?.payload !== JSON.stringify(locator)) throw new Error("Private recovery row not stored");
          }
          if (!pendingMessages.isDurablyStored(slot, record.commandKey)) setRecoveryError("原消息编号仅保留在本页；恢复浏览器存储前请勿刷新或关闭页面，再重试查询。");
        }
      } catch {
        try {
          sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
          setRecoveryError("原消息内容已清除，但浏览器没能保存恢复记录；请不要刷新或关闭页面。");
        } catch {
          setRecoveryError("本地私聊缓存清理失败，旧消息正文可能仍留在本机；已关闭对应会话操作，请恢复浏览器存储后重试清理。");
        }
      }
    }
    readRecoveries();
    setRevokedIds((old) => new Set([...old, ...affected]));
    try {
      const saved = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string, unknown>;
      for (const key of Object.keys(saved)) if (affected.includes(key) || key === `first:${customerId}` || !customerId) delete saved[key];
      sessionStorage.setItem(`nexion-m3-drafts:${adminId}`, JSON.stringify(saved));
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(`nexion-m3-reply-targets:${adminId}:`) && (!customerId || affected.some(id => key.endsWith(`:${id}`)) || key.endsWith(`:first:${customerId}`))) sessionStorage.removeItem(key);
    } catch { setSendError("私聊记录清理失败，请退出当前账号后重新登录。"); }
    if (!customerId || pending && affected.includes(pending.conversationId)) setPending(null);
    if (!customerId || firstPending?.customerId === customerId) setFirstPending(null);
    setTicketLinks(old => { const next = { ...old }; for (const id of affected) delete next[id]; try { sessionStorage.setItem(ticketLinksKey(adminId), JSON.stringify(next)); } catch {} return next; });
    setDrafts((old) => {
      const next = { ...old };
      for (const conversationId of affected) delete next[conversationId];
      if (customerId) delete next[`first:${customerId}`];
      else for (const key of Object.keys(next)) if (key.startsWith("first:")) delete next[key];
      return next;
    });
    if (!customerId || selected?.customerId === customerId || requestedCustomerId === customerId) {
      sendAdminTyping(false); watchAdminConversation(null);
      setFirstDetail(null); setProfileDetail(null); setDetailError(""); setProfileError(""); setRequestedCustomerId(null); setSelectedId("");
      clearAttachment(pending?.kind !== "IMAGE"); setPending(null); setFirstPending(null); setBusy(false); setMetaTarget(""); setScreen("list"); setContentChoice(null); setBulkOpen(false); setContactOpen(false); setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); setArchiveIds(new Set());
    }
  }, [all, selected?.customerId, requestedCustomerId, clearAttachment, adminId, authEpoch, pending, firstPending, readRecoveries, qualificationUnknown]);
  useEffect(() => { setRecoveryError(""); setRecoveryBusy(""); readRecoveries(); }, [readRecoveries, authEpoch]);
  useEffect(() => {
    const onScope = (event: Event) => revokeCustomer((event as CustomEvent<{ customerId?: string }>).detail?.customerId, true);
    window.addEventListener("support-scope-invalidated", onScope);
    return () => window.removeEventListener("support-scope-invalidated", onScope);
  }, [revokeCustomer]);

  useEffect(() => { attachmentRef.current = attachment; }, [attachment]);
  useEffect(() => {
    if (!selected || !conversationsAvailable) { setAttachmentPolicy(null); return; }
    const controller = new AbortController();
    setAttachmentPolicy(null); setAttachmentPolicyError("");
    supportClient.attachmentPolicy(controller.signal)
      .then((policy) => { if (!controller.signal.aborted) setAttachmentPolicy(policy); })
      .catch(() => { if (!controller.signal.aborted) setAttachmentPolicyError("图片规则加载失败，请重试。"); });
    return () => controller.abort();
  }, [selected?.id, conversationsAvailable, authEpoch, attachmentPolicyRetry]);
  useEffect(() => {
    return () => {
      imageSelectionRef.current += 1;
      uploadControllerRef.current?.abort();
      uploadControllerRef.current = null;
      const current = attachmentRef.current;
      attachmentRef.current = null;
      if (current) {
        URL.revokeObjectURL(current.url);
        const waitingImage=pendingMessages.list().some(row=>{try{const saved=JSON.parse(row.payload);return saved.kind==="IMAGE"&&saved.attachmentId===current.id;}catch{return false;}});
        if (current.id && !waitingImage) void supportClient.cancelAttachment(current.id, newKey()).catch(() => undefined);
      }
    };
  }, []);
  useEffect(() => {
    setDrafts({}); setDraftOwner(0); setPending(null); setFirstPending(null); setSendError(""); setMaintenanceChosen(false); setBusy(false); setActionChecking(false); setRevokedIds(new Set()); setTicketLinks({}); setContentChoice(null); setBulkOpen(false); setContactOpen(false); setTimeoutOpen(false); seenMessages.current=null; setNewMessageIds(new Set()); clearAttachment();
  }, [authEpoch, clearAttachment]);
  useEffect(() => {
    setTimeoutOpen(false); setTimeoutPolicy(null); setTimeoutInput(undefined); setTimeoutPending(null); setTimeoutLatest(null); setTimeoutConflict(false); setTimeoutReadOnly(false); setTimeoutError(""); setTimeoutSaving(false);
  }, [authEpoch, adminId]);
  useEffect(() => {
    if (!adminId || !conversationsAvailable || qualificationUnknown) return;
    try {
      const value = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string,unknown>;
      setDrafts(Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==="string" && entry[1].length<=10000 && (visible.some(c=>c.id===entry[0]&&c.ownerAdminId===adminId) || /^first:\d+$/.test(entry[0])))));
    } catch { setSendError("草稿保存不可用；当前输入仍保留在此页面。"); }
    setDraftOwner(adminId);
  }, [adminId, authEpoch, conversationsAvailable, qualificationUnknown]);
  useEffect(() => {
    if (!adminId || draftOwner!==adminId || qualificationUnknown) return;
    try { sessionStorage.setItem(`nexion-m3-drafts:${adminId}`,JSON.stringify(drafts)); } catch { setSendError("草稿保存不可用；当前输入仍保留在此页面。"); }
  }, [drafts, adminId, draftOwner, qualificationUnknown]);
  useEffect(() => {
    if (qualificationUnknown) return;
    setMetaTarget(""); setContentChoice(null);
    try {
      const saved=JSON.parse(sessionStorage.getItem(`nexion-m3-reply-targets:${adminId}:${targetKey}`)??"{}");
      setSelectedClosedIds(new Set());
      setIncludeCurrentReply(saved.include===true); setMaintenanceChosen(saved.intent==="MAINTENANCE");
    } catch { setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); }
    setMetaTarget(targetKey);
  }, [targetKey, adminId, authEpoch, qualificationUnknown]);
  useEffect(() => {
    if(!adminId||!targetKey||metaTarget!==targetKey||qualificationUnknown)return;
    try { sessionStorage.setItem(`nexion-m3-reply-targets:${adminId}:${targetKey}`,JSON.stringify({ids:[...selectedClosedIds],include:includeCurrentReply,intent})); } catch { setSendError("回复范围无法保存在浏览器里，请在本页核对后操作。"); }
  }, [targetKey,metaTarget,adminId,selectedClosedIds,includeCurrentReply,intent,qualificationUnknown]);
  useEffect(()=>{setListLimit(LIST_CHUNK);setArchiveIds(new Set());},[query,listTab,authEpoch]);
  useEffect(() => {
    if (!adminId) return;
    try {
      const rows: unknown = JSON.parse(sessionStorage.getItem(ticketLinksKey(adminId)) ?? "{}");
      if (rows && typeof rows === "object" && !Array.isArray(rows)) setTicketLinks(Object.fromEntries(Object.entries(rows).filter(([conversationId, ticketNo]) => conversationId && typeof ticketNo === "string" && ticketNo)));
    } catch { setTicketLinks({}); }
  }, [adminId, authEpoch]);
  useEffect(() => {
    if (!adminId || !validCustomerId(requestedCustomerId) || qualificationUnknown) return;
    try {
      const raw = readPending(firstPendingKey(adminId, requestedCustomerId));
      const record = raw ? JSON.parse(raw) as NonNullable<typeof firstPending> : null;
      if (!record || "readOnlyRecovery" in record || record.customerId !== requestedCustomerId || !record.key || !record.clientMessageId || !record.assignmentId || !record.body) return;
      setFirstPending(record);
      setDrafts((old) => ({ ...old, [`first:${requestedCustomerId}`]: record.body }));
      setSendError("上次发送结果待确认。请用原命令查询并重试。");
    } catch { pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); }
  }, [adminId, requestedCustomerId, authEpoch, qualificationUnknown]);
  useEffect(() => {
    if (!adminId || !conversationsAvailable || pending || qualificationUnknown) return;
    try {
      const raw = readPending(pendingKey(adminId));
      const saved = raw ? JSON.parse(raw) as Pending : null;
      if (!saved?.conversationId || !saved.key || !saved.message?.clientMessageId || !saved.expectedAssignmentId || !Number.isSafeInteger(saved.expectedVersion) || saved.message.sender !== "agent" || saved.message.kind !== saved.kind || saved.message.intent !== saved.intent || saved.message.text !== saved.body || !["TEXT", "IMAGE", "SKU", "LINK"].includes(saved.kind)) return;
      const convo = visible.find((row) => row.id === saved.conversationId);
      if (!convo) { revokeCustomer(); return; }
      setPending(saved);
      if (!requestedCustomerId) setSelectedId(convo.id);
      if (saved.kind === "TEXT") setDrafts((old) => ({ ...old, [convo.id]: saved.body }));
      setSendError("上次发送结果待确认。请用原命令重试同一条消息。");
    } catch { pendingMessages.forget(pendingKey(adminId)); }
  }, [adminId, conversationsAvailable, authEpoch, visible, pending, requestedCustomerId, revokeCustomer, qualificationUnknown]);
  useEffect(() => { clearAttachment(); if (!pending && !firstPending) setSendError(""); }, [selected?.id, selected?.ownerAdminId, selected?.assignmentId, requestedCustomerId, clearAttachment]);
  useEffect(() => {
    if (!selected || !conversationsAvailable || selected.ownerAdminId !== adminId || document.visibilityState === "hidden" || !chatColumnRef.current?.getClientRects().length) return;
    if (!unreadMessageId) return;
    const marker = `${authEpoch}:${selected.id}:${unreadMessageId}`;
    if (markedRef.current === marker) return;
    markedRef.current = marker;
    const controller = new AbortController();
    setReadError("");
    void markMConversationRead(selected.id, unreadMessageId, controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
      } else setReadError(displayAdminError(cause));
    });
    return () => { controller.abort(); if (markedRef.current === marker) markedRef.current = ""; };
  }, [selected?.id, selected?.ownerAdminId, unreadMessageId, conversationsAvailable, adminId, authEpoch, readRetry, screen, revokeCustomer]);
  useEffect(() => {
    if (qualificationUnknown || !lostAccess && (!selected || selected.ownerAdminId === adminId || canReviewAll)) return;
    revokeCustomer(selected ? String(selected.customerId) : undefined); setSendError("当前已无权访问该会话，请返回客户列表刷新。");
  }, [lostAccess, selected, adminId, canReviewAll, revokeCustomer, qualificationUnknown]);

  useEffect(() => {
    if (!validCustomerId(requestedCustomerId) || requestedConvo || !conversationsAvailable || qualificationUnknown) { setFirstDetail(null); return; }
    const controller = new AbortController();
    const requestStamp = identityRef.current;
    setDetailLoading(true); setDetailError(""); setFirstDetail(null);
    supportClient.customerDetail(requestedCustomerId, controller.signal).then((result) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (!canReviewAll && result.agentAdminId !== adminId) {
        revokeCustomer(requestedCustomerId);
        return;
      }
      setFirstDetail(result);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (lostPermission(cause)) {
        revokeCustomer(requestedCustomerId, true);
      }
      setDetailError(displayAdminError(cause));
    })
      .finally(() => { if (!controller.signal.aborted && requestStamp === identityRef.current) setDetailLoading(false); });
    return () => controller.abort();
  }, [requestedCustomerId, requestedConvo, conversationsAvailable, detailRetry, authEpoch, adminId, canReviewAll, revokeCustomer]);
  useEffect(() => {
    if (!selected?.customerId || !conversationsAvailable || qualificationUnknown) { setProfileDetail(null); return; }
    if (selectedUnbound) { setProfileDetail(null); setProfileError(""); return; }
    const controller = new AbortController();
    const requestStamp = identityRef.current;
    setProfileDetail(null); setProfileError("");
    supportClient.customerDetail(String(selected.customerId), controller.signal).then((detail) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (!canReviewAll && detail.agentAdminId !== adminId) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
        return;
      }
      setProfileDetail(detail);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
      } else setProfileError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [selected?.id, selected?.customerId, selected?.version, selected?.lastTs, selected?.unread, selected?.detailReady, selected?.messages.length, selectedUnbound, conversationsAvailable, authEpoch, profileRetry, revokeCustomer, canReviewAll, adminId]);

  const select = (convo: SessionConvo) => {
    if (firstPending) { setSendError("首次联系的发送结果待确认，请先查询原命令结果，再切换会话。"); return; }
    clearAttachment(pending?.kind !== "IMAGE"); setRequestedCustomerId(null); setSelectedId(convo.id); setScreen("chat"); setMaintenanceChosen(false); setReadError(""); setSendError(pending ? "上条消息的结果待确认，请返回原会话用同一命令重试。" : "");
    const url = new URL(window.location.href); url.searchParams.delete("customerId"); url.searchParams.set("conversationNo",convo.id); window.history.replaceState(null, "", url);
  };

  const queryRecovery = async (slot: string, locator: PrivateMessageRecovery) => {
    if (recoveryBusy) return;
    const identity = identityRef.current;
    setRecoveryBusy(slot); setRecoveryError("");
    try {
      const result = await supportClient.command(locator.key);
      if (identityRef.current !== identity) return;
      if (result.status !== "SUCCEEDED" && result.status !== "FAILED") { setRecoveryError("原消息结果仍未确认，请稍后继续查询；不会重新发送。"); return; }
      pendingMessages.forget(slot); readRecoveries();
      setRecoveryError(result.status === "SUCCEEDED" ? "原消息已发送。请刷新会话查看。" : "原消息发送失败。重新发送前请核对当前归属。");
    } catch (cause) { if (identityRef.current === identity) setRecoveryError(`原消息结果暂无法查询：${displayAdminError(cause)}。编号已保留，不会重新发送。`); }
    finally { if (identityRef.current === identity) setRecoveryBusy(""); }
  };
  const send = async (kind: "TEXT" | "IMAGE" | "SKU" | "LINK", retry?: Pending) => {
    if (busy || !conversationsAvailable || recoveryBlocksTarget) return;
    sendAdminTyping(false);
    const identity = identityRef.current;
    if (firstPending || !selected) {
      if (kind !== "TEXT" || !validCustomerId(requestedCustomerId) || (!firstPending && (!closedCandidatesReady || !firstDetail?.assignmentId || firstDetail.agentAdminId !== adminId))) return;
      const record = firstPending ?? { key: newKey(), clientMessageId: crypto.randomUUID(), body: draft.trim(), intent, customerId: requestedCustomerId, assignmentId: firstDetail!.assignmentId!, version: firstDetail!.version, replyTargets: closedReplyTargets };
      if (!record.body) return;
      const stored = rememberPending(firstPendingKey(adminId, requestedCustomerId), record.key, record);
      setFirstPending(record);
      if (!stored) { setBusy(false); setSendError("浏览器无法保存这次发送的记录，消息还没发出；请检查浏览器设置后重试。"); return; }
      setBusy(true); setSendError("");
      let submitted = false;
      try {
        let conversationNo = "";
        if (firstPending) {
          const recovered = await supportClient.command(record.key).catch((cause: unknown) => {
            if (cause instanceof SupportClientError && cause.status === 404) return null;
            throw cause;
          });
          if (identityRef.current !== identity) return;
          if (!recovered) {
            submitted = true;
            const result = await supportClient.startConversation({ customerId: record.customerId, openingText: record.body, intent: record.intent, clientMessageId: record.clientMessageId, expectedAssignmentId: record.assignmentId, expectedVersion: record.version, replyTargets: record.replyTargets }, record.key);
            conversationNo = result.conversationNo;
          } else {
          if (recovered.status !== "SUCCEEDED" && recovered.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后用原命令重试。"); return; }
          if (recovered.status === "FAILED") { pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null); setSendError("消息发送失败。草稿已保留，可修改后重新发送。"); return; }
          const result = recovered.result;
          if (result && typeof result === "object" && "conversationNo" in result && typeof result.conversationNo === "string") conversationNo = result.conversationNo;
          }
        } else {
          submitted = true;
          const result = await supportClient.startConversation({ customerId: record.customerId, openingText: record.body, intent: record.intent, clientMessageId: record.clientMessageId, expectedAssignmentId: record.assignmentId, expectedVersion: record.version, replyTargets: record.replyTargets }, record.key);
          conversationNo = result.conversationNo;
        }
        let refreshFailed = false;
        try { await ctx.refreshConversations(); }
        catch { refreshFailed = true; setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
        if (identityRef.current !== identity) return;
        pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId));
        window.dispatchEvent(new Event("support-todo-changed"));
        setDrafts((old) => ({ ...old, [targetKey]: "" })); setFirstPending(null);
        if (conversationNo && !refreshFailed) { setSelectedId(conversationNo); setRequestedCustomerId(null); }
        if (!refreshFailed) { const url = new URL(window.location.href); url.searchParams.delete("customerId"); if(conversationNo)url.searchParams.set("conversationNo",conversationNo); window.history.replaceState(null, "", url); }
        setScreen("chat");
      } catch (cause) {
        if (identityRef.current === identity) {
          if (submitted && rejectedSend(cause)) {
            pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null);
            if (lostPermission(cause)) { ctx.invalidateScope(undefined, requestedCustomerId); setSendError("当前客户归属或会话权限已变化，请返回客户列表核对。"); }
            else { setDetailRetry((value) => value + 1); setSendError(`本次发送已被拒绝：${displayAdminError(cause)}。原文已保留，请核对客户归属后修改重发。`); }
          } else { if (lostPermission(cause)) ctx.invalidateScope(undefined, requestedCustomerId); setSendError(`发送失败或结果待确认：${displayAdminError(cause)} 请查询发送结果。`); }
        }
      }
      finally { if (identityRef.current === identity) setBusy(false); }
      return;
    }
    if (retry ? retry.conversationId !== selected.id : !writable || !currentProfileDetail?.assignmentId || Boolean(pending)) return;
    const body = retry?.body ?? (kind === "IMAGE" ? "" : draft.trim());
    const attachmentId = retry?.attachmentId ?? (kind === "IMAGE" ? attachment?.id : undefined);
    if (kind !== "IMAGE" && !body || kind === "IMAGE" && !attachmentId || !retry && (kind==="SKU"||kind==="LINK") && contentChoice?.kind!==kind) return;
    let currentVersion = selected.version;
    let currentStatus = selected.status.toUpperCase();
    if (!retry) {
      setBusy(true);
      try {
        const state = await supportClient.conversationState(selected.id);
        if (identityRef.current !== identity) return;
        if (state.status === "TRANSFERRED") { setBusy(false); setSendError("当前会话正在转接，请刷新后重试。"); return; }
        if (state.version !== selected.version) {
          setSendError("会话有新消息，请核对刷新后的详情再发送。原文已保留。");
          try { await ctx.refreshConversations(); }
          catch { setSendError("会话有新消息，列表刷新失败。原文已保留，请刷新会话后重试。"); }
          setBusy(false);
          return;
        }
        currentVersion = state.version;
        currentStatus = state.status;
      } catch (cause) {
        if (identityRef.current !== identity) return;
        setBusy(false);
        if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId));
        setSendError(`会话状态暂时无法确认：${displayAdminError(cause)}。原文已保留，请重试。`);
        return;
      }
    }
    if (identityRef.current !== identity) return;
    const record = retry ?? (() => {
      const latest = [...selected.messages].reverse().find((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id));
      const replyTargets = [
        ...(latest?.sender === "user" && Number.isSafeInteger(latest.id) && (intent === "SERVICE" || includeCurrentReply) ? [{ conversationNo: selected.id, throughMessageId: latest.id! }] : []),
        ...closedReplyTargets,
      ];
      const message: SessionMsg = { ts: Date.now(), sender: "agent", agentName: session?.operator || session?.username || selected.owner, text: body, kind, attachmentId, skuId:kind==="SKU"&&contentChoice?.kind==="SKU"?contentChoice.skuId:undefined, linkTarget:kind==="LINK"&&contentChoice?.kind==="LINK"?contentChoice.linkTarget:undefined, intent, clientMessageId: crypto.randomUUID(), replyTargets: replyTargets.length ? replyTargets : undefined };
      return { conversationId: selected.id, key: newKey(), body, intent, kind, attachmentId, message, expectedAssignmentId: currentProfileDetail!.assignmentId!, expectedStatus: currentStatus, expectedVersion: currentVersion };
    })();
    const stored = rememberPending(pendingKey(adminId), record.key, record);
    setPending(record);
    if (!stored) { setBusy(false); setSendError("浏览器无法保存这次发送的记录，消息还没发出；请检查浏览器设置后重试。"); return; }
    setBusy(true); setSendError("");
    const input = { kind: record.kind, content: record.kind !== "IMAGE" ? record.body : undefined, attachmentId: record.attachmentId, skuId: record.message.skuId, linkTarget: record.message.linkTarget, intent: record.intent, clientMessageId: record.message.clientMessageId!, replyTargets: record.message.replyTargets, expectedAssignmentId: record.expectedAssignmentId, expectedStatus: record.expectedStatus ?? "OPEN", expectedVersion: record.expectedVersion };
    let ok = false, submitted = false;
    try {
      if (retry) {
        const recovered = await supportClient.command(record.key).catch((cause: unknown) => {
          if (cause instanceof SupportClientError && cause.status === 404) return null;
          throw cause;
        });
        if (identityRef.current !== identity) return;
        if (recovered && recovered.status !== "SUCCEEDED" && recovered.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后查询原命令。"); return; }
        if (recovered?.status === "FAILED") { pendingMessages.forget(pendingKey(adminId)); setPending(null); setSendError("消息发送失败。草稿已保留，可修改后重新发送。"); return; }
        if (!recovered) {
          if (!writable || currentProfileDetail?.assignmentId !== record.expectedAssignmentId) {
            setSendError("原命令未找到；请先恢复会话详情并核对当前归属，再用原命令重试。");
            return;
          }
          submitted = true; await supportClient.sendConversationReply(record.conversationId, input, record.key);
        }
      } else {
        submitted = true; await supportClient.sendConversationReply(record.conversationId, input, record.key);
      }
      ok = true; setMaintenanceChosen(false); // one explicit maintenance contact per choice
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
    }
    catch (cause) {
      if (identityRef.current === identity && submitted && rejectedSend(cause)) {
        pendingMessages.forget(pendingKey(adminId)); setPending(null);
        void ctx.refreshConversations().catch(() => {});
        if (lostPermission(cause)) { ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError("当前会话权限已变化，请返回客户列表核对。"); }
        else setSendError(`本次发送已被拒绝：${displayAdminError(cause)}。原文已保留，请核对会话后修改重发。`);
        return;
      }
      if (identityRef.current === identity) { if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError(`发送结果待确认：${displayAdminError(cause)} 请查询发送结果。`); }
    }
    finally { if (identityRef.current === identity) setBusy(false); }
    if (identityRef.current !== identity) return;
    if (ok) {
      window.dispatchEvent(new Event("support-todo-changed"));
      setProfileDetail(null); setProfileRetry((value) => value + 1);
      pendingMessages.forget(pendingKey(adminId));
      if (record.kind !== "IMAGE") setDrafts((old) => ({ ...old, [record.conversationId]: old[record.conversationId] === record.body ? "" : old[record.conversationId] }));
      if (record.kind === "IMAGE") clearAttachment(false);
      setPending(null); setContentChoice(null);
    } else setSendError("发送失败或结果待确认。请保留原内容，用下方按钮重试同一条消息。");
  };

  const chooseImage = async (file: File | undefined) => {
    const selection = ++imageSelectionRef.current;
    if (!file || !writable || busy || pending) return;
    if (!attachmentPolicy?.available) { setAttachmentPolicyError("图片功能暂不可用，请稍后重试。"); return; }
    if (!attachmentPolicy.allowedMimeTypes.includes(file.type as "image/png" | "image/jpeg") || attachmentPolicy.maxBytes !== null && file.size > attachmentPolicy.maxBytes) {
      setAttachmentPolicyError("请选择符合当前图片格式和大小要求的文件。"); return;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (selection !== imageSelectionRef.current) return;
      if (attachmentPolicy.maxPixels !== null && pixels > attachmentPolicy.maxPixels) { setAttachmentPolicyError("图片像素超过当前上限，请重新选择。"); return; }
    } catch { if (selection === imageSelectionRef.current) setAttachmentPolicyError("图片打不开，请重新选择 JPG 或 PNG 图片。"); return; }
    if (selection !== imageSelectionRef.current) return;
    clearAttachment();
    setAttachmentPolicyError("");
    const next: Attachment = { file, url: URL.createObjectURL(file), uploadId: crypto.randomUUID(), key: newKey(), state: "selected" };
    attachmentRef.current = next; setAttachment(next);
  };
  const uploadImage = async () => {
    if (!attachment || !writable || busy || !selected?.customerId || !currentProfileDetail?.assignmentId || attachment.state === "ready") return;
    const current = attachment;
    const controller = new AbortController();
    uploadControllerRef.current = controller;
    setAttachment({ ...current, state: "uploading", error: "" });
    try {
      const policy = await supportClient.attachmentPolicy(controller.signal);
      setAttachmentPolicy(policy);
      if (!policy.available || !policy.allowedMimeTypes.includes(current.file.type as "image/png" | "image/jpeg") || policy.maxBytes !== null && current.file.size > policy.maxBytes) throw new Error("图片不符合当前上传规则，请重新选择。");
      const bitmap = await createImageBitmap(current.file);
      const pixels = bitmap.width * bitmap.height;
      bitmap.close();
      if (policy.maxPixels !== null && pixels > policy.maxPixels) throw new Error("图片像素超过当前上限，请重新选择。");
      const ready = await supportClient.uploadAttachment({ file: current.file, customerId: String(selected.customerId), clientUploadId: current.uploadId, expectedAssignmentId: currentProfileDetail.assignmentId }, current.key, controller.signal);
      if (attachmentRef.current?.uploadId !== current.uploadId) { void supportClient.cancelAttachment(ready.id, newKey()).catch(() => undefined); return; }
      const uploaded = { ...current, state: "ready" as const, id: ready.id, error: "" };
      attachmentRef.current = uploaded; setAttachment(uploaded);
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (attachmentRef.current?.uploadId !== current.uploadId) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError("当前已无权上传该客户图片，请返回客户列表刷新。");
      } else setAttachment({ ...current, state: "error", error: displayAdminError(cause) });
    } finally { if (uploadControllerRef.current === controller) uploadControllerRef.current = null; }
  };

  const serviceStatus = !conversationsAvailable ? "会话服务暂不可用。请检查连接后重试。" : lostAccess ? "当前会话权限已变化，请刷新列表。" : "";
  const title = userNicknameText(selected?.customer || selected?.profile?.nickname || (selected?.customerId ? `客户 ${selected.customerId}` : firstDetail?.displayName || (requestedCustomerIdValid && requestedCustomerId ? `客户 ${requestedCustomerId}` : "会话消息")), selected?.profile?.phone);
  const checkActionReady = async (conversation: SessionConvo) => {
    if (!conversation.customerId || actionChecking) return false;
    const requestStamp=identityRef.current;
    setActionChecking(true); setActionError("");
    try {
      const detail = await supportClient.customerDetail(String(conversation.customerId));
      if(requestStamp!==identityRef.current)return false;
      if (detail.agentAdminId !== adminId || !detail.assignmentId) { ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError("客户归属已变化，请刷新会话后重试。"); return false; }
      if(conversation.id===activeConversationRef.current)setProfileDetail(detail);
      // waitingReply aggregates all customer history. The backend checks pending
      // replies for each selected conversation together with its versioned write.
      return true;
    } catch (cause) { if(requestStamp!==identityRef.current)return false; if (lostPermission(cause)) ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError(`客户归属暂时无法核对：${displayAdminError(cause)}。请重试。`); return false; }
    finally { if(requestStamp===identityRef.current)setActionChecking(false); }
  };
  const closeConversation = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({
      action: `结束服务会话 ${conversation.id}`,
      detail: "将这段服务会话标记为已解决，不改变客户的专属客服。客户再次发消息时，会继续当前对话。",
      reasonMin: 8, reasonMax: 200,
      run: async (reason) => {
        if(requestStamp!==identityRef.current)return false;
        const rows = all.map((row) => row.id === conversation.id ? { ...row, status: "resolved" as const } : row);
        const ok = await ctx.setParam(CONVO_KEY, JSON.stringify(rows), { action: `结束服务会话 ${conversation.id}`, reason, commandKey: `m3:close:${conversation.id}:${conversation.version}` });
        if(requestStamp!==identityRef.current)return false;
        if (!ok) setActionError("结束结果未确认，请保留原操作并重试；如有新客户消息，请先回复。");
        return ok;
      },
    });
  };
  const continueClosed = () => {
    if (!canWriteM3 || !selected?.detailReady || !selected.customerId || selected.ownerAdminId !== adminId || !canSendTo({ ...selected, status: "open" }, adminId)) return;
    const url = new URL(window.location.href); url.searchParams.delete("conversationNo"); url.searchParams.set("customerId", String(selected.customerId)); window.history.replaceState(null, "", url);
    setRequestedCustomerId(String(selected.customerId));
    setScreen("chat");
    setActionError("");
  };
  const insertText = (text: string) => {
    const start=composerRef.current?.selectionStart??draft.length, end=composerRef.current?.selectionEnd??start;
    setDrafts(old=>({...old,[targetKey]:draft.slice(0,start)+text+draft.slice(end)}));
    requestAnimationFrame(()=>{composerRef.current?.focus();composerRef.current?.setSelectionRange(start+text.length,start+text.length);});
  };
  const archiveOne = async (conversation: SessionConvo) => {
    if(!canWriteM3||conversation.ownerAdminId!==adminId||pending||firstPending||!await checkActionReady(conversation))return;
    if (!conversation.archived) {
      const members = visible.filter(row=>row.customerId===conversation.customerId && !row.archived);
      for (const row of members) if (!await checkActionReady(row)) return;
      const stamp=identityRef.current, commandKey=newKey();
      const payload={conversationNos:members.map(row=>row.id),expectedVersions:Object.fromEntries(members.map(row=>[row.id,row.version]))};
      ctx.openActionConfirm({action:"归档客户对话",detail:"归档此客户的全部历史会话。未处理的客户消息不能归档。",reasonMin:8,reasonMax:200,run:reason=>stamp===identityRef.current?ctx.setParam("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"归档客户对话",reason,commandKey}):Promise.resolve(false)});
      return;
    }
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:conversation.archived?"撤销归档":"归档会话",detail:`会话 ${conversation.id}；只是从列表里归档，会话、消息和归属都不变。`,reasonMin:8,reasonMax:200,run:reason=>requestStamp===identityRef.current?ctx.setParam(CONVO_KEY,JSON.stringify(all.map(c=>c.id===conversation.id?{...c,archived:!conversation.archived}:c)),{action:"修改会话归档",reason,commandKey:`m3:archive:${conversation.id}:${conversation.version}:${!conversation.archived}`}):Promise.resolve(false)});
  };
  const archiveBatch = async () => {
    if(!archiveIds.size||actionChecking||pending||firstPending)return;
    const selectedCustomers=customerRows.filter(row=>archiveIds.has(row.id));
    const chosen=visible.filter(c=>selectedCustomers.some(row=>row.customerId===c.customerId)&&!c.archived&&c.ownerAdminId===adminId);
    if(selectedCustomers.length!==archiveIds.size){setActionError("所选会话范围已变化，请重新圈选。");return;}
    for(const c of chosen)if(!await checkActionReady(c))return;
    const payload={conversationNos:chosen.map(c=>c.id),expectedVersions:Object.fromEntries(chosen.map(c=>[c.id,c.version]))};
    const key=newKey();
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:"批量归档",detail:`确认归档 ${new Set(chosen.map(customerIdOf)).size} 位客户的全部对话。未处理客户消息不能归档。`,reasonMin:8,reasonMax:200,run:async reason=>{if(requestStamp!==identityRef.current)return false;const ok=await ctx.setParam("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"批量归档已选会话",reason,commandKey:key});if(requestStamp!==identityRef.current)return false;if(ok)setArchiveIds(new Set());return ok;}});
  };
  const canReadTimeout = Boolean(session?.authorities?.includes("service_m3_read"));
  const canTimeout = (session?.role === "super" || session?.role === "superadmin") && Boolean(session?.authorities?.includes("service_m3_timeout_manage")) && !timeoutReadOnly;
  useEffect(() => {
    if (!canReadTimeout) { setTimeoutOpen(false); setTimeoutPolicy(null); }
    if (!canReadTimeout || !canTimeout) { setTimeoutInput(undefined); setTimeoutPending(null); setTimeoutLatest(null); setTimeoutConflict(false); setTimeoutSaving(false); }
  }, [canReadTimeout, canTimeout]);
  const timeoutSlot = `nexion-m3-timeout:${adminId}`;
  const readTimeoutCommand = (): TimeoutCommand | null => {
    // Check persisted rows before the shared store can prune malformed records or fall back to memory.
    if (typeof window !== "undefined") for (const key of ["nexion-admin-m3-private-pending-v1", "nexion-admin-m3-timeout-pending-v1"]) {
      const table = JSON.parse(window.sessionStorage.getItem(key) ?? "{}");
      if (!table || typeof table !== "object" || Array.isArray(table)) throw new Error("上次的修改记录读不到，暂时不能再改。");
      for (const [commandKey, row] of Object.entries(table)) {
        const record = row as Partial<StoredMessage> | null;
        if (record?.fingerprint === timeoutSlot && (record.commandKey !== commandKey || typeof record.payload !== "string" || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt) || Number(record.expiresAt) <= Date.now())) throw new Error("上次的修改记录读不到，暂时不能再改。");
      }
    }
    const rows = [...pendingTimeoutPolicies.list(), ...pendingMessages.list()].filter((row) => row.fingerprint === timeoutSlot);
    const commands = rows.map((row) => {
      const saved = JSON.parse(row.payload) as TimeoutCommand;
      parseMConversationTimeoutPolicy(saved.policy);
      if (typeof saved.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(saved.key) || saved.key !== row.commandKey || typeof saved.operator !== "string" || !saved.input || !Number.isInteger(saved.input.warnMinutes) || saved.input.warnMinutes < 1 || saved.input.warnMinutes > 30 || !Number.isInteger(saved.input.closeMinutes) || saved.input.closeMinutes <= saved.input.warnMinutes || saved.input.closeMinutes > 120 || typeof saved.input.reason !== "string" || saved.input.reason.trim().length < 6 || saved.input.reason.trim().length > 200) throw new Error("上次的修改记录读不到，暂时不能再改。");
      return saved;
    });
    if (commands.some((saved) => JSON.stringify(saved) !== JSON.stringify(commands[0]))) throw new Error("存在不同的原策略记录，暂不能另发变更。");
    return commands[0] ?? null;
  };
  const forgetTimeoutCommand = (command: TimeoutCommand) => {
    const saved = readTimeoutCommand();
    if (!saved || JSON.stringify(saved) !== JSON.stringify(command)) throw new Error("上次的修改记录已变化，请刷新后再查。");
    pendingTimeoutPolicies.forget(timeoutSlot, command.key);
    pendingMessages.forget(timeoutSlot, command.key);
    if (readTimeoutCommand()) throw new Error("上次修改的结果已确认，但浏览器没能清理记录，请检查浏览器设置后再查。");
  };
  const openTimeout = async () => {
    if (!canReadTimeout || timeoutSaving) return;
    const conflictBaseline = timeoutConflict ? timeoutPolicy : null;
    setTimeoutOpen(true); setTimeoutPolicy(null); setTimeoutError(""); setTimeoutLatest(null);
    const stamp = timeoutIdentityRef.current;
    try {
      const policy = await fetchMConversationTimeoutPolicy();
      if (stamp !== timeoutIdentityRef.current) return;
      const saved = canTimeout ? readTimeoutCommand() : null;
      setTimeoutPolicy(saved?.policy ?? conflictBaseline ?? policy);
      setTimeoutPending(saved);
      if (saved) { setTimeoutLatest(policy); setTimeoutInput(saved.input); setTimeoutError("原操作结果待确认，请先查询原操作。"); }
      else if (timeoutConflict) { setTimeoutLatest(policy); }
    } catch (cause) {
      if (stamp === timeoutIdentityRef.current) {
        setTimeoutPolicy(null); setTimeoutError(displayAdminError(cause));
        if (cause && typeof cause === "object" && "status" in cause && cause.status === 403) { setTimeoutReadOnly(true); setTimeoutInput(undefined); setTimeoutPending(null); setTimeoutLatest(null); setTimeoutConflict(false); }
      }
    }
  };
  const refreshTimeoutLatest = async () => {
    const stamp = timeoutIdentityRef.current;
    try { const latest = await fetchMConversationTimeoutPolicy(); if (stamp === timeoutIdentityRef.current) setTimeoutLatest(latest); }
    catch (cause) {
      if (stamp !== timeoutIdentityRef.current) return;
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 403) await revokeTimeoutWrite(stamp);
      else setTimeoutError(displayAdminError(cause));
    }
  };
  const revokeTimeoutWrite = async (stamp: string) => {
    setTimeoutReadOnly(true); setTimeoutInput(undefined); setTimeoutPending(null); setTimeoutPolicy(null); setTimeoutLatest(null); setTimeoutConflict(false);
    setTimeoutError("你已经没有修改权限，修改内容已清除；下面显示的是最新设置。");
    try { const policy = await fetchMConversationTimeoutPolicy(); if (stamp === timeoutIdentityRef.current) setTimeoutPolicy(policy); }
    catch (cause) { if (stamp === timeoutIdentityRef.current) setTimeoutError(displayAdminError(cause)); }
  };
  const saveTimeout = async (input: TimeoutInput) => {
    if (!timeoutPolicy || !canTimeout || !canReadTimeout || timeoutSaving || timeoutConflict || timeoutPending) return false;
    try { if (readTimeoutCommand()) { setTimeoutError("原操作结果待确认，请先查询原操作。"); return false; } }
    catch { setTimeoutError("上次的修改记录读不到，暂时不能再改。"); return false; }
    const command = { key: newKey(), input, policy: timeoutPolicy, operator: session?.operator || session?.username || "unknown-admin" };
    pendingTimeoutPolicies.remember(timeoutSlot, command.key, { payload: JSON.stringify(command) });
    if (!pendingTimeoutPolicies.isDurablyStored(timeoutSlot, command.key)) { pendingTimeoutPolicies.forget(timeoutSlot, command.key); setTimeoutInput(input); setTimeoutError("浏览器无法保存这次修改的记录，还没提交，请检查浏览器设置后重试。"); return false; }
    setTimeoutInput(input); setTimeoutSaving(true); setTimeoutError("");
    const stamp = timeoutIdentityRef.current;
    let submitted = false;
    try {
      await updateMConversationTimeoutPolicy(command.policy, command.input, command.key, command.operator);
      submitted = true;
      if (stamp !== timeoutIdentityRef.current) return false;
      const next = await fetchMConversationTimeoutPolicy();
      if (stamp !== timeoutIdentityRef.current) return false;
      setTimeoutPolicy(next); setTimeoutInput(undefined); pendingTimeoutPolicies.forget(timeoutSlot); return true;
    } catch (cause) {
      if (stamp !== timeoutIdentityRef.current) return false;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      if (submitted) {
        setTimeoutPending(command);
        if (status === 403) await revokeTimeoutWrite(stamp);
        else setTimeoutError("修改已提交，但页面刷新失败；请查询结果并刷新。");
      } else if ([400, 401, 403, 404, 409, 422].includes(status) && !isIndeterminateSupportError(cause)) {
        pendingTimeoutPolicies.forget(timeoutSlot);
        if (status === 403) await revokeTimeoutWrite(stamp);
        else if (status === 409) { setTimeoutConflict(true); setTimeoutError("设置刚被别人改过，你填写的内容还在；请看最新设置后重新确认。"); await refreshTimeoutLatest(); }
        else setTimeoutError(displayAdminError(cause));
      } else { setTimeoutPending(command); setTimeoutError("原操作结果待确认，请查询原操作；不会重复提交。"); }
      return false;
    } finally { if (stamp === timeoutIdentityRef.current) setTimeoutSaving(false); }
  };
  const checkTimeoutPending = async () => {
    if (!timeoutPending || timeoutSaving || !canTimeout || !canReadTimeout) return;
    const stamp = timeoutIdentityRef.current, command = timeoutPending;
    setTimeoutSaving(true);
    try {
      const saved = readTimeoutCommand();
      if (!saved || JSON.stringify(saved) !== JSON.stringify(command)) throw new Error("上次的修改记录已变化，请刷新后再查。");
      const result = await supportClient.command(command.key);
      if (stamp !== timeoutIdentityRef.current) return;
      if (result.status === "SUCCEEDED") {
        const policy = await fetchMConversationTimeoutPolicy();
        if (stamp !== timeoutIdentityRef.current) return;
        forgetTimeoutCommand(command); setTimeoutPending(null); setTimeoutPolicy(policy); setTimeoutInput(undefined); setTimeoutError(""); setTimeoutOpen(false);
      } else if (result.status === "FAILED") {
        forgetTimeoutCommand(command); setTimeoutPending(null); setTimeoutPolicy(command.policy); setTimeoutConflict(true); setTimeoutError("上次修改没有成功，你填写的内容还在；请看最新设置后再确认。"); await refreshTimeoutLatest();
      } else setTimeoutError("原操作仍待确认，请稍后查询；原操作记录与输入已保留。");
    } catch (cause) {
      if (stamp !== timeoutIdentityRef.current) return;
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 403) await revokeTimeoutWrite(stamp);
      else setTimeoutError("暂时无法确认原操作结果；原操作记录与输入已保留。");
    } finally { if (stamp === timeoutIdentityRef.current) setTimeoutSaving(false); }
  };

  return <section className="m3-stage m3-dedicated-stage" aria-label="专属客服会话">

    <div className={`m3-col-list ${screen !== "list" ? "hide-narrow" : ""}`}>
      <header className="m3-list-header">
        <div className="m3-list-heading"><h2>会话收件箱<small>{conversationsAvailable ? customerRows.length : "-"}</small></h2><button type="button" className="l-btn sm primary" disabled={!canWriteM3||qualificationUnknown||!hasOwn&&!myAgent} title={!hasOwn&&!myAgent?"当前账号不是专属客服，没有本人客户可联系":"联系本人专属客户"} onClick={()=>setContactOpen(true)}><Icon name="plus" size={14}/>主动联系</button></div>
        {canReviewAll && <div className="m3-list-scope" role="group" aria-label="收件箱范围"><button type="button" className={`l-btn sm ${!reviewing?"primary":""}`} aria-pressed={!reviewing} onClick={()=>{setScopeView("mine");if(listTab==="unassigned")setListTab("pending");}}>我的客户</button><button type="button" className={`l-btn sm ${reviewing?"primary":""}`} aria-pressed={reviewing} onClick={()=>setScopeView("team")}>组内审阅</button>{reviewing&&teamAgents.length>0&&<HDSelect value={String(agentFilter)} width={120} onChange={value=>setAgentFilter(Number(value))} options={[{value:"0",label:"全部专属客服"},...teamAgents.map(([id,name])=>({value:String(id),label:name}))]}/>}</div>}
        <input className="fld m3-list-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户或会话编号" aria-label="搜索客户或会话编号" />
        <div className="m3-list-statuses" role="group" aria-label="会话状态筛选">
          {tabs.map(([value,label])=>{const count=customerRows.filter(row=>tabMatch(row,value)).length;const overdue=value==="unassigned"?customerRows.some(row=>tabMatch(row,value)&&row.pendingReplySince!=null&&timeoutNow-row.pendingReplySince>=(ctx.unboundAlertMinutes??5)*60000):value==="pending"&&Boolean(timeoutPolicy)&&customerRows.some(row=>tabMatch(row,value)&&Boolean(replyTimeout(row.pendingReplySince,timeoutNow,timeoutPolicy!.warnMinutes,timeoutPolicy!.closeMinutes)));return <button type="button" className={`l-btn sm ${listTab===value?"primary":""}`} key={value} aria-pressed={listTab===value} onClick={()=>setListTab(value)}><span>{label}</span>{" "}<span className={`m3-list-count${overdue?" overdue":""}`} title={overdue?"有客户已超时待处理":undefined}>{conversationsAvailable ? count : "-"}</span></button>;})}
        </div>
        <div className="m3-list-secondary-actions" role="group" aria-label="会话列表管理">
          <button type="button" className="l-btn sm" aria-pressed={alertPrefs.sound||alertPrefs.desktop} title="新消息、新分配客户的提示音和浏览器通知（仅本浏览器）" onClick={()=>{const on=!(alertPrefs.sound||alertPrefs.desktop);setSupportAlertPrefs({sound:on,desktop:on});}}><Icon name="bell" size={13}/>{alertPrefs.sound||alertPrefs.desktop?"提醒已开":"提醒已关"}</button>
          <button type="button" className="l-btn sm" disabled={!canReadTimeout} title={canReadTimeout?"客户等待多久标记超时、严重超时":"需要会话查看权限"} onClick={()=>void openTimeout()}><Icon name="clock" size={13}/>超时策略</button>
          <button type="button" className="l-btn sm" disabled={!canWriteM3||qualificationUnknown} onClick={()=>setBulkOpen(true)}>圈选群发</button>
          {!archiveMode?<button type="button" className="l-btn sm" disabled={!canWriteM3} onClick={()=>setArchiveMode(true)}>批量归档</button>:<><button type="button" className="l-btn sm" disabled={!archiveIds.size||actionChecking} onClick={()=>void archiveBatch().then(()=>setArchiveMode(false))}>归档已选 {archiveIds.size}</button><button type="button" className="l-btn sm" onClick={()=>{setArchiveMode(false);setArchiveIds(new Set());}}>取消</button></>}
        </div>
      </header>
      <div className="cv-list" onScroll={event=>{const el=event.currentTarget;if(listLimit<filtered.length&&el.scrollTop+el.clientHeight>=el.scrollHeight-80)setListLimit(n=>n+LIST_CHUNK);}}>
        {(recoveries.length > 0 || recoveryError) && <div className="itint warn" role="alert">{recoveryError || "原消息结果待确认；私聊正文与图片已清除，只保留原编号供查询。"}{recoveries.map(({ slot, locator }, index) => <button className="l-btn sm" type="button" key={slot} disabled={Boolean(recoveryBusy)} onClick={() => void queryRecovery(slot, locator)}>查询原消息 {index + 1}</button>)}</div>}
        {!conversationsAvailable && <div className="itint danger" role="alert">{serviceStatus} <button className="l-btn sm" type="button" onClick={() => void ctx.refreshConversations()}>重新连接</button></div>}
        {conversationsAvailable && filtered.length === 0 && <div className="itint" role={reviewScopeError ? "alert" : undefined}>{reviewScopeError ? <>{reviewScopeError}<button type="button" className="l-btn sm" onClick={() => setScopeRetry(value => value + 1)}>重新核对范围</button></> : qualificationUnknown ? "正在确认你的专属客服身份，稍后显示可查看的会话。" : query ? "没有匹配的客户，请清除搜索。" : listTab === "pending" ? "没有待回复的客户。" : listTab === "unassigned" ? "没有待分配的客户。" : "暂无会话。可从“我的客户”发起首次联系。"}</div>}
        {listRows.map(convo=>{const active=selected?.id===convo.id;const message=convo.detailReady?lastMessage(convo):undefined;const kind=convo.detailReady?message?.kind:convo.lastMessageKind;const knownReplyState=typeof convo.pendingReplyCount==="number"&&Number.isSafeInteger(convo.pendingReplyCount)&&convo.pendingReplyCount>=0?convo.pendingReplyCount>0:null;const hasMessage=Boolean(message)||Number.isSafeInteger(convo.lastPublicMessageId)&&Number(convo.lastPublicMessageId)>0?true:convo.detailReady&&convo.historyTruncated===false||convo.lastPublicMessageId===0?false:null;return <div key={convo.id} className="m3-list-row">{archiveMode&&<label className="m3-list-select" title={`选择会话 ${convo.id}`}><input type="checkbox" aria-label={`选择会话 ${convo.id}`} checked={archiveIds.has(convo.id)} disabled={!canWriteM3||convo.ownerAdminId!==adminId||convo.archived} onChange={e=>setArchiveIds(old=>{const next=new Set(old);if(e.target.checked)next.add(convo.id);else next.delete(convo.id);return next;})}/></label>}<button type="button" className={`cv-item ${active?"on":""}`} style={{flex:1,minWidth:0}} onClick={()=>select(convo)} aria-current={active?"true":undefined}><span className="cv-r1"><SupportAvatar name={userNicknameText(convo.customer||convo.profile?.nickname||"客户",convo.profile?.phone)} path={convo.customerAvatarRef??undefined} size={38}/><strong className="cv-name" title={userNicknameText(convo.customer||convo.profile?.nickname||`客户 ${convo.customerId}`,convo.profile?.phone)}>{userNicknameText(convo.customer||convo.profile?.nickname||`客户 ${convo.customerId}`,convo.profile?.phone)}</strong><time className="cv-time">{messageTime(convo.lastTs)}</time></span><span className="cv-prev">{kind==="IMAGE"?"[图片]":kind==="SKU"?"[商品推荐]":kind==="LINK"?"[页面链接]":message?.text||convo.lastPreview||(hasMessage===false?"尚无人工消息":"消息摘要暂不可用")}</span><span className="cv-meta"><span className={`cv-stat ${convo.status==="open"?"active":""}`} title={`${hasMessage===false?"待首次联系":knownReplyState===true?"待专属客服回复":knownReplyState===false?"已处理":"回复状态未同步"} · 当前专属客服：${convo.owner}`}>{convo.archived?"已归档":conversationStateLabel(convo.status)} · {convo.owner}</span>{convo.unread>0&&<span className="cv-unread" aria-label={`${convo.unread} 条未读`}>{convo.unread}<span className="sr-only"> 条未读</span></span>}</span>{timeoutPolicy && replyTimeout(convo.pendingReplySince,timeoutNow,timeoutPolicy.warnMinutes,timeoutPolicy.closeMinutes) && <span className="itint warn">{replyTimeout(convo.pendingReplySince,timeoutNow,timeoutPolicy.warnMinutes,timeoutPolicy.closeMinutes)}</span>}<span className="cv-origin-copy" title={convo.id}>{convo.origin ? `${{user:"客户发起",advisor:"客服主动联系",support:"客服主动联系"}[convo.origin]} · ` : ""}{hasMessage===false?"待首次联系":knownReplyState===true?(convo.ownerUnbound?"待分配专属客服":"待专属客服回复"):knownReplyState===false?"已处理":"查看待回复状态"}</span></button></div>;})}
      </div>
        <div className="m3-list-footer"><span>{conversationsAvailable ? filtered.length : "-"} 位客户</span>{listLimit<filtered.length&&<button className="l-btn sm" onClick={()=>setListLimit(n=>n+LIST_CHUNK)}>加载更多</button>}</div>
    </div>
    <div ref={chatColumnRef} className={`m3-col-chat ${screen === "list" ? "hide-narrow" : ""}`}>
      <header className="m3-chat-header"><button type="button" className="l-btn sm m3-desktop-back" onClick={() => setScreen("list")} aria-label="返回会话列表">返回</button><SupportAvatar name={title} path={selected?.customerAvatarRef??undefined}/><div className="m3-chat-identity"><h2 title={title}>{title}</h2><div className="m3-chat-subtitle">{selected ? `当前专属客服：${selected.owner} · ${selected.status === "transferred" ? "已转出 · 只读" : selected.status === "open" ? "当前会话" : "历史会话"}` : requestedCustomerId ? "首次联系" : "选择客户查看会话"}</div></div>{(selected || profileCustomerId) && <button type="button" className="l-btn sm m3-profile-toggle" onClick={() => setScreen("profile")}>客户资料</button>}{canAssign && <button type="button" className="l-btn sm primary" onClick={() => setAssignOpen(true)}>分配专属客服</button>}{canContinueClosed && <button type="button" className="l-btn sm" onClick={continueClosed} title="重新核对当前专属客服归属，继续当前对话">前往当前会话</button>}{writable && <><button type="button" className="l-btn sm" aria-label="结束服务会话" disabled={actionChecking} onClick={closeConversation}><Icon name="check" size={14}/>标记已解决</button></>}{selected && (writable || selected.ownerAdminId===adminId || linkedTicketNo || canReviewAll && selected.customerId) && <details className="m3-more"><summary className="l-btn sm" aria-label="更多操作">•••</summary><div className="m3-more-menu">{selected&&canWriteM3&&selected.ownerAdminId===adminId&&<button type="button" className="l-btn sm" disabled={actionChecking} onClick={()=>void archiveOne(selected)}>{selected.archived?"撤销归档":"归档"}</button>}{canReviewAll && selected.customerId && (selectedUnbound ? <a className="l-btn sm" href="/service/overview?view=pool">前往待绑定客户池</a> : <a className="l-btn sm" href={`/service/overview?customerId=${encodeURIComponent(selected.customerId)}`}>正式转绑客户</a>)}</div></details>}</header>
      <div className="ChatBody" role="log" aria-label="会话消息" aria-live="polite">
        {serviceStatus && <div className="itint danger" role="alert">{serviceStatus}</div>}
        {actionError && <div className="itint danger" role="alert">{actionError}<button type="button" className="l-btn sm" onClick={() => setActionError("")}>知道了</button></div>}
        {!requestedCustomerIdValid && <div className="itint danger" role="alert">客户链接无效，无法打开会话。请从<a href="/service/overview">我的客户</a>重新进入。</div>}
        {readError && <div className="itint warn" role="alert">已读状态更新失败：{readError} <button type="button" className="l-btn sm" onClick={() => { markedRef.current = ""; setReadRetry((value) => value + 1); }}>重试</button></div>}
        {customerHistory.map(row => <CustomerHistoryMessages key={`${authEpoch}:${row.id}`} conversation={row} ctx={ctx} customerName={title} loadEnabled={Boolean(selected?.detailReady && customerHistory.find(item => !item.detailReady)?.id === row.id)}/>)}
        {selected && !paneMessages ? <div className="itint" role={conversationError ? "alert" : "status"}>{conversationError ? `会话详情加载失败：${conversationError}` : "正在加载会话消息…"} {conversationError && <button type="button" className="l-btn sm" onClick={() => { setConversationError(""); setConversationRetry((value) => value + 1); }}>重新加载详情</button>}</div> : selected && paneMessages?.length ? paneMessages.map((message,index)=><SupportMessage key={message.id??`${message.ts}-${index}`} message={message} previous={paneMessages[index-1]} newlyArrived={message.id!==undefined&&newMessageIds.has(message.id)} customerId={String(selected.customerId)} customerAvatarRef={selected.customerAvatarRef} customerName={title} onRevoked={()=>ctx.invalidateScope(selected.id,String(selected.customerId))}/>) : <div className="itint">{requestedCustomerId?"尚无进行中会话。核对归属后即可发送首次联系。":selected?"这段会话尚无消息。":"选择会话后查看消息。"}</div>}
      </div>
      <div className="ChatComposer">
        {detailLoading && <div className="itint">正在核对当前专属客服归属…</div>}
        {detailError && <div className="itint danger" role="alert">客户资料加载失败：{detailError} <button type="button" className="l-btn sm" onClick={() => setDetailRetry((value) => value + 1)}>重试</button> <a href="/service/overview">返回我的客户</a></div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId !== adminId && <div className="itint warn">该客户由当前专属客服服务，本账号仅可审阅。</div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId === adminId && !firstDetail.assignmentId && <div className="itint warn">当前归属资料未就绪，暂不能发送。请刷新客户资料。</div>}
        {selected && !writable && composerMode === "write" && <div className="itint warn">{recoveryBlocksTarget ? <>原消息结果待确认，暂不能重复发送。<button className="l-btn sm" type="button" onClick={()=>setScreen("list")}>返回列表查询原消息</button></> : !canWriteM3 ? "你只能查看会话，发消息需要会话操作权限。" : selected.status !== "open" ? historyReadOnlyHint : selectedUnbound ? "该客户还没有专属客服，等待主管分配后回复。" : !currentProfileDetail ? <>正在核对客户归属。{profileError && <button type="button" className="l-btn sm" onClick={() => setProfileRetry((value) => value + 1)}>加载失败，重试</button>}</> : !currentProfileDetail.assignmentId || currentProfileDetail.agentAdminId !== selected.ownerAdminId ? <>客户归属已变化，请刷新会话后重试。<button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations()}>刷新会话</button></> : "仅当前专属客服可发送消息；主管审阅不能代发。"}</div>}
        {!selected && recoveryBlocksTarget && <div className="itint warn">原消息结果待确认，暂不能重复发送。<button className="l-btn sm" type="button" onClick={()=>setScreen("list")}>返回列表查询原消息</button></div>}
        {requestedCustomerId && !selected && !canWriteM3 && <div className="itint warn">你只能查看会话，发消息需要会话操作权限。</div>}{replyCustomerId && closedCandidateRows.length > 0 && <div className="itint" role={closedCandidateError?"alert":"status"}>{closedCandidateError?`历史待处理消息加载失败：${closedCandidateError}`:closedCandidateMissing.length?"正在核对历史待处理消息…":"服务回复会同步处理这位客户此前的待回复消息。"}{closedCandidateError&&<button type="button" onClick={()=>{setClosedCandidateError("");setClosedCandidateRetry(n=>n+1);}}>重试</button>}</div>}

        {selected && currentProfileDetail?.waitingReply === true && displayedIntent === "MAINTENANCE" && selected.messages.some((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id)) && <label className="itint"><input type="checkbox" checked={includeCurrentReply || lockedTargets.some((target) => target.conversationNo === selected.id)} disabled={!writable || busy || Boolean(pending)} onChange={(event) => setIncludeCurrentReply(event.target.checked)} /> 同时标记本会话最近一条客户消息已处理（如仍待处理）</label>}
        {composerMode === "write" && <>
        <div className="m3-composer-tools"><SupportContentTools key={`${identityRef.current}:${targetKey}:${selected?.ownerAdminId ?? adminId}:${selected?.assignmentId ?? ""}:${selected?.status ?? ""}:${canWriteM3}`} popover ctx={ctx} disabled={!writable||busy||Boolean(pending||firstPending)} onInsert={insertText} onSelect={choice=>{if(!selected){setSendError("请先发送首次联系，再推荐商品或发送页面链接。");return;}setContentChoice(choice);if(!draft.trim())insertText(choice.kind==="SKU"?"推荐商品："+choice.name:"查看："+choice.name);}}/>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" aria-label="选择图片" disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} hidden />
          <button type="button" className="l-btn sm" aria-label="选择图片" title={attachmentPolicyError || (!attachmentPolicy ? "正在加载图片规则…" : !attachmentPolicy.available ? "图片功能暂不可用（存储服务未就绪）" : "发送图片")} disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onClick={() => fileInputRef.current?.click()}><Icon name="image" size={14}/>图片</button>
        </div>
        {selected && attachmentPolicyError && <div className="itint warn" role="status">{attachmentPolicyError} <button type="button" className="l-btn sm" onClick={() => setAttachmentPolicyRetry((value) => value + 1)}>重试</button></div>}
        {maintenanceOffered&&!pending&&!firstPending&&<label className="m3-maintenance-intent"><input type="checkbox" checked={maintenanceChosen} disabled={!writable&&!requestedCustomerId||busy} onChange={event=>setMaintenanceChosen(event.target.checked)}/>本条记为联系维护{intentSource?.due===true?"（该客户维护已到期）":""}</label>}
        {displayedIntent==="MAINTENANCE"&&<div className="m3-composer-note">发送成功后计入一次人工维护执行；客户之后重新活跃才算维护成功。</div>}
        {contentChoice&&<div className="itint">将发送：{contentChoice.name}<button className="l-btn sm" disabled={busy||Boolean(pending)} onClick={()=>setContentChoice(null)}>取消推荐</button></div>}
        {attachment && <div className="itint" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><img src={attachment.url} alt="待发送图片预览" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} /><span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{attachment.file.name}</span><span>{attachment.state === "ready" ? "已上传，尚未发送" : attachment.state === "uploading" ? "上传中…" : attachment.state === "error" ? `上传失败：${attachment.error}` : "等待上传"}</span><button type="button" className="l-btn sm" disabled={!writable || busy || attachment.state === "uploading" || attachment.state === "ready"} onClick={() => void uploadImage()}>{attachment.state === "error" ? "重试上传" : "上传图片"}</button><button type="button" className="l-btn sm primary" disabled={!writable || busy || Boolean(pending) || attachment.state !== "ready"} onClick={() => void send("IMAGE")}>发送图片</button><button type="button" className="l-btn sm" onClick={() => clearAttachment()} aria-label="移除待发送图片">移除</button><small style={{ color: "var(--v5-ink-3)" }}>发送文字不会附带此图片</small></div>}
        <div className="m3-composer-input"><textarea ref={composerRef} className="fld" aria-label="输入会话消息" placeholder="输入消息，回车发送，Shift+回车 换行" value={draft} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => { setDrafts((old) => ({ ...old, [targetKey]: event.target.value })); sendAdminTyping(writable && Boolean(event.target.value.trim())); }} onBlur={() => sendAdminTyping(false)} onKeyDown={(event) => { if (shouldSendOnEnter(event)) { event.preventDefault(); void send(contentChoice?.kind ?? "TEXT"); } }} /><button className={`chat-send${busy ? " sending" : ""}`} type="button" disabled={!writable || busy || Boolean(pending || firstPending) || !draft.trim()} onClick={() => void send(contentChoice?.kind ?? "TEXT")}>{busy ? "发送中…" : contentChoice?.kind==="SKU" ? "发送商品" : contentChoice?.kind==="LINK" ? "发送链接" : "发送"}<span className="ic" aria-hidden="true">➤</span></button></div>
        <div className="m3-composer-note">回车发送 · Shift+回车 换行{presence?.typing?" · 对方正在输入…":presence?.online?" · 客户在线":""}</div>
        </>}
        {composerMode === "unbound" && <div className="m3-composer-state">{canAssign ? <>该客户还没有专属客服，分配后由专属客服回复。<button type="button" className="l-btn sm primary" onClick={() => setAssignOpen(true)}>分配专属客服</button></> : "该客户还没有专属客服，等待主管分配后回复。"}</div>}
        {composerMode === "review" && <div className="m3-composer-state">你以主管身份查看，不能回复。该客户由专属客服 {selected?.owner} 负责。</div>}
        {pending && selected?.id !== pending.conversationId && <div className="itint warn">另一条消息的结果待确认。请先返回原会话处理。<button type="button" className="l-btn sm" onClick={() => { const original = visible.find((convo) => convo.id === pending.conversationId); if (original) select(original); }}>返回原会话</button></div>}
        {(sendError || pending || firstPending) && <div className="itint danger" role="alert">{sendError || "上条消息的结果待确认，请查询发送结果。"} {sendError.startsWith("消息已发送") && <button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</button>}{(pending || firstPending) && <button type="button" className="l-btn sm" disabled={busy || Boolean(pending && selected?.id !== pending.conversationId)} onClick={() => { if (pending) void send(pending.kind, pending); else void send("TEXT"); }}>查询结果并重试</button>}</div>}
      </div>
    </div>
    <aside className={`cv-profile ${screen === "profile" ? "open" : ""}`} aria-label="客户资料"><div className="cvp-scroll"><div className="m3-profile-mobile-head"><h2>客户资料</h2><button type="button" className="l-btn sm" onClick={()=>setScreen("chat")}>返回会话</button></div>{selectedUnbound ? <div className="itint">待分配专属客服，尚无绑定客户的维护状态。</div> : profileCustomerId ? <M3CustomerProfile key={`${authEpoch}:${profileCustomerId}`} ctx={ctx} customerId={profileCustomerId} conversation={selected??undefined} scopeVersion={selected?.version??firstProfileCustomer?.version} messageError={conversationError} onRetryMessages={()=>{setConversationError("");setConversationRetry(n=>n+1);}} onHistory={no=>{const convo=visible.find(c=>c.id===no);if(convo)select(convo);}}/> : <div className="itint">{requestedCustomerId?"客户归属尚未核对，资料暂时加载不出来。":"选择客户后查看资料。"}</div>}</div></aside>
    {assignOpen&&selected?.customerId&&<AssignAdvisorDialog customerId={String(selected.customerId)} customerName={title} onClose={()=>setAssignOpen(false)} onAssigned={()=>{setAssignOpen(false);setActionError("");void ctx.refreshConversations().catch(()=>{});}}/>}
    {bulkOpen&&<SupportBulkComposer ctx={ctx} onClose={()=>setBulkOpen(false)}/>}
    {contactOpen&&<SupportContactPicker onClose={()=>setContactOpen(false)} onSelect={customerId=>{setRequestedCustomerId(customerId);setScreen("chat");setContactOpen(false);const url=new URL(window.location.href);url.searchParams.delete("conversationNo");url.searchParams.set("customerId",customerId);window.history.replaceState(null,"",url);}}/>}
    {timeoutOpen&&timeoutPolicy&&<IdlePolicyModal policy={timeoutPolicy} initialInput={timeoutInput} canSave={canTimeout} saving={timeoutSaving} error={timeoutError} pending={Boolean(timeoutPending)} conflict={timeoutConflict} latest={timeoutLatest} onDraftChange={setTimeoutInput} onCheckPending={checkTimeoutPending} onRefreshLatest={refreshTimeoutLatest} onReviewLatest={()=>{if(timeoutLatest){setTimeoutPolicy(timeoutLatest);setTimeoutLatest(null);setTimeoutConflict(false);setTimeoutError("");}}} onClose={()=>{if(!timeoutSaving)setTimeoutOpen(false);}} onSave={saveTimeout}/>}
    {timeoutOpen&&!timeoutPolicy&&<Modal title="会话超时策略" icon="clock" onClose={()=>setTimeoutOpen(false)}><p role={timeoutError?"alert":"status"}>{timeoutError||"正在加载…"}</p>{timeoutError&&<button className="l-btn sm" onClick={()=>void openTimeout()}>重新加载</button>}</Modal>}
  </section>;
}
