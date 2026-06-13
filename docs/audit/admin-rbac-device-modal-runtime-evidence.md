# SPEC-L2a03 RBAC / Device Modal Runtime Evidence

Date: 2026-06-12

## Scope

- `/platform/rbac`: change role, create operator account, change permission matrix.
- `/devices/pricing`: delete SKU destructive operation.
- `/devices/tasks`: down-rank/remove task destructive operation.

## Runtime Proof

Command:

```bash
node scripts/admin-rbac-device-modal-proof.mjs
```

Result:

- `change-role-persists`: selected `finance/lead` for `op-041`, submitted with audit reason, reopened `/platform/rbac`, confirmed `A.acct.op-041.role=finance` and `A.acct.op-041.tier=lead`.
- `permission-matrix-diff-persists`: opened `文案/课程发布(I)` permission matrix, confirmed no-diff state keeps confirm disabled, changed support grant to `R`, submitted with audit reason, reopened `/platform/rbac`, confirmed `A.rbac.support.content_publish=R`.
- `sku-delete-reason-persists`: opened `NexionBox S1` delete, filled rollback note, checked impact acknowledgement, filled audit reason, submitted, reopened `/devices/pricing`, confirmed SKU removal persisted.
- `task-down-reason-persists`: opened `LLM 推理 70B` down-rank, filled rollback note, checked impact acknowledgement, filled audit reason, submitted, reopened `/devices/tasks`, confirmed task removal persisted.

Output shard:

- `docs/audit/shards/ad-02-ad-05-rbac-device-action-sample.ndjson`

## Runtime Samplers

Commands:

```bash
node scripts/remediation-runtime-action-sample.mjs AD-02
node scripts/remediation-runtime-action-sample.mjs AD-05
```

Results:

- AD-02: `samples=26`, `sampled=26`, `errors=0`, `noObservableChange=0`, `businessIncompleteModal=0`.
- AD-05: `samples=6`, `sampled=6`, `errors=0`, `noObservableChange=0`, `businessIncompleteModal=0`.

## Static / Build Gates

Commands:

```bash
node scripts/admin-modal-contract-audit.mjs
npx --no-install tsc --noEmit
npm run build
npm run verify
```

Results:

- `admin-modal-contract-audit`: passed, including permission no-diff and diff-preview regression snippets.
- `tsc`: 0 errors.
- `npm run build`: passed.
- `npm run verify`: `143 checks, 0 failed`.

## Browser Evidence

In-app Browser opened `http://localhost:3002/platform/rbac`.

- Change-role modal exposed `data-business-form="role-select"`, `role-select-target` options `super/finance/risk/growth/content/support/audit`, and `role-select-tier` options `member/lead`; confirm stayed disabled while audit reason was missing.
- Permission modal exposed `data-business-form="permission-matrix"`, 7 permission select controls, no-diff preview text, and disabled confirm. After changing support grant to `R` and entering reason, preview showed `客服:-→R` and confirm became enabled.
- Console errors: 0.
- Screenshot: `l2a03-rbac-permission-modal-runtime.png`.
