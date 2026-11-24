import type { InvitationInviter, InvitationInviterDetail, SupportInvitationInviterDetail } from "@/lib/admin/invitation-read-contract";
import type { SupportCustomerStatistics } from "@/lib/admin/support-analytics-client";
import { COUNTS_FAILED_REASON, INVITER_SCOPE_NOTE, INVITER_UNKNOWN_NOTE, type CountsView, type InviterView } from "./invitation-view";

export const INVITATION_REREAD_BLOCK = "资料正在重读，读完再操作";

const inviterUnknownReasons = {
  DANGLING_SPONSOR: "记录里的邀请人账户已不存在，无法确认是谁邀请的。",
  ENVIRONMENT_CONFLICT: "邀请人和这位用户一个是测试账户、一个是正式账户，所以无法确认；要核对请联系值班人员。",
  UNKNOWN_ENVIRONMENT: "这位用户或邀请人是测试账户还是正式账户无法判断，暂时无法确认；要核对请联系值班人员。",
  SOURCE_READ_FAILED: "这次没读出邀请人，稍后刷新再看。",
} satisfies Record<Exclude<InvitationInviter["reason"], "UNKNOWN" | null>, string>;

export function inviterView(inviter: InvitationInviter | undefined, link?: { href?: string; scopeNote?: string }): InviterView | undefined {
  if (!inviter) return undefined;
  if (inviter.state === "NONE") return { kind: "none" };
  if (inviter.state === "DELETED" && inviter.userNo) return { kind: "deleted", userNo: inviter.userNo };
  if (inviter.state === "PRESENT" && inviter.userNo) return { kind: "present", userNo: inviter.userNo, nickname: inviter.nickname, ...link };
  const reason = inviter.state === "UNKNOWN" ? inviter.reason : null;
  return { kind: "unknown", note: reason && reason !== "UNKNOWN" ? inviterUnknownReasons[reason] : INVITER_UNKNOWN_NOTE };
}

export function inviterDetailView(
  inviter: InvitationInviterDetail | SupportInvitationInviterDetail | undefined,
  supportScope: boolean,
  reach: (href: string, read?: string) => boolean,
): InviterView | undefined {
  if (inviter?.state !== "PRESENT") return inviterView(inviter);
  if (!inviter.navigable) {
    return inviterView(inviter, supportScope ? { scopeNote: INVITER_SCOPE_NOTE } : undefined);
  }
  const target = supportScope ? "customerId" in inviter && inviter.customerId : inviter.userNo;
  if (!target) return inviterView(inviter);
  const base = supportScope ? "/service/customers" : "/users/search";
  const href = `${base}/${encodeURIComponent(target)}`;
  return inviterView(inviter, reach(href, supportScope ? undefined : "user_c1hub_read") ? { href } : undefined);
}

export type CountsRetry = { onRetry: () => void; retrying: boolean; rereading?: boolean };

function whole(value: unknown) {
  const number = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function countsView(
  status: string,
  reasons: readonly string[],
  values: readonly unknown[],
  retry?: CountsRetry,
): CountsView {
  const failed: CountsView = { kind: "failed", reason: COUNTS_FAILED_REASON, ...retry };
  if (status === "FAILED") return failed;
  if (status === "PARTIAL" && reasons.includes("SOURCE_READ_FAILED")) return { kind: "partial", ...retry };
  if (status === "UNKNOWN" && reasons.length === 1 && reasons[0] === "GENERATION_UPGRADING") return { kind: "absent" };
  if (status !== "AVAILABLE") return { kind: "anomaly" };

  const [direct, within, beyond, total] = values.map(whole);
  if (direct == null || within == null || beyond == null || total == null || direct > within || within + beyond !== total) return failed;
  return { kind: "ready", direct, within, beyond, total };
}

type ReferralCounts = {
  countStatus?: string;
  countReasons?: readonly string[];
  directCount?: unknown;
  withinRewardRange?: unknown;
  beyondRewardRange?: unknown;
  teamSize?: unknown;
};

/** 推荐团队人数的状态独立于区块的读取状态。 */
export function referralCountsView(section: ReferralCounts | null | undefined, retry: CountsRetry): CountsView {
  if (!section?.countStatus || section.withinRewardRange === undefined) return { kind: "absent" };
  return countsView(section.countStatus, section.countReasons ?? [], [
    section.directCount, section.withinRewardRange, section.beyondRewardRange, section.teamSize,
  ], retry);
}

/** 四个人数来自同一采样代。金额保留自己的状态。 */
export function supportCountsView(invitations: SupportCustomerStatistics["invitations"] | undefined, retry?: CountsRetry): CountsView {
  if (!invitations) return { kind: "absent" };
  const { direct, withinRewardRange: within, beyondRewardRange: beyond, descendants, reasons } = invitations;
  if (!within && !beyond) return { kind: "absent" };
  if (!within || !beyond || [within, beyond, descendants].some(count => count.status !== direct.status)) {
    return { kind: "failed", reason: COUNTS_FAILED_REASON, ...retry };
  }
  const counts = [direct, within, beyond, descendants];
  return countsView(direct.status, reasons ?? [], counts.map(count => count.confirmed), retry);
}

export function supportLevels(identity: Record<string, unknown> | null | undefined): { userLevel?: string; vRank?: string } {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  return { userLevel: text(identity?.userLevel), vRank: text(identity?.vRank) };
}
