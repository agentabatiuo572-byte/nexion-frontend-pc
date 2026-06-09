/**
 * 区段标签(设计稿 SecLabel 模式)— 标题 + PRD 模块码 + 延伸细线。
 * 把首页卡片按业务关切分组,并标注可追溯的 PRD 模块码(B1·B2·B5 等)。
 */
export function SecLabel({ title, modules }: { title: string; modules?: string }) {
  return (
    <div className="mb-3.5 mt-7 flex items-center gap-3">
      <span className="font-display text-[13.5px]" style={{ color: "var(--v5-ink)" }}>
        {title}
      </span>
      {modules && (
        <span className="font-mono-tabular whitespace-nowrap text-[11px]" style={{ color: "var(--v5-ink-4)" }}>
          {modules}
        </span>
      )}
      <span className="h-px flex-1" style={{ background: "var(--v5-border)" }} aria-hidden />
    </div>
  );
}
