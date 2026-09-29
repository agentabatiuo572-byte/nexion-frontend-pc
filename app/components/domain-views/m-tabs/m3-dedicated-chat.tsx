"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "@/lib/admin/error-messages";
import { supportClient, SupportClientError, isIndeterminateSupportError, type SupportAttachmentPolicy, type SupportCustomerDetail } from "@/lib/admin/m-support-client";
import { markMConversationRead } from "@/lib/admin/m-client";
import { parseBusinessTime } from "@/lib/admin/business-time";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { shouldSendOnEnter } from "@/lib/keyboard-submit";
import type { AdvisorScript, SessionConvo, SessionMsg } from "./data";
import type { MCtx } from "./types";

type Intent = "SERVICE" | "MAINTENANCE";
type Attachment = { file: File; url: string; uploadId: string; key: string; id?: string; state: "selected" | "uploading" | "ready" | "error"; error?: string };
type Pending = { conversationId: string; key: string; body: string; intent: Intent; kind: "TEXT" | "IMAGE"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedVersion: number };

const CONVO_KEY = "I.session.convos";
const newKey = () => `m3-${crypto.randomUUID()}`;
const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
const ticketLinksKey = (adminId: number) => `nexion-m3-converted-tickets-v1:${adminId}`;
const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
type StoredMessage = PendingMutationRecord & { payload: string };
const pendingMessages = createPendingMutationStore<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", isValidRecord: (row) => typeof row.payload === "string" });
const readPending = (slot: string) => pendingMessages.list().find((row) => row.fingerprint === slot)?.payload;
const rememberPending = (slot: string, commandKey: string, value: object) => pendingMessages.remember(slot, commandKey, { payload: JSON.stringify(value) });
export const validCustomerId = (value: string | null): value is string => Boolean(value && /^\d+$/.test(value) && /[1-9]/.test(value));
const customerIdOf = (convo: SessionConvo) => String(convo.customerId ?? "");
const canSendTo = (convo: SessionConvo, adminId: number) => convo.status === "open"
  && Number.isSafeInteger(adminId) && adminId > 0
  && convo.ownerAdminId === adminId;
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

