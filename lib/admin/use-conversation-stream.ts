"use client";

/**
 * 即时会话 SSE 订阅 hook —— 给 M 客服中心（m-view.tsx）挂实时推送。
 *
 * ## 鉴权策略（浏览器原生 EventSource 不能自定义请求头）
 *   - 默认（同源 cookie）：连 /api/admin/content/conversations/stream —— 同源请求自动携带 httpOnly cookie
 *     nexion_admin_token，Next route（app/api/admin/content/[...path]/route.ts）已把该 cookie
 *     转成 Authorization: Bearer 透传给后端，JwtAuthenticationFilter 即可解析。
 *   - 兜底（token 模式）：若调用方提供了 JS 可达 token（例如未来登录态镜像），直连后端并附 ?token=<jwt>，
 *     后端 SecurityConfig.SseTokenShimFilter 会把 query token 头化为 Authorization，再走标准 JWT 校验链。
 *     跨域直连需 withCredentials 以满足 CORS 凭证策略。
 *
 * ## 自动重连
 *   onerror 后指数退避（5s → 10s → 20s → 30s 封顶），组件卸载时 EventSource.close() 并清定时器。
 *
 * ## 已知基础设施限制（TODO，非本 hook 职责）
 *   当前 Next route 用 `await upstream.text()` 缓冲整段响应体（route.ts 不在本任务可改文件边界内），
 *   会把 SSE 流攒到 SseEmitter 超时才一次性吐回，实时性失效。管理台在那之前仍依赖 reloadMContent 快照兜底。
 *   修法（出本任务范围）：把 /api/admin/content/conversations/stream 的 Next route 改为流式透传
 *   `new Response(upstream.body, { headers: { "Content-Type": "text/event-stream", ... } })`，
 *   或为 SSE 单独建一条 streaming route handler。
 */
import { useEffect, useRef, useState } from "react";

export type ConversationEventType = "MESSAGE" | "TRANSFER" | "STATUS" | "INITIATE";

/** 后端 ConversationMessageEvent 的前端镜像（见 OpsConversationController 发布点）。 */
export interface ConversationStreamEvent {
  conversationNo: string;
  eventType: ConversationEventType;
  senderType: "AGENT" | "USER" | "SYSTEM" | string;
  senderName?: string;
  body?: string;
  ts?: string;
  ownerAgentId?: string;
  ownerAgentName?: string;
}

export interface UseConversationStreamOptions {
  /** JS 可达 token；若提供则直连后端 ?token=，否则走同源 cookie 代理路径。 */
  token?: string | null;
  /** 后端直连基址（仅 token 模式下使用）；缺省时仅用 STREAM_PATH 相对路径。 */
  backendUrl?: string;
  /** 收到事件时的回调（已 JSON.parse）。 */
  onEvent: (event: ConversationStreamEvent) => void;
  /** 是否启用（默认 true；可由调用方在未登录 / 非会话台时关掉）。 */
  enabled?: boolean;
}

const STREAM_PATH = "/api/admin/content/conversations/stream";
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 30_000;

export function useConversationStream({ token, backendUrl, onEvent, enabled = true }: UseConversationStreamOptions) {
  // 用 ref 持有最新回调，避免回调变动重启连接。
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setReady(false);
      return;
    }
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;

    let es: EventSource | null = null;
    let retry = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const tokenMode = typeof token === "string" && token.length > 0;
    const url = tokenMode
      ? `${(backendUrl ?? "").replace(/\/$/, "")}${STREAM_PATH}?token=${encodeURIComponent(token as string)}`
      : STREAM_PATH;

    const connect = () => {
      // 同源 cookie 模式：默认不启用 withCredentials（同源无需）；token 跨域直连模式需要。
      es = new EventSource(url, tokenMode ? { withCredentials: true } : undefined);

      es.onopen = () => {
        retry = 0;
        setReady(true);
      };
      es.onmessage = (ev) => {
        // 后端 SseEmitter.event().name("message").data(event) → 默认 message 事件 → onmessage 触发。
        // 心跳是注释帧（:ping），不会进 onmessage。
        try {
          const parsed = JSON.parse(ev.data) as ConversationStreamEvent;
          if (parsed && typeof parsed.conversationNo === "string" && parsed.conversationNo) {
            onEventRef.current(parsed);
          }
        } catch {
          // 非 JSON 帧：忽略（防御性，不重连）。
        }
      };
      es.onerror = () => {
        setReady(false);
        es?.close();
        es = null;
        if (closed) return;
        // 指数退避：5s → 10s → 20s → 30s（封顶）。
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * Math.pow(2, retry));
        retry += 1;
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      es?.close();
      setReady(false);
    };
  }, [enabled, token, backendUrl]);

  return { ready };
}
