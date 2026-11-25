"use client";

/**
 * Drawer 抽屉、Modal 弹窗（CP-66、CP-67）。Radix Dialog：Esc 只关最上层，打开时聚焦容器，关闭后焦点回到当前高亮行或打开前的按钮。
 * 弹窗是模态，Tab 圈在里面。抽屉不挡外面的列表，所以不是模态：不声明 aria-modal，Tab 走到头继续回到列表，和鼠标能做的事一致。
 *
 * 单条详情（PG-63）：默认关着，列表占满宽度。点一行抽屉从右侧滑出，浮在列表上，不用暗遮罩，
 * 列表不变窄、不重排，被点的行用 <Tr selected> 保持高亮，关上才取消。不要做成常开并排，
 * 并排只给工作台页（PG-45）。
 * 抽屉开着时列表还能点：点另一行直接切过去，不关抽屉；点行里的按钮也不关；点空白处或页面其他
 * 地方才关，这一下照常点到那个控件。
 *
 * <Drawer open={Boolean(current)} onClose={close} title="单笔详情" sub={current.no}
 *   icon={FileText} tone="role-1" busy={submitting}
 *   nav={{ onPrev, onNext, hasPrev, hasNext }}
 *   footer={<Decision note="确认后立即放行，钱从储备中扣除。"
 *     danger={<Button variant="danger">拒绝并退款</Button>}
 *     primary={<Button variant="primary">放行</Button>}
 *     others={<><Button variant="ghost">延迟</Button><Button variant="ghost">冻结</Button></>} />}>
 *   <JudgmentPoints rows={…} />
 *   <Fold title="费用明细" summary="手续费 62.40 USDT" inset>…</Fold>
 * </Drawer>
 *
 * - 宽 540px，顶部上一条、下一条、关闭；wide 只给长表单和整页证据，不给单条详情。
 * - busy 时 Esc、关闭、上一条下一条和抽屉外的点击全部锁住（CP-06）。
 * - nav 只在当前页已读到的行里切；有未保存内容时页面在 onPrev、onNext 和行的 onOpen 里先拦（OP-29），
 *   切条时让旧请求失效也由页面管（D2-H01）。上一条下一条切换后焦点留在抽屉，读屏读出新标题。
 * - footer 固定在底部，内容滚动时决定按钮一直可见（OP-150）。详情读取失败时页面把决定按钮禁用。
 * - 抽屉上最多再叠一层弹窗，弹窗上不再叠弹窗（PG-38）；错误写在最上层。
 *
 * Modal 用法同旧 Modal。RdPage 里的旧 Modal、OperationConfirmModal 会自动走这个组件，不用改调用。
 * 框里填过内容后点空白和 Esc 都不关，按 Esc 只在底栏左边轻提示要关请点 ×，免得手滑丢了填的内容（OP-46）；提交中照旧不响应。
 * 文字框按现在有没有字算，删空了照常关；勾选、下拉、日期、分段这类点选选过一次就一直算填过。
 * ×、取消照常关。只靠点选的表单传 dirty，搜索框不算填内容。
 *
 * 弹窗里的文字分四层（VS-100～VS-108）：
 * - 这是什么操作：title 只写动作和对象，页面分组和长单号不进标题。icon 给标题前的图标底，默认灰；
 *   不能撤销或直接动钱的最终确认传 tone="danger"。图标底不带业务色：业务归属页面已经说过，
 *   弹窗里的颜色只说这次操作的事，红留给危险确认。
 * - 后果：生效方式、能不能撤销写成状态标签，传 sub，紧跟在标题下面，不写成灰字。
 * - 关键信息：对象、金额、前后值放 Facts、DiffList、DiffField，框里最大最亮。
 * - 要填的用 Field，字段名比只读标签强；范围、字数、说明最弱，能进提示图标就进。
 *
 * <Modal title="调整同一 IP 注册上限" icon={SlidersHorizontal} sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} …>
 *
 * 框里直接放的 Facts 自动带关键信息区的底。解除待确认全站一个样子，用 ReleaseModal，页面只传原操作的名字和核对说明。
 */
