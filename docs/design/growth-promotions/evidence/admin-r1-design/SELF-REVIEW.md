# PC R1 design baseline self-review

Owner: `growth_pc_design`. Scope: standalone PC design artifacts only. This is the author's self-check, not an independent review or product acceptance.

Design source: `../../admin-r1-baseline.html`. Frozen manifest: `../../admin-r1-baseline.json`. Reproduction: `node docs/design/growth-promotions/admin-r1-baseline-check.mjs --export` from the owning repository. `--freeze` is reserved for an intentional design revision; ordinary verification rejects source, token, font or design drift.

## Current evidence

- Current v3 design SHA-256: `900f5336c19b4fa5830591e4c4ad220d0f9980516c56b06d510609693b809596`. The original candidate failed independent coverage review; the five repairs and new runtime checks are recorded in [REVIEW-FIXES.md](REVIEW-FIXES.md).
- Source commit: `230ecccbe0cc87f7135856f1a1d7c68a09bb4cb0`; the manifest records hashes for the contracts, V5 tokens, H-domain CSS, shell and logo assets.
- `export-report.json` is the current runtime report. It records all 216 page/state/width/theme combinations, 96 normal modal boards, 28 lifecycle/approval boards, 44 failure modal boards, 2 reduced-transparency boards 12 actual-row editor captures and 40 lower-content modal captures, with individual hashes, URLs, geometry and browser version.
- [Capture index](index.html): 438 current design captures. `failure.png` and `failure-report.json` are retained prior-run diagnostics, not current baseline boards. Their older design hashes are superseded by the current export report.
- Main viewport: 1440 × 1000 CSS px; supplemental viewport: 1280 × 1000. DPR 1, zoom 100%, zh-CN, Asia/Tokyo, fixed fixture time. Page boards use full-page export; modal boards use the actual viewport so the native backdrop covers the entire capture.
- CSS font chain comes from the current PC source. The manifest records the actual platform fonts, including Segoe UI and Microsoft YaHei. There is no downloaded or silently substituted custom font.
- The design uses local `file:` resources through headless Chromium. No HTTP preview service, API call or alternate network preview was started.

## Coverage

| Unit | Design surface | Extra preserved contract |
|---|---|---|
| ADM01 | Activity list, category/template/status filters, create entry | Existing activity entry remains distinct; published and draft states separate |
| ADM02 | Step 1: name, category, template, timezone, date/time, placement, public copy | Empty dates show no fabricated UTC conversion; Chinese/English/Vietnamese completeness is visible |
| ADM03 | Step 2: audience, device, rank and condition summary | Match/rejection/unknown sample categories, preview timestamp, no qualification reservation |
| ADM04 | Step 3: per-SKU reward table | DEVICE/USDT/NEX displayed with readable labels; single reward per beneficiary; dual-recipient, combination and rights specimens |
| ADM05 | Step 4: caps, budget by asset, gift quota and stacking | Separate USDT/NEX/DEVICE totals; outstanding obligation remains committed; explicit shortage handling |
| ADM06 | Simulation, approval and independent publication | Blocked policy state disables publication; outcome-unknown uses original-command recovery specimen |
| ADM07 | Effective v1 and candidate v2 side by side | Per-order group limit difference; pause/end stop new reservation only; existing obligations remain |
| ADM08 | Reward ledger and per-item recovery | Failed item retry, unknown-result reconciliation, receipt and outstanding-recovery specimens; no manual-success control |
| ADM09 | Metrics and reporting | Confirmed refunds reduce net receipts; missing denominator/cost does not become zero, exact conversion or ROI |

Every unit has normal, empty, loading, error, disabled and long-copy boards in both themes and both widths. Normal fixtures represent explicitly named isolated test approvals (`TEST-APPROVED-*` / `TEST-RIGHTS-*` / `TEST-ASSET-*` / `TEST-RBAC-*`). They grant no production policy or authority. Different boards depict different lifecycle moments; navigation is not a business state machine.

## Done-review: six dimensions

