"use client";

import { useEffect, useState } from "react";
import { Fact, Facts } from "@/app/components/rd";
import { readA2DisclosureVersion, type A2OperationRow } from "@/lib/admin/a2-client";
import { iContentActions, type DisclosureVersionItemView } from "@/lib/admin/i-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { disclosureChange, PublishDiff } from "../i-tabs/i5-disclosures";

type VersionReview = { current?: DisclosureVersionItemView; target: DisclosureVersionItemView };

export function A2I5DisclosureReview({ ticket }: { ticket: A2OperationRow }) {
  const publish = ticket.operationCode === "i5_disclosure_publish" || ticket.operationCode === "i4_disclosure_publish";
  const matrix = ticket.operationCode === "i5_matrix_configure";
  const binding = ticket.disclosureReview;
  const jurisdiction = binding?.jurisdiction;
  const targetVersion = binding?.version;
  const draft = binding?.kind === "PUBLISH" ? binding.draft : undefined;
  const before = binding?.kind === "MATRIX" ? binding.expectedVersion : ticket.before;
  const currentVersion = !before || (publish && before === "无生效版") ? undefined : before;
  const i5Read = useAdminAuth(({ session }) => session?.role === "superadmin" || session?.authorities.includes("content_i5_read") === true);
  const canRead = ticket.status === "pending" && !!jurisdiction && !!targetVersion && currentVersion !== "—"
    && (matrix || (publish && !!draft && currentVersion !== targetVersion));
  const readKey = JSON.stringify([jurisdiction, currentVersion, targetVersion, draft?.revision, draft?.contentHash, i5Read]);
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
    const target = draft ?? read(targetVersion);
    const current = !currentVersion ? undefined : currentVersion === targetVersion ? target : read(currentVersion);
    // The A2 snapshot supplies the text. If the I5 read is available, also check that the pending draft still matches it.
    const live = draft && i5Read ? read(targetVersion) : undefined;
    void Promise.all([current, target, live]).then(([current, target, live]) => {
      if (!active) return;
      const validTarget = publish
        ? !live || (live.status.toLowerCase() === "draft" && live.revision === target.revision && live.contentHash === target.contentHash)
        : isSealed(target);
      const validCurrent = !current || ((publish ? current.status.toLowerCase() === "published" : isSealed(current))
        && current.languageScope === target.languageScope);
      setLoaded({ key: readKey, review: validTarget && validCurrent ? { current, target } : undefined });
    }, () => {
      if (active) setLoaded({ key: readKey });
    });
    return () => { active = false; };
  }, [canRead, currentVersion, draft, i5Read, jurisdiction, publish, readKey, targetVersion]);

  if (!publish && !matrix) return null;
  const review = loaded?.key === readKey ? loaded.review : undefined;
  if (!canRead || (loaded?.key === readKey && !review)) return <Facts><Fact k="改动">读不到这两版内容，到 I5 核对</Fact></Facts>;
  if (!review) return <Facts><Fact k="改动">读取中</Fact></Facts>;
  const change = publish || review.current ? disclosureChange(review.current, review.target) : undefined;
  return <>
    {change && <Facts><Fact k="改动" tone={change.onlySummary ? "warn" : undefined}>{change.headline}</Fact></Facts>}
    <PublishDiff current={review.current} target={review.target} />
  </>;
}

function isSealed(row: DisclosureVersionItemView) {
  return ["published", "superseded"].includes(row.status.toLowerCase());
}
