import { guardedFetch, formatAdminApiError } from "./error-messages";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";

export type ECommandLocator = {
  commandKey: string; originalMethod: "POST" | "PUT" | "PATCH" | "DELETE"; originalPath: string; originalAdminId: string;
};
export type ECommandBusinessState = "PROCESSING" | "FAILED" | "SUCCEEDED" | "REJECTED" | "UNKNOWN";
export type ECommandBatch = {
  accepted: string[];
  rejected: string[];
  conflicts: { withdrawalId: string; reason: string }[];
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
  originalStatus: "PROCESSING" | "UNKNOWN" | "SUCCEEDED" | "FAILED" | "CONFIRMED_SUCCEEDED" | "CONFIRMED_NOT_EXECUTED" | "CONFIRMED_REJECTED";
  locked: boolean;
  newOperationAllowed: boolean;
  businessCode?: number | null;
  businessState?: ECommandBusinessState;
  localTransactionRollbackConfirmed?: boolean;
  batch?: ECommandBatch | null;
  integrityRepair?: { messageKey: string; version: string; repairedCount?: number | null } | null;
  investigation: {
    id: number; conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN" | "REJECTED";
    requestedConclusion: string; evidenceReference: string; evidenceType: string;
    investigatorId: number; investigatedAt: string;
  } | null;
};
export type ECommandEvidence = {
  conclusion: "SUCCEEDED" | "NOT_EXECUTED" | "STILL_UNKNOWN" | "REJECTED";
  evidenceReference: string;
  evidenceAuditId?: number;
};

export type ECommandResult = "SUCCEEDED" | "NOT_EXECUTED" | "REJECTED" | "PROCESSING" | "FAILED" | "BATCH_RESULT" | "BUSINESS_RESULT_UNAVAILABLE" | "UNRESOLVED";

export type ECommandClosureOffer = { conclusions: ECommandEvidence["conclusion"][]; success?: "receipt" | "audit" };

/** The stored suffix is the normalized audit display name, never an administrator ID. */
function purchasePaymentPolicyScope(scope: string) {
  return scope.length <= 96 && /^D1:PURCHASE_PAYMENT_POLICY:[A-Z0-9_.:-]+$/.test(scope);
}

/**
 * Conclusions that may be REQUESTED, not promises of acceptance (origin/test e2297ac9).
 * Mirrors AdminCommandOrigin.localConfiguration and InvestigationService.allowedFact/investigate.
 * Rollback markers, the original response and audit bindings remain server-owned evidence.
 * A missing/failed lookup supplies no identity to investigate; known results keep the existing 24h gate.
 */