| Dimension | Evidence and boundary |
|---|---|
| Real output | Source files, manifest and screenshots are written and hash-bound. Query-selected board remains selected after reload. Storage write assertion is zero; no business persistence is claimed. |
| Required coverage | ADM01–09 × six states × two themes × two widths is enumerated from the requested scope, not from existing product output. Extra approval, publication, dual-version and reconciliation surfaces are captured. |
| Interaction completeness | Every enabled modal trigger on all nine normal boards is actually clicked. Twelve actual rule-row cases verify complete values against the displayed table before/after unchanged confirmation and after reopening. Native dialog focus, Escape, return focus, reason validation, visible no-write feedback and cancel are exercised. Page-switch controls only select design boards. |
| Same-form sweep | Runtime checks iterate every board, measuring document/table overflow, shell origin and dimensions. Empty/loading/error/disabled invariants are checked at runtime. Shared click handling is exercised across all pages. |
| Invariants | H-domain orange remains distinct from brand/success; V5 light/dark tokens remain source-derived. Both currency fixtures and device rewards are separate. Unknown data stays unknown. Policies not approved in the disabled fixture prevent publication. |
| Runtime regression | Current export runs all boards with zero page errors and zero HTTP requests. Author visually inspected representative normal/list/configuration/publication/ledger/long/narrow/light/modal/blocked screenshots. This is not independent pixel comparison with product runtime. |

The six anti-self-deception questions were applied with this boundary: the design export and specimen interactions are runtime-proven; product API/state/financial execution, full-product routes and native APP are not tested here. The source was read and local screenshots inspected. A positive design render report does not imply client implementation acceptance.

## Adversarial findings closed during author review

1. The generic navigation selector also matched `body[data-screen]`, causing modal clicks to navigate. It now only matches button/link navigation, with a runnable all-page actual-modal-trigger check.
2. Empty date inputs still displayed sample UTC conversions. The empty state now explicitly says unconfigured and waits for entered dates.
3. Some long boards changed only the state label. Shared table long-field fixtures now exercise real wrapping; the first-column note width is capped so other columns remain readable.
4. Viewport-bound modal backdrops were exported as full-page captures, exposing undimmed content below the viewport. Modal exports are now viewport-only and recorded as such.
5. One candidate-version sample changed a reward amount inconsistently with the rule table. The difference now illustrates a per-order group cap from 1 to 2, matching the candidate rule table.
6. Read-only state incorrectly disabled search filters along with editable controls. Only configuration form controls are disabled; read-only filters remain operable.

7. Independent rereview found that three row editors shared hardcoded SKU/group defaults. Table and editor now share complete per-rule fixtures; twelve actual-row tests check SKU, quantity, beneficiary, reward/reference and caps before/after confirmation and after reopening.

## Remaining acceptance boundaries

- Initial independent review found three P1 and two P2 coverage gaps. The v2 rereview marked four findings PASS and retained PC-RR-01 (row editor identity/caps). The v3 repair and 12 new actual-row checks are documented in REVIEW-FIXES.md; independent closure of PC-RR-01 remains pending. This self-review must not be renamed as an independent report.
- S7 requires two different independent reviewers comparing actual product runtime with this frozen design, per the implementation contract. Neither review exists in this artifact package.
- Product implementation must supply real approved policy/rights/RBAC references and real API results. The HTML does not compute rewards, create orders, reserve budgets, mutate assets or simulate successful writes.
- English/Vietnamese rendered product content, complete translations, live source semantics, native platform behavior, real permissions and real service error recovery remain product acceptance work.
- Existing token contrast is inherited, not certified as a full accessibility audit. The design checker verifies focus, native modal semantics, no horizontal overflow and reduced-transparency fallback only.
- No repository-wide product build/verify was run for these standalone documents. No TSX/API/product file was changed, and no commit or push was made by this owner.

本轮已把 PC 九个设计面和各态固化为可重复导出的基准；离线设计检查通过，真实功能与独立像素验收仍待后续阶段，不需要新增业务政策拍板。
