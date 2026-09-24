/** Mirrors the backend I6 publish gate for immediate form feedback. */
export function i6CopyQualityIssues(zh: string, en: string, vi: string): string[] {
  const issues: string[] = [];
  for (const [locale, value] of [["中文", zh], ["英文", en], ["越南语", vi]] as const) {
    const bare = value.replace(/\s+/gu, "");
    const compact = bare.replace(/[\x21-\x2F\x3A-\x40\x5B-\x60\x7B-\x7E]+/g, "").toLowerCase();
    if (/^(.)\1{4,}$/u.test(bare) || /^(?:test|todo|tbd|placeholder|dummy|样例|测试|占位)+$/u.test(compact)) {
      issues.push(`${locale}含占位文本`);
    }
    if (/(^|[^A-Za-z0-9])nexion/i.test(value)) issues.push(`${locale}仍使用旧品牌 Nexion`);
  }
  return issues;
}
