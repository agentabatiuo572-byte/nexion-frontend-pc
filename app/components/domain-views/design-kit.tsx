"use client";

/**
 * 设计稿内容层共享原语(从设计稿 admin-shell.jsx 移植为 TSX)。
 * 配合 .dkpage 作用域 CSS(globals.css)复刻设计稿内容页富布局。
 * 适配:Modal/Drawer 补 ESC+聚焦+点遮罩关闭(a11y 铁律);OperationConfirmModal 负责高敏操作确认 + 理由留痕;
 * 跨域跳转用 next/navigation。导航/外壳仍沿用本项目 shell。
 */
import { businessZone } from "@/lib/admin/business-time";
import { Fragment, isValidElement, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode, type CSSProperties, type FocusEvent } from "react";
import { useRouter } from "next/navigation";
import { AutoGloss } from "@/app/components/kit/gloss";
import { announcePermissionDenied, isPermissionDenied, operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import { useUI, type ToastKind } from "@/lib/store/ui";
import { useDialogFeedback } from "@/app/components/kit/dialog-feedback";
import { ToastHost } from "@/app/components/kit/toast-host";
import { fmtConfigPct, fmtPct } from "@/lib/format";
import { i6CopyQualityIssues } from "@/lib/admin/i6-copy-quality";
import { fetchA2ReasonPolicy, isA2OutcomeUncertainError, visibleReasonLength } from "@/lib/admin/a2-client";
import { uploadAdminMedia, uploadD1VietQrReceiptEvidence } from "@/lib/admin/media-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { isOptionalTrustLinkField, validateTrustSectionTrilingualFields } from "@/lib/admin/trust-section-validation";
import { isL5KpiExport, l5KpiRange, L5_KPI_WINDOWS, l5BusinessToday } from "./l-tabs/l5-kpi-range";
import { Check as RdCheck, CheckGroup as RdCheckGroup, Field as RdField } from "@/app/components/rd/field";
import { Fold as RdFold } from "@/app/components/rd/fold";
import { Button as RdButton, type ButtonVariant } from "@/app/components/rd/button";
import { Select as RdSelect } from "@/app/components/rd/select";
import { DiffField } from "@/app/components/rd/diff-list";
import { Explain } from "@/app/components/rd/explain";
import { Notice as RdNotice } from "@/app/components/rd/block-state";
import { StatusTag as RdStatusTag } from "@/app/components/rd/status-tag";
import { Modal as RdModal } from "@/app/components/rd/overlay";
import { NumberInput as RdNumberInput } from "@/app/components/rd/number-input";
import { useRdSurface } from "@/app/components/rd/surface";
import { KeepText } from "@/app/components/rd/keep-text";
import { Input as RdInput } from "@/app/components/rd/filter-bar";
import { Fact as RdFact, Facts as RdFacts } from "@/app/components/rd/facts";

/* ---------------- 域 → 落地路由(ctx.navigate 跨域跳转) ---------------- */
export const DOMAIN_HOME: Record<string, string> = {
  A: "/platform/rbac", B: "/", C: "/users/search", D: "/finance/withdrawals",
  E: "/devices/pricing", F: "/network/v-rank", G: "/finance-products/staking",
  H: "/growth/phase", I: "/content/copy-ab", J: "/emergency/kill-switch",
  K: "/risk/multi-account", L: "/analytics/kpi",
};

/* ---------------- Icons(设计稿线性字形,name-based) ---------------- */
export type IconName =
  | "gauge" | "shield" | "users" | "wallet" | "radar" | "rhythm" | "box" | "tree"
  | "coin" | "doc" | "power" | "chart" | "search" | "bell" | "menu" | "chevron"
  | "check" | "x" | "alert" | "download" | "plus" | "filter" | "eye" | "lock"
  | "arrow" | "flame" | "geo" | "clock" | "image" | "sliders";

export function Icon({ name, size = 18, sw = 1.7 }: { name: IconName; size?: number; sw?: number }) {
  const paths: Record<IconName, ReactNode> = {
    gauge: <><path d="M12 13l4-4" /><circle cx="12" cy="13" r="8" /><path d="M4 13a8 8 0 0116 0" /></>,
    shield: <><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0" /><path d="M16 6a3 3 0 010 6" /><path d="M21 19a5 5 0 00-4-5" /></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><circle cx="16.5" cy="13.5" r="1.2" /></>,
    radar: <><circle cx="12" cy="12" r="8.5" /><path d="M12 12l5-3" /><path d="M12 12a4 4 0 104 4" /></>,
    rhythm: <><path d="M4 12h3l2-6 4 14 2-8h5" /></>,
    box: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" /></>,
    tree: <><circle cx="12" cy="5" r="2.4" /><circle cx="6" cy="18" r="2.4" /><circle cx="18" cy="18" r="2.4" /><path d="M12 7.4v4M12 11.4L6 15.6M12 11.4l6 4.2" /></>,
    coin: <><ellipse cx="12" cy="7" rx="7" ry="3.2" /><path d="M5 7v6c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2V7" /><path d="M5 13c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2" /></>,
    doc: <><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /><path d="M9 12h6M9 16h6" /></>,
    power: <><path d="M12 4v8" /><path d="M7 7a7 7 0 1010 0" /></>,
    chart: <><path d="M4 20V4" /><path d="M4 20h16" /><rect x="7" y="12" width="3" height="5" /><rect x="12" y="8" width="3" height="9" /><rect x="17" y="5" width="3" height="12" /></>,
    search: <><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-3.5-3.5" /></>,
    bell: <><path d="M6 9a6 6 0 1112 0c0 5 2 6 2 6H4s2-1 2-6z" /><path d="M10 20a2 2 0 004 0" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    chevron: <><path d="M9 6l6 6-6 6" /></>,
    check: <><path d="M5 12l4 4 10-10" /></>,
    x: <><path d="M6 6l12 12M18 6L6 18" /></>,
    alert: <><path d="M12 4l9 16H3z" /><path d="M12 10v5M12 18h.01" /></>,
    download: <><path d="M12 4v11m0 0l-4-4m4 4l4-4" /><path d="M4 19h16" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    filter: <><path d="M4 5h16l-6 8v5l-4 2v-7z" /></>,
    eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="2.6" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    flame: <><path d="M12 3c1 4-3 5-3 9a3 3 0 006 0c0-2-1-3-1-3 2 1 3 3 3 5a6 6 0 11-12 0c0-5 5-6 7-11z" /></>,
    geo: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
    clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></>,
    image: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.6" /><path d="M21 16l-5-5-7 7" /></>,
    sliders: <><path d="M21 5h-7M10 5H3M21 12h-9M8 12H3M21 19h-5M12 19H3" /><path d="M14 3v4M8 10v4M16 17v4" /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  );
}

/* ---------------- Primitives ---------------- */
type AnyProps = Record<string, unknown>;

export const Card = ({ children, className = "", ...rest }: { children?: ReactNode; className?: string } & AnyProps) => (
  <div className={"card " + className} {...rest}>{children}</div>
);

export const CardH = ({ title, sub, more, onMore, right }: { title: ReactNode; sub?: ReactNode; more?: ReactNode; onMore?: () => void; right?: ReactNode }) => (
  <div className="card-h">
    <div><span className="ttl">{title}</span>{sub && <span className="sub"> · <AutoGloss>{sub}</AutoGloss></span>}</div>
    {right}
    {more && <a className="more" onClick={onMore}>{more}</a>}
  </div>
);

export const CodeTag = ({ tone, title, children }: { tone?: string; title?: string; children: ReactNode }) => (
  <span className={"code-tag " + (tone || "") + (title ? " has-tip" : "")} data-tip={title || undefined}>{children}</span>
);

export const Chip = ({ sel, tab, disabled, onClick, children }: { sel?: boolean; tab?: boolean; disabled?: boolean; onClick?: () => void; children: ReactNode }) => {
  const className = "chip " + (tab ? "tab " : "") + (sel ? "sel" : "");
  return tab ? (
    <button type="button" className={className} aria-pressed={!!sel} disabled={disabled} onClick={onClick}>{children}</button>
  ) : (
    <span className={className}>{children}</span>
  );
};

export const Badge = ({ tone = "neutral", children }: { tone?: string; children: ReactNode }) => (
  <span className={"badge-s " + tone}>{children}</span>
);

/* 改版页面里就是 rd 按钮，弹窗底栏和页面只有一套样子（DT-22）；旧页面不变。 */
export const Btn = ({ variant, sm, children, ...rest }: { variant?: string; sm?: boolean; children: ReactNode } & AnyProps) => {
  const surface = useRdSurface();
  return surface
    ? <RdButton variant={(variant || "secondary") as ButtonVariant} size={sm ? "sm" : "md"} {...rest}>{children}</RdButton>
    : <button className={"btn " + (variant || "") + (sm ? " sm" : "")} {...rest}>{children}</button>;
};

export const Toggle = ({ on, danger, onClick }: { on?: boolean; danger?: boolean; onClick?: () => void }) => (
  <div className={"sw " + (on ? "on " : "") + (danger && on ? "danger-on" : "")} onClick={onClick} role="switch" aria-checked={!!on} />
);

export const Meter = ({ pct, color }: { pct: number; color?: string }) => (
  <div className="meter"><div className="fill" style={{ width: pct + "%", background: color || "var(--brand)" }} /></div>
);

/* ---------------- Data list pagination ---------------- */
export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

export function useDataListPager<T>(
  rows: T[],
  {
    initialPageSize = 10,
    resetKey,
  }: {
    initialPageSize?: number;
    resetKey?: string | number | boolean;
  } = {},
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);

  useEffect(() => {
    setPage((current) => Math.min(Math.max(1, current), pageCount));
  }, [pageCount]);

  const startIndex = total === 0 ? 0 : (page - 1) * pageSize;
  const endIndex = total === 0 ? 0 : Math.min(total, startIndex + pageSize);
  const pageRows = useMemo(() => rows.slice(startIndex, endIndex), [rows, startIndex, endIndex]);
  const setPageSize = (next: number) => {
    setPageSizeState(next);
    setPage(1);
  };

  return { page, setPage, pageSize, setPageSize, total, pageCount, startIndex, endIndex, pageRows };
}

export function DataListPager({
  label,
  page,
  pageSize,
  total,
  rawTotal,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [...DEFAULT_PAGE_SIZE_OPTIONS],
}: {
  label: string;
  page: number;
  pageSize: number;
  total: number;
  rawTotal?: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = total === 0 ? 0 : Math.min(total, page * pageSize);
  const btnBase = {
    border: "1px solid var(--border-strong)",
    background: "var(--surface-2)",
    color: "var(--ink-2)",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 600,
  };
  const disabled = { opacity: 0.45, cursor: "not-allowed" };
  return (
    <div
      data-list-pager="true"
      data-list-label={label}
      aria-label={`${label} 分页`}
      className="data-list-pager"
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 10,
        padding: "12px 14px",
        borderTop: "1px solid var(--border)",
        background: "var(--surface-2)",
      }}
    >
      <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>
        {label} · 显示 {start}-{end} / 筛选后 {total} 条{rawTotal !== undefined && rawTotal !== total ? ` · 总数 ${rawTotal} 条` : ""}
      </span>
      <label className="row" style={{ gap: 6, marginLeft: "auto", color: "var(--ink-3)", fontSize: 12 }}>
        每页
        <select
          className="pager-page-size"
          aria-label={`${label} 每页条数`}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
            color: "var(--ink)",
            borderRadius: 8,
            padding: "5px 9px",
            fontSize: 12,
          }}
        >
          {pageSizeOptions.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <button
        type="button"
        aria-label={`${label} 上一页`}
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
        style={page <= 1 ? { ...btnBase, ...disabled } : btnBase}
      >
        上一页
      </button>
      <span className="mono" style={{ color: "var(--ink-3)", fontSize: 12 }}>
        第 {page} / {pageCount} 页
      </span>
      <button
        type="button"
        aria-label={`${label} 下一页`}
        disabled={page >= pageCount}
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
        style={page >= pageCount ? { ...btnBase, ...disabled } : btnBase}
      >
        下一页
      </button>
    </div>
  );
}

type PaginationExemptionKind = "static-small" | "sample-ledger" | "reference-catalog" | "fixed-matrix";
type PaginationExemptionItem = {
  label: string;
  reason: string;
  maxRows: number;
  kind?: PaginationExemptionKind;
};

export function PaginationExemption({
  label,
  reason,
  maxRows,
  kind = "static-small",
}: {
  label: string;
  reason: string;
  maxRows: number;
  kind?: PaginationExemptionKind;
}) {
  const kindLabel: Record<PaginationExemptionKind, string> = {
    "static-small": "固定小列表",
    "sample-ledger": "摘要台账",
    "reference-catalog": "参考目录",
    "fixed-matrix": "固定对照矩阵",
  };
  return (
    <div
      data-pagination-exempt="true"
      data-pagination-label={label}
      data-pagination-reason={reason}
      data-pagination-max-rows={maxRows}
      data-pagination-kind={kind}
      className="pagination-exempt"
      // Developer note for the list-pagination audit only; operators don't need to see why a short list isn't paged.
      hidden
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--surface-2)",
        color: "var(--ink-4)",
        fontSize: 11.5,
        padding: "9px 12px",
      }}
    >
      <b>同屏展示</b> · {label} · {kindLabel[kind]} · 最多 {maxRows} 行 · {reason}
    </div>
  );
}

export function PaginationExemptionList({ items }: { items: PaginationExemptionItem[] }) {
  return (
    <div className="pagination-exemption-list">
      {items.map((item) => (
        <PaginationExemption key={`${item.label}-${item.maxRows}-${item.kind ?? "static-small"}`} {...item} />
      ))}
    </div>
  );
}

export function Stat({ k, v, sub, delta, deltaDir, icon }: { k: ReactNode; v: ReactNode; sub?: ReactNode; delta?: ReactNode; deltaDir?: string; icon?: IconName }) {
  return (
    <div className="stat">
      <div className="k">{icon && <Icon name={icon} size={13} />}<AutoGloss>{k}</AutoGloss></div>
      <div className="v">{v}{sub && <small> <AutoGloss>{sub}</AutoGloss></small>}</div>
      {delta && <div className={"delta " + (deltaDir || "flat")}>{delta}</div>}
    </div>
  );
}

export function Sparkline({ data, color = "var(--brand)", fill = false, h = 44 }: { data: number[]; color?: string; fill?: boolean; h?: number }) {
  const w = 120;
  const min = Math.min(...data), max = Math.max(...data);
  const rng = max - min || 1;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * w, h - 4 - ((d - min) / rng) * (h - 10)]);
  const path = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = path + ` L${w} ${h} L0 ${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      {fill && <path d={area} fill={color} opacity="0.10" />}
      <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const KV = ({ k, v }: { k: ReactNode; v: ReactNode }) => (
  <div className="kv"><span className="k"><AutoGloss>{k}</AutoGloss></span><span className="v">{v}</span></div>
);

/* Modal — 补 ESC 关闭 + 打开聚焦(a11y 铁律) */
type ModalProps = { title: ReactNode; icon?: IconName; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; busy?: boolean; dirty?: boolean; className?: string; style?: CSSProperties;
  /** 只在改版页面起作用：标题下的后果标签，和标题前图标底的颜色（VS-101、VS-106）。 */
  sub?: ReactNode; tone?: "danger" | "neutral" };

const legacy = ({ sub: _sub, tone: _tone, ...rest }: Omit<ModalProps, "icon">) => rest;

/* 改版页面(RdPage 里)走 Radix 弹窗和新外观,能叠在新抽屉上;旧页面走原来的实现,行为不变。 */
export function Modal({ icon, ...props }: ModalProps) {
  const surface = useRdSurface();
  return surface
    ? <RdModal {...props} icon={icon && <Icon name={icon} size={16} />} />
    : <LegacyModal {...legacy(props)} icon={icon} />;
}

function LegacyModal({ title, icon, onClose, children, footer, wide, busy = false, className }: Omit<ModalProps, "sub" | "tone">) {
  const feedbackId = useDialogFeedback();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy && e.target instanceof Element && e.target.closest('[role="dialog"]') === ref.current) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onClose]);
  // 仅在打开(mount)时聚焦一次:绝不放进 [onClose] effect,否则父组件每次渲染(输入框 onChange 改父 state → 新 inline onClose)都会重跑 focus() 抢回容器焦点 → 输入框打一个字就失焦。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="dkpage">
    <div className="modal-scrim" onClick={() => { if (!busy) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId} className={className ? `modal ${className}` : "modal"} style={wide ? { maxWidth: 680, outline: "none" } : { outline: "none" }} onClick={(e) => e.stopPropagation()} onKeyDown={(event) => {
        if (event.key !== "Tab" || !ref.current) return;
        const controls = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex="0"]')].filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === ref.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }}>
        <div className="modal-h">
          {icon && <span className="icon-btn" style={{ border: 0, background: "var(--brand-soft)", color: "var(--brand)" }}><Icon name={icon} size={16} /></span>}
          <span id={titleId} className="ttl">{title}</span>
          <div className="spacer" />
          <button className="icon-btn" disabled={busy} onClick={onClose} aria-label="关闭"><Icon name="x" size={16} /></button>
        </div>
        <ToastHost dialogId={feedbackId} />
        <div className="modal-b">{children}</div>
        {footer && <div className="modal-f">{footer}</div>}
      </div>
    </div>
    </div>
  );
}

/* Drawer — 补 ESC 关闭 + 打开聚焦(a11y 铁律) */
export function Drawer({ title, sub, onClose, children, footer, wide }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && e.target instanceof Element && e.target.closest('[role="dialog"]') === ref.current) onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 仅在打开(mount)时聚焦一次:绝不放进 [onClose] effect,否则父组件每次渲染(输入框 onChange 改父 state → 新 inline onClose)都会重跑 focus() 抢回容器焦点 → 输入框打一个字就失焦。
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  return (
    <div className="dkpage">
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className="drawer" style={{ outline: "none", ...(wide ? { width: "min(1180px, 96vw)" } : {}) }} onKeyDown={(event) => {
        if (event.key !== "Tab" || !ref.current) return;
        const controls = [...ref.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex="0"]')].filter(element => !element.matches(":disabled") && element.getClientRects().length > 0);
        if (!controls.length) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === ref.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
      }}>
        <div className="drawer-h">
          <div><div id={titleId} style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{title}</div>{sub && <div className="muted tiny">{sub}</div>}</div>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={16} /></button>
        </div>
        <div className="drawer-b">{children}</div>
        {footer && <div className="drawer-f">{footer}</div>}
      </div>
    </div>
  );
}

/* ───────── 共享消息线程(M 客服中心工单/会话坐席台 + dock 复用) ─────────
   helpdesk 富气泡:头像 + 角色标签(客服/顾问/客户) + 名字 + VIP + 时间 + script + 气泡 + 可选 CTA。
   归一 author/sender · body/text 字段差;rich 字段全可选,只传 {ts,fromAgent,body} 也能渲染。 */
export interface ThreadCta {
  kind: "product" | "link";
  title?: string;
  subtitle?: string;
  price?: string;
  priceNote?: string;
  badge?: string;
  icon?: IconName;
  label?: string;
  onClick?: () => void;
}
export interface ThreadMessage {
  ts: number;
  fromAgent: boolean; // 工单 author==="agent" / 会话 sender==="agent"
  agentName?: string;
  body: string; // 工单 body / 会话 text
  ctaHref?: string; // legacy 简单 CTA(保留兼容)
  // ---- rich(可选)----
  system?: boolean; // 系统消息(居中 pill)
  role?: "support" | "advisor" | "user"; // 角色标签 + 配色
  senderName?: string; // 显示名(覆盖 agentName / "User")
  vlevel?: string; // 用户 VIP chip
  scriptTag?: string; // 话术标记
  cta?: ThreadCta; // 富 CTA(产品卡 / 链接)
  receipt?: string; // 送达回执(已读 / 未读)—— 仅最后一条坐席消息由调用方填,镜像前端 iMessage 惯例
}

// 真人头像(对齐设计稿 Avatar):按名字猜性别 → randomuser.me;name-hash 取固定编号;加载失败露首字母。
const MT_FEMALE = /Mia|Sarah|Marina|Linda|Lisa|Emma|Olivia|Anna|Lily|Yuki|Naoko|Hina|Aria|Sofia|Chloe|Grace|Mei|Aisha|晨曦|雨琦|心月|樱桃|琴|梦|妮|婷|玲|霖|媛|莲/i;
export function photoUrl(name?: string): string {
  const n = name ?? "";
  let h = 0;
  for (let i = 0; i < n.length; i += 1) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return `https://randomuser.me/api/portraits/${MT_FEMALE.test(n) ? "women" : "men"}/${h % 90}.jpg`;
}
// accentVar/role/senderName/vlevel/scriptTag 仍在 props 类型中(兼容旧调用),Telegram 样式不再每条显头像/名字/角色,故不读。
// resetKey(会话 id)变 → 本次渲染不 pop(切会话时历史消息不飞入);同 key 下新增的消息(index ≥ 上次长度)才 msg-pop 飞入。
// agentName 传入 → 顶部右侧显「接待{handlerRole} · {agentName}」(Telegram 式不每条显名字时,坐席身份在此一处呈现;handlerRole 区分顾问/客服,缺省客服)。
export function MessageThread({ messages, relWhen, resetKey, agentName, agentAvatar, handlerRole = "客服", typing = false, typingLabel = "对方正在输入…" }: { messages: ThreadMessage[]; relWhen: (ts: number) => string; accentVar?: string; resetKey?: string; agentName?: string; agentAvatar?: ReactNode; handlerRole?: string; typing?: boolean; typingLabel?: string }) {
  const prevLenRef = useRef(messages.length);
  const prevKeyRef = useRef(resetKey);
  let freshFrom = prevLenRef.current;
  if (prevKeyRef.current !== resetKey) freshFrom = messages.length;
  useEffect(() => {
    prevLenRef.current = messages.length;
    prevKeyRef.current = resetKey;
  });
  return (
    <>
      {agentName && (
        <div className="msg-handler">
          {agentAvatar ?? <Icon name="users" size={12} />}
          接待{handlerRole} · {agentName}
        </div>
      )}
      {messages.map((m, i) => {
        if (m.system) {
          return (
            <div key={`${m.ts}-${i}`} className="msg-sys">
              {m.body} · <span className="mono" suppressHydrationWarning>{relWhen(m.ts)}</span>
            </div>
          );
        }
        const isAgent = m.fromAgent;
        const prev = messages[i - 1];
        const grouped = !!prev && !prev.system && prev.fromAgent === isAgent;
        return (
          <div
            key={`${m.ts}-${i}`}
            className={`msg-in msg-tg ${isAgent ? "from-right" : "from-left"}${grouped ? " grouped" : ""}${i >= freshFrom ? " msg-pop" : ""}`}
          >
            <div className="msg-col">
              <div className={`msg-bubble ${isAgent ? "agent" : "user"}`}>
                <span className="msg-text">{m.body}</span>
                <span className="msg-time" suppressHydrationWarning>{relWhen(m.ts)}</span>
              </div>
              {m.cta?.kind === "product" && (
                <button type="button" className="cta-card" onClick={m.cta.onClick}>
                  <span className="cta-thumb">
                    <Icon name={m.cta.icon ?? "box"} size={26} />
                  </span>
                  <span className="cta-info">
                    {m.cta.badge && <span className="cta-badge">{m.cta.badge}</span>}
                    <span className="cta-title">{m.cta.title}</span>
                    <span className="cta-sub">{m.cta.subtitle}</span>
                    {m.cta.price && (
                      <span className="cta-price">
                        <span className="p">{m.cta.price}</span>
                        {m.cta.priceNote && <span className="pn">{m.cta.priceNote}</span>}
                      </span>
                    )}
                  </span>
                  <span className="cta-arrow">
                    <Icon name="arrow" size={16} />
                  </span>
                </button>
              )}
              {m.cta?.kind === "link" && (
                <button type="button" className="chip" style={{ marginTop: 6, cursor: "pointer", color: "var(--m-hd-2)", background: "var(--m-hd-soft)", borderColor: "var(--m-hd-border)" }} onClick={m.cta.onClick}>
                  <Icon name="arrow" size={12} />
                  {m.cta.label}
                </button>
              )}
              {!m.cta && m.ctaHref && m.ctaHref !== "—" && (
                <span className="msg-script" style={{ marginTop: 6 }}>点击后跳转 → {m.ctaHref}</span>
              )}
              {m.receipt && <span className="msg-receipt">{m.receipt}</span>}
            </div>
          </div>
        );
      })}
      {typing && (
        <div className="msg-in msg-tg from-left" role="status" aria-label={typingLabel}>
          <div className="msg-col">
            <div className="msg-bubble user msg-typing">
              <span className="msg-typing-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* 配置型调整的目标新值编辑规格(可选;不传则仅确认动作本身) */
export type EditSpec = { kind?: "number" | "text" | "select" | "toggle"; label?: string; current?: string; initialValue?: string; unit?: string; options?: string[]; optionLabels?: Record<string, ReactNode>; disabledOptions?: string[]; min?: number; max?: number; maxDecimals?: number; step?: number; disallowCurrent?: boolean; /** 清空也是合法的新值时写这个选项的名字，比如「不设上限」。要人点它才算清空，框里什么都没填或填坏了都不算。 */ emptyOption?: string; /** 怎么填，只在 RdPage 里显示（CP-87）。 */ hint?: ReactNode; /** 改了会怎样，随输入变化，只在 RdPage 里显示。 */ preview?: (value: string) => ReactNode; /** 范围之外的校验，比如和别的参数的关系：返回原因就不能提交，写在字段下。 */ validate?: (value: string) => string | undefined; amplifiesWhen?: "increase" | "decrease" | { from: string; to: string } | ((value: string) => boolean); submitEditValue?: boolean };
export type BusinessFormValue = Record<string, string>;
type RoleOption = { key: string; label: string; scope?: string };
type PermissionRole = { key: string; label: string; current: string };
type NotifyTemplateOption = { value: string; label: string; campaignNo?: string; meta?: string; tier?: string; status?: string; audience?: string; searchText?: string };
type SopActionOption = {
  value: string;
  label: string;
  domain: string;
  action: string;
  ref?: string | null;
  approve?: boolean;
  description?: string;
  searchText?: string;
  parameterLabel?: string;
  parameterPlaceholder?: string;
};
type SopRollbackOption = { value: string; label: string; scene?: string; riskLevel?: string; plan: string; searchText?: string };
type CopyPositionOption = { value: string; label: string; surface: string; status?: string };
type CopyVersionOption = { value: string; label: string; status?: string };
type CopyExperimentVersionOption = {
  value: string;
  label: string;
  audience: string;
  audienceTarget?: { tiers?: string[]; locales?: string[]; registrationDaysMin?: number | null; registrationDaysMax?: number | null };
  estimatedAudience?: number;
};
type CopyExperimentCopyOption = { value: string; label: string; versions: CopyExperimentVersionOption[] };
export type SchemaPropertyDraft = { name: string; type: string; pii: boolean };

/** 提示里的「命令号：xxx」「请求号：xxx」整串不在连字符处断开（e- / domain-action），放不下就整串换到下一行。文字不变。 */
function keepCommandKey(text: ReactNode): ReactNode {
  if (typeof text !== "string") return text;
  const at = Math.max(text.lastIndexOf("命令号："), text.lastIndexOf("请求号："));
  const key = at < 0 ? null : text.slice(at + 4).match(/^[\w.:-]+/)?.[0];
  if (!key) return text;
  return <>{text.slice(0, at + 4)}<span data-mono className="rd-keep">{key}</span>{text.slice(at + 4 + key.length)}</>;
}

function initEditValue(spec?: EditSpec | null): string {
  if (!spec) return "";
  const kind = spec.kind ?? "text";
  if (kind !== "select" && kind !== "toggle") return spec.initialValue ?? "";
  const current = (spec.initialValue ?? spec.current)?.trim();
  if (!current) return "";
  const options = spec.options ?? ["开启", "关闭"];
  return options.includes(current) ? current : "";
}

// 用十进制整数校验步长，避免合法小数被浮点除法误拒；不舍入输入。
function isDecimalStepAligned(value: string, base: number, step: number): boolean {
  const parts = [value, String(base), String(step)].map((raw) => {
    const [mantissa, exponent = "0"] = raw.toLowerCase().split("e");
    return {
      coefficient: BigInt(mantissa.replace(".", "")),
      scale: (mantissa.split(".")[1]?.length ?? 0) - Number(exponent),
    };
  });
  const scale = Math.max(0, ...parts.map((part) => part.scale));
  const [numeric, origin, increment] = parts.map((part) =>
    part.coefficient * BigInt(10) ** BigInt(scale - part.scale));
  return (numeric - origin) % increment === BigInt(0);
}

function isEditValueValid(spec: EditSpec | null, value: string): boolean {
  if (!spec) return true;
  if (!value.trim()) return false;
  if (spec.disabledOptions?.includes(value.trim())) return false;
  if (spec.disallowCurrent && value.trim() === (spec.current ?? "").trim()) return false;
  if ((spec.kind ?? "text") !== "number") return true;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return false;
  if (spec.maxDecimals !== undefined && (normalized.split(".")[1]?.length ?? 0) > spec.maxDecimals) return false;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return false;
  if (spec.min !== undefined && numeric < spec.min) return false;
  if (spec.max !== undefined && numeric > spec.max) return false;
  if (spec.disallowCurrent && numeric === Number(spec.current)) return false;
  if (spec.step !== undefined && spec.step > 0
    && !isDecimalStepAligned(normalized, spec.min ?? 0, spec.step)) return false;
  return true;
}

/** 修改框里「现在」的值：选项写名字，数字加千分位；是数字时才带单位（「不设上限」后面不跟 USDT）。 */
function editCurrent(spec: EditSpec, kind: string): { text: ReactNode; unit?: string } {
  const current = spec.current ?? "";
  const label = spec.optionLabels?.[current];
  if (label !== undefined) return { text: label };
  if (kind !== "number" || !/^-?\d+(\.\d+)?$/.test(current.trim())) return { text: current };
  const [whole, fraction] = current.trim().split(".");
  return { text: `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction ? `.${fraction}` : ""}`, unit: spec.unit };
}

/** 数字框填错时写什么。范围全站写「1–90」「0–1,000,000」，不写开发词（TX-05）。 */
function numberRangeText({ min, max, step, maxDecimals }: { min?: number; max?: number; step?: number; maxDecimals?: number }): string {
  const num = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 20 });
  const range = min != null && max != null ? `${num(min)}–${num(max)} 的`
    : min != null ? `不小于 ${num(min)} 的`
    : max != null ? `不大于 ${num(max)} 的`
    : "有效的";
  const decimals = maxDecimals != null ? `，最多 ${maxDecimals} 位小数` : step != null && step < 1 ? `，最多 ${String(step).split(".")[1]?.length} 位小数` : "";
  return `${range}${step === 1 ? "整数" : "数字"}${decimals}`;
}

function editNumberError(spec: EditSpec): string {
  return `请输入 ${numberRangeText(spec)}`.replace("请输入 不", "请输入不").replace("请输入 有效", "请输入有效");
}

type MultiFieldSpec = Extract<BusinessFormSpec, { kind: "multi-field" }>;

/** 每个字段自己填得对不对，字段下和灰按钮的提示用同一句（VS-107）。跨字段的 feedback 已报错时不再报范围，同一件事只写一处（VS-105）。 */
function multiFieldIssues(spec: MultiFieldSpec, state: BusinessFormValue): Record<string, string> {
  const issues: Record<string, string> = {};
  const feedback = spec.feedback?.(state);
  spec.fields.filter((f) => !f.visibleWhen || (state[f.visibleWhen.key] ?? "") === f.visibleWhen.equals).forEach((f) => {
    const raw = (state[f.key] ?? "").trim();
    if (raw && f.minLength != null && raw.length < f.minLength) issues[f.key] = `${f.label}至少 ${f.minLength} 位`;
    else if (raw && f.maxLength != null && raw.length > f.maxLength) issues[f.key] = `${f.label}最多 ${f.maxLength} 位`;
    else if (raw && f.pattern) {
      try {
        if (!new RegExp(f.pattern).test(raw)) issues[f.key] = f.patternMessage ?? `${f.label}格式不对`;
      } catch {
        issues[f.key] = `${f.label}校验规则不可用`;
      }
    } else if (f.inputKind === "number" && !feedback?.invalid && (raw || f.required === false)) {
      const n = Number(state[f.key]);
      const off = !Number.isFinite(n) ? false
        : (f.min != null && n < f.min) || (f.max != null && n > f.max)
          || (f.step != null && f.step > 0 && f.min != null && !isDecimalStepAligned(String(state[f.key]).trim(), f.min, f.step));
      if (off) issues[f.key] = `${f.label}要填 ${numberRangeText(f)}`;
    }
  });
  return issues;
}

export type BusinessFormSpec =
  | { kind: "role-select"; currentRole: string; roles: RoleOption[]; guardHint?: string;
      /** 可选:传入全域动作 + 各角色授权向量,启用「角色变更权限 diff 预览」(新增/移除/受影响域)。 */
      actions?: { label: string; domainGroup?: string }[]; grantsByRole?: Record<string, string[]> }
  | {
      kind: "identity-verify";
      subject: string;
      channels?: string[];
      ticketHint?: string;
      /** 只展示本次操作的授权事实，另由操作人声明已核实本人；不改变表单值或校验。 */
      presentation?: "authorization-and-declaration";
      serverVerification?: {
        channel: string;
        ticket: string;
        verifiedAt: string;
        verifiedBy?: string;
        expiresAt?: string;
      };
    }
  | { kind: "schema-authoring"; ownerDomains?: string[]; propertyTypes?: string[]; samplingPolicies?: string[]; versionHint?: string }
  | { kind: "disposition-lifecycle"; subject: string; periods?: string[]; ownerHint?: string }
  | { kind: "balance-adjust"; subject: string; currencies?: string[]; directions?: string[] }
  | { kind: "sop-authoring"; scenes?: string[]; owners?: string[]; nameHint?: string; notifyTemplates?: NotifyTemplateOption[]; notifyTemplatesError?: string; actionOptions?: SopActionOption[]; rollbackOptions?: SopRollbackOption[];
      currentName?: string; currentScene?: string; currentOwner?: string; currentSla?: string; currentEmergencyTrack?: boolean;
      currentActionSeq?: string; currentNotifyCampaignNo?: string; currentNotifyTemplate?: string; currentRollback?: string; currentDrillRequired?: boolean }
  | { kind: "j4-execution-confirmation"; triggerBases: string[]; defaultTriggerBasis?: string;
      steps: { domain: string; action: string; ref: string; approve: boolean }[] }
  | { kind: "export-wizard"; mode?: "aggregate-only"; kpiStructuredRange?: boolean; exportTypes?: string[]; piiLevels?: string[]; maskPolicies?: string[] }
  | { kind: "permission-matrix"; roles: PermissionRole[]; actionLabel?: string; guardHint?: string; grantOptions?: string[] }
  | { kind: "localized-copy"; mode?: "create" | "edit"; keyName?: string; zh?: string; en?: string; vi?: string; placeholders?: string[] }
  | { kind: "copy-edit"; keyName?: string; version?: string; versionOptions?: CopyVersionOption[]; surface?: string; copyPosition?: string; audience?: string; phaseMin?: string; phaseMax?: string; language?: string; registrationDaysGt?: string; trafficSplit?: string; zh?: string; en?: string; vi?: string; placeholders?: string[]; audiences?: string[]; trafficSplits?: string[]; modules?: { value: string; label: string }[]; positions?: CopyPositionOption[]; versionNote?: string; saveModeChoice?: boolean }
  | { kind: "copy-create"; copyKey?: string; description?: string; surface?: string; copyPosition?: string; audience?: string; phaseMin?: string; phaseMax?: string; language?: string; registrationDaysGt?: string; modules?: { value: string; label: string }[]; positions?: CopyPositionOption[]; versionOptions?: CopyVersionOption[]; trafficSplits?: string[]; version?: string; zh?: string; en?: string; vi?: string; versionNote?: string; placeholders?: string[] }
  | { kind: "copy-position-create"; modules: { value: string; label: string }[] }
  | { kind: "copy-version-option"; mode: "create" | "edit"; versionKey?: string; name?: string; description?: string; status?: string; sortOrder?: number; revision?: number }
  | { kind: "copy-experiment-create"; copies: CopyExperimentCopyOption[] }
  | { kind: "copy-experiment-start"; experimentId: string }
  | { kind: "copy-experiment-discard"; experimentId: string }
  | { kind: "course-authoring"; mode?: "create" | "edit" | "version-create" | "version-edit"; rewardMin?: number; rewardMax?: number; categories?: string[]; formats?: string[]; levels?: string[]; durations?: string[];
      current?: { slug: string; version?: string; category: string; format: string; difficulty: string; duration: string; reward: number; titleZh: string; titleEn: string; titleVi: string; bodyZh: string; bodyEn: string; bodyVi: string;
        quizQuestions?: { questionId: string; questionZh: string; questionEn: string; questionVi?: string; optionsZh: string[]; optionsEn: string[]; optionsVi?: string[]; correctOptionIndex: number }[];
        passScore?: number; retryLimit?: number; completionCondition?: string; rewardEvent?: string } }
  | { kind: "campaign-edit"; tiers?: string[]; audiences?: string[]; title?: string; body?: string; defaultTier?: string; defaultAudience?: string; budget?: string }
  | { kind: "generation-gate"; mode: "create" | "edit"; skuOptions: string[]; phaseOptions: string[]; phaseLabels?: Record<string, ReactNode>; skuId?: string; name?: string; releaseMonth?: number; phase?: string; eligibility?: boolean; phaseOffset?: number; forceUnlock?: boolean }
  | { kind: "phase-config"; mode: "create" | "edit"; label?: string; meta?: string; skus?: string; sortOrder?: number; status?: string }
  | { kind: "disclosure-jurisdiction"; mode: "create" | "edit"; code?: string; name?: string; revision?: number }
  | { kind: "version-authoring"; mode?: "create" | "edit"; version?: string; jurisdiction?: string; zh?: string; vi?: string; en?: string; chapters?: { no: string; zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string }[]; languageScope?: string; languageScopes?: string[]; jurisdictionOptions?: { value: string; label: string }[]; effectiveDate?: string; requiresReack?: boolean; versionReadonly?: boolean; jurisdictionReadonly?: boolean }
  | { kind: "disclosure-matrix"; mode: "create" | "edit"; jurisdictionCode?: string; jurisdictionName?: string; jurisdictionOptions?: { value: string; label: string }[]; countryCodes?: string[]; countryOptions?: { value: string; label: string }[]; version?: string; publishedVersionsByJurisdiction?: Record<string, string[]>; unchanged?: { version: string; countryCodes: string[] }; affected?: number }
  | { kind: "disclosure-publish-review"; jurisdiction: string; currentVersion: string; targetVersion: string; affected: number; pendingAck: number; blocked: number; gatedActions: string[]; currentChapters: { no: string; zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string }[]; targetChapters: { no: string; zh: string; vi: string; en: string; zhBody: string; viBody: string; enBody: string }[] }
  | { kind: "trust-section-authoring"; mode: "create" | "edit"; sectionKey: string; version?: string; description?: string; structure?: string; revision?: number;
      fields?: { key: string; label: string; value: string }[] }
  | { kind: "trust-section-publish"; currentVersion: string; targetVersion: string; requireDataSource?: boolean;
      currentFields: { key: string; label: string; value: string }[];
      targetFields: { key: string; label: string; value: string }[] }
  | { kind: "destructive-reason"; target: string; impact: string; requireAck?: boolean }
  | { kind: "task-edit"; subject?: string; currentName?: string; currentPath?: string; currentReward?: string; currentStatus?: string; statusOptions?: string[]; currentCompletionType?: string; currentCompletionEvent?: string; completionTypeOptions?: string[] }
  | { kind: "day-one-window"; currentActiveHours?: string; currentGraceHours?: string }
  | { kind: "day-one-tri-reward"; currentActive?: string; currentGrace?: string; currentExpired?: string }
  // 通用多字段配置:一个「调整」按钮 → 一个弹窗里编辑 N 个带标签的值(各值独立 backend-replaceable,
  // 配合 EOp "param-multi" + McSpec.paramKeys 把每字段写到自己的 param key)。
  // ascending=true 时校验 number 字段严格递增(如 分段月界 早末<中末<总月数)。
  | { kind: "multi-field"; title?: string; hint?: string; /** 跨字段校验。传 field 时写在那一项下面，不传写在表单最后。 */ feedback?: (value: BusinessFormValue) => { message: string; invalid: boolean; field?: string }; amplifies?: (value: BusinessFormValue) => boolean; ascending?: boolean; requireAnyChange?: boolean; reasonMax?: number; onFieldChange?: (key: string, next: BusinessFormValue) => BusinessFormValue; fields: { key: string; label: string; current?: string; placeholder?: string; inputKind?: "number" | "text" | "select" | "multi-select" | "date" | "datetime-local" | "asset-upload" | "checkbox"; options?: string[]; mustChoose?: boolean; optionLabels?: Record<string, string>; searchable?: boolean; showDiff?: boolean; required?: boolean; requiredWhenAddedTo?: string; visibleWhen?: { key: string; equals: string }; min?: number; max?: number; step?: number; minLength?: number; maxLength?: number; pattern?: string; patternMessage?: string; help?: string; /** 这一项是什么、怎么填：收进字段名旁的提示图标（DP-06），只在 RdPage 里显示。 */ explain?: ReactNode; warning?: (value: BusinessFormValue) => string | undefined; uploadPurpose?: "vietqr-receipt"; uploadDomain?: string; uploadUsage?: string; uploadOperator?: string; accept?: string; wide?: boolean; warnAbove?: number; warnText?: string }[] }
  | { kind: "weekly-task-edit"; subject?: string; currentCond?: string; currentReward?: string; currentStatus?: string; statusOptions?: string[]; currentCompletionType?: string; currentCompletionEvent?: string; completionTypeOptions?: string[] }
  | { kind: "monthly-task-edit"; subject?: string; currentTheme?: string; currentAge?: string; currentReward?: string; currentGoals?: string; currentStatus?: string; statusOptions?: string[] }
  | { kind: "voucher-config"; subject?: string; applicableSkuOptions?: string[]; applicableSkuLabels?: Record<string, string>; currentName?: string; currentType?: string; typeLocked?: boolean; currentAmountUSD?: string; currentPercent?: string; currentMinPurchaseUSD?: string; currentMaxDiscountUSD?: string; currentIssuanceLimit?: string; currentApplicableSkus?: string; currentAudience?: string; currentStartDate?: string; currentEndDate?: string; currentClaimSurfaces?: string; currentPopupEnabled?: string; currentPopupCadenceEnabled?: string; currentPopupDelayMs?: string; currentPopupCooldownHours?: string; currentPopupMaxPerSession?: string; currentStackWithTrial?: string; currentStackWithOthers?: string; currentSplittable?: string; currentStatus?: string }
  | { kind: "promo-banner-edit"; currentBaseReward?: string; currentMultiplier?: string; currentCountdownDays?: string; currentCountdownHours?: string; currentTargetDevice?: string; currentTargetDaily?: string; currentStatus?: string; statusOptions?: string[] }
  | { kind: "vrank-reward-edit"; subject?: string; voucherOptions?: string[]; voucherLabels?: Record<string, string>; skuOptions?: string[]; skuLabels?: Record<string, string>; currentType?: string; currentAmount?: string; currentVoucherId?: string; currentSkuId?: string; currentCustom?: string }
  | { kind: "mission-create"; subject?: string }
  | { kind: "monthly-mission-create"; subject?: string }
  | { kind: "wheel-tier-config"; subject?: string }
  | { kind: "wheel-guard-config"; subject?: string }
  | { kind: "quest-event-config"; subject?: string };

type BriefRow = { label: string; text: string };

/**
 * What the action really is, stated by the caller. Every caller supplies a kind, so words in a note, title or FAQ question cannot change the summary.
 */
export type OperatorBriefKind = "export" | "funds" | "security" | "emergency" | "note" | "judgment" | "config" | "content" | "record" | "self-avatar" | "conversation" | "note-delete" | "faq-delete" | "session-category";
const STATED_BRIEF: Partial<Record<OperatorBriefKind, { impact: string; check: string }>> = {
  "self-avatar": { impact: "只更换本人头像，账号、角色和接待资格不变。", check: "确认这张图片可以作为本人头像，理由写清依据或工单号。" },
  conversation: { impact: "只改变客户对话的处理状态或列表位置，不改变账号、资金和专属客服归属。", check: "核对客户和会话，理由写清依据或工单号。" },
  "note-delete": { impact: "删除这条内部备注，不改变账户状态或风险结论。", check: "核对要删除的备注和客户，理由写清依据或工单号。" },
  "faq-delete": { impact: "这条问答会从帮助中心移除，不影响账号和资金。", check: "核对问答内容，确认不再需要，理由写清依据或工单号。" },
  "session-category": { impact: "只决定用户能否在会话中心选择这个类别，进行中的会话不受影响。", check: "核对类别和启用或禁用方向，理由写清依据或工单号。" },
};

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return plainText(node.props.children);
  return "";
}

function compactText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([,，.。:：;；])/g, "$1").trim();
}

