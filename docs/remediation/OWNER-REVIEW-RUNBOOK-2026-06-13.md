# Owner Review Runbook - 2026-06-13

> 状态: ready-for-owner-review
> 边界: 本 runbook 只整理验收入口与证据,不写入 `D:\WORKS\PLAN\PRD\...` canonical PRD。

## 1. 当前机器结论

最新 L5 终验已经通过:

| Gate | Result |
|---|---|
| L5 final sweep | `12/12 passed` |
| Admin verify | `148 checks, 0 failed` |
| Next reference verify | `230 passed, 0 failed` |
| UniApp verify | `16 pass, 0 fail` |
| Admin route count | `66` |
| Next reference route count | `80` |
| UniApp route count | `81` |
| Runtime/action blockers | `runtimeBad=0`, `actionBad=0` |
| Ledger | `P0/P1/P2/P3 open=0` |
| Feature mapping | `18/18`, `gap=0`, `blocked=0`, `needsTaskWalkthrough=0` |

Authoritative report:

- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-final-sweep-report.md`
- `D:\WORKS\PLAN\Nexion-admin-prototype\docs\audit\l5-final-sweep-report.json`

## 2. Start Targets

Open three terminals if live review is needed.

### Admin Console

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
npm run dev
```

URL:

- `http://localhost:3002`

### UniApp H5

```powershell
cd D:\WORKS\PLAN\Nexion-uniapp
npm run dev:h5
```

Default URL:

- `http://localhost:5173`

If Vite picks another port, use that printed URL. For scripted checks, set `UNI_BASE_URL` to the actual H5 URL.

### Next Reference

The delivery target is UniApp. Next is kept as the behavior reference source.

```powershell
cd D:\WORKS\PLAN\Nexion-prototype
npm run dev -- -p 3001
```

URL:

- `http://localhost:3001`

## 3. Owner Review Routes

These routes are the fastest manual review path for the exact problems that triggered the remediation.

| Concern | Surface | What To Check |
|---|---|---|
| Admin modal is not a prop dialog | `http://localhost:3002/platform/rbac` | Change role modal has role/tier controls, reason guard, diff preview, persist evidence |
| Content/i18n modal can edit real business content | `http://localhost:3002/content/i18n` | zh/en text fields, placeholder guard, repair action, persisted draft |
| Device destructive action is business-specific | `http://localhost:3002/devices/pricing` | delete/down-rank requires rollback, impact acknowledgement, audit reason |
| Support frontend has admin control surface | `http://localhost:3002/content/support` | FAQ create, ticket reply, ticket close all persist |
| Staking admin controls frontend product module | `http://localhost:3002/finance-products/staking` | APY/status modal has target value, business rule, reason, audit write |
| Admin lists have table baseline | Any data list route | search/filter/sort/pager or explicit small-table exemption |
| UniApp checkout is not fake-write | `http://localhost:5173/#/pages/store/checkout?product=stellarbox-s1` | payment flow writes order and bill, order detail reachable |
| UniApp withdrawal flow is complete | `http://localhost:5173/#/pages/me/wallet-withdraw` | amount/address input, KYC gate, tracking state, points/bill write |
| UniApp exchange/repurchase are actionable | `http://localhost:5173/#/pages/me/wallet-exchange` and `/#/pages/me/wallet-repurchase` | modal business content, swap/repurchase history, bills/stake write |
| Team finance pages exist and route | `http://localhost:5173/#/pages/team/team` | commission, V Rank, Balance Match, Leadership Pool entries render business content |
| Help/support task is closed | `http://localhost:5173/#/pages/me/support` | support CTA creates/reaches ticket workflow |

## 4. Evidence Map

