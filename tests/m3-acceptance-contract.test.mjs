import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { parseBusinessTime } from "../lib/admin/business-time.ts";

const root = process.cwd();
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("M5 cards follow content width while tabular scripts retain their own scroller", () => {
  const view = read("app/components/domain-views/m-tabs/m5-scripts.tsx");
  const css = read("app/components/domain-views/m-domain.css");
  assert.match(view, /<div className="m5">/);
  assert.doesNotMatch(view, /gridTemplateColumns:/);
  assert.doesNotMatch(view, /<span className="mono">\{c\.type\}<\/span>/);
  assert.match(view, /managed \? "由 AI 平台统一管理" : c\.managedBy/);
  const labelLiteral = view.match(/const SEAT_LABEL[^=]*=\s*(\{[^\n]+?\});/);
  assert.ok(labelLiteral, "Human seat labels remain defined separately from wire enums");
  const labels = runInNewContext(`(${labelLiteral[1]})`);
  assert.equal(labels.GENERAL, "专属客服"); assert.equal(labels.DEDICATED, "专属客服");
  assert.equal(labels.MANAGER, "客服主管（管理资格）"); assert.equal(labels.SUPERVISOR, "客服主管（管理资格）");
  assert.match(view, /Object\.hasOwn\(SEAT_LABEL, position\)/);
  assert.match(view, /value=\{seatLabel\(position\)\} readOnly disabled/);
  assert.doesNotMatch(view, />\{agent\.position\}/);
  assert.match(view, /function isDedicatedSupportAgent\(agent: MSupportAgent\): boolean \{\s*return agent\.enabled;/);
  assert.match(view, /const serviceTypes = agent.serviceTypes;/, "Profile edits retain original service-type wire values");
  const client = read("lib/admin/m-client.ts"), support = read("lib/admin/m-support-client.ts"), data = read("app/components/domain-views/m-tabs/data.ts");
  assert.match(client, /seatType: "MANAGER" \| "DEDICATED" \| "GENERAL"/);
  assert.match(support, /enumValue\(row.seatType, \["MANAGER", "DEDICATED", "GENERAL"\]/);
  assert.match(data, /export type SessionType = "advisor" \| "support" \| "ai"/);
  assert.match(client, /const v = \(value \|\| "general"\).toLowerCase\(\)/);
  assert.match(client, /return v === "general" \? "general" : ticketCategory\(v\)/, "GENERAL ticket category remains a distinct wire contract");
  for (const name of ["m5-panels", "m5-policy-grid", "m5-seat-row", "m5-table-scroll", "m5-script-row", "m5-modal-grid", "m5-template-row", "m5-heading", "m5-pager"]) assert.ok(view.includes(name), name);
  assert.match(css, /\.mdom \.m5-table-scroll \{ overflow-x: auto; \}/);
  assert.match(css, /\.mdom \.m5-seat-row \.chip \{[^}]*max-width: 100%;[^}]*height: auto;[^}]*flex-wrap: wrap;[^}]*white-space: normal;/);
  assert.match(css, /@container mdom \(max-width: 900px\).*m5-panels.*minmax\(0, 1fr\)/);
  assert.match(css, /@container mdom \(max-width: 560px\) \{[\s\S]*?m5-policy-grid.*m5-seat-row.*m5-modal-grid.*minmax\(0, 1fr\)/);
});

