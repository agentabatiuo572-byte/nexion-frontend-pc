/**
 * KeyValues 键值列表（CP-41）。名称在左、值在右，字段名弱、值强（VS-54）。
 *
 * <KeyValues rows={[{ key: "usdt", label: "USDT 储备", sub: "基础可动用储备", value: "1,912,640.35 USDT", mono: true }]} />
 *
 * 长值换行，不截断。值的状态由页面传 StatusTag。
 */
import type { ReactNode } from "react";

export interface KeyValueRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  mono?: boolean;
}

export function KeyValues({ rows }: { rows: readonly KeyValueRow[] }) {
  return (
    <dl className="rd-kv">
      {rows.map((row) => (
        <div key={row.key} className="rd-kv-row">
          <dt>{row.label}{row.sub && <small>{row.sub}</small>}</dt>
          <dd data-mono={row.mono ? "" : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
