"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchM3MessagePage, type M3MessagePage } from "@/lib/admin/m-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { compareM3Messages } from "@/lib/admin/m3-message-order";
import type { SessionConvo, SessionMsg } from "./data";

export function mergeM3Messages(previous: SessionMsg[], next: SessionMsg[]): SessionMsg[] {
  return [...new Map([...previous, ...next].map(message => [message.id, message])).values()].sort(compareM3Messages);
}
export type M3PagesState = { key: string; page: M3MessagePage | null; messages: SessionMsg[]; hasMore: boolean; cursor: number | null; loading: boolean; error: string; failed: "reset" | "older" | "latest"; change: "reset" | "older" | "latest"; revision: number; gap: boolean };
const empty = (key: string): M3PagesState => ({ key, page: null, messages: [], hasMore: false, cursor: null, loading: false, error: "", failed: "reset", change: "reset", revision: 0, gap: false });

/** Pages are private to the current identity/customer/assignment and never persisted. */
export function useM3MessagePages(summary: SessionConvo | null, scope: string, opening: number, onDenied: (no: string, customer?: string) => void) {
  const key = summary ? `${scope}:${summary.customerId}:${summary.ownerAdminId}:${summary.assignmentId}:${opening}` : "";
  const keyRef = useRef(key); keyRef.current = key;
  const summaryRef = useRef(summary); summaryRef.current = summary;
  const deniedRef = useRef(onDenied); deniedRef.current = onDenied;
  const [state, setState] = useState(() => empty(key));
  const stateRef = useRef(state); stateRef.current = state.key === key ? state : empty(key);
  const controller = useRef<AbortController | null>(null), serial = useRef(0);
  const readCursor = useRef<number | undefined>(undefined);
  const version = summary ? `${summary.id}:${summary.version}:${summary.lastPublicMessageId ?? ""}:${summary.status}:${summary.unread}` : "";
  const versionRef = useRef(version);
  const request = useCallback(async (kind: "reset" | "older" | "latest", supersede = false, contextCursor?: number) => {
    const current = summaryRef.current, requestKey = keyRef.current;
    if (!current || !requestKey || controller.current && !supersede) return;
    const before = stateRef.current;
    if (kind === "older" && (!before.page || !before.hasMore || before.cursor === null)) return;
    controller.current?.abort();
    const abort = new AbortController(), generation = ++serial.current;
    controller.current = abort;
    const isCurrent = () => !abort.signal.aborted && generation === serial.current && keyRef.current === requestKey;
    setState(previous => ({ ...(kind === "reset" || previous.key !== requestKey ? empty(requestKey) : previous), loading: true, error: "", failed: kind }));
    try {
      const cursor = kind === "older" ? before.cursor! : contextCursor;
      const page = await fetchM3MessagePage(current.id, cursor, abort.signal);
      if (!isCurrent()) return;
      if (page.conversation.customerId !== current.customerId || page.conversation.ownerAdminId !== current.ownerAdminId || page.conversation.assignmentId !== current.assignmentId) throw Object.assign(new Error("会话范围已变化，请重新核对。"), { status: 403 });
      if (page.conversation.version < current.version) throw Object.assign(new Error("会话版本已变化，请重试加载。"), { status: 409 });
      readCursor.current = cursor;
      setState(previous => {
        const base = kind === "reset" || previous.key !== requestKey ? empty(requestKey) : previous;
        const overlaps = !base.messages.length || page.messages.some(message => base.messages.some(old => old.id === message.id));
        // A burst larger than ten must not create a hidden hole between the old tail and latest page.
        const disconnected = kind === "latest" && base.messages.length > 0 && page.messages.length > 0 && !overlaps;
        const gap = base.gap || disconnected;
        const latest = kind === "latest" && base.page !== null;
        return { ...base, page, messages: disconnected ? base.messages : mergeM3Messages(base.messages, page.messages),
          hasMore: latest ? base.hasMore : page.hasMore, cursor: latest ? base.cursor : page.nextBeforeMessageId,
          loading: false, error: "", change: kind, revision: base.revision + 1, gap };
      });
    } catch (cause) {
      if (!isCurrent()) return;
      const status = cause && typeof cause === "object" && "status" in cause ? Number(cause.status) : 0;
      if ([401, 403, 404].includes(status)) {
        setState(empty("")); deniedRef.current(current.id, current.customerId);
      } else setState(previous => ({ ...previous, loading: false, error: displayAdminError(cause), failed: kind }));
    } finally { if (generation === serial.current) controller.current = null; }
  }, []);
  useEffect(() => {
    serial.current++; controller.current?.abort(); controller.current = null;
    versionRef.current = version;
    setState(empty(key));
    if (key) void request("reset");
    return () => { serial.current++; controller.current?.abort(); controller.current = null; };
  }, [key, request]);
  useEffect(() => {
    if (versionRef.current === version) return;
    versionRef.current = version;
    if (key) void request(stateRef.current.page ? "latest" : "reset", true);
  }, [version, key, request]);
  const safe = state.key === key ? state : empty(key);
  return { ...safe,
    readCursor: readCursor.current,
    readReady: Boolean(safe.page && safe.page.conversation.id === summary?.id && (safe.failed === "older" || !safe.loading && !safe.error) && safe.page.conversation.version >= (summary?.version ?? 0)),
    contextReady: Boolean(safe.page && safe.page.conversation.id === summary?.id && !safe.gap && (safe.failed === "older" || !safe.loading && !safe.error) && safe.page.conversation.version >= (summary?.version ?? 0)),
    loadOlder: () => request("older"), retry: () => request(safe.failed), refresh: () => request("latest"), newest: () => request("reset", true),
    refreshReadContexts: (page: { beforeMessageId?: number }) => request("latest", true, page.beforeMessageId),
  };
}
