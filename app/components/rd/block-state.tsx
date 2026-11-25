/**
 * BlockState 区块状态（CP-72）、Notice 页内提示（CP-70、CP-71）。
 *
 * <BlockState state="loading" title="正在读取到期预测…" />
 * <BlockState state="error" title="资金流历史暂不可用" detail={error} onRetry={reload} />
 * <BlockState state="empty" title="未来 7 天没有到期" />
 * <BlockState state="denied" title="无权限访问" detail="这个账号没有这块内容的读取权限。" />
 *
 * 失败和空不共用文字（T09）。重试只重读这一块。失败带 data-module-health-state="error"。compact 时一行写完，用在折叠摘要里，重试是文字链，和 InlineRetry 同一个样子。
 * 重读期间「重试」写「重试中…」、aria-busy，用 aria-disabled 不用原生 disabled，焦点不掉到页面上（CP-05、CP-28）。
 * 按过「重试」之后：这一块换成加载中时焦点交给这一块；仍失败焦点回到「重试」；读到了（这一块卸下）焦点交给 afterRetryFocus 指的标题。
 * 没传标题、或这一块重读时被换成别的占位时，焦点交给还挂着的最近一层外框（tabIndex=-1），不掉到页面上；这一层接不到焦点（display: contents、隐藏）就再往外一层。
 * 有的页面点「重试」只改一个计数，下一轮由父层的 effect 才开始读：交接要等真看到重读开始、结束后才算完，不在点完的第一轮就清掉（BUG-710）。
 *
 * <Notice tone="progress" title="待生效 v3" action={<Button size="sm">刷新</Button>}>明天 08:00 起生效。</Notice>
 * tone 是状态色，图标由 tone 决定。待处理、结果未知这类不能收起的内容放这里（DP-03）。
 */
"use client";

