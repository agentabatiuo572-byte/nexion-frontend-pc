import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M3 fails closed when the conversation backend is unavailable and respects write permission", () => {
  const client = read("lib/admin/m-client.ts");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(client, /conversationsAvailable: boolean/);
  assert.match(client, /"I\.session\.conversationsAvailable": data\.conversationsAvailable \? "1" : "0"/);
  assert.match(sessions, /pget\("I\.session\.conversationsAvailable"\) === "1"/);
  assert.doesNotMatch(sessions, /pget\("I\.session\.conversationsAvailable"\) !== "0"/);
  assert.match(sessions, /service_m3_write/);
  assert.match(sessions, /会话数据暂时无法同步/);
  assert.match(sessions, /当前账号为只读模式/);
});

test("M3 loads all backend pages and exposes the PRD category filter", () => {
  const client = read("lib/admin/m-client.ts");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(client, /async function fetchAllSupportConversations/);
  assert.match(client, /while \(records\.length < total\)/);
  assert.match(sessions, /typeFilter/);
  assert.match(sessions, /全部类别/);
  assert.match(sessions, /专属顾问/);
  assert.match(sessions, /普通客服/);
});

test("M3 waits for backend truth before clearing forms, closing dialogs, or showing success", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const types = read("app/components/domain-views/m-tabs/types.ts");

  assert.match(sessions, /const commitM3Write = async/);
  assert.match(sessions, /const succeeded = await commitM3Write/);
  assert.match(sessions, /if \(succeeded\) setReplyBody\(""\)/);
  assert.match(view, /const succeeded = await mc\.run/);
  assert.match(view, /if \(succeeded !== false\) setActionConfirm\(null\)/);
  assert.match(types, /addCustomerTag: .*Promise<boolean>/);
  assert.match(types, /addCustomerNote: .*Promise<boolean>/);
});

test("M3 uses dedicated atomic backend commands for conversion and batch archive", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(sessions, /I\.session\.ticket\.__create/);
  assert.match(sessions, /I\.session\.archiveBatch\.__create/);
  assert.match(view, /convertConversationToTicket/);
  assert.match(view, /archiveConversations/);
  assert.match(client, /\/conversations\/archive\/batch/);
  assert.doesNotMatch(sessions, /工单写入 <span className="mono">I\.support\.tickets<\/span>/);
});

