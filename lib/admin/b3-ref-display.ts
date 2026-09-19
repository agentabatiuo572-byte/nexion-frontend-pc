/**
 * B3 推荐码 / 渠道筛选选项的展示口径。
 *
 * 后端 `filterOptions.refs` 直接来自 A4 注册事件的 `ref_code`(见 BiReportMapper 的
 * `COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payload,'$.ref')), ..., 'direct')`),事件里
 * ref 为空串或字面量 "null"/"undefined" 时该值会原样进列表,运营看到的就是一个叫
 * "null" 的渠道。这是展示层问题,不改后端契约:把空值归一到明确的业务名。
 *
 * 注意与后端保持一致:`B3FunnelAnalytics.filters()` 里 `blank(ref)` 把 "ALL" 也当空,
 * 且事件侧用 `defaultText(..., "direct")` 兜底。因此这里把 `direct` 也翻成中文,
 * 保证「筛选与导出使用相同口径」——选中项回传的值仍是原始 ref。
 */

const REF_VALUE_LABELS: Record<string, string> = {
  direct: "自然渠道（无推荐码）",
};

/** 空/内部占位值:没有有效推荐码归因。 */
function isBlankRef(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "" || normalized === "null" || normalized === "undefined" || normalized === "nan";
}

/**
 * 把后端下发的 ref 值翻成面向运营的选项文案。
 * 未知值原样保留(可能是真实推荐码),但绝不显示 null/undefined 这类原始占位。
 */
export function formatB3RefOption(value: unknown) {
  if (typeof value !== "string") return "未知渠道";
  if (isBlankRef(value)) return "无推荐码 / 自然渠道";
  return REF_VALUE_LABELS[value.trim().toLowerCase()] ?? value.trim();
}

/**
 * 过滤后端选项:去掉空占位重复项,按展示文案去重并保持后端顺序。
 * 无有效数据时不生成该选项(返回值仍由调用方决定是否渲染)。
 */
export function normalizeB3RefOptions(values: readonly string[]) {
  const seen = new Set<string>();
  const result: Array<{ value: string; label: string }> = [];
  for (const value of values) {
    const label = formatB3RefOption(value);
    if (seen.has(label)) continue;
    seen.add(label);
    result.push({ value, label });
  }
  return result;
}
