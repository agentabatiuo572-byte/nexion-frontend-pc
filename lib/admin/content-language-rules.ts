import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

type ContentLanguageValue = string | readonly string[];

export function fillBlankContentLanguage<Fields extends Record<string, ContentLanguageValue>>(
  requiredLanguages: readonly OperatingLanguageCode[],
  language: OperatingLanguageCode,
  english: Fields,
  localized: Fields,
): Fields {
  if (requiredLanguages.includes(language)) return localized;
  return Object.values(localized).every((value) => typeof value === "string"
    ? value.trim() === ""
    : value.every((entry) => entry.trim() === "")) ? english : localized;
}

export function blankCopiedContentField(
  requiredLanguages: readonly OperatingLanguageCode[], language: OperatingLanguageCode, english: string, localized: string,
): string;
export function blankCopiedContentField(
  requiredLanguages: readonly OperatingLanguageCode[], language: OperatingLanguageCode, english: readonly string[], localized: readonly string[],
): readonly string[];
export function blankCopiedContentField(
  requiredLanguages: readonly OperatingLanguageCode[],
  language: OperatingLanguageCode,
  english: ContentLanguageValue,
  localized: ContentLanguageValue,
): ContentLanguageValue {
  if (requiredLanguages.includes(language)) return localized;
  if (typeof localized === "string") {
    return typeof english === "string" && localized.trim() === english.trim() ? "" : localized;
  }
  return typeof english !== "string" && localized.length === english.length
    && localized.every((entry, index) => entry.trim() === english[index].trim()) ? localized.map(() => "") : localized;
}
