/**
 * 差异对比（CP-48、OP-49）：提交前让人看清改了什么。前后值是确认框的关键信息（VS-103）：
 * 现在值弱一档，改后的值用进行中蓝（还没生效），方向和后果用状态色，不靠颜色单独传意思。
 *
 * DiffList 多项修改。只列改了的项，其余收进一个折叠；某一项改了有风险，写在这一行下面（note），不另铺横幅。
 * 只有一行时写成一句「现在 → 改后」，没改就只写现在值。
 *
 * <DiffList rows={[
 *   { key: "window", label: "默认预测天数", before: "7 天", after: "30 天" },
 *   { key: "usdt", label: "储备 · USDT 储备", before: "计入", after: "不计入", tone: "danger", note: "资金安全等级会按储备 0 算。" },
 *   { key: "far", label: "计入远期应付款", before: "不计入", after: "不计入" },
 * ]} />
 *
 * DiffField 单项修改。现在值、新值输入、方向合成一块，不画表。没改时什么都不多写，确认按钮禁用就够。
 * 范围只写在 hint 一处；这是什么、什么时候生效进标题旁的提示图标；改了会怎样写 note，随输入变化。
 *
 * <DiffField before="3" unit="个" hint="1–10 的整数" state={<StatusTag tone="warn" icon={LockOpen}>放宽</StatusTag>} error={problem}>
 *   {(control) => <NumberInput {...control} unit="个" min={1} max={10} value={value} onChange={…} />}
 * </DiffField>
 *
 * - size="key"（默认）给数字：现在值和输入框都用弹窗关键数字那一档，单位小一档。size="body" 给选项和短词。
 * - stack 给长文字：现在值和输入上下排，不放大。
 * - 填错时 error 顶替 hint，所以 error 要把范围写全（「要填 1–10 的整数」），不要两行说同一件事。
 */
import { useId, type ReactNode } from "react";
import { AlertTriangle, ArrowRight, ShieldAlert } from "lucide-react";
import { Explain } from "./explain";
import type { FieldControlProps } from "./field";
import { Fold } from "./fold";

export interface DiffRow {
  key: string;
  /** 只有一行时不显示：框的标题已经写明是哪一项，写成一句「现在 → 改后」。 */
  label?: ReactNode;
  before: string;
  after: string;
  /** 这一项改了会怎样。只写风险和后果，跟在这一行下面。 */
  note?: ReactNode;
  /** note 的语气：要注意传 warn（默认），真危险才传 danger。 */
  tone?: "warn" | "danger";
}

export function DiffList({ rows, emptyNote, restTitle = "其余设置" }: { rows: readonly DiffRow[]; emptyNote?: ReactNode; restTitle?: ReactNode }) {
  if (rows.length === 1) {
    const [{ before, after }] = rows;
    return (
      <p className="rd-diff-one">
        <span>现在</span> <b>{before}</b>
        {before !== after && <> <ArrowRight className="rd-diff-arrow" size={14} aria-hidden /><span className="rd-sr-only">改为</span> <span>改后</span> <b data-after="">{after}</b></>}
      </p>
    );
  }
  const changed = rows.filter((row) => row.before !== row.after);
  const same = rows.filter((row) => row.before === row.after);
  return (
    <div className="rd-diff">
      {changed.length === 0 && <p className="rd-diff-empty">{emptyNote ?? "没有改动"}</p>}
      {changed.length > 0 && (
        <ul className="rd-diff-rows">
          {changed.map((row) => {
            const NoteIcon = row.tone === "danger" ? ShieldAlert : AlertTriangle;
            return (
              <li key={row.key} className="rd-diff-row">
                <span className="rd-diff-name">{row.label}</span>
                <span className="rd-diff-before">{row.before}</span>
                <span className="rd-diff-arrow"><ArrowRight size={14} aria-hidden /><span className="rd-sr-only">改为</span></span>
                <span className="rd-diff-after">{row.after}</span>
                {row.note && <span className="rd-diff-note" data-tone={row.tone ?? "warn"}><NoteIcon size={14} strokeWidth={1.9} aria-hidden /><span>{row.note}</span></span>}
              </li>
            );
          })}
        </ul>
      )}
      {same.length > 0 && (
        <Fold inset title={restTitle} summary={`${same.length} 项不变`}>
          <dl className="rd-diff-rest">
            {same.map((row) => <div key={row.key}><dt>{row.label}</dt><dd>{row.after}</dd></div>)}
          </dl>
        </Fold>
      )}
    </div>
  );
}

export function DiffField({ before, unit, beforeLabel = "现在", label = "改后", size = "key", stack, hint, explain, state, note, error, children }: {
  /** 现在的值。读不到当前值时不传，只剩新值输入。 */
  before?: ReactNode;
  /** 现在值的单位，小一档跟在数字后面。 */
  unit?: ReactNode;
  beforeLabel?: ReactNode;
  label?: ReactNode;
  size?: "key" | "body";
  stack?: boolean;
  /** 范围、单位这类怎么填，只写这一处。 */
  hint?: ReactNode;
  /** 这是什么、什么时候生效：收进「改后」旁的提示图标（DP-06）。 */
  explain?: ReactNode;
  /** 这次改动的方向：放宽、收紧。传 StatusTag，改了才传。 */
  state?: ReactNode;
  /** 改了会怎样，白话，随输入变化。 */
  note?: ReactNode;
  error?: ReactNode;
  children: ReactNode | ((control: FieldControlProps) => ReactNode);
}) {
  const id = useId();
  const described = [error ? `${id}-error` : hint ? `${id}-hint` : "", note ? `${id}-note` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="rd-change" data-size={size} data-stack={stack ? "" : undefined}>
      {before !== undefined && before !== null && before !== "" && (
        <div className="rd-change-side">
          <span className="rd-change-k">{beforeLabel}</span>
          <span className="rd-change-now"><span>{before}{unit && <span className="rd-change-unit">{unit}</span>}</span><ArrowRight className="rd-change-arrow" size={18} aria-hidden /></span>
        </div>
      )}
      <div className="rd-change-side" data-next="">
        <label className="rd-change-k" data-fill="" htmlFor={id}>{label}{explain && <Explain label={`${typeof label === "string" ? label : "新值"}的说明`} content={explain} />}</label>
        <div className="rd-change-entry">
          {typeof children === "function" ? children({ id, "aria-describedby": described, "aria-invalid": error ? true : undefined }) : children}
          {state}
        </div>
        {error ? <div id={`${id}-error`} className="rd-form-error" role="alert">{error}</div> : hint && <div id={`${id}-hint`} className="rd-change-hint">{hint}</div>}
      </div>
      {note && <div id={`${id}-note`} className="rd-change-note">{note}</div>}
    </div>
  );
}
