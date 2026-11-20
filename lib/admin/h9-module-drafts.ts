import type { H9FieldDef, H9PublicStatsValues } from "@/lib/admin/h9-client";
import { h9DraftText, type H9BandDraft } from "./h9-validation.ts";

type Key = H9FieldDef["key"];
export type H9ScalarDrafts = Record<Key, string>;
export type H9EditorState = { baseline: H9PublicStatsValues; drafts: H9ScalarDrafts; bands: H9BandDraft[] };

/** Follow refreshed values only for pristine fields; retain the original baseline of edited fields. */
export function reconcileH9Editor(current: H9EditorState | null, values: H9PublicStatsValues,
    keys: readonly Key[], resetKeys: readonly Key[] = [], resetBands = false): H9EditorState {
  const retainedKeys = current ? keys.filter(key => !resetKeys.includes(key)
    && current.drafts[key].trim() !== h9DraftText(current.baseline[key])) : [];
  const bandsDirty = !!current && (current.bands.length !== current.baseline.hashratePercentileTable.length
    || current.bands.some((row, index) => row.tops.trim() !== h9DraftText(current.baseline.hashratePercentileTable[index]?.tops)
      || row.cumPct.trim() !== h9DraftText(current.baseline.hashratePercentileTable[index]?.cumPct)));
  const keepBands = !!current && bandsDirty && !resetBands;
  return {
    baseline: { ...values, ...Object.fromEntries(retainedKeys.map(key => [key, current!.baseline[key]])),
      hashratePercentileTable: keepBands ? current!.baseline.hashratePercentileTable : values.hashratePercentileTable },
    drafts: { ...Object.fromEntries(keys.map(key => [key, h9DraftText(values[key])])),
      ...Object.fromEntries(retainedKeys.map(key => [key, current!.drafts[key]])) } as H9ScalarDrafts,
    bands: keepBands ? current!.bands : values.hashratePercentileTable.map(row => ({ tops: h9DraftText(row.tops), cumPct: h9DraftText(row.cumPct) })),
  };
}