import { Children, Fragment, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type KeyboardEvent, type ReactNode, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, ShieldCheck, X, type LucideIcon } from "lucide-react";
import { focusFrame, releaseOnLeave } from "./block-state";
import { Button, IconButton, TipSide } from "./button";
import { Explain } from "./explain";
import { Fact, Facts } from "./facts";
import { IconTile } from "./icon-tile";
import { KeepText } from "./keep-text";
import { EffectSlot } from "./status-tag";
import { useRdSurface } from "./surface";
import type { RoleTone, StateTone } from "./tone";
import { useDialogFeedback } from "../kit/dialog-feedback";
import { ToastHost } from "../kit/toast-host";

/** 点到的是页面上的控件（页签、按钮、链接、输入项）。 */
const onPageControl = (target: EventTarget | null) => target instanceof Element
  && target.closest('button, a[href], [role="tab"], input, select, textarea, label, summary') !== null;

/** 列表里的行和页面控件才算点到外面；提示条、浮层不在这些区域里，点它们不关抽屉。 */
function dismissesDrawer(target: EventTarget | null) {
  return target instanceof Element && target.closest("main, aside, header") !== null && target.closest("tr[data-clickable]") === null;
}

/**
 * 抽屉不是模态（CP-66、ST-56）：Tab 走到头回到页面，不在抽屉里绕圈。Radix 的焦点圈总是首尾相接，这里先接过来：
 * 往后走到打开抽屉的控件后面那一个，往前回到打开它的控件；找不到打开者时去页面的第一个或最后一个。
 */
const TABBABLE = 'a[href], button, input, select, textarea, summary, [tabindex]';
const tabbable = (root: ParentNode) => [...root.querySelectorAll<HTMLElement>(TABBABLE)].filter((node) => node.tabIndex >= 0 && !node.matches(":disabled") && node.getClientRects().length > 0);
function tabOutOfDrawer(event: KeyboardEvent<HTMLDivElement>, opener: HTMLElement | null) {
  if (event.defaultPrevented || event.key !== "Tab" || event.altKey || event.ctrlKey || event.metaKey) return;
  const inside = tabbable(event.currentTarget);
  if (inside.length && document.activeElement !== (event.shiftKey ? inside[0] : inside.at(-1))) return;
  // Radix 的焦点守卫（看不见的 span）不算页面控件；被抽屉整个盖住的控件也跳过，免得焦点落到看不见的地方（CP-05）。
  const edge = event.currentTarget.getBoundingClientRect().left;
  const page = tabbable(document).filter((node) => !node.closest(".rd-drawer, .rd-modal") && !node.hasAttribute("data-radix-focus-guard") && node.getBoundingClientRect().left < edge);
  const from = opener?.isConnected ? opener : null;
  const after = from ? page.filter((node) => from.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) : [];
  // 折叠里的表格这类元素量得到尺寸却接不了焦点：依次试，落下了才算。
  for (const node of event.shiftKey ? [from, ...page.slice().reverse()] : [...after, ...page]) {
    node?.focus();
    if (node && document.activeElement === node) { event.preventDefault(); return; }
  }
}

/** 每个开过的弹窗、抽屉关掉后焦点该回哪。从另一个框里打开的框，原按钮跟着那个框一起没了时（离开框里点「…后继续」打开的保存确认），接着问那个框（BUG-710）。 */
const handoffs = new WeakMap<Element, () => HTMLElement | null>();
/** 不是原生控件的点选（rd 下拉的选项、分段、开关、搜索选择的候选）：它们不发 input 事件，按点中、回车选中来认。 */
const PICK_ROLES = '[role="option"], [role="radio"], [role="switch"], [role="menuitemradio"]';
/** 能打字的输入框类型；其余（勾选、单选、日期、文件等）算点选。 */
const TEXT_INPUT = /^(text|search|email|tel|url|password|number)$/;
/** 打开者那一行已经不在时接焦点的稳定外框：表格外框、面板、页签面板，以及有名字的区块（卡片墙这类 section）。 */
const STABLE_FRAME = '.rd-table-scroll, .rd-panel, [role=tabpanel], section[aria-label], [role="region"][aria-label]';
/** 最上层还开着的弹窗或抽屉，不含正在关的这个。 */
const openOverlay = (except: Element | null) => [...document.querySelectorAll<HTMLElement>('.rd-modal[data-state="open"], .rd-drawer[data-state="open"]')].filter((node) => node !== except).at(-1) ?? null;