| Evidence | File |
|---|---|
| Final acceptance packet | `docs/remediation/FINAL-ACCEPTANCE-PACKET-2026-06-13.md` |
| L5 final machine report | `docs/audit/l5-final-sweep-report.md` |
| User/admin task matrix | `docs/audit/task-walkthrough-matrix.md` |
| Feature mapping walkthrough proof | `docs/audit/feature-mapping-walkthrough-runtime-evidence.md` |
| Admin modal business controls | `docs/audit/admin-modal-contract-runtime-evidence.md` |
| RBAC/device modal proof | `docs/audit/admin-rbac-device-modal-runtime-evidence.md` |
| Content/i18n modal proof | `docs/audit/admin-content-business-modal-runtime-evidence.md` |
| Admin global list proof | `docs/audit/admin-global-list-capability-runtime-evidence.md` |
| UniApp full route proof | `docs/audit/uniapp-full-route-batch-audit-evidence.md` |
| UniApp persona proof | `docs/audit/uniapp-persona-walkthrough-runtime-evidence.md` |

## 5. Verification Commands

Run from `D:\WORKS\PLAN\Nexion-admin-prototype`.

Recommended order:

1. Prefer the guarded preflight command. It runs PRD apply-check, L5, final-packet timestamp refresh, owner-review readiness, and a non-mutating PRD guard.
2. Run the individual commands below only when debugging a failed step.

Guarded non-mutating preflight:

```powershell
npm run remediation:preflight
```

Expected result:

- `status=passed`
- `mode=preflight-non-mutating`
- `completion-status=passed`
- `prdFilesChanged=false`

Optional live preflight after dev servers are running:

```powershell
npm run remediation:preflight:live
```

Full regression proof:

```powershell
node scripts\l5-final-sweep.mjs --run-verifiers
```

Expected result:

- `status=passed`
- `checksPassed=12`
- `checksFailed=0`

Owner-review readiness:

```powershell
npm run verify:owner-review
```

Expected result:

- `status=passed`
- `checksPassed=8`
- `checksFailed=0`

The generated readiness report is:

- `docs/audit/owner-review-readiness-report.md`
- `docs/audit/owner-review-readiness-report.json`

Optional live URL readiness, after dev servers are running:

```powershell
npm run verify:owner-review:live
```

Expected result:

- `status=passed`
- `checksPassed=9`
- `checksFailed=0`

The generated live report is:

- `docs/audit/owner-review-readiness-live-report.md`
- `docs/audit/owner-review-readiness-live-report.json`

Default live targets use `http://localhost:3002`, `http://localhost:3001`, and `http://localhost:5173`. If a dev server uses a different port, set `ADMIN_BASE_URL`, `NEXT_BASE_URL`, or `UNI_BASE_URL` before running the live gate.

PRD sync dry-run, still without writing canonical PRDs:

```powershell
node scripts\prd-sync-l5-draft.mjs --patch-file=docs\remediation\PRD-SYNC-PREVIEW-2026-06-13.patch --apply-check --json
```

Expected result:

- `operations=23`
- `planned=23` before PRD sync, or `alreadyPresent=23` after confirmed PRD sync
- `missingAnchors=0`
- `applyCheck=passed` before sync, or `applyCheck=not-needed` after all 23 operations are already present

Overall completion status:

```powershell
npm run remediation:status
```

Expected result before PRD sync and owner acceptance:

- `status=pending-owner-gates`
- Remaining gates include canonical PRD sync and owner product acceptance

After PRD sync and explicit owner product acceptance, the acceptance marker can be recorded only with:

```powershell
node scripts\remediation-completion-status.mjs --record-owner-acceptance --owner-confirmed
```

## 6. Remaining Hard Gates

| Gate | Status | Required Action |
|---|---|---|
| Canonical PRD sync | applied-with-owner-confirmation | 已按主人确认执行 `node scripts\remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed`;后续只保留 owner product acceptance gate |
| Owner product acceptance | accepted-by-owner | 主人已明确接受最终产品验收 |

No agent should mark the overall remediation goal complete until both gates are closed and the guarded finalizer has rerun L5 after PRD sync.
