"use client";

/**
 * M 客服中心 — 抽 I8(工单)+ I9(即时会话)重组的独立域。5 子页:
 *   M1 客服总览 / M2 客服工单 / M3 即时会话台 / M4 知识库与处理时限 / M5 话术与模板配置。
 * 业务数据读写后端 content 接口;I.support.* / I.session.* 仅作为子组件视图态适配键。
 * MC 显式 edit 契约:调参传 edit、处置不传。MessageThread 共享组件复用于 M2/M3。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { DomainModuleLoading } from "./domain-module-state";
import "./m-domain.css";
import { ADMIN_ERROR_MESSAGES, displayAdminError } from "@/lib/admin/error-messages";
import { Icon, MessageThread, OperationConfirmModal, useToast, type ThreadMessage } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  agentIdForName,
  buildMLegacyParams,
  fetchMConversationSnapshot,
  fetchMConversationDetail,
  fetchMContentData,
  readSupportKnowledge,
  readSupportTemplates,
  mContentActions,
  type MContentData,
  type MLoadConfigWrite,
} from "@/lib/admin/m-client";
import { RETRY_EXPIRED_TEXT, isRetryExpired } from "@/lib/admin/pending-mutation-store";
import { mCommands } from "@/lib/admin/m-pending-commands";
import { MDomainLoadCoordinator } from "@/lib/admin/m-content-load-coordinator";
import { shouldStartM3ConversationRecovery } from "@/lib/admin/m-conversation-recovery-gate";
import { failClosedSupportAgentsAfterReload, preserveVerifiedSupportAgentsDuringReload } from "@/lib/admin/m-progressive-support-state";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useConversationStream, type ConversationStreamEvent } from "@/lib/admin/use-conversation-stream";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { M1AnalyticsWorkbench } from "./m-tabs/m1-analytics-workbench";
import { useSupportInboxAlerts } from "@/lib/admin/support-alerts";
import { supportUnboundPolicyClient } from "@/lib/admin/m-support-client";
import { STANDBY_POOL_LABEL, type AdvisorScript, type SessionConvo, type SessionMsg, type SessionReplyTpl, type SessionType, type SupportTicket, type SupportTicketCategory, type SupportTicketPriority } from "./m-tabs/data";
import { MAvatar, ownerLabel } from "./m-tabs/hd-ui";
import type { ConfirmReq, MCtx, ActionConfirmReq } from "./m-tabs/types";
import { Button, Notice, PageHeader, RdPage } from "@/app/components/rd";
import { containsConversationMessage } from "./m-sse-dedup";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import { supportClient, isSupportScopeDenial, supportAssignmentChanged, SupportClientError, agentSwitchText, type SupportMessageInput } from "@/lib/admin/m-support-client";
import { supportLengthHint, identifySavedCustomer, blocksNewSend, failedDraftCopies, closeFailedDraft, restoreFailedDraft, SUPPORT_MESSAGE_MAX_LENGTH, dockCommands, dockDraftKey, refusedMessage, readSavedSends, revokedPrivateTargets, redactCustomerSends, parseConversations as dockParseConvos, pendingSendCustomers, useSendJournalRevision } from "./m-tabs/m-message-journal";
import { MContentReadError } from "@/lib/admin/m-support-read-contract";

const M3DedicatedChat = dynamic(() => import("./m-tabs/m3-dedicated-chat").then(m => m.M3DedicatedChat), { loading: DomainModuleLoading });
const M4KbSla = dynamic(() => import("./m-tabs/m4-kb-sla").then(m => m.M4KbSla), { loading: DomainModuleLoading });
const M5Page = dynamic(() => import("./m-tabs/m5-page").then(m => m.M5Page), { loading: DomainModuleLoading });

/**
 * M 域两类写入的命令号共用一张表,靠 fingerprint 前缀分命名空间:
 *   cmd|      逻辑命令 id(`m2:ticket:工单号:escalate:版本` 等,已带动作类型 + 目标 id);
 *             调用点不给 commandKey 时退化为 `参数键\0值\0理由`,参数键即目标对象。
 *   m3direct| M3 标签 / 备注直写(`m3:add-tag:会话号:标签`)
 * 落 sessionStorage:刷新后「写入失败或结果未知」的重试必须仍是同一命令号,后端才能去重。
 */
const commandSlot = (commandFingerprint: string) => `cmd|${commandFingerprint}`;
const directWriteSlot = (fingerprint: string) => `m3direct|${fingerprint}`;

// 持续接待 dock 跨 M 子页 UI 态(只保留组件内存,切页不挂断)。
const DOCK_CONVO_KEY = "I.session.convos";
const DOCK_LAST_KEY = "I.session.ui.lastConvo";
const DOCK_OPEN_KEY = "I.session.ui.dockOpen"; // "1" = 展开面板,否则收为药丸
const DOCK_OFF_KEY = "I.session.ui.dockOff";   // 记录被关闭时的会话 id;坐席切到新会话即自动复现
const dockUiStorageKey = (adminId: number) => `nexion-admin-m-dock-ui-v1:${adminId}`;

function readDockUi(adminId: number): Record<string, string> {
  try {
    const saved = JSON.parse(sessionStorage.getItem(dockUiStorageKey(adminId)) ?? "{}");
    return Object.fromEntries([DOCK_LAST_KEY, DOCK_OPEN_KEY, DOCK_OFF_KEY]
      .filter((key) => typeof saved[key] === "string")
      .map((key) => [key, saved[key]]));
  } catch { return {}; }
}

function saveDockUi(adminId: number, params: Record<string, string>) {
  try {
    sessionStorage.setItem(dockUiStorageKey(adminId), JSON.stringify(Object.fromEntries(
      [DOCK_LAST_KEY, DOCK_OPEN_KEY, DOCK_OFF_KEY].map((key) => [key, params[key] ?? ""]),
    )));
  } catch { /* storage unavailable; current page still works */ }
}

const FOLD: Record<string, string> = {
  M1: "M1",
  M2: "M2",
  M3: "M3",
  M4: "M4",
  M5: "M5",
};

function templateStatus(value: string | undefined): AdvisorScript["status"] {
  return value === "published" ? "published" : value === "archived" ? "archived" : "draft";
}

/** 后台读了请求并拒绝：写入没有发生。其余（网络、5xx、幂等未决）都不能算没发生。 */
const refusedWrite = (error: unknown) => {
  if (!(error instanceof MContentReadError)) return false;
  const code = error.status === 200 ? error.apiCode : error.status;
  return [400, 403, 404, 409, 422].includes(code ?? 0) && !(error.backendMessage ?? "").startsWith("IDEMPOTENCY_");
};

const M3_SUMMARY = "和客户对话：先回待回复的，客户资料在右边。";

/** 权限刷新可能重挂页面，操作结果由父页面保留（OP-132）。换账号不显示，整页刷新才清。 */
let lastOperationNotice: { adminId?: number; text: string; tone: "danger" | "progress" | "warn" } | null = null;

