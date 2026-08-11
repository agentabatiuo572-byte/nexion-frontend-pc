"use client";

/**
 * 即时会话 SSE 订阅 hook —— 给 M 客服中心（m-view.tsx）挂实时推送。
 *
 * ## 鉴权策略（浏览器原生 EventSource 不能自定义请求头）
 *   - 仅允许同源 cookie：连 /api/admin/content/conversations/stream —— 同源请求自动携带 httpOnly cookie
 *     nexion_admin_token，Next route（app/api/admin/content/[...path]/route.ts）已把该 cookie
 *     转成 Authorization: Bearer 透传给后端，JwtAuthenticationFilter 即可解析。
 *   JWT 不进入 URL，避免被代理日志、浏览器历史或监控系统记录。
 *
 * ## 失败关闭与恢复
 *   原生 EventSource 无法读取 401/403 状态；断线后先用同源 HEAD 状态端点重新鉴权。
 *   401/403 立即终止，只有仍处于有效登录态时才进行次数和退避都受限的重连。
 *
 * ## 流式代理
 *   Next route 对 text/event-stream 直接透传 upstream.body，不缓冲响应；普通 JSON 路由仍沿用统一错误处理。
 */
import { useEffect, useRef, useState } from "react";
import { ConversationReconnectGate, isTerminalConversationStreamStatus } from "./conversation-stream-recovery";

export type ConversationEventType = "MESSAGE" | "TRANSFER" | "STATUS" | "INITIATE" | "RECEIPT";

/** 后端 ConversationMessageEvent 的前端镜像（见 OpsConversationController 发布点）。 */
export interface ConversationStreamEvent {
  conversationNo: string;
  messageId?: number;
  eventType: ConversationEventType;
  senderType: "AGENT" | "USER" | "SYSTEM" | string;
  senderName?: string;
  body?: string;
  ts?: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
}

export interface UseConversationStreamOptions {
  /** 收到事件时的回调（已 JSON.parse）；signal 在所属连接断开时立即取消。 */
  onEvent: (event: ConversationStreamEvent, signal: AbortSignal) => void | Promise<void>;
  /** 每次（含首次）连接建立后先补拉权威 list/detail；完成前 ready 始终为 false。 */
  onReconnectSnapshot: (signal: AbortSignal) => Promise<void>;
  /** 是否启用（默认 true；可由调用方在未登录 / 非会话台时关掉）。 */
  enabled?: boolean;
  /** 所属全量 M reload 开始时同步取消当前恢复快照与连接，不安排旧连接重试。 */
  lifecycleSignal?: AbortSignal;
}

const STREAM_PATH = "/api/admin/content/conversations/stream";
const MAX_RECONNECT_ATTEMPTS = 8;
const MAX_RECONNECT_DELAY_MS = 30_000;
const STABLE_CONNECTION_MS = 30_000;

