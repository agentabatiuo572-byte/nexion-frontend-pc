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
 *
 * 弹窗标题下的后果标签（VS-106）：生效方式用 <StatusTag tone="progress" filled>立即生效</StatusTag>，
 * 走审批用 <ApprovalTag scope="这单" />，真的收不回来的操作再加 <IrreversibleTag />。只有这几种，不拿它写别的提醒。
 * 在弹窗标题下（EffectSlot 里）生效方式换成闪电和时钟：虚线圈读作「处理中」，这里说的是什么时候生效。
 */
import { createContext, useContext, type ReactNode } from "react";
import { Ban, CalendarClock, CheckCircle2, CircleDashed, CircleDot, Clock3, XCircle, Zap, type LucideIcon } from "lucide-react";
import { Explain } from "./explain";
import type { StateTone } from "./tone";

const DEFAULT_ICON: Record<StateTone, LucideIcon> = { ok: CheckCircle2, warn: Clock3, danger: XCircle, progress: CircleDashed, done: CircleDot, neutral: Clock3 };

const InEffectSlot = createContext(false);

/** 弹窗标题下那一行。overlay 的 Modal 用它包 sub，页面不用管。 */
export function EffectSlot({ children }: { children: ReactNode }) {
  return <InEffectSlot.Provider value>{children}</InEffectSlot.Provider>;
}

export function StatusTag({ tone, icon, filled, explain, children }: { tone: StateTone; icon?: LucideIcon; filled?: boolean; explain?: ReactNode; children: ReactNode }) {
  const effect = useContext(InEffectSlot) && tone === "progress";
  const Icon = icon ?? (effect ? (typeof children === "string" && children.startsWith("立即") ? Zap : CalendarClock) : DEFAULT_ICON[tone]);
  const tag = (
    <span className="rd-tag" data-tone={tone} data-filled={filled ? "" : undefined}>
      <Icon size={14} strokeWidth={1.9} aria-hidden />
      {children}
    </span>
  );
  return explain ? <Explain label={`${typeof children === "string" ? children : "状态"}是什么意思`} content={explain}>{tag}</Explain> : tag;
}

/** 不能撤销：只给提交后收不回来的操作（退款、拒绝、强制扣款），和生效方式并排在弹窗标题下面。 */
export function IrreversibleTag({ children = "不能撤销" }: { children?: ReactNode }) {
  return <StatusTag tone="danger" filled icon={Ban}>{children}</StatusTag>;
}

/** 走审批的生效标签。谁来批、批准前什么不变每个框都一样，进提示图标，不占事实行（VS-105）。 */
export function ApprovalTag({ scope }: { scope: string }) {
  return <StatusTag tone="progress" filled explain={`超级管理员批准后才生效，超管发起的由另一位超管批准。批准前${scope}不变。`}>批准后生效</StatusTag>;
}
