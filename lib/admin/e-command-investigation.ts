import { guardedFetch, formatAdminApiError } from "./error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";

export type ECommandLocator = {
  commandKey: string; originalMethod: "POST" | "PUT" | "PATCH" | "DELETE"; originalPath: string; originalAdminId: string;
};
export type ECommandInvestigation = {
  originalRecordId: number;
  scope: string;
  commandKey: string;
  requestHash: string;
  originalMethod: string;
  originalPath: string;
  originalTarget: string | null;
  originalTargets: string | null;
  originalAdminId: number;
  originalStatus: "PROCESSING" | "UNKNOWN" | "SUCCEEDED" | "FAILED" | "CONFIRMED_SUCCEEDED" | "CONFIRMED_NOT_EXECUTED";
  locked: boolean;
  newOperationAllowed: boolean;
  investigation: {
    id: number; conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN";
    requestedConclusion: string; evidenceReference: string; evidenceType: string;
    investigatorId: number; investigatedAt: string;
  } | null;
};
export type ECommandEvidence = {
  conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN";
  evidenceReference: string;
  evidenceAuditId?: number;
};

/** Raw completion proves business success only for these verified writers. */
export function eCommandResult(receipt: ECommandInvestigation | null): "SUCCEEDED" | "NOT_EXECUTED" | "BUSINESS_RESULT_UNAVAILABLE" | "UNRESOLVED" {
  if (!receipt || receipt.locked) return "UNRESOLVED";
  if (receipt.originalStatus === "CONFIRMED_SUCCEEDED") return "SUCCEEDED";
  if (receipt.originalStatus === "CONFIRMED_NOT_EXECUTED" && receipt.newOperationAllowed) return "NOT_EXECUTED";
  if (receipt.originalStatus !== "SUCCEEDED") return "UNRESOLVED";
  const successOnly = receipt.scope === "A2_COMMAND" || receipt.scope === "E6_PHONE_RISK_SETTINGS" || receipt.scope === "F5_COMMISSION_ANOMALY_CONFIG"
    || /^(?:D3_FORECAST_CONFIG_UPDATE|D3_RESERVE_INJECTION|D3_SENSITIVE_EXPORT_(?:RECONCILIATION|LIABILITIES)|E2_POOL_(?:RANDOM|STATUS))$/.test(receipt.scope);
  return successOnly ? "SUCCEEDED" : "BUSINESS_RESULT_UNAVAILABLE";
}

export function eCommandSettled(receipt: ECommandInvestigation | null) {
  const result = eCommandResult(receipt);
  return result === "SUCCEEDED" || result === "NOT_EXECUTED";
}

/** UI eligibility only; the endpoint also enforces active employment, original read scope and evidence. */
export function canInvestigateECommand(authority: string) {
  const session = useAdminAuth.getState().session;
  return session?.role === "superadmin" && session.authorities.includes("platform_a2_unknown_investigate")
    && session.authorities.includes(authority);
}

/** Mirrors AdminIdempotencyService.normalizeScope; never changes the original locator. */
function normalizeScope(scope: string) {
  return scope.trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_");
}

