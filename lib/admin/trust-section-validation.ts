import { blankCopiedContentLanguage, fillBlankContentLanguage } from "@/lib/admin/content-language-rules";
import { OPERATING_LANGUAGE_CODES, type OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

export type TrustSectionFieldInput = { key: string; label?: string; value: string };

const LOCALIZED_FIELD = /^(.+?)[._-](zh|vi|en)$/i;

export function isOptionalTrustLinkField(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  return normalized.endsWith("url") || normalized.endsWith("href");
}

export function localizedTrustSectionField(key: string) {
  const match = key.trim().toLowerCase().match(LOCALIZED_FIELD);
  return match ? { family: match[1], language: match[2] as OperatingLanguageCode } : undefined;
}

export function mapTrustSectionLanguageFields<Field extends TrustSectionFieldInput>(
  fields: Field[], requiredLanguages: readonly OperatingLanguageCode[], mode: "load" | "submit",
): Field[] {
  const groups: Record<OperatingLanguageCode, Record<string, string>> = {
    en: Object.create(null), zh: Object.create(null), vi: Object.create(null),
  };
  for (const field of fields) {
    const localized = localizedTrustSectionField(field.key);
    if (localized) groups[localized.language][localized.family] = field.value;
  }
  const transform = mode === "load" ? blankCopiedContentLanguage : fillBlankContentLanguage;
  for (const language of ["zh", "vi"] as const) {
    if (mode === "load" && Object.keys(groups[language]).length !== Object.keys(groups.en).length) continue;
    groups[language] = transform(requiredLanguages, language, groups.en, groups[language]);
  }
  return fields.map((field) => {
    const localized = localizedTrustSectionField(field.key);
    return localized ? { ...field, value: groups[localized.language][localized.family] ?? field.value } : field;
  });
}

export function validateTrustSectionTrilingualFields(
  fields: TrustSectionFieldInput[], requiredLanguages: readonly OperatingLanguageCode[] = OPERATING_LANGUAGE_CODES,
): {
  valid: boolean;
  missing: string[];
} {
  const languagesByFamily = new Map<string, Set<OperatingLanguageCode>>();
  for (const field of fields) {
    const localized = localizedTrustSectionField(field.key);
    if (!localized) continue;
    const { family, language } = localized;
    const languages = languagesByFamily.get(family) ?? new Set<OperatingLanguageCode>();
    if (field.value.trim()) languages.add(language);
    languagesByFamily.set(family, languages);
  }
  const missing = Array.from(languagesByFamily.entries())
    .filter(([, languages]) => requiredLanguages.some((language) => !languages.has(language)))
    .map(([family]) => family);
  if (languagesByFamily.size === 0) missing.push(requiredLanguages.length === OPERATING_LANGUAGE_CODES.length
    ? "至少一组 .zh/.vi/.en 字段" : `至少一组 ${requiredLanguages.map((language) => `.${language}`).join("/")} 字段`);
  return { valid: missing.length === 0, missing };
}
