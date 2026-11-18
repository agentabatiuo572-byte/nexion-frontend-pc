"use client";

import { useEffect, useState } from "react";
import { Fact, Facts } from "@/app/components/rd";
import type { A2OperationRow } from "@/lib/admin/a2-client";
import { iContentActions, type DisclosureVersionItemView } from "@/lib/admin/i-client";
import { disclosureChange, PublishDiff } from "../i-tabs/i5-disclosures";

type VersionReview = { current?: DisclosureVersionItemView; target: DisclosureVersionItemView };

export function A2I5DisclosureReview({ ticket }: { ticket: A2OperationRow }) {
  const publish = ticket.operationCode === "i5_disclosure_publish" || ticket.operationCode === "i4_disclosure_publish";
  const matrix = ticket.operationCode === "i5_matrix_configure";
  const jurisdiction = ticket.obj;
  // Matrix tickets store their version and country list as "version · countries".
  const before = matrix ? ticket.before.split(" ·", 1)[0] : ticket.before;
  const targetVersion = matrix ? ticket.after.split(" ·", 1)[0] : ticket.after;
  const currentVersion = before === (matrix ? "未配置" : "无生效版") ? undefined : before;
  const binding = ticket.i5DisclosurePublishReview;
  const expectedRevision = binding?.expectedRevision;
  const expectedContentHash = binding?.expectedContentHash;
  const canRead = (matrix || (publish && binding?.jurisdiction === jurisdiction && binding.version === targetVersion))
    && !!jurisdiction && !!targetVersion && targetVersion !== "—" && currentVersion !== "—";
  const [review, setReview] = useState<VersionReview | "unavailable">();

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const read = async (version: string) => {
      const row = await iContentActions.fetchI5DisclosureVersion(jurisdiction, version);
      if (row?.jurisdiction !== jurisdiction || row.version !== version || typeof row.status !== "string" || row.chapters?.length !== 7
        || new Set(row.chapters.map((chapter) => chapter.no)).size !== 7
        || !row.chapters.every((chapter) => /^0[1-7]$/.test(chapter.no))
        || !["zh+vi", "zh+vi+en"].includes(row.languageScope)) {
        throw new Error("I5_DISCLOSURE_REVIEW_UNAVAILABLE");
      }
      return row;
    };
    const target = read(targetVersion);
    const current = !currentVersion ? undefined : currentVersion === targetVersion ? target : read(currentVersion);
    void Promise.all([current, target]).then(([current, target]) => {
      if (!active) return;
      const isPublished = (row: DisclosureVersionItemView) => ["published", "superseded"].includes(row.status.toLowerCase());
      const validTarget = publish
        ? target.status.toLowerCase() === "draft" && target.revision === expectedRevision && target.contentHash === expectedContentHash
        : isPublished(target);
      // I5's review compares languages shared by both versions. Do not present a partial comparison as complete.
      const validCurrent = !current || (isPublished(current) && current.languageScope === target.languageScope);
      setReview(validTarget && validCurrent ? { current, target } : "unavailable");
    }, () => {
      if (active) setReview("unavailable");
    });
    return () => { active = false; };
  }, [canRead, currentVersion, expectedContentHash, expectedRevision, jurisdiction, publish, targetVersion]);

  if (!publish && !matrix) return null;
  if (!canRead || review === "unavailable") return <Facts><Fact k="改动">读不到这两版内容，到 I5 核对</Fact></Facts>;
  if (!review) return <Facts><Fact k="改动">读取中</Fact></Facts>;
  const change = publish || review.current ? disclosureChange(review.current, review.target) : undefined;
  return <>
    {change && <Facts><Fact k="改动" tone={change.onlySummary ? "warn" : undefined}>{change.headline}</Fact></Facts>}
    <PublishDiff current={review.current} target={review.target} />
  </>;
}
