# Source B Task Walkthrough Matrix

Generated at: 2026-06-13T13:43:58+08:00

This matrix converts runtime route/action evidence into persona task status. A task is not considered passable just because the route renders. It must complete the promised business operation or be explicitly blocked by a ledger item.

## Front User Tasks

| ID | Persona Task | Target Surface | Status | Blocking Evidence |
|---|---|---|---|---|
| FT-001 | New user claims a trial and starts the trial path | UniApp account/trial | verified | `SPEC-L2b03`: Claim trial opens actionable sheet; `Start free trial` routes to bind-card with trial disclosure |
| FT-002 | User buys NexionBox S1 through checkout | UniApp store checkout | verified | `SPEC-L2b01`: checkout review -> payment instructions -> completed payment -> order + purchase bill persisted -> order detail visible |
| FT-003 | User opens product reviews before purchase | Next + UniApp product detail | verified | `SPEC-L2b05`: Next review CTA opens review-center summary; `NEXT-FR-03` and `UNI-FR-03` action samplers both report `noObservableChange=0` |
| FT-004 | Empty-orders user returns to store | UniApp store orders | verified | `SPEC-L2b01`: empty orders `Browse Store` routes to `/#/pages/store/store` |
| FT-005 | User binds a card and sets it as default | UniApp wallet card form | verified | `SPEC-L2b02`: OFF saves one card with `defaultTokenId=null`; ON saves one card with `defaultTokenId` bound to the saved token |
| FT-006 | User starts a new withdrawal from empty tracking | UniApp withdrawal tracking | verified | `SPEC-L2b02`: empty-state `Submit a new withdrawal` routes to `/#/pages/me/wallet-withdraw` |
| FT-007 | User copies transaction hash for support/audit | UniApp tx detail | verified | `SPEC-L2b02`: `Copy hash` shows `Transaction hash copied`; bill rows route to `/#/pages/tx/hash?hash=...` |
| FT-008 | User opens a learning article and earns/progresses | Next learn | verified | `SPEC-L2b05`: lesson card opens actionable sheet; `Mark complete` changes state to reward queued; close control exits dialog |
| FT-009 | User contacts support or opens a ticket | UniApp help/support | verified | `SPEC-L2b03`: support CTA routes to ticket creation; submitted ticket opens detail and persists in ticket list. `SPEC-L3a01` adds the matching admin support CMS for FAQ/SLA/ticket handling. |
| FT-010 | User saves profile changes | UniApp profile | verified | `SPEC-L2b03`: no-change save shows feedback; edited display name persists after reload |
| FT-011 | Team operator submits KOL campaign proof or buys quota hardware | UniApp team incentive pages | verified | `SPEC-L2b04`: KOL bucket selects application context with submission fields; `Buy NexionBox Pro` routes to product detail |
| FT-012 | User follows external/deep links for Genesis, events, or proof sharing | UniApp Genesis/events/proof | verified | `SPEC-L2b04`: Genesis routes to marketplace, OpenSea shows actionable fallback dialog, discount claim persists, Proof Copy/Save show feedback |
| FT-013 | User completes withdrawal from form after KYC gating | UniApp wallet withdraw | verified | `SPEC-L3c02`: KYC-seeded withdraw form accepts real amount/address input, submits to tracking, renders WD id/address/amount, deducts 5 contribution points, and writes a pending withdraw bill. |
| FT-014 | User exchanges NEX/USDT and repurchases | UniApp wallet exchange/repurchase | verified | `SPEC-L3c02`: exchange modal has business-specific NEX->USDT content and writes swap history/v3 caps/two bills; repurchase writes +100 points, a 90d stake, and a stake bill. |
| FT-015 | User navigates team commission/rank/binary/leadership views | UniApp team finance pages | verified | `SPEC-L3c02`: team hub entries route to commissions, V Rank, Balance Match, and Global Leadership Pool pages with business needles present. |

## Admin Operator Tasks

