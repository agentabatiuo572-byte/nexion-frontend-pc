import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

export const platforms = { android: "Android", ios: "iOS" } as const;
export const languages = { zh: "中文", en: "English", vi: "Tiếng Việt" } as const;
export type Platform = keyof typeof platforms;
export type Language = keyof typeof languages;
export type Translations = Record<Language, string>;
export type Action = "save" | "submit" | "withdraw" | "reject" | "approve" | "publish" | "restore";
export type Stage = "idle" | "draft" | "pending" | "approved";
export interface Artifact {
  artifactId: string;
  versionName: string;
  latestBuild: number;
  updateType: "package" | "resource";
  downloadUrl: string;
  sha256: string;
  minNativeBuild?: number;
  maxNativeBuild?: number;
}
export interface Draft {
  artifactId: string;
  minBuild: number;
  notes: Translations;
  reasons: Translations;
}
export interface Policy extends Artifact, Draft {
  releaseId: string;
}
export interface Snapshot {
  status: Stage;
  restoring: boolean;
  live: Policy | null;
  candidate: Policy | null;
}
export interface PlatformUpdates extends Snapshot {
  platform: Platform;
  revision: number;
  previous: Policy | null;
  canRestore: boolean;
  requestReason: string | null;
  artifacts: Artifact[];
  allowedActions: Action[];
  history: { action: Action; actor: string; reason: string; createdAt: string; before: Snapshot; after: Snapshot }[];
}
export interface ActionBody {
  revision: number;
  requestId: string;
  reason: string;
  policy?: Draft;
}
export class UpdateError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export async function requestUpdates(platform: Platform, command?: { action: Action; body: ActionBody }): Promise<PlatformUpdates> {
  const path = "/api/admin/platform/app-updates";
  const response = await guardedFetch(command ? `${path}/${platform}/${command.action}` : `${path}?platform=${platform}`, command ? {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": command.body.requestId },
    body: JSON.stringify(command.body), cache: "no-store",
  } : { cache: "no-store" });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.code !== 0) {
    throw new UpdateError(formatAdminApiError(result?.message, "版本策略读取或保存失败，请重新读取当前记录。"), response.ok ? result?.code ?? 502 : response.status);
  }
  const data: PlatformUpdates | undefined = result.data;
  if (!data || data.platform !== platform || !Number.isSafeInteger(data.revision)
    || !["idle", "draft", "pending", "approved"].includes(data.status)
    || !Array.isArray(data.artifacts) || !Array.isArray(data.allowedActions) || !Array.isArray(data.history)) {
    throw new UpdateError("服务端返回的版本记录不完整，请重新读取。", 502);
  }
  return data;
}
