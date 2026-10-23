/** Source regression guard; the opened system popup still needs browser acceptance. */
export function hasNativeSelectTheme(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const popup = css.match(/select\s+option\s*,\s*select\s+optgroup\s*\{([^}]+)\}/)?.[1] ?? "";
  // A selector list and :is(select, ...) both apply the rule to native selects.
  return /(?:^|\})\s*select(?:\s*,[^{}]+)?\s*\{[^}]*color-scheme:\s*light\s*;/.test(css)
    && /html\[data-theme="dark"\]\s+(?:select|:is\(select(?:\s*,[^()]*)?\))\s*\{[^}]*color-scheme:\s*dark\s*;/.test(css)
    && /background-color:\s*var\(--v5-surface\)/.test(popup)
    && /(?:^|;)\s*color:\s*var\(--v5-ink\)/.test(popup);
}