test("M3 shared profile drawer fits within its actual conversation container", () => {
  const css = read("app/components/domain-views/m-domain.css");
  assert.match(css, /\.mdom \.cv-profile \{[^}]*width: min\(320px, 100%\)/);
  assert.match(css, /\.mdom \.m3-col-list \{[^}]*min-width: 0/);
  assert.match(css, /@container mdom \(max-width: 1060px\) \{[^}]*\}[\s\S]*?\.mdom \.cv-profile:not\(\.open\) \{ display: none; \}/);
  const shell = read("app/components/shell/console-shell.tsx");
  assert.match(shell, /className="grid h-screen w-screen overflow-clip"/);
  const topbar = read("app/components/shell/topbar.tsx");
  assert.match(topbar, /className="admin-topbar-operator hidden text-\[12\.5px\] sm:inline"[^>]*>[\s\S]*?\{operator\}/);
  assert.match(topbar, /justify-between gap-4 px-3 sm:px-5/);
  assert.match(topbar, /className="admin-topbar-actions flex shrink-0 items-center gap-2 whitespace-nowrap sm:gap-3"/);
  assert.match(topbar, /className="admin-topbar-location flex min-w-0 flex-1 items-center gap-4"/);
  const topbarCss = read("app/components/shell/topbar.css");
  assert.match(topbarCss, /container: admin-topbar \/ inline-size/);
  assert.match(topbarCss, /\.admin-topbar-actions\s*\{[^}]*flex: 0 0 auto;/);
  assert.doesNotMatch(topbarCss, /\.admin-topbar-actions\s*\{[^}]*white-space: nowrap;/);
  assert.match(topbarCss, /@container admin-topbar \(max-width: 1200px\)/);
  assert.match(topbarCss, /\.admin-topbar-crumb-label\s*\{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;/);
  assert.match(topbarCss, /\.admin-topbar-operator\s*\{[^}]*max-width: 140px;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/);
});

