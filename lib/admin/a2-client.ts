import { ADMIN_ERROR_MESSAGES, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { auditActionFieldLabel } from "./audit-action-names";
import { isFirstA2DisclosurePublish } from "./disclosure-publication-diagnostic";
import { H2_BUY_LIST_ACTION } from "./h2-trial-purchase";
import { isIdempotencyOutcomeOpen, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { monthlyTargetPoolErrorText } from "@/lib/admin/monthly-target-pool-error";
import type { F4AmbassadorMaterialProposal } from "@/lib/admin/f1-client";
import { ambassadorApprovalBlocker } from "@/lib/admin/f4-ambassador-display";
import { f4Decimal } from "@/lib/admin/f4-money";
import { rankPurchaseRate } from "@/lib/admin/f-overview-contract";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import { parsePhoneProposalView, type PhoneProposalView } from "@/lib/admin/phone-calibration-client";
import { readE4Money } from "./e4-refund-amount";
import { readWithdrawalProposalChanges, type WithdrawalProposalChanges } from "./withdrawal-proposal-changes";
import { fetchA7MenusOverview, type A7MenuTreeNode } from "@/lib/admin/a7-client";
import { fetchA8Permissions, type A8Permission } from "@/lib/admin/a8-client";
import { permLabel, menuLabel } from "@/lib/admin/rbac-labels";
import type { DisclosureVersionItemView } from "@/lib/admin/i-client";
import { INTERFACE_LANGUAGES } from "@/lib/admin/platform-experience-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  buildA2FilterQuery,
  resolveA2AuditObject,
  resolveA2AuditDomain,
  type A2AuditDomain,
  type A2AuditFilter,
} from "@/lib/admin/a2-policy";

export { isFirstA2DisclosurePublish } from "./disclosure-publication-diagnostic";
export type { A2AuditDomain, A2AuditFilter } from "@/lib/admin/a2-policy";

export type A2OperationType = "fund" | "param" | "acct" | "sos";

interface ApiResult<T> {
  code: number;
  message?: string;
  data?: T;
}

export class A2OutcomeUncertainError extends Error {
  readonly queryMessage: string;
  constructor(message: string, public readonly commandKey: string) {
    // 命令号只留在 commandKey 上，不进句子（全站-标识外露）；机器码细节换成表里的中文，表里没有就不显示；
    // 网络、服务不可用这类说明本身就在说「结果未知／未确认」，不再重复一遍。
    const raw = message.trim();
    const shown = /[一-鿿]/.test(raw) ? raw : ADMIN_ERROR_MESSAGES[raw] ?? "";
    const detail = /结果未知|未确认|是否已生效/.test(shown) ? "" : shown;
    super(`结果未知，可能已经提交。不要重新填写；查询原操作或按原操作重试，都不会重复提交。${detail ? `（${detail}）` : ""}`);
    this.queryMessage = `结果未知，可能已经提交。不要重新填写，请查询原操作。${detail ? `（${detail}）` : ""}`;
    this.name = "A2OutcomeUncertainError";
  }
}

/** 按原号查到的审批单缺字段：调用方按类型认，不比对显示文字。 */
export class A2ProposalReceiptIncompleteError extends Error {
  constructor() {
    super("提交结果不完整，请稍后再查。");
    this.name = "A2ProposalReceiptIncompleteError";
  }
}

export function isA2OutcomeUncertainError(error: unknown): error is A2OutcomeUncertainError {
  const candidate = error as (Error & { commandKey?: unknown }) | null;
  return error instanceof A2OutcomeUncertainError
    || (
      candidate instanceof Error
      && candidate.name === "A2OutcomeUncertainError"
      && typeof candidate.commandKey === "string"
      && !!candidate.commandKey.trim()
    );
}

interface BackendStats {
  pendingTickets?: number | string | null;
  fundTickets?: number | string | null;
  sosTickets?: number | string | null;
  todayAuditEvents?: number | string | null;
  weeklyApproved?: number | string | null;
  weeklyRejected?: number | string | null;
  weeklyExpired?: number | string | null;
  weeklyWithdrawn?: number | string | null;
}

type A2FundEffect = "REWARD_SUSPENSION" | "REWARD_RESUMPTION" | "ORDER_REFUND";
export type A2RuleTaskAction = "CREATE" | "UPDATE" | "ENABLE" | "DISABLE";

interface BackendTicket {
  createRequestId?: string | null;
  resultSkuId?: string | null;
  missionTarget?: unknown;
  businessResult?: unknown;
  lastApprovalAttemptResult?: unknown;
  roleGrantsDiff?: unknown;
  disclosureReview?: unknown;
  v8PromotionSnapshot?: unknown;
  ruleTaskAction?: A2RuleTaskAction | null;
  approveDeniedCode?: number | null;
  approveDeniedMessage?: string | null;
  rejectDeniedCode?: number | null;
  rejectDeniedMessage?: string | null;
  canApprove?: boolean | null;
  canReject?: boolean | null;
  ambassadorMaterialProposal?: F4AmbassadorMaterialProposal | null;
  id: string;
  action: string;
  obj: string;
  objDisplayName?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
  changes?: unknown;
  phoneCalibrationProposal?: string | null;
  coverageCheckOnApproval?: boolean | null;
  operationCode?: string | null;
  retiredOperation?: boolean | null;
  fundEffect?: A2FundEffect | null;
  refundOrderNo?: string | null;
  originalAmountUsdt?: string | null;
  refundAmountUsdt?: string | null;
  operator?: string | null;
  operatorRole?: string | null;
  type?: string | null;
  amplifies?: boolean | null;
  sos?: boolean | null;
  ts?: string | null;
  mine?: boolean | null;
  roleGate?: string | null;
  reason?: string | null;
  status?: string | null;
}

interface BackendHistory {
  ruleTaskAction?: A2RuleTaskAction | null;
  operationCode?: string | null;
  resultSkuId?: string | null;
  id: string;
  action: string;
  st: string;
  chain: string;
  t: string;
  note: string;
}

interface BackendMechanismParam {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked?: boolean | null;
}

interface BackendConfirmCategory {
  cat: string;
  examples: string;
  roleGate: string;
}

interface BackendAuditLog {
  operationCode?: string | null;
  createRequestId?: string | null;
  resultSkuId?: string | null;
  id?: number | string | null;
  traceId?: string | null;
  action?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  bizNo?: string | null;
  actorType?: string | null;
  actorUsername?: string | null;
  clientIp?: string | null;
  result?: string | null;
  riskLevel?: string | null;
  detailJson?: string | null;
  createdAt?: string | null;
  schemaVersion?: string | null;
}

interface BackendA2ReasonPolicy {
  minChars?: number | null;
  maxChars?: number | null;
  sourceKey?: string | null;
}

export interface A2ReasonPolicy {
  minChars: number;
  maxChars: number;
  sourceKey: "admin.a2.reason_min_chars";
}

interface BackendOverview {
  stats?: BackendStats | null;
  operationQueue?: BackendTicket[] | null;
  operationHistory?: BackendHistory[] | null;
  mechanismParams?: BackendMechanismParam[] | null;
  confirmCategories?: BackendConfirmCategory[] | null;
  recentLogs?: BackendAuditLog[] | null;
}

export interface A2Stats {
  pendingTickets: number;
  fundTickets: number;
  sosTickets: number;
  todayAuditEvents: number;
  weeklyApproved: number;
  weeklyRejected: number;
  weeklyExpired: number;
  weeklyWithdrawn: number;
}

export interface A2RoleGrantsDiff {
  permissionCodesAdded: string[];
  permissionCodesRemoved: string[];
  menuIdsAdded: number[];
  menuIdsRemoved: number[];
}

/** Missing means a readable catalogue has no entry; unavailable means it could not be read. */
type A2CatalogueStatus = "found" | "missing" | "unavailable";

export interface A2RoleGrantsReview {
  permissionsAdded: { code: string; name: string | null; catalogueStatus: A2CatalogueStatus }[];
  permissionsRemoved: { code: string; name: string | null; catalogueStatus: A2CatalogueStatus }[];
  menusAdded: { id: number; name: string | null; catalogueStatus: A2CatalogueStatus }[];
  menusRemoved: { id: number; name: string | null; catalogueStatus: A2CatalogueStatus }[];
}

type I5DisclosureReview = { jurisdiction: string; version: string } & (
  | {
    kind: "PUBLISH";
    draft?: DisclosureVersionItemView;
    previousVersion?: string | null;
    previousVersionSummary?: DisclosureVersionItemView | null;
    draftMatchesFrozenEvidence?: boolean | null;
  }
  | { kind: "MATRIX"; expectedVersion: string; originalCountryCodes?: string[] | null; targetCountryCodes?: string[] | null }
);

export interface V8PromotionBenefits {
  purchaseL1Rate?: string;
  purchaseL2Rate?: string;
  monthlySalaryUsdt?: string;
}

export type V8PromotionReward = OpsVRankRewardItem & { voucherName?: string; skuName?: string };

interface V8PromotionSnapshot {
  originalRank: string;
  v8Rewards?: V8PromotionReward[];
  v7?: V8PromotionBenefits;
  v8?: V8PromotionBenefits;
}

export type F4ApprovalBusinessResult =
  | { status: "EXECUTED"; creditedCount: number; amountsByCurrency: Record<string, string>; settlementKey: string }
  | { status: "NOT_EXECUTED"; reasonCode: string; settlementKey: string };

export type F4ApprovalAttemptResult = {
  status: "NOT_EXECUTED";
  reasonCode: "F4_LEADERBOARD_PAUSED" | "COVERAGE_BELOW_REDLINE";
  attemptedAt: string;
};

export class F4ApprovalBlockedError extends Error {
  constructor(message: string, readonly result: F4ApprovalAttemptResult) {
    super(message);
  }
}

export interface A2OperationRow {
  createRequestId?: string;
  resultSkuId?: string;
  missionTarget?: { actionRoute: string; productName: string | null };
  businessResult?: F4ApprovalBusinessResult;
  lastApprovalAttemptResult?: F4ApprovalAttemptResult;
  f4ResultUnreadable?: true;
  /** Persisted backend review only; null is unavailable, four empty arrays are a known empty diff. */
  roleGrantsDiff: A2RoleGrantsDiff | null;
  roleGrantsReview: A2RoleGrantsReview | null;
  disclosureReview?: I5DisclosureReview;
  v8PromotionSnapshot?: V8PromotionSnapshot;
  ruleTaskAction?: A2RuleTaskAction;
  approveDeniedMessage?: string;
  rejectDeniedMessage?: string;
  canApprove?: boolean;
  canReject?: boolean;
  ambassadorMaterialProposal?: F4AmbassadorMaterialProposal;
  ambassadorMaterialError?: string;
  phoneCalibrationProposal?: PhoneProposalView;
  phoneCalibrationError?: string;
  coverageCheckOnApproval?: boolean;
  operationCode?: string;
  retiredOperation?: boolean;
  fundEffect?: A2FundEffect;
  refundOrderNo?: string;
  refundAmountUsdt?: number;
  originalAmountUsdt?: string | null;
  refundAmountUsdtText?: string | null;
  refundReason?: string | null;
  id: string;
  action: string;
  obj: string;
  objDisplayName?: string;
  before: string;
  after: string;
  /** Absent for legacy tickets. Null means a structured snapshot was present but unreadable. */
  withdrawalChanges?: WithdrawalProposalChanges | null;
  operator: string;
  operatorRole: string;
  type: A2OperationType;
  amplifies: boolean;
  sos: boolean;
  ts: string;
  /** 后端原始时间，要按业务时区显示时用。ts 是按浏览器时区格式化好的。 */
  rawTs?: string;
  /** Original status for domain-specific recovery receipt validation. */
  rawStatus?: string;
  mine: boolean;
  roleGate: string;
  reason: string;
  status: "pending" | "approved" | "rejected" | "withdrawn" | "expired";
}

export interface A2OperationHistory {
  ruleTaskAction?: A2RuleTaskAction | null;
  operationCode?: string | null;
  resultSkuId?: string;
  id: string;
  action: string;
  st: string;
  chain: string;
  t: string;
  note: string;
}

export interface A2MechanismParam {
  key: string;
  name: string;
  sub: string;
  value: string;
  locked: boolean;
}

export interface A2ConfirmCategory {
  cat: string;
  examples: string;
  roleGate: string;
}

export interface A2AuditLogRow {
  id: string;
  ts: string;
  createdAt: string;
  actor: string;
  role: string;
  action: string;
  actionLabel?: string;
  approvalAction?: string;
  operationCode?: string;
  createRequestId?: string;
  resultSkuId?: string;
  beforeValue?: string;
  afterValue?: string;
  obj: string;
  resourceType?: string;
  resourceId?: string;
  bizNo?: string;
  delta: string;
  domain: A2AuditDomain;
  ip: string;
  result: string;
  riskLevel: string;
  reason: string;
  idempotencyKey?: string;
  schemaVersion: string;
}

export interface A2Overview {
  /** Strict queue reads retain valid tickets and report malformed rows separately. */
  operationQueueInvalidCount?: number;
  stats: A2Stats;
  operationQueue: A2OperationRow[];
  operationHistory: A2OperationHistory[];
  mechanismParams: A2MechanismParam[];
  confirmCategories: A2ConfirmCategory[];
  recentLogs: A2AuditLogRow[];
}

let requestSeq = 0;

/** crypto.randomUUID 只在 secure context 存在;局域网 http 演示下会是 undefined。仓内统一兜底写法。 */
function randomSuffix() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
}

