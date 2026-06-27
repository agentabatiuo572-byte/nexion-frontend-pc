"use client";

/**
 * 侧栏导航徽标 — 客服中心「待处理」实时计数(供左侧风琴导航 M3 入口显数量)。
 * 待处理 = 未读 或 转入待处理 且未归档,与 M3 收件箱 SEGS「未读/转入待处理」同口径。
 * 只读取 M 页从后端接口加载后的会话快照;未加载时保持 0,不再用静态会话种子兜底。
 */
import { useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { usePlatformConfig } from "@/lib/store/admin/platform-config-store";
import type { SessionConvo } from "../domain-views/m-tabs/data";

const CONVO_KEY = "I.session.convos";

function parseConvos(raw: string | undefined): SessionConvo[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionConvo[]) : [];
  } catch {
    return [];
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
