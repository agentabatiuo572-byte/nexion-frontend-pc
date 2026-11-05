/**
 * DiffList 差异对比（CP-48、OP-49）。确认框里所有字段都写前后值，改了的排前面并写「已改」，不靠颜色区分。
 * 只有一行时不画表，写一句「现在 7 天 → 改后 30 天」。
 *
 * <DiffList rows={[{ key: "window", label: "默认预测天数", before: "7 天", after: "30 天" }]} />
 */
import type { ReactNode } from "react";

export function DiffList({ rows, emptyNote }: { rows: readonly { key: string; label: ReactNode; before: string; after: string }[]; emptyNote?: ReactNode }) {
  if (rows.length === 1) {
    const [{ before, after }] = rows;
    return <p className="rd-diff-one">现在 <b>{before}</b>{before === after ? <> · {emptyNote ?? "没有改动"}</> : <> → 改后 <b>{after}</b></>}</p>;
  }
  const changed = rows.filter((row) => row.before !== row.after);
  const same = rows.filter((row) => row.before === row.after);
  return (
    <div className="rd-diff">
      <p className="rd-diff-count">{changed.length ? `改动 ${changed.length} 项，其余 ${same.length} 项不变` : emptyNote ?? "没有改动"}</p>
      <table>
        <thead><tr><th scope="col">项目</th><th scope="col">现在</th><th scope="col">改后</th></tr></thead>
        <tbody>
          {[...changed, ...same].map((row) => {
            const isChanged = row.before !== row.after;
            return (
              <tr key={row.key} data-changed={isChanged ? "" : undefined}>
                <th scope="row">{row.label}{isChanged && <span className="rd-diff-tag">已改</span>}</th>
                <td>{row.before}</td>
                <td>{row.after}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
