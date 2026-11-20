import type { SupportFaq } from "../../app/components/domain-views/m-tabs/data";
import { fundCommandOrigin, fundCommandSettled, type FundCommandOrigin, type FundCommandEvidence } from "./fund-command-investigation";
import { isOriginalCommandOrigin, queryOriginalCommand } from "./original-command-query";
import type { PendingMutationRecord } from "./pending-mutation-store";

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
