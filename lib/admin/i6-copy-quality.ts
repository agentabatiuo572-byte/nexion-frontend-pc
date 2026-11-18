import type { I18nMessagePairView } from "@/lib/admin/i-client";
import type { OperatingLanguageCode } from "@/lib/admin/platform-experience-client";

/** Mirrors the backend I6 publish gate for immediate form feedback. */
export function i6CopyQualityIssues(zh: string, en: string, vi: string): string[] {
  const issues: string[] = [];
  for (const [locale, value] of [["中文", zh], ["英文", en], ["越南语", vi]] as const) {
    const bare = value.replace(/\s+/gu, "");
    const compact = bare.replace(/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]+/g, "").toLowerCase();
    if (/^(.)\1{4,}$/u.test(bare) || /^(?:test|todo|tbd|placeholder|dummy|样例|测试|占位)+$/u.test(compact)) {
      issues.push(`${locale}含占位文本`);
    }
    if (/(^|[^A-Za-z0-9])(nexion|nex[ _-]*grid|stellar[ _-]*(box|rack))/i.test(value)) issues.push(`${locale}仍使用旧品牌`);
  }
  return issues;
}

export function messageVariables(message: I18nMessagePairView, languages: readonly OperatingLanguageCode[]): string[] {
  return languages.map((language) => [...new Set(message[language].match(/\{[a-zA-Z0-9_.-]+}/g) ?? [])].sort().join("、"));
}

export function messageQualityIssues(message: I18nMessagePairView, languages: readonly OperatingLanguageCode[]): string[] {
  return i6CopyQualityIssues(languages.includes("zh") ? message.zh : "", message.en, languages.includes("vi") ? message.vi : "");
}

export function summarizePublishedI6Messages(publishedMessages: Readonly<Record<string, I18nMessagePairView>>, requiredLanguages: readonly OperatingLanguageCode[]) {
  const completeByNamespace = new Map<string, number>();
  let managedKeys = 0;
  for (const message of Object.values(publishedMessages)) {
    if (requiredLanguages.some((language) => !message[language].trim())
      || new Set(messageVariables(message, requiredLanguages)).size !== 1
      || messageQualityIssues(message, requiredLanguages).length > 0) continue;
    completeByNamespace.set(message.namespace, (completeByNamespace.get(message.namespace) ?? 0) + 1);
    managedKeys += 1;
  }
  return { managedKeys, completeByNamespace };
}
