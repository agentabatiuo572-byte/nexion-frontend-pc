# UniApp Full-Route Batch Audit Evidence

Generated: 2026-06-13T11:58:00+08:00

## Scope

- Ledger item: `INIT-008`
- Spec: `docs/remediation/specs/SPEC-L3c01-uniapp-full-route-batch-audit.md`
- UniApp H5 base: `http://localhost:5173`
- Route shards: `UNI-FR-01` to `UNI-FR-10`
- Action shards: `UNI-FR-01` to `UNI-FR-10`

## Static Mapping Gate

Command:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
node scripts\uniapp-port-coverage-audit.mjs
```

Result:

```json
{
  "status": "passed",
  "nextRoutes": 80,
  "uniPages": 81,
  "mappedRoutes": 80,
  "extraUniRoutes": ["/#/pages/onboarding/terms"],
  "expectedExtraUniRoutes": ["/#/pages/onboarding/terms"],
  "missingUniVueFiles": 0,
  "runtimeRows": 82,
  "runtimeCaptured": 82,
  "actionRows": 86,
  "blockingActionSamples": 0,
  "findings": []
}
```

Interpretation:

- All 80 Next reference routes have a mapped UniApp H5 route.
- UniApp has 81 pages; the only allowed net-new route is `/#/pages/onboarding/terms`.
- Every `src/pages.json` route has a corresponding `.vue` file.

## Runtime Route Crawl

Command:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
$env:UNI_BASE_URL='http://localhost:5173'
foreach ($i in 1..10) {
  $id = ('UNI-FR-{0:D2}' -f $i)
  node scripts\remediation-runtime-front-shard.mjs $id
}
```

Summary:

| Shard | Routes | Captured | Route Errors | Script Errors |
|---|---:|---:|---:|---:|
| UNI-FR-01 | 7 | 7 | 0 | 0 |
| UNI-FR-02 | 7 | 7 | 0 | 0 |
| UNI-FR-03 | 6 | 6 | 0 | 0 |
| UNI-FR-04 | 3 | 3 | 0 | 0 |
| UNI-FR-05 | 15 | 15 | 0 | 0 |
| UNI-FR-06 | 11 | 11 | 0 | 0 |
| UNI-FR-07 | 16 | 16 | 0 | 0 |
| UNI-FR-08 | 6 | 6 | 0 | 0 |
| UNI-FR-09 | 3 | 3 | 0 | 0 |
| UNI-FR-10 | 8 | 8 | 0 | 0 |
| Total | 82 | 82 | 0 | 0 |

Evidence files:

- `docs/audit/shards/uni-fr-01-runtime.ndjson`
- `docs/audit/shards/uni-fr-02-runtime.ndjson`
- `docs/audit/shards/uni-fr-03-runtime.ndjson`
- `docs/audit/shards/uni-fr-04-runtime.ndjson`
- `docs/audit/shards/uni-fr-05-runtime.ndjson`
- `docs/audit/shards/uni-fr-06-runtime.ndjson`
- `docs/audit/shards/uni-fr-07-runtime.ndjson`
- `docs/audit/shards/uni-fr-08-runtime.ndjson`
- `docs/audit/shards/uni-fr-09-runtime.ndjson`
- `docs/audit/shards/uni-fr-10-runtime.ndjson`

## Front Action Sampler

Command:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
$env:UNI_BASE_URL='http://localhost:5173'
$env:FRONT_ACTION_SAMPLE_LIMIT='4'
foreach ($i in 1..10) {
  $id = ('UNI-FR-{0:D2}' -f $i)
  node scripts\remediation-runtime-front-action-sample.mjs $id
}
```

Final summary after sampler tightening:

| Shard | Routes | Samples | Sampled | Errors | No Observable | Click Missing | Hash-Only |
|---|---:|---:|---:|---:|---:|---:|---:|
| UNI-FR-01 | 7 | 13 | 13 | 0 | 0 | 0 | 0 |
| UNI-FR-02 | 7 | 3 | 3 | 0 | 0 | 0 | 0 |
| UNI-FR-03 | 6 | 7 | 7 | 0 | 0 | 0 | 0 |
| UNI-FR-04 | 3 | 4 | 4 | 0 | 0 | 0 | 0 |
| UNI-FR-05 | 15 | 15 | 15 | 0 | 0 | 0 | 0 |
| UNI-FR-06 | 11 | 15 | 15 | 0 | 0 | 0 | 0 |
| UNI-FR-07 | 16 | 6 | 6 | 0 | 0 | 0 | 0 |
| UNI-FR-08 | 6 | 10 | 10 | 0 | 0 | 0 | 0 |
| UNI-FR-09 | 3 | 4 | 4 | 0 | 0 | 0 | 0 |
| UNI-FR-10 | 8 | 9 | 9 | 0 | 0 | 0 | 0 |
| Total | 82 | 86 | 86 | 0 | 0 | 0 | 0 |

Sampler tightening:

- `Sign in` is now treated as a real UniApp action.
- `Start your streak today`, `Withdrawal pending ...`, `Resets in ...`, and `Ready to claim` are filtered as explanatory/status text, not business actions.

## UniApp Verify

Command:

```powershell
cd D:\WORKS\PLAN\Nexion-uniapp
bash scripts/verify.sh
```

Result:

- `vue-tsc 0 errors`
- H5 route probe: `Home shell [200] /`
- Grep/source sentinels: pass
- Final: `15 pass, 0 fail`

Note:

- `scripts/verify.sh` now uses `curl.exe` when run under WSL with Windows curl available, preventing a false `SKIP dev server not running` when the Windows H5 server is actually online.