function idempotencyKey(prefix: string) {
  requestSeq = (requestSeq + 1) % 1_000_000;
  // 随机段是必需的:命令号如今被持久化 24h,而 sessionStorage 是 per-tab 的 —— 两个标签页
  // 同毫秒对同一动作首次提交时,时间戳与各自从 0 起的序号都会相同,撞出同一个号,
  // 后端按同号去重会静默吞掉第二个人的操作。
  // randomUUID 是 secure-context-only:局域网 http://<IP>:3002 演示时它不存在,必须兜底(仓内 8 处同款写法)。
  return `${prefix}-${Date.now()}-${requestSeq}-${randomSuffix()}`;
}

function toNumber(value: number | string | null | undefined, fallback = 0) {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asText(value: unknown, fallback = "—") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asAuditValue(value: unknown) {
  return typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))
    ? String(value)
    : asText(value);
}

function asTrialPurchaseAuditValue(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) return asAuditValue(value);
  return value.length ? value.join("、") : "空清单";
}

function parseDetail(detailJson: string | null | undefined): Record<string, unknown> {
  if (!detailJson) return {};
  try {
    const parsed = JSON.parse(detailJson);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function normalizeType(value: string | null | undefined): A2OperationType {
  const normalized = value?.trim().toLowerCase();
  return normalized === "fund" || normalized === "param" || normalized === "acct" || normalized === "sos"
    ? normalized
    : "param";
}

function normalizeStatus(value: string | null | undefined): A2OperationRow["status"] {
  const normalized = value?.trim().toLowerCase();
  return normalized === "approved" || normalized === "rejected" || normalized === "withdrawn" || normalized === "expired"
    ? normalized
    : "pending";
}

export function createA2CommandKey(prefix: string) {
  return idempotencyKey(prefix);
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function readRoleGrantsDiff(value: unknown): A2RoleGrantsDiff | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const codes = (items: unknown): items is string[] => Array.isArray(items)
    && items.every(code => typeof code === "string" && !!code.trim());
  const ids = (items: unknown): items is number[] => Array.isArray(items)
    && items.every(id => typeof id === "number" && Number.isSafeInteger(id) && id > 0);
  if (!codes(row.permissionCodesAdded) || !codes(row.permissionCodesRemoved)
    || !ids(row.menuIdsAdded) || !ids(row.menuIdsRemoved)) return null;
  return {
    permissionCodesAdded: row.permissionCodesAdded, permissionCodesRemoved: row.permissionCodesRemoved,
    menuIdsAdded: row.menuIdsAdded, menuIdsRemoved: row.menuIdsRemoved,
  };
}

function isSnapshotRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readH3MissionTarget(value: unknown): A2OperationRow["missionTarget"] {
  if (!isSnapshotRecord(value)) return undefined;
  const { actionRoute, productName } = value;
  if (typeof actionRoute !== "string" || !/^\/pages\/\S+$/.test(actionRoute)
    || (productName !== null && (typeof productName !== "string" || !productName.trim()))) return undefined;
  return { actionRoute, productName };
}

function isSnapshotReward(value: unknown): value is OpsVRankRewardItem & Record<string, unknown> {
  if (!isSnapshotRecord(value) || typeof value.id !== "string" || !value.id.trim()) return false;
  switch (value.type) {
    case "usdt":
    case "uvt":
      return typeof value.amountText === "string" && /^\d{1,12}(?:\.\d{1,6})?$/.test(value.amountText)
        && (value.amount === undefined || (typeof value.amount === "number" && Number.isFinite(value.amount)));
    case "voucher": return typeof value.voucherId === "string" && !!value.voucherId.trim();
    case "sku": return typeof value.skuId === "string" && !!value.skuId.trim();
    case "custom": return typeof value.custom === "string" && !!value.custom.trim();
    default: return false;
  }
}

function readSnapshotBenefits(row: Record<string, unknown>): V8PromotionBenefits | undefined {
  const rate = (value: unknown) => rankPurchaseRate(typeof value === "number" ? String(value) : value);
  const purchaseL1Rate = rate(row.purchaseL1Rate);
  const purchaseL2Rate = rate(row.purchaseL2Rate);
  const monthlySalaryUsdt = typeof row.monthlySalaryUsdt === "string" && /^\d{1,12}(?:\.\d{1,6})?$/.test(row.monthlySalaryUsdt)
    ? row.monthlySalaryUsdt : undefined;
  return purchaseL1Rate || purchaseL2Rate || monthlySalaryUsdt ? { purchaseL1Rate, purchaseL2Rate, monthlySalaryUsdt } : undefined;
}

function readV8PromotionSnapshot(value: unknown): V8PromotionSnapshot | undefined {
  if (!isSnapshotRecord(value)) return undefined;
  const { originalRank, v8Rewards, v7, v8 } = value;
  if (typeof originalRank !== "string" || !/^V[0-8]$/.test(originalRank)
    || (v8Rewards != null && !Array.isArray(v8Rewards))
    || (v7 != null && !isSnapshotRecord(v7)) || (v8 != null && !isSnapshotRecord(v8))) return undefined;
  const rewardName = (name: unknown) => typeof name === "string" ? name.trim() || undefined : undefined;
  const rewards = v8Rewards?.every(isSnapshotReward) ? v8Rewards.map(reward => ({
    ...reward,
    voucherName: rewardName(reward.voucherName),
    skuName: rewardName(reward.skuName),
  })) : undefined;
  const from = v7 ? readSnapshotBenefits(v7) : undefined;
  const to = v8 ? readSnapshotBenefits(v8) : undefined;
  return rewards || from || to ? { originalRank, v8Rewards: rewards, v7: from, v8: to } : undefined;
}

function isDisclosureLanguageScope(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const scope = value.trim();
  if (scope === "en" || scope === "zh+vi" || scope === "zh+vi+en") return true;
  const codes = scope.split("+");
  return scope.startsWith("zh+vi+en+") && new Set(codes).size === codes.length
    && codes.slice(3).every(code => INTERFACE_LANGUAGES.some(language => language.code === code));
}

export function readA2DisclosureVersion(value: unknown, jurisdiction: string, version: string): DisclosureVersionItemView | undefined {
  const row = value as Partial<DisclosureVersionItemView> | null | undefined;
  if (row?.jurisdiction !== jurisdiction || row.version !== version || typeof row.status !== "string"
    || !isDisclosureLanguageScope(row.languageScope)
    || typeof row.effectiveDate !== "string" || typeof row.requiresReack !== "boolean"
    || typeof row.zh !== "string" || typeof row.vi !== "string" || typeof row.en !== "string"
    || !Array.isArray(row.chapters) || row.chapters.length !== 7
    || !row.chapters.every((chapter) => chapter?.jurisdiction === jurisdiction && chapter.version === version
      && typeof chapter.no === "string" && /^0[1-7]$/.test(chapter.no)
      && typeof chapter.zh === "string" && typeof chapter.vi === "string" && typeof chapter.en === "string"
      && typeof chapter.zhBody === "string" && typeof chapter.viBody === "string" && typeof chapter.enBody === "string")
    || new Set(row.chapters.map((chapter) => chapter.no)).size !== 7) return undefined;
  return { ...row, languageScope: row.languageScope.trim() } as DisclosureVersionItemView;
}

function readDisclosureCountryCodes(value: unknown): string[] | null | undefined {
  if (value === null) return null;
  return Array.isArray(value) && value.every(code => typeof code === "string" && code.trim()) ? value : undefined;
}

function readI5DisclosureReview(value: unknown, operation: BackendTicket["operationCode"]): I5DisclosureReview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const {
    kind, jurisdiction, version, expectedVersion, revision, contentHash, draft, chapters,
    previousVersion, previousVersionSummary, draftMatchesFrozenEvidence, originalCountryCodes, targetCountryCodes,
  } = value as Record<string, unknown>;
  if (typeof jurisdiction !== "string" || !jurisdiction.trim() || typeof version !== "string" || !version.trim()) return undefined;
  if (kind === "MATRIX" && operation === "i5_matrix_configure" && typeof expectedVersion === "string") {
    return { kind, jurisdiction, version, expectedVersion,
      originalCountryCodes: readDisclosureCountryCodes(originalCountryCodes),
      targetCountryCodes: readDisclosureCountryCodes(targetCountryCodes) };
  }
  if (kind !== "PUBLISH" || (operation !== "i4_disclosure_publish" && operation !== "i5_disclosure_publish")) return undefined;
  const frozen = draft && typeof draft === "object" ? readA2DisclosureVersion({ ...draft, chapters }, jurisdiction, version) : undefined;
  const previous = typeof previousVersion === "string" && previousVersion.trim() ? previousVersion : undefined;
  // The frozen previous summary omits the jurisdiction on the version and both identifiers on each chapter.
  const summary = previousVersionSummary as { chapters?: unknown } | null | undefined;
  const previousRow = previous && previous !== version && Array.isArray(summary?.chapters)
    ? readA2DisclosureVersion({ ...summary, jurisdiction,
      chapters: summary.chapters.map(chapter => ({ ...chapter, jurisdiction, version: previous })) }, jurisdiction, previous)
    : undefined;
  return {
    kind, jurisdiction, version,
    draft: frozen?.status.toLowerCase() === "draft"
      && typeof revision === "number" && Number.isSafeInteger(revision) && revision > 0 && frozen.revision === revision
      && typeof contentHash === "string" && /^[a-f0-9]{64}$/.test(contentHash) && frozen.contentHash === contentHash ? frozen : undefined,
    previousVersion: previousVersion === null ? null : previous,
    previousVersionSummary: previousVersionSummary === null ? null
      : previousRow && ["published", "archived"].includes(previousRow.status.toLowerCase()) ? previousRow : undefined,
    draftMatchesFrozenEvidence: typeof draftMatchesFrozenEvidence === "boolean" || draftMatchesFrozenEvidence === null
      ? draftMatchesFrozenEvidence : undefined,
  };
}

type A2DisclosureSide =
  | { state: "available"; version: string; languageScope: string[] }
  | { state: "first_publish" }
  | { state: "missing_evidence"; version?: string };

type A2DisclosureText =
  | { state: "available"; text: string }
  | { state: "out_of_scope" | "first_publish" | "missing_evidence" };

function disclosureText(side: A2DisclosureSide, code: string, text: unknown): A2DisclosureText {
  if (side.state !== "available") return { state: side.state };
  if (!side.languageScope.includes(code)) return { state: "out_of_scope" };
  return typeof text === "string" && text.trim() ? { state: "available", text } : { state: "missing_evidence" };
}

/** Project the additional-language comparison from the publish ticket's frozen versions. */
export function a2DisclosureTranslationDiff(review: A2OperationRow["disclosureReview"]) {
  if (review?.kind !== "PUBLISH") return undefined;
  const previous = review.previousVersionSummary;
  const draft = review.draft;
  const before: A2DisclosureSide = previous
    ? { state: "available", version: previous.version, languageScope: previous.languageScope.split("+") }
    : isFirstA2DisclosurePublish(review) ? { state: "first_publish" }
      : { state: "missing_evidence", version: review.previousVersion ?? undefined };
  const after: A2DisclosureSide = draft
    ? { state: "available", version: draft.version, languageScope: draft.languageScope.split("+") }
    : { state: "missing_evidence", version: review.version };
  const beforeScope = before.state === "available" ? before.languageScope : undefined;
  const afterScope = after.state === "available" ? after.languageScope : undefined;
  const scopeChanged = beforeScope && afterScope
    ? beforeScope.length !== afterScope.length || beforeScope.some(code => !afterScope.includes(code))
    : null;
  const codes = [...new Set([...(beforeScope ?? []), ...(afterScope ?? [])])]
    .filter(code => !["zh", "vi", "en"].includes(code));
  const chapterNumbers = ["01", "02", "03", "04", "05", "06", "07"];
  const languages = codes.map(code => {
    const compare = (oldText: unknown, newText: unknown) => {
      const oldValue = disclosureText(before, code, oldText);
      const newValue = disclosureText(after, code, newText);
      const changed = oldValue.state === "available" && newValue.state === "available"
        ? oldValue.text !== newValue.text : null;
      return { before: oldValue, after: newValue, changed };
    };
    return {
      code,
      summary: compare(previous?.translations?.[code], draft?.translations?.[code]),
      chapters: chapterNumbers.map(no => {
        const oldChapter = previous?.chapters.find(chapter => chapter.no === no);
        const newChapter = draft?.chapters.find(chapter => chapter.no === no);
        return {
          no,
          title: compare(oldChapter?.titleTranslations?.[code], newChapter?.titleTranslations?.[code]),
          body: compare(oldChapter?.bodyTranslations?.[code], newChapter?.bodyTranslations?.[code]),
        };
      }),
    };
  });
  return {
    before, after, scopeChanged, languages,
    changedSummaryLanguages: languages.filter(language => language.summary.changed === true).map(language => language.code),
    changedChapterNumbers: chapterNumbers.filter(no => languages.some(language => language.chapters
      .some(chapter => chapter.no === no && (chapter.title.changed === true || chapter.body.changed === true)))),
  };
}

function roleGrantsReview(diff: A2RoleGrantsDiff, permissions?: ReadonlyMap<string, A8Permission>, menus?: ReadonlyMap<number, A7MenuTreeNode>): A2RoleGrantsReview {
  const permission = (code: string) => {
    const entry = permissions?.get(code);
    return { code, name: entry ? permLabel(code, entry) : null,
      catalogueStatus: (entry ? "found" : permissions ? "missing" : "unavailable") as A2CatalogueStatus };
  };
  const menu = (id: number) => {
    const entry = menus?.get(id);
    return { id, name: entry ? menuLabel(entry) : null,
      catalogueStatus: (entry ? "found" : menus ? "missing" : "unavailable") as A2CatalogueStatus };
  };
  return {
    permissionsAdded: diff.permissionCodesAdded.map(permission), permissionsRemoved: diff.permissionCodesRemoved.map(permission),
    menusAdded: diff.menuIdsAdded.map(menu), menusRemoved: diff.menuIdsRemoved.map(menu),
  };
}

/** Optional names never add an A2 read/approval permission requirement or invalidate a ticket receipt. */
async function withRoleGrantsNames(rows: A2OperationRow[]): Promise<A2OperationRow[]> {
  const diffs = rows.flatMap(row => row.roleGrantsDiff ? [row.roleGrantsDiff] : []);
  if (!diffs.length) return rows;
  const authorities = useAdminAuth.getState().session?.authorities ?? [];
  const [permissions, menus] = await Promise.allSettled([
    (async () => {
      if (!authorities.includes("platform_a8_read") || !diffs.some(diff => diff.permissionCodesAdded.length || diff.permissionCodesRemoved.length)) return undefined;
      const catalogue = new Map<string, A8Permission>();
      let total = Infinity;
      for (let pageNum = 1; catalogue.size < total; pageNum++) {
        const page = await fetchA8Permissions({ pageNum, pageSize: 100 });
        total = page.total;
        if (!page.records.length && catalogue.size < total) throw new Error("A8_CATALOG_TRUNCATED");
        for (const permission of page.records) {
          if (catalogue.has(permission.permissionCode)) throw new Error("A8_CATALOG_DUPLICATE_PAGE");
          catalogue.set(permission.permissionCode, permission);
        }
        if (pageNum >= 1000 || catalogue.size > total) throw new Error("A8_CATALOG_INCOMPLETE");
      }
      return catalogue;
    })(),
    (async () => {
      if (!authorities.includes("platform_a7_read") || !diffs.some(diff => diff.menuIdsAdded.length || diff.menuIdsRemoved.length)) return undefined;
      const catalogue = new Map<number, A7MenuTreeNode>();
      const walk = (node: A7MenuTreeNode) => { catalogue.set(node.id, node); node.children.forEach(walk); };
      (await fetchA7MenusOverview()).tree.forEach(walk);
      return catalogue;
    })(),
  ]);
  return rows.map(row => row.roleGrantsDiff ? { ...row, roleGrantsReview: roleGrantsReview(row.roleGrantsDiff,
    permissions.status === "fulfilled" ? permissions.value : undefined,
    menus.status === "fulfilled" ? menus.value : undefined) } : row);
}

const INVALID_F4_BUSINESS_RESULT = "A2_F4_BUSINESS_RESULT_INVALID";

function isF4SettlementOperation(operationCode: BackendTicket["operationCode"]) {
  return operationCode === "f4_pool_settle" || operationCode === "f4_leaderboard_period_payout";
}

/** B134 omits results for older tickets. A present result must match the approval or attempt contract. */
function readF4SettlementResult(value: unknown): F4ApprovalBusinessResult | F4ApprovalAttemptResult | undefined {
  if (value === undefined) return undefined;
  const invalid = () => new Error(INVALID_F4_BUSINESS_RESULT);
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const { status, creditedCount, amountsByCurrency, settlementKey, reasonCode, attemptedAt } = value as Record<string, unknown>;
  if (amountsByCurrency === null || typeof amountsByCurrency !== "object" || Array.isArray(amountsByCurrency)) throw invalid();
  const entries = Object.entries(amountsByCurrency);
  if (status === "NOT_EXECUTED" && creditedCount === 0 && entries.length === 0) {
    if (typeof attemptedAt === "string" && attemptedAt.endsWith("Z") && Number.isFinite(Date.parse(attemptedAt)) && settlementKey === undefined
      && (reasonCode === "F4_LEADERBOARD_PAUSED" || reasonCode === "COVERAGE_BELOW_REDLINE")) return { status, reasonCode, attemptedAt };
    if (attemptedAt === undefined && typeof settlementKey === "string" && settlementKey.trim()
      && typeof reasonCode === "string" && /^[A-Z][A-Z0-9_]*$/.test(reasonCode)) return { status, reasonCode, settlementKey };
  }
  if (status !== "EXECUTED" || typeof creditedCount !== "number" || !Number.isSafeInteger(creditedCount) || creditedCount <= 0
    || typeof settlementKey !== "string" || !settlementKey.trim() || !entries.length || attemptedAt !== undefined || reasonCode !== undefined) throw invalid();
  const amounts = entries.map(([currency, amount]) => {
    const decimal = typeof amount === "string" ? f4Decimal(amount) : null;
    if (!/^[A-Z][A-Z0-9]*$/.test(currency) || decimal === null || decimal.startsWith("-") || !/[1-9]/.test(decimal)) throw invalid();
    return [currency, decimal] as const;
  });
  return { status, creditedCount, amountsByCurrency: Object.fromEntries(amounts), settlementKey };
}

function readF4ApprovalAttempt(value: unknown) {
  const result = readF4SettlementResult(value);
  if (result && !("attemptedAt" in result)) throw new Error(INVALID_F4_BUSINESS_RESULT);
  return result;
}

function optionalIdentifier(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function fromTicket(ticket: BackendTicket, tolerateUnreadableResult = false): A2OperationRow {
  if (typeof ticket.canApprove !== "boolean" || typeof ticket.canReject !== "boolean") throw new Error("A2_TICKET_DECISION_CAPABILITY_INVALID");
  if (ticket.objDisplayName != null && typeof ticket.objDisplayName !== "string") throw new Error("A2_TICKET_OBJECT_DISPLAY_NAME_INVALID");
  const ambassadorTicket = !!ticket.ambassadorMaterialProposal || /F\.ambassador\.\d+\.status|(?:批准|驳回)大使申请/.test(`${ticket.obj} ${ticket.action}`);
  let ambassadorMaterialProposal: F4AmbassadorMaterialProposal | undefined;
  let ambassadorMaterialError: string | undefined;
  if (ambassadorTicket) {
    const packet = ticket.ambassadorMaterialProposal;
    const approval = packet?.applicationDecision === "APPROVE";
    const pending = normalizeStatus(ticket.status) === "pending";
    if (!packet || !Number.isSafeInteger(packet.applicationId) || !Number.isSafeInteger(packet.materialRevision)
      || !packet.businessReview || !packet.financeReview || !Array.isArray(packet.approvalBlockers)) {
      if (pending) ambassadorMaterialError = "大使材料摘要未能读取，不能执行。请核对材料读取权限、刷新原工单；旧提案须补齐后重新发起。";
    } else {
      ambassadorMaterialProposal = packet;
      if (pending && !["APPROVE", "REJECT"].includes(packet.applicationDecision ?? "")) {
        ambassadorMaterialError = "原申请的批准或驳回意图未能核实，不能执行，请刷新原工单。";
      } else if (pending && approval && (packet.expectedMaterialRevision == null || packet.expectedMaterialRevision !== packet.materialRevision)) {
        ambassadorMaterialError = ambassadorApprovalBlocker("MATERIAL_REVISION_STALE");
      } else if (pending && packet.canApprove !== true) {
        ambassadorMaterialError = packet.approvalBlockers.map(ambassadorApprovalBlocker).join("；") || "本申请尚未满足执行条件，请刷新材料核对。";
      }
    }
  }
  let phoneCalibrationProposal: PhoneProposalView | undefined;
  let phoneCalibrationError: string | undefined;
  if (ticket.obj === "phone-calibration") {
    try {
      phoneCalibrationProposal = parsePhoneProposalView(JSON.parse(ticket.phoneCalibrationProposal ?? "null"));
    } catch { phoneCalibrationError = "手机规则申请的详情加载失败，不能执行；可取消后重新提交。"; }
  }
  const roleGrantsDiff = readRoleGrantsDiff(ticket.roleGrantsDiff);
  const withdrawalSource = ticket.operationCode === "d5_withdrawal_limits" || !ticket.operationCode && ticket.action === "放宽提现参数" ? "D5"
    : ticket.operationCode === "d7_payout_vnd_config" || !ticket.operationCode && ticket.action === "放宽越南盾提现参数" ? "D7" : undefined;
  let payoutResults: Pick<A2OperationRow, "businessResult" | "lastApprovalAttemptResult" | "f4ResultUnreadable"> = {};
  if (isF4SettlementOperation(ticket.operationCode)) {
    try {
      const businessResult = readF4SettlementResult(ticket.businessResult);
      if (businessResult && "attemptedAt" in businessResult) throw new Error(INVALID_F4_BUSINESS_RESULT);
      payoutResults = { businessResult, lastApprovalAttemptResult: readF4ApprovalAttempt(ticket.lastApprovalAttemptResult) };
    } catch (error) {
      if (!tolerateUnreadableResult || !(error instanceof Error) || error.message !== INVALID_F4_BUSINESS_RESULT) throw error;
      payoutResults = { f4ResultUnreadable: true };
    }
  }
  return {
    ...payoutResults,
    missionTarget: readH3MissionTarget(ticket.missionTarget),
    roleGrantsDiff,
    roleGrantsReview: roleGrantsDiff ? roleGrantsReview(roleGrantsDiff) : null,
    disclosureReview: readI5DisclosureReview(ticket.disclosureReview, ticket.operationCode),
    v8PromotionSnapshot: readV8PromotionSnapshot(ticket.v8PromotionSnapshot),
    ruleTaskAction: ticket.ruleTaskAction ?? undefined,
    approveDeniedMessage: ticket.approveDeniedMessage ? formatAdminApiError(ticket.approveDeniedMessage, "这个账号没有批准这张单的权限") : undefined,
    rejectDeniedMessage: ticket.rejectDeniedMessage ? formatAdminApiError(ticket.rejectDeniedMessage, "这个账号没有驳回这张单的权限") : undefined,
    ...(ambassadorMaterialProposal ? { ambassadorMaterialProposal } : {}),
    ...(ambassadorMaterialError ? { ambassadorMaterialError } : {}),
    ...(phoneCalibrationProposal ? { phoneCalibrationProposal } : {}),
    ...(phoneCalibrationError ? { phoneCalibrationError } : {}),
    canApprove: ticket.canApprove,
    canReject: ticket.canReject,
    ...(ticket.coverageCheckOnApproval === true ? { coverageCheckOnApproval: true } : {}),
    ...(ticket.operationCode ? { operationCode: ticket.operationCode } : {}),
    createRequestId: optionalIdentifier(ticket.createRequestId),
    resultSkuId: normalizeStatus(ticket.status) === "approved" ? optionalIdentifier(ticket.resultSkuId) : undefined,
    ...(ticket.retiredOperation === true ? { retiredOperation: true } : {}),
    fundEffect: ticket.fundEffect ?? undefined,
    refundOrderNo: ticket.refundOrderNo ?? undefined,
    ...(ticket.refundAmountUsdt != null && Number(ticket.refundAmountUsdt) > 0
      ? { refundAmountUsdt: Number(ticket.refundAmountUsdt) } : {}),
    originalAmountUsdt: readE4Money(ticket.originalAmountUsdt),
    refundAmountUsdtText: readE4Money(ticket.refundAmountUsdt),
    refundReason: ticket.reason ?? null,
    id: ticket.id,
    action: ticket.action,
    obj: ticket.obj,
    objDisplayName: ticket.objDisplayName?.trim() || undefined,
    before: ticket.beforeValue?.trim() || "—",
    after: ticket.afterValue?.trim() || "—",
    ...(withdrawalSource && ticket.changes != null ? { withdrawalChanges: readWithdrawalProposalChanges(withdrawalSource, ticket.changes) } : {}),
    operator: ticket.operator?.trim() || "系统",
    operatorRole: ticket.operatorRole?.trim() || "super",
    type: normalizeType(ticket.type),
    amplifies: !!ticket.amplifies,
    sos: !!ticket.sos,
    ts: formatTime(ticket.ts),
    rawTs: ticket.ts ?? undefined,
    mine: !!ticket.mine,
    roleGate: ticket.roleGate?.trim() || "超管",
    reason: ticket.reason?.trim() || "—",
    status: normalizeStatus(ticket.status),
    rawStatus: ticket.status ?? undefined,
  };
}

type A2VoucherReversalResult =
  | { state: "available"; disposition?: string; skippedReason?: string; amountUsdt?: string }
  | { state: "missing_receipt" };

const F1_VOUCHER_REVERSAL_ACTION = "奖励发放 · 冲正 · 券";
const F1_VOUCHER_REVERSAL_RECEIPT = /^已冲正(?: · 券处置: ([A-Z][A-Z0-9_]*))?(?: · 未扣回原因: ([A-Z][A-Z0-9_]*))?(?: · 已扣回: (\d+(?:\.\d{1,6})?) USDT)?$/;

/** The history row identifies the decision; only the visible approved ticket carries the executed result. */
export function a2VoucherReversalResult(
  history: A2OperationHistory | null | undefined,
  operationQueue: readonly A2OperationRow[],
): A2VoucherReversalResult | undefined {
  if (!history || history.st !== "approved" || history.action !== F1_VOUCHER_REVERSAL_ACTION
    || (history.operationCode != null && history.operationCode !== "f_reward_payout_action")) return undefined;
  const ticket = operationQueue.find(item => item.id === history.id);
  if (ticket?.status !== "approved" || ticket.operationCode !== "f_reward_payout_action"
    || ticket.action !== F1_VOUCHER_REVERSAL_ACTION) return { state: "missing_receipt" };
  const match = F1_VOUCHER_REVERSAL_RECEIPT.exec(ticket.after);
  if (!match) return { state: "missing_receipt" };
  const [, disposition, skippedReason, amountUsdt] = match;
  if ((!disposition && !skippedReason && !amountUsdt) || (amountUsdt && !/[1-9]/.test(amountUsdt))) {
    return { state: "missing_receipt" };
  }
  return { state: "available", disposition, skippedReason, amountUsdt };
}

function fromLog(log: BackendAuditLog): A2AuditLogRow {
  const detail = parseDetail(log.detailJson);
  const action = asText(log.action, "UNKNOWN");
  const resourceType = asText(log.resourceType, "");
  const obj = resolveA2AuditObject(detail.obj, detail.resource, log.resourceType, log.resourceId);
  const beforeVal = detail.before ?? detail.oldValue ?? detail.beforePrice ?? detail.fromStatus ?? detail.from;
  const afterVal = detail.after ?? detail.newValue ?? detail.afterPrice ?? detail.toStatus ?? detail.to;
  const formatValue = action === H2_BUY_LIST_ACTION ? asTrialPurchaseAuditValue : asAuditValue;
  const delta = asText(detail.delta, beforeVal != null || afterVal != null ? `${formatValue(beforeVal)} → ${formatValue(afterVal)}` : "—");
  return {
    id: String(log.id ?? `${action}-${log.createdAt ?? Date.now()}`),
    ts: asText(detail.tsLabel, formatTime(log.createdAt)),
    createdAt: log.createdAt?.trim() || "",
    actor: asText(detail.actor ?? log.actorUsername, "系统"),
    role: asText(detail.role ?? log.actorType, "ADMIN"),
    action,
    actionLabel: auditActionFieldLabel(action, detail.field),
    approvalAction: resourceType === "A2_OPERATION" ? asText(detail.action, "") : undefined,
    operationCode: optionalIdentifier(log.operationCode ?? detail.operationCode),
    createRequestId: optionalIdentifier(log.createRequestId ?? detail.createRequestId),
    resultSkuId: optionalIdentifier(log.resultSkuId ?? detail.resultSkuId),
    beforeValue: typeof detail.before === "string" ? detail.before : undefined,
    afterValue: typeof detail.after === "string" ? detail.after : undefined,
    obj,
    resourceType,
    resourceId: asText(log.resourceId, ""),
    bizNo: asText(log.bizNo, ""),
    delta,
    domain: resolveA2AuditDomain(detail.sourceDomain, detail.domain, action, resourceType),
    ip: log.clientIp?.trim() || "—",
    result: log.result?.trim() || "SUCCESS",
    riskLevel: log.riskLevel?.trim() || "INFO",
    reason: asText(detail.reason, "—"),
    idempotencyKey: detail.idempotencyKey != null ? String(detail.idempotencyKey) : undefined,
    schemaVersion: asText(log.schemaVersion, "legacy"),
  };
}

async function normalizeOverview(data: BackendOverview | null | undefined): Promise<A2Overview> {
  const stats = data?.stats ?? {};
  return {
    stats: {
      pendingTickets: toNumber(stats.pendingTickets),
      fundTickets: toNumber(stats.fundTickets),
      sosTickets: toNumber(stats.sosTickets),
      todayAuditEvents: toNumber(stats.todayAuditEvents),
      weeklyApproved: toNumber(stats.weeklyApproved),
      weeklyRejected: toNumber(stats.weeklyRejected),
      weeklyExpired: toNumber(stats.weeklyExpired),
      weeklyWithdrawn: toNumber(stats.weeklyWithdrawn),
    },
    operationQueue: await withRoleGrantsNames((data?.operationQueue ?? []).map(ticket => fromTicket(ticket, true))),
    operationHistory: (data?.operationHistory ?? []).map((row) => ({ ...row,
      resultSkuId: row.st === "approved" ? optionalIdentifier(row.resultSkuId) : undefined,
    })),
    mechanismParams: (data?.mechanismParams ?? []).map((row) => ({ ...row, locked: !!row.locked })),
    confirmCategories: (data?.confirmCategories ?? []).map((row) => ({ ...row })),
    recentLogs: (data?.recentLogs ?? []).map(fromLog),
  };
}

/** Jackson emits BigDecimal as JSON numbers. Keep the lexemes in B102's flat array of changes and network maps. */
function preserveWithdrawalChangeNumbers(text: string) {
  return text.replace(/("changes"\s*:\s*\[(?:[^"\[\]]|"(?:\\.|[^"\\])*")*\])|"(?:\\.|[^"\\])*"/g, (token, changes: string | undefined) => {
    if (!changes) return token;
    return changes.replace(/("(?:before|after|trc20|bep20|erc20)"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])|"(?:\\.|[^"\\])*"/g,
      (match, key: string | undefined, number: string | undefined) => key ? `${key}"${number}"` : match);
  });
}

