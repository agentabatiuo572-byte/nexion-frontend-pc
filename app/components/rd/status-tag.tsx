/**
 * StatusTag 状态标签（CP-38）。图标加彩色文字，文字本身就是状态，不靠颜色传意思（DP-22）。
 * 文字由页面或 lib 给，组件不翻译。已结束用 done（灰），不用 ok。
 *
 * <StatusTag tone="warn">待审核</StatusTag>
 * <StatusTag tone="danger" explain="打款失败，等人工退款或重试。">打款失败</StatusTag>
 * <StatusTag tone="progress" filled>处理中</StatusTag>  带底只用在横幅和详情的状态组，表格里不带底（VS-21）
 * <StatusTag tone="neutral">待审核</StatusTag>  列表被筛成只有一种状态时，这个默认状态用 neutral：灰字加图标，颜色留给例外行。
 *
 * 表格里第二行说明用 Cell：<Cell main={<StatusTag …/>} sub="需人工审核" />。
 */
import type { ReactNode } from "react";
import { CheckCircle2, CircleDashed, CircleDot, Clock3, XCircle, type LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import type { StateTone } from "./tone";

const DEFAULT_ICON: Record<StateTone, LucideIcon> = { ok: CheckCircle2, warn: Clock3, danger: XCircle, progress: CircleDashed, done: CircleDot, neutral: Clock3 };

export function StatusTag({ tone, icon, filled, explain, children }: { tone: StateTone; icon?: LucideIcon; filled?: boolean; explain?: ReactNode; children: ReactNode }) {
  const Icon = icon ?? DEFAULT_ICON[tone];
  const tag = (
    <span className="rd-tag" data-tone={tone} data-filled={filled ? "" : undefined}>
      <Icon size={14} strokeWidth={1.9} aria-hidden />
      {children}
    </span>
  );
  return explain ? <Explain label={`${typeof children === "string" ? children : "状态"}是什么意思`} content={explain}>{tag}</Explain> : tag;
}
