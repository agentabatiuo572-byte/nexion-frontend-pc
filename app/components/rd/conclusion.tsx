/**
 * Conclusion 一句话结论（CP-90）。看板和报表最上面，先说现状再给数字，通常就是这屏的视觉焦点。
 * 写法看 TX-38：「{对象}：{状态词}，{一个关键数字}」，不超过 30 字。这句话里的数字下面不再重复。
 *
 * <Conclusion state="ok" icon={ShieldCheck} lead hint="建议：正常运营，无需处理。" action={<Button …>刷新</Button>}>
 *   资金安全：正常，可覆盖 <b>267</b> 天
 * </Conclusion>
 * <Conclusion state="danger" strong>资金安全：危险，只够覆盖 <b>4</b> 天</Conclusion>   strong 只给资金告警这类必须最醒目的
 * <Conclusion state="unknown">资金状态：暂时无法判断</Conclusion>
 * <Conclusion state="neutral" icon={ListChecks}>有 3 件事要处理</Conclusion>   有日常待办但没有异常，不上色
 *
 * - 组件不算结论。状态来自现有阈值和比较方式，页面传进来，不新增算法。
 * - 正常时安静，只有 warn、danger 才上色底（DP-05）。danger 走 role=alert。
 * - state="unknown" 用于读取中、读取失败、没有数据：不下结论，绝不写「正常」（T09、DP-65）。
 *   部分来源失败时只说能确定的，并写缺了哪块。
 */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleHelp, ShieldAlert, type LucideIcon } from "lucide-react";
import { IconTile } from "./icon-tile";
import type { StateTone } from "./tone";

const STATE: Record<"ok" | "neutral" | "warn" | "danger" | "unknown", { tone: StateTone | "role-other"; icon: LucideIcon }> = {
  ok: { tone: "ok", icon: CheckCircle2 },
  neutral: { tone: "role-other", icon: CheckCircle2 },
  warn: { tone: "warn", icon: AlertTriangle },
  danger: { tone: "danger", icon: ShieldAlert },
  unknown: { tone: "done", icon: CircleHelp },
};

export function Conclusion({ state, icon, lead, strong, hint, action, children }: { state: keyof typeof STATE; icon?: LucideIcon; lead?: boolean; strong?: boolean; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  const { tone, icon: fallback } = STATE[state];
  return (
    <div className="rd-conclusion" role={state === "danger" ? "alert" : "status"} data-tone={tone} data-lead={lead ? "" : undefined} data-alarm={state === "warn" || state === "danger" ? "" : undefined} data-strong={strong && state === "danger" ? "" : undefined}>
      <IconTile tone={tone} icon={icon ?? fallback} size={36} />
      <div className="rd-conclusion-text">
        {children}
        {hint && <div className="rd-conclusion-hint">{hint}</div>}
      </div>
      {action && <div className="rd-conclusion-action">{action}</div>}
    </div>
  );
}