function buildOperatorBrief(action: ReactNode, amplifies: boolean, hasEdit: boolean, localHistory: boolean, kind: OperatorBriefKind, statedBrief?: { impact: string; check: string }): BriefRow[] {
  const actionText = compactText(plainText(action));
  const stated = statedBrief ?? STATED_BRIEF[kind];
  if (stated) return [{ label: "要做什么", text: actionText }, { label: "影响", text: stated.impact }, { label: "提交前", text: stated.check }];
  const defaultCheck = hasEdit
    ? "核对新值和影响范围，理由写清依据或工单号。"
    : "核对操作对象和凭证，理由写清依据或工单号。";

  if (kind === "export") {
    return [
      { label: "要做什么", text: actionText || "生成一份导出文件。" },
      { label: "影响", text: "按所选范围生成下载文件，用户明细会隐藏敏感信息，下载链接 24 小时内有效。" },
      { label: "提交前", text: "确认导出范围、字段和接收人，理由写明导出依据或工单号。" },
    ];
  }

  if (kind === "config") {
    return [
      { label: "要做什么", text: actionText || "修改后台参数或规则。" },
      { label: "影响", text: "按页面说明生效，可能影响之后的订单、风控、报表或用户看到的内容。" },
      { label: "提交前", text: `${defaultCheck}${amplifies ? "这项改动会让平台多付钱，提交时会先检查兑付覆盖率。" : ""}` },
    ];
  }

  if (kind === "funds") {
    return [
      { label: "要做什么", text: actionText || "处理一笔资金或提现。" },
      { label: "影响", text: "会改变用户资金、提现单或平台账目。放行、解冻和提额都会占用平台储备。" },
      { label: "提交前", text: `核对用户、金额、触发的风险规则和凭证。${amplifies ? "提交时会先检查兑付覆盖率。" : "理由写清处理依据。"}` },
    ];
  }

  if (kind === "security") {
    return [
      { label: "要做什么", text: actionText || "处理账号、安全或权限。" },
      { label: "影响", text: "会影响后台账号、用户登录、权限或风控名单，部分操作会让对方立即下线或降低账号安全。" },
      { label: "提交前", text: "确认对象账号和授权来源，理由写清工单号和处理依据。" },
    ];
  }

  if (kind === "emergency") {
    return [
      { label: "要做什么", text: actionText || "切换紧急开关或地区限制。" },
      { label: "影响", text: "立即影响对应业务、地区访问或资金功能；恢复会重新放开用户操作。" },
      { label: "提交前", text: "确认影响的国家或业务和是否需要通知用户，理由写明监管、风控或应急依据。" },
    ];
  }

  if (kind === "content") {
    return [
      { label: "要做什么", text: actionText || "发布、回滚或下架内容。" },
      { label: "影响", text: "用户看到的内容、通知或披露会随之变化，披露更新可能要求用户重新确认。" },
      { label: "提交前", text: "检查各语言内容、适用地区、接收人群和发布时间，理由写明版本依据。" },
    ];
  }

  if (kind === "note" || kind === "judgment") {
    return [
      { label: "要做什么", text: actionText || "记录或更新一条人工判定。" },
      { label: "影响", text: kind === "note" ? "只添加备注，不改变账户状态或风险结论。" : "会更新风控判定，影响之后是否继续拦截、冻结或放行。" },
      { label: "提交前", text: "确认对象、证据和结论，理由写清依据或工单号。" },
    ];
  }

  return [
    { label: "要做什么", text: actionText || "执行这项后台操作。" },
    { label: "影响", text: amplifies ? (localHistory ? "这项操作会让平台多付钱，请确认资金影响。" : "这项操作会让平台多付钱，提交时会先检查兑付覆盖率。") : (localHistory ? "结果会记录在本页修改历史。" : "结果会记录在操作记录中。") },
    { label: "提交前", text: defaultCheck },
  ];
}

export function OperatorBriefBlock({ action, detail, amplifies, hasEdit, completionCopy, auditSink, kind, stated }: { action: ReactNode; detail: ReactNode; amplifies?: boolean; hasEdit?: boolean; completionCopy?: string; auditSink?: "a2" | "local-history"; kind: OperatorBriefKind; stated?: { impact: string; check: string } }) {
  const surface = useRdSurface();
  const businessBrief = stated ?? STATED_BRIEF[kind];
  const brief = buildOperatorBrief(action, !!amplifies, !!hasEdit, auditSink === "local-history", kind, stated)
    .map((row) => row.label === "影响" && completionCopy && !businessBrief ? { ...row, text: completionCopy } : row);
  if (!surface && businessBrief && completionCopy && completionCopy !== businessBrief.impact) brief.push({ label: "生效与复核", text: completionCopy });
  const detailText = compactText(plainText(detail));
  // 业务后果与生效／批准资格分别常显；默认套话只留在详情，不占关键信息层。
  if (surface) {
    const impact = businessBrief?.impact;
    return (
      <div className="rd-operation-brief">
        {impact && <p className="rd-operation-impact"><KeepText text={impact} /></p>}
        {completionCopy && completionCopy !== impact && <p className="rd-operation-completion"><KeepText text={completionCopy} /></p>}
        <details className="operator-brief rd-brief">
          <summary>
            <span className="rd-brief-head"><b>执行摘要</b></span>
            <span className="rd-brief-toggle"><span className="brief-closed">查看详情</span><span className="brief-open">收起</span></span>
          </summary>
          <dl className="rd-brief-rows">
            {brief.filter((row) => row.label !== "要做什么" && !(row.label === "影响" && (impact || completionCopy))).map((row) => <div key={row.label}><dt>{row.label}</dt><dd><KeepText text={row.text}>{(part) => <AutoGloss>{part}</AutoGloss>}</KeepText></dd></div>)}
            {detailText && detailText !== compactText(impact ?? "") && detailText !== compactText(completionCopy ?? "") && <div><dt>说明</dt><dd>{typeof detail === "string" ? <KeepText text={detail}>{(part) => <AutoGloss>{part}</AutoGloss>}</KeepText> : <AutoGloss>{detail}</AutoGloss>}</dd></div>}
          </dl>
        </details>
      </div>
    );
  }
  const rows = (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      {brief.map((row) => (
        <div key={row.label} style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10, alignItems: "start" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>{row.label}</span>
          <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.65 }}>
            <AutoGloss>{row.text}</AutoGloss>
          </span>
        </div>
      ))}
      {detailText && (
        <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10, alignItems: "start" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>说明</span>
          <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.7 }}>
            <AutoGloss>{detail}</AutoGloss>
          </span>
        </div>
      )}
    </div>
  );
  return (
    <details className="tint brand operator-brief" style={{ marginBottom: 16, border: 0 }}>
      <summary
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontWeight: 600, fontSize: 13 }}
      >
        <span>执行摘要</span>
        <span className="tiny" style={{ color: "var(--brand)", fontWeight: 500 }}>
          <span className="brief-closed">查看详情 <span aria-hidden="true">▼</span></span>
          <span className="brief-open">收起 <span aria-hidden="true">▲</span></span>
        </span>
      </summary>
      <div>{rows}</div>
    </details>
  );
}

const DEFAULT_GRANTS = ["-", "R", "M", "C"];
const DEFAULT_COURSE_CATEGORIES = ["Basics", "Earn", "Team", "Wealth", "Security"];
const DEFAULT_COURSE_DURATIONS = ["5 min", "8 min", "12 min", "15 min"];
const COURSE_CATEGORY_LABELS: Record<string, string> = { Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" };
const COURSE_FORMAT_LABELS: Record<string, string> = { Article: "图文", Video: "视频", "Hands-on": "实操" };
const COURSE_LEVEL_LABELS: Record<string, string> = { Beginner: "入门", Intermediate: "进阶", Advanced: "高级" };
const COURSE_STATUS_LABELS: Record<string, string> = { draft: "草稿", published: "已发布", archived: "已归档" };
const DEFAULT_CAMPAIGN_TIERS = ["critical", "high", "normal", "low"];
const DEFAULT_LANGUAGE_SCOPES = ["zh+vi", "zh+vi+en"];

function parseCopyAudience(audience?: string): { phaseMin: string; phaseMax: string; language: string; registrationDaysGt: string } {
  const raw = audience?.trim() ?? "";
  const phaseRange = raw.match(/P([1-6])(?:\s*[-–]\s*P?([1-6]))?/i);
  const language = raw.match(/(?:^|[·\s])(zh|en|vi)(?:$|[·\s])/i)?.[1]?.toLowerCase() ?? "all";
  const days = raw.match(/注册\s*(?:>|≥)\s*(\d+)\s*天/)?.[1] ?? "0";
  return {
    phaseMin: phaseRange?.[1] ? `P${phaseRange[1]}` : "P1",
    phaseMax: phaseRange?.[2] ? `P${phaseRange[2]}` : phaseRange?.[1] ? `P${phaseRange[1]}` : "P3",
    language,
    registrationDaysGt: days,
  };
}

function copyExperimentAudienceSignature(version?: CopyExperimentVersionOption): string {
  if (!version) return "";
  const parsed = parseCopyAudience(version.audience);
  const start = Number(parsed.phaseMin.slice(1));
  const end = Number(parsed.phaseMax.slice(1));
  const tiers = version.audienceTarget?.tiers?.length
    ? [...version.audienceTarget.tiers].map((tier) => tier.toUpperCase()).sort()
    : Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => `P${start + index}`);
  const locales = version.audienceTarget
    ? (version.audienceTarget.locales?.length ? [...version.audienceTarget.locales].map((locale) => locale.toLowerCase()).sort() : ["all"])
    : [parsed.language.toLowerCase()];
  const registrationDaysMin = version.audienceTarget?.registrationDaysMin ?? Number(parsed.registrationDaysGt) + 1;
  const registrationDaysMax = version.audienceTarget?.registrationDaysMax ?? null;
  return JSON.stringify({ tiers, locales, registrationDaysMin, registrationDaysMax });
}

function parseSopSlaMinutes(raw?: string): number | null {
  const value = (raw ?? "").trim();
  let match = value.match(/^(?:≤|<=)?\s*(\d{1,2})\s*h$/i);
  if (match) {
    const minutes = Number(match[1]) * 60;
    return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
  }
  match = value.match(/^(\d{1,4})\s*(?:分钟|m)$/i);
  if (!match) return null;
  const minutes = Number(match[1]);
  return Number.isInteger(minutes) && minutes >= 1 && minutes <= 1440 ? minutes : null;
}

