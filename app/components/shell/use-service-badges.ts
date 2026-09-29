"use client";

/**
 * 侧栏待办数来自服务端 TODO 分页同一快照的 total。
 */
import { useEffect, useState } from "react";
import { supportClient } from "@/lib/admin/m-support-client";

/** 待维护、待回复、首次联系按客户去重后的服务端计数。 */
export function useServicePendingCount(enabled = true, sessionKey = ""): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    setPending(0);
    if (!enabled) {
      return undefined;
    }
    let cancelled = false;
    const refresh = () => void supportClient.customers({ pageNum: 1, pageSize: 1, filter: "TODO" })
      .then((page) => {
        if (!cancelled) setPending(page.total);
      })
      .catch(() => {
        if (!cancelled) setPending(0);
      });
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener("support-todo-changed", refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("support-todo-changed", refresh);
    };
  }, [enabled, sessionKey]);
  return pending;
}

/** 导航徽标映射:path → 本人待办客户数。 */
export function useNavBadges(enabled = true): Record<string, number> {
  const pending = useServicePendingCount(enabled);
  return pending > 0 ? { "/service/overview": pending } : {};
}
