"use client";

/**
 * NumberInput 数字输入（CP-54）。单位写在框里，读屏也读得到；空和 0 是两回事，组件不改写值。
 *
 * <NumberInput aria-label="目标新值" unit="天" min={1} max={90} step={1} value={value} onChange={…} />
 *
 * 照 Ant Design InputNumber：
 * - 显示带千分位（formatter），value 和 onChange 里的 event.target.value 都是不带逗号的原值（parser），调用方不用改。
 * - 宽度按内容定：放得下 min、max 和现在的值，单位紧跟在数字后面，不拉满整行。值比 max 还长时框跟着变宽，不切字。
 * - 只收数字、一个小数点，min 小于 0 或没给 min 时开头可以有负号；合法千分位只去逗号，其他输入整次拒收并提示。
 *   空、填了一半（「-」「.」）和 0 是三种值，原样交给调用方；「-」这类不是数字，调用方按填错处理。
 * - 上下方向键对齐从 min（未传则 0）开始的 step 网格，不超出 min、max。
 *
 * 范围当场校验和错误文字由调用方写（OP-141），超范围不取整。
 */
import { forwardRef, useCallback, useId, useLayoutEffect, useRef, useState, type ChangeEvent, type CSSProperties, type InputHTMLAttributes, type KeyboardEvent } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "min" | "max" | "step"> & {
  unit?: string;
  value?: string | number;
  min?: number | string;
  max?: number | string;
  step?: number | string;
};

const finite = (value: number | string | undefined) => value === undefined || value === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);

/** 整数部分加千分位；不是完整写法的（如「-」「.」）原样显示。 */
function format(raw: string) {
  const match = raw.match(/^(-?)(\d+)(\.\d*)?$/);
  return match ? `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${match[3] ?? ""}` : raw;
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
  const [rejected, setRejected] = useState(false);
  const rejectionId = useId();
  // 改完值后光标前有几个非逗号字符；重新加千分位后按这个数放回光标。
  const caret = useRef<number | null>(null);
  const raw = value === undefined || value === null ? "" : String(value);
  const shown = format(raw);
  const lo = finite(min), hi = finite(max), by = finite(step) ?? 1;
  const negative = lo === undefined || lo < 0;
  const rejectionText = `未接收这次输入，原值未变。只填数字和一个小数点${negative ? "，开头可加负号" : ""}；可用千分位逗号，不含空格、字母或单位。`;
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

  // 拒收只属于这一次输入；调用方清空或重置值后，不沿用旧提示。
  useLayoutEffect(() => { setRejected(false); }, [raw]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const typed = input.value;
    const before = typed.slice(0, input.selectionStart ?? typed.length);
    // 框里原有的千分位随编辑重新排；只去显示用的逗号，不删除任何其他字符。
    const native = event.nativeEvent as InputEvent;
    const kind = native.inputType;
    // 删字或新插入的文本不含逗号时，框里原有逗号只作显示；新输入逗号时校验完整分组。
    const editsFormattedValue = kind?.startsWith("delete")
      || typeof native.data === "string" && !native.data.includes(",");
    const candidate = editsFormattedValue ? typed.replace(/,/g, "") : typed;
    const syntax = negative ? /^-?(?:\d*|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/ : /^(?:\d*|\d{1,3}(?:,\d{3})+)(?:\.\d*)?$/;
    if (!syntax.test(candidate)) {
      // 同步受控输入的值追踪，连续输入同一非法文本时也会再次拒收。
      input.value = shown;
      setRejected(true);
      return;
    }
    setRejected(false);
    let next = candidate.replace(/,/g, "");
    caret.current = before.replace(/,/g, "").length;
    if (next === raw && kind === "deleteContentBackward" && caret.current > 0) {
      // 退格删掉的是千分位逗号：删它前面那一位数字。
      next = raw.slice(0, caret.current - 1) + raw.slice(caret.current);
      caret.current -= 1;
    } else if (next === raw && kind === "deleteContentForward") {
      next = raw.slice(0, caret.current) + raw.slice(caret.current + 1);
    }
    if (next === raw) {
      // 数值没变（如重新输入显示用的逗号），框里放回原样，光标不跳。
      input.value = shown;
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
    // 在整数刻度上找相邻网格，避免 0.1 + 0.2 的浮点误差把已对齐值跳过。
    const precision = Math.max(decimals, decimalsOf(now), decimalsOf(hi));
    const scale = 10 ** precision;
    const origin = Math.round((lo ?? 0) * scale), stride = Math.round(by * scale);
    const position = (Math.round(now * scale) - origin) / stride;
    let index = event.key === "ArrowUp" ? Math.floor(position) + 1 : Math.ceil(position) - 1;
    if (hi !== undefined) index = Math.min(index, Math.floor((Math.round(hi * scale) - origin) / stride));
    let next = (origin + index * stride) / scale;
    if (raw.trim() === "" || !Number.isFinite(Number(raw))) next = now;
    if (lo !== undefined) next = Math.max(lo, next);
    const input = event.currentTarget;
    setNativeValue(input, format(next.toFixed(Math.max(decimals, decimalsOf(Number(raw) || 0)))));
    caret.current = null;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const numeric = raw.trim() !== "" && Number.isFinite(Number(raw)) ? Number(raw) : undefined;
  const box = { "--rd-number-chars": chars, "--rd-number-unit": unit ? width(unit) : 0 } as CSSProperties;
  return (
    <>
      <span className="rd-number" data-unit={unit ? "" : undefined} style={box}>
        <input
          ref={ref}
          {...rest}
          type="text"
          inputMode={rest.inputMode ?? (decimals > 0 || !Number.isInteger(by) ? "decimal" : "numeric")}
          autoComplete="off"
          role="spinbutton"
          aria-invalid={rejected || rest["aria-invalid"] || undefined}
          aria-describedby={[rest["aria-describedby"], rejected ? rejectionId : ""].filter(Boolean).join(" ") || undefined}
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
      {rejected && <div id={rejectionId} className="rd-form-error" role="alert">{rejectionText}</div>}
    </>
  );
});
