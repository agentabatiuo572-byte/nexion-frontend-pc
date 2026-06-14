# Front Runtime Action Sample Summary

Generated at: 2026-06-12T19:47:00+08:00

## Scope

- Source B / Next reference action sampling: `NEXT-FR-01` to `NEXT-FR-10`.
- Source E / UniApp H5 action sampling: `UNI-FR-01` to `UNI-FR-10`.
- This is representative action sampling, not exhaustive persona task walkthrough. Each route samples the first bounded set of business-action candidates after runtime filtering.

## Results

| Metric | Count |
|---|---:|
| Action evidence files | 20 |
| Routes with sampled action candidates | 98 |
| Runtime action samples | 187 |
| `route-navigation` | 63 |
| `observable-change` | 26 |
| `state-write` | 14 |
| `body-only-change` | 19 |
| `hash-only-no-content` | 1 |
| `no-observable-change` | 64 |
| `click-target-missing` | 0 |

## Ledger Entries

| ID | Severity | Side | Issue |
|---|---|---|---|
| `FR-001` | P1 | frontend | `/trust` profile card changes only to `#` with no content. |
| `FR-002` | P1 | cross | Product-detail review CTA does not open reviews in sampled front experiences. |
| `FR-003` | P0 | uniapp | UniApp checkout `Continue` does not advance payment flow. |
| `FR-004` | P1 | uniapp | Empty orders `Browse Store` CTA does nothing. |
| `FR-005` | P1 | uniapp | Default-card toggle has no observable effect. |
| `FR-006` | P1 | uniapp | Empty withdrawal-tracking `Submit a new withdrawal` CTA does nothing. |
| `FR-007` | P1 | uniapp | Transaction `Copy hash` has no feedback or state change. |
| `FR-008` | P1 | frontend | Learn article cards are `href="#"` dead controls. |
| `FR-009` | P1 | uniapp | Support entry CTAs do nothing. |
| `FR-010` | P1 | uniapp | Profile `Save Changes` has no observable effect. |
| `FR-011` | P1 | uniapp | `Claim trial` CTAs do nothing. |
| `FR-012` | P1 | uniapp | Team incentive CTAs do not route or submit. |
| `FR-013` | P1 | uniapp | External/deep-link CTAs have no response. |

## Notes

- The sampler was tightened during this pass to avoid false positives from generic page containers and text cards.
- UniApp H5 still has a structural risk: many actionable UI elements are `uni-view` / `uni-text` rather than semantic buttons or links. The action sampler now handles these for runtime evidence, but product implementation should still fix semantic operability and accessibility in L2/L3.
- `body-only-change` is intentionally separated from strong success. It often indicates progress text, copy feedback, or accordions, but it can also hide weak feedback; those samples need task-walkthrough confirmation before closure.
