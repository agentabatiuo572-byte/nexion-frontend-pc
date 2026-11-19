"use client";

import { useEffect, useState } from "react";
import { Fact, Facts } from "@/app/components/rd";
import { isFirstA2DisclosurePublish, readA2DisclosureVersion, type A2OperationRow } from "@/lib/admin/a2-client";
import { iContentActions, type DisclosureVersionItemView } from "@/lib/admin/i-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { disclosureChange, PublishDiff } from "../i-tabs/i5-disclosures";

type VersionReview = { current?: DisclosureVersionItemView; target: DisclosureVersionItemView };
const DISCLOSURE_LANGUAGES = [["zh", "中文"], ["vi", "越南语"], ["en", "英语"]] as const;

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
  const additionalLanguagesUnavailable = previous && (!previous.translations
    || previous.chapters.some(chapter => !chapter.titleTranslations || !chapter.bodyTranslations));
  const change = draft && (first || (previous?.languageScope === draft.languageScope && !missingLanguages.length
    && !additionalLanguagesUnavailable))
    ? disclosureChange(previous, draft) : undefined;
  return <>
    <Facts>
      <Fact k="草稿仍与申请时一致">{match === true ? "是" : match === false ? "否" : "未知"}</Fact>
      {!draft && <Fact k="改动">未提供</Fact>}
      {draft && !first && !previous && <Fact k="上一版内容">未提供</Fact>}
      {change && <Fact k="改动" tone={change.onlySummary ? "warn" : undefined}>{change.headline}</Fact>}
      {missingLanguages.length > 0 && <Fact k="上一版缺项">{missingLanguages.join("、")}内容不全</Fact>}
      {additionalLanguagesUnavailable && <Fact k="上一版附加语言">未提供</Fact>}
    </Facts>
    {draft && <PublishDiff current={previous} target={draft} />}
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
  if (!canRead || (loaded?.key === readKey && !review)) return <Facts><Fact k="改动">读不到这两版内容，到 I5 核对</Fact></Facts>;
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