/** B134 amounts are JSON numbers. Retain the original decimal digits for the receipt. */
function preserveF4BusinessResultAmounts(text: string) {
  return text.replace(/("amountsByCurrency"\s*:\s*\{(?:[^"{}]|"(?:\\.|[^"\\])*")*\})|"(?:\\.|[^"\\])*"/g, (token, amounts: string | undefined) => {
    return amounts?.replace(/("[A-Z][A-Z0-9]*"\s*:\s*)(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}])/g, '$1"$2"') ?? token;
  });
}

async function a2Request<T>(path: string, init?: RequestInit & { idempotencyPrefix?: string; commandKey?: string; strictOutcome?: boolean | "proposal"; f5Status?: boolean; f4Payout?: boolean; createRequestId?: string }) {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (init?.commandKey) {
    headers.set("Idempotency-Key", init.commandKey);
  } else if (init?.idempotencyPrefix) {
    headers.set("Idempotency-Key", idempotencyKey(init.idempotencyPrefix));
  }

  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/platform/audit${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch (error) {
    if (init?.commandKey) {
      throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "A2_REQUEST_OUTCOME_UNKNOWN", init.commandKey);
    }
    throw error;
  }
  const result = (await response.text().then(text => {
    const exactMoney = text.replace(/("(?:originalAmountUsdt|refundAmountUsdt)"\s*:\s*)(-?\d+(?:\.\d+)?)(?=\s*[,}])/g, '$1"$2"');
    return JSON.parse(preserveF4BusinessResultAmounts(preserveWithdrawalChangeNumbers(exactMoney)));
  }).catch(() => null)) as ApiResult<T> | null;
  // 41a552fa checks coverage before the first F4 payout write. Other 503s remain unknown.
  const f4PayoutCoverageRefusal = init?.f4Payout === true && response.status === 503
    && result?.code === 503 && result.message === "COVERAGE_SNAPSHOT_UNAVAILABLE";
  // classification-ok: Strict recovery rejects malformed envelopes and wrapped business 5xx even under HTTP 200; HTTP failure classification below remains shared.
  if (init?.commandKey && init.strictOutcome && (!result || !Number.isInteger(result.code)
      || result.code >= 500 && !f4PayoutCoverageRefusal || init.strictOutcome === true && result.code !== 0 && result.code < 400)) {
    throw new A2OutcomeUncertainError("提交结果未知，请到操作记录里核对。", init.commandKey);
  }

  if (init?.commandKey && !result) {
    throw new A2OutcomeUncertainError("A2_RESPONSE_UNREADABLE", init.commandKey);
  }

  const upstreamOutcomeUnknown =
    response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown"
    || result?.message?.trim().toUpperCase().includes("UPSTREAM_OUTCOME_UNKNOWN") === true
    || isIdempotencyOutcomeOpen(result?.message)
    // ba3befba: current maker authority can hide an already-created K1 ticket.
    // This refusal to expose the old receipt is not a verdict on its execution.
    || result?.message === "OPERATION_RESULT_UNKNOWN";
  if (init?.commandKey && upstreamOutcomeUnknown) {
    throw new A2OutcomeUncertainError(
      formatAdminApiError(result?.message, "A2_REQUEST_OUTCOME_UNKNOWN"), init.commandKey);
  }

  // F5 unlock and unfreeze guards refuse these exact commands before state, ledger or ticket writes.
  // A transport/unknown-outcome response still takes precedence above.
  const f5StatusRejected = init?.f5Status === true && /^\/operations\/[^/]+\/approve$/.test(path)
    && response.status === result?.code && (
      response.status === 409 && (result.message === "COMMISSION_USER_SUSPENDED" || result.message === "F5_COOLDOWN_DEADLINE_UNRECOVERABLE")
      || response.status === 422 && result.message === "COVERAGE_BELOW_REDLINE"
      || response.status === 503 && result.message === "COVERAGE_SNAPSHOT_UNAVAILABLE");
  if (!response.ok || !result || result.code !== 0) {
    // 🔴 带在途命令号时,只有**确定性拒绝**(4xx / 2xx 但业务码非 0)才算「这次没生效」。
    //   5xx 归确定失败 = 调用方 forget 命令号 = 下次重试铸新号 = 后端去重失效 = 资金动作双发。
    //   口径单源见 outcome-classification.ts(2026-08-06 全家族统一)。
    if (init?.commandKey && !f5StatusRejected && !f4PayoutCoverageRefusal && outcomeStaysUnknown(response.status, result?.code)) {
      throw new A2OutcomeUncertainError(
        formatAdminApiError(result?.message, `A2_REQUEST_OUTCOME_UNKNOWN_${response.status}`),
        init.commandKey,
      );
    }
    const attempt = init?.f4Payout && (result?.code === 409 && result.message === "F4_LEADERBOARD_PAUSED"
      || result?.code === 422 && result.message === "COVERAGE_BELOW_REDLINE")
      ? readF4ApprovalAttempt((result.data as { businessResult?: unknown } | undefined)?.businessResult) : undefined;
    if (attempt && attempt.reasonCode !== result?.message) throw new Error(INVALID_F4_BUSINESS_RESULT);
    const message = await monthlyTargetPoolErrorText(result?.message, result?.data, init?.createRequestId)
      ?? formatAdminApiError(result?.message, `A2_REQUEST_FAILED_${response.status}`, init?.method && init.method !== "GET" ? "write" : "read", result?.data);
    throw Object.assign(attempt ? new F4ApprovalBlockedError(message, attempt) : new Error(message), {
      status: response.ok && typeof result?.code === "number" ? result.code : response.status,
      httpStatus: response.status,
      apiCode: result?.code,
      details: result?.data,
      backendMessage: result?.message,
      f5StatusRejected,
      ...(f4PayoutCoverageRefusal ? { f4PayoutCoverageRefusal: true } : {}),
    });
  }
  if (init?.commandKey && response.ok && result.code === 0 && result.data == null) {
    throw new A2OutcomeUncertainError("A2_SUCCESS_RESPONSE_DATA_MISSING", init.commandKey);
  }

  return result.data as T;
}