export function MDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "M1", [meta.l2Id]);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const session = useAdminAuth((state) => state.session);
  // M3 opened from the 客户 list (发起会话) links back to that list with its filters and page.
  const [fromCustomers, setFromCustomers] = useState(false);
  useEffect(() => { setFromCustomers(tab === "M3" && new URLSearchParams(window.location.search).get("from") === "customers"); }, [tab]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const actionConfirmRunRef = useRef<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [mData, setMData] = useState<MContentData | null>(null);
  const [operationNotice, setOperationNotice] = useState(lastOperationNotice);
  const [alertMinutes, setAlertMinutes] = useState(5);
  const supervisesSupport = Boolean(session?.supportReadModes?.some((mode) => mode === "MANAGED" || mode === "ALL")) || session?.role === "superadmin" || session?.role === "super";
  useEffect(() => {
    if (!supervisesSupport) return;
    const controller = new AbortController();
    supportUnboundPolicyClient.read(controller.signal).then((policy) => setAlertMinutes(policy.alertMinutes)).catch(() => {});
    return () => controller.abort();
  }, [supervisesSupport, authEpoch]);
  useSupportInboxAlerts(mData?.conversationsAvailable ? mData.conversations : null, session?.adminId ?? 0, supervisesSupport, alertMinutes);
  const [mLoading, setMLoading] = useState(true);
  const [mError, setMError] = useState<string | null>(null);
  const [uiParams, setUiParams] = useState<Record<string, string>>({});
  const mLoadCoordinator = useRef(new MDomainLoadCoordinator());
  const mDataAuthEpoch = useRef<number | null>(null);
  const currentAuthEpoch = useRef(authEpoch);
  currentAuthEpoch.current = authEpoch;
  const mDataRef = useRef<MContentData | null>(null);
  const [conversationSnapshotRevision, setConversationSnapshotRevision] = useState(0);
  const liveSnapshotController = useRef<AbortController | null>(null);
  const safeMData = mDataAuthEpoch.current === authEpoch ? mData : null;
  mDataRef.current = safeMData;

  useEffect(() => {
    setUiParams(session?.adminId ? readDockUi(session.adminId) : {});
  }, [authEpoch, session?.adminId]);

  const reloadMContent = useCallback(async (requireM5Snapshot = false) => {
    if (currentAuthEpoch.current !== authEpoch) {
      if (requireM5Snapshot) throw new Error("M5_SESSION_TEMPLATE_PROTOCOL_INVALID");
      return;
    }
    const generation = mLoadCoordinator.current.beginFullLoad();
    const isCurrent = () => currentAuthEpoch.current === authEpoch
      && mLoadCoordinator.current.isFullLoadCurrent(generation);
    liveSnapshotController.current?.abort();
    // A changed authenticated session must never inherit the previous
    // operator's seat authority.  Same-session refreshes retain only a
    // previously validated M1 roster while the next M1 read is still pending.
    if (mDataAuthEpoch.current !== authEpoch) {
      mDataAuthEpoch.current = authEpoch;
      setMData(null);
    }
    setMError(null);
    setMLoading(true);
    try {
      const next = await fetchMContentData((partial) => {
        if (!isCurrent()) return;
        setMData((previous) => preserveVerifiedSupportAgentsDuringReload(previous, partial));
      }, tab);
      if (!isCurrent()) {
        if (requireM5Snapshot) throw new Error("M5_SESSION_TEMPLATE_PROTOCOL_INVALID");
        return;
      }
      if (requireM5Snapshot && (!next.sessionTemplatesAvailable
        || session?.authorities.includes("service_m1_read") && !next.supportAgentsAvailable)) throw new Error("M5_SESSION_TEMPLATE_PROTOCOL_INVALID");
      setMData((previous) => preserveVerifiedSupportAgentsDuringReload(previous, next));
      setMError(null);
    } catch (error) {
      if (!isCurrent()) {
        if (requireM5Snapshot) throw error;
        return;
      }
      setMData((previous) => failClosedSupportAgentsAfterReload(previous));
      setMError(displayAdminError(error));
      if (requireM5Snapshot) throw error;
    } finally {
      if (isCurrent()) setMLoading(false);
    }
  }, [authEpoch, tab]);

  const refreshKnowledge = useCallback(async () => {
    const next = await readSupportKnowledge();
    if (currentAuthEpoch.current === authEpoch) setMData((previous) => previous && { ...previous, ...next });
  }, [authEpoch]);

  const refreshTemplates = useCallback(async () => {
    const next = await readSupportTemplates();
    if (currentAuthEpoch.current === authEpoch) setMData((previous) => previous && { ...previous, ...next });
  }, [authEpoch]);

  useEffect(() => {
    void reloadMContent();
  }, [authEpoch, reloadMContent]);

  const invalidateScope = useCallback((conversationNo?: string, customerId?: string, notice?: string, changedAssignmentKey?: string,
    knownThreads: Pick<SessionConvo, "id" | "customerId">[] = mDataRef.current?.conversations ?? [], assignmentId?: string) => {
    if (useAdminAuth.getState().session?.adminId !== session?.adminId) return;
    const actor = session?.adminId;
    if (changedAssignmentKey && actor) {
      const entry = readSavedSends(actor).find(item => item.row.commandKey === changedAssignmentKey);
      assignmentId = entry?.first?.assignmentId ?? entry?.reply?.expectedAssignmentId
        ?? failedDraftCopies.list().find(copy => copy.commandKey === changedAssignmentKey)?.assignmentId;
      if (!assignmentId) return;
    }
    if (notice) { lastOperationNotice = { adminId: session?.adminId, text: notice, tone: "danger" }; setOperationNotice(lastOperationNotice); }
    const cleared = session?.adminId ? redactCustomerSends(session.adminId, knownThreads, customerId, conversationNo, undefined, assignmentId) : undefined;
    customerId = cleared?.customerId ?? customerId;
    const affectedIds = cleared?.affected ?? [];
    if (cleared?.error) { lastOperationNotice = { adminId: session?.adminId, text: cleared.error, tone: "danger" }; setOperationNotice(lastOperationNotice); }
    if (actor && customerId && !assignmentId) {
      const customer = customerId;
      for (const row of readSavedSends(actor)) {
        const id = row.locator.conversationId;
        if (!id || row.locator.customerId || knownThreads.some(thread => thread.id === id)) continue;
        void fetchMConversationDetail(id, undefined, false).then(thread => {
          if (!thread.customerId || useAdminAuth.getState().authEpoch !== authEpoch) return;
          identifySavedCustomer(actor, row.row.commandKey, id, thread.customerId);
          if (thread.customerId === customer) redactCustomerSends(actor, [thread], customer, id, row.row.commandKey, row.reply?.expectedAssignmentId);
        }).catch(() => { /* No customer proof yet. Retain the original for the next snapshot. */ });
      }
    }
    if (assignmentId) {
      window.dispatchEvent(new CustomEvent("m3-assignment-invalidated", { detail: { conversationNo, customerId, changedAssignmentKey, cleared } }));
      return;
    }
    mLoadCoordinator.current.beginConversationSnapshot();
    liveSnapshotController.current?.abort();
    window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { conversationNo, customerId, cleared, changedAssignmentKey } }));
    setMData((previous) => previous ? {
      ...previous,
      conversations: previous.conversations.filter((conversation) =>
        conversationNo || customerId
          ? conversation.id !== conversationNo && conversation.customerId !== customerId
          : false),
      tickets: previous.tickets.map((ticket) =>
        !conversationNo && !customerId
          || Boolean(conversationNo && ticket.sourceConversationNo === conversationNo)
          || Boolean(customerId && ticket.sourceConversationNo !== "DIRECT" && String(ticket.userId) === customerId)
          ? { ...ticket, contentRestricted: true, subject: "私聊内容仅当前专属客服和客服主管可阅", messages: ticket.messages.filter((message) => message.author === "internal" || message.author === "system") }
          : ticket),
    } : previous);
    void reloadMContent();
    setUiParams((previous) => {
      if ((conversationNo || customerId) && previous[DOCK_LAST_KEY] !== conversationNo && !affectedIds.includes(previous[DOCK_LAST_KEY])) return previous;
      const next = { ...previous, [DOCK_LAST_KEY]: "", [DOCK_OPEN_KEY]: "0" };
      if (session?.adminId) saveDockUi(session.adminId, next);
      return next;
    });
  }, [reloadMContent, session?.adminId, authEpoch]);
  const reconcileConversationSnapshot = useCallback(async (signal: AbortSignal) => {
    const generation = mLoadCoordinator.current.beginConversationSnapshot();
    const snapshotAuthEpoch = authEpoch;
    const conversations = await fetchMConversationSnapshot(signal);
    if (signal.aborted) return;
    if (!mLoadCoordinator.current.isConversationSnapshotCurrent(generation) || mDataAuthEpoch.current !== snapshotAuthEpoch) {
      throw new Error("M3_CONVERSATION_SNAPSHOT_SUPERSEDED");
    }
    const previousThreads = mDataRef.current?.conversations ?? [];
    setConversationSnapshotRevision(revision => revision + 1);
    // Replace the scoped snapshot; never merge prior details (a scope change must not keep old private detail).
    // The open thread keeps its last loaded messages on screen while the detail reloads (M-9, m3-dedicated-chat).
    setMData((previous) => previous
      ? { ...previous, conversations, conversationsAvailable: true }
      : previous);
    if (!session?.adminId) return;
    const revoked = await revokedPrivateTargets(session.adminId, previousThreads, conversations, signal);
    if (!revoked.length || signal.aborted || useAdminAuth.getState().authEpoch !== snapshotAuthEpoch
      || !mLoadCoordinator.current.isConversationSnapshotCurrent(generation)) return;
    const knownThreads = [...previousThreads, ...conversations, ...revoked.flatMap(target =>
      target.conversationId ? [{ id: target.conversationId, customerId: target.customerId }] : [])];
    const clearedCustomers = new Set<string>();
    for (const { conversationId, customerId, assignmentId } of revoked) {
      const key = JSON.stringify([customerId ?? conversationId, assignmentId]);
      if (clearedCustomers.has(key)) continue;
      invalidateScope(conversationId, customerId, undefined, undefined, knownThreads, assignmentId);
      clearedCustomers.add(key);
    }
  }, [authEpoch, session?.adminId, invalidateScope]);
  const loadConversationDetail = useCallback(async (no: string, signal?: AbortSignal, includeCustomerProfile = true) => {
    const detailEpoch = authEpoch;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = mLoadCoordinator.current.captureConversationSnapshot();
      const detail = await fetchMConversationDetail(no, signal, includeCustomerProfile);
      if (signal?.aborted) return;
      if (mDataAuthEpoch.current !== detailEpoch) throw new Error("会话身份已变化，请重新打开会话。");
      if (!mLoadCoordinator.current.isConversationSnapshotCurrent(generation)) continue;
      const row = mDataRef.current?.conversations.find((conversation) => conversation.id === no);
      if (!row || row.version > detail.version || row.ownerAdminId !== detail.ownerAdminId || row.assignmentId !== detail.assignmentId) {
        throw new Error("会话归属或版本已变化，请刷新会话列表。");
      }
      setMData((previous) => {
        if (!previous) return previous;
        const index = previous.conversations.findIndex((conversation) => conversation.id === no);
        if (index < 0 || previous.conversations[index].version > detail.version || previous.conversations[index].ownerAdminId !== detail.ownerAdminId || previous.conversations[index].assignmentId !== detail.assignmentId) return previous;
        const conversations = previous.conversations.slice();
        // Message-only history reads must not replace an already verified profile with list placeholders.
        conversations[index] = includeCustomerProfile ? detail : { ...detail, profile: previous.conversations[index].profile, customer: previous.conversations[index].customer };
        return { ...previous, conversations };
      });
      return detail;
    }
    throw new Error("会话列表正在刷新，请稍后再打开详情。");
  }, [authEpoch]);
  const reconcileLiveConversationSnapshot = useCallback(async (connectionSignal: AbortSignal) => {
    if (connectionSignal.aborted) return;
    liveSnapshotController.current?.abort();
    const controller = new AbortController();
    liveSnapshotController.current = controller;
    const abortSnapshot = () => controller.abort();
    connectionSignal.addEventListener("abort", abortSnapshot, { once: true });
    if (connectionSignal.aborted) controller.abort();
    try {
      await reconcileConversationSnapshot(controller.signal);
    } finally {
      connectionSignal.removeEventListener("abort", abortSnapshot);
      if (liveSnapshotController.current === controller) liveSnapshotController.current = null;
    }
  }, [reconcileConversationSnapshot]);
  useEffect(() => () => liveSnapshotController.current?.abort(), []);

  const detailReads = useRef(new Map<string, { again: boolean }>());
  // M3 即时会话 SSE 订阅：后端 OpsConversationStreamController 推 ConversationMessageEvent。
  // 增量合并进 mData.conversations —— 直接 setMData，绕开 runMWrite 写链（避免被 writeConversationRows
  // 当成「坐席新回复」二次回写后端，形成回环）。收到事件后 mergedParams 自动重算 → M3 / Dock 重渲。
  const handleStreamEvent = useCallback(async (event: ConversationStreamEvent, connectionSignal: AbortSignal) => {
    if (connectionSignal.aborted) return;
    // M-31: a message or receipt on a conversation we already hold re-reads only that conversation, as long as it is
    // the customer's only thread here (a reply can also clear pending messages on the customer's older threads).
    // Bursts on one conversation share one read plus one trailing read. Ownership changes, new conversations and
    // anything unexpected still reconcile the whole inbox.
    const held = mDataRef.current?.conversations;
    const target = held?.find((conversation) => conversation.id === event.conversationNo);
    const onlyThread = Boolean(target && !held!.some((conversation) => conversation.id !== target.id && conversation.customerId && conversation.customerId === target.customerId));
    if ((event.eventType === "MESSAGE" || event.eventType === "RECEIPT") && onlyThread) {
      try {
        const reads = detailReads.current, running = reads.get(event.conversationNo);
        if (running) { running.again = true; return; }
        const state = { again: false };
        reads.set(event.conversationNo, state);
        try {
          do { state.again = false; await loadConversationDetail(event.conversationNo, connectionSignal); } while (state.again && !connectionSignal.aborted);
        } finally { reads.delete(event.conversationNo); }
        return;
      } catch {
        if (connectionSignal.aborted) return;
      }
    }
    if (
      event.eventType === "RECEIPT"
      || event.eventType === "MESSAGE"
      || event.eventType === "STATUS"
      || event.eventType === "INITIATE"
      || event.senderType === "SYSTEM"
    ) {
      // 回执、终态和系统定时任务统一回读权威快照：不靠正文猜状态，也不把
      // 系统提醒当作坐席消息推进前端 lastTs。
      await reconcileLiveConversationSnapshot(connectionSignal);
      return;
    }
    if (!mDataRef.current?.conversations.some((conversation) => conversation.id === event.conversationNo)) {
      await reconcileLiveConversationSnapshot(connectionSignal);
      return;
    }
    setMData((prev) => {
      if (!prev) return prev;
      const idx = prev.conversations.findIndex((c) => c.id === event.conversationNo);
      if (idx === -1) return prev;
      const convo = prev.conversations[idx];
      const eventTs = event.ts ? new Date(event.ts).getTime() : Date.now();
      let nextConvo: SessionConvo = convo;

      if (event.eventType === "MESSAGE" || event.eventType === "INITIATE") {
        const sender: "user" | "agent" = event.senderType === "USER" ? "user" : "agent";
        const text = event.body ?? "";
        // 去重：同 ts + 同正文已存在则不重复 push（本坐席自己发的回复会经 SSE 回环）。
        const dup = containsConversationMessage(convo.messages, {
          messageId: event.messageId,
          ts: eventTs,
          body: text,
        });
        if (!dup) {
          const msg: SessionMsg = {
            id: event.messageId,
            ts: eventTs,
            sender,
            agentName: sender === "agent" ? (event.senderName ?? convo.agentName) : undefined,
            text,
          };
          nextConvo = {
            ...convo,
            messages: [...convo.messages, msg],
            lastTs: eventTs,
            unread: sender === "user" ? convo.unread + 1 : convo.unread,
          };
        }
      } else if (event.eventType === "TRANSFER") {
        // 转交态（from/to/reason）由后端快照权威表达；此处仅扰动 lastTs 让 UI 重渲，
        // 具体 transfer 字段等下一次 reloadMContent 同步，避免本地推断错位。
        nextConvo = { ...convo, lastTs: eventTs };
      }

      if (nextConvo === convo) return prev;
      const conversations = prev.conversations.slice();
      conversations[idx] = nextConvo;
      return { ...prev, conversations };
    });
  }, [reconcileLiveConversationSnapshot, loadConversationDetail]);
  // 鉴权：走同源 cookie（nexion_admin_token 由 Next route 转 Authorization 头）。
  // 仅走同源 httpOnly cookie 代理；JWT 永不进入 SSE URL。
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const m3RecoveryEnabled = shouldStartM3ConversationRecovery({
    hasM3ReadAuthority: authorities.includes("service_m3_read"),
    hasMContentSnapshot: Boolean(safeMData),
    isMContentLoading: mLoading,
  });
  const { ready: conversationStreamReady, reconnectExhausted, retry: retryConversationStream } = useConversationStream({
    onEvent: handleStreamEvent,
    onReconnectSnapshot: reconcileConversationSnapshot,
    onScopeInvalidated: invalidateScope,
    lifecycleSignal: mLoadCoordinator.current.conversationStreamSignal,
    enabled: m3RecoveryEnabled,
  });

  const legacyParams = useMemo(() => (safeMData ? buildMLegacyParams(safeMData) : {}), [safeMData]);
  const mergedParams = useMemo(
    () => ({ ...uiParams, ...legacyParams }),
    [uiParams, legacyParams],
  );
  // Preserve the key for the same logical command until the backend confirms success.
  // 命令号本身走 mCommands(sessionStorage);下面两张只缓存回显文案与 diff 基线,
  // 丢了不会重复入账,且 baselines 装的是整份 MContentData —— 刻意不持久化。
  const pendingMCommandMetadata = useRef(new Map<string, { action?: string; reason?: string }>());
  const pendingMCommandBaselines = useRef(new Map<string, { legacyParams: Record<string, string>; data: MContentData | null }>());
  const m3WriteQualifiedRef = useRef({ authEpoch, adminId: session?.adminId, qualified: false });
  const superOperator = session?.role === "super" || session?.role === "superadmin";
  m3WriteQualifiedRef.current = { authEpoch, adminId: session?.adminId, qualified: Boolean(session?.adminId
    && (superOperator || session?.authorities?.includes("service_m3_write"))
    && (superOperator || !session?.authorities?.includes("service_m1_read") || safeMData?.supportAgentsAvailable)) };

  const runMWrite = useCallback(
    async (key: string, value: string, meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void; onFailure?: (message: string) => void }): Promise<boolean> => {
      if (isMUiKey(key)) {
        setUiParams((prev) => {
          const next = { ...prev, [key]: value };
          if (session?.adminId) saveDockUi(session.adminId, next);
          return next;
        });
        return true;
      }
      if (["I.session.convos", "I.session.ticket.__create", "I.session.archiveBatch.__create"].includes(key)
        && (!m3WriteQualifiedRef.current.qualified || m3WriteQualifiedRef.current.authEpoch !== authEpoch || m3WriteQualifiedRef.current.adminId !== session?.adminId)) {
        setToast(!session?.adminId || m3WriteQualifiedRef.current.authEpoch !== authEpoch || m3WriteQualifiedRef.current.adminId !== session?.adminId
          ? "当前登录身份未读取或已变化，暂不能执行此操作。请刷新页面重新登录后再操作。"
          : !superOperator && !session?.authorities?.includes("service_m3_write")
            ? "当前账号没有专属会话操作权限，暂不能执行此操作。请联系管理员核对账号权限。"
            : "当前坐席资料未成功读取，暂不能执行此操作。请刷新页面重新读取；仍失败时请联系管理员核对坐席配置。", "warn");
        return false;
      }
      const fingerprint = `${key}\u0000${value}\u0000${meta?.reason?.trim() ?? ""}`;
      const requestedFingerprint = meta?.commandKey ?? fingerprint;
      const closeMatch = key === "I.session.convos" ? /^m3:close:(.+):(\d+)$/.exec(requestedFingerprint) : null;
      const confirming = closeMatch ? actionConfirmRunRef.current : null;
      const records = mCommands.list();
      // Resolve an earlier end command before accepting a later version of that same conversation.
      const attempt = records.filter((record) => record.fingerprint === commandSlot(requestedFingerprint)
        || Boolean(closeMatch && /^cmd\|m3:close:(.+):\d+$/.exec(record.fingerprint)?.[1] === closeMatch[1]))
        .sort((left, right) => left.createdAt - right.createdAt)[0];
      const commandFingerprint = attempt?.fingerprint.slice("cmd|".length) ?? requestedFingerprint;
      const idempotencyKey = attempt?.commandKey
        ?? meta?.idempotencyKey
        ?? records.find((record) => record.paramFingerprint === fingerprint)?.commandKey
        ?? `m-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      if (attempt && isRetryExpired(attempt)) {
        if (meta?.onFailure) meta.onFailure(RETRY_EXPIRED_TEXT); else setToast(RETRY_EXPIRED_TEXT, "warn");
        return false;
      }
      const stableValue = attempt?.value ?? value;
      // Legacy paramFingerprint can contain a later retry's input, not the original wire reason.
      const closeReason = attempt ? attempt.closeReason : meta?.reason;
      const closeBaseline = closeMatch ? originalM3CloseBaseline(commandFingerprint, stableValue) : undefined;
      if (closeMatch && (attempt && attempt.value === undefined || !closeBaseline || closeReason === undefined)) {
        setToast("原会话结束请求的版本或理由无法核对，请保留原操作并核对结果。", "warn");
        return false;
      }
      const savedMetadata = pendingMCommandMetadata.current.get(commandFingerprint) ?? { action: meta?.action, reason: meta?.reason };
      const stableMetadata = closeMatch ? { ...savedMetadata, reason: closeReason } : savedMetadata;
      const savedBaseline = pendingMCommandBaselines.current.get(commandFingerprint) ?? { legacyParams, data: safeMData };
      const stableBaseline = closeBaseline
        ? { ...savedBaseline, legacyParams: { ...savedBaseline.legacyParams, [key]: closeBaseline } }
        : savedBaseline;
      mCommands.remember(commandSlot(commandFingerprint), idempotencyKey, { value: stableValue, paramFingerprint: attempt?.paramFingerprint ?? fingerprint, ...(closeMatch ? { closeReason: reasonOf(stableMetadata) } : {}) });
      pendingMCommandMetadata.current.set(commandFingerprint, stableMetadata);
      pendingMCommandBaselines.current.set(commandFingerprint, stableBaseline);
      let writeConfirmed = false;
      try {
        const backendResult = await applyMBackendWrite(key, stableValue, stableBaseline.legacyParams, stableBaseline.data, { ...meta, ...stableMetadata, idempotencyKey });
        writeConfirmed = true;
        if (key === "I.session.convos" || key === "I.session.archiveBatch.__create") {
          lastOperationNotice = { adminId: session?.adminId, text: closeMatch ? "会话已标记为已解决。" : `${meta?.action || "会话操作"}已完成。`, tone: "progress" };
          setOperationNotice(lastOperationNotice);
        }
        await reloadMContent();
        mCommands.forget(commandSlot(commandFingerprint));
        pendingMCommandMetadata.current.delete(commandFingerprint);
        pendingMCommandBaselines.current.delete(commandFingerprint);
        if (commandFingerprint !== requestedFingerprint) {
          if (confirming) setActionConfirm((current) => current === confirming ? null : current);
          setToast("原会话结束操作已确认，请刷新后重新确认当前会话。", "info");
          return false;
        }
        meta?.onBackendResult?.(backendResult);
        return true;
      } catch (error) {
        // Only the status write's explicit state rejection settles this receipt. Preread,
        // network, 5xx and idempotency-unknown failures do not prove the original command failed.
        const rejected = !writeConfirmed && closeMatch && error instanceof MContentReadError
          && error.apiCode === 409 && [200, 409].includes(error.status) && error.backendMessage === "INVALID_STATE_TRANSITION";
        if (rejected) {
          mCommands.forget(commandSlot(commandFingerprint), idempotencyKey);
          pendingMCommandMetadata.current.delete(commandFingerprint);
          pendingMCommandBaselines.current.delete(commandFingerprint);
          if (confirming) setActionConfirm((current) => current === confirming ? null : current);
        }
        await reloadMContent();
        const message = displayAdminError(error);
        // client 已接咽喉,英文网络错误不再到达;按原压制意图改判「咽喉网络中文」,命中仍不附加 detail。
        const detail = message.includes("网络连接失败或系统暂时连不上") ? "" : ` · ${message}`;
        const failure = rejected ? `后台明确拒绝原会话结束操作，请核对当前会话后重新确认${detail}` : refusedWrite(error) ? `后台拒绝了这次操作${detail}` : `结果未知${detail.replace(/。$/, "")}。再点确认会按原请求重试`;
        if (meta?.onFailure) meta.onFailure(failure); else setToast(failure, rejected || refusedWrite(error) ? "error" : "warn");
        return false;
      }
    },
    [legacyParams, safeMData, reloadMContent, setToast, session?.adminId, authEpoch],
  );

  const runM3DirectWrite = useCallback(async (
    fingerprint: string,
    write: (idempotencyKey: string, originalValue?: string) => Promise<unknown>,
    failureMessage: string,
    value?: string,
    onFailure?: (message: string) => void,
  ): Promise<boolean> => {
    if (currentAuthEpoch.current !== authEpoch) return false;
    const slot = directWriteSlot(fingerprint);
    const original = mCommands.list().find((record) => record.fingerprint === slot);
    const idempotencyKey = original?.commandKey
      ?? `m3-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    if (original && isRetryExpired(original)) {
      if (onFailure) onFailure(RETRY_EXPIRED_TEXT); else setToast(RETRY_EXPIRED_TEXT, "warn");
      return false;
    }
    const originalValue = original ? original.value : value;
    mCommands.remember(slot, idempotencyKey, { value: originalValue });
    const usingOriginalReason = Boolean(original && value !== undefined && value !== originalValue);
    if (usingOriginalReason) setToast("正在核对原删除请求，继续使用原提交理由。", "info");
    try {
      await write(idempotencyKey, originalValue);
      mCommands.forget(slot);
      if (currentAuthEpoch.current !== authEpoch) return false;
      // A full progressive reload briefly publishes an empty conversation list,
      // unmounting the open profile and discarding its other annotation draft.
      // Reconcile one complete, epoch/generation-checked conversation snapshot.
      try {
        await reconcileConversationSnapshot(new AbortController().signal);
      } catch (error) {
        if (currentAuthEpoch.current !== authEpoch) return false;
        if (error instanceof MContentReadError && [403, 404].includes(error.status)) invalidateScope();
        lastOperationNotice = { adminId: session?.adminId, text: `客户标注已保存，但会话刷新失败，请手动刷新 · ${displayAdminError(error)}`, tone: "warn" };
        setOperationNotice(lastOperationNotice);
        return true;
      }
      lastOperationNotice = { adminId: session?.adminId, text: "客户标注已保存。", tone: "progress" };
      setOperationNotice(lastOperationNotice);
      return true;
    } catch (error) {
      if (currentAuthEpoch.current !== authEpoch) return false;
      if (!original && refusedWrite(error)) mCommands.forget(slot, idempotencyKey);
      const failure = refusedWrite(error) ? `${failureMessage}：${displayAdminError(error)}` : `${failureMessage}或结果未知 · ${displayAdminError(error)}${usingOriginalReason ? " · 继续使用原提交理由核对结果" : ""}`;
      if (onFailure) onFailure(failure); else setToast(failure, refusedWrite(error) ? "error" : "warn");
      return false;
    }
  }, [authEpoch, reconcileConversationSnapshot, invalidateScope, setToast, session?.adminId, session?.authorities, superOperator]);

  // 客户标签/备注持久化后刷新完整会话快照；资料编辑器另行回读当前客户资料。
  // 即时标注使用描述性理由；备注删除透传确认理由，并随原命令保留以便未知结果重试。
  const addCustomerTag = useCallback(async (convoId: string, tag: string): Promise<boolean> => {
    return runM3DirectWrite(
      `m3:add-tag:${convoId}:${tag}`,
      (idempotencyKey) => mContentActions.addCustomerTag(convoId, tag, "客服添加客户标签", idempotencyKey),
      "客户标签保存失败",
    );
  }, [runM3DirectWrite]);
  const removeCustomerTag = useCallback(async (convoId: string, tag: string): Promise<boolean> => {
    return runM3DirectWrite(
      `m3:remove-tag:${convoId}:${tag}`,
      (idempotencyKey) => mContentActions.removeCustomerTag(convoId, tag, "客服移除客户标签", idempotencyKey),
      "客户标签移除失败",
    );
  }, [runM3DirectWrite]);
  const addCustomerNote = useCallback(async (convoId: string, text: string): Promise<boolean> => {
    return runM3DirectWrite(
      `m3:add-note:${convoId}:${text}`,
      (idempotencyKey) => mContentActions.addCustomerNote(convoId, text, "客服新增客户备注", idempotencyKey),
      "客户备注保存失败",
    );
  }, [runM3DirectWrite]);
  const removeCustomerNote = useCallback(async (convoId: string, noteId: string, reason = "客服删除客户备注", onFailure?: (message: string) => void): Promise<boolean> => {
    return runM3DirectWrite(
      `m3:remove-note:${convoId}:${noteId}`,
      // Pending records from before reason persistence used this fixed reason on their original wire.
      (idempotencyKey, originalReason) => mContentActions.removeCustomerNote(convoId, noteId, originalReason ?? "客服删除客户备注", idempotencyKey),
      "客户备注删除失败",
      reason,
      onFailure,
    );
  }, [runM3DirectWrite]);
  const ctx: MCtx = {
    actionConfirm: mc,
    unboundAlertMinutes: alertMinutes,
    pget: (k) => mergedParams[k] as string | undefined,
    params: mergedParams,
    setParam: runMWrite,
    refreshConversations: async () => {
      const controller = new AbortController();
      try { await reconcileConversationSnapshot(controller.signal); }
      catch (cause) {
        // A newer snapshot is already loading and will land instead; that is not a failure (M-10).
        if (cause instanceof Error && cause.message === "M3_CONVERSATION_SNAPSHOT_SUPERSEDED") return;
        throw cause;
      }
    },
    refreshContent: reloadMContent,
    refreshM5Content: () => reloadMContent(true),
    contentLoading: mLoading,
    refreshKnowledge,
    refreshTemplates,
    loadConversationDetail,
    invalidateScope,
    commandExpired: (part: string) => mCommands.list().some((record) => record.fingerprint.includes(part) && isRetryExpired(record)),
    addCustomerTag,
    removeCustomerTag,
    addCustomerNote,
    removeCustomerNote,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    closeActionConfirm: () => setActionConfirm(null),
    openConfirm: setCf,
  };

  const permissionUnknown = session?.role !== "superadmin" && session?.role !== "super"
    && session?.role === "support" && session.supportReadModes === undefined;
  const permission = session?.role === "superadmin" || session?.role === "super"
    ? "superadmin"
    : session?.supportReadModes?.includes("MANAGED")
      ? "supervisor" : "agent";

  // 实时计数:M1/M2/M3 的「实时计数/汇总」从后端会话 / 工单快照派生;
  // M4/M5 是描述标签(未声称计数)保留原文。
  const liveCount = useMemo(() => {
    if (tab !== "M2") return null;
    const convos = dockParseConvos(mergedParams["I.session.convos"] as string | undefined);
    const tickets = parseTicketsLive(mergedParams["I.support.tickets"] as string | undefined);
    const openConvos = convos.filter((c) => c.status === "open" && !c.archived).length;
    const unreadConvos = convos.filter((c) => c.unread > 0 && !c.archived).length;
    const openTickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
    const ticketsAvailable = mergedParams["I.support.ticketsAvailable"] === "1";
    const conversationsAvailable = mergedParams["I.session.conversationsAvailable"] === "1";
    if (tab === "M2" && !ticketsAvailable) return "工单数据不可用";
    if (tab === "M2") return `处理中工单 ${openTickets}`;
    return null;
  }, [tab, mergedParams]);
  // M-44: only a live figure earns header space; the fixed descriptive tags repeated the page summary.
  const right = liveCount ? <span className="f-live"><span className="dot" />{liveCount}</span> : null;
  const backToCustomers = fromCustomers ? <Link className="m-back-link" href="/service/overview?view=customers&restore=customers">‹ 返回负责组客户</Link> : undefined;
  // 这三条提醒说的是整页的数据，放在专属会话的页头下面。
  const shownOperationNotice = operationNotice?.adminId === session?.adminId ? operationNotice?.text : "";
  const m3Banner = tab === "M3" && (mError || permissionUnknown || reconnectExhausted || shownOperationNotice) ? <>
    {shownOperationNotice && <Notice tone={operationNotice?.tone ?? "danger"} action={<Button size="sm" onClick={() => { lastOperationNotice = null; setOperationNotice(null); }}>知道了</Button>}>{shownOperationNotice}</Notice>}
    {mError && <Notice tone="danger" action={<Button size="sm" onClick={() => void reloadMContent()}>重试</Button>}>客服中心暂时无法同步数据,请稍后重试。</Notice>}
    {permissionUnknown && <Notice tone="warn" action={<Button size="sm" onClick={() => void reloadMContent()}>重试核对</Button>}>当前账号的客服查看范围未读取，对客操作和管理入口已暂停。请刷新页面重新读取登录权限。</Notice>}
    {reconnectExhausted && <Notice tone="danger" action={<Button size="sm" onClick={retryConversationStream}>重新连接</Button>}>会话更新已暂停，当前信息可能不是最新状态。请点击“重新连接”或刷新页面。</Notice>}
  </> : null;

  const page = (
    <>
      {tab !== "M3" && tab !== "M1" && tab !== "M4" && tab !== "M5" && <DomainHeader {...meta} right={right} back={backToCustomers} />}
      {tab !== "M3" && shownOperationNotice && <Notice tone={operationNotice?.tone ?? "danger"} action={<>{operationNotice?.tone === "danger" && <Link className="rd-link" href="/service/sessions">去专属会话处理</Link>}<Button size="sm" onClick={() => { lastOperationNotice = null; setOperationNotice(null); }}>知道了</Button></>}>{shownOperationNotice}</Notice>}
      {tab === "M3" && !safeMData && <PageHeader pageId="M3" title="专属会话" summary={M3_SUMMARY} back={backToCustomers} />}

      {tab !== "M3" && tab !== "M4" && tab !== "M5" && mError && (
        <div className="card card-pad" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="bell" size={16} />
          <span className="dim" style={{ fontSize: 13 }}>客服中心暂时无法同步数据,请稍后重试。</span>
          <span className="sp" />
          <button type="button" className="btn btn-sec btn-sm" onClick={() => void reloadMContent()}>
            <Icon name="arrow" size={16} />
            重试
          </button>
        </div>
      )}
      {(permissionUnknown && (tab === "M1" || tab === "M2") || tab === "M2" && safeMData && !safeMData.supportAgentsAvailable) && <div className="card card-pad" role="status">坐席身份暂时无法核对，对客操作和管理入口已暂缓显示。<button type="button" className="btn btn-sec btn-sm" onClick={() => void reloadMContent()}>重试核对</button></div>}

      {tab === "M3" && !safeMData && m3Banner}
      {tab === "M3" && !reconnectExhausted && safeMData?.conversationsAvailable && (
        <span className="sr-only" aria-live="polite">{conversationStreamReady ? "实时会话已连接" : "连接已断开，正在重连；下面是最近一次的数据"}</span>
      )}

      {tab === "M1" && <M1AnalyticsWorkbench key={authEpoch} permission={permission} ctx={ctx} />}
      {tab === "M4" && <M4KbSla ctx={ctx} title={meta.l2Name} summary={meta.summary} loadError={mError} />}
      {tab === "M5" && <M5Page ctx={ctx} permission={permission} permissionUnknown={permissionUnknown} hasData={Boolean(safeMData)} loading={mLoading} loadError={mError} title={meta.l2Name} summary={meta.summary} authEpoch={authEpoch} />}
      {tab !== "M1" && tab !== "M4" && tab !== "M5" && !safeMData ? (
        <div className="card card-pad">
          <span className="dim" style={{ fontSize: 13 }}>
            {mError ? "客服中心暂时无法同步数据,请稍后重试。" : mLoading ? "正在加载客服中心…" : "暂无可展示的客服信息"}
          </span>
        </div>
      ) : safeMData && (
        <>
          {tab === "M2" && <p>工单服务已下线，请通过客户会话继续联系。</p>}
          {tab === "M3" && <M3DedicatedChat ctx={ctx} snapshotRevision={conversationSnapshotRevision} back={backToCustomers} summary={M3_SUMMARY} banner={m3Banner} streamReady={conversationStreamReady} reconnectExhausted={reconnectExhausted} />}
        </>
      )}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          getPendingReason={tab === "M4" || tab === "M5" ? mc.getPendingReason : undefined}
          initialReason={tab === "M4" || tab === "M5" ? mc.initialReason : undefined}
          title={mc.title}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          briefKind={mc.briefKind}
          effect={mc.effect}
          confirmLabel={mc.confirmLabel}
          confirmTone={mc.confirmTone}
          blockedReason={mc.blockedReason}
          facts={mc.facts}
          statedBrief={mc.statedBrief}
          reasonPlaceholder={mc.reasonPlaceholder}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            const confirming = mc;
            actionConfirmRunRef.current = confirming;
            try {
              const succeeded = await mc.run(reason, newValue, businessValue);
              if (succeeded !== false) setActionConfirm((current) => current === confirming ? null : current);
            } finally {
              if (actionConfirmRunRef.current === confirming) actionConfirmRunRef.current = null;
            }
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {safeMData && <SessionDock snapshotRevision={conversationSnapshotRevision} key={JSON.stringify([authEpoch, session?.adminId, mergedParams[DOCK_LAST_KEY], tab === "M3"])} ctx={ctx} hidden={tab === "M3"} onScopeInvalidated={invalidateScope} />}
      {toastNode}
    </>
  );
  return tab === "M3" || tab === "M1" || tab === "M4" || tab === "M5" ? <RdPage className={tab === "M4" ? "mdom m4-page" : tab === "M5" ? "mdom m5-page" : "mdom"}>{page}</RdPage> : <div className="dkpage mdom">{page}</div>;
}

