"use client";

import { useReach } from "@/lib/nav/use-reach";
import { customerConversations, replyTimeout } from "@/lib/admin/customer-conversations";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Bell, BellOff, Check as CheckIcon, Clock3, Image as ImageIcon, Lock, Megaphone, Plus, SendHorizontal, Square } from "lucide-react";
import { BlockState, Button, Check, Checkbox, Conclusion, Explain, Fact, Facts, Field, IconButton, Input, Modal as RdModal, MoreMenu, Notice, PageHeader, Segments, Select, StatusTag, Textarea, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { subscribeAdminRealtime, getAdminRealtimeSnapshot, watchAdminConversation, sendAdminTyping } from "@/lib/admin/admin-conversation-realtime";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { userNicknameText } from "@/lib/admin/brand-copy";
import { supportClient, SupportClientError, readSupportPoolCustomer, isIndeterminateSupportError, supportAttachmentUnavailableText, supportSessionBusy, agentSwitchText, SUPPORT_SESSION_ROLE_LABEL, type SupportAttachmentPolicy, type SupportCustomerDetail, type SupportReadMode, type SupportSessionHold } from "@/lib/admin/m-support-client";
import { markM3MessagePageRead, fetchMConversationTimeoutPolicy, updateMConversationTimeoutPolicy, parseMConversationTimeoutPolicy, type ConversationTimeoutPolicy } from "@/lib/admin/m-client";
import { businessClock, businessZone, parseBusinessTime } from "@/lib/admin/business-time";
import { RETRY_EXPIRED_TEXT, createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import type { SessionConvo, SessionMsg } from "./data";
import type { MCtx } from "./types";
import { M3CustomerProfile } from "./m3-customer-profile";
import { SupportContentTools, type SelectedSupportContent } from "./support-content-tools";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { IdlePolicyModal } from "./m3-modals";
import { Modal } from "../design-kit";
import { SupportBulkComposer, hasBulkPending } from "./support-bulk-composer";
import { AssignAdvisorDialog, hasPendingFirstAssignment } from "./m3-assign-advisor";
import { setSupportAlertPrefs, useSupportAlertPrefs } from "@/lib/admin/support-alerts";
import { legacySupportDestination, privateMessageRecovery, supportEnhancements, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import "./m3-dedicated-chat.css";
import { useM3MessagePages } from "./use-m3-message-pages";

type Intent = "SERVICE" | "MAINTENANCE";
type Attachment = { file: File; url: string; uploadId: string; key: string; id?: string; state: "selected" | "uploading" | "ready" | "error"; error?: string };
type Pending = { conversationId: string; key: string; body: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedStatus?: string; expectedVersion: number };
type TimeoutInput = { warnMinutes: number; closeMinutes: number; sessionEndMinutes?: number; reason: string };
type TimeoutCommand = { key: string; input: TimeoutInput; policy: ConversationTimeoutPolicy; operator: string };

const CONVO_KEY = "I.session.convos";
const newKey = () => `m3-${crypto.randomUUID()}`;
const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
const recoveryKey = (adminId: number, key: string) => `${pendingKey(adminId)}:recovery:${key}`;
const ticketLinksKey = (adminId: number) => `nexion-m3-converted-tickets-v1:${adminId}`;
const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
type StoredMessage = PendingMutationRecord & { payload: string };
// Legacy timeout rows must survive private-message housekeeping even when their payload cannot be recovered.
const pendingMessages = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", retainExpiredRecords: true, isValidRecord: (row) => typeof row.payload === "string" || /^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint) });
const pendingTimeoutPolicies = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-timeout-pending-v1", retainExpiredRecords: true, isValidRecord: (row) => typeof row.payload === "string" });
type SessionEndRecord = PendingMutationRecord & { actorId: number; customerId: string };
// BUG-052: one record per operator and customer, so a refresh or ending another customer's session keeps the original number.
const sessionEndCommands = createPendingMutationStore<SessionEndRecord>({ storageKey: "nexion-admin-m3-session-end-v1", retainExpiredRecords: true, isValidRecord: (row) => Number.isSafeInteger(row.actorId) && typeof row.customerId === "string" });
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
  return Number.isFinite(ts) && ts > 0 ? businessClock(ts) : "";
}

function messageDay(ts: number): string {
  return Number.isFinite(ts) && ts > 0 ? new Intl.DateTimeFormat("en-CA", { timeZone: businessZone().zoneId, year: "numeric", month: "2-digit", day: "2-digit" }).format(ts) : "";
}

function holdClock(value: string | null): string {
  return value ? businessClock(parseBusinessTime(value)) : "";
}

function waitText(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  if (minutes < 60) return `${Math.max(minutes, 1)} 分钟`;
  return minutes < 1440 ? `${Math.floor(minutes / 60)} 小时` : `${Math.floor(minutes / 1440)} 天`;
}

/** 收件箱里的相对时间（TX-27），悬停看绝对时间。 */
function agoText(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  return now - ts < 60000 ? "刚刚" : `${waitText(now - ts)}前`;
}

function lastMessage(convo: SessionConvo): SessionMsg | undefined {
  return [...convo.messages].reverse().find((message) => message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && (message.sender === "user" || message.sender === "agent"));
}

function PrivateImage({ id, onRevoked }: { id: string; onRevoked: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [zoomed, setZoomed] = useState(false);
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
  if (error) return <span role="alert">图片暂无法查看：{error} <Button size="sm" onClick={() => setRetry((value) => value + 1)}>重试</Button></span>;
  if (!url) return <span>图片加载中…</span>;
  return <>
    <button type="button" className="m3s-image" aria-label="放大查看图片" onClick={() => setZoomed(true)}><img src={url} alt="会话图片" /></button>
    {zoomed && <RdModal wide title="查看图片" icon={ImageIcon} onClose={() => setZoomed(false)}><img className="m3s-image-full" src={url} alt="会话图片" /></RdModal>}
  </>;
}

function SupportMessage({message,previous,customerId,customerAvatarRef,customerName,onRevoked,newlyArrived}:{message:SessionMsg;previous?:SessionMsg;customerId:string;customerAvatarRef?:string|null;customerName:string;onRevoked:()=>void;newlyArrived?:boolean}) {
  const reach=useReach();
  const canCheckSku=reach("/devices/pricing","device_e1_read");
  const system=message.sourceSenderType==="SYSTEM"||message.sourceSenderType==="INTERNAL";
  const name=message.sender==="agent"?message.agentName||"历史专属客服":customerName;
  // B16: a welcome without an author is the system's (agentName 「系统」 from the adapter); its author is not "unconfirmed".
  const ownerlessWelcome=message.origin==="WELCOME"&&message.senderId==null;
  const grouped=!system&&previous?.sourceSenderType===message.sourceSenderType&&previous?.sender===message.sender&&message.authorConfidence==="VERIFIED"&&previous.authorConfidence==="VERIFIED"&&previous.senderId===message.senderId&&previous.origin===message.origin&&message.ts-previous.ts<300000;
  const path=message.authorConfidence==="VERIFIED"&&message.senderId?(message.sender==="agent"?message.senderAvatar?advisorAvatarPath(message.senderId,customerId):undefined:String(message.senderId)===customerId?customerAvatarRef??undefined:undefined):undefined;
  const safeLegacy=message.kind==="TEXT"||!message.kind?legacySupportDestination(message.text):undefined;
  const canCheckLegacy=Boolean(safeLegacy&&reach(safeLegacy)&&(safeLegacy!=="/devices/pricing"||canCheckSku));
  const imageCaption=message.kind==="IMAGE"?message.text.trim():"";
  // B15 「客服已切换」: a centred divider naming the new handler and their role.
  if(message.kind==="AGENT_SWITCH")return <div className="m3s-divider" role="note"><span>{agentSwitchText(message.agentName,message.senderRole)} · <time>{messageTime(message.ts)}</time></span></div>;
  // System notices are not anyone's speech: a centred strip without bubble, avatar or receipt (M-11).
  if(message.sourceSenderType==="SYSTEM")return <div className="m3s-system" role="note"><span>{(message).text}</span><time>{messageTime(message.ts)}</time></div>;
  if(message.sourceSenderType==="INTERNAL")return <div className="m3s-internal" role="note"><span className="m3s-internal-label">内部备注 · {message.agentName&&message.agentName!=="系统"?message.agentName:"客服"} · {messageTime(message.ts)}</span><span className="rd-pre">{(message).text}</span></div>;
  const mine=message.sender==="agent";
  return <div className="m3s-msg" data-side={mine?"agent":"customer"} data-new={newlyArrived?"":undefined}>
    {grouped?<span className="m3s-msg-gap"/>:<SupportAvatar name={name} path={path} version={message.senderAvatar?.version} size={32}/>}
    <div className="m3s-msg-copy">
      {!grouped&&<span className="m3s-msg-author">{name}{mine&&message.senderRole&&<span className="m3s-role" data-tone={message.senderRole==="ADVISOR"?"role-2":message.senderRole==="SUPERVISOR"?"role-3":"role-4"}>{SUPPORT_SESSION_ROLE_LABEL[message.senderRole]}</span>}{message.origin==="WELCOME"&&<span className="m3s-role" data-tone="neutral" title="注册后系统自动发送，不是客服手动输入">自动欢迎语</span>}{!ownerlessWelcome&&message.authorConfidence!=="VERIFIED"?" · 作者身份未确认":""} · <time>{messageTime(message.ts)}</time></span>}
      <div className="m3s-bubble" data-user-content="">
        {message.kind==="IMAGE"?message.attachmentId?<PrivateImage id={message.attachmentId} onRevoked={onRevoked}/>:"图片暂不可用":<span style={{whiteSpace:"pre-wrap"}}>{(message).text}</span>}
        {imageCaption&&imageCaption!=="[图片]"&&<div className="m3s-caption">{message.text}</div>}
        {message.kind==="SKU"&&<div className="m3s-attach"><strong>{(message.skuName ?? "")}</strong><p>商品编号：{message.skuId}</p>{message.targetAvailability==="UNAVAILABLE"?<span>商品已不可用；原推荐保留。</span>:canCheckSku?<a className="rd-link" href={`/devices/pricing?sku=${encodeURIComponent(message.skuId??"")}`}>核对商城商品</a>:<span aria-disabled="true">核对商城商品（无访问权限）</span>}</div>}
        {message.kind==="LINK"&&<p className="m3s-attach">{message.targetAvailability==="UNAVAILABLE"?"目标页面已不可用":`客户端目标：${{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[message.linkTarget?.type??"HOME"]}`}</p>}
        {safeLegacy&&(canCheckLegacy?<a className="rd-link" href={safeLegacy}>核对原推荐页面</a>:<span aria-disabled="true">核对原推荐页面（无访问权限）</span>)}
      </div>
      {/* M-29: delivered is the normal case and says nothing; only 已读 or a missing message id is worth showing. */}
      {mine&&(message.status==="read"||!message.id)&&<small className="m3s-receipt" data-warn={message.id?undefined:""}>{message.status==="read"?"已读":"提交状态未知"}</small>}
    </div>
  </div>;
}

function SupportContactPicker({onClose,onSelect}:{onClose:()=>void;onSelect:(id:string)=>void}) {
  const adminId=useAdminAuth(s=>s.session?.adminId),epoch=useAdminAuth(s=>s.authEpoch);
  const [keyword,setKeyword]=useState(""),[page,setPage]=useState(1),[retry,setRetry]=useState(0);
  const search=keyword.trim(),requestKey=JSON.stringify([adminId,epoch,page,search]);
  const [response,setResponse]=useState<{key:string;data:Awaited<ReturnType<typeof supportClient.customers>>|null;error:string}|null>(null);
  const rows=response?.key===requestKey?response.data:null,error=response?.key===requestKey?response.error:"";
  useEffect(()=>{
    const controller=new AbortController();
    setResponse(null);
    const load=()=>supportClient.customers({mode:"PERSONAL",pageNum:page,pageSize:10,filter:"ALL",keyword:search,signal:controller.signal})
      .then(data=>{
        if(controller.signal.aborted)return;
        const lastPage=Math.max(1,Math.ceil(data.total/10));
        if(page>lastPage){setPage(lastPage);return;}
        setResponse({key:requestKey,data,error:""});
      })
      .catch(cause=>{if(!controller.signal.aborted)setResponse({key:requestKey,data:null,error:displayAdminError(cause)});});
    const timer=search?setTimeout(load,250):undefined;
    if(!search)void load();
    return()=>{controller.abort();clearTimeout(timer);};
  },[search,page,retry,epoch,adminId,requestKey]);
  const pages=Math.max(1,Math.ceil((rows?.total??0)/10));
  return <Modal title="主动联系本人客户" icon="users" onClose={onClose} footer={<Button onClick={onClose}>取消</Button>}>
    <div className="m3s-picker">
      <Field label="搜索客户" explain="只可选择当前本人客户；不再维护客户可在原求助会话中继续普通服务回复。选择后只打开客户，不会发送。">{control=><Input {...control} data-search aria-label="搜索客户" placeholder="昵称、手机号或用户编号" maxLength={200} value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1);}}/>}</Field>
      {error?<Notice tone="danger" action={<Button size="sm" onClick={()=>setRetry(n=>n+1)}>重试客户列表</Button>}>{error}</Notice>:!rows?<BlockState state="loading" title="正在加载客户…"/>:<>
        <p className="m3s-aux" role="status">共 {rows.total} 位客户 · 每页 10 条</p>
        {!rows.records.length?<BlockState state="empty" title="暂无匹配的客户。"/>:<ul className="m3s-picker-list" aria-label="可联系客户">
          {rows.records.map(c=><li key={c.customerId}><button type="button" disabled={c.agentAdminId!==adminId||!c.maintenanceEnabled} onClick={()=>onSelect(c.customerId)}>
            <span><strong>{c.displayName||c.customerNo||c.customerId}</strong><small>用户编号：U{c.customerId.padStart(8,"0")}</small></span>
            <span className="m3s-aux">{!c.maintenanceEnabled?"不再维护":c.agentAdminId!==adminId?"当前归属其他专属客服":"选择"}</span>
          </button></li>)}
        </ul>}
        <nav className="m3s-picker-pager" aria-label="客户分页">
          <Button size="sm" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>上一页</Button>
          <span className="m3s-aux">第 {page} / {pages} 页</span>
          <Button size="sm" disabled={page>=pages} onClick={()=>setPage(n=>n+1)}>下一页</Button>
        </nav>
      </>}
    </div>
  </Modal>;
}

