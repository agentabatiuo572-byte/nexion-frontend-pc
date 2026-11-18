"use client";

/**
 * Checkbox 勾选框（CP-59）。原生 input，键盘和读屏走浏览器行为，必须传 aria-label 或包在 label 里。
 *
 * <Checkbox aria-label="全选本页" checked={all} indeterminate={some} onChange={…} />
 *
 * indeterminate 是全选时的半选态，只改显示，不改 checked。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes } from "react";

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { indeterminate?: boolean }>(function Checkbox({ indeterminate = false, className, ...rest }, ref) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLInputElement);
  useEffect(() => {
    if (input.current) input.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input ref={input} {...rest} type="checkbox" className={className ? `rd-check ${className}` : "rd-check"} />;
});
