"use client";

import { useEffect, useState } from "react";
import { Change, Fact, Facts, Fold } from "@/app/components/rd";
import { a2DisclosureTranslationDiff, isFirstA2DisclosurePublish, readA2DisclosureVersion, type A2OperationRow } from "@/lib/admin/a2-client";
import { iContentActions, type DisclosureVersionItemView } from "@/lib/admin/i-client";
import { INTERFACE_LANGUAGES } from "@/lib/admin/platform-experience-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { ChangedText, disclosureChange, PublishDiff } from "../i-tabs/i5-disclosures";

type VersionReview = { current?: DisclosureVersionItemView; target: DisclosureVersionItemView };
const DISCLOSURE_LANGUAGES = [["zh", "中文"], ["vi", "越南语"], ["en", "英语"]] as const;

type TranslationDiff = NonNullable<ReturnType<typeof a2DisclosureTranslationDiff>>;
type TranslationLanguage = TranslationDiff["languages"][number];
type TranslationPair = TranslationLanguage["summary"];

const languageName = (code: string) => INTERFACE_LANGUAGES.find(language => language.code === code)?.zhName ?? code;
const scopeNames = (scope: string[]) => scope.map(languageName).join("、");
const chapterList = (numbers: string[]) => `第 ${numbers.join("、")} 章`;

/** 一种附加语言的全部对照项：总文、七章标题、七章正文。 */
function translationPairs(language: TranslationLanguage) {
  return [language.summary, ...language.chapters.flatMap(chapter => [chapter.title, chapter.body])];
}

/** 附加语言一行的结论：只认比较得到的 true/false，缺记录（null）单独写，不当成没变。 */
function translationOverview(language: TranslationLanguage): { text: string; tone?: "warn" } {
  if (language.summary.before.state === "out_of_scope") return { text: "本版新增这种语言" };
  if (language.summary.after.state === "out_of_scope") return { text: "本版去掉这种语言", tone: "warn" };
  const pairs = translationPairs(language);
  const missingBefore = pairs.filter(pair => pair.before.state === "missing_evidence").length;
  const missingAfter = pairs.filter(pair => pair.after.state === "missing_evidence").length;
  const chapters = language.chapters.filter(chapter => chapter.title.changed === true || chapter.body.changed === true).map(chapter => chapter.no);
  const summary = language.summary.changed === true;
  const changed = summary && chapters.length ? `总文和${chapterList(chapters)}有改动`
    : summary ? "只改了总文" : chapters.length ? `${chapterList(chapters)}有改动` : "";
  const missing = [missingBefore > 0 && `上一版缺 ${missingBefore} 处译文`, missingAfter > 0 && `本版缺 ${missingAfter} 处译文`].filter(Boolean).join("，");
  if (missing) return { text: `${changed ? `${changed}；` : ""}${missing}，无法对照`, tone: "warn" };
  return { text: changed || "没变" };
}

const sideText = (side: TranslationPair["before"]) => side.state === "available" ? side.text
  : side.state === "out_of_scope" ? "这一版没有这种语言" : side.state === "missing_evidence" ? "缺少记录" : "第一次发布";

/** 一处译文：有改动写「改后／现在」并标出改的那一段；缺记录写哪一侧缺。 */
function TranslationText({ label, pair, contentOnly }: { label?: string; pair: TranslationPair; contentOnly?: boolean }) {
  const prefix = label ?? "";
  if (pair.before.state === "available" && pair.after.state === "available") {
    return <>
      <p>{prefix}改后：<ChangedText before={pair.before.text} after={pair.after.text} side="after" /></p>
      <p className="rd-weak">{prefix}现在：<ChangedText before={pair.before.text} after={pair.after.text} side="before" /></p>
    </>;
  }
  if (contentOnly || pair.before.state === "first_publish" || pair.before.state === "out_of_scope") return <p>{prefix}{sideText(pair.after)}</p>;
  return <>
    <p>{prefix}改后：{sideText(pair.after)}</p>
    <p className="rd-weak">{prefix}现在：{sideText(pair.before)}</p>
  </>;
}

