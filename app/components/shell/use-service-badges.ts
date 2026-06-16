"use client";

/**
 * 侧栏导航徽标 — 客服中心「待处理」实时计数(供左侧风琴导航 M3 入口显数量)。
 * 待处理 = 未读 或 转入待处理 且未归档,与 M3 收件箱 SEGS「未读/转入待处理」同口径。
 * hydration 守卫:未 hydrate 用 seed 计数(SSR 与首帧一致,防 hydration 抖动),hydrate 后切持久态。
 * 真写键沿用 I.session.convos(与 m-tabs 同源),不另造第二份计数。
 */
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import { SESSION_CONVOS, type SessionConvo } from "../domain-views/m-tabs/data";

const CONVO_KEY = "I.session.convos";

function parseConvos(raw: string | undefined): SessionConvo[] {
  if (!raw) return SESSION_CONVOS;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionConvo[]) : SESSION_CONVOS;
  } catch {
    return SESSION_CONVOS;
  }
}

/** 客服会话待处理数(未读 或 转入待处理 · 未归档)。 */
export function useServicePendingCount(): number {
  const hydrated = useOpsHydrated();
  const params = usePlatformConfig((s) => s.params);
  const raw = hydrated && params ? (params[CONVO_KEY] as string | undefined) : undefined;
  return parseConvos(raw).filter((c) => !c.archived && (c.unread > 0 || c.transfer != null)).length;
}

/** 导航徽标映射:path → 待处理数(目前仅 M3 即时会话台)。 */
export function useNavBadges(): Record<string, number> {
  const pending = useServicePendingCount();
  return pending > 0 ? { "/service/sessions": pending } : {};
}
