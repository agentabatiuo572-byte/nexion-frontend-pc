"use client";

/**
 * M 客服中心 — 抽 I8(工单)+ I9(即时会话)重组的独立域。5 子页:
 *   M1 客服总览 / M2 工单台 / M3 即时会话台 / M4 知识库与 SLA / M5 话术与模板配置。
 * 业务数据读写后端 content 接口;I.support.* / I.session.* 仅作为子组件视图态适配键。
 * MC 显式 edit 契约:调参传 edit、处置不传。MessageThread 共享组件复用于 M2/M3。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./m-domain.css";
import { displayAdminError } from "@/lib/admin/error-messages";
import { Icon, MessageThread, OperationConfirmModal, useToast, type ThreadMessage } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  agentIdForName,
  buildMLegacyParams,
  fetchMConversationSnapshot,
  fetchMConversationDetail,
  fetchMContentData,
  mContentActions,
  type MContentData,
  type MLoadConfigWrite,
} from "@/lib/admin/m-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { MDomainLoadCoordinator } from "@/lib/admin/m-content-load-coordinator";
import { shouldStartM3ConversationRecovery } from "@/lib/admin/m-conversation-recovery-gate";
import { failClosedSupportAgentsAfterReload, preserveVerifiedSupportAgentsDuringReload } from "@/lib/admin/m-progressive-support-state";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useConversationStream, type ConversationStreamEvent } from "@/lib/admin/use-conversation-stream";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { M1PersonalWorkbench } from "./m-tabs/m1-personal-workbench";
import { M2Tickets } from "./m-tabs/m2-tickets";
import { M3DedicatedChat } from "./m-tabs/m3-dedicated-chat";
import { M4KbSla } from "./m-tabs/m4-kb-sla";
import { M5Scripts } from "./m-tabs/m5-scripts";
import { M5ServiceRules } from "./m-tabs/m5-service-rules";
import { STANDBY_POOL_LABEL, type AdvisorScript, type SessionConvo, type SessionMsg, type SessionReplyTpl, type SessionType, type SupportFaq, type SupportSla, type SupportTicket, type SupportTicketCategory, type SupportTicketPriority } from "./m-tabs/data";
import { MAvatar, ownerLabel } from "./m-tabs/hd-ui";
import type { ConfirmReq, MCtx, ActionConfirmReq } from "./m-tabs/types";
import { containsConversationMessage } from "./m-sse-dedup";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportMessageInput } from "@/lib/admin/m-support-client";

/**
 * M 域两类写入的命令号共用一张表,靠 fingerprint 前缀分命名空间:
 *   cmd|      逻辑命令 id(`m2:ticket:工单号:escalate:版本` 等,已带动作类型 + 目标 id);
 *             调用点不给 commandKey 时退化为 `参数键\0值\0理由`,参数键即目标对象。
 *   m3direct| M3 标签 / 备注直写(`m3:add-tag:会话号:标签`)
 * 落 sessionStorage:刷新后「写入失败或结果未知」的重试必须仍是同一命令号,后端才能去重。
 */
interface MCommandRecord extends PendingMutationRecord {
  /** 本次提交的值:带 commandKey 的调用点靠它保证重试提交的仍是同一个值。 */
  value?: string;
  /** 参数指纹(`参数键\0值\0理由`)。同一参数换了逻辑命令 id 时,靠它回收上一次的命令号。 */
  paramFingerprint?: string;
  clientMessageId?: string;
}
const mCommands = createPendingMutationStore<MCommandRecord>({
  storageKey: "nexion-admin-m-content-commands-v1",
  isValidRecord: (record) => (record.value === undefined || typeof record.value === "string")
    && (record.paramFingerprint === undefined || typeof record.paramFingerprint === "string")
    && (record.clientMessageId === undefined || typeof record.clientMessageId === "string"),
});
interface DockCommandRecord extends PendingMutationRecord { payload: string; conversationNo: string }
const dockCommands = createPendingMutationStore<DockCommandRecord>({
  storageKey: "nexion-admin-m-dock-pending-v1",
  isValidRecord: (record) => typeof record.payload === "string" && typeof record.conversationNo === "string",
});
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

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  M1: ["本人客户与待办 · 主管可处理待绑定客户", "待办按客户去重"],
  M2: ["回复 / 关单自动留痕 · 资金处置请到提现管理", "处理中工单实时计数"],
  M3: ["本人专属会话 · 主管只读审阅", "会话按当前归属显示"],
  M4: ["改常见问答 / 响应时限要填理由留痕", "帮助内容 + 各类响应时限"],
  M5: ["服务规则需理由与版本校验", "服务规则 + 话术模板"],
};

