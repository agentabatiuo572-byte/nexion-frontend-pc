import type { ReactNode } from "react";

export function ThresholdComparison({ fields, approval }: {
  fields: { label: string; current: number; input: ReactNode }[];
  approval: boolean;
}) {
  return (
    <table className="my-4 w-full table-fixed text-left text-sm text-[var(--ink-2)]">
      <colgroup>
        <col className="w-[32%]" />
        <col className="w-[27%]" />
        <col className="w-[8%]" />
        <col />
      </colgroup>
      <thead className="text-xs">
        <tr className="border-b border-[var(--border)]">
          <th scope="col" className="py-2">指标</th>
          <th scope="col" className="py-2">当前值（生效中）</th>
          <td aria-hidden="true" />
          <th scope="col" className="py-2">{approval ? "拟调整值（审批后生效）" : "拟调整值"}</th>
        </tr>
      </thead>
      <tbody>
        {fields.map(({ label, current, input }) => (
          <tr key={label} className="border-b border-[var(--border)] last:border-0">
            <th scope="row" className="py-2 pr-2 font-medium">{label}</th>
            <td className="py-2 tabular-nums"><span className="inline-block rounded border border-[var(--border)] px-2 py-1">{current}%</span></td>
            <td aria-hidden="true" className="px-1 text-center">→</td>
            <td className="py-2">{input}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
