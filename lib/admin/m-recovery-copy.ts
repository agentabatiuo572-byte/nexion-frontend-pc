/**
 * M 域结果未知后的说法：M4 常见问答、M1 正式转绑、M5 服务规则和欢迎语共用。
 * 行、原操作的框、查询后的提示都取这里，同一个状态只有一句话。能不能重试、能不能解除只看 PendingRecoveryState，这里不判断。
 */
import { RETRY_EXPIRED_TEXT, type PendingRecoveryState } from "./pending-mutation-store";

export const M_RECOVERY = {
  unknown: "可能已经生效，先查询原结果。",
  querying: "正在查询原结果…",
  replaying: "正在按原请求重试…",
  notFound: "没有查到原操作，24 小时内可以按原请求重试，不会重复执行。",
  notFoundBlocked: "没有查到原操作，这个账号现在不能重试，请到操作记录与审批核对。",
  notFoundShort: "没有查到原操作。",
  unsettled: "后台还没有结论，稍后再查询原结果。",
  queryFailed: "没有查成，原记录还在，可以再查一次。",
  rejected: "后台已拒绝重试，先核实原操作的结果，再解除这条记录。",
} as const;

/** 面板问号里的通用说明；各页再补一句自己锁住了什么。 */
export const M_RECOVERY_INTRO = "提交时没收到确定结果，可能已经生效。先「查询原结果」：查不到、没过 24 小时，才能「按原请求重试」，不会重复执行。重试被后台拒绝的，核实后解除。";

export const M_RELEASED_TEXT = "已解除这条记录，可以重新提交。";

const ended = (text: string) => !text || /[。！？…]$/.test(text) ? text : `${text}。`;

/** 查询失败：原因跟在固定的那句后面。 */
export const mQueryFailedText = (reason: string) => `${M_RECOVERY.queryFailed}${ended(reason)}`;
/** 提交或重试没有结果时的原因：已经说了「可能已经生效」的不再说一遍。 */
export const mUnknownReason = (reason: string) => /可能已经生效|结果未知/.test(reason) ? "" : ended(reason);
export const mUnknownText = (reason: string) => mUnknownReason(reason) && `${M_RECOVERY.unknown}${mUnknownReason(reason)}`;
/** 重试被拒的原因，跟在「后台已拒绝重试」后面。 */
export const mRejectedReason = (reason: string) => `拒绝原因：${ended(reason)}`;

export type MRecoveryView = { tone: "warn" | "progress" | "danger" | "neutral" | "done" | "ok"; label: string; line: string };
export const M_SUBMITTING_VIEW = { tone: "progress", label: "提交中…", line: "提交中…" } satisfies MRecoveryView;

/** last：最近一次查询或重试得到的那句；expiredLine：过期后有自己出口的（M5 两条）换成自己的话。 */
export function mRecoveryView(state: PendingRecoveryState, { last = "", expiredLine = RETRY_EXPIRED_TEXT }: { last?: string; expiredLine?: string } = {}): MRecoveryView {
  if (state.busy) return { tone: "progress", label: state.busy === "query" ? "查询中" : "提交中", line: state.busy === "query" ? M_RECOVERY.querying : M_RECOVERY.replaying };
  if (state.replayRejection) return { tone: "warn", label: "重试被拒", line: `${state.expired ? expiredLine : ""}${M_RECOVERY.rejected}${last}` };
  if (last.startsWith(M_RECOVERY.queryFailed)) return { tone: "danger", label: "查询失败", line: state.expired ? `${last}${expiredLine}` : last };
  if (state.expired) return { tone: "warn", label: "已过期", line: `${last}${expiredLine}` };
  if (state.conclusion === "not-found") return { tone: "warn", label: "没有查到", line: state.replayBlock ? M_RECOVERY.notFoundBlocked : M_RECOVERY.notFound };
  return { tone: "warn", label: "结果未知", line: last || M_RECOVERY.unknown };
}

/** 框里的提示条：查询失败也是要人处理，不是失败，用橙黄（VS-107）。 */
export const mNoticeTone = (view: Pick<MRecoveryView, "tone">) => view.tone === "danger" ? "warn" as const : view.tone;