function initBusinessForm(spec?: BusinessFormSpec): BusinessFormValue {
  if (!spec) return {};
  if (spec.kind === "mission-create") {
    return { category: "explore", actionRoute: "/pages/missions/missions" };
  }
  if (spec.kind === "role-select") {
    return { role: spec.currentRole };
  }
  if (spec.kind === "permission-matrix") {
    return Object.fromEntries(spec.roles.map((r) => [`grant.${r.key}`, r.current]));
  }
  if (spec.kind === "localized-copy") {
    return { messageKey: spec.keyName ?? "", zh: spec.zh ?? "", en: spec.en ?? "", vi: spec.vi ?? "" };
  }
  if (spec.kind === "copy-edit") {
    const audience = parseCopyAudience(spec.audience);
    return {
      zh: spec.zh ?? "",
      en: spec.en ?? "",
      vi: spec.vi ?? "",
      version: spec.version || spec.versionOptions?.[0]?.value || "",
      surface: spec.surface ?? "",
      copyPosition: spec.copyPosition ?? spec.positions?.find((item) => item.surface === spec.surface && item.status !== "disabled")?.value ?? "",
      audience: spec.audience ?? spec.audiences?.[0] ?? "",
      phaseMin: spec.phaseMin ?? audience.phaseMin,
      phaseMax: spec.phaseMax ?? audience.phaseMax,
      language: spec.language ?? audience.language,
      registrationDaysGt: spec.registrationDaysGt ?? audience.registrationDaysGt,
      trafficSplit: spec.trafficSplit ?? spec.trafficSplits?.[0] ?? "",
      versionNote: spec.versionNote ?? "日常内容迭代",
      saveMode: "存草稿",
    };
  }
  if (spec.kind === "copy-create") {
    const surface = spec.surface ?? spec.modules?.[0]?.value ?? "home";
    const audience = parseCopyAudience(spec.audience);
    return {
      copyKey: spec.copyKey ?? "",
      description: spec.description ?? "",
      surface,
      copyPosition: spec.copyPosition ?? spec.positions?.find((item) => item.surface === surface && item.status !== "disabled")?.value ?? "",
      audience: spec.audience ?? "",
      phaseMin: spec.phaseMin ?? audience.phaseMin,
      phaseMax: spec.phaseMax ?? audience.phaseMax,
      language: spec.language ?? audience.language,
      registrationDaysGt: spec.registrationDaysGt ?? audience.registrationDaysGt,
      trafficSplit: spec.trafficSplits?.[0] ?? "",
      version: spec.version ?? spec.versionOptions?.[0]?.value ?? "",
      versionNote: spec.versionNote ?? "新增文案初始内容",
      zh: spec.zh ?? "",
      en: spec.en ?? "",
      vi: spec.vi ?? "",
    };
  }
  if (spec.kind === "copy-position-create") {
    return { positionKey: "", positionName: "", surface: spec.modules[0]?.value ?? "home" };
  }
  if (spec.kind === "copy-version-option") {
    return {
      versionKey: spec.versionKey ?? "",
      name: spec.name ?? "",
      description: spec.description ?? "",
      status: spec.status ?? "ACTIVE",
      sortOrder: String(spec.sortOrder ?? 0),
      revision: String(spec.revision ?? 0),
    };
  }
  if (spec.kind === "copy-experiment-create") {
    const copy = spec.copies[0];
    return {
      copyKey: copy?.value ?? "",
      variantCount: "2",
      "variantVersion.0": copy?.versions[0]?.value ?? "",
      "variantSplit.0": "50",
      "variantVersion.1": copy?.versions[1]?.value ?? "",
      "variantSplit.1": "50",
      note: "",
    };
  }
  if (spec.kind === "copy-experiment-start") {
    return { ack: "false" };
  }
  if (spec.kind === "copy-experiment-discard") {
    return {};
  }
  if (spec.kind === "course-authoring") {
    const current = spec.current;
    const questions = current?.quizQuestions?.length ? current.quizQuestions : [{
      questionId: "q1", questionZh: "", questionEn: "", questionVi: "", optionsZh: ["", ""], optionsEn: ["", ""], optionsVi: ["", ""], correctOptionIndex: 0,
    }];
    const state: BusinessFormValue = {
      slug: current?.slug ?? "",
      version: current?.version ?? "v1",
      category: current?.category ?? spec.categories?.[0] ?? DEFAULT_COURSE_CATEGORIES[0],
      format: current?.format ?? spec.formats?.[0] ?? "Article",
      difficulty: current?.difficulty ?? spec.levels?.[0] ?? "Beginner",
      duration: current?.duration ?? spec.durations?.[0] ?? DEFAULT_COURSE_DURATIONS[0],
      reward: String(current?.reward ?? spec.rewardMin ?? 5),
      publishState: "draft",
      titleZh: current?.titleZh ?? "",
      titleEn: current?.titleEn ?? "",
      titleVi: current?.titleVi ?? "",
      bodyZh: current?.bodyZh ?? "",
      bodyEn: current?.bodyEn ?? "",
      bodyVi: current?.bodyVi ?? "",
      quizCount: String(questions.length),
      passScore: String(current?.passScore ?? 60),
      retries: String(current?.retryLimit ?? 3),
      completionCond: current?.completionCondition ?? "quiz_passed",
      rewardEvent: current?.rewardEvent ?? "quiz.passed",
    };
    questions.forEach((question, questionIndex) => {
      state[`quiz.${questionIndex}.id`] = question.questionId || `q${questionIndex + 1}`;
      state[`quiz.${questionIndex}.questionZh`] = question.questionZh;
      state[`quiz.${questionIndex}.questionEn`] = question.questionEn;
      state[`quiz.${questionIndex}.questionVi`] = question.questionVi ?? "";
      state[`quiz.${questionIndex}.optionCount`] = String(Math.max(2, question.optionsZh.length, question.optionsEn.length, question.optionsVi?.length ?? 0));
      for (let optionIndex = 0; optionIndex < Number(state[`quiz.${questionIndex}.optionCount`]); optionIndex += 1) {
        state[`quiz.${questionIndex}.option.${optionIndex}.zh`] = question.optionsZh[optionIndex] ?? "";
        state[`quiz.${questionIndex}.option.${optionIndex}.en`] = question.optionsEn[optionIndex] ?? "";
        state[`quiz.${questionIndex}.option.${optionIndex}.vi`] = question.optionsVi?.[optionIndex] ?? "";
      }
      state[`quiz.${questionIndex}.correctOptionIndex`] = String(question.correctOptionIndex ?? 0);
    });
    return state;
  }
  if (spec.kind === "campaign-edit") {
    return {
      title: spec.title ?? "",
      body: spec.body ?? "",
      tier: spec.defaultTier ?? spec.tiers?.[0] ?? "normal",
      audience: spec.defaultAudience ?? spec.audiences?.[0] ?? "",
      schedule: "保存为草稿",
      budget: spec.budget ?? "0",
    };
  }
  if (spec.kind === "generation-gate") {
    return {
      skuId: spec.skuId ?? spec.skuOptions[0] ?? "",
      name: spec.name ?? "",
      releaseMonth: String(spec.releaseMonth ?? 1),
      phase: spec.phase ?? spec.phaseOptions[0] ?? "",
      eligibility: spec.eligibility ? "true" : "false",
      phaseOffset: String(spec.phaseOffset ?? 0),
      forceUnlock: spec.forceUnlock ? "true" : "false",
    };
  }
  if (spec.kind === "phase-config") {
    return {
      label: spec.label ?? "",
      meta: spec.meta ?? "",
      skus: spec.skus ?? "",
      sortOrder: String(spec.sortOrder ?? 10),
      status: spec.status ?? "active",
    };
  }
  if (spec.kind === "version-authoring") {
    return {
      version: spec.version ?? "",
      jurisdiction: spec.jurisdiction ?? "",
      languageScope: spec.languageScope ?? spec.languageScopes?.[0] ?? DEFAULT_LANGUAGE_SCOPES[0],
      effectiveDate: spec.effectiveDate ?? "",
      // I5 切换生效版本时要求重新确认；发布只封存内容。旧草稿也统一保存该要求。
      requiresReack: "true",
      zh: spec.zh ?? "",
      vi: spec.vi ?? "",
      en: spec.en ?? "",
      ...Object.fromEntries((spec.chapters ?? []).flatMap((chapter, index) => [
        [`chapter.${index}.no`, chapter.no],
        [`chapter.${index}.zhTitle`, chapter.zh],
        [`chapter.${index}.viTitle`, chapter.vi],
        [`chapter.${index}.enTitle`, chapter.en],
        [`chapter.${index}.zhBody`, chapter.zhBody],
        [`chapter.${index}.viBody`, chapter.viBody],
        [`chapter.${index}.enBody`, chapter.enBody],
      ])),
    };
  }
  if (spec.kind === "disclosure-jurisdiction") {
    return {
      code: spec.code ?? "",
      name: spec.name ?? "",
      expectedRevision: String(spec.revision ?? 0),
    };
  }
  if (spec.kind === "disclosure-publish-review") {
    return {
      jurisdictionConfirmed: "false",
      bilingualConfirmed: "false",
    };
  }
  if (spec.kind === "disclosure-matrix") {
    const jurisdictionCode = spec.jurisdictionCode ?? spec.jurisdictionOptions?.[0]?.value ?? "";
    const jurisdictionLabel = spec.jurisdictionOptions?.find((item) => item.value === jurisdictionCode)?.label;
    return {
      jurisdictionCode,
      jurisdictionName: spec.jurisdictionName ?? jurisdictionLabel?.replace(/^.*?·\s*/, "") ?? "",
      countryCodes: (spec.countryCodes ?? []).join(","),
      version: spec.version ?? spec.publishedVersionsByJurisdiction?.[jurisdictionCode]?.[0] ?? "",
    };
  }
  if (spec.kind === "trust-section-authoring") {
    const fields = spec.fields ?? [];
    const state: BusinessFormValue = {
      sectionKey: spec.sectionKey,
      version: spec.version ?? "",
      description: spec.description ?? "",
      structure: spec.structure ?? "",
      expectedRevision: String(spec.revision ?? 0),
      fieldCount: String(fields.length),
    };
    fields.forEach((field, index) => {
      state[`field.${index}.key`] = field.key;
      state[`field.${index}.label`] = field.label;
      state[`field.${index}.value`] = field.value;
    });
    return state;
  }
  if (spec.kind === "trust-section-publish") {
    return { dataSource: "", bilingualConfirmed: "false" };
  }
  if (spec.kind === "identity-verify") {
    return {
      channel: spec.serverVerification?.channel ?? spec.channels?.[0] ?? "视频核实",
      verifiedAt: spec.serverVerification?.verifiedAt ?? "",
      ticket: spec.serverVerification?.ticket ?? "",
      ack: "false",
    };
  }
  if (spec.kind === "schema-authoring") {
    return {
      eventName: "",
      ownerDomain: spec.ownerDomains?.[0] ?? "A",
      producer: "server",
      consumer: "",
      propName: "",
      propType: spec.propertyTypes?.[0] ?? "string",
      isPII: "false",
      isServerAuthoritative: "true",
      samplingPolicy: spec.samplingPolicies?.[0] ?? "100%(资金/风控/转化)",
      version: spec.versionHint ?? "",
    };
  }
  if (spec.kind === "disposition-lifecycle") {
    return { period: spec.periods?.[0] ?? "7 天", owner: "", reviewAt: "" };
  }
  if (spec.kind === "balance-adjust") {
    return { direction: spec.directions?.[0] ?? "增加", amount: "", currency: spec.currencies?.[0] ?? "USDT", voucher: "" };
  }
  if (spec.kind === "sop-authoring") {
    const currentSlaMinutes = parseSopSlaMinutes(spec.currentSla);
    return {
      name: spec.currentName ?? "",
      scene: spec.currentScene ?? spec.scenes?.[0] ?? "监管点名",
      owner: spec.currentOwner ?? spec.owners?.[0] ?? "风控",
      sla: currentSlaMinutes == null ? (spec.currentSla ? "" : "15 分钟") : `${currentSlaMinutes} 分钟`,
      slaLegacyValue: spec.currentSla ?? "",
      emergencyTrack: spec.currentEmergencyTrack === false ? "false" : "true",
      actionSeq: spec.currentActionSeq ?? "",
      actionSearch: "",
      notifyCampaignNo: spec.currentNotifyCampaignNo ?? "",
      notifyTemplate: spec.currentNotifyTemplate ?? "",
      notifySearch: spec.currentNotifyTemplate ?? "",
      rollback: spec.currentRollback ?? "",
      rollbackSearch: "",
      drillRequired: spec.currentDrillRequired === false ? "false" : "true",
    };
  }
  if (spec.kind === "j4-execution-confirmation") {
    return {
      triggerBasis: spec.defaultTriggerBasis ?? spec.triggerBases[0] ?? "",
      triggerContext: "",
      ...Object.fromEntries(spec.steps.map((_, index) => [`stepConfirm.${index}`, "false"])),
    };
  }
  if (spec.kind === "export-wizard") {
    return { exportType: spec.exportTypes?.[0] ?? "账单 CSV", timeRange: "", window: "7d", from: "", to: "", fields: "", piiLevel: spec.piiLevels?.[0] ?? "无 PII", maskPolicy: spec.maskPolicies?.[0] ?? "默认脱敏", recipient: "", ticket: "" };
  }
  if (spec.kind === "task-edit") {
    return { name: spec.currentName ?? "", path: spec.currentPath ?? "", reward: spec.currentReward ?? "", status: spec.currentStatus ?? "active", completionType: spec.currentCompletionType ?? "visit", completionEvent: spec.currentCompletionEvent ?? "" };
  }
  if (spec.kind === "day-one-window") {
    return { activeHours: spec.currentActiveHours ?? "24", graceHours: spec.currentGraceHours ?? "72" };
  }
  if (spec.kind === "day-one-tri-reward") {
    return { active: spec.currentActive ?? "500", grace: spec.currentGrace ?? "200", expired: spec.currentExpired ?? "0" };
  }
  if (spec.kind === "multi-field") {
    return Object.fromEntries(spec.fields.map((f) => [f.key, f.mustChoose ? "" : f.current ?? f.options?.[0] ?? ""]));
  }
  if (spec.kind === "weekly-task-edit") {
    return { cond: spec.currentCond ?? "", reward: spec.currentReward ?? "", status: spec.currentStatus ?? "active", completionType: spec.currentCompletionType ?? "event", completionEvent: spec.currentCompletionEvent ?? "" };
  }
  if (spec.kind === "monthly-task-edit") {
    return { theme: spec.currentTheme ?? "", age: spec.currentAge ?? "", reward: spec.currentReward ?? "", goals: spec.currentGoals ?? "", status: spec.currentStatus ?? "active" };
  }
  if (spec.kind === "promo-banner-edit") {
    return { baseReward: spec.currentBaseReward ?? "800", multiplier: spec.currentMultiplier ?? "1.5", countdownDays: spec.currentCountdownDays ?? "4", countdownHours: spec.currentCountdownHours ?? "12", targetDevice: spec.currentTargetDevice ?? "", targetDaily: spec.currentTargetDaily ?? "", status: spec.currentStatus ?? "active" };
  }
  if (spec.kind === "voucher-config") {
    return {
      name: spec.currentName ?? "",
      type: spec.currentType ?? "fixed",
      amountUSD: spec.currentAmountUSD ?? "",
      percent: spec.currentPercent ?? "",
      minPurchaseUSD: spec.currentMinPurchaseUSD ?? "",
      maxDiscountUSD: spec.currentMaxDiscountUSD ?? "",
      issuanceLimit: spec.currentIssuanceLimit ?? "0",
      applicableSkus: spec.currentApplicableSkus ?? "",
      claimSurfaces: spec.currentClaimSurfaces ?? "",
      audience: spec.currentAudience ?? "all",
      status: spec.currentStatus ?? "active",
      startDate: spec.currentStartDate ?? "",
      endDate: spec.currentEndDate ?? "",
      popupEnabled: spec.currentPopupEnabled ?? "true",
      popupCadenceEnabled: spec.currentPopupCadenceEnabled ?? "true",
      popupDelayMs: spec.currentPopupDelayMs ?? "1300",
      popupCooldownHours: spec.currentPopupCooldownHours ?? "24",
      popupMaxPerSession: spec.currentPopupMaxPerSession ?? "1",
      stackWithTrial: spec.currentStackWithTrial ?? "false",
      stackWithOthers: spec.currentStackWithOthers ?? "false",
      splittable: spec.currentSplittable ?? "false",
    };
  }
  if (spec.kind === "vrank-reward-edit") {
    return {
      rtype: spec.currentType ?? "uvt",
      amount: spec.currentAmount ?? "",
      voucherId: spec.currentVoucherId ?? (spec.voucherOptions?.[0] ?? ""),
      skuId: spec.currentSkuId ?? (spec.skuOptions?.[0] ?? ""),
      custom: spec.currentCustom ?? "",
    };
  }
  return { rollback: "", ack: "false" };
}

const DISCLOSURE_JURISDICTION_CODE = /^[A-Z][A-Z0-9_-]{1,15}$/;
const DISCLOSURE_JURISDICTION_CODE_HELP = "以字母开头，2–16 位字母、数字、下划线或短横线";

function missingBusinessFields(spec: BusinessFormSpec | undefined, state: BusinessFormValue): string[] {
  if (!spec) return [];
  const missing: string[] = [];
  const needs = (key: string, label: string) => {
    const names: Record<string,string> = { title: "标题", body: "正文", tier: "等级", audience: "受众", schedule: "时间安排", budget: "预算", no: "章节编号", description: "说明", structure: "内容结构", exportType: "导出类型", fields: "导出字段", piiLevel: "隐私信息级别", maskPolicy: "脱敏方式", recipient: "接收人", ticket: "关联工单", jurisdictionCode: "适用地区代码", jurisdictionName: "适用地区名称", jurisdiction: "适用地区", countryCodes: "适用国家/地区", version: "版本", languageScope: "语言范围", effectiveDate: "生效日期", requiresReack: "是否要求重新确认", zh: "中文正文", vi: "越南语正文", zhTitle: "中文标题", enTitle: "英文标题", viTitle: "越南语标题", zhBody: "中文正文", enBody: "英文正文", viBody: "越南语正文", bodyZh: "中文正文", bodyEn: "英文正文", bodyVi: "越南语正文", titleZh: "中文标题", titleEn: "英文标题", titleVi: "越南语标题" };
    if (!state[key]?.trim()) missing.push(label.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, (field) => names[field] ?? field));
  };
  if (spec.kind === "role-select") {
    needs("role", "目标角色");
    if (state.role === spec.currentRole) missing.push("目标角色必须发生变化");
  } else if (spec.kind === "permission-matrix") {
    spec.roles.forEach((r) => needs(`grant.${r.key}`, `${r.label} 授权`));
    if (!spec.roles.some((r) => (state[`grant.${r.key}`] ?? r.current) !== r.current)) {
      missing.push("至少一个授权变更");
    }
  } else if (spec.kind === "localized-copy") {
    if (spec.mode === "create") needs("messageKey", "词条标识");
    needs("zh", "中文文案");
    needs("en", "英文文案");
    needs("vi", "越南语文案");
    (spec.placeholders ?? []).forEach((ph) => {
      if (!state.zh?.includes(ph) || !state.en?.includes(ph) || !state.vi?.includes(ph)) missing.push(`占位符 ${ph}`);
    });
  } else if (spec.kind === "copy-edit") {
    needs("version", "文案版本");
    needs("surface", "投放模块");
    needs("copyPosition", "文案位置");
    needs("phaseMin", "最低阶段");
    needs("phaseMax", "最高阶段");
    needs("language", "语言");
    needs("registrationDaysGt", "注册天数");
    needs("trafficSplit", "分流比例");
    needs("versionNote", "版本说明");
    needs("zh", "中文草稿");
    needs("en", "英文草稿");
    needs("vi", "越南语文案");
    if (Number(state.phaseMin?.replace("P", "")) > Number(state.phaseMax?.replace("P", ""))) missing.push("阶段范围");
    if (!Number.isInteger(Number(state.registrationDaysGt)) || Number(state.registrationDaysGt) < 0) missing.push("注册天数非负整数");
    const split = Number(state.trafficSplit);
    if (!Number.isFinite(split) || split <= 0 || split > 100) missing.push("分流比例 1-100");
    (spec.placeholders ?? []).forEach((ph) => {
      if (!state.zh?.includes(ph) || !state.en?.includes(ph) || !state.vi?.includes(ph)) missing.push(`三语占位符 ${ph}`);
    });
    if (state.saveMode === "发布生效") missing.push(...i6CopyQualityIssues(state.zh ?? "", state.en ?? "", state.vi ?? ""));
  } else if (spec.kind === "copy-create") {
    needs("copyKey", "文案标识");
    needs("description", "文案名称");
    needs("surface", "投放模块");
    needs("copyPosition", "文案位置");
    needs("phaseMin", "最低阶段");
    needs("phaseMax", "最高阶段");
    needs("language", "语言");
    needs("registrationDaysGt", "注册天数");
    needs("trafficSplit", "分流比例");
    needs("version", "文案版本");
    needs("versionNote", "版本说明");
    needs("zh", "中文文案");
    needs("en", "英文文案");
    needs("vi", "越南语文案");
    if (Number(state.phaseMin?.replace("P", "")) > Number(state.phaseMax?.replace("P", ""))) missing.push("阶段范围");
    if (!Number.isInteger(Number(state.registrationDaysGt)) || Number(state.registrationDaysGt) < 0) missing.push("注册天数非负整数");
    const split = Number(state.trafficSplit);
    if (!Number.isFinite(split) || split <= 0 || split > 100) missing.push("分流比例 1-100");
    (spec.placeholders ?? []).forEach((ph) => {
      if (!state.zh?.includes(ph) || !state.en?.includes(ph) || !state.vi?.includes(ph)) missing.push(`三语占位符 ${ph}`);
    });
    missing.push(...i6CopyQualityIssues(state.zh ?? "", state.en ?? "", state.vi ?? ""));
  } else if (spec.kind === "copy-position-create") {
    needs("positionKey", "位置标识");
    needs("positionName", "位置名称");
    needs("surface", "投放模块");
  } else if (spec.kind === "copy-version-option") {
    needs("versionKey", "版本标识");
    needs("name", "版本名称");
    needs("status", "状态");
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(state.versionKey ?? "")) missing.push("版本标识格式");
    if (!Number.isInteger(Number(state.sortOrder)) || Number(state.sortOrder) < 0) missing.push("排序非负整数");
  } else if (spec.kind === "copy-experiment-create") {
    needs("copyKey", "选择文案");
    const count = Number(state.variantCount || 0);
    const versions = Array.from({ length: count }, (_, index) => state[`variantVersion.${index}`]?.trim() ?? "");
    const splits = Array.from({ length: count }, (_, index) => Number(state[`variantSplit.${index}`]));
    if (!Number.isInteger(count) || count < 2) missing.push("至少选择 2 个不同的非草稿内容版本");
    if (versions.some((version) => !version) || new Set(versions).size !== versions.length) missing.push("至少选择 2 个不同的非草稿内容版本");
    const copy = spec.copies.find((item) => item.value === state.copyKey);
    const audienceSignatures = versions
      .map((version) => copyExperimentAudienceSignature(copy?.versions.find((item) => item.value === version)))
      .filter(Boolean);
    if (audienceSignatures.length === versions.length && new Set(audienceSignatures).size > 1) missing.push("所选版本的投放对象须一致");
    if (splits.some((split) => !Number.isInteger(split) || split <= 0 || split >= 100)) missing.push("每个分流比例必须为 1-99 的整数");
    if (splits.reduce((sum, split) => sum + split, 0) !== 100) missing.push("分流比例合计必须为 100%");
    if (state.note?.length > 255) missing.push("测试备注不能超过 255 字");
  } else if (spec.kind === "copy-experiment-start") {
    if (state.ack !== "true") missing.push("勾选启动确认");
  } else if (spec.kind === "course-authoring") {
    ["slug", "category", "format", "difficulty", "duration", "reward", "titleZh", "titleEn", "titleVi", "bodyZh", "bodyEn", "bodyVi"].forEach((key) => needs(key, ({ slug: "课程标识", category: "分类", format: "形式", difficulty: "难度", duration: "预计时长", reward: "完成奖励", titleZh: "中文标题", titleEn: "英文标题", titleVi: "越南语标题", bodyZh: "中文正文", bodyEn: "英文正文", bodyVi: "越南语正文" } as Record<string, string>)[key] ?? "课程字段"));
    for (const key of ["titleZh", "titleEn", "titleVi", "bodyZh", "bodyEn", "bodyVi"]) {
      if ((state[key] ?? "").trim().length > 1024) missing.push(`${({titleZh:"中文标题",titleEn:"英文标题",titleVi:"越南语标题",bodyZh:"中文正文",bodyEn:"英文正文",bodyVi:"越南语正文"} as Record<string,string>)[key] ?? "内容"} 最多 1024 字`);
    }
    if (spec.mode === "version-create" || spec.mode === "version-edit") {
      needs("version", "课程版本号");
      if (!/^v[1-9][0-9]{0,8}$/i.test(state.version || "")) missing.push("版本号格式 v1、v2…");
    }
    const reward = Number(state.reward);
    if (!Number.isFinite(reward)) missing.push("奖励数值");
    if (spec.rewardMin != null && reward < spec.rewardMin) missing.push(`奖励 ≥ ${spec.rewardMin}`);
    if (spec.rewardMax != null && reward > spec.rewardMax) missing.push(`奖励 ≤ ${spec.rewardMax}`);
    const quizCount = Number(state.quizCount || 0);
    if (!Number.isInteger(quizCount) || quizCount < 1) missing.push("至少一道测验题");
    for (let questionIndex = 0; questionIndex < quizCount; questionIndex += 1) {
      needs(`quiz.${questionIndex}.id`, `第 ${questionIndex + 1} 题标识`);
      needs(`quiz.${questionIndex}.questionZh`, `第 ${questionIndex + 1} 题中文题干`);
      needs(`quiz.${questionIndex}.questionEn`, `第 ${questionIndex + 1} 题英文题干`);
      needs(`quiz.${questionIndex}.questionVi`, `第 ${questionIndex + 1} 题越南语题干`);
      const optionCount = Number(state[`quiz.${questionIndex}.optionCount`] || 0);
      if (!Number.isInteger(optionCount) || optionCount < 2) missing.push(`第 ${questionIndex + 1} 题至少两个选项`);
      for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
        needs(`quiz.${questionIndex}.option.${optionIndex}.zh`, `第 ${questionIndex + 1} 题选项 ${optionIndex + 1} 中文`);
        needs(`quiz.${questionIndex}.option.${optionIndex}.en`, `第 ${questionIndex + 1} 题选项 ${optionIndex + 1} 英文`);
        needs(`quiz.${questionIndex}.option.${optionIndex}.vi`, `第 ${questionIndex + 1} 题选项 ${optionIndex + 1} 越南语`);
      }
      const correct = Number(state[`quiz.${questionIndex}.correctOptionIndex`]);
      if (!Number.isInteger(correct) || correct < 0 || correct >= optionCount) missing.push(`第 ${questionIndex + 1} 题正确选项`);
    }
    const passScore = Number(state.passScore);
    const retries = Number(state.retries);
    if (!Number.isInteger(passScore) || passScore < 1 || passScore > 100) missing.push("通过分数 1-100");
    if (!Number.isInteger(retries) || retries < 0 || retries > 10) missing.push("重试次数 0-10");
    needs("completionCond", "完成条件");
    needs("rewardEvent", "何时发奖");
  } else if (spec.kind === "campaign-edit") {
    ["title", "body", "tier", "audience", "schedule", "budget"].forEach((key) => needs(key, key));
    if (!Number.isFinite(Number(state.budget)) || Number(state.budget) < 0) missing.push("预算数值");
  } else if (spec.kind === "generation-gate") {
    needs("skuId", "SKU");
    needs("releaseMonth", "发布月");
    needs("phase", "发布阶段");
    const month = Number(state.releaseMonth);
    const offset = Number(state.phaseOffset || "0");
    if (!Number.isInteger(month) || month < 1 || month > 12) missing.push("发布月 1-12");
    if (!Number.isInteger(offset) || offset < -12 || offset > 12) missing.push("发布偏移 -12 到 12");
  } else if (spec.kind === "phase-config") {
    needs("label", "阶段名称");
    needs("sortOrder", "排序");
    needs("status", "状态");
    const sort = Number(state.sortOrder);
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) missing.push("排序 0-9999");
    if (state.status && !["active", "archived"].includes(state.status)) missing.push("状态只能为启用 / 已归档");
  } else if (spec.kind === "version-authoring") {
    ["version", "jurisdiction", "languageScope", "effectiveDate", "requiresReack", "zh", "vi"].forEach((key) => needs(key, key));
    if (state.languageScope?.includes("en")) needs("en", "英文正文");
    if ((spec.chapters ?? []).length !== 7) missing.push("完整 7 章节");
    (spec.chapters ?? []).forEach((_chapter, index) => {
      ["no", "zhTitle", "viTitle", "zhBody", "viBody"].forEach((field) => needs(`chapter.${index}.${field}`, `第 ${index + 1} 章 ${field}`));
      if (state.languageScope?.includes("en")) ["enTitle", "enBody"].forEach((field) => needs(`chapter.${index}.${field}`, `第 ${index + 1} 章 ${field}`));
    });
  } else if (spec.kind === "disclosure-jurisdiction") {
    needs("code", "适用范围代码");
    needs("name", "适用范围名称");
    if (spec.mode === "edit" && state.name?.trim() === spec.name) missing.push("名称没有改动");
    if (!DISCLOSURE_JURISDICTION_CODE.test((state.code ?? "").trim().toUpperCase())) missing.push(DISCLOSURE_JURISDICTION_CODE_HELP);
  } else if (spec.kind === "disclosure-publish-review") {
    if (spec.targetChapters.length !== 7) missing.push("完整 7 章节");
    if (spec.targetChapters.some((chapter) => !chapter.zh.trim() || !chapter.vi.trim() || !chapter.zhBody.trim() || !chapter.viBody.trim())) missing.push("七章中越双语完整内容");
    if (state.jurisdictionConfirmed !== "true") missing.push("受众适用地区确认");
    if (state.bilingualConfirmed !== "true") missing.push("七章中越英内容核对");
  } else if (spec.kind === "disclosure-matrix") {
    needs("jurisdictionCode", "适用范围");
    needs("version", "已发布版本");
    needs("countryCodes", "适用国家/地区");
    if (spec.unchanged && state.version === spec.unchanged.version && (state.countryCodes ?? "") === [...spec.unchanged.countryCodes].sort().join(",")) missing.push("版本或适用国家没有改动");
  } else if (spec.kind === "trust-section-authoring") {
    ["version", "description", "structure"].forEach((key) => needs(key, key));
    if (!/^v[1-9][0-9]{0,8}$/.test(state.version ?? "")) missing.push("版本号格式（如 v6）");
    const fieldCount = Number(state.fieldCount || 0);
    if (!Number.isInteger(fieldCount) || fieldCount < 1 || fieldCount > 50) missing.push("结构化字段数量 1-50");
    const fieldKeys: string[] = [];
    for (let index = 0; index < fieldCount; index += 1) {
      needs(`field.${index}.key`, `字段 ${index + 1} 标识`);
      needs(`field.${index}.label`, `字段 ${index + 1} 名称`);
      const fieldKey = state[`field.${index}.key`]?.trim() ?? "";
      if (!isOptionalTrustLinkField(fieldKey)) needs(`field.${index}.value`, `字段 ${index + 1} 内容`);
      fieldKeys.push(fieldKey);
    }
    if (fieldKeys.some((key) => key && !/^[A-Za-z][A-Za-z0-9._-]{0,63}$/.test(key))) missing.push("字段标识格式");
    const normalizedFieldKeys = fieldKeys.filter(Boolean).map((key) => key.toLowerCase());
    if (normalizedFieldKeys.length !== new Set(normalizedFieldKeys).size) missing.push("字段标识不能重复（不区分大小写）");
  } else if (spec.kind === "trust-section-publish") {
    if (spec.requireDataSource) needs("dataSource", "财务/UVT数据来源");
    const trilingual = validateTrustSectionTrilingualFields(spec.targetFields);
    if (!trilingual.valid) missing.push(`中越英字段不完整：${trilingual.missing.join("、")}`);
    if (state.bilingualConfirmed !== "true") missing.push("中越英三语确认");
  } else if (spec.kind === "destructive-reason") {
    if ((spec.requireAck ?? true) && state.ack !== "true") missing.push("影响确认");
  } else if (spec.kind === "identity-verify") {
    needs("channel", "核验渠道");
    needs("verifiedAt", "核验时间");
    needs("ticket", "来源工单号");
    if (state.ack !== "true") missing.push("已核实本人身份确认");
  } else if (spec.kind === "schema-authoring") {
    const labels: Record<string, string> = { eventName: "事件名称", ownerDomain: "所属模块", producer: "产生方", consumer: "使用方", propName: "字段名称", propType: "字段类型", samplingPolicy: "采样规则", version: "版本" };
    Object.entries(labels).forEach(([key, label]) => needs(key, label));
    if (state.eventName && !/^[a-z][a-z0-9_]*\.[a-z0-9]+(?:_[a-z0-9]+)*$/.test(state.eventName.trim())) {
      missing.push("事件名称须使用小写字母，以点号分隔模块与动作、以下划线连接单词，例如 user.account_created");
    }
    if (state.isPII === "true") missing.push("不得登记包含个人隐私明文的字段");
  } else if (spec.kind === "disposition-lifecycle") {
    needs("period", "期限");
    needs("owner", "责任人");
    needs("reviewAt", "复查时间");
  } else if (spec.kind === "balance-adjust") {
    needs("direction", "调整方向");
    needs("currency", "币种");
    needs("voucher", "关联凭证");
    const amt = Number(state.amount);
    if (!Number.isFinite(amt) || amt <= 0) missing.push("调整金额(正数)");
  } else if (spec.kind === "sop-authoring") {
    ([
      ["name", "预案名称"], ["scene", "触发场景"], ["owner", "责任角色"],
      ["sla", "响应时限"], ["actionSeq", "动作序列"], ["rollback", "回滚方案"],
    ] as const).forEach(([key, label]) => needs(key, label));
    if (parseSopSlaMinutes(state.sla) == null) missing.push("响应时限须为 1-1440 分钟整数");
    if ((state.actionSeq ?? "").split("\n").some((line) => line.trim().startsWith("I3·"))) {
      needs("notifyCampaignNo", "I3 通知活动");
    }
  } else if (spec.kind === "j4-execution-confirmation") {
    needs("triggerBasis", "触发依据");
    needs("triggerContext", "触发上下文");
    const contextLength = state.triggerContext?.trim().length ?? 0;
    if (contextLength > 0 && (contextLength < 8 || contextLength > 500)) missing.push("触发上下文须为 8-500 字");
    spec.steps.forEach((_, index) => {
      if (state[`stepConfirm.${index}`] !== "true") missing.push(`确认第 ${index + 1} 步`);
    });
  } else if (spec.kind === "export-wizard") {
    ["exportType", "fields", "piiLevel", "maskPolicy", "recipient", "ticket"].forEach((k) => needs(k, k));
    if (spec.kpiStructuredRange && isL5KpiExport(state.exportType ?? "")) {
      try { l5KpiRange(state); } catch (error) { missing.push((error as Error).message); }
    } else needs("timeRange", "时间范围");
  } else if (spec.kind === "task-edit") {
    needs("name", "任务名称");
    needs("path", "跳转路径");
    needs("reward", "奖励");
    needs("status", "状态");
    needs("completionType", "完成判定方式");
    if (state.reward && !/\d/.test(state.reward)) missing.push("奖励需含数字");
    if (state.completionType === "event" && !state.completionEvent?.trim()) missing.push("业务事件名(完成判定=业务事件 时必填)");
  } else if (spec.kind === "day-one-window") {
    needs("activeHours", "满额窗(小时)");
    needs("graceHours", "宽限窗(小时)");
    const a = Number(state.activeHours), g = Number(state.graceHours);
    if (!Number.isFinite(a) || a <= 0) missing.push("满额窗须为正数");
    else if (!Number.isFinite(g) || g < a) missing.push("宽限窗须 ≥ 满额窗");
  } else if (spec.kind === "day-one-tri-reward") {
    needs("active", "满额奖励");
    needs("grace", "宽限奖励");
    needs("expired", "过期奖励");
    const a = Number(state.active), g = Number(state.grace), e = Number(state.expired);
    if (![a, g, e].every((n) => Number.isFinite(n) && n >= 0)) missing.push("三档须为非负数");
    else if (a < g || g < e) missing.push("须满额 ≥ 宽限 ≥ 过期");
  } else if (spec.kind === "multi-field") {
    const feedback = spec.feedback?.(state);
    if (feedback?.invalid) missing.push(feedback.message);
    const isVisible = (field: (typeof spec.fields)[number]) =>
      !field.visibleWhen || (state[field.visibleWhen.key] ?? "") === field.visibleWhen.equals;
    spec.fields.filter((f) => isVisible(f) && f.required !== false).forEach((f) => needs(f.key, f.label));
    missing.push(...Object.values(multiFieldIssues(spec, state)));
    spec.fields.filter((f) => f.requiredWhenAddedTo).forEach((f) => {
      const target = spec.fields.find((candidate) => candidate.key === f.requiredWhenAddedTo);
      if (!target) return;
      const before = new Set((target.current ?? "").split(",").map((item) => item.trim()).filter(Boolean));
      const after = (state[target.key] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      if (after.some((item) => !before.has(item))) needs(f.key, f.label);
    });
    if (spec.requireAnyChange) {
      const normalize = (field: (typeof spec.fields)[number], raw: string | undefined) => {
        const value = (raw ?? "").trim();
        if (field.inputKind === "number" && value && Number.isFinite(Number(value))) return String(Number(value));
        return value;
      };
      const changed = spec.fields.filter(isVisible).some((field) =>
        normalize(field, state[field.key]) !== normalize(field, field.current));
      if (!changed) missing.push("至少一个字段须发生变化");
    }
    const nums = spec.fields.filter((f) => isVisible(f) && f.inputKind === "number").map((f) => ({ f, n: Number(state[f.key]) }));
    const hasInvalidNumber = nums.some(({ n }) => !Number.isFinite(n));
    if (hasInvalidNumber) missing.push("数值字段须为有效数字");
    if (!hasInvalidNumber && spec.ascending) {
      for (let i = 1; i < nums.length; i++) {
        if (nums[i].n <= nums[i - 1].n) { missing.push(`${nums[i].f.label} 须大于 ${nums[i - 1].f.label}`); break; }
      }
    }
  } else if (spec.kind === "weekly-task-edit") {
    needs("cond", "条件/任务");
    needs("reward", "奖励");
    needs("status", "状态");
    needs("completionType", "完成判定方式");
    if (state.reward && !/\d/.test(state.reward)) missing.push("奖励需含数字");
    if (state.completionType === "event" && !state.completionEvent?.trim()) missing.push("业务事件名(完成判定=业务事件 时必填)");
  } else if (spec.kind === "monthly-task-edit") {
    needs("theme", "主题");
    needs("age", "账龄段");
    needs("reward", "奖励");
    needs("goals", "子目标");
    needs("status", "状态");
    if (state.reward && !/\d/.test(state.reward)) missing.push("奖励需含数字");
  } else if (spec.kind === "promo-banner-edit") {
    needs("baseReward", "基础奖励");
    needs("multiplier", "倍率");
    needs("countdownDays", "倒计时天");
    needs("countdownHours", "倒计时时");
    needs("targetDevice", "目标设备");
    needs("targetDaily", "日产");
    needs("status", "状态");
    ["baseReward", "multiplier", "countdownDays", "countdownHours"].forEach((k) => {
      const v = state[k];
      if (v && (!Number.isFinite(Number(v)) || Number(v) < 0)) missing.push(`${k} 须为非负数字`);
    });
  } else if (spec.kind === "voucher-config") {
    needs("name", "名称");
    needs("type", "类型");
    needs("audience", "受众");
    needs("status", "状态");
    if (state.type === "fixed") {
      const a = Number(state.amountUSD);
      if (!Number.isFinite(a) || a < 1 || a > 1_000_000) missing.push("满减面值(1–1,000,000 USDT)");
    } else if (state.type === "percent") {
      const p = Number(state.percent);
      if (!Number.isInteger(p) || p < 1 || p > 99) missing.push("折扣率须为 1–99 的整数");
    }
    const surfs = (state.claimSurfaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (surfs.some((s) => !["home", "store", "me", "earn"].includes(s))) missing.push("领取入口仅限 home/store/me/earn");
    const issuanceLimit = Number(state.issuanceLimit);
    if (!Number.isSafeInteger(issuanceLimit) || issuanceLimit < 0 || issuanceLimit > 10_000_000) {
      missing.push("发行上限须为 0-10000000 的整数");
    }
    const delay = Number(state.popupDelayMs);
    const cooldown = Number(state.popupCooldownHours);
    const cap = Number(state.popupMaxPerSession);
    if (!Number.isSafeInteger(delay) || delay < 0 || delay > 60000) missing.push("弹窗延迟须为 0-60000 毫秒");
    if (!Number.isSafeInteger(cooldown) || cooldown < 0 || cooldown > 720) missing.push("弹窗冷却须为 0-720 小时");
    if (!Number.isSafeInteger(cap) || cap < 1 || cap > 10) missing.push("单会话上限须为 1-10 次");
  } else if (spec.kind === "quest-event-config") {
    const target = state.targetValue?.trim();
    if (target && (!Number.isInteger(Number(target)) || Number(target) < 1 || Number(target) > 1_000_000_000)) {
      missing.push("目标值须为 1–1,000,000,000 的整数");
    }
  } else if (spec.kind === "vrank-reward-edit") {
    needs("rtype", "奖励类型");
    if (state.rtype === "usdt" || state.rtype === "uvt") {
      const a = Number(state.amount);
      if (!Number.isFinite(a) || a <= 0) missing.push("奖励金额(正数)");
    } else if (state.rtype === "voucher") {
      if (!spec.voucherOptions?.includes(state.voucherId)) missing.push("请选择当前可发放的代金券");
    } else if (state.rtype === "sku") {
      if (!spec.skuOptions?.includes(state.skuId)) missing.push("请选择当前可用的系统 商品");
    } else if (state.rtype === "custom") {
      needs("custom", "自定义奖励内容");
    }
  } else if (spec.kind === "mission-create") {
    needs("missionCode", "任务编号");
    needs("missionName", "任务名称");
    needs("rewardPoints", "奖励 UVT 数");
    needs("category", "任务类别");
    needs("actionRoute", "去完成页面");
    if (!Number.isSafeInteger(Number(state.rewardPoints)) || Number(state.rewardPoints) < 0) {
      missing.push("奖励 UVT 数须为非负整数");
    }
  }
  return missing;
}

function businessNewValue(spec: BusinessFormSpec | undefined, state: BusinessFormValue): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === "role-select") return state.role;
  if (spec.kind === "permission-matrix") return spec.roles.map((r) => state[`grant.${r.key}`]).join("/");
  if (spec.kind === "copy-edit") return state.version;
  if (spec.kind === "copy-create") return state.copyKey;
  if (spec.kind === "copy-position-create") return state.positionKey;
  if (spec.kind === "copy-version-option") return state.versionKey;
  if (spec.kind === "copy-experiment-create") return state.copyKey;
  if (spec.kind === "copy-experiment-start") return state.ack;
  if (spec.kind === "copy-experiment-discard") return spec.experimentId;
  if (spec.kind === "version-authoring") return state.version;
  if (spec.kind === "trust-section-authoring") return `${spec.sectionKey}@${state.version}`;
  if (spec.kind === "trust-section-publish") return `${spec.currentVersion}→${spec.targetVersion}`;
  if (spec.kind === "course-authoring") return state.slug;
  if (spec.kind === "campaign-edit") return state.title;
  if (spec.kind === "generation-gate") return `${state.skuId}@M${state.releaseMonth}`;
  if (spec.kind === "phase-config") return state.label;
  if (spec.kind === "schema-authoring") return state.eventName;
  if (spec.kind === "disposition-lifecycle") return state.period;
  if (spec.kind === "balance-adjust") return state.amount;
  if (spec.kind === "sop-authoring") return state.name;
  if (spec.kind === "export-wizard") return state.exportType;
  if (spec.kind === "task-edit") return `${state.name}(${state.reward}${state.status && state.status !== "active" ? " · " + state.status : ""} · ${state.completionType ?? "visit"})`;
  if (spec.kind === "day-one-window") return `${state.activeHours}h / ${state.graceHours}h`;
  if (spec.kind === "day-one-tri-reward") return `${state.active}/${state.grace}/${state.expired}`;
  if (spec.kind === "multi-field") return spec.fields.map((f) => state[f.key]).filter((v) => v != null && v !== "").join(" / ") || undefined;
  if (spec.kind === "weekly-task-edit") return state.cond && state.reward ? `${state.cond}(${state.reward})` : undefined;
  if (spec.kind === "monthly-task-edit") return state.theme && state.reward ? `${state.theme}(${state.reward})` : undefined;
  if (spec.kind === "voucher-config") return state.name || undefined;
  if (spec.kind === "promo-banner-edit") {
    const f = Number(state.baseReward) * Number(state.multiplier);
    return Number.isFinite(f) ? `${Math.round(f)} UVT(${state.baseReward}×${state.multiplier})` : undefined;
  }
  if (spec.kind === "vrank-reward-edit") {
    const t = state.rtype;
    if (t === "usdt") return state.amount ? `USDT $${state.amount}` : undefined;
    if (t === "uvt") return state.amount ? `${Number(state.amount).toLocaleString()} UVT` : undefined;
    if (t === "voucher") return state.voucherId ? `代金券 ${spec.voucherLabels?.[state.voucherId] ?? state.voucherId}` : undefined;
    if (t === "sku") return state.skuId ? `SKU ${spec.skuLabels?.[state.skuId] ?? state.skuId}` : undefined;
    if (t === "custom") return state.custom || undefined;
    return undefined;
  }
  return undefined;
}