export function useConversationStream({ onEvent, onReconnectSnapshot, enabled = true, lifecycleSignal }: UseConversationStreamOptions) {
  // 用 ref 持有最新回调，避免回调变动重启连接。
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onReconnectSnapshotRef = useRef(onReconnectSnapshot);
  onReconnectSnapshotRef.current = onReconnectSnapshot;
  const [ready, setReady] = useState(false);
  const [reconnectExhausted, setReconnectExhausted] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const retry = () => setRetryNonce((value) => value + 1);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      setReconnectExhausted(false);
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    setReconnectExhausted(false);

    let es: EventSource | null = null;
    let closed = false;
    let reconnectTimer: number | null = null;
    let sessionProbeTimer: number | null = null;
    let stableConnectionTimer: number | null = null;
    let reconnectAttempts = 0;
    let sessionController: AbortController | null = null;
    let snapshotController: AbortController | null = null;
    let activeConnectionController: AbortController | null = null;
    const recoveryGate = new ConversationReconnectGate<ConversationStreamEvent>();

    const suspend = () => {
      if (closed) return;
      closed = true;
      setReady(false);
      recoveryGate.cancel();
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (sessionProbeTimer !== null) window.clearTimeout(sessionProbeTimer);
      if (stableConnectionTimer !== null) window.clearTimeout(stableConnectionTimer);
      sessionController?.abort();
      snapshotController?.abort();
      activeConnectionController?.abort();
      es?.close();
      es = null;
    };
    lifecycleSignal?.addEventListener("abort", suspend, { once: true });
    if (lifecycleSignal?.aborted) suspend();

    const scheduleReconnect = (connect: () => void) => {
      if (closed) return;
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        setReconnectExhausted(true);
        return;
      }
      const delay = Math.min(1_000 * 2 ** reconnectAttempts, MAX_RECONNECT_DELAY_MS);
      reconnectAttempts += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    };

    const reconnectAfterAuthorizationProbe = (connect: () => void) => {
      if (closed || sessionProbeTimer !== null) return;
      sessionProbeTimer = window.setTimeout(() => {
        sessionProbeTimer = null;
        if (closed) return;
        sessionController?.abort();
        const controller = new AbortController();
        sessionController = controller;
        const timeout = window.setTimeout(() => controller.abort(), 5_000);
        void fetch("/api/admin/auth/session", {
          cache: "no-store",
          credentials: "same-origin",
          signal: controller.signal,
        }).then(async (response) => {
          await response.body?.cancel().catch(() => undefined);
          if (closed) return;
          if (response.status === 401 || response.status === 403) {
            setReconnectExhausted(true);
            return;
          }
          const streamStatusResponse = await fetch(STREAM_PATH, {
            method: "HEAD",
            cache: "no-store",
            credentials: "same-origin",
            signal: controller.signal,
          });
          await streamStatusResponse.body?.cancel().catch(() => undefined);
          if (closed) return;
          if (isTerminalConversationStreamStatus(streamStatusResponse.status)) {
            setReconnectExhausted(true);
            return;
          }
          scheduleReconnect(connect);
        }).catch(() => {
          if (closed) return;
          scheduleReconnect(connect);
        }).finally(() => {
          window.clearTimeout(timeout);
          if (sessionController === controller) sessionController = null;
        });
      }, 100);
    };

    const connect = () => {
      if (closed) return;
      const connection = new EventSource(STREAM_PATH);
      const connectionController = new AbortController();
      activeConnectionController = connectionController;
      es = connection;

      const disconnect = () => {
        if (closed || es !== connection) return;
        setReady(false);
        connectionController.abort();
        snapshotController?.abort();
        recoveryGate.cancel();
        if (stableConnectionTimer !== null) window.clearTimeout(stableConnectionTimer);
        stableConnectionTimer = null;
        connection.close();
        es = null;
        reconnectAfterAuthorizationProbe(connect);
      };

      connection.onopen = () => {
        if (closed || es !== connection) return;
        setReady(false);
        const generation = recoveryGate.begin();
        snapshotController?.abort();
        const controller = new AbortController();
        snapshotController = controller;
        void onReconnectSnapshotRef.current(controller.signal).then(async () => {
          if (closed || es !== connection) return;
          const reconciled = await recoveryGate.complete(
            generation,
            (event) => onEventRef.current(event, connectionController.signal),
          );
          if (!reconciled) return;
          setReady(true);
          if (stableConnectionTimer !== null) window.clearTimeout(stableConnectionTimer);
          stableConnectionTimer = window.setTimeout(() => {
            stableConnectionTimer = null;
            reconnectAttempts = 0;
            setReconnectExhausted(false);
          }, STABLE_CONNECTION_MS);
        }).catch(disconnect);
      };
      connection.onmessage = (ev) => {
        // 后端 SseEmitter.event().name("message").data(event) → 默认 message 事件 → onmessage 触发。
        // 心跳是注释帧（:ping），不会进 onmessage。
        try {
          const parsed = JSON.parse(ev.data) as ConversationStreamEvent;
          if (parsed && typeof parsed.conversationNo === "string" && parsed.conversationNo) {
            void recoveryGate.accept(parsed, (event) => onEventRef.current(event, connectionController.signal))
              .then((accepted) => { if (!accepted) disconnect(); })
              .catch(disconnect);
          }
        } catch {
          // 非 JSON 帧：忽略（防御性，不重连）。
        }
      };
      connection.onerror = disconnect;
    };

    connect();

    return () => {
      lifecycleSignal?.removeEventListener("abort", suspend);
      suspend();
      setReady(false);
    };
  }, [enabled, lifecycleSignal, retryNonce]);

  return { ready, reconnectExhausted, retry };
}