/** 附加语言原文对照：默认收起；只放有改动、新增或缺记录的段，没变的章一行带过。 */
function TranslationDiffFold({ diff }: { diff: TranslationDiff }) {
  const first = diff.before.state === "first_publish";
  // 第一次发布、上一版整份缺记录：没有可对照的旧文，只放本版内容。
  const contentOnly = diff.before.state !== "available";
  const shown = (pair: TranslationPair) => contentOnly || pair.changed !== false;
  // 去掉的语言只在概览里写一句，不在这里铺上一版的全文。
  const items = diff.languages.filter(language => language.summary.after.state !== "out_of_scope")
    .map(language => ({
      language,
      summary: shown(language.summary) && (language.summary.before.state !== "out_of_scope" || language.summary.after.state !== "out_of_scope"),
      chapters: language.chapters.filter(chapter => shown(chapter.title) || shown(chapter.body)),
    }))
    .filter(item => item.summary || item.chapters.length > 0);
  if (!items.length) return null;
  const summaryText = items.map(({ language, summary, chapters }) => `${languageName(language.code)}：${[summary && "总文", chapters.length > 0 && (contentOnly || language.summary.before.state === "out_of_scope" ? `${chapters.length} 章` : chapterList(chapters.map(chapter => chapter.no)))].filter(Boolean).join("、")}`).join("；");
  return <div data-business-form="disclosure-translation-review"><Fold inset title={first ? "附加语言全部内容" : contentOnly ? "附加语言本版内容" : "附加语言对照"} summary={summaryText}>
    <div className="rd-doc">
      {items.map(({ language, summary, chapters }) => {
        const name = languageName(language.code);
        // 没有旧文可对照（第一次发布、上一版整份缺记录、本版新增的语言）：标题已写在章名里，只放正文。
        const fresh = contentOnly || language.summary.before.state === "out_of_scope";
        const same = language.chapters.filter(chapter => !chapters.includes(chapter)).map(chapter => chapter.no);
        return <div key={language.code} className="a2-translation-lang">
          {summary && <section>
            <h3>总文 · {name}</h3>
            <TranslationText pair={language.summary} contentOnly={fresh} />
          </section>}
          {chapters.map(chapter => {
            const title = chapter.title.after.state === "available" ? chapter.title.after.text
              : chapter.title.before.state === "available" ? chapter.title.before.text : "";
            return <section key={chapter.no}>
              <h3>第 {chapter.no} 章 · {name}{title && ` · ${title}`}</h3>
              {fresh ? <TranslationText pair={chapter.body} contentOnly />
                : <>
                  {shown(chapter.title) && <TranslationText label="标题" pair={chapter.title} />}
                  {shown(chapter.body) && <TranslationText label={shown(chapter.title) ? "正文" : undefined} pair={chapter.body} />}
                </>}
            </section>;
          })}
          {!contentOnly && same.length > 0 && <p className="rd-weak">{name}其余没变：{chapterList(same)}{!summary && "、总文"}</p>}
        </div>;
      })}
    </div>
  </Fold></div>;
}

export function A2I5DisclosureReview({ ticket }: { ticket: A2OperationRow }) {
  const binding = ticket.disclosureReview;
  if (ticket.operationCode === "i5_matrix_configure") {
    return <MatrixVersionReview ticket={ticket} />;
  }
  if (ticket.operationCode !== "i5_disclosure_publish" && ticket.operationCode !== "i4_disclosure_publish") return null;

  const publish = binding?.kind === "PUBLISH" ? binding : undefined;
  const draft = publish?.draft;
  const previous = publish?.previousVersionSummary ?? undefined;
  const first = !!publish && isFirstA2DisclosurePublish(publish);
  const match = publish?.draftMatchesFrozenEvidence;
  const missingLanguages = previous ? DISCLOSURE_LANGUAGES.filter(([code]) => previous.languageScope.split("+").includes(code)
    && (!previous[code].trim() || previous.chapters.some(chapter => !chapter[code].trim() || !chapter[`${code}Body`].trim())))
    .map(([, name]) => name) : [];
  const baseScope = (version: DisclosureVersionItemView) => version.languageScope.split("+").slice(0, 3).join("+");
  const change = draft && (first || (previous && baseScope(previous) === baseScope(draft) && !missingLanguages.length))
    ? disclosureChange(previous, draft) : undefined;
  // 附加语言只用审批单里冻结的两份版本对照（A2-BE-16）。
  const translation = draft ? a2DisclosureTranslationDiff(publish) : undefined;
  const languages = translation?.languages ?? [];
  const baseSame = !!previous && !!change && !change.summary.length && !change.chapters.length;
  // 「内容相同」只在每一处都比出没变时写；附加语言有改动、新增、去掉或缺记录都不算相同。
  const translationSame = languages.every(language => translationPairs(language).every(pair => pair.changed === false));
  const headline = change && (baseSame ? translationSame ? "和上一版内容相同" : languages.length ? "没变" : change.headline : change.headline);
  const previousMissing = translation?.before.state === "missing_evidence";
  return <>
    <Facts>
      <Fact k="申请后草稿" tone={match === false && ticket.status === "pending" ? "warn" : undefined}>{match === true ? "没改过" : match === false ? ticket.status === "pending" ? "已改动，批准不会成功" : "已改动" : "无法核对"}</Fact>
      {!draft && <Fact k="改动">未提供</Fact>}
      {draft && !first && !previous && <Fact k="上一版内容" tone="warn">缺少记录，无法对照</Fact>}
      {change && <Fact k={!first && languages.length && !(baseSame && translationSame) ? "中越英" : "改动"} tone={change.onlySummary ? "warn" : undefined}>{headline}</Fact>}
      {missingLanguages.length > 0 && <Fact k="上一版缺项">{missingLanguages.join("、")}内容不全</Fact>}
      {translation?.scopeChanged === true && translation.before.state === "available" && translation.after.state === "available"
        && <Fact k="语言范围"><Change from={scopeNames(translation.before.languageScope)} to={scopeNames(translation.after.languageScope)} /></Fact>}
      {!first && !previousMissing && !(baseSame && translationSame) && languages.map(language => {
        const overview = translationOverview(language);
        return <Fact key={language.code} k={languageName(language.code)} tone={overview.tone}>{overview.text}</Fact>;
      })}
      {(first || previousMissing) && languages.length > 0 && <Fact k="附加语言">{languages.map(language => languageName(language.code)).join("、")}</Fact>}
    </Facts>
    {/* 有附加语言时，这两个折叠只管中越英，标题写明范围，免得「无变化的内容」读成整份没变。 */}
    {draft && <PublishDiff current={previous} target={draft} scope={languages.length ? "中越英" : undefined} />}
    {translation && <TranslationDiffFold diff={translation} />}
  </>;
}