| ID | Persona Task | Target Surface | Status | Blocking Evidence |
|---|---|---|---|---|
| AT-001 | Superadmin creates operator account and changes role | Admin RBAC | verified | `SPEC-L2a03`: role-select proof persisted `op-041` role/tier as `finance/lead` after reopening `/platform/rbac`; browser evidence confirms 7 role options, member/lead controls, and reason-disabled confirm |
| AT-002 | Superadmin changes permission matrix | Admin RBAC | verified | `SPEC-L2a03`: permission-matrix proof changed support grant to `R`, wrote audit, survived route reopen, and browser evidence confirms no-diff disabled plus `客服:-→R` diff preview |
| AT-003 | Content operator edits/repairs localized copy | Admin i18n/learn | verified | `SPEC-L2a02`: i18n edit guard rejects missing placeholders, then persists zh/en draft preview after refresh; repair updates integrity count; AD-09 sampler `businessIncompleteModal=0` |
| AT-004 | Content operator creates a course | Admin i18n/learn | verified | `SPEC-L2a02`: course-authoring proof persisted slug/category/format/difficulty/duration/reward/publishState/title/body and visible draft row after reopen |
| AT-005 | Content operator edits A/B copy draft | Admin copy A/B | verified | `SPEC-L2a02`: copy-edit proof persisted zh/en draft, audience, traffic split, surface and version note; visible draft preview survived reopen |
| AT-006 | Compliance/content operator drafts disclosure or trust version | Admin disclosure/trust | verified | `SPEC-L2a02`: version-authoring proof persisted version/jurisdiction/languageScope/effectiveDate/requiresReack/zh/en and visible draft preview after reopen |
| AT-007 | Growth/content operator edits notification campaign | Admin notifications | verified | `SPEC-L2a02`: campaign-edit proof persisted title/body/tier/audience/schedule/budget; both list row and detail drawer reflected the draft after reopen |
| AT-008 | Operator reviews admin information lists without losing rows | All admin table/list routes | verified | `SPEC-L2d02`: 66 admin routes / 38 table routes pass global runtime audit with `blockerCount=0`, `warningCount=0`, `invalidExemptionCount=0`; real pagers and explicit small-table exemptions are both runtime-verified |
| AT-009 | Device operator deletes/down-ranks device pricing/task rows with audit reason | Devices pricing/tasks | verified | `SPEC-L2a03`: destructive-reason proof required rollback + impact ack + audit reason, deleted `NexionBox S1`, down-ranked/removed `LLM 推理 70B`, and confirmed both persisted after reopening routes |
| AT-010 | Admin manages support tickets/help center content for frontend support flows | Admin `/content/support` | verified | `SPEC-L3a01`: runtime proof created FAQ, replied to `TK-1024`, closed `TK-1024`, and verified all persisted after refresh; `FM-018` is now provisionally-operable. |
| AT-011 | Security operator disables user 2FA after real-name step-up and syncs 360 HUB | Admin C5 + 360 HUB | verified | `SPEC-L2c01`: C5 proof queried `U-88421`, required a reason-only OperationConfirm modal with account-security summary and no credential inputs, wrote `C.twofa.U-88421` plus `twoFactorReset=true`, survived reload, and `/users/search/U-88421` showed `待重设`. |

## Next Walkthrough Priority

1. Frontend walkthrough priorities `FT-013`~`FT-015` are closed by `SPEC-L3c02`.
2. Source C feature-mapping walkthrough priorities are closed by `SPEC-L3c03`: `FM-004` top-up/KYC Express, `FM-005` staking front+admin, `FM-008` unilevel, `FM-013` i18n copy, and `FM-016` module switch/front module visibility.
3. `FM-007`, `FM-009`, `FM-010`, and `FM-011` are counted through `SPEC-L3c02` task proof. Current Source C operability audit is `needsTaskWalkthrough=0`, `provisionallyOperable=18`; continue with final L5 sweep rather than new walkthrough rows.
