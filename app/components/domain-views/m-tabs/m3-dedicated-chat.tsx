"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { subscribeAdminRealtime, getAdminRealtimeSnapshot, watchAdminConversation, sendAdminTyping } from "@/lib/admin/admin-conversation-realtime";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportAttachmentPolicy, type SupportCustomerDetail } from "@/lib/admin/m-support-client";
import { markMConversationRead, fetchMConversationTimeoutPolicy, updateMConversationTimeoutPolicy, type ConversationTimeoutPolicy } from "@/lib/admin/m-client";
import { parseBusinessTime } from "@/lib/admin/business-time";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import type { SessionConvo, SessionMsg } from "./data";
import type { MCtx } from "./types";
import { M3CustomerProfile } from "./m3-customer-profile";
import { SupportContentTools, type SelectedSupportContent } from "./support-content-tools";
import { SupportAvatar, customerAvatarPath, advisorAvatarPath } from "./support-avatar";
import { IdlePolicyModal } from "./m3-modals";
import { Modal } from "../design-kit";
import { SupportBulkComposer } from "./support-bulk-composer";
import { legacySupportDestination, privateMessageRecovery, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import "./m3-conversation-list.css";

type Intent = "SERVICE" | "MAINTENANCE";
type Attachment = { file: File; url: string; uploadId: string; key: string; id?: string; state: "selected" | "uploading" | "ready" | "error"; error?: string };
type Pending = { conversationId: string; key: string; body: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedVersion: number };

const CONVO_KEY = "I.session.convos";
const newKey = () => `m3-${crypto.randomUUID()}`;
const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
const recoveryKey = (adminId: number, key: string) => `${pendingKey(adminId)}:recovery:${key}`;
const ticketLinksKey = (adminId: number) => `nexion-m3-converted-tickets-v1:${adminId}`;
const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
type StoredMessage = PendingMutationRecord & { payload: string };
const pendingMessages = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", ttlMs: Number.MAX_SAFE_INTEGER-Date.now(), isValidRecord: (row) => typeof row.payload === "string" });
const readPending = (slot: string) => pendingMessages.list().find((row) => row.fingerprint === slot)?.payload;
const rememberPending = (slot: string, commandKey: string, value: object) => {
  pendingMessages.remember(slot, commandKey, { payload: JSON.stringify(value) });
  return pendingMessages.isDurablyStored(slot, commandKey);
};
export const validCustomerId = (value: string | null): value is string => Boolean(value && /^\d+$/.test(value) && /[1-9]/.test(value));
const customerIdOf = (convo: SessionConvo) => String(convo.customerId ?? "");
const canSendTo = (convo: SessionConvo, adminId: number) => convo.status === "open"
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
  return Number.isNaN(timestamp) ? "数据待核对" : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
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

function SupportMessage({message,previous,customerId,customerName,onRevoked,newlyArrived}:{message:SessionMsg;previous?:SessionMsg;customerId:string;customerName:string;onRevoked:()=>void;newlyArrived?:boolean}) {
  const system=message.sourceSenderType==="SYSTEM"||message.sourceSenderType==="INTERNAL";
  const name=system?"系统":message.sender==="agent"?message.agentName||"历史顾问":customerName;
  const grouped=!system&&previous?.sourceSenderType===message.sourceSenderType&&previous?.sender===message.sender&&message.authorConfidence==="VERIFIED"&&previous.authorConfidence==="VERIFIED"&&previous.senderId===message.senderId&&message.ts-previous.ts<300000;
  const path=message.authorConfidence==="VERIFIED"&&message.senderId&&message.senderAvatar?(message.sender==="agent"?advisorAvatarPath(message.senderId,customerId):String(message.senderId)===customerId?customerAvatarPath(customerId):undefined):undefined;
  const safeLegacy=message.kind==="TEXT"||!message.kind?legacySupportDestination(message.text):undefined;
  return <div className={newlyArrived&&!system?"m3-new-message":undefined} style={{alignSelf:system?"center":message.sender==="agent"?"flex-end":"flex-start",maxWidth:"88%",display:"flex",flexDirection:message.sender==="agent"?"row-reverse":"row",gap:8}}>
    {!system&&(grouped?<span style={{width:34,flexShrink:0}}/>:<SupportAvatar name={name} path={path} version={message.senderAvatar?.version}/>)}
    <div style={{minWidth:0,display:"grid",gap:4}}>
      {!grouped&&<span style={{color:"var(--v5-ink-3)",fontSize:12}}>{name}{!system&&message.authorConfidence!=="VERIFIED"?" · 作者身份未确认":""} · {messageTime(message.ts)}</span>}
      <div className={`msg-bubble ${message.sender==="agent"?"agent":"user"}`} style={{padding:"9px 12px",overflowWrap:"anywhere"}}>
        {message.kind==="IMAGE"?message.attachmentId?<PrivateImage id={message.attachmentId} onRevoked={onRevoked}/>:"图片暂不可用":<span style={{whiteSpace:"pre-wrap"}}>{message.text}</span>}
        {message.kind==="SKU"&&<div><strong>{message.skuName}</strong><p>商品编号：{message.skuId}</p>{message.targetAvailability==="UNAVAILABLE"?<span>商品已不可用；原推荐保留。</span>:<a href={`/devices/pricing?query=${encodeURIComponent(message.skuId??"")}`}>核对商城商品</a>}</div>}
        {message.kind==="LINK"&&<p>{message.targetAvailability==="UNAVAILABLE"?"目标页面已不可用":`客户端目标：${{HOME:"首页",WALLET:"钱包",SUPPORT:"在线客服"}[message.linkTarget?.type??"HOME"]}`}</p>}
        {safeLegacy&&<a href={safeLegacy}>核对原推荐页面</a>}
      </div>
      {!system&&message.sender==="agent"&&<small style={{color:"var(--v5-ink-3)"}}>{message.status==="read"?"已读":message.id?"已提交 · 阅读状态未知":"提交状态未知"}</small>}
    </div>
  </div>;
}

function SupportContactPicker({onClose,onSelect}:{onClose:()=>void;onSelect:(id:string)=>void}) {
  const adminId=useAdminAuth(s=>s.session?.adminId),epoch=useAdminAuth(s=>s.authEpoch);
  const [keyword,setKeyword]=useState(""),[page,setPage]=useState(1),[retry,setRetry]=useState(0),[rows,setRows]=useState<Awaited<ReturnType<typeof supportClient.customers>>|null>(null),[error,setError]=useState("");
  useEffect(()=>{const controller=new AbortController();setRows(null);setError("");supportClient.customers({pageNum:page,pageSize:10,filter:"ALL",keyword,signal:controller.signal}).then(p=>{if(!controller.signal.aborted)setRows(p);}).catch(e=>{if(!controller.signal.aborted)setError(displayAdminError(e));});return()=>controller.abort();},[keyword,page,retry,epoch]);
  return <Modal title="主动联系本人客户" icon="users" onClose={onClose} footer={<button className="btn btn-sec btn-sm" onClick={onClose}>取消</button>}><label>搜索客户姓名或编码<input className="fld" value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1);}}/></label><p>只可向当前本人客户发送；不再维护客户可在原求助会话中继续普通服务回复。</p>{error?<p role="alert">{error}<button className="l-btn sm" onClick={()=>setRetry(n=>n+1)}>重试客户列表</button></p>:!rows?<p role="status">正在读取客户…</p>:<>{!rows.records.length&&<p>暂无匹配的客户。</p>}{rows.records.map(c=><button className="l-btn sm" key={c.customerId} disabled={c.agentAdminId!==adminId||!c.maintenanceEnabled} onClick={()=>onSelect(c.customerId)}>{c.displayName||c.customerNo||c.customerId} · {c.customerNo||"编码未知"}{!c.maintenanceEnabled?" · 不再维护":c.agentAdminId!==adminId?" · 当前归属其他顾问":""}</button>)}<div className="m-admin-toolbar"><button className="l-btn sm" disabled={page<=1} onClick={()=>setPage(n=>n-1)}>上一页</button><span>第 {page} 页 · {rows.total} 位</span><button className="l-btn sm" disabled={page*10>=rows.total} onClick={()=>setPage(n=>n+1)}>下一页</button></div></>}</Modal>;
}

