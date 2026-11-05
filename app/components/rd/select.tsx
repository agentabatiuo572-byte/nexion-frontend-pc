"use client";

/**
 * Select 下拉，Radix 原语。状态超过 5 个时按组排（ST-68），排序下拉也用它。
 *
 * <Select aria-label="状态" value={status} onChange={setStatus} placeholder="全部要处理状态"
 *   options={[{ value: "", label: "全部要处理状态" }, { value: "PENDING", label: "待审核" }]} />
 * <Select aria-label="状态" value={status} onChange={setStatus}
 *   groups={[{ label: "要处理", options: [...] }, { label: "已结束", options: [...] }]} />
 *
 * 空字符串有两种意思，看 required：
 * - 不必填：有 value 为空的选项时，它就是能选中的「全部」，onChange 和表单值都是空串。
 * - 必填：空串就是没选，显示 placeholder，表单提交时被拦下。value 为空的选项不进列表，
 *   它的文字在没传 placeholder 时当占位用。
 *
 * <Select aria-label="收款方式" name="method" required value={method} onChange={setMethod}
 *   placeholder="请选择收款方式" options={[{ value: "BANK", label: "银行卡" }]} />
 *
 * Radix 自带 portal、首字母跳转、Home、End、Esc 回到触发器；这里补方向键环绕、Tab 收起和禁用时收起（CP-57）。
 * id、aria-describedby、aria-invalid 给 Field 接标签和错误，放进 Field 不用传；填错时触发器描边和输入框一样。
 */
import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";
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

export function Select({ value, onChange, options, groups, placeholder, disabled, name, required, id, "aria-label": ariaLabel, "aria-describedby": describedBy, "aria-invalid": invalid }: {
  value: string;
  onChange: (value: string) => void;
  options?: readonly SelectOption[];
  groups?: readonly { label: string; options: readonly SelectOption[] }[];
  placeholder?: string;
  disabled?: boolean;
  name?: string;
  required?: boolean;
  id?: string;
  "aria-label": string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const emptyOption = [...(options ?? []), ...(groups ?? []).flatMap((group) => group.options)].find((option) => option.value === "");
  const choices = (list: readonly SelectOption[]) => (required ? list.filter((option) => option.value !== "") : list);
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
    <Radix.Root value={value || (emptyOption && !required ? EMPTY : "")} onValueChange={(next) => onChange(next === EMPTY ? "" : next)} open={open && !disabled} onOpenChange={setOpen} disabled={disabled} required={required}>
      {/* Radix 的原生 select 只管必填校验；表单值走这里，「全部」才是空串，不是内部占位值。 */}
      {name && <input type="hidden" name={name} value={value} disabled={disabled} />}
      <Radix.Trigger className="rd-select" id={id} aria-label={ariaLabel} aria-describedby={describedBy} aria-invalid={invalid}>
        <Radix.Value placeholder={placeholder ?? (required ? emptyOption?.label : undefined)} />
        <Radix.Icon><ChevronDown size={14} aria-hidden /></Radix.Icon>
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content className="rd-select-content" position="popper" sideOffset={4} collisionPadding={12} onKeyDownCapture={onKeyDownCapture}>
          <Radix.Viewport className="rd-select-viewport">
            {options && choices(options).map((option) => <Option key={option.value} option={option} />)}
            {groups?.map((group) => (
              <Radix.Group key={group.label}>
                <Radix.Label className="rd-select-label">{group.label}</Radix.Label>
                {choices(group.options).map((option) => <Option key={option.value} option={option} />)}
              </Radix.Group>
            ))}
          </Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
