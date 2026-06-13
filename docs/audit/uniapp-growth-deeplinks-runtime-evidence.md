# UniApp Growth Deeplinks Runtime Evidence

Date: 2026-06-12
Spec: `docs/remediation/specs/SPEC-L2b04-uniapp-growth-deeplinks.md`
Ledger: `FR-012`, `FR-013`
H5 target: `http://localhost:5174`

## Machine Gates

- `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check`
  - PASS: `vue-tsc --noEmit`
- `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh`
  - PASS: 14 pass / 0 fail
  - Note: H5 HTTP route check is skipped because the active dev server for this run is `5174`, while the script probes `5173`.
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-07`
  - PASS: `routes=16`, `samples=5`, `sampled=5`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `routeNavigation=2`, `stateWrite=1`, `observableChange=2`
  - Evidence shard: `docs/audit/shards/uni-fr-07-front-action-sample.ndjson`
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-08`
  - PASS: `routes=6`, `samples=7`, `sampled=7`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `routeNavigation=5`, `modalOrSheet=1`, `stateWrite=1`
  - Evidence shard: `docs/audit/shards/uni-fr-08-front-action-sample.ndjson`
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-09`
  - PASS: `routes=3`, `samples=2`, `sampled=2`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `stateWrite=2`
  - Evidence shard: `docs/audit/shards/uni-fr-09-front-action-sample.ndjson`
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-10`
  - PASS: `routes=8`, `samples=7`, `sampled=7`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `stateWrite=2`, `observableChange=5`
  - Evidence shard: `docs/audit/shards/uni-fr-10-front-action-sample.ndjson`

## Browser Proof

### FR-012: team incentive actions

Team agent proof:

- Opened `/#/pages/team/agent`.
- Verified `KOL campaign match` is exposed as a real `button`.
- Clicked `KOL campaign match`.
- Page showed the selected application context: `KOL campaign match · New application`.
- The form remained actionable with business fields visible, including `Event date`, `City`, and `Budget requested`.

Team quota proof:

- Opened `/#/pages/team/quota`.
- Verified `Buy NexionBox Pro` and `Invite to unlock` are exposed as real buttons.
- Clicked `Buy NexionBox Pro`.
- URL changed to `/#/pages/store/detail?id=stellarbox-pro`.
- Product detail page showed `NexionBox Pro`.

### FR-013: Genesis, Events, and Proof external/deep-link actions

Genesis marketplace proof:

- Opened `/#/pages/genesis/genesis`.
- Clicked `View marketplace`.
- URL changed to `/#/pages/genesis/marketplace`.
- Marketplace listings were visible.

OpenSea fallback proof:

- Opened `/#/pages/genesis/marketplace`.
- Verified a single `View on OpenSea` button is exposed.
- Clicked `View on OpenSea`.
- Dialog showed `Couldn't reach OpenSea right now`.
- Dialog exposed real `Retry connection` and `Back to Nexion market` buttons.
- Clicked `Back to Nexion market`; the dialog closed.
- Runtime console/pageerror listener reported `errors=[]` for this interaction.

Genesis buy proof:

- Opened `/#/pages/genesis/marketplace`.
- Clicked a `Buy` listing.
- Toast showed `Genesis #829 acquired`.
- The `Mine` tab count changed to `Mine (1)`.

Events discount proof:

- Opened `/#/pages/events/events`.
- Verified `Claim discount` is exposed as a real `button`.
- Clicked `Claim discount`.
- Event quest state recorded the claim.
- Page showed claimed state in the featured event area.
- Reloaded the page; claimed state remained true.

Proof sharing proof:

- Opened `/#/pages/me/proof`.
- Runtime button list included `Earnings`, `Streak`, `Network`, `Copy link`, `Quick share`, `X / Twitter`, `Telegram`, `WhatsApp`, `Instagram`, `Copy link`, and `Save PNG`.
- Clicked the destination `Copy link` button.
  - Toast showed `Card link copied`.
- Clicked `Save PNG`.
  - Toast showed `Card saved to device · share anywhere`.
- Runtime console/pageerror listener reported `errors=[]` for this interaction.

## Same-Shape Scan

- `rg -n "Submit invoice|traffic logs|Buy NexionBox|Invite to unlock|KOL campaign" src/pages src/components`
  - Team incentive cards now expose semantic buttons and either select an application context, route to product detail, or show eligibility feedback.
- `rg -n "OpenSea|marketplace|View on OpenSea|Buy" src/pages/genesis src/components/genesis`
  - Genesis marketplace CTAs route internally, OpenSea opens an actionable fallback dialog, and listing buy writes holding state with visible feedback.
- `rg -n "Claim discount|eventQuest.claim|discountClaimed" src/pages/events src/components/events src/store src/i18n/messages`
  - Discount claims write event quest state, show claimed feedback, and have EN/ZH toast copy.
- `rg -n "shareNative|shareDestinations|copiedToast|downloadToast|setClipboardData" src/pages/me/proof.vue src/i18n/messages`
  - Proof share actions are semantic buttons and trigger clipboard/share/save fallback feedback.
- During done-review, a dev-HMR runtime error surfaced where an old Pinia `trialClaimSheet` instance lacked the newly added `closeTransient` action. `AppChassis` now uses a backward-compatible fallback (`closeTransient()` when present, otherwise `open=false`), and browser runtime listeners report no current errors.
