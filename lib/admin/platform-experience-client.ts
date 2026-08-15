import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";

export type ExperienceSource = "official" | "mock" | "unavailable";
export interface ExperienceChannel {
  key: string;
  intentType: string;
  textTemplate?: string | null;
  urlTemplate?: string | null;
  androidPackage?: string | null;
  iosScheme?: string | null;
  enabled: boolean;
}
export interface ExperienceDownload {
  officialUrl: string;
  iosUrl: string;
  androidUrl: string;
  apkUrl: string;
  version: string;
  releaseNotes: { zh: string; en: string };
  source: ExperienceSource;
}
export interface PlatformExperienceConfig {
  version: number;
  baseUrl: string;
  channels: ExperienceChannel[];
  appDownload: ExperienceDownload;
  homeNewcomerTasksEnabled?: boolean;
  homeWeeklyPromoEnabled?: boolean;
  ready: boolean;
  sources: string[];
  updatedAt?: string;
}

interface ApiResult<T> { code: number; message?: string; data?: T; }
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-platform-experience-commands-v1" });

class PlatformExperienceRequestError extends Error {
  constructor(public readonly status: number, public readonly apiCode: number | undefined, message: string) {
    super(message);
    this.name = "PlatformExperienceRequestError";
  }
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await guardedFetch("/api/admin/platform/config/experience", { ...init, cache: "no-store" });
  const body = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !body || body.code !== 0) {
    const message = body?.message === "PLATFORM_EXPERIENCE_VERSION_CONFLICT"
      ? "PLATFORM_EXPERIENCE_VERSION_CONFLICT"
      : formatAdminApiError(body?.message, `PLATFORM_EXPERIENCE_REQUEST_FAILED_${response.status}`);
    throw new PlatformExperienceRequestError(response.status, body?.code, message);
  }
  return body.data as T;
}

function normalize(raw: unknown): PlatformExperienceConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  const root = raw as Record<string, unknown>;
  const share = root.share && typeof root.share === "object" && !Array.isArray(root.share) ? root.share as Record<string, unknown> : null;
  const download = share?.appDownload && typeof share.appDownload === "object" && !Array.isArray(share.appDownload) ? share.appDownload as Record<string, unknown> : null;
  const channels = Array.isArray(share?.channels) ? share.channels : [];
  if (!share || !download || !Number.isSafeInteger(Number(root.version)) || !Array.isArray(channels)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  return {
    version: Number(root.version),
    baseUrl: typeof share.baseUrl === "string" ? share.baseUrl : "",
    channels: channels.map((rawChannel) => {
      if (!rawChannel || typeof rawChannel !== "object" || Array.isArray(rawChannel)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
      const channel = rawChannel as Record<string, unknown>;
      if (typeof channel.key !== "string" || typeof channel.intentType !== "string" || typeof channel.enabled !== "boolean") throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
      return channel as unknown as ExperienceChannel;
    }),
    appDownload: {
      officialUrl: String(download.officialUrl ?? ""), iosUrl: String(download.iosUrl ?? ""), androidUrl: String(download.androidUrl ?? ""), apkUrl: String(download.apkUrl ?? ""), version: String(download.version ?? ""),
      releaseNotes: download.releaseNotes && typeof download.releaseNotes === "object" ? download.releaseNotes as { zh: string; en: string } : { zh: "", en: "" },
      source: String(download.source ?? "unavailable") as ExperienceSource,
    },
    homeNewcomerTasksEnabled: typeof root.homeNewcomerTasksEnabled === "boolean" ? root.homeNewcomerTasksEnabled : undefined,
    homeWeeklyPromoEnabled: typeof root.homeWeeklyPromoEnabled === "boolean" ? root.homeWeeklyPromoEnabled : undefined,
    ready: Boolean(root.ready), sources: Array.isArray(root.sources) ? root.sources.map(String) : [], updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : undefined,
  };
}

export async function fetchPlatformExperienceConfig() {
  return normalize(await request<unknown>());
}

export async function updatePlatformExperienceConfig(
  config: PlatformExperienceConfig,
  reason: string,
  operator = "",
) {
  if (!Number.isSafeInteger(config.version) || reason.trim().length < 8) throw new Error("A3_REASON_LENGTH_INVALID");
  const body: Record<string, unknown> = { expectedVersion: config.version, baseUrl: config.baseUrl, channels: config.channels, appDownload: config.appDownload, reason: reason.trim(), operator };
  // Older backend snapshots omit H3 projections; do not send unknown fields to them.
  if (config.homeNewcomerTasksEnabled !== undefined) body.homeNewcomerTasksEnabled = config.homeNewcomerTasksEnabled;
  if (config.homeWeeklyPromoEnabled !== undefined) body.homeWeeklyPromoEnabled = config.homeWeeklyPromoEnabled;
  const slot = "platform-experience:update";
  const fingerprint = JSON.stringify(body);
  const idempotencyKey = commandAttempts.resolve(slot, fingerprint, () => `a3-experience-${crypto.randomUUID()}`);
  try {
    const response = await request<unknown>({
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    commandAttempts.forget(slot);
    return normalize(response);
  } catch (cause) {
    if (cause instanceof PlatformExperienceRequestError && !outcomeStaysUnknown(cause.status, cause.apiCode)) {
      commandAttempts.forget(slot);
    }
    // Keep the key on an uncertain result; editing the form/version makes a new fingerprint.
    throw cause;
  }
}
