"use client";

/**
 * 表格（CP-35、CP-85）。结构件写法，默认 6 列（含操作列），每格最多两行，表头不排序。
 *
 * const columns = useTableColumns("d2-queue", [
 *   { key: "no", label: "提现单", locked: "第一列不能关" },
 *   { key: "user", label: "用户" },
 *   { key: "amount", label: "金额" },
 *   { key: "risk", label: "风险", locked: "风险列不能收走" },
 *   { key: "status", label: "状态" },
 *   { key: "action", label: "操作", locked: "操作列不能关" },
 *   { key: "chain", label: "收款链", extra: true },   // extra：默认不显示，进「显示更多列」
 * ]);
 *
 * <Panel title="待审核提现" flush actions={<ColumnPicker columns={columns} />}>
 *   <Table label="待审核提现">
 *     <thead><tr>
 *       <Th sticky="start">提现单 · 时间</Th>
 *       <Th icon={User} tone="users">用户</Th>
 *       <Th align="right" icon={Coins} tone="money">金额（USDT）</Th>
 *       {columns.isVisible("chain") && <Th>收款链</Th>}
 *       <Th sticky="end">操作</Th>
 *     </tr></thead>
 *     <tbody>
 *       {rows.map((row) => (
 *         <Tr key={row.id} selected={row.id === current} onOpen={() => open(row.id)}>
 *           <Td sticky="start"><Cell mono main={row.no} sub={row.time} title={row.no} /></Td>
 *           <Td align="right"><Cell num main="12,480.00" sub="到账 12,417.60" /></Td>
 *           <Td sticky="end"><Button size="sm" onClick={…}>放行</Button></Td>
 *         </Tr>
 *       ))}
 *     </tbody>
 *   </Table>
 * </Panel>
 *
 * - 可点的行传 onOpen：Tab 能到，Enter、Space 打开，行内按钮、链接、输入不触发（ST-06、OP-06）。
 * - 详情开着时给当前行传 selected：抽屉浮在列表上，这一行保持高亮，抽屉关上才取消（PG-63）。
 *   上一条下一条切到视口外的行时自动滚过去。默认列按列表占满宽度定，不给抽屉留宽度。
 * - 对齐按 ST-02：文字、状态、操作左对齐，金额、数量、百分比 align="right"。空值写「—」。
 * - 加载用 <TableLoading columns={n} />；空和失败用 <TableMessage columns={n}>…</TableMessage> 放表体，
 *   失败不写「暂无数据」（T09）。
 * - 列选择只影响显示，不影响导出列和读取请求（ST-03）。按账号和表格记在 localStorage。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type HTMLAttributes, type KeyboardEvent, type MouseEvent, type ReactNode, type TdHTMLAttributes, type ThHTMLAttributes } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Columns3, type LucideIcon } from "lucide-react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { Button } from "./button";
import type { DomainTone } from "./tone";

const INTERACTIVE = "a, button, input, select, textarea, label, summary, [role='button'], [role='checkbox'], [role='menuitem'], [role='combobox']";

/** rowFocus：行本身是一组单选，Tab 只停在当前行，滚动区不再占一个停靠点。 */
export function Table({ label, rowFocus, children, className, ...rest }: HTMLAttributes<HTMLTableElement> & { label: string; rowFocus?: boolean }) {
  return (
    <div className="rd-table-scroll" role="region" aria-label={label} tabIndex={rowFocus ? undefined : 0}>
      <table {...rest} className={className ? `rd-table ${className}` : "rd-table"}>{children}</table>
    </div>
  );
}

/** control 是勾选这类控件列，不是数据列，不算进默认 6 列。 */
export function Th({ align, sticky, control, icon: Icon, tone, children, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; sticky?: "start" | "end"; control?: boolean; icon?: LucideIcon; tone?: DomainTone }) {
  return (
    <th {...rest} scope={rest.scope ?? "col"} data-cp={control ? undefined : "column"} data-control={control ? "" : undefined} data-align={align} data-sticky={sticky}>
      <span className="rd-th-inner">
        {Icon && <span className="rd-th-icon" data-tone={tone ?? "system"}><Icon size={13} strokeWidth={1.9} aria-hidden /></span>}
        {children}
      </span>
    </th>
  );
}

export function Td({ align, sticky, children, ...rest }: TdHTMLAttributes<HTMLTableCellElement> & { align?: "left" | "right"; sticky?: "start" | "end" }) {
  return <td {...rest} data-align={align} data-sticky={sticky}>{children}</td>;
}

