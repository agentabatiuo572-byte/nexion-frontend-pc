# UniApp Checkout Flow Runtime Evidence

Date: 2026-06-12

Target build: `D:\WORKS\PLAN\Nexion-uniapp`

Runtime URL used for this verification: `http://localhost:5174`

## Scope

- `FR-003`: checkout `Continue` must advance the payment flow.
- `FR-004`: empty orders `Browse Store` must route back to the store.
- Same-shape store CTA checks: product detail sticky `Buy now`, store `Orders`, order-detail `View on Earn`, order-detail back, and store-domain page-header back controls must be actionable, not decorative.

## Browser Verification

Manual Playwright verification on `http://localhost:5174/#/pages/store/checkout?product=stellarbox-s1`:

1. `Continue` rendered as a button and advanced from payment selection to `Review order`.
2. `Pay now` advanced to chain payment instructions with QR/address, amount/network, `I've completed the payment`, and `Cancel`.
3. `I've completed the payment` advanced through awaiting/confirmed/live and showed `Order placed`.
4. Runtime storage contained a new `nexion-orders-v4` order:
   - `productId=stellarbox-s1`
   - `productName=NexionBox S1`
   - `paymentMethod=usdt-trc20`
   - `status=paid`
5. Runtime storage contained a new `nexion-bills-v1` purchase bill:
   - `type=purchase`
   - `symbol=USDT`
   - `amount=-1299`
   - `status=posted`
   - `ref` matched the created order id.
6. `Track Order` routed to `/pages/store/order-detail?id=<created-order-id>` and the detail page displayed the created order.
7. With orders storage cleared and the app reloaded, `/pages/store/orders` showed the empty state. Clicking the empty-state `Browse Store` card routed to `/#/pages/store/store`.
8. Clicking the store page `Orders` chip routed to `/#/pages/store/orders`.
9. With a seeded activated order, order detail `View on Earn` routed to `/#/pages/earn/earn`.
10. With the same seeded order, order detail `Back to orders` routed to `/#/pages/store/orders`.
11. Direct-load header back controls on checkout, product detail, orders, and bundle all routed deterministically to `/#/pages/store/store`.

## Machine Verification

Commands:

```powershell
cd D:\WORKS\PLAN\Nexion-uniapp
npm run type-check
bash scripts/verify.sh
```

Result:

- `vue-tsc --noEmit`: pass.
- `scripts/verify.sh`: 14 pass, 0 fail. H5 route HTTP check skipped because the verifier is hardcoded to `http://localhost:5173`, while this run used `http://localhost:5174` because 5173 was already occupied.

Command:

```powershell
cd D:\WORKS\PLAN\Nexion-admin-prototype
$env:UNI_BASE_URL='http://localhost:5174'
$env:FRONT_ACTION_SAMPLE_LIMIT='3'
node scripts\remediation-runtime-front-action-sample.mjs UNI-FR-03
```

Result:

```json
{
  "routes": 6,
  "samples": 8,
  "sampled": 8,
  "errors": 0,
  "noObservableChange": 0,
  "clickTargetMissing": 0,
  "routeNavigation": 7,
  "observableChange": 1
}
```

Same-shape scans:

```powershell
cd D:\WORKS\PLAN\Nexion-uniapp
rg -n 'navigateBack|@click=' src\pages\store src\components\store
```

Result:

- `navigateBack`: 0 hits in store-domain target files.
- Bare `@click=`: only `src\components\store\product-card.vue` root remains, and that node is already dual-bound with `@tap` + `@click`.

Browser back-control batch:

```json
[
  {"name":"checkout","url":"http://localhost:5174/#/pages/store/store","ok":true},
  {"name":"detail","url":"http://localhost:5174/#/pages/store/store","ok":true},
  {"name":"orders","url":"http://localhost:5174/#/pages/store/store","ok":true},
  {"name":"bundle","url":"http://localhost:5174/#/pages/store/store","ok":true}
]
```

Evidence files:

- `docs/audit/shards/uni-fr-03-front-action-sample.ndjson`
- `docs/audit/screenshots/uni-fr-03-hash-pages-store-checkout-Continue-front-after.png`
- `docs/audit/screenshots/uni-fr-03-hash-pages-store-orders-Browse-Store-front-after.png`
- `docs/audit/screenshots/uni-fr-03-hash-pages-store-detail-Buy-now-front-after.png`
