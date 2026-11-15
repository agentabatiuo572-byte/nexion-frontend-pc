import type { DisclosureJurisdictionView, DisclosureVersionItemView } from "./i-client";

/** Read-only diagnosis of the exact matrix reference; never choose a replacement publication. */
export function disclosurePublicationIssue(
  mapping: Pick<DisclosureJurisdictionView, "code" | "version" | "status">,
  versions: DisclosureVersionItemView[],
): string | null {
  if (mapping.status.toLowerCase() !== "published") return null;
  const matches = versions.filter((item) => item.jurisdiction === mapping.code && item.version === mapping.version);
  if (matches.length === 0) return "版本列表里找不到这个生效版本，App 读不到这个适用范围的披露。请核对版本列表和生效版本设置。";
  if (matches.length !== 1) return "版本列表里这个生效版本不止一个，请联系技术同事核查。";
  const version = matches[0];
  if (!["published", "superseded"].includes(version.status.toLowerCase())) return "这个生效版本还没发布或已归档，App 读不到。请核对版本状态和生效版本设置。";
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
  return complete ? null : "这个生效版本的七章正文不全或语言范围不对，App 读不到。请核对这个版本的七章正文。";
}