/* ============ MP2 持续接待 dock —— 切页不挂断(M3 自身是全屏对话台,故 M3 不显)============ */
function parseTicketsLive(raw: string | undefined): SupportTicket[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SupportTicket[]) : [];
  } catch {
    return [];
  }
}

function parseRows<T>(raw: string | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function originalM3CloseBaseline(commandFingerprint: string, value: string): string | undefined {
  const match = /^m3:close:(.+):(\d+)$/.exec(commandFingerprint);
  const version = Number(match?.[2]);
  const rows = parseRows<SessionConvo>(value);
  const target = match && rows.find((row) => row?.id === match[1]);
  if (!target || !Number.isSafeInteger(version) || version < 0 || target.version !== version
    || !["closed", "resolved"].includes(target.status)) return undefined;
  // This exact action is available only on an OPEN segment. The original value carries its CAS.
  return JSON.stringify(rows.map((row) => row?.id === target.id ? { ...row, status: "open" } : row));
}

function parseRecord<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as T) : null;
  } catch {
    return null;
  }
}

function isMUiKey(key: string) {
  return key === DOCK_LAST_KEY || key === DOCK_OPEN_KEY || key === DOCK_OFF_KEY;
}

function reasonOf(meta?: { action?: string; reason?: string; idempotencyKey?: string }) {
  const r = meta?.reason?.trim();
  return r && r !== "ui-state" && r.length >= 2 ? r : "M 客服中心后台操作留档";
}

