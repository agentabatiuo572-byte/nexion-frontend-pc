# PC design revision v3 — response to independent findings

Author: `growth_pc_design`. This is a repair report, not an independent approval. The previous `99476b0...` candidate failed independent review. The five findings below were treated as coverage failures and checked against the original ADMIN PRD fields and actions.

Current design SHA-256: `900f5336c19b4fa5830591e4c4ad220d0f9980516c56b06d510609693b809596`.

Checker SHA-256: `bb7ec537bb764e6e393b95532b17ee93c8af19c27457af008d4010920445be03`.

Current run: `node docs/design/growth-promotions/admin-r1-baseline-check.mjs --freeze --export` → PASS. `export-report.json` binds the design/checker hashes and captures: 216 base boards, 96 normal modal boards, 28 approval/lifecycle boards, 44 failure modal boards, 2 reduced-transparency boards, 12 actual-row editor captures, and 40 additional scrolled modal boards = **438 PNG captures**. Page errors 0; HTTP requests 0. The scroll position and modal geometry are recorded per capture.

| Finding | Repair (v2 source line references are historical) | Runtime evidence | Screenshot examples |
|---|---|---|---|
| P1 Reward editor incomplete | `admin-r1-baseline.html:124–135`: DEVICE editor includes gift SKU, positive quantity and approved rights reference; USDT/NEX include exact amount and separate asset policy. Common fields include trigger quantity, calculation mode, per-order groups and per-person groups. Direct invitation has two independent beneficiary fieldsets. Combination has two SKU/quantity pairs. | Original v2 checker lines 160–174 assert field presence; change the buyer to NEX, confirm clearing only that section, and verify the inviter's amount is unchanged. Both combination purchase controls and quantities are checked. | [DEVICE](ADM04-modal-rule-dark-1440.png), [USDT](ADM04-modal-rule-usdt-dark-1440.png), [NEX](ADM04-modal-rule-nex-dark-1440.png), [dual recipients](ADM04-modal-dual-dark-1440.png), [combination](ADM04-modal-combination-dark-1440.png), [combination lower content](ADM04-modal-combination-dark-1440-bottom.png) |
| P1 Budget dialog had no inputs | `admin-r1-baseline.html:136`: editable USDT/NEX totals plus separate gift B/C integer quotas; read-only committed/reserved amounts; explicit field error fixture below current occupied amount. No JS budget calculation is introduced. | Original v2 checker lines 175–182 assert all four controls, occupied facts, the invalid-field marker and retained value after failed confirmation and original-command lookup. | [budget](ADM05-modal-budget-dark-1440.png), [field error](ADM05-modal-budget-error-dark-1440.png) |
| P1 Lifecycle and reward disposition surfaces missing | `admin-r1-baseline.html:66–81,103–118,137–151`: draft submit; pending withdraw/reject/approve; approved independent publish. Active pause/end; paused resume/end; ended archive only with explicit zero unresolved fixture; archived history stays read-only. Pending cancel, issued reverse and manual-review adjudication have immutable original promise, impact, linked evidence choices, required reason and failure/unknown exits. | All phase-board available actions are actually clicked. Original v2 checker lines 183–191 require reason and at least one evidence selection for cancel/reverse/adjudicate, forbid amount editing, and prove command lookup preserves reason/evidence. Phase checks verify the correct action for each state. | [submit](ADM06-phase-draft-dark-1440.png), [pending review](ADM06-phase-pending-dark-1440.png), [paused/resume](ADM07-phase-paused-dark-1440.png), [ended/archive](ADM07-phase-ended-dark-1440.png), [cancel](ADM08-modal-cancel-reward-dark-1440.png), [reverse failure](ADM08-modal-reverse-reward-error-dark-1440.png), [adjudicate](ADM08-modal-adjudicate-dark-1280.png) |
| P2 Disabled reward rows remained editable | `admin-r1-baseline.html:30–31,151`: shared write-action set disables every reward editor and mutation trigger; direct modal query also disables its controls and confirm. Read-only queries stay usable. | Original v2 checker lines 192–195 verify all three edit buttons are disabled, force actual pointer clicks and assert no dialog opens; direct disabled modal paths for all editors have zero enabled input/select/textarea controls. | [disabled rule table](ADM04-disabled-dark-1280.png) |
| P2 Repurchase and rank controls missing | `admin-r1-baseline.html:59–64,161–162`: separate positive integer controls for minimum purchase interval and inactivity days; V0–V12 checkboxes from current F-domain catalog; alternate bounded rank selectors. Changing conditions marks the old preview stale. | Original v2 checker lines 196–199 asserts 13 rank checkboxes, both interval values, switches to rank range, chooses V2–V5 and checks stale-preview feedback. Source catalog hashes are included in the manifest. | [repurchase and rank collection](ADM03-normal-light-1280.png) |

