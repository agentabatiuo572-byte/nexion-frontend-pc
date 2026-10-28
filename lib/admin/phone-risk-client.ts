import { guardedFetch, formatAdminApiError } from "./error-messages";

/** Model consistency checks run before a phone calibration draws a value. Saved directly, not through A2. */
export type PhoneRiskMode = "OFF" | "OBSERVE" | "ENFORCE";
export type PhoneRiskCheck = "installModelLock" | "osVersion" | "screenScale" | "screenSize" | "missingSignals" | "accountModelChurn";
export interface PhoneRiskSettings {
  revision: number; installModelLock: PhoneRiskMode; osVersion: PhoneRiskMode; screenScale: PhoneRiskMode; screenSize: PhoneRiskMode;
  missingSignals: PhoneRiskMode; accountModelChurn: PhoneRiskMode; churnWindowDays: number; churnModelCount: number;
  updatedAt: number | null; updatedBy: number | null; reason: string | null;
}
export interface PhoneRiskStats {
  days: number;
  checks: Array<{ code: string; flagged: number; held: number; accounts: number }>;
  models: Array<{ code: string; platform: string | null; model: string | null; flagged: number; held: number }>;
}
export interface PhoneRiskOverview { settings: PhoneRiskSettings; stats: PhoneRiskStats }
export type PhoneRiskUpdate = Omit<PhoneRiskSettings, "revision" | "updatedAt" | "updatedBy" | "reason"> & { reason: string };

export const RISK_MODE_LABELS: Record<PhoneRiskMode, string> = { OFF: "关闭", OBSERVE: "观察", ENFORCE: "拦截" };
/** Each check, its finding code and the modes it allows; display size and account churn are never enforced. */
export const RISK_CHECKS: Array<{ key: PhoneRiskCheck; code: string; label: string; detail: string; modes: PhoneRiskMode[] }> = [
  { key: "installModelLock", code: "MODEL_CHANGED", label: "同一手机换报机型", modes: ["OFF", "OBSERVE", "ENFORCE"],
    detail: "一台手机第一次校准后锁定机型，之后换报其他机型即命中。iPhone 和 Android 都检查。" },
  { key: "osVersion", code: "OS_MISMATCH", label: "系统版本与机型不符", modes: ["OFF", "OBSERVE", "ENFORCE"],
    detail: "iPhone 的系统版本早于出厂版本，或高于该机型能升级的最高版本。机型没有填系统版本时不检查。" },
  { key: "screenScale", code: "SCALE_MISMATCH", label: "屏幕倍率与机型不符", modes: ["OFF", "OBSERVE", "ENFORCE"],
    detail: "iPhone 的屏幕倍率不是该机型的倍率。机型没有填倍率时不检查。" },
  { key: "screenSize", code: "SCREEN_MISMATCH", label: "屏幕尺寸与机型不符", modes: ["OFF", "OBSERVE"],
    detail: "放大显示和辅助功能会改变尺寸，所以只观察，不拦截。" },
  { key: "missingSignals", code: "SIGNALS_MISSING", label: "缺少系统或屏幕信息", modes: ["OFF", "OBSERVE", "ENFORCE"],
    detail: "旧版 App 不上报这些信息。新版 App 普及前请保持观察，否则旧版用户都会被拦下。" },
  { key: "accountModelChurn", code: "ACCOUNT_MODEL_CHURN", label: "同一账号报多个机型", modes: ["OFF", "OBSERVE"],
    detail: "统计窗口内报过的不同机型达到上限即命中。iPhone 和 Android 都检查，只观察，不拦截。" },
];
export const RISK_CODE_LABELS: Record<string, string> = Object.fromEntries(RISK_CHECKS.map(check => [check.code, check.label]));

const MODES = new Set<PhoneRiskMode>(["OFF", "OBSERVE", "ENFORCE"]);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function invalid(): never { throw new Error("机型风控设置响应异常，请刷新后重试。"); }

export function riskSettingsError(update: PhoneRiskUpdate): string | null {
  for (const check of RISK_CHECKS) if (!check.modes.includes(update[check.key])) return `「${check.label}」不能设为${RISK_MODE_LABELS[update[check.key]] ?? "该模式"}。`;
  if (!Number.isInteger(update.churnWindowDays) || update.churnWindowDays < 1 || update.churnWindowDays > 365) return "统计窗口为 1 到 365 天。";
  if (!Number.isInteger(update.churnModelCount) || update.churnModelCount < 2 || update.churnModelCount > 20) return "机型数上限为 2 到 20 个。";
  const reason = update.reason.trim();
  if (reason.length < 8 || reason.length > 200) return "请填写 8 到 200 字的修改理由。";
  return null;
}

export function parsePhoneRiskOverview(value: unknown): PhoneRiskOverview {
  if (!object(value) || !object(value.settings) || !object(value.stats)) return invalid();
  const settings = value.settings, stats = value.stats;
  if (!count(settings.revision) || RISK_CHECKS.some(check => !MODES.has(settings[check.key] as PhoneRiskMode))
      || !Number.isInteger(settings.churnWindowDays) || !Number.isInteger(settings.churnModelCount)) return invalid();
  if (!count(stats.days) || !Array.isArray(stats.checks) || !Array.isArray(stats.models)
      || stats.checks.some(row => !object(row) || typeof row.code !== "string" || ![row.flagged, row.held, row.accounts].every(count))
      || stats.models.some(row => !object(row) || typeof row.code !== "string" || ![row.flagged, row.held].every(count))) return invalid();
  return { settings: settings as unknown as PhoneRiskSettings, stats: stats as unknown as PhoneRiskStats };
}

async function request(method: "GET" | "PUT", body?: unknown, key?: string): Promise<unknown> {
  const response = await guardedFetch("/api/admin/config/phone-calibration/risk", {
    method, cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json", "Idempotency-Key": key ?? "" }, body: JSON.stringify(body) }),
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope || envelope.code !== 0) throw new Error(formatAdminApiError(envelope?.message, "机型风控设置读取失败"));
  return envelope.data;
}
export async function fetchPhoneRisk(): Promise<PhoneRiskOverview> {
  return parsePhoneRiskOverview(await request("GET"));
}
/** Takes effect immediately; the revision rejects a save based on settings someone else changed meanwhile. */
export async function savePhoneRisk(expectedRevision: number, update: PhoneRiskUpdate, key: string): Promise<PhoneRiskOverview> {
  const error = riskSettingsError(update);
  if (error) throw new Error(error);
  return parsePhoneRiskOverview(await request("PUT", { ...update, reason: update.reason.trim(), expectedRevision, confirmed: true }, key));
}
