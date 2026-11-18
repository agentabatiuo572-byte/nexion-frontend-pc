"use client";

/**
 * MoreMenu 更多操作菜单（CP-31）。行操作露不下时用，危险项排在最后，和普通项分开（OP-05）。
 *
 * <MoreMenu items={[
 *   { key: "delay", label: "延迟", onSelect: … },
 *   { key: "reject", label: "拒绝并退款", danger: true, disabledReason: "详情读取失败", onSelect: … },
 * ]} />
 *
 * - 方向键、Home、End 在可用项间移动，Esc 收起并回到按钮，点外面收起，点一项收起。点开才出来，不靠悬停，触屏也能用。
 * - disabledReason 写在这一项下面，不只放悬停（OP-126）。
 * - 放在可点的表格行里时，点菜单不会打开这一行。
 */
import { useState, type KeyboardEvent, type ReactNode, useRef } from "react";
import * as Popover from "@radix-ui/react-popover";
import { MoreHorizontal } from "lucide-react";
import { IconTip } from "./button";

export interface MoreMenuItem {
  key: string;
  label: ReactNode;
  danger?: boolean;
  disabledReason?: ReactNode;
  onSelect: () => void;
}

function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')];
  if (!items.length) return;
  const index = items.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  items[next].focus();
}

export function MoreMenu({ label = "更多操作", items, disabled = false }: { label?: string; items: readonly MoreMenuItem[]; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <IconTip label={label}><Popover.Trigger ref={trigger} className="rd-iconbtn" aria-label={label} disabled={disabled}><MoreHorizontal size={16} aria-hidden /></Popover.Trigger></IconTip>
      <Popover.Portal>
        <Popover.Content className="rd-pop rd-menu" role="menu" aria-label={label} align="end" sideOffset={6} collisionPadding={12} onClick={(event) => event.stopPropagation()} onKeyDown={moveFocus}>
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" className="rd-menu-item" data-danger={item.danger ? "" : undefined} aria-disabled={item.disabledReason ? true : undefined}
              onClick={() => {
                if (item.disabledReason) return;
                setOpen(false);
                // 先把焦点还给「⋯」：菜单项随即卸载，由它打开的弹窗或抽屉关闭后才有地方把焦点还回来。
                trigger.current?.focus();
                item.onSelect();
              }}>
              {item.label}
              {item.disabledReason && <span className="rd-menu-reason">{item.disabledReason}</span>}
            </button>
          ))}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
