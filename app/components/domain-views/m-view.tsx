"use client";

/**
 * M 客服中心 — 抽 I8(工单)+ I9(即时会话)重组的独立域。5 子页:
 *   M1 客服总览 / M2 工单台 / M3 即时会话台 / M4 知识库与 SLA / M5 话术与模板配置。
 * 业务数据读写后端 content 接口;I.support.* / I.session.* 仅作为子组件视图态适配键。
 * MC 显式 edit 契约:调参传 edit、处置不传。MessageThread 共享组件复用于 M2/M3。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./m-domain.css";
import { Icon, MessageThread, OperationConfirmModal, useToast, type ThreadMessage } from "./design-kit";
import { DomainHeader, type DomainViewMeta } from "./domain-header";
import {
  adminIdForAgent,
  agentIdForName,
  buildMLegacyParams,
  fetchMContentData,
  mContentActions,
  type MContentData,
  type MLoadConfigWrite,
} from "@/lib/admin/m-client";
import { useConversationStream, type ConversationStreamEvent } from "@/lib/admin/use-conversation-stream";
import { KConfirmModal } from "./k-tabs/confirm-modal";
import { M1Overview } from "./m-tabs/m1-overview";
import { M2Tickets } from "./m-tabs/m2-tickets";
import { M3Sessions } from "./m-tabs/m3-sessions";
import { M4KbSla } from "./m-tabs/m4-kb-sla";
import { M5Scripts } from "./m-tabs/m5-scripts";
import type { AdvisorScript, SessionConvo, SessionMsg, SessionReplyTpl, SessionType, SupportFaq, SupportSla, SupportTicket, SupportTicketCategory, SupportTicketPriority } from "./m-tabs/data";
import { MAvatar, ownerLabel } from "./m-tabs/hd-ui";
import type { ConfirmReq, MCtx, ActionConfirmReq } from "./m-tabs/types";

// 持续接待 dock 跨 M 子页 UI 态(只保留组件内存,切页不挂断)。
const DOCK_CONVO_KEY = "I.session.convos";
const DOCK_LAST_KEY = "I.session.ui.lastConvo";
const DOCK_OPEN_KEY = "I.session.ui.dockOpen"; // "1" = 展开面板,否则收为药丸
const DOCK_OFF_KEY = "I.session.ui.dockOff";   // 记录被关闭时的会话 id;坐席切到新会话即自动复现

const FOLD: Record<string, string> = {
  M1: "M1",
  M2: "M2",
  M3: "M3",
  M4: "M4",
  M5: "M5",
};

const RO_LIVE: Record<string, [ro: string, live: string]> = {
  M1: ["指标只读 · 授权主管可维护坐席与负载", "工单 + 会话实时汇总"],
  M2: ["回复 / 关单自动留痕 · 放钱去 D2", "处理中工单实时计数"],
  M3: ["会话不断线 · 坐席回复自动留痕", "进行中会话 + 待回复实时计数"],
  M4: ["改常见问答 / 响应时限要填理由留痕", "帮助内容 + 各类响应时限"],
  M5: ["改推送 / 话术要确认留痕", "顾问推送 + 话术模板"],
};

function templateStatus(value: string | undefined): AdvisorScript["status"] {
  return value === "published" ? "published" : value === "archived" ? "archived" : "draft";
}

export function MDomainView({ meta }: { meta: DomainViewMeta }) {
  const [toastNode, setToast] = useToast();
  const tab = useMemo(() => FOLD[meta.l2Id] ?? "M1", [meta.l2Id]);
  const [mc, setActionConfirm] = useState<ActionConfirmReq | null>(null);
  const [cf, setCf] = useState<ConfirmReq | null>(null);
  const [mData, setMData] = useState<MContentData | null>(null);
  const [mLoading, setMLoading] = useState(true);
  const [mError, setMError] = useState<string | null>(null);
  const [uiParams, setUiParams] = useState<Record<string, string>>({});

  const reloadMContent = useCallback(async () => {
    setMLoading(true);
    try {
      const next = await fetchMContentData();
      setMData(next);
      setMError(null);
    } catch (error) {
      setMError(error instanceof Error ? error.message : "M_CONTENT_LOAD_FAILED");
    } finally {
      setMLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadMContent();
  }, [reloadMContent]);

  // M3 即时会话 SSE 订阅：后端 OpsConversationStreamController 推 ConversationMessageEvent。
  // 增量合并进 mData.conversations —— 直接 setMData，绕开 runMWrite 写链（避免被 writeConversationRows
  // 当成「坐席新回复」二次回写后端，形成回环）。收到事件后 mergedParams 自动重算 → M3 / Dock 重渲。
  const handleStreamEvent = useCallback((event: ConversationStreamEvent) => {
    if (event.eventType === "RECEIPT") {
      // 回执携带明确 messageId；重新读取权威快照，避免把并发到达的新消息误标为已读。
      void reloadMContent();
      return;
    }
    setMData((prev) => {
      if (!prev) return prev;
      const idx = prev.conversations.findIndex((c) => c.id === event.conversationNo);
      // 未知会话（别的坐席的 / 新发起未在本坐席快照）—— 增量合并无法处理；
      // 不触发整页 reload，等下一次 reloadMContent 快照兜底。
      if (idx === -1) return prev;
      const convo = prev.conversations[idx];
      const eventTs = event.ts ? new Date(event.ts).getTime() : Date.now();
      let nextConvo: SessionConvo = convo;

      if (event.eventType === "MESSAGE" || event.eventType === "INITIATE") {
        const sender: "user" | "agent" = event.senderType === "USER" ? "user" : "agent";
        const text = event.body ?? "";
        // 去重：同 ts + 同正文已存在则不重复 push（本坐席自己发的回复会经 SSE 回环）。
        const dup = convo.messages.some((m) => m.ts === eventTs && m.text === text);
        if (!dup) {
          const msg: SessionMsg = {
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
      } else if (event.eventType === "STATUS") {
        const lower = (event.body ?? "").toLowerCase();
        const archived = lower.includes("archive");
        const closed = lower.includes("close") || lower.includes("resolve") || lower.includes("ticket");
        nextConvo = {
          ...convo,
          lastTs: eventTs,
          status: closed ? "closed" : convo.status,
          archived: archived || closed ? true : convo.archived,
        };
      }

      if (nextConvo === convo) return prev;
      const conversations = prev.conversations.slice();
      conversations[idx] = nextConvo;
      return { ...prev, conversations };
    });
  }, [reloadMContent]);
  // 鉴权：走同源 cookie（nexion_admin_token 由 Next route 转 Authorization 头）。
  // 当前 token 仅存 httpOnly cookie，JS 不可达，故不传 token（直连 + ?token 模式留作未来基础设施扩展）。
  useConversationStream({ onEvent: handleStreamEvent });

  const legacyParams = useMemo(() => (mData ? buildMLegacyParams(mData) : {}), [mData]);
  const mergedParams = useMemo(
    () => ({ ...uiParams, ...legacyParams }),
    [uiParams, legacyParams],
  );
  // Preserve the key for the same logical command until the backend confirms success.
  const pendingIdempotencyKeys = useRef(new Map<string, string>());
  const pendingMCommandAttempts = useRef(new Map<string, { value: string; idempotencyKey: string }>());
  const pendingMCommandMetadata = useRef(new Map<string, { action?: string; reason?: string }>());
  const pendingMCommandBaselines = useRef(new Map<string, { legacyParams: Record<string, string>; data: MContentData | null }>());
  const pendingMDirectWriteKeys = useRef(new Map<string, string>());

  const runMWrite = useCallback(
    async (key: string, value: string, meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string }): Promise<boolean> => {
      if (isMUiKey(key)) {
        setUiParams((prev) => ({ ...prev, [key]: value }));
        return true;
      }
      const fingerprint = `${key}\u0000${value}\u0000${meta?.reason?.trim() ?? ""}`;
      const commandFingerprint = meta?.commandKey ?? fingerprint;
      const attempt = pendingMCommandAttempts.current.get(commandFingerprint);
      const idempotencyKey = meta?.idempotencyKey
        ?? attempt?.idempotencyKey
        ?? pendingIdempotencyKeys.current.get(fingerprint)
        ?? `m-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
      const stableValue = attempt?.value ?? value;
      const stableMetadata = pendingMCommandMetadata.current.get(commandFingerprint)
        ?? { action: meta?.action, reason: meta?.reason };
      const stableBaseline = pendingMCommandBaselines.current.get(commandFingerprint)
        ?? { legacyParams, data: mData };
      pendingIdempotencyKeys.current.set(fingerprint, idempotencyKey);
      pendingMCommandAttempts.current.set(commandFingerprint, { value: stableValue, idempotencyKey });
      pendingMCommandMetadata.current.set(commandFingerprint, stableMetadata);
      pendingMCommandBaselines.current.set(commandFingerprint, stableBaseline);
      try {
        await applyMBackendWrite(key, stableValue, stableBaseline.legacyParams, stableBaseline.data, { ...meta, ...stableMetadata, idempotencyKey });
        await reloadMContent();
        pendingIdempotencyKeys.current.delete(fingerprint);
        pendingMCommandAttempts.current.delete(commandFingerprint);
        pendingMCommandMetadata.current.delete(commandFingerprint);
        pendingMCommandBaselines.current.delete(commandFingerprint);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : "M_CONTENT_WRITE_FAILED";
        const detail = /failed to fetch|networkerror|load failed/i.test(message) ? "" : ` · ${message}`;
        setToast(`写入失败或结果未知,请保留当前输入并重试${detail}`);
        return false;
      }
    },
    [legacyParams, mData, reloadMContent, setToast],
  );

  const runM3DirectWrite = useCallback(async (
    fingerprint: string,
    write: (idempotencyKey: string) => Promise<unknown>,
    failureMessage: string,
  ): Promise<boolean> => {
    const idempotencyKey = pendingMDirectWriteKeys.current.get(fingerprint)
      ?? `m3-${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    pendingMDirectWriteKeys.current.set(fingerprint, idempotencyKey);
    try {
      await write(idempotencyKey);
      await reloadMContent();
      pendingMDirectWriteKeys.current.delete(fingerprint);
      return true;
    } catch (error) {
      setToast(`${failureMessage}或结果未知,请重试 · ${error instanceof Error ? error.message : ""}`);
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
    addCustomerTag,
    removeCustomerTag,
    addCustomerNote,
    removeCustomerNote,
    toast: setToast,
    openActionConfirm: setActionConfirm,
    openConfirm: setCf,
  };

  const [ro, liveLabel] = RO_LIVE[tab];
  // 实时计数:M1/M2/M3 的「实时计数/汇总」从后端会话 / 工单快照派生;
  // M4/M5 是描述标签(未声称计数)保留原文。
  const liveCount = useMemo(() => {
    if (tab !== "M1" && tab !== "M2" && tab !== "M3") return null;
    const convos = dockParseConvos(mergedParams["I.session.convos"] as string | undefined);
    const tickets = parseTicketsLive(mergedParams["I.support.tickets"] as string | undefined);
    const openConvos = convos.filter((c) => c.status === "open" && !c.archived).length;
    const unreadConvos = convos.filter((c) => c.unread > 0 && !c.archived).length;
    const openTickets = tickets.filter((t) => t.status !== "resolved" && t.status !== "closed").length;
    if (tab === "M3") return `进行中 ${openConvos} · 待回复 ${unreadConvos}`;
    if (tab === "M2") return `处理中工单 ${openTickets}`;
    return `工单 ${openTickets} · 会话 ${openConvos}`; // M1
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

      {!mData ? (
        <div className="card card-pad">
          <span className="dim" style={{ fontSize: 13 }}>{mLoading ? "正在加载 M 客服中心真实数据..." : "暂无可展示的 M 客服中心真实数据"}</span>
        </div>
      ) : (
        <>
          {tab === "M1" && <M1Overview ctx={ctx} />}
          {tab === "M2" && <M2Tickets ctx={ctx} />}
          {tab === "M3" && <M3Sessions ctx={ctx} />}
          {tab === "M4" && <M4KbSla ctx={ctx} />}
          {tab === "M5" && <M5Scripts ctx={ctx} />}
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
      <SessionDock ctx={ctx} hidden={tab === "M3"} />
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

async function writeTicketRows(prev: SupportTicket[], next: SupportTicket[], reason: string, action?: string, data?: MContentData | null) {
  const added = addedRow(prev, next);
  if (added) {
    const fromConvo = added.subject.match(/由会话\s+([^\s]+)\s+转入/);
    if (fromConvo?.[1]) {
      await mContentActions.convertConversationToTicket(
        fromConvo[1],
        {
          category: added.category,
          priority: added.priority,
          title: added.subject,
          assignedAdminId: adminIdForAgent(added.owner, data),
          assignedAdminName: added.owner || "Unassigned",
        },
        reason,
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
        assignedAdminId: adminIdForAgent(added.owner, data),
        assignedAdminName: added.owner || "Unassigned",
      },
      reason,
    );
    return;
  }

  const row = changedRow(prev, next);
  if (!row) return;
  const before = prev.find((item) => item.id === row.id);
  if (!before) return;
  const newMessage = row.messages.length > before.messages.length ? row.messages[row.messages.length - 1] : null;
  if (newMessage?.author === "agent") {
    await mContentActions.replyTicket(row.id, newMessage.body, reason);
    return;
  }
  if (row.status !== before.status) {
    await mContentActions.updateTicketStatus(row.id, row.status, reason);
    return;
  }
  if (row.priority !== before.priority) {
    await mContentActions.updateTicketPriority(row.id, row.priority, reason);
    return;
  }
  if (row.owner !== before.owner) {
    await mContentActions.assignTicket(row.id, row.owner, adminIdForAgent(row.owner, data), reason);
    return;
  }
  if (Boolean(row.archived) !== Boolean(before.archived)) {
    await mContentActions.archiveTicket(row.id, Boolean(row.archived), reason);
    return;
  }
  if (action?.includes("conversation_from_ticket")) return;
  await mContentActions.replyTicket(row.id, "工单信息已同步更新", reason);
}

async function writeConversationRows(prev: SessionConvo[], next: SessionConvo[], reason: string, action?: string, data?: MContentData | null, idempotencyKey?: string) {
  const added = addedRow(prev, next);
  if (added) {
    const ownerAgentName = added.owner === "Unassigned" ? added.agentName : added.owner;
    await mContentActions.initiateConversation(
      {
        conversationType: added.type,
        userId: userIdFromProfile(added),
        ownerAgentId: agentIdForName(ownerAgentName, data),
        ownerAgentName,
        openingText: firstAgentText(added),
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

  if (!before.transfer && row.transfer) {
    const targetId = row.transfer.to.kind === "agent" ? agentIdForName(row.transfer.to.name, data) : undefined;
    await mContentActions.transferConversation(row.id, row.transfer, row.transfer.reason || reason, targetId, idempotencyKey);
    return;
  }
  if (before.transfer && !row.transfer) {
    if (action?.includes("退回") || action?.includes("return")) await mContentActions.returnTransfer(row.id, reason, idempotencyKey);
    else await mContentActions.acceptTransfer(row.id, reason, idempotencyKey);
    return;
  }
  if (before.transfer && row.transfer && JSON.stringify(before.transfer) !== JSON.stringify(row.transfer)) {
    if (row.transfer.fellBack || row.transfer.to.kind === "standby") await mContentActions.fallbackTransfer(row.id, reason, idempotencyKey);
    else {
      const targetId = row.transfer.to.kind === "agent" ? agentIdForName(row.transfer.to.name, data) : undefined;
      await mContentActions.transferConversation(row.id, row.transfer, row.transfer.reason || reason, targetId, idempotencyKey);
    }
    return;
  }

  const newMessage = row.messages.length > before.messages.length ? row.messages[row.messages.length - 1] : null;
  if (newMessage?.sender === "agent") {
    if (action?.includes("transfer_wait")) {
      await mContentActions.waitTransfer(row.id, reason, idempotencyKey);
    } else {
      const body = newMessage.ctaHref ? `${newMessage.text} ${newMessage.ctaHref}` : newMessage.text;
      await mContentActions.replyConversation(row.id, body, reason, idempotencyKey);
    }
    return;
  }
  if (row.status !== before.status) {
    await mContentActions.updateConversationStatus(row.id, row.status, before.status, reason, idempotencyKey);
    return;
  }
  if (Boolean(row.archived) !== Boolean(before.archived)) {
    await mContentActions.archiveConversation(row.id, Boolean(row.archived), before.status, reason, idempotencyKey);
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
  if (before && row.status !== before.status) await mContentActions.updateFaqStatus(row.id, row.status, reason, idempotencyKey);
  else await mContentActions.updateFaq(row, reason, idempotencyKey);
}

async function writeSlaRows(prev: SupportSla[], next: SupportSla[], reason: string, idempotencyKey?: string) {
  const row = next.find((item) => {
    const before = prev.find((old) => old.category === item.category);
    return before && JSON.stringify(before) !== JSON.stringify(item);
  }) ?? next.find((item) => !prev.some((old) => old.category === item.category));
  if (row) await mContentActions.updateSla(row, reason, idempotencyKey);
}

function currentLoadPayload(data: MContentData | null): MLoadConfigWrite {
  if (!data) {
    throw new Error("M_LOAD_CONFIG_BACKEND_SNAPSHOT_MISSING");
  }
  return {
    ...data.loadConfig,
    agentState: data.agentState,
  };
}

async function applyMBackendWrite(
  key: string,
  value: string,
  legacyParams: Record<string, string>,
  data: MContentData | null,
  meta?: { action?: string; reason?: string; idempotencyKey?: string; commandKey?: string },
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
    }>(value);
    if (!payload?.conversationNo || !payload.category || !payload.priority || !payload.title) throw new Error("M3_TICKET_CONVERSION_PAYLOAD_INVALID");
    await mContentActions.convertConversationToTicket(payload.conversationNo, {
      category: payload.category,
      priority: payload.priority,
      title: payload.title,
      assignedAdminId: payload.assignedAdminId,
      assignedAdminName: payload.assignedAdminName || "Unassigned",
    }, reason, idempotencyKey);
    return;
  }
  if (key === "I.session.archiveBatch.__create") {
    const payload = parseRecord<{ conversationNos?: string[] }>(value);
    if (!payload?.conversationNos?.length) throw new Error("M3_ARCHIVE_BATCH_PAYLOAD_INVALID");
    await mContentActions.archiveConversations(payload.conversationNos, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.faq.__delete") {
    const payload = parseRecord<{ faqId?: string }>(value);
    if (!payload?.faqId) throw new Error("M4_FAQ_DELETE_PAYLOAD_INVALID");
    await mContentActions.deleteFaq(payload.faqId, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.load.__bulk") {
    const payload = parseRecord<MLoadConfigWrite>(value);
    if (payload) await mContentActions.updateLoadConfig(payload, reason, idempotencyKey);
    return;
  }
  if (key === "I.support.load.__rebalance") {
    await mContentActions.rebalanceLoad(parseRows<Record<string, unknown>>(value), reason, idempotencyKey);
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
    }>(value);
    if (payload?.adminId) await mContentActions.updateSupportAgentProfile(payload.adminId, payload, reason, idempotencyKey);
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
    }>(value);
    if (payload?.adminId && payload.position) await mContentActions.assignSupportSeat(payload.adminId, { ...payload, position: payload.position }, reason, idempotencyKey);
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
    await writeTicketRows(parseRows<SupportTicket>(legacyParams[key]), parseRows<SupportTicket>(value), reason, meta?.action, data);
    return;
  }
  if (key === "I.support.ticketEscalation.__create") {
    const payload = parseRecord<{ ticketNo?: string; ownerAgentId?: string; ownerAgentName?: string }>(value);
    if (!payload?.ticketNo || !payload.ownerAgentId) throw new Error("M2_TICKET_ESCALATION_PAYLOAD_INVALID");
    await mContentActions.escalateTicket(
      payload.ticketNo,
      { ownerAgentId: payload.ownerAgentId, ownerAgentName: payload.ownerAgentName || "客服台" },
      reason,
    );
    return;
  }
  if (key === "I.session.convos") {
    await writeConversationRows(parseRows<SessionConvo>(legacyParams[key]), parseRows<SessionConvo>(value), reason, meta?.action, data, idempotencyKey);
    return;
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

function SessionDock({ ctx, hidden }: { ctx: MCtx; hidden: boolean }) {
  const [draft, setDraft] = useState("");
  const lastId = ctx.pget(DOCK_LAST_KEY);
  const convos = useMemo(() => dockParseConvos(ctx.pget(DOCK_CONVO_KEY)), [ctx.params]);
  const conv = convos.find((c) => c.id === lastId) ?? null;
  const open = ctx.pget(DOCK_OPEN_KEY) === "1";
  const offFor = ctx.pget(DOCK_OFF_KEY);

  // M3 在台 / 无活跃会话 / 已被关闭(且仍是同一会话)→ 不显
  if (hidden || !conv || (offFor && offFor === lastId)) return null;

  const setOpen = (v: boolean) => ctx.setParam(DOCK_OPEN_KEY, v ? "1" : "0", { action: "持续接待 dock 展开/收起", reason: "ui-state" });
  const closeDock = () => ctx.setParam(DOCK_OFF_KEY, conv.id, { action: "持续接待 dock 关闭", reason: "ui-state" });
  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const now = Date.now();
    const next = convos.map((c) =>
      c.id === conv.id
        ? {
            ...c,
            unread: 0,
            lastTs: now,
            messages: [...c.messages, { ts: now, sender: "agent" as const, agentName: c.owner === "Unassigned" ? "Support desk" : c.owner, text }],
          }
        : c,
    );
    ctx.setParam(DOCK_CONVO_KEY, JSON.stringify(next), {
      action: `坐席回复会话 ${conv.id} · admin.conversation_replied`,
      reason: "持续接待 dock 回复(正文已留档)",
    });
    setDraft("");
    ctx.toast(`${conv.id} 已回复`);
  };

  const customer = conv.customer ?? conv.agentName;

  if (!open) {
    return (
      <button
        type="button"
        data-proof="session-dock-pill"
        onClick={() => setOpen(true)}
        className="card"
        style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, display: "flex", alignItems: "center", gap: 9, padding: "8px 12px 8px 9px", borderRadius: 999, boxShadow: "var(--m-sh-pop)", cursor: "pointer", color: "var(--ink)" }}
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
      body: m.text,
      ctaHref: m.ctaHref,
    } as ThreadMessage;
  });

  return (
    <div
      data-proof="session-dock-panel"
      className="card"
      style={{ position: "fixed", right: 22, bottom: 22, zIndex: 60, width: 372, maxHeight: "min(72vh, 540px)", boxShadow: "var(--m-sh-pop)", overflow: "hidden", display: "flex", flexDirection: "column" }}
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
        <MessageThread messages={threadMessages} relWhen={dockRelWhen} resetKey={conv.id} />
      </div>
      <div style={{ padding: "9px 11px", borderTop: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "flex-end" }}>
        <textarea
          className="ta"
          data-proof="session-dock-reply"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
          placeholder="边处理边回复… ⌘/Ctrl+Enter"
          style={{ maxHeight: 80 }}
        />
        <button type="button" className="btn btn-pri btn-sm" disabled={!draft.trim()} onClick={send}><Icon name="arrow" size={16} /></button>
      </div>
    </div>
  );
}