export function eCommandClosureRequests(receipt: ECommandInvestigation | null | undefined, expired: boolean): ECommandClosureOffer {
  if (!receipt || receipt.originalStatus === "PROCESSING" || receipt.originalStatus.startsWith("CONFIRMED_")
    || !expired && receipt.originalStatus !== "UNKNOWN") return { conclusions: [] };
  const scope = receipt.scope;
  const rbac = /^(?:A6_ROLE_(?:CREATE:[A-Za-z0-9_-]{1,64}|UPDATE:[1-9]\d{0,18})|A7_MENU_(?:CREATE:[A-Za-z0-9_-]{1,64}|(?:UPDATE|DELETE):[1-9]\d{0,18}))$/.test(scope);
  const j2 = /^(?:J2_COUNTRY|J2_ENDPOINT)/.test(scope) || scope === "J2_EDGE_SOURCE" || scope === "J2_EMERGENCY_BLOCK";
  const h9 = scope === "GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS"
    || /^GROWTH:H9:DEVICE_RANK_UPDATE:(?:growth\.device_rank\.model|h9\.dr\.sb\.[0-9a-f]{32})$/i.test(scope);
  const a3Param = scope.length <= 96 && /^A3_PLATFORM_PARAM:[A-Za-z0-9_.-]{1,80}$/.test(scope);
  const local = rbac || j2 || h9 || a3Param || scope === "J3_ALERT_CONFIG"
    || purchasePaymentPolicyScope(scope)
    || scope.startsWith("D1_TOPUP_CHANNEL_") || scope === "D1_VIETQR_CONFIG_UPDATE"
    || ["I5_JURISDICTION_CREATE", "I5_JURISDICTION_UPDATE", "I5_DISCLOSURE_DRAFT_SAVE", "I5_DISCLOSURE_DRAFT_DELETE",
      "I5_DISCLOSURE_MATRIX_CONFIGURE", "I5_DISCLOSURE_MATRIX_ARCHIVE", "I5_DISCLOSURE_GATE_UPDATE",
      "D5_WITHDRAWAL_LIMITS_UPDATE", "D5_WITHDRAWAL_LIMITS", "D6_FX_QUOTE_UPDATE", "D6_FX_QUOTE",
      "FINANCE:D7:CONFIG_UPDATE", "D7_PAYOUT_VND_CONFIG", "J4_PLAYBOOK_CREATE",
      "F1_VRANK_THRESHOLD_UPDATE", "F1_VRANK_REWARD_ADD", "F1_VRANK_REWARD_UPDATE", "F1_VRANK_REWARD_REMOVE",
      "F4_AMBASSADOR_POLICY_UPDATE", "F5_COMMISSION_ANOMALY_CONFIG", "M4_SUPPORT_FAQ_CREATE"].includes(scope)
    || /^(?:E2_POOL_|E5_DEVICE_|E6_PHONE_|J4_PLAYBOOK_(?:UPDATE|DRILL|CANCEL|RESUME):|I4_TRUST_SECTION_DRAFT_|M4_SUPPORT_FAQ_UPDATE:)/.test(scope)
    || /^I7_COURSE_(?:CREATE|DRAFT_UPDATE|DELETE|VERSION_CREATE|VERSION_UPDATE|VERSION_DELETE)/.test(scope);
  // RBAC, permission registration and resume have no accepted success-audit branch.
  const audit = !rbac && !scope.startsWith("J4_PLAYBOOK_RESUME:") && (scope === "A2_COMMAND" || scope === "L_BI_REPORT_CREATE"
    || purchasePaymentPolicyScope(scope)
    || scope.startsWith("L_BI_REPORT_ACTION_") || /^(?:E2_POOL_|E5_DEVICE_|I1_COPY_|I2_NOVA_|I3_NOTIFICATION_CAMPAIGN_|I6_I18N_|I7_COURSE_|M4_SUPPORT_FAQ_|I4_TRUST_SECTION_)/.test(scope)
    || scope === "J4_PLAYBOOK_CREATE" || /^J4_PLAYBOOK_(?:UPDATE|DRILL|EXECUTE|CANCEL|ROLLBACK):/.test(scope)
    || scope === "E6_PHONE_RISK_SETTINGS" || scope === "J3_ALERT_CONFIG" || j2 || h9 || a3Param
    || /^GROWTH:H[14]:/.test(scope) || /^A4_(?:PARAM:|EVENT_LIFECYCLE:|H3_OUTBOX_REDRIVE:|EVENT_RETENTION_RUN$)/.test(scope)
    || scope === "I4_TRUST_DOCUMENT" || /^(?:D5_WITHDRAWAL_LIMITS|D6_FX_QUOTE|FINANCE:D7:CONFIG_UPDATE$|D7_PAYOUT_VND_CONFIG$)/.test(scope)
    || /^(?:F1_VRANK_|F4_MATERIAL_REVIEW:)/.test(scope)
    || ["F4_AMBASSADOR_POLICY_UPDATE", "F_TEAM_CONFIG_UPDATE", "F5_COMMISSION_REVERSE", "F5_COMMISSION_REISSUE", "F5_COMMISSION_SUSPENSION", "F5_COMMISSION_ANOMALY_CONFIG",
      "A3_PLATFORM_EXPERIENCE", "USER_NICKNAME_RESET", "E3_TRADEIN_RECYCLE", "E3_TRADEIN_REPLACE"].includes(scope)
    || scope.startsWith("A3_FEATURE_FLAG:") || /^USER_PAYMENT_METHOD_(?:UNBIND|REBIND_NOTICE):(?:PRODUCTION|SANDBOX)$/.test(scope)
    || /^(?:D2|D3|E4|H2|K1|J1|I5|C2)(?:[_:])/.test(scope) || scope.startsWith("GROWTH:H2:"));
  const conclusions: ECommandEvidence["conclusion"][] = [];
  const byReceipt = receipt.originalStatus === "SUCCEEDED" && (receipt.businessCode === 0 || receipt.businessCode === null || receipt.businessCode === undefined && scope.startsWith("J4_PLAYBOOK_RESUME:"));
  if (eCommandCanConcludeRejected(receipt)) conclusions.push("REJECTED");
  if (byReceipt || audit) conclusions.push("SUCCEEDED");
  // These I5 codes are candidates only: provenNotExecuted must also match the exact stored message.
  const localNonexecutionReply = scope === "I5_JURISDICTION_CREATE" && receipt.businessCode === 409
    || scope === "I5_JURISDICTION_UPDATE" && (receipt.businessCode === 404 || receipt.businessCode === 409);
  // The new flag proves only response-free local rollback; I5 has separate nonexecution replies.
  // Without the flag, preserve the previous candidates, including the explicit null-code gate.
  const rollback = receipt.localTransactionRollbackConfirmed === undefined
    ? receipt.businessCode === null && receipt.originalStatus !== "SUCCEEDED"
    : receipt.localTransactionRollbackConfirmed;
  if (local && (rollback || localNonexecutionReply)) conclusions.push("NOT_EXECUTED");
  if (receipt.originalStatus === "UNKNOWN") conclusions.push("STILL_UNKNOWN");
  return { conclusions, ...(conclusions.includes("SUCCEEDED") ? { success: byReceipt ? "receipt" as const : "audit" as const } : {}) };
}

/** The recovery row's last lookup, including a failed lookup, uses the same request rules. */
export function eCommandClosureOffer(outcome: { receipt: ECommandInvestigation | null } | { error: string } | undefined, expired: boolean): ECommandClosureOffer {
  return eCommandClosureRequests(outcome && "receipt" in outcome ? outcome.receipt : null, expired);
}

