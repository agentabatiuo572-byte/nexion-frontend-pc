"use client";

/**
 * 设计稿内容层共享原语(从设计稿 admin-shell.jsx 移植为 TSX)。
 * 配合 .dkpage 作用域 CSS(globals.css)复刻设计稿内容页富布局。
 * 适配:Modal/Drawer 补 ESC+聚焦+点遮罩关闭(a11y 铁律);OperationConfirmModal 负责高敏操作确认 + 理由留痕;
 * 跨域跳转用 next/navigation。导航/外壳仍沿用本项目 shell。
 */
import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TREASURY } from "@/lib/mock/admin/design-data";
import { AutoGloss } from "@/app/components/kit/gloss";

/* ---------------- 域 → 落地路由(ctx.navigate 跨域跳转) ---------------- */
export const DOMAIN_HOME: Record<string, string> = {
  A: "/platform/rbac", B: "/", C: "/users/search", D: "/finance/withdrawals",
  E: "/devices/pricing", F: "/network/v-rank", G: "/finance-products/staking",
  H: "/growth/phase", I: "/content/copy-ab", J: "/emergency/kill-switch",
  K: "/risk/multi-account", L: "/analytics/kpi",
};

/* ---------------- Icons(设计稿线性字形,name-based) ---------------- */
type IconName =
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
export function Drawer({ title, sub, onClose, children, footer }: { title: ReactNode; sub?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
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
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className="drawer" style={{ outline: "none" }}>
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

/* 配置型调整的目标新值编辑规格(可选;不传则仅确认动作本身) */
export type EditSpec = { kind?: "number" | "text" | "select" | "toggle"; current?: string; unit?: string; options?: string[] };
export type BusinessFormValue = Record<string, string>;
type RoleOption = { key: string; label: string; scope?: string };
type PermissionRole = { key: string; label: string; current: string };
export type BusinessFormSpec =
  | { kind: "role-select"; currentRole: string; currentTier?: "lead" | "member" | string; roles: RoleOption[]; guardHint?: string }
  | { kind: "permission-matrix"; roles: PermissionRole[]; actionLabel?: string; guardHint?: string; grantOptions?: string[] }
  | { kind: "localized-copy"; keyName?: string; zh?: string; en?: string; placeholders?: string[] }
  | { kind: "copy-edit"; keyName?: string; version?: string; surface?: string; zh?: string; en?: string; placeholders?: string[]; audiences?: string[]; trafficSplits?: string[]; versionNote?: string }
  | { kind: "course-authoring"; rewardMin?: number; rewardMax?: number; categories?: string[]; durations?: string[]; publishStates?: string[] }
  | { kind: "campaign-edit"; tiers?: string[]; audiences?: string[]; title?: string; body?: string; defaultTier?: string; defaultAudience?: string; budget?: string }
  | { kind: "version-authoring"; version?: string; jurisdiction?: string; zh?: string; en?: string; chapters?: string[]; languageScopes?: string[]; effectiveDate?: string; requiresReack?: boolean }
  | { kind: "destructive-reason"; target: string; impact: string; requireAck?: boolean; rollbackRequired?: boolean };

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
  const brief = buildOperatorBrief(action, detail, !!amplifies, !!hasEdit);
  const detailText = compactText(plainText(detail));
  return (
    <div className="tint brand" style={{ marginBottom: 16, border: 0 }}>
      <div style={{ fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>执行摘要</div>
      <div style={{ display: "grid", gap: 8 }}>
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
  );
}

const DEFAULT_GRANTS = ["-", "R", "M", "C"];
const DEFAULT_COURSE_CATEGORIES = ["Basics", "Earn", "Team", "Wealth", "Security"];
const DEFAULT_COURSE_DURATIONS = ["5 min", "8 min", "12 min", "15 min"];
const DEFAULT_COURSE_PUBLISH_STATES = ["draft", "ready", "published"];
const DEFAULT_COPY_AUDIENCES = ["全量", "P3 · 全语言", "zh · 注册>30天", "注册 ≤14 天", "P2-P3"];
const DEFAULT_COPY_TRAFFIC_SPLITS = ["50", "34", "25", "10"];
const DEFAULT_CAMPAIGN_TIERS = ["critical", "high", "normal", "low"];
const DEFAULT_CAMPAIGN_AUDIENCES = ["全量", "SFC 辖区 · 未重确认用户", "近 30 天提现 >$1k", "注册 ≤14 天", "P3 阶段活跃用户"];
const DEFAULT_LANGUAGE_SCOPES = ["en+zh", "zh", "en"];

function initBusinessForm(spec?: BusinessFormSpec): BusinessFormValue {
  if (!spec) return {};
  if (spec.kind === "role-select") {
    return { role: spec.currentRole, tier: spec.currentTier === "lead" ? "lead" : "member" };
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
      audience: spec.audiences?.[0] ?? DEFAULT_COPY_AUDIENCES[0],
      trafficSplit: spec.trafficSplits?.[0] ?? DEFAULT_COPY_TRAFFIC_SPLITS[0],
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
    };
  }
  if (spec.kind === "campaign-edit") {
    return {
      title: spec.title ?? "",
      body: spec.body ?? "",
      tier: spec.defaultTier ?? spec.tiers?.[0] ?? "normal",
      audience: spec.defaultAudience ?? spec.audiences?.[0] ?? "全量",
      schedule: "保存为草稿",
      budget: spec.budget ?? "0",
    };
  }
  if (spec.kind === "version-authoring") {
    return {
      version: spec.version ?? "vNext",
      jurisdiction: spec.jurisdiction ?? "SFC",
      languageScope: spec.languageScopes?.[0] ?? DEFAULT_LANGUAGE_SCOPES[0],
      effectiveDate: spec.effectiveDate ?? "2026-06-30",
      requiresReack: spec.requiresReack === false ? "false" : "true",
      zh: spec.zh ?? "",
      en: spec.en ?? "",
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
    needs("tier", "层级");
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
  } else if (spec.kind === "campaign-edit") {
    ["title", "body", "tier", "audience", "schedule", "budget"].forEach((key) => needs(key, key));
    if (!Number.isFinite(Number(state.budget)) || Number(state.budget) < 0) missing.push("预算数值");
  } else if (spec.kind === "version-authoring") {
    ["version", "jurisdiction", "languageScope", "effectiveDate", "requiresReack", "zh", "en"].forEach((key) => needs(key, key));
  } else if (spec.kind === "destructive-reason") {
    if ((spec.requireAck ?? true) && state.ack !== "true") missing.push("影响确认");
    if (spec.rollbackRequired) needs("rollback", "回滚方案");
  }
  return missing;
}

function businessNewValue(spec: BusinessFormSpec | undefined, state: BusinessFormValue): string | undefined {
  if (!spec) return undefined;
  if (spec.kind === "role-select") return `${state.role}${state.tier === "lead" ? "/lead" : ""}`;
  if (spec.kind === "permission-matrix") return spec.roles.map((r) => state[`grant.${r.key}`]).join("/");
  if (spec.kind === "copy-edit") return state.version;
  if (spec.kind === "version-authoring") return state.version;
  if (spec.kind === "course-authoring") return state.slug;
  if (spec.kind === "campaign-edit") return state.title;
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
  const select = (key: string, label: string, options: string[], proof?: string) => (
    <label className="field" style={{ marginBottom: 0 }}>
      <span>{label}</span>
      <select className="fld" data-proof={proof} value={value[key] ?? options[0] ?? ""} onChange={(e) => set(key, e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  if (spec.kind === "role-select") {
    return (
      <div className="field" data-business-form="role-select">
        <label>业务表单 · 改角色</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {select("role", "目标角色 role", spec.roles.map((r) => r.key), "role-select-target")}
          {select("tier", "层级 tier", ["member", "lead"], "role-select-tier")}
        </div>
        <div className="row wrap" style={{ gap: 8, marginTop: 10 }}>
          {spec.roles.map((r) => (
            <button key={r.key} className={"chip" + (value.role === r.key ? " sel" : "")} onClick={() => set("role", r.key)} type="button">
              {r.label}<span className="muted tiny"> · {r.key}</span>
            </button>
          ))}
        </div>
        <div className="tint tiny" style={{ marginTop: 10 }}>
          当前 <span className="mono">{spec.currentRole}{spec.currentTier === "lead" ? "/lead" : "/member"}</span> → 目标 <span className="mono">{businessNewValue(spec, value)}</span>
          {spec.guardHint ? <> · {spec.guardHint}</> : null}
        </div>
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
            {select("audience", "受众 audience", spec.audiences ?? DEFAULT_COPY_AUDIENCES)}
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
          {select("audience", "受众 audience", spec.audiences ?? DEFAULT_CAMPAIGN_AUDIENCES)}
          {select("schedule", "排期 schedule", ["保存为草稿", "排期下发", "立即下发"])}
          {input("budget", "预算 budget(USD)", "0", "number")}
        </div>
        <div style={{ marginTop: 10 }}>
          {textArea("body", "通知正文 body", "填写通知正文与跳转口径", 4)}
        </div>
      </div>
    );
  }

  if (spec.kind === "version-authoring") {
    return (
      <div className="field" data-business-form="version-authoring">
        <label>业务表单 · 新版本草拟 / 发布</label>
        <div className="grid g-2" style={{ gap: 10 }}>
          {input("version", "版本号 version", "v13")}
          {input("jurisdiction", "法域 jurisdiction", "SFC")}
          {select("languageScope", "语言范围 language scope", spec.languageScopes ?? DEFAULT_LANGUAGE_SCOPES)}
          {input("effectiveDate", "生效日 effective date", "2026-06-30", "date")}
          {select("requiresReack", "是否要求 re-ack", ["true", "false"])}
        </div>
        <div className="grid g-2" style={{ gap: 10, marginTop: 10 }}>
          {textArea("zh", "中文版本正文", "填写中文条款/披露正文", 4)}
          {textArea("en", "English version body", "Fill English disclosure body", 4)}
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
      <label className="field" style={{ marginBottom: 0 }}>
        <span>回滚方案 / 替代方案</span>
        <textarea
          data-proof="destructive-rollback"
          rows={2}
          value={value.rollback ?? ""}
          onChange={(e) => set("rollback", e.target.value)}
          placeholder="例: 如误删,从最近商品快照恢复;通知前台撤下入口"
        />
      </label>
      <label className="row" style={{ gap: 8, marginTop: 10, color: "var(--ink-2)", fontSize: 12.5 }}>
        <input data-proof="destructive-ack" type="checkbox" checked={value.ack === "true"} onChange={(e) => set("ack", e.target.checked ? "true" : "false")} />
        我已确认影响范围、审计留痕和回滚方案
      </label>
    </div>
  );
}

/* 操作确认弹窗 — 高敏动作确认 + 理由必填 + 可编辑「目标新值」(配置型调整);纯动作(放行/退款/封禁/pause)仅确认。 */
export function OperationConfirmModal({ action, detail, amplifies, edit, businessForm, onClose, onConfirm }: { action: ReactNode; detail: ReactNode; amplifies?: boolean; edit?: EditSpec; businessForm?: BusinessFormSpec; onClose: () => void; onConfirm: (reason: string, newValue?: string, businessValue?: BusinessFormValue) => void }) {
  const [reason, setReason] = useState("");
  const [newVal, setNewVal] = useState("");
  const [businessValue, setBusinessValue] = useState<BusinessFormValue>(() => initBusinessForm(businessForm));
  // 配置型调整:仅当调用方显式传 edit 才提供「目标新值」编辑控件并要求 newVal;纯动作 / 处置(放行 / 冻结 / 驳回 / pause)不传 edit → 仅确认。
  // 去除按动作名猜测的启发式正则(原 isAdjust/select 正则):既防 dispose 名含「调整 / 规则 / 启停…」误弹字段,也防 adjust 名不含触发词漏判;改为 by edit 显式契约。全域调用点已逐一显式传 edit(2026-06 跨域硬化)。
  const spec: EditSpec | null = edit ?? null;
  const kind = spec?.kind ?? "text";
  const opts = spec?.options ?? (kind === "select" || kind === "toggle" ? ["开启", "关闭"] : []);
  // B1 红线禁放行(§15.1 recoverGate):放大流出动作在覆盖率 < 红线时禁止确认放行(server 422 的前端镜像)。
  const covBlocked = !!amplifies && TREASURY.coverageRatio < TREASURY.redLine;
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
            <b>会增加资金流出</b> · 系统会先检查 B1 备付金覆盖率。当前覆盖率
            <b className="mono"> {TREASURY.coverageRatio}%</b>
            {TREASURY.coverageRatio >= TREASURY.yellowLine
              ? ` > 健康线 ${TREASURY.yellowLine}% ✓`
              : TREASURY.coverageRatio >= TREASURY.redLine
                ? ` · 高于红线 ${TREASURY.redLine}%,但低于健康线 ${TREASURY.yellowLine}%,请审慎提交`
                : ` < 红线 ${TREASURY.redLine}% ✗ 系统会拒绝提交`}
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

/* toast — 自包含顶部居中浮层(对应设计稿 ctx.setToast) */
export function useToast(): [ReactNode, (s: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div style={{ position: "fixed", top: "calc(var(--admin-topbar-h) + 32px)", left: "50%", transform: "translateX(-50%)", zIndex: 200, width: "min(420px, calc(100vw - 40px))", justifyContent: "center", background: "var(--v5-surface-2)", color: "var(--v5-ink)", padding: "12px 20px", borderRadius: 11, fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 9, boxShadow: "0 12px 36px rgba(0,0,0,.4)", border: "1px solid var(--v5-border-strong)" }}>
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