function fileNameFromContentDisposition(header: string | null, fallback: string) {
  if (!header) return fallback;
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.replace(/^"|"$/g, ""));
    } catch {
      return encoded.replace(/^"|"$/g, "");
    }
  }
  return header.match(/filename="?([^";]+)"?/i)?.[1] ?? fallback;
}

function downloadBlob(blob: Blob, fileName: string) {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function fetchA2Overview(filter: A2AuditFilter = {}, requireQueue = false): Promise<A2Overview> {
  const query = buildA2FilterQuery(filter).toString();
  const data = await a2Request<BackendOverview>(`/overview${query ? `?${query}` : ""}`);
  if (!requireQueue) return normalizeOverview(data);
  if (!data || !Array.isArray(data.operationQueue)) throw new Error("F2_APPROVAL_RESPONSE_INVALID");
  const operationQueue: A2OperationRow[] = [];
  let operationQueueInvalidCount = 0;
  for (const row of data.operationQueue) {
    if (!row || typeof row.id !== "string" || !row.id || typeof row.obj !== "string" || typeof row.action !== "string"
      || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.status ?? "")) {
      operationQueueInvalidCount += 1;
      continue;
    }
    try { operationQueue.push(fromTicket(row, true)); }
    catch { operationQueueInvalidCount += 1; }
  }
  return { ...await normalizeOverview({ ...data, operationQueue: [] }), operationQueue: await withRoleGrantsNames(operationQueue), operationQueueInvalidCount };
}

