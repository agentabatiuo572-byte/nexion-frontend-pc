import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { isIdempotencyOutcomeOpen, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";

import { fillBlankContentLanguage } from "./content-language-rules";

export type ExperienceSource = "official" | "unavailable";
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
// Contract order. Only English is a base language and is always on.
export const INTERFACE_LANGUAGES = [
  { code: "zh", nativeName: "中文", zhName: "中文", base: false },
  { code: "en", nativeName: "English", zhName: "英语", base: true },
  { code: "vi", nativeName: "Tiếng Việt", zhName: "越南语", base: false },
  { code: "id", nativeName: "Bahasa Indonesia", zhName: "印尼语", base: false },
  { code: "ms", nativeName: "Bahasa Melayu", zhName: "马来语", base: false },
  { code: "fil", nativeName: "Filipino", zhName: "菲律宾语", base: false },
  { code: "ru", nativeName: "Русский", zhName: "俄语", base: false },
  { code: "kk", nativeName: "Қазақ тілі", zhName: "哈萨克语", base: false },
  { code: "uz", nativeName: "Oʻzbekcha", zhName: "乌兹别克语", base: false },
] as const;
export type InterfaceLanguageCode = typeof INTERFACE_LANGUAGES[number]["code"];
export const OPERATING_LANGUAGE_CODES = ["en", "zh", "vi"] as const;
export type OperatingLanguageCode = typeof OPERATING_LANGUAGE_CODES[number];

export interface PlatformExperienceConfig {
  version: number;
  baseUrl: string;
  channels: ExperienceChannel[];
  appDownload: ExperienceDownload;
  homeNewcomerTasksEnabled: boolean;
  homeWeeklyPromoEnabled: boolean;
  /** Omitted on older systems. Null means the stored list is invalid and must be selected again. */
  interfaceLanguages?: InterfaceLanguageCode[] | null;
  operatingLanguages?: OperatingLanguageCode[] | null;
  ready: boolean;
  sources: string[];
  updatedAt?: string;
}

export function recommendedExperienceChannels(): ExperienceChannel[] {
  const textTemplate = "Join UVEL with my invitation: {link}";
  return [
    { key: "zalo", intentType: "scheme", textTemplate, androidPackage: "com.zing.zalo", iosScheme: "zalo://", enabled: true },
    { key: "telegram", intentType: "web", textTemplate, urlTemplate: "https://t.me/share/url?url={link}&text={text}", enabled: true },
    { key: "whatsapp", intentType: "web", textTemplate, urlTemplate: "https://wa.me/?text={text}", enabled: true },
    { key: "messenger", intentType: "scheme", textTemplate, androidPackage: "com.facebook.orca", iosScheme: "fb-messenger://", enabled: true },
    { key: "sms", intentType: "web", textTemplate, urlTemplate: "sms:?body={text}", enabled: true },
    { key: "x", intentType: "web", textTemplate, urlTemplate: "https://twitter.com/intent/tweet?text={text}", enabled: true },
    { key: "copy", intentType: "copy", enabled: true },
    { key: "poster", intentType: "poster", enabled: true },
    { key: "system", intentType: "system", enabled: true },
  ];
}

interface ApiResult<T> { code: number; message?: string; data?: T; }
const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-platform-experience-commands-v1" });

function strictUrl(value: unknown, required: boolean, allowHttp: boolean, allowFragment = false): string {
  const url = typeof value === "string" ? value.trim() : "";
  if (!url && !required) return "";
  if (!url || /[\s@]/.test(url) || (!allowFragment && url.includes("#"))) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  try {
    const parsed = new URL(url);
    const protocols = allowHttp ? ["https:", "http:"] : ["https:"];
    if (!protocols.includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) throw new Error();
  } catch {
    throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  }
  return url;
}

function optionalChannelText(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  return value;
}

function strictInterfaceLanguages(value: unknown, errorCode = "PLATFORM_EXPERIENCE_RESPONSE_INVALID"): InterfaceLanguageCode[] {
  const known: readonly string[] = INTERFACE_LANGUAGES.map((language) => language.code);
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((code) => !known.includes(code))
    || INTERFACE_LANGUAGES.some((language) => language.base && !value.includes(language.code))) throw new Error(errorCode);
  return INTERFACE_LANGUAGES.map((language) => language.code).filter((code) => value.includes(code));
}

export function isOperatingLanguageList(value: unknown): value is OperatingLanguageCode[] {
  return Array.isArray(value) && new Set(value).size === value.length && value.includes("en")
    && value.every((code) => OPERATING_LANGUAGE_CODES.includes(code));
}

function strictOperatingLanguages(value: unknown, errorCode = "PLATFORM_EXPERIENCE_RESPONSE_INVALID"): OperatingLanguageCode[] {
  if (!isOperatingLanguageList(value)) throw new Error(errorCode);
  const ordered = OPERATING_LANGUAGE_CODES.filter((code) => value.includes(code));
  if (ordered.some((code, index) => code !== value[index])) throw new Error(errorCode);
  return ordered;
}

