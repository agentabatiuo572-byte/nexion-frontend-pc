import { guardedFetch, formatAdminApiError } from "./error-messages";

export interface PhoneRule {
  id: string; platform: "android" | "ios"; model: string; soc: string; gpu: string;
  minMemoryGb: number; maxMemoryGb: number; computeValue: number; evidence: string;
}
export interface PhonePolicy { version: number; effectiveAt: number; thresholds: number[]; rules: PhoneRule[] }
export interface PhonePolicyProposal { expectedRevision: number; effectiveAt: number; thresholds: number[]; rules: PhoneRule[] }
export interface PhoneHardware { platform: string; model: string; soc: string; gpu: string; memoryGb: number }
export interface PhoneCalibrationOverview {
  policy: { revision: number; current: PhonePolicy | null; scheduled: PhonePolicy | null };
  pendingHardware: Array<PhoneHardware & { count: number }>;
  computeUnit: "platform";
}
export interface PhonePreview {
  match: { status: string; ruleId: string | null; computeValue: number | null; tier: number | null; ruleVersion: number };
  impact: { matched: number; changed: number; pending: number; appliesTo: "NEXT_CALIBRATION"; historicalSettlementChanged: false };
  expectedRevision: number;
}
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const nonnegative = (n: unknown): n is number => finite(n) && n >= 0;
const object = (n: unknown): n is Record<string, unknown> => !!n && typeof n === "object" && !Array.isArray(n);
function invalid(): never { throw new Error("手机校准配置响应异常，请刷新后重试。"); }

export function phoneProposalError(proposal: PhonePolicyProposal): string | null {
  if (!Number.isSafeInteger(proposal.expectedRevision) || proposal.expectedRevision < 0
      || !Number.isSafeInteger(proposal.effectiveAt) || proposal.effectiveAt < 0) return "配置版本或生效时间无效。";
  if (!Array.isArray(proposal.thresholds) || proposal.thresholds.length !== 4
      || proposal.thresholds.some((value,index) => !finite(value) || value <= 0 || (index > 0 && value <= proposal.thresholds[index-1]))) {
    return "四个档位分界必须为严格递增的正数。";
  }
  if (!Array.isArray(proposal.rules) || proposal.rules.length > 500) return "最多维护 500 条手机规则。";
  const ids = new Set<string>();
  for (const rule of proposal.rules) {
    if (!object(rule) || typeof rule.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(rule.id) || ids.has(rule.id)) return "规则编号须唯一，只支持字母、数字、短横线和下划线。";
    ids.add(rule.id);
    if (!["android","ios"].includes(rule.platform) || typeof rule.model !== "string" || rule.model.length > 128
        || typeof rule.soc !== "string" || !rule.soc.trim() || rule.soc.length > 128
        || typeof rule.gpu !== "string" || !rule.gpu.trim() || rule.gpu.length > 256
        || typeof rule.evidence !== "string" || !rule.evidence.trim() || rule.evidence.length > 500) return "请完整填写平台、SoC、GPU 和核验依据（最多 500 字）。";
    if (!finite(rule.minMemoryGb) || !finite(rule.maxMemoryGb) || rule.minMemoryGb <= 0 || rule.maxMemoryGb <= rule.minMemoryGb
        || rule.maxMemoryGb > 129 || !finite(rule.computeValue) || rule.computeValue <= 0 || rule.computeValue > 1_000_000) return "内存范围或平台算力值无效。";
  }
  return null;
}
function policy(value: unknown): PhonePolicy | null {
  if (value === null) return null;
  if (!object(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 1) return invalid();
  const result = value as unknown as PhonePolicy;
  if (phoneProposalError({ ...result, expectedRevision: result.version })) return invalid();
  return result;
}
export function parsePhoneCalibrationOverview(value: unknown): PhoneCalibrationOverview {
  if (!object(value) || value.computeUnit !== "platform" || !object(value.policy)
      || !Number.isSafeInteger(value.policy.revision) || Number(value.policy.revision) < 0
      || !Array.isArray(value.pendingHardware)) return invalid();
  const current = policy(value.policy.current), scheduled = policy(value.policy.scheduled);
  if ([current,scheduled].some(entry => entry && entry.version > Number((value.policy as Record<string,unknown>).revision))) return invalid();
  if (value.pendingHardware.some(sample => !object(sample) || !Number.isSafeInteger(sample.count) || Number(sample.count) < 1)) return invalid();
  return { policy: { revision: Number(value.policy.revision), current, scheduled },
    pendingHardware: value.pendingHardware as PhoneCalibrationOverview["pendingHardware"], computeUnit: "platform" };
}
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await guardedFetch(`/api/admin/config/phone-calibration${path}`, {
    method: body === undefined ? "GET" : "POST", cache: "no-store",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope || envelope.code !== 0) throw new Error(formatAdminApiError(envelope?.message,"手机校准配置读取失败"));
  return envelope.data;
}
export async function fetchPhoneCalibration(): Promise<PhoneCalibrationOverview> {
  return parsePhoneCalibrationOverview(await request(""));
}
export async function previewPhoneCalibration(proposal: PhonePolicyProposal, hardware: PhoneHardware): Promise<PhonePreview> {
  const error = phoneProposalError(proposal);
  if (error) throw new Error(error);
  const value = await request("/preview", { proposal, hardware });
  if (!object(value) || !object(value.match) || !object(value.impact) || value.expectedRevision !== proposal.expectedRevision
      || value.impact.appliesTo !== "NEXT_CALIBRATION" || value.impact.historicalSettlementChanged !== false
      || ![value.impact.matched,value.impact.changed,value.impact.pending].every(nonnegative)
      || typeof value.match.status !== "string") return invalid();
  return value as unknown as PhonePreview;
}
