"use client";

import { useEffect, useState } from "react";
import { Fact, Facts, Fold } from "@/app/components/rd";
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
type TranslationSide = TranslationPair["before"];

const languageName = (code: string) => INTERFACE_LANGUAGES.find(language => language.code === code)?.zhName ?? code;
const chapterList = (numbers: string[]) => `第 ${numbers.join("、")} 章`;
const CHAPTER_NUMBERS = ["01", "02", "03", "04", "05", "06", "07"];

/** 一种语言的全部对照项：总文、七章标题、七章正文。 */
function translationPairs(language: TranslationLanguage) {
  return [language.summary, ...language.chapters.flatMap(chapter => [chapter.title, chapter.body])];
}

const added = (language: TranslationLanguage) => language.summary.before.state === "out_of_scope";
const removed = (language: TranslationLanguage) => language.summary.after.state === "out_of_scope";

/** 中越英里只有一版有的语言（旧版只有中越、本版加了英语）：和附加语言同一种结构，另一侧记成「这一版没有这种语言」，不放进「无变化的内容」（A2R02）。 */
function baseLanguageChange(code: (typeof DISCLOSURE_LANGUAGES)[number][0], previous: DisclosureVersionItemView, draft: DisclosureVersionItemView): TranslationLanguage {
  const side = (version: DisclosureVersionItemView, text: string | undefined): TranslationSide => !version.languageScope.split("+").includes(code)
    ? { state: "out_of_scope" } : text?.trim() ? { state: "available", text } : { state: "missing_evidence" };
  const pair = (before: TranslationSide, after: TranslationSide): TranslationPair => ({ before, after, changed: null });
  return {
    code,
    summary: pair(side(previous, previous[code]), side(draft, draft[code])),
    chapters: CHAPTER_NUMBERS.map(no => {
      const old = previous.chapters.find(chapter => chapter.no === no);
      const next = draft.chapters.find(chapter => chapter.no === no);
      return { no, title: pair(side(previous, old?.[code]), side(draft, next?.[code])), body: pair(side(previous, old?.[`${code}Body`]), side(draft, next?.[`${code}Body`])) };
    }),
  };
}

/** 两版都有的附加语言一行：改了什么；缺记录（null）单独写、只给这半句上注意色，不当成没变。 */
function TranslationOverview({ language }: { language: TranslationLanguage }) {
  const pairs = translationPairs(language);
  const missingBefore = pairs.filter(pair => pair.before.state === "missing_evidence").length;
  const missingAfter = pairs.filter(pair => pair.after.state === "missing_evidence").length;
  const chapters = language.chapters.filter(chapter => chapter.title.changed === true || chapter.body.changed === true).map(chapter => chapter.no);
  const summary = language.summary.changed === true;
  const changed = summary && chapters.length ? `总文和${chapterList(chapters)}有改动`
    : summary ? "只改了总文" : chapters.length ? `${chapterList(chapters)}有改动` : "";
  const missing = [missingBefore > 0 && `上一版缺 ${missingBefore} 处译文`, missingAfter > 0 && `本版缺 ${missingAfter} 处译文`].filter(Boolean).join("，");
  if (!missing) return <>{changed || "没变"}</>;
  return <>{changed && `${changed}；`}<span className="a2-translation-warn">{missing}，无法对照</span></>;
}

const sideText = (side: TranslationSide) => side.state === "available" ? side.text
  : side.state === "out_of_scope" ? "这一版没有这种语言" : side.state === "missing_evidence" ? "缺少记录" : "第一次发布";

/** 一处译文：两版都有时写「本版／上一版」并标出改的那一段；只有一版有原文时只放那一版；缺记录写哪一版缺。 */
function TranslationText({ label = "", pair, contentOnly }: { label?: string; pair: TranslationPair; contentOnly?: boolean }) {
  if (pair.before.state === "available" && pair.after.state === "available") {
    return <>
      <p>本版{label}：<ChangedText before={pair.before.text} after={pair.after.text} side="after" /></p>
      <p className="rd-weak">上一版{label}：<ChangedText before={pair.before.text} after={pair.after.text} side="before" /></p>
    </>;
  }
  if (contentOnly || pair.before.state === "first_publish" || pair.before.state === "out_of_scope") return <p>{sideText(pair.after)}</p>;
  if (pair.after.state === "out_of_scope") return <p>{sideText(pair.before)}</p>;
  return <>
    <p>本版{label}：{sideText(pair.after)}</p>
    <p className="rd-weak">上一版{label}：{sideText(pair.before)}</p>
  </>;
}

