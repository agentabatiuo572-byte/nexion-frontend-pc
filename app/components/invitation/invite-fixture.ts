/**
 * 开发开关夹具：只给 P2-a 截图造后端在 8131 上造不出的状态（已删除、无法确认、范围外、人数异常、没读全、只有人数失败、加载中、统计组非 READY）。
 * P2-b 接线时把这个文件和各页标「P2-b 删：夹具」的几行一起删掉。
 *
 * 只有构建时设了 NEXT_PUBLIC_INVITE_PR2_FIXTURE=1 才生效：正常构建里 ENABLED 恒为 false，inviteFixture() 恒返回 null。
 * 生效时在浏览器 localStorage 写「nexion-dev-invite-pr2-fixture」选状态，例如
 *   {"inviter":"deleted","counts":"partial"}、{"inviter":"outOfScope"}、{"statistics":"ERROR"}
 */
import type { CountsView, InviterView } from "./invitation-view";
import { COUNTS_FAILED_REASON, INVITER_SCOPE_NOTE } from "./invitation-view";

const ENABLED = process.env.NEXT_PUBLIC_INVITE_PR2_FIXTURE === "1";
const STORAGE_KEY = "nexion-dev-invite-pr2-fixture";

export type InviteFixture = {
  inviter?: "none" | "deleted" | "unknown" | "outOfScope" | "longName";
  counts?: "anomaly" | "partial" | "failed" | "loading" | "absent";
  /** 客服资料的统计组状态（BUG-631）。LOADING 是组还没读到。 */
  statistics?: "ERROR" | "FORBIDDEN" | "UNKNOWN" | "LOADING";
};

export function inviteFixture(): InviteFixture | null {
  if (!ENABLED || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as InviteFixture : null;
  } catch {
    return null;
  }
}

/**
 * 只改真有邀请人的那一行（8131 上是 U00000016，邀请人 U00000015），其余行照真实数据，列表里不会整列变成同一种夹具。
 * 已删除的邀请人用 U00000013：8131 上这个编号查不到用户，和「已删除」对得上。
 */
export function fixtureInviter(view: InviterView | undefined, fixture: InviteFixture | null): InviterView | undefined {
  const kind = fixture?.inviter;
  if (!kind || view?.kind !== "present") return view;
  if (kind === "none") return { kind: "none" };
  if (kind === "deleted") return { kind: "deleted", userNo: "U00000013" };
  if (kind === "unknown") return { kind: "unknown" };
  if (kind === "longName") return { ...view, nickname: "星河万里一路向前的阿杰Official旗舰团队" };
  return { kind: "present", userNo: view.userNo, nickname: view.nickname, scopeNote: INVITER_SCOPE_NOTE };
}

/** 客服资料的统计组（BUG-631）：LOADING 当作组还没读到，其余换成对应状态、清掉数据（和后端非 READY 时一样）。 */
export function fixtureStatisticsGroup<T extends { status: string; data: unknown }>(group: T | undefined, fixture: InviteFixture | null): T | undefined {
  const status = fixture?.statistics;
  if (!status || !group) return group;
  return status === "LOADING" ? undefined : { ...group, status, data: null };
}

export function fixtureCounts(view: CountsView, fixture: InviteFixture | null, retry?: { onRetry: () => void; retrying?: boolean }): CountsView {
  const kind = fixture?.counts;
  if (!kind) return view;
  if (kind === "partial") return { kind, ...retry };
  if (kind === "failed") return { kind, reason: COUNTS_FAILED_REASON, ...retry };
  return { kind };
}