function changedRow<T extends { id: string }>(prev: T[], next: T[]) {
  return next.find((row) => {
    const before = prev.find((item) => item.id === row.id);
    return before && JSON.stringify(before) !== JSON.stringify(row);
  });
}

function addedRow<T extends { id: string }>(prev: T[], next: T[]) {
  return next.find((row) => !prev.some((item) => item.id === row.id));
}

function userIdFromProfile(convo: SessionConvo) {
  const raw = convo.profile?.uid || "";
  const match = raw.match(/\d+/);
  return match ? Number(match[0]) : undefined;
}

function firstAgentText(convo: SessionConvo) {
  return convo.messages.find((m) => m.sender === "agent" && m.sourceSenderType !== "SYSTEM" && m.kind !== "AGENT_SWITCH" && m.agentName !== "系统")?.text || convo.messages.at(-1)?.text || "客服已主动发起会话";
}

function ticketBody(ticket: SupportTicket) {
  return ticket.messages[0]?.body || ticket.subject || "客服工单已创建";
}

async function writeTicketRows(
  prev: SupportTicket[],
  next: SupportTicket[],
  reason: string,
  action?: string,
  data?: MContentData | null,
  idempotencyKey?: string,
) {
  const added = addedRow(prev, next);
  if (added) {
    const addedOwnerAdminId = added.ownerAdminId;
    if (typeof addedOwnerAdminId !== "number" || !Number.isSafeInteger(addedOwnerAdminId) || addedOwnerAdminId <= 0) {
      throw new Error("M2_TICKET_ASSIGNEE_ID_MISSING");
    }
    const fromConvo = added.subject.match(/由会话\s+([^\s]+)\s+转入/);
    if (fromConvo?.[1]) {
      const sourceConversation = data?.conversations.find((conversation) => conversation.id === fromConvo[1]);
      if (!sourceConversation) throw new Error("M3_TICKET_CONVERSION_SNAPSHOT_MISSING");
      await mContentActions.convertConversationToTicket(
        fromConvo[1],
        {
          category: added.category,
          priority: added.priority,
          title: added.subject,
          assignedAdminId: addedOwnerAdminId,
          assignedAdminName: added.owner || "Unassigned",
          expectedStatus: sourceConversation.status,
          expectedVersion: sourceConversation.version,
        },
        reason,
        idempotencyKey,
      );
      return;
    }
    await mContentActions.createTicket(
      {
        userId: added.userId,
        category: added.category,
        priority: added.priority,
        title: added.subject,
        body: ticketBody(added),
        assignedAdminId: addedOwnerAdminId,
        assignedAdminName: added.owner || "Unassigned",
      },
      reason,
      idempotencyKey,
    );
    return;
  }

  const row = changedRow(prev, next);
  if (!row) return;
  const before = prev.find((item) => item.id === row.id);
  if (!before) return;
  const newMessage = row.messages.length > before.messages.length ? row.messages[row.messages.length - 1] : null;
  if (newMessage?.author === "agent") {
    await mContentActions.replyTicket(row.id, newMessage.body, before.status, before.version, reason, idempotencyKey);
    return;
  }
  if (row.status !== before.status) {
    await mContentActions.updateTicketStatus(row.id, row.status, before.status, before.version, reason, idempotencyKey);
    return;
  }
  if (row.priority !== before.priority) {
    await mContentActions.updateTicketPriority(row.id, row.priority, before.status, before.version, reason, idempotencyKey);
    return;
  }
  if (row.ownerAdminId !== before.ownerAdminId) {
    const nextOwnerAdminId = row.ownerAdminId;
    if (typeof nextOwnerAdminId !== "number" || !Number.isSafeInteger(nextOwnerAdminId) || nextOwnerAdminId <= 0) {
      throw new Error("M2_TICKET_ASSIGNEE_ID_MISSING");
    }
    await mContentActions.assignTicket(
      row.id,
      row.owner,
      nextOwnerAdminId,
      before.status,
      before.version,
      reason,
      idempotencyKey,
    );
    return;
  }
  if (Boolean(row.archived) !== Boolean(before.archived)) {
    await mContentActions.archiveTicket(
      row.id,
      Boolean(row.archived),
      before.status,
      before.version,
      reason,
      idempotencyKey,
    );
    return;
  }
  if (action?.includes("conversation_from_ticket")) return;
  await mContentActions.replyTicket(
    row.id,
    "工单信息已同步更新",
    before.status,
    before.version,
    reason,
    idempotencyKey,
  );
}

