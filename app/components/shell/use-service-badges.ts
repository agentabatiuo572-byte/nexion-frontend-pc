"use client";

/**
 * 侧栏待办数来自服务端 TODO 分页同一快照的 total。
 */
import { createContext, useEffect, useState } from "react";
import { isSupportSessionExpired, supportClient } from "@/lib/admin/m-support-client";

export type SupportPendingCount = number | "—" | undefined;
export const ServicePendingCount = createContext<SupportPendingCount>(undefined);

/** 待维护、待回复、首次联系按客户去重后的服务端计数。 */
export function useServicePendingCount(enabled: boolean, sessionKey: string): SupportPendingCount {
  const [read, setRead] = useState<{ sessionKey: string; count: SupportPendingCount }>();
  useEffect(() => {
    if (!enabled) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      void supportClient.customers({ pageNum: 1, pageSize: 1, filter: "TODO", signal })
        .then(page => { if (!signal.aborted) setRead({ sessionKey, count: page.total }); })
        .catch(cause => { if (!signal.aborted && !isSupportSessionExpired(cause)) setRead({ sessionKey, count: "—" }); });
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("support-todo-changed", refresh);
    return () => {
      controller?.abort();
      window.clearInterval(timer);
      window.removeEventListener("support-todo-changed", refresh);
    };
  }, [enabled, sessionKey]);
  return enabled && read?.sessionKey === sessionKey ? read.count : undefined;
}