export function BusinessFormBlock({ spec, value, attempted = false, onChange, onSelectionChange, onUploadStateChange }: { spec: BusinessFormSpec; value: BusinessFormValue; /** 点过提交：multi-field 的校验提示刚打开不报，失焦或点过提交才报（VS-107）。 */ attempted?: boolean; onChange: (next: BusinessFormValue) => void; onSelectionChange?: (next: BusinessFormValue) => void; onUploadStateChange: (key: string, state: "uploading" | "failed" | undefined) => void }) {
  // 改版页面里必填写星号（CP-52），不写红色的「· 必填」。
  const surface = useRdSurface();
  const formId = useId();
  const [formLeft, setFormLeft] = useState(false);
  const [leftFields, setLeftFields] = useState<Record<string, boolean>>({});
  const [multiSelectSearch, setMultiSelectSearch] = useState<Record<string, string>>({});
  const [assetUploading, setAssetUploading] = useState<Record<string, boolean>>({});
  const [assetNames, setAssetNames] = useState<Record<string, string>>({});
  const [assetErrors, setAssetErrors] = useState<Record<string, string>>({});
  const assetInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const latestValueRef = useRef(value);
  useEffect(() => { latestValueRef.current = value; }, [value]);
  const set = (key: string, v: string) => {
    const changed = { ...latestValueRef.current, [key]: v };
    const next = spec.kind === "multi-field" && spec.onFieldChange ? spec.onFieldChange(key, changed) : changed;
    latestValueRef.current = next;
    onChange(next);
  };
  // 改版页面用 rd 下拉，和框里别的控件同高同样子；旧页面仍是原生下拉（CP-57）。
  const choice = ({ label, proof, current, disabled, onValue, options }: { label: string; proof?: string; current: string; disabled?: boolean; onValue: (next: string) => void; options: readonly { value: string; label: ReactNode; disabled?: boolean }[] }) => surface
    ? <RdSelect aria-label={label} data-proof={proof} value={current} disabled={disabled} onChange={onValue} options={options} />
    : <select className="fld" aria-label={label} data-proof={proof} value={current} disabled={disabled} onChange={(event) => onValue(event.target.value)}>{options.map((o) => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}</select>;
  const textArea = (key: string, label: string, placeholder: string, rows = 3, maxLength?: number) => (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <textarea rows={rows} maxLength={maxLength} value={value[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  );
  const input = (key: string, label: ReactNode, placeholder: string, type = "text", maxLength?: number) => surface ? (
    <RdField label={label}>{(control) => <RdInput {...control} type={type} maxLength={maxLength} value={value[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />}</RdField>
  ) : (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <input className="fld" type={type} maxLength={maxLength} value={value[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  );
  const select = (key: string, label: string, options: string[], proofOrLabels?: string | Record<string, ReactNode>, optionLabels?: Record<string, ReactNode>, onValueChange?: (next: string) => void, unavailableLabel?: string) => {
    const proof = typeof proofOrLabels === "string" ? proofOrLabels : undefined;
    const labels = typeof proofOrLabels === "string" ? optionLabels : proofOrLabels;
    const current = value[key] ?? options[0] ?? "";
    const displayOption = (option: string) => ({ UVT: "UVT", uvt: "UVT", server: "服务器", client: "客户端", "server+client": "服务器与客户端", string: "文本", number: "数值", boolean: "是或否", enum: "固定选项", timestamp: "时间", id: "编号", "无 PII": "无个人隐私信息", "低(脱敏 ID)": "仅部分隐藏的编号", "默认脱敏": "默认隐藏敏感信息", "上架中 active": "上架中", "已下架 paused": "已下架", "超管": "超级管理员" } as Record<string, string>)[option] ?? option.replace(/^KPI/, "关键指标").replace(/\bStaking\b/g, "质押").replace(/\bGenesis\b/g, "创世节点").replace(/([\u3400-\u9fff])\s+(?:active|paused|fixed|percent|new|all|true|false)\b/g, "$1");
    const choiceOptions = [
      ...(unavailableLabel && !options.includes(current) ? [{ value: current, label: unavailableLabel, disabled: true }] : []),
      ...(options.length === 0 ? [{ value: "", label: "暂无可选项" }] : options.map((o) => ({ value: o, label: typeof labels?.[o] === "string" ? displayOption(String(labels[o])) : labels?.[o] ?? displayOption(o) }))),
    ];
    const onValue = (next: string) => onValueChange ? onValueChange(next) : set(key, next);
    if (surface) return <RdField label={label}>{(control) => <RdSelect {...control} aria-label={label} data-proof={proof} value={current} disabled={options.length === 0} onChange={onValue} options={choiceOptions} />}</RdField>;
    return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      {choice({ label, proof, current, disabled: options.length === 0, onValue, options: choiceOptions })}
    </label>
    );
  };

  // Multi-select chip group — stores a comma-joined string in BusinessFormValue
  // (Record<string,string>-compatible). Inline-styled with V5 tokens so it renders
  // regardless of modal scope/portal. Operators TAP options instead of typing
  // (less input, no typos — 多视角预置设计铁律).
  const multiSelect = (key: string, label: string, options: string[], proof?: string, labels?: Record<string, ReactNode>, searchable = false, initialValue = "", showDiff = false) => {
    const sel = (value[key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const initial = initialValue.split(",").map((s) => s.trim()).filter(Boolean);
    const query = (multiSelectSearch[key] ?? "").trim().toLocaleLowerCase();
    const matched = query
      ? options.filter((o) => `${o} ${plainText(labels?.[o])}`.toLocaleLowerCase().includes(query))
      : options;
    const visible = searchable && !query && matched.length > 40
      ? [...new Set([...sel, ...matched.slice(0, 40)])]
      : matched;
    const toggle = (o: string) => {
      const next = sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
      set(key, next.join(","));
    };
    return (
      <div className="field" style={{ marginBottom: 0 }}>
        <span>{label}</span>
        {searchable && options.length > 0 && (
          <input
            className="fld"
            type="search"
            aria-label={`${label}搜索`}
            value={multiSelectSearch[key] ?? ""}
            onChange={(e) => setMultiSelectSearch((current) => ({ ...current, [key]: e.target.value }))}
            placeholder="搜索国家代码或名称"
            style={{ marginTop: 6 }}
          />
        )}
        <div data-proof={proof} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6, maxHeight: searchable ? 220 : undefined, overflowY: searchable ? "auto" : undefined }}>
          {options.length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>当前没有可选项</span>
          ) : visible.length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>未找到匹配的国家或地区</span>
          ) : (
            visible.map((o) => {
              const on = sel.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    fontWeight: on ? 600 : 500,
                    padding: "4px 11px",
                    borderRadius: 999,
                    cursor: "pointer",
                    background: on ? "var(--brand)" : "var(--surface-3)",
                    color: on ? "var(--v5-on-brand)" : "var(--ink-2)",
                    border: `1px solid ${on ? "var(--brand)" : "var(--border)"}`,
                  }}
                >
                  {on ? "✓ " : ""}{labels?.[o] ?? o}
                </button>
              );
            })
          )}
        </div>
        {searchable && !query && options.length > visible.length && (
          <span className="tiny muted" style={{ display: "block", marginTop: 6 }}>当前显示 {visible.length} / {options.length} 项，输入代码或名称可继续筛选</span>
        )}
        {showDiff && (() => {
          const added = sel.filter((item) => !initial.includes(item));
          const removed = initial.filter((item) => !sel.includes(item));
          const labelOf = (item: string) => plainText(labels?.[item]) || item;
          return (
            <div className="tiny" data-proof={`diff-${key}`} style={{ display: "grid", gap: 4, marginTop: 8 }}>
              <span style={{ color: added.length ? "var(--v5-success)" : "var(--ink-4)" }}>新增：{added.length ? added.map(labelOf).join("、") : "无"}</span>
              <span style={{ color: removed.length ? "var(--v5-warning)" : "var(--ink-4)" }}>移除：{removed.length ? removed.map(labelOf).join("、") : "无"}</span>
            </div>
          );
        })()}
      </div>
    );
  };

  if (spec.kind === "multi-field") {
    const visibleFields = spec.fields.filter((field) => {
      if (field.visibleWhen && (value[field.visibleWhen.key] ?? "") !== field.visibleWhen.equals) return false;
      if (!field.requiredWhenAddedTo) return true;
      const target = spec.fields.find((candidate) => candidate.key === field.requiredWhenAddedTo);
      if (!target) return false;
      const initial = (target.current ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      const next = (value[target.key] ?? "").split(",").map((item) => item.trim()).filter(Boolean);
      return next.some((item) => !initial.includes(item));
    });
    // 改版页面不写「填写设置」：框的标题已经说了，小标题和字段名叠在一起（VS-104）。
    const legend = spec.title ?? (surface ? undefined : "填写设置");
    const feedback = spec.feedback?.(value);
    const issues = surface ? multiFieldIssues(spec, value) : {};
    const fieldError = (key: string) => (attempted || leftFields[key] ? issues[key] : undefined) ?? (feedback?.invalid && feedback.field === key && (attempted || formLeft) ? feedback.message : undefined);
    // 只有一项时占满一行，不留半边空。
    const alone = surface && visibleFields.length === 1;
    const fieldName = (f: (typeof spec.fields)[number]) => <>
      {f.label}{surface ? f.required !== false ? <span className="rd-form-required" aria-hidden="true">*</span> : <span className="rd-form-hint">选填</span> : f.required !== false && <> <b style={{ color: "var(--v5-danger)" }}>· 必填</b></>}
      {surface && f.explain && <Explain label={`${f.label}的说明`} content={f.explain} />}
    </>;
    const onFormBlur = (event: FocusEvent<HTMLDivElement>) => {
      setFormLeft(true);
      const key = event.target.id.startsWith(`${formId}-`) ? event.target.id.slice(formId.length + 1) : "";
      if (key) setLeftFields((current) => current[key] ? current : { ...current, [key]: true });
    };
    // 改版页面：字段用 rd 的 Field 和控件画，名字、取值、校验和 id 与旧画法相同（VS-104、CP-52）。
    if (surface) return (
      <div className="rd-business-form" data-business-form="multi-field" onBlur={onFormBlur}>
        {legend && <div className="rd-form-group-title">{legend}</div>}
        <div className="rd-form-grid" data-cols={alone ? undefined : "2"} data-dense="">
          {visibleFields.map((f) => {
            const span = f.wide || alone ? { gridColumn: "1 / -1" } : undefined;
            const id = `${formId}-${f.key}`;
            const error = fieldError(f.key);
            const help = f.help && !error ? (f.inputKind === "date" && value[f.key] ? `已选 ${value[f.key]}，${f.help}` : f.help) : undefined;
            const warning = f.warning?.(value) ?? (f.warnAbove != null && Number(value[f.key]) > f.warnAbove ? f.warnText ?? `已超过 ${f.warnAbove} 的建议上限` : undefined);
            if (f.inputKind === "multi-select") return <div key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>{multiSelect(f.key, f.label, f.options ?? [], `multi-select-${f.key}`, f.optionLabels, f.searchable, f.current, f.showDiff)}</div>;
            if (f.inputKind === "checkbox") return (
              <div key={f.key} className="rd-form-field" style={span}>
                <RdCheck id={id} label={<>{f.label}{f.required === false && <span className="rd-form-hint">选填</span>}</>} explain={f.explain} help={help} required={f.required !== false} aria-required={f.required !== false} aria-invalid={error ? true : undefined} checked={value[f.key] === "true"} onChange={(e) => set(f.key, e.target.checked ? "true" : "")} />
                {warning && <div role="status" className="rd-form-warning">{warning}</div>}
                {error && <div role="alert" className="rd-form-error">{error}</div>}
              </div>
            );
            if (f.inputKind === "asset-upload") return (
              <div key={f.key} className="rd-form-field" style={span}>
                <label className="rd-form-label" htmlFor={id}>{f.label}{f.required !== false ? <span className="rd-form-required" aria-hidden="true">*</span> : <span className="rd-form-hint">选填</span>}{f.explain && <Explain label={`${f.label}的说明`} content={f.explain} />}</label>
                <input
                  id={id}
                  className="rd-input rd-file-input"
                  type="file"
                  accept={f.accept ?? "image/jpeg,image/png,image/webp"}
                  aria-label={f.label}
                  required={f.required !== false}
                  aria-required={f.required !== false}
                  disabled={assetUploading[f.key]}
                  ref={(input) => { assetInputs.current[f.key] = input; }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    setAssetErrors((current) => ({ ...current, [f.key]: "" }));
                    if (!file) {
                      onUploadStateChange(f.key, undefined);
                      return;
                    }
                    if (!(f.accept ?? "image/jpeg,image/png,image/webp").split(",").includes(file.type) || file.size > 10 * 1024 * 1024) {
                      onUploadStateChange(f.key, "failed");
                      setAssetErrors((current) => ({ ...current, [f.key]: "请选择允许的图片格式，大小不超过 10 MB。" }));
                      return;
                    }
                    onUploadStateChange(f.key, "uploading");
                    setAssetUploading((current) => ({ ...current, [f.key]: true }));
                    const upload = f.uploadPurpose === "vietqr-receipt"
                      ? uploadD1VietQrReceiptEvidence(file)
                      : uploadAdminMedia(file, {
                          domain: f.uploadDomain ?? "shared",
                          usage: f.uploadUsage ?? "general",
                          entityType: "MEDIA_ASSET",
                          operator: f.uploadOperator,
                        });
                    void upload.then((asset) => {
                      set(f.key, asset.assetId);
                      setAssetNames((current) => ({ ...current, [f.key]: file.name }));
                      onUploadStateChange(f.key, undefined);
                    }).catch((error) => {
                      onUploadStateChange(f.key, "failed");
                      setAssetErrors((current) => ({
                        ...current,
                        [f.key]: displayAdminError(error),
                      }));
                    }).finally(() => {
                      setAssetUploading((current) => ({ ...current, [f.key]: false }));
                    });
                  }}
                />
                <div className="rd-form-help">
                  {assetUploading[f.key] ? "正在上传并校验图片…" : assetNames[f.key] ? `已上传：${assetNames[f.key]}` : (f.help ?? "请上传清晰的银行回单截图")}
                </div>
                {assetErrors[f.key] && <div role="alert" className="rd-form-error">{assetErrors[f.key]}</div>}
                {!assetUploading[f.key] && (value[f.key] || assetNames[f.key] || assetErrors[f.key]) && (
                  <div><RdButton size="sm" onClick={(event) => {
                    event.preventDefault();
                    set(f.key, "");
                    setAssetNames((current) => ({ ...current, [f.key]: "" }));
                    setAssetErrors((current) => ({ ...current, [f.key]: "" }));
                    if (assetInputs.current[f.key]) assetInputs.current[f.key]!.value = "";
                    onUploadStateChange(f.key, undefined);
                  }}>{f.required === false ? "移除图片" : "清除图片并重新上传"}</RdButton></div>
                )}
              </div>
            );
            return (
              <div key={f.key} style={span}>
                <RdField id={id} label={f.label} required={f.required !== false} hint={f.required === false ? "选填" : undefined} explain={f.explain} help={help} error={error}>
                  {(control) => <>
                    {f.inputKind === "select" ? (
                      <RdSelect {...control} aria-label={f.label} required={f.required !== false} placeholder={f.mustChoose ? "请选择" : undefined}
                        value={value[f.key] ?? (f.mustChoose ? "" : f.options?.[0]) ?? ""} onChange={(next) => set(f.key, next)}
                        options={(f.options ?? []).map((o) => ({ value: o, label: f.optionLabels?.[o] ?? o }))} />
                    ) : f.inputKind === "number" ? (
                      <RdNumberInput {...control} min={f.min} max={f.max} step={f.step} required={f.required !== false} aria-required={f.required !== false} value={value[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder ?? ""} />
                    ) : (
                      <RdInput {...control} type={f.inputKind === "datetime-local" || f.inputKind === "date" ? f.inputKind : "text"} minLength={f.minLength} maxLength={f.maxLength} required={f.required !== false} aria-required={f.required !== false} value={value[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder ?? ""} />
                    )}
                    {warning && <div role="status" className="rd-form-warning">{warning}</div>}
                  </>}
                </RdField>
              </div>
            );
          })}
        </div>
        {feedback?.message && (!feedback.invalid
          ? <div role="status" className="rd-form-help">{feedback.message}</div>
          // 填错是「要你处理」：橙黄，刚打开不报，失焦或点过提交才报（VS-107）。
          : !feedback.field && (attempted || formLeft) && <div role="alert" className="rd-form-error">{feedback.message}</div>)}
        {spec.hint && <div className="rd-form-help">{spec.hint}</div>}
      </div>
    );
    return (
      <div className="field" data-business-form="multi-field" onBlur={(event) => {
        setFormLeft(true);
        const key = event.target.id.startsWith(`${formId}-`) ? event.target.id.slice(formId.length + 1) : "";
        if (key) setLeftFields((current) => current[key] ? current : { ...current, [key]: true });
      }}>
        {legend && <span className="bf-legend">{legend}</span>}
        <div className="grid g-2" style={{ gap: 10 }}>
          {visibleFields.map((f) => f.inputKind === "multi-select" ? (
            <div key={f.key} style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
              {multiSelect(f.key, f.label, f.options ?? [], `multi-select-${f.key}`, f.optionLabels, f.searchable, f.current, f.showDiff)}
            </div>
          ) : f.inputKind === "asset-upload" ? (
            <label className="field" style={{ marginBottom: 0, ...(f.wide || alone ? { gridColumn: "1 / -1" } : {}) }} key={f.key}>
              <span>{fieldName(f)}</span>
              <input
                className="fld"
                type="file"
                accept={f.accept ?? "image/jpeg,image/png,image/webp"}
                aria-label={f.label}
                required={f.required !== false}
                aria-required={f.required !== false}
                disabled={assetUploading[f.key]}
                ref={(input) => { assetInputs.current[f.key] = input; }}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  setAssetErrors((current) => ({ ...current, [f.key]: "" }));
                  if (!file) {
                    onUploadStateChange(f.key, undefined);
                    return;
                  }
                  if (!(f.accept ?? "image/jpeg,image/png,image/webp").split(",").includes(file.type) || file.size > 10 * 1024 * 1024) {
                    onUploadStateChange(f.key, "failed");
                    setAssetErrors((current) => ({ ...current, [f.key]: "请选择允许的图片格式，大小不超过 10 MB。" }));
                    return;
                  }
                  onUploadStateChange(f.key, "uploading");
                  setAssetUploading((current) => ({ ...current, [f.key]: true }));
                  const upload = f.uploadPurpose === "vietqr-receipt"
                    ? uploadD1VietQrReceiptEvidence(file)
                    : uploadAdminMedia(file, {
                        domain: f.uploadDomain ?? "shared",
                        usage: f.uploadUsage ?? "general",
                        entityType: "MEDIA_ASSET",
                        operator: f.uploadOperator,
                      });
                  void upload.then((asset) => {
                    set(f.key, asset.assetId);
                    setAssetNames((current) => ({ ...current, [f.key]: file.name }));
                    onUploadStateChange(f.key, undefined);
                  }).catch((error) => {
                    onUploadStateChange(f.key, "failed");
                    setAssetErrors((current) => ({
                      ...current,
                      [f.key]: displayAdminError(error),
                    }));
                  }).finally(() => {
                    setAssetUploading((current) => ({ ...current, [f.key]: false }));
                  });
                }}
              />
              <span className="tiny muted">
                {assetUploading[f.key] ? "正在上传并校验图片…" : assetNames[f.key] ? `已上传：${assetNames[f.key]}` : (f.help ?? "请上传清晰的银行回单截图")}
              </span>
              {assetErrors[f.key] && <span role="alert" className="tiny" style={{ color: "var(--v5-danger)" }}>{assetErrors[f.key]}</span>}
              {!assetUploading[f.key] && (value[f.key] || assetNames[f.key] || assetErrors[f.key]) && (
                <button type="button" className="l-btn sm" onClick={(event) => {
                  event.preventDefault();
                  set(f.key, "");
                  setAssetNames((current) => ({ ...current, [f.key]: "" }));
                  setAssetErrors((current) => ({ ...current, [f.key]: "" }));
                  if (assetInputs.current[f.key]) assetInputs.current[f.key]!.value = "";
                  onUploadStateChange(f.key, undefined);
                }}>{f.required === false ? "移除图片" : "清除图片并重新上传"}</button>
              )}
            </label>
          ) : (
            // htmlFor 写明：字段名里的提示图标也是按钮，不写的话 label 会连到它而不是输入框。
            <label className="field" htmlFor={`${formId}-${f.key}`} style={{ marginBottom: 0, ...(f.wide || alone ? { gridColumn: "1 / -1" } : {}) }} key={f.key}>
              <span>{fieldName(f)}</span>
              {f.inputKind === "select" && surface ? (
                <RdSelect id={`${formId}-${f.key}`} aria-label={f.label} required={f.required !== false} aria-invalid={fieldError(f.key) ? true : undefined} placeholder={f.mustChoose ? "请选择" : undefined}
                  value={value[f.key] ?? (f.mustChoose ? "" : f.options?.[0]) ?? ""} onChange={(next) => set(f.key, next)}
                  options={(f.options ?? []).map((o) => ({ value: o, label: f.optionLabels?.[o] ?? o }))} />
              ) : f.inputKind === "select" ? (
                // 能枚举的值用下拉,不让运营手输(最高设计铁律:能勾选的不要输入)
                <select id={`${formId}-${f.key}`} className="fld" required={f.required !== false} aria-required={f.required !== false} value={value[f.key] ?? (f.mustChoose ? "" : f.options?.[0]) ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                  {f.mustChoose && <option value="" disabled>请选择</option>}
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{f.optionLabels?.[o] ?? o}</option>)}
                </select>
              ) : f.inputKind === "checkbox" ? (
                <input id={`${formId}-${f.key}`} type="checkbox" required={f.required !== false} aria-required={f.required !== false} checked={value[f.key] === "true"} onChange={(e) => set(f.key, e.target.checked ? "true" : "")} />
              ) : (
                <input id={`${formId}-${f.key}`} className="fld" type={f.inputKind === "number" ? "number" : f.inputKind === "datetime-local" || f.inputKind === "date" ? f.inputKind : "text"} min={f.min} max={f.max} step={f.step} minLength={f.minLength} maxLength={f.maxLength} required={f.required !== false} aria-required={f.required !== false} aria-invalid={surface && fieldError(f.key) ? true : undefined} value={value[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder ?? ""} />
              )}
              {/* 填错时错误顶替说明那一行（VS-103）；日期框的显示格式跟浏览器走，选好后用全站的 YYYY-MM-DD 回显一次（DT-14）。 */}
              {f.help && !(surface && fieldError(f.key)) && <span className="tiny muted">{surface && f.inputKind === "date" && value[f.key] ? `已选 ${value[f.key]}，${f.help}` : f.help}</span>}
              {surface && fieldError(f.key) && <span role="alert" className="rd-form-error">{fieldError(f.key)}</span>}
              {f.warning?.(value) && <span role="status" className="tiny" style={{ color: "var(--v5-warning)" }}>{f.warning(value)}</span>}
              {f.warnAbove != null && Number(value[f.key]) > f.warnAbove && (
                <span className="tiny" style={{ display: "block", marginTop: 4, color: "var(--v5-warning)", fontWeight: 600 }}>
                  ⚠ {f.warnText ?? `已超过 ${f.warnAbove} 的建议上限`}
                </span>
              )}
            </label>
          ))}
        </div>
        {feedback?.message && (!surface
          ? <div role="status" className={`tint ${feedback.invalid ? "danger" : ""}`} style={{ marginTop: 10 }}>{feedback.message}</div>
          : !feedback.invalid
            ? <div role="status" className="rd-form-help" style={{ marginTop: 8 }}>{feedback.message}</div>
            // 填错是「要你处理」：橙黄，刚打开不报，失焦或点过提交才报（VS-107）。
            : !feedback.field && (attempted || formLeft) && <div role="alert" className="rd-form-error" style={{ marginTop: 8 }}>{feedback.message}</div>)}
        {spec.hint && <div className={surface ? "rd-form-help" : "tint tiny"} style={{ marginTop: surface ? 8 : 10 }}>{spec.hint}</div>}
      </div>
    );
  }
  if (spec.kind === "role-select") {
    return (
      <div className="field" data-business-form="role-select">
        <span className="bf-legend">改角色</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("role", "目标角色", spec.roles.map((r) => r.key), "role-select-target", Object.fromEntries(spec.roles.map((r) => [r.key, r.label])))}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          {spec.roles.map((r) => (
            <button key={r.key} className={"chip" + (value.role === r.key ? " sel" : "")} onClick={() => set("role", r.key)} type="button">
              {r.label}<span className="muted tiny"> · {r.key}</span>
            </button>
          ))}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          当前 <span className="mono">{spec.currentRole}</span> → 目标 <span className="mono">{businessNewValue(spec, value)}</span>
          {spec.guardHint ? <> · {spec.guardHint}</> : null}
        </div>
        {spec.actions && spec.grantsByRole && (() => {
          const rankOf = (g: string): number => (({ "-": 0, R: 1, M: 2, C: 3 } as Record<string, number>)[g] ?? 0);
          const cur = spec.grantsByRole?.[spec.currentRole] ?? [];
          const next = spec.grantsByRole?.[value.role] ?? [];
          const gained: string[] = [];
          const lost: string[] = [];
          const domains = new Set<string>();
          (spec.actions ?? []).forEach((a, i) => {
            const c = cur[i] ?? "-";
            const n = next[i] ?? "-";
            if (c === n) return;
            domains.add(a.domainGroup ?? "—");
            (rankOf(n) > rankOf(c) ? gained : lost).push(`${a.label}:${c}→${n}`);
          });
          if (value.role === spec.currentRole) {
            return <div className="tint tiny" data-proof="role-perm-diff" style={{ marginTop: 8 }}>选择新角色后可预览权限变化。</div>;
          }
          return (
            <div className="tint tiny" data-proof="role-perm-diff" style={{ marginTop: 8 }}>
              <div><b>权限变化</b> · 涉及：<span className="mono">{[...domains].join(" / ") || "无"}</span></div>
              <div style={{ color: "var(--success)", marginTop: 3 }}>新增/提升 {gained.length} 项{gained.length ? ":" + gained.slice(0, 6).join("; ") + (gained.length > 6 ? "…" : "") : ""}</div>
              <div style={{ color: "var(--danger)", marginTop: 3 }}>移除/降低 {lost.length} 项{lost.length ? ":" + lost.slice(0, 6).join("; ") + (lost.length > 6 ? "…" : "") : ""}</div>
            </div>
          );
        })()}
      </div>
    );
  }

  if (spec.kind === "permission-matrix") {
    const grants = spec.grantOptions ?? DEFAULT_GRANTS;
    const diffs = spec.roles.filter((r) => (value[`grant.${r.key}`] ?? r.current) !== r.current);
    return (
      <div className="field" data-business-form="permission-matrix">
        <span className="bf-legend">权限设置{spec.actionLabel ? <> · {spec.actionLabel}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.roles.map((r) => (
            <label key={r.key} className="field" style={{ marginBottom: 0 }}>
              <span>{r.label} 授权 · 当前 <span className="mono">{r.current}</span></span>
              {choice({ label: `${r.label} 授权`, proof: `permission-grant-${r.key}`, current: value[`grant.${r.key}`] ?? r.current, onValue: (next) => set(`grant.${r.key}`, next), options: grants.map((g) => ({ value: g, label: g })) })}
            </label>
          ))}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          新权限 <span className="mono">{businessNewValue(spec, value)}</span>{spec.guardHint ? <> · {spec.guardHint}</> : null}
        </div>
        <div className="tint tiny" data-proof="permission-diff-preview" style={{ marginTop: 10 }}>
          {diffs.length
            ? <>变化：{diffs.map((r) => <span key={r.key} className="mono" style={{ marginRight: 8 }}>{r.label}:{r.current}→{value[`grant.${r.key}`]}</span>)}</>
            : <>还没有修改任何权限。</>}
        </div>
      </div>
    );
  }

  if (spec.kind === "localized-copy" || spec.kind === "copy-edit" || spec.kind === "copy-create") {
    const isManagedCopy = spec.kind === "copy-edit" || spec.kind === "copy-create";
    const modules = isManagedCopy ? (spec.modules ?? []) : [];
    const moduleLabels = Object.fromEntries(modules.map((item) => [item.value, item.label]));
    const positions = isManagedCopy
      ? (spec.positions ?? []).filter((item) => item.surface === value.surface && item.status !== "disabled")
      : [];
    const positionLabels = Object.fromEntries(positions.map((item) => [item.value, item.label]));
    const changeSurface = (surface: string) => {
      const nextPosition = isManagedCopy
        ? (spec.positions ?? []).find((item) => item.surface === surface && item.status !== "disabled")?.value ?? ""
        : "";
      onChange({ ...value, surface, copyPosition: nextPosition });
    };
    return (
      <div className="field" data-business-form={spec.kind}>
        <span className="bf-legend">中英越文案{"keyName" in spec && spec.keyName ? <> · <span className="mono">{spec.keyName}</span></> : null}</span>
        {spec.kind === "localized-copy" && spec.mode === "create" && (
          <div style={{ marginBottom: 10 }}>{input("messageKey", "词条", "如 home.hero.title")}</div>
        )}
        {spec.kind === "copy-create" && (
          <div className="grid g-2" style={{ gap: 10, marginBottom: 10 }}>
            {input("copyKey", "文案标识", "home.newBanner")}
            {input("description", "文案名称", "首页新横幅")}
            {select("surface", "投放模块", modules.map((item) => item.value), moduleLabels, undefined, changeSurface)}
            {select("copyPosition", "文案位置", positions.map((item) => item.value), positionLabels)}
            {input("trafficSplit", "分流比例(%)", "50", "number")}
            {select("version", "文案版本", (spec.versionOptions ?? []).map((item) => item.value), Object.fromEntries((spec.versionOptions ?? []).map((item) => [item.value, item.label])))}
          </div>
        )}
        {spec.kind === "copy-edit" && (
          <div className="grid g-2" style={{ gap: 10, marginBottom: 10 }}>
            {spec.version
              ? <div className="field" data-proof="copy-selected-version" style={{ marginBottom: 0 }}><span>文案版本</span><output className="fld" aria-label="文案版本" style={{ display: "flex", alignItems: "center", color: "var(--ink-2)" }}>{spec.version} · 当前草稿</output></div>
              : select("version", "文案版本", (spec.versionOptions ?? []).map((item) => item.value), Object.fromEntries((spec.versionOptions ?? []).map((item) => [item.value, item.label])))}
            {select("surface", "投放模块", modules.map((item) => item.value), moduleLabels, undefined, changeSurface)}
            {select("copyPosition", "文案位置", positions.map((item) => item.value), positionLabels)}
            {input("trafficSplit", "分流比例 (%)", "50", "number")}
            {spec.saveModeChoice && select("saveMode", "保存为", ["存草稿", "发布生效"])}
          </div>
        )}
        {isManagedCopy && (
          <div className="grid g-2" data-proof="copy-audience-builder" style={{ gap: 10, marginBottom: 10 }}>
            {select("phaseMin", "最低阶段", ["P1", "P2", "P3", "P4", "P5", "P6"])}
            {select("phaseMax", "最高阶段", ["P1", "P2", "P3", "P4", "P5", "P6"])}
            {select("language", "语言", ["all", "zh", "en", "vi"], { all: "全部语言", zh: "中文 zh", en: "英文 en", vi: "越南语 vi" })}
            {input("registrationDaysGt", "注册时长大于(天)", "0", "number")}
          </div>
        )}
        <div className="grid g-2" style={{ gap: 10 }}>
          {textArea("zh", "中文文案", "填写中文草稿")}
          {textArea("en", "英文文案", "Fill English copy")}
          {spec.kind === "localized-copy" && textArea("vi", "越南语文案", "Nhập nội dung tiếng Việt")}
          {isManagedCopy && textArea("vi", "越南语文案", "Nhập nội dung tiếng Việt")}
        </div>
        {(spec.kind === "copy-edit" || spec.kind === "copy-create") && (
          <div style={{ marginTop: 10 }}>
            {textArea("versionNote", "版本说明", "本次修改的原因和预期效果", 2)}
          </div>
        )}
        {(spec.placeholders ?? []).length > 0 && (
          <div className="tint tiny" style={{ marginTop: 10 }}>必须包含的占位符：{(spec.placeholders ?? []).map((ph, i) => <span key={ph}><span className="mono">{ph}</span>{i < (spec.placeholders ?? []).length - 1 ? "、" : ""}</span>)}</div>
        )}
      </div>
    );
  }

  if (spec.kind === "copy-position-create") {
    const labels = Object.fromEntries(spec.modules.map((item) => [item.value, item.label]));
    return (
      <div className="field" data-business-form="copy-position-create">
        <span className="bf-legend">新增文案位置</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("positionKey", "位置标识", "home.hero.banner")}
          {input("positionName", "位置名称", "首页主横幅")}
          {select("surface", "投放模块", spec.modules.map((item) => item.value), labels)}
        </div>
      </div>
    );
  }

  if (spec.kind === "copy-version-option") {
    return (
      <div className="field" data-business-form={`copy-version-option-${spec.mode}`}>
        <span className="bf-legend">{spec.mode === "create" ? "新增文案版本" : "编辑文案版本"}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.mode === "create"
            ? input("versionKey", "版本标识", "v3")
            : <div className="field" style={{ marginBottom: 0 }}><span>版本标识</span><output className="fld" aria-label="版本标识" style={{ display: "flex", alignItems: "center" }}>{value.versionKey}</output></div>}
          {input("name", "版本名称", "转化优化版")}
          {select("status", "状态", ["ACTIVE", "INACTIVE"], { ACTIVE: "启用", INACTIVE: "停用" })}
          {input("sortOrder", "排序", "0", "number")}
        </div>
        <div style={{ marginTop: 10 }}>{textArea("description", "版本说明", "说明该版本的使用范围和变更目标", 2)}</div>
      </div>
    );
  }

  if (spec.kind === "copy-experiment-create") {
    const copy = spec.copies.find((item) => item.value === value.copyKey) ?? spec.copies[0];
    const count = Math.max(2, Number(value.variantCount || 2));
    const selectedVersions = Array.from({ length: count }, (_, index) => value[`variantVersion.${index}`] ?? "");
    const splitTotal = Array.from({ length: count }, (_, index) => Number(value[`variantSplit.${index}`] || 0))
      .reduce((sum, split) => sum + split, 0);
    const selectedVersion = copy?.versions.find((item) => item.value === selectedVersions[0]);
    const selectedAudienceSignatures = selectedVersions
      .map((version) => copyExperimentAudienceSignature(copy?.versions.find((item) => item.value === version)))
      .filter(Boolean);
    const audienceConsistent = selectedAudienceSignatures.length === selectedVersions.length && new Set(selectedAudienceSignatures).size <= 1;
    const target = selectedVersion?.audienceTarget;
    const parsed = parseCopyAudience(selectedVersion?.audience);
    const tiers = target?.tiers?.length
      ? `${target.tiers[0]}${target.tiers.length > 1 ? `-${target.tiers[target.tiers.length - 1]}` : ""}`
      : `${parsed.phaseMin}${parsed.phaseMin === parsed.phaseMax ? "" : `-${parsed.phaseMax}`}`;
    const languages = target?.locales?.length ? target.locales.map((item) => item.toUpperCase()).join(" / ") : parsed.language === "all" ? "全语言" : parsed.language.toUpperCase();
    const registrationDays = target?.registrationDaysMin != null
      ? Math.max(0, target.registrationDaysMin - 1)
      : Number(parsed.registrationDaysGt || 0);
    const changeCopy = (copyKey: string) => {
      const nextCopy = spec.copies.find((item) => item.value === copyKey);
      onChange({
        ...value,
        copyKey,
        variantCount: "2",
        "variantVersion.0": nextCopy?.versions[0]?.value ?? "",
        "variantSplit.0": "50",
        "variantVersion.1": nextCopy?.versions[1]?.value ?? "",
        "variantSplit.1": "50",
      });
    };
    const removeVariant = (removeIndex: number) => {
      if (count <= 2) return;
      const next: BusinessFormValue = { ...value, variantCount: String(count - 1) };
      const remainingCount = count - 1;
      const baseSplit = Math.floor(100 / remainingCount);
      for (let index = 0; index < count - 1; index += 1) {
        const sourceIndex = index >= removeIndex ? index + 1 : index;
        next[`variantVersion.${index}`] = value[`variantVersion.${sourceIndex}`] ?? "";
        next[`variantSplit.${index}`] = String(baseSplit + (index === 0 ? 100 - baseSplit * remainingCount : 0));
      }
      delete next[`variantVersion.${count - 1}`];
      delete next[`variantSplit.${count - 1}`];
      onChange(next);
    };
    const addVariant = () => {
      if (!copy || count >= copy.versions.length) return;
      const unused = copy.versions.find((item) => !selectedVersions.includes(item.value));
      const nextCount = count + 1;
      const baseSplit = Math.floor(100 / nextCount);
      const next: BusinessFormValue = {
        ...value,
        variantCount: String(nextCount),
        [`variantVersion.${count}`]: unused?.value ?? "",
      };
      for (let index = 0; index < nextCount; index += 1) {
        next[`variantSplit.${index}`] = String(baseSplit + (index === 0 ? 100 - baseSplit * nextCount : 0));
      }
      onChange(next);
    };
    return (
      <div className="field" data-business-form="copy-experiment-create">
        <span className="bf-legend">创建文案对比测试</span>
        <label className="field" style={{ marginBottom: 10 }}>
          <span>选择文案</span>
          {choice({ label: "选择文案", current: copy?.value ?? "", onValue: changeCopy, options: spec.copies })}
        </label>
        <div className="itint" style={{ marginBottom: 10 }}>
          从同一文案的非草稿版本中至少选 2 个，分流比例加起来须为 100%。
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {Array.from({ length: count }, (_, index) => {
            const currentVersion = selectedVersions[index];
            const unavailable = new Set(selectedVersions.filter((_, selectedIndex) => selectedIndex !== index));
            const options = copy?.versions ?? [];
            const split = value[`variantSplit.${index}`] ?? "";
            return (
              <div key={index} className="tint" data-proof={`experiment-variant-${index}`} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 10, alignItems: "end" }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>变体 {String.fromCharCode(65 + index)} · 内容版本</span>
                  {choice({ label: `变体 ${String.fromCharCode(65 + index)} 内容版本`, current: currentVersion, onValue: (next) => set(`variantVersion.${index}`, next), options: options.map((item) => ({ value: item.value, label: item.label, disabled: item.value !== currentVersion && unavailable.has(item.value) })) })}
                </label>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>分流比例 · {split || 0}%</span>
                  <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 8, alignItems: "center" }}>
                    <input className="fld" aria-label={`变体 ${String.fromCharCode(65 + index)} 分流比例`} type="number" min={1} max={99} step={1} value={split} onChange={(event) => set(`variantSplit.${index}`, event.target.value)} />
                    <input aria-label={`变体 ${String.fromCharCode(65 + index)} 分流滑块`} type="range" min={1} max={99} step={1} value={split || "1"} onChange={(event) => set(`variantSplit.${index}`, event.target.value)} />
                  </div>
                </label>
                <button type="button" className="btn sm" disabled={count <= 2} onClick={() => removeVariant(index)}>移除</button>
              </div>
            );
          })}
        </div>
        <div className="row wrap" style={{ justifyContent: "space-between", gap: 8, marginTop: 10 }}>
          <button type="button" className="btn sm" disabled={!copy || count >= copy.versions.length} onClick={addVariant}>+ 添加变体</button>
          <span className="tiny" style={{ color: splitTotal === 100 ? "var(--success)" : "var(--warning)", fontWeight: 700 }}>分流合计 {splitTotal}% / 100%</span>
        </div>
        <div className="itint cyan" data-proof="experiment-inherited-audience" style={{ marginTop: 10 }}>
          <b>测试对象（沿用文案设置）</b>
          <div style={{ marginTop: 5 }}>阶段 {tiers} · 语言 {languages} · 注册时长大于 {registrationDays} 天</div>
          <div className="tiny" style={{ marginTop: 3 }}>预计覆盖 {selectedVersion?.estimatedAudience == null ? "待估算" : `${selectedVersion.estimatedAudience.toLocaleString()} 人`}</div>
          {!audienceConsistent && <div className="tiny" style={{ marginTop: 5, color: "var(--danger)" }}>所选版本的投放对象不一致，请改选对象相同的版本。</div>}
        </div>
        <div style={{ marginTop: 10 }}>{textArea("note", "测试备注（可选）", "想验证什么、看哪个指标", 2, 255)}</div>
      </div>
    );
  }

  if (spec.kind === "copy-experiment-start") {
    return (
      <div className="field" data-business-form="copy-experiment-start">
        <span className="bf-legend">启动测试 {spec.experimentId}</span>
        <label className="row" style={{ alignItems: "flex-start", gap: 8, marginBottom: 0 }}>
          <input type="checkbox" checked={value.ack === "true"} onChange={(event) => set("ack", event.target.checked ? "true" : "false")} />
          <span>我已确认测试版本、分流比例和测试对象。</span>
        </label>
      </div>
    );
  }

  if (spec.kind === "copy-experiment-discard") {
    return (
      <div className="field" data-business-form="copy-experiment-discard">
        <span className="bf-legend">弃用测试 {spec.experimentId}</span>
        <div className="itint warn">弃用后该测试不能再启动或采纳，已有数据保留。</div>
      </div>
    );
  }

  if (spec.kind === "course-authoring") {
    const questionCount = Math.max(1, Number(value.quizCount || 1));
    const addQuestion = () => {
      const index = questionCount;
      onChange({ ...value,
        quizCount: String(questionCount + 1),
        [`quiz.${index}.id`]: `q${index + 1}`,
        [`quiz.${index}.questionZh`]: "",
        [`quiz.${index}.questionEn`]: "",
        [`quiz.${index}.questionVi`]: "",
        [`quiz.${index}.optionCount`]: "2",
        [`quiz.${index}.option.0.zh`]: "",
        [`quiz.${index}.option.0.en`]: "",
        [`quiz.${index}.option.0.vi`]: "",
        [`quiz.${index}.option.1.zh`]: "",
        [`quiz.${index}.option.1.en`]: "",
        [`quiz.${index}.option.1.vi`]: "",
        [`quiz.${index}.correctOptionIndex`]: "0",
      });
    };
    return (
      <div className="field" data-business-form="course-authoring">
        <span className="bf-legend">新建 / 编辑课程</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("slug", "课程标识", "learn-earn-basics")}
          {(spec.mode === "version-create" || spec.mode === "version-edit") && input("version", "版本号", "v2")}
          {select("category", "课程分类", spec.categories ?? DEFAULT_COURSE_CATEGORIES, COURSE_CATEGORY_LABELS)}
          {select("format", "课程形式", spec.formats ?? ["Article", "Video", "Hands-on"], COURSE_FORMAT_LABELS)}
          {select("difficulty", "课程难度", spec.levels ?? ["Beginner", "Intermediate", "Advanced"], COURSE_LEVEL_LABELS)}
          {select("duration", "预计时长", spec.durations ?? DEFAULT_COURSE_DURATIONS)}
          {input("reward", `完成奖励(${spec.rewardMin ?? 0}-${spec.rewardMax ?? 999} UVT)`, "5", "number")}
          <div className="itint ok">保存为{COURSE_STATUS_LABELS.draft}，发布请回到课程列表操作。</div>
          {input("titleZh", "中文标题（最多 1024 字）", "课程标题", "text", 1024)}
          {input("titleVi", "越南语标题（最多 1024 字）", "Tiêu đề khóa học", "text", 1024)}
          {input("titleEn", "英语标题（最多 1024 字）", "Course title", "text", 1024)}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {textArea("bodyZh", "中文正文（最多 1024 字）", "课程正文与完成条件", 4, 1024)}
          {textArea("bodyVi", "越南语正文（最多 1024 字）", "Nội dung khóa học và điều kiện hoàn thành", 4, 1024)}
          {textArea("bodyEn", "英语正文（最多 1024 字）", "Course body and completion criteria", 4, 1024)}
        </div>
        <div data-proof="course-quiz" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--ink-2)" }}>测验与发奖（发布前须填写完整）</div>
          {Array.from({ length: questionCount }, (_, questionIndex) => {
            const optionCount = Math.max(2, Number(value[`quiz.${questionIndex}.optionCount`] || 2));
            const addOption = () => onChange({ ...value,
              [`quiz.${questionIndex}.optionCount`]: String(optionCount + 1),
              [`quiz.${questionIndex}.option.${optionCount}.zh`]: "",
              [`quiz.${questionIndex}.option.${optionCount}.en`]: "",
              [`quiz.${questionIndex}.option.${optionCount}.vi`]: "",
            });
            return <div key={questionIndex} className="itint" style={{ marginBottom: 10 }}>
              <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
                <b>第 {questionIndex + 1} 题</b>
                <span className="tiny mono">{value[`quiz.${questionIndex}.id`] || `q${questionIndex + 1}`}</span>
              </div>
              <div className="grid g-2" style={{ gap: 10 }}>
                {input(`quiz.${questionIndex}.id`, "题目标识", `q${questionIndex + 1}`)}
                {input(`quiz.${questionIndex}.questionZh`, "中文题干", "本课核心结论是什么？")}
                {input(`quiz.${questionIndex}.questionEn`, "英文题干", "What is the key takeaway?")}
                {input(`quiz.${questionIndex}.questionVi`, "越南语题干", "Kết luận chính của bài học là gì?")}
                {Array.from({ length: optionCount }, (_, optionIndex) => <Fragment key={optionIndex}>
                  <div className="field" style={{ gridColumn: "1 / -1", marginBottom: -4 }}>
                    <label className="row" style={{ gap: 8, cursor: "pointer", color: "var(--ink-2)" }}>
                      <input
                        type="radio"
                        name={`quiz-${questionIndex}-correct-option`}
                        checked={Number(value[`quiz.${questionIndex}.correctOptionIndex`] || 0) === optionIndex}
                        onChange={() => onChange({ ...value, [`quiz.${questionIndex}.correctOptionIndex`]: String(optionIndex) })}
                      />
                      <b>设为正确答案：选项 {optionIndex + 1}</b>
                    </label>
                  </div>
                  {input(`quiz.${questionIndex}.option.${optionIndex}.zh`, `选项 ${optionIndex + 1}（中文）`, "请输入中文选项")}
                  {input(`quiz.${questionIndex}.option.${optionIndex}.en`, `选项 ${optionIndex + 1}（英文）`, "Enter English option")}
                  {input(`quiz.${questionIndex}.option.${optionIndex}.vi`, `选项 ${optionIndex + 1}（越南语）`, "Nhập lựa chọn tiếng Việt")}
                </Fragment>)}
              </div>
              <button type="button" className="btn sm" style={{ marginTop: 8 }} onClick={addOption}>+ 添加选项</button>
            </div>;
          })}
          <button type="button" className="btn sm" onClick={addQuestion}>+ 添加题目</button>
          <div className="tint tiny" style={{ marginTop: 8 }}>计分规则：正确题数 ÷ 总题数 × 100，四舍五入为整数；达到下方通过分数才算测验通过。</div>
          <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
            {input("passScore", "通过分数（1-100）", "60", "number")}
            {input("retries", "最多重试次数（0-10）", "3", "number")}
            {select("completionCond", "完成条件", ["quiz_passed", "all_questions_correct"], { quiz_passed: "达到通过分数", all_questions_correct: "全部答对" })}
            {select("rewardEvent", "何时发奖", ["quiz.passed", "course.completed"], { "quiz.passed": "测验通过", "course.completed": "课程完成" })}
          </div>
          <div className="tint tiny" style={{ marginTop: 8 }}>同一用户在同一课程版本只发一次奖励；发奖失败会自动重试，仍失败则转人工处理。</div>
        </div>
      </div>
    );
  }

  if (spec.kind === "campaign-edit") {
    return (
      <div className="field" data-business-form="campaign-edit">
        <span className="bf-legend">编辑通知</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("title", "通知标题", "填写通知标题")}
          {select("tier", "优先级", spec.tiers ?? DEFAULT_CAMPAIGN_TIERS)}
          {select("audience", "受众", spec.audiences ?? [])}
          {select("schedule", "排期", ["保存为草稿", "排期下发", "立即下发"])}
          {input("budget", "预算 (美元)", "0", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {textArea("body", "通知正文", "填写通知内容和跳转说明", 4)}
        </div>
      </div>
    );
  }

  if (spec.kind === "generation-gate") {
    return (
      <div className="field" data-business-form="generation-gate">
        <span className="bf-legend">机型开放时间</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.mode === "create"
            ? select("skuId", "目标 商品", spec.skuOptions)
            : input("skuId", "目标 商品", "sku-id")}
          {input("name", "展示名称", "留空则使用商品名称")}
          {input("releaseMonth", "计划发布月", "1-12", "number")}
          {select("phase", "发布阶段", spec.phaseOptions, spec.phaseLabels)}
          {input("phaseOffset", "发布偏移（月）", "0", "number")}
          {select("eligibility", "E5 资格配置", ["true", "false"], { true: "已补齐", false: "未补录" })}
          {select("forceUnlock", "强制提前开放", ["false", "true"], { false: "否", true: "是" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          目标 <span className="mono">{businessNewValue(spec, value)}</span> · 新增/修改后写入后端发布门,不再写死到配置项。
        </div>
      </div>
    );
  }

  if (spec.kind === "phase-config") {
    return (
      <div className="field" data-business-form="phase-config">
        <span className="bf-legend">开放阶段设置</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("label", "阶段名称", "如 P3 Pro v2 首发")}
          {input("meta", "门槛说明", "如 L0+ / 账户正常")}
          {input("skus", "商品标签", "如 入门档 / Pro v2")}
          {input("sortOrder", "排序", "10", "number")}
          {select("status", "状态", ["active", "archived"], { active: "启用", archived: "已归档" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          目标 <span className="mono">{businessNewValue(spec, value)}</span> · 保存阶段配置。内部 ID 使用系统生成值,页面只展示阶段名称。
        </div>
      </div>
    );
  }

  if (spec.kind === "version-authoring") {
    const jurisdictionLabels = Object.fromEntries((spec.jurisdictionOptions ?? []).map((item) => [item.value, item.label]));
    const englishRequirement = value.languageScope?.includes("en") ? "必填" : "选填";
    return (
      <div className="field" data-business-form="version-authoring">
        <span className="bf-legend">新建 / 编辑披露草稿</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>披露版本（系统自动编号）</span>
            <input className="fld" value={value.version ?? ""} readOnly aria-readonly="true" />
          </label>
          {select("jurisdiction", "适用地区", (spec.jurisdictionOptions ?? []).map((item) => item.value), jurisdictionLabels, undefined, (next) => {
            const updated = { ...value, jurisdiction: next };
            onChange(updated);
            onSelectionChange?.(updated);
          })}
          {select("languageScope", "语言范围", spec.languageScopes ?? DEFAULT_LANGUAGE_SCOPES, { "zh+vi": "中文 + 越南语", "zh+vi+en": "中文 + 越南语 + 英语" })}
          {input("effectiveDate", "生效日期", "YYYY-MM-DD", "date")}
          {select("requiresReack", "是否要求重新确认", ["true"], { true: "是（切换生效版本后用户须重新确认）" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {textArea("zh", "中文版本正文", "填写中文条款/披露正文", 4)}
          {textArea("vi", "越南语版本正文", "Nhập nội dung công bố bằng tiếng Việt", 4)}
          {textArea("en", `英语版本正文（${englishRequirement}）`, "Fill English disclosure body", 4)}
        </div>
        <div style={{ marginTop: 12 }}>
          <span className="bf-legend">章节内容（共 7 章）</span>
          {(spec.chapters ?? []).map((chapter, index) => <div className="card" key={`${chapter.no}-${index}`} style={{ padding: 10, marginTop: 8 }}>
            <b>第 {chapter.no} 章</b>
            <div className="grid g-3" style={{ gap: 8, marginTop: 8 }}>
              {input(`chapter.${index}.zhTitle`, "中文标题", "请输入中文标题")}
              {input(`chapter.${index}.viTitle`, "越南语标题", "Nhập tiêu đề tiếng Việt")}
              {input(`chapter.${index}.enTitle`, `英语标题（${englishRequirement}）`, "English title")}
              {textArea(`chapter.${index}.zhBody`, "中文正文", "请输入中文正文", 3)}
              {textArea(`chapter.${index}.viBody`, "越南语正文", "Nhập nội dung tiếng Việt", 3)}
              {textArea(`chapter.${index}.enBody`, `英语正文（${englishRequirement}）`, "English body", 3)}
            </div>
          </div>)}
        </div>
      </div>
    );
  }

  if (spec.kind === "disclosure-jurisdiction") {
    const codeError = spec.mode === "create" && (attempted || leftFields.code) && !DISCLOSURE_JURISDICTION_CODE.test((value.code ?? "").trim().toUpperCase()) ? DISCLOSURE_JURISDICTION_CODE_HELP : undefined;
    return (
      <div className={surface ? "rd-business-form" : "field"} data-business-form="disclosure-jurisdiction">
        <div className={surface ? "rd-form-grid" : "grid g-2"} data-cols={surface ? "2" : undefined} data-dense={surface ? "" : undefined} style={surface ? undefined : { gap: 10 }}>
          <RdField label="适用范围代码" required={spec.mode === "create"} error={codeError}>
            {(control) => <input
              {...control}
              className={surface ? "rd-input" : "fld"}
              value={value.code ?? ""}
              readOnly={spec.mode === "edit"}
              aria-readonly={spec.mode === "edit"}
              maxLength={16}
              placeholder="如 VN、US-FINCEN"
              onChange={(event) => set("code", event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ""))}
              onBlur={() => setLeftFields((current) => ({ ...current, code: true }))}
            />}
          </RdField>
          {surface ? <RdField label="适用范围名称" required>
            {(control) => <RdInput {...control} value={value.name ?? ""} onChange={(e) => set("name", e.target.value)} placeholder="如 越南司法辖区" />}
          </RdField> : input("name", <>适用范围名称<span className="rd-form-required" aria-hidden="true">*</span></>, "如 越南司法辖区")}
        </div>
        <div className="rd-form-help" style={surface ? undefined : { marginTop: 8 }}>代码创建后不能修改。</div>
      </div>
    );
  }

  if (spec.kind === "disclosure-publish-review") {
    const LANGUAGES = [["zh", "中文"], ["vi", "越南语"], ["en", "英语"]] as const;
    const currentOf = (no: string) => spec.currentChapters.find((chapter) => chapter.no === no);
    const fieldChanged = (target: typeof spec.targetChapters[number], lang: "zh" | "vi" | "en") => {
      const current = currentOf(target.no);
      return !current || current[lang] !== target[lang] || current[`${lang}Body`] !== target[`${lang}Body`];
    };
    const isChanged = (target: typeof spec.targetChapters[number]) => LANGUAGES.some(([lang]) => fieldChanged(target, lang));
    const changed = spec.targetChapters.filter(isChanged);
    // 改过的章排前面并展开，没改的收起（CP-48）。
    const ordered = [...changed, ...spec.targetChapters.filter((target) => !isChanged(target))];
    return (
      <div className="field" data-business-form="disclosure-publish-review">
        <span className="bf-legend">发布前合规核对</span>
        <div className="rd-form-help">{spec.affected > 0 && spec.affected < 5 ? "涉及用户样本过小" : `涉及用户 ${spec.affected.toLocaleString("zh-CN")} 人 · 待重新确认 ${spec.pendingAck.toLocaleString("zh-CN")} 人`} · 已拦截 {spec.blocked.toLocaleString("zh-CN")} 次 <Explain label="这次审批会怎样" content={`本次只审批版本内容，App 上暂不变化。该版本正式用于地区后，用户须重新确认，期间受限的操作：${spec.gatedActions.join("、") || "无"}`} /></div>
        <div className="rd-form-group-title">版本差异 · 共 {changed.length} / 7 章发生变化</div>
        {ordered.map((target) => {
          const current = currentOf(target.no);
          const open = isChanged(target);
          return <RdFold key={target.no} inset defaultOpen={open} title={`第 ${target.no} 章 · ${open ? "有修改" : "无变化"}`} summary={target.zh}>
            <div className="rd-doc">
              {LANGUAGES.map(([lang, name]) => <section key={lang}>
                <h3>{name}{open && fieldChanged(target, lang) ? " · 已改" : ""} · {target[lang] || "未提供英语标题"}</h3>
                <p>{target[`${lang}Body`] || "未提供英语正文"}</p>
                {current && fieldChanged(target, lang) && <p className="rd-weak">现在：{current[lang]} {current[`${lang}Body`]}</p>}
              </section>)}
            </div>
          </RdFold>;
        })}
        <div className="rd-form-stack" style={{ marginTop: 12 }}>
          <RdCheck label={`确认发布适用地区为 ${spec.jurisdiction}`} checked={value.jurisdictionConfirmed === "true"} onChange={(event) => set("jurisdictionConfirmed", String(event.target.checked))} />
          <RdCheck label="已核对七章中文、越南语和英语内容，与监管要求一致" checked={value.bilingualConfirmed === "true"} onChange={(event) => set("bilingualConfirmed", String(event.target.checked))} />
        </div>
      </div>
    );
  }

  if (spec.kind === "disclosure-matrix") {
    const jurisdictionLabels = Object.fromEntries((spec.jurisdictionOptions ?? []).map((item) => [item.value, item.label]));
    const selectedCountries = new Set((value.countryCodes ?? "").split(",").map((code) => code.trim()).filter(Boolean));
    const toggleCountry = (code: string) => {
      const next = new Set(selectedCountries);
      if (next.has(code)) next.delete(code); else next.add(code);
      onChange({ ...value, countryCodes: Array.from(next).sort().join(",") });
    };
    return (
      <div className={surface ? "rd-business-form" : "field"} data-business-form="disclosure-matrix">
        {!surface && <span className="bf-legend">{spec.mode === "create" ? "为适用范围指定披露版本" : "修改适用范围的披露版本"}</span>}
        <div className={surface ? "rd-form-grid" : spec.mode === "create" ? "grid g-2" : undefined} data-cols={surface && spec.mode === "create" ? "2" : undefined} data-dense={surface ? "" : undefined} style={surface ? undefined : { gap: 10 }}>
          {spec.mode === "create" && select("jurisdictionCode", "适用范围", (spec.jurisdictionOptions ?? []).map((item) => item.value), jurisdictionLabels, undefined, (next) => {
            const selected = spec.jurisdictionOptions?.find((item) => item.value === next);
            const nextVersions = spec.publishedVersionsByJurisdiction?.[next] ?? [];
            onChange({
              ...value,
              jurisdictionCode: next,
              jurisdictionName: selected?.label.replace(/^.*?·\s*/, "") ?? next,
              version: nextVersions.includes(value.version ?? "") ? value.version : nextVersions[0] ?? "",
            });
          })}
          {select("version", "已发布版本", spec.publishedVersionsByJurisdiction?.[value.jurisdictionCode ?? ""] ?? [])}
        </div>
        <div style={surface ? undefined : { marginTop: 10 }}>
          <RdCheckGroup legend="适用国家/地区（可多选）" summary={`已选 ${selectedCountries.size} 个`}>
            {(spec.countryOptions ?? []).map((option) => <RdCheck key={option.value} label={option.label} checked={selectedCountries.has(option.value)} onChange={() => toggleCountry(option.value)} />)}
          </RdCheckGroup>
          {(spec.countryOptions ?? []).length === 0 && <div className="rd-form-help">暂无可选国家/地区</div>}
        </div>
          {spec.unchanged && (value.version !== spec.unchanged.version || (value.countryCodes ?? "") !== [...spec.unchanged.countryCodes].sort().join(",")) && <div className="rd-form-help" style={surface ? undefined : { marginTop: 8 }}>{value.version !== spec.unchanged.version ? `版本 ${spec.unchanged.version} → ${value.version}。` : "适用国家有变化。"}批准后新旧国家的用户要重新确认，并收到通知{spec.affected && spec.affected >= 5 ? `，这个地区现有 ${spec.affected.toLocaleString("en-US")} 位用户` : ""}。</div>}
      </div>
    );
  }

  if (spec.kind === "trust-section-authoring") {
    const fieldCount = Math.max(0, Number(value.fieldCount || 0));
    return (
      <div className="field" data-business-form="trust-section-authoring">
        <span className="bf-legend">{spec.mode === "create" ? "新建信任版块草稿" : "编辑信任版块草稿"}</span>
        <div className="itint" style={{ marginBottom: 10 }}>
          版块 <span className="mono">{spec.sectionKey}</span> · 先存草稿再发布；已发布的版本不能直接修改。
        </div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("version", "版本号", "如 v6")}
          {input("description", "版块说明", "面向用户的版块说明")}
          {input("structure", "内容结构", "例如 指标卡 + 趋势图")}
        </div>
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          <div className="row wrap" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <b>结构化内容字段</b>
            <span className="tiny">当前 {fieldCount} 项</span>
          </div>
          <div className="tint tiny" style={{ marginBottom: 10 }}>字段由当前版本固定，不能增删或改名。</div>
          {fieldCount === 0 && <div className="itint warn">当前版本没有字段模板，无法保存草稿。</div>}
          {Array.from({ length: fieldCount }, (_, index) => (
            <div key={index} className="itint" style={{ marginBottom: 10 }}>
              <div className="tiny" style={{ marginBottom: 6 }}>字段 {index + 1}</div>
              <div className="grid g-2" style={{ gap: 10 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>字段标识</span>
                  <div className="itint mono" data-trust-field-key="fixed">锁定 · {value[`field.${index}.key`] ?? ""}</div>
                </label>
                {input(`field.${index}.label`, "中文名称", "如 年内收入")}
                {textArea(`field.${index}.value`, "字段内容", "填写该字段的展示内容", 2)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (spec.kind === "trust-section-publish") {
    const currentByKey = new Map(spec.currentFields.map((field) => [field.key, field]));
    const targetByKey = new Map(spec.targetFields.map((field) => [field.key, field]));
    const fieldKeys = Array.from(new Set([...currentByKey.keys(), ...targetByKey.keys()]));
    return (
      <div className="field" data-business-form="trust-section-publish">
        <span className="bf-legend">发布核对</span>
        <div className="itint" style={{ marginBottom: 10 }}>
          <b>版本差异</b> · <span className="mono">{spec.currentVersion}</span> → <span className="mono">{spec.targetVersion}</span>
          <div style={{ marginTop: 8 }}>
            {fieldKeys.map((key) => {
              const current = currentByKey.get(key);
              const target = targetByKey.get(key);
              const state = !current ? "新增字段" : !target ? "删除字段" : current.value === target.value && current.label === target.label ? "未变化" : "已变更";
              return <div className="kv" key={key}>
                <span className="k"><span className={`bdg ${state === "新增字段" ? "ok" : state === "未变化" ? "dim" : "warn"}`}>{state}</span> {target?.label || current?.label || key}</span>
                <span className="v"><span className="tiny">旧值</span> {current?.value ?? "—"} <span className="mono">→</span> <span className="tiny">新值</span> {target?.value ?? "—"}</span>
              </div>;
            })}
            {fieldKeys.length === 0 && <div className="tiny">两个版本都没有字段内容。</div>}
          </div>
        </div>
        {spec.requireDataSource && input("dataSource", "财务/UVT数据来源", "必填：报表、账本快照或市场数据编号")}
        <label className="row" style={{ gap: 8, marginTop: 10 }}>
          <input type="checkbox" checked={value.bilingualConfirmed === "true"} onChange={(event) => set("bilingualConfirmed", String(event.target.checked))} />
          已逐项核对中、越、英三语，关键数字一致
        </label>
      </div>
    );
  }

  if (spec.kind === "identity-verify") {
    const verified = spec.serverVerification;
    if (spec.presentation === "authorization-and-declaration") return (
      <div className="rd-business-form" data-business-form="identity-verify">
        <div data-proof="sensitive-action-authorization">
          <div className="rd-form-group-title">本次操作的授权</div>
          <RdFacts>
            <RdFact k="授权管理员">{verified?.verifiedBy || "—"}</RdFact>
            <RdFact k="授权依据">{verified?.ticket || "—"}</RdFact>
            <RdFact k="授权检查时间">{verified?.verifiedAt || "—"}</RdFact>
          </RdFacts>
        </div>
        <RdCheckGroup legend="本人声明">
          <div style={{ gridColumn: "1 / -1" }}>
            <RdCheck data-proof="identity-ack" checked={value.ack === "true"} onChange={(event) => set("ack", event.target.checked ? "true" : "false")}
              label="我已另行核实是用户本人，不是他人冒充" help="核实方式和依据请写在操作理由中。" />
          </div>
        </RdCheckGroup>
      </div>
    );
    if (surface) return (
      <div className="rd-business-form" data-business-form="identity-verify">
        <div className="rd-form-group-title">先核实用户身份</div>
        <RdNotice tone="warn" title={spec.subject}>完成全部核验后才能提交。</RdNotice>
        {verified && <div data-proof="server-sensitive-action-verification">
          <RdNotice tone="progress" title="已有核验记录，提交时会再次检查" />
          <RdFacts><RdFact k="依据"><span data-mono="">{verified.ticket}</span></RdFact><RdFact k="核验人">{verified.verifiedBy || "—"}</RdFact><RdFact k="核验时间">{verified.verifiedAt}</RdFact><RdFact k="有效期至">{verified.expiresAt || "—"}</RdFact></RdFacts>
        </div>}
        {verified ? <div className="rd-form-grid" data-cols="2" data-dense="">
          <RdField label="核验方式">{(control) => <RdInput {...control} value={value.channel ?? ""} readOnly aria-readonly="true" />}</RdField>
          <RdField label="核验时间">{(control) => <RdInput {...control} value={value.verifiedAt ?? ""} readOnly aria-readonly="true" />}</RdField>
          <div style={{ gridColumn: "1 / -1" }}><RdField label="核验依据">{(control) => <RdInput {...control} value={value.ticket ?? ""} readOnly aria-readonly="true" />}</RdField></div>
        </div> : <div className="rd-form-grid" data-cols="2" data-dense="">
          {select("channel", "核验方式", spec.channels ?? ["视频核实", "当面核实", "回拨预留号码"], "identity-channel")}
          {input("verifiedAt", "核验时间", "2026-06-18 14:30", "datetime-local")}
          <div style={{ gridColumn: "1 / -1" }}>{input("ticket", "来源工单号", spec.ticketHint ?? "如 SEC-20260618-001")}</div>
        </div>}
        <RdCheck data-proof="identity-ack" label="我已通过上述方式核实是用户本人，不是他人冒充" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
      </div>
    );
    return (
      <div className="field" data-business-form="identity-verify">
        <span className="bf-legend">先核实用户身份</span>
        <div className="tint danger tiny" style={{ marginBottom: 10 }}>
          用户 <span className="mono">{spec.subject}</span> · 完成全部核验后才能提交。
        </div>
        {verified ? (
          <div className="tint tiny" style={{ marginBottom: 10 }} data-proof="server-sensitive-action-verification">
            <b>已有核验记录，提交时会再次检查</b> · 依据 <span className="mono">{verified.ticket}</span><br />
            核验人 {verified.verifiedBy || "—"} · 核验时间 {verified.verifiedAt} · 有效期至 {verified.expiresAt || "—"}
          </div>
        ) : null}
        {verified ? <>
          <div className="grid g-2" style={{ gap: 10 }}>
            <label className="field"><span>核验方式</span><input className="fld" value={value.channel ?? ""} readOnly aria-readonly="true" /></label>
            <label className="field"><span>核验时间</span><input className="fld" value={value.verifiedAt ?? ""} readOnly aria-readonly="true" /></label>
          </div>
          <div style={{ marginTop: 10 }}>
            <label className="field"><span>核验依据</span><input className="fld" value={value.ticket ?? ""} readOnly aria-readonly="true" /></label>
          </div>
        </> : <>
          <div className="grid g-2" style={{ gap: 10 }}>
            {select("channel", "核验方式", spec.channels ?? ["视频核实", "当面核实", "回拨预留号码"], "identity-channel")}
            {input("verifiedAt", "核验时间", "2026-06-18 14:30", "datetime-local")}
          </div>
          <div style={{ marginTop: 10 }}>
            {input("ticket", "来源工单号", spec.ticketHint ?? "如 SEC-20260618-001")}
          </div>
        </>}
        <label className="row" style={{ gap: 8, marginTop: 10, color: "var(--ink-2)", fontSize: 12.5 }}>
          <input data-proof="identity-ack" type="checkbox" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
          我已通过上述方式核实是用户本人，不是他人冒充
        </label>
      </div>
    );
  }

  if (spec.kind === "task-edit") {
    return (
      <div className="field" data-business-form="task-edit">
        <span className="bf-legend">编辑任务{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "任务名称", "如 逛收益页")}
          {input("path", "跳转页面", "如 /earn")}
          {input("reward", "奖励说明", "如 50 UVT(可双币:200 UVT + $1)")}
          {select("status", "状态", spec.statusOptions ?? ["active", "paused", "archived"], "task-edit-status", { active: "生效中", paused: "已停用", archived: "已归档" })}
          {select("completionType", "完成方式", spec.completionTypeOptions ?? ["visit", "event", "manual"], "task-edit-completion", { visit: "打开页面即完成", event: "完成指定业务", manual: "人工核验" })}
          {input("completionEvent", "完成触发条件 / 事件", "打开页面类可不填；业务类填事件名，如 order.paid；人工类填核验说明")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          <b>打开页面即完成</b>：用户打开跳转页面就算完成；<b>完成指定业务</b>：系统确认业务完成后才算；<b>人工核验</b>：由运营手动确认。
          调高奖励需通过兑付覆盖率检查；停用后用户看不到该任务，已发奖励不收回。
        </div>
      </div>
    );
  }

  if (spec.kind === "voucher-config") {
    return (
      <div className="field" data-business-form="voucher-config">
        <span className="bf-legend">代金券设置{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "名称", "如 新人专享券")}
          {spec.typeLocked ? (
            <label className="field" style={{ marginBottom: 0 }}>
              <span>类型（已发券，不可修改）</span>
              {choice({ label: "类型", proof: "voucher-type", current: spec.currentType ?? "", disabled: true, onValue: () => undefined, options: [{ value: spec.currentType ?? "", label: spec.currentType === "percent" ? "折扣" : "满减" }] })}
            </label>
          ) : select("type", "类型", ["fixed", "percent"], "voucher-type", { fixed: "满减", percent: "折扣" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("amountUSD", "满减面值 (1–1,000,000 USDT)", "满减券填写，可含小数；如 1.01", "number")}
          {input("percent", "折扣率 (%)", "折扣券填写 1–99 的整数，如 8", "number")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("minPurchaseUSD", "满减门槛 (美元)", "满多少可用，0 为无门槛", "number")}
          {input("maxDiscountUSD", "折扣封顶 (美元)", "0 为不封顶", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("issuanceLimit", "发行上限 (张)", "0 为不限量", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {multiSelect("applicableSkus", "适用商品（不选则全部设备可用）", spec.applicableSkuOptions ?? [], "voucher-skus", spec.applicableSkuLabels)}
        </div>
        <div style={{ marginTop: 10 }}>
          {multiSelect("claimSurfaces", "领取入口（不选则不限）", ["home", "store", "me", "earn"], "voucher-surfaces", { home: "首页", store: "商城", me: "我的", earn: "收益" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("audience", "受众", ["new", "all"], "voucher-audience", { new: "新用户", all: "全部用户" })}
          {select("status", "状态", ["active", "paused"], "voucher-status", { active: "投放中", paused: "已暂停" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("startDate", "生效起", "留空则立即生效", "date")}
          {input("endDate", "有效止", "留空则长期有效", "date")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("popupEnabled", "首页弹窗", ["true", "false"], "voucher-popup", { true: "参与弹窗", false: "不弹窗" })}
          {select("popupCadenceEnabled", "弹窗总开关", ["true", "false"], "voucher-cadence-enabled", { true: "开启", false: "关闭" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("popupDelayMs", "进入后多久弹出（毫秒）", "0–60000", "number")}
          {input("popupCooldownHours", "同一用户再次弹出间隔（小时）", "0–720", "number")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("popupMaxPerSession", "每次登录最多弹出次数", "1–10", "number")}
          {select("splittable", "可拆分", ["false", "true"], "voucher-splittable", { false: "不可拆分", true: "可拆分" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("stackWithTrial", "可叠加试用收益", ["false", "true"], "voucher-stack-trial", { false: "不可叠加", true: "可叠加" })}
          {select("stackWithOthers", "可叠加其它优惠", ["false", "true"], "voucher-stack-others", { false: "不可叠加", true: "可叠加" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          <b>满减</b>：满「门槛」减「面值」；<b>折扣</b>：按百分比打折，可设封顶。不选适用商品则全部设备可用（领券后跳商城），只选一个则跳该商品页。领取入口是用户关掉弹窗后仍能看到领券条的页面。默认不与试用收益或其他优惠叠加，自动取最优。代金券只抵扣购机款，不能提现，不计入平台应付款。
        </div>
      </div>
    );
  }

  if (spec.kind === "vrank-reward-edit") {
    const rtype = value.rtype ?? "uvt";
    const voucherOpts = spec.voucherOptions ?? [];
    const skuOpts = spec.skuOptions ?? [];
    return (
      <div className="field" data-business-form="vrank-reward-edit">
        <span className="bf-legend">等级奖励{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div style={{ marginBottom: 10 }}>
          {select("rtype", "奖励类型", ["usdt", "uvt", "voucher", "sku", "custom"], "vrank-reward-type", { usdt: "USDT 现金", uvt: "UVT 代币", voucher: "代金券", sku: "商品", custom: "自定义" })}
        </div>
        {(rtype === "usdt" || rtype === "uvt") && (
          <div data-proof="vrank-reward-amount">
            {input("amount", rtype === "usdt" ? "金额(USDT)" : "数量(UVT)", rtype === "usdt" ? "如 50" : "如 10000", "number")}
          </div>
        )}
        {rtype === "voucher" && (
          <div data-proof="vrank-reward-voucher">
            {voucherOpts.length === 0
              ? <div className="tiny" style={{ color: "var(--ink-4)" }}>暂无可选代金券，请先到「代金券」新建并投放。</div>
              : select("voucherId", "选择代金券", voucherOpts, "vrank-reward-voucher-sel", spec.voucherLabels, undefined, "当前代金券不可用，请重新选择")}
          </div>
        )}
        {rtype === "sku" && (
          <div data-proof="vrank-reward-sku">
            {skuOpts.length === 0
              ? <div className="tiny" style={{ color: "var(--ink-4)" }}>暂无在售商品，请先到「商品管理与上架条件」上架。</div>
              : select("skuId", "选择商品", skuOpts, "vrank-reward-sku-sel", spec.skuLabels, undefined, "当前商品不可用，请重新选择")}
          </div>
        )}
        {rtype === "custom" && (
          <div data-proof="vrank-reward-custom">
            {input("custom", "自定义奖励内容", "如 限量徽章 / 线下活动名额")}
          </div>
        )}
        <div className="tint tiny" style={{ marginTop: 10 }}>
          <b>USDT / UVT</b>：直接发放，需通过兑付覆盖率检查；<b>代金券 / 商品</b>：从现有代金券或在售商品中选；<b>自定义</b>：填写文字说明，线下兑现，不计入资金账。
        </div>
      </div>
    );
  }

  if (spec.kind === "day-one-window") {
    return (
      <div className="field" data-business-form="day-one-window">
        <span className="bf-legend">首日任务完成期限</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("activeHours", "全额奖励期限（小时）", "24", "number")}
          {input("graceHours", "宽限期限（小时）", "72", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          在全额奖励期限内完成 6 项任务可领全额奖励；超过该期限、仍在宽限期内完成可领宽限期奖励；超过宽限期不再发放。宽限期限不能短于全额奖励期限。修改只对之后开始任务的用户生效；放宽期限需通过兑付覆盖率检查。
        </div>
      </div>
    );
  }

  if (spec.kind === "day-one-tri-reward") {
    return (
      <div className="field" data-business-form="day-one-tri-reward">
        <span className="bf-legend">首日任务分档奖励</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("active", "按时完成奖励(UVT)", "500", "number")}
          {input("grace", "宽限期奖励(UVT)", "200", "number")}
          {input("expired", "逾期奖励(UVT)", "0", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          按时、宽限期内和逾期三档奖励，须满足 按时 ≥ 宽限 ≥ 逾期。调高任一档需通过兑付覆盖率检查。
        </div>
      </div>
    );
  }

  if (spec.kind === "weekly-task-edit") {
    return (
      <div className="field" data-business-form="weekly-task-edit">
        <span className="bf-legend">编辑每周任务{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("cond", "任务条件", "如 USDT 长期质押")}
          {input("reward", "奖励说明", "如 3,000(可双币:200 + $2)")}
          {select("status", "状态", spec.statusOptions ?? ["active", "paused", "archived"], "weekly-task-status", { active: "生效中", paused: "已停用", archived: "已归档" })}
          {select("completionType", "完成方式", spec.completionTypeOptions ?? ["visit", "event", "manual"], "weekly-task-completion", { visit: "打开页面即完成", event: "完成指定业务", manual: "人工核验" })}
          {input("completionEvent", "完成触发条件 / 事件", "如 stake.locked / referral.sent")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          第一档按优先级只发第一条符合条件的任务，第二档每条单独发放。调高奖励需通过兑付覆盖率检查；修改下周生效，停用后本周起不再发放。
        </div>
      </div>
    );
  }

  if (spec.kind === "monthly-task-edit") {
    return (
      <div className="field" data-business-form="monthly-task-edit">
        <span className="bf-legend">编辑月度挑战{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("theme", "主题", "如 地基建设者")}
          {input("age", "注册时长", "如 0–2 月")}
          {input("reward", "奖励说明", "如 1,500 UVT")}
          {select("status", "状态", spec.statusOptions ?? ["active", "paused", "archived"], "monthly-task-status", { active: "生效中", paused: "已停用", archived: "已归档" })}
        </div>
        <div style={{ marginTop: 10 }}>
          {textArea("goals", "子目标（3 个全部达成才能领奖）", "如 累计赚 200 · 绑卡 · 邀 1 人", 2)}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          按注册时长发给对应用户，3 个子目标全部达成才能领奖，每月重置。调高奖励需通过兑付覆盖率检查；修改只对本月新发的挑战生效。
        </div>
      </div>
    );
  }

  if (spec.kind === "mission-create") {
    return (
      <div className="field" data-business-form="mission-create">
        <span className="bf-legend">新建任务{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("missionCode", "任务编号（英文，不能重复）", "如 dayOne-visit-earn")}
          {input("missionName", "任务名称", "如 逛收益页")}
          {input("rewardPoints", "奖励 UVT 数", "如 50", "number")}
          {select("category", "任务类别", ["wallet", "explore", "recommend", "identity", "social"], {
            wallet: "钱包", explore: "探索", recommend: "推荐", identity: "身份", social: "社交",
          })}
          {select("actionRoute", "去完成页面", [
            "/pages/missions/missions",
            "/pages/me/profile",
            "/pages/me/wallet-cards-new",
            "/pages/me/wallet-topup",
            "/pages/me/wallet-exchange",
            "/pages/me/wallet-repurchase",
            "/pages/me/devices",
            "/pages/earn/earn",
            "/pages/store/store",
            "/pages/store/detail?id=stellarbox-s1",
            "/pages/team/team",
            "/pages/team/commissions",
            "/pages/learn/courses",
            "/pages/genesis/marketplace",
          ], {
            "/pages/missions/missions": "任务中心",
            "/pages/me/profile": "个人资料",
            "/pages/me/wallet-cards-new": "绑定银行卡",
            "/pages/me/wallet-topup": "钱包充值",
            "/pages/me/wallet-exchange": "UVT / USDT 兑换",
            "/pages/me/wallet-repurchase": "锁定计划",
            "/pages/me/devices": "我的设备",
            "/pages/earn/earn": "收益",
            "/pages/store/store": "商城",
            "/pages/store/detail?id=stellarbox-s1": "UVELBox S1 详情",
            "/pages/team/team": "团队",
            "/pages/team/commissions": "奖励明细",
            "/pages/learn/courses": "学习中心",
            "/pages/staking/staking": "Staking",
            "/pages/genesis/genesis": "Genesis",
            "/pages/genesis/marketplace": "创世节点 转让市场",
          })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          任务编号只能用英文和数字，且不能重复。
        </div>
      </div>
    );
  }

  if (spec.kind === "monthly-mission-create") {
    return (
      <div className="field" data-business-form="monthly-mission-create">
        <span className="bf-legend">新建月度挑战{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("challengeCode", "编号（英文，不能重复）", "如 mc-foundation")}
          {input("challengeName", "主题名", "如 地基建设者")}
          {input("theme", "主题标签", "如 地基")}
          {input("monthsFrom", "注册时长从（月）", "0", "number")}
          {input("monthsTo", "注册时长到（月）", "2", "number")}
          {input("targetType", "目标类型", "如 earn")}
          {input("targetValue", "目标值", "200", "number")}
          {select("rewardType", "奖励类型", ["UVT", "USDT"], "monthly-reward-type", { UVT: "UVT 代币", USDT: "USDT 现金" })}
          {input("rewardAmount", "奖励量", "1500", "number")}
          {input("rewardName", "奖励展示", "如 1500 UVT")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          按注册时长发给对应用户；设置奖励需通过兑付覆盖率检查。
        </div>
      </div>
    );
  }

  if (spec.kind === "wheel-tier-config") {
    return (
      <div className="field" data-business-form="wheel-tier-config">
        <span className="bf-legend">新建转盘奖项{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("tierName", "奖项名称", "如 小额奖")}
          {input("rewardName", "奖励展示", "如 100 UVT")}
          {input("probabilityPct", "中奖概率（%）", "0–100，如 5", "number")}
          {select("realOutflow", "是否发真钱", ["0", "1"], "tier-real-outflow", { "0": "否", "1": "是" })}
          {select("rewardKind", "奖励类型", ["uvt", "usdt", "coupon"], "tier-reward-kind", { uvt: "UVT", usdt: "USDT", coupon: "代金券" })}
          {input("rewardAmount", "实际发放数量", "如 100", "number")}
          {input("voucherId", "代金券编号（奖励为代金券时填）", "如 WHEEL-50")}
          {input("dailyStock", "每日总数量（0 为不限）", "如 50", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          所有奖项概率加起来须等于 100。用户实际拿到的是「实际发放数量」，改展示名称不影响发放。USDT 奖项须选「发真钱」，并通过兑付覆盖率检查。
        </div>
      </div>
    );
  }

  if (spec.kind === "wheel-guard-config") {
    return (
      <div className="field" data-business-form="wheel-guard-config">
        <span className="bf-legend">新建转盘限制{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("guardKey", "限制类型", ["budget", "kill"], "wheel-guard-key", { budget: "每日真钱奖预算", kill: "真钱奖总开关" })}
          {input("guardLabel", "限制名称", "如 奖池预算")}
          {input("guardValue", "默认值", "如 1000")}
          {input("note", "说明", "如 单次抽奖预算上限")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          预算用完或总开关关闭后，用户无法参与转盘。每个奖项的每日数量由库存控制。
        </div>
      </div>
    );
  }

  if (spec.kind === "quest-event-config") {
    return (
      <div className="field" data-business-form="quest-event-config">
        <span className="bf-legend">新建活动{spec.subject ? <> · {spec.subject}</> : null}</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("id", "活动编号（英文，不能重复）", "如 evt-summer")}
          {input("name", "活动名", "如 夏日狂欢")}
          {select("kind", "类型", ["discount", "referral", "regional", "boost", "seasonal", "onboarding"], "event-kind", { discount: "限时折扣", referral: "邀请挑战", regional: "区域活动", boost: "加成活动", seasonal: "季节活动", onboarding: "新手活动" })}
          {select("state", "状态", ["ongoing", "upcoming", "ended"], "event-state", { ongoing: "进行中", upcoming: "待开始", ended: "已结束" })}
          {input("reward", "奖励", "如 100 UVT")}
          {input("condition", "完成条件", "如 order.paid")}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>目标值</span>
            <input className="fld" type="number" min={1} max={1_000_000_000} step={1} value={value.targetValue ?? ""} onChange={(event) => set("targetValue", event.target.value)} placeholder="至少 1，留空按 1" />
          </label>
          {input("geo", "地域范围", "如 VN / GLOBAL")}
          {input("href", "App 跳转", "如 /pages/store/store")}
          {input("startsAt", "开始时间(UTC)", "", "datetime-local")}
          {input("endsAt", "结束时间(UTC)", "", "datetime-local")}
          {select("featured", "设为主推", ["false", "true"], "event-featured", { "false": "否", "true": "是（同时只能有一个）" })}
          {select("trackable", "统计效果", ["false", "true"], "event-trackable", { "false": "否", "true": "是" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          结束时间须晚于开始时间；App 跳转只能填 /pages/ 开头的页面；主推活动须正在进行。调高奖励需通过兑付覆盖率检查。
        </div>
      </div>
    );
  }

  if (spec.kind === "promo-banner-edit") {
    const final = Number(value.baseReward) * Number(value.multiplier);
    return (
      <div className="field" data-business-form="promo-banner-edit">
        <span className="bf-legend">本周促销卡</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("baseReward", "基础奖励(UVT)", "800", "number")}
          {input("multiplier", "促销倍率 ×", "1.5", "number")}
          {input("countdownDays", "倒计时 · 天", "4", "number")}
          {input("countdownHours", "倒计时 · 时", "12", "number")}
          {input("targetDevice", "目标设备", "留空则取用户最高档设备")}
          {input("targetDaily", "展示日收益（$/天）", "7.00")}
          {select("status", "上下架", spec.statusOptions ?? ["active", "paused"], "promo-banner-status", { active: "上架中", paused: "已下架" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          最终奖励 = 基础 × 倍率 = <b>{Number.isFinite(final) ? Math.round(final) : "—"} UVT</b>，显示在 App 首页「激活设备领 UVT」促销卡上。调高奖励或倍率需通过兑付覆盖率检查；卡片文案在「页面文案对比测试」修改。
        </div>
      </div>
    );
  }

  if (spec.kind === "schema-authoring") {
    return (
      <div className="field" data-business-form="schema-authoring">
        <span className="bf-legend">登记事件</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("eventName", "事件名称", "如 device.order_paid")}
          {select("ownerDomain", "所属业务域", spec.ownerDomains ?? ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"])}
          {select("producer", "发送方", ["server", "client", "server+client"])}
          {input("consumer", "使用方", "如 转化分析、报表、风控")}
          {input("propName", "字段名称", "order_id")}
          {select("propType", "字段类型", spec.propertyTypes ?? ["string", "number", "boolean", "enum", "timestamp", "id"])}
          {select("samplingPolicy", "采集比例", spec.samplingPolicies ?? ["100%(资金/风控/转化)", "浏览 10%", "会话 25%"])}
          {input("version", "登记版本", spec.versionHint ?? "输入登记版本")}
        </div>
        <div className="row wrap" style={{ gap: 16, marginTop: 10 }}>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="schema-server-auth" type="checkbox" checked={value.isServerAuthoritative === "true"} onChange={(e) => set("isServerAuthoritative", e.target.checked ? "true" : "false")} />
            由服务器上报（资金和状态类事件必选）
          </label>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="schema-pii" type="checkbox" checked={value.isPII === "true"} onChange={(e) => set("isPII", e.target.checked ? "true" : "false")} />
            包含个人隐私信息（不能登记）
          </label>
        </div>
      </div>
    );
  }

  if (spec.kind === "disposition-lifecycle") {
    return (
      <div className="field" data-business-form="disposition-lifecycle">
        <span className="bf-legend">处理期限与复查</span>
        <div className="tint tiny" style={{ marginBottom: 10 }}>对象 <span className="mono">{spec.subject}</span> · 到期后进入待复查列表。</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("period", "期限", spec.periods ?? ["1 天", "7 天", "14 天", "30 天", "45 天"], "lifecycle-period")}
          {input("reviewAt", "复查日期", "2026-06-25", "date")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("owner", "责任人", spec.ownerHint ?? "如 风控值班人员 / 风控-张三")}
        </div>
      </div>
    );
  }

  if (spec.kind === "j4-execution-confirmation") {
    const contextLength = (value.triggerContext ?? "").trim().length;
    return (
      <div className="field" data-business-form="j4-execution-confirmation">
        <span className="bf-legend">启动原因与逐步确认</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("triggerBasis", "触发依据", spec.triggerBases, "j4-trigger-basis")}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>触发上下文（8–500 字）</span>
            <textarea
              rows={3}
              maxLength={500}
              data-proof="j4-trigger-context"
              value={value.triggerContext ?? ""}
              onChange={(event) => set("triggerContext", event.target.value)}
              placeholder="说明本次事件、影响范围和处置必要性"
            />
            <span className="tiny" style={{ color: contextLength > 0 && contextLength < 8 ? "var(--danger)" : "var(--ink-4)" }}>
              已输入 {contextLength} / 500 字
            </span>
          </label>
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>逐步确认（全部勾选后才可提交）</span>
          <div style={{ display: "grid", gap: 7, marginTop: 6 }}>
            {spec.steps.map((step, index) => {
              const key = `stepConfirm.${index}`;
              return (
                <label key={`${step.domain}-${step.ref}-${index}`} className="tint tiny" style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    data-proof={`j4-step-confirm-${index + 1}`}
                    checked={value[key] === "true"}
                    onChange={(event) => set(key, event.target.checked ? "true" : "false")}
                  />
                  <span>
                    <b>第 {index + 1} 步 · {step.domain}</b> · {step.action}
                    <span style={{ display: "block", marginTop: 2 }}>
                      编号 <span className="mono">{step.ref || "—"}</span>{step.approve ? " · 需确认" : ""}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  if (spec.kind === "sop-authoring") {
    const notifyTemplates = spec.notifyTemplates ?? [];
    const notifyQuery = (value.notifySearch ?? "").trim().toLowerCase();
    const selectedNotify = notifyTemplates.find((item) => item.value === value.notifyCampaignNo);
    const shownNotifyTemplates = notifyTemplates
      .filter((item) => !notifyQuery || (item.searchText ?? `${item.label} ${item.meta ?? ""}`).toLowerCase().includes(notifyQuery))
      .slice(0, 8);
    const chooseNotify = (item: NotifyTemplateOption) => onChange({
      ...value,
      notifyCampaignNo: item.value,
      notifyTemplate: item.label,
      notifySearch: item.label,
    });
    const actionOptions = spec.actionOptions ?? [];
    const actionQuery = (value.actionSearch ?? "").trim().toLowerCase();
    const actionLines = (value.actionSeq ?? "").split("\n").map((line) => line.trim()).filter(Boolean);
    const shownActionOptions = actionOptions
      .filter((item) => !actionQuery || (item.searchText ?? `${item.label} ${item.description ?? ""}`).toLowerCase().includes(actionQuery))
      .slice(0, 8);
    const setActionLines = (lines: string[]) => onChange({ ...value, actionSeq: lines.join("\n") });
    const normalizedActionTarget = (item: SopActionOption) => {
      const raw = (value.actionTarget ?? "").trim();
      if (!item.ref?.includes("{target}")) return "";
      if (item.domain === "J2") return /^[A-Za-z]{2}$/.test(raw) ? raw.toUpperCase() : "";
      if (item.domain === "C2") return /^[1-9]\d{0,18}$/.test(raw) ? raw : "";
      if (item.domain === "K1") return /^[A-Za-z0-9._-]{1,64}$/.test(raw) ? raw : "";
      if (item.domain === "I5") return /^[A-Za-z0-9_-]{2,32}:[A-Za-z0-9._-]{1,32}$/.test(raw) ? raw : "";
      return "";
    };
    const actionLine = (item: SopActionOption) => {
      const target = normalizedActionTarget(item);
      const ref = item.ref?.includes("{target}") ? item.ref.replace("{target}", target) : item.ref;
      return `${item.domain}·${item.action}${ref ? `·${ref}` : ""}`;
    };
    const addAction = (item: SopActionOption) => {
      if (item.ref?.includes("{target}") && !normalizedActionTarget(item)) return;
      const nextLine = actionLine(item);
      if (!actionLines.includes(nextLine)) {
        onChange({ ...value, actionSeq: [...actionLines, nextLine].join("\n"), actionTarget: "" });
      }
    };
    const removeAction = (idx: number) => setActionLines(actionLines.filter((_, i) => i !== idx));
    const splitAction = (line: string) => {
      const [domain, action] = line.split(/[·|｜]/).map((part) => part.trim()).filter(Boolean);
      return { domain: domain || "J4", action: action || line };
    };
    const rollbackOptions = spec.rollbackOptions ?? [];
    const rollbackQuery = (value.rollbackSearch ?? "").trim().toLowerCase();
    const selectedRollback = rollbackOptions.find((item) => item.plan === value.rollback || item.value === value.rollbackTemplate);
    const shownRollbackOptions = rollbackOptions
      .filter((item) => !rollbackQuery || (item.searchText ?? `${item.label} ${item.scene ?? ""} ${item.riskLevel ?? ""} ${item.plan}`).toLowerCase().includes(rollbackQuery))
      .slice(0, 8);
    const chooseRollback = (item: SopRollbackOption) => onChange({
      ...value,
      rollbackTemplate: item.value,
      rollback: item.plan,
      rollbackSearch: item.label,
    });
    const slaMinutes = parseSopSlaMinutes(value.sla)?.toString() ?? "";
    return (
      <div className="field" data-business-form="sop-authoring">
        <span className="bf-legend">应急预案步骤设置</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "预案名称", spec.nameHint ?? "如 监管点名快速止血")}
          {select("scene", "触发场景", spec.scenes ?? ["监管点名", "资金异常", "数据泄露", "舆情挤兑", "技术故障"])}
          {select("owner", "责任角色", spec.owners ?? ["风控", "合规审计", "超管", "财务"])}
          <label className="field" style={{ marginBottom: 0 }}>
            <span>响应时限</span>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                className="fld"
                aria-label="响应时限（分钟）"
                type="number"
                min={1}
                max={1440}
                step={1}
                value={slaMinutes}
                onChange={(e) => set("sla", e.target.value ? `${e.target.value} 分钟` : "")}
                placeholder="15"
              />
              <span className="muted tiny">分钟（1–1440）</span>
            </div>
            {value.slaLegacyValue && !slaMinutes && (
              <span className="tiny" role="alert" style={{ color: "var(--warning)" }}>
                旧响应时限“{value.slaLegacyValue}”格式异常，请重新输入 1–1440 分钟。
              </span>
            )}
          </label>
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>通知（步骤含「发送通知」时必选）</span>
          <input
            className="fld"
            value={value.notifySearch ?? ""}
            onChange={(e) => onChange({ ...value, notifySearch: e.target.value, notifyCampaignNo: "", notifyTemplate: "" })}
            placeholder="搜索通知标题 / 编号 / 优先级 / 受众"
          />
          <div data-proof="sop-i3-notify-template-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {spec.notifyTemplatesError ? (
              <div className="tint tiny" role="alert" style={{ marginTop: 0 }}>通知列表加载失败或没有查看权限（{spec.notifyTemplatesError}）。其他步骤不受影响；需要发通知请联系管理员。</div>
            ) : notifyTemplates.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>暂无可发送的通知，请先到「通知活动」安排，或移除发送通知的步骤。</div>
            ) : shownNotifyTemplates.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的通知，换个关键词试试。</div>
            ) : shownNotifyTemplates.map((item) => {
              const active = item.value === value.notifyCampaignNo;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => chooseNotify(item)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    alignItems: "center",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                    background: active ? "var(--brand-soft)" : "var(--surface-2)",
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>{item.label}</span>
                  <span className="mono" style={{ fontSize: 11, color: active ? "var(--brand)" : "var(--ink-3)" }}>{item.campaignNo ?? item.value}</span>
                  {item.meta && <span className="tiny" style={{ gridColumn: "1 / -1", color: "var(--ink-3)" }}>{item.meta}</span>}
                </button>
              );
            })}
          </div>
          {selectedNotify && (
            <div className="tint tiny" style={{ marginTop: 8 }}>
              已选择 <span className="mono">{selectedNotify.campaignNo}</span> · {selectedNotify.label}
            </div>
          )}
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>执行步骤</span>
          <input
            className="fld"
            value={value.actionSearch ?? ""}
            onChange={(e) => onChange({ ...value, actionSearch: e.target.value })}
            placeholder="搜索步骤"
          />
          {shownActionOptions.some((item) => item.ref?.includes("{target}")) && (
            <input
              className="fld"
              aria-label="目标域动作参数"
              value={value.actionTarget ?? ""}
              onChange={(e) => onChange({ ...value, actionTarget: e.target.value })}
              placeholder="部分步骤需先填写对象，如 US、123、cluster-001"
              style={{ marginTop: 8 }}
            />
          )}
          <div data-proof="sop-action-option-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {actionOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>暂无可用步骤，请刷新；仍为空请联系值班人员。</div>
            ) : shownActionOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的步骤，换个关键词试试。</div>
            ) : shownActionOptions.map((item) => {
              const parameterReady = !item.ref?.includes("{target}") || Boolean(normalizedActionTarget(item));
              const selected = parameterReady && actionLines.includes(actionLine(item));
              return <button
                key={item.value}
                type="button"
                disabled={selected || !parameterReady}
                onClick={() => addAction(item)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 8,
                  alignItems: "center",
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-2)",
                  color: "var(--ink)",
                  cursor: selected || !parameterReady ? "not-allowed" : "pointer",
                  opacity: selected || !parameterReady ? 0.55 : 1,
                }}
              >
                <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>{item.domain}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 650 }}>{item.action}</span>
                  {item.description && <span className="tiny" style={{ display: "block", color: "var(--ink-3)" }}>{item.description}</span>}
                  {item.parameterLabel && <span className="tiny" style={{ display: "block", color: "var(--brand)" }}>
                    参数：{item.parameterLabel}{item.parameterPlaceholder ? `（例 ${item.parameterPlaceholder}）` : ""}
                  </span>}
                </span>
                <span className="tiny" style={{ color: item.approve === false ? "var(--ink-3)" : "var(--danger)" }}>
                  {item.approve === false ? "无需确认" : "需确认"}
                </span>
              </button>;
            })}
          </div>
          <div data-proof="sop-action-sequence" style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <span className="tiny" style={{ color: "var(--ink-3)" }}>已添加的步骤</span>
            {actionLines.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>请从上方至少添加 1 个步骤。</div>
            ) : actionLines.map((line, idx) => {
              const step = splitAction(line);
              return (
                <div
                  key={`${line}-${idx}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto auto 1fr auto",
                    gap: 8,
                    alignItems: "center",
                    padding: "7px 9px",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    background: "var(--surface-3)",
                  }}
                >
                  <span className="mono" style={{ color: "var(--ink-3)", fontSize: 11 }}>{idx + 1}</span>
                  <span className="mono" style={{ color: "var(--brand)", fontSize: 11 }}>{step.domain}</span>
                  <span style={{ fontSize: 12.5, color: "var(--ink-2)" }}>{step.action}</span>
                  <button
                    type="button"
                    onClick={() => removeAction(idx)}
                    style={{ border: 0, background: "transparent", color: "var(--danger)", cursor: "pointer", fontSize: 12 }}
                  >
                    移除
                  </button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>回滚方案</span>
          <input
            className="fld"
            value={value.rollbackSearch ?? ""}
            onChange={(e) => onChange({ ...value, rollbackSearch: e.target.value, rollbackTemplate: "", rollback: "" })}
            placeholder="搜索场景 / 模板 / 风险等级 / 回滚内容"
          />
          <div data-proof="sop-rollback-template-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {rollbackOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>暂无可用的回滚方案，请刷新后重试。</div>
            ) : shownRollbackOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的回滚方案，换个关键词试试。</div>
            ) : shownRollbackOptions.map((item) => {
              const active = item.plan === value.rollback || item.value === value.rollbackTemplate;
              return (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => chooseRollback(item)}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 8,
                    alignItems: "center",
                    textAlign: "left",
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${active ? "var(--brand)" : "var(--border)"}`,
                    background: active ? "var(--brand-soft)" : "var(--surface-2)",
                    color: "var(--ink)",
                    cursor: "pointer",
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 650 }}>{item.label}</span>
                  <span className="mono" style={{ fontSize: 11, color: active ? "var(--brand)" : "var(--ink-3)" }}>{item.riskLevel ?? "MEDIUM"}</span>
                  <span className="tiny" style={{ gridColumn: "1 / -1", color: "var(--ink-3)" }}>
                    {item.scene ?? "通用"} · {item.plan}
                  </span>
                </button>
              );
            })}
          </div>
          {selectedRollback && (
            <div className="tint tiny" style={{ marginTop: 8 }}>
              已选择 {selectedRollback.label} · {selectedRollback.plan}
            </div>
          )}
        </div>
        <div className="row wrap" style={{ gap: 16, marginTop: 10 }}>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="sop-emergency" type="checkbox" checked={value.emergencyTrack === "true"} onChange={(e) => set("emergencyTrack", e.target.checked ? "true" : "false")} />
            应急模式（只允许关停、暂停类步骤）
          </label>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="sop-drill" type="checkbox" checked readOnly disabled />
            发布前先检查各步骤能否执行
          </label>
        </div>
      </div>
    );
  }

  if (spec.kind === "export-wizard") {
    const aggregateOnly = spec.mode === "aggregate-only";
    const kpiRange = spec.kpiStructuredRange && isL5KpiExport(value.exportType ?? "");
    // 仅用于通用导出向导的界面提示；最终敏感性判定必须由服务端按字段复核。
    const hasPII = !/^(无 PII|无隐私信息|NONE)$/i.test(value.piiLevel || "");
    const detail = hasPII || /账单|明细|CSV/.test(value.exportType || "");
    const estRows = !value.timeRange.trim()
      ? "填时间范围后按范围估算"
      : detail
        ? "明细数据 · 行数随时间范围增长，超过 100 万行会自动拆分"
        : "汇总数据 · 约数千行";
    return (
      <div className="field" data-business-form="export-wizard">
        <span className="bf-legend">导出设置</span>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("exportType", "导出类型", spec.exportTypes ?? ["账单 CSV", "漏斗序列", "财务报表", "运营报表", "监管报告"])}
          {kpiRange ? select("window", "关键指标时间范围", Object.keys(L5_KPI_WINDOWS), L5_KPI_WINDOWS)
            : input("timeRange", "时间范围", "如 2026-W17 ~ W22 / 2026-05")}
          {kpiRange && value.window === "custom" && <>
            <label className="field"><span>开始日期（{businessZone().label}）</span><input className="fld" type="date" value={value.from ?? ""} max={value.to || l5BusinessToday()} onChange={(event) => set("from", event.target.value)} /></label>
            <label className="field"><span>结束日期（{businessZone().label}）</span><input className="fld" type="date" value={value.to ?? ""} min={value.from || undefined} max={l5BusinessToday()} onChange={(event) => set("to", event.target.value)} /></label>
          </>}
          {input("fields", aggregateOnly ? "汇总字段" : "导出字段", aggregateOnly ? "如 用户数、订单数、完成率" : "如 user_id, amount（留空则导出全部字段）")}
          {select("piiLevel", aggregateOnly ? "数据范围" : "个人隐私信息范围", spec.piiLevels ?? ["无 PII", "低(脱敏 ID)", "高(含手机 / 地址)"])}
          {select("maskPolicy", "隐私保护方式", spec.maskPolicies ?? ["默认脱敏", "字段掩码", "解密(强操作确认)"])}
          {input("recipient", "接收人 / 用途", aggregateOnly ? "如 周报分析" : "如 合规-王 / 监管报送")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("ticket", aggregateOnly ? "业务依据 / 工单" : "关联工单", aggregateOnly ? "如 BI-WEEKLY-202607" : "如 REG-20260618-001")}
        </div>
        <div className="tint tiny" data-proof="export-est" style={{ marginTop: 8 }}>
          {aggregateOnly
            ? <>只导出汇总数据，不含用户明细。确认后即可下载。</>
            : <>预计行数：{estRows} · 含敏感字段：{hasPII ? "是（需额外确认）" : "否"}</>}
        </div>
      </div>
    );
  }

  if (spec.kind === "balance-adjust") {
    const amtN = Number(value.amount);
    const dir = value.direction ?? "增加";
    const signed = !Number.isFinite(amtN) || amtN <= 0 ? "—" : `${dir === "扣减" ? "−" : dir === "冲正" ? "∓" : "+"}${amtN} ${value.currency === "UVT" ? "UVT" : value.currency ?? "USDT"}`;
    return (
      <div className="field" data-business-form="balance-adjust">
        <span className="bf-legend">调整余额</span>
        <div className="tint tiny" style={{ marginBottom: 10 }}>用户 <span className="mono">{spec.subject}</span> · 金额填本次增减的数额，不是调整后的余额。</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("direction", "调整方向", spec.directions ?? ["增加", "扣减", "冲正"], "adjust-direction")}
          {input("amount", "调整金额(正数)", "100", "number")}
          {select("currency", "币种", spec.currencies ?? ["USDT", "UVT"], "adjust-currency")}
          {input("voucher", "关联凭证", "工单号 / 链上 txid / 银行流水号")}
        </div>
        <div className="tint tiny" data-proof="adjust-entry-preview" style={{ marginTop: 10 }}>
          预览：<span className="mono" style={{ color: dir === "扣减" ? "var(--danger)" : "var(--success)" }}>{signed}</span> · 方向 {dir} · 凭证 {value.voucher || "(待填)"}
        </div>
      </div>
    );
  }

  if (surface) return (
    <div className="rd-business-form" data-business-form="destructive-reason">
      <RdNotice tone="danger" title={spec.target}>{spec.impact}</RdNotice>
      <RdCheck data-proof="destructive-ack" label="我已确认影响范围" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
    </div>
  );
  return (
    <div className="field" data-business-form="destructive-reason">
      <span className="bf-legend">确认影响</span>
      <div className="tint danger tiny rd-destructive-impact" style={{ marginBottom: 10 }}>
        目标 <span className="mono">{spec.target}</span> · {spec.impact}
      </div>
      <label className="row" style={{ gap: 8, marginTop: 10, color: "var(--ink-2)", fontSize: 12.5 }}>
        <input data-proof="destructive-ack" type="checkbox" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
        我已确认影响范围
      </label>
    </div>
  );
}

export type CoverageSnapshot = {
  coverageRatio: number;
  redlinePct: number;
  healthyPct?: number;
};

/* 操作确认弹窗 — 高敏动作确认 + 理由必填 + 可编辑「目标新值」(配置型调整);纯动作(放行/退款/封禁/pause)仅确认。 */
export type OperationApproval = {
  heading?: string;
  comparison?: ReactNode;
  disabledReason?: string;
  recover?: (reason: string) => Promise<boolean>;
  coverageCheckCopy?: string;
  completionCopy?: string;
};

export type InlineOperationApproval = {
  resolve: (value: BusinessFormValue, editValue: string) => OperationApproval | undefined;
  renderForm?: (value: BusinessFormValue, onChange: (value: BusinessFormValue) => void, locked: boolean, approval: boolean) => ReactNode;
  recover: (reason: string, value: BusinessFormValue, editValue: string) => Promise<boolean>;
  retry?: () => Promise<void>;
  pending?: boolean;
  /** Saved direct commands can expose the existing query and retry actions together. */
  initialRecovery?: "lookup" | "retry";
  expired?: boolean;
  disabledReason?: string;
  compareEdit?: { rangeLabel?: string };
  dialogClassName?: string;
  fieldLayout?: "compact";
};

export function OperationConfirmModal({ action, title, detail, content, amplifies, coverage, edit, businessForm, completionCopy: directCompletionCopy, approval: approvalSpec, inlineApproval, reasonMin: requestedReasonMin, reasonMax: requestedReasonMax, getPendingReason, getPendingBusinessValue, auditSink, briefKind, onBusinessSelectionChange, onClose, onConfirm, effect, confirmLabel = "确认提交", blockedReason, statedBrief, facts, confirmTone = "primary", coverageLead = "这项操作会让平台多付钱", coverageCheck = "提交时会先检查兑付覆盖率。", reasonPlaceholder = "例如：工单号、处理依据", reasonPolicyOptional }: { /** 系统什么时候查覆盖率，写真实路径；走审批的后端不在提交时查，传批准时的说法。 */ coverageCheck?: string; /** 框上写的标题，只写动作和对象；长单号放 facts。不传就用 action。action 照旧是记进操作记录的名字（VS-101）。 */ title?: ReactNode; reasonPlaceholder?: string; /** 紧急关停不能被规则服务挡住：规则读不到时按默认 8–200 继续（Q-06）。 */ reasonPolicyOptional?: boolean; effect?: ReactNode; confirmLabel?: string; blockedReason?: ReactNode; statedBrief?: { impact: string; check: string } | ((value: BusinessFormValue) => { impact: string; check: string }); /** 传函数时随输入变：参数是填好的新值，没填好是 undefined；每次都要返回事实块，没填好时写现在的值。 */ facts?: ReactNode | ((value?: string) => ReactNode); confirmTone?: "primary" | "danger"; coverageLead?: ReactNode; action: ReactNode; detail: ReactNode; content?: ReactNode; amplifies?: boolean; coverage?: CoverageSnapshot; edit?: EditSpec; businessForm?: BusinessFormSpec; completionCopy?: string; approval?: OperationApproval; inlineApproval?: InlineOperationApproval; reasonMin?: number; reasonMax?: number; getPendingReason?: () => string | undefined; getPendingBusinessValue?: () => BusinessFormValue | undefined; auditSink?: "a2" | "local-history"; briefKind: OperatorBriefKind | ((value: BusinessFormValue) => OperatorBriefKind); onBusinessSelectionChange?: (next: BusinessFormValue) => Promise<BusinessFormSpec | undefined>; onClose: () => void; onConfirm: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void | Promise<void> }) {
  const surface = useRdSurface();
  const [pendingReason, setPendingReason] = useState(() => getPendingReason?.());
  const [draftReason, setReason] = useState(pendingReason ?? "");
  const reason = pendingReason ?? draftReason;
  const [newVal, setNewVal] = useState(() => initEditValue(edit));
  // 原生数字框填坏时 value 是空串，只有 validity 分得清；有意清空是另一个状态（CP-54）。
  const [numberBad, setNumberBad] = useState(false);
  const [emptyChosen, setEmptyChosen] = useState(false);
  const [activeBusinessForm, setActiveBusinessForm] = useState<BusinessFormSpec | undefined>(businessForm);
  const [businessValue, setBusinessValue] = useState<BusinessFormValue>(() => getPendingBusinessValue?.() ?? initBusinessForm(businessForm));
  const [uploadStates, setUploadStates] = useState<Record<string, "uploading" | "failed" | undefined>>({});
  const [businessSelectionLoading, setBusinessSelectionLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // 结果未知（原操作可能已生效）用警示色，红只给明确失败（VS-107）。
  const [submitUnknown, setSubmitUnknown] = useState(false);
  // 刚打开不报错：字段错误等失焦或点过提交才显示（DP-06）。
  const [attempted, setAttempted] = useState(false);
  const [reasonLeft, setReasonLeft] = useState(false);
  const [editLeft, setEditLeft] = useState(false);
  const [openedForm] = useState(() => JSON.stringify([newVal, businessValue]));
  const [approvalRecovery, setApprovalRecovery] = useState<"lookup" | "retry" | null>(inlineApproval?.pending ? inlineApproval.initialRecovery ?? "lookup" : null);
  const [authoritativeReasonMin, setAuthoritativeReasonMin] = useState<number | null>(null);
  const [authoritativeReasonMax, setAuthoritativeReasonMax] = useState<number | null>(null);
  const [reasonPolicyError, setReasonPolicyError] = useState<string | null>(null);
  const reasonFieldId = useId();
  const comparisonValueId = useId();
  const comparisonUnitId = useId();
  const selectionRequestRef = useRef(0);
  const effectiveBriefKind = typeof briefKind === "function" ? briefKind(businessValue) : briefKind;
  // 影响随业务字段变（比如名单有效期选长期还是指定日期），传函数时按现在填的值算。
  const effectiveStatedBrief = typeof statedBrief === "function" ? statedBrief(businessValue) : statedBrief;
  const approval = approvalSpec ?? inlineApproval?.resolve(businessValue, newVal);
  const compareEdit = approval ? inlineApproval?.compareEdit : undefined;
  const compactFields = !!approval && inlineApproval?.fieldLayout === "compact";
  const completionCopy = approval?.completionCopy ?? directCompletionCopy;
  const recoverApproval = inlineApproval ? (reason: string) => inlineApproval.recover(reason, businessValue, newVal) : approval?.recover;
  const retryApproval = approvalRecovery === "retry" ? inlineApproval?.retry : undefined;
  const approvalOnlyLookup = approvalRecovery === "lookup" || !!(approvalRecovery && inlineApproval?.expired);
  const formLocked = submitting || !!approvalRecovery || pendingReason !== undefined;
  // 配置型调整:仅当调用方显式传 edit 才提供「目标新值」编辑控件并要求 newVal;纯动作 / 处置(放行 / 冻结 / 驳回 / pause)不传 edit → 仅确认。
  // 去除按动作名猜测的启发式正则(原 isAdjust/select 正则):既防 dispose 名含「调整 / 规则 / 启停…」误弹字段,也防 adjust 名不含触发词漏判;改为 by edit 显式契约。全域调用点已逐一显式传 edit(2026-06 跨域硬化)。
  const spec: EditSpec | null = edit ?? null;
  const comparisonUnit = compareEdit?.rangeLabel ?? spec?.unit;
  const unitDescriptionId = comparisonUnit && (compareEdit || compactFields) ? comparisonUnitId : undefined;
  const editDescribedBy = compareEdit ? [comparisonValueId, unitDescriptionId].filter(Boolean).join(" ") : unitDescriptionId;
  const actionText = typeof action === "string" ? action : "";
  const isJ4Command = businessForm?.kind === "sop-authoring" || /应急剧本|应急预案|启动演练|回滚剧本|回滚预案/.test(actionText);
  const kind = spec?.kind ?? "text";
  const opts = spec?.options ?? (kind === "select" || kind === "toggle" ? ["开启", "关闭"] : []);
  const currentNumber = spec?.current?.trim() ? Number(spec.current) : Number.NaN;
  const newNumber = Number(newVal);
  const directionalAmplifies = typeof spec?.amplifiesWhen === "function"
    ? spec.amplifiesWhen(newVal)
    : typeof spec?.amplifiesWhen === "object"
    ? spec.current === spec.amplifiesWhen.from && newVal === spec.amplifiesWhen.to
    : spec?.amplifiesWhen && newVal.trim() !== "" && Number.isFinite(currentNumber) && Number.isFinite(newNumber)
    ? spec.amplifiesWhen === "increase" ? newNumber > currentNumber : newNumber < currentNumber
    : undefined;
  const effectiveAmplifies = (activeBusinessForm?.kind === "multi-field" ? activeBusinessForm.amplifies?.(businessValue) : undefined) ?? directionalAmplifies ?? Boolean(amplifies);
  // B1 红线禁放行:只有调用方传入真实后端覆盖率时才做前端镜像拦截;后端仍是最终裁决。
  const covBlocked = Boolean(effectiveAmplifies && coverage && coverage.coverageRatio < coverage.redlinePct);
  // 改版页面里的整组审批（不带自定标题、不是内嵌审批）和直接生效的框一个样子：生效方式是标题下的标签，
  // 业务后果与谁来批分别常显，放大资金提示用同一套警示样式。
  const rdApproval = surface && !!approvalSpec && !approvalSpec.heading && !inlineApproval;
  const requestedMinimum = Number.isFinite(requestedReasonMin)
    ? Math.max(1, Math.min(200, Math.floor(requestedReasonMin!)))
    : 8;
  const reasonPolicyReady = authoritativeReasonMin !== null;
  const reasonMin = reasonPolicyReady ? Math.max(requestedMinimum, authoritativeReasonMin) : requestedMinimum;
  const requestedMaximum = requestedReasonMax ?? (isJ4Command
    ? 200
    : activeBusinessForm?.kind === "multi-field"
      ? activeBusinessForm.reasonMax
      : activeBusinessForm?.kind === "copy-experiment-create" || activeBusinessForm?.kind === "copy-experiment-start" || activeBusinessForm?.kind === "copy-experiment-discard"
        ? 200
        : undefined);
  const reasonMax = reasonPolicyReady && authoritativeReasonMax !== null
    ? Math.min(requestedMaximum ?? authoritativeReasonMax, authoritativeReasonMax)
    : requestedMaximum;
  // Mirror the server's Unicode policy for immediate UX feedback. The backend remains
  // authoritative; whitespace, controls, zero-width formatting and standalone marks
  // cannot be used to pad an operation reason to the configured minimum.
  const reasonLength = visibleReasonLength(reason);
  const reasonOk = reasonLength >= reasonMin && (reasonMax === undefined || reasonLength <= reasonMax);
  const businessMissing = missingBusinessFields(activeBusinessForm, businessValue);
  // 表单自己写了校验提示的，理由下面的清单不再写一遍（VS-105）。
  const formFeedback = surface && activeBusinessForm?.kind === "multi-field" ? activeBusinessForm.feedback?.(businessValue) : undefined;
  // 已经写在字段下的不再列一遍。
  const shownInFields = surface && activeBusinessForm?.kind === "multi-field" ? [...Object.values(multiFieldIssues(activeBusinessForm, businessValue)), ...(formFeedback?.invalid ? [formFeedback.message] : [])] : [];
  const listedMissing = businessMissing.filter((message) => !shownInFields.includes(message));
  const submittedValue = spec?.submitEditValue
    ? newVal
    : businessNewValue(activeBusinessForm, businessValue) ?? newVal;
  const editIssue = !emptyChosen && !numberBad && isEditValueValid(spec, newVal) ? spec?.validate?.(newVal) : undefined;
  const editValueOk = !editIssue && (emptyChosen || (!numberBad && isEditValueValid(spec, newVal)));
  const sameAsCurrent = !!spec?.disallowCurrent && !!newVal.trim() && (newVal.trim() === spec.current?.trim() || (kind === "number" && Number(newVal) === Number(spec.current)));
  const uploadBlocked = Object.values(uploadStates).some(Boolean);
  const canConfirm = !blockedReason && (retryApproval || pendingReason !== undefined ? !submitting && !approvalOnlyLookup && !inlineApproval?.disabledReason
    : reasonPolicyReady && !covBlocked && !approval?.disabledReason && !inlineApproval?.disabledReason && !businessSelectionLoading && !submitting && reasonOk && editValueOk && businessMissing.length === 0 && !uploadBlocked
      && (!inlineApproval || !approvalRecovery || !!approval));
  const showReasonError = !reasonOk && !retryApproval && (!surface || attempted || reasonLeft);
  const showEditError = !surface || attempted || editLeft;
  const reasonShort = reasonLength < reasonMin ? `还差 ${reasonMin - reasonLength} 字` : `操作理由不能超过 ${reasonMax} 字。`;
  // 按钮灰着时缺什么写在按钮的提示里（OP-126）。
  const missing: ReactNode[] = canConfirm || submitting ? [] : blockedReason ? [blockedReason] : [
    !reasonPolicyReady && (reasonPolicyError ?? "正在加载"),
    covBlocked && "兑付覆盖率低于红线，暂时无法提交",
    approval?.disabledReason,
    inlineApproval?.disabledReason,
    businessSelectionLoading && "正在加载",
    uploadBlocked && "图片还没上传好",
    !editValueOk && (editIssue ? editIssue : sameAsCurrent ? "和当前值一样，没有改动" : kind === "number" && (newVal.trim() || numberBad) ? editNumberError(spec!) : `填写${spec?.label ?? "新值"}`),
    ...businessMissing.map((message) => message.replace(/。+$/, "")),
    !reasonOk && (reasonLength < reasonMin ? `操作理由${reasonShort}` : reasonShort.replace(/。$/, "")),
  ].filter(Boolean);
  useEffect(() => {
    let active = true;
    setAuthoritativeReasonMin(null);
    setAuthoritativeReasonMax(null);
    setReasonPolicyError(null);
    void fetchA2ReasonPolicy().then((policy) => {
      if (active) {
        setAuthoritativeReasonMin(policy.minChars);
        setAuthoritativeReasonMax(policy.maxChars);
      }
    }).catch(() => {
      if (!active) return;
      if (reasonPolicyOptional) {
        setAuthoritativeReasonMin(8);
        setAuthoritativeReasonMax(200);
      } else {
        setReasonPolicyError("理由规则加载失败，暂时无法提交。请关闭弹窗后重试。");
      }
    });
    return () => { active = false; };
  }, [reasonPolicyOptional]);
  const handleConfirm = async () => {
    if (!canConfirm) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitUnknown(false);
    try {
      if (retryApproval) await retryApproval();
      else await onConfirm(reason.trim(), submittedValue || undefined, activeBusinessForm ? businessValue : undefined);
    } catch (error) {
      // 没权限再填也没用：提示、关框、重读权限（OP-81、OP-132）。
      if (isPermissionDenied(error)) {
        announcePermissionDenied();
        onClose();
        return;
      }
      // The domain callback owns the detailed toast. Keep the form open and
      // consume the rejection so a rejected A2/K2 request never escapes as pageerror.
      if ((approval || retryApproval) && isA2OutcomeUncertainError(error)) {
        setApprovalRecovery(recoverApproval ? "lookup" : "retry");
        setSubmitError(inlineApproval ? `${error.message} 命令号：${error.commandKey}` : `提交结果暂未确认，可能已生成审批单。请查询原操作，或按原配置和理由重试。命令号：${error.commandKey}`);
      } else {
        setApprovalRecovery(inlineApproval?.initialRecovery && getPendingReason?.() !== undefined ? inlineApproval.initialRecovery : null);
        setSubmitUnknown(error instanceof Error && /Outcome(Uncertain|Unknown)Error$/.test(error.name) || getPendingReason?.() !== undefined);
        setSubmitError(operationConfirmErrorMessage(error));
      }
    } finally {
      setPendingReason(getPendingReason?.());
      setSubmitting(false);
    }
  };
  const handleApprovalLookup = async () => {
    if (!recoverApproval || submitting) return;
    setSubmitting(true);
    try {
      if (!await recoverApproval(reason.trim())) {
        setApprovalRecovery("retry");
        setSubmitError("暂未查到原审批单，可稍后再查，或按原配置和理由重试。");
      }
    } catch (error) {
      setSubmitError(isA2OutcomeUncertainError(error) ? error.message : operationConfirmErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  };
  const handleClose = () => {
    if (!submitting) onClose();
  };
  const handleBusinessSelectionChange = async (next: BusinessFormValue) => {
    setBusinessValue(next);
    if (!onBusinessSelectionChange) return;
    const requestId = selectionRequestRef.current + 1;
    selectionRequestRef.current = requestId;
    setBusinessSelectionLoading(true);
    try {
      const refreshed = await onBusinessSelectionChange(next);
      if (refreshed && selectionRequestRef.current === requestId) {
        setActiveBusinessForm(refreshed);
        setBusinessValue(initBusinessForm(refreshed));
      }
    } catch {
      // 调用方负责展示领域错误；这里保持原表单，不让异步异常逃逸到全局。
    } finally {
      if (selectionRequestRef.current === requestId) setBusinessSelectionLoading(false);
    }
  };
  const submitLabel = pendingReason !== undefined ? "重试原操作" : approvalRecovery === "retry" ? "按原操作重试" : approval ? "提交审批" : confirmLabel;
  // 放大提示固定在关键信息层，先于所有填写项。
  const coverageFirst = surface && (!approval || rdApproval);
  // 事实区随输入变（比如改基准价时买入价写「现在 → 改后」）：新值填好才交给页面。
  const shownFacts = typeof facts === "function" ? facts(editValueOk ? newVal : undefined) : facts;
  const coverageInFacts = coverageFirst && !!shownFacts;
  const checkCopy = rdApproval ? approvalSpec?.coverageCheckCopy ?? "提交和批准时检查兑付覆盖率。" : coverageCheck;
  const coverageNotice = effectiveAmplifies && (
    surface ? <div className="rd-confirm-funding">
      <RdNotice tone={covBlocked ? "danger" : "warn"} title={<>{coverageLead}{!coverage && auditSink !== "local-history" && <Explain label="什么时候检查" content={checkCopy} />}</>}>
        {coverage && <div className="rd-funding-coverage">
          兑付覆盖率 <b>{fmtPct(coverage.coverageRatio)}</b>，红线 <b>{fmtConfigPct(coverage.redlinePct)}</b>
          <Explain label="这项操作对资金的影响" content={<><p>{checkCopy}</p>{coverage.healthyPct !== undefined && <p>健康线 {fmtConfigPct(coverage.healthyPct)}。</p>}</>} />
        </div>}
        {covBlocked && <p>{checkCopy}低于红线，暂时无法提交。</p>}
        {!coverage && auditSink === "local-history" && <p>{checkCopy}本页暂不自动检查覆盖率，请自行确认资金影响。</p>}
      </RdNotice>
    </div> : <div className="alertbar danger" style={{ marginBottom: 16, border: 0 }}>
      <span className="ico"><Icon name="alert" size={16} /></span>
      <div className="tiny">
        <b>{coverageLead}</b> · {checkCopy}
        {coverage ? (
          <>
            兑付覆盖率 <b className="mono">{fmtPct(coverage.coverageRatio)}</b>
            {coverage.healthyPct !== undefined && coverage.coverageRatio >= coverage.healthyPct
              ? `，高于健康线 ${fmtConfigPct(coverage.healthyPct)}`
              : coverage.coverageRatio > coverage.redlinePct
                ? `，高于红线 ${fmtConfigPct(coverage.redlinePct)}，请谨慎提交`
                : coverage.coverageRatio === coverage.redlinePct
                  ? `，正好在红线 ${fmtConfigPct(coverage.redlinePct)}，请谨慎提交`
                  : `，低于红线 ${fmtConfigPct(coverage.redlinePct)}，提交会被拒绝`}
          </>
        ) : auditSink === "local-history" ? (
          <>本页暂不自动检查覆盖率，请自行确认资金影响。</>
        ) : null}
      </div>
    </div>
  );
  return (
    <Modal title={title ?? action} icon={confirmTone === "danger" ? "alert" : spec ? "sliders" : "shield"} tone={confirmTone === "danger" ? "danger" : "neutral"} sub={rdApproval ? effect ?? <RdStatusTag tone="progress" filled explain={completionCopy}>批准后生效</RdStatusTag> : effect} onClose={handleClose} className={["rd-confirm", inlineApproval?.dialogClassName].filter(Boolean).join(" ")} busy={submitting} dirty={JSON.stringify([newVal, businessValue]) !== openedForm}
      footer={<>
        <Btn disabled={submitting} onClick={handleClose}>取消</Btn>
        {approvalRecovery && recoverApproval && (
          <Btn variant={approvalRecovery === "lookup" ? "primary" : undefined} disabled={submitting} onClick={() => void handleApprovalLookup()}>
            {submitting ? "查询中…" : "查询原操作"}
          </Btn>
        )}
        {!approvalOnlyLookup && (surface ? (
          <RdButton variant={confirmTone} loading={submitting} loadingText="提交中…"
            disabledReason={canConfirm || submitting ? undefined : missing.length ? missing.map((item, index) => <Fragment key={index}>{index > 0 && "；"}{item}</Fragment>) : "暂时无法提交"}
            onBlockedClick={() => setAttempted(true)} onClick={() => void handleConfirm()}>
            {submitLabel}
          </RdButton>
        ) : (
          <Btn variant={confirmTone} disabled={!canConfirm} onClick={() => void handleConfirm()}>
            <Icon name="check" size={15} /> {submitting ? "提交中…" : submitLabel}
          </Btn>
        ))}
      </>}>
      {/* 提交中锁住框里全部输入和选项，失败后恢复（OP-33）。display: contents 不影响排版。 */}
      <fieldset disabled={submitting} className="rd-contents" style={{ display: "contents" }}>
      {(!approval || rdApproval) && <OperatorBriefBlock action={action} detail={detail} amplifies={effectiveAmplifies} hasEdit={!!spec || !!businessForm} completionCopy={completionCopy} auditSink={auditSink} kind={effectiveBriefKind} stated={effectiveStatedBrief} />}
      {!surface && content}
      {surface ? (blockedReason || submitError) && (
        // 红只给明确失败；被别人改了、结果还不知道是要人处理，用橙黄（VS-107）。
        <div className="rd-confirm-alert"><RdNotice tone={blockedReason || approvalRecovery || submitUnknown ? "warn" : "danger"}>{keepCommandKey(blockedReason ?? submitError)}</RdNotice></div>
      ) : blockedReason
        ? <div className="alertbar warn" role="alert" style={{ marginBottom: 16 }}>{blockedReason}</div>
        : submitError && <div className="alertbar warn" role="alert" style={{ marginBottom: 16 }}>{submitError}</div>}
      {inlineApproval?.disabledReason && (surface
        ? <div className="rd-confirm-alert" role="status"><RdNotice tone="warn">{inlineApproval.disabledReason}</RdNotice></div>
        : <div className="alertbar warn" role="status" style={{ marginBottom: 16 }}>{inlineApproval.disabledReason}</div>)}
      {inlineApproval?.pending && approvalRecovery === "lookup" && !submitError && (surface
        ? <div className="rd-confirm-alert" role="status"><RdNotice tone="warn">上一次审批结果待确认，请查询原操作。</RdNotice></div>
        : <div className="alertbar warn" role="status" style={{ marginBottom: 16 }}>上一次审批结果待确认，请查询原操作。</div>
      )}
      {!reasonPolicyReady && !retryApproval && (!surface || reasonPolicyError) && (surface
        ? <div className="rd-confirm-alert" role="alert" data-policy-state="fail-closed"><RdNotice tone="warn">{reasonPolicyError ?? "正在加载，稍候即可提交。"}</RdNotice></div>
        : <div className="alertbar warn" role="alert" data-policy-state="fail-closed" style={{ marginBottom: 16 }}>
          {reasonPolicyError ?? "正在加载，稍候即可提交。"}
        </div>
      )}
      {rdApproval && approvalSpec?.disabledReason && <div className="rd-confirm-alert"><RdNotice tone="warn">{approvalSpec.disabledReason}</RdNotice></div>}
      {rdApproval && approvalSpec?.comparison}
      {approval && !rdApproval && <>
        {!approval.heading && approval.comparison && <div className="tint" style={{ marginBottom: 14 }}>{approval.comparison}</div>}
        <div className="alertbar warn" style={{ marginBottom: 14 }}>
          <span className="ico" style={{ color: "var(--operation-approval-icon, var(--warning))" }}><Icon name="alert" size={16} /></span>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <b style={{ color: "var(--warning)" }}>{approval.heading ?? "放宽配置 · 批准后生效"}</b>
            {!approval.heading && <>
              <div>{completionCopy}</div>
              <div>{approval.coverageCheckCopy ?? "提交和批准时检查兑付覆盖率。"}{covBlocked && "兑付覆盖率低于红线，暂时无法提交。"}</div>
              {coverage && <div>兑付覆盖率 <b className="mono">{fmtPct(coverage.coverageRatio)}</b> · 红线 <span className="mono">{fmtConfigPct(coverage.redlinePct)}</span></div>}
            </>}
            {approval.disabledReason && <div role="status">{approval.disabledReason}</div>}
          </div>
        </div>
        {approval.heading ? <>
          <p style={{ margin: "0 0 14px", lineHeight: 1.5 }}>{completionCopy}</p>
          {coverage && <p className="operation-approval-coverage">兑付覆盖率 <b>{fmtPct(coverage.coverageRatio)}</b> · 红线 <b>{fmtConfigPct(coverage.redlinePct)}</b></p>}
          {approval.comparison}
        </> : !compareEdit && <OperatorBriefBlock action={action} detail={detail} amplifies={effectiveAmplifies} auditSink={auditSink} kind={effectiveBriefKind} stated={effectiveStatedBrief} />}
        {(approval.heading || compareEdit) && effectiveStatedBrief && <OperatorBriefBlock action={action} detail={detail} amplifies={effectiveAmplifies} auditSink={auditSink} kind={effectiveBriefKind} stated={effectiveStatedBrief} />}
      </>}
      {!surface && !approval && coverageNotice}
      {!surface && !approval && completionCopy && <div className="tint tiny" style={{ marginBottom: 14 }}>{completionCopy}</div>}
      {shownFacts && <div className="rd-confirm-facts">{shownFacts}{coverageInFacts && coverageNotice}</div>}
      {coverageFirst && !shownFacts && coverageNotice}
      {surface && content}
      {activeBusinessForm && (
        <fieldset disabled={formLocked} style={{ border: 0, padding: 0, marginInline: 0, minWidth: 0 }}>
        {inlineApproval?.renderForm ? inlineApproval.renderForm(businessValue, setBusinessValue, formLocked, !!approval) : (
          <BusinessFormBlock spec={activeBusinessForm} value={businessValue} attempted={attempted} onChange={setBusinessValue} onSelectionChange={(next) => void handleBusinessSelectionChange(next)} onUploadStateChange={(key, state) => setUploadStates((current) => ({ ...current, [key]: state }))} />
        )}
        </fieldset>
      )}
      {uploadBlocked && (surface
        ? <div role="alert" className="rd-confirm-alert"><RdNotice tone="warn">{Object.values(uploadStates).includes("uploading") ? "图片正在上传，请完成后再提交。" : "图片上传失败，请重新上传或明确清除图片后再提交。"}</RdNotice></div>
        : <div role="alert" className="itint" style={{ marginTop: 8 }}>
        {Object.values(uploadStates).includes("uploading") ? "图片正在上传，请完成后再提交。" : "图片上传失败，请重新上传或明确清除图片后再提交。"}
      </div>)}
      {businessSelectionLoading && (surface
        ? <div className="rd-confirm-alert" role="status"><RdNotice tone="progress">正在加载该地区的版本内容…</RdNotice></div>
        : <div className="itint" style={{ marginTop: 8 }}>正在加载该地区的版本内容…</div>)}
      {spec && surface && !compareEdit && (
        // 现在值、新值输入合成一块（VS-103）：范围只写在 hint，没改时不多写一句，确认按钮禁用并写原因。
        <div className="rd-confirm-edit">
          <DiffField
            before={spec.current ? editCurrent(spec, kind).text : undefined}
            unit={editCurrent(spec, kind).unit}
            label={spec.label ?? "改后"}
            size={kind === "number" ? "key" : "body"}
            stack={kind === "text" ? (spec.current?.length ?? 0) > 14 : kind !== "number" && opts.some((o) => { const text = spec.optionLabels?.[o] ?? o; return typeof text !== "string" || text.length > 10; })}
            hint={spec.hint}
            note={spec.preview && editValueOk ? spec.preview(newVal) : undefined}
            error={retryApproval ? undefined
              : showEditError && sameAsCurrent ? "新值和当前值一样，改了才能保存。"
              : showEditError && editIssue ? editIssue
              : showEditError && !editValueOk && kind === "number" && (newVal || numberBad) ? `${editNumberError(spec)}。`
              : attempted && !editValueOk && !newVal.trim() && !numberBad ? `填写${spec.label ?? "新值"}。`
              : undefined}
          >
            {(control) => kind === "select" || kind === "toggle" ? (
              <div id={control.id} className="row wrap" role="group" aria-label="目标新值" aria-describedby={control["aria-describedby"]} style={{ gap: 8 }}>
                {opts.map((o) => <Chip key={o} tab sel={newVal === o} disabled={formLocked || spec.disabledOptions?.includes(o)} onClick={() => setNewVal(o)}>{spec.optionLabels?.[o] ?? o}</Chip>)}
              </div>
            ) : <>
              {kind === "number" ? (
                <RdNumberInput {...control} key={emptyChosen ? "empty" : "value"} aria-label="目标新值" unit={spec.unit} min={spec.min} max={spec.max} step={spec.step} value={newVal} disabled={formLocked || emptyChosen} aria-invalid={showEditError && !editValueOk && (!!newVal || numberBad) ? true : undefined} onChange={(e) => setNewVal(e.target.value)} onInput={(e) => setNumberBad(e.currentTarget.validity.badInput)} onBlur={() => setEditLeft(true)} />
              ) : (
                <input {...control} className="rd-input" aria-label="目标新值" type="text" disabled={formLocked} value={newVal} onChange={(e) => setNewVal(e.target.value)} onBlur={() => setEditLeft(true)} placeholder="输入新值" />
              )}
              {spec.emptyOption && <Chip tab sel={emptyChosen} onClick={() => { setEmptyChosen(!emptyChosen); setNewVal(""); setNumberBad(false); }}>{spec.emptyOption}</Chip>}
            </>}
          </DiffField>
        </div>
      )}
      {spec && !(surface && !compareEdit) && (
        <div className={compareEdit ? "field tint" : "field"}>
          {!compareEdit && <span className="bf-legend">{spec.label ?? "新值"}{spec.current ? <> · 当前 <span className="mono">{spec.optionLabels?.[spec.current] ?? spec.current}</span></> : null}</span>}
          {kind === "select" || kind === "toggle" ? (
            <div className="row wrap" style={{ gap: 8 }}>
              {opts.map((o) => <Chip key={o} tab sel={newVal === o} disabled={formLocked || spec.disabledOptions?.includes(o)} onClick={() => setNewVal(o)}>{spec.optionLabels?.[o] ?? o}</Chip>)}
            </div>
          ) : (
            <div className={compareEdit ? "row wrap" : "row"} style={{ gap: 8, alignItems: "center" }}>
              {compareEdit && <span id={comparisonValueId} className="muted">当前{" "}
                <strong className="tnum" style={{ color: "var(--ink)", fontSize: 14 }}>
                  {spec.current}{compareEdit.rangeLabel ? "" : ` ${spec.unit ?? ""}`}
                </strong>
              </span>}
              {compareEdit && <span aria-hidden>→</span>}
              {compareEdit && <span className="muted">拟调整</span>}
              <input
                className="fld"
                aria-label="目标新值"
                aria-describedby={editDescribedBy}
                type={kind === "number" ? "number" : "text"}
                min={kind === "number" ? spec.min : undefined}
                max={kind === "number" ? spec.max : undefined}
                step={kind === "number" ? spec.step : undefined}
                disabled={formLocked}
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                onInput={(e) => setNumberBad(e.currentTarget.validity.badInput)}
                onBlur={() => setEditLeft(true)}
                placeholder={spec.current ? `输入新值（当前 ${spec.current}）` : "输入新值"}
                style={{ maxWidth: compareEdit ? 140 : 240 }}
              />
              {comparisonUnit && <span className="muted tiny" id={unitDescriptionId}>{comparisonUnit}</span>}
              {spec.emptyOption && <Chip tab sel={emptyChosen} onClick={() => { setEmptyChosen(!emptyChosen); setNewVal(""); setNumberBad(false); }}>{spec.emptyOption}</Chip>}
            </div>
          )}
          {showEditError && !editValueOk && !retryApproval && kind === "number" && (newVal || numberBad) && !(surface && sameAsCurrent) && (
            <div className="tiny" style={{ marginTop: 7, color: "var(--warning)" }}>{editNumberError(spec)}。</div>
          )}
          {surface && attempted && !editValueOk && !newVal.trim() && !numberBad && <div className="tiny" style={{ marginTop: 7, color: "var(--warning)" }}>填写{spec.label ?? "新值"}。</div>}
          {surface && showEditError && sameAsCurrent && <div className="tiny" style={{ marginTop: 7, color: "var(--warning)" }}>新值和当前值一样，改了才能保存。</div>}
          {surface && spec.hint && <div className="rd-form-help">{spec.hint}</div>}
          {surface && spec.preview && editValueOk && <div className="rd-confirm-preview">{spec.preview(newVal)}</div>}
          {!compareEdit && (newVal || emptyChosen) && spec.current && !sameAsCurrent && (!surface || editValueOk) && (
            <div className="tiny" style={{ marginTop: 8, color: "var(--ink-3)" }}>
              {surface ? "现在" : "当前"} <span className="mono">{spec.optionLabels?.[spec.current] ?? spec.current}</span> → {surface ? "改后" : "新"} <span className="mono" style={{ color: "var(--brand)" }}>{emptyChosen ? spec.emptyOption : <>{spec.optionLabels?.[newVal] ?? newVal}{spec.unit ? ` ${spec.unit}` : ""}</>}</span>
            </div>
          )}
        </div>
      )}
      {surface && !approval && !coverageFirst && coverageNotice}
      <div className={surface ? "field rd-reason-field" : "field"}>
        {surface
          ? <label htmlFor={reasonFieldId}>{approval && !compactFields && !rdApproval ? "变更理由" : "操作理由"}<span className="rd-form-required" aria-hidden="true">*</span></label>
          : <label htmlFor={reasonFieldId}>{approval && !compactFields ? "变更理由" : "操作理由"}{(compareEdit || approval?.heading) && <span aria-hidden="true" style={{ color: "var(--danger)" }}> *</span>}{compactFields ? <span className="muted"> 至少 {reasonMin} 字</span> : `（必填，${reasonMax ? `${reasonMin}–${reasonMax} 字` : `至少 ${reasonMin} 字`}）`}</label>}
        {/* 字数写在框内角落，够不够看按钮的提示，失焦或点过提交才用警告色（DP-06）。 */}
        <div className={surface ? "rd-reason-box" : compactFields ? "g3-reason-box" : undefined}>
          <textarea id={reasonFieldId} className={surface ? "rd-input rd-textarea" : undefined} rows={3} maxLength={reasonMax} value={reason} aria-invalid={surface && showReasonError ? true : undefined} aria-required={compareEdit || inlineApproval?.dialogClassName ? true : undefined} aria-describedby={surface ? `${reasonFieldId}-range ${reasonFieldId}-count${showReasonError ? ` ${reasonFieldId}-length` : ""}` : inlineApproval?.dialogClassName && (compactFields || showReasonError || (reasonOk && reasonMax)) ? `${reasonFieldId}-length` : undefined} disabled={inlineApproval ? formLocked : !!approval ? submitting || !!approvalRecovery : submitting || (!!getPendingReason && pendingReason !== undefined)} onChange={(e) => setReason(e.target.value)} onBlur={() => setReasonLeft(true)} placeholder={compactFields ? "填写调整依据或工单号" : reasonPlaceholder} />
          {surface && <span id={`${reasonFieldId}-count`} className="rd-reason-count">{reasonMax ? `${reasonLength}/${reasonMax}` : `${reasonLength} 字`}</span>}
        </div>
        {surface && <div id={`${reasonFieldId}-range`} className="rd-form-help">{reasonMax ? `${reasonMin}–${reasonMax} 字` : `至少 ${reasonMin} 字`}</div>}
        {pendingReason !== undefined && <div className={surface ? "rd-form-help" : "tiny"} style={surface ? undefined : { marginTop: 7 }}>{surface ? "重发原内容，已成功的不会重复执行。" : "原操作结果尚未确认，理由已锁定。重试将继续原操作，不会重复执行。"}</div>}
        {!surface && compactFields && <div id={`${reasonFieldId}-length`} className="tiny reason-count-inset">
          {reasonMax && <span>{reasonLength}/{reasonMax}</span>}
          {showReasonError && <span style={{ color: "var(--warning)" }}>{reasonShort}</span>}
        </div>}
        {showReasonError && (surface || !compactFields) && (
          <div id={`${reasonFieldId}-length`} className={surface ? "rd-form-error" : "tiny"} role={surface ? "alert" : undefined} style={surface ? undefined : { marginTop: 7, color: "var(--warning)" }}>{reasonShort}</div>
        )}
        {!surface && !compactFields && reasonMax && reasonOk && <div id={`${reasonFieldId}-length`} className="tiny" style={{ marginTop: 7, color: approval || inlineApproval?.dialogClassName ? "var(--ink-3)" : "var(--ink-4)" }}>已填写 {reasonLength}/{reasonMax} 字</div>}
        {listedMissing.length > 0 && (!surface || attempted) && (
          <div className={surface ? "rd-form-error" : "tiny"} style={surface ? undefined : { marginTop: 7, color: "var(--warning)" }}>
            请检查以下内容： {listedMissing.slice(0, 4).map((message) => message.replace(/。+$/, "")).join(" / ")}{listedMissing.length > 4 ? "…" : ""}。
          </div>
        )}
      </div>
      </fieldset>
    </Modal>
  );
}

/* 页面没传提示类型时按这几种明确的说法判断，别的还是信息。页面都传 kind 后删掉。 */
const TOAST_KIND_BY_WORDS: readonly (readonly [RegExp, ToastKind])[] = [[/^已(?!.*但)/, "success"], [/失败|错误/, "error"], [/未确认|待确认|未完成|不能|无法|没有提交/, "warn"]];

/* 保留旧调用契约，反馈交给根布局，页面/抽屉卸载后仍可见。第二个参数写提示类型（CP-70）：成功 success、失败 error、要人注意或结果未知 warn，其余 info。 */
export function useToast(): [ReactNode, (s: string, kind?: ToastKind) => void] {
  const key = useId();
  const show = useCallback((title: string, kind?: ToastKind) => { useUI.getState().pushToast({ kind: kind ?? TOAST_KIND_BY_WORDS.find(([words]) => words.test(title))?.[1] ?? "info", title, key }); }, [key]);
  return [null, show];
}

/* 跨域跳转 hook(对应设计稿 ctx.setActive(domainLetter)) */
export function useDomainNav() {
  const router = useRouter();
  return (domainLetter: string) => router.push(DOMAIN_HOME[domainLetter] ?? "/");
}