export function M3DedicatedChat({ ctx }: { ctx: MCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const adminId = session?.adminId ?? 0;
  const canWriteM3 = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities?.includes("service_m3_write"));
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const selectionRestored = useRef(false);
  const [screen, setScreen] = useState<"list" | "chat" | "profile">("list");
  const [query, setQuery] = useState("");
  const [listTab, setListTab] = useState("all"), [listPage, setListPage] = useState(1), [archiveIds, setArchiveIds] = useState<Set<string>>(new Set());
  const [contentChoice, setContentChoice] = useState<SelectedSupportContent | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false), [contactOpen, setContactOpen] = useState(false);
  const [timeoutOpen, setTimeoutOpen] = useState(false), [timeoutPolicy, setTimeoutPolicy] = useState<ConversationTimeoutPolicy | null>(null), [timeoutError, setTimeoutError] = useState(""), [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutInput,setTimeoutInput]=useState<{warnMinutes:number;closeMinutes:number;reason:string}|undefined>(undefined);
  const scopeGeneration = useRef(0);
  const [draftOwner, setDraftOwner] = useState(0), [metaTarget, setMetaTarget] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [intent, setIntent] = useState<Intent>("SERVICE");
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
  const all = useMemo(() => parseConversations(ctx.pget(CONVO_KEY)), [ctx.params, ctx]);
  const agents = useMemo(() => {
    try { return JSON.parse(ctx.pget("I.support.agents") ?? "[]") as Array<{ adminId: number; seatType?: string; position?: string }>; }
    catch { return []; }
  }, [ctx.params, ctx]);
  const myAgent = agents.find((agent) => agent.adminId === adminId);
  const canReviewAll = session?.role === "superadmin" || session?.role === "super" || myAgent?.seatType === "MANAGER" || Boolean(myAgent?.position?.includes("主管"));
  const qualificationUnknown = session?.role !== "superadmin" && session?.role !== "super"
    && Boolean(session?.authorities?.includes("service_m1_read")) && ctx.pget("I.support.agentsAvailable") !== "1";
  const qualificationRef = useRef(qualificationUnknown);
  if (qualificationRef.current !== qualificationUnknown) {
    qualificationRef.current = qualificationUnknown;
    scopeGeneration.current += 1;
    identityRef.current = `${authEpoch}:${adminId}:${scopeGeneration.current}`;
  }
  const visible = useMemo(() => qualificationUnknown ? [] : all.filter((convo) => validCustomerId(customerIdOf(convo)) && !revokedIds.has(convo.id) && (canReviewAll || convo.ownerAdminId === adminId)).sort((a, b) => b.lastTs - a.lastTs), [all, canReviewAll, adminId, revokedIds, qualificationUnknown]);
  const tabMatch = (convo: SessionConvo, tab: string) => tab === "archived" ? convo.archived === true : !convo.archived && (tab === "unread" ? convo.unread > 0 : tab === "open" ? convo.status === "open" : tab === "closed" ? convo.status !== "open" : true);
  const filtered = visible.filter(convo => tabMatch(convo,listTab) && (!query.trim() || [convo.customer ?? "", convo.profile?.nickname ?? "", convo.profile?.uid ?? "", customerIdOf(convo), convo.id].some(value => value.toLowerCase().includes(query.trim().toLowerCase()))));
  const listRows = filtered.slice((listPage-1)*10,listPage*10);
  const requestedConvo = validCustomerId(requestedCustomerId) ? visible.find((convo) => customerIdOf(convo) === requestedCustomerId && convo.status === "open") : null;
  const selected = requestedCustomerId ? requestedConvo ?? null : selectedId ? visible.find((convo) => convo.id === selectedId) ?? null : visible.find(convo => !convo.archived) ?? null;
  const canContinueClosed = Boolean(canWriteM3 && selected?.detailReady && selected.status !== "open" && selected.ownerAdminId === adminId);
  const historyReadOnlyHint = (selected?.status === "transferred" ? "此会话已转出，仅可查看历史。" : "历史会话只读。") + (canContinueClosed ? "前往当前会话会重新核对顾问归属。" : "");
  const replyCustomerId = selected ? canSendTo(selected, adminId) ? customerIdOf(selected) : null : requestedCustomerId;
  const closedCandidateRows = replyCustomerId ? visible.filter((convo) => customerIdOf(convo) === replyCustomerId && convo.ownerAdminId === adminId && convo.status !== "open") : [];
  const closedCandidateMissing = closedCandidateRows.filter((convo) => selectedClosedIds.has(convo.id) && !convo.detailReady).map((convo) => convo.id);
  const closedReplyCandidates = closedCandidateRows.filter((convo) => convo.detailReady).flatMap((convo) => {
    const latest = [...convo.messages].reverse().find((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id));
    return latest?.sender === "user" && Number.isSafeInteger(latest.id) ? [{ conversationNo: convo.id, throughMessageId: latest.id!, text: latest.text }] : [];
  });
  const closedReplyTargets = closedReplyCandidates.filter((row) => selectedClosedIds.has(row.conversationNo)).map(({ conversationNo, throughMessageId }) => ({ conversationNo, throughMessageId }));
  const closedCandidatesReady = closedCandidateMissing.length === 0 && !closedCandidateError && [...selectedClosedIds].every((id) => closedReplyCandidates.some((row) => row.conversationNo === id));
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
  const firstProfileCustomer = !selected && conversationsAvailable && firstDetail?.assignmentId && firstDetail.customerId === requestedCustomerId && (canReviewAll || firstDetail.agentAdminId === adminId) ? firstDetail : null;
  const profileCustomerId = selected && !selectedUnbound ? selected.customerId : firstProfileCustomer?.customerId;
  const currentProfileDetail = profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const ticketRows = (() => { try { const rows: unknown = JSON.parse(ctx.pget("I.support.tickets") ?? "[]"); return Array.isArray(rows) ? rows as Array<{ id?: string }> : []; } catch { return []; } })();
  const linkedTicketNo = selected && ctx.pget("I.support.ticketsAvailable") === "1" && ticketRows.some((ticket) => ticket.id === ticketLinks[selected.id]) ? ticketLinks[selected.id] : null;
  const targetKey = selected?.id ?? (requestedCustomerId ? `first:${requestedCustomerId}` : "");
  const draft = drafts[targetKey] ?? "";
  const recoveryBlocksTarget = recoveries.some(({ locator }) => Boolean(locator.conversationId && locator.conversationId === selected?.id) || Boolean(locator.customerId && locator.customerId === (selected?.customerId ?? requestedCustomerId)));
  const writable = !qualificationUnknown && !recoveryBlocksTarget && canWriteM3 && (selected ? selected.detailReady === true && (!selectedClosedIds.size || closedCandidatesReady) && canSendTo(selected, adminId) && Boolean(currentProfileDetail?.assignmentId && currentProfileDetail.agentAdminId === selected.ownerAdminId) : Boolean(validCustomerId(requestedCustomerId) && closedCandidatesReady && firstDetail?.assignmentId && firstDetail.agentAdminId === adminId));
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
    if (!replyCustomerId || !conversationsAvailable || !closedCandidateMissing.length || closedCandidateError) return;
    const controller = new AbortController();
    void loadConversationDetail(closedCandidateMissing[0], controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(closedCandidateMissing[0], replyCustomerId);
      } else setClosedCandidateError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [replyCustomerId, closedCandidateMissing.join("|"), conversationsAvailable, authEpoch, closedCandidateRetry, closedCandidateError, loadConversationDetail]);
  useEffect(() => { setClosedCandidateError(""); }, [replyCustomerId, authEpoch]);

  useEffect(() => {
    if (selected && writable && ctx.pget("I.session.ui.lastConvo") !== selected.id) {
      void ctx.setParam("I.session.ui.lastConvo", selected.id, { action: "持续接待 dock 选择会话", reason: "ui-state" });
    }
  }, [selected?.id, writable, ctx]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const conversationNo = params.get("conversationNo");
    setRequestedCustomerId(conversationNo ? null : params.get("customerId"));
    if (conversationNo) setSelectedId(conversationNo);
    if (conversationNo || params.get("customerId")) selectionRestored.current = true;
    if (conversationNo || params.get("customerId")) setScreen("chat");
  }, []);
  useEffect(() => {
    if (selectionRestored.current || !conversationsAvailable || qualificationUnknown) return;
    selectionRestored.current = true;
    const saved = ctx.pget("I.session.ui.lastConvo");
    if (saved && visible.some(convo => convo.id === saved && !convo.archived)) setSelectedId(saved);
  }, [conversationsAvailable, visible, ctx, qualificationUnknown]);

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
          if (!locator) { pendingMessages.forget(record.fingerprint, record.commandKey); continue; }
          const slot=recoveryKey(adminId, record.commandKey);
          pendingMessages.forget(record.fingerprint, record.commandKey);
          rememberPending(slot, record.commandKey, locator);
          // A failed quota write must not leave the previous private body on disk.
          if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]?.payload !== JSON.stringify(locator)) {
            sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
            rememberPending(slot, record.commandKey, locator);
          }
          if (!pendingMessages.isDurablyStored(slot, record.commandKey)) setRecoveryError("原消息编号仅保留在本页；恢复浏览器存储前请勿刷新或关闭页面，再重试查询。");
        }
      } catch { setRecoveryError("原消息编号暂不能持久保存，请保留本页并恢复浏览器存储后重试查询。"); }
    }
    readRecoveries();
    setRevokedIds((old) => new Set([...old, ...affected]));
    try {
      const saved = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string, unknown>;
      for (const key of Object.keys(saved)) if (affected.includes(key) || key === `first:${customerId}` || !customerId) delete saved[key];
      sessionStorage.setItem(`nexion-m3-drafts:${adminId}`, JSON.stringify(saved));
      for (const key of Object.keys(sessionStorage)) if (key.startsWith(`nexion-m3-reply-targets:${adminId}:`) && (!customerId || affected.some(id => key.endsWith(`:${id}`)) || key.endsWith(`:first:${customerId}`))) sessionStorage.removeItem(key);
    } catch { setSendError("本地私聊缓存清理失败，请退出当前账号后重新登录。"); }
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
      clearAttachment(pending?.kind !== "IMAGE"); setPending(null); setFirstPending(null); setBusy(false); setMetaTarget(""); setScreen("list"); setContentChoice(null); setBulkOpen(false); setContactOpen(false); setTimeoutOpen(false); setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); setArchiveIds(new Set());
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
      .catch(() => { if (!controller.signal.aborted) setAttachmentPolicyError("图片规则暂时无法读取，请重试。"); });
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
    setDrafts({}); setDraftOwner(0); setPending(null); setFirstPending(null); setSendError(""); setIntent("SERVICE"); setBusy(false); setActionChecking(false); setRevokedIds(new Set()); setTicketLinks({}); setContentChoice(null); setBulkOpen(false); setContactOpen(false); setTimeoutOpen(false); seenMessages.current=null; setNewMessageIds(new Set()); clearAttachment();
  }, [authEpoch, clearAttachment]);
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
      setSelectedClosedIds(new Set(Array.isArray(saved.ids)?saved.ids.filter((id: unknown)=>typeof id==="string"&&visible.some(c=>c.id===id&&c.customerId===(selected?.customerId??requestedCustomerId)&&c.ownerAdminId===adminId&&c.status!=="open")):[]));
      setIncludeCurrentReply(saved.include===true); setIntent(saved.intent==="MAINTENANCE"?"MAINTENANCE":"SERVICE");
    } catch { setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); }
    setMetaTarget(targetKey);
  }, [targetKey, adminId, authEpoch, qualificationUnknown]);
  useEffect(() => {
    if(!adminId||!targetKey||metaTarget!==targetKey||qualificationUnknown)return;
    try { sessionStorage.setItem(`nexion-m3-reply-targets:${adminId}:${targetKey}`,JSON.stringify({ids:[...selectedClosedIds],include:includeCurrentReply,intent})); } catch { setSendError("回复范围暂无法持久保存，请在本页核对后操作。"); }
  }, [targetKey,metaTarget,adminId,selectedClosedIds,includeCurrentReply,intent,qualificationUnknown]);
  useEffect(()=>{setListPage(1);setArchiveIds(new Set());},[query,listTab,authEpoch]);
  useEffect(()=>{setListPage(old=>Math.min(old,Math.max(1,Math.ceil(filtered.length/10))));},[filtered.length]);
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
    clearAttachment(pending?.kind !== "IMAGE"); setRequestedCustomerId(null); setSelectedId(convo.id); setScreen("chat"); setIntent("SERVICE"); setReadError(""); setSendError(pending ? "上条消息的结果待确认，请返回原会话用同一命令重试。" : "");
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
      setRecoveryError(result.status === "SUCCEEDED" ? "服务端确认原消息已发送。请刷新会话查看。" : "服务端确认原消息发送失败。重新发送前请核对当前归属。");
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
      if (!stored) { setBusy(false); setSendError("原消息命令暂不能持久保存，尚未发送；请恢复浏览器存储后用原命令重试。"); return; }
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
          if (recovered.status === "FAILED") { pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null); setSendError("服务端确认发送失败。草稿已保留，可修改后重新发送。"); return; }
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
            else { setDetailRetry((value) => value + 1); setSendError(`服务端已拒绝本次发送：${displayAdminError(cause)}。原文已保留，请核对客户归属后修改重发。`); }
          } else { if (lostPermission(cause)) ctx.invalidateScope(undefined, requestedCustomerId); setSendError(`发送失败或结果待确认：${displayAdminError(cause)}。请查询原命令。`); }
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
    if (!retry) {
      setBusy(true);
      try {
        const state = await supportClient.conversationState(selected.id);
        if (identityRef.current !== identity) return;
        if (state.status !== "OPEN") { setBusy(false); setSendError("当前会话已结束，请刷新会话列表后重新选择。"); return; }
        if (state.version !== selected.version) {
          setSendError("会话有新消息，请核对刷新后的详情再发送。原文已保留。");
          try { await ctx.refreshConversations(); }
          catch { setSendError("会话有新消息，列表刷新失败。原文已保留，请刷新会话后重试。"); }
          setBusy(false);
          return;
        }
        currentVersion = state.version;
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
      return { conversationId: selected.id, key: newKey(), body, intent, kind, attachmentId, message, expectedAssignmentId: currentProfileDetail!.assignmentId!, expectedVersion: currentVersion };
    })();
    const stored = rememberPending(pendingKey(adminId), record.key, record);
    setPending(record);
    if (!stored) { setBusy(false); setSendError("原消息命令暂不能持久保存，尚未发送；请恢复浏览器存储后用原命令重试。"); return; }
    setBusy(true); setSendError("");
    const input = { kind: record.kind, content: record.kind !== "IMAGE" ? record.body : undefined, attachmentId: record.attachmentId, skuId: record.message.skuId, linkTarget: record.message.linkTarget, intent: record.intent, clientMessageId: record.message.clientMessageId!, replyTargets: record.message.replyTargets, expectedAssignmentId: record.expectedAssignmentId, expectedVersion: record.expectedVersion };
    let ok = false, submitted = false;
    try {
      if (retry) {
        const recovered = await supportClient.command(record.key).catch((cause: unknown) => {
          if (cause instanceof SupportClientError && cause.status === 404) return null;
          throw cause;
        });
        if (identityRef.current !== identity) return;
        if (recovered && recovered.status !== "SUCCEEDED" && recovered.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后查询原命令。"); return; }
        if (recovered?.status === "FAILED") { pendingMessages.forget(pendingKey(adminId)); setPending(null); setSendError("服务端确认发送失败。草稿已保留，可修改后重新发送。"); return; }
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
      ok = true;
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
    }
    catch (cause) {
      if (identityRef.current === identity && submitted && rejectedSend(cause)) {
        pendingMessages.forget(pendingKey(adminId)); setPending(null);
        void ctx.refreshConversations().catch(() => {});
        if (lostPermission(cause)) { ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError("当前会话权限已变化，请返回客户列表核对。"); }
        else setSendError(`服务端已拒绝本次发送：${displayAdminError(cause)}。原文已保留，请核对会话后修改重发。`);
        return;
      }
      if (identityRef.current === identity) { if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError(`发送结果待确认：${displayAdminError(cause)}。请查询原命令。`); }
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
    } catch { if (selection === imageSelectionRef.current) setAttachmentPolicyError("图片无法读取，请重新选择 JPG 或 PNG 图片。"); return; }
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
      } else setAttachment({ ...current, state: "error", error: cause instanceof Error && cause.message.startsWith("图片") ? cause.message : displayAdminError(cause) });
    } finally { if (uploadControllerRef.current === controller) uploadControllerRef.current = null; }
  };

  const serviceStatus = !conversationsAvailable ? "会话服务暂不可用。请检查连接后重试。" : lostAccess ? "当前会话权限已变化，请刷新列表。" : "";
  const title = selected?.customer || selected?.profile?.nickname || (selected?.customerId ? `客户 ${selected.customerId}` : firstDetail?.displayName || (requestedCustomerIdValid && requestedCustomerId ? `客户 ${requestedCustomerId}` : "会话消息"));
  const checkActionReady = async (conversation: SessionConvo, requireHandled = true) => {
    if (!conversation.customerId || actionChecking) return false;
    const requestStamp=identityRef.current;
    setActionChecking(true); setActionError("");
    try {
      const detail = await supportClient.customerDetail(String(conversation.customerId));
      if(requestStamp!==identityRef.current)return false;
      if (detail.agentAdminId !== adminId || !detail.assignmentId) { ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError("客户归属已变化，请刷新会话后重试。"); return false; }
      if(conversation.id===activeConversationRef.current)setProfileDetail(detail);
      if (requireHandled && detail.waitingReply) { setActionError("还有客户消息待回复，请先发送服务回复后再办理。"); return false; }
      return true;
    } catch (cause) { if(requestStamp!==identityRef.current)return false; if (lostPermission(cause)) ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError(`客户待回复状态暂时无法核对：${displayAdminError(cause)}。请重试。`); return false; }
    finally { if(requestStamp===identityRef.current)setActionChecking(false); }
  };
  const closeConversation = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({
      action: `结束服务会话 ${conversation.id}`,
      detail: "将这段服务会话标记为已解决，不改变客户的专属顾问。客户再次求助时会开启新会话。",
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
  const convertToTicket = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({
      action: `转工单 ${conversation.id}`,
      detail: "为此会话建立内部跟进工单；工单处理人不会因此取得客户私聊权限。",
      reasonMin: 8, reasonMax: 200,
      run: async (reason) => {
        if(requestStamp!==identityRef.current)return false;
        const ok = await ctx.setParam("I.session.ticket.__create", JSON.stringify({
          conversationNo: conversation.id, category: "account", priority: "normal",
          title: `由会话 ${conversation.id} 转入 · ${conversation.customer || conversation.agentName}`,
          assignedAdminId: adminId, assignedAdminName: session?.operator || conversation.owner,
          expectedStatus: conversation.status, expectedVersion: conversation.version,
        }), { action: `会话转工单 ${conversation.id}`, reason, commandKey: `m3:convert-ticket:${conversation.id}:${conversation.version}`, onBackendResult: (result) => {
          if(requestStamp!==identityRef.current)return;
          if (result && typeof result === "object" && "ticketNo" in result && typeof result.ticketNo === "string" && result.ticketNo.trim()) {
            const ticketNo = result.ticketNo;
            setTicketLinks((old) => { const next = { ...old, [conversation.id]: ticketNo }; try { sessionStorage.setItem(ticketLinksKey(adminId), JSON.stringify(next)); } catch {} return next; });
          }
        } });
        if(requestStamp!==identityRef.current)return false;
        if (!ok) setActionError("转工单结果未确认，请重试查询；如有新客户消息，请先回复。");
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
    if(!canWriteM3||conversation.ownerAdminId!==adminId||pending||firstPending||!await checkActionReady(conversation, !conversation.archived))return;
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:conversation.archived?"撤销归档":"归档会话",detail:`会话 ${conversation.id}；只改变列表归档状态，保留原会话状态、消息和归属。`,reasonMin:8,reasonMax:200,run:reason=>requestStamp===identityRef.current?ctx.setParam(CONVO_KEY,JSON.stringify(all.map(c=>c.id===conversation.id?{...c,archived:!conversation.archived}:c)),{action:"修改会话归档",reason,commandKey:`m3:archive:${conversation.id}:${conversation.version}:${!conversation.archived}`}):Promise.resolve(false)});
  };
  const archiveBatch = async () => {
    if(!archiveIds.size||actionChecking||pending||firstPending)return;
    const chosen=visible.filter(c=>archiveIds.has(c.id)&&!c.archived&&c.ownerAdminId===adminId);
    if(chosen.length!==archiveIds.size){setActionError("所选会话范围已变化，请重新圈选。");return;}
    for(const c of chosen)if(!await checkActionReady(c))return;
    const payload={conversationNos:chosen.map(c=>c.id),expectedVersions:Object.fromEntries(chosen.map(c=>[c.id,c.version]))};
    const key=newKey();
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:"批量归档",detail:`确认归档 ${chosen.length} 段：${chosen.map(c=>c.id).join("、")}。未处理客户消息不能归档。`,reasonMin:8,reasonMax:200,run:async reason=>{if(requestStamp!==identityRef.current)return false;const ok=await ctx.setParam("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"批量归档已选会话",reason,commandKey:key});if(requestStamp!==identityRef.current)return false;if(ok)setArchiveIds(new Set());return ok;}});
  };
  const canTimeout = session?.role==="super"||session?.role==="superadmin"||Boolean(session?.authorities.includes("service_m3_timeout_manage"));
  const openTimeout = async () => { if(!canTimeout)return;setTimeoutOpen(true);setTimeoutPolicy(null);setTimeoutError("");setTimeoutInput(undefined);const stamp=identityRef.current;try{const p=await fetchMConversationTimeoutPolicy();if(stamp!==identityRef.current)return;const raw=readPending(`nexion-m3-timeout:${adminId}`),saved=raw?JSON.parse(raw):null;setTimeoutPolicy(saved?.policy??p);setTimeoutInput(saved?.input);}catch(e){if(stamp===identityRef.current)setTimeoutError(displayAdminError(e));} };
  const saveTimeout = async (input: {warnMinutes:number;closeMinutes:number;reason:string}) => {
    if(!timeoutPolicy||!canTimeout||timeoutSaving)return false;
    const slot=`nexion-m3-timeout:${adminId}`,raw=readPending(slot);let previous;try{previous=raw?JSON.parse(raw):null;}catch{setTimeoutError("原策略记录无法读取，请先核对当前策略，暂不重复提交。");return false;}
    if(previous&&JSON.stringify(previous.input)!==JSON.stringify(input)){setTimeoutError("上一条变更结果待确认，请保留原输入重试。");return false;}
    const command=previous??{key:newKey(),input,policy:timeoutPolicy,operator:session?.operator||session?.username||"unknown-admin"};rememberPending(slot,command.key,command);
    if(!pendingMessages.isDurablyStored(slot,command.key)){setTimeoutError("原策略命令暂不能持久保存，尚未提交，请恢复浏览器存储后重试。");return false;}setTimeoutSaving(true);setTimeoutError("");
    const stamp=identityRef.current;
    try{const next=await updateMConversationTimeoutPolicy(command.policy,command.input,command.key,command.operator);if(stamp!==identityRef.current)return false;setTimeoutPolicy(next);pendingMessages.forget(slot);return true;}
    catch(e){if(stamp===identityRef.current){setTimeoutError(displayAdminError(e));if(e&&typeof e==="object"&&"status" in e&&[400,403,404,409,422].includes(Number(e.status))&&!isIndeterminateSupportError(e))pendingMessages.forget(slot);}return false;}
    finally{if(stamp===identityRef.current)setTimeoutSaving(false);}
  };

  return <section className="m3-stage" aria-label="专属客服会话" style={{ height: "min(760px, calc(100dvh - 220px))", minHeight: 540 }}>
    <style>{`@keyframes m3-message-arrive{from{opacity:.65;transform:translateY(3px)}to{opacity:1;transform:none}}.m3-new-message{animation:m3-message-arrive 140ms ease-out}@media(prefers-reduced-motion:reduce){.m3-new-message{animation:none}}.m3-profile-group{border-bottom:1px solid var(--v5-border);padding:10px 0}.m3-profile-group summary{font-weight:600;cursor:pointer}.m3-service-profile .cvp-row .v{overflow-wrap:anywhere}.mdom .m3-stage{grid-template-columns:300px minmax(0,1fr) 264px}.mdom .m3-stage .l-btn.sm{min-height:44px}.mdom .m3-stage button:focus-visible,.mdom .m3-stage textarea:focus-visible,.mdom .m3-stage input:focus-visible,.mdom .m3-stage select:focus-visible,.mdom .m3-stage summary:focus-visible{outline:2px solid var(--v5-brand);outline-offset:2px}.mdom .m3-stage .ChatComposer{flex:0 1 auto;min-height:0;max-height:60%;overflow-y:auto}.mdom .m3-chat-identity{flex:1 1 180px;min-width:min(180px,100%);overflow-wrap:anywhere}.mdom .m3-chat-signal{flex-basis:100%}.mdom .m3-more{position:relative}.mdom .m3-more summary{cursor:pointer;list-style:none;display:flex;align-items:center}.mdom .m3-more summary::-webkit-details-marker{display:none}.mdom .m3-more-menu{position:absolute;right:0;top:100%;z-index:35;min-width:190px;padding:8px;display:grid;gap:6px;border:1px solid var(--v5-border);border-radius:10px;background:var(--v5-surface);box-shadow:0 12px 28px rgba(0,0,0,.18)}.mdom .m3-more-menu>*{width:100%;justify-content:flex-start;white-space:nowrap}@container mdom (max-width:1060px){.mdom .m3-stage{grid-template-columns:280px minmax(0,1fr)}.mdom .m3-stage .cv-profile:not(.open){visibility:hidden}}@container mdom (max-width:760px){.mdom .m3-stage{grid-template-columns:1fr;height:max(340px,calc(100dvh - 250px))!important;min-height:340px!important}.mdom .m3-col-chat>header{gap:8px!important}}`}</style>
    <div className={`m3-col-list ${screen !== "list" ? "hide-narrow" : ""}`}>
      <header className="m3-list-header">
        <h2>我的会话</h2>
        <p className="m3-list-description">只显示当前可审阅的客户会话</p>
        <div className="m3-list-primary-actions" role="group" aria-label="主动联系与群发">
          <button type="button" className="l-btn sm primary" disabled={!canWriteM3||qualificationUnknown} onClick={()=>setContactOpen(true)}>主动联系</button>
          <button type="button" className="l-btn sm" disabled={!canWriteM3||qualificationUnknown} onClick={()=>setBulkOpen(true)}>圈选群发</button>
        </div>
        <input className="fld m3-list-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户或会话编号" aria-label="搜索客户或会话编号" />
        <div className="m3-list-statuses" role="group" aria-label="会话状态筛选">
          {[["all","全部"],["unread","未读"],["open","进行中"],["closed","已结束"],["archived","归档"]].map(([value,label])=><button type="button" className={`l-btn sm ${listTab===value?"primary":""}`} key={value} aria-pressed={listTab===value} onClick={()=>setListTab(value)}><span>{label}</span>{" "}<span className="m3-list-count">{visible.filter(c=>tabMatch(c,value)).length}</span></button>)}
        </div>
        <div className="m3-list-secondary-actions" role="group" aria-label="会话列表管理">
          <button type="button" className="l-btn sm" disabled={!archiveIds.size||actionChecking} onClick={()=>void archiveBatch()}>归档已选 {archiveIds.size} 段</button>
          <button type="button" className="l-btn sm" disabled={!canTimeout} title={canTimeout?"查看会话超时策略":"需要会话超时策略管理权限"} onClick={()=>void openTimeout()}>超时策略</button>
        </div>
      </header>
      <div className="cv-list">
        {(recoveries.length > 0 || recoveryError) && <div className="itint warn" role="alert">{recoveryError || "原消息结果待确认；私聊正文与图片已清除，只保留原编号供查询。"}{recoveries.map(({ slot, locator }, index) => <button className="l-btn sm" type="button" key={slot} disabled={Boolean(recoveryBusy)} onClick={() => void queryRecovery(slot, locator)}>查询原消息 {index + 1}</button>)}</div>}
        {!conversationsAvailable && <div className="itint danger" role="alert">{serviceStatus} <button className="l-btn sm" type="button" onClick={() => void ctx.refreshConversations()}>重新连接</button></div>}
        {conversationsAvailable && filtered.length === 0 && <div className="itint">{qualificationUnknown ? "坐席身份待核对，暂时无法确认可审阅的会话范围。" : query ? "没有匹配的会话，请清除搜索。" : "暂无会话。可从“我的客户”发起首次联系。"}</div>}
        {listRows.map(convo=>{const active=selected?.id===convo.id;const kind=convo.detailReady?lastMessage(convo)?.kind:convo.lastMessageKind;const knownReplyState=currentProfileDetail&&currentProfileDetail.customerId===convo.customerId?currentProfileDetail.waitingReply:null;const hasMessage=Boolean(lastMessage(convo)||convo.lastPreview||kind==="IMAGE");return <div key={convo.id} style={{display:"flex",alignItems:"center"}}><input type="checkbox" aria-label={`选择会话 ${convo.id}`} checked={archiveIds.has(convo.id)} disabled={!canWriteM3||convo.ownerAdminId!==adminId||convo.archived} onChange={e=>setArchiveIds(old=>{const next=new Set(old);if(e.target.checked)next.add(convo.id);else next.delete(convo.id);return next;})}/><button type="button" className={`cv-item ${active?"on":""}`} style={{flex:1,minWidth:0}} onClick={()=>select(convo)} aria-current={active?"true":undefined}><span className="cv-r1"><SupportAvatar name={convo.customer||convo.profile?.nickname||"客户"} path={customerAvatarPath(String(convo.customerId))}/><strong className="cv-name">{convo.customer||convo.profile?.nickname||`客户 ${convo.customerId}`}</strong><time className="cv-time">{messageTime(convo.lastTs)}</time></span><span className="cv-prev">{kind==="IMAGE"?"[图片]":kind==="SKU"?"[商品推荐]":kind==="LINK"?"[页面链接]":lastMessage(convo)?.text||convo.lastPreview||"尚无人工消息"}</span><span className="cv-meta"><span className="cv-stat"><span>{!hasMessage?"待首次联系":knownReplyState===true?"待顾问回复":knownReplyState===false?"已处理":"查看待回复状态"}</span> · {convo.unread>0?`${convo.unread} 条未读`:"无未读"} · {convo.type==="advisor"?"顾问接待":"客服接待"}</span><span className="cv-tag">{convo.archived?"已归档 · ":""}{conversationStateLabel(convo.status)}</span></span><span className="m-admin-muted">发起来源：{convo.origin ? {user:"客户发起",advisor:"顾问主动",support:"客服主动"}[convo.origin] : "来源未记录"} · 当前顾问：{convo.owner}</span></button></div>;})}
        <div className="m-admin-toolbar"><button className="l-btn sm" disabled={listPage<=1} onClick={()=>setListPage(n=>n-1)}>上一页</button><span>第 {listPage} 页 · {filtered.length} 段</span><button className="l-btn sm" disabled={listPage*10>=filtered.length} onClick={()=>setListPage(n=>n+1)}>下一页</button></div>
      </div>
    </div>
    <div ref={chatColumnRef} className={`m3-col-chat ${screen === "list" ? "hide-narrow" : ""}`}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid var(--v5-border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><button type="button" className="l-btn sm" onClick={() => setScreen("list")} aria-label="返回会话列表">返回</button><SupportAvatar name={title} path={selected?.customerId?customerAvatarPath(String(selected.customerId)):undefined}/><div className="m3-chat-identity"><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2><div style={{ color: "var(--v5-ink-3)", fontSize: 12 }}>{selected ? `当前顾问：${selected.owner} · ${selected.status === "transferred" ? "已转出 · 只读" : selected.status === "open" ? "当前会话" : "历史会话"}` : requestedCustomerId ? "首次联系" : "选择客户查看会话"}</div></div>{selected?.ownerAdminId&&currentProfileDetail?.advisorAvatar&&<SupportAvatar name={selected.owner} path={advisorAvatarPath(selected.ownerAdminId,String(selected.customerId))} version={currentProfileDetail.advisorAvatar.version}/>} {(selected || profileCustomerId) && <button type="button" className="l-btn sm" onClick={() => setScreen("profile")}>客户资料</button>}{canContinueClosed && <button type="button" className="l-btn sm" onClick={continueClosed} title="重新核对当前顾问归属，前往当前会话；不会恢复历史段">前往当前会话</button>}{selected&&canWriteM3&&selected.ownerAdminId===adminId&&<button type="button" className="l-btn sm" disabled={actionChecking} onClick={()=>void archiveOne(selected)}>{selected.archived?"撤销归档":"归档"}</button>}{selected && (writable || linkedTicketNo || canReviewAll && selected.customerId) && <details className="m3-more"><summary className="l-btn sm">更多操作</summary><div className="m3-more-menu">{writable && <><button type="button" className="l-btn sm" disabled={actionChecking} onClick={closeConversation}>结束服务会话</button><button type="button" className="l-btn sm" disabled={actionChecking} onClick={convertToTicket}>转工单</button></>}{linkedTicketNo && <a className="l-btn sm" href={`/service/tickets?query=${encodeURIComponent(linkedTicketNo)}`}>工单详情</a>}{canReviewAll && selected.customerId && (selectedUnbound ? <a className="l-btn sm" href="/service/overview?view=pool">前往待绑定客户池</a> : <a className="l-btn sm" href={`/service/overview?customerId=${encodeURIComponent(selected.customerId)}`}>正式转绑客户</a>)}</div></details>}<span className="m-admin-muted m3-chat-signal">在线与输入状态：{presence ? presence.typing ? "对方正在输入…" : presence.online ? "客户在线" : "客户离线" : "暂无可信实时信号"}</span></header>
      <div className="ChatBody" role="log" aria-label="会话消息" aria-live="polite" style={{ gap: 14 }}>
        {serviceStatus && <div className="itint danger" role="alert">{serviceStatus}</div>}
        {actionError && <div className="itint danger" role="alert">{actionError}<button type="button" className="l-btn sm" onClick={() => setActionError("")}>知道了</button></div>}
        {!requestedCustomerIdValid && <div className="itint danger" role="alert">客户链接无效，无法打开会话。请从<a href="/service/overview">我的客户</a>重新进入。</div>}
        {readError && <div className="itint warn" role="alert">已读状态更新失败：{readError} <button type="button" className="l-btn sm" onClick={() => { markedRef.current = ""; setReadRetry((value) => value + 1); }}>重试</button></div>}
        {selected && !selected.detailReady ? <div className="itint" role={conversationError ? "alert" : "status"}>{conversationError ? `会话详情读取失败：${conversationError}` : "正在读取会话消息…"} {conversationError && <button type="button" className="l-btn sm" onClick={() => { setConversationError(""); setConversationRetry((value) => value + 1); }}>重试读取详情</button>}</div> : selected?.messages.length ? selected.messages.map((message,index)=><SupportMessage key={message.id??`${message.ts}-${index}`} message={message} previous={selected.messages[index-1]} newlyArrived={message.id!==undefined&&newMessageIds.has(message.id)} customerId={String(selected.customerId)} customerName={title} onRevoked={()=>ctx.invalidateScope(selected.id,String(selected.customerId))}/>) : <div className="itint">{requestedCustomerId?"尚无进行中会话。核对归属后即可发送首次联系。":selected?"这段会话尚无消息。":"选择会话后查看消息。"}</div>}
      </div>
      <div className="ChatComposer" style={{ display: "grid", gap: 10 }}>
        {detailLoading && <div className="itint">正在核对当前顾问归属…</div>}
        {detailError && <div className="itint danger" role="alert">客户资料读取失败：{detailError} <button type="button" className="l-btn sm" onClick={() => setDetailRetry((value) => value + 1)}>重试</button> <a href="/service/overview">返回我的客户</a></div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId !== adminId && <div className="itint warn">该客户由当前顾问服务，本账号仅可审阅。</div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId === adminId && !firstDetail.assignmentId && <div className="itint warn">当前归属资料未就绪，暂不能发送。请刷新客户资料。</div>}
        {selected && !writable && <div className="itint warn">{recoveryBlocksTarget ? <>原消息结果待确认，暂不能重复发送。<button className="l-btn sm" type="button" onClick={()=>setScreen("list")}>返回列表查询原消息</button></> : !canWriteM3 ? "当前账号只可查看会话，发送需会话操作权限。" : selected.status !== "open" ? historyReadOnlyHint : selectedUnbound ? "待分配顾问；主管可审阅求助，分配后由当前顾问回复。" : !currentProfileDetail ? <>正在核对客户归属。{profileError && <button type="button" className="l-btn sm" onClick={() => setProfileRetry((value) => value + 1)}>读取失败，重试</button>}</> : !currentProfileDetail.assignmentId || currentProfileDetail.agentAdminId !== selected.ownerAdminId ? <>客户归属已变化，请刷新会话后重试。<button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations()}>刷新会话</button></> : "仅当前顾问可发送消息；主管审阅不能代发。"}</div>}
        {!selected && recoveryBlocksTarget && <div className="itint warn">原消息结果待确认，暂不能重复发送。<button className="l-btn sm" type="button" onClick={()=>setScreen("list")}>返回列表查询原消息</button></div>}
        {requestedCustomerId && !selected && !canWriteM3 && <div className="itint warn">当前账号只可查看会话，发送需会话操作权限。</div>}{replyCustomerId && (!selected || closedCandidateRows.length > 0) && <div className="itint"><strong>{selected ? "处理旧会话" : "新服务会话"}</strong> · 原会话消息只有明确勾选后才会标记为已处理。{!selected && !firstPending && <button type="button" className="l-btn sm" onClick={() => { const url = new URL(window.location.href); url.searchParams.delete("customerId"); window.history.replaceState(null, "", url); setRequestedCustomerId(null); setSelectedClosedIds(new Set()); }}>取消接续</button>}{selectedClosedIds.size > 0 && !firstPending && !pending && <button type="button" className="l-btn sm" onClick={() => setSelectedClosedIds(new Set())}>清除旧会话选择</button>}{!closedCandidatesReady && <div role={closedCandidateError ? "alert" : "status"}>{closedCandidateError ? `旧会话读取失败：${closedCandidateError}` : closedCandidateMissing.length ? "正在核对已选旧会话消息…" : "已选旧会话没有可处理的客户消息，请取消勾选。"} {closedCandidateError && <button type="button" className="l-btn sm" onClick={() => { setClosedCandidateError(""); setClosedCandidateRetry((value) => value + 1); }}>重试核对</button>}</div>}{closedCandidateRows.map((row) => { const target = closedReplyCandidates.find((candidate) => candidate.conversationNo === row.id); return <label key={row.id} style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={displayedClosedIds.has(row.id)} disabled={!canWriteM3 || busy || Boolean(firstPending || pending)} onChange={(event) => setSelectedClosedIds((old) => { const next = new Set(old); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /> 处理旧会话 {row.id} 的客户消息：{target?.text ?? (row.detailReady ? "没有可处理的客户消息" : "勾选后核对消息")}</label>; })}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><label htmlFor="m3-intent" style={{ color: "var(--v5-ink-3)", fontSize: 12 }}>本条消息用途</label><select id="m3-intent" className="fld" value={displayedIntent} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => setIntent(event.target.value as Intent)}><option value="SERVICE">服务回复</option><option value="MAINTENANCE">联系维护</option></select><span style={{ color: "var(--v5-ink-4)", fontSize: 11.5 }}>仅“联系维护”成功发出后计为一次人工维护</span></div>
        {selected && currentProfileDetail?.waitingReply === true && displayedIntent === "MAINTENANCE" && selected.messages.some((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id)) && <label className="itint"><input type="checkbox" checked={includeCurrentReply || lockedTargets.some((target) => target.conversationNo === selected.id)} disabled={!writable || busy || Boolean(pending)} onChange={(event) => setIncludeCurrentReply(event.target.checked)} /> 同时标记本会话最近一条客户消息已处理（如仍待处理）</label>}
        <SupportContentTools ctx={ctx} disabled={!writable||busy||Boolean(pending||firstPending)} onInsert={insertText} onSelect={choice=>{if(!selected){setSendError("请先发送首次联系，再推荐商品或发送页面链接。");return;}setContentChoice(choice);if(!draft.trim())insertText(choice.kind==="SKU"?"推荐商品："+choice.name:"查看："+choice.name);}}/>
        {contentChoice&&<div className="itint">将发送：{contentChoice.name}<button className="l-btn sm" disabled={busy||Boolean(pending)} onClick={()=>setContentChoice(null)}>取消推荐</button></div>}
        {attachment && <div className="itint" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><img src={attachment.url} alt="待发送图片预览" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} /><span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{attachment.file.name}</span><span>{attachment.state === "ready" ? "已上传，尚未发送" : attachment.state === "uploading" ? "上传中…" : attachment.state === "error" ? `上传失败：${attachment.error}` : "等待上传"}</span><button type="button" className="l-btn sm" disabled={!writable || busy || attachment.state === "uploading" || attachment.state === "ready"} onClick={() => void uploadImage()}>{attachment.state === "error" ? "重试上传" : "上传图片"}</button><button type="button" className="l-btn sm primary" disabled={!writable || busy || Boolean(pending) || attachment.state !== "ready"} onClick={() => void send("IMAGE")}>发送图片</button><button type="button" className="l-btn sm" onClick={() => clearAttachment()} aria-label="移除待发送图片">移除</button><small style={{ color: "var(--v5-ink-3)" }}>发送文字不会附带此图片</small></div>}
        <textarea ref={composerRef} className="fld" aria-label="输入会话消息" placeholder="输入消息，Enter 发送，Shift+Enter 换行" value={draft} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => { setDrafts((old) => ({ ...old, [targetKey]: event.target.value })); sendAdminTyping(writable && Boolean(event.target.value.trim())); }} onBlur={() => sendAdminTyping(false)} onKeyDown={(event) => { if (shouldSendOnEnter(event)) { event.preventDefault(); void send(contentChoice?.kind ?? "TEXT"); } }} style={{ width: "100%", minHeight: 70, resize: "vertical" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><input ref={fileInputRef} type="file" accept="image/jpeg,image/png" aria-label="选择图片" disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} hidden /><button type="button" className="l-btn sm" style={{ minHeight: 44 }} disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onClick={() => fileInputRef.current?.click()}>选择图片</button><button className={`chat-send${busy ? " sending" : ""}`} type="button" disabled={!writable || busy || Boolean(pending || firstPending) || !draft.trim()} onClick={() => void send(contentChoice?.kind ?? "TEXT")}>{busy ? "发送中…" : contentChoice?.kind==="SKU" ? "发送商品" : contentChoice?.kind==="LINK" ? "发送链接" : "发送文字"}<span className="ic" aria-hidden="true">➤</span></button></div>
        {selected && (!attachmentPolicy?.available || attachmentPolicyError) && <div className="itint warn" role="status">{attachmentPolicyError || (attachmentPolicy ? "图片功能暂不可用。" : "正在读取图片规则…")} <button type="button" className="l-btn sm" onClick={() => setAttachmentPolicyRetry((value) => value + 1)}>重试</button></div>}
        {pending && selected?.id !== pending.conversationId && <div className="itint warn">另一条消息的结果待确认。请先返回原会话处理。<button type="button" className="l-btn sm" onClick={() => { const original = visible.find((convo) => convo.id === pending.conversationId); if (original) select(original); }}>返回原会话</button></div>}
        {(sendError || pending || firstPending) && <div className="itint danger" role="alert">{sendError || "上条消息的结果待确认，请查询原命令。"} {sendError.startsWith("消息已发送") && <button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</button>}{(pending || firstPending) && <button type="button" className="l-btn sm" disabled={busy || Boolean(pending && selected?.id !== pending.conversationId)} onClick={() => { if (pending) void send(pending.kind, pending); else void send("TEXT"); }}>查询结果并重试</button>}</div>}
      </div>
    </div>
    <aside className={`cv-profile ${screen === "profile" ? "open" : ""}`} aria-label="客户资料"><div className="cvp-scroll"><button type="button" className="l-btn sm" onClick={()=>setScreen("chat")}>返回会话</button><h2>客户资料</h2>{selectedUnbound ? <div className="itint">待分配顾问，尚无绑定客户的维护状态。</div> : profileCustomerId ? <M3CustomerProfile key={`${authEpoch}:${profileCustomerId}`} ctx={ctx} customerId={profileCustomerId} conversation={selected??undefined} scopeVersion={selected?.version??firstProfileCustomer?.version} messageError={conversationError} onRetryMessages={()=>{setConversationError("");setConversationRetry(n=>n+1);}} onHistory={no=>{const convo=visible.find(c=>c.id===no);if(convo)select(convo);}}/> : <div className="itint">{requestedCustomerId?"客户归属尚未核对，资料暂不可读取。":"选择客户后查看资料。"}</div>}</div></aside>
    {bulkOpen&&<SupportBulkComposer ctx={ctx} onClose={()=>setBulkOpen(false)}/>}
    {contactOpen&&<SupportContactPicker onClose={()=>setContactOpen(false)} onSelect={customerId=>{setRequestedCustomerId(customerId);setScreen("chat");setContactOpen(false);const url=new URL(window.location.href);url.searchParams.delete("conversationNo");url.searchParams.set("customerId",customerId);window.history.replaceState(null,"",url);}}/>}
    {timeoutOpen&&timeoutPolicy&&<IdlePolicyModal policy={timeoutPolicy} initialInput={timeoutInput} canSave={canTimeout} saving={timeoutSaving} error={timeoutError} onClose={()=>setTimeoutOpen(false)} onSave={saveTimeout}/>}
    {timeoutOpen&&!timeoutPolicy&&<Modal title="会话超时策略" icon="clock" onClose={()=>setTimeoutOpen(false)}><p role={timeoutError?"alert":"status"}>{timeoutError||"正在读取策略…"}</p>{timeoutError&&<button className="l-btn sm" onClick={()=>void openTimeout()}>重新读取</button>}</Modal>}
  </section>;
}