type ListTab = "holding" | "pending" | "unassigned" | "open" | "all" | "archived";
const LIST_TABS: Array<[ListTab, string]> = [["holding", "我接待中"], ["pending", "待回复"], ["unassigned", "待分配"], ["open", "进行中"], ["all", "全部"], ["archived", "归档"]];
const TAB_ORDER: ListTab[] = ["pending", "unassigned", "holding", "open", "all", "archived"];
const LIST_CHUNK = 30;
// 列表状态的解释（DP-35）：这是什么意思、下一步谁来做。
const STATE_HELP: Record<string, string> = {
  late: "客户等待超过了超时策略的时长。回复后清除。",
  "待专属客服回复": "客户发了消息，还没人回。下一步：专属客服回复。",
  "待分配专属客服": "这位客户还没有专属客服。下一步：主管分配。",
  "待首次联系": "还没有人工消息。下一步：专属客服发第一条。",
  "已处理": "没有待回复，不用操作。",
  "查看待回复状态": "待回复状态还没同步，打开客户后会读取。",
};
/** M-22/M-23: rows are customers (customerConversations); waiting customers first, longest wait first. */
function tabMatch(row: SessionConvo, tab: ListTab, adminId: number): boolean {
  if (tab === "archived") return row.archived === true;
  if (tab === "holding") return Boolean(row.holder && row.holder.adminId === adminId);
  if (row.archived) return false;
  if (tab === "unassigned") return row.ownerUnbound === true;
  if (tab === "pending") return (row.pendingReplyCount ?? 0) > 0 && row.ownerUnbound !== true;
  if (tab === "open") return row.status === "open";
  return true;
}

