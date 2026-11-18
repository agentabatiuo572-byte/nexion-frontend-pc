import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

type ContentLanguageValue = string | readonly string[];

export function isConversationSourceKey(messageKey: string): boolean {
  return messageKey.startsWith("conversation.script.") || messageKey.startsWith("conversation.template.");
}

export function requiredMessageLanguages(messageKey: string, required: readonly OperatingLanguageCode[]): readonly OperatingLanguageCode[] {
  return isConversationSourceKey(messageKey) && !required.includes("zh") ? [...required, "zh"] : required;
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
