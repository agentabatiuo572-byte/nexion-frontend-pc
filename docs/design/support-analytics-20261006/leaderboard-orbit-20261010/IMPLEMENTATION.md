# Orbit leaderboard: current visual contract

The approved raster is [approved-design.png](approved-design.png), 1536×1024, SHA256 `e3b92e2fbb593171a4658e058c562ec4dbc9403fecafdf8dd85a719ba71f6c3a`. Later explicit decisions below take precedence over the older raster. This document describes the current implementation; historical experiments and extraction provenance remain in Git history and the linked manifests.

## Confirmed presentation

- Three boards: net contribution, first-payment people and customer scale. Recharge and spending are not separate additive boards.
- Six table columns. Name and group remain left-aligned; the self badge and movement sit at the trailing side of the same identity cell, vertically centered across the row. Long identities truncate with full-name access.
- Periods and common units appear in headings. Amounts/counts use compact display with exact-value access. Parallel podium metrics share one font tier.
- Four podium positions can display the first three ranks including a tie. Avatars, names, groups, ranks, amounts and movement remain live DOM, not painted data.
- Honorary avatar frames are green, with motion that stops for reduced-motion/offscreen states. Missing or failed portraits retain the actual identity initial.
- Record count sits on the left of the footer. Page-size and page buttons form one right-aligned, vertically centered group; there is no fixed center anchor for the page-size selector.
- The locate action is 112×36 on fine-pointer desktops. All coarse-pointer button, summary and select targets are at least 44×44. Touch rows use continuous cell colors so their highlight covers the entire row.
- Preview navigation uses the three-dot conversation icon. Production continues supplying its existing authorized shell and identity; the optional preview shell does not grant route access.

Typography follows the existing application font stack. Table headings, common units, groups and footer use 14px; names/actions use 16px; parallel podium metrics use 22px. The owner confirmed that only the generated PNG exists; no font or layered source is pending. Use the project font stack and compare hierarchy, size, weight, spacing and layout against the raster. Do not trace generated glyph defects or replace live text with bitmap text. This is not a claim of glyph-byte equality.

## Original image assets and live content

Background, orbit, pedestal and surface assets are under `app/components/domain-views/m-tabs/support-leaderboard-assets/`. Fixed crops preserve original material outside declared foreground-removal supports. Previously occluded material is reconstruction, not recovered original pixels. Relevant provenance:

- [Initial background partition](background-v2-manifest.json)
- [Surface extraction](background-surfaces-r117-manifest.json)
- [Approved-source restoration](background-approved-source-restoration-20261014.json)
- [Pedestal halo restoration](pedestal-halo-restoration-20261015.json)

No bitmap chooses a person, rank, amount, permission or page. Fixture portraits are repository-owned comparison inputs; production uses the API avatar protocol. The existing component and fixture remain the runtime sources.

The approved native materials are used at their measured desktop geometry. Four original button surrounds apply only at the native 1355px content width with a fine pointer; other widths and touch use responsive CSS controls. Fixed-height table/self-row crops apply only to fine pointers; longer pages and touch use continuous backgrounds. Responsive layout must not clip controls or create horizontal page overflow.

## Evidence and acceptance boundary

On 2026-10-15 the owner explicitly replaced whole-raster pixel equality with independent acceptance of the original layout/materials, later approved amendments, project typography and interactions (decision `call_33a2cf4dd4f348d6ade66b52d59e2da2`). This acceptance is recorded separately from the unchanged strict pixel results. It does not waive real-data, authorization or complete-publication acceptance.

The latest scope is only the self-rank label/number alignment: 20px/40px centered on desktop, existing 18px/28px narrow typography, movement on the following line. See [scoped acceptance](../../../acceptance/support-self-rank-20261015.json). The earlier full-image records below retain their original source hashes and fixture provenance; they are not authenticated-backend screenshots or fresh whole-page acceptance of this CSS correction.

- [Controls and pagination](../../../acceptance/support-rank-controls-20261014.md)
- [Podium buttons](../../../acceptance/support-podium-buttons-20261015.json)
- [Touch targets and complete row highlight](../../../acceptance/support-rank-touch-20261015.json)
- [Current full-image readback and navigation icon](../../../acceptance/support-rank-current-fidelity-20261015.json)
- [Remaining business acceptance and message handoff](../../../acceptance/support-center-handoff-20261014.md)

The latest lossless screenshot is tied to component/CSS hashes. All 13 fixed material regions pass, but the strict full-image comparison remains **FAIL**. The original dynamic masks and maximum channel tolerance of 1 are unchanged. The separate approved-amendment comparison covers only the fixed grid-line bands and green-ring supports with mandatory geometry/style checks; it is not a general waiver for other controls, typography or reconstructed texture. Raw and amended failures remain recorded separately.

The current icon repair changes only the conversation-icon region; the comparison outside that region is byte-identical. The subsequent independent comparison of the two existing source-bound screenshots found no new actionable visual defect. Raster glyphs and additional approved control changes contribute to the old-raster comparison, but the remaining differences have not all been attributed to fonts. The owner-approved visual acceptance uses the criteria above; no individual differing pixel or strict full-image result is relabeled as passed.

## Reproduction

`node tests/support-leaderboard-runtime.mjs` runs the complete isolated visual fixture contract. It records individual results, source hashes/freeze, browser screenshots, geometry, callbacks, responsive states and exact pixel coverage. Formal execution requires repository source and the existing recognized workflow identities; external candidate overlays are author-only. A fixture result does not certify real login, API settlement, database persistence, financial correctness or complete real leaderboard publication.

For small visual fixes, reuse the existing source-matched bundle/preview and test the changed surface plus affected geometry, then run the required project merge checks once. Keep the strict full-image failure visible, retain independent findings and stop owned preview services after the window. Do not repeat old money, initialization or customer-message tests for a visual-only edit.