export function M3DedicatedChat({ ctx, back, summary, banner, streamReady, reconnectExhausted }: { ctx: MCtx; back?: ReactNode; summary: string; banner?: ReactNode; streamReady: boolean; reconnectExhausted: boolean }) {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const adminId = session?.adminId ?? 0;
  const scopeIdentity = `${authEpoch}:${adminId}`;
  const [reviewScope, setReviewScope] = useState<{ identity: string; mode: SupportReadMode } | null>(null);
  const [reviewScopeError, setReviewScopeError] = useState("");
  const [scopeDenied, setScopeDenied] = useState(false);
  const [scopeRetry, setScopeRetry] = useState(0);
  const reviewGeneration = useRef(0);
  useEffect(() => {
    const controller = new AbortController(), generation = ++reviewGeneration.current;
    setReviewScope(null); setReviewScopeError(""); setScopeDenied(false);
    if (adminId) void supportClient.overview({ signal: controller.signal }).then(({ scope }) => {
      if (controller.signal.aborted || generation !== reviewGeneration.current || scope.actorId !== adminId) return;
      setReviewScope({ identity: scopeIdentity, mode: scope.mode });
    }).catch((cause: unknown) => { if (!controller.signal.aborted && generation === reviewGeneration.current) { setReviewScope(null); if (cause instanceof SupportClientError && cause.status === 403) setScopeDenied(true); else setReviewScopeError("当前会话范围暂时无法核对。请重试。"); } });
    const invalidate = () => { controller.abort(); reviewGeneration.current++; setReviewScope(null); setScopeRetry(value => value + 1); };
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => { controller.abort(); reviewGeneration.current++; window.removeEventListener("support-scope-invalidated", invalidate); };
  }, [adminId, scopeIdentity, scopeRetry]);
  const canWriteM3 = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities?.includes("service_m3_write"));
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [messageOpening, setMessageOpening] = useState(0);
  const selectionRestored = useRef(false);
  // A deep link or restored selection opens in whichever inbox scope holds it (supervisors default to "mine").
  const followSelection = useRef(false);
  const [screen, setScreen] = useState<"list" | "chat" | "profile">("list");
  const [query, setQuery] = useState("");
  const [listTab, setListTab] = useState<ListTab>(() => { const tab = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab"); return LIST_TABS.some(([value]) => value === tab) ? tab as ListTab : "pending"; }), [listLimit, setListLimit] = useState(LIST_CHUNK), [archiveIds, setArchiveIds] = useState<Set<string>>(new Set());
  const [contentChoice, setContentChoice] = useState<SelectedSupportContent | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const refocusComposer = useRef(false);
  const [ownCustomers, setOwnCustomers] = useState<number | null>(null);
  const [bulkBatches, setBulkBatches] = useState<number | null>(null);
  const [noAdvisorToAssign, setNoAdvisorToAssign] = useState(false);
  const [entryCheck, setEntryCheck] = useState(0);
  const alertPrefs = useSupportAlertPrefs();
  // M-28: archiving is an occasional batch task; checkboxes only appear while it is switched on.
  const [archiveMode, setArchiveMode] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false), [contactOpen, setContactOpen] = useState(false), [assignOpen, setAssignOpen] = useState(false);
  const [timeoutOpen, setTimeoutOpen] = useState(false), [timeoutPolicy, setTimeoutPolicy] = useState<ConversationTimeoutPolicy | null>(null), [timeoutError, setTimeoutError] = useState(""), [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutInput,setTimeoutInput]=useState<TimeoutInput|undefined>(undefined);
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
  const messageBodyRef = useRef<HTMLDivElement>(null);
  const messageAnchor = useRef<{ id: string; offset: number } | null>(null);
  const messageScroll = useRef({ top: 0, bottom: true, touchY: 0 });
  const olderScrollIntent = useRef({ up: false, scrollbar: false, pointerY: 0, clientHeight: 0, scrollHeight: 0 });
  const [busy, setBusy] = useState(false);
  const [firstDetail, setFirstDetail] = useState<SupportCustomerDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [profileDetail, setProfileDetail] = useState<SupportCustomerDetail | null>(null);
  const [profileError, setProfileError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [firstPending, setFirstPending] = useState<{ key: string; body: string; intent: Intent; clientMessageId: string; customerId: string; assignmentId: string; version: number; replyTargets: Array<{ conversationNo: string; throughMessageId: number }> } | null>(null);
  const [readError, setReadError] = useState("");
  const [readRetry, setReadRetry] = useState(0);
  const failedReadContext = useRef<{ key: string; beforeMessageId?: number } | null>(null);
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
  // 刚打开时连接还没建好不算断线；断开 5 秒还没恢复才提示（ST-52）。
  const [streamLost, setStreamLost] = useState(false);
  useEffect(() => {
    setStreamLost(false);
    if (streamReady || !conversationsAvailable) return;
    const timer = setTimeout(() => setStreamLost(true), 5000);
    return () => clearTimeout(timer);
  }, [streamReady, conversationsAvailable]);
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
  const [scopeView, setScopeView] = useState<"mine" | "team" | null>(() => { const value = typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("scope"); return value === "mine" || value === "team" ? value : null; });
  const [agentFilter, setAgentFilter] = useState<number>(() => { const value = typeof window === "undefined" ? 0 : Number(new URLSearchParams(window.location.search).get("agent")); return Number.isSafeInteger(value) && value > 0 ? value : 0; });
  // 范围和客服筛选写进网址（ST-23），刷新和复制链接不丢。客户姓名搜索不写。
  const changeScope = (view: "mine" | "team", agent = 0) => {
    setScopeView(view); setAgentFilter(agent);
    const url = new URL(window.location.href);
    url.searchParams.set("scope", view);
    if (agent) url.searchParams.set("agent", String(agent)); else url.searchParams.delete("agent");
    window.history.replaceState(null, "", url);
  };
  const hasOwn = visible.some((convo) => convo.ownerAdminId === adminId);
  const reviewing = canReviewAll && (scopeView ?? (hasOwn && listTab !== "unassigned" ? "mine" : "team")) === "team";
  const scoped = useMemo(() => !canReviewAll ? visible : reviewing ? visible.filter((convo) => convo.ownerAdminId !== adminId && (!agentFilter || convo.ownerAdminId === agentFilter)) : visible.filter((convo) => convo.ownerAdminId === adminId), [visible, canReviewAll, reviewing, agentFilter, adminId]);
  const teamAgents = useMemo(() => [...new Map(visible.filter((convo) => convo.ownerAdminId && convo.ownerAdminId !== adminId).map((convo) => [convo.ownerAdminId!, convo.owner])).entries()], [visible, adminId]);
  const customerRows = customerConversations(scoped);
  // 「我接待中」 needs the inbox holder field (B15); hidden while the backend does not send it.
  const holderKnown = customerRows.some(row => row.holder !== undefined);
  const tabs = LIST_TABS.filter(([value]) => (value !== "unassigned" || reviewing) && (value !== "holding" || holderKnown));
  const requestedConvo = validCustomerId(requestedCustomerId) ? customerRows.find((convo) => customerIdOf(convo) === requestedCustomerId) : null;
  const selectedCustomer = visible.find(row=>row.id===selectedId)?.customerId;
  const selectedSummary = requestedCustomerId ? requestedConvo ?? null : selectedId ? customerRows.find(row=>row.customerId===selectedCustomer) ?? null : customerRows.find(convo=>!convo.archived) ?? null;
  const pageScope = `${scopeIdentity}:${scopeGeneration.current}:${scopeRetry}:${qualificationUnknown}:${conversationsAvailable}`;
  const messagePages = useM3MessagePages(qualificationUnknown || !conversationsAvailable ? null : selectedSummary, pageScope, messageOpening, ctx.invalidateScope);
  const pageConversation = messagePages.page?.conversation.id === selectedSummary?.id ? messagePages.page?.conversation : null;
  const selected = selectedSummary ? { ...selectedSummary, ...(pageConversation ?? {}),
    holder: selectedSummary.holder,
    version: Math.max(selectedSummary.version, pageConversation?.version ?? 0),
    messages: messagePages.messages, detailReady: Boolean(messagePages.page),
    status: selectedSummary.version > (pageConversation?.version ?? -1) ? selectedSummary.status : pageConversation?.status ?? selectedSummary.status,
  } : null;
  const identityMemory = useRef<{ scope: string; rows: Map<string, NonNullable<typeof messagePages.page>["customerIdentity"]> }>({ scope: pageScope, rows: new Map() });
  if (identityMemory.current.scope !== pageScope) identityMemory.current = { scope: pageScope, rows: new Map() };
  if (messagePages.page) identityMemory.current.rows.set(String(messagePages.page.customerIdentity.customerId), messagePages.page.customerIdentity);
  const identityRows = customerRows.map(row => {
    const identity = identityMemory.current.rows.get(String(row.customerId));
    return identity ? { ...row, customer: identity.nickname ?? row.customer, profile: row.profile ? { ...row.profile, uid: identity.userNo, nickname: identity.nickname ?? row.profile.nickname, phone: identity.phoneMasked ?? row.profile.phone } : row.profile } : row;
  });
  const filtered = identityRows.filter(convo => tabMatch(convo,listTab,adminId) && (!query.trim() || [convo.customer ?? "", convo.profile?.nickname ?? "", convo.profile?.uid ?? "", `U${customerIdOf(convo).padStart(8, "0")}`, customerIdOf(convo), convo.id].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))))
    .sort(listTab === "pending" || listTab === "unassigned" ? (a, b) => (a.pendingReplySince ?? Infinity) - (b.pendingReplySince ?? Infinity) : (a, b) => (b.lastHumanTs ?? b.lastTs) - (a.lastHumanTs ?? a.lastTs));
  const listRows = filtered.slice(0, listLimit);
  const paneMessages = messagePages.page ? messagePages.messages : null;
  const historyComplete = Boolean(messagePages.page && !messagePages.hasMore);
  const conversationError = messagePages.error;
  useEffect(() => { failedReadContext.current = null; markedRef.current = ""; setReadError(""); }, [messagePages.key]);
  const loadOlderMessages = () => {
    olderScrollIntent.current.up = false;
    olderScrollIntent.current.scrollbar = false;
    const body = messageBodyRef.current;
    if (!body || messagePages.loading || !messagePages.hasMore) return;
    const top = body.getBoundingClientRect().top;
    const anchor = [...body.querySelectorAll<HTMLElement>("[data-m3-message-id]")].find(element => element.getBoundingClientRect().bottom > top);
    messageAnchor.current = anchor ? { id: anchor.dataset.m3MessageId!, offset: anchor.getBoundingClientRect().top - top } : null;
    void messagePages.loadOlder();
  };
  const onMessageScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const body = event.currentTarget, previous = messageScroll.current.top;
    const heldScrollbar = olderScrollIntent.current.scrollbar && olderScrollIntent.current.clientHeight === body.clientHeight && olderScrollIntent.current.scrollHeight === body.scrollHeight;
    if (!heldScrollbar) olderScrollIntent.current.scrollbar = false;
    const intended = olderScrollIntent.current.up || heldScrollbar;
    olderScrollIntent.current.up = false;
    messageScroll.current.top = body.scrollTop;
    messageScroll.current.bottom = body.scrollHeight - body.scrollTop - body.clientHeight <= 40;
    if (intended && body.scrollTop < previous && body.scrollTop <= 60) loadOlderMessages();
  };
  const onMessageUpInput = (up: boolean, body: HTMLDivElement) => {
    olderScrollIntent.current.up = up;
    if (up && body.scrollTop <= 60) loadOlderMessages();
  };
  const onMessageWheel = (event: React.WheelEvent<HTMLDivElement>) => onMessageUpInput(!event.ctrlKey && event.deltaY < 0, event.currentTarget);
  const onMessageTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const y = event.touches[0]?.clientY ?? 0;
    onMessageUpInput(y > messageScroll.current.touchY, event.currentTarget);
    messageScroll.current.touchY = y;
  };
  const onMessageKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => onMessageUpInput(["ArrowUp", "PageUp", "Home"].includes(event.key), event.currentTarget);
  const onMessagePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const body = event.currentTarget;
    olderScrollIntent.current.scrollbar = event.button === 0 && event.clientX >= body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
    olderScrollIntent.current.pointerY = event.clientY;
    olderScrollIntent.current.clientHeight = body.clientHeight;
    olderScrollIntent.current.scrollHeight = body.scrollHeight;
    olderScrollIntent.current.up = false;
  };
  const onMessagePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!olderScrollIntent.current.scrollbar) return;
    onMessageUpInput(event.clientY < olderScrollIntent.current.pointerY, event.currentTarget);
    olderScrollIntent.current.pointerY = event.clientY;
  };
  useEffect(() => {
    const release = () => { olderScrollIntent.current.up = false; olderScrollIntent.current.scrollbar = false; };
    document.addEventListener("pointerup", release); document.addEventListener("pointercancel", release);
    return () => { document.removeEventListener("pointerup", release); document.removeEventListener("pointercancel", release); };
  }, []);
  const onMessageAssetLoad = () => {
    olderScrollIntent.current.up = false;
    olderScrollIntent.current.scrollbar = false;
    const body = messageBodyRef.current;
    if (body && messageScroll.current.bottom) { body.scrollTop = body.scrollHeight; messageScroll.current.top = body.scrollTop; }
  };
  useLayoutEffect(() => {
    olderScrollIntent.current.up = false;
    olderScrollIntent.current.scrollbar = false;
    if (!messagePages.revision) { olderScrollIntent.current.pointerY = 0; messageScroll.current.touchY = 0; }
    const body = messageBodyRef.current;
    if (!body) return;
    if (!messagePages.revision) { messageScroll.current = { top: 0, bottom: true, touchY: 0 }; messageAnchor.current = null; return; }
    if (messagePages.change === "reset" || messagePages.change === "latest" && messageScroll.current.bottom && !messagePages.gap) body.scrollTop = body.scrollHeight;
    else if (messagePages.change === "older" && messageAnchor.current) {
      const anchor = body.querySelector<HTMLElement>(`[data-m3-message-id="${messageAnchor.current.id}"]`);
      if (anchor) body.scrollTop += anchor.getBoundingClientRect().top - body.getBoundingClientRect().top - messageAnchor.current.offset;
    }
    messageAnchor.current = null;
    messageScroll.current.top = body.scrollTop;
    messageScroll.current.bottom = body.scrollHeight - body.scrollTop - body.clientHeight <= 40;
  }, [messagePages.key, messagePages.revision]);
  const [timeoutNow, setTimeoutNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setTimeoutNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  useEffect(() => { let current = true; void fetchMConversationTimeoutPolicy().then(policy => { if(current) setTimeoutPolicy(policy); }).catch(() => {}); return () => { current = false; }; }, [authEpoch]);
  // B15 接待状态 of the open customer: undefined = not read yet, null = read failed (backend without B15).
  // Then the customer's advisor keeps today's behaviour and supervisors stay read-only.
  const holdCustomer = selected?.customerId ?? (validCustomerId(requestedCustomerId) ? requestedCustomerId : undefined);
  const [holdRead, setHoldRead] = useState<{ customerId: string; hold: SupportSessionHold | null } | null>(null);
  const [holdRetry, setHoldRetry] = useState(0), [holdEnding, setHoldEnding] = useState(false);
  const [holdEndCommand, setHoldEndCommand] = useState<SessionEndRecord | null>(null);
  useEffect(() => { setHoldEndCommand(sessionEndCommands.list().find(row => row.actorId === adminId && row.customerId === holdCustomer) ?? null); }, [adminId, holdCustomer, authEpoch]);
  const holdRequest = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const hold = holdRead && holdRead.customerId === holdCustomer ? holdRead.hold : undefined;
  const inboxHolder = selectedSummary?.holder === undefined ? "unknown" : selectedSummary.holder === null ? "none" : `${selectedSummary.holder.adminId}:${selectedSummary.holder.role}`;
  useEffect(() => {
    if (!holdCustomer || qualificationUnknown || !conversationsAvailable) return;
    const controller = new AbortController(), generation = ++holdRequest.current.generation;
    holdRequest.current.controller = controller;
    const current = () => !controller.signal.aborted && generation === holdRequest.current.generation;
    supportClient.sessionHold(holdCustomer, controller.signal)
      .then(next => { if (current()) setHoldRead({ customerId: holdCustomer, hold: next }); })
      .catch(() => { if (current()) setHoldRead({ customerId: holdCustomer, hold: null }); });
    return () => controller.abort();
  }, [holdCustomer, holdRetry, selected?.version, selected?.lastTs, inboxHolder, authEpoch, adminId, qualificationUnknown, conversationsAvailable]);
  // A send refused with 409 SUPPORT_SESSION_BUSY is the newest fact: earlier reads still in flight must not unlock it.
  const lockFromBusy = (customerId: string, busyHold: SupportSessionHold) => {
    holdRequest.current.generation++; holdRequest.current.controller?.abort();
    setHoldRead({ customerId, hold: busyHold });
  };
  useEffect(() => {
    // The pending 结束会话 command is settled once the hold is read as no longer this account's.
    if (holdEndCommand && holdEndCommand.customerId === holdCustomer && hold && hold.state !== "MINE") { sessionEndCommands.forget(holdEndCommand.fingerprint, holdEndCommand.commandKey); setHoldEndCommand(null); }
  }, [holdEndCommand, holdCustomer, hold]);
  useEffect(() => {
    if (!hold?.autoEndAt || hold.state === "FREE") return;
    const timer = setTimeout(() => setHoldRetry(n => n + 1), Math.min(Math.max(parseBusinessTime(hold.autoEndAt) - Date.now() + 1000, 1000), 2147483647));
    return () => clearTimeout(timer);
  }, [hold?.autoEndAt, hold?.state]);
  const actsAsAdvisor = selected ? selected.ownerAdminId === adminId : Boolean(firstDetail && firstDetail.agentAdminId === adminId);
  const heldByOther = hold?.state === "OTHER";
  // Supervisors and the super admin send as themselves only after the hold read says nobody else is talking.
  const holdAllowsOther = canReviewAll && !actsAsAdvisor && (hold?.state === "FREE" || hold?.state === "MINE");
  const holderRole = hold?.holder ? SUPPORT_SESSION_ROLE_LABEL[hold.holder.role] : "";
  const myRoleLabel = session?.role === "super" || session?.role === "superadmin" ? "超级管理员" : "客服主管";
  const myName = session?.operator || session?.username || "";
  const canContinueClosed = Boolean(canWriteM3 && selected?.detailReady && selected.status !== "open" && selected.ownerAdminId === adminId);
  const historyReadOnlyHint = (selected?.status === "transferred" ? "此会话已转出，仅可查看历史。" : "历史会话只读。") + (canContinueClosed ? "前往当前会话会重新核对专属客服归属。" : "");
  // M-26 / M-54: messages are service replies by default. Per SPEC FEAT-M04 and CONTRACTS §5 (owner decision R05),
  // maintenance is counted only through an explicit 联系维护 intent, so it is an opt-in switch, never inferred.
  const intentSource = requestedCustomerId && !selected ? firstDetail : profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const [maintenanceChosen, setMaintenanceChosen] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("intent") === "maintenance");
  // 联系维护 is the advisor's own task; supervisor and super-admin messages never count as maintenance.
  const maintenanceOffered = actsAsAdvisor && Boolean(intentSource?.maintenanceEnabled && intentSource.due === true);
  const intent: Intent = maintenanceOffered && maintenanceChosen ? "MAINTENANCE" : "SERVICE";
  const replyCustomerId = selected ? canSendTo(selected, adminId) || holdAllowsOther ? customerIdOf(selected) : null : requestedCustomerId;
  const allReplyTargets = messagePages.page?.replyContext.targets ?? [];
  const currentReplyTarget = allReplyTargets.find(target => target.conversationNo === selected?.id);
  const closedReplyCandidates = allReplyTargets.filter(target => target.conversationNo !== selected?.id).map(target => ({ ...target, text: `会话 ${target.conversationNo} 的待回复消息` }));
  const closedCandidateRows = closedReplyCandidates;
  const closedCandidateMissing = selected && !messagePages.contextReady ? [selected.id] : [];
  const closedCandidateError = selected && !messagePages.contextReady ? conversationError : "";
  const closedReplyTargets = closedReplyCandidates.filter(row => intent === "SERVICE" || selectedClosedIds.has(row.conversationNo)).map(({ conversationNo, throughMessageId }) => ({ conversationNo, throughMessageId }));
  const closedCandidatesReady = (!selected || messagePages.contextReady && messagePages.page?.replyContext.ready === true) && [...selectedClosedIds].every(id => closedReplyCandidates.some(row => row.conversationNo === id));
  const closedCandidateIds = closedReplyCandidates.map(row => row.conversationNo).join("|"), replyContextReady = messagePages.contextReady && messagePages.page?.replyContext.ready === true;
  // A target someone else cleared would otherwise hold closedCandidatesReady false with nothing on screen to untick.
  useEffect(() => { if (replyContextReady) setSelectedClosedIds(old => { const offered = new Set(closedCandidateIds.split("|")), next = [...old].filter(id => offered.has(id)); return next.length === old.size ? old : new Set(next); }); }, [closedCandidateIds, replyContextReady]);
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
  const composerMode: "write" | "unbound" | "review" | "locked" | "checking" = selected && selectedUnbound ? "unbound" : heldByOther ? "locked" : !selected || actsAsAdvisor || holdAllowsOther ? "write" : canReviewAll && canWriteM3 && hold === undefined ? "checking" : "review";
  const canReadAssignment = Boolean(canReviewAll && !qualificationUnknown && selected?.customerId && session?.authorities.includes("service_m1_read"));
  const canWriteAssignment = canReadAssignment && Boolean(session?.authorities.includes("service_m1_write"));
  const pendingAssignment = canReadAssignment && hasPendingFirstAssignment(adminId, String(selected?.customerId));
  const canAssign = Boolean(selectedUnbound && canWriteAssignment || pendingAssignment);
  // BUG-040: a supervisor's 正式转绑 only reaches customers of advisors in the groups they manage; the roster is that set. While it is unread the form gives the answer.
  const canTransfer = Boolean((session?.role === "super" || session?.role === "superadmin" || session?.authorities?.includes("service_m1_write")) && (scopeMode === "ALL" || ctx.pget("I.support.agentsAvailable") !== "1" || agents.some(agent => agent.adminId === (selected?.ownerAdminId ?? firstDetail?.agentAdminId))));
  const assignLabel = pendingAssignment ? "核对上次分配" : "分配专属客服";
  const firstProfileCustomer = !selected && conversationsAvailable && firstDetail?.assignmentId && firstDetail.customerId === requestedCustomerId && (canReviewAll || firstDetail.agentAdminId === adminId) ? firstDetail : null;
  const profileCustomerId = selected && !selectedUnbound ? selected.customerId : firstProfileCustomer?.customerId;
  const currentProfileDetail = profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const targetKey = selected?.id ?? (requestedCustomerId ? `first:${requestedCustomerId}` : "");
  const draft = drafts[targetKey] ?? "";
  const recoveryBlocksTarget = recoveries.some(({ locator }) => Boolean(locator.conversationId && locator.conversationId === selected?.id) || Boolean(locator.customerId && locator.customerId === (selected?.customerId ?? requestedCustomerId)));
  const writable = !qualificationUnknown && !recoveryBlocksTarget && canWriteM3 && !heldByOther && (selected ? selected.detailReady === true && closedCandidatesReady && (canSendTo(selected, adminId) || holdAllowsOther && canSendTo({ ...selected, ownerAdminId: adminId }, adminId)) && Boolean(currentProfileDetail?.assignmentId && currentProfileDetail.agentAdminId === selected.ownerAdminId) : Boolean(validCustomerId(requestedCustomerId) && closedCandidatesReady && firstDetail?.assignmentId && (firstDetail.agentAdminId === adminId || holdAllowsOther)));
  // 没有本人客户、没有可分配的客服时入口直接禁用，不打开弹窗再说做不了。读不到不拦，弹窗里有失败和重试。
  // 结果跟着已有的更新走：会话快照、名册变了，或切回这个页面，都重读一次（ST-54）。
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") setEntryCheck(value => value + 1); };
    window.addEventListener("focus", again); document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, []);
  const rosterSource = ctx.pget("I.support.agents");
  useEffect(() => { setOwnCustomers(null); setBulkBatches(null); }, [adminId, authEpoch]);
  useEffect(() => {
    if (!canWriteM3 || qualificationUnknown) return;
    const controller = new AbortController();
    void supportClient.customers({ mode: "PERSONAL", pageNum: 1, pageSize: 1, filter: "ALL", keyword: "", signal: controller.signal }).then(page => { if (!controller.signal.aborted) setOwnCustomers(page.total); }).catch(() => undefined);
    void supportEnhancements.bulkJobs(1, controller.signal).then(page => { if (!controller.signal.aborted) setBulkBatches(page.total); }).catch(() => undefined);
    return () => controller.abort();
  }, [canWriteM3, qualificationUnknown, adminId, authEpoch, conversationSource, rosterSource, entryCheck]);
  useEffect(() => {
    setNoAdvisorToAssign(false);
    if (!selectedUnbound || !canWriteAssignment || pendingAssignment || !selected?.customerId) return;
    const controller = new AbortController();
    void readSupportPoolCustomer(String(selected.customerId)).then(pool => supportClient.agents({ pageNum: 1, pageSize: 100, groupId: pool.routeGroupId ? Number(pool.routeGroupId) : undefined, signal: controller.signal })).then(page => { if (!controller.signal.aborted) setNoAdvisorToAssign(!page.records.some(agent => agent.assignmentEligible)); }).catch(() => undefined);
    return () => controller.abort();
  }, [selectedUnbound, canWriteAssignment, pendingAssignment, selected?.customerId, rosterSource, conversationSource, entryCheck]);
  // 发送时输入框被禁用会丢焦点，核对完归属后放回去，接着打下一条。
  useEffect(() => { if (refocusComposer.current && writable && !busy) { refocusComposer.current = false; composerRef.current?.focus(); } }, [writable, busy]);
  const lostAccess = Boolean(!qualificationUnknown && conversationsAvailable && selectedId && !requestedCustomerId && !visible.some((convo) => convo.id === selectedId));
  const readContextsKey = JSON.stringify(messagePages.page?.readContexts ?? []);
  useEffect(()=>{
    if(!selected?.detailReady)return;
    const ids=new Set(selected.messages.flatMap(m=>Number.isSafeInteger(m.id)?[m.id!]:[])),previous=seenMessages.current;
    setNewMessageIds(new Set(previous?.conversationId===selected.id?[...ids].filter(id=>!previous.ids.has(id)):[]));
    seenMessages.current={conversationId:selected.id,ids};
    const timer=setTimeout(()=>setNewMessageIds(new Set()),180);return()=>clearTimeout(timer);
  },[selected?.id,selected?.detailReady,selected?.messages]);

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
    // 网址写了范围就听网址的：上次的会话不在这个范围里就不恢复。
    const urlScoped = new URLSearchParams(window.location.search).has("scope");
    if (saved && visible.some(convo => convo.id === saved && !convo.archived) && (!urlScoped || scoped.some(convo => convo.id === saved))) { setSelectedId(saved); followSelection.current = true; }
  }, [conversationsAvailable, visible, ctx, qualificationUnknown]);
  useEffect(() => {
    if (!followSelection.current || !conversationsAvailable) return;
    const target = requestedCustomerId ? visible.find((convo) => customerIdOf(convo) === requestedCustomerId) : selectedId ? visible.find((convo) => convo.id === selectedId) : undefined;
    if (!target && requestedCustomerId === null && !selectedId) return;
    followSelection.current = false;
    if (!target || !canReviewAll) return;
    const fits = target.ownerAdminId === adminId ? scopeView === "mine" : scopeView === "team" && (!agentFilter || target.ownerAdminId === agentFilter);
    if (!fits) changeScope(target.ownerAdminId === adminId ? "mine" : "team");
  }, [conversationsAvailable, visible, requestedCustomerId, selectedId, canReviewAll, adminId]);
  // 网址里的客服已不在可见范围：回到全部专属客服，不留一个看着像空的筛选。
  useEffect(() => {
    if (agentFilter && conversationsAvailable && !qualificationUnknown && canReviewAll && visible.length > 0 && !teamAgents.some(([id]) => id === agentFilter)) changeScope("team");
  }, [agentFilter, conversationsAvailable, qualificationUnknown, canReviewAll, visible.length, teamAgents]);

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
                  if (saved.key !== key || row.commandKey !== key || !Number.isFinite(row.createdAt) || !Number.isFinite(row.expiresAt) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || typeof saved.operator !== "string" || !saved.input || !Number.isInteger(saved.input.warnMinutes) || saved.input.warnMinutes < 1 || saved.input.warnMinutes > 30 || !Number.isInteger(saved.input.closeMinutes) || saved.input.closeMinutes <= saved.input.warnMinutes || saved.input.closeMinutes > 120 || typeof saved.input.reason !== "string" || saved.input.reason.trim().length < 6 || saved.input.reason.trim().length > 200) throw new Error("Timeout recovery row invalid");
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
      setDrafts(Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==="string" && entry[1].length<=10000 && (visible.some(c=>c.id===entry[0]&&(c.ownerAdminId===adminId||canReviewAll)) || /^first:\d+$/.test(entry[0])))));
    } catch { setSendError("草稿保存不可用；当前输入仍保留在此页面。"); }
    setDraftOwner(adminId);
  }, [adminId, authEpoch, conversationsAvailable, qualificationUnknown]);
  useEffect(() => {
    // The customer now has a conversation (e.g. a concurrent first contact won): carry the unsent first-contact draft over,
    // however the conversation was opened. A first contact whose result is still unconfirmed keeps its text where it is.
    const customerId = selected?.customerId;
    if (!selected || !validCustomerId(customerId ?? null) || firstPending || readPending(firstPendingKey(adminId, customerId!))) return;
    const firstKey = `first:${customerId}`;
    setDrafts(old => {
      if (!old[firstKey]?.trim() || old[selected.id]?.trim()) return old;
      const next = { ...old, [selected.id]: old[firstKey] };
      delete next[firstKey];
      return next;
    });
  }, [selected?.id, selected?.customerId, firstPending, adminId]);
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
    if (!selected || !messagePages.readReady || !conversationsAvailable || selected.ownerAdminId !== adminId || document.visibilityState === "hidden" || !chatColumnRef.current?.getClientRects().length) return;
    const contexts = messagePages.page?.readContexts.filter(context => !context.alreadyRead) ?? [];
    if (!contexts.length) {
      if (failedReadContext.current?.key === messagePages.key && failedReadContext.current.beforeMessageId === messagePages.readCursor) { failedReadContext.current = null; setReadError(""); }
      return;
    }
    const marker = `${authEpoch}:${selected.id}:${readContextsKey}`;
    if (markedRef.current === marker) return;
    markedRef.current = marker;
    const controller = new AbortController(), batchCursor = messagePages.readCursor, batchKey = messagePages.key;
    if (!failedReadContext.current) setReadError("");
    void (async () => {
      for (const context of contexts) { if (controller.signal.aborted) return; await markM3MessagePageRead(context, controller.signal); }
      if (!controller.signal.aborted && failedReadContext.current?.key === batchKey && failedReadContext.current.beforeMessageId === batchCursor) { failedReadContext.current = null; setReadError(""); }
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId));
      else if (!failedReadContext.current) { failedReadContext.current = { key: batchKey, beforeMessageId: batchCursor }; setReadError(displayAdminError(cause)); }
    });
    return () => { controller.abort(); if (markedRef.current === marker) markedRef.current = ""; };
  }, [selected?.id, selected?.ownerAdminId, selected?.version, readContextsKey, messagePages.readCursor, messagePages.readReady, conversationsAvailable, adminId, authEpoch, readRetry, screen, revokeCustomer]);
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
  }, [selected?.id, selected?.customerId, selected?.version, selected?.lastTs, selected?.unread, selectedUnbound, conversationsAvailable, authEpoch, profileRetry, revokeCustomer, canReviewAll, adminId]);

  const select = (convo: SessionConvo) => {
    setMessageOpening(value => value + 1);
    if (firstPending) { if (!busy) setSendError("首次联系的发送结果待确认，请先查询原命令结果，再切换会话。"); return; }
    clearAttachment(pending?.kind !== "IMAGE"); setRequestedCustomerId(null); setSelectedId(convo.id); setScreen("chat"); setMaintenanceChosen(false); setReadError(""); setSendError(pending && !busy ? "上条消息的结果待确认，请返回原会话用同一命令重试。" : "");
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
    } catch (cause) { if (identityRef.current === identity) setRecoveryError(`原消息结果暂无法查询：${displayAdminError(cause)} 编号已保留，不会重新发送。`); }
    finally { if (identityRef.current === identity) setRecoveryBusy(""); }
  };
  // Decision M-C23: a new maintenance message goes out only while the customer is due. What the page read earlier can be stale, so ask once more. Original commands are not rechecked.
  const maintenanceStillDue = async (customerId: string) => {
    const identity = identityRef.current;
    try {
      const current = await supportClient.customerDetail(customerId);
      if (identityRef.current !== identity) return false;
      if (current.due === true) return true;
      setMaintenanceChosen(false);
      if (selected) setProfileDetail(current); else setFirstDetail(current);
      setSendError("该客户的维护已不再到期，本条没有发送，原文已保留。可以作为服务回复发送。");
    } catch (cause) {
      if (identityRef.current === identity) setSendError(`维护到期状态暂时无法核对：${displayAdminError(cause)} 本条没有发送，原文已保留。`);
    }
    return false;
  };
  const sendRow = pending ? pendingMessages.list().find(row => row.commandKey === pending.key) : firstPending ? pendingMessages.list().find(row => row.commandKey === firstPending.key) : undefined;
  const sendRetryExpired = Boolean(sendRow && isRetryExpired(sendRow));
  const send = async (kind: "TEXT" | "IMAGE" | "SKU" | "LINK", retry?: Pending) => {
    if (busy || !conversationsAvailable || recoveryBlocksTarget) return;
    sendAdminTyping(false);
    const identity = identityRef.current;
    if (firstPending || !selected) {
      if (kind !== "TEXT" || !validCustomerId(requestedCustomerId) || (!firstPending && (!writable || !closedCandidatesReady || !firstDetail?.assignmentId))) return;
      const record = firstPending ?? { key: newKey(), clientMessageId: crypto.randomUUID(), body: draft.trim(), intent, customerId: requestedCustomerId, assignmentId: firstDetail!.assignmentId!, version: firstDetail!.version, replyTargets: closedReplyTargets };
      if (!record.body) return;
      if (!firstPending && record.intent === "MAINTENANCE") {
        setBusy(true); setSendError("");
        const due = await maintenanceStillDue(requestedCustomerId);
        if (identityRef.current === identity) setBusy(false);
        if (!due) return;
      }
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
          if (!recovered && sendRetryExpired) { setSendError(RETRY_EXPIRED_TEXT); return; }
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
        // The text is sent: drop it from the first-contact slot too, which may differ from the current target once the conversation is listed.
        setDrafts((old) => { const next = { ...old, [targetKey]: "" }; delete next[`first:${record.customerId}`]; return next; });
        setFirstPending(null); setHoldRetry((value) => value + 1);
        if (conversationNo && !refreshFailed) {
          // Open the inbox scope by the new conversation's actual owner (a supervisor may be on 「我的客户」 or 「组内审阅」).
          followSelection.current = true;
          setSelectedId(conversationNo); setRequestedCustomerId(null);
        }
        if (!refreshFailed) { const url = new URL(window.location.href); url.searchParams.delete("customerId"); if(conversationNo)url.searchParams.set("conversationNo",conversationNo); window.history.replaceState(null, "", url); }
        setScreen("chat");
      } catch (cause) {
        if (identityRef.current === identity) {
          const busyHold = supportSessionBusy(cause);
          if (submitted && busyHold) {
            // Someone else started talking first: lock the composer with their details and keep the draft.
            pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null);
            lockFromBusy(requestedCustomerId, busyHold);
          } else if (submitted && rejectedSend(cause)) {
            pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null);
            if (lostPermission(cause)) { ctx.invalidateScope(undefined, requestedCustomerId); setSendError("当前客户归属或会话权限已变化，请返回客户列表核对。"); }
            else { setDetailRetry((value) => value + 1); setSendError(`本次发送已被拒绝：${displayAdminError(cause)} 原文已保留，请核对客户归属后修改重发。`); }
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
      setBusy(true); setSendError("");
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
        setSendError(`会话状态暂时无法确认：${displayAdminError(cause)} 原文已保留，请重试。`);
        return;
      }
    }
    if (identityRef.current !== identity) return;
    if (!retry && intent === "MAINTENANCE" && !await maintenanceStillDue(String(selected.customerId))) { if (identityRef.current === identity) setBusy(false); return; }
    const record = retry ?? (() => {
      const replyTargets = [
        ...(currentReplyTarget && (intent === "SERVICE" || includeCurrentReply) ? [currentReplyTarget] : []),
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
        if (!recovered && sendRetryExpired) { setSendError(RETRY_EXPIRED_TEXT); return; }
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
      ok = true; setMaintenanceChosen(false); setSelectedClosedIds(new Set()); // one explicit maintenance contact per choice
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
    }
    catch (cause) {
      const busyHold = supportSessionBusy(cause);
      if (identityRef.current === identity && submitted && busyHold) {
        pendingMessages.forget(pendingKey(adminId)); setPending(null);
        lockFromBusy(String(selected.customerId), busyHold);
        return;
      }
      if (identityRef.current === identity && submitted && rejectedSend(cause)) {
        pendingMessages.forget(pendingKey(adminId)); setPending(null);
        void ctx.refreshConversations().catch(() => {});
        if (lostPermission(cause)) { ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError("当前会话权限已变化，请返回客户列表核对。"); }
        else setSendError(`本次发送已被拒绝：${displayAdminError(cause)} 原文已保留，请核对会话后修改重发。`);
        return;
      }
      if (identityRef.current === identity) { if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError(`发送结果待确认：${displayAdminError(cause)} 请查询发送结果。`); }
    }
    finally { if (identityRef.current === identity) setBusy(false); }
    if (identityRef.current !== identity) return;
    if (ok) {
      window.dispatchEvent(new Event("support-todo-changed"));
      setProfileDetail(null); setProfileRetry((value) => value + 1); setHoldRetry((value) => value + 1);
      pendingMessages.forget(pendingKey(adminId));
      if (record.kind !== "IMAGE") setDrafts((old) => ({ ...old, [record.conversationId]: old[record.conversationId] === record.body ? "" : old[record.conversationId] }));
      if (record.kind === "IMAGE") clearAttachment(false);
      setPending(null); setContentChoice(null);
      refocusComposer.current = true;
    }
  };

  const chooseImage = async (file: File | undefined) => {
    const selection = ++imageSelectionRef.current;
    if (!file || !writable || busy || pending) return;
    if (!attachmentPolicy?.available) { setAttachmentPolicyError(`${supportAttachmentUnavailableText(attachmentPolicy?.unavailableReason ?? null)}。`); return; }
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
    } catch (cause) { if(requestStamp!==identityRef.current)return false; if (lostPermission(cause)) ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError(`客户归属暂时无法核对：${displayAdminError(cause)} 请重试。`); return false; }
    finally { if(requestStamp===identityRef.current)setActionChecking(false); }
  };
  // 确认框里的写入：失败原因抛给确认框写在框内，理由留着，原操作号不变，再点就是重试。
  const confirmWrite = async (key: string, value: string, meta: { action: string; reason: string; commandKey: string }, stamp: string) => {
    if (stamp !== identityRef.current) return false;
    let failure = "";
    const ok = await ctx.setParam(key, value, { ...meta, onFailure: message => { failure = message; } });
    if (stamp !== identityRef.current) return false;
    if (!ok && failure) throw new Error(failure);
    return ok;
  };
  const closeConversation = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({
      action: `结束服务会话 ${conversation.id}`,
      title: "标记已解决",
      briefKind: "conversation",
      detail: "将这段服务会话标记为已解决，不改变客户的专属客服。客户再次发消息时，会继续当前对话。",
      facts: <Facts><Fact k="客户">{title}</Fact><Fact k="会话编号"><span data-mono="">{conversation.id}</span></Fact></Facts>,
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>, confirmLabel: "确认标记已解决",
      blockedReason: ctx.commandExpired(`m3:close:${conversation.id}:`) ? RETRY_EXPIRED_TEXT : undefined,
      reasonMin: 8, reasonMax: 200,
      run: async (reason) => {
        if(requestStamp!==identityRef.current)return false;
        const rows = all.map((row) => row.id === conversation.id ? { ...row, status: "resolved" as const } : row);
        return confirmWrite(CONVO_KEY, JSON.stringify(rows), { action: `结束服务会话 ${conversation.id}`, reason, commandKey: `m3:close:${conversation.id}:${conversation.version}` }, requestStamp);
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
  const endPending = Boolean(holdEndCommand && holdEndCommand.customerId === holdCustomer);
  const endHold = async () => {
    if (!holdCustomer || holdEnding || hold?.state !== "MINE" && !endPending) return;
    const stamp = identityRef.current, fingerprint = `session-end:${adminId}:${holdCustomer}`;
    let command = endPending ? holdEndCommand! : null;
    if (!command) {
      const commandKey = newKey();
      sessionEndCommands.remember(fingerprint, commandKey, { actorId: adminId, customerId: holdCustomer });
      if (!sessionEndCommands.isDurablyStored(fingerprint, commandKey)) { sessionEndCommands.forget(fingerprint, commandKey); setActionError("浏览器无法保存这次操作的记录，还没结束会话；请检查浏览器设置后重试。"); return; }
      command = sessionEndCommands.list().find(row => row.commandKey === commandKey)!;
    }
    const settle = (message = "") => { sessionEndCommands.forget(command.fingerprint, command.commandKey); setHoldEndCommand(null); setActionError(message); setHoldRetry((value) => value + 1); };
    setHoldEndCommand(command); setHoldEnding(true); setActionError("");
    try {
      // A number already sent is checked first; only a number the system never received goes out again, unchanged.
      const receipt = endPending ? await supportClient.command(command.commandKey).catch((cause: unknown) => { if (cause instanceof SupportClientError && cause.status === 404) return null; throw cause; }) : null;
      if (stamp !== identityRef.current) return;
      if (receipt?.status === "SUCCEEDED") { settle(); return; }
      if (receipt?.status === "FAILED") { settle("原操作没有结束会话，请确认后再点一次。"); return; }
      if (receipt) { setActionError("结束会话的结果尚未确认，原操作还在处理，请稍后再查询。"); return; }
      if (endPending && isRetryExpired(command)) { setActionError(RETRY_EXPIRED_TEXT); return; }
      await supportClient.endSessionHold(command.customerId, command.commandKey);
      if (stamp === identityRef.current) settle();
    } catch (cause) {
      if (stamp !== identityRef.current) return;
      if (cause instanceof SupportClientError && [400, 403, 404, 409, 422].includes(cause.status) && !isIndeterminateSupportError(cause)) settle(`结束会话没有成功：${displayAdminError(cause)}`);
      else { setActionError("结束会话的结果尚未确认。请再点「结束会话」，会先查询原操作，不会重复结束。"); setHoldRetry((value) => value + 1); }
    } finally { if (stamp === identityRef.current) setHoldEnding(false); }
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
      ctx.openActionConfirm({action:"归档客户对话",briefKind:"conversation",detail:"归档此客户的全部历史会话。未处理的客户消息不能归档。",facts:<Facts><Fact k="客户">{title}</Fact><Fact k="会话数">{members.length} 段</Fact></Facts>,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:"确认归档",reasonMin:8,reasonMax:200,run:reason=>confirmWrite("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"归档客户对话",reason,commandKey},stamp)});
      return;
    }
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:conversation.archived?"撤销归档":"归档会话",briefKind:"conversation",detail:`会话 ${conversation.id}；只是从列表里归档，会话、消息和归属都不变。`,facts:<Facts><Fact k="客户">{title}</Fact><Fact k="会话编号"><span data-mono="">{conversation.id}</span></Fact></Facts>,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:conversation.archived?"确认撤销归档":"确认归档",blockedReason:ctx.commandExpired(`m3:archive:${conversation.id}:`)?RETRY_EXPIRED_TEXT:undefined,reasonMin:8,reasonMax:200,run:reason=>confirmWrite(CONVO_KEY,JSON.stringify(all.map(c=>c.id===conversation.id?{...c,archived:!conversation.archived}:c)),{action:"修改会话归档",reason,commandKey:`m3:archive:${conversation.id}:${conversation.version}:${!conversation.archived}`},requestStamp)});
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
    ctx.openActionConfirm({action:"批量归档",briefKind:"conversation",detail:`确认归档 ${new Set(chosen.map(customerIdOf)).size} 位客户的全部对话。未处理客户消息不能归档。`,facts:<Facts><Fact k="客户">{selectedCustomers.map(rowName).join("、")}</Fact></Facts>,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:"确认批量归档",reasonMin:8,reasonMax:200,run:async reason=>{const ok=await confirmWrite("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"批量归档已选会话",reason,commandKey:key},requestStamp);if(ok)setArchiveIds(new Set());return ok;}});
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
        if (record?.fingerprint === timeoutSlot && (record.commandKey !== commandKey || typeof record.payload !== "string" || !Number.isFinite(record.createdAt) || !Number.isFinite(record.expiresAt))) throw new Error("上次的修改记录读不到，暂时不能再改。");
      }
    }
    const rows = [...pendingTimeoutPolicies.list(), ...pendingMessages.list()].filter((row) => row.fingerprint === timeoutSlot);
    const commands = rows.map((row) => {
      const saved = JSON.parse(row.payload) as TimeoutCommand;
      parseMConversationTimeoutPolicy(saved.policy);
      if (typeof saved.key !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(saved.key) || saved.key !== row.commandKey || typeof saved.operator !== "string" || !saved.input || !Number.isInteger(saved.input.warnMinutes) || saved.input.warnMinutes < 1 || saved.input.warnMinutes > 30 || !Number.isInteger(saved.input.closeMinutes) || saved.input.closeMinutes <= saved.input.warnMinutes || saved.input.closeMinutes > 120 || saved.input.sessionEndMinutes !== undefined && (!Number.isInteger(saved.input.sessionEndMinutes) || saved.input.sessionEndMinutes < 2 || saved.input.sessionEndMinutes > 120) || typeof saved.input.reason !== "string" || saved.input.reason.trim().length < 6 || saved.input.reason.trim().length > 200) throw new Error("上次的修改记录读不到，暂时不能再改。");
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
      const savedRow = saved ? [...pendingTimeoutPolicies.list(), ...pendingMessages.list()].find(row => row.commandKey === saved.key) : undefined;
      if (saved) { setTimeoutLatest(policy); setTimeoutInput(saved.input); setTimeoutError(savedRow && isRetryExpired(savedRow) ? RETRY_EXPIRED_TEXT : "原操作结果待确认，请先查询原操作。"); }
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

  const changeTab = (value: ListTab) => {
    setListTab(value);
    const url = new URL(window.location.href);
    if (value === "pending") url.searchParams.delete("tab"); else url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };
  const late = (row: SessionConvo) => timeoutPolicy ? replyTimeout(row.pendingReplySince, timeoutNow, timeoutPolicy.warnMinutes, timeoutPolicy.closeMinutes) : "";
  const waitingRows = customerRows.filter(row => tabMatch(row, "pending", adminId)).sort((a, b) => (a.pendingReplySince ?? Infinity) - (b.pendingReplySince ?? Infinity));
  const lateCount = waitingRows.filter(row => late(row)).length;
  const oldestWaiting = waitingRows[0];
  // 结论只说当前筛选的范围；另一范围要处理的事单独写一句，主管的待分配不管停在哪个范围都要看到。
  const filterName = reviewing && agentFilter ? teamAgents.find(([id]) => id === agentFilter)?.[1] : undefined;
  const unassignedCount = canReviewAll ? customerConversations(visible.filter(row => row.ownerAdminId !== adminId)).filter(row => tabMatch(row, "unassigned", adminId)).length : 0;
  const otherScopeWaiting = canReviewAll ? customerConversations(visible.filter(row => filterName ? row.ownerAdminId !== agentFilter : reviewing ? row.ownerAdminId === adminId : row.ownerAdminId !== adminId)).filter(row => tabMatch(row, "pending", adminId)).length : 0;
  const otherScopeName = filterName ? "其他范围" : reviewing ? "我的客户" : "组内审阅";
  const rowName = (row: SessionConvo) => userNicknameText(row.customer || row.profile?.nickname || `客户 ${row.customerId}`, row.profile?.phone);
  const waitingHint = [
    unassignedCount ? `${unassignedCount} 位待分配专属客服` : "",
    otherScopeWaiting ? `${otherScopeName}还有 ${otherScopeWaiting} 位待回复` : "",
  ].filter(Boolean).join("；");
  const zoneLabel = businessZone().label;
  const teamWord = filterName ? `${filterName}的客户` : scopeMode === "ALL" ? "全部客户" : "组内客户";
  const scopeWord = reviewing ? teamWord : "你的客户";
  const chatMenu: MoreMenuItem[] = [
    ...(selected && canWriteM3 && selected.ownerAdminId === adminId ? [{ key: "archive", label: selected.archived ? "撤销归档" : "归档", disabledReason: actionChecking ? "正在核对客户归属…" : !selected.archived && allReplyTargets.length ? "客户还有消息没回，先回复才能归档" : undefined, onSelect: () => void archiveOne(selected) }] : []),
    ...(canReviewAll && selected?.customerId ? selectedUnbound
      ? [{ key: "pool", label: "前往待绑定客户池", onSelect: () => window.location.assign("/service/overview?view=pool") }]
      : canTransfer ? [{ key: "transfer", label: "正式转绑客户", onSelect: () => window.location.assign(`/service/overview?customerId=${encodeURIComponent(selected.customerId!)}&action=transfer`) }] : [] : []),
  ];
  const inboxMenu: MoreMenuItem[] = [
    { key: "timeout", label: "超时策略", disabledReason: canReadTimeout ? undefined : "需要会话查看权限", onSelect: () => void openTimeout() },
    { key: "archive", label: "批量归档", disabledReason: !canWriteM3 ? "当前账号只能查看会话" : !filtered.some(row => row.ownerAdminId === adminId && !row.archived && !row.pendingReplyCount) ? "这个列表里没有能归档的客户：只能归档本人客户，有待回复的要先回复" : undefined, onSelect: () => setArchiveMode(true) },
  ];
  const alertsOn = alertPrefs.sound || alertPrefs.desktop;
  const baseBlocked = !canWriteM3 ? "当前账号只能查看会话" : qualificationUnknown ? "正在确认你的专属客服身份" : undefined;
  const noOwnCustomers = hasOwn ? undefined : !myAgent ? "当前账号不是专属客服，没有本人客户" : ownCustomers === 0 ? "你名下还没有客户。客户分配给你之后才能用，分配情况看「客服工作台」" : undefined;
  // 新建要有本人客户；已有批次和待确认的原操作照样能进去查（OP-93）。
  const bulkBlocked = baseBlocked ?? (noOwnCustomers && bulkBatches === 0 && !hasBulkPending(adminId) ? noOwnCustomers : undefined);
  const checkingOwner = Boolean(selected && !writable && composerMode === "write" && !currentProfileDetail && !profileError && !recoveryBlocksTarget && canWriteM3 && selected.status === "open");
  const guideRole = !canWriteM3 ? "当前账号只能查看会话，不能发消息。" : scopeMode === "ALL" ? "当前账号是超级管理员：能看全部客户。别人没在接待时，可以用你自己的名字回复，不能记为联系维护；能修改超时策略。" : scopeMode === "MANAGED" ? "当前账号是客服主管：「我的客户」是你本人的客户，「组内审阅」是负责组的客户。别人没在接待时，可以用你自己的名字回复组内客户，不能记为联系维护；超时策略只能看。" : "当前账号是专属客服：只看得到、只能回复自己的客户；超时策略只能看。";

  // 菜单能进但不在客服范围内：后端拒绝的是这个账号，不是服务坏了（ST-38）。
  if (scopeDenied) return <>
    <PageHeader pageId="M3" title="专属会话" summary={summary} back={back} />
    {banner}
    <BlockState state="denied" title="当前账号看不到客户会话" detail="这页只给客服、客服主管和超级管理员用。需要查看会话，请联系管理员调整账号。" />
  </>;

  return <>
    <PageHeader pageId="M3" title="专属会话" back={back}
      summary={<>{summary} <Explain label="时间和更新方式" content={`时间均为${zoneLabel}。${streamReady ? "有新消息时自动更新。" : ""}`} /></>}
      actions={pendingAssignment ? <Button onClick={() => setAssignOpen(true)}>{assignLabel}</Button> : undefined}
      readOnly={!canWriteM3 ? "当前账号只能查看会话" : undefined}
      guideExtra={<p>{guideRole}</p>} />
    {banner}
    {streamLost && !reconnectExhausted && <Notice tone="warn">连接已断开，正在重连；下面是最近一次的数据</Notice>}
    {!conversationsAvailable
      ? <Conclusion state="danger" action={<Button size="sm" onClick={() => void ctx.refreshConversations()}>重新连接</Button>}>{serviceStatus}</Conclusion>
      : reviewScopeError
        ? <Conclusion state="unknown" action={<Button size="sm" onClick={() => setScopeRetry(value => value + 1)}>重新核对范围</Button>}>{reviewScopeError}</Conclusion>
        : qualificationUnknown
          ? <Conclusion state="unknown">正在确认你的专属客服身份，稍后显示可查看的会话。</Conclusion>
          : waitingRows.length
            ? <Conclusion state={lateCount ? "warn" : "neutral"} icon={Clock3} hint={waitingHint || undefined}
                action={oldestWaiting && oldestWaiting.customerId !== selected?.customerId ? <Button size="sm" onClick={() => { if (listTab !== "pending") changeTab("pending"); select(oldestWaiting); }}>{reviewing ? "查看等得最久的" : "回复等得最久的"}</Button> : undefined}>
                {reviewing ? `${teamWord}有待回复` : "有客户等你回复"}{lateCount ? `，${lateCount} 位已超时` : ""}{oldestWaiting?.pendingReplySince != null ? `，最久等了 ${waitText(timeoutNow - oldestWaiting.pendingReplySince)}` : ""}
              </Conclusion>
            : <Conclusion state={waitingHint ? "neutral" : "ok"} hint={waitingHint || undefined}
                action={unassignedCount && !(reviewing && !agentFilter && listTab === "unassigned") ? <Button size="sm" onClick={() => { changeScope("team"); changeTab("unassigned"); }}>查看待分配</Button> : undefined}>
                {scopeWord}没有待回复
              </Conclusion>}

    <section className="m3s-stage" data-screen={screen} aria-label="专属客服会话">
      <div className="m3s-inbox">
        <header className="m3s-inbox-head">
          <div className="m3s-inbox-title">
            <h2>会话收件箱</h2>
            <IconButton aria-label={alertsOn ? "提醒已开" : "提醒已关"} aria-pressed={alertsOn} title={`${alertsOn ? "提醒已开" : "提醒已关"}：新消息、新分配客户的提示音和浏览器通知（仅本浏览器）`} onClick={() => { const on = !alertsOn; setSupportAlertPrefs({ sound: on, desktop: on }); }}>{alertsOn ? <Bell size={16} /> : <BellOff size={16} />}</IconButton>
            <MoreMenu label="收件箱工具" items={inboxMenu} />
          </div>
          <div className="m3s-inbox-actions">
            <Button size="sm" icon={<Plus size={14} />} disabledReason={baseBlocked ?? noOwnCustomers} onClick={() => setContactOpen(true)}>主动联系</Button>
            <Button size="sm" icon={<Megaphone size={14} />} disabledReason={bulkBlocked} onClick={() => setBulkOpen(true)}>圈选群发</Button>
          </div>
          {canReviewAll && <div className="m3s-scope">
            <Segments label="收件箱范围" value={reviewing ? "team" : "mine"} onChange={value => { changeScope(value, value === "team" ? agentFilter : 0); if (value === "mine" && listTab === "unassigned") changeTab("pending"); }} items={[{ value: "mine", label: "我的客户" }, { value: "team", label: "组内审阅" }]} />
            {reviewing && teamAgents.length > 0 && <Select aria-label="按专属客服筛选" value={agentFilter ? String(agentFilter) : ""} onChange={value => changeScope("team", Number(value))} options={[{ value: "", label: "全部专属客服" }, ...teamAgents.map(([id, name]) => ({ value: String(id), label: name }))]} />}
          </div>}
          <Input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户或会话编号" aria-label="搜索客户或会话编号" />
          <div className="m3s-tabs">
            <Segments label="会话状态筛选" value={listTab} onChange={changeTab} items={[...tabs].sort(([a], [b]) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b)).map(([value, label]) => {
              const count = customerRows.filter(row => tabMatch(row, value, adminId)).length;
              const overdue = value === "unassigned" ? customerRows.some(row => tabMatch(row, value, adminId) && row.pendingReplySince != null && timeoutNow - row.pendingReplySince >= (ctx.unboundAlertMinutes ?? 5) * 60000) : value === "pending" && customerRows.some(row => tabMatch(row, value, adminId) && Boolean(late(row)));
              return { value, label: <>{label}{overdue && <span className="sr-only">（有客户已超时待处理）</span>}{!conversationsAvailable && " —"}</>, count: conversationsAvailable ? count : undefined, tone: overdue ? "danger" as const : undefined };
            })} />
          </div>
          {archiveMode && <div className="m3s-batch"><span role="status">已选 {archiveIds.size} 位客户</span><Button size="sm" disabled={!archiveIds.size || actionChecking} onClick={() => void archiveBatch().then(() => setArchiveMode(false))}>归档已选 {archiveIds.size}</Button><Button size="sm" variant="ghost" onClick={() => { setArchiveMode(false); setArchiveIds(new Set()); }}>取消</Button></div>}
        </header>
        <div className="m3s-rows" onScroll={event => { const el = event.currentTarget; if (listLimit < filtered.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setListLimit(n => n + LIST_CHUNK); }}>
          {(recoveries.length > 0 || recoveryError) && <Notice tone="warn" action={recoveries.map(({ slot, locator }, index) => <Button size="sm" key={slot} disabled={Boolean(recoveryBusy)} onClick={() => void queryRecovery(slot, locator)}>查询原消息 {index + 1}</Button>)}>{recoveryError || "原消息结果待确认；私聊正文与图片已清除，只保留原编号供查询。"}</Notice>}
          {conversationsAvailable && !qualificationUnknown && filtered.length === 0 && <div className="m3s-empty">
            <p>{query ? "没有匹配的客户，请清除搜索。" : listTab === "pending" ? "没有待回复的客户。" : listTab === "unassigned" ? "没有待分配的客户。" : "暂无会话。可从“我的客户”发起首次联系。"}</p>
            {query ? <Button size="sm" onClick={() => setQuery("")}>清除搜索</Button> : listTab === "pending" && customerRows.length > 0 ? <Button size="sm" onClick={() => changeTab("all")}>看全部会话</Button> : null}
          </div>}
          {listRows.map(convo => {
            const active = selected?.id === convo.id;
            const message = convo.detailReady ? lastMessage(convo) : undefined;
            const kind = convo.detailReady ? message?.kind : convo.lastMessageKind;
            const knownReplyState = typeof convo.pendingReplyCount === "number" && Number.isSafeInteger(convo.pendingReplyCount) && convo.pendingReplyCount >= 0 ? convo.pendingReplyCount > 0 : null;
            const hasMessage = Boolean(message) || Number.isSafeInteger(convo.lastPublicMessageId) && Number(convo.lastPublicMessageId) > 0 ? true : convo.detailReady && convo.historyTruncated === false || convo.lastPublicMessageId === 0 ? false : null;
            const replyLabel = hasMessage === false ? "待首次联系" : knownReplyState === true ? (convo.ownerUnbound ? "待分配专属客服" : "待专属客服回复") : knownReplyState === false ? "已处理" : "查看待回复状态";
            const timeoutLabel = late(convo);
            const tagTone: StateTone = timeoutLabel.startsWith("严重") ? "danger" : timeoutLabel ? "warn" : knownReplyState === false ? "done" : "neutral";
            const name = rowName(convo);
            const holdText = convo.holder ? convo.holder.adminId === adminId ? `你在接待${convo.ownerAdminId !== adminId ? ` · 专属客服 ${convo.owner}` : ""}` : convo.holder.role !== "ADVISOR" ? `${convo.holder.role === "ADMIN" ? "超级管理员" : "主管"}接待中 · ${convo.holder.name}` : "" : "";
            const origin = convo.origin ? `${{ user: "客户发起", advisor: "客服主动联系", support: "客服主动联系" }[convo.origin]} · ` : "";
            return <div key={convo.id} className="m3s-row-wrap">
              {archiveMode && <label className="m3s-row-check" title={`选择会话 ${convo.id}`}><Checkbox aria-label={`选择会话 ${convo.id}`} checked={archiveIds.has(convo.id)} disabled={!canWriteM3 || convo.ownerAdminId !== adminId || convo.archived || Boolean(convo.pendingReplyCount)} onChange={e => setArchiveIds(old => { const next = new Set(old); if (e.target.checked) next.add(convo.id); else next.delete(convo.id); return next; })} /></label>}
              <div className="m3s-row" data-on={active ? "" : undefined}>
                <button type="button" className="m3s-row-hit" aria-label={`${name}，${timeoutLabel || replyLabel}`} aria-current={active ? "true" : undefined} title={`${origin}${replyLabel} · 当前专属客服：${convo.owner} · 会话 ${convo.id}`} onClick={() => select(convo)} />
                <SupportAvatar name={userNicknameText(convo.customer || convo.profile?.nickname || "客户", convo.profile?.phone)} path={convo.customerAvatarRef ?? undefined} size={36} />
                <span className="m3s-row-main">
                  <span className="m3s-row-top"><strong title={name}>{name}</strong><time title={`${messageDay(convo.lastTs)} ${messageTime(convo.lastTs)}（${zoneLabel}）`}>{agoText(convo.lastTs, timeoutNow)}</time></span>
                  <span className="m3s-row-preview" title={message?.text || convo.lastPreview || undefined}>{kind === "IMAGE" ? "[图片]" : kind === "SKU" ? "[商品推荐]" : kind === "LINK" ? "[页面链接]" : message?.text || convo.lastPreview || (hasMessage === false ? "尚无人工消息" : "消息摘要暂不可用")}</span>
                  <span className="m3s-row-meta">
                    <StatusTag tone={tagTone} explain={STATE_HELP[timeoutLabel ? "late" : replyLabel]}>{timeoutLabel || replyLabel}</StatusTag>
                    <span className="m3s-row-owner" data-hold={holdText ? (convo.holder?.adminId === adminId ? "mine" : "other") : undefined} title={holdText || `${convo.archived ? "已归档" : conversationStateLabel(convo.status)} · ${convo.owner}`}>{holdText || `${convo.archived ? "已归档" : conversationStateLabel(convo.status)} · ${convo.owner}`}</span>
                    {convo.unread > 0 && <span className="m3s-unread" aria-label={`${convo.unread} 条未读`}>{convo.unread}<span className="sr-only"> 条未读</span></span>}
                  </span>
                </span>
              </div>
            </div>;
          })}
        </div>
        {(query.trim() || listLimit < filtered.length) && <div className="m3s-inbox-foot"><span>{query.trim() ? `搜到 ${filtered.length} 位` : ""}</span>{listLimit < filtered.length && <Button size="sm" variant="ghost" onClick={() => setListLimit(n => n + LIST_CHUNK)}>加载更多</Button>}</div>}
      </div>

      <div ref={chatColumnRef} className="m3s-chat">
        <header className="m3s-chat-head">
          <Button size="sm" className="m3s-back" aria-label="返回会话列表" onClick={() => setScreen("list")}>返回</Button>
          <SupportAvatar name={title} path={selected?.customerAvatarRef ?? undefined} size={36} />
          <div className="m3s-chat-id">
            <h2 title={title}>{title}</h2>
            <div className="m3s-chat-sub">{selected ? <>当前专属客服：{selected.owner}{actsAsAdvisor && (hold?.state === "MINE" || heldByOther) ? "（你）" : ""} · {hold?.state === "MINE" ? <span className="m3s-hold" data-hold="mine">你正在接待{hold.autoEndAt && `，约 ${holdClock(hold.autoEndAt)} 自动结束`}{!actsAsAdvisor && <> <Explain label="接待是什么意思" content={`接待期间其他人不能给该客户发消息。${hold.endMinutes !== null ? `无人发言 ${hold.endMinutes} 分钟后自动结束。` : ""}`} /></>}</span> : heldByOther ? <span className="m3s-hold" data-hold="other">{holderRole} {hold.holder?.name} 接待中</span> : selected.status === "transferred" ? "已转出 · 只读" : selected.status === "open" ? "当前会话" : "历史会话"}{presence?.online ? " · 客户在线" : ""}</> : requestedCustomerId ? hold?.state === "MINE" ? <span className="m3s-hold" data-hold="mine">你正在接待</span> : heldByOther ? <span className="m3s-hold" data-hold="other">{holderRole} {hold.holder?.name} 接待中</span> : "首次联系" : "选择客户查看会话"}</div>
          </div>
          <div className="m3s-chat-actions">
            {(selected || profileCustomerId) && <Button size="sm" className="m3s-profile-toggle" onClick={() => setScreen("profile")}>客户资料</Button>}
            {canContinueClosed && <Button size="sm" title="重新核对当前专属客服归属，继续当前对话" onClick={continueClosed}>前往当前会话</Button>}
            {writable && actsAsAdvisor && <Button size="sm" aria-label="结束服务会话" disabled={actionChecking} disabledReason={currentReplyTarget ? "客户还有消息没回，先回复才能标记已解决" : undefined} icon={<CheckIcon size={14} />} onClick={closeConversation}>标记已解决</Button>}
            {(hold?.state === "MINE" || endPending) && !actsAsAdvisor && <Button size="sm" loading={holdEnding} loadingText="正在结束…" icon={<Square size={14} />} onClick={() => void endHold()}>结束会话</Button>}
            {chatMenu.length > 0 && <MoreMenu items={chatMenu} />}
          </div>
        </header>
        {(endPending && !holdEnding || serviceStatus && conversationsAvailable || actionError || !requestedCustomerIdValid || readError || paneMessages && messagePages.error || messagePages.gap) && <div className="m3s-notices">
          {endPending && !holdEnding && <Notice tone="warn">{holdEndCommand && isRetryExpired(holdEndCommand) ? RETRY_EXPIRED_TEXT : "上次结束会话的结果尚未确认，原操作已保留。点「结束会话」会先查询原操作，不会重复结束。"}</Notice>}
          {serviceStatus && conversationsAvailable && <Notice tone="danger">{serviceStatus}</Notice>}
          {actionError && <Notice tone="danger" action={<Button size="sm" onClick={() => setActionError("")}>知道了</Button>}>{actionError}</Notice>}
          {!requestedCustomerIdValid && <Notice tone="danger">客户链接无效，无法打开会话。请从<a className="rd-link" href="/service/overview">我的客户</a>重新进入。</Notice>}
          {readError && <Notice tone="warn" action={<Button size="sm" onClick={() => { const failed = failedReadContext.current; if (!failed || failed.key !== messagePages.key) return; markedRef.current = ""; void messagePages.refreshReadContexts(failed).then(() => setReadRetry(value => value + 1)); }}>重试</Button>}>已读状态更新失败：{readError}</Notice>}
          {paneMessages && messagePages.error && <Notice tone="danger" action={<Button size="sm" onClick={() => void messagePages.retry()}>重试加载消息</Button>}>消息加载失败：{messagePages.error}</Notice>}
          {messagePages.gap && <Notice tone="progress" action={<Button size="sm" onClick={() => void messagePages.newest()}>查看最新10条</Button>}>有新消息尚未展开。</Notice>}
        </div>}
        <div ref={messageBodyRef} className="m3s-body" role="log" aria-label="会话消息" aria-live="polite" tabIndex={0} onLoadCapture={onMessageAssetLoad} onScroll={onMessageScroll} onTouchStart={event => { messageScroll.current.touchY = event.touches[0]?.clientY ?? 0; }} onTouchMove={onMessageTouchMove} onWheel={onMessageWheel} onKeyDown={onMessageKeyDown} onPointerDown={onMessagePointerDown} onPointerMove={onMessagePointerMove}>
          {messagePages.hasMore && <Button size="sm" variant="ghost" className="m3s-older" disabled={messagePages.loading} onClick={loadOlderMessages}>向上加载更早10条</Button>}
          {messagePages.loading && paneMessages && <span className="m3s-sync" role="status">{messagePages.failed === "older" ? "正在加载更早的10条消息…" : "正在核对新消息…"}</span>}
          {selected && !paneMessages
            ? conversationError ? <BlockState state="error" title={`会话详情加载失败：${conversationError}`} retryLabel="重新加载详情" onRetry={() => { void messagePages.retry(); }} /> : <BlockState state="loading" title="正在加载会话消息…" />
            : selected && paneMessages?.length
              ? paneMessages.map((message, index) => { const day = messageDay(message.ts); return <div key={message.id ?? `${message.ts}-${index}`} data-m3-message-id={message.id}>{day && day !== messageDay(paneMessages[index - 1]?.ts ?? 0) && <div className="m3s-day"><span>{day}</span></div>}<SupportMessage message={message} previous={paneMessages[index - 1]} newlyArrived={message.id !== undefined && newMessageIds.has(message.id)} customerId={String(selected.customerId)} customerAvatarRef={selected.customerAvatarRef} customerName={title} onRevoked={() => ctx.invalidateScope(selected.id, String(selected.customerId))} /></div>; })
              : <BlockState state="empty" title={requestedCustomerId ? "尚无进行中会话。核对归属后即可发送首次联系。" : selected ? historyComplete ? "这段会话尚无消息。" : "历史消息尚未完整加载，请查看加载进度或重试失败片段。" : "选择会话后查看消息。"} />}
        </div>
        <div className="m3s-composer">
          {detailError && <Notice tone="danger" action={<><Button size="sm" onClick={() => setDetailRetry((value) => value + 1)}>重试</Button><a className="rd-link" href="/service/overview">返回我的客户</a></>}>客户资料加载失败：{detailError}</Notice>}
          {requestedCustomerId && !selected && firstDetail && firstDetail.agentAdminId !== adminId && !holdAllowsOther && !heldByOther && <Notice tone="warn">{canReviewAll && canWriteM3 && hold === undefined ? "正在核对接待状态…" : "该客户由当前专属客服服务，本账号仅可审阅。"}</Notice>}
          {requestedCustomerId && firstDetail && firstDetail.agentAdminId === adminId && !firstDetail.assignmentId && <Notice tone="warn">当前归属资料未就绪，暂不能发送。请刷新客户资料。</Notice>}
          {selected && !writable && composerMode === "write" && (currentProfileDetail || profileError || recoveryBlocksTarget || !canWriteM3 || selected.status !== "open") && (recoveryBlocksTarget
            ? <Notice tone="warn" action={<Button size="sm" onClick={() => setScreen("list")}>返回列表查询原消息</Button>}>原消息结果待确认，暂不能重复发送。</Notice>
            : !canWriteM3 ? <Notice tone="neutral">你只能查看会话，发消息需要会话操作权限。</Notice>
            : selected.status !== "open" ? <Notice tone="neutral">{historyReadOnlyHint}</Notice>
            : selectedUnbound ? <Notice tone="warn">该客户还没有专属客服，等待主管分配后回复。</Notice>
            : !currentProfileDetail ? <Notice tone="danger" action={<Button size="sm" onClick={() => setProfileRetry((value) => value + 1)}>重试</Button>}>客户归属核对失败：{profileError}</Notice>
            : !currentProfileDetail.assignmentId || currentProfileDetail.agentAdminId !== selected.ownerAdminId ? <Notice tone="warn" action={<Button size="sm" onClick={() => void ctx.refreshConversations()}>刷新会话</Button>}>客户归属已变化，请刷新会话后重试。</Notice>
            : messagePages.gap ? <Notice tone="warn" action={<Button size="sm" onClick={() => void messagePages.newest()}>查看最新10条</Button>}>有新消息尚未展开，请查看后再发送。</Notice>
            : !messagePages.contextReady || messagePages.page?.replyContext.ready !== true ? <Notice tone="warn" action={<Button size="sm" disabled={messagePages.loading} onClick={() => void messagePages.refresh()}>重新核对发送目标</Button>}>待回复目标暂时无法核对。</Notice>
            : <Notice tone="neutral">仅当前专属客服可发送消息；主管审阅不能代发。</Notice>)}
          {!selected && recoveryBlocksTarget && <Notice tone="warn" action={<Button size="sm" onClick={() => setScreen("list")}>返回列表查询原消息</Button>}>原消息结果待确认，暂不能重复发送。</Notice>}
          {requestedCustomerId && !selected && !canWriteM3 && <Notice tone="neutral">你只能查看会话，发消息需要会话操作权限。</Notice>}
          {replyCustomerId && closedCandidateRows.length > 0 && (displayedIntent === "MAINTENANCE" && !closedCandidateError && !closedCandidateMissing.length
            ? <fieldset className="m3s-targets"><legend>同时标记旧会话的待回复消息已处理（可不选）</legend>{closedCandidateRows.map(row => <Check key={row.conversationNo} label={row.text} checked={displayedClosedIds.has(row.conversationNo)} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={event => setSelectedClosedIds(old => { const next = new Set(old); if (event.target.checked) next.add(row.conversationNo); else next.delete(row.conversationNo); return next; })} />)}</fieldset>
            : closedCandidateError ? <Notice tone="danger" action={<Button size="sm" onClick={() => { void messagePages.refresh(); }}>重试</Button>}>历史待处理消息加载失败：{closedCandidateError}</Notice>
            : closedCandidateMissing.length ? <p className="m3s-aux" role="status">正在核对历史待处理消息…</p> : null)}
          {selected && currentProfileDetail?.waitingReply === true && displayedIntent === "MAINTENANCE" && Boolean(currentReplyTarget) && <Check label="同时标记本会话最近一条客户消息已处理（如仍待处理）" checked={includeCurrentReply || lockedTargets.some((target) => target.conversationNo === selected.id)} disabled={!writable || busy || Boolean(pending)} onChange={(event) => setIncludeCurrentReply(event.target.checked)} />}
          {composerMode === "write" && (selected || requestedCustomerId) && <>
            <div className="m3s-tools">
              {holdAllowsOther && <span className="m3s-sender"><SupportAvatar name={myName || myRoleLabel} size={22} />以 <strong>{myRoleLabel} · {myName}</strong> 发送</span>}
              <SupportContentTools key={`${identityRef.current}:${targetKey}:${selected?.ownerAdminId ?? adminId}:${selected?.assignmentId ?? ""}:${selected?.status ?? ""}:${canWriteM3}`} popover textOnly={!selected} ctx={ctx} disabled={!writable || busy || Boolean(pending || firstPending)} onInsert={insertText} onSelect={choice => { setContentChoice(choice); if (!draft.trim()) insertText(choice.kind === "SKU" ? "推荐商品：" + choice.name : "查看：" + choice.name); }} />
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" aria-label="选择图片" disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} hidden />
              <Button size="sm" variant="ghost" aria-label="选择图片" icon={<ImageIcon size={14} />} title={attachmentPolicyError || (!attachmentPolicy ? "正在加载图片规则…" : !attachmentPolicy.available ? supportAttachmentUnavailableText(attachmentPolicy.unavailableReason) : "发送图片")} disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onClick={() => fileInputRef.current?.click()}>图片</Button>
              {replyCustomerId && closedCandidateRows.length > 0 && displayedIntent !== "MAINTENANCE" && !closedCandidateError && !closedCandidateMissing.length && <Explain label="这条回复会处理哪些消息" content="服务回复会同步处理这位客户此前的待回复消息。" />}
            </div>
            {selected && attachmentPolicyError && <Notice tone="warn" action={<Button size="sm" onClick={() => setAttachmentPolicyRetry((value) => value + 1)}>重试</Button>}>{attachmentPolicyError}</Notice>}
            {maintenanceOffered && !pending && !firstPending && <Check label={`本条记为联系维护${intentSource?.due === true ? "（该客户维护已到期）" : ""}`} explain="发送成功后计入一次人工维护执行；客户之后重新活跃才算维护成功。" checked={maintenanceChosen} disabled={!writable && !requestedCustomerId || busy} onChange={event => setMaintenanceChosen(event.target.checked)} />}
            {contentChoice && <Notice tone="neutral" action={<Button size="sm" disabled={busy || Boolean(pending)} onClick={() => setContentChoice(null)}>取消推荐</Button>}>将发送：{contentChoice.name}</Notice>}
            {attachment && <div className="m3s-upload">
              <img src={attachment.url} alt="待发送图片预览" />
              <div className="m3s-upload-text"><strong title={attachment.file.name}>{attachment.file.name}</strong><span data-error={attachment.state === "error" ? "" : undefined}>{attachment.state === "ready" ? "已上传，尚未发送" : attachment.state === "uploading" ? "上传中…" : attachment.state === "error" ? `上传失败：${attachment.error}` : "等待上传"} <Explain label="图片怎么发" content="发送文字不会附带此图片。先点「上传图片」，再点「发送图片」。" /></span></div>
              <Button size="sm" disabled={!writable || busy || attachment.state === "uploading" || attachment.state === "ready"} onClick={() => void uploadImage()}>{attachment.state === "error" ? "重试上传" : "上传图片"}</Button>
              <Button size="sm" variant="primary" disabled={!writable || busy || Boolean(pending) || attachment.state !== "ready"} onClick={() => void send("IMAGE")}>发送图片</Button>
              <Button size="sm" variant="ghost" aria-label="移除待发送图片" onClick={() => clearAttachment()}>移除</Button>
            </div>}
            <div className="m3s-input">
              <Textarea ref={composerRef} aria-label="输入会话消息" placeholder="输入消息，回车发送，Shift+回车 换行" value={draft} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => { setDrafts((old) => ({ ...old, [targetKey]: event.target.value })); sendAdminTyping(writable && Boolean(event.target.value.trim())); }} onBlur={() => sendAdminTyping(false)} onKeyDown={(event) => { if (shouldSendOnEnter(event)) { event.preventDefault(); void send(contentChoice?.kind ?? "TEXT"); } }} />
              <Button variant="primary" loading={busy} loadingText="发送中…" icon={<SendHorizontal size={16} />} disabled={!writable || Boolean(pending || firstPending) || !draft.trim()} onClick={() => void send(contentChoice?.kind ?? "TEXT")}>{contentChoice?.kind === "SKU" ? "发送商品" : contentChoice?.kind === "LINK" ? "发送链接" : "发送"}</Button>
            </div>
            {(checkingOwner || presence?.typing) && <p className="m3s-aux" role="status">{checkingOwner ? "正在核对客户归属，核对完才能发送…" : "对方正在输入…"}</p>}
          </>}
          {composerMode === "unbound" && <div className="m3s-state">{canAssign ? <><span>该客户还没有专属客服，分配后由专属客服回复。</span><Button size="sm" variant="primary" disabledReason={noAdvisorToAssign ? "该客户所在组暂无可接待的专属客服。到「客服工作台 › 客服与分组」启用接待资格，或调整客户分组" : undefined} onClick={() => setAssignOpen(true)}>{assignLabel}</Button></> : "该客户还没有专属客服，等待主管分配后回复。"}</div>}
          {composerMode === "review" && <div className="m3s-state">你以主管身份查看，不能回复。该客户由专属客服 {selected?.owner} 负责。</div>}
          {composerMode === "checking" && <div className="m3s-state" role="status">正在核对接待状态…</div>}
          {composerMode === "locked" && hold?.holder && <>
            <Notice tone="warn"><Lock size={14} className="m3s-lock" aria-hidden />{holderRole} {hold.holder.name} 接待中，暂时不能回复{hold.autoEndAt && `，约 ${holdClock(hold.autoEndAt)} 可回复`} <Explain label="什么时候能回复" content={`对方结束会话${hold.endMinutes !== null ? `，或无人发言 ${hold.endMinutes} 分钟后` : ""}，你就可以继续回复。`} /></Notice>
            <div className="m3s-input"><Textarea aria-label="输入会话消息" value={draft} disabled readOnly /><Button variant="primary" disabled icon={<SendHorizontal size={16} />}>发送</Button></div>
            {draft.trim() && <p className="m3s-aux">草稿已保留，恢复后可以继续发送。</p>}
          </>}
          {!busy && pending && selected?.id !== pending.conversationId && <Notice tone="warn" action={<Button size="sm" onClick={() => { const original = visible.find((convo) => convo.id === pending.conversationId); if (original) select(original); }}>返回原会话</Button>}>另一条消息的结果待确认。请先返回原会话处理。</Notice>}
          {(sendError || !busy && (pending || firstPending)) && <Notice tone="danger" action={<>{sendError.startsWith("消息已发送") && <Button size="sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</Button>}{(pending || firstPending) && <Button size="sm" disabled={busy || Boolean(pending && selected?.id !== pending.conversationId)} onClick={() => { if (pending) void send(pending.kind, pending); else void send("TEXT"); }}>{sendRetryExpired ? "查询原操作" : "查询结果并重试"}</Button>}{(pending || firstPending) && sendRetryExpired && <Button size="sm" disabledReason={RETRY_EXPIRED_TEXT}>重试</Button>}</>}>{sendRetryExpired ? RETRY_EXPIRED_TEXT : sendError || "上条消息的结果待确认，请查询发送结果。"}</Notice>}
        </div>
      </div>

      <aside className="m3s-profile" aria-label="客户资料">
        <div className="m3s-profile-narrow"><h2>客户资料</h2><Button size="sm" onClick={() => setScreen("chat")}>返回会话</Button></div>
        {selectedUnbound ? <BlockState state="empty" title="待分配专属客服，尚无绑定客户的维护状态。" /> : profileCustomerId ? <M3CustomerProfile key={`${authEpoch}:${profileCustomerId}`} ctx={ctx} customerId={profileCustomerId} source="M3" transferEntry={!canReviewAll || canTransfer} conversation={selected ?? undefined} scopeVersion={selected?.version ?? firstProfileCustomer?.version} messageError={conversationError} onRetryMessages={() => { void messagePages.retry(); }} onHistory={no => { const convo = visible.find(c => c.id === no); if (convo) select(convo); }} /> : <BlockState state="empty" title={requestedCustomerId ? "客户归属尚未核对，资料暂时加载不出来。" : "选择客户后查看资料。"} />}
      </aside>
      {assignOpen && canAssign && selected?.customerId && <AssignAdvisorDialog key={`${scopeIdentity}:${selected.customerId}`} adminId={adminId} canWrite={canWriteAssignment} customerId={String(selected.customerId)} customerName={title} onClose={() => setAssignOpen(false)} onAssigned={name => { setAssignOpen(false); setActionError(""); ctx.toast(`已确认原分配，专属客服为 ${name}。`); void ctx.refreshConversations().catch(() => {}); }} />}
      {bulkOpen && <SupportBulkComposer ctx={ctx} createBlocked={noOwnCustomers} onClose={() => setBulkOpen(false)} />}
      {contactOpen && <SupportContactPicker onClose={() => setContactOpen(false)} onSelect={customerId => { setRequestedCustomerId(customerId); setScreen("chat"); setContactOpen(false); const url = new URL(window.location.href); url.searchParams.delete("conversationNo"); url.searchParams.set("customerId", customerId); window.history.replaceState(null, "", url); }} />}
      {timeoutOpen && timeoutPolicy && <IdlePolicyModal policy={timeoutPolicy} initialInput={timeoutInput} canSave={canTimeout} saving={timeoutSaving} error={timeoutError} pending={Boolean(timeoutPending)} conflict={timeoutConflict} latest={timeoutLatest} onDraftChange={setTimeoutInput} onCheckPending={checkTimeoutPending} onRefreshLatest={refreshTimeoutLatest} onReviewLatest={() => { if (timeoutLatest) { setTimeoutPolicy(timeoutLatest); setTimeoutLatest(null); setTimeoutConflict(false); setTimeoutError(""); setTimeoutInput(input => input && { ...input, reason: "" }); } }} onClose={() => { if (!timeoutSaving) setTimeoutOpen(false); }} onSave={saveTimeout} />}
      {timeoutOpen && !timeoutPolicy && <Modal title="会话超时策略" icon="clock" footer={<Button onClick={() => setTimeoutOpen(false)}>关闭</Button>} onClose={() => setTimeoutOpen(false)}><p role={timeoutError ? "alert" : "status"}>{timeoutError || "正在加载…"}</p>{timeoutError && <Button size="sm" onClick={() => void openTimeout()}>重新加载</Button>}</Modal>}
    </section>
  </>;
}
