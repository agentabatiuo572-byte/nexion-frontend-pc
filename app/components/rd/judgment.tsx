/**
 * JudgmentPoints 判断要点（CP-84）。详情抽屉开头 3～5 行，回答「这一条要不要处理、怎么处理」。
 *
 * <JudgmentPoints rows={[
 *   { label: "金额", value: "12,480.00 USDT" },
 *   { label: "对象", icon: User, tone: "users", value: "何子墨 U00048213" },
 *   { label: "风险", icon: Shield, tone: "risk", state: "warn", value: "高优先，风险分 78", reason: "命中大额提现" },
 *   { label: "覆盖率", value: "读取失败", state: "danger" },
 * ]} />
 *
 * - 内容只用现有字段和现有规则算出的结果，不写「建议放行」这种现在没有的判断（DP-11）。
 * - 风险和阻断原因放这里，不能收（DP-03）。某一行读不到写「读取失败」，不写正常。
 * - loading 时显示占位，页面同时把决定按钮禁用。
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { DomainTone, StateTone } from "./tone";

export interface JudgmentRow {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  tone?: DomainTone;
  state?: StateTone;
  reason?: ReactNode;
}

export function JudgmentPoints({ rows, loading = false, title = "判断要点" }: { rows: readonly JudgmentRow[]; loading?: boolean; title?: string }) {
  return (
    <section className="rd-points" aria-busy={loading || undefined}>
      <h3 className="rd-points-title">{title}</h3>
      {loading
        ? Array.from({ length: 4 }, (_, index) => <span key={index} className="rd-skeleton" style={{ margin: "9px 0" }} />)
        : rows.map(({ label, value, icon: Icon, tone, state, reason }, index) => (
            <div key={index} className="rd-point" data-tone={state ?? tone} data-state-tone={state ? "" : undefined}>
              <span className="rd-point-label" data-tone={tone}>{Icon && <Icon size={13} strokeWidth={1.9} aria-hidden />}{label}</span>
              <span className="rd-point-value">{value}{reason && <span className="rd-point-reason">{reason}</span>}</span>
            </div>
          ))}
    </section>
  );
}
