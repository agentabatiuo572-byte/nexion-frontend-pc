"use client";

/**
 * 设计稿内容层共享原语(从设计稿 admin-shell.jsx 移植为 TSX)。
 * 配合 .dkpage 作用域 CSS(globals.css)复刻设计稿内容页富布局。
 * 适配:Modal/Drawer 补 ESC+聚焦+点遮罩关闭(a11y 铁律);MakerCheckerModal 接 useIsSuperadmin(总管理员免双签);
 * 跨域跳转用 next/navigation。导航/外壳仍沿用本项目 shell。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useIsSuperadmin } from "@/lib/store/use-admin-role";
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

/* 配置型调整的目标新值编辑规格(可选;不传则按动作文案自动推断) */
export type EditSpec = { kind?: "number" | "text" | "select" | "toggle"; current?: string; unit?: string; options?: string[] };

/* Maker-Checker 复核弹窗 — 角色感知 + 可编辑「目标新值」(配置型调整);纯动作(放行/退款/封禁/pause)仅确认。 */
export function MakerCheckerModal({ action, detail, amplifies, edit, onClose, onConfirm }: { action: ReactNode; detail: ReactNode; amplifies?: boolean; edit?: EditSpec; onClose: () => void; onConfirm: (reason: string, newValue?: string) => void }) {
  const [reason, setReason] = useState("");
  const [newVal, setNewVal] = useState("");
  const isSuper = useIsSuperadmin();
  const actionText = typeof action === "string" ? action : "";
  // 配置型调整:显式 edit,或动作文案含"调整/调价/阈值/参数/费率/权重/门槛/上限/倍率/比例"→ 提供目标新值编辑控件
  const isAdjust = /调整|调价|阈值|参数|配置|费率|权重|规则|门槛|上限|cap|比例|倍率|供给/i.test(actionText);
  const spec: EditSpec | null = edit ?? (isAdjust ? {} : null);
  const kind = spec ? (spec.kind ?? (/维护|启停|开关|通道|市场|启用|停用|pause|kill/i.test(actionText) ? "select" : "text")) : "text";
  const opts = spec?.options ?? (kind === "select" || kind === "toggle" ? ["开启", "关闭"] : []);
  const canConfirm = (isSuper || reason.trim().length > 0) && (!spec || newVal.trim().length > 0);
  return (
    <Modal title="Maker-Checker 双人复核" icon="shield" onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" disabled={!canConfirm} onClick={() => onConfirm(reason, newVal || undefined)}>
          <Icon name="check" size={15} /> {isSuper ? "应用(免双签)" : "复核放行"}
        </Btn>
      </>}>
      <div className="tint brand" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--ink)" }}><AutoGloss>{action}</AutoGloss></div>
        <div className="muted tiny"><AutoGloss>{detail}</AutoGloss></div>
      </div>
      {amplifies && (
        <div className="alertbar danger" style={{ marginBottom: 16 }}>
          <span className="ico"><Icon name="alert" size={16} /></span>
          <div className="tiny">
            <b>放大资金流出动作</b> · 须先核验 B1 兑付覆盖率约束。当前覆盖率
            <b className="mono"> {TREASURY.coverageRatio}%</b>
            {TREASURY.coverageRatio >= TREASURY.yellowLine
              ? ` > 健康线 ${TREASURY.yellowLine}% ✓`
              : TREASURY.coverageRatio >= TREASURY.redLine
                ? ` · 高于红线 ${TREASURY.redLine}% 但低于健康线 ${TREASURY.yellowLine}%,审慎放行`
                : ` < 红线 ${TREASURY.redLine}% ✗ 应冻结放大流出`}
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <span className="mc"><Icon name="check" size={12} /> Maker 已提交</span>
        <Icon name="arrow" size={14} />
        <span className="mc" style={{ background: isSuper ? "var(--brand-soft)" : "var(--surface-3)", color: isSuper ? "var(--brand)" : "var(--ink-3)" }}>
          {isSuper ? "总管理员 · 全权限 · 免双签" : "Checker:需第二人复核"}
        </span>
      </div>
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
        <label>复核原因 / 备注(写入 A2 append-only 审计)</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isSuper ? "可选(总管理员免双签,留痕用)" : "必填,留痕"} />
      </div>
    </Modal>
  );
}

/* toast — 自包含浮层(对应设计稿 ctx.setToast) */
export function useToast(): [ReactNode, (s: string) => void] {
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(t);
  }, [toast]);
  const node = toast ? (
    <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", zIndex: 200, background: "var(--v5-surface-2)", color: "var(--v5-ink)", padding: "12px 20px", borderRadius: 11, fontSize: 13.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 9, boxShadow: "0 12px 36px rgba(0,0,0,.4)", border: "1px solid var(--v5-border-strong)" }}>
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
