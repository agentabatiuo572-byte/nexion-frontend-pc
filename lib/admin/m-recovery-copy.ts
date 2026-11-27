/**
 * M 域结果未知后的说法：M4 常见问答、M1 正式转绑、M5 服务规则和欢迎语共用。
 * 行、原操作的框、查询后的提示都取这里。
 */
import { RETRY_EXPIRED_TEXT, type PendingRecoveryState } from "./pending-mutation-store";
import { recoveryNext } from "./recovery-next";
import { replayRejectedFact, RETRY_REJECTED_LABEL, RETRY_REJECTED_NEXT } from "./retry-rejected";

export const M_RECOVERY = {
  unknown: "可能已经生效，先查询原操作。",
  querying: "正在查询原操作…",
  replaying: "正在按原操作重试…",
  notFound: "没有查到原操作，24 小时内可以按原操作重试，不会重复执行。",
  notFoundBlocked: "没有查到原操作，这个账号现在不能重试，请到操作记录与审批核对。",
  notFoundShort: "没有查到原操作。",
  unsettled: "后台还没有结论，稍后再查询原操作。",
  queryFailed: "没有查成，原记录还在，可以再查一次。",
  rejected: RETRY_REJECTED_NEXT,
} as const;

/** 面板问号里的通用说明；各页再补一句自己锁住了什么。 */
export const M_RECOVERY_INTRO = "提交时没收到确定结果，可能已经生效。先「查询原操作」：查不到、没过 24 小时，才能「按原操作重试」，不会重复执行。重试被后台拒绝的，核实后解除。";

export const M_RELEASED_TEXT = "已解除这条记录，可以重新提交。";

const ended = (text: string) => !text || /[。！？…]$/.test(text) ? text : `${text}。`;

/** 查询失败：原因跟在固定的那句后面。 */
export const mQueryFailedText = (reason: string) => `${M_RECOVERY.queryFailed}${ended(reason)}`;
/** 提交或重试没有结果时的原因：已经说了「可能已经生效」的不再说一遍。 */
export const mUnknownReason = (reason: string) => /可能已经生效|结果未知/.test(reason) ? "" : ended(reason);
export const mUnknownText = (reason: string) => mUnknownReason(reason) && `${M_RECOVERY.unknown}${mUnknownReason(reason)}`;
/** 重试被拒绝的原因，写在下一步前面（标签已经写了「重试被拒绝」）。 */
const mRejectedReason = (code: string) => `拒绝原因：${ended(replayRejectedFact(code))}`;

export type MRecoveryView = { tone: "warn" | "progress" | "danger" | "neutral" | "done" | "ok"; label: string; line: string };
export const M_SUBMITTING_VIEW = { tone: "progress", label: "提交中…", line: "提交中…" } satisfies MRecoveryView;

export function mReplayReason(state: PendingRecoveryState, unavailable: string) {
  const next = recoveryNext(state);
  return next.kind === "unavailable" ? unavailable : next.block;
}

/** last：最近一次查询或重试得到的那句；expiredLine：过期后有自己出口的（M5 两条）换成自己的话。 */
export function mRecoveryView(state: PendingRecoveryState, { last = "", expiredLine = RETRY_EXPIRED_TEXT }: { last?: string; expiredLine?: string } = {}): MRecoveryView {
  if (state.busy) return { tone: "progress", label: state.busy === "query" ? "查询中" : "提交中", line: state.busy === "query" ? M_RECOVERY.querying : M_RECOVERY.replaying };
  const next = recoveryNext(state);
  if (next.kind === "rejected") {
    const fact = state.replayRejection ? mRejectedReason(state.replayRejection) : "";
    const step = state.expired && expiredLine !== RETRY_EXPIRED_TEXT ? expiredLine : M_RECOVERY.rejected;
    return { tone: "warn", label: RETRY_REJECTED_LABEL, line: `${fact}${last}${step}` };
  }
  if (last.startsWith(M_RECOVERY.queryFailed)) return { tone: "danger", label: "查询失败", line: next.kind === "expired" ? `${last}${expiredLine}` : last };
  if (next.kind === "expired") return { tone: "warn", label: "已过期", line: `${last}${expiredLine}` };
  if (next.kind === "missing") return { tone: "neutral", label: "不能查询", line: `${next.block}请到操作记录与审批核对。` };
  if (state.conclusion === "not-found") return { tone: "warn", label: "没有查到", line: next.canRetry ? M_RECOVERY.notFound : M_RECOVERY.notFoundBlocked };
  return { tone: "warn", label: "结果未知", line: last || M_RECOVERY.unknown };
}

/** 框里的提示条：查询失败也是要人处理，不是失败，用橙黄（VS-107）。 */
export const mNoticeTone = (view: Pick<MRecoveryView, "tone">) => view.tone === "danger" ? "warn" as const : view.tone;
