# SPEC-L2b05 Next Reference Logic Runtime Evidence

Generated at: 2026-06-12T23:05:50+08:00

## Scope

- Spec: `docs/remediation/specs/SPEC-L2b05-next-reference-logic-dead-controls.md`
- Reference app: `D:\WORKS\PLAN\Nexion-prototype`
- Admin evidence root: `D:\WORKS\PLAN\Nexion-admin-prototype`
- Target defects: `INIT-001`, `INIT-005`, `INIT-006`, `SD-001`, `SD-002`, `SD-003`, `FR-001`, `FR-002`, `FR-008`

## Code-Level Fix Summary

- Removed visible internal launch-stage labels from reference source phase copy; visible replay/home controls now use user-facing launch-stage labels.
- Replaced dead `href="#"` controls in Trust, NEX wallet, and referral legal links with real routes, functional buttons, or explicit unavailable states.
- Converted Learn lesson cards from dead anchors to lesson sheet buttons with progress, reward, completion, and close controls.
- Fixed a runtime UX blocker found during browser proof: the Learn sheet originally rendered inside the page scroll layer and its `Mark complete` button was intercepted by the bottom tab bar. The sheet now renders through a top-level portal with phone-frame width and safe-area bottom padding.
- Store product review CTA now expands a review center summary instead of doing nothing.
- Added i18n mirror guard and dead-anchor/phase-label guards to `scripts/verify.sh`.

## Machine Validation

| Check | Result |
|---|---|
| `npx --no-install tsc --noEmit` | PASS |
| `npm run build` | PASS |
| `node scripts\i18n-key-mirror.mjs` | PASS: `3542 keys` |
| `bash -lc 'node scripts/i18n-key-mirror.mjs'` | PASS: `3542 keys` |
| `node scripts\interaction-audit.mjs` | PASS: 0 findings |
| `rg -n 'href="#"\|href=''#''' app lib` | PASS: 0 matches |
| `bash -lc 'BASE_URL=http://172.17.192.1:3001 bash scripts/verify.sh all'` | PASS: `230 passed, 0 failed` |

## Action Samplers

| Shard | Result |
|---|---|
| `NEXT-FR-01` | PASS: routes=7, samples=11, errors=0, noObservableChange=0, hashOnlyNoContent=0 |
| `NEXT-FR-03` | PASS: routes=6, samples=7, errors=0, noObservableChange=0, hashOnlyNoContent=0 |
| `NEXT-FR-09` | PASS: routes=3, samples=7, errors=0, noObservableChange=0, modalOrSheet=3, stateWrite=2 |
| `UNI-FR-03` | PASS: routes=6, samples=6, errors=0, noObservableChange=0 |

## Browser Runtime Proof

Real browser proof used `http://localhost:3001` with `nexion-auth-v1` seeded to an authenticated/onboarded prototype session.

| Route | User Action | Runtime Proof |
|---|---|---|
| `/trust` | Click `Sarah Park` leadership card | Opens `Sarah Park profile opened` panel with role, previous company, and Trust Center profile text |
| `/trust` | Click `TechCrunch` press card | Opens `Press brief opened in Trust Center` panel |
| `/trust` | Click Q3 report button | Opens `Q3 2026 report preview opened` panel with financial metrics including `MRR` |
| `/store/stellarbox-s1` | Click `Read all 2,847 reviews` | Expands `Review center open` summary with full verified review set description |
| `/learn` | Click lesson card, then `Mark complete`, then close sheet | Sheet contains actionable completion and close controls; `Mark complete` changes state to `Reward queued`; close leaves `remainingDialogs=0`; button bounding box after portal fix: `{x:459,y:634,width:362,height:48}` |
| `/me/wallet/nex` | Inspect Donate use tile | Shows explicit unavailable state: `Grant pool opens after the next community vote`; page has `a[href="#"]` count 0 |

Browser result: `errors=[]`.

## Sentinel Coverage

- `scripts/verify.sh [1.6] Reference dead-anchor guard`
- `scripts/verify.sh [1.7] Internal phase-label leak guard`
- `scripts/verify.sh [1.8] i18n mirror guard`
- `scripts/i18n-key-mirror.mjs`
- `scripts/interaction-audit.mjs`
- Runtime action samplers: `NEXT-FR-01`, `NEXT-FR-03`, `NEXT-FR-09`, `UNI-FR-03`
