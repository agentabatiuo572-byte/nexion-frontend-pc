# UniApp Wallet Actions Runtime Evidence

Date: 2026-06-12
Spec: `docs/remediation/specs/SPEC-L2b02-uniapp-wallet-actions.md`
Ledger: `FR-005`, `FR-006`, `FR-007`
H5 target: `http://localhost:5174`

## Machine Gates

- `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check`
  - PASS: `vue-tsc --noEmit`
- `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh`
  - PASS: 14 pass / 0 fail
  - Note: H5 HTTP route check is skipped because the active dev server for this run is `5174`, while the script probes `5173`.
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=3 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-05`
  - PASS: `routes=15`, `samples=16`, `sampled=16`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `routeNavigation=7`, `observableChange=9`
  - Evidence shard: `docs/audit/shards/uni-fr-05-front-action-sample.ndjson`

## Browser Proof

### FR-005: default-card toggle and persistence

Playwright H5 proof:

- Opened `/#/pages/me/wallet-cards-new`.
- Cleared `nexion-cards-v1`, reloaded the page, and used the visible `Set as default payment card` switch.
- OFF case:
  - Before: `aria-checked=true`, body shows `ON`.
  - After toggle: `aria-checked=false`, body shows `OFF`.
  - Submitted a valid card.
  - Storage result: `cards.length=1`, `defaultTokenId=null`.
- ON case:
  - Before: `aria-checked=true`, body shows `ON`.
  - Submitted a valid card.
  - Storage result: `cards.length=1`, `defaultTokenId` equals the saved card token.

Regression found during proof:

- Initial H5 proof exposed a double-write bug because `tap` and `click` both fired on the form submit.
- Added an `isBinding`/`canSubmit` guard in `wallet-cards-new.vue`.
- Re-ran the same proof; both OFF/ON cases now save exactly one card.

### FR-006: empty withdrawal tracking CTA

Playwright H5 proof:

- Opened `/#/pages/me/wallet-withdraw-tracking`.
- Cleared withdrawal-like local storage keys and reloaded to force the empty state.
- Clicked `Submit a new withdrawal`.
- URL changed from `/#/pages/me/wallet-withdraw-tracking?...` to `/#/pages/me/wallet-withdraw`.

### FR-007: transaction hash copy feedback

Playwright H5 proof:

- Opened `/#/pages/tx/hash?hash=0xabc123walletactions...`.
- Clicked the visible `Copy hash` button.
- Page showed `Transaction hash copied`.
- The implementation also exposes a visible failure state: `Copy failed - select the hash manually`.

### Additional wallet action sampled in same shard

The `UNI-FR-05` shard also sampled wallet bill rows. A browser proof confirmed that clicking a bill row routes to the tx hash surface:

- From `/#/pages/me/wallet-bills?...`
- Clicked bill row: `Purchase · NexionBox S1 · ORD-20260612-6021`
- URL changed to `/#/pages/tx/hash?hash=ORD-20260612-6021`

## Same-Shape Scan

- `rg -n "setClipboardData|navigator\.clipboard|copyHash|Copy" src`
  - Confirmed tx hash copy now uses `navigator.clipboard.writeText` first, then `uni.setClipboardData`, with visible success/failure state.
  - Other copy/share surfaces already expose visible copied/toast state or belong to later external/share workstreams; no additional `tx hash` copy dead-control remains in this spec scope.
- `rg -n "setDefault|defaultTokenId|Set as default|formDefaultCheckbox|formDefaultOn|formDefaultOff|makeDefault" src`
  - Confirmed default-card state is visible in the bind form and persisted through `cards.add(..., { makeDefault })`.
- `rg -n "wallet-withdraw|Submit a new withdrawal|goWithdraw|submitNewWithdrawal" src`
  - Confirmed the tracking empty-state CTA routes through `navTo("/pages/me/wallet-withdraw")`.