/** The proposal audit record contains the server-frozen before/after snapshots. */
export async function fetchA2ProposalLog(operationId: string, signal?: AbortSignal): Promise<A2AuditLogRow | undefined> {
  const query = new URLSearchParams({ action: "A2_OPERATION_PROPOSED", resourceType: "A2_OPERATION", resourceId: operationId, limit: "1" });
  const rows = await a2Request<BackendAuditLog[]>(`/logs?${query}`, { signal });
  const row = Array.isArray(rows) && rows.find(row => row?.action === "A2_OPERATION_PROPOSED"
    && row.resourceType === "A2_OPERATION" && row.resourceId === operationId && row.result === "SUCCESS");
  return row ? fromLog(row) : undefined;
}

export async function approveA2Operation(operationId: string, reason: string, commandKey?: string, operationCode?: string, createRequestId?: string) {
  let ticket: A2OperationRow;
  try {
    const row = await a2Request<BackendTicket>(`/operations/${encodeURIComponent(operationId)}/approve`, {
      method: "POST",
      body: JSON.stringify({ reason }),
      f5Status: operationCode === "f_commission_status",
      f4Payout: isF4SettlementOperation(operationCode),
      createRequestId,
      ...(commandKey ? { commandKey } : { idempotencyPrefix: "a2-operation-approve" }),
    });
    ticket = fromTicket(row);
  } catch (error) {
    if (commandKey && error instanceof Error && error.message === INVALID_F4_BUSINESS_RESULT) {
      throw new A2OutcomeUncertainError(error.message, commandKey);
    }
    throw error;
  }
  return (await withRoleGrantsNames([ticket]))[0];
}

