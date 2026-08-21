import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

export interface PublishedContentDocument { version: string; status: "PUBLISHED" | "DRAFT" | "UNPUBLISHED"; locales: Record<string, Record<string, unknown>>; revision: number; source?: string; configKey?: string }
export interface PublishedHowContentDocument { version: string; status: "PUBLISHED" | "DRAFT" | "UNPUBLISHED"; contents: Record<string, Record<string, unknown>>; revision: number; source?: string; configKey?: string }
interface ApiResult<T> { code: number; message?: string; data?: T }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await guardedFetch(path, { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !body || body.code !== 0 || body.data == null) throw new Error(formatAdminApiError(body?.message, `PUBLISHED_CONTENT_REQUEST_FAILED_${response.status}`));
  return body.data;
}

function normalize(raw: unknown): PublishedContentDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PUBLISHED_CONTENT_RESPONSE_INVALID");
  const row = raw as Record<string, unknown>;
  if (typeof row.version !== "string" || !["PUBLISHED", "DRAFT", "UNPUBLISHED"].includes(String(row.status)) || !row.locales || typeof row.locales !== "object" || Array.isArray(row.locales)) throw new Error("PUBLISHED_CONTENT_RESPONSE_INVALID");
  const revision = row.revision == null ? 0 : Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("PUBLISHED_CONTENT_RESPONSE_INVALID");
  return { version: row.version, status: row.status as PublishedContentDocument["status"], locales: row.locales as Record<string, Record<string, unknown>>, revision, source: typeof row.source === "string" ? row.source : undefined, configKey: typeof row.configKey === "string" ? row.configKey : undefined };
}
function normalizeHow(raw: unknown): PublishedHowContentDocument {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("HOW_CONTENT_RESPONSE_INVALID");
  const row = raw as Record<string, unknown>;
  if (typeof row.version !== "string" || !["PUBLISHED", "DRAFT", "UNPUBLISHED"].includes(String(row.status)) || !row.contents || typeof row.contents !== "object" || Array.isArray(row.contents)) throw new Error("HOW_CONTENT_RESPONSE_INVALID");
  const revision = row.revision == null ? 0 : Number(row.revision);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("HOW_CONTENT_RESPONSE_INVALID");
  return { version: row.version, status: row.status as PublishedHowContentDocument["status"], contents: row.contents as Record<string, Record<string, unknown>>, revision, source: typeof row.source === "string" ? row.source : undefined, configKey: typeof row.configKey === "string" ? row.configKey : undefined };
}

export async function fetchDeveloperDocsAdmin() { return normalize(await request<unknown>("/api/admin/developer/docs")); }
export async function updateDeveloperDocsAdmin(document: Pick<PublishedContentDocument, "version" | "status" | "locales" | "revision">, reason: string) { return normalize(await request<unknown>("/api/admin/developer/docs", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...document, expectedRevision: document.revision, revision: undefined, reason }) })); }
export async function fetchRankHowPolicyAdmin() { return normalize(await request<unknown>("/api/admin/teams/rank-policy")); }
export async function updateRankHowPolicyAdmin(document: Pick<PublishedContentDocument, "version" | "status" | "locales" | "revision">, reason: string) { return normalize(await request<unknown>("/api/admin/teams/rank-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...document, expectedRevision: document.revision, revision: undefined, reason }) })); }
export async function fetchHowContentAdmin() { return normalizeHow(await request<unknown>("/api/admin/content/how-it-works")); }
export async function updateHowContentAdmin(document: Pick<PublishedHowContentDocument, "version" | "status" | "contents" | "revision">, reason: string) { return normalizeHow(await request<unknown>("/api/admin/content/how-it-works", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...document, expectedRevision: document.revision, revision: undefined, reason }) })); }
