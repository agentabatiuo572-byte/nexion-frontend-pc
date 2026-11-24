/**
 * P2-b 接线（占位）。P2-a 只把读到的字段直接对上显示状态，让 8131 上的真实数据能显示出来；
 * P2-b 按 PRD 补齐下面几条后替换这个文件，页面上的显示件（invitation-view.tsx）不用改：
 * - 邀请人能不能点：后端 navigable，且目标页对当前账号可达（PRD §4.5 第 3 条，CP-30、ST-58）。现在只看 navigable，页面据此传 href。
 * - 范围外（方案 A，§4.6）：客服读取里有邀请人但 navigable=false 时，问号写 INVITER_SCOPE_NOTE。现在客服各处按 navigable=false 传 scopeNote。
 * - 人数状态（§6.3）：FAILED 走读取失败；PARTIAL 且含 SOURCE_READ_FAILED 是没读全；UNKNOWN 且只有 GENERATION_UPGRADING 只写「—」；其余是数据异常。
 *   现在只认 AVAILABLE，其余一律写「—」、不提示（kind "absent"）。界面已备好 anomaly、partial、failed、loading 四种样子。
 * - 旧后端（§5 版本交叉）：没有 inviter 时不显示邀请人，没有 countStatus 时人数写「—」。现在 inviter 缺失返回 undefined，各页按 undefined 不画。
 */
import type { InvitationInviter } from "@/lib/admin/invitation-read-contract";
import type { SupportCustomerStatistics } from "@/lib/admin/support-analytics-client";
import { parseSupportProfile, type SupportProfile } from "@/lib/admin/m-support-enhancements";
import type { CountsView, InviterView } from "./invitation-view";

export function inviterView(inviter: InvitationInviter | undefined, link?: { href?: string; scopeNote?: string }): InviterView | undefined {
  if (!inviter) return undefined;
  if (inviter.state === "NONE") return { kind: "none" };
  if (inviter.state === "DELETED" && inviter.userNo) return { kind: "deleted", userNo: inviter.userNo };
  if (inviter.state === "PRESENT" && inviter.userNo) return { kind: "present", userNo: inviter.userNo, nickname: inviter.nickname, ...link };
  return { kind: "unknown" };
}

const whole = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value >= 0 ? value
  : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : null;

function ready(status: unknown, direct: unknown, within: unknown, beyond: unknown, total: unknown): CountsView {
  const values = [direct, within, beyond, total].map(whole);
  if (status !== "AVAILABLE" || values.some((value) => value === null)) return { kind: "absent" };
  const [d, w, b, t] = values as number[];
  return { kind: "ready", direct: d, within: w, beyond: b, total: t };
}

/** 后台详情：推荐团队区块的人数（referral 段，旧键 directCount、teamSize 已是新口径）。 */
export function referralCountsView(section: { countStatus?: unknown; directCount?: unknown; withinRewardRange?: unknown; beyondRewardRange?: unknown; teamSize?: unknown } | null | undefined): CountsView {
  return section ? ready(section.countStatus, section.directCount, section.withinRewardRange, section.beyondRewardRange, section.teamSize) : { kind: "absent" };
}

/** 客服：统计组里的邀请人数（四项各带 status，同一次遍历，状态相同）。 */
export function supportCountsView(invitations: SupportCustomerStatistics["invitations"] | undefined): CountsView {
  if (!invitations?.withinRewardRange || !invitations.beyondRewardRange) return { kind: "absent" };
  const { direct, withinRewardRange: within, beyondRewardRange: beyond, descendants } = invitations;
  const status = [direct, within, beyond, descendants].every((count) => count.status === "AVAILABLE") ? "AVAILABLE" : "OTHER";
  return ready(status, direct.confirmed, within.confirmed, beyond.confirmed, descendants.confirmed);
}

/**
 * 客服个人工作台的客户资料抽屉：客户资料接口带回的 profile 现在只透传（PR0），这里借客户资料（M3 同一个接口）的解析取身份组和统计组。
 * P2-b 把解析挪到读取处（m-support-client 的 detail()）后删掉这个函数。
 */
export function drawerSupportProfile(profile: Record<string, unknown> | undefined): SupportProfile | undefined {
  return profile ? parseSupportProfile({ profile }) : undefined;
}

/**
 * 客服资料的等级：只写后端确证的那一项，缺哪个不写哪个，不把旧的 level 写成团队等级（PRD §6.6-5）。
 * 现在直接读身份组里的 vRank、userLevel 原值；P2-b 按 §6.6-5 接正式字段（含旧后端两项都没有的情况）。
 */
export function supportLevels(identity: Record<string, unknown> | null | undefined): { userLevel?: string; vRank?: string } {
  const text = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : undefined;
  return { userLevel: text(identity?.userLevel), vRank: text(identity?.vRank) };
}