The page fixture is not an order/reward evaluator. `phase` selects an approval or lifecycle specimen; `modalState=error` selects a fixed failure specimen. Existing `screen`, `state`, `theme` and modal queries remain supported. Studio phase selectors are hidden from exported artboards, and their actual selected states remain recorded in capture URLs and manifest coverage.

## Additional root-cause checks during repair

- Field labels now have dedicated accessible names and separate help descriptions. Long select option lists no longer pollute the field's accessible label.
- Changing a beneficiary reward type first requests confirmation, clears only that beneficiary's incompatible fields, and provides a keep-original option.
- Original-command lookup inside a failed form uses an in-place result, preserving amount, reason and selected evidence. It does not replace the form with an unrelated dialog or create a new command.
- Modal content that exceeds the fixed viewport gets a separately recorded lower-content capture. It is not stretched or clipped into a false full-page overlay.
- The author visually inspected the updated dual-recipient editor, budget field error, paused lifecycle, repurchase/rank screen, combination form, and adjudication dialog at the recorded viewport sizes.

## PC-RR-01: preserve the clicked rule through the shared editor

The independent rereview at `C:/Users/jason/.codex/workflow-runs/growth-promotions-20261007/pc-design-rereview.md` reported four of the original five findings PASS and one remaining P1: the reward fields existed, but Orbit Hub and Quantum Node still inherited StellarBox S1's purchase selector and common group caps.

- Current source `admin-r1-baseline.html:49` defines three complete fixed rule fixtures. Both `ruleRows` (line 54) and `ruleEditor` (line 135) resolve the same key. Purchase SKU/quantity, repeat mode, beneficiary, reward type/quantity or amount, approved reference, and both group caps flow through that fixture.
- `rewardFields` (line 130) and `beneficiary` (line 134) receive the selected rule's reward. The original two-beneficiary type-change behavior is retained.
- Current checker `admin-r1-baseline-check.mjs:160` separately declares expected table/form values. It clicks every table-row Edit button at both widths and themes, compares all fields, confirms without changes, verifies no field changed, closes, compares the table, and reopens the same rule. All **12 cases PASS**. This is actual row-trigger coverage, not direct-modal-only coverage.
- `export-report.json` records all 12 `ruleBindingChecks`, including the displayed row, form values, theme, viewport, unchanged confirmation and reopen result.
- Visual inspection used the actual-row captures [Orbit Hub / USDT / 1440 dark](ADM04-row-rule-usdt-dark-1440.png) and [Quantum Node / NEX / 1280 light](ADM04-row-rule-nex-light-1280.png). Orbit Hub remains 20.000000 USDT with 2 / 2 group caps. Quantum Node remains 1000.000000 NEX with 1 / 1 group caps.

This is the author's repair and runtime evidence. Independent closure of PC-RR-01 is still required.

## Remaining gates

The new candidate requires the independent reviewer's own reread and runtime review. No independent PASS is asserted here. S7's two independent product-versus-design pixel reviews remain entirely separate. No TSX, API, production policy or product state was changed; no commit or push was made by this owner.

本轮按五项审查意见补齐了设计表单和状态处置，438 张固定画板及对应交互检查通过；最终是否关闭 findings 由主线回源和独立复审确认。
