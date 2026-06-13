/**
 * SyncChip — 把 PRD §1.8「服务端权威(server-canonical)」原则可视化为顶栏状态徽标。
 * 脉冲绿点 + 文案,持续提示运营者:所有门禁/资金/状态判定以服务端为准。
 */
export function SyncChip() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
      style={{
        background: "color-mix(in srgb, var(--v5-success) 12%, transparent)",
        color: "var(--v5-ink-2)",
        border: "1px solid color-mix(in srgb, var(--v5-success) 24%, transparent)",
      }}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className="absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping"
          style={{ background: "var(--v5-success)" }}
        />
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--v5-success)" }}
        />
      </span>
      server-canonical · live
    </span>
  );
}
