// Current customer conversations and the retired-ticket boundary.
// Authority: uvel-docs handoffs/2026-10-28/backend/05-support-customer-chain.md.
// This source-contract gate does not claim a deployed customer-message proof.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";
import { collectActiveNavLeaves } from "./lib/ops-actions-reverse-coverage.mjs";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const supportSourceFiles = {
  nav: ["admin", "lib/nav/console-nav.ts"],
  registry: ["admin", "lib/admin/registry/m.ts"],
  view: ["admin", "app/components/domain-views/m-view.tsx"],
  dispatch: ["admin", "app/components/domain-views/registry.tsx"],
  chat: ["admin", "app/components/domain-views/m-tabs/m3-dedicated-chat.tsx"],
  client: ["admin", "lib/admin/m-support-client.ts"],
  knowledge: ["admin", "app/components/domain-views/m-tabs/m4-kb-sla.tsx"],
  proxy: ["admin", "app/api/admin/content/[...path]/route.ts"],
  pipeline: ["admin", "scripts/verify.mjs"],
  appApi: ["app", "src/api/support-api.ts"],
  appStore: ["app", "src/store/conversations.ts"],
  controller: ["backend", "src/main/java/ffdd/opsconsole/content/web/AppSupportController.java"],
  service: ["backend", "src/main/java/ffdd/opsconsole/content/application/AppSupportService.java"],
  retired: ["backend", "src/main/java/ffdd/opsconsole/content/web/RetiredSupportTickets.java"],
  timeoutStatus: ["admin", "lib/admin/customer-conversations.ts"],
  idleScheduler: ["backend", "src/main/java/ffdd/opsconsole/content/application/ConversationIdleTimeoutScheduler.java"],
};

export function loadSupportSources({ adminRoot = ROOT, appRoot, backendRoot }) {
  const roots = { admin: adminRoot, app: appRoot, backend: backendRoot };
  return {
    ...Object.fromEntries(Object.entries(supportSourceFiles).map(([key, [scope, file]]) => {
      try { return [key, fs.readFileSync(path.join(roots[scope], file), "utf8")]; }
      catch { return [key, ""]; }
    })),
    appTicketStoreExists: fs.existsSync(path.join(appRoot, "src/store/tickets.ts")),
  };
}

/** The old App ticket capability is a blocked, observed boundary, never a built write. */
export function validateRetiredTicketAction(manifest) {
  const row = manifest.rows?.find(item => item.id === "OPS-M-26");
  const problems = [];
  if (manifest.activeLeafCoverage?.M2 !== undefined) problems.push("retired M2 must not claim an active navigation capability");
  if (!row || row.status !== "readonly" || !/工单/.test(row.reason ?? "")
    || !/退役|下线/.test(row.reason ?? "") || !/410/.test(row.reason ?? "")) {
    problems.push("OPS-M-26 must be readonly with the approved ticket retirement and 410 reason");
  }
  if (row && (row.storeAction || row.restAction || row.restActions || row.serviceDelegations || row.runtimeConsumerContract)) {
    problems.push("OPS-M-26 must not claim a ticket write action or pending implementation");
  }
  for (const type of ["pc-runtime", "uniapp-runtime", "backend-runtime"]) {
    if (!row?.runtimeEvidence?.some(item => item.type === type)) problems.push("OPS-M-26 missing " + type + " retirement evidence");
  }
  return problems;
}