/** Compatibility helpers: these only permit requesting server-owned rollback proof. */
export function eCommandCanRequestResumeRollback(receipt: ECommandInvestigation | null | undefined) {
  return !!receipt?.scope.startsWith("J4_PLAYBOOK_RESUME:") && eCommandClosureRequests(receipt, true).conclusions.includes("NOT_EXECUTED");
}

export function eCommandCanRequestRbacRollback(receipt: ECommandInvestigation | null | undefined) {
  return !!receipt && /^(?:A6_ROLE_|A7_MENU_)/.test(receipt.scope)
    && eCommandClosureRequests(receipt, true).conclusions.includes("NOT_EXECUTED");
}

/** Governed conclusions take precedence; unconfirmed replies use business results and one verified legacy list. */
export function eCommandResult(receipt: ECommandInvestigation | null): ECommandResult {
  if (receipt?.businessState === "PROCESSING") return "PROCESSING";
  if (!receipt || receipt.locked) return "UNRESOLVED";
  if (receipt.originalStatus === "CONFIRMED_REJECTED") return "REJECTED";
  if (receipt.originalStatus === "CONFIRMED_SUCCEEDED") return "SUCCEEDED";
  if (receipt.originalStatus === "CONFIRMED_NOT_EXECUTED" && receipt.newOperationAllowed) return "NOT_EXECUTED";
  if (receipt.businessState === "SUCCEEDED" && /^D2_BATCH_(?:APPROVE|REJECT|DELAY|FREEZE)$/.test(receipt.scope))
    return receipt.batch ? "BATCH_RESULT" : "BUSINESS_RESULT_UNAVAILABLE";
  // Verified callbacks return only success or throw. H3 redrive proves requeue, not delivery.
  // A4 retention is excluded: failing to acquire its lock is also a normal return.
  // E2_POOL_CREATE/UPDATE use the E2 investigation paths above, but require a business verdict until their backend callbacks are verified.
  const successOnly = receipt.scope === "A2_COMMAND" || receipt.scope === "E6_PHONE_RISK_SETTINGS" || receipt.scope === "F5_COMMISSION_ANOMALY_CONFIG"
    || purchasePaymentPolicyScope(receipt.scope)
    || receipt.scope === "D1_HDPAY_MANUAL_CREDIT"
    || receipt.scope.startsWith("A4_H3_OUTBOX_REDRIVE:")
    || receipt.scope === "USER_NICKNAME_RESET" || /^USER_PAYMENT_METHOD_(?:UNBIND|REBIND_NOTICE):(?:PRODUCTION|SANDBOX)$/.test(receipt.scope)
    // TrustDocumentService returns only Document; every refusal throws, including SHA/CAS conflicts.
    || receipt.scope === "I4_TRUST_DOCUMENT"
    || /^(?:D3_FORECAST_CONFIG_UPDATE|D3_RESERVE_INJECTION|D3_SENSITIVE_EXPORT_(?:RECONCILIATION|LIABILITIES)|E2_POOL_(?:RANDOM|STATUS))$/.test(receipt.scope);
  if (receipt.businessState !== undefined) {
    // A completed command whose reply carries no code is "processed", not "still unknown": the backend refuses STILL_UNKNOWN for it.
    if (receipt.businessState === "UNKNOWN") return receipt.businessCode !== null || receipt.originalStatus !== "SUCCEEDED" ? "UNRESOLVED"
      : successOnly ? "SUCCEEDED" : "BUSINESS_RESULT_UNAVAILABLE";
    // These code-zero replies need their original result details. An I6 repair can save a draft with zero repaired issues.
    // OpsNovaService:188–231 may skip refused items.
    // OpsEmergencyControlService:1385–1398 also replays executions with skipped/rolled-back steps as code zero.
    if (receipt.businessState === "SUCCEEDED" && (receipt.scope === "I2_NOVA_SOCIAL_SYNC"
      || receipt.scope.startsWith("I6_I18N_INTEGRITY_FIX:") && !receipt.integrityRepair
      || receipt.scope.startsWith("J4_PLAYBOOK_EXECUTE:")))
      return "BUSINESS_RESULT_UNAVAILABLE";
    return receipt.businessState;
  }
  if (receipt.originalStatus !== "SUCCEEDED") return "UNRESOLVED";
  return successOnly ? "SUCCEEDED" : "BUSINESS_RESULT_UNAVAILABLE";
}

export function eCommandSettled(receipt: ECommandInvestigation | null) {
  if (receipt?.originalStatus === "CONFIRMED_REJECTED" && !receipt.locked) return true;
  const result = eCommandResult(receipt);
  // A6's only trusted-refusal producer throws inside the business transaction;
  // its FAILED reply is saved only after rollback. A committed nonzero reply is different.
  return result === "SUCCEEDED" || result === "NOT_EXECUTED" || result === "REJECTED" && receipt?.originalStatus === "FAILED"
    && /^A6_ROLE_(?:CREATE:[A-Z0-9_-]{1,64}|UPDATE:[1-9]\d*)$/.test(receipt.scope);
}

export function eCommandRollbackConfirmed(receipt: ECommandInvestigation | null) {
  return receipt?.originalStatus === "FAILED" && !receipt.locked && receipt.localTransactionRollbackConfirmed === true;
}

