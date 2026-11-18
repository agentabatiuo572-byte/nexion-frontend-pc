import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

type ContentLanguageValue = string | readonly string[];

export function trimStoredContent(value: string): string {
  // Java String.trim() preserves nonbreaking spaces and other characters above U+0020.
  return value.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
}

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

export function blankCopiedContentLanguage<Fields extends Record<string, ContentLanguageValue>>(
  requiredLanguages: readonly OperatingLanguageCode[],
  language: OperatingLanguageCode,
  english: Fields,
  localized: Fields,
): Fields {
  if (requiredLanguages.includes(language)) return localized;
  const fields = Object.entries(localized);
  const copied = fields.every(([field, value]) => {
    const original = english[field];
    return typeof value === "string"
      ? typeof original === "string" && value.trim() === original.trim()
      : Array.isArray(original) && value.length === original.length
        && value.every((entry, index) => entry.trim() === original[index].trim());
  });
  if (!copied) return localized;
  return Object.fromEntries(fields.map(([field, value]) => [field, typeof value === "string" ? "" : value.map(() => "")])) as Fields;
}