function parseReceipt(value: unknown, locator: ECommandLocator): ECommandInvestigation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const row = value as Record<string, unknown>;
  const copyPath = locator.originalPath.match(/^\/api\/admin\/content\/copy-ab\/(.+)$/)?.[1];
  const copyRoutes: [string, RegExp, string][] = [
    ["POST", /^copies$/, "I1_COPY_CREATE"],
    ["PATCH", /^copies\/[^/]+\/draft$/, "I1_COPY_DRAFT_SAVE"],
    ["POST", /^copies\/[^/]+\/versions$/, "I1_COPY_VERSION_PUBLISH"],
    ["POST", /^copies\/[^/]+\/versions\/[^/]+\/rollback$/, "I1_COPY_VERSION_ROLLBACK"],
    ["POST", /^copies\/[^/]+\/archive$/, "I1_COPY_VERSION_ARCHIVE"],
    ["DELETE", /^copies\/[^/]+\/versions\/[^/]+$/, "I1_COPY_DRAFT_VERSION_DELETE"],
    ["POST", /^positions$/, "I1_COPY_POSITION_CREATE"],
    ["PATCH", /^positions\/[^/]+$/, "I1_COPY_POSITION_UPDATE"],
    ["DELETE", /^positions\/[^/]+$/, "I1_COPY_POSITION_DELETE"],
    ["POST", /^version-options$/, "I1_COPY_VERSION_OPTION_CREATE"],
    ["PUT", /^version-options\/[^/]+$/, "I1_COPY_VERSION_OPTION_UPDATE"],
    ["DELETE", /^version-options\/[^/]+$/, "I1_COPY_VERSION_OPTION_DELETE"],
    ["PATCH", /^framework\/[^/]+$/, "I1_COPY_EXPERIMENT_FRAMEWORK_UPDATE"],
    ["POST", /^experiments$/, "I1_COPY_EXPERIMENT_CREATE"],
    ["POST", /^experiments\/[^/]+\/start$/, "I1_COPY_EXPERIMENT_START"],
    ["POST", /^experiments\/[^/]+\/stop$/, "I1_COPY_EXPERIMENT_STOP"],
    ["POST", /^experiments\/[^/]+\/adopt$/, "I1_COPY_EXPERIMENT_ADOPT"],
    ["POST", /^experiments\/[^/]+\/discard$/, "I1_COPY_EXPERIMENT_DISCARD"],
  ];
  const copyScope = copyPath && copyRoutes.find(([method, path]) => method === locator.originalMethod && path.test(copyPath))?.[2];
  const novaPath = locator.originalPath.match(/^\/api\/admin\/content\/nova\/(.+)$/)?.[1];
  const novaObject = novaPath?.match(/^(channels|templates)(?:\/([^/]+)(?:\/(status))?)?$/);
  let novaScope: string | undefined;
  if (novaObject) {
    const [, family, key, status] = novaObject;
    const action = !key && locator.originalMethod === "POST" ? "CREATE"
      : key && locator.originalMethod === "PATCH" ? status ? "STATUS" : "UPDATE"
        : key && !status && locator.originalMethod === "DELETE" ? "DELETE" : undefined;
    if (action) novaScope = `I2_NOVA_${family === "channels" ? "CHANNEL" : "TEMPLATE"}_${action}${key ? `:${decodeURIComponent(key)}` : ""}`;
  } else if (novaPath === "social-distribution" && locator.originalMethod === "PATCH") novaScope = "I2_NOVA_SOCIAL_DISTRIBUTION";
  else if (novaPath === "social-events/sync" && locator.originalMethod === "POST") novaScope = "I2_NOVA_SOCIAL_SYNC";
  else if (novaPath === "social-events/expire" && locator.originalMethod === "POST") novaScope = "I2_NOVA_SOCIAL_EXPIRE";
  else {
    const event = novaPath?.match(/^social-events\/([1-9]\d*)(?:\/(status))?$/);
    if (event && (event[2] ? locator.originalMethod === "PATCH" : locator.originalMethod === "DELETE")) novaScope = `I2_NOVA_SOCIAL_EVENT_${event[2] ? "STATUS" : "DELETE"}:${BigInt(event[1])}`;
  }
  const scopeMatches = locator.originalPath === "/api/admin/platform/audit/operations" ? row.scope === "A2_COMMAND"
    : /^\/api\/admin\/teams\/ranks\/[^/]+\/thresholds\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === "F1_VRANK_THRESHOLD_UPDATE"
    : /^\/api\/admin\/teams\/ranks\/[^/]+\/rewards(?:\/[^/]+)?$/.test(locator.originalPath) ? row.scope === ({ POST: "F1_VRANK_REWARD_ADD", PUT: "F1_VRANK_REWARD_UPDATE", DELETE: "F1_VRANK_REWARD_REMOVE" } as Record<string, string>)[locator.originalMethod]
    : /^\/api\/admin\/teams\/commissions\/config\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === "F_TEAM_CONFIG_UPDATE"
    : locator.originalPath === "/api/admin/teams/ambassador-policy" ? locator.originalMethod === "PUT" && row.scope === "F4_AMBASSADOR_POLICY_UPDATE"
    : /^\/api\/admin\/teams\/commissions\/[^/]+\/reverse$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "F5_COMMISSION_REVERSE"
    : locator.originalPath === "/api/admin/teams/commissions/reissue" ? locator.originalMethod === "POST" && row.scope === "F5_COMMISSION_REISSUE"
    : /^\/api\/admin\/teams\/commissions\/users\/[^/]+\/suspend$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "F5_COMMISSION_SUSPENSION"
    : locator.originalPath === "/api/admin/teams/commissions/anomaly-config" ? locator.originalMethod === "PUT" && row.scope === "F5_COMMISSION_ANOMALY_CONFIG"
    : copyPath ? row.scope === copyScope
    : novaPath ? !!novaScope && row.scope === normalizeScope(novaScope)
    : locator.originalPath === "/api/admin/withdraw/limits" ? ["D5_WITHDRAWAL_LIMITS_UPDATE", "D5_WITHDRAWAL_LIMITS"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/finance/fx-quote" ? ["D6_FX_QUOTE_UPDATE", "D6_FX_QUOTE"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/finance/payout-vnd/config" ? ["FINANCE:D7:CONFIG_UPDATE", "D7_PAYOUT_VND_CONFIG"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/content/campaigns" ? row.scope === "I3_NOTIFICATION_CAMPAIGN_CREATE"
    : /^\/api\/admin\/content\/campaigns\/[^/]+$/.test(locator.originalPath) ? row.scope === "I3_NOTIFICATION_CAMPAIGN_DELETE"
    : /^\/api\/admin\/content\/campaigns\/[^/]+\/(?:draft|schedule|send-now|cancel)$/.test(locator.originalPath) ? row.scope === normalizeScope(`I3_NOTIFICATION_CAMPAIGN_${({ draft: "DRAFT_UPDATE", schedule: "SCHEDULE", "send-now": "SEND_NOW", cancel: "CANCEL" })[locator.originalPath.split("/").at(-1)! as "draft"]}`)
    : locator.originalPath === "/api/admin/content/i18n-learning/rescan" ? row.scope === "I6_I18N_RESCAN"
    : /^\/api\/admin\/content\/i18n-learning\/messages\/[^/]+$/.test(locator.originalPath) ? row.scope === normalizeScope(`I6_I18N_ARCHIVE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/content\/i18n-learning\/messages\/[^/]+\/(?:draft|publish)$/.test(locator.originalPath) ? row.scope === normalizeScope(`I6_I18N_${locator.originalPath.split("/").at(-1)!.toUpperCase()}:${decodeURIComponent(locator.originalPath.split("/").at(-2)!)}`)
    : /^\/api\/admin\/content\/i18n-learning\/messages\/[^/]+\/versions\/[^/]+\/rollback$/.test(locator.originalPath) ? row.scope === normalizeScope(`I6_I18N_ROLLBACK:${decodeURIComponent(locator.originalPath.split("/").at(-4)!)}:${decodeURIComponent(locator.originalPath.split("/").at(-2)!)}`)
    : /^\/api\/admin\/content\/i18n-learning\/integrity\/[^/]+\/fix$/.test(locator.originalPath) ? row.scope === normalizeScope(`I6_I18N_INTEGRITY_FIX:${decodeURIComponent(locator.originalPath.split("/").at(-2)!)}`)
    : locator.originalPath.startsWith("/api/admin/finance/withdrawals/") ? /^D2(?:[_:])/.test(String(row.scope))
      : locator.originalPath.startsWith("/api/admin/treasury/") ? /^D3(?:[_:])/.test(String(row.scope))
        : locator.originalPath.startsWith("/api/admin/devices/orders/") ? /^E4(?:[_:])/.test(String(row.scope))
          : locator.originalPath === "/api/admin/emergency/tamper/alert-config" ? row.scope === "J3_ALERT_CONFIG"
          : locator.originalPath === "/api/admin/emergency/sop/playbooks" ? row.scope === "J4_PLAYBOOK_CREATE"
          : /^\/api\/admin\/emergency\/sop\/playbooks\/[^/]+$/.test(locator.originalPath) ? row.scope === normalizeScope(`J4_PLAYBOOK_UPDATE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!).trim().toUpperCase()}`)
          : /^\/api\/admin\/emergency\/sop\/playbooks\/[^/]+\/(?:drills|executions)$/.test(locator.originalPath) ? row.scope === normalizeScope(`J4_PLAYBOOK_${locator.originalPath.endsWith("/drills") ? "DRILL" : "EXECUTE"}:${decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim().toUpperCase()}`)
          : /^\/api\/admin\/emergency\/sop\/playbooks\/[^/]+\/executions\/[^/]+\/(?:cancel|resume|rollback)$/.test(locator.originalPath) ? row.scope === normalizeScope(`J4_PLAYBOOK_${locator.originalPath.split("/").at(-1)!.toUpperCase()}:${decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim()}`)
          : /^\/api\/admin\/emergency\/geo-block\/countries\/[^/]+$/.test(locator.originalPath) ? row.scope === normalizeScope(`J2_COUNTRY:${decodeURIComponent(locator.originalPath.split("/").at(-1)!).toUpperCase()}`)
          : /^\/api\/admin\/emergency\/geo-block\/country-lists\/(?:blocked|limited)$/.test(locator.originalPath) ? row.scope === normalizeScope(`J2_COUNTRY_LIST:${locator.originalPath.split("/").at(-1)}`)
          : /^\/api\/admin\/emergency\/geo-block\/endpoints\/[^/]+$/.test(locator.originalPath) ? row.scope === normalizeScope(`J2_ENDPOINT:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
          : locator.originalPath === "/api/admin/emergency/geo-block/edge-judge" ? row.scope === "J2_EDGE_SOURCE"
          : locator.originalPath === "/api/admin/emergency/geo-block/emergency-blocks" ? row.scope === "J2_EMERGENCY_BLOCK"
          : locator.originalPath.startsWith("/api/admin/emergency/kill-switches/") ? /^J1(?:[_:])/.test(String(row.scope))
            : locator.originalPath.startsWith("/api/admin/risk/multi-account/") ? /^K1(?:[_:])/.test(String(row.scope))
              : locator.originalPath === "/api/admin/bi/reports" || locator.originalPath.startsWith("/api/admin/bi/reports/") ? row.scope === "L_BI_REPORT_CREATE" || /^L_BI_REPORT_ACTION/.test(String(row.scope))
                : /^(E2_POOL_|E5_DEVICE_)/.test(String(row.scope)) || row.scope === "E6_PHONE_RISK_SETTINGS";
  if (!Number.isSafeInteger(row.originalRecordId) || Number(row.originalRecordId) < 1
    || typeof row.scope !== "string" || !scopeMatches
    || row.commandKey !== locator.commandKey || row.originalMethod !== locator.originalMethod || row.originalPath !== locator.originalPath
    || !Number.isSafeInteger(row.originalAdminId) || Number(row.originalAdminId) < 1
    || String(row.originalAdminId) !== locator.originalAdminId
    || typeof row.requestHash !== "string" || !/^[a-fA-F0-9]{64}$/.test(row.requestHash)
    || row.originalTarget !== null && typeof row.originalTarget !== "string"
    || row.originalTargets !== null && typeof row.originalTargets !== "string"
    || !["PROCESSING", "UNKNOWN", "SUCCEEDED", "FAILED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED"].includes(String(row.originalStatus))
    || row.locked !== ["PROCESSING", "UNKNOWN"].includes(String(row.originalStatus))
    || row.newOperationAllowed !== (row.originalStatus === "CONFIRMED_NOT_EXECUTED")) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (row.investigation !== null) {
    if (!row.investigation || typeof row.investigation !== "object" || Array.isArray(row.investigation)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
    const entry = row.investigation as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.id) || !["SUCCEEDED", "NOT_EXECUTED", "STILL_UNKNOWN"].includes(String(entry.conclusion))
      || typeof entry.evidenceReference !== "string" || typeof entry.evidenceType !== "string"
      || !Number.isSafeInteger(entry.investigatorId) || typeof entry.investigatedAt !== "string") throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  }
  return row as ECommandInvestigation;
}