/** Reply deadlines remain visible; the retired idle closer must not terminate threads. */
export function auditReplyTimeoutBoundary({ timeoutStatus = "", idleScheduler = "" }) {
  const failures = [];
  for (const regex of [/export function replyTimeout\(/, /已超时 · 待处理/, /严重超时 · 待处理/]) {
    if (!regex.test(timeoutStatus)) failures.push("timeoutStatus: missing " + regex);
  }
  if (/closeConversation\(|transferConversation\(/.test(timeoutStatus)) failures.push("timeoutStatus: reply-time display must not close or transfer the conversation");
  if (!/@Deprecated/.test(idleScheduler) || !/sweep\(\)\s*\{\s*return new SweepResult\(0,\s*0\);\s*\}/.test(idleScheduler)) failures.push("idleScheduler: retired automatic closer must remain disabled");
  if (/mapper\.selectDue(?:Warning|Close)Candidates\(|mapper\.pendingRepliesCurrent\(/.test(idleScheduler)) failures.push("idleScheduler: retired idle close sweep revived");
  return failures;
}

export function auditSupportSurface(sources) {
  const callable = (source, name) => {
    const tree = ts.createSourceFile("support.ts", source ?? "", ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    let found = "";
    const visit = node => {
      if (ts.isPropertyAssignment(node) && node.name.getText(tree) === name) found = node.getText(tree);
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(tree);
      ts.forEachChild(node, visit);
    };
    visit(tree); return found;
  };
  sources = { ...sources,
    clientReply: callable(sources.client, "sendConversationReply"),
    clientJson: callable(sources.client, "json"),
    clientRequest: callable(sources.client, "request"),
    appReply: callable(sources.appApi, "replyConversation"),
    backendReply: sources.service?.match(/\bpublic[^\n]*\breplyConversation\([\s\S]*?(?=\r?\n    (?:public|private|protected)\b)/)?.[0] ?? "",
  };
  const failures = [];
  function check(key, required, forbidden = []) {
    const source = sources[key] ?? "";
    if (!source) { failures.push(key + ": required source missing"); return; }
    for (const regex of required) if (!regex.test(source)) failures.push(key + ": missing " + regex);
    for (const regex of forbidden) if (regex.test(source)) failures.push(key + ": retired or unsafe contract " + regex);
  }
  const expectedRoutes = ["/service/overview", "/service/sessions", "/service/leaderboard", "/service/kb-sla", "/service/scripts"];
  const routes = collectActiveNavLeaves(sources.nav ?? "").filter(leaf => leaf.path.startsWith("/service/")).map(leaf => leaf.path).sort();
  if (JSON.stringify(routes) !== JSON.stringify([...expectedRoutes].sort())) failures.push("nav: active service routes must be the five live customer-service capabilities");
  check("nav", [/code:\s*"M"/, /slug:\s*"service"/], [/path:\s*"\/service\/tickets"/, /path:\s*"\/content\/(?:support|conversation-center)"/]);
  // The registry can retain a historical route description. Active IA/rendering grants the entry.
  check("registry", expectedRoutes.map(route => new RegExp(route.replaceAll("/", "\\/"))));
  check("view", [
    /tab\s*===\s*"M2"\s*&&\s*<p>工单服务已下线/,
    /tab\s*===\s*"M3"\s*&&\s*<M3DedicatedChat\s+ctx=\{ctx\}/,
    /tab\s*===\s*"M4"\s*&&\s*<M4KbSla\s+ctx=\{ctx\}/,
    /<M5ServiceRules\b/,
  ], [/<M2Tickets\b/, /from\s*["'][^"']*m2-tickets["']/]);
  check("dispatch", [/M:\s*MDomainView/, /meta\.l2Id\s*===\s*"M6"[\s\S]{0,60}<M6Leaderboard/]);
  check("chat", [
    /supportClient\.sendConversationReply\(record\.conversationId,\s*input,\s*record\.key\)/,
    /supportClient\.startConversation\(/,
    /supportClient\.command\(record\.key\)/,
    /rememberPending\(pendingKey\(adminId\),\s*record\.key,\s*record\)/,
    /expectedAssignmentId:\s*record\.expectedAssignmentId/,
    /expectedVersion:\s*record\.expectedVersion/,
    /replyTimeout\(convo\.pendingReplySince,\s*timeoutNow,\s*timeoutPolicy\.warnMinutes,\s*timeoutPolicy\.closeMinutes\)/,
  ], [/data-proof=["']session-to-ticket["']/, /supportClient\.(?:createTicket|convertToTicket)\(/]);
  check("client", [/"Idempotency-Key":\s*key/]);
  check("clientJson", [/headers:\s*keyHeader\(key\)/, /body:\s*JSON\.stringify\(body\)/]);
  check("clientRequest", [/const headers = new Headers\(init\.headers\)/, /guardedFetch\([^\n]*\{\s*\.\.\.init,\s*headers,/]);
  check("clientReply", [
    /sendConversationReply:\s*\(/,
    /\/replies\x60[\s\S]{0,100}json\("POST"/,
    /expectedStatus:\s*input\.expectedStatus/,
    /expectedVersion:\s*count\(input\.expectedVersion/,
    /expectedAssignmentId:\s*wireId\(input\.expectedAssignmentId/,
    /\},\s*idempotencyKey,\s*signal\)\)\s*$/,
  ], [/\bidempotencyKey\s*=(?!=|>)/]);
  check("knowledge", [/data-proof="support-faq-save"/, /I\.support\.faqs/, /filter\(faq\s*=>\s*faq\.surface\s*!==\s*"Ticket Create"\)/], [/data-proof="support-sla-category"/, /setParam\(\s*["']I\.support\.sla/]);
  check("proxy", [/["']conversations["']/, /ADMIN_TOKEN_COOKIE/, /Authorization:\s*\x60Bearer \$\{token\}\x60/, /headers\.set\(IDEMPOTENCY_KEY_HEADER,\s*idempotencyKey\)/, /method:\s*request\.method/, /cache:\s*"no-store"/]);
  check("pipeline", [/admin-support-surface-audit\.mjs/]);
  if (sources.appTicketStoreExists) failures.push("app: retired tickets store must stay absent");
  check("appApi", [
    /async function allConversations\(/,
    /parseConversationPage\(await client\.request/,
    /supportPath\("\/conversations\/cursor"\)/,
    /SUPPORT_CONVERSATION_PAGE_INCOMPLETE/,
  ], [/\b(?:createTicket|replyTicket|closeTicket|allTickets)\s*[:(]/, /supportPath\(["'\x60]\/tickets/]);
  check("appReply", [/\/replies/, /idempotencyKey:\s*requiredKey\(key\)/, /clientMessageId:\s*key/, /expectedStatus:\s*conversation\.status\.toUpperCase\(\)/, /expectedVersion:\s*conversation\.version/], [/\bkey\s*=(?!=|>)/]);
  check("appStore", [
    /supportApi\.conversations\(\)/,
    /supportApi\.conversation\(/,
    /supportApi\.startConversation\(/,
    /supportApi\.replyConversation\(/,
    /supportApi\.commandResult\(/,
    /persistSupportPending/,
  ], [/@\/mock\/(?:tickets|conversations)/, /\buseTickets\(/]);
  check("controller", [
    /@RequestMapping\("\/api\/app\/support"\)/,
    /@GetMapping\("\/conversations\/cursor"\)/,
    /@PostMapping\("\/conversations\/\{conversationNo\}\/replies"\)/,
    /service\.replyConversation\(/,
  ], [/@(?:Get|Post|Patch)Mapping\("\/tickets/]);
  check("backendReply", [
    /idempotent\("APP_CONVERSATION_REPLY:/,
    /matches\(conversation\.status\(\),\s*conversation\.version\(\),\s*request\.expectedStatus\(\),\s*request\.expectedVersion\(\)\)/,
    /conversationRepository\.replyAsUser\(/,
    /conversationConflict\(\)/,
  ]);
  check("service", [], [/idempotent\("APP_SUPPORT_TICKET_CREATE:/, /ticketRepository\.createTicket\(/]);
  check("retired", [/class RetiredSupportTickets\b/,
    /public boolean preHandle\([^\{]*\{\s*if\s*\(!retired\(request\.getServletPath\(\)\)\)\s*return true;\s*response\.setStatus\(410\);/,
    /json\.writeValue\([^;]*ApiResult\.fail\(410,\s*"SUPPORT_TICKETS_RETIRED"\)\);\s*return false;/,
  ]);
  // Only the reviewed Java predicate grammar is interpreted. Unknown control
  // flow fails closed rather than treating every matching string as reachable.
  const retired = sources.retired ?? "";
  const predicate = retired.match(/public static boolean retired\(String path\)\s*\{([\s\S]*?)\r?\n    \}/)?.[1]?.replace(/\/\/[^\r\n]*/g, "").trim() ?? "";
  const flow = predicate.match(/^if\s*\(((?:path\.equals\("[^"]*"\)\s*(?:\|\|\s*)?)+)\)\s*return false;\s*return\s+((?:path\.matches\("[^"]*"\)\s*(?:\|\|\s*)?)+);$/);
  if (!flow) failures.push("retired: predicate control flow changed and needs an explicit contract review");
  const patterns = [...(flow?.[2] ?? "").matchAll(/path\.matches\("([^"]*)"\)/g)].map(match => new RegExp("^(?:" + match[1] + ")$"));
  const exceptions = [...(flow?.[1] ?? "").matchAll(/path\.equals\("([^"]*)"\)/g)].map(match => match[1]);
  const blocked = route => !exceptions.includes(route) && patterns.some(regex => regex.test(route));
  for (const route of [
    "/api/app/support/tickets", "/api/app/support/acceptance/tickets/TK-1",
    "/api/admin/content/tickets/TK-1/replies", "/api/admin/content/support/acceptance/tickets/TK-1",
    "/api/app/support/conversations/CV-1/ticket", "/api/admin/content/conversations/CV-1/ticket",
    "/api/app/support/sla-targets", "/api/admin/content/knowledge/sla/technical",
  ]) if (!blocked(route)) failures.push("retired: missing 410 path coverage " + route);
  for (const route of ["/api/admin/content/tickets/load-config", "/api/admin/content/tickets/load-config/rebalance", "/api/app/support/conversations/CV-1/replies"]) {
    if (blocked(route)) failures.push("retired: live customer-service route blocked " + route);
  }
  if (!/if\s*\(path\.equals[\s\S]*?\)\s*return false;/.test(retired)) failures.push("retired: seat-capacity exceptions must stay explicit");
  failures.push(...auditReplyTimeoutBoundary(sources));
  return failures;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const appRoot = resolveNexionAppRoot({ adminRoot: ROOT });
  const backendRoot = resolveNexionBackendRoot({ adminRoot: ROOT });
  const failures = auditSupportSurface(loadSupportSources({ appRoot, backendRoot }));
  if (failures.length) {
    console.error("admin-support-surface-audit failed\n" + failures.map(failure => "- " + failure).join("\n"));
    process.exitCode = 1;
  } else console.log("admin-support-surface-audit passed: live conversations + FAQ + five routes + ticket 410 retirement");
}
