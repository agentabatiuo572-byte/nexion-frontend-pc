import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

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

export const TRUST_DOCUMENT_SLOTS: TrustDocumentSlot[] = ["whitepaper", "incorporation", "msb", "ein"];
export const TRUST_DOCUMENT_NAMES: Record<TrustDocumentSlot, string> = {
  whitepaper: "白皮书",
  incorporation: "纽约州公司注册证书",
  msb: "FinCEN MSB 登记记录",
  ein: "IRS EIN 通知书",
};
export const TRUST_DOCUMENT_MAX_BYTES = 20 * 1024 * 1024;

interface ApiResult<T> { code: number; message?: string; data?: T }

function idempotencyKey() {
  return `i4-doc-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await guardedFetch(`/api/admin/content/trust-documents${path}`, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !body || body.code !== 0 || body.data == null) {
    throw new Error(formatAdminApiError(body?.message, `TRUST_DOCUMENT_REQUEST_FAILED_${response.status}`));
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
      || typeof row.sha256 !== "string") {
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
  return data.documents.map(normalizeTrustDocument);
}

export function trustDocumentPreviewHref(document: Pick<TrustDocument, "slot" | "sha256">) {
  return `/api/admin/content/trust-documents/${document.slot}/file?v=${document.sha256.slice(0, 12)}`;
}

export async function uploadTrustDocument(current: TrustDocument, file: File, fields: TrustDocumentUpload) {
  const body = new FormData();
  body.append("file", file);
  for (const [key, value] of Object.entries(fields)) if (value.trim()) body.append(key, value.trim());
  body.append("expectedSha256", current.sha256);
  return normalizeTrustDocument(await request<unknown>(`/${current.slot}`, {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey() },
    body,
  }));
}

export async function restoreTrustDocument(current: TrustDocument, reason: string) {
  return normalizeTrustDocument(await request<unknown>(`/${current.slot}/restore-default`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey() },
    body: JSON.stringify({ reason: reason.trim(), expectedSha256: current.sha256 }),
  }));
}
