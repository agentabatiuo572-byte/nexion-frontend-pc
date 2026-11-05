"use client";

/**
 * 筛选条（CP-61、CP-86）。从左到右固定：范围控件 → 搜索框 → 其他筛选 → 更多筛选 → 查询 → 清除筛选 → 排序（ST-15）。
 *
 * <FilterBar
 *   scope={<Segments … />}                        范围控件，选中立即查询，不等「查询」
 *   onSubmit={query} querying={loading}           Enter 等于查询；查询中只禁「查询」，条件照常能改
 *   onClear={clearAll} canClear={hasFilters}      没有条件时禁用
 *   more={<>…更多筛选里的字段…</>} moreCount={2}    数量只算已应用的条件
 *   onClearMore={clearMore}                       局部清除，只有 D2 这类页面传
 *   sort={<Select … />}
 *   result="共 128 条"
 *   applied={[{ key: "min", label: "金额 ≥ 1000", onRemove: … }]}
 *   notice="最低风险分须为 0–100 的整数。这次没有查询。"   条件不合法时写在这里，更多筛选收着也看得到（ST-19）
 * >
 *   <FilterField grow><Input aria-label="搜索提现" placeholder="输入提现单号、用户编号或昵称" … /></FilterField>
 * </FilterBar>
 *
 * - 默认露 3 个：范围控件、搜索框、普通筛选都算，按钮和排序不算（DP-14）。
 * - 查询区在加载、空、失败时都不消失，失败只换表格内容。
 * - 更多筛选收起时内容留在页面上，已填的值不丢；条件条在收起时也看得到。
 * - 网址读写由页面做（ST-23），组件不碰。
 */
import { forwardRef, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { Filter, X } from "lucide-react";
import { Button } from "./button";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={className ? `rd-input ${className}` : "rd-input"} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} {...rest} className={className ? `rd-input rd-textarea ${className}` : "rd-input rd-textarea"} />;
});

export function FilterField({ label, grow, children }: { label?: ReactNode; grow?: boolean; children: ReactNode }) {
  return (
    <div data-cp="filter" className={grow ? "rd-filter-grow" : undefined}>
      {label ? <label className="rd-field">{label}{children}</label> : children}
    </div>
  );
}

export function FilterBar({ scope, children, more, moreCount = 0, onClearMore, onSubmit, querying = false, onClear, canClear = false, clearLabel = "清除筛选", sort, result, applied, notice }: {
  scope?: ReactNode;
  children?: ReactNode;
  more?: ReactNode;
  moreCount?: number;
  onClearMore?: () => void;
  onSubmit?: () => void;
  querying?: boolean;
  onClear?: () => void;
  canClear?: boolean;
  clearLabel?: string;
  sort?: ReactNode;
  result?: ReactNode;
  applied?: readonly { key: string; label: ReactNode; onRemove: () => void }[];
  notice?: ReactNode;
}) {
  const moreId = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!querying) onSubmit?.();
  };
  return (
    <form className="rd-filter" onSubmit={submit} role="search">
      <div className="rd-filter-row">
        {scope}
        {children}
        {more && (
          <Button icon={<Filter size={14} aria-hidden />} aria-expanded={moreOpen} aria-controls={moreId} onClick={() => setMoreOpen((open) => !open)}>
            {moreCount > 0 ? `更多筛选 · ${moreCount}` : "更多筛选"}
          </Button>
        )}
        {onSubmit && <Button type="submit" disabled={querying}>查询</Button>}
        {onClear && <Button variant="ghost" disabled={!canClear} onClick={onClear}>{clearLabel}</Button>}
        {sort}
      </div>
      {more && (
        <div id={moreId} className="rd-filter-more" hidden={!moreOpen}>
          {more}
          {onClearMore && <div><Button variant="ghost" size="sm" onClick={onClearMore}>清除更多筛选</Button></div>}
        </div>
      )}
      {(Boolean(applied?.length) || result) && (
        <div className="rd-filter-row">
          {Boolean(applied?.length) && (
            <div className="rd-filter-chips">
              {applied?.map((item) => (
                <span key={item.key} className="rd-chip">
                  {item.label}
                  <button type="button" className="rd-chip-x" aria-label={`移除条件 ${typeof item.label === "string" ? item.label : item.key}`} onClick={item.onRemove}><X size={12} aria-hidden /></button>
                </span>
              ))}
            </div>
          )}
          {result && <span className="rd-filter-result" role="status">{result}</span>}
        </div>
      )}
      {notice && <p className="rd-filter-notice" role="alert">{notice}</p>}
    </form>
  );
}
