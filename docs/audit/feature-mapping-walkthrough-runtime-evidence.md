# Feature Mapping Walkthrough Runtime Evidence

Generated: 2026-06-13T13:43:58+08:00

## Scope

- Spec: `docs/remediation/specs/SPEC-L3c03-feature-mapping-walkthroughs.md`
- Matrix rows: `FM-004`, `FM-005`, `FM-008`, `FM-013`, `FM-016`
- Related task proof: `SPEC-L3c02` covers `FM-009`, `FM-010`, `FM-011`
- Admin base: `http://localhost:3002`
- UniApp H5 base: `http://localhost:5173`
- Proof shard: `docs/audit/shards/feature-mapping-walkthrough-proof.ndjson`

## Command

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
$env:UNI_BASE_URL='http://localhost:5173'
$env:ADMIN_BASE_URL='http://localhost:3002'
node scripts\feature-mapping-walkthrough-proof.mjs
```

## Result

```json
{
  "status": "passed",
  "steps": 7,
  "outFile": "docs/audit/shards/feature-mapping-walkthrough-proof.ndjson"
}
```

## Runtime Proof Summary

| Mapping | Step | Proof |
|---|---|---|
| FM-004 | top-up channel + KYC Express | TRC20 channel rendered awaiting-payment address and copy action; KYC Express generated compliance check `KYC-2026-A78235`, showed exact amount, and wrote bill `KYC-KYC-2026-A78235`. |
| FM-005 | staking frontend | 30d staking row opened an actionable stake sheet; submitting `$100` wrote active position `stk-1781329965991` and stake bill `STAKE-OPEN-MQBXVAG7`. |
| FM-005 | staking admin | `/finance-products/staking` APY modal exposed target-value input, operation reason, and confirm; submit wrote `G.staking.apy.usdt30d` and audit `AU-0-1`; reload rendered `13%`. |
| FM-008 | unilevel | Direct and extended filters changed row sets (`8` direct, `42` extended); how link reached `/#/pages/team/unilevel-how`. |
| FM-013 | i18n copy | Language row switched locale store to zh; top-up, staking, and unilevel pages rendered zh business copy. |
| FM-016 | frontend module visibility | Staking module row `.nx-staking-vault-row-30` was visible and opened a business action sheet. |
| FM-016 | admin module switch | Params registry owner link reached `/finance-products/staking`; `停售` modal showed `停售只停新锁`, required reason, confirmed, wrote `G.staking.enabled.usdt30d=false`, audit `AU-1-1`, and reload rendered `已停售`. |

## Defects Found And Fixed During Proof

- UniApp H5 same-page hash query navigation to `wallet-topup?kyc=1` did not reliably re-enter KYC Express mode. Fixed by parsing hash query and listening to `hashchange`.
- `OperationConfirmModal` showed generic execution-summary text while caller business detail stayed behind a collapsed disclosure. Fixed by rendering caller `detail` as a visible `业务规则` row in the modal body.
- Source C operability audit only counted early route action samples, so task proof rows could remain marked `needs-task-walkthrough`. Fixed by counting passed `*-proof.ndjson` rows as task evidence.

## Sentinel

`scripts/verify.sh` now runs:

```bash
node scripts/feature-mapping-walkthrough-proof.mjs
```

The gate fails if any FM walkthrough lacks the promised business operation, including modal business controls and persisted admin/audit writes.
