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
  return complete ? null : "这个生效版本的七章正文不全或语言范围不对，App 读不到。请核对这个版本的七章正文。";
}