function MatrixVersionReview({ ticket }: { ticket: A2OperationRow }) {
  const binding = ticket.disclosureReview?.kind === "MATRIX" ? ticket.disclosureReview : undefined;
  const jurisdiction = binding?.jurisdiction;
  const targetVersion = binding?.version;
  const currentVersion = binding?.expectedVersion;
  const i5Read = useAdminAuth(({ session }) => session?.authorities.includes("content_i5_read") === true);
  const canRead = ticket.status === "pending" && !!jurisdiction && !!targetVersion && currentVersion !== "—" && i5Read;
  const readKey = JSON.stringify([jurisdiction, currentVersion, targetVersion, i5Read]);
  const [loaded, setLoaded] = useState<{ key: string; review?: VersionReview }>();

  useEffect(() => {
    if (!canRead || !jurisdiction || !targetVersion) return;
    let active = true;
    const read = async (version: string) => {
      const value = await iContentActions.fetchI5DisclosureVersion(jurisdiction, version);
      const row = readA2DisclosureVersion(value, jurisdiction, version);
      if (!row) throw new Error("I5_DISCLOSURE_REVIEW_UNAVAILABLE");
      return row;
    };
    const target = read(targetVersion);
    const current = !currentVersion ? undefined : currentVersion === targetVersion ? target : read(currentVersion);
    void Promise.all([current, target]).then(([current, target]) => {
      if (!active) return;
      const valid = isSealed(target) && (!current || (isSealed(current) && current.languageScope === target.languageScope));
      setLoaded({ key: readKey, review: valid ? { current, target } : undefined });
    }, () => {
      if (active) setLoaded({ key: readKey });
    });
    return () => { active = false; };
  }, [canRead, currentVersion, jurisdiction, readKey, targetVersion]);

  if (!binding) return <Facts><Fact k="适用国家/地区">未提供</Fact></Facts>;
  const review = loaded?.key === readKey ? loaded.review : undefined;
  if (!canRead || (loaded?.key === readKey && !review)) return <Facts><Fact k="改动">读不到，请到「法律条款与风险披露」核对</Fact></Facts>;
  if (!review) return <Facts><Fact k="改动">读取中</Fact></Facts>;
  const change = review.current ? disclosureChange(review.current, review.target) : undefined;
  return <>
    {change && <Facts><Fact k="改动" tone={change.onlySummary ? "warn" : undefined}>{change.headline}</Fact></Facts>}
    <PublishDiff current={review.current} target={review.target} />
  </>;
}

function isSealed(row: DisclosureVersionItemView) {
  return ["published", "superseded"].includes(row.status.toLowerCase());
}
