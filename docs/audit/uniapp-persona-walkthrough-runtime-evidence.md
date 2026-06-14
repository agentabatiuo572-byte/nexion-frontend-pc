# UniApp Persona Walkthrough Runtime Evidence

Generated: 2026-06-13T13:11:09+08:00

## Scope

- Spec: `docs/remediation/specs/SPEC-L3c02-uniapp-persona-walkthroughs.md`
- Ledger item: `FR-014`
- Task matrix rows: `FT-013`, `FT-014`, `FT-015`
- UniApp H5 base: `http://localhost:5173`
- Proof shard: `docs/audit/shards/uniapp-persona-walkthrough-proof.ndjson`

## Command

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
$env:UNI_BASE_URL='http://localhost:5173'
node scripts\uniapp-persona-walkthrough-proof.mjs
```

## Result

```json
{
  "status": "passed",
  "steps": 7,
  "outFile": "docs/audit/shards/uniapp-persona-walkthrough-proof.ndjson"
}
```

## Runtime Proof Summary

| Task | Step | Proof |
|---|---|---|
| FT-013 | withdrawal after KYC | Route reached `/#/pages/me/wallet-withdraw-tracking`; WD id `WD-20260613-5234`; tracking page includes amount/network/address; contribution points dropped to `95`; pending withdraw bill was written. |
| FT-014 | exchange confirm modal | `Confirm Exchange` modal contained business content `NEX 10 -> USDT`; primary confirm wrote swap `SW-WD70S`; v3 daily/lifetime cap usage updated; two swap bills were written. |
| FT-014 | repurchase | `Re-invest $200.00` wrote +100 points (`95 -> 195`), active 90d staking position `stk-1781327445517`, and stake bill `REINVEST-MQBWD9N1`. |
| FT-015 | commissions | Team hub `View details` entry reached `/#/pages/team/commissions` and rendered `Commissions`, `Withdrawable`, `Network royalty`. |
| FT-015 | rank | Team hub rank entry reached `/#/pages/team/rank` and rendered `V Rank`, `Current rank`, `V3 Captain`. |
| FT-015 | binary | Team hub match entry reached `/#/pages/team/binary` and rendered `Balance Match`, `Track A`, `Track B`. |
| FT-015 | leadership pool | Team hub pool entry reached `/#/pages/team/leadership-pool` and rendered `Global Leadership Pool`, `Week pool`, `Vote weights`. |

## Defects Found And Fixed During Proof

- Withdraw address input was visually present but its inner `.uni-input-input` had zero height, so keyboard focus stayed on the amount input and address text polluted the amount field. Fixed with `nx-withdraw-address-input` and scoped inner input height.
- UniApp H5 `<view @click>` controls were visible but text locator clicks were not reliable enough for a business proof. Fixed by adding business selectors to withdraw submit, repurchase submit, and the four team finance entries, then using browser `scrollintoview + click`.
- Exchange modal proof now verifies the popup has business-specific content and produces persisted swap/cap/bill results; a popup shell alone is not counted as pass.

## Sentinel

`scripts/verify.sh` now runs:

```bash
node scripts/uniapp-persona-walkthrough-proof.mjs
```

The gate fails if any persona operation renders without the promised business result.
