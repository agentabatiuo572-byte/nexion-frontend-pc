import type { SupportFaq } from "../../app/components/domain-views/m-tabs/data";
import { fundCommandOrigin, fundCommandResult, fundCommandSettled, type FundCommandOrigin, type FundCommandEvidence } from "./fund-command-investigation";
import { isOriginalCommandOrigin, queryOriginalCommand } from "./original-command-query";
import type { PendingMutationRecord, PendingRecoveryConclusion } from "./pending-mutation-store";
import { fetchDirectCommandReceipt } from "./direct-command-receipt";

export type M4FaqCommand = {
  commandOrigin?: FundCommandOrigin;
  actorId: number;
  kind: "create" | "edit" | "publish" | "unpublish" | "delete";
  row: SupportFaq;
  before: SupportFaq | null;
  request: { method: "POST" | "PATCH" | "DELETE"; path: string; body: string };
};

/** Session storage is an input boundary. Incomplete historical receipts stay query-only. */
export function isM4FaqCommand(value: unknown): value is M4FaqCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const command = value as M4FaqCommand;
  const faq = (row: SupportFaq | null) => !!row && typeof row === "object"
    && typeof row.id === "string" && row.id.length > 0
    && ["general", "account", "withdrawal", "deposit", "hardware", "earnings", "genesis", "technical", "other"].includes(row.category)
    && typeof row.question === "string" && typeof row.answer === "string"
    && ["Help Center", "Nova", "Ticket Create"].includes(row.surface)
    && ["zh-CN", "en-US", "vi-VN", "id", "ms", "fil", "ru", "kk", "uz"].includes(row.language)
    && ["published", "draft"].includes(row.status)
    && Number.isSafeInteger(row.sortOrder) && row.sortOrder >= 0 && row.sortOrder <= 999999
    && Number.isSafeInteger(row.version) && row.version >= 1 && typeof row.updatedAt === "string";
  if (!Number.isSafeInteger(command.actorId) || command.actorId < 1
    || !["create", "edit", "publish", "unpublish", "delete"].includes(command.kind)
    || !faq(command.row) || (command.kind === "create" ? command.before !== null : !faq(command.before))
    || !command.request || typeof command.request.body !== "string") return false;
  const path = `/knowledge/faqs${command.kind === "create" ? "" : `/${encodeURIComponent(command.row.id)}`}`;
  try {
    const body = JSON.parse(command.request.body);
    if (!body || typeof body.reason !== "string" || (command.before
      && (command.before.id !== command.row.id || body.expectedVersion !== command.before.version || body.expectedStatus !== command.before.status))) return false;
  } catch {
    return false;
  }
  if (!isOriginalCommandOrigin(command.commandOrigin, { originalMethod: command.request.method, originalPath: `/api/admin/content${command.request.path}`, readAuthority: "service_m4_read" })
    || command.commandOrigin && command.commandOrigin.originalAdminId !== String(command.actorId)) return false;
  return command.kind === "create" ? command.request.method === "POST" && command.request.path === path
    : command.kind === "delete" ? command.request.method === "DELETE" && command.request.path === path
      : command.request.method === "PATCH" && (command.request.path === path || command.request.path === `${path}/status`);
}

export function m4FaqCommandOrigin(request: M4FaqCommand["request"]) {
  return fundCommandOrigin(request.method, `/api/admin/content${request.path}`, "service_m4_read");
}

export async function queryM4FaqCommand(record: PendingMutationRecord & { faq?: M4FaqCommand }, evidence?: FundCommandEvidence) {
  if (!record.faq) return { receipt: null, settled: false };
  const command = record.faq;
  const receipt = await queryOriginalCommand({ ...record, commandOrigin: command.commandOrigin }, {
    originalMethod: command.request.method, originalPath: `/api/admin/content${command.request.path}`, readAuthority: "service_m4_read",
  }, String(command.actorId), evidence);
  return { receipt, settled: fundCommandSettled(receipt) };
}

export async function readM4FaqRecovery(record: PendingMutationRecord & { faq?: M4FaqCommand }, evidence?: FundCommandEvidence) {
  const result = await queryM4FaqCommand(record, evidence);
  let conclusion: PendingRecoveryConclusion = "unknown";
  const verdict = fundCommandResult(result.receipt);
  if (result.settled && verdict === "SUCCEEDED") conclusion = "succeeded";
  if (result.settled && verdict === "NOT_EXECUTED") conclusion = "not-executed";
  if (result.settled && verdict === "REJECTED") conclusion = "rejected";
  const command = record.faq;
  if (!result.receipt && command) {
    // Discovery omits older or unattributed rows. Only the exact scope lookup can prove absence.
    const scope = command.request.method === "POST" ? "M4_SUPPORT_FAQ_CREATE"
      : `M4_SUPPORT_FAQ_${command.request.method === "DELETE" ? "DELETE" : command.request.path.endsWith("/status") ? "STATUS" : "UPDATE"}:${command.row.id}`;
    const normalizedScope = scope.trim().toUpperCase().replace(/[^A-Z0-9_.:-]/g, "_");
    if (await fetchDirectCommandReceipt(normalizedScope, record.commandKey, command.actorId) === "NOT_FOUND") conclusion = "not-found";
  }
  return { ...result, conclusion };
}
