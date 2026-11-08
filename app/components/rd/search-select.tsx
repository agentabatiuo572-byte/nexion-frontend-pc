"use client";

/**
 * SearchSelect 可输可选的下拉（ST-29）。交互照 Ant Design AutoComplete、Select showSearch：
 * 点框、打字或按 ↓ 展开候选（聚焦本身不展开：弹窗关上焦点回到框里时不会自己弹出来）；第一项默认高亮，
 * 方向键上下移动（到头绕回），高亮项跟着滚进可视区；Enter 选中高亮项，Esc 收起，Tab 和点外面收起；鼠标移到哪一项就高亮哪一项，点一项选中并收起。
 * 输入法组合中（中文昵称拼音没上屏）按键不动候选，Enter 只是上屏。
 *
 * <SearchSelect aria-label="选择资产调整账户" placeholder="搜索用户编码、昵称或邀请码"
 *   value={query} onChange={setQuery} onOpen={() => setArmed(true)}
 *   options={[{ value: "10", label: "U00000010 · 徐丽", extra: "138****0000" }]} selected="10"
 *   onSelect={(value) => pick(value)} loading={searching} optionsFor={resultQuery} error={searchError && `搜索失败：${searchError}`}
 *   onRetry={retry} empty="没有匹配的用户" />
 *
 * - 查询由页面做：防抖、请求、丢弃过期结果都在页面，组件只管弹层、键盘、读屏和加载、空、失败三种状态。
 * - 远程搜索传 `optionsFor`：这组候选（或失败）是按框里哪段文字查出来的，还没查过传 null。和框里现在的字不一样就是旧候选，
 *   照 Ant Design Select 远程搜索：输入一变就不显示旧候选，写「搜索中…」，回车不选，防抖期间回车也不会选到上一次的第一项。
 * - 读屏：输入框是 combobox，aria-activedescendant 指向高亮项，候选是 listbox 里的 option。
 * - 放进 Field 自动接上 id、aria-describedby、aria-invalid。
 * - 选中后框里显示什么由页面定（value）；改动框里的文字要不要清掉已选，也由页面定。
 */
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { InlineRetry } from "./block-state";

export interface SearchOption {
  value: string;
  label: ReactNode;
  /** 右侧弱字，比如脱敏手机号。 */
  extra?: ReactNode;
  disabled?: boolean;
}

export function SearchSelect({ value, onChange, options, selected, onSelect, onOpen, loading = false, optionsFor, error, onRetry, empty = "没有匹配的结果", placeholder, disabled, id, "aria-label": ariaLabel, "aria-describedby": describedBy, "aria-invalid": invalid }: {
  value: string;
  onChange: (value: string) => void;
  options: readonly SearchOption[];
  /** 已选中的那一项，打勾。 */
  selected?: string;
  onSelect: (value: string) => void;
  /** 每次展开时调用：页面据此开始查询。 */
  onOpen?: () => void;
  loading?: boolean;
  /** 远程搜索时这组候选对应的输入；和 value 不同（或 null）时当作还在搜索。不传就是本地候选，不比较。 */
  optionsFor?: string | null;
  /** 查询失败的原因，写在下拉里；传 onRetry 时带「重试」。 */
  error?: ReactNode;
  onRetry?: () => void;
  empty?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  "aria-label": string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const shown = open && !disabled;
  const searching = loading || (optionsFor !== undefined && optionsFor !== value);
  const listed = shown && !searching && !error && options.length > 0;
  // 候选换了，高亮回到第一个能选的（defaultActiveFirstOption）。按内容比，页面每次重渲染新建数组不算换。
  const optionKey = options.map((option) => `${option.value}${option.disabled ? "!" : ""}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setActive(Math.max(0, options.findIndex((option) => !option.disabled))); }, [optionKey]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  // 方向键移到弹层外的项时滚进来，看得到高亮的是谁。
  useEffect(() => { if (listed) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active, listed, listId]);
  const show = () => {
    if (shown) return;
    setOpen(true);
    onOpen?.();
  };
  const choose = (option: SearchOption) => {
    if (option.disabled) return;
    onSelect(option.value);
    setOpen(false);
  };
  const move = (step: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const next = (active + step * offset + options.length) % options.length;
      if (!options[next].disabled) { setActive(next); return; }
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // 输入法组合中的 Enter、方向键归输入法（keyCode 229 是 Safari 组合中的按键）。
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!shown) show();
      else if (listed) move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      if (listed && options[active]) {
        event.preventDefault();
        choose(options[active]);
      }
    } else if (event.key === "Escape") {
      if (shown) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };
  const onBlur = (event: FocusEvent<HTMLInputElement>) => {
    if (!popRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
  };
  return (
    <Popover.Root open={shown} onOpenChange={(next) => { if (!next) setOpen(false); }}>
      <Popover.Anchor asChild>
        <div className="rd-search-select">
          <input
            ref={inputRef}
            id={id}
            className="rd-input"
            type="text"
            role="combobox"
            autoComplete="off"
            data-search=""
            aria-label={ariaLabel}
            aria-describedby={describedBy}
            aria-invalid={invalid}
            aria-autocomplete="list"
            aria-expanded={shown}
            aria-controls={listed ? listId : undefined}
            aria-activedescendant={listed ? `${listId}-${active}` : undefined}
            placeholder={placeholder}
            disabled={disabled}
            value={value}
            onChange={(event) => { onChange(event.target.value); show(); }}
            onClick={show}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
          />
          <span className="rd-search-select-icon" aria-hidden>
            {searching && shown ? <Loader2 className="rd-spin" size={14} /> : <ChevronDown size={14} />}
          </span>
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          ref={popRef}
          className="rd-search-pop"
          align="start"
          sideOffset={4}
          collisionPadding={12}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => { if (inputRef.current?.contains(event.target as Node)) event.preventDefault(); }}
          // 点候选不抢走输入框的焦点，选完还能接着打字。
          onMouseDown={(event) => event.preventDefault()}
        >
          {searching ? (
            <div className="rd-search-state" role="status"><Loader2 className="rd-spin" size={14} aria-hidden />搜索中…</div>
          ) : error ? (
            <div className="rd-search-state" data-error="" role="alert">{error}{onRetry && <InlineRetry onRetry={onRetry} />}</div>
          ) : options.length === 0 ? (
            <div className="rd-search-state" role="status">{empty}</div>
          ) : (
            <div role="listbox" id={listId} aria-label={ariaLabel}>
              {options.map((option, index) => (
                <div
                  key={option.value}
                  id={`${listId}-${index}`}
                  role="option"
                  className="rd-search-option"
                  aria-selected={option.value === selected}
                  aria-disabled={option.disabled ? true : undefined}
                  data-active={index === active ? "" : undefined}
                  onMouseEnter={() => { if (!option.disabled) setActive(index); }}
                  onClick={() => choose(option)}
                >
                  <span className="rd-search-option-label">{option.label}</span>
                  {option.extra && <span className="rd-search-option-extra">{option.extra}</span>}
                  {option.value === selected && <Check className="rd-search-option-check" size={14} aria-hidden />}
                </div>
              ))}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
