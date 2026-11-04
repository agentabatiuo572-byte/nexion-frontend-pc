"use client";

/**
 * Select 下拉，Radix 原语。状态超过 5 个时按组排（ST-68），排序下拉也用它。
 *
 * <Select aria-label="状态" value={status} onChange={setStatus} placeholder="全部要处理状态"
 *   options={[{ value: "", label: "全部要处理状态" }, { value: "PENDING", label: "待审核" }]} />
 * <Select aria-label="状态" value={status} onChange={setStatus}
 *   groups={[{ label: "要处理", options: [...] }, { label: "已结束", options: [...] }]} />
 *
 * value 可以是空字符串，表示「全部」。Radix 自带 portal、首字母跳转、Home、End、Esc 回到触发器和表单
 * required；这里补方向键环绕和 Tab 收起（CP-57）。
 */
import { useState, type KeyboardEvent, type ReactNode } from "react";
import * as Radix from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

const EMPTY = "__rd_all__";

export interface SelectOption {
  value: string;
  label: ReactNode;
  disabled?: boolean;
}

function Option({ option }: { option: SelectOption }) {
  return (
    <Radix.Item className="rd-select-item" value={option.value || EMPTY} disabled={option.disabled}>
      <Radix.ItemText>{option.label}</Radix.ItemText>
      <Radix.ItemIndicator className="rd-select-check"><Check size={14} aria-hidden /></Radix.ItemIndicator>
    </Radix.Item>
  );
}

export function Select({ value, onChange, options, groups, placeholder, disabled, name, required, "aria-label": ariaLabel }: {
  value: string;
  onChange: (value: string) => void;
  options?: readonly SelectOption[];
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  "aria-label": string;
}) {
  const [open, setOpen] = useState(false);
  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Tab") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])')];
    const edge = event.key === "ArrowDown" ? items.at(-1) : items[0];
    if (document.activeElement !== edge) return;
    event.preventDefault();
    event.stopPropagation();
    (event.key === "ArrowDown" ? items[0] : items.at(-1))?.focus();
  };
  return (
    <Radix.Root value={value || EMPTY} onValueChange={(next) => onChange(next === EMPTY ? "" : next)} open={open && !disabled} onOpenChange={setOpen} disabled={disabled} name={name} required={required}>
      <Radix.Trigger className="rd-select" aria-label={ariaLabel}>
        <Radix.Value placeholder={placeholder} />
        <Radix.Icon><ChevronDown size={14} aria-hidden /></Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content className="rd-select-content" position="popper" sideOffset={4} collisionPadding={12} onKeyDownCapture={onKeyDownCapture}>
          <Radix.Viewport className="rd-select-viewport">
            {options?.map((option) => <Option key={option.value} option={option} />)}
            {groups?.map((group) => (
              <Radix.Group key={group.label}>
                <Radix.Label className="rd-select-label">{group.label}</Radix.Label>
                {group.options.map((option) => <Option key={option.value} option={option} />)}
              </Radix.Group>
            ))}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
