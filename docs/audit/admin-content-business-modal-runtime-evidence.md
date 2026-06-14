# Admin Content Business Modal Runtime Evidence

Timestamp: 2026-06-13T01:44:08+08:00

Scope: `SPEC-L2a02-admin-content-business-modals`

## Runtime Proof

`node scripts/admin-content-business-modal-proof.mjs`

- Status: passed
- Results: 6/6
- Evidence shard: `docs/audit/shards/ad-09-content-business-modal-proof.ndjson`
- Covered tasks:
  - `i18n-edit-guard-and-visible-draft`: invalid placeholders keep confirm disabled; valid zh/en copy saves and refreshes into the visible draft preview.
  - `i18n-repair-updates-integrity`: repair writes zh/en mirror fields and the integrity panel updates after refresh.
  - `course-authoring-draft-visible-after-reopen`: new course writes slug/category/format/difficulty/duration/reward/publish state/title/body and reappears after reopen.
  - `copy-ab-draft-visible-after-reopen`: A/B draft writes zh/en copy, audience, traffic split, surface, version and version note; preview survives reopen.
  - `disclosure-draft-visible-after-reopen`: disclosure draft writes version, jurisdiction, language scope, effective date, re-ack, zh/en body; preview survives reopen.
  - `campaign-edit-visible-list-and-detail-after-reopen`: campaign edit writes title/body/tier/audience/schedule/budget; list and detail drawer both reflect the draft after reopen.

## Action Sampler

`node scripts/remediation-runtime-action-sample.mjs AD-09`

- Status: passed
- Routes: 8
- Samples: 45
- Sampled: 45
- Errors: 0
- `noObservableChange`: 0
- `businessIncompleteModal`: 0
- Evidence shard: `docs/audit/shards/ad-09-action-sample.ndjson`

Sampler hardening added in `scripts/remediation-runtime-action-sample.mjs`: transient `agent-browser` daemon refusal now retries before failing; genuine page or business failures still fail the sampled action.

## Contract Gates

- `node scripts/admin-modal-contract-audit.mjs`: passed, checkedRequired=7, checkedForbidden=9.
- `node scripts/admin-modal-contract-proof.mjs`: passed, 7/7.
- `npx --no-install tsc --noEmit`: passed.
- `npm run build`: passed.
- `npm run verify`: passed, 143 checks, 0 failed.
- `git diff --check`: exit 0; CRLF warnings only.

## Browser Reality Check

Playwright opened `http://localhost:3002/content/i18n` against the live local admin server.

- `编辑(中英同步)` opened a real business modal with zh/en textareas, placeholder requirement text, required audit reason, and a disabled confirm button before valid input.
- `+ 新建课程` opened a real course authoring modal with slug, category, format, difficulty, duration, reward, publish state, zh/en title, zh/en body, required audit reason, and disabled confirm while required fields are missing.
- Browser console: 0 errors.
