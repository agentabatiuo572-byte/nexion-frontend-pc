# Admin List Pagination Runtime Evidence

Spec: `docs/remediation/specs/SPEC-L2d01-admin-list-pagination.md`

Runtime date: 2026-06-12

## Changed Contract

- Added shared `useDataListPager`, `DataListPager`, and `PaginationExemption` primitives in `app/components/domain-views/design-kit.tsx`.
- `DataListPager` exposes page, page size, filtered total, raw total, previous/next controls, and `data-list-pager="true"` for runtime detection.
- `PaginationExemption` requires `data-pagination-reason` and `data-pagination-max-rows`; runtime validity requires reason length >= 8 and maxRows <= 5.
- `ListArchetype` now uses the shared pager by default and can opt into explicit `paginationExempt` for small static lists.

## Finance Routes

| Route | Result | Evidence |
|---|---|---|
| `/finance/withdrawals` | Paginated | `pagination=true`, `paginationPagerCount=1`; browser proof changed 10 -> 5 rows, moved to page 2, then filtered `大额` and count reset to 3 / total 8 |
| `/finance/ledger` | Paginated | `pagination=true`, `paginationPagerCount=1`; browser proof changed 10 -> 5 rows, moved to page 2, then filtered `充值` and count reset to 2 / total 9 |
| `/finance-products/staking` | Exempt | Two valid `paginationExempt` entries for USDT/NEX 4-tier static config tables, each maxRows=4 with reason |
| `/finance-products/genesis` | Exempt | Valid `paginationExempt` entry for Genesis node holding sample table, maxRows=5 with reason |

## Runtime Gates

- `node scripts/remediation-runtime-admin-shard.mjs AD-04`: 12 routes captured, 0 errors.
- `node scripts/admin-list-capability-audit.mjs --runtime`: passed, `unexemptedP1=0`.
- `npm run build`: passed.
- `npm run verify`: passed, 137 checks / 0 failed, including the new list capability gate.

## Scope Note

`RT-014` is verified because the four finance routes are now paginated or explicitly exempted with runtime evidence. `INIT-003` remains open as the all-admin list-capability seed until the remaining non-finance domain tables are paginated or exempted in later domain batches.
