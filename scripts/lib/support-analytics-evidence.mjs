import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { spawnSync, execFile } from "node:child_process";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
export async function findPagedAccount(card, targetSelector, timeoutMs = 30000) {
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 30000);
  const deadline = Date.now() + timeoutMs;
  const remaining = () => { const ms = deadline - Date.now(); assert.ok(ms > 0, "Account pagination deadline expired"); return ms; };
  const info = card.locator(".pager-info"), pager = card.locator(".pager-num");
  const match = (await info.innerText({ timeout: remaining() })).match(/\/\s*(\d+)\s*$/);
  assert.ok(match, "Invalid account pagination total");
  const total = Number(match[1]); assert.ok(Number.isSafeInteger(total) && total >= 0);
  await card.locator("select.pager-size").selectOption("50", { timeout: remaining() });
  const pages = Math.max(1, Math.ceil(total / 50)), visited = [];
  for (let page = 1; page <= pages; page++) {
    await pager.filter({ hasText: new RegExp(`^\\s*${page}\\s*/\\s*${pages}\\s*$`) }).waitFor({ state: "visible", timeout: remaining() });
    const currentTotal = (await info.innerText({ timeout: remaining() })).match(/\/\s*(\d+)\s*$/);
    assert.ok(currentTotal && Number(currentTotal[1]) === total, "Account list changed during pagination");
    visited.push(page);
    const target = card.locator(targetSelector), count = await target.count();
    assert.ok(count <= 1, "The authorized account selector is ambiguous");
    if (count === 1) {
      assert.equal(await target.isVisible(), true, "The authorized account is not visible");
      remaining();
      return { total, pages, visited, targetSelector };
    }
    assert.ok(page < pages, "The authorized account was not found in the actual account list");
    const next = card.getByRole("button", { name: "›", exact: true });
    assert.equal(await next.isEnabled({ timeout: remaining() }), true, "Account pagination stopped before the final page");
    await next.click({ timeout: remaining() });
  }
}
export function repositoryDigest(repo) {
  const git = args => {
    const result = spawnSync("git", ["-C", repo, ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, "Cannot bind the current Git worktree");
    return result.stdout;
  };
  const names = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString().split("\0").filter(Boolean);
  return sha256(JSON.stringify({ head: git(["rev-parse", "HEAD"]).toString(), index: sha256(git(["ls-files", "--stage", "-z"])), files: [...new Set(names)].toSorted().map(name => { const file = join(repo, name); return [name, existsSync(file) ? sha256(readFileSync(file)) : null]; }) }));
}
export function businessData(body) {
  assert.ok(body && body.code === 0 && body.data && typeof body.data === "object" && !Array.isArray(body.data), "HTTP success is not a successful business envelope");
  return body.data;
}
export function unboundCustomerSnapshot(customerId, pool, bindingPages) {
  const total = bindingPages[0]?.total;
  assert.ok(Number.isSafeInteger(total) && total >= 0, "Active binding total is unavailable");
  assert.equal(bindingPages.length, Math.max(1, Math.ceil(total / 100)), "Active binding pages are incomplete");
  const bindings = bindingPages.flatMap((page, index) => {
    assert.equal(page.total, total, "Active binding total changed during readback");
    assert.equal(page.pageNum, index + 1);
    assert.equal(page.pageSize, 100);
    assert.notEqual(page.available, false);
    assert.ok(Array.isArray(page.records));
    assert.equal(page.records.length, Math.min(100, Math.max(0, total - index * 100)), "Active binding page is incomplete");
    return page.records;
  });
  assert.ok(bindings.every(row => row.assignmentId != null && row.customerId != null));
  assert.equal(new Set(bindings.map(row => String(row.assignmentId))).size, total, "Active bindings were duplicated across pages");
  assert.ok(!bindings.some(row => String(row.customerId) === String(customerId)), "Pool customer already has an active binding");
  assert.ok(pool && Array.isArray(pool.records) && Number.isSafeInteger(pool.total));
  assert.notEqual(pool.available, false);
  assert.equal(pool.total, pool.records.length, "Pool query is incomplete");
  const matches = pool.records.filter(row => String(row.customerId) === String(customerId));
  assert.equal(matches.length, 1, "Exact pool customer is missing or duplicated");
  const customer = matches[0];
  assert.ok(Number.isSafeInteger(customer.version) && customer.version > 0, "Pool version is unavailable");
  return { ...customer, agentAdminId: null };
}
export const conversationFeatures = new Set(["sku", "attachment", "unknown-main", "unknown-dock"]);
export const consoleSidebarRoot = 'aside:has(a[aria-label="UVEL 运营控制台"])';
export const businessRoots = {
  sku: '.m3-stage .m3-col-chat', attachment: '.m3-stage .m3-col-chat',
  "unknown-main": '.m3-stage .m3-col-chat', "unknown-dock": '[data-proof="session-dock-panel"]',
  avatar: '[role="dialog"]', bulk: '[role="dialog"]', random: '[role="dialog"]',
};
export function assertUiBinding(id, observed) {
  assert.equal(observed.root, businessRoots[id], "The scenario ran in a different business surface");
  assert.equal(observed.visible, true, "The actual business surface is not visible");
  assert.equal(observed.submitInside, true, "A shell/other surface cannot stand in for this feature's submit control");
}
export const avatarProposalPath = "/api/admin/platform/audit/operations";
export const avatarApprovalTemplate = `${avatarProposalPath}/{currentProposalId}/approve`;
export function assertAvatarPolicy(policy, maker, checker) {
  assert.ok(policy, "Root-measured avatar maker/checker authorization is required");
  assert.equal(policy.operation, "a1_account_update_profile");
  assert.equal(policy.approvalPathTemplate, avatarApprovalTemplate);
  assert.ok(policy.accountId && policy.makerAdminId && policy.checkerAdminId);
  assert.notEqual(String(policy.makerAdminId), String(policy.checkerAdminId), "Avatar maker and checker must be different real admins");
  assert.notEqual(policy.makerUsername, policy.checkerUsername);
  assert.equal(maker.username, policy.makerUsername); assert.equal(String(maker.adminId), String(policy.makerAdminId));
  if (checker) {
    assert.equal(checker.username, policy.checkerUsername); assert.equal(String(checker.adminId), String(policy.checkerAdminId));
    for (const authority of ["platform_a1_write", "platform_a2_operation_approve"]) assert.ok(checker.authorities?.includes(authority), "Actual avatar checker lacks the real A2/business authority");
  }
}
export function assertAvatarProposal(input, before, uploads, allowed, policy) {
  assert.equal(input.sourceDomain, "A1"); assert.equal(input.type, "acct");
  assert.equal(input.amplifies, false); assert.equal(input.sos, false);
  assert.equal(input.command?.domain, "A"); assert.equal(input.command?.op, "a1_account_update_profile");
  const params = input.command.params;
  assert.equal(String(params.accountId), String(policy.accountId));
  assert.equal(String(before.id), String(policy.accountId));
  assert.ok(allowed.accountIds.includes(String(policy.accountId)));
  assert.equal(String(input.obj), String(policy.accountId));
  assert.deepEqual(input.target, { domain: "A", type: "account", id: String(policy.accountId) });
  assert.ok(!input.targets || input.targets.length === 0, "Avatar proposal cannot contain additional targets");
  assert.deepEqual(Object.keys(params).toSorted(), ["accountId", "avatarAssetId", "displayName", "email", "expectedVersion", "username"].toSorted(), "Avatar proposal cannot carry unrelated business fields");
  assert.equal(String(params.expectedVersion), String(before.version));
  assert.equal(params.username, before.username); assert.equal(params.displayName, before.name);
  assert.equal(params.email ?? "", before.email ?? "");
  assert.ok(params.avatarAssetId && params.avatarAssetId !== before.avatarAssetId);
  assert.ok(uploads.some(row => row.path.endsWith("/accounts/avatar-assets") && businessData(row.output).assetId === params.avatarAssetId && businessData(row.output).status === "READY"), "Avatar proposal is not bound to this run's READY upload");
  return params;
}
export function avatarApprovePath(proposal) {
  const data = businessData(proposal.output);
  assert.ok(typeof data.id === "string" && data.id);
  assert.equal(String(data.status).toUpperCase(), "PENDING");
  assert.equal(String(data.obj), String(proposal.input.command.params.accountId));
  assert.ok(proposal.key, "Avatar proposal requires its original real command key");
  return `${avatarProposalPath}/${encodeURIComponent(data.id)}/approve`;
}
export function assertRequestSeeds(path, input, previews, uploads, allowed, targetIds, completeScopeIds) {
  const permitted = ids => assert.ok(ids.every(id => allowed.customerIds.includes(String(id))), "Actual request/preview contains a customer outside the root seed");
  const exactTargets = ids => { permitted(ids); assert.deepEqual(ids.map(String).toSorted(), targetIds.map(String).toSorted(), "Actual request/preview differs from this scenario's exact targets"); };
  if (path.endsWith("/bulk/preview")) {
    permitted(input.customerIds ?? []); permitted(input.excludedIds ?? []);
    if (input.selectionMode === "ALL_FILTERED") {
      assert.ok(completeScopeIds, "Filtered preview needs a complete real current owner scope");
      if (allowed.bulkDiscoveryCustomerIds) {
        assert.deepEqual(input.customerIds ?? [], [], "Discovery cannot explicitly select previous fixtures");
        assert.deepEqual(input.excludedIds ?? [], [], "Discovery cannot change the frozen owner scope");
        const filters = input.filters;
        assert.ok(filters && typeof filters === "object" && !Array.isArray(filters), "Discovery filters must be an object");
        if (Object.keys(filters).length) {
          assert.ok(typeof allowed.bulkDiscoveryKeyword === "string" && allowed.bulkDiscoveryKeyword.trim(), "The current fixture discovery keyword is required");
          assert.deepEqual(filters, { keyword: allowed.bulkDiscoveryKeyword }, "Only the exact current fixture keyword is authorized");
        } else assert.deepEqual(filters, {}, "Discovery filters must be an object");
        assert.ok(Array.isArray(allowed.bulkDiscoveryCustomerIds));
        assert.ok(completeScopeIds.every(id => allowed.bulkDiscoveryCustomerIds.includes(String(id))), "Discovery contains a customer outside the measured owned fixture scope");
      } else permitted(completeScopeIds);
    }
    else { assert.ok(["EXPLICIT", "CROSS_PAGE"].includes(input.selectionMode), "Unsupported real bulk selection mode"); exactTargets(input.customerIds); }
  } else if (path.endsWith("/assignments/random-preview")) exactTargets(input.customers.map(row => row.id));
  else if (path.endsWith("/support-workbench/bulk") || path.endsWith("/assignments/random")) {
    const bulk = path.endsWith("/support-workbench/bulk");
    const key = bulk ? "selectionId" : "id";
    const requested = bulk ? input.selectionId : input.previewId;
    const preview = previews.find(row => row.path.endsWith(bulk ? "/bulk/preview" : "/random-preview") && businessData(row.output)[key] === requested);
    assert.ok(preview, "Actual write does not reference this run's server preview");
    exactTargets(businessData(preview.output).customers.map(row => row.id));
    if (!bulk) assert.equal(input.expectedRulesVersion, businessData(preview.output).rulesVersion);
  } else if (path.endsWith("/conversations/attachments")) permitted([input.customerId]);
  else if (path.endsWith("/profile") && path.includes("/platform/accounts/")) {
    assert.ok(allowed.accountIds.includes(decodeURIComponent(path.split("/")[5])));
    assert.ok(uploads.some(row => row.path.endsWith("/accounts/avatar-assets") && businessData(row.output).assetId === input.avatarAssetId), "Profile write is not bound to this run's uploaded avatar");
  } else if (path.endsWith("/replies")) {
    assert.ok(allowed.conversationNos.includes(decodeURIComponent(path.split("/")[5])));
    for (const target of input.replyTargets ?? []) assert.ok(allowed.conversationNos.includes(target.conversationNo), "Reply targets contain a non-seed conversation");
    if (input.kind === "IMAGE") assert.ok(uploads.some(row => row.path.endsWith("/conversations/attachments") && businessData(row.output).id === input.attachmentId), "Message does not use this run's uploaded attachment");
    if (input.kind === "SKU") assert.ok(allowed.skuIds.includes(input.skuId));
  }
}
export function validateMutation(id, mutation, before, uploads, allowed, previews = [], targetIds = []) {
  const data = businessData(mutation.output), input = mutation.input;
  assert.ok(mutation.key, "Each actual operation needs its fresh idempotency key");
  if (conversationFeatures.has(id)) {
    assert.ok(allowed.conversationNos.includes(data.conversationNo));
    assert.equal(before.conversation.conversationNo, data.conversationNo);
    assert.ok(mutation.path.endsWith(`/${encodeURIComponent(data.conversationNo)}/replies`));
    assert.ok(input.clientMessageId && !before.messages.some(message => message.clientMessageId === input.clientMessageId), "This message existed before the current write");
    if (id === "sku") { assert.equal(input.kind, "SKU"); assert.ok(allowed.skuIds.includes(input.skuId)); }
    else if (id === "attachment") {
      assert.equal(input.kind, "IMAGE");
      assert.ok(uploads.some(upload => upload.path === "/api/admin/content/conversations/attachments" && businessData(upload.output).id === input.attachmentId && businessData(upload.output).state === "READY"), "Image did not use the asset uploaded in this run");
    } else assert.equal(input.kind, "TEXT");
  } else if (id === "avatar") {
    assert.ok(mutation.proposal, "A direct profile PATCH cannot stand in for the real avatar A2 execution");
    const params = assertAvatarProposal(mutation.proposal.input, before, uploads, allowed, mutation.avatarPolicy);
    assert.equal(mutation.path, avatarApprovePath(mutation.proposal));
    assert.equal(String(data.id), String(businessData(mutation.proposal.output).id));
    assert.equal(String(data.status).toUpperCase(), "APPROVED");
    assert.equal(String(data.obj), String(params.accountId));
    assert.notEqual(mutation.key, mutation.proposal.key);
  } else if (id === "bulk") {
    assert.ok(data.batchId && !before.records.some(row => row.batchId === data.batchId));
    assert.equal(data.key, mutation.key);
    assert.equal(data.content, input.content);
    assert.equal(data.kind, input.kind);
    assert.ok(data.counts?.total > 0);
    const preview = previews.find(row => row.path.endsWith("/bulk/preview") && businessData(row.output).selectionId === input.selectionId);
    assert.ok(preview, "This batch did not use the current actual frozen selection");
    assert.deepEqual(businessData(preview.output).customers.map(row => String(row.id)).toSorted(), targetIds.map(String).toSorted());
    assert.equal(data.frozenCount, targetIds.length);
  } else if (id === "random") {
    assert.ok(data.operationId && data.customers?.length);
    const preview = previews.find(row => row.path.endsWith("/random-preview") && businessData(row.output).id === input.previewId);
    assert.ok(preview, "Random assignment did not use this run's actual preview");
    assert.deepEqual(businessData(preview.output).customers.map(row => String(row.id)).toSorted(), targetIds.map(String).toSorted());
    assert.deepEqual(data.customers.map(row => String(row.customerId)).toSorted(), targetIds.map(String).toSorted());
    assert.equal(input.expectedRulesVersion, businessData(preview.output).rulesVersion);
    for (const customer of data.customers) {
      assert.ok(allowed.customerIds.includes(String(customer.customerId)));
      assert.equal(customer.status, "ASSIGNED");
      assert.ok(customer.agentAdminId);
      assert.ok(allowed.eligibleAssignmentAgentIds?.includes(String(customer.agentAdminId)), "Assignment returned an agent outside the measured actual global eligibility set");
      assert.equal(before[String(customer.customerId)].agentAdminId, null);
      assert.equal(String(before[String(customer.customerId)].customerId), String(customer.customerId));
      assert.equal(before[String(customer.customerId)].version, businessData(preview.output).customers.find(row => String(row.id) === String(customer.customerId)).poolVersion, "Random preview changed the measured pool version");
    }
  }
  return data;
}
export function validateReadback(id, data, mutation, before) {
  const output = businessData(mutation.output), input = mutation.input;
  if (conversationFeatures.has(id)) {
    assert.equal(data.conversation.conversationNo, output.conversationNo, "GET belongs to a different conversation");
    assert.ok(BigInt(data.conversation.version) > BigInt(before.conversation.version), "GET still contains the old conversation version");
    const messages = data.messages.filter(message => message.clientMessageId === input.clientMessageId);
    assert.equal(messages.length, 1, "The committed message is missing or duplicated");
    const message = messages[0];
    assert.ok(message.id && !before.messages.some(old => String(old.id) === String(message.id)));
    assert.equal(message.kind, input.kind);
    if (input.kind === "SKU") assert.equal(message.skuId, input.skuId);
    if (input.kind === "IMAGE") assert.equal(message.attachmentId, input.attachmentId);
    else assert.equal(message.content, input.body);
    return message;
  }
  if (id === "avatar") {
    const params = mutation.proposal.input.command.params;
    assert.equal(String(data.id), String(params.accountId));
    assert.equal(data.avatarAssetId, params.avatarAssetId);
    assert.ok(Number(data.avatarVersion) > Number(before.avatarVersion ?? 0));
    if (mutation.firstAvatarRead) assert.equal(data.avatarVersion, mutation.firstAvatarRead.avatarVersion);
  } else if (id === "bulk") {
    assert.equal(data.batchId, output.batchId);
    assert.equal(data.key, mutation.key);
    assert.equal(data.content, input.content);
    assert.equal(data.kind, input.kind);
    assert.ok(data.counts.total > 0 && data.counts.sent > 0 && data.counts.pending === 0, "The new batch has not actually delivered any committed recipient");
  } else if (id === "random") {
    for (const customer of output.customers) assert.equal(String(data[String(customer.customerId)].agentAdminId), String(customer.agentAdminId), "Random assignment was not persisted for this customer");
  }
  return data;
}
const legacyFeRuntime = Object.freeze({ origin: "http://127.0.0.1:33107", port: 33107, distDir: ".next-seven-fixture" });
const r4FeRuntime = Object.freeze({ origin: "http://127.0.0.1:33108", port: 33108, distDir: ".next-seven-r4" });
// Earlier task identities and standalone legacy checks retain the original fixed profile.
const feRuntime = taskId => taskId === "support-analytics-frontend-20261007-r4" ? r4FeRuntime : legacyFeRuntime;

export function assertRuntimeReceipt(receipt, target, now = Date.now()) {
  assert.equal(receipt.taskId, target.taskId);
  const age = now - Date.parse(receipt.recordedAt);
  assert.ok(age >= 0 && age <= 15 * 60000, "Runtime startup receipt is missing or stale");
  assert.equal(resolve(receipt.fe.repo), resolve(target.repo));
  assert.equal(receipt.fe.origin, feRuntime(target.taskId).origin);
  assert.equal(target.origin, receipt.fe.origin);
  assert.equal(receipt.fe.backendUrl, "http://127.0.0.1:18161");
  assert.equal(resolve(receipt.be.repo), resolve("D:/WORKS/PLAN/.wt/cs-analytics-api-20261007"));
  assert.equal(receipt.be.origin, receipt.fe.backendUrl);
  assert.equal(receipt.fe.cookieNamespace, "cs_analytics_20261007");
  assert.equal(receipt.resources.db.port, 33337);
  assert.equal(receipt.resources.db.schema, "cs_analytics_20261007");
  assert.equal(receipt.fe.candidateDigest, target.candidateDigest, "FE source changed after the startup receipt");
  assert.ok(receipt.allowedSeedObjects && receipt.authorizedMutationPaths?.length, "Only root-provisioned seed objects may be mutated");
  const manualFe = receipt.fe.proofMode === "manual-os-limited";
  assert.ok(Number.isInteger(receipt.fe.pid) && receipt.fe.pid > 0 && receipt.fe.processStartTime);
  if (manualFe) {
    assert.equal(receipt.fe.commandLineHash, null, "Manual FE must not invent a command hash");
    assert.ok(receipt.fe.manualProofPath && /^[a-f0-9]{64}$/i.test(receipt.fe.manualProofSha256 ?? ""), "Unreadable FE command requires complete bound alternative proof");
  }
  else assert.ok(receipt.fe.commandLineHash, "FE requires its command fingerprint or complete manual proof");
  for (const resource of [receipt.be, ...["db", "redis", "s3"].map(kind => receipt.resources[kind])]) {
    assert.ok(resource && Number.isInteger(resource.pid) && resource.pid > 0 && resource.processStartTime && resource.commandLineHash, "Each live service needs a process fingerprint");
  }
}
export function assertResourceBindings(text, ownership, receipt) {
  const required = ["spring.datasource.url", "spring.data.redis.host", "spring.data.redis.port", "spring.data.redis.database", "nexion.storage.endpoint", "nexion.storage.bucket"];
  const values = {};
  for (const line of text.split(/\r\n|\n|\r/)) {
    if (/^[ \t\f]*$/.test(line) || /^[ \t\f]*[#!]/.test(line)) continue;
    // The root generates this deliberately restricted format; reject Java's
    // alternative separators, escaped keys and continuations rather than ignore them.
    const property = /^[ \t\f]*([A-Za-z0-9_.-]+)[ \t\f]*=(.*)$/.exec(line);
    assert.ok(property && !line.endsWith("\\"), "Loaded properties must use single-line unescaped key=value syntax");
    const key = property[1];
    assert.ok(!/^spring\.redis\.(host|port|database)$/.test(key), "Conflicting legacy Redis alias in the loaded properties");
    if (!required.includes(key)) continue;
    assert.ok(!Object.hasOwn(values, key), "Duplicate public connection property");
    values[key] = property[2].replace(/^[ \t\f]+/, "");
    assert.ok(values[key] && !values[key].includes("${") && !values[key].includes("\\"), "Unresolved public connection property");
  }
  assert.ok(required.every(key => Object.hasOwn(values, key)), "Missing explicit public connection property");
  assert.ok(values[required[0]].startsWith("jdbc:mysql://"), "Datasource is not the isolated MySQL target");
  let database; try { database = new URL(values[required[0]].slice("jdbc:".length)); } catch { throw new Error("Invalid public datasource URL"); }
  const actual = { databaseHost: database.hostname, databasePort: Number(database.port), database: database.pathname.slice(1), redisHost: values[required[1]], redisPort: Number(values[required[2]]), redisDatabase: Number(values[required[3]]), storageEndpoint: values[required[4]], storageBucket: values[required[5]] };
  assert.deepEqual(actual, { databaseHost: "127.0.0.1", databasePort: 33337, database: "cs_analytics_20261007", redisHost: "127.0.0.1", redisPort: 16343, redisDatabase: 0, storageEndpoint: "http://127.0.0.1:19043", storageBucket: "cs-analytics-20261007-private" }, "Loaded BE connections do not target this period's resources");
  assert.equal(ownership.mode, "EXCLUSIVE_ANALYTICS");
  assert.equal(ownership.databaseIdentity.port, actual.databasePort); assert.equal(ownership.databaseIdentity.database, actual.database);
  for (const key of ["databasePort", "database", "redisHost", "redisPort", "redisDatabase", "storageEndpoint", "storageBucket"]) assert.equal(ownership.resourceIdentity[key], actual[key]);
  assert.equal(receipt.resources.db.port, actual.databasePort); assert.equal(receipt.resources.db.schema, actual.database);
  assert.equal(receipt.resources.redis.host, actual.redisHost); assert.equal(receipt.resources.redis.port, actual.redisPort); assert.equal(receipt.resources.redis.database, actual.redisDatabase);
  assert.equal(receipt.resources.s3.endpoint, actual.storageEndpoint); assert.equal(receipt.resources.s3.port, new URL(actual.storageEndpoint).port ? Number(new URL(actual.storageEndpoint).port) : 80); assert.equal(receipt.resources.s3.bucket, actual.storageBucket);
}
export function assertLiveFingerprint(expected, actual) {
  assert.equal(actual.pid, expected.pid, "The port is served by a different process");
  assert.equal(Date.parse(actual.processStartTime), Date.parse(expected.processStartTime), "The service process restarted");
  assert.ok(typeof actual.commandLineHash === "string" && typeof expected.commandLineHash === "string", "Readable command identity is required for this service");
  assert.equal(actual.commandLineHash.toLowerCase(), expected.commandLineHash.toLowerCase(), "Service command changed");
  assert.ok(Array.isArray(actual.references) && actual.references.length > 0 && actual.references.every(Boolean), "The live command does not reference the recorded candidate/configuration");
}
function fingerprintCode(bindings) {
  assert.ok(Array.isArray(bindings) && bindings.length > 0);
  assert.equal(new Set(bindings.map(row => row.port)).size, bindings.length, "Duplicate listener bindings");
  for (const { port, paths } of bindings) {
    assert.ok(Number.isInteger(port) && port > 0 && port <= 65535);
    assert.ok(Array.isArray(paths) && paths.length > 0 && paths.every(path => typeof path === "string" && path.length > 0));
  }
  const literal = JSON.stringify(bindings).replaceAll("'", "''");
  return `$ErrorActionPreference='Stop'; $bindings=ConvertFrom-Json '${literal}'; $bindings=@($bindings); $listeners=@(Get-NetTCPConnection -State Listen); $rows=@(foreach($binding in $bindings){ $owners=@($listeners | Where-Object {$_.LocalPort -eq $binding.port} | Select-Object -ExpandProperty OwningProcess -Unique); if($owners.Count -ne 1){throw ('Listener ownership is ambiguous for port '+$binding.port+'; bindings='+$bindings.Count+'; owners='+$owners.Count)}; $proc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0]); if(!$proc){throw 'Listener process disappeared'}; $cmd=$proc.CommandLine; $digest=$null; $refs=$null; if($null -ne $cmd){$hash=[System.Security.Cryptography.SHA256]::Create(); $bytes=[System.Text.Encoding]::UTF8.GetBytes($cmd); $digest=([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-','').ToLowerInvariant(); $refs=@($binding.paths | ForEach-Object {$cmd.Replace([char]92,[char]47).ToLowerInvariant().Contains($_.Replace([char]92,[char]47).ToLowerInvariant())})}; [pscustomobject]@{pid=[int]$proc.ProcessId;processStartTime=$proc.CreationDate.ToUniversalTime().ToString('o');commandLineHash=$digest;references=$refs;commandLineReadable=($null -ne $cmd);executablePathReadable=($null -ne $proc.ExecutablePath)} }); $final=@(Get-NetTCPConnection -State Listen); for($i=0;$i -lt $bindings.Count;$i++){ $owners=@($final | Where-Object {$_.LocalPort -eq $bindings[$i].port} | Select-Object -ExpandProperty OwningProcess -Unique); if($owners.Count -ne 1 -or $owners[0] -ne $rows[$i].pid){throw 'Listener changed during ownership collection'}; $nowProc=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0]); if(!$nowProc -or $nowProc.CreationDate.ToUniversalTime().ToString('o') -ne $rows[$i].processStartTime){throw 'Listener process changed during ownership collection'} }; ConvertTo-Json -InputObject $rows -Compress`;
}
function fingerprintRows(stdout, count) {
  const rows = JSON.parse(stdout);
  assert.ok(Array.isArray(rows) && rows.length === count, "Incomplete live process ownership collection");
  return rows;
}
export function windowsFingerprint(port, paths) {
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", fingerprintCode([{ port, paths }])], { windowsHide: true, encoding: "utf8", timeout: 15000 });
  assert.equal(result.status, 0, "Cannot establish live listener/process ownership");
  return fingerprintRows(result.stdout, 1)[0];
}
export function windowsFingerprintBatch(bindings) {
  const code = fingerprintCode(bindings);
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-Command", code], { windowsHide: true, encoding: "utf8", timeout: 15000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) { reject(new Error("Cannot establish live listener/process ownership", { cause: error })); return; }
      try { resolve(fingerprintRows(stdout, bindings.length)); } catch (failure) { reject(failure); }
    });
  });
}
function boundFile(file, digest) {
  assert.ok(file && /^[a-f0-9]{64}$/i.test(digest ?? ""), "Missing file identity");
  assert.equal(sha256(readFileSync(file)), digest.toLowerCase(), "A recorded runtime file changed");
}
export { boundFile as assertBoundFile };
export function assertFePreload(preload, taskId) {
  assert.equal(preload.trim().split(/\r?\n/).map(line => line.trim()).join("\n"), `process.env.NEXION_BACKEND_URL = 'http://127.0.0.1:18161';\nprocess.env.NEXION_ADMIN_COOKIE_NAMESPACE = 'cs_analytics_20261007';\nprocess.env.NEXT_DIST_DIR = '${feRuntime(taskId).distDir}';`, "FE preload does not enforce this period's backend/cookie/serving-build binding");
}
export function assertManualFeProof(receipt, target, proof, actual, now = Date.now()) {
  const profile = feRuntime(target.taskId), serviceDistDir = profile.distDir;
  assert.equal(receipt.taskId, target.taskId);
  assert.equal(receipt.fe.origin, profile.origin); assert.equal(target.origin, receipt.fe.origin);
  assert.equal(receipt.fe.proofMode, "manual-os-limited");
  assert.equal(receipt.fe.commandLineHash, null);
  assert.equal(actual.commandLineReadable, false, "Manual proof is only for a successfully observed unreadable FE command");
  assert.equal(actual.executablePathReadable, false);
  assert.equal(actual.commandLineHash, null); assert.equal(actual.references, null);
  const sameProcess = (expected, observed) => {
    assert.equal(observed.pid, expected.pid, "Manual proof process changed");
    const started = Date.parse(observed.processStartTime);
    assert.ok(Number.isFinite(started)); assert.equal(started, Date.parse(expected.processStartTime), "Manual proof process restarted");
  };
  sameProcess(receipt.fe, actual); sameProcess(receipt.fe, proof.fe); sameProcess(receipt.be, proof.be);
  assert.equal(proof.kind, "MANUAL_FE_RUNTIME_BINDING_V1"); assert.equal(proof.complete, true);
  assert.equal(proof.taskId, receipt.taskId);
  const recorded = Date.parse(proof.recordedAt);
  assert.ok(recorded <= Date.parse(receipt.recordedAt) && now - recorded >= 0 && now - recorded <= 15 * 60000, "Manual FE proof is stale or outside this receipt");
  assert.equal(proof.fe.commandLine, null); assert.equal(proof.fe.name, "node.exe");
  assert.equal(resolve(proof.fe.repo), resolve(target.repo)); assert.equal(proof.fe.origin, receipt.fe.origin);
  assert.equal(proof.fe.candidateDigest, target.candidateDigest);
  assert.equal(resolve(proof.be.repo), resolve(receipt.be.repo)); assert.equal(proof.be.candidateDigest, receipt.be.candidateDigest);
  assertLiveFingerprint(receipt.be, proof.be);
  assert.equal(resolve(receipt.fe.buildIdPath), resolve(target.repo, serviceDistDir, "BUILD_ID"), "FE build belongs to a different serving directory");
  assert.equal(proof.build.buildIdPath, receipt.fe.buildIdPath);
  assert.equal(proof.build.buildIdSha256, receipt.fe.buildIdSha256);
  assert.ok(/^[a-f0-9]{40}$/i.test(proof.build.buildSourceHead));
  assert.ok(Date.parse(proof.build.buildLogCompletedAt) < Date.parse(actual.processStartTime), "Successful build evidence must precede the live FE process");
  const approvedScriptPaths = ["scripts/support-analytics-runtime.mjs", "scripts/lib/support-analytics-evidence.mjs", "tests/support-analytics-runtime.test.mjs"];
  assert.ok(Array.isArray(proof.build.changedSinceBuild) && proof.build.changedSinceBuild.every(path => approvedScriptPaths.includes(path)), "Product sources differ from the actual build");
  assert.ok(Array.isArray(proof.assets) && proof.assets.some(asset => asset.urlPath?.startsWith("/_next/static/chunks/") && asset.urlPath.endsWith(".js")), "A build-manifest shell is not a rendered application chunk");
  for (const asset of proof.assets) {
    assert.ok(asset.urlPath?.startsWith("/_next/static/") && asset.localPath && /^[a-f0-9]{64}$/i.test(asset.sha256) && asset.bytes > 0);
    assert.equal(resolve(asset.localPath).toLowerCase(), resolve(target.repo, serviceDistDir, asset.urlPath.slice("/_next/".length)).toLowerCase(), "Rendered asset belongs to a different serving directory");
  }
  assert.equal(proof.auth.via, receipt.fe.origin); assert.equal(proof.auth.mfaMode, "VERIFY");
  assert.equal(proof.auth.username, receipt.avatarApproval.makerUsername);
  assert.equal(String(proof.auth.adminId), String(receipt.avatarApproval.makerAdminId));
  assert.equal(proof.auth.roleCode, "SUPER_ADMIN"); assert.equal(proof.auth.passwordChangeRequired, false);
  assert.equal(proof.auth.cookieName, `nexion_admin_token__${receipt.fe.cookieNamespace}`);
  assert.equal(proof.auth.httpOnly, true); assert.equal(proof.auth.sameSite, "strict");
  assert.equal(proof.loggedOut, true); assert.equal(proof.loggedOutSessionStatus, 401);
  for (const timestamp of [proof.auth.verifiedAt, proof.connection.observedAt]) {
    const observed = Date.parse(timestamp);
    assert.ok(observed >= Math.max(Date.parse(receipt.fe.processStartTime), Date.parse(receipt.be.processStartTime)) && observed <= recorded, "Auth/TCP evidence is outside these process lifetimes");
  }
  const outgoing = proof.connection.fe, incoming = proof.connection.be;
  assert.equal(outgoing.OwningProcess, receipt.fe.pid); assert.equal(incoming.OwningProcess, receipt.be.pid);
  assert.ok([5, "Established"].includes(outgoing.State) && [5, "Established"].includes(incoming.State));
  assert.equal(outgoing.LocalAddress, "127.0.0.1"); assert.equal(outgoing.RemoteAddress, "127.0.0.1"); assert.equal(outgoing.RemotePort, 18161);
  assert.ok(Number.isInteger(outgoing.LocalPort) && outgoing.LocalPort > 0 && outgoing.LocalPort <= 65535);
  assert.equal(incoming.LocalAddress, outgoing.RemoteAddress); assert.equal(incoming.LocalPort, outgoing.RemotePort);
  assert.equal(incoming.RemoteAddress, outgoing.LocalAddress); assert.equal(incoming.RemotePort, outgoing.LocalPort);
}
async function verifyManualFeProof(receipt, target, actual) {
  const serviceDistDir = feRuntime(target.taskId).distDir;
  boundFile(receipt.fe.manualProofPath, receipt.fe.manualProofSha256);
  const proof = JSON.parse(readFileSync(receipt.fe.manualProofPath, "utf8"));
  assertManualFeProof(receipt, target, proof, actual);
  boundFile(proof.seedManifestPath, proof.seedManifestSha256);
  assert.equal(resolve(proof.seedManifestPath), resolve(receipt.seedManifest.path));
  assert.equal(proof.seedManifestSha256, receipt.seedManifest.sha256);
  const seed = JSON.parse(readFileSync(proof.seedManifestPath, "utf8"));
  assert.equal(seed.seedId, proof.seedId); assert.equal(seed.authenticationReady, true);
  assert.deepEqual(seed.avatarApproval, receipt.avatarApproval);
  boundFile(proof.build.buildLogPath, proof.build.buildLogSha256);
  const buildLog = readFileSync(proof.build.buildLogPath, "utf8");
  assert.ok(buildLog.includes("Compiled successfully") && buildLog.includes("(21/21)") && buildLog.includes("Finalizing page optimization") && buildLog.includes("Route (app)") && buildLog.includes("server-rendered on demand"), "The original full successful production build record is missing");
  assert.equal(statSync(proof.build.buildLogPath).mtime.toISOString(), proof.build.buildLogCompletedAt);
  const git = args => { const result = spawnSync("git", ["-C", target.repo, ...args], { encoding: "utf8", windowsHide: true }); assert.equal(result.status, 0); return result.stdout.trim(); };
  assert.equal(git(["status", "--porcelain"]), "", "Manual source proof requires the fixed clean candidate");
  assert.deepEqual(git(["diff", "--name-only", proof.build.buildSourceHead]).split(/\r?\n/).filter(Boolean), proof.build.changedSinceBuild);
  assert.equal(readFileSync(receipt.fe.buildIdPath, "utf8").trim(), proof.build.buildId);
  const htmlResponse = await fetch(receipt.fe.origin, { headers: { connection: "close" }, redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(htmlResponse.status, 200);
  const html = await htmlResponse.text();
  const rendered = [...new Set([...html.matchAll(/(?:src|href)="([^"<>]+)"/g)].map(match => match[1]).filter(path => path.startsWith("/_next/static/") && /\.(?:js|css)(?:\?|$)/.test(path)).map(path => new URL(path, receipt.fe.origin).pathname))];
  const expectedPaths = [...new Set([...rendered, `/_next/static/${proof.build.buildId}/_buildManifest.js`])].toSorted();
  assert.deepEqual(proof.assets.map(asset => asset.urlPath).toSorted(), expectedPaths, "Manual proof does not cover the current rendered JS/CSS reference set");
  for (const asset of proof.assets) {
    const file = realpathSync(resolve(target.repo, serviceDistDir, asset.urlPath.slice("/_next/".length)));
    assert.ok(!relative(realpathSync(join(target.repo, serviceDistDir, "static")), file).startsWith(".."));
    assert.equal(resolve(asset.localPath).toLowerCase(), file.toLowerCase()); boundFile(file, asset.sha256);
    assert.equal(statSync(file).size, asset.bytes);
    const response = await fetch(`${receipt.fe.origin}${asset.urlPath}`, { headers: { connection: "close" }, redirect: "error", signal: AbortSignal.timeout(15000) }); assert.equal(response.status, 200);
    assert.equal(sha256(Buffer.from(await response.arrayBuffer())), asset.sha256, "Rendered application asset changed or belongs to another build");
  }
}
export async function verifyRuntimeOwnership(receipt, target) {
  const profile = feRuntime(target.taskId), serviceDistDir = profile.distDir;
  boundFile(target.receiptPath, target.receiptSha256);
  assertRuntimeReceipt(receipt, target);
  assert.equal(repositoryDigest(receipt.be.repo), receipt.be.candidateDigest, "BE candidate changed after startup");
  boundFile(receipt.resources.resourceOwnershipPath, receipt.resources.sha256);
  boundFile(receipt.fe.buildIdPath, receipt.fe.buildIdSha256);
  boundFile(receipt.fe.envBindingPath, receipt.fe.envBindingSha256);
  assertFePreload(readFileSync(receipt.fe.envBindingPath, "utf8"), target.taskId);
  assert.equal(resolve(receipt.fe.buildIdPath), resolve(target.repo, serviceDistDir, "BUILD_ID"));
  boundFile(receipt.be.artifactPath, receipt.be.artifactSha256);
  boundFile(receipt.be.configPath, receipt.be.configSha256);
  assertResourceBindings(readFileSync(receipt.be.configPath, "utf8"), JSON.parse(readFileSync(receipt.resources.resourceOwnershipPath, "utf8")), receipt);
  const [liveFe, liveBe, ...liveResources] = await windowsFingerprintBatch([
    { port: profile.port, paths: [target.repo, receipt.fe.envBindingPath] },
    { port: 18161, paths: [receipt.be.artifactPath, receipt.be.configPath] },
    ...["db", "redis", "s3"].map(kind => ({ port: receipt.resources[kind].port, paths: [receipt.resources[kind].configPath] })),
  ]);
  if (receipt.fe.proofMode === "manual-os-limited") await verifyManualFeProof(receipt, target, liveFe);
  else assertLiveFingerprint(receipt.fe, liveFe);
  assertLiveFingerprint(receipt.be, liveBe);
  for (const kind of ["db", "redis", "s3"]) {
    const resource = receipt.resources[kind];
    boundFile(resource.configPath, resource.configSha256);
    assertLiveFingerprint(resource, liveResources[["db", "redis", "s3"].indexOf(kind)]);
  }
  const buildId = readFileSync(receipt.fe.buildIdPath, "utf8").trim();
  const urlPath = `/_next/static/${buildId}/_buildManifest.js`;
  const file = realpathSync(join(target.repo, serviceDistDir, "static", buildId, "_buildManifest.js"));
  assert.ok(!relative(realpathSync(join(target.repo, serviceDistDir, "static")), file).startsWith(".."));
  assert.equal(resolve(receipt.fe.assetPath).toLowerCase(), file.toLowerCase());
  boundFile(file, receipt.fe.assetSha256);
  const response = await fetch(`${receipt.fe.origin}${urlPath}`, { headers: { connection: "close" }, signal: AbortSignal.timeout(15000), redirect: "error" });
  assert.equal(response.status, 200, "The expected current Next build is not served");
  assert.equal(sha256(Buffer.from(await response.arrayBuffer())), receipt.fe.assetSha256, "HTTP asset is from a different FE build");
}

export async function installRenderedBlobObserver(page) {
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    const blobs = new Map();
    Object.defineProperty(window, "__supportAcceptanceImageBlobs", { value: blobs });
    URL.createObjectURL = blob => {
      const url = create(blob);
      if (blob instanceof Blob && blob.type.startsWith("image/")) blobs.set(url, blob);
      return url;
    };
    URL.revokeObjectURL = url => { revoke(url); blobs.delete(String(url)); };
  });
}
export async function renderedBlobObservation(element) {
  const visible = () => { const rect = element.getBoundingClientRect(), style = getComputedStyle(element); return rect.width > 0 && rect.height > 0 && style.visibility === "visible" && style.display !== "none"; };
  const source = element.currentSrc || element.src, evidence = { src: source.startsWith("blob:") ? source : "non-blob", width: element.naturalWidth, height: element.naturalHeight, visible: visible(), connected: element.isConnected };
  if (!element.isConnected) return { ...evidence, reason: "detached" };
  try { await element.decode(); } catch (error) {
    if (!element.isConnected) return { ...evidence, connected: false, visible: false, reason: "detached" };
    return { ...evidence, reason: "decode-error", message: error.message };
  }
  if (!element.isConnected) return { ...evidence, connected: false, visible: false, reason: "detached" };
  if (element.currentSrc !== source) return { ...evidence, reason: "source-changed" };
  if (!visible()) return { ...evidence, visible: false, reason: "not-visible" };
  if (!element.naturalWidth || !source.startsWith("blob:")) return { ...evidence, reason: "not-blob", message: "The actual decoded image is not an observed Blob" };
  const blob = window.__supportAcceptanceImageBlobs?.get(source);
  if (!blob || !blob.size) return { ...evidence, reason: "unobserved-blob", message: "The current image Blob was not observed or was revoked" };
  const bytes = await blob.arrayBuffer(), digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  if (!element.isConnected) return { ...evidence, sha256, connected: false, visible: false, reason: "detached" };
  if (element.currentSrc !== source) return { ...evidence, sha256, reason: "source-changed" };
  if (!visible()) return { ...evidence, sha256, visible: false, reason: "not-visible" };
  if (window.__supportAcceptanceImageBlobs?.get(source) !== blob) return { ...evidence, sha256, reason: "unobserved-blob", message: "The current image Blob was not observed or was revoked" };
  return { ...evidence, width: element.naturalWidth, height: element.naturalHeight, sha256, bytes: bytes.byteLength, decoded: true, connected: true, visible: true };
}
export async function renderedBlobSha256(image) {
  const observation = await image.evaluate(renderedBlobObservation);
  assert.ok(!observation.reason, observation.message ?? `Image observation failed: ${observation.reason}`);
  return observation.sha256;
}
export async function waitForRenderedImageMatch(images, expectedHash, { timeoutMs = 15000, pollMs = 50 } = {}) {
  assert.match(expectedHash, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 15000);
  assert.ok(Number.isSafeInteger(pollMs) && pollMs > 0);
  const started = Date.now(), observations = [];
  const fail = reason => { const error = new Error(reason); error.imageObservations = observations; throw error; };
  try {
    while (true) {
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) fail("The image observation deadline expired");
      const sample = { at: new Date().toISOString(), elapsedMs: Date.now() - started, count: null, visibleCount: 0, images: [] };
      observations.push(sample);
      let timer, result;
      try {
        result = await Promise.race([(async () => {
          const handles = await images.elementHandles(); sample.count = handles.length;
          let detached = handles.length === 0;
          try {
            for (const handle of handles) {
              const image = await handle.evaluate(renderedBlobObservation); sample.images.push(image);
              if (image.visible) sample.visibleCount++;
              if (image.reason === "detached") { detached = true; continue; }
              if (image.reason === "not-visible") continue;
              if (image.reason) fail(`Image observation failed: ${image.reason}${image.message ? ": " + image.message : ""}`);
              if (image.sha256 === expectedHash) return { matched: image };
            }
            return { detached };
          } finally { await Promise.all(handles.map(handle => handle.dispose())); }
        })(), new Promise((_, reject) => {
          timer = setTimeout(() => { sample.reason = "observation-deadline"; reject(new Error("The image observation deadline expired")); }, remaining);
        })]);
      } finally { clearTimeout(timer); }
      if (Date.now() - started >= timeoutMs) fail("The image observation deadline expired");
      if (result.matched) return { expectedHash, matched: result.matched, observations };
      if (!result.detached) fail(sample.visibleCount ? "Visible image bytes do not match the committed asset" : "The current images are not visible");
      if (Date.now() - started >= timeoutMs) fail("The committed image remained absent or detached until the observation deadline");
      await new Promise(resolve => setTimeout(resolve, Math.min(pollMs, timeoutMs - (Date.now() - started))));
    }
  } catch (error) { error.imageObservations ??= observations; throw error; }
}
