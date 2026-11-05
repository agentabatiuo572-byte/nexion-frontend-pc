/**
 * NumberInput 数字输入（CP-54）。单位写在输入框里，读屏也读得到；空和 0 是两回事，组件不改写值。
 *
 * <NumberInput aria-label="目标新值" unit="天" min={1} max={90} step={1} value={value} onChange={…} />
 *
 * 范围当场校验和错误文字由调用方写（OP-141），超范围不取整。
 */
import { forwardRef, type InputHTMLAttributes } from "react";

export const NumberInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { unit?: string }>(function NumberInput({ unit, className, ...rest }, ref) {
  return (
    <span className="rd-number">
      <input ref={ref} {...rest} type="number" className={className ? `rd-input ${className}` : "rd-input"} />
      {unit && <span className="rd-number-unit">{unit}</span>}
    </span>
  );
});
