import { guardedFetch, formatAdminApiError } from "./error-messages";
import { iosRuleIssues, isIosModelRule, normalizeIosRule, type IosModelPresetCatalog, type IosModelRule } from "./ios-model-rules";
import { androidRuleIssues, isAndroidSocRule, normalizeAndroidRule, normalizeRemovals,
  type AndroidPresetRemovals, type AndroidSocRule } from "./android-soc-rules";

export interface PhonePolicy { version: number; effectiveAt: number; thresholds: number[]; androidSocRules: AndroidSocRule[];
  iosModelRules: IosModelRule[]; androidPresetRemovals: AndroidPresetRemovals }
/** One proposal publishes the Android chip tiers, the iPhone rules and the thresholds together. */
export interface PhonePolicyProposal { expectedRevision: number; effectiveAt: number; thresholds: number[];
  androidSocRules: AndroidSocRule[]; iosModelRules: IosModelRule[]; androidPresetRemovals: AndroidPresetRemovals }
/** The latest published rules the server attaches to an A2 ticket so reviewers see the real before/after. */
export interface PhonePolicyBaseline { revision: number; androidSocRules: AndroidSocRule[]; iosModelRules: IosModelRule[] }
/** iosRulesInherited: an older client sent no iosModelRules, so the server keeps the published ones. */
export type PhoneProposalView = PhonePolicyProposal & { baseline: PhonePolicyBaseline | null; iosRulesInherited: boolean };
/** socIds: every chip identifier an Android phone reported; an iPhone reports only its model. */
export interface PhoneHardware { platform: string; model: string; socIds: string[] }
/** Optional iPhone facts a trial can add to see which model checks would fire. */
export interface PhoneTrialFacts { osVersion: string | null; pixelRatio: number | null; screenWidth: number | null; screenHeight: number | null }
export interface PhoneCalibrationOverview {
  policy: { revision: number; current: PhonePolicy | null; scheduled: PhonePolicy | null };
  /** reason: why these calibrations wait, for example an unknown model or a model risk check. */
  pendingHardware: Array<{ platform: string | null; model: string | null; socIds: string[]; reason: string | null; count: number }>;
  computeUnit: "platform";
}
export interface PhonePreview {
  match: { status: string; ruleId: string | null; computeValue: number | null; tier: number | null; ruleVersion: number;
    method?: "IOS_MODEL_RANGE" | "ANDROID_SOC_RANGE" | null; model?: string | null; socKey?: string | null;
    minComputeValue?: number | null; maxComputeValue?: number | null };
  possibleTiers: number[];
  /** Per-report model checks for an iPhone trial with OS and screen facts; empty otherwise. */
  risk: Array<{ code: string; mode: "OBSERVE" | "ENFORCE" }>;
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
  if (!Array.isArray(proposal.androidSocRules) || !proposal.androidSocRules.every(isAndroidSocRule)) return "Android 芯片档格式无效。";
  if (!Array.isArray(proposal.iosModelRules) || !proposal.iosModelRules.every(isIosModelRule)) return "iPhone 机型规则格式无效。";
  const android = androidRuleIssues(proposal.androidSocRules, proposal.iosModelRules.map(rule => rule.id))[0];
  if (android) return android.index < 0 ? android.message : `Android 芯片档 ${android.index + 1}（${proposal.androidSocRules[android.index].name || "未填写"}）：${android.message}`;
  const issue = iosRuleIssues(proposal.iosModelRules, proposal.androidSocRules.map(rule => rule.id))[0];
  if (issue) return issue.index < 0 ? issue.message : `iPhone 机型 ${issue.index + 1}（${proposal.iosModelRules[issue.index].model || "未填写"}）：${issue.message}`;
  return null;
}
/** Missing rule lists read as empty; anything present must have the exact shape. */
function withRules<T extends Record<string, unknown>>(value: T): T & { iosModelRules: IosModelRule[]; androidSocRules: AndroidSocRule[];
  androidPresetRemovals: AndroidPresetRemovals } {
  const ios = value.iosModelRules === undefined || value.iosModelRules === null ? [] : value.iosModelRules;
  const android = value.androidSocRules === undefined || value.androidSocRules === null ? [] : value.androidSocRules;
  if (!Array.isArray(ios) || !ios.every(isIosModelRule) || !Array.isArray(android) || !android.every(isAndroidSocRule)) return invalid();
  return { ...value, iosModelRules: ios.map(normalizeIosRule), androidSocRules: android.map(normalizeAndroidRule),
    androidPresetRemovals: normalizeRemovals(value.androidPresetRemovals) };
}
/** A2 ticket payload: the proposal plus the server's baseline, both checked like a live read. */
export function parsePhoneProposalView(value: unknown): PhoneProposalView {
  if (!object(value)) return invalid();
  const proposal = withRules(value) as unknown as PhoneProposalView;
  if (phoneProposalError(proposal)) return invalid();
  const raw = value.baseline;
  let baseline: PhonePolicyBaseline | null = null;
  if (raw !== null && raw !== undefined) {
    if (!object(raw) || !Number.isSafeInteger(raw.revision)) return invalid();
    baseline = withRules(raw) as unknown as PhonePolicyBaseline;
  }
  return { ...proposal, baseline, iosRulesInherited: value.iosModelRules === undefined || value.iosModelRules === null };
}
function policy(value: unknown): PhonePolicy | null {
  if (value === null) return null;
  if (!object(value) || !Number.isSafeInteger(value.version) || Number(value.version) < 1) return invalid();
  const result = withRules(value) as unknown as PhonePolicy;
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
  // The server groups by the identifiers' JSON text, so they arrive as a string.
  const ids = (raw: unknown): string[] => {
    try {
      const list = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(list) ? list.filter((id): id is string => typeof id === "string") : [];
    } catch { return []; }
  };
  const pendingHardware = (value.pendingHardware as Record<string, unknown>[]).map(sample => ({
    platform: typeof sample.platform === "string" ? sample.platform : null, model: typeof sample.model === "string" ? sample.model : null,
    socIds: ids(sample.socIds), reason: typeof sample.reason === "string" ? sample.reason : null, count: Number(sample.count) }));
  return { policy: { revision: Number(value.policy.revision), current, scheduled }, pendingHardware, computeUnit: "platform" };
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
export async function previewPhoneCalibration(proposal: PhonePolicyProposal, hardware: PhoneHardware,
                                              facts: PhoneTrialFacts | null = null): Promise<PhonePreview> {
  const error = phoneProposalError(proposal);
  if (error) throw new Error(error);
  const value = await request("/preview", { proposal, hardware, ...(facts ? { facts: { platform: hardware.platform, ...facts } } : {}) });
  if (!object(value) || !object(value.match) || !object(value.impact) || value.expectedRevision !== proposal.expectedRevision
      || value.impact.appliesTo !== "NEXT_CALIBRATION" || value.impact.historicalSettlementChanged !== false
      || ![value.impact.matched,value.impact.changed,value.impact.pending].every(nonnegative)
      || typeof value.match.status !== "string"
      || !Array.isArray(value.possibleTiers) || !value.possibleTiers.every(tier => Number.isInteger(tier) && tier >= 1 && tier <= 5)) return invalid();
  const risk = value.risk === undefined ? [] : value.risk;
  if (!Array.isArray(risk) || !risk.every(entry => object(entry) && typeof entry.code === "string"
      && (entry.mode === "OBSERVE" || entry.mode === "ENFORCE"))) return invalid();
  return { ...(value as unknown as PhonePreview), risk: risk as PhonePreview["risk"] };
}
/** The versioned preset catalog shipped with the backend; loading it only fills the E6 draft. */
export async function fetchIosModelPresets(): Promise<IosModelPresetCatalog> {
  const value = await request("/ios-model-presets");
  if (!object(value) || typeof value.catalogVersion !== "string" || typeof value.verifiedOn !== "string"
      || !Array.isArray(value.sources) || typeof value.notice !== "string"
      || !Array.isArray(value.models) || !value.models.every(isIosModelRule)) return invalid();
  return { ...(value as unknown as IosModelPresetCatalog), models: (value.models as IosModelRule[]).map(normalizeIosRule) };
}
