interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export interface UploadedAsset {
  assetId: string;
  objectKey: string;
  bucket?: string | null;
  contentType?: string | null;
  sizeBytes?: number | null;
  previewUrl: string;
  expiresAt?: string | null;
  domain?: string | null;
  usage?: string | null;
}

let requestSeq = 0;

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  return `${prefix}-${Date.now()}-${requestSeq}`;
}

async function mediaRequest<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  const response = await fetch(`/api/admin/media${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as ApiResult<T> | null;

  if (!response.ok || !result || result.code !== 0) {
    throw new Error(result?.message || `MEDIA_REQUEST_FAILED_${response.status}`);
  }

  return result.data as T;
}

export async function uploadAdminMedia(
  file: File,
  options: { domain: string; usage: string; entityType?: string; entityId?: string; operator?: string },
) {
  const body = new FormData();
  body.append("file", file);

  const params = new URLSearchParams({
    domain: options.domain,
    usage: options.usage,
  });
  if (options.entityType) {
    params.set("entityType", options.entityType);
  }
  if (options.entityId) {
    params.set("entityId", options.entityId);
  }
  if (options.operator) {
    params.set("operator", options.operator);
  }

  return mediaRequest<UploadedAsset>(`/uploads?${params.toString()}`, {
    method: "POST",
    body,
    idempotencyPrefix: "admin-media-upload",
  });
}

export async function refreshAdminMediaPreviewUrl(assetId: string) {
  return mediaRequest<UploadedAsset>(`/uploads/${encodeURIComponent(assetId)}/preview-url`, {
    method: "GET",
  });
}