/**
 * 原文对照：默认收起；只放有改动、新增、去掉或缺记录的段，没变的章一行带过。
 * 新增的语言放本版原文，去掉的语言放上一版原文（A2R01），摘要写出新增、去掉和缺记录。
 */
function TranslationDiffFold({ name, languages, mode }: { name: string; languages: TranslationLanguage[]; mode: "first" | "contentOnly" | "compare" }) {
  // 第一次发布、上一版整份缺记录：没有可对照的旧文，只放本版内容。
  const contentOnly = mode !== "compare";
  const shown = (pair: TranslationPair) => contentOnly || pair.changed !== false;
  const items = languages
    .map(language => ({
      language,
      // 只有一版有这种语言：标题已写在章名里，只放那一版的正文。
      fresh: contentOnly || added(language) || removed(language),
      summary: shown(language.summary),
      chapters: language.chapters.filter(chapter => shown(chapter.title) || shown(chapter.body)),
    }))
    .filter(item => item.summary || item.chapters.length > 0);
  if (!items.length) return null;
  const summaryText = items.map(({ language, fresh, summary, chapters }) => {
    const scope = added(language) ? "本版新增，" : removed(language) ? "本版去掉，" : "";
    const parts = [summary && "总文", chapters.length > 0 && (fresh ? `${chapters.length} 章` : chapterList(chapters.map(chapter => chapter.no)))].filter(Boolean).join("、");
    const missing = fresh ? 0 : translationPairs(language).filter(pair => pair.before.state === "missing_evidence" || pair.after.state === "missing_evidence").length;
    return `${languageName(language.code)}：${scope}${parts}${missing ? `（${missing} 处缺记录）` : ""}`;
  }).join("；");
  return <div data-business-form="disclosure-translation-review"><Fold inset title={`${name} · ${mode === "first" ? "全部内容" : mode === "contentOnly" ? "本版内容" : "版本差异"}`} summary={summaryText}>
    <div className="rd-doc">
      {items.map(({ language, fresh, summary, chapters }) => {
        const languageLabel = languageName(language.code);
        const same = language.chapters.filter(chapter => !chapters.includes(chapter)).map(chapter => chapter.no);
        return <div key={language.code} className="a2-translation-lang">
          {added(language) && <p className="rd-weak">上一版没有{languageLabel}，下面是本版原文。</p>}
          {removed(language) && <p className="rd-weak">本版没有{languageLabel}，下面是上一版原文。</p>}
          {summary && <section>
            <h3>总文 · {languageLabel}</h3>
            <TranslationText pair={language.summary} contentOnly={fresh} />
          </section>}
          {chapters.map(chapter => {
            const title = chapter.title.after.state === "available" ? chapter.title.after.text
              : chapter.title.before.state === "available" ? chapter.title.before.text : "";
            return <section key={chapter.no}>
              <h3>第 {chapter.no} 章 · {languageLabel}{title && ` · ${title}`}</h3>
              {fresh ? <TranslationText pair={chapter.body} contentOnly={contentOnly} />
                : <>
                  {shown(chapter.title) && <TranslationText label="标题" pair={chapter.title} />}
                  {shown(chapter.body) && <TranslationText label={shown(chapter.title) ? "正文" : undefined} pair={chapter.body} />}
                </>}
            </section>;
          })}
          {!fresh && same.length > 0 && <p className="rd-weak">{languageLabel}其余没变：{chapterList(same)}{!summary && "、总文"}</p>}
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
  const previousCodes = previous?.languageScope.split("+") ?? [];
  const draftCodes = draft?.languageScope.split("+") ?? [];
  // 中越英里两版都有的语言才逐处比较；只有一版有的（旧版没有英语）单独列出。
  const compared = DISCLOSURE_LANGUAGES.filter(([code]) => draftCodes.includes(code) && (!previous || previousCodes.includes(code)));
  const comparedName = compared.length === DISCLOSURE_LANGUAGES.length ? "中越英" : compared.map(([, name]) => name).join("、");
  const baseChanges = previous && draft
    ? DISCLOSURE_LANGUAGES.filter(([code]) => previousCodes.includes(code) !== draftCodes.includes(code)).map(([code]) => baseLanguageChange(code, previous, draft))
    : [];
  // 第一次发布不写「改动」：上面「变更 无上一版 → v1」已经说了。
  const change = draft && previous && !missingLanguages.length ? disclosureChange(previous, draft) : undefined;
  // 附加语言只用审批单里冻结的两份版本对照（A2-BE-16）。
  const translation = draft ? a2DisclosureTranslationDiff(publish) : undefined;
  const languages = translation?.languages ?? [];
  const extra = [...baseChanges, ...languages];
  const baseSame = !!change && !change.summary.length && !change.chapters.length;
  // 「内容相同」只在每一处都比出没变时写；新增、去掉语言，附加语言有改动或缺记录都不算相同。
  const allSame = extra.every(language => translationPairs(language).every(pair => pair.changed === false));
  const headline = change && (baseSame ? allSame ? "和上一版内容相同" : "没变" : change.headline);
  const previousMissing = translation?.before.state === "missing_evidence";
  // 语言范围只写增减，去掉的语言上注意色。
  const scopeAdded = previous && draft ? draftCodes.filter(code => !previousCodes.includes(code)).map(languageName) : [];
  const scopeRemoved = previous && draft ? previousCodes.filter(code => !draftCodes.includes(code)).map(languageName) : [];
  return <>
    <Facts>
      <Fact k="申请后草稿" tone={match === false && ticket.status === "pending" ? "warn" : undefined}>{match === true ? "没改过" : match === false ? ticket.status === "pending" ? "已改动，批准不会成功" : "已改动" : "无法核对"}</Fact>
      {!draft && <Fact k="改动">未提供</Fact>}
      {draft && !first && !previous && <Fact k="上一版内容" tone="warn">缺少记录，无法对照</Fact>}
      {change && <Fact k={extra.length && !(baseSame && allSame) ? comparedName : "改动"} tone={change.onlySummary ? "warn" : undefined}>{headline}</Fact>}
      {missingLanguages.length > 0 && <Fact k="上一版缺项">{missingLanguages.join("、")}内容不全</Fact>}
      {(scopeAdded.length > 0 || scopeRemoved.length > 0) && <Fact k="语言范围">
        {scopeAdded.length > 0 && `新增 ${scopeAdded.join("、")}`}{scopeAdded.length > 0 && scopeRemoved.length > 0 && "；"}
        {scopeRemoved.length > 0 && <span className="a2-translation-warn">去掉 {scopeRemoved.join("、")}</span>}
      </Fact>}
      {!first && !previousMissing && !(baseSame && allSame) && languages.filter(language => !added(language) && !removed(language))
        .map(language => <Fact key={language.code} k={languageName(language.code)}><TranslationOverview language={language} /></Fact>)}
      {(first || previousMissing) && languages.length > 0 && <Fact k="附加语言">{languages.map(language => languageName(language.code)).join("、")}</Fact>}
    </Facts>
    {/* 有新增、去掉或附加语言时，这两个折叠只管两版都有的中越英，标题写明范围，免得「无变化的内容」读成整份没变。 */}
    {draft && <PublishDiff current={previous} target={draft} frozen scope={extra.length ? comparedName : undefined} />}
    {baseChanges.length > 0 && <TranslationDiffFold name={baseChanges.map(language => languageName(language.code)).join("、")} languages={baseChanges} mode="compare" />}
    {translation && <TranslationDiffFold name="附加语言" languages={languages}
      mode={translation.before.state === "first_publish" ? "first" : translation.before.state === "available" ? "compare" : "contentOnly"} />}
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
