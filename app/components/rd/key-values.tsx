/**
 * KeyValues 键值列表（CP-41）。名称在左、值在右，字段名弱、值强（VS-54）。
 *
 * <KeyValues rows={[{ key: "usdt", label: "USDT 储备", explain: "基础可动用储备", value: "1,912,640.35 USDT", mono: true }]} />
 *
 * 长值换行，不截断。值的状态由页面传 StatusTag。名称的解释传 explain，收进名称旁的提示图标（DP-06）；
 * sub 只放数据（编号、日期），显示在名称下面。
 */
import type { ReactNode } from "react";
import { Explain } from "./explain";

export interface KeyValueRow {
  key: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  explain?: ReactNode;
  mono?: boolean;
}

export function KeyValues({ rows }: { rows: readonly KeyValueRow[] }) {
  return (
    <dl className="rd-kv">
      {rows.map((row) => (
        <div key={row.key} className="rd-kv-row">
          <dt>{row.label}{row.explain && <Explain label={`${typeof row.label === "string" ? row.label : "这一项"}的说明`} content={row.explain} />}{row.sub && <small>{row.sub}</small>}</dt>
          <dd data-mono={row.mono ? "" : undefined}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