/** 打开时聚焦容器，关闭后回到打开前的元素。Dialog 没有 Trigger 时要自己记。 */
function useFocusHandoff(open: boolean, returnFocus?: () => HTMLElement | null) {
  const previous = useRef<HTMLElement | null>(null);
  /** 打开者所在的行、面板或页签：原按钮被重画时只在这里面找同名的。 */
  const area = useRef<Element | null>(null);
  /** 打开者往外的各层：按钮换了节点（带上、去掉不可用原因时外面多一层提示）后，先在还挂着的最近一层里找同名的。 */
  const chain = useRef<HTMLElement[]>([]);
  /** 打开者所在的另一个框，和那个框自己关掉后焦点的去处。 */
  const host = useRef<HTMLElement | null>(null);
  const hostHandoff = useRef<(() => HTMLElement | null) | null>(null);
  const wasOpen = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  if (open && !wasOpen.current) {
    // 焦点在页面上（body）不算打开者，关掉时按下面的顺序另找。
    const active = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    previous.current = active;
    area.current = active?.closest("tr, section, [role=tabpanel]") ?? null;
    chain.current = [];
    for (let node = active?.parentElement; node && node !== document.body; node = node.parentElement) chain.current.push(node);
    host.current = active?.closest<HTMLElement>(".rd-modal, .rd-drawer") ?? null;
    hostHandoff.current = host.current ? handoffs.get(host.current) ?? null : null;
  }
  wasOpen.current = open;
  const target = (): HTMLElement | null => {
    const opener = returnFocus?.() ?? previous.current;
    if (opener?.isConnected) return opener;
    // 提交时按钮可能重画过（变灰、转圈后换了节点，BUG-536）：原节点不在了，就在它原来那一行、那块面板里找看得见的同名那一个。
    // 那一行、那块面板自己已经不在了（整行被删掉）就不找，免得落到别的记录的同名按钮上。
    // 先在还挂着的最近一层（同一张卡、同一行）里找：一页有好几个同名按钮（每张卡一个「配置」）时，只在大的面板里找会找到好几个（BUG-710：H4 玩法抽屉放弃后落到 body）。
    if (opener && area.current?.isConnected) for (const scope of [chain.current.find((node) => node.isConnected && area.current?.contains(node)), area.current]) {
      if (!scope?.isConnected) continue;
      const name = opener.getAttribute("aria-label") ?? opener.textContent;
      const same = [...scope.querySelectorAll<HTMLElement>(opener.tagName)].filter((element) => element.getClientRects().length > 0 && (element.getAttribute("aria-label") ?? element.textContent) === name);
      if (same.length === 1) return same[0];
    }
    // 打开者所在的框还开着（抽屉里点开的确认框）：回到那个框；那个框已经关了（离开框）：用那个框关掉时的去处。
    if (host.current?.isConnected) return host.current;
    const inherited = hostHandoff.current?.() ?? null;
    // 那个框的去处不在最上层还开着的抽屉里（离开框是点侧栏链接、切页签打开的，或去处在被盖住的下一层抽屉里）：留在最上层抽屉，不跳出去（BUG-710）。
    // 抽屉都挂在同一个容器里，后打开的排在后面，最后一个就是最上层（详情抽屉上再开编辑抽屉时是编辑抽屉）。
    const drawer = [...document.querySelectorAll<HTMLElement>('.rd-drawer[data-state="open"]')].at(-1);
    return drawer && !(inherited && drawer.contains(inherited)) ? drawer : inherited;
  };
  const latest = useRef(target);
  latest.current = target;
  /** 开着时的内容节点：卸下后 ref 已清空，用它认「真的摘掉了」。 */
  const opened = useRef<HTMLDivElement | null>(null);
  /** 关掉后焦点交给谁。Radix 卸下内容后要等下一个定时器才调 onCloseAutoFocus；内容卸下时 onGone 先调一次，两次走同一套判断，第二次焦点已有去处就什么都不做。 */
  const settle = () => {
    const self = content.current;
    // 关掉的时候焦点已经在另一个还开着的框里（旧抽屉退出动画还没完，新抽屉已经打开并接了焦点）：不动它。
    const holder = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(".rd-modal, .rd-drawer") : null;
    if (holder && holder !== self && holder.getAttribute("data-state") === "open") return;
    // 关掉的时候焦点已经在页面上别的控件里（抽屉开着时 Tab 到页面，在那里按 Esc）：留在那里，不拉回原来那一行（ST-56）。
    const elsewhere = document.activeElement;
    if (elsewhere instanceof HTMLElement && elsewhere !== document.body && elsewhere.isConnected && !holder) return;
    const top = openOverlay(self);
    // 都找不到时回到还开着的最上层框，不落到页面上。
    const next = latest.current() ?? top;
    // 这时上面还开着另一个弹窗（离开框收起、保存确认打开）：焦点留在那个弹窗里，不拉出去。
    if (top?.matches(".rd-modal") && !(next && top.contains(next))) { if (!top.contains(document.activeElement)) top.focus(); return; }
    // 原按钮还在但提交后变成了原生 disabled，接不到焦点：当作没有去处，往下找外框。
    next?.focus();
    if (next && document.activeElement === next) return;
    // 打开者那一行处理完已经移出列表（A2 撤回成功）：不找别的记录的同名按钮，交给还挂着的最近一层稳定外框；
    // 接不到焦点再往外一层，到整页外框为止，不落到整页外框和页面上（BUG-710 补记三）。焦点已经在页面别处时不动。
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected && !self?.contains(active)) return;
    for (const frame of chain.current) {
      if (frame.matches(".rd-page")) break;
      if (!frame.isConnected || !frame.matches(STABLE_FRAME) || !focusFrame(frame)) continue;
      // 这是临时落点：带 data-retry-landing，页面自己「焦点没去处才补位」的逻辑把它当成还没去处，照样放回原卡（h4-legacy-parts）。
      // 标记只在焦点停在这里时有，离开就撤：原本没有 tabindex 的外框连临时加的 tabindex 一起撤（focusFrame），原本就能 Tab 到的外框（表格滚动区）只撤标记，不影响它平时的焦点框（BUG-746）。
      if (!frame.hasAttribute("data-retry-landing")) { frame.setAttribute("data-retry-landing", ""); releaseOnLeave(frame, false); }
      return;
    }
  };
  return {
    ref: content,
    previous,
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      if (content.current) handoffs.set(content.current, () => latest.current());
      opened.current = content.current;
      content.current?.focus();
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      settle();
    },
    /**
     * 内容刚从页面上摘掉（同一个任务里，浏览器还没来得及绘制或跑别的定时器）：焦点跟着节点掉到页面上时马上交出去。
     * 不等 Radix 的定时器，中间就不会有一刻停在页面上（BUG-746 第 9 条：A2 撤回、H4 保存关框时采到过一次 body）。
     */
    onGone: () => {
      const node = opened.current;
      // 开发模式的 StrictMode 会假卸一次，节点还在页面上：不算关。
      if (!node || node.isConnected) return;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      settle();
    },
  };
}