async function request(path: string, body?: object): Promise<unknown> {
  const response = await guardedFetch(`/api/admin/commands/investigations${path}`, {
    method: body ? "POST" : "GET", cache: "no-store",
    ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("X-Nexion-Upstream-Outcome")?.toLowerCase() === "unknown") throw new Error("IDEMPOTENCY_RESULT_UNKNOWN");
  const raw: unknown = await response.json();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const envelope = raw as { code?: unknown; message?: unknown; data?: unknown };
  if (!response.ok || envelope.code !== 0) {
    const code = typeof envelope.message === "string" ? envelope.message : "";
    throw Object.assign(new Error(formatAdminApiError(code, "INVESTIGATION_RECEIPT_UNREADABLE")), {
      status: response.ok && typeof envelope.code === "number" ? envelope.code : response.status, backendMessage: code,
    });
  }
  return envelope.data;
}

/** The backend discovers scope/hash/targets. No client reproduction of a business hash is used. */
export async function discoverECommand(locator: ECommandLocator): Promise<ECommandInvestigation | null> {
  const params = new URLSearchParams({ commandKey: locator.commandKey, originalMethod: locator.originalMethod, originalPath: locator.originalPath });
  const result = await request(`/by-command-key?${params}`);
  if (!Array.isArray(result) || result.length > 1) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  return result.length ? parseReceipt(result[0], locator) : null;
}

/** Missing receipts, forbidden reads, processing writers and insufficient evidence never release a local record. */
export async function investigateECommand(record: PendingMutationRecord, locator: ECommandLocator, evidence: ECommandEvidence, readAuthority?: string) {
  const authority = readAuthority ?? (locator.originalPath === "/api/admin/config/phone-calibration/risk" ? "device_e6_read"
    : locator.originalPath.startsWith("/api/admin/finance/withdrawals/") ? "finance_d2_read"
      : locator.originalPath.startsWith("/api/admin/treasury/") ? "finance_d3_read"
        : locator.originalPath === "/api/admin/platform/audit/operations" || locator.originalPath.startsWith("/api/admin/devices/orders/") ? "device_e4_read"
    : locator.originalPath.includes("/task-pools/") ? "device_e2_read" : "device_e5_read");
  if (!canInvestigateECommand(authority)) throw Object.assign(new Error("COMMAND_INVESTIGATION_FORBIDDEN"), { status: 403, backendMessage: "COMMAND_INVESTIGATION_FORBIDDEN" });
  const original = await discoverECommand(locator);
  if (!original) throw new Error("INVESTIGATION_ORIGINAL_NOT_FOUND_REMAINS_LOCKED");
  const fundCommand = /^(?:D2|D3|E4)(?:[_:])/.test(original.scope) || original.scope === "A2_COMMAND"
    || /^(?:F1_VRANK_(?:THRESHOLD_UPDATE|REWARD_ADD|REWARD_UPDATE|REWARD_REMOVE)|F_TEAM_CONFIG_UPDATE|F4_AMBASSADOR_POLICY_UPDATE|F5_COMMISSION_(?:REVERSE|REISSUE|SUSPENSION|ANOMALY_CONFIG))$/.test(original.scope)
    || /^(?:J4_PLAYBOOK_|I1_COPY_|I2_NOVA_|I3_NOTIFICATION_CAMPAIGN_|I6_I18N_|D5_WITHDRAWAL_LIMITS|D6_FX_QUOTE|FINANCE:D7:CONFIG_UPDATE$|D7_PAYOUT_VND_CONFIG$)/.test(original.scope);
  if (!fundCommand && !isRetryExpired(record) && !original.locked) throw new Error("INVESTIGATION_KNOWN_RESULT_CONFLICT");
  // All conclusion fields are requests for server verification, never a client-supplied result.
  return parseReceipt(await request("", {
    scope: original.scope, commandKey: original.commandKey, requestHash: original.requestHash,
    conclusion: evidence.conclusion, evidenceReference: evidence.evidenceReference,
    ...(evidence.evidenceAuditId === undefined ? {} : { evidenceAuditId: evidence.evidenceAuditId }),
  }), locator);
}
