"use client";

/**
 * Pager 分页（CP-36，ST-13、ST-14）。放在表格下面，有数据才渲染：total 为 0 时自己不渲染（加载中也不，没有数据就没有页可翻）；读取失败时页面不要渲染它。
 *
 * <Pager label="提现单" sizeLabel="提现队列" total={rows.total} page={page} pageSize={pageSize} sizes={[10, 20, 50]}
 *   loading={loading} onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} note="已收起 …" />
 *
 * - 文字「第 {page} / {totalPages} 页 · 共 {total} 条」，单页也显示，按钮禁用。
 * - 按钮文字固定「上一页」「下一页」，读屏名带列表名。加载中翻页和「每页条数」都禁用，分页条本身不消失。
 * - 「共 N 条」按千分位写（TX-22）。
 * - 「每页条数」只有原生 disabled：加载中它被禁用时焦点会掉到页面上，读完把焦点还给它（BUG-746 同一类）。
 * - 加载中和到首页、末页时用 aria-disabled，不用原生 disabled：键盘在「下一页」上按回车后焦点留在这个按钮上，读完也在（ST-56，BUG-746）。
 * - 改每页条数回第 1 页、页码写网址都由页面做（ST-23）。
 */
import { useEffect, useRef, type ReactNode } from "react";
import { fmtNum } from "@/lib/format";
import { Button } from "./button";
import { Select } from "./select";

export function Pager({ label, sizeLabel, total, page, pageSize, sizes, loading = false, note, onPage, onPageSize }: {
  label: string;
  sizeLabel?: string;
  total: number;
  page: number;
  pageSize: number;
  sizes: readonly number[];
  loading?: boolean;
  note?: ReactNode;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const sizeBox = useRef<HTMLSpanElement>(null);
  /** 焦点在「每页条数」上时开始读取：读完把焦点还回去。只在焦点因为禁用掉到页面上时才还，人自己移走的不管。 */
  const sizeFocused = useRef(false);
  const loadingNow = useRef(loading);
  loadingNow.current = loading;
  useEffect(() => {
    if (loading || !sizeFocused.current) return;
    const active = document.activeElement;
    if (!active || active === document.body) sizeBox.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    // 这次读完焦点在哪就记哪：焦点已经去了别处时清掉标记，下次读取结束不会把焦点抢回来。
    sizeFocused.current = !!sizeBox.current?.contains(document.activeElement);
  }, [loading]);
  if (total <= 0) return null;
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  return (
    <div className="rd-pager" data-list-pager="" data-list-label={label}>
      <span className="rd-pager-range">第 {page} / {pages} 页 · 共 {fmtNum(total)} 条</span>
      {note && <span className="rd-pager-note">{note}</span>}
      <div className="rd-pager-tools">
        <span ref={sizeBox} className="rd-pager-size" onFocus={() => { sizeFocused.current = true; }} onBlur={() => { if (!loadingNow.current) sizeFocused.current = false; }}>
          <Select aria-label={`${sizeLabel ?? label}每页条数`} value={String(pageSize)} disabled={loading} onChange={(value) => onPageSize(Number(value))}
            options={sizes.map((size) => ({ value: String(size), label: `${size} 条/页` }))} />
        </span>
        <Button size="sm" aria-label={`${label} 上一页`} aria-disabled={loading || page <= 1} onClick={() => onPage(page - 1)}>上一页</Button>
        <Button size="sm" aria-label={`${label} 下一页`} aria-disabled={loading || page >= pages} onClick={() => onPage(page + 1)}>下一页</Button>
      </div>
    </div>
  );
}
