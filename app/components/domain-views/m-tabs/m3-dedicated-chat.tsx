"use client";

import { useReach } from "@/lib/nav/use-reach";
import { customerConversations, replyTimeout } from "@/lib/admin/customer-conversations";

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode, type SetStateAction } from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useSearchParams } from "next/navigation";
import { Bell, BellOff, Check as CheckIcon, Clock3, Image as ImageIcon, Lock, Megaphone, Plus, Search, SendHorizontal, Square, TimerOff } from "lucide-react";
import { BlockState, Button, Check, Checkbox, Conclusion, Explain, Fact, Facts, Field, Fold, IconButton, Input, Modal as RdModal, MoreMenu, Notice, PageHeader, Panel, RecordList, ReleaseModal, Segments, Select, StatusTag, Textarea, type MoreMenuItem, type StateTone } from "@/app/components/rd";
import { subscribeAdminRealtime, getAdminRealtimeSnapshot, watchAdminConversation, sendAdminTyping } from "@/lib/admin/admin-conversation-realtime";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { ADMIN_ERROR_MESSAGES, displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { userNicknameText } from "@/lib/admin/brand-copy";
import { supportClient, isSupportScopeDenial, isSupportSessionExpired, supportAssignmentChanged, supportCustomerNotFound, querySupportMessage, SupportClientError, readSupportPoolCustomer, isIndeterminateSupportError, supportAttachmentUnavailableText, supportSessionBusy, agentSwitchText, SUPPORT_SESSION_ROLE_LABEL, type SupportAttachmentPolicy, type SupportCustomerDetail, type SupportReadMode, type SupportSessionHold } from "@/lib/admin/m-support-client";
import { fetchMConversationDetail, markM3MessagePageRead, resolveMConversationContinuation, fetchMConversationTimeoutPolicy, updateMConversationTimeoutPolicy, parseMConversationTimeoutPolicy, type ConversationTimeoutPolicy } from "@/lib/admin/m-client";
import { businessClock, businessStamp, businessZone, parseBusinessTime } from "@/lib/admin/business-time";
import { RETRY_EXPIRED_TEXT, createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import type { ConversationWriteState, SessionConvo, SessionMsg } from "./data";
import type { MCtx } from "./types";
import { M3CustomerProfile } from "./m3-customer-profile";
import { SupportContentTools, type SelectedSupportContent } from "./support-content-tools";
import { SupportAvatar, advisorAvatarPath } from "./support-avatar";
import { IdlePolicyModal } from "./m3-modals";
import { Modal } from "../design-kit";
import { SupportBulkComposer, hasBulkPending } from "./support-bulk-composer";
import { ownerLabel } from "./hd-ui";
import { AssignAdvisorDialog, hasPendingFirstAssignment } from "./m3-assign-advisor";
import { setSupportAlertPrefs, useSupportAlertPrefs } from "@/lib/admin/support-alerts";
import { legacySupportDestination, supportEnhancements } from "@/lib/admin/m-support-enhancements";
import { businessResultUnavailableText, RecoveryPanel, type RecoveryItem } from "../recovery-panel";
import { m1CustomerCode } from "./m1-customer-code";
import { scopedDraftSlot, identifySavedCustomer, supportLengthHint, blocksNewSend, failedDraftCopies, closeFailedDraft, restoreFailedDraft, SUPPORT_MESSAGE_MAX_LENGTH, refusedMessage, firstPendingKey, originalCustomerId, parseConversations, redactCustomerSends, sendJournal, pendingMessages, pendingSendCustomers, readSavedSends, recoveryKey, rememberPending, replySlot, useSendJournalRevision, validCustomerId, type MessageLocator, type Pending, type SavedSend, type StoredMessage } from "./m-message-journal";
export { validCustomerId } from "./m-message-journal";
import "./m3-dedicated-chat.css";
import { useM3MessagePages } from "./use-m3-message-pages";

type Intent = "SERVICE" | "MAINTENANCE";
type Attachment = { file: File; url: string; uploadId: string; key: string; id?: string; state: "selected" | "uploading" | "ready" | "error"; error?: string };
type SettledDraft = { slot: string; body: string; originalDraft?: string; legacyAssignment?: string };
type ContinuedCopy = { fingerprint: string; commandKey: string; destinationKey: string; body: string };
type DraftState = { drafts: Record<string, string>; continuedCopy?: ContinuedCopy };
function withoutSubmittedDraft(drafts: Record<string, string>, sent: SettledDraft) {
  const next = { ...drafts };
  for (const [key, text] of Object.entries(drafts)) {
    const [logical, , assignment] = key.split("@");
    if (key !== sent.slot && !(sent.legacyAssignment && logical === sent.slot && assignment === sent.legacyAssignment)) continue;
    if (text === (sent.originalDraft ?? sent.body) || sent.legacyAssignment && sent.originalDraft === undefined && typeof text === "string" && text.trim() === sent.body) delete next[key];
  }
  return next;
}
type SendFlight = { commandKey?: string; newSubmission?: boolean; image?: { id: string; outcome: "unused" | "submitted" | "sent" } };
type TimeoutInput = { warnMinutes: number; closeMinutes: number; sessionEndMinutes?: number; reason: string };
type TimeoutCommand = { key: string; input: TimeoutInput; policy: ConversationTimeoutPolicy; operator: string };

const CONVO_KEY = "I.session.convos";
const newKey = () => `m3-${crypto.randomUUID()}`;
const ticketLinksKey = (adminId: number) => `nexion-m3-converted-tickets-v1:${adminId}`;
const pendingTimeoutPolicies = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-timeout-pending-v1", retainExpiredRecords: true, isValidRecord: (row) => typeof row.payload === "string" });
export type SessionEndRecord = PendingMutationRecord & { actorId: number; customerId: string; sessionRef?: string; rejection?: { status: number; backendMessage: string } };
// Keep legacy customer-only records; new commands bind one reception instance and never overwrite older evidence.
const sessionEndCommands = createPendingMutationStore<SessionEndRecord>({ storageKey: "nexion-admin-m3-session-end-v1", retainExpiredRecords: true, isValidRecord: (row) => Number.isSafeInteger(row.actorId) && typeof row.customerId === "string" && (row.rejection === undefined || isExplicitRejection(row.rejection) && row.rejection.status !== 404) });
/**
 * 单行省略的字在能聚焦的控件旁边（会话行整行的点击区、「看全部」）：键盘聚焦这个控件、字确实被省略时，弹出全文气泡（ST-04，同 rd Cell 的做法）。
 * 鼠标悬停看控件的 title。按 Esc 关掉气泡，焦点留在控件上（同共用问号气泡，I07）。
 */
function FocusFullText({ text, clipped, children }: { text?: string; clipped: (trigger: HTMLElement) => Element | null | undefined; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  if (!text) return children;
  return <Tooltip.Provider><Tooltip.Root open={open} onOpenChange={next => { if (!next) setOpen(false); }}>
    <Tooltip.Trigger asChild onFocus={event => { const target = clipped(event.currentTarget); setOpen(event.currentTarget.matches(":focus-visible") && !!target && target.scrollWidth > target.clientWidth + 1); }} onBlur={() => setOpen(false)}>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Content className="rd-tip" side="bottom" align="start" sideOffset={4}>{text}</Tooltip.Content></Tooltip.Portal>
  </Tooltip.Root></Tooltip.Provider>;
}

export function readSessionEndRecords(actorId: number, customerId: string | undefined): SessionEndRecord[] {
  return sessionEndCommands.list().filter(row => row.actorId === actorId && row.customerId === customerId);
}
const customerIdOf = (convo: SessionConvo) => String(convo.customerId ?? "");
const canSendTo = (convo: SessionConvo, adminId: number) => convo.status !== "transferred" && convo.type !== "ai"
  && Number.isSafeInteger(adminId) && adminId > 0
  && convo.ownerAdminId === adminId;
const conversationStateLabel = (status: SessionConvo["status"]) => status === "open" ? "进行中" : status === "transferred" ? "已转出 · 只读" : "已结束";
const lostPermission = (cause: unknown) => cause != null && typeof cause === "object" && "status" in cause && (cause.status === 403 || cause.status === 404);
/** 消息发送结果未知时的几句：和全站同一套说法（先查询原结果；按原操作重试不会重复发送）。 */
const MESSAGE_UNKNOWN = "发送结果未知。先查询原结果；确认没发出再按原操作重试，不会重复发送。";
/** 结果未知提示条的标题已经说了「结果未知」，正文只写下一步。 */
const MESSAGE_UNKNOWN_NEXT = "先查询原结果；确认没发出再按原操作重试，不会重复发送。";
const MESSAGE_STILL_UNKNOWN = "刚查过，结果还没出来；这条记录继续保留，稍后再查。";
const MESSAGE_FAILED = "这条消息没发出，原文已放回输入框，可以改了再发。";
/** 原槽已有新稿时原文另存一份（failedDraftCopies），提示条换这句。 */
const MESSAGE_FAILED_KEPT = "输入框里是你后来写的内容，原文另存在下面；删除后不能找回。";
const MESSAGE_FAILED_UNCHECKED = "这条消息没发出。客户仍归你时，原文会放回原来的输入框。";
const MESSAGE_FAILED_IMAGE = "这张图片没发出，可以重新发送。";
const CONTINUATION_REASSIGNED = "这位客户已不归你负责，不能继续这段会话；有疑问找主管核对归属。";
const PEER_CHANGED_SEND_REFUSAL = "没有发出：这已不是客户的当前会话。客户仍归你时，原文会带进当前会话的空输入框，核对后再发；那边已有草稿时，原文留在原会话。";

const rejectedSupportWrite = (cause: unknown) => cause instanceof SupportClientError
  && cause.status !== 404
  && isExplicitRejection(cause)
  && !isIndeterminateSupportError(cause);
const conversationPeerChanged = (cause: unknown) => cause instanceof SupportClientError
  && cause.status === 409 && cause.backendMessage === "CONVERSATION_PEER_CHANGED";

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
    }).catch((cause: unknown) => { if (!controller.signal.aborted && !isSupportSessionExpired(cause)) { if (lostPermission(cause)) onRevokedRef.current(); else setError(displayAdminError(cause)); } });
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
  // 系统消息是会话记录里的内容（后端写入），和聊天气泡一样是数据，不是页面的说明。
  if(message.sourceSenderType==="SYSTEM")return <div className="m3s-system" role="note" data-user-content=""><span>{(message).text}</span><time>{messageTime(message.ts)}</time></div>;
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
      {mine&&(message.status==="read"||!message.id)&&<small className="m3s-receipt" data-warn={message.id?undefined:""}>{message.status==="read"?"已读":"发送结果未知"}</small>}
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
  return <Modal title="主动联系本人客户" icon="users" onClose={onClose}>
    <div className="m3s-picker">
      <Field label="搜索客户" explain="只能选你名下的客户，选中后只打开对话、不发消息；不再维护的客户在原会话里照常回复。">{control=><Input {...control} data-search aria-label="搜索客户" placeholder="昵称、手机号或用户编码" maxLength={200} value={keyword} onChange={e=>{setKeyword(e.target.value);setPage(1);}}/>}</Field>
      {error?<Notice tone="danger" action={<Button size="sm" onClick={()=>setRetry(n=>n+1)}>重试客户列表</Button>}>{error}</Notice>:!rows?<BlockState state="loading" title="正在加载客户…"/>:<>
        <p className="m3s-aux" role="status">共 {rows.total} 位客户 · 每页 10 条</p>
        {!rows.records.length?<BlockState state="empty" title="暂无匹配的客户。"/>:<ul className="m3s-picker-list" aria-label="可联系客户">
          {rows.records.map(c=><li key={c.customerId}><button type="button" disabled={c.agentAdminId!==adminId||!c.maintenanceEnabled} onClick={()=>onSelect(c.customerId)}>
            <span><strong>{c.displayName||c.customerNo||c.customerId}</strong><small>用户编码：U{c.customerId.padStart(8,"0")}</small></span>
            <span className="m3s-aux">{!c.maintenanceEnabled?"不再维护":c.agentAdminId!==adminId?"已归其他专属客服":"选择"}</span>
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

export function M3DedicatedChat({ ctx, snapshotRevision, back, summary, banner, streamReady, reconnecting, reconnectExhausted }: { ctx: MCtx; snapshotRevision: number; back?: ReactNode; summary: string; banner?: ReactNode; streamReady: boolean; reconnecting: boolean; reconnectExhausted: boolean }) {
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
    }).catch((cause: unknown) => { if (!controller.signal.aborted && generation === reviewGeneration.current) { setReviewScope(null); if (cause instanceof SupportClientError && cause.status === 403) setScopeDenied(true); else setReviewScopeError(displayAdminReadError(cause)); } });
    const invalidate = () => { controller.abort(); reviewGeneration.current++; setReviewScope(null); setScopeRetry(value => value + 1); };
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => { controller.abort(); reviewGeneration.current++; window.removeEventListener("support-scope-invalidated", invalidate); };
  }, [adminId, scopeIdentity, scopeRetry]);
  const canWriteM3 = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities?.includes("service_m3_write"));
  const searchParams = useSearchParams();
  const linkedConversationNo = searchParams.get("conversationNo") || null;
  const linkedCustomerId = searchParams.get("customerId");
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [restoredId, setRestoredId] = useState("");
  const pickDefaultConversation = typeof window === "undefined" || window.history.state?.m3SelectionDismissed !== performance.timeOrigin;
  const selectedId = linkedConversationNo ?? restoredId;
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
  // 窄宽时右栏收着，从对话头的菜单也能打开全部资料。
  const [profileOpen, setProfileOpen] = useState(0);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [bulkOpen, setBulkOpen] = useState(false), [contactOpen, setContactOpen] = useState(false), [assignOpen, setAssignOpen] = useState(false);
  const [timeoutOpen, setTimeoutOpen] = useState(false), [timeoutPolicy, setTimeoutPolicy] = useState<ConversationTimeoutPolicy | null>(null), [timeoutError, setTimeoutError] = useState(""), [timeoutSaving, setTimeoutSaving] = useState(false);
  const [timeoutInput,setTimeoutInput]=useState<TimeoutInput|undefined>(undefined);
  const [timeoutPending, setTimeoutPending] = useState<TimeoutCommand | null>(null), [timeoutConflict, setTimeoutConflict] = useState(false), [timeoutLatest, setTimeoutLatest] = useState<ConversationTimeoutPolicy | null>(null), [timeoutReadOnly, setTimeoutReadOnly] = useState(false);
  const timeoutIdentityRef = useRef("");
  timeoutIdentityRef.current = `${authEpoch}:${adminId}:${session?.role === "super" || session?.role === "superadmin"}:${Boolean(session?.authorities?.includes("service_m3_read"))}:${Boolean(session?.authorities?.includes("service_m3_timeout_manage"))}`;
  const scopeGeneration = useRef(0);
  const [draftOwner, setDraftOwner] = useState(0), [metaTarget, setMetaTarget] = useState("");
  const [{ drafts, continuedCopy }, setDraftState] = useState<DraftState>({ drafts: {} });
  const setDrafts = useCallback((update: SetStateAction<DraftState["drafts"]>) => {
    setDraftState(old => {
      const next = typeof update === "function" ? update(old.drafts) : update;
      return next === old.drafts ? old : { ...old, drafts: next };
    });
  }, []);
  // Saved drafts may still carry a purpose; it is now derived from the explicit 联系维护 switch below (M-26 / M-54).
  const messageRevision = useSendJournalRevision();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [recoveryError, setRecoveryError] = useState("");
  const [sendFeedback, setSendFeedback] = useState<{ customer: string | null; conversationId?: string; commandKey?: string; firstContactIdentity?: string; text: string } | null>(null);
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
  const flights = useRef(new Map<string, SendFlight>());
  const [, refreshFlights] = useState(0);
  const runCustomerCommand = async (customer: string, commandKey: string | undefined, action: (flight: SendFlight) => Promise<void>) => {
    const slot = `${scopeIdentity}:${customer}`;
    if (flights.current.has(slot)) return;
    const flight: SendFlight = { commandKey };
    flights.current.set(slot, flight);
    refreshFlights(n => n + 1);
    try { await action(flight); }
    finally {
      const image = flight.image;
      if (image && useAdminAuth.getState().session?.adminId === adminId) {
        if (image.outcome === "sent" && attachmentRef.current?.id === image.id) clearAttachment(false);
        if (image.outcome === "unused" && attachmentRef.current?.id !== image.id) {
          void supportClient.cancelAttachment(image.id, newKey()).catch(() => undefined);
        }
      }
      flights.current.delete(slot);
      refreshFlights(n => n + 1);
    }
  };
  const [firstRead, setFirstDetail] = useState<(SupportCustomerDetail & { revision: number }) | null>(null);
  const firstDetail = firstRead?.revision === snapshotRevision ? firstRead : null;
  const [detailError, setDetailError] = useState("");
  /** 客户不在这个账号的范围内（403/404）：按 ST-38 写无权限，不说成加载失败（BUG-657）。只决定显示。 */
  const [detailDenied, setDetailDenied] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRetry, setDetailRetry] = useState(0);
  const [profileRead, setProfileDetail] = useState<(SupportCustomerDetail & { revision: number }) | null>(null);
  const profileDetail = profileRead?.revision === snapshotRevision ? profileRead : null;
  const [profileError, setProfileError] = useState("");
  const [profileRetry, setProfileRetry] = useState(0);
  const [readError, setReadError] = useState("");
  const [readRetry, setReadRetry] = useState(0);
  const failedReadContext = useRef<{ key: string; beforeMessageId?: number } | null>(null);
  const [selectedClosedIds, setSelectedClosedIds] = useState<Set<string>>(() => new Set());
  const [includeCurrentReply, setIncludeCurrentReply] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionResult, setActionResult] = useState("");
  const [actionChecking, setActionChecking] = useState(false);
  const checkingContinuation = useRef<string | null>(null);
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
    if (!reconnecting || !conversationsAvailable) return;
    const timer = setTimeout(() => setStreamLost(true), 5000);
    return () => clearTimeout(timer);
  }, [reconnecting, conversationsAvailable]);
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
  const lastAuthorizedSnapshot = useRef(snapshotRevision);
  useLayoutEffect(() => {
    if (!conversationsAvailable || qualificationUnknown || snapshotRevision === lastAuthorizedSnapshot.current) return;
    lastAuthorizedSnapshot.current = snapshotRevision;
    setRevokedIds(previous => {
      const restored = all.filter(row => previous.has(row.id) && (canReviewAll || row.ownerAdminId === adminId));
      if (!restored.length) return previous;
      const next = new Set(previous);
      for (const row of restored) next.delete(row.id);
      return next;
    });
  }, [all, snapshotRevision, conversationsAvailable, qualificationUnknown, canReviewAll, adminId]);
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
  const [continuation, setContinuation] = useState<{ customerId: string; conversationNo: string | null } | null>(null);
  const [continuationFrom, setContinuationFrom] = useState<{ source: string; destination: string } | null>(null);
  const requestedConvo = validCustomerId(requestedCustomerId) ? continuation?.customerId === requestedCustomerId
    ? visible.find(convo => convo.id === continuation.conversationNo) ?? null
    : customerRows.find((convo) => customerIdOf(convo) === requestedCustomerId) : null;
  const canQueryMessages = Boolean(session?.authorities.includes("service_m3_read"));
  const savedSends = useMemo(() => canQueryMessages ? readSavedSends(adminId) : [], [adminId, authEpoch, messageRevision, canQueryMessages]);
  const failedCopies = useMemo(() => qualificationUnknown ? [] : failedDraftCopies.list().filter(copy => copy.commandOwnerId === adminId),
    [adminId, authEpoch, qualificationUnknown, messageRevision]);
  const originalCustomer = useCallback((locator: MessageLocator) => originalCustomerId(locator, visible), [visible]);
  const queryOnly = (entry: SavedSend) => qualificationUnknown || !conversationsAvailable || (!entry.reply && !entry.first)
    || Boolean(entry.reply && !visible.some(row => row.id === entry.reply!.conversationId));
  const awaitingFirstResponse = (entry: SavedSend) => [...flights.current.values()].some(flight => flight.newSubmission && flight.commandKey === entry.row.commandKey);
  const recoveries = savedSends.filter(entry => queryOnly(entry) && !awaitingFirstResponse(entry));
  const exactSelection = visible.find(convo => convo.id === selectedId);
  const originalSelection = savedSends.some(entry => entry.reply?.conversationId === selectedId)
    ? scoped.find(convo => convo.id === selectedId) : undefined;
  const selectedSummary = linkedConversationNo ? exactSelection ?? null
    : requestedCustomerId ? requestedConvo ?? null
    : selectedId ? originalSelection ?? customerRows.find(row => row.customerId === exactSelection?.customerId) ?? null
    : pickDefaultConversation ? customerRows.find(convo => !convo.archived) ?? null : null;
  const pageScope = `${scopeIdentity}:${scopeGeneration.current}:${scopeRetry}:${qualificationUnknown}:${conversationsAvailable}`;
  const recoveryTargets = savedSends.flatMap(entry => {
    const { row, reply, first, locator } = entry;
    if (reply?.draftDetached && awaitingFirstResponse(entry)) return [];
    const customerId = originalCustomer(locator);
    const assignmentId = first?.assignmentId ?? reply?.expectedAssignmentId;
    return customerId && assignmentId ? [{ key: row.commandKey, customerId, assignmentId, conversationId: reply?.conversationId, closed: false }] : [];
  });
  for (const copy of failedCopies) {
    const customerId = originalCustomerId(copy, visible);
    if (customerId) recoveryTargets.push({ key: copy.commandKey, customerId, assignmentId: copy.assignmentId, conversationId: copy.conversationId, closed: true });
  }
  const recoveryScope = JSON.stringify([pageScope, scopeMode, snapshotRevision, entryCheck, detailRetry, profileRetry, recoveryTargets]);
  const [verifiedRecovery, setVerifiedRecovery] = useState<{ scope: string; keys: Set<string> } | null>(null);
  const verifiedKeys = useRef<Set<string> | undefined>(undefined);
  verifiedKeys.current = verifiedRecovery?.scope === recoveryScope ? verifiedRecovery.keys : undefined;
  const leaveUnavailableConversation = useCallback((no: string, customerId?: string, notice?: string) => {
    // A denied deep link must stop driving selection before invalidation reloads the inbox.
    const url = new URL(window.location.href);
    const linked = url.searchParams.get("conversationNo");
    const linkedCustomer = url.searchParams.get("customerId");
    if (linked === no || !linked && (!linkedCustomer || linkedCustomer === customerId)) {
      url.searchParams.delete("conversationNo");
      url.searchParams.delete("customerId");
      // Keep the inbox clear within this document, including a chat remount.
      window.history.replaceState({ m3SelectionDismissed: performance.timeOrigin }, "", url);
      selectionRestored.current = true;
      followSelection.current = false;
      setRequestedCustomerId(null);
      setScreen("list");
    }
    setRestoredId(current => current === no ? "" : current);
    ctx.invalidateScope(no, customerId, notice ? { text: notice, page: "M3" } : undefined);
  }, [ctx.invalidateScope]);
  const messagePages = useM3MessagePages(qualificationUnknown || !conversationsAvailable ? null : selectedSummary, pageScope, messageOpening, (no, customerId) => {
    leaveUnavailableConversation(no, customerId, CONTINUATION_REASSIGNED);
  }, ctx.loadConversationDetail);
  const pageConversation = messagePages.page?.conversation.id === selectedSummary?.id ? messagePages.page?.conversation : null;
  const selected = selectedSummary ? { ...selectedSummary, ...(pageConversation ?? {}),
    writeState: messagePages.writeState,
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
  const [holdEndCommands, setHoldEndCommands] = useState<SessionEndRecord[]>([]);
  const [legacyEndChecked, setLegacyEndChecked] = useState<string | null>(null);
  const holdEndRejected = new Set(holdEndCommands.filter(record => record.rejection).map(record => record.commandKey));
  const [holdEndRelease, setHoldEndRelease] = useState<SessionEndRecord | null>(null);
  const holdEndView = useRef({ customerId: holdCustomer, commandKey: holdEndCommand?.commandKey });
  holdEndView.current = { customerId: holdCustomer, commandKey: holdEndCommand?.commandKey };
  const holdRequest = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const hold = holdRead && holdRead.customerId === holdCustomer ? holdRead.hold : undefined;
  const sessionEndRecoveries = holdEndCommands.filter(record => record.actorId === adminId && record.customerId === holdCustomer).map(record => {
    const instanceState = !record.sessionRef || !hold?.sessionRef ? "unconfirmed" : record.sessionRef === hold.sessionRef ? "current" : "historical";
    return { ...record, instanceState };
  });
  useEffect(() => {
    const saved = readSessionEndRecords(adminId, holdCustomer);
    setHoldEndCommands(saved);
    setHoldEndCommand(previous => saved.find(row => row.sessionRef && row.sessionRef === hold?.sessionRef)
      ?? saved.find(row => row.commandKey === previous?.commandKey) ?? saved[0] ?? null);
    setHoldEnding(false);
    setHoldEndRelease(previous => saved.some(row => row.commandKey === previous?.commandKey) ? previous : null);
    setLegacyEndChecked(null);
  }, [adminId, holdCustomer, authEpoch, hold?.sessionRef]);
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
  }, [holdCustomer, holdRetry, selected?.lastTs, inboxHolder, authEpoch, adminId, qualificationUnknown, conversationsAvailable]);
  // A send refused with 409 SUPPORT_SESSION_BUSY is the newest fact: earlier reads still in flight must not unlock it.
  const lockFromBusy = (customerId: string, busyHold: SupportSessionHold) => {
    holdRequest.current.generation++; holdRequest.current.controller?.abort();
    setHoldRead({ customerId, hold: busyHold });
  };
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
  const canContinueConversation = Boolean(!qualificationUnknown && canWriteM3 && !heldByOther && selected?.detailReady
    && selected.ownerAdminId === adminId && selected.writeState?.currentAssignmentAgentId === String(adminId)
    && selected.writeState.writableConversationNo !== selected.id
    && (selected.status !== "open" || selected.writeState.canReply === false));
  const historyReadOnlyHint = (selected?.status === "transferred" ? "此会话已转出，仅可查看历史。" : "历史会话只读。") + (canContinueConversation ? selected?.writeState?.writableConversationNo ? "可以打开当前会话继续。" : "可以发起会话继续。" : "");
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
  const targetCustomer = selected?.customerId ?? requestedCustomerId;
  const busy = flights.current.has(`${scopeIdentity}:${targetCustomer}`);
  const activeCustomerRef = useRef(targetCustomer);
  activeCustomerRef.current = targetCustomer;
  const selectedConversationId = selected?.id;
  const activeConversationRef = useRef(selectedConversationId);
  activeConversationRef.current = selectedConversationId;
  const customerSends = savedSends.filter(entry => targetCustomer && originalCustomer(entry.locator) === targetCustomer);
  const targetSends = customerSends.filter(entry => !queryOnly(entry));
  const replyEntry = targetSends.find(entry => entry.reply && entry.reply.conversationId === selectedConversationId);
  const otherReplyBlocksTarget = targetSends.some(entry => entry.reply && entry.reply.conversationId !== selectedConversationId);
  const firstEntry = targetSends.find(entry => entry.first);
  const [chosenCommand, setChosenCommand] = useState("");
  const activeEntry = targetSends.find(entry => entry.row.commandKey === chosenCommand && (entry.first || entry.reply?.conversationId === selected?.id))
    ?? (requestedCustomerId ? firstEntry ?? replyEntry : replyEntry ?? firstEntry);
  const activeKey = activeEntry?.row.commandKey;
  const canRetryActiveSend = !activeEntry?.dock && selected?.writeState?.canReply !== false;
  const sendError = sendFeedback?.customer === targetCustomer
    && (sendFeedback.firstContactIdentity
      ? sendFeedback.firstContactIdentity === identityRef.current && (!sendFeedback.conversationId || sendFeedback.conversationId === selectedConversationId)
      : sendFeedback.conversationId === selectedConversationId)
    && (!activeKey || !sendFeedback.commandKey || sendFeedback.commandKey === activeKey) ? sendFeedback.text : "";
  const setSendError = useCallback((text: string) => {
    if (activeCustomerRef.current === targetCustomer && activeConversationRef.current === selectedConversationId) {
      setSendFeedback(text ? { customer: targetCustomer, conversationId: selectedConversationId, commandKey: activeKey, text } : null);
    }
  }, [targetCustomer, selectedConversationId, activeKey]);
  const pending = activeEntry?.reply;
  const firstPending = activeEntry?.first;
  const privateContentReady = !qualificationUnknown && conversationsAvailable && draftOwner === adminId
    && customerSends.every(entry => entry.reply?.draftDetached && awaitingFirstResponse(entry) || verifiedKeys.current?.has(entry.row.commandKey));
  const firstRecoveryText = privateContentReady && firstPending ? firstPending.body : "";
  const otherSends = savedSends.filter(entry => !queryOnly(entry) && !awaitingFirstResponse(entry)).filter(({ reply, first }) => first ? first !== firstPending
    : reply && (reply !== pending || reply.conversationId !== selected?.id) && visible.some(convo => convo.id === reply.conversationId));
  const displayedIntent = privateContentReady ? pending?.intent ?? firstPending?.intent ?? intent : "SERVICE";
  const lockedTargets = privateContentReady ? firstPending?.replyTargets ?? pending?.message.replyTargets ?? [] : [];
  const displayedClosedIds = new Set([...selectedClosedIds, ...lockedTargets.map((target) => target.conversationNo)]);
  const originalView = () => mounted.current && activeCustomerRef.current === targetCustomer && activeConversationRef.current === selected?.id;
  const realtime = useSyncExternalStore(subscribeAdminRealtime, getAdminRealtimeSnapshot, getAdminRealtimeSnapshot);
  const presence = realtime.ready && realtime.presence?.conversationNo === selected?.id ? realtime.presence : null;
  useEffect(() => {
    watchAdminConversation(conversationsAvailable ? selected?.id ?? null : null);
    return () => { sendAdminTyping(false); watchAdminConversation(null); };
  }, [selected?.id, conversationsAvailable, adminId, authEpoch]);
  const selectedUnbound = selected?.ownerUnbound === true;
  /** 后端说这条会话不是客户当前能回的那条：分清原归属、现在分给谁、当前会话在哪；读不到就照实说。 */
  const threadNotice = (state: ConversationWriteState) => {
    const reassigned = Boolean(state.threadOwnerAgentId && state.currentAssignmentAgentId && state.threadOwnerAgentId !== state.currentAssignmentAgentId);
    const otherNo = state.writableConversationNo && state.writableConversationNo !== selected?.id ? state.writableConversationNo : null;
    // BUG-424：客户现在归本人时给下一步；按钮写的去向跟着后端给的当前会话走（有就打开，没有就首次联系）。
    if (canContinueConversation) return <Notice tone="neutral" action={<>
      {!state.writableConversationNo && <Explain label="点了会怎样" content="进入首次联系，发出第一条消息后开始对话。" />}
      <Button size="sm" variant="primary" loading={actionChecking} loadingText="正在核对…" onClick={() => void continueClosed()}>{state.writableConversationNo ? "打开当前会话" : "发起会话"}</Button>
    </>}>{reassigned ? `旧会话发不出：客户已从${state.threadOwnerAgentName ?? "原客服"}改分给你。` : "这是旧会话，这里发不出。"}</Notice>;
    const text = reassigned ? `这条会话原属${state.threadOwnerAgentName ?? "其他客服"}，客户已改分给${state.currentAssignmentAgentName ?? "其他客服"}，这里不能再回复。`
      : state.currentAssignmentAgentId ? `这是旧会话，客户现在归${state.currentAssignmentAgentName ?? "其他客服"}，这里不能再回复。`
      : otherNo ? "这是旧会话，客户现在的会话是另一条，这里不能再回复。"
      : "读不到这条会话现在归谁，暂时不能回复。";
    return <Notice tone="neutral" action={!reassigned && !otherNo && !state.currentAssignmentAgentId ? <Button size="sm" onClick={() => void ctx.refreshConversations()}>刷新会话</Button> : undefined}>{text}</Notice>;
  };
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
  const profileScopeRevision = snapshotRevision + profileRetry;
  const currentProfileDetail = profileDetail?.customerId === selected?.customerId
    && (!selected?.assignmentId || selected.assignmentId === profileDetail?.assignmentId) ? profileDetail : null;
  const draftAssignment = selected ? currentProfileDetail : firstProfileCustomer;
  const faqLanguage = (selected
    ? pageConversation && messagePages.page?.customerIdentity.effectiveLanguage
    : firstProfileCustomer?.effectiveLanguage) || "en-US";
  const logicalSlot = selected?.id ?? (requestedCustomerId ? `first:${requestedCustomerId}` : "");
  const targetKey = logicalSlot && draftAssignment?.assignmentId && draftAssignment.agentAdminId
    ? scopedDraftSlot(logicalSlot, draftAssignment.customerId, draftAssignment.assignmentId, draftAssignment.agentAdminId) : "";
  const replyTargetsKey = adminId && targetKey && !qualificationUnknown ? `nexion-m3-reply-targets:${adminId}:${targetKey}` : "";
  const draftSlotRef = useRef(targetKey);
  const failedCopy = privateContentReady && failedCopies.find(copy => conversationsAvailable && (!copy.conversationId || copy.conversationId === selectedConversationId)
    && originalCustomerId(copy, visible) === targetCustomer && verifiedKeys.current?.has(copy.commandKey));
  const draft = privateContentReady ? activeEntry?.dock && pending?.conversationId === selected?.id ? pending?.body ?? "" : drafts[targetKey] ?? "" : "";
  const recoveryBlocksTarget = savedSends.some(entry => {
    const customerId = originalCustomer(entry.locator);
    return !customerId || customerId === targetCustomer && queryOnly(entry);
  });
  const replyAuthority = !qualificationUnknown && canWriteM3 && !heldByOther && (selected ? selected.detailReady === true && selected.writeState?.canReply === true && (canSendTo(selected, adminId) || holdAllowsOther && canSendTo({ ...selected, ownerAdminId: adminId }, adminId)) && Boolean(currentProfileDetail?.assignmentId && currentProfileDetail.agentAdminId === selected.ownerAdminId) : Boolean(validCustomerId(requestedCustomerId) && firstDetail?.customerId === requestedCustomerId && firstDetail.assignmentId && (firstDetail.agentAdminId === adminId || holdAllowsOther)));
  const writeAuthorized = replyAuthority && closedCandidatesReady;
  const retryAuthority = useRef({ writeAuthorized, assignment: draftAssignment?.assignmentId, activeKey });
  retryAuthority.current = { writeAuthorized, assignment: draftAssignment?.assignmentId, activeKey };
  const ownReplyInFlight = Boolean(activeEntry?.reply?.draftDetached && awaitingFirstResponse(activeEntry));
  const composerAuthorized = replyAuthority && !recoveryBlocksTarget && !otherReplyBlocksTarget && Boolean(replyTargetsKey) && metaTarget === replyTargetsKey;
  const writable = composerAuthorized && closedCandidatesReady;
  const editable = selected
    ? composerAuthorized && privateContentReady && (!activeEntry || ownReplyInFlight)
    : writable && !busy && !firstPending;
  // 没有本人客户、没有可分配的客服时入口直接禁用，不打开弹窗再说做不了。读不到不拦，弹窗里有失败和重试。
  // 结果跟着已有的更新走：会话快照、名册变了，或切回这个页面，都重读一次（ST-54）。
  useEffect(() => {
    const again = () => {
      verifiedKeys.current = undefined;
      setVerifiedRecovery(null);
      if (document.visibilityState === "visible") setEntryCheck(value => value + 1);
    };
    window.addEventListener("focus", again); document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, []);
  const rosterSource = ctx.pget("I.support.agents");
  useEffect(() => { setOwnCustomers(null); setBulkBatches(null); }, [adminId, authEpoch]);
  useEffect(() => {
    if (qualificationUnknown) return;
    const controller = new AbortController();
    if (canWriteM3) void supportClient.customers({ mode: "PERSONAL", pageNum: 1, pageSize: 1, filter: "ALL", keyword: "", signal: controller.signal }).then(page => { if (!controller.signal.aborted) setOwnCustomers(page.total); }).catch(() => undefined);
    void supportEnhancements.bulkJobs(1, controller.signal).then(page => { if (!controller.signal.aborted) setBulkBatches(page.total); }).catch(() => undefined);
    return () => controller.abort();
  }, [canWriteM3, qualificationUnknown, adminId, authEpoch, snapshotRevision, rosterSource, entryCheck]);
  useEffect(() => {
    setNoAdvisorToAssign(false);
    if (!selectedUnbound || !canWriteAssignment || pendingAssignment || !selected?.customerId) return;
    const controller = new AbortController();
    void readSupportPoolCustomer(String(selected.customerId)).then(pool => supportClient.agents({ pageNum: 1, pageSize: 100, groupId: pool.routeGroupId ? Number(pool.routeGroupId) : undefined, signal: controller.signal })).then(page => { if (!controller.signal.aborted) setNoAdvisorToAssign(!page.records.some(agent => agent.assignmentEligible && !agent.busy)); }).catch(() => undefined);
    return () => controller.abort();
  }, [selectedUnbound, canWriteAssignment, pendingAssignment, selected?.customerId, rosterSource, snapshotRevision, entryCheck]);
  // 已发送后将焦点留在当前会话，方便继续输入。
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
    if (!qualificationUnknown && conversationsAvailable && (selected || requestedCustomerId) && ctx.pget("I.session.ui.lastConvo") !== (selected?.id ?? "")) {
      void ctx.setParam("I.session.ui.lastConvo", selected?.id ?? "", { action: "持续接待窗口 选择会话", reason: "ui-state" });
    }
  }, [selected?.id, requestedCustomerId, qualificationUnknown, conversationsAvailable, ctx]);

  useEffect(() => {
    setRequestedCustomerId(linkedConversationNo ? null : linkedCustomerId);
    if (linkedConversationNo || linkedCustomerId) {
      selectionRestored.current = true;
      followSelection.current = true;
      setScreen("chat");
    }
  }, [linkedConversationNo, linkedCustomerId]);
  useEffect(() => {
    if (selectionRestored.current || !pickDefaultConversation || !conversationsAvailable || qualificationUnknown) return;
    selectionRestored.current = true;
    const saved = ctx.pget("I.session.ui.lastConvo") || savedSends.find(entry => entry.reply)?.reply?.conversationId;
    // 网址写了范围就听网址的：上次的会话不在这个范围里就不恢复。
    const urlScoped = new URLSearchParams(window.location.search).has("scope");
    if (saved && visible.some(convo => convo.id === saved && !convo.archived) && (!urlScoped || scoped.some(convo => convo.id === saved))) { setRestoredId(saved); followSelection.current = true; }
  }, [conversationsAvailable, visible, ctx, qualificationUnknown, savedSends, pickDefaultConversation]);
  useEffect(() => {
    if (!followSelection.current || !conversationsAvailable || qualificationUnknown) return;
    const target = linkedConversationNo ? exactSelection : linkedCustomerId ? visible.find(convo => customerIdOf(convo) === linkedCustomerId)
      : requestedCustomerId ? visible.find(convo => customerIdOf(convo) === requestedCustomerId) : exactSelection;
    if (!target && requestedCustomerId === null && !selectedId) return;
    followSelection.current = false;
    if (!target || !canReviewAll) return;
    const fits = target.ownerAdminId === adminId ? scopeView === "mine" : scopeView === "team" && (!agentFilter || target.ownerAdminId === agentFilter);
    if (!fits) changeScope(target.ownerAdminId === adminId ? "mine" : "team");
  }, [conversationsAvailable, qualificationUnknown, visible, linkedConversationNo, linkedCustomerId, requestedCustomerId, selectedId, canReviewAll, adminId]);
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
    if (cancel && current.id && ![...flights.current.values()].some(flight => flight.image?.id === current.id) && !readSavedSends(adminId).some(entry => entry.reply?.attachmentId === current.id)) void supportClient.cancelAttachment(current.id, newKey()).catch(() => undefined);
    attachmentRef.current = null;
    setAttachment(null);
  }, [adminId]);
  useLayoutEffect(() => {
    if (!targetKey) return;
    if (draftSlotRef.current && draftSlotRef.current !== targetKey) {
      clearAttachment(); setContentChoice(null);
    }
    draftSlotRef.current = targetKey;
  }, [targetKey, clearAttachment]);
  const revokeCustomer = useCallback((customerId?: string, authoritative = false, originalConversationId?: string, commandKey?: string, persisted?: ReturnType<typeof redactCustomerSends>) => {
    // A pending roster is not evidence that access was revoked. Server denials still clear immediately.
    if (qualificationUnknown && !authoritative) return;
    if (!commandKey && persisted?.assignmentId === undefined) {
      scopeGeneration.current += 1; identityRef.current = `${authEpoch}:${adminId}:${scopeGeneration.current}`; setActionChecking(false);
    }

    const cleared = persisted ?? redactCustomerSends(adminId, all, customerId, originalConversationId, commandKey);
    const { affected, revokeAll } = cleared;
    customerId = cleared.customerId;
    if (cleared.error) setRecoveryError(cleared.error);
    if (!commandKey && cleared.assignmentId === undefined) setRevokedIds((old) => new Set([...old, ...affected]));
    if (!commandKey && cleared.assignmentId === undefined) setTicketLinks(old => { const next = { ...old }; for (const id of affected) delete next[id]; try { sessionStorage.setItem(ticketLinksKey(adminId), JSON.stringify(next)); } catch {} return next; });
    setDrafts((old) => {
      if (revokeAll) return {};
      const next = { ...old };
      for (const slot of Object.keys(next)) if (cleared.matchesDraft(slot)) delete next[slot];
      return next;
    });
    if (commandKey || cleared.assignmentId !== undefined) {
      if (commandKey && commandKey === activeKey || cleared.matchesDraft(draftSlotRef.current)) {
        setSendFeedback(null);
        clearAttachment(false); setContentChoice(null); setMaintenanceChosen(false); setSelectedClosedIds(new Set()); setIncludeCurrentReply(false);
        setMetaTarget(""); setProfileDetail(null); setFirstDetail(null); setProfileRetry(n => n + 1); setDetailRetry(n => n + 1);
      }
      return;
    }
    if (revokeAll || affected.includes(selectedId) && !requestedCustomerId || customerId && (selected?.customerId === customerId || requestedCustomerId === customerId)) {
      sendAdminTyping(false); watchAdminConversation(null);
      setFirstDetail(null); setProfileDetail(null); setDetailError(""); setDetailDenied(false); setProfileError(""); setRequestedCustomerId(null); setRestoredId("");
      clearAttachment(pending?.kind !== "IMAGE"); setMetaTarget(""); setScreen("list"); setContentChoice(null); if (revokeAll) setBulkOpen(false); setContactOpen(false); setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); setArchiveIds(new Set());
    }
  }, [all, originalCustomer, selectedId, selected?.customerId, requestedCustomerId, clearAttachment, adminId, authEpoch, pending?.kind, activeKey, qualificationUnknown]);
  useEffect(() => { setRecoveryError(""); }, [authEpoch]);
  useEffect(() => {
    const onScope = (event: Event) => {
      const target = (event as CustomEvent<{ customerId?: string; conversationNo?: string; cleared?: ReturnType<typeof redactCustomerSends>; changedAssignmentKey?: string }>).detail;
      revokeCustomer(target?.customerId, true, target?.conversationNo, target?.changedAssignmentKey, target?.cleared);
    };
    window.addEventListener("support-scope-invalidated", onScope);
    window.addEventListener("m3-assignment-invalidated", onScope);
    return () => { window.removeEventListener("support-scope-invalidated", onScope); window.removeEventListener("m3-assignment-invalidated", onScope); };
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
        if (current.id && !waitingImage && ![...flights.current.values()].some(flight => flight.image?.id === current.id)) void supportClient.cancelAttachment(current.id, newKey()).catch(() => undefined);
      }
    };
  }, []);
  useEffect(() => {
    setMetaTarget("");
    setDraftState({ drafts: {} }); setDraftOwner(0); setActionResult(""); setSendError(""); setMaintenanceChosen(false); setActionChecking(false); setRevokedIds(new Set()); setTicketLinks({}); setContentChoice(null); setBulkOpen(false); setContactOpen(false); setTimeoutOpen(false); seenMessages.current=null; setNewMessageIds(new Set()); clearAttachment();
  }, [authEpoch, clearAttachment]);
  useEffect(() => {
    setTimeoutOpen(false); setTimeoutPolicy(null); setTimeoutInput(undefined); setTimeoutPending(null); setTimeoutLatest(null); setTimeoutConflict(false); setTimeoutReadOnly(false); setTimeoutError(""); setTimeoutSaving(false);
  }, [authEpoch, adminId]);
  useEffect(() => {
    if (!adminId || !conversationsAvailable || qualificationUnknown) return;
    try {
      const value = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string,unknown>;
      setDrafts(Object.fromEntries(Object.entries(value).filter((entry):entry is [string,string]=>typeof entry[1]==="string")));
    } catch { setSendError("草稿保存不可用；当前输入仍保留在此页面。"); }
    setDraftOwner(adminId);
  }, [adminId, authEpoch, conversationsAvailable, qualificationUnknown]);
  // Move drafts when opening a destination. Once it has its own draft or send,
  // clearing its input must not pull an old draft into this opening.
  const firstSource = targetCustomer ? `first:${targetCustomer}` : "";
  const explicitSource = continuationFrom?.destination === logicalSlot ? continuationFrom?.source : undefined;
  const sourceThreads = selected
    ? explicitSource ? [explicitSource, firstSource]
      : linkedConversationNo ? [firstSource]
        : [firstSource, ...visible.filter(row => row.customerId === targetCustomer && row.id !== selected.id).map(row => row.id)]
    : explicitSource ? [explicitSource] : [];
  const matchesContinuationCopy = (copy: (typeof failedCopies)[number], source: string) =>
    copy.commandOwnerId === adminId && copy.source !== "dock" && copy.customerId === targetCustomer
    && copy.assignmentId === draftAssignment?.assignmentId && (copy.conversationId ?? firstSource) === source && Boolean(copy.body.trim());
  const continuationSources = targetCustomer && draftAssignment?.assignmentId && draftAssignment.agentAdminId
    ? sourceThreads.filter(no => drafts[scopedDraftSlot(no, targetCustomer, draftAssignment.assignmentId!, draftAssignment.agentAdminId!)]?.trim()
      || failedCopies.some(copy => matchesContinuationCopy(copy, no)))
    : [];
  const continuationCandidates = continuationSources.join("|");
  const continuationBlocked = useRef(false);
  useEffect(() => { continuationBlocked.current = false; }, [logicalSlot, messageOpening, authEpoch]);
  const destinationOccupied = Boolean(targetKey && drafts[targetKey]?.trim() || (selected ? replyEntry : firstEntry) || selected && failedCopies.some(copy =>
    copy.source !== "dock" && copy.customerId === targetCustomer && copy.conversationId === selected.id
      && copy.assignmentId === draftAssignment?.assignmentId));
  const recoverContinuationDraft = useEffectEvent(async (sources: string[], signal: AbortSignal) => {
    if (!targetCustomer || !draftAssignment?.assignmentId || !draftAssignment.agentAdminId) return;
    const { assignmentId, agentAdminId } = draftAssignment;
    const stamp = identityRef.current;
    for (const source of sources) {
      if (selected && source !== firstSource) {
        try {
          const detail = await fetchMConversationDetail(source, signal, false);
          if (detail.customerId !== targetCustomer || detail.writeState?.canReply !== false
            || detail.writeState.writableConversationNo !== selected.id
            || detail.writeState.currentAssignmentAgentId !== String(agentAdminId)) continue;
        } catch {
          // No authoritative old-thread state means the draft stays in its original slot.
          continue;
        }
      }
      if (signal.aborted || stamp !== identityRef.current || !originalView()
        || blocksNewSend(pendingSendCustomers(adminId, visible), targetCustomer)) return;
      const sourceKey = scopedDraftSlot(source, targetCustomer, assignmentId, agentAdminId);
      const copy = failedDraftCopies.list().find(item => matchesContinuationCopy(item, source));
      // Revocation and draft edits may have updated either slot during the read.
      setDraftState(old => {
        if (sourceKey === targetKey || old.drafts[targetKey]?.trim()) return old;
        const body = old.drafts[sourceKey]?.trim() ? old.drafts[sourceKey] : copy?.body;
        if (!body) return old;
        const drafts = { ...old.drafts, [targetKey]: body };
        delete drafts[sourceKey];
        return { drafts, continuedCopy: copy?.body === body
          ? { fingerprint: copy.fingerprint, commandKey: copy.commandKey, destinationKey: targetKey, body }
          : old.continuedCopy };
      });
      return;
    }
  });
  const canRecoverContinuation = writeAuthorized && privateContentReady && !busy && !activeEntry
    && !otherReplyBlocksTarget && !recoveryBlocksTarget && Boolean(targetKey);
  useEffect(() => {
    if (destinationOccupied) continuationBlocked.current = true;
    if (continuationBlocked.current || !canRecoverContinuation || !continuationCandidates) return;
    const controller = new AbortController();
    void recoverContinuationDraft(continuationCandidates.split("|"), controller.signal);
    return () => controller.abort();
  }, [canRecoverContinuation, continuationCandidates, targetKey, destinationOccupied, messageOpening]);
  useEffect(() => {
    if (!adminId || draftOwner!==adminId || qualificationUnknown) return;
    try {
      sessionStorage.setItem(`nexion-m3-drafts:${adminId}`, JSON.stringify(drafts));
    } catch {
      setSendError("草稿保存不可用；当前输入仍保留在此页面。");
      return;
    }
    if (continuedCopy) {
      if (drafts[continuedCopy.destinationKey] === continuedCopy.body) {
        failedDraftCopies.forget(continuedCopy.fingerprint, continuedCopy.commandKey);
      }
      setDraftState(old => old.continuedCopy === continuedCopy ? { drafts: old.drafts } : old);
    }
  }, [drafts, continuedCopy, adminId, draftOwner, qualificationUnknown]);
  useEffect(() => {
    if (!replyTargetsKey || metaTarget === replyTargetsKey) return;
    try {
      const saved = JSON.parse(sessionStorage.getItem(replyTargetsKey) ?? "{}");
      const ids = Array.isArray(saved.ids) ? saved.ids.filter((id: unknown) => typeof id === "string") : [];
      setSelectedClosedIds(new Set<string>(ids));
      setIncludeCurrentReply(saved.include===true);
      const urlIntent = new URLSearchParams(window.location.search).get("intent");
      setMaintenanceChosen(urlIntent !== null ? urlIntent === "maintenance" : saved.intent === "MAINTENANCE");
    } catch { setSelectedClosedIds(new Set()); setIncludeCurrentReply(false); }
    setMetaTarget(replyTargetsKey);
  }, [replyTargetsKey, metaTarget]);
  useEffect(() => {
    if (!replyTargetsKey || metaTarget !== replyTargetsKey || !replyContextReady) return;
    const offered = new Set(closedCandidateIds.split("|"));
    setSelectedClosedIds(previous => {
      const remaining = [...previous].filter(id => offered.has(id));
      return remaining.length === previous.size ? previous : new Set(remaining);
    });
  }, [replyTargetsKey, metaTarget, replyContextReady, closedCandidateIds]);
  useEffect(() => {
    if (!replyTargetsKey || metaTarget !== replyTargetsKey) return;
    try {
      if (selectedClosedIds.size || includeCurrentReply || intent === "MAINTENANCE") sessionStorage.setItem(replyTargetsKey, JSON.stringify({ids:[...selectedClosedIds],include:includeCurrentReply,intent}));
      else sessionStorage.removeItem(replyTargetsKey);
    } catch { setSendError("回复范围无法保存在浏览器里，请在本页核对后操作。"); }
  }, [replyTargetsKey, metaTarget, selectedClosedIds, includeCurrentReply, intent]);
  useEffect(()=>{setListLimit(LIST_CHUNK);setArchiveIds(new Set());},[query,listTab,authEpoch]);
  useEffect(() => {
    if (!adminId) return;
    try {
      const rows: unknown = JSON.parse(sessionStorage.getItem(ticketLinksKey(adminId)) ?? "{}");
      if (rows && typeof rows === "object" && !Array.isArray(rows)) setTicketLinks(Object.fromEntries(Object.entries(rows).filter(([conversationId, ticketNo]) => conversationId && typeof ticketNo === "string" && ticketNo)));
    } catch { setTicketLinks({}); }
  }, [adminId, authEpoch]);
  useEffect(() => {
    if (!conversationsAvailable || qualificationUnknown) return;
    for (const { locator, row } of savedSends) {
      if (!locator.conversationId || validCustomerId(locator.customerId ?? null)) continue;
      const original = visible.find(convo => convo.id === locator.conversationId);
      if (!original) continue;
      identifySavedCustomer(adminId, row.commandKey, original.id, customerIdOf(original));
    }
  }, [adminId, conversationsAvailable, qualificationUnknown, savedSends, visible]);
  const scanRecovery = useEffectEvent((scope: string, signal: AbortSignal) => {
    const requests = new Map<string, Promise<SupportCustomerDetail>>();
    for (const original of recoveryTargets) {
      const { key, customerId, assignmentId, conversationId } = original;
      let request = requests.get(customerId);
      if (!request) {
        request = supportClient.customerDetail(customerId, signal);
        requests.set(customerId, request);
      }
      const current = () => !signal.aborted && mounted.current && document.visibilityState === "visible"
        && useAdminAuth.getState().authEpoch === authEpoch;
      void request.then(detail => {
        if (!current() || detail.customerId !== customerId) return false;
        if (detail.assignmentId !== assignmentId) {
          ctx.invalidateScope(conversationId, customerId, undefined, key);
          return false;
        }
        if (!canReviewAll && detail.agentAdminId !== adminId) {
          ctx.invalidateScope(conversationId, customerId);
          return false;
        }
        if (conversationId && !visible.some(row => row.id === conversationId && row.customerId === customerId)) return false;
        if (original.closed && restoreFailedDraft(adminId, key, detail)) return true;
        setVerifiedRecovery(old => ({ scope, keys: new Set([...(old?.scope === scope ? old.keys : []), key]) }));
        return true;
      }, cause => {
        if (current() && lostPermission(cause)) ctx.invalidateScope(conversationId, customerId);
        // A temporary failure leaves the original hidden until the next scope check.
        return false;
      });
    }
  });
  useEffect(() => {
    if (qualificationUnknown || document.visibilityState !== "visible") return;
    const controller = new AbortController();
    scanRecovery(recoveryScope, controller.signal);
    return () => controller.abort();
  }, [recoveryScope, qualificationUnknown]);
  useEffect(() => {
    if (!privateContentReady || !targetKey || !verifiedKeys.current?.has(activeKey ?? "")) return;
    const original = firstPending && !selected ? firstPending : !activeEntry?.dock && !pending?.draftDetached && pending?.kind === "TEXT" && pending.conversationId === selected?.id ? pending : null;
    if (!original) return;
    setDrafts(old => {
      if (old[targetKey]) return old;
      const next = { ...old, [targetKey]: (!original.draftSlot && old[logicalSlot]) || original.originalDraft || original.body };
      if (!original.draftSlot) delete next[logicalSlot];
      return next;
    });
  }, [pending, firstPending, selected?.id, privateContentReady, activeEntry?.dock, targetKey, logicalSlot, activeKey]);
  useEffect(() => {
    clearAttachment();
    setSendFeedback(previous => previous?.firstContactIdentity === identityRef.current && previous?.customer === targetCustomer ? previous : null);
  }, [selected?.id, selected?.ownerAdminId, selected?.assignmentId, requestedCustomerId, targetCustomer, clearAttachment]);
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
  const customerIdOfSelection = selected?.customerId ?? savedSends.find(entry => entry.locator.conversationId === selectedId)?.locator.customerId;
  useEffect(() => {
    if (qualificationUnknown || !lostAccess && (!selected || selected.ownerAdminId === adminId || canReviewAll)) return;
    const customerId = customerIdOfSelection;
    const controller = new AbortController();
    if (lostAccess) {
      if (revokedIds.has(selectedId)) return;
      void supportClient.conversationState(selectedId, controller.signal).catch(cause => {
        if (!controller.signal.aborted && isSupportScopeDenial(cause)) leaveUnavailableConversation(selectedId, customerId);
      });
    } else revokeCustomer(customerId, false, selectedId || undefined);
    setSendError("你已经看不了这个会话，请回客户列表刷新。");
    return () => controller.abort();
  }, [lostAccess, selectedId, revokedIds, customerIdOfSelection, adminId, canReviewAll, qualificationUnknown, leaveUnavailableConversation]);

  useEffect(() => {
    if (!validCustomerId(requestedCustomerId) || requestedConvo || !conversationsAvailable || qualificationUnknown) { setFirstDetail(null); return; }
    const controller = new AbortController();
    const requestStamp = identityRef.current;
    setDetailLoading(true); setDetailError(""); setDetailDenied(false); setFirstDetail(null);
    supportClient.performanceCustomerDetail(requestedCustomerId, controller.signal).then((result) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (!canReviewAll && result.agentAdminId !== adminId) {
        revokeCustomer(requestedCustomerId);
        return;
      }
      setFirstDetail({ ...result, revision: snapshotRevision });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current || isSupportSessionExpired(cause)) return;
      if (lostPermission(cause)) {
        revokeCustomer(requestedCustomerId, true);
      }
      setDetailDenied(lostPermission(cause));
      setDetailError(displayAdminError(cause));
    })
      .finally(() => { if (!controller.signal.aborted && requestStamp === identityRef.current) setDetailLoading(false); });
    return () => controller.abort();
  }, [requestedCustomerId, requestedConvo, conversationsAvailable, qualificationUnknown, snapshotRevision, detailRetry, authEpoch, adminId, canReviewAll, revokeCustomer]);
  useEffect(() => {
    if (!selected?.customerId || !conversationsAvailable || qualificationUnknown) { setProfileDetail(null); return; }
    if (selectedUnbound) { setProfileDetail(null); setProfileError(""); return; }
    const controller = new AbortController();
    const requestStamp = identityRef.current;
    setProfileError("");
    supportClient.performanceCustomerDetail(String(selected.customerId), controller.signal).then((detail) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current) return;
      if (!canReviewAll && detail.agentAdminId !== adminId) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
        return;
      }
      setProfileDetail({ ...detail, revision: snapshotRevision });
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || requestStamp !== identityRef.current || isSupportSessionExpired(cause)) return;
      if (checkingContinuation.current === selected.id && supportCustomerNotFound(cause)) {
        leaveUnavailableConversation(selected.id, selected.customerId, CONTINUATION_REASSIGNED);
      } else if (supportCustomerNotFound(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId), { text: "你没有查看这位客户的权限", page: "M3" });
      } else if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
      } else setProfileError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [selected?.id, selected?.customerId, selected?.assignmentId, selected?.ownerAdminId, selectedUnbound, conversationsAvailable, qualificationUnknown, authEpoch, snapshotRevision, profileRetry, canReviewAll, adminId, leaveUnavailableConversation]);

  const select = (conversationNo: string, commandKey = "", source?: string) => {
    setChosenCommand(commandKey);
    setContinuationFrom(source ? { source, destination: conversationNo } : null);
    setMessageOpening(value => value + 1);
    clearAttachment(pending?.kind !== "IMAGE"); setContinuation(null); setRequestedCustomerId(null); setScreen("chat"); setMaintenanceChosen(false); setReadError(""); setSendError("");
    const url = new URL(window.location.href); url.searchParams.delete("customerId"); url.searchParams.set("conversationNo", conversationNo); window.history.replaceState(null, "", url);
  };

  // A POST can finish after this composer unmounts. Update the original slot on disk
  // and notify whichever M3 instance currently owns the on-screen drafts.
  const clearSubmittedDraft = (slot: string, body: string, originalDraft?: string, legacyAssignment?: string) => {
    if (useAdminAuth.getState().session?.adminId !== adminId) return;
    try {
      const storageKey = `nexion-m3-drafts:${adminId}`;
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
      sessionStorage.setItem(storageKey, JSON.stringify(withoutSubmittedDraft(saved, { slot, body, originalDraft, legacyAssignment })));
    } catch { setRecoveryError("草稿保存不可用；当前输入仍保留在此页面。"); }
    window.dispatchEvent(new CustomEvent("m3-draft-settled", { detail: { adminId, slot, body, originalDraft, legacyAssignment } }));
  };
  useLayoutEffect(() => {
    const settled = (event: Event) => {
      const sent = (event as CustomEvent<SettledDraft & { adminId: number }>).detail;
      if (sent.adminId !== adminId) return;
      setDrafts(previous => withoutSubmittedDraft(previous, sent));
    };
    const restore = (event: Event) => {
      const { adminId: owner, slot, body, legacy } = (event as CustomEvent<{ adminId: number; slot: string; body: string; legacy?: string }>).detail;
      if (owner === adminId) setDrafts(old => {
        const next = { ...old, [slot]: old[slot] || body };
        if (legacy && old[legacy] === body) delete next[legacy];
        return next;
      });
    };
    window.addEventListener("m3-draft-settled", settled);
    window.addEventListener("m3-draft-restored", restore);
    return () => {
      window.removeEventListener("m3-draft-settled", settled);
      window.removeEventListener("m3-draft-restored", restore);
    };
  }, [adminId]);

  const closeRefusedText = (key: string, customerId?: string) => {
    const entry = readSavedSends(adminId).find(item => item.row.commandKey === key);
    const original = entry?.first ?? entry?.reply;
    if (!entry || !original || entry.reply?.kind === "IMAGE") return;
    const copy = closeFailedDraft(adminId, key, customerId);
    if (copy && !entry.dock && !entry.reply?.draftDetached) clearSubmittedDraft(original.draftSlot ?? entry.reply?.conversationId ?? `first:${customerId}`, original.body, original.originalDraft, original.draftSlot ? undefined : entry.first?.assignmentId ?? entry.reply?.expectedAssignmentId);
  };

  const querySavedSend = async (entry: SavedSend) => {
    const { row, locator, reply, first } = entry;
    const customerId = originalCustomer(locator);
    const result = await querySupportMessage(row.commandKey, customerId, locator.conversationId);
    if (result.status === "REJECTED" && (!customerId || !locator.clientMessageId
      || result.customerId !== customerId || result.idempotencyKey !== row.commandKey || result.clientMessageId !== locator.clientMessageId
      || result.operation !== (locator.conversationId ? "M3_CONVERSATION_REPLY" : "M3_CONVERSATION_INITIATE"))) {
      throw new SupportClientError(409, 409, "SUPPORT_COMMAND_RESULT_INVALID");
    }
    if (result.status === "SUCCEEDED" || result.status === "FAILED" || result.status === "REJECTED") {
      if (useAdminAuth.getState().session?.adminId !== adminId) return result;
      if (result.status === "REJECTED" && (result.businessCode === 409 && result.businessReason === "SUPPORT_ASSIGNMENT_CHANGED"
        || result.businessCode === 404 && result.businessReason === "SUPPORT_CUSTOMER_NOT_FOUND"
        || result.businessCode === 403 && result.businessReason === "SUPPORT_WRITE_FORBIDDEN")) {
        ctx.invalidateScope(locator.conversationId, customerId, undefined, row.commandKey);
        forgetSavedSend(row.fingerprint, row.commandKey);
        return result;
      }
      const original = reply ?? first;
      if (result.status !== "SUCCEEDED") closeRefusedText(row.commandKey, customerId);
      let authorizedDraft = Boolean(result.status === "SUCCEEDED" && mounted.current && verifiedKeys.current?.has(row.commandKey));
      if (result.status !== "SUCCEEDED" && reply?.attachmentId && attachmentRef.current?.id === reply.attachmentId && customerId) {
        try {
          const detail = await supportClient.customerDetail(customerId);
          if (useAdminAuth.getState().session?.adminId !== adminId) return result;
          authorizedDraft = detail.customerId === customerId && detail.assignmentId === reply.expectedAssignmentId && (canReviewAll || detail.agentAdminId === adminId);
          if (!authorizedDraft) ctx.invalidateScope(reply.conversationId, customerId, undefined, row.commandKey);
        } catch (cause) {
          if (useAdminAuth.getState().session?.adminId !== adminId) return result;
          authorizedDraft = false;
          if (isSupportScopeDenial(cause)) ctx.invalidateScope(reply.conversationId, customerId);
        }
      }
      if (useAdminAuth.getState().session?.adminId !== adminId) return result;
      if (!authorizedDraft && reply && originalView() && selected?.id === reply.conversationId) {
        if (reply.attachmentId && attachmentRef.current?.id === reply.attachmentId) clearAttachment(false);
        if (reply.kind === "SKU" || reply.kind === "LINK") setContentChoice(null);
      }
      if (original && !entry.dock && reply?.kind !== "IMAGE" && !reply?.draftDetached && result.status === "SUCCEEDED") {
        clearSubmittedDraft(original.draftSlot ?? reply?.conversationId ?? `first:${customerId}`, original.body, original.originalDraft, original.draftSlot ? undefined : first?.assignmentId ?? reply?.expectedAssignmentId);
      }
      if (reply?.attachmentId) {
        if (result.status === "SUCCEEDED" && attachmentRef.current?.id === reply.attachmentId) clearAttachment(false);
        if (result.status !== "SUCCEEDED" && attachmentRef.current?.id !== reply.attachmentId) {
          void supportClient.cancelAttachment(reply.attachmentId, newKey()).catch(() => undefined);
        }
      }
      forgetSavedSend(row.fingerprint, row.commandKey);
    }
    return result;
  };
  const queryRecovery = (entry: SavedSend) => runCustomerCommand(originalCustomer(entry.locator) ?? entry.row.commandKey, entry.row.commandKey, async () => {
    const identity = identityRef.current;
    setRecoveryError("");
    try {
      const result = await querySavedSend(entry);
      if (identityRef.current !== identity || !mounted.current) return;
      setRecoveryError(result.status === "SUCCEEDED" ? "查到了：这条消息已经发出。" : result.status === "REJECTED" || result.status === "FAILED"
        ? `查到了：这条消息没发出。${result.status === "REJECTED" && ADMIN_ERROR_MESSAGES[result.businessReason] ? `原因：${ADMIN_ERROR_MESSAGES[result.businessReason]}` : ""}` : MESSAGE_STILL_UNKNOWN);
    } catch (cause) { if (identityRef.current === identity) setRecoveryError(`查询没有成功：${displayAdminError(cause)} 记录继续保留，没有重新发送。`); }
  });
  // Decision M-C23: a new maintenance message goes out only while the customer is due. What the page read earlier can be stale, so ask once more. Original commands are not rechecked.
  const maintenanceStillDue = async (customerId: string) => {
    const identity = identityRef.current;
    try {
      const current = await supportClient.customerDetail(customerId);
      if (identityRef.current !== identity) return false;
      if (current.due === true) return true;
      if (!originalView()) return false;
      setMaintenanceChosen(false);
      if (selected) setProfileDetail({ ...current, revision: snapshotRevision }); else setFirstDetail({ ...current, revision: snapshotRevision });
      setSendError("这位客户的维护已经不到期了，这条没发出，原文已保留；可以改作服务回复发送。");
    } catch (cause) {
      if (identityRef.current === identity) setSendError(`暂时查不到维护是否到期：${displayAdminError(cause)} 这条没发出，原文已保留。`);
    }
    return false;
  };
  const forgetSavedSend = (slot: string, key: string) => {
    if (useAdminAuth.getState().session?.adminId !== adminId) return;
    sendJournal(slot).forget(slot, key);
    if (!slot.startsWith("dock|") && slot !== recoveryKey(adminId, key)) pendingMessages.forget(recoveryKey(adminId, key), key);
  };
  const sendRetryExpired = Boolean(activeEntry && isRetryExpired(activeEntry.row));
  const refreshChangedPeer = async (identity: string) => {
    if (!originalView()) return;
    if (selected) messagePages.invalidateWriteState(selected.id);
    try {
      followSelection.current = true;
      await ctx.refreshConversations();
      if (identityRef.current !== identity || !originalView()) return;
      setContinuation(null);
      setDetailRetry(value => value + 1); setProfileRetry(value => value + 1);
      await messagePages.refresh();
    } catch (cause) {
      if (identityRef.current === identity) setActionError(displayAdminError(cause));
    }
  };
  const send = (kind: Pending["kind"], recovery?: "query" | "retry") => {
    if (!targetCustomer || Boolean(recovery) !== Boolean(activeEntry) || recovery === "retry" && !canRetryActiveSend) return;
    return runCustomerCommand(targetCustomer, activeKey, flight => sendMessage(kind, recovery, flight));
  };
  const sendMessage = async (kind: Pending["kind"], recovery: "query" | "retry" | undefined, flight: SendFlight) => {
    const sameAccount = () => useAdminAuth.getState().session?.adminId === adminId;
    const currentPage = () => sameAccount() && useAdminAuth.getState().authEpoch === authEpoch && mounted.current && identityRef.current === identity;
    const mayCapture = () => currentPage() && !!targetCustomer
      && !blocksNewSend(pendingSendCustomers(adminId, visible), targetCustomer);

    const retry = recovery ? pending : undefined;
    const retryFirst = recovery ? firstPending : undefined;
    const identity = identityRef.current;
    flight.newSubmission = !recovery;
    if (activeEntry && recovery) {
      setSendError("");
      try {
        const result = await querySavedSend(activeEntry);
        if (identityRef.current !== identity || !mounted.current) return;
        if (result.status === "FAILED" || result.status === "REJECTED") {
          const reason = result.status === "REJECTED" ? ADMIN_ERROR_MESSAGES[result.businessReason] : undefined;
          setSendError(`${activeEntry.reply?.kind === "IMAGE" ? MESSAGE_FAILED_IMAGE : activeEntry.dock || !verifiedKeys.current?.has(activeEntry.row.commandKey) ? MESSAGE_FAILED_UNCHECKED : MESSAGE_FAILED}${reason ? `原因：${reason}` : ""}`);
          return;
        }
        if (result.status !== "SUCCEEDED") { setSendError(MESSAGE_STILL_UNKNOWN); return; }
        if (originalView()) {
          setMaintenanceChosen(false); setSelectedClosedIds(new Set()); setContentChoice(null);
          setProfileDetail(null); setProfileRetry(value => value + 1); setHoldRetry(value => value + 1);
        }
        window.dispatchEvent(new Event("support-todo-changed"));
        try {
          await ctx.refreshConversations();
          if (!currentPage()) return;
          if (firstPending && targetCustomer && activeCustomerRef.current === targetCustomer) {
            const receipt = result.result;
            if (receipt && typeof receipt === "object" && "conversationNo" in receipt && typeof receipt.conversationNo === "string") {
              if (originalView() || activeConversationRef.current === receipt.conversationNo) {
                setSendFeedback({ customer: targetCustomer, conversationId: receipt.conversationNo,
                  firstContactIdentity: identity, text: "原消息已发送，记录已解除，不要再发一次。" });
                if (originalView()) {
                  setContinuation(null);
                  followSelection.current = true;
                  setRequestedCustomerId(null);
                  const url = new URL(window.location.href);
                  url.searchParams.delete("customerId"); url.searchParams.set("conversationNo", receipt.conversationNo);
                  window.history.replaceState(null, "", url);
                }
                return;
              }
            }
          }
          setSendError("原消息已发送，记录已解除，不要再发一次。");
        } catch {
          if (identityRef.current === identity) setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。");
        }
        return;
      } catch (cause) {
        if (identityRef.current !== identity || !mounted.current) return;
        const notFound = cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND";
        if (!notFound || recovery !== "retry" || isRetryExpired(activeEntry.row)) {
          setSendError(notFound
            ? !canRetryActiveSend ? "没查到这条消息，记录继续保留，没有重新发送。"
              : `没查到这条消息，记录继续保留，没有重新发送；${isRetryExpired(activeEntry.row) ? "已超过 24 小时，到操作记录与审批核对。" : "24 小时内可以按原操作重试，不会重复发送。"}`
            : `查询没有成功：${displayAdminError(cause)} 记录继续保留，没有重新发送。`);
          return;
        }
      }
      if (!originalView() || !retryAuthority.current.writeAuthorized || !targetCustomer) return;
      try {
        const hold = await supportClient.sessionHold(targetCustomer);
        if (!originalView() || !currentPage()) return;
        if (hold.state === "OTHER") { lockFromBusy(targetCustomer, hold); return; }
      } catch (cause) {
        if (originalView() && currentPage()) setSendError(displayAdminError(cause));
        return;
      }
      const authority = retryAuthority.current;
      if (isRetryExpired(activeEntry.row) || !originalView() || !authority.writeAuthorized || authority.activeKey !== activeEntry.row.commandKey || !verifiedKeys.current?.has(activeEntry.row.commandKey) || authority.assignment !== (retryFirst?.assignmentId ?? retry?.expectedAssignmentId)) {
        setSendError("没查到原消息；先刷新会话、核对归属，再按原操作重试。");
        return;
      }
    }
    if (!conversationsAvailable || !recovery && recoveryBlocksTarget) return;
    const text = retryFirst?.body ?? retry?.body ?? draft.trim();
    if (!recovery && kind !== "IMAGE" && text.length > SUPPORT_MESSAGE_MAX_LENGTH) { setSendError(ADMIN_ERROR_MESSAGES.REPLY_BODY_TOO_LONG); return; }
    sendAdminTyping(false);
    if (retry && retry.conversationId !== selected?.id) return;
    if (retryFirst || !selected) {
      const customerId = retryFirst?.customerId ?? requestedCustomerId;
      if (kind !== "TEXT" || !validCustomerId(customerId) || (!retryFirst && (!writable || !closedCandidatesReady || !firstDetail?.assignmentId))) return;
      if (!(retryFirst?.body ?? draft.trim())) return;
      if (!retryFirst && intent === "MAINTENANCE") {
        setSendError("");
        const due = await maintenanceStillDue(customerId);
        if (!due) return;
      }
      if (!retryFirst && !mayCapture()) return;
      const record = retryFirst ?? { key: newKey(), clientMessageId: crypto.randomUUID(), body: draft.trim(), draftSlot: targetKey, originalDraft: draft !== draft.trim() ? draft : undefined, intent, customerId, assignmentId: firstDetail!.assignmentId!, version: firstDetail!.version, replyTargets: closedReplyTargets };
      const slot = firstPendingKey(adminId, record.customerId);
      flight.commandKey = record.key;
      const stored = retryFirst ? pendingMessages.isDurablyStored(slot, record.key) : rememberPending(slot, record.key, record);
      if (!stored) { if (!retryFirst) pendingMessages.forget(slot, record.key); setSendError("浏览器无法保存这次发送的记录，消息还没发出；请检查浏览器设置后重试。"); return; }
      setSendError("");
      let conversationNo: string;
      try {
        ({ conversationNo } = await supportClient.startConversation({ customerId: record.customerId, openingText: record.body, intent: record.intent, clientMessageId: record.clientMessageId, expectedAssignmentId: record.assignmentId, expectedVersion: record.version, replyTargets: record.replyTargets }, record.key));
      } catch (cause) {
        if (!sameAccount()) return;
        if (supportAssignmentChanged(cause)) {
          ctx.invalidateScope(undefined, customerId, "消息没有发出：这位客户已不归你接待，原文已清除。", record.key);
          forgetSavedSend(slot, record.key);
          return;
        }
        const refused = refusedMessage(cause, !retryFirst);
        const busyHold = supportSessionBusy(cause);
        if (refused || busyHold) {
          if (!isSupportScopeDenial(cause)) closeRefusedText(record.key, customerId);
          forgetSavedSend(slot, record.key);
        }
        if (lostPermission(cause)) {
          ctx.invalidateScope(undefined, customerId, refused ? "消息没有发出：你已不能接待这位客户，原文已清除。" : "消息发送结果未知：你已不能接待这位客户，原文已清除，只能查询结果。");
          return;
        }
        if (!currentPage()) return;
        if (refused && conversationPeerChanged(cause) && activeCustomerRef.current === record.customerId
          && (originalView() || new URLSearchParams(window.location.search).get("customerId") === record.customerId)) {
          setSendFeedback({ customer: record.customerId, firstContactIdentity: identity, text: PEER_CHANGED_SEND_REFUSAL });
        }
        if (!originalView()) return;
        if (conversationPeerChanged(cause)) {
          if (!refused) setSendError(MESSAGE_UNKNOWN);
          await refreshChangedPeer(identity);
        } else if (busyHold) lockFromBusy(customerId, busyHold);
        else if (refused) { setDetailRetry(value => value + 1); setSendError(`本次发送已被拒绝：${displayAdminError(cause)} 原文已保留，请核对客户归属后修改重发。`); }
        else setSendError(MESSAGE_UNKNOWN);
        return;
      }
      if (!sameAccount()) return;
      clearSubmittedDraft(record.draftSlot ?? `first:${record.customerId}`, record.body, record.originalDraft, record.draftSlot ? undefined : record.assignmentId);
      forgetSavedSend(slot, record.key);
      window.dispatchEvent(new Event("support-todo-changed"));
      if (!currentPage()) return;
      let refreshFailed = false;
      try { await ctx.refreshConversations(); }
      catch { refreshFailed = true; setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
      if (!currentPage() || !originalView()) return;
      setContinuation(null); setHoldRetry((value) => value + 1);
      if (conversationNo && !refreshFailed) {
        // Open the inbox scope by the new conversation's actual owner (a supervisor may be on 「我的客户」 or 「负责组的客户」).
        followSelection.current = true;
        setRequestedCustomerId(null);
      }
      if (!refreshFailed) { const url = new URL(window.location.href); url.searchParams.delete("customerId"); if(conversationNo)url.searchParams.set("conversationNo",conversationNo); window.history.replaceState(null, "", url); }
      setScreen("chat");
      return;
    }
    if (!retry && (!writable || !currentProfileDetail?.assignmentId)) return;
    const body = retry?.body ?? (kind === "IMAGE" ? "" : draft.trim());
    const attachmentId = retry?.attachmentId ?? (kind === "IMAGE" ? attachment?.id : undefined);
    if (kind !== "IMAGE" && !body || kind === "IMAGE" && !attachmentId || !retry && (kind==="SKU"||kind==="LINK") && contentChoice?.kind!==kind) return;
    if (attachmentId) flight.image = { id: attachmentId, outcome: retry ? "submitted" : "unused" };
    const currentVersion = selected.version;
    const currentStatus = selected.status.toUpperCase();
    if (identityRef.current !== identity) return;
    if (!retry && intent === "MAINTENANCE" && !await maintenanceStillDue(String(selected.customerId))) return;
    if (!retry && !mayCapture()) return;
    const record = retry ?? (() => {
      const replyTargets = [
        ...(currentReplyTarget && (intent === "SERVICE" || includeCurrentReply) ? [currentReplyTarget] : []),
        ...closedReplyTargets,
      ];
      const message: SessionMsg = { ts: Date.now(), sender: "agent", agentName: session?.operator || session?.username || selected.owner, text: body, kind, attachmentId, skuId:kind==="SKU"&&contentChoice?.kind==="SKU"?contentChoice.skuId:undefined, linkTarget:kind==="LINK"&&contentChoice?.kind==="LINK"?contentChoice.linkTarget:undefined, intent, clientMessageId: crypto.randomUUID(), replyTargets: replyTargets.length ? replyTargets : undefined };
      return { conversationId: selected.id, customerId: customerIdOf(selected), key: newKey(), body, draftSlot: targetKey, draftDetached: kind !== "IMAGE", originalDraft: kind !== "IMAGE" && draft !== body ? draft : undefined, intent, kind, attachmentId, message, expectedAssignmentId: currentProfileDetail!.assignmentId!, expectedStatus: currentStatus, expectedVersion: currentVersion };
    })();
    const slot = retry ? activeEntry!.row.fingerprint : replySlot(adminId, customerIdOf(selected));
    flight.commandKey = record.key;
    const stored = retry ? sendJournal(slot).isDurablyStored(slot, record.key) : rememberPending(slot, record.key, record);
    if (!stored) { if (!retry) pendingMessages.forget(slot, record.key); setSendError("浏览器无法保存这次发送的记录，消息还没发出；请检查浏览器设置后重试。"); return; }
    setSendError("");
    if (!retry && record.draftDetached) clearSubmittedDraft(targetKey, record.body, record.originalDraft);
    let receipt: Awaited<ReturnType<typeof supportClient.sendConversationReply>>;
    const input = activeEntry?.dockInput ?? { kind: record.kind, content: record.kind !== "IMAGE" ? record.body : undefined, attachmentId: record.attachmentId, skuId: record.message.skuId, linkTarget: record.message.linkTarget, intent: record.intent, clientMessageId: record.message.clientMessageId!, replyTargets: record.message.replyTargets, expectedAssignmentId: record.expectedAssignmentId, expectedStatus: record.expectedStatus ?? "OPEN", expectedVersion: record.expectedVersion };
    try {
      if (flight.image) flight.image.outcome = "submitted";
      receipt = await supportClient.sendConversationReply(record.conversationId, input, record.key);
      if (flight.image) flight.image.outcome = "sent";
    } catch (cause) {
      if (!sameAccount()) return;
      if (supportAssignmentChanged(cause)) {
        if (flight.image) flight.image.outcome = "unused";
        ctx.invalidateScope(record.conversationId, String(selected.customerId), "消息没有发出：这位客户已不归你接待，原文已清除。", record.key);
        forgetSavedSend(slot, record.key);
        return;
      }
      const refused = refusedMessage(cause, !retry);
      const busyHold = supportSessionBusy(cause);
      if (refused || busyHold) {
        if (flight.image) flight.image.outcome = "unused";
        if (!isSupportScopeDenial(cause)) closeRefusedText(record.key, String(selected.customerId));
        forgetSavedSend(slot, record.key);
      }
      if (lostPermission(cause)) {
        ctx.invalidateScope(record.conversationId, String(selected.customerId), refused ? "消息没有发出：你已不能接待这位客户，原文已清除。" : "消息发送结果未知：你已不能接待这位客户，原文已清除，只能查询结果。");
        return;
      }
      if (!currentPage() || !originalView()) return;
      if (conversationPeerChanged(cause)) {
        setSendError(refused ? PEER_CHANGED_SEND_REFUSAL : MESSAGE_UNKNOWN);
        await refreshChangedPeer(identity);
      } else if (busyHold) lockFromBusy(String(selected.customerId), busyHold);
      else if (refused) {
        void ctx.refreshConversations().catch(() => {});
        setSendError(`本次发送已被拒绝：${displayAdminError(cause)} 原文已保留，请核对会话后修改重发。`);
      } else setSendError(MESSAGE_UNKNOWN);
      return;
    }
    if (!sameAccount()) return;
    if (!activeEntry?.dock && record.kind !== "IMAGE" && !record.draftDetached) clearSubmittedDraft(record.draftSlot ?? record.conversationId, record.body, record.originalDraft, record.draftSlot ? undefined : record.expectedAssignmentId);
    forgetSavedSend(slot, record.key);
    window.dispatchEvent(new Event("support-todo-changed"));
    if (!currentPage()) return;
    ctx.refreshConversation(record.conversationId, receipt.conversation);
    if (activeCustomerRef.current === record.customerId && (record.intent === "MAINTENANCE" || actsAsAdvisor && currentProfileDetail?.firstContact)) {
      setProfileRetry(value => value + 1);
    }
    if (!originalView()) return;
    setMaintenanceChosen(false); setSelectedClosedIds(new Set());
    setContentChoice(null);
    refocusComposer.current = true;
  };

  const chooseImage = async (file: File | undefined) => {
    const selection = ++imageSelectionRef.current;
    if (!file || !writable || busy || activeEntry) return;
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
        ctx.invalidateScope(selected.id, String(selected.customerId), "图片没有上传：你已不能接待这位客户。"); setSendError("当前已无权上传该客户图片，请返回客户列表刷新。");
      } else setAttachment({ ...current, state: "error", error: displayAdminError(cause) });
    } finally { if (uploadControllerRef.current === controller) uploadControllerRef.current = null; }
  };

  const [convRetrying, setConvRetrying] = useState(false), [convError, setConvError] = useState(""), [convDenied, setConvDenied] = useState(false);
  const retryConversations = async () => {
    setConvRetrying(true); setConvError(""); setConvDenied(false);
    try { await ctx.refreshConversations(); }
    catch (cause) { setConvError(displayAdminReadError(cause)); setConvDenied((cause as { status?: number }).status === 403); }
    finally { setConvRetrying(false); }
  };
  useEffect(() => { if (conversationsAvailable) { setConvError(""); setConvDenied(false); } }, [conversationsAvailable]);
  // 会话列表自己被拒（读权被收回）也是没有权限，不是加载失败（ST-38、ST-39）。
  const readDenied = scopeDenied || !conversationsAvailable && (convDenied || ctx.pget("I.session.conversationsDenied") === "1");
  const serviceStatus = !conversationsAvailable ? "会话服务暂不可用，请检查连接后重试。" : lostAccess ? "当前会话权限已变化，请刷新列表。" : "";
  const title = userNicknameText(selected?.customer || selected?.profile?.nickname || (selected?.customerId ? `客户 ${selected.customerId}` : firstDetail?.displayName || (requestedCustomerIdValid && requestedCustomerId ? `客户 ${requestedCustomerId}` : "会话消息")), selected?.profile?.phone);
  const checkActionReady = async (conversation: SessionConvo) => {
    if (!conversation.customerId || actionChecking) return false;
    const requestStamp=identityRef.current;
    setActionChecking(true); setActionError("");
    try {
      const detail = await supportClient.customerDetail(String(conversation.customerId));
      if(requestStamp!==identityRef.current)return false;
      if (detail.agentAdminId !== adminId || !detail.assignmentId) { ctx.invalidateScope(conversation.id, String(conversation.customerId), "这次操作没有执行：这位客户的归属变了。请回客户列表核对。"); setActionError("客户归属已变化，请刷新会话后重试。"); return false; }
      if(conversation.id===activeConversationRef.current)setProfileDetail({ ...detail, revision: snapshotRevision });
      // waitingReply aggregates all customer history. The backend checks pending
      // replies for each selected conversation together with its versioned write.
      return true;
    } catch (cause) { if(requestStamp!==identityRef.current)return false; if (lostPermission(cause)) { ctx.invalidateScope(conversation.id, String(conversation.customerId), "这次操作没有执行：你对这位客户的权限变了。请回客户列表核对。"); } setActionError(`客户归属暂时无法核对：${displayAdminError(cause)} 请重试。`); return false; }
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
      detail: "这段会话变成已解决，接待随之结束。客户再发消息，对话会重新打开，专属客服不变。",
      statedBrief: { impact: "这段会话变成已解决，接待随之结束。客户再发消息，对话会重新打开，专属客服不变。", check: "确认客户的问题处理完了，理由写清依据或工单号。" },
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
  const continueClosed = async () => {
    if (!canWriteM3 || !selected?.detailReady || !selected.customerId || actionChecking) return;
    const stamp = identityRef.current;
    const sourceKey = selected.id;
    checkingContinuation.current = sourceKey;
    setActionChecking(true); setActionError("");
    try {
      const next = await resolveMConversationContinuation(sourceKey, adminId);
      if (stamp !== identityRef.current || !originalView()) return;
      if (next.conversationNo && !visible.some(convo => convo.id === next.conversationNo)) await ctx.refreshConversations();
      if (stamp !== identityRef.current || !originalView()) return;
      if (next.conversationNo) {
        select(next.conversationNo, "", sourceKey);
        return;
      }
      setContinuationFrom({ source: sourceKey, destination: `first:${next.customerId}` });
      setContinuation(next);
      const url = new URL(window.location.href); url.searchParams.delete("conversationNo"); url.searchParams.set("customerId", next.customerId); window.history.replaceState(null, "", url);
      setRequestedCustomerId(next.customerId);
      setScreen("chat");
    } catch (cause) {
      if (supportCustomerNotFound(cause)) {
        if (mounted.current && useAdminAuth.getState().authEpoch === authEpoch) {
          leaveUnavailableConversation(sourceKey, selected.customerId, CONTINUATION_REASSIGNED);
        }
        return;
      }
      if (stamp !== identityRef.current) return;
      if (conversationPeerChanged(cause) || cause instanceof Error && cause.message === "CONVERSATION_PEER_CHANGED") {
        await refreshChangedPeer(stamp);
        if (stamp === identityRef.current) setActionError(CONTINUATION_REASSIGNED);
      } else setActionError(displayAdminError(cause));
    } finally {
      if (checkingContinuation.current === sourceKey) checkingContinuation.current = null;
      if (stamp === identityRef.current) setActionChecking(false);
    }
  };

  const endPending = Boolean(holdEndCommand && holdEndCommand.customerId === holdCustomer);
  // The ref contains the UTC started_at (SupportReceptionMapper.receive). Only an expired legacy
  // intent followed by a demonstrably later reception can coexist with a new, independently bound intent.
  const laterReception = Boolean(holdEndCommand && !holdEndCommand.sessionRef && isRetryExpired(holdEndCommand)
    && hold?.state === "MINE" && hold.sessionRef
    && Date.parse(`${hold.sessionRef.slice(hold.sessionRef.indexOf(":") + 1)}Z`) > holdEndCommand.createdAt);
  const mayEndLaterReception = Boolean(holdEndCommand?.sessionRef && hold?.sessionRef && holdEndCommand.sessionRef !== hold.sessionRef)
    || laterReception && legacyEndChecked === holdEndCommand?.commandKey;
  const endHold = async (queryOriginal = false, original?: SessionEndRecord) => {
    if (!holdCustomer || holdEnding || hold?.state !== "MINE" && !endPending && !original
      || original && (original.actorId !== adminId || original.customerId !== holdCustomer)) return;
    const stamp = identityRef.current;
    let command = original ?? (endPending && (queryOriginal || !mayEndLaterReception) ? holdEndCommand! : null);
    command ??= sessionEndCommands.list().find(row => row.actorId === adminId && row.customerId === holdCustomer
      && !!row.sessionRef && row.sessionRef === hold?.sessionRef) ?? null;
    const recovering = Boolean(command);
    if (!command && !hold?.sessionRef) { setActionError("还没读到这次接待的信息，请刷新接待状态后再结束会话。"); setHoldRetry(value => value + 1); return; }
    const fingerprint = `session-end:${adminId}:${holdCustomer}:${hold?.sessionRef}`;
    if (!command) {
      const commandKey = newKey();
      sessionEndCommands.remember(fingerprint, commandKey, { actorId: adminId, customerId: holdCustomer, sessionRef: hold!.sessionRef! });
      if (!sessionEndCommands.isDurablyStored(fingerprint, commandKey)) { sessionEndCommands.forget(fingerprint, commandKey); setActionError("浏览器无法保存这次操作的记录，还没结束会话；请检查浏览器设置后重试。"); return; }
      command = sessionEndCommands.list().find(row => row.commandKey === commandKey)!;
    }
    const current = () => stamp === identityRef.current && holdEndView.current.customerId === command.customerId && holdEndView.current.commandKey === command.commandKey;
    const settle = (message = "") => {
      sessionEndCommands.forget(command.fingerprint, command.commandKey);
      if (holdEndView.current.customerId === command.customerId) setHoldEndCommands(readSessionEndRecords(command.actorId, command.customerId));
      const visible = current();
      setHoldEndCommand(previous => previous?.customerId === command.customerId && previous.commandKey === command.commandKey ? sessionEndCommands.list().find(row => row.actorId === adminId && row.customerId === command.customerId) ?? null : previous);
      if (visible) { setActionError(message); setActionResult(""); setHoldRetry((value) => value + 1); setHoldEnding(false); }
    };
    holdEndView.current = { customerId: command.customerId, commandKey: command.commandKey };
    setHoldEndCommand(command); setHoldEndCommands(readSessionEndRecords(adminId, holdCustomer)); setHoldEnding(true); setActionError(""); setActionResult("");
    let submitted = false;
    try {
      // A number already sent is checked first; only a number the system never received goes out again, unchanged.
      const receipt = recovering ? await supportClient.command(command.commandKey).catch((cause: unknown) => { if (cause instanceof SupportClientError && cause.status === 404 && cause.backendMessage === "SUPPORT_COMMAND_NOT_FOUND") return null; throw cause; }) : null;
      if (stamp !== identityRef.current) return;
      if (receipt?.status === "SUCCEEDED") { settle(); return; }
      if (receipt?.status === "FAILED") { settle("原操作没有结束会话，请确认后再点一次。"); return; }
      if (receipt) { if (current()) setActionResult("结束会话的结果还没出来，请稍后再查。"); return; }
      if (recovering && !command.sessionRef) {
        if (current()) {
          setLegacyEndChecked(command.commandKey);
          setActionResult(laterReception ? "原操作查不到结果，原记录继续保留，不会重发。现在是新的一次接待，再点「结束会话」只结束这一次。" : "上次结束请求没记下是哪一次接待，不能重发，也不算到这次接待上；原记录继续保留，请稍后再查。");
        }
        return;
      }
      if (queryOriginal) { if (current()) setActionResult(isRetryExpired(command) ? `原操作查不到结果；${RETRY_EXPIRED_TEXT}` : "原操作查不到结果，原记录继续保留，没有重发。"); return; }
      if (recovering && isRetryExpired(command)) { if (current()) setActionResult(`${RETRY_EXPIRED_TEXT}`); return; }
      if (command.rejection) {
        sessionEndCommands.remember(command.fingerprint, command.commandKey, { ...command, rejection: undefined });
        const commandKey = command.commandKey;
        const saved = sessionEndCommands.list().find(row => row.commandKey === commandKey);
        setHoldEndCommand(saved ?? command); setHoldEndCommands(readSessionEndRecords(adminId, holdCustomer));
        if (!saved || saved.rejection || !sessionEndCommands.isDurablyStored(command.fingerprint, command.commandKey)) { setActionError("浏览器无法保存这次操作的记录，还没结束会话；请检查浏览器设置后重试。"); return; }
      }
      submitted = true;
      await supportClient.endSessionHold(command.customerId, command.commandKey, command.sessionRef!);
      if (stamp === identityRef.current) settle();
    } catch (cause) {
      if (stamp !== identityRef.current) return;
      if (submitted && cause instanceof SupportClientError && rejectedSupportWrite(cause)) {
        sessionEndCommands.remember(command.fingerprint, command.commandKey, { ...command, rejection: { status: cause.status, backendMessage: cause.backendMessage! } });
        if (current()) { const saved = readSessionEndRecords(adminId, command.customerId); setHoldEndCommands(saved); setHoldEndCommand(saved.find(row => row.commandKey === command.commandKey) ?? command); setActionError(recovering ? `重试被拒绝：${displayAdminError(cause).replace(/[。.]$/, "")}。原来那次可能已经结束了。` : `结束会话被拒绝：${displayAdminError(cause).replace(/[。.]$/, "")}。这次没有结束。`); if (cause.backendMessage === "SUPPORT_SESSION_CHANGED") setHoldRetry(value => value + 1); }
      }
      else if (current()) setHoldRetry((value) => value + 1);
    } finally { if (current()) setHoldEnding(false); }
  };
  const querySessionEndRecord = (record: SessionEndRecord) => endHold(true, record);
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
      ctx.openActionConfirm({action:"归档客户对话",briefKind:"conversation",detail:"归档此客户的全部历史会话。未处理的客户消息不能归档。",statedBrief:{impact:`这位客户的 ${members.length} 段会话从收件箱收起，消息和专属客服都不变。客户再发消息，对话会自动回到收件箱。`,check:"核对客户，有未回复的消息不能归档，理由写清依据或工单号。"},facts:<Facts><Fact k="客户">{title}</Fact><Fact k="会话数">{members.length} 段</Fact></Facts>,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:"确认归档",reasonMin:8,reasonMax:200,run:reason=>confirmWrite("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"归档客户对话",reason,commandKey},stamp)});
      return;
    }
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:conversation.archived?"撤销归档":"归档会话",briefKind:"conversation",detail:`会话 ${conversation.id}；只是从列表里归档，会话、消息和归属都不变。`,statedBrief:{impact:conversation.archived?"这段会话回到收件箱，消息和专属客服都不变。":"这段会话从收件箱收起，消息和专属客服都不变。客户再发消息，对话会自动回到收件箱。",check:"核对客户和会话，理由写清依据或工单号。"},facts:<Facts><Fact k="客户">{title}</Fact><Fact k="会话编号"><span data-mono="">{conversation.id}</span></Fact></Facts>,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:conversation.archived?"确认撤销归档":"确认归档",blockedReason:ctx.commandExpired(`m3:archive:${conversation.id}:`)?RETRY_EXPIRED_TEXT:undefined,reasonMin:8,reasonMax:200,run:reason=>confirmWrite(CONVO_KEY,JSON.stringify(all.map(c=>c.id===conversation.id?{...c,archived:!conversation.archived}:c)),{action:"修改会话归档",reason,commandKey:`m3:archive:${conversation.id}:${conversation.version}:${!conversation.archived}`},requestStamp)});
  };
  const archiveBatch = async () => {
    if(!archiveIds.size||actionChecking)return;
    const selectedCustomers=customerRows.filter(row=>archiveIds.has(row.id));
    const lockedCustomers = pendingSendCustomers(adminId, visible);
    if (selectedCustomers.some(row => blocksNewSend(lockedCustomers, customerIdOf(row)))) { setActionError(MESSAGE_UNKNOWN); return; }
    const chosen=visible.filter(c=>selectedCustomers.some(row=>row.customerId===c.customerId)&&!c.archived&&c.ownerAdminId===adminId);
    if(selectedCustomers.length!==archiveIds.size){setActionError("所选会话范围已变化，请重新圈选。");return;}
    for(const c of chosen)if(!await checkActionReady(c))return;
    const payload={conversationNos:chosen.map(c=>c.id),expectedVersions:Object.fromEntries(chosen.map(c=>[c.id,c.version]))};
    const key=newKey();
    const requestStamp=identityRef.current;
    ctx.openActionConfirm({action:"批量归档",briefKind:"conversation",detail:`确认归档 ${new Set(chosen.map(customerIdOf)).size} 位客户的全部对话。未处理客户消息不能归档。`,statedBrief:{impact:`${new Set(chosen.map(customerIdOf)).size} 位客户的全部对话从收件箱收起，消息和专属客服都不变。客户再发消息，对话会自动回到收件箱。`,check:"核对名单，有未回复消息的客户不能归档，理由写清依据或工单号。"},facts:<RecordList label="归档客户" records={selectedCustomers.map(row => ({ id: customerIdOf(row), value: rowName(row), reference: `U${customerIdOf(row).padStart(8, "0")}` }))} />,effect:<StatusTag tone="progress" filled>立即生效</StatusTag>,confirmLabel:"确认批量归档",reasonMin:8,reasonMax:200,run:async reason=>{const ok=await confirmWrite("I.session.archiveBatch.__create",JSON.stringify(payload),{action:"批量归档已选会话",reason,commandKey:key},requestStamp);if(ok)setArchiveIds(new Set());return ok;}});
    setArchiveMode(false);
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
    if (typeof window !== "undefined") for (const key of ["nexion-admin-m3-private-pending-v1", "nexion-admin-m3-private-pending-v1:redacted", "nexion-admin-m3-timeout-pending-v1"]) {
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
    if (commands.some((saved) => JSON.stringify(saved) !== JSON.stringify(commands[0]))) throw new Error("浏览器里有两份不同的上次修改记录，暂时不能再改。");
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
      if (saved) { setTimeoutLatest(policy); setTimeoutInput(saved.input); setTimeoutError(savedRow && isRetryExpired(savedRow) ? RETRY_EXPIRED_TEXT : "上次保存结果未知，请先查询原结果。"); }
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
    try { if (readTimeoutCommand()) { setTimeoutError("上次保存结果未知，请先查询原结果。"); return false; } }
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
      pendingTimeoutPolicies.forget(timeoutSlot);
      if (stamp !== timeoutIdentityRef.current) return false;
      setActionResult("超时策略已保存。");
      const next = await fetchMConversationTimeoutPolicy();
      if (stamp !== timeoutIdentityRef.current) return false;
      setTimeoutPolicy(next); setTimeoutInput(undefined); pendingTimeoutPolicies.forget(timeoutSlot); return true;
    } catch (cause) {
      if (stamp !== timeoutIdentityRef.current || isSupportSessionExpired(cause)) return false;
      const status = cause instanceof SupportClientError ? (cause.status >= 200 && cause.status < 300 ? cause.apiCode : cause.status) : undefined;
      if (submitted) {
        setTimeoutPending(null); setTimeoutInput(undefined);
        setActionResult("超时策略已保存，但最新设置读取失败，请重新打开超时策略核对。");
        return true;
      } else if (cause instanceof SupportClientError && !cause.backendMessage?.startsWith("IDEMPOTENCY_") && isDeterministicRejection(cause.status, cause.apiCode)) {
        pendingTimeoutPolicies.forget(timeoutSlot);
        if (status === 403) await revokeTimeoutWrite(stamp);
        else if (status === 409 && cause.backendMessage === "M3_TIMEOUT_POLICY_STALE") { setTimeoutConflict(true); setTimeoutError("设置刚被别人改过，你填写的内容还在；请看最新设置后重新确认。"); await refreshTimeoutLatest(); }
        else setTimeoutError(displayAdminError(cause));
      } else { setTimeoutPending(command); setTimeoutError("保存结果未知，请查询原结果；不会重复提交。"); }
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
      if (result.status === "SUCCEEDED" && (result.businessCode == null || result.businessCode === 0)) {
        forgetTimeoutCommand(command); setTimeoutPending(null); setTimeoutInput(undefined); setTimeoutOpen(false);
        const processed = result.businessCode === 0 ? "超时策略已保存。" : businessResultUnavailableText("超时策略");
        setActionResult(processed);
        const policy = await fetchMConversationTimeoutPolicy().catch(cause => { if (stamp === timeoutIdentityRef.current) setActionResult(`${processed} ${displayAdminError(cause)}`); return null; });
        if (stamp !== timeoutIdentityRef.current) return;
        if (policy) setTimeoutPolicy(policy); setTimeoutError("");
      } else if (result.status === "SUCCEEDED" && result.businessCode != null && result.businessCode !== 0) {
        forgetTimeoutCommand(command); setTimeoutPending(null); setTimeoutPolicy(command.policy);
        setTimeoutConflict(result.businessReason === "M3_TIMEOUT_POLICY_STALE");
        setTimeoutError(result.businessReason ? displayAdminError(new Error(result.businessReason)) : "上次修改没有成功，你填写的内容还在；请看最新设置后再确认。");
        await refreshTimeoutLatest();
      } else if (result.status === "FAILED") {
        forgetTimeoutCommand(command); setTimeoutPending(null); setTimeoutPolicy(command.policy); setTimeoutConflict(true); setTimeoutError("上次修改没有成功，你填写的内容还在；请看最新设置后再确认。"); await refreshTimeoutLatest();
      } else setTimeoutError("结果仍未知，请稍后再查；原记录和输入已保留。");
    } catch (cause) {
      if (stamp !== timeoutIdentityRef.current) return;
      if (cause && typeof cause === "object" && "status" in cause && cause.status === 403) await revokeTimeoutWrite(stamp);
      else setTimeoutError("暂时查不到原结果；原记录和输入已保留。");
    } finally { if (stamp === timeoutIdentityRef.current) setTimeoutSaving(false); }
  };

  // 打开的客户在列表里要看得见（VS-74）。只动收件箱这一层滚动，页面不跟着动。
  useEffect(() => {
    const rows = rowsRef.current, row = rows?.querySelector<HTMLElement>(".m3s-row[data-on]");
    if (!rows || !row) return;
    const list = rows.getBoundingClientRect(), box = row.getBoundingClientRect();
    if (box.top < list.top) rows.scrollTop -= list.top - box.top;
    else if (box.bottom > list.bottom) rows.scrollTop += box.bottom - list.bottom;
  }, [selected?.id, listTab, query, listRows.length]);
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
  const otherScopeName = filterName ? "其他范围" : reviewing ? "我的客户" : (scopeMode === "ALL" ? "其他客户" : "组内其他客户");
  const rowName = (row: SessionConvo) => userNicknameText(row.customer || row.profile?.nickname || `客户 ${row.customerId}`, row.profile?.phone);
  const waitingHint = [
    unassignedCount ? `${unassignedCount} 位待分配专属客服` : "",
    otherScopeWaiting ? `${otherScopeName}还有 ${otherScopeWaiting} 位待回复` : "",
  ].filter(Boolean).join("；");
  const zoneLabel = businessZone().label;
  // 结果未知的消息：运营要知道的是哪条、发给谁、什么时候发的；不标是在主会话还是小窗发的。
  const customerLabel = (customerId?: string) => {
    const convo = customerId ? visible.find(row => String(row.customerId) === customerId) : undefined;
    if (convo && visible.some(row => row.customerId !== customerId && rowName(row) === rowName(convo))) return `客户 ${m1CustomerCode(customerId!)}`;
    return convo ? rowName(convo) : customerId ? `客户 ${m1CustomerCode(customerId)}` : "客户待确认";
  };
  const openOtherSend = (entry: SavedSend) => {
    if (entry.reply) {
      const convo = visible.find(row => row.id === entry.locator.conversationId);
      if (convo) { followSelection.current = true; select(convo.id, entry.row.commandKey); }
    } else if (entry.first) {
      setChosenCommand(entry.row.commandKey);
      const customerId = entry.first.customerId;
      followSelection.current = true; setContinuation(null); setRequestedCustomerId(customerId); setScreen("chat");
      const url = new URL(window.location.href); url.searchParams.delete("conversationNo"); url.searchParams.set("customerId", customerId); window.history.replaceState(null, "", url);
    }
  };
  const sendTech = (key: string) => <Fold inset title="技术信息" summary="操作编号"><Facts><Fact k="操作编号"><span data-mono>{key}</span></Fact></Facts></Fold>;
  const isRedacted = (entry: SavedSend) => entry.dock?.readOnlyRecovery || entry.row.fingerprint === recoveryKey(adminId, entry.row.commandKey);
  const lookupReason = scopeDenied ? "当前账号看不到客户会话。" : qualificationUnknown ? "当前可见范围没读到，请重试。" : "读不到会话。";
  const pendingHelp = [
    "发出后没收到明确结果的消息，查清前不能再给同一位客户发。",
    recoveries.some(entry => entry.first || entry.reply) && `「只能查询结果」：${lookupReason}`,
    recoveries.some(isRedacted) && "「已不能接待，只能查询结果」：客户被转走或你的权限变了，原文和图片已从本机清除，只能查有没有发出，不能重发。",
    `时间为${zoneLabel}。`,
  ].filter(Boolean).join("");
  const pendingItems: RecoveryItem[] = [
    ...recoveries.map(entry => ({ key: entry.row.commandKey, createdAt: entry.row.createdAt, object: customerLabel(originalCustomer(entry.locator)), tag: null,
      line: entry.first || entry.reply ? "只能查询结果" : isRedacted(entry) ? "已不能接待，只能查询结果" : "原记录不全，只能查询结果",
      detail: <p>发出时间：{businessStamp(entry.row.createdAt)}</p>, tech: sendTech(entry.row.commandKey),
      actions: <Button size="sm" disabled={flights.current.has(`${scopeIdentity}:${originalCustomer(entry.locator) ?? entry.row.commandKey}`)} onClick={() => void queryRecovery(entry)}>查询原结果</Button> })),
    ...otherSends.filter(entry => originalCustomer(entry.locator) !== targetCustomer).map(entry => ({ key: entry.row.commandKey, createdAt: entry.row.createdAt,
      object: customerLabel(originalCustomer(entry.locator)), tag: null, line: entry.first ? "首次联系，打开后查询或重试" : "打开原会话后查询或重试",
      detail: <p>发出时间：{businessStamp(entry.row.createdAt)}</p>, tech: sendTech(entry.row.commandKey),
      actions: <Button size="sm" disabled={busy} onClick={() => openOtherSend(entry)}>打开会话</Button> })),
  ];
  const lengthHint = composerMode === "write" && !pending && !firstPending ? supportLengthHint(draft) : null;
  // 原文另存了一份时，没发出和原因并进那块原文里说，不再单独出一条红色提示。
  const failedPrefix = failedCopy && sendFeedback?.commandKey === failedCopy.commandKey ? [MESSAGE_FAILED, MESSAGE_FAILED_UNCHECKED].find(text => sendError.startsWith(text)) : undefined;
  const keptReason = failedPrefix ? sendError.slice(failedPrefix.length) || " " : "";
  // 查询结案时核验状态常已重置，句子先写成「客户仍归你时会放回」；原文实际已回到这个输入框（没另存、框里有字）就直接说放回了。
  const failedNotice = keptReason ? "" : sendError.startsWith(MESSAGE_FAILED_UNCHECKED) && !failedCopy && !activeEntry && draft.trim()
    ? MESSAGE_FAILED + sendError.slice(MESSAGE_FAILED_UNCHECKED.length) : sendError;
  // 分段一行放两个，其余进「更多」（DP-14）：待回复、待分配这类要处理的排在前面。
  // 范围或会话没读到时数字写「—」，不写 0（ST-34、ST-31）。
  const countsRead = conversationsAvailable && !qualificationUnknown;
  const tabItems = [...tabs].sort(([a], [b]) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b)).map(([value, label]) => {
    const count = customerRows.filter(row => tabMatch(row, value, adminId)).length;
    const overdue = value === "unassigned" ? customerRows.some(row => tabMatch(row, value, adminId) && row.pendingReplySince != null && timeoutNow - row.pendingReplySince >= (ctx.unboundAlertMinutes ?? 5) * 60000) : value === "pending" && customerRows.some(row => tabMatch(row, value, adminId) && Boolean(late(row)));
    return { value, label: <>{label}{overdue && <span className="sr-only">（有客户已超时待处理）</span>}{!countsRead && " —"}</>, count: countsRead ? count : undefined, tone: overdue ? "warn" as const : undefined };
  });
  const frontTabs = tabItems.slice(0, 2), moreTabs = tabItems.slice(2);
  const moreOn = moreTabs.some(item => item.value === listTab);
  const openElsewhere = Boolean(selected?.customerId) && conversationsAvailable && !filtered.some(row => row.customerId === selected?.customerId);
  const teamWord = filterName ? `${filterName}的客户` : scopeMode === "ALL" ? "其他客户" : "组内其他客户";
  const scopeWord = reviewing ? teamWord : "你的客户";
  const chatMenu: MoreMenuItem[] = [
    ...(profileCustomerId && !selectedUnbound ? [{ key: "profile", label: "在本页展开资料", onSelect: () => setProfileOpen(value => value + 1) }] : []),
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
  const baseBlocked = !canWriteM3 ? "当前账号只能查看会话" : readDenied ? "当前账号看不到客户会话" : qualificationUnknown ? reviewScopeError ? "当前可见范围没读到，重试后再操作" : "正在确认你的专属客服身份" : undefined;
  const noOwnCustomers = hasOwn ? undefined : !myAgent ? "当前账号不是专属客服，没有本人客户" : ownCustomers === 0 ? "你名下还没有客户。客户分配给你之后才能用，分配情况看「客服工作台」" : undefined;
  // 新建要有本人客户；已有批次和待确认的原操作照样能进去查（OP-93）。
  const bulkBlocked = hasBulkPending(adminId) || (bulkBatches ?? 0) > 0 ? undefined : baseBlocked ?? (bulkBatches === 0 ? noOwnCustomers : undefined);
  const checkingOwner = Boolean(selected && !writable && composerMode === "write" && !currentProfileDetail && !profileError && !recoveryBlocksTarget && canWriteM3 && selected.status === "open");
  // 计数口径进结论句尾的问号，第二行只写还有谁要处理（VS-23）。
  const countExplain = "左侧菜单「客服中心」里的数字含待回复、首次联系和到期待维护的客户；这里只数当前范围的待回复。";
  const guideRole = !canWriteM3 ? "当前账号只能查看会话，不能发消息。" : scopeMode === "ALL" ? "当前账号是超级管理员：能看全部客户。别人没在接待时，可以用你自己的名字回复，不能记为联系维护；能修改超时策略。" : scopeMode === "MANAGED" ? "当前账号是客服主管：「我的客户」是你本人的客户，「组内其他客户」是负责组中除你本人名下以外的客户。别人没在接待时，可以用你自己的名字回复组内客户，不能记为联系维护；超时策略只能看。" : "当前账号是专属客服：只看得到、只能回复自己的客户；超时策略只能看。";

  // 菜单能进但不在客服范围内：后端拒绝的是这个账号，不是服务坏了（ST-38）。
  if (scopeDenied && !recoveries.length) return <>
    <PageHeader pageId="M3" title="专属会话" summary={summary} back={back} />
    {banner}
    <BlockState state="denied" title="当前账号看不到客户会话" detail="这页只给客服、客服主管和超级管理员用。需要查看会话，请联系管理员调整账号。" />
  </>;

  return <>
    {holdEndRelease && <ReleaseModal label="结束会话" explain="后台明确拒绝过这次结束，才可以解除；这不代表原来那次没结束。解除后会重新读取这次接待的状态，不进操作记录。" onCancel={() => setHoldEndRelease(null)} onConfirm={() => {
      const saved = sessionEndCommands.list().find(record => record.commandKey === holdEndRelease.commandKey && record.fingerprint === holdEndRelease.fingerprint && record.actorId === adminId && record.customerId === holdEndRelease.customerId);
      if (!saved?.rejection) { setHoldEndRelease(null); return; }
      sessionEndCommands.forget(holdEndRelease.fingerprint, holdEndRelease.commandKey);
      setHoldEndCommand(previous => previous?.commandKey === holdEndRelease.commandKey ? sessionEndCommands.list().find(row => row.actorId === adminId && row.customerId === holdEndRelease.customerId) ?? null : previous);
      setHoldEndCommands(readSessionEndRecords(adminId, holdEndRelease.customerId));
      setHoldEndRelease(null); setActionError(""); setHoldRetry(value => value + 1);
    }} />}
    <PageHeader pageId="M3" title="专属会话" back={back}
      summary={<>{summary} <Explain label="时间和更新方式" content={`时间均为${zoneLabel}。${streamReady ? "有新消息时自动更新。" : ""}`} /></>}
      actions={pendingAssignment ? <Button onClick={() => setAssignOpen(true)}>{assignLabel}</Button> : undefined}
      readOnly={!canWriteM3 ? "当前账号只能查看会话" : undefined}
      guideExtra={<p>{guideRole}</p>} />
    {banner}
    {streamLost && !reconnectExhausted && <Notice tone="warn">连接已断开，正在重连；下面是最近一次的数据</Notice>}
    {readDenied ? <BlockState state="denied" title="当前账号看不到客户会话" detail="这页只给客服、客服主管和超级管理员用。需要查看会话，请联系管理员调整账号。" />
      : !conversationsAvailable
      ? ctx.contentLoading && !convRetrying ? <Conclusion state="unknown">正在加载会话…</Conclusion> : <Panel><BlockState state="error" title="会话加载失败" detail={convError || ctx.pget("I.session.conversationsError") || serviceStatus} onRetry={() => void retryConversations()} retrying={convRetrying} /></Panel>
      : reviewScopeError
        ? <Panel><BlockState state="error" title="当前可见范围加载失败" detail={reviewScopeError} onRetry={() => { setReviewScopeError(""); setScopeRetry(value => value + 1); }} /></Panel>
        : qualificationUnknown
          ? <Conclusion state="unknown">正在确认你的专属客服身份，稍后显示可查看的会话。</Conclusion>
          : waitingRows.length
            ? <Conclusion state={lateCount ? "warn" : "neutral"} icon={Clock3} hint={waitingHint || undefined} explain={countExplain}
                action={oldestWaiting && oldestWaiting.customerId !== selected?.customerId ? <Button size="sm" onClick={() => { if (listTab !== "pending") changeTab("pending"); select(oldestWaiting.id); }}>{reviewing ? "查看等得最久的" : "回复等得最久的"}</Button> : undefined}>
                {reviewing ? `${teamWord}中有 ${waitingRows.length} 位待回复` : "有客户等你回复"}{lateCount ? `，${lateCount} 位已超时` : ""}{oldestWaiting?.pendingReplySince != null ? `，最久等了 ${waitText(timeoutNow - oldestWaiting.pendingReplySince)}` : ""}
              </Conclusion>
            : <Conclusion state={waitingHint ? "neutral" : "ok"} hint={waitingHint || undefined} explain={countExplain}
                action={unassignedCount && !(reviewing && !agentFilter && listTab === "unassigned") ? <Button size="sm" onClick={() => { changeScope("team"); changeTab("unassigned"); }}>查看待分配</Button> : undefined}>
                {scopeWord}没有待回复
              </Conclusion>}

    <section className="m3s-stage" data-screen={screen} aria-label="专属客服会话">
      <div className="m3s-inbox">
        <header className="m3s-inbox-head">
          <div className="m3s-inbox-title">
            <h2>会话收件箱</h2>
            <IconButton aria-label="主动联系" title="主动联系" disabledReason={baseBlocked ?? noOwnCustomers} onClick={() => setContactOpen(true)}><Plus size={16} aria-hidden /></IconButton>
            <IconButton aria-label="圈选群发" title="圈选群发" disabledReason={bulkBlocked} onClick={() => setBulkOpen(true)}><Megaphone size={16} aria-hidden /></IconButton>
            <IconButton aria-label={alertsOn ? "提醒已开" : "提醒已关"} aria-pressed={alertsOn} title={`${alertsOn ? "提醒已开" : "提醒已关"}：新消息、新分配客户的提示音和浏览器通知（仅本浏览器）`} onClick={() => { const on = !alertsOn; setSupportAlertPrefs({ sound: on, desktop: on }); }}>{alertsOn ? <Bell size={16} /> : <BellOff size={16} />}</IconButton>
            <MoreMenu label="收件箱工具" items={inboxMenu} />
          </div>
          <div className="m3s-filters">
            {canReviewAll && <Select aria-label="收件箱范围" value={!reviewing ? "mine" : agentFilter ? `agent:${agentFilter}` : "team"} onChange={value => { if (value === "mine") { changeScope("mine"); if (listTab === "unassigned") changeTab("pending"); } else changeScope("team", value === "team" ? 0 : Number(value.slice(6))); }}
              groups={[{ label: "范围", options: [{ value: "mine", label: "我的客户" }, { value: "team", label: (scopeMode === "ALL" ? "其他客户" : "组内其他客户") }] }, ...(teamAgents.length > 0 ? [{ label: "按专属客服看", options: teamAgents.map(([id, name]) => ({ value: `agent:${id}`, label: name })) }] : [])]} />}
            <Input data-search value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户、会话" aria-label="搜索客户或会话编号" />
          </div>
          <div className="m3s-tabs">
            <Segments label="会话状态筛选" value={listTab} onChange={changeTab} items={frontTabs} />
            {moreTabs.length > 0 && <div className="m3s-more" data-on={moreOn ? "" : undefined}><Select aria-label="更多状态" required placeholder="更多" value={moreOn ? listTab : ""} onChange={value => changeTab(value as ListTab)} options={moreTabs.map(item => ({ value: item.value, label: <>{item.label}{item.count !== undefined && ` ${item.count}`}</> }))} /></div>}
          </div>
          {archiveMode && <div className="m3s-batch"><span role="status">已选 {archiveIds.size} 位客户</span><Button size="sm" disabled={!archiveIds.size || actionChecking} onClick={() => void archiveBatch()}>归档已选 {archiveIds.size}</Button><Button size="sm" variant="ghost" onClick={() => { setArchiveMode(false); setArchiveIds(new Set()); }}>取消</Button></div>}
        </header>
        {pendingItems.length > 0 && <div className="m3s-pending"><RecoveryPanel label="发送结果未知的消息" title={`${pendingItems.length} 条消息发送结果未知`} explainLabel="这些消息怎么处理"
            explain={pendingHelp} items={pendingItems} /></div>}
        {recoveryError && <div className="m3s-pending"><Notice tone={recoveryError.startsWith("查到了") ? "neutral" : "warn"} action={<Button size="sm" onClick={() => setRecoveryError("")}>知道了</Button>}>{recoveryError}</Notice></div>}
        <div ref={rowsRef} className="m3s-rows" onScroll={event => { const el = event.currentTarget; if (listLimit < filtered.length && el.scrollTop + el.clientHeight >= el.scrollHeight - 80) setListLimit(n => n + LIST_CHUNK); }}>
          {!conversationsAvailable && <div className="m3s-empty"><p>{readDenied ? "看不到会话。" : ctx.contentLoading || convRetrying ? "正在加载会话…" : "读不到会话。"}</p></div>}
          {/* 一行写完：名字长就在名字里省略，悬停看 title、键盘聚焦「看全部」看气泡（ST-04）；名字是客户填的，标 data-user-content。 */}
          {openElsewhere && <p className="m3s-row-note" title={`打开的${title}不符合当前筛选`}>打开的<span className="m3s-row-note-name" data-user-content="">{title}</span>不符合当前筛选<FocusFullText text={`打开的${title}不符合当前筛选`} clipped={button => button.parentElement?.querySelector(".m3s-row-note-name")}><button type="button" className="rd-link rd-link-button" onClick={() => { setQuery(""); changeTab(selected?.archived ? "archived" : "all"); }}>{selected?.archived ? "看归档" : "看全部"}</button></FocusFullText></p>}
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
            const tagTone: StateTone = timeoutLabel ? "warn" : knownReplyState === false ? "done" : "neutral";
            const name = rowName(convo);
            const holdText = convo.holder ? convo.holder.adminId === adminId ? `你在接待${convo.ownerAdminId !== adminId ? ` · 专属客服 ${ownerLabel(convo.owner)}` : ""}` : convo.holder.role !== "ADVISOR" ? `${convo.holder.role === "ADMIN" ? "超级管理员" : "主管"}接待中 · ${convo.holder.name}` : "" : "";
            const origin = convo.origin ? `${{ user: "客户发起", advisor: "客服主动联系", support: "客服主动联系" }[convo.origin]} · ` : "";
            // 消息预览是客户发来的原文：单行省略，整行悬停的 title 第一行、键盘聚焦时的气泡都给全文（ST-04）。
            const fullPreview = kind === "IMAGE" || kind === "SKU" || kind === "LINK" ? undefined : message?.text || convo.lastPreview || undefined;
            const previewId = `m3s-preview-${convo.id}`;
            return <div key={convo.id} className="m3s-row-wrap">
              {archiveMode && <label className="m3s-row-check" title={`选择会话 ${convo.id}`}><Checkbox aria-label={`选择会话 ${convo.id}`} checked={archiveIds.has(convo.id)} disabled={!canWriteM3 || convo.ownerAdminId !== adminId || convo.archived || Boolean(convo.pendingReplyCount)} onChange={e => setArchiveIds(old => { const next = new Set(old); if (e.target.checked) next.add(convo.id); else next.delete(convo.id); return next; })} /></label>}
              <div className="m3s-row" data-on={active ? "" : undefined}>
                <FocusFullText text={fullPreview} clipped={button => button.parentElement?.querySelector(".m3s-row-preview")}><button type="button" className="m3s-row-hit" aria-label={`${name}，${timeoutLabel || replyLabel}`} aria-describedby={previewId} aria-current={active ? "true" : undefined} title={`${fullPreview ? `${fullPreview}\n` : ""}${origin}${replyLabel} · 当前专属客服：${ownerLabel(convo.owner)} · 会话 ${convo.id}`} onClick={() => select(convo.id)} /></FocusFullText>
                <SupportAvatar name={userNicknameText(convo.customer || convo.profile?.nickname || "客户", convo.profile?.phone)} path={convo.customerAvatarRef ?? undefined} size={36} />
                <span className="m3s-row-main">
                  <span className="m3s-row-top"><strong title={name}>{name}</strong><time title={`${messageDay(convo.lastTs)} ${messageTime(convo.lastTs)}（${zoneLabel}）`}>{agoText(convo.lastTs, timeoutNow)}</time></span>
                  <span id={previewId} className="m3s-row-preview" data-user-content="" title={fullPreview}>{kind === "IMAGE" ? "[图片]" : kind === "SKU" ? "[商品推荐]" : kind === "LINK" ? "[页面链接]" : message?.text || convo.lastPreview || (hasMessage === false ? "尚无人工消息" : "消息摘要暂不可用")}</span>
                  <span className="m3s-row-meta">
                    <StatusTag tone={tagTone} explain={STATE_HELP[timeoutLabel ? "late" : replyLabel]}>{timeoutLabel || replyLabel}</StatusTag>
                    {(holdText || !timeoutLabel) && <span className="m3s-row-owner" data-hold={holdText ? (convo.holder?.adminId === adminId ? "mine" : "other") : undefined} title={holdText || `${convo.archived ? "已归档" : conversationStateLabel(convo.status)} · ${ownerLabel(convo.owner)}`}>{holdText || `${convo.archived ? "已归档" : conversationStateLabel(convo.status)} · ${ownerLabel(convo.owner)}`}</span>}
                    {convo.unread > 0 && <span className="m3s-unread" aria-label={`${convo.unread} 条未读`}>{convo.unread}<span className="sr-only"> 条未读</span></span>}
                  </span>
                </span>
              </div>
            </div>;
          })}
        </div>
        {(query.trim() || listLimit < filtered.length) && <div className="m3s-inbox-foot"><span>{query.trim() ? `搜到 ${countsRead ? filtered.length : "—"} 位` : ""}</span>{listLimit < filtered.length && <Button size="sm" variant="ghost" onClick={() => setListLimit(n => n + LIST_CHUNK)}>加载更多</Button>}</div>}
      </div>

      <div ref={chatColumnRef} className="m3s-chat">
        <header className="m3s-chat-head">
          <Button size="sm" className="m3s-back" aria-label="返回会话列表" onClick={() => setScreen("list")}>返回</Button>
          <SupportAvatar name={title} path={selected?.customerAvatarRef ?? undefined} size={36} />
          <div className="m3s-chat-id">
            <h2 title={title}>{title}</h2>
            <div className="m3s-chat-sub">{selected ? <>当前专属客服：{ownerLabel(selected.owner)}{actsAsAdvisor && (hold?.state === "MINE" || heldByOther) ? "（你）" : ""} · {hold?.state === "MINE" ? <span className="m3s-hold" data-hold="mine">你正在接待{hold.autoEndAt && `，约 ${holdClock(hold.autoEndAt)} 自动结束`}{!actsAsAdvisor && <> <Explain label="接待是什么意思" content={`接待期间其他人不能给该客户发消息。${hold.endMinutes !== null ? `无人发言 ${hold.endMinutes} 分钟后自动结束。` : ""}`} /></>}</span> : heldByOther ? <span className="m3s-hold" data-hold="other">{holderRole} {hold.holder?.name} 接待中</span> : selected.status === "transferred" ? "已转出 · 只读" : selected.status === "open" ? selected.writeState?.canReply === false ? "旧会话 · 只读" : "当前会话" : "历史会话"}{presence?.online ? " · 客户在线" : ""}</> : requestedCustomerId ? hold?.state === "MINE" ? <span className="m3s-hold" data-hold="mine">你正在接待</span> : heldByOther ? <span className="m3s-hold" data-hold="other">{holderRole} {hold.holder?.name} 接待中</span> : "首次联系" : conversationsAvailable ? "选择客户查看会话" : "暂时读不到"}</div>
          </div>
          <div className="m3s-chat-actions">
            {(selected || profileCustomerId) && <Button size="sm" className="m3s-profile-toggle" onClick={() => setScreen("profile")}>客户资料</Button>}
            {canContinueConversation && selected?.status !== "open" && <Button size="sm" title="重新核对当前专属客服归属，继续当前对话" onClick={continueClosed}>{selected?.writeState?.writableConversationNo ? "打开当前会话" : "发起会话"}</Button>}
            {writable && actsAsAdvisor && selected && <Button size="sm" disabled={actionChecking} disabledReason={currentReplyTarget ? "客户还有消息没回，先回复才能标记已解决" : undefined} icon={<CheckIcon size={14} />} onClick={closeConversation}>标记已解决</Button>}
            {(hold?.state === "MINE" || endPending) && !actsAsAdvisor && <Button size="sm" loading={holdEnding} loadingText="正在结束…" icon={<Square size={14} />} onClick={() => void endHold()}>结束会话</Button>}
            {chatMenu.length > 0 && <MoreMenu items={chatMenu} />}
          </div>
        </header>
        {(sessionEndRecoveries.length > 0 && !holdEnding || serviceStatus && conversationsAvailable || actionError || actionResult || !requestedCustomerIdValid || readError || paneMessages && messagePages.error || messagePages.gap) && <div className="m3s-notices">
          {!holdEnding && sessionEndRecoveries.filter(record => record.instanceState === "current").map(record => <Notice key={record.commandKey} tone="warn" action={<><Button size="sm" onClick={() => void querySessionEndRecord(record)}>查询原结果</Button>{holdEndRejected.has(record.commandKey) && <Button size="sm" onClick={() => setHoldEndRelease(record)}>解除原操作记录</Button>}</>}>{isRetryExpired(record) ? `${RETRY_EXPIRED_TEXT}` : holdEndRejected.has(record.commandKey) ? "这次接待的结束被拒绝了，原记录还在；核对后可以解除原操作记录。" : "这次接待的结束结果未知。点「结束会话」会先查原结果，不会重复结束。"}</Notice>)}
          {!holdEnding && sessionEndRecoveries.filter(record => record.instanceState === "unconfirmed").map(record => <Notice key={record.commandKey} tone="warn" action={<><Button size="sm" onClick={() => void querySessionEndRecord(record)}>查询原结果</Button>{holdEndRejected.has(record.commandKey) && <Button size="sm" onClick={() => setHoldEndRelease(record)}>解除原操作记录</Button>}</>}>{record.sessionRef ? isRetryExpired(record) ? `还不能确认这条结束记录是哪一次接待的，可以查原结果；${RETRY_EXPIRED_TEXT}` : "还不能确认这条结束记录是哪一次接待的，可以查原结果；点「结束会话」会先按它核对，可能按原操作重试。" : `这条结束记录没记下是哪一次接待，只能查原结果；查清之前，这次接待可能结束不了。${isRetryExpired(record) ? `${RETRY_EXPIRED_TEXT}` : ""}`}</Notice>)}
          {!holdEnding && <RecoveryPanel tone="neutral" label="之前接待的结束记录" title={`之前的接待留下 ${sessionEndRecoveries.filter(record => record.instanceState === "historical").length} 条结束记录`} explainLabel="这些记录是什么"
            explain={`之前接待里点过「结束会话」、还没确认结果的记录。只能查原结果，不会重发，也不影响这次接待。时间为${businessZone().label}。`}
            items={sessionEndRecoveries.filter(record => record.instanceState === "historical").map(record => {
              const started = record.sessionRef ? Date.parse(`${record.sessionRef.slice(record.sessionRef.indexOf(":") + 1)}Z`) : NaN;
              const rejected = holdEndRejected.has(record.commandKey);
              return { key: record.commandKey, createdAt: record.createdAt,
                object: Number.isFinite(started) ? `${businessStamp(started)} 开始的接待` : "没记下是哪次接待",
                tag: rejected ? <StatusTag tone="warn">被拒绝</StatusTag> : isRetryExpired(record) ? <StatusTag tone="done" icon={TimerOff}>已过期</StatusTag> : <StatusTag tone="neutral" icon={Search}>只能查询</StatusTag>,
                line: rejected ? "结束被拒绝，核实后可以解除这条记录。" : isRetryExpired(record) ? `${RETRY_EXPIRED_TEXT}` : "结果未知，只能查原结果。",
                detail: <p>发出时间：{businessStamp(record.createdAt)}</p>,
                tech: <Fold inset title="技术信息" summary="操作编号"><Facts><Fact k="操作编号"><span data-mono>{record.commandKey}</span></Fact></Facts></Fold>,
                actions: <><Button size="sm" onClick={() => void querySessionEndRecord(record)}>查询原结果</Button>{rejected && <Button size="sm" onClick={() => setHoldEndRelease(record)}>解除原操作记录</Button>}</> };
            })} />}
          {serviceStatus && conversationsAvailable && <Notice tone="danger">{serviceStatus}</Notice>}
          {actionResult && <Notice tone="progress" action={<Button size="sm" onClick={() => setActionResult("")}>知道了</Button>}>{actionResult}</Notice>}
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
            ? conversationError ? <BlockState state="error" title="会话详情加载失败" detail={conversationError} retryLabel="重新加载详情" onRetry={() => { void messagePages.retry(); }} /> : <BlockState state="loading" title="正在加载会话消息…" />
            : selected && paneMessages?.length
              ? paneMessages.map((message, index) => { const day = messageDay(message.ts); return <div key={message.id ?? `${message.ts}-${index}`} data-m3-message-id={message.id}>{day && day !== messageDay(paneMessages[index - 1]?.ts ?? 0) && <div className="m3s-day"><span>{day}</span></div>}<SupportMessage message={message} previous={paneMessages[index - 1]} newlyArrived={message.id !== undefined && newMessageIds.has(message.id)} customerId={String(selected.customerId)} customerAvatarRef={selected.customerAvatarRef} customerName={title} onRevoked={() => ctx.invalidateScope(selected.id, String(selected.customerId))} /></div>; })
              : !conversationsAvailable ? <p className="m3s-blank">读不到消息</p> : <BlockState state="empty" title={requestedCustomerId ? "尚无进行中会话。核对归属后即可发送首次联系。" : selected ? historyComplete ? "这段会话尚无消息。" : "历史消息还没加载完，请稍候或点重试。" : "选择会话后查看消息。"} />}
        </div>
        <div className="m3s-composer">
          {detailError && (detailDenied ? <Notice tone="warn" title="你没有查看这位客户的权限" action={<a className="rd-link" href="/service/overview">返回我的客户</a>} />
            : <Notice tone="danger" action={<><Button size="sm" onClick={() => setDetailRetry((value) => value + 1)}>重试</Button><a className="rd-link" href="/service/overview">返回我的客户</a></>}>客户资料加载失败：{detailError}</Notice>)}
          {requestedCustomerId && !selected && firstDetail && firstDetail.agentAdminId !== adminId && !holdAllowsOther && !heldByOther && <Notice tone="warn">{canReviewAll && canWriteM3 && hold === undefined ? "正在核对接待状态…" : "这位客户由专属客服负责，你只能查看。"}</Notice>}
          {requestedCustomerId && firstDetail && firstDetail.agentAdminId === adminId && !firstDetail.assignmentId && <Notice tone="warn">还没读到这位客户的归属，暂不能发送，请刷新客户资料。</Notice>}
          {selected && !writable && !ownReplyInFlight && !(editable && messagePages.loading) && composerMode === "write" && (currentProfileDetail || profileError || recoveryBlocksTarget || !canWriteM3 || selected.writeState?.canReply !== true || selected.status !== "open") && (
            selected.status === "open" && selected.writeState?.canReply === false && canContinueConversation ? threadNotice(selected.writeState)
            : recoveryBlocksTarget ? <Notice tone="warn" action={<Button size="sm" className="m3s-narrow-only" onClick={() => setScreen("list")}>返回列表查询</Button>}>有一条消息发送结果未知，查到前不能再发；在列表上方查询。</Notice>
            : !canWriteM3 ? <Notice tone="neutral">你只能查看会话，发消息需要会话操作权限。</Notice>
            : !selected.writeState ? <Notice tone="warn" action={<Button size="sm" onClick={() => void refreshChangedPeer(identityRef.current)}>重新读取会话</Button>}>还没确认这条会话能不能回复，确认前先不能发送。</Notice>
            : selected.status !== "open" && selected.writeState.writableConversationNo !== selected.id ? <Notice tone="neutral">{historyReadOnlyHint}</Notice>
            : selectedUnbound ? <Notice tone="warn">该客户还没有专属客服，等待主管分配后回复。</Notice>
            : selected.writeState?.canReply === false ? threadNotice(selected.writeState)
            : !currentProfileDetail ? <Notice tone="danger" action={<Button size="sm" onClick={() => setProfileRetry((value) => value + 1)}>重试</Button>}>客户归属核对失败：{profileError}</Notice>
            : !currentProfileDetail.assignmentId || currentProfileDetail.agentAdminId !== selected.ownerAdminId ? <Notice tone="warn" action={<Button size="sm" onClick={() => void ctx.refreshConversations()}>刷新会话</Button>}>客户归属已变化，请刷新会话后重试。</Notice>
            : conversationError ? null
            : messagePages.gap ? <Notice tone="warn" action={<Button size="sm" onClick={() => void messagePages.newest()}>查看最新10条</Button>}>有新消息尚未展开，请查看后再发送。</Notice>
            : !messagePages.contextReady || messagePages.page?.replyContext.ready !== true ? <Notice tone="warn" action={<Button size="sm" disabled={messagePages.loading} onClick={() => void messagePages.refresh()}>重新核对</Button>}>暂时核对不了要回复哪几条消息。</Notice>
            : otherReplyBlocksTarget ? null
            : <Notice tone="neutral">只有这位客户的专属客服能发消息，主管查看时不能代发。</Notice>)}
          {!selected && recoveryBlocksTarget && <Notice tone="warn" action={<Button size="sm" className="m3s-narrow-only" onClick={() => setScreen("list")}>返回列表查询</Button>}>有一条消息发送结果未知，查到前不能再发；在列表上方查询。</Notice>}
          {requestedCustomerId && !selected && !canWriteM3 && <Notice tone="neutral">你只能查看会话，发消息需要会话操作权限。</Notice>}
          {replyCustomerId && closedCandidateRows.length > 0 && (displayedIntent === "MAINTENANCE" && !closedCandidateError && !closedCandidateMissing.length
            ? <fieldset className="m3s-targets"><legend>同时标记旧会话的待回复消息已处理（可不选）</legend>{closedCandidateRows.map(row => <Check key={row.conversationNo} label={row.text} checked={displayedClosedIds.has(row.conversationNo)} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={event => setSelectedClosedIds(old => { const next = new Set(old); if (event.target.checked) next.add(row.conversationNo); else next.delete(row.conversationNo); return next; })} />)}</fieldset>
            : closedCandidateError ? <Notice tone="danger" action={<Button size="sm" onClick={() => { void messagePages.refresh(); }}>重试</Button>}>历史待处理消息加载失败：{closedCandidateError}</Notice>
            : closedCandidateMissing.length ? <p className="m3s-aux" role="status">正在核对历史待处理消息…</p> : null)}
          {selected && displayedIntent === "MAINTENANCE" && Boolean(currentReplyTarget) && <Check label="同时标记本会话最近一条客户消息已处理（如仍待处理）" checked={includeCurrentReply || lockedTargets.some((target) => target.conversationNo === selected.id)} disabled={!writable || busy || Boolean(activeEntry)} onChange={(event) => setIncludeCurrentReply(event.target.checked)} />}
          {composerMode === "write" && (selected || requestedCustomerId) && <>
            <div className="m3s-tools">
              {holdAllowsOther && <span className="m3s-sender"><SupportAvatar name={myName || myRoleLabel} size={22} />客户侧消息署名：<strong>{myName}</strong><Explain label="发送人与专属客服不同" content="你以本人姓名回复，客户的专属客服归属不变。" /></span>}
              <SupportContentTools key={`${identityRef.current}:${logicalSlot}:${selected?.ownerAdminId ?? adminId}:${selected?.assignmentId ?? ""}:${selected?.status ?? ""}:${canWriteM3}`} popover textOnly={!selected} faqLanguage={faqLanguage} ctx={ctx} disabled={!writable || busy || Boolean(pending || firstPending)} onInsert={insertText} onSelect={choice => { setContentChoice(choice); if (!draft.trim()) insertText(choice.kind === "SKU" ? "推荐商品：" + choice.name : "查看：" + choice.name); }} />
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png" aria-label="选择图片" disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} hidden />
              <Button size="sm" variant="ghost" aria-label="选择图片" icon={<ImageIcon size={14} />} title={attachmentPolicyError || (!attachmentPolicy ? "正在加载图片规则…" : !attachmentPolicy.available ? supportAttachmentUnavailableText(attachmentPolicy.unavailableReason) : "发送图片")} disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onClick={() => fileInputRef.current?.click()}>图片</Button>
              {replyCustomerId && closedCandidateRows.length > 0 && displayedIntent !== "MAINTENANCE" && !closedCandidateError && !closedCandidateMissing.length && <Explain label="这条回复会处理哪些消息" content="服务回复会同步处理这位客户此前的待回复消息。" />}
            </div>
            {selected && attachmentPolicyError && <Notice tone="warn" action={<Button size="sm" onClick={() => setAttachmentPolicyRetry((value) => value + 1)}>重试</Button>}>{attachmentPolicyError}</Notice>}
            {maintenanceOffered && !pending && !firstPending && <Check label={`本条记为联系维护${intentSource?.due === true ? "（该客户维护已到期）" : ""}`} explain="发送成功后计入一次人工维护执行；客户之后重新活跃才算维护成功。" checked={maintenanceChosen} disabled={!writable && !requestedCustomerId || busy} onChange={event => setMaintenanceChosen(event.target.checked)} />}
            {privateContentReady && targetKey && contentChoice && <Notice tone="neutral" action={<Button size="sm" disabled={busy || Boolean(pending)} onClick={() => setContentChoice(null)}>取消推荐</Button>}>将发送：{contentChoice.name}</Notice>}
            {privateContentReady && targetKey && attachment && <div className="m3s-upload">
              <img src={attachment.url} alt="待发送图片预览" />
              <div className="m3s-upload-text"><strong title={attachment.file.name}>{attachment.file.name}</strong><span data-error={attachment.state === "error" ? "" : undefined}>{attachment.state === "ready" ? "已上传，尚未发送" : attachment.state === "uploading" ? "上传中…" : attachment.state === "error" ? `上传失败：${attachment.error}` : "等待上传"} <Explain label="图片怎么发" content="发送文字不会附带此图片。先点「上传图片」，再点「发送图片」。" /></span></div>
              <Button size="sm" disabled={!writable || busy || attachment.state === "uploading" || attachment.state === "ready"} onClick={() => void uploadImage()}>{attachment.state === "error" ? "重试上传" : "上传图片"}</Button>
              <Button size="sm" variant="primary" disabled={!writable || busy || Boolean(activeEntry) || attachment.state !== "ready"} onClick={() => void send("IMAGE")}>发送图片</Button>
              <Button size="sm" variant="ghost" aria-label="移除待发送图片" onClick={() => clearAttachment()}>移除</Button>
            </div>}
            <div className="m3s-input">
              <Textarea ref={composerRef} aria-label="输入会话消息" placeholder="输入消息，回车发送，Shift+回车 换行" value={draft} disabled={!editable} onChange={(event) => { setDrafts((old) => ({ ...old, [targetKey]: event.target.value })); sendAdminTyping(writable && Boolean(event.target.value.trim())); }} onBlur={() => sendAdminTyping(false)} onKeyDown={(event) => { if (shouldSendOnEnter(event)) { event.preventDefault(); void send(contentChoice?.kind ?? "TEXT"); } }} />
              <Button variant="primary" loading={busy} loadingText="发送中…" icon={<SendHorizontal size={16} />} disabled={!writable || Boolean(pending || firstPending) || !draft.trim()} onClick={() => void send(contentChoice?.kind ?? "TEXT")}>{contentChoice?.kind === "SKU" ? "发送商品" : contentChoice?.kind === "LINK" ? "发送链接" : "发送"}</Button>
            </div>
            {lengthHint && <p className="m3s-count" data-over={lengthHint.over ? "" : undefined} role={lengthHint.over ? "alert" : "status"}>{lengthHint.text}</p>}
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
          {!busy && otherSends.filter(entry => originalCustomer(entry.locator) === targetCustomer).map(entry => <Notice key={entry.row.commandKey} tone="warn" action={<Button size="sm" onClick={() => openOtherSend(entry)}>返回原会话</Button>}>这位客户的另一条消息发送结果未知，先回原会话处理。</Notice>)}
          {(failedNotice || !busy && (pending || firstPending)) && <Notice tone={pending || firstPending || sendError.includes("未知") ? "warn" : "danger"}
            actionBelow={!busy && Boolean(pending || firstPending)} title={!busy && activeEntry && (pending || firstPending) ? <>这条消息发送结果未知<span className="m3s-notice-meta">{businessStamp(activeEntry.row.createdAt)} 发出 · {zoneLabel}</span></> : undefined}
            action={<>{sendError.startsWith("消息已发送") && <Button size="sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</Button>}
              {(pending || firstPending) && <Button size="sm" disabled={busy} onClick={() => void send(pending?.kind ?? "TEXT", "query")}>查询原结果</Button>}
              {(pending || firstPending) && canRetryActiveSend && <Button size="sm" disabled={busy} disabledReason={sendRetryExpired ? RETRY_EXPIRED_TEXT : undefined} onClick={() => void send(pending?.kind ?? "TEXT", "retry")}>按原操作重试</Button>}
            </>}>
            {!busy && (pending || firstPending) && (!sendError || sendError === MESSAGE_UNKNOWN)
              ? !canRetryActiveSend ? "只能查询结果" : sendRetryExpired ? "超过 24 小时不能再重试，先查询原结果。" : MESSAGE_UNKNOWN_NEXT
              : failedNotice || MESSAGE_UNKNOWN}
            {firstRecoveryText && firstRecoveryText.trim() !== draft.trim() && <div className="m3s-original" tabIndex={0} aria-label="首次联系的原文"><span>首次联系的原文</span><p>{firstRecoveryText}</p></div>}
          </Notice>}
          {failedCopy && <Notice tone="neutral" actionBelow title={<>没发出的原文<span className="m3s-notice-meta">{businessStamp(failedCopy.createdAt)} 确认没发出 · {zoneLabel}</span></>}
            action={<><Button size="sm" onClick={() => void navigator.clipboard?.writeText(failedCopy.body).then(() => ctx.toast("已复制原文", "success"), () => ctx.toast("复制失败，请手动选中原文复制", "error"))}>复制原文</Button><Button size="sm" variant="ghost" onClick={() => failedDraftCopies.forget(failedCopy.fingerprint, failedCopy.commandKey)}>删除原文</Button></>}>
            <p>{MESSAGE_FAILED_KEPT}{keptReason.trim()}</p>
            <div className="m3s-original" tabIndex={0} aria-label="没发出的原文"><p>{failedCopy.body}</p></div>
          </Notice>}
        </div>
      </div>

      <aside className="m3s-profile" aria-label="客户资料">
        <div className="m3s-profile-narrow"><h2>客户资料</h2><Button size="sm" onClick={() => setScreen("chat")}>返回会话</Button></div>
        {selectedUnbound ? <BlockState state="empty" title="待分配专属客服，还没有维护状态。" /> : profileCustomerId ? <M3CustomerProfile key={`${authEpoch}:${profileCustomerId}`} ctx={ctx} customerId={profileCustomerId} source="M3" openRequest={profileOpen} transferEntry={!canReviewAll || canTransfer} conversation={selected ?? undefined} scopeVersion={profileScopeRevision} messageError={conversationError} onRetryMessages={() => { void messagePages.retry(); }} onHistory={no => { if (visible.some(convo => convo.id === no)) select(no); }} /> : !conversationsAvailable ? <p className="m3s-blank">读不到客户资料</p> : <BlockState state="empty" title={requestedCustomerId ? "客户归属尚未核对，资料暂时加载不出来。" : "选择客户后查看资料。"} />}
      </aside>
      {assignOpen && canAssign && selected?.customerId && <AssignAdvisorDialog key={`${scopeIdentity}:${selected.customerId}`} adminId={adminId} canWrite={canWriteAssignment} customerId={String(selected.customerId)} customerName={title} onClose={() => setAssignOpen(false)} onAssigned={name => { setAssignOpen(false); setActionError(""); setActionResult(`已确认原分配，专属客服为 ${name}。`); void ctx.refreshConversations().catch(() => setActionResult(`已确认原分配，专属客服为 ${name}。会话刷新失败，请刷新会话核对。`)); }} />}
      {bulkOpen && <SupportBulkComposer ctx={ctx} createBlocked={baseBlocked ?? noOwnCustomers} onClose={() => { setBulkOpen(false); setEntryCheck(value => value + 1); }} />}
      {contactOpen && <SupportContactPicker onClose={() => setContactOpen(false)} onSelect={customerId => { setChosenCommand(""); setContinuation(null); setRequestedCustomerId(customerId); setScreen("chat"); setContactOpen(false); const url = new URL(window.location.href); url.searchParams.delete("conversationNo"); url.searchParams.set("customerId", customerId); window.history.replaceState(null, "", url); }} />}
      {timeoutOpen && timeoutPolicy && <IdlePolicyModal policy={timeoutPolicy} initialInput={timeoutInput} canSave={canTimeout} saving={timeoutSaving} error={timeoutError} pending={Boolean(timeoutPending)} conflict={timeoutConflict} latest={timeoutLatest} onDraftChange={setTimeoutInput} onCheckPending={checkTimeoutPending} onRefreshLatest={refreshTimeoutLatest} onReviewLatest={() => { if (timeoutLatest) { setTimeoutPolicy(timeoutLatest); setTimeoutLatest(null); setTimeoutConflict(false); setTimeoutError(""); setTimeoutInput(input => input && { ...input, reason: "" }); } }} onClose={() => { if (!timeoutSaving) setTimeoutOpen(false); }} onSave={saveTimeout} />}
      {timeoutOpen && !timeoutPolicy && <Modal title="会话超时策略" icon="clock" footer={<Button onClick={() => setTimeoutOpen(false)}>关闭</Button>} onClose={() => setTimeoutOpen(false)}><p role={timeoutError ? "alert" : "status"}>{timeoutError || "正在加载…"}</p>{timeoutError && <Button size="sm" onClick={() => void openTimeout()}>重新加载</Button>}</Modal>}
    </section>
  </>;
}
