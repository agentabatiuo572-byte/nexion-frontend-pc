import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveNexionAppRoot } from "../scripts/lib/nexion-workspace-paths.mjs";

const root = new URL("../", import.meta.url);
const appRoot = resolveNexionAppRoot({ adminRoot: path.resolve(import.meta.dirname, "..") });
const appPage = readFileSync(path.join(appRoot, "src/pages/me/wallet-exchange.vue"), "utf8");
const appApi = readFileSync(path.join(appRoot, "src/api/exchange-api.ts"), "utf8");
const backendSwap = readFileSync(new URL("../nexion-backend/src/main/java/ffdd/opsconsole/market/application/AppExchangeService.java", root), "utf8");
const backendQueue = readFileSync(new URL("../nexion-backend/src/main/java/ffdd/opsconsole/market/application/G2ExchangeQueueBatchService.java", root), "utf8");
const feeService = readFileSync(new URL("../nexion-backend/src/main/java/ffdd/opsconsole/market/application/G2ExchangeFeeAllocationService.java", root), "utf8");
const migration = readFileSync(new URL("../nexion-backend/scripts/migrations/20260727_g2_exchange_fee_allocation.sql", root), "utf8");
const pcPage = readFileSync(new URL("app/components/domain-views/g-tabs/g2-exchange.tsx", root), "utf8");

test("App remote exchange uses canonical commands and keeps local writes in explicit mock branch", () => {
  assert.match(appPage, /exchangeApi\.fetchState\(\)/);
  assert.match(appPage, /exchangeApi\.swap\(/);
  assert.match(appPage, /exchangeApi\.cancel\(/);
  assert.match(appPage, /if \(remoteApiEnabled\)[\s\S]*return;[\s\S]*Explicit mock mode only/);
  assert.match(appApi, /serverCanonical !== true/);
  assert.match(appApi, /idempotencyKey/);
});

test("immediate and queued swaps allocate every non-zero fee 30 percent to burn pool and 70 percent to D1 buffer", () => {
  assert.match(backendSwap, /feeAllocationService\.allocate\(exchangeNo, fee, price\)/);
  assert.match(backendQueue, /feeAllocationService\.allocate\(row\.exchangeNo\(\),fee,price\)/);
  assert.match(feeService, /BURN_RATIO = new BigDecimal\("0\.30"\)/);
  assert.match(feeService, /BigDecimal feeBuffer = total\.subtract\(burnPool\)/);
  assert.match(feeService, /EXCHANGE_FEE_ALLOCATION_CONFLICT/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS nx_exchange_fee_allocation/);
  assert.match(migration, /total_fee_usdt=burn_pool_usdt\+fee_buffer_usdt/);
});

test("PC queue cancellation accurately states that queued funds are reserved and refunded", () => {
  assert.match(pcPage, /源资产已冻结/);
  assert.match(pcPage, /原路返还/);
  assert.doesNotMatch(pcPage, /排队阶段未扣余额/);
});
