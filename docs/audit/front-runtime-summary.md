# Front Runtime Route Summary

Generated at: 2026-06-12T19:03:06+08:00

## Scope

- Source B / Next reference route crawl: `NEXT-FR-01` to `NEXT-FR-10`.
- Source E / UniApp H5 route crawl: `UNI-FR-01` to `UNI-FR-10`.
- Audit state is seeded before each route: authenticated session, onboarding complete, and sample order `ORD-AUDIT-0001`.
- Dynamic route samples are fixed to real audit values: `stellarbox-s1`, `ORD-AUDIT-0001`, `NX-DEMO`, and `0xdemo`; UniApp detail/order-detail routes use query samples.

## Results

| Side | Unique routes | Captures | Route errors | Script errors | Evidence |
|---|---:|---:|---:|---:|---|
| Next reference | 80 | 81 | 0 | 0 | `docs/audit/shards/next-fr-*-runtime.ndjson` |
| UniApp H5 | 81 | 82 | 0 | 0 | `docs/audit/shards/uni-fr-*-runtime.ndjson` |
| Total | 161 | 163 | 0 | 0 | `docs/audit/screenshots/next-fr-*`, `docs/audit/screenshots/uni-fr-*` |

## Notes

- The first unauthenticated Next crawl redirected target pages to `/onboarding/intro`; the crawler now seeds auth/onboarding state before route capture.
- Route-level crawl proves the pages render, match the expected route, and have no runtime route/script errors in this pass.
- This is not yet task completion proof. Source B task walkthroughs and front action persistence checks still need to prove user-facing operations can be completed end to end.
- UniApp H5 has a likely semantic interaction risk: many visible controls are rendered as `uni-view` / `uni-text`, so the accessibility snapshot reports no interactive elements on many pages even when DOM heuristics find clickable controls. Action sampling must decide whether this is only an audit-accessibility issue or a real usability/accessibility defect.

## Action Sampling Checkpoint

- Representative action sampling completed for `NEXT-FR-01` to `NEXT-FR-10` and `UNI-FR-01` to `UNI-FR-10`.
- Evidence: `docs/audit/shards/*-front-action-sample.ndjson`.
- Samples: 187 actions across 98 routes with 0 click-target-missing after sampler tightening.
- Ledger impact: `FR-001` to `FR-013` added, including one P0 flow break for UniApp checkout.
- Remaining: full persona task walkthroughs and Source C frontend-admin可操作性 mapping.
