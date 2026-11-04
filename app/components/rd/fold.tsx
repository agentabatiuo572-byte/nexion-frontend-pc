"use client";

/**
 * Fold 带结论的折叠组（CP-50）。原生 details，Enter、Space 切换，读屏不打开也听得到摘要。
 *
 * <Fold title="费用明细" summary="手续费 62.40 USDT">…</Fold>
 * <Fold title="风险规则" summary="2 条命中" alert icon={Shield} tone="risk" inset>…</Fold>
 *
 * - summary 必填，写数量和结论；写不出来就别折（DP-04）。
 * - alert 时默认展开，摘要上色。用户手动收起后摘要里的异常仍看得见。
 * - 不能放进来：风险提示、阻断原因、待处理事项、做决定必须看的信息（DP-03），它们放 JudgmentPoints 或页面第一层。
 * - 页内定位进来要展开时传 open 和 onOpenChange。inset 用在抽屉和面板里。
 */
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";
import type { StateTone, Tone } from "./tone";

export function Fold({ title, summary, alert = false, alertTone = "warn", icon: Icon, tone, inset, defaultOpen = false, open, onOpenChange, children }: {
  title: ReactNode;
  summary: ReactNode;
  alert?: boolean;
  alertTone?: StateTone;
  icon?: LucideIcon;
  tone?: Tone;
  inset?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen || alert);
  useEffect(() => { if (alert) setOwnOpen(true); }, [alert]);
  const isOpen = open ?? ownOpen;
  return (
    <details
      className="rd-fold"
      open={isOpen}
      data-inset={inset ? "" : undefined}
      data-alert={alert ? "" : undefined}
      data-tone={alert ? alertTone : undefined}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        if (next === isOpen) return;
        setOwnOpen(next);
        onOpenChange?.(next);
      }}
    >
      <summary>
        <ChevronRight className="rd-fold-chevron" size={14} aria-hidden />
        {Icon && <span data-tone={tone ?? "system"} style={{ display: "inline-flex", color: "var(--tone)" }}><Icon size={15} strokeWidth={1.9} aria-hidden /></span>}
        <span className="rd-fold-title">{title}</span>
        <span className="rd-fold-summary">{summary}</span>
      </summary>
      <div className="rd-fold-body">{children}</div>
    </details>
  );
}
