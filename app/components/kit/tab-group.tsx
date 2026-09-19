"use client";

/**
 * TabGroup — 互斥分段 / 筛选的统一可访问语义层。
 *
 * 只补语义,不碰视觉与筛选行为:容器 role="tablist" + 组名,每项 role="tab" + aria-selected +
 * roving tabindex(选中项 0、其余 -1),左右/上下方向键与 Home / End 在项间移动并立即选中
 * (与点击等价,disabled 项跳过)。调用方保留自己的 className / style / 内容结构 —— 视觉零变化,
 * 读屏与键盘才拿得到「当前选中项」。
 *
 * 组名来源:`label` 给可见文本时,同一段文本既渲染成可见标签(调用方给 `labelClassName`)又
 * 通过 aria-labelledby 成为组名 —— 不再抄一份字符串,读屏读到的与眼睛看到的一致。组名已在
 * 页面上另行渲染(如卡头标题)时,用 `labelledBy` 指过去;两者都没有时退化为 `aria-label`。
 *
 * 多选组(可同时开启多项)不是互斥关系,不要用本组件;那种情况给切换按钮补 aria-pressed。
 */
import { useId, useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { nextTabValue } from "./tab-group-keyboard";

export function TabGroup<T extends string | number>({
  label,
  labelClassName,
  labelledBy,
  value,
  items,
  onSelect,
  className,
  style,
  disabled,
  itemClassName,
  itemStyle,
  itemTitle,
  orientation = "horizontal",
  children,
}: {
  /** 组名;给了 labelClassName(含空串)就同时渲染成可见标签 */
  label?: string;
  /** 可见标签的类名(如 "lb");空串表示不加类、只渲染文本 */
  labelClassName?: string;
  /** 组名已由页面上其他元素呈现时,指向那个元素的 id */
  labelledBy?: string;
  value: T;
  items: readonly T[];
  onSelect: (value: T) => void;
  className?: string;
  /** 容器内联样式(保持调用点原有布局,不改视觉) */
  style?: CSSProperties;
  disabled?: (value: T) => boolean;
  itemClassName?: (value: T, selected: boolean) => string | undefined;
  itemStyle?: (value: T, selected: boolean) => CSSProperties | undefined;
  itemTitle?: (value: T, selected: boolean) => string | undefined;
  orientation?: "horizontal" | "vertical";
  children: (value: T, selected: boolean) => ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const visibleLabelId = useId();
  const selectable = items.filter((item) => !(disabled?.(item) ?? false));
  // 选中项若不可用(如加载中整组禁用),roving 焦点落回第一个可用项,否则整组无法用 Tab 进入。
  const focusValue = selectable.includes(value) ? value : selectable[0];

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextTabValue(selectable, value, event.key);
    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[items.indexOf(next)]?.focus();
  };

  const showVisibleLabel = Boolean(label) && labelClassName !== undefined;
  const named = labelledBy
    ? { "aria-labelledby": labelledBy }
    : showVisibleLabel
      ? { "aria-labelledby": visibleLabelId }
      : label
        ? { "aria-label": label }
        : {};

  return (
    <div ref={listRef} role="tablist" {...named} aria-orientation={orientation} className={className} style={style} onKeyDown={onKeyDown}>
      {showVisibleLabel && <span className={labelClassName} id={visibleLabelId}>{label}</span>}
      {items.map((item) => {
        const selected = item === value;
        return (
          <button
            key={String(item)}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={item === focusValue ? 0 : -1}
            disabled={disabled?.(item) ?? false}
            title={itemTitle?.(item, selected)}
            className={itemClassName?.(item, selected)}
            style={itemStyle?.(item, selected)}
            onClick={() => {
              if (!(disabled?.(item) ?? false)) onSelect(item);
            }}
          >
            {children(item, selected)}
          </button>
        );
      })}
    </div>
  );
}
