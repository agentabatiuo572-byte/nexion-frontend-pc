import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "./outcome-classification";

export type TrustDocumentSlot = "whitepaper" | "incorporation" | "msb" | "ein";

export interface TrustDocument {
  slot: TrustDocumentSlot;
  source: "DEFAULT" | "UPLOADED";
  version: string | null;
  language: string | null;
  referenceNo: string | null;
  verifyUrl: string | null;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  sha256: string;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface TrustDocumentUpload {
  version: string;
  language: string;
  referenceNo: string;
  verifyUrl: string;
  reason: string;
}

export const TRUST_DOCUMENT_NAMES: Record<TrustDocumentSlot, string> = {
  whitepaper: "白皮书",
  incorporation: "纽约州公司注册证书",
  msb: "FinCEN MSB 登记记录",
  ein: "IRS EIN 通知书",
};
export const TRUST_DOCUMENT_SLOTS = Object.keys(TRUST_DOCUMENT_NAMES) as TrustDocumentSlot[];
/** Company registrations are compliance content and need the trust-section authority; the white paper takes standard publishing. */
export const TRUST_DOCUMENT_SENSITIVE_AUTHORITY = "content_i4_trust_section_manage";
export const TRUST_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

interface ApiResult<T> { code: number; message?: string; data?: T }


async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const write = init?.method === "POST";
  const unknownMessage = path.endsWith("/restore-default")
    ? "资料操作结果未知，文件可能已经对外公开；请重新读取核对。"
    : "上传结果未知，文件可能已经对外公开；请重新读取，核对文件指纹、大小和上传时间。";
  let response: Response;
  try { response = await guardedFetch(`/api/admin/content/trust-documents${path}`, { ...init, cache: "no-store" }); }
  catch (error) { if (write) throw new OutcomeUnknownError(unknownMessage); throw error; }
  const body = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!body || !Number.isInteger(body.code) || body.message !== undefined && typeof body.message !== "string") {
    throw write ? new OutcomeUnknownError(unknownMessage) : new Error("TRUST_DOCUMENT_RESPONSE_INVALID");
  }
  const unknown = response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || isIdempotencyOutcomeOpen(body.message);
  if (!response.ok || body.code !== 0 || body.data == null || unknown) {
    const status = response.ok && body.code >= 400 && body.code < 500 ? body.code : response.status;
    const message = formatAdminApiError(body.message, `TRUST_DOCUMENT_REQUEST_FAILED_${response.status}`);
    const uncertain = write && (unknown || body.code >= 500 || !isDeterministicRejection(response.status, body.code) || response.ok && body.code === 0);
    throw Object.assign(uncertain ? new OutcomeUnknownError(message) : new Error(message), { status, apiCode: body.code, reasonCode: body.message });
  }
  return body.data;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function normalizeTrustDocument(raw: unknown): TrustDocument {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  if (!row || !TRUST_DOCUMENT_SLOTS.includes(row.slot as TrustDocumentSlot) || !["DEFAULT", "UPLOADED"].includes(String(row.source))
      || typeof row.fileName !== "string" || !Number.isSafeInteger(row.sizeBytes) || !Number.isSafeInteger(row.pageCount)
      || Number(row.sizeBytes) <= 0 || Number(row.pageCount) < 1 || Number(row.pageCount) > 80
      || typeof row.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(row.sha256)
      || !["version", "language", "referenceNo", "verifyUrl", "updatedBy", "updatedAt"].every(key => row[key] == null || typeof row[key] === "string")) {
    throw new Error("TRUST_DOCUMENT_RESPONSE_INVALID");
  }
  return {
    slot: row.slot as TrustDocumentSlot,
    source: row.source as TrustDocument["source"],
    version: text(row.version),
    language: text(row.language),
    referenceNo: text(row.referenceNo),
    verifyUrl: text(row.verifyUrl),
    fileName: row.fileName,
    sizeBytes: row.sizeBytes as number,
    pageCount: row.pageCount as number,
    sha256: row.sha256,
    updatedBy: text(row.updatedBy),
    updatedAt: text(row.updatedAt),
  };
}

export async function fetchTrustDocuments(): Promise<TrustDocument[]> {
  const data = await request<{ documents?: unknown }>("");
  if (!Array.isArray(data.documents)) throw new Error("TRUST_DOCUMENT_RESPONSE_INVALID");
  const documents = data.documents.map(normalizeTrustDocument);
  if (documents.length !== TRUST_DOCUMENT_SLOTS.length || new Set(documents.map(row => row.slot)).size !== TRUST_DOCUMENT_SLOTS.length) throw new Error("TRUST_DOCUMENT_RESPONSE_INVALID");
  return documents;
}

export function trustDocumentPreviewHref(document: Pick<TrustDocument, "slot" | "sha256">) {
  return `/api/admin/content/trust-documents/${document.slot}/file?v=${document.sha256.slice(0, 12)}`;
}

/** The PDF for preview; a failure carries the backend's code so the card can show operator copy. */
export async function fetchTrustDocumentFile(document: Pick<TrustDocument, "slot" | "sha256">): Promise<Blob> {
  const response = await guardedFetch(trustDocumentPreviewHref(document), { cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as ApiResult<unknown> | null;
    throw new Error(formatAdminApiError(body?.message, `TRUST_DOCUMENT_REQUEST_FAILED_${response.status}`));
  }
  if (response.headers.get("Content-Type")?.split(";")[0] !== "application/pdf") throw new Error("TRUST_DOCUMENT_TYPE_INVALID");
  return response.blob();
}

export async function uploadTrustDocument(current: TrustDocument, file: File, fields: TrustDocumentUpload, idempotencyKey: string) {
  const body = new FormData();
  body.append("file", file);
  for (const [key, value] of Object.entries(fields)) if (value.trim()) body.append(key, value.trim());
  body.append("expectedSha256", current.sha256);
  return normalizeTrustDocument(await request<unknown>(`/${current.slot}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body,
  }));
}

export async function restoreTrustDocument(current: TrustDocument, reason: string, idempotencyKey: string) {
  return restoreTrustDocumentBody(current.slot, JSON.stringify({ reason: reason.trim(), expectedSha256: current.sha256 }), idempotencyKey);
}

export async function restoreTrustDocumentBody(slot: TrustDocumentSlot, body: string, idempotencyKey: string) {
  return normalizeTrustDocument(await request<unknown>(`/${slot}/restore-default`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body,
  }));
}