async function writeConversationRows(prev: SessionConvo[], next: SessionConvo[], reason: string, action?: string, data?: MContentData | null, idempotencyKey?: string) {
  const added = addedRow(prev, next);
  if (added) {
    throw new Error("请从本人客户详情发起新会话，当前入口不能指定专属客服");
  }

  const row = changedRow(prev, next);
  if (!row) return;
  const before = prev.find((item) => item.id === row.id);
  if (!before) return;
  const currentAdminId = useAdminAuth.getState().session?.adminId;
  if (!before.customerId || !currentAdminId || before.ownerAdminId !== currentAdminId) {
    throw new Error("当前账号不是该客户的专属客服，不能执行对客操作");
  }
  const owner = await supportClient.customerDetail(before.customerId);
  if (owner.agentAdminId !== currentAdminId || !owner.assignmentId) throw new Error("客户归属已变化，请刷新后重试");

  if (!before.transfer && row.transfer) {
    throw new Error("请由客服主管使用正式转绑入口");
  }
  if (before.transfer && !row.transfer) {
    throw new Error("旧会话转接已停用，请联系主管正式转绑");
  }
  if (before.transfer && row.transfer && JSON.stringify(before.transfer) !== JSON.stringify(row.transfer)) {
    throw new Error("旧会话转接已停用，请联系主管正式转绑");
  }

  const newMessage = row.messages.length > before.messages.length ? row.messages[row.messages.length - 1] : null;
  if (newMessage?.sender === "agent") {
    if (!newMessage.clientMessageId) throw new Error("消息缺少稳定提交编号，请保留草稿重试");
    if (newMessage.kind === "IMAGE" && !newMessage.attachmentId) throw new Error("图片尚未上传成功");
    const body = newMessage.ctaHref ? `${newMessage.text} ${newMessage.ctaHref}` : newMessage.text;
    await mContentActions.replyConversation(row.id, body, before.status, before.version, reason, idempotencyKey, {
      kind: newMessage.kind,
      attachmentId: newMessage.attachmentId,
      intent: newMessage.intent,
      clientMessageId: newMessage.clientMessageId,
      replyTargets: newMessage.replyTargets,
      expectedAssignmentId: owner.assignmentId,
    });
    return;
  }
  if (row.status !== before.status) {
    await mContentActions.updateConversationStatus(row.id, row.status, before.status, before.version, reason, idempotencyKey);
    return;
  }
  if (Boolean(row.archived) !== Boolean(before.archived)) {
    await mContentActions.archiveConversation(row.id, Boolean(row.archived), before.status, before.version, reason, idempotencyKey);
    return;
  }
  // 客户标签(customTags)与备注(notes)走 ctx.addCustomerTag/addCustomerNote 专用端点持久化,
  // 不经会话写链,不污染会话消息流。此处无需处理 profile 字段变化。
}