export async function rejectA2Operation(operationId: string, reason: string, commandKey?: string) {
  const row = await a2Request<BackendTicket>(`/operations/${encodeURIComponent(operationId)}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason }),
    ...(commandKey ? { commandKey } : { idempotencyPrefix: "a2-operation-reject" }),
  });
  return (await withRoleGrantsNames([fromTicket(row)]))[0];
}

export type RetentionExecution = {
  retentionMonths: number;
  /** Execution time; the expiry cutoff is stored separately in the backend audit, not in this view. */
  evaluatedAt: string;
  lockAcquired: boolean;
  archivedRows: number;
  deletedRows: number;
  outboxRows: number;
  behaviorFactRows: number;
};

export type RetentionPreview = {
  retentionMonths: number;
  eligibleRows: number;
  earliestExpireAt: string | null;
  notYetExpiredRows: number;
  legacyRowsWithoutExpireAt: number;
  archiveRequired: boolean;
  approvalAuthority: string;
};

/**
 * 「立即清理」的操作前预览。
 *
 * 计数与最早日期由服务端用与执行相同的谓词算出,前端只做形状校验、不做任何推断 —— 页面必须
 * 在点击前说清本次范围(缺陷 99)。
 */
function normalizeRetentionPreview(value: unknown): RetentionPreview {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) throw new Error("A2_RETENTION_PREVIEW_INVALID");
  const integer = (key: string) => typeof row[key] === "number" && Number.isInteger(row[key]) && row[key] >= 0
    ? row[key] as number : (() => { throw new Error(`A2_RETENTION_PREVIEW_INVALID:${key}`); })();
  const earliest = row.earliestExpireAt;
  if (earliest != null && (typeof earliest !== "string" || !earliest.trim())) {
    throw new Error("A2_RETENTION_PREVIEW_INVALID:earliestExpireAt");
  }
  if (typeof row.archiveRequired !== "boolean" || typeof row.approvalAuthority !== "string" || !row.approvalAuthority.trim()) {
    throw new Error("A2_RETENTION_PREVIEW_INVALID");
  }
  return {
    retentionMonths: integer("retentionMonths"), eligibleRows: integer("eligibleRows"),
    earliestExpireAt: earliest == null ? null : earliest.trim(),
    notYetExpiredRows: integer("notYetExpiredRows"), legacyRowsWithoutExpireAt: integer("legacyRowsWithoutExpireAt"),
    archiveRequired: row.archiveRequired, approvalAuthority: row.approvalAuthority.trim(),
  };
}

export async function fetchA2RetentionPreview(): Promise<RetentionPreview> {
  return normalizeRetentionPreview(await a2Request<RetentionPreview>("/retention-preview"));
}

/** 理由的可见字符数（OP-21）：去掉空白、控制符、格式符和组合符号后再数，和后端一致。 */
export function visibleReasonLength(reason: string) {
  return Array.from(reason.normalize("NFC")).filter((char) => !/[\s\p{Cc}\p{Cf}\p{Mn}\p{Mc}\p{Me}]/u.test(char)).length;
}

export async function fetchA2ReasonPolicy(): Promise<A2ReasonPolicy> {
  const policy = await a2Request<BackendA2ReasonPolicy>("/reason-policy");
  const minChars = Number(policy?.minChars);
  const maxChars = Number(policy?.maxChars);
  if (!Number.isInteger(minChars) || minChars < 8 || minChars > 200
      || !Number.isInteger(maxChars) || maxChars < minChars || maxChars > 200
      || policy?.sourceKey !== "admin.a2.reason_min_chars") {
    throw new Error("A2_REASON_POLICY_INVALID");
  }
  return { minChars, maxChars, sourceKey: "admin.a2.reason_min_chars" };
}

/** Exact original-maker lookup includes archived audit evidence; never resubmit a lost proposal. */
function hasProposalTicketFacts(row: BackendTicket) {
  return row && typeof row.id === "string" && !!row.id && typeof row.mine === "boolean"
    && typeof row.action === "string" && typeof row.obj === "string"
    && ["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.status ?? "");
}

export async function fetchA2ProposalByKey(commandKey: string, strictNotFound = false, strictTicket: false | "a" | "f" | "metadata" | "h8" = false): Promise<A2OperationRow | null> {
  try {
    const row = await a2Request<BackendTicket>(`/operations/proposals/by-idempotency-key?${new URLSearchParams({ idempotencyKey: commandKey })}`);
    if (!row || typeof row.id !== "string" || !row.id || typeof row.status !== "string") throw new A2ProposalReceiptIncompleteError();
    // A requires raw action; F does not. B5 additionally requires operation metadata and normalizes status.
    if (strictTicket && strictTicket !== "h8" && (typeof row.obj !== "string" || typeof row.mine !== "boolean"
      || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(strictTicket === "metadata" ? row.status.trim().toLowerCase() : row.status)
      || strictTicket !== "f" && typeof row.action !== "string"
      || strictTicket === "metadata" && typeof row.operationCode !== "string")) {
      throw new A2ProposalReceiptIncompleteError();
    }
    if (strictTicket === "h8" && !validH8CommandTicket(row)) throw new Error("H8_PROPOSAL_RECEIPT_INVALID");
    return (await withRoleGrantsNames([fromTicket(row)]))[0];
  } catch (failure) {
    if (failure && typeof failure === "object" && "status" in failure && failure.status === 404
        && (!strictNotFound || "backendMessage" in failure && failure.backendMessage === "A2_PROPOSAL_NOT_FOUND")) return null;
    throw failure;
  }
}

/** H8 consumes command metadata added in backend 111e00cd, before display normalization. */
function validH8CommandTicket(row: BackendTicket) {
  return typeof row.status === "string" && ["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.status.trim().toLowerCase())
    && typeof row.mine === "boolean" && typeof row.obj === "string" && !!row.obj
    && typeof row.operationCode === "string" && !!row.operationCode;
}

export async function withdrawA2Operation(operationId: string, reason: string, operator: string, commandKey?: string) {
  const row = await a2Request<BackendTicket>(`/operations/${encodeURIComponent(operationId)}/withdraw`, {
    method: "POST",
    body: JSON.stringify({ reason, expectedStatus: "pending", operator }),
    ...(commandKey ? { commandKey } : { idempotencyPrefix: "a2-operation-withdraw" }),
  });
  return (await withRoleGrantsNames([fromTicket(row)]))[0];
}

export async function createA2OperationProposal(input: {
  action: string;
  obj: string;
  beforeValue: string;
  afterValue: string;
  operator: string;
  operatorRole: string;
  type: A2OperationType;
  amplifies: boolean;
  sos: boolean;
  roleGate: string;
  reason: string;
  sourceDomain: string;
  command: { domain: string; op: string; params: Record<string, unknown> };
  target?: { domain: string; type: string; id: string };
  targets?: { domain: string; type: string; id: string }[];
}, commandKey?: string, strictOutcome: boolean | "proposal" = false, strictTicket = false) {
  const row = await a2Request<BackendTicket>("/operations", {
    method: "POST",
    strictOutcome,
    createRequestId: input.command.op === "e1_sku_create" ? optionalIdentifier(input.command.params.createRequestId) : undefined,
    body: JSON.stringify(input),
    ...(commandKey ? { commandKey } : { idempotencyPrefix: "a2-operation-proposal" }),
  });
  if (strictOutcome && (!row || typeof row.id !== "string" || !row.id
      || strictOutcome === "proposal" && (typeof row.obj !== "string" || typeof row.mine !== "boolean"
        || typeof row.operationCode !== "string" || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.status ?? "")))) {
    throw new A2OutcomeUncertainError("提交结果不完整，请到操作记录里核对。", commandKey!);
  }
  if (strictOutcome && input.sourceDomain === "H8" && !validH8CommandTicket(row)) {
    throw new A2OutcomeUncertainError("H8_PROPOSAL_RECEIPT_INVALID", commandKey!);
  }
  if (strictTicket && !hasProposalTicketFacts(row)) throw new A2OutcomeUncertainError("提交结果不完整，请到操作记录里核对。", commandKey!);
  return (await withRoleGrantsNames([fromTicket(row)]))[0];
}

/**
 * 导出也是带命令号的写操作（后端按命令号存导出结果和这次导出的记录）。传了 commandKey 时失败按和其他写操作同一口径分：
 * 没发出去或没读到回复、5xx、幂等处理中算结果未知（A2OutcomeUncertainError，原号保留）；带原因码的 4xx 是明确拒绝。
 */
export async function exportA2Audit(reason: string, filter: Record<string, unknown>, commandKey?: string) {
  const key = commandKey ?? idempotencyKey("a2-audit-export");
  let response: Response;
  try {
    response = await guardedFetch("/api/admin/platform/audit/exports", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ reason, filter }),
      cache: "no-store",
    });
  } catch (error) {
    if (commandKey) throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "A2_REQUEST_OUTCOME_UNKNOWN", commandKey);
    throw error;
  }
  const contentType = response.headers.get("Content-Type")?.split(";")[0]?.trim();
  if (!response.ok || (contentType !== "text/csv" && contentType !== "application/vnd.ms-excel")) {
    const result = (await response.json().catch(() => null)) as ApiResult<unknown> | null;
    if (commandKey && (!result || isIdempotencyOutcomeOpen(result.message) || outcomeStaysUnknown(response.status, result.code)
      || response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown")) {
      throw new A2OutcomeUncertainError(formatAdminApiError(result?.message, `A2_REQUEST_OUTCOME_UNKNOWN_${response.status}`), commandKey);
    }
    throw Object.assign(new Error(formatAdminApiError(result?.message, `A2_AUDIT_EXPORT_FAILED_${response.status}`)), {
      status: response.ok && typeof result?.code === "number" ? result.code : response.status,
      backendMessage: result?.message,
    });
  }
  const blob = await response.blob().catch((error: unknown) => {
    if (commandKey) throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "A2_RESPONSE_UNREADABLE", commandKey);
    throw error;
  });
  const extension = contentType === "text/csv" ? "csv" : "xls";
  const fileName = fileNameFromContentDisposition(
    response.headers.get("Content-Disposition"),
    `a2-audit-${Date.now()}.${extension}`,
  );
  downloadBlob(blob, fileName);
  return { fileName, size: blob.size };
}

export async function updateA2MechanismParam(paramKey: string, value: string, reason: string, commandKey?: string) {
  return a2Request<BackendMechanismParam>(`/mechanism-params/${encodeURIComponent(paramKey)}`, {
    method: "POST",
    body: JSON.stringify({ value, reason }),
    ...(commandKey ? { commandKey } : { idempotencyPrefix: "a2-mechanism-param" }),
  });
}

function normalizeRetentionExecution(value: unknown): RetentionExecution {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  const integer = (key: string) => typeof row?.[key] === "number" && Number.isInteger(row[key]) && row[key] >= 0
    ? row[key] as number : (() => { throw new Error(`A2_RETENTION_RUN_INVALID:${key}`); })();
  if (!row || typeof row.evaluatedAt !== "string" || !row.evaluatedAt.trim() || typeof row.lockAcquired !== "boolean") {
    throw new Error("A2_RETENTION_RUN_INVALID");
  }
  return {
    retentionMonths: integer("retentionMonths"), evaluatedAt: row.evaluatedAt.trim(), lockAcquired: row.lockAcquired,
    archivedRows: integer("archivedRows"), deletedRows: integer("deletedRows"),
    outboxRows: integer("outboxRows"), behaviorFactRows: integer("behaviorFactRows"),
  };
}

export async function fetchA2RetentionLatest(): Promise<RetentionExecution | null> {
  // Only an empty successful read means no manual run; unreadable stored rows reject the request.
  const response = await a2Request<unknown>("/retention-runs/latest");
  return response == null ? null : normalizeRetentionExecution(response);
}

export async function runA2RetentionNow(reason: string, commandKey: string, expectedRetentionMonths?: number): Promise<RetentionExecution> {
  return normalizeRetentionExecution(await a2Request<unknown>("/retention-runs", {
    method: "POST", body: JSON.stringify({ reason, ...(expectedRetentionMonths === undefined ? {} : { expectedRetentionMonths }) }), commandKey,
  }));
}
