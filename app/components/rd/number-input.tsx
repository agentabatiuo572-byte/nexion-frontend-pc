"use client";

/**
 * NumberInput 数字输入（CP-54）。单位写在框里，读屏也读得到；空和 0 是两回事，组件不改写值。
 *
 * <NumberInput aria-label="目标新值" unit="天" min={1} max={90} step={1} value={value} onChange={…} />
 *
 * 照 Ant Design InputNumber：
 * - 显示带千分位（formatter），value 和 onChange 里的 event.target.value 都是不带逗号的原值（parser），调用方不用改。
 * - 宽度按内容定：放得下 min、max 和现在的值，单位紧跟在数字后面，不拉满整行。值比 max 还长时框跟着变宽，不切字。
 * - 只收数字、一个小数点，min 小于 0 或没给 min 时开头可以有负号；粘贴进来的逗号、空格、单位会去掉。
 *   空、填了一半（「-」「.」）和 0 是三种值，原样交给调用方；「-」这类不是数字，调用方按填错处理。
 * - 上下方向键按 step 加减（原生数字框的行为），不超出 min、max。
 *
 * 范围当场校验和错误文字由调用方写（OP-141），超范围不取整。
 */
import { forwardRef, useCallback, useLayoutEffect, useRef, type ChangeEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "step"> & {
  unit?: string;
  value?: string | number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
};

const finite = (value: number | string | undefined) => value === undefined || value === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);

/** 整数部分加千分位；不是完整写法的（「1.2.3」不会出现，「-」「.」会）原样显示。 */
function format(raw: string) {
  const match = raw.match(/^(-?)(\d+)(\.\d*)?$/);
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}` : raw;
}

/** 去掉逗号和别的字，只留数字、第一个小数点，允许时留开头的负号。 */
function sanitize(text: string, negative: boolean) {
  const sign = negative && /^\s*-/.test(text) ? "-" : "";
  const [whole, ...rest] = text.replace(/[^\d.]/g, "").split(".");
  return `${sign}${whole}${rest.length ? `.${rest.join("")}` : ""}`;
}

/** 中文和全角字符按两个字宽算，宽度单位是 ch。 */
const width = (text: string) => [...text].reduce((sum, char) => sum + (/[⺀-￿]/.test(char) ? 2 : 1), 0);

const decimalsOf = (value: number | undefined) => value === undefined ? 0 : (String(value).split(".")[1]?.length ?? 0);

/** 带千分位的文字里，第 count 个非逗号字符后面的位置。 */
function caretAt(text: string, count: number) {
  let kept = 0, at = 0;
  while (at < text.length && kept < count) { if (text[at] !== ",") kept += 1; at += 1; }
  return at;
}

const setNativeValue = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
};

export const NumberInput = forwardRef<HTMLInputElement, Props>(function NumberInput({ unit, className, value, min, max, step, onChange, onKeyDown, placeholder, style, ...rest }, forwarded) {
  const inner = useRef<HTMLInputElement | null>(null);
  // 改完值后光标前有几个非逗号字符；重新加千分位后按这个数放回光标。
  const caret = useRef<number | null>(null);
  const raw = value === undefined || value === null ? "" : String(value);
  const shown = format(raw);
  const lo = finite(min), hi = finite(max), by = finite(step) ?? 1;
  const negative = lo === undefined || lo < 0;
  const decimals = Math.max(decimalsOf(by), decimalsOf(lo));
  const chars = Math.max(
    hi === undefined ? 0 : width(format(hi.toFixed(decimals))),
    lo === undefined ? 0 : width(format(lo.toFixed(decimals))),
    width(shown),
    width(placeholder ?? ""),
    4,
  );

  const ref = useCallback((node: HTMLInputElement | null) => {
    inner.current = node;
    if (typeof forwarded === "function") forwarded(node);
    else if (forwarded) forwarded.current = node;
  }, [forwarded]);

  useLayoutEffect(() => {
    const input = inner.current;
    if (caret.current === null || !input || document.activeElement !== input) return;
    const at = caretAt(input.value, caret.current);
    input.setSelectionRange(at, at);
    caret.current = null;
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const typed = input.value;
    const before = typed.slice(0, input.selectionStart ?? typed.length);
    let next = sanitize(typed, negative);
    caret.current = sanitize(before, negative).length;
    const kind = (event.nativeEvent as InputEvent).inputType;
    if (next === raw && kind === "deleteContentBackward" && caret.current > 0) {
      // 退格删掉的是千分位逗号：删它前面那一位数字。
      next = raw.slice(0, caret.current - 1) + raw.slice(caret.current);
      caret.current -= 1;
    } else if (next === raw && kind === "deleteContentForward") {
      next = raw.slice(0, caret.current) + raw.slice(caret.current + 1);
    }
    if (next === raw) {
      // 打的是收不进的字（字母、第二个小数点）：和原生数字框一样不算改动，框里放回原样，光标不跳。
      setNativeValue(input, shown);
      const at = caretAt(shown, caret.current);
      input.setSelectionRange(at, at);
      caret.current = null;
      return;
    }
    // 交给调用方的是原值；重渲染时按 value 再加上千分位。
    setNativeValue(input, next);
    onChange?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || rest.disabled || rest.readOnly) return;
    event.preventDefault();
    const now = raw.trim() === "" || !Number.isFinite(Number(raw)) ? (lo ?? 0) : Number(raw);
    let next = event.key === "ArrowUp" ? now + by : now - by;
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) next = now;
    if (hi !== undefined) next = Math.min(hi, next);
    if (lo !== undefined) next = Math.max(lo, next);
    const input = event.currentTarget;
    setNativeValue(input, format(next.toFixed(Math.max(decimals, decimalsOf(Number(raw) || 0)))));
    caret.current = null;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const numeric = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  const box = { "--rd-number-chars": chars, "--rd-number-unit": unit ? width(unit) : 0 } as CSSProperties;
  return (
    <span className="rd-number" data-unit={unit ? "" : undefined} style={box}>
      <input
        ref={ref}
        {...rest}
        type="text"
        inputMode={rest.inputMode ?? (decimals > 0 || !Number.isInteger(by) ? "decimal" : "numeric")}
        autoComplete="off"
        role="spinbutton"
        aria-valuemin={lo}
        aria-valuemax={hi}
        aria-valuenow={numeric}
        aria-valuetext={numeric === undefined ? undefined : `${shown}${unit ? ` ${unit}` : ""}`}
        placeholder={placeholder}
        value={shown}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        style={style}
        className={className ? `rd-input ${className}` : "rd-input"}
      />
      {unit && <span className="rd-number-unit">{unit}</span>}
    </span>
  );
});
