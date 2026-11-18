import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

type ContentLanguageValue = string | readonly string[];

export const APP_VISIBLE_TEXT_HINT = "App 用户可见，请填英文";

export function containsHan(value: string): boolean {
  return /\p{Script=Han}/u.test(value);
}

export function appVisibleTextError(value: string | undefined, field: string): string | undefined {
  if (value && containsHan(value)) {
    return `${field}不能包含中文，请改成英文`;
  }
}

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

/** A required translation group whose every field equals the English field holds only the stored English copy. */
export function isEnglishCopy<Fields extends Record<string, ContentLanguageValue>>(english: Fields, localized: Fields): boolean {
  const fields = Object.entries(localized);
  return fields.length > 0 && fields.some(([field]) => {
    const original = english[field];
    return typeof original === "string" ? original.trim() !== "" : original?.some((entry) => entry.trim() !== "");
  }) && fields.every(([field, value]) => {
    const original = english[field];
    return typeof value === "string"
      ? typeof original === "string" && value.trim() === original.trim()
      : Array.isArray(original) && value.length === original.length
        && value.every((entry, index) => entry.trim() === original[index].trim());
  });
}

export function englishCopyHint(language: "zh" | "vi"): string {
  const name = language === "zh" ? "中文" : "越南语";
  return `这是英文副本，App ${name}下会显示英文。请改成${name}。`;
}

export function mapSingleContentText(
  texts: Record<OperatingLanguageCode, string>,
  required: readonly OperatingLanguageCode[],
  mode: "edit" | "submit",
) {
  const transform = mode === "edit" ? blankCopiedContentLanguage : fillBlankContentLanguage;
  const en = { text: texts.en };
  return {
    en: en.text,
    zh: transform(required, "zh", en, { text: texts.zh }).text,
    vi: transform(required, "vi", en, { text: texts.vi }).text,
  };
}

export type LocalizedTitleBody = Record<`${"title" | "body"}${"En" | "Zh" | "Vi"}`, string>;

export function mapContentTitleBody(
  copy: LocalizedTitleBody,
  required: readonly OperatingLanguageCode[],
  mode: "edit" | "submit",
): LocalizedTitleBody {
  const transform = mode === "edit" ? blankCopiedContentLanguage : fillBlankContentLanguage;
  const en = { title: copy.titleEn, body: copy.bodyEn };
  const zh = transform(required, "zh", en, { title: copy.titleZh, body: copy.bodyZh });
  const vi = transform(required, "vi", en, { title: copy.titleVi, body: copy.bodyVi });
  return { titleEn: en.title, bodyEn: en.body, titleZh: zh.title, bodyZh: zh.body, titleVi: vi.title, bodyVi: vi.body };
}
