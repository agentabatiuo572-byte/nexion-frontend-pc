"use client";

/**
 * Drawer 抽屉、Modal 弹窗（CP-66、CP-67）。Radix Dialog：Tab 圈在里面，Esc 只关最上层，
 * 打开时聚焦容器，关闭后焦点回到当前高亮行或打开前的按钮。
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
 */
import { useEffect, useRef, type ComponentProps, type KeyboardEvent, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronDown, ChevronUp, X, type LucideIcon } from "lucide-react";
import { IconButton } from "./button";
import { IconTile } from "./icon-tile";
import { useRdSurface } from "./surface";
import type { RoleTone, StateTone } from "./tone";

/** 抽屉不是 Radix 的模态，Tab 圈要自己做。 */
function keepTabInside(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab") return;
  const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex="0"]')]
    .filter((element) => !element.matches(":disabled") && element.getClientRects().length > 0);
  if (!controls.length) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === controls[0] || active === event.currentTarget)) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (!event.shiftKey && active === controls.at(-1)) {
    event.preventDefault();
    controls[0].focus();
  }
}

/** 列表里的行和页面控件才算点到外面；提示条、浮层不在这些区域里，点它们不关抽屉。 */
function dismissesDrawer(target: EventTarget | null) {
  return target instanceof Element && target.closest("main, aside, header") !== null && target.closest("tr[data-clickable]") === null;
}

/** 打开时聚焦容器，关闭后回到打开前的元素。Dialog 没有 Trigger 时要自己记。 */
function useFocusHandoff(open: boolean) {
  const previous = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);
  const content = useRef<HTMLDivElement>(null);
  if (open && !wasOpen.current && document.activeElement instanceof HTMLElement) previous.current = document.activeElement;
  wasOpen.current = open;
  return {
    ref: content,
    previous,
    onOpenAutoFocus: (event: Event) => {
      event.preventDefault();
      content.current?.focus();
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      if (previous.current?.isConnected) previous.current.focus();
    },
  };
}

export interface DrawerNav {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export function Drawer({ open, onClose, title, sub, icon, tone = "role-other", nav, footer, busy = false, wide = false, children, ...rest }: Omit<ComponentProps<typeof Dialog.Content>, "title"> & {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  icon?: LucideIcon;
  tone?: RoleTone | StateTone;
  nav?: DrawerNav;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
}) {
  const surface = useRdSurface();
  const focus = useFocusHandoff(open);
  const closedByOutsideClick = useRef(false);
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
          aria-modal="true"
          aria-busy={busy}
          aria-describedby={undefined}
          onKeyDown={keepTabInside}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={(event) => {
            if (closedByOutsideClick.current) event.preventDefault();
            else focus.onCloseAutoFocus(event);
            closedByOutsideClick.current = false;
          }}
          onPointerDownOutside={(event) => {
            if (busy || !dismissesDrawer(event.detail.originalEvent.target)) event.preventDefault();
            else closedByOutsideClick.current = true;
          }}
          onFocusOutside={(event) => event.preventDefault()}
        >
          <div className="rd-drawer-head">
            {icon && <IconTile tone={tone} icon={icon} size={28} />}
            <div className="rd-drawer-heading" aria-live="polite">
              <Dialog.Title className="rd-drawer-title">{title}</Dialog.Title>
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
          {footer && <div className="rd-drawer-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** 抽屉底部的决定区。危险决定在左，主决定在右，分开放（DP-40）。 */
export function Decision({ note, danger, others, primary }: { note?: ReactNode; danger?: ReactNode; others?: ReactNode; primary?: ReactNode }) {
  return (
    <>
      {note && <p className="rd-decision-note">{note}</p>}
      <div className="rd-decision">
        {danger}
        <span className="rd-decision-spacer" />
        {others}
        {primary}
      </div>
    </>
  );
}

export function Modal({ title, icon, onClose, children, footer, wide = false, busy = false, className }: {
  title: ReactNode;
  icon?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  busy?: boolean;
  className?: string;
}) {
  const surface = useRdSurface();
  const focus = useFocusHandoff(true);
  const close = () => { if (!busy) onClose(); };
  return (
    <Dialog.Root open onOpenChange={(next) => { if (!next) close(); }}>
      <Dialog.Portal container={surface?.container ?? undefined}>
        <Dialog.Overlay className="rd-scrim" data-modal="" onClick={close} />
        <Dialog.Content
          ref={focus.ref}
          className={className ? `rd-modal ${className}` : "rd-modal"}
          data-wide={wide ? "" : undefined}
          aria-modal="true"
          aria-busy={busy}
          aria-describedby={undefined}
          onOpenAutoFocus={focus.onOpenAutoFocus}
          onCloseAutoFocus={focus.onCloseAutoFocus}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <div className="rd-modal-head">
            {icon}
            <Dialog.Title className="rd-modal-title">{title}</Dialog.Title>
            <IconButton aria-label="关闭" disabled={busy} onClick={close}><X size={16} aria-hidden /></IconButton>
          </div>
          <div className="rd-modal-body">{children}</div>
          {footer && <div className="rd-modal-foot">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