export function Tr({ selected, onOpen, children, onClick, onKeyDown, ...rest }: HTMLAttributes<HTMLTableRowElement> & { selected?: boolean; onOpen?: () => void }) {
  const rowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const fromControl = (event: MouseEvent<HTMLTableRowElement> | KeyboardEvent<HTMLTableRowElement>) =>
    event.target instanceof Element && event.target !== event.currentTarget && event.target.closest(INTERACTIVE) !== null;
  return (
    <tr
      {...rest}
      ref={rowRef}
      tabIndex={rest.tabIndex ?? (onOpen ? 0 : undefined)}
      aria-current={selected ? "true" : undefined}
      data-selected={selected ? "" : undefined}
      data-clickable={onOpen ? "" : undefined}
      onClick={(event) => {
        onClick?.(event);
        if (onOpen && !event.defaultPrevented && !fromControl(event)) onOpen();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!onOpen || event.defaultPrevented || fromControl(event)) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      {children}
    </tr>
  );
}

/** 一格两行：第一行主值，第二行弱化。长文本单行省略，title 给全文，只是显示截断（ST-04）。单号这类不能截短的传 full（TX-28）。
 *  mono 只给单号、哈希、地址（等宽字体）；金额、数量、日期传 num（Inter 等宽数字，VS-52）。 */
export function Cell({ main, sub, mono, num, title, full }: { main: ReactNode; sub?: ReactNode; mono?: boolean; num?: boolean; title?: string; full?: boolean }) {
  return (
    <span className="rd-cell" data-mono={mono ? "" : undefined} data-num={num ? "" : undefined} data-full={full ? "" : undefined} title={title}>
      <span className="rd-cell-main">{main}</span>
      {sub !== undefined && sub !== null && <span className="rd-cell-sub">{sub}</span>}
    </span>
  );
}

export function TableLoading({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row} aria-hidden>
          {Array.from({ length: columns }, (_, column) => <td key={column}><span className="rd-skeleton" /></td>)}
        </tr>
      ))}
    </>
  );
}

export function TableMessage({ columns, role, children }: { columns: number; role?: "status" | "alert"; children: ReactNode }) {
  return <tr><td colSpan={columns}><div className="rd-table-message" role={role}>{children}</div></td></tr>;
}

export interface TableColumn {
  key: string;
  label: string;
  /** 默认不显示，进「显示更多列」。 */
  extra?: boolean;
  /** 不能关的列写原因：第一列、操作列、风险和阻断列（DP-03）。 */
  locked?: string;
}

export interface TableColumns {
  all: readonly TableColumn[];
  extraSelected: number;
  isVisible: (key: string) => boolean;
  toggle: (key: string) => void;
  reset: () => void;
}

function storageKey(adminId: number | undefined, tableId: string) {
  return `nexion-admin-table-columns-v1:${adminId ?? "anonymous"}:${tableId}`;
}

function defaultHidden(columns: readonly TableColumn[]) {
  return columns.filter((column) => column.extra).map((column) => column.key);
}

function readHidden(key: string, columns: readonly TableColumn[]): string[] {
  try {
    const saved: unknown = JSON.parse(window.localStorage.getItem(key) ?? "null");
    if (!Array.isArray(saved)) return defaultHidden(columns);
    const known = new Set(columns.filter((column) => !column.locked).map((column) => column.key));
    const hidden = saved.filter((item): item is string => typeof item === "string" && known.has(item));
    return hidden.length === saved.length ? hidden : defaultHidden(columns);
  } catch {
    return defaultHidden(columns);
  }
}

export function useTableColumns(tableId: string, columns: readonly TableColumn[]): TableColumns {
  const adminId = useAdminAuth((state) => state.session?.adminId);
  const key = storageKey(adminId, tableId);
  const [hidden, setHidden] = useState<string[]>(() => defaultHidden(columns));
  // columns 由调用方每次新建，这里只在账号或表格变化时重读。
  useEffect(() => setHidden(readHidden(key, columns)), [key]);
  const save = useCallback((next: string[]) => {
    setHidden(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // 存不下时本次会话仍按用户选择显示，下次回到默认列。
    }
  }, [key]);
  return useMemo(() => ({
    all: columns,
    extraSelected: columns.filter((column) => column.extra && !hidden.includes(column.key)).length,
    isVisible: (column: string) => !hidden.includes(column),
    toggle: (column: string) => save(hidden.includes(column) ? hidden.filter((item) => item !== column) : [...hidden, column]),
    reset: () => {
      setHidden(defaultHidden(columns));
      try {
        window.localStorage.removeItem(key);
      } catch {
        // 同上，只影响下次打开。
      }
    },
  }), [columns, hidden, key, save]);
}

/** 「显示更多列 · 已选 {n}」。Esc 收起回到按钮。 */
export function ColumnPicker({ columns }: { columns: TableColumns }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button variant="ghost" size="sm" icon={<Columns3 size={14} aria-hidden />} aria-expanded={open}>
          显示更多列 · 已选 {columns.extraSelected}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="rd-pop" align="end" sideOffset={6} collisionPadding={12}>
          <div className="rd-col-list" role="group" aria-label="选择显示的列">
            {columns.all.map((column) => (
              <label key={column.key} className="rd-col-option" data-locked={column.locked ? "" : undefined} title={column.locked}>
                <input type="checkbox" checked={columns.isVisible(column.key)} disabled={Boolean(column.locked)} onChange={() => columns.toggle(column.key)} />
                {column.label}
              </label>
            ))}
          </div>
          <div className="rd-col-foot"><Button variant="ghost" size="sm" onClick={columns.reset}>恢复默认</Button></div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