import { forwardRef, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { AlertTriangle, CheckCircle2, Clock3, Info, Loader2, ShieldAlert, type LucideIcon } from "lucide-react";
import { Button } from "./button";
import type { StateTone } from "./tone";

/** 焦点没有落在任何控件上：掉到了页面上，或原来的元素已经卸下。 */
const focusLost = () => { const active = document.activeElement; return !active || active === document.body || !active.isConnected; };
/** 把焦点交给这一层；接不到（display: contents、隐藏、已卸下）时撤掉临时加的 tabIndex，返回 false，由调用方再往外找。 */
function focusFrame(frame: HTMLElement) {
  if (!frame.isConnected || frame.getClientRects().length === 0) return false;
  const added = !frame.hasAttribute("tabindex");
  if (added) { frame.tabIndex = -1; frame.setAttribute("data-retry-landing", ""); }
  frame.focus({ preventScroll: true });
  if (document.activeElement === frame) return true;
  if (added) { frame.removeAttribute("tabindex"); frame.removeAttribute("data-retry-landing"); }
  return false;
}
/**
 * 按过「重试」、还没有结果的那一次。有的页面重读时把这一块换成加载占位（卸下），仍失败时再挂一块新的：
 * 新挂上的失败块在原来那一块所在的区域里（region：卸下时还挂着的最近一层外框）就算同一块；失败原因变了、标题跟着变也认（很多页面拿错误原因当标题）。
 * 同一个面板里有两项各自读取的失败块时，两块都传 retryKey，标识不同就不会接走对方的交接（BUG-710 F02，A8 对照表）。新的这一块有「重试」才接；焦点掉在页面上、或还停在交接的那一层时把它交回「重试」。30 秒内有效，用一次就清掉。
 */
let pendingRetry: { key?: string; at: number; region?: HTMLElement; landing?: HTMLElement } | null = null;
const RETRY_FOCUS_MS = 30_000;

export function BlockState({ state, title, detail, onRetry, retrying, retryLabel = "重试", compact, afterRetryFocus, retryKey }: {
  state: "loading" | "error" | "empty" | "denied";
  title: ReactNode;
  detail?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  retryLabel?: string;
  /** 一行写完：折叠摘要里的读取失败用这个，不占一整块。 */
  compact?: boolean;
  /** 按「重试」读到之后焦点去哪：这一块的标题。不传时交给还挂着的最近一层外框。 */
  afterRetryFocus?: RefObject<HTMLElement | null>;
  /** 这一块的固定标识：同一个区域里有别的读取也会挂失败块时传，免得接走对方的交接。不传时只按区域认。 */
  retryKey?: string;
}) {
  const failed = state === "error";
  const busy = state === "loading" || !!retrying;
  const box = useRef<HTMLDivElement>(null);
  const retryButton = useRef<HTMLButtonElement>(null);
  /** 按过「重试」、这次重读还没有结果：at 是按下的时间，started 是已经看到重读开始（这一块变成忙），target 是按下时给的标题（重读中换成不带标题的加载占位时还用它）。 */
  const armed = useRef<{ at: number; started: boolean; target?: RefObject<HTMLElement | null> } | null>(null);
  const focusAfter = useRef(afterRetryFocus);
  focusAfter.current = afterRetryFocus;
  /** 按「重试」那一刻这一块的外框，由近到远；这一块卸下后从里面找还挂着的一层接焦点。 */
  const frames = useRef<HTMLElement[]>([]);
  const key = retryKey;
  const retry = onRetry && (() => {
    armed.current = { at: Date.now(), started: false, target: afterRetryFocus };
    pendingRetry = { key, at: Date.now() };
    frames.current = [];
    for (let frame = box.current?.parentElement; frame && frame !== document.body; frame = frame.parentElement) frames.current.push(frame);
    onRetry();
  });
  useEffect(() => {
    const run = armed.current;
    if (!run) return;
    if (Date.now() - run.at > RETRY_FOCUS_MS) { armed.current = null; return; }
    const inside = box.current?.contains(document.activeElement) ?? false;
    if (busy || !run.started) {
      // 「重试」换成了加载中，或重读还没开始（父层下一轮才开始读）：焦点交给这一块，不掉到页面上；交接留到重读结束。
      if (busy) run.started = true;
      if (!inside && focusLost()) box.current?.focus({ preventScroll: true });
      return;
    }
    armed.current = null;
    pendingRetry = null;
    if (failed && (inside || focusLost())) retryButton.current?.focus({ preventScroll: true });
  });
  useEffect(() => {
    // 重读时这一块被换掉、仍失败时在同一区域重新挂上：新的这一块接住焦点。
    const pending = pendingRetry;
    if (!failed || !retryButton.current || !pending || Date.now() - pending.at > RETRY_FOCUS_MS || pending.key !== key || !pending.region?.contains(box.current)) return;
    pendingRetry = null;
    if (focusLost() || document.activeElement === pending.landing) retryButton.current?.focus({ preventScroll: true });
  // 只在挂上时看一次。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    const run = armed.current;
    if (!run || Date.now() - run.at > RETRY_FOCUS_MS) return;
    // 这一块卸下（读到了，或重读时换成了别的占位）：焦点交给调用方给的标题；没给、或标题接不到，就交给还挂着的最近一层外框，接不到再往外一层。
    const target = focusAfter.current ?? run.target;
    const outer = frames.current;
    // 卸下时就记区域（这时节点已经摘掉）：同一轮里在这里挂上的新失败块马上就能认出来。
    if (pendingRetry) pendingRetry.region = outer.find((frame) => frame.isConnected);
    // 这一轮的副作用跑完就交接（新内容已经挂上），不等下一帧：浏览器忙或窗口被遮住时一帧要等几百毫秒，这段时间焦点停在页面上。
    queueMicrotask(() => {
      if (!focusLost()) return;
      const heading = target?.current;
      const landing = [heading, ...outer].find((frame): frame is HTMLElement => !!frame && focusFrame(frame));
      if (landing && pendingRetry) pendingRetry.landing = landing;
    });
  }, []);
  return (
    <div ref={box} tabIndex={-1} className="rd-block-state" data-state={state} data-compact={compact ? "" : undefined} data-module-health-state={failed ? "error" : undefined} role={failed ? "alert" : "status"} aria-busy={busy || undefined}>
      {state === "loading" && <Loader2 className="rd-spin" size={16} aria-hidden />}
      <div className="rd-block-state-title">{title}</div>
      {detail && <div className="rd-block-state-detail">{detail}</div>}
      {retry && (compact ? <InlineRetry ref={retryButton} onRetry={retry} retrying={retrying} label={retryLabel} /> : <Button ref={retryButton} size="sm" loading={retrying} loadingText="重试中…" onClick={retry}>{retryLabel}</Button>)}
    </div>
  );
}

/**
 * 一个数字或一行读不到时用这个，其他内容不受影响。
 * retrying：这次重读正在进行，写「重试中…」、aria-busy。blocked：别的原因暂时不能点（比如写操作进行中），文字不变。
 * 两种都用 aria-disabled，不用原生 disabled：原生 disabled 一按下焦点就掉到页面上（Chrome）。
 */
export const InlineRetry = forwardRef<HTMLButtonElement, { onRetry: () => void; retrying?: boolean; blocked?: boolean; label?: string }>(function InlineRetry({ onRetry, retrying, blocked, label = "重试" }, ref) {
  const inactive = retrying || blocked;
  return <button ref={ref} type="button" className="rd-inline-retry" aria-disabled={inactive || undefined} aria-busy={retrying || undefined} onClick={inactive ? undefined : onRetry}>{retrying ? "重试中…" : label}</button>;
});

const NOTICE_ICON: Record<StateTone, LucideIcon> = { ok: CheckCircle2, warn: AlertTriangle, danger: ShieldAlert, progress: Clock3, done: Info, neutral: Info };

/** actionBelow：正文超过一行、动作不止一个时，动作排到正文下面，和正文左边对齐，正文占满整条宽（DT-09）。多段正文用 <p>。 */
export function Notice({ tone, title, action, actionBelow, children }: { tone: StateTone; title?: ReactNode; action?: ReactNode; actionBelow?: boolean; children?: ReactNode }) {
  const Icon = NOTICE_ICON[tone];
  return (
    <div className="rd-notice" data-tone={tone} role={tone === "danger" ? "alert" : "status"}>
      <Icon className="rd-notice-icon" size={16} strokeWidth={1.9} aria-hidden />
      <div className="rd-notice-text">
        {title && <div className="rd-notice-title">{title}</div>}
        {children}
        {action && actionBelow && <div className="rd-notice-action" data-below="">{action}</div>}
      </div>
      {action && !actionBelow && <div className="rd-notice-action">{action}</div>}
    </div>
  );
}
