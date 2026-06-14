# Admin Global List Capability Runtime Evidence

Spec: `docs/remediation/specs/SPEC-L2d02-admin-global-list-capability.md`  
Ledger: `INIT-003`

## Runtime Coverage

All admin runtime shards were recaptured after the section-scoped table scanner and explicit small-table exemptions were added.

| Shard | Routes | Captured | Errors |
|---|---:|---:|---:|
| AD-01 | 5 | 5 | 0 |
| AD-02 | 11 | 11 | 0 |
| AD-03 | 6 | 6 | 0 |
| AD-04 | 12 | 12 | 0 |
| AD-05 | 5 | 5 | 0 |
| AD-06 | 5 | 5 | 0 |
| AD-07 | 7 | 7 | 0 |
| AD-08 | 6 | 6 | 0 |
| AD-09 | 8 | 8 | 0 |
| AD-10 | 4 | 4 | 0 |
| AD-11 | 6 | 6 | 0 |
| AD-12 | 5 | 5 | 0 |
| AD-13 | 1 | 1 | 0 |

Total: 66 / 66 captured, 0 errors.

## Audit Results

`node scripts/admin-list-capability-global-audit.mjs`

```json
{
  "status": "passed",
  "adminRoutesSeen": 66,
  "tableRoutes": 38,
  "blockerCount": 0,
  "warningCount": 0,
  "invalidExemptionCount": 0,
  "findings": [],
  "warnings": [],
  "invalidExemptions": []
}
```

`node scripts/admin-list-capability-audit.mjs --runtime`

```json
{
  "status": "passed",
  "checkedRequired": 8,
  "runtimeStrict": true,
  "unexemptedP1": 0,
  "failures": []
}
```

## Verification

- `npx --no-install tsc --noEmit`: PASS.
- `npm run verify`: PASS, 144 checks / 0 failed.
- `npm run build`: PASS.

## Notes

- The runtime scanner now checks each table against section-local pagers first.
- Route-level exemptions are accepted only when the exemption label matches the table label or section title and the declared max rows cover the table row count.
- Exemption kinds are bounded: `static-small <= 5`, `sample-ledger <= 12`, `reference-catalog <= 20`, `fixed-matrix <= 24`.
