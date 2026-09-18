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
  const languages = version.languageScope === "zh+vi" ? ["zh", "vi"] as const
    : version.languageScope === "zh+vi+en" ? ["zh", "vi", "en"] as const : null;
  const complete = languages && chapters.length === 7 && Array.from({ length: 7 }, (_, index) => String(index + 1).padStart(2, "0")).every((no) => {
    const matching = chapters.filter((chapter) => chapter.no === no);
    if (matching.length !== 1) return false;
    const chapter = matching[0];
    return chapter.jurisdiction === mapping.code && chapter.version === mapping.version
      && languages.every((language) => chapter[language]?.trim() && chapter[`${language}Body`]?.trim());
  });
  return complete ? null : "矩阵引用的版本正文不完整或语言范围无效，App 无法确认披露。请核查该法域、该版本的七章正文。";
}