function currentLoadPayload(data: MContentData | null): MLoadConfigWrite {
  if (!data) {
    throw new Error("M_LOAD_CONFIG_BACKEND_SNAPSHOT_MISSING");
  }
  const { version, ...loadConfig } = data.loadConfig;
  return {
    ...loadConfig,
    expectedVersion: version,
    agentState: data.agentState,
  };
}

async function applyMBackendWrite(
  key: string,
  value: string,
  legacyParams: Record<string, string>,
  data: MContentData | null,
  meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void; onFailure?: (message: string) => void },
) {
  const reason = reasonOf(meta);
  const idempotencyKey = meta?.idempotencyKey;
  if (key === "I.session.ticket.__create") {
    const payload = parseRecord<{
      conversationNo?: string;
      category?: SupportTicket["category"];
      priority?: SupportTicket["priority"];
      title?: string;
      assignedAdminId?: number;
      assignedAdminName?: string;
      expectedStatus?: SessionConvo["status"];
      expectedVersion?: number;
    }>(value);
    if (!payload?.conversationNo || !payload.category || !payload.priority || !payload.title || !payload.expectedStatus || !Number.isSafeInteger(payload.expectedVersion)) throw new Error("M3_TICKET_CONVERSION_PAYLOAD_INVALID");
    return await mContentActions.convertConversationToTicket(payload.conversationNo, {
      category: payload.category,
      priority: payload.priority,
      title: payload.title,
      assignedAdminId: payload.assignedAdminId,
      assignedAdminName: payload.assignedAdminName || "Unassigned",
      expectedStatus: payload.expectedStatus,
      expectedVersion: payload.expectedVersion!,
    }, reason, idempotencyKey);
  }
  if (key === "I.session.archiveBatch.__create") {
    const payload = parseRecord<{ conversationNos?: string[]; expectedVersions?: Record<string, number> }>(value);
    if (!payload?.conversationNos?.length || !payload.expectedVersions || payload.conversationNos.some((id) => !Number.isSafeInteger(payload.expectedVersions?.[id]))) throw new Error("M3_ARCHIVE_BATCH_PAYLOAD_INVALID");
    await mContentActions.archiveConversations(payload.conversationNos, payload.expectedVersions, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.load.__bulk") {
    const payload = parseRecord<MLoadConfigWrite>(value);
    if (payload) await mContentActions.updateLoadConfig(payload, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.load.__rebalance") {
    const payload = parseRecord<{ rows?: Record<string, unknown>[]; expectedVersion?: number }>(value);
    if (!payload || !Array.isArray(payload.rows) || !Number.isSafeInteger(payload.expectedVersion) || payload.expectedVersion! < 0) {
      throw new Error("M_LOAD_REBALANCE_PAYLOAD_INVALID");
    }
    await mContentActions.rebalanceLoad(payload.rows, payload.expectedVersion!, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.agentProfile.__update") {
    const payload = parseRecord<{
      adminId?: number;
      serviceTypes?: Array<"support" | "advisor">;
      tags?: string[];
      maxConcurrent?: number;
      enabled?: boolean;
      transferable?: boolean;
      busy?: boolean;
      expectedVersion?: number;
    }>(value);
    if (payload?.adminId && Number.isSafeInteger(payload.expectedVersion)) {
      await mContentActions.updateSupportAgentProfile(payload.adminId, { ...payload, expectedVersion: payload.expectedVersion! }, reason, idempotencyKey);
    }
    return;
  }
  if (key === "I.support.advisorAssignment.__create") {
    const payload = parseRecord<{ adminId?: number; userId?: number; userIds?: number[] }>(value);
    const userIds = Array.isArray(payload?.userIds)
      ? payload.userIds
      : payload?.userId
        ? [payload.userId]
        : [];
    if (payload?.adminId && userIds.length > 0) await mContentActions.assignAdvisorUsers(payload.adminId, userIds, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.advisorAssignment.__delete") {
    const payload = parseRecord<{ adminId?: number; assignmentId?: number }>(value);
    if (payload?.adminId && payload.assignmentId) await mContentActions.deactivateAdvisorAssignment(payload.adminId, payload.assignmentId, reason, idempotencyKey);
    return;
  }
  if (key.startsWith("I.support.load.")) {
    const field = key.replace("I.support.load.", "") as keyof MLoadConfigWrite;
    const payload = currentLoadPayload(data);
    if (field === "autoBalance" || field === "quietHourBalance") (payload[field] as boolean) = value === "1";
    else if (field === "defaultCap" || field === "burstCap" || field === "warnPct") (payload[field] as number) = Number(value);
    else if (field === "overflowQueue") payload.overflowQueue = value;
    await mContentActions.updateLoadConfig(payload, reason, idempotencyKey);
    return;
  }
  const agentMatch = key.match(/^I\.support\.agent\.(.+)\.(cap|busy)$/);
  if (agentMatch) {
    const [, name, field] = agentMatch;
    const id = agentIdForName(name, data);
    const payload = currentLoadPayload(data);
    payload.agentState = { ...payload.agentState, [id]: { ...(payload.agentState[id] ?? { cap: payload.defaultCap, busy: false }) } };
    if (field === "cap") payload.agentState[id].cap = Number(value);
    else payload.agentState[id].busy = value === "1";
    await mContentActions.updateLoadConfig(payload, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.tickets") {
    await writeTicketRows(
      parseRows<SupportTicket>(legacyParams[key]),
      parseRows<SupportTicket>(value),
      reason,
      meta?.action,
      data,
      idempotencyKey,
    );
    return;
  }
  if (key === "I.support.ticketEscalation.__create") {
    const payload = parseRecord<{
      ticketNo?: string;
      ownerAgentId?: string;
      ownerAgentName?: string;
      expectedStatus?: SupportTicket["status"];
      expectedVersion?: number;
    }>(value);
    if (
      !payload?.ticketNo
      || !payload.ownerAgentId
      || !payload.expectedStatus
      || !Number.isSafeInteger(payload.expectedVersion)
      || Number(payload.expectedVersion) < 0
    ) throw new Error("M2_TICKET_ESCALATION_PAYLOAD_INVALID");
    await mContentActions.escalateTicket(
      payload.ticketNo,
      { ownerAgentId: payload.ownerAgentId, ownerAgentName: payload.ownerAgentName || "客服台" },
      payload.expectedStatus,
      Number(payload.expectedVersion),
      reason,
      idempotencyKey,
    );
    return;
  }
  if (key === "I.support.ticketInternalNote.__create") {
    const payload = parseRecord<{
      ticketNo?: string;
      body?: string;
      expectedStatus?: SupportTicket["status"];
      expectedVersion?: number;
    }>(value);
    if (
      !payload?.ticketNo
      || !payload.body?.trim()
      || !payload.expectedStatus
      || !Number.isSafeInteger(payload.expectedVersion)
      || Number(payload.expectedVersion) < 0
    ) throw new Error("M2_TICKET_INTERNAL_NOTE_PAYLOAD_INVALID");
    await mContentActions.addInternalNote(
      payload.ticketNo,
      payload.body.trim(),
      payload.expectedStatus,
      Number(payload.expectedVersion),
      reason,
      idempotencyKey,
    );
    return;
  }
  if (key === "I.session.convos") {
    return writeConversationRows(parseRows<SessionConvo>(legacyParams[key]), parseRows<SessionConvo>(value), reason, meta?.action, data, idempotencyKey);
  }
  const catMatch = key.match(/^I\.session\.cat\.(.+)\.enabled$/);
  if (catMatch) {
    if (catMatch[1] === "support") throw new Error("历史兼容项不能单独启停，请使用专属客服开关");
    await mContentActions.updateCategory(catMatch[1] as SessionType, value === "on", legacyParams[key] === "on", reason, idempotencyKey);
    return;
  }
  const policyMatch = key.match(/^I\.session\.advisor\.policy\.(.+)$/);
  if (policyMatch) {
    await mContentActions.updateAdvisorPolicy(policyMatch[1], value, legacyParams[key] ?? "", reason, idempotencyKey);
    return;
  }
  const workbenchPolicyMatch = key.match(/^I\.session\.workbench\.(.+)$/);
  if (workbenchPolicyMatch) {
    await mContentActions.updateWorkbenchPolicy(workbenchPolicyMatch[1], value, legacyParams[key] ?? "", reason, idempotencyKey);
    return;
  }
  if (key === "I.session.script.__create") {
    const payload = parseRecord<{ scriptGroup?: AdvisorScript["group"]; text?: string; ctaPath?: string; audience?: string; status?: AdvisorScript["status"] }>(value);
    if (payload?.text) {
      const audience = payload.audience?.trim();
      if (!audience) {
        throw new Error("请选择可用受众");
      }
      await mContentActions.createScript(
        {
          scriptGroup: payload.scriptGroup || "开场",
          text: payload.text,
          ctaPath: payload.ctaPath || "—",
          audience,
          status: payload.status || "draft",
        },
        reason,
        idempotencyKey,
      );
    }
    return;
  }
  const scriptStatusMatch = key.match(/^I\.session\.script\.(.+)\.status$/);
  if (scriptStatusMatch) {
    const nextStatus = value === "archived" ? "archived" : value === "published" ? "published" : "draft";
    const expectedStatus = templateStatus(legacyParams[key]);
    await mContentActions.updateScriptStatus(scriptStatusMatch[1], nextStatus, expectedStatus, reason, idempotencyKey);
    return;
  }
  const scriptAudienceMatch = key.match(/^I\.session\.script\.(.+)\.audience$/);
  if (scriptAudienceMatch) {
    await mContentActions.updateScriptAudience(scriptAudienceMatch[1], value, legacyParams[key] ?? "", reason, idempotencyKey);
    return;
  }
  const tplStatusMatch = key.match(/^I\.session\.tpl\.(.+)\.status$/);
  if (tplStatusMatch) {
    const nextStatus = value === "archived" ? "archived" : value === "published" ? "published" : "draft";
    const expectedStatus = templateStatus(legacyParams[key]);
    await mContentActions.updateReplyTemplateStatus(tplStatusMatch[1], nextStatus, expectedStatus, reason, idempotencyKey);
    return;
  }
  if (key === "I.session.replyTemplates") {
    const prev = parseRows<SessionReplyTpl>(legacyParams[key]);
    const next = parseRows<SessionReplyTpl>(value);
    const added = addedRow(prev, next);
    if (added) await mContentActions.createReplyTemplate({ type: added.type, text: added.text, status: added.status }, reason, idempotencyKey);
    return;
  }
  throw new Error(`M_BACKEND_ROUTE_MISSING:${key}`);
}
function dockRelWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/** 小窗被挡时的一句：为什么不能发、要去哪里。客户认不出的旧记录也挡，那时不说「这位客户」。 */
const DOCK_BLOCKED = "上一条消息发送结果未知，确认前不能再发。";
const DOCK_BLOCKED_OTHER = "有一条消息发送结果未知，确认前不能再发。";
const DOCK_NOT_YOURS_SENT = "消息没有发出：这位客户已不归你接待，原文已清除。";
/** 403/404 只说明现在不能接待，不一定是转走。 */
const DOCK_NO_ACCESS_SENT = "消息没有发出：你已不能接待这位客户，原文已清除。";

function SessionDock({ ctx, hidden, onScopeInvalidated, snapshotRevision }: { snapshotRevision: number; ctx: MCtx; hidden: boolean; onScopeInvalidated: MCtx["invalidateScope"] }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const sendInFlight = useRef(false);
  const identityGeneration = useRef(0);
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const supportReadModes = useAdminAuth((state) => state.session?.supportReadModes);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const currentAdminId = useAdminAuth((state) => state.session?.adminId);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const lastId = ctx.pget(DOCK_LAST_KEY);
  const convos = useMemo(() => dockParseConvos(ctx.pget(DOCK_CONVO_KEY)), [ctx.params]);
  useSendJournalRevision();
  const conv = convos.find(c => c.id === lastId);
  const open = ctx.pget(DOCK_OPEN_KEY) === "1";
  const offFor = ctx.pget(DOCK_OFF_KEY);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM3 = isSuperAdmin || Boolean(authorities?.includes("service_m3_write"));
  const conversationsAvailable = ctx.pget("I.session.conversationsAvailable") === "1";
  const owned = Boolean(conv?.customerId && currentAdminId && conv.ownerAdminId === currentAdminId && conv.type !== "ai" && conv.status === "open");
  const [draftScope, setDraftScope] = useState<{ revision: number; assignmentId: string } | null>(null);
  const assignmentId = draftScope?.revision === snapshotRevision ? draftScope.assignmentId : undefined;
  useEffect(() => {
    if (hidden || !open || !owned || !conv?.customerId) return;
    const controller = new AbortController();
    setDraftScope(null);
    supportClient.customerDetail(conv.customerId, controller.signal).then(detail => {
      if (controller.signal.aborted) return;
      if (detail.customerId !== conv.customerId || detail.agentAdminId !== currentAdminId || !detail.assignmentId) {
        onScopeInvalidated(conv.id, conv.customerId);
      } else setDraftScope({ revision: snapshotRevision, assignmentId: detail.assignmentId });
    }).catch(error => {
      if (controller.signal.aborted) return;
      if (isSupportScopeDenial(error)) onScopeInvalidated(conv.id, conv.customerId);
      else setSendError(displayAdminError(error));
    });
    return () => controller.abort();
  }, [hidden, open, owned, conv?.id, conv?.customerId, currentAdminId, snapshotRevision, detailRetry, onScopeInvalidated]);
  const canWrite = Boolean(assignmentId) && canWriteM3 && Boolean(supportReadModes?.includes("PERSONAL")) && conversationsAvailable && owned && conv?.detailReady === true && conv.writeState?.canReply !== false;
  const dockSlot = `dock|${currentAdminId}|${lastId}`;
  const draftKey = currentAdminId && conv?.customerId && assignmentId ? dockDraftKey(currentAdminId, conv.customerId, conv.id, assignmentId) : "";
  const newSendBlocked = !!currentAdminId && !!conv?.customerId && blocksNewSend(pendingSendCustomers(currentAdminId, convos), conv.customerId);
  // 只决定显示哪句：被挡的是不是这位客户自己的消息。
  const blockedHere = newSendBlocked && pendingSendCustomers(currentAdminId!, convos).has(conv!.customerId);
  const dockBlocked = newSendBlocked && !sending;
  const dockError = dockBlocked && sendError === DOCK_BLOCKED ? "" : sendError;
  const lengthHint = canWrite && !newSendBlocked ? supportLengthHint(draft) : null;
  const updateDraft = (value: string) => {
    setDraft(value);
    try {
      if (value) sessionStorage.setItem(draftKey, value);
      else sessionStorage.removeItem(draftKey);
    } catch { setSendError("草稿保存不可用；当前输入仍保留在此页面。"); }
  };
  useLayoutEffect(() => {
    if (newSendBlocked) return;
    if (draftKey && owned) {
      try { setDraft(sessionStorage.getItem(draftKey) ?? ""); }
      catch { setDraft(""); }
    } else setDraft("");
  }, [draftKey, owned, newSendBlocked]);
  useLayoutEffect(() => {
    sendInFlight.current = false;
    setSending(false);
    setSendError("");
    const invalidate = (event: Event) => {
      const target = (event as CustomEvent<{ conversationNo?: string; customerId?: string }>).detail;
      if ((target?.customerId || target?.conversationNo) && target.customerId !== conv?.customerId && target.conversationNo !== lastId) return;
      identityGeneration.current++;
      setDraft("");
    };
    const restored = (event: Event) => {
      const copy = (event as CustomEvent<{ key: string; body: string }>).detail;
      if (copy.key === draftKey) setDraft(copy.body);
    };
    const assignmentChanged = (event: Event) => {
      const target = (event as CustomEvent<{ customerId?: string; cleared: ReturnType<typeof redactCustomerSends> }>).detail;
      if (target.customerId === conv?.customerId && target.cleared.assignmentId === assignmentId) {
        identityGeneration.current++;
        setDraftScope(null); setDraft(""); setDetailRetry(value => value + 1);
      }
    };
    window.addEventListener("m3-assignment-invalidated", assignmentChanged);
    window.addEventListener("dock-draft-restored", restored);
    window.addEventListener("support-scope-invalidated", invalidate);
    return () => {
      window.removeEventListener("dock-draft-restored", restored);
      window.removeEventListener("m3-assignment-invalidated", assignmentChanged);
      identityGeneration.current++;
      window.removeEventListener("support-scope-invalidated", invalidate);
    };
  }, [draftKey, owned, lastId, conv?.customerId]);

  const loadConversationDetail = ctx.loadConversationDetail;
  useEffect(() => {
    if (hidden || !open || !conv || conv.detailReady || !conversationsAvailable || detailError) return;
    const controller = new AbortController();
    void loadConversationDetail(conv.id, controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        if (isSupportScopeDenial(cause)) onScopeInvalidated(conv.id, conv.customerId);
        else setDetailError(displayAdminError(cause));
      }
    });
    return () => controller.abort();
  }, [hidden, open, conv?.id, conv?.version, conv?.detailReady, conversationsAvailable, authEpoch, detailRetry, detailError, loadConversationDetail, onScopeInvalidated]);
  useEffect(() => { setDetailError(""); }, [conv?.id, authEpoch]);

  // M3 在台 / 无活跃会话 / 已被关闭(且仍是同一会话)→ 不显
  if (hidden || !conv || !owned || offFor === conv.id) return null;

  const setOpen = (v: boolean) => ctx.setParam(DOCK_OPEN_KEY, v ? "1" : "0", { action: "持续接待窗口 展开/收起", reason: "ui-state" });
  const closeDock = () => ctx.setParam(DOCK_OFF_KEY, conv.id, { action: "持续接待窗口 关闭", reason: "ui-state" });
  const send = async () => {
    const text = draft.trim();
    if (!text || !canWrite || newSendBlocked || sendInFlight.current || !currentAdminId || !conv.customerId) return;
    if (text.length > SUPPORT_MESSAGE_MAX_LENGTH) { setSendError(ADMIN_ERROR_MESSAGES.REPLY_BODY_TOO_LONG); return; }
    const generation = identityGeneration.current;
    const sameAccount = () => useAdminAuth.getState().session?.adminId === currentAdminId;
    const currentDock = () => sameAccount() && useAdminAuth.getState().authEpoch === authEpoch && generation === identityGeneration.current;
    let key: string | undefined;
    sendInFlight.current = true;
    setSending(true);
    setSendError("");
    try {
      const owner = await supportClient.customerDetail(conv.customerId);
      if (!currentDock()) return;
      if (owner.agentAdminId !== currentAdminId || !owner.assignmentId) throw new SupportClientError(403, undefined, "SUPPORT_CUSTOMER_SCOPE_CHANGED");
      if (owner.assignmentId !== assignmentId) { setDraftScope({ revision: snapshotRevision, assignmentId: owner.assignmentId }); sessionStorage.removeItem(draftKey); return; }
      const state = await supportClient.conversationState(conv.id);
      if (!currentDock()) return;
      if (state.status !== "OPEN") { setSendError("当前会话已结束，请刷新会话列表后重新选择。"); return; }
      if (state.version !== conv.version) {
        setSendError("会话有新消息，请核对刷新后的详情再发送。原文已保留。");
        try { await ctx.refreshConversations(); }
        catch { if (generation === identityGeneration.current) setSendError("会话有新消息，列表刷新失败。原文已保留，请刷新会话后重试。"); }
        return;
      }
      if (blocksNewSend(pendingSendCustomers(currentAdminId, convos), conv.customerId)) return;
      key = crypto.randomUUID();
      const latest = [...conv.messages].reverse().find((message) => message.sender === "user" && message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL" && Number.isSafeInteger(message.id));
      const input: SupportMessageInput = {
        kind: "TEXT", content: text, intent: "SERVICE", clientMessageId: crypto.randomUUID(),
        expectedAssignmentId: owner.assignmentId, expectedVersion: state.version,
        replyTargets: latest?.sender === "user" && Number.isSafeInteger(latest.id)
          ? [{ conversationNo: conv.id, throughMessageId: latest.id! }] : undefined,
      };
      dockCommands.remember(dockSlot, key, { payload: JSON.stringify(input), conversationNo: conv.id, customerId: conv.customerId, originalDraft: draft !== text ? draft : undefined, draftAssignmentId: assignmentId });
      if (!dockCommands.isDurablyStored(dockSlot, key)) { setSendError("浏览器无法保存这次发送的记录，消息还没发出；请检查浏览器设置后重试。"); return; }
      updateDraft("");
      await supportClient.sendConversationReply(conv.id, input, key);
      if (!sameAccount()) return;
      dockCommands.forget(dockSlot, key);
      window.dispatchEvent(new Event("support-todo-changed"));
      if (!currentDock()) return;
      ctx.toast(`${conv.id} 已回复`, "success");
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
    } catch (error) {
      if (!sameAccount()) return;
      if (key && supportAssignmentChanged(error)) {
        onScopeInvalidated(conv.id, conv.customerId, DOCK_NOT_YOURS_SENT, key);
        dockCommands.forget(dockSlot, key);
        return;
      }
      const rejected = key && refusedMessage(error, true);
      const scopeLost = error instanceof SupportClientError && [403, 404].includes(error.status);
      if (rejected && key) {
        if (scopeLost) dockCommands.forget(dockSlot, key);
        else {
          let restored = false;
          try {
            const copy = closeFailedDraft(currentAdminId, key, conv.customerId);
            if (copy) {
              const detail = await supportClient.customerDetail(conv.customerId);
              if (!sameAccount()) return;
              if (detail.assignmentId !== copy.assignmentId || detail.agentAdminId !== currentAdminId) {
                onScopeInvalidated(conv.id, conv.customerId, DOCK_NOT_YOURS_SENT, key);
                return;
              }
              restored = Boolean(restoreFailedDraft(currentAdminId, key, detail));
            }
          } catch (cause) {
            if (!sameAccount()) return;
            if (isSupportScopeDenial(cause)) { onScopeInvalidated(conv.id, conv.customerId); return; }
            if (currentDock()) setSendError(displayAdminError(cause));
            return;
          }
          if (!restored && currentDock()) { setSendError("这条消息没发出。客户仍归你时，原文会放回原来的输入框。"); return; }
        }
      }
      if (scopeLost) {
        onScopeInvalidated(conv.id, conv.customerId, rejected || !key ? DOCK_NO_ACCESS_SENT : "消息发送结果未知：你已不能接待这位客户，原文已清除，只能查询结果。");
      } else if (currentDock()) {
        setSendError(rejected ? `没有发出，原文已放回输入框，可以改了再发。原因：${displayAdminError(error)}` : key ? DOCK_BLOCKED : displayAdminError(error));
      }
    } finally {
      if (generation === identityGeneration.current) { sendInFlight.current = false; setSending(false); }
    }
  };

  const customer = conv.customer ?? conv.agentName;

  if (!open) {
    return (
      <button
        type="button"
        data-proof="session-dock-pill"
        onClick={() => setOpen(true)}
        className="card m-dock-pill"
        data-top={hidden ? "" : undefined}
        title="持续接待：换页后还能继续回复"
      >
        <MAvatar name={customer} size="sm" />
        <span style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{customer}</span>
        {conv.unread > 0 && <span className="cv-unread">{conv.unread}</span>}
        <span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon name="chevron" size={14} /></span>
      </button>
    );
  }

  const threadMessages = conv.messages.map((m): ThreadMessage => {
    const isAgent = m.sender === "agent";
    // System rows are known by their source, not by a display name: 「客服已切换」 carries the new handler's name.
    const isSystem = isAgent && (m.sourceSenderType === "SYSTEM" || m.kind === "AGENT_SWITCH" || m.agentName === "系统");
    return {
      ts: m.ts,
      fromAgent: isAgent,
      system: isSystem,
      role: isAgent ? (conv.type === "advisor" ? "advisor" : "support") : "user",
      agentName: m.agentName,
      senderName: isAgent ? m.agentName : customer,
      body: m.kind === "AGENT_SWITCH" ? agentSwitchText(m.agentName, m.senderRole) : m.kind === "IMAGE" ? "[图片]" : m.text,
      cta: m.kind === "IMAGE" ? { kind: "link", label: "打开完整会话查看图片", onClick: () => window.location.assign(`/service/sessions?conversationNo=${encodeURIComponent(conv.id)}`) } : undefined,
      ctaHref: m.ctaHref,
    };
  });

  return (
    <div
      data-proof="session-dock-panel"
      className="card m-dock-panel"
      data-top={hidden ? "" : undefined}
    >
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--m-bg-2)" }}>
        <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "var(--m-hd)", animation: "m-hd-pulse-blue 1.8s ease-out infinite" }} />
        <span style={{ fontSize: 12, color: "var(--m-hd-2)", fontWeight: 500 }}>持续接待</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} title="收起"><Icon name="chevron" size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={closeDock} title="关闭"><Icon name="x" size={15} /></button>
      </div>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
        <MAvatar name={customer} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13, fontWeight: 500 }}>{customer}</b>
            <span className="chip" style={{ height: 18, fontSize: 11 }}>{conv.type === "advisor" ? "专属客服" : "专属客服"}</span>
          </div>
          <div className="dim2 m-dock-meta" title={`会话编号 ${conv.id}`}>接待 {ownerLabel(conv.owner)} · {dockRelWhen(conv.lastTs)}</div>
        </div>
      </div>
      <div className="ChatBody" style={{ flex: 1, minHeight: 0 }}>
        {conv.detailReady ? <MessageThread messages={threadMessages} relWhen={dockRelWhen} resetKey={conv.id} /> : <div role={detailError ? "alert" : "status"} className="itint">{detailError ? `会话详情加载失败：${detailError}` : "正在加载会话消息…"} {detailError && <button type="button" className="btn btn-sec btn-sm" onClick={() => { setDetailError(""); setDetailRetry((value) => value + 1); }}>重新加载详情</button>}</div>}
      </div>
      {dockBlocked && <div role="status" className="m-dock-blocked"><span>{blockedHere ? DOCK_BLOCKED : DOCK_BLOCKED_OTHER}</span><Link className="rd-link" href={`/service/sessions?conversationNo=${encodeURIComponent(conv.id)}`}>去专属会话处理</Link></div>}
      {dockError && <div role="alert" className="m-dock-error">{dockError}{sendError.startsWith("消息已发送") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</button>}</div>}
      {!canWriteM3 && <div role="status" style={{ padding: "8px 11px", fontSize: 12 }}>你只能查看会话，发消息需要会话操作权限。</div>}
      {canWriteM3 && owned && conv.writeState?.canReply === false && <div role="status" className="m-dock-note">这不是客户当前的会话，不能在这里回复；到「专属会话」查看。</div>}
      <div style={{ padding: "9px 11px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          className="ta"
          data-proof="session-dock-reply"
          rows={1}
          value={newSendBlocked ? "" : draft}
          aria-label={`回复会话 ${conv.id}`}
          disabled={!canWrite || newSendBlocked || sending}
          onChange={(e) => updateDraft(e.target.value)}
          onKeyDown={(e) => {
            if (!shouldSendOnEnter(e)) return;
            e.preventDefault();
            void send();
          }}
          placeholder={newSendBlocked ? "上一条消息确认前不能发" : "回车发送，Shift+回车换行"}
          style={{ maxHeight: 80 }}
        />
        <button type="button" className="btn btn-pri btn-sm" aria-label="发送会话回复" disabled={!canWrite || newSendBlocked || !draft.trim() || sending} onClick={() => void send()}><Icon name="arrow" size={16} /></button>
      </div>
      {lengthHint && <div className="m-dock-count" data-over={lengthHint.over ? "" : undefined} role={lengthHint.over ? "alert" : "status"}>{lengthHint.text}</div>}
    </div>
  );
}
