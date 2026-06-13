# UniApp Account Support Trial Runtime Evidence

Date: 2026-06-12
Spec: `docs/remediation/specs/SPEC-L2b03-uniapp-account-support-trial.md`
Ledger: `FR-009`, `FR-010`, `FR-011`
H5 target: `http://localhost:5174`

## Machine Gates

- `cd D:\WORKS\PLAN\Nexion-uniapp; npm run type-check`
  - PASS: `vue-tsc --noEmit`
- `cd D:\WORKS\PLAN\Nexion-uniapp; bash scripts/verify.sh`
  - PASS: 14 pass / 0 fail
  - Note: H5 HTTP route check is skipped because the active dev server for this run is `5174`, while the script probes `5173`.
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-06`
  - PASS: `routes=11`, `samples=11`, `sampled=11`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `routeNavigation=6`, `observableChange=5`
  - Evidence shard: `docs/audit/shards/uni-fr-06-front-action-sample.ndjson`
- `cd D:\WORKS\PLAN\Nexion-admin-prototype; UNI_BASE_URL=http://localhost:5174 FRONT_ACTION_SAMPLE_LIMIT=2 node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-10`
  - PASS: `routes=8`, `samples=7`, `sampled=7`, `errors=0`, `noObservableChange=0`, `clickTargetMissing=0`, `hashOnlyNoContent=0`, `stateWrite=2`, `observableChange=5`
  - Evidence shard: `docs/audit/shards/uni-fr-10-front-action-sample.ndjson`

## Browser Proof

### FR-009: support create/view ticket

Browser H5 proof:

- Opened `/#/pages/me/support`.
- Verified `Open a ticket` is exposed as a real `button`.
- Clicked `Open a ticket`; URL changed to `/#/pages/me/support-tickets?mode=create`.
- Filled the ticket form:
  - Subject: `Runtime support proof 1781272600992`
  - Body: `Runtime proof: support ticket form accepts account issue detail and opens a persisted ticket thread.`
- Submitted the ticket.
- Detail view showed the new subject and user message.
- Returned to the ticket list and opened `/#/pages/me/support-tickets`; the new ticket was still visible as `TK-1025`.

Implementation note:

- Tickets now live in `src/store/tickets.ts` and persist under the UniApp storage key `nexion-support-tickets-v1`.
- `FM-018` / `SD-005` remain open because the admin support-management surface is still missing; this evidence only verifies the frontend user support task.

### FR-010: profile save persists

Browser H5 proof:

- Opened `/#/pages/me/profile`.
- Clicked `Save Changes` with no edits.
  - Page showed `No profile changes to save`.
- Changed display name to `Alex Verified 1781272649614`.
- Clicked `Save Changes`.
  - Page showed `Profile updated`.
  - Page body showed `Alex Verified 1781272649614`.
- Reloaded `/#/pages/me/profile`.
  - The display name still showed `Alex Verified 1781272649614`.

### FR-011: claim trial opens actionable sheet and routes to bind-card

Browser H5 proof:

- Opened `/#/pages/me/trial`.
- Verified `Claim trial` is exposed as a real `button`.
- Clicked `Claim trial`.
  - The bottom sheet showed `NexionBox S1 free trial`.
  - The sheet exposed real controls: `Start free trial` and `Maybe later`.
- Clicked `Start free trial`.
  - URL changed to `/#/pages/me/wallet-cards-new?...&trial=1`.
  - Page showed the bind-card form and trial charge disclosure:
    `When your 3-day free trial ends, this card will be used to complete the NexionBox S1 purchase $1,299...`

## Same-Shape Scan

- `rg -n "Contact support|Open a ticket|support-tickets|ticket|Open" src/pages/me src/components/me`
  - Support/help CTAs now route to ticket creation or ticket detail/list surfaces.
  - Ticket stat tiles and tabs have observable filter behavior instead of dead repeated clicks.
- `rg -n "Save Changes|profile|useProfile|setStorageSync" src/pages/me src/store`
  - Profile save now writes through `useProfile` and shows visible no-change / saved feedback.
- `rg -n "Claim trial|trial-claim|free-trial|wallet-cards-new\\?trial" src`
  - Trial entry CTAs open the sheet; the sheet `Start free trial` routes to bind-card.
  - The trial sheet closes transiently when mounting a different chassis route, avoiding stale global sheet controls across pages.
- `rg -n "Save goal|goalsStore.setGoal|nexion-goals-v1" src/pages/me src/store`
  - During UNI-FR-10 cleanup, `Save goal` was fixed as a semantic parent button so the click reaches `goalsStore.setGoal`.
- `rg -n "tickets shown|selected for review|filterAlreadyShown|sectionSelected" src/pages src/i18n/messages/en.ts src/i18n/messages/zh.ts`
  - done-review caught two newly added English-only feedback strings; both now route through `filterAlreadyShown` / `sectionSelected` in EN and ZH.