/** 放在弹层内容里：内容卸下时，等这次提交做完（微任务，仍在同一个任务里）再交焦点，这时节点已经摘掉、页面也已更新（同 BlockState 的做法）。 */
function HandoffOnUnmount({ onGone }: { onGone: () => void }) {
  const latest = useRef(onGone);
  latest.current = onGone;
  useLayoutEffect(() => () => { queueMicrotask(() => latest.current()); }, []);
  return null;
}

export interface DrawerNav {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export function Drawer({ open, onClose, title, sub, explain, icon, tone = "role-other", nav, footer, busy = false, wide = false, keepOnControls = false, children, onKeyDown, ...rest }: Omit<ComponentProps<typeof Dialog.Content>, "title"> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** 数据型副标题：单号、编号、状态。 */
  sub?: ReactNode;
  /** 这个抽屉是什么、要注意什么：收进标题旁的提示图标（DP-06）。 */
  explain?: ReactNode;
  icon?: LucideIcon;
  tone?: RoleTone | StateTone;
  nav?: DrawerNav;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  /** 抽屉有没保存的改动、页面自己管离开时传 true：点外面的控件由控件自己先问再去，不顺手关抽屉；点空白处照旧。 */
  keepOnControls?: boolean;
}) {
  const surface = useRdSurface();
  const focus = useFocusHandoff(open);
  const closedByOutsideClick = useRef(false);
  const stillOpen = useRef(open);
  stillOpen.current = open;
  const close = () => { if (!busy) onClose(); };
  // 切过条再关时回到当前高亮行，不跳回最早点开的那行。
  useEffect(() => {
    const row = open ? (surface?.container ?? document).querySelector<HTMLElement>("tr[data-selected]") : null;
    if (row) focus.previous.current = row;
  });
  return (
    <Dialog.Root modal={false} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal container={surface?.container ?? undefined}>
        {busy && <div className="rd-scrim" aria-hidden />}
        <Dialog.Content
          {...rest}
          ref={focus.ref}
          className="rd-drawer"
          data-wide={wide ? "" : undefined}
          aria-busy={busy}
          aria-describedby={undefined}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={(event) => {
            if (closedByOutsideClick.current) event.preventDefault();
            else focus.onCloseAutoFocus(event);
            closedByOutsideClick.current = false;
          }}
          onPointerDownOutside={(event) => {
            const target = event.detail.originalEvent.target;
            if (busy || !dismissesDrawer(target) || keepOnControls && onPageControl(target)) event.preventDefault();
            else {
              closedByOutsideClick.current = true;
              // 页面没关（有没保存的改动，先弹离开框）：撤掉记号，之后用 × 或取消关时照常把焦点交回去（BUG-710）。
              window.setTimeout(() => { if (stillOpen.current) closedByOutsideClick.current = false; });
            }
          }}
          onFocusOutside={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            // 提交中全部锁住，焦点照旧圈在抽屉里（OP-33）。
            if (!busy) tabOutOfDrawer(event, focus.previous.current);
          }}
        >
          {/* 点外面关的（焦点已跟着点到的地方走）不交。 */}
          <HandoffOnUnmount onGone={() => { if (!closedByOutsideClick.current) focus.onGone(); }} />
          <div className="rd-drawer-head">
            {icon && <IconTile tone={tone} icon={icon} size={28} />}
            <div className="rd-drawer-heading" aria-live="polite">
              <div className="rd-drawer-title-row">
                <Dialog.Title className="rd-drawer-title">{title}</Dialog.Title>
                {explain && <Explain label={`${typeof title === "string" ? title : "这个抽屉"}的说明`} content={explain} />}
              </div>
              {sub && <div className="rd-drawer-sub">{sub}</div>}
            </div>
            <div className="rd-drawer-tools">
              {nav && (
                <>
                  <IconButton aria-label="上一条" disabledReason={busy ? "正在提交" : nav.hasPrev ? undefined : "已经是第一条"} onClick={nav.onPrev}><ChevronUp size={16} aria-hidden /></IconButton>
                  <IconButton aria-label="下一条" disabledReason={busy ? "正在提交" : nav.hasNext ? undefined : "已经是最后一条"} onClick={nav.onNext}><ChevronDown size={16} aria-hidden /></IconButton>
                </>
              )}
              <IconButton aria-label="关闭" disabled={busy} onClick={close}><X size={16} aria-hidden /></IconButton>
            </div>
          </div>
          <div className="rd-drawer-body">{children}</div>
          {footer && <div className="rd-drawer-foot"><TipSide side="left">{footer}</TipSide></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * 抽屉底部的决定区。危险决定在左，主决定在右，分开放（DP-40）；只有危险决定时放右边。
 * note 只写现在能不能做、为什么不能（阻断原因常显，DP-03）；按下去会怎样、要不要审批这类后果说明传 explain，
 * 收进提示图标（DP-06）：有 note 时跟在 note 后面，没有时紧挨右边的按钮，不孤零零留在左下角（VS-85）。
 */
/** 传了片段但里面的按钮都没渲染时，算没传。 */
const filled = (node: ReactNode) => Children.toArray(isValidElement<{ children?: ReactNode }>(node) && node.type === Fragment ? node.props.children : node).length > 0;

export function Decision({ note, explain, danger, others, primary }: { note?: ReactNode; explain?: ReactNode; danger?: ReactNode; others?: ReactNode; primary?: ReactNode }) {
  const mark = explain && <Explain label="这些操作会怎样" content={explain} side="top" />;
  const paired = filled(others) || filled(primary);
  return (
    <>
      {note && <p className="rd-decision-note">{note}{mark}</p>}
      <div className="rd-decision">
        {paired && danger}
        <span className="rd-decision-spacer" />
        {!note && mark}
        {others}
        {primary}
        {!paired && danger}
      </div>
    </>
  );
}

/** 搜索框不算填内容，打了字照样能关。 */
const SEARCH_INPUT = 'input[type="search"], [role="searchbox"], [data-search]';

export function Modal({ title, sub, icon, tone = "neutral", onClose, children, footer, wide = false, busy = false, dirty = false, className, style, returnFocus }: {
  title: ReactNode;
  /** 标题下面一行：生效方式、能不能撤销这类后果标签，或对象编号。 */
  sub?: ReactNode;
  /** 标题前的图标底。传 lucide 图标；旧页面传来的图标元素也接。 */
  icon?: LucideIcon | ReactNode;
  /** 图标底的颜色。不能撤销或直接动钱的最终确认传 danger，其他都是灰，不带业务色（VS-101）。 */
  tone?: "neutral" | "danger";
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
  dirty?: boolean;
  className?: string;
  /** 贴着触发器定位时传位置变量，比如会话页的快捷内容选择层。 */
  style?: CSSProperties;
  returnFocus?: () => HTMLElement | null;
}) {
  const surface = useRdSurface();
  const focus = useFocusHandoff(true, returnFocus);
  const feedbackId = useDialogFeedback();
  const typed = useRef(false);
  /** 点选类控件（勾选、下拉、日期）动过。 */
  const picked = useRef(false);
  // 失焦时校验提示换掉帮助文字（删了节点），Radix 的焦点圈在焦点换手途中看到删除，会把焦点拉回外框（BUG-536）；记下本来要去的控件，送过去。
  const focusTarget = useRef<HTMLElement | null>(null);
  // 填过内容后按 Esc 一直不关，只提示要关请点 ×（OP-46）；接着打字就收起提示。
  const [escHinted, setEscHinted] = useState(false);
  const close = () => { if (!busy) onClose(); };
  const escText = "填过内容，按 Esc 不会关闭；要放弃请点右上角 ×";
  // rd 下拉、分段这类点选选中过一次，和原生勾选一样一直算填过内容（下拉弹层挂在框外，事件按组件树传到这里）。
  const notePick = (target: EventTarget | null) => {
    const pick = target instanceof Element ? target.closest(PICK_ROLES) : null;
    if (!pick || pick.matches('[aria-disabled="true"], [data-disabled]')) return;
    picked.current = typed.current = true;
    setEscHinted(false);
  };
  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal container={surface?.container ?? undefined}>
        <Dialog.Overlay className="rd-scrim" data-modal="" onClick={() => { if (!dirty && !typed.current) close(); }} />
        <Dialog.Content
          ref={focus.ref}
          style={style}
          className={className ? `rd-modal ${className}` : "rd-modal"}
          data-wide={wide ? "" : undefined}
          aria-modal="true"
          aria-busy={busy}
          aria-describedby={undefined}
          onInput={(event) => {
            if (event.target instanceof Element && event.target.matches(SEARCH_INPUT)) return;
            // 勾选、下拉、日期这类点选动过一次就一直算填过内容；文字框按现在有没有字算，删空了 Esc 和点空白照常关（OP-46「Esc 关闭空框」）。
            if (!(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement && TEXT_INPUT.test(event.target.type))) picked.current = true;
            typed.current = picked.current || [...event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")]
              .some((field) => !field.matches(SEARCH_INPUT) && !field.readOnly && !field.disabled && (field instanceof HTMLTextAreaElement || TEXT_INPUT.test(field.type)) && field.value.trim() !== "");
            setEscHinted(false);
          }}
          onPointerUp={(event) => notePick(event.target)}
          onKeyDown={(event) => {
            // 回车、空格选中；分段用方向键、Home、End 直接选中，下拉里的方向键只是移动高亮，不算。
            const target = event.target instanceof Element ? event.target : null;
            if (event.key === "Enter" || event.key === " " || (event.key.startsWith("Arrow") || event.key === "Home" || event.key === "End") && target?.closest('[role="radio"]')) notePick(target);
            // 这两种选中不落在选项上：搜索选择在输入框里按回车选中高亮的候选；收起的下拉按字母直接换值。
            if (event.key === "Enter" && target?.matches('input[role="combobox"][aria-expanded="true"]')
              || event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey && target?.matches('button[role="combobox"]')) {
              picked.current = typed.current = true;
              setEscHinted(false);
            }
          }}
          onBlur={(event) => { focusTarget.current = event.relatedTarget instanceof HTMLElement ? event.relatedTarget : null; }}
          onFocus={(event) => {
            const next = focusTarget.current;
            focusTarget.current = null;
            if (event.target === event.currentTarget && next && next !== event.currentTarget && event.currentTarget.contains(next)) next.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (busy || !(dirty || typed.current)) return;
            event.preventDefault();
            setEscHinted(true);
          }}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <HandoffOnUnmount onGone={focus.onGone} />
          <div className="rd-modal-head">
            {icon && (isValidElement(icon)
              ? <span className="rd-tile" data-tone={tone} data-size={28} aria-hidden>{icon}</span>
              : <IconTile tone={tone} icon={icon as LucideIcon} size={28} />)}
            <div className="rd-modal-heading">
              <Dialog.Title className="rd-modal-title">{title}</Dialog.Title>
              {sub && <div className="rd-modal-sub"><EffectSlot>{sub}</EffectSlot></div>}
            </div>
            <IconButton aria-label="关闭" disabled={busy} onClick={close}><X size={16} aria-hidden /></IconButton>
          </div>
          <ToastHost dialogId={feedbackId} />
          <div className="rd-modal-body">{children}</div>
          {/* 读屏用的状态区一直在，有字时才读出来；看得见的提示只在按过 Esc 后排进底栏，平时不占位。 */}
          <span className="rd-sr-only" role="status">{escHinted ? escText : ""}</span>
          {(footer || escHinted) && <div className="rd-modal-foot">{escHinted && <p className="rd-modal-esc" aria-hidden><KeepText text={escText} /></p>}<TipSide side="top">{footer}</TipSide></div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * 解除原操作记录（OP-96）：重试被后端拒绝后，人核实过才放开本页的锁。不发请求，不写操作记录，没有生效方式和关键数字。
 * 本地解除和服务端核查结案分开说明。重试被拒不等于原操作没生效；explain 写这一页先到哪里核对。
 */
export function ReleaseModal({ label, explain, onCancel, onConfirm }: { label: ReactNode; explain?: ReactNode; onCancel: () => void; onConfirm: () => void }) {
  return (
    <Modal title="解除原操作记录" icon={ShieldCheck} onClose={onCancel} footer={<>
      <Button onClick={onCancel}>取消</Button>
      <Button variant="primary" onClick={onConfirm}>确认解除</Button>
    </>}>
      <ReleaseBody label={label} explain={explain} />
    </Modal>
  );
}

/**
 * ReleaseModal 的正文。原操作本来就开在一个弹窗里时，在同一个框里换成这块（标题「解除原操作记录」、盾牌图标、底栏「返回」「确认解除」），
 * 不在框上再叠一个框（PG-38）。
 */
export function ReleaseBody({ label, explain }: { label: ReactNode; explain?: ReactNode }) {
  return (
    <div className="rd-stack rd-release-body">
      <Facts><Fact k="原操作">{label}</Fact></Facts>
      <p><KeepText text="先核对原操作的结果再解除。解除只删掉本标签页里的这条记录，不撤销原操作，也不算核查结案；重新提交时照常检查。" />{explain && <Explain label="解除的说明" content={explain} />}</p>
    </div>
  );
}
