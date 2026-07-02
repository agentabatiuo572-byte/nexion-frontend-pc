"use client";

/**
 * 侧栏导航徽标 — 客服中心「待处理」实时计数(供左侧风琴导航 M3 入口显数量)。
 * 待处理 = 未读 或 转入待处理 且未归档,与 M3 收件箱 SEGS「未读/转入待处理」同口径。
 * 只读取后端会话快照;未加载时保持 0,不再用静态会话种子或本地 persist 兜底。
 */
import { useEffect, useState } from "react";
import { fetchMContentData } from "@/lib/admin/m-client";
import type { SessionConvo } from "../domain-views/m-tabs/data";

function pendingCount(conversations: SessionConvo[]) {
  return conversations.filter((c) => !c.archived && (c.unread > 0 || c.transfer != null)).length;
}

/** 客服会话待处理数(未读 或 转入待处理 · 未归档)。 */
export function useServicePendingCount(): number {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void fetchMContentData()
      .then((data) => {
        if (!cancelled) setPending(pendingCount(data.conversations));
      })
      .catch(() => {
        if (!cancelled) setPending(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return pending;
}

/** 导航徽标映射:path → 待处理数(目前仅 M3 即时会话台)。 */
export function useNavBadges(): Record<string, number> {
  const pending = useServicePendingCount();
  return pending > 0 ? { "/service/sessions": pending } : {};
}