export function changedOperatingLanguages(
  value: PlatformExperienceConfig["operatingLanguages"],
  baseline: readonly OperatingLanguageCode[] | null | undefined,
): OperatingLanguageCode[] | undefined {
  if (!value || baseline === undefined) return undefined;
  return baseline && value.length === baseline.length && baseline.every((code) => value.includes(code)) ? undefined : value;
}

class PlatformExperienceRequestError extends Error {
  constructor(public readonly status: number, public readonly apiCode: number | undefined, message: string, public readonly apiMessage?: string) {
    super(message);
    this.name = "PlatformExperienceRequestError";
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !body || body.code !== 0) {
    const message = body?.message === "PLATFORM_EXPERIENCE_VERSION_CONFLICT"
      ? "PLATFORM_EXPERIENCE_VERSION_CONFLICT"
      : formatAdminApiError(body?.message, `PLATFORM_EXPERIENCE_REQUEST_FAILED_${response.status}`);
    throw new PlatformExperienceRequestError(response.status, body?.code, message, body?.message);
  }
  return body.data as T;
}

async function request<T>(init?: RequestInit): Promise<T> {
  const response = await guardedFetch("/api/admin/platform/config/experience", { ...init, cache: "no-store" });
  return parseResponse<T>(response);
}

function normalize(raw: unknown): PlatformExperienceConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  const root = raw as Record<string, unknown>;
  const share = root.share && typeof root.share === "object" && !Array.isArray(root.share) ? root.share as Record<string, unknown> : null;
  const download = share?.appDownload && typeof share.appDownload === "object" && !Array.isArray(share.appDownload) ? share.appDownload as Record<string, unknown> : null;
  const channels = Array.isArray(share?.channels) ? share.channels : [];
  if (!share || !download || (typeof root.version !== "number" || !Number.isSafeInteger(root.version) || root.version < 0) || !Array.isArray(channels)
    || typeof root.homeNewcomerTasksEnabled !== "boolean"
    || typeof root.homeWeeklyPromoEnabled !== "boolean") throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  const source = String(download.source ?? "unavailable").trim() as ExperienceSource;
  if (!["official", "unavailable"].includes(source)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  const releaseNotes = download.releaseNotes && typeof download.releaseNotes === "object"
    ? download.releaseNotes as { zh?: unknown; en?: unknown }
    : null;
  const notes = { zh: String(releaseNotes?.zh ?? ""), en: String(releaseNotes?.en ?? "") };
  const version = String(download.version ?? "").trim();
  if (source !== "unavailable" && (!version || !notes.en.trim())) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  if (source === "unavailable" && [download.officialUrl, download.iosUrl, download.androidUrl, download.apkUrl, version, notes.zh, notes.en]
    .some((value) => String(value ?? "").trim())) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  return {
    version: Number(root.version),
    baseUrl: strictUrl(share.baseUrl, false, false),
    channels: channels.map((rawChannel) => {
      if (!rawChannel || typeof rawChannel !== "object" || Array.isArray(rawChannel)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
      const channel = rawChannel as Record<string, unknown>;
      if (typeof channel.key !== "string" || typeof channel.intentType !== "string" || typeof channel.enabled !== "boolean") throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
      return {
        key: channel.key,
        intentType: channel.intentType,
        textTemplate: optionalChannelText(channel.textTemplate),
        urlTemplate: optionalChannelText(channel.urlTemplate),
        androidPackage: optionalChannelText(channel.androidPackage),
        iosScheme: optionalChannelText(channel.iosScheme),
        enabled: channel.enabled,
      };
    }),
    appDownload: {
      officialUrl: strictUrl(download.officialUrl, source !== "unavailable", false, true),
      iosUrl: strictUrl(download.iosUrl, false, false),
      androidUrl: strictUrl(download.androidUrl, false, false),
      apkUrl: strictUrl(download.apkUrl, false, false),
      version,
      releaseNotes: notes,
      source,
    },
    homeNewcomerTasksEnabled: root.homeNewcomerTasksEnabled,
    homeWeeklyPromoEnabled: root.homeWeeklyPromoEnabled,
    interfaceLanguages: root.interfaceLanguages == null ? root.interfaceLanguages : strictInterfaceLanguages(root.interfaceLanguages),
    operatingLanguages: root.operatingLanguages == null ? root.operatingLanguages : strictOperatingLanguages(root.operatingLanguages),
    ready: Boolean(root.ready), sources: Array.isArray(root.sources) ? root.sources.map(String) : [], updatedAt: typeof root.updatedAt === "string" ? root.updatedAt : undefined,
  };
}

export async function fetchPlatformExperienceConfig() {
  return normalize(await request<unknown>());
}

export async function fetchOperatingLanguages(): Promise<OperatingLanguageCode[]> {
  const response = await guardedFetch("/api/admin/platform/config/operating-languages", { cache: "no-store" });
  const raw = await parseResponse<unknown>(response);
  if (!raw || typeof raw !== "object" || !("operatingLanguages" in raw)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
  return strictOperatingLanguages(raw.operatingLanguages);
}

export function getRequiredContentLanguages(): Promise<readonly OperatingLanguageCode[]> {
  return fetchOperatingLanguages().catch(() => OPERATING_LANGUAGE_CODES);
}

export async function platformExperienceBody(
  config: PlatformExperienceConfig, reason: string, operator = "", operatingLanguages?: readonly OperatingLanguageCode[],
) {
  if (!Number.isSafeInteger(config.version) || reason.trim().length < 8 || reason.trim().length > 200) throw new Error("A3_REASON_LENGTH_INVALID");
  if (config.interfaceLanguages === null) throw new Error("PLATFORM_EXPERIENCE_LANGUAGES_INVALID");
  if (config.operatingLanguages === null && operatingLanguages === undefined) throw new Error("PLATFORM_OPERATING_LANGUAGES_INVALID");
  let appDownload = config.appDownload;
  if (appDownload.source === "official") {
    for (const [field, label] of [["officialUrl", "官方安装链接"], ["iosUrl", "iOS 官方下载链接"], ["androidUrl", "Android 官方下载链接"], ["apkUrl", "APK 下载链接"]] as const) {
      try { strictUrl(config.appDownload[field], field === "officialUrl", false, field === "officialUrl"); }
      catch { throw new Error(`${label}需填写有效的 HTTPS 地址，不能包含空格或账号密码${field === "officialUrl" ? "，支持 #download 等页面锚点" : "或页面锚点"}。`); }
    }
    const required = operatingLanguages ?? await getRequiredContentLanguages();
    const { en, zh } = appDownload.releaseNotes;
    const releaseNotes = { en, zh: fillBlankContentLanguage(required, "zh", { text: en }, { text: zh }).text };
    if (!appDownload.version.trim() || !releaseNotes.zh.trim() || !releaseNotes.en.trim()) {
      throw new Error("PLATFORM_EXPERIENCE_RELEASE_METADATA_REQUIRED");
    }
    appDownload = { ...appDownload, releaseNotes };
  } else if (appDownload.source !== "unavailable") {
    throw new Error("PLATFORM_EXPERIENCE_SOURCE_INVALID");
  }
  return {
    expectedVersion: config.version, baseUrl: config.baseUrl, channels: config.channels,
    appDownload, reason: reason.trim(), operator,
    ...(config.interfaceLanguages === undefined ? {} : {
      interfaceLanguages: strictInterfaceLanguages(config.interfaceLanguages, "PLATFORM_EXPERIENCE_LANGUAGES_INVALID"),
    }),
    ...(operatingLanguages === undefined ? {} : {
      operatingLanguages: strictOperatingLanguages(operatingLanguages, "PLATFORM_OPERATING_LANGUAGES_INVALID"),
    }),
  };
}

export async function updatePlatformExperienceConfig(
  config: PlatformExperienceConfig, reason: string, operator = "", operatingLanguages?: readonly OperatingLanguageCode[],
) {
  const body = await platformExperienceBody(config, reason, operator, operatingLanguages);
  const slot = "platform-experience:update";
  const fingerprint = JSON.stringify(body);
  const idempotencyKey = commandAttempts.resolve(slot, fingerprint, () => `a3-experience-${crypto.randomUUID()}`);
  try {
    const response = await request<unknown>({
      method: "PUT",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const saved = normalize(response);
    if (body.interfaceLanguages && saved.interfaceLanguages?.join() !== body.interfaceLanguages.join()) {
      throw new Error("PLATFORM_EXPERIENCE_LANGUAGES_NOT_SAVED");
    }
    if (body.operatingLanguages && saved.operatingLanguages?.join() !== body.operatingLanguages.join()) {
      throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
    }
    if (body.appDownload.source === "official" && (saved.appDownload.releaseNotes.en !== body.appDownload.releaseNotes.en
      || saved.appDownload.releaseNotes.zh !== body.appDownload.releaseNotes.zh)) throw new Error("PLATFORM_EXPERIENCE_RESPONSE_INVALID");
    commandAttempts.forget(slot);
    return saved;
  } catch (cause) {
    if (cause instanceof PlatformExperienceRequestError && !isIdempotencyOutcomeOpen(cause.apiMessage) && !outcomeStaysUnknown(cause.status, cause.apiCode)) {
      commandAttempts.forget(slot);
    }
    // Keep the key on an uncertain result; editing the form/version makes a new fingerprint.
    throw cause;
  }
}

export { normalize as parsePlatformExperienceConfig };