function templateStatus(value: string | undefined): AdvisorScript["status"] {
  return value === "published" ? "published" : value === "archived" ? "archived" : "draft";
}

export function MDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "M1", [meta.l2Id]);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const session = useAdminAuth((state) => state.session);
  const [m5Pane, setM5Pane] = useState<"rules" | "templates">("rules");
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [mData, setMData] = useState<MContentData | null>(null);
  const [mLoading, setMLoading] = useState(true);
  const [mError, setMError] = useState<string | null>(null);
  const [uiParams, setUiParams] = useState<Record<string, string>>({});
  const mLoadCoordinator = useRef(new MDomainLoadCoordinator());
  const mDataAuthEpoch = useRef<number | null>(null);
  const currentAuthEpoch = useRef(authEpoch);
  currentAuthEpoch.current = authEpoch;
  const mDataRef = useRef<MContentData | null>(null);
  const liveSnapshotController = useRef<AbortController | null>(null);
  const safeMData = mDataAuthEpoch.current === authEpoch ? mData : null;
  mDataRef.current = safeMData;

  useEffect(() => {
    setUiParams(session?.adminId ? readDockUi(session.adminId) : {});
  }, [authEpoch, session?.adminId]);

  const reloadMContent = useCallback(async () => {
    if (currentAuthEpoch.current !== authEpoch) return;
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
      });
      if (!isCurrent()) return;
      setMData((previous) => preserveVerifiedSupportAgentsDuringReload(previous, next));
      setMError(null);
    } catch (error) {
      if (!isCurrent()) return;
      setMData((previous) => failClosedSupportAgentsAfterReload(previous));
      setMError(displayAdminError(error));
    } finally {
      if (isCurrent()) setMLoading(false);
    }
  }, [authEpoch]);

  useEffect(() => {
    void reloadMContent();
  }, [authEpoch, reloadMContent]);

  const reconcileConversationSnapshot = useCallback(async (signal: AbortSignal) => {
    const generation = mLoadCoordinator.current.beginConversationSnapshot();
    const snapshotAuthEpoch = authEpoch;
    const conversations = await fetchMConversationSnapshot(signal);
    if (signal.aborted) return;
    if (!mLoadCoordinator.current.isConversationSnapshotCurrent(generation) || mDataAuthEpoch.current !== snapshotAuthEpoch) {
      throw new Error("M3_CONVERSATION_SNAPSHOT_SUPERSEDED");
    }
    setMData((previous) => previous
      ? { ...previous, conversations, conversationsAvailable: true }
      : previous);
  }, [authEpoch]);
  const loadConversationDetail = useCallback(async (no: string, signal?: AbortSignal) => {
    const detailEpoch = authEpoch;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const generation = mLoadCoordinator.current.captureConversationSnapshot();
      const detail = await fetchMConversationDetail(no, signal);
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
        conversations[index] = detail;
        return { ...previous, conversations };
      });
      return;
    }
    throw new Error("会话列表正在刷新，请重试读取详情。");
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

  // M3 即时会话 SSE 订阅：后端 OpsConversationStreamController 推 ConversationMessageEvent。
  // 增量合并进 mData.conversations —— 直接 setMData，绕开 runMWrite 写链（避免被 writeConversationRows
  // 当成「坐席新回复」二次回写后端，形成回环）。收到事件后 mergedParams 自动重算 → M3 / Dock 重渲。
  const handleStreamEvent = useCallback(async (event: ConversationStreamEvent, connectionSignal: AbortSignal) => {
    if (connectionSignal.aborted) return;
    if (
      event.eventType === "RECEIPT"
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
  }, [reconcileLiveConversationSnapshot]);
  // 鉴权：走同源 cookie（nexion_admin_token 由 Next route 转 Authorization 头）。
  // 仅走同源 httpOnly cookie 代理；JWT 永不进入 SSE URL。
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const invalidateScope = useCallback((conversationNo?: string, customerId?: string) => {
    mLoadCoordinator.current.beginConversationSnapshot();
    liveSnapshotController.current?.abort();
    window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { conversationNo, customerId } }));
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
          ? { ...ticket, contentRestricted: true, subject: "私聊内容仅当前顾问和主管可阅", messages: ticket.messages.filter((message) => message.author === "internal" || message.author === "system") }
          : ticket),
    } : previous);
    void reloadMContent();
    setUiParams((previous) => {
      const next = { ...previous, [DOCK_LAST_KEY]: "", [DOCK_OPEN_KEY]: "0" };
      if (session?.adminId) saveDockUi(session.adminId, next);
      return next;
    });
  }, [reloadMContent, session?.adminId]);
  const m3RecoveryEnabled = shouldStartM3ConversationRecovery({
    hasM3ReadAuthority: authorities.includes("service_m3_read"),
    hasMContentSnapshot: Boolean(safeMData),
    isMContentLoading: mLoading,
  });
  const { ready: conversationStreamReady, reconnectExhausted, reconnectReason, retry: retryConversationStream } = useConversationStream({
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

  const runMWrite = useCallback(
    async (key: string, value: string, meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void }): Promise<boolean> => {
      if (isMUiKey(key)) {
        setUiParams((prev) => {
          const next = { ...prev, [key]: value };
          if (session?.adminId) saveDockUi(session.adminId, next);
          return next;
        });
        return true;
      }
      const fingerprint = `${key}\u0000${value}\u0000${meta?.reason?.trim() ?? ""}`;
      const commandFingerprint = meta?.commandKey ?? fingerprint;
      const records = mCommands.list();
      const attempt = records.find((record) => record.fingerprint === commandSlot(commandFingerprint));
      const idempotencyKey = meta?.idempotencyKey
        ?? attempt?.commandKey
        ?? records.find((record) => record.paramFingerprint === fingerprint)?.commandKey
        ?? `m-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const stableValue = attempt?.value ?? value;
      const stableMetadata = pendingMCommandMetadata.current.get(commandFingerprint)
        ?? { action: meta?.action, reason: meta?.reason };
      const stableBaseline = pendingMCommandBaselines.current.get(commandFingerprint)
        ?? { legacyParams, data: safeMData };
      mCommands.remember(commandSlot(commandFingerprint), idempotencyKey, { value: stableValue, paramFingerprint: fingerprint });
      pendingMCommandMetadata.current.set(commandFingerprint, stableMetadata);
      pendingMCommandBaselines.current.set(commandFingerprint, stableBaseline);
      try {
        const backendResult = await applyMBackendWrite(key, stableValue, stableBaseline.legacyParams, stableBaseline.data, { ...meta, ...stableMetadata, idempotencyKey });
        await reloadMContent();
        meta?.onBackendResult?.(backendResult);
        mCommands.forget(commandSlot(commandFingerprint));
        pendingMCommandMetadata.current.delete(commandFingerprint);
        pendingMCommandBaselines.current.delete(commandFingerprint);
        return true;
      } catch (error) {
        await reloadMContent();
        const message = displayAdminError(error);
        // client 已接咽喉,英文网络错误不再到达;按原压制意图改判「咽喉网络中文」,命中仍不附加 detail。
        const detail = message.includes("网络连接失败或后台服务不可达") ? "" : ` · ${message}`;
        setToast(`写入失败或结果未知,请保留当前输入并重试${detail}`);
        return false;
      }
    },
    [legacyParams, safeMData, reloadMContent, setToast, session?.adminId],
  );

  const runM3DirectWrite = useCallback(async (
    fingerprint: string,
    write: (idempotencyKey: string) => Promise<unknown>,
    failureMessage: string,
  ): Promise<boolean> => {
    const slot = directWriteSlot(fingerprint);
    const idempotencyKey = mCommands.get(slot)
      ?? `m3-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    mCommands.remember(slot, idempotencyKey);
    try {
      await write(idempotencyKey);
      await reloadMContent();
      mCommands.forget(slot);
      return true;
    } catch (error) {
      setToast(`${failureMessage}或结果未知,请重试 · ${displayAdminError(error)}`);
      return false;
    }
  }, [reloadMContent, setToast]);

  // 客户标签(customTags)/备注(notes)走后端专用端点持久化,调完 reload 同步;失败 toast 报错。
  // reason 固定为描述性 8-200 字(满足后端 requireReasonCommand;标签/备注为即时编辑,无独立理由框)。
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
  const removeCustomerNote = useCallback(async (convoId: string, noteId: string): Promise<boolean> => {
    return runM3DirectWrite(
      `m3:remove-note:${convoId}:${noteId}`,
      (idempotencyKey) => mContentActions.removeCustomerNote(convoId, noteId, "客服删除客户备注", idempotencyKey),
      "客户备注删除失败",
    );
  }, [runM3DirectWrite]);
  const ctx: MCtx = {
    pget: (k) => mergedParams[k] as string | undefined,
    params: mergedParams,
    setParam: runMWrite,
    refreshConversations: async () => {
      const controller = new AbortController();
      await reconcileConversationSnapshot(controller.signal);
    },
    refreshContent: reloadMContent,
    loadConversationDetail,
    invalidateScope,
    addCustomerTag,
    removeCustomerTag,
    addCustomerNote,
    removeCustomerNote,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const currentAgent = safeMData?.supportAgents.find((agent) => agent.adminId === session?.adminId);
  const permissionUnknown = session?.role !== "superadmin" && session?.role !== "super"
    && Boolean(session?.authorities.includes("service_m1_write")) && !safeMData?.supportAgentsAvailable;
  const permission = session?.role === "superadmin" || session?.role === "super"
    ? "superadmin"
    : session?.authorities.includes("service_m1_write") && (currentAgent?.seatType === "MANAGER" || currentAgent?.position.includes("主管"))
      ? "supervisor" : "agent";
  const effectiveM5Pane = permission === "agent" ? "templates" : m5Pane;

  const [ro, liveLabel] = RO_LIVE[tab];
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
  const live = liveCount ?? liveLabel;
  const right = (
    <>
      <span className="f-ro"><span className="d" />{ro}</span>
      <span className="f-live"><span className="dot" />{live}</span>
    </>
  );

  return (
    <div className="dkpage mdom">
      <DomainHeader {...meta} right={right} />

      {mError && (
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
      {permissionUnknown && (tab === "M1" || tab === "M3" || tab === "M5") && <div className="card card-pad" role="status">主管身份暂时无法核对，管理入口已暂缓显示。<button type="button" className="btn btn-sec btn-sm" onClick={() => void reloadMContent()}>重试核对</button></div>}

      {tab === "M3" && reconnectExhausted && (
        <div className="card card-pad" role="alert" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Icon name="bell" size={16} />
          <span className="dim" style={{ fontSize: 13 }}>
            实时会话连接已停止自动重试{reconnectReason ? `（${reconnectReason}）` : ""}；当前页面数据可能不是最新状态，列表仍按服务端快照每 5 秒刷新。
          </span>
          <span className="sp" />
          <button type="button" className="btn btn-sec btn-sm" onClick={retryConversationStream}>重新连接</button>
        </div>
      )}
      {tab === "M3" && !reconnectExhausted && safeMData?.conversationsAvailable && (
        <span className="sr-only" aria-live="polite">{conversationStreamReady ? "实时会话已连接" : "实时会话正在重连"}</span>
      )}

      {tab === "M1" && <M1PersonalWorkbench key={authEpoch} permission={permission} />}
      {tab === "M5" && permission !== "agent" && <nav className="s5a-nav" aria-label="服务配置"><button type="button" className={m5Pane === "rules" ? "active" : ""} onClick={() => setM5Pane("rules")}>服务规则</button><button type="button" className={m5Pane === "templates" ? "active" : ""} onClick={() => setM5Pane("templates")}>话术与模板</button></nav>}
      {tab === "M5" && effectiveM5Pane === "rules" && <M5ServiceRules key={authEpoch} permission={permission} />}
      {tab !== "M1" && !(tab === "M5" && effectiveM5Pane === "rules") && !safeMData ? (
        <div className="card card-pad">
          <span className="dim" style={{ fontSize: 13 }}>
            {mError ? "客服中心暂时无法同步数据,请稍后重试。" : mLoading ? "正在加载 M 客服中心真实数据..." : "暂无可展示的 M 客服中心真实数据"}
          </span>
        </div>
      ) : safeMData && (
        <>
          {tab === "M2" && <M2Tickets ctx={ctx} />}
          {tab === "M3" && <M3DedicatedChat ctx={ctx} />}
          {tab === "M4" && <M4KbSla ctx={ctx} />}
          {tab === "M5" && effectiveM5Pane === "templates" && <M5Scripts ctx={ctx} showSeatOperations={false} showSeatProfiles={permission !== "agent"} />}
        </>
      )}

      {mc && (
        <OperationConfirmModal
          action={mc.action}
          detail={mc.detail}
          amplifies={mc.amplifies}
          edit={mc.edit}
          businessForm={mc.businessForm}
          reasonMin={mc.reasonMin}
          reasonMax={mc.reasonMax}
          onClose={() => setActionConfirm(null)}
          onConfirm={async (reason, newValue, businessValue) => {
            const succeeded = await mc.run(reason, newValue, businessValue);
            if (succeeded !== false) setActionConfirm(null);
          }}
        />
      )}
      {cf && <KConfirmModal req={cf} onClose={() => setCf(null)} />}
      {safeMData && <SessionDock ctx={ctx} hidden={tab === "M3"} onScopeInvalidated={invalidateScope} />}
      {toastNode}
    </div>
  );
}

/* ============ MP2 持续接待 dock —— 切页不挂断(M3 自身是全屏对话台,故 M3 不显)============ */
function dockParseConvos(raw: string | undefined): SessionConvo[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionConvo[]) : [];
  } catch {
    return [];
  }
}
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
  return convo.messages.find((m) => m.sender === "agent" && m.agentName !== "系统")?.text || convo.messages.at(-1)?.text || "客服已主动发起会话";
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
    throw new Error("请从本人客户详情发起新会话，当前入口不能指定顾问");
  }

  const row = changedRow(prev, next);
  if (!row) return;
  const before = prev.find((item) => item.id === row.id);
  if (!before) return;
  const currentAdminId = useAdminAuth.getState().session?.adminId;
  if (!before.customerId || !currentAdminId || before.ownerAdminId !== currentAdminId) {
    throw new Error("当前账号不是该客户的专属顾问，不能执行对客操作");
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

async function writeFaqRows(prev: SupportFaq[], next: SupportFaq[], reason: string, idempotencyKey?: string) {
  const added = addedRow(prev, next);
  if (added) {
    await mContentActions.createFaq(
      {
        category: added.category,
        question: added.question,
        answer: added.answer,
        status: added.status,
        surface: added.surface,
        language: added.language,
        sortOrder: added.sortOrder,
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
  const contentChanged = row.category !== before.category
    || row.question !== before.question
    || row.answer !== before.answer
    || row.surface !== before.surface
    || row.language !== before.language
    || row.sortOrder !== before.sortOrder;
  if (row.status !== before.status && !contentChanged) await mContentActions.updateFaqStatus(row.id, row.status, before.status, before.version, reason, idempotencyKey);
  else await mContentActions.updateFaq(row, before, reason, idempotencyKey);
}

async function writeSlaRows(prev: SupportSla[], next: SupportSla[], reason: string, idempotencyKey?: string) {
  const row = next.find((item) => {
    const before = prev.find((old) => old.category === item.category);
    return before && JSON.stringify(before) !== JSON.stringify(item);
  }) ?? next.find((item) => !prev.some((old) => old.category === item.category));
  const before = row ? prev.find((old) => old.category === row.category) : undefined;
  if (row && before) await mContentActions.updateSla(row, before.version, reason, idempotencyKey);
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
  meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string; onBackendResult?: (result: unknown) => void },
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
  if (key === "I.support.faq.__delete") {
    const payload = parseRecord<{ faqId?: string; expectedStatus?: SupportFaq["status"]; expectedVersion?: number }>(value);
    if (!payload?.faqId || !payload.expectedStatus || !Number.isSafeInteger(payload.expectedVersion)) throw new Error("M4_FAQ_DELETE_PAYLOAD_INVALID");
    await mContentActions.deleteFaq(payload.faqId, payload.expectedStatus, payload.expectedVersion!, reason, idempotencyKey);
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
  if (key === "I.support.seatAssignment.__update") {
    const payload = parseRecord<{
      adminId?: number;
      position?: string;
      serviceTypes?: Array<"support" | "advisor">;
      tags?: string[];
      maxConcurrent?: number;
      enabled?: boolean;
      transferable?: boolean;
      busy?: boolean;
      userIds?: number[];
      expectedVersion?: number;
    }>(value);
    if (payload?.adminId && payload.position && Number.isSafeInteger(payload.expectedVersion)) {
      await mContentActions.assignSupportSeat(payload.adminId, { ...payload, position: payload.position, expectedVersion: payload.expectedVersion! }, reason, idempotencyKey);
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
  if (key === "I.support.faqs") {
    await writeFaqRows(parseRows<SupportFaq>(legacyParams[key]), parseRows<SupportFaq>(value), reason, idempotencyKey);
    return;
  }
  if (key === "I.support.sla") {
    await writeSlaRows(parseRows<SupportSla>(legacyParams[key]), parseRows<SupportSla>(value), reason, idempotencyKey);
    return;
  }
  const catMatch = key.match(/^I\.session\.cat\.(.+)\.enabled$/);
  if (catMatch) {
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
        throw new Error("请选择后端返回的受众");
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
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function SessionDock({ ctx, hidden, onScopeInvalidated }: { ctx: MCtx; hidden: boolean; onScopeInvalidated: (conversationNo?: string, customerId?: string) => void }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const [canAbandon, setCanAbandon] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailRetry, setDetailRetry] = useState(0);
  const sendInFlight = useRef(false);
  const authorities = useAdminAuth((state) => state.session?.authorities);
  const currentRole = useAdminAuth((state) => state.session?.role ?? state.role);
  const currentAdminId = useAdminAuth((state) => state.session?.adminId);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const lastId = ctx.pget(DOCK_LAST_KEY);
  const convos = useMemo(() => dockParseConvos(ctx.pget(DOCK_CONVO_KEY)), [ctx.params]);
  const pendingForAdmin = dockCommands.list().find((row) => row.fingerprint.startsWith(`dock|${currentAdminId}|`));
  const conv = pendingForAdmin ? convos.find((c) => c.id === pendingForAdmin.conversationNo) ?? null : convos.find((c) => c.id === lastId) ?? null;
  const open = ctx.pget(DOCK_OPEN_KEY) === "1";
  const offFor = ctx.pget(DOCK_OFF_KEY);
  const isSuperAdmin = currentRole === "super" || currentRole === "superadmin";
  const canWriteM3 = isSuperAdmin || Boolean(authorities?.includes("service_m3_write"));
  const conversationsAvailable = ctx.pget("I.session.conversationsAvailable") === "1";
  const owned = Boolean(conv?.customerId && currentAdminId && conv.ownerAdminId === currentAdminId && conv.type === "advisor" && conv.status === "open");
  const canWrite = canWriteM3 && conversationsAvailable && owned && conv?.detailReady === true;
  const dockSlot = pendingForAdmin?.fingerprint ?? `dock|${currentAdminId}|${conv?.id ?? ""}`;
  const pendingDock = dockCommands.list().find((row) => row.fingerprint === dockSlot && row.conversationNo === conv?.id);
  const copyOriginal = async (original: string) => {
    try { await navigator.clipboard.writeText(original); ctx.toast("原文已复制。"); }
    catch { setSendError("自动复制失败。可在原文框中手动选择并复制。"); }
  };
  const abandonQuery = (row: DockCommandRecord) => {
    if (!window.confirm("确认已自行保存原文，并放弃查询这条发送记录？放弃后无法继续用原命令核对结果。")) return;
    dockCommands.forget(row.fingerprint);
    setCanAbandon(false);
    setSendError("");
    ctx.toast("待确认记录已清除。");
  };

  useEffect(() => {
    if (!pendingDock || draft) return;
    try { setDraft((JSON.parse(pendingDock.payload) as SupportMessageInput).content ?? ""); }
    catch { dockCommands.forget(dockSlot); }
  }, [canWrite, dockSlot, draft, pendingDock]);

  const loadConversationDetail = ctx.loadConversationDetail;
  useEffect(() => {
    if (hidden || !open || !conv || conv.detailReady || !conversationsAvailable || detailError) return;
    const controller = new AbortController();
    void loadConversationDetail(conv.id, controller.signal).catch((cause: unknown) => {
      if (!controller.signal.aborted) {
        if (cause instanceof SupportClientError && [403, 404].includes(cause.status)) onScopeInvalidated(conv.id, conv.customerId);
        else setDetailError(displayAdminError(cause));
      }
    });
    return () => controller.abort();
  }, [hidden, open, conv?.id, conv?.version, conv?.detailReady, conversationsAvailable, authEpoch, detailRetry, detailError, loadConversationDetail, onScopeInvalidated]);
  useEffect(() => { setDetailError(""); }, [conv?.id, authEpoch]);

  // M3 在台 / 无活跃会话 / 已被关闭(且仍是同一会话)→ 不显
  if (hidden && !pendingForAdmin || conv && !owned && !pendingDock || conv && !pendingDock && offFor === conv.id) return null;

  if (!conv && !pendingForAdmin) return null;
  if (!conv) {
    const recovery = pendingForAdmin!;
    let recoveryText = "";
    try { recoveryText = (JSON.parse(recovery.payload) as SupportMessageInput).content ?? ""; } catch { /* Keep the command query available. */ }
    return <div className="card" role="status" style={{ position: "fixed", right: 22, bottom: 22, zIndex: 30, padding: 12, maxWidth: 360 }}>
    <div>会话 {recovery.conversationNo} 的发送结果待确认。</div>
    <textarea readOnly aria-label="待确认消息原文" value={recoveryText} style={{ width: "100%", marginTop: 8 }} />
    {sendError && <div role="alert">{sendError}</div>}
    <button type="button" className="btn btn-sec btn-sm" disabled={sending} onClick={() => void (async () => {
      setSending(true); setSendError(""); setCanAbandon(false);
      try {
        const result = await supportClient.command(recovery.commandKey);
        if (result.status === "SUCCEEDED") {
          dockCommands.forget(recovery.fingerprint);
          ctx.toast("服务端确认消息已发送。");
          void ctx.refreshConversations();
        } else if (result.status === "FAILED") {
          setCanAbandon(true);
          setSendError("服务端确认发送失败。请复制原文并清除待确认记录。");
        } else setSendError("发送结果仍在确认，请稍后查询原命令。");
      } catch (cause) {
        if (cause instanceof SupportClientError && cause.status === 404) { setCanAbandon(true); setSendError("原命令未找到，当前会话不可发送。可复制原文后放弃查询。"); }
        else setSendError(`原命令暂无法确认：${displayAdminError(cause)}。请稍后重试。`);
      }
      finally { setSending(false); }
    })()}>查询原命令结果</button>
    {canAbandon && <><button type="button" className="btn btn-sec btn-sm" disabled={sending} onClick={() => void copyOriginal(recoveryText)}>复制原文</button><button type="button" className="btn btn-sec btn-sm" disabled={sending} onClick={() => abandonQuery(recovery)}>放弃查询</button></>}
    </div>;
  }

  const setOpen = (v: boolean) => ctx.setParam(DOCK_OPEN_KEY, v ? "1" : "0", { action: "持续接待 dock 展开/收起", reason: "ui-state" });
  const closeDock = () => ctx.setParam(DOCK_OFF_KEY, conv.id, { action: "持续接待 dock 关闭", reason: "ui-state" });
  const send = async () => {
    const text = draft.trim();
    if (!text || (!canWrite && !pendingDock) || sendInFlight.current) return;
    const key = pendingDock?.commandKey ?? crypto.randomUUID();
    sendInFlight.current = true;
    setSending(true);
    setSendError("");
    setCanAbandon(false);
    try {
      const owner = pendingDock ? null : await supportClient.customerDetail(conv.customerId!);
      if (owner && (owner.agentAdminId !== currentAdminId || !owner.assignmentId)) throw new SupportClientError(403, undefined, "SUPPORT_CUSTOMER_SCOPE_CHANGED");
      const state = pendingDock ? null : await supportClient.conversationState(conv.id);
      if (state && state.status !== "OPEN") { setSendError("当前会话已结束，请刷新会话列表后重新选择。"); return; }
      if (state && state.version !== conv.version) {
        setSendError("会话有新消息，请核对刷新后的详情再发送。原文已保留。");
        try { await ctx.refreshConversations(); }
        catch { setSendError("会话有新消息，列表刷新失败。原文已保留，请刷新会话后重试。"); }
        return;
      }
      const latest = [...conv.messages].reverse().find((message) => message.sourceSenderType !== "SYSTEM" && message.sourceSenderType !== "INTERNAL");
      const input: SupportMessageInput = pendingDock ? JSON.parse(pendingDock.payload) : {
        kind: "TEXT", content: text, intent: "SERVICE", clientMessageId: crypto.randomUUID(),
        expectedAssignmentId: owner!.assignmentId!, expectedVersion: state!.version,
        replyTargets: latest?.sender === "user" && Number.isSafeInteger(latest.id)
          ? [{ conversationNo: conv.id, throughMessageId: latest.id! }] : undefined,
      };
      if (!pendingDock) dockCommands.remember(dockSlot, key, { payload: JSON.stringify(input), conversationNo: conv.id });
      if (pendingDock) {
        const result = await supportClient.command(key).catch((error: unknown) => {
          if (error instanceof SupportClientError && error.status === 404) return null;
          throw error;
        });
        if (result && result.status !== "SUCCEEDED" && result.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后查询。"); return; }
        if (result?.status === "FAILED") { setCanAbandon(true); setSendError("服务端确认发送失败。请复制原文并清除待确认记录。"); return; }
        if (!result) {
          if (!canWrite) { setCanAbandon(true); setSendError("原命令未找到，当前会话不可发送。可复制原文后放弃查询。"); return; }
          await supportClient.sendConversationReply(conv.id, input, key);
        }
      } else {
        await supportClient.sendConversationReply(conv.id, input, key);
      }
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
      dockCommands.forget(dockSlot);
      setDraft("");
      ctx.toast(`${conv.id} 已回复`);
      window.dispatchEvent(new Event("support-todo-changed"));
    } catch (error) {
      if (error instanceof SupportClientError && [403, 404].includes(error.status)) onScopeInvalidated(conv.id, conv.customerId);
      if (error instanceof SupportClientError && [400, 401, 403, 404, 409, 422].includes(error.status) && !isIndeterminateSupportError(error)) {
        dockCommands.forget(dockSlot);
        setSendError(`服务端已拒绝本次发送：${displayAdminError(error)}。原文已保留，可修改后重发。`);
      } else setSendError(`发送失败或结果待确认：${displayAdminError(error)}。请查询结果并重试。`);
    } finally {
      sendInFlight.current = false;
      setSending(false);
    }
  };

  const customer = conv.customer ?? conv.agentName;

  if (!open) {
    return (
      <button
        type="button"
        data-proof="session-dock-pill"
        onClick={() => setOpen(true)}
        className="card"
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 30, display: "flex", alignItems: "center", gap: 9, padding: "8px 12px 8px 9px", borderRadius: 999, boxShadow: "var(--m-sh-pop)", cursor: "pointer", color: "var(--ink)" }}
        title="持续接待 · 切页不挂断"
      >
        <MAvatar name={customer} size="sm" />
        <span style={{ fontSize: 12.5, fontWeight: 500, maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{customer}</span>
        {conv.unread > 0 && <span className="cv-unread">{conv.unread}</span>}
        <span style={{ display: "inline-flex", transform: "rotate(-90deg)" }}><Icon name="chevron" size={14} /></span>
      </button>
    );
  }

  const threadMessages: ThreadMessage[] = conv.messages.map((m) => {
    const isAgent = m.sender === "agent";
    const isSystem = isAgent && m.agentName === "系统";
    return {
      ts: m.ts,
      fromAgent: isAgent,
      system: isSystem,
      role: isAgent ? (conv.type === "advisor" ? "advisor" : "support") : "user",
      agentName: m.agentName,
      senderName: isAgent ? m.agentName : customer,
      body: m.kind === "IMAGE" ? "[图片]" : m.text,
      ctaHref: m.ctaHref,
    } as ThreadMessage;
  });

  return (
    <div
      data-proof="session-dock-panel"
      className="card"
      style={{ position: "fixed", right: 22, bottom: 22, zIndex: 30, width: "min(372px, calc(100vw - 24px))", maxHeight: "min(72vh, 540px)", boxShadow: "var(--m-sh-pop)", overflow: "hidden", display: "flex", flexDirection: "column" }}
    >
      <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: "var(--m-bg-2)" }}>
        <span style={{ display: "inline-flex", width: 8, height: 8, borderRadius: "50%", background: "var(--m-hd)", animation: "m-hd-pulse-blue 1.8s ease-out infinite" }} />
        <span style={{ fontSize: 12, color: "var(--m-hd-2)", fontWeight: 500 }}>持续接待</span>
        <span className="dim2" style={{ fontSize: 11 }}>切页不挂断</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setOpen(false)} title="收起"><Icon name="chevron" size={15} /></button>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={closeDock} title="关闭"><Icon name="x" size={15} /></button>
      </div>
      <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 9 }}>
        <MAvatar name={customer} size="sm" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13, fontWeight: 500 }}>{customer}</b>
            <span className="chip" style={{ height: 18, fontSize: 11 }}>{conv.type === "advisor" ? "专属客服" : "普通客服"}</span>
          </div>
          <div className="dim2" style={{ fontSize: 11, marginTop: 2 }}>接待 {ownerLabel(conv.owner)} · <span className="mono">{conv.id}</span> · {dockRelWhen(conv.lastTs)}</div>
        </div>
      </div>
      <div className="ChatBody" style={{ flex: 1, minHeight: 0 }}>
        {conv.detailReady ? <MessageThread messages={threadMessages} relWhen={dockRelWhen} resetKey={conv.id} /> : <div role={detailError ? "alert" : "status"} className="itint">{detailError ? `会话详情读取失败：${detailError}` : "正在读取会话消息…"} {detailError && <button type="button" className="btn btn-sec btn-sm" onClick={() => { setDetailError(""); setDetailRetry((value) => value + 1); }}>重试读取详情</button>}</div>}
      </div>
      {sendError && <div role="alert" style={{ padding: "8px 11px", color: "var(--danger)", fontSize: 12 }}>{sendError}{sendError.startsWith("消息已发送") && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</button>}</div>}
      {pendingDock && canAbandon && <div><button type="button" className="btn btn-sec btn-sm" disabled={sending} onClick={() => void copyOriginal(draft)}>复制原文</button><button type="button" className="btn btn-sec btn-sm" disabled={sending} onClick={() => abandonQuery(pendingDock)}>放弃查询</button></div>}
      {!canWriteM3 && <div role="status" style={{ padding: "8px 11px", fontSize: 12 }}>当前账号只可查看会话，发送需会话操作权限。</div>}
      <div style={{ padding: "9px 11px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          className="ta"
          data-proof="session-dock-reply"
          rows={1}
          value={draft}
          aria-label={`回复会话 ${conv.id}`}
          readOnly={Boolean(pendingDock)}
          disabled={!pendingDock && (!canWrite || sending)}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (pendingDock) return;
            if (!shouldSendOnEnter(e)) return;
            e.preventDefault();
            void send();
          }}
          placeholder="边处理边回复… · Enter 发送 · Shift+Enter 换行"
          style={{ maxHeight: 80 }}
        />
        <button type="button" className="btn btn-pri btn-sm" aria-label={pendingDock ? "查询结果并重试会话回复" : "发送会话回复"} disabled={(!canWrite && !pendingDock) || !draft.trim() || sending} onClick={() => void send()}><Icon name="arrow" size={16} /></button>
      </div>
    </div>
  );
}
