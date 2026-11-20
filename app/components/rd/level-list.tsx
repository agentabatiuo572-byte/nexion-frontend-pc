/**
 * LevelList 等级表。一列固定的等级，当前等级用状态色加图标，其余弱文字（VS 2.1）。
 *
 * <LevelList label="资金安全等级" rows={[{ key: "NORMAL", label: "正常", note: "30 天及以上", tone: "ok", current: true }]} />
 */
import type { ReactNode } from "react";
import { CircleDot } from "lucide-react";
import type { StateTone } from "./tone";

export function LevelList({ label, rows }: { label: string; rows: readonly { key: string; label: ReactNode; note: ReactNode; tone: StateTone; current?: boolean }[] }) {
  return (
    <ol className="rd-levels" aria-label={label}>
      {rows.map((row) => (
        <li key={row.key} data-tone={row.current ? row.tone : undefined} data-current={row.current ? "" : undefined} aria-current={row.current ? "true" : undefined}>
          <span className="rd-level-mark">{row.current && <CircleDot size={15} strokeWidth={1.9} aria-hidden />}</span>
          <span className="rd-level-label">{row.label}{row.current && <span className="rd-level-now">当前等级</span>}</span>
          <span className="rd-level-note">{row.note}</span>
        </li>
      ))}
    </ol>
  );
}