test("M2 pagination stays bounded while preserving first, last and neighboring pages", () => {
  const source = read("app/components/domain-views/m-tabs/m2-tickets.tsx");
  const productionFunction = source.match(/function visibleTicketPages[^\n]*\{[\s\S]*?\n\}/)?.[0];
  assert.ok(productionFunction);
  const visibleTicketPages = runInNewContext(ts.transpileModule(`${productionFunction}\nvisibleTicketPages;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
  for (const count of [1, 2, 5, 6, 29, 225, 1000]) {
    for (let page = 1; page <= count; page += 1) {
      const tokens = Array.from(visibleTicketPages(count, page));
      const numbers = tokens.filter((token) => typeof token === "number");
      assert.ok(tokens.length <= 7);
      assert.equal(numbers[0], 1);
      assert.equal(numbers.at(-1), count);
      assert.ok(numbers.includes(page));
      if (page > 1) assert.ok(numbers.includes(page - 1));
      if (page < count) assert.ok(numbers.includes(page + 1));
      assert.equal(new Set(tokens).size, tokens.length);
      tokens.forEach((token, index) => {
        if (typeof token === "string") assert.ok(tokens[index + 1] - tokens[index - 1] > 1);
      });
    }
  }
  assert.match(source, /filtered\.slice\(start, start \+ pageSize\)/);
  assert.match(source, /setPage\(curPage - 1\)/);
  assert.match(source, /setPage\(curPage \+ 1\)/);
  assert.match(source, /aria-current=\{p === curPage \? "page" : undefined\}/);
});

function conversationReadFixture() {
  const source = read("lib/admin/m-client.ts");
  const extract = (name) => {
    const match = source.match(new RegExp(`(?:export )?(?:async )?function ${name}[^\\n]*\\{[\\s\\S]*?\\n\\}`));
    assert.ok(match, `production function ${name} exists`);
    return match[0].replace(/^export /, "");
  };
  const parts = ["upper", "str", "num", "asArray", "asTs", "conversationStatus", "conversationType", "roleKey", "toBackendConversationStatus", "assertConversationRow", "assertConversationPage", "assertConversationDetail", "fetchAllSupportConversations", "parseSupportMessageKind", "adaptConversation"].map(extract).join("\n");
  const chat = read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  const canSend = chat.match(/const canSendTo = [\s\S]*?;/)?.[0];
  assert.ok(canSend);
  const state = {
    pages: [], requested: [], parseBusinessTime,
    adaptCustomerProfile: () => ({ nickname: "历史客户" }),
    apiRequest: async (path) => { state.requested.push(path); return state.pages.shift(); },
  };
  runInNewContext(ts.transpileModule(`${parts}\n${canSend}\nglobalThis.reads = {assertConversationRow, assertConversationDetail, fetchAllSupportConversations, adaptConversation, canSendTo, toBackendConversationStatus};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state);
  return state;
}

const transferredHistory = () => ({
  id: 5954, conversationNo: "HISTORICAL-SEGMENT", conversationType: "advisor", status: "TRANSFERRED",
  ownerAgentId: "3792", unreadCount: 0, version: 0, updatedAt: "2026-10-03T00:00:00Z",
  transferToType: null, transferToId: null,
});

test("M3 reads transferred history without inventing a pending transfer or dropping the page", async () => {
  const f = conversationReadFixture();
  const historical = transferredHistory();
  const ordinary = { ...historical, id: 5955, conversationNo: "OPEN-SEGMENT", status: "OPEN" };
  f.pages = [
    { total: 2, pageNum: 1, pageSize: 100, records: [historical] },
    { total: 2, pageNum: 2, pageSize: 100, records: [ordinary] },
  ];
  const page = await f.reads.fetchAllSupportConversations();
  assert.equal(page.records.length, 2);
  assert.equal(page.records[0], historical);
  assert.equal(historical.status, "TRANSFERRED");
  assert.equal(historical.transferToType, null);
  assert.equal(historical.ownerAgentId, "3792");
  assert.equal(f.requested.length, 2);
  const detail = { conversation: historical, messages: [] };
  assert.equal(f.reads.assertConversationDetail(detail), detail);
  const missingProjection = { ...historical };
  delete missingProjection.transferToType;
  assert.equal(f.reads.assertConversationRow(missingProjection), missingProjection);
  const adapted = f.reads.adaptConversation(detail);
  assert.equal(adapted.status, "transferred");
  assert.equal(adapted.version, 0);
  assert.equal(adapted.ownerAdminId, 3792);
  assert.equal(adapted.transfer, undefined);
  assert.equal(f.reads.canSendTo(adapted, 3792), false);
  assert.equal(f.reads.toBackendConversationStatus(adapted.status), "TRANSFERRED");
  assert.equal(f.reads.canSendTo({ ...adapted, status: "open" }, 3792), true);
});

test("M3 still rejects malformed conversation fields and unsupported present transfer targets", () => {
  const f = conversationReadFixture();
  for (const patch of [
    { id: "5954" }, { status: "UNKNOWN" }, { version: -1 }, { unreadCount: -1 },
    { updatedAt: "not-a-date" }, { conversationType: "unknown" },
    { transferToType: "" }, { transferToType: "unknown" }, { transferToType: 42 }, { transferToType: {} },
  ]) {
    assert.throws(() => f.reads.assertConversationRow({ ...transferredHistory(), ...patch }), /M3_CONVERSATION_DETAIL_INVALID/);
  }
  for (const type of ["agent", "queue", "standby"]) {
    const row = { ...transferredHistory(), transferToType: type, transferToId: "42", transferToName: "真实目标" };
    assert.equal(f.reads.assertConversationRow(row), row);
    assert.equal(f.reads.adaptConversation(row).transfer.to.kind, type);
    assert.equal(f.reads.adaptConversation({ ...row, transferToType: type.toUpperCase() }).transfer.to.kind, type);
  }
  assert.throws(() => f.reads.assertConversationDetail({ conversation: transferredHistory(), messages: [{ id: "bad" }] }), /M3_CONVERSATION_DETAIL_INVALID/);
});

test("M3 roster failure exposes qualification retry instead of claiming an empty inbox", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const chat = read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  assert.match(view, /permissionUnknown && \(tab === "M1" \|\| tab === "M2" \|\| tab === "M3" \|\| tab === "M5"\)/);
  assert.match(view, /重试核对<\/button>/);
  assert.match(chat, /qualificationUnknown.*[\s\S]*I\.support\.agentsAvailable/);
  assert.match(chat, /qualificationUnknown \? "坐席身份待核对/);
});

test("M2 customer replies require a verified advisor while internal work stays available", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const tickets = read("app/components/domain-views/m-tabs/m2-tickets.tsx");
  assert.match(view, /advisorQualified=\{Boolean\(safeMData\.supportAgentsAvailable && currentAgent\?\.enabled && currentAgent\.seatType === "DEDICATED" && currentAgent\.serviceTypes\.includes\("advisor"\)\)\}/);
  assert.match(tickets, /const canRespondToCustomers = canWriteM2 && advisorQualified/);
  assert.match(tickets, /canReply=\{canReplyToSelected\}/);
  assert.match(tickets, /ticketDetail\.replyAgentAdminId === adminId/);
  assert.match(tickets, /customer\.customerId === String\(ticket\.userId\) \? customer\.agentAdminId : null/);
  assert.match(tickets, /customer\.agentAdminId !== adminId/);
  assert.match(tickets, /current\.authEpoch === authEpoch && current\.session\?\.adminId === adminId/);
  assert.match(tickets, /support-scope-invalidated/);
  assert.ok(tickets.indexOf('setTicketDetail({ ticket, epoch: authEpoch, scope') < tickets.indexOf('await supportClient.customerDetail(String(ticket.userId)'));
  assert.match(tickets, /if \(!await verifyCustomerReply\(userId\)\) return/);
  assert.match(tickets, /run: async \(reason: string\) => \{\s*if \(!await verifyCustomerReply\(ticket\.userId!\)\) return false/);
  assert.match(tickets, /disabled=\{submitting \|\| !userId\.trim\(\)/);
  assert.match(tickets, /客户 ID（必填）/);
  assert.doesNotMatch(tickets, /用户 ID\(可选\)|也可以留空/);
  assert.match(tickets, /data-proof="support-ticket-drawer-heading"[^\n]*flexWrap: "wrap"/);
  assert.match(tickets, /overflowWrap: "anywhere".*查看会话/);
  assert.match(tickets, /data-proof="support-ticket-reply"[\s\S]*?disabled=\{submitting \|\| !canReply\}/);
  assert.match(tickets, /data-proof="support-ticket-reply-save"[^>]*disabled=\{submitting \|\| !canReply\}/);
  assert.match(tickets, /仅当前专属顾问可以回复客户/);
  assert.match(tickets, /canWrite=\{canWriteM2 && ticketsAvailable\}/);
  assert.match(tickets, /const createTicket = [\s\S]*?if \(!canRespondToCustomers/);
  assert.match(tickets, /const sendReply = [\s\S]*?!canReplyToSelected[^\n]*selected\.contentRestricted/);
  assert.match(tickets, /const escalateToConversation = [\s\S]*?!canReplyToSelected[^\n]*selected\.contentRestricted/);
  assert.match(tickets, /data-proof="support-ticket-internal-note"[\s\S]*?disabled=\{submitting\}/);
});

test("M3 explicit unbound review avoids assigned-only profile reads and reaches the real pool", () => {
  const client = read("lib/admin/m-client.ts");
  const chat = read("app/components/domain-views/m-tabs/m3-dedicated-chat.tsx");
  const workbench = read("app/components/domain-views/m-tabs/m1-personal-workbench.tsx");
  assert.match(client, /ownerUnbound: base\.ownerAgentId === null/);
  assert.match(chat, /selected\?\.ownerUnbound === true/);
  assert.match(chat, /if \(selectedUnbound\) \{[\s\S]*?return;[\s\S]*?supportClient\.customerDetail\(String\(selected\.customerId\)/);
  assert.match(chat, /lostPermission\(cause\)[\s\S]*?ctx\.invalidateScope\(selected\.id, String\(selected\.customerId\)\)/);
  assert.match(chat, /href="\/service\/overview\?view=pool"/);
  assert.match(workbench, /get\("view"\) === "pool" && permission !== "agent"/);
  assert.match(chat, /待分配顾问/);
});

test("M3 business time is independent of the browser timezone", () => {
  const instant = Date.parse("2026-09-24T05:24:00Z");
  assert.equal(parseBusinessTime("2026-09-24 13:24:00"), instant);
  assert.equal(parseBusinessTime("2026-09-24T13:24:00"), instant);
  assert.equal(parseBusinessTime("2026-09-24T05:24:00Z"), instant);
  assert.equal(parseBusinessTime("2026-09-24T13:24:00+08:00"), instant);
});

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
  assert.match(sessions, /if \(succeeded\) setReplyDraft\(\(current\)=>m3ClearDeliveredDraft\(current,recipient,body\)\)/);
  assert.match(view, /const succeeded = await mc\.run/);
  assert.match(view, /if \(succeeded !== false\) setActionConfirm\(\(current\) => current === confirming \? null : current\)/);
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
  assert.match(view, /const requestedFingerprint = meta\?\.commandKey/);
  assert.match(view, /const commandFingerprint = attempt\?\.fingerprint\.slice\("cmd\|"\.length\) \?\? requestedFingerprint/);
  assert.match(view, /const stableValue = attempt\?\.value \?\? value/);
  assert.match(view, /pendingMCommandBaselines/);
  assert.match(view, /applyMBackendWrite\(key, stableValue, stableBaseline\.legacyParams, stableBaseline\.data/);
  assert.match(view, /applyMBackendWrite\(key, stableValue/);
  assert.match(sessions, /`m3:reply:/);
  assert.match(sessions, /`m3:initiate:/);
  assert.match(client, /replyConversation\([^)]*idempotencyKey\?: string, message\?:/);
  assert.match(client, /transferConversation\([^)]*idempotencyKey\?: string\)/);
  assert.match(client, /initiateConversation\([\s\S]{0,300}reason: string, idempotencyKey\?: string\)/);
  assert.match(client, /headers: idempotencyKey \? \{ "Idempotency-Key": idempotencyKey \} : undefined/);
  assert.match(view, /writeConversationRows\([^;]+idempotencyKey\)/);
  assert.match(client, /expectedStatus: toBackendConversationStatus\(expectedStatus\)/);
  assert.match(view, /updateConversationStatus\(row\.id, row\.status, before\.status, before\.version, reason, idempotencyKey\)/);
  assert.match(view, /archiveConversation\(row\.id, Boolean\(row\.archived\), before\.status, before\.version, reason, idempotencyKey\)/);
});

test("M3 legacy transfer commands are absent from the active dedicated write path", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  const workbench = read("app/components/domain-views/m-tabs/m1-personal-workbench.tsx");

  assert.match(view, /旧会话转接已停用，请联系主管正式转绑/);
  assert.match(workbench, /supportClient\.transfer\(payload, commandKey\)/);
  assert.doesNotMatch(view, /mContentActions\.(acceptTransfer|returnTransfer|waitTransfer)\(/);
  assert.doesNotMatch(view, /fallbackTransfer\(/);
});

test("M3 waiting cannot be spoofed by a synthetic agent reply", () => {
  const view = read("app/components/domain-views/m-view.tsx");
  assert.doesNotMatch(view, /action\?\.includes\("transfer_wait"\)/);
  assert.match(view, /if \(!newMessage\.clientMessageId\) throw/);
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
  assert.doesNotMatch(view, /mContentActions\.transferConversation\(/);
  assert.match(read("app/components/domain-views/m-tabs/m1-supervisor-pool.tsx"), /supportClient\.transfer\(command\.payload, command\.key\)/);
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
  assert.match(tickets, /sourceConversationNo/);
  assert.match(tickets, /\/service\/sessions\?conversationNo=/);
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
