# Runtime Crawl Protocol

This SOP belongs to MASTER-PLAN L1 source A.

## Per Route

1. Start the relevant dev server and warm the route with HTTP first.
2. Navigate with a browser.
3. Capture accessibility snapshot, screenshot, console errors, and failed network requests.
4. Enumerate clickable/input/select/toggle elements from the runtime DOM.
5. Trigger each element once in an isolated state.
6. Classify the effect: route change / DOM state change / modal appears / toast appears / no observable effect.
7. Record dead-control when no effect is observable.
8. Record fake-write when feedback appears but refresh/persisted state does not retain the change.

For front route-level crawls, seed an audit state before navigation: authenticated session, completed onboarding, and at least one deterministic sample order. Record the expected route, sampled route, final URL, route match, runtime error text, DOM control count, accessibility interactive count, screenshot, and snapshot. Route-level success only proves reachability and render health; it does not prove the business action works.

## Front Action Sampling

Front action sampling re-opens the route, extracts current DOM action candidates, clicks one representative control, and records URL, modal/sheet, fixed feedback, body, focus, and local state changes.

Classification rules:

1. `route-navigation`, `modal-or-sheet`, `state-write`, and visible fixed feedback are strong observable effects.
2. `hash-only-no-content` is a dead-control candidate: URL changes only to a hash such as `#`, with no useful content.
3. `no-observable-change` is a dead-control or flow-break candidate unless the action is later proven to be a non-action text card.
4. `body-only-change` is not strong proof. It may be valid progress text, accordion expansion, or copy feedback, but it must be confirmed by task walkthrough before closing an issue.
5. UniApp `uni-view` / `uni-text` controls must be sampled from runtime DOM, but structural wrappers and pure status labels are not business actions.

## Every Modal

Record the five-tuple:

1. Has business-matching input controls?
2. Is confirm initially disabled?
3. If disabled, is the visible reason clear?
4. Can a valid value be submitted?
5. After submit, does the target state change and persist?

Business-matching means the modal must contain controls that can actually complete the button's promise. A role-change button needs a role selector or permission component; localized-copy edit/repair needs zh/en copy fields; course creation needs title/content/category/duration fields; Campaign edit needs title/body/audience/schedule/priority fields. A generic reason textarea or audit confirmation is not enough for edit/create/repair actions.

Visual modal presence is evidence only, not a pass condition. The auditor must inspect the modal body after opening it and decide whether the available controls match the triggering action. For example, a button labeled "改角色" / "Change role" only passes if the opened dialog exposes role-changing controls, not just a generic confirmation shell.

If a modal appears but lacks business-matching controls, record category `modal-blocked` with runtime evidence and classify the action as `business-incomplete-modal`.

Filter chips, status chips, view-parameter toggles, and same-page drilldown cards are not modal-required actions. They pass if they visibly change the selected state, toast, chart, table slice, or same-page detail panel. They only become `dead-control` if no observable runtime change occurs.

## Every List/Table

Record the list baseline:

1. Pagination or explicit exemption.
2. Page size and total count when paginated.
3. Filters.
4. Search.
5. Sorting.
6. Empty state.

Missing baseline items become category `list-capability`.
