# Nexion Remediation Ledger

> Generated summary. Source of truth is `docs/audit/ledger.ndjson`.

Generated at: 2026-06-13T09:02:34.902Z

## Summary

- Total: 38
- By severity: {"P0":4,"P1":33,"P2":1}
- By status: {"verified":37,"closed":1}

## Entries

| ID | Side | Severity | Category | Status | Route | Title |
|---|---|---|---|---|---|---|
| INIT-001 | frontend | P0 | meta-leak | verified | / | Home leaks internal P1-P6 phase labels |
| INIT-002 | admin | P1 | modal-blocked | verified | /content/i18n | i18n edit modal has no localized copy fields |
| INIT-003 | admin | P1 | list-capability | verified | all-admin-list-routes | Admin information lists lack pagination and some lack filters |
| INIT-004 | admin | P0 | fake-write | verified | C-domain | C domain 2FA action is toast-only fake write |
| INIT-005 | frontend | P1 | dead-control | verified | all-next-reference-routes | Reference source has 6 dead href anchors |
| INIT-006 | frontend | P1 | i18n | verified | i18n | Reference source en/zh i18n key mismatch |
| INIT-007 | cross | P0 | spec-gap | verified | feature-mapping | No full frontend-admin feature mapping exists |
| INIT-008 | uniapp | P1 | port-drift | verified | all-uniapp-routes | UniApp full-route migration needs batch audit against reference behavior |
| SD-001 | frontend | P1 | dead-control | verified | next-reference-static | Dead href anchor in app/(main)/me/wallet/nex/page.tsx |
| SD-002 | frontend | P1 | dead-control | verified | next-reference-static | Dead href anchor in app/(main)/trust/page.tsx |
| SD-003 | frontend | P1 | dead-control | verified | next-reference-static | Dead href anchor in app/ref/[code]/page.tsx |
| SD-004 | admin | P2 | spec-gap | verified | source-d-existing-gates | Admin PRD file uniqueness gate reports 0 PRD files |
| SD-005 | cross | P1 | spec-gap | verified | feature-mapping | FM-018 missing admin surface(s): /content/support |
| RT-006 | admin | P1 | dead-control | closed | /content/i18n | i18n 修复 button has no observable effect |
| RT-007 | admin | P1 | modal-blocked | verified | /content/i18n,/content/learn | Localized edit/repair modals lack zh/en copy controls |
| RT-008 | admin | P1 | modal-blocked | verified | /content/i18n,/content/learn | New course modal lacks course authoring fields |
| RT-009 | admin | P1 | modal-blocked | verified | /content/copy-ab | A/B draft edit modal lacks copy/version editing controls |
| RT-010 | admin | P1 | modal-blocked | verified | /content/disclosure,/content/trust | Disclosure/trust new-version modals lack content/version fields |
| RT-011 | admin | P1 | modal-blocked | verified | /content/notifications | Notification edit modal lacks campaign fields |
| RT-012 | admin | P1 | modal-blocked | verified | /platform/rbac | RBAC role modals lack role selector |
| RT-013 | admin | P1 | modal-blocked | verified | /platform/rbac | RBAC authorization modal lacks permission matrix |
| RT-014 | admin | P1 | list-capability | verified | /finance-products/genesis,/finance-products/staking,/finance/ledger,/finance/withdrawals | Finance table routes lack pagination |
| RT-015 | admin | P1 | modal-blocked | verified | /devices/pricing,/devices/tasks | Device delete/down modals require reason but expose no reason input |
| FR-001 | frontend | P1 | dead-control | verified | /trust | Trust profile card is a hash-only dead link |
| FR-002 | cross | P1 | dead-control | verified | /store/[productId],/#/pages/store/detail | Product detail review CTA does not open reviews |
| FR-003 | uniapp | P0 | flow-break | verified | /#/pages/store/checkout | UniApp checkout Continue does not advance payment flow |
| FR-004 | uniapp | P1 | dead-control | verified | /#/pages/store/orders | UniApp empty orders Browse Store CTA does nothing |
| FR-005 | uniapp | P1 | dead-control | verified | /#/pages/me/wallet-cards-new | UniApp default-card toggle has no observable effect |
| FR-006 | uniapp | P1 | dead-control | verified | /#/pages/me/wallet-withdraw-tracking | UniApp withdraw tracking empty-state CTA does nothing |
| FR-007 | uniapp | P1 | dead-control | verified | /#/pages/tx/hash | UniApp transaction Copy hash has no feedback or state change |
| FR-008 | frontend | P1 | dead-control | verified | /learn | Learn article cards are href dead controls |
| FR-009 | uniapp | P1 | dead-control | verified | /#/pages/me/help,/#/pages/me/support,/#/pages/me/support-tickets | UniApp support entry CTAs do nothing |
| FR-010 | uniapp | P1 | fake-write | verified | /#/pages/me/profile | UniApp profile Save Changes has no observable effect |
| FR-011 | uniapp | P1 | flow-break | verified | /#/pages/me/me,/#/pages/me/trial | UniApp Claim trial CTAs do nothing |
| FR-012 | uniapp | P1 | dead-control | verified | /#/pages/team/agent,/#/pages/team/quota | UniApp team incentive CTAs do not route or submit |
| FR-013 | uniapp | P1 | dead-control | verified | /#/pages/genesis/how-it-works,/#/pages/genesis/marketplace,/#/pages/events/events,/#/pages/me/proof | UniApp external/deep-link CTAs have no response |
| FR-014 | uniapp | P1 | flow-break | verified | /#/pages/me/wallet-withdraw,/#/pages/me/wallet-exchange,/#/pages/me/wallet-repurchase,/#/pages/team/team | UniApp persona finance controls render but lack stable business-operable targets |
| RT-016 | admin | P1 | modal-blocked | verified | all-admin-operation-confirm-modals | Operation confirmation modals hide business-specific detail behind generic summary |
