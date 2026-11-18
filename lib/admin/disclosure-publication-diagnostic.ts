import type { DisclosureJurisdictionView, DisclosureVersionItemView } from "./i-client";

/** Read-only diagnosis of the exact matrix reference; never choose a replacement publication. */
export function disclosurePublicationIssue(
  mapping: Pick<DisclosureJurisdictionView, "code" | "version" | "status">,
  versions: DisclosureVersionItemView[],
): string | null {
  if (mapping.status.toLowerCase() !== "published") return null;
  const matches = versions.filter((item) => item.jurisdiction === mapping.code && item.version === mapping.version);
  if (matches.length === 0) return "未找到矩阵引用的披露版本，App 无法读取该地区的风险披露。请核对版本列表与当前映射。";
  if (matches.length !== 1) return "矩阵引用的披露版本不唯一，请核查后台版本数据。";
  const version = matches[0];
  if (!["published", "superseded"].includes(version.status.toLowerCase())) return "矩阵引用的版本尚未发布或已归档，App 无法读取。请按既有发布流程核对正文与映射。";
  const chapters = version.chapters;
  // Stored scopes the App can read (risk-disclosure-api requires zh and vi): zh+vi, zh+vi+en, or zh+vi+en followed by
  // distinct additional interface languages (OpsTrustDisclosureService). A bare en draft input is saved as zh+vi+en,
  // plus any additional languages the edited draft already had.
  const scope = version.languageScope.split("+");
  const validScope = ["zh+vi", "zh+vi+en"].includes(version.languageScope)
    || (scope.length > 3 && scope.slice(0, 3).join("+") === "zh+vi+en" && new Set(scope).size === scope.length
      && scope.slice(3).every((code) => ["id", "ms", "fil", "ru", "kk", "uz"].includes(code)));
  const languages = !validScope ? null : scope.includes("en") ? ["zh", "vi", "en"] as const : ["zh", "vi"] as const;
  const complete = languages && chapters.length === 7 && Array.from({ length: 7 }, (_, index) => String(index + 1).padStart(2, "0")).every((no) => {
    const matching = chapters.filter((chapter) => chapter.no === no);
    if (matching.length !== 1) return false;
    const chapter = matching[0];
    return chapter.jurisdiction === mapping.code && chapter.version === mapping.version
      && languages.every((language) => chapter[language]?.trim() && chapter[`${language}Body`]?.trim());
  });
  return complete ? null : "矩阵引用的版本正文不完整或语言范围无效，App 无法确认披露。请核查该法域、该版本的七章正文。";
}
