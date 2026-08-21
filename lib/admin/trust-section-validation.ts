export type TrustSectionFieldInput = { key: string; label?: string; value: string };

const LOCALIZED_FIELD = /^(.+?)[._-](zh|vi|en)$/i;

export function isOptionalTrustLinkField(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized.endsWith("url") || normalized.endsWith("href");
}

export function validateTrustSectionTrilingualFields(fields: TrustSectionFieldInput[]): {
  valid: boolean;
  missing: string[];
} {
  const languagesByFamily = new Map<string, Set<string>>();
  for (const field of fields) {
    const match = field.key.trim().match(LOCALIZED_FIELD);
    if (!match) continue;
    const family = match[1].toLowerCase();
    const languages = languagesByFamily.get(family) ?? new Set<string>();
    if (field.value.trim()) languages.add(match[2].toLowerCase());
    languagesByFamily.set(family, languages);
  }
  const missing = Array.from(languagesByFamily.entries())
    .filter(([, languages]) => !languages.has("zh") || !languages.has("vi") || !languages.has("en"))
    .map(([family]) => family);
  if (languagesByFamily.size === 0) missing.push("至少一组 .zh/.vi/.en 字段");
  return { valid: missing.length === 0, missing };
}
