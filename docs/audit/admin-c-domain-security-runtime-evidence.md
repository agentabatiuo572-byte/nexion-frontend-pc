# Admin C Domain Security Runtime Evidence

Spec: `docs/remediation/specs/SPEC-L2c01-admin-c-domain-2fa-persist.md`

Ledger: `INIT-004`

## Runtime Proof

Command:

```powershell
node scripts/admin-c-domain-security-proof.mjs
```

Result: PASS 4/4

- `c5-query-target-user`: `/users/security` queries `U-88421` and shows initial `2FA 状态 · 已开启(TOTP)`.
- `disable-2fa-modal-has-business-controls`: the `关闭 2FA(操作确认 + 实名二验)` modal has account-security copy, visible `实名二验` context, exactly one reason textarea, disabled confirm before reason, and no password / verification-code / secret / TOTP credential inputs.
- `disable-2fa-persists-and-survives-refresh`: after submitting the operation reason, reload still shows `已关闭(人工)`; `nexion-admin-platform-v1.state.params["C.twofa.U-88421"] === "disabled"`; `nexion-admin-ops-v1.state.users["U-88421"].twoFactorReset === true`; both audit trails contain the operation.
- `hub-360-reflects-twofactor-reset`: `/users/search/U-88421` shows the account/security card and `待重设` / `待重设(运营已重置)`.

Shard:

- `docs/audit/shards/c-domain-security-2fa-proof.ndjson`

## Browser Live Proof

Independent Browser session on `http://localhost:3002`:

- Cleared `nexion-admin-platform-v1` and `nexion-admin-ops-v1`, refreshed `/users/security`.
- Queried `U-88421`, opened `关闭 2FA(操作确认 + 实名二验)`.
- DOM evidence: `hasSecuritySummary=true`, `hasRealName=true`, `hasWrongGeoSummary=false`, controls contained only one textarea for `操作理由`, confirm was disabled before reason.
- Submitted reason, refreshed C5, queried `U-88421` again: page showed `已关闭(人工)`, `C.twofa.U-88421=disabled`, `twoFactorReset=true`, platform audit hit, user-ops audit hit.
- Opened `/users/search/U-88421`: 360 HUB account/security card showed `待重设`.
- Browser console errors: 0.

## Regression Gates

```powershell
npx --no-install tsc --noEmit
node scripts/admin-modal-contract-audit.mjs
node scripts/admin-modal-contract-proof.mjs
npm run build
npm run verify
```

Results:

- TypeScript: PASS
- Modal contract audit: PASS (`checkedRequired=7`, `checkedForbidden=9`)
- Modal contract proof: PASS 7/7
- Build: PASS
- Verify: PASS 143 checks / 0 failed
