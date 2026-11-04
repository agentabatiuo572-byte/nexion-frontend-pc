/**
 * 表单字段（CP-52、CP-59）。标签弱、控件强，这是什么写在下面一行，错误写在字段下方。
 *
 * <Field label="注入金额" required help="单位 USDT，最多两位小数" error={amountError}>
 *   {(control) => <Input {...control} value={amount} onChange={…} />}
 * </Field>
 * <Check label="计入创世节点收益" help="每日收益算进到期金额" checked={on} onChange={…} />
 * <CheckGroup legend="计入哪些应付款" summary="9/9 开启"><Check … /><Check … /></CheckGroup>
 *
 * - Field 用 render 函数把 id、aria-describedby、aria-invalid 交给控件。Select 这类自带 aria-label 的控件直接传子元素。
 * - 说明按 DP-31 写：基础档一句话不超过 25 字，加强档再写怎么填和改了会怎样。
 */
import { useId, type InputHTMLAttributes, type ReactNode } from "react";
import { Checkbox } from "./checkbox";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export function Field({ label, help, error, required, children }: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}) {
  const id = useId();
  const described = [help ? `${id}-help` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rd-form-field">
      <label className="rd-form-label" htmlFor={id}>{label}{required && <span className="rd-form-required" aria-hidden>*</span>}</label>
      {typeof children === "function" ? children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined }) : children}
      {help && <div id={`${id}-help`} className="rd-form-help">{help}</div>}
      {error && <div id={`${id}-error`} className="rd-form-error" role="alert">{error}</div>}
    </div>
  );
}

export function Check({ label, help, ...input }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: ReactNode; help?: ReactNode }) {
  const id = useId();
  return (
    <div className="rd-check-item">
      <Checkbox {...input} id={id} aria-describedby={help ? `${id}-help` : undefined} />
      <label htmlFor={id}>{label}</label>
      {help && <div id={`${id}-help`} className="rd-form-help">{help}</div>}
    </div>
  );
}

export function CheckGroup({ legend, summary, help, children }: { legend: ReactNode; summary?: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="rd-check-group">
      <legend>{legend}{summary && <span className="rd-check-summary">{summary}</span>}</legend>
      {help && <div className="rd-form-help">{help}</div>}
      <div className="rd-check-grid">{children}</div>
    </fieldset>
  );
}
