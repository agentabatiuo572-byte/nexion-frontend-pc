# Support Admin Surface Runtime Evidence

Generated for `SPEC-L3a01-support-admin-surface` on 2026-06-12.

## Scope

- Admin surface: `/content/support`
- Frontend mapped routes: `/#/pages/me/help`, `/#/pages/me/support`, `/#/pages/me/support-tickets`
- Ledger item: `SD-005` / `FM-018`
- Spec card: `docs/remediation/modal-specs/content-support-ticket-workflow.md`

## Runtime Proof

`node scripts/admin-support-surface-proof.mjs`

| Task | Result |
|---|---|
| Route business controls | Passed: FAQ, SLA, ticket detail, reply controls present; pager count = 1; 23 form controls |
| Create FAQ | Passed: created `FAQ-004`, refreshed, FAQ remained rendered |
| Reply ticket | Passed: appended agent reply to `TK-1024`, status moved to `pending_user`, refreshed, reply remained |
| Close ticket | Passed: closed `TK-1024`, refreshed, status remained `closed` |

The proof also writes `docs/audit/shards/ad-09-support-action-sample.ndjson` so Source C operability can count `/content/support` as an admin task walkthrough.

## Route And Mapping Proof

- `node scripts/remediation-runtime-admin-shard.mjs AD-09`: `routes=8`, `captured=8`, `errors=0`; `/content/support` runtime has `paginationPagerCount=1`, FAQ/SLA/ticket tables, and actionable ticket controls.
- `node scripts/remediation-feature-map-audit.mjs`: `gaps=0`, `missingAdminRefs=0`.
- `node scripts/remediation-feature-map-operability.mjs`: `FM-018` is `provisionally-operable`, admin action samples = 1, frontend action samples = 5, blocking ledger ids = none.

## Guardrails

- `node scripts/admin-support-surface-audit.mjs` checks `/content/support` route wiring, I8 view wiring, support business controls, verify needles, and UniApp `owner/lastReplyAt` field mirror.
- `scripts/verify.sh` includes the support surface gate and SSR needles for FAQ, SLA, ticket detail, and reply controls.
