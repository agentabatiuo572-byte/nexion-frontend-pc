import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const backend = resolve(process.cwd(), "..", "nexion-backend");
const app = resolve(process.cwd(), "..", "NX1.0");
const read = (root, path) => readFileSync(resolve(root, path), "utf8");

test("G4 sale controls are read by the public/account boundary and enforced before wallet mutation", () => {
  const service = read(backend, "src/main/java/ffdd/opsconsole/market/application/AppGenesisService.java");
  const controller = read(backend, "src/main/java/ffdd/opsconsole/market/web/AppGenesisController.java");
  const mapper = read(backend, "src/main/java/ffdd/opsconsole/market/mapper/AppGenesisMapper.java");
  assert.match(service, /SALE_PREFIX = "market\.genesis\.ops\."/);
  assert.match(service, /requireEligibleUser\(userId, series, salePolicy, quantity\);[\s\S]*debitWallet/);
  assert.match(service, /GENESIS_ACCOUNT_AGE_REQUIRED/);
  assert.match(service, /GENESIS_PRESALE_NOT_OPEN/);
  assert.match(service, /GENESIS_USER_CAP_REACHED/);
  assert.match(service, /"sale", salePolicy\.publicView/);
  assert.match(service, /"eligibility", eligibilityView/);
  assert.match(controller, /@GetMapping\("\/api\/genesis\/eligibility"\)/);
  assert.match(mapper, /TIMESTAMPDIFF\(DAY,u\.created_at,NOW\(\)\)/);
  assert.match(mapper, /userHoldingCount/);
});

test("G4 completed batch natural key replays without duplicate financial/event side effects", () => {
  const command = read(backend, "src/main/java/ffdd/opsconsole/market/application/G4AdminCommandService.java");
  const mapper = read(backend, "src/main/java/ffdd/opsconsole/market/mapper/AppGenesisMapper.java");
  assert.match(command, /lockEmissionBatch\(batchNo\)/);
  assert.match(command, /"COMPLETED"\.equals\(existing\.status\(\)\)/);
  assert.match(command, /return replayedBatch\(batchNo,existing\)/);
  assert.match(command, /"replayed",true/);
  assert.match(mapper, /nx_genesis_emission_batch[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.match(command, /"genesis\.emission_paid"/);
});

test("G4 operator config writes carry and enforce a locked expected value", () => {
  const service = read(backend, "src/main/java/ffdd/opsconsole/market/application/OpsGenesisSimulationService.java");
  const client = read(process.cwd(), "lib/admin/g4-client.ts");
  assert.match(service, /activeValueForUpdate\(PREFIX \+ configKey\)/);
  assert.match(service, /G4_CONFIG_EXPECTED_VALUE_REQUIRED/);
  assert.match(service, /G4_CONFIG_STATE_CONFLICT/);
  assert.match(service, /G4_CONFIG_NO_CHANGES/);
  assert.match(client, /JSON\.stringify\(\{ value, reason, operator, expectedValue \}\)/);
});

test("G4 new emission ledger type remains visible to G4 and BI canonical totals", () => {
  const genesisMapper = read(backend, "src/main/java/ffdd/opsconsole/market/mapper/GenesisMapper.java");
  const bi = read(backend, "src/main/java/ffdd/opsconsole/bi/application/OpsBiService.java");
  assert.match(genesisMapper, /biz_type IN \('GENESIS_DIVIDEND','GENESIS_EMISSION'\)/);
  assert.match(bi, /countLedgerBills\("GENESIS_DIVIDEND"[\s\S]*countLedgerBills\("GENESIS_EMISSION"/);
});

test("NX1.0 remote Genesis uses canonical APIs and never runs local sale ticks or local debit on remote purchase", () => {
  const api = read(app, "src/api/genesis-api.ts");
  const store = read(app, "src/store/genesis.ts");
  const purchase = read(app, "src/components/genesis/purchase-sheet.vue");
  const marketplace = read(app, "src/pages/genesis/marketplace.vue");
  assert.match(api, /path: "\/api\/genesis\/state"/);
  assert.match(api, /path: "\/api\/genesis\/account"/);
  assert.match(api, /path: "\/api\/genesis\/purchase"/);
  assert.match(api, /\/api\/genesis\/holdings\/\$\{encodeURIComponent\(holdingNo\)\}\/listing/);
  assert.match(api, /\/api\/genesis\/listings\/\$\{encodeURIComponent\(holdingNo\)\}\/buy/);
  assert.match(store, /if \(remoteApiEnabled\) return;/);
  assert.match(store, /genesisApi\.purchase\(quantity, key\)/);
  assert.match(store, /genesisApi\.buy\(holdingNo, key\)/);
  assert.match(purchase, /if \(remoteApiEnabled\) \{[\s\S]*await genesis\.purchaseCanonical\(qty\.value\)[\s\S]*return;[\s\S]*app\.debitBalance/);
  assert.match(marketplace, /if \(remoteApiEnabled\) \{[\s\S]*await genesis\.acquireSecondaryCanonical\(l\.tokenId\)[\s\S]*return;[\s\S]*app\.debitBalance/);
});
