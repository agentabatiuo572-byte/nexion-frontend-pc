/** Source regression guard; the opened system popup still needs browser acceptance. */
export function hasNativeSelectTheme(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const popup = css.match(/select\s+option\s*,\s*select\s+optgroup\s*\{([^}]+)\}/)?.[1] ?? "";
  return /(?:^|\})\s*select(?:\s*,[^{}]+)?\s*\{[^}]*color-scheme:\s*dark\s*;/.test(css)
    && /background-color:\s*var\(--v5-surface\)/.test(popup)
    && /(?:^|;)\s*color:\s*var\(--v5-ink\)/.test(popup);
}
