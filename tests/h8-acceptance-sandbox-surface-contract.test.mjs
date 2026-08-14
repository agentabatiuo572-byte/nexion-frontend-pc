import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [client, screen, service, controller, mapper, runScope] = await Promise.all([
  read("lib/admin/h-client.ts"),
  read("app/components/domain-views/h-tabs/h8-referral-rewards.tsx"),
  read("../backend/src/main/java/ffdd/opsconsole/growth/application/OpsReferralRewardService.java"),
  read("../backend/src/main/java/ffdd/opsconsole/growth/web/AcceptanceSandboxReferralRewardController.java"),
  read("../backend/src/main/java/ffdd/opsconsole/growth/mapper/ReferralRewardMapper.java"),
  read("../backend/src/main/java/ffdd/opsconsole/growth/application/H8AcceptanceSandboxRunScope.java"),
]);

assert.match(client, /NEXT_PUBLIC_NEXION_H8_ACCEPTANCE_RUN_ID/);
assert.match(client, /\/referral-rewards\/acceptance\/overview/);
assert.match(client, /\/referral-rewards\/acceptance\/sandbox-settlements/);
assert.match(client, /runH8AcceptanceSandboxSettlement[\s\S]{0,1800}H8OutcomeUncertainError/,
  "acceptance settlement response loss must retain its stable command key");
assert.match(client, /runH8AcceptanceSandboxSettlement[\s\S]{0,1800}outcomeStaysUnknown/);
assert.match(client, /fetchH8AcceptanceSandboxOverview/,
  "RunID-scoped acceptance overview must be available for authoritative readback");
assert.match(client, /parseH8AcceptanceSandboxSettlement\(value: unknown\)/,
  "the root settlement map needs one strict, documented parser");
assert.match(client, /sandboxSettlement\.sourceEnvironment/);
assert.match(client, /source !== "mock" \|\| sourceEnvironment !== "SANDBOX"/,
  "settlement response must prove mock/SANDBOX provenance");
assert.match(client, /settlement\.runId !== runId/,
  "a legal response from another RunID must not be accepted by the PC");
assert.match(client, /const settlement = parseH8AcceptanceSandboxSettlement\(result\)/,
  "POST data is the root settlement map, never a nested wrapper");
assert.match(client, /sourceEnvironment.*SANDBOX/);
assert.match(client, /runId/);
assert.match(screen, /runH8AcceptanceSandboxSettlement/);
assert.match(screen, /data\?\.settlementMode === "SANDBOX"/);
const sandboxStart = screen.indexOf('if (data?.settlementMode === "SANDBOX")');
const sandboxRun = screen.indexOf("runH8AcceptanceSandboxSettlement", sandboxStart);
const productionProposal = screen.indexOf("findHighOp(\"h8_referral_settlement\")", sandboxStart);
assert.ok(sandboxRun > sandboxStart && sandboxRun < productionProposal);
assert.doesNotMatch(screen.slice(sandboxStart, productionProposal), /propose\(|h8_referral_settlement/,
  "sandbox-visible settlement cannot create a production A2 proposal");
assert.match(screen.slice(sandboxStart, productionProposal), /fetchH8AcceptanceSandboxOverview/,
  "unknown sandbox outcomes must read back the authoritative RunID projection before retry");
assert.match(screen, /sandboxVisible \? <span className="f-foot">只读配置快照<\/span> : canWrite/,
  "sandbox H8 must not expose production configuration mutation controls");
assert.match(screen, /每 RunID \+ 受邀用户仅结算一次/,
  "sandbox settlement uniqueness must be described in its actual RunID scope");
assert.match(screen, /最近 Sandbox 结算记录/,
  "sandbox facts must never be labelled as real awards");
assert.match(screen, /sandboxVisible\s*\?\s*"Sandbox 结算只读取此服务端配置快照，不提供参数修改入口。"/,
  "sandbox surface cannot describe its fixture projection as a real settlement effect");
assert.match(controller, /@GetMapping\("\/overview"\)/);
assert.match(controller, /runScope\.requireCurrentRunId\(runId\)/,
  "overview query RunID must equal the server-owned acceptance RunID");
assert.match(controller, /runScope\.requireCurrentRunId\(request == null \? null : request\.runId\(\)\)/,
  "settlement body RunID must equal the server-owned acceptance RunID before service invocation");
assert.match(service, /H8_PRODUCTION_SETTLEMENT_FORBIDDEN_IN_SANDBOX/);
assert.match(service, /H8_PRODUCTION_OVERVIEW_FORBIDDEN_IN_SANDBOX/);
assert.match(runScope, /H8_SANDBOX_RUN_ID_REQUIRED/);
assert.match(runScope, /H8_SANDBOX_RUN_ID_MISMATCH/);
assert.match(service, /sandboxRunScope\.requireCurrentRunId/,
  "service also gates direct calls before command/audit persistence");
assert.match(service, /"source", "mock"/);
assert.match(mapper, /run_id/);
assert.match(mapper, /nx_h8_sandbox_referral_settlement/);
const productionSettlement = mapper.slice(mapper.indexOf("INSERT IGNORE INTO nx_referral_reward_settlement"), mapper.indexOf("int insertSettlement"));
assert.doesNotMatch(productionSettlement, /run_id/,
  "RunID facts must never alter the production settlement schema or write path");
assert.doesNotMatch(mapper.slice(mapper.indexOf("insertSandboxSettlement"), mapper.indexOf("int insertSandboxLedger")), /nx_referral_reward_settlement/,
  "sandbox settlement writes must stay in the dedicated sandbox table");

console.log("h8 acceptance sandbox surface contract: PASS");