test("M3 retries an unknown-result write with the same payload and idempotency key", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  // 命令号 + 稳定值落共享持久化 store(sessionStorage),刷新后重试仍是同一号与同一个值。
  assert.match(view, /mCommands = createPendingMutationStore<MCommandRecord>\(\{/);
  assert.doesNotMatch(view, /pendingMCommandAttempts/);
  assert.match(view, /mCommands\.remember\(commandSlot\(commandFingerprint\), idempotencyKey, \{ value: stableValue/);
  assert.match(view, /const commandFingerprint = meta\?\.commandKey/);
  assert.match(view, /const stableValue = attempt\?\.value \?\? value/);
  assert.match(view, /pendingMCommandBaselines/);
  assert.match(view, /applyMBackendWrite\(key, stableValue, stableBaseline\.legacyParams, stableBaseline\.data/);
  assert.match(view, /applyMBackendWrite\(key, stableValue/);
  assert.match(sessions, /`m3:reply:/);
  assert.match(sessions, /`m3:initiate:/);
  assert.match(client, /replyConversation\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /transferConversation\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /initiateConversation\([\s\S]{0,300}reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /headers: idempotencyKey \? \{ "Idempotency-Key": idempotencyKey \} : undefined/);
  assert.match(view, /writeConversationRows\([^;]+idempotencyKey\)/);
  assert.match(client, /expectedStatus: toBackendConversationStatus\(expectedStatus\)/);
  assert.match(view, /updateConversationStatus\(row\.id, row\.status, before\.status, before\.version, reason, idempotencyKey\)/);
  assert.match(view, /archiveConversation\(row\.id, Boolean\(row\.archived\), before\.status, before\.version, reason, idempotencyKey\)/);
});

test("M3 transfer decisions preserve the backend TRANSFERRED snapshot for CAS", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /type ConversationExpectedStatus = SessionConvo\["status"\] \| "transferred"/);
  assert.match(view, /acceptTransfer\(row\.id, "transferred", before\.version/);
  assert.match(view, /returnTransfer\(row\.id, target, "transferred", before\.version/);
  assert.match(view, /waitTransfer\(row\.id, "transferred", before\.version/);
  assert.doesNotMatch(view, /fallbackTransfer\(/);
  assert.doesNotMatch(client, /\/transfer\/fallback/);
  assert.doesNotMatch(view, /(acceptTransfer|returnTransfer|waitTransfer)\(row\.id,[^\n]*before\.status/);
});

test("M3 waiting is a dedicated CAS command, not a synthetic agent reply", () => {
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(view, /action\?\.includes\("transfer_wait"\) \|\| action\?\.includes\("等待处理"\)/);
  assert.match(view, /mContentActions\.waitTransfer\(row\.id, "transferred", before\.version, reason, idempotencyKey\)/);
});

test("M3 keeps the acceptance sandbox visibly separate and cannot write the production inbox while proof is active", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const sandbox = read("lib/admin/m-support-acceptance-sandbox.ts");
  const contentBff = read("app/api/admin/content/[...path]/route.ts");

  assert.match(sandbox, /\/api\/admin\/content\/support\/acceptance\/projection/);
  assert.match(sandbox, /source !== "mock"/);
  assert.match(sandbox, /sourceEnvironment !== "SANDBOX"/);
  assert.match(sandbox, /strictProfile !== true/);
  assert.match(sandbox, /proof\.productionDelta\?\.status !== "VERIFIED_ZERO"/);
  assert.match(sandbox, /proof\.productionDelta\.sandboxFacts <= 0/);
  assert.match(sandbox, /productionDeltaValues\.length !== 8/);
  assert.match(sandbox, /productionDeltaValues\.some\(value => !Number\.isSafeInteger\(value\) \|\| value !== 0\)/);
  for (const field of ["ticket", "ticketMessage", "conversation", "conversationMessage", "receipt", "audit", "idempotency", "outbox"]) {
    assert.match(sandbox, new RegExp(`proof\\.productionDelta\\.${field}`));
  }
  assert.match(sessions, /data-proof="m3-acceptance-sandbox-status"/);
  assert.match(sessions, /独立工单与会话事实/);
  assert.match(sessions, /if \(acceptanceMode !== "production"\)/);
  assert.match(sessions, /独立 sandbox 操作面/);
  assert.match(sessions, /data-proof="m3-acceptance-sandbox-panel"/);
  assert.match(sessions, /replyMSupportAcceptanceConversation/);
  assert.match(sandbox, /\/conversations\/\$\{encodeURIComponent\(row\.conversationNo\)\}\/reply/);
  assert.match(contentBff, /parts\[0\] === "support" && parts\[1\] === "acceptance"/);
});

test("M25 ledger records the scheduler-only standby fallback without inventing a manual write", () => {
  const manifest = JSON.parse(read("docs/ops-actions.manifest.json"));
  const row = manifest.rows.find((candidate) => candidate.id === "OPS-M-25");

  assert.ok(row, "M25 must remain explicitly covered by the operations ledger");
  assert.equal(row.status, "readonly");
  assert.match(row.object, /scheduler|调度器/i);
  assert.match(row.action, /30\s*分钟/);
  assert.match(row.action, /状态.*CAS|CAS.*状态/);
  assert.match(row.reason, /移除[\s\S]*人工 fallback 入口/);
  assert.equal("restAction" in row, false);
  assert.equal("restActions" in row, false);
  assert.equal("runtimeConsumerContract" in row, false);
  assert.doesNotMatch(row.action, /人工.*fallback.*(?:POST|入口)/i);
  assert.doesNotMatch(row.note ?? "", /manual M3 fallback POST/i);
});

test("M3 transfer targets retain the selected agent ID when display names collide", () => {
  const data = read("app/components/domain-views/m-tabs/data.ts");
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const view = read("app/components/domain-views/m-view.tsx");
  const client = read("lib/admin/m-client.ts");
  const sameNameDifferentIds = [
    { id: "agent-a", name: "同名客服" },
    { id: "agent-b", name: "同名客服" },
  ];

  assert.notEqual(sameNameDifferentIds[0].id, sameNameDifferentIds[1].id);
  assert.match(data, /\{ kind: "agent"; agentId: string; name: string \}/);
  assert.match(modals, /const \[selectedAgentId, setSelectedAgentId\] = useState\(agentOptions\[0\]\?\.id \?\? ""\)/);
  assert.match(modals, /a\.id !== currentOwnerId/);
  assert.match(modals, /agentOptions\.find\(\(item\) => item\.id === selectedAgentId\)/);
  assert.match(modals, /\{ kind: "agent", agentId: selectedAgent\.id, name: selectedAgent\.name \}/);
  assert.match(modals, /onClick=\{\(\) => setSelectedAgentId\(a\.id\)\}/);
  assert.match(modals, /坐席ID \{a\.id\}/);
  assert.match(modals, /data-proof=\{`session-transfer-agent-\$\{a\.id\}`\}/);
  assert.match(sessions, /currentAgentIds\.includes\(selected\.transfer\.to\.agentId\)/);
  assert.match(sessions, /<TransferModal currentOwnerId=\{selected\.ownerAgentId\}/);
  assert.match(view, /transferConversation\(row\.id, row\.transfer, before\.status, before\.version, row\.transfer\.reason \|\| reason, idempotencyKey\)/);
  assert.doesNotMatch(view, /agentIdForName\(row\.transfer\.to\.name, data\)/);
  assert.match(client, /targetId: target\.agentId, targetName: target\.name/);
  assert.doesNotMatch(client, /targetIdOverride \|\| agentIdForName\(target\.name\)/);
});

test("M3 transfer chooser gives every same-name agent a stable visible identity and never relies on list index", () => {
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");
  const e2e = read("tests/e2e/m3-final3-cross-seat-transfer-20260729.spec.ts");

  assert.match(modals, /坐席ID \{a\.id\}/);
  assert.match(modals, /data-proof=\{`session-transfer-agent-\$\{a\.id\}`\}/);
  assert.match(e2e, /getByRole\("button", \{ name: `坐席ID \$\{checkerAgent\.id\}` \}\)/);
  assert.doesNotMatch(e2e, /targetButtons\.nth\(/);
  assert.doesNotMatch(e2e, /findIndex\(\(agent\) => agent\.id === checkerAgent\.id\)/);
});

test("M3 does not expose a fake audience broadcast or fake cross-domain success", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");

  assert.doesNotMatch(modals, /圈选人群/);
  assert.doesNotMatch(sessions, /已发起「\$\{label\}」/);
  assert.doesNotMatch(sessions, /已在用户端打开/);
});

test("M3 money values and system status messages remain operator-readable", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  assert.doesNotMatch(sessions, /\{p\.recharge\}<small>USDT<\/small>/);
  assert.doesNotMatch(sessions, /\{p\.withdraw\}<small>USDT<\/small>/);
  assert.doesNotMatch(sessions, /\{p\.balance\}<small>USDT<\/small>/);
});

test("M3 starts outbound conversations with an intentional blank message and gives recoverable failure guidance", () => {
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(modals, /const \[scriptId, setScriptId\] = useState\(""\)/);
  assert.match(modals, /const \[tplId, setTplId\] = useState\(""\)/);
  assert.match(modals, /自定义开场消息/);
  assert.match(view, /写入失败(?:,数据未改变;请检查网络后重试|或结果未知,请保留当前输入并重试)/);
  // 网络细节压制仍在,但判据换了输入:client 接 guardedFetch 后网络异常到这里已是咽喉中文,
  // 原先钉的英文正则(failed to fetch|networkerror|load failed)成了死代码,守它等于守一段没人走的分支。
  assert.match(view, /includes\("网络连接失败或后台服务不可达"\)/);
});

test("M3 keeps large inbox pagination inside the list column", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const styles = read("app/components/domain-views/m-domain.css");

  assert.match(sessions, /visibleInboxPages/);
  assert.match(sessions, /m3-page-gap/);
  assert.match(styles, /\.mdom \.m3-pager-controls/);
  assert.match(styles, /max-width:\s*100%/);
  assert.match(styles, /overflow:\s*hidden/);
});

test("M3 can initiate from a real user search when the inbox is empty", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");

  assert.match(sessions, /fetchMSupportWorkbenchUsers/);
  assert.match(sessions, /workbenchUserToCustomerProfile/);
  assert.match(sessions, /showInitiate, initiateCustomerQuery/);
  assert.match(modals, /onCustomerQueryChange/);
  assert.match(modals, /customerLoading/);
  assert.match(modals, /从真实用户库搜索/);
  assert.doesNotMatch(modals, /请先确认 M3 会话接口已返回客户档案/);
});

test("M2 recognizes the canonical M3 transcript header and links back to the source conversation", () => {
  const tickets = read("app/components/domain-views/m-tabs/m2-tickets.tsx");

  assert.match(tickets, /会话号\[:：\]/);
  assert.match(tickets, /seg=archived/);
  assert.match(tickets, /\/service\/sessions\?q=/);
});

test("M3 idle timeout policy is loaded and saved through a real CAS backend contract", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");
  const client = read("lib/admin/m-client.ts");

  assert.match(client, /export type ConversationTimeoutPolicy/);
  assert.match(client, /\/conversations\/timeout-policy/);
  assert.match(client, /expectedVersion:\s*policy\.version/);
  assert.match(sessions, /service_m3_timeout_manage/);
  assert.match(sessions, /fetchMConversationTimeoutPolicy/);
  assert.match(sessions, /updateMConversationTimeoutPolicy/);
  assert.match(sessions, /data-proof="session-idle-policy"/);
  assert.match(modals, /data-proof="session-idle-policy-save"/);
  assert.match(modals, /自动结束时长必须大于提醒时长/);
  assert.doesNotMatch(modals, /ctx\.setParam/);
  assert.doesNotMatch(modals, /ctx\.logAudit/);
});

test("M3 reloads the current timeout-policy version whenever the editor is reopened", () => {
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");

  assert.match(
    sessions,
    /const openIdlePolicy = async \(\) => \{[\s\S]{0,180}const loaded = await loadIdlePolicy\(\)/,
  );
  assert.doesNotMatch(sessions, /const loaded = idlePolicy \?\? await loadIdlePolicy\(\)/);
});

test("M3 treats scheduler SYSTEM and STATUS events as reload signals instead of guessing local state", () => {
  const view = read("app/components/domain-views/m-view.tsx");

  assert.match(
    view,
    /event\.eventType === "RECEIPT"[\s\S]{0,120}event\.eventType === "STATUS"[\s\S]{0,120}event\.senderType === "SYSTEM"/,
  );
  assert.match(view, /await reconcileLiveConversationSnapshot\(connectionSignal\);\s*return;/);
  assert.match(view, /event\.eventType === "INITIATE"/);
  assert.doesNotMatch(view, /const lower = \(event\.body \?\? ""\)\.toLowerCase\(\)/);
});

test("M3 preserves persistent message ids across snapshot reload and SSE dedup", () => {
  const client = read("lib/admin/m-client.ts");
  const view = read("app/components/domain-views/m-view.tsx");
  assert.match(client, /id:\s*m\.id/);
  assert.match(view, /containsConversationMessage\(convo\.messages/);
});

test("M3 rejects fractional timeout minutes instead of silently rounding them", () => {
  const modals = read("app/components/domain-views/m-tabs/m3-modals.tsx");

  assert.doesNotMatch(modals, /Math\.round\(Number\((warn|close)\)\)/);
  assert.match(modals, /Number\.isInteger\(warnN\)/);
  assert.match(modals, /Number\.isInteger\(closeN\)/);
  assert.match(modals, /step=\{1\}/);
  assert.match(modals, /请输入整数分钟/);
});

test("M3 sandbox ticket panel supports run-scoped list, detail, reply, close and server readback", () => {
  const client = read("lib/admin/m-support-acceptance-sandbox.ts");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  assert.match(client, /\/tickets/);
  assert.match(client, /fetchMSupportAcceptanceTicket/);
  assert.match(client, /\$\{encodeURIComponent\(ticketNo\)\}/);
  assert.match(client, /replyMSupportAcceptanceTicket/);
  assert.match(client, /closeMSupportAcceptanceTicket/);
  assert.match(sessions, /sandboxTickets/);
  assert.match(sessions, /mock\/SANDBOX/);
  assert.match(sessions, /回复工单并回读/);
  assert.match(sessions, /关闭工单并回读/);
  assert.match(sessions, /canOperateAcceptanceSupport/);
  assert.match(sessions, /transferMSupportAcceptanceConversation/);
});

test("M3 acceptance proof pins the server run to its configured public run and never persists reply PII", () => {
  const client = read("lib/admin/m-support-acceptance-sandbox.ts");
  const sessions = read("app/components/domain-views/m-tabs/m3-sessions.tsx");
  assert.match(client, /NEXT_PUBLIC_NEXION_ACCEPTANCE_RUN_ID/);
  assert.match(client, /proof\.runId !== configuredRunId/);
  assert.match(client, /crypto\.subtle\.digest\("SHA-256"/);
  assert.doesNotMatch(client, /\$\{method\}:\$\{path\}:\$\{body\}/);
  assert.match(sessions, /Run \{acceptanceProof!?\.runId\}/);
  assert.match(sessions, /正式写入验证零：工单/);
});

test("M3 sandbox unknown writes read back the same opaque command before a new CAS attempt", () => {
  const client = read("lib/admin/m-support-acceptance-sandbox.ts");
  assert.match(client, /\/commands\/\$\{encodeURIComponent\(commandKey\)\}/);
  assert.match(client, /reconcileMSupportAcceptancePending/);
  assert.match(client, /delete parsed\.expectedVersion/);
  assert.match(client, /pendingCommands\.remember\(fingerprint, commandKey, \{ operation: method, target: path \}\)/);
  assert.doesNotMatch(client, /target: body|operation: body/);
});

test("M3 adopts a committed unknown command after refresh instead of minting a second reply key", () => {
  const client = read("lib/admin/m-support-acceptance-sandbox.ts");
  assert.match(client, /settled: true/);
  assert.match(client, /const committed = pendingCommands\.list\(\)\.find\(row => row\.fingerprint === fingerprint && row\.settled\)/);
  assert.match(client, /await pendingCommandResult\(committed\.commandKey\)/);
  assert.match(client, /pendingCommands\.forget\(fingerprint\);\s*return adopted/);
  assert.doesNotMatch(client, /settledResults/);
  assert.match(client, /delete parsed\.expectedVersion/);
});
