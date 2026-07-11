"use client";

/**
 * 设计稿内容层共享原语(从设计稿 admin-shell.jsx 移植为 TSX)。
 * 配合 .dkpage 作用域 CSS(globals.css)复刻设计稿内容页富布局。
 * 适配:Modal/Drawer 补 ESC+聚焦+点遮罩关闭(a11y 铁律);OperationConfirmModal 负责高敏操作确认 + 理由留痕;
 * 跨域跳转用 next/navigation。导航/外壳仍沿用本项目 shell。
 */
import { isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AutoGloss } from "@/app/components/kit/gloss";

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
  | "arrow" | "flame" | "geo" | "clock" | "image";

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

export const Chip = ({ sel, tab, onClick, children }: { sel?: boolean; tab?: boolean; onClick?: () => void; children: ReactNode }) => (
  <span className={"chip " + (tab ? "tab " : "") + (sel ? "sel" : "")} onClick={onClick}>{children}</span>
);

export const Badge = ({ tone = "neutral", children }: { tone?: string; children: ReactNode }) => (
  <span className={"badge-s " + tone}>{children}</span>
);

export const Btn = ({ variant, sm, children, ...rest }: { variant?: string; sm?: boolean; children: ReactNode } & AnyProps) => (
  <button className={"btn " + (variant || "") + (sm ? " sm" : "")} {...rest}>{children}</button>
);

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
            outline: "none",
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
  return (
    <div
      data-pagination-exempt="true"
      data-pagination-label={label}
      data-pagination-reason={reason}
      data-pagination-max-rows={maxRows}
      data-pagination-kind={kind}
      className="pagination-exempt"
      style={{
        borderTop: "1px solid var(--border)",
        background: "var(--surface-2)",
        color: "var(--ink-4)",
        fontSize: 11.5,
        padding: "9px 12px",
      }}
    >
      <span className="mono">paginationExempt</span> · {label} · {kind} · 最多 {maxRows} 行 · {reason}
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
export function Modal({ title, icon, onClose, children, footer, wide }: { title: ReactNode; icon?: IconName; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 仅在打开(mount)时聚焦一次:绝不放进 [onClose] effect,否则父组件每次渲染(输入框 onChange 改父 state → 新 inline onClose)都会重跑 focus() 抢回容器焦点 → 输入框打一个字就失焦。
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="dkpage">
    <div className="modal-scrim" onClick={onClose}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="modal" style={wide ? { maxWidth: 680, outline: "none" } : { outline: "none" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          {icon && <span className="icon-btn" style={{ border: 0, background: "var(--brand-soft)", color: "var(--brand)" }}><Icon name={icon} size={16} /></span>}
          <span className="ttl">{title}</span>
          <div className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><Icon name="x" size={16} /></button>
        </div>
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  // 仅在打开(mount)时聚焦一次:绝不放进 [onClose] effect,否则父组件每次渲染(输入框 onChange 改父 state → 新 inline onClose)都会重跑 focus() 抢回容器焦点 → 输入框打一个字就失焦。
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="dkpage">
      <div className="drawer-scrim" onClick={onClose} aria-hidden />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="drawer" style={{ outline: "none", ...(wide ? { width: "min(1180px, 96vw)" } : {}) }}>
        <div className="drawer-h">
          <div><div style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{title}</div>{sub && <div className="muted tiny">{sub}</div>}</div>
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
export function MessageThread({ messages, relWhen, resetKey, agentName, agentAvatar, handlerRole = "客服" }: { messages: ThreadMessage[]; relWhen: (ts: number) => string; accentVar?: string; resetKey?: string; agentName?: string; agentAvatar?: ReactNode; handlerRole?: string }) {
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
                <span className="msg-script" style={{ marginTop: 6 }}>CTA → {m.ctaHref}</span>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}

/* 配置型调整的目标新值编辑规格(可选;不传则仅确认动作本身) */
export type EditSpec = { kind?: "number" | "text" | "select" | "toggle"; current?: string; unit?: string; options?: string[] };
export type BusinessFormValue = Record<string, string>;
type RoleOption = { key: string; label: string; scope?: string };
type PermissionRole = { key: string; label: string; current: string };
type NotifyTemplateOption = { value: string; label: string; campaignNo?: string; meta?: string; tier?: string; status?: string; audience?: string; searchText?: string };
type SopActionOption = { value: string; label: string; domain: string; action: string; ref?: string | null; approve?: boolean; description?: string; searchText?: string };
type SopRollbackOption = { value: string; label: string; scene?: string; riskLevel?: string; plan: string; searchText?: string };
export type SchemaPropertyDraft = { name: string; type: string; pii: boolean };

function initEditValue(spec?: EditSpec | null): string {
  if (!spec) return "";
  const kind = spec.kind ?? "text";
  if (kind !== "select" && kind !== "toggle") return "";
  const current = spec.current?.trim();
  if (!current) return "";
  const options = spec.options ?? ["开启", "关闭"];
  return options.includes(current) ? current : "";
}

export type BusinessFormSpec =
  | { kind: "role-select"; currentRole: string; roles: RoleOption[]; guardHint?: string;
      /** 可选:传入全域动作 + 各角色授权向量,启用「角色变更权限 diff 预览」(新增/移除/受影响域)。 */
      actions?: { label: string; domainGroup?: string }[]; grantsByRole?: Record<string, string[]> }
  | { kind: "identity-verify"; subject: string; channels?: string[]; ticketHint?: string }
  | { kind: "schema-authoring"; ownerDomains?: string[]; propertyTypes?: string[]; samplingPolicies?: string[]; versionHint?: string }
  | { kind: "disposition-lifecycle"; subject: string; periods?: string[]; ownerHint?: string }
  | { kind: "balance-adjust"; subject: string; currencies?: string[]; directions?: string[] }
  | { kind: "sop-authoring"; scenes?: string[]; owners?: string[]; nameHint?: string; notifyTemplates?: NotifyTemplateOption[]; actionOptions?: SopActionOption[]; rollbackOptions?: SopRollbackOption[];
      currentName?: string; currentScene?: string; currentOwner?: string; currentSla?: string; currentEmergencyTrack?: boolean;
      currentActionSeq?: string; currentNotifyCampaignNo?: string; currentNotifyTemplate?: string; currentRollback?: string; currentDrillRequired?: boolean }
  | { kind: "export-wizard"; exportTypes?: string[]; piiLevels?: string[]; maskPolicies?: string[] }
  | { kind: "permission-matrix"; roles: PermissionRole[]; actionLabel?: string; guardHint?: string; grantOptions?: string[] }
  | { kind: "localized-copy"; keyName?: string; zh?: string; en?: string; placeholders?: string[] }
  | { kind: "copy-edit"; keyName?: string; version?: string; surface?: string; zh?: string; en?: string; placeholders?: string[]; audiences?: string[]; trafficSplits?: string[]; versionNote?: string }
  | { kind: "course-authoring"; rewardMin?: number; rewardMax?: number; categories?: string[]; durations?: string[]; publishStates?: string[] }
  | { kind: "campaign-edit"; tiers?: string[]; audiences?: string[]; title?: string; body?: string; defaultTier?: string; defaultAudience?: string; budget?: string }
  | { kind: "generation-gate"; mode: "create" | "edit"; skuOptions: string[]; phaseOptions: string[]; phaseLabels?: Record<string, ReactNode>; skuId?: string; name?: string; releaseMonth?: number; phase?: string; discount?: number; eligibility?: boolean; phaseOffset?: number; forceUnlock?: boolean }
  | { kind: "phase-config"; mode: "create" | "edit"; label?: string; meta?: string; skus?: string; sortOrder?: number; status?: string }
  | { kind: "version-authoring"; version?: string; jurisdiction?: string; zh?: string; en?: string; chapters?: string[]; languageScopes?: string[]; effectiveDate?: string; requiresReack?: boolean }
  | { kind: "destructive-reason"; target: string; impact: string; requireAck?: boolean }
  | { kind: "task-edit"; subject?: string; currentName?: string; currentPath?: string; currentReward?: string; currentStatus?: string; statusOptions?: string[]; currentCompletionType?: string; currentCompletionEvent?: string; completionTypeOptions?: string[] }
  | { kind: "day-one-window"; currentActiveHours?: string; currentGraceHours?: string }
  | { kind: "day-one-tri-reward"; currentActive?: string; currentGrace?: string; currentExpired?: string }
  // 通用多字段配置:一个「调整」按钮 → 一个弹窗里编辑 N 个带标签的值(各值独立 backend-replaceable,
  // 配合 EOp "param-multi" + McSpec.paramKeys 把每字段写到自己的 param key)。
  // ascending=true 时校验 number 字段严格递增(如 分段月界 早末<中末<总月数)。
  | { kind: "multi-field"; title?: string; hint?: string; ascending?: boolean; fields: { key: string; label: string; current?: string; placeholder?: string; inputKind?: "number" | "text" | "select"; options?: string[]; min?: number; max?: number; step?: number; wide?: boolean }[] }
  | { kind: "weekly-task-edit"; subject?: string; currentCond?: string; currentReward?: string; currentStatus?: string; statusOptions?: string[]; currentCompletionType?: string; currentCompletionEvent?: string; completionTypeOptions?: string[] }
  | { kind: "monthly-task-edit"; subject?: string; currentTheme?: string; currentAge?: string; currentReward?: string; currentGoals?: string; currentStatus?: string; statusOptions?: string[] }
  | { kind: "voucher-config"; subject?: string; applicableSkuOptions?: string[]; applicableSkuLabels?: Record<string, string>; currentName?: string; currentType?: string; currentAmountUSD?: string; currentPercent?: string; currentMinPurchaseUSD?: string; currentMaxDiscountUSD?: string; currentApplicableSkus?: string; currentAudience?: string; currentStartDate?: string; currentEndDate?: string; currentClaimSurfaces?: string; currentPopupEnabled?: string; currentStackWithTrial?: string; currentStackWithOthers?: string; currentSplittable?: string; currentStatus?: string }
  | { kind: "promo-banner-edit"; currentBaseReward?: string; currentMultiplier?: string; currentCountdownDays?: string; currentCountdownHours?: string; currentTargetDevice?: string; currentTargetDaily?: string; currentStatus?: string; statusOptions?: string[] }
  | { kind: "vrank-reward-edit"; subject?: string; voucherOptions?: string[]; voucherLabels?: Record<string, string>; skuOptions?: string[]; skuLabels?: Record<string, string>; currentType?: string; currentAmount?: string; currentVoucherId?: string; currentSkuId?: string; currentCustom?: string }
  | { kind: "mission-create"; subject?: string }
  | { kind: "monthly-mission-create"; subject?: string }
  | { kind: "wheel-tier-config"; subject?: string }
  | { kind: "wheel-guard-config"; subject?: string }
  | { kind: "quest-event-config"; subject?: string };

type BriefRow = { label: string; text: string };

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

function buildOperatorBrief(action: ReactNode, detail: ReactNode, amplifies: boolean, hasEdit: boolean): BriefRow[] {
  const actionText = compactText(plainText(action));
  const detailText = compactText(plainText(detail));
  const all = `${actionText} ${detailText}`;
  const includes = (terms: string[]) => terms.some((term) => all.includes(term));
  const defaultCheck = hasEdit
    ? "先核对目标新值、影响范围和回滚预案。操作理由写清业务依据或工单号。"
    : "先核对操作对象、影响范围和凭证。操作理由写清业务依据或工单号。";

  if (includes(["解密导出", "数据出境", "导出", "报表", "report_exported", "PII"])) {
    return [
      { label: "要做什么", text: actionText || "生成或放行一份导出文件。" },
      { label: "影响", text: "系统会按本次范围生成下载文件。涉及用户明细时按 L5 脱敏规则处理,下载链接限时 24 小时。" },
      { label: "提交前", text: "确认导出范围、字段、行数、脱敏方式和接收人。操作理由写导出依据、工单号或调证编号。" },
    ];
  }

  if (hasEdit || includes(["调整", "配置", "改值", "改旋钮", "参数", "阈值", "权重", "比例", "排程", "新增", "创建", "设置"])) {
    return [
      { label: "要做什么", text: actionText || "修改一个后台参数或规则。" },
      { label: "影响", text: "新值会按页面说明生效,可能影响后续订单、风控、报表或用户可见状态。" },
      { label: "提交前", text: `${defaultCheck}${amplifies ? "该改动会放大资金流出,系统会先检查备付金覆盖率。" : ""}` },
    ];
  }

  if (includes(["提现", "放行", "退款", "退回", "解冻", "冻结资金", "余额", "资金", "兑付", "储备", "账本"])) {
    return [
      { label: "要做什么", text: actionText || "处理一笔资金或提现状态。" },
      { label: "影响", text: "会改变用户资金、提现单或平台账本状态。放行、解冻、提高额度会消耗备付金。" },
      { label: "提交前", text: `确认用户、金额、KYC/风控命中、覆盖率和凭证。${amplifies ? "当前操作还要通过 B1 备付金覆盖率检查。" : "操作理由要说明处理依据。"}` },
    ];
  }

  if (includes(["账号", "权限", "2FA", "两步", "会话", "密码", "登录", "名单", "模拟登录", "RBAC"])) {
    return [
      { label: "要做什么", text: actionText || "处理账号、安全或权限状态。" },
      { label: "影响", text: "会影响后台账号、用户登录、会话、权限或风控名单。部分动作会立即踢线或降低安全门槛。" },
      { label: "提交前", text: "确认对象账号、授权来源、是否已做实名/主管校验。操作理由写清工单号和处理依据。" },
    ];
  }

  if (includes(["熔断", "恢复", "Kill-Switch", "封锁", "geo", "国家", "黑名单", "应急"])) {
    return [
      { label: "要做什么", text: actionText || "切换一个应急或地区管控状态。" },
      { label: "影响", text: "会立即影响对应业务入口、地区访问或资金能力。恢复类动作会重新放开用户操作。" },
      { label: "提交前", text: "确认触发来源、影响国家/业务、SLA 和通知口径。操作理由写监管、风控或应急依据。" },
    ];
  }

  if (includes(["发布", "下架", "回滚", "披露", "文案", "模板", "通知", "课程", "CMS", "重确认"])) {
    return [
      { label: "要做什么", text: actionText || "发布、回滚或下架一项内容。" },
      { label: "影响", text: "用户端看到的内容、通知或披露版本会变化。披露更新可能要求用户重新确认。" },
      { label: "提交前", text: "确认中英文、占位符、受影响法域/人群和发布时间。操作理由写版本依据和回滚方案。" },
    ];
  }

  if (includes(["备注", "标记", "判正常", "解除误判"])) {
    return [
      { label: "要做什么", text: actionText || "记录或更新一条人工判定。" },
      { label: "影响", text: includes(["备注"]) ? "只新增复审说明和审计记录,不改变账户状态或风险结论。" : "会更新风控判定结果,影响后续是否继续拦截、冻结或放行。" },
      { label: "提交前", text: "确认对象、证据链和处理结论。操作理由写清场景、依据或客服/风控工单号。" },
    ];
  }

  return [
    { label: "要做什么", text: actionText || "执行这项后台操作。" },
    { label: "影响", text: amplifies ? "确认后立即生效,并会放大资金流出;系统会先检查备付金覆盖率。" : "确认后立即生效,并写入 A2 审计记录。" },
    { label: "提交前", text: defaultCheck },
  ];
}

export function OperatorBriefBlock({ action, detail, amplifies, hasEdit }: { action: ReactNode; detail: ReactNode; amplifies?: boolean; hasEdit?: boolean }) {
  const [open, setOpen] = useState(false);
  const detailId = useId();
  const brief = buildOperatorBrief(action, detail, !!amplifies, !!hasEdit);
  const detailText = compactText(plainText(detail));
  return (
    <div className="tint brand" style={{ marginBottom: 16, border: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={detailId}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", background: "transparent", border: 0, padding: 0, cursor: "pointer", color: "var(--ink)", fontWeight: 600, fontSize: 13 }}
      >
        <span>执行摘要</span>
        <span className="tiny" style={{ color: "var(--brand)", fontWeight: 500 }}>
          {open ? "收起 " : "查看详情 "}<span aria-hidden="true">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      <div id={detailId} hidden={!open}>
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
              <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>业务规则</span>
              <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.7 }}>
                <AutoGloss>{detail}</AutoGloss>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const DEFAULT_GRANTS = ["-", "R", "M", "C"];
const DEFAULT_COURSE_CATEGORIES = ["Basics", "Earn", "Team", "Wealth", "Security"];
const DEFAULT_COURSE_DURATIONS = ["5 min", "8 min", "12 min", "15 min"];
const DEFAULT_COURSE_PUBLISH_STATES = ["draft", "ready", "published"];
const DEFAULT_CAMPAIGN_TIERS = ["critical", "high", "normal", "low"];
const DEFAULT_LANGUAGE_SCOPES = ["en+zh", "zh", "en"];

function initBusinessForm(spec?: BusinessFormSpec): BusinessFormValue {
  if (!spec) return {};
  if (spec.kind === "role-select") {
    return { role: spec.currentRole };
  }
  if (spec.kind === "permission-matrix") {
    return Object.fromEntries(spec.roles.map((r) => [`grant.${r.key}`, r.current]));
  }
  if (spec.kind === "localized-copy") {
    return { zh: spec.zh ?? "", en: spec.en ?? "" };
  }
  if (spec.kind === "copy-edit") {
    return {
      zh: spec.zh ?? "",
      en: spec.en ?? "",
      version: spec.version ?? "vNext",
      surface: spec.surface ?? "",
      audience: spec.audiences?.[0] ?? "",
      trafficSplit: spec.trafficSplits?.[0] ?? "",
      versionNote: spec.versionNote ?? "日常内容迭代",
    };
  }
  if (spec.kind === "course-authoring") {
    return {
      slug: "",
      category: spec.categories?.[0] ?? DEFAULT_COURSE_CATEGORIES[0],
      format: "Article",
      difficulty: "Beginner",
      duration: spec.durations?.[0] ?? DEFAULT_COURSE_DURATIONS[0],
      reward: String(spec.rewardMin ?? 5),
      publishState: spec.publishStates?.[0] ?? DEFAULT_COURSE_PUBLISH_STATES[0],
      titleZh: "",
      titleEn: "",
      bodyZh: "",
      bodyEn: "",
      // #39 quiz 与发奖触发(发布需配齐;草稿可空)
      quizQuestion: "",
      quizOptions: "",
      correctAnswer: "",
      passScore: "60",
      retries: "3",
      completionCond: "通过 quiz",
      rewardEvent: "quiz.passed",
      rewardIdem: "course_id + user_id",
    };
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
      discount: String(spec.discount ?? 0),
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
      version: spec.version ?? "vNext",
      jurisdiction: spec.jurisdiction ?? "",
      languageScope: spec.languageScopes?.[0] ?? DEFAULT_LANGUAGE_SCOPES[0],
      effectiveDate: spec.effectiveDate ?? "",
      requiresReack: spec.requiresReack === false ? "false" : "true",
      zh: spec.zh ?? "",
      en: spec.en ?? "",
    };
  }
  if (spec.kind === "identity-verify") {
    return { channel: spec.channels?.[0] ?? "视频核实", verifiedAt: "", ticket: "", ack: "false" };
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
    const notify = spec.notifyTemplates?.find((item) => item.value === spec.currentNotifyCampaignNo) ?? spec.notifyTemplates?.[0];
    return {
      name: spec.currentName ?? "",
      scene: spec.currentScene ?? spec.scenes?.[0] ?? "监管点名",
      owner: spec.currentOwner ?? spec.owners?.[0] ?? "风控",
      sla: spec.currentSla ?? "15 分钟",
      emergencyTrack: spec.currentEmergencyTrack === false ? "false" : "true",
      actionSeq: spec.currentActionSeq ?? "",
      actionSearch: "",
      notifyCampaignNo: spec.currentNotifyCampaignNo ?? notify?.value ?? "",
      notifyTemplate: spec.currentNotifyTemplate ?? notify?.label ?? "",
      notifySearch: spec.currentNotifyTemplate ?? "",
      rollback: spec.currentRollback ?? "",
      rollbackSearch: "",
      drillRequired: spec.currentDrillRequired === false ? "false" : "true",
    };
  }
  if (spec.kind === "export-wizard") {
    return { exportType: spec.exportTypes?.[0] ?? "账单 CSV", timeRange: "", fields: "", piiLevel: spec.piiLevels?.[0] ?? "无 PII", maskPolicy: spec.maskPolicies?.[0] ?? "默认脱敏", recipient: "", ticket: "" };
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
    return Object.fromEntries(spec.fields.map((f) => [f.key, f.current ?? f.options?.[0] ?? ""]));
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
      applicableSkus: spec.currentApplicableSkus ?? "",
      claimSurfaces: spec.currentClaimSurfaces ?? "",
      audience: spec.currentAudience ?? "all",
      status: spec.currentStatus ?? "active",
      startDate: spec.currentStartDate ?? "",
      endDate: spec.currentEndDate ?? "",
      popupEnabled: spec.currentPopupEnabled ?? "true",
      stackWithTrial: spec.currentStackWithTrial ?? "false",
      stackWithOthers: spec.currentStackWithOthers ?? "false",
      splittable: spec.currentSplittable ?? "false",
    };
  }
  if (spec.kind === "vrank-reward-edit") {
    return {
      rtype: spec.currentType ?? "nex",
      amount: spec.currentAmount ?? "",
      voucherId: spec.currentVoucherId ?? (spec.voucherOptions?.[0] ?? ""),
      skuId: spec.currentSkuId ?? (spec.skuOptions?.[0] ?? ""),
      custom: spec.currentCustom ?? "",
    };
  }
  return { rollback: "", ack: "false" };
}

function missingBusinessFields(spec: BusinessFormSpec | undefined, state: BusinessFormValue): string[] {
  if (!spec) return [];
  const missing: string[] = [];
  const needs = (key: string, label: string) => {
    if (!state[key]?.trim()) missing.push(label);
  };
  if (spec.kind === "role-select") {
    needs("role", "目标角色");
  } else if (spec.kind === "permission-matrix") {
    spec.roles.forEach((r) => needs(`grant.${r.key}`, `${r.label} 授权`));
    if (!spec.roles.some((r) => (state[`grant.${r.key}`] ?? r.current) !== r.current)) {
      missing.push("至少一个授权变更");
    }
  } else if (spec.kind === "localized-copy") {
    needs("zh", "中文文案");
    needs("en", "英文文案");
    (spec.placeholders ?? []).forEach((ph) => {
      if (!state.zh?.includes(ph) || !state.en?.includes(ph)) missing.push(`占位符 ${ph}`);
    });
  } else if (spec.kind === "copy-edit") {
    needs("version", "版本号");
    needs("surface", "投放位置");
    needs("audience", "受众");
    needs("trafficSplit", "分流比例");
    needs("versionNote", "版本说明");
    needs("zh", "中文草稿");
    needs("en", "英文草稿");
    const split = Number(state.trafficSplit);
    if (!Number.isFinite(split) || split <= 0 || split > 100) missing.push("分流比例 1-100");
    (spec.placeholders ?? []).forEach((ph) => {
      if (!state.zh?.includes(ph) || !state.en?.includes(ph)) missing.push(`占位符 ${ph}`);
    });
  } else if (spec.kind === "course-authoring") {
    ["slug", "category", "format", "difficulty", "duration", "reward", "publishState", "titleZh", "titleEn", "bodyZh", "bodyEn"].forEach((key) => needs(key, key));
    const reward = Number(state.reward);
    if (!Number.isFinite(reward)) missing.push("奖励数值");
    if (spec.rewardMin != null && reward < spec.rewardMin) missing.push(`奖励 ≥ ${spec.rewardMin}`);
    if (spec.rewardMax != null && reward > spec.rewardMax) missing.push(`奖励 ≤ ${spec.rewardMax}`);
    // #39 发布(非草稿)必须配齐 quiz 与完成条件 + 发奖触发;草稿允许留空
    if (state.publishState && state.publishState !== "draft") {
      if (!state.quizQuestion?.trim()) missing.push("Quiz 题目(发布前必填,或存草稿)");
      if (!state.correctAnswer?.trim()) missing.push("正确答案");
      if (!state.passScore?.trim()) missing.push("通过分数 / 题数");
      if (!state.completionCond?.trim()) missing.push("完成条件");
      if (!state.rewardEvent?.trim()) missing.push("发奖触发事件");
    }
  } else if (spec.kind === "campaign-edit") {
    ["title", "body", "tier", "audience", "schedule", "budget"].forEach((key) => needs(key, key));
    if (!Number.isFinite(Number(state.budget)) || Number(state.budget) < 0) missing.push("预算数值");
  } else if (spec.kind === "generation-gate") {
    needs("skuId", "SKU");
    needs("releaseMonth", "发布月");
    needs("phase", "发布阶段");
    needs("discount", "折扣");
    const month = Number(state.releaseMonth);
    const discount = Number(state.discount);
    const offset = Number(state.phaseOffset || "0");
    if (!Number.isInteger(month) || month < 1 || month > 12) missing.push("发布月 1-12");
    if (!Number.isFinite(discount) || discount < 0) missing.push("折扣金额 ≥ 0");
    if (!Number.isInteger(offset) || offset < -12 || offset > 12) missing.push("发布偏移 -12 到 12");
  } else if (spec.kind === "phase-config") {
    needs("label", "阶段名称");
    needs("sortOrder", "排序");
    needs("status", "状态");
    const sort = Number(state.sortOrder);
    if (!Number.isInteger(sort) || sort < 0 || sort > 9999) missing.push("排序 0-9999");
    if (state.status && !["active", "archived"].includes(state.status)) missing.push("状态只能为启用 / 已归档");
  } else if (spec.kind === "version-authoring") {
    ["version", "jurisdiction", "languageScope", "effectiveDate", "requiresReack", "zh", "en"].forEach((key) => needs(key, key));
  } else if (spec.kind === "destructive-reason") {
    if ((spec.requireAck ?? true) && state.ack !== "true") missing.push("影响确认");
  } else if (spec.kind === "identity-verify") {
    needs("channel", "核验渠道");
    needs("verifiedAt", "核验时间");
    needs("ticket", "来源工单号");
    if (state.ack !== "true") missing.push("已核实本人身份确认");
  } else if (spec.kind === "schema-authoring") {
    ["eventName", "ownerDomain", "producer", "propName", "propType", "samplingPolicy", "version"].forEach((key) => needs(key, key));
    if (state.eventName && !/^[a-z0-9]+\.[a-z0-9_]+$/i.test(state.eventName.trim())) missing.push("事件名须为 域.对象_动作");
    if (state.isPII === "true") missing.push("PII 禁入(隐私明文不可注册)");
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
    ["name", "scene", "owner", "sla", "actionSeq", "rollback"].forEach((k) => needs(k, k));
    needs("notifyCampaignNo", "I3 通知模板");
  } else if (spec.kind === "export-wizard") {
    ["exportType", "timeRange", "fields", "piiLevel", "maskPolicy", "recipient", "ticket"].forEach((k) => needs(k, k));
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
    spec.fields.forEach((f) => needs(f.key, f.label));
    const nums = spec.fields.filter((f) => f.inputKind === "number").map((f) => ({ f, n: Number(state[f.key]) }));
    const hasInvalidNumber = nums.some(({ n }) => !Number.isFinite(n));
    if (hasInvalidNumber) {
      missing.push("数值字段须为有效数字");
    } else {
      nums.forEach(({ f, n }) => {
        if (f.min != null && n < f.min) missing.push(`${f.label} 须 ≥ ${f.min}`);
        if (f.max != null && n > f.max) missing.push(`${f.label} 须 ≤ ${f.max}`);
      });
    }
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
      if (!Number.isFinite(a) || a <= 0) missing.push("满减面值(正数)");
    } else if (state.type === "percent") {
      const p = Number(state.percent);
      if (!Number.isFinite(p) || p <= 0 || p >= 100) missing.push("折扣率 1-99");
    }
    const surfs = (state.claimSurfaces ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (surfs.length === 0) missing.push("领取入口页面(至少一个)");
    else if (surfs.some((s) => !["home", "store", "me", "earn"].includes(s))) missing.push("领取入口仅限 home/store/me/earn");
  } else if (spec.kind === "vrank-reward-edit") {
    needs("rtype", "奖励类型");
    if (state.rtype === "usdt" || state.rtype === "nex") {
      const a = Number(state.amount);
      if (!Number.isFinite(a) || a <= 0) missing.push("奖励金额(正数)");
    } else if (state.rtype === "voucher") {
      needs("voucherId", "代金券");
    } else if (state.rtype === "sku") {
      needs("skuId", "系统 SKU");
    } else if (state.rtype === "custom") {
      needs("custom", "自定义奖励内容");
    }
  }
  return missing;
}

function businessNewValue(spec: BusinessFormSpec | undefined, state: BusinessFormValue): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === "role-select") return state.role;
  if (spec.kind === "permission-matrix") return spec.roles.map((r) => state[`grant.${r.key}`]).join("/");
  if (spec.kind === "copy-edit") return state.version;
  if (spec.kind === "version-authoring") return state.version;
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
    return Number.isFinite(f) ? `${Math.round(f)} NEX(${state.baseReward}×${state.multiplier})` : undefined;
  }
  if (spec.kind === "vrank-reward-edit") {
    const t = state.rtype;
    if (t === "usdt") return state.amount ? `USDT $${state.amount}` : undefined;
    if (t === "nex") return state.amount ? `${Number(state.amount).toLocaleString()} NEX` : undefined;
    if (t === "voucher") return state.voucherId ? `代金券 ${spec.voucherLabels?.[state.voucherId] ?? state.voucherId}` : undefined;
    if (t === "sku") return state.skuId ? `SKU ${spec.skuLabels?.[state.skuId] ?? state.skuId}` : undefined;
    if (t === "custom") return state.custom || undefined;
    return undefined;
  }
  return undefined;
}

function BusinessFormBlock({ spec, value, onChange }: { spec: BusinessFormSpec; value: BusinessFormValue; onChange: (next: BusinessFormValue) => void }) {
  const set = (key: string, v: string) => onChange({ ...value, [key]: v });
  const textArea = (key: string, label: string, placeholder: string, rows = 3) => (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <textarea rows={rows} value={value[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  );
  const input = (key: string, label: string, placeholder: string, type = "text") => (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <input className="fld" type={type} value={value[key] ?? ""} onChange={(e) => set(key, e.target.value)} placeholder={placeholder} />
    </label>
  );
  const select = (key: string, label: string, options: string[], proofOrLabels?: string | Record<string, ReactNode>, optionLabels?: Record<string, ReactNode>) => {
    const proof = typeof proofOrLabels === "string" ? proofOrLabels : undefined;
    const labels = typeof proofOrLabels === "string" ? optionLabels : proofOrLabels;
    const current = value[key] ?? options[0] ?? "";
    return (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <select className="fld" data-proof={proof} value={current} disabled={options.length === 0} onChange={(e) => set(key, e.target.value)}>
        {options.length === 0 ? <option value="">无后端返回选项</option> : options.map((o) => <option key={o} value={o}>{labels?.[o] ?? o}</option>)}
      </select>
    </label>
    );
  };

  // Multi-select chip group — stores a comma-joined string in BusinessFormValue
  // (Record<string,string>-compatible). Inline-styled with V5 tokens so it renders
  // regardless of modal scope/portal. Operators TAP options instead of typing
  // (less input, no typos — 多视角预置设计铁律).
  const multiSelect = (key: string, label: string, options: string[], proof?: string, labels?: Record<string, ReactNode>) => {
    const sel = (value[key] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const toggle = (o: string) => {
      const next = sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o];
      set(key, next.join(","));
    };
    return (
      <div className="field" style={{ marginBottom: 0 }}>
        <span>{label}</span>
        <div data-proof={proof} style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {options.length === 0 ? (
            <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>无可选项(先在 E1 上架 SKU)</span>
          ) : (
            options.map((o) => {
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
      </div>
    );
  };

  if (spec.kind === "multi-field") {
    return (
      <div className="field" data-business-form="multi-field">
        <label>{spec.title ?? "业务表单 · 多字段配置"}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.fields.map((f) => (
            <label className="field" style={{ marginBottom: 0, ...(f.wide ? { gridColumn: "1 / -1" } : {}) }} key={f.key}>
              <span>{f.label}</span>
              {f.inputKind === "select" ? (
                // 能枚举的值用下拉,不让运营手输(最高设计铁律:能勾选的不要输入)
                <select className="fld" value={value[f.key] ?? f.options?.[0] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                  {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input className="fld" type={f.inputKind === "number" ? "number" : "text"} min={f.min} max={f.max} step={f.step} value={value[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.placeholder ?? ""} />
              )}
            </label>
          ))}
        </div>
        {spec.hint && <div className="tint tiny" style={{ marginTop: 10 }}>{spec.hint}</div>}
      </div>
    );
  }
  if (spec.kind === "role-select") {
    return (
      <div className="field" data-business-form="role-select">
        <label>业务表单 · 改角色</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("role", "目标角色 role", spec.roles.map((r) => r.key), "role-select-target")}
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
            return <div className="tint tiny" data-proof="role-perm-diff" style={{ marginTop: 8 }}>权限影响预览 · 尚未变更角色,确认按钮保持禁用。</div>;
          }
          return (
            <div className="tint tiny" data-proof="role-perm-diff" style={{ marginTop: 8 }}>
              <div><b>权限影响预览</b> · 受影响域:<span className="mono">{[...domains].join(" / ") || "无"}</span></div>
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
        <label>业务表单 · 权限矩阵{spec.actionLabel ? <> · {spec.actionLabel}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.roles.map((r) => (
            <label key={r.key} className="field" style={{ marginBottom: 0 }}>
              <span>{r.label} 授权 permission · 当前 <span className="mono">{r.current}</span></span>
              <select className="fld" data-proof={`permission-grant-${r.key}`} value={value[`grant.${r.key}`] ?? r.current} onChange={(e) => set(`grant.${r.key}`, e.target.value)}>
                {grants.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
          ))}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          目标授权串 <span className="mono">{businessNewValue(spec, value)}</span>{spec.guardHint ? <> · {spec.guardHint}</> : null}
        </div>
        <div className="tint tiny" data-proof="permission-diff-preview" style={{ marginTop: 10 }}>
          {diffs.length
            ? <>变更预览: {diffs.map((r) => <span key={r.key} className="mono" style={{ marginRight: 8 }}>{r.label}:{r.current}→{value[`grant.${r.key}`]}</span>)}</>
            : <>变更预览: 尚未修改任何授权 cell,确认按钮保持禁用。</>}
        </div>
      </div>
    );
  }

  if (spec.kind === "localized-copy" || spec.kind === "copy-edit") {
    return (
      <div className="field" data-business-form={spec.kind}>
        <label>业务表单 · 双语文案{spec.keyName ? <> · <span className="mono">{spec.keyName}</span></> : null}</label>
        {spec.kind === "copy-edit" && (
          <div className="grid g-2" style={{ gap: 10, marginBottom: 10 }}>
            {input("version", "变体/版本号 variant id", "v8")}
            {input("surface", "投放位置 surface", "Home / Me / Store")}
            {select("audience", "受众 audience", spec.audiences ?? [])}
            {input("trafficSplit", "分流比例 traffic split(%)", "50", "number")}
          </div>
        )}
        <div className="grid g-2" style={{ gap: 10 }}>
          {textArea("zh", "中文 zh 文案", "填写中文草稿")}
          {textArea("en", "英文 en copy", "Fill English copy")}
        </div>
        {spec.kind === "copy-edit" && (
          <div style={{ marginTop: 10 }}>
            {textArea("versionNote", "版本说明 version note", "本次草稿变更原因、预期指标和回滚口径", 2)}
          </div>
        )}
        {(spec.placeholders ?? []).length > 0 && (
          <div className="tint tiny" style={{ marginTop: 10 }}>必含占位符: {(spec.placeholders ?? []).map((ph) => <span key={ph} className="mono" style={{ marginRight: 6 }}>{ph}</span>)}</div>
        )}
      </div>
    );
  }

  if (spec.kind === "course-authoring") {
    return (
      <div className="field" data-business-form="course-authoring">
        <label>业务表单 · 课程新建 / 编辑</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("slug", "课程 slug", "learn-earn-basics")}
          {select("category", "分类 category", spec.categories ?? DEFAULT_COURSE_CATEGORIES)}
          {select("format", "形式 format", ["Article", "Video", "Hands-on"])}
          {select("difficulty", "难度 difficulty", ["Beginner", "Intermediate", "Advanced"])}
          {select("duration", "时长 duration", spec.durations ?? DEFAULT_COURSE_DURATIONS)}
          {input("reward", `奖励 reward(${spec.rewardMin ?? 0}-${spec.rewardMax ?? 999} NEX)`, "5", "number")}
          {select("publishState", "发布状态 publish state", spec.publishStates ?? DEFAULT_COURSE_PUBLISH_STATES)}
          {input("titleZh", "中文标题", "课程标题")}
          {input("titleEn", "English title", "Course title")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {textArea("bodyZh", "中文正文", "课程正文与完成条件", 4)}
          {textArea("bodyEn", "English body", "Course body and completion criteria", 4)}
        </div>
        <div data-proof="course-quiz" style={{ marginTop: 12, paddingTop: 10, borderTop: "1px dashed var(--border)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--ink-2)" }}>Quiz 与发奖触发(发布前必填 · 存草稿可空)</div>
          <div className="grid g-2" style={{ gap: 10 }}>
            {input("quizQuestion", "Quiz 题目", "本课核心结论是?")}
            {input("quizOptions", "选项(分号分隔)", "A;B;C;D")}
            {input("correctAnswer", "正确答案", "如 A")}
            {input("passScore", "通过分数 / 通过题数", "60")}
            {input("retries", "重试次数", "3")}
            {input("completionCond", "完成条件", "通过 quiz")}
            {select("rewardEvent", "发奖触发事件", ["quiz.passed", "course.completed", "manual.grant"])}
            {input("rewardIdem", "发奖幂等键", "course_id + user_id")}
          </div>
          <div className="tint tiny" style={{ marginTop: 8 }}>单课 NEX 奖励 = 上方「奖励 reward」(过 B1 红线);发奖失败自动重试,耗尽转人工工单。<b>未配齐 quiz / 完成条件时仅可存草稿(publishState=draft)</b>。</div>
        </div>
      </div>
    );
  }

  if (spec.kind === "campaign-edit") {
    return (
      <div className="field" data-business-form="campaign-edit">
        <label>业务表单 · Campaign 编辑</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("title", "通知标题 title", "Campaign title")}
          {select("tier", "优先级 priority", spec.tiers ?? DEFAULT_CAMPAIGN_TIERS)}
          {select("audience", "受众 audience", spec.audiences ?? [])}
          {select("schedule", "排期 schedule", ["保存为草稿", "排期下发", "立即下发"])}
          {input("budget", "预算 budget(USD)", "0", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {textArea("body", "通知正文 body", "填写通知正文与跳转口径", 4)}
        </div>
      </div>
    );
  }

  if (spec.kind === "generation-gate") {
    return (
      <div className="field" data-business-form="generation-gate">
        <label>业务表单 · E1 代际发布门</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {spec.mode === "create"
            ? select("skuId", "目标 SKU", spec.skuOptions)
            : input("skuId", "目标 SKU", "sku-id")}
          {input("name", "展示名称", "留空则使用 SKU 名称")}
          {input("releaseMonth", "计划发布月", "1-12", "number")}
          {select("phase", "发布阶段", spec.phaseOptions, spec.phaseLabels)}
          {input("discount", "以旧换新折扣 USDT", "300", "number")}
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
        <label>业务表单 · E1 阶段配置</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("label", "阶段名称", "如 代际第一代")}
          {input("meta", "门槛说明", "如 L0+ / 完成 KYC")}
          {input("skus", "SKU 标签", "如 入门档 / Pro v2")}
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
    return (
      <div className="field" data-business-form="version-authoring">
        <label>业务表单 · 新版本草拟 / 发布</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("version", "版本号 version", "输入版本号")}
          {input("jurisdiction", "法域 jurisdiction", "输入法域")}
          {select("languageScope", "语言范围 language scope", spec.languageScopes ?? DEFAULT_LANGUAGE_SCOPES)}
          {input("effectiveDate", "生效日 effective date", "YYYY-MM-DD", "date")}
          {select("requiresReack", "是否要求 re-ack", ["true", "false"])}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {textArea("zh", "中文版本正文", "填写中文条款/披露正文", 4)}
          {textArea("en", "English version body", "Fill English disclosure body", 4)}
        </div>
      </div>
    );
  }

  if (spec.kind === "identity-verify") {
    return (
      <div className="field" data-business-form="identity-verify">
        <label>业务表单 · 身份核验(高敏安全动作前置)</label>
        <div className="tint danger tiny" style={{ marginBottom: 10 }}>
          目标 <span className="mono">{spec.subject}</span> · 未完成全部核验项前,确认按钮保持禁用。
        </div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("channel", "核验渠道 channel", spec.channels ?? ["视频核实", "当面核实", "回拨预留号码"], "identity-channel")}
          {input("verifiedAt", "核验时间 verified at", "2026-06-18 14:30", "datetime-local")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("ticket", "来源工单号 ticket", spec.ticketHint ?? "如 SEC-20260618-001")}
        </div>
        <label className="row" style={{ gap: 8, marginTop: 10, color: "var(--ink-2)", fontSize: 12.5 }}>
          <input data-proof="identity-ack" type="checkbox" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
          我已通过上述渠道核实本人身份,确认这不是社工冒名请求
        </label>
      </div>
    );
  }

  if (spec.kind === "task-edit") {
    return (
      <div className="field" data-business-form="task-edit">
        <label>业务表单 · 任务编辑{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "任务名称 name", "如 逛收益页")}
          {input("path", "跳转路径 path", "如 /earn")}
          {input("reward", "奖励 reward", "如 50 NEX(可双币:200 NEX + $1)")}
          {select("status", "状态 status", spec.statusOptions ?? ["active", "paused", "archived"], "task-edit-status", { active: "生效中 active", paused: "已停用 paused", archived: "已归档 archived" })}
          {select("completionType", "完成判定方式 completion", spec.completionTypeOptions ?? ["visit", "event", "manual"], "task-edit-completion", { visit: "访问路径自动 visit", event: "业务事件触发 event", manual: "手动核验 manual" })}
          {input("completionEvent", "完成触发条件 / 事件", "visit 可空;event 填 order.paid;manual 填核验说明")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          完成判定:<b>访问路径自动</b> = 用户进入「跳转路径」即判完成(浏览类);<b>业务事件触发</b> = server 监听指定事件(如 order.paid / wallet.deposited)才算完成(转化类,谎报无效);<b>手动核验</b> = 运营人工确认。
          升奖励 = 放大 NEX 流出,过 B1 红线;状态 paused = 用户端不再展示,已派发不回收。
        </div>
      </div>
    );
  }

  if (spec.kind === "voucher-config") {
    return (
      <div className="field" data-business-form="voucher-config">
        <label>业务表单 · 代金券配置{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "名称 name", "如 新人专享券")}
          {select("type", "类型 type", ["fixed", "percent"], "voucher-type", { fixed: "满减 fixed", percent: "折扣 percent" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("amountUSD", "满减面值 amount(USD)", "type=fixed 填;如 50", "number")}
          {input("percent", "折扣率 percent(%)", "type=percent 填;如 8", "number")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("minPurchaseUSD", "满减门槛 min(USD)", "满 X 可用;0=无门槛", "number")}
          {input("maxDiscountUSD", "折扣封顶 cap(USD)", "0=不封顶", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {multiSelect("applicableSkus", "适用 SKU(点选;不选=全设备)", spec.applicableSkuOptions ?? [], "voucher-skus", spec.applicableSkuLabels)}
        </div>
        <div style={{ marginTop: 10 }}>
          {multiSelect("claimSurfaces", "领取入口页面(点选)", ["home", "store", "me", "earn"], "voucher-surfaces", { home: "首页", store: "商城", me: "我的", earn: "收益" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("audience", "受众 audience", ["new", "all"], "voucher-audience", { new: "新人 new", all: "全部 all" })}
          {select("status", "状态 status", ["active", "paused"], "voucher-status", { active: "投放中 active", paused: "已暂停 paused" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {input("startDate", "生效起 start", "留空=即时", "date")}
          {input("endDate", "有效止 end", "留空=长期有效", "date")}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("popupEnabled", "首页弹窗 popup", ["true", "false"], "voucher-popup", { true: "参与弹窗 true", false: "不弹窗 false" })}
          {select("splittable", "可拆分 splittable", ["false", "true"], "voucher-splittable", { false: "不可拆分 false", true: "可拆分 true" })}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {select("stackWithTrial", "可叠加试用收益 stackWithTrial", ["false", "true"], "voucher-stack-trial", { false: "不可叠加 false", true: "可叠加 true" })}
          {select("stackWithOthers", "可叠加其它优惠 stackWithOthers", ["false", "true"], "voucher-stack-others", { false: "不可叠加 false", true: "可叠加 true" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          <b>满减</b> = 满「门槛」减「面值」;<b>折扣</b> = 百分比折扣,封顶可选。适用 SKU 不选 = 全设备(领券跳商城),单选 = 跳该 SKU 详情页。领取入口 = 关闭弹窗后展示领券 banner 的前端页面。<b>叠加策略</b>:默认不与试用收益 / 其它优惠叠加(二选一取最优)。<b>不可提现</b>(固有性质:折扣只在结算抵扣价格、永不入可提现余额)。代金券是促销折扣、非 NEX 负债,不挂 B1 红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "vrank-reward-edit") {
    const rtype = value.rtype ?? "nex";
    const voucherOpts = spec.voucherOptions ?? [];
    const skuOpts = spec.skuOptions ?? [];
    return (
      <div className="field" data-business-form="vrank-reward-edit">
        <label>业务表单 · 等级奖励{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div style={{ marginBottom: 10 }}>
          {select("rtype", "奖励类型 type", ["usdt", "nex", "voucher", "sku", "custom"], "vrank-reward-type", { usdt: "USDT 现金", nex: "NEX 代币", voucher: "代金券", sku: "系统 SKU", custom: "自定义" })}
        </div>
        {(rtype === "usdt" || rtype === "nex") && (
          <div data-proof="vrank-reward-amount">
            {input("amount", rtype === "usdt" ? "金额 amount(USDT)" : "数量 amount(NEX)", rtype === "usdt" ? "如 50" : "如 10000", "number")}
          </div>
        )}
        {rtype === "voucher" && (
          <div data-proof="vrank-reward-voucher">
            {voucherOpts.length === 0
              ? <div className="tiny" style={{ color: "var(--ink-4)" }}>暂无可选代金券(先到 H7 代金券配置 新建并投放)。</div>
              : select("voucherId", "选择代金券 voucher", voucherOpts, "vrank-reward-voucher-sel", spec.voucherLabels)}
          </div>
        )}
        {rtype === "sku" && (
          <div data-proof="vrank-reward-sku">
            {skuOpts.length === 0
              ? <div className="tiny" style={{ color: "var(--ink-4)" }}>暂无在售 SKU(先到 E1 商品上架)。</div>
              : select("skuId", "选择 SKU sku", skuOpts, "vrank-reward-sku-sel", spec.skuLabels)}
          </div>
        )}
        {rtype === "custom" && (
          <div data-proof="vrank-reward-custom">
            {input("custom", "自定义奖励内容 custom", "如 限量徽章 / 线下活动名额")}
          </div>
        )}
        <div className="tint tiny" style={{ marginTop: 10 }}>
          <b>USDT / NEX</b> = 直接发放金额(会放大资金流出,过 B1 备付金覆盖率检查);<b>代金券 / SKU</b> = 从现有代金券 / 在售 SKU 中选;<b>自定义</b> = 自由文本(线下兑付,不入资金账)。
        </div>
      </div>
    );
  }

  if (spec.kind === "day-one-window") {
    return (
      <div className="field" data-business-form="day-one-window">
        <label>业务表单 · 首日时窗</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("activeHours", "满额窗 active(小时)", "24", "number")}
          {input("graceHours", "宽限窗 grace(小时)", "72", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          满额窗内 6 项完成领满额(三相 active 档);超满额窗、宽限窗内完成领宽限档;超宽限窗过期(0)。<b>宽限窗须 ≥ 满额窗</b>。改后只对新进窗用户生效(A 方案快照不追溯);放宽窗 = 放大流出走 B1 红线核验。
        </div>
      </div>
    );
  }

  if (spec.kind === "day-one-tri-reward") {
    return (
      <div className="field" data-business-form="day-one-tri-reward">
        <label>业务表单 · 首日三相奖励</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("active", "满额 active(NEX)", "500", "number")}
          {input("grace", "宽限 grace(NEX)", "200", "number")}
          {input("expired", "过期 expired(NEX)", "0", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          满额(active 窗内 6 项完成)/ 宽限(grace 窗内)/ 过期(超窗,通常 0)三档,<b>须满额 ≥ 宽限 ≥ 过期</b>。升任一档 = 放大 NEX 流出,提交即过 B1 备付金红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "weekly-task-edit") {
    return (
      <div className="field" data-business-form="weekly-task-edit">
        <label>业务表单 · 每周任务编辑{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("cond", "条件 / 任务 cond", "如 USDT 长期质押")}
          {input("reward", "奖励 reward", "如 3,000(可双币:200 + $2)")}
          {select("status", "状态 status", spec.statusOptions ?? ["active", "paused", "archived"], "weekly-task-status", { active: "生效中 active", paused: "已停用 paused", archived: "已归档 archived" })}
          {select("completionType", "完成判定方式 completion", spec.completionTypeOptions ?? ["visit", "event", "manual"], "weekly-task-completion", { visit: "访问路径自动 visit", event: "业务事件触发 event", manual: "手动核验 manual" })}
          {input("completionEvent", "完成触发条件 / 事件", "如 stake.locked / referral.sent")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          一档按优先级命中第一条派发、二档完成池每条独立派发;完成判定多为业务事件(行为归因,谎报无效)。升奖励 = 放大 NEX 流出过 B1 红线;同周锁定、下周生效;状态 paused = 该条本周起不派发。
        </div>
      </div>
    );
  }

  if (spec.kind === "monthly-task-edit") {
    return (
      <div className="field" data-business-form="monthly-task-edit">
        <label>业务表单 · 月度挑战编辑{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("theme", "主题 theme", "如 地基建设者")}
          {input("age", "账龄段 age", "如 0–2 月")}
          {input("reward", "奖励 reward", "如 1,500 NEX")}
          {select("status", "状态 status", spec.statusOptions ?? ["active", "paused", "archived"], "monthly-task-status", { active: "生效中 active", paused: "已停用 paused", archived: "已归档 archived" })}
        </div>
        <div style={{ marginTop: 10 }}>
          {textArea("goals", "子目标 goals(3 个子目标全达成才可领)", "如 累计赚 200 · 绑卡 · 邀 1 人", 2)}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          按账龄段派发,3 个子目标全达成才可领,跨月清空重派;升奖励 = 放大 NEX 流出过 B1 红线;改动只对本月新派生效。
        </div>
      </div>
    );
  }

  if (spec.kind === "mission-create") {
    return (
      <div className="field" data-business-form="mission-create">
        <label>业务表单 · 新建任务{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("missionCode", "任务编号 code(英文唯一)", "如 dayOne-visit-earn")}
          {input("missionName", "任务名称", "如 逛收益页")}
          {input("rewardPoints", "奖励 NEX 数", "如 50", "number")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          任务编号需英文/数字唯一(作为完成事件标识);奖励放大 NEX 流出,过 B1 红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "monthly-mission-create") {
    return (
      <div className="field" data-business-form="monthly-mission-create">
        <label>业务表单 · 新建月度挑战{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("challengeCode", "编号 code(英文唯一)", "如 mc-foundation")}
          {input("challengeName", "主题名", "如 地基建设者")}
          {input("theme", "主题标签", "如 地基")}
          {input("monthsFrom", "账龄起(月)", "0", "number")}
          {input("monthsTo", "账龄止(月)", "2", "number")}
          {input("targetType", "目标类型", "如 earn")}
          {input("targetValue", "目标值", "200", "number")}
          {select("rewardType", "奖励类型", ["NEX", "USDT"], "monthly-reward-type", { NEX: "NEX 代币", USDT: "USDT 现金" })}
          {input("rewardAmount", "奖励量", "1500", "number")}
          {input("rewardName", "奖励展示", "如 1500 NEX")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          按账龄段派发;奖励 &gt; 0 会放大资金流出,过 B1 备付金红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "wheel-tier-config") {
    return (
      <div className="field" data-business-form="wheel-tier-config">
        <label>业务表单 · 新建轮盘档位{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("tierName", "档位名", "如 小额奖")}
          {input("rewardName", "奖励展示", "如 100 NEX")}
          {input("probabilityPct", "概率%", "如 5(0-100)", "number")}
          {select("realOutflow", "真实出金", ["0", "1"], "tier-real-outflow", { "0": "否(体验分/无流出)", "1": "是(真实出金)" })}
          {select("rewardKind", "奖励类型", ["nex", "usdt", "voucher", "none"], "tier-reward-kind", { nex: "NEX", usdt: "USDT", voucher: "代金券", none: "无" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          所有档位概率之和应 = 100;真实出金档位放大资金流出,过 B1 红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "wheel-guard-config") {
    return (
      <div className="field" data-business-form="wheel-guard-config">
        <label>业务表单 · 新建轮盘护栏{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("guardKey", "护栏 key(小写英文)", "如 budget")}
          {input("guardLabel", "护栏名", "如 奖池预算")}
          {input("guardValue", "默认值", "如 1000")}
          {input("note", "说明", "如 单次抽奖预算上限")}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          护栏目录项(运行时数值仍走配置项 growth.wheel.guard.*);key 需小写英文唯一。
        </div>
      </div>
    );
  }

  if (spec.kind === "quest-event-config") {
    return (
      <div className="field" data-business-form="quest-event-config">
        <label>业务表单 · 新建活动{spec.subject ? <> · {spec.subject}</> : null}</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("id", "活动 id(英文唯一)", "如 evt-summer")}
          {input("name", "活动名", "如 夏日狂欢")}
          {select("kind", "类型", ["EVENT_ACTIONS", "QUEST"], "event-kind", { EVENT_ACTIONS: "行为活动", QUEST: "任务活动" })}
          {select("state", "状态", ["ongoing", "scheduled", "ended"], "event-state", { ongoing: "进行中", scheduled: "待开始", ended: "已结束" })}
          {input("reward", "奖励", "如 100 NEX")}
          {input("condition", "完成条件", "如 order.paid")}
          {select("featured", "主推", ["false", "true"], "event-featured", { "false": "否", "true": "是(唯一)" })}
          {select("trackable", "可追踪", ["false", "true"], "event-trackable", { "false": "否", "true": "是" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          活动 id 英文唯一;主推需进行中且全局唯一;奖励放大流出过 B1 红线。
        </div>
      </div>
    );
  }

  if (spec.kind === "promo-banner-edit") {
    const final = Number(value.baseReward) * Number(value.multiplier);
    return (
      <div className="field" data-business-form="promo-banner-edit">
        <label>业务表单 · 本周转化卡</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("baseReward", "基础奖励 base(NEX)", "800", "number")}
          {input("multiplier", "促销倍率 ×", "1.5", "number")}
          {input("countdownDays", "倒计时 · 天", "4", "number")}
          {input("countdownHours", "倒计时 · 时", "12", "number")}
          {input("targetDevice", "目标设备 target", "自动(用户最高设备)")}
          {input("targetDaily", "日产展示 $/d", "7.00")}
          {select("status", "上下架 status", spec.statusOptions ?? ["active", "paused"], "promo-banner-status", { active: "上架中 active", paused: "已下架 paused" })}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          最终奖励 = 基础 × 倍率 = <b>{Number.isFinite(final) ? Math.round(final) : "—"} NEX</b>(对应前端首页「激活设备领 NEX」促销卡)。升奖励 / 倍率 = 放大 NEX 流出,过 B1 红线;文案归 I 域,本块只配奖励 / 倍率 / 倒计时 / 目标设备 / 日产 / 上下架。
        </div>
      </div>
    );
  }

  if (spec.kind === "schema-authoring") {
    return (
      <div className="field" data-business-form="schema-authoring">
        <label>业务表单 · 事件 Schema 注册</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("eventName", "事件名 eventName(域.对象_动作)", "device.order_paid")}
          {select("ownerDomain", "归属域 ownerDomain", spec.ownerDomains ?? ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"])}
          {select("producer", "生产方 producer", ["server", "client", "server+client"])}
          {input("consumer", "消费方 consumer", "B3 / L 域 BI / 风控 K")}
          {input("propName", "属性名 property", "order_id")}
          {select("propType", "属性类型 type", spec.propertyTypes ?? ["string", "number", "boolean", "enum", "timestamp", "id"])}
          {select("samplingPolicy", "采样策略 sampling", spec.samplingPolicies ?? ["100%(资金/风控/转化)", "浏览 10%", "会话 25%"])}
          {input("version", "schema 版本 version", spec.versionHint ?? "输入 schema 版本")}
        </div>
        <div className="row wrap" style={{ gap: 16, marginTop: 10 }}>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="schema-server-auth" type="checkbox" checked={value.isServerAuthoritative === "true"} onChange={(e) => set("isServerAuthoritative", e.target.checked ? "true" : "false")} />
            isServerAuthoritative(资金/状态事件必勾)
          </label>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="schema-pii" type="checkbox" checked={value.isPII === "true"} onChange={(e) => set("isPII", e.target.checked ? "true" : "false")} />
            含 PII(勾选则禁止注册 · 隐私明文禁入)
          </label>
        </div>
      </div>
    );
  }

  if (spec.kind === "disposition-lifecycle") {
    return (
      <div className="field" data-business-form="disposition-lifecycle">
        <label>业务表单 · 处置生命周期(期限 / 责任人 / 复查)</label>
        <div className="tint tiny" style={{ marginBottom: 10 }}>目标 <span className="mono">{spec.subject}</span> · 到期进入「待复查」队列,展示剩余复查时间与责任人。</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("period", "期限 period", spec.periods ?? ["1 天", "7 天", "14 天", "30 天", "45 天"], "lifecycle-period")}
          {input("reviewAt", "复查时间 review at", "2026-06-25", "date")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("owner", "责任人 owner", spec.ownerHint ?? "如 risk@nexion / 风控-张三")}
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
    const actionLine = (item: SopActionOption) => `${item.domain}·${item.action}${item.ref ? `·${item.ref}` : ""}`;
    const addAction = (item: SopActionOption) => {
      const nextLine = actionLine(item);
      setActionLines([...actionLines, nextLine]);
    };
    const removeAction = (idx: number) => setActionLines(actionLines.filter((_, i) => i !== idx));
    const splitAction = (line: string) => {
      const [domain, ...rest] = line.split(/[·|｜]/).map((part) => part.trim()).filter(Boolean);
      return { domain: domain || "J4", action: rest.join(" · ") || line };
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
    return (
      <div className="field" data-business-form="sop-authoring">
        <label>业务表单 · 应急 SOP 剧本编排</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("name", "剧本名称 name", spec.nameHint ?? "如 监管点名快速止血")}
          {select("scene", "触发场景 scene", spec.scenes ?? ["监管点名", "对账缺口", "挤兑预警", "数据泄露", "制裁名单更新"])}
          {select("owner", "责任角色 owner", spec.owners ?? ["风控", "合规审计", "超管", "财务"])}
          {input("sla", "SLA(响应时限)", "15 分钟")}
        </div>
        <div className="field" style={{ marginTop: 10, marginBottom: 0 }}>
          <span>通知模板 notify · 来自 I3</span>
          <input
            className="fld"
            value={value.notifySearch ?? ""}
            onChange={(e) => onChange({ ...value, notifySearch: e.target.value, notifyCampaignNo: "", notifyTemplate: "" })}
            placeholder="搜索通知标题 / 编号 / 优先级 / 受众"
          />
          <div data-proof="sop-i3-notify-template-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {notifyTemplates.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>I3 暂无可选通知模板,请先确认 I3 Campaign 接口已返回数据。</div>
            ) : shownNotifyTemplates.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的通知模板,请换个关键词。</div>
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
          <span>动作序列 action sequence · 后端动作模板</span>
          <input
            className="fld"
            value={value.actionSearch ?? ""}
            onChange={(e) => onChange({ ...value, actionSearch: e.target.value })}
            placeholder="搜索域 / 动作 / 参数 / 说明"
          />
          <div data-proof="sop-action-option-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {actionOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>暂无可选原子动作,请确认 J4 SOP 接口已返回 actionOptions。</div>
            ) : shownActionOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的原子动作,请换个关键词。</div>
            ) : shownActionOptions.map((item) => (
              <button
                key={item.value}
                type="button"
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
                  cursor: "pointer",
                }}
              >
                <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>{item.domain}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 12.5, fontWeight: 650 }}>{item.action}</span>
                  {item.description && <span className="tiny" style={{ display: "block", color: "var(--ink-3)" }}>{item.description}</span>}
                </span>
                <span className="tiny" style={{ color: item.approve === false ? "var(--ink-3)" : "var(--danger)" }}>
                  {item.approve === false ? "无需确认" : "需确认"}
                </span>
              </button>
            ))}
          </div>
          <div data-proof="sop-action-sequence" style={{ display: "grid", gap: 6, marginTop: 10 }}>
            <span className="tiny" style={{ color: "var(--ink-3)" }}>已编排步骤</span>
            {actionLines.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>请从上方动作模板添加至少 1 个步骤。</div>
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
          <span>回滚方案 rollback · 后端模板</span>
          <input
            className="fld"
            value={value.rollbackSearch ?? ""}
            onChange={(e) => onChange({ ...value, rollbackSearch: e.target.value, rollbackTemplate: "", rollback: "" })}
            placeholder="搜索场景 / 模板 / 风险等级 / 回滚内容"
          />
          <div data-proof="sop-rollback-template-select" style={{ display: "grid", gap: 6, marginTop: 8 }}>
            {rollbackOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>暂无可选回滚模板,请确认 J4 SOP 接口已返回 rollbackOptions。</div>
            ) : shownRollbackOptions.length === 0 ? (
              <div className="tint tiny" style={{ marginTop: 0 }}>没有匹配的回滚模板,请换个关键词。</div>
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
            应急快速轨(确认理由 SLA 压至分钟级 · 仅止血方向)
          </label>
          <label className="row" style={{ gap: 8, color: "var(--ink-2)", fontSize: 12.5 }}>
            <input data-proof="sop-drill" type="checkbox" checked={value.drillRequired === "true"} onChange={(e) => set("drillRequired", e.target.checked ? "true" : "false")} />
            发布前要求沙箱演练通过
          </label>
        </div>
      </div>
    );
  }

  if (spec.kind === "export-wizard") {
    // 预估为占位估算(真后台以任务实际行数为准):明细级 = 含 PII 或逐条明细类(账单/CSV);聚合级 = 漏斗/报表类。
    const hasPII = value.piiLevel !== "无 PII";
    const detail = hasPII || /账单|明细|CSV/.test(value.exportType || "");
    const estRows = !value.timeRange.trim()
      ? "填时间范围后按范围估算"
      : detail
        ? "明细级 · 行数随时间范围 × 字段数增长(可能超 100 万 → 自动拆分)"
        : "聚合级 · 数千行量级";
    return (
      <div className="field" data-business-form="export-wizard">
        <label>业务表单 · 导出任务向导</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("exportType", "导出类型", spec.exportTypes ?? ["账单 CSV", "漏斗序列", "财务报表", "运营报表", "监管报告"])}
          {input("timeRange", "时间范围", "如 2026-W17 ~ W22 / 2026-05")}
          {input("fields", "字段范围", "如 user_id, amount, ts(留空=全字段)")}
          {select("piiLevel", "PII 范围", spec.piiLevels ?? ["无 PII", "低(脱敏 ID)", "高(含手机 / 地址)"])}
          {select("maskPolicy", "脱敏策略", spec.maskPolicies ?? ["默认脱敏", "字段掩码", "解密(强操作确认)"])}
          {input("recipient", "接收人 / 用途", "如 合规-王 / 监管报送")}
        </div>
        <div style={{ marginTop: 10 }}>
          {input("ticket", "工单依据 ticket", "如 REG-20260618-001")}
        </div>
        <div className="tint tiny" data-proof="export-est" style={{ marginTop: 8 }}>
          预估行数(占位估算,以服务端任务实际为准):{estRows} · 超 100 万行自动拆分多任务 · 含 PII({hasPII ? "是" : "否"})或超限 → 进 <span className="mono">pending_confirm</span>;否则 <span className="mono">generating → ready(24h)→ expired</span>。提交即登记任务并落 admin.report_exported。
        </div>
      </div>
    );
  }

  if (spec.kind === "balance-adjust") {
    const amtN = Number(value.amount);
    const dir = value.direction ?? "增加";
    const signed = !Number.isFinite(amtN) || amtN <= 0 ? "—" : `${dir === "扣减" ? "−" : dir === "冲正" ? "∓" : "+"}${amtN} ${value.currency ?? "USDT"}`;
    return (
      <div className="field" data-business-form="balance-adjust">
        <label>业务表单 · 结构化调账(方向 / 金额 / 凭证)</label>
        <div className="tint tiny" style={{ marginBottom: 10 }}>目标 <span className="mono">{spec.subject}</span> · 金额输入的是「调整额」非「调整后余额」,方向由下拉显式表达,避免增减误填。</div>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("direction", "调整方向 direction", spec.directions ?? ["增加", "扣减", "冲正"], "adjust-direction")}
          {input("amount", "调整金额 amount(正数)", "100", "number")}
          {select("currency", "币种 currency", spec.currencies ?? ["USDT", "NEX"], "adjust-currency")}
          {input("voucher", "关联凭证 voucher", "工单号 / 链上 txid / 银行流水号")}
        </div>
        <div className="tint tiny" data-proof="adjust-entry-preview" style={{ marginTop: 10 }}>
          分录预览:<span className="mono" style={{ color: dir === "扣减" ? "var(--danger)" : "var(--success)" }}>{signed}</span> · 方向 {dir} · 凭证 {value.voucher || "(待填)"}
        </div>
      </div>
    );
  }

  return (
    <div className="field" data-business-form="destructive-reason">
      <label>业务表单 · 删除 / 下架影响确认</label>
      <div className="tint danger tiny" style={{ marginBottom: 10 }}>
        目标 <span className="mono">{spec.target}</span> · {spec.impact}
      </div>
      <label className="row" style={{ gap: 8, marginTop: 10, color: "var(--ink-2)", fontSize: 12.5 }}>
        <input data-proof="destructive-ack" type="checkbox" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
        我已确认影响范围,本操作将写入审计留痕
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
export function OperationConfirmModal({ action, detail, amplifies, coverage, edit, businessForm, onClose, onConfirm }: { action: ReactNode; detail: ReactNode; amplifies?: boolean; coverage?: CoverageSnapshot; edit?: EditSpec; businessForm?: BusinessFormSpec; onClose: () => void; onConfirm: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void }) {
  const [reason, setReason] = useState("");
  const [newVal, setNewVal] = useState(() => initEditValue(edit));
  const [businessValue, setBusinessValue] = useState<BusinessFormValue>(() => initBusinessForm(businessForm));
  // 配置型调整:仅当调用方显式传 edit 才提供「目标新值」编辑控件并要求 newVal;纯动作 / 处置(放行 / 冻结 / 驳回 / pause)不传 edit → 仅确认。
  // 去除按动作名猜测的启发式正则(原 isAdjust/select 正则):既防 dispose 名含「调整 / 规则 / 启停…」误弹字段,也防 adjust 名不含触发词漏判;改为 by edit 显式契约。全域调用点已逐一显式传 edit(2026-06 跨域硬化)。
  const spec: EditSpec | null = edit ?? null;
  const kind = spec?.kind ?? "text";
  const opts = spec?.options ?? (kind === "select" || kind === "toggle" ? ["开启", "关闭"] : []);
  // B1 红线禁放行:只有调用方传入真实后端覆盖率时才做前端镜像拦截;后端仍是最终裁决。
  const covBlocked = Boolean(amplifies && coverage && coverage.coverageRatio < coverage.redlinePct);
  const reasonMin = 8;
  const reasonOk = reason.trim().length >= reasonMin;
  const businessMissing = missingBusinessFields(businessForm, businessValue);
  const derivedNewVal = businessNewValue(businessForm, businessValue);
  const canConfirm = !covBlocked && reasonOk && (!spec || newVal.trim().length > 0) && businessMissing.length === 0;
  return (
    <Modal title={action} icon="shield" onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" disabled={!canConfirm} onClick={() => onConfirm(reason.trim(), (derivedNewVal ?? newVal) || undefined, businessForm ? businessValue : undefined)}>
          <Icon name="check" size={15} /> 确认执行
        </Btn>
      </>}>
      <OperatorBriefBlock action={action} detail={detail} amplifies={amplifies} hasEdit={!!spec || !!businessForm} />
      {amplifies && (
        <div className="alertbar danger" style={{ marginBottom: 16, border: 0 }}>
          <span className="ico"><Icon name="alert" size={16} /></span>
          <div className="tiny">
            <b>会增加资金流出</b> · 系统会先检查 B1 备付金覆盖率。
            {coverage ? (
              <>
                当前覆盖率 <b className="mono">{coverage.coverageRatio}%</b>
                {coverage.healthyPct !== undefined && coverage.coverageRatio >= coverage.healthyPct
                  ? `，高于健康线 ${coverage.healthyPct}%`
                  : coverage.coverageRatio >= coverage.redlinePct
                    ? `，高于红线 ${coverage.redlinePct}%，请审慎提交`
                    : `，低于红线 ${coverage.redlinePct}%，系统会拒绝提交`}
              </>
            ) : (
              <>提交时由后端实时校验覆盖率，当前弹窗不使用前端兜底值。</>
            )}
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <span className="mc"><Icon name="check" size={12} /> 操作者确认</span>
        <Icon name="arrow" size={14} />
        <span className="mc" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
          操作理由必填 · 写入 A2 审计
        </span>
        <span className="mc" style={{ background: "var(--surface-3)", color: "var(--ink-3)" }}>确认后立即生效</span>
      </div>
      {businessForm && (
        <BusinessFormBlock spec={businessForm} value={businessValue} onChange={setBusinessValue} />
      )}
      {spec && (
        <div className="field">
          <label>目标新值{spec.current ? <> · 当前 <span className="mono">{spec.current}</span></> : null}</label>
          {kind === "select" || kind === "toggle" ? (
            <div className="row wrap" style={{ gap: 8 }}>
              {opts.map((o) => <Chip key={o} tab sel={newVal === o} onClick={() => setNewVal(o)}>{o}</Chip>)}
            </div>
          ) : (
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                className="fld"
                type={kind === "number" ? "number" : "text"}
                value={newVal}
                onChange={(e) => setNewVal(e.target.value)}
                placeholder={spec.current ? `输入新值(当前 ${spec.current})` : "输入目标新值"}
                style={{ maxWidth: 240 }}
              />
              {spec.unit && <span className="muted tiny">{spec.unit}</span>}
            </div>
          )}
          {newVal && spec.current && (
            <div className="tiny" style={{ marginTop: 8, color: "var(--ink-3)" }}>
              当前 <span className="mono">{spec.current}</span> → 新 <span className="mono" style={{ color: "var(--brand)" }}>{newVal}{spec.unit ? ` ${spec.unit}` : ""}</span>
            </div>
          )}
        </div>
      )}
      <div className="field">
        <label>操作理由(必填 · 8 字以上 · 写入 A2 不可改审计)</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例: 工单号 / 业务依据 / 影响面 / 回滚预案" />
        {!reasonOk && (
          <div className="tiny" style={{ marginTop: 7, color: "var(--warning)" }}>
            还需补充 {Math.max(0, reasonMin - reason.trim().length)} 字,确认按钮才会启用。
          </div>
        )}
        {businessMissing.length > 0 && (
          <div className="tiny" style={{ marginTop: 7, color: "var(--warning)" }}>
            业务表单还缺: {businessMissing.slice(0, 4).join(" / ")}{businessMissing.length > 4 ? "…" : ""}。
          </div>
        )}
      </div>
    </Modal>
  );
}

/* toast — 自包含顶部居中浮层(对应设计稿 ctx.setToast);hover 暂停自动消失,移开 2s 后再消失。 */
export function useToast(): [ReactNode, (s: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!toast) return;
    timerRef.current = setTimeout(() => setToast(null), 2800);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [toast]);
  const node = toast ? (
    <div
      onMouseEnter={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
      onMouseLeave={() => { if (timerRef.current) clearTimeout(timerRef.current); timerRef.current = setTimeout(() => setToast(null), 2000); }}
      style={{ position: "fixed", top: "calc(var(--admin-topbar-h) + 32px)", left: "50%", transform: "translateX(-50%)", zIndex: 200, width: "min(420px, calc(100vw - 40px))", justifyContent: "center", background: "var(--v5-surface-2)", color: "var(--v5-ink)", padding: "12px 20px", borderRadius: 11, fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 9, boxShadow: "0 12px 36px rgba(0,0,0,.4)", border: "1px solid var(--v5-border-strong)" }}>
      <Icon name="check" size={16} /> {toast}
    </div>
  ) : null;
  return [node, setToast];
}

/* 跨域跳转 hook(对应设计稿 ctx.setActive(domainLetter)) */
export function useDomainNav() {
  const router = useRouter();
  return (domainLetter: string) => router.push(DOMAIN_HOME[domainLetter] ?? "/");
}
