"use client";

/**
 * 域 M 客服中心共享 UI 原语(helpdesk 设计稿 ui.jsx → TSX,挂 .mdom CSS)。
 * 头像无外链(首字母 + token 色,守隐私);状态/优先级运营可读中文 + .stat/.prio 分类。
 * M2/M3/M4/M5/dock 复用。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon, photoUrl, type IconName } from "../design-kit";
import type { SupportTicketStatus, SupportTicketPriority } from "./data";

/* ---- 相对时间(运营可读中文) ---- */
export function relWhen(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
}

/* ---- 头像:首字母 + token 色(无外部图) ---- */
const AV_POOL = ["--m-hd", "--m-wait", "--m-ok", "--m-high", "--m-urgent"];
export function avInitials(name?: string): string {
  if (!name) return "?";
  const s = name.replace(/用户|客户|的/g, "").trim();
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return s.slice(0, 2).toUpperCase() || "?";
}
function avVar(name?: string): string {
  let h = 0;
  const n = name ?? "";
  for (let i = 0; i < n.length; i += 1) h = (h * 31 + n.charCodeAt(i)) >>> 0;
  return AV_POOL[h % AV_POOL.length];
}
export function MAvatar({ name, size, live }: { name?: string; size?: "sm" | "lg"; live?: boolean }) {
  const v = avVar(name);
  return (
    <span className={`av ${size ?? ""} ${live ? "av-live" : ""}`.trim()} style={{ background: `color-mix(in srgb, var(${v}) 22%, transparent)`, color: `var(${v})` }}>
      <span className="av-fb">{avInitials(name)}</span>
      <img className="av-img" src={photoUrl(name)} alt="" loading="lazy" onError={(e) => { e.currentTarget.style.display = "none"; }} />
    </span>
  );
}

/* ---- 工单状态 / 优先级(运营可读中文 + 分类色) ---- */
export const TK_STATUS_CN: Record<SupportTicketStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  pending_user: "待用户补充",
  resolved: "已解决",
  closed: "已关闭",
};
const TK_STATUS_CLS: Record<SupportTicketStatus, string> = {
  open: "open",
  in_progress: "proc",
  pending_user: "wait",
  resolved: "resolved",
  closed: "closed",
};
export function TicketStatus({ status }: { status: SupportTicketStatus }) {
  return (
    <span className={`stat ${TK_STATUS_CLS[status]}`}>
      <span className="dot" />
      {TK_STATUS_CN[status]}
    </span>
  );
}

export const PRIO_CN: Record<SupportTicketPriority, string> = { urgent: "紧急", high: "高", normal: "普通", low: "低" };
export function Prio({ p }: { p: SupportTicketPriority }) {
  return (
    <span className={`prio ${p}`}>
      <span className="bar" />
      {PRIO_CN[p]}
    </span>
  );
}

export function ConvStat({ active }: { active: boolean }) {
  return active ? (
    <span className="stat active">
      <span className="dot" />
      进行中
    </span>
  ) : (
    <span className="stat resolved">
      <span className="dot" />
      已解决
    </span>
  );
}

/* ---- 分类中文 ---- */
const CAT_CN: Record<string, string> = {
  account: "账户",
  withdrawal: "提现",
  deposit: "充值",
  hardware: "硬件",
  earnings: "收益",
  genesis: "节点",
  technical: "技术",
  other: "其他",
  general: "通用",
};
export function catCN(c: string): string {
  return CAT_CN[c] ?? c;
}

/* ---- owner 展示(Unassigned → 待分配,运营可读)---- */
export function ownerLabel(o: string): string {
  return o === "Unassigned" ? "待分配" : o;
}

/* ---- 下拉 caret(chevron 旋转 90° 朝下) ---- */
function Caret({ size = 15 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", transform: "rotate(90deg)", flex: "none" }}>
      <Icon name="chevron" size={size} />
    </span>
  );
}

/* ---- 自定义下拉(贴合暗色主题) ---- */
export type HDOption = { value: string; label: string };
export function HDSelect({
  value,
  onChange,
  options,
  placeholder,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  options: HDOption[];
  placeholder?: string;
  width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  const cur = options.find((o) => o.value === value);
  return (
    <div ref={ref} style={{ position: "relative", width: width ?? "100%" }}>
      <button type="button" className="hd-select" onClick={() => setOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={open}>
        <span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cur ? cur.label : placeholder ?? "请选择"}</span>
        <Caret />
      </button>
      {open && (
        <div className="hd-select-pop" role="listbox">
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`hd-select-opt ${o.value === value ? "on" : ""}`}
              role="option"
              aria-selected={o.value === value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              <span style={{ flex: 1 }}>{o.label}</span>
              {o.value === value && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- 动作下拉菜单 ---- */
export type MenuItem = { label: string; cur?: boolean; tone?: string; icon?: IconName; onClick: () => void };
export function MiniMenu({ label, icon, align, items }: { label: string; icon?: IconName; align?: "left" | "right"; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button type="button" className="btn btn-sec btn-sm" onClick={() => setOpen((v) => !v)}>
        {icon && <Icon name={icon} size={16} />}
        {label}
        <Caret size={14} />
      </button>
      {open && (
        <div className="card" style={{ position: "absolute", top: 34, [align === "right" ? "right" : "left"]: 0, minWidth: 176, zIndex: 30, padding: 5, boxShadow: "var(--m-sh-pop)" }}>
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                width: "100%",
                textAlign: "left",
                padding: "8px 9px",
                borderRadius: 7,
                border: "none",
                background: "transparent",
                color: it.tone ?? "var(--ink-2)",
                fontSize: 13,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--m-hover)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {it.icon && <Icon name={it.icon} size={15} />}
              <span style={{ flex: 1 }}>{it.label}</span>
              {it.cur && <Icon name="check" size={15} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- 空态 ---- */
export function Empty({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon ?? "search"} size={30} />
      <span>{children}</span>
    </div>
  );
}
