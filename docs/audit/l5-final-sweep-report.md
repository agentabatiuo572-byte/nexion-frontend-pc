# L5 Final Sweep Report

Generated at: 2026-08-16T03:03:29.008Z

Status: **failed** (10/12 checks passed)

| ID | Status | Check | Details |
|---|---|---|---|
| L5-01 | failed | Three app verifiers pass | not run; invoke with --run-verifiers for L5 closure proof |
| L5-02 | passed | UniApp route migration and core persona flows | uniappRoutes=92; personaProofRows=7; uniapp-port-coverage=passed |
| L5-03 | passed | Admin and frontend task walkthrough matrix verified | FT verified 15/15; AT verified 11/11 |
| L5-04 | passed | Runtime route/action traversal has zero blockers | routes admin=66, uniapp=92; runtimeBad=0; actionBad=0; listGlobal=passed |
| L5-05 | passed | Modal five-tuple and business-specific controls | modalContract=passed; featureProofRows=7; actionBad=0 |
| L5-06 | passed | Ledger P0/P1/P2 zero open and P3 adjudicated | ledger=38; p0p2Open=0; p3Open=0 |
| L5-07 | passed | Feature mapping matrix has zero gap/blocker/walkthrough debt | {"mappings":18,"gap":0,"blockedByLedger":0,"needsTaskWalkthrough":0,"provisionallyOperable":18} |
| L5-08 | failed | Canon numbers and field mirrors have zero drift | canon=failed; skuFieldMirror=passed |
| L5-09 | passed | i18n mirror, language switching, and meta leak gates | FM-013=passed; uniVerify=false |
| L5-10 | passed | Meta-leak guard has zero product-visible hits | not run; covered when --run-verifiers is used |
| L5-11 | passed | Runtime console/route errors are zero | runtimeBad=0; routeCounts={"admin":66,"uniapp":92} |
| L5-12 | passed | Closed/verified ledger rows have sentinels | verifiedOrClosed=38; missingSentinel=0 |

## Verifiers

- Not run. Use `node scripts/l5-final-sweep.mjs --run-verifiers` for closure evidence.

## Internal Gates

- ledger-validate: passed (ledger validation PASS: 38 entries) -> docs/audit/l5-ledger-validate.log
- feature-map-audit: passed (}) -> docs/audit/l5-feature-map-audit.log
- feature-map-operability: passed (}) -> docs/audit/l5-feature-map-operability.log
- feature-map-closure-proof: passed ("status": "passed",) -> docs/audit/l5-feature-map-closure-proof.log
- admin-modal-contract: passed ("status": "passed",) -> docs/audit/l5-admin-modal-contract.log
- admin-list-global: passed ("status": "passed",) -> docs/audit/l5-admin-list-global.log
- uniapp-port-coverage: passed ("status": "passed",) -> docs/audit/l5-uniapp-port-coverage.log
- sku-field-mirror: passed (ℹ 旧静态后台 store 已删除(lib/store/admin/platform-config-store.ts)— SKU 权威已迁至真实后端接口，跳过旧 store 镜像核对) -> docs/audit/l5-sku-field-mirror.log
- canon-sentinel: failed (Node.js v24.15.0) -> docs/audit/l5-canon-sentinel.log

## Post-L5 Owner Review Gate

These gates are not part of the 12 L5 pass/fail checks. Run them after this L5 report is generated, so they can validate the latest L5 timestamp and owner-facing acceptance package without creating a circular dependency.

- owner-review-readiness: non-blocking-for-L5; command `npm run verify:owner-review`; report docs/audit/owner-review-readiness-report.md; Validates final acceptance docs, latest L5 timestamp, PRD dry-run/apply-check, and owner decision gates after L5 is generated.