/** A batch is resolved only when every original target has exactly one retained item result. */
export function eCommandBatchResolved(receipt: ECommandInvestigation | null, targets: readonly string[]) {
  if (eCommandResult(receipt) !== "BATCH_RESULT" || !receipt?.batch) return false;
  const ids = [...receipt.batch.accepted, ...receipt.batch.rejected, ...receipt.batch.conflicts.map(item => item.withdrawalId)];
  const expected = new Set(targets);
  return expected.size > 0 && ids.length === expected.size && ids.every(id => expected.has(id));
}

/** Only an original completed nonzero reply can authorize the new rejection conclusion. */
export function eCommandCanConcludeRejected(receipt: ECommandInvestigation | null) {
  return receipt?.originalStatus === "SUCCEEDED" && receipt.businessState === "REJECTED"
    && receipt.businessCode != null && receipt.businessCode !== 0 && !receipt.locked;
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
  const d1Topup = locator.originalPath.match(/^\/api\/admin\/finance\/topup\/(?:channels\/([^/]+)\/(enabled|fee|min-amount|max-amount)|reconciliation\/([^/]+)\/writeoff)$/);
  const d1Channel = d1Topup ? decodeURIComponent(d1Topup[1] ?? d1Topup[3]).trim().toLowerCase().replaceAll("_", "-") : "";
  // Same channel aliases as OpsFinanceService.normalizeChannelCode; the locator remains exact.
  const d1CanonicalChannel = ["trc20", "erc20", "bep20"].find(code => d1Channel.includes(code))
    ?? (d1Channel.includes("vietqr") || d1Channel.includes("bank") ? "vietqr"
      : ["card", "checkout", "stripe"].some(code => d1Channel.includes(code)) ? "card" : d1Channel);
  const d1TopupScope = d1Topup && (d1Topup[1]
    ? `D1_TOPUP_CHANNEL_${({ enabled: "ENABLED", fee: "FEE", "min-amount": "MIN", "max-amount": "MAX" })[d1Topup[2] as "enabled"]}_${d1CanonicalChannel.toUpperCase()}`
    : `D1_TOPUP_RECONCILIATION_${d1CanonicalChannel.toUpperCase()}`);
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
  const courseParts = locator.originalPath.match(/^\/api\/admin\/content\/i18n-learning\/courses\/(.+)$/)?.[1].split("/").map(decodeURIComponent);
  let courseScope: string | undefined;
  if (courseParts) {
    const [course, action, version, versionAction] = courseParts;
    const method = locator.originalMethod;
    if (courseParts.length === 1) {
      if (course === "featured" && method === "PATCH") courseScope = "I7_COURSE_FEATURED";
      else if (method === "POST" || method === "DELETE") courseScope = `I7_COURSE_${method === "POST" ? "CREATE" : "DELETE"}:${course}`;
    } else if (courseParts.length === 2) {
      if (action === "draft" && method === "PATCH") courseScope = `I7_COURSE_DRAFT_UPDATE:${course}`;
      else if (["publish", "archive"].includes(action) && method === "POST") courseScope = `I7_COURSE_${action.toUpperCase()}:${course}`;
      else if (action === "versions" && method === "POST") courseScope = `I7_COURSE_VERSION_CREATE:${course}`;
    } else if (action === "versions") {
      if (courseParts.length === 3 && (method === "PATCH" || method === "DELETE")) courseScope = `I7_COURSE_VERSION_${method === "PATCH" ? "UPDATE" : "DELETE"}:${course}:${version}`;
      else if (courseParts.length === 4 && ["publish", "rollback"].includes(versionAction) && method === "POST") courseScope = `I7_COURSE_VERSION_${versionAction.toUpperCase()}:${course}:${version}`;
    }
  }
  const scopeMatches = locator.originalPath === "/api/admin/finance/purchase-payment-policy"
    ? locator.originalMethod === "PATCH" && typeof row.scope === "string" && purchasePaymentPolicyScope(row.scope) && row.originalTarget === "1"
    : d1Topup ? locator.originalMethod === (d1Topup[1] ? "PATCH" : "POST") && row.scope === d1TopupScope
    : locator.originalPath === "/api/admin/finance/vietqr/config" ? locator.originalMethod === "PATCH" && row.scope === "D1_VIETQR_CONFIG_UPDATE"
    : /^\/api\/admin\/finance\/vietqr\/orders\/[^/]+\/manual-credit$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "D1_HDPAY_MANUAL_CREDIT"
    : locator.originalPath === "/api/admin/platform/audit/operations" ? row.scope === "A2_COMMAND"
    : /^\/api\/admin\/growth\/rhythm\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === normalizeScope(`GROWTH:H1:RHYTHM_PARAM_UPDATE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/growth\/phases\/dials\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === normalizeScope(`GROWTH:H1:PHASE_DIAL_UPDATE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/growth\/phases\/months\/[1-9]\d*\/dials\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === normalizeScope(`GROWTH:H1:PHASE_MONTH_DIAL_UPDATE:${locator.originalPath.split("/").at(-3)}:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/growth\/phases\/controls\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === normalizeScope(`GROWTH:H1:PHASE_CONTROL_UPDATE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/growth\/phases\/overrides\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === normalizeScope(`GROWTH:H1:PHASE_OVERRIDE_UPDATE:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : locator.originalPath === "/api/admin/platform/accounts/permissions" ? locator.originalMethod === "POST" && row.scope === "A1_PERMISSION_REGISTER"
    : locator.originalPath === "/api/admin/platform/roles" ? locator.originalMethod === "POST" && /^A6_ROLE_CREATE:[A-Z0-9_-]{1,64}$/.test(String(row.scope))
    : /^\/api\/admin\/platform\/roles\/[1-9]\d*$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === `A6_ROLE_UPDATE:${locator.originalPath.split("/").at(-1)}`
    : locator.originalPath === "/api/admin/platform/menus" ? locator.originalMethod === "POST" && /^A7_MENU_CREATE:[A-Z0-9_-]{1,64}$/.test(String(row.scope))
    : /^\/api\/admin\/platform\/menus\/[1-9]\d*$/.test(locator.originalPath) ? ["PATCH", "DELETE"].includes(locator.originalMethod) && row.scope === `A7_MENU_${locator.originalMethod === "DELETE" ? "DELETE" : "UPDATE"}:${locator.originalPath.split("/").at(-1)}`
    : locator.originalMethod === "POST" && locator.originalPath === "/api/admin/platform/events/retention-runs" ? row.scope === "A4_EVENT_RETENTION_RUN"
    : locator.originalPath === "/api/admin/content/knowledge/faqs" ? locator.originalMethod === "POST" && row.scope === "M4_SUPPORT_FAQ_CREATE"
    : /^\/api\/admin\/content\/knowledge\/faqs\/[^/]+(?:\/status)?$/.test(locator.originalPath) ? row.scope === normalizeScope(`M4_SUPPORT_FAQ_${locator.originalMethod === "DELETE" ? "DELETE" : locator.originalPath.endsWith("/status") ? "STATUS" : "UPDATE"}:${decodeURIComponent(locator.originalPath.split("/").at(locator.originalPath.endsWith("/status") ? -2 : -1)!)}`) && ["PATCH", "DELETE"].includes(locator.originalMethod)
    : /^\/api\/admin\/users\/profiles\/[^/]+\/nickname\/reset$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "USER_NICKNAME_RESET"
    : /^\/api\/admin\/users\/profiles\/[^/]+\/payment-methods\/[1-9]\d*\/(?:unbind|rebind-notification)$/.test(locator.originalPath) ? locator.originalMethod === "POST" && new RegExp(`^USER_PAYMENT_METHOD_${locator.originalPath.endsWith("/unbind") ? "UNBIND" : "REBIND_NOTICE"}:(?:PRODUCTION|SANDBOX)$`).test(String(row.scope))
    : /^\/api\/admin\/devices\/users\/[^/]+\/tradein\/(?:replace|recycle)$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === `E3_TRADEIN_${locator.originalPath.split("/").at(-1)!.toUpperCase()}`
    : /^\/api\/admin\/platform\/events\/params\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH"
      && ["day0", "event_retention", "sampling"].includes(decodeURIComponent(locator.originalPath.split("/").at(-1)!))
      && row.originalTarget === decodeURIComponent(locator.originalPath.split("/").at(-1)!)
      && row.scope === normalizeScope(`A4_PARAM:${decodeURIComponent(locator.originalPath.split("/").at(-1)!)}`)
    : /^\/api\/admin\/platform\/events\/schema-registrations\/[^/]+\/lifecycle$/.test(locator.originalPath) ? locator.originalMethod === "POST"
      && row.originalTarget === decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim().toLowerCase()
      && row.scope === normalizeScope(`A4_EVENT_LIFECYCLE:${decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim().toLowerCase()}`)
    : /^\/api\/admin\/platform\/events\/outbox\/[^/]+\/redrive$/.test(locator.originalPath) ? locator.originalMethod === "POST"
      && row.originalTarget === decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim()
      && row.scope === normalizeScope(`A4_H3_OUTBOX_REDRIVE:${decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim()}`)
    : locator.originalPath === "/api/admin/platform/config" ? locator.originalMethod === "PUT" && (
      ["platform.global_rate_limit_per_minute", "withdrawal.strong_review_threshold_usdt"].includes(String(row.originalTarget)) && row.scope === normalizeScope(`A3_PLATFORM_PARAM:${row.originalTarget}`)
      || typeof row.originalTarget === "string" && /^feature\.[A-Za-z0-9_.-]{1,80}$/.test(row.originalTarget)
        && row.scope === normalizeScope(`A3_FEATURE_FLAG:${row.originalTarget.slice("feature.".length)}`))
    : locator.originalPath === "/api/admin/platform/config/experience" ? locator.originalMethod === "PUT" && row.scope === "A3_PLATFORM_EXPERIENCE" && row.originalTarget === "A3_PLATFORM_EXPERIENCE"
    : locator.originalPath === "/api/admin/risk/multi-account/registration-params" ? locator.originalMethod === "PATCH" && ["auth.risk.h5_register_captcha", "auth.risk.h5_register_device_limit", "auth.risk.h5_freeze_newcomer_gift"].includes(String(row.originalTarget)) && row.scope === normalizeScope(`A3_PLATFORM_PARAM:${row.originalTarget}`)
    : /^\/api\/admin\/teams\/ranks\/[^/]+\/thresholds\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === "F1_VRANK_THRESHOLD_UPDATE"
    : /^\/api\/admin\/teams\/ranks\/[^/]+\/rewards(?:\/[^/]+)?$/.test(locator.originalPath) ? row.scope === ({ POST: "F1_VRANK_REWARD_ADD", PUT: "F1_VRANK_REWARD_UPDATE", DELETE: "F1_VRANK_REWARD_REMOVE" } as Record<string, string>)[locator.originalMethod]
    : /^\/api\/admin\/teams\/commissions\/config\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === "F_TEAM_CONFIG_UPDATE"
    : locator.originalPath === "/api/admin/teams/ambassador-policy" ? locator.originalMethod === "PUT" && row.scope === "F4_AMBASSADOR_POLICY_UPDATE"
    : /^\/api\/admin\/teams\/ambassador-applications\/[1-9]\d*\/materials\/review$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === `F4_MATERIAL_REVIEW:${locator.originalAdminId}:${locator.originalPath.split("/").at(-3)}`
    : locator.originalPath === "/api/admin/commissions/anomaly-config" ? locator.originalMethod === "PUT" && row.scope === "F5_COMMISSION_ANOMALY_CONFIG"
    : copyPath ? row.scope === copyScope
    : novaPath ? !!novaScope && row.scope === normalizeScope(novaScope)
    : locator.originalPath === "/api/admin/withdraw/limits" ? ["D5_WITHDRAWAL_LIMITS_UPDATE", "D5_WITHDRAWAL_LIMITS"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/finance/fx-quote" ? ["D6_FX_QUOTE_UPDATE", "D6_FX_QUOTE"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/finance/payout-vnd/config" ? ["FINANCE:D7:CONFIG_UPDATE", "D7_PAYOUT_VND_CONFIG"].includes(String(row.scope))
    : locator.originalPath === "/api/admin/content/campaigns" ? row.scope === "I3_NOTIFICATION_CAMPAIGN_CREATE"
    : /^\/api\/admin\/content\/campaigns\/[^/]+$/.test(locator.originalPath) ? row.scope === "I3_NOTIFICATION_CAMPAIGN_DELETE"
    : /^\/api\/admin\/content\/campaigns\/[^/]+\/(?:draft|schedule|send-now|cancel)$/.test(locator.originalPath) ? row.scope === normalizeScope(`I3_NOTIFICATION_CAMPAIGN_${({ draft: "DRAFT_UPDATE", schedule: "SCHEDULE", "send-now": "SEND_NOW", cancel: "CANCEL" })[locator.originalPath.split("/").at(-1)! as "draft"]}`)
    : /^\/api\/admin\/content\/trust-disclosure\/trust-sections\/[^/]+\/versions$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "I4_TRUST_SECTION_DRAFT_CREATE"
    : /^\/api\/admin\/content\/trust-disclosure\/trust-sections\/[^/]+\/versions\/[^/]+$/.test(locator.originalPath) ? ["PATCH", "DELETE"].includes(locator.originalMethod) && row.scope === `I4_TRUST_SECTION_DRAFT_${locator.originalMethod === "PATCH" ? "UPDATE" : "DELETE"}`
    : /^\/api\/admin\/content\/trust-disclosure\/trust-sections\/[^/]+\/(?:publish|rollback|archive)$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === `I4_TRUST_SECTION_${locator.originalPath.split("/").at(-1)!.toUpperCase()}`
    : locator.originalPath === "/api/admin/content/trust-disclosure/disclosures/jurisdictions" ? locator.originalMethod === "POST" && row.scope === "I5_JURISDICTION_CREATE"
    : /^\/api\/admin\/content\/trust-disclosure\/disclosures\/jurisdictions\/[^/]+$/.test(locator.originalPath) ? locator.originalMethod === "PATCH" && row.scope === "I5_JURISDICTION_UPDATE"
    : /^\/api\/admin\/content\/trust-disclosure\/disclosures\/[^/]+\/versions$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "I5_DISCLOSURE_DRAFT_SAVE"
    : /^\/api\/admin\/content\/trust-disclosure\/disclosures\/[^/]+\/versions\/[^/]+$/.test(locator.originalPath) ? ["PATCH", "DELETE"].includes(locator.originalMethod) && row.scope === `I5_DISCLOSURE_DRAFT_${locator.originalMethod === "DELETE" ? "DELETE" : "SAVE"}`
    : /^\/api\/admin\/content\/trust-documents\/(?:whitepaper|incorporation|msb|ein)(?:\/restore-default)?$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === "I4_TRUST_DOCUMENT"
    : locator.originalPath === "/api/admin/content/i18n-learning/rescan" ? row.scope === "I6_I18N_RESCAN"
    : /^\/api\/admin\/growth\/quest-events\/wheel-tiers\/[^/]+\/retire$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === normalizeScope(`GROWTH:H4:WHEEL_TIER_RETIRE:${decodeURIComponent(locator.originalPath.split("/").at(-2)!).trim()}`)
    : locator.originalPath === "/api/admin/growth/public-stats" ? locator.originalMethod === "PATCH" && row.scope === "GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS"
    : locator.originalPath === "/api/admin/growth/device-rank-config" ? locator.originalMethod === "PATCH" && /^GROWTH:H9:DEVICE_RANK_UPDATE:(?:growth\.device_rank\.model|h9\.dr\.sb\.[0-9a-f]{32})$/i.test(String(row.scope))
    : courseParts ? !!courseScope && row.scope === normalizeScope(courseScope)
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
              : locator.originalPath === "/api/admin/bi/reports" ? locator.originalMethod === "POST" && row.scope === "L_BI_REPORT_CREATE"
              : /^\/api\/admin\/bi\/reports\/[^/]+\/(?:approve|rerun|generate|download)$/.test(locator.originalPath) ? locator.originalMethod === "POST" && row.scope === `L_BI_REPORT_ACTION_${locator.originalPath.split("/").at(-1)!.toUpperCase()}`
                : /^(E2_POOL_|E5_DEVICE_)/.test(String(row.scope)) || row.scope === "E6_PHONE_RISK_SETTINGS";
  if (!Number.isSafeInteger(row.originalRecordId) || Number(row.originalRecordId) < 1
    || typeof row.scope !== "string" || !scopeMatches
    || row.commandKey !== locator.commandKey || row.originalMethod !== locator.originalMethod || row.originalPath !== locator.originalPath
    || !Number.isSafeInteger(row.originalAdminId) || Number(row.originalAdminId) < 1
    || String(row.originalAdminId) !== locator.originalAdminId
    // Writers store SHA-256 or nameUUIDFromBytes (UUID v3); A3 experience retains its legacy hashCode.
    // The digest is server-owned metadata, not a replacement for the exact locator/scope checks above.
    || typeof row.requestHash !== "string" || !(/^(?:[a-fA-F0-9]{64}|[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/.test(row.requestHash)
      || row.scope === "A3_PLATFORM_EXPERIENCE" && /^[0-9a-f]{1,8}$/.test(row.requestHash))
    || row.originalTarget !== null && typeof row.originalTarget !== "string"
    || row.originalTargets !== null && typeof row.originalTargets !== "string"
    || !["PROCESSING", "UNKNOWN", "SUCCEEDED", "FAILED", "CONFIRMED_SUCCEEDED", "CONFIRMED_NOT_EXECUTED", "CONFIRMED_REJECTED"].includes(String(row.originalStatus))
    || row.locked !== ["PROCESSING", "UNKNOWN"].includes(String(row.originalStatus))
    || row.newOperationAllowed !== (row.originalStatus === "CONFIRMED_NOT_EXECUTED")) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (row.businessCode !== undefined && row.businessCode !== null
    && (!Number.isInteger(row.businessCode) || Number(row.businessCode) < -2147483648 || Number(row.businessCode) > 2147483647)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (row.localTransactionRollbackConfirmed !== undefined && typeof row.localTransactionRollbackConfirmed !== "boolean")
    throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (row.businessState !== undefined) {
    if (typeof row.businessState !== "string" || !["PROCESSING", "FAILED", "SUCCEEDED", "REJECTED", "UNKNOWN"].includes(row.businessState)
      || row.businessCode === undefined
      || row.businessState === "SUCCEEDED" && (row.businessCode !== 0 || !["SUCCEEDED", "CONFIRMED_SUCCEEDED"].includes(String(row.originalStatus)))
      || row.businessState === "REJECTED" && (row.businessCode === null || row.businessCode === 0 || !["FAILED", "SUCCEEDED", "CONFIRMED_SUCCEEDED", "CONFIRMED_REJECTED"].includes(String(row.originalStatus)))
      || row.businessState === "PROCESSING" && row.originalStatus !== "PROCESSING"
      || row.businessState === "FAILED" && row.originalStatus !== "FAILED") throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  }
  if (row.integrityRepair != null) {
    const repair = row.integrityRepair as Record<string, unknown>;
    if (!row.scope.startsWith("I6_I18N_INTEGRITY_FIX:") || row.businessState !== "SUCCEEDED"
      || typeof repair !== "object" || Array.isArray(repair)
      || typeof repair.messageKey !== "string" || !repair.messageKey.trim()
      || typeof repair.version !== "string" || !/^v[1-9]\d*$/.test(repair.version)
      || repair.repairedCount != null && (!Number.isSafeInteger(repair.repairedCount) || Number(repair.repairedCount) < 0))
      throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  }
  if (row.batch != null) {
    if (!/^D2_BATCH_(?:APPROVE|REJECT|DELAY|FREEZE)$/.test(row.scope) || typeof row.batch !== "object" || Array.isArray(row.batch)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
    const batch = row.batch as Record<string, unknown>;
    if (!Array.isArray(batch.accepted) || !Array.isArray(batch.rejected) || !Array.isArray(batch.conflicts)
      || [...batch.accepted, ...batch.rejected].some(id => typeof id !== "string" || !id.trim())
      || batch.conflicts.some(item => !item || typeof item !== "object" || Array.isArray(item)
        || typeof item.withdrawalId !== "string" || !item.withdrawalId.trim() || typeof item.reason !== "string" || !item.reason.trim())) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
    const ids = [...batch.accepted, ...batch.rejected, ...batch.conflicts.map(item => item.withdrawalId)];
    if (new Set(ids).size !== ids.length) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  }
  if (row.investigation !== null) {
    if (!row.investigation || typeof row.investigation !== "object" || Array.isArray(row.investigation)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
    const entry = row.investigation as Record<string, unknown>;
    if (!Number.isSafeInteger(entry.id) || !["SUCCEEDED", "NOT_EXECUTED", "STILL_UNKNOWN", "REJECTED"].includes(String(entry.conclusion))
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
    throw Object.assign(new Error(formatAdminApiError(code, "INVESTIGATION_RECEIPT_UNREADABLE", body ? "write" : "read")), {
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
  if (evidence.conclusion === "REJECTED" && original.originalStatus !== "CONFIRMED_REJECTED" && !eCommandCanConcludeRejected(original))
    throw new Error("INVESTIGATION_KNOWN_RESULT_CONFLICT");
  const fundCommand = /^(?:D2|D3|E4)(?:[_:])/.test(original.scope) || original.scope === "A2_COMMAND"
    || purchasePaymentPolicyScope(original.scope)
    || original.scope.startsWith("D1_TOPUP_") || ["D1_VIETQR_CONFIG_UPDATE", "D1_HDPAY_MANUAL_CREDIT"].includes(original.scope)
    || /^(?:A4_PARAM:|A4_EVENT_LIFECYCLE:|A4_H3_OUTBOX_REDRIVE:)/.test(original.scope)
    || /^(?:M4_SUPPORT_FAQ_CREATE|M4_SUPPORT_FAQ_(?:UPDATE|STATUS|DELETE):.+)$/.test(original.scope)
    || original.scope === "USER_NICKNAME_RESET" || /^USER_PAYMENT_METHOD_(?:UNBIND|REBIND_NOTICE):(?:PRODUCTION|SANDBOX)$/.test(original.scope)
    || /^E3_TRADEIN_(?:RECYCLE|REPLACE)$/.test(original.scope)
    || /^(?:A3_PLATFORM_PARAM:|A3_FEATURE_FLAG:)/.test(original.scope) || original.scope === "A3_PLATFORM_EXPERIENCE"
    || /^L_BI_REPORT_ACTION_(?:APPROVE|RERUN|GENERATE|DOWNLOAD)$/.test(original.scope)
    || /^(?:F1_VRANK_(?:THRESHOLD_UPDATE|REWARD_ADD|REWARD_UPDATE|REWARD_REMOVE)|F_TEAM_CONFIG_UPDATE|F4_AMBASSADOR_POLICY_UPDATE|F5_COMMISSION_(?:REVERSE|REISSUE|SUSPENSION|ANOMALY_CONFIG))$/.test(original.scope)
    || /^F4_MATERIAL_REVIEW:[1-9]\d*:[1-9]\d*$/.test(original.scope)
    || /^(?:J4_PLAYBOOK_|I1_COPY_|I2_NOVA_|I3_NOTIFICATION_CAMPAIGN_|I6_I18N_|D5_WITHDRAWAL_LIMITS|D6_FX_QUOTE|FINANCE:D7:CONFIG_UPDATE$|D7_PAYOUT_VND_CONFIG$)/.test(original.scope)
    || /^I4_TRUST_SECTION_(?:PUBLISH|ROLLBACK|ARCHIVE|DRAFT_CREATE|DRAFT_UPDATE|DRAFT_DELETE)$/.test(original.scope) || original.scope === "I4_TRUST_DOCUMENT"
    || /^I7_COURSE_(?:(?:CREATE|DRAFT_UPDATE|DELETE|PUBLISH|ARCHIVE|VERSION_(?:CREATE|UPDATE|DELETE|PUBLISH|ROLLBACK)):|FEATURED$)/.test(original.scope)
    || original.scope.startsWith("GROWTH:H4:WHEEL_TIER_RETIRE:")
    || original.scope === "GROWTH:H9:PUBLIC_STATS_UPDATE:PUBLIC_STATS" || /^GROWTH:H9:DEVICE_RANK_UPDATE:(?:growth\.device_rank\.model|h9\.dr\.sb\.[0-9a-f]{32})$/i.test(original.scope)
    || original.scope === "A4_EVENT_RETENTION_RUN";
  if (!fundCommand && !isRetryExpired(record) && !original.locked && evidence.conclusion !== "REJECTED") throw new Error("INVESTIGATION_KNOWN_RESULT_CONFLICT");
  // All conclusion fields are requests for server verification, never a client-supplied result.
  return parseReceipt(await request("", {
    scope: original.scope, commandKey: original.commandKey, requestHash: original.requestHash,
    conclusion: evidence.conclusion, evidenceReference: evidence.evidenceReference,
    ...(evidence.evidenceAuditId === undefined ? {} : { evidenceAuditId: evidence.evidenceAuditId }),
  }), locator);
}