export function M3DedicatedChat({ ctx }: { ctx: MCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const adminId = session?.adminId ?? 0;
  const canWriteM3 = session?.role === "super" || session?.role === "superadmin" || Boolean(session?.authorities?.includes("service_m3_write"));
  const [requestedCustomerId, setRequestedCustomerId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [screen, setScreen] = useState<"list" | "chat" | "profile">("list");
  const [query, setQuery] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [intent, setIntent] = useState<Intent>("SERVICE");
  const [pending, setPending] = useState<Pending | null>(null);
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
  identityRef.current = `${authEpoch}:${adminId}`;
  const [revokedIds, setRevokedIds] = useState<Set<string>>(() => new Set());

  const conversationsAvailable = ctx.pget("I.session.conversationsAvailable") === "1";
  const requestedCustomerIdValid = requestedCustomerId === null || validCustomerId(requestedCustomerId);
  const all = useMemo(() => parseConversations(ctx.pget(CONVO_KEY)), [ctx.params, ctx]);
  const agents = useMemo(() => {
    try { return JSON.parse(ctx.pget("I.support.agents") ?? "[]") as Array<{ adminId: number; seatType?: string; position?: string }>; }
    catch { return []; }
  }, [ctx.params, ctx]);
  const myAgent = agents.find((agent) => agent.adminId === adminId);
  const canReviewAll = session?.role === "superadmin" || session?.role === "super" || myAgent?.seatType === "MANAGER" || Boolean(myAgent?.position?.includes("主管"));
  const visible = useMemo(() => all.filter((convo) => validCustomerId(customerIdOf(convo)) && !revokedIds.has(convo.id) && (canReviewAll || convo.ownerAdminId === adminId)).sort((a, b) => b.lastTs - a.lastTs), [all, canReviewAll, adminId, revokedIds]);
  const filtered = visible.filter((convo) => !query.trim() || [convo.customer ?? "", convo.profile?.nickname ?? "", convo.profile?.uid ?? "", customerIdOf(convo), convo.id].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())));
  const requestedConvo = validCustomerId(requestedCustomerId) ? visible.find((convo) => customerIdOf(convo) === requestedCustomerId && convo.status === "open") : null;
  const closedCandidateRows = requestedCustomerId && !requestedConvo ? visible.filter((convo) => customerIdOf(convo) === requestedCustomerId && convo.ownerAdminId === adminId && convo.status !== "open") : [];
  const closedCandidateMissing = closedCandidateRows.filter((convo) => selectedClosedIds.has(convo.id) && !convo.detailReady).map((convo) => convo.id);
  const closedReplyCandidates = closedCandidateRows.filter((convo) => convo.detailReady).flatMap((convo) => {
    const latest = lastMessage(convo);
    return latest?.sender === "user" && Number.isSafeInteger(latest.id) ? [{ conversationNo: convo.id, throughMessageId: latest.id!, text: latest.text }] : [];
  });
  const closedReplyTargets = closedReplyCandidates.filter((row) => selectedClosedIds.has(row.conversationNo)).map(({ conversationNo, throughMessageId }) => ({ conversationNo, throughMessageId }));
  const closedCandidatesReady = closedCandidateMissing.length === 0 && !closedCandidateError && [...selectedClosedIds].every((id) => closedReplyCandidates.some((row) => row.conversationNo === id));
  const displayedIntent = pending?.intent ?? firstPending?.intent ?? intent;
  const lockedTargets = firstPending?.replyTargets ?? pending?.message.replyTargets ?? [];
  const displayedClosedIds = new Set([...selectedClosedIds, ...lockedTargets.map((target) => target.conversationNo)]);
  const advisorScripts = useMemo(() => {
    try { const rows = JSON.parse(ctx.pget("I.session.scripts") ?? "[]"); return Array.isArray(rows) ? rows.filter((row): row is AdvisorScript => row?.status === "published" && typeof row.text === "string") : []; }
    catch { return []; }
  }, [ctx.params]);
  const selected = requestedCustomerId ? requestedConvo ?? null : selectedId ? visible.find((convo) => convo.id === selectedId) ?? null : visible[0] ?? null;
  const currentProfileDetail = profileDetail?.customerId === selected?.customerId ? profileDetail : null;
  const ticketRows = (() => { try { const rows: unknown = JSON.parse(ctx.pget("I.support.tickets") ?? "[]"); return Array.isArray(rows) ? rows as Array<{ id?: string }> : []; } catch { return []; } })();
  const linkedTicketNo = selected && ctx.pget("I.support.ticketsAvailable") === "1" && ticketRows.some((ticket) => ticket.id === ticketLinks[selected.id]) ? ticketLinks[selected.id] : null;
  const targetKey = selected?.id ?? (requestedCustomerId ? `first:${requestedCustomerId}` : "");
  const draft = drafts[targetKey] ?? "";
  const writable = canWriteM3 && (selected ? selected.detailReady === true && (!selectedClosedIds.size || closedCandidatesReady) && canSendTo(selected, adminId) && Boolean(currentProfileDetail?.assignmentId && currentProfileDetail.agentAdminId === selected.ownerAdminId) : Boolean(validCustomerId(requestedCustomerId) && closedCandidatesReady && firstDetail?.assignmentId && firstDetail.agentAdminId === adminId));
  const lostAccess = Boolean(selectedId && !requestedCustomerId && !visible.some((convo) => convo.id === selectedId));
  const unreadMessageId = selected?.detailReady ? [...selected.messages].reverse().find((message) => message.sender === "user" && message.id && message.status !== "read")?.id : undefined;

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
    if (!requestedCustomerId || !conversationsAvailable || !closedCandidateMissing.length || closedCandidateError) return;
    const controller = new AbortController();
    void loadConversationDetail(closedCandidateMissing[0], controller.signal).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(closedCandidateMissing[0], requestedCustomerId);
      } else setClosedCandidateError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [requestedCustomerId, closedCandidateMissing.join("|"), conversationsAvailable, authEpoch, closedCandidateRetry, closedCandidateError, loadConversationDetail]);
  useEffect(() => { setClosedCandidateError(""); setSelectedClosedIds(new Set()); }, [requestedCustomerId, authEpoch]);
  useEffect(() => { if (requestedConvo) { setClosedCandidateError(""); setSelectedClosedIds(new Set()); } }, [requestedConvo?.id]);

  useEffect(() => {
    if (selected && writable && ctx.pget("I.session.ui.lastConvo") !== selected.id) {
      void ctx.setParam("I.session.ui.lastConvo", selected.id, { action: "持续接待 dock 选择会话", reason: "ui-state" });
    }
  }, [selected?.id, writable, ctx]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedCustomerId(params.get("customerId"));
    if (params.get("customerId")) setScreen("chat");
  }, []);

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
  const revokeCustomer = useCallback((customerId?: string) => {
    const affected = all.filter((convo) => !customerId || customerIdOf(convo) === customerId).map((convo) => convo.id);
    setRevokedIds((old) => new Set([...old, ...affected]));
    setDrafts((old) => {
      const next = { ...old };
      for (const conversationId of affected) delete next[conversationId];
      if (customerId) delete next[`first:${customerId}`];
      else for (const key of Object.keys(next)) if (key.startsWith("first:")) delete next[key];
      return next;
    });
    if (!customerId || selected?.customerId === customerId || requestedCustomerId === customerId) {
      clearAttachment(); setPending(null); setFirstPending(null); setScreen("list");
      pendingMessages.forget(pendingKey(adminId));
      if (requestedCustomerId) pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId));
    }
  }, [all, selected?.customerId, requestedCustomerId, clearAttachment, adminId]);
  useEffect(() => {
    const onScope = (event: Event) => revokeCustomer((event as CustomEvent<{ customerId?: string }>).detail?.customerId);
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
      uploadControllerRef.current?.abort();
      const current = attachmentRef.current;
      if (current) {
        URL.revokeObjectURL(current.url);
        if (current.id) void supportClient.cancelAttachment(current.id, newKey()).catch(() => undefined);
      }
    };
  }, []);
  useEffect(() => {
    setDrafts({}); setPending(null); setFirstPending(null); setSendError(""); setIntent("SERVICE"); setBusy(false); setRevokedIds(new Set()); setTicketLinks({}); clearAttachment();
  }, [authEpoch, clearAttachment]);
  useEffect(() => {
    if (!adminId) return;
    try {
      const rows: unknown = JSON.parse(sessionStorage.getItem(ticketLinksKey(adminId)) ?? "{}");
      if (rows && typeof rows === "object" && !Array.isArray(rows)) setTicketLinks(Object.fromEntries(Object.entries(rows).filter(([conversationId, ticketNo]) => conversationId && typeof ticketNo === "string" && ticketNo)));
    } catch { setTicketLinks({}); }
  }, [adminId, authEpoch]);
  useEffect(() => {
    if (!adminId || !validCustomerId(requestedCustomerId)) return;
    try {
      const raw = readPending(firstPendingKey(adminId, requestedCustomerId));
      const record = raw ? JSON.parse(raw) as NonNullable<typeof firstPending> : null;
      if (!record || record.customerId !== requestedCustomerId || !record.key || !record.clientMessageId || !record.assignmentId || !record.body) return;
      setFirstPending(record);
      setDrafts((old) => ({ ...old, [`first:${requestedCustomerId}`]: record.body }));
      setSendError("上次发送结果待确认。请用原命令查询并重试。");
    } catch { pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); }
  }, [adminId, requestedCustomerId, authEpoch]);
  useEffect(() => {
    if (!adminId || !conversationsAvailable || pending) return;
    try {
      const raw = readPending(pendingKey(adminId));
      const saved = raw ? JSON.parse(raw) as Pending : null;
      if (!saved?.conversationId || !saved.key || !saved.message?.clientMessageId || !saved.expectedAssignmentId || !Number.isSafeInteger(saved.expectedVersion) || saved.message.sender !== "agent" || saved.message.kind !== saved.kind || saved.message.intent !== saved.intent || saved.message.text !== saved.body || !["TEXT", "IMAGE"].includes(saved.kind)) return;
      const convo = visible.find((row) => row.id === saved.conversationId);
      if (!convo) return;
      setPending(saved);
      if (!requestedCustomerId) setSelectedId(convo.id);
      if (saved.kind === "TEXT") setDrafts((old) => ({ ...old, [convo.id]: saved.body }));
      setSendError("上次发送结果待确认。请用原命令重试同一条消息。");
    } catch { pendingMessages.forget(pendingKey(adminId)); }
  }, [adminId, conversationsAvailable, authEpoch, visible, pending, requestedCustomerId]);
  useEffect(() => { clearAttachment(); setIntent("SERVICE"); if (!pending && !firstPending) setSendError(""); }, [selected?.id, selected?.ownerAdminId, selected?.assignmentId, requestedCustomerId, clearAttachment]);
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
    if (!lostAccess && (!selected || selected.ownerAdminId === adminId || canReviewAll)) return;
    clearAttachment(); setPending(null); setSendError("当前已无权访问该会话，请返回客户列表刷新。"); setScreen("list");
    if (adminId) pendingMessages.forget(pendingKey(adminId));
  }, [lostAccess, selected, adminId, canReviewAll, clearAttachment]);

  useEffect(() => {
    if (!validCustomerId(requestedCustomerId) || requestedConvo || !conversationsAvailable) { setFirstDetail(null); return; }
    const controller = new AbortController();
    setDetailLoading(true); setDetailError(""); setFirstDetail(null);
    supportClient.customerDetail(requestedCustomerId, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.agentAdminId !== adminId) {
        pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId));
        setFirstPending(null);
        setDrafts((old) => { const next = { ...old }; delete next[`first:${requestedCustomerId}`]; return next; });
      }
      setFirstDetail(result);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId));
        setFirstPending(null);
        setDrafts((old) => { const next = { ...old }; delete next[`first:${requestedCustomerId}`]; return next; });
      }
      setDetailError(displayAdminError(cause));
    })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [requestedCustomerId, requestedConvo, conversationsAvailable, detailRetry, authEpoch, adminId]);
  useEffect(() => {
    if (!selected?.customerId || !conversationsAvailable) { setProfileDetail(null); return; }
    const controller = new AbortController();
    setProfileDetail(null); setProfileError("");
    supportClient.customerDetail(String(selected.customerId), controller.signal).then((detail) => {
      if (controller.signal.aborted) return;
      if (!canReviewAll && detail.agentAdminId !== adminId) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
        return;
      }
      setProfileDetail(detail);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      if (lostPermission(cause)) {
        ctx.invalidateScope(selected.id, String(selected.customerId));
      } else setProfileError(displayAdminError(cause));
    });
    return () => controller.abort();
  }, [selected?.id, selected?.customerId, selected?.version, selected?.lastTs, selected?.unread, selected?.detailReady, selected?.messages.length, conversationsAvailable, authEpoch, profileRetry, revokeCustomer, canReviewAll, adminId]);

  const select = (convo: SessionConvo) => {
    if (firstPending) { setSendError("首次联系的发送结果待确认，请先查询原命令结果，再切换会话。"); return; }
    clearAttachment(pending?.kind !== "IMAGE"); setRequestedCustomerId(null); setSelectedId(convo.id); setScreen("chat"); setIntent("SERVICE"); setReadError(""); setSendError(pending ? "上条消息的结果待确认，请返回原会话用同一命令重试。" : "");
    const url = new URL(window.location.href); url.searchParams.delete("customerId"); window.history.replaceState(null, "", url);
  };

  const send = async (kind: "TEXT" | "IMAGE", retry?: Pending) => {
    if (busy || !conversationsAvailable) return;
    const identity = identityRef.current;
    if (firstPending || !selected) {
      if (kind !== "TEXT" || !validCustomerId(requestedCustomerId) || (!firstPending && (!closedCandidatesReady || !firstDetail?.assignmentId || firstDetail.agentAdminId !== adminId))) return;
      const record = firstPending ?? { key: newKey(), clientMessageId: crypto.randomUUID(), body: draft.trim(), intent, customerId: requestedCustomerId, assignmentId: firstDetail!.assignmentId!, version: firstDetail!.version, replyTargets: closedReplyTargets };
      if (!record.body) return;
      rememberPending(firstPendingKey(adminId, requestedCustomerId), record.key, record);
      setFirstPending(record); setBusy(true); setSendError("");
      try {
        let conversationNo = "";
        if (firstPending) {
          const recovered = await supportClient.command(record.key).catch((cause: unknown) => {
            if (cause instanceof SupportClientError && cause.status === 404) return null;
            throw cause;
          });
          if (!recovered) {
            const result = await supportClient.startConversation({ customerId: record.customerId, openingText: record.body, intent: record.intent, clientMessageId: record.clientMessageId, expectedAssignmentId: record.assignmentId, expectedVersion: record.version, replyTargets: record.replyTargets }, record.key);
            conversationNo = result.conversationNo;
          } else {
          if (recovered.status !== "SUCCEEDED" && recovered.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后用原命令重试。"); return; }
          if (recovered.status === "FAILED") { pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null); setSendError("服务端确认发送失败。草稿已保留，可修改后重新发送。"); return; }
          const result = recovered.result;
          if (result && typeof result === "object" && "conversationNo" in result && typeof result.conversationNo === "string") conversationNo = result.conversationNo;
          }
        } else {
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
        if (!refreshFailed) { const url = new URL(window.location.href); url.searchParams.delete("customerId"); window.history.replaceState(null, "", url); }
        setScreen("chat");
      } catch (cause) {
        if (identityRef.current === identity) {
          if (rejectedSend(cause)) {
            pendingMessages.forget(firstPendingKey(adminId, requestedCustomerId)); setFirstPending(null);
            if (lostPermission(cause)) { ctx.invalidateScope(undefined, requestedCustomerId); setSendError("当前客户归属或会话权限已变化，请返回客户列表核对。"); }
            else { setDetailRetry((value) => value + 1); setSendError(`服务端已拒绝本次发送：${displayAdminError(cause)}。原文已保留，请核对客户归属后修改重发。`); }
          } else setSendError(`发送失败或结果待确认：${displayAdminError(cause)}。请用原命令重试。`);
        }
      }
      finally { setBusy(false); }
      return;
    }
    if (retry ? retry.conversationId !== selected.id : !writable || !currentProfileDetail?.assignmentId || Boolean(pending)) return;
    const body = retry?.body ?? (kind === "TEXT" ? draft.trim() : "");
    const attachmentId = retry?.attachmentId ?? (kind === "IMAGE" ? attachment?.id : undefined);
    if (kind === "TEXT" && !body || kind === "IMAGE" && !attachmentId) return;
    let currentVersion = selected.version;
    if (!retry) {
      setBusy(true);
      try {
        const state = await supportClient.conversationState(selected.id);
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
        setBusy(false);
        if (lostPermission(cause)) ctx.invalidateScope(selected.id, String(selected.customerId));
        setSendError(`会话状态暂时无法确认：${displayAdminError(cause)}。原文已保留，请重试。`);
        return;
      }
    }
    const record = retry ?? (() => {
      const latest = [...selected.messages].reverse().find((message) => message.sender === "user" && Number.isSafeInteger(message.id));
      const replyTargets = [
        ...(latest?.sender === "user" && Number.isSafeInteger(latest.id) && (intent === "SERVICE" || includeCurrentReply) ? [{ conversationNo: selected.id, throughMessageId: latest.id! }] : []),
        ...closedReplyTargets,
      ];
      const message: SessionMsg = { ts: Date.now(), sender: "agent", agentName: session?.operator || session?.username || selected.owner, text: body, kind, attachmentId, intent, clientMessageId: crypto.randomUUID(), replyTargets: replyTargets.length ? replyTargets : undefined };
      return { conversationId: selected.id, key: newKey(), body, intent, kind, attachmentId, message, expectedAssignmentId: currentProfileDetail!.assignmentId!, expectedVersion: currentVersion };
    })();
    rememberPending(pendingKey(adminId), record.key, record);
    setPending(record); setBusy(true); setSendError("");
    const input = { kind: record.kind, content: record.kind === "TEXT" ? record.body : undefined, attachmentId: record.attachmentId, intent: record.intent, clientMessageId: record.message.clientMessageId!, replyTargets: record.message.replyTargets, expectedAssignmentId: record.expectedAssignmentId, expectedVersion: record.expectedVersion };
    let ok = false;
    try {
      if (retry) {
        const recovered = await supportClient.command(record.key).catch((cause: unknown) => {
          if (cause instanceof SupportClientError && cause.status === 404) return null;
          throw cause;
        });
        if (recovered && recovered.status !== "SUCCEEDED" && recovered.status !== "FAILED") { setSendError("发送结果仍在确认，请稍后查询原命令。"); return; }
        if (recovered?.status === "FAILED") { pendingMessages.forget(pendingKey(adminId)); setPending(null); setSendError("服务端确认发送失败。草稿已保留，可修改后重新发送。"); return; }
        if (!recovered) {
          if (!writable || currentProfileDetail?.assignmentId !== record.expectedAssignmentId) {
            setSendError("原命令未找到；请先恢复会话详情并核对当前归属，再用原命令重试。");
            return;
          }
          await supportClient.sendConversationReply(record.conversationId, input, record.key);
        }
      } else {
        await supportClient.sendConversationReply(record.conversationId, input, record.key);
      }
      ok = true;
      try { await ctx.refreshConversations(); }
      catch { setSendError("消息已发送，但会话列表暂未刷新。请刷新会话查看最新消息。"); }
    }
    catch (cause) {
      if (identityRef.current === identity && rejectedSend(cause)) {
        pendingMessages.forget(pendingKey(adminId)); setPending(null);
        void ctx.refreshConversations().catch(() => {});
        if (lostPermission(cause)) { ctx.invalidateScope(selected.id, String(selected.customerId)); setSendError("当前会话权限已变化，请返回客户列表核对。"); }
        else setSendError(`服务端已拒绝本次发送：${displayAdminError(cause)}。原文已保留，请核对会话后修改重发。`);
        return;
      }
      if (identityRef.current === identity) setSendError(`发送结果待确认：${displayAdminError(cause)}。请用原命令重试。`);
    }
    finally { if (identityRef.current === identity) setBusy(false); }
    if (identityRef.current !== identity) return;
    if (ok) {
      window.dispatchEvent(new Event("support-todo-changed"));
      setProfileDetail(null); setProfileRetry((value) => value + 1);
      pendingMessages.forget(pendingKey(adminId));
      if (record.kind === "TEXT") setDrafts((old) => ({ ...old, [record.conversationId]: old[record.conversationId] === record.body ? "" : old[record.conversationId] }));
      if (record.kind === "IMAGE") clearAttachment(false);
      setPending(null);
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
  const checkActionReady = async (conversation: SessionConvo) => {
    if (!conversation.customerId || actionChecking) return false;
    setActionChecking(true); setActionError("");
    try {
      const detail = await supportClient.customerDetail(String(conversation.customerId));
      if (detail.agentAdminId !== adminId || !detail.assignmentId) { ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError("客户归属已变化，请刷新会话后重试。"); return false; }
      setProfileDetail(detail);
      if (detail.waitingReply) { setActionError("还有客户消息待回复，请先发送服务回复后再办理。"); return false; }
      return true;
    } catch (cause) { if (lostPermission(cause)) ctx.invalidateScope(conversation.id, String(conversation.customerId)); setActionError(`客户待回复状态暂时无法核对：${displayAdminError(cause)}。请重试。`); return false; }
    finally { setActionChecking(false); }
  };
  const closeConversation = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    ctx.openActionConfirm({
      action: `关闭服务会话 ${conversation.id}`,
      detail: "只关闭这段服务会话，不改变客户的专属顾问。客户再次求助时会开启新会话。",
      reasonMin: 8, reasonMax: 200,
      run: async (reason) => {
        const rows = all.map((row) => row.id === conversation.id ? { ...row, status: "closed" as const } : row);
        const ok = await ctx.setParam(CONVO_KEY, JSON.stringify(rows), { action: `关闭服务会话 ${conversation.id}`, reason, commandKey: `m3:close:${conversation.id}:${conversation.version}` });
        if (!ok) setActionError("关闭结果未确认，请保留原操作并重试；如有新客户消息，请先回复。");
        return ok;
      },
    });
  };
  const convertToTicket = async () => {
    if (!selected?.detailReady || !writable || pending || firstPending || !await checkActionReady(selected)) return;
    const conversation = selected;
    ctx.openActionConfirm({
      action: `转工单 ${conversation.id}`,
      detail: "为此会话建立内部跟进工单；工单处理人不会因此取得客户私聊权限。",
      reasonMin: 8, reasonMax: 200,
      run: async (reason) => {
        const ok = await ctx.setParam("I.session.ticket.__create", JSON.stringify({
          conversationNo: conversation.id, category: "account", priority: "normal",
          title: `由会话 ${conversation.id} 转入 · ${conversation.customer || conversation.agentName}`,
          assignedAdminId: adminId, assignedAdminName: session?.operator || conversation.owner,
          expectedStatus: conversation.status, expectedVersion: conversation.version,
        }), { action: `会话转工单 ${conversation.id}`, reason, commandKey: `m3:convert-ticket:${conversation.id}:${conversation.version}`, onBackendResult: (result) => {
          if (result && typeof result === "object" && "ticketNo" in result && typeof result.ticketNo === "string" && result.ticketNo.trim()) {
            const ticketNo = result.ticketNo;
            setTicketLinks((old) => { const next = { ...old, [conversation.id]: ticketNo }; try { sessionStorage.setItem(ticketLinksKey(adminId), JSON.stringify(next)); } catch {} return next; });
          }
        } });
        if (!ok) setActionError("转工单结果未确认，请重试查询；如有新客户消息，请先回复。");
        return ok;
      },
    });
  };
  const continueClosed = () => {
    if (!canWriteM3 || !selected?.detailReady || !selected.customerId || selected.ownerAdminId !== adminId || !canSendTo({ ...selected, status: "open" }, adminId)) return;
    const url = new URL(window.location.href); url.searchParams.set("customerId", String(selected.customerId)); window.history.replaceState(null, "", url);
    setSelectedClosedIds(new Set());
    setRequestedCustomerId(String(selected.customerId));
    setScreen("chat");
    setActionError("");
  };

  return <section className="m3-stage" aria-label="专属客服会话" style={{ height: "min(760px, calc(100dvh - 220px))", minHeight: 540 }}>
    <style>{`.mdom .m3-stage{grid-template-columns:300px minmax(0,1fr) 264px}.mdom .m3-stage .l-btn.sm{min-height:44px}.mdom .m3-stage button:focus-visible,.mdom .m3-stage textarea:focus-visible,.mdom .m3-stage input:focus-visible,.mdom .m3-stage select:focus-visible,.mdom .m3-stage summary:focus-visible{outline:2px solid var(--v5-brand);outline-offset:2px}.mdom .m3-stage .ChatComposer{flex:0 1 auto;min-height:0;max-height:60%;overflow-y:auto}.mdom .m3-more{position:relative}.mdom .m3-more summary{cursor:pointer;list-style:none;display:flex;align-items:center}.mdom .m3-more summary::-webkit-details-marker{display:none}.mdom .m3-more-menu{position:absolute;right:0;top:100%;z-index:35;min-width:190px;padding:8px;display:grid;gap:6px;border:1px solid var(--v5-border);border-radius:10px;background:var(--v5-surface);box-shadow:0 12px 28px rgba(0,0,0,.18)}.mdom .m3-more-menu>*{width:100%;justify-content:flex-start;white-space:nowrap}@container mdom (max-width:1060px){.mdom .m3-stage{grid-template-columns:280px minmax(0,1fr)}.mdom .m3-stage .cv-profile:not(.open){visibility:hidden}}@container mdom (max-width:760px){.mdom .m3-stage{grid-template-columns:1fr;height:max(340px,calc(100dvh - 250px))!important;min-height:340px!important}.mdom .m3-col-chat>header{display:grid!important;grid-template-columns:auto minmax(0,1fr) auto;gap:8px!important}.mdom .m3-col-chat>header>div:nth-child(2){min-width:0}.mdom .m3-col-chat>header h2{overflow-wrap:anywhere}.mdom .m3-col-chat>header .m3-more{grid-column:3}}`}</style>
    <div className={`m3-col-list ${screen !== "list" ? "hide-narrow" : ""}`}>
      <header style={{ padding: 16, borderBottom: "1px solid var(--v5-border)" }}><h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>我的会话</h2><p style={{ color: "var(--v5-ink-3)", fontSize: 12, margin: "5px 0 12px" }}>只显示当前可审阅的客户会话</p><input className="fld" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索客户或会话编号" aria-label="搜索客户或会话编号" style={{ width: "100%" }} /></header>
      <div className="cv-list">
        {!conversationsAvailable && <div className="itint danger" role="alert">{serviceStatus} <button className="l-btn sm" type="button" onClick={() => void ctx.refreshConversations()}>重新连接</button></div>}
        {conversationsAvailable && filtered.length === 0 && <div className="itint">{query ? "没有匹配的会话，请清除搜索。" : "暂无会话。可从“我的客户”发起首次联系。"}</div>}
        {filtered.map((convo) => { const last = convo.detailReady ? lastMessage(convo) : null; const hasMessage = Boolean(last || convo.lastPreview || convo.lastMessageKind === "IMAGE"); const active = selected?.id === convo.id; const knownReplyState = currentProfileDetail && currentProfileDetail.customerId === convo.customerId ? currentProfileDetail.waitingReply : null; return <button key={convo.id} type="button" className={`cv-item ${active ? "on" : ""}`} onClick={() => select(convo)} aria-current={active ? "true" : undefined}><span className="cv-r1"><strong className="cv-name">{convo.customer || convo.profile?.nickname || `客户 ${convo.customerId}`}</strong><span className="cv-sp" /><time className="cv-time">{messageTime(convo.lastTs)}</time></span><span className="cv-prev">{(last?.kind ?? convo.lastMessageKind) === "IMAGE" ? "[图片]" : last?.text || convo.lastPreview || "尚无人工消息"}</span><span className="cv-meta"><span className="cv-stat">{!hasMessage ? "待首次联系" : knownReplyState === true ? "待顾问回复" : knownReplyState === false ? "已处理" : "查看待回复状态"}</span><span className="cv-tag">{convo.status === "open" ? "进行中" : "只读历史"}</span></span></button>; })}
      </div>
    </div>
    <div ref={chatColumnRef} className={`m3-col-chat ${screen === "list" ? "hide-narrow" : ""}`}>
      <header style={{ padding: "12px 16px", borderBottom: "1px solid var(--v5-border)", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}><button type="button" className="l-btn sm" onClick={() => setScreen("list")} aria-label="返回会话列表">返回</button><div style={{ minWidth: 0, flex: 1 }}><h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{title}</h2><div style={{ color: "var(--v5-ink-3)", fontSize: 12 }}>{selected ? `当前顾问：${selected.owner} · ${selected.status === "open" ? "当前会话" : "历史会话"}` : requestedCustomerId ? "首次联系" : "选择客户查看会话"}</div></div>{selected && <button type="button" className="l-btn sm" onClick={() => setScreen("profile")}>客户资料</button>}{canWriteM3 && selected?.detailReady && selected.status !== "open" && selected.ownerAdminId === adminId && <button type="button" className="l-btn sm" onClick={continueClosed}>接续回复</button>}{selected && (writable || linkedTicketNo || canReviewAll && selected.customerId) && <details className="m3-more"><summary className="l-btn sm">更多操作</summary><div className="m3-more-menu">{writable && <><button type="button" className="l-btn sm" disabled={actionChecking} onClick={closeConversation}>关闭服务会话</button><button type="button" className="l-btn sm" disabled={actionChecking} onClick={convertToTicket}>转工单</button></>}{linkedTicketNo && <a className="l-btn sm" href={`/service/tickets?query=${encodeURIComponent(linkedTicketNo)}`}>工单详情</a>}{canReviewAll && selected.customerId && <a className="l-btn sm" href={`/service/overview?customerId=${encodeURIComponent(selected.customerId)}`}>正式转绑客户</a>}</div></details>}</header>
      <div className="ChatBody" role="log" aria-label="会话消息" aria-live="polite" style={{ gap: 14 }}>
        {serviceStatus && <div className="itint danger" role="alert">{serviceStatus}</div>}
        {actionError && <div className="itint danger" role="alert">{actionError}<button type="button" className="l-btn sm" onClick={() => setActionError("")}>知道了</button></div>}
        {!requestedCustomerIdValid && <div className="itint danger" role="alert">客户链接无效，无法打开会话。请从<a href="/service/overview">我的客户</a>重新进入。</div>}
        {readError && <div className="itint warn" role="alert">已读状态更新失败：{readError} <button type="button" className="l-btn sm" onClick={() => { markedRef.current = ""; setReadRetry((value) => value + 1); }}>重试</button></div>}
        {selected && !selected.detailReady ? <div className="itint" role={conversationError ? "alert" : "status"}>{conversationError ? `会话详情读取失败：${conversationError}` : "正在读取会话消息…"} {conversationError && <button type="button" className="l-btn sm" onClick={() => { setConversationError(""); setConversationRetry((value) => value + 1); }}>重试读取详情</button>}</div> : selected?.messages.length ? selected.messages.map((message, index) => <div key={message.id ?? `${message.ts}-${index}`} style={{ alignSelf: message.sourceSenderType === "SYSTEM" || message.sourceSenderType === "INTERNAL" ? "center" : message.sender === "agent" ? "flex-end" : "flex-start", maxWidth: "82%", display: "grid", gap: 4 }}><span style={{ color: "var(--v5-ink-3)", fontSize: 11.5 }}>{message.sourceSenderType === "SYSTEM" || message.sourceSenderType === "INTERNAL" ? "系统" : message.sender === "agent" ? message.agentName || "顾问" : title} · {messageTime(message.ts)}</span><div style={{ borderRadius: 12, padding: "9px 12px", background: message.sender === "agent" ? "var(--v5-brand-soft)" : "var(--v5-surface-2)", color: "var(--v5-ink-2)", overflowWrap: "anywhere" }}>{message.kind === "IMAGE" ? message.attachmentId ? <PrivateImage key={`${authEpoch}:${selected.id}:${message.attachmentId}`} id={message.attachmentId} onRevoked={() => ctx.invalidateScope(selected.id, String(selected.customerId))} /> : "图片暂不可用" : message.text}</div></div>) : <div className="itint">{requestedCustomerId ? "尚无进行中会话。核对归属后即可发送首次联系。" : selected ? "这段会话尚无消息。" : "选择会话后查看消息。"}</div>}
      </div>
      <div className="ChatComposer" style={{ display: "grid", gap: 10 }}>
        {detailLoading && <div className="itint">正在核对当前顾问归属…</div>}
        {detailError && <div className="itint danger" role="alert">客户资料读取失败：{detailError} <button type="button" className="l-btn sm" onClick={() => setDetailRetry((value) => value + 1)}>重试</button> <a href="/service/overview">返回我的客户</a></div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId !== adminId && <div className="itint warn">该客户目前不归本人服务。请返回我的客户核对归属。</div>}
        {requestedCustomerId && firstDetail && firstDetail.agentAdminId === adminId && !firstDetail.assignmentId && <div className="itint warn">当前归属资料未就绪，暂不能发送。请刷新客户资料。</div>}
        {selected && !writable && <div className="itint warn">{!canWriteM3 ? "当前账号只可查看会话，发送需会话操作权限。" : selected.status !== "open" ? "历史会话只读。请从客户入口打开当前会话。" : !currentProfileDetail ? <>正在核对客户归属。{profileError && <button type="button" className="l-btn sm" onClick={() => setProfileRetry((value) => value + 1)}>读取失败，重试</button>}</> : !currentProfileDetail.assignmentId || currentProfileDetail.agentAdminId !== selected.ownerAdminId ? <>客户归属已变化，请刷新会话后重试。<button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations()}>刷新会话</button></> : "仅当前顾问可发送消息；主管审阅不能代发。"}</div>}
        {requestedCustomerId && !selected && !canWriteM3 && <div className="itint warn">当前账号只可查看会话，发送需会话操作权限。</div>}{requestedCustomerId && !selected && <div className="itint"><strong>新服务会话</strong> · 原会话消息只有明确勾选后才会标记为已处理。{!firstPending && <button type="button" className="l-btn sm" onClick={() => { const url = new URL(window.location.href); url.searchParams.delete("customerId"); window.history.replaceState(null, "", url); setRequestedCustomerId(null); setSelectedClosedIds(new Set()); }}>取消接续</button>}{selectedClosedIds.size > 0 && !firstPending && <button type="button" className="l-btn sm" onClick={() => setSelectedClosedIds(new Set())}>清除旧会话选择</button>}{!closedCandidatesReady && <div role={closedCandidateError ? "alert" : "status"}>{closedCandidateError ? `旧会话读取失败：${closedCandidateError}` : closedCandidateMissing.length ? "正在核对已选旧会话消息…" : "已选旧会话的最近消息不是可处理的客户消息，请取消勾选。"} {closedCandidateError && <button type="button" className="l-btn sm" onClick={() => { setClosedCandidateError(""); setClosedCandidateRetry((value) => value + 1); }}>重试核对</button>}</div>}{closedCandidateRows.map((row) => { const target = closedReplyCandidates.find((candidate) => candidate.conversationNo === row.id); return <label key={row.id} style={{ display: "block", marginTop: 8 }}><input type="checkbox" checked={displayedClosedIds.has(row.id)} disabled={Boolean(firstPending || pending)} onChange={(event) => setSelectedClosedIds((old) => { const next = new Set(old); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /> 处理旧会话 {row.id} 的客户消息：{target?.text ?? (row.detailReady ? "最近一条不是待处理客户消息" : "勾选后核对消息")}</label>; })}</div>}
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}><label htmlFor="m3-intent" style={{ color: "var(--v5-ink-3)", fontSize: 12 }}>本条消息用途</label><select id="m3-intent" className="fld" value={displayedIntent} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => setIntent(event.target.value as Intent)}><option value="SERVICE">服务回复</option><option value="MAINTENANCE">联系维护</option></select><span style={{ color: "var(--v5-ink-4)", fontSize: 11.5 }}>仅“联系维护”成功发出后计为一次人工维护</span></div>
        {selected && currentProfileDetail?.waitingReply === true && displayedIntent === "MAINTENANCE" && selected.messages.some((message) => message.sender === "user" && Number.isSafeInteger(message.id)) && <label className="itint"><input type="checkbox" checked={includeCurrentReply || lockedTargets.some((target) => target.conversationNo === selected.id)} disabled={!writable || busy || Boolean(pending)} onChange={(event) => setIncludeCurrentReply(event.target.checked)} /> 同时标记本会话最近一条客户消息已处理（如仍待处理）</label>}
        {advisorScripts.length > 0 && <details><summary>快捷话术</summary><div style={{ display: "grid", gap: 6, marginTop: 8 }}>{advisorScripts.map((script) => <button key={script.id} type="button" className="l-btn sm" disabled={!writable || busy || Boolean(pending || firstPending)} onClick={() => setDrafts((old) => ({ ...old, [targetKey]: script.text }))}>{script.group} · {script.text}</button>)}</div></details>}
        {attachment && <div className="itint" style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}><img src={attachment.url} alt="待发送图片预览" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} /><span style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{attachment.file.name}</span><span>{attachment.state === "ready" ? "已上传，尚未发送" : attachment.state === "uploading" ? "上传中…" : attachment.state === "error" ? `上传失败：${attachment.error}` : "等待上传"}</span><button type="button" className="l-btn sm" disabled={!writable || busy || attachment.state === "uploading" || attachment.state === "ready"} onClick={() => void uploadImage()}>{attachment.state === "error" ? "重试上传" : "上传图片"}</button><button type="button" className="l-btn sm primary" disabled={!writable || busy || Boolean(pending) || attachment.state !== "ready"} onClick={() => void send("IMAGE")}>发送图片</button><button type="button" className="l-btn sm" onClick={() => clearAttachment()} aria-label="移除待发送图片">移除</button><small style={{ color: "var(--v5-ink-3)" }}>发送文字不会附带此图片</small></div>}
        <textarea className="fld" aria-label="输入会话消息" placeholder="输入消息，Enter 发送，Shift+Enter 换行" value={draft} disabled={!writable || busy || Boolean(pending || firstPending)} onChange={(event) => setDrafts((old) => ({ ...old, [targetKey]: event.target.value }))} onKeyDown={(event) => { if (shouldSendOnEnter(event)) { event.preventDefault(); void send("TEXT"); } }} style={{ width: "100%", minHeight: 70, resize: "vertical" }} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}><input ref={fileInputRef} type="file" accept="image/jpeg,image/png" aria-label="选择图片" disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onChange={(event) => { chooseImage(event.target.files?.[0]); event.target.value = ""; }} hidden /><button type="button" className="l-btn sm" style={{ minHeight: 44 }} disabled={!writable || busy || Boolean(pending || firstPending) || !selected || !attachmentPolicy?.available} onClick={() => fileInputRef.current?.click()}>选择图片</button><button className="chat-send" type="button" disabled={!writable || busy || Boolean(pending || firstPending) || !draft.trim()} onClick={() => void send("TEXT")}>{busy ? "发送中…" : "发送文字"}</button></div>
        {selected && (!attachmentPolicy?.available || attachmentPolicyError) && <div className="itint warn" role="status">{attachmentPolicyError || (attachmentPolicy ? "图片功能暂不可用。" : "正在读取图片规则…")} <button type="button" className="l-btn sm" onClick={() => setAttachmentPolicyRetry((value) => value + 1)}>重试</button></div>}
        {pending && selected?.id !== pending.conversationId && <div className="itint warn">另一条消息的结果待确认。请先返回原会话处理。<button type="button" className="l-btn sm" onClick={() => { const original = visible.find((convo) => convo.id === pending.conversationId); if (original) select(original); }}>返回原会话</button></div>}
        {(sendError || pending || firstPending) && <div className="itint danger" role="alert">{sendError || "上条消息的结果待确认，请查询原命令。"} {sendError.startsWith("消息已发送") && <button type="button" className="l-btn sm" onClick={() => void ctx.refreshConversations().then(() => setSendError("")).catch(() => setSendError("消息已发送，但会话列表刷新失败。请稍后再试。"))}>刷新会话</button>}{(pending || firstPending) && <button type="button" className="l-btn sm" disabled={busy || Boolean(pending && selected?.id !== pending.conversationId)} onClick={() => { if (pending) void send(pending.kind, pending); else void send("TEXT"); }}>查询结果并重试</button>}</div>}
      </div>
    </div>
    <aside className={`cv-profile ${screen === "profile" ? "open" : ""}`} aria-label="客户资料"><div className="cvp-scroll"><button type="button" className="l-btn sm" onClick={() => setScreen("chat")}>返回会话</button><h2 style={{ fontSize: 18, fontWeight: 600, margin: "18px 0 8px" }}>客户资料</h2>{selected ? <><div className="cvp-row"><span className="k">客户</span><span className="v">{currentProfileDetail?.displayName || title}</span></div><div className="cvp-row"><span className="k">客户 ID</span><span className="v mono">{selected.customerId}</span></div><div className="cvp-row"><span className="k">当前顾问</span><span className="v">{selected.owner}</span></div><div className="cvp-row"><span className="k">会话状态</span><span className="v">{selected.status === "open" ? "进行中" : "只读历史"}</span></div>{currentProfileDetail ? <><div className="cvp-row"><span className="k">账户状态</span><span className="v">{{ ACTIVE: "活跃", DORMANT: "沉睡", UNKNOWN: "未知" }[currentProfileDetail.accountState]}</span></div><div className="cvp-row"><span className="k">主动维护</span><span className="v">{currentProfileDetail.maintenanceEnabled ? "已开启" : "已暂停"}</span></div><div className="cvp-row"><span className="k">上次有效活动</span><span className="v">{detailTime(currentProfileDetail.lastEffectiveAt)}</span></div><div className="cvp-row"><span className="k">下次维护</span><span className="v">{currentProfileDetail.maintenanceEnabled ? detailTime(currentProfileDetail.nextMaintenanceAt) : "已暂停"}</span></div></> : <div className="itint">{profileError ? <>客户状态读取失败：{profileError} <button type="button" className="l-btn sm" onClick={() => setProfileRetry((value) => value + 1)}>重试</button></> : "正在读取客户状态…"}</div>}<h3 style={{ fontSize: 14, fontWeight: 600, margin: "22px 0 8px" }}>最近服务记录</h3>{!selected.detailReady ? <div className="itint" role={conversationError ? "alert" : "status"}>{conversationError ? `会话记录读取失败：${conversationError}` : "正在读取会话记录…"} {conversationError && <button type="button" className="l-btn sm" onClick={() => { setConversationError(""); setConversationRetry((value) => value + 1); }}>重试读取详情</button>}</div> : selected.messages.length ? selected.messages.slice(-4).reverse().map((message, index) => <div key={message.id ?? `${message.ts}-${index}`} style={{ padding: "8px 0", borderTop: "1px solid var(--v5-border)", fontSize: 12, color: "var(--v5-ink-3)" }}>{messageTime(message.ts)} · {message.sourceSenderType === "SYSTEM" || message.sourceSenderType === "INTERNAL" ? "系统" : message.sender === "agent" ? "顾问" : "客户"}：{message.kind === "IMAGE" ? "发送了图片" : message.text}</div>) : <div className="itint">尚无服务记录</div>}</> : <div className="itint">选择客户后查看资料。</div>}</div></aside>
  </section>;
}
